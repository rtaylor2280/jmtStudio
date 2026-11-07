'use strict';
// Runs the planner behind Add Styles to Library against real parsed configs. [B-367]

const { parsePresets, planLibraryStyles, nameSlotStyle, librarySlotText, styleCodeKey } = require('../renderer/presetParser.js');

let failed = 0;
const ok = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  console.log(`${a === b ? 'PASS' : 'FAIL'}  ${name}${a === b ? '' : `  <- ${a}`}`);
  if (a !== b) failed++;
};

const nameOf = s => String(s || '').replace(/\n/g, ' ').replace(/[\s\-]+(.?)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9_]/g, '');
const config = (presets, labels = '') => `#ifdef CONFIG_PRESETS
Preset presets[] = {
${presets}
};
${labels}
BladeConfig blades[] = {
 { 0, WS281XBladePtr<144, bladePin, Color8::GRB, PowerPINS<bladePowerPin2, bladePowerPin3>>(), CONFIGARRAY(presets) },
};
#endif
`;
const plan = (presets, opts = {}, labels) => planLibraryStyles(parsePresets(config(presets, labels)).arrays, { nameOf, ...opts });
const A = 'Layers<Blue,AudioFlickerL<White>>', B = 'Layers<Red,AudioFlickerL<White>>';

let rows = plan(`{ "Nomad;common", "", StylePtr<${A}>("0,0,65535"), StylePtr<${B}>(), "Ezra\nBridger" },
{ "Skoll;common", "", StylePtr<${A}>("9,9,9"), StylePtr<${A}>(), "Skoll" },`);
ok('one row per distinct style', rows.length, 2);
ok('named after the preset', rows[0].name, 'EzraBridger');
ok('a different second blade gets blade2', rows[1].name, 'EzraBridger_blade2');
ok('every use is recorded', rows[0].uses.length, 3);

rows = plan(`{ "Nomad;common", "", StylePtr<${A}>(), "" },`);
ok('no preset name falls to the font', rows[0].name, 'Nomad');

rows = plan(`{ "Darth Vader 3;MC", "", StylePtr<${A}>(), "0" },`);
ok('a placeholder name of 0 falls to the font', rows[0].name, 'DarthVader3');

rows = plan(`{ "A;common", "", StylePtr<${A}>(), "Luke" },
{ "B;common", "", StylePtr<${B}>(), "Luke" },`);
ok('two presets sharing a name step apart', rows.map(r => r.name), ['Luke', 'Luke_2']);

rows = plan(`{ "A;common", "", StylePtr<${A}>(), "Rainbow" },`, { isTaken: n => n === 'Rainbow' });
ok('a taken default steps around it', rows[0].name, 'Rainbow_2');

rows = plan(`{ "A;common", "", StylePtr<${A}>(), "Luke" },`, { library: new Map([[styleCodeKey(A), 'BlueOne']]) });
ok('code already in the library takes its name', [rows[0].existing, rows[0].name], ['BlueOne', 'BlueOne']);

rows = plan(`{ "A;common", "", StylePtr<Layers<Blue,  /* note */ AudioFlickerL<White>>>(), "One" },
{ "A;common", "", StylePtr<${A}>(), "Two" },`);
ok('spacing and comments do not split a style', rows.length, 1);

rows = plan(`{ "A;common", "", StyleNormalPtr<CYAN,WHITE,300,800>(), "One" },
{ "A;common", "", StylePtr<Black>(), "Two" },
{ "A;common", "", StylePtr<MISSING_STYLE>(), "Three" },
{ "A;common", "", StylePtr<ControlMainEzraBridgerBaseColor>(), "Four" },
{ "A;common", "", &style_pov, "Five" },`);
ok('argument lists, colors, placeholders, library names and refs stay out', rows.length, 0);

rows = plan(`{ "A;common", "", StylePtr<Layers<MyLocal,Red>>(), "One" },`, { localNames: new Set(['MyLocal']) });
ok('code leaning on a name in this config stays out', rows.length, 0);

ok('the wrapper and color arguments stay', nameSlotStyle('StylePtr<Layers<Red,Mix<A,B>>>("0,0,65535")', 'Foo'), 'StylePtr<Foo>("0,0,65535")');
ok('another wrapper stays', nameSlotStyle('ChargingStylePtr<Layers<Red>>()', 'Foo'), 'ChargingStylePtr<Foo>()');
ok('a comment holding > does not end it early', nameSlotStyle('StylePtr<Layers<Red /* a > b */>>()', 'Foo'), 'StylePtr<Foo>()');

// ── Styles differing only in color ──
const bare = c => `Layers<Rgb<${c}>,AudioFlickerL<White>>`;
global.window = global;
require('../renderer/effect-args.js');
require('../renderer/styleArgResolver.js');
const args = { findArgs: global.styleArgResolver.findArgs, resolve: global.proffieArgs.resolveColorDefault,
  read: global.proffieArgs.readRegistryArg, write: global.proffieArgs.writeRegistryArg };

// What a blade shows, read as ProffieOS reads it (common/arg_parser.h, styles/rgb_arg.h) and sharing
// no code with the app: words split on spaces, ~ or a missing word is the default, Rgb<> times 257.
const POS = { BASE_COLOR_ARG: 1, BLAST_COLOR_ARG: 9, CLASH_COLOR_ARG: 10, LOCKUP_COLOR_ARG: 11 };
const shown = (expr, str) => {
  const words = (str || '').split(/\s+/).filter(Boolean);
  return [...expr.matchAll(/RgbArg<(\w+),Rgb<(\d+),(\d+),(\d+)>>/g)].map(m => {
    const w = words[POS[m[1]] - 1];
    return `${m[1]}=${w && w !== '~' ? w : [m[2], m[3], m[4]].map(n => n * 257).join(',')}`;
  }).sort().join(' ');
};
const style = (base, clash = '255,255,255') => `Layers<RgbArg<BASE_COLOR_ARG,Rgb<${base}>>,AudioFlickerL<RgbArg<BASE_COLOR_ARG,Rgb<${base}>>>,BlastL<RgbArg<CLASH_COLOR_ARG,Rgb<${clash}>>>>`;
const slotText = (expr, str) => `StylePtr<${expr}>(${str ? `"${str}"` : ''})`;

