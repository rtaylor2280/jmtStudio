// Inner archives are expanded when a source is stored. [B-309]
//
// This is the piece that retires `nested`. A vendor who ships each font as its own
// zip inside one bundle used to give us candidates we could not look inside: the
// detector defers, the customization diff answers "unknowable", dedup sees one line
// per archive instead of the files, and every entry is a full copy. Measured on a
// real bundle before this existed — Power_Of_Many stored TEN archives totalling
// 2.18 GB as ELEVEN files, and its nine fonts got none of the storage model.
//
// The last case is the one that matters: the detector must stop producing deferred
// candidates. Everything before it tests the plumbing; that tests the outcome.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

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

const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-iz-' + t + '-'));
const zip = (from, to) => new Promise((res, rej) => {
  const ar = require('archiver')('zip', { zlib: { level: 1 } });
  const ws = fs.createWriteStream(to);
  ws.on('close', res); ar.on('error', rej);
  ar.pipe(ws); ar.directory(from, false); ar.finalize();
});

function tree(root) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
}

const srcRoot = (ud, uuid) => path.join(S.sourcesRoot(ud), uuid, 'source');

// ⚠️ A font needs at least MIN_EFFECT_TYPES (3) distinct effect types before the
// detector will call it one. A two-file fixture produced ZERO candidates, which
// made "nothing is flagged nested" pass because there was nothing to flag - a
// check that could not fail. Three effects is the floor, so this uses four.
function mkFont(root) {
  fs.mkdirSync(path.join(root, 'Proffie'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Proffie', 'hum.wav'), wav('SHARED-HUM'));
  fs.writeFileSync(path.join(root, 'Proffie', 'boot.wav'), wav('SHARED-BOOT'));
  fs.writeFileSync(path.join(root, 'Proffie', 'swing1.wav'), wav('SHARED-SWING'));
  fs.writeFileSync(path.join(root, 'Proffie', 'clsh1.wav'), wav('SHARED-CLSH'));
  return root;
}

(async () => {
  {
    console.log('the Power_Of_Many shape: one bundle, a zip per font');
    const font = mkFont(tmp('font'));
    const bundle = tmp('bundle');
    for (const n of ['Indara', 'Jecki', 'Osha']) await zip(font, path.join(bundle, n + '.zip'));
    fs.writeFileSync(path.join(bundle, 'readme.txt'), 'vendor notes');
    const outer = path.join(tmp('o'), 'Power.zip');
    await zip(bundle, outer);

    const ud = tmp('ud');
    const r = await S.importSource({ userData: ud, sourcePath: outer, originalName: 'Power.zip', metadata: {} });
    check('the import succeeded', r && r.ok, r && r.error);
    const files = tree(srcRoot(ud, r.uuid));
    check('⭐ no archive survives in the stored tree',
      !files.some(f => /\.zip$/i.test(f)), files.filter(f => /\.zip$/i.test(f)).join(', '));
    check('each font became a folder of real files',
      files.includes('Indara/Proffie/hum.wav') && files.includes('Osha/Proffie/swing1.wav'),
      files.join(', '));
    check('non-archive files are untouched', files.includes('readme.txt'));
    check('the stored count describes the files, not the archives',
      files.length === 13, String(files.length));

    // ⭐ The point of the whole exercise: sibling fonts inside one bundle can now
    // share. Before expansion each of these was a sealed archive holding its own
    // complete copy, invisible to dedup.
    const dd = await S.dedupeSource(ud, r.uuid);
    // 13 files: 4 effects x 3 fonts, plus readme.txt = 5 unique.
    check('⭐ dedup can now see inside the bundle',
      dd.deduped === true && dd.uniqueFiles === 5, JSON.stringify(dd));
    const ino = (p) => fs.statSync(path.join(srcRoot(ud, r.uuid), p)).ino;
    check('⭐ and sibling fonts share one copy',
      ino('Indara/Proffie/hum.wav') === ino('Jecki/Proffie/hum.wav'));
  }

  {
    console.log('the detector stops deferring');
    const font = mkFont(tmp('f2'));
    const bundle = tmp('b2');
    for (const n of ['Alpha', 'Beta']) await zip(font, path.join(bundle, n + '.zip'));
    const outer = path.join(tmp('o2'), 'B.zip');
    await zip(bundle, outer);
    const ud = tmp('ud2');
    const r = await S.importSource({ userData: ud, sourcePath: outer, originalName: 'B.zip', metadata: {} });
    const source = S.openSource(ud, r.uuid);
    const cands = (await require('../soundFontCandidates').detectCandidates(source)).candidates || [];
    check('candidates were found', cands.length > 0, String(cands.length));
    check('⭐ NOTHING is flagged nested', cands.every(c => !c.nested),
      JSON.stringify(cands.map(c => ({ n: c.name, nested: c.nested }))));
    check('and no candidate path names an archive',
      cands.every(c => !/\.zip/i.test(c.path || '')),
      JSON.stringify(cands.map(c => c.path)));
  }

  {
    console.log('the depth cap holds, and reports what it left');
    // Five nested levels against a cap of four. The innermost must survive as a
    // file rather than the loop running away.
    let cur = tmp('d0');
    fs.writeFileSync(path.join(cur, 'hum.wav'), wav('DEEP'));
    for (let i = 1; i <= 5; i++) {
      const holder = tmp('d' + i);
      await zip(cur, path.join(holder, 'L' + i + '.zip'));
      cur = holder;
    }
    const outer = path.join(tmp('dz'), 'deep.zip');
    await zip(cur, outer);
    const ud = tmp('ud3');
    const r = await S.importSource({ userData: ud, sourcePath: outer, originalName: 'deep.zip', metadata: {} });
    check('it terminated', r && r.ok, r && r.error);
    const left = tree(srcRoot(ud, r.uuid)).filter(f => /\.zip$/i.test(f));
    check('an archive remains at the cap rather than recursing away',
      left.length === 1, left.join(', '));
  }

  {
    console.log('a name collision is left alone, never merged');
    // Proffie/ AND Proffie.zip in one bundle: we cannot know which the vendor
    // meant, and merging silently picks a winner between two different things.
    const b = tmp('col');
    fs.mkdirSync(path.join(b, 'Proffie'), { recursive: true });
    fs.writeFileSync(path.join(b, 'Proffie', 'hum.wav'), wav('FOLDER-VERSION'));
    const inner = tmp('cin');
    fs.writeFileSync(path.join(inner, 'hum.wav'), wav('ZIP-VERSION'));
    await zip(inner, path.join(b, 'Proffie.zip'));
    const outer = path.join(tmp('cz'), 'c.zip');
    await zip(b, outer);
    const ud = tmp('ud4');
    const r = await S.importSource({ userData: ud, sourcePath: outer, originalName: 'c.zip', metadata: {} });
    const root = srcRoot(ud, r.uuid);
    check('the existing folder keeps its own content',
      fs.readFileSync(path.join(root, 'Proffie/hum.wav')).includes('FOLDER-VERSION'));
    check('and the archive is left in place rather than merged',
      tree(root).includes('Proffie.zip'), tree(root).join(', '));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
