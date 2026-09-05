// §13 dedup for a source stored as a TREE. [B-309]
//
// The rule is the same one the zip path implements: one canonical copy per unique
// file, Proffie preferred, verified before anything is replaced. What differs is
// that the duplicates become hardlinks, so nothing is removed and nothing has to
// reconstruct on read.
//
// The dangerous direction here is a tree that got SMALLER without staying WHOLE.
// A missing or wrong file after dedup is unrecoverable — the vendor's copy is the
// only one — so most of these cases exist to prove every original path still reads
// back exactly what the manifest recorded.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');

const S = require('../soundFontSources');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

function wav(payload) {
  const data = Buffer.from(payload);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii'); head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(44100, 24); head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// A folder-format source, built directly on disk. No import involved — that is the
// point of building the receiving end first: this can be proven before anything
// about import changes.
function makeFolderSource(files, uuid = 'src-uuid-0001') {
  const root     = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-dd-'));
  const userData = path.join(root, 'userData');
  const uuidDir  = path.join(S.sourcesRoot(userData), uuid);
  fs.mkdirSync(path.join(uuidDir, 'source'), { recursive: true });
  fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1, uuid, format: 'folder', originalName: 'Vendor Bundle',
    importedAt: '2026-09-04T00:00:00.000Z', hash: 'original-archive-hash-preserved',
  }));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(uuidDir, 'source', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return { userData, uuid, uuidDir, src: path.join(uuidDir, 'source') };
}

// The shape this exists for: one set of sounds shipped under three board formats.
const HUM = wav('HUM-BYTES-SHARED-ACROSS-BOARDS');
const SWG = wav('SWING-BYTES-SHARED-ACROSS-BOARDS');
const BUNDLE = {
  'Proffie/Ahsoka/hum.wav':      HUM,
  'Proffie/Ahsoka/swing1.wav':   SWG,
  'Xenopixel/Ahsoka/hum.wav':    HUM,
  'Xenopixel/Ahsoka/swing1.wav': SWG,
  'CFX/Ahsoka/hum.wav':          HUM,
  'CFX/Ahsoka/swing1.wav':       SWG,
  'readme.txt':                  'vendor notes, unique',
};

(async () => {
  {
    console.log('a multi-board bundle collapses to one copy per unique file');
    const { userData, uuid, src } = makeFolderSource(BUNDLE);

    const before = Object.keys(BUNDLE).map(r => sha(path.join(src, r)));
    const r = await S.dedupeSource(userData, uuid);

    check('it deduped', r.deduped === true, JSON.stringify(r));
    check('7 files, 3 unique', r.originalFiles === 7 && r.uniqueFiles === 3, JSON.stringify(r));
    check('4 duplicates linked', r.linkedFiles === 4, String(r.linkedFiles));

    // ⭐ The tree is still WHOLE — this is the assertion that matters most.
    const after = Object.keys(BUNDLE).map(r2 => sha(path.join(src, r2)));
    check('⭐ every original path still reads its original bytes',
      JSON.stringify(before) === JSON.stringify(after));
    check('every path still exists as a real file',
      Object.keys(BUNDLE).every(r2 => fs.statSync(path.join(src, r2)).isFile()));

    // ⭐ And it actually shares storage rather than just claiming to.
    const st = (r2) => fs.statSync(path.join(src, r2));
    check('⭐ duplicates share one inode', st('Xenopixel/Ahsoka/hum.wav').ino === st('Proffie/Ahsoka/hum.wav').ino,
      `${st('Xenopixel/Ahsoka/hum.wav').ino} vs ${st('Proffie/Ahsoka/hum.wav').ino}`);
    check('link count reflects the sharing', st('Proffie/Ahsoka/hum.wav').nlink === 3,
      String(st('Proffie/Ahsoka/hum.wav').nlink));
    check('the unique file is untouched', st('readme.txt').nlink === 1);

    // Proffie is the canonical, per _canonScore.
    check('Proffie is the copy everything points at',
      st('Proffie/Ahsoka/hum.wav').ino === st('CFX/Ahsoka/hum.wav').ino);
  }

  {
    console.log('identity and idempotence');
    const { userData, uuid, uuidDir } = makeFolderSource(BUNDLE);
    await S.dedupeSource(userData, uuid);
    const m = JSON.parse(fs.readFileSync(path.join(uuidDir, 'meta.json'), 'utf8'));
    // ⚠️ `hash` is the identity of what ARRIVED, not a digest of what we hold. The zip
    // path already relies on this — it rewrites source.zip and leaves hash alone — so a
    // dedup that changed it would break re-import recognition.
    check('⚠️ the source hash is NOT rewritten', m.hash === 'original-archive-hash-preserved', m.hash);
    check('it is flagged deduped', m.deduped === true);
    check('stats are recorded', m.dedupStats && m.dedupStats.uniqueFiles === 3,
      JSON.stringify(m.dedupStats));

    const again = await S.dedupeSource(userData, uuid);
    check('a second run is a no-op', again.deduped === false && again.reason === 'already',
      JSON.stringify(again));
  }

  {
    console.log('a source with nothing to share is left alone');
    const { userData, uuid, uuidDir } = makeFolderSource({
      'Proffie/hum.wav': wav('A'), 'Proffie/swing1.wav': wav('B'), 'readme.txt': 'C',
    });
    const r = await S.dedupeSource(userData, uuid);
    check('it reports no duplicates', r.deduped === false && r.reason === 'no-duplicates',
      JSON.stringify(r));
    const m = JSON.parse(fs.readFileSync(path.join(uuidDir, 'meta.json'), 'utf8'));
    check('and is NOT flagged deduped', !m.deduped);
  }

  {
    console.log('a file that no longer matches the manifest is skipped, not linked over');
    // Build the manifest first, then corrupt one duplicate behind its back. Dedup must
    // refuse to replace it — replacing would silently "fix" a file into the wrong bytes.
    const { userData, uuid, src } = makeFolderSource(BUNDLE);
    await S.ensureSourceManifest(userData, uuid);
    fs.writeFileSync(path.join(src, 'CFX/Ahsoka/hum.wav'), wav('TAMPERED-DIFFERENT-BYTES'));
    const r = await S.dedupeSource(userData, uuid);
    check('the tampered file kept its own bytes',
      sha(path.join(src, 'CFX/Ahsoka/hum.wav')) !== sha(path.join(src, 'Proffie/Ahsoka/hum.wav')));
    check('and it is counted as skipped rather than linked', (r.skipped || 0) >= 1, JSON.stringify(r));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
