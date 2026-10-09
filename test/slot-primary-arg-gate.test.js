/**
 * The primary colour slot belongs to BASE_COLOR_ARG or to nobody  [B-460]
 *
 * `registryArgs` is sorted by `pos`, and the slot editor took index 0 as "the base
 * colour" — true only when BASE_COLOR_ARG is actually in the set. A PARTIALLY argified
 * style (args, but no base arg) had its lowest-numbered arg promoted into the headline
 * position: ALT_COLOR_ARG (2), BLAST (9), CLASH (10), or OFF_COLOR_ARG (31) on the
 * ChassisAccentStrip. The collapsed tile meanwhile fell through to `_pickSlotPrimary`
 * and showed the style's hardcoded colour, so the two views reported different colours
 * for one slot with nothing to say which to believe.
 *
 * The diagnosis, and the reason the fix is a condition and not a feature: *"It was
 * args that had no right to the primary slot. Needed ladder. But instead something that
 * should have been in advanced took the lead."* The arg slot NUMBERS are fixed by
 * ProffieOS (`enum ArgumentName`, styles/edit_mode.h), so "no BASE_COLOR_ARG" is a fact
 * about the style rather than an inference.
 *
 * WHAT THIS FILE CANNOT CHECK, STATED SO A GREEN RUN IS NOT MISREAD. The logic
 * lives inline in a ~250-line DOM builder; there is no function to lift and run, so
 * every assertion below is STRUCTURAL. It can prove the guard exists and that the
 * Advanced button is reachable without a primary row. It cannot prove the panel renders
 * correctly — three changes once passed `node --check` and the whole suite and none of
 * them worked, because no check reached the screen. The dev test is the real check.
 *
 * The one property most worth pinning: the Advanced button must NOT sit inside the
 * primary-row branch. It used to, gated on `registryArgs.length > 1` — leave it there
 * and a partially argified style gets no primary row, so no button, so NO WAY TO REACH
 * ITS ARGS AT ALL. That regression would be invisible to every other test here.
 *
 * Run: node test/slot-primary-arg-gate.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── the guard exists and means what it says ────────────────────────────────
const gateIdx = html.indexOf('const _hasBaseArg');
ok('the base-arg gate exists', gateIdx > 0);

const gateSrc = html.slice(gateIdx, gateIdx + 200);
ok('the gate requires index 0 to BE BASE_COLOR_ARG',
   /registryArgs\[0\]\.name\s*===\s*'BASE_COLOR_ARG'/.test(gateSrc),
   gateSrc.split('\n').slice(0, 3).join('\n'));
ok('and it requires there to be an arg at all',
   /registryArgs\.length\s*>\s*0/.test(gateSrc), gateSrc.split('\n')[0]);

// ── the primary row is built only behind that gate ─────────────────────────
{
  const uses = [...html.matchAll(/makeArgRow\(registryArgs\[0\]/g)].map(m => m.index);
  ok('registryArgs[0] feeds exactly one primary row', uses.length === 1, `${uses.length} uses`);
  const before = html.slice(Math.max(0, uses[0] - 400), uses[0]);
  ok('and that row is built inside `if (_hasBaseArg)`',
     /if\s*\(_hasBaseArg\)\s*\{[^}]*$/.test(before),
     before.slice(-120));
}

// ── the Advanced rows start at 0 when there is no base arg ─────────────────
ok('the Advanced loop starts at 0 when no base arg, 1 when there is',
   /for\s*\(let i = _hasBaseArg \? 1 : 0;/.test(html),
   'otherwise index 0 is dropped from Advanced and becomes unreachable');

// ── the button must be reachable with no primary row ───────────────────
{
  const btnIdx   = html.indexOf("advBtn.textContent = 'Advanced ▾'");
  const primIdx  = html.indexOf('makeArgRow(registryArgs[0]');
  const hcIdx    = html.indexOf('body.appendChild(_hcRow);');
  ok('the Advanced button is still built', btnIdx > 0);
  ok('it is built AFTER the hardcoded-colour branch, not inside the primary one',
     btnIdx > hcIdx && hcIdx > primIdx,
     `primary@${primIdx} hardcoded@${hcIdx} button@${btnIdx} — inside the primary branch `
     + 'means a partially argified style can never open Advanced');

  const guard = html.slice(Math.max(0, btnIdx - 600), btnIdx);
  ok('and it is gated on the rows that exist, not on a registryArgs count',
     /_advRows\.length\s*>\s*0/.test(guard) && !/registryArgs\.length\s*>\s*1/.test(guard),
     guard.slice(-160));
}

// ── the expand strip uses the same gate ────────────────────────────────────
{
  const idx = html.indexOf('expand.appendChild(advContent)');
  ok('the advanced container is appended', idx > 0);
  const guard = html.slice(Math.max(0, idx - 200), idx);
  ok('gated on _advRows.length, matching the button',
     /_advRows\.length\s*>\s*0/.test(guard),
     guard.slice(-120));
  ok('and the old `registryArgs.length > 1` gate is gone from it',
     !/registryArgs\.length\s*>\s*1\s*\)\s*expand\.appendChild/.test(html));
}

// ── the ladder itself must be untouched ────────────────────────────────────
//
// The whole point of this fix is that it is a CONDITION, not a reordering. Rungs 6-8
// carry a comment recording that they used to sit at rung 4 and steal the answer, and
// [B-060] already unified two surfaces onto this ladder. If a later change "fixes" the
// disagreement by moving rungs instead, this is what should go red.
{
  // Bound the slice by the NEXT function, not by a guessed character count. The
  // first version used `+ 3000` and the function is 4259 chars, so rungs 4-8 fell
  // outside the window and the test reported them "missing" — a truncated search
  // producing a confident negative, which is the exact failure this suite exists for.
  const l = html.indexOf('function _pickSlotPrimary');
  const end = html.indexOf('function _resolveSlotColor', l);
  ok('the ladder slice is bounded by the next function, not a guessed length', end > l);
  const body = html.slice(l, end);
  const order = ['base-arg', 'colorarg-csv', 'base-registry', 'base-inline',
                 'helper-hardcoded', 'expr-hardcoded', 'first-arg', 'first-registry', 'first-inline'];
  const found = order.map(s => body.indexOf(`'${s}'`));
  ok('the ladder rungs are still in their recorded order',
     found.every(i => i > 0) && found.every((v, i, a) => i === 0 || a[i - 1] < v),
     JSON.stringify(order.filter((s, i) => found[i] < 0)) + ' missing, or out of order');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall slot primary-arg gate tests passed');
process.exit(failures ? 1 : 0);
