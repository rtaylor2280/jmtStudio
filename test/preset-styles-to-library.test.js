'use strict';
// Runs the planner behind Add Styles to Library against real parsed configs. [B-367]

const { parsePresets, planLibraryStyles, nameSlotStyle, styleCodeKey } = require('../renderer/presetParser.js');

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

console.log(failed ? `\n${failed} failure(s)` : '\nall tests passed');
process.exit(failed ? 1 : 0);
