// A customized common folder rides a COMMON'S source export and comes back as a common. [B-493]
//
// The round trip is the test, not the export. An archive that carries a customized common
// and restores it as a FONT is worse than one that never carried it: the promise is kept
// at the moment it matters and broken at the moment it is relied on.
//
// WHICH KIND RIDES IS THE CALLER'S, so every build here names `customizedKind: 'common'` the
// way a common folder's Export source does. The default is 'entry', and the block below pins
// that a font's Export source carries no common at all. (2026-10-19)
//
// Everything runs against temporary trees. Nothing reads or writes a real library.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const curation = require(path.join(__dirname, '..', 'soundFontCuration.js'));
const common = require(path.join(__dirname, '..', 'soundFontCommon.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const SRC = 'aaaaaaaa-0000-1111-2222-333333333333';

function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b493-rt-'));
  const SF = path.join(root, 'soundFonts');
  const srcTree = path.join(SF, 'sources', SRC, 'source', 'common');
  fs.mkdirSync(srcTree, { recursive: true });
  fs.mkdirSync(path.join(SF, '.filehashes', 'commons'), { recursive: true });
  fs.mkdirSync(path.join(SF, '.filehashes', 'sources'), { recursive: true });
  fs.mkdirSync(path.join(SF, 'library'), { recursive: true });
  fs.writeFileSync(path.join(srcTree, 'hum.wav'), 'vendor-hum');
  fs.writeFileSync(path.join(srcTree, 'boot.wav'), 'vendor-boot');
  fs.writeFileSync(path.join(SF, 'sources', SRC, 'meta.json'),
    JSON.stringify({ uuid: SRC, bundleName: 'Vendor Pack' }, null, 2));
  // the source manifest, so the customization reader has a baseline to diff against
  const fh = require(path.join(__dirname, '..', 'soundFontFileHash.js'));
  const recs = fh.collectFileRecords(srcTree).map(r => ({
    relPath: `common/${r.relPath}`, fileHash: r.fileHash, size: r.size }));
  fh.writeFileHashManifest(path.join(SF, '.filehashes', 'sources', `${SRC}.json`), recs);
  return { root, SF };
}

function makeCommon(root, SF, { customized, uuid: forced }) {
  const uuid = forced || 'bbbbbbbb-0000-1111-2222-333333333333';
  const dir = path.join(SF, 'common', uuid, 'files');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'hum.wav'), customized ? 'MY-EDIT' : 'vendor-hum');
  fs.writeFileSync(path.join(dir, 'boot.wav'), 'vendor-boot');
  if (customized) fs.writeFileSync(path.join(dir, 'mine.wav'), 'MY-FILE');
  fs.writeFileSync(path.join(SF, 'common', uuid, 'meta.json'), JSON.stringify({
    schemaVersion: 1, uuid, name: customized ? 'Voicepack' : 'Voicepack Stock',
    group: 'Clone Wars',
    createdAt: '2026-01-02T03:04:05.000Z',
    sourceUuid: SRC, sourceSubPath: 'common',
  }, null, 2));
  return uuid;
}

