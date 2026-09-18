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
that total and no per-site breakdown.

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
