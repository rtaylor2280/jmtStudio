// What an import says it added is what the footer says the library holds.
//
// 2026-10-21: a 129-source bulk import into an empty library said "started at 31.00 GB" while the
// footer said "39.33 GB of files". Both were true and they answered different questions - the
// first was the zips as they sat on the drive, the second every name in the library unpacked -
// and a reader had to ask which was right. The import now measures with the footer's own ruler,
// so into an empty library its figures are the footer's: fonts, common folders and tracks alike.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const B = require('../soundFontBulkImport.js');
const L = require('../soundFontLibrarySize.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-isz-${n}-`)); dirs.push(d); return d; };
function wav(body, kb = 16) {
  const data = Buffer.alloc(kb * 1024, body);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
const SOUNDS = ['hum', 'out', 'in', 'font', 'boot', 'clsh1', 'swng1', 'blst1', 'lock'];
function font(dir, seed) {
  fs.mkdirSync(dir, { recursive: true });
  SOUNDS.forEach((n, i) => fs.writeFileSync(path.join(dir, `${n}.wav`), wav(String.fromCharCode(65 + ((i + seed) % 26)))));
}
function zipDir(dir, dest) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const a = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve); a.on('error', reject);
    a.pipe(out); a.directory(dir, false); a.finalize();
  });
}

(async () => {
  console.log('a bulk import into an empty library');
  const set = tmp('set');
  // A zip holding two fonts that share most of their sounds, and a plain folder.
  const z = tmp('z');
  font(path.join(z, 'Pack', 'Alpha'), 0);
  font(path.join(z, 'Pack', 'Beta'), 0);
  fs.writeFileSync(path.join(z, 'Pack', 'Beta', 'hum.wav'), wav('x'));
  await zipDir(z, path.join(set, 'Pack.zip'));
  font(path.join(set, 'Gamma'), 7);
  // A common folder and a tracks folder ride the same run, and count in the same sentence.
  fs.mkdirSync(path.join(set, 'common'));
  ['mnum1', 'mnum2', 'mvoice'].forEach((n, i) => fs.writeFileSync(path.join(set, 'common', `${n}.wav`), wav(String.fromCharCode(97 + i), 24)));
  fs.mkdirSync(path.join(set, 'tracks'));
  fs.writeFileSync(path.join(set, 'tracks', 'theme.wav'), wav('t', 64));

  const ud = tmp('ud');
  const scan = await B.scanForBulkImport({ rootDir: set });
  const run = await B.runBulkImport({ plan: scan.plan, userData: ud }, {});
  const imp = run.summary.imported;
  check('both sources imported', imp.length === 2, JSON.stringify(run.summary.failed));
  const commons = run.summary.commonsImported || [];
  check('precondition: the common folder and the track came in too', commons.length === 1 && run.summary.tracksAdded === 1,
    JSON.stringify({ c: commons.length, t: run.summary.tracksAdded, cf: run.summary.commonsFailed }));
  const all = [...imp, ...commons];
  const source = all.reduce((t, r) => t + (r.sourceBytes || 0), 0);
  const made = all.reduce((t, r) => t + (r.madeBytes || 0), 0) + (run.summary.tracksBytes || 0);
  check('the import measured its sources and its fonts', source > 0 && made > 0, JSON.stringify({ source, made }));

  const fig = await L.compute(ud);
  // Library-wide bookkeeping no single source owns: the pool index and similar. Named, so a new
  // unowned file shows up here rather than hiding inside a tolerance.
  const root = path.join(ud, 'soundFonts');
  const unowned = ['_jmt_library_meta.json', '.jmt-pool.json'].map((n) => path.join(root, n))
    .concat(fs.existsSync(path.join(root, 'pool')) ? [path.join(root, 'pool')] : []);
  const unownedBytes = await L.apparentBytes(unowned);
  check('SOURCES PLUS FONTS IS THE FOOTER\'S "OF FILES", TO THE BYTE', source + made + unownedBytes === fig.apparent,
    JSON.stringify({ said: source + made, unownedBytes, footer: fig.apparent, diff: fig.apparent - source - made - unownedBytes }));
  check('and the fonts are counted in it, not only the sources', fig.apparent > source);

  // On disk, the way the summary adds it up: each source's footprint, what its fonts hold beyond
  // it, and the tracks that were new.
  const disk = imp.reduce((t, r) => t + Math.max(0, (r.contentBytes || 0) - (r.dedupSaved || 0) - (r.crossSaved || 0)) + (r.madeOwnBytes || 0), 0)
    + commons.reduce((t, r) => t + (r.footprint || 0) + (r.madeOwnBytes || 0), 0)
    + (run.summary.tracksNewBytes || 0);
  check("AND ITS 'ON DISK' IS THE FOOTER'S, TO THE BYTE", disk === fig.onDisk,
    JSON.stringify({ said: disk, footer: fig.onDisk, diff: fig.onDisk - disk }));

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
