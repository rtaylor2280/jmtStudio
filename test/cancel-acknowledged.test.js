// A cancel must stay acknowledged, whichever painter runs next. [B-420]
//
// ⭐⭐ THE DEFECT THIS EXISTS FOR, 2026-09-24. Reported: *"clicking cancel has no visible
// response"*, during a backup, *"when the file is actually being created"*. `offerCancel` did
// everything right — set `cancelling`, wrote "Stopping…", switched the bar to indeterminate — and
// then the door's own 250 ms render loop painted the ordinary label straight back over it. The
// acknowledgement existed for a quarter of a second at a time and was never once seen.
//
// ⚠️⚠️ AND THE SHAPE IS THE ONE THIS PROJECT KEEPS REPEATING: A RULE WRITTEN BESIDE THE CALLERS
// THAT EXISTED. `offerCancel`'s own comment says *"Putting the state HERE means setPhase and
// setProgress honour it for surfaces nobody has written yet"* — it named the two painters open at
// the time. `setIndeterminate` arrived later with [B-408] and inherited nothing; `show()` never had
// it either, and show() is called mid-run to retitle ("Exporting (3 of 7)").
//
// ⭐ SO THIS IS A RECONCILIATION, NOT A SPOT CHECK. It enumerates every method on the progress
// surface that writes the label or the bar and requires each to consult the flag. A per-method
// assertion cannot see a method nobody listed — which is exactly how two of them went unguarded.
// The fifth painter, whenever someone adds it, fails here on its first run.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

console.log('cancel-acknowledged');

// ⚠️ Anchors asserted before use: an unmatched anchor makes a slice measure something real and
// report nothing true about it.
const s = html.indexOf('cancelling: false,');
const e = html.indexOf('// [B-357] Synchronous close', s);
ok('the progress surface was located', s > 0 && e > s,
   're-anchor if `cancelling: false,` or the [B-357] comment moves; everything below is vacuous '
   + 'without it');
const region = (s > 0 && e > s) ? html.slice(s, e) : '';
ok('the located region is non-empty', region.length > 0);

// ── The reconciliation ──────────────────────────────────────────────────────
const re = /\n        ([A-Za-z_][A-Za-z0-9_]*)\(/g;
const methods = [];
let m;
while ((m = re.exec(region))) methods.push({ name: m[1], at: m.index });
methods.push({ name: '<end>', at: region.length });

const painters = [];
for (let i = 0; i < methods.length - 1; i++) {
  const body = region.slice(methods[i].at, methods[i + 1].at);
  const touchesLabel = /labelEl\(\)/.test(body);
  const touchesBar = /barEl\(\)/.test(body);
  if (!touchesLabel && !touchesBar) continue;
  painters.push({ name: methods[i].name, guarded: /this\.cancelling/.test(body) });
}

// ⚠️ A count floor, because the danger is a painter that is never enumerated. If the parser stops
// matching (a refactor to arrow properties, say) this collapses to zero painters and every
// "guarded" assertion below passes vacuously — the empty-slice failure wearing a clean face.
ok('⭐ the reconciliation actually found the painters',
   painters.length >= 4,
   `found ${painters.length}: ${painters.map((p) => p.name).join(', ') || '(none)'} — `
   + 'zero or few means the parser stopped matching, not that the surface got simpler');

for (const p of painters) {
  ok(`⭐ ${p.name} consults this.cancelling before painting`, p.guarded,
     `${p.name} writes the label or the bar and does not check the flag, so it will repaint over `
     + 'an acknowledged cancel on its next tick');
}

// ── The acknowledgement itself uses the house animation ─────────────────────
// ⚠️ `.busy-dots` exists (2026-08-14) because "a static 'Resetting…' is indistinguishable from a
// frozen app" — and a frozen app is precisely what a user suspects at the moment they press Cancel
// on a long export. The one place the animation mattered most was hand-rolling a literal ellipsis.
const offerAt = region.indexOf('offerCancel(onCancel)');
const offerEnd = region.indexOf('clearCancel()', offerAt);
const offer = (offerAt > 0 && offerEnd > offerAt) ? region.slice(offerAt, offerEnd) : '';
ok('offerCancel was located', offer.length > 0);
ok('⭐ the cancel button animates rather than freezing on a literal ellipsis',
   /_btnBusy\(b, 'Cancelling'\)/.test(offer),
   'use the _btnBusy/.busy-dots convention, not a hand-typed "Cancelling…"');
ok('the promise about what is still happening survives',
   /finishing the current file/.test(offer),
   'the label has to say what it is still doing, or a modal that lingers reads as ignored');

console.log(failed ? `\ncancel-acknowledged: ${failed} FAILED` : '\ncancel-acknowledged: all passing');
process.exit(failed ? 1 : 0);
