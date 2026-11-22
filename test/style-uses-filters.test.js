// Style Library: filter by the helpers and segments a style uses (has / without), Name A-Z by default,
// and dragging only in File order. [B-177]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };

console.log('1. has and without');
const scope = new Function(`${fn('_styleNames')}\n${fn('_styleInNamesScope')}\nreturn { _styleNames, _styleInNamesScope };`)();
const card = (segments) => ({ dataset: { segments: segments.join('\n') } });
const cards = { A: card(['PowerSave25', 'VolumePercentBlade']), B: card(['VolumePercentBlade']), C: card([]) };
const pick = (on, off) => Object.keys(cards).filter(k => scope._styleInNamesScope(cards[k], 'segments', new Set(on), new Set(off))).join();
check('nothing picked: every style', pick([], []) === 'A,B,C', pick([], []));
check('has: styles that use it', pick(['VolumePercentBlade'], []) === 'A,B', pick(['VolumePercentBlade'], []));
check('has two: either one (OR)', pick(['PowerSave25', 'VolumePercentBlade'], []) === 'A,B');
check('without: styles that do not use it', pick([], ['PowerSave25']) === 'B,C', pick([], ['PowerSave25']));
check('has and without together', pick(['VolumePercentBlade'], ['PowerSave25']) === 'B');
check('a style with none reads as none', scope._styleNames(cards.C, 'segments').length === 0);

console.log('2. wiring');
check('both facets exist, each with has and without', /const _helperFacet = _styleFacetDropdown/.test(html) && /const _segmentFacet = _styleFacetDropdown/.test(html)
  && /on: \(\) => _activeFilterHelpers, off: \(\) => _activeFilterHelpersMissing/.test(html)
  && /on: \(\) => _activeFilterSegments, off: \(\) => _activeFilterSegmentsMissing/.test(html));
check('the list and the facet counts use both scopes', /_styleInHelperScope\(card\) && _styleInSegmentScope\(card\)/.test(html)
  && /own !== 'helper' && !_styleInHelperScope/.test(html) && /own !== 'segment' && !_styleInSegmentScope/.test(html));
check('cards carry what they use', /card\.dataset\.helpers  = /.test(html) && /card\.dataset\.segments = /.test(html));
check('chips for both, and each removes', /group\('helper',/.test(html) && /group\('segment',/.test(html)
  && /case 'helper-without':/.test(html) && /case 'segment-without':/.test(html));
check('Clear all clears both', /function _stylesClearAllFilters[\s\S]*?_activeFilterHelpersMissing = new Set\(\);[\s\S]*?_activeFilterSegmentsMissing = new Set\(\);[\s\S]*?_applyStylesSearch/.test(html));

console.log('3. sort and drag');
check('Name A-Z is the default', /let _stylesSort = \{ key: 'name', dir: 'asc' \};/.test(html));
check('a card drags only in File order read top down', /const canDrag = _stylesSort\.key === 'file' && _stylesSort\.dir === 'asc';/.test(html) && /card\.draggable = canDrag;/.test(html)
  && /if \(!canDrag \|\| e\.target\.classList\.contains\('card-delete-btn'\)\)/.test(html));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
