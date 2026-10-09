// No NEW em dash in a user-facing string. [B-443]
//
// WHY THIS IS A TEST AND NOT A NOTE. The standing rule is that AI tells stay out of
// anything public, and until 2026-09-29 the app's own chrome was internal surface. Then a
// screenshot of the Config Manager went into a public post with "OS version changed — recompile
// needed" sitting in the status bar, top right, in every frame. The strings stopped being
// internal the moment the window became an image.
//
// AND IT REGROWS. The same class has been swept to zero and come back repeatedly elsewhere in
// this project (the name in code comments: 84 instances swept, ~85 again five weeks later). A
// sweep plus resolve has never held. What holds is a check that fails.
//
// ── WHAT THIS IS NOT ───────────────────────────────────────────────────────────
// It does NOT sweep what is here. 15 sites are frozen as a baseline below, split into the
// ones deliberately KEPT and the ones still awaiting a taste call. It has exactly one job:
// the number must not go UP.
//
// IT IS BLIND TO EVERY OTHER TELL. [B-443] is deliberately extensible - em dashes are the
// first known class, not the whole entry. A green run here says nothing about cadence, hedging,
// or the tautological sentence; those have no signature to grep and are caught by reading.
//
// IT IS ALSO BLIND TO HTML TEXT NODES BY CONSTRUCTION, and that gap was measured rather
// than assumed (2026-09-30): stripping <script>/<style>/comments from index.html and scanning
// what the browser actually paints found exactly two hits, both the intentional bare "—"
// empty-value glyph. So the gap is real and currently empty. If static markup ever grows prose,
// this check will not see it.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['renderer/index.html', 'renderer/buildPanel.js', 'renderer/versionsPanel.js'];

const EM = '—';

// BLIND TO THE CALL SITE, ON PURPOSE. The first version of this scan grepped for em dashes on
// lines containing a hand-picked list of call names (showToast, setStatus, textContent...). It
// could only ever find what had already been guessed, and it MISSED the exact string in the
// screenshot plus five more in the same file. Match any string literal instead.
const SQ = /'(?:[^'\\\n]|\\.)*'/;
const DQ = /"(?:[^"\\\n]|\\.)*"/;
const BT = /`(?:[^`\\]|\\.)*`/;
const STR = new RegExp([SQ.source, DQ.source, BT.source].join('|'), 'g');

// Frozen 2026-09-30, after the second pass took 21 fixed to 50 of 65 sites.
//   · 7 are typographic and deliberately kept (separators, empty-value glyphs, label suffixes).
//   · 8 are label-plus-qualifier suffixes awaiting a taste call; they are listed on [B-443].
// Lower this when real ones are removed. NEVER raise it - raising it is how a ratchet becomes
// a record of the thing it was built to stop.
const BASELINE = 15;

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (detail) console.log(`       ${detail}`);
}

function hits(src) {
  const found = [];
  for (const line of src.split('\n')) {
    const s = line.trimStart();
    if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) continue;
    STR.lastIndex = 0;
    let m;
    while ((m = STR.exec(line)) !== null) {
      const lit = m[0];
      if (!lit.includes(EM)) continue;
      // A literal that is ONLY an em dash is the intentional empty-value placeholder.
      if (lit.slice(1, -1).trim() === EM) continue;
      found.push(lit.trim());
    }
  }
  return found;
}

const all = [];
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  for (const lit of hits(src)) all.push(`${rel}: ${lit.slice(0, 90)}`);
}

ok(`em dashes in user-facing strings: ${all.length} (baseline ${BASELINE})`,
   all.length <= BASELINE,
   `${all.length - BASELINE} new since the baseline. Em dashes read as machine-written and the`
   + ` app's chrome is public surface now. Newest first is usually the culprit:\n       `
   + all.slice(BASELINE).join('\n       '));

if (all.length < BASELINE) {
  console.log(`  note  down to ${all.length} - lower BASELINE to match, so the ratchet keeps its grip`);
}

// THE CONTROL. This is a regex over source text, the shape that has passed while asserting
// nothing before. Prove each half does what it claims.
{
  ok('a prose em dash in a string IS found',
     hits(`showToast('Saved ${EM} nothing else to do');`).length === 1,
     'if this fails the count above is meaningless, whatever it reports');
  ok('one inside a template literal IS found',
     hits('const s = `${n} files ' + EM + ' done`;').length === 1,
     'most user-facing strings in this codebase are template literals');
  ok('a comment is not counted',
     hits(`  // a note ${EM} explaining something`).length === 0,
     'comments are not shipped text; counting them would bury the real hits');
  ok('the bare empty-value glyph is not counted',
     hits(`el.textContent = '${EM}';`).length === 0,
     'that glyph is the deliberate placeholder and must not be swept');
  ok('a string with no em dash is not counted',
     hits(`showToast('Saved, nothing else to do');`).length === 0,
     'a check that cries wolf is a check that gets deleted');
}

console.log(`\nui-emdash-ratchet: ${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
