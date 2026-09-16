/**
 * The filter bar states the logic the app implements  [B-305], display half
 *
 * ⭐⭐ HIS CATCH, AND IT IS THE HEADLINE: "this implies filtered to all of these...
 * that's the issue." The chip row rendered eight flat chips —
 *     Filtering by: [JMT Sabers][BKSaberSounds][Kyberphonic][bgndrag][bgnlb][blst]...
 * — which reads as ONE conjunction. The real logic is
 *     (JMT Sabers or BKSaberSounds or Kyberphonic) and (bgndrag and bgnlb and blst)
 * Flatten any grouping into one row and it reads as AND no matter what is underneath.
 *
 * ⏭ UPDATED 2026-09-16: [B-382] LANDED WITH THIS, so the file now covers both halves.
 * The split was made on 09-13 and it leaked — GROUPING is independent of the semantics,
 * but the JOINER TEXT is not. "and" printed between two tag chips is a statement about
 * the predicate, so shipping the display half alone left the row truthfully describing
 * logic he had already ruled should change. His call: "two backlog items that address
 * the same area and only one being complete but changes the meaning doesn't seem right."
 *
 * THE JOINERS, read from the predicates rather than assumed:
 *   tags            — OR   [B-382] (measured: 79% of his 44 tags are mutually-exclusive
 *                          bundle names, avg 0.51 tags per entry — AND returned 0)
 *   creators        — OR, and FORCED: meta.author is one string, so ANDing two is zero
 *   effects present — OR   [B-382] (swingh is on 212 of 220, so ANDing filters nothing)
 *   effects absent  — AND-NOT, and it is the one asymmetry: exclusions are conjunctive.
 *                     Confirmed by him 2026-09-16; it was already the built behaviour.
 *
 * ⚠️ THE ENTRY'S "COUPLED REVERT" WAS BACKWARDS AND IS NOT DONE HERE. It said the tag
 * self-apply had to be reverted for OR. Commit 66c8876 had already made every dropdown
 * compute its options with all filters EXCEPT its own dimension, precisely so multi-
 * select works. There was nothing to revert; there is now an assertion that it stays.
 *
 * ALSO HERE: the stale badge. It was written only inside each dropdown's renderer,
 * which runs on OPEN, while filter state also changes from a chip's ✕ and Clear all.
 *
 * Run: node test/filter-chip-grouping.test.js
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

// ── the row, rendered for real ─────────────────────────────────────────────
const render = (counts) => {
  const i = html.indexOf('const _group = (label, chipsHtml, count, joiner)');
  const j = html.indexOf('+ flags + clearAll', i);
  const body = html.slice(i, html.indexOf(';', j) + 1);
  const fn = new Function(
    'searchChip', 'tagChips', 'creatorChips', 'effectChips', 'effectMissingChips',
    'namesChip', 'needsReviewChip', 'newChip', 'inUseChip', 'clearAll', 'searchActive',
    '_sfActiveFilterTags', '_sfActiveFilterCreators', '_sfActiveFilterEffects',
    '_sfActiveFilterEffectsMissing', 'strip',
    body + '; return strip.innerHTML;');
  const chip = (t) => `<span class="styles-active-filter-chip">${t}</span>`;
  const many = (n, p) => Array.from({ length: n }, (_, k) => chip(`${p}${k}`)).join('');
  const strip = { innerHTML: '' };
  return fn(
    counts.search ? chip('"x"') : '',
    many(counts.tags || 0, 't'),
    many(counts.creators || 0, 'c'),
    many(counts.effects || 0, 'e'),
    many(counts.effectsMissing || 0, 'x'),   // [B-382] the absent-effects group
    counts.names ? chip(`${counts.names} you already have`) : '',   // [B-390] scope chip
    counts.needsReview ? chip('Needs review') : '',
    counts.isNew ? chip('New') : '',
    '', '',
    counts.search ? 1 : 0,
    { size: counts.tags || 0 }, { size: counts.creators || 0 },
    { size: counts.effects || 0 }, { size: counts.effectsMissing || 0 },
    strip);
};

{
  const out = render({ tags: 2, creators: 2, effects: 2 });
  ok('each facet gets its own group',
     (out.match(/class="sf-filter-group"/g) || []).length === 3, out);
  ok('the groups are joined by AND',
     (out.match(/class="sf-filter-join">and</g) || []).length === 2, out);

  // ⭐ THE ASSERTION THAT MATTERS: each group's joiner is the one its predicate uses.
  ok('creators say OR', /data-facet="creator"[\s\S]*?data-join="or"/.test(out), out);
  // [B-382] Tags and present effects moved AND -> OR here in the same commit as the
  // predicates. A row stating a joiner its predicate does not use is the bug [B-305]
  // fixed; leaving these as AND would have been that bug pointed the other way.
  ok('tags say OR', /data-facet="tag"[\s\S]*?data-join="or"/.test(out), out);
  ok('present effects say OR', /data-facet="effect"[\s\S]*?data-join="or"/.test(out), out);
}

// The absent-effects group is the one facet that is still AND, and it renders only
// when something is actually excluded.
{
  const out = render({ effects: 2, effectsMissing: 2 });
  ok('a mixed effect filter renders TWO groups',
     /data-facet="effect"/.test(out) && /data-facet="without"/.test(out), out);
  ok('⭐ present says OR and absent says AND, in one row',
     /data-facet="effect"[\s\S]*?data-join="or"/.test(out)
     && /data-facet="without"[\s\S]*?data-join="and"/.test(out), out);
  ok('and they are joined to each other by AND',
     (out.match(/class="sf-filter-join">and</g) || []).length >= 1, out);
}

{
  // A single chip in a facet must not show a dangling joiner — the CSS only draws one
  // between siblings, so this needs no special case in the renderer.
  const out = render({ creators: 1 });
  ok('one group, no AND between groups',
     !/class="sf-filter-join"/.test(out) || /New|Needs/.test(out), out);
  ok('and the group is still labelled', /sf-filter-group-label">creator/.test(out), out);
}

{
  const out = render({ tags: 1, isNew: 1 });
  ok('boolean facets AND with the groups',
     /class="sf-filter-join">and</.test(out), out);
  ok('a facet with nothing in it is not rendered',
     !/data-facet="creator"/.test(out) && !/data-facet="effect"/.test(out), out);
}

{
  ok('an empty row renders nothing but the label',
     !/sf-filter-group/.test(render({})), render({}));
}

// ── the joiners agree with the predicates ──────────────────────────────────
{
  // ⭐ [B-382] EVERY FACET ORs INTERNALLY; FACETS AND TOGETHER. His model, 2026-09-03:
  //     TAGS(a or b) and CREATORS(a or b) and EFFECTS(a or b) and NEW
  // One rule, nothing to learn per control. The single exception is the ABSENT effects
  // set, which is AND-NOT — exclusions are conjunctive, OR is for things you want.
  // ⏭ RETARGETED 2026-09-16. These used to read the grid's own inline predicate bodies.
  // Those bodies are gone: each facet now has exactly ONE definition, and the grid holds
  // an alias. Asserting the old shape would have quietly stopped testing anything.
  const one = (name) => (html.match(new RegExp('const ' + name + ' = ', 'g')) || []).length;

  // ⭐⭐ THE ASSERTION THAT PREVENTS THE RECURRENCE. Tags and present-effects were changed
  // from AND to OR in the grid while the tag / creator / effects dropdowns each kept their
  // own inlined copy, so with three tags ORed the grid showed 7 fonts and every dropdown
  // intersected to ZERO - "why no creators?" and a wall of effects reading 0. Five copies,
  // one changed. A count is the only check that fails when a sixth copy appears.
  ok('⭐⭐ each facet has exactly ONE definition',
     one('_sfInTagScope') === 1 && one('_sfInCreatorScope') === 1
     && one('_sfInEffectScope') === 1 && one('_sfInNameScope') === 1,
     `tag:${one('_sfInTagScope')} creator:${one('_sfInCreatorScope')} ` +
     `effect:${one('_sfInEffectScope')} name:${one('_sfInNameScope')}`);
  ok('and the grid holds aliases, not copies',
     /const matchesTagFilter = _sfInTagScope;/.test(html)
     && /const matchesCreatorFilter = _sfInCreatorScope;/.test(html)
     && /const matchesEffectsFilter = _sfInEffectScope;/.test(html));
  ok('no dropdown owns an inlined tag or effects predicate any more',
     !/for \(const ft of filterTagsLower\) if \(!t\.has\(ft\)\) return false;/.test(html)
     && !/for \(const e of filterEffectsLower\) if \(!effSet\.has\(e\)\) return false;/.test(html),
     'an inlined copy is how this shipped half-done twice');

  const tagPred = html.slice(html.indexOf('const _sfInTagScope'), html.indexOf('const _sfInTagScope') + 400);
  ok('tags are OR',
     /for \(const ft of _sfActiveFilterTags\) if \(t\.has\(String\(ft\)\.toLowerCase\(\)\)\) return true;/.test(tagPred), tagPred);

  const crePred = html.slice(html.indexOf('const _sfInCreatorScope'), html.indexOf('const _sfInCreatorScope') + 500);
  ok('creators are OR, and it is forced', /return lower\.includes\(a\);/.test(crePred), crePred);

  const fxPred = html.slice(html.indexOf('const _sfInEffectScope'), html.indexOf('const _sfInEffectScope') + 800);
  ok('present effects are OR',
     /let anyPresent = false;[\s\S]{0,200}if \(!anyPresent\) return false;/.test(fxPred), fxPred);
  ok('⭐ absent effects are still AND-NOT',
     /for \(const e of _sfActiveFilterEffectsMissing\) if \(eff\.has\(String\(e\)\.toLowerCase\(\)\)\) return false;/.test(fxPred), fxPred);
}

// ── the two effect polarities are two groups  [B-382] ──────────────────────
// One group carrying one joiner cannot describe a mixed set: "swingh or melt and no
// preon" is the same flattening this row exists to stop, one level down.
{
  ok('present and absent effects build separate chip strings',
     /const effectChips = /.test(html) && /const effectMissingChips = /.test(html));
  ok('present effects render as an OR group',
     /_group\('effect',\s+effectChips,\s+_sfActiveFilterEffects\.size,\s+'or'\)/.test(html));
  ok('⭐ absent effects render as their own AND group',
     /_group\('without', effectMissingChips, _sfActiveFilterEffectsMissing\.size, 'and'\)/.test(html));
  ok('tags now render as an OR group',
     /_group\('tag',\s+tagChips,\s+_sfActiveFilterTags\.size,\s+'or'\)/.test(html));
  ok('…and no group still claims tags are AND',
     !/_group\('tag',[^)]*'and'\)/.test(html));
}

// ── the tag dropdown must NOT narrow its own option list  [B-382] ──────────
// ⚠️ THE ENTRY SAID THIS NEEDED REVERTING AND THAT WAS BACKWARDS. Commit 66c8876
// ("filter dropdowns no longer self-collapse on selection") deliberately made each
// dropdown compute its options with every active filter EXCEPT its own dimension,
// so multi-select is possible at all. A widening OR filter depends on that, so this
// asserts it stays rather than being "restored".
{
  const tagDd = html.slice(html.indexOf('const _sfRenderTagDropdown'),
                           html.indexOf('const _sfRenderTagDropdown') + 2000);
  ok('⭐ the tag dropdown does not apply the tag filter to its own options',
     !/filterTagsLower/.test(tagDd),
     'if tags narrow their own list, picking one hides the others and OR is unreachable');
}

// ── the stale badge ────────────────────────────────────────────────────────
{
  ok('badge state has one writer', /const _sfSyncFilterBadges = \(\) => \{/.test(html));
  ok('and the grid drives it', /_sfSyncFilterBadges\(\);/.test(html));
  ok('it runs before the grid can return early',
     html.indexOf('_sfSyncFilterBadges();') < html.indexOf("if (!list) return;\r\n        const q = (_sfSearchQuery")
     || /_sfSyncFilterBadges\(\);\r?\n\s*if \(!list\) return;/.test(html),
     'the badges are about filter state, not about whether the grid exists');
  ok('the helper is defined before its caller',
     html.indexOf('const _sfSyncFilterBadges') < html.indexOf('const _sfRenderGrid'),
     'a const used before its declaration executes is a TDZ throw waiting for a reorder');
  ok('it covers both dropdown buttons',
     /sf-creator-filter-badge/.test(html) && /sf-effects-filter-badge/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall filter chip grouping tests passed');
process.exit(failures ? 1 : 0);
