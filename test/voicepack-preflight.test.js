/**
 * Voicepack preflight — unit tests for the pure logic.
 *
 * The functions live in the inline <script> of renderer/index.html, so rather
 * than copy them (a copy proves nothing) this extracts the real source text and
 * evaluates it. If someone edits the implementation, these tests see the edit.
 *
 * Covers the three things most likely to break it:
 *   1. comment stripping, where a //***** banner must NOT swallow real code
 *   2. #ifdef/#ifndef evaluation against the config's own defines
 *   3. the three spellings of an init() call, including the macro form that a
 *      symbol search misses (that miss cost a whole investigation on 07-30)
 * Plus the preset scan against the real presetParser.
 *
 * Run: node test/voicepack-preflight.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const presetParser = require(path.join(ROOT, 'renderer', 'presetParser.js'));

// ── extract the implementation out of index.html ────────────────────────
function extract(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`could not extract ${startMarker.slice(0, 40)}…`);
  return html.slice(a, b);
}

// `const` declarations in a vm script stay lexical and never appear on the
// context object, so the extracted source gets an explicit export line appended.
const EXPORTS = ['_vpkStripComments', '_vpkLiveText', '_VPK_INIT_RE', '_vpkConfigDefines',
                 '_vpkPropIncludes', '_vpkScanPresets', '_vpkEsc'];

const src = extract('function _vpkStripComments(src) {', 'const _vpkEsc =')
          + extract('const _vpkEsc =', '// Compile gate.')
          + `\n;globalThis.__vpk = { ${EXPORTS.join(', ')} };\n`;

// `window` because the extracted block exposes the prop check on it for the
// Sound Fonts view, which lives in a different IIFE.
const ctx = { presetParser, console, module: {}, window: {}, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'index.html:voicepack-preflight' });

const { _vpkStripComments, _vpkLiveText, _VPK_INIT_RE, _vpkConfigDefines,
        _vpkPropIncludes, _vpkScanPresets } = ctx.__vpk;

// ── tiny harness ────────────────────────────────────────────────────────
let failures = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS ', name); }
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── 1. comment stripping ────────────────────────────────────────────────
{
  const banner = [
    '//*********************************************',
    '#define KEEP_ME',
    '//*********************************************',
    '#define ALSO_KEEP',
  ].join('\n');
  const out = _vpkStripComments(banner);
  ok('banner comment does not swallow the lines between',
     /KEEP_ME/.test(out) && /ALSO_KEEP/.test(out),
     `got: ${JSON.stringify(out)}`);

  ok('real block comment IS removed',
     !/hidden/.test(_vpkStripComments('/* hidden */ #define VISIBLE')));

  ok('a comment marker inside a string literal is left alone',
     /http/.test(_vpkStripComments('const s = "http://example.com"; // gone')));

  ok('the fett263-style giant doc block is removed whole',
     !/MENU_SPEC_TEMPLATE/.test(
       _vpkStripComments('/* docs\n#define MENU_SPEC_TEMPLATE FETT263_MENU_SPEC\n*/\nint x;')));
}

