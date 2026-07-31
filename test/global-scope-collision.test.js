// Cross-file global redeclaration guard.
//
// index.html's inline script, buildPanel.js, versionsPanel.js and compile-hints.js
// are all CLASSIC scripts, not modules. They share one global lexical scope. So a
// `const`/`let`/`class` in one that collides with a top-level declaration in another
// is a SyntaxError that kills the ENTIRE colliding file at parse time — taking every
// function in it down, not just the one name.
//
// That happened on 2026-07-29: a `const isVersionSentinel` in buildPanel.js collided
// with `function isVersionSentinel` in index.html. buildPanel.js never parsed, so
// initBuildPanel() never ran, so compile, flash and port detection were all dead while
// the UI sat at its hardcoded HTML defaults and looked merely "stuck".
//
// `node --check` cannot catch this — it checks one file in isolation, and each file is
// individually valid. Compiling the CONCATENATION is what catches it, and compiling is
// enough: V8 reports duplicate lexical declarations at compile time, so nothing here
// ever executes and no DOM/Electron stubs are needed.
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const R = (...p) => path.join(__dirname, '..', 'renderer', ...p);

// Load order matters: it is the order index.html actually injects them.
const inline = (() => {
  const html = fs.readFileSync(R('index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) {
    console.error('FAIL: no inline <script> found in index.html — did the markup change?');
    process.exit(1);
  }
  return blocks.join('\n');
})();

const files = [
  ['index.html (inline)', inline],
  ['compile-hints.js',    fs.readFileSync(R('compile-hints.js'), 'utf8')],
  ['buildPanel.js',       fs.readFileSync(R('buildPanel.js'),    'utf8')],
  ['versionsPanel.js',    fs.readFileSync(R('versionsPanel.js'), 'utf8')],
];

let failed = 0;

// Each file alone must compile (this is the `node --check` equivalent).
for (const [name, src] of files) {
  try { new vm.Script(src, { filename: name }); console.log(`PASS  ${name} compiles`); }
  catch (e) { failed++; console.log(`FAIL  ${name} does not compile: ${e.message}`); }
}

// Then each file must compile when appended to everything loaded before it, which is
// what the browser actually does. This is the check that catches the collision.
let combined = '';
for (const [name, src] of files) {
  const next = combined + '\n' + src;
  try {
    new vm.Script(next, { filename: `<${name} + everything before it>` });
    console.log(`PASS  ${name} shares global scope cleanly`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name} collides with an earlier file: ${e.message}`);
    console.log('      A const/let/class here has the same name as a top-level');
    console.log('      declaration in a file loaded earlier. Rename it, or drop the');
    console.log('      declaration and just use the existing global.');
  }
  combined = next;
}

console.log(failed ? `\n${failed} failure(s)` : '\nno global-scope collisions');
process.exit(failed ? 1 : 0);
