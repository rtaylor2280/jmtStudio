// The door map must describe the app that exists.  [B-005 item 4, B-203, B-238]
//
// ⭐⭐ WHY A TEST AND NOT JUST A DOCUMENT. `local/export-doors.md` is the map of every way a
// user can get a file OUT of JMT Studio, and its value is entirely in being complete. A map
// that has quietly gone stale is worse than none, because it reads as coverage - which is
// exactly how the previous list failed: `exportDestination.js` asserted "NINE such doors" in
// a comment, nothing checked it, and there were eleven.
//
// ⚠️ THIS IS THE THIRD TIME A LIST OF EXPORT PATHS BUILT BY READING CODE WAS CORRECTED BY
// SOMEBODY USING THE APP - 09-11 (five doors missing, incl. library Backup), 09-19 (cancel
// wired to the doors named in conversation), 09-20 (three doors reporting a cancel as a
// success). A rule that spans call sites needs a reconciliation, not a reminder.
//
// WHAT IT CANNOT DO: it cannot tell whether a door's WORDING is right, or whether a new menu
// item exists that reaches an already-mapped handler. Those need eyes. What it can do is
// refuse to let the handler set and the map disagree, which is the half that rots silently.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const root = path.join(__dirname, '..');
const MAP = path.join(root, 'local', 'export-doors.md');

// ⚠️ local/ IS GITIGNORED, so a fresh clone genuinely has no map. Skip rather than fail -
// a check that cannot pass on a clean checkout would just get deleted by whoever hit it.
if (!fs.existsSync(MAP)) {
  console.log('  skip  local/export-doors.md not present (gitignored working doc)');
  console.log('\nexport-door-map: skipped');
  process.exit(0);
}

