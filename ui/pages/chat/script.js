window.pageControllers = window.pageControllers || {};

window.pageControllers.chat = function () {
  const stage = document.getElementById('chat-monitor-stage');
  const empty = document.getElementById('chat-layout-empty');
  const pipToggle = document.getElementById('chat-pip-toggle');
  const pipLabel = document.getElementById('chat-pip-label');
  const pipSize = document.getElementById('chat-pip-size');
  const layoutStatus = document.getElementById('chat-layout-status');
  const connectionState = document.getElementById('chat-connection-state');
  const openButton = document.getElementById('chat-open-window');
  const hideButton = document.getElementById('chat-pip-hide');
  const api = window.electronAPI;
  if (!stage) return;

  let displays = [];
  let bounds = null;
  let pipEnabled = false;
  let map = null;
  let pendingFrame = 0;
  let drag = null;

  function setStatus(message) {
    layoutStatus.textContent = message;
  }

  function updateConnectionStatus() {
    const state = window.connection?.getConnectionState?.();
    const connected = state?.connected === true;
    connectionState.dataset.state = connected ? 'connected' : state?.status === 'disconnected' ? 'disconnected' : 'waiting';
    connectionState.textContent = connected ? 'Bot connected' : (state?.label || 'Waiting for bot');
  }

  function makeDefaultBounds(display) {
    const area = display?.workArea || display?.bounds;
    if (!area) return { x: 80, y: 80, width: 380, height: 620 };
    const width = Math.min(380, Math.max(240, area.width - 32));
    const height = Math.min(620, Math.max(280, area.height - 32));
    return { x: area.x + area.width - width - 24, y: area.y + 24, width, height };
  }

  function updateSizeLabel() {
    if (bounds) pipSize.textContent = `${Math.round(bounds.width)} × ${Math.round(bounds.height)} px`;
  }

  function updateRectangle() {
    const rectangle = stage.querySelector('.chat-pip-rectangle');
    if (!rectangle || !map || !bounds) return;
    rectangle.style.left = `${map.left + (bounds.x - map.desktop.x) * map.scale}px`;
    rectangle.style.top = `${map.top + (bounds.y - map.desktop.y) * map.scale}px`;
    rectangle.style.width = `${Math.max(54, bounds.width * map.scale)}px`;
    rectangle.style.height = `${Math.max(58, bounds.height * map.scale)}px`;
  }

  function renderStage() {
    if (!displays.length) {
      empty.hidden = false;
      stage.querySelectorAll('.chat-monitor, .chat-pip-rectangle').forEach((node) => node.remove());
      map = null;
      return;
    }

    empty.hidden = true;
    const stageRect = stage.getBoundingClientRect();
    const padding = 22;
    const xs = displays.map((display) => display.bounds.x);
    const ys = displays.map((display) => display.bounds.y);
    const right = displays.map((display) => display.bounds.x + display.bounds.width);
    const bottom = displays.map((display) => display.bounds.y + display.bounds.height);
    const desktop = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...right) - Math.min(...xs),
      height: Math.max(...bottom) - Math.min(...ys),
    };
    const scale = Math.max(0.03, Math.min(
      (stageRect.width - padding * 2) / desktop.width,
      (stageRect.height - padding * 2) / desktop.height
    ));
    const drawnWidth = desktop.width * scale;
    const drawnHeight = desktop.height * scale;
    map = {
      desktop,
      scale,
      left: (stageRect.width - drawnWidth) / 2,
      top: (stageRect.height - drawnHeight) / 2,
    };

    stage.querySelectorAll('.chat-monitor, .chat-pip-rectangle').forEach((node) => node.remove());
    displays.forEach((display, index) => {
      const monitor = document.createElement('div');
      monitor.className = 'chat-monitor';
      monitor.dataset.primary = String(display.primary === true);
      monitor.style.left = `${map.left + (display.bounds.x - desktop.x) * scale}px`;
      monitor.style.top = `${map.top + (display.bounds.y - desktop.y) * scale}px`;
      monitor.style.width = `${display.bounds.width * scale}px`;
      monitor.style.height = `${display.bounds.height * scale}px`;

      const label = document.createElement('span');
      label.className = 'chat-monitor__label';
      label.textContent = `Display ${index + 1} · ${display.bounds.width} × ${display.bounds.height}`;
      monitor.appendChild(label);
      stage.appendChild(monitor);
    });

    if (bounds) {
      const rectangle = document.createElement('div');
      rectangle.className = 'chat-pip-rectangle';
      rectangle.dataset.enabled = String(pipEnabled);
      rectangle.setAttribute('role', 'slider');
      rectangle.setAttribute('aria-label', 'Drag to move the chat PiP window; use the corner handle to resize');
      rectangle.style.left = `${map.left + (bounds.x - desktop.x) * scale}px`;
      rectangle.style.top = `${map.top + (bounds.y - desktop.y) * scale}px`;
      rectangle.style.width = `${Math.max(54, bounds.width * scale)}px`;
      rectangle.style.height = `${Math.max(58, bounds.height * scale)}px`;

      const caption = document.createElement('span');
      caption.className = 'chat-pip-rectangle__caption';
      caption.textContent = 'MIZUBOT CHAT';
      const handle = document.createElement('span');
      handle.className = 'chat-pip-rectangle__handle';
      handle.setAttribute('aria-hidden', 'true');
      rectangle.append(caption, handle);
      rectangle.addEventListener('pointerdown', startDrag);
      stage.appendChild(rectangle);
    }
  }

  function applyBounds(persist = false) {
    if (!bounds || typeof api?.setChatPipBounds !== 'function') return;
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(async () => {
      pendingFrame = 0;
      try {
        const result = await api.setChatPipBounds(bounds, persist);
        if (persist && result?.bounds) {
          bounds = result.bounds;
          renderStage();
          updateSizeLabel();
        }
      } catch (error) {
        console.warn('[Chat] Could not apply PiP placement:', error);
        setStatus('Could not apply placement.');
      }
    });
  }

  function startDrag(event) {
    if (!map || !bounds || event.button !== 0) return;
    event.preventDefault();
    const resizing = event.target.classList.contains('chat-pip-rectangle__handle');
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: { ...bounds },
      resizing,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.addEventListener('pointermove', moveDrag);
    event.currentTarget.addEventListener('pointerup', endDrag, { once: true });
    event.currentTarget.addEventListener('pointercancel', endDrag, { once: true });
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId || !map) return;
    const dx = (event.clientX - drag.startX) / map.scale;
    const dy = (event.clientY - drag.startY) / map.scale;
    if (drag.resizing) {
      bounds.width = Math.max(180, Math.min(1200, drag.startBounds.width + dx));
      bounds.height = Math.max(180, Math.min(1200, drag.startBounds.height + dy));
    } else {
      bounds.x = Math.max(map.desktop.x, Math.min(
        drag.startBounds.x + dx,
        map.desktop.x + map.desktop.width - bounds.width
      ));
      bounds.y = Math.max(map.desktop.y, Math.min(
        drag.startBounds.y + dy,
        map.desktop.y + map.desktop.height - bounds.height
      ));
    }
    updateSizeLabel();
    updateRectangle();
    applyBounds(false);
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    applyBounds(true);
  }

  async function refresh() {
    if (!api?.getChatWindowState || !api?.getDisplays) {
      pipToggle.disabled = true;
      openButton.disabled = true;
      hideButton.disabled = true;
      setStatus('Desktop window controls are available in the Electron app.');
      return;
    }

    try {
      const [state, nextDisplays] = await Promise.all([api.getChatWindowState(), api.getDisplays()]);
      displays = Array.isArray(nextDisplays) ? nextDisplays : [];
      pipEnabled = state?.pipEnabled === true;
      bounds = state?.bounds || makeDefaultBounds(displays.find((display) => display.primary) || displays[0]);
      pipToggle.checked = pipEnabled;
      pipLabel.textContent = pipEnabled ? 'On' : 'Off';
      hideButton.disabled = !pipEnabled;
      setStatus(displays.length ? `${displays.length} display${displays.length === 1 ? '' : 's'} · drag to position` : 'No displays detected.');
      updateSizeLabel();
      renderStage();
    } catch (error) {
      console.error('[Chat] Unable to load display layout:', error);
      setStatus('Could not load display layout.');
    }
  }

  pipToggle.addEventListener('change', async () => {
    pipToggle.disabled = true;
    try {
      const state = await api.setChatPipEnabled(pipToggle.checked, bounds);
      pipEnabled = state?.pipEnabled === true;
      pipToggle.checked = pipEnabled;
      pipLabel.textContent = pipEnabled ? 'On' : 'Off';
      hideButton.disabled = !pipEnabled;
      setStatus(pipEnabled ? 'PiP is on top and click-through.' : 'PiP is off.');
      renderStage();
    } catch (error) {
      pipToggle.checked = pipEnabled;
      setStatus(`PiP could not be changed: ${error.message || error}`);
    } finally {
      pipToggle.disabled = false;
    }
  });

  openButton.addEventListener('click', async () => {
    openButton.disabled = true;
    try {
      await api.openPersistentChat();
    } catch (error) {
      setStatus(`Chat window could not be opened: ${error.message || error}`);
    } finally {
      openButton.disabled = false;
    }
  });

  hideButton.addEventListener('click', async () => {
    pipToggle.checked = false;
    pipToggle.dispatchEvent(new Event('change'));
  });

  if (typeof api?.onDisplayLayoutChanged === 'function') {
    window.pageControllers.__chatDisplayUnsubscribe?.();
    window.pageControllers.__chatDisplayUnsubscribe = api.onDisplayLayoutChanged(refresh);
  }
  if (typeof window.pageControllers.__chatConnectionUnsubscribe === 'function') {
    window.pageControllers.__chatConnectionUnsubscribe();
  }
  window.pageControllers.__chatConnectionUnsubscribe = window.connection?.subscribeToConnectionState?.(updateConnectionStatus) || (() => {});
  if (window.pageControllers.__chatActivateHandler) {
    document.removeEventListener('page:activate', window.pageControllers.__chatActivateHandler);
  }
  const handleChatPageActivate = (event) => {
    if (event.detail?.pageId === 'chat') refresh();
  };
  document.addEventListener('page:activate', handleChatPageActivate);
  window.pageControllers.__chatActivateHandler = handleChatPageActivate;
  if (window.pageControllers.__chatResizeHandler) {
    window.removeEventListener('resize', window.pageControllers.__chatResizeHandler);
  }
  window.addEventListener('resize', renderStage);
  window.pageControllers.__chatResizeHandler = renderStage;
  updateConnectionStatus();
  refresh();
};

window.pageControllers.chat();
