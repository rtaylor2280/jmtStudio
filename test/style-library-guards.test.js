// Style Library guards: a save writes one #ifdef / #endif pair per add-on guard, and a guard line left
// without its partner is dropped, not kept. An #endif left behind stops the compile at "#endif without #if".
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
const constLine = (name) => (html.match(new RegExp(`^const ${name} *= .*$`, 'm')) || [''])[0];
const consts = ['_SL_HELPER_HEADER', '_SL_CHARGING_HEADER', '_SL_PIXEL_RELAY_HEADER', '_SL_STYLE_HEADER', '_SL_JMT_HEADER_RE',
  '_SL_CHARGING_GUARD', '_SL_JMT_DEPENDENT_SYMBOLS', '_SL_CHARGING_SYMBOL_RE', '_SL_PIXEL_RELAY_GUARD', '_SL_PIXEL_RELAY_SYMBOLS',
  '_SL_PIXEL_RELAY_SYMBOL_RE', '_stripComments'];
const names = ['_styleExprHead', '_classifyStyleEntries', '_parseStyleEntries', '_parseStyleMeta',
  '_findUsingExprEnd', '_buildStyleLibraryJmtHeader', '_stripStyleLibraryStructure', '_applyStyleLibraryStructure', '_buildSegments'];
const missing = [...consts.filter((c) => !constLine(c)), ...names.filter((n) => !fn(n))];
check('located', !missing.length, missing.join(', '));
const env = new Function(`const _jmtLocalDateString = () => '2026-10-29';
  ${consts.map(constLine).join('\n')}
  ${names.map(fn).join('\n')}
  return { apply: _applyStyleLibraryStructure, entries: (t) => _parseStyleEntries(t),
    segs: (t) => _buildSegments(t, _classifyStyleEntries(_parseStyleEntries(t))) };`)();

const count = (t, re) => (t.match(re) || []).length;
const IF = /^#ifdef FUNCTIONS_CHARGE_FULL_PROP_H/gm, END = /^#endif/gm;
const lib = [
  '/*--- Base ---*/', 'using Base = Red;', '/*----*/', '',
  '/*--- Charger ---*/', 'using Charger = Mix<ChargeFullPropF,Red,Green>;', '/*----*/', '',
].join('\n');
const saved = env.apply(lib, '2026-10-01');
check('a save writes one pair', count(saved, IF) === 1 && count(saved, END) === 1, saved);
check('saving again keeps one pair', env.apply(saved, '2026-10-01') === saved);

const noIf = saved.replace(/^#ifdef FUNCTIONS_CHARGE_FULL_PROP_H\r?\n/m, '');
let x = noIf;
for (let i = 0; i < 2; i++) x = env.apply(x, '2026-10-01');
check('an #ifdef deleted by hand: two saves leave one pair, no #endif without #if',
  count(x, IF) === 1 && count(x, END) === 1, `${count(x, IF)} #ifdef, ${count(x, END)} #endif`);

const strays = saved.replace(/^(#endif \/\/ FUNCTIONS_CHARGE_FULL_PROP_H\r?\n)/m, '$1\n$1\n$1');
const healed = env.apply(strays, '2026-10-01');
check('a file already holding extra #endifs heals on its next save', count(healed, END) === 1, `${count(healed, END)} #endif`);
check('every entry survives', env.entries(healed).map((e) => e.name).join() === env.entries(saved).map((e) => e.name).join());

// The cause: an entry's span ran to the next entry, so the last helper or segment carried the Charging
// heading and its #ifdef, and the last charging style carried the #endif. Deleting or editing one took
// the guard line with it. Now each entry is its own lines plus a tail that stays where it is.
const withHelper = env.apply('/*--- Seg ---*/\n// @jmt:helper\nusing Seg = Blue;\n/*----*/\n\n' + lib, '2026-10-01');
const { preamble, segments } = env.segs(withHelper);
const seg = segments.find((s) => s.entry.name === 'Seg'), chg = segments.find((s) => s.entry.name === 'Charger');
check('own + tail is the whole span', segments.every((s) => s.own + s.tail === s.text));
check("the guard's #ifdef is in the helper's tail, not its own lines", /#ifdef/.test(seg.tail) && !/#ifdef/.test(seg.own), seg.own);
check("the guard's #endif is in the charging style's tail", /#endif/.test(chg.tail) && !/#endif/.test(chg.own), chg.own);
check("an entry's own lines end with its closing comment", /\/\*-+\*\/$/.test(seg.own), seg.own);
const deleted = preamble + segments.map((s) => s === seg ? s.tail : s.text).join('');
check('deleting the helper keeps the pair, before any save', count(deleted, IF) === 1 && count(deleted, END) === 1,
  `${count(deleted, IF)} #ifdef, ${count(deleted, END)} #endif`);
check('delete, edit, reorder and dedupe all keep the tail',
  /segments\.map\(s => s\.entry\.name === entry\.name \? s\.tail : s\.text\)/.test(html)
  && (html.match(/s === targetSeg \? newBlock\.replace\(\/\\s\+\$\/, ''\) \+ s\.tail : s\.text/g) || []).length === 2
  && /segments\[segIdx\]\.text = fsOwn\[i\] \+ segments\[segIdx\]\.tail;/.test(html)
  && /segments\.map\(s => toRemove\.has\(s\.entry\) \? s\.tail : s\.text\)/.test(html));

const own = saved +'\n#ifdef MY_OWN_FLAG\nusing Mine = Blue;\n#endif\n';
check("the user's own #ifdef blocks are left alone", /#ifdef MY_OWN_FLAG\nusing Mine = Blue;\n#endif/.test(env.apply(own, '2026-10-01')));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
