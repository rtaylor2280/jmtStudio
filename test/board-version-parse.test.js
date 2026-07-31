// parseBoardVersion - synthetic serial-buffer tests.
//
// This function decides whether the OS Version field turns red, so a false
// positive is worse than no answer at all: it would tell a user their board
// disagrees with their build when it does not. The cases below are mostly about
// what must NOT match.
//
// Unlike flash-error.test.js, this does not mirror the function body - it lifts
// the real source out of main.js at test time, so the test cannot silently drift
// away from what ships. Requiring main.js directly would pull in electron.
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const m = src.match(/^function parseBoardVersion\(buf\) \{[\s\S]*?^\}/m);
if (!m) {
  console.error('FAIL: could not find parseBoardVersion in main.js - was it renamed?');
  process.exit(1);
}
const parseBoardVersion = vm.runInNewContext(m[0] + '\nparseBoardVersion');

// A real `version` reply, as ProffieOS.ino prints it: version, CONFIG_FILE,
// prop, buttons, installed. CRLF because that is what a board actually sends.
const REPLY =
  'version\r\n' +
  'v8.10\r\n' +
  'my_config.h\r\n' +
  'prop: SaberFett263Buttons\r\n' +
  'buttons: 2\r\n' +
  'installed: Jul 12 2026 21:04:11\r\n';

const cases = [
  ['real version reply (CRLF)',        REPLY,                                          'v8.10'],
  ['same reply with LF only',          REPLY.replace(/\r/g, ''),                       'v8.10'],
  ['boot banner',                      'Welcome to ProffieOS v8.10\r\n',               'v8.10'],
  ['banner without the v',             'Welcome to ProffieOS 7.15\r\n',                'v7.15'],
  ['point release with a suffix',      'v8.10a\r\nmy_config.h\r\n',                    'v8.10a'],
  ['CONFIG_FILE with a path',          'v7.14\r\nconfigs/liam.h\r\n',                  'v7.14'],

  // The reason the trailing .h line is required. A Proffieboard prints plenty of
  // bare decimals, and any of these matching would light the field red wrongly.
  ['bare battery reading on its own line', 'battery: 3.85\r\n3.85\r\nvolts\r\n',       null],
  ['preset index chatter',             'unit = 1\r\n2.0\r\nEVENT: Clash\r\n',          null],
  ['version line with nothing after it yet', 'v8.10\r\n',                              null],
  ['empty buffer',                     '',                                             null],
  ['pure noise',                       'I2C init...\r\nSD card found.\r\n',            null],

  // A flooding board (the charge-detect case) buries the reply in chatter. It
  // should still be found, because we match on shape and not on position.
  ['reply buried in a flood',
    'EVENT: Chg ON\r\n'.repeat(40) + REPLY + 'EVENT: Chg OFF\r\n'.repeat(40),          'v8.10'],

  // Chunked arrival: the version lands in one read and CONFIG_FILE in the next.
  // The first half must return null so the caller keeps waiting.
  ['first chunk alone',                'version\r\nv8.10\r',                            null],
  ['both chunks concatenated',         'version\r\nv8.10\r' + '\nmy_config.h\r\n',      'v8.10'],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  const got = parseBoardVersion(input);
  const ok  = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`));
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
