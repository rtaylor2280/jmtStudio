/**
 * Mixed colour scales: leave the text, show the scale  [B-078]
 *
 * *** The original premise was WRONG and the entry says so: the app CANNOT emit Rgb16.
 * Every Rgb16 reference is a READ path; every WRITE is 8-bit. So there is no serializer
 * "choosing" between the two, and looking for that decision is a dead end. ***
 *
 * WHAT ACTUALLY HAPPENS: the picker resolves the EARLIEST colour in the slot and
 * replaces every occurrence of that exact string. Anything else is preserved verbatim,
 * including an Rgb16 a hand-written or externally generated style brought with it. The
 * repro, run 2026-08-17, starting from a hand-written slot:
 *     StylePtr<AudioFlicker<Rgb16<0,0,20393>,Rgb16<30000,0,0>>>()
 * picking green produced:
 *     StylePtr<AudioFlicker<Green,Rgb16<30000,0,0>>>()
 * One expression, two scales — and the app wrote a NAMED colour, a third form.
 *
 * ⭐ HIS RULING settles the TEXT: normalise only the colour the picker touched, leave a
 * foreign Rgb16 alone. Normalising the whole slot would churn the config and produce
 * diff noise in lines the user never edited.
 *
 * ⭐⭐ BUT THAT DOES NOT ADDRESS THE COST, which is not the mixing itself: advice in this
 * community is given in 8-bit, and "try around 100" dropped into a 16-bit slot is
 * 100/65535 — black. The user cannot tell which scale they are looking at. So the file
 * is untouched and the SCALE IS MADE VISIBLE — the entry's own third option, which
 * costs nothing in their config.
 *
 * Run: node test/colour-scale-visible.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── the scanner reports a scale ────────────────────────────────────────────
const scanner = (() => {
  const i = html.indexOf('function _earliestColorInText(text) {');
  let j = html.indexOf('{', i), d = 0, e = -1;
  for (; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}') { d--; if (!d) { e = j + 1; break; } }
  }
  return new Function('window', html.slice(i, e) + '; return _earliestColorInText;')({
    proffieArgs: {
      resolveColorDefault: (x) => {
        const m = /Rgb<(\d+),(\d+),(\d+)>/.exec(x);
        if (m) return [m[1] * 257, m[2] * 257, m[3] * 257];
        return x === 'Green' ? [0, 65535, 0] : [0, 0, 0];
      },
    },
  });
})();

{
  ok('a 16-bit literal reports scale 16',
     scanner('AudioFlicker<Rgb16<0,0,20393>,Black>').scale === '16');
  ok('an 8-bit literal reports scale 8',
     scanner('Layers<Rgb<135,0,255>,Black>').scale === '8');
  // ⚠️ A NAME HAS NO SCALE. Claiming one would be inventing a fact.
  ok('a named colour reports no scale', scanner('AudioFlicker<Green,Black>').scale === null);
  ok('nothing at all is still null', scanner('Layers<>') === null);
}

// ── the tag follows what is VISIBLE, not only what resolved ────────────────
{
  // THE ENTRY'S OWN POST-EDIT REPRO. `Green` resolves first and carries no scale, while
  // a 16-bit literal sits beside it. A tag driven only by the resolved colour would go
  // quiet on exactly the expression this entry is about.
  ok('the resolved colour alone would MISS the mixed case',
     scanner('AudioFlicker<Green,Rgb16<30000,0,0>>').scale === null,
     'which is why the tag also looks at the expression');

  const tag = html.slice(html.indexOf('const _has16 ='), html.indexOf('const _has16 =') + 900);
  ok('the tag checks the expression too',
     /_colorScale === '16' \|\| \/\\bRgb16\\s\*<\/\.test\(slot\.expr \|\| ''\)/.test(tag), tag.slice(0, 200));
  ok('it says 16-bit', /_scaleTag\.textContent = '16-bit';/.test(tag));
  ok('and explains the 8-bit advice trap',
     /usually 8-bit \(0–255\)/.test(tag) && /much\s*'?\s*\+?\s*'?darker/.test(tag.replace(/\s+/g, ' ')), tag);
  ok('it has a style rule', /\.preset-slot-color-scale \{/.test(html));
}

// ── the text is NOT rewritten ──────────────────────────────────────────────
{
  // ⭐ HIS RULING, asserted so a later "tidy-up" cannot quietly normalise the slot.
  // split(match).join(token) replaces ONE colour string; a whole-expression rewrite
  // would look nothing like this.
  ok('the picker still replaces only the matched colour',
     /\.split\(_?\w*match\w*\)\.join\(/i.test(html) || /split\(match\)\.join\(token\)/.test(html),
     'a whole-slot normalise would churn lines the user never edited');
  ok('no Rgb16 is ever written',
     !/`Rgb16<\$\{/.test(html) && !/'Rgb16<' \+/.test(html),
     'every Rgb16 reference must stay a READ path, as the entry established');
}

// ── it only claims a scale it can know ─────────────────────────────────────
{
  const csv = html.slice(html.indexOf("out.scale = p.slice(0, 3).some"), html.indexOf("out.scale = p.slice(0, 3).some") + 120);
  ok('a CSV colorArg claims 16-bit only above 255',
     /some\(n => n > 255\) \? '16' : null/.test(csv), csv);
  // Below 256 the two scales are indistinguishable — "0,100,200" is a valid 8-bit
  // colour AND a valid (very dark) 16-bit one. Saying nothing beats guessing.
  ok('and stays silent when the value could be either', /: null/.test(csv), csv);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall colour scale tests passed');
process.exit(failures ? 1 : 0);
