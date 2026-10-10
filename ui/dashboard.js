const pageRegistry = [];
const loadedScripts = new Set();
const pageCache = new Map();

window.__viewBootstrapRegistry = window.__viewBootstrapRegistry || {};
window.__viewBootstrapRegistry.dashboard = function bootstrapDashboard() {
  initializeDashboard();
};

let activePageEntry = null;
// Store last-registered header actions per page so cached pages can restore them
const pageHeaderRegistry = new Map();

// Bumped on every page:header event. Lets activatePage tell whether the active
// page published its own header actions during its activation, so it can skip
// the registry restore below (which would otherwise duplicate the buttons).
let headerActionsVersion = 0;

const pageMeta = {
  overview: {
    subtitle: 'Overview of connected systems and quick actions.',
    summary: 'Monitor the active module and keep the stream-control workspace aligned.',
  },
  // general: {
  //   subtitle: 'General stream settings and helper toggles.',
  //   summary: 'Coordinate the core controls that shape your broadcasting experience.',
  // },
  announcement: {
    subtitle: 'Broadcast announcements and audience prompts.',
    summary: 'Schedule and review the messages that drive viewer engagement.',
  },
  commands: {
    subtitle: 'Command library and automation controls.',
    summary: 'Inspect and trigger the command set used for chat and stream management.',
  },
  streamdeck: {
    subtitle: 'Shortcut action board and configuration preview.',
    summary: 'Preview shortcut mappings and send generic actions through the bot connection.',
  },
  giveaway: {
    subtitle: 'Giveaway flow, prizes, and participation tracking.',
    summary: 'Prepare the live giveaway experience and monitor its state at a glance.',
  },
  responses: {
    subtitle: 'Response templates and live reply management.',
    summary: 'Keep favourite replies ready while tracking the latest interaction patterns.',
  },
  // 'stream-dashboard': {
  //   subtitle: 'Live dashboard view for stream activity.',
  //   summary: 'Observe the stream state, recent actions, and open follow-up tasks.',
  // },
  // obs: {
  //   subtitle: 'OBS integration controls and scene state.',
  //   summary: 'Refresh the current OBS state and read the scene health from one place.',
  // },
  credentials: {
    subtitle: 'Connected services and credential management.',
    summary: 'Review who is connected and what automation pathways are currently enabled.',
  },
  database: {
    subtitle: 'Stored data, history, and local records.',
    summary: 'Inspect the saved history and keep the underlying data resources organised.',
  },
  config: {
    subtitle: 'Configuration categories and runtime options.',
    summary: 'Adjust the behaviour of the control surface without leaving the dashboard.',
  },
  // settings: {
  //   subtitle: 'Application preferences and account defaults.',
  //   summary: 'Tune the quality-of-life settings that shape how RemoteUI behaves.',
  // },
  logs: {
    subtitle: 'Event feed and recent output diagnostics.',
    summary: 'Review recent activity to quickly pinpoint issues and follow-ups.',
  },
  test: {
    subtitle: 'Local overlay relay test bench — fire fake events at every connected overlay.',
    summary: 'Verify overlay pages remotely without touching the bot. Hidden from the sidebar; open with Ctrl+Alt+T.',
  },
};

function registerPage(page) {
  pageRegistry.push(page);
}

