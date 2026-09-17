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

// ── ⚠⚠ THE CAUTION IS PER KIND, because the two kinds overwrite different amounts ──
//
// ⭐ HIS, on the dev test 2026-09-17, looking at the tracks-only dialog: the amber line said
// "Replace overwrites the whole FOLDER at the destination" two paragraphs under a body saying
// tracks are replaced one file at a time and anything else is left alone. Both on one screen;
// only one true of the rows underneath.
//
// ⚠ IT PREDATES THIS ENTRY — the card/SD track flow calls the same modal and has shown the
// folder wording over track lists all along. What the sectioned dialog changed is that it became
// unfixable in place: one sentence cannot be right for two semantics at once.
{
  ok('⭐⭐ there are two caution texts, not one',
     /_CAUTION_FOLDERS\s+= /.test(html) && /_CAUTION_TRACKS\s+= /.test(html));
  ok('⚠️ the folder one still names the FOLDER as the blast radius',
     /_CAUTION_FOLDERS\s+= 'Replace overwrites the whole folder/.test(html));
  ok('⚠⚠ and the track one does NOT claim a folder is overwritten',
     /_CAUTION_TRACKS\s+= 'Replace overwrites these files[^']*'/.test(html)
     && !/_CAUTION_TRACKS\s+= '[^']*whole folder/.test(html),
     'this is the sentence he caught');
  // ⚠ REWRITTEN 2026-09-17 on his read. "back it up first" was advice the reader cannot
  // take — the dialog is modal, so backing anything up means cancelling, and the sentence
  // named an action they could not perform while not naming the button that would let them.
  // The consequence is now stated in the word people actually fear.
  ok('⭐ both still name the CONSEQUENCE, not just the mechanism',
     /_CAUTION_FOLDERS\s+= '[^']*is lost\./.test(html)
     && /_CAUTION_TRACKS\s+= '[^']*is lost\./.test(html),
     'overwrites-the-folder describes what the code does; lost is what happens to them');
  ok('⚠️ and neither repeats what the intro above it already says',
     !/_CAUTION_TRACKS\s+= '[^']*left alone/.test(html),
     'the tracks intro, the body and the caution all said it — one fact, three times, one screen');

  ok('each section carries its own caution',
     /caution: _CAUTION_FOLDERS,/.test(html) && /caution: _CAUTION_TRACKS,/.test(html));
  ok('⚠️ the LEGACY tracks-only caller got it too',
     /defaultMode: 'replace',[\s\S]{0,400}?caution: _CAUTION_TRACKS,/.test(html),
     'the card/SD export calls this modal and had the same contradiction');
  ok('the flat path takes its caution from the CALLER',
     /cautionEl\.textContent = opts\.caution \|\| _CAUTION_FOLDERS/.test(html),
     'defaulting to the folder text keeps every pre-existing caller unchanged');

  // ⭐⭐ SHOW/HIDE IS PER SECTION TOO. Setting the folders to Skip must take the folder
  // warning away even while every track is still Replace — a warning that outlives the choice
  // it described is how a real one stops being read.
  ok('⭐⭐ the sectioned dialog hides the flat caution entirely',
     /if \(_multi\) \{[\s\S]{0,200}?cautionEl\.style\.display = 'none';/.test(html));
  ok('⭐⭐ and shows each section caution only when THAT section has a replace',
     /data-caution-sec/.test(html)
     && /getAttribute\('data-conflict-sec'\) === k/.test(html),
     'a dialog-wide check would leave the folder warning up over an all-Skip folder list');
  ok('the per-section caution has a style rule',
     /\.sf-save-conflict-section-caution \{/.test(html));
}

// ── ⭐⭐ EVERY PER-KIND STRING BRANCHES TOGETHER, OR THE SCREEN CONTRADICTS ITSELF ──
//
// ⚠⚠ CAUGHT BY HIM ON THE 2026-09-17 DEV TEST, from two screenshots side by side: the same
// title, "2 tracks differ from your library", with two DIFFERENT warnings underneath. One door
// had the track wording and the other still claimed a whole folder would be overwritten.
// Cause: `title` and `description` both had a `_tracksOnly` arm and `caution` had none, so it
// fell through to the folder default. Three strings describe the kind; two of three were wired.
//
// ⭐ Same shape as [B-314]'s quick-import miss the night before, and [B-296]'s before that: a
// per-kind behaviour added to some of its call sites. The assertion is therefore structural -
// count the arms, do not eyeball the wording.
{
  const call = html.slice(html.indexOf('const choicesPromise = _sfPromptSaveConflicts('),
                          html.indexOf('const choicesPromise = _sfPromptSaveConflicts(') + 3000);
  // ⚠️ `\s*` because one of the three wraps its `?` onto the next line. A regex that
  // assumes formatting counts two arms out of three and reports the bug as still present.
  const arms = (call.match(/_tracksOnly\s*\?/g) || []).length;
  ok('⭐⭐ title, description AND caution each have a tracks-only arm', arms === 3,
     `found ${arms} of 3 — a per-kind string with no arm silently shows the folder default`);
  ok('⚠️ and the caution arm is one of them',
     /caution: _tracksOnly \? _CAUTION_TRACKS : _CAUTION_FOLDERS,/.test(call),
     'this is the line his screenshots caught missing');
}

// ── ⚠ THE TITLE NAMES WHAT THE COMPARISON IS AGAINST ──────────────────
//
// His: "is this clear that it's different content but same name?" The body said so; the TITLE
// said only "are different" — a comparative with no referent, read first, above a row that is
// just a name and two radio buttons. ⭐ Tracks had always named it ("differ from your library")
// and folders never had, and the sectioned dialog is where both appear at once.
{
  ok('⭐ the folders title names the library',
     /_cTitle = `\$\{_subject\} at the destination \$\{_isPlural \? 'differ' : 'differs'\} from your library`/.test(html));
  ok('⭐ the sectioned title does too, and carries a COUNT like every single-kind title',
     /\$\{conflicts\.length \+ tracksDiffering\.length\} things at the destination differ from your library/.test(html),
     '"Some" was the only headline in this dialog that did not say how many');
  ok('⚠️ and no title still says only "are different"',
     !/at the destination \$\{_isPlural \? 'are' : 'is'\} different/.test(html)
     && !/'Some things at the destination are different'/.test(html));
  ok('tracks keep the wording they always had',
     /tracks differ from your library/.test(html));
}

// ── ⭐ TITLE STATES THE SITUATION, BODY STATES THE DECISION ────────────
//
// His, 2026-09-17: "the title and the line under it seem repetative. and isn't it just about an
// export conflict and they have to make a decision?" Every variant opened by saying they differ
// and then immediately said it again in other words.
{
  ok('⭐⭐ the sectioned body says only what to DO',
     /_sectioned\s*\?\s*'Choose whether to replace each with your library version, or keep what is there\.'/.test(html));
  ok('⚠️ and no body restates "exist there with different contents"',
     !/'These already exist there with different contents/.test(html)
     && !/'These tracks exist at the destination with different contents/.test(html)
     && !/already \$\{_isPlural \? 'exist' : 'exists'\} there with different contents/.test(html),
     'that clause was the restatement in all three variants');
  ok('⭐ the facts that are NOT in the title survive',
     /Each folder is treated as a unit, so old and new files are never mixed/.test(html)
     && /Anything else at the destination is left alone/.test(html)
     && /fonts that already match/.test(html),
     'cutting the repetition must not cut the things the title never said');
}

// ── ⭐⭐ THE REVIEW IS IN FRONT OF THE SCAN, NOT BEHIND IT ────────────
//
// ⚠⚠ HIS, 2026-09-17, with a screenshot: "the dialog opened before the scan finished." It had
// — it opened UNDERNEATH. Both surfaces are plain .modal-overlay at z-index 10000, so DOM order
// decided, and #modal-sf-bulk-progress is declared LATER in the document. A finished
// "Checking the destination" bar sat on top of the decision it had just produced.
//
// ⭐ THE OVERLAP IS DELIBERATE AND MUST STAY. Closing the scan before the next surface opens
// leaves a frame with no backdrop, which reads as a full-screen flash (found 2026-07-31). The
// design is open-next-then-close-previous; it just requires the next one to be in FRONT.
{
  ok('⭐⭐ the conflict review is stacked above the progress overlay',
     /#modal-sf-save-conflict \{ z-index: 10010; \}/.test(html),
     'equal z-index meant DOM order won, and the progress overlay is declared later');
  ok('⚠️ and still below the confirm modal',
     /#modal-confirm \{ z-index: 10015; \}/.test(html),
     'a confirm summoned from inside the review has to clear it');

  ok('⭐⭐ the scan closes SYNCHRONOUSLY, before the review opens',
     /_sfDeleteProgress\.hideNow\(\);/.test(html)
     && html.indexOf('_sfDeleteProgress.hideNow();') < html.indexOf('const choicesPromise = _sfPromptSaveConflicts('),
     'scan then dialog — his order, and the one the first comment always stated');
  ok('⚠️ hideNow takes no minimum display time',
     /hideNow\(\) \{[\s\S]{0,40}?this\.modal\(\)\?\.classList\.remove\('active'\);/.test(html),
     'the 200ms floor is what held a finished bar over the question that replaced it');
  ok('⚠️ the floor still exists for every other caller',
     /async hide\(minMs = 200\)/.test(html),
     'it earns its place where nothing follows the overlay');

  // ⚠⚠ ONE FRAME IS THE WHOLE POINT. An await between the close and the open yields to the
  // event loop, the browser paints the gap, and the backdrop-less flash comes back.
  ok('⭐⭐ nothing awaits between the close and the open',
     !/hideNow\(\);[\s\S]{0,900}?await[\s\S]{0,60}?_sfPromptSaveConflicts/.test(html),
     'they have to land in the same synchronous block or one of the two constraints breaks');
  ok('⚠️ and the scan is no longer hidden AFTER the review opens',
     !/await _sfDeleteProgress\.hide\(0?\);[\s\S]{0,60}?const choices = await choicesPromise;/.test(html),
     'that ordering is what put a progress bar on top of a decision');

  // Defence in depth: if they ever do coexist, the decision must be the one in front.
  ok('the review still outranks the progress overlay in z-index',
     /#modal-sf-save-conflict \{ z-index: 10010; \}/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall export conflict dialog tests passed');
process.exit(failures ? 1 : 0);
