#!/usr/bin/env node
// tools/test-feedgate.js — runs feedgate.js against a fake DOM to confirm the
// sites in sites.js still gate the way they are meant to.
//
//   node tools/test-feedgate.js
//
// The DOM here is the smallest thing feedgate.js will run against: enough of
// document, chrome.storage and window to boot the gate and read back what it
// did. Add a case below whenever a site gains a `feed` block in sites.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const { SOCIAL_TIMER_SITES } = require(path.join(root, 'sites.js'));

function makeEl(sel, width = 800, height = 600) {
  const classes = new Set();
  return {
    _sel: sel, id: '', textContent: '', className: '', style: {},
    disabled: false, children: [],
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); return kid; },
    remove() { this._removed = true; },
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    click() { (this._listeners.click || []).forEach(fn => fn()); },
  };
}

// Boot the gate on a page whose only feed-shaped elements are `feedSelectors`.
function runGate({ hostname, pathname, feedSelectors }) {
  const feeds = feedSelectors.map(sel => makeEl(sel));
  const created = [];
  const stored = {};

  const document = {
    head: makeEl('head'),
    body: makeEl('body'),
    getElementById: id => created.find(el => el.id === id) || null,
    createElement: tag => { const el = makeEl(tag); created.push(el); return el; },
    querySelectorAll: sel => (
      sel === '.feedgate-hidden'
        ? [...feeds, ...created].filter(el => el.classList.contains('feedgate-hidden'))
        : feeds.filter(el => el._sel === sel)
    ),
  };

  const ctx = {
    console,
    document,
    location: { hostname, pathname },
    setInterval: () => 0,
    addEventListener: () => {},
    chrome: {
      storage: {
        local: {
          get: (key, cb) => cb({ [key]: stored[key] }),
          set: obj => Object.assign(stored, obj),
        },
        onChanged: { addListener: () => {} },
      },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  // Same order manifest.json injects them in.
  for (const file of ['sites.js', 'feedgate.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }

  const card = created.find(el => el.className === 'feedgate-card');
  return {
    hidden: feeds.filter(el => el.classList.contains('feedgate-hidden')).map(el => el._sel),
    card: card && !card._removed ? card : null,
    revealButton: card && card.children.find(el => el.className === 'feedgate-card__btn'),
    stored,
  };
}

// gated:  the feed is hidden behind the reveal card
// open:   the gate leaves the page alone (DM route, or a site with no `feed`)
const CASES = [
  { what: 'x.com timeline',           host: 'x.com',               path: '/home',         sel: '[aria-label^="Timeline"]', expect: 'gated' },
  { what: 'twitter.com timeline',     host: 'twitter.com',         path: '/home',         sel: '[data-testid="primaryColumn"]', expect: 'gated' },
  { what: 'x.com DMs',                host: 'x.com',               path: '/messages',     sel: '[aria-label^="Timeline"]', expect: 'open' },
  { what: 'x.com in-app chat',        host: 'x.com',               path: '/i/chat/42',    sel: '[aria-label^="Timeline"]', expect: 'open' },
  { what: 'threads.com feed',         host: 'www.threads.com',     path: '/',             sel: '[role="region"]', expect: 'gated' },
  { what: 'threads.net DMs',          host: 'threads.net',         path: '/messages',     sel: '[role="region"]', expect: 'open' },
  { what: 'instagram feed',           host: 'www.instagram.com',   path: '/',             sel: 'main[role="main"]', expect: 'gated' },
  { what: 'instagram DMs',            host: 'www.instagram.com',   path: '/direct/inbox', sel: 'main[role="main"]', expect: 'open' },
  { what: 'facebook feed',            host: 'www.facebook.com',    path: '/',             sel: '[role="feed"]', expect: 'gated' },
  { what: 'new reddit feed',          host: 'www.reddit.com',      path: '/',             sel: 'shreddit-feed', expect: 'gated' },
  { what: 'old reddit feed',          host: 'old.reddit.com',      path: '/r/all',        sel: '#siteTable', expect: 'gated' },
  { what: 'youtube (timed only)',     host: 'www.youtube.com',     path: '/',             sel: 'main', expect: 'open' },
  { what: 'linkedin (timed only)',    host: 'www.linkedin.com',    path: '/feed/',        sel: 'main', expect: 'open' },
  { what: 'messenger (timed only)',   host: 'www.messenger.com',   path: '/',             sel: 'main', expect: 'open' },
  { what: 'bluesky (timed only)',     host: 'bsky.app',            path: '/',             sel: 'main', expect: 'open' },
  { what: 'hacker news (timed only)', host: 'news.ycombinator.com', path: '/',            sel: 'main', expect: 'open' },
  { what: 'untracked site',           host: 'example.com',         path: '/',             sel: 'main', expect: 'open' },
  { what: 'lookalike domain',         host: 'twitter.com.evil.net', path: '/',            sel: 'main', expect: 'open' },
];

let failed = 0;

for (const c of CASES) {
  const r = runGate({ hostname: c.host, pathname: c.path, feedSelectors: [c.sel] });
  const actual = r.card && r.hidden.length === 1 ? 'gated'
    : !r.card && r.hidden.length === 0 ? 'open'
    : `mixed (hidden=${r.hidden.length}, card=${!!r.card})`;

  if (actual === c.expect) {
    console.log(`ok    ${c.what} — ${c.expect}`);
  } else {
    failed++;
    console.error(`FAIL  ${c.what} — expected ${c.expect}, got ${actual}`);
  }
}

// The reveal/cooldown window is persisted per site. Changing these keys would
// silently reset everyone's open reveal window, so pin the key each host maps
// to by clicking reveal and reading back what the gate wrote.
const KEY_CASES = [
  { host: 'x.com',              key: 'feedgate:x.com' },
  { host: 'mobile.twitter.com', key: 'feedgate:twitter.com' },
  { host: 'old.reddit.com',     key: 'feedgate:reddit.com' },
  { host: 'www.threads.net',    key: 'feedgate:threads.net' },
  { host: 'www.instagram.com',  key: 'feedgate:instagram.com' },
  { host: 'www.facebook.com',   key: 'feedgate:facebook.com' },
];

const ALL_FEED_SELECTORS = [...new Set(
  SOCIAL_TIMER_SITES.flatMap(site => (site.feed ? site.feed.selectors : []))
)];

for (const c of KEY_CASES) {
  const r = runGate({ hostname: c.host, pathname: '/', feedSelectors: ALL_FEED_SELECTORS });
  if (!r.revealButton) {
    failed++;
    console.error(`FAIL  ${c.host} — expected a reveal button, page was not gated`);
    continue;
  }

  r.revealButton.click();
  const written = Object.keys(r.stored);

  if (written.length === 1 && written[0] === c.key) {
    console.log(`ok    ${c.host} — reveal persists to ${c.key}`);
  } else {
    failed++;
    console.error(`FAIL  ${c.host} — expected reveal to persist to ${c.key}, got ${JSON.stringify(written)}`);
  }
}

console.log(`\n${CASES.length + KEY_CASES.length} checks, ${failed} failures`);
process.exit(failed ? 1 : 0);
