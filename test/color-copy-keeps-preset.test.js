// Copying onto B1 keeps the preset's colour, and a default colour can be matched. [B-519]
//
// Copy onto B1, when the new style takes a base colour:
//   1. B1's style takes a non-black base colour (set or default): keep it.
//   2. Otherwise the first other blade, B2 first, with a non-black base colour.
//   3. Otherwise the style arrives as written.
// Match: a blade whose base colour shows B1's old colour, set or default, moves with B1.
//
// Runs the renderer's own functions, extracted from index.html. Colour resolution is stubbed with a
// table of style defaults; the argument writer is the real one (effect-args.js).
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

const WHITE = [65535, 65535, 65535], BLUE = [0, 0, 65535], GREEN = [0, 65535, 0];
const DEFAULTS = { MainCalKestisSurvivorBlueBaseColor: BLUE, PixelSwitchWrapper: WHITE };
vm.runInContext(`
  const _sameRgb = (a, b) => !!a && !!b && (a[0]||0) === (b[0]||0) && (a[1]||0) === (b[1]||0) && (a[2]||0) === (b[2]||0);
  function _slotRange(s) { return s; }
  function _takesBaseColor(expr) { return /^(MainCalKestis|PixelSwitchWrapper)/.test(expr || ''); }
  function _resolveSlotColor(slot) {
    if (slot.colorArg) {
      const v = window.proffieArgs.readRegistryArg('BASE_COLOR_ARG', slot.colorArg);
      if (v && v.values && v.values.some(x => x != null)) return Array.from(v.values);
    }
    const lead = ((slot.expr || '').match(/^(\\w+)/) || [])[1];
    return DEFAULTS[lead] || null;
  }
  var editor = { getModel: () => ({ getValueInRange: r => r.text }) };
  ${extract('_matchColorOf')}
  ${extract('_colorOfSlotText')}
  ${extract('_withColorArg')}
  ${extract('_keepMatchedColor')}
  ${extract('_colorMatchEditsAt')}
`, Object.assign(sandbox, { DEFAULTS }));

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const slot = (text) => ({ startLine: 1, text });
const preset = (...texts) => ({ styles: texts.map(slot) });
const baseOf = (text) => {
  const one = sandbox.presetParser.extractStyleSlots(text)[0];
  return one.colorArg ? Array.from(pa.readRegistryArg('BASE_COLOR_ARG', one.colorArg).values) : null;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const KESTIS = 'StylePtr<MainCalKestisSurvivorBlueBaseColor>()';
const copyOntoB1 = (p, text) => sandbox._keepMatchedColor({ preset: p, bladeNum: 1 }, text);
const green = pa.writeRegistryArg('BASE_COLOR_ARG', GREEN, '');
const white = pa.writeRegistryArg('BASE_COLOR_ARG', WHITE, '');

console.log('copy onto B1 keeps the preset colour');
{
  const r = copyOntoB1(preset(`StylePtr<MainCalKestisSurvivorBlueBaseColor>("${green}")`, 'StylePtr<PixelSwitchWrapper>()'), KESTIS);
  check('1. B1 has a set colour: the copy keeps it', eq(baseOf(r), GREEN), r);
}
{
  const r = copyOntoB1(preset('StylePtr<PixelSwitchWrapper>()', 'StylePtr<Black>()'), KESTIS);
  check('1. B1 has a default colour: the copy keeps that too', eq(baseOf(r), WHITE), r);
}
{
  const r = copyOntoB1(preset('StylePtr<Black>()', `StylePtr<PixelSwitchWrapper<Black>>("${green}")`), KESTIS);
  check('2. CAL_GREEN: B1 EMPTY, B2 SET GREEN: THE COPY ARRIVES GREEN', eq(baseOf(r), GREEN), r);
}
{
  const r = copyOntoB1(preset('StylePtr<Black>()', 'StylePtr<PixelSwitchWrapper<Black>>("0,0,0")'), KESTIS);
  check('3. nothing but black: the style arrives as written', r === KESTIS, r);
}
{
  const r = copyOntoB1(preset(`StylePtr<MainCalKestisSurvivorBlueBaseColor>("${pa.writeRegistryArg('BASE_COLOR_ARG', BLUE, '')}")`), KESTIS);
  check('a kept colour equal to the style\'s own default writes nothing', r === KESTIS, r);
}
{
  const r = sandbox._keepMatchedColor({ preset: preset('StylePtr<Black>()', `StylePtr<PixelSwitchWrapper>("${green}")`), bladeNum: 2 }, KESTIS);
  check('a copy onto another blade is untouched here', r === KESTIS, r);
}

console.log('a default colour can be matched');
{
  // Cal_Indigo: Kestis set to white, the pixel switch left at its default white. B1 goes blue.
  const p = preset(`StylePtr<MainCalKestisSurvivorBlueBaseColor>("${white}")`, 'StylePtr<PixelSwitchWrapper>()');
  const blue = pa.writeRegistryArg('BASE_COLOR_ARG', BLUE, '');
  const edits = sandbox._colorMatchEditsAt({ preset: p, bladeNum: 1 }, `StylePtr<MainCalKestisSurvivorBlueBaseColor>("${blue}")`, [], []);
  check('CAL_INDIGO: A DEFAULT WHITE B2 FOLLOWS B1 FROM WHITE TO BLUE',
    edits.length === 1 && eq(baseOf(edits[0].text), BLUE), JSON.stringify(edits));
}
{
  const p = preset(`StylePtr<MainCalKestisSurvivorBlueBaseColor>("${white}")`, `StylePtr<PixelSwitchWrapper>("${green}")`);
  const edits = sandbox._colorMatchEditsAt({ preset: p, bladeNum: 1 }, KESTIS, [], []);
  check('a colour changed by hand stays where it is', edits.length === 0, JSON.stringify(edits));
}
{
  const p = preset(`StylePtr<MainCalKestisSurvivorBlueBaseColor>("${green}")`, 'StylePtr<PixelSwitchWrapper>()');
  const edits = sandbox._colorMatchEditsAt({ preset: p, bladeNum: 1 }, KESTIS, [], []);
  check('a default that does not show B1\'s colour is not matched', edits.length === 0, JSON.stringify(edits));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
