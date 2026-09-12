/**
 * A style factory name that does not exist — the [B-324] check, on the registry.
 *
 * `StyleRainBowPtr` with a capital B is a hard compile error that costs a full
 * build to find. ⭐ ProffieOS's own documentation contains that exact typo
 * (config/common_presets.h line 16), so someone copying from the most trustworthy
 * source they have gets a config that cannot compile.
 *
 * ⚠️ THE LIST IS DERIVED FROM THE SELECTED OS, NEVER HARDCODED. Validating against
 * a stale list calls working code broken, which is the false positive that teaches
 * people to ignore every check. Measured 2026-09-12 and it corrected the entry on
 * the first run: 7.x and 8.x carry eight factories, but 6.9 has SEVEN — no
 * ChargingStylePtr. A hardcoded eight would have passed a 6.9 config that will not
 * build.
 *
 * The OS tree here is a FAKE one injected through the context, which is the point
 * of injecting it: this suite needs no ProffieOS install and no app.
 *
 * Run: node test/style-factory-check.test.js
 */
const path = require('path');
const preflight = require(path.join(__dirname, '..', 'renderer', 'preflight.js'));
require(path.join(__dirname, '..', 'renderer', 'preflight-checks.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// A fake tree shaped like the real one, including the two decoy lines that must
// NOT be read as factories: an indented member and an indented assignment.
const OS_TREE = {
  'ProffieOS/styles/style_ptr.h':
    'template<class STYLE>\nStyleAllocator StylePtr() {\n}\n'
  + 'StyleAllocator ChargingStylePtr() {\n}\n'
  + '  StyleAllocator style_allocator;\n'
  + '    StyleAllocator allocator = nullptr;\n',
  'ProffieOS/styles/fire.h':        'StyleAllocator StyleFirePtr() {\n}\n',
  'ProffieOS/styles/legacy.h':      'StyleAllocator StyleNormalPtr() {\n}\nStyleAllocator StyleRainbowPtr() {\n}\n',
  'ProffieOS/styles/README.md':     'StyleAllocator ThisIsDocumentationPtr() {\n}\n',
};

let reads = 0;
const ctxFor = (text, extra = {}) => preflight.buildContext(Object.assign({
  text,
  versionName: extra.versionName === undefined ? 'FakeOS 8.10' : extra.versionName,
  searchVersionFiles: async () => ({
    ok: true,
    results: Object.keys(OS_TREE).map(p => ({ type: 'file', path: p })),
  }),
  readVersionFile: async (v, p) => { reads++; return OS_TREE[p] ? { ok: true, content: OS_TREE[p] } : null; },
}, extra));

const cfg = (...styles) => '#define NUM_BLADES 1\nPreset p[] = {\n'
  + styles.map((s, i) => `  { "f", "t.wav", ${s}, "P${i + 1}" },`).join('\n')
  + '\n};\nBladeConfig b[] = {{ 0, WS281XBladePtr<100,bladePin>(), CONFIGARRAY(p) }};';

async function run(ctx) {
  const res = await preflight.run(ctx);
  return {
    factory: res.findings.filter(f => f.checkId === 'unknown-style-factory'),
    blade:   res.findings.filter(f => f.checkId === 'blade-style-count'),
    unsure:  res.unsure.find(u => u.id === 'unknown-style-factory') || null,
  };
}

(async () => {
  // ── 1. the fault, and the suggestion ──────────────────────────────────
  {
    const r = await run(ctxFor(cfg('StyleRainBowPtr<300,800>()')));
    ok('the OS documentation typo is caught', r.factory.length === 1);
    ok('it names the spelling found', /no style called StyleRainBowPtr/.test(r.factory[0].title),
       r.factory[0] && r.factory[0].title);
    ok('it offers the nearest real name', /Did you mean StyleRainbowPtr\?/.test(r.factory[0].detail),
       r.factory[0] && r.factory[0].detail);
    ok('it blocks — an unknown factory cannot compile', r.factory[0].severity === 'block');
    ok('it names the preset it is in', r.factory[0].items.includes('P1'));
    ok('a one-character miss is offered as a fix',
       !!r.factory[0].fix && /Change to StyleRainbowPtr/.test(r.factory[0].fix.label),
       r.factory[0].fix && r.factory[0].fix.label);
  }
  {
    // ⭐ THE FIX REWRITES THE NAME AND NOTHING ELSE. Template arguments, the call,
    // and every other slot in the preset are untouched, and it covers EVERY preset
    // using the bad name rather than only the first.
    const text = '#define NUM_BLADES 1\nPreset p[] = {\n'
      + '  { "f", "t.wav", StyleRainBowPtr<ControlMain>(), "One" },\n'
      + '  { "g", "t.wav", StyleRainBowPtr<Other,Int<3>>(), "Two" },\n'
      + '};\nBladeConfig b[] = {{ 0, WS281XBladePtr<100,bladePin>(), CONFIGARRAY(p) }};';
    const ctx = ctxFor(text);
    const res = await preflight.run(ctx);
    const f = res.findings.find(x => x.checkId === 'unknown-style-factory');
    const edits = f.fix.plan(ctx);
    ok('the fix covers every preset using the name', edits.length === 2, String(edits.length));

    const lines = text.split('\n');
    for (const e of [...edits].reverse()) {
      const L = lines[e.startLine - 1];
      lines[e.startLine - 1] = L.slice(0, e.startCol) + e.text + L.slice(e.endCol);
    }
    const out = lines.join('\n');
    ok('applying it produces the corrected name', !/StyleRainBowPtr/.test(out), out);
    ok('template arguments survive untouched',
       /StyleRainbowPtr<ControlMain>\(\)/.test(out) && /StyleRainbowPtr<Other,Int<3>>\(\)/.test(out), out);
    ok('the repaired config is clean on a re-run',
       !(await preflight.run(ctxFor(out))).findings.some(x => x.checkId === 'unknown-style-factory'));
  }
  {
    // Two edits away is worth SAYING and not worth DOING on someone's behalf.
    // StyleRainbwoPtr transposes the 'ow', which is two substitutions — close
    // enough to name, not close enough to act on.
    const r = await run(ctxFor(cfg('StyleRainbwoPtr<1>()')));
    ok('a two-character miss suggests in words but offers no fix button',
       r.factory.length === 1 && r.factory[0].fix === null
       && /Did you mean/.test(r.factory[0].detail),
       r.factory[0] && `${r.factory[0].detail} | fix=${!!r.factory[0].fix}`);
  }
  {
    // Far from anything: suggesting the closest of eight would be a guess, so it
    // lists what IS available instead of inventing an intention.
    const r = await run(ctxFor(cfg('StyleCompletelyUnrelatedNonsensePtr<1>()')));
    ok('a name nothing resembles gets no suggestion', r.factory.length === 1
       && !/Did you mean/.test(r.factory[0].detail), r.factory[0] && r.factory[0].detail);
    ok('instead it lists what the OS version provides',
       /Your ProffieOS version provides: ChargingStylePtr/.test(r.factory[0].detail),
       r.factory[0] && r.factory[0].detail);
  }

  // ── 2. silence on everything real ─────────────────────────────────────
  {
    const r = await run(ctxFor(cfg('StylePtr<Red>()', 'StyleFirePtr<Red,Yellow>()', 'ChargingStylePtr<Red>()')));
    ok('every real factory passes clean', r.factory.length === 0,
       r.factory.map(f => f.title).join(' '));
  }
  {
    const r = await run(ctxFor(cfg('&style_charging')));
    ok('a &reference is not a factory call and is left alone', r.factory.length === 0);
  }
  {
    // ⚠️⚠️ THE OS IS THE ONLY SOURCE, AND THIS ASSERTION USED TO SAY THE OPPOSITE.
    // An earlier build also read factories out of the config and the Style Library
    // so we would not warn on a user's own helper. That was wrong on a ProffieOS
    // fact: A CONFIG CANNOT CARRY A FUNCTION DEFINITION AT ALL. ProffieOS.ino
    // includes the config SEVEN times under different CONFIG_* guards — CONFIG_PROP
    // twice — so `StyleAllocator Foo() {…}` anywhere in it is a redefinition error.
    // A Style Library holds `using X = …` type aliases, which can never be a
    // factory. Measured: 0 of 173 real configs define one, and a 3,176-line real
    // Style Library has 141 aliases and none.
    //
    // ⭐ AND THE OLD BEHAVIOUR WAS A SUPPRESSION PATH, not a safeguard: accepting a
    // name defined by text that itself cannot build means going SILENT on a config
    // that is already broken. Defensive code for an impossible input defends
    // nothing and hides something.
    const r = await run(ctxFor('StyleAllocator StyleMyOwnPtr() {}\n' + cfg('StyleMyOwnPtr<Red>()')));
    ok('a StyleAllocator in the CONFIG is not a source of valid names',
       r.factory.length === 1, 'expected the name to still be flagged');
  }
  {
    // The decoys in the fake tree: an indented member and an indented assignment
    // must never be read as factory names.
    const r = await run(ctxFor(cfg('style_allocator<Red>()', 'allocator<Red>()')));
    ok('indented StyleAllocator DECLARATIONS are not mistaken for factories',
       r.factory.length === 0, r.factory.map(f => f.title).join(' '));
  }

  // ── 3. when we cannot tell ────────────────────────────────────────────
  {
    const r = await run(ctxFor(cfg('StyleRainBowPtr<1>()'), { versionName: '' }));
    ok('no OS version selected -> unsure, never a guess', !!r.unsure && r.factory.length === 0,
       r.unsure && r.unsure.reason);
  }
  {
    const ctx = preflight.buildContext({
      text: cfg('StyleRainBowPtr<1>()'),
      versionName: 'BrokenOS',
      searchVersionFiles: async () => ({ ok: true, results: [] }),
      readVersionFile: async () => null,
    });
    const r = await run(ctx);
    ok('an OS tree that reads as EMPTY is a failed read, not an OS with no styles',
       !!r.unsure && r.factory.length === 0, JSON.stringify(r.factory.map(f => f.title)));
  }
  {
    const ctx = preflight.buildContext({
      text: cfg('StyleRainBowPtr<1>()'),
      versionName: 'ThrowingOS',
      searchVersionFiles: async () => { throw new Error('io'); },
    });
    const r = await run(ctx);
    ok('a search that throws is unsure, and never takes the compile down',
       !!r.unsure && r.factory.length === 0);
  }
  {
    // ⭐ THE PARTIAL READ, which is the way this check would turn into a liar. An
    // empty result is obviously broken; a result carrying SOME names is not, and
    // would have us flagging valid ones. StylePtr is the sentinel — every
    // ProffieOS that has ever existed defines it, verified across all seven
    // installed trees — so its absence means the tree was not read, whatever else
    // came back. This is what keeps the check maintainable with no list: a future
    // OS that declares factories differently makes us go QUIET, not wrong.
    const ctx = preflight.buildContext({
      text: cfg('StyleFirePtr<1>()'),
      versionName: 'HalfReadOS',
      searchVersionFiles: async () => ({ ok: true, results: [{ type: 'file', path: 'ProffieOS/x.h' }] }),
      readVersionFile: async () => ({ ok: true, content: 'StyleAllocator SomethingElsePtr() {\n}\n' }),
    });
    const r = await run(ctx);
    ok('a PARTIAL read (no StylePtr) is refused, not trusted',
       !!r.unsure && r.factory.length === 0,
       `findings: ${r.factory.map(f => f.title).join(' ')}`);
  }

  // ── 4. the shape limit, asserted rather than hidden ───────────────────
  {
    // presetParser only recognises a slot whose name contains Style AND Ptr
    // (/\b\w*Style\w*Ptr\w*\s*</ — B-321's shape matching). A typo that breaks the
    // shape is invisible HERE: the slot is not seen at all, so the preset reads as
    // having no style and the BLADE COUNT check blocks it instead. Different
    // message, still stopped before the compile.
    // ⭐ If presetParser ever widens what it accepts, this assertion flips and this
    // test fails on purpose — at which point this check starts covering it.
    const r = await run(ctxFor(cfg('StlyePtr<1>()')));
    ok('KNOWN LIMIT: a typo breaking the Style…Ptr shape is caught by blade count, not here',
       r.factory.length === 0 && r.blade.length === 1,
       `factory=${r.factory.length} blade=${r.blade.length}`);
  }

  // ── 5. the derivation is FRESH every compile ──────────────────────────
  {
    // ⭐ NOT CACHED, ON PURPOSE. A per-session cache was written and removed the
    // same hour: it saved 117 ms on an action whose next step takes minutes, and
    // bought a staleness window where adding a factory to an OS tree with the app
    // open would flag a brand-new valid name until restart — the exact false
    // positive this check exists to prevent, reintroduced by the optimisation.
    // ⚠️ If someone reintroduces caching, this assertion is what fails.
    //
    // Run the check DIRECTLY, not the whole registry: a first draft counted every
    // readVersionFile across preflight.run(), and the voicepack check reads a prop
    // header every run, so the counter answered "how many files did preflight
    // read" rather than "was the tree re-read". The instrument was wrong.
    const check = preflight.checks().find(c => c.id === 'unknown-style-factory');
    reads = 0;
    await check.run(ctxFor(cfg('StylePtr<Red>()'), { versionName: 'FreshProbe' }));
    const first = reads;
    await check.run(ctxFor(cfg('StylePtr<Red>()'), { versionName: 'FreshProbe' }));
    ok('the OS tree is re-read every compile, so a tree edited mid-session is seen',
       first > 0 && reads === first * 2, `first=${first} total=${reads}`);
    ok('source files are read and documentation is not',
       first === 3, `read ${first} of ${Object.keys(OS_TREE).length} tree entries`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall style factory check tests passed');
  process.exit(failures ? 1 : 0);
})();
