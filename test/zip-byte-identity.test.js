// The archive's bytes are load-bearing, so changing HOW we feed archiver needs an assertion.
// [B-420]
//
// ⭐⭐ WHY THIS EXISTS, STATED CORRECTLY THE SECOND TIME. I first wrote that this archive's sha256
// IS the source identity dedup runs on, and repeated it while arguing for the change. **It is not.**
// A picked archive is identified by the sha256 of the file on the USER'S disk, taken before
// anything is written and never recomputed - and `zipFolderToFile`'s returned `hash` has no reader
// at all: every call site takes `fileCount`, `totalBytes`, `blockedFiles`, `notedFiles` and drops
// it. Checked, after asserting the opposite three times. (2026-09-24)
//
// ⭐ SO WHAT IT IS ACTUALLY FOR: this archive is a DELIVERABLE and a rebuildable artifact - the
// slim archive the space-optimizer writes is one of these - and its construction being
// reproducible is the property that lets a repack be compared, verified and reasoned about at all.
// A change to level, order, mode, date or entry construction is invisible to every other suite
// here, because an archive with entirely different bytes still has the right count of the right
// files. That is the gap this closes: not identity, reproducibility.
//
// ⭐ WHAT IS ACTUALLY ASSERTED: production's output, against a reference archive this file builds
// independently from the same inventory. Not a golden hash - a pinned digest would go red on an
// archiver or zlib bump for a reason that has nothing to do with us, and the thing worth pinning
// is the RELATIONSHIP, not the number.
//
// ⚠️⚠️ THE CONTROL GATES EVERYTHING. A comparison that cannot detect a difference answers
// "identical" to every question, and that reads exactly like a clean result. So a deliberately
// different archive is built too, and if the comparison calls THAT identical, this file refuses
// to report anything else.
// ⚠️ The first control written here FAILED and the instrument was fine: it perturbed a date to
// 1970-01-02, and a zip stores DOS time, which cannot represent a year before 1980 - so the
// perturbed date and EPOCH clamped to the same stored value. A control is a hypothesis too.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const StreamZip = require('node-stream-zip');
const { Transform } = require('stream');
const sfs = require('../soundFontSources');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// ⚠️ DETERMINISTIC CONTENT, NOT crypto.randomBytes. A failure has to be reproducible on the next
// run, and random fixtures make a red test a different red test every time.
//
// ⚠️⚠️ AND IT IS MID-ENTROPY ON PURPOSE, WHICH IS THE WHOLE DIFFERENCE BETWEEN THIS FILE BEING A
// RATCHET AND BEING DECORATION. The first fixture here used full-range pseudo-random bytes and
// blocks of zeros - and a deliberate mutation of the compression level SURVIVED it. Measured:
// deflate emits byte-identical output at level 1 and level 2 for both incompressible and
// trivially-compressible input, so a fixture built from those two extremes cannot see a
// compression change at all. Real audio sits in between, which is exactly where the levels
// diverge. **A fixture at the extremes agrees with every setting, and reads as a clean pass.**
function lcg(n, seed) {
  const out = Buffer.alloc(n);
  let s = seed >>> 0;
  // >>> 28 keeps values in a 4-bit range: structured enough for deflate to find matches, varied
  // enough that it is not one long run. This is what makes a level change visible.
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; out[i] = s >>> 28; }
  return out;
}

