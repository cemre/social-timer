// feedgate.js — hides the feed on scroll-trap sites, revealed in 2-minute windows.
// Independent of the time-tracker in content.js.
(function () {
  const WINDOW_MS = 2 * 60 * 1000;   // 2-minute reveal window
  const COOLDOWN_MS = 30 * 1000;     // 30-second lockout after a window
  const TICK_MS = 500;

  // hostname -> { feed: ordered feed selectors (first match wins),
  //              skip: RegExp of pathnames where the gate must NOT run }.
  // Fail-open: if no selector matches, the gate does nothing rather than
  // breaking the page. `skip` keeps DMs reachable — the feed selectors on
  // these sites also cover the DM view, and we don't want to gate that.
  const SITE_CONFIG = {
    'twitter.com':  { feed: ['[aria-label^="Timeline"]', '[data-testid="primaryColumn"]'], skip: /^\/(messages|i\/chat)/ },
    'x.com':        { feed: ['[aria-label^="Timeline"]', '[data-testid="primaryColumn"]'], skip: /^\/(messages|i\/chat)/ },
    'threads.com':  { feed: ['[role="region"]', '[role="main"]'], skip: /^\/messages/ },
    'threads.net':  { feed: ['[role="region"]', '[role="main"]'], skip: /^\/messages/ },
    'reddit.com':   { feed: ['shreddit-feed', 'shreddit-comment-tree', '#siteTable', 'main'] },
    'instagram.com':{ feed: ['main[role="main"]'], skip: /^\/direct/ },
    'facebook.com': { feed: ['[role="feed"]', '[role="main"]'] },
  };

  const host = location.hostname.replace(/^www\./, '');
  const siteKey = Object.keys(SITE_CONFIG).find(k => host === k || host.endsWith('.' + k));
  if (!siteKey) return;

  const config = SITE_CONFIG[siteKey];
  const selectors = config.feed;
  const storeKey = 'feedgate:' + siteKey;

  // True on routes where the feed selector would also cover DMs etc.
  function isSkippedRoute() {
    return !!(config.skip && config.skip.test(location.pathname));
  }

  function unhideAll() {
    document.querySelectorAll('.feedgate-hidden')
      .forEach(el => el.classList.remove('feedgate-hidden'));
  }

  // Local cache of persisted timing, kept in sync across tabs via storage.onChanged.
  let state = { revealUntil: 0, cooldownUntil: 0 };
  let feedEl = null;
  let cardEl = null;
  let pillEl = null;

  const now = () => Date.now();

  function injectStyles() {
    if (document.getElementById('feedgate-styles')) return;
    const style = document.createElement('style');
    style.id = 'feedgate-styles';
    style.textContent = `
      .feedgate-hidden { visibility: hidden !important; }
      .feedgate-card {
        position: fixed;
        z-index: 2147483646;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: #fff;
        font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        text-align: center;
        padding: 22px 26px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.45);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        max-width: 320px;
      }
      .feedgate-card__msg { font-size: 15px; opacity: 0.9; line-height: 1.4; }
      .feedgate-card__btn {
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        color: #000;
        background: #fff;
        border: none;
        border-radius: 999px;
        padding: 10px 20px;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .feedgate-card__btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .feedgate-pill {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483646;
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        padding: 6px 12px;
        border-radius: 999px;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function findFeed() {
    // Return the first *visible* match. SPA navigation (e.g. Threads
    // home -> activity) can leave a stale 0x0 element matching the same
    // selector; picking it would hide nothing and mispositon the card.
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    return null;
  }

  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function ensureCard() {
    if (cardEl) return;
    injectStyles();
    cardEl = document.createElement('div');
    cardEl.className = 'feedgate-card';

    const msg = document.createElement('div');
    msg.className = 'feedgate-card__msg';
    msg.textContent = 'Feed hidden — take a breath';

    const btn = document.createElement('button');
    btn.className = 'feedgate-card__btn';
    btn.addEventListener('click', reveal);

    cardEl.append(msg, btn);
    cardEl._btn = btn;
    document.body.appendChild(cardEl);
  }

  function removeCard() {
    if (cardEl) { cardEl.remove(); cardEl = null; }
  }

  function ensurePill() {
    if (pillEl) return;
    injectStyles();
    pillEl = document.createElement('div');
    pillEl.className = 'feedgate-pill';
    document.body.appendChild(pillEl);
  }

  function removePill() {
    if (pillEl) { pillEl.remove(); pillEl = null; }
  }

  function positionCard() {
    if (!cardEl || !feedEl) return;
    const r = feedEl.getBoundingClientRect();
    const centerX = r.left + r.width / 2;
    cardEl.style.left = `${centerX}px`;
    cardEl.style.top = `${Math.max(r.top + 40, 90)}px`;
  }

  function reveal() {
    const revealUntil = now() + WINDOW_MS;
    state = { revealUntil, cooldownUntil: revealUntil + COOLDOWN_MS };
    chrome.storage.local.set({ [storeKey]: state });
    render(); // immediate feedback in this tab
  }

  function render() {
    // On DM routes, never gate — leave messages fully reachable.
    if (isSkippedRoute()) { removeCard(); removePill(); unhideAll(); return; }

    feedEl = findFeed();
    if (!feedEl) { removeCard(); removePill(); return; }

    const t = now();

    if (t < state.revealUntil) {
      // Revealed window is open.
      feedEl.classList.remove('feedgate-hidden');
      removeCard();
      ensurePill();
      pillEl.textContent = `${fmt(state.revealUntil - t)} left`;
      return;
    }

    // Blocked.
    removePill();
    feedEl.classList.add('feedgate-hidden');
    ensureCard();
    positionCard();

    const btn = cardEl._btn;
    if (t < state.cooldownUntil) {
      btn.disabled = true;
      btn.textContent = `Wait ${fmt(state.cooldownUntil - t)}`;
    } else {
      btn.disabled = false;
      btn.textContent = 'Show for 2 min';
    }
  }

  // Keep the local cache in sync with other tabs / windows.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[storeKey]) {
      state = changes[storeKey].newValue || { revealUntil: 0, cooldownUntil: 0 };
      render();
    }
  });

  // Boot: load persisted state, then drive everything from a single tick.
  chrome.storage.local.get(storeKey, obj => {
    state = obj[storeKey] || { revealUntil: 0, cooldownUntil: 0 };
    render();
    setInterval(render, TICK_MS);
  });

  window.addEventListener('scroll', positionCard, { passive: true });
  window.addEventListener('resize', positionCard);
})();
