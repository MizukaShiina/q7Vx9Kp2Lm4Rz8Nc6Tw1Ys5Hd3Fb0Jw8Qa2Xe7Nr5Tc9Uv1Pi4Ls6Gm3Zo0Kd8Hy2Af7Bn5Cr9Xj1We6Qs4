// logs/script.js
//
// Additive log viewer driven by the server snapshot state:
//   state.logs.system  -> bot/system lines, e.g. "2026-07-30 13:58:48 [INFO] msg"
//   state.logs.chat    -> chat lines,      e.g. "[OFFLINE] 19:14:03 2026-06-30 19:14:03 user: msg"
//
// New lines are APPENDED to a client-side cache (CACHE_CAP per stream) instead
// of rebuilding the whole view on every snapshot. The cache lives on
// window.pageControllers.__logsCache, so it survives tab switches (and even a
// forced script re-eval never double-seeds). Only a full reload (Ctrl+R /
// Ctrl+Shift+R / app restart) wipes it, after which it re-seeds from the
// server's latest snapshot.
//
// Four views: All (chronologically merged), Chat, System, and Issues (WARNING+).

window.pageControllers = window.pageControllers || {};

const CACHE_CAP = 500;
const ISSUE_LEVEL_RE = /^(WARNING|ERROR|CRITICAL|FATAL)$/;

// Additive cache, keyed by the server array names. `issues` is derived from
// `system` (entries whose level is WARNING+, reusing the same item objects).
const cache =
  window.pageControllers.__logsCache ||
  (window.pageControllers.__logsCache = {
    system: [],   // { raw, html, sortKey, level }
    chat: [],     // { raw, html, sortKey }
    issues: [],   // system entries filtered to WARNING+ (same item objects)
    seen: {
      system: new Set(),
      chat: new Set()
    }
  });

