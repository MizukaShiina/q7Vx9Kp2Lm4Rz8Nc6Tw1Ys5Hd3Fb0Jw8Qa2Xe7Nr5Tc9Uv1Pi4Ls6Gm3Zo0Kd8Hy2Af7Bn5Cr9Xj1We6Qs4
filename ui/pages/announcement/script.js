window.pageControllers = window.pageControllers || {};

window.pageControllers.announcement = function () {
  console.log('Announcement page loaded');
  
  // DOM Elements
  const twitterGreeting = document.getElementById('twitter-greeting');
  const discordGreeting = document.getElementById('discord-greeting');
  const streamTitle = document.getElementById('stream-title');
  const message = document.getElementById('announcement-message');
  const includeLink = document.getElementById('include-link');
  const announceTwitter = document.getElementById('announce-twitter');
  const announceDiscord = document.getElementById('announce-discord');
  const previewBtn = document.getElementById('preview-btn');
  const sendBtn = document.getElementById('send-announcement-btn');
  
  let toastTimeout = null;
  
  // Helper: Get stream link
  function getStreamLink() {
    const channel = window.state?.twitch?.channel || '';
    if (!channel) return 'https://www.twitch.tv';
    return `https://www.twitch.tv/${channel}`;
  }
  
  // Helper: Build Twitter message
  function buildTwitterMessage() {
    const parts = [];
    
    const greeting = twitterGreeting?.value?.trim();
    if (greeting) parts.push(greeting);
    
    const title = streamTitle?.value?.trim();
    if (title) parts.push(title);
    
    const body = message?.value?.trim();
    if (body) parts.push(body);
    
    if (includeLink?.checked) {
      parts.push(getStreamLink());
    }
    
    return parts.join('\n\n');
  }
  
  // Helper: Build Discord message
  function buildDiscordMessage() {
    const parts = [];
    
    const greeting = discordGreeting?.value?.trim();
    if (greeting) parts.push(greeting);
    
    const title = streamTitle?.value?.trim();
    if (title) parts.push(title);
    
    const body = message?.value?.trim();
    if (body) parts.push(body);
    
    if (includeLink?.checked) {
      parts.push(getStreamLink());
    }
    
    return parts.join('\n\n');
  }
  
  // Helper: Show toast notification
  async function showToast(message, tone = 'info', timeout = 2200) {
    let toast = document.getElementById('announcement-toast');
    
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'announcement-toast';
      document.body.appendChild(toast);
    } else if (toast.classList.contains('is-visible')) {
      toast.classList.remove('is-visible');
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    toast.className = `announcement-toast announcement-toast--${tone}`;
    toast.classList.remove('is-visible');
    
    const toneMap = {
      info: { icon: 'ℹ', title: 'Information' },
      success: { icon: '✓', title: 'Success' },
      warning: { icon: '⚠', title: 'Warning' },
      error: { icon: '✕', title: 'Error' }
    };
    
    const current = toneMap[tone] || toneMap.info;
    
    toast.innerHTML = `
      <div class="announcement-toast__content">
        <div class="announcement-toast__icon">${current.icon}</div>
        <div class="announcement-toast__body">
          <h4 class="announcement-toast__title">${current.title}</h4>
          <p class="announcement-toast__message">${message}</p>
        </div>
      </div>
    `;
    
    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });
    
    clearTimeout(toastTimeout);
    if (timeout > 0) {
      toastTimeout = setTimeout(() => {
        toast.classList.remove('is-visible');
      }, timeout);
    }
  }
  
  // Helper: Send command to server
  async function sendToServer(action, payload) {
    if (!window.connection || !window.connection.isConnected()) {
      showToast('Not connected to server.', 'warning', 3000);
      return false;
    }
    
    const bridge = window.connection.getBridge();
    const response = await bridge.sendWithResponse(action, payload);
    
    if (response.ok) {
      return true;
    } else {
      showToast(`Failed: ${response.error}`, 'warning', 3000);
      return false;
    }
  }
  
  // Preview button - show preview modal
  previewBtn.addEventListener('click', () => {
    const twitterMsg = buildTwitterMessage();
    const discordMsg = buildDiscordMessage();
    
    // Populate preview content
    const previewTwitter = document.getElementById('preview-twitter');
    const previewDiscord = document.getElementById('preview-discord');
    
    if (previewTwitter) {
      previewTwitter.textContent = twitterMsg || '(empty)';
    }
    if (previewDiscord) {
      previewDiscord.textContent = discordMsg || '(empty)';
    }
    
    // Show preview modal
    showPreviewModal();
  });
  
  // Send Announcement button
  sendBtn.addEventListener('click', async () => {
    const sendToTwitter = announceTwitter?.checked;
    const sendToDiscord = announceDiscord?.checked;
    
    if (!sendToTwitter && !sendToDiscord) {
      showModal();
      return;
    }
    
    const twitterMessage = buildTwitterMessage();
    const discordMessage = buildDiscordMessage();
    
    // Send to Twitter (client-side - open browser)
    if (sendToTwitter && twitterMessage) {
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterMessage)}`;
      window.open(twitterUrl, '_blank');
      showToast('Opening Twitter...', 'info', 2000);
    }
    
    // Send to Discord (server-side)
    if (sendToDiscord && discordMessage) {
      const success = await sendToServer('send_discord_announcement', {
        message: discordMessage
      });
      
      if (success) {
        showToast('Discord announcement sent!', 'success', 3000);
      }
    }
  });
  
  // Update stream title from server state
  function updateFromServerState() {

  // console.log("Announcement state:", window.state);
  // console.log("Stream title:", window.state?.stream?.title);

    if (!window.state || !streamTitle) return;
    
    // Always update from state (even if empty) unless user is typing
    if (document.activeElement !== streamTitle) {
      streamTitle.value = window.state.stream?.title || '';
    }
  }
  
  // Subscribe to state changes
  if (window.state) {
    window.state.subscribe(() => {
      updateFromServerState();
    });
  }
  
  // Initial update
  updateFromServerState();
};

// Modal functions
function showModal() {
  const modal = document.getElementById('announcement-modal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function hideModal() {
  const modal = document.getElementById('announcement-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Modal close button (confirmation modal)
const modalCloseBtn = document.getElementById('announcement-modal-close');
if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', hideModal);
}

// Close modal on overlay click (confirmation modal)
const modalOverlay = document.getElementById('announcement-modal');
if (modalOverlay) {
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      hideModal();
    }
  });
}

// Preview modal functions
function showPreviewModal() {
  const modal = document.getElementById('preview-modal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function hidePreviewModal() {
  const modal = document.getElementById('preview-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Preview modal close button
const previewModalCloseBtn = document.getElementById('preview-modal-close');
if (previewModalCloseBtn) {
  previewModalCloseBtn.addEventListener('click', hidePreviewModal);
}

// Close preview modal on overlay click
const previewModalOverlay = document.getElementById('preview-modal');
if (previewModalOverlay) {
  previewModalOverlay.addEventListener('click', (e) => {
    if (e.target === previewModalOverlay) {
      hidePreviewModal();
    }
  });
}

// Initialize the page controller
window.pageControllers.announcement();
