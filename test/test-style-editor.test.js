// Test Style: any style opens in Fredrik's online style editor, its library helpers written in. [B-575]
//
// Runs the real code out of renderer/index.html against a small library:
//   1. every form a style comes in (StylePtr with and without arguments, using, bare, a library name);
//   2. helpers and wrappers expanded, template arguments filled from the use or the default;
//   3. the URL is the editor's ?S= format, and a value with no default is refused, not guessed.
'use strict';

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const fn = (name) => {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) return '';
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); }
  }
  return '';
};
const names = ['_splitTemplateArgs', '_independentStyle', '_testStyleInEditor', '_getHelperTemplateParams', '_parseStyleEntries',
  '_parseStyleMeta', '_styleCodeStart', '_extractStylePtrInner', '_findUsingExprEnd', '_foldConstArgs', '_applyStyleArgs'];
const missing = names.filter((n) => !fn(n));
check('located', !missing.length, missing.join(', '));
const consts = ['_STYLE_EDITOR_URL', '_COPY_STYLE_INNER_PLACEHOLDER'].map((c) => (html.match(new RegExp(`^const ${c} = .*$`, 'm')) || [''])[0]);

const LIB = `/*------ Glow ------*/
using Glow = AudioFlicker<Blue,Cyan>;

template<class INNER,int START_DELAY = 2000>
using Wrap = Layers<INNER,TransitionEffectL<TrConcat<TrDelay<START_DELAY>,Red,TrFade<300>>,EFFECT_IGNITION>>;

template<int dir = 0>
using Spin = Layers<Stripes<100,3000,Black,Int<dir>>>;

template<int SPEED>
using NeedsSpeed = Layers<Stripes<SPEED,100,Red,Blue>>;

/*------ UsesGlow ------*/
using UsesGlow = Layers<Glow,InOutTrL<TrWipe<300>,TrWipeIn<500>>>;
`;
const out = { opened: null, errors: [] };
const env = new Function('LIB', 'window', 'promptError', `let _stylesEditorInstance = { getValue: () => LIB }; let _silentStylesText = null;
  ${consts.join('\n')}
  ${names.map((n) => (n === '_testStyleInEditor' ? 'async ' : '') + fn(n)).join('\n')}
  return { forEditor: _independentStyle, test: _testStyleInEditor };`)(LIB,
  { electronAPI: { openExternal: async (u) => { out.opened = u; } } }, (t, m) => out.errors.push(m));
const ex = (s) => env.forEditor(s).expr;

console.log('1. every form a style comes in');
check('StylePtr<...>() becomes its expression', ex('StylePtr<Layers<Red,InOutTrL<TrWipe<300>,TrWipeIn<500>>>>()') === 'Layers<Red,InOutTrL<TrWipe<300>,TrWipeIn<500>>>');
check('StylePtr with arguments and a trailing comma, as in a preset', ex('StylePtr<Layers<Red,Blue>>("65535,0,0"),') === 'Layers<Red,Blue>');
check('a header comment above StylePtr is not the style', ex('/* copyright Fett263\n*/\nStylePtr<Layers<Red>>()') === 'Layers<Red>');
check('a using line', ex('using Foo = Layers<Green,Blue>;') === 'Layers<Green,Blue>');
check('a bare expression', ex('Layers<Red,Blue>;') === 'Layers<Red,Blue>');
check('a library name', ex('UsesGlow') === 'Layers<AudioFlicker<Blue,Cyan>,InOutTrL<TrWipe<300>,TrWipeIn<500>>>', ex('UsesGlow'));

