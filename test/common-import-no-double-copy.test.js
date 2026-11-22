// ONE WORKING COPY WAS EXPORTED, ONE COMES BACK.                              [B-493]
//
// A source archive carrying a customized common folder has two things in it that describe the
// same subtree: the source's own `common/` tree, and the customized working copy in the payload.
// The import door builds a working copy out of the source tree, and the payload restore builds
// one out of the payload - so without a claim between them, one exported common returns as TWO,
// the untouched original beside the customized one.
//
// THE CHOICE IS STILL BEING MADE, IT IS JUST NOT SHOWN. The font side asks this on the candidate
// review: an entry that rides the payload leaves the vendor's candidate unchecked, so only the
// customized copy arrives. A common folder has no row on that screen, so the same answer is
// applied automatically rather than offered.
//
// Runs the REAL import door over a REAL zip. A fixture that hands the door a hand-built claim
// would be testing the fixture; the defect lived in two modules agreeing about a subtree.
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');
const C = require('../soundFontCommon.js');
const curation = require('../soundFontCuration.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
function wav(body) {
  const data = Buffer.alloc(2048, body);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
function put(root, rel, buf) {
  const abs = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-b493-${n}-`));

(async () => {
  console.log('an archive carrying a customized common returns ONE working copy');

  // ── The archive, shaped the way an export writes it ──
  // The vendor subtree under `common/`, plus the payload: a customized copy of that same
  // subtree, one file different, and the sidecar that names it.
  const treeDir = tmp('tree');
  put(treeDir, 'common/mmain.wav', wav('V'));
  put(treeDir, 'common/mnum1.wav', wav('1'));
  put(treeDir, 'common/voicepack.ini', Buffer.from('version=2\r\n'));

  const SRC_IN_ARCHIVE = 'aaaaaaaa-1111-2222-3333-444444444444';
  const payloadRel = `${curation.PAYLOAD_DIR}/customized/0`;
  put(treeDir, `${payloadRel}/mmain.wav`, wav('V'));
  put(treeDir, `${payloadRel}/mnum1.wav`, wav('1'));
  put(treeDir, `${payloadRel}/voicepack.ini`, Buffer.from('version=2\r\n'));
  // The edit that exists nowhere but the working copy. Its presence in the imported common is
  // how we tell WHICH of the two copies survived - a count alone cannot.
  put(treeDir, `${payloadRel}/my-edit.wav`, wav('E'));
  put(treeDir, curation.SIDECAR_NAME, Buffer.from(JSON.stringify({
    schemaVersion: curation.SCHEMA_VERSION,
    sourceUuid: SRC_IN_ARCHIVE,
    writtenAt: '2026-10-19T00:00:00.000Z',
    writtenBy: 'test',
    source: {},
    entries: {},
    entryProvenance: {},
    importedPaths: [],
    attachments: [],
    customized: [{
      kind: 'common',
      commonName: 'Voicepack',
      sourceSubPath: 'common',
      dir: payloadRel,
      curation: { name: 'Voicepack', group: 'Clone Wars' },
      provenance: { createdAt: '2026-01-02T03:04:05.000Z' },
    }],
  }, null, 2)));

  const zipDir = tmp('zip');
  const zipPath = path.join(zipDir, 'Voicepack.zip');
  await S.zipFolderToFile(treeDir, zipPath);

  // ── Import it ──
  const userData = tmp('ud');
  const r = await C.importCommonFromZip(userData, zipPath, 'Voicepack');
  check('the import succeeded', !!(r && r.ok), r && r.error);

  const commons = C.listCommons(userData);
  check('exactly ONE common folder came back', commons.length === 1,
        `got ${commons.length}: ${JSON.stringify(commons.map((c) => ({
          name: c.meta.name, files: c.fileCount, from: c.meta.importedFrom })))}`);

  if (commons.length) {
    // THE SURVIVOR MUST BE THE CUSTOMIZED ONE. Keeping the stock copy and dropping the edits
    // would also return exactly one, and it is the worse outcome of the two: the edits exist
    // nowhere else, and the vendor subtree is already in the archive.
    const only = commons[0];
    const filesDir = path.join(userData, 'soundFonts', 'common', only.uuid, 'files');
    check('and it is the CUSTOMIZED copy, not the vendor subtree',
          fs.existsSync(path.join(filesDir, 'my-edit.wav')),
          `files: ${JSON.stringify(fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : null)}`);
    check('carrying its curation', only.meta.group === 'Clone Wars',
          JSON.stringify(only.meta));
    check('and its history, so the round trip leaves no trace of the delete',
          only.meta.createdAt === '2026-01-02T03:04:05.000Z', only.meta.createdAt);
    check('tied to the source that was just imported',
          !!only.meta.sourceUuid && only.meta.sourceSubPath === 'common',
          JSON.stringify({ u: only.meta.sourceUuid, p: only.meta.sourceSubPath }));
    check('the door reports the restored copy rather than one it made',
          r.uuid === only.uuid && r.restoredFromArchive === true,
          JSON.stringify({ returned: r.uuid, onDisk: only.uuid, flag: r.restoredFromArchive }));
  }

  // ── BOTH COPIES: customized BESIDE a stock one, so both come back ─────────────
  // The rule the font side states for candidates: customized alone means the vendor copy
  // stays out; customized beside a stock copy means both are checked, because that is what
  // was there before. `importedSubPaths` is where the export records it, and an archive that
  // carries it must NOT have its subtree claimed.
  const bothDir = tmp('both');
  put(bothDir, 'common/mmain.wav', wav('V'));
  put(bothDir, 'common/voicepack.ini', Buffer.from('version=2\r\n'));
  put(bothDir, `${payloadRel}/mmain.wav`, wav('V'));
  put(bothDir, `${payloadRel}/voicepack.ini`, Buffer.from('version=2\r\n'));
  put(bothDir, `${payloadRel}/my-edit.wav`, wav('E'));
  put(bothDir, curation.SIDECAR_NAME, Buffer.from(JSON.stringify({
    schemaVersion: curation.SCHEMA_VERSION,
    sourceUuid: SRC_IN_ARCHIVE,
    writtenAt: '2026-10-19T00:00:00.000Z',
    writtenBy: 'test',
    source: {}, entries: {}, entryProvenance: {}, importedPaths: [],
    // The stock copy was there at export time.
    importedSubPaths: ['common'],
    attachments: [],
    customized: [{
      kind: 'common', commonName: 'Voicepack', sourceSubPath: 'common', dir: payloadRel,
      curation: { name: 'Voicepack', group: 'Clone Wars' },
      provenance: { createdAt: '2026-01-02T03:04:05.000Z' },
    }],
  }, null, 2)));
  const bothZip = path.join(tmp('zip3'), 'Both.zip');
  await S.zipFolderToFile(bothDir, bothZip);
  const ud3 = tmp('ud3');
  const r3 = await C.importCommonFromZip(ud3, bothZip, 'Voicepack');
  const c3 = C.listCommons(ud3);
  check('a customized copy exported BESIDE a stock one brings back both',
        !!(r3 && r3.ok) && c3.length === 2,
        `got ${c3.length}: ${JSON.stringify(c3.map((c) => ({ n: c.meta.name, f: c.fileCount })))}`);
  if (c3.length === 2) {
    const has = (f) => c3.some((c) => fs.existsSync(
      path.join(ud3, 'soundFonts', 'common', c.uuid, 'files', f)));
    check('one of them carries the edit and the other does not',
          has('my-edit.wav') && c3.some((c) => !fs.existsSync(
            path.join(ud3, 'soundFonts', 'common', c.uuid, 'files', 'my-edit.wav'))),
          JSON.stringify(c3.map((c) => fs.readdirSync(
            path.join(ud3, 'soundFonts', 'common', c.uuid, 'files')))));
  }

  // ── The control: an archive with NO payload still builds a working copy ──
  // Without this, deleting the stock-copy branch entirely would pass everything above.
  const plainDir = tmp('plain');
  put(plainDir, 'common/mmain.wav', wav('P'));
  put(plainDir, 'common/voicepack.ini', Buffer.from('version=2\r\n'));
  const plainZip = path.join(tmp('zip2'), 'Plain.zip');
  await S.zipFolderToFile(plainDir, plainZip);
  const ud2 = tmp('ud2');
  const r2 = await C.importCommonFromZip(ud2, plainZip, 'Plain');
  const c2 = C.listCommons(ud2);
  check('an archive with no payload still produces its working copy',
        !!(r2 && r2.ok) && c2.length === 1 && !r2.restoredFromArchive,
        JSON.stringify({ ok: r2 && r2.ok, n: c2.length, flag: r2 && r2.restoredFromArchive }));

  // ── A SECOND IMPORT OF THE SAME ARCHIVE ───────────────────────────────────────
  // TWO CONTRACTS, AND THEY MUST NOT BE COLLAPSED. The door's default keeps building a
  // second working copy, because importing the same pack twice under a different name is a
  // supported operation that hardlinks into the source already on disk. Only a caller with
  // a user to ask opts in to being told instead.
  //
  // Breaking that default is exactly what common-import-reused-savings.test.js caught when
  // the duplicate report was unconditional. [B-493, 2026-10-19]
  {
    const ud4 = tmp('ud4');
    const a1 = await C.importCommonFromZip(ud4, plainZip, 'Plain_One');
    check('first import of the archive succeeded', !!(a1 && a1.ok), a1 && a1.error);

    const a2 = await C.importCommonFromZip(ud4, plainZip, 'Plain_Two');
    check('the DEFAULT still builds a second working copy',
          !!(a2 && a2.ok) && !a2.isDuplicate && C.listCommons(ud4).length === 2,
          JSON.stringify({ ok: a2 && a2.ok, dup: a2 && a2.isDuplicate, n: C.listCommons(ud4).length }));
    check('and reports the reuse, so the saving is still stated',
          !!(a2.savings && a2.savings.reusedSource && a2.savings.reusedBytes > 0),
          JSON.stringify(a2.savings));

    const before = C.listCommons(ud4).length;
    const a3 = await C.importCommonFromZip(ud4, plainZip, 'Plain_Three', null, null,
                                           { askOnDuplicate: true });
    check('askOnDuplicate REPORTS instead of building',
          !!(a3 && a3.ok) && a3.isDuplicate === true && C.listCommons(ud4).length === before,
          JSON.stringify({ dup: a3 && a3.isDuplicate, before, after: C.listCommons(ud4).length }));
    check('and names what is already there, so the dialog can say it',
          Array.isArray(a3.existingCommons) && a3.existingCommons.length === 2
          && a3.existingCommons.every((c) => c.uuid && c.name),
          JSON.stringify(a3.existingCommons));
    check('and names the source behind them, so "Open existing" has a target',
          !!a3.sourceUuid, JSON.stringify(a3.sourceUuid));

    // forceNewSource overrides the ask: it is the answer, not another question.
    const a4 = await C.importCommonFromZip(ud4, plainZip, 'Plain_Four', null, null,
                                           { askOnDuplicate: true, forceNewSource: true });
    check('forceNewSource builds rather than asking again',
          !!(a4 && a4.ok) && !a4.isDuplicate && C.listCommons(ud4).length === before + 1,
          JSON.stringify({ dup: a4 && a4.isDuplicate, n: C.listCommons(ud4).length }));
    try { fs.rmSync(ud4, { recursive: true, force: true }); } catch {}
  }


  for (const d of [treeDir, zipDir, userData, bothDir, ud3, plainDir, ud2]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }

  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
