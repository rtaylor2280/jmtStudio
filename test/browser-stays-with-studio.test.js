// The app's browser windows cannot be brought forward apart from Studio: no taskbar button of their own,
// and closing one gives Studio the focus. [B-566]
'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

const at = main.indexOf('function _keepWithStudio(bw) {');
const src = at > -1 ? main.slice(at, main.indexOf('\n}\n', at) + 2) : '';
check('the helper was located', src.length > 80, 're-anchor: an empty slice runs nothing');
const log = [];
const handlers = {};
const bw = { setSkipTaskbar: (v) => log.push(`skip:${v}`), on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); }, isVisible: () => true,
  isDestroyed: () => true, destroy() {} };
const fireW = (ev) => (handlers[ev] || []).forEach(fn => fn());
const win = { isDestroyed: () => false, focus: () => log.push('studio-focus'), setEnabled: (v) => log.push(`studio-enabled:${v}`) };
const WINDOWS = { platform: 'win32' }, MAC = { platform: 'darwin' };
const load = (w, proc) => new Function('win', 'process', '_keptBrowsers', `${src}; return _keepWithStudio;`)(w, proc, []);
load(win, WINDOWS)(bw);
check('no taskbar button of its own', log.includes('skip:true'), log.join(' '));
check('Studio takes no clicks while the browser shows', log.includes('studio-enabled:false'), log.join(' '));
log.length = 0; fireW('hide');
check('hidden: Studio works again', log.join(' ') === 'studio-enabled:true', log.join(' '));
log.length = 0; fireW('show');
check('shown again: Studio blocked again', log.join(' ') === 'studio-enabled:false', log.join(' '));
log.length = 0; fireW('close');
check('closing it enables Studio, THEN focuses it (a disabled window cannot take focus)',
  log.join(' ') === 'studio-enabled:true studio-focus', log.join(' '));
log.length = 0; fireW('closed');
check('and once more when the window is gone, so Studio can never stay disabled', log.join(' ') === 'studio-enabled:true', log.join(' '));
const hidden = []; const hb = { setSkipTaskbar() {}, on() {}, isVisible: () => false };
load({ isDestroyed: () => false, focus() {}, setEnabled: (v) => hidden.push(v) }, WINDOWS)(hb);
check('a browser created hidden (Import from link\'s quiet download) does not block Studio', hidden.length === 0, JSON.stringify(hidden));

// macOS: setEnabled(false) is a translucent sheet over Studio that stacks above the browser, which then took
// no clicks or keys. [QA09 M24] There Studio's page blocks itself instead.
{
  const mlog = []; const mh = {};
  const mbw = { setSkipTaskbar() {}, on: (ev, fn) => { (mh[ev] = mh[ev] || []).push(fn); }, isVisible: () => true };
  const mwin = { isDestroyed: () => false, focus: () => mlog.push('studio-focus'), setEnabled: (v) => mlog.push(`studio-enabled:${v}`),
    webContents: { send: (ch, p) => mlog.push(`${ch}:${p && p.locked}`) } };
  load(mwin, MAC)(mbw);
  const fire = (ev) => (mh[ev] || []).forEach(fn => fn());
  check('Mac: Studio is never disabled (that is the sheet)', !mlog.some(x => x.startsWith('studio-enabled')), mlog.join(' '));
  check('Mac: showing the browser locks Studio\'s page', mlog.join(' ') === 'appBrowser:lock:true', mlog.join(' '));
  mlog.length = 0; fire('hide');
  check('Mac: hidden, the page unlocks', mlog.join(' ') === 'appBrowser:lock:false', mlog.join(' '));
  mlog.length = 0; fire('close');
  check('Mac: closing unlocks, then focuses Studio', mlog.join(' ') === 'appBrowser:lock:false studio-focus', mlog.join(' '));
}
// Linux: with Studio's window disabled the browser took keys but no mouse input, and its X did nothing. [QA15]
{
  const llog = []; const lh = {};
  const lbw = { setSkipTaskbar() {}, on: (ev, fn) => { (lh[ev] = lh[ev] || []).push(fn); }, isVisible: () => true };
  const lwin = { isDestroyed: () => false, focus: () => llog.push('studio-focus'), setEnabled: (v) => llog.push(`studio-enabled:${v}`),
    webContents: { send: (ch, p) => llog.push(`${ch}:${p && p.locked}`) } };
  load(lwin, { platform: 'linux' })(lbw);
  const fire = (ev) => (lh[ev] || []).forEach(fn => fn());
  check('Linux: Studio is never disabled', !llog.some(x => x.startsWith('studio-enabled')), llog.join(' '));
  check('Linux: showing the browser locks Studio\'s page', llog.join(' ') === 'appBrowser:lock:true', llog.join(' '));
  llog.length = 0; fire('close');
  check('Linux: closing unlocks, then focuses Studio', llog.join(' ') === 'appBrowser:lock:false studio-focus', llog.join(' '));
}
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const lk = html.indexOf('onAppBrowserLock?.(');
const lock = lk > 0 ? html.slice(lk, html.indexOf('\n}\n', lk)) : '';
check('the page\'s lock covers it, brings the browser forward on a click, and stops keys',
  /z-index:2147483647/.test(lock) && /appBrowserFront\(\)/.test(lock) && /addEventListener\('keydown', _lockKeys, true\)/.test(lock)
  && /removeEventListener\('keydown', _lockKeys, true\)/.test(lock) && /_lockLayer\.remove\(\)/.test(lock), lock.slice(0, 120));
const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
check('the preload carries the lock and the bring-forward',
  /ipcRenderer\.on\('appBrowser:lock'/.test(pre) && /ipcRenderer\.send\('appBrowser:front'\)/.test(pre)
  && /ipcMain\.on\('appBrowser:front'/.test(main));

const opened = (main.match(/new BrowserWindow\(\{\s*parent: win,/g) || []).length;
const kept = (main.match(/_keepWithStudio\(bw\);/g) || []).length;
check('every browser window opened over Studio goes through it', opened === 2 && kept === 2, `${opened} opened, ${kept} kept`);

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
