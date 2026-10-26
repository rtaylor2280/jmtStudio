// A press that starts inside a dialog and is released on its backdrop does not close it; a press and
// release on the backdrop still does. [B-559]
//
// The guard runs as lifted from index.html, against a stand-in document that records its listeners.
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const at = HTML.indexOf('here, before any of them sees it: a backdrop closes only when the press began on it too. [B-559]');
if (at < 0) throw new Error('guard not found in index.html');
const open = HTML.indexOf('{', at);
let depth = 0, i = open;
for (; i < HTML.length; i++) { if (HTML[i] === '{') depth++; else if (HTML[i] === '}' && --depth === 0) break; }
const block = HTML.slice(open, i + 1);

let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; }

const listeners = {};
const document = { addEventListener: (type, fn, capture) => { if (capture) listeners[type] = fn; } };
vm.runInNewContext(block, { document });

const el = (cls) => ({ classList: { contains: (c) => c === cls } });
const overlay = el('modal-overlay');
const field = el('sf-edit-input');
const fire = (down, up) => {
  let stopped = false;
  listeners.mousedown({ target: down });
  listeners.click({ target: up, stopImmediatePropagation: () => { stopped = true; }, preventDefault: () => {} });
  return stopped;
};

console.log('1. select text in a field and release on the backdrop');
check('the backdrop click is dropped', fire(field, overlay) === true);
console.log('2. press and release on the backdrop');
check('the backdrop click goes through', fire(overlay, overlay) === false);
console.log('3. an ordinary click inside the dialog');
check('untouched', fire(field, field) === false);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');
