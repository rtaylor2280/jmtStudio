// The primary export's callbacks must not reference anything its own scope does not declare.
// [B-420, 2026-09-24]
//
// ⭐⭐ WHAT THIS IS FOR, AND WHY IT IS ITS OWN FILE. Door 11 moved onto the shared runner by
// handing it three callbacks - `plan`, `subscribe`, `produce`, `onCompleted`. They are closures
// over `_sfBulkSave`, so every name they use has to be DECLARED in that function before the
// runner is called. Miss one and it is a ReferenceError on a real export.
//
// ⚠️⚠️ AND NOTHING ELSE IN THIS REPO CAN SEE IT. `node --check` validates syntax, not scope. The
// suite is source-grep and cannot execute a renderer function. The syntax stays perfectly valid,
// every other test stays green, and the failure only appears when someone exports a font to a
// card. That is the same class as the 2026-09-15 `error is not defined` crash, which was found by
// opening DevTools rather than by anything that runs here.
//
// ⭐ THE CHECK IS ARITY, NOT CARE. During the migration I measured twenty names crossing from the
// scan into the copy loops. The right answer turned out to be that closures do not need them
// hoisted at all - but "turned out to be" is exactly the kind of reasoning that should not be the
// only thing standing between a user and a broken export. This asserts the conclusion instead of
// trusting it.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const L = H.split('\n');

