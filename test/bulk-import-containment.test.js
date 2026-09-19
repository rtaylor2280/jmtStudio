// ⭐⭐ THE FULL SOURCE WINS. [B-415]
//
// His rule, 2026-09-19: "it's really the full source wins. duplicate font but one has more stuff
// around it... that wins." And the case behind it, both paths handed over by him and MEASURED:
//
//   G:\...\Original Font Files\1.2-lightsaber of the  bells   213 files / 291 MB
//        GoldenHarvest, Verso, asteria, cfx, proffie, xenopixelv3
//   D:\Desktop\lightsaber of the bells                         32 files /  20 MB
//        the CONTENTS of that proffie folder
//
//   29 distinct hashes in the desktop copy, 29 of them in the original, ZERO unique to it.
//
// ⚠️⚠️ AND BOTH USED TO IMPORT. Their contentHashes share nothing - one digest covers 213 files,
// the other 32 - so the intra-batch twin check never fired. His words: "those would both import
// and be called identical fonts." The relationship is CONTAINMENT, not equality.
'use strict';

const fs   = require('fs');
const path = require('path');
const { rankByContainment, MAX_POSTINGS } = require('../bulkImportContainment');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const bulk = fs.readFileSync(path.join(__dirname, '..', 'soundFontBulkImport.js'), 'utf8');
const srcs = fs.readFileSync(path.join(__dirname, '..', 'soundFontSources.js'), 'utf8');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('PASS  ' + label); return; }
  failures++;
  console.log('FAIL  ' + label + (detail ? '\n      ' + String(detail).slice(0, 300) : ''));
}
const H = (n, p) => Array.from({ length: n }, (_, i) => (p || 'h') + i);

// ── the ranking itself, run rather than read ───────────────────────────────
{
  // ⭐ HIS PAIR, at the real sizes.
  const r = rankByContainment([{ idx: 0, hashes: H(112) }, { idx: 1, hashes: H(29) }]);
  ok('⭐⭐ the contained copy loses to the fuller package',
     r.has(1) && r.get(1).container === 0 && !r.has(0),
     JSON.stringify([...r]));

  // ⚠️⚠️ EXACT TWINS ARE NOT DECIDED HERE, deliberately. Identical sets are [B-314]'s case and it
  // has its own tie-break; ranking them in two places is how two mechanisms come to disagree
  // about one row — which is the bug [B-296] and [B-314] both were.
  ok('⚠️ identical sets are left to the twin check',
     rankByContainment([{ idx: 0, hashes: H(55) }, { idx: 1, hashes: H(55) }]).size === 0);

  // ⚠️⚠️ THE ONE THAT WOULD COST A FONT. Two fonts from one creator share a font.wav and a readme
  // without either being a copy of the other. Discarding a source over a partial overlap loses
  // something the user owns and asked for.
  ok('⚠️⚠️ a partial overlap is not containment',
     rankByContainment([{ idx: 0, hashes: ['a', 'b', 'c'] },
                        { idx: 1, hashes: ['c', 'd', 'e', 'f'] }]).size === 0,
     'sharing some files is how fonts from one creator normally look');

  // ⚠️ A must not be held back in favour of a source that is itself being discarded.
  const chain = rankByContainment([{ idx: 2, hashes: H(50) }, { idx: 1, hashes: H(20) }, { idx: 0, hashes: H(5) }]);
  ok('⚠️ a chain re-points at the surviving container',
     chain.get(0).container === 2 && chain.get(1).container === 2, JSON.stringify([...chain]));

  // Largest container wins; ties break on the lower index so walk order decides nothing.
  const two = rankByContainment([{ idx: 7, hashes: H(10) }, { idx: 3, hashes: H(10) }, { idx: 9, hashes: H(4) }]);
  ok('⚠️ a tie between containers breaks deterministically', two.get(9).container === 3,
     JSON.stringify([...two]));

  ok('a lone source is never ranked against itself',
     rankByContainment([{ idx: 0, hashes: H(9) }]).size === 0);
  ok('missing or empty hashes decide nothing rather than guessing',
     rankByContainment([{ idx: 0 }, { idx: 1, hashes: [] }, { idx: 2, hashes: null }]).size === 0);

  // ⚠️ THE CEILING IS A GUARD, NOT A KNOB. A batch of voicepacks is thousands of sources sharing
  // hundreds of identical wavs, which is the shape that turns "only compare what shares a file"
  // into "compare everything". A file that universally shared says nothing about whose package is
  // fuller, so skipping it loses no signal.
  ok('a universally shared file does not drive the comparison', MAX_POSTINGS > 0 && MAX_POSTINGS <= 1000);
}

