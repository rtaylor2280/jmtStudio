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
eq('SLOW_WRITE_MIN_BYTES is 60 MB', D.SLOW_WRITE_MIN_BYTES, 60 * 1024 * 1024);
// ⚠️⚠️ THE FILE-COUNT THRESHOLD IS GONE (2026-10-04) AND THIS ASSERTS ITS ABSENCE.
// Removed on measurement: an 18 MB set of 200+ files is not slow on a board card. A
// constant left exported would be re-wired by the next person who reads the old argument
// about per-file round trips, so the export surface has to stay clean of it.
eq('SLOW_WRITE_MIN_FILES is no longer exported', D.SLOW_WRITE_MIN_FILES, undefined);

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

const rBytes = grab('SF_SLOW_WRITE_MIN_BYTES');
ok('renderer declares SF_SLOW_WRITE_MIN_BYTES', rBytes !== null);
eq('renderer byte threshold matches the module', rBytes, D.SLOW_WRITE_MIN_BYTES);
// ⚠️ The renderer's copy of the dead constant has to go too, or the next reader finds a
// declared threshold and wires it back into a comparison.
ok('renderer no longer declares a file threshold',
   grab('SF_SLOW_WRITE_MIN_FILES') === null);
// ⚠️⚠️ AND NO COMPARISON AGAINST A FILE COUNT MAY SURVIVE ANYWHERE IN THE RENDERER. Deleting
// the constant is not enough - the two call sites compared `files >= …` and a bare literal
// would read as correct.
// ⚠️ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT TIDINESS. The first cut of this check ran
// over the raw file and failed on a COMMENT three hundred lines away that described the old
// two-limb rule in backticks. That is the same false positive this file's main.js sweep
// already documents ("`now - last >= 150` progress throttles"), reproduced one axis over: an
// instrument that reads prose is answering a question about documentation, not about code.
// ⭐ The comment it found WAS stale and was corrected - but it must not be what decides
// whether this assertion passes.
const htmlCode = html.replace(/^\s*\/\/.*$/gm, '');
ok('renderer compares no file count against a slow-write limit',
   !/files\s*>=\s*(SF_SLOW_WRITE_MIN_FILES|\d{2,})/.test(htmlCode));

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

// ── isSlowWriteJob: BYTES ONLY ────────────────────────────────────────
//
// ⚠️⚠️ THE SECOND ASSERTION IS THE ONE THAT MATTERS, AND IT IS WRITTEN TO FAIL ON THE OLD
// CODE. It used to read `ok('file count alone trips it', D.isSlowWriteJob(150, 0))`. The rule
// inverted on 2026-10-04, so the assertion inverts with it - and a case far above the old
// limit is used deliberately, because an assertion that merely stopped mentioning the count
// would pass whether the limb was removed or not.
ok('under the limit is not slow',            !D.isSlowWriteJob(10, 1024));
ok('⭐ a huge file count alone does NOT trip it', !D.isSlowWriteJob(10000, 0));
ok('bytes alone trip it',                     D.isSlowWriteJob(1, 60 * 1024 * 1024));
ok('one byte under does not',                !D.isSlowWriteJob(0, 60 * 1024 * 1024 - 1));
// ⭐ His measured case, asserted as itself so the regression has a name rather than a number:
// 18 MB across 200+ files is not slow, and 100 MB is.
ok('⭐ 18 MB / 220 files is not slow',       !D.isSlowWriteJob(220, 18 * 1024 * 1024));
ok('⭐ 100 MB / 5 files is slow',             D.isSlowWriteJob(5, 100 * 1024 * 1024));
ok('garbage reads as not slow',              !D.isSlowWriteJob(null, undefined));

// ── isSlowCleanupJob: KEEPS BOTH LIMBS, AND THAT IS DELIBERATE ────────
//
// ⚠️⚠️ SPLIT OUT OF `isSlowWriteJob` ON 2026-10-04. The write warning went bytes-only on
// measurement; the cleanup OFFER is about how long a DELETE takes, which is per-file round
// trips across a board's USB bridge. Sharing one function would have turned the offer into an
// unconditional delete for its founding case: a cancelled export leaving a few hundred small
// files on a card. ⚠️ This preserves dev-tested export behaviour EXACTLY - it is not a new
// rule, and the delete cost has never actually been measured (see exportDestination.js).
eq('SLOW_CLEANUP_MIN_FILES is 150', D.SLOW_CLEANUP_MIN_FILES, 150);
ok('⭐ cleanup still trips on count alone',   D.isSlowCleanupJob(150, 0));
ok('cleanup trips on bytes alone',            D.isSlowCleanupJob(1, 60 * 1024 * 1024));
ok('one under the cleanup count does not',   !D.isSlowCleanupJob(149, 0));
ok('cleanup garbage reads as not slow',      !D.isSlowCleanupJob(null, undefined));
// ⭐ THE PAIR THAT PROVES THEY ARE DIFFERENT QUESTIONS. Same job, opposite answers: a
// cancelled export of 200 small wavs is not slow to WRITE and is slow to REMOVE.
ok('⭐ 200 files / 18 MB: write not slow',   !D.isSlowWriteJob(200, 18 * 1024 * 1024));
ok('⭐ 200 files / 18 MB: cleanup IS slow',   D.isSlowCleanupJob(200, 18 * 1024 * 1024));

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
