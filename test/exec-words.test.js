'use strict';
// Runs the page's own wording helper, lifted out of renderer/index.html.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const start = html.indexOf('function _execWords(paths)');
const end = html.indexOf('// "card" or "folder"', start);
if (start < 0 || end < start) { console.error('helper not found'); process.exit(1); }
const _execWords = new Function(`${html.slice(start, end)}; return _execWords;`)();

let failed = 0;
const ok = (name, got, want) => {
  const pass = got === want;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  <- ${got}`}`);
  if (!pass) failed++;
};

ok('one shortcut', _execWords(['a/hum.lnk']).count, 'a shortcut');
ok('many shortcuts', _execWords(['a.lnk', 'b.LNK']).count, '2 shortcuts');
ok('one program', _execWords(['a.exe']).count, 'a program file');
ok('many programs', _execWords(['a.exe', 'b.bat']).count, '2 program files');
ok('a mix counts each', _execWords(['a.exe', 'b.bat', 'c.bat', 'd.lnk']).count, '3 program files and a shortcut');
ok('a shortcut is named as one', _execWords(['a.lnk']).subject, 'A shortcut');
ok('a program has no shortcut note', _execWords(['a.exe']).note, '');
ok('a shortcut says what it can do', _execWords(['a.lnk']).note, ' It points to something else, and it can start a program when opened.');
ok('the file wording follows', _execWords(['a.lnk', 'b.lnk']).file, 'the shortcuts are');
ok('a mix names both', _execWords(['a.exe', 'b.lnk']).noun, 'program files and shortcuts');

console.log(failed ? `\n${failed} failure(s)` : '\nall exec wording tests passed');
process.exit(failed ? 1 : 0);
