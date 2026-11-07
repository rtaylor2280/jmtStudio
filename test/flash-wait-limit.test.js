'use strict';
// Runs the port watch from buildPanel.js with a hand-driven clock.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'buildPanel.js'), 'utf8');
const start = src.indexOf('let _portWatchInterval = null;');
const end = src.indexOf('async function handlePortWatchResult', start);
if (start < 0 || end < start) { console.error('port watch not found'); process.exit(1); }

let failed = 0;
const ok = (name, got, want) => {
  const pass = got === want;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  <- ${got}`}`);
  if (!pass) failed++;
};

const make = () => {
  const timers = new Map();
  let id = 0, now = 0;
  const els = {};
  const env = {
    now: () => now,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout: t => timers.delete(t),
    setInterval: () => ++id,
    clearInterval: () => {},
    document: { getElementById: k => (els[k] = els[k] || { style: {}, textContent: '' }) },
    setBuildTitle: t => { env.title = t; },
    setBarMode: () => {},
    setFlashEnabled: v => { env.flash = v; },
    isDfuMode: false, dfuDeviceReady: false, selectedPort: 'COM9',
  };
  const api = new Function('env', `
    const { setTimeout, clearTimeout, setInterval, clearInterval, document, setBuildTitle, setBarMode, setFlashEnabled } = env;
    let isDfuMode = env.isDfuMode, dfuDeviceReady = env.dfuDeviceReady, selectedPort = env.selectedPort;
    ${src.slice(start, end)}
    return { startPortWatch, stopPortWatch, FLASH_WAIT_MS, context: () => _portWatchContext };
  `)(env);
  env.advance = ms => {
    now += ms;
    for (const [k, t] of [...timers]) if (t.at <= now) { timers.delete(k); t.fn(); }
  };
  return { api, env, els, timers };
};

let t = make();
ok('the limit is two minutes', t.api.FLASH_WAIT_MS, 120000);
t.api.startPortWatch('wait-flash');
t.env.advance(119999);
ok('still waiting just before it', t.api.context(), 'wait-flash');
t.env.advance(1);
ok('the wait ends at the limit', t.api.context(), null);
ok('and says what a compile only says', t.els['bm-status'].textContent, 'Compiled, not flashed. Flash it from the toolbar whenever you are ready.');
ok('Close stays offered', t.els['bm-close'].style.display, 'inline-block');
ok('Flash stays usable', t.env.flash, true);

t = make();
t.api.startPortWatch('wait-flash');
t.api.stopPortWatch();
t.env.advance(200000);
ok('a stopped wait does not fire later', t.els['bm-status'], undefined);

t = make();
t.api.startPortWatch('wait-flash');
t.env.advance(60000);
t.api.startPortWatch('wait-flash');
t.env.advance(60000);
ok('a second start does not extend it', t.api.context(), null);

t = make();
t.api.startPortWatch('other');
t.env.advance(200000);
ok('other watches have no limit', t.api.context(), 'other');

console.log(failed ? `\n${failed} failure(s)` : '\nall flash wait tests passed');
process.exit(failed ? 1 : 0);
