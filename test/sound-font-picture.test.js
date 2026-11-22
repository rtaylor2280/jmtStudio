// A pack's picture: the common folder's own image first, then the image beside it in the source;
// an `a_` name wins a tie, then the first alphabetically. Built through the real common import so
// the source layout and the common's sourceSubPath are the importer's, not the test's.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../soundFontCommon.js');
const P = require('../soundFontPicture.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-pic-${n}-`));
function put(root, rel, buf) {
  const abs = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}
function wav() {
  const b = Buffer.alloc(44 + 256);
  b.write('RIFF', 0); b.writeUInt32LE(36 + 256, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(256, 40);
  return b;
}
// A minimal valid PNG header is enough: nothing here decodes the image.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

(async () => {
  const dirs = [];
  // Import the folder that HOLDS common/, so the image beside it is part of the source.
  const importPack = async (label, build) => {
    const src = tmp('pack');
    const ud = tmp('ud');
    dirs.push(src, ud);
    put(src, 'common/mmain.wav', wav());
    put(src, 'common/voicepack.ini', Buffer.from('version=2\r\n'));
    build(src);
    const r = await C.importCommonFromFolder(ud, src, label);
    if (!r || !r.ok) throw new Error(`import failed: ${r && r.error}`);
    return { ud, uuid: C.listCommons(ud)[0].uuid };
  };

  console.log('pickPicture');
  check('an a_ name beats an earlier name', P.pickPicture(['Art.png', 'a_Hero.jpg']) === 'a_Hero.jpg');
  check('without a_, the first alphabetically', P.pickPicture(['zeta.png', 'beta.jpg']) === 'beta.jpg');
  check('non-images are ignored', P.pickPicture(['ReadMe.txt', 'mmain.wav']) === null);

  console.log('common folder');
  {
    const { ud, uuid } = await importPack('Own', (d) => put(d, 'common/a_Hero.jpg', PNG));
    const p = await P.findCommonPicture(ud, uuid);
    check('an image inside the common is used', p && p.kind === 'common' && p.subPath === 'a_Hero.jpg', JSON.stringify(p));
  }
  {
    const { ud, uuid } = await importPack('Beside', (d) => put(d, 'kevin_flynn.png', PNG));
    const p = await P.findCommonPicture(ud, uuid);
    check('with none inside, the image beside common in the source is used',
          p && p.kind === 'source' && /kevin_flynn\.png$/.test(p.subPath), JSON.stringify(p));
    // The user sets their own by adding one to the common folder.
    put(path.join(C.commonRoot(ud), uuid, 'files'), 'mine.png', PNG);
    const q = await P.findCommonPicture(ud, uuid);
    check('an image the user adds to the common wins over the source', q && q.kind === 'common' && q.subPath === 'mine.png',
          JSON.stringify(q));
  }
  {
    const { ud, uuid } = await importPack('None', () => {});
    check('no image anywhere gives null', (await P.findCommonPicture(ud, uuid)) === null);
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
