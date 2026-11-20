// On macOS a card counts as reachable only while its /Volumes folder is still a mounted volume.
// [QA10 M20, 2026-11-20] While macOS unmounts a pulled card it leaves the folder for a moment (empty,
// root-owned, mkdir gives EACCES), and an exists-only check called the card still there.
//
// Run: node test/mac-card-mount-check.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const at = main.indexOf('async function _destReachable(dir) {');
const src = at > 0 ? main.slice(at, main.indexOf('\n}\n', at) + 2) : '';
ok('the check was found', src.length > 100, `length=${src.length}`);
ok('the reachable handler uses it', /ipcMain\.handle\('exportDest:reachable'[^\n]*_destReachable\(dir\)/.test(main));

const load = ({ platform, exists = true, devs = {} }) => new Function('process', 'fs', 'liveDirSafe', `${src}; return _destReachable;`)(
  { platform },
  { promises: { stat: async (p) => { if (!(p in devs)) throw new Error('ENOENT'); return { dev: devs[p] }; } } },
  async (d) => (exists ? d : null));

(async () => {
  ok('Mac: a mounted card (its own device) is reachable',
    await load({ platform: 'darwin', devs: { '/Volumes/32kbTest': 41, '/Volumes': 7 } })('/Volumes/32kbTest') === true);
  ok('Mac: the folder left while unmounting (same device as /Volumes) is not reachable',
    await load({ platform: 'darwin', devs: { '/Volumes/32kbTest': 7, '/Volumes': 7 } })('/Volumes/32kbTest') === false);
  ok('Mac: a path inside the card is judged by the card itself',
    await load({ platform: 'darwin', devs: { '/Volumes/32kbTest': 7, '/Volumes': 7 } })('/Volumes/32kbTest/fonts') === false);
  ok('Mac: a folder that is gone is not reachable', await load({ platform: 'darwin', exists: false })('/Volumes/32kbTest') === false);
  ok('control: a Mac path outside /Volumes needs only to exist', await load({ platform: 'darwin' })('/Users/x/Downloads') === true);
  ok('control: Windows needs only to exist', await load({ platform: 'win32' })('L:\\') === true);

  // The real thing on a Mac: a mounted disk image is reachable, and gone once detached.
  if (process.platform === 'darwin') {
    const { execFileSync } = require('child_process');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm20-'));
    const img = path.join(tmp, 'm20.dmg');
    const name = 'M20P' + (process.pid % 10000);   // FAT names are at most 11 characters
    try {
      execFileSync('hdiutil', ['create', '-size', '2m', '-fs', 'MS-DOS', '-volname', name, img], { stdio: 'ignore' });
      const out = execFileSync('hdiutil', ['attach', img], { encoding: 'utf8' });
      const vol = (out.match(/\/Volumes\/.*$/m) || [''])[0].trim();
      ok('real Mac: the disk image mounted under its own name', vol === `/Volumes/${name}`, out);
      const live = new Function('process', 'fs', 'liveDirSafe', `${src}; return _destReachable;`)(process, fs,
        async (d) => (fs.existsSync(d) ? d : null));
      ok('real Mac: a mounted volume is reachable', await live(vol) === true);
      execFileSync('hdiutil', ['detach', vol], { stdio: 'ignore' });
      ok('real Mac: once detached it is not', await live(vol) === false);
    } catch (e) {
      ok('real Mac: disk image check ran', false, String(e.message || e));
    } finally {
      try { execFileSync('hdiutil', ['detach', `/Volumes/${name}`], { stdio: 'ignore' }); } catch {}
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
