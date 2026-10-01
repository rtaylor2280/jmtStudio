// A dialog's ✕ must be drawn on the DIALOG, not in the corner of the screen.
//
// `.modal-btn-close` is `position: absolute; top: 12px; right: 14px`. An absolutely positioned
// element resolves against its nearest POSITIONED ancestor, and if `.modal` is static that is
// `.modal-overlay` — `position: fixed; inset: 0`, the whole viewport. The ✕ then lands in the
// top-right corner of the screen, over the title bar, reading as a window control.
//
// Found 2026-09-30: 10 of the 14 dialogs carrying a ✕ were in that state, and it surfaced on the
// New Config chooser — "don't have a way to get out of this other than to proceed." There was a
// way out, 700px away, that looked like something else entirely.
//
// The fix was one declaration on the base `.modal` rule. This file exists because that
// declaration is invisible: nothing about `.modal` hints that removing it breaks a button
// defined 2500 lines below it, and the four dialogs that had declared `position: relative`
// themselves would go on looking fine while the other ten silently regressed.
//
// What is asserted:
//   1. the base `.modal` rule declares `position: relative`
//   2. `.modal-btn-close` is still absolutely positioned with an offset (the thing that makes
//      the anchor matter at all — if someone converts it to a flex child this check is moot
//      and should be revisited rather than kept passing by accident)
//   3. `.modal-overlay` is still `position: fixed` (the thing it would escape TO)
//   4. every element carrying `.modal-btn-close` is inside a `.modal`, so the base rule
//      actually covers it

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const css  = html.slice(0, html.indexOf('</style>'));

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
}

// Parse the stylesheet into (selector, body) pairs once. Comments are stripped first so a
// selector or declaration mentioned inside one of this project's long explanatory banners
// cannot be read as a live rule.
function rules(text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  return out;
}
const RULES = rules(css);

// ── 1. the base rule anchors its children ────────────────────────────────────
const baseModal = RULES.filter(r => /(^|,\s*)\.modal(\s*,|$)/.test(r.sel));
ok('a bare `.modal` rule exists', baseModal.length > 0);
ok('base `.modal` declares position: relative',
   baseModal.some(r => /position:\s*relative/.test(r.body)),
   'Without it every .modal-btn-close in a dialog that does not set its own position is drawn '
   + 'in the top-right corner of the viewport.');

// ── 2. the button is still the kind of thing that needs an anchor ────────────
const closeRule = RULES.find(r => /(^|,\s*)\.modal-btn-close(\s*,|:|$)/.test(r.sel)
                                  && /position:/.test(r.body));
ok('`.modal-btn-close` rule found', !!closeRule);
ok('`.modal-btn-close` is absolutely positioned with an offset',
   !!closeRule && /position:\s*absolute/.test(closeRule.body)
              && /(^|[;\s])(top|right|bottom|left|inset)\s*:/.test(closeRule.body),
   'If this stopped being true the anchor no longer matters and this whole file should be '
   + 'reconsidered rather than left passing.');

// ── 3. and the thing it would escape to is still the whole screen ────────────
const overlayRule = RULES.find(r => /(^|,\s*)\.modal-overlay(\s*,|$)/.test(r.sel)
                                    && /position:/.test(r.body));
ok('`.modal-overlay` is position: fixed over the viewport',
   !!overlayRule && /position:\s*fixed/.test(overlayRule.body),
   'This is what a static .modal would hand the button to.');

// ── 4. every ✕ actually sits inside a `.modal` ───────────────────────────────
// Static markup and the one runtime-built dialog (the SD doc viewer, injected via innerHTML)
// are both covered because both are string-matched out of the same file.
const bodyHtml = html.slice(html.indexOf('</style>'));
const closeCount = (bodyHtml.match(/class="modal-btn-close"/g) || []).length;
ok('close buttons are present to check', closeCount >= 10, `found ${closeCount}`);

