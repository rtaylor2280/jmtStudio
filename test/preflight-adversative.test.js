// [B-375] A finding title that states the expectation AND the violation is an adversative.
//
// ⭐ HIS CATCH 2026-09-16, and he was explicit that it is a rule and not a typo:
//   "Your config has 2 blades, and 1 preset has 1 of 2 blade styles."
//   "'and 1 preset' is wrong - should be 'but' since it's describing an error/contradiction."
//
// "and" joins two compatible facts. These sentences exist precisely because the two halves CANNOT
// both be right, so the conjunction was doing the opposite of the message's job.
//
// ⚠️ THE ENTRY ASKED FOR A SWEEP OF THE SHAPE, NOT THE PHRASE, and the sweep is why this test is
// worth having: a third title (the voicepack one) carried the identical construction and would
// have been missed by fixing the two strings that were reported. Meanwhile the "no prop is
// included" title ALREADY said "but" — so the house style was right in one place and wrong in
// three, which is the same one-place-right shape this codebase keeps producing.
'use strict';

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'preflight-checks.js'), 'utf8');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + String(detail).slice(0, 300) : ''));
}

// ── the three that were wrong ──────────────────────────────────────────────
{
  const bladeTitles = src.match(/title: `Your config has \$\{blades\}, (and|but) `/g) || [];
  ok('both blade-count titles exist', bladeTitles.length === 2, JSON.stringify(bladeTitles));
  ok('and both use "but"', bladeTitles.every(t => t.includes(', but ')), JSON.stringify(bladeTitles));

  ok('the voicepack title uses "but"',
     /requires a voicepack on ProffieOS 8'\}, but `/.test(src),
     (src.match(/requires a voicepack on ProffieOS 8'\}, (and|but) `/) || ['not found'])[0]);
}

// ── the one that was already right, kept as the precedent ──────────────────
{
  ok('the no-prop title still uses "but"',
     /option\$\{hits\.length === 1 \? '' : 's'\}, `\s*\+ `but no prop is included\.`/.test(src.replace(/\r/g, '')),
     'this one was correct before the entry and is the reason the rule is house style, not invention');
}

// ── the sweep stays clean ──────────────────────────────────────────────────
{
  // ⚠️ Anchored on the TITLE construction only. `, and ` is perfectly correct inside a `detail`
  // body — "the saber will boot, and none of the controls you set up will work" is a genuine list
  // of two compatible facts. Flagging those would make this test a nag that gets disabled.
  const badTitles = (src.match(/title: `[^`]*`\s*\n?\s*\+? ?`?, and `/g) || [])
    .concat(src.match(/\}, and `/g) || []);
  ok('no finding TITLE still joins a contradiction with "and"',
     badTitles.length === 0, JSON.stringify(badTitles));
}

console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
