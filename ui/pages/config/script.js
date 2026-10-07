/**
 * Config Page
 * ---------------------------------------------------------------------------
 * Real page (not a modal) for the core bot configuration: the Twitch identity
 * section and the Loyalty economy section.
 *
 * Rendering mirrors the giveaway settings modal: field rows are built
 * adaptively from the live state, so adding a setting server-side needs no
 * hand-written HTML here. Value type drives the control:
 *   boolean -> toggle, number -> number input, string -> text input.
 *
 * Secrets (tokens / client secrets / IDs) and connection constants
 * (irc host/port) are intentionally excluded from the Twitch section -- they
 * belong on the Credentials page.
 *
 * Saving uses the same server command as the giveaway settings modal:
 * `save_config` with only the changed keys per section.
 *
 * This module is loaded as a classic page script by the dashboard; it exposes
 * `window.pageControllers.config` and rebinds safely when the dashboard
 * force-reloads a page.
 */

(function () {
  window.pageControllers = window.pageControllers || {};
// Settings keys that must NOT be rendered on this page. auto_start_giveaway
// is duplicated inside giveaway.config and is already handled by the giveaway
// settings modal, so it is excluded here to avoid a second home.
const SETTINGS_EXCLUDED_KEYS = new Set([
  'auto_start_giveaway',
]);

// Sections that must NOT be auto-rendered on this page, even though they
// exist in config.json. Each already has a dedicated home in the UI:
//   giveaway -> giveaway settings modal
//   scanner  -> scanner controls elsewhere
// Add a section id here to suppress its card entirely (no card, no fields,
// nothing to save from this page).
const HIDDEN_SECTIONS = new Set([
  'giveaway',
  'scanner',
]);

  const FIELD_META = {
    twitch: {
      channel: {
        label: 'Channel Name',
        hint: 'The Twitch channel the bot will join',
      },
      oauth_token: {
        excluded: true,
      },
      stream_oauth: {
        excluded: true,
      },
      client_id: {
        excluded: true,
      },
      client_secret: {
        excluded: true,
      },
      irc_server: {
        excluded: true,
      },
      irc_port: {
        excluded: true,
      },
      bot_prefix: {
        label: 'Bot Prefix',
        hint: 'Message prefix that appears in all bot messages',
      },
      raid_command: {
        label: 'Shoutout Command',
        hint: 'Command used for shoutouts on incoming raids',
      },
    },

    discord: {
      verify_channel_id: {
        label: 'Verify Channel ID',
        hint: 'Discord channel used for verification prompts',
      },
      claim_channel_id: {
        label: 'Claim Channel ID',
        hint: 'Discord channel for reward/claim messages',
      },
      announce_channel_id: {
        label: 'Announce Channel ID',
        hint: 'Discord channel used for stream announcements',
      },
      bot_report_channel_id: {
        label: 'Bot Report Channel ID',
        hint: 'Discord channel for bot/system reports',
      },
      store_channel_id: {
        label: 'Store Channel ID',
        hint: 'Discord channel used for store or shop commands',
      },
    },

    loyalty: {
      points_rate_per_minute: {
        label: 'Points Per Minute',
        hint: 'Base points earned per minute watched',
      },
      sub_cache_duration: {
        label: 'Sub Cache Duration',
        hint: 'How long subscriber status stays cached (minutes)',
      },
      tier0: {
        label: 'Tier 0 Multiplier',
        hint: 'Points multiplier for non-subscribers',
      },
      tier1: {
        label: 'Tier 1 Multiplier',
        hint: 'Points multiplier for Tier 1 subscribers',
      },
      tier2: {
        label: 'Tier 2 Multiplier',
        hint: 'Points multiplier for Tier 2 subscribers',
      },
      tier3: {
        label: 'Tier 3 Multiplier',
        hint: 'Points multiplier for Tier 3 subscribers',
      },
      prime: {
        label: 'Prime Multiplier',
        hint: 'Points multiplier for Prime Gaming subs',
      },
    },

    obs: {
      auto_switch: {
        excluded: true,
      },
      enabled:{
        excluded: true,
      }
    },

    settings: {
      bot_prefix: {
        excluded: true,
      },
      winner_db: {
        excluded: true,
      },
      debug_mode: {
        excluded: true,
        label: 'Debug Mode',
        hint: 'Enable verbose debug logging',
      },
      minimize_to_tray: {
        excluded: true,
        label: 'Minimize to Tray',
        hint: 'Minimize the app to the system tray instead of closing',
      },
      launch_on_startup: {
        excluded: true,
        label: 'Launch on Startup',
        hint: 'Launch the bot automatically on system boot',
      },
      command_handlers: {
        excluded: true,
        label: 'Disable Command Handlers',
        hint: 'Disable built-in command handlers',
      },
      timezone: {
        label: 'Timezone',
        hint: 'Timezone used for scheduling and timestamps',
      },
      backup_interval_hours: {
        label: 'Backup Interval Offline (hours)',
        hint: 'How often to back up the configs (in hours)',
      },
      backup_active_hours: {
        label: 'Backup Interval Online (hours)',
        hint: 'How often to back up the configs (in hours)',
      },
    },

    database: {
      local_host: {
        label: 'Local Host',
        hint: 'Hostname of the local PostgreSQL server',
      },
      local_port: {
        label: 'Local Port',
        hint: 'Port of the local PostgreSQL server',
      },
      local_name: {
        label: 'Local Database Name',
        hint: 'Database name on the local server',
      },
      local_user: {
        label: 'Local User',
        hint: 'User used to connect to the local server',
      },
      local_sslmode: {
        label: 'Local SSL Mode',
        hint: 'SSL mode for the local connection (e.g. prefer)',
      },
      cloud_host: {
        label: 'Cloud Host',
        hint: 'Hostname of the cloud PostgreSQL server',
      },
      cloud_port: {
        label: 'Cloud Port',
        hint: 'Port of the cloud PostgreSQL server',
      },
      cloud_name: {
        label: 'Cloud Database Name',
        hint: 'Database name on the cloud server',
      },
      cloud_user: {
        label: 'Cloud User',
        hint: 'User used to connect to the cloud server',
      },
      cloud_sslmode: {
        label: 'Cloud SSL Mode',
        hint: 'SSL mode for the cloud connection (e.g. require)',
      },
    },

    callback: {
      ssl_certfile: {
        label: 'SSL Cert File',
        hint: 'Path to the SSL certificate file (empty = no SSL)',
      },
      ssl_keyfile: {
        label: 'SSL Key File',
        hint: 'Path to the SSL key file (empty = no SSL)',
      },
      linktree_url: {
        label: 'Linktree URL',
        hint: 'Linktree URL used in bot messages',
      },
      redirect_url: {
        label: 'Redirect URL',
        hint: 'Base URL for OAuth callback redirects',
      },
    },

    foxreload: {
      mock: {
        label: 'Mock Orders',
        hint: 'True = Mock orders',
      },
    },

    link_reward: {
      instagram: {
        label: 'Instagram Connection Reward',
        hint: 'Instagram Connection Reward (Drinst Bucks)',
      },
      tiktok: {
        label: 'TikTok Connection Reward',
        hint: 'TikTok Connection Reward (Drinst Bucks)',
      },
      twitter: {
        label: 'Twitter Connection Reward',
        hint: 'Twitter Connection Reward (Drinst Bucks)',
      },
      youtube: {
        label: 'YouTube Subscription Reward',
        hint: 'YouTube Subscription Reward (Drinst Bucks)',
      },
    },

    role_ids: {
      instagram: {
        label: 'Instagram Role ID',
        hint: 'Instagram Connection Reward (Drinst Bucks)',
      },
      tiktok: {
        label: 'TikTok Role ID',
        hint: 'TikTok Connection Reward (Drinst Bucks)',
      },
      twitter: {
        label: 'Twitter Role ID',
        hint: 'Twitter Connection Reward (Drinst Bucks)',
      },
      youtube: {
        label: 'YouTube Role ID',
        hint: 'YouTube Subscription Reward (Drinst Bucks)',
      },
    }
  };

const SECTIONS = [
  { id: 'database', containerId: 'config-database-fields' },
  { id: 'twitch', containerId: 'config-twitch-fields' },
  { id: 'discord', containerId: 'config-discord-fields' },
  { id: 'loyalty', containerId: 'config-loyalty-fields' },
  { id: 'settings', containerId: 'config-settings-fields' },
];

// Section definitions rendered on this page.
const DISCORD_EXCLUDED_KEYS = new Set([
  'token',
  'verify_message_id',
  'allowed_users',
  'allowed_roles',
]);

const DISCORD_CHANNEL_ID_KEYS = new Set([
  'verify_channel_id',
  'claim_channel_id',
  'store_channel_id',
  'announce_channel_id',
  'bot_report_channel_id',
]);

const TIMEZONE_OPTIONS = typeof Intl.supportedValuesOf === 'function'
  ? ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')]
  : ['UTC', 'America/Los_Angeles', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'];


function sectionTitle(sectionId) {
  return titleCase(sectionId);
}

function syncDynamicSections() {
  const config = toPlain(window.state?.config);
  for (const sectionId of Object.keys(config)) {
    if (SECTIONS.some((section) => section.id === sectionId)) continue;
    if (HIDDEN_SECTIONS.has(sectionId)) continue;

    const containerId = `config-${sectionId}-fields`;
    const container = document.getElementById(containerId) || document.createElement('div');
    if (!container.id) {
      container.id = containerId;
      container.className = 'cfg-fields';
      const card = document.createElement('div');
      card.className = 'cfg-card';
      card.innerHTML = `<div class="cfg-card__header"><div><p class="panel-label">${sectionTitle(sectionId)}</p><h4>${sectionTitle(sectionId)} settings</h4></div></div>`;
      card.appendChild(container);
      document.getElementById('config-view')?.appendChild(card);
    }
    SECTIONS.push({ id: sectionId, containerId, excluded: new Set(), dynamic: true });
  }
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

// Convert a NestedState (or plain object) into a plain object. NestedState
// instances expose toObject(); plain objects are walked so nested proxies are
// converted too.
function toPlain(value) {
  if (!value) return {};
  if (typeof value.toObject === 'function') return value.toObject();
  if (typeof value !== 'object') return {};
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (val && typeof val === 'object' && typeof val.toObject === 'function') {
      out[key] = val.toObject();
    } else {
      out[key] = val;
    }
  }
  return out;
}

// Live config data for a section.
function getSectionData(sectionId) {
  const state = window.state;
  if (!state) {
    console.log('[Config] No window.state');
    return {};
  }

  if (HIDDEN_SECTIONS.has(sectionId)) return {};

  // Config is packed under state.config. Keep the old root as a fallback so
  // the page remains usable while an older server is still running.
  const config = state.config || state;

  if (sectionId === 'twitch') {
    return toPlain(config.twitch);
  }

  if (sectionId === 'discord') {
    return toPlain(config.discord);
  }

  if (sectionId === 'loyalty') {
    const loyalty = toPlain(config.loyalty);
    // NOTE: do not name this variable `config` -- shadowing the outer `config`
    // in the same block triggers a TDZ ReferenceError on the line above.
    const nested = loyalty.config;
    // Prefer the nested config block; fall back to the flattened section.
    if (nested && typeof nested === 'object') {
      const result = toPlain(nested);
      return result;
    }
    delete loyalty.config;
    return loyalty;
  }

  if (sectionId === 'settings') {
    return toPlain(config.settings);
  }

  if (sectionId === 'database') {
    // The server nests database settings under local/cloud. Flatten them into
    // prefixed keys (local_host, cloud_sslmode, ...) so the adaptive field
    // builder can render them; unflattenDatabase() reverses this on save.
    // ready/name/password_configured and the passwords stay off this page
    // (status lives on the Database page, passwords on Credentials).
    const data = toPlain(config.database);
    const flat = {};
    for (const target of ['local', 'cloud']) {
      const sub = data[target];
      if (!sub || typeof sub !== 'object') continue;
      for (const [key, value] of Object.entries(sub)) {
        if (key.includes('password')) continue; // passwords belong on Credentials
        flat[target + '_' + key] = value;
      }
    }
    return flat;
  }

  // Unknown section: serve its raw config data so dynamically registered
  // sections (e.g. callback) populate their cards instead of rendering
  // empty. Nested objects are skipped by buildFields.
  return toPlain(config[sectionId]);
}

function isStatePopulated() {
  if (!window.state) return false;
  if (window.state.populated !== undefined) {
    return Boolean(window.state.populated);
  }
  if (typeof window.state.keys === 'function') {
    return window.state.keys().length > 0;
  }
  return false;
}

function titleCase(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Adaptive field building (same approach as giveaway/settings.js)
// ---------------------------------------------------------------------------

function buildFields(sectionId, data) {
  const fields = [];
  const metaSection = FIELD_META[sectionId] || {};

  for (const [key, value] of Object.entries(data || {})) {
    const meta = metaSection[key] || {};

    if (meta.hidden || meta.excluded) continue;
    if (key.startsWith('__')) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;

    const type =
      sectionId === 'role_ids' || DISCORD_CHANNEL_ID_KEYS.has(key)
        ? 'text'
        : typeof value === 'boolean'
          ? 'toggle'
          : typeof value === 'number'
            ? 'number'
            : 'text';

    fields.push({
      id: key,
      label: meta.label || titleCase(key),
      hint: meta.hint || '',
      type,
      value,
    });
  }

  return fields;
}

function createFieldRow(sectionId, field) {
  const row = document.createElement('div');
  row.className = 'cfg-row';
  row.dataset.section = sectionId;
  row.dataset.key = field.id;

  const labelWrap = document.createElement('div');
  labelWrap.className = 'cfg-row__label';

  const label = document.createElement('strong');
  label.textContent = field.label;
  labelWrap.appendChild(label);

  if (field.hint) {
    const hint = document.createElement('span');
    hint.textContent = field.hint;
    labelWrap.appendChild(hint);
  }

  row.appendChild(labelWrap);

  const control = document.createElement('div');
  control.className = 'cfg-row__control';

  const input = document.createElement('input');
  input.id = `config-field-${sectionId}-${field.id}`;
  input.dataset.section = sectionId;
  input.dataset.key = field.id;
  input.dataset.type = field.type;
  input.dataset.original = String(field.value);

  if (field.type === 'toggle') {
    input.type = 'checkbox';
    input.className = 'cfg-toggle';
    input.checked = Boolean(field.value);
    input.addEventListener('change', () => {
      input.dataset.userEdited = '1';
      refreshDirtyState();
    });
  } else {
    input.type = field.type === 'number' ? 'number' : 'text';
    input.className = 'cfg-input';
    input.value = String(field.value);
    if (field.type === 'number') input.step = 'any';
    if (sectionId === 'settings' && field.id === 'timezone') {
      input.readOnly = true;
      input.classList.add('cfg-input--picker');
      input.setAttribute('aria-haspopup', 'dialog');
      input.addEventListener('click', () => openTimezonePicker(input));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openTimezonePicker(input);
        }
      });
    }
    input.addEventListener('input', () => {
      input.dataset.userEdited = '1';
      refreshDirtyState();
    });
  }

  control.appendChild(input);
  row.appendChild(control);
  return row;
}

function openTimezonePicker(input) {
  const modal = document.getElementById('config-timezone-modal');
  const search = document.getElementById('config-timezone-search');
  const list = document.getElementById('config-timezone-list');
  if (!modal || !search || !list) return;

  const renderOptions = () => {
    const query = search.value.trim().toLowerCase();
    list.innerHTML = '';
    const options = input.value && !TIMEZONE_OPTIONS.includes(input.value)
      ? [input.value, ...TIMEZONE_OPTIONS]
      : TIMEZONE_OPTIONS;
    const matches = options.filter((zone) => zone.toLowerCase().includes(query));
    for (const zone of matches) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'cfg-timezone-option';
      option.classList.toggle('is-selected', zone === input.value);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(zone === input.value));
      option.textContent = zone;
      option.addEventListener('click', () => {
        input.value = zone;
        input.dataset.userEdited = '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        closeTimezonePicker();
      });
      list.appendChild(option);
    }
    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'cfg-timezone-empty';
      empty.textContent = 'No matching timezones.';
      list.appendChild(empty);
    }
  };

  const closeOnEscape = (event) => {
    if (event.key === 'Escape') closeTimezonePicker();
  };
  modal._timezoneEscapeHandler = closeOnEscape;
  document.addEventListener('keydown', closeOnEscape);
  modal.classList.remove('hidden');
  search.value = '';
  search.addEventListener('input', renderOptions);
  modal._timezoneSearchHandler = renderOptions;
  renderOptions();
  requestAnimationFrame(() => search.focus());
}

