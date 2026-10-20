// Every export door ends in exactly one surface, and the eject reports inline on that surface.
//
// A door ends in either a summary modal or a toast, never both, and whichever it is carries the
// eject. The runner draws a toast ending unless the door says its caller draws a summary, so the
// pair of facts - the ending shape and `summaryHasEject` - has to agree. When they disagree the
// export ends twice: a toast from the funnel and a summary from the caller, each offering to
// eject, and the second eject arrives to find the volume already released.
//
// That is what happened on 2026-10-06 to the source export door, which drew a summary and never
// told the runner. The existing contract guard did not see it because that guard only inspects
// doors declaring `ending: 'summary'`, and this one left `ending` at its default. The ending and
// the flag disagreed and nothing compared them.
//
// Counts are pinned so a NEW door has to be classified rather than inheriting a default. If one
// moves, name the door that changed before changing the number.

'use strict';
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}
const lineOf = (i) => code.slice(0, i).split('\n').length;

// ── The doors ────────────────────────────────────────────────────────────────
// Each `_sfRunExport({...})` is one export door. Its config decides the ending.
const doors = [...code.matchAll(/_sfRunExport\(\{/g)].map((m) => {
  const seg = code.slice(m.index, m.index + 2600);
  const title = (seg.match(/title:\s*([^,\r\n]+)/) || [])[1] || '(untitled)';
  return {
    line: lineOf(m.index),
    title: title.trim(),
    // `ending` is read off the config, so a door that never mentions it takes the toast default.
    declaresEndingNone: /ending:\s*blockedDelete\s*\?\s*'none'/.test(seg) || /ending:\s*'none'/.test(seg),
    declaresSummaryEnding: /ending:\s*'summary'/.test(seg),
    summaryHasEject: /summaryHasEject:\s*true/.test(seg),
  };
});

// 9 -> 8 on 2026-10-19 [B-493]: the common-as-zip door was removed, not re-shaped. A common
// folder now exports its SOURCE through the same door the font side uses, which is already in
// this register. Every remaining door's ending declaration is unchanged.
const EXPECTED_DOORS = 8;
ok(`there are ${EXPECTED_DOORS} export doors`, doors.length === EXPECTED_DOORS,
   `found ${doors.length}. A new door must declare its ending and whether its caller draws a `
   + 'summary, or it silently inherits the toast default and can end twice.');

// ── The invariant ────────────────────────────────────────────────────────────
// A door either lets the runner draw the toast ending, or declares that its caller draws a
// summary. The doors that genuinely end in a toast are the two file-selection funnel calls, and
// they are identified by their TITLE rather than their position.
//
// This was a pair of line numbers with a tolerance until 2026-10-06, and it broke the first
// time an unrelated edit was made higher in the file - a fixed-position anchor over
// renderer/index.html has silently stopped covering its target before, which is why
// test/export-runner-ratchet.test.js carries the same warning. A title moves with its door.
const TOAST_ENDING_TITLES = ["'Exporting files'"];

for (const d of doors) {
  const isToastDoor = TOAST_ENDING_TITLES.includes(d.title);
  if (isToastDoor) {
    ok(`line ${d.line} ${d.title} ends in a toast and lets the funnel draw it`,
       !d.summaryHasEject,
       'declaring summaryHasEject here would suppress the only ending this door has');
  } else {
    ok(`line ${d.line} ${d.title} declares that a summary carries its eject`,
       d.summaryHasEject,
       'without this the funnel adds a toast on top of the summary, so the export ends twice '
       + 'and two surfaces each offer to eject');
  }
}

// ── The gate the invariant depends on ────────────────────────────────────────
ok('the funnel raises its toast only when no summary carries the eject',
   /if\s*\(destDir\s*&&\s*!summaryHasEject\)/.test(code),
   'this condition is what makes summaryHasEject mean anything');
ok('and the runner passes the flag through from the door',
   /summaryHasEject:\s*door\.summaryHasEject === true/.test(code),
   'the door declares it; the runner must hand it to the ending');

// ── One eject surface per ending ─────────────────────────────────────────────
// The row is the summary's inline control; the toast carries the eject as its action. Counts are
// pinned because a new call site is a new eject surface, which is the defect class above.
const rowSites = [...code.matchAll(/_sfWireEjectRow\(\{/g)].filter((m) => {
  // The export of the helper onto `window` is a declaration, not a surface.
  const before = code.slice(Math.max(0, m.index - 10), m.index);
  return !/window\.\s*$/.test(before);
});
const toastSites = [...code.matchAll(/_sfOfferEjectInToast\(/g)];

ok('eject rows: 5 surfaces plus 2 window exports', rowSites.length === 5,
   `found ${rowSites.length} at lines ${rowSites.map((m) => lineOf(m.index)).join(', ')}`);
// 14 -> 13 on 2026-10-07 [B-424]: Common Folders + Import dropped its completion toast, because a
// unit door's one ending is a completion summary and the eject rides that inline. The count is
// asserted rather than derived on purpose - a surface appearing or vanishing should fail here.
// 13 -> 12 on 2026-10-07: a comment at the Import Backup door quoted the removed call
// verbatim, and THIS test does not strip comments, so the quoted text was being counted as a
// surface. The comment was rewritten to state the absence in prose instead (soul's rule: a
// comment explains why the code is as it is, not what used to be there).
// NOTE THE INCONSISTENCY WITH ITS SIBLING: import-doors-register.test.js strips comments
// before counting and says so; this one counts raw. Either is defensible, but a quoted call
// is indistinguishable from a live one here, so a comment can move this number.
// 12 -> 13 on 2026-10-09: the Style Library Export door gained one. It had been discarding
// `styles:export`'s result entirely, so a failed export and a successful one both ended in
// silence; the fix reports the error and ends through the helper, which carries Eject on a
// removable destination and Show otherwise. A door GAINING an ending, not a new surface class.
// 13 -> 14 on 2026-10-09: the Shared Tracks "+ Add -> Browse..." door gained a SECOND ending.
// When a dialog is shown the eject now rides that dialog and no toast is raised; the one case
// that still toasts is the REFUSAL dialog, which composes and awaits its own promptConfirm and
// so has no handle to wire a row against. That branch is the new call site. A door gaining a
// branch, not a new surface class.
ok('eject toasts: 14 surfaces', toastSites.length === 14,
   `found ${toastSites.length} at lines ${toastSites.map((m) => lineOf(m.index)).join(', ')}`);

// ── The eject reports inline, never as a second surface ──────────────────────
// Windows raises its own notification when a volume is released, so the app states the status on
// the surface the door already ended in rather than adding another toast about it.
{
  const i = code.indexOf('const _sfOfferEjectInToast');
  const j = code.indexOf('const _sfPlaceEjectRowInButtons');
  const body = (i >= 0 && j > i) ? code.slice(i, j) : '';
  ok('the toast helper was located', body.length > 400, `${body.length} chars`);
  ok('its eject outcomes update the ending toast in place',
     /const setStatus\s*=\s*\(status\)\s*=>\s*showToast\(/.test(body),
     'a new showToast per outcome would be a second ending surface');
  ok('and the outcomes do not raise bare toasts of their own',
     (body.match(/showToast\(/g) || []).length <= 3,
     'expected: the no-eject-target fallback, the setStatus helper, and the ending itself');
  ok('the action keeps its toast open so the status can replace it',
     /keepOpen:\s*true/.test(body),
     'dismissing on click would leave nowhere to report the result inline');
  ok('busy remains the one modal exception',
     /promptConfirm\(\{[\s\S]{0,400}?Could not eject/.test(body),
     'a "do not unplug it" that scrolls away fails exactly when it matters');
}

console.log('');
console.log(fail === 0
  ? `export-endings-register: all ${pass} checks passed`
  : `export-endings-register: ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
