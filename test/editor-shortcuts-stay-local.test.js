// An editor's keyboard shortcuts answer only in that editor. [QA09 M31, 2026-11-20]
//
// Monaco's addCommand registers its keys for every editor on the page, and the last one registered wins.
// The Style Library's Ctrl+S and Ctrl+F were added that way, so Ctrl+S in the config text ran the Style
// Library's save (the config stayed unsaved) and Ctrl+F went to the Style Library's search. addAction
// keeps the keys on its own editor (measured on the running app: addCommand on two editors, the second
// won in the first; addAction on two editors, each kept its own).
//
// Run: node test/editor-shortcuts-stay-local.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const dir = path.join(__dirname, '..', 'renderer');
const files = ['index.html', ...fs.readdirSync(dir).filter(f => f.endsWith('.js'))];
const hits = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  src.split('\n').forEach((line, i) => { if (/\.addCommand\s*\(/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`); });
}
ok('no editor registers a shortcut with addCommand', hits.length === 0, hits.join('\n       '));

const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const action = (id) => {
  const at = html.indexOf(`id: '${id}'`);
  return at < 0 ? '' : html.slice(at, html.indexOf('});', at));
};
ok('the config editor saves with Ctrl+S as its own action',
  /CtrlCmd \| monaco\.KeyCode\.KeyS\]/.test(action('jmt.config.save')) && /doSave\(\)/.test(action('jmt.config.save')));
ok('it saves only with a file open', /if \(fileIsOpen\)/.test(action('jmt.config.save')));
ok('the Style Library saves with Ctrl+S as its own action',
  /CtrlCmd \| monaco\.KeyCode\.KeyS\]/.test(action('jmt.styles.save')) && /saveStylesFile\(\)/.test(action('jmt.styles.save')));
ok('the Style Library finds with Ctrl+F as its own action',
  /CtrlCmd \| monaco\.KeyCode\.KeyF\]/.test(action('jmt.styles.find')) && /_stylesCodeFindFocus\(\)/.test(action('jmt.styles.find')));

for (const [id, btn, what] of [['jmt.styleDetail.save', 'btn-style-detail-save', 'a style'], ['jmt.helper.save', 'btn-helper-save', 'a helper']]) {
  const a = action(id);
  ok(`Ctrl+S in ${what}'s code presses its Save button, only when Save is enabled`,
    /CtrlCmd \| monaco\.KeyCode\.KeyS\]/.test(a) && a.includes(`getElementById('${btn}')`) && /!b\.disabled\) b\.click\(\)/.test(a), a.slice(0, 200));
}

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
