/**
 * The seen-backfill marker survives a backup round trip, and never reads as a font  [B-297]
 *
 * [B-297] moved the one-time-backfill flag out of prefs.json and into the library root, so a
 * restored library carries its own migration state. The export never carried it: the bucket
 * pre-scan collects top-level DIRECTORIES only, so a loose file at `library/` is skipped, and a
 * restored library re-ran the backfill and stamped the real NEW set as seen. That is the exact
 * desync the entry was written to close, arriving through the door the entry's own comment names
 * as the more likely direction ("prefs kept, library restored from backup").
 *
 * THE OTHER HALF IS WHY THIS IS NOT A ONE-LINE FIX. `library/.seen-backfill-done` splits into a
 * bucket and an id exactly the way `library/Ahsoka/hum.wav` does, so every site that keys off the
 * first path segment turns it into a phantom font: the inspect count, the merge survey's per-item
 * aggregate, and the restore's per-item lists. Carrying it without classifying it out trades a
 * silent data loss for a font that does not exist.
 *
 * REAL ROUND TRIPS through exportBackup / inspectBackup / surveyMerge / applyReplace. The defect
 * is an ABSENT entry, which no source-text matcher can see, and the phantom only appears in the
 * output of code that reads a real zip.
 *
 * Run: node test/seen-marker-survives-backup.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
// Overridable so a control run can point the same assertions at a copy with one half of the fix
// removed and prove they fail. A test that has never failed is a claim, not a check.
const backup  = require(process.env.B297_MODULE || path.join(ROOT, 'soundFontBackup.js'));
const entries = require(path.join(ROOT, 'soundFontEntries'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const tmps = [];
function store() { const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b297-')); tmps.push(ud); return ud; }
function cleanup() { for (const t of tmps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} } }

function wav(seed) {
  const head = Buffer.from('RIFF....WAVEfmt ', 'ascii');
  const body = Buffer.alloc(512);
  for (let i = 0; i < body.length; i++) body[i] = (seed * 31 + i * 7) & 0xff;
  return Buffer.concat([head, body]);
}

function buildLibrary(ud, { fonts = 2 } = {}) {
  const SF = path.join(ud, 'soundFonts');
  const names = [];
  for (let i = 0; i < fonts; i++) {
    const name = `Font_${i}`;
    const dir = path.join(SF, 'library', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hum.wav'), wav(i + 1));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      schemaVersion: '1', name,
      entryUuid: `c0000000-0000-4000-9000-00000000000${i}`,
      createdAt: '2026-01-01T00:00:00Z',
    }, null, 2));
    names.push(name);
  }
  return { SF, names };
}

const zipNames = async (dest) => {
  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip.async({ file: dest, skipEntryNameValidation: true });
  try { return Object.keys(await zip.entries()); }
  finally { await zip.close(); }
};

(async () => {

// ── THE FIXTURE MUST ACTUALLY HOLD A MARKER ───────────────────────────────
// Asserted before anything is measured against it. A library with no marker would pass every
// "no phantom font" check below for free, and the carry check would be testing nothing.
{
  const ud = store();
  buildLibrary(ud);
  ok('precondition: a fresh library has no marker', entries.seenBackfillDone(ud) === false);
  entries.markSeenBackfillDone(ud);
  ok('precondition: the fixture now holds one, written by the app that owns it',
     entries.seenBackfillDone(ud) === true
     && fs.existsSync(path.join(ud, 'soundFonts', 'library', '.seen-backfill-done')));
}

// ── export carries it ─────────────────────────────────────────────────────
{
  const ud = store();
  const { names } = buildLibrary(ud);
  entries.markSeenBackfillDone(ud);
  const dest = path.join(ud, 'out.zip');
  const r = await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });

  const got = await zipNames(dest);
  ok('THE ARCHIVE CONTAINS THE MARKER — the entry that did not exist',
     got.includes('library/.seen-backfill-done'),
     `library entries carried: ${got.filter(n => n.startsWith('library/')).join(', ')}`);
  ok('the fonts are still carried too', names.every(n => got.some(g => g.startsWith(`library/${n}/`))),
     'carrying a loose file must not disturb the item loop it sits beside');

  // The number on screen is the size of the user's LIBRARY. A marker is app state.
  const t = r.manifest.totals;
  ok('the marker is not counted in the reported library size',
     t.totalBytes === t.sources + t.library + t.common + t.sharedTracks + t.attachments,
     `totalBytes=${t.totalBytes}`);
  ok('and not counted as a font in the manifest', r.manifest.counts.library === names.length,
     `counts.library=${r.manifest.counts.library}, expected ${names.length}`);
}

// ── it does not read as a font anywhere a zip is counted ──────────────────
{
  const ud = store();
  const { names } = buildLibrary(ud);
  entries.markSeenBackfillDone(ud);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });

  const ins = await backup.inspectBackup(dest);
  ok('inspect counts the real fonts only', ins.ok && ins.observed.counts.library === names.length,
     `inspect reported ${ins.ok ? ins.observed.counts.library : ins.error}`);

  // Survey against an EMPTY library, so every backup item lands in `add` and a phantom has
  // nowhere to hide — matched against a populated library it would vanish into `identical`.
  const fresh = store();
  const sv = await backup.surveyMerge({ userData: fresh, zipPath: dest });
  const added = (sv.library.add || []).map(a => a.name || a.id);
  ok('the merge survey offers the real fonts only',
     added.length === names.length && !added.some(n => String(n).includes('seen-backfill')),
     `survey offered: ${added.join(', ')}`);
}

// ── replace-restore puts it back, so the backfill does not re-run ─────────
{
  const ud = store();
  const { SF } = buildLibrary(ud);
  entries.markSeenBackfillDone(ud);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });

  // A full replace renames the whole soundFonts root away first, so this is the real state a
  // restore starts from, not a simulation of it.
  fs.rmSync(SF, { recursive: true, force: true });
  ok('precondition: the marker is gone before the restore', entries.seenBackfillDone(ud) === false);

  await backup.applyReplace({ userData: ud, zipPath: dest });
  ok('A RESTORED LIBRARY REPORTS THE BACKFILL AS ALREADY DONE',
     entries.seenBackfillDone(ud) === true,
     'without this the backfill re-runs and stamps every restored entry as seen');
  ok('and the marker is physically back in the library root',
     fs.existsSync(path.join(SF, 'library', '.seen-backfill-done')));

  // The consequence the whole entry is about, asserted on the data rather than on the flag:
  // a restored font that was never stamped must still be able to light up NEW.
  const listed = entries.listEntries(ud).map(e => e.name);
  ok('the marker still does not enumerate as an entry after a restore',
     !listed.some(n => n.includes('seen-backfill')), JSON.stringify(listed));
  ok('the real fonts came back', listed.length === 2, JSON.stringify(listed));
}

// ── a library that never ran the backfill must not gain a marker ──────────
// The inverse case, and the one a carry can silently get wrong: restoring an archive taken
// before the marker existed must leave the flag OFF, or the backfill is skipped for a library
// that genuinely needs it and the whole restored set stays New forever.
{
  const ud = store();
  const { SF } = buildLibrary(ud);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });
  ok('an archive from an un-backfilled library carries no marker',
     !(await zipNames(dest)).includes('library/.seen-backfill-done'));

  fs.rmSync(SF, { recursive: true, force: true });
  await backup.applyReplace({ userData: ud, zipPath: dest });
  ok('and restoring it leaves the backfill still to do',
     entries.seenBackfillDone(ud) === false);
}

cleanup();
console.log(failures === 0 ? '\nOK' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

})().catch(err => { cleanup(); console.error(err); process.exit(1); });
