import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBotUrl } from './discover.js';

test('dev mode uses localhost without probing production or saved endpoints', async () => {
  const originalWindow = globalThis.window;
  const originalWebSocket = globalThis.WebSocket;
  let probeAttempted = false;
  globalThis.window = {
    location: { search: '' },
    electronAPI: { isDevMode: async () => true },
  };
  globalThis.WebSocket = class {
    constructor() {
      probeAttempted = true;
      throw new Error('Dev mode should not probe remote endpoints');
    }
  };

  try {
    assert.equal(await resolveBotUrl(), 'ws://127.0.0.1:61000');
    assert.equal(probeAttempted, false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('explicit ws query parameter takes precedence over dev mode', async () => {
  const originalWindow = globalThis.window;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.window = {
    location: { search: '?ws=wss%3A%2F%2Fbot.example.com%3A61000' },
    electronAPI: { isDevMode: async () => true },
  };

  try {
    assert.equal(await resolveBotUrl(), 'wss://bot.example.com:61000');
  } finally {
    globalThis.window = originalWindow;
    globalThis.WebSocket = originalWebSocket;
  }
});