function closeTimezonePicker() {
  const modal = document.getElementById('config-timezone-modal');
  const search = document.getElementById('config-timezone-search');
  if (!modal) return;
  modal.classList.add('hidden');
  if (modal._timezoneEscapeHandler) document.removeEventListener('keydown', modal._timezoneEscapeHandler);
  if (search && modal._timezoneSearchHandler) search.removeEventListener('input', modal._timezoneSearchHandler);
  delete modal._timezoneEscapeHandler;
  delete modal._timezoneSearchHandler;
}

function bindTimezonePicker() {
  document.getElementById('config-timezone-close')?.addEventListener('click', closeTimezonePicker);
  document.getElementById('config-timezone-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'config-timezone-modal') closeTimezonePicker();
  });
}

function renderSection(section) {
  const container = document.getElementById(section.containerId);
  if (!container) return;

  const data = getSectionData(section.id);
  const fields = buildFields(section.id, data)

  if (section.dynamic) {
    const card = container.closest('.cfg-card');
    if (card) card.style.display = fields.length === 0 ? 'none' : '';
  }

  // Database section: split fields into Local/Cloud subgroups
  if (section.id === 'database') {
    const subgroups = {
      local: fields.filter((f) => f.id.startsWith('local_')),
      cloud: fields.filter((f) => f.id.startsWith('cloud_')),
    };
    for (const target of ['local', 'cloud']) {
      const subgroupEl = container.querySelector(`.cfg-subgroup[data-subgroup="${target}"]`);
      const fieldsEl = document.getElementById(`config-database-${target}-fields`);
      if (!fieldsEl) continue;
      fieldsEl.innerHTML = '';
      // Hide the subgroup entirely if it has no fields
      if (subgroupEl) subgroupEl.style.display = subgroups[target].length === 0 ? 'none' : '';
      for (const field of subgroups[target]) {
        fieldsEl.appendChild(createFieldRow(section.id, field));
      }
    }
    return;
  }

  // Other sections: clear and rebuild
  container.innerHTML = '';
  for (const field of fields) {
    container.appendChild(createFieldRow(section.id, field));
  }
}

