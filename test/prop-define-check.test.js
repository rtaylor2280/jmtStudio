/**
 * Prop defines with no prop — the [B-089] check, on the registry [B-224].
 *
 * The fault: a config sets FETT263_* (or SA22C_*, BC_*, …) options and includes
 * no prop at all. ProffieOS falls back to its default prop, every one of those
 * defines becomes dead code, and the board boots with no way to navigate the
 * saber. IT COMPILES CLEANLY — there is no diagnostic anywhere, which is why it
 * has to be caught before the build.
 *
 * ⚠️ THE ABSTENTIONS ARE THE POINT OF THIS SUITE, not the detection. The rule's
 * first draft matched on prop header FILENAMES and scored 6 false positives on
 * the 8 known-good configs in this repo, all of which include `../props/jmt_fett_prop.h`
 * — a prop outside the stock directory. Any filename allowlist is a wolf-crier by
 * construction. So most of what follows asserts that the check SHUTS UP.
 *
 * Run: node test/prop-define-check.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const preflight = require(path.join(ROOT, 'renderer', 'preflight.js'));
require(path.join(ROOT, 'renderer', 'preflight-checks.js'));

const check = preflight.checks().find(c => c.id === 'prop-defines-without-prop');
if (!check) throw new Error('prop-defines-without-prop is not registered');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const run = (text) => {
  const res = check.run(preflight.buildContext({ text }));
  return {
    fired:   !!(res && res.findings && res.findings.length),
    unsure:  !!(res && res.unsure),
    silent:  !res,
    findings: (res && res.findings) || [],
    reason:  res && res.unsure,
  };
};

const PRESETS = `
#ifdef CONFIG_PRESETS
Preset presets[] = {
  { "font", "track.wav", StylePtr<Red>(), "One" },
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(presets) }};
#endif
`;

const cfg = ({ defines = [], prop = null, propSection = true }) => `
#ifdef CONFIG_TOP
#define NUM_BLADES 1
${defines.map(d => `#define ${d}`).join('\n')}
#endif
${propSection ? `
#ifdef CONFIG_PROP
${prop ? `#include "${prop}"` : ''}
#endif
` : ''}
${PRESETS}`;

{
  // ── 1. the fault it exists for ────────────────────────────────────────
  const r = run(cfg({ defines: ['FETT263_QUICK_SELECT_ON_BOOT', 'FETT263_TWIST_ON', 'FETT263_EDIT_MODE_MENU'],
                      propSection: false }));
  ok('no prop section at all, with prop defines, fires', r.fired);
  ok('it is a warning, not a block', check.severity === 'warn');
  ok('it says what will happen rather than naming a define',
     /none of the controls you set up will work/.test(r.findings[0].detail), r.findings[0].detail);
  ok('it names a likely prop without claiming certainty',
     /usually saber_fett263_buttons\.h/.test(r.findings[0].detail), r.findings[0].detail);
  ok('it offers NO fix — choosing a prop is a decision, not a repair',
     r.findings[0].fix === null);
}
{
  const r = run(cfg({ defines: ['FETT263_TWIST_ON'], prop: null }));
  ok('an EMPTY prop section fires too', r.fired);
}

// ── 2. the abstentions ────────────────────────────────────────────────
{
  const r = run(cfg({ defines: ['FETT263_TWIST_ON'], prop: '../props/saber_fett263_buttons.h' }));
  ok('the expected prop present -> silent', r.unsure && !r.fired, r.reason);
}
{
  // THE 6-FALSE-POSITIVE CASE. The known-good configs include a JMT prop that is not
  // in the stock props/ directory. A filename allowlist called all of them broken.
  const r = run(cfg({ defines: ['FETT263_TWIST_ON'], prop: '../props/jmt_fett_prop.h' }));
  ok('a CUSTOM prop filename -> abstains, never fires', r.unsure && !r.fired, r.reason);
}
{
  const r = run(cfg({ defines: ['FETT263_TWIST_ON'], prop: '../props/something_nobody_has_seen.h' }));
  ok('an unknown prop filename -> abstains', r.unsure && !r.fired, r.reason);
}
{
  const r = run(cfg({ defines: [] }));
  ok('no prop defines at all -> nothing to say', r.silent);
}
{
  // A CONFIG_TOP block pasted into a forum thread is not a config. Seven of
  // thirteen wild hits were exactly this.
  const r = run(`
#ifdef CONFIG_TOP
#define FETT263_TWIST_ON
#endif
`);
  ok('a fragment with no presets -> abstains rather than accusing', r.unsure && !r.fired, r.reason);
}
{
  const r = run(cfg({ defines: ['SHTOK_SOMETHING'], propSection: false }));
  ok('there is no SHTOK_ prefix, so it cannot fire on one', r.silent);
}
{
  const commented = `
#ifdef CONFIG_TOP
#define NUM_BLADES 1
// #define FETT263_TWIST_ON
/* #define FETT263_EDIT_MODE_MENU */
#endif
${PRESETS}`;
  ok('commented-out defines do not count', run(commented).silent);
}

// ── 3. shape of the message ───────────────────────────────────────────
{
  const many = Array.from({ length: 21 }, (_, i) => `FETT263_OPTION_${i}`);
  const r = run(cfg({ defines: many, propSection: false }));
  ok('21 defines produce ONE finding, not 21', r.findings.length === 1, String(r.findings.length));
  ok('the count is stated', /sets 21 FETT263_ options/.test(r.findings[0].title), r.findings[0].title);
  ok('only a few examples are carried, not all 21', r.findings[0].items.length <= 3);
}
{
  const r = run(cfg({ defines: ['SA22C_NO_LOCKUP_HOLD'], propSection: false }));
  ok('a second prop family works the same way',
     r.fired && /SA22C_/.test(r.findings[0].title), r.findings[0] && r.findings[0].title);
  ok('singular reads as singular', /sets 1 SA22C_ option,/.test(r.findings[0].title), r.findings[0].title);
}

// ── 4. the corpus — the only measurement that cannot be rigged ────────
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

  if (!known.length && !wild.length) console.log('SKIP  no config corpus on this machine');
  else {
    const firedIn = (files) => files.filter(f => run(fs.readFileSync(f, 'utf8')).fired)
      .map(f => path.basename(f));

    const badKnown = firedIn(known);
    ok(`none of the ${known.length} known-good configs fire`, badKnown.length === 0, badKnown.join(', '));

    // Measured in the research harness before this was ported, and re-measured
    // here: exactly one genuine fault in the wild corpus. 21 FETT263_ options and
    // no CONFIG_PROP section at all — that saber boots with no working controls.
    const badWild = firedIn(wild);
    ok(`exactly the one known real fault fires across ${wild.length} wild configs`,
       badWild.length === 1 && badWild[0] === '7957_9.h', badWild.join(', '));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall prop-define check tests passed');
process.exit(failures ? 1 : 0);
