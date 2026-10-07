# WebUI Connection Layer

Mirrors `RemoteUI/core/interface.py` and `RemoteUI/state.py` in JavaScript.

## Files

- **`state.js`** - Runtime state management (mirrors `RemoteUI/state.py`)
- **`websocketbridge.js`** - WebSocket communication (mirrors `RemoteUI/core/interface.py` bridge)
- **`connection.js`** - Connection manager with fallback logic (mirrors Python's `configure_ws_url()`)

## Quick Start

### 1. Initialize Connection (in app.js or main entry point)

```javascript
import { configureConnection, startConnection, getBridge } from './js/connection/connection.js';

// Configure with primary URL and optional fallback
configureConnection(
    'wss://your-tunnel.trycloudflare.com',  // Primary (e.g., Cloudflare tunnel)
    'ws://localhost:61000'                    // Fallback (local server)
);

// Start the WebSocket connection
startConnection();
```

### 2. Send Commands (in UI page scripts)

```javascript
import { getBridge } from '../js/connection/connection.js';

const bridge = getBridge();

// Fire-and-forget (no response expected)
bridge.send('start_bot');

// Wait for response (request-response pattern)
const response = await bridge.sendWithResponse('start_giveaway', {
    title: 'My Giveaway'
});

if (response.ok) {
    console.log('Success:', response.result);
} else {
    console.error('Failed:', response.error);
}
```

### 3. Access State (in UI pages)

```javascript
import { state } from '../js/connection/state.js';

// Nested access (matches server structure)
console.log(state.runtime.gw_state);        // "RUNNING" / "ROLLING" / "ENDED" / "IDLE"
console.log(state.runtime.gw_entries_count); // 42
console.log(state.bot.running);              // true/false

// Raw snapshot
console.log(state.raw.get('version'));       // "1.0.0"

// Check if state is populated
if (state.populated) {
    // Do something with state
}

// Subscribe to state changes
const unsubscribe = state.subscribe((newState) => {
    console.log('State updated:', newState);
});

// Later: unsubscribe();
```

### 4. React to Connection Events

```javascript
import { getBridge } from '../js/connection/connection.js';

const bridge = getBridge();

// Listen for state updates (alternative to state.subscribe)
bridge.onStateUpdate((serverState) => {
    console.log('Received state update:', serverState);
});

// Listen for log messages from server
bridge.onLog((message, level) => {
    console.log(`[${level}] ${message}`);
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  UI Page (HTML + script.js)                             │
│                                                          │
│  ┌────────────────────────────────────────────┐         │
│  │  Button Click Handler                       │         │
│  │                                             │         │
│  │  const bridge = getBridge();                │         │
│  │  await bridge.sendWithResponse(             │         │
│  │    'start_giveaway',                        │         │
│  │    { title: 'Test' }                        │         │
│  │  );                                         │         │
│  └────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  connection.js (Connection Manager)                     │
│  - configureConnection(url, fallback)                   │
│  - startConnection() / stopConnection()                 │
│  - getBridge() → returns global bridge instance         │
│  - Auto-fallback: primary → localhost:61000             │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  websocketbridge.js (WebSocketBridge)                   │
│  - connect() / disconnect()                             │
│  - send(action, payload, type) → fire-and-forget        │
│  - sendWithResponse(action, payload) → Promise          │
│  - onStateUpdate(callback) / onLog(callback)            │
│  - Auto-reconnect with fallback logic                   │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  WebSocket Server (MizuBot)                             │
│  - Receives commands                                   │
│  - Sends state_update, log, response messages          │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  state.js (RuntimeState Singleton)                      │
│  - Auto-updated by connection.js on state_update        │
│  - Dot-access: state.runtime.gw_state                   │
│  - Listeners: state.subscribe(callback)                 │
│  - Raw: state.raw, state.toObject()                     │
└─────────────────────────────────────────────────────────┘
```

## Fallback Logic

Matches Python's `RemoteUI/core/interface.py` behavior:

1. **Try primary URL** (e.g., Cloudflare tunnel)
2. **If connection fails BEFORE successful handshake** → switch to fallback URL (ws://localhost:61000)
3. **If connection fails AFTER successful handshake** → retry same URL (don't switch)
4. **If fallback also fails** → stop retrying

## Packet Format

### Send (Command)

```json
{
  "type": "command",
  "action": "start_giveaway",
  "payload": {
    "title": "My Giveaway"
  },
  "session_id": "abc123",
  "timestamp": 1699123456789,
  "source": "WebUI"
}
```

### Send with Response

```json
{
  "type": "command",
  "action": "start_giveaway",
  "payload": {
    "title": "My Giveaway"
  },
  "request_id": "start_giveaway_1699123456789",
  "session_id": "abc123",
  "timestamp": 1699123456789,
  "source": "WebUI"
}
```

### Receive (State Update)

```json
{
  "type": "state_update",
  "version": 123,
  "state": {
    "runtime": {
      "gw_state": "RUNNING",
      "gw_entries_count": 42
    },
    "bot": {
      "running": true
    }
  }
}
```

### Receive (Response)

```json
{
  "type": "response",
  "request_id": "start_giveaway_1699123456789",
  "ok": true,
  "result": {
    "giveaway_id": "xyz789"
  },
  "error": ""
}
```

## Comparison with Python

| Feature | Python (RemoteUI) | JavaScript (WebUI) |
|---------|-------------------|-------------------|
| State management | `RemoteState` with `__getattr__` | `RuntimeState` with `Proxy` |
| Dot-access | `state.runtime.gw_state` | `state.runtime.gw_state` |
| WebSocket bridge | `WebSocketBridge` class | `WebSocketBridge` class |
| Connection config | `configure_ws_url()` | `configureConnection()` |
| Fallback logic | Yes (primary → localhost:61000) | Yes (primary → localhost:61000) |
| Send command | `bridge.send_with_response()` | `bridge.sendWithResponse()` |
| State listeners | No (manual polling) | Yes (`onStateUpdate()`, `state.subscribe()`) |
| Global instance | `from state import state` | `import { state }` |

## Next Steps

- [ ] Add command builder layer (optional - individual functions like `startGiveaway()`)
- [ ] Add compat aliases to state (flat key access like `state.gw_state`)
- [ ] Integrate with actual UI pages
- [ ] Test with live server