registerPage({ id: 'overview', name: 'Overview', icon: '◉', path: './ui/pages/overview/index.html', cssPath: './ui/pages/overview/style.css', jsPath: './ui/pages/overview/script.js', preScripts: ['./ui/pages/database/postgre.js'], sensitive: false, group: 'main' });
// registerPage({ id: 'general', name: 'General', icon: '◌', path: './ui/pages/general/index.html', jsPath: './ui/pages/general/script.js', sensitive: false, group: 'main' });
registerPage({ id: 'announcement', name: 'Announcement', icon: '✦', path: './ui/pages/announcement/index.html', cssPath: './ui/pages/announcement/style.css', jsPath: './ui/pages/announcement/script.js', sensitive: false, group: 'stream' });
registerPage({ id: 'commands', name: 'Commands', icon: '⌘', path: './ui/pages/commands/index.html', cssPath: './ui/pages/commands/style.css', jsPath: './ui/pages/commands/script.js', sensitive: false, group: 'stream' });
registerPage({ id: 'streamdeck', name: 'Stream Deck', icon: '▦', path: './ui/pages/streamdeck/index.html', cssPath: './ui/pages/streamdeck/style.css', jsPath: './ui/pages/streamdeck/script.js', sensitive: false, group: 'stream' });
registerPage({ id: 'giveaway', name: 'Giveaway', icon: '🎁', path: './ui/pages/giveaway/index.html', cssPath: './ui/pages/giveaway/style.css', jsPath: './ui/pages/giveaway/script.js', sensitive: false, group: 'stream' });
registerPage({ id: 'responses', name: 'Responses', icon: '↺', path: './ui/pages/responses/index.html', cssPath: './ui/pages/responses/style.css', jsPath: './ui/pages/responses/script.js', sensitive: false, group: 'stream' });
// registerPage({ id: 'stream-dashboard', name: 'Stream Dashboard', icon: '◍', path: './ui/pages/stream-dashboard/index.html', jsPath: './ui/pages/stream-dashboard/script.js', sensitive: false, group: 'main' });
// registerPage({ id: 'obs', name: 'OBS', icon: '◎', path: './ui/pages/obs/index.html', jsPath: './ui/pages/obs/script.js', sensitive: false, group: 'stream' });
registerPage({ id: 'credentials', name: 'Credentials', icon: '◐', path: './ui/pages/credentials/index.html', cssPath: './ui/pages/credentials/style.css', jsPath: './ui/pages/credentials/script.js', preScripts: ['./js/oauth.js', './js/oauth-instagram.js', './js/oauth-dropbox.js'], sensitive: false, group: 'system' });
registerPage({ id: 'database', name: 'Database', icon: '◈', path: './ui/pages/database/index.html', cssPath: './ui/pages/database/style.css', jsPath: './ui/pages/database/script.js', preScripts: ['./ui/pages/database/postgre.js', './ui/pages/database/userCard.js', './ui/pages/database/tableMeta.js'], sensitive: false, group: 'system' });
registerPage({ id: 'config', name: 'Config', icon: '⚙', path: './ui/pages/config/index.html', cssPath: './ui/pages/config/style.css', jsPath: './ui/pages/config/script.js', sensitive: false, group: 'system' });
// registerPage({ id: 'settings', name: 'Settings', icon: '☰', path: './ui/pages/settings/index.html', jsPath: './ui/pages/settings/script.js', sensitive: false, group: 'system' });
registerPage({ id: 'logs', name: 'Logs', icon: '◌', path: './ui/pages/logs/index.html', cssPath: './ui/pages/logs/style.css', jsPath: './ui/pages/logs/script.js', sensitive: true, group: 'system' });
// Hidden dev/test page (group 'dev' is intentionally not in NAV_GROUPS, so it
// never appears in the sidebar). Open with Ctrl+Alt+T.
registerPage({ id: 'test', name: 'Overlay Test', icon: '🧪', path: './ui/pages/test/index.html', cssPath: './ui/pages/test/style.css', jsPath: './ui/pages/test/script.js', sensitive: false, group: 'dev' });

function getPageById(id) {
  return pageRegistry.find((entry) => entry.id === id) || null;
}

// Sidebar group structure. Keep keys in sync with each page's `group` field.
const NAV_GROUPS = [
  { key: 'main', label: 'Main' },
  { key: 'stream', label: 'Stream' },
  { key: 'system', label: 'System' },
];

