// One broken config per error Studio can detect.
//
// Each fault is the base config with one deliberate mistake:
//   id       file name, numbered by TEST_ORDER in the Error Intelligence Tests folder
//   edits    [[find, replace], ...] applied to the base, each must match
//   sig      the compile signature expected from the real compiler output
//   check    the preflight check expected to fire
//   compiles true when the fault is a warning and the build succeeds
//   os       the ProffieOS version to compile on when it is not 8.10
//   see      what the dialog should say, written into the file's header
//
// test/error-fixtures.test.js covers the table. harness.js writes the files and captures compiler output.

'use strict';

const BASE = `#ifdef CONFIG_TOP
#include "proffieboard_v3_config.h"
#define NUM_BLADES 1
#define NUM_BUTTONS 2
#define VOLUME 1500
const unsigned int maxLedsPerStrip = 144;
#define CLASH_THRESHOLD_G 3.0
#define ENABLE_AUDIO
#define ENABLE_MOTION
#define ENABLE_WS2811
#define ENABLE_SD
#endif

#ifdef CONFIG_PROP
#endif

#ifdef CONFIG_PRESETS
Preset presets[] = {
  { "Font1;common", "tracks/track1.wav",
    StylePtr<InOutHelper<Blue, 300, 800, Black>>(),
    "One" },
  { "Font2;common", "tracks/track2.wav",
    StylePtr<InOutHelper<Red, 300, 800, Black>>(),
    "Two" },
};
BladeConfig blades[] = {
  { 0, WS281XBladePtr<144, bladePin, Color8::GRB, PowerPINS<bladePowerPin2, bladePowerPin3> >(),
    CONFIGARRAY(presets) },
};
#endif

#ifdef CONFIG_BUTTONS
Button PowerButton(BUTTON_POWER, powerButtonPin, "pow");
Button AuxButton(BUTTON_AUX, auxPin, "aux");
#endif
`;

const STYLE1 = 'StylePtr<InOutHelper<Blue, 300, 800, Black>>()';
const BLADE = 'WS281XBladePtr<144, bladePin, Color8::GRB, PowerPINS<bladePowerPin2, bladePowerPin3> >()';
const BLADE2 = 'WS281XBladePtr<144, blade2Pin, Color8::GRB, PowerPINS<bladePowerPin4> >()';

