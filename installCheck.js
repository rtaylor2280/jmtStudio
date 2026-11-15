// Are the files JMT Studio was installed with still there? [B-681]
//
// Antivirus software can remove a file it does not trust from an installed app, as it removed
// arduino-cli.exe and Studio's own processes from a fresh account. Nothing then fails loudly: a
// missing arduino-cli fails every compile, a missing koffi.node makes every card read answer
// "cannot tell" so the card list is empty, a missing dfu-util fails every flash. Each looks like
// a problem with the card, the board or the config. This check runs once at launch and names the
// missing files and what stops working, so the user is told the real cause.
//
// Only plain files on disk are checked: the bundled tools and the native files unpacked beside
// app.asar. A removed app.asar is a removed app, and nothing inside it could report that.

'use strict';

const fs = require('fs');
const path = require('path');

const COMPILE = 'compiling';
const FLASH = 'flashing';
const CARDS = 'card reading and ejecting';
const DRIVER = 'board driver setup';
const PLUGIN = 'JMT plugin builds';

// Every file to check, as { file, purpose }. `resourcesPath` holds the bundled tools; `appDir`
// is the folder the unpacked native files live in (app.asar.unpacked in a packaged build, the
// project folder in development).
function requiredFiles({ resourcesPath, appDir, platform = process.platform, arch = process.arch }) {
  const R = (...p) => path.join(resourcesPath, ...p);
  const A = (...p) => path.join(appDir, ...p);
  const list = [];
  if (platform === 'win32') {
    list.push(
      { file: R('arduino-cli', 'windows', 'arduino-cli.exe'), purpose: COMPILE },
      { file: R('tools', 'windows', 'dfu-util.exe'), purpose: FLASH },
      { file: R('tools', 'windows', 'dfu-suffix.exe'), purpose: FLASH },
      { file: R('tools', 'windows', 'libwinpthread-1.dll'), purpose: FLASH },
      { file: R('driver-helper', 'JMTStudioDriverHelper.exe'), purpose: DRIVER },
      { file: R('dfu-driver', 'jmt_proffie_winusb.inf'), purpose: DRIVER },
      { file: R('dfu-driver', 'jmt_proffie_winusb.cat'), purpose: DRIVER },
      { file: A('winNativeRun.js'), purpose: CARDS },
      { file: A('winDisksNative.js'), purpose: CARDS },
      { file: A('winSystemNative.js'), purpose: CARDS },
      { file: A('node_modules', 'koffi', 'build', 'koffi', `win32_${arch}`, 'koffi.node'), purpose: CARDS },
    );
  } else if (platform === 'darwin') {
    list.push(
      { file: R('arduino-cli', 'mac', 'arduino-cli'), purpose: COMPILE },
      { file: R('tools', 'mac', 'dfu-util'), purpose: FLASH },
      { file: R('tools', 'mac', 'dfu-suffix'), purpose: FLASH },
      { file: R('tools', 'mac', 'libusb-1.0.0.dylib'), purpose: FLASH },
    );
  } else if (platform === 'linux') {
    list.push(
      { file: R('arduino-cli', 'linux', 'arduino-cli'), purpose: COMPILE },
      { file: R('tools', 'linux', 'dfu-util'), purpose: FLASH },
      { file: R('tools', 'linux', 'dfu-suffix'), purpose: FLASH },
      { file: R('tools', 'linux', 'libusb-1.0.so.0'), purpose: FLASH },
    );
  }
  list.push({ file: R('jmt-plugin', 'manifest.json'), purpose: PLUGIN });
  return list;
}

// The files from `requiredFiles` that are not there, or are empty. An empty file is what some
// antivirus products leave in place of one they cleaned.
function missingFiles(opts, exists = _present) {
  return requiredFiles(opts).filter((f) => !exists(f.file));
}

function _present(p) {
  try { return fs.statSync(p).size > 0; } catch { return false; }
}

// The words for the user: what stops working, the files, and the way back. One paragraph, since
// the dialog shows its message as plain text.
function describe(missing) {
  if (!missing.length) return null;
  const purposes = [...new Set(missing.map((m) => m.purpose))];
  const names = [...new Set(missing.map((m) => path.basename(m.file)))];
  return {
    title: 'Some JMT Studio files are missing',
    message: `JMT Studio cannot find ${names.length === 1 ? 'a file' : 'some files'} it was installed with, `
      + (purposes.length === 1 ? `so ${purposes[0]} will not work. ` : `so these will not work: ${purposes.join(', ')}. `)
      + `Antivirus software sometimes removes files `
      + `like these, and reinstalling JMT Studio puts them back. Missing: ${names.join(', ')}.`,
  };
}

module.exports = { requiredFiles, missingFiles, describe };
