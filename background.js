// background.js
const state = {
  sessionTime: 0,
  dailyTime: 0,
  isRunning: false,
  startTime: null,
  lastActiveTime: null,
  lastResetDate: null,
  updateInterval: null,
  historicalData: {},
  lastHeartbeat: null,
  activePort: null,  // Track the active content script connection
  dailyVisits: 0,    // Track number of visits today
  visitedTabs: new Set(),  // Track unique tabs to avoid counting tab switches
  siteHistory: {},   // date -> host -> { seconds, visits }
  activeHost: null   // host the running timer belongs to
};

// Hosts are stored as-is (minus "www.") so the analytics page can decide how to
// group and label them; regrouping later doesn't need the data rewritten.
function normalizeHost(host) {
  return typeof host === 'string' ? host.toLowerCase().replace(/^www\./, '') : '';
}

function siteBucket(host) {
  const key = normalizeHost(host);
  if (!key || !state.lastResetDate) return null;

  const day = state.siteHistory[state.lastResetDate] || (state.siteHistory[state.lastResetDate] = {});
  return day[key] || (day[key] = { seconds: 0, visits: 0 });
}

function saveState() {
  chrome.storage.local.set({
    sessionTime: state.sessionTime,
    dailyTime: state.dailyTime,
    lastActiveTime: state.lastActiveTime,
    lastResetDate: state.lastResetDate,
    historicalData: state.historicalData,
    dailyVisits: state.dailyVisits,
    siteHistory: state.siteHistory
  });
}

// Everything that records against a day rolls the day over first, so a visit
// or a stretch just after midnight can't land on yesterday's bucket.
async function rollOverIfNewDay() {
  const today = new Date().toLocaleDateString();
  if (state.lastResetDate === today) return;

  await saveDailyTotal();
  state.dailyTime = 0;
  state.dailyVisits = 0;
  state.visitedTabs.clear();
  state.lastResetDate = today;
}

async function saveDailyTotal() {
  if (state.dailyTime > 0) {
    state.historicalData[state.lastResetDate] = state.dailyTime;
    await chrome.storage.local.set({ historicalData: state.historicalData });
  }
}

function updateTimers() {
  if (!state.isRunning) return;
  
  const currentTime = Math.floor((Date.now() - state.startTime) / 1000);
  
  // Check if timer seems stuck
  if (state.lastHeartbeat && Date.now() - state.lastHeartbeat > 5000) {
    console.warn('Timer heartbeat missed, restarting interval');
    clearInterval(state.updateInterval);
    state.updateInterval = setInterval(updateTimers, 1000);
  }
  
  state.lastHeartbeat = Date.now();
  
  // Send update to active content script
  if (state.activePort) {
    try {
      state.activePort.postMessage({
        type: 'UPDATE_TIMERS',
        sessionTime: state.sessionTime + currentTime,
        dailyTime: state.dailyTime + currentTime,
        dailyVisits: state.dailyVisits
      });
    } catch (e) {
      console.warn('Failed to send update, port may be disconnected');
      pauseTimer();
    }
  }
}

async function startTimer(host) {
  // Reset if timer was stuck
  if (state.isRunning && Date.now() - state.lastHeartbeat > 5000) {
    state.isRunning = false;
  }
  
  // Moving to a different site: close out the running stretch first so its
  // seconds land on the site that actually earned them.
  if (state.isRunning && normalizeHost(host) !== state.activeHost) {
    await pauseTimer();
  }
  
  if (state.isRunning) return;
  
  // Reset session if inactive for 15+ minutes
  if (state.lastActiveTime && Date.now() - state.lastActiveTime >= 15 * 60 * 1000) {
    state.sessionTime = 0;
  }
  
  await rollOverIfNewDay();
  
  state.activeHost = normalizeHost(host);
  state.startTime = Date.now();
  state.lastActiveTime = Date.now();
  state.lastHeartbeat = Date.now();
  state.isRunning = true;
  state.updateInterval = setInterval(updateTimers, 1000);
  saveState();
}

async function pauseTimer() {
  if (!state.isRunning) return;
  
  clearInterval(state.updateInterval);
  state.updateInterval = null;
  
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  state.sessionTime += elapsed;
  state.dailyTime += elapsed;
  
  const bucket = siteBucket(state.activeHost);
  if (bucket) bucket.seconds += elapsed;
  
  state.activeHost = null;
  state.isRunning = false;
  state.lastActiveTime = Date.now();
  
  saveState();
}

// Initialize from storage
chrome.storage.local.get(null, async result => {
  state.sessionTime = result.sessionTime || 0;
  state.dailyTime = result.dailyTime || 0;
  state.lastActiveTime = result.lastActiveTime || Date.now();
  state.lastResetDate = result.lastResetDate || new Date().toLocaleDateString();
  state.historicalData = result.historicalData || {};
  state.dailyVisits = result.dailyVisits || 0;
  state.siteHistory = result.siteHistory || {};
  state.visitedTabs.clear();
  
  if (Date.now() - state.lastActiveTime >= 15 * 60 * 1000) {
    state.sessionTime = 0;
  }
  
  await rollOverIfNewDay();
  saveState();
});

// Handle long-lived connections from content scripts
chrome.runtime.onConnect.addListener(port => {
  port.onMessage.addListener(msg => {
    if (msg.type === 'TAB_ACTIVE') {
      state.activePort = port;
      startTimer(msg.host);
    } else if (msg.type === 'TAB_INACTIVE') {
      if (state.activePort === port) {
        state.activePort = null;
        pauseTimer();
      }
    }
  });

  // Clean up when port disconnects
  port.onDisconnect.addListener(() => {
    if (state.activePort === port) {
      state.activePort = null;
      pauseTimer();
    }
  });

  // Check if this is a new tab visit
  port.onMessage.addListener(async msg => {
    if (msg.type === 'NEW_TAB') {
      await rollOverIfNewDay();
      
      const tabId = msg.tabId;
      if (!state.visitedTabs.has(tabId)) {
        state.visitedTabs.add(tabId);
        state.dailyVisits++;
        const bucket = siteBucket(msg.host);
        if (bucket) bucket.visits++;
        saveState();
      }
    }
  });

  // Send initial state
  const currentTime = state.isRunning ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
  port.postMessage({
    type: 'INITIAL_STATE',
    sessionTime: state.sessionTime + currentTime,
    dailyTime: state.dailyTime + currentTime,
    dailyVisits: state.dailyVisits
  });
});

// Toolbar button opens the per-day / per-site breakdown.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('analytics.html') });
});
