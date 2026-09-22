// One threshold, four readers.  [B-238, B-005 item 4]
//
// ⚠️⚠️ THIS TEST EXISTS BECAUSE A COMMENT CLAIMED THE LINK AND NOTHING ENFORCED IT.
// main.js:3581 carried the literal `_bFiles >= 150 || _bTotal >= 60 * 1024 * 1024` under a
// comment reading "deliberately read from the SAME constants the renderer uses, so the two
// can never drift apart." Nothing connected them; they were two hardcoded copies plus a
// third in another handler plus named constants in the renderer. Every one would have gone
// on agreeing right up until somebody changed one.
//
// The renderer cannot require() a main-side module, so its constants stay declared inline
// and THIS is what keeps them honest - a check that FAILS on drift rather than a rule
// somebody has to remember. Same shape as the producer/consumer reconciliation that found a
// fourth wiring bug on 2026-09-05: where a rule spans callers, write the reconciliation.
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('../exportDestination');

let failed = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}` +
    (ok ? '' : `\n        expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`));
};
const ok = (name, cond) => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
};

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ── The module is the definition ─────────────────────────────────────
eq('SLOW_WRITE_MIN_FILES is 150', D.SLOW_WRITE_MIN_FILES, 150);
eq('SLOW_WRITE_MIN_BYTES is 60 MB', D.SLOW_WRITE_MIN_BYTES, 60 * 1024 * 1024);

// ── The renderer's inline copies must match it ───────────────────────
//
// ⚠️ Parsed out of the source rather than imported: index.html is the renderer and cannot
// be required. The regex is anchored on the const name, so a rename fails loudly here
// instead of silently matching nothing and passing.
const html = read('renderer/index.html');
const grab = (name) => {
  const m = html.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  if (!m) return null;
  try { return Function(`"use strict"; return (${m[1]});`)(); } catch { return null; }
};

const rFiles = grab('SF_SLOW_WRITE_MIN_FILES');
const rBytes = grab('SF_SLOW_WRITE_MIN_BYTES');
ok('renderer declares SF_SLOW_WRITE_MIN_FILES', rFiles !== null);
ok('renderer declares SF_SLOW_WRITE_MIN_BYTES', rBytes !== null);
eq('renderer file threshold matches the module', rFiles, D.SLOW_WRITE_MIN_FILES);
eq('renderer byte threshold matches the module', rBytes, D.SLOW_WRITE_MIN_BYTES);

// ── No main-side literals left ───────────────────────────────────────
//
// ⚠️ THE POINT OF THE SWEEP, NOT A STYLE RULE. Two handlers carried this test's whole
// reason for existing. If a new door is written by copying an old one, the literal comes
// with it and the copy is invisible to the check above - so the check has to look for the
// SHAPE as well as compare the values.
// ⚠️ ANCHOR ON THE BYTE LITERAL, NOT ON `>= 150`. The first cut of this check matched
// `>= 150 ||` and reported three violations that were all `now - last >= 150` progress
// throttles - an instrument answering the question next to the one asked. `60 * 1024 *
// 1024` appears nowhere else in main.js and is the half of the pair that cannot be
// confused with a timing constant.
const main = read('main.js');
const literals = main.match(/60\s*\*\s*1024\s*\*\s*1024/g) || [];
ok(`main.js carries no inline slow-write byte threshold (found ${literals.length})`,
   literals.length === 0);
// ⚠️ THIS USED TO REQUIRE `isSlowTransport` IN main.js AND THAT IS NOW THE WRONG SHAPE.
// The board-card test moved INSIDE `preflight()`, which is the point of the refactor - main
// asks one question instead of composing two. A test demanding the old composition would
// have pushed the code back toward the duplication it just removed.
ok('main.js reads the threshold through the module',
   /isSlowWriteJob\s*\(/.test(main),
   'the classify gate still needs it - it decides whether to pay the device lookup at all');
ok('⭐ main.js asks ONE preflight rather than composing fit + transport itself',
   /exportDestination'\)\.preflight\(/.test(main),
   'two separate calls is how the board-card test came to exist in three places');
ok('main.js no longer runs its own transport test',
   !/isSlowTransport\s*\(/.test(main),
   'that decision belongs inside preflight now; a second copy here is the old bug');

// ── isSlowWriteJob: either limb, never both ──────────────────────────
ok('under both limbs is not slow',        !D.isSlowWriteJob(10, 1024));
ok('file count alone trips it',            D.isSlowWriteJob(150, 0));
ok('bytes alone trip it',                  D.isSlowWriteJob(1, 60 * 1024 * 1024));
ok('one under the file limb does not',    !D.isSlowWriteJob(149, 0));
ok('one byte under does not',             !D.isSlowWriteJob(0, 60 * 1024 * 1024 - 1));
ok('garbage reads as not slow',           !D.isSlowWriteJob(null, undefined));

// ── isSlowTransport: his 2026-09-20 ruling ───────────────────────────
//
// "if we can't tell, then we assume it's not card through proffie. it's only card through
// proffie that's the long part."
ok('proffieboard is slow',      D.isSlowTransport('proffieboard'));
ok('card-reader is NOT slow',  !D.isSlowTransport('card-reader'));
ok('card-slot is NOT slow',    !D.isSlowTransport('card-slot'));
ok('usb-storage is NOT slow',  !D.isSlowTransport('usb-storage'));
ok('null (cannot tell) is NOT slow', !D.isSlowTransport(null));
ok('undefined is NOT slow',    !D.isSlowTransport(undefined));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
