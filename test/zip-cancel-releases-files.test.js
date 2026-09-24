// A cancelled export must not keep the source files open. [B-420]
//
// ⭐⭐ THE DEFECT THIS EXISTS FOR, and it reached a real library the day it shipped. Chunk-level
// progress meant taking ownership of the read streams — `archive.file(path)` became
// `archive.append(ourStream)` — and that quietly took on the lifecycle archiver used to handle.
// `archive.abort()` stops PULLING and drops the source WITHOUT destroying it, so an abandoned
// generator sits suspended at its `yield` holding an open descriptor indefinitely.
//
// He cancelled a few exports, then deleted the font and got:
//     ENOTEMPTY: directory not empty, rmdir '...\soundFonts\library\Decay'
// with exactly one file locked — the 26.7 MB payload wav ta cancel of export had been reading.
// ⚠️ NOT A TEST ARTIFACT: any user who cancels an export leaks a handle per in-flight file and
// then cannot delete that font.
//
// ⭐ THIS TEST RUNS THE REAL FUNCTION AND THEN TRIES TO DELETE THE FIXTURE, because that is the
// symptom. A grep for `destroy()` would have passed against code that called it on a path the
// abort never takes — the whole point is that the abort path is the one nobody calls back into.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const sfs = require('../soundFontSources');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// Deterministic, mid-entropy, and big enough that a cancel lands mid-read rather than between
// entries — a cancel that only ever fires on an entry boundary cannot reproduce this at all.
function blob(n, seed) {
  const out = Buffer.alloc(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; out[i] = s >>> 28; }
  return out;
}
function wav(dataBytes, seed) {
  const d = blob(dataBytes, seed);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(d.length, 40);
  return Buffer.concat([h, d]);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-cancel-'));
const srcDir = path.join(root, 'src');
fs.mkdirSync(srcDir, { recursive: true });
for (let i = 0; i < 6; i++) {
  fs.writeFileSync(path.join(srcDir, `track${i}.wav`), wav(6 * 1024 * 1024, 11 + i));
}

(async () => {
  console.log('zip-cancel-releases-files');

  // Cancel shortly after the first bytes move — mid-entry, which is the case that leaked.
  const t0 = Date.now();
  let threw = null;
  try {
    await sfs.zipFolderToFile(srcDir, path.join(root, 'out.zip'), null, {
      shouldStop: () => Date.now() - t0 > 120,
    });
  } catch (e) { threw = e; }

  ok('the export stopped rather than completing', !!threw,
     'if it finished, the fixture is too small to cancel mid-entry and this proves nothing');

  // ⚠️ THE ASSERTION IS THE SYMPTOM. On Windows an open handle makes unlink fail and the parent
  // rmdir then fails ENOTEMPTY — which is the exact error it was shown.
  let rmErr = null;
  try { fs.rmSync(srcDir, { recursive: true }); } catch (e) { rmErr = e; }
  ok('⭐⭐ the source folder can be deleted after a cancel', rmErr === null,
     `rmSync failed: ${rmErr && rmErr.code} ${rmErr && rmErr.message}\n       `
     + 'a cancelled export is still holding a file open — the leak is back');

  // A second, independent read of the same fact, because rmSync can succeed on some platforms
  // even with a handle open and this suite must not be POSIX-only in what it can detect.
  if (rmErr !== null && fs.existsSync(srcDir)) {
    const left = fs.readdirSync(srcDir);
    ok('nothing is left behind', left.length === 0, `still present: ${left.join(', ')}`);
  }

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(failed ? `\nzip-cancel-releases-files: ${failed} FAILED`
                     : '\nzip-cancel-releases-files: all passing');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.error('zip-cancel-releases-files: threw', e);
  process.exit(1);
});
