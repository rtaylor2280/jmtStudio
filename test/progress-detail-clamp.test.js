/**
 * The progress detail line cannot wrap  [B-293]
 *
 * 2026-09-02, watching a 136-font analyze: "note that there are some that force 2
 * lines... not supposed to be possible and I know we fixed it in other areas with
 * similar reading.... supposed to truncate at a point so it doesn't wrap." The modal
 * visibly grew taller for long paths — the exact vertical jump the one-line rule
 * exists to prevent.
 *
 * ⭐⭐ THE CAUSE, AND IT READS AS IMPOSSIBLE UNTIL YOU LOOK AT THE SHORTHANDS.
 * `.sf-import-progress-detail` already carried `white-space: nowrap`. What beat it:
 *
 *     .modal p                   -> text-wrap: balance   => text-wrap-mode: wrap
 *     .sf-import-progress-detail -> white-space: nowrap  => text-wrap-mode: nowrap
 *
 * `white-space` and `text-wrap` are BOTH shorthands for `text-wrap-mode`, and
 * `.modal p` (0,1,1) outranks a bare class (0,1,0). So the more specific rule won the
 * longhand and switched wrapping back on. Nothing was missing; two shorthands were
 * fighting over one longhand that neither of their names mentions.
 *
 * ⚠️ THE OLD EXPLANATION WAS INVENTED. A comment on the backup modal's override blamed
 * `word-break: break-all` on the shared class. That property is not there and was not
 * then. The entry flagged the note as partly stale; the specificity half was right, the
 * word-break half was a guess that read as a finding for months.
 *
 * ⭐ AND THE FIX IS NOT A THIRD !important BLOCK. Two modals had needed the same clamp
 * on the same class; a third would have. One rule that wins on specificity, and the
 * per-modal override deleted rather than left to drift.
 *
 * Run: node test/progress-detail-clamp.test.js
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

// Specificity of a simple selector, as (ids, classes, elements).
const spec = (sel) => {
  const ids      = (sel.match(/#[\w-]+/g) || []).length;
  const classes  = (sel.match(/\.[\w-]+/g) || []).length;
  const elements = (sel.replace(/[#.][\w-]+/g, '').match(/\b[a-z]+\b/g) || []).length;
  return [ids, classes, elements];
};
const beats = (a, b) => {
  const x = spec(a), y = spec(b);
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
  return false;
};

// ── the conflict is real ───────────────────────────────────────────────────
{
  const modalP = html.match(/^\s*\.modal p\s*\{[^}]*\}/m);
  ok('.modal p still exists', !!modalP);
  ok('and it still sets text-wrap: balance', /text-wrap:\s*balance/.test(modalP[0]), modalP[0]);
  ok('.modal p outranks the bare class', beats('.modal p', '.sf-import-progress-detail'),
     `${spec('.modal p')} vs ${spec('.sf-import-progress-detail')}`);
}

// ── the fix wins honestly ──────────────────────────────────────────────────
{
  const clamp = html.match(/\.modal p\.sf-import-progress-detail \{[^}]*\}/);
  ok('the shared clamp exists', !!clamp);
  ok('it beats .modal p on specificity',
     beats('.modal p.sf-import-progress-detail', '.modal p'),
     `${spec('.modal p.sf-import-progress-detail')} vs ${spec('.modal p')}`);
  ok('it uses NO !important', !/!important/.test(clamp[0]), clamp[0]);
  ok('it sets the longhand in conflict explicitly',
     /text-wrap:\s*nowrap/.test(clamp[0]),
     'naming text-wrap here is what makes the fight visible to the next reader');
  ok('it still clamps and ellipsises',
     /white-space:\s*nowrap/.test(clamp[0]) && /overflow:\s*hidden/.test(clamp[0])
     && /text-overflow:\s*ellipsis/.test(clamp[0]), clamp[0]);
}

// ── the duplicate override is gone ─────────────────────────────────────────
{
  ok('the backup modal no longer overrides this class',
     !/#modal-sf-backup-progress \.sf-import-progress-detail \{/.test(html),
     'two copies of one rule is how they drift apart');

  // ⚠️ The element-name clamp beside it is a DIFFERENT class and is out of scope; it
  // must survive, or the backup modal's item-name line starts wrapping instead.
  ok('the backup item-name clamp is untouched',
     /#modal-sf-backup-progress \.sf-backup-progress-item-name \{/.test(html));

  ok('the invented word-break explanation is corrected',
     !/global \.sf-import-progress-detail rule sets\s*\n?\s*word-break: break-all/.test(html),
     'that property is not on the class and never was');
  ok('the class genuinely has no word-break',
     !/\.sf-import-progress-detail \{[^}]*word-break/.test(html));
}

// ── both progress lines use the class ──────────────────────────────────────
{
  ok('the bulk detail line carries the class',
     /<p class="sf-import-progress-detail" id="sf-bulk-import-prog-detail">/.test(html));
  ok('and it is a <p>, which the clamp requires',
     /<p class="sf-import-progress-detail"/.test(html),
     'matching the element is how the rule outranks .modal p without !important');
}

// ── ⭐⭐ IT MUST BE STRUCTURALLY IMPOSSIBLE, NOT CONVENTIONALLY AVOIDED ─────
//
// His rule, 2026-09-16: "I don't understand why a line that is supposed to show files
// flying by would ever want to wrap. that shouldn't be possible and always truncate."
//
// ⚠️ THE POINT IS "SHOULDN'T BE POSSIBLE". Everything above proves the clamp is correct
// TODAY. It cannot prove the next rule someone writes will not silently undo it — which
// is exactly how this happened TWICE: `.modal p` beat the bare class in the bulk modal,
// and an ID rule beat the shared clamp in the backup modal. Both were written by someone
// who had no idea they were touching a wrap guarantee.
//
// So this block asserts the property rather than the fix: NOTHING in the stylesheet that
// could match one of these elements may re-enable wrapping.
{
  // Every element that streams a name past the user. Enumerated from the markup rather
  // than remembered — a tenth one added later joins this list automatically.
  // ⚠️ ATTRIBUTE ORDER IS NOT A CONTRACT. The first version of this matched
  // `<p class="..." ... id="...">` and silently missed the two elements that write id
  // FIRST (sf-bulk-progress-detail / -elapsed), reporting 9 of 10 while looking
  // exhaustive. Ryan caught the shape of it: "not sure those are the only way to get
  // that progress bar type". Match the TAG, then read its attributes in any order.
  const streamers = [...html.matchAll(/<p\b([^>]*)>/g)]
    .map(m => m[1])
    .filter(a => /class="[^"]*\b(sf-import-progress-detail|sf-backup-progress-item-name)\b/.test(a))
    .map(a => ({
      cls: (a.match(/class="([^"]*)"/) || [, ''])[1],
      id:  (a.match(/id="([\w-]+)"/)   || [, ''])[1],
    }))
    .filter(s => s.id);
  ok('every streaming line is enumerable from the markup', streamers.length >= 10,
     `${streamers.length} found - a drop here means an element stopped carrying the class ` +
     'or started writing its attributes in an order this no longer reads');
  ok('⭐ and the count is attribute-order independent',
     streamers.some(s => s.id === 'sf-bulk-progress-detail'),
     'that element writes id before class; requiring class-first missed it');
  ok('⭐ and every one of them is a <p>', streamers.length > 0,
     'the shared clamp is `.modal p.<class>` - a div would not match it and would wrap');

  // Properties that turn wrapping back on, in any of the spellings that reach the same
  // longhand. `text-wrap: balance` is the one that caused this and looks harmless.
  const WRAPPY = /(white-space\s*:\s*(normal|pre-wrap|pre-line|break-spaces))|(text-wrap\s*:\s*(balance|wrap|pretty))|(-webkit-line-clamp\s*:\s*[2-9])|(overflow-wrap\s*:\s*(break-word|anywhere))|(word-break\s*:\s*break-all)/i;

  // Every rule in the stylesheet, as selector + body.
  const rules = [...html.matchAll(/([^{}@\/]+)\{([^{}]*)\}/g)]
    .map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }))
    .filter(r => r.sel && !r.sel.startsWith('*') && r.body.includes(':'));

  const CLAMP = '.modal p.sf-import-progress-detail';
  const ids = new Set(streamers.map(s => s.id));

  // ⚠️ WHICH MODALS ACTUALLY HOLD ONE. A `.modal p` rule scoped to a modal with no
  // streaming line cannot reach these elements, and counting it makes the check cry
  // wolf: `#modal-confirm .modal p { text-wrap: wrap }` is legitimate and beats the
  // clamp on specificity, but that modal has no progress line in it. Derived from the
  // markup rather than listed, so a streaming line added to a new modal is covered.
  const owners = new Set(streamers.map(s => {
    const at = html.indexOf('id="' + s.id + '"');
    const seen = html.slice(0, at).match(/id="(modal-[\w-]+)"/g) || [];
    return seen.length ? seen[seen.length - 1].slice(4, -1) : '';
  }).filter(Boolean));
  ok('the modals holding a streaming line are known', owners.size >= 3,
     [...owners].join(', '));

  // A rule is DANGEROUS if it re-enables wrapping AND can actually reach one of these
  // elements: by naming its id, by naming its class, or by matching `p` inside one of
  // the owning modals — including an UNSCOPED `.modal p`, which reaches all of them.
  const dangerous = rules.filter(r => {
    if (!WRAPPY.test(r.body)) return false;
    if ([...ids].some(id => r.sel.includes('#' + id))) return true;
    if (/sf-import-progress-detail|sf-backup-progress-item-name/.test(r.sel)) return true;
    return r.sel.split(',').some(part => {
      if (!/\.modal\b[^,]*\bp\b/.test(part)) return false;
      const scope = part.match(/#(modal-[\w-]+)/);
      return !scope || owners.has(scope[1]);
    });
  });

  const unbeaten = dangerous.filter(r => r.sel !== CLAMP && !beats(CLAMP, r.sel));

  ok('⭐⭐ no rule that could reach these elements re-enables wrapping unbeaten',
     unbeaten.length === 0,
     unbeaten.map(r => `${r.sel}  ->  ${r.body.trim().slice(0, 90)}`).join('\n      '));

  // And name the ones that DO re-enable it but lose, so the next reader sees the fight
  // rather than rediscovering it.
  const beaten = dangerous.filter(r => beats(CLAMP, r.sel));
  ok('the known conflicts are all outranked by the clamp', beaten.length >= 1,
     `${beaten.length} rule(s) re-enable wrapping and are beaten: ` +
     beaten.map(r => r.sel).join(', '));

  // ⚠️ The specific regression that shipped: an ID rule clamping the backup detail to
  // two lines. An ID beats the clamp on specificity, so nothing above would have saved
  // it - only not writing it does.
  ok('⭐ no ID rule clamps a streaming line to multiple lines',
     ![...ids].some(id => new RegExp('#' + id + '\\s*\\{[^}]*line-clamp\\s*:\\s*[2-9]').test(html)),
     'an ID outranks the shared clamp, so this can only be prevented by not existing');
}

// ── ⭐ THE LABEL ABOVE THE DETAIL LINE IS THE SAME BUG ─────────────────────
//
// His scoping call, 2026-09-16: "it's all part of the same thing to me. it's the exact
// bug I reported. Just because the cause is broader than the initial finding doesn't
// make it another finding." The label streams names in seven places and had NO clamp at
// all — so the element one line above the fixed one still wrapped and still grew the
// modal, which is the symptom he originally reported.
//
// ⚠️ A PLAIN ELLIPSIS WOULD HAVE BEEN THE WRONG FIX. Four of those labels put the count
// or the byte metric AFTER the name — "Copying <name> · 3 of 8" — so truncating the line
// eats the part being read. Hence the parts form: only the name shrinks.
{
  const labelCss = html.match(/\.sf-import-progress-label \{[^}]*\}/);
  ok('the label clamps when written as plain text', !!labelCss
     && /white-space:\s*nowrap/.test(labelCss[0])
     && /text-overflow:\s*ellipsis/.test(labelCss[0]), labelCss && labelCss[0]);

  const partsName = html.match(/\.sf-import-progress-label\.has-parts > \.sf-prog-label-name\s*\{[^}]*\}/);
  ok('the parts form exists and only the NAME shrinks', !!partsName
     && /flex:\s*0 1 auto/.test(partsName[0])
     && /text-overflow:\s*ellipsis/.test(partsName[0]), partsName && partsName[0]);
  ok('⭐ and min-width: 0 is on it', !!partsName && /min-width:\s*0/.test(partsName[0]),
     'without it a flex item refuses to shrink below its content and the row overflows');

  const partsFixed = html.match(/\.sf-import-progress-label\.has-parts > \.sf-prog-label-fixed\s*\{[^}]*\}/);
  ok('the fixed segments hold their width', !!partsFixed && /flex:\s*0 0 auto/.test(partsFixed[0]),
     'the count must survive when the name is truncated');

  // ⚠️ THE ONE THAT ACTUALLY PREVENTS THE REGRESSION: no raw write to the bulk label.
  // A textContent assignment both skips the parts form AND leaves `has-parts` behind
  // from a previous call, turning the row into one unshrinkable flex item.
  ok('⭐⭐ nothing writes the bulk label with raw textContent',
     !/els\.progLabel\.textContent\s*=/.test(html),
     'every write goes through setProgLabel or setProgLabelPlain');

  ok('the name is built as a DOM node, not interpolated HTML',
     /s\.textContent = text;/.test(html) && !/sf-prog-label-name">\$\{/.test(html),
     'the name is user data off a card; innerHTML here is an injection waiting to happen');

  ok('the plain helper clears the parts class',
     /setProgLabelPlain[\s\S]{0,160}classList\.remove\('has-parts'\)/.test(html),
     'a lingering has-parts leaves the next plain label as one unshrinkable item');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall progress detail clamp tests passed');
process.exit(failures ? 1 : 0);
