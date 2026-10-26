// A preset added to a bank takes the bank's pattern on every blade after B1. [B-541]
//
// Each blade takes what most of the bank's live presets have there, a tie going to the earliest.
// A wrapper around its own preset's B1 counts as one pattern and lands around the new B1, its
// matched colour moved to B1's. Disabled presets and the charge preset do not count.
//
// Runs the renderer's own functions, extracted from index.html, over configs parsed by the real
// preset parser. Colour resolution is stubbed with a table of style defaults, as in
// color-copy-keeps-preset.test.js; the argument writer is the real one (effect-args.js).
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

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effect-args.js'), 'utf8'), sandbox);
sandbox.presetParser = require('../renderer/presetParser.js');
const pa = sandbox.window.proffieArgs;

const BLUE = [0, 0, 65535], GREEN = [0, 65535, 0], RED = [65535, 0, 0];
const DEFAULTS = { BlueStyle: BLUE, GreenStyle: GREEN, RedStyle: RED };
vm.runInContext(`
  const EMPTY_SLOT_EXPR = 'StylePtr<Black>()';
  const _sameRgb = (a, b) => !!a && !!b && (a[0]||0) === (b[0]||0) && (a[1]||0) === (b[1]||0) && (a[2]||0) === (b[2]||0);
  function _resolveSlotColor(slot) {
    if (slot.colorArg) {
      const v = window.proffieArgs.readRegistryArg('BASE_COLOR_ARG', slot.colorArg);
      if (v && v.values && v.values.some(x => x != null)) return Array.from(v.values);
    }
    const lead = ((slot.expr || '').match(/^(\\w+)/) || [])[1];
    return DEFAULTS[lead] || null;
  }
  var _text = '';
  var editor = { getModel: () => ({
    getValue: () => _text,
    getValueInRange: (r) => {
      const lines = _text.split('\\n');
      if (r.startLineNumber === r.endLineNumber) return lines[r.startLineNumber - 1].slice(r.startColumn - 1, r.endColumn - 1);
      const out = [lines[r.startLineNumber - 1].slice(r.startColumn - 1)];
      for (let n = r.startLineNumber + 1; n < r.endLineNumber; n++) out.push(lines[n - 1]);
      out.push(lines[r.endLineNumber - 1].slice(0, r.endColumn - 1));
      return out.join('\\n');
    },
  }) };
  ${extract('_jmtChargeStyleDefined')}
  ${extract('_jmtChargeHoldsLastSlot')}
  ${extract('_jmtAppendPresetIndex')}
  ${extract('_slotRange')}
  ${extract('_matchColorOf')}
  ${extract('_copyWrapperFor')}
  ${extract('_copyTextFor')}
  ${extract('_newPresetSlotTexts')}
`, Object.assign(sandbox, { DEFAULTS }));

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const same = (a, b) => sandbox.presetParser.sameExpr(a, b);

/** A three-blade config; each preset is [B1, B2, B3]. `extra` goes before the presets. */
function config(presets, { disabled = [], extra = '' } = {}) {
  const block = (p, i) => `  { "f${i}", "",\n    ${p[0]},\n    ${p[1]},\n    ${p[2]},\n    "P${i}" },`;
  return [
    '#define NUM_BLADES 3', extra,
    'Preset presets[] = {',
    ...presets.map(block),
    ...disabled.map((p, i) => `/*${block(p, 90 + i)}*/`),
    '};',
    'BladeConfig blades[] = { { 0, WS281XBladePtr<1,bladePin>(), WS281XBladePtr<1,bladePin>(), WS281XBladePtr<1,bladePin>(), CONFIGARRAY(presets) } };',
    '',
  ].join('\n');
}
function slotsFor(text, b1) {
  sandbox._text = text;
  const r = sandbox.presetParser.parsePresets(text);
  return sandbox._newPresetSlotTexts(r.arrays[0], r.bladeCount, b1);
}

console.log('majority and tie');
{
  const out = slotsFor(config([
    ['StylePtr<BlueStyle>()',  'StylePtr<PixelSwitchWrapper<BlueStyle>>()',  'StylePtr<Black>()'],
    ['StylePtr<GreenStyle>()', 'StylePtr<PixelSwitchWrapper<GreenStyle>>()', 'StylePtr<Rainbow>()'],
    ['StylePtr<RedStyle>()',   'StylePtr<PixelSwitchWrapper<RedStyle>>()',   'StylePtr<Rainbow>()'],
  ]), 'StylePtr<NewStyle>()');
  check('B1 is the style given', out[0] === 'StylePtr<NewStyle>()', out[0]);
  check('a wrapper of each preset\'s own B1 lands around the new B1', same(out[1], 'StylePtr<PixelSwitchWrapper<NewStyle>>()'), out[1]);
  check('B3 takes what most presets have', same(out[2], 'StylePtr<Rainbow>()'), out[2]);
}
{
  const out = slotsFor(config([
    ['StylePtr<BlueStyle>()',  'StylePtr<Fire>()',    'StylePtr<Black>()'],
    ['StylePtr<GreenStyle>()', 'StylePtr<Rainbow>()', 'StylePtr<Black>()'],
  ]), 'StylePtr<NewStyle>()');
  check('a tie goes to the earliest preset', same(out[1], 'StylePtr<Fire>()'), out[1]);
}