function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  nav.innerHTML = '';

  NAV_GROUPS.forEach((group) => {
    const pages = pageRegistry.filter((page) => (page.group || 'main') === group.key);
    if (!pages.length) return;

    const label = document.createElement('div');
    label.className = 'nav-group__label';
    label.textContent = group.label;
    nav.appendChild(label);

    pages.forEach((page) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-item';
      button.dataset.pageId = page.id;
      button.textContent = page.name;
      button.addEventListener('click', () => activatePage(page.id));
      nav.appendChild(button);
    });
  });
}

function updateDetailPanel(page) {
  const subtitle = document.getElementById('dashboard-subtitle');

  if (subtitle) subtitle.textContent = pageMeta[page.id]?.subtitle || 'RemoteUI surface placeholder';
}

function getBotStatuses() {
  return window.state?.runtime?.bot_statuses || {};
}

function setServiceStatus(serviceName, label, tone) {
  const indicator = document.querySelector(
    `.status-indicator[data-service="${serviceName}"]`
  );
  if (!indicator) return;

  indicator.textContent = label;
  indicator.classList.remove(
    'status-indicator--offline',
    'status-indicator--online',
    'status-indicator--error'
  );
  indicator.classList.add(`status-indicator--${tone}`);
}

function setServiceDetail(key, value) {
  const element = document.querySelector(
    `[data-service-detail="${key}"]`
  );
  if (element) element.textContent = value == null || value === '' ? '—' : String(value);
}

function formatInstagramEventTime(value) {
  if (value == null || value === '') return 'No events received';

  const timestamp = Number(value);
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function updateOverlayStatusPanel() {
  const getStatus = window.electronAPI?.getOverlayServerStatus;
  if (typeof getStatus !== 'function') {
    setServiceStatus('overlay', 'Unavailable', 'offline');
    setServiceDetail('overlay.relay', 'Electron only');
    setServiceDetail('overlay.clients', '0');
    setServiceDetail('overlay.pages', 'Unavailable');
    return;
  }

  try {
    const status = await getStatus();
    const overlays = Array.isArray(status?.overlays) ? status.overlays : [];
    const clientCount = Number.isFinite(Number(status?.clients))
      ? Number(status.clients)
      : overlays.length;
    const isStarted = status?.started === true;

    setServiceStatus(
      'overlay',
      isStarted ? (clientCount ? `${clientCount} connected` : 'Ready') : 'Offline',
      isStarted ? 'online' : 'offline'
    );
    setServiceDetail(
      'overlay.relay',
      isStarted ? `Live on port ${status.port}` : 'Stopped'
    );
    setServiceDetail('overlay.clients', clientCount);

    const countsByName = new Map();
    overlays.forEach((overlay) => {
      const name = overlay?.name;
      if (!name || name === 'Unknown') return;
      countsByName.set(name, (countsByName.get(name) || 0) + 1);
    });
    const pageNames = Array.from(countsByName, ([name, count]) => (
      count > 1 ? `${name} (${count})` : name
    ));
    setServiceDetail(
      'overlay.pages',
      pageNames.join(', ') || (clientCount ? 'Reload pages to identify' : 'None')
    );
  } catch (error) {
    setServiceStatus('overlay', 'Unavailable', 'error');
    setServiceDetail('overlay.relay', 'Status check failed');
    setServiceDetail('overlay.clients', '—');
    setServiceDetail('overlay.pages', '—');
  }
}

function wireServiceDisclosures() {
  document.querySelectorAll('.service-details').forEach((details) => {
    const summary = details.querySelector('summary');
    const panel = details.querySelector('.service-details__body');
    if (!summary || !panel) return;

    summary.addEventListener('click', (event) => {
      event.preventDefault();
      if (details.dataset.animating === 'true') return;

      const opening = !details.open;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) {
        details.open = opening;
        return;
      }

      if (opening) details.open = true;

      const startHeight = opening ? 0 : panel.getBoundingClientRect().height;
      const endHeight = opening ? panel.scrollHeight : 0;
      details.dataset.animating = 'true';

      const animation = panel.animate(
        [
          { height: `${startHeight}px`, opacity: opening ? 0 : 1 },
          { height: `${endHeight}px`, opacity: opening ? 1 : 0 },
        ],
        { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
      );

      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        if (!opening) details.open = false;
        delete details.dataset.animating;
      };

      animation.onfinish = finalize;
      window.setTimeout(finalize, 280);
    });
  });
}

