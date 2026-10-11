// Overlay Test page controller.
//
// Fires fake overlay events straight into the local relay (Electron main ->
// overlayServer.js -> every connected overlay), bypassing the bot entirely.
// This only works in the Electron app (browser renderers can't host servers),
// so in plain-browser mode the buttons degrade to a console log + notice.
window.pageControllers = window.pageControllers || {};

const TEST_SHOUTOUT_USER = 'drinst';
const TEST_CLIP_CACHE_MS = 60 * 1000;
let testShoutoutToken = null;
let testShoutoutTokenExpiresAt = 0;
let testShoutoutClipCache = null;
let testShoutoutClipCacheExpiresAt = 0;
let testShoutoutLookup = null;

// Fake data shapes mirror exactly what the bot emits for each event type.
const EVENT_TEMPLATES = {
  raid: { user: 'MockRaider', viewers: 42 },
  follow: { user: 'MockFollower' },
  sub: { user: 'MockSub', months: 5 },
  gift_sub: { sender: 'MockGifter', recipient: 'MockRecipient' },
  shoutout: { user: TEST_SHOUTOUT_USER, clip: null },
  winner: { name: 'MizukaShiina', reward: 'Monthly Pass' },
  chat_msg: {
    user: 'MockChatter',
    message: 'Testing the overlay relay!',
    color: '#9146FF',
    badges: [],
  },
};

