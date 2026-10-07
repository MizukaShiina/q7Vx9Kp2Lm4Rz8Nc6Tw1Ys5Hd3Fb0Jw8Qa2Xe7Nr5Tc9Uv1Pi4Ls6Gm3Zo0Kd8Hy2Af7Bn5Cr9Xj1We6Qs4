window.pageControllers = window.pageControllers || {};

// Tables we expect the main system database to always have.
// Edit this list to match the server's known schema.
const EXPECTED_TABLES = [
  'users',
  'user_stats',
  'ga_pity',
  'winners',
  'twitch_user_data',
  'verification',
  'store_products',
  'store_order',
  'store_messages',
  'wallet_transactions',
];

window.pageControllers.overview = function () {
  const dbChip = document.getElementById('ovc-db');
  const discordChip = document.getElementById('ovc-discord');
  const warnings = document.getElementById('ovc-warnings');
  const warningsLabel = document.getElementById('ovc-warnings-label');
  const warningsText = document.getElementById('ovc-warnings-text');
  if (!dbChip || !discordChip) return;

  // Direct-Postgres layer (postgre.js). In Electron this pulls snapshots
  // straight from Postgres (cloud -> local -> 5s poll, handled in main.js);
  // in browser mode it degrades to the WebSocket-pushed state.
  const pg = window.postgreDB || null;
  let dbSnapshot = null; // { ok, fetchedAt, databases }
  let dbLoading = false;

  const badge = dbChip.querySelector('.ovc-chip__badge');
  const meta = dbChip.querySelector('#ovc-db-meta');
  const timeEl = dbChip.querySelector('#ovc-db-time');

  const discordBadge = discordChip.querySelector('.ovc-chip__badge');
  const discordMeta = discordChip.querySelector('#ovc-discord-meta');
  const discordTime = discordChip.querySelector('#ovc-discord-time');

  function setChipState(chip, stateName) {
    chip.classList.remove('ovc-chip--ok', 'ovc-chip--warn', 'ovc-chip--off', 'ovc-chip--err');
    chip.classList.add(`ovc-chip--${stateName}`);
    const chipBadge = chip.querySelector('.ovc-chip__badge');
    if (chipBadge) {
      chipBadge.classList.remove('ovc-chip__badge--ok', 'ovc-chip__badge--warn', 'ovc-chip__badge--off', 'ovc-chip__badge--err');
      chipBadge.classList.add(`ovc-chip__badge--${stateName}`);
    }
  }

  function timeAgo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"'']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderDatabase() {
    // Direct Postgres mode: read the snapshot pulled via postgre.js (cloud ->
    // local -> 5s poll lives in the Electron main process). Browser fallback
    // keeps reading the WebSocket-pushed database_runtime.
    const direct = Boolean(pg && pg.isDirect && pg.isDirect());

    if (direct) {
      const st = pg.getStatus() || {};
      if (st.status === 'reconnecting') {
        const configured = st.configured && (st.configured.cloud || st.configured.local);
        setChipState(dbChip, 'off');
        badge.textContent = 'Idle';
        meta.textContent = configured
          ? `Reconnecting � retrying every ${Math.round((st.pollIntervalMs || 5000) / 1000)}s`
          : 'No Postgres URL configured';
        timeEl.textContent = '�';
        return { state: 'waiting', problems: [] };
      }
      if (!dbSnapshot || !dbSnapshot.ok) {
        setChipState(dbChip, 'off');
        badge.textContent = 'Idle';
        meta.textContent = 'Fetching snapshot�';
        timeEl.textContent = '�';
        return { state: 'waiting', problems: [] };
      }
    }

    const dbRuntime = direct ? null : window.state?.database_runtime;
    const databases = direct
      ? (dbSnapshot?.databases || [])
      : dbRuntime?.databases;
    const db = Array.isArray(databases) && databases.length > 0 ? databases[0] : null;
    const presentTables = db?.tables;

    if (!db || !Array.isArray(presentTables)) {
      setChipState(dbChip, 'off');
      badge.textContent = 'Idle';
      meta.textContent = 'Awaiting snapshot';
      timeEl.textContent = '�';
      return { state: 'waiting', problems: [] };
    }

    const sourceLabel = direct ? (pg.getStatus()?.label || 'Postgres') : 'Server snapshot';

    // Compare what the server reports against our expected schema.
    const missing = EXPECTED_TABLES.filter((t) => !presentTables.includes(t));
    const errored = EXPECTED_TABLES.filter((t) => {
      const info = db.table_data?.[t];
      return info && Boolean(info.error);
    });
    const totalRows = EXPECTED_TABLES.reduce((sum, t) => {
      const info = db.table_data?.[t];
      return sum + (typeof info?.row_count === 'number' ? info.row_count : 0);
    }, 0);

    const allGood = missing.length === 0 && errored.length === 0;

    if (allGood) {
      setChipState(dbChip, 'ok');
      badge.textContent = 'Ok';
      meta.textContent = `${sourceLabel} � ${presentTables.length} tables � ${totalRows.toLocaleString()} rows`;
    } else {
      setChipState(dbChip, 'err');
      const problems = missing.length + errored.length;
      badge.textContent = `${problems} issue${problems === 1 ? '' : 's'}`;
      meta.textContent = [
        sourceLabel,
        missing.length ? `${missing.length} missing` : '',
        errored.length ? `${errored.length} errored` : '',
      ].filter(Boolean).join(' � ') || 'attention';
    }

    const stampTs = direct ? (dbSnapshot?.fetchedAt || 0) : window.state?.fetchedAt;
    timeEl.textContent = stampTs ? timeAgo(stampTs) : '�';

    return {
      state: allGood ? 'ok' : 'err',
      problems: [
        ...missing.map((t) => `table <code>${escapeText(t)}</code> missing`),
        ...errored.map((t) => `table <code>${escapeText(t)}</code> error`),
      ],
    };
  }

  function renderDiscord() {
    const d = window.state?.runtime?.bot_statuses?.discord;
    if (!d || typeof d !== 'object') {
      setChipState(discordChip, 'off');
      discordBadge.textContent = 'Off';
      discordMeta.textContent = 'Waiting for state�';
      discordTime.textContent = '�';
      return { state: 'waiting', problems: [] };
    }

    const connected = d.connected === true;
    const guildName = d.guild && d.guild !== '�' ? String(d.guild) : '';
    setChipState(discordChip, connected ? 'ok' : 'off');
    discordBadge.textContent = connected ? 'Live' : 'Off';
    discordMeta.textContent = connected
      ? (guildName || 'Connected')
      : (d.status || 'Disconnected');
    discordTime.textContent = window.state?.fetchedAt ? timeAgo(window.state.fetchedAt) : '�';

    return { state: connected ? 'ok' : 'off', problems: [] };
  }

  function composeWarnings(parts) {
    if (!warnings) return;
    const problems = parts.flatMap((p) => p.problems || []);
    const allWaiting = parts.length > 0 && parts.every((p) => p.state === 'waiting');

    if (problems.length > 0) {
      warnings.classList.remove('ovc-warnings--ok');
      warningsLabel.textContent = 'Attention';
      warningsText.innerHTML = problems.join(' � ');
    } else if (allWaiting) {
      warnings.classList.remove('ovc-warnings--ok');
      warningsLabel.textContent = 'Waiting';
      warningsText.textContent = 'Waiting for the server to report system state.';
    } else {
      warnings.classList.add('ovc-warnings--ok');
      warningsLabel.textContent = 'All ok';
      warningsText.textContent = 'All systems nominal � nothing needs attention.';
    }
  }

  function render() {
    const parts = [renderDatabase(), renderDiscord()];
    composeWarnings(parts);
  }

  // Re-render when the server pushes new state. Unsubscribe the previous
  // subscription first so a forced reload doesn't stack duplicate listeners
  // (the old closure would also hold stale DOM references).
  if (typeof window.pageControllers.__overviewUnsubscribe === 'function') {
    window.pageControllers.__overviewUnsubscribe();
  }
  if (window.state?.subscribe) {
    window.pageControllers.__overviewUnsubscribe = window.state.subscribe(render);
  }

  // Direct-Postgres wiring: refresh the DB chip whenever the connection
  // status changes (e.g. a Postgres instance finally connects after polling)
  // and pull an initial snapshot right away.
  async function refreshDbSnapshot() {
    if (!pg || !pg.isDirect || !pg.isDirect() || dbLoading) return;
    dbLoading = true;
    try {
      dbSnapshot = await pg.load();
      render();
    } catch (err) {
      console.warn('[overview] Postgres snapshot failed', err);
    } finally {
      dbLoading = false;
    }
  }

  if (typeof window.pageControllers.__overviewPgUnsubscribe === 'function') {
    window.pageControllers.__overviewPgUnsubscribe();
  }
  const handlePgStatus = () => {
    refreshDbSnapshot();
    render();
  };
  window.addEventListener('postgre:status', handlePgStatus);
  window.pageControllers.__overviewPgUnsubscribe = () => {
    window.removeEventListener('postgre:status', handlePgStatus);
  };

  refreshDbSnapshot();

  // Re-render when this page becomes active again (state may have updated
  // while we were on another tab).
  const handleActivate = (ev) => {
    if (ev.detail?.pageId === 'overview') render();
  };
  if (window.pageControllers.__overviewActivateHandler) {
    document.removeEventListener('page:activate', window.pageControllers.__overviewActivateHandler);
  }
  document.addEventListener('page:activate', handleActivate);
  window.pageControllers.__overviewActivateHandler = handleActivate;

  render();
};

// Initialize the page controller
window.pageControllers.overview();