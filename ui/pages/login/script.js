window.pageControllers = window.pageControllers || {};

window.pageControllers.login = function () {
  const form = document.getElementById('login-form');
  const statusDiv = document.getElementById('connection-status');
  const submitButton = document.getElementById('login-submit');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const rememberControls = document.getElementById('remember-login-controls');
  const rememberPassword = document.getElementById('remember-password');
  const forgetRememberedLogin = document.getElementById('forget-remembered-login');
  const errorPanel = document.getElementById('login-error');
  const errorMessage = errorPanel?.querySelector('.login-error__message');

  if (!form) return;

  const credentialStore = window.electronAPI;
  const canRememberPassword =
    typeof credentialStore?.getRememberedLogin === 'function' &&
    typeof credentialStore?.saveRememberedLogin === 'function' &&
    typeof credentialStore?.clearRememberedLogin === 'function';

  if (rememberControls) {
    rememberControls.hidden = !canRememberPassword;
  }

  const showError = (message) => {
    if (!errorPanel || !errorMessage) return;
    errorMessage.textContent = message;
    errorPanel.hidden = false;
    errorPanel.classList.remove('login-error--shake');
    void errorPanel.offsetWidth;
    errorPanel.classList.add('login-error--shake');
  };

  const clearError = () => {
    if (!errorPanel || !errorMessage) return;
    errorMessage.textContent = '';
    errorPanel.hidden = true;
    errorPanel.classList.remove('login-error--shake');
  };

  const updateStatus = () => {
    const connectionState = window.connection?.getConnectionState?.() || {
      status: 'disconnected',
      label: 'Disconnected',
    };

    if (!statusDiv) return;

    const className = connectionState.status === 'offline'
      ? 'status-pill status-pill--offline'
      : connectionState.status === 'primary'
        ? 'status-pill status-pill--primary'
        : 'status-pill status-pill--disconnected';

    statusDiv.className = className;
    statusDiv.querySelector('.status-pill__label').textContent = connectionState.label || 'Disconnected';
  };

  if (statusDiv && window.connection) {
    updateStatus();
    window.addEventListener('connection:state', updateStatus);
  }

  if (canRememberPassword) {
    credentialStore.getRememberedLogin()
      .then((credentials) => {
        if (!credentials) return;
        if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string') {
          throw new Error('Saved login data has an invalid format.');
        }
        usernameInput.value = credentials.username;
        passwordInput.value = credentials.password;
        if (forgetRememberedLogin) forgetRememberedLogin.hidden = false;
      })
      .catch((error) => {
        console.error('Unable to load saved login securely:', error);
        if (forgetRememberedLogin) forgetRememberedLogin.hidden = false;
        showError('Unable to access the saved login securely. You can still sign in manually.');
      });
  }

  forgetRememberedLogin?.addEventListener('click', async () => {
    try {
      await credentialStore.clearRememberedLogin();
      usernameInput.value = '';
      passwordInput.value = '';
      rememberPassword.checked = false;
      forgetRememberedLogin.hidden = true;
      clearError();
    } catch (error) {
      console.error('Unable to forget saved login:', error);
      showError('Unable to remove the saved login. Please try again.');
    }
  });

  document.querySelectorAll('.window-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      if (action === 'minimize' && window.electronAPI?.minimizeWindow) {
        window.electronAPI.minimizeWindow();
      } else if (action === 'toggle-fullscreen') {
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        } catch (error) {
          console.warn('Fullscreen toggle failed', error);
        }
      } else if (action === 'close' && window.electronAPI?.closeWindow) {
        window.electronAPI.closeWindow();
      }
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const username = usernameInput?.value || '';
    const password = passwordInput?.value || '';

    clearError();
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Signing in...';
    }

    // Login is the first packet on the existing WebSocket connection.
    if (window.connection && window.connection.isConnected()) {
      const bridge = window.connection.getBridge();
      try {
        const response = await bridge.login(username, password);
        let navigateToDashboard = true;
        if (response?.ok && rememberPassword?.checked && canRememberPassword) {
          try {
            await credentialStore.saveRememberedLogin({ username, password });
            if (forgetRememberedLogin) forgetRememberedLogin.hidden = false;
          } catch (error) {
            console.error('Unable to save login securely:', error);
            showError('Signed in, but the password could not be saved securely. Uncheck Remember password and sign in again to continue.');
            navigateToDashboard = false;
          }
        }
        if (navigateToDashboard) {
          window.app.navigateToDashboard();
        }
      } catch (error) {
        console.error('Login failed:', error);
        showError(error.message || 'Incorrect username or password.');
      }
    } else {
      console.warn('Not connected to server');
      showError('The bot is not connected. Check the connection and try again.');
    }

    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Login';
    }
  });
};

window.pageControllers.login();
