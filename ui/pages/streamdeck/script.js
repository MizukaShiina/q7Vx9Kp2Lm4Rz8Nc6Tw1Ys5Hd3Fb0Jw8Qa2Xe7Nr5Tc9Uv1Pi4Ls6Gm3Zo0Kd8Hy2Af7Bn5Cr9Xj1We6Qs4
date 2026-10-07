window.pageControllers = window.pageControllers || {};

window.pageControllers.streamdeck = function () {
  var grid = document.getElementById('streamdeck-grid');
  var status = document.getElementById('streamdeck-status');
  if (!grid || !status) return;

  function sendAction(action, payload) {
    var bridge = window.connection && window.connection.getBridge
      ? window.connection.getBridge()
      : null;

    if (!bridge) {
      status.textContent = 'Unable to send · WebSocket bridge unavailable';
      console.error('[Stream Deck] Cannot send action: WebSocket bridge unavailable');
      return false;
    }

    try {
      var sent = bridge.send(action, payload);
      status.textContent = sent
        ? 'Sent · ' + action
        : 'Unable to send · WebSocket disconnected';
      return sent;
    } catch (error) {
      status.textContent = 'Unable to send · see console for details';
      console.error('[Stream Deck] Action send failed:', error);
      return false;
    }
  }

  grid.querySelectorAll('[data-action-id]').forEach(function (button) {
    button.addEventListener('click', function () {
      sendAction('streamdeck_action', { action_id: button.dataset.actionId });
    });
  });

  window.sendStreamDeckAction = sendAction;
};

window.pageControllers.streamdeck();
