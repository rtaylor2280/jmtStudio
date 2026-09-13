/**
 * Which colour is this slot's primary?  [B-060]
 *
 * THE FAULT: a style that defines no BASE_COLOR_ARG and paints its blade from a
 * hardcoded `Rgb<...>` literal — very common in Fett263 library entries, e.g.
 * GreyscaleFontsSkotos using
 *     AudioFlicker<RotateColorsX<Variation,Rgb<135,0,255>>, ...>
 * — fell through to the FIRST RgbArg's default. That is usually an EFFECT argument
 * (LOCKUP_COLOR_ARG → White, SWING_COLOR_ARG, …), which is not the blade colour anyone
 * sees. The inner detail view resolved it correctly from the helper body, so the card
 * and the detail disagreed about the same slot.
 *
 * ⭐ THE ORDER IS THE FIX. An explicit BASE beats everything; a colour written INTO the
 * style beats a DEFAULT for an argument nobody set; the first-RgbArg guess is a last
 * resort rather than a third preference.
 *
 *   1-3  BASE_COLOR_ARG   — slot parens, registry, inline
 *   4    hardcoded colour in the library definition (leaf-resolved)
 *   5    hardcoded colour in the slot expression
 *   6-8  first RgbArg of any name — parens, registry, inline
 *
 * ⚠️ ONE IMPLEMENTATION, TWO RENDER PATHS. The card and _resolveSlotColor each carried
 * their own copy of this ladder, which is how they came to disagree. Splitting each
 * "BASE or first" lookup into two rungs is only safe if both move together.
 *
 * Run: node test/slot-primary-colour.test.js
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

// Lift the real ladder and run it against stubs, so the ORDER is exercised rather than
// read off the source.
const lift = () => {
  const i = html.indexOf('function _pickSlotPrimary(slot) {');
  let j = html.indexOf('{', i), d = 0, end = -1;
  for (; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}') { d--; if (!d) { end = j + 1; break; } }
  }
  return html.slice(i, end);
};
const SRC = lift();
const R = (r, g, b) => `Rgb<${r},${g},${b}>`;
const colorOf = (t) => {
  const m = /Rgb<(\d+),(\d+),(\d+)>/.exec(t || '');
  return m ? { rgb16: [+m[1], +m[2], +m[3]], matchStr: m[0], matchIndex: m.index } : null;
};
const make = (o) => new Function(
  'styleArgResolver', '_getHelperRegistryArgs', '_resolveLeafStyleName',
  '_getHelperDefinitionText', '_earliestColorInText', 'window',
  SRC + '; return _pickSlotPrimary;')(
  { resolveStyleArgs: () => o.resolved || [], findArgs: () => o.inline || [] },
  () => o.registry || [],
  () => o.leaf || null,
  () => o.helperText || '',
  colorOf,
  { proffieArgs: { resolveColorDefault: (e) => (colorOf(e) || {}).rgb16 || null } });

ok('the ladder was lifted', SRC.length > 500);

// ── the reported case ──────────────────────────────────────────────────────
{
  const f = make({
    leaf: 'Skotos',
    helperText: `AudioFlicker<RotateColorsX<Variation,${R(135, 0, 255)}>,White>`,
    inline: [{ kind: 'RgbArg', name: 'LOCKUP_COLOR_ARG', defaultExpr: R(255, 255, 255) }],
  });
  const r = f({ expr: 'GreyscaleFontsSkotos<>' });
  ok('the hardcoded blade colour wins over an effect default',
     JSON.stringify(r.rgb16) === '[135,0,255]', JSON.stringify(r));
  ok('and the rung is named', r.source === 'helper-hardcoded', r.source);
}

// ── BASE always wins ───────────────────────────────────────────────────────
{
  const base = { kind: 'RgbArg', name: 'BASE_COLOR_ARG', defaultExpr: R(9, 9, 9) };
  ok('BASE from the slot parens wins',
     JSON.stringify(make({ resolved: [{ kind: 'RgbArg', name: 'BASE_COLOR_ARG', values: [1, 1, 1] }],
                           leaf: 'X', helperText: R(5, 5, 5) })({ expr: 'S<>', colorArg: 'x' }).rgb16)
     === '[1,1,1]');
  ok('BASE from the registry beats a hardcoded helper body',
     make({ registry: [base], leaf: 'X', helperText: R(5, 5, 5) })({ expr: 'S<>' }).source === 'base-registry');
  ok('BASE inline beats a hardcoded helper body',
     make({ inline: [base], leaf: 'X', helperText: R(5, 5, 5) })({ expr: 'S<>' }).source === 'base-inline');
}

// ── the fallback is genuinely last ─────────────────────────────────────────
{
  const swing = { kind: 'RgbArg', name: 'SWING_COLOR_ARG', defaultExpr: R(7, 7, 7) };
  ok('with nothing written down, first-RgbArg still answers',
     make({ inline: [swing] })({ expr: 'S<>' }).source === 'first-inline');
  ok('but a colour in the EXPRESSION beats it',
     make({ inline: [swing] })({ expr: `Layers<${R(2, 2, 2)},Black>` }).source === 'expr-hardcoded');
  ok('and a colour in the DEFINITION beats it',
     make({ inline: [swing], leaf: 'X', helperText: R(3, 3, 3) })({ expr: 'S<>' }).source === 'helper-hardcoded');
}

// ── the extras the card needs ──────────────────────────────────────────────
{
  const r = make({})({ expr: `Layers<${R(4, 4, 4)},Black>` });
  ok('an expression colour reports where it was found',
     r.hardcodedInfo && r.hardcodedInfo.matchStr === R(4, 4, 4), JSON.stringify(r.hardcodedInfo));
  ok('and marks the colour as a default', r.colorIsDefault === true);
  // ⚠️ Only the expression rung sets these — a helper-body colour is not editable in the
  // slot, so offering to rewrite it there would edit the wrong file.
  ok('a helper-body colour does NOT claim to be editable in the slot',
     make({ leaf: 'X', helperText: R(3, 3, 3) })({ expr: 'S<>' }).hardcodedInfo === null);
}

// ── the edges ──────────────────────────────────────────────────────────────
{
  ok('a bare r,g,b colorArg still resolves',
     JSON.stringify(make({})({ expr: 'S<>', colorArg: '10, 20, 30' }).rgb16) === '[10,20,30]');
  ok('and it is attributed to the parens, not to a fallback',
     make({})({ expr: 'S<>', colorArg: '10,20,30' }).source === 'colorarg-csv');
  ok('a slot with no colour anywhere returns null', make({})({ expr: 'S<>' }).rgb16 === null);
  ok('no slot at all is safe', make({})(null).rgb16 === null);
}

// ── both render paths share it ─────────────────────────────────────────────
{
  ok('_resolveSlotColor delegates',
     /function _resolveSlotColor\(slot\) \{[\s\S]{0,120}?_pickSlotPrimary\(slot\)\.rgb16;/.test(html));
  ok('the slot card delegates too', /const _pick = _pickSlotPrimary\(slot\);/.test(html));
  // ⭐ The duplicated ladder is what let the card and the detail disagree. Exactly one
  // implementation of the "BASE or first RgbArg" preference may exist.
  const dupes = (html.match(/find\(a => a\.kind === 'RgbArg' && a\.name === 'BASE_COLOR_ARG'\)\s*\r?\n?\s*\|\| _?\w*[Rr]es\w*\.find\(a => a\.kind === 'RgbArg'\)/g) || []).length;
  ok('no copy of the old combined "BASE or first" lookup survives', dupes === 0, `${dupes} left`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall slot primary colour tests passed');
process.exit(failures ? 1 : 0);
