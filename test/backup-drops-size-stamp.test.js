// A backup does not carry the footer's size measurement.
//
// `_jmt_library_meta.json` rides every backup, and its `size` key is the footer's last walk of the
// disk. A restore links identical files the library held apart, so the restored library is smaller
// on disk than the exported one (2026-10-21: 13.44 GB carried, 11.71 GB restored), and a carried
// stamp showed the old figure in the footer until the next walk. The key is dropped on the way in;
// anything else in the file still rides.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../soundFontBackup.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-bsz-${n}-`)); dirs.push(d); return d; };

(async () => {
  const ud = tmp('ud');
  const sf = path.join(ud, 'soundFonts');
  fs.mkdirSync(path.join(sf, 'library'), { recursive: true });
  const meta = { size: { schema: 1, apparent: 999, onDisk: 333, computedAt: '2026-10-21T00:00:00.000Z' }, kept: 'yes' };
  fs.writeFileSync(path.join(sf, '_jmt_library_meta.json'), JSON.stringify(meta));
  const zip = path.join(tmp('zip'), 'b.zip');
  const ex = await B.exportBackup({ userData: ud, destPath: zip, appVersion: 'test' });
  check('precondition: the backup exported', ex && ex.ok !== false, JSON.stringify(ex && ex.error));

  const z = await B.openBackupZip(zip);
  let carried = null;
  try { carried = JSON.parse((await z.entryData('_jmt_library_meta.json')).toString('utf8')); } catch (e) { carried = String(e); }
  finally { try { await z.close(); } catch {} }
  check('the library meta still rides', carried && typeof carried === 'object', JSON.stringify(carried));
  check('WITHOUT THE SIZE MEASUREMENT', carried && typeof carried === 'object' && !('size' in carried), JSON.stringify(carried));
  check('and with everything else in it', carried && carried.kept === 'yes', JSON.stringify(carried));
  check('the library itself is untouched', JSON.parse(fs.readFileSync(path.join(sf, '_jmt_library_meta.json'), 'utf8')).size.onDisk === 333);

  const ud2 = tmp('restore');
  await B.applyReplace({ userData: ud2, zipPath: zip });
  let restored = null;
  try { restored = JSON.parse(fs.readFileSync(path.join(ud2, 'soundFonts', '_jmt_library_meta.json'), 'utf8')); } catch {}
  check('A RESTORE BRINGS BACK NO OLD MEASUREMENT', restored && !('size' in restored), JSON.stringify(restored));

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
