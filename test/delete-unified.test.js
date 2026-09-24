// There is exactly ONE delete orchestration, and every door goes through it.
//
// ⭐⭐ WHY THIS EXISTS. [B-420, 2026-09-23] The export side collapsed onto one runner months of work
// ago - `_sfRunSourceExport` takes `sources: [...]` and 1 or 100 is one operation with one bar. The
// DELETE side never did, and nobody noticed because each door looked correct on its own. There were
// three deleteEntry loops and three deleteSource calls, each re-implementing
// delete-the-entries-then-clean-up-the-source.
//
// ⚠️ HOW IT SURFACED, which is the argument for a structural check rather than more testing: Ryan
// deleted a font by right-click and got no summary. Two of the four doors spoke, two said nothing,
// and which one you got depended on where you started. His words: "I thought we got rid of the
// concept of bulk/single and it's all the same" and "shouldn't matter where I delete from."
// ⭐ The tell was visible from OUTSIDE the code before it was visible inside it: one door called its
// destination `exportDir` and another `bulkExportDir`, and pasting the wrong one in was a
// ReferenceError that `node --check` accepts happily.
//
// ⚠️ THIS IS A SHAPE CHECK, NOT A BEHAVIOUR CHECK. It cannot tell you the delete works. It tells you
// nobody has quietly grown a fourth copy of the sequence - the one thing a behaviour test for any
// single door will always pass while the codebase drifts apart.
'use strict';

const fs = require('fs');
const path = require('path');

const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// ── the runner exists and owns the sequence ──────────────────────────
const runnerAt = H.indexOf('const _sfRunDelete = async');
ok('the delete runner exists', runnerAt > -1,
   're-anchor this file before trusting anything below - without the runner every check here is '
   + 'measuring nothing');

const runnerEnd = H.indexOf('const _sfSourcesBehind', runnerAt);
const runner = runnerAt > -1 && runnerEnd > runnerAt ? H.slice(runnerAt, runnerEnd) : '';
ok('⭐ and it is the thing that deletes', /electronAPI\.deleteEntry\(/.test(runner)
   && /electronAPI\.deleteSource\(/.test(runner),
   'the runner does not delete anything, so the doors must still be doing it themselves');
ok('⭐ and the thing that speaks', /_sfDeleteOutcome\(/.test(runner),
   'an ending outside the runner is how four doors ended up with three behaviours');

// ── ⚠️⚠️ NOBODY ELSE ORCHESTRATES A DELETE ───────────────────────────
//
// The ORCHESTRATION is the combination: removing entries AND then removing the source they came
// from. A lone deleteEntry is not a delete door - the Undo action on a duplicate removes copies that
// share a source with surviving originals, and an abandoned import rolls back the source it just
// wrote. Those are declared below rather than pattern-matched around.
//
// ⚠️ DECLARED POSITIVELY, SO IT GOES STALE LOUDLY. An exemption that is silently skipped rots
// without telling anyone; one that must still be FOUND fails the moment it moves or disappears, and
// that failure is a prompt to re-read it rather than a false alarm.
const EXEMPT = [
  { what: 'import rollback: a cancelled or failed import removes the source it just wrote',
    find: 'window.electronAPI.deleteSource({ uuid: uuidToClean })' },
  { what: 'import rollback: the same, on the other import door',
    find: 'window.electronAPI.deleteSource({ uuid: importRes.uuid })' },
  { what: 'undo duplicate: removes the copies only - they share a source with the originals, so no '
          + 'source can be orphaned and no cleanup is owed',
    find: 'try { await window.electronAPI.deleteEntry({ name: nm }); } catch {}' },
];
for (const e of EXEMPT) {
  ok(`⚠️ the declared exemption is still there — ${e.what.split(':')[0]}`, H.includes(e.find),
     `"${e.find}" is gone. Either it moved (re-declare it) or it was removed (delete this entry). `
     + 'Do not widen the matcher until it passes.');
}

{
  // Strip the exemptions, then nothing outside the runner may delete BOTH an entry and a source.
  let rest = H.slice(0, runnerAt) + H.slice(runnerEnd > runnerAt ? runnerEnd : runnerAt);
  for (const e of EXEMPT) rest = rest.split(e.find).join('');
  const entryHits = (rest.match(/electronAPI\.deleteEntry\(/g) || []).length;
  const sourceHits = (rest.match(/electronAPI\.deleteSource\(/g) || []).length;
  ok('⚠️⚠️ no second delete orchestration exists',
     entryHits === 0 && sourceHits === 0,
     `found ${entryHits} deleteEntry and ${sourceHits} deleteSource call(s) outside the runner and `
     + 'outside the declared exemptions. A door that deletes for itself will drift away from the '
     + 'others in exactly the way this file exists to prevent — route it through _sfRunDelete, or '
     + 'declare it above with a reason.');
}

// ── every door collects and hands over ───────────────────────────────
{
  const callers = (H.match(/await _sfRunDelete\(\{/g) || []).length;
  ok(`⭐ every delete door calls the runner (${callers} found)`, callers >= 3,
     'there were three doors when this was written - source detail, the single/right-click path, '
     + 'and bulk. Fewer callers means one of them went back to doing it itself.');
}

// ── ⚠️⚠️ AND THE CHECK PROVES IT CAN FAIL ────────────────────────────
// A structural check that reports clean is indistinguishable from one whose matcher stopped
// matching — which is exactly how a fixed-width window in export-wiring reported an already-fixed
// site as broken for a day, and only a control caught it.
{
  const injected = H.slice(0, runnerAt)
    + "\n await window.electronAPI.deleteEntry({ name: 'x' });"
    + "\n await window.electronAPI.deleteSource({ uuid: 'y' });\n"
    + H.slice(runnerEnd > runnerAt ? runnerEnd : runnerAt);
  let rest = injected;
  for (const e of EXEMPT) rest = rest.split(e.find).join('');
  const hits = (rest.match(/electronAPI\.deleteEntry\(/g) || []).length
             + (rest.match(/electronAPI\.deleteSource\(/g) || []).length;
  ok('⚠️⚠️ a smuggled-in second orchestration IS caught', hits === 2,
     'the scanner cannot see a delete it should flag, so its clean result means nothing at all');
}

console.log(failed ? `\ndelete-unified: ${failed} failing`
                   : '\ndelete-unified: all passing');
process.exit(failed ? 1 : 0);