// ── a customized common is carried; an untouched one is not ──────────────────────
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  const payload = curation.buildForSource(root, SRC, '1.8.0', { customizedKind: 'common' });
  const commons = (payload.customized || []).filter(c => c.kind === 'common');
  ok('a customized common rides the source export', commons.length === 1,
     JSON.stringify((payload.customized || []).map(c => c.kind || 'entry')));
  ok('and carries its own curation, not just its files',
     commons[0] && commons[0].curation && commons[0].curation.group === 'Clone Wars',
     JSON.stringify(commons[0] && commons[0].curation));
  ok('and the subtree it came from, so the restore knows its baseline',
     commons[0] && commons[0].sourceSubPath === 'common');
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: false });
  const payload = curation.buildForSource(root, SRC, '1.8.0', { customizedKind: 'common' });
  ok('an UNTOUCHED common is not carried', (payload.customized || [])
     .filter(c => c.kind === 'common').length === 0,
     'the vendor subtree is already in the archive; a second identical copy is waste');
  fs.rmSync(root, { recursive: true, force: true });
}
// ── A FONT'S EXPORT SOURCE CARRIES NO COMMON, WHICHEVER WAY IT IS ASKED ──────────
// The same customized common that rides above must not ride a font door's export. Both
// spellings are pinned: the default, and 'entry' stated outright. Fonts and common folders
// are not bundled together, so a font export has no business carrying one.
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  for (const [how, opts] of [['by default', undefined], ["with customizedKind 'entry'", { customizedKind: 'entry' }]]) {
    const payload = curation.buildForSource(root, SRC, '1.8.0', opts);
    ok(`a font's source export carries no common ${how}`,
       ((payload && payload.customized) || []).filter(c => c.kind === 'common').length === 0,
       JSON.stringify(((payload && payload.customized) || []).map(c => c.kind || 'entry')));
  }
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  const payload = curation.buildForSource(root, SRC, '1.8.0',
                                          { customizedKind: 'common', includeCustomized: false });
  ok('and includeCustomized:false still means no', (payload.customized || [])
     .filter(c => c.kind === 'common').length === 0);
  fs.rmSync(root, { recursive: true, force: true });
}

// ── THE EXPORT RECORDS THAT A STOCK COPY WAS THERE TOO ───────────────────────────
// The commons analogue of `importedPaths`, and the half the consumer test cannot prove: it
// hand-builds a sidecar, so it asserts what this file BELIEVES the export writes. This is
// the check that the export actually writes it.
//
// The rule is the font side's: customized alone means the vendor copy stays out; customized
// BESIDE a stock copy means both come back, because both were there.
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  const alone = curation.buildForSource(root, SRC, '1.8.0', { customizedKind: 'common' });
  ok('a customized common ALONE claims its subtree',
     (alone.importedSubPaths || []).length === 0,
     JSON.stringify(alone.importedSubPaths));

  makeCommon(root, SF, { customized: false, uuid: 'cccccccc-0000-1111-2222-333333333333' });
  const both = curation.buildForSource(root, SRC, '1.8.0', { customizedKind: 'common' });
  ok('a STOCK copy beside it puts the subtree back on the imported list',
     (both.importedSubPaths || []).includes('common'),
     JSON.stringify(both.importedSubPaths));
  ok('and the customized copy still rides',
     (both.customized || []).filter(c => c.kind === 'common').length === 1,
     JSON.stringify((both.customized || []).map(c => c.kind || 'entry')));
  fs.rmSync(root, { recursive: true, force: true });
}

// ── the archive plan treats it like any other carried folder ─────────────────────
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  const payload = curation.buildForSource(root, SRC, '1.8.0', { customizedKind: 'common' });
  const plan = curation.planForArchive(payload);
  const mine = plan.entries.filter(e => /\/customized\/\d+\/mine\.wav$/.test(e.name));
  ok('the customized common\'s files are planned into the archive', mine.length === 1,
     JSON.stringify(plan.entries.map(e => e.name)));
  ok('and it is counted as carried', plan.customizedWritten === 1);
  fs.rmSync(root, { recursive: true, force: true });
}