console.log('2. helpers and wrappers written in');
check('a helper inside a style', ex('StylePtr<Layers<Glow,Red>>()') === 'Layers<AudioFlicker<Blue,Cyan>,Red>', ex('StylePtr<Layers<Glow,Red>>()'));
const w = ex('StylePtr<Wrap<UsesGlow>>()');
check('a wrapper takes the style it wraps, and its default delay', w === 'Layers<Layers<AudioFlicker<Blue,Cyan>,InOutTrL<TrWipe<300>,TrWipeIn<500>>>,TransitionEffectL<TrConcat<TrDelay<2000>,Red,TrFade<300>>,EFFECT_IGNITION>>', w);
check('a value given in the use wins over the default', /TrDelay<500>/.test(ex('Wrap<Red,500>')), ex('Wrap<Red,500>'));
check('an int default is filled', ex('Spin') === 'Layers<Stripes<100,3000,Black,Int<0>>>', ex('Spin'));
check("a wrapper's own using line, by name: the style it wraps is a stand-in", /^Layers<InOutHelper<Blue,300,800>,/.test(ex('template<class INNER,int START_DELAY = 2000>\nusing Wrap = Layers<INNER,Red>;')));
check('names that are not the library\'s are left alone', ex('Layers<Glowing,GlowX>') === 'Layers<Glowing,GlowX>');
const ind = env.forEditor('StylePtr<Wrap<UsesGlow>>("65535,0,0"),');
check('the independent style keeps its StylePtr arguments',
  ind.args === '"65535,0,0"' && ind.style === `StylePtr<${ind.expr}>("65535,0,0")` && !/\b(Wrap|UsesGlow|Glow|INNER|START_DELAY)\b/.test(ind.style), ind.style);
check('no arguments: an empty ()', env.forEditor('StylePtr<Glow>()').style === 'StylePtr<AudioFlicker<Blue,Cyan>>()');

console.log('2b. where it is offered');
check('the style window: Test Style between Paste Code and undo, testing the code on screen',
  /id="btn-style-detail-paste-code"[^\n]*\n\s*<button class="modal-btn-cancel" id="btn-style-detail-test"[^\n]*\n\s*<button class="modal-btn-cancel" id="btn-detail-undo"/.test(html)
  && /_testStyleInEditor\(prefix && _detailName \? _detailName : body\);/.test(html));
check('a style card\'s right-click, with or without a config open',
  /menu\.appendChild\(_testStyleMenuItem\(styleName, \(\) => \{ menu\.style\.display = 'none'; menu\.style\.minWidth = ''; \}\)\);/.test(html)
  && /const testItem = _testStyleMenuItem\(styleName, closeAll\);/.test(html));
check("a font's style file in the viewer: the picked style", /id="sf-doc-viewer-copy-style"[^\n]*\n\s*<button class="modal-btn-cancel" id="sf-doc-viewer-test-style"/.test(html)
  && /if \(s\) _testStyleInEditor\(s\.code\);/.test(html));
check('the open blade: a Test Style text button in each mode\'s row, not on the name row, not for a ref or a follower',
  /const _canTestBlade = slot\.type !== 'ref' && !_slotIsFollowingHere\(preset, slotIdx\);/.test(html)
  && /_mkBladeTestBtn\(\(\) => ta\.value\.trim\(\) \|\| _getFullSlotTextFromEditor\(slot\) \|\| fullSlotText\)/.test(html)
  && /libTestBtn = _mkBladeTestBtn\(\(\) => _getFullSlotTextFromEditor\(slot\) \|\| fullSlotText\);\s*libTestBtn\.style\.marginLeft = 'auto';\s*libLinkRow\.append\(customLink, libTestBtn\);/.test(html)
  && /tpSection, customLink, libTestBtn, libLinkRow, primaryRow, advBtn\]/.test(html)
  && /if \(libTestBtn\)  libTestBtn\.style\.display   = 'inline-block';/.test(html) && /if \(libTestBtn\)  libTestBtn\.style\.display   = 'none';/.test(html)
  && !/testBtn\.textContent = 'Test';/.test(html));
check('a blade\'s right-click', /const testItem = _testStyleMenuItem\(\(\) => _getFullSlotTextFromEditor\(slot\), _hidePresetContextMenu\);/.test(html));

