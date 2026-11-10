/**
 * A preset still naming a style the Style Library renamed — the [B-656] compile check.
 *
 * The config-open review offers the library's new name and the user may decline it; this is the
 * second chance at compile, "without closing and reopening". Aliases only (his call, 2026-11-09):
 * a name is flagged only when the library records it as a former name and nothing carries it now.
 *
 * Run: node test/renamed-style-check.test.js
 */
const path = require('path');
const preflight = require(path.join(__dirname, '..', 'renderer', 'preflight.js'));
require(path.join(__dirname, '..', 'renderer', 'preflight-checks.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const LIB = [
  '/*--------------------------------- AstralProjectionBVM ---------------------------------*/',
  '// creator: BVM',
  '// formerly: AstralProjection, AstralOld',
  'using AstralProjectionBVM = Layers<Blue>;',
  '/*--------------------------------- CelsiusBVM ---------------------------------*/',
  '// formerly: Celsius',
  'using CelsiusBVM = Layers<Red>;',
  '/*--------------------------------- TwinA ---------------------------------*/',
  '// formerly: Twin',
  'using TwinA = Layers<Red>;',
  '/*--------------------------------- TwinB ---------------------------------*/',
  '// formerly: Twin',
  'using TwinB = Layers<Red>;',
  '/*--------------------------------- Plain ---------------------------------*/',
  'using Plain = Layers<Green>;',
  '',
].join('\n');

const ctxFor = (text, lib = LIB) => preflight.buildContext({
  text,
  versionName: null,
  readStylesLibrary: async () => lib,
});
const cfg = (...styles) => '#define NUM_BLADES 1\nPreset p[] = {\n'
  + styles.map((s, i) => `  { "f", "t.wav", ${s}, "P${i + 1}" },`).join('\n')
  + '\n};\nBladeConfig b[] = {{ 0, WS281XBladePtr<100,bladePin>(), CONFIGARRAY(p) }};';
const apply = (text, edits) => {
  const lines = text.split('\n');
  for (const e of [...edits].sort((a, b) => (b.startLine - a.startLine) || (b.startCol - a.startCol))) {
    const L = lines[e.startLine - 1];
    lines[e.startLine - 1] = L.slice(0, e.startCol) + e.text + L.slice(e.endCol);
  }
  return lines.join('\n');
};
const mine = (res) => res.findings.filter(f => f.checkId === 'renamed-library-style');

(async () => {
  {
    const text = cfg('StylePtr<AstralProjection>()', 'StylePtr<PixelSwitchWrapper<AstralProjection>>("0,1,0")', 'StylePtr<Plain>()');
    const ctx = ctxFor(text);
    const res = await preflight.run(ctx);
    const f = mine(res);
    ok('an old name is caught', f.length === 1, JSON.stringify(f.map(x => x.title)));
    ok('it names the old and the new', /no style called AstralProjection\. Your Style Library renamed it to AstralProjectionBVM\./.test(f[0].title), f[0] && f[0].title);
    ok('it blocks: the old name cannot compile', f[0].severity === 'block');
    ok('it names both presets using it', f[0].items.includes('P1') && f[0].items.includes('P2') && !f[0].items.includes('P3'), JSON.stringify(f[0].items));
    ok('one owner: a fix is offered, worded like the review', f[0].fix && f[0].fix.label === 'Update to AstralProjectionBVM', f[0].fix && f[0].fix.label);
    const after = apply(text, f[0].fix.plan(ctx));
    ok('the fix renames every use, wrappers too', /StylePtr<AstralProjectionBVM>\(\)/.test(after) && /PixelSwitchWrapper<AstralProjectionBVM>>\("0,1,0"\)/.test(after) && !/\bAstralProjection\b/.test(after), after);
    ok('nothing else is touched', /StylePtr<Plain>\(\)/.test(after) && /"P3"/.test(after));
    const again = mine(await preflight.run(ctxFor(after)));
    ok('after the fix the check is quiet', again.length === 0);
  }
  {
    // His read 2026-11-09: other checks combine their findings; so does this one.
    const text = cfg('StylePtr<AstralProjection>()', 'StylePtr<Celsius>()', 'StylePtr<PixelSwitchWrapper<Celsius>>("0,1,0")');
    const ctx = ctxFor(text);
    const f = mine(await preflight.run(ctx));
    ok('several renames: ONE card', f.length === 1, JSON.stringify(f.map(x => x.title)));
    ok('the card says how many, and names every old -> new',
      /3 presets use 2 styles your Style Library renamed\./.test(f[0].title) && /AstralProjection is now AstralProjectionBVM and Celsius is now CelsiusBVM\./.test(f[0].detail),
      f[0] && `${f[0].title} | ${f[0].detail}`);
    ok('one button for all of them', f[0].fix && f[0].fix.label === 'Update to the new names', f[0].fix && f[0].fix.label);
    const after = apply(text, f[0].fix.plan(ctx));
    ok('the button updates every one', /StylePtr<AstralProjectionBVM>\(\)/.test(after) && /StylePtr<CelsiusBVM>\(\)/.test(after) && /PixelSwitchWrapper<CelsiusBVM>>/.test(after) && !/\b(AstralProjection|Celsius)\b/.test(after), after);
  }
  {
    const f = mine(await preflight.run(ctxFor(cfg('StylePtr<AstralProjection>()', 'StylePtr<Twin>()'))));
    ok('a sure rename and a two-owner name: two cards, the second with no button', f.length === 2 && f[0].fix && f[1].fix === null && /TwinA, TwinB/.test(f[1].title), JSON.stringify(f.map(x => [x.title, !!x.fix])));
  }
  {
    const f = mine(await preflight.run(ctxFor(cfg('StylePtr<AstralOld>()'))));
    ok('every listed former name counts', f.length === 1 && /AstralProjectionBVM/.test(f[0].title));
  }
  {
    const f = mine(await preflight.run(ctxFor(cfg('StylePtr<Twin>()'))));
    ok('a name two styles once had: named, both owners listed', f.length === 1 && /TwinA, TwinB/.test(f[0].title), f[0] && f[0].title);
    ok('...and no fix button: picking one would be a guess', f[0] && f[0].fix === null);
  }
  {
    const f = mine(await preflight.run(ctxFor(cfg('StylePtr<SomethingUnknown>()'))));
    ok('an unknown name that is not a former one is left alone (aliases only)', f.length === 0);
  }
  {
    const text = 'using AstralProjection = Layers<White>;\n' + cfg('StylePtr<AstralProjection>()');
    const f = mine(await preflight.run(ctxFor(text)));
    ok('a style the config defines itself is that style', f.length === 0);
  }
  {
    const lib = LIB + '/*--------------------------------- Celsius ---------------------------------*/\nusing Celsius = Layers<Red>;\n';
    const f = mine(await preflight.run(ctxFor(cfg('StylePtr<Celsius>()'), lib)));
    ok('a name the library has again is that style', f.length === 0);
  }
  {
    const f = mine(await preflight.run(ctxFor(cfg('StylePtr<AstralProjection>()'), null)));
    ok('no library, nothing said', f.length === 0);
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