function renderAllSections() {
  syncDynamicSections();
  for (const section of SECTIONS) {
    renderSection(section);
  }
  lastFieldSignature = computeFieldSignature();
}

// Stable signature of which fields exist per section (id + type). Used to
// detect server-side additions/removals without wiping user edits blindly.
function computeFieldSignature() {
  syncDynamicSections();
  const parts = [];
  for (const section of SECTIONS) {
    const data = getSectionData(section.id);
    const fields = buildFields(section.id, data)
    for (const field of fields) {
      parts.push(`${section.id}:${field.id}:${field.type}`);
    }
  }
  return parts.join('|');
}

// ---------------------------------------------------------------------------
// Collection / diffing
// ---------------------------------------------------------------------------

// Read the current input values for one section back into a plain object.
function collectSectionValues(sectionId) {
  const container = document.getElementById(`config-${sectionId}-fields`);
  const values = {};
  if (!container) return values;

  container.querySelectorAll('input').forEach((input) => {
    const key = input.dataset.key;
    if (!key) return;

    if (input.type === 'checkbox') {
      values[key] = input.checked;
      return;
    }

    if (input.dataset.type === 'number' && !DISCORD_CHANNEL_ID_KEYS.has(key)) {
      // Empty/invalid numbers keep the last synced value so a stray
      // keystroke can never silently wipe a setting.
      const parsed = Number(input.value);
      values[key] =
        input.value === '' || Number.isNaN(parsed)
          ? Number(input.dataset.original)
          : parsed;
      return;
    }

    values[key] = input.value;
  });

  return values;
}

