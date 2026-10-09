// "Continue to quick import without review" is a decision about ONE run, and it has to be cleared
// on the path that abandons the modal, not only on the path that consumes it.
//
// The flag is `_bulkAutoContinue`. It is consumed at the top of the review screen, which clears it
// with the comment "one run only; never a standing preference". That clear is correct and is not
// enough: ticking the box DURING the analyze is exactly what makes the run skip the review, so the
// consume site never executes and the flag lives on. The next import then opens with the box
// already ticked - an agreement to skip review that the user never made for that run.
//
// Found 2026-10-06 during the import-door walk, pressing shared tracks: "when I came back in the
// last selection in skip quick import was already checked... but hadn't checked this time."
//
// `closeModal` is where it belongs, beside the eject offer's reset, for the reason that reset
// gives: it is the abandon-everything path, so it covers the X, Esc and Done rather than living in
// one button's handler.

'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}

// closeModal's tail, identified by the run-state resets it already performs. Anchored on those
// rather than on a brace-matched body: this file's comments and template literals contain braces.
const CLOSE_TAIL = 'runInFlight = false;\n    _bulkPhase = null;';

ok('the close path was located', src.includes(CLOSE_TAIL),
   'anchor moved - every check below is about this stretch of code');

{
  const i = src.indexOf(CLOSE_TAIL);
  const tail = i >= 0 ? src.slice(i, i + 1400) : '';
  ok('closing the modal clears the quick-import choice',
     /_bulkAutoContinue = false;/.test(tail),
     'without this the choice outlives its run, and the next import opens pre-agreed to skip the '
     + 'review');
  ok('and it clears the eject offer in the same place',
     /ejectOffer = \{ available: false/.test(src.slice(Math.max(0, i - 1400), i)),
     'both are per-run promises and they are reset together on purpose');
}

// The consume site stays. It is what makes the box act once WITHIN a run; the close-path clear is
// what stops it leaking BETWEEN runs. Removing either one reintroduces a different bug.
ok('the consume site still clears it after auto-starting',
   /if \(_bulkAutoContinue && els\.startBtn && !els\.startBtn\.disabled\) \{\s*\n\s*_bulkAutoContinue = false;/
     .test(src),
   'without this a single tick would auto-start every subsequent review in the same run');

// Only the flag is reset on the close path. showPhase seeds the checkbox FROM the flag, so
// clearing the DOM as well would be a second site for a one-place rule.
ok('the checkbox is seeded from the flag, not reset separately',
   /if \(els\.progAuto\) els\.progAuto\.checked = !!_bulkAutoContinue;/.test(src),
   'if this seeding goes away, clearing the flag no longer clears the box');

// ── The same invariant on the BACKUP RESTORE door ────────────────────────────
// Found the same night, from the same cause, on a different surface: "Eject when finished" is
// armed when the APPLY starts, which is several screens in. So the inspect phase, the compare
// phase and the three-way chooser all rendered whatever the previous restore left behind. He hit
// it on a second run - the box visible on "Comparing against your library…" and already ticked.
//
// An inherited tick is worse than an inherited control: it is a standing agreement to eject a card,
// made during a different operation, that the user never gave for this one.
{
  const i = src.indexOf('const _sfOpenImportBackup = async () => {');
  const door = i >= 0 ? src.slice(i, i + 1800) : '';
  ok('the backup restore door was located', door.length > 400, `${door.length} chars`);
  ok('it clears the eject offer at the door, before anything is shown',
     /_sfBackupEject = \{ available: false/.test(door),
     'arming at apply time is too late for every screen before it');
  ok('and it unticks the box, not just hides it',
     /bkEjectBox\.checked = false/.test(door),
     'hiding a ticked box leaves the agreement in place for the next screen that shows it');
  ok('the unmeasured phases hide the offer too',
     /if \(els\.bkEjectWrap\) els\.bkEjectWrap\.style\.display = 'none';/.test(src),
     'inspect and compare happen before any choice exists, so there is nothing to eject after yet');
}

// ── ⚠️ THE CONTROL ───────────────────────────────────────────────────────────
// Remove the close-path clear in a COPY of the source and confirm the check rejects it. A scan
// that reports clean is indistinguishable from one that cannot see its subject.
{
  const broken = src.replace(/\n *_bulkAutoContinue = false;\n *\};/, '\n  };');
  ok('the mutation was applied', broken !== src,
     'anchor moved - the control below proves nothing without it');
  const i = broken.indexOf(CLOSE_TAIL);
  const tail = i >= 0 ? broken.slice(i, i + 1400) : '';
  ok('⚠️ a close path that does not clear the choice IS rejected',
     !/_bulkAutoContinue = false;/.test(tail),
     'the check cannot see the original defect, so its clean verdict means nothing');
}

console.log('');
console.log(fail === 0
  ? `bulk-run-choice-does-not-persist: all ${pass} checks passed`
  : `bulk-run-choice-does-not-persist: ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
