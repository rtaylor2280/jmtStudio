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

// ── ⚠⚠ THE MAPPING, AGAINST RECORDS NOBODY IN THIS FILE AUTHORED ──────────────
//
// ⭐⭐ THIS IS THE CASE THAT WAS MISSING, AND ITS ABSENCE SHIPPED A DEAD FEATURE. uniqueFileHashes
// read `r.hash`; the field collectFileRecords actually writes is `r.fileHash`. So it returned an
// EMPTY ARRAY for every source, _batchFiles stayed empty, and the containment ranking silently
// never ran. Nothing threw. No count was wrong. Every test in this file still passed.
//
// ⚠⚠ THEY PASSED BECAUSE THEY ALL BUILT THEIR OWN INPUT - `{hash}` objects and bare hash strings
// handed straight to rankByContainment, which skips this function entirely. The algorithm was
// tested thoroughly and the ADAPTER between it and the app was tested not at all. He found it by
// running the app: "nope, didn't work... why?"
// ⭐ THE RULE: when a function reads fields off a structure some OTHER module produces, the test
// has to get that structure from that module. A fixture you authored tests your fixture.
{
  const os = require('os');
  const fhm = require('../soundFontFileHash');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b415-'));
  try {
    // The shape of his real case in miniature: `sub` is the font, and the tree around it holds
    // that font plus extras — the other board flavors and the readme it shipped with.
    // ⚠️ THE EXTRAS MUST BE OUTSIDE `sub`, and the first cut of this got it wrong: with every
    // distinct byte-string present in both, the two were an exact TWIN and the ranker declined to
    // decide — correctly. The fixture was broken, not the code. A containment fixture has to make
    // the container genuinely fuller or it silently tests the case next door.
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'sub', 'b.wav'), 'bbb');
    fs.writeFileSync(path.join(tmp, 'sub', 'c.wav'), 'ccc');
    fs.writeFileSync(path.join(tmp, 'a.wav'), 'aaa');          // an extra `sub` does not have
    fs.writeFileSync(path.join(tmp, 'dupe.wav'), 'bbb');       // and a duplicate, on purpose

    const recs = fhm.collectFileRecords(tmp);
    ok('the fixture produced real records', recs.length === 4, JSON.stringify(recs));

    // ⚠⚠ THE ASSERTION THAT WOULD HAVE CAUGHT IT. Non-empty is the whole point.
    const hashes = fhm.uniqueFileHashes(recs);
    ok('⭐⭐ uniqueFileHashes returns hashes for REAL records',
       hashes.length > 0,
       'reading the wrong field name returns [] and the ranking silently never runs');

    // ⚠️ De-duplicated: two identical files are ONE hash, so a source cannot inflate its own size
    // and win a containment comparison it should have lost.
    ok('⚠️ identical files collapse to one hash', hashes.length === 3,
       JSON.stringify(hashes));

    // ⚠️ Pinned explicitly so a rename of the record field fails HERE, loudly, instead of
    // turning the feature off without a word.
    ok('⚠️ the record field is still named fileHash',
       Object.prototype.hasOwnProperty.call(recs[0], 'fileHash'),
       'if this moved, uniqueFileHashes must move with it: ' + Object.keys(recs[0]).join(','));

    // ⭐ And the whole chain, so the adapter and the algorithm are proven TOGETHER: a real subset
    // relationship built from real records must actually rank.
    const sub = fhm.collectFileRecords(path.join(tmp, 'sub'));
    const r = rankByContainment([{ idx: 0, hashes: fhm.uniqueFileHashes(recs) },
                                 { idx: 1, hashes: fhm.uniqueFileHashes(sub) }]);
    ok('⭐⭐ real records rank end to end', r.has(1) && r.get(1).container === 0,
       JSON.stringify([...r]));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

  // ⭐⭐ AND IT COMES OUT OF `new`. The twin check decrements inline because it decides DURING
  // the loop; this ranking decides after it, so the row was already counted as new. He hit exactly
  // this: the summary read "8 new sound fonts" on a run where the ranking HAD fired and only 6
  // would import - indistinguishable, from the outside, from the feature not working at all.
  ok('⭐⭐ a contained source is taken out of the new count',
     /if \(newCount > 0\) newCount--;/.test(bulk),
     'leaving it counted makes the summary contradict the import');

  // ⭐⭐ AND IT IS NOT A SECOND CATEGORY. His call 2026-09-19, on the separate line I had added:
  // "isn't it the same category as whatever our wording was for duplicate on source? don't need to
  // tell about fuller - that was what informed our choice... but we still only kept 1."
  // Fullness decides WHICH copy survives. It is not a second thing that happened to the user, so
  // it sets `sameInBatch` and inherits the note, the untick, the filter and the count.
  ok('⭐⭐ containment routes through the existing twin field',
     /row\.sameInBatch = \{ idx: info\.container, label: _kLabel, keeps: false \};/.test(bulk));

  ok('⚠️ the claim lands on the keeper too, as [B-314] does it',
     /if \(!keeper\.sameInBatch\) keeper\.sameInBatch = \{ idx: lostIdx, label: _lLabel, keeps: true \};/.test(bulk));

  ok('it counts into the one bucket', /batchDupCount\+\+;/.test(bulk));

  // ⚠⚠ NO PARALLEL TRACK LEFT ANYWHERE. A second flag, a second note or a second summary line is
  // how review and quick import came to disagree twice already ([B-296], [B-314]).
  ok('⚠⚠ no second flag survives in the backend', !/containedIn/.test(bulk), 'parallel track left behind');
  ok('⚠⚠ no second flag survives in the renderer', !/_containedIn|containedInBatch/.test(html));
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
    // ⭐⭐ ONE TEST COVERS BOTH NOW, and that is the point of the change rather than a gap in it:
    // a contained row and an exact twin both arrive carrying `sameInBatch` with keeps:false, so
    // there is no second shape to check. The earlier version asked about a `_containedIn` flag
    // that no longer exists — a parallel track for something that was never parallel.
    ok('⭐⭐ a row the ranking did not keep is held back',
       decide({ _sameInBatch: { keeps: false } }) === true);
    ok('⚠️ the keeper of a twin pair is not', decide({ _sameInBatch: { keeps: true } }) === false);
    ok('⚠️ an ordinary row is not', decide({ _idx: 3 }) === false);
  }

  // ⚠️ Quick import reads the same predicate, so this needs no second assertion about containment
  // specifically — but it DOES need the guarantee that it still calls it.
  const _q = html.indexOf('const fresh = runPlan.sources.filter(');
  ok('quick import still filters through it', /!_isLaterTwin\(s\)/.test(html.slice(_q, _q + 240)));

  // ⭐ The row note is the EXISTING twin note, unchanged, because this is the same statement:
  // the same font is in this import twice and one copy was kept.
  const _n = html.indexOf('if (src._sameInBatch) {');
  const branch = html.slice(_n, html.indexOf('if (src._duplicate) {', _n));
  const copy = branch.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n')
                     .replace(/'\s*\+\s*'/g, '');

  ok('it reuses the twin note', /Same font as \$\{src\._sameInBatch\.label\} in this import/.test(copy), copy);

  // ⚠⚠ AND IT NEVER SAYS "ALREADY IN YOUR LIBRARY". It is not in the library - it is in THIS
  // import, and the wrong sentence sends someone looking for something that is not there.
  ok('⚠⚠ it never claims the library already has it',
     !/already in your library/i.test(copy), copy);

  // ⚠️ The word "fuller" is deliberately absent from the UI. It is our reasoning for which copy
  // won, not a fact the reader needs.
  ok('⚠️ the UI does not explain fullness', !/fuller/i.test(copy), copy);

  // ⚠️ Unticked, NOT disabled. Wanting the single font separate from the full package is a real
  // choice, and it is one click away.
  ok('⚠️ unticked, never disabled', /row\.checkbox\.checked = false;/.test(branch)
     && !/disabled = true/.test(branch));
}
console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
