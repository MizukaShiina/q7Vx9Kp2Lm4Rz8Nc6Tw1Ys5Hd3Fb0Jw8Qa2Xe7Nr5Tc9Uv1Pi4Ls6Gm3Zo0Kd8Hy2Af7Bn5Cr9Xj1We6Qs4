window.pageControllers = window.pageControllers || {};
window.pageControllers.database = function () {
  const tableList = document.getElementById('database-table-list');
  const tableWrap = document.getElementById('database-table-wrap');
  const searchInput = document.getElementById('database-search');
  const status = document.getElementById('database-status');
  const databaseCount = document.getElementById('database-count');
  const tableCount = document.getElementById('database-table-count');
  const rowCount = document.getElementById('database-row-count');
  const selectedDatabase = document.getElementById('database-selected-database');
  const selectedTable = document.getElementById('database-selected-table');
  const tableToolbar = document.getElementById('database-table-toolbar');
  const rowToolbar = document.getElementById('database-row-toolbar');
  const addRowButton = document.getElementById('database-add-row');
  const deleteRowsButton = document.getElementById('database-delete-rows');
  const saveButton = document.getElementById('database-save-changes');
  const discardButton = document.getElementById('database-discard-changes');
  const newTableButton = document.getElementById('database-new-table');
  const dropTableButton = document.getElementById('database-drop-table');
  const feedback = document.getElementById('database-feedback');
  const modal = document.getElementById('database-modal');
  const modalTitle = document.getElementById('database-modal-title');
  const modalBody = document.getElementById('database-modal-body');
  const modalCancel = document.getElementById('database-modal-cancel');
  const modalConfirm = document.getElementById('database-modal-confirm');
  if (!tableList || !tableWrap) return;

  const pg = window.postgreDB || null;
  // Hover-identity overlay (userCard.js, loaded as a preScript). Resolves the
  // hovered row to a `users` record and fades a card over the details panel.
  const userCard = window.userCard || null;

  // Table list metadata (tableMeta.js, loaded as a preScript): display order,
  // labels and the confidential reveal gate. Degrades to pass-through behaviour
  // when the module is absent, so this page still runs on its own.
  const tableMeta = window.dbTableMeta || null;
  const metaFor = (tableName) => (tableMeta
    ? tableMeta.metaFor(tableName)
    : { table: String(tableName ?? ''), label: String(tableName ?? ''), confidential: false, newestFirst: false, note: '', configured: false });
  const sortTables = (names) => (tableMeta ? tableMeta.sortTables(names) : names);

  let selection = null;
  let databases = [];
  let lastResult = null;
  let loading = false;
  let writing = false;

  // Live-refresh state. Signatures let the 5s background poll short-circuit:
  // if the snapshot bytes are identical to the previous poll, refresh() skips
  // render() entirely (no DOM churn, scroll position and edits untouched).
  const POLL_INTERVAL_MS = 5000;
  let lastSnapshotSignature = null;
  let lastTableSignature = null;

  // Edit state — rowsByKey maps rowKey -> original snapshot row, dirtyRows
  // holds pending cell edits, checkedRows holds rows ticked for deletion.
  let rowsByKey = new Map();
  const dirtyRows = new Map();
  const checkedRows = new Set();
  let editingCell = null;

  // Confidential tables the user has explicitly revealed this session. Page
  // scoped, so reloading re-locks everything.
  //
  // This is an accident guard for stream use, not a security boundary — the rows
  // are in the snapshot either way. What it does buy is that a gated table
  // renders no rows at all, so the hover-identity card and inline editing have
  // nothing to act on while it is closed.
  const unlockedTables = new Set();

  function isGated(tableName) {
    if (!tableName) return false;
    return metaFor(tableName).confidential && !unlockedTables.has(String(tableName));
  }

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));

  function getTables(database) {
    return Array.isArray(database?.tables) ? database.tables.map((table) => (
      typeof table === 'string' ? table : table?.name
    )).filter(Boolean) : [];
  }

  function getPayload(database, tableName) {
    const payload = database?.table_data?.[tableName];
    if (payload && typeof payload === 'object') return payload;
    return {};
  }

  function getRows(payload) {
    return Array.isArray(payload.rows) ? payload.rows : [];
  }

  function getColumns(payload, rows) {
    if (Array.isArray(payload.columns) && payload.columns.length) return payload.columns;
    const firstObject = rows.find((row) => row && typeof row === 'object' && !Array.isArray(row));
    return firstObject ? Object.keys(firstObject) : [];
  }

  function getPrimaryKey(payload) {
    return Array.isArray(payload?.primary_key) ? payload.primary_key : [];
  }

  // Writes are only possible in Electron direct mode while connected.
  function canWrite() {
    if (!pg || !pg.isDirect || !pg.isDirect()) return false;
    const st = pg.getStatus() || {};
    return st.status === 'cloud' || st.status === 'local';
  }

  // Stable per-row identity built from the primary key columns.
  function rowKey(row, pk) {
    if (!pk.length) return null;
    return JSON.stringify(pk.map((column) => row?.[column] ?? null));
  }

  function selectedContext() {
    if (!selection) return null;
    const database = databases.find((entry) => entry.database === selection.database);
    if (!database) return null;
    const payload = getPayload(database, selection.table);
    const rows = getRows(payload);
    const columns = getColumns(payload, rows);
    return { database, table: selection.table, payload, rows, columns, pk: getPrimaryKey(payload) };
  }

  function resetEditState() {
    rowsByKey = new Map();
    dirtyRows.clear();
    checkedRows.clear();
    editingCell = null;
  }

  let feedbackTimer = null;
  function showFeedback(message, isError = false) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle('is-error', isError);
    feedback.hidden = false;
    clearTimeout(feedbackTimer);
    if (!isError) feedbackTimer = setTimeout(() => { feedback.hidden = true; }, 4000);
  }

  function statusText() {
    if (!pg || !pg.isDirect || !pg.isDirect()) return 'Server snapshot';
    const st = pg.getStatus() || {};
    if (st.status === 'reconnecting') {
      const configured = st.configured && (st.configured.cloud || st.configured.local);
      if (!configured) return 'No Postgres URL configured';
      const seconds = Math.round((st.pollIntervalMs || 5000) / 1000);
      return `Reconnecting — retrying every ${seconds}s`;
    }
    return st.label || st.status || 'Postgres';
  }

  // Value shown in a cell: pending edit if present, otherwise the snapshot row.
  function displayValue(key, column) {
    const dirty = dirtyRows.get(key);
    if (dirty && Object.prototype.hasOwnProperty.call(dirty.values, column)) return dirty.values[column];
    const row = rowsByKey.get(key);
    return row ? row[column] : '';
  }

  function renderTable(database, tableName) {
    const payload = getPayload(database, tableName);
    const rows = getRows(payload);
    const columns = getColumns(payload, rows);
    const pk = getPrimaryKey(payload);
    const editable = canWrite() && pk.length > 0;
    const query = searchInput.value.trim().toLowerCase();
    const filteredRows = rows.filter((row) => !query || columns.some((column, index) => {
      const value = Array.isArray(row) ? row[index] : row?.[column];
      return String(value ?? '').toLowerCase().includes(query);
    }));

    // newestFirst flips the fetched window so inserts land at the top. Display
    // order only — rowsByKey and every write path are keyed, not positional.
    const meta = metaFor(tableName);
    const displayRows = meta.newestFirst ? [...filteredRows].reverse() : filteredRows;

    selectedDatabase.textContent = database.database || 'Database';
    const pkNote = pk.length ? '' : ' — no primary key (read-only)';
    const rawNote = meta.label === tableName ? '' : ` (${tableName})`;
    selectedTable.textContent = `${meta.label}${rawNote}${pkNote}`;
    rowCount.textContent = displayRows.length.toLocaleString();

    if (payload.error) {
      tableWrap.innerHTML = `<div class="database-empty database-empty--error">${escapeHtml(payload.error)}</div>`;
      return;
    }
    if (!columns.length) {
      tableWrap.innerHTML = '<div class="database-empty">This table has no column data in the current snapshot.</div>';
      return;
    }

    rowsByKey = new Map();
    for (const row of displayRows) {
      const key = rowKey(row, pk);
      if (key) rowsByKey.set(key, row);
    }

    const headerCells = [
      editable ? '<th class="database-table__check" title="Select rows to delete"><input type="checkbox" id="database-check-all" aria-label="Select all rows" /></th>' : '',
      ...columns.map((column) => `<th>${escapeHtml(column)}</th>`),
    ].join('');

    const bodyRows = displayRows.length ? displayRows.map((row) => {
      const key = rowKey(row, pk);
      const dirty = key ? dirtyRows.get(key) : null;
      const cells = columns.map((column) => {
        const isDirty = Boolean(dirty && Object.prototype.hasOwnProperty.call(dirty.values, column));
        const cellEditable = Boolean(editable && key && !pk.includes(column));
        return `<td class="database-cell${isDirty ? ' is-dirty' : ''}${cellEditable ? ' is-editable' : ''}"${key ? ` data-key="${escapeHtml(key)}"` : ''} data-column="${escapeHtml(column)}">${escapeHtml(displayValue(key, column))}</td>`;
      }).join('');
      const checkCell = editable && key
        ? `<td class="database-table__check"><input type="checkbox" class="database-row-check" data-key="${escapeHtml(key)}"${checkedRows.has(key) ? ' checked' : ''} aria-label="Select row" /></td>`
        : (editable ? '<td class="database-table__check"></td>' : '');
      // Rows that reference a user advertise themselves as hoverable; userCard.js
      // owns the resolution rules. Computed per render so the affordance
      // survives every innerHTML rebuild.
      const userRow = Boolean(userCard && userCard.isResolvableRow(tableName, row));
      return `<tr${userRow ? ' class="is-user-row"' : ''}>${checkCell}${cells}</tr>`;
    }).join('') : `<tr><td class="database-table__empty" colspan="${columns.length + (editable ? 1 : 0)}">${query ? 'No matching rows.' : 'No rows in this snapshot.'}</td></tr>`;

    const hint = canWrite() && !pk.length
      ? '<div class="database-hint">This table has no primary key, so its rows cannot be edited or deleted.</div>'
      : '';
    // Preserve the viewport so background refreshes don't yank the user back
    // to the top of the table (dirty cells and checked rows are already
    // restored by the render itself via displayValue()/checkedRows).
    const keepTop = tableWrap.scrollTop;
    const keepLeft = tableWrap.scrollLeft;
    tableWrap.innerHTML = `${hint}<table class="database-table"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    tableWrap.scrollTop = keepTop;
    tableWrap.scrollLeft = keepLeft;
  }

  // Reveal gate for confidential tables. Renders a plaque over decorative
  // blurred bars instead of the rows, so opening a protected table by accident
  // has nothing to show. Those bars are NOT blurred real data — no rows are
  // rendered while gated, which is exactly why the hover-identity card and
  // inline editing have nothing to act on. Revealing unlocks the table for the
  // rest of the session.
  function renderGate(database, tableName) {
    const meta = metaFor(tableName);
    const rowTotal = getRows(getPayload(database, tableName)).length;

    selectedDatabase.textContent = database.database || 'Database';
    selectedTable.innerHTML = `${escapeHtml(meta.label)} <span class="database-table-item__lock" aria-hidden="true">🔒</span>`;

    tableWrap.innerHTML = `
      <div class="database-gate">
        <div class="database-gate__bars" aria-hidden="true">${'<span class="database-gate__bar"></span>'.repeat(7)}</div>
        <div class="database-gate__plaque">
          <p class="database-gate__eyebrow">Protected table</p>
          <h4 class="database-gate__title">${escapeHtml(meta.label)}</h4>
          <p class="database-gate__note">${escapeHtml(meta.note || 'This table contains private player data.')}</p>
          <p class="database-gate__count">${rowTotal.toLocaleString()} rows hidden · <code>${escapeHtml(tableName)}</code></p>
          <button class="primary-button database-gate__reveal" type="button" id="database-gate-reveal">Reveal rows</button>
        </div>
      </div>`;

    document.getElementById('database-gate-reveal')?.addEventListener('click', () => {
      unlockedTables.add(String(tableName));
      // The signature check in render() would otherwise skip the rebuild, since
      // the underlying snapshot has not changed.
      lastTableSignature = null;
      render();
    });
  }

  function updateToolbarState() {
    const ctx = selectedContext();
    // A gated table renders no rows, so nothing can be edited until it is
    // revealed. Add row / Delete / Drop all hang off `editable`.
    const editable = Boolean(ctx && canWrite() && ctx.pk.length) && !writing && !isGated(ctx?.table);
    if (saveButton) saveButton.disabled = writing || dirtyRows.size === 0;
    if (discardButton) discardButton.disabled = writing || dirtyRows.size === 0;
    if (addRowButton) addRowButton.disabled = !editable;
    if (deleteRowsButton) deleteRowsButton.disabled = !editable || checkedRows.size === 0;
    if (dropTableButton) dropTableButton.disabled = !editable;
    if (newTableButton) newTableButton.disabled = !canWrite() || writing;
  }

  function render() {
    const result = lastResult || {};
    databases = Array.isArray(result.databases) ? result.databases : [];
    const entries = databases.flatMap((database) => sortTables(getTables(database)).map((table) => ({ database, table })));
    const totalRows = entries.reduce((total, entry) => total + getRows(getPayload(entry.database, entry.table)).length, 0);
    databaseCount.textContent = databases.length.toLocaleString();
    tableCount.textContent = entries.length.toLocaleString();

    const writable = canWrite();
    if (tableToolbar) tableToolbar.hidden = !writable || !entries.length;
    if (rowToolbar) rowToolbar.hidden = !writable || !entries.length;

    const base = statusText();
    status.textContent = entries.length
      ? `${base} · ${entries.length} tables`
      : (result.error ? `${base} — ${result.error}` : `${base} — waiting for snapshot`);

    if (!entries.length) {
      resetEditState();
      lastTableSignature = null;
      tableList.innerHTML = '<div class="database-empty">No database snapshot yet.</div>';
      tableWrap.innerHTML = '<div class="database-empty">The database has not reported any tables yet.</div>';
      selectedDatabase.textContent = 'Database';
      selectedTable.textContent = 'Select a table';
      rowCount.textContent = '0';
      updateToolbarState();
      return;
    }

    if (!selection || !entries.some((entry) => entry.database.database === selection.database && entry.table === selection.table)) {
      selection = { database: entries[0].database.database, table: entries[0].table };
      resetEditState();
      lastTableSignature = null;
    }

    tableList.innerHTML = entries.map((entry) => {
      const active = entry.database.database === selection.database && entry.table === selection.table;
      const rows = getRows(getPayload(entry.database, entry.table)).length;
      const meta = metaFor(entry.table);
      // data-table must keep the RAW name: selection, payload lookup and every
      // write call key off it. The label is display-only.
      const title = meta.label === entry.table ? '' : ` title="${escapeHtml(meta.label)} — table: ${escapeHtml(entry.table)}"`;
      const lock = meta.confidential ? '<span class="database-table-item__lock" aria-hidden="true">🔒</span>' : '';
      return `<button class="database-table-item${active ? ' is-active' : ''}${meta.confidential ? ' is-confidential' : ''}" type="button" data-database="${escapeHtml(entry.database.database)}" data-table="${escapeHtml(entry.table)}"${title}><span>${escapeHtml(meta.label)}</span><small>${lock}${rows.toLocaleString()}</small></button>`;
    }).join('');
    tableList.querySelectorAll('.database-table-item').forEach((button) => button.addEventListener('click', () => {
      if (selection?.database === button.dataset.database && selection?.table === button.dataset.table) return;
      selection = { database: button.dataset.database, table: button.dataset.table };
      resetEditState();
      lastTableSignature = null;
      render();
    }));

    const selected = entries.find((entry) => entry.database.database === selection.database && entry.table === selection.table);
    // Only rebuild the table when its data actually changed. Unchanged tables
    // keep their DOM untouched across background polls (scroll, focus, checks).
    // The gate state is part of the signature so revealing rebuilds immediately
    // even though the underlying snapshot has not changed.
    const gated = isGated(selected.table);
    const tableSig = `${gated ? 'gated' : 'open'}:${tableSignature(selected.database, selected.table)}`;
    if (tableSig !== lastTableSignature) {
      lastTableSignature = tableSig;
      if (gated) renderGate(selected.database, selected.table);
      else renderTable(selected.database, selected.table);
    }
    if (!searchInput.value) rowCount.textContent = totalRows === 0 ? '0' : getRows(getPayload(selected.database, selected.table)).length.toLocaleString();
    updateToolbarState();
  }

  // Structural signatures for the short-circuit checks. `null` means "unknown"
  // and always counts as changed, so a serialization failure can never hide
  // fresh data from the user.
  function snapshotSignature(databases) {
    try {
      return JSON.stringify(databases || []);
    } catch (err) {
      return null;
    }
  }

  function tableSignature(database, tableName) {
    const payload = getPayload(database, tableName) || {};
    try {
      return JSON.stringify({
        columns: payload.columns || [],
        rows: payload.rows || [],
        primary_key: payload.primary_key || [],
        error: payload.error || null,
      });
    } catch (err) {
      return null;
    }
  }

  async function refresh(force = false) {
    if (loading) return;
    loading = true;
    try {
      lastResult = await pg.load(force);
    } catch (err) {
      lastResult = { ok: false, error: String((err && err.message) || err), databases: [] };
    }
    loading = false;
    // A forced refresh follows a write (or a status change), so drop the hover
    // card's memoised index — the next hover rebuilds from the fresh rows.
    if (force && userCard && typeof userCard.invalidate === 'function') userCard.invalidate();
    // Short-circuit: when the snapshot is byte-identical to the previous poll
    // (and the fetch succeeded), there is nothing new to draw — skip render()
    // so the table keeps its scroll position, checkboxes, and pending edits.
    const signature = snapshotSignature(lastResult && lastResult.databases);
    const unchanged =
      !force &&
      Boolean(lastResult && lastResult.ok) &&
      signature !== null &&
      signature === lastSnapshotSignature;
    lastSnapshotSignature = signature;
    if (unchanged) return;
    render();
  }

  // ---- Modal helpers --------------------------------------------------------

  let modalConfirmHandler = null;

  function modalError(message) {
    if (!modalBody) return;
    let node = modalBody.querySelector('.database-form-error');
    if (!node) {
      node = document.createElement('p');
      node.className = 'database-form-error';
      modalBody.appendChild(node);
    }
    node.textContent = message;
  }

  function openModal({ title, bodyHtml, confirmLabel = 'Confirm', danger = false, onConfirm }) {
    if (!modal || !modalBody) { onConfirm(); return; }
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalConfirm.textContent = confirmLabel;
    modalConfirm.classList.toggle('button-danger', danger);
    modalConfirmHandler = onConfirm;
    modal.classList.remove('hidden');
    const firstInput = modalBody.querySelector('input, textarea');
    if (firstInput) firstInput.focus();
  }

  function closeModal() {
    if (modal) modal.classList.add('hidden');
    modalConfirmHandler = null;
  }

  // ---- Write operations -----------------------------------------------------

  // WHERE clause for one row, built from its original primary key values.
  function pkWhere(ctx, key) {
    const row = rowsByKey.get(key);
    if (!row) return null;
    const where = {};
    for (const column of ctx.pk) where[column] = row[column];
    return where;
  }

  async function saveChanges() {
    const ctx = selectedContext();
    if (!ctx || writing || !dirtyRows.size) return;
    writing = true;
    updateToolbarState();
    let failures = 0;
    let lastError = null;
    for (const [key, change] of Array.from(dirtyRows)) {
      const where = pkWhere(ctx, key);
      if (!where) { dirtyRows.delete(key); continue; }
      const res = await pg.updateRows(ctx.table, change.values, where);
      if (res.ok) dirtyRows.delete(key);
      else { failures += 1; lastError = res.error; }
    }
    writing = false;
    if (failures) showFeedback(`${failures} row(s) failed to save — ${lastError}`, true);
    else showFeedback('Changes saved.');
    await refresh(true);
  }

  function openDeleteRowsModal() {
    const ctx = selectedContext();
    if (!ctx || !checkedRows.size) return;
    const count = checkedRows.size;
    openModal({
      title: 'Delete rows',
      bodyHtml: `<p class="database-form-warning">Permanently delete ${count} row${count === 1 ? '' : 's'} from <strong>${escapeHtml(ctx.table)}</strong>? This cannot be undone.</p>`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        writing = true;
        updateToolbarState();
        let failures = 0;
        let lastError = null;
        for (const key of Array.from(checkedRows)) {
          const where = pkWhere(ctx, key);
          if (!where) continue;
          const res = await pg.deleteRows(ctx.table, where);
          if (!res.ok) { failures += 1; lastError = res.error; }
        }
        writing = false;
        checkedRows.clear();
        if (failures) showFeedback(`${failures} row(s) failed to delete — ${lastError}`, true);
        else showFeedback('Rows deleted.');
        await refresh(true);
        return !failures;
      },
    });
  }

  function openAddRowModal() {
    const ctx = selectedContext();
    if (!ctx) return;
    const meta = Array.isArray(ctx.payload.column_meta) ? ctx.payload.column_meta : [];
    const metaByName = new Map(meta.map((column) => [column.column_name, column]));
    // Skip auto-increment (serial) columns — Postgres fills those in.
    const fields = ctx.columns.filter((column) => {
      const def = String(metaByName.get(column)?.column_default ?? '');
      return !def.includes('nextval');
    });
    if (!fields.length) {
      showFeedback('Every column in this table is auto-generated — nothing to add.', true);
      return;
    }
    const bodyHtml = fields.map((column) => {
      const dataType = metaByName.get(column)?.data_type;
      return `<label class="database-form-field"><span>${escapeHtml(column)}${dataType ? ` <em>(${escapeHtml(dataType)})</em>` : ''}</span><input type="text" data-column="${escapeHtml(column)}" autocomplete="off" /></label>`;
    }).join('');
    openModal({
      title: `Add row — ${metaFor(ctx.table).label}`,
      bodyHtml,
      confirmLabel: 'Insert row',
      onConfirm: async () => {
        const values = {};
        modalBody.querySelectorAll('input[data-column]').forEach((input) => {
          if (input.value.trim() !== '') values[input.dataset.column] = input.value;
        });
        if (!Object.keys(values).length) {
          modalError('Fill in at least one column first.');
          return false;
        }
        const res = await pg.insertRow(ctx.table, values);
        if (!res.ok) { modalError(res.error || 'Insert failed.'); return false; }
        showFeedback('Row added.');
        await refresh(true);
        return true;
      },
    });
  }

  function openCreateTableModal() {
    const bodyHtml = `
      <label class="database-form-field"><span>Table name</span><input type="text" id="database-new-table-name" placeholder="e.g. giveaways" autocomplete="off" /></label>
      <label class="database-form-field"><span>Columns — one per line as name:type</span><textarea id="database-new-table-columns" rows="5" spellcheck="false">name:text</textarea></label>
      <p class="database-form-hint">Types: text, varchar, integer, bigint, boolean, numeric, timestamptz, jsonb, uuid, serial… An <code>id serial</code> primary key is added automatically when none is defined.</p>`;
    openModal({
      title: 'Create table',
      bodyHtml,
      confirmLabel: 'Create table',
      onConfirm: async () => {
        const name = (modalBody.querySelector('#database-new-table-name')?.value || '').trim();
        const columns = (modalBody.querySelector('#database-new-table-columns')?.value || '').split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const separator = line.indexOf(':');
            return separator === -1
              ? { name: line, type: 'text' }
              : { name: line.slice(0, separator).trim(), type: line.slice(separator + 1).trim() || 'text' };
          });
        const res = await pg.createTable(name, columns);
        if (!res.ok) { modalError(res.error || 'Create failed.'); return false; }
        showFeedback(`Table "${name}" created.`);
        await refresh(true);
        return true;
      },
    });
  }

  function openDropTableModal() {
    const ctx = selectedContext();
    if (!ctx) return;
    // The label dresses up the warning, but the type-to-confirm check below must
    // stay the RAW table name — it is a safety check on the identifier.
    const label = metaFor(ctx.table).label;
    const bodyHtml = `
      <p class="database-form-warning">This permanently deletes the table <strong>${escapeHtml(label)}</strong> and every row in it. This cannot be undone.</p>
      <label class="database-form-field"><span>Type <strong>${escapeHtml(ctx.table)}</strong> to confirm</span><input type="text" id="database-drop-table-name" autocomplete="off" /></label>`;
    openModal({
      title: `Drop table — ${label}`,
      bodyHtml,
      confirmLabel: 'Drop table',
      danger: true,
      onConfirm: async () => {
        const typed = (modalBody.querySelector('#database-drop-table-name')?.value || '').trim();
        if (typed !== ctx.table) { modalError('Table name did not match — nothing was dropped.'); return false; }
        const res = await pg.dropTable(ctx.table, { cascade: true });
        if (!res.ok) { modalError(res.error || 'Drop failed.'); return false; }
        resetEditState();
        selection = null;
        showFeedback(`Table "${label}" dropped.`);
        await refresh(true);
        return true;
      },
    });
  }

  // ---- Inline cell editing ---------------------------------------------------

  function startCellEdit(cell) {
    const key = cell.dataset.key;
    const column = cell.dataset.column;
    if (!key || editingCell) return;
    if (!rowsByKey.has(key)) return;
    editingCell = { key, column };
    const current = displayValue(key, column);
    cell.classList.add('is-editing');
    cell.innerHTML = `<input class="database-cell-input" type="text" value="${escapeHtml(current ?? '')}" aria-label="Edit ${escapeHtml(column)}" />`;
    const input = cell.querySelector('input');
    input.focus();
    input.select();
    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      finishCellEdit(key, column, commit ? input.value : null);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function finishCellEdit(key, column, rawValue) {
    editingCell = null;
    const row = rowsByKey.get(key);
    const original = row ? row[column] : null;
    if (rawValue !== null && String(rawValue) !== String(original ?? '')) {
      const entry = dirtyRows.get(key) || { values: {} };
      entry.values[column] = rawValue;
      dirtyRows.set(key, entry);
    }
    const ctx = selectedContext();
    if (ctx) renderTable(ctx.database, ctx.table);
    updateToolbarState();
  }

  // ---- Event wiring ----------------------------------------------------------

  tableWrap.addEventListener('dblclick', (event) => {
    const cell = event.target.closest('td.database-cell.is-editable');
    if (cell) startCellEdit(cell);
  });

  tableWrap.addEventListener('change', (event) => {
    if (event.target.id === 'database-check-all') {
      if (event.target.checked) rowsByKey.forEach((_, key) => checkedRows.add(key));
      else checkedRows.clear();
      const ctx = selectedContext();
      if (ctx) renderTable(ctx.database, ctx.table);
      updateToolbarState();
      return;
    }
    const rowCheck = event.target.closest('.database-row-check');
    if (rowCheck) {
      if (rowCheck.checked) checkedRows.add(rowCheck.dataset.key);
      else checkedRows.delete(rowCheck.dataset.key);
      updateToolbarState();
    }
  });

  addRowButton?.addEventListener('click', openAddRowModal);
  deleteRowsButton?.addEventListener('click', openDeleteRowsModal);
  saveButton?.addEventListener('click', saveChanges);
  discardButton?.addEventListener('click', () => {
    dirtyRows.clear();
    const ctx = selectedContext();
    if (ctx) renderTable(ctx.database, ctx.table);
    updateToolbarState();
    showFeedback('Changes discarded.');
  });
  newTableButton?.addEventListener('click', openCreateTableModal);
  dropTableButton?.addEventListener('click', openDropTableModal);

  modalCancel?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeModal();
  });
  modalConfirm?.addEventListener('click', async () => {
    if (!modalConfirmHandler) return;
    modalConfirm.disabled = true;
    let result = true;
    try {
      result = await modalConfirmHandler();
    } catch (err) {
      modalError(String((err && err.message) || err));
      result = false;
    }
    modalConfirm.disabled = false;
    // Handlers keep the modal open (returning false) so errors stay visible;
    // success closes it.
    if (result !== false) closeModal();
  });

  searchInput.addEventListener('input', () => {
    const selected = databases.find((database) => database.database === selection?.database);
    if (selected) renderTable(selected, selection.table);
  });

  // Status transitions: refresh the pill, and pull a fresh snapshot as soon
  // as a Postgres instance connects (cloud or local) if we have no data yet.
  if (typeof window.pageControllers.__databaseStatusUnsubscribe === 'function') {
    window.pageControllers.__databaseStatusUnsubscribe();
  }
  if (pg && typeof pg.onStatusChange === 'function') {
    window.pageControllers.__databaseStatusUnsubscribe = pg.onStatusChange((st) => {
      // Writable/editable state depends on the connection, so force the table
      // to rebuild even when its data is unchanged.
      lastTableSignature = null;
      render();
      if (st.status === 'cloud' || st.status === 'local') {
        if (!lastResult || !lastResult.ok) refresh(true);
      }
    });
  }

  // Background live-refresh: poll the snapshot every POLL_INTERVAL_MS while the
  // page is usable. db.js caches snapshots for 2s, so overlapping polls are
  // cheap, and refresh() short-circuits render() when nothing changed. The poll
  // pauses while the window is hidden, a cell is being edited, a modal is open,
  // a write is in flight, or Postgres isn't connected (browser fallback mode
  // keeps its WebSocket subscription instead).
  function shouldPoll() {
    if (loading || writing || editingCell) return false;
    if (modal && !modal.classList.contains('hidden')) return false;
    if (document.hidden) return false;
    if (!pg || !pg.isDirect || !pg.isDirect()) return false;
    const st = pg.getStatus() || {};
    return st.status === 'cloud' || st.status === 'local';
  }

  function startPolling() {
    // Clear any timer left by a previous run of this controller — forceReload
    // re-executes the page script without tearing the old closure down.
    if (window.pageControllers.__databasePollTimer) {
      clearInterval(window.pageControllers.__databasePollTimer);
    }
    window.pageControllers.__databasePollTimer = setInterval(() => {
      if (shouldPoll()) refresh();
    }, POLL_INTERVAL_MS);
  }

  startPolling();

  // Browser fallback (no Electron main process): keep the legacy live-state
  // subscription so the page still renders from WebSocket snapshots.
  if (!(pg && pg.isDirect && pg.isDirect()) && typeof window.state?.subscribe === 'function') {
    if (typeof window.pageControllers.__databaseUnsubscribe === 'function') window.pageControllers.__databaseUnsubscribe();
    window.pageControllers.__databaseUnsubscribe = window.state.subscribe(() => refresh());
  }

  // Hover-identity overlay: hand userCard.js the current render context. It
  // reads through these getters, so a forced reload of this script — a new
  // closure over the same table element — just re-points the card at new state
  // without stacking listeners.
  if (userCard && typeof userCard.attach === 'function') {
    userCard.attach({
      tableWrap,
      getSelection: () => selection,
      getRow: (key) => rowsByKey.get(key),
      getSnapshot: () => lastResult,
    });
  }

  refresh();
};

window.pageControllers.database();


