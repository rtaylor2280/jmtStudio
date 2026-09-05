// [B-309] slice 1a — the two writers that store a source EXTRACTED, and the
// identity hash that replaces "sha256 of the zip we hold".
//
// The claim under test is narrow and load-bearing: storing content as a tree
// gives the SAME identity whichever container it arrived in. That is what lets
// dedup keep working once the zip stops being the stored artifact, and it is a
// property the current scheme cannot have - today a folder import and a zip
// import of identical content produce two unrelated numbers.
//
// The dangerous direction is a hash that varies with something it should not:
// arrival order, a filesystem mtime, or noise files. Each of those would show up
// as a false "new source" on a re-import, silently duplicating gigabytes.
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

function tmp(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-b309-' + tag + '-')); }

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

function tree(root) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
}

// Build a zip with archiver, the same library the app writes with.
function makeZip(srcDir, destZip) {
  return new Promise((resolve, reject) => {
    const archiver = require('archiver');
    const ws = fs.createWriteStream(destZip);
    const ar = archiver('zip', { zlib: { level: 1 } });
    ws.on('close', resolve);
    ar.on('error', reject);
    ar.pipe(ws);
    ar.directory(srcDir, false);
    ar.finalize();
  });
}

// A real RIFF/WAVE header with a complete data chunk. The health check reads the
// first 256 bytes and validates the chunk length against the file size, so a
// short placeholder string reads as "too small to be valid audio" - which is the
// check working, not a fixture detail worth skipping.
function wav(payload) {
  const data = Buffer.from(payload);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);            // fmt chunk size
  head.writeUInt16LE(1, 20);             // PCM
  head.writeUInt16LE(1, 22);             // mono
  head.writeUInt32LE(44100, 24);
  head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const FONT = {
  'Ahsoka/hum.wav':      wav('HUM-BYTES'),
  'Ahsoka/swing1.wav':   wav('SWING-BYTES'),
  'Ahsoka/blst/b1.wav':  wav('BLST-BYTES'),
  'Ahsoka/config.ini':   'font.wav=1\n',
};

