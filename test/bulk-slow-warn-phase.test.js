// The board-card warning on the bulk import door has to come before the ANALYZE pass, which is
// the half that hashes every source and takes tens of minutes across a board's USB bridge.
//
// WHY THIS IS A PHASE TEST AND NOT A PRESENCE TEST. The check was present in the bulk flow
// the whole time it was broken - it sat in `runImport`, under a comment that described the hashing
// as part of the import run. It is not: `_runAnalyze` is called from `showReview`, several screens
// earlier, and the run is only reached once someone answers the review. So "the bulk door calls
// _sfWarnSlowImport" was TRUE while twelve fonts hashed off a board card with no question asked.
// `import-doors-register.test.js` counts call sites and was green throughout. A count cannot see
// an ordering, which is why this file exists alongside it rather than inside it.
//
// Found 2026-10-06 walking the import doors against a real board card.

const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failures = 0;
const ok = (label, cond, hint) => {
  if (cond) { console.log(`  ok  ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${hint ? `\n       ${hint}` : ''}`);
};

// ── The region: showReview, from its declaration to the next top-level const in that scope. ──
// Sliced rather than parsed, and the slice is VERIFIED below before anything is read from it - an
// empty or runaway slice would make every ordering assertion below pass vacuously.
const showReviewAt = code.indexOf('const showReview = async (plan) => {');
const analyzeCallAt = code.indexOf('await _runAnalyze(plan)');
const warnInReviewAt = code.indexOf('_sfWarnSlowImport(plan.rootDir');

ok('the slicer can find showReview', showReviewAt > 0,
   'showReview was renamed or restructured - re-anchor this test before trusting it');
ok('the slicer can find the analyze call', analyzeCallAt > 0,
   '_runAnalyze is gone or called differently - re-anchor before reading the ordering below');

// ── 1. The warning is inside showReview at all. ──
ok('the bulk door raises the board-card check in showReview',
   warnInReviewAt > 0,
   'no _sfWarnSlowImport(plan.rootDir …) in the bulk flow - the analyze pass runs unwarned off a '
   + 'board card, which is the original defect');

// ── 2. And it is ahead of the analyze, which is the whole point. ──
ok('the check comes BEFORE the analyze pass, not after it',
   warnInReviewAt > showReviewAt && warnInReviewAt < analyzeCallAt,
   'the check moved behind _runAnalyze. The hashing is the expensive half; a warning after it '
   + 'guards nothing and is the exact shape of the 2026-10-06 defect');

// ── 3. Before the analyze GATE, not inside it. ──
// A plan holding only common folders skips the analyze entirely and is still an import off the
// same slow card, so a check tucked inside `if (total > 0 || _hasTracks)` would miss it.
// `warnInReviewAt > 0` IS LOAD-BEARING, NOT BELT-AND-BRACES. Mutation-tested 2026-10-06: with
// the call removed, `indexOf` returns -1 and `-1 < gateAt` is trivially true, so this check passed
// while the thing it describes did not exist. A missing call must never read as a well-placed one.
const gateAt = code.indexOf('const _hasTracks = !!(plan.tracksFolders', showReviewAt);
ok('the check is outside the analyze gate, so a commons-only plan still gets it',
   warnInReviewAt > 0 && gateAt > 0 && warnInReviewAt < gateAt,
   'the check sits inside the total>0 || _hasTracks branch - a common-folders-only import off a '
   + 'board card would skip it');

// ── 4. Backing out abandons the flow rather than leaving a dead modal up. ──
// At this point the modal is showing the scan screen with nothing further to do, so returning
// without closing strands it. runImport's own copy can plain `return` because the review screen
// behind it is still a live screen.
const afterWarn = code.slice(warnInReviewAt, warnInReviewAt + 400);
ok('backing out of the check closes the bulk modal',
   /\}\)\)\s*\{\s*closeModal\(\);\s*return;\s*\}/.test(afterWarn),
   'a back-out returns without closeModal() - the scan screen is left on top with no next step');