// ── THE ROUND TRIP ───────────────────────────────────────────────────────────────
async function roundTrip() {
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  const payload = curation.buildForSource(root, SRC, '1.8.0', { customizedKind: 'common' });

  // Stage the payload the way an unpacked archive presents it.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'b493-stage-'));
  const rec = payload.customized.find(c => c.kind === 'common');
  const outDir = path.join(stage, ...rec.dir.split('/'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(rec._absDir)) {
    fs.copyFileSync(path.join(rec._absDir, f), path.join(outDir, f));
  }

  // Restore into a DIFFERENT library that already has the source but not the common.
  const dest = makeLibrary();
  const r = await curation.restoreCustomizedEntries(dest.root, SRC, payload, stage);
  ok('the restore reports success', !!(r && r.ok), JSON.stringify(r));

  const commonDirs = fs.existsSync(path.join(dest.SF, 'common'))
    ? fs.readdirSync(path.join(dest.SF, 'common')) : [];
  ok('it came back as a COMMON FOLDER', commonDirs.length === 1,
     `common dirs: ${JSON.stringify(commonDirs)}`);
  const libDirs = fs.existsSync(path.join(dest.SF, 'library'))
    ? fs.readdirSync(path.join(dest.SF, 'library')) : [];
  ok('and NOT as a font', libDirs.length === 0,
     'restoring a voicepack into the font grid is the failure this branch exists for');

  if (commonDirs.length === 1) {
    const cdir = path.join(dest.SF, 'common', commonDirs[0]);
    const m = JSON.parse(fs.readFileSync(path.join(cdir, 'meta.json'), 'utf8'));
    const read = (f) => { try { return fs.readFileSync(path.join(cdir, 'files', f), 'utf8'); } catch { return null; } };
    ok('with the edits intact', read('hum.wav') === 'MY-EDIT' && read('mine.wav') === 'MY-FILE',
       'the edits are the only thing in the archive that exists nowhere else');
    ok('its curation back', m.name === 'Voicepack' && m.group === 'Clone Wars', JSON.stringify(m));
    ok('its history back, so the round trip leaves no trace of the delete',
       m.createdAt === '2026-01-02T03:04:05.000Z', m.createdAt);
    ok('and still tied to the same source', m.sourceUuid === SRC && m.sourceSubPath === 'common');
  }

  // ── THE RESTORE NAMES THE SUBTREE IT CLAIMED ──────────────────────────────────
  // The import door builds a stock working copy out of the source's own subtree, and it has
  // no other way to know this one is already back. Without this report the door builds a
  // second copy, so ONE exported common returns as TWO - the stock and the customized - which
  // is exactly what the font side prevents by leaving a riding entry's candidate unchecked.
  ok('the restore reports which subtree it claimed',
     Array.isArray(r.commons) && r.commons.length === 1
     && r.commons[0].sourceSubPath === 'common'
     && !!r.commons[0].uuid && !!r.commons[0].name,
     JSON.stringify(r.commons));

  // A SECOND restore must not collide - it lands beside the first.
  const r2 = await curation.restoreCustomizedEntries(dest.root, SRC, payload, stage);
  const after = fs.readdirSync(path.join(dest.SF, 'common'));
  ok('restoring twice lands beside the first rather than failing', !!(r2 && r2.ok) && after.length === 2,
     `dirs=${after.length}`);

  // LEGACY: a record with no kind is an ENTRY, or every archive already written breaks.
  ok('a record with no kind is still treated as an entry',
     payload.customized.filter(c => !c.kind).every(c => c.entryName !== undefined)
     || payload.customized.filter(c => !c.kind).length === 0);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dest.root, { recursive: true, force: true });
  fs.rmSync(stage, { recursive: true, force: true });
}