// ── locate the door ──────────────────────────────────────────────────
// ⚠️ Two markers, never a character count. A fixed-width slice over this file has silently
// stopped covering its target more than once.
const a = L.findIndex((l) => /const _sfBulkSave = async \(\) => \{/.test(l));
const b = L.findIndex((l, i) => i > a && /const _sfBulkDelete = async \(\) => \{/.test(l));
ok('the primary export was located', a >= 0 && b > a,
   're-anchor if _sfBulkSave or the function after it is renamed');
if (a < 0 || b <= a) { console.log('\n1 FAILED'); process.exit(1); }

const body = L.slice(a, b);
const callLine = body.findIndex((l) => /return await _sfRunExport\(\{/.test(l));
ok('it hands off to the shared runner', callLine > 0,
   'if this door stopped calling the runner, this whole file is asserting nothing');

// ── the names the callbacks close over ───────────────────────────────
//
// ⚠️ LISTED, NOT DERIVED. Deriving the set from the source would mean writing a JS parser here,
// and a home-made one would be wrong in exactly the places that matter. This is the measured list
// from the migration - the scan's outputs plus the run state plus the pre-step values the copy
// and the summary read. A name added to the callbacks later and not added here is not caught;
// what IS caught is the far likelier regression: one of these losing its declaration when
// someone edits the scan.
const CLOSED_OVER = [
  // what the conflict scan decided
  'modeByName', '_slotMode', 'unchangedFonts', 'commonOutcomes', 'commonMineName',
  'commonCardName', 'commonMissing', 'commonReason',
  // shared tracks
  'tracksMode', 'tracksDiffering', 'tracksToAdd', 'tracksReplace', 'willWriteTracks',
  'tracksReason', 'tracksOutcome',
  // sizing and step counting
  '_sfExportTotalBytes', '_sfExportFileCount', 'totalSteps', 'stepIdx',
  // tallies the copy writes and the summary reads
  'results', 'failures', '_scanObserved', '_progRefusals',
  // pre-step values
  'names', 'commonSlots', 'includeTracks', 'destDir', '_slowWriteAsked',
  // run state hoisted to the door scope on purpose, so produce can write what onCompleted reads
  '_exportCanceled', '_sfExportLabel', '_sfExportT0', '_sfFmtB', '_bulkLeftovers',
];

const stripComment = (l) => l.replace(/\/\/.*$/, '');
const declRe = (n) => new RegExp('(?:^|[;{}(,\\s])(?:const|let|var)\\s+(?:\\{[^}]*\\b)?' +
  n.replace(/[$]/g, '\\$') + '\\b');

// ⚠️⚠️ A CONTROL, BECAUSE A BLIND SCAN REPORTS CLEAN. If the matcher were broken every name would
// read as undeclared and the file would fail loudly - but the dangerous direction is the other
// one, a matcher so loose that everything "passes". So assert a name that is definitely NOT
// declared in this door and require it to come back missing.
{
  const bogus = '_sfDeleteProgress';           // a module-level helper, never declared here
  const seen = body.some((l) => declRe(bogus).test(stripComment(l)));
  ok('⚠️⚠️ the control is absent as expected', !seen,
     `"${bogus}" was reported as declared inside this door, so the matcher is too loose and `
     + 'every result below is worthless');
}

const missing = [];
const late = [];
for (const n of CLOSED_OVER) {
  const at = body.findIndex((l) => declRe(n).test(stripComment(l)));
  if (at < 0) { missing.push(n); continue; }
  // ⚠️ DECLARED IS NOT ENOUGH - IT MUST BE DECLARED BEFORE THE RUNNER IS CALLED. A `const` below
  // the call site is in its temporal dead zone when the callbacks run, which throws at runtime
  // and looks perfectly valid on the page. That trap is named in this door's own comments.
  if (callLine > 0 && at > callLine) late.push(`${n} (line ${a + at + 1}, after the handoff)`);
}

ok(`⭐ every name the callbacks use is declared in the door (${CLOSED_OVER.length} checked)`,
   missing.length === 0,
   'a name used inside plan/produce/onCompleted with no declaration in _sfBulkSave is a '
   + 'ReferenceError on a real export, invisible to node --check: ' + missing.join(', '));

// ⚠️⚠️ THIS ONE CANNOT CURRENTLY FIRE, AND SAYING SO IS THE POINT. Mutation-tested 2026-09-24:
// moving a declaration below the handoff could not be made to fail, because the handoff is a
// `return await _sfRunExport({...})` and nothing can follow a return in the same block. So today
// this is a FORWARD GUARD, not active coverage, and reading it as coverage would be exactly the
// "check whose failure case is unreachable" this repo has been bitten by.
// ⭐ It becomes live the moment the door captures the result instead of returning it - `const r =
// await _sfRunExport({...})` with anything after it - which is a plausible next edit, since the
// return value is currently discarded by the caller. Kept rather than deleted for that reason,
// and labelled rather than left to look like it is doing work.
ok('⭐ and every one is declared BEFORE the handoff (forward guard - see note)', late.length === 0,
   'a declaration below the call site is in its temporal dead zone when the callback runs: '
   + late.join(', '));

// ── the run state that must NOT be declared inside a callback ────────
//
// ⭐ THE SPECIFIC REGRESSION THIS BLOCKS. `produce` writes these three and `onCompleted` reads
// them. They are separate closures, so a `let` moved inside either one silently stops the other
// from seeing it - and the symptom is not a crash but a WRONG SUMMARY: a cancelled export
// reported as finished, or an elapsed time of about 56 years. The second of those was a real bug
// in this migration, caught by reading rather than by anything that runs.
{
  const handoff = body.slice(callLine).join('\n');
  for (const n of ['_exportCanceled', '_sfExportT0', '_sfExportLabel']) {
    const re = new RegExp('(?:^|[;{}(,\\s])(?:const|let|var)\\s+' + n + '\\b');
    ok(`  ${n} is not re-declared inside a callback`, !re.test(handoff),
       'declaring it inside produce hides it from onCompleted, which reads it for the summary');
  }
  // And the positive half: the elapsed origin is actually STAMPED, not left at its initial 0.
  ok('⚠️ the elapsed origin is stamped inside produce',
     /_sfExportT0 = Date\.now\(\)/.test(handoff),
     'left at 0 the summary reports Date.now()/1000 - about 56 years - in a field that looks '
     + 'like a real measurement');
}

console.log(failed ? `\n${failed} FAILED` : '\nexport-door11-scope: all passing');
process.exit(failed ? 1 : 0);
