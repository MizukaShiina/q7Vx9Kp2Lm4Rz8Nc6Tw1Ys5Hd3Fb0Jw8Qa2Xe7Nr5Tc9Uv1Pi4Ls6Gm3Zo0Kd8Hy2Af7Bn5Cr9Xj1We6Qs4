// websocketbridge.js
//
// Handles:
// - WebSocket connection
// - Receiving messages
// - Sending messages
// - Request/response handling
//
// Does NOT handle:
// - UI
// - State storage
// - Business logic

// Discord IDs are larger than Number.MAX_SAFE_INTEGER. Quote unsafe integer
// literals before parsing so JSON.parse keeps their exact decimal digits.
const CONNECTION_HEALTH_CHECK_INTERVAL_MS = 60 * 1000;
const CONNECTION_HEALTH_CHECK_TIMEOUT_MS = 10 * 1000;

function parseJsonPreservingLargeIntegers(raw) {
    let normalized = '';
    let inString = false;
    let escaped = false;

    for (let index = 0; index < raw.length;) {
        const character = raw[index];

        if (inString) {
            normalized += character;
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            index += 1;
            continue;
        }

        if (character === '"') {
            inString = true;
            normalized += character;
            index += 1;
            continue;
        }

        if (character === '-' || (character >= '0' && character <= '9')) {
            const remainder = raw.slice(index);
            const match = remainder.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
            if (match) {
                const token = match[0];
                if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) {
                    normalized += `"${token}"`;
                } else {
                    normalized += token;
                }
                index += token.length;
                continue;
            }
        }

        normalized += character;
        index += 1;
    }

    return JSON.parse(normalized);
}


export class WebSocketBridge {

    constructor(url, fallbackUrl = null) {

        this.url = url;
        this.fallbackUrl = fallbackUrl;

        this.socket = null;

        this.connected = false;
        this.stopping = false;
        this._triedFallback = false;
        this._usingFallback = false;
        this._handshakeSuccessful = false;

        this.sessionId = null;
        this.authenticated = false;
        this.authPending = false;
        this.sessionExpiresAt = 0;
        this._sessionRefreshTimer = null;
        this._sessionRefreshLeadTime = 5 * 60 * 1000;
        this._connectionHealthTimer = null;
        this._reconnectTimer = null;

        this.pendingResponses = new Map();

        this.stateListeners = [];
        this.logListeners = [];
        this.connectionStateListeners = [];
        this.overlayListeners = [];

        this.reconnectDelay = 5000;
        this.maxReconnectDelay = 30000;
        this.primaryUrl = url;

    }

    onConnectionStateChange(callback) {
        this.connectionStateListeners.push(callback);
        return () => {
            this.connectionStateListeners = this.connectionStateListeners.filter((listener) => listener !== callback);
        };
    }

