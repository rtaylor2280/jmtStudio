// A font's own style file goes into the Style Library, filled in from the font. [B-569]
//
// Runs the real code out of renderer/index.html on the three shapes creators ship:
//   · BVM Sabers: a Fett263 library export, header above StylePtr<...>();
//   · Greyscale: font name and prose, then StylePtr with // commented-out layers;
//   · JayDaloRian: a banner and a dashed rule, the style, then a copyright footer.
// 1. finding the styles (one, several, none); 2. the form; 3. the library match; 4. wiring.
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
const names = ['_parseClipboardStyle', '_styleCodeStart', '_findUsingExprEnd', '_lineCommentsToBlock', '_extractStylePtrInner',
  '_styleNameFromDisplay', '_findFileStyles', '_fileCopyrightLines', '_fontStyleForm', '_styleCodeKey', '_libraryStyleWithCode',
  '_parseStyleEntries', '_parseStyleMeta'];
const missing = names.filter((n) => !fn(n));
check('located', !missing.length, missing.join(', '));
const env = new Function('LIB', `let _stylesEditorInstance = { getValue: () => LIB }; let _silentStylesText = null;
  ${names.map(fn).join('\n')}
  ${(html.match(/^const _flattenExpr = .*$/m) || [''])[0]}
  return { find: _findFileStyles, copyright: _fileCopyrightLines, form: _fontStyleForm, have: _libraryStyleWithCode };`);

const BVM = `/* copyright Fett263 LavaLamp (Primary Blade) OS7 Style
https://fett263library.com/early-access/#LavaLamp
OS7.14 v3.01p
--Effects Included--
Ignition Effect: Standard Ignition
*/
StylePtr<Layers<Mix<SmoothStep<Int<16384>,Int<-8000>>,Rgb<255,40,0>,Rgb<255,120,0>>,InOutTrL<TrWipe<300>,TrWipeIn<500>>>>()`;
const GREY = `Skotos
This is our style for the Skotos font. Tips: keep your board updated.
StylePtr<Layers<
  Black,
  //AlphaL<Red, Int<0>>,
  InOutTrL<TrWipe<300>,TrWipeIn<500>>
>>(),`;
const JAY = `ProffieBoard os 5.0 or later
------------------------------------------
StylePtr<Layers<Blue,InOutTrL<TrWipe<300>,TrWipeIn<500>>>>()
------------------------------------------
Support: jaydalorian.com
Copyright: Jerome Tremblay (JayDaloRian)
ProffieOS Copyright (c) 2016-2019 Fredrik Hubinette`;
const TWO = `/* first */ StylePtr<Layers<Red,InOutTrL<TrWipe<300>,TrWipeIn<500>>>>(),
/* second */ StylePtr<Layers<Green,InOutTrL<TrWipe<300>,TrWipeIn<500>>>>(),`;

const lib = `/*------ Mine ------*/
using Mine = Layers<Blue,InOutTrL<TrWipe<300>,TrWipeIn<500>>>;
`;
const e = env(lib);

console.log('1. finding the styles');
const b = e.find(BVM), g = e.find(GREY), j = e.find(JAY), two = e.find(TWO);
check('one style in each vendor shape', b.length === 1 && g.length === 1 && j.length === 1, [b.length, g.length, j.length].join());
check('two styles in one file are two', two.length === 2 && /Red/.test(two[0].parsed.expr) && /Green/.test(two[1].parsed.expr), JSON.stringify(two.map((t) => t.parsed.expr)));
check('a commented-out layer does not end the style', /InOutTrL/.test(g[0].parsed.expr) && g[0].code.endsWith('>>()'), g[0].code);
check('Copy style copies the style as written', b[0].code.startsWith('StylePtr<Layers<Mix<') && b[0].code.endsWith('>>>>()'), b[0].code);
check('a readme with no style code finds none', e.find('Thanks for buying!\nInstall to the SD card root.').length === 0);
check('a bare using statement is one style', e.find('using Foo = Layers<Red,InOutTrL<TrWipe<300>,TrWipeIn<500>>>;').length === 1);

console.log('2. the form');
const font = (fontName, creator, fileName, extra = {}) => ({ fontName, creator, fileName, website: 'https://bvmsabers.com', tags: ['free', 'Sith'],
  fileLabel: `the ${fontName} font's ${fileName}`, ...extra });
