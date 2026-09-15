/**
 * A leading header comment used to turn the bracket check off  [B-378]
 *
 * `_findBracketError` opened with
 *
 *     const m = usingCode.match(/^using\s+\w+\s*=\s*([\s\S]+?)\s*;?\s*$/);
 *     if (!m) return null;
 *
 * `^` with no `m` flag, so the `using` had to be the very first thing in the string.
 * Any comment above it — `/ * My style * /`, a credit line, a date — and the match
 * failed, the function returned null, and NULL MEANS "no bracket error". A style that
 * could not be read reported as clean.
 *
 * ⭐ THE USER IT HURT IS THE CAREFUL ONE: the person who comments their styles got no
 * bracket checking at all, and nothing said so. Every caller goes through this one
 * function (six call sites), so all of them were blind together.
 *
 * Found during the 2026-09-12 reflection, while sweeping a followup logged 07-13. Half
 * of that followup — a second, non-comment-stripping checker on the Add Style paste
 * path — had genuinely been fixed by unifying the call sites. Only the anchor survived,
 * and nobody had noticed because the failure is silence.
 *
 * Run: node test/bracket-check-header-comment.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Lift the two functions out of the page and run them for real, rather than asserting
// on their source. The bug was arithmetic, so the arithmetic is what to test.
const lift = (name) => {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  // Walk braces from the first { so the whole body comes with it.
  let i = html.indexOf('{', start), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return html.slice(start, end);
};

let _findBracketError;
{
  const src = `${lift('_splitTemplatePrefix')}\n${lift('_findBracketError')}\nreturn _findBracketError;`;
  _findBracketError = new Function(src)();
  ok('both functions lifted and compiled', typeof _findBracketError === 'function');
}

const GOOD   = 'using L = Layers<Black,Red>;';
const BROKEN = 'using L = Layers<Black,Red;';

// ── the bug ────────────────────────────────────────────────────────────────
{
  ok('a broken style with NO header is caught', !!_findBracketError(BROKEN));

  // ⭐⭐ THE REGRESSION THAT MATTERS.
  ok('a broken style WITH a block header is caught',
     !!_findBracketError(`/* My style */\n${BROKEN}`),
     'this returned null before the fix, which reads as "no bracket error"');
  ok('a broken style with a // credit line is caught',
     !!_findBracketError(`// credit: someone\n${BROKEN}`));
  ok('two stacked comments do not hide it',
     !!_findBracketError(`/* a */\n// b\n${BROKEN}`));
  ok('a multi-line block header does not hide it',
     !!_findBracketError(`/*\n * Fett263\n * 2026\n */\n${BROKEN}`));
  ok('leading blank lines do not hide it', !!_findBracketError(`\n\n${BROKEN}`));
}