// For each ✕, walk backwards to the nearest opening tag carrying class `modal` (not
// `modal-overlay`, not `modal-btns`) and confirm one exists before the nearest preceding
// `modal-overlay`. If the overlay is closer, the button is a child of the overlay itself and
// the base rule would not reach it.
const orphans = [];
for (const m of bodyHtml.matchAll(/class="modal-btn-close"/g)) {
  const before = bodyHtml.slice(0, m.index);
  const lastModal   = Math.max(before.lastIndexOf('class="modal"'),
                               before.lastIndexOf('class="modal '),
                               before.lastIndexOf("class='modal'"),
                               before.lastIndexOf('class=\\"modal\\"'),
                               before.lastIndexOf("class=\\'modal\\'"));
  const lastOverlay = before.lastIndexOf('class="modal-overlay"');
  if (lastModal < lastOverlay) {
    const line = before.split('\n').length;
    orphans.push(`line ${line}`);
  }
}
ok('every `.modal-btn-close` is inside a `.modal`', orphans.length === 0,
   orphans.length ? `outside a .modal at: ${orphans.join(', ')}` : '');

// ── 5. a chooser with no Cancel must carry its weight on the ✕ ───────────────
//
// 2026-09-30, on being shown that backdrop and Escape were the exits: "if there's no way
// out except for clicking to the side or pressing escape, then we're also not telling the user
// how to get out... that is less intuitive."
//
// He is right, and the resolution is that the ✕ is the provision and the other two are the
// safety net. So for the narrow class of dialog where the ✕ is the ONLY visible exit — a choice
// of two or more actions with no Cancel and no Close in the footer — three things are required
// together, and this check exists to notice when a THIRD such dialog appears without them:
//   · `title="Cancel"`, not "Close" and not absent, so hover answers "is this a way out?"
//   · backdrop dismissal
//   · Escape
// If a new chooser shows up here, that is not a test failure to silence. It is the question
// "should this have a Cancel button instead?" arriving at the right moment.

// Slice each overlay by div depth rather than by "up to the next overlay" — the naive version
// runs past the last modal into the rest of the document and reads unrelated buttons as if they
// belonged to it, which makes a Cancel-less dialog look like it has a Cancel.
function modalBlocks(text) {
  const out = [];
  for (const m of text.matchAll(/<div class="modal-overlay"[^>]*id="([^"]+)"[^>]*>/g)) {
    let depth = 0, i = m.index, end = text.length;
    const tag = /<div\b|<\/div>/g;
    tag.lastIndex = m.index;
    let t;
    while ((t = tag.exec(text))) {
      depth += t[0] === '</div>' ? -1 : 1;
      if (depth === 0) { end = t.index + 6; break; }
    }
    out.push({ id: m[1], html: text.slice(i, end) });
  }
  return out;
}

const CANCEL_WORDS = /\b(cancel|close|done|not now|never mind|back)\b/i;
const blocks = modalBlocks(bodyHtml);
ok('modal blocks parsed', blocks.length >= 40, `found ${blocks.length}`);