function updateBotStatusPanel() {
  const statuses = getBotStatuses();
  const irc = statuses.irc;
  const discord = statuses.discord;
  const instagram = statuses.instagram;
  const dropbox = statuses.dropbox;

  const ircConnected = irc?.connected === true;
  setServiceStatus('irc', ircConnected ? 'Online' : 'Offline', ircConnected ? 'online' : 'offline');
  setServiceDetail('irc.server', irc?.server);
  setServiceDetail('irc.port', irc?.port);
  setServiceDetail('irc.channel', irc?.channel);
  setServiceDetail('irc.socket', irc?.socket_connected ? 'Connected' : 'Disconnected');

  const discordLabel = discord?.status || (discord?.connected ? 'Connected' : 'Unavailable');
  setServiceStatus(
    'discord',
    discordLabel,
    discord?.status === 'Error' ? 'error' : discord?.connected ? 'online' : 'offline'
  );
  setServiceDetail('discord.guild', discord?.guild);
  setServiceDetail('discord.channel', discord?.channel);
  setServiceDetail('discord.verify', discord?.verify_channel);
  setServiceDetail('discord.announce', discord?.announce_channel);

  const subscription = instagram?.subscription_status || 'unknown';
  const instagramLabels = {
    subscribed: 'Subscribed',
    failed: 'Failed',
    not_configured: 'Not configured',
    unknown: 'Unknown',
  };
  const instagramTone = subscription === 'subscribed'
    ? 'online'
    : subscription === 'failed'
      ? 'error'
      : 'offline';
  setServiceStatus('instagram', instagramLabels[subscription] || 'Unknown', instagramTone);
  setServiceDetail('instagram.subscription', instagramLabels[subscription] || 'Unknown');
  setServiceDetail('instagram.account', instagram?.account_configured ? 'Configured' : 'Not configured');
  setServiceDetail('instagram.receiver', instagram?.webhook_enabled ? 'Enabled' : 'Disabled');
  setServiceDetail('instagram.last_event', formatInstagramEventTime(instagram?.last_event_at));

  const dropboxEnabled = dropbox?.enabled === true;
  setServiceStatus('dropbox', dropboxEnabled ? 'Enabled' : 'Disabled', dropboxEnabled ? 'online' : 'offline');
  setServiceDetail('dropbox.status', dropbox?.status || (dropboxEnabled ? 'Enabled' : 'Disabled'));
  setServiceDetail('dropbox.last_backup', dropbox?.last_backup);
}

function updateDiscordDetails() {
  const discordData = getBotStatuses().discord;
  if (!discordData) return;

  // Update Discord server name
  const serverName = document.querySelector('.discord-server__name');
  if (serverName && discordData.guild) {
    serverName.textContent = discordData.guild;
  }

  // Update channel names
  const channelNames = {
    announce: discordData.announce_channel,
    verify: discordData.verify_channel,
    claim: discordData.channel,
    store: discordData.store_channel,
    report: discordData.bot_report_channel
  };

  Object.entries(channelNames).forEach(([type, channelName]) => {
    const channelElement = document.querySelector(
      `.channel-name[data-channel-type="${type}"]`
    );

    if (channelElement && channelName) {
      channelElement.textContent = channelName;
    }
  });
}


function updateConnectionStatusPill() {
  const pill = document.getElementById('connection-status-pill');
  if (!pill) return;

  const connectionState = window.connection?.getConnectionState?.() || {
    status: 'disconnected',
    label: 'Disconnected',
  };

  const stateClass = connectionState.status === 'offline'
    ? 'status-pill--offline'
    : connectionState.status === 'primary'
      ? 'status-pill--primary'
      : 'status-pill--disconnected';

  pill.classList.remove('status-pill--disconnected', 'status-pill--offline', 'status-pill--primary');
  pill.classList.add(stateClass);

  const label = pill.querySelector('.status-pill__label');
  if (label) {
    label.textContent = connectionState.label || 'Disconnected';
  }
}

