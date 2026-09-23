// Nothing in the renderer may be defined without a caller.
//
// ⭐⭐ WHY THIS EXISTS. 2026-09-23 swept `renderer/index.html` for `_sf` / `_sd` / `_export`
// definitions with zero non-comment references and found EIGHT. They were not equally harmless:
//
//   • `_sfWarnSlowWrite`  - the old per-door slow-write warner. Its last caller left when door 1
//                           joined the export runner, and THREE assertions in preflight-busy
//                           were checking its internals the whole time. Green over a corpse.
//   • `_sfFmtSpace`       - a non-breaking-space formatter stranded the previous day, whose
//                           deletion exposed that the two LIVE formatters were doing
//                           `.replace(' ', ' ')` - a plain space for a plain space, a no-op.
//   • `_sdBusyProgress`   - written for his catch "showing indeterminate when it is
//                           determinable" and never wired. The whole chain behind it - an IPC
//                           emit in main, a preload bridge - was complete with no subscriber,
//                           so the fix for a defect he reported had never once run.
//   • `_sdRenderText`     - a second implementation of the card's text viewer, with its own copy
//                           of the config test and its own "Open in editor" button.
//
// ⚠️ The pattern is not "dead code is untidy". It is that a definition with no caller reads as a
// feature that exists, so the thing it was supposed to fix stays broken while looking handled -
// and a test can keep it alive indefinitely. His reason for fixing rather than filing:
// "I don't like the idea of continuing to code and test against a moving target even with dead
// code since the validation is that nothing is broken."
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'renderer', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// ⚠️ COMMENTS STRIPPED BEFORE COUNTING REFERENCES. A name that survives only in prose - in the
// very comment explaining why it was deleted - is not a caller. Getting this wrong makes the
// check permanently green, which is the failure mode that matters here.
const findOrphans = (text) => {
  const lines = text.split('\n');
  const code = lines.map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\/\/.*$/, ''));
  const defRe = /^\s*(?:const|let|var|async function|function)\s+(_sf[A-Za-z0-9_]+|_sd[A-Za-z0-9_]+|_export[A-Za-z0-9_]+)\b/;
  const defs = new Map();
  lines.forEach((l, i) => {
    const m = l.match(defRe);
    if (m && !defs.has(m[1])) defs.set(m[1], i + 1);
  });
  const orphans = [];
  for (const [name, defLine] of defs) {
    let refs = 0;
    const re = new RegExp('\\b' + name + '\\b', 'g');
    code.forEach((l, i) => {
      if (i + 1 === defLine) return;
      const hits = (l.match(re) || []).length;
      if (!hits) return;
      // `window.x = x` is an export, not a use. A thing exported and never called is still an
      // orphan - that is precisely how `_sfWarnSlowWrite` looked wired for weeks.
      if (new RegExp('window\\.' + name + '\\s*=').test(l)) return;
      refs += hits;
    });
    if (refs === 0) orphans.push({ name, defLine });
  }
  return orphans;
};

const orphans = findOrphans(src);
ok(`no renderer helper is defined without a caller (found ${orphans.length})`,
   orphans.length === 0,
   orphans.map((o) => `${o.name} @ line ${o.defLine}`).join(', ')
   + ' — either wire it or delete it. A definition nobody calls reads as a working feature.');

// ── ⚠️⚠️ AND THE CHECK PROVES IT CAN FAIL ────────────────────────────
// A sweep that reports zero is indistinguishable from a sweep that cannot see anything. Inject
// a function nobody calls and confirm it is caught.
{
  const mutated = src.replace('function _sdBusyText(text) {',
    'function _sdOrphanCanary(x) { return x; }\nfunction _sdBusyText(text) {');
  ok('the mutation was applied', mutated.length !== src.length,
     'anchor moved - the control below proves nothing without it');
  const caught = findOrphans(mutated).some((o) => o.name === '_sdOrphanCanary');
  ok('⚠️⚠️ an injected uncalled function IS caught', caught,
     'the sweep cannot see an orphan, so its clean result means nothing');
}

console.log(failed ? `\nrenderer-orphans: ${failed} failing` : '\nrenderer-orphans: all passing');
process.exit(failed ? 1 : 0);
