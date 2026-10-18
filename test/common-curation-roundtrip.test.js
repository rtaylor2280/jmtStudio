// A customized common folder rides a source export and comes back as a common.   [B-493]
//
// The round trip is the test, not the export. An archive that carries a customized common
// and restores it as a FONT is worse than one that never carried it: the promise is kept
// at the moment it matters and broken at the moment it is relied on.
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

function makeCommon(root, SF, { customized }) {
  const uuid = 'bbbbbbbb-0000-1111-2222-333333333333';
  const dir = path.join(SF, 'common', uuid, 'files');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'hum.wav'), customized ? 'MY-EDIT' : 'vendor-hum');
  fs.writeFileSync(path.join(dir, 'boot.wav'), 'vendor-boot');
  if (customized) fs.writeFileSync(path.join(dir, 'mine.wav'), 'MY-FILE');
  fs.writeFileSync(path.join(SF, 'common', uuid, 'meta.json'), JSON.stringify({
    schemaVersion: 1, uuid, name: 'Voicepack', group: 'Clone Wars',
    createdAt: '2026-01-02T03:04:05.000Z',
    sourceUuid: SRC, sourceSubPath: 'common',
  }, null, 2));
  return uuid;
}

// ── a customized common is carried; an untouched one is not ──────────────────────
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  const payload = curation.buildForSource(root, SRC, '1.8.0');
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
  const payload = curation.buildForSource(root, SRC, '1.8.0');
  ok('an UNTOUCHED common is not carried', (payload.customized || [])
     .filter(c => c.kind === 'common').length === 0,
     'the vendor subtree is already in the archive; a second identical copy is waste');
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  const payload = curation.buildForSource(root, SRC, '1.8.0', { includeCustomized: false });
  ok('and includeCustomized:false still means no', (payload.customized || [])
     .filter(c => c.kind === 'common').length === 0);
  fs.rmSync(root, { recursive: true, force: true });
}

// ── the archive plan treats it like any other carried folder ─────────────────────
{
  const { root, SF } = makeLibrary();
  makeCommon(root, SF, { customized: true });
  const payload = curation.buildForSource(root, SRC, '1.8.0');
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
  const payload = curation.buildForSource(root, SRC, '1.8.0');

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

roundTrip().catch((err) => { failures++; console.log('FAIL  round trip threw', err); })
  .then(() => {
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nall B-493 round-trip checks passed');
    process.exit(failures ? 1 : 0);
  });
