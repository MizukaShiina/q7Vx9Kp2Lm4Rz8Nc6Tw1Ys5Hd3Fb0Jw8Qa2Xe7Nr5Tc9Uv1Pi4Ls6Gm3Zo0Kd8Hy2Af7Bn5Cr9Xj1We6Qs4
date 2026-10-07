// connection.js
//
// WebSocket connection manager with fallback logic.
// Mirrors RemoteUI/core/interface.py's connection handling.
//
// Usage:
//   import { configureConnection, startConnection, stopConnection, getBridge } from './connection/connection.js';
//   
//   configureConnection('wss://your-tunnel.trycloudflare.com', 'ws://localhost:61000');
//   startConnection();
//   
//   // In your UI code:
//   const bridge = getBridge();
//   bridge.send('start_giveaway', { title: 'Test' });

import { WebSocketBridge } from './websocketbridge.js';
import { state } from './state.js';

// Global bridge instance (mirrors Python's _bridge global)
let bridge = null;

// Connection configuration
let primaryUrl = '';
let fallbackUrl = null;
let triedFallback = false;

/**
 * Build the bot WebSocket URL from the page location.
 * This supports local WebUI + local bot and remote WebUI + remote bot.
 */
export function getDefaultConnectionUrl() {
    const configuredUrl = window.MIZUBOT_WS_URL ||
        new URLSearchParams(window.location.search).get('ws');
    if (configuredUrl) {
        return configuredUrl.trim();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || '127.0.0.1';
    return `${protocol}//${hostname}:61000`;
}

/**
 * Configure the WebSocket URL and create bridge instance.
 * 
 * @param {string} url - Primary server URL (e.g., Cloudflare tunnel)
 * @param {string|null} fallback - Optional fallback URL (e.g., ws://localhost:61000)
 */
export function configureConnection(url, fallback = null) {
    primaryUrl = url;
    fallbackUrl = fallback;
    triedFallback = false;
    
    // Normalize URL (convert https:// to wss://, etc.)
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('ws://') && !normalizedUrl.startsWith('wss://')) {
        normalizedUrl = normalizedUrl.replace('https://', 'wss://');
        normalizedUrl = normalizedUrl.replace('http://', 'ws://');
        normalizedUrl = normalizedUrl.replace(/\/$/, ''); // Remove trailing slash
        if (normalizedUrl.endsWith('/ws')) {
            normalizedUrl = normalizedUrl.slice(0, -3); // Remove /ws path
        }
    }
    primaryUrl = normalizedUrl;
    
    // Normalize fallback URL
    if (fallback) {
        let normalizedFallback = fallback.trim();
        if (!normalizedFallback.startsWith('ws://') && !normalizedFallback.startsWith('wss://')) {
            normalizedFallback = normalizedFallback.replace('https://', 'wss://');
            normalizedFallback = normalizedFallback.replace('http://', 'ws://');
            normalizedFallback = normalizedFallback.replace(/\/$/, '');
            if (normalizedFallback.endsWith('/ws')) {
                normalizedFallback = normalizedFallback.slice(0, -3);
            }
        }
        fallbackUrl = normalizedFallback;
    }
    
    // Create bridge instance
    bridge = new WebSocketBridge(primaryUrl, fallbackUrl);
    
    console.log('[Connection] WebSocket URL configured:', primaryUrl);
    if (fallbackUrl) {
        console.log('[Connection] Fallback URL configured:', fallbackUrl);
    }
}

/**
 * Start the WebSocket connection.
 * 
 * @returns {boolean} True if started successfully
 */
export function startConnection() {
    if (!bridge) {
        console.error('[Connection] No bridge configured. Call configureConnection() first.');
        return false;
    }
    
    // Set up state listener to update global state
    bridge.onStateUpdate((serverState) => {
        state.update(serverState);
    });
    
    // Set up log listener
    bridge.onLog((message, level) => {
        console.log(`[Connection] ${level}: ${message}`);
    });
    
    // Connect
    bridge.connect();
    
    return true;
}

/**
 * Stop the WebSocket connection.
 */
export function stopConnection() {
    if (bridge) {
        bridge.disconnect();
    }
}

/**
 * Get the global bridge instance.
 * 
 * @returns {WebSocketBridge|null} The bridge instance or null if not configured
 */
export function getBridge() {
    return bridge;
}

/**
 * Check if WebSocket is connected.
 * 
 * @returns {boolean} Connection status
 */
export function isConnected() {
    return bridge ? bridge.connected : false;
}

/**
 * Get the current connection state for UI indicators.
 * 
 * @returns {object} Connection state info
 */
export function getConnectionState() {
    return bridge ? bridge.getConnectionState() : {
        connected: false,
        status: 'disconnected',
        label: 'Disconnected',
        usingFallback: false,
        currentUrl: primaryUrl,
        primaryUrl,
        fallbackUrl,
    };
}

/**
 * Subscribe to connection state changes.
 * 
 * @param {function} callback - Callback to receive connection state updates
 * @returns {function} Unsubscribe function
 */
export function subscribeToConnectionState(callback) {
    if (!bridge) {
        return () => {};
    }

    return bridge.onConnectionStateChange(callback);
}

/**
 * Subscribe to overlay events relayed from the bot (type "overlay_signal").
 *
 * @param {function} callback - Callback receiving { event, data, timestamp }
 * @returns {function} Unsubscribe function
 */
export function subscribeToOverlayEvents(callback) {
    if (!bridge) {
        return () => {};
    }

    bridge.onOverlayEvent(callback);
    return () => bridge.removeOverlayEvent(callback);
}

/**
 * Get the current WebSocket URL.
 * 
 * @returns {string} Current URL
 */
export function getCurrentUrl() {
    return bridge ? bridge.url : '';
}