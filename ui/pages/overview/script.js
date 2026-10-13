window.pageControllers = window.pageControllers || {};

window.pageControllers.overview = function () {
  const root = document.querySelector('.overview-page');
  if (!root) return;
  let overlayRelayIssue = false;

  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => {
    const element = byId(id);
    if (element) element.textContent = value == null || value === '' ? '—' : String(value);
  };
  const setService = (name, state, badge, detail) => {
    const card = root.querySelector(`[data-service-card="${name}"]`);
    if (!card) return;
    card.dataset.state = state;
    card.querySelector('[data-service-badge]').textContent = badge;
    card.querySelector('[data-service-detail]').textContent = detail;
  };

  function timeAgo(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function renderConnection() {
    const connection = window.connection?.getConnectionState?.();
    const status = connection?.status || 'disconnected';
    const tone = status === 'primary' ? 'ok' : status === 'offline' ? 'warn' : 'err';
    const badge = byId('overview-connection');
    if (badge) badge.dataset.state = tone;
    setText(
      'overview-connection-label',
      connection?.label || (status === 'primary' ? 'Bot connected' : 'Bot disconnected')
    );
  }

  function renderStream(state) {
    const card = byId('overview-stream');
    const stream = state?.stream;
    if (!card) return;

    if (!stream || typeof stream.is_live !== 'boolean') {
      card.dataset.state = 'pending';
      setText('overview-stream-status', 'Stream status unavailable');
      setText('overview-stream-title', 'Waiting for stream state…');
      setText('overview-stream-category', 'Connect to the bot to see live stream details.');
      setText('overview-viewers', '—');
      setText('overview-uptime', '—');
      return;
    }

    card.dataset.state = stream.is_live ? 'live' : 'offline';
    setText('overview-stream-status', stream.is_live ? 'You are live' : 'Stream offline');
    setText(
      'overview-stream-title',
      stream.is_live ? (stream.title || 'Live stream') : 'Ready when you are'
    );

    const details = [stream.category, ...(Array.isArray(stream.tags) ? stream.tags.slice(0, 3) : [])]
      .filter((value) => typeof value === 'string' && value.trim());
    setText(
      'overview-stream-category',
      stream.is_live ? (details.join(' · ') || 'No category or tags reported') : 'Stream details appear here while live.'
    );
    setText('overview-viewers', stream.is_live ? Number(stream.viewers || 0).toLocaleString() : '—');
    setText('overview-uptime', stream.is_live ? (stream.uptime || '—') : '—');
  }

  function renderServices(state) {
    const statuses = state?.runtime?.bot_statuses;
    const hasState = Boolean(window.state?.populated);
    const irc = statuses?.irc;
    if (!irc) {
      setService('irc', hasState ? 'off' : 'pending', hasState ? 'Unknown' : 'Waiting', hasState ? 'No IRC status reported' : 'Waiting for bot state');
    } else {
      const connected = irc.connected === true;
      setService(
        'irc',
        connected ? 'ok' : 'err',
        connected ? 'Connected' : 'Disconnected',
        irc.channel ? `#${String(irc.channel).replace(/^#/, '')}` : (irc.server || 'Twitch IRC')
      );
    }

    const discord = statuses?.discord;
    if (!discord) {
      setService('discord', hasState ? 'off' : 'pending', hasState ? 'Unknown' : 'Waiting', hasState ? 'No Discord status reported' : 'Waiting for bot state');
    } else {
      const connected = discord.connected === true;
      const status = discord.status || (connected ? 'Connected' : 'Unavailable');
      const unavailable = !connected && status.toLowerCase() === 'unavailable';
      setService(
        'discord',
        connected ? 'ok' : unavailable ? 'off' : status === 'Error' ? 'err' : 'warn',
        status,
        connected ? (discord.guild || 'Connected to Discord') : 'Discord bot is not connected'
      );
    }

    const database = state?.database_runtime;
    const pg = window.postgreDB;
    const directStatus = pg?.isDirect?.() ? pg.getStatus?.() : null;
    if (directStatus) {
      const connected = directStatus.status === 'cloud' || directStatus.status === 'local';
      const reconnecting = directStatus.status === 'reconnecting';
      setService(
        'database',
        connected ? 'ok' : reconnecting ? 'warn' : 'off',
        directStatus.label || (connected ? 'Connected' : 'Reconnecting'),
        connected ? `PostgreSQL · ${directStatus.label}` : (directStatus.error || 'Retrying database connection')
      );
    } else if (database && typeof database.ready === 'boolean') {
      setService(
        'database',
        database.ready ? 'ok' : 'warn',
        database.ready ? 'Ready' : 'Unavailable',
        database.ready ? `PostgreSQL · ${database.active_role || 'Connected'}` : 'PostgreSQL is not ready'
      );
    } else {
      setService('database', hasState ? 'off' : 'pending', hasState ? 'Unknown' : 'Waiting', 'Database state unavailable');
    }

    const instagram = statuses?.instagram;
    if (!instagram) {
      setService('instagram', hasState ? 'off' : 'pending', hasState ? 'Unknown' : 'Waiting', 'Waiting for bot state');
    } else {
      const subscription = instagram.subscription_status || 'unknown';
      const lastEvent = Number(instagram.last_event_at);
      const lastEventText = Number.isFinite(lastEvent) && lastEvent > 0
        ? `Last event ${timeAgo(lastEvent < 1e12 ? lastEvent * 1000 : lastEvent)}`
        : 'No events received yet';
      const configured = instagram.account_configured === true || instagram.webhook_enabled === true;
      const isFailed = subscription === 'failed';
      const isSubscribed = subscription === 'subscribed';
      const label = isSubscribed ? 'Subscribed' : isFailed ? 'Failed' : configured ? 'Not subscribed' : 'Not configured';
      setService(
        'instagram',
        isSubscribed ? 'ok' : isFailed ? 'err' : 'off',
        label,
        configured ? lastEventText : 'Optional integration'
      );
    }

    const dropbox = statuses?.dropbox;
    if (!dropbox) {
      setService('dropbox', hasState ? 'off' : 'pending', hasState ? 'Unknown' : 'Waiting', 'Waiting for bot state');
    } else {
      const enabled = dropbox.enabled === true;
      setService(
        'dropbox',
        enabled ? 'ok' : 'off',
        enabled ? 'Enabled' : 'Disabled',
        enabled ? `Last backup ${dropbox.last_backup || 'not reported'}` : 'Optional integration'
      );
    }
  }

  function renderGiveaway(state) {
    const runtime = state?.runtime;
    const giveaway = byId('overview-giveaway');
    if (!giveaway) return;
    if (!runtime || !runtime.gw_state) {
      giveaway.dataset.state = 'pending';
      setText('overview-giveaway-state', 'Waiting for state');
      setText('overview-giveaway-runtime', '—');
      setText('overview-giveaway-prize', 'Giveaway details will appear when the bot connects.');
      setText('overview-giveaway-entries', '—');
      setText('overview-scheduler', 'Scheduler: —');
      return;
    }

    const status = String(runtime.gw_state).toUpperCase();
    const active = status === 'RUNNING' || status === 'ROLLING';
    giveaway.dataset.state = active ? 'live' : 'idle';
    setText('overview-giveaway-state', active ? `Giveaway ${status.toLowerCase()}` : 'No active giveaway');
    setText('overview-giveaway-runtime', runtime.gw_runtime || '—');

    const prize = runtime.gw_prize || runtime.gw_title;
    setText(
      'overview-giveaway-prize',
      active ? (prize ? String(prize) : 'Active giveaway · prize not set') : 'Start or schedule a giveaway from the Giveaway page.'
    );
    setText('overview-giveaway-entries', active ? Number(runtime.gw_entries_count || 0).toLocaleString() : '0');

    const scheduler = runtime.scheduler_state;
    const schedulerState = String(scheduler?.state || 'IDLE').toLowerCase();
    const progress = scheduler?.current_loop && scheduler?.completed_loops
      ? ` · loop ${scheduler.current_loop} (${scheduler.completed_loops} completed)`
      : '';
    setText('overview-scheduler', `Scheduler: ${schedulerState}${progress}`);
  }

  function parseLog(line) {
    const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] (.*)$/.exec(String(line));
    if (!match) return { time: '', level: 'INFO', message: String(line) };
    return { time: match[1].slice(11), level: match[2].toUpperCase(), message: match[3] };
  }

  function renderActivity(state) {
    const container = byId('overview-activity-list');
    if (!container) return [];
    const logs = Array.isArray(state?.logs?.system) ? state.logs.system : [];
    container.replaceChildren();

    if (!logs.length) {
      const empty = document.createElement('p');
      empty.className = 'overview-empty';
      empty.textContent = window.state?.populated ? 'No recent system log entries.' : 'Waiting for recent system logs…';
      container.appendChild(empty);
      return [];
    }

    const entries = logs.slice(-6).reverse().map(parseLog);
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'overview-activity__item';
      row.dataset.level = entry.level;

      const level = document.createElement('span');
      level.className = 'overview-activity__level';
      level.textContent = entry.level;

      const message = document.createElement('span');
      message.className = 'overview-activity__message';
      message.textContent = `${entry.time ? `${entry.time} · ` : ''}${entry.message}`;

      row.append(level, message);
      container.appendChild(row);
    });
    return logs.map(parseLog);
  }

  function addIssue(issues, title, detail, page, key) {
    if (!issues.some((issue) => issue.key === key)) {
      issues.push({ title, detail, page, key });
    }
  }

  function renderAttention(state, parsedLogs) {
    const container = byId('overview-attention-list');
    const panel = byId('overview-attention');
    if (!container || !panel) return;

    const issues = [];
    const statuses = state?.runtime?.bot_statuses;
    if (statuses?.irc && statuses.irc.connected !== true) {
      addIssue(issues, 'Twitch chat is disconnected', 'Check the bot connection and channel credentials.', 'credentials', 'irc');
    }
    if (statuses?.discord && statuses.discord.connected !== true && statuses.discord.status !== 'Unavailable') {
      addIssue(issues, 'Discord bot is not connected', statuses.discord.status || 'Check the connection settings.', 'credentials', 'discord');
    }

    const directStatus = window.postgreDB?.isDirect?.() ? window.postgreDB.getStatus?.() : null;
    const databaseReady = directStatus
      ? directStatus.status === 'cloud' || directStatus.status === 'local'
      : state?.database_runtime?.ready;
    if (databaseReady === false) {
      addIssue(issues, 'Database is not ready', directStatus?.label || 'Check the database connection.', 'database', 'database');
    }

    if (statuses?.instagram?.subscription_status === 'failed') {
      addIssue(issues, 'Instagram webhook subscription failed', 'Review the Instagram integration status.', 'credentials', 'instagram');
    }
    if (overlayRelayIssue) {
      addIssue(issues, 'Overlay relay is unavailable', 'Open Overlay Test with Ctrl+Alt+T to inspect the relay.', null, 'overlay');
    }

    parsedLogs
      .filter((entry) => ['WARNING', 'ERROR', 'CRITICAL', 'FATAL'].includes(entry.level))
      .slice(-2)
      .reverse()
      .forEach((entry) => {
        addIssue(
          issues,
          `Recent system ${entry.level.toLowerCase()}`,
          entry.message,
          'logs',
          `log:${entry.level}:${entry.message}`
        );
      });

    const hasState = Boolean(window.state?.populated);
    container.replaceChildren();
    panel.dataset.state = hasState ? (issues.length ? 'warn' : 'ok') : 'pending';
    setText('overview-attention-count', hasState ? String(issues.length) : '—');

    if (!hasState) {
      const empty = document.createElement('p');
      empty.className = 'overview-empty';
      empty.textContent = 'Connect to the bot to see actionable alerts.';
      container.appendChild(empty);
      return;
    }

    if (!issues.length) {
      const empty = document.createElement('p');
      empty.className = 'overview-empty';
      empty.textContent = 'Nothing needs attention right now.';
      container.appendChild(empty);
      return;
    }

    issues.slice(0, 5).forEach((issue) => {
      const row = document.createElement('div');
      row.className = 'overview-attention__item';

      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = issue.title;
      const detail = document.createElement('span');
      detail.textContent = issue.detail;
      copy.append(title, detail);

      row.appendChild(copy);
      if (issue.page) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'overview-link';
        button.dataset.overviewPage = issue.page;
        button.textContent = 'Open';
        row.appendChild(button);
      }
      container.appendChild(row);
    });
  }

  let overlayRequest = 0;
  function refreshAttention() {
    const logs = Array.isArray(window.state?.logs?.system) ? window.state.logs.system : [];
    renderAttention(window.state, logs.map(parseLog));
  }

  async function renderOverlayStatus() {
    const request = ++overlayRequest;
    const getStatus = window.electronAPI?.getOverlayServerStatus;
    if (typeof getStatus !== 'function') {
      overlayRelayIssue = false;
      setService('overlay', 'off', 'Electron only', 'Relay status is available in the desktop app');
      refreshAttention();
      return;
    }

    try {
      const status = await getStatus();
      if (request !== overlayRequest) return;
      if (status?.started !== true) {
        overlayRelayIssue = true;
        setService('overlay', 'warn', 'Offline', 'Local overlay relay is not running');
        refreshAttention();
        return;
      }

      overlayRelayIssue = false;
      const overlays = Array.isArray(status.overlays) ? status.overlays : [];
      const count = Number.isFinite(Number(status.clients)) ? Number(status.clients) : overlays.length;
      const pageNames = [...new Set(overlays.map((overlay) => overlay?.name).filter((name) => name && name !== 'Unknown'))];
      const detail = count
        ? `${count} browser source${count === 1 ? '' : 's'}${pageNames.length ? ` · ${pageNames.join(', ')}` : ''}`
        : `Ready on port ${status.port || 8766} · no browser sources connected`;
      setService('overlay', 'ok', count ? `${count} connected` : 'Ready', detail);
      refreshAttention();
    } catch (error) {
      console.warn('[overview] Overlay relay status check failed', error);
      if (request === overlayRequest) {
        overlayRelayIssue = true;
        setService('overlay', 'err', 'Check failed', 'Could not read local relay status');
        refreshAttention();
      }
    }
  }

  function render(state = window.state) {
    renderConnection();
    renderStream(state);
    renderServices(state);
    renderGiveaway(state);
    const parsedLogs = renderActivity(state);
    renderAttention(state, parsedLogs);
    setText('overview-updated', window.state?.fetchedAt ? `Updated ${timeAgo(window.state.fetchedAt)}` : 'Waiting for state');
  }

  if (typeof window.pageControllers.__overviewUnsubscribe === 'function') {
    window.pageControllers.__overviewUnsubscribe();
  }
  if (window.state?.subscribe) {
    window.pageControllers.__overviewUnsubscribe = window.state.subscribe(render);
  }

  if (typeof window.pageControllers.__overviewPgUnsubscribe === 'function') {
    window.pageControllers.__overviewPgUnsubscribe();
  }
  const handlePgStatus = () => render();
  window.addEventListener('postgre:status', handlePgStatus);
  window.pageControllers.__overviewPgUnsubscribe = () => {
    window.removeEventListener('postgre:status', handlePgStatus);
  };

  if (typeof window.pageControllers.__overviewConnectionUnsubscribe === 'function') {
    window.pageControllers.__overviewConnectionUnsubscribe();
  }
  window.pageControllers.__overviewConnectionUnsubscribe =
    window.connection?.subscribeToConnectionState?.(renderConnection) || (() => {});

  if (window.pageControllers.__overviewActivateHandler) {
    document.removeEventListener('page:activate', window.pageControllers.__overviewActivateHandler);
  }
  let overviewActive = false;
  const handleActivate = (event) => {
    overviewActive = event.detail?.pageId === 'overview';
    if (overviewActive) {
      render();
      renderOverlayStatus();
    }
  };
  document.addEventListener('page:activate', handleActivate);
  window.pageControllers.__overviewActivateHandler = handleActivate;

  if (window.pageControllers.__overviewOverlayTimer) {
    window.clearInterval(window.pageControllers.__overviewOverlayTimer);
  }
  window.pageControllers.__overviewOverlayTimer = window.setInterval(() => {
    if (overviewActive) renderOverlayStatus();
  }, 10000);

  if (window.pageControllers.__overviewClickHandler) {
    root.removeEventListener('click', window.pageControllers.__overviewClickHandler);
  }
  const handleOverviewClick = (event) => {
    const button = event.target.closest('[data-overview-page]');
    if (!button) return;
    const pageId = button.dataset.overviewPage;
    document.querySelector(`.nav-item[data-page-id="${pageId}"]`)?.click();
  };
  root.addEventListener('click', handleOverviewClick);
  window.pageControllers.__overviewClickHandler = handleOverviewClick;

  render();
  renderOverlayStatus();
};

window.pageControllers.overview();
