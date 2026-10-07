// userCard.js
//
// Hover-identity overlay for the Database page.
//
// Hovering any row that references a user (a `user_id` column, the `users`
// table's own `id`, or a platform `*_uid` / `*_username` cell) fades an opaque
// cover over the dashboard's right-hand details column, with the identity card
// inside it. The cover is display-only: pointer-events:none, so it can never
// steal a click from the Database page's inline editor.
//
// Every value comes from the snapshot the Database page already rendered — no
// extra queries, no schema changes, no new IPC surface. Resolution is a Map
// lookup, so a whole-row hover costs the same as a single-cell hover.
//
// Adding or removing a platform is a config edit only — see PLATFORMS below.
//
// Exposed as window.userCard:
//   attach({ tableWrap, getSelection, getRow, getSnapshot })
//   isResolvableRow(tableName, row) -> boolean   (render-time affordance)
//   invalidate()                                 (drop the memoised index)
//   hide()
//   _internals                                   (for tests)

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Platform config — the single place to add or remove columns.
  //
  //   label   Row heading.
  //   id      Candidate `users` columns holding the platform's uid.
  //   name    Candidate `users` columns holding the platform's display name.
  //   flag    { table, column } value read for the green/red bullet. Add
  //           `presence: true` when a non-empty reference means connected.
  //   mode    'pair' | 'flag' | 'both'. Defaults to 'flag' when a `flag` is
  //           configured, otherwise 'pair'. Flip youtube to 'pair' here if you
  //           ever want its uid/username shown instead of the bullet.
  //   always  Render the row even when the user has no data for it, so a red
  //           "not connected" bullet is meaningful instead of the row vanishing.
  //   match   Columns in ANY table that identify a user through this platform
  //           (used when a row has no direct user_id to key off).
  //
  // `id` / `name` / `match` are arrays so a schema rename is a config edit.
  // ---------------------------------------------------------------------------
  const PLATFORMS = {
    twitch: {
      label: 'Twitch',
      id: ['twitch_uid'],
      name: ['twitch_username'],
      match: ['twitch_uid', 'twitch_username'],
    },
    discord: {
      label: 'Discord',
      id: ['discord_uid'],
      name: ['discord_username'],
      match: ['discord_uid', 'discord_username'],
    },
    youtube: {
      label: 'YouTube',
      id: ['youtube_uid'],
      flag: { table: 'users', column: 'youtube_uid', presence: true },
      always: true,
      match: ['youtube_uid', 'youtube_username'],
    },
    tiktok: {
      label: 'TikTok',
      id: ['tiktok_uid'],
      flag: { table: 'users', column: 'tiktok_uid', presence: true },
      always: true,
      match: ['tiktok_uid', 'tiktok_username'],
    },
    instagram: {
      label: 'Instagram',
      id: ['instagram_uid'],
      flag: { table: 'user_stats', column: 'instagram_follower' },
      always: true,
      match: ['instagram_uid', 'instagram_username'],
    },
    twitter: {
      label: 'Twitter',
      id: ['twitter_uid'],
      flag: { table: 'user_stats', column: 'twitter_follower' },
      always: true,
      match: ['twitter_uid', 'twitter_username'],
    },
  };

  const USERS_TABLE = 'users';
  const USER_ID_COLUMN = 'user_id';

  // Render context pushed in by the Database page's attach(). Kept in a single
  // mutable slot so a forced reload of script.js (new closure, same table
  // element) simply re-points the card at the fresh state.
  let ctx = null;

  // column name -> platform key. Resolved once so isResolvableRow() stays a
  // handful of lookups per row instead of walking every platform.
  const MATCH_COLUMNS = new Map();
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    for (const column of platform.match || []) {
      if (!MATCH_COLUMNS.has(column)) MATCH_COLUMNS.set(column, key);
    }
  }

  function modeOf(platform) {
    if (platform.mode) return platform.mode;
    return platform.flag ? 'flag' : 'pair';
  }

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  const hasValue = (value) => value !== undefined && value !== null && value !== '';

  // First populated candidate column, or '' when none are filled.
  function firstValue(row, columns) {
    for (const column of columns || []) {
      const value = row?.[column];
      if (hasValue(value)) return value;
    }
    return '';
  }

  // Postgres `boolean` arrives as a JS boolean via pg. Tolerate text flags,
  // treating unknown non-empty strings as enabled for legacy reference values.
  function isTruthy(value) {
    if (value === true) return true;
    if (value === false || value === null || value === undefined) return false;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return false;
      if (normalized === 'f' || normalized === 'false' || normalized === '0' ||
          normalized === 'n' || normalized === 'no' || normalized === 'off') {
        return false;
      }
      return true;
    }
    return Boolean(value);
  }

  // Find a table payload in the snapshot shape db.js / postgre.js produce.
  function findTable(databases, tableName) {
    for (const database of databases || []) {
      const payload = database && database.table_data && database.table_data[tableName];
      if (payload && typeof payload === 'object') return payload;
    }
    return null;
  }

  function rowsOf(databases, tableName) {
    const payload = findTable(databases, tableName);
    return Array.isArray(payload?.rows) ? payload.rows : [];
  }

  // ---------------------------------------------------------------------------
  // Directory — id / uid / name indexes built from the snapshot in memory.
  // ---------------------------------------------------------------------------

  function buildDirectory(snapshot) {
    const databases = (snapshot && snapshot.databases) || [];

    const byId = new Map(); // users.id -> user row
    const byUid = {}; // platform key -> Map(uid -> user row)
    const byName = {}; // platform key -> Map(lowercased name -> user row)
    for (const key of Object.keys(PLATFORMS)) {
      byUid[key] = new Map();
      byName[key] = new Map();
    }

    for (const row of rowsOf(databases, USERS_TABLE)) {
      if (!row || typeof row !== 'object') continue;
      if (!hasValue(row.id)) continue;

      byId.set(String(row.id), row);

      for (const [key, platform] of Object.entries(PLATFORMS)) {
        for (const column of platform.id || []) {
          const value = row[column];
          if (!hasValue(value)) continue;
          const uidKey = String(value);
          // First writer wins so a duplicate uid can't flap between renders.
          if (!byUid[key].has(uidKey)) byUid[key].set(uidKey, row);
        }
        for (const column of platform.name || []) {
          const value = row[column];
          if (!hasValue(value)) continue;
          const nameKey = String(value).toLowerCase();
          if (!byName[key].has(nameKey)) byName[key].set(nameKey, row);
        }
      }
    }

    // Per-flag-table index keyed by user id, for the green/red bullets.
    const statsByTable = new Map();
    for (const platform of Object.values(PLATFORMS)) {
      if (!platform.flag) continue;
      const table = platform.flag.table;
      if (statsByTable.has(table)) continue;

      const map = new Map();
      for (const row of rowsOf(databases, table)) {
        if (!row || typeof row !== 'object') continue;
        const id = hasValue(row[USER_ID_COLUMN]) ? row[USER_ID_COLUMN] : row.id;
        if (!hasValue(id)) continue;
        const key = String(id);
        if (!map.has(key)) map.set(key, row);
      }
      statsByTable.set(table, map);
    }

    return { byId, byUid, byName, statsByTable };
  }

  // Cheap change detector: the tables the card reads, plus their row counts and
  // edge ids. Far cheaper than serialising the snapshot, and enough to notice an
  // insert, a delete, or a row shifting out of the row cap.
  function snapshotSignature(snapshot) {
    const databases = (snapshot && snapshot.databases) || [];
    const tables = new Set([USERS_TABLE]);
    for (const platform of Object.values(PLATFORMS)) {
      if (platform.flag) tables.add(platform.flag.table);
    }

    const parts = [];
    for (const table of tables) {
      const rows = rowsOf(databases, table);
      const edge = (row) => {
        if (!row) return '';
        if (hasValue(row[USER_ID_COLUMN])) return String(row[USER_ID_COLUMN]);
        return hasValue(row.id) ? String(row.id) : '';
      };
      parts.push(`${table}:${rows.length}:${edge(rows[0])}:${edge(rows[rows.length - 1])}`);
    }
    return parts.join('|');
  }

  const DIRECTORY_TTL_MS = 2000;
  let directory = null;
  let directorySignature = null;
  let directoryAt = 0;

  function invalidate() {
    directory = null;
    directorySignature = null;
    directoryAt = 0;
  }

  // The card is only ever read on hover, so the index is built lazily and then
  // leased for DIRECTORY_TTL_MS (matching db.js's own 2s snapshot cache) —
  // hovering across a table never rebuilds it, and a write is picked up fast.
  function getDirectory() {
    const now = Date.now();
    if (directory && now - directoryAt < DIRECTORY_TTL_MS) return directory;

    const snapshot = ctx && ctx.getSnapshot ? ctx.getSnapshot() : null;
    const signature = snapshotSignature(snapshot);
    if (directory && signature === directorySignature) {
      directoryAt = now;
      return directory;
    }

    directory = buildDirectory(snapshot);
    directorySignature = signature;
    directoryAt = now;
    return directory;
  }

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  // Match a hovered column name against the platform config.
  function platformForColumn(column) {
    const key = MATCH_COLUMNS.get(column);
    if (!key) return null;
    const platform = PLATFORMS[key];
    const kind = (platform.id || []).includes(column) ? 'id' : 'name';
    return { key, platform, kind };
  }

  // Resolve a hovered (table, row, column) to a user record.
  //
  // Returns { user, statsId }, { missing: true, id }, or null when the row has
  // nothing to do with a user.
  function resolveFor(table, row, column) {
    if (!row || typeof row !== 'object') return null;
    const dir = getDirectory();

    // 1. A direct reference on the row. Only `users` uses its own `id` as the
    //    user id — in every other table `id` is that table's own primary key
    //    (e.g. verification.id must NOT be read as a user id).
    let userId = '';
    if (table === USERS_TABLE) {
      if (hasValue(row.id)) userId = row.id;
    } else if (hasValue(row[USER_ID_COLUMN])) {
      userId = row[USER_ID_COLUMN];
    }

    if (hasValue(userId)) {
      const key = String(userId);
      const user = dir.byId.get(key);
      return user ? { user, statsId: key } : { missing: true, id: userId };
    }

    // 2. No direct reference: the hovered cell may itself be a platform
    //    identity, e.g. verification.discord_uid or a users.twitch_username.
    const match = platformForColumn(column);
    if (!match) return null;

    const value = row[column];
    if (!hasValue(value)) return null;

    const user = match.kind === 'id'
      ? dir.byUid[match.key].get(String(value))
      : dir.byName[match.key].get(String(value).toLowerCase());
    return user ? { user, statsId: String(user.id) } : null;
  }

  // Render-time affordance: should this row advertise itself as hoverable?
  // Deliberately cheap — at most one lookup per configured match column.
  function isResolvableRow(table, row) {
    if (!row || typeof row !== 'object') return false;
    if (table === USERS_TABLE) return hasValue(row.id);
    if (hasValue(row[USER_ID_COLUMN])) return true;
    for (const column of MATCH_COLUMNS.keys()) {
      if (hasValue(row[column])) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Card markup
  // ---------------------------------------------------------------------------

  function flagState(statsByTable, platform, statsId) {
    const map = statsByTable.get(platform.flag.table);
    const row = map ? map.get(statsId) : null;
    if (!row || !Object.prototype.hasOwnProperty.call(row, platform.flag.column)) {
      return { known: false };
    }
    const value = row[platform.flag.column];
    if (!hasValue(value)) {
      return { known: true, on: false };
    }
    return {
      known: true,
      on: platform.flag.presence ? true : isTruthy(value),
    };
  }

  function bulletMarkup(label, state) {
    const modifier = !state.known ? 'unknown' : (state.on ? 'on' : 'off');
    const text = !state.known ? 'unknown' : (state.on ? 'connected' : 'not connected');
    return `<p class="user-card__bullet user-card__bullet--${modifier}">
      <span class="user-card__dot" aria-hidden="true"></span>
      <span class="user-card__bullet-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(text)}</strong>
    </p>`;
  }

  function pairMarkup(label, idValue, nameValue) {
    const lines = [];
    if (hasValue(idValue)) lines.push(['UID', idValue]);
    if (hasValue(nameValue)) lines.push(['Username', nameValue]);
    if (!lines.length) return '';

    return `<div class="user-card__platform">
      <p class="user-card__platform-label">${escapeHtml(label)}</p>
      ${lines.map(([field, value]) => `<p class="user-card__field"><span>${escapeHtml(field)}</span><strong>${escapeHtml(value)}</strong></p>`).join('')}
    </div>`;
  }

  function renderCard(resolved) {
    if (!resolved) return '';

    // A user_id with no matching `users` row (past the snapshot row cap, or
    // deleted). Say so instead of rendering an empty card.
    if (resolved.missing) {
      return `<div class="user-card__head">
        <span class="user-card__label">User ID</span>
        <h4 class="user-card__id">${escapeHtml(resolved.id)}</h4>
        <p class="user-card__hint">No matching <code>users</code> record in this snapshot.</p>
      </div>`;
    }

    const user = resolved.user;
    const statsId = resolved.statsId;
    const dir = getDirectory();
    const blocks = [];

    for (const platform of Object.values(PLATFORMS)) {
      const mode = modeOf(platform);

      if (mode === 'pair' || mode === 'both') {
        const idValue = firstValue(user, platform.id);
        const nameValue = firstValue(user, platform.name);
        if (hasValue(idValue) || hasValue(nameValue)) {
          blocks.push(pairMarkup(platform.label, idValue, nameValue));
        }
      }

      if (mode === 'flag' || mode === 'both') {
        if (platform.flag) {
          const state = flagState(dir.statsByTable, platform, statsId);
          if (platform.always || state.known) blocks.push(bulletMarkup(platform.label, state));
        }
      }
    }

    const rows = blocks.length
      ? blocks.join('')
      : '<p class="user-card__hint">No linked platform data for this user.</p>';

    return `<div class="user-card__head">
      <span class="user-card__label">User ID</span>
      <h4 class="user-card__id">${escapeHtml(user.id)}</h4>
    </div>
    <div class="user-card__rows">${rows}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Overlay plumbing
  //
  // Our own layer is appended into the dashboard's shared `.detail-panel` — the
  // full-height details column — and covers it edge to edge while hovered. It is
  // pointer-events:none in CSS, so it can never intercept a click meant for the
  // Database page's inline editor.
  // ---------------------------------------------------------------------------

  let overlay = null;
  let overlayHost = null;
  let currentCardKey = null;

  function panelHidden() {
    const shell = document.querySelector('.dashboard-shell');
    return Boolean(shell && shell.classList.contains('is-details-hidden'));
  }

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;

    // Our own layer, anchored to the details column itself. .detail-panel is the
    // full-height grid item, so inset:0 covers the column edge to edge and stays
    // correct at every breakpoint — .detail-panel__body is only as tall as its
    // static cards, which is what used to clip the card.
    const host = document.querySelector('.detail-panel');
    if (!host) return null;

    if (host !== overlayHost) {
      if (overlayHost) overlayHost.removeEventListener('scroll', hide);
      // The panel is a scroll container, and an absolutely positioned child
      // scrolls with its content — so scrolling while hovered would slide the
      // cover out of view. Hiding is also the honest behaviour: the hover is
      // over. Registered once, on whichever panel we end up inside.
      host.addEventListener('scroll', hide);
      overlayHost = host;
    }

    overlay = document.createElement('div');
    overlay.className = 'user-overlay';
    overlay.id = 'database-user-card';
    // Presentation only — never announced, never focusable.
    overlay.setAttribute('aria-hidden', 'true');
    host.appendChild(overlay);
    return overlay;
  }

  function hide() {
    currentCardKey = null;
    if (overlay) overlay.classList.remove('is-visible');
  }

  function show(resolved) {
    // Decision: never force the details panel open. If the user has it hidden
    // the hover simply shows nothing.
    if (panelHidden()) return;

    const layer = ensureOverlay();
    if (!layer) return;

    // The overlay is the opaque cover; renderCard() returns the card inside it.
    // The card hugs its content while the cover stretches to the column.
    layer.innerHTML = `<div class="user-card">${renderCard(resolved)}</div>`;
    layer.classList.add('is-visible');
  }

  function selectionTable() {
    const selection = ctx && ctx.getSelection ? ctx.getSelection() : null;
    return (selection && selection.table) || '';
  }

  function hoveredCell(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest('.database-cell');
  }

  function onMouseOver(event) {
    const cell = hoveredCell(event);
    if (!cell || !ctx) return;

    const key = cell.dataset ? cell.dataset.key || '' : '';
    const column = cell.dataset ? cell.dataset.column || '' : '';
    const row = key && ctx.getRow ? ctx.getRow(key) : null;

    const resolved = resolveFor(selectionTable(), row, column);
    if (!resolved) {
      hide();
      return;
    }

    // Whole-row hover: every cell in a resolvable row produces the same card, so
    // skip the rewrite when the content would not change.
    const cardKey = resolved.missing
      ? `missing:${resolved.id}`
      : `user:${resolved.user.id}`;
    if (cardKey === currentCardKey && overlay && overlay.classList.contains('is-visible')) {
      return;
    }

    currentCardKey = cardKey;
    show(resolved);
  }

  function onMouseOut(event) {
    const related = event.relatedTarget;
    // Moving between two data cells keeps the card up; the next mouseover
    // decides whether it still applies.
    if (related && typeof related.closest === 'function' && related.closest('.database-cell')) {
      return;
    }
    hide();
  }

  function onMouseLeave() {
    hide();
  }

  // Bind once per table element. Delegated on purpose: renderTable() replaces
  // tableWrap.innerHTML on every snapshot change, so per-cell listeners would be
  // wiped on each poll.
  let boundWrap = null;

  function attach(context) {
    if (context) ctx = context;
    const wrap = ctx && ctx.tableWrap;
    if (!wrap || wrap === boundWrap) return;

    if (boundWrap) {
      boundWrap.removeEventListener('mouseover', onMouseOver);
      boundWrap.removeEventListener('mouseout', onMouseOut);
      boundWrap.removeEventListener('mouseleave', onMouseLeave);
    }

    boundWrap = wrap;
    wrap.addEventListener('mouseover', onMouseOver);
    wrap.addEventListener('mouseout', onMouseOut);
    wrap.addEventListener('mouseleave', onMouseLeave);
  }

  // Registered once at load. There is no page:deactivate event, so page:activate
  // doubles as the teardown hook for leaving the Database page.
  document.addEventListener('page:activate', (event) => {
    if (event?.detail?.pageId !== 'database') hide();
  });

  // Hiding the details panel via the header toggle disarms the overlay, so it
  // cannot reappear stale when the panel is shown again.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target && typeof target.closest === 'function' &&
        target.closest('[data-action="toggle-details"]')) {
      hide();
    }
  });

  window.userCard = {
    attach,
    isResolvableRow,
    invalidate,
    hide,
    // Exposed for the .scratch harness only.
    _internals: {
      PLATFORMS,
      MATCH_COLUMNS,
      USERS_TABLE,
      modeOf,
      isTruthy,
      hasValue,
      firstValue,
      buildDirectory,
      snapshotSignature,
      resolveFor,
      renderCard,
      getDirectory,
    },
  };
})();


