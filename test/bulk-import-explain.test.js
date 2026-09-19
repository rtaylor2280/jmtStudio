// [B-292] Bulk import explains itself BEFORE it opens a folder picker.
// [B-294] And offers to carry on without you, because the wait is long.
//
// ⭐ THE ORIGIN, and it is the whole case: he wrote the feature and, opening it months later,
// asked "what is bulk import? not remembering." The link went STRAIGHT to the OS folder picker,
// so every capability was invisible until after he had committed to a folder — and so was the
// cost. Measured the same day on his own originals: 136 fonts at ~7.3s each, review screen
// reached at ~18 MINUTES, all of it beginning the moment he clicked OK on a dialog that had told
// him nothing.
'use strict';

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + String(detail).slice(0, 300) : ''));
}

// ── the link no longer opens the picker ────────────────────────────────────
{
  ok('the bulk entry point opens the explain screen, not the picker',
     /window\._sfStartBulkImport = showExplain;/.test(html),
     'if this is back to startScan, the picker is being sprung again');

  // ⚠️ The explain screen's button is what calls the picker. Asserted so a future refactor cannot
  // quietly leave the screen with no way forward.
  ok('the explain screen has a forward action that runs the picker',
     /explainPickBtn\.addEventListener\('click', \(\) => \{ startScan\(\); \}\)/.test(html));
}

// ── the screen carries what the entry was actually about ───────────────────
{
  const fn = html.slice(html.indexOf('const showExplain = () => {'),
                        html.indexOf('const showExplain = () => {') + 2600);

  ok('it states the steps as a sequence', /sf-bulk-explain-steps/.test(html)
     && /map\(t => `<li>/.test(fn));

  // ⭐⭐ THE COST IS THE HALF THAT COST HIM AN AFTERNOON. A screen that teaches what the feature
  // is while still ambushing him with how long it takes has fixed the smaller problem.
  ok('it states the COST before the picker opens',
     /7 seconds per font/.test(fn) && /minutes/.test(fn), fn.slice(fn.indexOf('cost'), 400));

  // ⚠️ A RATE, NOT A PROMISE. Their folder is not his folder. A flat "this takes 18 minutes"
  // would be a number we cannot stand behind on someone else's disk.
  ok('the cost is expressed as a rate, not a fixed total',
     /roughly 7 seconds per font/.test(fn) && !/will take \d+ minutes/.test(fn));

  ok('it says the library is not touched until they agree',
     /nothing is added to your library until you say so/.test(fn));
}

// ── [B-294] auto-continue, and the cases it must NOT swallow ───────────────
{
  ok('the checkbox exists on the explain screen', /id="sf-bulk-explain-auto"/.test(html));

  ok('its value is captured when the picker is launched',
     /_bulkAutoContinue = !!\(els\.explainAuto && els\.explainAuto\.checked\);/.test(html));

  // ⚠️⚠️ THE GUARD IS THE POINT. The user agreed to skip the REVIEW, not to have failures
  // swallowed. Auto-continuing past a disabled Import gate would be the checkbox making a
  // decision that was never delegated to it.
  ok('it refuses to auto-continue when the Import gate is disabled',
     /if \(_bulkAutoContinue && els\.startBtn && !els\.startBtn\.disabled\)/.test(html),
     'without the disabled check, a plan with nothing importable would auto-run');

  ok('it is consumed once and does not persist',
     /_bulkAutoContinue = false;\s*\/\/ one run only/.test(html));

  // A module flag, not a stored setting: "walk away from THIS import" is about one folder and one
  // evening, not a standing choice about how the app behaves.
  ok('it is not written to settings', !/setSetting\([^)]*[Aa]utoContinue/.test(html));
}

// ── the SD pointer: a pointer, not a warning ───────────────────────────────
{
  ok('the card view points at bulk import when originals exist',
     /id="sd-act-bulk-instead"/.test(html));

  // ⚠️ Slice from the DECLARATION, not from the first mention of the name — indexOf('_srcNote')
  // lands mid-statement and everything before it falls outside the window. Third anchoring slip of
  // the day; the pattern is always the same, an anchor that is not where I pictured it.
  const noteAt = html.indexOf('const _srcNote = canFonts');
  const note = html.slice(noteAt, noteAt + 900);
  ok('it is conditional on there being fonts to import', noteAt > 0, 'declaration not found');

  // ⭐ It must read as "there is a better road if you have it", never "you did the wrong thing".
  // The card path is legitimate and is often the only one left.
  // ⚠️ Match a fragment that is NOT split across concatenated literals. The sentence is built
  // as 'If you still have the ' + 'original downloads, ...' so the full phrase never appears
  // contiguously in source — asserting on it failed against copy that reads correctly on screen.
  ok('it explains the trade rather than scolding',
     /If you still have the /.test(note) && /you keep the full originals/.test(note)
       && !/should have/i.test(note), note);

  ok('the note is styled muted, not as a warning',
     /\.sd-rpt-src-note \{[^}]*--c-text-muted/.test(html));
}

console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
