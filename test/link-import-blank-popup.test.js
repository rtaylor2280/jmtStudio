// The in-app download browser must not navigate itself to a blank popup. [2026-10-07]
//
// ⭐⭐ WHY THIS EXISTS. The link-import browser could not capture a single font from
// bvm-sabers.co.uk, and the cause was one truthiness check in our own window-open
// handler, not anything the vendor does wrong.
//
// A common vendor pattern opens an EMPTY popup inside the click handler, purely to keep
// the browser's user-gesture popup allowance, THEN asks its own API for a download URL
// and points that popup at the answer when it arrives. Measured in an isolated Electron
// probe on 2026-10-07: both `window.open("")` and `window.open()` arrive at
// setWindowOpenHandler as the literal string "about:blank" - Electron resolves the empty
// URL before the handler ever sees it. "about:blank" is truthy, so the old guard
// (`if (popupUrl) bw.loadURL(popupUrl)`) navigated the capture window to a blank page
// while the vendor's request for the real URL was still in flight, destroying the
// document that held both that request and the <a download> fallback it would have used.
// No download started, and nothing raised an error - the window simply sat on a blank
// page looking like the click had not registered.
//
// ⚠️ WHY THIS IS NOT A SOURCE-TEXT ASSERTION. Grepping main.js for the string
// "about:blank" would pass for a comment, a log line, or a guard that was written and
// then inverted. So this file EXTRACTS the real handler body and RUNS it against a fake
// window, and asserts on what it did. Delete the guard and the fake records a navigation
// and this fails.
//
// ⚠️ A real URL must still navigate. That is the whole reason the handler exists - vendors
// whose Download is a `target=_blank` link need the popup loaded into our window so the
// download fires on the session we are listening to. A fix that simply stopped navigating
// would trade one broken set of vendors for another, so both directions are asserted.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// Brace-match the callback out of setWindowOpenHandler( ... ) rather than slicing a fixed
// window, so a longer body is never silently truncated into a vacuous pass.
function extractHandler() {
  const m = /setWindowOpenHandler\s*\(/.exec(SRC);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < SRC.length && depth > 0) {
    const c = SRC[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  return depth === 0 ? SRC.slice(m.index + m[0].length, i - 1).trim() : null;
}

const body = extractHandler();

// ⚠️ The fixture's own precondition, asserted before anything is built on it. An extraction
// that silently returned nothing would make every assertion below vacuously true.
ok('handler body extracted from main.js', !!body && body.length > 20,
   `got ${body === null ? 'null' : JSON.stringify(String(body).slice(0, 60))}`);
ok('extracted body is the window-open callback, not a stray match',
   !!body && /popupUrl/.test(body) && /action/.test(body),
   'expected the callback to destructure a popup url and return an action');

if (!body) {
  console.log(`\n${failed} failure(s)`);
  process.exit(1);
}

// Run the real callback against a fake window and record what it tried to do.
function runHandler(popupUrl) {
  const navigations = [];
  const bw = { loadURL: (u) => { navigations.push(u); } };
  // eslint-disable-next-line no-new-func
  const fn = new Function('bw', `return (${body});`)(bw);
  const result = fn({ url: popupUrl });
  return { navigations, result };
}

const blank = runHandler('about:blank');
ok('about:blank does not navigate the capture window', blank.navigations.length === 0,
   `handler called loadURL(${JSON.stringify(blank.navigations[0])}) - this is the defect that ` +
   'lost every font on a vendor who opens a placeholder popup first');
ok('about:blank is still denied', blank.result && blank.result.action === 'deny',
   `expected {action:'deny'}, got ${JSON.stringify(blank.result)}`);

const real = runHandler('https://example.test/fonts/thing.zip');
ok('a real popup URL still loads into the capture window',
   real.navigations.length === 1 && real.navigations[0] === 'https://example.test/fonts/thing.zip',
   `expected one navigation to the popup URL, got ${JSON.stringify(real.navigations)} - ` +
   'target=_blank download links depend on this');
ok('a real popup URL is denied as a popup', real.result && real.result.action === 'deny',
   `expected {action:'deny'}, got ${JSON.stringify(real.result)}`);

// window.open() with no arguments reaches the handler the same way, so it must be covered
// by the same guard rather than by a check that only knows the empty-string spelling.
const empty = runHandler('');
ok('an empty popup URL does not navigate either', empty.navigations.length === 0,
   `handler called loadURL(${JSON.stringify(empty.navigations[0])})`);

console.log(failed ? `\n${failed} failure(s)` : '\nall passed');
process.exit(failed ? 1 : 0);
