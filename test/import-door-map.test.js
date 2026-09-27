// Every handler that writes INTO the library has a row in the register.  [B-420]
//
// ⭐⭐ THE IMPORT TWIN OF `export-door-map.test.js`, AND IT EXISTS FOR THE SAME REASON THAT ONE
// DOES. The export door count was wrong twice, both times because a list assembled by reading
// code felt complete: nine handlers where the UI had eleven doors, then eleven doors where the
// funnel alone is reached from ten call sites. Both times it was corrected by somebody USING the
// app. A register nobody checks drifts back to being a comment.
//
// ⚠️⚠️ DIRECTION IS THE THING, NOT THE NOUN. `sfBackup:applyMerge` and `sfBackup:applyReplace`
// wear an `sfBackup:` prefix and are writes going INWARD - they were found by the export map's
// own sweep, not by reading names. Classifying by what a call WRITES TO is the rule that finally
// got the export count right, so it is the rule here.
//
// ⚠️ WHAT THIS CAN AND CANNOT DO. It reconciles HANDLERS against the register, which is a real
// check and a weak one: a handler reachable from a call site that carries none of its guards is
// invisible to it, exactly as on the export side. The door list itself is marked DRAFT in the
// register until it has been walked on screen, and this test deliberately does NOT assert a door
// count - inventing one from a grep is the mistake being guarded against.
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

// ⚠️ local/ IS GITIGNORED, so a fresh clone genuinely has no map. Skip rather than fail - a check
// that cannot pass on a clean checkout would just get deleted by whoever hit it.
if (!fs.existsSync(MAP)) {
  console.log('  skip  local/export-doors.md not present (gitignored working doc)');
  console.log('\nimport-door-map: skipped');
  process.exit(0);
}

const mapText = fs.readFileSync(MAP, 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

ok('the import register exists in the map', mapText.includes('## Import doors — the register'),
   'the stub was replaced 2026-09-22; if this heading moved, re-anchor rather than deleting');

// ── The handlers that write inward ───────────────────────────────────
//
// ⭐ NAMED EXPLICITLY RATHER THAN PATTERN-MATCHED. A regex over handler names is precisely the
// instrument that produced the wrong export count: it finds the ones whose NAME says what they
// do. This list is maintained by hand, and the sweep below is what stops it going stale.
const INWARD = [
  'sources:import',
  // ⚠️ `soundFonts:importFont` and `sources:extractTo` were removed 2026-09-26 [B-434] -
  // both unreachable, both listed here as though covered. door-reachability.test.js guards it.
  'sources:restoreCustomized',
  'common:importFromZip',
  'common:importFromFolder',
  'common:addFiles',
  'sharedTracks:addFiles',
  'fileOps:addFiles',
  'attachments:add',
  'attachments:addToSources',
  'sfBackup:applyMerge',
  'sfBackup:applyReplace',
  'styles:import',
  'styles:replace',
  'template:import',
  'proffieOS:importVersion',
  // ⭐ ADDED BY THIS FILE'S OWN FIRST RUN (2026-09-22). Both are the mechanism behind doors that
  // WERE listed in the register as user-facing (i3 bulk import, i5 import from link) and which the
  // hand-written handler list had simply missed. The loop above could never have found them: it
  // only confirms what is already named. The sweep below did.
  'bulkImport:run',
  'linkImport:start',
];

// ⚠️ NOT INWARD, AND SAID SO ON PURPOSE. These match the name heuristic below and are pickers,
// scans, analyses or control calls - they read, they cancel, or they write something that is not
// library content. Naming them here is what stops the sweep re-raising the same sixteen forever
// and being switched off, which is how a noisy check becomes no check.
// ⚠️ `favorites:add` writes a FLAG on an entry, not content into the library. `versions:
// applyJmtFeatures` writes into an installed OS version tree - it is arguably a door and is
// flagged as an open question in the register rather than quietly filed here.
const NOT_INWARD = [
  'bulkImport:pickRoot', 'bulkImport:scan', 'bulkImport:analyze', 'bulkImport:cancel',
  'bulkImport:discardPrepared', 'bulkImport:enrichGuided', 'bulkImport:enrichCancel',
  'bulkImport:readCandidateFile', 'bulkImport:matchGuided',
  'dialog:selectBackupImportPath', 'linkImport:browser', 'linkImport:cleanup',
  'favorites:add', 'versions:applyJmtFeatures',
];

for (const h of INWARD) {
  ok(`  ${h} still exists`, main.includes(`ipcMain.handle('${h}'`),
     'the register names this handler; if it was renamed or removed, update the register in the '
     + 'same change rather than leaving the map describing an app that no longer exists');
  ok(`  ${h} is in the register`, mapText.includes(h),
     'a handler that writes into the library with no row is the exact gap this file exists to '
     + 'catch - the export side found sfBackup:applyMerge that way');
}

// ── The sweep: an inward-looking handler the list has never heard of ──
//
// ⚠️ THIS IS THE HALF THAT FINDS THINGS. The loop above only confirms what is already known; a
// door nobody listed cannot fail it. This looks for handlers whose names suggest they write
// inward and which appear in neither the list nor the register.
// ⚠️ It is a NAME heuristic and therefore weak by construction - it cannot see a handler named
// for its feature rather than its direction, which is how `sfBackup:applyMerge` hid. It is a
// backstop under the hand-maintained list, not a substitute for walking the UI.
{
  const all = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]);
  const looksInward = /(import|restore|merge|:add|addFiles|addTo|ingest|apply)/i;
  const unlisted = all.filter((h) =>
    looksInward.test(h) && !INWARD.includes(h) && !NOT_INWARD.includes(h) && !mapText.includes(h));
  ok(`no unlisted inward-looking handlers (${unlisted.length} found)`,
     unlisted.length === 0,
     'either add it to the register and to INWARD above, or - if it does NOT write into the '
     + 'library - say so in the register so the next sweep does not re-raise it: ' + unlisted.join(', '));
}

// ── The count stays HIS, not a grep's ────────────────────────────────
//
// ⭐ The export register's door count is asserted because he enumerated it off the screen. The
// import list has NOT been walked yet, so asserting a number here would manufacture exactly the
// false confidence this whole file is a reaction to. What IS asserted is that the draft admits
// what it is.
ok('⚠️ the import door list still declares itself a draft',
   /doors, as a person meets them — DRAFT/.test(mapText),
   'when it has been walked on screen, replace the DRAFT marker with a count and assert the '
   + 'count here - the way the export table is asserted');

console.log(failed === 0
  ? '\nimport-door-map: all checks passed'
  : `\nimport-door-map: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
