const appState = {
  activeCss: null,
  activeScript: null,
  activeView: null,
  loadedScripts: new Map(),
  loadedCss: new Map(),
};

window.__viewBootstrapRegistry = window.__viewBootstrapRegistry || {};

// Initialize WebSocket connection
import './update.js';
import { configureConnection, startConnection, getBridge, getConnectionState, subscribeToConnectionState, subscribeToOverlayEvents, getDefaultConnectionUrl } from './connection/connection.js';
import { state } from './connection/state.js';
import { resolveBotUrl } from './connection/discover.js';

// Expose connection utilities globally for pages.
// Published SYNCHRONOUSLY at module load: page scripts check for these globals
// (direct-access bootstraps guard on `!window.state || !window.connection`),
// and getConnectionState() already reports "Disconnected" while no bridge is
// configured yet - so pages must never observe these as missing.
window.connection = {
  getBridge,
  isConnected: () => getBridge()?.connected ?? false,
  getConnectionState,
  subscribeToConnectionState,
  subscribeToOverlayEvents,
};

// Expose state globally for pages
window.state = state;

// Resolve the bot endpoint asynchronously (?ws= override > saved URL >
// localhost fast path > derived page-hostname URL > LAN scan), then configure
// the bridge exactly ONCE. Setting window.MIZUBOT_WS_URL here makes every
// later `configureConnection(getDefaultConnectionUrl())` call (config,
// credentials, giveaway pages) resolve to the same URL instead of
// re-deriving a potentially wrong one.
async function bootstrapConnection() {
  try {
    const botUrl = await resolveBotUrl();
    if (botUrl) {
      window.MIZUBOT_WS_URL = botUrl;
      console.log('[Connection] Bot endpoint resolved:', botUrl);
    }
  } catch (error) {
    console.error('[Connection] Bot endpoint discovery failed:', error);
  }

  // Configure connection with the resolved URL (never empty - discovery
  // falls back to the derived default, whose retry loop takes over).
  configureConnection(
    getDefaultConnectionUrl()
  );

  // Start connection
  startConnection();

  // Relay bot overlay_signal packets to the local overlay server (Electron main).
  // In a plain browser this is a no-op (no server can be hosted in a renderer).
  subscribeToOverlayEvents((overlayEvent) => {
    if (window.electronAPI?.sendOverlaySignal) {
      window.electronAPI.sendOverlaySignal(overlayEvent);
    } else {
      console.log('[OverlayRelay] overlay event (browser mode, not relayed):', overlayEvent.event);
    }
  });

  // Return to the login page when an authenticated session drops.
  let hadAuthenticatedSession = false;
  let redirectingToLogin = false;

  subscribeToConnectionState((connectionState) => {
    if (connectionState.authenticated) {
      hadAuthenticatedSession = true;
      return;
    }

    if (!connectionState.connected && hadAuthenticatedSession && !redirectingToLogin) {
      hadAuthenticatedSession = false;
      redirectingToLogin = true;
      window.app.showLogin()
        .catch((error) => console.error('Unable to return to login after disconnect:', error))
        .finally(() => {
          redirectingToLogin = false;
        });
    }
  });
}

bootstrapConnection();


async function loadView({ htmlPath, cssPath, jsPath, viewId }) {
  const root = document.getElementById('app');
  if (!root) return;

  const key = viewId || htmlPath;

  const html = await fetch(`${htmlPath}?t=${Date.now()}`).then((response) => {
    if (!response.ok) throw new Error(`Failed to load ${htmlPath}`);
    return response.text();
  });

  if (appState.activeView) {
    window.dispatchEvent(new CustomEvent('app:view-will-change', {
      detail: { from: appState.activeView, to: key },
    }));
  }

  root.innerHTML = html;
  root.dataset.viewKey = key;

  const versionElement = document.getElementById('app-version');
  if (versionElement && window.electronAPI?.getVersion) {
    window.electronAPI.getVersion()
      .then((version) => {
        if (versionElement.isConnected) versionElement.textContent = `v${version}`;
      })
      .catch((error) => console.error('Unable to load WebUI version:', error));
  }

  if (appState.activeCss) {
    appState.activeCss.remove();
    appState.activeCss = null;
  }

  if (cssPath) {
    const cssKey = `${key}:${cssPath}`;
    const existingCss = appState.loadedCss.get(cssKey);
    if (existingCss) {
      existingCss.remove();
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${cssPath}?t=${Date.now()}`;
    link.dataset.viewKey = key;
    document.head.appendChild(link);
    appState.loadedCss.set(cssKey, link);
    appState.activeCss = link;
  }

  if (jsPath) {
    const jsKey = `${key}:${jsPath}`;
    let script = appState.loadedScripts.get(jsKey);
    if (!script) {
      script = document.createElement('script');
      script.src = `${jsPath}?t=${Date.now()}`;
      script.dataset.viewKey = key;
      document.head.appendChild(script);

      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${jsPath}`));
      });

      appState.loadedScripts.set(jsKey, script);
    }
    appState.activeScript = script;
  }

  const bootstrap = window.__viewBootstrapRegistry?.[key];
  if (typeof bootstrap === 'function') {
    bootstrap(key);
  }

  appState.activeView = key;
}

window.app = {
  async navigateToDashboard() {
    await loadView({
      htmlPath: './ui/dashboard.html',
      cssPath: './ui/dashboard.css',
      jsPath: './ui/dashboard.js',
      viewId: 'dashboard',
    });
  },
  async showLogin() {
    await loadView({
      htmlPath: './ui/pages/login/index.html',
      cssPath: './ui/pages/login/style.css',
      jsPath: './ui/pages/login/script.js',
      viewId: 'login',
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  window.app.showLogin().catch((error) => {
    console.error(error);
    document.getElementById('app').innerHTML = '<div class="page-loading">Unable to load the RemoteUI shell.</div>';
  });
});
