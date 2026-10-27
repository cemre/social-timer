// analytics.js — renders the per-day / per-site breakdown from what the
// background timer has stored. All the number crunching lives in stats.js.
(function () {
  const S = SocialStats;

  const el = id => document.getElementById(id);
  const ui = {
    caption: el('caption'), notice: el('notice'), blank: el('blank'), content: el('content'),
    range: el('range'), heroLabel: el('hero-label'), heroValue: el('hero-value'),
    heroNote: el('hero-note'), average: el('stat-average'), busiest: el('stat-busiest'),
    busiestNote: el('stat-busiest-note'), visits: el('stat-visits'),
    visitsNote: el('stat-visits-note'), sites: el('sites'), legend: el('legend'),
    days: el('days'), tip: el('tip')
  };

  const RANGE_LABELS = { 7: 'Last 7 days', 30: 'Last 30 days', 0: 'All time' };
  let rangeDays = 7;
  let days = [];
  let palette = null;

  function colorFor(key) {
    if (key === S.UNTRACKED_KEY) return 'var(--series-untracked)';

    const slot = palette.slotFor(key);
    return slot ? `var(--series-${slot})` : 'var(--series-other)';
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function swatch(key) {
    const node = make('span', 'swatch');
    node.style.background = colorFor(key);
    return node;
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function share(part, whole) {
    return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';
  }

  // Real sites first by time, with the unsplit remainder pinned to the end —
  // it is a gap in the data, not a site that was visited.
  function ordered(sites) {
    const real = sites.filter(s => s.key !== S.UNTRACKED_KEY);
    const rest = sites.filter(s => s.key === S.UNTRACKED_KEY);
    return real.concat(rest);
  }

  /* ---- tooltip ---- */

  function showTip(target, lines) {
    ui.tip.textContent = '';
    ui.tip.append(make('b', null, lines[0]));
    if (lines[1]) {
      ui.tip.append(document.createElement('br'));
      ui.tip.append(document.createTextNode(lines[1]));
    }
    ui.tip.hidden = false;

    const box = target.getBoundingClientRect();
    const tip = ui.tip.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, box.left + box.width / 2 - tip.width / 2),
      window.innerWidth - tip.width - 8
    );
    const above = box.top - tip.height - 8;
    ui.tip.style.left = `${left}px`;
    ui.tip.style.top = `${above > 8 ? above : box.bottom + 8}px`;
  }

  function hideTip() {
    ui.tip.hidden = true;
  }

  function withTip(node, lines) {
    node.addEventListener('mouseenter', () => showTip(node, lines));
    node.addEventListener('mouseleave', hideTip);
    return node;
  }

  /* ---- sections ---- */

  function renderSummary(summary) {
    const label = RANGE_LABELS[rangeDays];
    ui.caption.textContent = summary.activeDays
      ? `${label} · ${plural(summary.activeDays, 'day')} with activity`
      : label;

    ui.heroLabel.textContent = `Total, ${label.toLowerCase()}`;
    ui.heroValue.textContent = S.formatDuration(summary.total);
    ui.heroNote.textContent = summary.sites.length
      ? `Across ${plural(summary.sites.filter(s => s.key !== S.UNTRACKED_KEY).length, 'site')}`
      : '';

    ui.average.textContent = S.formatDuration(summary.average);

    if (summary.busiest) {
      ui.busiest.textContent = S.formatDuration(summary.busiest.total);
      ui.busiestNote.textContent = summary.busiest.label;
    } else {
      ui.busiest.textContent = '—';
      ui.busiestNote.textContent = '';
    }

    if (summary.visits === null) {
      ui.visits.textContent = '—';
      ui.visitsNote.textContent = 'Not recorded for these days';
    } else {
      ui.visits.textContent = String(summary.visits);
      ui.visitsNote.textContent = summary.total
        ? `About ${S.formatDuration(Math.round(summary.total / Math.max(1, summary.visits)))} per visit`
        : '';
    }
  }

  function renderSites(summary) {
    ui.sites.textContent = '';
    const sites = ordered(summary.sites);
    const longest = sites.reduce((max, s) => Math.max(max, s.seconds), 0);

    sites.forEach(site => {
      const name = make('div', 'sites__name');
      name.append(swatch(site.key), make('span', null, site.label));

      const track = make('div', 'sites__track');
      const fill = make('div', 'sites__fill');
      fill.style.width = share(site.seconds, longest);
      fill.style.background = colorFor(site.key);
      track.append(fill);

      const value = make('div', 'sites__value');
      value.append(make('b', null, S.formatDuration(site.seconds)));
      value.append(document.createTextNode(` · ${share(site.seconds, summary.total)}`));

      const tip = [site.label, site.visits
        ? `${S.formatDuration(site.seconds)} over ${plural(site.visits, 'visit')}`
        : S.formatDuration(site.seconds)];
      [name, track, value].forEach(node => withTip(node, tip));

      ui.sites.append(name, track, value);
    });
  }

  function renderLegend(summary) {
    ui.legend.textContent = '';

    // Every band that can appear in the bars below, so identity never rests
    // on colour alone. Same order as the panel above, longest first.
    const seen = new Map();
    summary.sites.forEach(site => {
      const key = palette.barKeyFor(site.key);
      if (!seen.has(key)) {
        seen.set(key, key === site.key ? site.label : S.siteLabel(key));
      }
    });

    ordered(Array.from(seen, ([key, label]) => ({ key, label }))).forEach(band => {
      const item = make('div', 'legend__item');
      item.append(swatch(band.key), make('span', null, band.label));
      ui.legend.append(item);
    });
  }

  function renderDays(summary) {
    ui.days.textContent = '';

    // Bar length is the day's share of the busiest day in range, so the rows
    // compare against each other instead of every day filling the width.
    const peak = summary.days.reduce((max, d) => Math.max(max, d.total), 0);

    summary.days.forEach(day => {
      const row = make('div', 'day');

      const head = make('div', 'day__head');
      head.append(make('span', 'day__label', day.label));

      const total = make('span', 'day__total');
      total.append(make('b', null, S.formatDuration(day.total)));
      if (day.visits) total.append(document.createTextNode(` · ${plural(day.visits, 'visit')}`));
      head.append(total);

      // One band per colour slot: sites past the slots share "Other" here and
      // are still named individually in the chips underneath.
      const bands = new Map();
      day.sites.forEach(site => {
        const key = palette.barKeyFor(site.key);
        const band = bands.get(key) || { key, label: key === site.key ? site.label : S.siteLabel(key), seconds: 0, visits: 0 };
        band.seconds += site.seconds;
        band.visits += site.visits;
        bands.set(key, band);
      });

      const track = make('div', 'track');
      const bar = make('div', 'bar');
      bar.style.width = share(day.total, peak);
      track.append(bar);

      ordered(Array.from(bands.values()).sort((a, b) => b.seconds - a.seconds)).forEach(band => {
        if (band.seconds <= 0) return;

        const seg = make('span', 'bar__seg');
        seg.style.flexGrow = String(band.seconds);
        seg.style.background = colorFor(band.key);
        bar.append(withTip(seg, [
          band.label,
          `${S.formatDuration(band.seconds)} · ${share(band.seconds, day.total)} of ${day.label.toLowerCase()}`
        ]));
      });

      const chips = make('div', 'day__chips');
      ordered(day.sites).forEach(site => {
        const chip = make('div', 'chip');
        chip.append(swatch(palette.barKeyFor(site.key)));
        chip.append(make('span', null, site.label));
        chip.append(make('span', 'chip__value', S.formatDuration(site.seconds)));
        if (site.visits) chip.append(make('span', null, `· ${plural(site.visits, 'visit')}`));
        chips.append(chip);
      });

      row.append(head, track, chips);
      ui.days.append(row);
    });
  }

  function render() {
    Array.from(ui.range.children).forEach(btn => {
      btn.classList.toggle('is-active', Number(btn.dataset.range) === rangeDays);
    });

    hideTip();

    if (!days.length) {
      ui.blank.hidden = false;
      ui.content.hidden = true;
      ui.caption.textContent = '';
      return;
    }

    const summary = S.summarize(days, rangeDays || null, new Date());
    ui.blank.hidden = true;
    ui.content.hidden = false;

    // Days recorded before per-site tracking existed carry a total with no
    // split; say so rather than letting the grey band look like a real site.
    const unsplit = summary.days.some(d => d.sites.some(s => s.key === S.UNTRACKED_KEY));
    ui.notice.hidden = !unsplit;
    ui.notice.textContent = unsplit
      ? `Days before per-site tracking started show their total as “${S.siteLabel(S.UNTRACKED_KEY)}”.`
      : '';

    renderSummary(summary);
    renderSites(summary);
    renderLegend(summary);
    renderDays(summary);
  }

  async function load() {
    let stored = {};
    try {
      stored = await chrome.storage.local.get(null);
    } catch (e) {
      console.error('Failed to read stored timer data:', e);
      ui.notice.hidden = false;
      ui.notice.textContent = 'Could not read the saved timer data.';
      return;
    }

    days = S.buildDays(stored, new Date());
    palette = S.buildPalette(days);
    render();
  }

  ui.range.addEventListener('click', event => {
    const btn = event.target.closest('.range__btn');
    if (!btn) return;

    rangeDays = Number(btn.dataset.range);
    render();
  });

  // The timer keeps writing while this tab is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') load();
  });

  window.addEventListener('scroll', hideTip, { passive: true });

  load();
})();
