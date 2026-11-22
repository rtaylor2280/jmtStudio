'use strict';
// Runs the page's own template reader, lifted out of renderer/index.html.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const start = html.indexOf('function _clipboardTemplate(text)');
const end = html.indexOf('// The code from the clipboard under this name.', start);
if (start < 0 || end < start) { console.error('helper not found'); process.exit(1); }
const _clipboardTemplate = new Function(`${html.slice(start, end)}; return _clipboardTemplate;`)();

let failed = 0;
const ok = (name, got, want) => {
  const pass = got === want;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  <- ${got}`}`);
  if (!pass) failed++;
};

ok('a template above a using is read', _clipboardTemplate('template<class X>\nusing Foo = Layers<X>;'), 'template<class X>');
ok('a header comment before it is fine', _clipboardTemplate('/*--- Foo ---*/\n\ntemplate<int dir = 0>\nusing Foo = Red;'), 'template<int dir = 0>');
ok('no template reads as none', _clipboardTemplate('using Foo = Red;'), '');
ok('a bare style has none', _clipboardTemplate('StylePtr<Layers<Red>>()'), '');
ok('a template word inside code is not one', _clipboardTemplate('Layers<Red> /* template<class X> */'), '');

console.log(failed ? `\n${failed} failure(s)` : '\nall paste template tests passed');
process.exit(failed ? 1 : 0);
