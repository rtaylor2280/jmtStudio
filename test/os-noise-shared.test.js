// What an operating system leaves on a card is not card content, in the browser, the classifier
// or the bulk import scan. One list (osNoise.js) serves all three.
//
// Found 2026-11-07: importing a card on a Mac listed ".Spotlight-V100, .fseventsd, System Volume
// Information" as "3 not a Proffie font", because the import scan kept its own shorter list.
//
// Run: node test/os-noise-shared.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isOsNoiseName } = require('../osNoise');
const bulk = require('../soundFontBulkImport');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

for (const n of ['.Spotlight-V100', '.fseventsd', 'System Volume Information', '._boot.wav', '__MACOSX', '.DS_Store', 'Thumbs.db']) {
  ok(`noise: ${n}`, isOsNoiseName(n));
}
for (const n of ['common', 'Kenobi', 'tracks', 'boot.wav']) ok(`not noise: ${n}`, !isOsNoiseName(n));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osnoise-'));
try {
  for (const d of ['.Spotlight-V100', '.fseventsd', 'System Volume Information']) {
    fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, d, 'x.db'), 'x');
  }
  const font = path.join(root, 'Kenobi');
  fs.mkdirSync(font);
  for (const f of ['boot.wav', 'hum.wav', 'in.wav', 'out.wav', 'clsh1.wav', 'swng1.wav', 'font.wav', 'blst1.wav']) {
    fs.writeFileSync(path.join(font, f), 'RIFF');
  }
  fs.mkdirSync(path.join(root, 'Notes'));
  fs.writeFileSync(path.join(root, 'Notes', 'readme.txt'), 'x');

  const res = bulk.scanForBulkImport({ rootDir: root });
  ok('the scan ran', res && res.ok === true, JSON.stringify(res && res.error));
  const plan = (res && res.plan) || {};
  const skippedNames = (plan.skipped || []).map(s => path.basename(s.relPath || s.absPath || ''));
  ok('the font is found', (plan.sources || []).some(s => s.rawName === 'Kenobi'),
    JSON.stringify((plan.sources || []).map(s => s.rawName)));
  ok('no system folder is reported as "not a Proffie font"',
    !skippedNames.some(isOsNoiseName), JSON.stringify(skippedNames));
  ok('control: a real non-font folder still is', skippedNames.includes('Notes'), JSON.stringify(skippedNames));
} finally { fs.rmSync(root, { recursive: true, force: true }); }

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
