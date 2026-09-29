// No HTML comment inside a .js file may contain a backtick.
//
// ⭐⭐ WHY THIS EXISTS. 2026-09-29, [B-446]. A comment was added inside the version
// card's HTML template literal in versionsPanel.js, explaining which CSS class the new
// divider reused. The class name was written in backticks, the way it would be in any
// other comment in this project:
//
//     <!-- ... The divider is `.toolbar-divider`, the same element ... -->
//
// A comment marker means nothing to the JavaScript parser. The first backtick CLOSED
// the template literal, and what followed parsed as:
//
//     "...</button>".toolbar - divider
//
// a property access minus an undefined identifier. **It is valid syntax.** `node --check`
// passed, every one of the 116 tests passed, and the OS Versions detail pane threw
// `ReferenceError: divider is not defined` the moment a version was selected - the whole
// right-hand pane blank, found by Ryan opening the app.
//
// ⚠️ THE REASON A TEST IS THE ANSWER RATHER THAN CARE: this is the second time in a
// fortnight that a runtime ReferenceError in a renderer function reached him through a
// green suite (see qa-1.8.0 §278 / TC-3890, `_sdFlash`). That case is genuinely hard to
// catch statically. THIS one is not, and the difference is worth stating: an HTML comment
// can only appear in a .js file INSIDE a template literal, so "HTML comment containing a
// backtick, in a .js file" is a precise, zero-false-positive signature of the bug.
//
// ⚠️ .html files are deliberately NOT scanned. There, `<!-- -->` is real markup and a
// backtick is just a character - index.html carries five such comments, all harmless.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = [
  'main.js',
  'preload.js',
  'proffieos.js',
  ...fs.readdirSync(path.join(root, 'renderer'))
       .filter(f => f.endsWith('.js'))
       .map(f => path.join('renderer', f)),
];

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (detail) console.log(`       ${detail}`);
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

const offenders = [];
for (const rel of FILES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  let m;
  HTML_COMMENT.lastIndex = 0;
  while ((m = HTML_COMMENT.exec(src)) !== null) {
    if (!m[0].includes('`')) continue;
    const line = src.slice(0, m.index).split('\n').length;
    offenders.push(`${rel}:${line}`);
  }
}

ok('no HTML comment in a .js file contains a backtick',
   offenders.length === 0,
   offenders.length
     ? `a backtick there closes the enclosing template literal and the rest parses as code: ${offenders.join(', ')}`
     : '');

// ⚠️ THE CONTROL. A check that cannot fail is decoration, and this one is a single
// regex over source text - exactly the shape that has passed while asserting nothing
// before. Prove it catches the real defect by feeding it the real defect.
{
  const mutant = 'const html = `<div>\n  <!-- reuses `.toolbar-divider` here -->\n</div>`;';
  HTML_COMMENT.lastIndex = 0;
  const hit = (mutant.match(HTML_COMMENT) || []).some(c => c.includes('`'));
  ok('⚠️⚠️ the exact defect that shipped IS caught', hit,
     'if this fails the check above is worthless, whatever it reports');
}

// And the other half of the control: the harmless case must NOT trip it, or the check
// gets switched off the first time someone writes a legitimate comment.
{
  const clean = 'const html = `<div>\n  <!-- reuses the toolbar-divider element -->\n</div>`;';
  HTML_COMMENT.lastIndex = 0;
  const hit = (clean.match(HTML_COMMENT) || []).some(c => c.includes('`'));
  ok('a backtick-free HTML comment is not flagged', !hit,
     'a check that cries wolf is a check that gets deleted');
}

console.log(`\ntemplate-literal-backtick: ${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
