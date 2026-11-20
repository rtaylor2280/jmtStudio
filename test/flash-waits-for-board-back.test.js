// A flash after the board forensics read waits for the board to come back, and a refresh that finds the
// board hands it to a flash waiting for it. [QA10, 2026-11-20, Mac]
//
// Traced on the Mac: the read ended 0.003 s after Studio's last look for the port, so the flash called the
// board gone ("did not come back on USB ... unplug it"); 0.7 s later the regular refresh found the board,
// and then stopped the flash's wait, so nothing flashed and plugging it in again did nothing.
//
// Run: node test/flash-waits-for-board-back.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'buildPanel.js'), 'utf8');

// 1. The wait after the read, before the "did not come back" message.
const msgAt = src.indexOf("appendModalLog('The board did not come back on USB, so the flash cannot start.");
const before = msgAt > 0 ? src.slice(Math.max(0, msgAt - 900), msgAt) : '';
ok('after a forensics read the flash polls for the board before giving up',
  /if \(!selectedPort && _bfAnswer === 'record'\)/.test(before) && /while \(!selectedPort && Date\.now\(\) < until\)/.test(before)
  && /await refreshPorts\(\)/.test(before), before.slice(-300));
const ms = Number((src.match(/const BOARD_BACK_WAIT_MS = (\d+);/) || [])[1]);
ok('it waits several seconds, not one look', ms >= 5000 && ms <= 15000, String(ms));

// 2. The end of refreshPorts: run it against each case.
const at = src.indexOf('async function refreshPorts() {');
const body = at > 0 ? src.slice(at, src.indexOf('\n}\n', at)) : '';
const tail = body.slice(body.indexOf('  // A flash waiting for its board'), body.indexOf('// Reconcile flash state'));
ok('refreshPorts no longer stops the wait unconditionally', tail.length > 50 && !/^\s*stopPortWatch\(\);\s*$/m.test(tail.replace(/if[\s\S]*?\{[\s\S]*?\}[\s\S]*?else \{\s*stopPortWatch\(\);\s*\}/, '')), tail);
const runTail = (ctx, result) => {
  const log = [];
  new Function('_portWatchContext', 'result', 'stopPortWatch', '_selectPortAndFlash', tail)(
    ctx, result, () => log.push('stop'), (p) => log.push(`flash:${p.path}`));
  return log.join(' ');
};
const one = { autoSelected: true, port: { path: '/dev/cu.usbmodem1' } };
ok('waiting to flash, one board found: the wait ends and that board is flashed', runTail('wait-flash', one) === 'stop flash:/dev/cu.usbmodem1', runTail('wait-flash', one));
ok('waiting to flash, several boards: the wait goes on (it asks which)', runTail('wait-flash', { autoSelected: false, proffieports: [{}, {}] }) === '');
ok('control: nothing waiting, the refresh stops the watch as before', runTail(null, one) === 'stop');

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
