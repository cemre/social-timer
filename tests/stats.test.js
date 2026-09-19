const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStats } = require('./helpers.js');

const S = loadStats();
const TODAY = new Date(2026, 8, 18);  // 18 Sep 2026

test('groups hostnames onto the site they belong to', () => {
  assert.equal(S.siteKey('twitter.com'), 'x.com');
  assert.equal(S.siteKey('www.reddit.com'), 'reddit.com');
  assert.equal(S.siteKey('old.reddit.com'), 'reddit.com');
  assert.equal(S.siteKey('m.facebook.com'), 'facebook.com');
  assert.equal(S.siteKey('news.ycombinator.com'), 'ycombinator.com');
  assert.equal(S.siteLabel('ycombinator.com'), 'Hacker News');
});

test('keeps a host it does not recognise instead of dropping it', () => {
  assert.equal(S.siteKey('example.com'), 'example.com');
  assert.equal(S.siteLabel('example.com'), 'example.com');
  // A suffix match must not swallow an unrelated host.
  assert.equal(S.siteKey('notx.com'), 'notx.com');
});

test('reads both ISO day keys and the locale keys older versions wrote', () => {
  assert.equal(S.dateKeyToISO('2026-09-18'), '2026-09-18');
  assert.equal(S.dateKeyToISO('9/18/2026'), '2026-09-18');
  assert.equal(S.dateKeyToISO('18/09/2026'), '2026-09-18');
  assert.equal(S.dateKeyToISO('9/18/26'), '2026-09-18');
  assert.equal(S.dateKeyToISO('not a date'), null);
  assert.equal(S.dateKeyToISO('13/40/2026'), null);
});

test('formats durations the way the page reads them', () => {
  assert.equal(S.formatDuration(45), '45s');
  assert.equal(S.formatDuration(600), '10m');
  assert.equal(S.formatDuration(7200), '2h');
  assert.equal(S.formatDuration(5400), '1h 30m');
  assert.equal(S.formatDuration(0), '0s');
});

test('reads a day record into a per-site breakdown', () => {
  const days = S.buildDays({
    lastResetDate: '2026-09-18',
    historicalData: {
      '2026-09-17': {
        total: 2400, visits: 6,
        sites: { 'x.com': { time: 1500, visits: 4 }, 'reddit.com': { time: 900, visits: 2 } }
      }
    }
  }, TODAY);

  assert.equal(days.length, 1);
  assert.equal(days[0].label, 'Yesterday');
  assert.equal(days[0].total, 2400);
  assert.equal(days[0].visits, 6);
  assert.deepEqual(days[0].sites.map(s => [s.label, s.seconds, s.visits]),
    [['X', 1500, 4], ['Reddit', 900, 2]]);
});

test('merges hostnames that are the same site', () => {
  const days = S.buildDays({
    historicalData: {
      '2026-09-17': {
        total: 2100, visits: 5,
        sites: { 'twitter.com': { time: 1200, visits: 3 }, 'x.com': { time: 900, visits: 2 } }
      }
    }
  }, TODAY);

  assert.deepEqual(days[0].sites.map(s => [s.label, s.seconds, s.visits]), [['X', 2100, 5]]);
});

test('shows a pre-per-site day as an unsplit total rather than dropping it', () => {
  const days = S.buildDays({ historicalData: { '9/14/2026': 3600 } }, TODAY);

  assert.equal(days[0].total, 3600);
  assert.deepEqual(days[0].sites.map(s => s.key), [S.UNTRACKED_KEY]);
  // That day predates visit counting, which is not the same as zero visits.
  assert.equal(days[0].visits, null);
});

test('does not invent an unsplit band out of rounding drift', () => {
  const days = S.buildDays({
    historicalData: {
      '2026-09-17': { total: 1205, visits: 1, sites: { 'x.com': { time: 1200, visits: 1 } } }
    }
  }, TODAY);

  assert.equal(days[0].sites.some(s => s.key === S.UNTRACKED_KEY), false);
});