// Rewrites a list of [expr, string] slots and returns what each shows, before and after.
const roundTrip = (slots, opts = {}) => {
  const body = slots.map(([e, c, wrap], i) => `{ "F${i};common", "", ${(wrap ? slotText(e, c).replace('StylePtr', wrap) : slotText(e, c))}, "P${i}" },`).join('\n');
  const rows = planLibraryStyles(parsePresets(config(body)).arrays, { nameOf, args, ...opts });
  const out = [];
  for (const row of rows) {
    const lead = opts.leadExpr || row.expr;
    for (const use of row.uses) {
      const before = slotText(use.slot.expr, use.slot.colorArg);
      const after = librarySlotText(before, row, use, row.name, args);
      const m = after.match(/\((?:"(.*)")?\)$/);
      out.push({ before: shown(use.slot.expr, use.slot.colorArg), after: shown(row.colors ? lead : use.slot.expr, m ? m[1] : ''), text: after });
    }
  }
  return { rows, out };
};
const same = r => r.out.every(o => o.before === o.after);

let r = roundTrip([[style('2,72,255')], [style('0,255,0')], [style('255,14,0')]]);
ok('three colors of one style make one row', r.rows.length, 1);
ok('the first keeps its color as the default', r.out[0].text, 'StylePtr<P0>()');
ok('the others carry theirs', r.out[1].text, 'StylePtr<P0>("0,65535,0")');
ok('the conversion matches the config', r.out[2].text, 'StylePtr<P0>("65535,3598,0")');
ok('every blade shows what it showed', same(r), true);
ok('the row counts its colors', r.rows[0].colorCount, 3);

r = roundTrip([[style('2,72,255')], [style('100,100,150', '255,0,0')]]);
ok('a later position is reached with ~', r.out[1].text, 'StylePtr<P0>("25700,25700,38550 ~ ~ ~ ~ ~ ~ ~ ~ 65535,0,0")');
ok('and shows what it showed', same(r), true);

r = roundTrip([[style('2,72,255')], [style('0,255,0'), '0,0,65535']]);
ok('a color a preset already passes wins over the default', r.out[1].text, 'StylePtr<P0>("0,0,65535")');
ok('and still shows the same', same(r), true);

r = roundTrip([[style('2,72,255')], [style('2,72,255'), '0,0,65535 ~ 3']]);
ok('other words in a string stay', r.out[1].text, 'StylePtr<P0>("0,0,65535 ~ 3")');

r = roundTrip([[style('2,72,255')], [style('0,255,0')]], {
  libraryStyles: [{ name: 'Base', expr: style('255,0,0') }], leadExpr: style('255,0,0') });
ok('a library style with the same code leads', [r.rows.length, r.rows[0].existing], [1, 'Base']);
ok('and each use keeps its color on it', same(r), true);

r = roundTrip([[style('2,72,255')], ['Layers<RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,AudioFlickerL<White>>']]);
ok('different code stays apart', r.rows.length, 2);

r = roundTrip([[style('2,72,255')], [style('0,255,0'), '', 'ChargingStylePtr']]);
ok('a wrapper that takes no string stays apart', r.rows.length, 2);

const three = [[style('2,72,255')], [style('0,255,0')], [style('255,0,0')]];
r = roundTrip(three, { fileName: 'FoundSpectre' });
ok('a style most presets share takes the file name', r.rows[0].name, 'FoundSpectre');
ok('with no file name it keeps the first preset', roundTrip(three).rows[0].name, 'P0');
r = roundTrip([...three, [bare('1,2,3')], [bare('4,5,6')], [bare('7,8,9')], [bare('9,9,9')]], { fileName: 'FoundSpectre' });
ok('a style only some presets share keeps its preset', r.rows[0].name, 'P0');
r = roundTrip([[style('2,72,255')]], { fileName: 'FoundSpectre' });
ok('a config of one preset keeps that preset', r.rows[0].name, 'P0');

r = planLibraryStyles(parsePresets(config(`{ "A;common", "", StylePtr<${style('1,2,3')}>(), "One" },
{ "B;common", "", StylePtr<${style('4,5,6')}>(), "Two" },`)).arrays, {
  nameOf, args, commentName: s => (s.colorArg === null && s.expr.includes('4,5,6') ? 'FromLater' : '') });
ok('a name on any use of a style is used', r[0].name, 'FromLater');

const two = 'Layers<RgbArg<BASE_COLOR_ARG,Rgb<1,2,3>>,AudioFlickerL<RgbArg<BASE_COLOR_ARG,Rgb<4,5,6>>>>';
const twoB = 'Layers<RgbArg<BASE_COLOR_ARG,Rgb<7,8,9>>,AudioFlickerL<RgbArg<BASE_COLOR_ARG,Rgb<4,5,6>>>>';
r = roundTrip([[two], [twoB]]);
ok('one argument with two defaults stays apart', r.rows.length, 2);

r = roundTrip([[bare('1,2,3')], [bare('4,5,6')]]);
ok('a color written outside an argument stays apart', r.rows.length, 2);

console.log(failed ? `\n${failed} failure(s)` : '\nall tests passed');
process.exit(failed ? 1 : 0);