const FAULTS = [
  // ── Presets ──────────────────────────────────────────────────────────────
  { id: 'comma_after_font', check: 'preset-delimiters', sig: 'style-where-track-goes',
    edits: [['"Font1;common", "tracks/track1.wav"', '"Font1;common" "tracks/track1.wav"']],
    see: 'Preset One is missing a comma after its font, with an Add the comma button.' },
  { id: 'comma_after_track', check: 'preset-delimiters', sig: 'expected-brace-before',
    edits: [['"tracks/track1.wav",', '"tracks/track1.wav"']],
    see: 'Preset One is missing a comma after its track, with an Add the comma button.' },
  { id: 'comma_after_style', check: 'preset-delimiters', sig: 'expected-brace-before',
    edits: [[`${STYLE1},`, STYLE1]],
    see: 'Preset One is missing a comma after style 1, with an Add the comma button.' },
  { id: 'comma_between_styles', check: 'preset-delimiters', sig: 'expected-brace-before',
    edits: [['#define NUM_BLADES 1', '#define NUM_BLADES 2'],
            [`${STYLE1},`, `${STYLE1}\n    ${STYLE1},`],
            ['StylePtr<InOutHelper<Red, 300, 800, Black>>(),', 'StylePtr<InOutHelper<Red, 300, 800, Black>>(),\n    StylePtr<InOutHelper<Red, 300, 800, Black>>(),'],
            [`${BLADE},`, `${BLADE},\n    ${BLADE2},`]],
    see: 'Preset One is missing a comma after style 1, with an Add the comma button.' },
  { id: 'comma_between_presets', check: 'preset-delimiters', sig: 'expected-brace-before',
    edits: [['"One" },', '"One" }']],
    see: 'Preset One is missing a comma after it, with an Add the comma button.' },
  { id: 'preset_list_closes_early', check: 'preset-delimiters', sig: 'stray-brace-at-top-level',
    edits: [['"One" },', '"One" }},']],
    see: 'The preset list closes early on line N. No fix button.' },
  { id: 'preset_list_never_closes', check: 'preset-delimiters', sig: 'expected-brace-before',
    edits: [['    "Two" },\n};', '    "Two" },\n']],
    see: 'The preset list starting on line N never closes. No fix button.' },
  { id: 'short_preset', check: 'blade-style-count', sig: 'style-count-mismatch',
    edits: [['#define NUM_BLADES 1', '#define NUM_BLADES 2'],
            ['StylePtr<InOutHelper<Red, 300, 800, Black>>(),', 'StylePtr<InOutHelper<Red, 300, 800, Black>>(),\n    StylePtr<InOutHelper<Red, 300, 800, Black>>(),'],
            [`${BLADE},`, `${BLADE},\n    ${BLADE2},`]],
    see: 'Preset One has 1 of 2 blade styles.' },
  { id: 'extra_style', check: 'blade-style-count', sig: 'too-many-initializers-preset',
    edits: [[`${STYLE1},`, `${STYLE1},\n    ${STYLE1},`]],
    see: 'Preset One has 2 blade styles for 1 blade.' },
  { id: 'extra_string_in_preset', sig: 'too-many-initializers-preset',
    edits: [['"One" },', '"One", "Extra" },']],
    see: 'Compile anyway: too many parts in a preset.' },
  { id: 'unknown_style_name', check: 'unknown-style-factory', needsTree: true, sig: 'unknown-identifier-with-suggestion',
    edits: [[STYLE1, 'StyleRainBowPtr<300, 800>()']],
    see: 'There is no style called StyleRainBowPtr, suggesting StyleRainbowPtr.' },
  { id: 'misspelled_colour', sig: 'unknown-identifier-with-suggestion',
    edits: [['InOutHelper<Blue,', 'InOutHelper<Bluue,']],
    see: 'Compile anyway: a likely typo, naming Blue.' },
  { id: 'unknown_name', sig: 'not-declared-in-scope',
    edits: [['InOutHelper<Blue,', 'InOutHelper<Zzqxv,']],
    see: 'Compile anyway: Zzqxv is not in this ProffieOS version.' },
  { id: 'near_miss_name', sig: 'unknown-identifier-with-suggestion',
    edits: [['InOutHelper<Blue,', 'InOutHelperr<Blue,']],
    see: 'Compile anyway: a likely typo, naming InOutHelper.' },
  { id: 'unquoted_font', sig: 'unquoted-preset-name',
    edits: [['"Font1;common",', 'Font1,']],
    see: 'Compile: Font1 needs quotes.' },
  { id: 'extra_angle_bracket', sig: 'expected-primary-expression',
    edits: [[STYLE1, 'StylePtr<InOutHelper<Blue, 300, 800, Black>>>()']],
    see: 'Compile anyway: a style expression is malformed.' },
  { id: 'missing_angle_bracket', sig: 'template-arg-parse-error',
    edits: [[STYLE1, 'StylePtr<InOutHelper<Blue, 300, 800, Black>()']],
    see: 'Compile anyway: a bracket is missing in a style.' },
  { id: 'missing_style_parens', sig: 'styleptr-unresolved',
    edits: [[STYLE1, 'StylePtr<InOutHelper<Blue, 300, 800, Black>>']],
    see: 'Compile anyway: StylePtr is missing its closing ().' },
  { id: 'empty_styleptr', sig: 'empty-styleptr',
    edits: [[STYLE1, 'StylePtr<>()']],
    see: 'Compile anyway: an empty StylePtr.' },
  { id: 'wrong_argument_count', sig: 'wrong-template-arg-count',
    edits: [['InOutHelper<Blue, 300, 800, Black>', 'InOutTrL<Blue>']],
    see: 'Compile anyway: wrong number of arguments.' },
  { id: 'number_where_style_goes', sig: 'template-type-value-mismatch',
    edits: [['InOutHelper<Blue, 300, 800, Black>', 'Layers<Blue, 5>']],
    see: 'Compile anyway: a number where a style goes.' },
  { id: 'string_where_number_goes', sig: 'string-where-number-expected',
    edits: [['InOutHelper<Blue, 300, 800, Black>', 'InOutHelper<Blue, "300", 800, Black>']],
    see: 'Compile anyway: text where a number goes.' },
  { id: 'missing_semicolon_after_presets', check: 'preset-delimiters', sig: 'expected-comma-or-semicolon',
    edits: [['    "Two" },\n};', '    "Two" },\n}']],
    see: 'The preset list ending on line N is missing its semicolon, with an Add the semicolon button.' },
  { id: 'stray_brace', sig: 'stray-brace-at-top-level',
    edits: [['Preset presets[] = {', '{\nPreset presets[] = {'],
            ['#ifdef CONFIG_BUTTONS', '}\n#endif\n#ifdef CONFIG_BUTTONS'],
            ['CONFIGARRAY(presets) },\n};\n#endif\n', 'CONFIGARRAY(presets) },\n};\n']],
    see: 'Compile anyway: a stray brace outside any list.' },

  // ── Blade config ─────────────────────────────────────────────────────────
  { id: 'too_many_blades', check: 'bladeconfig-blade-count', sig: 'bladeconfig-too-many-blades',
    edits: [[`${BLADE},`, `${BLADE},\n    ${BLADE2},`]],
    see: 'A blade config on line N lists 2 blades, but NUM_BLADES is 1.' },
  { id: 'too_few_blades', check: 'bladeconfig-blade-count', sig: 'bladeconfig-too-few-blades',
    edits: [['#define NUM_BLADES 1', '#define NUM_BLADES 2'],
            [`${STYLE1},`, `${STYLE1},\n    ${STYLE1},`],
            ['StylePtr<InOutHelper<Red, 300, 800, Black>>(),', 'StylePtr<InOutHelper<Red, 300, 800, Black>>(),\n    StylePtr<InOutHelper<Red, 300, 800, Black>>(),']],
    see: 'A blade config on line N lists 1 blade, but NUM_BLADES is 2.' },
  { id: 'preset_list_not_found', check: 'bladeconfig-preset-list', sig: 'dangling-preset-array',
    edits: [['CONFIGARRAY(presets)', 'CONFIGARRAY(blade_1)']],
    see: 'A blade config on line N uses the preset list blade_1, but this config has no list with that name.' },
  { id: 'pixel_count_is_text', sig: 'blade-pixel-count-not-a-number',
    edits: [['WS281XBladePtr<144,', 'WS281XBladePtr<"144",']],
    see: 'Compile anyway: the pixel count is text.' },
  { id: 'too_many_leds', sig: 'maxleds-static-assert',
    edits: [['maxLedsPerStrip = 144', 'maxLedsPerStrip = 100'],
            [BLADE, 'WS2811BladePtr<144, WS2811_800kHz | WS2811_GRB, bladePin, PowerPINS<bladePowerPin2, bladePowerPin3> >()']],
    see: 'Compile anyway: raise maxLedsPerStrip.' },

  // ── Structure ────────────────────────────────────────────────────────────
  { id: 'self_include', check: 'self-include', sig: 'include-nested-too-deeply',
    edits: [['#ifdef CONFIG_PROP\n', '#ifdef CONFIG_PROP\n#include "my_config.h"\n']],
    see: 'This config includes itself on line N, with a Remove the line button.' },
  { id: 'curly_quotes', check: 'curly-quotes', sig: 'smart-quotes',
    edits: [['#include "proffieboard_v3_config.h"', '#include \u201Cproffieboard_v3_config.h\u201D']],
    see: 'This config has curly quotes on line N where it needs straight ones, with a Use straight quotes button. The board still reads as V3, with no prompt to insert one.' },
  { id: 'misspelled_board_header', sig: 'missing-core-header',
    edits: [['proffieboard_v3_config.h', 'proffieboard_v9_config.h']],
    see: 'Compile anyway: that header does not exist.' },
  { id: 'wrong_board', sig: 'wrong-board-selected',
    edits: [['proffieboard_v3_config.h', 'proffieboard_v2_config.h']],
    see: 'Nothing to test in Studio: the Board dropdown and the include stay in step, so this builds. The message is covered by the automated test.' },
  { id: 'presets_outside_section', sig: 'preset-outside-section',
    edits: [['#ifdef CONFIG_PRESETS\n', ''],
            ['#ifdef CONFIG_PROP\n#endif\n', '#ifdef CONFIG_PROP\n#endif\n#ifdef CONFIG_NOTHING\n#endif\n'],
            ['CONFIGARRAY(presets) },\n};\n#endif\n', 'CONFIGARRAY(presets) },\n};\n']],
    see: 'Compile anyway: Preset is outside the CONFIG_PRESETS section.' },
  { id: 'no_board_header', sig: 'board-header-missing',
    edits: [['#include "proffieboard_v3_config.h"\n', '']],
    see: 'Compile anyway: the board include is missing.' },
  { id: 'absolute_include', sig: 'absolute-path-include',
    edits: [['#include "proffieboard_v3_config.h"', '#include "C:/Users/me/Documents/proffieboard_v3_config.h"']],
    see: 'Compile anyway: an include uses a full path.' },
  { id: 'include_without_quotes', sig: 'malformed-include',
    edits: [['#include "proffieboard_v3_config.h"', '#include proffieboard_v3_config.h']],
    see: 'Compile anyway: an include is malformed.' },
  { id: 'missing_endif', sig: 'unterminated-ifdef',
    edits: [['#define ENABLE_SD\n#endif\n', '#define ENABLE_SD\n']],
    see: 'Compile anyway: a section is never closed.' },
  { id: 'extra_endif', sig: 'endif-without-if',
    edits: [['#ifdef CONFIG_PROP\n#endif\n', '#ifdef CONFIG_PROP\n#endif\n#endif\n']],
    see: 'Compile anyway: an #endif has nothing to close.' },
  { id: 'misspelled_presets_section', sig: 'presets-section-missing',
    edits: [['#ifdef CONFIG_PRESETS', '#ifdef CONFIG_PRESET']],
    see: 'Compile anyway: the presets section is missing.' },
  { id: 'prop_in_top_section', sig: 'prop-include-outside-section',
    edits: [['#define ENABLE_SD\n', '#define ENABLE_SD\n#include "../props/saber_fett263_buttons.h"\n']],
    see: 'Compile anyway: the prop include belongs in CONFIG_PROP.' },
  { id: 'prop_button_count', sig: 'prop-button-count-unsupported',
    edits: [['#define NUM_BUTTONS 2', '#define NUM_BUTTONS 1'],
            ['#ifdef CONFIG_PROP\n', '#ifdef CONFIG_PROP\n#include "../props/saber_caiwyn_buttons.h"\n']],
    see: 'Compile anyway: this prop needs a different number of buttons.' },
  { id: 'duplicate_button', sig: 'duplicate-button',
    edits: [['Button AuxButton(BUTTON_AUX, auxPin, "aux");', 'Button PowerButton(BUTTON_AUX, auxPin, "aux");']],
    see: 'Compile anyway: a button is declared twice.' },
  { id: 'define_without_value', sig: 'define-empty-named',
    edits: [['#define NUM_BUTTONS 2', '#define NUM_BUTTONS']],
    see: 'Compile: NUM_BUTTONS has no value.' },
  { id: 'define_string_not_number', sig: 'define-quoted-number-named',
    edits: [['#define VOLUME 1500', '#define VOLUME "1500"']],
    see: 'Compile: VOLUME has quotes around a number.' },
  { id: 'two_types', sig: 'two-or-more-data-types',
    edits: [['const unsigned int maxLedsPerStrip', 'const unsigned int float maxLedsPerStrip']],
    see: 'Compile anyway: two types in a declaration.' },
  { id: 'setup_defined_twice', sig: 'redefinition-of-setup',
    edits: [['#ifdef CONFIG_BUTTONS\n', '#ifdef CONFIG_BOTTOM\nvoid setup() {}\n#endif\n#ifdef CONFIG_BUTTONS\n']],
    see: 'Compile anyway: setup is defined twice.' },
  { id: 'element_in_wrong_position', sig: 'style-element-wrong-os-version',
    edits: [[STYLE1, 'StylePtr<TrFade<300>>()']],
    see: 'Compile anyway: TrFade does not work in that position.' },
  { id: 'volume_without_value', sig: 'define-empty-used',
    edits: [['#define VOLUME 1500', '#define VOLUME']],
    see: 'Compile: VOLUME has no value.' },
  { id: 'missing_volume_define', sig: 'missing-required-define',
    edits: [['#define VOLUME 1500\n', '']],
    see: 'Compile anyway: VOLUME must be defined.' },
  { id: 'prop_not_in_version', check: 'prop-missing-from-version', needsTree: true, sig: 'prop-file-missing',
    edits: [['#ifdef CONFIG_PROP\n', '#ifdef CONFIG_PROP\n#include "../props/not_a_real_prop.h"\n']],
    see: 'This prop is not in the selected ProffieOS version.' },
  { id: 'prop_typo', check: 'prop-missing-from-version', needsTree: true, sig: 'prop-file-near-match',
    edits: [['#ifdef CONFIG_PROP\n', '#ifdef CONFIG_PROP\n#include "../props/duel_prop.h"\n']],
    see: 'Probably a typo in the prop name, naming dual_prop.h, with a Change to dual_prop.h button.' },
  { id: 'style_switched_off', check: 'gated-style-off', needsTree: true, sig: 'style-switched-off',
    edits: [['Preset presets[] = {', '#ifdef MY_SPECIAL_STYLES\nusing GateBlue = Blue;\n#endif\nPreset presets[] = {'],
            ['InOutHelper<Blue,', 'InOutHelper<GateBlue,']],
    see: 'GateBlue is switched off, naming MY_SPECIAL_STYLES. Compile anyway says the same thing.' },
  { id: 'os7_no_audio', sig: 'audio-classes-missing-os7', os: '7.15',
    edits: [['#define ENABLE_AUDIO\n', '']],
    see: 'Select ProffieOS 7.15. Compile anyway: ENABLE_AUDIO is required.' },

  // ── Warnings: these build, and the card says what goes wrong afterwards ──
  { id: 'prop_defines_no_prop', check: 'prop-defines-without-prop', compiles: true,
    edits: [['#define ENABLE_SD\n', '#define ENABLE_SD\n#define FETT263_TWIST_ON\n#define FETT263_MAX_CLASH 16\n']],
    see: 'One warning card: 2 FETT263_ options are set and no prop is included, with Disable and Delete on each.' },
  { id: 'voicepack_not_listed', check: 'voicepack-declared', needsTree: true, compiles: true,
    edits: [['#define ENABLE_SD\n', '#define ENABLE_SD\n#define MENU_SPEC_TEMPLATE DefaultMenuSpec\n'],
            ['"Font1;common"', '"Font1"']],
    see: 'A warning that a preset has no voicepack folder listed, with a button to add common.' },
  { id: 'shared_folder_typo', check: 'shared-folder-odd-one-out', compiles: true,
    edits: [['"Font2;common"', '"Font2;comon"'],
            ['    "Two" },\n', '    "Two" },\n  { "Font3;common", "tracks/track1.wav", StylePtr<Black>(), "Three" },\n  { "Font4;common", "tracks/track1.wav", StylePtr<Black>(), "Four" },\n']],
    see: 'A warning that one preset uses comon where the rest use common, with a fix button.' },
  { id: 'define_nothing_reads', check: 'define-nothing-reads', compiles: true, needsTree: true,
    edits: [['#define ENABLE_SD\n', '#define ENABLE_SD\n#define JMT_NOT_A_THING\n']],
    see: 'A warning that JMT_NOT_A_THING is a define nothing reads, with its row of fixes.' },
];

