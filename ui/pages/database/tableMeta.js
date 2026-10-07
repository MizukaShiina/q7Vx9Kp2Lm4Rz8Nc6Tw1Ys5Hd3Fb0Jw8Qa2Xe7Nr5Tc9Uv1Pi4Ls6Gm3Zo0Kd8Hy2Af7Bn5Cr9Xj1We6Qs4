// tableMeta.js
//
// Display metadata for the Database page's table list: what order the tables
// appear in, what they are called, and which ones are protected behind a
// reveal gate.
//
// Ordering follows this map's key order, so what you write is what you see.
// Tables that are NOT listed here are appended at the BOTTOM, alphabetically,
// using their raw name as the label — the schema grows and tables can be created
// from this page, so an unlisted table must never disappear from the list.
//
// Adding an entry:
//   ga_pity: { label: 'Giveaway Pity', confidential: false, newestFirst: true }
//
//   label         Display name shown in the list and header. Defaults to the
//                 raw table name. The raw name is still what selects, reads and
//                 writes — the label is display-only.
//   confidential  Selecting the table shows a reveal gate instead of its rows.
//                 An accident guard for stream use, NOT a security boundary:
//                 the rows are in the snapshot either way, so devtools sees them.
//   newestFirst   Render the rows in reverse so inserts land at the top. Exact
//                 while the table is inside the snapshot row cap; beyond it the
//                 newest rows may not be in the fetched window at all.
//   note          Optional sentence shown on the gate plaque.
//
// Exposed as window.dbTableMeta.

(function () {
  'use strict';

  const TABLE_META = {
    // --- players -------------------------------------------------------------
    users:               { label: 'Users',               confidential: true, note: 'Platform UIDs, usernames and account links.' },
    user_stats:          { label: 'User Stats',          confidential: true },
    game_accounts:       { label: 'Game Accounts',       confidential: true},
    ga_pity:             { label: 'Giveaway Pity',       confidential: false },
    winners:             { label: 'Giveaway Winners',    confidential: false, newestFirst: true },
    twitch_user_data:    { label: 'Twitch User Data',    confidential: true },
    verification:        { label: 'Verification',        confidential: true, newestFirst: true, note: 'Discord members currently in the OTP flow.' },
    // --- store ---------------------------------------------------------------
    store_products:      { label: 'Store Products',      confidential: false },
    store_order:         { label: 'Store Orders',        confidential: true, newestFirst: true },
    store_messages:      { label: 'Store Messages',      confidential: true, newestFirst: true },
    wallet_transactions: { label: 'Wallet Transactions', confidential: true, newestFirst: true },

    oauth_tokens:        { label: 'Oauth Tokens',        confidential: true, note: 'Do not open this table if not needed. specially on stream'},
  };

  // table name -> position in the map above. Built once so a sort comparison is
  // two Map lookups rather than a fresh Object.keys() walk.
  const POSITION = new Map(Object.keys(TABLE_META).map((name, index) => [name, index]));
  const UNLISTED = Number.MAX_SAFE_INTEGER;

  function has(tableName) {
    return Object.prototype.hasOwnProperty.call(TABLE_META, tableName);
  }

  function metaFor(tableName) {
    const table = String(tableName ?? '');
    const configured = TABLE_META[table] || {};
    return {
      table,
      // Unlisted tables keep their raw name so nothing renders blank.
      label: configured.label || table,
      confidential: configured.confidential === true,
      newestFirst: configured.newestFirst === true,
      note: configured.note || '',
      configured: has(table),
    };
  }

  function isConfidential(tableName) {
    return metaFor(tableName).confidential;
  }

  // Config order first, then unlisted tables alphabetically. Non-mutating — the
  // caller's array is left alone even though getTables() hands us a fresh copy.
  function sortTables(names) {
    const list = Array.isArray(names)
      ? names.filter((name) => name !== null && name !== undefined && name !== '')
      : [];

    return [...list].sort((a, b) => {
      const aPos = POSITION.has(a) ? POSITION.get(a) : UNLISTED;
      const bPos = POSITION.has(b) ? POSITION.get(b) : UNLISTED;
      if (aPos !== bPos) return aPos - bPos;
      if (aPos === UNLISTED) return a < b ? -1 : (a > b ? 1 : 0);
      return 0;
    });
  }

  window.dbTableMeta = {
    TABLE_META,
    metaFor,
    isConfidential,
    sortTables,
    // Exposed for the .scratch harness only.
    _internals: { POSITION, UNLISTED },
  };
})();
