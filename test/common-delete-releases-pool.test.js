// Deleting a common folder frees what only it held in the pool.  [B-316]
//
// Found 2026-10-20 on a wiped library: an image pasted into a common folder (the paste goes
// through file ops, which keeps new content in the pool and links the folder's name to it) was
// still in the pool after the folder was deleted, with nothing else using it. Deleting a font
// or a single file already released such files; deleting a common folder did not.
//
// The negative case matters as much: a pooled file another folder still uses must stay.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../soundFontCommon.js');
const F = require('../soundFontFileOps.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-cdpool-${n}-`)); dirs.push(d); return d; };
const wav = (fill) => { const b = Buffer.alloc(600, fill); b.write('RIFF', 0); b.write('WAVE', 8); return b; };
const poolNames = (ud) => {
  try { return fs.readdirSync(path.join(ud, 'soundFonts', 'pool')).filter((n) => !n.startsWith('.')); }
  catch { return []; }
};
async function pack(ud, name, fill) {
  const src = tmp('src');
  fs.mkdirSync(path.join(src, name, 'common'), { recursive: true });
  fs.writeFileSync(path.join(src, name, 'common', 'mmain.wav'), wav(fill));
  await C.importCommonFromFolder(ud, path.join(src, name), name);
  return C.listCommons(ud).find((c) => c.meta.name === name).uuid;
}
async function paste(ud, uuid, bytes, destName) {
  const png = path.join(tmp('clip'), 'pasted-image.png');
  fs.writeFileSync(png, bytes);
  return F.addFilesAt({ userData: ud, kind: 'common', id: uuid, subPath: '', sourceFilePaths: [png], destNames: [destName] });
}
const image = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2000, n)]);

(async () => {
  console.log('the last user of a pooled image');
  {
    const ud = tmp('ud');
    const uuid = await pack(ud, 'Pack', 1);
    const r = await paste(ud, uuid, image(9), 'pack.png');
    check('precondition: the pasted image is in the pool', r && r.ok && poolNames(ud).includes('pack.png'), JSON.stringify(poolNames(ud)));
    C.deleteCommon(ud, uuid);
    check('DELETING THE FOLDER FREES IT', !poolNames(ud).includes('pack.png'), JSON.stringify(poolNames(ud)));
  }

  console.log('a pooled image another folder still uses');
  {
    const ud = tmp('ud');
    const a = await pack(ud, 'PackA', 2);
    const b = await pack(ud, 'PackB', 3);
    await paste(ud, a, image(7), 'same.png');
    await paste(ud, b, image(7), 'same.png');
    check('precondition: one pooled copy, two users', poolNames(ud).length === 1, JSON.stringify(poolNames(ud)));
    C.deleteCommon(ud, a);
    check('it stays while the other folder uses it', poolNames(ud).length === 1, JSON.stringify(poolNames(ud)));
    check('and the other folder still has it', fs.existsSync(path.join(C.commonRoot(ud), b, 'files', 'same.png')));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
