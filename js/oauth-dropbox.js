/**
 * Dropbox OAuth helper for the Credentials page.
 * Uses the unsaved app key and secret, then fills token fields for review/save.
 */
(function () {
  'use strict';
  if (window.mizubotDropboxOAuth) return;

  const CARD_FIELDS_ID = 'creds-dropbox-fields';
  const BANNER_ID = 'dropbox-oauth-helper';
  const STYLES_ID = 'dropbox-oauth-styles';
  let pending = false;
  let awaitingCode = false;

  function fieldValue(key) {
    return String(document.getElementById('creds-field-dropbox-' + key)?.value || '').trim();
  }

  function fillField(key, value) {
    const input = document.getElementById('creds-field-dropbox-' + key);
    if (!input || (input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA')) return false;
    input.value = value;
    input.dataset.userEdited = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function ensureStyles() {
    if (document.getElementById(STYLES_ID)) return;
    const style = document.createElement('style');
    style.id = STYLES_ID;
    style.textContent = [
      '.dropbox-helper { display:flex; flex-direction:column; gap:8px; margin:0 0 14px; padding:12px 14px;',
      'border:1px solid rgba(255,255,255,.08); border-radius:10px; background:rgba(255,255,255,.03); }',
      '.dropbox-helper__row, .dropbox-helper__form { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }',
      '.dropbox-helper__row { justify-content:space-between; }',
      '.dropbox-helper__info { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }',
      '.dropbox-helper__info strong { font-size:.9rem; }',
      '.dropbox-helper__info span, .dropbox-helper__status { font-size:.78rem; opacity:.7; }',
      '.dropbox-helper__status { min-height:1em; }',
      '.dropbox-helper__status.is-ok { color:#4ade80; opacity:1; }',
      '.dropbox-helper__status.is-error { color:#f87171; opacity:1; }',
      '.dropbox-helper__status.is-busy { opacity:.7; }',
      '.dropbox-helper__code { flex:1; min-width:220px; }',
      '.dropbox-helper__form[hidden] { display:none; }',
      '.dropbox-helper__btn:disabled { opacity:.5; cursor:default; }',
    ].join(' ');
    document.head.appendChild(style);
  }

  function ensureBanner(card) {
    let banner = document.getElementById(BANNER_ID);
    if (banner && banner.parentElement === card) return banner;
    if (banner) banner.remove();

    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'dropbox-helper';

    const row = document.createElement('div');
    row.className = 'dropbox-helper__row';
    const info = document.createElement('div');
    info.className = 'dropbox-helper__info';
    info.appendChild(Object.assign(document.createElement('strong'), {
      textContent: 'Connect Dropbox',
    }));
    info.appendChild(Object.assign(document.createElement('span'), {
      textContent: 'Authorize in your browser, then paste Dropbox’s code below.',
    }));
    const connectButton = document.createElement('button');
    connectButton.type = 'button';
    connectButton.className = 'ghost-button dropbox-helper__btn';
    connectButton.textContent = 'Get Dropbox Token';
    connectButton.addEventListener('click', startFlow);
    row.append(info, connectButton);

    const form = document.createElement('form');
    form.className = 'dropbox-helper__form';
    form.hidden = !awaitingCode;
    const codeInput = document.createElement('input');
    codeInput.className = 'cfg-input dropbox-helper__code';
    codeInput.type = 'text';
    codeInput.autocomplete = 'off';
    codeInput.spellcheck = false;
    codeInput.placeholder = 'Paste the code displayed by Dropbox';
    codeInput.setAttribute('aria-label', 'Dropbox authorization code');
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'primary-button dropbox-helper__btn';
    submitButton.textContent = 'Submit Code';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'ghost-button dropbox-helper__btn';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', cancelFlow);
    form.append(codeInput, submitButton, cancelButton);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      exchangeCode(codeInput.value);
    });

    const status = document.createElement('div');
    status.className = 'dropbox-helper__status';
    status.dataset.dropboxStatus = 'oauth';
    banner.append(row, form, status);
    card.insertBefore(banner, card.querySelector('.cfg-fields'));
    return banner;
  }

  function setStatus(tone, message) {
    const status = document.querySelector('[data-dropbox-status="oauth"]');
    if (!status) return;
    status.className = 'dropbox-helper__status' + (tone ? ' is-' + tone : '');
    status.textContent = message;
  }

  function evaluate() {
    const cardFields = document.getElementById(CARD_FIELDS_ID);
    const card = cardFields?.closest('.cfg-card');
    if (!card || !fieldValue('dropbox_app_key') || !fieldValue('dropbox_app_secret')) {
      document.getElementById(BANNER_ID)?.remove();
      return;
    }

    ensureStyles();
    const banner = ensureBanner(card);
    const connectButton = banner.querySelector('.dropbox-helper__row button');
    const form = banner.querySelector('.dropbox-helper__form');
    const codeInput = banner.querySelector('.dropbox-helper__code');
    const submitButton = form.querySelector('[type="submit"]');
    const cancelButton = form.querySelector('[type="button"]');
    connectButton.disabled = pending;
    form.hidden = !awaitingCode;
    codeInput.disabled = pending;
    submitButton.disabled = pending;
    cancelButton.disabled = pending;
  }

  async function startFlow() {
    if (pending || awaitingCode) return;
    const appKey = fieldValue('dropbox_app_key');
    const appSecret = fieldValue('dropbox_app_secret');
    if (!appKey || !appSecret) {
      evaluate();
      return;
    }
    if (!window.electronAPI || typeof window.electronAPI.startDropboxOAuth !== 'function') {
      setStatus('error', 'Dropbox authorization is available in the Electron app only.');
      return;
    }

    pending = true;
    evaluate();
    setStatus('busy', 'Opening Dropbox authorization…');
    try {
      const result = await window.electronAPI.startDropboxOAuth({ appKey, appSecret });
      if (!result?.ok) {
        setStatus('error', result?.error || 'Could not open Dropbox authorization.');
        return;
      }
      if (fieldValue('dropbox_app_key') !== appKey || fieldValue('dropbox_app_secret') !== appSecret) {
        setStatus('error', 'App credentials changed. Start authorization again using the current credentials.');
        return;
      }
      awaitingCode = true;
      evaluate();
      setStatus('info', 'Approve access in Dropbox, copy the displayed code, and paste it here.');
      document.querySelector('#' + BANNER_ID + ' .dropbox-helper__code')?.focus();
    } catch (error) {
      setStatus('error', 'Could not start Dropbox authorization: ' + (error.message || String(error)));
    } finally {
      pending = false;
      evaluate();
    }
  }

  async function exchangeCode(rawCode) {
    if (pending) return;
    const code = String(rawCode || '').trim();
    if (!code) {
      setStatus('error', 'Paste the authorization code displayed by Dropbox.');
      return;
    }
    const appKey = fieldValue('dropbox_app_key');
    const appSecret = fieldValue('dropbox_app_secret');
    if (!appKey || !appSecret) {
      awaitingCode = false;
      evaluate();
      return;
    }
    if (!window.electronAPI || typeof window.electronAPI.exchangeDropboxOAuthCode !== 'function') {
      setStatus('error', 'Dropbox authorization is available in the Electron app only.');
      return;
    }

    pending = true;
    evaluate();
    setStatus('busy', 'Exchanging the Dropbox authorization code…');
    try {
      const result = await window.electronAPI.exchangeDropboxOAuthCode({ appKey, appSecret, code });
      if (!result?.ok || !result.accessToken) {
        setStatus('error', result?.error || 'Dropbox did not return an access token.');
        return;
      }
      if (fieldValue('dropbox_app_key') !== appKey || fieldValue('dropbox_app_secret') !== appSecret) {
        setStatus('error', 'App credentials changed during authorization. Start again using the current credentials.');
        return;
      }
      const accessFilled = fillField('dropbox_token', result.accessToken);
      const refreshFilled = result.refreshToken
        ? fillField('dropbox_refresh_token', result.refreshToken)
        : true;
      if (!accessFilled || !refreshFilled) {
        setStatus('error', 'Dropbox authorized, but the token fields are unavailable. Refresh the Credentials page.');
        return;
      }
      awaitingCode = false;
      const codeInput = document.querySelector('#' + BANNER_ID + ' .dropbox-helper__code');
      if (codeInput) codeInput.value = '';
      setStatus('ok', 'Dropbox tokens filled in. Click Save Credentials to keep them.');
    } catch (error) {
      setStatus('error', 'Dropbox token exchange failed: ' + (error.message || String(error)));
    } finally {
      pending = false;
      evaluate();
    }
  }

  function cancelFlow() {
    if (pending) return;
    awaitingCode = false;
    const codeInput = document.querySelector('#' + BANNER_ID + ' .dropbox-helper__code');
    if (codeInput) codeInput.value = '';
    evaluate();
    setStatus('info', 'Dropbox authorization canceled.');
  }

  function setupWatchers() {
    const observer = new MutationObserver(evaluate);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('input', (event) => {
      if (event.target?.id === 'creds-field-dropbox-dropbox_app_key'
        || event.target?.id === 'creds-field-dropbox-dropbox_app_secret') {
        evaluate();
      }
    });
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

  window.mizubotDropboxOAuth = { evaluate, startFlow, exchangeCode, cancelFlow };
})();
