// The Style Library builds at idle after startup, so its first visit isn't an empty editor. [B-595]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };

const run = (opts = {}) => {
  const log = { inits: 0, timers: 0 };
  const view = { dataset: { ...(opts.dataset || {}) } };
  const tab = opts.noTab ? null : { style: { display: opts.tabDisplay || '' } };
  const win = { monaco: opts.noMonaco ? undefined : {}, initStylesPanel: () => { log.inits++; } };
  const idle = [];
  const f = new Function('window', 'document', 'requestIdleCallback', 'setTimeout', `let _stylesPreloadScheduled = false;\n${fn('_scheduleStylesPreload')}\nreturn _scheduleStylesPreload;`)(
    win, { getElementById: () => view, querySelector: () => tab }, (cb) => idle.push(cb), () => { log.timers++; });
  f(); f();
  idle.forEach(cb => cb());
  return { ...log, view, idleCount: idle.length };
};

let r = run();
check('built once, at idle, however many times it is asked', r.inits === 1 && r.idleCount === 1, JSON.stringify(r));
check('marked so the first visit rebuilds the cards', r.view.dataset.loaded === '1' && r.view.dataset.preloaded === '1');
check('already visited: left alone', run({ dataset: { loaded: '1' } }).inits === 0);
check('no library, tab hidden: not built', run({ tabDisplay: 'none' }).inits === 0);
r = run({ noMonaco: true });
check('editor not loaded yet: waits for it', r.inits === 0 && r.timers === 1, JSON.stringify(r));
check('runs when the splash ends, and on the safety timeout', /onSplashDismissed\?\.\(\(\) => \{ hide\(\); _scheduleStylesPreload\(\); \}\);/.test(html)
  && /setTimeout\(\(\) => \{ hide\(\); _scheduleStylesPreload\(\); \}, 6000\);/.test(html));
check('the first real visit rebuilds, once, for the in-use marks', /if \(stylesView\.dataset\.preloaded\) \{\s*delete stylesView\.dataset\.preloaded;\s*if \(_stylesViewMode === 'visual'\) _buildStylesVisual\(\);/.test(html));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
