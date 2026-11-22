// Add to config fills a placeholder preset (no font folder, no track, every blade Black or empty)
// instead of adding a preset after it. [BUG-026]
//
// Runs the renderer's own _isPlaceholderPreset, extracted from index.html, over presets parsed by the
// real preset parser; then checks both Add to config doors consult it before appending.
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
function extract(fnName) {
  const start = HTML.indexOf(`function ${fnName}(`);
  if (start < 0) throw new Error(`${fnName} not found in index.html`);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

const presetParser = require('../renderer/presetParser.js');
const sandbox = { presetParser };
vm.createContext(sandbox);
vm.runInContext(extract('_isPlaceholderPreset'), sandbox);

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

function presetsOf(blocks) {
  const text = ['#define NUM_BLADES 2', 'Preset presets[] = {', ...blocks, '};',
    'BladeConfig blades[] = { { 0, WS281XBladePtr<1,bladePin>(), WS281XBladePtr<1,bladePin>(), CONFIGARRAY(presets) } };'].join('\n');
  return presetParser.parsePresets(text).arrays[0].presets;
}
const block = (font, track, b1, b2, name) => `{ "${font}", "${track}",\n  ${b1},\n  ${b2},\n  "${name}" },`;
const is = (font, track, b1, b2) => sandbox._isPlaceholderPreset(presetsOf([block(font, track, b1, b2, 'P')])[0]);

check('the template preset (no font, no track, Black) is a placeholder', is('', '', 'StylePtr<Black>()', 'StylePtr<Black>()'));
check('a font folder makes it a real preset', !is('Blind_Cowboy;common', '', 'StylePtr<Black>()', 'StylePtr<Black>()'));
check('a + preset with only the shared folder (";common") is still a placeholder', is(';common', '', 'StylePtr<Black>()', 'StylePtr<Black>()'));
check('a track makes it a real preset', !is('', 'tracks/a.wav', 'StylePtr<Black>()', 'StylePtr<Black>()'));
check('a style other than Black makes it a real preset', !is('', '', 'StylePtr<Blue>()', 'StylePtr<Black>()'));
check('a style on any blade counts, not only B1', !is('', '', 'StylePtr<Black>()', 'StylePtr<Red>()'));

// The first placeholder, wherever it sits.
const ps = presetsOf([block('A', '', 'StylePtr<Blue>()', 'StylePtr<Black>()', 'A'),
                      block('', '', 'StylePtr<Black>()', 'StylePtr<Black>()', 'Preset 2'),
                      block('', '', 'StylePtr<Black>()', 'StylePtr<Black>()', 'Preset 3')]);
check('the first placeholder in the bank is found', ps.findIndex(sandbox._isPlaceholderPreset) === 1);

// Both doors look for it before appending.
check('font card Add to config consults the placeholder', /_placeholderPresetIndex\(arr\)/.test(HTML.slice(HTML.indexOf('const _sfAddPresetWithFont'), HTML.indexOf('// Common path: append to the existing array.'))));
const styleDoor = HTML.slice(HTML.indexOf('window._addPresetWithStyle ='), HTML.indexOf('window._presetBladeNames ='));
check('style card Add to config consults the placeholder', /_placeholderPresetIndex\(arr\)/.test(styleDoor));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
