/**
 * A file that cannot be read is found BEFORE the archive starts, and skipping it leaves
 * the user's data alone.  [B-478]
 *
 * WHY THIS EXISTS. On 2026-10-11 one unreadable file left `archive.finalize()` unsettled
 * forever: the export sat at a percentage and never moved. The fix ended the run and named
 * the file, which is honest but a dead end for the user. The gate this file guards finds the
 * file during the survey - while nothing has been written and there is still a way back.
 *
 * THERE IS NO WAY BACK ONCE THE ARCHIVE HAS STARTED, and that is the whole reason the check
 * has to be early. Measured 2026-10-12: archiver's EPERM arrives as a stream-level `error`,
 * not a per-entry `warning`, so the partial zip can never be completed - ten good files had
 * already been written, 188 MB of them, and finalize was still unsettled at eight seconds.
 *
 * THE TWO PROPERTIES WORTH ASSERTING, and the second is the one with teeth:
 *   1. A skipped file is absent from the archive and reported.
 *   2. A skipped file does NOT enter `refused`. That channel means "a program this app removes
 *      from the library" - it deletes what it reports. These are the user's own files, left
 *      exactly where they are. Same list shape, opposite consequence, so a future change that
 *      merges the two for tidiness has to come through this test first.
 *
 * Run: node test/backup-skips-unreadable.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const backup = require(path.join(__dirname, '..', 'soundFontBackup.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

function wav(size, seed) {
  const b = Buffer.alloc(size);
  b.write('RIFF', 0); b.write('WAVE', 8);
  for (let i = 12; i < size; i += 97) b[i] = (seed * 31 + i) & 0xff;
  return b;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b478-'));
  const userData = path.join(tmp, 'userData');
  const sfRoot = path.join(userData, 'soundFonts');

  const libFont = path.join(sfRoot, 'library', 'TestFont');
  fs.mkdirSync(libFont, { recursive: true });
  fs.writeFileSync(path.join(libFont, 'hum.wav'), wav(4096, 1));
  fs.writeFileSync(path.join(libFont, 'swing1.wav'), wav(4096, 2));
  fs.writeFileSync(path.join(libFont, 'swing2.wav'), wav(4096, 3));

  const stRoot = path.join(sfRoot, 'sharedTracks');
  fs.mkdirSync(stRoot, { recursive: true });
  fs.writeFileSync(path.join(stRoot, 'track1.wav'), wav(4096, 4));
  fs.writeFileSync(path.join(stRoot, 'track2.wav'), wav(4096, 5));

  // ── The survey finds nothing wrong with a healthy library ──────────────────────────
  // THE POSITIVE CONTROL, AND IT RUNS FIRST ON PURPOSE. A probe that reported everything as
  // unreadable would pass the skip assertions below just as well as a correct one. This is the
  // reading that says the instrument can return clean.
  const clean = await backup.surveyLibraryAsync(userData, { probeReadability: true });
  ok('healthy library probes clean',
     Array.isArray(clean.unreadable) && clean.unreadable.length === 0,
     `got ${JSON.stringify(clean.unreadable)}`);
  ok('survey still reports its counts with the probe on',
     clean.counts.library === 1 && clean.counts.sharedTracks === 2,
     JSON.stringify(clean.counts));

  // ── The probe is OFF unless asked for ─────────────────────────────────────────────
  // It costs a syscall per file, and every other caller of this survey wants only the bytes.
  const unprobed = await backup.surveyLibraryAsync(userData);
  ok('probe does not run unless requested',
     Array.isArray(unprobed.unreadable) && unprobed.unreadable.length === 0,
     JSON.stringify(unprobed.unreadable));

  // ── A skipped file is excluded, reported, and NOT treated as a refusal ─────────────
  //
  // A LOOSE TRACK, DELIBERATELY. This block asserted a font file for as long as skipping meant
  // skipping that one file; under the 2026-10-12 ruling a font file takes its font with it, so
  // the file-level path now only exists for sharedTracks. Pointed at a track rather than
  // weakened, because "siblings survive" is still the correct claim for the bucket that has no
  // items - it just is not the correct claim for a font any more. The item case is its own
  // block at the bottom.
  const victim = path.join(stRoot, 'track2.wav');
  const destPath = path.join(tmp, 'out.zip');
  const result = await backup.exportBackup({
    userData,
    destPath,
    appVersion: '0.0.0-test',
    skipPaths: [victim],
  });

  ok('export completed with a skip in play', !!result && !!result.destPath, JSON.stringify(result && Object.keys(result)));
  ok('the skipped file is reported',
     (result.skipped || []).some(s => path.resolve(s.path) === path.resolve(victim)),
     JSON.stringify(result.skipped));
  ok('a skip is NOT a refusal',
     (result.refused || []).length === 0,
     JSON.stringify(result.refused));

  // THE FILE IS STILL ON DISK. The refusal path removes what it names; this one must not.
  ok('the skipped file is untouched on disk', fs.existsSync(victim));

  // ── THE MANIFEST DESCRIBES THE ARCHIVE, NOT THE LIBRARY ──────────────────────────
  //
  // The ruling, 2026-10-12: the archive must read as though the skipped files do not exist.
  // `counts` and `totals` come from a survey that ran before anything was known to be
  // unreadable, so without an adjustment a backup holding ten tracks claims twelve and nothing
  // inside it says otherwise.
  //
  // Asserted against a track skip because sharedTracks is the one bucket whose count is FILES.
  // The item buckets count items, and a font with one file missing is still one font.
  {
    const destPath2 = path.join(tmp, 'tracks.zip');
    const victimTrack = path.join(stRoot, 'track1.wav');
    const trackBytes = fs.statSync(victimTrack).size;

    const before = await backup.surveyLibraryAsync(userData);
    const r2 = await backup.exportBackup({
      userData, destPath: destPath2, appVersion: '0.0.0-test', skipPaths: [victimTrack],
    });

    const StreamZipA = require(path.join(__dirname, '..', 'node_modules', 'node-stream-zip'));
    const z2 = new StreamZipA.async({ file: destPath2 });
    let man = null;
    let entryNames = [];
    try {
      man = JSON.parse((await z2.entryData('manifest.json')).toString('utf8'));
      entryNames = Object.keys(await z2.entries());
    } finally { await z2.close(); }

    ok('the fixture has a track to skip', before.counts.sharedTracks === 2 && trackBytes > 0,
       `counts.sharedTracks=${before.counts.sharedTracks} bytes=${trackBytes}`);
    ok('the manifest count drops by the skipped track',
       man && man.counts.sharedTracks === before.counts.sharedTracks - 1,
       `manifest says ${man && man.counts.sharedTracks}, survey said ${before.counts.sharedTracks}`);
    ok('the manifest byte total drops by the skipped bytes',
       man && man.totals.totalBytes === before.totalBytes - trackBytes,
       `manifest ${man && man.totals.totalBytes} vs ${before.totalBytes - trackBytes}`);

    // AND THE NUMBER MATCHES WHAT IS REALLY INSIDE, which is the claim that actually matters.
    // A count corrected to a different wrong number would satisfy the two assertions above.
    const tracksInZip = entryNames.filter(nm => /^sharedTracks\/.+\.wav$/i.test(nm)).length;
    ok('and the manifest count equals the tracks actually in the archive',
       man && man.counts.sharedTracks === tracksInZip,
       `manifest ${man && man.counts.sharedTracks}, archive holds ${tracksInZip}`);
    ok('the skip is still reported on its own channel',
       (r2.skipped || []).length === 1 && (r2.refused || []).length === 0);
  }

  // ── And it really is absent from the archive ──────────────────────────────────────
  // Reading the zip rather than trusting the return value: `skipped` is this module's own
  // account of what it did, and the archive is the fact.
  const StreamZip = require(path.join(__dirname, '..', 'node_modules', 'node-stream-zip'));
  const zip = new StreamZip.async({ file: destPath });
  let names = [];
  try { names = Object.keys(await zip.entries()); } finally { await zip.close(); }

  const inZip = (leaf) => names.some(n => n.endsWith(leaf));
  ok('the skipped file is not in the archive', !inZip('track2.wav'),
     names.filter(n => n.includes('track')).join(', '));
  ok('its siblings ARE in the archive', inZip('track1.wav'), names.join(', '));
  ok('and a loose-track skip costs the font bucket nothing',
     inZip('hum.wav') && inZip('swing1.wav') && inZip('swing2.wav'), names.join(', '));

  // ── AN ITEM THAT IS NOT FULLY READABLE IS NOT CARRIED AT ALL ─────────────────────
  //
  // The ruling, 2026-10-12: "if not fully readable it can't be there." A font missing one sound
  // would restore looking complete, which is a worse artifact than its absence - the readable
  // files are still on the user's disk either way. It also removes the stale-identity problem by
  // construction: an item's contentHash / contentFileCount / contentTotalBytes travel inside its
  // own meta.json, and a partial item would carry a record describing content the archive lacks.
  //
  // THE SHARP EDGE THIS GUARDS: skipping only the named file is the obvious reading of a
  // skipPaths argument, and it silently produces exactly the partial item the ruling forbids.
  {
    const destPath3 = path.join(tmp, 'item.zip');
    const r3 = await backup.exportBackup({
      userData, destPath: destPath3, appVersion: '0.0.0-test',
      skipPaths: [path.join(libFont, 'hum.wav')],
    });

    const StreamZipB = require(path.join(__dirname, '..', 'node_modules', 'node-stream-zip'));
    const z3 = new StreamZipB.async({ file: destPath3 });
    let names3 = [];
    let man3 = null;
    try {
      names3 = Object.keys(await z3.entries());
      man3 = JSON.parse((await z3.entryData('manifest.json')).toString('utf8'));
    } finally { await z3.close(); }

    const fontEntries = names3.filter(nm => nm.startsWith('library/TestFont/'));
    ok('the whole font is absent, not just the unreadable file', fontEntries.length === 0,
       `still present: ${fontEntries.join(', ')}`);
    ok('its readable siblings went with it',
       !names3.some(nm => nm.endsWith('swing1.wav')),
       'a surviving sibling means the file was skipped instead of the item');
    ok('the item is reported as an item, not as a file',
       (r3.skippedItems || []).length === 1
       && r3.skippedItems[0].bucket === 'library'
       && r3.skippedItems[0].top === 'TestFont',
       JSON.stringify(r3.skippedItems));
    ok('its file count rides along so the report can say what it cost',
       (r3.skippedItems[0] || {}).files === 3, JSON.stringify(r3.skippedItems));
    ok('the manifest item count drops by one', man3 && man3.counts.library === 0,
       `counts.library = ${man3 && man3.counts.library}`);
    ok('and nothing was removed from disk', fs.existsSync(path.join(libFont, 'swing1.wav')));
    ok('other buckets are untouched by an item drop',
       names3.some(nm => nm.endsWith('track1.wav')));
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
