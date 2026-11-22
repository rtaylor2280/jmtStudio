// A card whose health this computer can never read shows no health line. [B-635 area, 2026-11-07]
//
// On a Mac the not-cleanly-unmounted flag sits on the raw device, which macOS opens for
// administrators only, so every card is cannot-tell. A line that always says "unknown" carries
// nothing. Windows keeps "unknown", where a failed read is about one card.
//
// Run: node test/health-line-unreadable.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};
const S = fs.readFileSync(path.join(__dirname, '..', 'sdCardDetect.js'), 'utf8');
const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

const wh = S.slice(S.indexOf('function _withHealth('), S.indexOf('function _withHealth(') + 300);
ok('the Mac rows say whether health could be read', /healthReadable: (h\.)?health !== null/.test(wh));
ok('Windows rows do not set it, so a failed read there still says "unknown"',
  !/healthReadable/.test(S.slice(S.indexOf('function enumerateVolumesWindows'), S.indexOf('function _healthFromDirtyBit'))));

const line = (H.match(/const metaTxt = c\.isFolder[^\n]*/) || [''])[0];
ok('the meta line was located', line.length > 0);
ok('the health line is left off when it cannot be read',
  /c\.healthReadable === false \? '' : ` &middot; health: \$\{_sdEsc\(c\.health \|\| 'unknown'\)\}`/.test(line));

// Behaviour: render the template both ways.
const render = (c) => {
  const _sdEsc = (s) => String(s), _sdFmtGB = (n) => `${n} GB`;
  // eslint-disable-next-line no-new-func
  return new Function('c', '_sdEsc', '_sdFmtGB', `${line} return metaTxt;`)(c, _sdEsc, _sdFmtGB);
};
const mac = render({ fileSystem: 'FAT32', freeBytes: 1, sizeBytes: 2, health: null, healthReadable: false });
const win = render({ fileSystem: 'FAT32', freeBytes: 1, sizeBytes: 2, health: null });
const dirty = render({ fileSystem: 'FAT32', freeBytes: 1, sizeBytes: 2, health: 'Warning', healthReadable: true });
ok('a Mac card shows no health', !/health/.test(mac), mac);
ok('a Windows card that could not be read says "health: unknown"', /health: unknown/.test(win), win);
ok('a card that was read shows its answer', /health: Warning/.test(dirty), dirty);

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
