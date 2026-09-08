// A customized font survives the export cycle. [B-311]
//
// The claim under test is the whole feature: an entry whose files diverged from
// its source rides the export payload, the vendor's candidate path drops out of
// importedPaths (so the review re-opens with the original UNCHECKED), and the
// restore recreates the entry with the EDITED bytes, its own name and its own
// dates. His rule, 2026-09-07: "If I customized, its original is unchecked. If
// I made a copy so I have the customized and the original, they are both
// checked. Matches what was there before deletion."
//
// The dangerous direction is a payload that LOOKS right while carrying the
// vendor's bytes instead of the edits — the restore would then quietly undo the
// customization, which is precisely the loss this feature exists to end.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const soundFontEntries = require('../soundFontEntries');
const soundFontSources = require('../soundFontSources');
const curation         = require('../soundFontCuration');

let failures = 0;

function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

function setupSource(rootLabel, files) {
  const root     = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-b311-${rootLabel}-`));
  const userData = path.join(root, 'userData');
  const uuid     = `src-uuid-${rootLabel}`;
  const uuidDir  = path.join(soundFontSources.sourcesRoot(userData), uuid);
  fs.mkdirSync(uuidDir, { recursive: true });
  fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1,
    uuid,
    format: 'folder',
    originalName: 'Vendor Bundle',
    importedAt: '2026-08-01T00:00:00.000Z',
  }));
  write(path.join(uuidDir, 'source'), files);
  return { root, userData, uuid };
}

const VENDOR_FILES = {
  'Ahsoka/hum.wav':    'VENDOR-HUM-BYTES',
  'Ahsoka/swing1.wav': 'VENDOR-SWING-BYTES',
  'Obiwan/hum.wav':    'OTHER-FONT-BYTES',
};

(async () => {
  // ── Export side: build the payload off a real customized entry ─────────────
  console.log('export: customized entry rides, its original path drops out');
  const exp = setupSource('exp', VENDOR_FILES);
  await soundFontSources.ensureSourceManifest(exp.userData, exp.uuid);

  const anchor = await soundFontEntries.createEntry({
    userData: exp.userData, sourceUuid: exp.uuid,
    candidate: { path: 'Ahsoka', name: 'Ahsoka' },
    name: 'Ahsoka',
    metadata: { tags: ['Vendor Bundle'], description: 'my edit notes' },
  });
  check('the anchor entry is created', anchor && anchor.ok, anchor && anchor.error);
  const stock = await soundFontEntries.createEntry({
    userData: exp.userData, sourceUuid: exp.uuid,
    candidate: { path: 'Obiwan', name: 'Obiwan' },
    name: 'Obiwan',
  });
  check('the stock entry is created', stock && stock.ok, stock && stock.error);

  // Customize Ahsoka: change one file's bytes (different length, so the
  // stat-walk freshness check trips) and add one file.
  // ⚠️ REMOVE BEFORE REWRITING. The entry's files are HARDLINKS into the
  // folder source ([B-309] pointers), so an in-place write would edit the
  // vendor's copy too and every later extraction would inherit the "edit" —
  // the first run of this test did exactly that, and the stock copy below
  // came out reading Customized. The app's own file ops replace rather than
  // write through, which is what the rm+write mimics.
  const entryDir = path.join(soundFontEntries.entriesRoot(exp.userData), 'Ahsoka');
  fs.rmSync(path.join(entryDir, 'hum.wav'));
  fs.writeFileSync(path.join(entryDir, 'hum.wav'), 'MY-EDITED-HUM-BYTES-LONGER');
  fs.writeFileSync(path.join(entryDir, 'extra.wav'), 'MY-NEW-FILE');
  const cust = soundFontEntries.getEntryCustomization(exp.userData, 'Ahsoka');
  check('the edit reads as Customized', cust && cust.known && cust.customized,
    JSON.stringify(cust));

  const payload = curation.buildForSource(exp.userData, exp.uuid, 'test', {});
  check('payload exists', !!payload);
  check('one customized record rides', payload && Array.isArray(payload.customized)
    && payload.customized.length === 1,
    payload && JSON.stringify((payload.customized || []).map(c => c.entryName)));
  check('customized record names the entry',
    payload && payload.customized[0] && payload.customized[0].entryName === 'Ahsoka');
  check('the customized original is NOT in importedPaths',
    payload && !payload.importedPaths.includes('Ahsoka'),
    payload && JSON.stringify(payload.importedPaths));
  check('the stock path IS in importedPaths',
    payload && payload.importedPaths.includes('Obiwan'),
    payload && JSON.stringify(payload.importedPaths));

  // Both-copies case: a second, unmodified entry at the SAME candidate path
  // puts the path back into importedPaths while the customized one still rides.
  const copy = await soundFontEntries.createEntry({
    userData: exp.userData, sourceUuid: exp.uuid,
    candidate: { path: 'Ahsoka', name: 'Ahsoka' },
    name: 'Ahsoka_stock',
  });
  check('the stock copy is created', copy && copy.ok, copy && copy.error);
  const payload2 = curation.buildForSource(exp.userData, exp.uuid, 'test', {});
  check('both-copies: customized still rides', payload2
    && payload2.customized.length === 1
    && payload2.customized[0].entryName === 'Ahsoka');
  check('both-copies: the shared path is back in importedPaths',
    payload2 && payload2.importedPaths.includes('Ahsoka'),
    payload2 && JSON.stringify(payload2.importedPaths));
  // The candidate row describes the VENDOR's copy, so the keyed curation must
  // come from the STOCK entry — the rider's curation travels on its record.
  // (Ryan's live failure 2026-09-07: the row offered the customized name,
  // which the restore had already taken, and the commit collided.)
  const _keyBlock = payload2 && payload2.entries && payload2.entries['Ahsoka'];
  check('both-copies: the candidate row carries the STOCK name',
    _keyBlock && _keyBlock.name === 'Ahsoka_stock'
    && payload2.customized[0].curation.name === 'Ahsoka',
    JSON.stringify(_keyBlock));

  // Unticked box: nothing rides, and the path is claimed again.
  const payloadOff = curation.buildForSource(exp.userData, exp.uuid, 'test',
    { includeCustomized: false });
  check('includeCustomized:false carries nothing', payloadOff
    && payloadOff.customized.length === 0);
  check('includeCustomized:false restores the path claim',
    payloadOff && payloadOff.importedPaths.includes('Ahsoka'),
    payloadOff && JSON.stringify(payloadOff.importedPaths));

  // ── The tree write: edited bytes land, app artifacts do not ────────────────
  console.log('writeIntoTree: the payload folder holds the EDITS');
  const treeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-b311-tree-'));
  const written = curation.writeIntoTree(treeDir, payload);
  check('write reports the customized count', written.ok && written.customizedWritten === 1,
    JSON.stringify(written));
  const packedDir = path.join(treeDir, '.jmt-curation', 'customized', '0');
  check('edited file carries the edited bytes',
    fs.existsSync(path.join(packedDir, 'hum.wav'))
    && fs.readFileSync(path.join(packedDir, 'hum.wav'), 'utf8') === 'MY-EDITED-HUM-BYTES-LONGER');
  check('added file rides', fs.existsSync(path.join(packedDir, 'extra.wav')));
  check('the entry meta.json does not ride', !fs.existsSync(path.join(packedDir, 'meta.json')));
  const sidecar = JSON.parse(fs.readFileSync(path.join(treeDir, curation.SIDECAR_NAME), 'utf8'));
  check('written sidecar keeps the customized record without _absDir',
    Array.isArray(sidecar.customized) && sidecar.customized.length === 1
    && !('_absDir' in sidecar.customized[0]));

  // ── Import side: restore into a fresh library ──────────────────────────────
  console.log('restore: the customized entry comes back as itself');
  const imp = setupSource('imp', VENDOR_FILES);
  await soundFontSources.ensureSourceManifest(imp.userData, imp.uuid);
  // The stored payload keys entries by the ORIGINAL source uuid; the restore
  // targets whatever uuid the re-import landed under, which is the parameter.
  const r = await curation.restoreCustomizedEntries(imp.userData, imp.uuid, sidecar, treeDir);
  check('one entry restored', r && r.ok && r.restored === 1, JSON.stringify(r));
  check('restored under its own name', r && r.names && r.names[0] === 'Ahsoka',
    r && JSON.stringify(r.names));
  const restoredDir = path.join(soundFontEntries.entriesRoot(imp.userData), 'Ahsoka');
  check('restored hum.wav holds the EDITED bytes',
    fs.readFileSync(path.join(restoredDir, 'hum.wav'), 'utf8') === 'MY-EDITED-HUM-BYTES-LONGER');
  check('restored extra.wav exists', fs.existsSync(path.join(restoredDir, 'extra.wav')));
  const rm = JSON.parse(fs.readFileSync(path.join(restoredDir, 'meta.json'), 'utf8'));
  check('restored entry points at the source subtree it diverged from',
    rm.sourceUuid === imp.uuid && rm.candidatePath === 'Ahsoka',
    `sourceUuid=${rm.sourceUuid} candidatePath=${rm.candidatePath}`);
  check('restored entry carries its curation', Array.isArray(rm.tags)
    && rm.tags.includes('Vendor Bundle') && rm.description === 'my edit notes',
    JSON.stringify({ tags: rm.tags, description: rm.description }));
  // And the marker comes back from the diff on its own — no stored flag rode.
  const custBack = soundFontEntries.getEntryCustomization(imp.userData, 'Ahsoka');
  check('restored entry reads as Customized again',
    custBack && custBack.known && custBack.customized, JSON.stringify(custBack));

  // A second restore against a library that already holds the name suffixes
  // rather than colliding (import-as-new-source while the original survives).
  const r2 = await curation.restoreCustomizedEntries(imp.userData, imp.uuid, sidecar, treeDir);
  check('name collision takes the underscore suffix',
    r2 && r2.restored === 1 && r2.names[0] === 'Ahsoka_2', r2 && JSON.stringify(r2));

  // ── Deferred restore: the review's rows decide ([B-311] rescope 2026-09-08) ─
  // His calls: "this shouldn't be put in my library until the user says import
  // and only if checked", and unchecking means "don't bring it back". picks is
  // how the commit says which rows stayed checked, with the form's edited name.
  console.log('picks: only checked rows restore, under the form\'s name');
  const pk = setupSource('pk', VENDOR_FILES);
  await soundFontSources.ensureSourceManifest(pk.userData, pk.uuid);
  const p0 = await curation.restoreCustomizedEntries(pk.userData, pk.uuid, sidecar, treeDir, []);
  check('empty picks restore nothing', p0 && p0.ok && p0.restored === 0, JSON.stringify(p0));
  check('empty picks leave the library empty',
    !soundFontEntries.findEntryByName(pk.userData, 'Ahsoka'));
  const p1 = await curation.restoreCustomizedEntries(pk.userData, pk.uuid, sidecar, treeDir,
    [{ index: 0, name: 'FormEdited' }]);
  check('picked row restores under the form\'s edited name',
    p1 && p1.restored === 1 && p1.names[0] === 'FormEdited', JSON.stringify(p1));
  check('form-named restore still carries the EDITED bytes',
    fs.readFileSync(path.join(soundFontEntries.entriesRoot(pk.userData), 'FormEdited', 'hum.wav'),
      'utf8') === 'MY-EDITED-HUM-BYTES-LONGER');
  const p2 = await curation.restoreCustomizedEntries(pk.userData, pk.uuid, sidecar, treeDir,
    [{ index: 7, name: 'Ghost' }]);
  check('an out-of-range pick restores nothing', p2 && p2.restored === 0, JSON.stringify(p2));

  // ── The deferring door: finalize returns pending instead of restoring ──────
  console.log('finalizePreparedSource: deferCustomized returns rows, restores nothing');
  const fin = setupSource('fin', VENDOR_FILES);
  const finTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-curation-'));
  const finRes = await soundFontSources.finalizePreparedSource({
    userData: fin.userData, uuid: fin.uuid, format: 'folder', name: 'Vendor Bundle',
    hash: 'test-hash', fileSize: 1, sourceFileDate: null, sourceFileMtimeMs: null,
    metadata: {}, curation: sidecar, curationTmp: finTmp,
    curationPayloadDir: path.join(finTmp, 'payload'), crossLinked: null,
    deferCustomized: true,
  });
  check('deferred finalize succeeds', finRes && finRes.ok, finRes && finRes.error);
  check('deferred finalize returns the pending row',
    finRes && Array.isArray(finRes.customizedPending) && finRes.customizedPending.length === 1
    && finRes.customizedPending[0].name === 'Ahsoka'
    && finRes.customizedPending[0].candidatePath === 'Ahsoka',
    finRes && JSON.stringify(finRes.customizedPending));
  check('deferred finalize creates NO library entry',
    !soundFontEntries.findEntryByName(fin.userData, 'Ahsoka'));
  check('deferred finalize keeps the payload tmp alive', fs.existsSync(finTmp));
  check('deferred finalize echoes the tmp handles for the commit',
    finRes && finRes.curationTmp === finTmp);

  // The same door WITHOUT defer keeps the eager restore (the bulk path):
  // entry created, payload tmp consumed by the finally.
  const fin2 = setupSource('fin2', VENDOR_FILES);
  const fin2Tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-curation-'));
  const fin2Res = await soundFontSources.finalizePreparedSource({
    userData: fin2.userData, uuid: fin2.uuid, format: 'folder', name: 'Vendor Bundle',
    hash: 'test-hash', fileSize: 1, sourceFileDate: null, sourceFileMtimeMs: null,
    metadata: {}, curation: sidecar, curationTmp: fin2Tmp,
    curationPayloadDir: treeDir, crossLinked: null,
  });
  check('eager finalize (bulk door) still restores',
    fin2Res && fin2Res.ok && fin2Res.customizedRestored
    && fin2Res.customizedRestored.restored === 1,
    fin2Res && JSON.stringify(fin2Res.customizedRestored));
  check('eager finalize drops the payload tmp', !fs.existsSync(fin2Tmp));

  // ── Empty folders are not customization ([B-342]) ──────────────────────────
  // The entry walker records an empty dir as an '<empty>' marker; the source
  // manifest walker records nothing. Diffed verbatim that read as "added" —
  // Volatile lit up Customized on import because its VENDOR ships empty
  // bgndrag/ + enddrag/ folders. The marker must ignore markers on both sides.
  console.log('empty folders: invisible to the Customized marker');
  const obiDir = path.join(soundFontEntries.entriesRoot(exp.userData), 'Obiwan');
  fs.mkdirSync(path.join(obiDir, 'bgndrag'));
  soundFontEntries.markEntryContentDirty(exp.userData, 'Obiwan');
  const obiCust = soundFontEntries.getEntryCustomization(exp.userData, 'Obiwan');
  check('an entry whose only difference is an empty folder stays stock',
    obiCust && obiCust.known && !obiCust.customized, JSON.stringify(obiCust));

  // ── Cleanup + verdict ──────────────────────────────────────────────────────
  for (const d of [exp.root, imp.root, treeDir, pk.root, fin.root, fin2.root, finTmp]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
  console.log('all checks passed');
})().catch((err) => { console.error('TEST CRASH:', err); process.exit(1); });
