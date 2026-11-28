window.pageControllers = window.pageControllers || {};

window.pageControllers.campaign = function () {
  const views = {
    campaign: document.getElementById('campaign-main-view'),
    history: document.getElementById('campaign-history-view'),
  };
  const settingsModal = document.getElementById('campaign-settings-modal');
  const curveModal = document.getElementById('campaign-curve-modal');
  const recoverModal = document.getElementById('campaign-recover-modal');
  const settingsStatus = document.getElementById('campaign-settings-status');
  const curveStatus = document.getElementById('campaign-curve-status');
  const recoverStatus = document.getElementById('campaign-recover-status');
  const settingsSave = document.getElementById('campaign-settings-save');
  const curveSave = document.getElementById('campaign-curve-save');
  const recoverConfirm = document.getElementById('campaign-recover-confirm');
  const redemptionFields = document.querySelector('.campaign-redemption-fields');
  let activeView = 'campaign';
  let originalSettings = null;
  let currentCurveKey = null;
  let originalCurve = null;
  let redemptionSyncPending = false;
  let returnFocus = null;
  let latestCampaign = null;
  let campaignActionPending = false;
  let latestDrawResult = null;
  let pendingWinnerRevealId = null;
  let lastRevealedWinnerId = null;
  let metadataSaveTimer = null;
  let metadataSavePromise = null;
  const dirtyMetadataFields = new Set();
  const savedMetadata = { title: '', reward: '' };
  let campaignHistory = [];
  let campaignHistoryLoad = null;
  let selectedRecoveryFilename = null;

  function buildHeaderActions() {
    const subviewOpen = activeView !== 'campaign';
    return `
      <button class="ghost-button${subviewOpen ? ' hidden' : ''}" type="button" id="campaign-history-action">History</button>
      <button class="ghost-button${subviewOpen ? '' : ' hidden'}" type="button" id="campaign-back-action">Back to campaign</button>
    `;
  }

  function setView(viewName) {
    if (!views[viewName]) return;

    activeView = viewName;
    Object.entries(views).forEach(([name, element]) => {
      if (element) element.hidden = name !== activeView;
    });
    const subviewOpen = activeView !== 'campaign';
    document.getElementById('campaign-history-action')?.classList.toggle('hidden', subviewOpen);
    document.getElementById('campaign-back-action')?.classList.toggle('hidden', !subviewOpen);
    if (viewName === 'history') loadCampaignHistory();
  }

  function bindHeaderActions() {
    document.getElementById('campaign-history-action')?.addEventListener('click', () => setView('history'));
    document.getElementById('campaign-back-action')?.addEventListener('click', () => setView('campaign'));
  }

  function publishHeader() {
    document.dispatchEvent(new CustomEvent('page:header', {
      detail: {
        title: 'Campaign',
        subtitle: 'Manage campaign rewards, participants, raids, and winner draws.',
        actionsHtml: buildHeaderActions(),
        bindHeaderActions,
      },
    }));
  }

  function toPlain(value) {
    return typeof value?.toObject === 'function' ? value.toObject() : value;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatWeight(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}×` : '0×';
  }

  function formatTimestamp(value, options = { hour: 'numeric', minute: '2-digit' }) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, options);
  }

  function renderCampaignHistory(records = campaignHistory) {
    const body = document.getElementById('campaign-history-body');
    if (!body) return;
    body.replaceChildren();

    if (!records.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'campaign-empty-row';
      cell.textContent = 'No archived campaigns yet.';
      row.append(cell);
      body.append(row);
    } else {
      records.forEach((record) => {
        const row = document.createElement('tr');
        const titleCell = document.createElement('td');
        const title = document.createElement('span');
        title.className = 'campaign-history-title';
        const titleName = document.createElement('strong');
        titleName.textContent = record.title || 'Untitled campaign';
        const titleState = document.createElement('small');
        titleState.textContent = 'Archived';
        title.append(titleName, titleState);
        titleCell.append(title);

        const completedCell = document.createElement('td');
        completedCell.textContent = formatTimestamp(record.ended || record.started, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

        const entriesCell = document.createElement('td');
        entriesCell.textContent = formatCount(record.entry_count);

        const winnersCell = document.createElement('td');
        const winnerNames = Array.isArray(record.winners)
          ? record.winners.map((winner) => winner.twitch_username || winner.mb_id || 'Participant')
          : [];
        winnersCell.textContent = winnerNames.length
          ? winnerNames.join(', ')
          : 'No winner';

        const rewardCell = document.createElement('td');
        rewardCell.textContent = record.reward || '—';

        const actionCell = document.createElement('td');
        const recoverButton = document.createElement('button');
        recoverButton.type = 'button';
        recoverButton.className = 'campaign-text-button';
        recoverButton.dataset.campaignRecover = record.filename;
        recoverButton.textContent = 'Recover';
        recoverButton.disabled = String(latestCampaign?.state || 'UNKNOWN').toUpperCase() !== 'IDLE';
        actionCell.append(recoverButton);

        row.append(titleCell, completedCell, entriesCell, winnersCell, rewardCell, actionCell);
        body.append(row);
      });
    }

    setText('campaign-history-count', formatCount(records.length));
    setText('campaign-history-badge-text', `${formatCount(records.length)} archived`);
  }

  function updateCampaignHistoryState(state = latestCampaign?.state) {
    const normalized = String(state || 'UNKNOWN').toUpperCase();
    const idle = normalized === 'IDLE';
    setText(
      'campaign-history-live-state',
      idle ? 'Recovery available while Idle' : `Recovery unavailable while ${normalized.toLowerCase()}`,
    );
    document.querySelectorAll('[data-campaign-recover]').forEach((button) => {
      button.disabled = !idle;
    });
  }

  async function loadCampaignHistory() {
    const status = document.getElementById('campaign-history-status');
    if (campaignHistoryLoad) return campaignHistoryLoad;
    if (status) status.textContent = 'Loading campaign history…';

    campaignHistoryLoad = (async () => {
      try {
        const result = await sendRemote('get_campaign_history');
        campaignHistory = Array.isArray(result) ? result : [];
        renderCampaignHistory();
        if (status) {
          status.textContent = campaignHistory.length
            ? `Showing ${formatCount(campaignHistory.length)} archived campaign${campaignHistory.length === 1 ? '' : 's'}.`
            : 'No campaign archives found.';
        }
        updateCampaignHistoryState();
      } catch (error) {
        console.error('[Campaign] History load failed:', error);
        campaignHistory = [];
        renderCampaignHistory();
        if (status) status.textContent = `Could not load campaign history: ${error.message}`;
      } finally {
        campaignHistoryLoad = null;
      }
    })();

    return campaignHistoryLoad;
  }

  function openCampaignRecovery(filename) {
    if (!recoverModal || !recoverConfirm || !recoverStatus) return;
    if (String(latestCampaign?.state || '').toUpperCase() !== 'IDLE') {
      setText('campaign-history-status', 'Finish the live campaign before recovering an archive.');
      return;
    }

    const record = campaignHistory.find((item) => item.filename === filename);
    if (!record) return;
    selectedRecoveryFilename = filename;
    recoverStatus.textContent = '';
    recoverConfirm.disabled = false;
    const drawOption = document.querySelector('#campaign-recover-state option[value="DRAWN"]');
    if (drawOption) drawOption.disabled = !(record.winner_count > 0);
    document.getElementById('campaign-recover-state').value = 'ACTIVE';
    document.getElementById('campaign-recover-description').textContent =
      `Restore "${record.title || 'Untitled campaign'}" with ${formatCount(record.entry_count)} entries.`;
    openModal(recoverModal, '#campaign-recover-state');
  }

  async function recoverCampaign() {
    if (!selectedRecoveryFilename || !recoverConfirm || !recoverStatus) return;
    recoverConfirm.disabled = true;
    recoverStatus.textContent = 'Recovering archived campaign…';
    try {
      const state = document.getElementById('campaign-recover-state').value;
      const result = await sendRemote('recover_campaign_from_history', {
        filename: selectedRecoveryFilename,
        state,
      });
      recoverStatus.textContent = result?.message || 'Campaign recovered.';
      clearRecentWinnerDraw();
      closeModal(recoverModal);
      selectedRecoveryFilename = null;
      setView('campaign');
    } catch (error) {
      console.error('[Campaign] Recovery failed:', error);
      recoverStatus.textContent = `Could not recover campaign: ${error.message}`;
      recoverConfirm.disabled = false;
    }
  }

  function formatDuration(started, ended) {
    const start = Date.parse(started);
    if (!Number.isFinite(start)) return '—';
    const end = ended ? Date.parse(ended) : Date.now();
    if (!Number.isFinite(end) || end < start) return '—';
    const totalMinutes = Math.floor((end - start) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toLocaleString()}h ${String(minutes).padStart(2, '0')}m`;
  }

  function getDisplayCampaign(state = window.state) {
    const runtime = toPlain(state?.runtime);
    const campaign = toPlain(runtime?.campaign);
    return campaign && typeof campaign === 'object' ? campaign : null;
  }

  function getCampaignEntries(campaign) {
    return Array.isArray(campaign?.entries) ? campaign.entries.filter((entry) => entry && typeof entry === 'object') : [];
  }

  function getCampaignRaids(campaign) {
    return Array.isArray(campaign?.raiders) ? campaign.raiders.filter((raid) => raid && typeof raid === 'object') : [];
  }

  function getTimestampNumber(record, field) {
    const value = Date.parse(record?.[field] || '');
    return Number.isFinite(value) ? value : 0;
  }

  function updateLifecycle(state) {
    const steps = [...document.querySelectorAll('[data-campaign-step]')];
    const connectors = [...document.querySelectorAll('[data-campaign-connector]')];
    const normalized = String(state || 'IDLE').toUpperCase();
    const stateIndex = { IDLE: 0, ACTIVE: 1, CLOSED: 2, DRAWN: 3, COMPLETED: 3 }[normalized];
    const currentIndex = Number.isInteger(stateIndex) ? stateIndex : -1;

    steps.forEach((step, index) => {
      step.classList.toggle('is-complete', currentIndex >= 0 && index < currentIndex);
      step.classList.toggle('is-current', index === currentIndex);
      if (index === currentIndex) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    connectors.forEach((connector) => {
      connector.classList.toggle('is-complete', currentIndex > Number(connector.dataset.campaignConnector));
    });
  }

  function updateCampaignState(campaign) {
    const state = String(campaign.state || 'IDLE').toUpperCase();
    const names = { IDLE: 'Idle', ACTIVE: 'Active', CLOSED: 'Locked', DRAWN: 'Drawn', COMPLETED: 'Completing' };
    const details = {
      IDLE: 'Campaign is ready to start',
      ACTIVE: 'Entries are open',
      CLOSED: 'Entries are closed',
      DRAWN: 'Winner selected',
      COMPLETED: 'Archiving campaign',
    };
    const stateStat = document.querySelector('.campaign-stat--state');
    const stateChip = document.querySelector('.campaign-state-chip');
    const stateClass = ['idle', 'active', 'closed', 'drawn'].includes(state.toLowerCase())
      ? state.toLowerCase()
      : 'idle';

    stateStat?.classList.remove('is-idle', 'is-active', 'is-closed', 'is-drawn');
    stateStat?.classList.add(`is-${stateClass}`);
    stateChip?.classList.remove('is-idle', 'is-active', 'is-closed', 'is-drawn');
    stateChip?.classList.add(`is-${stateClass}`);
    setText('campaign-status-label', names[state] || 'Unknown');
    setText('campaign-status-detail', details[state] || `State: ${state}`);
    setText('campaign-control-state', names[state] || 'Unknown');
    updateLifecycle(state);
    updateCampaignControls(campaign);
    updateCampaignHistoryState(state);
  }

  function updateCampaignControls(campaign) {
    const state = String(campaign?.state || 'UNKNOWN').toUpperCase();
    const primary = document.getElementById('campaign-primary-action');
    const primaryIcon = document.getElementById('campaign-primary-action-icon');
    const primaryLabel = document.getElementById('campaign-primary-action-label');
    const draw = document.getElementById('campaign-draw-action');
    const finish = document.getElementById('campaign-finish-action');
    if (!primary || !draw || !finish) return;

    const primaryAvailable = state === 'IDLE' || state === 'ACTIVE';
    const drawAvailable = state === 'CLOSED' || state === 'DRAWN';
    const finishAvailable = state === 'DRAWN';

    if (primaryIcon) primaryIcon.textContent = state === 'ACTIVE' ? 'Ⅱ' : '▶';
    if (primaryLabel) primaryLabel.textContent = state === 'ACTIVE' ? 'Lock entries' : 'Start campaign';
    primary.disabled = campaignActionPending || !primaryAvailable;
    draw.disabled = campaignActionPending || !drawAvailable;
    finish.disabled = campaignActionPending || !finishAvailable;

    const hints = {
      IDLE: 'Start a campaign to open entries.',
      ACTIVE: 'Entries are open. Lock entries when you are ready to draw.',
      CLOSED: 'Entries are locked. Draw a winner to enable archiving.',
      DRAWN: 'Winner selected. Draw another winner or finish & archive.',
      COMPLETED: 'Campaign is being archived.',
    };
    setText('campaign-controls-note', hints[state] || 'Campaign controls are unavailable.');
  }

  function updateCampaignMetadata(campaign) {
    const title = String(campaign.title || '').trim();
    const reward = String(campaign.reward || '').trim();
    const configCampaign = toPlain(window.state?.config);
    const redemption = configCampaign?.giveaway?.campaign?.event_sub_redemption;
    const hasRedemptionConfig = Boolean(redemption && typeof redemption.enabled === 'boolean');
    const enabled = redemption?.enabled === true;
    const cost = Number(redemption?.cost);

    setText('campaign-current-title', title || 'Untitled campaign');
    const titleInput = document.getElementById('campaign-title-value');
    const rewardInput = document.getElementById('campaign-reward-value');
    savedMetadata.title = title;
    savedMetadata.reward = reward;
    if (titleInput && !dirtyMetadataFields.has('title')) titleInput.value = title;
    if (rewardInput && !dirtyMetadataFields.has('reward')) rewardInput.value = reward;

    setText(
      'campaign-platform-label',
      !hasRedemptionConfig ? 'REDEMPTION SETTINGS UNKNOWN' : enabled ? 'CHANNEL POINTS ENTRY' : 'REDEMPTION DISABLED',
    );
    setText(
      'campaign-redemption-title',
      !hasRedemptionConfig ? 'Campaign entry' : enabled ? 'Entry through channel points' : 'Channel-point entry disabled',
    );
    setText(
      'campaign-redemption-detail',
      !hasRedemptionConfig
        ? 'Redemption settings are unavailable in the current snapshot.'
        : enabled
          ? 'Eligible viewers can redeem the campaign ticket reward on Twitch.'
          : 'Channel-point redemptions are disabled in campaign settings.',
    );
    setText(
      'campaign-redemption-cost',
      !hasRedemptionConfig ? '—' : enabled && Number.isFinite(cost) ? `${formatCount(cost)} points` : 'Disabled',
    );
  }

  function updateCampaignStats(campaign, entries, raids) {
    const unique = new Set(entries.map((entry) => {
      if (entry.mb_id !== null && entry.mb_id !== undefined) return `mb:${entry.mb_id}`;
      if (entry.twitch_id !== null && entry.twitch_id !== undefined) return `twitch:${entry.twitch_id}`;
      return `entry:${entry.uuid || entries.indexOf(entry)}`;
    }));
    const viewers = raids.reduce((total, raid) => {
      const count = Number(raid.viewer_count);
      return total + (Number.isFinite(count) && count > 0 ? count : 0);
    }, 0);
    setText('campaign-entry-count', formatCount(entries.length));
    setText('campaign-unique-count', `${formatCount(unique.size)} unique participant${unique.size === 1 ? '' : 's'}`);
    setText('campaign-table-entry-count', formatCount(entries.length));
    setText('campaign-raid-viewer-total', formatCount(viewers));
    setText('campaign-raid-count', `Across ${formatCount(raids.length)} raid${raids.length === 1 ? '' : 's'}`);
    setText('campaign-runtime-value', formatDuration(campaign.started, campaign.ended));
    setText(
      'campaign-runtime-detail',
      campaign.started ? `Started ${formatTimestamp(campaign.started, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not started',
    );
    setText('campaign-raids-total', `${formatCount(raids.length)} raid${raids.length === 1 ? '' : 's'}`);
    setText('campaign-raids-footer', `Total viewers across raids: ${formatCount(viewers)}`);
  }

  function renderEntries(entries) {
    const body = document.getElementById('campaign-entries-body');
    if (!body) return;
    body.replaceChildren();

    if (!entries.length) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="4" class="campaign-empty-row">No campaign entries yet.</td>';
      body.append(row);
      setText('campaign-table-summary', 'No campaign entries yet.');
      return;
    }

    const weightedEntries = entries.map((entry) => {
      const weight = Number(entry.weight);
      return { entry, weight: Number.isFinite(weight) && weight > 0 ? weight : 0 };
    });
    const totalWeight = weightedEntries.reduce((total, item) => total + item.weight, 0);
    const recentEntries = [...weightedEntries]
      .sort((left, right) => getTimestampNumber(right.entry, 'entered_at') - getTimestampNumber(left.entry, 'entered_at'))
      .slice(0, 8);
    const avatarClasses = ['violet', 'blue', 'mint', 'gold'];

    recentEntries.forEach(({ entry, weight }, index) => {
      const username = String(entry.twitch_username || entry.username || 'Unknown viewer');
      const row = document.createElement('tr');
      const participant = document.createElement('td');
      const avatar = document.createElement('span');
      avatar.className = `campaign-avatar campaign-avatar--${avatarClasses[index % avatarClasses.length]}`;
      avatar.textContent = username.charAt(0).toUpperCase() || '?';

      const person = document.createElement('span');
      person.className = 'campaign-person';
      const name = document.createElement('strong');
      name.textContent = username;
      const linked = document.createElement('small');
      linked.textContent = entry.discord_id || entry.discord_uid ? 'Discord linked' : 'Discord not linked';
      person.append(name, linked);
      participant.append(avatar, person);

      const sourceCell = document.createElement('td');
      const source = document.createElement('span');
      source.className = 'campaign-source';
      const sourceValue = String(entry.source || 'Unknown');
      const sourceLabels = { eventsub: 'Channel points', channel_points: 'Channel points', discord: 'Discord' };
      const sourceIcon = document.createElement('img');
      sourceIcon.src = './assets/logo.svg';
      sourceIcon.alt = '';
      sourceIcon.setAttribute('aria-hidden', 'true');
      source.append(
        sourceIcon,
        document.createTextNode(sourceLabels[sourceValue.toLowerCase()] || sourceValue.replace(/[_-]+/g, ' ')),
      );
      sourceCell.append(source);

      const weightCell = document.createElement('td');
      const weightText = document.createElement('strong');
      weightText.textContent = formatWeight(weight);
      weightCell.append(weightText);

      const oddsCell = document.createElement('td');
      const odds = document.createElement('span');
      odds.className = 'campaign-odds';
      odds.textContent = `${totalWeight > 0 ? ((weight / totalWeight) * 100).toFixed(1) : '0.0'}%`;
      oddsCell.append(odds);
      row.append(participant, sourceCell, weightCell, oddsCell);
      body.append(row);
    });

    setText('campaign-table-summary', `Showing ${recentEntries.length} recent entr${recentEntries.length === 1 ? 'y' : 'ies'} of ${formatCount(entries.length)}.`);
  }

  function updateWinner(campaign, entries) {
    const winnerId = campaign.winner;
    const winnerIds = Array.isArray(campaign.winners) && campaign.winners.length
      ? campaign.winners.map(String)
      : winnerId ? [String(winnerId)] : [];
    const winner = entries.find((entry) => String(entry.uuid) === String(winnerId));
    const name = winner?.twitch_username || winner?.username;
    const panel = document.getElementById('campaign-winner-panel');
    const winnersList = document.getElementById('campaign-winners-list');
    panel?.classList.toggle('has-winner', winnerIds.length > 0);
    if (!winnerId) clearRecentWinnerDraw();
    setText('campaign-winner-name', name ? String(name) : winnerId ? 'Winner selected' : 'No winner yet');
    setText(
      'campaign-winner-detail',
      name
        ? `${winnerIds.length > 1 ? `Latest of ${winnerIds.length} winners` : 'Selected from the campaign entries.'}`
        : winnerId
          ? 'Winner entry details are not available in the current snapshot.'
          : 'Lock entries to prepare for the draw.',
    );
    const drawResult = latestDrawResult?.uuid === String(winnerId) ? latestDrawResult : null;
    renderWinnerDrawDetails(drawResult);
    if (
      panel &&
      drawResult &&
      pendingWinnerRevealId === String(winnerId) &&
      lastRevealedWinnerId !== String(winnerId)
    ) {
      pendingWinnerRevealId = null;
      lastRevealedWinnerId = String(winnerId);
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        panel.classList.remove('is-revealing');
        void panel.offsetWidth;
        panel.classList.add('is-revealing');
      }
    }
    if (winnersList) {
      winnersList.replaceChildren();
      winnerIds.forEach((id, index) => {
        const winnerEntry = entries.find((entry) => String(entry.uuid) === id);
        const item = document.createElement('li');
        item.textContent = `Winner ${index + 1}: ${
          winnerEntry?.twitch_username || winnerEntry?.username || 'Participant'
        }`;
        winnersList.append(item);
      });
      winnersList.hidden = winnerIds.length < 2;
    }
  }

  function renderWinnerDrawDetails(drawResult) {
    const container = document.getElementById('campaign-winner-stats');
    if (!container) return;
    container.replaceChildren();
    const metrics = [];
    const entryCount = Number(drawResult?.entry_count);
    const weight = Number(drawResult?.effective_weight);
    const odds = Number(drawResult?.odds_percent);
    if (drawResult?.entry_count != null && Number.isFinite(entryCount) && entryCount >= 0) {
      metrics.push(['Entries', `${entryCount.toLocaleString()} ${entryCount === 1 ? 'entry' : 'entries'}`]);
    }
    if (drawResult?.effective_weight != null && Number.isFinite(weight) && weight >= 0) {
      metrics.push(['Weight', `${weight.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`]);
    }
    if (drawResult?.odds_percent != null && Number.isFinite(odds) && odds >= 0 && odds <= 100) {
      metrics.push(['Odds this draw', `${odds.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`]);
    }
    metrics.forEach(([label, value]) => {
      const metric = document.createElement('span');
      metric.className = 'campaign-winner-stat';
      const metricLabel = document.createElement('small');
      metricLabel.textContent = label;
      const metricValue = document.createElement('strong');
      metricValue.textContent = value;
      metric.append(metricLabel, metricValue);
      container.append(metric);
    });
    container.hidden = metrics.length === 0;
  }

  function clearRecentWinnerDraw() {
    latestDrawResult = null;
    pendingWinnerRevealId = null;
    lastRevealedWinnerId = null;
    document.getElementById('campaign-winner-panel')?.classList.remove('is-revealing');
    renderWinnerDrawDetails(null);
  }

  function parseActivityLine(line) {
    const parts = String(line).split(' - ');
    const timestamp = parts.shift() || '';
    const actorValue = parts.shift() || '[SYSTEM]';
    const message = parts.join(' - ');
    const match = message.match(/^(.*?) \((.*)\)$/);
    const action = (match ? match[1] : message) || 'Campaign update';
    const details = match ? match[2] : '';
    const actor = actorValue === '[SYSTEM]'
      ? 'System'
      : actorValue.replace(/^\([^)]*\)\s*/, '').trim() || 'Viewer';
    return { timestamp, actor, action, details };
  }

  function renderActivity(campaign) {
    const list = document.getElementById('campaign-activity-list');
    if (!list) return;
    list.replaceChildren();
    const activity = Array.isArray(campaign.activity) ? campaign.activity : [];
    if (!activity.length) {
      const empty = document.createElement('li');
      empty.className = 'campaign-empty-row';
      empty.textContent = 'No campaign activity yet.';
      list.append(empty);
      setText('campaign-activity-footnote', 'Activity from the current campaign');
      return;
    }

    activity.slice(0, 8).forEach((line) => {
      const event = parseActivityLine(line);
      const item = document.createElement('li');
      item.className = 'campaign-activity-item';
      const icon = document.createElement('span');
      const action = event.action.toLowerCase();
      const iconType = action.includes('raid') ? 'raid' : /enter|entry|refund|duplicate/.test(action) ? 'entry' : 'system';
      icon.className = `campaign-activity-icon campaign-activity-icon--${iconType}`;
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = iconType === 'raid' ? '↗' : iconType === 'entry' ? '＋' : '●';

      const content = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = event.action;
      const detail = document.createElement('p');
      detail.textContent = [event.actor !== 'System' ? event.actor : '', event.details].filter(Boolean).join(' · ') || event.actor;
      const time = document.createElement('time');
      const parsed = Date.parse(event.timestamp);
      if (Number.isFinite(parsed)) time.dateTime = new Date(parsed).toISOString();
      time.textContent = formatTimestamp(event.timestamp);
      content.append(title, detail, time);
      item.append(icon, content);
      list.append(item);
    });
    setText('campaign-activity-footnote', `${formatCount(activity.length)} campaign event${activity.length === 1 ? '' : 's'} recorded`);
  }

  function renderRaids(raids) {
    const list = document.getElementById('campaign-raids-list');
    if (!list) return;
    list.replaceChildren();
    if (!raids.length) {
      const empty = document.createElement('p');
      empty.className = 'campaign-empty-row';
      empty.textContent = 'No campaign raids yet.';
      list.append(empty);
      return;
    }

    [...raids]
      .sort((left, right) => getTimestampNumber(right, 'raided_at') - getTimestampNumber(left, 'raided_at'))
      .slice(0, 5)
      .forEach((raid, index) => {
        const username = String(raid.login || raid.username || raid.display_name || 'Unknown raider');
        const row = document.createElement('div');
        row.className = 'campaign-raid-row';
        const avatar = document.createElement('span');
        avatar.className = `campaign-avatar campaign-avatar--${['gold', 'blue', 'mint', 'violet'][index % 4]}`;
        avatar.textContent = username.charAt(0).toUpperCase() || '?';
        const person = document.createElement('span');
        person.className = 'campaign-raid-person';
        const name = document.createElement('strong');
        name.textContent = username;
        const time = document.createElement('small');
        time.textContent = formatTimestamp(raid.raided_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        person.append(name, time);
        const viewers = document.createElement('span');
        viewers.className = 'campaign-raid-viewers';
        const viewerCount = Number(raid.viewer_count);
        viewers.append(document.createTextNode(formatCount(Number.isFinite(viewerCount) ? viewerCount : 0)));
        const viewerLabel = document.createElement('small');
        viewerLabel.textContent = 'viewers';
        viewers.append(viewerLabel);
        row.append(avatar, person, viewers);
        list.append(row);
      });
  }

  function renderCampaign(state = window.state) {
    const campaign = getDisplayCampaign(state);
    if (!campaign) {
      latestCampaign = null;
      setText('campaign-data-status', 'Waiting for bot state');
      document.getElementById('campaign-data-badge')?.classList.remove('is-live');
      setText('campaign-status-label', 'Unavailable');
      setText('campaign-status-detail', 'Campaign data has not arrived');
      setText('campaign-current-title', 'Campaign data unavailable');
      setText('campaign-entry-count', '—');
      setText('campaign-unique-count', '— unique participants');
      setText('campaign-raid-viewer-total', '—');
      setText('campaign-raid-count', 'Across — raids');
      setText('campaign-runtime-value', '—');
      setText('campaign-runtime-detail', 'Not started');
      setText('campaign-control-state', 'Unavailable');
      setText('campaign-table-entry-count', '0');
      setText('campaign-table-summary', 'Campaign data is not available.');
      setText('campaign-raids-total', '0 raids');
      setText('campaign-raids-footer', 'Raid data is not available.');
      updateCampaignControls({ state: 'UNKNOWN' });
      updateCampaignHistoryState('UNKNOWN');
      updateLifecycle('UNKNOWN');
      renderEntries([]);
      renderActivity({});
      renderRaids([]);
      updateWinner({}, []);
      return;
    }

    const entries = getCampaignEntries(campaign);
    const raids = getCampaignRaids(campaign);
    latestCampaign = campaign;
    setText('campaign-data-status', 'Live campaign data');
    document.getElementById('campaign-data-badge')?.classList.add('is-live');
    updateCampaignState(campaign);
    updateCampaignMetadata(campaign);
    updateCampaignStats(campaign, entries, raids);
    renderEntries(entries);
    updateWinner(campaign, entries);
    renderActivity(campaign);
    renderRaids(raids);
  }

  function getCampaignConfig() {
    const configState = window.state?.config;
    const config = typeof configState?.toObject === 'function'
      ? configState.toObject()
      : configState;
    const campaign = config?.giveaway?.campaign;
    if (!campaign || typeof campaign !== 'object') {
      throw new Error('Campaign settings are unavailable from the bot state.');
    }
    return campaign;
  }

  function readRequiredNumber(value, label, minimum, integer = false) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
      throw new Error(`${label} is required.`);
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || (integer && !Number.isInteger(number))) {
      throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}at least ${minimum}.`);
    }
    return number;
  }

  function validateCampaignConfig(campaign) {
    const redemption = campaign.event_sub_redemption;
    const tiers = campaign.subscription_tier_multipliers;
    if (!redemption || typeof redemption.enabled !== 'boolean') {
      throw new Error('Campaign redemption settings are missing or invalid.');
    }
    if (typeof redemption.reward_id !== 'string') {
      throw new Error('Campaign reward ID is missing or invalid.');
    }
    if (!tiers || typeof tiers !== 'object') {
      throw new Error('Campaign subscription multipliers are missing.');
    }

    return {
      event_sub_redemption: {
        enabled: redemption.enabled,
        cost: readRequiredNumber(redemption.cost, 'Redemption cost', 1, true),
        reward_id: redemption.reward_id,
      },
      max_entries_per_user: readRequiredNumber(campaign.max_entries_per_user, 'Maximum entries', 1, true),
      base_weight: readRequiredNumber(campaign.base_weight, 'Base weight', Number.MIN_VALUE),
      follow_age_required: readRequiredNumber(campaign.follow_age_required, 'Required follow age', 0, true),
      subscription_tier_multipliers: {
        tier1: readRequiredNumber(tiers.tier1, 'Tier 1 multiplier', 0),
        tier2: readRequiredNumber(tiers.tier2, 'Tier 2 multiplier', 0),
        tier3: readRequiredNumber(tiers.tier3, 'Tier 3 multiplier', 0),
      },
      follow_graph: validateCurve(campaign.follow_graph, 'Follow-age'),
      raid_graph: validateCurve(campaign.raid_graph, 'Raid'),
    };
  }

  function validateCurve(curve, label) {
    if (!curve || typeof curve !== 'object') {
      throw new Error(`${label} curve settings are missing.`);
    }
    return {
      starting_value: readRequiredNumber(curve.starting_value, `${label} starting value`, 0),
      maximum_bonus: readRequiredNumber(curve.maximum_bonus, `${label} maximum bonus`, 0),
      transition_point: readRequiredNumber(curve.transition_point, `${label} transition point`, Number.MIN_VALUE),
      rise_power: readRequiredNumber(curve.rise_power, `${label} rise power`, Number.MIN_VALUE),
      fall_power: readRequiredNumber(curve.fall_power, `${label} fall power`, Number.MIN_VALUE),
    };
  }

  function openModal(modal, focusSelector) {
    if (!modal) return;
    returnFocus = document.activeElement;
    modal.hidden = false;
    modal.querySelector(focusSelector)?.focus();
  }

  function closeModal(modal, restoreFocus = true) {
    if (!modal) return;
    const wasOpen = !modal.hidden;
    modal.hidden = true;
    if (restoreFocus && wasOpen && returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
      returnFocus.focus();
    }
  }

  function setRedemptionFieldsVisible(enabled) {
    if (redemptionFields) redemptionFields.hidden = !enabled;
  }

  function fillSettingsForm(settings) {
    document.getElementById('campaign-eventsub-enabled').checked = settings.event_sub_redemption.enabled;
    document.getElementById('campaign-eventsub-cost').value = settings.event_sub_redemption.cost;
    document.getElementById('campaign-eventsub-reward-id').value = settings.event_sub_redemption.reward_id;
    document.getElementById('campaign-max-entries').value = settings.max_entries_per_user;
    document.getElementById('campaign-base-weight').value = settings.base_weight;
    document.getElementById('campaign-follow-age').value = settings.follow_age_required;
    document.getElementById('campaign-sub-tier1').value = settings.subscription_tier_multipliers.tier1;
    document.getElementById('campaign-sub-tier2').value = settings.subscription_tier_multipliers.tier2;
    document.getElementById('campaign-sub-tier3').value = settings.subscription_tier_multipliers.tier3;
    setRedemptionFieldsVisible(settings.event_sub_redemption.enabled);
    updateCurveSummary('follow_graph', settings.follow_graph);
    updateCurveSummary('raid_graph', settings.raid_graph);
  }

  function openSettings() {
    if (!settingsModal) return;
    if (settingsStatus) settingsStatus.textContent = '';
    if (settingsSave) settingsSave.disabled = false;
    openModal(settingsModal, '[data-campaign-modal-close]');

    try {
      originalSettings = validateCampaignConfig(getCampaignConfig());
      fillSettingsForm(originalSettings);
    } catch (error) {
      originalSettings = null;
      if (settingsSave) settingsSave.disabled = true;
      if (settingsStatus) settingsStatus.textContent = error.message;
    }
  }

  function collectSettingsForm() {
    return {
      event_sub_redemption: {
        enabled: document.getElementById('campaign-eventsub-enabled').checked,
        cost: readRequiredNumber(document.getElementById('campaign-eventsub-cost').value, 'Redemption cost', 1, true),
      },
      max_entries_per_user: readRequiredNumber(document.getElementById('campaign-max-entries').value, 'Maximum entries', 1, true),
      base_weight: readRequiredNumber(document.getElementById('campaign-base-weight').value, 'Base weight', Number.MIN_VALUE),
      follow_age_required: readRequiredNumber(document.getElementById('campaign-follow-age').value, 'Required follow age', 0, true),
      subscription_tier_multipliers: {
        tier1: readRequiredNumber(document.getElementById('campaign-sub-tier1').value, 'Tier 1 multiplier', 0),
        tier2: readRequiredNumber(document.getElementById('campaign-sub-tier2').value, 'Tier 2 multiplier', 0),
        tier3: readRequiredNumber(document.getElementById('campaign-sub-tier3').value, 'Tier 3 multiplier', 0),
      },
    };
  }

  function createSettingsDiff(current) {
    const changed = {};
    const redemption = {};
    for (const key of ['enabled', 'cost']) {
      if (current.event_sub_redemption[key] !== originalSettings.event_sub_redemption[key]) {
        redemption[key] = current.event_sub_redemption[key];
      }
    }
    if (Object.keys(redemption).length) changed.event_sub_redemption = redemption;

    for (const key of ['max_entries_per_user', 'base_weight', 'follow_age_required']) {
      if (current[key] !== originalSettings[key]) changed[key] = current[key];
    }

    const tierChanges = {};
    for (const key of ['tier1', 'tier2', 'tier3']) {
      if (current.subscription_tier_multipliers[key] !== originalSettings.subscription_tier_multipliers[key]) {
        tierChanges[key] = current.subscription_tier_multipliers[key];
      }
    }
    if (Object.keys(tierChanges).length) changed.subscription_tier_multipliers = tierChanges;
    return changed;
  }

  async function sendRemote(action, payload = {}) {
    const connection = window.connection;
    const bridge = connection?.getBridge?.();
    if (!bridge || !connection.isConnected()) {
      throw new Error('Not connected to the bot server.');
    }

    const response = await bridge.sendWithResponse(action, payload);
    const result = response?.result;
    if (!response?.ok || result === false || result === null || result?.success === false) {
      throw new Error(response?.error || result?.message || `${action} was rejected by the bot.`);
    }
    return result;
  }

  function scheduleMetadataSave(delay = 650) {
    if (metadataSaveTimer) clearTimeout(metadataSaveTimer);
    metadataSaveTimer = setTimeout(() => {
      metadataSaveTimer = null;
      saveCampaignMetadata().catch(() => {});
    }, delay);
  }

  async function saveCampaignMetadata() {
    if (metadataSavePromise) return metadataSavePromise;

    const fields = {
      title: document.getElementById('campaign-title-value'),
      reward: document.getElementById('campaign-reward-value'),
    };
    const changed = {};
    for (const [key, input] of Object.entries(fields)) {
      if (!input || !dirtyMetadataFields.has(key)) continue;
      const value = input.value.trim();
      if (value === savedMetadata[key]) {
        dirtyMetadataFields.delete(key);
      } else {
        changed[key] = value;
      }
    }

    const status = document.getElementById('campaign-metadata-status');
    if (!Object.keys(changed).length) {
      if (status && dirtyMetadataFields.size === 0) status.textContent = 'Campaign details saved.';
      return true;
    }

    if (status) status.textContent = 'Saving campaign details…';
    const savePromise = (async () => {
      await sendRemote('update_campaign_metadata', changed);
      for (const [key, value] of Object.entries(changed)) {
        savedMetadata[key] = value;
        if (fields[key]?.value.trim() === value) dirtyMetadataFields.delete(key);
      }
      if (status) {
        status.textContent = dirtyMetadataFields.size
          ? 'Saving newer campaign detail changes…'
          : 'Campaign details saved.';
      }
      return true;
    })();

    metadataSavePromise = savePromise;
    let saved = false;
    try {
      saved = await savePromise;
      return saved;
    } catch (error) {
      console.error('[Campaign] Metadata save failed:', error);
      if (status) status.textContent = `Campaign details were not saved: ${error.message}`;
      throw error;
    } finally {
      if (metadataSavePromise === savePromise) metadataSavePromise = null;
      if (saved && dirtyMetadataFields.size) scheduleMetadataSave(0);
    }
  }

  async function flushCampaignMetadata() {
    if (metadataSaveTimer) {
      clearTimeout(metadataSaveTimer);
      metadataSaveTimer = null;
    }
    if (metadataSavePromise) await metadataSavePromise;
    if (metadataSaveTimer) {
      clearTimeout(metadataSaveTimer);
      metadataSaveTimer = null;
    }
    if (dirtyMetadataFields.size) await saveCampaignMetadata();
  }

  async function runCampaignAction(action, pendingMessage, successMessage) {
    if (campaignActionPending) return;
    campaignActionPending = true;
    updateCampaignControls(latestCampaign);
    setText('campaign-controls-status', 'Saving pending details and sending command…');

    try {
      await flushCampaignMetadata();
      const result = await sendRemote(action);
      if (action === 'roll_campaign' && result?.winner?.uuid != null) {
        latestDrawResult = { ...result.winner, uuid: String(result.winner.uuid) };
        pendingWinnerRevealId = latestDrawResult.uuid;
        if (latestCampaign && String(latestCampaign.winner) === latestDrawResult.uuid) {
          updateWinner(latestCampaign, getCampaignEntries(latestCampaign));
        }
      }
      const message = action === 'roll_campaign'
        ? result?.message || successMessage
        : successMessage;
      setText('campaign-controls-status', message);
    } catch (error) {
      console.error(`[Campaign] ${action} failed:`, error);
      setText('campaign-controls-status', `${pendingMessage} failed: ${error.message}`);
    } finally {
      campaignActionPending = false;
      updateCampaignControls(latestCampaign);
    }
  }

  async function saveSettings() {
    if (!originalSettings || !settingsStatus || !settingsSave) return;
    settingsStatus.textContent = '';

    let current;
    let changed;
    try {
      current = collectSettingsForm();
      changed = createSettingsDiff(current);
    } catch (error) {
      settingsStatus.textContent = error.message;
      return;
    }

    const hasChanges = Object.keys(changed).length > 0;
    if (!hasChanges && !redemptionSyncPending) {
      settingsStatus.textContent = 'There are no changes to save.';
      return;
    }

    settingsSave.disabled = true;
    try {
      if (hasChanges) {
        await sendRemote('save_config', {
          data: { giveaway: { campaign: changed } },
        });
        redemptionSyncPending = redemptionSyncPending || Boolean(changed.event_sub_redemption);
        originalSettings = {
          ...originalSettings,
          ...current,
          event_sub_redemption: {
            ...originalSettings.event_sub_redemption,
            ...current.event_sub_redemption,
          },
          subscription_tier_multipliers: {
            ...originalSettings.subscription_tier_multipliers,
            ...current.subscription_tier_multipliers,
          },
        };
      }

      if (redemptionSyncPending) {
        try {
          await sendRemote('sync_campaign_redemption');
          redemptionSyncPending = false;
        } catch (error) {
          settingsStatus.textContent = `Settings were saved, but Twitch reward sync failed: ${error.message} Press Save again to retry.`;
          return;
        }
      }

      settingsStatus.textContent = 'Campaign settings saved.';
    } catch (error) {
      console.error('[Campaign] Settings save failed:', error);
      settingsStatus.textContent = error.message || 'Failed to save campaign settings.';
    } finally {
      settingsSave.disabled = false;
    }
  }

  function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : Number(value.toFixed(2)).toString();
  }

  function updateCurveSummary(key, curve) {
    const element = document.getElementById(key === 'follow_graph'
      ? 'campaign-follow-curve-summary'
      : 'campaign-raid-curve-summary');
    if (!element || !curve) return;
    const unit = key === 'follow_graph' ? 'days' : 'viewers';
    element.textContent = `${formatNumber(curve.starting_value)}× start · +${formatNumber(curve.maximum_bonus)}× bonus · ${formatNumber(curve.transition_point)} ${unit}`;
  }

  function openCurveEditor(key) {
    if (!curveModal || !settingsModal) return;
    try {
      const settings = validateCampaignConfig(getCampaignConfig());
      const curve = settings[key];
      currentCurveKey = key;
      originalCurve = { ...curve };
      const isFollowCurve = key === 'follow_graph';
      document.getElementById('campaign-curve-title').textContent = isFollowCurve
        ? 'Follow-age curve'
        : 'Raid viewer curve';
      document.getElementById('campaign-curve-description').textContent = isFollowCurve
        ? 'Preview how follow age affects the entry-weight multiplier.'
        : 'Preview how raid size affects the entry-weight multiplier.';
      document.querySelectorAll('[data-curve-param]').forEach((input) => {
        input.value = curve[input.dataset.curveParam];
      });
      if (curveStatus) curveStatus.textContent = '';
      drawCurve();
      openModal(curveModal, '[data-curve-param]');
    } catch (error) {
      if (settingsStatus) settingsStatus.textContent = error.message;
    }
  }

  function collectCurveForm() {
    return {
      starting_value: readRequiredNumber(document.querySelector('[data-curve-param="starting_value"]').value, 'Starting value', 0),
      maximum_bonus: readRequiredNumber(document.querySelector('[data-curve-param="maximum_bonus"]').value, 'Maximum bonus', 0),
      transition_point: readRequiredNumber(document.querySelector('[data-curve-param="transition_point"]').value, 'Transition point', Number.MIN_VALUE),
      rise_power: readRequiredNumber(document.querySelector('[data-curve-param="rise_power"]').value, 'Rise power', Number.MIN_VALUE),
      fall_power: readRequiredNumber(document.querySelector('[data-curve-param="fall_power"]').value, 'Fall power', Number.MIN_VALUE),
    };
  }

  function drawCurve() {
    const svg = document.getElementById('campaign-curve-chart');
    if (!svg) return;

    let curve;
    try {
      curve = collectCurveForm();
      if (curveStatus) curveStatus.textContent = '';
    } catch (error) {
      if (curveStatus) curveStatus.textContent = error.message;
      svg.replaceChildren();
      return;
    }

    const width = 720;
    const height = 300;
    const margin = { top: 20, right: 24, bottom: 42, left: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maxX = curve.transition_point * 1.25;
    const maxY = Math.max(curve.starting_value + curve.maximum_bonus, 1) * 1.12;
    if (!Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      if (curveStatus) curveStatus.textContent = 'These values are too large to plot.';
      svg.replaceChildren();
      return;
    }
    const xPosition = (x) => margin.left + (x / maxX) * plotWidth;
    const yPosition = (y) => margin.top + plotHeight - (y / maxY) * plotHeight;
    const points = [];

    for (let index = 0; index <= 100; index += 1) {
      const x = (maxX * index) / 100;
      const t = Math.min(Math.max(x / curve.transition_point, 0), 1);
      const rise = Math.pow(t, curve.rise_power);
      const fall = Math.pow(1 - t, curve.fall_power);
      const shaped = rise / (rise + fall);
      const value = curve.starting_value + curve.maximum_bonus * shaped;
      points.push(`${xPosition(x).toFixed(2)},${yPosition(value).toFixed(2)}`);
    }

    const bottom = margin.top + plotHeight;
    const right = margin.left + plotWidth;
    const transitionX = xPosition(curve.transition_point);
    const yAxisLabel = 'Weight multiplier';
    const xAxisLabel = currentCurveKey === 'follow_graph' ? 'Follow age (days)' : 'Raid viewers';
    svg.innerHTML = `
      <line class="campaign-chart-grid" x1="${margin.left}" y1="${yPosition(maxY / 2)}" x2="${right}" y2="${yPosition(maxY / 2)}"></line>
      <line class="campaign-chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${bottom}"></line>
      <line class="campaign-chart-axis" x1="${margin.left}" y1="${bottom}" x2="${right}" y2="${bottom}"></line>
      <line class="campaign-chart-grid" x1="${transitionX}" y1="${margin.top}" x2="${transitionX}" y2="${bottom}" stroke-dasharray="4 5"></line>
      <polyline class="campaign-chart-curve" points="${points.join(' ')}"></polyline>
      <text class="campaign-chart-label" x="${margin.left}" y="${height - 10}" text-anchor="start">0</text>
      <text class="campaign-chart-label" x="${transitionX}" y="${height - 10}" text-anchor="middle">${formatNumber(curve.transition_point)}</text>
      <text class="campaign-chart-label" x="${right}" y="${height - 10}" text-anchor="end">${formatNumber(maxX)}</text>
      <text class="campaign-chart-label" x="${margin.left - 9}" y="${margin.top + 4}" text-anchor="end">${formatNumber(maxY)}</text>
      <text class="campaign-chart-label" x="${margin.left - 9}" y="${bottom}" text-anchor="end">0</text>
      <text class="campaign-chart-label" x="${width / 2}" y="${height - 1}" text-anchor="middle">${xAxisLabel}</text>
      <text class="campaign-chart-label" x="14" y="${height / 2}" text-anchor="middle" transform="rotate(-90 14 ${height / 2})">${yAxisLabel}</text>
    `;
  }

  async function saveCurve() {
    if (!currentCurveKey || !originalCurve || !curveSave || !curveStatus) return;
    curveStatus.textContent = '';

    let curve;
    try {
      curve = collectCurveForm();
    } catch (error) {
      curveStatus.textContent = error.message;
      return;
    }

    const changed = {};
    for (const [key, value] of Object.entries(curve)) {
      if (value !== originalCurve[key]) changed[key] = value;
    }
    if (Object.keys(changed).length === 0) {
      curveStatus.textContent = 'There are no changes to save.';
      return;
    }

    curveSave.disabled = true;
    try {
      await sendRemote('save_config', {
        data: { giveaway: { campaign: { [currentCurveKey]: changed } } },
      });
      originalCurve = curve;
      updateCurveSummary(currentCurveKey, curve);
      curveStatus.textContent = 'Curve saved.';
    } catch (error) {
      console.error('[Campaign] Curve save failed:', error);
      curveStatus.textContent = error.message || 'Failed to save curve.';
    } finally {
      curveSave.disabled = false;
    }
  }

  document.getElementById('campaign-primary-action')?.addEventListener('click', () => {
    const state = String(latestCampaign?.state || '').toUpperCase();
    if (state === 'IDLE') {
      runCampaignAction('start_campaign', 'Starting campaign', 'Campaign started.');
    } else if (state === 'ACTIVE') {
      runCampaignAction('lock_campaign', 'Locking entries', 'Campaign entries locked.');
    }
  });
  document.getElementById('campaign-draw-action')?.addEventListener('click', () => {
    runCampaignAction('roll_campaign', 'Drawing winner', 'Winner selected.');
  });
  document.getElementById('campaign-finish-action')?.addEventListener('click', () => {
    runCampaignAction('finish_campaign', 'Finishing campaign', 'Campaign archived.');
  });
  document.getElementById('campaign-history-body')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-campaign-recover]');
    if (button && !button.disabled) openCampaignRecovery(button.dataset.campaignRecover);
  });
  recoverConfirm?.addEventListener('click', recoverCampaign);

  document.getElementById('campaign-title-value')?.addEventListener('input', () => {
    dirtyMetadataFields.add('title');
    const status = document.getElementById('campaign-metadata-status');
    if (status) status.textContent = 'Campaign details will save automatically…';
    scheduleMetadataSave();
  });
  document.getElementById('campaign-reward-value')?.addEventListener('input', () => {
    dirtyMetadataFields.add('reward');
    const status = document.getElementById('campaign-metadata-status');
    if (status) status.textContent = 'Campaign details will save automatically…';
    scheduleMetadataSave();
  });

  document.getElementById('campaign-settings-toggle')?.addEventListener('click', openSettings);
  document.getElementById('campaign-eventsub-enabled')?.addEventListener('change', (event) => {
    setRedemptionFieldsVisible(event.currentTarget.checked);
  });
  settingsSave?.addEventListener('click', saveSettings);
  curveSave?.addEventListener('click', saveCurve);

  document.querySelectorAll('[data-open-campaign-curve]').forEach((button) => {
    button.addEventListener('click', () => openCurveEditor(button.dataset.openCampaignCurve));
  });
  document.querySelectorAll('[data-curve-param]').forEach((input) => {
    input.addEventListener('input', drawCurve);
  });
  document.querySelectorAll('[data-campaign-modal-close]').forEach((button) => {
    button.addEventListener('click', () => {
      const modal = button.closest('.campaign-modal-overlay');
      if (modal === curveModal) closeModal(curveModal);
      else if (modal === settingsModal) closeModal(settingsModal);
      else if (modal === recoverModal) closeModal(recoverModal);
    });
  });
  [settingsModal, curveModal, recoverModal].forEach((modal) => {
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  if (typeof window.pageControllers.__campaignStateUnsubscribe === 'function') {
    window.pageControllers.__campaignStateUnsubscribe();
  }
  if (window.state?.subscribe) {
    window.pageControllers.__campaignStateUnsubscribe = window.state.subscribe(renderCampaign);
  } else {
    renderCampaign();
  }

  if (window.pageControllers.__campaignRuntimeTimer) {
    clearInterval(window.pageControllers.__campaignRuntimeTimer);
  }
  window.pageControllers.__campaignRuntimeTimer = setInterval(() => {
    const campaign = getDisplayCampaign();
    if (campaign?.started) setText('campaign-runtime-value', formatDuration(campaign.started, campaign.ended));
  }, 60000);

  const handleModalKeydown = (event) => {
    if (event.key !== 'Escape') return;
    if (recoverModal && !recoverModal.hidden) closeModal(recoverModal);
    else if (curveModal && !curveModal.hidden) closeModal(curveModal);
    else if (settingsModal && !settingsModal.hidden) closeModal(settingsModal);
  };
  if (window.pageControllers.__campaignModalKeydownHandler) {
    document.removeEventListener('keydown', window.pageControllers.__campaignModalKeydownHandler);
  }
  document.addEventListener('keydown', handleModalKeydown);
  window.pageControllers.__campaignModalKeydownHandler = handleModalKeydown;

  const handlePageActivate = (event) => {
    if (event.detail?.pageId === 'campaign') publishHeader();
    else {
      closeModal(recoverModal, false);
      closeModal(curveModal, false);
      closeModal(settingsModal, false);
    }
  };

  if (window.pageControllers.__campaignActivateHandler) {
    document.removeEventListener('page:activate', window.pageControllers.__campaignActivateHandler);
  }
  document.addEventListener('page:activate', handlePageActivate);
  window.pageControllers.__campaignActivateHandler = handlePageActivate;
};

window.pageControllers.campaign();
