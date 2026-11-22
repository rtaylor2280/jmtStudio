// THE EJECT CHECKBOX PRESSES A BUTTON. IT NEVER RUNS ITS OWN EJECT.
//
// THE RULE, settled 2026-10-06 and the reason this file exists: the eject checkbox never runs
// its own eject. It only auto-clicks a button.
//
// WHY A TEST AND NOT A SWEEP. The rule spans call sites, and the defect it guards was
// invisible from the outside: `_sfOfferEjectInToast` had `if (_auto) { await run(); return; }`,
// which ejected directly with no button and no on-screen state, while the eject ROW twenty lines
// away did it correctly. Both read the same checkbox. Nothing about either one looks wrong on its
// own - the bug is only visible when you ask whether they agree.
//
// AND THE EVIDENCE WAS ONE WORD ON SCREEN. Exporting a source to a card with the box ticked,
// the summary's Eject read "Already removed." - a status only reachable when the button runs and
// finds the volume already gone. A second path never announces itself; the only trace it leaves
// is the FIRST path arriving to find its work done.

'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'renderer', 'index.html');
const code = fs.readFileSync(file, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}

// ── 1. ONLY TWO PLACES MAY PERFORM AN EJECT ──────────────────────────────────
// A THIRD IS THE FINDING, not a number to update. Both of these sit inside a button's click
// handler; a new one almost certainly does not, which is exactly the shape being banned.
//   · `_sfOfferEjectInToast` -> run()  - reached only by the toast's own action button
//   · `_sfWireEjectRow`      -> the eject row's button click handler
const sites = [...code.matchAll(/electronAPI\.ejectMedia\s*\(/g)];
ok('exactly two call sites perform an eject', sites.length === 2,
   `found ${sites.length}. A new one must press a button, not be called from a checkbox. `
   + 'If it is legitimate, say which button reaches it and then move this number.');

// ── 2. EVERY AUTO BRANCH MUST PRESS A BUTTON ─────────────────────────────────
// The automatic case is the manual case. An `auto` branch is allowed to click; it is not allowed
// to eject, and it is not allowed to call the runner that ejects.
//
// COMMENT-ONLY LINES ARE BLANKED FIRST, AND THE FIRST RUN OF THIS FILE PROVED WHY. The fix
// for the defect documents the defect, quoting `if (_auto) { await run(); return; }` verbatim so
// the next reader knows what was banned - and the scan matched THAT, then found `await run()` in
// the surrounding prose and failed the real code for its own explanation.
// A source scanner that cannot tell code from commentary reports a file as broken precisely
// when it is well documented. Lines are blanked rather than removed so the reported line numbers
// still point at the real file.
const scan = code.split('\n')
  .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
  .join('\n');

const autoBranches = [...scan.matchAll(/if\s*\(\s*_?auto\s*\)/g)];
ok('the auto branches were located', autoBranches.length >= 2,
   `found ${autoBranches.length} - if this drops, the slicing below is measuring nothing`);

for (const m of autoBranches) {
  const start = m.index;
  const region = scan.slice(start, start + 600);
  const line = scan.slice(0, start).split('\n').length;
  ok(`auto branch at line ${line} presses a button`, /\.click\s*\(\s*\)/.test(region),
     region.split('\n').slice(0, 6).join('\n       '));
  ok(`auto branch at line ${line} does NOT eject directly`,
     !/electronAPI\.ejectMedia\s*\(/.test(region),
     'an auto branch that ejects is the banned second path');
  // THE EXACT SHAPE THAT SHIPPED. `run()` is the toast helper's private eject; calling it from
  // an auto branch is the original defect, and it would pass the two checks above if the region
  // happened to contain an unrelated .click().
  ok(`auto branch at line ${line} does NOT call the private eject runner`,
     !/\bawait\s+run\s*\(\s*\)/.test(region),
     'if (_auto) { await run(); } is the defect this file exists to prevent');
}

// ── 3. THE ROW'S OWN CONTRACT, which was always right and must stay that way ──
ok('the eject row still presses its button on auto',
   /if\s*\(\s*auto\s*\)\s*btn\.click\s*\(\s*\)/.test(code),
   'the row is the reference implementation of the rule');

// ── 4. THE TOAST PATH RENDERS ITS BUTTON BEFORE PRESSING IT ──────────────────
// Without the toast there is no button, so "click a button" would be unsatisfiable and the
// temptation is to fall back to the direct call. The fix renders either way.
const toastFn = code.slice(code.indexOf('const _sfOfferEjectInToast'),
                           code.indexOf('const _sfPlaceEjectRowInButtons'));
ok('the toast helper was sliced', toastFn.length > 400, `${toastFn.length} chars`);
ok('the toast is shown before the auto click',
   toastFn.indexOf('showToast(`${lead}') >= 0
   && toastFn.indexOf('showToast(`${lead}') < toastFn.lastIndexOf('.click()'),
   'the automatic case must show the same sentence and control as the manual one');
ok('showToast hands back the element so its button can be pressed',
   /\n  return t;\n\}/.test(code) || /return t;\s*\n\}\s*\nwindow\.showToast/.test(code),
   'without a handle on the toast there is nothing to click');

