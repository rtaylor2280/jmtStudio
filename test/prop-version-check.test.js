/**
 * A prop the selected OS version does not have — [B-185], on the registry.
 *
 * A config's `#include "../props/<file>.h"` names a prop that is not in the
 * ProffieOS version it builds with, usually because the version was switched or
 * the config came from someone else's tree. Today the only feedback is
 * arduino-cli's raw "No such file or directory", pointing at a path the user
 * never typed.
 *
 * ⭐ THE REAL CASE IS ONE DROPDOWN AWAY, which is why this is worth a check rather
 * than a translation: `jmt_fett263_wrapper.h` exists only in the `+JMT` trees, and
 * "ProffieOS 8.10" sits directly beside "ProffieOS 8.10 +JMT" in the picker.
 *
 * ⚠️ THE SHAPE GATE IS WHAT KEEPS IT HONEST. A prop can legitimately live outside
 * props/, and a hand-edited include is not ours to judge — so this only speaks when
 * the include matches our own props/ shape AND the file is absent from that exact
 * folder. Most of what follows asserts the silence.
 *
 * Run: node test/prop-version-check.test.js
 */
const path = require('path');
const preflight = require(path.join(__dirname, '..', 'renderer', 'preflight.js'));
require(path.join(__dirname, '..', 'renderer', 'preflight-checks.js'));

const check = preflight.checks().find(c => c.id === 'prop-missing-from-version');
if (!check) throw new Error('prop-missing-from-version is not registered');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// A fake tree: the props this version has, and nothing else.
const TREE = {
  'ProffieOS/props': { ok: true, entries: [
    { name: 'saber.h', type: 'file' },
    { name: 'saber_fett263_buttons.h', type: 'file' },
    { name: 'modes', type: 'dir' },
  ] },
};

const cfg = (inc) => '#ifdef CONFIG_TOP\n#define NUM_BLADES 1\n#endif\n'
  + (inc === null ? '' : `#ifdef CONFIG_PROP\n#include "${inc}"\n#endif\n`)
  + '#ifdef CONFIG_PRESETS\nPreset p[] = {{ "f", "", StylePtr<Red>(), "P1" }};\n'
  + 'BladeConfig b[] = {{ 0, WS281XBladePtr<100,bladePin>(), CONFIGARRAY(p) }};\n#endif';

const ctxFor = (text, extra = {}) => preflight.buildContext(Object.assign({
  text,
  versionName: 'ProffieOS 8.10',
  listVersionDir: async (v, p) => TREE[p] || { ok: false, error: 'Path not found.' },
}, extra));

const run = async (text, extra) => {
  const r = await check.run(ctxFor(text, extra));
  return {
    blocked: !!(r && r.findings && r.findings.length),
    unsure: r && r.unsure,
    findings: (r && r.findings) || [],
  };
};

(async () => {
  // ── 1. the fault ──────────────────────────────────────────────────────
  {
    const r = await run(cfg('../props/saber_sa22c_buttons.h'));
    ok('a prop absent from the selected version blocks', r.blocked);
    ok('it names the prop and the version',
       /saber_sa22c_buttons\.h is not in ProffieOS 8\.10\./.test(r.findings[0].title),
       r.findings[0] && r.findings[0].title);
    ok('it says what to do about it, in both directions',
       /Switch this config to a version that has the prop, or link a prop that exists/
         .test(r.findings[0].detail), r.findings[0] && r.findings[0].detail);
    ok('it offers no fix — which prop, or which version, is a decision',
       r.findings[0].fix === null);
    ok('it blocks: with the shape gate in front, an absent file cannot compile',
       check.severity === 'block');
  }

  // ── 2. the silences, which are most of the value ──────────────────────
  {
    ok('a prop the version HAS is silent',
       !(await run(cfg('../props/saber_fett263_buttons.h'))).blocked);
  }
  {
    // ProffieOS falls back to saber.h, and that rule was settled for Link Prop.
    // Having no prop while setting prop OPTIONS is a different check ([B-089]).
    ok('no prop at all is not this check\'s problem', !(await run(cfg(null))).blocked);
  }
  {
    ok('a prop outside props/ is not ours to judge',
       !(await run(cfg('../myprops/custom_thing.h'))).blocked);
  }
  {
    ok('an absolute path we do not model is left alone',
       !(await run(cfg('C:/Users/Someone/stuff/my_prop.h'))).blocked);
  }
  {
    // The tree lists `modes` as a directory. A directory whose name matched would
    // not be a prop file, and must not count as present OR be reported as missing.
    ok('a directory in props/ is not mistaken for a prop file',
       (await run(cfg('../props/modes'))).blocked === false,
       'a path with no .h does not match the shape at all');
  }

  // ── 3. when we cannot tell ────────────────────────────────────────────
  {
    const r = await run(cfg('../props/saber_sa22c_buttons.h'), { versionName: '' });
    ok('no version selected -> unsure, never a claim', !!r.unsure && !r.blocked, r.unsure);
  }
  {
    // ⚠️ A FAILED LISTING IS NOT AN ABSENT FILE. Saying "your prop is missing"
    // because our own lookup broke is the worst answer available.
    const r = await run(cfg('../props/saber_sa22c_buttons.h'), { listVersionDir: async () => ({ ok: false }) });
    ok('an unreadable props folder is unsure, not a missing prop', !!r.unsure && !r.blocked, r.unsure);
  }
  {
    const r = await run(cfg('../props/saber_sa22c_buttons.h'), { listVersionDir: async () => { throw new Error('io'); } });
    ok('a listing that throws is unsure, and never takes the compile down',
       !!r.unsure && !r.blocked);
  }

  // ── 4. several includes ───────────────────────────────────────────────
  {
    const text = '#ifdef CONFIG_TOP\n#define NUM_BLADES 1\n#endif\n'
      + '#ifdef CONFIG_PROP\n#include "../props/saber_fett263_buttons.h"\n'
      + '#include "../props/saber_sa22c_buttons.h"\n#endif\n'
      + '#ifdef CONFIG_PRESETS\nPreset p[] = {{ "f", "", StylePtr<Red>(), "P1" }};\n'
      + 'BladeConfig b[] = {{ 0, WS281XBladePtr<100,bladePin>(), CONFIGARRAY(p) }};\n#endif';
    const r = await run(text);
    ok('with two includes, only the missing one is reported',
       r.blocked && r.findings.length === 1
       && /saber_sa22c_buttons/.test(r.findings[0].title), r.findings.map(f => f.title).join(' '));
  }
  {
    // A prop include sitting OUTSIDE #ifdef CONFIG_PROP is a different fault with
    // its own signature, and reporting it here would name the wrong root cause.
    const text = '#ifdef CONFIG_TOP\n#include "../props/saber_sa22c_buttons.h"\n#endif\n'
      + '#ifdef CONFIG_PRESETS\nPreset p[] = {{ "f", "", StylePtr<Red>(), "P1" }};\n#endif';
    ok('an include outside CONFIG_PROP is not read as the prop', !(await run(text)).blocked);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall prop-version check tests passed');
  process.exit(failures ? 1 : 0);
})();
