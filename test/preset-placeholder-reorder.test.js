// B-355: a short preset's open slots move as placeholders.
//
// A placeholder is written as StylePtr<MISSING_STYLE>() so a slot's position stays the blade it
// drives. planPresetReorder pads a preset to the blade count, moves one slot, and drops trailing
// placeholders again.

const assert = require('assert');
const pp = require('../renderer/presetParser.js');

let failures = 0;
function check(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`  ok  ${name}`);
  } catch {
    failures++;
    console.log(`FAIL  ${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
  }
}

const P = pp.PLACEHOLDER_STYLE;
const MB = 'StylePtr<Blue>()', PS = 'StylePtr<White>()', CC = 'StylePtr<Green>()', PC = 'StylePtr<Red>()';

console.log('placeholder reorder (B-355)');

// A 2-blade config (MB, CC) grows to 4; PS is moved from B3 to B2.
check('a complete preset moves as before',
  pp.planPresetReorder([MB, CC, PS, PC], 4, 2, 1), [MB, PS, CC, PC]);
check('a 2-of-4 preset gets a placeholder where the moved blade lands',
  pp.planPresetReorder([MB, CC], 4, 2, 1), [MB, P, CC]);

// Yoda: Blue and Red written, really MB and PC. The PS placeholder goes up to B2, then CC's to B3.
check('a placeholder dragged up pushes the style below it down',
  pp.planPresetReorder([MB, PC], 4, 2, 1), [MB, P, PC]);
check('a second placeholder move puts the style in its own blade',
  pp.planPresetReorder([MB, P, PC], 4, 3, 2), [MB, P, P, PC]);

check('swapping two open tail slots changes nothing',
  pp.planPresetReorder([MB, CC], 4, 2, 3), null);
check('trailing placeholders are dropped',
  pp.planPresetReorder([MB, P, CC, P], 4, 0, 1), [P, MB, CC]);
check('a style dragged below the gaps lands at the end',
  pp.planPresetReorder([MB, CC], 4, 1, 3), [MB, P, P, CC]);
check('an over-count preset still moves',
  pp.planPresetReorder([MB, PS, CC, PC, MB], 4, 4, 0), [MB, MB, PS, CC, PC]);
check('out of range is no move',
  pp.planPresetReorder([MB, CC], 4, 5, 0), null);

check('the placeholder text is recognised',
  pp.isPlaceholderText('StylePtr< MISSING_STYLE >()'), true);
const slots = pp.parsePresets(`Preset presets[] = {\n{ "F;common", "", ${MB}, ${P}, "x" },\n};`).arrays[0].presets[0].styles;
check('the parser reads a placeholder as a slot in its position', slots.length, 2);
check('and isPlaceholderSlot picks it out', slots.map(pp.isPlaceholderSlot), [false, true]);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
