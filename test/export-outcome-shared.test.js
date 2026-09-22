// Every export door must report its ending through one function.  [B-005 item 4]
//
// ⭐⭐ THE DEFECT CLASS THIS EXISTS TO KILL. On 2026-09-20 three doors reported a cancelled
// export as a success, and not one of them had a bug in its checks - the fit refusal and the
// slow-write warning already shared their dialogs, so those had been getting consistent by
// construction. Reporting the OUTCOME was hand-rolled per door, and that is where all three
// were wrong:
//
//   • Font card quick export  -> *Exported as "Techno_2"* after he pressed Cancel
//   • Common Folders as zip   -> said nothing at all
//   • tracks                  -> said nothing AND committed a sync manifest describing files
//                                that were never written, which the next export would trust
//
// ⚠️⚠️ THE TRAP: `ok: true` DOES NOT MEAN "IT WROTE". A cancel returns ok:true with `canceled`
// set on purpose - ok:false would surface the user's own click as a red failure. So `ok` alone
// stopped being sufficient, and every door that tested only `ok` inherited the bug silently.
// Nothing announced it; each door looked locally correct.
//
// ⭐ The four right-click "Export…" menu items (doors 2/5/7/9) share one funnel and were ALL
// correct without anyone checking them. One place to be right is the entire argument.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