console.log('the plain + button');
{
  const out = slotsFor(config([
    ['StylePtr<BlueStyle>()',  'StylePtr<PixelSwitchWrapper<BlueStyle>>()',  'StylePtr<Fire>()'],
    ['StylePtr<GreenStyle>()', 'StylePtr<PixelSwitchWrapper<GreenStyle>>()', 'StylePtr<Fire>()'],
  ]), 'StylePtr<Black>()');
  check('B1 stays the placeholder', out[0] === 'StylePtr<Black>()', out[0]);
  check('the wrapper is placed around the placeholder, to follow B1 once it is set',
    same(out[1], 'StylePtr<PixelSwitchWrapper<Black>>()'), out[1]);
  check('B3 is the bank\'s pattern', same(out[2], 'StylePtr<Fire>()'), out[2]);
}

console.log('only live presets count');
{
  const out = slotsFor(config([
    ['StylePtr<BlueStyle>()', 'StylePtr<Fire>()', 'StylePtr<Black>()'],
  ], { disabled: [
    ['StylePtr<GreenStyle>()', 'StylePtr<Rainbow>()', 'StylePtr<Black>()'],
    ['StylePtr<RedStyle>()',   'StylePtr<Rainbow>()', 'StylePtr<Black>()'],
  ] }), 'StylePtr<NewStyle>()');
  check('two disabled presets do not outvote one live one', same(out[1], 'StylePtr<Fire>()'), out[1]);
}
{
  const bank = [
    ['StylePtr<BlueStyle>()',  'StylePtr<Fire>()',    'StylePtr<Black>()'],
    ['StylePtr<GreenStyle>()', 'StylePtr<Rainbow>()', 'StylePtr<Black>()'],
    ['StylePtr<Charging>()',   'StylePtr<Rainbow>()', 'StylePtr<Black>()'],
  ];
  const plain = slotsFor(config(bank), 'StylePtr<NewStyle>()');
  check('control: without the charge define the last preset counts', same(plain[1], 'StylePtr<Rainbow>()'), plain[1]);
  const out = slotsFor(config(bank, { extra: '#define JMT_CHARGE_STYLE_PRESET' }), 'StylePtr<NewStyle>()');
  check('the charge preset in the last slot does not count (a tie, so the earliest)', same(out[1], 'StylePtr<Fire>()'), out[1]);
}
{
  const out = slotsFor(config([
    ['StylePtr<Charging>()', 'StylePtr<Rainbow>()', 'StylePtr<Rainbow>()'],
  ], { extra: '#define JMT_CHARGE_STYLE_PRESET' }), 'StylePtr<NewStyle>()');
  check('a bank holding only the charge preset gives Black', out[1] === 'StylePtr<Black>()' && out[2] === 'StylePtr<Black>()', out.join(' | '));
}

console.log('matched colours');
{
  const g = pa.writeRegistryArg('BASE_COLOR_ARG', GREEN, '');
  const r = pa.writeRegistryArg('BASE_COLOR_ARG', RED, '');
  const out = slotsFor(config([
    [`StylePtr<GreenStyle>()`, `StylePtr<PixelSwitchWrapper<GreenStyle>>("${g}")`, 'StylePtr<Black>()'],
    [`StylePtr<RedStyle>()`,   `StylePtr<PixelSwitchWrapper<RedStyle>>("${r}")`,   'StylePtr<Black>()'],
    [`StylePtr<BlueStyle>()`,  'StylePtr<Fire>()',                                  'StylePtr<Black>()'],
  ]), 'StylePtr<BlueStyle>()');
  const one = sandbox.presetParser.extractStyleSlots(out[1])[0];
  const rgb = one && one.colorArg ? Array.from(pa.readRegistryArg('BASE_COLOR_ARG', one.colorArg).values) : null;
  check('wrappers matched to their B1\'s colour count as one pattern', /PixelSwitchWrapper<BlueStyle>/.test(out[1]), out[1]);
  check('and take the new B1\'s colour', JSON.stringify(rgb) === JSON.stringify(BLUE), `${out[1]} -> ${JSON.stringify(rgb)}`);
}

console.log('an empty bank');
{
  const out = sandbox._newPresetSlotTexts({ presets: [] }, 3, 'StylePtr<NewStyle>()');
  check('B1 the style, the rest Black', out.join('|') === 'StylePtr<NewStyle>()|StylePtr<Black>()|StylePtr<Black>()', out.join('|'));
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
