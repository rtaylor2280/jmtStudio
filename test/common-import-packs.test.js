// A source holding several packs (<Pack>/common each) becomes one common folder per pack, all from
// the one source and named from each pack's folder; one pack behaves as before. A zip whose top
// level is other zips is recognised from its listing so the import can refuse it up front.
// Built through the real common import, so the source layout is the importer's.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../soundFontCommon.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-packs-${n}-`));
function put(root, rel, buf) {
  const abs = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}
function wav(fill) {
  const data = Buffer.alloc(512, fill);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}

(async () => {
  const dirs = [];

  console.log('several packs in one folder');
  {
    const src = tmp('src'); const ud = tmp('ud'); dirs.push(src, ud);
    put(src, 'Bundle/PackA/common/mmain.wav', wav(1));
    put(src, 'Bundle/PackB/common/mmain.wav', wav(2));
    put(src, 'Bundle/PackB/common/battlevl.wav', wav(3));
    const r = await C.importCommonFromFolder(ud, path.join(src, 'Bundle'), 'Bundle');
    const all = C.listCommons(ud);
    check('the import succeeds', r && r.ok, JSON.stringify(r && r.error));
    check('one common folder per pack', all.length === 2, `${all.length}`);
    check('each is named from its pack folder, not the bundle',
          all.map((c) => c.meta.name).sort().join(',') === 'PackA,PackB', all.map((c) => c.meta.name).join(','));
    check('both come from the one source', new Set(all.map((c) => c.meta.sourceUuid)).size === 1);
    const b = all.find((c) => c.meta.name === 'PackB');
    check('each holds only its own pack', b && b.fileCount === 2 && b.meta.sourceSubPath === 'PackB/common',
          JSON.stringify(b && { n: b.fileCount, sub: b.meta.sourceSubPath }));
    check('the result lists every folder made', Array.isArray(r.commons) && r.commons.length === 2);
  }

  console.log('a bundle names the source, not a common folder');
  {
    const S = require('../soundFontSources.js');
    const src = tmp('src'); const ud = tmp('ud'); dirs.push(src, ud);
    put(src, 'Bundle/PackA/common/mmain.wav', wav(20));
    put(src, 'Bundle/PackB/common/mmain.wav', wav(21));
    const f = C.inspectIncomingCommonFolder(path.join(src, 'Bundle'));
    check('the folder is counted as two packs before importing', f.ok && f.packs === 2, JSON.stringify(f));
    const r = await C.importCommonFromFolder(ud, path.join(src, 'Bundle'), 'My Bundle', undefined, null, { bundle: true });
    const sm = S.readSourceMeta(path.join(S.sourcesRoot(ud), r.sourceUuid));
    check('the typed name becomes the source name', sm && sm.bundleName === 'My Bundle', JSON.stringify(sm && sm.bundleName));
    check('no common folder takes the typed name', !C.listCommons(ud).some((c) => c.meta.name === 'My Bundle'));
  }

  console.log('a pack name already in use is numbered');
  {
    const src = tmp('src'); const ud = tmp('ud'); dirs.push(src, ud);
    put(src, 'One/PackA/common/mmain.wav', wav(4));
    put(src, 'One/PackB/common/mmain.wav', wav(5));
    await C.importCommonFromFolder(ud, path.join(src, 'One'), 'One');
    const src2 = tmp('src'); dirs.push(src2);
    put(src2, 'Two/PackA/common/mmain.wav', wav(6));
    put(src2, 'Two/PackC/common/mmain.wav', wav(7));
    await C.importCommonFromFolder(ud, path.join(src2, 'Two'), 'Two');
    const names = C.listCommons(ud).map((c) => c.meta.name).sort().join(',');
    check('a second PackA becomes PackA_2', names === 'PackA,PackA_2,PackB,PackC', names);
  }

  console.log('one pack is unchanged');
  {
    const src = tmp('src'); const ud = tmp('ud'); dirs.push(src, ud);
    put(src, 'Solo/Hero/common/mmain.wav', wav(8));
    const r = await C.importCommonFromFolder(ud, path.join(src, 'Solo'), 'MyName');
    const all = C.listCommons(ud);
    check('one common folder, under the name given', all.length === 1 && all[0].meta.name === 'MyName',
          all.map((c) => c.meta.name).join(','));
    check('no pack list on a single import', !(r.commons && r.commons.length > 1));
  }

  console.log('a zip of zips is recognised; a zip of folders is not');
  {
    const work = tmp('zip'); dirs.push(work);
    // Build zips with the archiver the app already depends on.
    const archiver = require('archiver');
    const makeZip = (out, files) => new Promise((res, rej) => {
      const o = fs.createWriteStream(out); const a = archiver('zip');
      o.on('close', res); a.on('error', rej); a.pipe(o);
      for (const [name, buf] of files) a.append(buf, { name });
      a.finalize();
    });
    const innerA = path.join(work, 'A.zip'); const innerB = path.join(work, 'B.zip');
    await makeZip(innerA, [['A/common/mmain.wav', wav(9)]]);
    await makeZip(innerB, [['B/common/mmain.wav', wav(10)]]);
    const outer = path.join(work, 'outer.zip');
    await makeZip(outer, [['A.zip', fs.readFileSync(innerA)], ['B.zip', fs.readFileSync(innerB)]]);
    const plain = path.join(work, 'plain.zip');
    await makeZip(plain, [['A/common/mmain.wav', wav(11)], ['B/common/mmain.wav', wav(12)]]);
    const o = await C.inspectIncomingCommonZip(outer);
    const p = await C.inspectIncomingCommonZip(plain);
    check('two zips and no audio at the top: refused', o.ok && o.zipOfZips === true && o.innerZips === 2, JSON.stringify(o));
    check('a zip of pack folders: allowed', p.ok && p.zipOfZips === false, JSON.stringify(p));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
