// Two sources in one bulk run share what they have in common.
//
// Analyze links each source against the library before anything in the run is added, when the
// run's other sources are still staged and not part of the library. So two fonts shipping the
// same files were both stored in full: measured 2026-10-21 after a 129-source run, 1.75 GiB, most
// of it one pair (Dagen and Cere, 72 shared wavs). The commit now links each source against the
// library as it stands when that source is added, so the second shares what the first brought.
// [B-314] covered two IDENTICAL sources in one run; this is the partial overlap.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../soundFontBulkImport.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-bxl-${n}-`)); dirs.push(d); return d; };
function wav(body, kb) {
  const data = Buffer.alloc(kb * 1024, body);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
// A font of its own sounds plus the large shared tracks both creators shipped.
function font(dir, seed) {
  fs.mkdirSync(path.join(dir, 'tracks'), { recursive: true });
  ['hum', 'out', 'in', 'font', 'clsh1', 'swng1'].forEach((n, i) => fs.writeFileSync(path.join(dir, `${n}.wav`), wav(String.fromCharCode(65 + seed + i), 8)));
  for (const t of ['theme1', 'theme2']) fs.writeFileSync(path.join(dir, 'tracks', `${t}.wav`), wav(t, 512));
}
function inoOf(p) { return fs.statSync(p, { bigint: true }).ino; }
function findAll(root, name) {
  const out = [];
  (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) w(a); else if (e.name === name) out.push(a); } })(root);
  return out;
}

(async () => {
  console.log('two fonts in one bulk run that ship the same tracks');
  const set = tmp('set');
  font(path.join(set, 'Dagen'), 0);
  font(path.join(set, 'Cere'), 10);
  const ud = tmp('ud');
  const scan = await B.scanForBulkImport({ rootDir: set });
  check('precondition: both found', scan.ok && scan.plan.sources.length === 2, JSON.stringify(scan.plan && scan.plan.sources.length));

  // The app's own sequence: analyze stages every source, the window stamps the results back onto
  // the plan, then the run commits the staged sources.
  const an = await B.analyzeBulkImport({ plan: scan.plan, userData: ud }, {});
  for (const r of (an.results || [])) {
    const s = scan.plan.sources[r.idx];
    if (s && r.prepared) s._prepared = r.prepared;
  }
  check('precondition: both staged by analyze', scan.plan.sources.every((s) => s._prepared), JSON.stringify(an.results && an.results.map((r) => !!r.prepared)));
  const run = await B.runBulkImport({ plan: scan.plan, userData: ud }, {});
  check('both imported', run.summary.imported.length === 2, JSON.stringify(run.summary.failed));

  const themes = findAll(path.join(ud, 'soundFonts', 'sources'), 'theme1.wav');
  check('precondition: each source holds the shared track', themes.length === 2, themes.join(' | '));
  check('THE SHARED TRACK IS STORED ONCE', themes.length === 2 && inoOf(themes[0]) === inoOf(themes[1]),
    themes.map(inoOf).join(' vs '));
  const second = run.summary.imported[1];
  check('and the second source reports what it saved', (second.crossSaved || 0) >= 2 * 512 * 1024,
    JSON.stringify({ crossSaved: second.crossSaved, crossFiles: second.crossFiles }));
  const own = findAll(path.join(ud, 'soundFonts', 'sources'), 'hum.wav');
  check('their own sounds stay their own', own.length === 2 && inoOf(own[0]) !== inoOf(own[1]));

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
