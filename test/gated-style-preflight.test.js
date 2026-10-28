// A style the presets use but that sits inside an #ifdef nothing turns on is caught before compile. [B-180]
//
// Runs the real check against a small fake ProffieOS tree and a fake Style Library:
//   · an add-on's include guard: named, with a fix that adds the include before my_styles.h;
//   · the include present directly, or through the prop wrapper: nothing;
//   · a define gate (CHARGE_DETECT_PIN): named with no fix; defined: nothing;
//   · gated styles nobody uses, or also defined outside the gate: nothing;
//   · styles gated in the config itself, with no Style Library: caught the same way;
//   · version unreadable: unsure, never a guess.
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const preflight = require(path.join(ROOT, 'renderer', 'preflight.js'));
require(path.join(ROOT, 'renderer', 'preflight-checks.js'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const TREE = {
  'ProffieOS/functions/charge_full_prop.h': '#ifndef FUNCTIONS_CHARGE_FULL_PROP_H\n#define FUNCTIONS_CHARGE_FULL_PROP_H\nclass ChargeFullPropF {};\n#endif\n',
  'ProffieOS/styles/pixel_relay.h': '#ifndef STYLES_PIXEL_RELAY_H\n#define STYLES_PIXEL_RELAY_H\n#endif\n',
  'ProffieOS/props/jmt_wrapper.h': '#include "../functions/charge_full_prop.h"\n',
  'ProffieOS/props/plain.h': '// nothing\n',
  'ProffieOS/config/proffieboard_v3_config.h': '#define NUM_BUTTONS_MAX 2\n',
};
const LIBRARY = [
  'using Plain = StyleNormalPtr<Red, White, 300, 800>;',
  '#ifdef FUNCTIONS_CHARGE_FULL_PROP_H',
  'using ChargingButtonStyle = Layers<Black>;',
  'using BatteryBladeStyle = Layers<Black>;',
  '#endif',
  '#ifdef STYLES_PIXEL_RELAY_H',
  'using LukeArrowsWrapper = Layers<Black>;',
  '#endif',
  '#ifdef CHARGE_DETECT_PIN',
  'using PinStyle = Layers<Black>;',
  '#endif',
  '#ifdef FUNCTIONS_CHARGE_FULL_PROP_H',
  'using AlsoFree = Layers<Black>;',
  '#endif',
  'using AlsoFree = Layers<Red>;',
].join('\n');

const config = ({ prop = 'plain.h', top = '', presetsHead = '', styles = ['Plain'], library = true, extra = '' }) => [
  '#ifdef CONFIG_TOP',
  '#include "proffieboard_v3_config.h"',
  top,
  '#endif',
  '#ifdef CONFIG_PROP',
  `#include "../props/${prop}"`,
  '#endif',
  '#ifdef CONFIG_PRESETS',
  presetsHead,
  library ? '#include "my_styles.h"' : '',
  extra,
  'Preset presets[] = {',
  `  { "font", "", ${styles.map((s) => `StylePtr<${s}>()`).join(', ')}, "one" },`,
  '};',
  'BladeConfig blades[] = { { 0, WS281XBladePtr<144, bladePin, Color8::GRB, PowerPINS<bladePowerPin2> >(), CONFIGARRAY(presets) } };',
  '#endif',
].join('\n');

const run = async (text, { tree = TREE, library = LIBRARY } = {}) => {
  const ctx = preflight.buildContext({
    text, versionName: 'v',
    readVersionFile: async (_v, rel) => (rel in tree ? { ok: true, content: tree[rel] } : { ok: false }),
    searchVersionFiles: async (_v, q) => ({ ok: true, results: Object.keys(tree)
      .filter((p) => tree[p].includes(q)).map((p) => ({ path: p, type: 'file' })) }),
    readStylesLibrary: async () => library,
  });
  const r = await preflight.run(ctx);
  return { found: r.findings.filter((f) => f.checkId === 'gated-style-off'), unsure: r.unsure.filter((u) => u.id === 'gated-style-off'), ctx };
};

(async () => {
  let r = await run(config({ styles: ['ChargingButtonStyle', 'BatteryBladeStyle'] }));
  const f = r.found[0];
  check('a gated add-on style with the add-on missing is named, both styles in one finding',
    r.found.length === 1 && /ChargingButtonStyle, BatteryBladeStyle need functions\/charge_full_prop\.h, but this config does not include it\./.test(f.title),
    JSON.stringify(r.found.map((x) => x.title)));
  check('it blocks the compile and lists the preset', f && f.severity === 'block' && f.items.join() === 'one', f && JSON.stringify(f.items));
  const edits = f && f.fixes[0] ? f.fixes[0].plan(r.ctx) : [];
  const lines = r.ctx.text.split('\n');
  const stylesLine = lines.findIndex((l) => l.includes('#include "my_styles.h"')) + 1;
  check('the fix adds the include right before my_styles.h',
    f && f.fixes[0].label === 'Add #include "../functions/charge_full_prop.h"' && edits.length === 1
    && edits[0].startLine === stylesLine && edits[0].text === '#include "../functions/charge_full_prop.h"\n',
    JSON.stringify(edits));

  r = await run(config({ styles: ['ChargingButtonStyle'], presetsHead: '#include "../functions/charge_full_prop.h"' }));
  check('the include present in the config: nothing', r.found.length === 0, JSON.stringify(r.found.map((x) => x.title)));
  r = await run(config({ styles: ['ChargingButtonStyle'], prop: 'jmt_wrapper.h' }));
  check('the include brought in by the prop wrapper: nothing', r.found.length === 0, JSON.stringify(r.found.map((x) => x.title)));

  r = await run(config({ styles: ['LukeArrowsWrapper'] }));
  check('another add-on, found by searching the tree (styles/pixel_relay.h)',
    r.found.length === 1 && /needs styles\/pixel_relay\.h/.test(r.found[0].title), JSON.stringify(r.found.map((x) => x.title)));

  r = await run(config({ styles: ['PinStyle'] }));
  check('a define gate: named, with no fix (its value is the user\'s)',
    r.found.length === 1 && /PinStyle is only defined when CHARGE_DETECT_PIN is defined/.test(r.found[0].title)
    && r.found[0].fixes.length === 0, JSON.stringify(r.found.map((x) => [x.title, x.fixes.length])));
  r = await run(config({ styles: ['PinStyle'], top: '#define CHARGE_DETECT_PIN 7' }));
  check('the define present: nothing', r.found.length === 0);

  r = await run(config({ styles: ['Plain'] }));
  check('gated styles nobody uses: nothing', r.found.length === 0);
  r = await run(config({ styles: ['AlsoFree'] }));
  check('a style also defined outside any gate: nothing', r.found.length === 0);

  r = await run(config({ library: false, styles: ['Local'], extra: '#ifdef FUNCTIONS_CHARGE_FULL_PROP_H\nusing Local = Layers<Black>;\n#endif' }), { library: null });
  check('no Style Library: a style gated in the config itself is caught the same way',
    r.found.length === 1 && /Local needs functions\/charge_full_prop\.h/.test(r.found[0].title), JSON.stringify(r.found.map((x) => x.title)));
  r = await run(config({ library: false, styles: ['ChargingButtonStyle'] }));
  check('the config does not include my_styles.h: the library is not read', r.found.length === 0);

  // The real shape: charge_full_prop.h only declares g_charge_full (through common/charge_state.h), and
  // only the JMT wrapper prop defines it. On any other prop the include compiles and the link fails.
  const LINK_TREE = {
    'ProffieOS/functions/charge_full_prop.h': '#ifndef FUNCTIONS_CHARGE_FULL_PROP_H\n#define FUNCTIONS_CHARGE_FULL_PROP_H\n#include "../common/charge_state.h"\nclass ChargeFullPropF {};\n#endif\n',
    'ProffieOS/common/charge_state.h': '#ifndef CHARGE_STATE_H\n#define CHARGE_STATE_H\nextern bool g_charge_full;\n#endif\n',
    'ProffieOS/props/jmt_fett263_wrapper.h': '#include "saber_fett263_buttons.h"\nbool g_charge_full = false;\nvoid f() {\n\t\tg_charge_full = false;\n}\n',
    'ProffieOS/props/saber_fett263_buttons.h': '// plain\n',
    'ProffieOS/config/proffieboard_v3_config.h': '#define NUM_BUTTONS_MAX 2\n',
  };
  r = await run(config({ styles: ['ChargingButtonStyle'], prop: 'saber_fett263_buttons.h' }), { tree: LINK_TREE });
  check('a prop that does not define what the add-on uses: named as the prop it needs, with no fix',
    r.found.length === 1 && /ChargingButtonStyle needs the jmt_fett263_wrapper\.h prop, and this config's prop does not support it\./.test(r.found[0].title)
    && /undefined reference to g_charge_full/.test(r.found[0].detail) && !(r.found[0].fixes || []).length,
    JSON.stringify(r.found.map((x) => [x.title, (x.fixes || []).length])));
  r = await run(config({ styles: ['ChargingButtonStyle'], prop: 'saber_fett263_buttons.h', presetsHead: '#include "../functions/charge_full_prop.h"' }), { tree: LINK_TREE });
  check('the same with the include already there: still named, since it will not link',
    r.found.length === 1 && /needs the jmt_fett263_wrapper\.h prop/.test(r.found[0].title), JSON.stringify(r.found.map((x) => x.title)));
  r = await run(config({ styles: ['ChargingButtonStyle'], prop: 'jmt_fett263_wrapper.h' }), { tree: LINK_TREE });
  check('the wrapper prop without the include: the include fix',
    r.found.length === 1 && /needs functions\/charge_full_prop\.h/.test(r.found[0].title) && r.found[0].fixes.length === 1,
    JSON.stringify(r.found.map((x) => x.title)));
  r = await run(config({ styles: ['ChargingButtonStyle'], prop: 'jmt_fett263_wrapper.h', presetsHead: '#include "../functions/charge_full_prop.h"' }), { tree: LINK_TREE });
  check('the wrapper prop and the include: nothing', r.found.length === 0, JSON.stringify(r.found.map((x) => x.title)));

  r = await run(config({ styles: ['ChargingButtonStyle'] }), { tree: {} });
  check('the selected ProffieOS cannot be read: unsure, not a guess', r.found.length === 0 && r.unsure.length === 1, JSON.stringify(r.unsure));

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
