// Copying a blade's style to other presets: the wrapper case. [B-222]
//
// A B2 that wraps its preset's own B1 (PixelSwitchWrapper<MainCalKestisSurvivorBlueBaseColor>) must
// wrap the TARGET preset's B1 when copied, or every preset gets the blue blade. Copied into a preset
// whose B1 is still empty it wraps the placeholder, and giving B1 a style later repairs it.
'use strict';

const pp = require('../renderer/presetParser.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const BLUE = 'MainCalKestisSurvivorBlueBaseColor';
const CYAN = 'MainCalKestisSurvivorCyanBaseColor';
const b2 = `StylePtr<PixelSwitchWrapper<${BLUE}>>("~ ~ 0,0,65535")`;

console.log('retargetStyleText: the copy');
{
  const r = pp.retargetStyleText(b2, BLUE, CYAN);
  check('A WRAPPER COPIED TO ANOTHER PRESET WRAPS THAT PRESET\'S B1', r === `StylePtr<PixelSwitchWrapper<${CYAN}>>("~ ~ 0,0,65535")`, r);
  const empty = pp.retargetStyleText(b2, BLUE, 'Black');
  check('into a preset whose B1 is still empty, it wraps the placeholder', empty.includes('PixelSwitchWrapper<Black>'), empty);
  const longer = pp.retargetStyleText(`StylePtr<Layers<${BLUE}X, ${BLUE}>>()`, BLUE, CYAN);
  check('only a whole template argument moves, never part of a longer name', longer === `StylePtr<Layers<${BLUE}X, ${CYAN}>>()`, longer);
  check('an inline B1 (not a plain name) leaves the text as written', pp.retargetStyleText(b2, 'Rgb<0,0,255>', CYAN) === b2);
}

console.log('wrapsExactly: the repair');
check('PixelSwitchWrapper<Black> wraps the empty placeholder', pp.wrapsExactly('PixelSwitchWrapper<Black>', 'Black'));
check('spacing inside the brackets is allowed', pp.wrapsExactly(`PixelSwitchWrapper< ${BLUE} >`, BLUE));
check('A STYLE THAT MERELY CONTAINS B1 IS NOT A WRAPPER OF IT', !pp.wrapsExactly('Layers<Black,AudioFlicker<Red,Blue>>', 'Black'));
check('a blade that IS B1 is not a wrapper of it', !pp.wrapsExactly('Black', 'Black'));
check('nested wrappers are not repaired', !pp.wrapsExactly(`A<B<${BLUE}>>`, BLUE));

console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