// As many cards as the dialog can hold at once. The preset list closes properly here: a list
// that never closes stops every check that reads presets.
const ST = 'StylePtr<Blue>()';
const ALL_AT_ONCE = `#ifdef CONFIG_TOP
#include \u201Cproffieboard_v3_config.h\u201D
#define NUM_BLADES 2
#define NUM_BUTTONS 2
#define VOLUME 1500
const unsigned int maxLedsPerStrip = 144;
#define CLASH_THRESHOLD_G 3.0
#define ENABLE_AUDIO
#define ENABLE_MOTION
#define ENABLE_WS2811
#define ENABLE_SD
#define MENU_SPEC_TEMPLATE DefaultMenuSpec
#define FETT263_TWIST_ON
#define JMT_NOT_A_THING
#endif

#ifdef CONFIG_PROP
#include "my_config.h"
#include "my_config.h"
#include "../props/not_a_real_prop.h"
#endif

#ifdef CONFIG_PRESETS
#ifdef MY_SPECIAL_STYLES
using GateBlue = Blue;
#endif
Preset presets[] = {
  { "NoComma1;common" "tracks/t.wav", ${ST}, ${ST}, "After font" },
  { "NoComma2;common", "tracks/t.wav" ${ST}, ${ST}, "After track" },
  { "NoComma3;common", "tracks/t.wav", ${ST} ${ST}, "Between styles" },
  { "NoComma4;common", "tracks/t.wav", ${ST}, ${ST} "After last style" },
  { "NoComma5;common", "tracks/t.wav", ${ST}, ${ST}, "After the preset" }
  { "Short;common", "tracks/t.wav", ${ST}, "Short preset" },
  { "Extra;common", "tracks/t.wav", ${ST}, ${ST}, ${ST}, "Extra style" },
  { "Typo;common", "tracks/t.wav", StyleRainBowPtr<300, 800>(), ${ST}, "Unknown style" },
  { "Gated;common", "tracks/t.wav", StylePtr<GateBlue>(), ${ST}, "Switched off" },
  { "Odd;comon", "tracks/t.wav", ${ST}, ${ST}, "Folder typo" },
  { "NoVoice", "tracks/t.wav", ${ST}, ${ST}, "No voicepack" },
  { "Good1;common", "tracks/t.wav", ${ST}, ${ST}, "Fine" },
  { "Good2;common", "tracks/t.wav", ${ST}, ${ST}, "Fine too" }
}
Preset bank2[] = {
  { "Good3;common", "tracks/t.wav", ${ST}, ${ST}, "Second bank" }
}
BladeConfig blades[] = {
  { 0, ${BLADE},
    CONFIGARRAY(presets) },
  { 1000, ${BLADE}, ${BLADE2}, ${BLADE2},
    CONFIGARRAY(presets) },
  { 2000, ${BLADE}, ${BLADE2},
    CONFIGARRAY(blade_1) },
  { 3000, ${BLADE}, ${BLADE2},
    CONFIGARRAY(bank2) },
};
#endif

#ifdef CONFIG_BUTTONS
Button PowerButton(BUTTON_POWER, powerButtonPin, "pow");
Button AuxButton(BUTTON_AUX, auxPin, "aux");
#endif
`;

