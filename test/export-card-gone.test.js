// An export failure is told as a lost card when the drive it was writing to can no longer be reached,
// whether or not the error names a path. [QA08, 2026-11-19: "UNKNOWN: unknown error, write" named none]
//
// Run: node test/export-card-gone.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const at = html.indexOf('async function _sfDestinationGone(err) {');
const fr = html.indexOf('function _sfFailureRoot(s) {');
const src = at > 0 && fr > 0
  ? html.slice(fr, html.indexOf('\n}\n', fr) + 2) + html.slice(at, html.indexOf('\n}\n', at) + 2) : '';
ok('the check was found', src.length > 100, `length=${src.length}`);

(async () => {
  const asked = [];
  const window = { electronAPI: { exportDestReachable: async ({ dir }) => { asked.push(dir); return { reachable: !/^L:/.test(dir) }; } } };
  const gone = new Function('window', `${src}; _sfDestinationGone.settleMs = 5; return _sfDestinationGone;`)(window);

  ok('a path in the error is checked: the card at L: is gone',
    await gone(new Error("UNKNOWN: unknown error, open 'L:\\ObiWan_3\\swingh\\swingh04.wav'")) === true && asked.pop() === 'L:\\');
  ok('control: a reachable drive is not called gone',
    await gone(new Error("EIO: i/o error, open 'C:\\x\\y.wav'")) === false && asked.join() === 'C:\\,C:\\');
  asked.length = 0;

  ok('ENXIO is the card gone even while its volume folder still answers (macOS, QA09 M20)',
    await gone(new Error("ENXIO: no such device or address, open '/Volumes/32kbTest/Echo_Of_Lumina/enddrag1.wav'")) === true
    && asked.length === 0);
  ok('control: a /Volumes path with another error is checked, and reachable is not gone',
    await gone(new Error("EIO: i/o error, open '/Volumes/32kbTest/x.wav'")) === false && asked.join() === '/Volumes/32kbTest,/Volumes/32kbTest');
  asked.length = 0;

  // macOS mid-unmount: the card's folder still answers the first ask, then is gone. [QA10 M20]
  let answers = [];
  window.electronAPI.exportDestReachable = async ({ dir }) => { asked.push(dir); return { reachable: answers.length ? answers.shift() : true }; };
  answers = [true, false];
  ok('a Mac card that still answered once is asked again after a settle, and then is gone',
    await gone(new Error("EACCES: permission denied, mkdir '/Volumes/32kbTest/common'")) === true && asked.length === 2);
  asked.length = 0; answers = [true, true];
  ok('control: asked again and still there, it is not gone',
    await gone(new Error("EACCES: permission denied, mkdir '/Volumes/32kbTest/common'")) === false && asked.length === 2);
  asked.length = 0; answers = [true, true];
  // One rule on every platform: the device errors are asked again after a settle, whatever the path.
  ok('control: a Windows drive that is still there after the settle is not gone',
    await gone(new Error("EIO: i/o error, open 'C:\\x\\y.wav'")) === false && asked.length === 2);
  asked.length = 0; answers = [true, false];
  ok('a Linux card that still answered once is asked again after a settle, and then is gone (QA12 L22)',
    await gone(new Error("EIO: i/o error, write '/run/media/user/QA_TESTING/Skoll/swng/swng1.wav'")) === true
    && asked.length === 2 && asked[0] === '/run/media/user/QA_TESTING');
  asked.length = 0; answers = [true, false];
  window._sfLastExportDest = '/run/media/user/QA_TESTING';
  ok('the Linux EIO that names no path, as seen on the Yoga, checks this export\'s card and finds it gone',
    await gone(new Error('EIO: i/o error, write')) === true
    && asked.join() === '/run/media/user/QA_TESTING,/run/media/user/QA_TESTING');
  window._sfLastExportDest = undefined;
  asked.length = 0; answers = [true, false];
  ok('control: a /Volumes error that is not the device kind is asked once',
    await gone(new Error("ENOSPC: no space left on device, write '/Volumes/32kbTest/x.wav'")) === false && asked.length === 1);
  asked.length = 0; answers = [];
  window.electronAPI.exportDestReachable = async ({ dir }) => { asked.push(dir); return { reachable: !/^L:/.test(dir) }; };

  window._sfLastExportDest = 'L:\\';
  ok('an error naming no path checks the destination of this export instead',
    await gone(new Error('UNKNOWN: unknown error, write')) === true && asked.pop() === 'L:\\');
  window._sfLastExportDest = 'D:\\Exports';
  ok('control: and is not called gone when that destination is still there',
    await gone(new Error('UNKNOWN: unknown error, write')) === false && asked.pop() === 'D:\\Exports');
  window._sfLastExportDest = undefined;
  ok('with no path and no destination it does not guess', await gone(new Error('UNKNOWN: unknown error, write')) === false);

  ok('the shared export runner records its destination', /const destDir = door\.destDir \|\| '';\s*\/\/[^\n]*\n\s*if \(destDir\) window\._sfLastExportDest = destDir;/.test(html));

  if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
