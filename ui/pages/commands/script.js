window.pageControllers = window.pageControllers || {};
window.pageControllers.commands = function () {
  var commandsList = document.getElementById('commands-list');
  var commandsCount = document.getElementById('commands-count');
  var modal = document.getElementById('commands-perm-modal');
  var modalCheckboxes = document.getElementById('commands-perm-checkboxes');
  var modalTitle = document.getElementById('commands-perm-title');
  var modalSave = document.getElementById('commands-perm-save');
  var modalCancel = document.getElementById('commands-perm-cancel');

  if (!commandsList) return;

  var PERM_MAP = { "Subscriber": "sub", "VIP": "vip", "Moderator": "mod", "Broadcaster": "broadcaster" };
  var PERM_DISPLAY = { sub: "Subscriber", vip: "VIP", mod: "Moderator", broadcaster: "Broadcaster" };
  var AMP = "&amp;"; var LT = "&lt;"; var GT = "&gt;"; var QUOT = "&quot;";

  function escapeText(value) {
    return String(value).split("&").join(AMP).split("<").join(LT).split(">").join(GT).split('"').join(QUOT).split("'").join("&#39;");
  }

  function getCommandsData() {
    var cc = window.state && window.state.command_cache;
    var commands = cc && cc.commands;
    if (!commands) return {};
    if (typeof commands.toObject === "function") return commands.toObject();
    return commands;
  }

  var editingKey = null;
  var baselineCommands = {};
  var localCommands = {};
  var dirtyKeys = new Set();

  function cloneCommand(command) {
    return {
      trigger: command.trigger || "",
      perms: Array.isArray(command.perms) ? command.perms.slice() : [],
      about: command.about || ""
    };
  }

  function normalizePermissions(value) {
    if (Array.isArray(value)) return value.slice();
    if (!value || typeof value !== "object") return [];
    return Object.keys(value).filter(function(permission) {
      return value[permission] === true;
    });
  }

  function commandsMatch(left, right) {
    return left.trigger === right.trigger &&
      left.about === right.about &&
      left.perms.length === right.perms.length &&
      left.perms.every(function(permission, index) {
        return permission === right.perms[index];
      });
  }

  function updateDirtyState() {
    var saveButton = document.getElementById("commands-save");
    if (saveButton) saveButton.disabled = dirtyKeys.size === 0 || saveButton.dataset.saving === "1";

    commandsList.querySelectorAll(".commands-row").forEach(function(row) {
      row.classList.toggle("is-dirty", dirtyKeys.has(row.dataset.key));
    });
  }

  function buildSavePayload() {
    var commands = {};
    dirtyKeys.forEach(function(key) {
      var command = localCommands[key];
      if (!command) return;
      commands[key] = {
        command: command.trigger,
        permissions: command.perms.slice()
      };
    });
    return { data: { commands: commands } };
  }

  async function handleCommandsSave() {
    var saveButton = document.getElementById("commands-save");
    if (!saveButton || saveButton.dataset.saving === "1" || dirtyKeys.size === 0) return;

    var connection = window.connection;
    var bridge = connection && connection.getBridge ? connection.getBridge() : null;
    if (!bridge || !(connection && connection.isConnected())) return;

    saveButton.dataset.saving = "1";
    saveButton.textContent = "Saving...";
    updateDirtyState();

    try {
      var response = await bridge.sendWithResponse("save_commands", buildSavePayload());
      if (response && response.ok) {
        dirtyKeys.forEach(function(key) {
          if (localCommands[key]) baselineCommands[key] = cloneCommand(localCommands[key]);
        });
        dirtyKeys.clear();
      } else {
        console.error("[Commands] Save failed:", response && response.error);
      }
    } catch (error) {
      console.error("[Commands] Save error:", error);
    } finally {
      delete saveButton.dataset.saving;
      saveButton.textContent = "Save";
      updateDirtyState();
    }
  }

  function markDirty(key) {
    var baseline = baselineCommands[key];
    if (baseline && commandsMatch(localCommands[key], baseline)) dirtyKeys.delete(key);
    else dirtyKeys.add(key);
    updateDirtyState();
  }

  function syncFromServer(data) {
    if (dirtyKeys.size > 0) return;

    baselineCommands = {};
    localCommands = {};
    Object.keys(data).forEach(function(key) {
      var command = {
        trigger: data[key].command || "",
          perms: normalizePermissions(data[key].permissions),
        about: data[key].about || ""
      };
      baselineCommands[key] = cloneCommand(command);
      localCommands[key] = cloneCommand(command);
    });
  }

  function bindCommandsHeaderActions() {
    var saveButton = document.getElementById("commands-save");
    if (saveButton) saveButton.addEventListener("click", handleCommandsSave);
    updateDirtyState();
  }

  function publishCommandsHeader() {
    document.dispatchEvent(new CustomEvent("page:header", {
      detail: {
        title: "Commands",
        subtitle: "Command library and automation controls.",
        actionsHtml: '<button class="primary-button" type="button" id="commands-save">Save</button>',
        bindHeaderActions: bindCommandsHeaderActions
      }
    }));
  }

  function renderCommands() {
    var data = getCommandsData();
    var keys = Object.keys(data);

    syncFromServer(data);
    if (dirtyKeys.size > 0) keys = Object.keys(localCommands);

    if (commandsCount) {
      commandsCount.textContent = keys.length + " commands";
    }

    if (keys.length === 0) {
      commandsList.innerHTML = '<p class="commands-empty">Waiting for command data…</p>';
      return;
    }

    var rows = keys.map(function(key) {
      var cmd = data[key] || {};
      var draft = localCommands[key] || {
        trigger: cmd.command || "",
        perms: normalizePermissions(cmd.permissions),
        about: cmd.about || ""
      };
      var trigger = draft.trigger;
      var perms = draft.perms;
      var about = draft.about;

      var permLabels = perms.map(function(p) {
        return '<span class="perm-badge">' + escapeText(PERM_DISPLAY[p] || p) + '</span>';
      }).join("");

      return '<div class="commands-row' + (dirtyKeys.has(key) ? ' is-dirty' : '') + '" data-key="' + escapeText(key) + '">' +
        '<span class="commands-col commands-col--key">' + escapeText(key) + '</span>' +
        '<span class="commands-col commands-col--trigger"><input class="commands-input" data-field="command" type="text" value="' + escapeText(trigger) + '"></span>' +
        '<span class="commands-col commands-col--perms"><div class="perms-wrap">' + permLabels + '</div><button class="perms-edit" data-key="' + escapeText(key) + '" type="button">Edit</button></span>' +
        '<span class="commands-col commands-col--about"><input class="commands-input" type="text" value="' + escapeText(about) + '" readonly></span>' +
      '</div>';
    }).join("");

    commandsList.innerHTML = rows;
    bindRowEvents();
  }

  function bindRowEvents() {
    var inputs = commandsList.querySelectorAll('input[data-field="command"]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("input", function() {
        var row = this.closest(".commands-row");
        var key = row && row.dataset.key;
        if (!key || !localCommands[key]) return;
        localCommands[key].trigger = this.value;
        markDirty(key);
      });
    }

    var btns = commandsList.querySelectorAll("button.perms-edit");
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener("click", function() {
        openPermModal(this.dataset.key);
      });
    }
  }

  function openPermModal(key) {
    var cmd = localCommands[key];
    if (!cmd) return;
    editingKey = key;
    modalTitle.textContent = "Permissions: " + key;
    var boxes = "";
    var displays = Object.keys(PERM_MAP);
    for (var i = 0; i < displays.length; i++) {
      var val = PERM_MAP[displays[i]];
      var chk = cmd.perms.indexOf(val) !== -1 ? "checked" : "";
      boxes += '<label class="commands-perm-label"><input type="checkbox" data-perm="' + val + '" ' + chk + '><span>' + displays[i] + '</span></label>';
    }
    modalCheckboxes.innerHTML = boxes;
    modal.classList.remove("hidden");
  }

  function closePermModal() {
    modal.classList.add("hidden");
    editingKey = null;
  }

  if (modalCancel) modalCancel.addEventListener("click", closePermModal);
  if (modal) modal.addEventListener("click", function(ev) {
    if (ev.target === modal) closePermModal();
  });

  if (modalSave) modalSave.addEventListener("click", function() {
    if (!editingKey) return;
    var cbs = modalCheckboxes.querySelectorAll('input[type="checkbox"]');
    var sel = [];
    for (var i = 0; i < cbs.length; i++) {
      if (cbs[i].checked) sel.push(cbs[i].dataset.perm);
    }
    localCommands[editingKey].perms = sel;
    markDirty(editingKey);
    closePermModal();
    renderCommands();
  });

  if (window.state && window.state.subscribe) {
    if (typeof window.pageControllers.__commandsUnsubscribe === "function") {
      window.pageControllers.__commandsUnsubscribe();
    }
    window.pageControllers.__commandsUnsubscribe = window.state.subscribe(renderCommands);
  }

  var handleActivate = function(ev) {
    if (ev.detail && ev.detail.pageId === "commands") {
      publishCommandsHeader();
      renderCommands();
    }
  };
  if (window.pageControllers.__commandsActivateHandler) {
    document.removeEventListener("page:activate", window.pageControllers.__commandsActivateHandler);
  }
  document.addEventListener("page:activate", handleActivate);
  window.pageControllers.__commandsActivateHandler = handleActivate;

  renderCommands();
};

window.pageControllers.commands();