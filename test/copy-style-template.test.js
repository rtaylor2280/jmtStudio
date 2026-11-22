// Copy Style EXPORTS A STYLE. It must be self-contained.
//
// The destination is a lightsaber style editor, not a preset slot, so the output
// is the style BODY wrapped in StylePtr<...>() — never a reference to the library
// entry, which would mean nothing outside my_styles.h. Copy Function is the
// button that hands over the `using` definition.
//
// 2026-08-16: Copy Style on HexSpiralStyle produced a body containing `Int<dir>`.
// `dir` is the entry's template parameter, declared on the line ABOVE the
// `using`, so it cannot travel with the body. Pasted into a preset slot and sent
// to Add to Library, that wrote an entry referencing an undeclared symbol into
// my_styles.h — ONE file included by every config, so every config on the
// machine broke, naming a style nobody had chosen.
//
// The fix resolves parameters INTO the body, and marks every substitution with
// matching comments so the export says what was filled in and where:
//
//   template<int dir = 0>  ->  Int</*dir DEFAULT*/0/*dir DEFAULT*/>
//   template<class INNER>  ->  /*INNER PLACEHOLDER*/InOutHelper<...>/*INNER PLACEHOLDER*/
//
// Three outcomes, and the split between the last two is deliberate: a TYPE
// parameter can take a stand-in style, because any visible blade demonstrates
// what a wrapper does. A VALUE parameter cannot — inventing a number would be
// arbitrary — so those are blocked and the button is disabled.
//
// Facts checked against arm-none-eabi-g++ 14.2 rather than assumed:
//   StylePtr<Foo>      -> error: expected a type, got 'Foo'   (alias template)
//   StylePtr<Foo<0> >  -> compiles
//   StylePtr<S<dir> >  -> error: 'dir' was not declared in this scope
// And verified in a real style editor 2026-08-16: comments inside a style body
// are accepted (LEDSwitch exports with 10 of them and pastes fine), which is
// what makes the marker scheme viable.
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

function extract(fnName) {
  const start = HTML.indexOf(`function ${fnName}(`);
  if (start < 0) throw new Error(`${fnName} not found in index.html`);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`unbalanced braces reading ${fnName}`);
  return HTML.slice(start, i + 1);
}