    emitConnectionStateChange() {
        const state = this.getConnectionState();
        this.connectionStateListeners.forEach((callback) => callback(state));

        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('connection:state', { detail: state }));
        }
    }

    getConnectionState() {
        let status = 'disconnected';
        let label = 'Disconnected';

        if (this.connected) {
            if (this._usingFallback) {
                status = 'offline';
                label = 'Offline mode';
            } else {
                status = 'primary';
                label = 'Primary connected';
            }
        }

        return {
            connected: this.connected,
            authenticated: this.authenticated,
            status,
            label,
            usingFallback: this._usingFallback,
            currentUrl: this.url,
            primaryUrl: this.primaryUrl,
            fallbackUrl: this.fallbackUrl,
        };
    }

    connect() {
        this.stopping = false;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        if (
            this.socket &&
            (this.socket.readyState === WebSocket.CONNECTING ||
                this.socket.readyState === WebSocket.OPEN)
        ) {
            return;
        }

        clearTimeout(this._sessionRefreshTimer);
        this._sessionRefreshTimer = null;
        clearTimeout(this._connectionHealthTimer);
        this._connectionHealthTimer = null;
        this.sessionExpiresAt = 0;
        this.authenticated = false;
        this.authPending = false;
        this.sessionId = null;
        console.log(
            "[WebSocket] Connecting:",
            this.url
        );

        const socket = new WebSocket(this.url);
        this.socket = socket;

        socket.onopen = () => {
            if (this.socket !== socket || this.stopping) return;
            this.connected = true;
            this._handshakeSuccessful = false;
            this._usingFallback = this.url === this.fallbackUrl;
            this.reconnectDelay = 5000;
            console.log(
                "[WebSocket] Connected"
            );
            this.emitLog(
                "WebSocket connected",
                "success"
            );
            this.emitConnectionStateChange();
        };

        socket.onmessage = (event) => {
            if (this.socket !== socket) return;
            this.handleMessage(event.data);
        };

        socket.onerror = (error) => {
            if (this.socket === socket) {
                console.error("[WebSocket] Error", error);
            }
        };

        socket.onclose = () => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.connected = false;
            this.authenticated = false;
            this.authPending = false;
            this.sessionId = null;
            clearTimeout(this._sessionRefreshTimer);
            this._sessionRefreshTimer = null;
            clearTimeout(this._connectionHealthTimer);
            this._connectionHealthTimer = null;
            this.sessionExpiresAt = 0;
            if (this._loginReject) {
                this._loginReject(new Error("WebSocket disconnected during login"));
            }
            this.emitConnectionStateChange();

            console.log(
                "[WebSocket] Disconnected"
            );

            if (!this.stopping) {
                // Only switch to fallback if connection failed BEFORE successful handshake
                if (
                    this.fallbackUrl &&
                    !this._triedFallback &&
                    !this._handshakeSuccessful
                ) {
                    this._triedFallback = true;
                    this._usingFallback = true;
                    console.log(
                        "[WebSocket] Switching to fallback server URL:",
                        this.fallbackUrl
                    );
                    this.url = this.fallbackUrl;
                    this._scheduleReconnect(1000);
                } else {
                    // Connection refused on final URL or after successful handshake
                    if (this._handshakeSuccessful) {
                        console.log(
                            "[WebSocket] Connection lost after successful handshake, will retry..."
                        );
                    } else {
                        console.log(
                            "[WebSocket] Connection failed, will retry",
                            this.url
                        );
                    }
                    
                    const retryDelay = this.reconnectDelay;
                    this.reconnectDelay = Math.min(
                        this.reconnectDelay * 2,
                        this.maxReconnectDelay
                    );
                    this._scheduleReconnect(retryDelay);
                }
            }
        };
    }

    _scheduleReconnect(delay) {
        if (this.stopping || this._reconnectTimer) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (!this.stopping) this.connect();
        }, delay);
    }

    _scheduleConnectionHealthCheck() {
        clearTimeout(this._connectionHealthTimer);
        this._connectionHealthTimer = null;
        if (!this.connected || !this.authenticated) return;

        this._connectionHealthTimer = setTimeout(async () => {
            this._connectionHealthTimer = null;
            if (!this.connected || !this.authenticated) return;
            const socket = this.socket;

            try {
                const response = await this.sendWithResponse(
                    "refresh_session",
                    {},
                    CONNECTION_HEALTH_CHECK_TIMEOUT_MS
                );
                if (this.socket !== socket || !this.connected || !this.authenticated) return;
                if (!response.ok) {
                    throw new Error(response.error || "Session health check was rejected");
                }

                this._scheduleSessionRefresh(response.result?.expires_in);
                if (!this.sessionExpiresAt) {
                    throw new Error("Server returned an invalid session lifetime");
                }
                this._scheduleConnectionHealthCheck();
            } catch (error) {
                console.warn("[WebSocket] Connection health check failed:", error);
                if (this.socket === socket && socket) {
                    socket.close();
                }
            }
        }, CONNECTION_HEALTH_CHECK_INTERVAL_MS);
    }

    handleMessage(raw) {

        let data;
        try {

            data = parseJsonPreservingLargeIntegers(raw);
        }
        catch (error) {
            console.warn(
                "[WebSocket] Invalid JSON:",
                raw
            );
            return;
        }

        if (!data || typeof data !== "object") {
            return;
        }

        this._scheduleConnectionHealthCheck();

        switch (data.type) {

            case "state_update":

                console.log(
                    "[WebSocket] State update",
                    data.state
                );

                this.stateListeners.forEach(
                    callback => {

                        callback(
                            data.state
                        );

                    }
                );

                break;

            case "log":

                this.emitLog(
                    data.message ?? "",
                    data.level ?? "info"
                );

                break;

            case "overlay_signal": {
                // Transient, non-persisted overlay events pushed by the bot in
                // parallel to the OBS overlay stream (e.g. raid, sub, follow,
                // shoutout, chat_msg). The WebUI relays these to a local
                // server (overlayServer.js) that OBS browser sources connect to.
                const overlayEvent = {
                    event: data.event,
                    data: data.data,
                    timestamp: data.timestamp,
                };

                this.overlayListeners.forEach((callback) => {
                    try {
                        callback(overlayEvent);
                    } catch (error) {
                        console.error("[WebSocket] Overlay listener error", error);
                    }
                });

                if (typeof window !== "undefined" && window.dispatchEvent) {
                    window.dispatchEvent(
                        new CustomEvent("overlay:event", { detail: overlayEvent })
                    );
                }

                break;
            }

            case "response": {

                const requestId =
                    data.request_id;


                const callback =
                    this.pendingResponses.get(
                        requestId
                    );
                if (callback) {

                    this.pendingResponses.delete(
                        requestId
                    );
                    callback({
                        ok: data.ok ?? false,
                        result: data.result,
                        error: data.error ?? ""
                    });

                }
                break;
            }

            case "login_ok": {
                this.authenticated = true;
                this.authPending = false;
                this.sessionId = data.session_id ?? null;
                this._handshakeSuccessful = true;
                this._scheduleSessionRefresh(data.expires_in);
                this._scheduleConnectionHealthCheck();
                this.emitConnectionStateChange();
                console.log("[WebSocket] Logged in");
                if (this._loginResolve) {
                    this._loginResolve({
                        ok: true,
                        session_id: this.sessionId,
                        expires_in: data.expires_in,
                    });
                }
                break;
            }

            case "login_error":
                this.authenticated = false;
                this.authPending = false;
                console.warn("[WebSocket] Login failed:", data.error);
                this.emitConnectionStateChange();
                if (this._loginReject) {
                    this._loginReject(new Error(data.error || "Login failed"));
                    this._loginResolve = null;
                    this._loginReject = null;
                }
                break;

            case "session_refresh":
                this.sessionId = data.session_id ?? this.sessionId;
                break;

            default:
                console.log(
                    "[WebSocket] Unknown message:",
                    data
                );

        }

    }

    send(
        action,
        payload = {},
        packetType = "command"
    ) {


        if (
            !this.connected ||
            !this.socket ||
            !this.authenticated
        ) {

            console.warn(
                "[WebSocket] Cannot send, disconnected:",
                action
            );

            return false;

        }



        const packet = {


            type: packetType,

            action,

            payload,

            session_id:
                this.sessionId,


            timestamp:
                Date.now(),


            source:
                "WebUI"


        };



        this.socket.send(
            JSON.stringify(packet)
        );


        return true;

    }

    sendWithResponse(
        action,
        payload = {},
        timeout = 10000
    ) {


        return new Promise(
            (resolve, reject) => {


                if (!this.connected || !this.authenticated) {

                    reject(
                        "WebSocket disconnected"
                    );

                    return;

                }



                const requestId =
                    `${action}_${Date.now()}`;



                const timer =
                    setTimeout(() => {


                        this.pendingResponses.delete(
                            requestId
                        );


                        reject(
                            "Timeout"
                        );


                    }, timeout);




                this.pendingResponses.set(
                    requestId,

                    (response) => {

                        clearTimeout(timer);

                        resolve(response);

                    }

                );

                this.socket.send(
                    JSON.stringify({

                        type: "command",

                        action,

                        payload,

                        request_id:
                            requestId,


                        session_id:
                            this.sessionId,


                        timestamp:
                            Date.now(),


                        source:
                            "WebUI"


                    })
                );


            }
        );

    }

    _scheduleSessionRefresh(expiresIn) {
        clearTimeout(this._sessionRefreshTimer);
        this._sessionRefreshTimer = null;

        const ttlMs = Number(expiresIn) * 1000;
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            this.sessionExpiresAt = 0;
            return;
        }

        this.sessionExpiresAt = Date.now() + ttlMs;
        const delay = Math.max(1000, ttlMs - this._sessionRefreshLeadTime);
        this._sessionRefreshTimer = setTimeout(() => this._refreshSession(), delay);
    }

    async _refreshSession() {
        if (!this.connected || !this.authenticated) return;

        try {
            const response = await this.sendWithResponse("refresh_session", {}, 10000);
            if (!response.ok) {
                throw new Error(response.error || "Session renewal was rejected");
            }

            this._scheduleSessionRefresh(response.result?.expires_in);
            if (!this.sessionExpiresAt) {
                throw new Error("Server returned an invalid session lifetime");
            }
            console.log("[WebSocket] Session renewed");
        } catch (error) {
            console.warn("[WebSocket] Session renewal failed:", error);
            const remainingMs = this.sessionExpiresAt - Date.now();
            if (this.connected && this.authenticated && remainingMs > 1000) {
                const retryDelay = Math.min(30000, remainingMs - 1000);
                this._sessionRefreshTimer = setTimeout(() => this._refreshSession(), retryDelay);
            }
        }
    }

    login(username, password, timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket) {
                reject(new Error("WebSocket disconnected"));
                return;
            }
            if (this.authenticated) {
                resolve({ ok: true, session_id: this.sessionId });
                return;
            }
            if (this.authPending) {
                reject(new Error("Login already in progress"));
                return;
            }

            this.authPending = true;
            this._loginResolve = (response) => {
                this._loginResolve = null;
                this._loginReject = null;
                resolve(response);
            };
            this._loginReject = (error) => {
                this._loginResolve = null;
                this._loginReject = null;
                reject(error);
            };

            const timer = setTimeout(() => {
                if (!this.authPending) return;
                this.authPending = false;
                this._loginResolve = null;
                this._loginReject = null;
                reject(new Error("Login timeout"));
            }, timeout);

            const resolveLogin = this._loginResolve;
            const rejectLogin = this._loginReject;
            this._loginResolve = (response) => {
                clearTimeout(timer);
                resolveLogin(response);
            };
            this._loginReject = (error) => {
                clearTimeout(timer);
                rejectLogin(error);
            };

            this.socket.send(JSON.stringify({
                type: "login",
                username,
                password,
            }));
        });
    }







    onStateUpdate(callback) {

        this.stateListeners.push(
            callback
        );

    }

    removeStateUpdate(callback) {

        this.stateListeners =
            this.stateListeners.filter((listener) => listener !== callback);

    }

    onOverlayEvent(callback) {
        this.overlayListeners.push(callback);
    }

    removeOverlayEvent(callback) {
        this.overlayListeners = this.overlayListeners.filter((listener) => listener !== callback);
    }





    onLog(callback) {

        this.logListeners.push(
            callback
        );

    }




    emitLog(message, level) {

        this.logListeners.forEach(
            callback => {

                callback(
                    message,
                    level
                );

            }
        );

    }

    disconnect() {
        this.stopping = true;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        clearTimeout(this._connectionHealthTimer);
        this._connectionHealthTimer = null;
        clearTimeout(this._sessionRefreshTimer);
        this._sessionRefreshTimer = null;

        const socket = this.socket;
        this.socket = null;
        if (socket) socket.close();
        this.connected = false;
        this.authenticated = false;
        this.authPending = false;
        this.sessionId = null;
        this.sessionExpiresAt = 0;
        this._handshakeSuccessful = false;
        this._triedFallback = false;
        if (this._loginReject) {
            this._loginReject(new Error("WebSocket disconnected"));
        }
        this.emitConnectionStateChange();

    }


}