// ── 2. conditional evaluation ───────────────────────────────────────────
{
  // The real fett263 shape.
  const fett = [
    'void Setup() override {',
    '  RestoreGestureState();',
    '#ifndef MENU_SPEC_TEMPLATE',
    '#ifdef MOUNT_SD_SETTING',
    '   sound_library_v2.init();',
    '#else',
    '   sound_library_.init();',
    '#endif',
    '#endif',
    '}',
  ].join('\n');

  const noMenuSpec = _vpkLiveText(fett, new Set(['MOUNT_SD_SETTING']));
  ok('fett263: no MENU_SPEC_TEMPLATE -> the init is live',
     _VPK_INIT_RE.test(noMenuSpec), `live text: ${JSON.stringify(noMenuSpec)}`);

  const withMenuSpec = _vpkLiveText(fett, new Set(['MENU_SPEC_TEMPLATE', 'MOUNT_SD_SETTING']));
  ok('fett263: MENU_SPEC_TEMPLATE defined -> that branch is dead',
     !_VPK_INIT_RE.test(withMenuSpec), `live text: ${JSON.stringify(withMenuSpec)}`);

  // prop_base's shape is the mirror image, and is what catches the case above.
  const propBase = [
    '#ifdef MENU_SPEC_TEMPLATE',
    '    MKSPEC<MENU_SPEC_TEMPLATE>::SoundLibrary::init();',
    '#endif',
  ].join('\n');
  ok('prop_base: MENU_SPEC_TEMPLATE defined -> its init is live',
     _VPK_INIT_RE.test(_vpkLiveText(propBase, new Set(['MENU_SPEC_TEMPLATE']))));
  ok('prop_base: MENU_SPEC_TEMPLATE absent -> its init is dead',
     !_VPK_INIT_RE.test(_vpkLiveText(propBase, new Set())));

  // An unknown condition must keep BOTH branches, so a requirement is never missed.
  const unknown = [
    '#if SOMETHING_WE_CANNOT_EVALUATE',
    '  sound_library_.init();',
    '#endif',
  ].join('\n');
  ok('unknown #if keeps its branch live (conservative)',
     _VPK_INIT_RE.test(_vpkLiveText(unknown, new Set())));

  // #else on an unknown frame must also stay live.
  const unknownElse = ['#if WHATEVER', '  nothing();', '#else', '  sound_library_.init();', '#endif'].join('\n');
  ok('#else on an unknown frame stays live',
     _VPK_INIT_RE.test(_vpkLiveText(unknownElse, new Set())));
}

// ── 3. the init regex, all three spellings ──────────────────────────────
{
  ok('matches sound_library_v2.init()',   _VPK_INIT_RE.test('   sound_library_v2.init();'));
  ok('matches sound_library_.init()',     _VPK_INIT_RE.test('   sound_library_.init();'));
  ok('matches MKSPEC<...>::SoundLibrary::init()',
     _VPK_INIT_RE.test('    MKSPEC<BCMenuSpec>::SoundLibrary::init();'));
  ok('does NOT match an unrelated init',  !_VPK_INIT_RE.test('  fusor.init();'));
  ok('does NOT match a mere mention of SoundLibrary',
     !_VPK_INIT_RE.test('  typedef SoundLibraryV2 SoundLibrary;'));
}

// ── 4. define + prop-include extraction ─────────────────────────────────
{
  const cfg = [
    '#ifdef CONFIG_TOP',
    '#define MOUNT_SD_SETTING   // enables sd 1 / sd 0',
    '// #define MENU_SPEC_TEMPLATE DefaultMenuSpec',
    '#endif',
    '#ifdef CONFIG_PROP',
    '#include "../props/jmt_fett263_wrapper.h"',
    '#endif',
  ].join('\n');
  const defines = _vpkConfigDefines(cfg);
  ok('picks up an active define', defines.has('MOUNT_SD_SETTING'));
  ok('ignores a commented-out define', !defines.has('MENU_SPEC_TEMPLATE'));

  const incs = _vpkPropIncludes(cfg);
  ok('finds the prop include inside CONFIG_PROP',
     incs.length === 1 && incs[0] === '../props/jmt_fett263_wrapper.h', JSON.stringify(incs));
}

