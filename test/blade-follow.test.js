// B-219: follower blades — the `// @jmt-follow: Bn=Bm` line.
//
// A follower blade mirrors another blade's style expression, so adding a blade does not mean
// hand-writing a style into every preset. The override is DERIVED, not stored: a preset is
// following when the two expressions match and overridden when they differ, which is why nothing
// here records overrides. That is the whole reason preset order can change freely.
//
// This covers the parse side. The writers and the UI sit on top of it.

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

const wrap = (lines) => `Preset presets[] = {\n${lines}\n{ "F;common", "", StylePtr<A>(), StylePtr<B>(), StylePtr<C>(), "P1" },\n};`;
const follows = (lines) => pp.parsePresets(wrap(lines)).arrays[0].follows;

console.log('blade follow (B-219)');

check('a single pair parses',
  follows('// @jmt-follow: B2=B1'), { 2: 1 });

check('several pairs on one line',
  follows('// @jmt-follow: B2=B1 B3=B1'), { 2: 1, 3: 1 });

check('a follower may target any lower blade, not only B1',
  follows('// @jmt-follow: B3=B2'), { 3: 2 });

check('no line means no follows',
  follows('// just a comment'), {});

// The lower-numbered rule is what makes cycles impossible by construction rather than by
// detection. Enforced at the parse boundary so nothing downstream has to trust the file.
check('a forward reference is dropped',
  follows('// @jmt-follow: B1=B2'), {});

check('self-follow is dropped',
  follows('// @jmt-follow: B2=B2'), {});

check('a bad pair does not take the good ones with it',
  follows('// @jmt-follow: B1=B2 B3=B1'), { 3: 1 });

check('malformed text is ignored, not thrown',
  follows('// @jmt-follow: garbage B2 = = B1 ,,'), {});

// Two concerns, two lines, two lifetimes. Merging them is what makes delete-when-empty fragile.
const both = pp.parsePresets(wrap('// @jmt-labels: B1="Main" B3="Ring B"\n// @jmt-follow: B3=B1')).arrays[0];
check('labels and follows are independent',
  [both.labels, both.follows], [{ 1: 'Main', 3: 'Ring B' }, { 3: 1 }]);
check('a named blade need not follow',
  pp.parsePresets(wrap('// @jmt-labels: B2="Accent"')).arrays[0].follows, {});
check('a following blade need not be named',
  pp.parsePresets(wrap('// @jmt-follow: B2=B1')).arrays[0].labels, {});

const lineTest = pp.parsePresets(wrap('// @jmt-labels: B1="Main"\n// @jmt-follow: B2=B1')).arrays[0];
check('each line reports its own location', [lineTest.labelLine, lineTest.followLine], [2, 3]);

// ── Propagation: which followers receive a write, within ONE preset ──────────
//
// These are the cases that decide whether the feature is safe. The condition under test is that a
// follower is written only when its text still equals the target's PREVIOUS text, because that
// match is the only record anywhere that this preset was still following.

console.log('\nblade follow propagation (B-219)');

const plan = (follows, source, oldText, newText, texts) =>
  pp.planFollowWrites(follows, source, oldText, newText, texts);

check('a matching follower is written',
  plan({ 2: 1 }, 1, 'StylePtr<A>()', 'StylePtr<X>()', { 1: 'StylePtr<A>()', 2: 'StylePtr<A>()' }),
  [{ blade: 2, text: 'StylePtr<X>()' }]);

check('an OVERRIDDEN follower is left alone',
  plan({ 2: 1 }, 1, 'StylePtr<A>()', 'StylePtr<X>()', { 1: 'StylePtr<A>()', 2: 'StylePtr<Mine>()' }),
  []);

check('whitespace does not count as an override',
  plan({ 2: 1 }, 1, 'StylePtr<A>()', 'StylePtr<X>()', { 1: 'StylePtr<A>()', 2: 'StylePtr< A >()' }),
  [{ blade: 2, text: 'StylePtr<X>()' }]);

check('two followers of the same blade both move',
  plan({ 2: 1, 3: 1 }, 1, 'A', 'X', { 1: 'A', 2: 'A', 3: 'A' }),
  [{ blade: 2, text: 'X' }, { blade: 3, text: 'X' }]);

