// [B-398] The stall probe must still know what was running AFTER an auto-flush.
//
// Found on his first captured run, 2026-09-18: flush() cleared the timeline outright, so a phase
// that began before a flush and was still running after it lost its 'begin' event. Every later
// stall inside it was attributed to "(idle - nothing marked)" — while the same log showed a
// 37-second bulkImport:analyze wrapped around those exact stalls.
//
// That is the instrument reporting "nothing was happening" during the busiest part of the run,
// which is the one thing it exists to get right. A long import flushes several times by design
// (every 15s), so this is the NORMAL case, not an edge.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + detail : ''));
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-probe-'));
fs.writeFileSync(path.join(ud, '.stall-probe'), '');   // arm it

const probe = require('../stallProbe');
check('probe arms when the flag file exists', probe.init(ud) === true);

function blockFor(ms) {                       // a real synchronous block, not a fake one
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}
function waitForHeartbeat() {                 // let the timer fire and notice the gap
  return new Promise(res => setTimeout(res, 500));
}

(async () => {
  probe.begin('longRunningImport');

  // First flush happens WHILE the phase is still open — this is what auto-flush does.
  probe.flush('first auto-flush, phase still open');

  // Now stall, inside the same still-open phase.
  blockFor(900);
  await waitForHeartbeat();

  const text = probe.flush('second flush');
  probe.end('longRunningImport');

  check('the stall was recorded at all', /stalls: [1-9]/.test(text),
    'got:\n' + String(text).split('\n').slice(0, 8).join('\n'));

  check('it is attributed to the phase that was open across the flush',
    text.includes('longRunningImport'),
    'the phase name is missing from the report entirely');

  // ⚠️ The regression itself: the bug did not lose the stall, it MISLABELLED it. A test that only
  // checked "a stall was recorded" passes against the broken build.
  check('it is NOT reported as idle',
    !/\(idle - nothing marked\)/.test(text),
    'attributed to idle despite a phase being open — this is the original bug');

  // A phase that genuinely ended before the stall must not be BLAMED for it.
  //
  // ⚠️ SCOPED TO THE ATTRIBUTION SECTION ON PURPOSE. The first cut of this asserted the name was
  // absent from the whole report and failed against correct code: a finished phase legitimately
  // appears under "PHASE DURATIONS", which is wall-clock bookkeeping and says nothing about who
  // held the loop. Asserting on the whole text conflated the two sections and would have sent me
  // editing working code to satisfy a bad test.
  probe.begin('alreadyFinished');
  probe.end('alreadyFinished');
  blockFor(900);
  await waitForHeartbeat();
  const t2 = probe.flush('third flush');
  const blame = t2.split('BY PHASE')[1] || '';
  const blameOnly = blame.split('PHASE DURATIONS')[0] || '';
  check('a closed phase is not blamed for a later stall',
    blameOnly.length > 0 && !blameOnly.includes('alreadyFinished'),
    'a phase that had already ended was named as the culprit:\n' + blameOnly.trim());

  console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
