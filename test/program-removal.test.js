// [B-364] Removing a program from the managed store: delete, and quarantine-inert.
//
// Runs against a synthetic userData tree rather than the real library, because every
// assertion here is about DESTROYING a file and the only honest place to prove that is
// a store the test built itself.
//
// The cases that matter are the refusals, not the happy path: a delete that fires on the
// wrong file is the worst outcome this feature has available.
'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const removal = require('../soundFontRemoval');

// Minimal MZ stub — the detector matches the signature at byte zero and reads 256 bytes.
const MZ  = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400, 0x41)]);
// Minimal but real RIFF/WAVE header, so the "not a program" path is tested against
// something that genuinely is not one rather than against random bytes.
const WAV = (() => {
  const b = Buffer.alloc(64);
  b.write('RIFF', 0); b.writeUInt32LE(56, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24);
  b.write('data', 36); b.writeUInt32LE(20, 40);
  return b;
})();

let pass = 0;
// ⚠️⚠️ ASYNC-AWARE, AND THE AWARENESS IS LOAD-BEARING. [B-400] made addFilesAt async, so one
// case below is async too. The old one-liner called fn() and dropped the result: a rejected
// promise would have become an unhandled rejection AFTER this printed "ok" and counted a pass.
// A test that reports success over a failed assertion is worse than no test.
// An async case returns a promise here and MUST be awaited at its call site.
const ok = (label, fn) => {
  const r = fn();
  if (r && typeof r.then === 'function') {
    return r.then(() => { pass++; console.log('  ok  ' + label); });
  }
  pass++; console.log('  ok  ' + label);
  return undefined;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-removal-'));
const dest = path.join(tmp, 'quarantine-dest');

// Build one of each managed store shape, mirroring _managedRoot exactly.
const roots = {
  entry:        path.join(tmp, 'soundFonts', 'library', 'Ani-Mation'),
  common:       path.join(tmp, 'soundFonts', 'common', 'cmn-uuid', 'files'),
  source:       path.join(tmp, 'soundFonts', 'sources', 'src-uuid', 'source'),
  sharedTracks: path.join(tmp, 'soundFonts', 'sharedTracks'),
};
for (const r of Object.values(roots)) fs.mkdirSync(r, { recursive: true });
fs.writeFileSync(path.join(tmp, 'soundFonts', 'sources', 'src-uuid', 'meta.json'),
  JSON.stringify({ format: 'folder' }));

const plant = (kind, name, buf) => fs.writeFileSync(path.join(roots[kind], name), buf);

// [B-400] Wrapped so the one async case can be awaited. CJS has no top-level await, and
// leaving it unawaited is the false-green described above.
(async () => {
try {
  // ── Resolution reaches every kind ────────────────────────────────────────────
  ok('resolves a file in all four managed stores', () => {
    for (const kind of Object.keys(roots)) {
      plant(kind, 'probe.wav', WAV);
      const r = removal.resolveManagedFile(tmp, kind, kind === 'sharedTracks' ? '' : 'x', 'probe.wav');
      // id is ignored for sharedTracks; every other kind builds its root from it, so
      // point each at the id its root was created with.
      const id = { entry: 'Ani-Mation', common: 'cmn-uuid', source: 'src-uuid', sharedTracks: '' }[kind];
      const r2 = removal.resolveManagedFile(tmp, kind, id, 'probe.wav');
      assert.strictEqual(r2.ok, true, kind + ' should resolve');
      assert.ok(fs.existsSync(r2.absPath), kind + ' resolved path should exist');
      void r;
    }
  });

  // ── The refusals ─────────────────────────────────────────────────────────────
  ok('refuses a path that escapes the store', () => {
    const outsider = path.join(tmp, 'outside.exe');
    fs.writeFileSync(outsider, MZ);
    const r = removal.deleteManagedFile(tmp, {
      kind: 'entry', id: 'Ani-Mation', relPath: '../../../outside.exe',
    });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /escapes/i);
    assert.ok(fs.existsSync(outsider), 'the escaping target must be untouched');
  });

  ok('refuses to delete a file that is allowed in the library', () => {
    plant('entry', 'hum.wav', WAV);
    const r = removal.deleteManagedFile(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'hum.wav' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /allowed in the library/i);
    assert.ok(fs.existsSync(path.join(roots.entry, 'hum.wav')), 'the wav must survive');
  });

  // [B-368] An archive we cannot open leaves on the same terms as a program: it can
  // never enter, never leave and never be read, so keeping it stores bytes for nothing.
  ok('removes an archive we cannot open, and keeps a copy on request', () => {
    plant('source', 'extras.rar', Buffer.from('Rar!\x1a\x07\x00 not really'));
    const imp = removal.impoundProgram(tmp, { kind: 'source', id: 'src-uuid', relPath: 'extras.rar' });
    assert.strictEqual(imp.ok, true, imp.error);
    assert.strictEqual(imp.kind, 'opaque', 'reported as an archive, not a program');
    assert.ok(!fs.existsSync(path.join(roots.source, 'extras.rar')), 'removed from the store');
    const rel = removal.releaseImpounded(tmp, { token: imp.token, destDir: dest, batchLabel: 'arch' });
    assert.strictEqual(rel.ok, true, rel.error);
    assert.ok(fs.existsSync(rel.destPath), 'the copy-out is the only way it ever comes back');
  });

  // [B-368] Macro-enabled documents are allowed in exactly one place - proof of
  // purchase - so one found in a font or source got there some other way and leaves
  // on the same terms. Attachments never call this module, so receipts are unaffected.
  ok('removes a macro-enabled document found outside a proof of purchase', () => {
    plant('entry', 'receipt.docm', Buffer.from('PK not really an office file'));
    const imp = removal.impoundProgram(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'receipt.docm' });
    assert.strictEqual(imp.ok, true, imp.error);
    assert.strictEqual(imp.kind, 'macro', 'reported as a macro document, not a program');
    assert.ok(!fs.existsSync(path.join(roots.entry, 'receipt.docm')));
  });

  ok('leaves a plain document alone - only MACRO-ENABLED types are refused', () => {
    plant('entry', 'notes.docx', Buffer.from('PK plain office file'));
    const r = removal.deleteManagedFile(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'notes.docx' });
    assert.strictEqual(r.ok, false);
    assert.ok(fs.existsSync(path.join(roots.entry, 'notes.docx')), 'a .docx must survive');
  });

  ok('refuses a single-file removal from an archive-format source', () => {
    fs.writeFileSync(path.join(tmp, 'soundFonts', 'sources', 'src-uuid', 'meta.json'),
      JSON.stringify({ format: 'zip' }));
    plant('source', 'Payload.exe', MZ);
    const r = removal.deleteManagedFile(tmp, { kind: 'source', id: 'src-uuid', relPath: 'Payload.exe' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /single archive/i);
    assert.ok(fs.existsSync(path.join(roots.source, 'Payload.exe')), 'nothing removed on refusal');
    fs.writeFileSync(path.join(tmp, 'soundFonts', 'sources', 'src-uuid', 'meta.json'),
      JSON.stringify({ format: 'folder' }));
  });

  ok('refuses a missing file without throwing', () => {
    const r = removal.deleteManagedFile(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'nope.exe' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /not found/i);
  });

  // ── Delete ───────────────────────────────────────────────────────────────────
  ok('deletes a plainly named program', () => {
    plant('entry', 'Installer.exe', MZ);
    const r = removal.deleteManagedFile(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'Installer.exe' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.deleted, true);
    assert.ok(!fs.existsSync(path.join(roots.entry, 'Installer.exe')));
  });

  ok('deletes a program disguised under a wav name', () => {
    plant('source', 'blst99.wav', MZ);
    const r = removal.deleteManagedFile(tmp, { kind: 'source', id: 'src-uuid', relPath: 'blst99.wav' });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(!fs.existsSync(path.join(roots.source, 'blst99.wav')));
  });

  // ── Quarantine ───────────────────────────────────────────────────────────────
  ok('quarantine writes the file INERT and keeps every byte', () => {
    plant('common', 'Payload.exe', MZ);
    const r = removal.quarantineManagedFile(tmp, {
      kind: 'common', id: 'cmn-uuid', relPath: 'Payload.exe', destDir: dest,
    });
    assert.strictEqual(r.ok, true, r.error);
    // The whole point: it must not land under a runnable extension.
    assert.ok(r.destPath.endsWith('.quarantine'), 'must not keep the .exe extension');
    assert.ok(!/\.exe$/i.test(r.destPath), 'must not be runnable on a double-click');
    assert.ok(fs.readFileSync(r.destPath).equals(MZ), 'every byte preserved');
    assert.ok(!fs.existsSync(path.join(roots.common, 'Payload.exe')), 'original removed from the store');
  });

  ok('quarantine writes a sidecar naming the origin and the hash', () => {
    plant('common', 'Second.exe', MZ);
    const r = removal.quarantineManagedFile(tmp, {
      kind: 'common', id: 'cmn-uuid', relPath: 'Second.exe', destDir: dest,
    });
    const side = JSON.parse(fs.readFileSync(r.destPath + '.json', 'utf8'));
    assert.strictEqual(side.originalName, 'Second.exe');
    assert.strictEqual(side.store.kind, 'common');
    assert.strictEqual(side.sha256, r.sha256);
    assert.strictEqual(side.size, MZ.length);
    assert.ok(side.quarantinedAt, 'must record when it was found');
  });

  ok('quarantine never overwrites an existing file at the destination', () => {
    plant('entry', 'Payload.exe', MZ);
    const r = removal.quarantineManagedFile(tmp, {
      kind: 'entry', id: 'Ani-Mation', relPath: 'Payload.exe', destDir: dest,
    });
    assert.strictEqual(r.ok, true, r.error);
    // A Payload.exe.quarantine already exists from the common case above.
    assert.match(path.basename(r.destPath), /\(\d+\)\.quarantine$/);
  });

  // ── The multi-name case: a font folder holds POINTERS, not files ─────────────
  //
  // These two are the reason the module walks at all. A library entry's files are
  // hardlinks sharing an inode with the source file (measured on the real library
  // 2026-09-11: 85 of 86 at nlink 2). Removing one name leaves the other reaching the
  // same bytes, so the program is still in Studio and the app would have said it was
  // gone. Both cases FAIL against a single-unlink implementation.
  ok('delete removes EVERY name for the file, not just the one named', () => {
    const src = path.join(roots.source, 'shared.exe');
    const ptr = path.join(roots.entry, 'shared.exe');
    fs.writeFileSync(src, MZ);
    fs.linkSync(src, ptr);                       // the entry's pointer
    assert.strictEqual(fs.statSync(ptr).nlink, 2, 'precondition: two names');

    // Ask via the ENTRY, which is the pointer rather than the real home.
    const r = removal.deleteManagedFile(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'shared.exe' });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(!fs.existsSync(ptr), 'the pointer must be gone');
    assert.ok(!fs.existsSync(src), 'and the source name must be gone too');
    assert.strictEqual(r.nameCount, 2, 'both names reported removed');
  });

  ok('quarantine removes every name and records all of them in the sidecar', () => {
    const src = path.join(roots.source, 'linked.exe');
    const ptr = path.join(roots.entry, 'linked.exe');
    fs.writeFileSync(src, MZ);
    fs.linkSync(src, ptr);

    const r = removal.quarantineManagedFile(tmp, {
      kind: 'source', id: 'src-uuid', relPath: 'linked.exe', destDir: dest,
    });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(!fs.existsSync(src) && !fs.existsSync(ptr), 'every name removed from the store');
    assert.ok(fs.readFileSync(r.destPath).equals(MZ), 'bytes preserved before removal');

    const side = JSON.parse(fs.readFileSync(r.destPath + '.json', 'utf8'));
    assert.strictEqual(side.foundAt.length, 2, 'the sidecar is the evidence: both locations');
    assert.ok(side.foundAt.some(p => p.includes('library')), 'entry location recorded');
    assert.ok(side.foundAt.some(p => p.includes('sources')), 'source location recorded');
  });

  ok('a single-name file needs no walk and still goes', () => {
    plant('source', 'lonely.exe', MZ);
    assert.strictEqual(fs.statSync(path.join(roots.source, 'lonely.exe')).nlink, 1);
    const r = removal.deleteManagedFile(tmp, { kind: 'source', id: 'src-uuid', relPath: 'lonely.exe' });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.nameCount, 1);
    assert.ok(!fs.existsSync(path.join(roots.source, 'lonely.exe')));
  });

  ok('quarantine refuses an allowed file and leaves it in place', () => {
    plant('entry', 'boot.wav', WAV);
    const r = removal.quarantineManagedFile(tmp, {
      kind: 'entry', id: 'Ani-Mation', relPath: 'boot.wav', destDir: dest,
    });
    assert.strictEqual(r.ok, false);
    assert.ok(fs.existsSync(path.join(roots.entry, 'boot.wav')));
  });

  // ── The holding area: removed at detection, copy only if they ask ────────────
  //
  // The ordering is the point. Impound removes the file BEFORE the user is asked
  // anything, so there is no answer — including closing the app — that leaves a program
  // in the library.
  ok('impound removes the file immediately and holds the bytes', () => {
    plant('entry', 'Held.exe', MZ);
    const r = removal.impoundProgram(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'Held.exe' });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(r.token, 'must return a token');
    assert.ok(!fs.existsSync(path.join(roots.entry, 'Held.exe')), 'gone from the store already');
    const dir = path.join(removal.holdingRoot(tmp), r.token);
    const files = fs.readdirSync(dir);
    assert.ok(files.some(n => n.endsWith('.quarantine')), 'held file must be inert in the holding area too');
    assert.ok(files.includes('finding.json'), 'sidecar written at impound time');
  });

  ok('impound removes every name before holding', () => {
    const src = path.join(roots.source, 'twoNames.exe');
    const ptr = path.join(roots.entry, 'twoNames.exe');
    fs.writeFileSync(src, MZ);
    fs.linkSync(src, ptr);
    const r = removal.impoundProgram(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'twoNames.exe' });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.nameCount, 2);
    assert.ok(!fs.existsSync(src) && !fs.existsSync(ptr));
    const side = JSON.parse(fs.readFileSync(
      path.join(removal.holdingRoot(tmp), r.token, 'finding.json'), 'utf8'));
    assert.strictEqual(side.foundAt.length, 2, 'sidecar records both locations');
  });

  ok('release copies the bytes out and drops the holding entry at once', () => {
    plant('common', 'Keep.exe', MZ);
    const imp = removal.impoundProgram(tmp, { kind: 'common', id: 'cmn-uuid', relPath: 'Keep.exe' });
    const rel = removal.releaseImpounded(tmp, { token: imp.token, destDir: dest });
    assert.strictEqual(rel.ok, true, rel.error);
    assert.ok(rel.destPath.endsWith('.quarantine'), 'saved copy stays inert');
    assert.ok(fs.readFileSync(rel.destPath).equals(MZ), 'bytes intact');
    assert.ok(!fs.existsSync(path.join(removal.holdingRoot(tmp), imp.token)),
      'holding entry deleted immediately, not left for the sweep');

    // ⚠️ ITS OWN LABELLED FOLDER, AND ONE TEXT FILE — not loose files with a .json each.
    // Both came out of the first dev pass: two anonymous icons landed on his Desktop for
    // a single finding, and a .json is a developer artifact, not information for a person.
    assert.strictEqual(path.basename(path.dirname(rel.destPath)), 'Quarantined Files',
      'the file itself sits in the labelled subfolder');
    assert.ok(path.basename(rel.folder).startsWith('JMT Studio Quarantine'),
      'inside a folder that says what it is');
    assert.ok(!fs.existsSync(rel.destPath + '.json'), 'no per-file json beside the copy');
    const readme = path.join(rel.folder, 'READ ME.txt');
    assert.ok(fs.existsSync(readme), 'a readable text file explains the folder');
    const txt = fs.readFileSync(readme, 'utf8');
    assert.match(txt, /QUARANTINED BY JMT STUDIO/);
    assert.match(txt, /cannot run if/i, 'explains why it was renamed');
    assert.ok(txt.includes('Keep.exe'), 'names the original file');
    assert.match(txt, /SHA-256:\s+[0-9a-f]{64}/, 'carries the hash as text');
    assert.match(txt, /safe to read/i, 'says the text file is safe');
    // ⭐ Opening the quarantine folder shows an explanation and a clearly named
    // subfolder - never the programs themselves sitting at the top.
    const visible = fs.readdirSync(rel.folder).filter(n => !n.startsWith('.'));
    assert.deepStrictEqual(visible.sort(), ['Quarantined Files', 'READ ME.txt']);
  });

  ok('a batch lands in ONE folder and the readme lists every file', () => {
    const d2 = path.join(tmp, 'batch-dest');
    const toks = [];
    for (const n of ['One.exe', 'Two.exe']) {
      plant('entry', n, MZ);
      toks.push(removal.impoundProgram(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: n }));
    }
    let folder = null;
    for (const t of toks) {
      const r = removal.releaseImpounded(tmp, { token: t.token, destDir: d2, batchLabel: '2026-09-11 1409' });
      assert.strictEqual(r.ok, true, r.error);
      folder = r.folder;
    }
    const dirs = fs.readdirSync(d2);
    assert.strictEqual(dirs.length, 1, 'one folder for the whole batch, not one each');
    const txt = fs.readFileSync(path.join(folder, 'READ ME.txt'), 'utf8');
    assert.ok(txt.includes('One.exe') && txt.includes('Two.exe'), 'readme covers both');
  });

  ok('release refuses a token that is no longer held', () => {
    const r = removal.releaseImpounded(tmp, { token: 'deadbeefdeadbeef', destDir: dest });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /no longer being held/i);
  });

  ok('release cannot be walked out of the holding area', () => {
    const r = removal.releaseImpounded(tmp, { token: '../../library/Ani-Mation', destDir: dest });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /invalid token/i);
  });

  ok('the sweep clears anything the user walked away from', () => {
    plant('entry', 'Abandoned.exe', MZ);
    const imp = removal.impoundProgram(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'Abandoned.exe' });
    assert.ok(fs.existsSync(path.join(removal.holdingRoot(tmp), imp.token)));
    const swept = removal.sweepImpounded(tmp);
    assert.ok(swept.removed >= 1, 'sweep removed the abandoned hold');
    assert.ok(!fs.existsSync(path.join(removal.holdingRoot(tmp), imp.token)));
    // And the file never came back to the library.
    assert.ok(!fs.existsSync(path.join(roots.entry, 'Abandoned.exe')));
  });

  ok('discard drops the held bytes at once (the Delete button)', () => {
    plant('entry', 'Discarded.exe', MZ);
    const imp = removal.impoundProgram(tmp, { kind: 'entry', id: 'Ani-Mation', relPath: 'Discarded.exe' });
    const d = removal.discardImpounded(tmp, { token: imp.token });
    assert.strictEqual(d.ok, true, d.error);
    assert.ok(!fs.existsSync(path.join(removal.holdingRoot(tmp), imp.token)), 'held bytes gone immediately');
    assert.ok(!fs.existsSync(path.join(roots.entry, 'Discarded.exe')), 'and never returned to the library');
  });

  ok('discarding something already gone is a success, not an error', () => {
    const d = removal.discardImpounded(tmp, { token: 'aaaabbbbccccdddd' });
    assert.strictEqual(d.ok, true, 'absent is the requested end state');
  });

  ok('discard cannot be walked out of the holding area', () => {
    const r = removal.discardImpounded(tmp, { token: '../../library/Ani-Mation' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /invalid token/i);
    assert.ok(fs.existsSync(roots.entry), 'the library folder must still be there');
  });

  ok('the sweep is safe to run when nothing is held', () => {
    const r = removal.sweepImpounded(tmp);
    assert.strictEqual(r.removed, 0);
  });

  // ── [B-370] The import doors: never allowed IN either ────────────────────────
  // Nothing is removed on this side - the file never arrives - so this asserts the
  // store stays clean AND that the user's own copy is left alone.
  await ok('+ Add into a font refuses all three kinds and keeps the user copy', async () => {
    const ops = require('../soundFontFileOps');
    const ext = path.join(tmp, 'picked'); fs.mkdirSync(ext, { recursive: true });
    const mk = (n, b) => { const f = path.join(ext, n); fs.writeFileSync(f, b); return f; };
    const srcs = [mk('ok.wav', WAV), mk('P.exe', MZ), mk('a.rar', Buffer.from('Rar!x')),
      mk('r.docm', Buffer.from('PK x'))];
    const r = await ops.addFilesAt({ userData: tmp, kind: 'entry', id: 'Ani-Mation',
      subPath: '', sourceFilePaths: srcs });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.refused.length, 3, 'program, archive and macro all refused');
    for (const n of ['P.exe', 'a.rar', 'r.docm']) {
      assert.ok(!fs.existsSync(path.join(roots.entry, n)), n + ' must not land');
    }
    assert.strictEqual(fs.readdirSync(ext).length, 4, "the user's own files are untouched");
  });

  console.log(`\n${pass} passed`);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
})();
