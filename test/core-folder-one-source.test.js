// Where the Proffieboard core lives is the toolchain's answer, and nobody else's.
//
// Cores live one per version (arduino-data/4.6.0/). The folder root holds a core only on a
// machine that installed one before 1.8. Board detection and the Linux udev-rules command each
// built the root path themselves, so on a first install (the Yoga, 2026-11-08) a connected board
// read "No Proffieboard detected" and the udev command pointed at an empty folder. Windows
// machines upgraded from 1.7 hid it: their root still held 4.6.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const builders = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js') && f !== 'toolchain.js')
  .filter((f) => /['"]arduino-data['"]/.test(read(f)));
check('only toolchain.js names the arduino-data folder', builders.length === 0, builders.join(', '));

const pd = read('portDetector.js');
check('board detection asks the toolchain for the core folder',
  /function getArduinoDataPath\(\) \{\s*return toolchain\.getArduinoDataPath\(\);\s*\}/.test(pd));
const main = read('main.js');
const ipc = main.slice(main.indexOf("ipcMain.handle('app:getArduinoDataPath'"));
check('the udev-rules command gets the toolchain folder too',
  /const appPath = toolchain\.getArduinoDataPath\(\);/.test(ipc.slice(0, 600)));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
