// Planning a folder export must not freeze the app or re-read the library per font. [B-639]
//
// Measured 2026-11-07 on a 225-font library to an empty folder: 57.8 s with a 25.3 s freeze, of
// which ~99% was the shown-picture lookup listing each font's whole download and the whole library
// once per font. After: 1.2 s, longest freeze 20 ms, the same picture chosen for all 225 fonts.
//
// Run: node test/plan-picture-cost.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const pic = read('soundFontPicture.js');
const besideStart = pic.indexOf('async function besideInSource(');
const beside = besideStart > 0 ? pic.slice(besideStart, pic.indexOf('\n}\n', besideStart)) : '';
ok('besideInSource was located', beside.length > 0);
ok('it reads the one folder that holds the item', /\.browse\(/.test(beside));
ok('and never lists the whole download', !/listAll\(/.test(beside));

const items = pic.slice(pic.indexOf('function sourceItems('), pic.indexOf('\n}\n', pic.indexOf('function sourceItems(')));
ok('sourceItems was located', items.length > 0);
ok('it does not build the full library listing', !/listEntries/.test(items));

const main = read('main.js');
const h = main.slice(main.indexOf("ipcMain.handle('entries:planFolderWrites'"),
  main.indexOf("ipcMain.handle('entries:exportToFolder'"));
ok('the plan handler was located', h.length > 0 && h.length < 4000, `length ${h.length}`);
ok('it shares one listings map across the selection', /const listings = new Map\(\)/.test(h)
  && /planFolderWrite\([^)]*listings/.test(h));
ok('and yields between fonts', /for \(const name of names\) \{\s*await breathe\(\);/.test(h));

// Behaviour: the one-folder read picks the image beside the item, ignoring other folders.
(async () => {
  const { pickPicture } = require('../soundFontPicture');
  ok('a_ names win, then alphabetical', pickPicture(['z.png', 'a_hero.jpg', 'b.png']) === 'a_hero.jpg'
    && pickPicture(['z.png', 'b.png']) === 'b.png');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b639-'));
  try {
    const userData = path.join(tmp, 'ud');
    const src = require('../soundFontSources');
    const uuid = 'u1';
    const root = path.join(src.sourcesRoot(userData), uuid, 'source');
    fs.mkdirSync(path.join(root, 'Bundle', 'Kenobi'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Other'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Bundle', 'a_kenobi.jpg'), 'x');
    fs.writeFileSync(path.join(root, 'Other', 'a_wrong.jpg'), 'x');
    fs.writeFileSync(path.join(src.sourcesRoot(userData), uuid, 'meta.json'), JSON.stringify({ uuid, format: 'folder' }));
    const P = require('../soundFontPicture');
    const opened = src.openSource(userData, uuid);
    if (!opened) { ok('control: the test source opens', false, 'fixture shape not accepted by openSource'); }
    else {
      const r = await P.findSourceOwnPicture(userData, uuid);
      ok('control: the top of this download has no image', r === null, JSON.stringify(r));
      const E = require('../soundFontEntries');
      const edir = path.join(E.entriesRoot(userData), 'Kenobi');
      fs.mkdirSync(edir, { recursive: true });
      fs.writeFileSync(path.join(edir, 'meta.json'),
        JSON.stringify({ name: 'Kenobi', sourceUuid: uuid, candidatePath: 'Bundle/Kenobi' }));
      const k = await P.findEntryPicture(userData, 'Kenobi');
      ok('a font in a bundle gets the image beside it', k && k.subPath === 'Bundle/a_kenobi.jpg'
        && k.origin === 'creator', JSON.stringify(k));
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
