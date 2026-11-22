// Style Library Append adds only what is new. [B-675]
//
// A style already in the library under the same name with the same code is left out, header and
// all. Same name with different code still comes in (and is flagged as a conflict). Runs the real
// parser and the real dedup block out of renderer/index.html.
//
// Run: node test/style-append-new-only.test.js
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
const helpers = ['_findUsingExprEnd', '_parseStyleEntries', '_parseStyleMeta', '_compactStyleCode', '_splitTemplatePrefix'];
const missing = helpers.filter((n) => !fn(n));
check('helpers located', !missing.length, missing.join(', '));

const a = html.indexOf('  // APPEND ADDS ONLY WHAT IS NEW. [B-675]');
const b = html.indexOf('  // Find conflicts: what is left', a);
check('the dedup block located', a > 0 && b > a);
const block = html.slice(a, b);

const run = new Function('existing', 'collapsedIncoming', `
  ${helpers.map(fn).join('\n')}
  ${(html.match(/^const _flattenExpr = .*$/m) || [''])[0]}
  ${block}
  return { text: collapsedIncoming, added, dupes: dupes.map(e => e.name), tally };`);

const LIB = `/*--- Alpha ---*/
using Alpha = StylePtr<Red>();

/*--- Beta ---*/
using Beta = StylePtr<Blue>();
`;
const FILE = `// A shared pack
/*--- Alpha ---*/
using Alpha = StylePtr<Red>();

/*--- Beta ---*/
using Beta = StylePtr<Green>();

/*--- Gamma ---*/
using Gamma = StylePtr<White>();
`;
let r;
try { r = run(LIB, FILE); } catch (e) { check('the block runs', false, e.message); }
if (r) {
  check('an identical style (same name, same code) is skipped', r.dupes.join() === 'Alpha', r.dupes.join());
  check('...with its header, so nothing of it is appended', !/Alpha/.test(r.text), r.text);
  check('same name, different code still comes in', /using Beta = StylePtr<Green>\(\);/.test(r.text));
  check('a new style comes in with its header', /\/\*--- Gamma ---\*\/\s*using Gamma/.test(r.text));
  check('the tally says what happened', r.tally === '2 styles, skipped 1 already in your library', r.tally);
  const ws = run(LIB.replace('StylePtr<Red>()', 'StylePtr< Red >( )'), FILE);
  check('whitespace alone does not make a style new', ws.dupes.includes('Alpha'), ws.dupes.join());
  const all = run(LIB, LIB);
  check('a file of nothing new adds nothing', all.added === 0 && all.dupes.length === 2);
}
const H = html.slice(b, b + 1800);
check('nothing new leaves the library untouched (setValue only when something is new)',
  /const nothingNew = parsed\.length > 0 && added === 0;/.test(H)
  && /if \(!nothingNew\) \{[^}]*_stylesEditorInstance\.setValue\(/.test(H));
check('one eject-toast call for both outcomes (the export-endings register counts them)',
  (H.match(/_sfOfferEjectInToast\(result\.sourcePath/g) || []).length === 1);

// The incoming file's own library header never comes in, and a save strips EVERY header copy.
// Found 2026-11-14: every style matched, but the appended file's banner sat at the end of the library.
check('Append strips the incoming file\'s library structure before anything else',
  /const incoming = _stripStyleLibraryStructure\(result\.content\);/.test(html.slice(a - 900, a)));
{
  const consts = ['_SL_JMT_HEADER_RE', '_SL_CHARGING_GUARD', '_SL_PIXEL_RELAY_GUARD']
    .map((n) => (html.match(new RegExp(`^const ${n} .*$`, 'm')) || [''])[0]).join('\n');
  const strip = new Function(`${consts}\n${fn('_stripStyleLibraryStructure')}\nreturn _stripStyleLibraryStructure;`)();
  const banner = (d) => `// ============================================================\n// Style Library  ·  JMT Studio (jmtfoundry.com)\n// @jmt:created     2026-11-04\n// @jmt:updated     ${d}\n// ============================================================\n`;
  const lib = banner('2026-11-14') + '\nusing Alpha = StylePtr<Red>();\n\n' + banner('2026-11-09');
  const out = strip(lib);
  check('a save strips every copy of the header, not just the first', !/Style Library  ·/.test(out) && /using Alpha/.test(out), out);
}

console.log(failures ? `\nstyle-append-new-only: ${failures} FAILED` : '\nstyle-append-new-only: all passing');
process.exit(failures ? 1 : 0);
