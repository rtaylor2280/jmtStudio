/**
 * The slot's colour reads the same however it was rendered  [B-078]
 *
 * ⚠️⚠️ THIS FILE REPLACED A SUITE FOR A FEATURE THAT WAS UNBUILT ON 2026-09-15, and the
 * reason matters more than the code. It used to assert a "16-bit" scale tag beside the slot
 * colour. That tag was never asked for - it was this entry's own proposed third option,
 * written up as the settled answer - and two facts killed it:
 *
 *   1. Colour ARGUMENTS in ProffieOS must be 16-bit to work. So on every slot whose colour
 *      comes from an argument the tag stated a constant: always true, never informative, and
 *      placed where it read as a property of the colour ("Green 16-bit") rather than of the
 *      numbers. It also made the entry's "second surface" claim false - a CSV argument cannot
 *      carry MIXED scales, because it only has one.
 *   2. It made the actual reported bug WORSE. See below.
 *
 * ⭐ THE REAL FAULT, and it is a display inconsistency rather than anything about scale:
 * the slot showed the friendly colour NAME until the slot-arg editor's updater ran, and then
 * showed the raw CSV. Reported as "some were showing the rgb value rather than the word green
 * in some circumstance" - the circumstance being simply that the updater had run.
 *
 *   initial render   (index.html ~43522)  ->  colorLabel(...)      ->  "Green"
 *   the update path  (index.html ~45698)  ->  currentColorArg      ->  "0,65535,0"
 *
 * TWO RENDER PATHS DISAGREEING ABOUT ONE SLOT - the same fault [B-060] fixed for the colour
 * itself, in the same panel, found five weeks later.
 *
 * ⚠️ AND THE TAG TURNED A REPLACE INTO AN APPEND. The updater took `colorRow.lastChild` and
 * only wrote to it if it was a text node. With the tag appended, lastChild was that span, so
 * the branch fell through to appendChild and painted all three at once:
 *     Green  16-bit  0,65535,0
 * Before the tag existed you saw "Green" flip to "0,65535,0"; after it, you saw them stacked.
 *
 * Run: node test/colour-scale-visible.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}
// Absence assertions must not trip on the comments that explain what was removed.
const codeOnly = s => s.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ── the tag is gone and must not come back ─────────────────────────────────
{
  const code = codeOnly(html);
  ok('no scale tag element is created',
     !/preset-slot-color-scale'/.test(code) || !/createElement\('span'\)[\s\S]{0,120}preset-slot-color-scale/.test(code),
     'the tag stated a constant on argument-sourced colours, which are always 16-bit');
  ok('and nothing renders the literal "16-bit"', !/textContent = '16-bit'/.test(code), code.slice(0, 0));
  ok('and the scale is no longer read into the tile render',
     !/_colorScale/.test(code),
     'left orphaned when the tag went; a variable written and never read is its own defect');
}

// ── both render paths label a colour the same way ──────────────────────────
{
  const code = codeOnly(html);
  // The initial render has always used the friendly label.
  ok('the first render uses colorLabel',
     /colorRow\.appendChild\(document\.createTextNode\(window\.proffieArgs \? window\.proffieArgs\.colorLabel\(/.test(code),
     'index.html ~43522');

  // ⭐ THE FIX: the update path now derives the same label instead of writing the raw CSV.
  ok('the update path derives a label rather than writing the raw argument',
     /const _argLabel = \(\(\) => \{[\s\S]{0,400}?colorLabel\(p\[0\], p\[1\], p\[2\]\)/.test(code),
     'it wrote currentColorArg, so "Green" became "0,65535,0" the moment the updater ran');
  ok('and it writes that label, not the argument',
     /tn\.textContent = _argLabel;/.test(code) && !/tn\.textContent = currentColorArg;/.test(code));
  ok('on the create path too',
     /createTextNode\(_argLabel\)/.test(code) && !/newRow\.appendChild\(document\.createTextNode\(currentColorArg\)\)/.test(code));

  // ⚠️ AND IT NO LONGER ASSUMES THE TEXT NODE IS LAST.
  ok('the text node is FOUND, not assumed to be lastChild',
     /Array\.from\(colorRow\.childNodes\)\.find\(n => n\.nodeType === Node\.TEXT_NODE\)/.test(code),
     'lastChild was the tag span, so the branch fell through and APPENDED the raw value');
  ok('and the lastChild assumption is gone',
     !/const tn = colorRow\.lastChild;/.test(code));

  // The swatch itself still takes the raw argument - it needs the numbers, not a name.
  ok('the swatch still uses the raw argument for its colour',
     /_colorArgToCSS\(currentColorArg\)/.test(code),
     'a swatch needs values; only the text needed the label');
}

// ── the behaviour the entry actually settled, which is unchanged ───────────
{
  const code = codeOnly(html);
  // ⚠️ Matched on the MECHANISM, not the August spelling. The entry cites
  // "index.html:38477 does split(match).join(token)"; that exact text no longer exists and
  // the line number is five weeks stale. The behaviour it describes does - a targeted
  // split/join on the matched colour string rather than a rewrite of the slot.
  ok('the picker still replaces only the colour it resolved',
     /\.split\(_matchStr2\)\.join\(_tok\)/.test(code),
     'normalising the whole slot would churn a config in lines the user never edited');
  ok('and the app still never emits Rgb16',
     !/createTextNode\(`Rgb16</.test(code) && !/= `Rgb16<\$\{/.test(code),
     'every Rgb16 in the codebase is a read path; every write is 8-bit or a named colour');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall colour-label consistency tests passed');
process.exit(failures ? 1 : 0);
