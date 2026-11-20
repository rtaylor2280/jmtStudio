/**
 * The backup's room check asks for what the backup writes, not every name's bytes  [BUG-022]
 *
 * Since B-498 a file with two names on disk is stored once in the backup. The room check still
 * asked for the sum of every name, so a library of 50 GB of names and 14.7 GB on disk was
 * refused on a drive with 28 GB free.
 *
 * What has to hold:
 *   - the survey reports onDiskBytes, counting a file with two names once
 *   - totalBytes still counts every name (the progress and summary figures use it)
 *   - a library with no shared files reports the same number for both
 *   - the backup door's room check passes onDiskBytes, and so does the plan the export runner
 *     checks again at Start; that refusal calls it a backup
 *
 * Run: node test/backup-fit-uses-on-disk-size.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const backup = require(process.env.BUG022_MODULE || path.join(ROOT, 'soundFontBackup.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const tmps = [];
function mkUd() { const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'bug022-')); tmps.push(ud); return ud; }

function font(ud, name) {
  const dir = path.join(ud, 'soundFonts', 'library', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: '1', name }));
  return dir;
}

(async () => {
  try {
    // Shared: Font_A's hum is also Font_B's and Font_C's hum (three names, one file).
    const ud = mkUd();
    const a = font(ud, 'Font_A');
    const b = font(ud, 'Font_B');
    const c = font(ud, 'Font_C');
    const HUM = 100000;
    fs.writeFileSync(path.join(a, 'hum.wav'), Buffer.alloc(HUM, 7));
    fs.linkSync(path.join(a, 'hum.wav'), path.join(b, 'hum.wav'));
    fs.linkSync(path.join(a, 'hum.wav'), path.join(c, 'hum.wav'));
    fs.writeFileSync(path.join(b, 'swing.wav'), Buffer.alloc(5000, 3));

    const s = await backup.surveyLibraryAsync(ud, { probeReadability: true });
    ok('totalBytes counts every name', s.totalBytes >= 3 * HUM + 5000,
      `totalBytes=${s.totalBytes}`);
    ok('onDiskBytes is reported', typeof s.onDiskBytes === 'number', `onDiskBytes=${s.onDiskBytes}`);
    ok('onDiskBytes counts the shared file once',
      s.totalBytes - s.onDiskBytes === 2 * HUM,
      `total=${s.totalBytes} onDisk=${s.onDiskBytes} diff=${s.totalBytes - s.onDiskBytes}`);

    // A shared track that is the same stored file as a font's track counts once too. [QA09 M28:
    // the backup's start screen said 1.48 GB on disk, the finished backup and the footer 1.35]
    const ud3 = mkUd();
    const e = font(ud3, 'Font_E');
    const TRK = 70000;
    fs.mkdirSync(path.join(e, 'tracks'), { recursive: true });
    fs.writeFileSync(path.join(e, 'tracks', 'theme.wav'), Buffer.alloc(TRK, 9));
    const stDir = path.join(ud3, 'soundFonts', 'sharedTracks');
    fs.mkdirSync(stDir, { recursive: true });
    fs.linkSync(path.join(e, 'tracks', 'theme.wav'), path.join(stDir, 'theme.wav'));
    const s3 = await backup.surveyLibraryAsync(ud3, { probeReadability: true });
    ok('a shared track that is also a font track counts once on disk',
      s3.totalBytes - s3.onDiskBytes === TRK,
      `total=${s3.totalBytes} onDisk=${s3.onDiskBytes} diff=${s3.totalBytes - s3.onDiskBytes}`);

    // Plain: no shared files, the two figures agree.
    const ud2 = mkUd();
    const d = font(ud2, 'Font_D');
    fs.writeFileSync(path.join(d, 'hum.wav'), Buffer.alloc(HUM, 1));
    const s2 = await backup.surveyLibraryAsync(ud2, { probeReadability: true });
    ok('no shared files: onDiskBytes equals totalBytes', s2.onDiskBytes === s2.totalBytes,
      `total=${s2.totalBytes} onDisk=${s2.onDiskBytes}`);

    // The door: the backup's preflight call sizes from onDiskBytes.
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    const i = html.indexOf("_sfRefuseNotEnoughRoom(_bkFit.tooBig, { noun: 'backup' })");
    const callAt = html.lastIndexOf('preflightExportDest(', i);
    const call = callAt >= 0 ? html.slice(callAt, html.indexOf('});', callAt)) : '';
    ok('the backup room check sizes through the shared need', /totalBytes:\s*_sfBackupNeedBytes\(survey\)/.test(call),
      call.trim().slice(0, 200));

    // The need itself: on-disk bytes plus the zip's own weight, since stored sound makes the
    // archive a little LARGER than the library. Evaluated from the page's own source.
    {
      const f0 = html.indexOf('function _sfBackupNeedBytes(survey)');
      const f1 = html.indexOf('\nwindow._sfBackupNeedBytes', f0);
      const need = f0 >= 0 && f1 > f0 ? new Function(html.slice(f0, f1) + '\nreturn _sfBackupNeedBytes;')() : null;
      const MB = 1024 * 1024;
      const v = need && need({ onDiskBytes: 1000 * MB, totalBytes: 3000 * MB, fileCount: 40000 });
      ok('the need adds the zip overhead to the on-disk bytes',
        v > 1000 * MB && v < 1000 * MB + 40000 * 1024 + 64 * MB, String(v));
      ok('an older survey falls back to every name', !!need && need({ totalBytes: 3000 * MB }) === 3000 * MB);
    }

    // The second check: the export runner's own preflight sizes from the door's plan. The first
    // fix missed it, and the live retry was refused there as "This export needs 50.25 GB".
    const d0 = html.indexOf('const _sfRunExportBackup = async');
    const door = d0 >= 0 ? html.slice(d0, html.indexOf('subscribe:', d0)) : '';
    ok('the backup plan sizes through the shared need', /totalBytes:\s*_sfBackupNeedBytes\(survey\)/.test(door),
      door.slice(0, 300));
    ok('the backup door calls its refusal a backup', /noun:\s*'backup'/.test(door));
    ok('the runner threads the noun to the refusal',
      /noun:\s*door\.noun/.test(html) && /_sfRefuseNotEnoughRoom\(p\.tooBig, \{ blockedDelete, noun \}\)/.test(html));
  } finally {
    for (const t of tmps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} }
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