(async () => {
  // ── The convergence claim ────────────────────────────────────────────────
  {
    console.log('the same content hashes the same from either container');
    const src = write(tmp('src'), FONT);
    const zipPath = path.join(tmp('zipdir'), 'bundle.zip');
    await makeZip(src, zipPath);

    const fromFolder = await S.copyFolderToDir(src, path.join(tmp('outA'), 'source'));
    const fromZip    = await S.extractZipToDir(zipPath, path.join(tmp('outB'), 'source'));

    check('folder route produced a hash', !!fromFolder.hash);
    check('zip route produced a hash', !!fromZip.hash);
    check('⭐ the two hashes MATCH', fromFolder.hash === fromZip.hash,
      `${fromFolder.hash} vs ${fromZip.hash}`);
    check('same file count', fromFolder.fileCount === fromZip.fileCount,
      `${fromFolder.fileCount} vs ${fromZip.fileCount}`);
    check('same byte total', fromFolder.totalBytes === fromZip.totalBytes,
      `${fromFolder.totalBytes} vs ${fromZip.totalBytes}`);
  }

  // ── The hash must not move for reasons that are not content ──────────────
  {
    console.log('identity is stable against things that are not content');
    const a = write(tmp('a'), FONT);
    const b = write(tmp('b'), FONT);
    // Different mtimes on the same bytes. The zip route had to force these to
    // epoch by hand; the record hash never looks at them.
    for (const f of ['Ahsoka/hum.wav', 'Ahsoka/swing1.wav']) {
      fs.utimesSync(path.join(b, f), new Date(0), new Date(0));
    }
    const ra = await S.copyFolderToDir(a, path.join(tmp('oa'), 'source'));
    const rb = await S.copyFolderToDir(b, path.join(tmp('ob'), 'source'));
    check('mtimes do not change identity', ra.hash === rb.hash);

    // A changed byte MUST change it, or the check above proves nothing.
    const c = write(tmp('c'), { ...FONT, 'Ahsoka/hum.wav': wav('DIFFERENT') });
    const rc = await S.copyFolderToDir(c, path.join(tmp('oc'), 'source'));
    check('a changed byte DOES change identity', rc.hash !== ra.hash);
  }

  // ── Noise is excluded on both routes, or the hashes diverge ──────────────
  {
    console.log('filesystem noise is dropped, identically on both routes');
    const src = write(tmp('noisy'), {
      ...FONT,
      '__MACOSX/Ahsoka/._hum.wav': 'APPLEDOUBLE',
      '.DS_Store': 'FINDER',
      'Ahsoka/Thumbs.db': 'WINDOWS',
    });
    const zipPath = path.join(tmp('nz'), 'noisy.zip');
    await makeZip(src, zipPath);

    const outF = path.join(tmp('nf'), 'source');
    const outZ = path.join(tmp('nzz'), 'source');
    const rf = await S.copyFolderToDir(src, outF);
    const rz = await S.extractZipToDir(zipPath, outZ);

    const clean = Object.keys(FONT).sort();
    check('folder route landed only the font files',
      JSON.stringify(tree(outF)) === JSON.stringify(clean), tree(outF).join(', '));
    check('zip route landed only the font files',
      JSON.stringify(tree(outZ)) === JSON.stringify(clean), tree(outZ).join(', '));
    check('and they still agree on identity', rf.hash === rz.hash);
  }

  // ── stripCorruptWavs keeps its meaning on the folder route ───────────────
  // It exists because reading a scrambled wav off a failing card can stall the
  // pass, so the check has to run BEFORE the copy. Asserting the file never
  // lands is the only way to tell that apart from a copy-then-delete.
  {
    console.log('corrupt wavs are dropped before they are copied');
    const src = write(tmp('corrupt'), { ...FONT, 'Ahsoka/bad.wav': 'not-a-riff-header-at-all' });
    const out = path.join(tmp('co'), 'source');
    const r = await S.copyFolderToDir(src, out, null, true);
    const landed = tree(out);
    check('the damaged wav is not in the output', !landed.includes('Ahsoka/bad.wav'), landed.join(', '));
    check('it is reported as stripped', r.strippedFiles.length === 1
      && r.strippedFiles[0].relPath === 'Ahsoka/bad.wav', JSON.stringify(r.strippedFiles));
    check('the good files all landed',
      JSON.stringify(landed) === JSON.stringify(Object.keys(FONT).sort()), landed.join(', '));
    check('and the count excludes it', r.fileCount === Object.keys(FONT).length, String(r.fileCount));

    // Without the flag it comes through untouched — the strip is opt-in, and a
    // clean import must not pay a header read.
    const out2 = path.join(tmp('co2'), 'source');
    const r2 = await S.copyFolderToDir(src, out2, null, false);
    check('opt-in: without the flag the file is kept', tree(out2).includes('Ahsoka/bad.wav'));
    check('and nothing is reported stripped', r2.strippedFiles.length === 0);
  }

  // ── Inner archives are expanded, which is what retires `nested` ──────────
  // The claim is not "we can unzip a zip" — it is that a tree which used to
  // produce an unanswerable candidate stops producing one. So the last case
  // runs the real detector over the result, because everything short of that
  // tests the plumbing rather than the outcome.
  {
    console.log('inner archives are expanded until none are left');

    // A vendor bundle shipping board formats as archives: Proffie.zip / CFX.zip.
    const inner = write(tmp('inner'), FONT);            // becomes Proffie.zip
    const innerZip = path.join(tmp('iz'), 'Proffie.zip');
    await makeZip(inner, innerZip);
    const bundle = tmp('bundle');
    fs.copyFileSync(innerZip, path.join(bundle, 'Proffie.zip'));
    fs.copyFileSync(innerZip, path.join(bundle, 'CFX.zip'));
    fs.writeFileSync(path.join(bundle, 'readme.txt'), 'vendor notes');
    const outerZip = path.join(tmp('oz'), 'bundle.zip');
    await makeZip(bundle, outerZip);

    const out = path.join(tmp('io'), 'source');
    const r = await S.extractZipToDir(outerZip, out);
    const landed = tree(out);
    check('no .zip files survive in the stored tree',
      !landed.some(f => /\.zip$/i.test(f)), landed.filter(f => /\.zip$/i.test(f)).join(', '));
    check('each archive became a folder of its own name',
      landed.includes('Proffie/Ahsoka/hum.wav') && landed.includes('CFX/Ahsoka/hum.wav'),
      landed.slice(0, 6).join(', '));
    check('non-archive files are untouched', landed.includes('readme.txt'));
    check('both expansions are reported', r.innerZipsExpanded.length === 2,
      JSON.stringify(r.innerZipsExpanded));
    check('the file count includes what came out of them', r.fileCount === 9, String(r.fileCount));

    // ⭐ The payoff: the detector no longer defers on this tree.
    const cands = (await require('../soundFontCandidates').detectCandidates({
      meta: { originalName: 'bundle' },
      async listAll() {
        const o = [];
        const walk = (d, rel) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const rp = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) { o.push({ fileName: rp + '/', size: 0, isDir: true }); walk(path.join(d, e.name), rp); }
            else o.push({ fileName: rp, size: fs.statSync(path.join(d, e.name)).size, isDir: false });
          }
        };
        walk(out, '');
        return o;
      },
      async readFile(p) { return fs.promises.readFile(path.join(out, p)); },
    })).candidates || [];
    check('the detector found something', cands.length > 0, String(cands.length));
    check('⭐ and NOTHING is flagged nested', cands.every(c => !c.nested),
      JSON.stringify(cands.map(c => ({ n: c.name, nested: c.nested }))));
  }

  {
    console.log('the depth cap holds and reports what it left');
    // Five levels of archive. The cap is four, so the innermost must survive as
    // a .zip rather than the recursion running away.
    let cur = write(tmp('deep0'), FONT);
    for (let i = 1; i <= 5; i++) {
      const z = path.join(tmp('deep' + i), 'L' + i + '.zip');
      await makeZip(cur, z);
      const holder = tmp('h' + i);
      fs.copyFileSync(z, path.join(holder, 'L' + i + '.zip'));
      cur = holder;
    }
    const outerZip = path.join(tmp('deepz'), 'outer.zip');
    await makeZip(cur, outerZip);
    const out = path.join(tmp('deepo'), 'source');
    const r = await S.extractZipToDir(outerZip, out);
    const zipsLeft = tree(out).filter(f => /\.zip$/i.test(f));
    check('it terminated rather than recursing away', true);
    check('an archive is left at the cap', zipsLeft.length === 1, zipsLeft.join(', '));
    check('and it is reported, not silently dropped', r.innerZipsLeft.length === 1,
      JSON.stringify(r.innerZipsLeft));
  }

  {
    console.log('a name collision is left alone rather than merged');
    // Proffie/ AND Proffie.zip in the same bundle. We cannot know which the
    // vendor meant, so merging would silently pick a winner.
    const b = tmp('collide');
    write(path.join(b, 'Proffie'), { 'hum.wav': wav('FOLDER-VERSION') });
    const innerSrc = write(tmp('cin'), { 'hum.wav': wav('ZIP-VERSION') });
    await makeZip(innerSrc, path.join(b, 'Proffie.zip'));
    const outer = path.join(tmp('cz'), 'c.zip');
    await makeZip(b, outer);
    const out = path.join(tmp('co3'), 'source');
    const r = await S.extractZipToDir(outer, out);
    check('the existing folder is not overwritten',
      fs.readFileSync(path.join(out, 'Proffie/hum.wav')).includes('FOLDER-VERSION'));
    check('the archive is left in place', tree(out).includes('Proffie.zip'));
    check('and it is reported as left', r.innerZipsLeft.includes('Proffie.zip'),
      JSON.stringify(r.innerZipsLeft));
  }

  // ── Progress is real, not decorative ─────────────────────────────────────
  {
    console.log('progress reports bytes actually written');
    const src = write(tmp('prog'), FONT);
    const seen = [];
    const r = await S.copyFolderToDir(src, path.join(tmp('po'), 'source'), (p) => seen.push(p));
    check('one event per file', seen.length === Object.keys(FONT).length, String(seen.length));
    check('bytes only ever increase', seen.every((p, i) => i === 0 || p.bytesProcessed >= seen[i - 1].bytesProcessed));
    check('ends at the total it promised',
      seen[seen.length - 1].bytesProcessed === r.totalBytes
      && seen[seen.length - 1].totalBytes === r.totalBytes,
      `${seen[seen.length - 1].bytesProcessed} of ${r.totalBytes}`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
