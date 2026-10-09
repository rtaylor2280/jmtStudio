// A conversion name resolves to the board it was converted TO, not FROM. [B-485]
//
// WHY THIS EXISTS. `identifyBoard` returns the first match in BOARD_PATTERNS
// order and `proffie` is index 0, so a wrapper named "Renamed_PROFFIE_to_ASTERIA"
// resolved to `proffie`. Measured consequence on the real archive: all five of
// that vendor's conversion wrappers reported `proffie`, `detectMultiBoardSiblings`
// picked the first as the Proffie child, and the ONLY candidate offered for the
// whole font was the Asteria build - while the real 116-file Proffie font was not
// offered at all. A non-Proffie build landing in a Proffie library.
//
// THE REGRESSION THIS FILE REALLY GUARDS IS THE OTHER DIRECTION. The obvious
// fix - "the last board token wins" - breaks a vendor that works today. Two real
// folders in the corpus are named "JUANSITH´S SATELE PROFFIE AND XENOPIXEL V3":
// two board tokens, and `proffie` is CORRECT because that folder IS the Proffie
// version. Last-token-wins calls it a Xeno font. So the override turns on the word
// "to", which is what separates "contains both" from "converted into", and these
// names are asserted here so that distinction cannot be quietly lost.
//
// Every name below is a REAL name read out of a real archive or directory, not an
// invented fixture: the BVM free/premium wrappers and inner folders came from
// font-absorbed.zip and font-whispering-crystal.zip, the Juansith and bells names
// from G:\...\Original Font Files.
'use strict';

const { identifyBoard } = require('../soundFontCandidates.js');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};
const eq = (label, input, want) => {
  const got = identifyBoard(input);
  ok(`${label}: ${JSON.stringify(input)} -> ${JSON.stringify(want)}`,
     got === want, `got ${JSON.stringify(got)}`);
};

console.log('— the bug: conversion wrappers must resolve to their TARGET board —');
eq('premium wrapper', 'Renamed_PROFFIE_to_ASTERIA', 'asteria');
eq('premium wrapper', 'Renamed_PROFFIE_to_CFX', 'cfx');
eq('premium wrapper', 'Renamed_PROFFIE_to_GOLDEN_HARVEST', 'goldenharvest');
eq('premium wrapper', 'Renamed_PROFFIE_to_VERSO', 'verso');
eq('premium wrapper', 'Renamed_PROFFIE_to_XENO3', 'xeno');
eq('free wrapper', 'Renamed_to_CFX', 'cfx');
eq('free wrapper', 'Renamed_to_GOLDEN_HARVEST', 'goldenharvest');
eq('free wrapper', 'Renamed_to_XENO3', 'xeno');

console.log('');
console.log('— the font folders inside those wrappers were always right; keep them right —');
eq('inner folder', 'Whispering Crystal_ASTERIA', 'asteria');
eq('inner folder', 'Whispering Crystal_CFX', 'cfx');
eq('inner folder', 'sound1 - Whispering Crystal_GOLDEN_HARVEST', 'goldenharvest');
eq('inner folder', 'Whispering Crystal_VERSO', 'verso');
eq('inner folder', 'Whispering Crystal_XENO3', 'xeno');
eq('inner folder', 'Absorbed_CFX', 'cfx');

console.log('');
console.log('— the real Proffie font carries NO board token, which is how it is found —');
eq('real proffie font', 'Whispering Crystal', null);
eq('real proffie font', 'Absorbed', null);
eq('real proffie font', 'Astral Projection', null);

console.log('');
console.log('— REGRESSION: names that legitimately CONTAIN a board token —');
// "contains both builds", not "converted into". proffie is the right answer.
eq('juansith', 'JUANSITH´S SATELE PROFFIE AND XENOPIXEL V3', 'proffie');
eq('juansith', 'JUANSITH´S HE-MAN 83 PROFFIE AND XENOPIXEL V3', 'proffie');
// The conventional labelled-sibling shape every other vendor ships.
eq('plain board folder', 'proffie', 'proffie');
eq('plain board folder', 'Proffie', 'proffie');
eq('plain board folder', 'cfx', 'cfx');
eq('plain board folder', 'asteria', 'asteria');
eq('plain board folder', 'Verso', 'verso');
eq('plain board folder', 'GoldenHarvest', 'goldenharvest');
eq('plain board folder', 'xenopixelv3', 'xeno');
eq('prefixed board folder', '1.1-Origin/Proffie', 'proffie');
eq('suffixed board folder', 'Dark Ani - Proffie', 'proffie');

console.log('');
console.log('— the override needs "to" as a WORD, so ordinary names are untouched —');
// "Crystal" and "Tomb" contain the letters t,o but no delimited "to".
eq('no standalone to', 'Whispering Crystal_CFX', 'cfx');
eq('no standalone to', 'Tomb Guardian', null);
eq('no standalone to', 'Protocol', null);
// Nothing after "to" that names a board: fall through to the ordinary scan.
eq('to, no board after', 'Proffie_to_Nowhere', 'proffie');
eq('bare name', '', null);
ok('null input does not throw', identifyBoard(null) === null, 'expected null');
ok('undefined input does not throw', identifyBoard(undefined) === null, 'expected null');

console.log(failed ? `\n${failed} failure(s)` : '\nall passed');
process.exit(failed ? 1 : 0);
