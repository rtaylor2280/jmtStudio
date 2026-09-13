/**
 * One conflict review per export  [B-357]
 *
 * 2026-09-08, exporting a font + tracks + common to a destination with conflicts:
 * "two screens rather than one..." — first "The common folder at the destination is
 * different" (Skip/Replace), then "One track differs from your library" (Skip/Replace).
 * Same dialog skeleton twice in a row: same Set-all buttons, same Replace warning, same
 * radio rows. The font keep/replace screen is a third sibling on the same flow.
 *
 * ⭐ THE ASK: one combined review, sections per kind, under one Continue — the user's
 * decision context ("what am I overwriting at this destination") is ONE moment, not
 * three.
 *
 * ⚠️ THE CONSOLIDATION IS OF THE DIALOG, NOT THE SEMANTICS. The per-kind differences are
 * real and survive as section intros: a common folder replaces as a UNIT, tracks replace
 * per FILE and leave the rest alone.
 *
 * ⚠️⚠️ AND THE HAZARD THAT MADE THIS MORE THAN A LAYOUT CHANGE: the radio groups were
 * named `conflict-<name>`. A font and a track that happen to share a name would land in
 * the SAME group once merged, so answering one would silently un-answer the other.
 *
 * Run: node test/export-conflict-one-dialog.test.js
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

// ── the two dialogs became one ─────────────────────────────────────────────
{
  ok('the export opens a review for EITHER kind',
     /if \(conflicts\.length > 0 \|\| tracksDiffering\.length > 0\) \{/.test(html),
     'it used to open only for folder conflicts, then ask again for tracks');

  // The second dialog is gone from this flow.
  ok('the export no longer calls the tracks dialog separately',
     !/const chosenPromise = _sfResolveTrackConflicts\(tracksDiffering\);/.test(html),
     'that was the second screen');
  // ⚠️ But the helper itself still has another caller (the card-export flow), so it must
  // NOT have been deleted.
  ok('_sfResolveTrackConflicts still exists for its other caller',
     /const _sfResolveTrackConflicts = async/.test(html)
     && /await _sfResolveTrackConflicts\(plan\.differing\)/.test(html));

  ok('one cancel abandons the whole export',
     /if \(!choices\) return false; \/\/ user cancelled the whole export, both kinds/.test(html));
}

// ── sections, and only when they earn their place ──────────────────────────
{
  ok('sections appear only with more than one kind',
     /const _sectioned = conflicts\.length > 0 && tracksDiffering\.length > 0;/.test(html));
  ok('a single kind keeps the flat path untouched',
     /sections: !_sectioned \? undefined :/.test(html),
     'nothing changes for the common single-kind export');
  ok('headings are only rendered for a multi-section review',
     /const _multi = _sections\.length > 1;/.test(html)
     && /\$\{_multi && sec\.heading \?/.test(html));
}

// ── the semantics survive ──────────────────────────────────────────────────
{
  ok('folders keep the unit sentence',
     /intro: 'Each folder is treated as a unit, so old and new files are never mixed\.'/.test(html));
  ok('tracks keep the per-file sentence',
     /intro: 'Tracks are replaced one file at a time\. Anything else at the destination is left alone\.'/.test(html));
  // Each section carries its own default; a shared one would be a behaviour change.
  const secs = html.slice(html.indexOf("sections: !_sectioned ? undefined :"), html.indexOf("sections: !_sectioned ? undefined :") + 2400);
  ok('each section declares its own default',
     (secs.match(/defaultMode: 'replace',/g) || []).length === 2, secs.slice(0, 200));
  ok('the per-section default is honoured over the dialog-wide one',
     /sec\.defaultMode !== undefined \? sec\.defaultMode : opts\.defaultMode/.test(html));
}

// ── the collision the merge would otherwise create ─────────────────────────
{
  ok('radio names are section-scoped',
     /name="conflict-\$\{_sfEscape\(sec\.key\)\}-\$\{_sfEscape\(n\)\}"/.test(html),
     'a font and a track sharing a name would otherwise share a radio group');
  ok('and the reader matches the same scoped name',
     /input\[name="conflict-\$\{CSS\.escape\(sec\.key\)\}-\$\{CSS\.escape\(name\)\}"\]:checked/.test(html));
  ok('rows carry their section', /data-conflict-sec="\$\{_sfEscape\(sec\.key\)\}"/.test(html));
}

// ── the answers are read back per section ──────────────────────────────────
{
  ok('a sectioned review resolves one Map per section',
     /resolve\(Array\.isArray\(opts\.sections\) && opts\.sections\.length \? maps : maps\[0\]\)/.test(html),
     'and a flat review still resolves a bare Map, so existing callers read unchanged');
  ok('the export reads folders from section 0 and tracks from section 1',
     /modeByName = choices\[0\] \|\| new Map\(\);[\s\S]{0,200}?const _tMap = choices\[1\] \|\| new Map\(\);/.test(html));
}

// ── tracks-only still works ────────────────────────────────────────────────
{
  // ⚠️ The flat path is handed `conflicts`, which is EMPTY in a tracks-only export —
  // that would render an empty dialog and answer nothing.
  ok('tracks-only passes the track names to the flat path',
     /const _flatNames = conflicts\.length > 0 \? conflicts : tracksDiffering;/.test(html));
  ok('and keeps the track wording',
     /'One track differs from your library'/.test(html)
     && /tracks differ from your library/.test(html));
  ok('its answers are read as tracks',
     /tracksReplace = tracksDiffering\.filter\(n => \(choices\.get\(n\) \|\| 'replace'\) === 'replace'\)/.test(html));
}

// ── the section styling exists ─────────────────────────────────────────────
{
  ok('section headers have a rule', /\.sf-save-conflict-section-title \{/.test(html));
  ok('and their intros do too', /\.sf-save-conflict-section-intro \{/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall export conflict dialog tests passed');
process.exit(failures ? 1 : 0);
