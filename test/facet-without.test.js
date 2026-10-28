// Tags and Creators have WITHOUT, as Effects does: right-click a row to leave out the fonts that have it.
// [B-564]
//
//   1. The predicates, run: picked values OR, WITHOUT values AND-NOT, (no creator) works both ways.
//   2. Wiring: right-click rows, red x rows, WITHOUT chips, the chip x clears either, counts and Clear all.
'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

console.log('1. the predicates');
const at = html.indexOf('const _sfFacetRowState = (isIn, isOut, noun) => {');
const end = html.indexOf('// PRESENT effects OR; ABSENT effects AND-NOT.', at);
const src = at > -1 && end > at ? html.slice(at, end) : '';
check('located', src.length > 600, 're-anchor: an empty slice runs nothing');
const env = new Function('_sfEntryAllTags', '_sfEscape', '_SF_NO_CREATOR_KEY',
  `let _sfActiveFilterTags = new Set(), _sfActiveFilterTagsWithout = new Set();
   let _sfActiveFilterCreators = new Set(), _sfActiveFilterCreatorsWithout = new Set();
   ${src}
   return { tag: _sfInTagScope, creator: _sfInCreatorScope, row: _sfFacetRowState,
     set: (k, v) => { ({ tags: () => { _sfActiveFilterTags = new Set(v); }, tagsOut: () => { _sfActiveFilterTagsWithout = new Set(v); },
       cre: () => { _sfActiveFilterCreators = new Set(v); }, creOut: () => { _sfActiveFilterCreatorsWithout = new Set(v); } })[k](); } };`)(
  (f) => f.tags || [], (x) => String(x), '(no creator)');

const fonts = [
  { name: 'Rey-Flex', tags: ['Rey'], meta: { author: 'BKSaberSounds' } },
  { name: 'Analog', tags: ['free'], meta: { author: 'Greyscale Fonts' } },
  { name: 'Ben', tags: ['Obi-Wan', 'Kenobi'], meta: { author: 'Kyberphonic' } },
  { name: 'Loose', tags: [], meta: {} },
];
const names = (pred) => fonts.filter(pred).map((f) => f.name).join(',');
env.set('creOut', ['greyscale fonts']);
check('without a creator leaves its fonts out (any case)', names(env.creator) === 'Rey-Flex,Ben,Loose', names(env.creator));
env.set('cre', ['Kyberphonic', 'BKSaberSounds']); env.set('creOut', ['Kyberphonic']);
check('picked creators OR, then WITHOUT removes', names(env.creator) === 'Rey-Flex', names(env.creator));
env.set('cre', []); env.set('creOut', ['(no creator)']);
check('without (no creator) leaves out fonts with no creator', names(env.creator) === 'Rey-Flex,Analog,Ben', names(env.creator));
env.set('creOut', []);
env.set('tagsOut', ['free']);
check('without a tag leaves its fonts out', names(env.tag) === 'Rey-Flex,Ben,Loose', names(env.tag));
env.set('tags', ['kenobi', 'rey']); env.set('tagsOut', ['obi-wan']);
check('picked tags OR, then WITHOUT removes (any case)', names(env.tag) === 'Rey-Flex', names(env.tag));
env.set('tags', []); env.set('tagsOut', []);
check('nothing set: everything', names(env.tag) === 'Rey-Flex,Analog,Ben,Loose' && names(env.creator) === 'Rey-Flex,Analog,Ben,Loose');
const out = env.row(false, true, 'creator');
check('a WITHOUT row has the Effects absent class, a red x, and a two-click hover',
  out.cls === ' selected sf-effect-state-absent' && out.mark === '&#10005;' && /Right click: filter for fonts without this creator\./.test(out.tip), JSON.stringify(out));