// ── 5. One import decision asks ONE question. ──
// The runImport copy is a fallback for a plan that reached a run without passing through
// showReview; in the normal flow the flag is already set and it stays silent.
const runImportAt = code.indexOf('const runImport = async (planOverride)');
const runWarnAt = code.indexOf('_sfWarnSlowImport(runPlan.rootDir', runImportAt);
ok('the slicer can find runImport', runImportAt > 0, 're-anchor before reading below');
ok('the runImport check is guarded so the same card is not queried twice',
   runWarnAt > 0 && /if\s*\(\s*!bulkSlowWarned\s*\)\s*\{/.test(
     code.slice(runImportAt, runWarnAt)),
   'runImport asks unconditionally - after the showReview check, that is a second dialog about '
   + 'the same card in the same import');

// ── 6. The flag dies with the modal. ──
// Same rule `bulkCancelling` carries: a session-sticky flag would mute the warning for every
// import after the first, which is worse than the defect it fixes.
const closeAt = code.indexOf('const closeModal = () => {');
const nextFnAt = code.indexOf('\n  const ', closeAt + 10);
ok('bulkSlowWarned is cleared in closeModal',
   closeAt > 0 && nextFnAt > closeAt
   && /bulkSlowWarned\s*=\s*false/.test(code.slice(closeAt, nextFnAt)),
   'the flag survives the modal - the next import off a board card would never ask');

// ── 7. The multi-folder entrance has a device to ask about. ──
// `_sfWarnSlowImport` returns false on `!sourceDir` as its first line, so a merged plan with a
// hardcoded `rootDir: null` could never warn no matter where the call sits. The eject offer armed
// at analyze start reads the same field and had the same hole.
const mergeAt = code.indexOf('const merged = { rootDir:');
ok('the merged multi-folder plan carries a real root',
   mergeAt > 0 && !/const merged = \{ rootDir: null/.test(code),
   'startScanWithPaths hardcodes rootDir: null again - the board-card check and the eject offer '
   + 'both resolve through it and both answer no to a null');

// ── 8. The count in the dialog is named for what it counts. ──
// The bulk plan's `sources` are FONTS, and the dialog rendered them as "12 files (1.28 GB)". The
// reason this is not cosmetic: *"it matters because even a cancel takes forever."* The dialog
// exists to make someone stop before a pass that is expensive to abandon, and a count that reads
// as trivial argues against the warning printing it.
const bulkWarnCalls = (code.match(
  /_sfWarnSlowImport\((?:plan|runPlan)\.rootDir,\s*\{[\s\S]{0,200}?\}\)/g) || []);
ok('the scanner can see both bulk call sites', bulkWarnCalls.length === 2,
   `found ${bulkWarnCalls.length}, expected 2 - re-anchor before reading the check below`);
ok('both bulk call sites name the count as sound fonts',
   bulkWarnCalls.length === 2 && bulkWarnCalls.every(c => /unit:\s*'sound font'/.test(c)),
   'a bulk call site dropped `unit` - its font count renders as a file count, which reads as '
   + 'trivial next to the gigabytes beside it');

// ── 9. …but only when the caller actually knew what it counted. ──
// `measurePath` returns real files, so a door that passed `unit: 'sound font'` AND fell into the
// measure branch would label a file count as fonts. The door cannot see which branch ran, so the
// override belongs at the measure site.
const measureAt = code.indexOf('_files = res.files || 0;');
ok('the slicer can find the measure site', measureAt > 0, 're-anchor before reading below');
ok("a measured count is forced back to 'file' regardless of what the caller said",
   measureAt > 0 && /_unit\s*=\s*'file'/.test(code.slice(measureAt, measureAt + 600)),
   'the measure branch overwrites the count but not the noun - a walked tree would be reported '
   + 'in whatever unit the door guessed');

console.log(failures === 0
  ? '\nbulk-slow-warn-phase: all checks passed'
  : `\nbulk-slow-warn-phase: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
