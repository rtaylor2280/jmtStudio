// A Style Library card's "Replace in config preset…" goes to a blade the user picks. [B-541]
//
// Under each preset with more than one blade, the menu lists the blades as the blade tiles' Copy to
// blade names them: "Blade 1 (B1)", or the blade's name and badge once named. A one-blade preset's
// row replaces that blade directly. The replace writes the picked blade, as copy-to writes it.
//
// _presetBladeNames runs over configs parsed by the real preset parser with the real
// _computeAbbreviations. _replaceBladeWithStyle runs with its colour and propagation helpers
// stubbed, to show which slot it writes and which blade it tells them about.
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
function extractFn(fnName) {
  const start = HTML.indexOf(`function ${fnName}(`);
  if (start < 0) throw new Error(`${fnName} not found in index.html`);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}
// `window.name = (...) => { ... };` lifted as a plain const.
function extractArrow(name) {
  const start = HTML.indexOf(`window.${name} = (`);
  if (start < 0) throw new Error(`window.${name} not found in index.html`);
  let depth = 0, i = HTML.indexOf('{', HTML.indexOf('=>', start));
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return `const ${name} = ` + HTML.slice(HTML.indexOf('(', start), i + 1) + ';';
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const sandbox = { window: {}, console, presetParser: require('../renderer/presetParser.js') };
vm.createContext(sandbox);
vm.runInContext(`
  var _text = '';
  var edits = [], toasts = [], told = [];
  var editor = {
    getValue: () => _text,
    getModel: () => ({ getValueInRange: (r) => {
      const lines = _text.split('\\n');
      if (r.startLineNumber === r.endLineNumber) return lines[r.startLineNumber - 1].slice(r.startColumn - 1, r.endColumn - 1);
      const out = [lines[r.startLineNumber - 1].slice(r.startColumn - 1)];
      for (let n = r.startLineNumber + 1; n < r.endLineNumber; n++) out.push(lines[n - 1]);
      out.push(lines[r.endLineNumber - 1].slice(0, r.endColumn - 1));
      return out.join('\\n');
    } }),
  };
  const _jmtStyleSlotExpr = (name) => 'StylePtr<' + name + '>()';
  const _keepMatchedColor = (here, text) => { told.push(here.bladeNum); return text; };
  const _propagationAt = () => [];
  const _atomicEdit = (ed, tag, list) => { edits.push(...list); };
  const _scheduleRebuild = () => {};
  const showToast = (m) => toasts.push(m);
  ${extractFn('_baseAbbreviation')}
  ${extractFn('_computeAbbreviations')}
  ${extractFn('_slotRange')}
  ${extractArrow('_presetBladeNames')}
  ${extractArrow('_replaceBladeWithStyle')}
`, sandbox);

const cfg = (labels) => [
  '#define NUM_BLADES 3',
  'Preset presets[] = {',
  ...(labels ? [`  // @jmt-labels: ${labels}`] : []),
  '  { "a", "",',
  '    StylePtr<Blue>(),',
  '    StylePtr<Green>(),',
  '    StylePtr<Red>(),',
  '    "Alpha" },',
  '};',
  'Preset solo[] = {',
  '  { "b", "",',
  '    StylePtr<Blue>(),',
  '    "Solo" },',
  '};',
  'BladeConfig blades[] = { { 0, WS281XBladePtr<1>(), CONFIGARRAY(presets) } };',
].join('\n');

console.log('1. the blade names');
sandbox._text = cfg();
let names = vm.runInContext('_presetBladeNames(0, 0)', sandbox);
check('unnamed blades: Blade 1 (B1), Blade 2 (B2), Blade 3 (B3)',
  JSON.stringify(names.map(b => b.name)) === JSON.stringify(['Blade 1 (B1)', 'Blade 2 (B2)', 'Blade 3 (B3)']),
  JSON.stringify(names));
sandbox._text = cfg('B1="Main Blade" B2="Crystal"');
names = vm.runInContext('_presetBladeNames(0, 0)', sandbox);
check('named blades show their name and badge; the unnamed one stays Blade 3 (B3)',
  names[0].name.startsWith('Main Blade (') && names[1].name.startsWith('Crystal (') && names[2].name === 'Blade 3 (B3)',
  JSON.stringify(names));
check('CONTROL the names match the blade tiles\' own naming (same function, same badge)',
  /const bladeName = \(n\) => `\$\{arr\.labels\?\.\[n\] \|\| `Blade \$\{n\}`\} \(\$\{abbrs\[n - 1\] \|\| `B\$\{n\}`\}\)`;/.test(HTML));
sandbox._text = cfg();
check('a one-blade preset lists one blade', vm.runInContext('_presetBladeNames(1, 0)', sandbox).length === 1);

console.log('2. the replace writes the picked blade');
sandbox._text = cfg();
vm.runInContext('edits = []; told = [];', sandbox);
let ok = vm.runInContext("_replaceBladeWithStyle(0, 0, 2, 'Purple')", sandbox);
let e = vm.runInContext('edits', sandbox);
check('B2 picked: one edit, on the B2 slot, the B2 line', ok === true && e.length === 1
  && sandbox.editor.getModel().getValueInRange(e[0].range) === 'StylePtr<Green>()' && e[0].text === 'StylePtr<Purple>()',
  JSON.stringify(e));
check('the colour and wrapper helpers are told it is blade 2', JSON.stringify(vm.runInContext('told', sandbox)) === '[2]');
vm.runInContext('edits = []; told = [];', sandbox);
vm.runInContext("_replaceBladeWithStyle(0, 0, 3, 'Purple')", sandbox);
e = vm.runInContext('edits', sandbox);
check('B3 picked: the B3 slot', e.length === 1 && sandbox.editor.getModel().getValueInRange(e[0].range) === 'StylePtr<Red>()');
vm.runInContext('edits = []; toasts = [];', sandbox);
ok = vm.runInContext("_replaceBladeWithStyle(0, 0, 1, 'Blue')", sandbox);
check('the same style already there: nothing written, said so',
  ok === false && !vm.runInContext('edits', sandbox).length && vm.runInContext('toasts', sandbox)[0] === 'Already has this style.');
check('a blade the preset does not have: nothing written',
  vm.runInContext("_replaceBladeWithStyle(1, 0, 2, 'Purple')", sandbox) === false);

console.log('3. the menu');
const menuAt = HTML.indexOf('function _styleCardContextMenu(');
const menu = HTML.slice(menuAt, HTML.indexOf('\nfunction _buildStylesVisual', menuAt));
check('a preset with more than one blade opens the blade list',
  /if \(blades\.length <= 1\) \{ subItem\(`\$\{presetIdx \+ 1\}\. \$\{name\}`, \(\) => replace\(1\)\); return; \}/.test(menu)
  && /for \(const b of blades\) subItem\(b\.name, \(\) => replace\(b\.n\), sub2\);/.test(menu));
check('the third level is the preset menu\'s second-level element, closed by the shared close path',
  menu.includes("document.getElementById('preset-ctx-submenu2')")
  && /getElementById\('preset-ctx-submenu2'\);\s*if \(sub2\) \{ sub2\.style\.display = 'none'/.test(HTML));
check('closing the menu closes the blade list', /sub2\.style\.display = 'none'; sub2\.innerHTML = '';/.test(menu));
check('no caller of the old B1-only replace is left', !/_replaceB1WithStyle/.test(HTML));

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
