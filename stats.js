// stats.js — turns what the timer stores into per-day and per-site numbers.
// Pure: no DOM and no chrome APIs, so it can be exercised on its own.
const SocialStats = (function () {
  // Registrable domain -> display name. Hosts are stored raw, so grouping and
  // naming live here; changing this list regroups existing data for free.
  const SITES = [
    { key: 'x.com',           label: 'X',           domains: ['x.com', 'twitter.com'] },
    { key: 'threads.com',     label: 'Threads',     domains: ['threads.com', 'threads.net'] },
    { key: 'instagram.com',   label: 'Instagram',   domains: ['instagram.com'] },
    { key: 'facebook.com',    label: 'Facebook',    domains: ['facebook.com'] },
    { key: 'messenger.com',   label: 'Messenger',   domains: ['messenger.com'] },
    { key: 'linkedin.com',    label: 'LinkedIn',    domains: ['linkedin.com'] },
    { key: 'youtube.com',     label: 'YouTube',     domains: ['youtube.com', 'youtu.be'] },
    { key: 'bsky.app',        label: 'Bluesky',     domains: ['bsky.app'] },
    { key: 'reddit.com',      label: 'Reddit',      domains: ['reddit.com'] },
    { key: 'ycombinator.com', label: 'Hacker News', domains: ['ycombinator.com'] }
  ];

  const OTHER_KEY = '__other';
  const UNTRACKED_KEY = '__untracked';

  // Colour slots the page defines as --series-1..7. The eighth-and-beyond site
  // folds into "Other" rather than inventing a hue nobody can tell apart.
  const COLOR_SLOTS = 7;

  // A day total can run slightly ahead of its per-site sum (each stretch is
  // floored to whole seconds). Only call the remainder untracked once it is
  // too big to be that rounding drift.
  const UNTRACKED_MIN_SECONDS = 30;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function siteKey(host) {
    const clean = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!clean) return '';

    const site = SITES.find(s => s.domains.some(d => clean === d || clean.endsWith('.' + d)));
    return site ? site.key : clean;
  }

  function siteLabel(key) {
    if (key === OTHER_KEY) return 'Other';
    if (key === UNTRACKED_KEY) return 'Before per-site tracking';

    const site = SITES.find(s => s.key === key);
    return site ? site.label : key;
  }

  // The timer keys days with toLocaleDateString(), so "9/18/2026" under en-US
  // and other orders elsewhere. Normalise to YYYY-MM-DD for sorting; return
  // null when a key can't be read rather than guessing a wrong date.
  function dateKeyToISO(key) {
    const raw = String(key || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const parts = raw.split(/\D+/).filter(Boolean).map(Number);
    if (parts.length < 3) return null;

    let year, month, day;
    if (parts[0] > 31) {
      [year, month, day] = parts;
    } else if (parts[2] > 31 || parts.length === 3) {
      year = parts[2];
      // M/D/Y and D/M/Y share this shape. A part above 12 settles it;
      // when both could be a month, assume the M/D/Y the en-US keys use.
      if (parts[0] > 12) {
        day = parts[0];
        month = parts[1];
      } else {
        month = parts[0];
        day = parts[1];
      }
    } else {
      return null;
    }

    if (year < 100) year += 2000;
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function shiftISO(iso, days) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function todayISO(now) {
    const dt = now || new Date();
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }

  function formatDayLabel(iso, today) {
    if (!iso) return null;
    if (iso === today) return 'Today';
    if (iso === shiftISO(today, -1)) return 'Yesterday';

    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
    });
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);

    if (hrs > 0) return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    if (mins > 0) return `${mins}m`;
    return `${total}s`;
  }

  // historicalData[date] is { total, visits, sites: { host: { time, visits } } }.
  // Versions before per-site tracking stored a bare number of seconds instead.
  function normalizeRecord(value) {
    if (typeof value === 'number') return { total: value, visits: 0, sites: {}, legacy: true };
    if (!value || typeof value !== 'object') return { total: 0, visits: 0, sites: {}, legacy: false };

    return {
      total: value.total || 0,
      visits: value.visits || 0,
      sites: value.sites || {},
      legacy: false
    };
  }

  // One entry per day that has anything recorded, newest first.
  function buildDays(stored, now) {
    const data = stored || {};
    const historical = data.historicalData || {};
    const currentKey = data.lastResetDate;

    const keys = new Set(Object.keys(historical));
    if (currentKey) keys.add(currentKey);

    const days = [];
    keys.forEach(key => {
      const record = normalizeRecord(historical[key]);

      // The background script mirrors today into historicalData on every save,
      // so this is normally already current. Fall back to the live counters in
      // case the record has not been written yet.
      let perHost = record.sites;
      if (key === currentKey && !Object.keys(perHost).length && data.dailySiteTime) {
        perHost = {};
        Object.keys(data.dailySiteTime).forEach(host => {
          perHost[host] = {
            time: data.dailySiteTime[host],
            visits: (data.dailySiteVisits || {})[host] || 0
          };
        });
      }

      const sites = new Map();
      let siteSeconds = 0;
      let siteVisits = 0;

      Object.keys(perHost).forEach(host => {
        const entry = perHost[host] || {};
        const seconds = Math.max(0, Math.round(entry.time || 0));
        const visits = Math.max(0, Math.round(entry.visits || 0));
        if (!seconds && !visits) return;

        const key2 = siteKey(host);
        const acc = sites.get(key2) || { key: key2, label: siteLabel(key2), seconds: 0, visits: 0 };
        acc.seconds += seconds;
        acc.visits += visits;
        sites.set(key2, acc);

        siteSeconds += seconds;
        siteVisits += visits;
      });

      let total = Math.max(0, Math.round(record.total), siteSeconds);
      // A day stored before visits were recorded has no count to show, which
      // is not the same as a day on which nothing was visited.
      let visits = record.legacy ? null : Math.max(Math.round(record.visits || 0), siteVisits);

      if (key === currentKey) {
        total = Math.max(total, Math.max(0, Math.round(data.dailyTime || 0)));
        const daily = Math.max(0, Math.round(data.dailyVisits || 0));
        if (daily || visits !== null) visits = Math.max(visits || 0, daily);
      }

      // Days recorded before per-site tracking existed have a total and no
      // split. Show the remainder for what it is instead of dropping it.
      const untracked = total - siteSeconds;
      if (untracked >= UNTRACKED_MIN_SECONDS) {
        sites.set(UNTRACKED_KEY, {
          key: UNTRACKED_KEY, label: siteLabel(UNTRACKED_KEY), seconds: untracked, visits: 0
        });
      }

      if (total <= 0 && !visits) return;

      days.push({
        key,
        iso: dateKeyToISO(key),
        total,
        visits,
        sites: Array.from(sites.values()).sort((a, b) => b.seconds - a.seconds)
      });
    });

    // Newest first; keys we couldn't read sort to the end rather than
    // landing at a date they don't belong to.
    days.sort((a, b) => {
      if (a.iso && b.iso) return a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0;
      if (a.iso) return -1;
      if (b.iso) return 1;
      return 0;
    });

    const today = todayISO(now);
    days.forEach(day => {
      day.label = formatDayLabel(day.iso, today) || day.key;
    });

    return days;
  }

  function mergeSites(days) {
    const totals = new Map();
    days.forEach(day => day.sites.forEach(site => {
      const acc = totals.get(site.key) || { key: site.key, label: site.label, seconds: 0, visits: 0 };
      acc.seconds += site.seconds;
      acc.visits += site.visits;
      totals.set(site.key, acc);
    }));

    return Array.from(totals.values()).sort((a, b) => b.seconds - a.seconds);
  }

  // Colour is assigned once from all-time totals and never from a site's rank
  // inside the current range, so changing the range never repaints a site.
  function buildPalette(days) {
    const ranked = mergeSites(days).filter(s => s.key !== UNTRACKED_KEY);
    const slots = new Map();

    ranked.slice(0, COLOR_SLOTS).forEach((site, i) => slots.set(site.key, i + 1));
    return {
      slotFor(key) {
        return slots.get(key) || 0;  // 0 = the neutral "Other" / untracked fill
      },
      // Sites past the colour slots share one "Other" band in the bars; the
      // per-day rows still name them.
      barKeyFor(key) {
        if (key === UNTRACKED_KEY) return UNTRACKED_KEY;
        return slots.has(key) ? key : OTHER_KEY;
      }
    };
  }

  function summarize(days, rangeDays, now) {
    const cutoff = rangeDays ? shiftISO(todayISO(now), -(rangeDays - 1)) : null;
    const inRange = cutoff ? days.filter(d => d.iso && d.iso >= cutoff) : days.slice();

    const total = inRange.reduce((sum, d) => sum + d.total, 0);
    const active = inRange.filter(d => d.total > 0);
    const counted = inRange.filter(d => d.visits !== null);
    const busiest = active.reduce((best, d) => (!best || d.total > best.total ? d : best), null);

    return {
      days: inRange,
      total,
      activeDays: active.length,
      average: active.length ? Math.round(total / active.length) : 0,
      visits: counted.length ? counted.reduce((sum, d) => sum + d.visits, 0) : null,
      busiest,
      sites: mergeSites(inRange)
    };
  }

  return {
    SITES, OTHER_KEY, UNTRACKED_KEY, COLOR_SLOTS,
    siteKey, siteLabel, dateKeyToISO, shiftISO, todayISO, normalizeRecord,
    formatDayLabel, formatDuration, buildDays, mergeSites, buildPalette, summarize
  };
})();