async function loadPageCss(page) {
  if (!page.cssPath) return;

  const existing = document.querySelector(
    `link[data-page-css="${page.id}"]`
  );

  if (existing) {
    // Already loaded
    if (existing.sheet) return;

    // Still loading
    await new Promise((resolve, reject) => {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
    });

    return;
  }

  await new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = page.cssPath;
    link.dataset.pageCss = page.id;

    link.onload = resolve;
    link.onerror = reject;

    document.head.appendChild(link);
  });
}

// In-flight page-script loads keyed by page id. Guards against the same page
// script being evaluated twice when an activation races with the startup
// preload (a second evaluation would stack extra page:activate listeners and
// re-register duplicate header buttons).
const scriptLoadsInFlight = new Map();

// Load a single script tag. Used for both the page's main script and any
// `preScripts` (dependency scripts that must evaluate before the main one).
function loadScriptTag(src, datasetKey, forceReload = false) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = forceReload ? `${src}?t=${Date.now()}` : src;
    script.defer = true;
    script.dataset.pageJs = datasetKey;

    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));

    document.head.appendChild(script);
  });
}

async function loadPageScript(page, { forceReload = false } = {}) {
  if (!page.jsPath) return;
  if (loadedScripts.has(page.id) && !forceReload) return;

  // Coalesce concurrent loads of the same page script.
  if (!forceReload && scriptLoadsInFlight.has(page.id)) {
    return scriptLoadsInFlight.get(page.id);
  }

  const existingScript = document.querySelector(`script[data-page-js="${page.id}"]`);

  if (existingScript) {
    existingScript.remove();
  }

  loadedScripts.delete(page.id);

  const loadPromise = (async () => {
    // Dependency scripts first (e.g. postgre.js must exist before a page's
    // script.js touches window.postgreDB).
    if (Array.isArray(page.preScripts)) {
      for (const preSrc of page.preScripts) {
        const preKey = `${page.id}:pre:${preSrc}`;
        const existingPre = document.querySelector(`script[data-page-js="${preKey}"]`);
        if (existingPre && !forceReload) continue;
        if (existingPre) existingPre.remove();
        await loadScriptTag(preSrc, preKey, forceReload);
      }
    }

    await loadScriptTag(page.jsPath, page.id, forceReload);
    loadedScripts.add(page.id);
  })();

  if (!forceReload) {
    scriptLoadsInFlight.set(page.id, loadPromise);
    loadPromise.finally(() => scriptLoadsInFlight.delete(page.id));
  }

  return loadPromise;
}