window.pageControllers.test = function () {
  const els = {
    pill: document.getElementById('ot-relay-pill'),
    status: document.getElementById('ot-status'),
    statusValue: document.getElementById('ot-status-value'),
    notice: document.getElementById('ot-notice'),
    eventSelect: document.getElementById('ot-event'),
    testBtn: document.getElementById('ot-test'),
    loopBtn: document.getElementById('ot-loop'),
    interval: document.getElementById('ot-interval'),
    count: document.getElementById('ot-count'),
    clients: document.getElementById('ot-clients'),
    blasts: document.getElementById('ot-blasts'),
    feed: document.getElementById('ot-feed'),
  };

  let sentCount = 0;
  let blastCount = 0;
  let loopTimer = null;
  let loopRunning = false;
  let pollTimer = null;
  let pageActive = true;
  let burstInProgress = false;

  // -------------------------------------------------------------------------
  // Status polling (visible page only)
  // -------------------------------------------------------------------------
  async function refreshStatus() {
    let st = null;
    if (window.electronAPI?.getOverlayServerStatus) {
      try {
        st = await window.electronAPI.getOverlayServerStatus();
      } catch (e) {
        st = null;
      }
    }

    if (!st) {
      els.notice.hidden = false;
      els.pill.dataset.state = 'off';
      els.pill.textContent = 'Relay: unavailable';
      els.status.dataset.state = 'off';
      els.statusValue.textContent = 'Not running inside Electron — nothing can be relayed.';
      els.clients.textContent = '0';
      return;
    }

    els.notice.hidden = true;
    const on = Boolean(st.started);
    els.pill.dataset.state = on ? 'on' : 'off';
    els.pill.textContent = on ? 'Relay: live' : 'Relay: stopped';
    els.status.dataset.state = on ? 'on' : 'off';
    els.statusValue.textContent = on
      ? `live on port ${st.port} — serving ${st.root}`
      : 'not started — open the WebUI and retry';
    els.clients.textContent = String(st.clients || 0);
  }

  function schedulePoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (pageActive) refreshStatus();
    }, 2500);
  }

  function appendFeed(text) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'ot-feed__entry';
    const timeLabel = document.createElement('span');
    timeLabel.className = 'ot-feed__time';
    timeLabel.textContent = time;
    const eventLabel = document.createElement('span');
    eventLabel.className = 'ot-feed__event';
    eventLabel.textContent = text;
    entry.append(timeLabel, eventLabel);
    // Remove the empty-state placeholder if present.
    const empty = els.feed.querySelector('.ot-feed__empty');
    if (empty) empty.remove();
    els.feed.appendChild(entry);
    // Cap the feed list.
    while (els.feed.children.length > 30) {
      els.feed.removeChild(els.feed.firstChild);
    }
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------
  function sendEvent(eventType, data) {
    const payload = {
      event: eventType,
      data,
      timestamp: Date.now() / 1000,
      source: 'webui-test',
    };

    if (window.electronAPI?.sendOverlaySignal) {
      try {
        window.electronAPI.sendOverlaySignal(payload);
      } catch (e) {
        appendFeed(`send failed: ${e.message}`);
        return false;
      }
    } else {
      console.log('[OverlayTest] no relay available (browser mode), event:', eventType, payload);
      return false;
    }

    sentCount += 1;
    els.count.textContent = String(sentCount);
    appendFeed(eventType);
    return true;
  }

  function getTwitchCredentials() {
    const creds = window.state?.creds?.twitch;
    const plainCreds = typeof creds?.toObject === 'function' ? creds.toObject() : creds;
    const clientId = String(plainCreds?.client_id || '').trim();
    const clientSecret = String(plainCreds?.client_secret || '').trim();
    if (!clientId || !clientSecret) {
      throw new Error('Add a Twitch Client ID and Client Secret on the Credentials page first.');
    }
    return { clientId, clientSecret };
  }

  async function getTwitchAppToken() {
    if (testShoutoutToken && Date.now() < testShoutoutTokenExpiresAt) {
      return testShoutoutToken;
    }

    const { clientId, clientSecret } = getTwitchCredentials();
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    const tokenData = await response.json();
    if (!response.ok || !tokenData.access_token) {
      throw new Error(tokenData.message || 'Twitch app-token request failed.');
    }

    testShoutoutToken = tokenData.access_token;
    testShoutoutTokenExpiresAt = Date.now() + Math.max(0, tokenData.expires_in - 60) * 1000;
    return testShoutoutToken;
  }

  async function twitchHelixGet(endpoint, params = {}) {
    const { clientId } = getTwitchCredentials();
    const token = await getTwitchAppToken();
    const url = new URL(`https://api.twitch.tv/helix/${endpoint}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url, {
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
      },
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || `Twitch ${endpoint} request failed.`);
    }
    return result.data || [];
  }

  async function getRandomTestShoutoutClip() {
    let clips = testShoutoutClipCache;
    if (Date.now() >= testShoutoutClipCacheExpiresAt) {
      if (!testShoutoutLookup) {
        testShoutoutLookup = (async () => {
          const users = await twitchHelixGet('users', { login: TEST_SHOUTOUT_USER });
          if (!users.length) throw new Error(`Twitch channel "${TEST_SHOUTOUT_USER}" was not found.`);

          const result = await twitchHelixGet('clips', {
            broadcaster_id: users[0].id,
            first: '50',
          });
          testShoutoutClipCache = result;
          testShoutoutClipCacheExpiresAt = Date.now() + TEST_CLIP_CACHE_MS;
          return result;
        })();
      }

      try {
        clips = await testShoutoutLookup;
      } finally {
        testShoutoutLookup = null;
      }
    }

    return clips.length ? clips[Math.floor(Math.random() * clips.length)] : null;
  }

  async function sendTestEvent(eventType, data) {
    if (eventType !== 'shoutout') return sendEvent(eventType, data);

    try {
      const clip = await getRandomTestShoutoutClip();
      if (!clip) appendFeed(`no clips found for ${TEST_SHOUTOUT_USER}; sending text shoutout`);
      return sendEvent(eventType, {
        user: TEST_SHOUTOUT_USER,
        clip: clip ? {
          id: clip.id,
          title: clip.title,
          url: clip.url,
          thumbnail_url: clip.thumbnail_url,
        } : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendFeed(`shoutout clip lookup failed: ${message}`);
      console.error('[OverlayTest] Shoutout clip lookup failed:', error);
      return false;
    }
  }

  // Burst = all event types, so every overlay receives something it handles.
  async function sendBurst() {
    if (burstInProgress) return false;
    burstInProgress = true;
    try {
      for (const [eventType, data] of Object.entries(EVENT_TEMPLATES)) {
        await sendTestEvent(eventType, data);
      }
      blastCount += 1;
      els.blasts.textContent = String(blastCount);
      return true;
    } finally {
      burstInProgress = false;
    }
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------
  els.testBtn.addEventListener('click', async () => {
    const eventType = els.eventSelect.value;
    const data = EVENT_TEMPLATES[eventType];
    if (data) await sendTestEvent(eventType, data);
  });

  els.loopBtn.addEventListener('click', () => {
    if (loopRunning) {
      stopLoop();
      return;
    }

    const seconds = Math.max(1, Number(els.interval.value) || 3);
    loopRunning = true;
    els.loopBtn.dataset.running = 'true';
    els.loopBtn.textContent = `Looping every ${seconds}s — click to stop`;

    void sendBurst();
    loopTimer = setInterval(() => void sendBurst(), seconds * 1000);
  });

  function stopLoop() {
    loopRunning = false;
    clearInterval(loopTimer);
    loopTimer = null;
    els.loopBtn.dataset.running = 'false';
    els.loopBtn.textContent = 'Test Loop — burst all to every overlay';
  }

  // Auto-stop the loop whenever we navigate away from this page, and resume
  // status polling when we come back. Clean up prior handlers on re-init.
  const handleActivate = (ev) => {
    pageActive = ev.detail?.pageId === 'test';
    if (!pageActive) stopLoop();
    if (pageActive) refreshStatus();
  };
  if (window.pageControllers.__testActivateHandler) {
    document.removeEventListener('page:activate', window.pageControllers.__testActivateHandler);
  }
  document.addEventListener('page:activate', handleActivate);
  window.pageControllers.__testActivateHandler = handleActivate;

  refreshStatus();
  schedulePoll();
};

// Initialize the page controller
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.pageControllers.test());
} else {
  window.pageControllers.test();
}