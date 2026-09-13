/**
 * The odd-one-out shared folder name — [B-012], on the registry [B-224].
 *
 * One preset saying `;comn` beside fifty saying `;common`. It COMPILES AND FLASHES
 * FINE; the saber then says "font directory not found" on that preset, because
 * ProffieOS looks for every folder a preset names. That error is the single
 * most-searched pain on the Crucible — 51 threads.
 *
 * ⚠️⚠️ THIS CLOSES A LIVE REGRESSION. [B-326] shipped 2026-09-06 and made a shared
 * folder recognised by POSITION rather than by being spelled "common" — correct,
 * and the point of it. But an unrecognised name used to paint the preset red, which
 * was the wrong reason and a real signal, and B-012 was never built. So a
 * misspelled shared folder has been silent since. The entry said "ship them
 * together" in writing.
 *
 * ⭐ WHAT THIS SUITE IS REALLY FOR: not the detection, which is easy, but the three
 * legitimate shapes it must stay quiet on. A check that cries wolf on someone's
 * deliberate two-folder layout is worse than no check.
 *
 * Run: node test/shared-folder-typo-check.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const preflight = require(path.join(ROOT, 'renderer', 'preflight.js'));
require(path.join(ROOT, 'renderer', 'preflight-checks.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const cfg = (...fonts) => '#define NUM_BLADES 1\nPreset p[] = {\n'
  + fonts.map((f, i) => `  { "${f}", "", StylePtr<Red>(), "P${i + 1}" },`).join('\n')
  + '\n};\nBladeConfig b[] = {{ 0, WS281XBladePtr<100,bladePin>(), CONFIGARRAY(p) }};';

const many = (n, shared) => Array.from({ length: n }, (_, i) => `Font${i};${shared}`);

const check = preflight.checks().find(c => c.id === 'shared-folder-odd-one-out');
if (!check) throw new Error('shared-folder-odd-one-out is not registered');

const run = (text) => {
  const ctx = preflight.buildContext({ text });
  const res = check.run(ctx);
  return { ctx, fired: !!(res && res.findings), findings: (res && res.findings) || [] };
};

(async () => {
  // ── 1. the fault ──────────────────────────────────────────────────────
  {
    const r = run(cfg(...many(5, 'common'), 'Oddball;comn'));
    ok('a lone near-miss beside an established name fires', r.fired);
    ok('it names both spellings',
       /uses comn where the rest of your config uses common/.test(r.findings[0].title),
       r.findings[0] && r.findings[0].title);
    ok('it names the preset', r.findings[0].items.includes('P6'));
    ok('it is a warning — this compiles and flashes',
       check.severity === 'warn');
    ok('it says what the saber will do, not what the parser saw',
       /font directory not found/.test(r.findings[0].detail), r.findings[0].detail);
  }
  {
    // ⭐ THE CASE NO WORD LIST COULD EVER CATCH, and the reason the distance is
    // measured against the config's own names. A dictionary of
    // misspellings-of-"common" is blind to an MC config.
    const r = run(cfg(...many(5, 'MC'), 'Oddball;M C'));
    ok('MC typed as "M C" is caught, with no dictionary anywhere',
       r.fired && /uses M C where the rest of your config uses MC/.test(r.findings[0].title),
       r.findings[0] && r.findings[0].title);
  }

  // ── 2. the legitimate shapes it must not touch ────────────────────────
  {
    const r = run(cfg(...many(4, 'common')));
    ok('one name used everywhere is silent', !r.fired);
  }
  {
    // His own commonSith / commonJedi idea. Two conventions used evenly is a
    // design, not a slip — and they are only two edits apart.
    const r = run(cfg('a;commonSith', 'b;commonSith', 'c;commonSith',
                      'd;commonJedi', 'e;commonJedi', 'f;commonJedi'));
    ok('two conventions used evenly are left alone', !r.fired,
       r.findings.map(f => f.title).join(' '));
  }
  {
    // Measured from 7957_9.h, the only real multi-name config in 173: `common` x11
    // plus a nested path and a hilt-specific folder, both used once and both
    // legitimate. Frequency ALONE would have fired on both.
    const r = run(cfg(...many(11, 'common'), 'A;BalVenos/common', 'B;Nano Guantletcommons'));
    ok('distant lone outliers are left alone (the real-corpus case)', !r.fired,
       r.findings.map(f => f.title).join(' '));
  }
  {
    const r = run(cfg(...many(2, 'common'), 'Oddball;comn'));
    ok('two uses is not a convention to be odd against', !r.fired,
       r.findings.map(f => f.title).join(' '));
  }
  {
    // ⭐ A NUMBERED VARIANT IS DELIBERATE HOWEVER FEW PRESETS USE IT, and this is
    // the case frequency cannot see. `common2` is ONE edit from `common`, so
    // without this exception a lone one fires — and a lone one is the ORDINARY
    // way a second shared folder starts: you make it, then move one preset onto
    // it first. Nobody fat-fingers a digit onto the end of a word.
    const r = run(cfg(...many(5, 'common'), 'Oddball;common2'));
    ok('a lone NUMBERED variant is left alone', !r.fired,
       r.findings.map(f => f.title).join(' '));
  }
  {
    const r = run(cfg(...many(5, 'MC'), 'Oddball;MC2'));
    ok('...and it is not about the word "common"', !r.fired,
       r.findings.map(f => f.title).join(' '));
  }
  {
    const r = run(cfg(...many(5, 'common2'), 'Oddball;common3'));
    ok('...nor about the number being 2', !r.fired,
       r.findings.map(f => f.title).join(' '));
  }
  {
    // ⚠️ THE EXCEPTION MUST STAY NARROW. A suppression rule that is too broad hides
    // real typos, so it is TRAILING digits only and nothing else about the name.
    const r = run(cfg(...many(5, 'MC'), 'Oddball;M C'));
    ok('the exception does not swallow a real typo in a short name', r.fired,
       'M C should still fire');
  }
  {
    const r = run(cfg('Only;common'));
    ok('a single shared name and nothing else is silent', !r.fired);
  }
  {
    // A preset seeded with a shared folder and no font yet, plus one with no font
    // at all. Both are other problems, and neither is evidence about naming.
    const r = run(cfg(...many(4, 'common'), ';common', ''));
    ok('fontless presets contribute nothing', !r.fired,
       r.findings.map(f => f.title).join(' '));
  }

  // ── 3. the fix ────────────────────────────────────────────────────────
  {
    const text = cfg(...many(5, 'common'), 'Oddball;comn');
    const { ctx } = run(text);
    const f = check.run(ctx).findings[0];
    const edits = f.fix.plan(ctx);
    ok('the fix is offered', /Change comn to common/.test(f.fix.label), f.fix.label);
    ok('it edits only the offending preset', edits.length === 1, String(edits.length));

    const lines = text.split('\n');
    for (const e of [...edits].reverse()) {
      const L = lines[e.startLine - 1];
      lines[e.startLine - 1] = L.slice(0, e.startCol) + e.text + L.slice(e.endCol);
    }
    const out = lines.join('\n');
    ok('it rewrites the whole font value, keeping the font name',
       /"Oddball;common"/.test(out), out.split('\n')[7]);
    ok('the repaired config is clean on a re-run', !run(out).fired);
  }
  {
    // A typo in a NESTED path must keep the rest of the path intact.
    const text = cfg(...many(4, 'sabers/common'), 'Oddball;sabers/comon');
    const { ctx } = run(text);
    const res = check.run(ctx);
    if (!res || !res.findings.length) {
      ok('a nested-path typo is caught', false, 'did not fire');
    } else {
      const edits = res.findings[0].fix.plan(ctx);
      const lines = text.split('\n');
      for (const e of [...edits].reverse()) {
        const L = lines[e.startLine - 1];
        lines[e.startLine - 1] = L.slice(0, e.startCol) + e.text + L.slice(e.endCol);
      }
      ok('a nested-path typo is repaired without losing the path',
         /"Oddball;sabers\/common"/.test(lines.join('\n')), lines[6]);
    }
  }

  // ── 4. the corpus — the measurement that cannot be rigged ─────────────
  {
    const readDir = d => {
      try {
        return fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.h'))
          .map(f => path.join(ROOT, d, f));
      } catch { return []; }
    };
    const files = ['local/ConfigExamples', 'local/b226-test-configs', 'local/test-configs',
                   'local/nightly/error-exp/wild/configs',
                   'local/nightly/error-exp/wild/configs2'].flatMap(readDir);
    if (!files.length) console.log('SKIP  no config corpus on this machine');
    else {
      const fired = files.filter(f => run(fs.readFileSync(f, 'utf8')).fired).map(f => path.basename(f));
      // ⚠️ Unlike a typo'd style factory, THIS FAULT SURVIVES IN A FINISHED CONFIG —
      // it compiles and flashes, and only fails at runtime. So zero here is a real
      // frequency reading rather than survivorship, and any fire is a false positive
      // until proven otherwise.
      ok(`no config in the corpus of ${files.length} fires`, fired.length === 0, fired.join(', '));
    }
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall shared-folder typo tests passed');
  process.exit(failures ? 1 : 0);
})();
