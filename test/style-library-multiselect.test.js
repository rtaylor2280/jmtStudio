// Style Library multi-select, as on Sound Fonts: selecting (Ctrl, Shift range, the corner box), the
// toolbar's bulk actions with their counts, a style's own meta lines set in place, and Test / Link on
// the card. [B-582]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };

console.log('1. a style\'s own lines, set in place');
const meta = new Function(`${html.match(/^const _STYLE_META_KEYS = .*$/m)[0]}\n${fn('_setStyleMetaLine')}\nreturn _setStyleMetaLine;`)();
const lib = [
  '/*--------- A ---------*/',
  '// source: Fett263',
  '// url: https://x.com',
  '// notes: first',
  'using A = Layers<Red>;',
  '/*--------- B ---------*/',
  '// creator: Old',
  '// tags: one, two',
  'template<class baseCOLOR = White>',
  'using B = Layers<Blue>;',
  '/*--------- C ---------*/',
  'using C = Layers<Green>;',
  ''].join('\n');
const A = { usingCode: 'using A = Layers<Red>;' }, B = { usingCode: 'using B = Layers<Blue>;' }, C = { usingCode: 'using C = Layers<Green>;' };
let t = meta(lib, A, 'tags', 'x, y');
check('a new tags line goes after url and before notes', /\/\/ url: https:\/\/x\.com\n\/\/ tags: x, y\n\/\/ notes: first/.test(t), t.split('\n').slice(0, 6).join(' / '));
t = meta(lib, A, 'creator', 'Me');
check('a new creator line goes first', /\*\/\n\/\/ creator: Me\n\/\/ source: Fett263/.test(t));
t = meta(lib, B, 'tags', 'three');
check('an existing line is replaced where it is', /\/\/ creator: Old\n\/\/ tags: three\ntemplate</.test(t));
t = meta(lib, B, 'creator', '');
check('an empty value takes the line out', !/creator: Old/.test(t) && /\/\/ tags: one, two\ntemplate</.test(t));
t = meta(lib, C, 'tags', 'solo');
check('a style with no lines gets one right above its using', /C -+\*\/\n\/\/ tags: solo\nusing C =/.test(t), JSON.stringify(t.slice(-60)));
check('taking a line back out gives the file back', meta(meta(lib, C, 'tags', 'solo'), C, 'tags', '') === lib);
check('other styles are untouched', meta(lib, A, 'tags', 'x').split('using A')[1].indexOf('// creator: Old') > -1 && meta(lib, A, 'tags', 'x').endsWith(lib.slice(lib.indexOf('/*--------- B'))));

console.log('2. Shift range');
const range = new Function('cards', `
  const document = { querySelectorAll: () => cards };
  let _stylesSelected = new Set(), _stylesAnchor = null;
  ${fn('_stylesVisibleCards')} ${fn('_stylesShiftSelectTo')}
  return { sel: () => [..._stylesSelected].sort().join(), pick: (n) => { _stylesSelected.add(n); _stylesAnchor = n; }, shift: _stylesShiftSelectTo };`);
const cards = ['a', 'b', 'c', 'd', 'e'].map(n => ({ dataset: { name: n }, style: { display: n === 'c' ? 'none' : '' } }));
{ const r = range(cards); r.pick('a'); r.shift('e'); check('adds the range, skipping hidden cards', r.sel() === 'a,b,d,e', r.sel()); }
{ const r = range(cards); r.shift('d'); check('with nothing selected, selects just that one', r.sel() === 'd'); }

