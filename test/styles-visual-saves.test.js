// Visual view has no Save: a Style Library change made there is written at once. [B-574]
//
//   1. _stylesChanged, run: Visual writes (a tick later, flagged visual), Code only marks it unsaved.
//   2. saveStylesFile, run: a conflict refuses and says the Visual change is kept; template conflicts
//      are read from the text now, so a resolved one no longer blocks.
//   3. Wiring: every Visual change goes through _stylesChanged, Code view's Condense/Expand do not,
//      Save/Discard/Delete show only in Code view, and leaving Code view with edits asks first.
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

(async () => {
  console.log('1. _stylesChanged');
  const src = fn('_stylesChanged');
  check('located', src.length > 50);
  const run = (mode) => {
    const calls = [];
    const timers = [];
    const window = { saveStylesFile: (o) => calls.push(['save', o]) };
    const f = new Function('window', 'setTimeout', '_stylesViewMode', '_setStylesDirty',
      `${src}\nreturn _stylesChanged;`)(window, (cb) => timers.push(cb), mode, (v) => calls.push(['dirty', v]));
    f();
    const beforeTick = calls.length;
    timers.forEach((t) => t());
    return { calls, beforeTick };
  };
  const v = run('visual');
  check('Visual: marked, then written a tick later as a Visual save',
    v.beforeTick === 1 && JSON.stringify(v.calls) === JSON.stringify([['dirty', true], ['save', { visual: true }]]), JSON.stringify(v));
  const c = run('code');
  check('Code: only marked unsaved', JSON.stringify(c.calls) === JSON.stringify([['dirty', true]]), JSON.stringify(c));

  console.log('2. saveStylesFile');
  const at = html.indexOf('window.saveStylesFile = async function(opts) {');
  const end = html.indexOf('\n};', at);
  const saveSrc = at > -1 && end > at ? html.slice(at, end + 3) : '';
  check('located', saveSrc.length > 300);
  const mk = (styleConflicts, templateConflictsNow) => {
    const out = { errors: [], writes: 0 };
    const window = { electronAPI: { writeStylesFile: async () => { out.writes++; } } };
    const env = new Function('window', 'promptError', '_sortHelpersFirst', '_extractStyleLibraryCreatedDate',
      '_jmtLocalDateString', '_applyStyleLibraryStructure', '_setStylesDirty', '_buildStylesVisual',
      `let _stylesEditorInstance = { getValue: () => 'x', setValue: () => {} };
       let _stylesViewMode = 'visual';
       let _conflictStyleNames = new Set(${JSON.stringify(styleConflicts)});
       let _conflictTemplateNames = new Set(['Stale']);
       ${saveSrc}
       return window.saveStylesFile;`)(window, (t, m) => out.errors.push([t, m]),
      () => ({ content: 'x', conflicts: new Set(templateConflictsNow) }), () => '', () => '2026-10-28', (s) => s, () => {}, () => {});
    return { save: env, out };
  };
  {
    const { save, out } = mk(['Dup'], []);
    const ok = await save({ visual: true });
    check('a duplicate name refuses a Visual save and says the change is kept',
      ok === false && out.writes === 0 && out.errors[0]?.[0] === 'Not saved yet' && /change is kept/.test(out.errors[0][1]), JSON.stringify(out));
  }
  {
    const { save, out } = mk(['Dup'], []);
    await save();
    check('Code view keeps its own wording', out.errors[0]?.[0] === 'Cannot save', JSON.stringify(out));
  }
  {
    const { save, out } = mk([], []);
    const ok = await save({ visual: true });
    check('a template conflict resolved since load no longer blocks', ok === true && out.writes === 1, JSON.stringify(out));
  }
  {
    const { save, out } = mk([], ['T']);
    const ok = await save({ visual: true });
    check('a template conflict still in the text blocks', ok === false && out.writes === 0, JSON.stringify(out));
  }

  console.log('3. wiring');
  const n = (re) => (html.match(re) || []).length;
  check('ten Visual changes go through _stylesChanged', n(/^\s*_stylesChanged\(\);/mg) === 10, n(/^\s*_stylesChanged\(\);/mg));
  check('the entry Save writes at once', /setValue\(current\);\s*_stylesChanged\(\);/.test(html));
  check('Add Style, Append, delete, reorder, undo and redo write at once',
    /setValue\(_stylesEditorInstance\.getValue\(\) \+ block\);\s*_stylesChanged\(\);/.test(html)
    && /collapsedIncoming\.trimStart\(\)\);\s*_stylesChanged\(\);/.test(html)
    && /kept\.map\(s => s\.text\)\.join\(''\)\);\s*_stylesChanged\(\);/.test(html)
    && /_styleReorderUndoStack\.pop\(\)\);\s*_stylesChanged\(\);/.test(html)
    && /_styleReorderRedoStack\.pop\(\)\);\s*_stylesChanged\(\);/.test(html));
  check("Code view's Condense and Expand still wait for Save", /_stylesEditorInstance\.setValue\(result\);\s*_setStylesDirty\(true\);/.test(html));
  check('Save, Discard and Delete show only in Code view',
    /getElementById\('btn-styles-save'\)\.style\.display    = show;/.test(html)
    && /getElementById\('btn-styles-discard'\)\.style\.display = show;/.test(html)
    && /getElementById\('btn-styles-delete'\)\.style\.display  = show;/.test(html));
  check('leaving Code view with edits asks Save / Discard / stay',
    /btn-styles-view-visual'\)\.addEventListener\('click', async \(\) => \{\s*if \(_stylesViewMode === 'code' && _isStylesDirtyFlag\) \{\s*const choice = await promptUnsaved\(/.test(html)
    && /if \(choice === 'save' && !await window\.saveStylesFile\(\)\) return;/.test(html));
  check('arriving in Visual still unsaved writes it', /if \(mode === 'visual' && _isStylesDirtyFlag\) _stylesChanged\(\);/.test(html));
  check('Add Style from a config does not write twice in Visual', /if \(hadCallback && !wasAlreadyDirty && _stylesViewMode !== 'visual'\)/.test(html));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
