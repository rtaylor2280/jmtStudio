// Delete Library offers an export first, and deletes only once the copy is written. [B-597]
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };
const fn = (name) => { const i = html.indexOf(`function ${name}(`); let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };

const run = async (answer, exported) => {
  const log = { dialog: null, exports: 0, deletes: 0, cleared: false };
  const f = new Function('promptConfirm', '_exportStylesLibrary', 'window', '_stylesEditorInstance', '_stylesUndoReset', '_setStylesDirty', 'document', '_activeTab', 'switchTab',
    `return async ${fn('_deleteStylesLibrary')}`)(
    async (o) => { log.dialog = o; return answer; },
    async () => { log.exports++; return exported; },
    { electronAPI: { deleteStylesFile: async () => { log.deletes++; return { ok: true }; } }, _applyStylesImportButtons: async () => {} },
    { setValue: () => { log.cleared = true; } }, () => {}, () => {},
    { querySelector: () => null }, 'config', () => {});
  await f();
  return log;
};

(async () => {
  let r = await run('confirm', true);
  check('the dialog names what goes', r.dialog.title === 'Delete Style Library' && r.dialog.altText === 'Delete Library');
  check('Export and Delete is the preferred button, Delete Library the red one',
    r.dialog.confirmText === 'Export and Delete' && r.dialog.confirmKind === 'primary' && r.dialog.altKind === 'danger');
  check('Export and Delete exports, then deletes', r.exports === 1 && r.deletes === 1 && r.cleared, JSON.stringify(r));
  r = await run('confirm', false);
  check('no copy written: nothing deleted', r.exports === 1 && r.deletes === 0 && !r.cleared, JSON.stringify(r));
  r = await run('alt', false);
  check('Delete Library deletes with no export', r.exports === 0 && r.deletes === 1, JSON.stringify(r));
  r = await run('cancel', false);
  check('Cancel does nothing', r.exports === 0 && r.deletes === 0, JSON.stringify(r));
  const exp = fn('_exportStylesLibrary');
  check('Export reports true only once written, false on an error or a cancelled save',
    /_expRes\.ok && _expRes\.filePath/.test(exp) && /return true;\s*\}\s*return false;\s*\}$/.test(exp) && !/if \(_expRes && _expRes\.error\) \{[^}]*return true/.test(exp));
  check('the toolbar button says Delete Library', />&#128465; Delete Library<\/button>/.test(html));
  check('the Export button still runs the same door', /getElementById\('btn-styles-export'\)\.addEventListener\('click', \(\) => _exportStylesLibrary\(\)\);/.test(html));
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