// Read the placeholder constant from source rather than restating it here, so
// the test cannot drift from the value the app actually emits.
const PLACEHOLDER = (() => {
  const m = /_COPY_STYLE_INNER_PLACEHOLDER\s*=\s*'([^']+)'/.exec(HTML);
  if (!m) throw new Error('_COPY_STYLE_INNER_PLACEHOLDER not found in index.html');
  return m[1];
})();

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`); }
}

const STYLES = [
  'using PlainStyle = Layers<AudioFlicker<Blue,White>,White>;',
  '',
  'template<int dir = 0>',
  'using HexSpiralStyle = Layers<IsGreaterThan<Int<dir>,Int<0>>,Black>;',
  '',
  'template<class INNER>',
  'using WrapperStyle = Layers<INNER,White>;',
  '',
  'template<int a = 1, int b = 2>',
  'using TwoArgStyle = Layers<Int<a>,Int<b>>;',
  '',
  'template<class INNER, int n = 3>',
  'using MixedStyle = Layers<INNER,Int<n>>;',
  '',
  'template<int START_MS, int DURATION_MS>',
  'using NoDefaults = Layers<Int<START_MS>,Int<DURATION_MS>>;',
  '',
  // `dir` is a prefix of `direction` — substitution must not touch it.
  'template<int dir = 7>',
  'using SubstringStyle = Layers<Int<dir>,Scale<direction,Int<1>,Int<2>>>;',
  '',
].join('\n');

const sandbox = { _stylesEditorInstance: { getValue: () => STYLES },
                  _silentStylesText: '', console };
vm.createContext(sandbox);
vm.runInContext(`const _COPY_STYLE_INNER_PLACEHOLDER = ${JSON.stringify(PLACEHOLDER)};`, sandbox);
vm.runInContext(extract('_getHelperTemplateParams') + '\n' + extract('_composeCopyStyleExpr'),
                sandbox);
const compose = (n, code) => sandbox._composeCopyStyleExpr(n, code);

console.log('non-templated entries are untouched:');
// The overwhelming majority of the library. This is the regression risk of the
// whole change, so it is asserted first.
check('body is exported verbatim',
  compose('PlainStyle', 'using PlainStyle = Layers<AudioFlicker<Blue,White>,White>;'),
  { expr: 'Layers<AudioFlicker<Blue,White>,White>' });
check('an entry absent from the file still exports its body',
  compose('GhostStyle', 'using GhostStyle = Layers<Black>;'),
  { expr: 'Layers<Black>' });

console.log('\ndefaulted parameters are substituted into the body:');
check('THE REGRESSION: dir is replaced by its default, marked',
  compose('HexSpiralStyle', 'using HexSpiralStyle = Layers<IsGreaterThan<Int<dir>,Int<0>>,Black>;'),
  { expr: 'Layers<IsGreaterThan<Int</*dir DEFAULT*/0/*dir DEFAULT*/>,Int<0>>,Black>' });

const spiral = compose('HexSpiralStyle',
  'using HexSpiralStyle = Layers<IsGreaterThan<Int<dir>,Int<0>>,Black>;');
check('no free parameter survives outside the markers',
  /\bdir\b/.test(spiral.expr.replace(/\/\*[^*]*\*\//g, '')), false);
check('the entry name is never emitted (that would be a reference, not an export)',
  spiral.expr.includes('HexSpiralStyle'), false);
check('no placeholders reported when every parameter had a default',
  'placeholders' in spiral, false);

check('every default substituted, each marked with its own name',
  compose('TwoArgStyle', 'using TwoArgStyle = Layers<Int<a>,Int<b>>;'),
  { expr: 'Layers<Int</*a DEFAULT*/1/*a DEFAULT*/>,Int</*b DEFAULT*/2/*b DEFAULT*/>>' });

// Word-boundary matching. `dir` must not corrupt `direction`.
check('a parameter name that is a prefix of another identifier is not clobbered',
  compose('SubstringStyle',
    'using SubstringStyle = Layers<Int<dir>,Scale<direction,Int<1>,Int<2>>>;'),
  { expr: 'Layers<Int</*dir DEFAULT*/7/*dir DEFAULT*/>,Scale<direction,Int<1>,Int<2>>>' });

console.log('\ntype parameters get a stand-in so wrappers stay previewable:');
check('INNER is filled with the placeholder style and reported',
  compose('WrapperStyle', 'using WrapperStyle = Layers<INNER,White>;'),
  { expr: `Layers</*INNER PLACEHOLDER*/${PLACEHOLDER}/*INNER PLACEHOLDER*/,White>`,
    placeholders: ['INNER'] });
check('a wrapper mixing a stand-in and a default resolves both',
  compose('MixedStyle', 'using MixedStyle = Layers<INNER,Int<n>>;'),
  { expr: `Layers</*INNER PLACEHOLDER*/${PLACEHOLDER}/*INNER PLACEHOLDER*/,`
        + `Int</*n DEFAULT*/3/*n DEFAULT*/>>`,
    placeholders: ['INNER'] });

console.log('\nundefaulted VALUE parameters are blocked, not guessed:');
check('both names reported so the disabled button can say why',
  compose('NoDefaults', 'using NoDefaults = Layers<Int<START_MS>,Int<DURATION_MS>>;'),
  { blocked: ['START_MS', 'DURATION_MS'] });
check('a blocked entry yields no expression at all',
  'expr' in compose('NoDefaults', 'using NoDefaults = Layers<Int<START_MS>,Int<DURATION_MS>>;'),
  false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