// Collect all rendered sections.
function snapshotCurrentValues() {
  const snapshot = {};
  for (const section of SECTIONS) {
    snapshot[section.id] = collectSectionValues(section.id);
  }
  return snapshot;
}

// The values the page currently considers "synced with the server".
function lastSyncedValues() {
  const synced = {};
  for (const section of SECTIONS) {
    const values = {};
    const data = getSectionData(section.id);
    const fields = buildFields(section.id, data)
    for (const field of fields) {
      values[field.id] = field.value;
    }
    synced[section.id] = values;
  }
  return synced;
}

// Diff current inputs against the given baseline. Returns
// { changed: { twitch: {...}, loyalty: {...} }, current: {...} } where the
// changed map contains only the sections/keys whose value differs.
function computeChanged(baseline) {
  const changed = {};
  const current = snapshotCurrentValues();

  for (const section of SECTIONS) {
    const sectionChanged = {};
    for (const [key, value] of Object.entries(current[section.id] || {})) {
      if (value !== (baseline[section.id] || {})[key]) {
        sectionChanged[key] = value;
      }
    }
    if (Object.keys(sectionChanged).length > 0) {
      changed[section.id] = sectionChanged;
    }
  }

  return { changed, current };
}

function hasUnsavedEdits() {
  const { changed } = computeChanged(lastSyncedValues());
  return Object.keys(changed).length > 0;
}