// ── the deferral is kind-specific ────────────────────────────────────────────────
// A customized FONT is a row in the candidate review and waits to be chosen. A customized
// COMMON has no such row - the review is the font candidate screen and a common folder is
// not one of its rows - so it restores on arrival. The import door expresses that by
// restoring with picks naming only the common records, which is what this exercises.
//
// THE INDICES ARE POSITIONS IN payload.customized. A filtered list that renumbered them
// would restore a different record than the one named, so the font record sits FIRST here
// deliberately: a renumbering bug restores the font and the assertions below catch it.
async function kindSpecificDefer() {
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });

  // A customized font from the same source, placed at index 0.
  const payload = curation.buildForSource(root, SRC, '1.8.0', { customizedKind: 'common' });
  const fontDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b493-font-'));
  fs.writeFileSync(path.join(fontDir, 'hum.wav'), 'FONT-EDIT');
  payload.customized.unshift({
    entryName: 'A_Font', candidatePath: '',
    dir: `${'.jmt-curation'}/customized/99`,
    curation: { name: 'A_Font' }, provenance: {}, _absDir: fontDir,
  });
  // Re-point the common record's dir so both stage cleanly.
  const commonIdx = payload.customized.findIndex(c => c.kind === 'common');
  ok('fixture: the font sits before the common', commonIdx === 1, `commonIdx=${commonIdx}`);

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'b493-stage2-'));
  for (const c of payload.customized) {
    const out = path.join(stage, ...c.dir.split('/'));
    fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(c._absDir)) {
      fs.copyFileSync(path.join(c._absDir, f), path.join(out, f));
    }
  }

  const dest = makeLibrary();
  // Exactly what the import door passes when deferring: picks naming only the commons.
  const picks = [{ index: commonIdx }];
  await curation.restoreCustomizedEntries(dest.root, SRC, payload, stage, picks);

  const commonDirs = fs.existsSync(path.join(dest.SF, 'common'))
    ? fs.readdirSync(path.join(dest.SF, 'common')) : [];
  const libDirs = fs.existsSync(path.join(dest.SF, 'library'))
    ? fs.readdirSync(path.join(dest.SF, 'library')) : [];
  ok('the common restored on arrival', commonDirs.length === 1, JSON.stringify(commonDirs));
  ok('and the customized FONT did not - it waits for the review',
     libDirs.length === 0, `library: ${JSON.stringify(libDirs)}`);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dest.root, { recursive: true, force: true });
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(fontDir, { recursive: true, force: true });
}

// ── THE FONT PATH IS UNCHANGED ───────────────────────────────────────────────────
// The deferral filter must be a no-op for any payload without commons, which is every
// archive written before today. Reproduces the old expression and the new one side by side
// over the same input and requires them to agree.
{
  const sample = [
    { entryName: 'One', candidatePath: '', curation: { name: 'Alpha' } },
    { entryName: 'Two', candidatePath: 'inner', curation: {} },
    { entryName: 'Three', candidatePath: 'a/b', curation: { name: '  ' } },
  ];
  const nameOf = (c) => (c.curation && typeof c.curation.name === 'string' && c.curation.name.trim())
    ? c.curation.name.trim()
    : (String(c.entryName || '').trim() || 'Customized font');
  // what the import door built before [B-493]
  const before = sample.map((c, i) => ({
    index: i, name: nameOf(c), candidatePath: c.candidatePath == null ? '' : c.candidatePath }));
  // what it builds now
  const after = sample.map((c, i) => ({ c, i })).filter(({ c }) => !(c && c.kind === 'common'))
    .map(({ c, i }) => ({
      index: i, name: nameOf(c), candidatePath: c.candidatePath == null ? '' : c.candidatePath }));
  ok('a payload with no commons pends exactly what it always did',
     JSON.stringify(before) === JSON.stringify(after),
     `before=${JSON.stringify(before)}\n      after =${JSON.stringify(after)}`);

  // And with a common in the middle, the surviving font rows keep their ORIGINAL indices -
  // the renderer sends these back as picks, so a renumbered list restores the wrong record.
  const mixed = [sample[0], { kind: 'common', commonName: 'Pack' }, sample[1]];
  const mixedAfter = mixed.map((c, i) => ({ c, i })).filter(({ c }) => !(c && c.kind === 'common'))
    .map(({ i }) => i);
  ok('a common in the middle does not renumber the font rows',
     JSON.stringify(mixedAfter) === JSON.stringify([0, 2]), JSON.stringify(mixedAfter));
}

roundTrip().then(kindSpecificDefer)
  .catch((err) => { failures++; console.log('FAIL  round trip threw', err); })
  .then(() => {
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nall B-493 round-trip checks passed');
    process.exit(failures ? 1 : 0);
  });
