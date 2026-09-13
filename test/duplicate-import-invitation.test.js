/**
 * The duplicate review must not invite an action it then refuses  [B-363]
 *
 * 2026-09-10, re-importing a font already in the library through the single-source
 * review: "telling me to check anyway if I want it again but then not letting me... not
 * sure why we want it again. I think we stopped this on sd card import... we instead
 * had adopt for the name."
 *
 * THE CONTRADICTION, and both halves were deliberate when written:
 *   * 2026-07-23 — a fully-owned row is auto-unchecked but the box STAYS CLICKABLE
 *     ("information, not force"), and the summary explains that checking it imports a
 *     second copy.
 *   * The name validator refuses any name the library already holds, sets an error on
 *     the row and DISABLES "Add to Library".
 * So the freedom was illusory: the copy invited the click, and the click could never
 * succeed. Two correct decisions made at different times, meeting.
 *
 * ⭐ HIS RULING 2026-09-13: match the SD-card path, which replaced blunt re-importing
 * with adopting the existing entry. No second copy from this door. Duplicate-in-library
 * is the supported way to get one, and it is what the hint names.
 *
 * Run: node test/duplicate-import-invitation.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Lift the shared summary builder and run it, rather than grepping its strings — the
// same helper feeds the single-import review AND the guided bulk review, and the point
// is what a reader SEES in each combination.
const summary = (() => {
  const a = html.indexOf('window._sfDupSummaryText = (');
  const start = html.indexOf('(', a);
  let i = html.indexOf('{', start), d = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') d++;
    else if (html[i] === '}') { d--; if (!d) { end = i + 1; break; } }
  }
  return new Function('return ' + html.slice(start, end))();
})();

ok('the shared summary builder was lifted', typeof summary === 'function');

// ── the invitation is gone ─────────────────────────────────────────────────
{
  const all = [summary(1, 0, 1), summary(1, 0, 5), summary(3, 0, 5), summary(5, 0, 5)];
  ok('no wording offers a second copy',
     all.every(t => !/second copy/i.test(t)), all.find(t => /second copy/i.test(t)));
  ok('no wording tells the user to check the box',
     all.every(t => !/\bchecking\b/i.test(t)), all.find(t => /\bchecking\b/i.test(t)));
  ok('every variant names the door that DOES work',
     all.every(t => /duplicate it there/.test(t)));
}

// ── it still reads as English in each shape ────────────────────────────────
{
  // ⚠️ The count sentence is dropped when total === 1, so the second sentence has to
  // stand alone there. "It is not imported again" with no antecedent is a fragment.
  const one = summary(1, 0, 1);
  ok('a single-row review does not open with a dangling pronoun',
     /^This font is already in your library/.test(one), one);
  ok('and it still says what happens', /is not imported again/.test(one), one);

  const someOfMany = summary(1, 0, 5);
  ok('one-of-many keeps its count sentence',
     /^One of these fonts is already in your library\./.test(someOfMany), someOfMany);
  ok('and follows with a matching singular', / It is not imported again\./.test(someOfMany), someOfMany);

  const manyOfMany = summary(3, 0, 5);
  ok('several-of-many uses the plural', / They are not imported again\./.test(manyOfMany), manyOfMany);

  ok('all-of-them reads "All"', /^All of these fonts/.test(summary(5, 0, 5)), summary(5, 0, 5));
}

// ── the flagged half is untouched ──────────────────────────────────────────
{
  ok('close matches still get their own sentence',
     /close match/.test(summary(0, 1, 3)) && /close matches/.test(summary(1, 2, 5)));
  ok('a review with nothing to say says nothing', summary(0, 0, 3) === '');
}

// ── the box cannot be clicked into the dead end ────────────────────────────
{
  const block = html.slice(html.indexOf('[B-363] AND THE BOX IS NOW INERT'),
                           html.indexOf('[B-363] AND THE BOX IS NOW INERT') + 1800);
  ok('the owned row disables its checkbox', /check\.disabled = true;/.test(block));
  ok('and says why on hover', /check\.title =/.test(block) && /duplicate it/.test(block), block.slice(0, 400));
  ok('the reason names the existing entry when we know it',
     /Already in your library as \$\{hit\.matchName\}/.test(block));

  // The name validator that created the dead end is still there and still right — it
  // is what stops two library entries sharing a name. Only the invitation changed.
  ok('the name-collision check still exists',
     /A library entry with this name already exists/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall duplicate-import invitation tests passed');
process.exit(failures ? 1 : 0);
