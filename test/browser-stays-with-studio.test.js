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
const bw = { setSkipTaskbar: (v) => log.push(`skip:${v}`), on: (ev, fn) => { handlers[ev] = fn; }, isVisible: () => true };
const win = { isDestroyed: () => false, focus: () => log.push('studio-focus'), setEnabled: (v) => log.push(`studio-enabled:${v}`) };
new Function('win', `${src}; return _keepWithStudio;`)(win)(bw);
check('no taskbar button of its own', log.includes('skip:true'), log.join(' '));
check('Studio takes no clicks while the browser shows', log.includes('studio-enabled:false'), log.join(' '));
log.length = 0; handlers.hide();
check('hidden: Studio works again', log.join(' ') === 'studio-enabled:true', log.join(' '));
log.length = 0; handlers.show();
check('shown again: Studio blocked again', log.join(' ') === 'studio-enabled:false', log.join(' '));
log.length = 0; handlers.close();
check('closing it enables Studio, THEN focuses it (a disabled window cannot take focus)',
  log.join(' ') === 'studio-enabled:true studio-focus', log.join(' '));
log.length = 0; handlers.closed();
check('and once more when the window is gone, so Studio can never stay disabled', log.join(' ') === 'studio-enabled:true', log.join(' '));
const hidden = []; const hb = { setSkipTaskbar() {}, on() {}, isVisible: () => false };
new Function('win', `${src}; return _keepWithStudio;`)({ isDestroyed: () => false, focus() {}, setEnabled: (v) => hidden.push(v) })(hb);
check('a browser created hidden (Import from link\'s quiet download) does not block Studio', hidden.length === 0, JSON.stringify(hidden));

const opened = (main.match(/new BrowserWindow\(\{\s*parent: win,/g) || []).length;
const kept = (main.match(/_keepWithStudio\(bw\);/g) || []).length;
check('every browser window opened over Studio goes through it', opened === 2 && kept === 2, `${opened} opened, ${kept} kept`);

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
