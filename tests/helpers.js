// Loads the extension's plain scripts into this process. They are written for
// a browser and a service worker, so neither exports anything — each is
// evaluated and the global it defines is handed back.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// Evaluated in this realm, not a fresh one, so the objects it returns compare
// with assert.deepEqual. Wrapped in a function so nothing leaks to the global
// scope and the file can be loaded more than once.
function loadStats() {
  return vm.runInThisContext(`(function () { ${read('stats.js')}; return SocialStats; })()`);
}

// Runs background.js against a fake clock, a fake chrome.storage and fake
// ports, so day rollovers and site switching can be driven directly. `seed` is
// the storage the worker finds already on disk when it starts.
function loadBackground(startMs, seed) {
  let clock = startMs;
  const store = Object.assign({}, seed);
  let connect = null;

  // Real intervals keep the worker's heartbeat fresh, so the fake clock has to
  // run them too — otherwise every advance looks like a stalled worker.
  const timers = new Map();
  let nextTimer = 1;

  const sandbox = {
    console,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    },
    setInterval(fn, ms) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
    chrome: {
      storage: {
        local: {
          set(obj) { Object.assign(store, JSON.parse(JSON.stringify(obj))); return Promise.resolve(); },
          get(_keys, cb) {
            // Real storage answers on a later tick; callers must not assume
            // their state is loaded by the time the script finishes running.
            const snapshot = JSON.parse(JSON.stringify(store));
            if (cb) setImmediate(() => cb(snapshot));
            return Promise.resolve(snapshot);
          }
        }
      },
      runtime: { onConnect: { addListener(h) { connect = h; } }, getURL: p => p },
      action: { onClicked: { addListener() {} } },
      tabs: { create() {} }
    }
  };

  vm.runInNewContext(read('background.js'), sandbox);

  return {
    store,
    // A content script connecting from one site. `sent` collects what the
    // worker pushes back, which is what the overlay renders.
    connect(hostname) {
      const handlers = [];
      const disconnects = [];
      const sent = [];
      const port = {
        onMessage: { addListener: h => handlers.push(h) },
        onDisconnect: { addListener: h => disconnects.push(h) },
        postMessage: msg => sent.push(msg)
      };
      connect(port);

      const send = msg => handlers.forEach(h => h(msg));
      return {
        sent,
        last: () => sent[sent.length - 1],
        open: tabId => send({ type: 'NEW_TAB', tabId, hostname }),
        focus: () => send({ type: 'TAB_ACTIVE', hostname }),
        blur: () => send({ type: 'TAB_INACTIVE', hostname }),
        // The tab went away without reporting anything, e.g. it was closed.
        drop: () => disconnects.forEach(h => h())
      };
    },
    // Advances a second at a time so the worker's own interval runs, the way
    // it would in the browser.
    advance(ms) {
      for (let step = 0; step < ms; step += 1000) {
        clock += 1000;
        Array.from(timers.values()).forEach(fn => fn());
      }
    },
    settle: () => new Promise(resolve => setImmediate(resolve))
  };
}

module.exports = { ROOT, loadStats, loadBackground };
