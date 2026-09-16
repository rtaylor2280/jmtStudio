/**
 * Multi-select facet dropdowns stay open, refresh counts, and freeze their rows
 *   [B-382], closing a dated exception from [B-305]
 *
 * ⭐ HIS CATCH, 2026-09-16: "we had rules on close dropdown after click... I think this
 * violates it. shouldn't auto close if I can make more selections."
 *
 * He was right, and better than that: THE RULE WAS ALREADY WRITTEN AND DEFERRED TO HERE.
 * ui-conventions.md:1803 (2026-09-03) — a dropdown closes on pick if it is SINGLE-choice
 * and stays open if it is MULTI-select, because "the test is not 'does one click finish
 * the gesture', it is 'am I likely to want a second one'." Only the sort fix shipped that
 * day; the three filter dropdowns were left knowingly wrong with an owner recorded:
 * "we'll handle all this in the entry when we get to it." This is that entry.
 *
 * ⚠️ NOT CLOSING HAS TWO CONSEQUENCES, and the second is the one that bites:
 *   1. the COUNTS must refresh after each pick or they describe a population that is gone;
 *   2. but if the ROW SET or ORDER also refreshes, rows appear, vanish and re-sort under
 *      the cursor — the row you meant to click second has moved, and the one you just
 *      picked jumps to the top (selected rows pin).
 * So counts are live and rows are not. Same rule the grid already runs on: the view is
 * the answer to a question you asked, not a live query that rewrites itself as you work.
 *
 * ⭐ AND HIS SECOND CATCH IN THE SAME BREATH: "if 0 then no filter would do any good
 * here... seems the list should hide 0 no?" Right, with ONE exception — there are two
 * kinds of zero on that screen and they must be treated oppositely. See below.
 *
 * Run: node test/facet-dropdown-behaviour.test.js
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

// ── 1. they no longer close on pick ────────────────────────────────────────
{
  // ⚠️ The old justification on the effects handler was "each gesture is a one-shot
  // selection (no cycling), so close after the click". True of the click, and the wrong
  // test — one-shot describes the gesture, not whether a second pick is likely.
  ok('⭐ no facet handler still carries the one-shot justification',
     !/one-shot selection \(no cycling\)/.test(html));
  ok('⭐ and none of the three still auto-dismisses',
     !/auto-dismisses after a pick/.test(html));

  // ⚠️ Bound the slice at the handler's OWN closing brace. A fixed character window
  // runs into the next listener - which legitimately hides the other two dropdowns when
  // it opens - and reports a failure in code that is correct.
  const handler = (marker) => {
    const i = html.indexOf(marker);
    if (i < 0) return '';
    const close = html.indexOf('\n      });', i);
    return close < 0 ? html.slice(i, i + 600) : html.slice(i, close);
  };
  for (const [facet, marker] of [
    ['tag',     'if (tag) _sfToggleFilterTag(tag);'],
    ['creator', 'if (creator) _sfToggleFilterCreator(creator);'],
    ['effect',  'if (effect) _sfToggleFilterEffect(effect);'],
  ]) {
    const h = handler(marker);
    ok(`the ${facet} pick does not hide its dropdown`,
       !/style\.display = 'none'/.test(h), h.slice(0, 300));
  }

  // ⚠️ But they must still close the ordinary way, or they never close at all.
  ok('⭐ clicking outside still dismisses all three',
     /if \(!inTag && _sfTagDropdown && _sfTagDropdown\.style\.display !== 'none'\)/.test(html)
     && /if \(!inCreator && _sfCreatorDropdown/.test(html),
     'removing the pick-dismiss must not remove the outside-click dismiss');
}

// ── 2. a pick refreshes the counts, and keeps your place ───────────────────
{
  const calls = (html.match(/^\s*_sfRefreshOpenFacet\(/gm) || []).length;
  ok('every pick refreshes its own open dropdown', calls === 4,
     `${calls} call sites - expect exactly four: left-click on tag, creator and effect, ` +
     'plus the effects right-click. More than four means it landed somewhere it does not ' +
     'belong; a first-occurrence replace put the tag one in the card chip-click handler.');
  ok('⭐ and the tag refresh is in the DROPDOWN handler, not the card chip handler',
     /if \(tag\) _sfToggleFilterTag\(tag\);\n\s*_sfRefreshOpenFacet\(_sfTagDropdown/.test(html)
     && !/const chip = e\.target\.closest\('\.sf-card-tag'\);[\s\S]{0,300}_sfRefreshOpenFacet/.test(html),
     'clicking a tag chip on a card is a different gesture and owns no dropdown');
  ok('⭐ and scroll position is restored across the re-render',
     /const dTop = dropdown\.scrollTop, lTop = list \? list\.scrollTop : 0;/.test(html)
     && /dropdown\.scrollTop = dTop;/.test(html),
     'the effects list is long; losing your place on every pick is its own defect');
  ok('opening thaws the frozen rows',
     (html.match(/_sfUnfreezeFacetRows\('(tag|creator|effect)'\)/g) || []).length === 3,
     'without this the list would stay frozen forever after the first open');
}

// ── 3. ⭐⭐ THE TWO KINDS OF ZERO — run against the real helper ─────────────
//
// From his screenshot, filtering WITHOUT bgndrag and bgnlb:
//   * `bgndrag ✗ 0` and `bgnlb ✗ 0` are zero BECAUSE HE EXCLUDED THEM. Hiding those
//     leaves no way to cycle them back off without clearing every filter.
//   * `ccchange 0`, `lowbatt 0`, `spin 0` are zero because nothing left has them.
//     Picking one empties the grid — a dead option, and what he was pointing at.
// So: hide count-0, EXCEPT anything actively set.
{
  const lines = html.split('\n');
  const at = lines.findIndex(l => l.includes('let _sfFrozenFacetRows = {'));
  ok('the freeze helper is findable', at > 0);
  let end = at;
  while (end < lines.length && !lines[end].includes('return visible;')) end++;
  ok('and has a findable end', end < lines.length);
  const body = lines.slice(at, end + 3).join('\n');
  const m = new Function(body + '\nreturn { freeze: _sfFreezeFacetRows, thaw: _sfUnfreezeFacetRows };')();

  const active = new Set(['bgndrag', 'bgnlb']);
  const isActive = (k) => active.has(k);
  const onOpen = [
    ['bgndrag',  { display: 'bgndrag',  count: 0  }],
    ['bgnlb',    { display: 'bgnlb',    count: 0  }],
    ['bgnlock',  { display: 'bgnlock',  count: 29 }],
    ['ccchange', { display: 'ccchange', count: 0  }],
    ['lowbatt',  { display: 'lowbatt',  count: 0  }],
    ['hum',      { display: 'hum',      count: 58 }],
  ];

  const first = m.freeze('effect', onOpen, isActive);
  const keys = first.map(([k]) => k);
  ok('⭐⭐ a zero you CAUSED stays (bgndrag, bgnlb)',
     keys.includes('bgndrag') && keys.includes('bgnlb'),
     'hiding these strands the absent polarity with no way back out');
  ok('⭐ a zero that is just dead is dropped (ccchange, lowbatt)',
     !keys.includes('ccchange') && !keys.includes('lowbatt'),
     'picking one of these empties the grid - the count IS the promise');

  // A later pick narrows things: counts move, rows must not.
  const afterPick = onOpen.map(([k, i]) => [k, {
    display: i.display,
    count: k === 'bgnlock' ? 4 : k === 'hum' ? 0 : i.count,
  }]);
  const second = m.freeze('effect', afterPick, isActive);
  ok('counts are LIVE after a pick',
     second.find(([k]) => k === 'bgnlock')[1].count === 4);
  ok('⭐ but a row whose count hit 0 does NOT vanish mid-gesture',
     second.some(([k]) => k === 'hum'),
     'rows leaving under the cursor is the defect the freeze exists to prevent');
  ok('⭐ and the order does not change',
     keys.join() === second.map(([k]) => k).join(),
     'a picked row jumping to the top moves the next row you were aiming at');

  m.thaw('effect');
  const reopened = m.freeze('effect', afterPick, isActive);
  ok('reopening re-evaluates, so the newly-dead row is gone',
     !reopened.some(([k]) => k === 'hum'),
     'frozen means frozen for this opening, not forever');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall facet dropdown behaviour tests passed');
process.exit(failures ? 1 : 0);