// ── 5. THE TEST PROVES ITSELF ────────────────────────────────────────────────
// A guard whose failure case is unreachable is decoration. This reintroduces the exact defect
// into a copy of the source and requires the checks above to reject it.
{
  // Swap the button press for the direct call - the exact edit that would recreate the defect.
  const BANNED = 'if (_btn) _btn.click();';
  const mutated = scan.replace(BANNED, 'await run();');
  ok('the mutation applied', mutated !== scan,
     `anchor "${BANNED}" not found - the control below would prove nothing`);
  if (mutated !== scan) {
    let caught = false;
    for (const m of [...mutated.matchAll(/if\s*\(\s*_?auto\s*\)/g)]) {
      const region = mutated.slice(m.index, m.index + 600);
      if (/\bawait\s+run\s*\(\s*\)/.test(region) || !/\.click\s*\(\s*\)/.test(region)) caught = true;
    }
    ok('the old defect is REJECTED when reintroduced', caught,
       'the checks above would have passed the shipped bug');
  }
}

// ── 4. EVERY EJECT ROW MUST BE TOLD WHETHER THE BOX WAS TICKED ───────────────
// THE DEFECT THIS GUARDS, found in testing on the Common Folders door 2026-10-07: the door
// called `offerEject()` on the progress modal, so the checkbox DREW and could be TICKED, and
// then wired its summary row with no `auto` at all. The box did nothing. The button worked, so
// the door looked fine to anyone who pressed the button.
//
// `_sfEjectContext` already answers this - it returns `ejectAuto`, which is `wantsEject()`
// read off that same box - so the fix at every site is to pass the field that was already
// computed. The bug is purely one of omission, which is why a scan catches it and a reading
// does not: nothing at the call site looks wrong, there is simply one argument missing.
//
// `auto: false` IS A PASS. The card report has no checkbox and says so in a comment; what is
// banned is leaving the parameter OUT, because that is indistinguishable from forgetting. An
// explicit false is a decision; absence is an oversight.
{
  const calls = [...scan.matchAll(/_sfWireEjectRow\s*\(\s*\{/g)];
  ok('the eject-row call sites were located', calls.length >= 8,
     `found ${calls.length} - if this drops, the loop below is measuring nothing`);

  for (const m of calls) {
    // Walk to the matching close brace so a call spanning several lines is read whole and a
    // neighbouring call's `auto:` can never be credited to this one.
    let i = scan.indexOf('{', m.index), depth = 0, end = i;
    for (; end < scan.length; end++) {
      if (scan[end] === '{') depth++;
      else if (scan[end] === '}') { depth--; if (depth === 0) break; }
    }
    const args = scan.slice(i, end + 1);
    const line = scan.slice(0, m.index).split('\n').length;
    ok(`eject row at line ${line} is told whether the box was ticked`,
       /\bauto\b\s*[:,}]/.test(args),
       `no "auto:" in this call - a ticked checkbox would do nothing here.\n       ${args.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}

// THE CONTROL FOR SECTION 4. Drop the argument from a real call and the scan must notice; a
// check that cannot fail is a check that is not running. (`eject-offer-armed-for-every-plan`
// learned this the same way.)
{
  const anchor = 'auto: _cmnEjCtx.ejectAuto';
  const mutated = scan.replace(anchor, 'onEjected: null');
  ok('the section 4 mutation applied', mutated !== scan,
     `anchor "${anchor}" not found - the control below would prove nothing`);
  if (mutated !== scan) {
    let caught = false;
    for (const m of [...mutated.matchAll(/_sfWireEjectRow\s*\(\s*\{/g)]) {
      let i = mutated.indexOf('{', m.index), depth = 0, end = i;
      for (; end < mutated.length; end++) {
        if (mutated[end] === '{') depth++;
        else if (mutated[end] === '}') { depth--; if (depth === 0) break; }
      }
      if (!/\bauto\b\s*[:,}]/.test(mutated.slice(i, end + 1))) caught = true;
    }
    ok('a door that forgets `auto` is REJECTED', caught,
       'section 4 would have passed the Common Folders bug');
  }
}

console.log('');
console.log(fail === 0
  ? `eject-auto-clicks-button: all ${pass} checks passed`
  : `eject-auto-clicks-button: ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
