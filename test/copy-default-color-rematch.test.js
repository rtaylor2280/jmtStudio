// Copying a blade whose base colour is left at its default, where that default equals the source
// preset's B1, re-matches it to each target preset's B1. [BUG-025]
//
// Runs the renderer's own _copyTextFor, extracted from index.html, with the real preset parser and
// the real argument writer (effect-args.js). Colour resolution is stubbed with a table of style
// defaults, as in new-preset-pattern.test.js.
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
const DEFAULTS = { BlueStyle: BLUE, GreenStyle: GREEN, RedStyle: RED, AccentStyle: GREEN };
vm.runInContext(`
  const _sameRgb = (a, b) => !!a && !!b && (a[0]||0) === (b[0]||0) && (a[1]||0) === (b[1]||0) && (a[2]||0) === (b[2]||0);
  function _resolveSlotColor(slot) {
    if (slot.colorArg) {
      const v = window.proffieArgs.readRegistryArg('BASE_COLOR_ARG', slot.colorArg);
      if (v && v.values && v.values.some(x => x != null)) return Array.from(v.values);
    }
    const lead = ((slot.expr || '').match(/^(\\w+)/) || [])[1];
    return DEFAULTS[lead] || null;
  }
  function _takesBaseColor(expr) { return !!DEFAULTS[((expr || '').match(/^(\\w+)/) || [])[1]]; }
  ${extract('_matchColorOf')}
  ${extract('_copyWrapperFor')}
  ${extract('_withColorArg')}
  ${extract('_copyTextFor')}
`, Object.assign(sandbox, { DEFAULTS }));

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const slot = (expr) => ({ expr });
const colourOf = (text) => {
  const one = (sandbox.presetParser.extractStyleSlots(text) || [])[0];
  return one ? sandbox._resolveSlotColor(one) : null;
};
const eq = (a, b) => !!a && !!b && a.every((v, i) => (v || 0) === (b[i] || 0));

// His case: Talzin (B1 green) B3 AccentStyle at its default green, copied to Kannan (B1 blue).
const src = 'StylePtr<AccentStyle>()';
const out = sandbox._copyTextFor(src, 'AccentStyle', slot('GreenStyle'), slot('BlueStyle'), 3);
check('a default colour equal to the source B1 arrives as the target B1', eq(colourOf(out), BLUE), out);
check('and is written into the copy, not left to the default',
  (sandbox.presetParser.extractStyleSlots(out) || [])[0]?.colorArg != null, out);

// Control: the default does not equal the source's B1, so nobody matched it.
const ctl = sandbox._copyTextFor(src, 'AccentStyle', slot('RedStyle'), slot('BlueStyle'), 3);
check('control: a default that does not match the source B1 is copied as written', ctl === src, ctl);

// Same B1 colour on both sides: nothing to move.
const same = sandbox._copyTextFor(src, 'AccentStyle', slot('GreenStyle'), slot('GreenStyle'), 3);
check('same B1 colour both sides: copied as written', same === src, same);

// Copied as B1 itself: arrives as written.
const asB1 = sandbox._copyTextFor(src, 'AccentStyle', slot('GreenStyle'), slot('BlueStyle'), 1);
check('copied as B1: arrives as written', asB1 === src, asB1);

// A written colour matched to B1 still re-matches as before (B-519).
const written = `StylePtr<AccentStyle>("${pa.writeRegistryArg('BASE_COLOR_ARG', GREEN, '')}")`;
const w = sandbox._copyTextFor(written, 'AccentStyle', slot('GreenStyle'), slot('BlueStyle'), 3);
check('a written colour matched to B1 still re-matches', eq(colourOf(w), BLUE), w);

// A written colour set on purpose to something else stays.
const own = `StylePtr<AccentStyle>("${pa.writeRegistryArg('BASE_COLOR_ARG', RED, '')}")`;
const o = sandbox._copyTextFor(own, 'AccentStyle', slot('GreenStyle'), slot('BlueStyle'), 3);
check('a colour set to something other than B1 stays', o === own, o);

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
