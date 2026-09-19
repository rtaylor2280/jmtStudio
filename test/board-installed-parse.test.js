// parseBoardInstalled + parseBoardReplied - serial-buffer tests.  [B-417]
//
// WHY THIS FILE EXISTS. Until 2026-09-19 NOTHING exercised parseBoardInstalled,
// and it had been wrong for as long as ProffieOS 7.x has existed: it required a
// capitalised `Installed:`, which only 6.9 prints. 7.7, 7.15 and 8.10 all print
// `installed:` in lower case, so the build date silently resolved to null on every
// modern board. board-version-parse.test.js covers the version half and stops
// there, which is exactly how a whole function goes unread for a year.
//
// The two failure modes below are the ones that actually happened on his bench,
// and they pull in OPPOSITE directions - which is why both are pinned here:
//   1. Too loose: under /m, `$` matches end-of-STRING as well as end-of-line, so a
//      buffer cut mid-date matched and returned a truncated value. The probe then
//      finished on it, because a truthy date ends the wait. Seen as
//      "built Sep 19 2026 10." in the tooltip.
//   2. Too eager: requiring the terminating newline fixed (1), and then the
//      unrecognised-reply path - which finishes as soon as `buttons:` arrives -
//      started reporting NO date at all, because `installed:` is the last line of
//      the reply and its newline lands in a later chunk. Fixed with a grace window
//      in the probe, but the parser contract is what this file pins.
//
// Same lifting trick as board-version-parse.test.js: the real source is pulled out
// of main.js at test time, so these cannot drift away from what ships.
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
function lift(name) {
  const m = src.match(new RegExp('^function ' + name + '\\(buf\\) \\{[\\s\\S]*?^\\}', 'm'));
  if (!m) {
    console.error('FAIL: could not find ' + name + ' in main.js - was it renamed?');
    process.exit(1);
  }
  return vm.runInNewContext(m[0] + '\n' + name);
}
const parseBoardInstalled  = lift('parseBoardInstalled');
const parseBoardReplied    = lift('parseBoardReplied');
const parseBoardVersionRaw = lift('parseBoardVersionRaw');

// What ProffieOS 8.10 actually prints. CRLF, because that is what a board sends.
const REPLY_810 =
  'v8.10\r\nmy_config.h\r\nprop: SaberFett263Buttons\r\nbuttons: 2\r\n' +
  'installed: Sep 19 2026 10:13:13\r\n';

// 6.9: capitalised, and no CONFIG_FILE/prop/buttons lines at all.
const REPLY_69 = 'v6.9\r\nInstalled: Aug 19 2026 10:29:12\r\n';

// The real board read on his bench 2026-09-19 - firmware built from a git
// checkout, so a git ident string sits where a version belongs.
const REPLY_ID =
  '$Id: ce12a06a1e236b5101ec60c950530a9a4719a74d $\r\n' +
  'config/default_proffieboard_config.h\r\nprop: Saber\r\nbuttons: 2\r\n' +
  'installed: Mar 30 2023 03:03:48\r\n';

const installedCases = [
  ['8.10 lower-case installed:',      REPLY_810,                    'Sep 19 2026 10:13:13'],
  ['6.9 capitalised Installed:',      REPLY_69,                     'Aug 19 2026 10:29:12'],
  ['the real $Id board',              REPLY_ID,                     'Mar 30 2023 03:03:48'],
  ['LF-only line endings',            REPLY_810.replace(/\r/g, ''), 'Sep 19 2026 10:13:13'],

  // (1) TRUNCATION. Every one of these is a buffer cut inside the date, which is
  // an ordinary chunk boundary. A partial line must yield null so the caller waits
  // rather than committing to half a value.
  ['cut mid-date, no newline yet',    REPLY_810.slice(0, REPLY_810.length - 12), null],
  ['cut right after the hour',        'installed: Sep 19 2026 10',              null],
  ['cut with the CR but not the LF',  'installed: Sep 19 2026 10:13:13\r',      null],
  ['complete line, nothing after it', 'installed: Sep 19 2026 10:13:13\r\n',    'Sep 19 2026 10:13:13'],

  ['no installed line at all',        'v8.10\r\nmy_config.h\r\n',   null],
  ['empty buffer',                    '',                           null],
];

const repliedCases = [
  ['8.10 reply',                      REPLY_810,                    true],
  ['the real $Id board',              REPLY_ID,                     true],
  ['reply buried in chatter',         'EVENT: Clash\r\n'.repeat(20) + REPLY_ID, true],
  // Must NOT fire on ordinary board noise - this gate decides whether a silent
  // board is reported as silent, so a false positive hides a real timeout.
  ['battery chatter',                 '3.85\r\nvolts\r\n',          false],
  ['preset index chatter',            '2.0\r\nEVENT: Clash\r\n',    false],
  ['prop with no buttons',            'prop: Saber\r\n',            false],
  ['buttons with no prop',            'buttons: 2\r\n',             false],
  ['empty buffer',                    '',                           false],
];

const rawCases = [
  ['$Id string quoted back', REPLY_ID, '$Id: ce12a06a1e236b5101ec60c950530a9a4719a74d $'],
  ['ordinary version line',  REPLY_810, 'v8.10'],
  ['no config-file line',    'v8.10\r\n', null],
];

let failed = 0;
const run = (label, cases, fn) => {
  for (const [name, input, expected] of cases) {
    const got = fn(input);
    const ok  = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${name}` +
      (ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`));
  }
};
run('installed', installedCases, parseBoardInstalled);
run('replied',   repliedCases,   parseBoardReplied);
run('raw',       rawCases,       parseBoardVersionRaw);

const total = installedCases.length + repliedCases.length + rawCases.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
