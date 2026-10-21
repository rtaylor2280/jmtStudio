// A font is never a duplicate of a font from its own source.
//
// Found 2026-10-21: The_Prodigal_Butcher came in flagged "Close match to Revan", and Revan is the
// user's customized copy of The_Prodigal_Butcher that rode the same export. The bulk duplicate
// check skipped only the fonts it had just created; a customized font is restored earlier, by the
// source import itself, so it was compared as if it were someone else's.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const S = require('../soundFontSources.js');
const E = require('../soundFontEntries.js');
const Cur = require('../soundFontCuration.js');
const B = require('../soundFontBulkImport.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-own-${n}-`)); dirs.push(d); return d; };
function wav(body) {
  const data = Buffer.alloc(8 * 1024, body);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
const SOUNDS = ['hum', 'out', 'in', 'font', 'boot', 'clsh1', 'clsh2', 'swng1', 'swng2', 'blst1', 'lock', 'drag', 'force', 'preon', 'stab', 'melt'];
function readMeta(ud, name) {
  try { return JSON.parse(fs.readFileSync(path.join(E.entriesRoot(ud), name, 'meta.json'), 'utf8')); } catch { return null; }
}
function zipDir(dir, dest) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const a = archiver('zip', { zlib: { level: 1 } });
    out.on('close', resolve); a.on('error', reject);
    a.pipe(out);
    a.glob('**/*', { cwd: dir, dot: true });
    a.finalize();
  });
}

(async () => {
  console.log('a source exported with a customized copy of its own font');
  // The user's library: one vendor font, and their customized copy of it.
  const ud1 = tmp('ud1');
  const uuid = 'src-butcher';
  const uuidDir = path.join(S.sourcesRoot(ud1), uuid);
  fs.mkdirSync(path.join(uuidDir, 'source', 'Butcher'), { recursive: true });
  fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1, uuid, format: 'folder', originalName: 'Butcher', vendor: 'Kyberphonic', importedAt: '2026-10-10T00:00:00.000Z',
  }));
  SOUNDS.forEach((n, i) => fs.writeFileSync(path.join(uuidDir, 'source', 'Butcher', `${n}.wav`), wav(String.fromCharCode(65 + i))));
  await S.ensureSourceManifest(ud1, uuid);
  const stock = await E.createEntry({ userData: ud1, sourceUuid: uuid, candidate: { path: 'Butcher', name: 'Butcher' }, name: 'Butcher' });
  const copy = await E.createEntry({ userData: ud1, sourceUuid: uuid, candidate: { path: 'Butcher', name: 'Butcher' }, name: 'Revan' });
  check('precondition: both fonts exist', stock.ok && copy.ok, JSON.stringify([stock.error, copy.error]));
  const revanDir = path.join(E.entriesRoot(ud1), 'Revan');
  fs.rmSync(path.join(revanDir, 'hum.wav'));
  fs.writeFileSync(path.join(revanDir, 'hum.wav'), Buffer.concat([wav('z'), Buffer.alloc(512, 1)]));
  const cust = E.getEntryCustomization(ud1, 'Revan');
  check('precondition: Revan reads as customized', cust && cust.customized, JSON.stringify(cust));

  // Export it the way Export source does: the source tree plus the sidecar and the customized copy.
  const tree = tmp('tree');
  fs.cpSync(path.join(uuidDir, 'source'), tree, { recursive: true });
  const payload = Cur.buildForSource(ud1, uuid, 'test', {});
  const w = Cur.writeIntoTree(tree, payload);
  check('precondition: the customized copy rides the export', w.ok && w.customizedWritten === 1, JSON.stringify(w));
  const set = tmp('set');
  await zipDir(tree, path.join(set, 'Butcher.zip'));

  // A fresh library takes it in by bulk import.
  const ud2 = tmp('ud2');
  const scan = await B.scanForBulkImport({ rootDir: set });
  const run = await B.runBulkImport({ plan: scan.plan, userData: ud2 }, {});
  check('it imported', run.summary.imported.length === 1, JSON.stringify(run.summary.failed));
  const butcher = readMeta(ud2, 'Butcher');
  const revan = readMeta(ud2, 'Revan');
  check('precondition: Revan came back as its own font', !!revan, fs.existsSync(E.entriesRoot(ud2)) ? fs.readdirSync(E.entriesRoot(ud2)).join() : 'no library');
  check('and so did Butcher', !!butcher);
  const reasons = (butcher && butcher.reviewReasons) || [];
  check('BUTCHER IS NOT A CLOSE MATCH TO ITS OWN CUSTOMIZED COPY', !reasons.includes('close_match'), JSON.stringify(reasons));
  check('nor "already in your library"', !reasons.includes('already_in_library'), JSON.stringify(reasons));

  console.log('a source where only the customized copy was kept');
  {
    // The user's real case: Revan kept, the vendor original never imported. The export leaves
    // Butcher off its list, and a bulk import must not bring it back.
    const del = await E.deleteEntry(ud1, 'Butcher');
    check('precondition: the original is gone from the first library', del && del.ok !== false && !readMeta(ud1, 'Butcher'), JSON.stringify(del));
    const tree2 = tmp('tree2');
    fs.cpSync(path.join(uuidDir, 'source'), tree2, { recursive: true });
    const p2 = Cur.buildForSource(ud1, uuid, 'test', {});
    check('precondition: the export does not list the original', p2 && !p2.importedPaths.includes('Butcher'), JSON.stringify(p2 && p2.importedPaths));
    Cur.writeIntoTree(tree2, p2);
    const set3 = tmp('set3');
    await zipDir(tree2, path.join(set3, 'Butcher.zip'));
    const ud3 = tmp('ud3');
    const scan3 = await B.scanForBulkImport({ rootDir: set3 });
    const run3 = await B.runBulkImport({ plan: scan3.plan, userData: ud3 }, {});
    const names3 = fs.existsSync(E.entriesRoot(ud3)) ? fs.readdirSync(E.entriesRoot(ud3)) : [];
    check('REVAN COMES BACK', names3.includes('Revan'), names3.join());
    check('AND THE ORIGINAL THE USER NEVER HAD DOES NOT', !names3.includes('Butcher'), names3.join());
    check('the source is kept, not refused as empty', run3.summary.imported.length === 1 && run3.summary.failed.length === 0,
      JSON.stringify({ i: run3.summary.imported.length, f: run3.summary.failed }));
    check('and is still in the library', fs.readdirSync(S.sourcesRoot(ud3)).length === 1);
  }

  console.log('a font from another source is still caught');
  {
    const set2 = tmp('set2');
    const other = path.join(set2, 'Butcher Copy');
    fs.mkdirSync(other);
    SOUNDS.forEach((n, i) => fs.writeFileSync(path.join(other, `${n}.wav`), wav(String.fromCharCode(65 + i))));
    fs.writeFileSync(path.join(other, 'extra.wav'), wav('q'));
    const scan2 = await B.scanForBulkImport({ rootDir: set2 });
    await B.runBulkImport({ plan: scan2.plan, userData: ud2 }, {});
    const names = fs.readdirSync(E.entriesRoot(ud2)).filter(n => n !== 'Butcher' && n !== 'Revan');
    const m = names.length ? readMeta(ud2, names[0]) : null;
    const r = (m && m.reviewReasons) || [];
    check('the same sounds from a different source are flagged', r.includes('close_match') || r.includes('already_in_library'), JSON.stringify({ names, r }));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
