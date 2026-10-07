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

// Configure connection with fallback
// Primary: Cloudflare tunnel (will be provided by server)
// Fallback: Local server
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

// Expose connection utilities globally for pages
window.connection = {
  getBridge,
  isConnected: () => getBridge()?.connected ?? false,
  getConnectionState,
  subscribeToConnectionState,
  subscribeToOverlayEvents,
};

// Expose state globally for pages
window.state = state;

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

async function loadView({ htmlPath, cssPath, jsPath, viewId }) {
  const root = document.getElementById('app');
  if (!root) return;

  const key = viewId || htmlPath;

  const html = await fetch(`${htmlPath}?t=${Date.now()}`).then((response) => {
    if (!response.ok) throw new Error(`Failed to load ${htmlPath}`);
    return response.text();
  });

  root.innerHTML = html;
  root.dataset.viewKey = key;

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

  if (appState.activeScript) {
    appState.activeScript.remove();
    appState.activeScript = null;
  }

  if (jsPath) {
    const jsKey = `${key}:${jsPath}`;
    const existingScript = appState.loadedScripts.get(jsKey);
    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement('script');
    script.src = `${jsPath}?t=${Date.now()}`;
    script.dataset.viewKey = key;
    document.head.appendChild(script);

    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${jsPath}`));
    });

    appState.loadedScripts.set(jsKey, script);
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
