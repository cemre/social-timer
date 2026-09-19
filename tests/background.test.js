const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStats, loadBackground } = require('./helpers.js');

const NOON = Date.UTC(2026, 8, 17, 12, 0, 0);   // 17 Sep 2026, midday
const MINUTE = 60 * 1000;

// The worker reads storage on load, which lands on the next tick.
async function boot(at = NOON, seed) {
  const bg = loadBackground(at, seed);
  await bg.settle();
  return bg;
}

function record(bg, day) {
  return bg.store.historicalData[day];
}

test('attributes time to the site that earned it', async () => {
  const bg = await boot();

  const x = bg.connect('x.com');
  x.open('tab-1');
  x.focus();
  bg.advance(5 * MINUTE);
  x.blur();

  const reddit = bg.connect('www.reddit.com');
  reddit.open('tab-2');
  reddit.focus();
  bg.advance(2 * MINUTE);
  reddit.blur();

  const day = record(bg, '2026-09-17');
  assert.equal(day.sites['x.com'].time, 300);
  assert.equal(day.sites['reddit.com'].time, 120);
  assert.equal(day.total, 420);
});

test('keys a host without its leading www', async () => {
  const bg = await boot();

  const site = bg.connect('www.instagram.com');
  site.open('tab-1');
  site.focus();
  bg.advance(MINUTE);
  site.blur();

  assert.deepEqual(Object.keys(record(bg, '2026-09-17').sites), ['instagram.com']);
});

test('counts a visit against the site it was opened on', async () => {
  const bg = await boot();

  bg.connect('x.com').open('tab-1');
  bg.connect('reddit.com').open('tab-2');
  bg.connect('x.com').open('tab-3');

  const day = record(bg, '2026-09-17');
  assert.equal(day.sites['x.com'].visits, 2);
  assert.equal(day.sites['reddit.com'].visits, 1);
  assert.equal(day.visits, 3);
});

test('moves attribution when focus reaches another site without a blur', async () => {
  const bg = await boot();

  const youtube = bg.connect('youtube.com');
  youtube.focus();
  bg.advance(MINUTE);

  // No blur from the YouTube tab — focus simply lands somewhere else.
  const instagram = bg.connect('instagram.com');
  instagram.focus();
  bg.advance(30 * 1000);
  instagram.blur();

  const day = record(bg, '2026-09-17');
  assert.equal(day.sites['youtube.com'].time, 60);
  assert.equal(day.sites['instagram.com'].time, 30);
  assert.equal(day.total, 90);
});

test('splits a session that runs across midnight between the two days', async () => {
  const bg = await boot(Date.UTC(2026, 8, 17, 23, 50, 0));

  const x = bg.connect('x.com');
  x.open('tab-1');
  x.focus();
  bg.advance(20 * MINUTE);   // 23:50 -> 00:10
  x.blur();

  assert.equal(record(bg, '2026-09-17').sites['x.com'].time, 10 * 60);
  assert.equal(record(bg, '2026-09-18').sites['x.com'].time, 10 * 60);
  assert.equal(bg.store.lastResetDate, '2026-09-18');
});

test('counts a visit made just after midnight against the new day', async () => {
  const bg = await boot(Date.UTC(2026, 8, 17, 23, 59, 0));

  bg.connect('x.com').open('tab-1');
  assert.equal(record(bg, '2026-09-17').visits, 1);

  bg.advance(2 * MINUTE);    // past midnight, with no timer running
  bg.connect('reddit.com').open('tab-2');

  assert.equal(bg.store.lastResetDate, '2026-09-18');
  assert.equal(record(bg, '2026-09-18').visits, 1);
  assert.equal(record(bg, '2026-09-18').sites['reddit.com'].visits, 1);
  // Yesterday keeps the visit it actually had.
  assert.equal(record(bg, '2026-09-17').visits, 1);
});

test('resets the daily counters on a new day without touching yesterday', async () => {
  const bg = await boot();

  const x = bg.connect('x.com');
  x.open('tab-1');
  x.focus();
  bg.advance(5 * MINUTE);
  x.blur();

  const next = bg.connect('x.com');
  bg.advance(12 * 60 * MINUTE);   // into the following day
  next.open('tab-2');
  next.focus();
  bg.advance(90 * 1000);
  next.blur();

  assert.equal(record(bg, '2026-09-17').sites['x.com'].time, 300);
  assert.equal(record(bg, '2026-09-18').sites['x.com'].time, 90);
  assert.equal(bg.store.dailyTime, 90);
  assert.equal(bg.store.dailyVisits, 1);
});

test('keeps today queryable next to past days instead of waiting for a rollover', async () => {
  const bg = await boot();

  const x = bg.connect('x.com');
  x.open('tab-1');
  x.focus();
  bg.advance(3 * MINUTE);
  x.blur();

  // Written while the day is still in progress.
  assert.equal(bg.store.lastResetDate, '2026-09-17');
  assert.equal(record(bg, '2026-09-17').total, 180);
});

test('re-keys locale day keys written by older versions', async () => {
  const bg = await boot(NOON, {
    lastResetDate: '9/16/2026',
    dailyTime: 120,
    historicalData: { '9/14/2026': 3600, '9/15/2026': 1800 }
  });

  assert.deepEqual(Object.keys(bg.store.historicalData).sort(),
    ['2026-09-14', '2026-09-15', '2026-09-16']);
  // The old bare-number shape is read as a day with a total and no split.
  assert.deepEqual(bg.store.historicalData['2026-09-14'], { total: 3600, visits: 0, sites: {} });
  // The day in progress when the old version last ran is closed out, not lost.
  assert.equal(bg.store.historicalData['2026-09-16'].total, 120);
  assert.equal(bg.store.dailyTime, 0);
});

test('reads an ambiguous legacy key using the order this browser writes', async () => {
  // "1/2/2026" is 2 January where the month leads and 1 February where the day
  // does, and the digits alone cannot say which. Whichever this browser means,
  // the re-keyed day must render back to the key it came from.
  const bg = await boot(NOON, { historicalData: { '1/2/2026': 600 } });

  const keys = Object.keys(bg.store.historicalData).filter(k => k !== '2026-09-17');
  assert.equal(keys.length, 1);

  const [year, month, day] = keys[0].split('-').map(Number);
  const digits = str => str.split(/\D+/).filter(Boolean).map(Number);
  assert.deepEqual(digits(new Date(year, month - 1, day).toLocaleDateString()), digits('1/2/2026'));
});

test('leaves a day key it cannot read where it is rather than dating it wrong', async () => {
  const bg = await boot(NOON, { historicalData: { 'whenever': 600 } });

  assert.deepEqual(bg.store.historicalData['whenever'], { total: 600, visits: 0, sites: {} });
});

test('what the worker writes is what the stats page reads', async () => {
  const bg = await boot();

  const x = bg.connect('x.com');
  x.open('tab-1');
  x.focus();
  bg.advance(10 * MINUTE);
  x.blur();

  const hn = bg.connect('news.ycombinator.com');
  hn.open('tab-2');
  hn.focus();
  bg.advance(5 * MINUTE);
  hn.blur();

  const days = loadStats().buildDays(bg.store, new Date(2026, 8, 17));
  assert.equal(days.length, 1);
  assert.equal(days[0].label, 'Today');
  assert.equal(days[0].total, 900);
  assert.equal(days[0].visits, 2);
  assert.deepEqual(days[0].sites.map(s => [s.label, s.seconds, s.visits]),
    [['X', 600, 1], ['Hacker News', 300, 1]]);
});