// Push live server values into inputs the user has not touched (and is not
// typing in). Edited inputs keep their user value until Save or Revert.
function applyRemoteValues() {
  for (const section of SECTIONS) {
    const container = document.getElementById(section.containerId);
    if (!container) continue;

    const data = getSectionData(section.id);
    const fields = buildFields(section.id, data)
    const byId = new Map(fields.map((f) => [f.id, f]));

    container.querySelectorAll('input').forEach((input) => {
      const field = byId.get(input.dataset.key);
      if (!field) return; // key disappeared server-side; handled by rebuild
      if (input === document.activeElement) return;
      if (input.dataset.userEdited === '1') return;

      if (field.type === 'toggle') {
        input.checked = Boolean(field.value);
      } else {
        input.value = String(field.value);
      }
      input.dataset.original = String(field.value);
    });
  }
}

// ---------------------------------------------------------------------------
// Dirty-state UI
// ---------------------------------------------------------------------------

function refreshDirtyState() {
  const saveButton = document.getElementById('config-save');
  const revertButton = document.getElementById('config-revert');
  const statusLabel = document.getElementById('config-status');
  if (!saveButton) return;

  if (!isStatePopulated()) {
    saveButton.disabled = true;
    if (revertButton) revertButton.disabled = true;
    if (statusLabel) {
      statusLabel.classList.remove('is-dirty');
      statusLabel.textContent = 'Not connected to the bot server.';
    }
    return;
  }

  const baseline = lastSyncedValues();
  const { changed } = computeChanged(baseline);
  const changeCount = Object.values(changed)
    .reduce((sum, keys) => sum + Object.keys(keys).length, 0);
  const isDirty = changeCount > 0;

  saveButton.disabled = !isDirty || saveButton.dataset.saving === '1';
  if (revertButton) revertButton.disabled = !isDirty;

  // Highlight rows whose current value differs from the baseline.
  for (const section of SECTIONS) {
    const container = document.getElementById(section.containerId);
    if (!container) continue;

    const sectionChanges = changed[section.id] || {};
    container.querySelectorAll('.cfg-row').forEach((row) => {
      const key = row.dataset.key;
      row.classList.toggle('is-dirty', key in sectionChanges);
    });
  }

  if (statusLabel) {
    statusLabel.classList.toggle('is-dirty', isDirty);
    statusLabel.textContent = isDirty
      ? `${changeCount} unsaved change${changeCount === 1 ? '' : 's'}.`
      : 'Configuration is in sync with the server.';
  }
}

