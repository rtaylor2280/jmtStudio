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
  ok('the anchor is no longer applied to the raw string',
     /const body = usingCode\.slice\(skip\);/.test(html),
     'the match must run on the text AFTER the leading comments');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall bracket header-comment tests passed');
process.exit(failures ? 1 : 0);
