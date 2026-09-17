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

// ── ⚠️⚠️ THE FIELD THE READER READS IS THE FIELD THE WRITER WROTE ─────────
//
// ⭐⭐ THIS SUITE WENT GREEN FOR THREE DAYS ON A FEATURE THAT NEVER RAN. The analyze
// stream stamps `s._enrich = r.enrich` — with an underscore — and the summary screen read
// `s.enrich`, which is not a property of anything. `_emptySources` was ALWAYS empty and
// `_emptyCount` ALWAYS 0, so the headline never subtracted, the breakdown row never
// appeared and the Import gate never moved.
//
// ⚠️ EVERY ASSERTION BELOW STILL PASSED, because they match SOURCE TEXT — `=== 0`, the
// hoist, null-vs-zero — and no textual assertion can see a misspelled property. The shape
// was right in every particular and the wiring was dead.
//
// ⭐ IT ALSO LOOKED CORRECT IN HIS DEV TEST BY COINCIDENCE: three sources, one a library
// duplicate, so "2 new sound fonts ready" was the right number reached without ever
// subtracting the empty archive. A broken mechanism agreeing with the right answer on one
// input is the hardest kind of broken to catch by looking.
//
// So: find where the property is ASSIGNED, and require every reader to use that same name.
{
  const m = bulk.match(/(\w+)\._enrich = r\.enrich|s\.(\w+) = r\.enrich/)
         || html.match(/s\.(_?\w*enrich\w*) = r\.enrich/i);
  ok('the analyze stream assigns the enrich payload to a named field', !!m,
     'if this moves, the assertions below cannot anchor to it');
  const written = m ? (m[0].split('=')[0].trim().replace(/^[^.]*\./, '')) : null;
  ok('⭐⭐ the written field is _enrich (the underscore is the whole bug)',
     written === '_enrich', `writer assigns ${written}`);

  // ⚠️ CODE ONLY. The first cut of this ran against the whole file and failed on the
  // COMMENTS that explain the bug — they necessarily contain the wrong spelling. A test that
  // cannot tell documentation from code reports the very thing it is documenting.
  const code = html.split('\n').filter(l => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');

  const readers = [...code.matchAll(/\bs(?:rc)?\.(_?enrich)\b/g)].map(x => x[1]);
  ok('⭐⭐ every reader uses the SAME field the writer wrote',
     readers.length > 0 && readers.every(r => r === written),
     `writer=${written}  readers=${[...new Set(readers)].join(', ') || 'none found'}`);
  ok('⚠️ and the bare `enrich` spelling appears nowhere as a source property',
     !/\bs(?:rc)?\.enrich\b/.test(code),
     'this exact spelling is what silently matched nothing');
}

// ── ⭐⭐ ONE DEFINITION, AND EVERY SCREEN THAT ASKS USES IT ────────────────
//
// Four places ask "does this source hold a font": the pre-import summary, the review's
// headline sentence, the review ROW, and Quick import's commit filter. The entry's own
// warning is that computing it repeatedly is how they start disagreeing — and they did.
//
// ⚠️ QUICK IMPORT WAS THE ONE THAT GOT MISSED, and his question found it ("if you try to
// import an SD card, it doesn't even give you folders that aren't fonts right?"). Analyze
// zips every source before it can know what is inside, so an empty archive is `_prepared`,
// is not `_corrupt` and is not `_owned` — it passed all three of Quick's tests and was swept
// into the run to fail at the far end. The invariant it broke was written in the code beside
// it: quick commits exactly what the review screen would show CHECKED.
{
  ok('⭐⭐ the predicate is defined exactly once',
     (html.match(/const _srcHasNoFont = /g) || []).length === 1,
     'four copies is how four screens start disagreeing');
  ok('it reads the written field and tests === 0',
     /const _srcHasNoFont = \(s\) => !!\(s && s\._enrich && s\._enrich\.fontCount === 0\);/.test(html),
     'null means "could not ask" and must not be treated as empty');

  const uses = (html.match(/_srcHasNoFont[\(,)]/g) || []).length;
  ok('⭐ all four consumers call it', uses >= 4, `found ${uses} call sites`);
  ok('the pre-import summary calls it',
     /const _emptySources = \(plan\.sources \|\| \[\]\)\.filter\(_srcHasNoFont\);/.test(html));
  ok('the review headline calls it',
     /const _gNoFont = _guidedSources\.filter\(_srcHasNoFont\)\.length;/.test(html));
  ok('the review row calls it',
     /const _noFont = _srcHasNoFont\(src\);/.test(html));
  // ⚠️ MATCHES THE CLAUSE, NOT THE WHOLE FILTER LINE. The first cut pinned the four tests
  // in one exact sequence and broke the moment [B-314] added a fifth and wrapped the line —
  // a red suite over a change that ADDED a skip reason rather than removing one. What this
  // must guarantee is that quick import consults the predicate, not that the filter has
  // exactly the shape it had on the day this was written.
  ok('⭐⭐ and QUICK IMPORT calls it',
     /runPlan\.sources\.filter\(s => s\._prepared[\s\S]{0,300}?!_srcHasNoFont\(s\)/.test(html),
     'quick must commit exactly what review would show checked');
  ok('⚠️ no consumer still spells the test out inline',
     !/_enrich && \w+\._enrich\.fontCount === 0/.test(html.replace(/const _srcHasNoFont[^;]+;/, '')),
     'an inline copy is a copy that stops matching the others');
}

// ── the review ROWS use it, not only the summary ──────────────────────────
//
// ⚠️ THE SECOND HALF OF THE SAME FAILURE. Even with the field name right, the fix lived
// entirely on the summary screen. The review builds rows one-per-SOURCE and consulted
// nothing, so `tr.zip` arrived with a checkbox, pre-checked, indistinguishable from a real
// font — and the user learned otherwise from a failure list 47 minutes later.
{
  ok('⭐⭐ a row knows whether its source holds a font',
     /const _noFont = _srcHasNoFont\(src\);/.test(html),
     'the screen the user ACTS on is the one that has to know');
  ok('⭐ and a no-font row is not skipped by the notes pass',
     /!src\._sameInBatch && !_noFont\) return;/.test(html),
     'the early return existed for rows with nothing to say; this row has something to say');
  ok('⭐⭐ its checkbox is off AND disabled',
     /if \(_noFont\) \{[\s\S]{0,900}?row\.checkbox\.checked = false;[\s\S]{0,200}?row\.checkbox\.disabled = true;/.test(html),
     'a tickable box promises an import that cannot happen');
  ok('⚠️ it is decided BEFORE the duplicate notes',
     html.indexOf('if (_noFont) {') < html.indexOf('if (src._sameInBatch) {'),
     '"already in your library" on an archive holding no font is true and useless');

  // ⭐ Name what was found. An archive of 17 wavs IS something; "No fonts found in source"
  // is accurate and tells the user nothing about what they have.
  ok('⭐⭐ the row names what WAS found',
     /\.wav file\$\{_wc === 1 \? '' : 's'\}, but no sound font/.test(html),
     'his second ask on the entry, and what makes the message fair to the file');
  ok('⚠️ and it still reads when the wav count is unknown',
     /: 'No sound font in this archive\. Nothing here to import\.'/.test(html),
     'a nested zip we could not walk must not print "undefined .wav"');
}

// ── the sentence above the rows counts fonts, not rows ────────────────────
{
  ok('fonts and no-font archives are counted separately',
     /const _gNoFont = _guidedSources\.filter\(_srcHasNoFont\)\.length;/.test(html)
     && /const _gFonts  = Math\.max\(0, _gTotal - _gNoFont\);/.test(html));
  ok('⭐ "Reviewing N fonts" counts FONTS',
     /Reviewing <strong>\$\{_gFonts\}<\/strong> font/.test(html),
     '_gTotal counts sources, and an empty archive is not one of the fonts being reviewed');
  ok('⭐ and the extra archives are named in the same sentence',
     /no sound font inside and cannot be imported/.test(html),
     'the row is only found by scrolling to it');
  ok('⚠️ fontless means no FONTS, not no rows',
     /const _fontless = _gFonts === 0;/.test(html),
     'a folder of nothing but empty archives has rows and no font apparatus');
}

// ── the review screen uses it ──────────────────────────────────────────────
{
  ok('the empty set is computed once, hoisted',
     (html.match(/const _emptySources = /g) || []).length === 1,
     'three copies is how the headline, the breakdown and the button disagree');

  // ⚠️ THESE TWO MOVED WITH THE LOGIC. They used to read the call site, which spelled the
  // test out inline; hoisting to `_srcHasNoFont` left them matching nothing but still
  // passing on the old text until it was gone. Assert the rules where the rules now live —
  // and once, which is the point of hoisting.
  const calc = html.slice(html.indexOf('const _srcHasNoFont = '),
                          html.indexOf('const _srcHasNoFont = ') + 200);
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
