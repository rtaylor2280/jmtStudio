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

// ── the plan and the screen keep the distinction ───────────────────────────
{
  ok('the flag is stamped onto the source', /if \(r\.sameInBatch\) s\._sameInBatch = r\.sameInBatch;/.test(html));
  ok('the breakdown gives it its own line',
     /'Same font twice in this import', st\.sameInBatch/.test(html));

  const rowNote = html.slice(html.indexOf('if (src._sameInBatch) {'),
                             html.indexOf('if (src._sameInBatch) {') + 400);
  ok('the row names the OTHER row', /Same font as \$\{src\._sameInBatch\.label\} in this import\./.test(rowNote), rowNote);
  ok('the wording does not say "already in your library"',
     !/already in your library/i.test(rowNote), rowNote);
  ok('it is styled as a variant, not as owned',
     /classList\.add\('variant'\)/.test(rowNote) && /classList\.remove\('have-it'\)/.test(rowNote), rowNote);

  // ⭐ Checked FIRST: a source can be both, and the library note is the less useful of
  // the two when the row it names is on this very screen.
  ok('it is checked before the library-duplicate branch',
     html.indexOf('if (src._sameInBatch) {') < html.indexOf('if (src._duplicate) {'),
     'a source can be both, and this one names a row the user can see');

  // ⚠️ Unlike a library duplicate, there IS a staged copy to import, and importing both
  // is a legitimate choice. The row must not be disabled.
  ok('the row is not unchecked or disabled',
     !/checkbox\.checked = false/.test(rowNote) && !/disabled = true/.test(rowNote), rowNote);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall intra-batch dedupe tests passed');
process.exit(failures ? 1 : 0);