test('falls back to the live counters when today has not been written yet', () => {
  const days = S.buildDays({
    lastResetDate: '2026-09-18',
    dailyTime: 1500,
    dailyVisits: 7,
    dailySiteTime: { 'x.com': 900, 'youtube.com': 600 },
    dailySiteVisits: { 'x.com': 4, 'youtube.com': 3 },
    historicalData: {}
  }, TODAY);

  assert.equal(days[0].label, 'Today');
  assert.equal(days[0].total, 1500);
  assert.equal(days[0].visits, 7);
  assert.deepEqual(days[0].sites.map(s => [s.label, s.seconds]), [['X', 900], ['YouTube', 600]]);
});

test('sorts newest first and leaves unreadable keys at the end', () => {
  const days = S.buildDays({
    historicalData: {
      '2026-09-16': 600,
      'whenever': 900,
      '2026-09-18': 300
    }
  }, TODAY);

  assert.deepEqual(days.map(d => d.key), ['2026-09-18', '2026-09-16', 'whenever']);
  assert.equal(days[2].label, 'whenever');
});

test('summarises a range by calendar days, not by however many were recorded', () => {
  const stored = {
    historicalData: {
      '2026-09-10': 600,   // outside a 3-day window
      '2026-09-16': { total: 2400, visits: 5, sites: { 'x.com': { time: 2400, visits: 5 } } },
      '2026-09-18': { total: 1200, visits: 3, sites: { 'x.com': { time: 1200, visits: 3 } } }
    }
  };
  const days = S.buildDays(stored, TODAY);
  const range = S.summarize(days, 3, TODAY);

  assert.deepEqual(range.days.map(d => d.key), ['2026-09-18', '2026-09-16']);
  assert.equal(range.total, 3600);
  assert.equal(range.activeDays, 2);
  assert.equal(range.average, 1800);
  assert.equal(range.visits, 8);
  assert.equal(range.busiest.key, '2026-09-16');
  assert.equal(range.sites[0].seconds, 3600);
});

test('a site keeps its colour when the range changes', () => {
  const stored = {
    historicalData: {
      '2026-09-10': { total: 9000, visits: 1, sites: { 'reddit.com': { time: 9000, visits: 1 } } },
      '2026-09-18': { total: 600, visits: 1, sites: { 'x.com': { time: 600, visits: 1 } } }
    }
  };
  const days = S.buildDays(stored, TODAY);
  const palette = S.buildPalette(days);

  // Reddit leads all time, X leads the last 3 days. Neither may repaint.
  const wide = S.buildPalette(S.summarize(days, null, TODAY).days);
  const narrow = S.buildPalette(days);
  assert.equal(palette.slotFor('reddit.com'), wide.slotFor('reddit.com'));
  assert.equal(palette.slotFor('x.com'), narrow.slotFor('x.com'));
  assert.notEqual(palette.slotFor('reddit.com'), palette.slotFor('x.com'));
});

test('folds sites past the colour slots into one band but still names them', () => {
  const sites = {};
  'abcdefghi'.split('').forEach((letter, i) => {
    sites[`${letter}.com`] = { time: 1000 - i * 10, visits: 1 };
  });
  const days = S.buildDays({
    historicalData: { '2026-09-18': { total: 8640, visits: 9, sites } }
  }, TODAY);
  const palette = S.buildPalette(days);

  assert.equal(days[0].sites.filter(s => palette.slotFor(s.key) > 0).length, S.COLOR_SLOTS);
  assert.equal(palette.barKeyFor('h.com'), S.OTHER_KEY);
  assert.equal(days[0].sites.find(s => s.key === 'h.com').label, 'h.com');
});

test('handles storage that is empty or missing', () => {
  assert.deepEqual(S.buildDays({}, TODAY), []);
  assert.deepEqual(S.buildDays(undefined, TODAY), []);
  assert.equal(S.summarize([], 7, TODAY).average, 0);
  assert.equal(S.summarize([], 7, TODAY).busiest, null);
  assert.deepEqual(S.buildDays({ historicalData: { '2026-09-17': 0 } }, TODAY), []);
});
