// A successful flash must not print a red error, and a real driver failure must still shout. [B-467]
//
// "Cannot open DFU device 0483:df11" appeared in RED directly above "--- Flash successful ---" on
// every successful flash, because one string carries two opposite meanings depending on when it
// lands. The fix is a discriminator that was already in the stream, so the risk is not that the
// annotation is wrong - it is that the annotation gets applied too widely and swallows the real
// driver-binding failure, which is the loud case the whole line exists for.
//
// This file replays captured dfu-util output through the SAME ordering the stream handler uses
// (flag set on the line that sets it, then classify the next line), against the REAL predicates
// lifted out of toolchain.js. Nothing is retyped here: `toolchain.js` cannot be required in a
// test because it pulls in electron, and the sibling `flash-error.test.js` solves that by
// mirroring the function bodies - which is a second copy that can drift from the first without
// anything going red. Lifting keeps one copy.
//
// Run: node test/dfu-leave-expected.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const T = fs.readFileSync(path.join(__dirname, '..', 'toolchain.js'), 'utf8');

// ── lift the real predicates out of toolchain.js ────────────────────────────
function lift(decl) {
  const s = T.indexOf(decl);
  if (s < 0) throw new Error(`not found in toolchain.js: ${decl}`);
  let depth = 0, j = T.indexOf('{', s);
  for (; j < T.length; j++) {
    const c = T[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return T.slice(s, j);
}
function liftConst(name) {
  const m = new RegExp(`const ${name}\\s*=\\s*(/.*?/[gimsuy]*)\\s*;`).exec(T);
  if (!m) throw new Error(`not found in toolchain.js: const ${name}`);
  return `const ${name} = ${m[1]};`;
}

const parts = [
  liftConst('DFU_DOWNLOAD_DONE'),
  liftConst('DFU_LEFT_MODE'),
  lift('function _isDfuProgressLine'),
  lift('function _looksLikeFlashError'),
  lift('function _isDfuDownloadDone'),
  lift('function _classifyDfuStderrLine'),
];
ok('all four predicates and both patterns were lifted from source',
   parts.every(p => p && p.length > 10), parts.map(p => (p || '').length).join(', '));

// eslint-disable-next-line no-new-func
const { classify, downloadDone } = new Function(
  `${parts.join('\n')}
   return { classify: _classifyDfuStderrLine, downloadDone: _isDfuDownloadDone };`
)();

// ── replay a log the way the stream handler does ────────────────────────────
// Mirrors runDfuFlash: each line sets the flag if it is the done line, then is classified
// against the flag as it stands. Returns one row per line.
function replay(lines) {
  let done = false;
  return lines.map(line => {
    if (downloadDone(line)) done = true;
    const c = classify(line, done);
    return { line, text: c.text, isError: c.isError };
  });
}
const find = (rows, rx) => rows.find(r => rx.test(r.line));

// His log, 2026-10-05, verbatim and in order. The run exits 0 and the flash is good.
const SUCCESS = [
  'Download\t[=========================] 100%       427488 bytes',
  'Download done.',
  'File downloaded successfully',
  'Transitioning to dfuMANIFEST state',
  'Cannot open DFU device 0483:df11',
];

// ── the reported defect ─────────────────────────────────────────────────────
{
  const rows = replay(SUCCESS);
  const r = find(rows, /Cannot open DFU device/);
  ok('a cannot-open AFTER the download is not an error', r && r.isError === false,
     'this is the red line printed above "--- Flash successful ---"');
  ok('and it says why it is expected', r && /expected/.test(r.text), r && r.text);
  ok('nothing else in a successful run is flagged',
     rows.every(x => x.isError === false),
     rows.filter(x => x.isError).map(x => x.line).join(' | '));
}

// ── the control: the loud case must stay loud ───────────────────────────────
// Without this the check above passes just as happily for a rule that silences the line always,
// which would hide the driver-binding failure that 39 forum topics are about.
{
  const rows = replay(['Cannot open DFU device 0483:df11']);
  ok('CONTROL: a cannot-open with NO download before it is still an error',
     rows[0].isError === true,
     'the driver-binding failure would be silenced - the opposite of the fix');
  ok('and it is not annotated as expected', !/expected/.test(rows[0].text), rows[0].text);
}
{
  // Ordering, not just presence: the same line before the done line stays red in a run that
  // later succeeds. A flag set at the top of the run instead of at the line would pass the
  // case above and fail this one.
  const rows = replay([
    'Cannot open DFU device 0483:df11',
    'Download done.',
    'Cannot open DFU device 0483:df11',
  ]);
  ok('CONTROL: position decides, not the presence of a done line anywhere in the run',
     rows[0].isError === true && rows[2].isError === false,
     `first: ${rows[0].isError}, last: ${rows[2].isError}`);
}
{
  const rows = replay(['Download done.', 'Cannot open DFU device 04f2:b6cb']);
  ok('CONTROL: another device\'s cannot-open is not excused by our leave flag',
     rows[1].isError === true, rows[1].text);
}
{
  // The failure mode the classifier was built for in the first place, and it must survive this.
  const rows = replay([
    'Download\t[==   ]  14%      30720 bytes',
    'dfuse_download: libusb_control_transfer returned -1',
    'Download done.',
  ]);
  ok('CONTROL: a libusb drop is still an error', find(rows, /libusb_control/).isError === true);
  ok('CONTROL: a progress line is still never an error', rows[0].isError === false);
}

console.log(failed ? `\n${failed} FAILED` : '\ndfu-leave-expected: all passing');
process.exit(failed ? 1 : 0);
