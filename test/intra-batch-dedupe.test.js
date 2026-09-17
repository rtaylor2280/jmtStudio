/**
 * Two identical fonts in one import can see each other  [B-314]
 *
 * 2026-09-04, in the [B-309] dev pass: "but it didnt de dup". Confirmed on the live
 * library — `FoRed` and `RVJ`, two sources with the SAME content hash (68bea76807),
 * imported 17 seconds apart from one SD bulk import.
 *
 * CAUSE, traced not guessed. The analyze calls importSource with prepareOnly, which
 * DOES run findByHash — but findByHash walks listSources, and listSources only returns
 * directories with a readable meta.json. A staged source has `.preparing` and no meta
 * yet. So every font in a batch was dedup-checked against the library AS IT WAS BEFORE
 * THE BATCH, and two identical fonts inside the same run never saw each other.
 * finalizePreparedSource's own comment says the tree is "dedup-cleared" — true when it
 * was staged, no longer true by the time it commits.
 *
 * ⭐ SURFACED, NOT SILENTLY SKIPPED. Catching it at COMMIT would make the review lie:
 * it would say "importing 40" and import 39.
 *
 * ⚠️ AND IT IS A DIFFERENT STATEMENT FROM "already in your library". One is about the
 * library, the other about this card. A shared phrase would tell someone their card is
 * already imported when it is not.
 *
 * Run: node test/intra-batch-dedupe.test.js
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

// ── the analyze remembers what it staged ───────────────────────────────────
{
  ok('the run keeps its own hash set', /const _batchHashes = new Map\(\);/.test(bulk));
  ok('it is seeded from the prepare hash', /_batchHashes\.set\(_h, \{ idx: i, label \}\)/.test(bulk));
  ok('and consulted before a source is called new', /_batchHashes\.get\(_h\)/.test(bulk));

  const branch = bulk.slice(bulk.indexOf('} else if (res && res.ok && res.prepared) {'),
                            bulk.indexOf('} else if (res && res.ok && res.prepared) {') + 1600);
  ok('a twin is not counted as new', /else if \(!_twin\) newCount\+\+;/.test(branch),
     'counting it would put the review number back above what the import produces');
  ok('a twin still carries its prepared object', /sameInBatch: _twin \? \{ idx: _twin\.idx, label: _twin\.label \} : null,[\s\S]{0,80}prepared: \{/.test(branch),
     'the uuid is how "import anyway" finalizes without re-extracting');
}

// ── it is its own bucket, not folded into "duplicate" ──────────────────────
{
  ok('the stats carry it separately', /sameInBatch: batchDupCount/.test(bulk));
  const stats = bulk.match(/stats: \{[^}]*\}/)[0];
  ok('and it is NOT merged into duplicate',
     /duplicate: dupCount/.test(stats) && /sameInBatch: batchDupCount/.test(stats), stats);
}

// ── the plan and the screen keep the distinction ────────────────────────
{
  ok('the flag is stamped onto the source', /s\._sameInBatch = r\.sameInBatch;/.test(html));
  // ⚠ The review list is FILTERED, so a row's position there is not its index in
  // plan.sources — which is what sameInBatch.idx addresses. Without the stamp the
  // later-twin test would compare two numbering schemes.
  ok('⚠️ and so is its plan index, because the list is filtered',
     /s\._sameInBatch = r\.sameInBatch; s\._idx = r\.idx;/.test(html));
  ok('the breakdown gives it its own line, and says it is SKIPPED',
     /'Same font twice in this import \(skipped\)', st\.sameInBatch/.test(html),
     'it stopped importing by default on 2026-09-16, so the row had to say so');

  // ⚠⚠ BOUNDED BY THE BRANCH, NOT BY A CHARACTER COUNT. The first cut of this sliced a
  // fixed 400 chars and the check below PASSED over code that contradicted it — the
  // comment explaining the new behaviour pushed the behaviour itself past the window.
  // A window measured in characters silently shrinks its own coverage every time someone
  // writes a sentence.
  const _s = html.indexOf('if (src._sameInBatch) {');
  const rowNote = html.slice(_s, html.indexOf('if (src._duplicate) {', _s));
  ok('⚠️ the window really covers the whole branch',
     rowNote.length > 400 && /return;/.test(rowNote), `${rowNote.length} chars`);

  ok('the row names the OTHER row', /Same font as \$\{src\._sameInBatch\.label\} in this import\./.test(rowNote), rowNote);
  ok('the wording does not say "already in your library"',
     !/already in your library/i.test(rowNote), rowNote);
  ok('it is styled as a variant, not as owned',
     /classList\.add\('variant'\)/.test(rowNote) && /classList\.remove\('have-it'\)/.test(rowNote));

  const order = html.indexOf('if (src._sameInBatch) {') < html.indexOf('if (src._duplicate) {');
  ok('it is checked before the library-duplicate branch', order,
     'a source can be both, and the row it names is on this very screen');
}

// ── ⭐⭐ ONE COPY BY DEFAULT, AND BOTH ROWS SAY WHY ───────────────────
//
// ⭐ HIS DEV TEST, 2026-09-16, and he was right: "if those are the byte identical then
// this didn't work. they are both selected..." Detection had fired and the label was
// correct, but both twins stayed ticked — so pressing Import still produced the two
// copies the entry exists to prevent, just announced beforehand. And eight lines below in
// the same list, a LIBRARY duplicate unticks itself: two duplicates, opposite defaults.
{
  const _s = html.indexOf('if (src._sameInBatch) {');
  const rowNote = html.slice(_s, html.indexOf('if (src._duplicate) {', _s));

  // ⚠️⚠️ THE FIRST CUT OF THIS CHECKED THAT `_isLater` AND `checked = false` BOTH APPEAR,
  // and a mutation walked straight through it: changing the guard to `if (false && ...)`
  // leaves both strings present and the behaviour dead. Presence is not execution. So the
  // untick must be pinned INSIDE a branch the flag actually gates.
  ok('⭐⭐ the LATER twin starts unticked',
     /if \(_isLater[^)]*\)\s*\{[\s\S]{0,600}?row\.checkbox\.checked = false;/.test(rowNote),
     'otherwise Import still lands both copies — the original complaint, unchanged');

  // ⭐ AND THE DECISION ITSELF IS RUN, not read. Extract the real predicate and put both
  // orderings through it, so an inverted comparison fails here rather than on his screen.
  const _expr = (html.match(/const _isLaterTwin = \(s\) =>([\s\S]*?);\s*?\r?\n/) || [])[1];
  ok('the later-twin decision is ONE hoisted predicate', !!_expr,
     'inline copies are how review and quick import came to disagree');
  if (_expr) {
    const decide = new Function('s', `return (${_expr});`);
    ok('⭐⭐ the row scanned SECOND is the one held back',
       decide({ _idx: 5, _sameInBatch: { idx: 2 } }) === true);
    ok('⭐⭐ and the row scanned FIRST keeps its tick',
       decide({ _idx: 2, _sameInBatch: { idx: 5 } }) === false,
       'inverting this holds back the wrong copy, and nothing on screen would say so');
    ok('⚠️ a row with no twin is never held back', decide({ _idx: 2 }) === false);
    ok('⚠️ a missing index decides nothing rather than guessing',
       decide({ _sameInBatch: { idx: 5 } }) === false &&
       decide({ _idx: 2, _sameInBatch: {} }) === false,
       'defaulting to "later" would hold back a row for a fact we could not establish');
  }

  ok('⚠️ and "later" is decided by the PLAN index, not by row order',
     /s\._idx > s\._sameInBatch\.idx/.test(html),
     'a row position in the FILTERED review list is a different number entirely');

  // ⭐⭐ QUICK IMPORT HONOURS IT TOO — the door that was missed.
  //
  // His dev test of the untick, 2026-09-16: "correctly unchecked and would have been
  // skipped on review but went al and did quick import am both came in." Review showed
  // Import (5); Quick imported 6. A twin IS `_prepared`, is not `_corrupt` and is not
  // `_owned` — it is not in the library, it is in this run — so it passed every test the
  // quick filter had. Exactly the miss [B-296] fixed on this same line hours earlier.
  {
    const _q = html.indexOf('const fresh = runPlan.sources.filter(');
    const filter = html.slice(_q, _q + 240);
    ok('⭐⭐ quick import skips the later twin', /!_isLaterTwin\(s\)/.test(filter), filter);
    ok('⚠️ and still skips the other three it already knew about',
       /!s\._corrupt/.test(filter) && /!s\._owned/.test(filter) && /!_srcHasNoFont\(s\)/.test(filter),
       'a new reason must be ADDED to the invariant, never swapped into it');
    ok('⚠️ it uses the SHARED predicate, not a second spelling',
       !/_sameInBatch/.test(filter),
       'two spellings of "which is the later twin" is how these two doors drift apart');
  }
  ok('⚠️ unticked, NOT disabled — a second copy is one click away',
     !/disabled = true/.test(rowNote) && /checkbox\.title = /.test(rowNote),
     'the same font under two names on a card is sometimes deliberate');

  // ⭐⭐ THE NOTE IS NOT INSIDE THE TICK BRANCH. His questions were whether the rows
  // should trade places on reselection, and whether both should speak when both are
  // ticked. They are answered by the note never depending on a tick at all.
  const beforeGuard = rowNote.slice(0, rowNote.indexOf('_isLater'));
  ok('⭐⭐ the note is set BEFORE any checkbox decision, so it can never go quiet',
     /note\.textContent = /.test(beforeGuard),
     'logic that decides WHEN to speak is how a marker learns to vanish at the wrong moment');
}

// ── ⭐ the fact is symmetric, so the backend marks BOTH sides ───────────
//
// ⚠ The analyze loop can only ever mark the SECOND twin — when the first was scanned,
// nothing matched it yet. Leaving it there states walk order as if it were a fact about
// the font, and leaves one of the two rows silent.
{
  ok('⭐ the row carries its own display label forward',
     /results\.push\(\{ idx: i,[\s\S]{0,500}?\slabel,/.test(bulk),
     'the back-fill names THIS row on its partner, so it must use what the screen shows');
  ok('⭐⭐ a back-fill pass gives the FIRST twin a marker too',
     /if \(first && !first\.sameInBatch\) \{/.test(bulk));
  ok('⚠️ it points back at the later row', /first\.sameInBatch = \{ idx: r\.idx,/.test(bulk));
  ok('⚠️ and it runs after the loop, over the finished results',
     bulk.indexOf('if (first && !first.sameInBatch)') > bulk.lastIndexOf('results.push({ idx: i,'),
     'mid-loop it would have nothing to back-fill onto — the partner may not exist yet');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall intra-batch dedupe tests passed');
process.exit(failures ? 1 : 0);