// ── it costs no new I/O, which is the whole reason it is allowed to exist ──
{
  // ⚠️⚠️ [B-398] SPENT A DAY making the import pass yield so the window would stop freezing —
  // 9,347ms of unbroken main-thread work measured on his machine, against the ~5s at which Windows
  // offers to kill the app. A second walk over extracted content to answer this question would
  // hand that back. The records are ALREADY in hand for contentHash.
  ok('⭐⭐ the hashes are taken from records already collected',
     /fileHashes = fhz\.uniqueFileHashes\(recz\)/.test(srcs)
       && /fileHashes = fhm\.uniqueFileHashes\(recs\)/.test(srcs),
     'if this re-walks or re-hashes the tree, the freeze comes back');

  ok('⚠️ BOTH import routes carry them, not just the zip one',
     (srcs.match(/uniqueFileHashes\(/g) || []).length >= 2,
     'the folder route is the one that froze hardest — it must not be the one that skips this');

  ok('they reach the caller', /hash, contentHash, fileHashes, format/.test(srcs));
}

// ── wiring: the analyze pass, and the ordering that keeps it honest ────────
{
  ok('analyze ranks the batch by containment', /rankByContainment\(_batchFiles\)/.test(bulk));

  // ⚠️⚠️ AFTER the twin back-fill, never instead of it.
  const rankAt = bulk.indexOf('rankByContainment(_batchFiles)');
  const backfillAt = bulk.indexOf('first.sameInBatch = {');
  ok('⚠️ it runs after the exact-twin pass', backfillAt > 0 && rankAt > backfillAt,
     'running first would let the vaguer claim overwrite the precise one');

  ok('⚠️ a row already settled as an exact twin is left alone',
     /if \(row\.sameInBatch\) continue;/.test(bulk));

  ok('the count is its own bucket, not folded into the others',
     /containedInBatch: batchContainedCount/.test(bulk)
       && !/duplicate: [^,]*batchContainedCount/.test(bulk));
}

// ── the renderer: both doors, and the message ─────────────────────────────
{
  // ⭐⭐ ONE PREDICATE, BOTH DOORS. [B-296] then [B-314] were the same bug twice — a second
  // spelling of "should this be held back" that review knew about and quick import did not. A new
  // way to lose either goes in this function or it silently does not apply to quick import.
  const _expr = (html.match(/const _isLaterTwin = \(s\) =>([\s\S]*?);\s*?\r?\n/) || [])[1];
  ok('the held-back decision is still ONE hoisted predicate', !!_expr);
  if (_expr) {
    const decide = new Function('s', `return (${_expr});`);
    ok('⭐⭐ a contained row is held back', decide({ _containedIn: { idx: 0 } }) === true);
    ok('⭐⭐ and an exact twin still is', decide({ _sameInBatch: { keeps: false } }) === true);
    ok('⚠️ the keeper of a twin pair is not', decide({ _sameInBatch: { keeps: true } }) === false);
    ok('⚠️ an ordinary row is not', decide({ _idx: 3 }) === false);
  }

  // ⚠️ Quick import reads the same predicate, so this needs no second assertion about containment
  // specifically — but it DOES need the guarantee that it still calls it.
  const _q = html.indexOf('const fresh = runPlan.sources.filter(');
  ok('quick import still filters through it', /!_isLaterTwin\(s\)/.test(html.slice(_q, _q + 240)));

  ok('the flag is carried onto the row', /if \(r\.containedIn\) \{ s\._containedIn = r\.containedIn;/.test(html));

  const _c = html.indexOf('if (src._containedIn) {');
  const branch = html.slice(_c, html.indexOf('if (src._sameInBatch) {', _c));
  ok('the contained row gets its own note', _c > 0);

  // ⚠️ Comments stripped and joins collapsed FIRST. Asserting about WORDS means looking at words,
  // not at a window that also contains prose about the words.
  // ⚠️⚠️ AND THIS IS THE EIGHTH TIME THAT TRAP HAS BITTEN IN TWO DAYS. The assertion below ran
  // against the raw branch and FAILED — because the COMMENT forbidding "already in your library"
  // contains the phrase "already in your library". The test was right about the code and wrong
  // about where to look, which is the same root every single time. Strip first, then assert.
  const copy = branch.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n')
                     .replace(/'\s*\+\s*'/g, '');

  // ⚠️⚠️ IT MUST NOT SAY "ALREADY IN YOUR LIBRARY". It is not in the library — it is in THIS
  // import, and saying otherwise sends the user looking for something that is not there.
  ok('⚠️⚠️ it never claims the font is already in the library',
     !/already in your library/i.test(copy), copy);
  ok('it says what is actually true — the other one has more',
     /Everything here is also in \$\{src\._containedIn\.label\}, which includes more/.test(copy), copy);

  // ⚠️ Unticked, NOT disabled. Wanting the single font separate from the full package is a real
  // choice, and the same shape every other held-back row uses.
  ok('⚠️ unticked, never disabled', /row\.checkbox\.checked = false;/.test(branch)
     && !/disabled = true/.test(branch));
  ok('the tooltip says how to take it anyway', /Check it to import this copy on its own as well/.test(branch));
}

console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
