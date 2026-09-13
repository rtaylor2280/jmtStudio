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
 * ⚠️ THIS IS THE HALF THAT NEEDS NO BEHAVIOUR CHANGE, as the entry says. The semantics
 * ruling (tags → OR, effects → OR, with the tag self-apply reverted) is a separate,
 * coupled change and is NOT done here — so the row states what the predicates actually
 * do today, not what they are slated to do. A row that announces a joiner the code does
 * not implement is this exact bug pointed the other way.
 *
 * THE JOINERS, read from the predicates rather than assumed:
 *   tags     — AND (matchesTagFilter requires EVERY selected tag)
 *   creators — OR, and FORCED: meta.author is one string, so ANDing two is always zero
 *   effects  — AND (present must all be there; absent must all be gone)
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
    'searchChip', 'tagChips', 'creatorChips', 'effectChips',
    'needsReviewChip', 'newChip', 'inUseChip', 'clearAll', 'searchActive',
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
    counts.needsReview ? chip('Needs review') : '',
    counts.isNew ? chip('New') : '',
    '', '',
    counts.search ? 1 : 0,
    { size: counts.tags || 0 }, { size: counts.creators || 0 },
    { size: counts.effects || 0 }, { size: 0 },
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
  ok('tags say AND (what matchesTagFilter does today)',
     /data-facet="tag"[\s\S]*?data-join="and"/.test(out), out);
  ok('effects say AND (what matchesEffectsFilter does today)',
     /data-facet="effect"[\s\S]*?data-join="and"/.test(out), out);
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
  const tagPred = html.slice(html.indexOf('const matchesTagFilter'), html.indexOf('const matchesTagFilter') + 400);
  ok('matchesTagFilter really is AND',
     /for \(const t of filterTagsLower\) if \(!entryTags\.has\(t\)\) return false;/.test(tagPred), tagPred);

  const creatorPred = html.slice(html.indexOf('const matchesCreatorFilter'), html.indexOf('const matchesCreatorFilter') + 400);
  ok('matchesCreatorFilter really is OR',
     /return filterCreatorsLower\.includes\(a\);/.test(creatorPred), creatorPred);

  const fxPred = html.slice(html.indexOf('const matchesEffectsFilter'), html.indexOf('const matchesEffectsFilter') + 700);
  ok('matchesEffectsFilter really is AND',
     /for \(const e of filterEffectsLower\) if \(!effSet\.has\(e\)\) return false;/.test(fxPred), fxPred);
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
