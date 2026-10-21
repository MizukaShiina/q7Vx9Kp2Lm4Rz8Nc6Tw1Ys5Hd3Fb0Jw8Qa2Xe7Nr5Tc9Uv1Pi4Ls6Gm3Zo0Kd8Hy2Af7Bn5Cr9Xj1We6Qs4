// discover.js
//
// LAN bot auto-discovery for the WebUI.
//
// Resolution order (implemented by resolveBotUrl):
//   1. ?ws= query param           - explicit override, always wins
//   2. saved URL in localStorage  - probed once; purged when unreachable
//   3. ws://127.0.0.1:61000       - fast path; keeps same-PC behavior instant
//   4. derived default URL        - today's behavior (page hostname), probed
//   5. LAN scan of candidate IPs  - first ws://<ip>:61000 that opens wins
//   6. derived default URL        - nothing found; hand it to the retry loop
//
// Probing uses plain WebSocket opens - no dependencies, no bot-side changes
// (the bot already listens on 0.0.0.0:61000). A successful probe socket is
// closed immediately; the bot logs a couple of "waiting for login" lines for
// it. Non-localhost results are cached in localStorage so the scan runs once
// per machine, not once per launch.
//
// Candidate sources:
//   - Electron: window.electronAPI.getLanCandidates() -> exact subnet (os)
//   - Browser:  the /24 around location.hostname when it is an IPv4 address
//     (home-LAN assumption; the Electron path is netmask-correct)

import { getDefaultConnectionUrl } from './connection.js';

const STORAGE_KEY = 'mizubot:wsUrl';
const DEFAULT_PORT = 61000;
const PROBE_TIMEOUT_MS = 600;
const SCAN_BATCH_SIZE = 64;
// Subnets wider than this (fewer prefix bits than /22) are not expanded
// fully; we fall back to the /24 around this machine's own address.
const MIN_PREFIX_BITS = 22;

const LOCALHOST_URL = `ws://127.0.0.1:${DEFAULT_PORT}`;

const IPv4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a user/config supplied endpoint to ws://host:port form.
 * Mirrors connection.js's normalization (http(s) -> ws(s), strip trailing
 * slash and /ws suffix). Returns '' for empty/invalid input.
 */
export function normalizeWsUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  let url = value;
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = url.replace('https://', 'wss://');
    url = url.replace('http://', 'ws://');
  }
  url = url.replace(/\/$/, '');
  if (url.endsWith('/ws')) {
    url = url.slice(0, -3);
  }

  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    return '';
  }
  try {
    // Throws on unparseable input (e.g. "ws://").
    new URL(url);
  } catch (error) {
    return '';
  }
  return url;
}

// ---------------------------------------------------------------------------
// localStorage cache (guarded - some file:// contexts restrict it)
// ---------------------------------------------------------------------------

export function readSavedUrl() {
  try {
    return normalizeWsUrl(window.localStorage?.getItem(STORAGE_KEY));
  } catch (error) {
    return '';
  }
}

export function saveDiscoveredUrl(url) {
  const normalized = normalizeWsUrl(url);
  if (!normalized || normalized === LOCALHOST_URL) return;
  try {
    window.localStorage?.setItem(STORAGE_KEY, normalized);
  } catch (error) {
    // Cache is best-effort only.
  }
}

export function clearSavedUrl() {
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch (error) {
    // Cache is best-effort only.
  }
}


// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

/**
 * Try to open a WebSocket to `url`. Resolves true on open, false on
 * error/close/timeout. A successful probe socket is closed immediately.
 */
export function probeWs(url, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) {
        try {
          socket.close();
        } catch (error) {
          // Already closed - fine.
        }
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      socket = new WebSocket(url);
    } catch (error) {
      finish(false);
      return;
    }

    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
  });
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + (Number(octet) & 255)) >>> 0, 0) >>> 0;
}