console.log('2c. arithmetic the editor cannot read');
{
  const fold = new Function(`${fn('_foldConstArgs')}\nreturn _foldConstArgs;`)();
  check('a helper\'s constant expression is worked out the C++ way',
    fold('Percentage<Subtract<TimeSinceEffect<EFFECT_BOOT>,Int<2000>>,(32768 * 100) / 10000>') === 'Percentage<Subtract<TimeSinceEffect<EFFECT_BOOT>,Int<2000>>,327>',
    fold('Percentage<Subtract<TimeSinceEffect<EFFECT_BOOT>,Int<2000>>,(32768 * 100) / 10000>'));
  check('division truncates toward zero, as C++ does', fold('Int<-7 / 2>') === 'Int<-3>' && fold('Int<7/2>') === 'Int<3>', fold('Int<-7 / 2>'));
  check('plain numbers and negatives are left alone', fold('Stripes<5000,-1500,Red>') === 'Stripes<5000,-1500,Red>' && fold('Int<-12000>') === 'Int<-12000>');
  check('a name or a comment in it: left alone', fold('Int<START_MS*2>') === 'Int<START_MS*2>' && fold('Mix<Int<3>,/* 2 */ 5>') === 'Mix<Int<3>,/* 2 */ 5>');
  check('Test Style sends the worked-out form, comments out first',
    html.includes("const forEditor = _foldConstArgs(_applyStyleArgs(r.expr, r.args).replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ')")
    && /encodeURIComponent\(forEditor\)/.test(html));
}

console.log("2d. the preset's colours, written in");
{
  const sandbox = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effect-args.js'), 'utf8'))(sandbox);
  const apply = new Function('window', `${fn('_applyStyleArgs')}\nreturn _applyStyleArgs;`)(sandbox);
  const s = 'Layers<RgbArg<BASE_COLOR_ARG,DeepSkyBlue>,Mix<Int<1285>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,135,255>>>,RgbArg<CLASH_COLOR_ARG,White>>';
  check('the bare r,g,b string sets the base colour everywhere it is used, others keep their default',
    apply(s, '"65535,0,0"') === 'Layers<Rgb<255,0,0>,Mix<Int<1285>,Black,Rgb<255,0,0>>,RgbArg<CLASH_COLOR_ARG,White>>', apply(s, '"65535,0,0"'));
  check('the slot format: base and clash, a colour off the 257 grid as Rgb16',
    apply(s, '"0,0,65535 ~ ~ ~ ~ ~ ~ ~ ~ 1000,2000,3000"') === 'Layers<Rgb<0,0,255>,Mix<Int<1285>,Black,Rgb<0,0,255>>,Rgb16<1000,2000,3000>>',
    apply(s, '"0,0,65535 ~ ~ ~ ~ ~ ~ ~ ~ 1000,2000,3000"'));
  check('an int argument', apply('Mix<IntArg<STYLE_OPTION_ARG,0>,Red,Blue>', '"~ ~ 2"') === 'Mix<Int<2>,Red,Blue>', apply('Mix<IntArg<STYLE_OPTION_ARG,0>,Red,Blue>', '"~ ~ 2"'));
  check('no arguments: unchanged', apply(s, '') === s);
  check('Test Style writes them in before the link', /_foldConstArgs\(_applyStyleArgs\(r\.expr, r\.args\)\.replace\(/.test(html));
}

console.log('3. the URL, and refusals');
(async () => {
  await env.test('StylePtr<Layers<Glow,Red>>()');
  check("the editor's ?S= format, encoded", out.opened === 'https://fredrik.hubbe.net/lightsaber/style_editor_beta.html?S=' + encodeURIComponent('Layers<AudioFlicker<Blue,Cyan>,Red>'), out.opened);
  out.opened = null;
  const ok = await env.test('NeedsSpeed');
  check('a value with no default is refused and named, nothing opened', ok === false && out.opened === null && /NeedsSpeed's SPEED/.test(out.errors[0] || ''), JSON.stringify(out));
  out.errors = [];
  check('nothing to test says so', (await env.test('   ')) === false && /no style code/.test(out.errors[0] || ''));
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