check('one overridden sibling does not stop the other',
  plan({ 2: 1, 3: 1 }, 1, 'A', 'X', { 1: 'A', 2: 'Mine', 3: 'A' }),
  [{ blade: 3, text: 'X' }]);

// The cascade. B3 follows B2, which follows B1 - so B3 moves only because B2 did.
check('a chain propagates all the way down',
  plan({ 2: 1, 3: 2 }, 1, 'A', 'X', { 1: 'A', 2: 'A', 3: 'A' }),
  [{ blade: 2, text: 'X' }, { blade: 3, text: 'X' }]);

check('an overridden middle blade stops the chain below it',
  plan({ 2: 1, 3: 2 }, 1, 'A', 'X', { 1: 'A', 2: 'Mine', 3: 'Mine' }),
  []);

// B3 matches B1's old text by coincidence, but it follows B2, and B2 did not move. Following the
// blade you named is the whole contract; matching some other blade's text is not a reason to write.
check('a stopped chain does not resume on a coincidental match',
  plan({ 2: 1, 3: 2 }, 1, 'A', 'X', { 1: 'A', 2: 'Mine', 3: 'A' }),
  []);

check('editing the middle of a chain moves only what is below it',
  plan({ 2: 1, 3: 2 }, 2, 'A', 'X', { 1: 'A', 2: 'A', 3: 'A' }),
  [{ blade: 3, text: 'X' }]);

check('a preset missing the follower slot is skipped, not crashed',
  plan({ 2: 1, 3: 1 }, 1, 'A', 'X', { 1: 'A', 2: 'A' }),
  [{ blade: 2, text: 'X' }]);

check('no follows means no writes',
  plan({}, 1, 'A', 'X', { 1: 'A', 2: 'A' }), []);

check('editing a blade nobody follows writes nothing',
  plan({ 2: 1 }, 3, 'A', 'X', { 1: 'A', 2: 'A', 3: 'A' }), []);

check('a no-op edit propagates nothing',
  plan({ 2: 1 }, 1, 'A', 'A', { 1: 'A', 2: 'A' }), []);

check('a following blade that is empty text is still a match',
  plan({ 2: 1 }, 1, '', 'X', { 1: '', 2: '' }),
  [{ blade: 2, text: 'X' }]);

// ── Disabled presets ────────────────────────────────────────────────────────
//
// A disabled preset is wrapped in an @jmt-disabled block comment, so the preset parser cannot see
// it. The bulk copy still has to reach it, or re-enabling that preset later brings back a blade
// holding a style that never received the copy - which the derived-override rule then reads as a
// deliberate override. The copy locates its slots with the parser's own extractStyleSlots, so what
// is under test here is that Nth slot means Nth blade in raw entry text too.

console.log('\nblade follow, disabled presets (B-219)');

const disabledInner = '    { "TeensySF;common", "tracks/venus.wav",\n'
                    + '      StylePtr<Blue>(),\n'
                    + '      StylePtr<Red>(),\n'
                    + '      StylePtr<Green>(),\n'
                    + '      "old" },';
const dslots = pp.extractStyleSlots(disabledInner);
const dtext  = i => disabledInner.slice(dslots[i].startOffset, dslots[i].endOffset);

check('every slot in a disabled entry is found', dslots.length, 3);
check('slot order is blade order', [dtext(0), dtext(1), dtext(2)],
  ['StylePtr<Blue>()', 'StylePtr<Red>()', 'StylePtr<Green>()']);

// Offsets are what the copy turns into editor ranges. If they drift, the write lands on the wrong
// characters - so assert against the raw text rather than against the parser's own report.
check('offsets address the real characters',
  disabledInner.slice(dslots[1].startOffset, dslots[1].endOffset), 'StylePtr<Red>()');

// A multi-line style is the case a line-based scan gets wrong, which is why this uses the parser.
const dMultiline = '{ "f", "t",\n'
                 + '  StylePtr<Layers<Blue,\n'
                 + '    AlphaL<Red,Int<16000>>>>(),\n'
                 + '  StylePtr<Green>(),\n'
                 + '  "n" },';
