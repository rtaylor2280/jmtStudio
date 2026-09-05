// [B-309] slice 1b — importSource actually STORES the extracted tree.
//
// Slice 1a proved the two writers and the identity hash in isolation. That
// proves nothing about whether the import pipeline calls them, which is a
// distinct claim and the one that reaches the user. This file drives the real
// importSource against a real temp userData and asserts on what lands on disk.
//
// The properties that matter, in the order they would hurt if broken:
//   1. Nothing writes source.zip any more, and uuid/source/ holds the files.
//   2. meta.hash is the CONTENT identity, so the same font arriving as a zip and
//      as a folder is one source, not two. This is a new capability, not a
//      refactor: today those are unrelated numbers and the second import lands
//      as a silent duplicate of gigabytes.
//   3. The picked archive's own sha256 survives as originArchiveHash on EVERY
//      zip import - not only on restores, which is where it used to be written.
//      Without it, re-picking a file you already imported is not recognised.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');

const S = require('../soundFontSources');
const E = require('../soundFontEntries');
const C = require('../soundFontCandidates');

// ⚠️ EVERY importSource STARTS BY SWEEPING SOURCES NO ENTRY REFERENCES. A source
// imported and left entry-less is deleted by the NEXT import - so a fixture that
// imports twice without creating entries destroys its own subject and every
// duplicate assertion then fails for the wrong reason. The app always follows an
// import with entry creation; the test has to as well to be about anything.
async function adopt(ud, uuid) {
  const src = S.openSource(ud, uuid);
  const { candidates } = await C.detectCandidates(src);
  if (!candidates || !candidates.length) throw new Error('no candidate detected in fixture');
  const r = await E.createEntry({ userData: ud, sourceUuid: uuid, candidate: candidates[0], name: candidates[0].name });
  if (!r || !r.ok) throw new Error('createEntry failed: ' + (r && r.error));
  return r;
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

function tmp(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-b309b-' + tag + '-')); }

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

function makeZip(srcDir, destZip) {
  return new Promise((resolve, reject) => {
    const archiver = require('archiver');
    const ws = fs.createWriteStream(destZip);
    const ar = archiver('zip', { zlib: { level: 1 } });
    ws.on('close', resolve);
    ar.on('error', reject);
    ar.pipe(ws);
    ar.directory(srcDir, false);
    ar.finalize();
  });
}

// Real RIFF header — checkWavHealth validates the data chunk against file size,
// so a bare string reads as corrupt and the strip would eat the fixture.
function wav(payload) {
  const data = Buffer.from(payload);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(44100, 24);
  head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const FONT = {
  'Ahsoka/hum.wav':     wav('HUM-BYTES'),
  'Ahsoka/swing1.wav':  wav('SWING-BYTES'),
  'Ahsoka/blst/b1.wav': wav('BLST-BYTES'),
  'Ahsoka/config.ini':  'font.wav=1\n',
};

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

(async () => {
  console.log('[B-309 1b] importSource stores extracted\n');

  // ── A zip import ─────────────────────────────────────────────────────────
  const ud      = tmp('ud');
  const content = write(tmp('content'), FONT);
  const zipPath = path.join(tmp('zips'), 'Ahsoka Bundle.zip');
  await makeZip(content, zipPath);
  const pickedHash = sha256(zipPath);
  const pickedSize = fs.statSync(zipPath).size;

  const r1 = await S.importSource({ userData: ud, sourcePath: zipPath, originalName: 'Ahsoka Bundle.zip' });
  check('zip import succeeds', r1 && r1.ok, r1 && r1.error);
  await adopt(ud, r1.uuid);   // the source is now referenced, as it is in the app

  const dir1  = path.join(ud, 'soundFonts', 'sources', r1.uuid);
  const meta1 = JSON.parse(fs.readFileSync(path.join(dir1, 'meta.json'), 'utf8'));

  check('no source.zip is written',      !fs.existsSync(path.join(dir1, 'source.zip')));
  check('uuid/source/ holds the tree',    fs.existsSync(path.join(dir1, 'source', 'Ahsoka', 'hum.wav')));
  check("meta.format is 'folder'",        meta1.format === 'folder', meta1.format);
  check('meta.hash is the CONTENT hash',
    meta1.hash === require('../soundFontFileHash').hashItemDir(path.join(dir1, 'source')), meta1.hash);
  check('meta.hash is NOT the archive bytes', meta1.hash !== pickedHash);
  check('originArchiveHash records the picked file', meta1.originArchiveHash === pickedHash, meta1.originArchiveHash);
  check('originArchiveSize records its size',        meta1.originArchiveSize === pickedSize, String(meta1.originArchiveSize));
  check('originalName survives',                     meta1.originalName === 'Ahsoka Bundle.zip');

  // ── Re-picking the SAME zip is recognised, via originArchiveHash ──────────
  const r2 = await S.importSource({ userData: ud, sourcePath: zipPath, originalName: 'Ahsoka Bundle.zip' });
  check('re-picking the same zip is a duplicate', r2 && r2.ok && r2.isDuplicate === true);
  check('  ...and points at the first source',    r2 && r2.uuid === r1.uuid);

  // ── ⭐ THE NEW CAPABILITY: same content, other container ──────────────────
  // The identical font handed over as a FOLDER. Under the old scheme this
  // produced an unrelated hash and imported a second full copy.
  const r3 = await S.importSource({ userData: ud, sourcePath: content, originalName: 'Ahsoka' });
  check('the same content as a FOLDER is a duplicate', r3 && r3.ok && r3.isDuplicate === true,
    r3 && `isDuplicate=${r3.isDuplicate} hash=${r3.hash}`);
  check('  ...resolves to the same source',            r3 && r3.uuid === r1.uuid);
  check('  ...and stages the extracted tree for reuse', !!(r3 && r3.staged && r3.staged.uuid));

  // ── The source is readable through the normal abstraction ────────────────
  const src = S.openSource(ud, r1.uuid);
  check('openSource returns a source', !!src);
  const all = src ? await src.listAll() : [];
  const names = all.filter(e => !e.isDir).map(e => e.fileName).sort();
  check('listAll sees all four files', names.length === 4, names.join(','));
  const humBuf = src ? await src.readFile('Ahsoka/hum.wav') : null;
  check('readFile returns real bytes', !!humBuf && humBuf.equals(FONT['Ahsoka/hum.wav']));

  // ── A folder import on its own gets no archive identity ──────────────────
  const ud2 = tmp('ud2');
  const r4  = await S.importSource({ userData: ud2, sourcePath: content, originalName: 'Ahsoka' });
  await adopt(ud2, r4.uuid);
  const meta4 = JSON.parse(fs.readFileSync(path.join(ud2, 'soundFonts', 'sources', r4.uuid, 'meta.json'), 'utf8'));
  check('folder import succeeds',                 r4 && r4.ok, r4 && r4.error);
  check('folder import has NO originArchiveHash', !meta4.originArchiveHash,
    'a folder was never delivered as an archive, so claiming one would be a lie');
  check('folder and zip agree on identity',       meta4.hash === meta1.hash,
    `${meta4.hash} vs ${meta1.hash}`);

  // ── Mutation guard: prove these assertions CAN fail ───────────────────────
  // A test whose failure case is unreachable is decoration.
  const canFail = (() => {
    const probe = path.join(dir1, 'source', 'Ahsoka', 'hum.wav');
    const before = fs.readFileSync(probe);
    fs.writeFileSync(probe, wav('TAMPERED'));
    const after = require('../soundFontFileHash').hashItemDir(path.join(dir1, 'source'));
    fs.writeFileSync(probe, before);
    return after !== meta1.hash;
  })();
  check('MUTATION CHECK: editing a stored file changes the identity', canFail,
    'the content hash is not actually reading the stored tree');

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
