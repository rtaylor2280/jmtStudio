/**
 * A track's home is the tracks folder  [B-406]
 *
 * ⭐⭐ HIS MODEL, 2026-09-17, and it turned out to be the ORIGINAL design: "I just assumed that
 * tracks was its own pool because it's the only dynamic source. so when I add a track, that is
 * its home." [B-315] and [B-316] both say the content pool was MODELLED on sharedTracksHash —
 * "exactly like sharedTracks, which is already this pattern and proves it works." Tracks was
 * always a pool. The first cut of [B-406] routed tracks through storeInPool and so layered a
 * second pool on top of the first, giving every novel track a redundant name.
 *
 * ⭐ THE RULE THIS PINS, which had never been written down anywhere:
 *     a bucket that IS a home         -> ingest alone            (commons, tracks)
 *     content with no home of its own -> storeInPool, then ingest (font + Add)
 * A font file picked off the desktop has nowhere to live. A track has the tracks folder.
 *
 * ⚠️ What must NOT regress is the thing [B-406] was actually for: a track whose bytes the
 * library already holds anywhere must LINK, not copy. That is the dedup, and it is separate
 * from where novel audio lives.
 *
 * Run: node test/track-pool-reclaim.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tracks = require(path.join(__dirname, '..', 'soundFontSharedTracks.js'));
const CI     = require(path.join(__dirname, '..', 'soundFontContentIndex.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

function makeWav(dir, name, size, seed) {
  const buf = Buffer.alloc(size);
  buf.write('RIFF', 0); buf.write('WAVE', 8);
  for (let i = 12; i < size; i += 613) buf[i] = (seed * 17 + i) & 0xff;
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  return p;
}
const poolFiles = (u) => {
  try { return fs.readdirSync(CI.poolRoot(u)).filter(f => !f.startsWith('.')); } catch { return []; }
};
const ino = (p) => { try { return String(fs.statSync(p).ino); } catch { return null; } };

(async () => {
  const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'b406-'));
  const src  = path.join(tmp, 'src');
  const user = path.join(tmp, 'userData');
  fs.mkdirSync(src); fs.mkdirSync(user, { recursive: true });

  const SIZE = 512 * 1024;
  const a = makeWav(src, 'alpha.wav', SIZE, 1);
  const b = makeWav(src, 'beta.wav',  SIZE, 2);

  // ── novel audio lives in the tracks folder, full stop ────────────────────
  await tracks.addFiles(user, [a, b]);
  ok('both tracks added', tracks.listFiles(user).length === 2);

  ok('⭐⭐ novel track audio is NOT copied into the pool', poolFiles(user).length === 0,
     `pool holds ${poolFiles(user).length} — a track's home is the tracks folder`);

  const trackRoot = tracks.sharedTracksRoot(user);
  const alphaAbs = path.join(trackRoot, 'alpha.wav');
  ok('⭐ and the track owns its bytes — one name, no duplicate',
     fs.statSync(alphaAbs).nlink === 1, `nlink ${fs.statSync(alphaAbs).nlink}`);

  // ── the dedup that [B-406] exists for, in the other direction ────────────
  // ⚠️⚠️ THIS IS THE ASSERTION THAT MUST NEVER REGRESS. Content the library already holds must
  // be linked, never copied — whichever bucket holds it first.
  const fontDir = path.join(user, 'soundFonts', 'library', 'SomeFont');
  fs.mkdirSync(fontDir, { recursive: true });
  const fontWav = makeWav(src, 'shared.wav', SIZE, 42);

  // ⚠️⚠️ REGISTER IT THE WAY THE APP DOES. The first draft just copied a wav into a bare font
  // directory and asserted the next add would link to it — but buildIndex learns about a font's
  // files from its .filehashes manifest, which a hand-copied file has no entry in. The index
  // could not see it, the add correctly copied, and the test failed against working code.
  // storeInPool is a real registration path (it writes the pool index), so the content is
  // genuinely discoverable — which is what the assertion is actually about.
  const reg = CI.storeInPool({ index: CI.buildIndex(user), srcAbs: fontWav, preferredName: 'shared.wav' });
  ok('the fixture content is registered in the library', !!(reg && reg.ok), JSON.stringify(reg));
  fs.linkSync(reg.absPath, path.join(fontDir, 'shared.wav'));

  await tracks.addFiles(user, [fontWav]);
  const landed = path.join(trackRoot, 'shared.wav');
  ok('the matching track landed', fs.existsSync(landed));
  ok('⭐⭐ a track matching content the library already holds is LINKED, not copied',
     ino(landed) !== null && ino(landed) === ino(path.join(fontDir, 'shared.wav')),
     'different inodes means a second physical copy — the defect this entry was filed for');

  // ── deleting a track frees its bytes ─────────────────────────────────────
  const r = tracks.deleteFile(user, 'alpha.wav');
  ok('the delete reported ok', !!(r && r.ok), JSON.stringify(r));
  ok('⭐ deleting a track removes its only name, so the space comes back',
     !fs.existsSync(alphaAbs));

  // ⚠️ A track that shares bytes with a font must not take the font's copy with it.
  tracks.deleteFile(user, 'shared.wav');
  ok('⚠️⚠️ deleting a SHARED track leaves the font copy intact',
     fs.existsSync(path.join(fontDir, 'shared.wav')),
     'the font names those bytes too — dropping one name must never destroy the other');

  // ── the pool sweep is still wired, and is still selective ────────────────
  // A track CAN name a pooled file (when a font + Add pooled that content first), so the
  // sweep still has to run on delete. Prove it removes an orphan and spares a named file.
  const orphanSrc = makeWav(src, 'orphan.wav', SIZE, 7);
  const poolRoot = CI.ensurePoolRoot(user);
  const orphanPool = path.join(poolRoot, 'orphan.wav');
  fs.copyFileSync(orphanSrc, orphanPool);                       // nlink 1 — nothing names it
  const keptPool = path.join(poolRoot, 'kept.wav');
  fs.copyFileSync(makeWav(src, 'kept.wav', SIZE, 8), keptPool);
  fs.linkSync(keptPool, path.join(fontDir, 'kept.wav'));        // nlink 2 — a font names it

  tracks.deleteFile(user, 'beta.wav');                          // triggers the sweep
  ok('⭐ the sweep runs on a track delete and drops an unnamed pool file',
     !fs.existsSync(orphanPool));
  ok('⚠️⚠️ and spares a pool file a font still names', fs.existsSync(keptPool),
     'a sweep that frees everything is not a fix — it is data loss');
  ok('   the font copy survives too', fs.existsSync(path.join(fontDir, 'kept.wav')));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall track home/dedup tests passed');
  process.exit(failures ? 1 : 0);
})();
