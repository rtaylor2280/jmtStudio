// [B-229] The style file that goes on an SD card is a NEW file holding only the styles the
// config uses — settled 2026-09-30: "not the entire thing, just the ones that were used in the
// config, so we're creating a new one."
//
// THE FAILURE THIS FILE EXISTS FOR IS SILENT AND IT LANDS ON A STRANGER'S CARD. Take only
// the styles named in the config and you drop the HELPERS — entries no config ever mentions,
// referenced only from inside other styles. The card then carries a my_styles.h that looks
// complete, reads fine, and does not compile. Nobody finds out until the recipient tries to
// rebuild, which may be months later and is exactly the situation this whole feature exists to
// prevent. So the subset is a transitive closure, and this file proves the closure closes.
//
// The builder lives in the renderer's inline script and depends on `_parseStyleEntries` and
// `_classifyStyleEntries`, which live there too. Rather than reimplement any of the three — a
// copy that drifts is a test that passes while the app is broken — all three are lifted out of
// index.html by name and evaluated together.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
}

// Pull a top-level `function NAME(...) { ... }` out of the inline script by brace matching.
// Brace COUNTING, not a regex to the next `\n}` — style code is full of nested braces and a
// naive match would truncate the function and then fail for a reason that has nothing to do
// with what is being tested.
function lift(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0, i = html.indexOf('{', start);
  const from = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  return null;
}

const NEEDED = ['_parseStyleEntries', '_classifyStyleEntries', '_sfBuildUsedStylesFile',
                '_findUsingExprEnd', '_parseStyleMeta'];
const sources = {};
for (const n of NEEDED) {
  sources[n] = lift(n);
  ok(`lifted ${n} from index.html`, !!sources[n]);
}
if (failures) { console.log('\ncannot continue without the real implementations'); process.exit(1); }

// The classifier reads two module-level regexes, which are themselves built from two symbol
// LISTS. Lifting only the regexes throws at eval — so lift the lists too, in declaration order.
// These two constants have nothing to do with the subset; they are dependencies of
// `_classifyStyleEntries`, which is lifted whole rather than reimplemented so that a change to
// how the app decides "this is a helper" cannot pass here while breaking the card.
const symRe = /const (_SL_JMT_DEPENDENT_SYMBOLS|_SL_PIXEL_RELAY_SYMBOLS|_SL_CHARGING_SYMBOL_RE|_SL_PIXEL_RELAY_SYMBOL_RE)\s*=\s*([\s\S]*?);\n/g;
const found = new Set();
let syms = '', m;
while ((m = symRe.exec(html))) { if (found.has(m[1])) continue; found.add(m[1]); syms += `const ${m[1]} = ${m[2]};\n`; }
ok('lifted the classifier symbols and regexes',
   found.has('_SL_CHARGING_SYMBOL_RE') && found.has('_SL_PIXEL_RELAY_SYMBOL_RE'),
   `found: ${[...found].join(', ')}`);

const build = new Function(`
  ${syms}
  ${NEEDED.map(n => sources[n]).join('\n')}
  return _sfBuildUsedStylesFile;
`)();

// ── A library shaped like a real one ─────────────────────────────────────────
// `Glow` is a helper: no config names it, and it is referenced only from inside `BlueBlade`.
// `Deep` is a helper OF A HELPER, which is the case a single-pass filter gets wrong.
const LIB = `// JMT Studio Style Library
#include "my_styles.h"

/*--- Deep helper ---*/
using Deep = Rgb<0,0,40>;

/*--- Glow helper ---*/
using Glow = Mix<Int<8000>, Deep, Rgb<0,0,255>>;

/*--- Blue Blade
Source: JMT
---*/
using BlueBlade = StylePtr<Layers<Glow, InOutTrL<>>>;

/*--- Red Blade
Source: JMT
---*/
using RedBlade = StylePtr<Layers<Rgb<255,0,0>, InOutTrL<>>>;

/*--- Unused Blade ---*/
using GreenBlade = StylePtr<Layers<Rgb<0,255,0>, InOutTrL<>>>;
`;

const CONFIG = `Preset presets[] = {
  { "font1;common", "tracks/a.wav", BlueBlade, "blue" },
  { "font2;common", "tracks/b.wav", RedBlade,  "red"  },
};`;

const out = build(LIB, CONFIG);
ok('a subset was produced', !!out && typeof out.text === 'string');

const used = new Set((out && out.used) || []);
ok('the styles the config names are kept', used.has('BlueBlade') && used.has('RedBlade'),
   `used: ${[...used].join(', ')}`);
ok('a helper reached only through a used style is pulled in', used.has('Glow'),
   'Glow is named by no config — only by BlueBlade. Dropping it ships a file that will not build.');
