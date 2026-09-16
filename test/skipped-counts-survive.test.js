/**
 * The "already in your library" count cannot vanish  [B-397]
 *
 * ⭐ HIS, 2026-09-16, right after signing off [B-296]: "but this is also wrong. where's the
 * already in your library skipped item?" Three sources — one new, one with no font, one he
 * already owned — and the breakdown listed only two rows.
 *
 * ⭐⭐ AND THEN THE PART THAT MADE IT URGENT: "I did try an SD card import and saw the exact
 * behavior on that as well... I have a feeling that they share the same modal, both the bulk
 * import and the SD card import, and it was broken in both places." He was right. One line,
 * two doors. And: "that's behavior that worked, not that long ago."
 *
 * ⚠️⚠️ GIT AGREED WITH HIM — regression in edac3cd, 2026-08-31:
 *     - if (st.duplicate) rows.push(['Already in your library (skipped)', st.duplicate]);
 *     + const _owned = (typeof st.owned === 'number') ? st.owned : (st.duplicate || 0);
 *
 * `st.duplicate` is counted UNCONDITIONALLY in the analyze loop. `st.owned` is incremented
 * only inside `try { buildLibraryIndex(); if (index.length) { ... } } catch {}`, a loop that
 * also breaks on shouldCancel(). A throw, an empty index, or a cancel leaves it 0 while
 * `duplicate` is still correct — and the fallback written for exactly that case could never
 * run, because `stats` always returns `owned` as a number.
 *
 * ⭐ THE ROW STILL SAID IT, WHICH IS WHY IT LOOKED LIKE A COUNTING BUG RATHER THAN A DEAD
 * GUARD: the green "already in your library" note reads `src._duplicate` per source, which is
 * independent of ownedCount. Two screens, one fact, different sources of truth.
 *
 * Run: node test/skipped-counts-survive.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
// ⚠️ CODE ONLY, for the assertions that must NOT find a string. The comments explaining this
// regression necessarily quote the broken line, and a test that cannot tell documentation from
// code reports the very thing it is documenting. (Hit twice in one day — see
// test/empty-source-review.test.js.)
const code = html.split('\n').filter(l => {
  const t = l.trim();
  return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
}).join('\n');
const bulk = fs.readFileSync(path.join(ROOT, 'soundFontBulkImport.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── the counters really can diverge, which is what makes the floor necessary ──
{
  ok('dupCount is incremented in the main loop', /if \(res && res\.ok && res\.isDuplicate\) \{\s*\n\s*dupCount\+\+;/.test(bulk),
     'if this became conditional too, the floor would stop being a floor');

  const owned = bulk.slice(bulk.indexOf('let ownedCount = 0;'),
                           bulk.indexOf('let ownedCount = 0;') + 3000);
  ok('⚠️ ownedCount lives inside a try/catch that can no-op',
     /let ownedCount = 0;\s*\n\s*try \{/.test(bulk) && /if \(index\.length\) \{/.test(owned),
     'an empty index or a throw silently yields zero — this is the hazard, not a bug to fix here');
  ok('⚠️ and its loop breaks on cancel', /if \(shouldCancel\(\)\) break;/.test(owned),
     'he cancels often; a partial ownedCount beside a complete dupCount is the exact divergence');
  ok('both are still reported', /owned: ownedCount, duplicate: dupCount/.test(bulk));
}

// ── the reader takes the larger, and the fallback is REACHABLE ──────────────
{
  ok('⭐⭐ the row reads the maximum of the two counters',
     /const _owned = Math\.max\(st\.owned \|\| 0, st\.duplicate \|\| 0\);/.test(html),
     'this is the line edac3cd broke');
  ok('⚠️ the unreachable typeof guard is gone',
     !/typeof st\.owned === 'number'/.test(code),
     '`stats` always returns a number, so that branch could never fall through');
  ok('the row is still rendered from it',
     /if \(_owned\)\s+rows\.push\(\['Already in your library \(skipped\)', _owned\]\);/.test(html));

  // Behaviour, not shape: run the real expression against the states that occur.
  const rowValue = (st) => Math.max(st.owned || 0, st.duplicate || 0);
  ok('⭐ ownership pass ran: owned already includes the duplicates',
     rowValue({ owned: 3, duplicate: 1 }) === 3,
     'owned ⊇ duplicate — summing would double-count every archive duplicate');
  ok('⭐⭐ ownership pass did NOT run: duplicate is the floor',
     rowValue({ owned: 0, duplicate: 1 }) === 1,
     'this is his case — the row vanished entirely');
  ok('⚠️ a cancelled pass still reports what the dedup knew',
     rowValue({ owned: 0, duplicate: 4 }) === 4);
  ok('nothing owned reports nothing', rowValue({ owned: 0, duplicate: 0 }) === 0,
     'the row must still disappear when there is genuinely nothing to say');
  ok('missing fields do not throw or produce NaN',
     rowValue({}) === 0 && rowValue({ owned: undefined, duplicate: undefined }) === 0);
  ok('⚠️ a partial ownership pass never reports FEWER than the dedup found',
     rowValue({ owned: 1, duplicate: 3 }) === 3,
     'the half-counted state is the one that produced a wrong number rather than none');
}

// ── ⭐ one modal, two doors — which is why one line broke both ──────────────
//
// ⚠️ THE FIRST CUT OF THIS ASSERTED "exactly one place" AND WAS WRONG. There are two, and the
// second is correct: tracks have their own "Already in your library (skipped)" row driven by
// `_tLib`, because a track you own and a font you own are different facts. What must not be
// duplicated is the FONT row — bulk import and SD card import render this same modal, which is
// why edac3cd's single line broke both doors at once.
{
  const fontRows = (code.match(/rows\.push\(\['Already in your library \(skipped\)', _owned\]\)/g) || []).length;
  ok('⭐ the FONT skipped-row is built in exactly one place', fontRows === 1,
     `found ${fontRows} — a second copy would let the two importers drift apart`);
  const trackRows = (code.match(/rows\.push\(\['Already in your library \(skipped\)', _tLib\]\)/g) || []).length;
  ok('⚠️ and the tracks row is its own, deliberately', trackRows === 1,
     'folding tracks into the font count would state something false about both');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall skipped-count tests passed');
process.exit(failures ? 1 : 0);
