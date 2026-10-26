// Duplicate on the preset menu puts a copy directly after each selected preset, named by the app's
// numbered-name rule (the first copy is _2), with a blank line between presets. [B-551]
//
// The function runs as lifted from index.html over the real parser, on a small model that applies
// edits the way Monaco does (all ranges against the text before the edit).
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
function extractFn(fnName) {
  const start = HTML.indexOf(`function ${fnName}(`);
  if (start < 0) throw new Error(`${fnName} not found in index.html`);
  let depth = 0, i = HTML.indexOf(') {', start) + 2;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '/' && HTML[i + 1] === '/' && /^\s*$/.test(HTML.slice(HTML.lastIndexOf('\n', i) + 1, i))) {
      i = HTML.indexOf('\n', i); continue;
    }
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const pp = require('../renderer/presetParser.js');
const sandbox = { window: {}, console, presetParser: pp, setTimeout: () => {}, document: { querySelector: () => null } };
vm.createContext(sandbox);
vm.runInContext(`
  var _text = '', _activeArrayIndex = 0, _parseResult = null, _selectedLive = new Set(),
      _selectedPresetIndex = 0, _selectedDisabledPreset = null, _sidecarOpen = true, _toast = null;
  const L = () => _text.split('\\n');
  const off = (p) => { const a = L(); let o = 0; for (let i = 0; i < p.lineNumber - 1; i++) o += a[i].length + 1; return o + p.column - 1; };
  const model = {
    getLineCount: () => L().length,
    getLineContent: (n) => L()[n - 1],
    getLineMaxColumn: (n) => L()[n - 1].length + 1,
    getValueInRange: (r) => _text.slice(off({ lineNumber: r.startLineNumber, column: r.startColumn }),
                                        off({ lineNumber: r.endLineNumber,   column: r.endColumn })),
  };
  var editor = { getValue: () => _text, getModel: () => model };
  const _atomicEdit = (ed, tag, list) => {
    const spans = list.map(e => ({ s: off({ lineNumber: e.range.startLineNumber, column: e.range.startColumn }),
                                   e: off({ lineNumber: e.range.endLineNumber,   column: e.range.endColumn }), t: e.text }))
                      .sort((a, b) => b.s - a.s);
    for (let i = 1; i < spans.length; i++) if (spans[i].e > spans[i - 1].s) throw new Error('overlapping edits');
    for (const x of spans) _text = _text.slice(0, x.s) + x.t + _text.slice(x.e);
  };
  const showToast = (m) => { _toast = m; }, _scheduleRebuild = () => {};
  const _refreshStrip = () => {}, _openSidecar = () => {}, _rebuildSidecar = () => {},
        _selectPreset = () => {}, _navigateToLine = () => {};
  ${extractFn('_jmtNumberedName')}
  ${extractFn('_duplicateSelectedPresets')}
`, sandbox);

// Font and name are the same string on purpose: only the name may change.
const preset = (n) => [`{ "${n};common", "tracks/t.wav",`, `  StylePtr<Blue>("15420,0,65535"),`, '', `  "${n}" },`];
const bank = (names, lastComma = true) => {
  const lines = ['Preset jedi[] = {', ...names.flatMap((n, i) => [...preset(n), ...(i < names.length - 1 ? [''] : [])]), '};'];
  if (!lastComma) { const k = lines.length - 2; lines[k] = lines[k].replace(/,$/, ''); }
  return lines.join('\n');
};
const dup = (sel) => { sandbox._selectedLive = new Set(sel); sandbox._toast = null; vm.runInContext('_duplicateSelectedPresets()', sandbox); };
const presets = () => pp.parsePresets(sandbox._text).arrays[0].presets;
const names = () => presets().map(p => p.displayName);

console.log('1. one preset in the middle of a bank');
sandbox._text = bank(['Cal_Blue', 'Cal_Indigo', 'Cal_Orange']);
dup([1]);
check('the copy sits directly after it, named _2', JSON.stringify(names()) === JSON.stringify(['Cal_Blue', 'Cal_Indigo', 'Cal_Indigo_2', 'Cal_Orange']), names());
check('the copy keeps the font, track and style', presets()[2].font === 'Cal_Indigo;common' && presets()[2].track === 'tracks/t.wav'
  && presets()[2].styles[0].expr === presets()[1].styles[0].expr, JSON.stringify(presets()[2]));
check('a blank line between the original and the copy, and after the copy',
  sandbox._text.includes('"Cal_Indigo" },\n\n{ "Cal_Indigo;common"') && sandbox._text.includes('"Cal_Indigo_2" },\n\n{ "Cal_Orange'), sandbox._text);
check('lands on the copy', sandbox._selectedPresetIndex === 2);
check('no toast for one', sandbox._toast === null);

console.log('2. duplicating the original again takes the next number');
dup([1]);
check('Cal_Indigo_3 after the original', names()[2] === 'Cal_Indigo_3' && names()[3] === 'Cal_Indigo_2', names());

console.log('3. the last preset in a bank, written with no trailing comma');
sandbox._text = bank(['Cal_Blue', 'Cal_Yellow'], false);
dup([1]);
check('still parses, copy last', JSON.stringify(names()) === JSON.stringify(['Cal_Blue', 'Cal_Yellow', 'Cal_Yellow_2']), names());
check('the original gained its comma', sandbox._text.includes('"Cal_Yellow" },\n\n'), sandbox._text);

console.log('4. several selected');
sandbox._text = bank(['A', 'B', 'C']);
dup([0, 2]);
check('each copy after its own original', JSON.stringify(names()) === JSON.stringify(['A', 'A_2', 'B', 'C', 'C_2']), names());
check('lands on the first copy', sandbox._selectedPresetIndex === 1);
check('the count is said', /2 presets/.test(sandbox._toast || ''), sandbox._toast);

console.log('5. a name already taken in another bank is skipped');
sandbox._text = bank(['X']) + '\n' + bank(['X_2']).replace('Preset jedi', 'Preset sith');
dup([0]);
check('X_3, since X_2 exists elsewhere', names()[1] === 'X_3', names());

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');
