# Social Media Time Tracker

Social Media Time Tracker is a Chrome extension that shows a small timer overlay while you use supported social media sites. It tracks the current session, total time today, and today's visit count.

## Supported Sites

- Twitter / X
- Threads
- Instagram
- Facebook
- Messenger
- LinkedIn
- YouTube
- Bluesky
- Reddit
- Hacker News

## Stored Data

Everything the extension records lives in `chrome.storage.local`. Time is in
seconds, and each site is keyed by its hostname without a leading `www.`:

- `sessionTime` / `dailyTime` — totals across all sites, shown in the overlay.
- `sessionSiteTime` / `dailySiteTime` — the same two clocks split per site.
- `dailyVisits` / `dailySiteVisits` — today's visit counts, in total and per site.
- `historicalData` — one record per day, keyed `YYYY-MM-DD`:
  `{ total, visits, sites: { "x.com": { time, visits } } }`. Today's record is
  kept up to date alongside past days.

Days recorded before per-site tracking are still readable: they were stored as
a bare number of seconds under a locale date string, and are read as a day with
that total and no per-site breakdown. Those day keys are re-keyed to
`YYYY-MM-DD` on first run.

## Daily and Per-Site Stats

Click the extension's toolbar icon to open the stats page. It shows, over the
last 7 days, the last 30 days, or all time:

- Total time, your average per active day, your busiest day, and visit count.
- A **By site** breakdown ranking the sites you spent the most time on.
- A **By day** list, one row per day, where the bar length is that day's total
  and the bands inside it split the day between sites.

The page reads whatever the timer has already saved, so it fills in as you use
the tracked sites. Days recorded before per-site tracking existed still show
their total, labelled as unsplit.

## Tests

```
npm test
```

Node's built-in test runner, no dependencies. `tests/` covers the day and site
bookkeeping in `background.js` and the aggregation in `stats.js`.

## Install From the Chrome Web Store

Install the extension from the Chrome Web Store:

https://chromewebstore.google.com/detail/social-media-time-tracker/ddkakojdiofppdcoeoncfgbpfblbknhh

## Install Unpacked

You can also install the extension locally as an unpacked Chrome extension:

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder.

Chrome will load the extension from the local files. If you make changes, return to `chrome://extensions` and click the extension's reload button.
