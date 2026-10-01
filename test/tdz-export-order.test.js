// No `window.X = X` above the declaration of X. (Temporal dead zone.)
//
// ⭐⭐ WHY THIS EXISTS, AND IT IS NOT HYPOTHETICAL. 2026-09-30, [B-424]: a block exporting five
// helpers onto `window` was written directly beneath the definition being looked at, which put it
// ABOVE `const _sfWireEjectRow`. `const` hoists into its block and then REFUSES TO BE READ until
// its declaration is evaluated, so this is a ReferenceError at load - not `undefined`. It threw,
// abandoned the rest of the enclosing IIFE, and the IIFE was what laid out the editor pane. The
// app opened with a zero-height editor and the build log sitting where the editor should have been.
//
// ⚠️⚠️ NOTHING ELSE IN THE SUITE COULD SEE IT. The syntax is perfect, so `node --check` and the
// inline-script parse both pass. It is a RUNTIME error, and the renderer is not executed by any
// test. This is the THIRD ReferenceError to reach a running build from this file in a fortnight - the other
// two were scope (`_sdFlash` in [B-254], `error` in onBuildStatus) and are tracked in followups as
// the standing argument for a real linter. ⭐ This one is narrower and needs no linter: an export
// assignment and a declaration are both greppable, and their ORDER is the whole bug.
//
// ⚠️ WHAT IT CANNOT CATCH: a TDZ read that is not a `window.X = X` export - a call, a closure
// invoked too early, a destructure. The general answer is still ESLint `no-undef` / `no-use-
// before-define` over the renderer, which is not installed and is a separate decision. This covers the one
// shape that has actually shipped.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['renderer/index.html',
               ...fs.readdirSync(path.join(ROOT, 'renderer'))
                    .filter(f => f.endsWith('.js'))
                    .map(f => path.join('renderer', f))];

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (detail) console.log(`       ${detail}`);
}

// `window.foo = foo;` - the self-named export, which is the shape that carries this risk. An
// export of a different expression (`window.a = b()`) is not what this is about.
const EXPORT = /window\.([A-Za-z_$][\w$]*)\s*=\s*\1\s*;/g;

function declIndex(src, name) {
  // ⚠️ `const`/`let` only. A `function` declaration is fully hoisted and is SAFE to export above,
  // so flagging it would be a false positive - and a check that cries wolf gets deleted.
  const m = src.search(new RegExp(`(?:^|[^\\w$.])(?:const|let)\\s+${name.replace(/\$/g, '\\$')}\\s*=`));
  return m;
}

const offenders = [];
let checked = 0;
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  EXPORT.lastIndex = 0;
  let m;
  while ((m = EXPORT.exec(src)) !== null) {
    const name = m[1];
    const decl = declIndex(src, name);
    if (decl === -1) continue;          // a var, a function, or declared in another file
    checked++;
    if (decl > m.index) {
      const line = src.slice(0, m.index).split('\n').length;
      const dline = src.slice(0, decl).split('\n').length;
      offenders.push(`${rel}:${line} exports ${name}, declared at :${dline}`);
    }
  }
}

ok(`no window export precedes its const/let declaration (${checked} checked)`,
   offenders.length === 0,
   'reading a const before its declaration is evaluated throws at load and abandons the rest of'
   + ` the enclosing scope:\n       ${offenders.join('\n       ')}`);

ok('⚠️ the scan actually found exports to check', checked > 0,
   'zero checked means the pattern matched nothing and this file is decoration');

// ⚠️ THE CONTROL. Prove both directions on synthetic input, because a check over source text that
// has never been shown to fail is a check nobody should trust.
{
  const bad = 'window.thing = thing;\nconst thing = () => {};';
  const decl = declIndex(bad, 'thing');
  EXPORT.lastIndex = 0;
  const hit = EXPORT.exec(bad);
  ok('⚠️⚠️ the exact defect that shipped IS caught', hit && decl > hit.index,
     'if this fails the check above is worthless, whatever it reports');
}
{
  const good = 'const thing = () => {};\nwindow.thing = thing;';
  const decl = declIndex(good, 'thing');
  EXPORT.lastIndex = 0;
  const hit = EXPORT.exec(good);
  ok('the correct order is not flagged', hit && decl < hit.index,
     'a check that cries wolf is a check that gets deleted');
}
{
  // Hoisting means this order is legal, and flagging it would be wrong.
  const fnDecl = 'window.thing = thing;\nfunction thing() {}';
  ok('a hoisted function declaration is not flagged', declIndex(fnDecl, 'thing') === -1,
     'function declarations hoist fully; only const and let have a temporal dead zone');
}

console.log(`\ntdz-export-order: ${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
