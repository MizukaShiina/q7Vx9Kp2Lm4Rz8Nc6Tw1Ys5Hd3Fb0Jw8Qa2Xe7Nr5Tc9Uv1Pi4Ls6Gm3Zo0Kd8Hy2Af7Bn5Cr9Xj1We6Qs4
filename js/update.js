function createUpdateStatus() {
  if (!window.electronAPI?.onUpdateStatus) return;

  const statusElement = document.createElement('div');
  statusElement.className = 'update-status';
  statusElement.setAttribute('role', 'status');
  statusElement.setAttribute('aria-live', 'polite');
  statusElement.hidden = true;
  document.body.appendChild(statusElement);

  window.electronAPI.onUpdateStatus((status) => {
    if (!status || status.state === 'not-available' || status.state === 'error') {
      statusElement.hidden = true;
      return;
    }

    const version = status.version ? ` ${status.version}` : '';
    switch (status.state) {
      case 'checking':
        statusElement.textContent = 'Checking for updates…';
        break;
      case 'available':
        statusElement.textContent = `Update${version} found. Downloading…`;
        break;
      case 'downloading':
        statusElement.textContent = `Downloading update… ${Math.round(status.percent || 0)}%`;
        break;
      case 'downloaded':
        statusElement.textContent = `Update${version} downloaded. Restarting to install…`;
        break;
      default:
        statusElement.hidden = true;
        return;
    }

    statusElement.hidden = false;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createUpdateStatus, { once: true });
} else {
  createUpdateStatus();
}