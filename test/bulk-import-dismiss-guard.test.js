/**
 * An import modal closes by its own button, and by nothing else  [B-396]
 *
 * ⭐ HIS, 2026-09-16, while dev-testing [B-296]: "clicking anywhere outside of this throws
 * away the entire analyze... pretty sure we block that in other such areas... not good..."
 *
 * ⚠️⚠️ THE COST IS NOT A DIALOG, IT IS THE ANALYZE. His 136-source folder was measured
 * mid-run at 8 sources in 1m 51s — about half an hour of work — and a click on the font
 * grid behind the modal discarded all of it, silently, with no undo. The same click on a
 * form loses a sentence.
 *
 * ⭐ THE CONVENTION IS HIS AND IT IS THE PROJECT DEFAULT, not a rule for this dialog:
 * "from a UI convention, the default is that modals can't be dismissed by clicking outside
 * them. we have several in app that are allowed and those are fine... but the entire import
 * process from first analyze to completion don't just get dismissed by clicking to the side
 * of it." Dismiss-on-backdrop is the EXCEPTION a modal has to earn.
 * And: "the other import flows already correctly follow this convention." Bulk import was
 * the one that never inherited it — the same shape as [B-394], where backup was the single
 * door B-364's impound work had not been walked through.
 *
 * ⚠️⚠️ TWO DESIGNS OF MINE DIED BEFORE THIS ONE, AND THAT IS THE LESSON WORTH KEEPING.
 * First I blocked only the "expensive" phases, leaving scan and summary dismissible on the
 * reasoning that a modal clinging when nothing is at stake is its own annoyance. He
 * corrected it: the flow is ONE process end to end, and a user does not check which phase
 * they are in before deciding where to click. Then I kept Esc as a "deliberate" exception —
 * also invented, and also wrong. Reading the sibling modal FIRST would have produced the
 * right answer in one step: `modal-sf-import` has no backdrop handler and no Esc handler at
 * all. The rule already existed twenty thousand lines away.
 *
 * Run: node test/bulk-import-dismiss-guard.test.js
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

// The bulk import IIFE, isolated so a match cannot come from another modal's handler.
const start = html.indexOf("modal:        document.getElementById('modal-sf-bulk-import')");
ok('found the bulk import module', start > 0);
const end = html.indexOf('window._sfBulkImportCost', start);
ok('found its end', end > start, 'the slice must not run into the next module');
const mod = html.slice(start, end > start ? end : start + 200000);

// ── nothing outside the dialog can close it ───────────────────────────────
{
  ok('⭐⭐ the modal has no backdrop click listener at all',
     !/els\.modal\?\.addEventListener\('click'/.test(mod),
     'this is the exact listener that cost him the analyze');
  ok('⭐⭐ and no Escape listener',
     !/e\.key !== 'Escape'/.test(mod) && !/e\.key === 'Escape'/.test(mod),
     'blocking the backdrop while Esc still discards is not a fix');
  ok('⚠️ no conditional dismiss survives in any form',
     !/_dismissBlocked|_escBlocked|COSTLY_PHASES|ESC_BLOCKED_PHASES/.test(mod),
     'both of my earlier designs were conditions — a condition here is one to get wrong later');
  ok('⚠️ and closeModal is not reachable from a stray event',
     !/addEventListener\([^)]*\)[^;]*closeModal\(\)/.test(mod),
     'the only callers must be the buttons');
}

// ── ⭐ but it is not a trap ────────────────────────────────────────────────
{
  ok('⭐ Cancel exists', /els\.cancelBtn/.test(mod),
     'if nothing closed it, blocking the backdrop would trap the user');
  ok('⭐ and closeModal is still wired to a button',
     /closeModal\(\)/.test(mod), 'there must be a deliberate way out');
  ok('⚠️ the analyze phase still names what cancelling costs [B-295]',
     /Nothing has been imported yet, so cancelling loses this whole pass/.test(mod),
     'the guard removes the accident, not the informed choice');
}

// ── ⚠️ the convention, asserted against the SIBLING rather than restated ──
//
// If the single-source import ever grows a backdrop-dismiss, this fails and someone has to
// decide deliberately which way the convention moved — instead of the two quietly drifting,
// which is how bulk import ended up the odd one out in the first place.
{
  const sibStart = html.indexOf("modal:       document.getElementById('modal-sf-import')");
  ok('found the single-source import module', sibStart > 0);
  const sib = html.slice(sibStart, sibStart + 120000);
  ok('⭐⭐ the sibling import modal also closes by button only',
     !/els\.modal\?\.addEventListener\('click'/.test(sib),
     'bulk import was aligned TO this — if it changed, the alignment is stale');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall import-modal dismiss tests passed');
process.exit(failures ? 1 : 0);
