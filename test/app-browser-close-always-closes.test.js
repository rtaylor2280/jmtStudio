// An app browser window always closes: a close that a hung page never lets finish destroys the window,
// and a window that closes normally is left alone. [QA12 L27: a video-heavy page hung the browser on the
// Yoga and its close button did nothing, which left Studio blocked behind it.]
'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const a = main.indexOf('function _keepWithStudio(bw) {');
const b = main.indexOf('\n_keepWithStudio.forceCloseMs', a);
const src = a > -1 && b > -1 ? main.slice(a, main.indexOf('\n', b + 1)) : '';
check('CONTROL lifted _keepWithStudio', src.includes('bw.destroy()') && src.includes('forceCloseMs'));

function fakeWindow({ hangs }) {
  const w = new EventEmitter();
  let destroyed = false;
  w.destroyed = 0;
  w.isDestroyed = () => destroyed;
  w.isVisible = () => true;
  w.setSkipTaskbar = () => {};
  w.close = () => {
    w.emit('close', { preventDefault() {} });
    if (!hangs) { destroyed = true; w.emit('closed'); }
  };
  w.destroy = () => { w.destroyed++; destroyed = true; w.emit('closed'); };
  return w;
}

(async () => {
  const studio = { enabled: [], isDestroyed: () => false, setEnabled(v) { this.enabled.push(v); }, focus() {} };
  const keep = new Function('win', '_keptBrowsers', 'process', `${src}\n_keepWithStudio.forceCloseMs = 30; return _keepWithStudio;`)(
    studio, [], { platform: 'win32' });

  console.log('1. a page that never lets the close finish');
  {
    const w = fakeWindow({ hangs: true });
    keep(w);
    w.close();
    await new Promise((r) => setTimeout(r, 80));
    check('the window is destroyed', w.destroyed === 1 && w.isDestroyed(), `destroyed=${w.destroyed}`);
    check('Studio is enabled again', studio.enabled[studio.enabled.length - 1] === true, JSON.stringify(studio.enabled));
  }

  console.log('2. a normal close');
  {
    const w = fakeWindow({ hangs: false });
    keep(w);
    w.close();
    await new Promise((r) => setTimeout(r, 80));
    check('it closes by itself and is not destroyed on top', w.destroyed === 0 && w.isDestroyed(), `destroyed=${w.destroyed}`);
  }

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