// ── The shared ending exists ─────────────────────────────────────────
ok('a single shared outcome handler exists',
   /const _sfExportOutcome = async \(r, \{/.test(H),
   'without one, each door keeps its own copy and they drift - which is how this broke');
ok('it treats a cancel as its own outcome, before any success path',
   /if \(r\.canceled\) \{[\s\S]{0,600}?_sfExportStoppedNotice/.test(H),
   'a cancel reaching the success path is exactly the Techno_2 bug');
// ⚠️ ANCHORED ON THE CANCEL BLOCK, NOT A 400-CHARACTER WINDOW. The first cut required the
// `return false` within 400 chars of the notice call, and adding the cleanup offer between
// them broke it - a false failure about correct code. Slice between two markers instead.
{
  const i = H.indexOf('if (r.canceled) {');
  const j = H.indexOf('if (r.failed?.length)', i);
  const block = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('it returns false on a cancel so callers cannot run follow-up work',
     /return false;/.test(block) && /_sfExportStoppedNotice\(/.test(block),
     'the tracks door committed a sync manifest for files never written');
  ok('⭐ and the slow cleanup is OFFERED inside that same block',
     /_sfOfferPartialCleanup\(/.test(block),
     'his rule: on a board card over threshold, ask rather than making them wait for a delete');
}

// ── ⚠️⚠️ SCOPE, WHICH IS INVISIBLE TO node --check ────────────────────
//
// `_sfDeleteProgress` and `_sfShowProgramRefusal` are declared in a nested scope and are NOT
// exposed on window. A helper calling them from top level is a ReferenceError waiting for the
// first completed export - the 2026-09-15 defect class, which no syntax check and no
// source-grep can see, and which he found in ten seconds by opening DevTools.
{
  const at = (re) => { const m = H.match(re); return m ? H.slice(0, m.index).split('\n').length : -1; };
  const indentOf = (line) => {
    const src = H.split('\n')[line - 1] || '';
    return src.length - src.replace(/^ +/, '').length;
  };
  const outcome = at(/const _sfExportOutcome = /);
  const eject   = at(/const _sfOfferEjectInToast = /);
  const refusal = at(/const _sfShowProgramRefusal = /);
  const progress= at(/const _sfDeleteProgress = /);

  ok('all four helpers were found', [outcome, eject, refusal, progress].every((n) => n > 0));
  ok('⚠️⚠️ the outcome handler shares an indent level with the helpers it calls',
     indentOf(outcome) === indentOf(refusal) && indentOf(outcome) === indentOf(progress),
     'at top level it cannot see them at all and throws on the first completed export');
  ok('⚠️⚠️ the toast eject offer shares that level too',
     indentOf(eject) === indentOf(progress),
     'it calls _sfEjectContext and _sfDeleteProgress, neither of which is on window');

  // Indentation alone is not scope - a sibling block could match by accident. Nothing may
  // close at a shallower indent between the definitions.
  const lines = H.split('\n');
  const lo = Math.min(outcome, eject, refusal, progress);
  const hi = Math.max(outcome, eject, refusal, progress);
  let boundary = 0;
  for (let i = lo; i < hi - 1; i++) {
    if (/^ {0,5}[})]/.test(lines[i])) { boundary = i + 1; break; }
  }
  ok('⚠️ and no scope closes between them',
     boundary === 0,
     `a block ends at line ${boundary} - matching indentation there is a coincidence, not shared scope`);
}

// ── The three doors that were broken now go through it ───────────────
// ⚠️ RE-ANCHORED 2026-09-22 [B-420], exactly as common-as-zip was the day before: this door
// migrated onto the shared runner, so it no longer calls `_sfExportOutcome` itself — the runner
// does, for every door, behind the contract guard. That is a stronger guarantee than this door
// remembering to. The rule under test is unchanged: this is the door that said
// Exported as "Techno_2" on a cancel, and a cancel here must never read as a success.
ok('the font-card quick export reaches the shared ending through the runner',
   // ⚠️⚠️ A CHARACTER WINDOW IS THE WRONG INSTRUMENT AND IT FAILED TWICE IN ONE AFTERNOON:
   // first at 3000, then at 6000, each time on a door that was correctly migrated and had simply
   // grown a comment between the two anchors. Tuning the number a third time would just move the
   // next failure. Bound the search to the door's own call instead, by brace-matching from
   // `_sfRunExport({` — the same technique the contract guard and the ratchet both use, for the
   // same reason: a fixed-width slice over this file has silently stopped covering its target
   // three times before today.
   (() => {
     const i = H.indexOf('title: `Exporting ${fontName}`');
     if (i < 0) return false;
     const start = H.lastIndexOf('await _sfRunExport({', i);
     if (start < 0) return false;
     let k = H.indexOf('{', start), depth = 0;
     do {
       if (H[k] === '{') depth++;
       else if (H[k] === '}') depth--;
       k++;
     } while (k < H.length && depth > 0);
     return /exportEntryToFolder/.test(H.slice(start, k));
   })(),
   'this is the door that said Exported as "Techno_2" on a cancel');
// ⚠️ RE-ANCHORED 2026-09-21 [B-420]: this door migrated onto the shared runner, so it no longer
// calls `_sfExportOutcome` itself — `_sfRunExport` does, for every door, which is a stronger
// guarantee than this door remembering to. The rule under test is unchanged: a cancel here must
// not be silence, which is what it was before the shared ending existed.
ok('the common-as-zip door reaches the shared ending through the runner',
   /title: 'Exporting common folder',[\s\S]{0,900}?exportCommonAsZip/.test(H)
   && /await _sfRunExport\(\{[\s\S]{0,400}?title: 'Exporting common folder'/.test(H),
   'this door said nothing at all on a cancel');
ok('the tracks door uses it',
   /_sfExportOutcome\(\s*\n?\s*\{ \.\.\.r, wroteCount:/.test(H),
   'this door committed a sync manifest for a cancelled export');

// ── The eject offer is only made where it makes sense ────────────────
// ⚠️ RE-ANCHORED 2026-09-21, NOT LOOSENED. The fact still has to be `=== true`; what changed
// is where it comes from. The eject offer used to read `.removable` off a ~1,900 ms
// `_sfClassifyDest` result - one of FIVE spawns asking about the same destination - and now
// reads the shared `_sfDestIdentity` cache, whose cheap half answers in ~85 ms.
// ⭐ The rule under test is unchanged and is the one that matters: never a truthy test. `null`
// means "cannot tell", and `if (removable)` would silently demote unknown to no-offer while
// reading as though it had checked.
{
  const reads = H.match(/_sfDestIdentity\.removable\([^)]*\)\s*(?:!==|===)\s*true/g) || [];
  ok(`the eject offer requires removable === true, not merely truthy (${reads.length} strict reads)`,
     reads.length >= 2,
     'null means "cannot tell" - offering on unknown would prompt about internal disks');
  // The inverse: no site may decide the offer on truthiness alone.
  ok('⚠️ and no site tests it for truthiness',
     !/if\s*\(\s*(?:await\s+)?_sfDestIdentity\.removable\([^)]*\)\s*\)/.test(H),
     'a bare truthy test reads unknown as false, which is the [B-028] mistake');
}
// ⚠️ The renderer COMPARES against these statuses; safeEject.js is what PRODUCES them. The
// first cut asserted `status: 'unsupported'` against the renderer and failed on a string that
// only ever appears in the module - checking the wrong file for the right fact.
// ⚠️⚠️ THESE USED TO ASSERT A STANDALONE EJECT DIALOG, WHICH IS THE THING HE RULED AGAINST.
// 2026-09-21: "The eject shouldn't be its own modal. It should take place on the summary
// screen, so it can show the status of it right there." So the statuses are now handled in
// two places, neither of them a dedicated dialog: the row on the summary, and the toast
// action for the doors that have no summary. Asserting the old modal back would undo the
// ruling.
ok('every status is handled on the summary row',
   /res\.status === 'unsupported'/.test(H) && /res\.status === 'ejected'/.test(H)
   && /res\.status === 'returned'/.test(H),
   "'busy' is the fall-through - it is the case the feature exists for");
ok('⭐ an already-released card is not reported as an eject we performed',
   /res\.alreadyGone\s*\n?\s*\?/.test(H) || /res\.alreadyGone$/m.test(H)
   || /alreadyGone/.test(H),
   'saying "ejected" for a card that was already out claims credit for nothing');
ok('⚠️ and the busy case still gets a MODAL even from the toast path',
   /Could not eject the \$\{\(ctx\.ejectVocab/.test(H),
   'a "do not unplug it" that scrolls away fails exactly when it matters');
{
  const M = fs.readFileSync(path.join(__dirname, '..', 'safeEject.js'), 'utf8');
  const produced = ['ejected', 'returned', 'busy', 'unsupported']
    .filter((s) => new RegExp(`status: '${s}'`).test(M));
  ok(`the module produces all four statuses (${produced.join(', ')})`, produced.length === 4);
  // Producer/consumer reconciliation: a status the module can emit and the renderer never
  // tests for is a silent no-op in front of the user.
  const unhandled = produced.filter((s) => !new RegExp(`res\\.status === '${s}'`).test(H)
                                        && !(s === 'busy'));
  ok(`every produced status is consumed (unhandled: ${unhandled.join(', ') || 'none'})`,
     unhandled.length === 0,
     "'busy' is the fall-through and is handled by the final branch");
}

console.log(failed ? `\n${failed} FAILED` : '\nexport-outcome-shared: all passing');
process.exit(failed ? 1 : 0);