const mapText = fs.readFileSync(MAP, 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

// ── What the app actually exposes ────────────────────────────────────
//
// ⚠️ MATCH ON THE HANDLER NAME, NOT ON THE WORD "export". `sources:extractTo` and
// `fileOps:copy` were both export doors whose names said nothing about exporting - and they
// are precisely the two that were found with no cancel at all, because every earlier sweep
// searched for the feature's name instead of its effect. The lesson stands; keep classifying
// by EFFECT.
// ⚠️⚠️ `sources:extractTo` WAS REMOVED 2026-09-26 [B-434] and is deliberately not in the
// list below. It had a handler, a bridge and ZERO callers - never reachable, born unwired -
// so the cancel it was given on 2026-09-20 and its place in this map were both coverage of
// something no user could open. `test/door-reachability.test.js` fails if it returns.
const KNOWN = [
  'entries:exportToFolder',
  'common:exportToFolder',
  'common:exportAsZip',
  'sharedTracks:exportToFolder',
  'sfFile:export',
  'sfBackup:export',
  'sources:exportToDownloads',
];

// ⚠️⚠️ `fileOps:copy` WAS ON THE ORIGINAL NINE AND DOES NOT BELONG THERE. Its `dest` is a
// LIBRARY LOCATION - `{ kind, id, subPath }` - not a filesystem path, and it moves content
// between entries/sources/common/sharedTracks by HARDLINK. It never writes to a user-chosen
// destination, so it cannot fill a card, cannot be on a board card, and has nothing to eject.
//
// ⭐ The count was wrong in BOTH directions: nine handlers undercounted the ways IN (four menu
// items share sfFile:export) and overcounted the doors, by including an internal operation
// whose name reads like an export. **Classify by what a call WRITES TO, never by its name.**
// (It could still use a cancel - a paste of thirty tracks hashes synchronously and is a long
// silence - but that is an internal-operation feature, not this one.)
const NOT_AN_EXPORT_DOOR = {
  'fileOps:copy': 'dest is a library location, not a path; hardlinks inside the library',
};

const handlers = new Set(
  (main.match(/ipcMain\.handle\('([^']+)'/g) || [])
    .map((s) => s.replace(/^ipcMain\.handle\('/, '').replace(/'$/, ''))
);

// ── 1. Every handler the map names must still exist ──────────────────
for (const h of KNOWN) {
  ok(`main.js still has ${h}`, handlers.has(h),
     'the map names a handler that has been renamed or removed');
  ok(`the map documents ${h}`, mapText.includes(h),
     'a live export handler is missing from local/export-doors.md');
}

// ── 2. A NEW export-shaped handler must be added to the map ──────────
//
// ⚠️ Deliberately loose: anything whose name mentions export/extract/backup counts as a
// candidate. A false positive costs one line here; a false negative is an undocumented way
// for a file to leave the app, which is the thing being prevented.
//
// ⭐ IT PAID ON ITS FIRST RUN. The sweep surfaced `styles:export`, `entries:exportDoc` and
// `sources:exportDoc` - three real file-writing doors that were in no previous list,
// including the register written a few hours earlier on the same day. Two of them write
// straight to Downloads with no picker, so they touch none of the destination machinery.
//
// ⚠️⚠️ EVERYTHING EXEMPTED BELOW NEEDS A REASON, NOT JUST AN ENTRY. An allowlist is how a
// check quietly stops checking: the easiest way to make this file green is to paste the
// failing name in. Each one here writes NO user-destination bytes - it cancels, sizes,
// plans, or opens a picker. If a handler ever gains a write, it comes off this list.
const NOT_DOORS = {
  'export:cancel':                  'sets a flag on in-flight work; writes nothing',
  'sfBackup:cancel':                'same, for the backup AbortController',
  'sfBackup:prep':                  'sizes the job and returns numbers; writes nothing',
  'sfBackup:inspect':               'reads a backup zip and reports what is in it; read-only',
  'sfBackup:surveyMerge':           'compares a backup against the library; read-only',
  'sharedTracks:planExport':        'compares library against destination; read-only',
  'sources:exportSize':             'sizes a source for the fit check; read-only',
  'common:pickExportZipPath':       'opens a save dialog and returns a path',
  'dialog:pickExportDir':           'opens a folder dialog and returns a path',
  'dialog:pickExportFilePath':      'opens a save dialog and returns a path; the single-FILE twin of pickExportDir, added so the renderer owns that picker and the runner can own the rest',
  'dialog:selectBackupExportPath':  'opens a save dialog and returns a path',
  'dialog:selectBackupImportPath':  'opens an open dialog and returns a path',
};

// ⭐⭐ WRITES, BUT INWARD. These restore a backup INTO the library, so they are import doors
// wearing an `sfBackup:` prefix - the direction is the thing that matters, not the noun in
// the name. They are exempted from the EXPORT map and named here so the import register has
// a starting list rather than a blank page. ⚠️ Do not fold them into NOT_DOORS: these very
// much write, and a future reader skimming that list would conclude otherwise.
const IMPORT_DOORS = {
  'sfBackup:applyMerge':   'merges a backup into the library',
  'sfBackup:applyReplace': 'replaces the library from a backup',
};
Object.assign(NOT_DOORS, IMPORT_DOORS);
Object.assign(NOT_DOORS, NOT_AN_EXPORT_DOOR);
const candidates = [...handlers].filter((h) =>
  /export|extract|backup/i.test(h) && !/^exportDest:/.test(h) && !(h in NOT_DOORS));
for (const h of candidates) {
  ok(`export-shaped handler ${h} is in the map`, mapText.includes(h),
     `add it to local/export-doors.md - which UI door reaches it, and what it writes; ` +
     `if it writes nothing, add it to NOT_DOORS here WITH the reason`);
}

// ⚠️ And the exemptions must still exist. A renamed handler whose old name sits in
// NOT_DOORS would be silently unexamined - the allowlist protecting a door that moved.
for (const h of Object.keys(NOT_DOORS)) {
  ok(`exempt handler ${h} still exists`, handlers.has(h),
     'it was renamed or removed - drop it from NOT_DOORS so its replacement gets examined');
}

// ── 3. The eleven-door claim has to stay anchored to the UI ──────────
//
// The count is the thing that was wrong before, so it gets asserted rather than described.
// ⚠️ SCOPED TO THE ONE TABLE, NOT THE WHOLE FILE. The first version counted every numbered
// table row in the document and reported 29 - the capability matrix and the out-of-tab table
// both have numbered rows. An instrument that sweeps a whole file to answer a question about
// one section is measuring something adjacent to the question.
// ⚠️⚠️ AND THE END ANCHOR HAS TO BE THE END OF THE TABLE, NOT THE NEXT HEADING THAT HAPPENS TO
// FOLLOW IT. On 2026-09-22 a section was added between this table and "Three more", and its own
// table rows were swept into the count - 17 where the door table holds 12. The instrument was
// still measuring "everything between two landmarks" rather than the table itself, which is the
// same shape as the bug the comment above already describes, one landmark further out.
// ⭐ So: stop at the first blank line after the table starts. A markdown table cannot contain one.
// ⚠️⚠️ THE ANCHOR IS ASSERTED BEFORE IT IS USED, AND THAT IS NOT DEFENSIVE PADDING.
// On 2026-09-24 the heading was corrected from "The eleven" to "The fourteen" - the count in the
// prose had been stale since 8b, 12 and 13 arrived. `indexOf` returned -1, and `slice(-1)` is not
// an empty string, it is the LAST CHARACTER of the file: the table parsed to zero rows and the
// failure read as "the UI lost fourteen doors" rather than "the anchor moved". A slice taken from
// an unmatched anchor measures something real and says nothing true about it.
const SF_ANCHOR = '### The fourteen, as a person meets them';
const anchorAt = mapText.indexOf(SF_ANCHOR);
ok(`the door-table anchor is present in the register (${SF_ANCHOR})`, anchorAt >= 0,
   'The heading this test slices from was renamed or removed. Fix the anchor - do NOT read the '
   + 'row count below as a statement about the UI until this passes.');
const sfSection = anchorAt >= 0 ? mapText.slice(anchorAt) : '';
const sfTable = (() => {
  const firstRow = sfSection.indexOf('\n|');
  if (firstRow < 0) return '';
  const end = sfSection.indexOf('\n\n', firstRow);
  return sfSection.slice(firstRow, end < 0 ? undefined : end);
})();
const rows = (sfTable.match(/^\|\s*\d+[a-z]?\s*\|/gm) || []).length;
// ⚠️ 14: eleven enumerated off the screen 2026-09-20, plus 8b ("Export common folder…", added
// 2026-09-22), plus doors 12 and 13 - the two export-before-delete paths, which the RUNNER had been
// naming by number since 09-21 while this table left them out. His correction: "technically 14...
// the two delete paths. delete last source with export and delete source."
// ⚠️ Superseded note: "Export common folder…" (8b) was added because there was no way to write a
// common onto a card before it — the one Export item only ever produced a zip.
// ⚠️ The row id pattern allows a letter suffix, because 8b sits beside 8 rather than renumbering
// nine rows and every reference to them in the code and the commit history.
ok(`the Sound Fonts tab lists 14 user-facing doors (found ${rows})`, rows === 14,
   'Eleven were enumerated from the screen on 2026-09-20 and 8b was added 2026-09-22; if the UI ' +
   'gained or lost one, update the map AND this number together. ⚠️ The funnel is reached from ' +
   'ten call sites and the map records that as an OPEN question — if those become doors, this ' +
   'number moves again and it moves by his ruling, not by a grep');

// ── 4. The stale-number trap must not come back ──────────────────────
//
// ⚠️ The specific failure being blocked: a comment asserting a door count, with nothing
// checking it. It was wrong for weeks and read as authoritative the whole time.
const dest = fs.readFileSync(path.join(root, 'exportDestination.js'), 'utf8');
ok('exportDestination.js no longer asserts a door count in prose',
   !/There are NINE such doors/i.test(dest),
   'a number in a comment is a claim nobody re-checks - point at the map instead');
ok('exportDestination.js points at the map',
   /local\/export-doors\.md/.test(dest),
   'the module every export door calls is where a reader will be standing');

console.log(failed ? `\n${failed} FAILED` : '\nexport-door-map: all passing');
process.exit(failed ? 1 : 0);