window.pageControllers.logs = function () {
  const STREAMS = ['all', 'chat', 'system', 'issues'];

  const outputEls = {
    all: document.getElementById('logs-output-all'),
    chat: document.getElementById('logs-output-chat'),
    system: document.getElementById('logs-output-system'),
    issues: document.getElementById('logs-output-issues')
  };

  const livePill = document.getElementById('logs-live-pill');
  const eventsEl = document.getElementById('logs-events');
  const warningsEl = document.getElementById('logs-warnings');
  const chatEl = document.getElementById('logs-chat');
  const jumpBtn = document.getElementById('logs-jump');
  const copyBtn = document.getElementById('logs-copy');
  const tabButtons = Array.prototype.slice.call(document.querySelectorAll('.logs-tab'));

  const FOLLOW_THRESHOLD = 120;

  let activeTab = 'all';
  const followBottom = {};    // per stream: pinned to latest?
  const renderedCount = {};   // per stream: cache entries already in the DOM
  const seeded = {};          // per stream: DOM is in append mode after first fill
  STREAMS.forEach(function (stream) {
    followBottom[stream] = true;
    renderedCount[stream] = 0;
    seeded[stream] = false;
  });

  let copyResetTimer = null;

  // ---- escaping & read helpers ----------------------------------------
  const AMP = '&amp;';
  const LT = '&lt;';
  const GT = '&gt;';
  const QUOT = '&quot;';

  function escapeText(value) {
    return String(value)
      .split('&').join(AMP)
      .split('<').join(LT)
      .split('>').join(GT)
      .split('"').join(QUOT)
      .split("'").join('&#39;');
  }

  function readLogs(key) {
    const logs = window.state && window.state.logs;
    const list = logs && logs[key];
    return Array.isArray(list) ? list : [];
  }

  // ---- parsing ---------------------------------------------------------
  // System: "2026-07-30 13:58:48 [INFO] message"
  const SYSTEM_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] (.*)$/;
  // Chat:   "[OFFLINE] 19:14:03 2026-06-30 19:14:03 user: message"
  const CHAT_TS_RE = /^(\d{2}:\d{2}:\d{2})\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*/;
  const FULL_TS_RE = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;
  const SHORT_TS_RE = /^(\d{2}:\d{2}:\d{2})\s+/;
  const LEAD_TAG_RE = /^\[([^\]]+)\]\s*/;
  const BOT_RE = /^\[BOT\]\s*:?\s*(.*)$/i;

  const LEVEL_ATTR = {
    TRACE: 'trace',
    DEBUG: 'debug',
    INFO: 'info',
    NOTICE: 'notice',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical',
    FATAL: 'critical'
  };

  function levelAttr(level) {
    return LEVEL_ATTR[level] || 'info';
  }

  function toSortKey(time) {
    if (!time) return null;
    const ts = Date.parse(String(time).replace(' ', 'T'));
    return Number.isFinite(ts) ? ts : null;
  }

  function parseSystem(raw) {
    const m = SYSTEM_RE.exec(raw);
    if (!m) return null;
    return {
      kind: 'system',
      time: m[1],
      level: m[2].toUpperCase(),
      message: m[3],
      sortKey: toSortKey(m[1])
    };
  }

  function parseChat(raw) {
    let rest = raw;
    let tag = '';
    let time = '';

    const tagMatch = LEAD_TAG_RE.exec(rest);
    if (tagMatch) {
      tag = tagMatch[1].toUpperCase();
      rest = rest.slice(tagMatch[0].length);
    }

    // Prefer the canonical "HH:MM:SS YYYY-MM-DD HH:MM:SS" prefix, then fall
    // back to a bare full/short timestamp so older formats still parse.
    let isBot = tag === 'BOT';

    const bothMatch = CHAT_TS_RE.exec(rest);
    if (bothMatch) {
      time = bothMatch[2];
      rest = rest.slice(bothMatch[0].length);
    } else {
      const fullMatch = FULL_TS_RE.exec(rest);
      if (fullMatch) {
        time = fullMatch[1];
        rest = rest.slice(0, fullMatch.index) + rest.slice(fullMatch.index + fullMatch[0].length);
      }
      const shortMatch = SHORT_TS_RE.exec(rest);
      if (shortMatch) {
        rest = rest.slice(shortMatch[0].length);
      }
      rest = rest.replace(/^\s+/, '');
    }

    let from = '';
    let message = rest;

    const botMatch = BOT_RE.exec(rest);
    if (botMatch) {
      isBot = true;
      from = 'BOT';
      message = botMatch[1];
    } else {
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        from = rest.slice(0, colonIdx).trim();
        message = rest.slice(colonIdx + 1).replace(/^\s+/, '');
      }
    }

    return {
      kind: 'chat',
      time: time,
      tag: tag,
      from: from,
      isBot: isBot,
      message: message,
      sortKey: toSortKey(time)
    };
  }

  // ---- html builders ---------------------------------------------------
  function buildSystemHtml(line) {
    return '<div class="log-line log-line--system">' +
      '<span class="log-line__time">' + escapeText(line.time) + '</span>' +
      '<span class="log-line__level log-level--' + levelAttr(line.level) + '">' + escapeText(line.level) + '</span>' +
      '<span class="log-line__msg">' + escapeText(line.message) + '</span>' +
      '</div>';
  }

  function buildChatHtml(line) {
    let inner = '<span class="log-line__time">' + escapeText(line.time) + '</span>';
    if (line.tag) inner += '<span class="log-line__tag">' + escapeText(line.tag) + '</span>';
    if (line.from) {
      inner += '<span class="log-line__from' + (line.isBot ? ' log-line__from--bot' : '') + '">' + escapeText(line.from) + '</span>';
    }
    inner += '<span class="log-line__msg">' + escapeText(line.message) + '</span>';
    return '<div class="log-line' + (line.isBot ? ' log-line--bot' : '') + '">' + inner + '</div>';
  }

  function buildHtml(key, parsed) {
    return key === 'system' ? buildSystemHtml(parsed) : buildChatHtml(parsed);
  }

  function itemFrom(key, raw) {
    const parsed = key === 'system' ? parseSystem(raw) : parseChat(raw);
    if (!parsed) return null;
    return {
      raw: raw,
      html: buildHtml(key, parsed),
      sortKey: parsed.sortKey || null,
      level: parsed.level || null
    };
  }

  // ---- additive ingestion ----------------------------------------------

  // Appends only lines we haven't seen before (dedupe set), keeping server
  // order. If the server flushes its buffer, reset this stream's cache.
  function ingestStream(key, serverLines) {
    const entries = cache[key];
    const seen = cache.seen[key];
    const fresh = [];

    if (serverLines.length === 0) {
      if (entries.length > 0) {
        entries.length = 0;
        seen.clear();
      }
      return fresh;
    }

    for (const raw of serverLines) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      const item = itemFrom(key, raw);
      if (!item) continue;
      entries.push(item);
      fresh.push(item);
    }

    if (entries.length > CACHE_CAP) {
      entries.splice(0, entries.length - CACHE_CAP);
    }
    return fresh;
  }

  // Feed the system stream and keep the derived Issues view in step.
  function ingestSystem(serverLines) {
    const fresh = ingestStream('system', serverLines);
    if (serverLines.length === 0) {
      if (cache.issues.length > 0) cache.issues.length = 0;
      return;
    }
    let grew = false;
    for (const item of fresh) {
      if (item.level && ISSUE_LEVEL_RE.test(item.level)) {
        cache.issues.push(item);
        grew = true;
      }
    }
    if (grew && cache.issues.length > CACHE_CAP) {
      cache.issues.splice(0, cache.issues.length - CACHE_CAP);
    }
  }

  function ingestChat(serverLines) {
    ingestStream('chat', serverLines);
  }

  // ---- rendering -------------------------------------------------------

  function emptyMessage(tab) {
    if (tab === 'issues') return 'No warnings or errors logged.';
    if (window.state && window.state.populated) {
      return tab === 'all' ? 'No log entries yet.' : 'No ' + tab + ' entries yet.';
    }
    return 'Waiting for the server to report logs…';
  }

  function renderEmpty(tab) {
    const container = outputEls[tab];
    const html = '<div class="logs-empty">' + escapeText(emptyMessage(tab)) + '</div>';
    if (container.innerHTML !== html) container.innerHTML = html;
    renderedCount[tab] = 0;
    seeded[tab] = false;
  }

  function trimDom(container) {
    while (container.children.length > CACHE_CAP) {
      const first = container.children[0];
      if (!first || !first.remove) break;
      first.remove();
    }
  }

  // Append-only view for the ordered streams (chat / system / issues).
  // New entries go on the tail; existing nodes are left alone, so the
  // scroll position never jumps between snapshots.
  function renderStream(tab) {
    const container = outputEls[tab];
    if (!container) return;
    const entries = cache[tab];

    if (entries.length === 0) {
      renderEmpty(tab);
      return;
    }

    if (!seeded[tab]) {
      container.innerHTML = '';
      for (const entry of entries) {
        container.insertAdjacentHTML('beforeend', entry.html);
      }
      seeded[tab] = true;
      renderedCount[tab] = entries.length;
      trimDom(container);
      return;
    }

    if (renderedCount[tab] > entries.length) {
      // Cache was pruned under us - re-sync fully once.
      container.innerHTML = '';
      for (const entry of entries) {
        container.insertAdjacentHTML('beforeend', entry.html);
      }
      renderedCount[tab] = entries.length;
      trimDom(container);
      return;
    }

    for (const entry of entries.slice(renderedCount[tab])) {
      container.insertAdjacentHTML('beforeend', entry.html);
    }
    renderedCount[tab] = entries.length;
    trimDom(container);
  }

  // The All view interleaves both streams by timestamp, so it can't stay
  // append-only in general; rebuild it from the bounded caches (cheap) and
  // preserve the user's relative scroll position when they've scrolled up.
  function mergeAll() {
    const merged = [];
    for (const item of cache.system) merged.push(item);
    for (const item of cache.chat) merged.push(item);
    merged.sort(function (a, b) {
      const ka = a.sortKey === null ? Number.POSITIVE_INFINITY : a.sortKey;
      const kb = b.sortKey === null ? Number.POSITIVE_INFINITY : b.sortKey;
      if (ka === kb) return 0;
      return ka < kb ? -1 : 1;
    });
    return merged;
  }

  function renderAll() {
    const container = outputEls.all;
    if (!container) return;

    const merged = mergeAll();
    if (merged.length === 0) {
      renderEmpty('all');
      return;
    }

    const prevScrollTop = container.scrollTop;
    const prevScrollHeight = container.scrollHeight;
    const willFollow = followBottom.all;

    const visible = merged.slice(-CACHE_CAP);
    container.innerHTML = '';
    for (const entry of visible) {
      container.insertAdjacentHTML('beforeend', entry.html);
    }
    renderedCount.all = visible.length;

    if (willFollow) {
      scrollToBottom(container);
    } else if (prevScrollHeight > 0) {
      // Preserve the distance from the bottom across the rebuild.
      container.scrollTop = Math.max(0, container.scrollHeight - (prevScrollHeight - prevScrollTop));
    }
  }

  // ---- summary metrics & live pill ------------------------------------

  function countMetrics(systemLines, chatLines) {
    let warnings = 0;
    for (const raw of systemLines) {
      const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\]/.exec(raw);
      if (!m) continue;
      if (ISSUE_LEVEL_RE.test(m[2].toUpperCase())) warnings += 1;
    }
    return {
      events: systemLines.length + chatLines.length,
      warnings: warnings,
      chat: chatLines.length
    };
  }

  function renderMetrics(systemLines, chatLines) {
    const counts = countMetrics(systemLines, chatLines);
    if (eventsEl) eventsEl.textContent = String(counts.events);
    if (warningsEl) warningsEl.textContent = String(counts.warnings);
    if (chatEl) chatEl.textContent = String(counts.chat);
  }

  function timeAgo(seconds) {
    if (seconds < 5) return 'just now';
    if (seconds < 60) return seconds + 's ago';
    const m = Math.floor(seconds / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
  }

  function renderLivePill() {
    if (!livePill) return;
    const fetchedAt = window.state && window.state.fetchedAt;
    const seconds = fetchedAt ? Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)) : -1;
    livePill.classList.toggle('logs-live-pill--wait', seconds < 0 || seconds > 45);
    livePill.innerHTML =
      '<span class="status-pill__dot"></span>' +
      (seconds < 0 ? 'Waiting for state…' : 'Updated ' + timeAgo(seconds));
  }

  function scrollToBottom(container) {
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }

  function isAtBottom(container) {
    return (container.scrollHeight - container.scrollTop - container.clientHeight) <= FOLLOW_THRESHOLD;
  }

  // Entry point called on every snapshot push and page activation.
  function render() {
    const systemLines = readLogs('system');
    const chatLines = readLogs('chat');

    ingestSystem(systemLines);
    ingestChat(chatLines);

    renderMetrics(systemLines, chatLines);
    renderLivePill();

    renderStream('chat');
    renderStream('system');
    renderStream('issues');
    renderAll();

    if (followBottom[activeTab]) {
      scrollToBottom(outputEls[activeTab]);
    }
  }

  // ---- interactions ----------------------------------------------------

  // Per-stream scroll tracking. When the user scrolls up, that stream stops
  // auto-following so new lines don't yank the viewport.
  STREAMS.forEach(function (stream) {
    const container = outputEls[stream];
    if (!container) return;
    container.addEventListener('scroll', function () {
      const atBottom = isAtBottom(container);
      followBottom[stream] = atBottom;
      if (stream === activeTab && jumpBtn) jumpBtn.hidden = atBottom;
    });
  });

  if (jumpBtn) {
    jumpBtn.addEventListener('click', function () {
      followBottom[activeTab] = true;
      jumpBtn.hidden = true;
      scrollToBottom(outputEls[activeTab]);
    });
  }

  function flashCopied() {
    if (!copyBtn) return;
    copyBtn.textContent = 'Copied!';
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(function () {
      copyBtn.textContent = 'Copy';
    }, 1400);
  }

  function copyText(text) {
    const fallback = function () {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch (error) {
        // ignore
      }
      textarea.remove();
      flashCopied();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flashCopied, fallback);
    } else {
      fallback();
    }
  }

  // Raw lines for the active tab - what you see is what you copy.
  function rawsForTab(tab) {
    if (tab === 'all') {
      return mergeAll().slice(-CACHE_CAP).map((entry) => entry.raw);
    }
    return cache[tab].map((entry) => entry.raw);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      copyText(rawsForTab(activeTab).join('\n'));
    });
  }

  function selectTab(tab) {
    activeTab = tab;
    tabButtons.forEach(function (btn) {
      const on = btn.dataset.logTab === tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    STREAMS.forEach(function (stream) {
      const container = outputEls[stream];
      if (container) container.hidden = stream !== tab;
    });
    if (followBottom[tab]) {
      scrollToBottom(outputEls[tab]);
      if (jumpBtn) jumpBtn.hidden = true;
    }
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const tab = btn.dataset.logTab;
      if (tab && tab !== activeTab) {
        selectTab(tab);
        render();
      }
    });
  });

  // ---- wiring ----------------------------------------------------------

  // Re-render on snapshot pushes. Re-running this file (forced reload)
  // detaches the previous subscription instead of stacking duplicates,
  // matching the pattern used by overview/commands.
  if (window.state && window.state.subscribe) {
    if (typeof window.pageControllers.__logsUnsubscribe === 'function') {
      window.pageControllers.__logsUnsubscribe();
    }
    window.pageControllers.__logsUnsubscribe = window.state.subscribe(render);
  }

  const handleActivate = (event) => {
    if (event.detail && event.detail.pageId === 'logs') render();
  };
  if (window.pageControllers.__logsActivateHandler) {
    document.removeEventListener('page:activate', window.pageControllers.__logsActivateHandler);
  }
  document.addEventListener('page:activate', handleActivate);
  window.pageControllers.__logsActivateHandler = handleActivate;

  // Keep the "Updated Xs ago" pill fresh between state pushes.
  if (window.pageControllers.__logsTimer) {
    clearInterval(window.pageControllers.__logsTimer);
  }
  window.pageControllers.__logsTimer = setInterval(renderLivePill, 10000);

  selectTab('all');
  render();
};

// Initialize the page controller
window.pageControllers.logs();
