// postgre.js
//
// Direct-PostgreSQL data layer for the Database page (and the Overview DB chip).
//
// Responsibilities:
// - Load the whole database snapshot via window.dbAPI (Electron main process,
//   which owns the cloud -> local -> 5s-poll connection manager in db.js).
// - Report connection status (cloud / local / reconnecting / server snapshot).
// - Write path: row-level insert/update/delete and table create/drop, all
//   forwarded to window.dbAPI (validated + parameterized in db.js).
//
// Browser fallback: when window.dbAPI is absent (plain `start.bat` dev mode)
// it degrades to the WebSocket-pushed window.state.database_runtime snapshot,
// matching the rest of the app's browser compatibility pattern.

(function () {
  'use strict';

  // Guard against double evaluation (both the Database and Overview pages
  // preload this file through the dashboard's preScripts support).
  if (window.postgreDB) return;

  const statusListeners = [];
  let currentStatus = { status: 'reconnecting', source: null, label: 'Reconnecting' };
  let statusInitialized = false;

  const usingDirect = Boolean(window.dbAPI);
  console.log(
    `[postgreDB] direct mode: ${usingDirect ? 'ON (Electron main -> Postgres)' : 'OFF (WebSocket server snapshot fallback)'}`
  );

  function normalizeStatus(raw) {
    const input = raw || {};
    let status = input.status || 'reconnecting';
    let label = input.label;
    if (!label) {
      if (status === 'cloud') label = 'Cloud';
      else if (status === 'local') label = 'Local';
      else if (status === 'websocket') label = 'Server snapshot';
      else label = 'Reconnecting';
    }
    return Object.assign({}, input, { status, label });
  }

  function emitStatus(next) {
    currentStatus = normalizeStatus(next);
    statusInitialized = true;
    for (const listener of statusListeners) {
      try {
        listener(currentStatus);
      } catch (e) {
        console.error('[postgreDB] status listener error', e);
      }
    }
    window.dispatchEvent(new CustomEvent('postgre:status', { detail: currentStatus }));
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  // Fetch the whole database. Resolves:
  //   { ok, fetchedAt, status, databases: [{ database, tables, table_data }] }
  // The `databases` shape is identical to the legacy server snapshot, so page
  // renderers need no changes.
  async function load(force = false) {
    if (usingDirect) {
      try {
        return await window.dbAPI.getSnapshot(force);
      } catch (err) {
        return {
          ok: false,
          error: String((err && err.message) || err),
          databases: [],
        };
      }
    }

    // Browser fallback — the server-pushed live state.
    const runtime = window.state && window.state.database_runtime;
    const databases = Array.isArray(runtime && runtime.databases)
      ? runtime.databases
      : [];
    return {
      ok: databases.length > 0,
      source: 'websocket',
      fallback: true,
      fetchedAt: (window.state && window.state.fetchedAt) || Date.now(),
      databases,
    };
  }

  // Writes are only possible in direct (Electron) mode; the browser fallback
  // stays read-only because the WebSocket server snapshot has no write path.
  function requireDirect(action) {
    if (!usingDirect) {
      return Promise.resolve({
        ok: false,
        error: 'Writes are only available inside the Electron app.',
      });
    }
    return action();
  }

  // Legacy combined writer: `{ values, where }` -> UPDATE, no where -> INSERT.
  function save(table, payload) {
    return requireDirect(() => window.dbAPI.save(table, payload));
  }

  function insertRow(table, values) {
    return requireDirect(() => window.dbAPI.insertRow(table, values));
  }

  function updateRows(table, values, where) {
    return requireDirect(() => window.dbAPI.updateRows(table, values, where));
  }

  function deleteRows(table, where) {
    return requireDirect(() => window.dbAPI.deleteRows(table, where));
  }

  function createTable(name, columns) {
    return requireDirect(() => window.dbAPI.createTable(name, columns));
  }

  function dropTable(name, options) {
    return requireDirect(() => window.dbAPI.dropTable(name, options));
  }

  function getStatus() {
    return currentStatus;
  }

  function onStatusChange(callback) {
    statusListeners.push(callback);
    if (statusInitialized) {
      try {
        callback(currentStatus);
      } catch (e) {
        /* ignore */
      }
    }
    return () => {
      const index = statusListeners.indexOf(callback);
      if (index !== -1) statusListeners.splice(index, 1);
    };
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  if (usingDirect) {
    window.dbAPI.onStatusChange(emitStatus);
    window.dbAPI
      .getStatus()
      .then(emitStatus)
      .catch(() => {});
  } else if (window.state && window.state.subscribe) {
    window.state.subscribe(() => emitStatus({ status: 'websocket', source: 'websocket' }));
    emitStatus({ status: 'websocket', source: 'websocket' });
  }

  window.postgreDB = {
    load,
    save,
    insertRow,
    updateRows,
    deleteRows,
    createTable,
    dropTable,
    getStatus,
    onStatusChange,
    isDirect: () => usingDirect,
  };
})();
