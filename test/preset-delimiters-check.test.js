/**
 * Preset delimiters that do not balance — [B-030] lint 3, on the registry.
 *
 * The case this exists for: LiamSaber.h, 2026-07-24. A missing `,` after a track
 * string, and gcc said `expected '}' before 'StylePtr'` — a different line, in a
 * different preset. A 1,249-view Crucible thread has the same family diagnosed by
 * eye: "Your first preset is missing a closing brace }".
 *
 * ⭐ THE FIRST COMPILER ERROR IS THE HONEST ONE. Everything after it is the parser
 * guessing once it has lost its place, which is why those threads are full of
 * people reading the LAST error and chasing the wrong thing.
 *
 * ⚠️ THIS WAS BUILT ONCE AND LOST. `scratchpad/balance-check.js` was written into a
 * session temp directory and swept; four documents went on citing it as done. The
 * spec survived in crucible/error-corpus.md. It is in the repo now.
 *
 * THREE FAULTS, and the parser is blind to two of them:
 *   (a) an array whose braces never close  -> parser returns NO arrays
 *   (b) a missing comma after the track    -> parser reads it as perfectly valid
 *   (c) an imbalance inside one preset     -> parser reads the preset, badly
 *
 * Run: node test/preset-delimiters-check.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const preflight = require(path.join(ROOT, 'renderer', 'preflight.js'));
require(path.join(ROOT, 'renderer', 'preflight-checks.js'));

const check = preflight.checks().find(c => c.id === 'preset-delimiters');
if (!check) throw new Error('preset-delimiters is not registered');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const wrap = body => '#define NUM_BLADES 1\nPreset p[] = {\n' + body
  + '\n};\nBladeConfig bl[] = {{ 0, WS281XBladePtr<100,bladePin>(), CONFIGARRAY(p) }};';

const run = (text) => {
  const r = check.run(preflight.buildContext({ text }));
  return { fired: !!(r && r.findings && r.findings.length), findings: (r && r.findings) || [] };
};

(async () => {
  // ── (b) the headline case ─────────────────────────────────────────────
  {
    const r = run(wrap('  { "f", "t.wav" StylePtr<Red>(), "A" },'));
    ok('a missing comma after the track fires', r.fired);
    ok('it names the preset and the comma',
       /Preset A is missing a comma after its track/.test(r.findings[0].title),
       r.findings[0] && r.findings[0].title);
    ok('it explains WHY the compiler will point elsewhere',
       /further down, often in a different preset/.test(r.findings[0].detail),
       r.findings[0] && r.findings[0].detail);
    ok('it blocks — this cannot compile', check.severity === 'block');
  }

  // ── (a) an array that never closes ────────────────────────────────────
  {
    const text = '#define NUM_BLADES 1\nPreset p[] = {\n'
      + '  { "f", "t.wav", StylePtr<Red>(), "A" ,\n'      // no closing brace
      + '  { "g", "u.wav", StylePtr<Blue>(), "B" },\n};';
    const r = run(text);
    ok('an array whose braces never close fires', r.fired);
    ok('it names the LINE the list starts on',
       /The preset list starting on line 2 never closes/.test(r.findings[0].title),
       r.findings[0] && r.findings[0].title);
    // ⚠️ With the array unreadable there is nothing trustworthy to say about the
    // presets inside it. One honest finding beats a pile of guesses.
    ok('it stops there rather than reporting the presets inside', r.findings.length === 1,
       r.findings.map(f => f.title).join(' | '));
  }

  // ── (c) an imbalance inside one preset ────────────────────────────────
  {
    const r = run(wrap('  { "f", "t.wav", StylePtr<Red>(, "A" },'));
    ok('an unclosed paren inside a preset fires', r.fired);
    ok('it names the preset and the pair', /unbalanced \(\)/.test(r.findings[0].title),
       r.findings[0] && r.findings[0].title);
  }

  // ── the silences ──────────────────────────────────────────────────────
  {
    ok('a good preset is silent', !run(wrap('  { "f", "t.wav", StylePtr<Red>(), "A" },')).fired);
  }
  {
    ok('an empty track is not a missing comma',
       !run(wrap('  { "f", "", StylePtr<Red>(), "A" },')).fired);
  }
  {
    // `{ "TeensySF", "boot.wav" }` from the wild corpus: a truncated preset, and a
    // DIFFERENT fault — the blade-count check names it. Not ours to also report.
    ok('a two-element preset is left to the blade-count check',
       !run(wrap('  { "f", "t.wav" }')).fired);
  }
  {
    ok('braces inside a string literal do not count',
       !run(wrap('  { "f", "t{{{.wav", StylePtr<Red>(), "A" },')).fired);
  }
  {
    ok('braces inside a comment do not count',
       !run(wrap('  { "f", "t.wav", StylePtr<Red>(), "A" }, // }}} note')).fired);
  }
  {
    // ⚠️ ANGLE BRACKETS ARE NOT STRUCTURAL and are deliberately not counted:
    // Int<-1> and comparisons put stray < and > in perfectly valid code.
    ok('Int<-1> and friends do not trip the angle-bracket trap',
       !run(wrap('  { "f", "t.wav", StylePtr<Mix<Int<-1>,Red,Blue>>(), "A" },')).fired);
  }
  {
    const text = '#define NUM_BLADES 1\n/* Preset old[] = {\n  { "x", "y", StylePtr<Red>(), "Z" },\n*/\n'
      + 'Preset p[] = {\n  { "f", "t.wav", StylePtr<Red>(), "A" },\n};';
    ok('a commented-out preset array is not read as unclosed', !run(text).fired);
  }

  // ── the corpus ────────────────────────────────────────────────────────
  {
    const readDir = d => {
      try {
        return fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.h'))
          .map(f => path.join(ROOT, d, f));
      } catch { return []; }
    };
    const known = ['local/ConfigExamples', 'local/b226-test-configs', 'local/test-configs'].flatMap(readDir);
    const wild  = ['local/nightly/error-exp/wild/configs',
                   'local/nightly/error-exp/wild/configs2'].flatMap(readDir);

    if (!known.length) console.log('SKIP  no config corpus on this machine');
    else {
      const bad = known.filter(f => run(fs.readFileSync(f, 'utf8')).fired).map(f => path.basename(f));
      ok(`none of the ${known.length} known-good configs fire`, bad.length === 0, bad.join(', '));
    }
    if (wild.length) {
      // ⚠️ THESE ARE REAL FINDINGS, NOT A FALSE-POSITIVE BUDGET. Each names a line
      // where the brace walk SAW the group fail to close — an observation, not an
      // inference. A first build inferred it from a count mismatch instead and told
      // the wrong story about 7230_1.h, which is a forum paste with a bare
      // `Preset presets[] = {` at line 1 followed by a real config at line 65.
      const n = wild.filter(f => run(fs.readFileSync(f, 'utf8')).fired).length;
      ok(`the wild corpus still reports its unclosed arrays (${n} of ${wild.length})`,
         n > 0 && n < wild.length * 0.15, `fired on ${n}`);
    }
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall preset delimiter tests passed');
  process.exit(failures ? 1 : 0);
})();
