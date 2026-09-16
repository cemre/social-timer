// background.js
importScripts('sites.js');

const SESSION_IDLE_MS = 15 * 60 * 1000;
const TICK_MS = 1000;

const state = {
  // host -> seconds accrued in the current session (excludes time still ticking)
  session: {},
  // host -> { time: seconds today, visits: count today }
  today: {},
  // dayKey -> { host -> seconds }
  historicalData: {},
  lastActiveTime: null,
  lastResetDate: null,
  lastHeartbeat: null,
  updateInterval: null,
  // port -> { host, active }. More than one tracked tab can be connected at once.
  ports: new Map(),
  // host -> ms timestamp it started accruing. A host is in here while at least
  // one of its tabs is active, so two tabs on the same site never double count.
  activeHosts: new Map(),
  // `${host}:${tabId}` for tabs already counted as a visit today
  visitedTabs: new Set()
};

function saveState() {
  chrome.storage.local.set({
    session: state.session,
    today: state.today,
    lastActiveTime: state.lastActiveTime,
    lastResetDate: state.lastResetDate,
    historicalData: state.historicalData
  });
}

function saveDailyTotal() {
  const day = {};
  for (const [host, entry] of Object.entries(state.today)) {
    if (entry.time > 0) day[host] = entry.time;
  }
  if (Object.keys(day).length > 0) {
    state.historicalData[state.lastResetDate] = day;
    chrome.storage.local.set({ historicalData: state.historicalData });
  }
}

function todayEntry(host) {
  if (!state.today[host]) state.today[host] = { time: 0, visits: 0 };
  return state.today[host];
}

// Seconds this host has been accruing since it last became active.
function liveSeconds(host) {
  const startedAt = state.activeHosts.get(host);
  return startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
}

// Global figures, still the sum across every site so the overlay keeps its
// existing meaning; the per-site numbers ride alongside them.
function totals() {
  const hosts = new Set([
    ...Object.keys(state.session),
    ...Object.keys(state.today),
    ...state.activeHosts.keys()
  ]);

  let sessionTime = 0;
  let dailyTime = 0;
  for (const host of hosts) {
    const live = liveSeconds(host);
    sessionTime += (state.session[host] || 0) + live;
    dailyTime += ((state.today[host] || {}).time || 0) + live;
  }

  let dailyVisits = 0;
  for (const entry of Object.values(state.today)) dailyVisits += entry.visits || 0;

  return { sessionTime, dailyTime, dailyVisits };
}

function payloadFor(host) {
  const live = host ? liveSeconds(host) : 0;
  const entry = (host && state.today[host]) || { time: 0, visits: 0 };
  return {
    ...totals(),
    host,
    siteLabel: host ? siteLabel(host) : '',
    siteSessionTime: host ? (state.session[host] || 0) + live : 0,
    siteDailyTime: entry.time + live,
    siteDailyVisits: entry.visits || 0
  };
}

// Banks whatever a host has accrued and takes it out of the active set.
function stopHost(host) {
  const startedAt = state.activeHosts.get(host);
  if (!startedAt) return;

  state.activeHosts.delete(host);
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (elapsed > 0) {
    state.session[host] = (state.session[host] || 0) + elapsed;
    todayEntry(host).time += elapsed;
  }
  state.lastActiveTime = Date.now();
}

function stopAllHosts() {
  for (const host of [...state.activeHosts.keys()]) stopHost(host);
}

function rollOverDayIfNeeded() {
  const key = dayKey();
  if (state.lastResetDate === key) return false;

  saveDailyTotal();
  state.today = {};
  state.visitedTabs.clear();
  state.lastResetDate = key;
  return true;
}

function resetSessionIfIdle() {
  if (state.activeHosts.size > 0) return;
  if (state.lastActiveTime && Date.now() - state.lastActiveTime >= SESSION_IDLE_MS) {
    state.session = {};
  }
}

function startTicking() {
  if (state.updateInterval) return;
  state.lastHeartbeat = Date.now();
  state.updateInterval = setInterval(tick, TICK_MS);
}

function stopTicking() {
  if (!state.updateInterval) return;
  clearInterval(state.updateInterval);
  state.updateInterval = null;
}

function broadcast(type) {
  const dead = [];
  for (const [port, info] of state.ports) {
    try {
      port.postMessage({ type, ...payloadFor(info.host) });
    } catch (e) {
      console.warn('Failed to send update, port may be disconnected');
      dead.push(port);
    }
  }
  if (dead.length > 0) {
    for (const port of dead) state.ports.delete(port);
    syncActivity();
  }
}

// Recomputes which hosts are accruing from the current set of ports. Called
// whenever a tab reports a change, connects or disconnects.
function syncActivity() {
  const activeNow = new Set();
  for (const info of state.ports.values()) {
    if (info.active && info.host) activeNow.add(info.host);
  }

  for (const host of [...state.activeHosts.keys()]) {
    if (!activeNow.has(host)) stopHost(host);
  }

  if (activeNow.size > 0) {
    resetSessionIfIdle();
    rollOverDayIfNeeded();
    const now = Date.now();
    for (const host of activeNow) {
      if (!state.activeHosts.has(host)) state.activeHosts.set(host, now);
    }
    state.lastActiveTime = now;
    startTicking();
  } else {
    stopTicking();
  }

  saveState();
}

function tick() {
  if (state.activeHosts.size === 0) {
    stopTicking();
    return;
  }

  // Midnight while tabs are still open: bank today's time under the old day,
  // then let the same hosts start accruing against the new one.
  if (state.lastResetDate !== dayKey()) {
    stopAllHosts();
    rollOverDayIfNeeded();
    syncActivity();
  }

  // Restart the interval if it stalled (service worker suspension, throttling).
  if (state.lastHeartbeat && Date.now() - state.lastHeartbeat > 5000) {
    console.warn('Timer heartbeat missed, restarting interval');
    stopTicking();
    startTicking();
  }
  state.lastHeartbeat = Date.now();

  broadcast('UPDATE_TIMERS');
}

// Initialize from storage.
// TODO: migrate the v1 flat keys (sessionTime, dailyTime, dailyVisits and the
// number-valued historicalData entries) once the stored shape is agreed.
chrome.storage.local.get(null, result => {
  state.session = result.session || {};
  state.today = result.today || {};
  state.historicalData = result.historicalData || {};
  state.lastActiveTime = result.lastActiveTime || Date.now();
  state.lastResetDate = result.lastResetDate || dayKey();
  state.visitedTabs.clear();

  resetSessionIfIdle();
  rollOverDayIfNeeded();
  saveState();
});

// Handle long-lived connections from content scripts. The port name carries the
// tab's hostname, so the first message already knows which site it belongs to.
chrome.runtime.onConnect.addListener(port => {
  const info = { host: canonicalHost(port.name), active: false };
  state.ports.set(port, info);

  port.onMessage.addListener(msg => {
    if (msg.type === 'TAB_ACTIVE') {
      info.active = true;
      syncActivity();
    } else if (msg.type === 'TAB_INACTIVE') {
      info.active = false;
      syncActivity();
    } else if (msg.type === 'NEW_TAB') {
      if (!info.host) return;
      const visitKey = `${info.host}:${msg.tabId}`;
      if (!state.visitedTabs.has(visitKey)) {
        state.visitedTabs.add(visitKey);
        rollOverDayIfNeeded();
        todayEntry(info.host).visits++;
        saveState();
      }
    }
  });

  port.onDisconnect.addListener(() => {
    state.ports.delete(port);
    syncActivity();
  });

  port.postMessage({ type: 'INITIAL_STATE', ...payloadFor(info.host) });
});
