window.pageControllers = window.pageControllers || {};

// Initialize connection if not already done (for direct page access)
async function initGiveawayPage() {
  // Check if window.state exists, if not, initialize connection
  if (!window.state || !window.connection) {
    try {
      // Dynamically import and initialize connection
      const connectionModule = await import('../js/connection/connection.js');
      const stateModule = await import('../js/connection/state.js');
      
      // Configure and start connection
      connectionModule.configureConnection(
                connectionModule.getDefaultConnectionUrl()
      );
      connectionModule.startConnection();
      
      // Expose globally
      window.connection = {
        getBridge: connectionModule.getBridge,
        isConnected: () => connectionModule.getBridge()?.connected ?? false
      };
      window.state = stateModule.state;
    } catch (error) {
      console.error('[Giveaway] Failed to initialize connection:', error);
    }
  }
  
  // Load the settings modal controller (kept in its own file so the modal
  // logic stays decoupled from the page wiring), then start the page.
  try {
    const settingsModule = await import('./settings.js');
    settingsModule.init();
    window.giveawaySettings = settingsModule;
  } catch (error) {
    console.error('[Giveaway] Failed to load settings module:', error);
  }

  // Start the controller
  window.pageControllers.giveaway();
}


window.pageControllers.giveaway = function () {
    // Register header actions with the dashboard header

    function updateSchedulerVisibility() {
        const schedulerEnabled =
            window.state?.giveaway?.config?.scheduler === true;

        document.querySelectorAll('.scheduler-feature').forEach((el) => {
            el.classList.toggle('hidden', !schedulerEnabled);
        });
    }

    // The header buttons must reflect the *current* view state. Pages are
    // cached by the dashboard, so the history view can still be visible when
    // the page re-activates after a tab switch — in that case we need to show
    // "Back" instead of "History".
    const buildHeaderActionsHtml = () => {
        const isHistoryVisible =
            !!historyView && !historyView.classList.contains('hidden');

        return `
        <button class="ghost-button${isHistoryVisible ? ' hidden' : ''}" type="button" id="giveaway-history-toggle">History</button>
        <button class="ghost-button${isHistoryVisible ? '' : ' hidden'}" type="button" id="giveaway-history-back">Back</button>
    `;
    };

    const bindGiveawayHeaderActions = () => {
      const historyToggle = document.getElementById('giveaway-history-toggle');
      const historyBack = document.getElementById('giveaway-history-back');

      historyToggle?.addEventListener('click', () => toggleHistory(true));
      historyBack?.addEventListener('click', () => toggleHistory(false));
    };

    // Listen for page activation event to update header only when page is shown.
    // The handler is kept on the controller so re-running this script (e.g. a
    // forced refresh) replaces the previous listener instead of doubling up.
    const handleGiveawayPageActivate = (ev) => {
      if (ev.detail?.pageId === 'giveaway') {
        document.dispatchEvent(new CustomEvent('page:header', {
            detail: {
                title: 'Giveaway controls',
                subtitle: 'A dedicated control center for managing entries, giveaway states, and winner selection.',
                actionsHtml: buildHeaderActionsHtml(),
                bindHeaderActions: bindGiveawayHeaderActions,
            }
        }));
      }
    };

    if (window.pageControllers.__giveawayActivateHandler) {
      document.removeEventListener('page:activate', window.pageControllers.__giveawayActivateHandler);
    }
    document.addEventListener('page:activate', handleGiveawayPageActivate);
    window.pageControllers.__giveawayActivateHandler = handleGiveawayPageActivate;

// How long to wait for a roll_winner response before giving up. Rolls can
    // take minutes because winner verification is asynchronous.
    const ROLL_TIMEOUT = 5 * 60 * 1000;

    // True while a roll request is awaiting its server-side response. Used to
    // keep the main action button disabled and labeled "Rolling…" regardless
    // of any state_update re-renders that would otherwise overwrite the label.
    let rollActionPending = false;
    const mainAction = document.getElementById('giveaway-main-action');
    const finishAction = document.getElementById('giveaway-finish-action');
    const schedulerAction = document.getElementById('giveaway-scheduler-action');
    const resetButton = document.getElementById('giveaway-reset');
  const mainView = document.getElementById('giveaway-view');
  const historyView = document.getElementById('giveaway-history-view');
    const historyRecover = document.getElementById('giveaway-history-recover');
  const entriesCount = document.getElementById('giveaway-entries-count');
  const uniqueCount = document.getElementById('giveaway-unique-count');
  const runtime = document.getElementById('giveaway-runtime');
  const status = document.getElementById('giveaway-status');
  const winnersCount = document.getElementById('giveaway-winners-count');
  const stateCopy = document.getElementById('giveaway-state-copy');
  const activityLog = document.getElementById('giveaway-activity-log');
  const entriesBody = document.getElementById('giveaway-entries-body');
    const winnersBody = document.getElementById('giveaway-winners-body');
    const rollModal = document.getElementById("giveaway-roll-modal");
    const rollMessage = document.getElementById("giveaway-roll-message");
    const rollCancel = document.getElementById("giveaway-roll-cancel");
    const rollConfirm = document.getElementById("giveaway-roll-confirm");
    const schedulerModal = document.getElementById("giveaway-scheduler-modal");
    const schedulerSummary = document.getElementById("giveaway-scheduler-summary");
    const schedulerCancel = document.getElementById("giveaway-scheduler-cancel");
    const schedulerConfirm = document.getElementById("giveaway-scheduler-confirm");
    const giveawayTitle = document.getElementById('giveaway-title');
    const giveawayReward = document.getElementById('giveaway-reward');
    const schedulerState = document.getElementById('scheduler-state');
    const schedulerLoop = document.getElementById('scheduler-loop');
    const schedulerCompleted = document.getElementById('scheduler-completed');
    const schedulerRuntime = document.getElementById('scheduler-runtime');
    const schedulerMode = document.getElementById('scheduler-mode');

    let titleDirty = false;
    let rewardDirty = false;
    let titleSaveTimeout = null;

    let toastTimeout = null;

    // Id of the history record currently shown in the preview (if any).
    let selectedHistoryId = null;

    function scheduleGiveawaySave() {
        clearTimeout(titleSaveTimeout);

        titleSaveTimeout = setTimeout(async () => {
            if (!titleDirty && !rewardDirty) return;

            if (!window.connection || !window.connection.isConnected()) {
                console.log("Not connected, giveaway data not saved.");
                return;
            }

            const bridge = window.connection.getBridge();

            const response = await bridge.sendWithResponse(
                "giveaway_save_data",
                {
                    data: {
                        title: giveawayTitle.value,
                        prize: giveawayReward.value
                    }
                }
            );

            if (response.ok) {
                console.log("Giveaway data saved.");
                titleDirty = false;
                rewardDirty = false;
            } else {
                console.error("Failed to save giveaway data:", response.error);
            }

        }, 1000);
    }

    giveawayTitle.addEventListener("input", () => {
        titleDirty = true;
        scheduleGiveawaySave();
    });

    giveawayReward.addEventListener("change", () => {
        rewardDirty = true;
        scheduleGiveawaySave();
    });

    async function showToast(message, tone = 'info', timeout = 2200, onConfirm = null) {
        let toast = document.getElementById('giveaway-toast');

        if (!toast) {

            toast = document.createElement('div');
            toast.id = 'giveaway-toast';

            document.body.appendChild(toast);

        } else if (toast.classList.contains("is-visible")) {

            toast.classList.remove("is-visible");

            await new Promise(resolve =>
                setTimeout(resolve, 150)
            );

        }

        toast.className =
            `giveaway-toast giveaway-toast--${tone}`;
        toast.classList.remove("is-visible");

        toast.innerHTML = `
            <div class="giveaway-toast__content">

                <div class="giveaway-toast__icon"></div>

                <div class="giveaway-toast__body">

                    <h4 class="giveaway-toast__title"></h4>

                    <p class="giveaway-toast__message"></p>

                    ${onConfirm
                            ? `
                    <div class="giveaway-toast__actions">
                        <button class="ghost-button giveaway-toast__cancel">
                            Cancel
                        </button>

                        <button class="giveaway-toast__confirm">
                            Confirm
                        </button>
                    </div>
                    `
                            : ""
                        }

                </div>

            </div>

            ${!onConfirm
                            ? `<div class="giveaway-toast__progress"></div>`
                            : ""
                        }
            `;


        const icon = toast.querySelector(".giveaway-toast__icon");
        const title = toast.querySelector(".giveaway-toast__title");
        const body = toast.querySelector(".giveaway-toast__message");

        const toneMap = {
            info: {
                icon: "ℹ",
                title: "Information"
            },

            success: {
                icon: "✓",
                title: "Success"
            },

            warning: {
                icon: "⚠",
                title: "Warning"
            },

            error: {
                icon: "✕",
                title: "Error"
            }
        };

        const current = toneMap[tone] || toneMap.info;

        icon.textContent = current.icon;
        title.textContent = current.title;
        body.textContent = message;

        requestAnimationFrame(() => {
            toast.classList.add("is-visible");
        });

        if (onConfirm) {

            const confirmBtn =
                toast.querySelector(".giveaway-toast__confirm");

            const cancelBtn =
                toast.querySelector(".giveaway-toast__cancel");

            cancelBtn.addEventListener("click", () => {
                toast.classList.remove("is-visible");
            });

            confirmBtn.addEventListener("click", async () => {

                toast.classList.remove("is-visible");

                await onConfirm();

            });

        }

        clearTimeout(toastTimeout);

        if (timeout > 0) {
            toastTimeout = setTimeout(() => {
                toast.classList.remove("is-visible");
            }, timeout);
        }
    }

  // Update UI from server state
    function updateFromServerState() {
        if (!window.state) {
            return;
        }

        updateSchedulerVisibility();

        const runtimeState = window.state.runtime || {};
        const cacheState = window.state.cache || {};
        const gwState = runtimeState.gw_state || 'IDLE';
        const schedulerState = runtimeState.scheduler_state?.state || 'IDLE';

        const schedulerPanel = document.querySelector('.scheduler-stats');

        schedulerPanel?.classList.toggle(
            'is-running',
            schedulerState !== 'IDLE'
        );
    
        // Scheduler stats
        const schedulerRuntimeState = runtimeState.scheduler_state || {};
        const schedulerStateEl =document.getElementById('scheduler-state');
        const schedulerLoopEl = document.getElementById('scheduler-loop');
        const schedulerCompletedEl = document.getElementById('scheduler-completed');
        const schedulerRuntimeEl = document.getElementById('scheduler-runtime');
        const schedulerModeEl = document.getElementById('scheduler-mode');

        const schedulerStateLabels = {
            IDLE: "IDLE",
            WAITING_TO_START: "STARTING",
            RUNNING: "RUNNING",
            WAITING: "WAITING",
            HANDOFF: "HANDOFF",
        };

        schedulerStateEl.textContent =
            schedulerStateLabels[schedulerState] || schedulerState;

        schedulerLoopEl.textContent = `#${schedulerRuntimeState.loop ?? 0}`;
        schedulerCompletedEl.textContent = schedulerRuntimeState.completed ?? 0;
        schedulerRuntimeEl.textContent = schedulerRuntimeState.runtime || '00:00';
        schedulerModeEl.textContent = schedulerRuntimeState.mode || '—';

        // Scheduler button
        if (schedulerAction) {
            schedulerAction.textContent =
                schedulerState === 'IDLE'
                    ? 'Start Scheduler'
                    : 'Stop Scheduler';
        }

        const stepIdle = document.getElementById("step-idle");
        const stepStarted = document.getElementById("step-started");
        const stepRunning = document.getElementById("step-running");
        const stepRolling = document.getElementById("step-rolling");
        const stepWinner = document.getElementById("step-winner");
      // Clear all beams
      [
          stepIdle,
          stepStarted,
          stepRunning,
          stepRolling,
          stepWinner
      ].forEach(el => el?.classList.remove("is-active"));

      // Status group
      if (gwState === "IDLE") {
          stepIdle?.classList.add("is-active");
      } else {
          stepStarted?.classList.add("is-active");
      }

      // State group
      if (gwState === "RUNNING") {
          stepRunning?.classList.add("is-active");
      } else if (gwState === "ROLLING") {
          stepRolling?.classList.add("is-active");
      }

      // Winner group
      if ((runtimeState.gw_winners_count || 0) > 0) {
          stepWinner?.classList.add("is-active");
      }

      const recentWinners = cacheState.recent_winners || [];

      updateWinnersTable(recentWinners);

    // Update metrics from server state

      const entries = runtimeState.gw_entries_count || 0;
      const entriesList = runtimeState.gw_entries_list || [];
      const unique = entriesList.length;
      const runtimeVal = runtimeState.gw_runtime || '00:00';
      const winners = runtimeState.gw_winners_count || 0;
      const title = runtimeState.gw_title || "";
      const prize = runtimeState.gw_prize || "";

      if (!titleDirty) {
          giveawayTitle.value = title;
      }
      if (!rewardDirty) {
          giveawayReward.value = prize;
      }

    // Update DOM
    entriesCount.textContent = entries;
    uniqueCount.textContent = unique;
    runtime.textContent = runtimeVal;
    winnersCount.textContent = winners;

    // Update status text
      const statusMap = {
          IDLE: "Ready",
          RUNNING: "Open",
          ROLLING: "Rolling"
      };

      status.textContent = statusMap[gwState] || "Ready";

    if (resetButton) {
      resetButton.title = 'Reset the current giveaway';
    }

    // Update phase-dependent UI
      const phaseMap = {
          IDLE: {
              buttonLabel: "Start Giveaway",
              copy: "No giveaway is active right now."
          },

          RUNNING: {
              buttonLabel: "Lock Giveaway",
              copy: "Entries are currently open and the live pool is active."
          },

          ROLLING: {
              buttonLabel: "Roll Winners",
              copy: "Winner Selection."
          },
      };

      const phaseState = phaseMap[gwState] ?? phaseMap.IDLE;
      // Leave the main action label alone while a roll request is pending so a
      // live state_update re-render doesn't overwrite our "Rolling…" busy label.
      if (!rollActionPending) {
          mainAction.textContent = phaseState.buttonLabel;
      }

        // Scheduler button
      if (schedulerAction) {
            schedulerAction.textContent =
                schedulerState === 'IDLE'
                    ? 'Start Scheduler'
                    : 'Stop Scheduler';
        }

      if (gwState === "ROLLING") {
          finishAction.classList.remove("hidden");
      } else {
          finishAction.classList.add("hidden");
      }

      stateCopy.textContent = phaseState.copy;

      // Update activity log from server
      const activity = runtimeState.gw_activity || [];
      if (activityLog) {
          activityLog.innerHTML = activity
              .slice(0, 11)
              .map(msg => `<li>${msg}</li>`)
              .join('');
      }

      // Update entries table from server
      if (entriesBody) {
          entriesBody.innerHTML = entriesList.map(entry => `
        <tr>
            <td>${entry.username}</td>
            <td>${entry.weight}</td>
            <td>${entry.odds}</td>
        </tr>
    `).join('');
      }
  }

  // Subscribe to state changes
  window.state.subscribe(() => {
    updateFromServerState();
  });

  // Initial render
  updateFromServerState();

  // The server only includes "giveaway_history" in a state push when its data
  // actually changed, so its presence marks "fresh history data arrived".
  // We listen on the bridge (which sees each raw pushed snapshot) instead of
  // state.subscribe, whose callbacks fire after merging and cannot tell
  // whether a specific push carried the key.
  const handleGiveawayHistoryPush = (snapshot) => {
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      !Object.prototype.hasOwnProperty.call(snapshot, 'giveaway_history')
    ) {
      return;
    }

    // Refresh only while the view is open; opening it renders anyway.
    if (historyView && !historyView.classList.contains('hidden')) {
      renderHistoryList();
    }
  };

  // Drop any handler registered by a previous run of this script (forced
  // refresh) so listeners don't stack up, then register ours.
  const previousHistoryHandler =
    window.pageControllers.__giveawayHistoryBridgeHandler;
  if (previousHistoryHandler) {
    window.connection?.getBridge?.()?.removeStateUpdate?.(
      previousHistoryHandler
    );
  }
  window.connection?.getBridge?.()?.onStateUpdate?.(handleGiveawayHistoryPush);
  window.pageControllers.__giveawayHistoryBridgeHandler =
    handleGiveawayHistoryPush;

  // Small HTML escape helpers so record titles/usernames can't break layouts.
    const escapeHtml = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const escapeAttr = (value) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    function getHistoryRecords() {
      return (
        window.state?.giveaway_history ||
        window.state?.raw?.giveaway_history ||
        []
      );
    }

        function updateHistoryRecoverButton() {
            const records = getHistoryRecords();
            const selectedRecord = records.find(
                (record) => String(record.id || record.timestamp || '') === selectedHistoryId
            );

            if (historyRecover) {
                historyRecover.disabled = !selectedRecord?.filename;
            }
        }

        async function recoverSelectedHistory() {
            const records = getHistoryRecords();
            const selectedRecord = records.find(
                (record) => String(record.id || record.timestamp || '') === selectedHistoryId
            );

            if (!selectedRecord?.filename) {
                return;
            }

            if (!window.connection || !window.connection.isConnected()) {
                showToast('Not connected to server.', 'warning');
                return;
            }

            const bridge = window.connection.getBridge();
            const response = await bridge.sendWithResponse('recover_from_history', {
                history_filename: selectedRecord.filename,
            });

            if (response.ok) {
                showToast('Giveaway recovered.', 'info');
            } else {
                showToast(`Failed to recover giveaway: ${response.error}`, 'warning');
            }
        }

    function renderHistoryPreview(record) {
      const previewEl = document.getElementById('giveaway-history-preview');
      if (!previewEl) return;

      const winners = Array.isArray(record.winners) ? record.winners : [];
      const entrants = Array.isArray(record.entrants) ? record.entrants : [];

      const winnerItems = winners.length
        ? winners
            .map((w) => {
              const name = (w && (w.username || w.name)) || 'Unknown';
              return `<li class="history-winner">${escapeHtml(name)}</li>`;
            })
            .join('')
        : '<li class="history-winner">None</li>';

      const entrantItems = entrants.length
        ? entrants
            .map((e) => {
              // entrants is a flat array of usernames; keep a fallback in case
              // an entry ever arrives as { id, username }.
              const label =
                e && typeof e === 'object'
                  ? e.username || e.name || String(e.id ?? '')
                  : String(e);
              return `<li class="history-entrant">${escapeHtml(label)}</li>`;
            })
            .join('')
        : '<li class="history-entrant">No entrants.</li>';

      previewEl.innerHTML = `
        <div class="history-preview__body">
          <h4 class="history-preview__title">${escapeHtml(record.title || 'Untitled')}</h4>

          <div class="history-preview__meta">
            <p><strong>Date</strong> <span>${escapeHtml(record.timestamp || '—')}</span></p>
            <p><strong>Filename</strong> <span>${escapeHtml(record.filename || '—')}</span></p>
            <p><strong>Prize</strong> <span>${escapeHtml(record.prize || '—')}</span></p>
          </div>

          <p class="history-preview__label">Winners</p>
          <ul class="history-winners-list">${winnerItems}</ul>

          <p class="history-preview__label">Entrants</p>
          <ul class="history-entrants-list">${entrantItems}</ul>
        </div>
      `;
    }

    function selectHistoryRecord(id) {
      const records = getHistoryRecords();
      const record = records.find(
        (r) => String(r.id || r.timestamp || '') === String(id)
      );
      if (!record) return;

      selectedHistoryId = String(record.id || record.timestamp || '');
      renderHistoryPreview(record);
    updateHistoryRecoverButton();

      // Reflect the selection instantly by flipping classes on the existing
      // buttons — no list rebuild needed, the cached id already knows which
      // entry is active (no waiting for the next server push).
      const listEl = document.getElementById('giveaway-history-list');
      if (listEl) {
        Array.from(listEl.querySelectorAll('.history-list__item')).forEach(
          (btn) => {
            btn.classList.toggle(
              'is-active',
              btn.dataset.historyId === selectedHistoryId
            );
          }
        );
      }
    }

    function renderHistoryList() {
      const listEl = document.getElementById('giveaway-history-list');
      const emptyEl = document.getElementById('giveaway-history-empty');
      if (!listEl) return;

      const records = getHistoryRecords();
      const sorted = [...records].sort((a, b) =>
        String(b.id || b.timestamp || '').localeCompare(
          String(a.id || a.timestamp || '')
        )
      );

      emptyEl?.classList.toggle('hidden', sorted.length > 0);

      listEl.innerHTML = sorted
        .map((record) => {
          const id = String(record.id || record.timestamp || '');
          const active = id && id === selectedHistoryId ? ' is-active' : '';
          const date = escapeHtml(record.timestamp || '');
          return `
            <button type="button" class="history-list__item${active}" data-history-id="${escapeAttr(id)}">
              <span class="history-list__item-title">${escapeHtml(record.title || id || 'Untitled')}</span>
              ${date ? `<span class="history-list__item-date">${date}</span>` : ''}
            </button>
          `;
        })
        .join('');

      Array.from(listEl.querySelectorAll('button')).forEach((btn) => {
        btn.addEventListener('click', () =>
          selectHistoryRecord(btn.dataset.historyId)
        );
      });

      // Drop the preview if the selected record is no longer present.
      if (
        selectedHistoryId &&
        !sorted.some((r) => String(r.id || r.timestamp || '') === selectedHistoryId)
      ) {
        const previewEl = document.getElementById('giveaway-history-preview');
        if (previewEl) {
          previewEl.innerHTML =
            '<p class="history-preview__empty">Select a saved run to view its winner selection and entry data.</p>';
        }
                selectedHistoryId = null;
      }

            updateHistoryRecoverButton();
    }

  function toggleHistory(showHistory) {
    const historyToggle = document.getElementById('giveaway-history-toggle');
    const historyBack = document.getElementById('giveaway-history-back');

    mainView.classList.toggle('hidden', showHistory);
    historyView.classList.toggle('hidden', !showHistory);
    historyToggle?.classList.toggle('hidden', showHistory);
    historyBack?.classList.toggle('hidden', !showHistory);

    if (showHistory) {
      renderHistoryList();
    }
  }

    historyRecover?.addEventListener('click', recoverSelectedHistory);

  // Reset button - sends command to server
    resetButton.addEventListener('click', () => {
        const gwState = window.state.runtime?.gw_state || 'IDLE';
        const winners = window.state.runtime?.gw_winners_count || 0;

        if (gwState === 'IDLE') {
            showToast(
                'Nothing to reset while the giveaway is idle.',
                'warning', 3000
            );
            return;
        }

        if (winners > 0) {
            showToast(
                'Reset is unavailable because a winner has already been selected.',
                'warning', 3000
            );
            return;
        }

        showToast(
            'Are you sure you want to reset? This action is irreversible.',
            'warning',
            3000,
            async () => {
                if (!window.connection || !window.connection.isConnected()) {
                    showToast('Not connected to server.', 'warning');
                    return;
                }

                const bridge = window.connection.getBridge();
                const response = await bridge.sendWithResponse('reset_giveaway');

                if (response.ok) {
                    showToast('Giveaway reset successfully.', 'info');
                } else {
                    showToast(
                        'Failed to reset giveaway: ' + response.error,
                        'warning'
                    );
                }
            }
        );
    });


    function updateWinnersTable(winners) {

        if (!winnersBody) return;

        winnersBody.innerHTML = [...winners]
            .reverse()
            .slice(0, 7)
            .map(winner => {

                let claimLabel = "Pending 🟡";

                if (winner.claim === "pending") {
                    claimLabel = "Pending 🟡";
                } else if (winner.claim === "claimed") {
                    claimLabel = "Claimed 🔵";
                } else if (winner.claim === "delivered") {
                    claimLabel = "Delivered 🟢";
                } else if (winner.claim === "voided") {
                    claimLabel = "Voided 🔴";
                }

                return `
                <tr>
                    <td>${winner.username}</td>
                    <td>${claimLabel}</td>
                </tr>
            `;
            })
            .join('');
    }

    async function sendGiveawayCommand(command, successMessage, timeout = 10000) {
        if (!window.connection || !window.connection.isConnected()) {
            showToast("Not connected to server.", "warning");
            return;
        }

        const bridge = window.connection.getBridge();
        const response = await bridge.sendWithResponse(command, {}, timeout);

        if (response.ok) {
            if (successMessage) {
                showToast(successMessage, "info");
            }
        } else {
            showToast(`Failed: ${response.error}`, "warning");
        }
    }

    // Rolls can take minutes to resolve (async verification), so disable the
    // button and put it in a busy state until the server responds.
    async function runRollWinner(successMessage) {
        rollActionPending = true;
        mainAction.disabled = true;
        mainAction.textContent = "Rolling…";
        try {
            await sendGiveawayCommand("roll_winner", successMessage, ROLL_TIMEOUT);
        } finally {
            rollActionPending = false;
            mainAction.disabled = false;
            // Re-render now so the label reflects the actual server state
            // instead of remaining on the overridden "Rolling…" text.
            updateFromServerState();
        }
    }

    if (schedulerAction) {
        schedulerAction.addEventListener('click', async () => {
            const schedulerState =
                window.state.runtime?.scheduler_state?.state || 'IDLE';

            if (schedulerState === 'IDLE') {
                showSchedulerModal(async () => {
                    await sendGiveawayCommand(
                        'start_scheduler',
                        'Scheduler started.'
                    );
                });

                return;
            }

            await sendGiveawayCommand(
                'stop_scheduler',
                'Scheduler stopped.'
            );
        });
    }

    function showSchedulerModal(onConfirm) {
        if (!schedulerModal || !schedulerSummary) {
            console.warn("Scheduler modal missing");
            onConfirm();
            return;
        }

        const config = window.state?.giveaway?.config || {};

        const schedulerFields = [
            {
                key: "scheduler_runtime",
                label: "Runtime",
            },
            {
                key: "scheduler_min_entries",
                label: "Min Entries",
            },
            {
                key: "scheduler_loop_count",
                label: "Loop Count",
            },
            {
                key: "scheduler_loop_cooldown",
                label: "Loop Cooldown",
            },
            {
                key: "winner_per_loop",
                label: "Winners Per Loop",
            },
            {
                key: "scheduler_auto_roll",
                label: "Auto Roll",
            },
            {
                key: "scheduler_extension_seconds",
                label: "Extension Seconds",
            },
            {
                key: "scheduler_lock_after_min_seconds",
                label: "Lock After",
            },
        ];

        schedulerSummary.innerHTML = schedulerFields
            .map(({ key, label }) => {
                const value = config[key];

                let displayValue = value;

                if (typeof value === "boolean") {
                    displayValue = value ? "Enabled" : "Disabled";
                }

                if (value === undefined || value === null) {
                    displayValue = "—";
                }

                return `
                <div class="scheduler-summary-row">
                    <span>${label}</span>
                    <strong>${displayValue}</strong>
                </div>
            `;
            })
            .join("");

        schedulerModal.classList.remove("hidden");

        schedulerCancel.onclick = () => {
            schedulerModal.classList.add("hidden");
        };

        schedulerConfirm.onclick = async () => {
            schedulerModal.classList.add("hidden");
            await onConfirm();
        };
    }

    function showRollModal(onConfirm) {

        if (!rollModal) {
            console.warn("Roll modal missing");
            onConfirm();
            return;
        }

        const winnerNumber = (window.state.runtime?.gw_winners_count || 0) + 1;

        rollMessage.textContent =
            `Are you sure you want to roll winner #${winnerNumber}?`;

        rollModal.classList.remove("hidden");

        rollCancel.onclick = () => {
            rollModal.classList.add("hidden");
        };

        rollConfirm.onclick = async () => {
            rollModal.classList.add("hidden");
            await onConfirm();
        };
    }

    finishAction.addEventListener("click", async () => {
        await sendGiveawayCommand(
            "stop_giveaway",
            "Giveaway finished."
        );
    });


    mainAction.addEventListener("click", async () => {
        const gwState = window.state.runtime?.gw_state || "IDLE";
        const winners = window.state.runtime?.gw_winners_count || 0;

        if (gwState === "ROLLING") {

            if (winners === 0) {
                await runRollWinner("Rolling first winner...");
                return;
            }

            showToast(
                `Roll winner #${winners + 1}?`,
                "warning",
                0,
                async () => {
                    await runRollWinner(`Winner #${winners + 1} selected.`);
                }
            );

            return;
        }

        switch (gwState) {
            case "IDLE":
                await sendGiveawayCommand(
                    "start_giveaway",
                    "Giveaway started."
                );
                break;

            case "RUNNING":
                await sendGiveawayCommand(
                    "lock_giveaway",
                    "Entries locked."
                );
                break;

            case "ROLLING":
                showRollModal(async () => {
                    await runRollWinner("Rolling winner...");
                });
                break;
        }
    });

};

// Initialize the page
initGiveawayPage();