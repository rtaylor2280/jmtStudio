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

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall progress detail clamp tests passed');
process.exit(failures ? 1 : 0);
