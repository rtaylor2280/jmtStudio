// Every way out of the export door records what the scan learned.          [B-173, 2026-09-25]
//
// ⭐⭐ WHY THIS FILE EXISTS, and it is a specific failure rather than a principle. The primary
// export door runs a long compare and then has several ways to leave before anything is written.
// Each one used to throw away everything that compare had cost:
//
//   · cancel during the scan
//   · cancel at the conflict review          <- the expensive one
//   · nothing to write, card already current <- the common one
//
// Measured 2026-09-25 on a card behind a board's mass-storage bridge: the scan took over an hour.
// Pressing Cancel at the conflict review discarded all of it, and the next run would have paid
// the identical cost. On a USB reader the same card is 15 s cold and 1 s warm.
//
// ⚠️⚠️ AND THE SWEEP THAT WAS SUPPOSED TO FIND THESE MISSED ONE. An enumeration of exits reported
// THREE when there were FOUR: it matched `return` at the start of a line, and the conflict-review
// exit is `if (!choices) return false;` on one line. The fourth was found by walking into it.
// That is the reason this is a test and not a note - the manual sweep has already failed once.
//
// ⚠️ THE CHECK IS DELIBERATELY NOT PROXIMITY-BASED. Three separate attempts to verify this with
// "is there a commit within N characters" gave three wrong answers in one afternoon, because the
// distance between a commit and its return is set by how much UI code sits between them. Each
// exit is anchored on its own condition and sliced to its own block instead.
'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// The door, sliced to its neighbour rather than to a character count.
const a = html.indexOf('const _sfBulkSave = async () => {');
const b = html.indexOf('const _sfBulkDelete = async () => {', a);
const door = a > 0 && b > a ? html.slice(a, b) : '';
ok('the primary export door was located', door.length > 0,
   're-anchor if _sfBulkSave is renamed - an empty slice makes every claim below vacuously true');

// Slice from a condition to the `return false` that ends its block. Anchored on the condition's
// own text, so it survives any amount of comment or UI code growing inside the block.
function blockOf(condition) {
  const s = door.indexOf(condition);
  if (s < 0) return '';
  const e = door.indexOf('return false;', s);
  return e > s ? door.slice(s, e) : '';
}

const EXITS = [
  ['cancel during the scan', 'if (_scanCanceled) {',
   'a scan stopped partway has still paid for every item it finished hashing'],
  ['cancel at the conflict review', 'if (!choices) {',
   'the scan has COMPLETED by here and nothing has been written - declining to write says '
   + 'nothing about what we just learned is already on the card. Over an hour of board-card '
   + 'hashing was thrown away by this exit'],
  ['nothing to write, card already current', 'if (totalSteps === 0) {',
   'the commonest state a synced card is ever in, and the one that never converged: it hashed '
   + 'everything, learned everything, and discarded it on every single run'],
];

for (const [label, anchor, why] of EXITS) {
  const block = blockOf(anchor);
  ok(`the "${label}" exit was located`, block.length > 0,
     `re-anchor on ${anchor} - an empty slice passes everything`);
  ok(`⭐ and it records what the scan learned`, block.includes('syncManifestCommit'), why);
}

// ⚠️⚠️ THE GUARD AGAINST A FIFTH EXIT. This is the check the manual sweep failed to be. It counts
// the door's OWN exits - `return false` and the handoff to the runner - and ignores the returns
// inside the conflict dialog's option callbacks, which return strings and arrays rather than
// leaving the door. A new way out is not necessarily wrong; it just has to answer this question.
{
  const decomment = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const scanStart = decomment(door).indexOf('_scanObserved');
  const handoff = decomment(door).indexOf('_sfRunExport({');
  const win = scanStart >= 0 && handoff > scanStart ? decomment(door).slice(scanStart, handoff) : '';
  ok('the region between the scan and the runner was located', win.length > 0,
     'without this slice the count below means nothing');
  const exits = (win.match(/return\s+false/g) || []).length;
  ok(`⭐⭐ the door still has exactly three early exits (${exits})`, exits === 3,
     'a NEW way out of this door appeared. It is not automatically wrong - but it leaves after '
     + 'the compare has run, so it has to commit what the scan learned or it throws that work '
     + 'away. Add it to EXITS above once you have decided which it is.');
}

console.log(failed ? `\n${failed} FAILED` : '\nmanifest-commit-exits: all passing');
process.exit(failed ? 1 : 0);
