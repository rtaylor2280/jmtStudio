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
  // ⚠️⚠️ COMMENTS STRIPPED FIRST, AND THIS IS THE FOURTH TIME TODAY THE SAME TRAP HAS BITTEN.
  // Every one was a window that contained PROSE ABOUT the code as well as the code: an ordering
  // check that matched 'offsetInCode' inside its own explanatory comment, and a no-number check
  // that matched '7 seconds per font' inside the comment explaining why the number was removed.
  // A test asserting on source has to look at source only.
  // ⚠️⚠️ BOUNDED BY THE NEXT DECLARATION, NOT BY A CHARACTER COUNT. A fixed +N window silently
  // truncates the moment the function grows, and every assertion past the cut then fails against
  // correct code. That happened here the same evening: comments pushed the cost line out of a
  // 3400-char slice and four assertions went red at once. A window that can rot is a test that
  // will lie later.
  const _start = html.indexOf('const showExplain = () => {');
  const _end   = html.indexOf('const startScan = async () => {', _start);
  const _raw = html.slice(_start, _end > _start ? _end : _start + 6000);
  const fn = _raw.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
  // ⭐⭐ THE COPY, RECONSTRUCTED AS THE USER WILL SEE IT. Long sentences are built by concatenating
  // string literals, so a phrase that reads contiguously ON SCREEN is split by ' + ' IN SOURCE and
  // never matches. That bit twice tonight — once on the SD pointer, once on the savings thesis —
  // so collapse the joins ONCE here and assert against this rather than against `fn`.
  // ⚠️ Six anchoring slips today, every one the same root: asserting about WORDS while looking at
  // something that is not the words. This is the fix for the class, not for the instance.
  const copy = fn.replace(/'\s*\+\s*'/g, '');

  ok('it states the steps as a sequence', /sf-bulk-explain-steps/.test(html)
     && /map\(t => `<li>/.test(fn));

  // ⭐⭐ THE COST IS THE HALF THAT COST HIM AN AFTERNOON. A screen that teaches what the feature
  // is while still ambushing him with how long it takes has fixed the smaller problem.
  ok('it warns that this is a long operation, before the picker opens',
     /can take a while/i.test(copy), fn.slice(fn.indexOf('cost'), 400));

  // ⚠️⚠️ AND IT MUST NOT CARRY A FIGURE. This assertion is INVERTED from its first version, which
  // required 'roughly 7 seconds per font'. His call 2026-09-19: "a bit nervous about being so
  // specific in the estimate... could be different on different devices." A per-font rate is
  // device-dependent exactly as a total is - slow disk, network drive, busy machine - so it was
  // the same false precision one step removed. Any number here is a promise about hardware we
  // have never seen.
  ok('it states NO per-font rate and NO minute figure',
     !/\d+\s*seconds? per font/i.test(fn) && !/\d+\s*minutes?/i.test(fn),
     fn.slice(fn.indexOf('cost'), 400));

  // ⭐⭐ THE SAVINGS THESIS, verbatim from local/ui-conventions.md (value-prop session 2026-09-07).
  // The standing goal is teaching people it is OK to KEEP EVERYTHING - the more they keep, the
  // more sharing there is to find - and a screen asking for a folder of original downloads is the
  // exact moment that worry lands.
  ok('it carries the keep-everything thesis line',
     /Keep everything: JMT Studio saves the space and your files stay exactly as they came/.test(copy)
     // ⚠️ FULL BRANDING. His ruling 2026-09-19: the bare "Studio" was inconsistent with
     // the savings sentence elsewhere, which already says "JMT Studio saved you X".
     && !/(?<!JMT )Studio saves/.test(copy));

  // ⚠️ NO COINED TERM. That session ruled against an Apple-style 'Optimized Storage' noun: the
  // branding is one sentence SHAPE repeated wherever savings appear.
  ok('it coins no storage-brand noun',
     !/Optimi[sz]ed Storage|Smart Storage|Space Saver/i.test(fn));

  // ⚠️ "cost" is BANNED in savings copy - it conflates money with storage for an audience
  // that pays money for fonts.
  // ⚠️⚠️ TESTED AGAINST THE COPY STRINGS ONLY, not the function body. The element id is
  // sf-bulk-explain-cost and the local is `cost`, so scanning the source would fail forever on
  // code that is perfectly correct. FIFTH anchoring slip of the day, same root every time:
  // asserting about WORDS while looking at something that is not only words.
  const _copy = (fn.match(/'[^']*'/g) || []).join(' ');
  ok('it never says "cost" about storage', !/costs?/i.test(_copy), _copy.slice(0, 200));

  // ⭐ And it names the ideal input, not just the accepted one. His call 2026-09-19.
  ok('it names the original zips as ideal',
     /original zip files as you downloaded them from the creator are ideal/i.test(copy));

  // ⚠️ Register: an app dialog, not a chat. 'until you say so' was his catch the same night.
  ok('it uses app register, not casual', !/say so/i.test(copy));

  // ⭐⭐ INVERTED, and this one is about TRUTH rather than taste. The screen used to promise
  // "nothing is added to your library until you confirm". With the auto-continue checkbox ticked
  // there IS no confirm step, so the very next screen would contradict it. His call: "might not be
  // true and could probably just be dropped honestly. less is more."
  // A reassurance that is only sometimes true is worse than none - it spends trust on a promise
  // the app will visibly break.
  ok('it makes no confirm-before-import promise it cannot keep',
     !/until you confirm/i.test(copy) && !/nothing is added/i.test(copy));
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

// ── [B-294] the MID-FLIGHT half, which is the one he actually asked for ────
{
  // ⭐ His words, 29 minutes into importing 136 fonts: "almost need a checkbox during the analyze
  // to go straight to quick import on completion." Offering it in both places is not redundancy —
  // some people know up front they will not review 136 fonts, and some only decide to walk away
  // after watching the clock. The explain-screen copy cannot serve the second person, because by
  // then that screen is gone.
  ok('the analyze phase carries its own checkbox', /id="sf-bulk-prog-auto"/.test(html));

  ok('it is shown when analyze starts',
     /if \(els\.progAutoWrap\) els\.progAutoWrap\.style\.display = '';/.test(html));

  // ⚠️ Seeded from the explain screen, so a box already ticked stays ticked. Resetting it would
  // silently undo a decision the user already made one screen earlier.
  ok('it is seeded from the up-front choice',
     /if \(els\.progAuto\) els\.progAuto\.checked = !!_bulkAutoContinue;/.test(html));

  // ⚠️⚠️ AND IT MUST DISAPPEAR ONCE THE IMPORT IS RUNNING. At that point there is no review left
  // to skip, so the offer would describe a choice that no longer exists.
  const runAt = html.indexOf('runInFlight = true;');
  const runWin = html.slice(runAt, runAt + 500);
  ok('it is hidden once the real import starts',
     /els\.progAutoWrap\.style\.display = 'none';/.test(runWin), runWin);

  // Live, because the entire point is deciding PARTWAY THROUGH.
  ok('ticking it mid-analyze updates the flag immediately',
     /els\.progAuto\.addEventListener\('change'/.test(html));
}

// ── the SD pointer: a pointer, not a warning ───────────────────────────────
{
  ok('the card view points at bulk import when originals exist',
     /id="sd-act-bulk-instead"/.test(html));

  // ⚠️ Slice from the DECLARATION, not from the first mention of the name — indexOf('_srcNote')
  // lands mid-statement and everything before it falls outside the window. Third anchoring slip of
  // the day; the pattern is always the same, an anchor that is not where I pictured it.
  const noteAt = html.indexOf('const _srcNote = canFonts');
  // ⚠️ Comments stripped and joins collapsed, same as the explain screen above. Asserting on
  // copy means looking at copy, not at a window that also contains prose about the copy.
  const _noteRaw = html.slice(noteAt, noteAt + 1600);
  const note = _noteRaw.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n')
                       .replace(/'\s*\+\s*'/g, '');
  ok('it is conditional on there being fonts to import', noteAt > 0, 'declaration not found');

  // ⭐ It must read as "there is a better road if you have it", never "you did the wrong thing".
  // The card path is legitimate and is often the only one left.
  // ⚠️ Match a fragment that is NOT split across concatenated literals. The sentence is built
  // as 'If you still have the ' + 'original downloads, ...' so the full phrase never appears
  // contiguously in source — asserting on it failed against copy that reads correctly on screen.
  // ⭐ HIS WORDING 2026-09-19: the originals get a USE, not a vague future export. The extras
  // are what a customized version is built from, and a card copy does not carry them.
  ok('it explains the trade rather than scolding',
     /if you have the original downloads/i.test(note)
       && /extras to create customized versions/i.test(note)
       && !/should have/i.test(note), note);

  // ⚠️ "sit" was wrong for files - his catch. The scene-setting sentence is gone entirely and
  // the actionable half leads.
  ok('it does not say the files "sit" on the card', !/as they sit on the card/i.test(note));

  ok('the note is styled muted, not as a warning',
     /\.sd-rpt-src-note \{[^}]*--c-text-muted/.test(html));
}

console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
