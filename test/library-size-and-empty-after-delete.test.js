// After a delete the library's figures come from the disk as it is now. [QA12 L31: the footer kept a
// size measured partway through a delete-everything, and the backup import offered Merge or Replace
// for a library that was empty on disk.]
//   1. A size request that arrives while a walk is running is kept: one more walk runs after it.
//   2. The empty check reads the library's folders, not a window's lists.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const sliceFrom = (start, endMarker) => {
  const a = main.indexOf(start);
  if (a < 0) return '';
  const b = main.indexOf(endMarker, a);
  return b < 0 ? '' : main.slice(a, b);
};

(async () => {
  console.log('1. a size request during a walk is not dropped');
  {
    const src = sliceFrom('let _sfSizeAgain = false;', "\nipcMain.handle('soundFonts:isEmpty'");
    check('CONTROL lifted the size handler and its walk', src.includes('function _sfStartSizeWalk(') && src.includes('_sfSizeAgain = true'));
    const walks = [];
    const soundFontLibrarySize = {
      read: () => null,
      refresh: () => new Promise((resolve) => walks.push(resolve)),
    };
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const app = { getPath: () => 'X' };
    const sent = [];
    const event = { sender: { send: (ch, v) => sent.push(v) } };
    new Function('ipcMain', 'app', 'soundFontLibrarySize', 'require', '_sfLibraryBusy',
      `let _sfSizeWalk = null; let _sfRelinkSweptKey = null;\n${src}`)(
      ipcMain, app, soundFontLibrarySize, require, () => true);
    const tick = () => new Promise((r) => setImmediate(r));
    handlers['soundFonts:size'](event);           // walk 1 starts (mid-delete)
    handlers['soundFonts:size'](event);           // the last delete's refresh arrives during it
    check('one walk running, the second request waits', walks.length === 1, `walks=${walks.length}`);
    walks[0]({ apparent: 135344636, files: 1117, onDisk: 1 });   // walk 1 lands with the mid-delete figure
    for (let i = 0; i < 5; i++) await tick();
    check('a second walk starts as soon as the first lands', walks.length === 2, `walks=${walks.length}`);
    walks[1]({ apparent: 0, files: 0, onDisk: 0 });
    for (let i = 0; i < 5; i++) await tick();
    check('and its figure, the library as it is now, is the last one sent', sent.length === 2 && sent[1].apparent === 0,
      JSON.stringify(sent));
    check('no third walk without a third request', walks.length === 2, `walks=${walks.length}`);
  }

  console.log('2. the empty check reads the disk');
  {
    const src = sliceFrom("ipcMain.handle('soundFonts:isEmpty'", "\nipcMain.handle('soundFonts:listFonts'");
    check('CONTROL lifted the empty check', src.includes("has('library')"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-empty-'));
    for (const b of ['library', 'sources', 'common']) fs.mkdirSync(path.join(root, b));
    const handlers = {};
    new Function('ipcMain', 'fs', 'path', '_soundFontsRoot', src)(
      { handle: (ch, fn) => { handlers[ch] = fn; } }, fs, path, () => root);
    check('three empty folders: empty', handlers['soundFonts:isEmpty']().empty === true);
    fs.mkdirSync(path.join(root, 'common', 'Darth Bane'));
    check('one common folder left: not empty', handlers['soundFonts:isEmpty']().empty === false);
    fs.rmdirSync(path.join(root, 'common', 'Darth Bane'));
    fs.writeFileSync(path.join(root, 'sources', '.DS_Store'), '');
    check('only a hidden file: still empty', handlers['soundFonts:isEmpty']().empty === true);
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('3. the backup import uses it');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
    check('the empty-library shortcut asks the disk, not the window\'s lists',
      html.includes('window.electronAPI.soundFontsIsEmpty()') && html.includes('if (libraryEmpty && liveSharedTracks === 0) {')
      && !/const liveEntries\s*=\s*\(window\._sfEntriesCache/.test(html));
  }

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