// A real RIFF/WAVE header, because _selectFolderFiles strips a .wav whose header does not parse -
// a stripped file is not in the archive, and the test would then be comparing two archives that
// both correctly omit it while proving nothing about the ones that matter.
function wav(dataBytes, seed) {
  const data = lcg(dataBytes, seed);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-zipid-'));
const srcDir = path.join(root, 'src');
const extraDir = path.join(root, 'payload');
fs.mkdirSync(path.join(srcDir, 'xenopixelv3'), { recursive: true });
fs.mkdirSync(extraDir, { recursive: true });

// ⚠️ The shapes that have actually bitten this archive: a name with a space and parentheses
// (the screenshots was `track (3).wav`), a large incompressible entry, a very compressible one,
// and a nested folder. Not a generic fixture - these are the cases that exist in real fonts.
const tree = [
  ['font.txt', Buffer.from('JMT\n')],
  ['xenopixelv3/hum.wav', wav(600 * 1024, 11)],
  ['xenopixelv3/track (3).wav', wav(300 * 1024, 22)],
  ['xenopixelv3/zeros.bin', Buffer.alloc(400 * 1024)],
  // Text-shaped, so the fixture spans the compressibility range rather than only its ends.
  ['xenopixelv3/config.ini', Buffer.from(
    Array.from({ length: 4000 }, (_, i) => `hum${i % 97}=swing${i % 13},clash\n`).join(''))],
];
for (const [rel, buf] of tree) fs.writeFileSync(path.join(srcDir, rel.split('/').join(path.sep)), buf);

// The curation payload: a buffer entry (the sidecar, which never becomes a file) and a real file
// on disk outside the source tree - the two entry kinds `planForArchive` hands back.
fs.writeFileSync(path.join(extraDir, 'DookuTheme.wav'), wav(200 * 1024, 33));
const extraEntries = [
  { name: '.jmt-curation.json', buffer: Buffer.from(JSON.stringify({ v: 1 }, null, 2), 'utf8') },
  { name: '.jmt-curation/customized/0/DookuTheme.wav', absPath: path.join(extraDir, 'DookuTheme.wav') },
];

const EPOCH = new Date(0);
const MODE = 0o644;

// An independent reference archive, built from the same inventory with the plainest possible
// archiver usage. `perturb` is the control: it changes one entry's date to a year a zip CAN
// represent, so a blind comparison is detectable.
function reference(destZip, { perturb = false } = {}) {
  return new Promise((resolve, reject) => {
    const files = sfs.walkFolderSorted(srcDir);
    const archive = archiver('zip', { zlib: { level: 1 }, forceZip64: true, statConcurrency: 1 });
    const hasher = crypto.createHash('sha256');
    const tap = new Transform({ transform(c, _e, cb) { hasher.update(c); this.push(c); cb(); } });
    const out = fs.createWriteStream(destZip);
    archive.pipe(tap).pipe(out);
    archive.on('error', reject);
    out.on('close', () => resolve(hasher.digest('hex')));
    // ⚠️⚠️ EVERY ENTRY GOES IN THE SAME WAY, AND THAT IS THE POINT OF THIS REFERENCE.
    // The production code used to MIX `archive.file()` for disk entries with `archive.append()`
    // for the buffer sidecar, and those use two different queues: an entry carrying stats goes
    // straight onto the ordered queue while a bare `file()` waits in `_statQueue` to be stat-ed
    // first. Measured consequence - the sidecar came out FIRST, ahead of the vendor tree, while
    // the code's own comment said "APPENDED LAST, AFTER the sorted files, so the archive stays
    // order-deterministic". The comment described the submission order, not the archive.
    const entries = [
      ...files.map((f) => ({
        name: f.relPath,
        absPath: f.absPath,
        date: (perturb && f.relPath === 'font.txt') ? new Date('2020-06-01T12:00:00Z') : EPOCH,
      })),
      ...extraEntries.map((e) => ({ ...e, date: EPOCH })),
    ];
    for (const e of entries) {
      if (e.buffer) archive.append(e.buffer, { name: e.name, date: e.date, mode: MODE });
      else archive.append(fs.createReadStream(e.absPath),
                          { name: e.name, date: e.date, mode: MODE, stats: fs.statSync(e.absPath) });
    }
    archive.finalize();
  });
}

(async () => {
  console.log('zip-byte-identity');

  const refHash = await reference(path.join(root, 'ref.zip'));
  const ctrlHash = await reference(path.join(root, 'ctrl.zip'), { perturb: true });

  // ⚠️⚠️ NOTHING BELOW IS REPORTED IF THE CONTROL CANNOT TELL TWO ARCHIVES APART.
  if (refHash === ctrlHash) {
    console.log('  FAIL ⚠️⚠️ CONTROL: a deliberately different archive hashed the same');
    console.log('       The comparison is blind, so every identity result here would be vacuous.');
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(1);
  }
  ok('⭐ control: a deliberately different archive does NOT match', refHash !== ctrlHash);

  const r = await sfs.zipFolderToFile(srcDir, path.join(root, 'prod.zip'), null, { extraEntries });

  ok('⭐⭐ zipFolderToFile is byte-identical to the reference archive', r.hash === refHash,
     `production ${r.hash}\n       reference  ${refHash}\n`
     + '       The stored source hash is what dedup matches on, so this changing means every '
     + 'export re-hashes and stops matching sources already in the library.');

  // The inventory the bar divides by. A denominator that leaves the payload out is the defect
  // that sent this whole change: 362.9 MB reported against a 7.7 MB total.
  const vendorBytes = sfs.walkFolderSorted(srcDir).reduce((s, f) => s + f.size, 0);
  const extraBytes = extraEntries.reduce(
    (s, e) => s + (e.buffer ? e.buffer.length : fs.statSync(e.absPath).size), 0);
  ok('⭐ twas reported total counts the payload, not just the vendor tree',
     r.totalBytes === vendorBytes + extraBytes,
     `reported ${r.totalBytes}, vendor ${vendorBytes} + payload ${extraBytes} `
     + `= ${vendorBytes + extraBytes}`);
  ok('twas reported file count counts the payload too',
     r.fileCount === tree.length + extraEntries.length,
     `reported ${r.fileCount}, expected ${tree.length + extraEntries.length}`);

  // ⭐⭐ THE ORDER IS ASSERTED SEPARATELY FROM THE BYTES, because a hash comparison says only
  // "something moved" and this says WHAT. The sidecar landing first was invisible for as long as
  // it existed: it broke no test, produced a valid archive, and contradicted only a comment.
  // ⚠️ node-stream-zip, because that is what the app itself reads archives with. A test that
  // opens the artifact with a different library is answering a slightly different question.
  const namesInZip = await (async () => {
    const zip = new StreamZip.async({ file: path.join(root, 'prod.zip'),
                                      skipEntryNameValidation: true });
    try { return Object.keys(await zip.entries()); } finally { await zip.close(); }
  })();
  const sidecarAt = namesInZip.indexOf('.jmt-curation.json');
  const lastVendorAt = namesInZip.indexOf('xenopixelv3/zeros.bin');
  ok('⭐ the curation payload is written AFTER the vendor tree, as the code says it is',
     sidecarAt > lastVendorAt && sidecarAt !== -1 && lastVendorAt !== -1,
     `sidecar at ${sidecarAt}, last vendor entry at ${lastVendorAt}\n       `
     + `order: ${JSON.stringify(namesInZip)}`);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(failed ? `\nzip-byte-identity: ${failed} FAILED` : '\nzip-byte-identity: all passing');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.error('zip-byte-identity: threw', e);
  process.exit(1);
});
