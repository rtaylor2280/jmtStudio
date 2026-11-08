// Cancelling the skip/replace question must close the compare's progress window. [B-637]
//
// The folder-export compare opens its byte-progress window with keepOpen, so the next step can
// reuse it. On Cancel the runner returned without closing it, which left "Checking the
// destination" on screen with a frozen clock and no way out but a force quit.
//
// Run: node test/compare-cancel-closes-progress.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const start = html.indexOf('decisions = await door.compare(plan, destDir, _check);');
const end = html.indexOf('out.decisions = decisions;', start);
const slice = start > 0 && end > start ? html.slice(start, end) : '';

ok('the runner\'s compare step was found', slice.length > 0 && slice.length < 1500,
  `start=${start} end=${end} length=${slice.length}`);

const nullAt = slice.indexOf('if (decisions === null)');
ok('it has a cancel branch', nullAt >= 0);
const branch = nullAt >= 0 ? slice.slice(nullAt, slice.indexOf('return out;', nullAt) + 11) : '';
ok('the cancel branch returns', /return out;$/.test(branch), JSON.stringify(branch));
ok('and closes the progress window before it does', /_sfDeleteProgress\.hide\(\)/.test(branch),
  JSON.stringify(branch));

// The door's compare does return null on Cancel, which is the path this guards.
ok('control: the folder-export compare returns null when the question is cancelled',
  /if \(_picked === null\) return null;/.test(html));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
