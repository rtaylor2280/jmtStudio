// restartBoardViaMonitor, run rather than read: a board that restarts so fast its port never leaves
// the port list (gone 0.43 s on Linux, between two listings) still counts as restarted when the
// monitor's open connection closes by itself. No reconnect retries, one reset.
// The positive control runs the same scenario against the version without the close check and
// requires it to report not-restarted, so the scenario does reproduce the defect.
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

function lift(src) {
  const a = src.indexOf('async function restartBoardViaMonitor(');
  return a > -1 ? src.slice(a, src.indexOf('\nwindow._bpRestartBoardViaMonitor', a)) : '';
}

const PRE_FIX = `
  const dropsWithin = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await listed()) === false) return true; await sleep(100); }
    return false;
  };`;

// Builds the function inside a scope holding the module state and stubs it reads.
function harness(fnSrc, { closeAfterMs = 60, portEverAbsent = false } = {}) {
  const make = new Function('PORT', 'closeAfterMs', 'portEverAbsent', `
    let selectedPort = PORT, isBusy = false, isDfuMode = false;
    let _serialOpen = true, _serialLastRxAt = Date.now() - 5000, _serialRxSinceReset = null;
    const window = { _isFlashing: false, electronAPI: null };
    const log = { writes: 0, opens: 0, closes: 0, forgot: 0, lines: [] };
    let absentUntil = 0;
    window.electronAPI = {
      listPortsRaw: async () => (Date.now() < absentUntil ? [] : [{ path: PORT }]),
      writeSerial: async (t) => {
        log.writes++;
        // The board restarts: the monitor's connection closes by itself; the port may or may not
        // be seen leaving the list.
        setTimeout(() => {
          _serialOpen = false;
          if (portEverAbsent) absentUntil = Date.now() + 1500;
        }, closeAfterMs);
        return { ok: true };
      },
      boardForgetSdShared: () => { log.forgot++; },
    };
    const el = () => null;
    const _serialAppend = (t) => { log.lines.push(t); };
    async function openSerialMonitor() { log.opens++; _serialOpen = true; }
    async function closeSerialMonitor() { log.closes++; _serialOpen = false; }
    ${fnSrc}
    return { run: () => restartBoardViaMonitor(PORT), log };
  `);
  return make('/dev/ttyACM0', closeAfterMs, portEverAbsent);
}

(async () => {
  const now = fs.readFileSync(path.join(ROOT, 'renderer', 'buildPanel.js'), 'utf8');
  const fn = lift(now);
  check('CONTROL lifted restartBoardViaMonitor', fn.includes("writeSerial('reset\\n')") && fn.includes('wasOpen'));

  console.log('1. fast reboot: the port never leaves the list, the connection closes by itself');
  {
    const h = harness(fn);
    const t0 = Date.now();
    const r = await h.run();
    const ms = Date.now() - t0;
    check('reported restarted, back and ready', r && r.status === 'restarted' && r.back === true && r.ready === true, JSON.stringify(r));
    check('one reset written', h.log.writes === 1, String(h.log.writes));
    check('no reconnect retries: the only open is the reconnect after the restart', h.log.opens === 1, String(h.log.opens));
    check('the shared-card proof is cleared', h.log.forgot === 1, String(h.log.forgot));
    check('decided quickly, not after the retry windows', ms < 1500, `${ms} ms`);
  }

  console.log('2. slow reboot, as on Windows: the port is seen leaving the list');
  {
    const h = harness(fn, { closeAfterMs: 60, portEverAbsent: true });
    const r = await h.run();
    check('still reported restarted', r && r.status === 'restarted', JSON.stringify(r));
    check('one reset written', h.log.writes === 1, String(h.log.writes));
  }

  console.log('3. POSITIVE CONTROL: the version without the close check misses the fast reboot');
  {
    const a = fn.indexOf('  // A monitor connection that was open');
    const b = fn.indexOf('  if (!_serialOpen) { await openSerialMonitor();');
    const end = fn.indexOf('\n  };', a);
    const old = a > -1 && end > -1 ? fn.slice(0, a) + PRE_FIX.slice(1) + fn.slice(end + 5) : '';
    check('CONTROL built the pre-fix function', old && !old.includes('wasOpen') && b > -1, '');
    const h = harness(old);
    const r = await h.run();
    check('pre-fix reports not-restarted for the same scenario', r && r.status === 'not-restarted', JSON.stringify(r));
    check('pre-fix reconnects twice while looking', h.log.opens === 2, String(h.log.opens));
  }

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
