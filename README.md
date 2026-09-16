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

Every site above is listed once, in [`sites.js`](sites.js).

## Adding a Site

`sites.js` is the only place the tracked-site list is written down. Add an entry
there:

```js
{
  name: 'Mastodon',
  hosts: ['mastodon.social'],
  // Optional. Only sites with a `feed` block get the feed gate; the rest are
  // timed but never hidden.
  feed: {
    selectors: ['[data-column="home"]', 'main'],
    skip: /^\/conversations/,
  },
},
```

Then regenerate the copies that are derived from it:

```
npm run sync
```

That rewrites the content script `matches` in `manifest.json` and the Supported
Sites list above. `feedgate.js` needs no change — it reads `sites.js` at
runtime.

Check your work with:

```
npm test
```

which fails if `manifest.json` or `README.md` has drifted from `sites.js`, and
runs the feed gate against a fake DOM to confirm each site still gates (or stays
open) the way it should. CI runs the same command.

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
