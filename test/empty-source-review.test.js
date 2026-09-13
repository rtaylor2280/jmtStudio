/**
 * An archive with no sound font in it is not "ready to import"  [B-296]
 *
 * 2026-09-02, on a 136-font bulk import. The review screen said "136 new sound fonts
 * ready to import." He clicked Import. FORTY-SEVEN MINUTES LATER the summary read
 * "135 sources imported (191 fonts), 1 failed - tr.zip - No fonts found in source."
 *
 * ⚠️ THE REFUSAL IS CORRECT AND IS NOT WHAT THIS IS ABOUT. tr.zip holds tr/tr00.wav ..
 * tr16.wav — 17 short effect wavs — plus a readme. No hum, no swing, no Proffie shape.
 * Nothing should have imported it.
 *
 * ⭐ IT IS ABOUT WHEN THE ANSWER ARRIVES. "This archive contains no sound font" is
 * knowable during ANALYZE — the enrich pass already opens each source and lists it, and
 * a source with ZERO candidates is exactly the thing detection just failed to find. So
 * the number on the review screen was wrong in a way the user paid for at the far end
 * of a 47-minute import instead of at the moment they were deciding.
 *
 * ⚠️ AND THE COUNT MUST DISTINGUISH "asked, none" FROM "could not ask". Reporting "no
 * fonts in it" because OUR read failed is a false accusation about the user's archive —
 * the wolf-cry version of the check.
 *
 * Run: node test/empty-source-review.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const bulk = fs.readFileSync(path.join(ROOT, 'soundFontBulkImport.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── the analyze answers the question ───────────────────────────────────────
{
  const enrich = bulk.slice(bulk.indexOf('async function enrichSourceForGuided'),
                            bulk.indexOf('async function enrichSourceForGuided') + 3000);
  ok('the enrich result carries a font count', /fontCount: null,/.test(enrich),
     'null is the default, so "not asked" is the starting state');
  ok('it is answered during the enrich pass', /detectCandidates\(source\)/.test(enrich));

  // ⭐ THE SAME detector the COMMIT uses, not a second "does this look like a font"
  // rule. Two definitions would drift and the review would start disagreeing with the
  // import it is previewing.
  ok('it reuses the commit-time detector',
     /soundFontCandidates\.detectCandidates/.test(enrich)
     && /soundFontCandidates\.detectCandidates/.test(bulk.slice(bulk.indexOf('No fonts found in source') - 2000,
                                                               bulk.indexOf('No fonts found in source'))),
     'the review must preview the same decision the import will make');

  ok('alternate versions are filtered the same way the commit filters them',
     /filter\(c => !c\.alternateVersion\)\.length/.test(enrich),
     'a source holding only an older V1 would otherwise read as importable and then refuse');

  ok('a detection failure leaves it NULL, not zero',
     /catch \{ out\.fontCount = null; \}/.test(enrich),
     '"asked, none" and "could not ask" must not collapse into one answer');
}

// ── the review screen uses it ──────────────────────────────────────────────
{
  ok('the empty set is computed once, hoisted',
     (html.match(/const _emptySources = /g) || []).length === 1,
     'three copies is how the headline, the breakdown and the button disagree');

  const calc = html.slice(html.indexOf('const _emptySources = '),
                          html.indexOf('const _emptySources = ') + 400);
  ok('it tests === 0 exactly', /\.fontCount === 0/.test(calc), calc);
  ok('it does NOT treat null as empty', !/fontCount\s*(==|!)\s*null/.test(calc), calc);

  ok('the headline count excludes them',
     /const newCount = Math\.max\(0, \(st \? st\.new : total\) - _emptyCount\);/.test(html));
  ok('the headline says how many are being skipped',
     /archive\$\{_emptyCount === 1 \? '' : 's'\} with no sound font in/.test(html));
  ok('the breakdown agrees with the headline',
     /rows\.push\(\['New sound fonts', Math\.max\(0, st\.new - _emptyCount\)\]\)/.test(html),
     'two numbers on one screen that contradict each other is worse than one wrong number');
  ok('the breakdown names the skipped bucket',
     /'No sound font inside \(skipped\)', _emptyCount/.test(html));
  ok('the Import button accounts for them',
     /Math\.max\(0, st\.new - _emptyCount\) === 0;/.test(html),
     'an import where every source is empty has nothing to do');
  ok('the note has a style rule', /\.sf-review-empty-note \{/.test(html));
}

// ── the arithmetic ─────────────────────────────────────────────────────────
{
  const headline = (stNew, empty) => Math.max(0, stNew - empty);
  ok('his case: 136 with one empty reads as 135', headline(136, 1) === 135);
  ok('no empties changes nothing', headline(136, 0) === 136);
  ok('all empty reads as zero', headline(3, 3) === 0);
  ok('it never goes negative', headline(1, 5) === 0,
     'a count that disagrees with itself is worse than one that is merely low');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall empty-source review tests passed');
process.exit(failures ? 1 : 0);