ok('a helper of a helper is pulled in too', used.has('Deep'),
   'Deep is reached only through Glow. One pass finds Glow and stops; the closure must not.');
ok('a style the config never mentions is left out', !used.has('GreenBlade'),
   'the whole point is that a maker\'s library does not ride along with one saber');
ok('the count reflects the whole library', out.total === 5, `total: ${out && out.total}`);

// ── The emitted file ─────────────────────────────────────────────────────────
ok('the preamble travels with the subset', /JMT Studio Style Library/.test(out.text));
ok('the include line is kept', /#include "my_styles\.h"/.test(out.text));
ok('header comments survive byte-for-byte', /\/\*--- Blue Blade\s*\n\s*Source: JMT\s*\n---\*\//.test(out.text),
   'blocks are sliced from the original text; re-serialising would lose attribution');
ok('the excluded style appears nowhere', !/GreenBlade/.test(out.text));
ok('kept entries are in original file order',
   out.text.indexOf('using Deep') < out.text.indexOf('using Glow')
   && out.text.indexOf('using Glow') < out.text.indexOf('using BlueBlade'),
   'a library is read top to bottom by a person; discovery order is not reading order');
ok('the file ends with a newline', out.text.endsWith('\n'));

// ── Material the parser does not see as an entry ─────────────────────────────
//
// THIS IS THE CASE THAT BROKE THE FIRST IMPLEMENTATION, and it broke it invisibly.
// `_parseStyleEntries` only recognises `using NAME =` at the start of a line. A library can
// hold things that are NOT entries and that entries depend on — an alias template, a #define,
// a mid-file include. The first cut built the output by collecting the kept blocks, so every
// one of those was dropped... except when it happened to sit before the first entry, where it
// fell into the preamble and survived by position alone. That is why the original fixture
// passed: move the same helper three lines down and the exported file references a symbol it
// does not contain, and nobody learns that until someone tries to build it.
//
// The subset is now built by CUTTING the unused entries out of the original text. Both
// positions are asserted, because position is exactly what the old bug was sensitive to.
const TEMPLATE_LIB_HEAD = `// JMT Studio Style Library
#define GLOW_N 8000
template<int N> using Fade = Mix<Int<N>, Black, Rgb<0,0,255>>;

/*--- Red ---*/
using RedBlade = StylePtr<Rgb<255,0,0>>;

/*--- Glow helper ---*/
using Glow = Fade<GLOW_N>;

/*--- Blue ---*/
using BlueBlade = StylePtr<Layers<Glow, InOutTrL<>>>;
`;
// Identical, except the define and the alias template sit AFTER the first style.
const TEMPLATE_LIB_MID = `// JMT Studio Style Library

/*--- Red ---*/
using RedBlade = StylePtr<Rgb<255,0,0>>;

#define GLOW_N 8000
template<int N> using Fade = Mix<Int<N>, Black, Rgb<0,0,255>>;

/*--- Glow helper ---*/
using Glow = Fade<GLOW_N>;

/*--- Blue ---*/
using BlueBlade = StylePtr<Layers<Glow, InOutTrL<>>>;
`;
const ONLY_BLUE = `{ "f;common", "t.wav", BlueBlade, "b" },`;

for (const [where, lib] of [['above the first style', TEMPLATE_LIB_HEAD],
                            ['below the first style', TEMPLATE_LIB_MID]]) {
  const r = build(lib, ONLY_BLUE);
  ok(`alias template ${where} survives`, !!r && /template<int N> using Fade/.test(r.text),
     'Glow references Fade; without it the card carries a file that will not compile');
  ok(`#define ${where} survives`, !!r && /#define GLOW_N/.test(r.text));
  ok(`the unused style is still removed (${where})`, !!r && !/RedBlade/.test(r.text),
     'cutting must not degrade into shipping the whole library');
}

// CONTROL: the collect-the-kept-blocks construction — the one that shipped first — really does
// lose the mid-file helper. Without this, the two assertions above could pass for the wrong
// reason and nobody would know the fixture had stopped exercising the bug.
{
  const entries = new Function(`${syms}\n${sources._parseStyleEntries}\n${sources._findUsingExprEnd}\n${sources._parseStyleMeta}\nreturn _parseStyleEntries;`)()(TEMPLATE_LIB_MID);
  const first = entries.reduce((a, e) => Math.min(a, e.blockStart), TEMPLATE_LIB_MID.length);
  const collected = TEMPLATE_LIB_MID.slice(0, first)
    + entries.filter(e => e.name !== 'RedBlade').map(e => TEMPLATE_LIB_MID.slice(e.blockStart, e.blockEnd)).join('\n\n');
  ok('CONTROL the old collect-the-blocks construction drops the mid-file helper',
     !/using Fade/.test(collected) && !/#define GLOW_N/.test(collected),
     'if this ever passes, the fixture no longer reproduces the defect it was written for');
}

// ── Edge cases that must not produce a half-file ─────────────────────────────
ok('a config using none of the library yields nothing at all',
   build(LIB, 'Preset presets[] = { { "f", "t", StylePtr<Black>(), "x" } };') === null,
   'writing a file with only a preamble would claim styles that are not there');
ok('an empty library yields nothing', build('', CONFIG) === null);
ok('an empty config yields nothing', build(LIB, '') === null);

// ── controls ─────────────────────────────────────────────────────────────────
// The closure assertions are the ones that matter, so prove they can fail. A single-pass
// filter — the obvious implementation, and the wrong one — must not satisfy them.
{
  const entries = new Function(`${syms}\n${sources._parseStyleEntries}\n${sources._findUsingExprEnd}\n${sources._parseStyleMeta}\nreturn _parseStyleEntries;`)()(LIB);
  const namedInConfig = entries.filter(e => new RegExp(`\\b${e.name}\\b`).test(CONFIG)).map(e => e.name);
  ok('CONTROL a config-names-only filter really does drop the helpers',
     !namedInConfig.includes('Glow') && !namedInConfig.includes('Deep'),
     `naive result: ${namedInConfig.join(', ')} — if this ever includes them the fixture stopped `
     + 'testing the closure and needs a real helper again');

  // And one pass over the seed finds Glow but never Deep.
  const onePass = new Set(namedInConfig);
  for (const e of entries) {
    if (!onePass.has(e.name)) continue;
    for (const o of entries) if (new RegExp(`\\b${o.name}\\b`).test(e.usingCode)) onePass.add(o.name);
  }
  ok('CONTROL a single expansion pass still misses the helper-of-a-helper',
     onePass.has('Glow') && !onePass.has('Deep'),
     'this is what makes the transitive loop necessary rather than decorative');
}

// ── the card file's own header ───────────────────────────────────────────────
// The library's header names the library and carries its dates; the card's file is new on each
// export, so it gets a header of its own.
{
  const reSrc = (html.match(/const _SL_JMT_HEADER_RE\s*=\s*(\/[^\n]*\/m);/) || [])[1];
  const fnSrc = lift('_sfCardStylesFile');
  ok('lifted _sfCardStylesFile and the library header regex', !!reSrc && !!fnSrc);
  if (reSrc && fnSrc) {
    const card = new Function(`const _SL_JMT_HEADER_RE = ${reSrc};\n${fnSrc}\nreturn _sfCardStylesFile;`)();
    // The library header from the app's own writer, so a change to its shape shows up here.
    const libHeader = new Function(`const _jmtLocalDateString = () => '2026-10-24';\n`
      + `${lift('_buildStyleLibraryJmtHeader')}\nreturn _buildStyleLibraryJmtHeader;`)();
    const LIB_HEADER = libHeader('2026-10-23') + '\n\n';
    const body = 'using BlueBlade = StylePtr<Blue>();\n';
    const CFG = '// Configuration edited with JMT Studio (jmtfoundry.com)\r\n'
      + '// @jmt:description AZ Sabers Duum w/ Crystal Chamnber + Board Accent\r\n'
      + '// @jmt:board       Proffieboard V3\r\n';
    const out = card(LIB_HEADER + body, 'az_duum_test2.h', '2026-10-25', CFG);
    ok('CONTROL the fixture carries the library header', LIB_HEADER.includes('// @jmt:updated'));
    ok('names the config as the readme does',
       out.includes('// Styles used by my_config.h (az_duum_test2.h)  ·  JMT Studio'), out.split('\n')[1]);
    ok("carries the config's description, without the CR",
       out.includes('// @jmt:description AZ Sabers Duum w/ Crystal Chamnber + Board Accent\n'));
    ok('created is the export date', out.includes('// @jmt:created     2026-10-25'));
    const plain = card(body, 'my_config.h', '2026-10-25', '');
    ok('no description line when the config has none', !plain.includes('@jmt:description'));
    ok('no brackets when the source is already my_config.h',
       plain.includes('// Styles used by my_config.h  ·  JMT Studio'));
    ok("the library's header and dates are gone",
       !out.includes('Style Library  ·') && !out.includes('2026-10-23') && !out.includes('@jmt:updated'));
    ok('the styles follow, after one blank line', out.endsWith('=====\n\n' + body), JSON.stringify(out.slice(-80)));
    const crlf = card(LIB_HEADER.replace(/\n/g, '\r\n') + body, 'x.h', '2026-10-25');
    ok('a CRLF library header is replaced too', !crlf.includes('Style Library  ·') && crlf.includes('2026-10-25'));
    const bare = card(body, 'x.h', '2026-10-25');
    ok('with no library header, the new one is added', bare.startsWith('// =====') && bare.endsWith(body));
  }
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
