// After a board card is ejected, the board is sent `reset` so it reads its card again.
//
//   1. main's board:restartAfterEject finds the port by the board's serial number and sends reset
//      by opening the port, closing a Serial Monitor open on it first (its connection can be dead
//      after the card was written and ejected);'busy' when another program holds it, 'no-port' when no port has that serial; `back` once the port has dropped and come back, `ready` once it opens again.
//   2. Both eject surfaces (the summary row and the toast) look the board up before the eject
//      and restart it after a fresh eject.
// Checked on hardware 2026-10-25 (board 2078377E4130 on COM18): restarted via port and via the
// monitor, busy with the port held, and the card did not come back to Windows after the reset.
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const at = main.indexOf("ipcMain.handle('board:restartAfterEject', ");
const fnStart = main.indexOf('async (', at);
let depth = 0, end = -1;
for (let j = main.indexOf('{', main.indexOf('=>', fnStart)); j < main.length; j++) {
  if (main[j] === '{') depth++;
  else if (main[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
}
const src = at > -1 && end > -1 ? main.slice(fnStart, end) : '';
check('CONTROL lifted the handler from main.js', src.includes('_boardPortForSerial(') && src.includes("'\\nreset\\n'"));

// A serial port stand-in that records what was written.
// `presence` is what successive list() calls see of COM18: by default it drops and comes back.
// `refusals` is how many opens after the reset fail first ("Unknown error code 433" on the bench).
function makeSerial({ openError = null, presence = [true, false, false, true], refusals = 0 } = {}) {
  const written = [];
  let n = 0, opened = 0;
  class FakePort {
    static async list() {
      const h = presence[Math.min(n++, presence.length - 1)];
      return h ? [{ path: 'COM18' }] : [];
    }
    constructor(o) { this.path = o.path; this.isOpen = false; }
    on() {}
    open(cb) {
      if (openError) return cb(new Error(openError));
      if (opened++ > 0 && refusals > 0) { refusals--; return cb(new Error('Opening COM18: Unknown error code 433')); }
      this.isOpen = true; cb(null);
    }
    write(t, cb) { written.push(t); cb && cb(null); }
    drain(cb) { cb(); }
    close(cb) { this.isOpen = false; cb && cb(); }
  }
  return { mod: { SerialPort: FakePort }, written };
}
// The port-came-back wait is lifted beside the handler.
const waitAt = main.indexOf('async function _boardPortCameBack(');
let wEnd = -1; depth = 0;
for (let j = main.indexOf('{', waitAt); j < main.length; j++) {
  if (main[j] === '{') depth++;
  else if (main[j] === '}') { depth--; if (!depth) { wEnd = j + 1; break; } }
}
const waitSrc = waitAt > -1 && wEnd > -1 ? main.slice(waitAt, wEnd) : '';
function liftFn(name) {
  const at = main.indexOf(`async function ${name}(`);
  let d = 0, e = -1;
  for (let j = main.indexOf('{', at); j < main.length; j++) {
    if (main[j] === '{') d++;
    else if (main[j] === '}') { d--; if (!d) { e = j + 1; break; } }
  }
  return at > -1 && e > -1 ? main.slice(at, e) : '';
}
const portSrc = liftFn('_boardPortForSerial');
check('CONTROL lifted the port lookup', portSrc.includes('portDetect.listPorts'));
check('CONTROL lifted the port-came-back wait', waitSrc.includes('SerialPort.list()'));
let listCalls = 0;
const shared = new Map();
const broadcasts = [];
function build({ ports, monitor = null, serial }) {
  const portDetect = { listPorts: async () => { listCalls++; return { ok: true, ports }; } };
  const closeMonitor = done => { if (monitor) { monitor.isOpen = false; monitor.closed = true; } monitor = null; done && done(); };
  const broadcast = (ch, p) => broadcasts.push([ch, p]);
  return new Function('portDetect', 'getMonitor', 'require', '_abortVersionProbe', '_sdSharedInApp',
    '_closeSerialMonitor', '_broadcastSerial',
    `${waitSrc}
${portSrc}
return ${src.replace(/_serialMonitorPort/g, 'getMonitor()')};`)(
    portDetect, () => monitor, (m) => (m === 'serialport' ? serial.mod : require(m)), null, shared,
    closeMonitor, broadcast);
}
const PORTS = [{ path: 'COM4', serialNumber: '' }, { path: 'COM18', serialNumber: '2078377E4130' }];

(async () => {
  console.log('1. the handler');
  if (src) {
    let s = makeSerial();
    let r = await build({ ports: PORTS, serial: s })(null, { boardSerial: '2078377e4130' });
    check('port free: restarted by opening the port, matched case-insensitively',
      r.status === 'restarted' && r.via === 'port' && r.port === 'COM18', JSON.stringify(r));
    check('and ready, because the port dropped, came back and opened', r.back === true && r.ready === true, JSON.stringify(r));
    s = makeSerial({ refusals: 3 });
    r = await build({ ports: PORTS, serial: s })(null, { boardSerial: '2078377E4130' });
    check('listed but refusing to open: waits until it opens, then ready', r.ready === true, JSON.stringify(r));
    check('and the board was sent reset', s.written.join('') === '\nreset\n', JSON.stringify(s.written));

    s = makeSerial({ openError: 'Opening COM18: Access denied' });
    r = await build({ ports: PORTS, serial: s })(null, { boardSerial: '2078377E4130' });
    check('another program holds it: busy, nothing written', r.status === 'busy' && !s.written.length, JSON.stringify(r));

    s = makeSerial();
    const monWritten = [];
    const monitor = { isOpen: true, path: 'com18', write: (t, cb) => { monWritten.push(t); cb(null); } };
    broadcasts.length = 0;
    r = await build({ ports: PORTS, monitor, serial: s })(null, { boardSerial: '2078377E4130' });
    check('the Serial Monitor has it: its connection is closed and reset goes out on a fresh one',
      r.status === 'restarted' && r.via === 'port' && monitor.closed && !monWritten.length
      && s.written.join('') === '\nreset\n', JSON.stringify({ r, monWritten, opened: s.written }));
    check('and the monitor is told it is disconnected',
      broadcasts.some(([ch, p]) => ch === 'serial:closed' && p.reason === 'close'), JSON.stringify(broadcasts));

    const other = { isOpen: true, path: 'COM7', write: () => { throw new Error('wrong port'); } };
    s = makeSerial();
    r = await build({ ports: PORTS, monitor: other, serial: s })(null, { boardSerial: '2078377E4130' });
    check('a monitor on another board is not used', r.status === 'restarted' && r.via === 'port', JSON.stringify(r));
    check('the monitor path waits for the port too', (await build({ ports: PORTS, serial: makeSerial(),
      monitor: { isOpen: true, path: 'COM18', write: (t, cb) => cb(null) } })(null, { boardSerial: '2078377E4130' })).ready === true);

    r = await build({ ports: PORTS, serial: makeSerial({ presence: [true] }) })(null, { boardSerial: '2078377E4130' });
    check('the port never dropped: sent, but neither back nor ready', r.status === 'restarted' && !r.back && !r.ready, JSON.stringify(r));
    r = await build({ ports: PORTS, serial: makeSerial({ presence: [true, false] }) })(null, { boardSerial: '2078377E4130' });
    check('the port never came back: not claimed ready', r.status === 'restarted' && !r.back && !r.ready, JSON.stringify(r));

    listCalls = 0;
    shared.set('COM18', true);
    r = await build({ ports: PORTS, serial: makeSerial() })(null, { boardSerial: '2078377E4130', portPath: 'COM18' });
    check('a port looked up before the eject is used as is (no ~2 s list after the eject)',
      r.status === 'restarted' && r.port === 'COM18' && listCalls === 0, JSON.stringify({ r, listCalls }));
    check('a restart ends the in-app share (the board boots with access off)', !shared.has('COM18'));
    listCalls = 0;
    r = await build({ ports: PORTS, serial: makeSerial({ presence: [false, false, true] }) })(null,
      { boardSerial: '2078377E4130', portPath: 'COM18' });
    check('a stale port hint falls back to the lookup', listCalls === 1, JSON.stringify({ r, listCalls }));

    r = await build({ ports: PORTS, serial: makeSerial() })(null, { boardSerial: 'FFFFFFFFFFFF' });
    check('no port with that serial: no-port', r.status === 'no-port', JSON.stringify(r));
    r = await build({ ports: PORTS, serial: makeSerial() })(null, {});
    check('no serial at all: no-port', r.status === 'no-port', JSON.stringify(r));
  }

  console.log('2. the eject surfaces');
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  const pre  = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  check('preload exposes it', /restartBoardAfterEject:\s*\(boardSerial, portPath\)\s*=>\s*ipcRenderer\.invoke\('board:restartAfterEject', \{ boardSerial, portPath \}\)/.test(pre));
  const row = html.slice(html.indexOf('const _sfWireEjectRow = '), html.indexOf('const _sfWireEjectRow = ') + 6000);
  check('the row looks the board up when it is wired, before any eject',
    row.indexOf('const boardP = _sfBoardOfMount(target.mountPath);') > -1
    && row.indexOf('const boardP = _sfBoardOfMount(target.mountPath);') < row.indexOf('ejectMedia('));
  check('the row restarts it after a fresh eject', /if \(onBoard\) \{\s*const said = await _sfRestartBoardAfterEject\(boardP\);/.test(row));
  const toastAt = html.indexOf("const TOAST_ID = 'sf-eject-ending';");
  const toast = html.slice(toastAt, toastAt + 3000);
  check('the toast looks the board up before its eject',
    toast.indexOf('const boardP = _sfBoardOfMount(t.mountPath);') > -1
    && toast.indexOf('const boardP = _sfBoardOfMount(t.mountPath);') < toast.indexOf('ejectMedia('));
  check('the toast restarts it after a fresh eject', /if \(onBoard\) setStatus\(await _sfRestartBoardAfterEject\(boardP\)\);/.test(toast));
  check("the toast retires links through its own variable (it named an unbound 'target')",
    toast.includes('_sfRetirePathLinks(t.mountPath);') && !toast.includes('_sfRetirePathLinks(target'));
  check('only a board card is restarted', /return !!\(d && d\.transport === 'proffieboard'\);/.test(html));
  check('ready is said only when the port opened again', /if \(st === 'restarted' && r\.ready\) return 'Board restarted and ready to use\.';/.test(html));
  check('back but not opening: restarted, without ready', /if \(st === 'restarted' && r\.back\) return 'Board restarted\.';/.test(html));
  check('the row says Ejected and restarting, with the dots, for a board card',
    /onBoard \? SF_BOARD_RESTARTING : 'Safe to remove\.'/.test(row) && row.includes("classList.toggle('busy-dots', onBoard)"));
  check('the toast says it too', /onBoard \? `\$\{SF_BOARD_RESTARTING\}\.\.\.` : 'Safe to remove\.'/.test(toast));
  check('a board card is never told Safe to remove', !/Safe to remove\. \$\{/.test(html) && !/'Safe to remove\. Board/.test(html));
  check('no personification left', !/saber can use its card/.test(html));

  console.log('3. the JMT Studio way: sd 1 from the app monitor');
  const se = require(path.join(ROOT, 'safeEject.js'));
  check('ejectVolume takes a shorter stay-gone watch', /stableMs = STABLE_MS/.test(fs.readFileSync(path.join(ROOT, 'safeEject.js'), 'utf8')));
  // the real wait, on a path that is never there
  const t0 = Date.now();
  const g0 = await se.waitForMediaGone(path.join(ROOT, 'no-such-volume-xyz'), 5000, 0);
  check('with stableMs 0, gone is reported on the first look', g0.gone && Date.now() - t0 < 200, JSON.stringify(g0));
  const t1 = Date.now();
  const g1 = await se.waitForMediaGone(path.join(ROOT, 'no-such-volume-xyz'), 5000);
  check('CONTROL the default still watches a second', g1.gone && Date.now() - t1 >= 1000, JSON.stringify(g1));
  check('media:eject only ever shortens it', /Math\.max\(0, Math\.min\(stableMs, se\.STABLE_MS\)\)/.test(main));
  // the monitor's watch for the board's answer, run on split chunks
  const watchAt = main.indexOf("let _sdTail = '';");
  check('the monitor watches for the board answer', watchAt > -1);
  const re = /SD Access (ON|OFF)(?![\s\S]*SD Access (?:ON|OFF))/;
  let tail = '', seen = null;
  for (const c of ['sd 1\nSD Acc', 'ess ON\n']) { tail = (tail + c).slice(-64); const m = tail.match(re); if (m) { seen = m[1]; tail = ''; } }
  check('an answer split across chunks is still seen', seen === 'ON');
  check('the last answer wins', ('SD Access ON\nSD Access OFF\n'.match(re) || [])[1] === 'OFF');
  check('both eject surfaces skip the watch only when shared in app',
    (html.match(/\.\.\.\(inApp \? \{ stableMs: 0 \} : \{\}\)/g) || []).length === 2);
  check('the board and its port are looked up before the eject', /boardPortForSerial\(d\.boardSerial/.test(html));
  check('preload exposes the share answer', /boardSdSharedInApp:/.test(pre));

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
