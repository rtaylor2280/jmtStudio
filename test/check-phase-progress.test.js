// The check before a folder export says where it is and can be cancelled. [B-640]
//
// Seen 2026-11-07: minutes on "Identifying the destination" while every file on the card was read,
// with no count, no file names and no Cancel. The runner owns the surface; the door only reports.
//
// Run: node test/check-phase-progress.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};
const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// The runner's reporter.
const cpStart = H.indexOf('const _sfCheckPhase = () => {');
const cp = cpStart > 0 ? H.slice(cpStart, H.indexOf('const _sfRunExport = async', cpStart)) : '';
ok('the runner\'s check reporter was located', cp.length > 0);
ok('it offers Cancel', /offerCancel\(/.test(cp));
ok('it shows the files going by', /onSoundFontByteProgress\(/.test(cp));
ok('it keeps its own clock', /setInterval\(paint, 250\)/.test(cp));
ok('it starts only when a door reports, so a door that paints itself is left alone',
  /start\(\) \{ armed = true; \}/.test(cp) && /if \(armed\) begin\(\);/.test(cp));
ok('done() retires the clock, the subscription and the Cancel',
  /done\(\) \{[\s\S]{0,200}clearInterval\(clock\)[\s\S]{0,120}off\(\)[\s\S]{0,120}clearCancel\(\)/.test(cp));

// The runner hands it to plan and compare and honours a cancel from either.
const rStart = H.indexOf('const _sfRunExport = async (door = {}) => {');
const runner = rStart > 0 ? H.slice(rStart, H.indexOf('out.decisions = decisions;', rStart)) : '';
ok('the runner was located', runner.length > 0);
ok('the plan gets the reporter', /await door\.plan\(_check\)/.test(runner));
ok('and a cancelled plan stops the export', /if \(_check\.cancelled\) \{ await _dropRaised\(\); return out; \}/.test(runner));
ok('the compare gets it too', /await door\.compare\(plan, destDir, _check\)/.test(runner));
ok('and a cancelled compare goes down the cancel path', /if \(_check\.cancelled\) decisions = null;/.test(runner));

// The folder-export door reports through it rather than drawing its own surface.
ok('the door reports a count per font',
  /check\.at\(`Comparing with your library · \$\{i \+ 1\} of \$\{_fonts\.length\}`/.test(H));
ok('and stops between fonts when cancelled', /if \(check && check\.cancelled\) return null;/.test(H));
ok('and retires the reporter before asking skip or replace',
  /finally \{ if \(check\) check\.done\(\); \}\s*if \(_differing\.length\)/.test(H));
ok('its plan asks the main process to report files', /planFolderWrites\(\{\s*names: _fonts, destDir: pick\.destDir, reportProgress: true \}\)/.test(H));

// The plan handler reports files and can be cancelled.
const hStart = M.indexOf("ipcMain.handle('entries:planFolderWrites'");
const h = hStart > 0 ? M.slice(hStart, M.indexOf("ipcMain.handle('entries:exportToFolder'", hStart)) : '';
ok('the plan handler was located', h.length > 0);
ok('it runs under the export cancel gate', /_withExportCancel\(async \(shouldStop\)/.test(h));
ok('it names files as "<font> · <file>"', /name: b && b\.name \? `\$\{name\} · \$\{b\.name\}` : name/.test(h));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
