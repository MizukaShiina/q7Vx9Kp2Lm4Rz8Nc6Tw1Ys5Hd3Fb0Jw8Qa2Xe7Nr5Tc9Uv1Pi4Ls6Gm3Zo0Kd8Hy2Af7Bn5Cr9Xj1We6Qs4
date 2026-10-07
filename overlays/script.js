// c:/Users/Mizuka/Downloads/MizuBot/Twitch/Winners/TwitchBot/HTML/script.js

class OverlayWebSocketClient {
    constructor(wsUrl, statusElementId, overlayName) {
        const relayUrl = new URL(wsUrl);
        relayUrl.searchParams.set('source', window.location.pathname);
        this.wsUrl = relayUrl.toString();
        this.statusElement = document.getElementById(statusElementId);
        this.overlayName = overlayName || "OVERLAY"; // Default name if not provided
        this.ws = null;
        this.reconnectTimeout = null;
        this.eventHandlers = {}; // Map eventType to handler function
    }

    setDisconnected() {
        if (this.statusElement) {
            this.statusElement.classList.add('show');
            this.statusElement.innerText = `${this.overlayName.toUpperCase()} OVERLAY: NOT CONNECTED`;
        }
    }

    setConnected() {
        if (this.statusElement) {
            this.statusElement.classList.remove('show');
        }
    }

    connect() {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
            this.setConnected();
            clearTimeout(this.reconnectTimeout);
            console.log(`WebSocket connected for ${this.overlayName} to ${this.wsUrl}`);
        };

        this.ws.onclose = () => {
            this.setDisconnected();
            console.log(`WebSocket disconnected for ${this.overlayName} from ${this.wsUrl}. Reconnecting in 5s...`);
            this.reconnectTimeout = setTimeout(() => {
                this.connect();
            }, 5000);
        };

        this.ws.onerror = (error) => {
            console.error(`WebSocket error for ${this.overlayName}:`, error);
            try { this.ws.close(); } catch (e) { /* ignore */ }
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.event && typeof this.eventHandlers[msg.event] === 'function') {
                    this.eventHandlers[msg.event](msg.data);
                } else {
                    console.warn(`[${this.overlayName}] No handler registered for event type: ${msg.event}`);
                }
            } catch (err) {
                console.error(`[${this.overlayName}] Failed to parse websocket message:`, err);
            }
        };
    }

    registerHandler(eventType, handlerFunction) {
        this.eventHandlers[eventType] = handlerFunction;
    }
}