function longToIp(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function prefixBits(netmask) {
  const mask = ipToLong(netmask || '');
  let bits = 0;
  for (let i = 31; i >= 0; i -= 1) {
    if ((mask >>> i) & 1) {
      bits += 1;
    } else {
      break;
    }
  }
  return bits;
}

/**
 * Expand an IPv4 address + netmask into host IPs (no network/broadcast,
 * excluding `selfAddress`). Subnets wider than /MIN_PREFIX_BITS degrade to
 * the /24 around `selfAddress`. /31 and /32 yield nothing.
 */
export function expandSubnet(selfAddress, netmask) {
  if (!IPv4_RE.test(String(selfAddress || ''))) return [];

  let address = ipToLong(selfAddress);
  let bits = prefixBits(netmask);

  if (bits < MIN_PREFIX_BITS || bits === 0) {
    // Too wide (or invalid mask): assume a /24 around this machine.
    address = address & ipToLong('255.255.255.0');
    bits = 24;
  }

  const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;
  const network = (address & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  const hosts = [];
  for (let host = (network + 1) >>> 0; host < broadcast; host = (host + 1) >>> 0) {
    const ip = longToIp(host);
    if (ip !== selfAddress) hosts.push(ip);
    if (hosts.length >= 1024) break; // hard safety cap
  }
  return hosts;
}

/**
 * Build the ordered list of ws:// URL candidates to scan, localhost first.
 */
export async function getCandidateUrls() {
  const urls = [];
  const seen = new Set();
  const push = (ip) => {
    const url = `ws://${ip}:${DEFAULT_PORT}`;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  };

  push('127.0.0.1');

  let entries = [];
  if (typeof window.electronAPI?.getLanCandidates === 'function') {
    try {
      entries = (await window.electronAPI.getLanCandidates()) || [];
    } catch (error) {
      console.warn('[Discover] getLanCandidates failed:', error);
      entries = [];
    }
  }

  if (!entries.length) {
    // Browser mode: approximate the subnet from the page's own IPv4 address.
    const host = String(window.location?.hostname || '');
    if (IPv4_RE.test(host)) {
      entries = [{ address: host, netmask: '255.255.255.0' }];
    }
  }

  for (const entry of entries) {
    if (!entry || !IPv4_RE.test(String(entry.address || ''))) continue;
    for (const ip of expandSubnet(entry.address, entry.netmask)) {
      push(ip);
    }
  }

  return urls;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Probe URLs in parallel batches; resolve with the first URL that opens
 * (lowest index within a winning batch), or null. Stops at the first hit.
 */
export async function scanFirstHit(urls, { batchSize = SCAN_BATCH_SIZE, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((url) => probeWs(url, timeoutMs)));
    const hit = results.indexOf(true);
    if (hit !== -1) return batch[hit];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the bot WebSocket endpoint. See the precedence list at the top of
 * this file. Returns a ws:// URL string (never empty - the last resort is
 * connection.js's derived default, whose retry loop takes over).
 */
export async function resolveBotUrl() {
  // 1. Explicit ?ws= override - never scanned, never cached.
  const paramUrl = normalizeWsUrl(new URLSearchParams(window.location?.search || '').get('ws'));
  if (paramUrl) return paramUrl;

  // 2. Previously discovered URL - one probe, then trust it for this session.
  const savedUrl = readSavedUrl();
  if (savedUrl) {
    if (await probeWs(savedUrl)) return savedUrl;
    clearSavedUrl();
  }

  // 3. Same-PC fast path - preserves the historical instant connect.
  if (await probeWs(LOCALHOST_URL)) return LOCALHOST_URL;

  // 4. Today's derived default (page hostname) - probe before scanning so the
  //    "WebUI served from the bot PC" setup stays instant.
  const derived = normalizeWsUrl(getDefaultConnectionUrl());
  if (derived && derived !== LOCALHOST_URL && (await probeWs(derived))) {
    return derived;
  }

  // 5. LAN scan.
  try {
    const candidates = (await getCandidateUrls()).filter((url) => url !== LOCALHOST_URL && url !== derived);
    const found = await scanFirstHit(candidates);
    if (found) {
      saveDiscoveredUrl(found);
      return found;
    }
  } catch (error) {
    console.warn('[Discover] LAN scan failed:', error);
  }

  // 6. Nothing reachable right now - fall back to the derived URL and let the
  //    bridge's reconnect/backoff loop keep retrying it.
  return derived || getDefaultConnectionUrl();
}

