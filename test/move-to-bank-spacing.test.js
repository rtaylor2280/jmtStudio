// Presets moved to another bank get a blank line before and between them. [B-547]
//
// A blank line between presets is the app's standard, and every other way of adding a preset
// writes one. Move to bank joined the moved presets bare, so a bank built by moving presets into it
// ran them together while the bank they came from kept its gaps.
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
      _selectedPresetIndex = 0, _selectedDisabledPreset = null, _sidecarOpen = true;
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
  const promptError = () => {}, showToast = () => {}, _scheduleRebuild = () => {};
  const _refreshStrip = () => {}, _openSidecar = () => {}, _rebuildSidecar = () => {},
        _selectPreset = () => {}, _navigateToLine = () => {};
  ${extractFn('_moveSelectedToArray')}
`, sandbox);

const preset = (n) => [`{ "${n}", "",`, `  StylePtr<${n}>(),`, '', `  "${n}" },`];
const bank = (name, names, gap) => [`Preset ${name}[] = {`,
  ...names.flatMap((n, i) => [...preset(n), ...(gap && i < names.length - 1 ? [''] : [])]), '};'];
const move = (sel) => { sandbox._activeArrayIndex = 0; sandbox._selectedLive = new Set(sel); vm.runInContext('_moveSelectedToArray(1)', sandbox); };
const jedi = () => sandbox._text.slice(sandbox._text.indexOf('Preset jedi'));

console.log('1. into a bank that keeps a blank between presets');
sandbox._text = [...bank('sith', ['S1', 'S2', 'S3'], true), ...bank('jedi', ['J1', 'J2'], true)].join('\n');
move([0, 1]);
check('a blank before and between the moved presets',
  jedi().includes('"J2" },\n\n{ "S1"') && jedi().includes('"S1" },\n\n{ "S2"'), jedi());
check('the bank still parses with all four', pp.parsePresets(sandbox._text).arrays[1].presets.length === 4);
check('the source closed up', pp.parsePresets(sandbox._text).arrays[0].presets.length === 1);

console.log('2. the standard holds even where both banks already run presets together');
sandbox._text = [...bank('sith', ['S1', 'S2', 'S3'], false), ...bank('jedi', ['J1', 'J2'], false)].join('\n');
move([0, 1]);
check('still a blank before and between',
  jedi().includes('"J2" },\n\n{ "S1"') && jedi().includes('"S1" },\n\n{ "S2"'), jedi());

console.log('3. into a bank with one preset');
sandbox._text = [...bank('sith', ['S1', 'S2', 'S3'], false), ...bank('jedi', ['J1'], false)].join('\n');
move([1]);
check('a blank before it', jedi().includes('"J1" },\n\n{ "S2"'), jedi());

console.log('4. into an empty bank');
sandbox._text = [...bank('sith', ['S1', 'S2', 'S3'], true), 'Preset jedi[] = {', '};'].join('\n');
move([0, 2]);
check('no blank under the opening line, a blank between',
  jedi().startsWith('Preset jedi[] = {\n{ "S1"') && jedi().includes('"S1" },\n\n{ "S3"'), jedi());

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
