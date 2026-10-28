// The Style Library has a Creator: written as `// creator:`, read back, filtered by like a font's creator. [B-569]
//
// Runs the real code out of renderer/index.html:
//   · _buildStyleBlock writes `// creator:` first, and nothing when it is blank (an existing entry is unchanged);
//   · _parseStyleMeta reads it back, beside the Source it already read;
//   · the Creators filter: picks OR, left-out AND-NOT, a style with no creator counts as "(no creator)".
'use strict';

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const fn = (name) => {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) return '';
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); }
  }
  return '';
};

console.log('1. the file format');
const build = new Function(fn('_buildStyleBlock') + '\nreturn _buildStyleBlock;')();
const parse = new Function(fn('_parseStyleMeta') + '\nreturn _parseStyleMeta;')();
check('located', !!build && !!parse);
const withCreator = build('AstralProjection', 'Layers<Black>', 'Fett263 LavaLamp (Primary Blade) OS7 Style', ['free'], 'https://example.com', '', 'BVM Sabers');
check('a creator is written first, above source', /\*\/\n\/\/ creator: BVM Sabers\n\/\/ source: Fett263 LavaLamp/.test(withCreator), withCreator);
const gap = withCreator.slice(withCreator.indexOf('*/') + 2, withCreator.indexOf('using '));
const meta = parse(withCreator.slice(1, withCreator.indexOf('*/') + 2), gap);
check('it reads back, with source beside it', meta.userCreator === 'BVM Sabers' && meta.userSource === 'Fett263 LavaLamp (Primary Blade) OS7 Style',
  JSON.stringify(meta));
const without = build('Mine', 'Layers<Black>', 'Fett263', [], '', '');
check('no creator: no creator line, so an existing entry is written as before', !/creator:/.test(without)
  && without === build('Mine', 'Layers<Black>', 'Fett263', [], '', '', ''));
const old = parse('', '\n// source: Fett263\n// tags: a, b\n');
check('an entry written before Creator existed reads with an empty creator', old.userCreator === '' && old.userSource === 'Fett263');

console.log('2. the Creators filter');
const scopeSrc = fn('_styleCreatorKey') + '\n' + fn('_styleInCreatorScope');
const env = new Function(`const _STYLE_NO_CREATOR = '(no creator)';
  let _activeFilterCreators = new Set(), _activeFilterCreatorsMissing = new Set();
  ${scopeSrc}
  return { scope: _styleInCreatorScope, set: (i, o) => { _activeFilterCreators = new Set(i); _activeFilterCreatorsMissing = new Set(o); } };`)();
const cards = [
  { name: 'Astral', dataset: { creator: 'BVM Sabers' } },
  { name: 'Skotos', dataset: { creator: 'Greyscale Fonts' } },
  { name: 'Mine', dataset: { creator: '' } },
];
const pick = () => cards.filter(env.scope).map((c) => c.name).join(',');
env.set([], []);
check('nothing picked: every style', pick() === 'Astral,Skotos,Mine', pick());
env.set(['BVM Sabers', '(no creator)'], []);
check('picked creators OR, and "(no creator)" picks your own', pick() === 'Astral,Mine', pick());
env.set([], ['(no creator)']);
check('leaving out "(no creator)" shows only styles with one', pick() === 'Astral,Skotos', pick());
env.set(['Greyscale Fonts', 'BVM Sabers'], ['BVM Sabers']);
check('a left-out creator removes, even when also picked', pick() === 'Skotos', pick());

console.log('3. wiring');
check('the card carries its creator and shows it', /card\.dataset\.creator = creator;/.test(html) && /style-card-creator/.test(html));
check('the list, the facet counts and the chips all use the creator scope',
  /const matchesTags = _styleInTagScope\(card\) && _styleInCreatorScope\(card\);/.test(html)
  && /if \(own !== 'creator' && !_styleInCreatorScope\(card\)\) return false;/.test(html)
  && /group\('creator', Array\.from\(_activeFilterCreators\)/.test(html)
  && /case 'creator-without': _activeFilterCreatorsMissing\.delete\(v\); break;/.test(html));
check('Clear all clears creators', /_activeFilterCreators = new Set\(\);\s*_activeFilterCreatorsMissing = new Set\(\);/.test(html));
check('the detail panel writes creator first and strips the old line', /if \(_detailCreator\)\s+metaLines\.push\(`\/\/ creator: \$\{_detailCreator\}`\);/.test(html)
  && /\(creator\|source\|tags\|url\|notes\):/.test(html));
check('Creator suggestions share the Sound Fonts list: known vendors, every font creator, then the library',
  /window\._sfGetKnownVendors\?\.\(\) \|\| \[\]\)\.forEach\(v => add\(v\.name\)\)/.test(html)
  && /\(window\._sfEntriesCache \|\| \[\]\)\.forEach\(e => add\(e\?\.meta\?\.author\)\)/.test(html)
  && /fullStyles\.forEach\(e => add\(e\?\.meta\?\.userCreator\)\)/.test(html));
check('Add Style passes the creator to the writer', /_buildStyleBlock\(name, expr, source, tags, url, notes, creator\)/.test(html));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
