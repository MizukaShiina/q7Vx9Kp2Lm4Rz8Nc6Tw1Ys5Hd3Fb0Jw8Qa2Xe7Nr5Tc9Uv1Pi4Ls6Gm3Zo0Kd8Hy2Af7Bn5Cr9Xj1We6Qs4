/**
 * OAuth Helper (Credentials page)
 * Generates Twitch OAuth tokens and auto-fills them into the credentials form, so the
 * user only has to click "Save Credentials".
 *
 * - Electron: the token is captured automatically (main.js opens the system
 *   browser and polls Twitch's device-code flow).
 * - Plain browser: falls back to a popup + paste box (same flow as the
 *   Python script — copy the token from the address bar).
 * - Captured tokens are validated instantly against Twitch's /validate
 *   endpoint (account name + scopes) before being filled in.
 *
 * Visibility: the helper card appears on the Twitch credentials card whenever
 * a bot/stream OAuth token is empty OR its matching refresh token is missing.
 * Electron's device flow returns both access and refresh tokens.
 */
(function () {
  'use strict';
  if (window.mizubotOAuth) return; // guard against double evaluation (preScript)

  // Same client id / scopes / redirect as WebUI/generate_token.py.
  const FALLBACK_CLIENT_ID = '7ectttj7x6hnbbg4epyv488r3bwlf4';
  const REDIRECT_URI = 'http://localhost';
  const SCOPES = [
    'chat:read',
    'chat:edit',
    'moderator:read:chatters',
    'channel:read:subscriptions',
    'channel:manage:broadcast',
    'moderator:read:followers',
    'channel:read:redemptions',
  ];

  const TARGETS = [
    {
      key: 'oauth_token',
      refreshKey: 'refresh_token',
      account: 'bot',
      loginHint: 'Log in to Twitch as the BOT account in the authorization window.',
      missingLabel: 'Bot OAuth is not set.',
      regenLabel: 'Bot OAuth is set but the refresh token is missing.',
    },
    {
      key: 'stream_oauth',
      refreshKey: 'stream_refresh_token',
      account: 'streamer',
      loginHint: 'Log in as the STREAMER account (required for the subscriptions scope).',
      missingLabel: 'Stream OAuth is not set.',
      regenLabel: 'Stream OAuth is set but the refresh token is missing.',
    },
  ];

  const REGEN_HINT =
    'Twitch does not issue refresh tokens through this flow — the bot will run ' +
    'on the access token alone, same as generate_token.py.';

  let pendingTarget = null;
  let pasteTarget = null;
  let stateSubscribed = false;
  let lastSignature = null;

  // --------------------------------------------------------------- helpers

  function toPlain(value) {
    if (!value) return {};
    if (typeof value.toObject === 'function') return value.toObject();
    if (typeof value !== 'object') return {};
    return Object.assign({}, value);
  }

  function twitchCreds() {
    return toPlain(window.state?.creds?.twitch);
  }

  function isPopulated() {
    if (!window.state) return false;
    if (window.state.populated !== undefined) return Boolean(window.state.populated);
    return Object.keys(twitchCreds()).length > 0;
  }

  function isEmptyValue(value) {
    if (value === undefined || value === null) return true;
    const text = String(value).trim();
    return text === '' || text.toLowerCase() === 'oauth:';
  }

  function clientId() {
    const creds = twitchCreds();
    const cid = String(creds.client_id || '').trim();
    return cid || FALLBACK_CLIENT_ID;
  }

  function buildImplicitAuthUrl() {
    return (
      'https://id.twitch.tv/oauth2/authorize' +
      '?client_id=' + encodeURIComponent(clientId()) +
      '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
      '&response_type=token' +
      '&scope=' + SCOPES.map(encodeURIComponent).join('+')
    );
  }

  function buildDeviceRequest() {
    return { clientId: clientId(), scopes: SCOPES };
  }

  function normalizeToken(rawToken) {
    if (!rawToken) return '';
    let text = String(rawToken).trim();
    // Accept a full redirect URL pasted from the address bar.
    const match = text.match(/access_token=([^&\s]+)/);
    if (match) text = match[1];
    if (text.toLowerCase().startsWith('oauth:')) text = text.slice(6);
    text = text.trim();
    // Access tokens are plain alphanumeric strings; anything else is junk.
    return /^[A-Za-z0-9]+$/.test(text) ? text : '';
  }

  function subscribeState() {
    if (stateSubscribed) return;
    if (window.state && typeof window.state.subscribe === 'function') {
      try {
        window.state.subscribe(() => evaluate());
        stateSubscribed = true;
      } catch (_error) { /* state not ready yet */ }
    }
  }

  // -------------------------------------------------------------- validate

  async function validateToken(token) {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: 'OAuth ' + token },
    });
    if (!response.ok) {
      return { ok: false, error: 'Twitch rejected the token (HTTP ' + response.status + ')' };
    }
    const data = await response.json();
    return { ok: true, data };
  }

  async function handleCapturedToken(target, rawToken, rawRefreshToken) {
    const token = normalizeToken(rawToken);
    if (!token) {
      setStatus(target, 'error', 'No usable token found in the captured result.');
      showToast('No usable token found.', 'error');
      return;
    }

    setStatus(target, 'busy', 'Validating token…');
    let result;
    try {
      result = await validateToken(token);
    } catch (error) {
      result = { ok: false, error: 'Validate request failed: ' + error.message };
    }

    if (!result.ok) {
      setStatus(target, 'error', result.error);
      showToast('Token rejected: ' + result.error, 'error');
      return;
    }

    const info = result.data || {};
    const granted = Array.isArray(info.scopes) ? info.scopes : [];
    const missingScopes = SCOPES.filter((scope) => !granted.includes(scope));

    const lines = [];
    lines.push('✔ Valid token — authorized as "' + (info.login || info.user_id || 'unknown') + '"');
    if (target.account === 'streamer') {
      const channel = String(window.state?.twitch?.channel || '').trim().toLowerCase();
      if (channel && info.login && info.login.toLowerCase() !== channel) {
        lines.push('⚠ Token is for "' + info.login + '" but your channel is "' + channel + '" — was the streamer account authorized?');
      }
    }
    if (missingScopes.length) {
      lines.push('⚠ Missing scopes: ' + missingScopes.join(', '));
    }

    if (!fillField(target, token)) {
      setStatus(target, 'error', 'Could not find the ' + target.key + ' input on the page.');
      showToast('Could not find the ' + target.key + ' input.', 'error');
      return;
    }
    const refreshToken = normalizeToken(rawRefreshToken);
    if (refreshToken) fillFieldById('creds-field-twitch-' + target.refreshKey, refreshToken);

    setStatus(target, 'ok', lines.join(' '));
    showToast('Token verified (' + target.account + ') — click Save Credentials.', 'success');
  }

  function fillField(target, token) {
    return fillFieldById('creds-field-twitch-' + target.key, token);
  }

  function fillFieldById(id, token) {
    const input = document.getElementById(id);
    if (!input || (input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA')) return false;
    input.value = token;
    input.dataset.userEdited = '1';
    // The credentials page listens for 'input' to set dirty state itself.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // ------------------------------------------------------------------ flow

  async function startFlow(target) {
    if (pendingTarget) {
      showToast('Another OAuth flow is already running.', 'warning');
      return;
    }
    pendingTarget = target;
    updateButtons();
    setStatus(target, 'busy', 'Waiting for Twitch authorization…');

    if (window.electronAPI && typeof window.electronAPI.openOAuthWindow === 'function') {
      try {
        const result = await window.electronAPI.openOAuthWindow(buildDeviceRequest());
        if (result && result.ok && result.token) {
          await handleCapturedToken(target, result.token, result.refreshToken);
        } else if (result && result.canceled) {
          setStatus(target, 'info', 'Authorization window closed without a token.');
        } else {
          const message = (result && result.error) || 'Failed to capture the token.';
          setStatus(target, 'error', message);
          showToast(message, 'error');
        }
      } catch (error) {
        const message = 'OAuth window failed: ' + error.message;
        setStatus(target, 'error', message);
        showToast(message, 'error');
      } finally {
        pendingTarget = null;
        updateButtons();
      }
      return;
    }

    // Plain-browser fallback: popup + paste (the redirect URL cannot be read
    // cross-origin, so the user copies the token from the address bar — the
    // same manual step generate_token.py walks through).
    openPopupFallback(target, buildImplicitAuthUrl());
  }

  function openPopupFallback(target, url) {
    let popup = null;
    try {
      popup = window.open(url, 'twitch_oauth', 'width=520,height=740');
    } catch (_error) { /* popup blocked */ }
    if (!popup) {
      setStatus(target, 'info', 'Popup blocked — open the authorization page manually, then paste the token below.');
    }
    pasteTarget = target;
    renderPasteBox(target);
  }

  function finishPaste(target, rawValue) {
    const token = normalizeToken(rawValue);
    if (!token) {
      setPasteError('Could not read a token from that. Paste the full localhost URL or the token itself.');
      return;
    }
    clearPasteBox();
    pasteTarget = null;
    pendingTarget = null;
    updateButtons();
    handleCapturedToken(target, token);
  }

  // ------------------------------------------------------------------- UI

  function ensureStyles() {
    if (document.getElementById('oauth-helper-styles')) return;
    const style = document.createElement('style');
    style.id = 'oauth-helper-styles';
    style.textContent = [
      '.oauth-helper { display:flex; flex-direction:column; gap:10px; margin:0 0 14px; padding:12px 14px;',
      '  border:1px solid rgba(255,255,255,.08); border-radius:10px; background:rgba(255,255,255,.03); }',
      '.oauth-helper__title { font-size:.85rem; font-weight:600; opacity:.85; }',
      '.oauth-helper__row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }',
      '.oauth-helper__info { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }',
      '.oauth-helper__info strong { font-size:.9rem; }',
      '.oauth-helper__info span { font-size:.78rem; opacity:.65; }',
      '.oauth-helper__status { font-size:.78rem; min-height:1em; white-space:normal; word-break:break-word; }',
      '.oauth-helper__status.is-ok { color:#4ade80; }',
      '.oauth-helper__status.is-warning { color:#fbbf24; }',
      '.oauth-helper__status.is-error { color:#f87171; }',
      '.oauth-helper__status.is-busy { opacity:.7; }',
      '.oauth-helper__paste { display:flex; gap:8px; margin-top:6px; flex-wrap:wrap; }',
      '.oauth-helper__paste input { flex:1; min-width:220px; }',
      '.oauth-helper__btn { flex-shrink:0; }',
      '.oauth-helper__btn:disabled { opacity:.5; cursor:default; }',
    ].join(' ');
    document.head.appendChild(style);
  }

  function findTwitchCard() {
    const fields = document.getElementById('creds-twitch-fields');
    if (!fields) return null;
    return fields.closest('.cfg-card');
  }

  function ensureBanner() {
    const card = findTwitchCard();
    if (!card) return null;
    let banner = document.getElementById('oauth-helper');
    if (banner && banner.parentElement === card) return banner;
    if (banner) banner.remove();
    banner = document.createElement('div');
    banner.id = 'oauth-helper';
    banner.className = 'oauth-helper';
    banner.appendChild(Object.assign(document.createElement('div'), {
      className: 'oauth-helper__title',
      textContent: 'Twitch OAuth generator — missing or incomplete credentials:',
    }));
    const rows = document.createElement('div');
    rows.className = 'oauth-helper__rows';
    banner.appendChild(rows);
    card.insertBefore(banner, card.querySelector('.cfg-fields'));
    return banner;
  }

  function targetState(target) {
    const creds = twitchCreds();
    const oauthEmpty = isEmptyValue(creds[target.key]);
    const refreshMissing = isEmptyValue(creds[target.refreshKey]);
    if (oauthEmpty) {
      return { visible: true, mode: 'get', label: target.missingLabel, hint: target.loginHint };
    }
    if (refreshMissing) {
      return { visible: true, mode: 'regen', label: target.regenLabel, hint: REGEN_HINT + ' ' + target.loginHint };
    }
    return { visible: false };
  }

  function evaluate() {
    subscribeState();
    ensureStyles();

    if (!isPopulated() || Object.keys(twitchCreds()).length === 0) {
      removeBanner();
      lastSignature = null;
      return;
    }

    if (!TARGETS.some((target) => targetState(target).visible)) {
      removeBanner();
      lastSignature = null;
      return;
    }

    const banner = ensureBanner();
    if (!banner) return;

    const signature = TARGETS.map((target) => {
      const state = targetState(target);
      return state.visible ? (state.mode + '|' + target.key) : 'off';
    }).join(';');

    if (signature === lastSignature) return; // nothing changed: don't touch the DOM
    lastSignature = signature;

    const rows = banner.querySelector('.oauth-helper__rows');
    rows.innerHTML = '';
    for (const target of TARGETS) {
      const state = targetState(target);
      if (!state.visible) continue;
      rows.appendChild(buildRow(target, state));
    }
    updateButtons();

    // If a flow was mid-flight when the rows got rebuilt, restore state.
    if (pasteTarget) renderPasteBox(pasteTarget);
    else if (pendingTarget) setStatus(pendingTarget, 'busy', 'Waiting for Twitch authorization…');
  }

  function buildRow(target, state) {
    const row = document.createElement('div');
    row.className = 'oauth-helper__row';

    const info = document.createElement('div');
    info.className = 'oauth-helper__info';
    info.appendChild(Object.assign(document.createElement('strong'), { textContent: state.label }));
    info.appendChild(Object.assign(document.createElement('span'), { textContent: state.hint }));

    const status = document.createElement('div');
    status.className = 'oauth-helper__status';
    status.dataset.oauthStatus = target.key;
    info.appendChild(status);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost-button oauth-helper__btn';
    button.dataset.oauthButton = target.key;
    button.textContent = state.mode === 'get'
      ? (target.account === 'bot' ? 'Get Bot OAuth' : 'Get Stream OAuth')
      : (target.account === 'bot' ? 'Regenerate Bot OAuth' : 'Regenerate Stream OAuth');
    button.addEventListener('click', () => {
      if (pendingTarget || pasteTarget) return;
      clearPasteBox();
      startFlow(target);
    });

    row.appendChild(info);
    row.appendChild(button);
    return row;
  }

  function statusEl(target) {
    return document.querySelector('[data-oauth-status="' + target.key + '"]');
  }

  function setStatus(target, tone, message) {
    const element = statusEl(target);
    if (!element) return;
    element.className = 'oauth-helper__status' + (tone ? ' is-' + tone : '');
    element.textContent = message;
  }

  function updateButtons() {
    document.querySelectorAll('[data-oauth-button]').forEach((button) => {
      const target = TARGETS.find((entry) => entry.key === button.dataset.oauthButton);
      button.disabled = Boolean(pendingTarget || pasteTarget) && target !== pendingTarget && target !== pasteTarget;
    });
  }

  function renderPasteBox(target) {
    const element = statusEl(target);
    if (!element || element.querySelector('.oauth-helper__paste')) return;
    const wrap = document.createElement('div');
    wrap.className = 'oauth-helper__paste';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cfg-input';
    input.placeholder = 'Paste http://localhost/#access_token=… or the token';
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finishPaste(target, input.value);
    });

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary-button';
    confirm.textContent = 'Use token';
    confirm.addEventListener('click', () => finishPaste(target, input.value));

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ghost-button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      clearPasteBox();
      pasteTarget = null;
      pendingTarget = null;
      updateButtons();
      setStatus(target, 'info', 'Canceled.');
    });

    wrap.appendChild(input);
    wrap.appendChild(confirm);
    wrap.appendChild(cancel);
    // Set the status text BEFORE appending the wrap: textContent wipes the
    // element's children in a real DOM, so the paste box must go in last.
    setStatus(target, 'warning', 'Paste the token from the address bar after authorizing (it appears after "access_token=").');
    element.appendChild(wrap);
    input.focus();
  }

  function clearPasteBox() {
    document.querySelectorAll('.oauth-helper__paste').forEach((element) => element.remove());
  }

  function setPasteError(message) {
    setStatus(pasteTarget || TARGETS[0], 'error', message);
  }

  function removeBanner() {
    document.getElementById('oauth-helper')?.remove();
  }

  // Reuse the credentials page toast (#creds-toast + creds-toast-- styles are
  // loaded with the page's stylesheet, so no extra CSS is needed here).
  const TOAST_ICONS = { info: 'i', success: 'OK', warning: '!', error: 'X' };
  const TOAST_TITLES = { info: 'Info', success: 'Saved', warning: 'Warning', error: 'Error' };
  let toastTimer = null;

  function showToast(message, tone) {
    let toast = document.getElementById('creds-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'creds-toast';
      toast.setAttribute('role', 'status');
      toast.innerHTML =
        '<div class="creds-toast__content">' +
        '<div class="creds-toast__icon"></div>' +
        '<div class="creds-toast__text"><strong></strong><span></span></div>' +
        '</div>';
      document.body.appendChild(toast);
    }
    toast.className = 'creds-toast--' + (tone || 'info');
    toast.querySelector('.creds-toast__icon').textContent = TOAST_ICONS[tone] || 'i';
    toast.querySelector('.creds-toast__text strong').textContent = TOAST_TITLES[tone] || 'Info';
    toast.querySelector('.creds-toast__text span').textContent = message;
    toast.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  // -------------------------------------------------------------- watchers

  function setupWatchers() {
    // The credentials page re-renders its fields whenever server state
    // changes; the observer keeps the helper card in sync. Rebuilds are
    // signature-gated in evaluate(), so this cannot loop.
    const observer = new MutationObserver(() => evaluate());
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('page:activate', (event) => {
      if (!event.detail || event.detail.pageId === 'credentials') evaluate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupWatchers();
      evaluate();
    });
  } else {
    setupWatchers();
    evaluate();
  }

  // Exposed for debugging / manual triggering from the console.
  window.mizubotOAuth = { evaluate, startFlow };
})();
