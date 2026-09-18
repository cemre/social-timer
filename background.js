// background.js
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Local calendar date as YYYY-MM-DD so day keys sort chronologically.
function dateKey(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A hostname keyed the way feedgate.js keys one: lowercase, no leading "www.".
function siteKey(hostname) {
  if (typeof hostname !== 'string') return null;
  return hostname.trim().toLowerCase().replace(/^www\./, '') || null;
}

const state = {
  sessionTime: 0,
  dailyTime: 0,
  // The same two clocks, split per site: hostname -> seconds.
  sessionSiteTime: {},
  dailySiteTime: {},
  dailySiteVisits: {},
  activeHost: null,  // site the running clock is currently attributed to
  isRunning: false,
  startTime: null,
  lastActiveTime: null,
  lastResetDate: null,
  updateInterval: null,
  historicalData: {},
  lastHeartbeat: null,
  activePort: null,  // Track the active content script connection
  dailyVisits: 0,    // Track number of visits today
  visitedTabs: new Set()  // Track unique tabs to avoid counting tab switches
};

// historicalData[date] used to be a bare number of seconds. Read both that
// shape and the current one so data written by older versions stays usable.
function normalizeDayRecord(value) {
  if (typeof value === 'number') return { total: value, visits: 0, sites: {} };
  if (!value || typeof value !== 'object') return { total: 0, visits: 0, sites: {} };

  const sites = {};
  for (const [host, entry] of Object.entries(value.sites || {})) {
    if (typeof entry === 'number') sites[host] = { time: entry, visits: 0 };
    else if (entry && typeof entry === 'object') {
      sites[host] = { time: entry.time || 0, visits: entry.visits || 0 };
    }
  }
  return { total: value.total || 0, visits: value.visits || 0, sites };
}

// Older versions keyed days by toLocaleDateString() ("9/18/2026"), which does
// not sort. Re-key the days we can parse unambiguously; leave the rest alone
// rather than risk reading a day/month order wrong, so no history is dropped.
function migrateDateKeys(historicalData) {
  for (const legacy of Object.keys(historicalData)) {
    if (ISO_DATE.test(legacy)) continue;

    const parsed = new Date(legacy);
    const year = parsed.getFullYear();
    if (isNaN(parsed) || year < 2000 || year > new Date().getFullYear() + 1) continue;

    const key = dateKey(parsed);
    if (historicalData[key] === undefined) {
      historicalData[key] = historicalData[legacy];
      delete historicalData[legacy];
    }
  }
  return historicalData;
}

// Mirror the live daily counters into historicalData, so today is queryable
// next to past days instead of only landing there at the next rollover.
function writeDayRecord() {
  const hosts = new Set([
    ...Object.keys(state.dailySiteTime),
    ...Object.keys(state.dailySiteVisits)
  ]);

  const sites = {};
  for (const host of hosts) {
    sites[host] = {
      time: state.dailySiteTime[host] || 0,
      visits: state.dailySiteVisits[host] || 0
    };
  }

  if (state.dailyTime > 0 || state.dailyVisits > 0 || hosts.size > 0) {
    state.historicalData[state.lastResetDate] = {
      total: state.dailyTime,
      visits: state.dailyVisits,
      sites
    };
  }
}

function saveState() {
  writeDayRecord();
  chrome.storage.local.set({
    sessionTime: state.sessionTime,
    dailyTime: state.dailyTime,
    sessionSiteTime: state.sessionSiteTime,
    dailySiteTime: state.dailySiteTime,
    dailySiteVisits: state.dailySiteVisits,
    lastActiveTime: state.lastActiveTime,
    lastResetDate: state.lastResetDate,
    historicalData: state.historicalData,
    dailyVisits: state.dailyVisits
  });
}

// Close out the day we are leaving and start the new one's counters at zero.
function rollOverDay(today) {
  writeDayRecord();
  state.dailyTime = 0;
  state.dailySiteTime = {};
  state.dailyVisits = 0;
  state.dailySiteVisits = {};
  state.visitedTabs.clear();
  state.lastResetDate = today;
  saveState();
}

// Bank the running clock's elapsed seconds against the active site and restart
// it, so attribution can change without the totals losing or double-counting.
function commitElapsed() {
  if (!state.isRunning) return;

  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  state.startTime = Date.now();
  if (elapsed <= 0) return;

  state.sessionTime += elapsed;
  state.dailyTime += elapsed;

  const host = state.activeHost;
  if (host) {
    state.sessionSiteTime[host] = (state.sessionSiteTime[host] || 0) + elapsed;
    state.dailySiteTime[host] = (state.dailySiteTime[host] || 0) + elapsed;
  }
}

function updateTimers() {
  if (!state.isRunning) return;

  // Midnight while the clock runs: bank the seconds against the day they were
  // spent in before the new day's counters take over.
  const today = dateKey();
  if (state.lastResetDate !== today) {
    commitElapsed();
    rollOverDay(today);
  }

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

function startTimer(hostname) {
  const host = siteKey(hostname);

  // Reset if timer was stuck
  if (state.isRunning && Date.now() - state.lastHeartbeat > 5000) {
    state.isRunning = false;
  }

  if (state.isRunning) {
    // Focus reached another site before the old tab reported going inactive:
    // bank what the previous site earned before attribution moves.
    if (host && host !== state.activeHost) {
      commitElapsed();
      state.activeHost = host;
      saveState();
    }
    return;
  }

  // Reset session if inactive for 15+ minutes
  if (state.lastActiveTime && Date.now() - state.lastActiveTime >= 15 * 60 * 1000) {
    state.sessionTime = 0;
    state.sessionSiteTime = {};
  }

  // Reset daily if it's a new day
  const today = dateKey();
  if (state.lastResetDate !== today) {
    rollOverDay(today);
  }

  state.activeHost = host;
  state.startTime = Date.now();
  state.lastActiveTime = Date.now();
  state.lastHeartbeat = Date.now();
  state.isRunning = true;
  state.updateInterval = setInterval(updateTimers, 1000);
  saveState();
}

function pauseTimer() {
  if (!state.isRunning) return;

  clearInterval(state.updateInterval);
  state.updateInterval = null;

  commitElapsed();
  state.isRunning = false;
  state.activeHost = null;
  state.lastActiveTime = Date.now();

  saveState();
}

// Initialize from storage
chrome.storage.local.get(null, result => {
  state.sessionTime = result.sessionTime || 0;
  state.dailyTime = result.dailyTime || 0;
  state.sessionSiteTime = result.sessionSiteTime || {};
  state.dailySiteTime = result.dailySiteTime || {};
  state.dailySiteVisits = result.dailySiteVisits || {};
  state.lastActiveTime = result.lastActiveTime || Date.now();
  state.dailyVisits = result.dailyVisits || 0;
  state.visitedTabs.clear();

  state.historicalData = {};
  for (const [date, value] of Object.entries(result.historicalData || {})) {
    state.historicalData[date] = normalizeDayRecord(value);
  }
  migrateDateKeys(state.historicalData);

  // A stored day written by an older version carries a locale date string; keep
  // today's counters by reading it as the day it names.
  let storedDate = result.lastResetDate;
  if (storedDate && !ISO_DATE.test(storedDate)) {
    const parsed = new Date(storedDate);
    storedDate = isNaN(parsed) ? storedDate : dateKey(parsed);
  }
  state.lastResetDate = storedDate || dateKey();

  if (Date.now() - state.lastActiveTime >= 15 * 60 * 1000) {
    state.sessionTime = 0;
    state.sessionSiteTime = {};
  }

  const today = dateKey();
  if (state.lastResetDate !== today) {
    rollOverDay(today);
  }
  saveState();
});

// Handle long-lived connections from content scripts
chrome.runtime.onConnect.addListener(port => {
  port.onMessage.addListener(msg => {
    if (msg.type === 'TAB_ACTIVE') {
      state.activePort = port;
      startTimer(msg.hostname);
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
  port.onMessage.addListener(msg => {
    if (msg.type === 'NEW_TAB') {
      const tabId = msg.tabId;
      if (!state.visitedTabs.has(tabId)) {
        state.visitedTabs.add(tabId);
        state.dailyVisits++;

        const host = siteKey(msg.hostname);
        if (host) state.dailySiteVisits[host] = (state.dailySiteVisits[host] || 0) + 1;

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
