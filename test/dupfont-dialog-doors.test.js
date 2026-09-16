/**
 * The already-have-it dialog's primary button is a destination  [B-390]
 *
 * ⭐ WHAT HE SAW, 2026-09-16, dev-testing [B-360] against the test-import fixture: six
 * matched fonts, three buttons, and the PRIMARY one was the one he could not read —
 *     "what is the blue option supposed to be saying here?"
 * The symptom is that the recommended action's label did not say what it would do. The
 * cause was that it did not do anything: "Back to my library" ran the same
 * cleanup + _sfCloseImport + resolve(false) as Cancel.
 *
 * WHERE IT CAME FROM, and it is why the single-match case was always fine: with one
 * match the button is "Open existing" and lands you on the font you already have — a
 * real destination. With several it cannot pick one, so it degraded into a label.
 *
 * ⭐ HIS FIX, and it is better than the removal I proposed:
 *     "oh library filtered to those. that's the way. much better. and then it becomes
 *      show in library."
 * The dialog NAMES N fonts the user has no other way to reach. Landing on exactly those
 * makes the blue slot worth its colour instead of worth deleting.
 *
 * ⚠️ NOT COVERED HERE ON PURPOSE: the "Import anyway under a new name" door. That is
 * [B-363], settled by dev test 2026-09-14 — "don't block them. they want to they can."
 * It is asserted to still exist, never to change.
 *
 * Run: node test/dupfont-dialog-doors.test.js
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

// ── the label that could not be read is gone ───────────────────────────────
{
  // ⚠️ SCOPED TO UI TEXT, NOT THE WHOLE FILE. A bare search for the phrase also hits
  // the comment recording WHY it went, and deleting that comment to satisfy a test
  // would trade the reason for a green tick. What must never return is the phrase as
  // something a user reads.
  ok('⭐ the dead label is gone from everywhere a user could read it',
     !/textContent\s*=\s*[^;]*Back to my library/.test(html)
     && !/<button[^>]*>[^<]*Back to my library/.test(html),
     'it was Cancel wearing the primary colour');

  ok('one match opens the font; several show the set',
     /els\.openBtn\.textContent = one \? 'Open existing' : 'Show in library';/.test(html));
}

// ── the name filter: a result set, not a facet ─────────────────────────────
{
  ok('the name filter exists', /let _sfActiveFilterNames = new Set\(\);/.test(html));
  ok('it has one producer on window',
     /window\._sfShowNamesInLibrary = \(names, label\) =>/.test(html));

  ok('⭐ it narrows like search, OUTSIDE the selection override',
     /matchesSearch\(f\) && matchesNameFilter\(f\) &&/.test(html),
     'inside the override, a stale selection would smuggle extra cards into the answer');

  ok('it counts as filtering', /_sfActiveFilterNames\.size > 0/.test(html));
  ok('Clear all clears it', /_sfActiveFilterNames = new Set\(\);\s*\/\/ \[B-390\]/.test(html));

  const setter = html.slice(html.indexOf('window._sfShowNamesInLibrary'),
                            html.indexOf('window._sfShowNamesInLibrary') + 600);
  ok('⭐ it REPLACES rather than accumulates',
     /_sfActiveFilterNames = new Set\(list/.test(setter),
     'two clicks must show the second answer, not the union of two');
  ok('⭐ and it clears the other filters first',
     /_sfClearAllFilters\(\{ silent: true \}\)/.test(setter),
     'a stale tag filter removing two of the six would make the button a liar');
  ok('the clear is silent so the empty state never flashes',
     /if \(!opts \|\| !opts\.silent\) _sfRenderGrid\(\);/.test(html));
}

// ── the chip ───────────────────────────────────────────────────────────────
{
  ok('one chip for the whole set, not one per name',
     /const namesChip = _sfActiveFilterNames\.size/.test(html)
     && /data-filter-remove-names="1"/.test(html));
  ok('and it drops whole', /_sfActiveFilterNames = new Set\(\);\s*\n\s*_sfActiveFilterNamesLabel = '';\s*\n\s*_sfRenderGrid\(\);/.test(html));
  ok('it renders with the other scope chips',
     /const flags = `\$\{namesChip\}/.test(html));
}

// ── the bug this wiring would otherwise have ───────────────────────────────
{
  const openFn = html.slice(html.indexOf('const onOpen = async () => {'),
                            html.indexOf('const onOpen = async () => {') + 2000);

  // ⚠️ HALF THE MATCHES ARE RENAMED — that is what the dialog's "you have it as"
  // line is saying. Filtering on the INCOMING names would return zero rows and the
  // button would look broken on exactly the case that motivated it.

  // ⚠️ refreshSoundFontsView re-renders the grid. A filter set before it is painted
  // over immediately — the silent-failure shape this whole class of change dies of.
  ok('⭐ the filter is applied AFTER the refresh',
     openFn.indexOf('refreshSoundFontsView') < openFn.indexOf('_sfShowNamesInLibrary'),
     'set before the refresh, it is overwritten and the button appears to do nothing');

  ok('the single-match path still opens the entry instead',
     /if \(target\) await _sfOpenEntryDetail\(target\);/.test(openFn)
     && /else if \(shown\.length\)/.test(openFn));
}

// ── ⚠️⚠️ THE GATE. This is the one that shipped broken. ────────────────────
//
// The predicate, `isFiltering` and the chip HTML were all correct and the suite was
// green, because every assertion checked that source text EXISTED. None of them ran
// the thing that decides whether the strip renders at all: `_sfRenderActiveFilters`
// computes a `total` and returns early at 0, before any chip is built. The name filter
// was missing from that one line, so the grid filtered to 4 of 150 and the row that
// undoes it never appeared. His report: "this filter doesn't show properly and can't
// clear it."
//
// ⭐ SO THIS EVALUATES THE REAL EXPRESSION rather than grepping for a variable name —
// a grep for "_sfActiveFilterNames" would have passed on the broken build too, since
// the name appears five other places in the same function.
{
  const line = (html.match(/const total = searchActive \+[^;]+;/) || [])[0];
  ok('the gate expression is findable', !!line, 'if this fails the shape changed — re-read it');

  const evalTotal = (names) => new Function(
    'searchActive', '_sfActiveFilterTags', '_sfActiveFilterCreators',
    '_sfActiveFilterEffects', '_sfActiveFilterEffectsMissing', '_sfActiveFilterNames',
    'namesActive', 'needsReviewActive', 'inUseActive', 'newActive',
    `${line} return total;`)(
      0, { size: 0 }, { size: 0 }, { size: 0 }, { size: 0 },
      { size: names }, names ? 1 : 0, 0, 0, 0);

  ok('⭐ a name filter ALONE opens the strip',
     evalTotal(4) >= 1,
     'at total 0 the strip hides and returns before the chip exists — no way to clear it');
  ok('and nothing active still closes it', evalTotal(0) === 0);
  ok('⭐ the set counts as ONE, so a lone chip gets no "Clear all"',
     evalTotal(4) === 1,
     'counting members would cross the >= 2 threshold and show Clear all beside one chip');
}

// ── ⭐ THE GROUPING, RUN RATHER THAN GREPPED ──────────────────────────────
//
// Two matched sources can resolve to ONE library entry — a renamed row is exactly
// that. A per-source list counted 6 while the filter behind "Show in library" showed
// 4, and he met it as a question: "why are there 4 but we said there were 6?" then
// ruled it: "we can't make up 2 more to show so have to match 4 not 6".
//
// ⚠️ THIS EXTRACTS THE REAL GROUPING CODE AND RUNS IT on his actual case. A grep
// would pass on an off-by-one or a bad key; only running it proves the number.
{
  const lines = html.split('\n');
  // ⚠️ ANCHOR ON THE UNIQUE COMMENT, NOT ON `const groups = new Map();` — that
  // identifier appears elsewhere in this file, and findIndex takes the FIRST one.
  // Extracting the wrong block produced a syntax error that looked like a defect in
  // the dialog code; it was this harness reading a different function entirely.
  const anchor = lines.findIndex(l => l.includes('GROUPED BY THE FONT YOU OWN'));
  ok('the grouping block is findable', anchor > 0);
  const at = lines.findIndex((l, i) => i > anchor && l.includes('const groups = new Map();'));
  ok('and its opening line follows the anchor', at > anchor);
  // ⚠️ Scan for the real end rather than a fixed line count. A comment added inside
  // the block would otherwise truncate it mid-expression, and the resulting syntax
  // error reads as a failure of the CODE when it is a failure of this harness.
  let endAt = at;
  while (endAt < lines.length && !lines[endAt].includes('</li>`;')) endAt++;
  ok('the grouping block has a findable end', endAt < lines.length);
  const body = lines.slice(at, endAt + 1).join('\n');

  const esc = x => String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const run = (matched) => new Function('matched', 'esc',
    body + '\nreturn {ownedUnique, out: Array.from(groups,([l,a])=>groupLi(l,a)).join("")};'
  )(matched, esc);

  // His exact case: six sources, two of them renamed onto entries already listed.
  const his = run([
    {name:'DarkSaber', matchName:'DarkSaber'},
    {name:'FoRed', matchName:'FoRed'},
    {name:'RgueCmdr', matchName:'RgueCmdr'},
    {name:'RVJ', matchName:'FoRed'},
    {name:'Taron', matchName:'Taron'},
    {name:'Lightsaber_Of_The_Bells', matchName:'RgueCmdr'},
  ]);
  ok('⭐ six matched sources group to four library fonts',
     his.ownedUnique.length === 4, his.ownedUnique.join(', '));
  ok('and the four are the LIBRARY names, not the incoming ones',
     his.ownedUnique.join(',') === 'DarkSaber,FoRed,RgueCmdr,Taron', his.ownedUnique.join(','));
  ok('⭐ a renamed source is named as an alias of the font you own',
     /FoRed<\/strong> \(matching <strong>RVJ/.test(his.out), his.out);
  ok('and a same-named match carries no pointless alias',
     /<li><strong>DarkSaber<\/strong><\/li>/.test(his.out), his.out);

  // A pure rename with nothing else: the library name leads, the file is the alias.
  const rename = run([{name:'Jinn_EP1', matchName:'QuiGone'}]);
  ok('a pure rename still leads with the font you own',
     rename.ownedUnique.length === 1 && rename.ownedUnique[0] === 'QuiGone'
     && /QuiGone<\/strong> \(matching <strong>Jinn_EP1/.test(rename.out), rename.out);

  // ⚠️ A match with no library name must not vanish — it falls back to its own name
  // rather than being dropped from a count the user is about to act on.
  const noMatchName = run([{name:'Orphan', matchName:''}]);
  ok('a match with no library name falls back rather than disappearing',
     noMatchName.ownedUnique.length === 1 && noMatchName.ownedUnique[0] === 'Orphan',
     JSON.stringify(noMatchName.ownedUnique));

  // ⭐ [B-390] AND THE GAP IS ACCOUNTED FOR. Grouping alone made the number honest
  // and left two of his six unexplained: "so what happened to the other 2?... that's
  // ok but should be stated."
  // ⚠️ The sentence says MATCH, never "duplicates of each other" - this dialog only
  // knows what each source matched in the LIBRARY. Two different versions can both
  // match one library font without being identical to one another; that claim belongs
  // to [B-314] and its hash data, not here.
  ok('⭐ both populations are named when they differ',
     /The \$\{matched\.length\} fonts you picked match <strong>\$\{ownedUnique\.length\}<\/strong> already in your library:/.test(html),
     'reducing 6 to 4 without saying so leaves the user doing the arithmetic');
  ok('and it does not claim the sources are duplicates of each other',
     !/duplicates of each other/.test(html) && !/identical to each other/.test(html));
  ok('the simple wording survives when nothing was collapsed',
     /All \$\{ownedUnique\.length\} of these fonts match sounds you already have:/.test(html));

  ok('⭐ the body states the GROUPED count, not the source count',
     /All \$\{ownedUnique\.length\} of these fonts match sounds you already have:/.test(html),
     'matched.length here is the number he could not reconcile with the grid');
  ok('and the list renders the groups, not the raw matches',
     /Array\.from\(groups, \(\[lib, alts\]\) => groupLi\(lib, alts\)\)/.test(html));
  ok('the filter uses the SAME value the body stated',
     /const shown = one \? \[\] : ownedUnique;/.test(html),
     'two independently-derived counts is how one screen contradicts itself');
}

// ── ⚠️⚠️ EVERY CONSUMER OF FILTER STATE, NOT JUST THE GRID ────────────────
//
// His catch, 2026-09-16, off the Effects dropdown: "all the chips have full library
// info". Five things filter entries in this view - the grid, the toggle badge counts,
// and three facet dropdowns - and the name scope had only reached the grid. So Effects
// advertised "font 150, hum 148" over a grid reading 4 of 150.
// ⭐ The name scope belongs everywhere SEARCH belongs, which is all five: both are
// global narrowings, not a facet a dropdown might deliberately self-apply.
// ⚠️ THIS CHANGES COUNTS ONLY. The dropdowns' OPTION lists stay library-wide on
// purpose (their own comment says so) so any effect can still be cycled.
{
  ok('the name scope is one shared predicate', /const _sfInNameScope = \(f\) =>/.test(html));
  const uses = (html.match(/_sfInNameScope/g) || []).length;
  ok('⭐ and every consumer uses it', uses >= 6,
     `found ${uses} mentions - expect the definition plus the grid, the toggle counts ` +
     'and all three dropdown matchSets. A miss here is invisible: the grid looks right ' +
     'and a dropdown quietly describes a population you cannot reach.');
  ok('the grid predicate is an alias, not a second copy',
     /const matchesNameFilter = _sfInNameScope;/.test(html));
  ok('the toggle counts honour it', /matchesSearch\(f\) && _sfInNameScope\(f\)/.test(html));
  const dd = (html.match(/if \(!_sfInNameScope\(f\)\) return false;/g) || []).length;
  ok('all three dropdown matchSets honour it', dd === 3, `${dd} of 3`);
}

// ── the doors that must NOT move ───────────────────────────────────────────
{
  ok('the import-anyway door is untouched [B-363]',
     /id="sf-dupfont-import">Import anyway under a new name<\/button>/.test(html),
     '"don\'t block them. they want to they can." — settled 2026-09-14');
  ok('all three buttons still exist',
     /id="sf-dupfont-open"/.test(html) && /id="sf-dupfont-import"/.test(html)
     && /id="sf-dupfont-cancel"/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall dupfont dialog door tests passed');
process.exit(failures ? 1 : 0);
