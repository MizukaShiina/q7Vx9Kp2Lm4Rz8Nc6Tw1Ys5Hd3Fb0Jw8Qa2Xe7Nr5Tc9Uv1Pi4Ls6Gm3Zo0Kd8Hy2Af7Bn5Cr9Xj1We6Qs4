window.pageControllers = window.pageControllers || {};
window.pageControllers.responses = function () {
  var responsesList = document.getElementById('responses-list');
  var responsesCount = document.getElementById('responses-count');

  if (!responsesList) return;

  var AMP = "&amp;"; var LT = "&lt;"; var GT = "&gt;"; var QUOT = "&quot;";

  function escapeText(value) {
    return String(value).split("&").join(AMP).split("<").join(LT).split(">").join(GT).split('"').join(QUOT).split("'").join("&#39;");
  }

  function getResponsesData() {
    var cc = window.state && window.state.command_cache;
    var responses = cc && cc.responses;
    if (!responses) return {};
    if (typeof responses.toObject === "function") return responses.toObject();
    return responses;
  }

  var baselineResponses = {};
  var localResponses = {};
  var dirtyKeys = new Set();
  var lastFingerprint = null;

  // Rebuild the in-memory entry key ("category\0responseKey") from the row's
  // data attributes. The composite key is NEVER written into the DOM (a NUL
  // character gets mangled to U+FFFD by the HTML parser), so the two parts
  // travel separately and are joined here.
  function getEntryKey(row) {
    if (!row || !row.dataset) return null;
    var category = row.dataset.category;
    var responseKey = row.dataset.responseKey;
    if (category === undefined || responseKey === undefined) return null;
    return category + "\0" + responseKey;
  }

  function cloneResponse(text) {
    return String(text || "");
  }

  function responsesMatch(left, right) {
    return left === right;
  }

  function updateDirtyState() {
    var saveButton = document.getElementById("responses-save");
    if (saveButton) saveButton.disabled = dirtyKeys.size === 0 || saveButton.dataset.saving === "1";

    responsesList.querySelectorAll(".responses-row").forEach(function(row) {
      row.classList.toggle("is-dirty", dirtyKeys.has(getEntryKey(row)));
    });
  }

  function buildSavePayload() {
    var responses = {};
    dirtyKeys.forEach(function(entryKey) {
      // entryKey is "category\0responseKey"
      var sepIndex = entryKey.indexOf("\0");
      if (sepIndex === -1) return;
      var category = entryKey.slice(0, sepIndex);
      var responseKey = entryKey.slice(sepIndex + 1);
      var text = localResponses[entryKey];
      if (text === undefined) return;
      if (!responses[category]) responses[category] = {};
      responses[category][responseKey] = text;
    });
    return { data: { responses: responses } };
  }

  async function handleResponsesSave() {
    var saveButton = document.getElementById("responses-save");
    if (!saveButton || saveButton.dataset.saving === "1" || dirtyKeys.size === 0) return;

    var connection = window.connection;
    var bridge = connection && connection.getBridge ? connection.getBridge() : null;
    if (!bridge || !(connection && connection.isConnected())) return;

    saveButton.dataset.saving = "1";
    saveButton.textContent = "Saving...";
    updateDirtyState();

    try {
      var response = await bridge.sendWithResponse("save_responses", buildSavePayload());
      if (response && response.ok) {
        dirtyKeys.forEach(function(entryKey) {
          if (localResponses[entryKey] !== undefined) baselineResponses[entryKey] = cloneResponse(localResponses[entryKey]);
        });
        dirtyKeys.clear();
      } else {
        console.error("[Responses] Save failed:", response && response.error);
      }
    } catch (error) {
      console.error("[Responses] Save error:", error);
    } finally {
      delete saveButton.dataset.saving;
      saveButton.textContent = "Save";
      updateDirtyState();
    }
  }

  function markDirty(entryKey) {
    if (responsesMatch(localResponses[entryKey], baselineResponses[entryKey])) dirtyKeys.delete(entryKey);
    else dirtyKeys.add(entryKey);
    updateDirtyState();
  }

  function syncFromServer(data) {
    if (dirtyKeys.size > 0) return;

    baselineResponses = {};
    localResponses = {};
    Object.keys(data).forEach(function(category) {
      var responses = data[category];
      if (!responses || typeof responses !== "object" || Array.isArray(responses)) return;
      Object.keys(responses).forEach(function(responseKey) {
        var entryKey = category + "\0" + responseKey;
        baselineResponses[entryKey] = cloneResponse(responses[responseKey]);
        localResponses[entryKey] = cloneResponse(responses[responseKey]);
      });
    });
  }

  function bindResponsesHeaderActions() {
    var saveButton = document.getElementById("responses-save");
    if (saveButton) saveButton.addEventListener("click", handleResponsesSave);
    updateDirtyState();
  }

  function publishResponsesHeader() {
    document.dispatchEvent(new CustomEvent("page:header", {
      detail: {
        title: "Responses",
        subtitle: "Response library and message templates.",
        actionsHtml: '<button class="primary-button" type="button" id="responses-save">Save</button>',
        bindHeaderActions: bindResponsesHeaderActions
      }
    }));
  }

  function renderResponses() {
    var data = getResponsesData();

    // The server only pushes actual diffs, so an unchanged state cache means
    // nothing changed. Skip the rebuild entirely to keep focus, dirty-row
    // highlights, and in-flight edits untouched.
    var fingerprint = JSON.stringify(data);
    if (fingerprint === lastFingerprint) return;

    syncFromServer(data);
    // Categories/keys never change (we only edit text), so always render from
    // the server snapshot; dirty text is pulled from localResponses per row.

    var categories = Object.keys(data);
    var totalCount = 0;

    categories.forEach(function(category) {
      Object.keys(data[category] || {}).forEach(function() { totalCount++; });
    });

    if (responsesCount) {
      responsesCount.textContent = totalCount + " responses";
    }

    if (totalCount === 0) {
      responsesList.innerHTML = '<p class="responses-empty">Waiting for response data…</p>';
      lastFingerprint = fingerprint;
      return;
    }

    var rows = categories.map(function(category) {
      var responses = data[category] || {};
      return Object.keys(responses).map(function(responseKey) {
        var entryKey = category + "\0" + responseKey;
        var text = localResponses[entryKey] !== undefined ? localResponses[entryKey] : (responses[responseKey] || "");

        return '<div class="responses-row' + (dirtyKeys.has(entryKey) ? ' is-dirty' : '') + '" data-category="' + escapeText(category) + '" data-response-key="' + escapeText(responseKey) + '">' +
          '<span class="responses-col responses-col--key">' + escapeText(responseKey) + '</span>' +
          '<span class="responses-col responses-col--category"><span class="responses-category-badge">' + escapeText(category) + '</span></span>' +
          '<span class="responses-col responses-col--text"><input class="responses-input" data-field="text" type="text" value="' + escapeText(text) + '"></span>' +
        '</div>';
      }).join("");
    }).join("");

    responsesList.innerHTML = rows;
    lastFingerprint = fingerprint;
    bindRowEvents();
  }

  function bindRowEvents() {
    var inputs = responsesList.querySelectorAll('input[data-field="text"]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("input", function() {
        var row = this.closest(".responses-row");
        var entryKey = getEntryKey(row);
        if (!entryKey || localResponses[entryKey] === undefined) return;
        localResponses[entryKey] = this.value;
        markDirty(entryKey);
      });
    }
  }

  if (window.state && window.state.subscribe) {
    if (typeof window.pageControllers.__responsesUnsubscribe === "function") {
      window.pageControllers.__responsesUnsubscribe();
    }
    window.pageControllers.__responsesUnsubscribe = window.state.subscribe(renderResponses);
  }

  var handleActivate = function(ev) {
    if (ev.detail && ev.detail.pageId === "responses") {
      publishResponsesHeader();
      renderResponses();
    }
  };
  if (window.pageControllers.__responsesActivateHandler) {
    document.removeEventListener("page:activate", window.pageControllers.__responsesActivateHandler);
  }
  document.addEventListener("page:activate", handleActivate);
  window.pageControllers.__responsesActivateHandler = handleActivate;

  renderResponses();
};

window.pageControllers.responses();

