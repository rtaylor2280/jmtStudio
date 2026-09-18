/**
 * Keeping your fonts must not cancel the track merge  [B-409]
 *
 * ⭐ HIS, 2026-09-17, found while testing [B-407]: he deleted one shared track, added it to a
 * font, merged the backup, and set the single font conflict to "Keep yours". Result:
 * "Nothing to merge", and the track was never restored. 53 tracks where the backup had 54.
 *
 * ⚠️⚠️ A DECISION ABOUT A FONT CANCELLED WORK ON TRACKS. Tracks are never a conflict — the
 * merge dialog says so itself: "Shared tracks merge silently: any tracks from the backup that
 * you don't already have are added." So no choice the user makes covers them, and counting only
 * the buckets that CAN conflict makes them invisible.
 *
 * ⭐⭐ THE SHAPE WORTH REMEMBERING: the same question is asked twice in this flow — once before
 * the user chooses, once after — and only the first copy accounted for tracks. `allIdentical`
 * includes `stDelta`; `totalActions` did not. Two implementations of one question is how they
 * drift, and the second one is the one nobody re-reads.
 *
 * Run: node test/merge-tracks-not-skipped.test.js
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

// The after-your-choices gate, sliced to itself rather than a char window.
const gate = (() => {
  const i = html.indexOf('const totalActions =');
  if (i < 0) return '';
  const j = html.indexOf('await _sfRunMergeApply(zipPath, plan, survey);', i);
  return j < 0 ? '' : html.slice(i, j);
})();

ok('the post-choice gate was found', gate.length > 0);

// ── the fix ────────────────────────────────────────────────────────────────
{
  ok('⭐⭐ the gate accounts for pending shared tracks',
     /const stPending = !!\(survey && survey\.sharedTracks/.test(gate),
     'without this, "Keep yours" on a font returns before the track merge ever runs');
  ok('⭐⭐ and it is part of the bail condition, not merely computed',
     /if \(totalActions === 0 && !stPending\)/.test(gate),
     'computing a value and not testing it is the vacuous version of this fix');
}

// ── one notion of "tracks need attention", not two ─────────────────────────
{
  // ⚠️ The upfront check had this right all along. Both must compare the same two numbers; a
  // second, subtly different rule here is exactly how the original divergence happened.
  const cmp = /survey\.sharedTracks\.backup !== survey\.sharedTracks\.current/g;
  const uses = (html.match(cmp) || []).length;
  ok('⚠️ the upfront check still uses the same comparison',
     /const stDelta = \(survey\.sharedTracks && \(survey\.sharedTracks\.backup !== survey\.sharedTracks\.current\)\)/.test(html));
  ok('⚠️⚠️ both gates compare the SAME two numbers', uses >= 2,
     `found ${uses} use(s) — the upfront check and the post-choice check must agree, or the two `
     + 'answers to one question drift again');
}

// ── the promise the dialog makes must stay true ────────────────────────────
{
  ok('the dialog still promises tracks merge silently',
     /[Ss]hared tracks merge silently/.test(html),
     'if that sentence is ever removed, this test is asserting a promise nobody makes');
}

// ── and the fonts half is untouched ────────────────────────────────────────
{
  ok('⚠️ keeping every font still counts as no font work',
     /Object\.values\(plan\.library\)\.filter\(isActionable\)\.length/.test(gate));
  ok('⚠️ and the message still names the choice the user actually made',
     /You set every conflicting item to Keep yours/.test(html),
     'that wording is only correct when tracks genuinely had nothing to do either');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall merge track-skip tests passed');
process.exit(failures ? 1 : 0);
