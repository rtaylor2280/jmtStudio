// Flash Time is one clock. [QA10, 2026-11-20] A flash that stopped to wait for the board left its clock
// running; the next flash started a second, and the two wrote Flash Time in turn (4:14 at 17%, jumping).
//
// Run: node test/flash-timer-one-clock.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'buildPanel.js'), 'utf8');
const fn = (name) => { const at = src.indexOf(`function ${name}() {`); return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at) + 2); };

// Run the two functions with a fake clock: count the intervals still running after two starts.
const live = new Set(); let next = 1;
const el = { style: {}, textContent: '' };
const run = new Function('document', 'setInterval', 'clearInterval', `let flashTimerInterval = null;
  ${fn('startFlashTimer')}\n${fn('stopFlashTimer')}\nreturn { startFlashTimer, stopFlashTimer };`)(
  { getElementById: () => el },
  () => { const id = next++; live.add(id); return id; },
  (id) => live.delete(id));
run.startFlashTimer();
run.startFlashTimer();
ok('two starts leave one clock running', live.size === 1, `running: ${live.size}`);
run.stopFlashTimer();
ok('stop leaves none', live.size === 0, `running: ${live.size}`);

const wait = src.indexOf("appendModalLog('The board did not come back on USB, so the flash cannot start.");
ok('the flash that stops to wait for the board stops its clock',
  wait > 0 && /stopFlashTimer\(\);\s*$/.test(src.slice(Math.max(0, wait - 80), wait)), src.slice(Math.max(0, wait - 80), wait));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
