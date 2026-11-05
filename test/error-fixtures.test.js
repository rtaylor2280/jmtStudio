/**
 * Every error Studio can detect, against a config that really has it.
 *
 * test/error-fixtures/faults.js holds one broken config per detection. captured/ holds what the
 * real compiler said about each one, from harness.js. So this checks the two layers on real
 * input: the preflight check fires on the config, and the matrix picks the right signature out
 * of the real compiler output. Re-run the capture after a toolchain or ProffieOS change.
 *
 * Run: node test/error-fixtures.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const preflight = require('../renderer/preflight.js');
require('../renderer/preflight-checks.js');
const { SIGNATURES, resolve } = require('../compileErrorMatrix');
const { extractCompileError } = require('../compileErrors');
const { BASE, FAULTS, ALL_AT_ONCE, TEST_ORDER, apply } = require('./error-fixtures/faults');

const CAPTURED = path.join(__dirname, 'error-fixtures', 'captured');
// Checks that read the selected OS version get it from the harness's own copy, when present.
const TREE = path.join(__dirname, '..', 'local', 'nightly', 'flash-exp', 'ProffieOS');
const inTree = rel => path.join(TREE, String(rel).replace(/^ProffieOS[\\/]/, ''));
let _headers = null;
const headers = () => {
  if (_headers) return _headers;
  _headers = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(h|ino)$/.test(e.name)) {
        _headers.push({ path: `ProffieOS/${path.relative(TREE, p).replace(/\\/g, '/')}`,
                        text: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  _headers.push({ path: 'ProffieOS/ProffieOS.ino', text: fs.readFileSync(path.join(TREE, 'ProffieOS.ino'), 'utf8') });
  for (const d of ['blades', 'common', 'display', 'functions', 'layers', 'modes', 'motion', 'props',
                   'sound', 'styles', 'transitions']) {
    if (fs.existsSync(path.join(TREE, d))) walk(path.join(TREE, d));
  }
  return _headers;
};
const treeOpts = fs.existsSync(TREE) ? {
  versionName: '8.10',
  readVersionFile: async (v, rel) => {
    try { return { ok: true, content: fs.readFileSync(inTree(rel), 'utf8') }; }
    catch { return { ok: false }; }
  },
  listVersionDir: async (v, sub) => {
    try {
      return { ok: true, entries: fs.readdirSync(inTree(sub), { withFileTypes: true })
        .map(e => ({ name: e.name, type: e.isDirectory() ? 'folder' : 'file' })) };
    } catch { return { ok: false, error: 'Path not found.' }; }
  },
  searchVersionFiles: async (v, q) => ({ ok: true,
    results: headers().filter(h => h.text.includes(q)).map(h => ({ path: h.path, type: 'file' })) }),
} : null;
const contextFor = (text, name) => preflight.buildContext({ text, configName: name, ...(treeOpts || {}) });

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

// Fired by the compiler's own config rather than a fault, or not reachable from a config.
const NOT_FROM_A_FAULT = new Set([
  'sram2-not-declared', 'ltrans-serial', 'config-file-not-set',
  'template-argument-invalid', 'define-with-no-value', 'define-string-vs-number',
]);

(async () => {
  const baseCtx = preflight.buildContext({ text: BASE, configName: 'Base.h' });
  const base = await preflight.run(baseCtx);
  ok('the base config fires nothing', base.findings.length === 0,
     base.findings.map(f => f.checkId).join(','));

  for (const f of FAULTS) {
    const text = apply(f);
    if (f.check && (!f.needsTree || treeOpts)) {
      const res = await preflight.run(contextFor(text, `B266_Test_${f.id}.h`));
      const ids = res.findings.map(x => x.checkId);
      ok(`${f.id}: ${f.check} fires`, ids.includes(f.check), ids.join(','));
    }
    const file = path.join(CAPTURED, `${f.id}.txt`);
    if (!fs.existsSync(file)) { ok(`${f.id}: compiler output captured`, false); continue; }
    const log = fs.readFileSync(file, 'utf8');
    if (f.compiles) { ok(`${f.id}: builds`, log.startsWith('COMPILED'), log.slice(0, 200)); continue; }
    ok(`${f.id}: fails to compile`, log.startsWith('FAILED'));
    const propFiles = ['dual_prop.h', 'saber.h', 'saber_fett263_buttons.h'];
    const hit = resolve(log, text, '', propFiles);
    ok(`${f.id}: resolves to ${f.sig}`, hit && hit.id === f.sig, hit ? hit.id : 'nothing');
    const message = extractCompileError(log, { configText: text, propFiles });
    ok(`${f.id}: nothing left unrendered`, !/\{\w+\}/.test(message), message.slice(0, 120));
  }

  const all = await preflight.run(contextFor(ALL_AT_ONCE, 'B266_Test_ALL_at_once.h'));
  const allIds = new Set(all.findings.map(f => f.checkId));
  console.log(`combined config: ${all.findings.length} cards from ${allIds.size} checks; `
            + `missing ${preflight.checks().map(c => c.id).filter(c => !allIds.has(c)).join(', ') || 'none'}`);
  ok('the combined config fills the dialog', all.findings.length >= 12, String(all.findings.length));
  const commaCards = all.findings.filter(f => /comma/.test(f.title));
  ok('every missing comma shares one card', commaCards.length === 1 && commaCards[0].items.length === 5,
     commaCards.map(f => f.title).join(' / '));
  const edits = commaCards[0].fix.plan(contextFor(ALL_AT_ONCE, 'x.h'));
  ok('its one button adds all five', edits.length === 5, String(edits.length));

  ok('the test order holds every fault once',
     TEST_ORDER.length === FAULTS.length && FAULTS.every(f => TEST_ORDER.includes(f.id)),
     FAULTS.filter(f => !TEST_ORDER.includes(f.id)).map(f => f.id).join(','));

  for (const [word, count] of [['semicolon', 2], ['includes itself', 2]]) {
    const cards = all.findings.filter(f => f.title.includes(word));
    ok(`one card for ${word}`, cards.length === 1, cards.map(f => f.title).join(' / '));
    ok(`its button fixes all ${count}`, cards[0] && cards[0].fix.plan(contextFor(ALL_AT_ONCE, 'x.h')).length === count);
  }
  const twoOpen = await preflight.run(contextFor(
    'Preset a[] = {\n  { "f", "t", StylePtr<Blue>(), "A" },\n\nPreset b[] = {\n  { "f", "t", StylePtr<Blue>(), "B" },\n', 'x.h'));
  const openCards = twoOpen.findings.filter(f => /never close/.test(f.title));
  ok('lists that never close share one card', openCards.length === 1, twoOpen.findings.map(f => f.title).join(' / '));

  ok('a setup() in the config says the config',
     /Remove the setup\(\) from your config/.test(extractCompileError(fs.readFileSync(path.join(CAPTURED, 'setup_defined_twice.txt'), 'utf8'))));
  ok('a setup() in a prop names the prop and its line',
     /Remove the setup\(\) from saber_custom\.h line 12/.test(extractCompileError(
       "<OS>\\ProffieOS.ino:1602:6: error: redefinition of 'void setup()'\n"
       + "<OS>\\props\\saber_custom.h:12:6: note: 'void setup()' previously defined here")));

  ok('a wrong board names both boards',
     /for Proffieboard V2, and Proffieboard V3 is selected/.test(extractCompileError(
       `FQBN: proffieboard:stm32l4:ProffieboardV3-L452RE:usb=cdc_webusb\n${fs.readFileSync(path.join(CAPTURED, 'wrong_board.txt'), 'utf8')}`)));

  const typoLog = fs.readFileSync(path.join(CAPTURED, 'prop_typo.txt'), 'utf8');
  ok('a prop one letter off is called a typo when compiling',
     /Probably a typo[\s\S]*It does have dual_prop\.h/.test(extractCompileError(typoLog, { propFiles: ['dual_prop.h', 'saber.h'] })));
  ok('with no prop close by, it is not called a typo',
     !/typo/i.test(extractCompileError(typoLog, { propFiles: ['saber.h'] })));
  if (treeOpts) {
    const res = await preflight.run(contextFor(apply(FAULTS.find(f => f.id === 'prop_typo')), 'x.h'));
    const card = res.findings.find(f => f.checkId === 'prop-missing-from-version');
    ok('a prop one letter off gets a button', card && card.fix && /dual_prop\.h/.test(card.fix.label));
    ok('the button changes only the name', card && card.fix.plan({ text: apply(FAULTS.find(f => f.id === 'prop_typo')) })[0].text === 'dual_prop.h');
  }

  const off = FAULTS.find(f => f.id === 'style_switched_off');
  const offLog = fs.readFileSync(path.join(CAPTURED, 'style_switched_off.txt'), 'utf8');
  ok('a switched off style names its line',
     /#ifdef MY_SPECIAL_STYLES on line \d+/.test(extractCompileError(offLog, { configText: apply(off) })));
  ok('in the Style Library it names the library',
     /in your Style Library/.test(extractCompileError(offLog, {
       configText: apply(off).replace(/#ifdef MY_SPECIAL_STYLES\nusing GateBlue = Blue;\n#endif\n/, ''),
       stylesText: '#ifdef MY_SPECIAL_STYLES\nusing GateBlue = Blue;\n#endif\n',
     })));

  if (treeOpts) {
    const res = await preflight.run(contextFor(apply(FAULTS.find(f => f.id === 'prop_defines_no_prop')), 'x.h'));
    ok('prop defines with no prop are one card', res.findings.length === 1 && res.findings[0].rows.length === 2,
       res.findings.map(f => f.title).join(' / '));
    const both = await preflight.run(contextFor(BASE.replace('#define ENABLE_SD\n', '#define ENABLE_SD\n#define JMT_BLADE_DETECT\n#define FETT263_MAX_CLASH 16\n'), 'x.h'));
    ok('a prop that includes another covers both',
       both.findings.length === 1 && /2 options for jmt_fett263_wrapper\.h/.test(both.findings[0].title),
       both.findings.map(f => f.title).join(' / '));
    const fettOnly = await preflight.run(contextFor(BASE.replace('#define ENABLE_SD\n', '#define ENABLE_SD\n#define FETT263_MAX_CLASH 16\n'), 'x.h'));
    ok('on its own the plain prop is named, not the wrapper',
       /for saber_fett263_buttons\.h/.test(fettOnly.findings[0].title), fettOnly.findings.map(f => f.title).join(' / '));
    const two = await preflight.run(contextFor(BASE.replace('#define ENABLE_SD\n', '#define ENABLE_SD\n#define BC_BUTTON_CLICKER\n#define FETT263_MAX_CLASH 16\n'), 'x.h'));
    ok('two different props are one card that says to choose',
       two.findings.length === 1 && /2 different props/.test(two.findings[0].title)
       && two.findings[0].rows.length === 2 && /saber_BC_buttons\.h or saber_fett263_buttons\.h/.test(two.findings[0].detail),
       two.findings.map(f => `${f.title} ${f.detail}`).join(' / '));
    const jmt = await preflight.run(contextFor(BASE.replace('#define ENABLE_SD\n', '#define ENABLE_SD\n#define JMT_BLADE_DETECT\n'), 'x.h'));
    ok('a define only a prop reads names that prop',
       jmt.findings.length === 1 && /for jmt_fett263_wrapper\.h/.test(jmt.findings[0].title),
       jmt.findings.map(f => f.title).join(' / '));
  }

  const covered = new Set(FAULTS.map(f => f.sig));
  const missing = SIGNATURES.map(s => s.id).filter(id => !covered.has(id) && !NOT_FROM_A_FAULT.has(id));
  ok('every signature has a fault', missing.length === 0, missing.join(', '));

  const checks = preflight.checks().map(c => c.id);
  const fired = new Set(FAULTS.map(f => f.check));
  const unfired = checks.filter(c => !fired.has(c));
  console.log(`checks with no fault here: ${unfired.join(', ') || 'none'}`);

  console.log(failed ? `\n${failed} failure(s)` : '\nall error fixture tests passed');
  process.exit(failed ? 1 : 0);
})();
