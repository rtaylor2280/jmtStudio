/**
 * The bulk progress bar only ever moves forward  [B-360]
 *
 * 2026-09-08, watching the 136-font analyze and the 7-source run: "the progress bar
 * would go up, then back down and work it's way up... unusual and I don't see that on
 * a normal import."
 *
 * TWO CAUSES, both real, both previously documented as intentional:
 *
 *   1. THE ANALYZE IS THREE SEQUENTIAL PASSES sharing one bar — Analyzing fonts,
 *      Checking your library, Reading creators and previews — and each restarted at
 *      its own sourceIdx/total. That was a deliberate 2026-08-31 call to stop a bar
 *      parked at 100% reading as hung. ⭐ Right diagnosis, wrong cure: the answer to
 *      parked-at-100% is a BIGGER DENOMINATOR, not a rewind.
 *
 *   2. WITHIN THE RUN, each stage of a source reported its own 0-100%, so finishing
 *      the hash at 100% and starting the copy at 0% dropped the bar by a whole slice,
 *      three times per source. The code's own comment admitted it: "Phase transitions
 *      cause small discontinuities."
 *
 * ⚠️ A MONOTONIC CLAMP IS NOT THE FIX and this suite is written so it cannot pass by
 * clamping alone: the bands and the combined denominator are asserted directly. A
 * clamped-but-stalled bar hides a real regression instead of showing it.
 *
 * Run: node test/bulk-progress-monotonic.test.js
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

// ── 1. the analyze: one denominator across three passes ────────────────────
{
  ok('the analyze declares three passes', /const _A_PASSES = 3;/.test(html));
  ok('position spans all three', /\(pass \* total\) \+ Math\.min\(idx \+ within, total\)/.test(html));
  ok('and divides by the combined total', /\(_A_PASSES \* total\)/.test(html));

  // The arithmetic, reproduced: pass p item i of n must never be behind pass p-1.
  const pos = (pass, idx, within, total) =>
    (((pass * total) + Math.min(idx + within, total)) / (3 * total)) * 100;

  const total = 4;
  let last = -1, drops = 0;
  for (let pass = 0; pass < 3; pass++) {
    for (let idx = 0; idx < total; idx++) {
      for (const w of [0, 0.5, 1]) {
        const p = pos(pass, idx, w, total);
        if (p < last - 1e-9) drops++;
        last = Math.max(last, p);
      }
    }
  }
  ok('three full passes never produce a decrease', drops === 0, `${drops} decreases`);
  ok('pass 1 starts where pass 0 ended', Math.abs(pos(1, 0, 0, total) - pos(0, total - 1, 1, total)) < 1e-9,
     `${pos(1, 0, 0, total)} vs ${pos(0, total - 1, 1, total)}`);
  ok('the last pass ends at 100%', Math.abs(pos(2, total - 1, 1, total) - 100) < 1e-9);
  // ⭐ THE 2026-08-31 SYMPTOM MUST NOT COME BACK EITHER: pass 0 finishing should read
  // as a third done, not as finished.
  ok('finishing the first pass reads as 33%, not 100%',
     Math.abs(pos(0, total - 1, 1, total) - 33.333) < 0.01, `${pos(0, total - 1, 1, total)}`);

  ok('the labels still change per pass',
     /Analyzing fonts · /.test(html) && /Checking your library · /.test(html)
     && /Reading creators and previews · /.test(html),
     'a bar with no changing label is what 2026-08-31 was fixing');
}

// ── 2. the run: each stage owns a band ─────────────────────────────────────
{
  const m = html.match(/const _STAGE_BAND = \{[\s\S]*?\};/);
  ok('the stage band table exists', !!m);
  const bands = new Function(`${m[0]} return _STAGE_BAND;`)();

  ok('every run stage has a band',
     ['hashing', 'copying', 'extracting', 'optimizing', 'skipped'].every(s => bands[s]),
     Object.keys(bands).join(', '));

  // ⭐ THE PROPERTY THAT MATTERS: the bands tile forward with no gaps and no overlap,
  // so a stage ending hands the next one exactly its floor.
  const order = ['hashing', 'copying', 'extracting', 'optimizing'];
  let seams = 0;
  for (let i = 1; i < order.length; i++) {
    if (bands[order[i]][0] !== bands[order[i - 1]][1]) seams++;
  }
  ok('the bands tile without a gap or an overlap', seams === 0, JSON.stringify(bands));
  ok('they start at 0 and end at 100',
     bands.hashing[0] === 0 && bands.optimizing[1] === 100);
  ok('each band moves forward', order.every(s => bands[s][1] > bands[s][0]));

  // Simulate a whole run: 3 sources, each walking every stage 0→100.
  const within = (stage, pct) => {
    const b = bands[stage];
    const p = Math.max(0, Math.min(100, pct == null ? 0 : pct)) / 100;
    return (b[0] + (b[1] - b[0]) * p) / 100;
  };
  const totalSrc = 3;
  let prev = -1, dips = 0;
  for (let s = 0; s < totalSrc; s++) {
    for (const stage of order) {
      for (const pct of [0, 25, 50, 75, 100]) {
        const overall = Math.min(100, ((s + within(stage, pct)) / totalSrc) * 100);
        if (overall < prev - 1e-9) dips++;
        prev = Math.max(prev, overall);
      }
    }
  }
  ok('a three-source run never dips at a stage change', dips === 0, `${dips} dips`);
  ok('the run reaches 100%', Math.abs(prev - 100) < 1e-9, `${prev}`);

  // ⚠️ The old behaviour, kept as the counter-example so the test states what it
  // prevents: every stage on its own 0-100 scale DOES dip, three times per source.
  let oldDips = 0; let oldPrev = -1;
  for (let s = 0; s < totalSrc; s++) {
    for (const stage of order) {
      for (const pct of [0, 50, 100]) {
        const overall = Math.min(100, ((s + pct / 100) / totalSrc) * 100);
        if (overall < oldPrev - 1e-9) oldDips++;
        oldPrev = overall;
      }
    }
  }
  ok('(and the OLD arithmetic really did dip, so this is not a no-op test)', oldDips > 0,
     `${oldDips} dips under the previous scheme`);
}

// ── 3. the clamp is a backstop, not the mechanism ──────────────────────────
{
  ok('the stage travels with the percent',
     /setBarFromPosition\(data\.sourceIdx, t, data\.sub\.percent, data\.sub\.stage\)/.test(html),
     'without the stage every band collapses back to one 0-100 scale');
  ok('the tracks-check phase releases the analyze floor',
     /_aFloor = 0;/.test(html),
     'it owns the bar with its own denominator; clamping to the font passes would stick it');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall bulk progress tests passed');
process.exit(failures ? 1 : 0);
