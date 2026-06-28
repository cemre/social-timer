let timerContainer, sessionTimerDisplay, dailyTimerDisplay, visitsDisplay;
let lastUpdateTime = Date.now();
let port = null;

function createTimerUI() {
  // Clean up any existing timer
  const existingTimer = document.querySelector('.social-timer');
  if (existingTimer) {
    existingTimer.remove();
  }

  // Add Google Font
  document.head.appendChild(Object.assign(document.createElement('link'), {
    href: 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&display=swap',
    rel: 'stylesheet'
  }));

  // Add styles
  const existingStyle = document.querySelector('#social-timer-styles');
  if (existingStyle) {
    existingStyle.remove();
  }

  const styles = Object.assign(document.createElement('style'), {
    id: 'social-timer-styles',
    textContent: `
      .social-timer__visits {
        font-size: 12px;
        opacity: 0.8;
        line-height: 1;
        margin-top: 4px;
      }

      .social-timer {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 15px;
        border-radius: 8px;
        font-family: 'Roboto Mono', monospace;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        transform-origin: top right;
        transition: transform 2s ease-in-out;
        pointer-events: none;
        visibility: hidden;
      }
      .social-timer.is-visible {
        visibility: visible;
      }
      .social-timer__session {
        font-size: 24px;
        font-weight: bold;
        line-height: 1;
      }
      .social-timer__daily {
        font-size: 12px;
        opacity: 0.8;
        line-height: 1;
      }
      .social-timer--error {
        background: rgba(255, 0, 0, 0.8);
      }
    `
  });
  document.head.appendChild(styles);

  // Create timer elements
  timerContainer = Object.assign(document.createElement('div'), { className: 'social-timer' });
  sessionTimerDisplay = Object.assign(document.createElement('div'), { className: 'social-timer__session' });
  dailyTimerDisplay = Object.assign(document.createElement('div'), { className: 'social-timer__daily' });
  visitsDisplay = Object.assign(document.createElement('div'), { className: 'social-timer__visits' });
  
  timerContainer.append(sessionTimerDisplay, dailyTimerDisplay, visitsDisplay);
  document.body.appendChild(timerContainer);
}

function formatTime(seconds) {
  const hrs = Math.floor(Math.max(0, seconds) / 3600);
  const mins = Math.floor((Math.max(0, seconds) % 3600) / 60);
  const secs = Math.floor(Math.max(0, seconds) % 60);
  
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateDisplays(sessionSeconds, dailySeconds, visits) {
  if (!sessionTimerDisplay || isNaN(sessionSeconds) || isNaN(dailySeconds)) return;
  
  // Check if updates have stopped
  if (Date.now() - lastUpdateTime > 5000) {
    timerContainer.classList.add('social-timer--error');
    refreshConnection();
  } else {
    timerContainer.classList.remove('social-timer--error');
  }
  
  lastUpdateTime = Date.now();
  
  const scale = Math.min(1 + (2 * sessionSeconds / 1800), 3);
  timerContainer.style.transform = `scale(${scale})`;
  
  sessionTimerDisplay.textContent = formatTime(sessionSeconds);
  dailyTimerDisplay.textContent = `Today: ${formatTime(dailySeconds)}`;
  visitsDisplay.textContent = `Visits: ${visits}`;
  timerContainer.classList.add('is-visible');
}

function isPageActive() {
  return !document.hidden && document.hasFocus();
}

function refreshConnection() {
  if (port) {
    port.disconnect();
  }
  
  setupConnection();
  updatePageState();
}

// Establish connection with background script
function setupConnection() {
  try {
    port = chrome.runtime.connect();
    
    port.onMessage.addListener(msg => {
      if (msg.type === 'UPDATE_TIMERS' || msg.type === 'INITIAL_STATE') {
        updateDisplays(msg.sessionTime, msg.dailyTime, msg.dailyVisits);
      }
    });
    
    port.onDisconnect.addListener(() => {
      console.warn('Port disconnected, attempting to reconnect');
      setTimeout(refreshConnection, 1000);
    });
  } catch (e) {
    console.error('Failed to establish connection:', e);
    setTimeout(refreshConnection, 1000);
  }
}

function updatePageState() {
  if (!port) return;
  
  try {
    port.postMessage({
      type: isPageActive() ? 'TAB_ACTIVE' : 'TAB_INACTIVE'
    });
  } catch (e) {
    console.warn('Failed to update page state, attempting refresh');
    refreshConnection();
  }
}

// Check connection periodically
setInterval(() => {
  if (Date.now() - lastUpdateTime > 10000) {
    refreshConnection();
  }
}, 5000);

// Initialize
try {
  createTimerUI();
  setupConnection();
  
  // Notify background script about new tab
  port.postMessage({
    type: 'NEW_TAB',
    tabId: window.crypto.randomUUID()  // Generate unique ID for this tab
  });

  ['visibilitychange', 'focus', 'blur'].forEach(event => 
    window.addEventListener(event, updatePageState)
  );

  // Initial state check
  updatePageState();

} catch (e) {
  console.error('Failed to initialize timer:', e);
  setTimeout(() => window.location.reload(), 1000);
}