function apply(fault, base = BASE) {
  let text = base;
  for (const [find, replace] of fault.edits) {
    if (!text.includes(find)) throw new Error(`${fault.id}: no match for ${find}`);
    text = text.replace(find, replace);
  }
  return text;
}

// The order to test them in: cards with a fix, cards without, warnings, then what only the
// compiler sees, then the two that need a setting changed. ALL_at_once is last.
const TEST_ORDER = [
  'comma_after_font', 'comma_after_track', 'comma_after_style', 'comma_between_styles',
  'comma_between_presets', 'missing_semicolon_after_presets', 'curly_quotes', 'self_include',

  'preset_list_closes_early', 'preset_list_never_closes', 'short_preset', 'extra_style',
  'too_many_blades', 'too_few_blades', 'preset_list_not_found', 'unknown_style_name',
  'style_switched_off', 'prop_not_in_version', 'prop_typo',

  'prop_defines_no_prop', 'shared_folder_typo', 'voicepack_not_listed', 'define_nothing_reads',

  'extra_string_in_preset', 'misspelled_colour', 'near_miss_name', 'unknown_name',
  'unquoted_font', 'extra_angle_bracket', 'missing_angle_bracket', 'missing_style_parens',
  'empty_styleptr', 'wrong_argument_count', 'number_where_style_goes',
  'string_where_number_goes', 'element_in_wrong_position', 'stray_brace',
  'pixel_count_is_text', 'too_many_leds',

  'misspelled_board_header', 'no_board_header', 'absolute_include', 'include_without_quotes',
  'missing_endif', 'extra_endif', 'misspelled_presets_section', 'presets_outside_section',
  'prop_in_top_section', 'prop_button_count', 'duplicate_button', 'define_without_value',
  'define_string_not_number', 'missing_volume_define', 'volume_without_value', 'two_types', 'setup_defined_twice',

  'wrong_board', 'os7_no_audio',
];

module.exports = { BASE, FAULTS, ALL_AT_ONCE, TEST_ORDER, apply };
