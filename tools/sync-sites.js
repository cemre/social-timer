#!/usr/bin/env node
// tools/sync-sites.js — keeps the generated copies of the site list in step
// with sites.js.
//
//   node tools/sync-sites.js          check only, exits 1 on drift
//   node tools/sync-sites.js --write  rewrite the generated sections
//
// Generated from sites.js:
//   manifest.json  content_scripts[].matches
//   README.md      the bullet list under "## Supported Sites"
//
// feedgate.js is not listed here: it reads sites.js at runtime, so there is
// nothing to generate for it.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { SOCIAL_TIMER_SITES, socialTimerMatchPattern } = require(path.join(root, 'sites.js'));

const MANIFEST = path.join(root, 'manifest.json');
const README = path.join(root, 'README.md');

const expectedMatches = SOCIAL_TIMER_SITES.flatMap(
  site => site.hosts.map(host => socialTimerMatchPattern(site, host))
);
const expectedNames = SOCIAL_TIMER_SITES.map(site => site.name);

// --- manifest.json ----------------------------------------------------------
// Rewritten by patching the `matches` array in place rather than round-tripping
// the whole file through JSON.stringify, so the hand-written formatting of
// everything else survives untouched.

const MATCHES_RE = /("matches"\s*:\s*)\[[^\]]*\]/;

function readManifestMatches(text) {
  const manifest = JSON.parse(text);
  const scripts = manifest.content_scripts || [];
  if (scripts.length !== 1) {
    throw new Error(
      `expected exactly one content_scripts entry in manifest.json, found ${scripts.length}`
    );
  }
  return scripts[0].matches || [];
}

function renderManifest(text) {
  const match = text.match(MATCHES_RE);
  if (!match) throw new Error('could not find a "matches" array in manifest.json');

  // Match the indentation of the line the array starts on.
  const lineStart = text.lastIndexOf('\n', match.index) + 1;
  const indent = text.slice(lineStart, match.index).match(/^\s*/)[0];
  const items = expectedMatches.map(p => `${indent}  ${JSON.stringify(p)}`).join(',\n');

  return text.replace(MATCHES_RE, `$1[\n${items}\n${indent}]`);
}

// --- README.md --------------------------------------------------------------

const README_RE = /(## Supported Sites\n\n)(?:- .*\n)+/;

function readReadmeNames(text) {
  const match = text.match(README_RE);
  if (!match) throw new Error('could not find the "## Supported Sites" list in README.md');
  return match[0]
    .split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim());
}

function renderReadme(text) {
  if (!README_RE.test(text)) {
    throw new Error('could not find the "## Supported Sites" list in README.md');
  }
  const list = expectedNames.map(name => `- ${name}`).join('\n');
  return text.replace(README_RE, `$1${list}\n`);
}

// --- driver -----------------------------------------------------------------

const targets = [
  {
    label: 'manifest.json',
    file: MANIFEST,
    describe: 'content script matches',
    actual: readManifestMatches,
    expected: expectedMatches,
    render: renderManifest,
  },
  {
    label: 'README.md',
    file: README,
    describe: 'Supported Sites list',
    actual: readReadmeNames,
    expected: expectedNames,
    render: renderReadme,
  },
];

const write = process.argv.includes('--write');
let drifted = 0;

for (const target of targets) {
  const text = fs.readFileSync(target.file, 'utf8');
  const actual = target.actual(text);
  const inSync = JSON.stringify(actual) === JSON.stringify(target.expected);

  if (inSync) {
    console.log(`ok    ${target.label} — ${target.describe} matches sites.js`);
    continue;
  }

  drifted++;

  if (write) {
    const next = target.render(text);
    // Re-read through the same parser so --write can never emit something
    // --check would then reject.
    if (JSON.stringify(target.actual(next)) !== JSON.stringify(target.expected)) {
      throw new Error(`rewrite of ${target.label} did not produce the expected list`);
    }
    fs.writeFileSync(target.file, next);
    console.log(`wrote ${target.label} — ${target.describe} regenerated from sites.js`);
    continue;
  }

  console.error(`DRIFT ${target.label} — ${target.describe} does not match sites.js`);
  for (const item of target.expected.filter(x => !actual.includes(x))) {
    console.error(`        missing: ${item}`);
  }
  for (const item of actual.filter(x => !target.expected.includes(x))) {
    console.error(`        unexpected: ${item}`);
  }
  if (target.expected.every(x => actual.includes(x)) && actual.length === target.expected.length) {
    console.error('        same entries, different order');
  }
}

if (!drifted) {
  console.log(`\n${SOCIAL_TIMER_SITES.length} sites, everything in sync.`);
} else if (!write) {
  console.error('\nRun `node tools/sync-sites.js --write` to regenerate.');
  process.exit(1);
}