console.log('2. wiring');
check('right-click on a tag row and a creator row sets WITHOUT',
  /_sfTagDropdown\?\.addEventListener\('contextmenu'[\s\S]{0,300}_sfRightToggleFilterTag\(item\.dataset\.tag\)/.test(html)
  && /_sfCreatorDropdown\?\.addEventListener\('contextmenu'[\s\S]{0,300}_sfRightToggleFilterCreator\(item\.dataset\.creator\)/.test(html));
check('setting one polarity clears the other', /if \(!_sfDropCI\(own, value\)\) \{ _sfDropCI\(other, value\); own\.add\(value\); \}/.test(html));
check('WITHOUT chips, red, in a without group after their facet',
  /_group\('tag',[^\n]*\n[^\n]*\n\s*_group\('without', tagWithoutChips/.test(html)
  && /_group\('creator',[^\n]*\n\s*_group\('without', creatorWithoutChips/.test(html)
  && /tagWithoutChips = [\s\S]{0,120}sf-active-filter-effect-missing/.test(html));
check("a chip's x clears either polarity", /if \(tag\) _sfRemoveTagFilter\(tag\);/.test(html) && /if \(c\) _sfRemoveCreatorFilter\(c\);/.test(html));
check('counted in the strip, the badges and isFiltering, and cleared by Clear all',
  /_sfActiveFilterTagsWithout\.size \+ _sfActiveFilterCreatorsWithout\.size \+/.test(html)
  && /_sfActiveFilterCreators\.size \+ _sfActiveFilterCreatorsWithout\.size\],/.test(html)
  && /const _tagN = _sfActiveFilterTags\.size \+ _sfActiveFilterTagsWithout\.size;/.test(html)
  && /_sfActiveFilterTagsWithout\.size > 0 \|\| _sfActiveFilterCreatorsWithout\.size > 0 \|\|/.test(html)
  && /_sfActiveFilterTagsWithout = new Set\(\);\s*_sfActiveFilterCreatorsWithout = new Set\(\);\s*_sfActiveFilterEffects = new Set\(\);\s*_sfActiveFilterEffectsMissing = new Set\(\);\s*_sfActiveFilterNames/.test(html));

console.log('3. Style Library tags');
{
  const a = html.indexOf('function _styleHas(card, sel, attr, value) {');
  const b = html.indexOf('function _styleInEffectScope(card) {', a);
  const ssrc = a > -1 && b > a ? html.slice(a, b) : '';
  check('located', ssrc.length > 300, 're-anchor: an empty slice runs nothing');
  const card = (name, tags) => ({ name, querySelector: (q) => (tags.some((t) => q.includes(`"${t}"`)) ? {} : null) });
  const cards = [card('Rage', ['Sith', 'Red']), card('Calm', ['Jedi']), card('Plain', [])];
  const env2 = new Function('CSS', `let _activeFilterTags = new Set(), _activeFilterTagsMissing = new Set();
    ${ssrc}
    return { scope: _styleInTagScope, set: (i, o) => { _activeFilterTags = new Set(i); _activeFilterTagsMissing = new Set(o); } };`)(
    { escape: (x) => x });
  const pick = () => cards.filter(env2.scope).map((c) => c.name).join(',');
  env2.set([], ['Sith']);
  check('a left-out tag leaves its styles out', pick() === 'Calm,Plain', pick());
  env2.set(['Sith', 'Jedi'], ['Red']);
  check('picked tags OR, then the left-out one removes', pick() === 'Calm', pick());
  check('right-click on a tag row leaves it out; the row shows the red x; a without group; the chip x and Clear all clear it',
    // The Style Library's facets share one dropdown [B-569]: a right-click flips the left-out set, and a row
    // shows the red x from it. Tags hands it _activeFilterTags / _activeFilterTagsMissing.
    /btn\.addEventListener\('contextmenu', e => \{ e\.preventDefault\(\); e\.stopPropagation\(\); flip\(value, off\(\), on\(\)\); \}\);/.test(html)
    && /const absent  = off\(\)\.has\(value\);/.test(html)
    && /const _tagFacet = _styleFacetDropdown\(\{[\s\S]{0,300}on: \(\) => _activeFilterTags, off: \(\) => _activeFilterTagsMissing,/.test(html)
    && /group\('without', Array\.from\(_activeFilterTagsMissing\)/.test(html)
    && /case 'tag-without': _activeFilterTagsMissing\.delete\(v\); break;/.test(html)
    && /_activeFilterTags    = new Set\(\);\s*_activeFilterTagsMissing = new Set\(\);/.test(html));
}

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
