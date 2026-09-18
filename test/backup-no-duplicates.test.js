/**
 * A restore never duplicates audio the library already holds  [B-407]
 *
 * ⭐⭐ HIS RULE, 2026-09-17, stated as absolute: "When we backup/import/merge it can't duplicate
 * a file. No duplicates ever." And his scenario, which is what this file exists to prove:
 *
 *     back up  →  delete a track  →  add that same track to a FONT instead  →  merge the backup
 *     "Should only see that track the one time."
 *
 * At merge time those bytes ARE in the library — inside the font — so the restore has to
 * recognise them and link. Raw extraction cannot: it has no idea what is already held.
 *
 * ⚠️⚠️ AND THE SECOND HALF IS BIGGER THAN THE FIRST. Hardlinks do not survive a zip, so every
 * NAME in the library becomes its own entry carrying its own bytes. Measured on his real backup:
 * 18,465 wav entries, 5,649 distinct — 4.24 GB of a 6.80 GB archive is the same audio stored
 * again. A restore that faithfully rebuilds that inflates the library by the exact amount the
 * linking had saved. So an archive containing the same sound twice must land as ONE blob.
 *
 * ⚠️ MEASURE BY INODE, NEVER BY SIZE OR COUNT. Apparent size cannot see this: a folder reports
 * the same whether its files share storage or not. Only counting unique inodes distinguishes one
 * blob with several names from several blobs.
 *
 * Run: node test/backup-no-duplicates.test.js
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
const ino = (p) => { try { return String(fs.statSync(p).ino); } catch { return null; } };
const nlink = (p) => { try { return fs.statSync(p).nlink; } catch { return 0; } };

// A wav whose bytes are unique per seed.
function wav(size, seed) {
  const b = Buffer.alloc(size);
  b.write('RIFF', 0); b.write('WAVE', 8);
  for (let i = 12; i < size; i += 409) b[i] = (seed * 37 + i) & 0xff;
  return b;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b407-'));
  const SIZE = 256 * 1024;

  // ── Build an archive by hand, so the fixture states the contract ────────
  // ⚠️ archiver is what the real export uses, so the zip is shaped the same way.
  const archiver = require(path.join(__dirname, '..', 'node_modules', 'archiver'));
  const zipPath = path.join(tmp, 'library.zip');

  const TRACK = wav(SIZE, 1);        // the track in his scenario
  const TWIN  = wav(SIZE, 2);        // one sound stored under two names in the archive

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const ar = archiver('zip', { zlib: { level: 0 } });
    out.on('close', resolve); ar.on('error', reject);
    ar.pipe(out);
    ar.append(JSON.stringify({
      type: 'jmt-soundfontlibrary', version: 1, createdAt: new Date(0).toISOString(),
    }), { name: 'manifest.json' });
    ar.append(TRACK, { name: 'sharedTracks/theme.wav' });
    // ⚠️ THE SAME BYTES UNDER TWO NAMES — what a zip of a hardlinked library actually looks like.
    ar.append(TWIN, { name: 'library/FontA/hum.wav' });
    ar.append(TWIN, { name: 'library/FontB/hum.wav' });
    ar.finalize();
  });
  ok('the fixture archive was written', fs.existsSync(zipPath));

  // ── A library that ALREADY holds the track, inside a font ───────────────
  // This is his scenario exactly: the track was deleted from sharedTracks and added to a font.
  const user = path.join(tmp, 'userData');
  const sfRoot = path.join(user, 'soundFonts');
  const fontDir = path.join(sfRoot, 'library', 'Keeper');
  fs.mkdirSync(fontDir, { recursive: true });
  fs.mkdirSync(path.join(sfRoot, 'sharedTracks'), { recursive: true });
  const heldInFont = path.join(fontDir, 'theme.wav');
  fs.writeFileSync(heldInFont, TRACK);

  // Make it discoverable the way the app does — through the pool index.
  const CI = require(path.join(__dirname, '..', 'soundFontContentIndex.js'));
  const reg = CI.storeInPool({ index: CI.buildIndex(user), srcAbs: heldInFont, preferredName: 'theme.wav' });
  ok('the font copy is registered in the library', !!(reg && reg.ok), JSON.stringify(reg));
  try { fs.rmSync(heldInFont, { force: true }); fs.linkSync(reg.absPath, heldInFont); } catch {}

  const before = ino(heldInFont);

  // ── Merge the backup ────────────────────────────────────────────────────
  let res;
  try {
    res = await backup.applyMerge({
      userData: user,
      zipPath,
      // ⚠️ A PLAN ENTRY IS A MODE STRING, NOT A BOOLEAN. The first draft passed `true` and both
      // fonts were silently skipped by `if (!mode || mode === 'keep') continue` — so the test
      // failed against working code and looked like a dedup bug. Valid modes: install / replace
      // / both / keep.
      plan: { sources: {}, library: { FontA: 'install', FontB: 'install' }, common: {}, sharedTracks: true },
    });
  } catch (err) { res = { ok: false, error: String(err && err.message || err) }; }
  ok('the merge completed', !!(res && (res.ok !== false)), JSON.stringify(res && res.error));

  // ── HIS CASE: the track comes back as a NAME, not a copy ────────────────
  const restoredTrack = path.join(sfRoot, 'sharedTracks', 'theme.wav');
  ok('the track was restored', fs.existsSync(restoredTrack));
  ok('⭐⭐ the restored track LINKS to the copy already in the font',
     ino(restoredTrack) !== null && ino(restoredTrack) === before,
     `restored inode ${ino(restoredTrack)} vs held ${before} — a different inode means a second `
     + 'physical copy, which is exactly what he said must never happen');

  // ── THE ARCHIVE'S OWN DUPLICATION COLLAPSES ─────────────────────────────
  const a = path.join(sfRoot, 'library', 'FontA', 'hum.wav');
  const b = path.join(sfRoot, 'library', 'FontB', 'hum.wav');
  ok('both fonts restored their file', fs.existsSync(a) && fs.existsSync(b));
  ok('⭐⭐ one sound stored twice in the zip lands as ONE blob',
     ino(a) !== null && ino(a) === ino(b),
     'hardlinks do not survive a zip, so an archive holds every name separately — restoring that '
     + 'faithfully is what inflates a library by the amount the linking had saved');
  ok('⚠️ and it really is shared, not merely equal', nlink(a) >= 2, `nlink ${nlink(a)}`);

  // ── The content must still be CORRECT, not just shared ──────────────────
  ok('⚠️⚠️ the restored track has the right bytes',
     fs.readFileSync(restoredTrack).equals(TRACK),
     'linking to the wrong blob would be silent corruption — worse than a duplicate');
  ok('⚠️⚠️ and so do both font files',
     fs.readFileSync(a).equals(TWIN) && fs.readFileSync(b).equals(TWIN));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall backup de-duplication tests passed');
  process.exit(failures ? 1 : 0);
})();
