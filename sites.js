// sites.js — canonical site keys, shared by the service worker and the popup.
// Loaded via importScripts() in background.js and a <script> tag in popup.html.

// A hostname that matches one of `match` (exactly, or as a subdomain) is stored
// under `key`, so twitter.com and x.com accumulate into a single row.
const SITES = [
  { key: 'x.com',                label: 'X / Twitter', match: ['x.com', 'twitter.com'] },
  { key: 'threads.com',          label: 'Threads',     match: ['threads.com', 'threads.net'] },
  { key: 'instagram.com',        label: 'Instagram',   match: ['instagram.com'] },
  { key: 'facebook.com',         label: 'Facebook',    match: ['facebook.com'] },
  { key: 'messenger.com',        label: 'Messenger',   match: ['messenger.com'] },
  { key: 'linkedin.com',         label: 'LinkedIn',    match: ['linkedin.com'] },
  { key: 'youtube.com',          label: 'YouTube',     match: ['youtube.com'] },
  { key: 'bsky.app',             label: 'Bluesky',     match: ['bsky.app'] },
  { key: 'reddit.com',           label: 'Reddit',      match: ['reddit.com'] },
  { key: 'news.ycombinator.com', label: 'Hacker News', match: ['news.ycombinator.com'] }
];

// Maps a raw location.hostname to the key its time is stored under. An unknown
// host (a match pattern added to the manifest but not listed here) falls back to
// its own bare hostname, so it is still tracked rather than dropped.
function canonicalHost(hostname) {
  const host = String(hostname || '').replace(/^www\./, '').toLowerCase();
  if (!host) return null;
  const site = SITES.find(s => s.match.some(m => host === m || host.endsWith('.' + m)));
  return site ? site.key : host;
}

function siteLabel(key) {
  const site = SITES.find(s => s.key === key);
  return site ? site.label : key;
}

// Local calendar date, as a sortable YYYY-MM-DD key.
function dayKey(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
