/**
 * +Add reports real byte progress, and the loop actually yields  [B-400]
 *
 * ⭐ His, 2026-09-17: "+Add can actually bring in many files. and that's good, but if the user
 * selects 100 long wav files... that's real bytes that need to be tracked for sure."
 *
 * ⚠️⚠️ THE ASSERTION THAT MATTERS IS THE YIELD, NOT THE NUMBERS. The old loop was
 * `copyFileSync` plus a `readFileSync` hash, which holds the main process for the whole add —
 * so progress events describing the work queued *behind* the work and flushed after it
 * finished. Wiring a callback into that would produce a bar that sits at zero and jumps to
 * 100: green on a three-file test, broken for the case he reported.
 *
 * ⭐⭐ SO THIS TEST RUNS A TIMER ALONGSIDE THE ADD. If the timer never fires, the loop never
 * yielded and the bar cannot move, however correct the byte arithmetic is. That is the one
 * assertion a "did the callback fire" test cannot make — and the exact class of gap that let
 * [B-403] ship broken past a fully green suite.
 *
 * Run: node test/add-progress.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const tracks = require(path.join(__dirname, '..', 'soundFontSharedTracks.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// A .wav whose bytes are unique per seed, so dedupe sees genuinely different files.
function makeWav(dir, name, sizeBytes, seed) {
  const buf = Buffer.alloc(sizeBytes);
  buf.write('RIFF', 0);
  buf.write('WAVE', 8);
  for (let i = 12; i < sizeBytes; i += 997) buf[i] = (seed * 31 + i) & 0xff;
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  return p;
}

(async () => {
  const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'b400-'));
  const src  = path.join(tmp, 'src');
  const user = path.join(tmp, 'userData');
  fs.mkdirSync(src); fs.mkdirSync(user, { recursive: true });

  // Big enough that the hash streams in many chunks; small enough to stay quick.
  const SIZE = 2 * 1024 * 1024;
  const N = 5;
  const paths = [];
  for (let i = 0; i < N; i++) paths.push(makeWav(src, `trk${i}.wav`, SIZE, i + 1));

  // ── the add, instrumented ────────────────────────────────────────────────
  const samples = [];
  let timerTicks = 0;
  const timer = setInterval(() => { timerTicks++; }, 5);

  const res = await tracks.addFiles(user, paths, null, (p) => samples.push({ ...p }));

  clearInterval(timer);

  ok('the add succeeded', !!(res && res.ok), JSON.stringify(res && res.error));
  ok(`all ${N} files landed`, !!res && (res.added || []).length === N,
     `added ${(res && res.added || []).length}, skipped ${JSON.stringify(res && res.skipped)}`);

  // ⭐⭐ THE ONE THAT PROVES THE FIX.
  ok('⭐⭐ the event loop ran DURING the add (the loop yields)', timerTicks > 0,
     'a timer that never fired means the main process was blocked end to end — '
     + 'the bar would sit at zero and jump to 100');

  // ── the byte arithmetic ──────────────────────────────────────────────────
  ok('progress was reported at all', samples.length > 0);

  // ⚠️ Not just first and last. A bar needs intermediate frames to be a bar.
  const distinct = new Set(samples.map(s => s.done)).size;
  ok('⭐ progress is CONTINUOUS, not two endpoints', distinct >= 10,
     `only ${distinct} distinct values across ${samples.length} samples`);

  let monotonic = true;
  for (let i = 1; i < samples.length; i++) if (samples[i].done < samples[i - 1].done) monotonic = false;
  ok('⚠️ progress never goes backwards', monotonic);

  const last = samples[samples.length - 1] || {};
  ok('⚠️⚠️ the bar LANDS on 100%', !!last.total && last.done === last.total,
     `ended at ${last.done} of ${last.total} — [B-389]: a bar always reaches 100% before it moves on`);
  ok('nothing overshoots its total', samples.every(s => s.done <= s.total));

  // Each file is read twice (hash + copy) when dedupe is on, so the budget is 2x.
  ok('the budget counts the hash read AND the copy', last.total === N * SIZE * 2,
     `total was ${last.total}, expected ${N * SIZE * 2}`);

  ok('the current filename is reported', samples.some(s => /trk\d\.wav/.test(s.name || '')));

  // ── ONE file must move the bar on its own ────────────────────────────────
  // ⚠️⚠️ Found by mutation: reverting ONLY the hash to readFileSync left the yield assertion
  // GREEN, because the awaited copy still yields once per file. That is not good enough — a
  // sync hash of a 400 MB wav freezes for the whole read, and the user watching a single large
  // track sees nothing move. The honest test is WITHIN one file: a streamed hash reports many
  // times, a whole-file read reports twice (hash done, copy done).
  const solo = [];
  await tracks.addFiles(user, [makeWav(src, 'solo.wav', SIZE, 1234)], null, (p) => solo.push({ ...p }));
  const soloDistinct = new Set(solo.map(s => s.done)).size;
  ok('⭐⭐ a SINGLE file reports progress while it is read, not just when it finishes',
     soloDistinct >= 10,
     `one file produced only ${soloDistinct} distinct values — a whole-file read gives ~3, `
     + 'a streamed read gives one per chunk');

  // ── duplicates: the credit that stops the bar ending short ───────────────
  // ⚠️⚠️ Re-adding files already held is the MOST COMMON use of this path (re-importing a card
  // you already have). Every file is hashed and none is copied, so without crediting the copy
  // that never happens the bar would stop at exactly 50%.
  const dupSamples = [];
  const res2 = await tracks.addFiles(user, paths, null, (p) => dupSamples.push({ ...p }));
  ok('the second add finds them all as duplicates',
     !!res2 && (res2.duplicates || []).length === N && (res2.added || []).length === 0,
     `duplicates ${(res2 && res2.duplicates || []).length}, added ${(res2 && res2.added || []).length}`);

  const dupLast = dupSamples[dupSamples.length - 1] || {};
  ok('⭐⭐ an all-duplicate add still lands on 100%', !!dupLast.total && dupLast.done === dupLast.total,
     `ended at ${dupLast.done} of ${dupLast.total} — without the skipped-copy credit this stops at 50%`);

  // ⚠️⚠️ AND IT MUST GET THERE HONESTLY, NOT BY THE TERMINAL EMIT ALONE. Found by mutation:
  // deleting the per-duplicate credit left the endpoint assertion above GREEN, because the
  // terminal `done = total` covers for it. The two mask each other, so only a MID-RUN
  // assertion can tell them apart. Without the credit the bar crawls to 50% and then snaps.
  const dupMidMax = dupSamples.slice(0, -1).reduce((m, s) => Math.max(m, s.total ? s.done / s.total : 0), 0);
  ok('⭐⭐ an all-duplicate add passes 50% BEFORE the final tick',
     dupMidMax > 0.6,
     `highest mid-run fraction was ${(dupMidMax * 100).toFixed(1)}% — the skipped-copy credit is `
     + 'not being applied, and the terminal emit is hiding it');

  // ── a file that cannot be read must not strand the bar ───────────────────
  const missing = path.join(src, 'gone.wav');
  const mixSamples = [];
  await tracks.addFiles(user, [makeWav(src, 'new1.wav', SIZE, 99), missing], null,
    (p) => mixSamples.push({ ...p }));
  const mixLast = mixSamples[mixSamples.length - 1] || {};
  ok('⚠️ a missing source still lets the bar finish', !!mixLast.total && mixLast.done === mixLast.total,
     `ended at ${mixLast.done} of ${mixLast.total}`);

  // ── the route that only the TERMINAL emit covers ─────────────────────────
  // ⚠️⚠️ Found by mutation: deleting the terminal `done = total` left every assertion above
  // green, because in the happy path the per-file credits reach the total on their own. It
  // earns its place on the routes that settle NOTHING — a file rejected before any work is
  // charged for. Files leave that loop six ways and only two pay their own budget; this is
  // the assertion that keeps the seventh route from silently stopping the bar at 94%.
  const nonWav = path.join(src, 'notes.txt');
  fs.writeFileSync(nonWav, Buffer.alloc(SIZE, 3));
  const skipSamples = [];
  const res3 = await tracks.addFiles(user, [makeWav(src, 'new2.wav', SIZE, 77), nonWav], null,
    (p) => skipSamples.push({ ...p }));
  ok('the non-wav is skipped', !!res3 && (res3.skipped || []).length === 1,
     JSON.stringify(res3 && res3.skipped));
  const skipLast = skipSamples[skipSamples.length - 1] || {};
  ok('⭐⭐ a file rejected before any work still lets the bar reach 100%',
     !!skipLast.total && skipLast.done === skipLast.total,
     `ended at ${skipLast.done} of ${skipLast.total} — its bytes were budgeted and never spent`);

  // ── structural: the copy must stay async ─────────────────────────────────
  // ⚠️ HONEST ABOUT WHAT THIS IS. A behavioural test cannot separate an async copy from a
  // sync one at a fixture size that keeps this suite quick — a 2 MB copyFileSync returns in
  // milliseconds. Inflating the fixture to hundreds of MB to catch it would trade a fast
  // suite for one assertion. So this reads the source instead, and says so rather than
  // pretending to measure. The streamed hash above IS measured; this guards its other half.
  const modSrc = fs.readFileSync(path.join(__dirname, '..', 'soundFontSharedTracks.js'), 'utf8');
  const addBody = modSrc.slice(modSrc.indexOf('async function addFiles'),
                               modSrc.indexOf('function renameFile'));
  // ⚠️ Match a CALL, not the word. The bare word appears in this function's own comment
  // explaining what it replaced — the first draft of this assertion matched that and failed
  // against correct code, which then made every mutant look caught for the wrong reason.
  ok('⚠️ the copy in addFiles is awaited, never copyFileSync',
     /await fsp\.copyFile\(/.test(addBody) && !/fs\.copyFileSync\(/.test(addBody),
     'a synchronous copy blocks for the whole write — half of every file\'s work');

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall +Add progress tests passed');
  process.exit(failures ? 1 : 0);
})();
