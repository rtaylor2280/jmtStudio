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
  // ⚠️ KEYED ON CONTENT SINCE [B-415]: `res.contentHash || res.hash`. A zip is identified by
  // its archive sha256 and a folder by its content digest, so before this the same font in two
  // shapes carried two keys, never collided, and both imported. The set entry also carries
  // isZip now, because the zip outranks the folder whatever the walk order.
  ok('it is seeded from the CONTENT hash, not the artifact hash',
     /const _h = res\.contentHash \|\| res\.hash \|\| null;/.test(bulk));
  // ⭐ [B-415] The entry records what the ranking needs: the shape, and how FULL the source is.
  // Fullness is the rule (his: "the full source wins"); shape only breaks an exact tie.
  ok('and the set entry records what the ranking needs',
     /_batchHashes\.set\(_h, \{ idx: i, label, isZip: _isZip, full: _full \}\)/.test(bulk));
  ok('fullness is measured from the whole staged tree, not the wavs alone',
     /_full = \{ files: res\.fileCount \|\| 0, bytes: res\.totalBytes \|\| res\.fileSize \|\| 0 \}/.test(bulk));
  ok('and consulted before a source is called new', /_batchHashes\.get\(_h\)/.test(bulk));

  // ⚠⚠ BOUNDED BY THE NEXT BRANCH, NOT BY A CHARACTER COUNT. A fixed +1600 window silently
  // truncated the moment [B-415] added comments here, and two assertions below went red against
  // code that was perfectly correct. A window that can rot is a test that will lie later.
  const _bStart = bulk.indexOf('} else if (res && res.ok && res.prepared) {');
  const _bEnd   = bulk.indexOf('results.push({ idx: i,', _bStart);
  const branch  = bulk.slice(_bStart, _bEnd > _bStart ? _bEnd + 1200 : _bStart + 4000);
  ok('a twin is not counted as new', /else if \(!_twin\) newCount\+\+;/.test(branch),
     'counting it would put the review number back above what the import produces');
  // ⚠️ MATCHED LOOSELY ON PURPOSE. The first version pinned the object literal field-for-field
  // and broke the moment [B-415] added `keeps` to it - against code that was more correct than
  // before. What this case actually protects is that a twin still carries `prepared`, so "import
  // anyway" can finalize from the staged copy instead of extracting a second time.
  ok('a twin still carries its prepared object',
     /sameInBatch: _twin \?[\s\S]{0,160}?prepared: \{/.test(branch),
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
     /'Same font already in this import \(skipped\)', st\.sameInBatch/.test(html),
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
    // ⭐⭐ [B-415] THE RULE IS NO LONGER "SECOND LOSES". His wording 2026-09-19: "it's really the
    // full source wins. duplicate font but one has more stuff around it... that wins." The ranking
    // happens in soundFontBulkImport and arrives as `keeps`; the renderer only obeys it.
    ok('⭐⭐ the row the ranking did not keep is held back',
       decide({ _idx: 5, _sameInBatch: { idx: 2, keeps: false } }) === true);
    ok('⭐⭐ and the keeper stays ticked', 
       decide({ _idx: 2, _sameInBatch: { idx: 5, keeps: true } }) === false,
       'inverting this holds back the wrong copy, and nothing on screen would say so');

    // ⚠⚠ AND THE EARLIER ROW CAN NOW LOSE, which is the entire change. Under the old predicate
    // this case was unreachable: idx 2 vs idx 5 meant idx 2 always survived, so a fuller copy
    // sitting later in the walk was discarded in favour of a trimmed one that happened to be
    // named first. Pinned as its own case because it is the behaviour nobody would notice.
    ok('⭐⭐ a LOWER index loses when it is not the fuller source',
       decide({ _idx: 2, _sameInBatch: { idx: 5, keeps: false } }) === true,
       'if this is false the ranking is being overridden by walk order again');

    ok('⚠️ a row with no twin is never held back', decide({ _idx: 2 }) === false);
    // ⚠⚠ NO `keeps` MEANS KEEP IT. A row from an analyze that predates this field must stay
    // TICKED - that is the safe direction. Unticking on a fact we could not establish silently
    // drops a font the user asked for.
    ok('⚠️ an unranked row is kept rather than guessed at',
       decide({ _sameInBatch: { idx: 5 } }) === false &&
       decide({ _idx: 2, _sameInBatch: {} }) === false);
  }

  // ⚠⚠ ASSERTED ON THE PREDICATE, NOT ON THE FILE. The previous version grepped the whole of
  // index.html for `s._idx > s._sameInBatch.idx` - and it went on PASSING after that comparison
  // was deleted, because the comment explaining why it was deleted still contained the string.
  // A test that greps a 44k-line file for a fragment of code will eventually match prose about
  // the code. Ask the predicate instead.
  ok('⚠️ walk order no longer decides anything',
     !!_expr && !/_idx\s*>\s*s\._sameInBatch\.idx/.test(_expr),
     'the ranking is upstream now; comparing indices here re-introduces the bug');
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