// ⚠️ THE FIRST VERSION OF THIS PREDICATE WAS "any two non-Cancel buttons anywhere in the
// dialog", and it swept in the style detail view and the doc viewer — a working surface and a
// reader, whose buttons are TOOLS, not a choice, and whose ✕ is correctly titled "Close". A
// predicate that flags four dialogs when the thing it is describing has two is not measuring
// the thing. What actually distinguishes a chooser: its FOOTER offers two or more competing
// primary routes and no way to decline. Style detail's footer is five `.modal-btn-cancel`
// utilities; the doc viewer has no `.modal-btns` at all.
// ⚠️⚠️ THE WHOLE BLOCK, NOT THE FOOTER - AND THE FOOTER VERSION MISSED A REAL ONE.
// This read `class="modal-btns"` rows only, on the reasoning above that a chooser's competing
// routes live in its footer. On 2026-10-01 the Import Common Folder dialog traded its Cancel
// button for a ✕ and became exactly the class this guards - three primaries, no way to decline -
// and the predicate returned false before looking at a single button, because that dialog's
// buttons sit in `.sf-import-pick-row` and it no longer has a `.modal-btns` at all.
// ⭐ Same shape as the backdrop sweep that knew one spelling of an idiom: this encoded where
// these buttons USUALLY live rather than what makes a dialog a chooser.
// ⭐ MEASURED BEFORE BROADENING, NOT AFTER. Across all 42 modal blocks the whole-block form flags
// 3 where the footer form flagged 2; the difference is exactly that one dialog and nothing is
// lost. That measurement is why the working-surface control below still holds.
// ⚠️ The ✕ is excluded explicitly: it is the exit, never one of the competing routes, and counting
// it would make every two-primary dialog that has a close button look like one more.
function isChooser(b) {
  const btns = [...b.html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)]
    .map(m => ({ cls: m[1], text: m[2].replace(/<[^>]*>/g, '').replace(/&#\d+;/g, '').replace(/&\w+;/g, '').replace(/\s+/g, ' ').trim() }))
    .filter(x => !/\bmodal-btn-close\b/.test(x.cls));
  if (btns.some(x => CANCEL_WORDS.test(x.text))) return false;
  return btns.filter(x => /\bmodal-btn-primary\b/.test(x.cls)).length >= 2;
}
const choosers = blocks.filter(isChooser);

const EXPECTED = ['modal-new-config', 'modal-create-styles', 'modal-sf-common-import-chooser'];
ok('the set of Cancel-less choosers is unchanged',
   choosers.length === EXPECTED.length && choosers.every(c => EXPECTED.includes(c.id)),
   `found: ${choosers.map(c => c.id).join(', ') || '(none)'} — expected: ${EXPECTED.join(', ')}. `
   + 'A new one here needs title="Cancel" + backdrop + Escape, or a Cancel button.');

for (const c of choosers) {
  const closeTag = (c.html.match(/<button[^>]*class="modal-btn-close"[^>]*>/) || [''])[0];
  ok(`${c.id}: its ✕ is titled Cancel, not Close`,
     /title="Cancel"/.test(closeTag),
     `got: ${closeTag || '(no close button at all)'}`);
}

// Backdrop and Escape, matched against the whole file because the handlers live far from the
// markup. Both spellings of the backdrop idiom are accepted: a local variable and the
// spelled-out getElementById, which is what create-styles has always used — the version of this
// sweep that only knew the first spelling undercounted the app's backdrop modals twice.
for (const c of choosers) {
  const idRe = c.id.replace(/[-]/g, '\\-');
  const backdrop = new RegExp(`e\\.target === (overlay|ov|modal|document\\.getElementById\\('${idRe}'\\))`)
                     .test(html);
  ok(`${c.id}: dismisses on backdrop click`, backdrop);
  const region = html.slice(Math.max(0, html.indexOf(`'${c.id}'`)));
  ok(`${c.id}: cancels on Escape`,
     /key !== 'Escape'|key === 'Escape'/.test(region.slice(0, 60000)));
}

// ── controls: the checks must be able to fail ────────────────────────────────
// Each control reconstructs the defect in a copy of the real stylesheet and asserts the
// predicate flips. A check that cannot fail is not a check.
//
// ⚠️ These controls were WRONG on their first run, in a way worth leaving a note about: they
// edited `css` with a bare /\.modal\s*\{/, which matches the tail of `#modal-confirm .modal {`
// 240 lines earlier. Every "broken" stylesheet they built was therefore a stylesheet with the
// base rule fully intact, and all three reported a control that had not controlled anything.
// Locate the base rule by its boundary, then edit only inside it.
function baseRuleSpan(text) {
  const m = /(?:^|[\n};])\s*\.modal\s*\{/.exec(text);
  if (!m) return null;
  const open = text.indexOf('{', m.index);
  const close = text.indexOf('}', open);
  return { start: open + 1, end: close };
}
const span = baseRuleSpan(css);
ok('the base rule can be located for the controls', !!span);

// Edit the declarations of the base rule only, leaving the rest of the sheet byte-identical.
const editBase = fn => css.slice(0, span.start) + fn(css.slice(span.start, span.end)) + css.slice(span.end);
const baseOf = text => rules(text).filter(r => /(^|,\s*)\.modal(\s*,|$)/.test(r.sel));

ok('CONTROL the located span really is the base rule',
   /position:\s*relative/.test(css.slice(span.start, span.end).replace(/\/\*[\s\S]*?\*\//g, '')));

{
  // Strip position:relative from the base rule only — the exact pre-fix state.
  const broken = editBase(b => b.replace(/\/\*[\s\S]*?\*\//g, '').replace(/position:\s*relative;?/, ''));
  ok('CONTROL removing position:relative from `.modal` really removes it', broken.length < css.length);
  const b = baseOf(broken);
  ok('CONTROL the base-rule check fails on the pre-fix stylesheet',
     b.length > 0 && !b.some(r => /position:\s*relative/.test(r.body)));
}
{
  // A `.modal` rule that sets some other position must not satisfy the check.
  const fake = editBase(b => b.replace(/\/\*[\s\S]*?\*\//g, '').replace(/position:\s*relative/, 'position: static'));
  ok('CONTROL `position: static` does not pass as an anchor',
     !baseOf(fake).some(r => /position:\s*relative/.test(r.body)));
}
{
  // `position: relative` mentioned only inside a comment must not count. Not hypothetical: the
  // real base rule carries a comment that says those exact words, so if `rules()` ever stopped
  // stripping comments the main check above would pass on a stylesheet with no declaration.
  const commented = editBase(b => b.replace(/\/\*[\s\S]*?\*\//g, '')
                                   .replace(/position:\s*relative;?/, '/* position: relative; */'));
  ok('CONTROL a commented-out declaration does not pass',
     !baseOf(commented).some(r => /position:\s*relative/.test(r.body)));
}
{
  // A NEW Cancel-less chooser must be caught, and an ordinary dialog must not be. Both
  // directions, because the predicate was wrong in the permissive direction on its first run.
  const newOne = '<div class="modal-overlay" id="modal-fake-chooser"><div class="modal">'
    + '<div class="modal-btns"><button class="modal-btn-primary">Do A</button>'
    + '<button class="modal-btn-primary">Do B</button></div></div></div>';
  const withCancel = newOne.replace('id="modal-fake-chooser"', 'id="modal-fake-safe"')
    .replace('</div></div></div>', '<button class="modal-btn-cancel">Cancel</button></div></div></div>');
  const [fake] = modalBlocks(newOne);
  const [safe] = modalBlocks(withCancel);
  ok('CONTROL a new Cancel-less chooser is flagged', isChooser(fake));
  ok('CONTROL the same dialog with a Cancel is not flagged', !isChooser(safe));
  ok('CONTROL a working surface with utility buttons is not flagged',
     !isChooser(blocks.find(b => b.id === 'modal-style-detail')));
  // ⚠️ THE CASE THE OLD PREDICATE MISSED, pinned so the narrowing cannot come back. A chooser
  // whose buttons live outside a `.modal-btns` footer is still a chooser; the footer-only version
  // returned false on exactly this markup and let a Cancel-less dialog through unguarded.
  {
    const noFooter = '<div class="modal-overlay" id="modal-fake-nofooter"><div class="modal">'
      + '<button class="modal-btn-close" title="Cancel">&#10005;</button><h2>Pick one</h2>'
      + '<div class="some-other-row">'
      + '<button class="modal-btn-primary">Route A</button>'
      + '<button class="modal-btn-primary">Route B</button>'
      + '</div></div></div>';
    const [nf] = modalBlocks(noFooter);
    ok('CONTROL a chooser with no `.modal-btns` footer is still flagged', isChooser(nf));
  }
}
{
  // The orphan walk must notice a ✕ that is a direct child of an overlay.
  const bad = '<div class="modal-overlay" id="x">\n  <button class="modal-btn-close"></button>\n</div>';
  const before = bad.slice(0, bad.indexOf('class="modal-btn-close"'));
  ok('CONTROL the orphan walk flags a ✕ outside any `.modal`',
     Math.max(before.lastIndexOf('class="modal"'), before.lastIndexOf('class="modal '))
       < before.lastIndexOf('class="modal-overlay"'));
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