async function preloadPage(page, { forceReload = false } = {}) {
  let pageElement = pageCache.get(page.id);

  // If forcing a reload, throw away the cached HTML.
  if (forceReload && pageElement) {
    pageElement.remove();
    pageCache.delete(page.id);
  }

  // Load HTML if it isn't cached.
  if (!pageCache.has(page.id)) {
    const html = await fetch(
      forceReload ? `${ page.path }?t = ${ Date.now() } ` : page.path
    ).then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to load ${ page.path } `);
      }
      return response.text();
    });

    pageElement = document.createElement('div');
    pageElement.className = 'page-container';
    pageElement.dataset.page = page.id;
    pageElement.innerHTML = html;
    pageElement.style.display = 'none';

    pageCache.set(page.id, pageElement);

    const host = document.getElementById('page-host');
    if (host) {
      host.appendChild(pageElement);
    }
  }

  // CSS and JS are loaded before the page is ever shown.
  await Promise.all([
    loadPageCss(page),
    loadPageScript(page, { forceReload }),
  ]);

  return pageElement;
}

async function preloadAllPages() {
  const pages = pageRegistry.filter(
    (page) => page.id !== 'overview'
  );

  await Promise.all(
    pages.map((page) =>
      preloadPage(page).catch((error) => {
        console.warn(`Failed to preload ${ page.id }: `, error);
      })
    )
  );
}


async function activatePage(pageId, { forceReload = false } = {}) {
  const page = getPageById(pageId);
  if (!page) return;

  const host = document.getElementById('page-host');
  const title = document.getElementById('dashboard-title');

  if (!host || !title) return;

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle(
      'is-active',
      item.dataset.pageId === pageId
    );
  });

  title.textContent = page.name;
  activePageEntry = page;
  updateDetailPanel(page);

  // Reset dashboard header actions to defaults on every page switch.
  // dataset.default may legitimately be an empty string, so this must not be
  // gated behind a truthiness check — otherwise the previous page's actions
  // (e.g. the Giveaway "History" button) stay visible on pages that have none.
  try {
    const headerActions = document.querySelector(
      '.dashboard-header__actions'
    );

    if (headerActions && headerActions.dataset) {
      headerActions.innerHTML = headerActions.dataset.default || '';
    }
  } catch (e) {
    // ignore
  }

  // Keep the page hidden while HTML/CSS/JS are prepared.
  const pageElement = await preloadPage(page, { forceReload });

  // Hide every cached page.
  pageCache.forEach((element) => {
    element.style.display = 'none';
  });

  // Now everything is ready, so show the page.
  pageElement.style.display = '';

  // Dispatch page activation so pages can update the header if needed
  const headerActionsVersionAtActivation = headerActionsVersion;

  try {
    const activationEvent = new CustomEvent('page:activate', {
      detail: { pageId: page.id }
    });
    document.dispatchEvent(activationEvent);
  } catch (e) {
    // ignore
  }

  // Restore registered header actions, but only when the active page did not
  // already publish them itself through a page:header event during the
  // activation above. Pages such as Giveaway/Commands/Responses register their
  // actions from within their page:activate handler, so restoring again here
  // would render the buttons twice.
  try {
    const actionsContainer = document.querySelector(
      '.dashboard-header__actions'
    );

    if (
      actionsContainer &&
      pageHeaderRegistry.has(page.id) &&
      headerActionsVersion === headerActionsVersionAtActivation
    ) {
      actionsContainer.innerHTML =
        actionsContainer.dataset.default || '';

      const stored = pageHeaderRegistry.get(page.id);

      if (stored?.actionsHtml) {
        actionsContainer.insertAdjacentHTML(
          'beforeend',
          stored.actionsHtml
        );
      }

      if (typeof stored?.bindHeaderActions === 'function') {
        stored.bindHeaderActions();
      }
    }
  } catch (e) {
    // ignore
  }
}


window.pageControllers = {};

function wireDashboardActions() {
  const refreshBtn = document.querySelector('[data-action="refresh"]');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (activePageEntry) activatePage(activePageEntry.id, { forceReload: true });
    });
  }

  document.querySelector('[data-action="details-refresh"]').addEventListener('click', () => {
    if (activePageEntry) activatePage(activePageEntry.id, { forceReload: true });
  });

  const dashboardShell = document.querySelector('.dashboard-shell');

  // Right-hand details panel: hide/show via the header toggle.
  const detailsToggle = document.querySelector('[data-action="toggle-details"]');
  if (dashboardShell && detailsToggle) {
    detailsToggle.addEventListener('click', () => {
      const hidden = dashboardShell.classList.toggle('is-details-hidden');
      detailsToggle.setAttribute('aria-pressed', String(hidden));
    });
  }

  // Window control buttons (app header)
  const btnMin = document.querySelector('[data-action="minimize"]');
  const btnFs = document.querySelector('[data-action="toggle-fullscreen"]');
  const btnClose = document.querySelector('[data-action="close"]');

  if (btnMin) {
    btnMin.addEventListener('click', () => {
      // Use Electron API if available, otherwise fallback
      if (window.electronAPI?.minimizeWindow) {
        window.electronAPI.minimizeWindow();
      } else if (dashboardShell) {
        dashboardShell.classList.toggle('is-minimized');
      }
    });
  }

  if (btnFs) {
    btnFs.addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (e) {
        console.warn('Fullscreen toggle failed', e);
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      // Use Electron API if available, otherwise fallback
      if (window.electronAPI?.closeWindow) {
        window.electronAPI.closeWindow();
      } else if (dashboardShell) {
        dashboardShell.style.display = 'none';
      }
    });
  }
}

// Ctrl+Alt+T -> jump to the hidden Overlay Test page.
function wireOverlayTestShortcut() {
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && (event.key === 't' || event.key === 'T')) {
      event.preventDefault();
      activatePage('test');
    }
  });
}

// Allow pages to register header actions with the dashboard.
// Pages should dispatch a `CustomEvent('page:header', { detail: { title, subtitle, actionsHtml } })`.
document.addEventListener('page:header', (ev) => {
  const detail = ev.detail || {};
  const actionsContainer = document.querySelector('.dashboard-header__actions');
  if (!actionsContainer) return;

  // Signal that the header was published by a page activation, so activatePage
  // can tell it happened and avoid duplicating the actions via its registry
  // restore (which runs after the page:activate dispatch).
  headerActionsVersion += 1;

  // Ensure the default content is preserved
  if (!actionsContainer.dataset.default) {
    actionsContainer.dataset.default = actionsContainer.innerHTML;
  }

  // Reset to default then append page actions if provided
  actionsContainer.innerHTML = actionsContainer.dataset.default || '';
  if (detail.actionsHtml) {
    actionsContainer.insertAdjacentHTML('beforeend', detail.actionsHtml);
    // Record the actions HTML and binder so cached pages can restore it later
    try {
      const pageId = activePageEntry?.id || null;
      if (pageId) {
        pageHeaderRegistry.set(pageId, {
          actionsHtml: detail.actionsHtml,
          bindHeaderActions: detail.bindHeaderActions,
        });
      }
    } catch (e) {
      // ignore
    }
    if (typeof detail.bindHeaderActions === 'function') {
      detail.bindHeaderActions();
    }
  }

  if (detail.title) {
    const t = document.getElementById('dashboard-title');
    if (t) t.textContent = detail.title;
  }
  if (detail.subtitle) {
    const s = document.getElementById('dashboard-subtitle');
    if (s) s.textContent = detail.subtitle;
  }
});

async function initializeDashboard() {
  const shell = document.querySelector('.dashboard-shell');
  if (!shell) return;
  if (shell.dataset.initialized === 'true') return;

  shell.dataset.initialized = 'true';

  renderSidebar();
  wireDashboardActions();
  wireServiceDisclosures();
  wireOverlayTestShortcut();

  if (window.connection?.getConnectionState) {
    window.addEventListener('connection:state', updateConnectionStatusPill);
  }

  // Subscribe to state changes for dynamic updates
  if (window.state) {
    window.state.subscribe(() => {
      updateBotStatusPanel();
      updateDiscordDetails();
      updateConnectionStatusPill();
    });
  }

  // Forward database credentials to Electron main process for direct Postgres
  if (window.electronAPI?.setDatabaseState) {
    window.state.subscribe(() => {
      if (window.state.database) {
        window.electronAPI.setDatabaseState(window.state.database.toObject());
      }
    });
    // Push initial state if already populated
    if (window.state.database) {
      window.electronAPI.setDatabaseState(window.state.database.toObject());
    }
  }

  // Initial panel updates
  updateBotStatusPanel();
  updateOverlayStatusPanel();
  window.setInterval(updateOverlayStatusPanel, 2500);
  updateDiscordDetails();
  updateConnectionStatusPill();

  // Load and display the first page.
  await activatePage('overview');

  // Quietly preload every other page.
  preloadAllPages();
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDashboard);
} else {
  initializeDashboard();
}
