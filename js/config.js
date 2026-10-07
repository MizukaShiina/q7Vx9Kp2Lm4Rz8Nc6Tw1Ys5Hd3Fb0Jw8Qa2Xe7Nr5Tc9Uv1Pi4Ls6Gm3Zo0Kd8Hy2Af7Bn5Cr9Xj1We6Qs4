// WebUI/js/config.js
//
// Single source of truth for the WebUI's direct-PostgreSQL settings.
//
// Works in two environments:
//   - Electron main process:  const cfg = require('./WebUI/js/config.js');
//   - Renderer (classic script): window.MizuDbConfig
//
// Resolution order (highest priority first):
//   1. Environment variables
//        MIZUBOT_DB_CLOUD_URL
//        MIZUBOT_DB_LOCAL_URL
//   2. Roaming config file (Windows):
//        %APPDATA%\MizuBot\TwitchBot\db_config.json
//        {
//          "cloud_url": "",
//          "local_url": "",
//          "row_cap": 2000,
//          "poll_interval_ms": 5000
//        }
//   3. Defaults — empty strings.
//
// An empty URL means "not configured". The connection manager (db.js) then
// simply keeps polling until one of the two becomes reachable. Nothing in
// this file is displayed in the site UI.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.MizuDbConfig = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const ENV_CLOUD = 'MIZUBOT_DB_CLOUD_URL';
  const ENV_LOCAL = 'MIZUBOT_DB_LOCAL_URL';

  const DEFAULTS = {
    cloud_url: '',
    local_url: '',
    row_cap: 2000,
    poll_interval_ms: 5000,
  };

  // ---------------------------------------------------------------------------
  // Node-only helpers (Electron main process). The renderer has neither
  // `require` nor `process`, so these degrade to inert no-ops there.
  // ---------------------------------------------------------------------------

  function isNode() {
    try {
      return (
        typeof process !== 'undefined' &&
        process.versions &&
        typeof process.versions.node === 'string' &&
        typeof require === 'function'
      );
    } catch (e) {
      return false;
    }
  }

  function roamingDir() {
    if (!isNode()) return '';
    const path = require('path');
    const os = require('os');
    const appData =
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'MizuBot', 'TwitchBot');
  }

  function configFile() {
    if (!isNode()) return '';
    return require('path').join(roamingDir(), 'db_config.json');
  }

  function readRoamingConfig() {
    if (!isNode()) return {};
    try {
      const fs = require('fs');
      const file = configFile();
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (e) {
      console.warn('[Config] Could not read db_config.json:', e.message);
    }
    return {};
  }

  // Create the starter roaming config file (empty URLs) on first run so the
  // user only has to fill in their connection strings.
  function ensureRoamingFile() {
    if (!isNode()) return '';
    const fs = require('fs');
    const file = configFile();
    try {
      const dir = roamingDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
        console.log('[Config] Created starter config:', file);
      }
    } catch (e) {
      console.warn('[Config] Could not create db_config.json:', e.message);
    }
    return file;
  }

  // ---------------------------------------------------------------------------
  // Resolution — env > roaming file > defaults
  // ---------------------------------------------------------------------------

  function resolve() {
    const env = isNode() ? process.env || {} : {};
    const file = readRoamingConfig();

    const pickUrl = (envKey, fileKey) =>
      String(env[envKey] || file[fileKey] || DEFAULTS[fileKey] || '').trim();

    const rowCapRaw = Number(file.row_cap);
    const pollRaw = Number(file.poll_interval_ms);

    return {
      cloudUrl: pickUrl(ENV_CLOUD, 'cloud_url'),
      localUrl: pickUrl(ENV_LOCAL, 'local_url'),
      rowCap:
        Number.isFinite(rowCapRaw) && rowCapRaw > 0
          ? Math.floor(rowCapRaw)
          : DEFAULTS.row_cap,
      pollIntervalMs:
        Number.isFinite(pollRaw) && pollRaw >= 1000
          ? Math.floor(pollRaw)
          : DEFAULTS.poll_interval_ms,
      roamingDir: roamingDir(),
      configFile: configFile(),
      envKeys: { cloud: ENV_CLOUD, local: ENV_LOCAL },
    };
  }

  return {
    ENV_CLOUD,
    ENV_LOCAL,
    DEFAULTS,
    resolve,
    ensureRoamingFile,
    roamingDir,
    configFile,
  };
});
