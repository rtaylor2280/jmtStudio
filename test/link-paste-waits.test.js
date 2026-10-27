// In the font and source windows a link box's paste button fills the box and waits for ✓, as typing
// and the × do. Other paste buttons (import review) are unchanged. [B-553]
'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

const doors = [
  ['font Demo', '_sfEntryDetailEls.demoPaste', '_sfEntryDetailEls.demoInput'],
  ['font Link', '_sfEntryDetailEls.linkPaste', '_sfEntryDetailEls.linkInput'],
  ['source Website', '_sfSourceDetailEls.websitePaste', '_sfSourceDetailEls.websiteInput'],
  ['source Link', '_sfSourceDetailEls.linkPaste', '_sfSourceDetailEls.linkInput'],
  ['source Download', '_sfSourceDetailEls.downloadPaste', '_sfSourceDetailEls.downloadInput'],
];
for (const [label, btn, input] of doors) {
  const at = html.indexOf(`${btn}?.addEventListener('click', async () => {`);
  const body = at > -1 ? html.slice(at, html.indexOf('\n      });', at)) : '';
  check(`${label}: paste fills the box and waits for the check`, body.length > 0
    && body.includes(`await _sfTryPasteUrlInto(${input}, _sfPasteWaitsForCheck);`)
    && !/_sfMark(Detail|Source)Dirty|Edit\.\w+ = url/.test(body), body.slice(0, 200));
}

const at = html.indexOf('const _sfPasteWaitsForCheck = (_url, inputEl) => {');
const src = at > -1 ? html.slice(at, html.indexOf('\n      };', at) + 9) : '';
check('the helper was located', src.length > 80, 're-anchor: an empty slice runs nothing');
const events = [];
let focused = false, sel = null;
const input = { value: 'https://example.com/x',
  dispatchEvent: (e) => events.push(e.type), focus: () => { focused = true; },
  setSelectionRange: (a, b) => { sel = [a, b]; } };
global.Event = class { constructor(t) { this.type = t; } };
new Function(`${src}; return _sfPasteWaitsForCheck;`)()('https://example.com/x', input);
check('it fires the input event typing fires, focuses the box, cursor at the end',
  events.join() === 'input' && focused && sel && sel[0] === input.value.length, JSON.stringify({ events, focused, sel }));

check('import review paste buttons are unchanged (they still commit)',
  /_sfImportEls\.websitePaste\?\.addEventListener\('click'/.test(html)
  && !/_sfImportEls\.\w+Paste[\s\S]{0,200}_sfPasteWaitsForCheck/.test(html));

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