// ── 5. preset scan, against the real parser ─────────────────────────────
{
  const cfg = [
    'Preset presets[] = {',
    '  { "Vader;common", "tracks/a.wav", StylePtr<Black>(), "Vader" },',
    '  { "Luke", "tracks/b.wav", StylePtr<Black>(), "Luke" },',
    '  { "Windu;MC", "tracks/c.wav", StylePtr<Black>(), "Windu" },',
    '  { "Nested;balvenos/common", "", StylePtr<Black>(), "Nested" },',
    '};',
  ].join('\n');
  const { missing, sharedNames } = _vpkScanPresets(cfg);

  ok('flags exactly the preset with no shared folder',
     missing.length === 1 && missing[0].font === 'Luke',
     `missing: ${JSON.stringify(missing.map(m => m.font))}`);
  ok('does not flag a non-"common" shared folder (MC)',
     !missing.some(m => m.font === 'Windu'));
  ok('does not flag a nested shared path',
     !missing.some(m => m.font === 'Nested'));
  ok('collects every shared name in use',
     ['common', 'MC', 'balvenos/common'].every(n => sharedNames.includes(n)),
     JSON.stringify(sharedNames));
  ok('the flagged preset carries a range to repair',
     !!(missing[0] && missing[0].range));

  const allGood = _vpkScanPresets(cfg.replace('"Luke"', '"Luke;common"'));
  ok('nothing flagged when every preset declares one', allGood.missing.length === 0);

  // A preset the app itself just created: no font yet, shared folder already seeded.
  // Must not be flagged — it HAS the folder, it is simply waiting for a font.
  const seeded = _vpkScanPresets('Preset presets[] = {\n  { ";common", "", StylePtr<Black>(), "Preset 1" },\n};');
  ok('a freshly seeded ";common" preset is not flagged', seeded.missing.length === 0,
     JSON.stringify(seeded.missing));

  // And a preset with no font at all stays skipped, as its own separate problem.
  const bare = _vpkScanPresets('Preset presets[] = {\n  { "", "", StylePtr<Black>(), "Preset 1" },\n};');
  ok('a preset with no font at all is skipped, not flagged', bare.missing.length === 0);
}

// ── 6. what a NEWLY added preset should carry (the Sound Fonts write path) ──
// Ryan's rule, 2026-07-30: A) match the config's own convention if any preset has
// one, on any OS and any prop; OR B) the prop requires a voicepack. The sound font
// library's own "selected common" must NOT be a factor — the library is optional.
function makeChooser({ requires }) {
  const body = extract('const _sfSharedFolderForNewPreset = async () => {',
                       '      const _sfAddPresetWithFont = async (fontName) => {');
  const c = {
    presetParser, console,
    editor: { getValue: () => c.__text },
    window: { __vpkRequiresVoicepack: async () => requires },
    __text: '',
  };
  vm.createContext(c);
  vm.runInContext(body + '\n;globalThis.__pick = _sfSharedFolderForNewPreset;\n', c);
  return (text) => { c.__text = text; return c.__pick(); };
}

const cfgOf = (...fonts) => 'Preset presets[] = {\n' +
  fonts.map((f, i) => `  { "${f}", "", StylePtr<Black>(), "P${i}" },`).join('\n') + '\n};';

(async () => {
  const needs    = makeChooser({ requires: true });
  const notNeeds = makeChooser({ requires: false });

  ok('A: matches the config\'s existing convention',
     await needs(cfgOf('Vader;common', 'Luke;common', 'Rey')) === 'common');

  ok('A: matches a NON-"common" convention (MC), not the default',
     await needs(cfgOf('Windu;MC', 'Graflex;MC', 'Rey')) === 'MC');

  ok('A: most-used name wins, so one typo cannot hijack the convention',
     await needs(cfgOf('A;common', 'B;common', 'C;common', 'D;comn')) === 'common',
     'a ";comn" outlier beside three ";common" must not become the convention');

  ok('A: wins even when the prop does NOT require a voicepack (any OS, any prop)',
     await notNeeds(cfgOf('Vader;common', 'Rey')) === 'common');

  ok('B: no preset has one, but the prop requires -> default name',
     await needs(cfgOf('Vader', 'Luke')) === 'common');

  ok('B: no preset has one and the prop does not require -> nothing',
     await notNeeds(cfgOf('Vader', 'Luke')) === null,
     'writing a folder reference nobody needs is how we would cause font-directory-not-found');

  ok('empty config -> nothing', await needs('') === null);

  // Regression guard for the thing Ryan explicitly had removed: the library's
  // selected common folder must never influence what we write into a config.
  const sflOnly = makeChooser({ requires: false });
  ok('the sound font library selection is NOT consulted',
     await sflOnly(cfgOf('Vader', 'Luke')) === null,
     'a library selection must not make us write a shared folder into the config');

  console.log(failures ? `\n${failures} failure(s)` : '\nall voicepack preflight tests passed');
  process.exit(failures ? 1 : 0);
})();
