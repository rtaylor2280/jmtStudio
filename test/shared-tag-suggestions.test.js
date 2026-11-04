// One tag list for both libraries: Style Library and Sound Fonts suggest the same tags and spell a
// typed one the same way, so one tag does not get two names by accident. [B-177]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };

const lists = {};
const window = {
  _sfEntriesCache: [{ meta: { tags: ['Darth Vader', 'customized'] } }, { meta: { tags: ['Sith'] } }],
  _styleTagLists: [['sith', 'Rotoscope'], ['darth vader']],
};
const document = { getElementById: (id) => (lists[id] ||= { innerHTML: '' }) };
const api = new Function('window', 'document', `
  const JMT_TAG_SUGGESTION_LISTS = ['sf-all-tags-datalist', 'style-all-tags-datalist'];
  ${fn('_tagSpellingMap')} ${fn('_canonicalTagSpelling')} ${fn('_sharedTagSpellings')} ${fn('_refreshSharedTagDatalists')}
  return { _sharedTagSpellings, _refreshSharedTagDatalists, _canonicalTagSpelling };`)(window, document);

console.log('1. one list');
const m = api._sharedTagSpellings();
check('both libraries\' tags, one row each', [...m.values()].sort().join() === 'Darth Vader,Rotoscope,Sith', [...m.values()].join());
check('Sound Fonts\' spelling wins over the Style Library\'s', m.get('darth vader') === 'Darth Vader' && m.get('sith') === 'Sith');
check('"customized" is never offered', !m.has('customized'));
check('a Sound Fonts list passed in is used over the cache', [...api._sharedTagSpellings([{ meta: { tags: ['Ahsoka'] } }]).values()].includes('Ahsoka'));
api._refreshSharedTagDatalists();
check('both datalists get the same options', lists['sf-all-tags-datalist'].innerHTML === lists['style-all-tags-datalist'].innerHTML
  && /Rotoscope/.test(lists['sf-all-tags-datalist'].innerHTML) && /Darth Vader/.test(lists['style-all-tags-datalist'].innerHTML));
check('a tag typed in styles takes the Sound Fonts spelling', api._canonicalTagSpelling(m, 'DARTH VADER') === 'Darth Vader');

console.log('2. wiring');
check('the Style Library tag box spells through the shared list', /_canonicalTagSpelling\(_sharedTagSpellings\(\), e\.target\.value\)/.test(html));
check('the Style Library publishes its tags and refreshes both', /window\._styleTagLists = fullStyles\.map\(e => e\?\.meta\?\.userTags\);\s*_refreshSharedTagDatalists\(\);/.test(html));
check('Sound Fonts spells and suggests through the shared list', /const _sfLibraryTagSpellings = \(\) => _sharedTagSpellings\(_sfAllEntries\);/.test(html)
  && /const _sfRefreshTagsDatalist = \(\) => _refreshSharedTagDatalists\(_sfAllEntries\);/.test(html));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
