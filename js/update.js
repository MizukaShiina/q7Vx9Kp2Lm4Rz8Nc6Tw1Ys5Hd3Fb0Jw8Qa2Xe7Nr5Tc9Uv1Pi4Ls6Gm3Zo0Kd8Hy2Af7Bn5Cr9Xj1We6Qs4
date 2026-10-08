function createUpdateStatus() {
  if (!window.electronAPI?.onUpdateStatus) return;

  const statusElement = document.createElement('div');
  statusElement.className = 'update-gate';
  statusElement.setAttribute('role', 'alertdialog');
  statusElement.setAttribute('aria-modal', 'true');
  statusElement.setAttribute('aria-labelledby', 'update-gate-title');
  statusElement.setAttribute('aria-describedby', 'update-gate-message');
  statusElement.tabIndex = -1;
  statusElement.hidden = true;

  const card = document.createElement('section');
  card.className = 'update-gate__card';

  const title = document.createElement('h1');
  title.id = 'update-gate-title';
  title.className = 'update-gate__title';
  title.textContent = 'Update required';

  const message = document.createElement('p');
  message.id = 'update-gate-message';
  message.className = 'update-gate__message';

  const progress = document.createElement('progress');
  progress.className = 'update-gate__progress';
  progress.max = 100;
  progress.removeAttribute('value');
  progress.setAttribute('aria-label', 'Update download progress');

  const retryButton = document.createElement('button');
  retryButton.className = 'update-gate__retry';
  retryButton.type = 'button';
  retryButton.textContent = 'Retry update';
  retryButton.hidden = true;
  retryButton.addEventListener('click', () => {
    retryButton.disabled = true;
    message.textContent = 'Checking for updates…';
    progress.hidden = true;
    window.electronAPI.retryUpdate()
      .catch((error) => {
        console.error('Unable to retry WebUI update:', error);
        showError();
      })
      .finally(() => {
        retryButton.disabled = false;
      });
  });

  card.append(title, message, progress, retryButton);
  statusElement.appendChild(card);
  document.body.appendChild(statusElement);

  const appRoot = document.getElementById('app');
  let updateRequired = false;
  let latestRevision = 0;

  function show() {
    statusElement.hidden = false;
    if (appRoot) appRoot.inert = true;
    statusElement.focus();
  }

  function hide() {
    statusElement.hidden = true;
    if (appRoot) appRoot.inert = false;
  }

  function showError() {
    message.textContent = 'The update could not be downloaded. Retry to check again.';
    progress.hidden = true;
    retryButton.hidden = false;
    show();
  }

  function handleUpdateStatus(status) {
    if (!status) return;
    if (status.revision && status.revision <= latestRevision) return;
    if (status.revision) latestRevision = status.revision;

    if (status.state === 'not-available') {
      updateRequired = false;
      hide();
      return;
    }

    switch (status.state) {
      case 'checking':
        if (!updateRequired) return;
        message.textContent = 'Checking for updates…';
        progress.hidden = true;
        retryButton.hidden = true;
        show();
        break;
      case 'available':
        updateRequired = true;
        message.textContent = `Version ${status.version} is available. Downloading the update before you can continue…`;
        progress.hidden = false;
        progress.removeAttribute('value');
        retryButton.hidden = true;
        show();
        break;
      case 'downloading':
        updateRequired = true;
        const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
        message.textContent = `Downloading update… ${Math.round(percent)}%`;
        progress.hidden = false;
        progress.value = percent;
        retryButton.hidden = true;
        show();
        break;
      case 'downloaded':
        updateRequired = true;
        message.textContent = `Version ${status.version} downloaded. Restarting to install…`;
        progress.hidden = false;
        progress.value = 100;
        retryButton.hidden = true;
        show();
        break;
      case 'error':
        if (updateRequired) showError();
        break;
    }
  }

  window.electronAPI.onUpdateStatus(handleUpdateStatus);
  window.electronAPI.getUpdateStatus()
    .then(handleUpdateStatus)
    .catch((error) => console.error('Unable to load WebUI update status:', error));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createUpdateStatus, { once: true });
} else {
  createUpdateStatus();
}