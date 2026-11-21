// A Shift or Ctrl click in a selectable list selects rows, never the page's text: the press is cancelled
// before the browser can paint a text selection, everywhere a list takes Shift or Ctrl. A rename field keeps
// its own selection. And a change to common folders asks for the footer's library size. [QA16]
'use strict';

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

const a = html.indexOf('const _SELECT_ROWS = [');
const b = a > -1 ? html.indexOf('}, true);', a) : -1;
const src = a > -1 && b > -1 ? html.slice(a, b + '}, true);'.length) : '';
check('CONTROL lifted the shared handler', /document\.addEventListener\('mousedown'/.test(src), src.slice(0, 80));

// Run it against a stand-in document, with targets whose closest() answers for the given selectors.
let handler = null;
const doc = { addEventListener: (ev, fn, cap) => { if (ev === 'mousedown' && cap === true) handler = fn; } };
new Function('document', src)(doc);
check('registered in the capture phase', typeof handler === 'function');
const target = (matches) => ({ closest: (sel) => (sel.split(',').map((s) => s.trim()).some((s) => matches.includes(s)) ? {} : null) });
const press = (mods, matches) => { let prevented = false; handler({ ...mods, target: target(matches), preventDefault: () => { prevented = true; } }); return prevented; };

for (const row of ['#sf-common-list .sf-common-row-header', '[data-tree-file]', '[data-st-file]',
  '#sf-entry-files-browser [data-file-path]', '#sf-source-files-browser [data-file-path]', '.sf-entry-files-row[data-idx]', '.preset-row']) {
  check(`Shift on ${row} is cancelled`, press({ shiftKey: true }, [row]));
}
check('Ctrl on a common folder is cancelled', press({ ctrlKey: true }, ['#sf-common-list .sf-common-row-header']));
check('a plain click is left alone', !press({}, ['#sf-common-list .sf-common-row-header']));
check('Shift outside the lists is left alone (editor, output, text)', !press({ shiftKey: true }, ['.monaco-editor']));
check('Shift in a rename field inside a row keeps its selection',
  !press({ shiftKey: true }, ['input, textarea, [contenteditable="true"]', '[data-st-file]'].flatMap((s) => s.split(',').map((x) => x.trim()))));

// Each selector names something the page actually renders.
const marks = { '.sf-common-row-header': 'sf-common-row-header', '[data-tree-file]': 'data-tree-file="', '[data-st-file]': 'data-st-file="',
  '#sf-entry-files-browser': 'id="sf-entry-files-browser"', '#sf-source-files-browser': 'id="sf-source-files-browser"',
  '.sf-entry-files-row[data-idx]': 'sf-entry-files-row', '.preset-row': "'preset-row" };
for (const [sel, mark] of Object.entries(marks)) check(`the page renders ${sel}`, html.includes(mark), mark);

// The common folders' refresh asks for the library size (the footer kept deleted common folders until a restart).
const r = html.indexOf('const _sfRefreshCommons = async');
const body = r > -1 ? html.slice(r, html.indexOf('\n      };\n', r)) : '';
check('CONTROL lifted _sfRefreshCommons', body.includes('listCommons'), body.slice(0, 60));
check('a change to common folders asks for the library size', body.includes('window._sfRequestLibrarySize?.()'));

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