const mslots = pp.extractStyleSlots(dMultiline);
check('a style split over two lines is one slot', mslots.length, 2);
check('the split style is captured whole',
  dMultiline.slice(mslots[0].startOffset, mslots[0].endOffset).includes('AlphaL<Red,Int<16000>>'), true);

// Two styles on one line is the other case a line scan collapses.
const dOneLine = '{ "f", "t", StylePtr<Blue>(), StylePtr<Red>(), "n" },';
check('two styles on one line are two slots', pp.extractStyleSlots(dOneLine).length, 2);

// ── Global blade reorder renumbering (B-220) ────────────────────────────────
//
// Moving a blade moves it in every preset, and the names and follow pairs have to move WITH the
// blade rather than staying with the slot number. This is the part that fails silently: a wrong
// entry here does not throw and does not look wrong, it just attaches every name to the wrong
// blade. So it is pure, and it is tested against hand-worked expectations.

console.log('\nblade reorder renumbering (B-220)');

const mv = (count, from, to) => pp.planBladeReorder(count, from, to);

// Dragging the last of three to the front: old 3 becomes 1, and 1 and 2 shuffle down.
check('a move to the front renumbers everything below it',
  mv(3, 2, 0), { 1: 2, 2: 3, 3: 1 });

check('a move to the back renumbers everything above it',
  mv(3, 0, 2), { 1: 3, 2: 1, 3: 2 });

check('an adjacent swap touches only the two blades',
  mv(3, 0, 1), { 1: 2, 2: 1, 3: 3 });

check('a move to the same position changes nothing',
  mv(3, 1, 1), { 1: 1, 2: 2, 3: 3 });

// The name follows the BLADE. B2 named "Pixel Switch" dragged to the end must come out as B3.
check('a name travels with its blade, not its slot',
  pp.renumberLabels({ 1: 'Main', 2: 'Pixel Switch' }, mv(3, 1, 2)),
  { 1: 'Main', 3: 'Pixel Switch' });

check('unnamed blades do not gain names',
  pp.renumberLabels({ 3: 'Ring' }, mv(3, 2, 0)), { 1: 'Ring' });

check('no names means nothing to renumber',
  pp.renumberLabels({}, mv(3, 2, 0)), {});

// Follow pairs renumber the same way while the follower stays above its target.
// B4 dragged above B3 pushes B3 down to position 4, so the pair follows it there. The blade that
// moved is not in the pair at all - which is exactly why renumbering cannot be limited to the
// blades the user touched.
check('a pair renumbers when an unrelated blade moves past it',
  pp.renumberFollows({ 3: 1 }, mv(4, 3, 2)), { kept: { 4: 1 }, dropped: 0 });

check('both halves renumber when the TARGET moves',
  pp.renumberFollows({ 3: 1 }, mv(3, 0, 1)), { kept: { 3: 2 }, dropped: 0 });

// THE INVERSION CASE. B3 follows B1; drag B3 to the front and it would point forward, which the
// parser drops anyway. Dropped here deliberately, and counted so it can be reported.
check('a pair the move inverts is dropped, not silently kept',
  pp.renumberFollows({ 3: 1 }, mv(3, 2, 0)), { kept: {}, dropped: 1 });

check('one inverted pair does not take a valid one with it',
  pp.renumberFollows({ 3: 1, 4: 2 }, mv(4, 2, 0)),
  { kept: { 4: 3 }, dropped: 1 });

check('no follows means nothing dropped',
  pp.renumberFollows({}, mv(3, 2, 0)), { kept: {}, dropped: 0 });

// Every surviving pair must still obey the lower-numbered rule - that is the invariant the whole
// design rests on, so assert it directly rather than trusting the cases above to cover it.
let invariantHolds = true;
for (let from = 0; from < 4; from++) {
  for (let to = 0; to < 4; to++) {
    const { kept } = pp.renumberFollows({ 2: 1, 3: 1, 4: 3 }, mv(4, from, to));
    for (const f of Object.keys(kept)) if (!(kept[f] < Number(f))) invariantHolds = false;
  }
}
check('no surviving pair ever points forward, across every move', invariantHolds, true);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall blade-follow checks passed');
