// Style Blocks panel: right-click a helper or a segment for Show styles, Replace instances, Expand,
// Duplicate and Delete; a helper's name follows its code's `using` line; the card's delete × has room. [B-177]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };

console.log('1. the right-click menu, on a helper or a segment');
check('the row opens the menu on right-click', /row\.addEventListener\('contextmenu', e => _styleBlockContextMenu\(e, entry\)\);/.test(html));
const menu = fn('_styleBlockContextMenu');
check('helpers get it too', !/if \(!entry\.isSegment\) return;/.test(menu));
check('in order: Show styles, Replace identical (segments), Expand, Duplicate, Delete…', (() => {
  const at = ['`Show styles (${shown})`', '`Replace identical (${n})`', "item('Expand'", "item('Duplicate'", "item('Delete…'"].map(l => menu.indexOf(l));
  return at.every(i => i > 0) && at.every((i, k) => !k || i > at[k - 1]);
})());
check('Replace identical is a segment\'s only', /if \(entry\.isSegment\) \{\s*const n = _stylesEditorInstance \? _segmentGroupsInLibrary\(entry\.name\)\.same\.length/.test(menu));
check('greyed when there is nothing to show or replace', /_showStylesUsingBlock\(entry\.name, kind\), !shown\);/.test(menu) && /_replaceSegmentInLibrary\(entry\.name\), !n\);/.test(menu));
check('Delete asks as the row\'s × does', /_deleteStyleEntry\(entry, true\)/.test(menu));
check('Replace identical replaces exact copies only, with no question', /_writeSegmentGroups\(segName, g, new Set\(\['same'\]\)\);/.test(fn('_replaceSegmentInLibrary'))
  && !/promptConfirm/.test(fn('_replaceSegmentInLibrary')) && /!e\.isHelper && !e\.isSegment/.test(fn('_segmentGroupsInLibrary')));
check('the old question is gone', !html.includes('_askSegmentGroups') && !html.includes('_segmentInstanceCount'));
{
  // Run: Show styles clears every filter, then picks this block in its own dropdown.
  const log = [];
  const state = { seg: new Set(['Old']), hel: new Set() };
  const show = new Function('_stylesClearAllFilters', '_applyStylesSearch', '_refreshOpenFacetDropdowns', 'state',
    `let _activeFilterSegments = state.seg, _activeFilterHelpers = state.hel;
     const _clear = () => { _activeFilterSegments = state.seg = new Set(); _activeFilterHelpers = state.hel = new Set(); };
     ${fn('_showStylesUsingBlock').replace('_stylesClearAllFilters();', '_stylesClearAllFilters(); _clear();')}
     return (n, k) => { _showStylesUsingBlock(n, k); return state; };`)(
    () => log.push('clear'), () => log.push('apply'), () => log.push('dropdowns'), state);
  const r = show('VolumePercentBlade', 'segments');
  check('Show styles clears first, then filters to the segment', log.join() === 'clear,apply,dropdowns' && [...r.seg].join() === 'VolumePercentBlade' && !r.hel.size, log.join());
  const r2 = show('Helper1', 'helpers');
  check('and a helper in the Helpers filter', [...r2.hel].join() === 'Helper1' && !r2.seg.size);
}

console.log('2. a helper\'s name and its code agree');
check('the code\'s using name always reaches the box, pencil or not', /\/\/ The name follows the code's `using` line always, pencil or not[\s\S]{0,200}_syncEditorNameToInput\(\);/.test(html));
check('and the shown name when editing', /if \(shown && _helperEditorMode === 'edit'\) shown\.textContent = m\[1\];/.test(fn('_syncEditorNameToInput')));
check('a rename made in the code is checked like one made in the box', /_helperEditorMode === 'add' \|\| !nameInput\.readOnly \|\| \(name && name !== _helperEditorOrigName\)/.test(html));
check('Esc mid-rename puts the code\'s name back too', /e\.target\.value = _helperEditorOrigName;\s*_syncHelperNameToEditor\(_helperEditorOrigName\);/.test(html));
check('clicking away mid-rename keeps the name', /if \(!e\.target\.classList\.contains\('invalid'\)\) _exitHelperPencilMode\(\);\s*\}\);/.test(html));
check('Enter mid-rename sets the name', /if \(_helperEditorMode === 'edit'\) \{\s*if \(!e\.target\.classList\.contains\('invalid'\)\) _exitHelperPencilMode\(\);\s*return;/.test(html));
// 2026-11-04: the using line can't be lost: the check the style window has, on a block in the panel.
check('a block without its using line shows the message and can\'t be saved', /const usingLost = _helperEditorMode === 'edit' && !!trimmed && !!_statementError\(code\)\?\.unreadable;/.test(html)
  && /saveBtn\.disabled = !!nameError \|\| !!bracketErr \|\| usingLost \|\| !dirty;/.test(html) && /must be written as/.test(html) && html.includes('id="helper-using-error"'));
{
  // Run: both ways a block stops being one, read by the same check the style window uses.
  const find = new Function(`${html.match(/^const _stripComments = .*$/m)[0]}\n${fn('_splitTemplatePrefix')}\n${fn('_findBracketError')}\n${fn('_statementError')}\nreturn _statementError;`)();
  check('no using line is caught', !!find('EffectSequence<A,B>;')?.unreadable);
  check('no closing ; is caught', !!find('using X = EffectSequence<A,B>\n/*---*/\n')?.unreadable, JSON.stringify(find('using X = EffectSequence<A,B>')));
  check('a whole block is fine', !find('using X = EffectSequence<A,B>;'));
  check('so is one with a template line', !find('template<class C = Blue>\nusing X = EffectSequence<A,C>;'));
}
check('the panel names a bracket error the way the style window does', /_bracketErrorContext\(compactErr, bracketErr\)/.test(html) && /const \{ ctx, hint \} = _bracketErrorContext\(compact, err\);/.test(html));
check('a rename lists its styles in the shared dialog, so its buttons stay on screen', /_namesListHtml\(names, 10, true\)/.test(fn('_showHelperRenameDialog')) && !html.includes('modal-rename-helper'));
check('a style\'s name, creator and source, and a block\'s name, open on click as their pencils do',
  ["['style-detail-name', 'btn-detail-name-edit']", "['detail-creator-display', 'btn-detail-creator-edit']", "['detail-source-display', 'btn-detail-source-edit']", "['helper-name-display', 'btn-helper-pencil']"].every(p => html.includes(p)));
check('any dialog taller than the window scrolls', /\.modal-overlay \{[^}]*align-items: safe center;\s*overflow-y: auto;/.test(html));
check('on save the using line takes the heading\'s name', /if \(targetName\) compacted = compacted\.replace\(\/\^\(\\s\*using\\s\+\)\\w\+\/, `\$1\$\{targetName\}`\);/.test(html));
{
  const build = new Function('_wrapSegmentLayers', `${fn('_buildHelperBlock')}\nreturn _buildHelperBlock;`)((c) => c);
  const b = build('VolumePercentBlade', '', '', 'using VolumePercentBlade = X;', false, true);
  check('a saved segment\'s block has its full name in the heading and no position line', / VolumePercentBlade -+\n/.test(b) && !/position:/.test(b), b);
}

console.log('3. the delete × has room');
check('style and font cards keep 10px clear on the right of the name row',
  /\.style-card-top \{[^}]*padding-right: 10px;/.test(html) && /\.sf-card-name-row \{[^}]*padding-right: 10px;/.test(html));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