console.log('3. wiring');
check('Ctrl toggles, Shift ranges, a plain click opens', /if \(e\.shiftKey\) \{ _stylesShiftSelectTo\(name\); _syncStylesSelection\(\); return; \}\s*if \(e\.ctrlKey \|\| e\.metaKey\)/.test(html) && /_openStyleDetail\(entry\);/.test(html));
check('the corner box selects without opening', /style-card-select-btn'\)\.addEventListener\('click', e => \{\s*e\.stopPropagation\(\);/.test(html));
check('each bulk button carries its count', ["`Clear selection (${n})`", "`Tags (${n})`", "`Creator (${n})`", '`Segments (${n}) &#9662;`', '`&#10697; Duplicate (${n})`', "`Delete (${n})`", '`Select all (${cards.length})`', '`Select in use (${inUse})`'].every(s => html.includes(s)));
check('each bulk action is one undo step', /function _stylesWriteBulk\(text, label\) \{[\s\S]*?_stylesUndoPush\(label\);/.test(html)
  && ['_stylesBulkTagApply', '_stylesBulkCreatorApply', '_stylesBulkRemoveSegment', '_stylesBulkDuplicate', '_stylesBulkDelete', '_writeSegmentGroups'].every(f => /_stylesWriteBulk\(/.test(fn(f))));
check('Remove lists only what every selected style has as a layer', /const removable = segs\.filter\(s => sel\.every\(e => _removeTopLevelLayer\(e\.usingCode, s\.name\)\)\);/.test(html));
// 2026-10-30: one action, a selection in several cases, each case handled for what it is.
check('adding sorts the selection: has / same / swap / add / built', /out\[r\.nested \? 'built' : r\.swap \? \(r\.same \? 'same' : 'swap'\) : 'add'\]\.push\(step\);/.test(fn('_segmentGroups'))
  && /if \(r\.already\) \{ out\.has\.push\(\{ e \}\); continue; \}/.test(fn('_segmentGroups')));
// 2026-11-04: nothing is gated. Wrappers and charging styles take a segment like any other style.
check('no style is set apart', !html.includes('_segSkipStyle'));
// 2026-11-04: Add is done first and reported; a question only for what is left.
const addFlow = (async () => {
  const run = async (g, answer, fx = ['PowerSave']) => {
    const log = { writes: [], toasts: [], dialogs: [], applied: [] };
    const f = new Function('deps', `const { document, _scanEffects, _stylesSetTag, showToast, promptConfirm, _segmentGroups, _writeSegmentGroups, _applySegmentGroups, _stylesCount, _namesListHtml, _wireMoreNames, _stylesSelectedEntries } = deps;
async ${fn('_stylesBulkAddSegment')}
return _stylesBulkAddSegment;`)({
      document: { querySelectorAll: () => [] }, _scanEffects: () => fx,
      showToast: (t) => log.toasts.push(t),
      promptConfirm: async (o) => { log.dialogs.push(o); return answer; },
      _segmentGroups: () => ({ seg: {}, has: [], same: [], swap: [], add: [], built: [], many: [], position: [], ...g }),
      _writeSegmentGroups: (n, gg, p) => log.writes.push([...p].sort().join()),
      _applySegmentGroups: (n, gg, p) => log.applied.push({ keys: [...p].join(), has: gg.has.length, add: gg.add.length }),
      _stylesSetTag: () => {}, _stylesCount: (n) => `${n} style${n === 1 ? '' : 's'}`,
      _namesListHtml: (names) => names.join('|'),
      _wireMoreNames: () => {}, _stylesSelectedEntries: () => [],
    });
    await f('PS');
    return log;
  };
  const st = (...names) => names.map(name => ({ e: { name } }));
  let r = await run({ add: st('A', 'B') }, true);
  check('only additions: written at once, a toast, no dialog', r.writes[0] === 'add,same' && !r.dialogs.length && r.toasts[0] === 'PS is now used by 2 styles.', JSON.stringify(r));
  r = await run({ add: st('A'), has: st('H') }, true);
  check('some already use it: a toast, and the total counts them', !r.dialogs.length && r.toasts[0] === 'PS is now used by 2 styles.', JSON.stringify(r));
  r = await run({ add: st('A'), same: st('S'), has: st('H'), built: st('W'), swap: st('V') }, 'confirm');
  { const m = r.dialogs[0].messageHtml, at = (t) => m.indexOf(t);
    check('the title is where it ended up', r.dialogs[0].title === 'PS is now used by 3 styles', r.dialogs[0].title);
    check('one table, what was done first, what can be replaced last', m.split('sf-bulk-review-breakdown').length === 2
      && at('Newly added') < at('Identical replacement') && at('Identical replacement') < at('Already using it') && at('Already using it') < at('Built into another layer') && at('Built into another layer') < at('Can be replaced'), m);
    check('what can be replaced gets a sentence, after the table', at('Replacing swaps in PS') > at('>Can be replaced<'), m);
    check('rows that were done carry no names; the rest open and close in the row', !/>H</.test(m) && !/>S</.test(m) && (m.match(/>Show names</g) || []).length === 2 && (m.match(/jmt-names open" hidden/g) || []).length === 2, m);
    check('the link opens and closes the list', /list.hidden = !list.hidden;/.test(fn('_stylesBulkAddSegment')) && /'Show names' : 'Hide names'/.test(fn('_stylesBulkAddSegment'))); }
  r = await run({ add: st('A'), swap: st('V') }, 'alt');
  check('a different version: Close is the default, Replace says what it does', r.writes[0] === 'add,same' && r.dialogs[0].confirmText === 'Close' && r.dialogs[0].confirmKind === 'primary' && r.dialogs[0].hideCancel && r.dialogs[0].altText === 'Replace 1 with PS' && r.dialogs[0].altKind === 'cancel', JSON.stringify(r));
  check('Replace writes only that group', r.applied.length === 1 && r.applied[0].keys === 'swap' && r.applied[0].add === 0 && r.applied[0].has === 0, JSON.stringify(r.applied));
  r = await run({ add: st('A'), swap: st('V') }, 'confirm');
  check('Close leaves it', !r.applied.length && r.writes.length === 1);
  r = await run({ swap: st('V', 'U') }, 'confirm');
  check('nothing used it: the title is Add, and the offer stands', r.dialogs[0].title === "PS wasn't added" && r.dialogs[0].altText === 'Replace 2 with PS' && ['Newly added', 'Identical replacement', 'Already using it'].every(t => r.dialogs[0].messageHtml.includes(t)) && !r.dialogs[0].messageHtml.includes('Built into'), JSON.stringify(r));
  r = await run({ add: st('A'), built: st('B') }, 'confirm');
  check('built into another layer: its own row, no offer', /Built into another layer/.test(r.dialogs[0].messageHtml) && !r.dialogs[0].altText && r.writes[0] === 'add,same', JSON.stringify(r));
  r = await run({ add: st('A'), many: st('M'), position: ['P'] }, 'confirm');
  { const m = r.dialogs[0].messageHtml;
    check('more than one and a different position are rows, with no offer', /More than one/.test(m) && /Different position/.test(m) && !r.dialogs[0].altText, m);
    check('each exception has a Tag with a sentence on hover', (m.match(/>Tag</g) || []).length === 2 && /title="Tag these to fix them later\."/.test(m), m);
    check('each row name says what it means on hover', /<span title="Styles with more than one of the PowerSave effect\./.test(m) && /<span title="Styles that had none of the PowerSave effect\. PS was added/.test(m), m); }
  r = await run({ swap: st('V') }, 'confirm', ['PowerSave', 'Battery', 'Volume']);
  check('several effects: any one of them for what is left out, all of them for what had none', /a different version of the PowerSave, Battery or Volume effect\. Replacing/.test(r.dialogs[0].messageHtml) && /none of the PowerSave, Battery and Volume effects/.test(r.dialogs[0].messageHtml), r.dialogs[0].messageHtml);
  r = await run({ swap: st('V') }, 'confirm', ['Blast']);
  check('any effect uses its own name', /the Blast effect/.test(r.dialogs[0].messageHtml), r.dialogs[0].messageHtml);
  r = await run({ swap: st('V') }, 'confirm', []);
  check('a layer with no known effect says layer', /different version of this layer/.test(r.dialogs[0].messageHtml), r.dialogs[0].messageHtml);
  r = await run({ has: st('H') }, true);
  check('all already use it: a toast with no "now"', !r.dialogs.length && r.toasts[0] === 'PS is already used by 1 style.', JSON.stringify(r));
  { const names = new Function(`${fn('_namesListHtml')}\nreturn _namesListHtml;`)();
    check('nothing shown: the link reads Show names, and every name is there to open', /Show names<\/a>$/.test(names(['A', 'B'], 0)) && (names(['A', 'B'], 0).match(/jmt-name" hidden/g) || []).length === 2);
    check('some shown: and N more', /and 1 more<\/a>$/.test(names(['A', 'B'], 1))); }
})();
check('a swap from another segment names it', /s\.other \? `\$\{s\.e\.name\} \(uses \$\{s\.other\}\)`/.test(fn('_stylesBulkAddSegment')));
check('every "and N more" in the dialog opens', /querySelectorAll\('#modal-confirm-msg \.jmt-more-names'\)\.forEach/.test(fn('_wireMoreNames')));
check('the toast says what happened to each group', /left as they were/.test(fn('_applySegmentGroups')) && /already had it/.test(fn('_applySegmentGroups')));
check('Esc clears and Delete deletes, not while typing or in a window', /if \(e\.key === 'Escape'\) _stylesClearSelection\(\);\s*else _stylesBulkDelete\(\);/.test(html)
  && /if \(document\.querySelector\('\.modal-overlay\.active'\)\) return;/.test(fn('_stylesBulkDelete') + html));
// 2026-11-04: Studio's own tags can't be typed, and look different on a card, in the window and in bulk.
check('every tag Add sets is a reserved one', ['Built into another layer', 'More than one', 'Different position', 'Different version'].every(t => new RegExp(`_STYLE_APP_TAGS = new Set\\(\\[[^\\]]*'${t.toLowerCase()}'`).test(html) && html.includes(`tag: '${t}'`)));
check('they show in the colour on all three surfaces', /style-tag\$\{active\}\$\{_isStyleAppTag\(t\) \? ' app' : ''\}/.test(html) && /_isStyleAppTag\(tag\) \? 'detail-tag-chip app'/.test(html) && /sf-tag-chip\$\{_isStyleAppTag\(t\) \? ' computed' : ''\}/.test(html));
check('typing one is refused in both boxes', (html.match(/if \(_isStyleAppTag\((?:t|val)\)\) showToast/g) || []).length === 2);
// 2026-11-04: the filter reads the card's chips, so a card keeps every effect and draws only those filtered by.
check('a card keeps every effect for the filter', /const effectsHtml = effects\.map\(e => \{/.test(html) && !/effects\.slice\(0, 10\)/.test(html));
check('only the ones filtered by are drawn', /\.style-effect-chip:not\(\.active\) \{ display: none; \}/.test(html) && /\.style-card-effects:not\(:has\(\.style-effect-chip\.active\)\) \{ display: none; \}/.test(html));
check('the bar hides in Code view', /const visual = _stylesViewMode === 'visual';/.test(html) && /_syncStylesBulkBar\(\);   \/\/ the selection's buttons are Visual's/.test(html));
check('Test and Link on the card', /class="sf-card-link style-card-test"/.test(html) && /class="sf-card-link style-card-url"/.test(html) && /_testStyleInEditor\(name\);/.test(html));

{
  const site = new Function('window', `${fn('_creatorWebsite')}\nreturn _creatorWebsite;`)({ _sfGetKnownVendors: () => [{ name: 'JayDalorian', website: 'https://jaydalorian.com/' }] });
  check('the creator\'s website comes from the creators Sound Fonts knows, any case', site('jaydalorian') === 'https://jaydalorian.com/' && site('Nobody') === '' && site('') === '');
  check('and shows beside the creator in the style window', /id="btn-detail-creator-website"/.test(html) && /const site = _creatorWebsite\(v\);/.test(html));
}

console.log('right-click on a selected card');
{
  const menuSrc = fn('_styleCardContextMenu');
  check('right-clicking outside the selection makes the clicked card the selection first',
    /if \(_stylesSelected\.size && !_stylesSelected\.has\(styleName\)\) \{\s*_stylesSelected = new Set\(\[styleName\]\);/.test(menuSrc));
  check('with several selected, Add style segment adds to all of them',
    /const many = _stylesSelected\.size > 1;/.test(menuSrc)
    && /_segmentMenuRows\(_stylesSelectedEntries\(\)\.map\(x => x\.usingCode\), \(segName\) => _stylesBulkAddSegment\(segName\)/.test(menuSrc));
  check('and only what acts on all of them shows: Add to config (n) yes, Replace and Test no',
    /many \? `\+ Add to config \(\$\{_stylesSelected\.size\}\)` : '\+ Add to config'/.test(menuSrc)
    && /many \? _stylesSelectedEntries\(\)\.map\(x => x\.name\) : styleName/.test(menuSrc)
    && /if \(!many\) menu\.appendChild\(repItem\);/.test(menuSrc) && /if \(!many\) \{\s*const testItem = _testStyleMenuItem/.test(menuSrc));
  check('several styles go in as one preset each, in one edit',
    /const b1s = Array\.isArray\(b1Text\) \? b1Text : \[b1Text\];/.test(html) && /const newText = b1s\.map\(\(b1, k\) => \[/.test(html)
    && /names\.map\(_jmtStyleSlotExpr\)/.test(html));
  check('the toolbar\'s actions are on the menu too, counted, Clear selection only with several',
    /item\(`Tags\$\{sfx\}…`, _stylesBulkTagOpen\);/.test(menuSrc) && /item\(`Creator\$\{sfx\}…`, _stylesBulkCreatorOpen\);/.test(menuSrc)
    && /item\(`Duplicate\$\{sfx\}`, _stylesBulkDuplicate\);/.test(menuSrc) && /item\(`× Delete\$\{sfx\}`, _stylesBulkDelete, 'danger'/.test(menuSrc)
    && /if \(many\) item\(`Clear selection \(\$\{n\}\)`, _stylesClearSelection\);/.test(menuSrc));
  check('one card on its own deletes as its × does', /_deleteStyleEntry\(one, false\)/.test(menuSrc));
  const rows = fn('_segmentMenuRows');
  check('a row counts the styles it changes; ticked when none are left',
    /const missing = codes\.filter\(c => !re\.test\(c\)\)\.length;/.test(rows) && /many && missing \? ` \(\$\{missing\}\)` : ''/.test(rows));
}

addFlow.then(() => {
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
}, (e) => { console.error(e); process.exit(1); });
