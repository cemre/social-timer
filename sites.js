// sites.js — the one list of tracked sites.
//
// Everything else that names a site is derived from this file:
//   - the content-script `matches` in manifest.json  (generated)
//   - the "Supported Sites" list in README.md         (generated)
//   - the feed gate's per-site config in feedgate.js  (read at runtime)
//
// Adding a site is a single edit here, followed by `node tools/sync-sites.js
// --write` to regenerate manifest.json and README.md.
//
// Fields:
//   name        Display name, used in the README list.
//   hosts       Registrable domains. Each becomes one match pattern, and
//               subdomains are included unless `subdomains: false`.
//   subdomains  Optional, defaults to true. False pins the match to the exact
//               host (news.ycombinator.com has no other subdomains to track).
//   feed        Optional. Present only on the scroll-trap sites the feed gate
//               covers; sites without it are timed but never gated.
//     selectors Ordered feed selectors, first visible match wins.
//     skip      RegExp of pathnames where the gate must NOT run, so the feed
//               selectors — which also cover the DM view on these sites —
//               don't end up hiding messages.

(function () {

const SOCIAL_TIMER_SITES = [
  {
    name: 'Twitter / X',
    hosts: ['twitter.com', 'x.com'],
    feed: {
      selectors: ['[aria-label^="Timeline"]', '[data-testid="primaryColumn"]'],
      skip: /^\/(messages|i\/chat)/,
    },
  },
  {
    name: 'Threads',
    hosts: ['threads.com', 'threads.net'],
    feed: {
      selectors: ['[role="region"]', '[role="main"]'],
      skip: /^\/messages/,
    },
  },
  {
    name: 'Instagram',
    hosts: ['instagram.com'],
    feed: {
      selectors: ['main[role="main"]'],
      skip: /^\/direct/,
    },
  },
  {
    name: 'Facebook',
    hosts: ['facebook.com'],
    feed: {
      selectors: ['[role="feed"]', '[role="main"]'],
    },
  },
  {
    name: 'Messenger',
    hosts: ['messenger.com'],
  },
  {
    name: 'LinkedIn',
    hosts: ['linkedin.com'],
  },
  {
    name: 'YouTube',
    hosts: ['youtube.com'],
  },
  {
    name: 'Bluesky',
    hosts: ['bsky.app'],
  },
  {
    name: 'Reddit',
    hosts: ['reddit.com'],
    feed: {
      selectors: ['shreddit-feed', 'shreddit-comment-tree', '#siteTable', 'main'],
    },
  },
  {
    name: 'Hacker News',
    hosts: ['news.ycombinator.com'],
    subdomains: false,
  },
];

// Chrome match pattern for one host of a site, e.g. "*://*.reddit.com/*".
function socialTimerMatchPattern(site, host) {
  return site.subdomains === false ? `*://${host}/*` : `*://*.${host}/*`;
}

// True when `hostname` (already stripped of a leading "www.") is this host.
function socialTimerHostMatches(site, host, hostname) {
  if (hostname === host) return true;
  return site.subdomains !== false && hostname.endsWith('.' + host);
}

// Content scripts share one isolated world, so feedgate.js picks these up off
// the global. Only what the extension itself needs goes there.
globalThis.SOCIAL_TIMER_SITES = SOCIAL_TIMER_SITES;
globalThis.socialTimerHostMatches = socialTimerHostMatches;

// In Node (tools/) the CommonJS export is used instead.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SOCIAL_TIMER_SITES,
    socialTimerMatchPattern,
    socialTimerHostMatches,
  };
}

})();
