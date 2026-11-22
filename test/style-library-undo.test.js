// Style Library Visual view undo, a step per action: each change pushes the library as it was with
// what it did, the buttons say so, Code view's edits come back as one step, and a new library starts
// clean. [B-177]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };

const mk = () => new Function(`
  let text = 'A';
  const btn = () => ({ disabled: false, title: '' });
  const els = { 'btn-styles-undo': btn(), 'btn-styles-redo': btn() };
  const document = { getElementById: (id) => els[id] };
  let _stylesViewMode = 'visual', writes = 0, rebuilds = 0, closes = 0;
  const _stylesEditorInstance = { getValue: () => text, setValue: (v) => { text = v; } };
  const _stylesChanged = () => { writes++; };
  const _buildStylesVisual = () => { rebuilds++; };
  const _closeHelperEditor = () => { closes++; };
  let _styleReorderUndoStack = [], _styleReorderRedoStack = [], _stylesCodeViewBase = null;
  ${fn('_stylesUndoPush')}
  ${fn('_stylesUndoReset')}
  ${fn('_stylesUndoStep')}
  ${fn('_syncStylesUndoButtons')}
  const act = (label, next) => { _stylesUndoPush(label); text = next; };
  return { act, undo: () => _stylesUndoStep(false), redo: () => _stylesUndoStep(true), reset: _stylesUndoReset,
    sync: _syncStylesUndoButtons, text: () => text, set: (v) => { text = v; }, els, mode: (m) => { _stylesViewMode = m; },
    stats: () => ({ writes, rebuilds, closes }), stacks: () => [_styleReorderUndoStack.length, _styleReorderRedoStack.length] };`)();

console.log('1. a step per action');
{
  const u = mk();
  check('nothing to undo at first: the button is off and says so', (u.sync(), u.els['btn-styles-undo'].disabled && u.els['btn-styles-undo'].title === 'Nothing to undo'));
  u.act('add Absorbed', 'AB');
  u.act('edit VolumePercentBlade and update 72 styles', 'ABC');
  check('the tip names the last action', u.els['btn-styles-undo'].title === 'Undo: edit VolumePercentBlade and update 72 styles (Ctrl+Z)', u.els['btn-styles-undo'].title);
  check('undo takes back one action', u.undo() && u.text() === 'AB');
  check('then the one before', u.undo() && u.text() === 'A');
  check('and stops there', !u.undo() && u.text() === 'A');
  check('redo names what it puts back', u.els['btn-styles-redo'].title === 'Redo: add Absorbed (Ctrl+Y)', u.els['btn-styles-redo'].title);
  check('redo puts them back in order', u.redo() && u.text() === 'AB' && u.redo() && u.text() === 'ABC');
  check('each step is written and redrawn', u.stats().writes === 4 && u.stats().rebuilds === 4, JSON.stringify(u.stats()));
  u.undo();
  u.act('delete Absorbed', 'X');
  check('a new action clears redo', u.stacks()[1] === 0 && u.els['btn-styles-redo'].disabled);
}
console.log('2. steps that changed nothing are skipped');
{
  const u = mk();
  u.act('move Absorbed', 'AB');
  u.act('edit Absorbed', 'AB');
  check('one undo goes back past the no-op', u.undo() && u.text() === 'A');
}
console.log('3. Code view');
{
  const u = mk();
  u.mode('code'); u.sync();
  check('in Code view the buttons are Monaco\'s', !u.els['btn-styles-undo'].disabled && u.els['btn-styles-undo'].title === 'Undo (Ctrl+Z)');
  const sw = fn('_switchStylesView');
  check('entering Code view records the library', /if \(showCode\) _stylesCodeViewBase = _stylesEditorInstance\?\.getValue\(\) \?\? null;/.test(sw));
  check('leaving it with changes pushes one step for them', /_styleReorderUndoStack\.push\(\{ text: _stylesCodeViewBase, label: 'edits in Code view' \}\);/.test(sw));
  check('the buttons show in both views', /btn-styles-undo'\)\.style\.display\s*= '';/.test(sw) && /btn-styles-redo'\)\.style\.display\s*= '';/.test(sw));
  check('the buttons route by view', /if \(_stylesViewMode === 'visual'\) _stylesUndoStep\(false\);\s*else _stylesEditorInstance\?\.trigger\('keyboard', 'undo', null\);/.test(html));
}
console.log('4. a new library starts clean');
{
  const u = mk();
  u.act('add Absorbed', 'AB');
  u.reset();
  check('reset empties both stacks', u.stacks().join() === '0,0' && u.els['btn-styles-undo'].disabled);
  check('import and remove reset it', (html.match(/_stylesUndoReset\(\);/g) || []).length === 2);
}
console.log('5. every Visual action pushes');
{
  const labels = ['`use ${segName} in', '`delete ${entry.name}`', '`move ${fullStyles', '`add ${segName} to ${styleName}`', '`add ${newName}`',
    '`rename ${_helperEditorOrigName} to ${targetName}`', '`save ${copyName}`', '`edit ${targetName}`', '`edit ${newName}`', '`add ${name}`', "'append a file'"];
  check('eleven actions, each named', labels.every(l => html.includes(`_stylesUndoPush(${l}`) || (l === '`edit ${targetName}`' && html.includes(': `edit ${targetName}`);'))),
    labels.filter(l => !html.includes(`_stylesUndoPush(${l}`)).join(' | '));
  check('no old bare pushes left', !/_styleReorderUndoStack\.push\(_stylesEditorInstance\.getValue\(\)\)|_styleReorderUndoStack\.push\(content\)|_styleReorderUndoStack\.push\(text\)/.test(html));
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
