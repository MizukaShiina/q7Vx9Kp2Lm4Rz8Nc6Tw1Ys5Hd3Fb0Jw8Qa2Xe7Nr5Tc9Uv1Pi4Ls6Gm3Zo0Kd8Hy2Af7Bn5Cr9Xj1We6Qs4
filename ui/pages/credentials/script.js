/**
 * Credentials Page
 * Real page for credentials: tokens, secrets, API keys, connection details.
 * Adaptive rendering from live state.
 */

(function () {
  window.pageControllers = window.pageControllers || {};

let credentialsLiveOverride = false;

function refreshLiveGuard() {
  const guard = document.getElementById('creds-live-guard');
  if (!guard || credentialsLiveOverride) return;
  guard.hidden = window.state?.stream?.is_live !== true;
}

const TWITCH_EXCLUDED_KEYS = new Set([
  // Config-side keys: they live on the Config page, not here.
  'channel', 'bot_prefix', 'raid_command', 'irc_server', 'irc_port',
]);

const OBS_EXCLUDED_KEYS = new Set([
  // Config-side keys / runtime data: owned by the OBS page.
  'enabled', 'auto_switch', 'rules',
]);

const DISCORD_EXCLUDED_KEYS = new Set([
  // Message anchors are managed elsewhere; the discord channel IDs live in
  // config.json and are rendered on the Config page, never on this one.
  'verify_message_id',
]);

const DISCORD_ID_KEYS = new Set([
  'channel_id',
  'verify_channel_id',
  'claim_channel_id',
  'announce_channel_id',
  'bot_report_channel_id',
  'store_channel_id',
]);

// Sections that must NOT be rendered on this page even if they exist in the
// server's creds payload. Empty today -- add a section id here to suppress
// its card entirely (no card, no fields, nothing to save from this page).
const HIDDEN_SECTIONS = new Set([
  // 'youtube',
]);

const OAUTH_PREFIX_KEYS = new Set([
  'oauth_token', 'stream_oauth',
]);

  const FIELD_META = {
    _default: {
      oauth_token: {
        label: 'OAuth Token',
        hint: 'Twitch OAuth token (includes oauth: prefix)',
      },
      stream_oauth: {
        label: 'Stream OAuth',
        hint: 'OAuth token for stream actions (includes oauth: prefix)',
      },
      client_id: {
        label: 'Client ID',
      },
      client_secret: {
        label: 'Client Secret',
      },
      token: {
        label: 'Bot Token',
        hint: 'Discord bot token',
      },
      allowed_users: {
        label: 'Allowed User IDs',
        hint: 'Comma-separated Discord user IDs allowed to use the bot',
      },
      allowed_roles: {
        label: 'Allowed Role IDs',
        hint: 'Comma-separated Discord role IDs allowed to use the bot',
      },
      foxreload_api_key: {
        label: 'FoxReload API Key',
        hint: 'API key for the FoxReload provider service',
      },
      refresh_token: {
        label: 'Refresh Token',
        hint: 'Twitch refresh token (used to renew the OAuth token)',
      },
      stream_refresh_token: {
        label: 'Stream Refresh Token',
        hint: 'Refresh token used for stream actions',
      },
      redirect_uri: {
        label: 'Redirect URI',
      },
      channel_id: {
        label: 'Channel ID',
      },
      dropbox_token: {
        label: 'Access Token',
      },
      dropbox_refresh_token: {
        label: 'Refresh Token',
      },
      dropbox_app_key: {
        label: 'App Key',
      },
      dropbox_app_secret: {
        label: 'App Secret',
      },
      obs_host: {
        label: 'Host',
      },
      obs_port: {
        label: 'Port',
      },
      obs_password: {
        label: 'Password',
      },
      local_password: {
        label: 'Local Database Password',
        hint: 'Password for the local PostgreSQL server',
      },
      cloud_password: {
        label: 'Cloud Database Password',
        hint: 'Password for the cloud PostgreSQL server',
      },
    },

    twitch: {
      client_id: {
        hint: 'Twitch application client ID',
      },
      client_secret: {
        hint: 'Twitch application client secret',
      },
      refresh_token: {
        label: 'Refresh Token',
        hint: 'Twitch refresh token (used to renew the OAuth token)',
      },
      stream_refresh_token: {
        label: 'Stream Refresh Token',
        hint: 'Refresh token used for stream actions',
      },
    },

    discord: {
      token: {
        label: 'Bot Token',
        hint: 'Discord bot token',
      },
    },

    youtube: {
      client_id: {
        label: 'Client ID',
        hint: 'Google OAuth client ID',
      },
      client_secret: {
        label: 'Client Secret',
        hint: 'Google OAuth client secret',
      },
      redirect_uri: {
        label: 'Redirect URI',
        hint: 'OAuth redirect URI registered in the Google Cloud Console',
      },
      channel_id: {
        label: 'Channel ID',
        hint: 'YouTube channel ID the bot uploads to',
      },
    },

    tiktok: {
      client_key: {
        label: "TikTok Client Key",
        hint: "TikTok application client key",
      },
      client_secret: {
        label: "TikTok Client Secret",
        hint: "TikTok application client secret",
      },
      redirect_uri: {
        label: "Redirect URI",
        hint: "OAuth redirect URI registered in the TikTok Developer Console",
      }
    },

    instagram: {
      client_id: {
        label: 'Client ID',
        hint: 'Meta app ID (Business login for Instagram)',
      },
      client_secret: {
        label: 'Client Secret',
        hint: 'Meta app secret — used for the token exchange and webhook signature checks',
      },
      access_token: {
        label: 'Access Token',
        hint: 'Long-lived token for your own Instagram professional account (filled by Get Instagram Token)',
      },
      access_token_expires_at: {
        label: 'Expires At',
        hint: 'When the long-lived token expires, if recorded',
      },
      redirect_uri: {
        label: 'Redirect URI',
        hint: 'Must exactly match a registered OAuth redirect URI in the Meta App Dashboard',
      },
      webhook_url: {
        label: 'Webhook URL',
        hint: 'Meta webhook callback that receives the messages field',
      },
      webhook_verify_token: {
        label: 'Webhook Verify Token',
        hint: 'Compared with hub.verify_token during the subscription handshake',
      },
    },

    dropbox: {
      dropbox_token: {
        label: 'Access Token',
        hint: 'Dropbox access token (generated via Connect Dropbox)',
      },
      dropbox_refresh_token: {
        label: 'Refresh Token',
        hint: 'Dropbox refresh token (used to generate new access tokens)',
      },
      dropbox_app_key: {
        label: 'App Key',
        hint: 'Dropbox app key',
      },
      dropbox_app_secret: {
        label: 'App Secret',
        hint: 'Dropbox app secret',
      },
    },

    obs: {
      obs_host: {
        label: 'Host',
        hint: 'OBS WebSocket host address',
      },
      obs_port: {
        label: 'Port',
        hint: 'OBS WebSocket port',
      },
      obs_password: {
        label: 'Password',
        hint: 'OBS WebSocket password',
      },
    },
  };

const SECTIONS = [
  { id: 'database', containerId: 'creds-database-fields', excluded: new Set(['name', 'ready', 'local', 'cloud', 'password_configured']) },
  { id: 'twitch', containerId: 'creds-twitch-fields', excluded: TWITCH_EXCLUDED_KEYS },
  { id: 'discord', containerId: 'creds-discord-fields', excluded: DISCORD_EXCLUDED_KEYS },
  { id: 'provider', containerId: 'creds-provider-fields', excluded: new Set() },
  { id: 'dropbox', containerId: 'creds-dropbox-fields', excluded: new Set() },
  { id: 'obs', containerId: 'creds-obs-fields', excluded: OBS_EXCLUDED_KEYS },
];

function sectionTitle(sectionId) {
  return titleCase(sectionId);
}

function syncDynamicSections() {
  const creds = toPlain(window.state?.creds);
  for (const sectionId of Object.keys(creds)) {
    if (SECTIONS.some((section) => section.id === sectionId)) continue;
    if (HIDDEN_SECTIONS.has(sectionId)) continue;

    const containerId = `creds-${sectionId}-fields`;
    const container = document.getElementById(containerId) || document.createElement('div');
    if (!container.id) {
      container.id = containerId;
      container.className = 'cfg-fields';
      const card = document.createElement('div');
      card.className = 'cfg-card';
      card.innerHTML = `<div class="cfg-card__header"><div><p class="panel-label">${sectionTitle(sectionId)}</p><h4>${sectionTitle(sectionId)} credentials</h4></div></div>`;
      card.appendChild(container);
      document.getElementById('credentials-view')?.insertBefore(card, document.getElementById('creds-empty'));
    }
    SECTIONS.push({ id: sectionId, containerId, excluded: new Set() });
  }
}

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

function getSectionData(sectionId) {
  const state = window.state;
  if (!state) return {};

  if (HIDDEN_SECTIONS.has(sectionId)) return {};

  const creds = state.creds;
  if (!creds) return {};

  // Generic lookup: every section in the creds payload (twitch, discord,
  // provider, dropbox, obs, database, youtube, ...) is served straight from
  // state.creds[sectionId], so dynamically registered sections are no longer
  // stuck as empty cards.
  return toPlain(creds[sectionId]);
}

function isStatePopulated() {
  if (!window.state) return false;
  if (window.state.populated !== undefined) return Boolean(window.state.populated);
  if (typeof window.state.keys === 'function') return window.state.keys().length > 0;
  return false;
}

function titleCase(key) {
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function isSecretField(sectionId, key) {
  if (sectionId === 'twitch' || sectionId === 'provider' || sectionId === 'dropbox') return true;
  if (sectionId === 'youtube') return key === 'client_secret';
  if (sectionId === 'tiktok') return key === 'client_secret';
  // The Instagram verify token stays readable: it has to be copied into the
  // Meta App Dashboard.
  if (sectionId === 'instagram') return key === 'client_secret' || key === 'access_token';
  if (sectionId === 'discord') return key === 'token';
  if (sectionId === 'database') return key === 'password' || key.endsWith('_password');
  return sectionId === 'obs' && (key === 'password' || key === 'obs_password');
}

  function buildFields(data, excluded, sectionId) {
    const fields = [];

    for (const [key, value] of Object.entries(data || {})) {
      if (excluded && excluded.has(key)) continue;
      if (key.startsWith('__')) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === 'object' && !Array.isArray(value)) continue;

      let type = 'text';

      if (Array.isArray(value)) {
        type = 'array';
      } else if (typeof value === 'boolean') {
        type = 'toggle';
      } else if (
        typeof value === 'number' &&
        !(sectionId === 'discord' && DISCORD_ID_KEYS.has(key))
      ) {
        type = 'number';
      }

      const meta = {
        ...FIELD_META._default?.[key],
        ...FIELD_META[sectionId]?.[key],
      };

      fields.push({
        id: key,
        label: meta.label || titleCase(key),
        hint: meta.hint || '',
        type,
        secret: isSecretField(sectionId, key),
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
  let input;
  if (field.type === 'array') {
    input = document.createElement('textarea');
    input.className = 'cfg-textarea';
    input.rows = 2;
    input.value = Array.isArray(field.value) ? field.value.join(', ') : '';
    input.addEventListener('input', () => { input.dataset.userEdited = '1'; refreshDirtyState(); });
  } else if (field.type === 'toggle') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cfg-toggle';
    input.checked = Boolean(field.value);
    input.addEventListener('change', () => { input.dataset.userEdited = '1'; refreshDirtyState(); });
  } else {
    input = document.createElement('input');
    input.type = field.secret ? 'password' : (field.type === 'number' ? 'number' : 'text');
    input.className = 'cfg-input';
    input.value = String(field.value);
    if (field.type === 'number') input.step = 'any';
    input.addEventListener('input', () => { input.dataset.userEdited = '1'; refreshDirtyState(); });
  }
  input.id = 'creds-field-' + sectionId + '-' + field.id;
  input.dataset.section = sectionId;
  input.dataset.key = field.id;
  input.dataset.type = field.type;
  input.dataset.original = Array.isArray(field.value) ? field.value.join(', ') : String(field.value);
  control.appendChild(input);
  row.appendChild(control);
  return row;
}



function renderSection(section) {
  const container = document.getElementById(section.containerId);
  if (!container) return;
  const data = getSectionData(section.id);
  const fields = buildFields(data, section.excluded, section.id);
  container.innerHTML = '';
  for (const field of fields) container.appendChild(createFieldRow(section.id, field));
}

function renderAllSections() {
  syncDynamicSections();
  for (const section of SECTIONS) renderSection(section);
  lastFieldSignature = computeFieldSignature();
}

function computeFieldSignature() {
  syncDynamicSections();
  const parts = [];
  for (const section of SECTIONS) {
    const data = getSectionData(section.id);
    const fields = buildFields(data, section.excluded, section.id);
    for (const field of fields) parts.push(section.id + ':' + field.id + ':' + field.type);
  }
  return parts.join('|');
}

function collectSectionValues(sectionId) {
  const container = document.getElementById('creds-' + sectionId + '-fields');
  const values = {};
  if (!container) return values;
  container.querySelectorAll('input, textarea').forEach((input) => {
    const key = input.dataset.key;
    if (!key) return;
    if (input.type === 'checkbox') { values[key] = input.checked; return; }
    if (input.dataset.type === 'array') {
      values[key] = input.value.split(',').map((x) => x.trim()).filter(Boolean);
      return;
    }
    if (input.dataset.type === 'number') {
      const parsed = Number(input.value);
      values[key] = input.value === '' || Number.isNaN(parsed) ? Number(input.dataset.original) : parsed;
      return;
    }
    values[key] = input.value;
  });
  return values;
}

function snapshotCurrentValues() {
  const snapshot = {};
  for (const section of SECTIONS) snapshot[section.id] = collectSectionValues(section.id);
  return snapshot;
}

function lastSyncedValues() {
  const synced = {};
  for (const section of SECTIONS) {
    const values = {};
    const data = getSectionData(section.id);
    const fields = buildFields(data, section.excluded, section.id);
    for (const field of fields) {      values[field.id] = Array.isArray(field.value)        ? field.value.join(", ").split(",").map((x) => x.trim()).filter(Boolean)        : field.value;    }
    synced[section.id] = values;
  }
  return synced;
}

function computeChanged(baseline) {
  const changed = {};
  const current = snapshotCurrentValues();
  for (const section of SECTIONS) {
    const sectionChanged = {};
    for (const [key, value] of Object.entries(current[section.id] || {})) {
      const baselineValue = (baseline[section.id] || {})[key];
      const isChanged = Array.isArray(value) || Array.isArray(baselineValue)
        ? JSON.stringify(value) !== JSON.stringify(baselineValue)
        : value !== baselineValue;
      if (isChanged) sectionChanged[key] = value;
    }
    if (Object.keys(sectionChanged).length > 0) changed[section.id] = sectionChanged;
  }
  return { changed, current };
}

function hasUnsavedEdits() {
  const { changed } = computeChanged(lastSyncedValues());
  return Object.keys(changed).length > 0;
}

function applyRemoteValues() {
  for (const section of SECTIONS) {
    const container = document.getElementById(section.containerId);
    if (!container) continue;
    const data = getSectionData(section.id);
    const fields = buildFields(data, section.excluded, section.id);
    const byId = new Map(fields.map((f) => [f.id, f]));
    container.querySelectorAll('input, textarea').forEach((input) => {
      const field = byId.get(input.dataset.key);
      if (!field) return;
      if (input === document.activeElement) return;
      if (input.dataset.userEdited === '1') return;
      if (field.type === 'toggle') { input.checked = Boolean(field.value); }
      else if (field.type === 'array') { input.value = Array.isArray(field.value) ? field.value.join(', ') : ''; }
      else { input.value = String(field.value); }
      input.dataset.original = Array.isArray(field.value) ? field.value.join(', ') : String(field.value);
    });
  }
}
function refreshDirtyState() {
  const saveButton = document.getElementById("creds-save");
  const revertButton = document.getElementById("creds-revert");
  const statusLabel = document.getElementById("creds-status");
  if (!saveButton) return;
  if (!isStatePopulated()) {
    saveButton.disabled = true;
    if (revertButton) revertButton.disabled = true;
    if (statusLabel) {
      statusLabel.classList.remove("is-dirty");
      statusLabel.textContent = "Not connected to the bot server.";
    }
    return;
  }
  const baseline = lastSyncedValues();
  const { changed } = computeChanged(baseline);
  const changeCount = Object.values(changed).reduce((sum, keys) => sum + Object.keys(keys).length, 0);
  const isDirty = changeCount > 0;
  saveButton.disabled = !isDirty || saveButton.dataset.saving === "1";
  if (revertButton) revertButton.disabled = !isDirty;
  for (const section of SECTIONS) {
    const container = document.getElementById(section.containerId);
    if (!container) continue;
    const sectionChanges = changed[section.id] || {};
    container.querySelectorAll(".cfg-row").forEach((row) => {
      row.classList.toggle("is-dirty", row.dataset.key in sectionChanges);
    });
  }
  if (statusLabel) {
    statusLabel.classList.toggle("is-dirty", isDirty);
    statusLabel.textContent = isDirty
      ? changeCount + " unsaved change" + (changeCount === 1 ? "" : "s") + "."
      : "Credentials are in sync with the server.";
  }
}

const TOAST_ICONS = { info: "i", success: "OK", warning: "!", error: "X" };
let toastTimer = null;

function showToast(message, tone) {
  if (!tone) tone = "info";
  let toast = document.getElementById("creds-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "creds-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML =
      '<div class="creds-toast__content">' +
      '<div class="creds-toast__icon"></div>' +
      '<div class="creds-toast__text"><strong></strong><span></span></div>' +
      '</div>';
    document.body.appendChild(toast);
  }
  const titles = { info: "Info", success: "Saved", warning: "Warning", error: "Error" };
  toast.className = "creds-toast--" + tone;
  toast.querySelector(".creds-toast__icon").textContent = TOAST_ICONS[tone] || "i";
  toast.querySelector(".creds-toast__text strong").textContent = titles[tone] || "Info";
  toast.querySelector(".creds-toast__text span").textContent = message;
  toast.classList.add("is-visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function transformValues(values) {
  const transformed = {};
  for (const [key, value] of Object.entries(values)) {
    if (OAUTH_PREFIX_KEYS.has(key) && value && !value.startsWith("oauth:")) {
      transformed[key] = "oauth:" + value;
    } else {
      transformed[key] = value;
    }
  }
  return transformed;
}

async function handleSave() {
  const saveButton = document.getElementById("creds-save");
  if (!saveButton || saveButton.dataset.saving === "1") return;
  const baseline = lastSyncedValues();
  const { changed } = computeChanged(baseline);
  if (Object.keys(changed).length === 0) { showToast("No changes to save.", "info"); return; }
  const connection = window.connection;
  const bridge = connection && connection.getBridge ? connection.getBridge() : null;
  if (!bridge || !(connection && connection.isConnected())) { showToast("Not connected to server.", "warning"); return; }
  const transformedChanged = {};
  for (const [section, values] of Object.entries(changed)) {
    transformedChanged[section] = transformValues(values);
  }
  saveButton.dataset.saving = "1";
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";
  try {
    const response = await bridge.sendWithResponse("save_creds", { data: transformedChanged });
    if (response && response.ok) {
      clearUserEditedFlags();
      showToast("Credentials saved (" + Object.keys(transformedChanged).join(", ") + ").", "success");
    } else {
      showToast((response && response.error) || "Failed to save credentials.", "error");
    }
  } catch (error) {
    console.error("[Credentials] Save error:", error);
    showToast("Failed to save credentials.", "error");
  } finally {
    delete saveButton.dataset.saving;
    saveButton.textContent = "Save Credentials";
    refreshDirtyState();
  }
}

function handleRevert() {
  clearUserEditedFlags();
  applyRemoteValues();
  refreshDirtyState();
  showToast("Changes reverted.", "info");
}

function clearUserEditedFlags() {
  for (const section of SECTIONS) {
    const container = document.getElementById(section.containerId);
    if (!container) continue;
    container.querySelectorAll("input, textarea").forEach((input) => { delete input.dataset.userEdited; });
  }
}

let lastFieldSignature = "";

function handleStateUpdate() {
  if (!isStatePopulated()) return;
  const signature = computeFieldSignature();
  const dirty = hasUnsavedEdits();
  if (signature !== lastFieldSignature) { if (!dirty) renderAllSections(); }
  else { applyRemoteValues(); }
  refreshDirtyState();
}

window.pageControllers.credentials = function () {
  const saveButton = document.getElementById("creds-save");
  const revertButton = document.getElementById("creds-revert");
  const liveEnter = document.getElementById('creds-live-enter');
  liveEnter?.addEventListener('click', () => {
    credentialsLiveOverride = true;
    refreshLiveGuard();
  });
  const bindCredentialsHeaderActions = () => {
    document.getElementById("creds-save")?.addEventListener("click", handleSave);
    document.getElementById("creds-revert")?.addEventListener("click", handleRevert);
    refreshDirtyState();
  };
  const publishCredentialsHeader = () => {
    document.dispatchEvent(new CustomEvent("page:header", {
      detail: {
        title: "Credentials",
        subtitle: "Connected services and credential management.",
        actionsHtml: '<button class="ghost-button" type="button" id="creds-revert" disabled>Revert</button><button class="primary-button" type="button" id="creds-save" disabled>Save Credentials</button>',
        bindHeaderActions: bindCredentialsHeaderActions,
      },
    }));
  };
  if (window.pageControllers.__credsSaveHandler) {
    if (saveButton) saveButton.removeEventListener("click", window.pageControllers.__credsSaveHandler);
  }
  if (window.pageControllers.__credsRevertHandler) {
    if (revertButton) revertButton.removeEventListener("click", window.pageControllers.__credsRevertHandler);
  }
  window.pageControllers.__credsSaveHandler = handleSave;
  window.pageControllers.__credsRevertHandler = handleRevert;
  if (saveButton) saveButton.addEventListener("click", handleSave);
  if (revertButton) revertButton.addEventListener("click", handleRevert);
  if (window.state && window.state.subscribe) {
    if (typeof window.pageControllers.__credsUnsubscribe === "function") window.pageControllers.__credsUnsubscribe();
    window.pageControllers.__credsUnsubscribe = window.state.subscribe(() => {
      handleStateUpdate();
      refreshLiveGuard();
    });
  }
  const handleActivate = (ev) => {
    if (!ev.detail || ev.detail.pageId !== "credentials") return;
    publishCredentialsHeader();
    refreshLiveGuard();
    if (isStatePopulated()) {
      const signature = computeFieldSignature();
      if (signature !== lastFieldSignature && !hasUnsavedEdits()) renderAllSections();
      else applyRemoteValues();
    } else { renderAllSections(); }
    refreshDirtyState();
  };
  if (window.pageControllers.__credsActivateHandler) {
    document.removeEventListener("page:activate", window.pageControllers.__credsActivateHandler);
  }
  document.addEventListener("page:activate", handleActivate);
  window.pageControllers.__credsActivateHandler = handleActivate;
  renderAllSections();
  refreshDirtyState();
  refreshLiveGuard();
};

async function initCredsPage() {
  if (!window.state || !window.connection) {
    try {
      const connectionModule = await import("../../js/connection/connection.js");
      const stateModule = await import("../../js/connection/state.js");
      connectionModule.configureConnection(connectionModule.getDefaultConnectionUrl());
      connectionModule.startConnection();
      window.connection = {
        getBridge: connectionModule.getBridge,
        isConnected: () => (connectionModule.getBridge() ? connectionModule.getBridge().connected : false),
      };
      window.state = stateModule.state;
    } catch (error) {
      console.error("[Credentials] Failed to initialize connection:", error);
    }
  }
  window.pageControllers.credentials();
}

initCredsPage();
})();


