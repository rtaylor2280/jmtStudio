/**
 * A backup carries the per-file ownership records, and merge carries them too  [B-399]
 *
 * ⭐ THE SYMPTOM, found by him 2026-09-16: the "Already in your library (skipped)" row
 * vanished from the import breakdown. Cause, traced: his library held 151 fonts and
 * `.filehashes/entries/` held ZERO files, so `soundFontCompare.buildLibraryIndex` — which
 * reads those records and has NO fallback — returned an empty index, the ownership pass
 * never ran, and every font in the library became invisible to "do I already have this?".
 *
 * ⚠️⚠️ ONLY THE ENTRIES RECORDS ARE CORRECTNESS. Checked every consumer 2026-09-16:
 *   entries  -> buildLibraryIndex, NO fallback. A missing record is a font that cannot be
 *               matched, silently. This is the bug.
 *   commons  -> classifyIncomingCommon falls back to hashItemDir on a live walk.
 *   sources  -> ensureSourceManifest builds on demand, by design.
 * So commons and sources records are a speed cache and the entries ones are not. They are
 * all carried anyway because carrying costs 2.4 MB on a 6.18 GB archive and rebuilding
 * costs a full re-read of the library — but the entry is about fonts.
 *
 * ⭐⭐ AND THE SCOPE SHRANK TWICE, BOTH TIMES BECAUSE HE PUSHED. The first build also
 * REPAIRED degraded libraries — warmed missing records before archiving, rebuilt them after
 * restoring. His: "there is zero chance anyone could ever need it once this is repared...
 * we don't want to maintian code that isn't needed." He was right: the Sound Font Library is
 * new in 1.8 (v1.7.2 has no soundFontBackup.js at all — verified), so no shipped user can
 * hold an archive that predates the records, and no shipped library can be degraded once
 * the carry works. The repair had no audience and came out.
 *
 * ⭐ WHAT THE STRIP UNCOVERED, and it is the one part that reaches a user who never restored
 * anything: MERGE materialises items by raw zip extraction — no entry creation, no hash
 * recompute — so a merged font landed with no record and nothing anywhere to ever make one.
 *
 * ⚠️ REAL ROUND TRIPS, not source-text matching. The original defect was an ABSENT string,
 * which no matcher looking for one can see.
 *
 * Run: node test/hash-records-survive-backup.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const backup = require(path.join(ROOT, 'soundFontBackup'));
const fh     = require(path.join(ROOT, 'soundFontFileHash'));
const cmp    = require(path.join(ROOT, 'soundFontCompare'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const tmps = [];
function store() { const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b399-')); tmps.push(ud); return ud; }
function cleanup() { for (const t of tmps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} } }

// Deterministic filler behind a plausible RIFF header, so two differently-named files
// genuinely differ in bytes and no two hashes collide by accident.
function wav(seed, n) {
  const head = Buffer.from('RIFF....WAVEfmt ', 'ascii');
  const body = Buffer.alloc(n || 512);
  for (let i = 0; i < body.length; i++) body[i] = (seed * 31 + i * 7) & 0xff;
  return Buffer.concat([head, body]);
}

// Structurally REAL layouts — entry -> library/<name>, common -> common/<uuid>/files,
// source -> sources/<uuid>/source — so a mistake in any of them fails rather than quietly
// exercising nothing.
function buildLibrary(ud, { entries = 2, commons = 1, sources = 1, tag = 'a' } = {}) {
  const SF = path.join(ud, 'soundFonts');
  const ids = { entries: [], commons: [], sources: [] };
  for (let i = 0; i < entries; i++) {
    const name = `Font_${tag}${i}`;
    const dir = path.join(SF, 'library', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'hum.wav'), wav(i + 1));
    fs.writeFileSync(path.join(dir, 'boot.wav'), wav(i + 50));
    const uuid = `${tag}0000000-0000-4000-9000-00000000000${i}`;
    fs.writeFileSync(path.join(dir, 'meta.json'),
      JSON.stringify({ schemaVersion: '1', name, entryUuid: uuid }, null, 2));
    ids.entries.push({ name, uuid });
  }
  for (let i = 0; i < commons; i++) {
    const uuid = `${tag}1111111-1111-4111-9111-11111111111${i}`;
    const dir = path.join(SF, 'common', uuid, 'files');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'font.wav'), wav(i + 100));
    fs.writeFileSync(path.join(SF, 'common', uuid, 'meta.json'),
      JSON.stringify({ schemaVersion: '1', uuid, name: `Voicepack_${tag}${i}` }, null, 2));
    ids.commons.push(uuid);
  }
  for (let i = 0; i < sources; i++) {
    const uuid = `${tag}2222222-2222-4222-9222-22222222222${i}`;
    const dir = path.join(SF, 'sources', uuid, 'source');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'swing.wav'), wav(i + 200));
    fs.writeFileSync(path.join(SF, 'sources', uuid, 'meta.json'), JSON.stringify({
      schemaVersion: '1', uuid, format: 'folder', originalName: `Pack_${tag}${i}`, hash: `deadbeef${tag}${i}`,
    }, null, 2));
    ids.sources.push(uuid);
  }
  return { SF, ids };
}

// Write the records the way normal use does, through the app's own producers, so the
// fixture starts from the state a real library is in after importing.
async function warmRecords(ud, ids) {
  const entriesMod = require(path.join(ROOT, 'soundFontEntries'));
  const commonMod  = require(path.join(ROOT, 'soundFontCommon'));
  const sourcesMod = require(path.join(ROOT, 'soundFontSources'));
  for (const e of ids.entries) entriesMod.recomputeEntryContentHash(ud, e.name);
  for (const c of ids.commons) commonMod.recomputeCommonContentHash(ud, c);
  // ⚠ SOURCES NEED THEIR OWN CALL, and forgetting it produced a FALSE FAILURE the first
  // time this suite ran: the merge assertion said no source record rode along, and the real
  // reason was that the fixture library never had one to carry. A fixture that does not
  // reach the state under test reports on nothing.
  for (const u of ids.sources) await sourcesMod.ensureSourceManifest(ud, u);
}

const countIn = (dir) => { try { return fs.readdirSync(dir).length; } catch { return 0; } };

(async () => {

// ── ⭐⭐ THE SYMPTOM ITSELF: no record, no ownership answer ────────────────
{
  const ud = store();
  const { SF, ids } = buildLibrary(ud, { entries: 2, commons: 0, sources: 0 });
  await warmRecords(ud, ids);
  const healthy = cmp.buildLibraryIndex(ud);
  ok('a normal library answers ownership for every font',
     healthy.index.length === 2 && healthy.unmatchable === 0);

  // ⚠️ The stamped hash and the cheap signals still match the tree, so nothing recomputes
  // and nothing ever rewrites the record. That is why it never self-heals.
  fs.rmSync(path.join(SF, '.filehashes'), { recursive: true, force: true });
  const meta = JSON.parse(fs.readFileSync(path.join(SF, 'library', 'Font_a0', 'meta.json'), 'utf8'));
  ok('⚠️ setup is honest: the hash IS stamped and NOT dirty',
     !!meta.contentHash && meta.contentHashDirty === false);
  const blind = cmp.buildLibraryIndex(ud);
  ok('⭐⭐ without the records the index is EMPTY while the fonts sit on disk',
     blind.index.length === 0 && blind.unmatchable === 2,
     'this is what emptied ownedCount and deleted the "Already in your library" row');
}

// ── ⚠️ the other two buckets are NOT this bug, and the test says so ────────
//
// Asserted rather than assumed, because the first version of this fix treated all three
// alike and built a repair pass for buckets that repair themselves.
{
  const ud = store();
  const { SF, ids } = buildLibrary(ud, { entries: 0, commons: 1, sources: 0 });
  await warmRecords(ud, ids);
  const commonMod = require(path.join(ROOT, 'soundFontCommon'));
  const incoming = path.join(ud, 'incoming');
  fs.mkdirSync(incoming, { recursive: true });
  fs.copyFileSync(path.join(SF, 'common', ids.commons[0], 'files', 'font.wav'),
                  path.join(incoming, 'font.wav'));

  const withRecord = commonMod.classifyIncomingCommon(ud, incoming);
  ok('a voicepack you own is recognised', withRecord.ownedByContent === true);

  fs.rmSync(path.join(SF, '.filehashes'), { recursive: true, force: true });
  const without = commonMod.classifyIncomingCommon(ud, incoming);
  ok('⭐ and STILL recognised with no record at all — it falls back to a live walk',
     without.ownedByContent === true,
     'commons records are a speed cache, not correctness; treating them as broken is what produced a repair nobody needed');
}

// ── export carries them ───────────────────────────────────────────────────
{
  const ud = store();
  const { ids } = buildLibrary(ud);
  await warmRecords(ud, ids);
  const dest = path.join(ud, 'out.zip');
  const r = await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });

  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip.async({ file: dest, skipEntryNameValidation: true });
  const names = Object.keys(await zip.entries());
  const carried = names.filter(n => n.startsWith('.filehashes/') && !n.endsWith('/'));
  ok('⭐⭐ THE ARCHIVE CONTAINS THE RECORDS — the line that did not exist',
     carried.length >= 3, `found ${carried.length}`);
  ok('⭐ including one per FONT, keyed by entryUuid not by folder name',
     ids.entries.every(e => names.includes(`.filehashes/entries/${e.uuid}.json`)),
     'the directory name is the font name; the record key lives inside its meta.json');
  ok('the fonts are still carried too', names.some(n => n.startsWith('library/Font_a0/')),
     'adding a bucket must not disturb the five already carried');

  // ⚠️ The size shown to the user is the size of their LIBRARY, and it drives the estimate.
  const t = r.manifest.totals;
  ok('⚠️ the records are NOT counted in the reported library size',
     t.totalBytes === t.sources + t.library + t.common + t.sharedTracks + t.attachments,
     `totalBytes=${t.totalBytes}`);

  // ⭐ The repair is gone. Nothing rebuilds, nothing warms, nothing declares a survey.
  ok('⭐⭐ export reports no rebuild — that machinery is gone',
     !('hashBackfill' in r) && !r.manifest.hashManifests,
     'a repair pass for libraries that cannot exist is code nobody can maintain');
  await zip.close();
}

// ── replace-restore brings them back, and no longer destroys a good set ───
{
  const ud = store();
  const { SF, ids } = buildLibrary(ud);
  await warmRecords(ud, ids);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });

  fs.rmSync(SF, { recursive: true, force: true });
  const rr = await backup.applyReplace({ userData: ud, zipPath: dest });
  ok('⭐⭐ a restored library can answer ownership again',
     cmp.buildLibraryIndex(ud).index.length === 2,
     'the whole point: comparison works, not just whole-archive dedup');
  ok('and the records are physically there',
     countIn(path.join(SF, '.filehashes', 'entries')) === 2);
  ok('⭐ restore reports no rebuild either', !('hashBackfill' in rr));

  // ⚠️⚠️ THE REGRESSION THAT WAS WORSE THAN THE BUG: the full-replace path rmSyncs the
  // ENTIRE soundFonts root before unpacking, so restoring into a HEALTHY library used to
  // delete a working index and put nothing back.
  await backup.applyReplace({ userData: ud, zipPath: dest });
  ok('⭐⭐ restoring into a HEALTHY library leaves it healthy',
     cmp.buildLibraryIndex(ud).index.length === 2 &&
     countIn(path.join(SF, '.filehashes', 'entries')) === 2);
}

// ── ⭐⭐ MERGE: the half that reaches a user who never restored anything ───
{
  // Library A is backed up; library B is a DIFFERENT library that merges A's fonts in.
  const a = store();
  const A = buildLibrary(a, { entries: 2, commons: 1, sources: 1, tag: 'a' });
  await warmRecords(a, A.ids);
  const zipPath = path.join(a, 'a.zip');
  await backup.exportBackup({ userData: a, destPath: zipPath, appVersion: 'test' });

  const b = store();
  const B = buildLibrary(b, { entries: 1, commons: 0, sources: 0, tag: 'b' });
  await warmRecords(b, B.ids);
  const SFB = path.join(b, 'soundFonts');
  ok('library B starts healthy and knows its own font',
     cmp.buildLibraryIndex(b).index.length === 1);

  const plan = {
    library: { [A.ids.entries[0].name]: 'install', [A.ids.entries[1].name]: 'install' },
    common:  { [A.ids.commons[0]]: 'install' },
    sources: { [A.ids.sources[0]]: 'install' },
  };
  const mr = await backup.applyMerge({ userData: b, zipPath, plan });
  ok('the merge took the fonts', mr.counts.library.added === 2);

  ok('⭐⭐ EVERY MERGED FONT CAN ANSWER OWNERSHIP',
     cmp.buildLibraryIndex(b).index.length === 3,
     'merge extracts raw files — without this it creates no record and nothing ever will');
  ok('⚠️ B\'s own font was not disturbed',
     fs.existsSync(path.join(SFB, '.filehashes', 'entries', `${B.ids.entries[0].uuid}.json`)));
  ok('⭐ the merged records fold to their own digests',
     A.ids.entries.every(e => {
       const m = fh.readFileHashManifest(path.join(SFB, '.filehashes', 'entries', `${e.uuid}.json`));
       return m && fh.hashRecords(m.records) === m.contentHash;
     }));
  ok('the other two buckets ride along too',
     fs.existsSync(path.join(SFB, '.filehashes', 'commons', `${A.ids.commons[0]}.json`)) &&
     fs.existsSync(path.join(SFB, '.filehashes', 'sources', `${A.ids.sources[0]}.json`)));

  // ⭐⭐ NO ORPHANS. This is why merge extracts per item instead of unpacking the folder:
  // library A carried records for items B did not take in other runs, and a record for
  // content this library does not hold is a worse lie than a missing one.
  const orphan = path.join(SFB, '.filehashes', 'entries');
  const have = new Set(fs.readdirSync(orphan).map(f => f.replace(/\.json$/, '')));
  const expected = new Set([B.ids.entries[0].uuid, ...A.ids.entries.map(e => e.uuid)]);
  ok('⭐⭐ exactly the records for what is actually here, no more',
     have.size === expected.size && [...have].every(h => expected.has(h)),
     `have ${[...have].join(',')}`);
}

// ── ⚠️ a merge of only SOME items must not drag the rest in ───────────────
{
  const a = store();
  const A = buildLibrary(a, { entries: 3, commons: 0, sources: 0, tag: 'a' });
  await warmRecords(a, A.ids);
  const zipPath = path.join(a, 'a.zip');
  await backup.exportBackup({ userData: a, destPath: zipPath, appVersion: 'test' });

  const b = store();
  buildLibrary(b, { entries: 0, commons: 0, sources: 0, tag: 'b' });
  const SFB = path.join(b, 'soundFonts');
  await backup.applyMerge({ userData: b, zipPath,
    plan: { library: { [A.ids.entries[0].name]: 'install' }, common: {}, sources: {} } });

  ok('⭐⭐ one font merged means ONE record, not three',
     countIn(path.join(SFB, '.filehashes', 'entries')) === 1,
     'unpacking the archive\'s whole folder would plant records for fonts this library never received');
  ok('and it is the right one',
     fs.existsSync(path.join(SFB, '.filehashes', 'entries', `${A.ids.entries[0].uuid}.json`)));
}

// ── ⚠️ an OLD archive still merges and restores, it just brings no records ─
{
  const a = store();
  const A = buildLibrary(a, { entries: 1, commons: 0, sources: 0, tag: 'a' });
  await warmRecords(a, A.ids);
  const full = path.join(a, 'full.zip');
  await backup.exportBackup({ userData: a, destPath: full, appVersion: 'test' });

  // Rewrite it the way every archive taken before this change actually looks.
  const legacy = path.join(a, 'legacy.zip');
  {
    const StreamZip = require('node-stream-zip');
    const archiver = require('archiver');
    const zin = new StreamZip.async({ file: full, skipEntryNameValidation: true });
    const ents = await zin.entries();
    const out = fs.createWriteStream(legacy);
    const ar = archiver('zip', { zlib: { level: 0 } });
    const done = new Promise((res, rej) => { out.on('close', res); out.on('error', rej); ar.on('error', rej); });
    ar.pipe(out);
    for (const k of Object.keys(ents)) {
      const e = ents[k];
      if (e.isDirectory || e.name.startsWith('.filehashes/')) continue;
      ar.append(await zin.entryData(e.name), { name: e.name });
    }
    await ar.finalize(); await done; await zin.close();
  }

  const insp = await backup.inspectBackup(legacy);
  ok('⚠️ a pre-change archive still inspects cleanly', insp.ok === true);

  const b = store();
  const SFB = path.join(b, 'soundFonts');
  await backup.applyMerge({ userData: b, zipPath: legacy,
    plan: { library: { [A.ids.entries[0].name]: 'install' }, common: {}, sources: {} } });
  ok('⭐ it merges without throwing, and simply carries no record',
     fs.existsSync(path.join(SFB, 'library', A.ids.entries[0].name)) &&
     countIn(path.join(SFB, '.filehashes', 'entries')) === 0,
     'best-effort: a font with no record degrades exactly as it does today, it does not fail the merge');
  // ⚠⚠ AND IT LEAVES NO EMPTY SHELL. Found by mutation: dropping the "is it in the zip?"
  // check still passed every assertion above, because the extract simply throws into the
  // catch and a directory holding no files still counts zero. What actually changed was
  // that mkdirSync ran first and left an empty .filehashes tree behind on every legacy
  // merge — a store that LOOKS like it has records until you open it. Counting files could
  // not see that; asking whether the folder exists at all can.
  ok('⚠⚠ and creates no empty record folder at all',
     !fs.existsSync(path.join(SFB, '.filehashes')),
     'an empty .filehashes tree reads as "records live here" to anyone looking at the store');
}

cleanup();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall hash-record backup tests passed');
process.exit(failures ? 1 : 0);

})().catch(err => { cleanup(); console.error(err); process.exit(1); });