const fb = e.form(b[0].parsed, font('Astral-Projection', 'BVM Sabers', 'bladestyle.txt'));
check('name is the font alone', fb.name === 'AstralProjection', fb.name);
check('Creator is the font\'s creator, Source the Fett263 line', fb.creator === 'BVM Sabers' && fb.source === 'Fett263 LavaLamp (Primary Blade) OS7 Style', JSON.stringify(fb));
check('the link is the creator\'s site, and the Fett263 page moves to the notes',
  fb.url === 'https://bvmsabers.com' && fb.notes.split('\n')[0] === 'https://fett263library.com/early-access/#LavaLamp', JSON.stringify(fb));
check('the font\'s tags come in, with the OS version', fb.tags.join(',') === 'free,Sith,OS7.14 v3.01p', fb.tags.join(','));
check('notes end with where it came from', /From the Astral-Projection font's bladestyle\.txt$/.test(fb.notes), fb.notes);
const fg = e.form(g[0].parsed, font('Skotos', 'Greyscale Fonts', 'proffie_blade_style.txt', { website: '' }));
check('no Fett263 header: Source is the creator', fg.source === 'Greyscale Fonts' && fg.name === 'Skotos', JSON.stringify(fg));
const jc = e.copyright(JAY);
check('copyright lines are kept, the ProffieOS licence is not', jc.length === 1 && jc[0] === 'Copyright: Jerome Tremblay (JayDaloRian)', JSON.stringify(jc));
const fj = e.form(j[0].parsed, font('Energy', 'JayDalorian', 'Energy style-2.txt', { copyright: jc }));
check('a variant in the file name joins the name', fj.name === 'Energy2', fj.name);
check("a readme's name is not a variant", e.form(b[0].parsed, font('OldGlory', 'X', 'README.txt')).name === 'OldGlory');
check('a dash before Copyright is dropped', e.copyright('-Copyright: Someone')[0] === 'Copyright: Someone', JSON.stringify(e.copyright('-Copyright: Someone')));
check('the copyright line reaches the notes', /Copyright: Jerome Tremblay/.test(fj.notes), fj.notes);
const f2 = e.form(two[1].parsed, font('Razor', 'BVM Sabers', 'bladestyle.txt'), 1, 2);
const f1 = e.form(two[0].parsed, font('Razor', 'BVM Sabers', 'bladestyle.txt'), 0, 2);
check('the second style of a file is numbered, the first is not', f1.name === 'Razor' && f2.name === 'Razor2', [f1.name, f2.name].join());
const fbc = e.form(b[0].parsed, font('Astral-Projection', 'BVM Sabers', 'bladestyle.txt', { copyright: e.copyright(BVM) }));
check('the Fett263 copyright already credited as Source is not repeated in notes', !/copyright Fett263/i.test(fbc.notes), fbc.notes);

console.log('3. already in the library');
check('the same code, laid out differently, matches by name', e.have('Layers<Blue, InOutTrL<TrWipe<300>, TrWipeIn<500> > >') === 'Mine');
check('different code does not', e.have('Layers<Red,InOutTrL<TrWipe<300>,TrWipeIn<500>>>') === '');

console.log('4. wiring');
check('both doors tell the viewer where the file came from',
  /\(kind === 'entry' \|\| kind === 'source'\) \? \{ origin: \{ kind, id, path: subPath \} \} : \{\}/.test(html)
  && /\{ origin: \{ kind: scope === 'entry' \? 'entry' : 'source', id: key, path: fileName \} \}/.test(html));
check('a text file is checked for style code', /_sfRenderDocStyleActions\(kind === 'text' \? content : '', fileName\);/.test(html));
check('Add needs a Style Library, a font, and no copy already there',
  /const ctx = \(_stylesFileImported && _sfDocStyleContext\(\)\) \|\| null;/.test(html) && /btn\.style\.display = ctx \? '' : 'none';\s*btn\.disabled = !!have;/.test(html));
check('adding offers the Last used style', /_openAddFontStyle\(form, \(name\) => \{ _sfOfferPairFonts\(ctx\.fonts, name\); \}\);/.test(html)
  && /updates: \{ linkedStyleLibraryEntry: styleName \}/.test(html) && /_sfDetailEdit\.lastUsedStyleName = styleName;/.test(html));
check('the choice is in Settings with the other remembered choices',
  /\['setting-font-style-use', 'fontStyleAlwaysUse', 'ask'\],/.test(html) && /id="setting-font-style-use"/.test(html));
check('already in the library: Add greyed with the reason on hover, and Use as Last used style only while a font lacks it',
  /`Already in your Style Library as \$\{have\}\.`/.test(html) && !/sf-doc-viewer-style-status/.test(html) && /use\.style\.display = have && unpaired\.length \? '' : 'none';/.test(html)
  && /if \(_libraryStyleWithCode\(s\.parsed\.expr\)\) \{ _sfSyncDocAddLabel\(\); return; \}/.test(html)
  && /await _sfPairFontsWithStyle\(todo, have\);\s*_sfSyncDocAddLabel\(\);/.test(html)
  && !/Click to make it the Last used style/.test(html));
check('the font windows come back however Add Style closes', /new MutationObserver\(\(\) => \{\s*if \(addModal\.classList\.contains\('active'\)\) return;/.test(html));
check('the form is filled with the creator', /document\.getElementById\('add-style-creator'\)\.value = form\.creator \|\| '';/.test(html));

console.log('5. the question after Add');
(async () => {
  const at = html.indexOf('const _sfOfferPairFonts = async (fontNames, styleName) => {');
  const end = html.indexOf('\n      };', at);
  const src = at > -1 && end > at ? html.slice(at, end + 9) : '';
  check('located', src.length > 500);
  const run = async (remembered, answer, linked = {}) => {
    const out = { asked: null, set: [], paired: null };
    const entries = Object.keys({ Skotos: 1, Null: 1, ...linked }).map((n) => ({ name: n, meta: { linkedStyleLibraryEntry: linked[n] || '' } }));
    const f = new Function('_sfAllEntries', '_jmtRememberedChoice', 'promptConfirm', 'window', '_sfEscape', '_sfPairFontsWithStyle',
      `${src}\nreturn _sfOfferPairFonts;`)(entries, async () => remembered, async (o) => { out.asked = o; return answer; },
      { electronAPI: { setSetting: async (k, v) => out.set.push(`${k}=${v}`) } }, (x) => x, async (n, s) => { out.paired = n.join(',') + '>' + s; });
    await f(['Skotos'], 'Skotos');
    return out;
  };
  let o = await run('ask', 'middle', { Skotos: 'GreyscaleFontsSkotos' });
  check('Ask: the four buttons and the X, naming what it replaces; Use pairs, saves nothing',
    o.asked && o.asked.leadText === 'Never use' && o.asked.cancelText === 'Skip' && o.asked.middleText === 'Use'
    && o.asked.confirmText === 'Always use' && o.asked.closeX === true && /replaces <strong>GreyscaleFontsSkotos/.test(o.asked.messageHtml)
    && o.paired === 'Skotos>Skotos' && !o.set.length, JSON.stringify(o));
  o = await run('ask', 'cancel');
  check('Skip: adds only', o.paired === null && !o.set.length, JSON.stringify(o));
  o = await run('ask', 'close');
  check('the X is Skip', o.paired === null && !o.set.length, JSON.stringify(o));
  o = await run('ask', 'lead');
  check('Never use: adds only, and remembers', o.paired === null && o.set.join() === 'fontStyleAlwaysUse=never', JSON.stringify(o));
  o = await run('ask', 'confirm');
  check('Always use: pairs, and remembers', o.paired === 'Skotos>Skotos' && o.set.join() === 'fontStyleAlwaysUse=always', JSON.stringify(o));
  o = await run('always', null);
  check('remembered Always: pairs without asking', o.asked === null && o.paired === 'Skotos>Skotos', JSON.stringify(o));
  o = await run('never', null);
  check('remembered Never: adds without asking', o.asked === null && o.paired === null, JSON.stringify(o));
  o = await run('ask', 'middle', { Skotos: 'Skotos' });
  check('already its Last used style: nothing to ask', o.asked === null, JSON.stringify(o));
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
