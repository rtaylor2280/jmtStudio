// A button that starts something cannot start it twice: jmtOneAtATime. [B-437]
//
//   1. The helper, run from the page: a second call while the first runs is ignored; it runs again
//      once the first ends; a throw still frees it; two wrapped actions do not block each other.
//   2. SD Export's button goes through it.
'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

(async () => {
  console.log('1. the helper');
  const at = html.indexOf('function jmtOneAtATime(fn) {');
  const src = at > -1 ? html.slice(at, html.indexOf('\n}\n', at) + 2) : '';
  check('the helper was located', src.length > 100, 're-anchor: an empty slice runs nothing');
  const once = new Function(`${src}; return jmtOneAtATime;`)();

  let calls = 0, release;
  const slow = once(async () => { calls++; await new Promise((r) => { release = r; }); return 'done'; });
  const first = slow();
  const second = await slow();
  check('a second press while the first runs is ignored', calls === 1 && second === undefined, JSON.stringify({ calls, second }));
  release();
  check('the first run finishes with its own result', (await first) === 'done');
  const again = slow();
  release();
  await again;
  check('once it ends, the button works again', calls === 2, String(calls));

  const boom = once(async () => { calls++; throw new Error('x'); });
  try { await boom(); } catch {}
  try { await boom(); } catch {}
  check('a run that throws still frees the button', calls === 4, String(calls));

  let a = 0, b = 0, relA;
  const fa = once(async () => { a++; await new Promise((r) => { relA = r; }); });
  const fb = once(async () => { b++; });
  const pa = fa();
  await fb();
  check('two wrapped actions do not block each other', a === 1 && b === 1);
  relA(); await pa;

  console.log('2. SD Export');
  check('its button runs the export through the helper',
    /const _sfBulkSaveOnce = jmtOneAtATime\(_sfBulkSave\);/.test(html)
    && /getElementById\('btn-sf-bulk-save'\)\?\.addEventListener\('click', async \(e\) => \{\s*e\.stopPropagation\(\);\s*await _sfBulkSaveOnce\(\);/.test(html));

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
