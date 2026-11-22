/**
 * A font written without its quotes is named as needing quotes, with or without the folders after it.
 *
 * Run: node test/unquoted-font-name.test.js
 */
'use strict';

const { resolve } = require('../compileErrorMatrix');
require('./plain-error-data').useOrSkip('unquoted font name');

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

const config = (preset) => `#ifdef CONFIG_PRESETS
Preset presets[] = {
${preset}
  StylePtr<Red>(), "red"
  },
};
BladeConfig blades[] = { { 0, WS281XBladePtr<10, bladePin, Color8::GRB, PowerPINS<bladePowerPin2> >(), CONFIGARRAY(presets) } };
#endif`;
const log = sym => `my_config.h:3:5: error: '${sym}' was not declared in this scope`;

{
  const r = resolve(log('ChargeFont'), config('  { ChargeFont;common, "",'));
  ok('a font with folders after it needs quotes, named whole', r && r.id === 'unquoted-preset-name' && /ChargeFont;common/.test(r.title), r && r.title);
  ok('and the fix quotes all of it', r && r.fix.includes('"ChargeFont;common"'), r && r.fix);
}
{
  const r = resolve(log('ChargeFont'), config('  { ChargeFont;common;extra , "",'));
  ok('more than one folder is kept too', r && r.fix.includes('"ChargeFont;common;extra"'), r && r.fix);
}
{
  const r = resolve(log('Font1'), config('  { Font1, "",'));
  ok('a bare font still needs quotes, as before', r && r.id === 'unquoted-preset-name' && r.fix.includes('"Font1"') && !r.fix.includes(';'), r && r.fix);
}
{
  const r = resolve(log('track1'), config('  { "Font1;common", track1,'));
  ok('a bare track still needs quotes', r && r.id === 'unquoted-preset-name' && r.fix.includes('"track1"'), r && r.fix);
}
{
  const r = resolve(log('ChargeFont'), config('  { "ChargeFont;common", "", Rainbow<ChargeFont>(),'));
  ok('a quoted font does not claim a name used elsewhere', !r || r.id !== 'unquoted-preset-name', r && r.id);
}

console.log(failed ? `\n${failed} failure(s)` : '\nall passed');
process.exit(failed ? 1 : 0);
