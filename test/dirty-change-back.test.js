// A config changed and changed back is clean again; a non-text change stays dirty until saved. [B-572]
//
// Runs the real setDirty and _editorMatchesClean out of renderer/index.html against a fake editor:
//   · open, type, type it back: clean; Save greys out again;
//   · undo all the way back: clean;
//   · a meta-field change (setDirty(true) from outside the editor), then a text edit and its reverse:
//     still dirty, since only the text was put back;
//   · after a save, the saved text is the new clean point.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const start = html.indexOf('let _cleanText = null;');
const end = html.indexOf('\n}\n', html.indexOf('function setDirty(')) + 3;
const src = html.slice(start, end);
check('the code under test was found', start > 0 && end > start && /function setDirty\(v, fromText = false\)/.test(src));

const listener = /editor\.onDidChangeModelContent\(\(\) => \{\s*if \(fileIsOpen\) \{\s*setDirty\(_dirtyOutsideText \|\| !_editorMatchesClean\(\), true\);/.test(html);
check('the editor listener marks dirty only when the text differs from the clean text', listener);

// A text edit the app makes (_atomicEdit) is dirty through the editor listener, so it can be put back too.
// Marking dirty again right after one would make it stick.
const sticky = [...html.matchAll(/_atomicEdit\(editor, '([^']+)'[\s\S]{0,400}?\);[ \t]*\n([^\n]*)/g)]
  .filter((m) => /setDirty\(true\)/.test(m[2])).map((m) => m[1]);
check('no app text edit marks dirty on its own', sticky.length === 0, sticky.join(', '));
check('the edits this covers are found', ['font-rename', 'shared-folder-rename', 'mount-sd-setting-insert']
  .every((k) => html.includes(`_atomicEdit(editor, '${k}'`)));

let text = '';
const saveBtn = { disabled: false };
const ctx = {
  editor: { getValue: () => text, getModel: () => ({ getValue: () => text, getValueLength: () => text.length }) },
  currentFilePath: 'C:/x/config.h',
  document: { getElementById: (id) => (id === 'btn-save' ? saveBtn : { classList: { toggle() {} } }) },
  updateWindowTitle() {},
};
vm.createContext(ctx);
vm.runInContext(src + '\nthis.setDirty = setDirty; this.match = _editorMatchesClean; this.outside = () => _dirtyOutsideText; this.dirty = () => isDirty;', ctx);
// Stands in for the editor listener, which is the line asserted above.
const edit = (t) => { text = t; ctx.setDirty(ctx.outside() || !ctx.match(), true); };
vm.runInContext('var isDirty = false;', ctx);

text = 'abc';
ctx.setDirty(false);
edit('abcd');
check('a text edit is dirty', ctx.dirty() === true && saveBtn.disabled === false);
edit('abc');
check('typed back to the opened text: clean, Save greyed out', ctx.dirty() === false && saveBtn.disabled === true);
edit('ab'); edit('a'); edit('ab'); edit('abc');
check('several edits that end on the opened text: clean', ctx.dirty() === false);

ctx.setDirty(true);
edit('abcx'); edit('abc');
check('a non-text change, then a text edit put back: still dirty', ctx.dirty() === true);

text = 'saved';
ctx.setDirty(false);
edit('saved!');
edit('saved');
check('after a save, the saved text is the clean point', ctx.dirty() === false);
edit('abc');
check('the text from before the save is dirty now', ctx.dirty() === true);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
