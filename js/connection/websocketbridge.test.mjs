import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocketBridge } from './websocketbridge.js';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

test('connect is idempotent while its socket is opening or open', () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;

  try {
    const bridge = new WebSocketBridge('ws://localhost:61000');
    bridge.connect();
    bridge.connect();

    assert.equal(FakeWebSocket.instances.length, 1);
    bridge.disconnect();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test('a late close event from an old socket cannot clear the current connection', () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;

  try {
    const bridge = new WebSocketBridge('ws://localhost:61000');
    bridge.connect();
    const oldSocket = FakeWebSocket.instances[0];
    oldSocket.open();

    const currentSocket = new FakeWebSocket('ws://localhost:61000');
    bridge.socket = currentSocket;
    oldSocket.close();

    assert.equal(bridge.socket, currentSocket);
    assert.equal(bridge.connected, true);
    bridge.disconnect();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test('a failed authenticated health check closes the stale socket', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let healthCheck;
  globalThis.setTimeout = (callback) => {
    healthCheck = callback;
    return 1;
  };
  globalThis.clearTimeout = () => {};

  try {
    const bridge = new WebSocketBridge('ws://localhost:61000');
    const socket = new FakeWebSocket('ws://localhost:61000');
    bridge.socket = socket;
    bridge.connected = true;
    bridge.authenticated = true;
    bridge.sendWithResponse = async () => {
      throw new Error('Timeout');
    };

    bridge._scheduleConnectionHealthCheck();
    await healthCheck();

    assert.equal(socket.readyState, FakeWebSocket.CLOSED);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('disconnect emits the disconnected state immediately', () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;

  try {
    const bridge = new WebSocketBridge('ws://localhost:61000');
    const states = [];
    bridge.onConnectionStateChange((state) => states.push(state));
    bridge.connect();
    FakeWebSocket.instances[0].open();
    bridge.disconnect();

    assert.equal(bridge.connected, false);
    assert.equal(states.at(-1).status, 'disconnected');
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