// ---------------------------------------------------------------------------
// Toast (same behavior as the giveaway settings toast, own element)
// ---------------------------------------------------------------------------

const TOAST_ICONS = { info: 'i', success: 'OK', warning: '!', error: 'X' };
let toastTimer = null;

function showToast(message, tone = 'info') {
  let toast = document.getElementById('config-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'config-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<div class="config-toast__content">' +
      '<div class="config-toast__icon"></div>' +
      '<div class="config-toast__text"><strong></strong><span></span></div>' +
      '</div>';
    document.body.appendChild(toast);
  }

  const titles = {
    info: 'Info',
    success: 'Saved',
    warning: 'Warning',
    error: 'Error',
  };

  toast.className = `config-toast--${tone}`;
  toast.querySelector('.config-toast__icon').textContent = TOAST_ICONS[tone] || 'i';
  toast.querySelector('.config-toast__text strong').textContent = titles[tone] || 'Info';
  toast.querySelector('.config-toast__text span').textContent = message;

  toast.classList.add('is-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

// ---------------------------------------------------------------------------
// Save / Revert
// ---------------------------------------------------------------------------

// Rebuild the nested { local: {...}, cloud: {...} } config.json structure from
// the flattened keys rendered on this page. Returns null when nothing maps.
function unflattenDatabase(flat) {
  const nested = {};
  for (const [key, value] of Object.entries(flat || {})) {
    const splitAt = key.indexOf('_');
    const target = key.slice(0, splitAt);
    const field = key.slice(splitAt + 1);
    if (target !== 'local' && target !== 'cloud') continue;
    if (!nested[target]) nested[target] = {};
    nested[target][field] = value;
  }
  return Object.keys(nested).length > 0 ? nested : null;
}

async function handleSave() {
  const saveButton = document.getElementById('config-save');
  if (!saveButton || saveButton.dataset.saving === '1') return;

  const baseline = lastSyncedValues();
  const { changed } = computeChanged(baseline);

  // The database section is collected flattened (local_host, cloud_sslmode,
  // ...); convert it back to the nested config.json structure for the server
  // deep-merge.
  if (changed.database) {
    const nestedDatabase = unflattenDatabase(changed.database);
    if (nestedDatabase) changed.database = nestedDatabase;
    else delete changed.database;
  }

  if (Object.keys(changed).length === 0) {
    showToast('No changes to save.', 'info');
    return;
  }

  const connection = window.connection;
  const bridge = connection && connection.getBridge ? connection.getBridge() : null;

  if (!bridge || !(connection && connection.isConnected())) {
    showToast('Not connected to server.', 'warning');
    return;
  }

  saveButton.dataset.saving = '1';
  saveButton.disabled = true;
  saveButton.textContent = 'Saving...';

  try {
    const response = await bridge.sendWithResponse('save_config', {
      data: changed,
    });

    if (response && response.ok) {
      clearUserEditedFlags();
      showToast(`Config saved (${Object.keys(changed).join(', ')}).`, 'success');
    } else {
      showToast((response && response.error) || 'Failed to save config.', 'error');
    }
  } catch (error) {
    console.error('[Config] Save error:', error);
    showToast('Failed to save config.', 'error');
  } finally {
    delete saveButton.dataset.saving;
    saveButton.textContent = 'Save Config';
    refreshDirtyState();
  }
}

function handleRevert() {
  clearUserEditedFlags();
  applyRemoteValues();
  refreshDirtyState();
  showToast('Changes reverted.', 'info');
}

function clearUserEditedFlags() {
  for (const section of SECTIONS) {
    const container = document.getElementById(section.containerId);
    if (!container) continue;
    container.querySelectorAll('input').forEach((input) => {
      delete input.dataset.userEdited;
    });
  }
}

// ---------------------------------------------------------------------------
// State updates / page lifecycle
// ---------------------------------------------------------------------------

let lastFieldSignature = '';

function handleStateUpdate() {
  if (!isStatePopulated()) {
    // Keep whatever is on screen; the empty state is handled on activation.
    return;
  }

  const signature = computeFieldSignature();
  const dirty = hasUnsavedEdits();

  if (signature !== lastFieldSignature) {
    if (!dirty) {
      // Safe to rebuild: no user edits to lose.
      renderAllSections();
    }
    // If dirty, keep the current rows; the new keys will show up on the
    // next activation or after Save/Revert.
  } else {
    applyRemoteValues();
  }

  refreshDirtyState();
}

window.pageControllers.config = function () {
  // Node-safe rebinding (the dashboard force-reloads pages by replacing the
  // DOM; old nodes are gone and removing listeners from them is harmless).
  const saveButton = document.getElementById('config-save');
  const revertButton = document.getElementById('config-revert');
  bindTimezonePicker();

  const bindConfigHeaderActions = () => {
    document.getElementById('config-save')?.addEventListener('click', handleSave);
    document.getElementById('config-revert')?.addEventListener('click', handleRevert);
    refreshDirtyState();
  };

  const publishConfigHeader = () => {
    document.dispatchEvent(new CustomEvent('page:header', {
      detail: {
        title: 'Config',
        subtitle: 'Configuration categories and runtime options.',
        actionsHtml: '<button class="ghost-button" type="button" id="config-revert" disabled>Revert</button><button class="primary-button" type="button" id="config-save" disabled>Save Config</button>',
        bindHeaderActions: bindConfigHeaderActions,
      },
    }));
  };

  if (window.pageControllers.__configSaveHandler) {
    if (saveButton) saveButton.removeEventListener('click', window.pageControllers.__configSaveHandler);
  }
  if (window.pageControllers.__configRevertHandler) {
    if (revertButton) revertButton.removeEventListener('click', window.pageControllers.__configRevertHandler);
  }

  window.pageControllers.__configSaveHandler = handleSave;
  window.pageControllers.__configRevertHandler = handleRevert;
  if (saveButton) saveButton.addEventListener('click', handleSave);
  if (revertButton) revertButton.addEventListener('click', handleRevert);

  // State subscription -- stored and cleaned up so re-evaluating this script
  // never stacks duplicate listeners.
  if (window.state && window.state.subscribe) {
    if (typeof window.pageControllers.__configUnsubscribe === 'function') {
      window.pageControllers.__configUnsubscribe();
    }
    window.pageControllers.__configUnsubscribe = window.state.subscribe(handleStateUpdate);
  }

  // Page activation -- refresh from the latest state every time the page is
  // shown (values may have changed while another tab was open).
  const handleActivate = (ev) => {
    if (!ev.detail || ev.detail.pageId !== 'config') return;
    publishConfigHeader();
    if (isStatePopulated()) {
      const signature = computeFieldSignature();
      if (signature !== lastFieldSignature && !hasUnsavedEdits()) {
        renderAllSections();
      } else {
        applyRemoteValues();
      }
    } else {
      renderAllSections(); // renders nothing; shows the empty state
    }
    refreshDirtyState();
  };

  if (window.pageControllers.__configActivateHandler) {
    document.removeEventListener('page:activate', window.pageControllers.__configActivateHandler);
  }
  document.addEventListener('page:activate', handleActivate);
  window.pageControllers.__configActivateHandler = handleActivate;

  // Initial render.
  renderAllSections();
  refreshDirtyState();
};

// Bootstrap -- same connection fallback as the giveaway page for direct access.
async function initConfigPage() {
  if (!window.state || !window.connection) {
    try {
      const connectionModule = await import('../../js/connection/connection.js');
      const stateModule = await import('../../js/connection/state.js');

      connectionModule.configureConnection(
        connectionModule.getDefaultConnectionUrl()
      );
      connectionModule.startConnection();

      window.connection = {
        getBridge: connectionModule.getBridge,
        isConnected: () => (connectionModule.getBridge() ? connectionModule.getBridge().connected : false),
      };
      window.state = stateModule.state;
    } catch (error) {
      console.error('[Config] Failed to initialize connection:', error);
    }
  }

  window.pageControllers.config();
}

initConfigPage();
})();