// ── the silences stay silent ───────────────────────────────────────────────
{
  ok('a good style is silent', _findBracketError(GOOD) === null);
  ok('a good style with a header is silent', _findBracketError(`/* My style */\n${GOOD}`) === null);
  ok('a templated style still works',
     _findBracketError('template<int d = 0>\nusing L = Layers<Black,Int<d>>;') === null);
  ok('and a broken templated style is still caught',
     !!_findBracketError('template<int d = 0>\nusing L = Layers<Black,Int<d>;'));

  // ⭐⭐⭐ A HEADER **ABOVE A TEMPLATE PREFIX**, WHICH IS THE CASE THIS FILE MISSED.
  // Comments were covered. Templates were covered. The COMBINATION never was, and
  // that is precisely the shape a wrapper entry takes: a `/*---*/` header from the
  // source library, then `template<...>`, then `using`. His own BootAccelSpin.
  //
  // The first fix ran _splitTemplatePrefix BEFORE skipping comments, and that
  // function anchors on `^template` — so with a comment in front it matched nothing,
  // returned the text unchanged, and the `^using` test then failed on the template
  // line and returned null. Silently, which is the fault this entry is named for.
  // Found by dev test 2026-09-14, after this suite was green.
  //
  // ⚠️ Two features each tested alone and never together is how a gap like this
  // survives a passing suite. When two independent prefixes can both appear, the
  // case that matters is BOTH.
  const TMPL = 'template< int START_MS, int W = 8000 >';
  ok('⭐ a comment above a TEMPLATE prefix does not hide a fault',
     !!_findBracketError(`/*TEST*/\n${TMPL}\nusing L = Layers<Black,Int<START_MS>;`),
     'comment + template + using — the shape a library wrapper actually has');
  ok('a // line above a template prefix does not hide it either',
     !!_findBracketError(`// note\n${TMPL}\nusing L = Layers<Black,Int<START_MS>;`));
  ok('and that combination stays silent when the style is GOOD',
     _findBracketError(`/*TEST*/\n${TMPL}\nusing L = Layers<Black,Int<START_MS>>;`) === null);
  // The offset is what puts the squiggle on the right character: both skips are
  // counted, never deleted, so it must still index into the ORIGINAL string.
  {
    const src = `/*TEST*/\n${TMPL}\nusing L = Layers<Black,Int<START_MS>;`;
    const e = _findBracketError(src);
    ok('the offset still points at the real "<" past both prefixes',
       !!e && src[e.offsetInCode] === '<',
       e ? `offset ${e.offsetInCode} -> ${JSON.stringify(src.slice(e.offsetInCode, e.offsetInCode + 12))}` : 'no error');
  }
  // ⚠️ Angle brackets inside the expression's own comments must not count — that was
  // the 2026-07-13 false positive (`/* >>> INNER-START >>> */` underflowing the stack).
  ok('brackets inside an inline comment do not count',
     _findBracketError('using L = Layers<Black,/* <<< x >>> */Red>;') === null);
}

// ── the marker still lands on the right character ──────────────────────────
//
// Skipping comments rather than stripping them is what makes this true: every offset
// still refers to the ORIGINAL text, so Monaco underlines the real bracket.
{
  const src = `/* My style */\n${BROKEN}`;
  const err = _findBracketError(src);
  ok('the offset points at the actual "<"', err && src[err.offsetInCode] === '<',
     err ? `char ${err.offsetInCode} = ${JSON.stringify(src[err.offsetInCode])}` : 'no error returned');

  const surplus = '/* hdr */\nusing L = Layers<Black,Red>>;';
  const e2 = _findBracketError(surplus);
  ok('a surplus ">" is reported as such', e2 && e2.message === 'Unmatched >', e2 && e2.message);
  ok('and its offset points at the ">"', e2 && surplus[e2.offsetInCode] === '>');
}

// ── one checker, all callers ───────────────────────────────────────────────
{
  const calls = (html.match(/_findBracketError\(/g) || []).length;
  ok('every caller still routes through the one checker', calls >= 6, `${calls} references`);
  // ⚠️ THIS USED TO PIN AN EXACT LINE (`const body = usingCode.slice(skip);`) and
  // failed the moment the function was restructured to fix a real bug — a test that
  // asserts a spelling rather than a property. Asserting the ORDER instead, which is
  // what actually broke: comments must be skipped BEFORE the template prefix is split.
  const fn = html.slice(html.indexOf('function _findBracketError('),
                        html.indexOf('function _findBracketError(') + 1400);
  const skipAt  = fn.indexOf('usingCode.slice(skip)');
  const splitAt = fn.indexOf('_splitTemplatePrefix(');
  ok('the leading-comment skip runs on the raw input', skipAt > 0, fn.slice(0, 160));
  ok('⭐ and it runs BEFORE the template prefix is split',
     skipAt > 0 && splitAt > skipAt,
     '_splitTemplatePrefix anchors on ^template, so a comment in front of it defeats '
     + 'the split and the ^using match then fails on the template line');
  ok('the template split is handed the comment-skipped text, never the raw string',
     /_splitTemplatePrefix\(afterComments\)/.test(fn),
     'passing the raw string is the 2026-09-14 bug');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall bracket header-comment tests passed');
process.exit(failures ? 1 : 0);
