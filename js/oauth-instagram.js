/**
 * Instagram OAuth helper (Credentials page)
 *
 * Adds an "Get Instagram Token" row to the Instagram credentials card while
 * instagram.access_token is empty.
 *
 * The bot owns the whole flow: it issues the OAuth state over the authenticated
 * WebSocket bridge (bound to this UI session), Meta redirects to the tunneled
 * /oauth/instagram/callback, and the bot then exchanges the code for a
 * long-lived token, writes it into creds.json, re-subscribes the account to the
 * messages webhook and broadcasts the refreshed state.
 *
 * This module therefore never sees the app secret and never writes credentials:
 * it starts the flow, opens the browser, polls for the outcome and reports it.
 */
(function () {
  'use strict';
  if (window.mizubotInstagramOAuth) return; // guard against double evaluation

  const CARD_FIELDS_ID = 'creds-instagram-fields';
  const BANNER_ID = 'instagram-oauth-helper';
  const STYLES_ID = 'instagram-oauth-styles';
  const POLL_INTERVAL_MS = 2500;
  const START_TIMEOUT_MS = 15000;
  const POLL_TIMEOUT_MS = 10000;

  let pollTimer = null;
  let pending = null; // { state, expiresAt }
  let lastSignature = null;

  // --------------------------------------------------------------- helpers

  function toPlain(value) {
    if (!value) return {};
    if (typeof value.toObject === 'function') return value.toObject();
    if (typeof value !== 'object') return {};
    return Object.assign({}, value);
  }

  function instagramCreds() {
    return toPlain(window.state?.creds?.instagram);
  }

  function isPopulated() {
    if (!window.state) return false;
    if (window.state.populated !== undefined) return Boolean(window.state.populated);
    return Object.keys(instagramCreds()).length > 0;
  }

  function isEmptyValue(value) {
    if (value === undefined || value === null) return true;
    return String(value).trim() === '';
  }

  function getBridge() {
    const connection = window.connection;
    if (!connection || typeof connection.getBridge !== 'function') return null;
    const instance = connection.getBridge();
    if (!instance || typeof instance.sendWithResponse !== 'function') return null;
    return instance;
  }

  function fillField(key, value) {
    const input = document.getElementById('creds-field-instagram-' + key);
    if (!input || (input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA')) return false;
    input.value = value;
    input.dataset.userEdited = '1';
    // The credentials page listens for 'input' to set its own dirty state.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function openExternal(url) {
    if (window.electronAPI && typeof window.electronAPI.openExternalUrl === 'function') {
      window.electronAPI.openExternalUrl(url);
      return true;
    }
    return Boolean(window.open(url, 'instagram_authorize'));
  }

  function randomVerifyToken() {
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // Reuse the credentials page toast (#creds-toast + creds-toast-- styles come
  // with the page stylesheet, so no extra CSS is needed here).
  const TOAST_ICONS = { info: 'i', success: 'OK', warning: '!', error: 'X' };
  const TOAST_TITLES = { info: 'Info', success: 'Saved', warning: 'Warning', error: 'Error' };
  let toastTimer = null;

  function showToast(message, tone) {
    if (!tone) tone = 'info';
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
    toast.className = 'creds-toast--' + tone;
    toast.querySelector('.creds-toast__icon').textContent = TOAST_ICONS[tone] || 'i';
    toast.querySelector('.creds-toast__text strong').textContent = TOAST_TITLES[tone] || 'Info';
    toast.querySelector('.creds-toast__text span').textContent = message;
    toast.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function ensureStyles() {
    if (document.getElementById(STYLES_ID)) return;
    const style = document.createElement('style');
    style.id = STYLES_ID;
    style.textContent = [
      '.ig-helper { display:flex; flex-direction:column; gap:10px; margin:0 0 14px; padding:12px 14px;',
      '  border:1px solid rgba(255,255,255,.08); border-radius:10px; background:rgba(255,255,255,.03); }',
      '.ig-helper__title { font-size:.85rem; font-weight:600; opacity:.85; }',
      '.ig-helper__row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }',
      '.ig-helper__info { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }',
      '.ig-helper__info strong { font-size:.9rem; }',
      '.ig-helper__info span { font-size:.78rem; opacity:.65; }',
      '.ig-helper__status { font-size:.78rem; min-height:1em; white-space:normal; word-break:break-word; }',
      '.ig-helper__status.is-ok { color:#4ade80; }',
      '.ig-helper__status.is-warning { color:#fbbf24; }',
      '.ig-helper__status.is-error { color:#f87171; }',
      '.ig-helper__status.is-busy { opacity:.7; }',
      '.ig-helper__btn { flex-shrink:0; }',
      '.ig-helper__btn:disabled { opacity:.5; cursor:default; }',
    ].join(' ');
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------- UI

  function findCard() {
    const fields = document.getElementById(CARD_FIELDS_ID);
    if (!fields) return null;
    return fields.closest('.cfg-card');
  }

  function ensureBanner(card) {
    let banner = document.getElementById(BANNER_ID);
    if (banner && banner.parentElement === card) return banner;
    if (banner) banner.remove();
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'ig-helper';
    banner.appendChild(Object.assign(document.createElement('div'), {
      className: 'ig-helper__title',
      textContent: 'Instagram owner access — missing credentials:',
    }));
    const rows = document.createElement('div');
    rows.className = 'ig-helper__rows';
    banner.appendChild(rows);
    card.insertBefore(banner, card.querySelector('.cfg-fields'));
    return banner;
  }

  function removeBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function statusEl(key) {
    return document.querySelector('[data-ig-status="' + key + '"]');
  }

  function setRowStatus(key, tone, message) {
    const element = statusEl(key);
    if (!element) return;
    element.className = 'ig-helper__status' + (tone ? ' is-' + tone : '');
    element.textContent = message;
  }

  function buildRow(spec) {
    const row = document.createElement('div');
    row.className = 'ig-helper__row';

    const info = document.createElement('div');
    info.className = 'ig-helper__info';
    info.appendChild(Object.assign(document.createElement('strong'), { textContent: spec.label }));
    info.appendChild(Object.assign(document.createElement('span'), { textContent: spec.hint }));

    const status = document.createElement('div');
    status.className = 'ig-helper__status';
    status.dataset.igStatus = spec.key;
    info.appendChild(status);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost-button ig-helper__btn';
    button.dataset.igButton = spec.key;
    button.textContent = spec.button;
    button.disabled = Boolean(spec.disabled);
    button.addEventListener('click', () => spec.action());

    row.appendChild(info);
    row.appendChild(button);
    return row;
  }

  // ------------------------------------------------------------------ flow

  async function startFlow() {
    const bridge = getBridge();
    if (!bridge) {
      setRowStatus('access_token', 'error', 'Not connected to the bot server.');
      return;
    }
    if (pending) return;

    setRowStatus('access_token', 'busy', 'Requesting an authorization link…');

    let response;
    try {
      response = await bridge.sendWithResponse('start_instagram_owner_auth', {}, START_TIMEOUT_MS);
    } catch (error) {
      setRowStatus('access_token', 'error', 'The bot did not answer (' + String(error) + ').');
      return;
    }

    if (!response || !response.ok) {
      const message = (response && response.error) || 'Could not start the Instagram authorization.';
      setRowStatus('access_token', 'error', message);
      showToast(message, 'error');
      return;
    }

    const data = response.result || {};
    if (!data.state || !data.authorize_url) {
      setRowStatus('access_token', 'error', 'The bot returned no authorization URL.');
      return;
    }

    pending = {
      state: data.state,
      expiresAt: Date.now() + (Number(data.expires_in) || 600) * 1000,
    };

    // Rebuild the row first (its button becomes "Cancel"), then report status.
    evaluate();

    if (openExternal(data.authorize_url)) {
      setRowStatus('access_token', 'busy', 'Waiting for Instagram authorization…');
    } else {
      setRowStatus(
        'access_token',
        'warning',
        'Popup blocked — open this link, then come back: ' + data.authorize_url,
      );
    }

    schedulePoll();
  }

  function cancelFlow() {
    stopPolling();
    pending = null;
    evaluate();
    showToast('Instagram authorization canceled.', 'info');
  }

  function schedulePoll() {
    stopPolling();
    pollTimer = setTimeout(pollOnce, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function pollOnce() {
    pollTimer = null;
    const bridge = getBridge();
    if (!bridge || !pending) return;

    if (Date.now() > pending.expiresAt) {
      finishFlow('error', 'The authorization link expired — try again.', 'error');
      return;
    }

    let response;
    try {
      response = await bridge.sendWithResponse(
        'get_instagram_owner_auth',
        { state: pending.state },
        POLL_TIMEOUT_MS,
      );
    } catch (_error) {
      // Transient socket hiccup: keep polling until the deadline.
      schedulePoll();
      return;
    }

    const data = (response && response.result) || {};

    if (data.status === 'pending') {
      schedulePoll();
      return;
    }

    if (data.status === 'ready') {
      const result = data.result || {};
      const who = result.username ? '@' + result.username : 'your Instagram account';
      const webhook = result.webhook_subscribed
        ? 'Webhook subscription active.'
        : 'The messages webhook subscription still needs attention.';
      finishFlow('ok', 'Token saved for ' + who + '. ' + webhook, 'success');
      return;
    }

    if (data.status === 'error') {
      finishFlow('error', data.error || 'Instagram authorization failed.', 'error');
      return;
    }

    finishFlow('error', 'The authorization session expired — try again.', 'error');
  }

  function finishFlow(tone, message, toastTone) {
    stopPolling();
    pending = null;
    // Rebuild the row first: it switches from "Cancel" back to the action
    // button, and the status element is recreated with it.
    evaluate();
    setRowStatus('access_token', tone, message);
    showToast(message, toastTone || tone);
  }

  // ------------------------------------------------------------ verify token

  function generateVerifyToken() {
    if (!fillField('webhook_verify_token', randomVerifyToken())) {
      setRowStatus('webhook_verify_token', 'error', 'Could not find the webhook verify token input.');
      return;
    }
    setRowStatus(
      'webhook_verify_token',
      'ok',
      'Generated — paste the same value into the Meta App Dashboard, then save.',
    );
    showToast('Webhook verify token generated.', 'success');
  }

  // ------------------------------------------------------------------- rows

  function rowSpecs() {
    const creds = instagramCreds();
    const specs = [];

    if (isEmptyValue(creds.access_token)) {
      if (pending) {
        specs.push({
          key: 'access_token',
          label: 'Waiting for Instagram authorization…',
          hint: 'Approve the login for the streamer account in your browser, then come back here.',
          button: 'Cancel',
          action: cancelFlow,
        });
      } else {
        const missingApp = isEmptyValue(creds.client_id) || isEmptyValue(creds.client_secret);
        specs.push({
          key: 'access_token',
          label: 'Instagram owner access token is not set.',
          hint: missingApp
            ? 'Fill in Client ID and Client Secret first — they come from a Meta app with Business login for Instagram.'
            : 'Authorize the streamer account: the bot exchanges the code, saves the token and subscribes the webhook.',
          button: 'Get Instagram Token',
          disabled: missingApp,
          action: startFlow,
        });
      }
    }

    if (isEmptyValue(creds.webhook_verify_token)) {
      specs.push({
        key: 'webhook_verify_token',
        label: 'Webhook verify token is not set.',
        hint: 'Generate one and paste the same value into the Meta App Dashboard webhook settings.',
        button: 'Generate Verify Token',
        action: generateVerifyToken,
      });
    }

    return specs;
  }

  function evaluate() {
    ensureStyles();

    const card = findCard();
    if (!card || !isPopulated() || Object.keys(instagramCreds()).length === 0) {
      removeBanner();
      lastSignature = null;
      return;
    }

    const specs = rowSpecs();
    if (specs.length === 0) {
      removeBanner();
      lastSignature = null;
      return;
    }

    const banner = ensureBanner(card);
    if (!banner) return;

    const signature = specs.map((spec) => spec.key + '|' + spec.button).join(';');
    if (signature === lastSignature) return; // nothing changed: keep the DOM
    lastSignature = signature;

    const rows = banner.querySelector('.ig-helper__rows');
    rows.innerHTML = '';
    specs.forEach((spec) => rows.appendChild(buildRow(spec)));
  }

  // --------------------------------------------------------------- watchers

  function setupWatchers() {
    // The credentials page re-renders its cards whenever server state changes;
    // the observer keeps this helper in sync. Rebuilds are signature-gated in
    // evaluate(), so this cannot loop.
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
  window.mizubotInstagramOAuth = {
    evaluate,
    startFlow,
    pollOnce,
    cancelFlow,
    isPending: () => Boolean(pending),
  };
})();

