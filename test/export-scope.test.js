// A top-level function may not reach for a helper that lives inside a block.  [B-005 item 4]
//
// ⭐⭐ THE DEFECT THIS EXISTS TO KILL, and it had already been caught ONCE before it bit again.
// `_sfDeleteProgress` is declared inside `if (isElectron) { … }` in renderer/index.html, so it
// is block-scoped. `_sfPreflightDestination` is a top-level `async function`. On 2026-09-21 the
// shared preflight called it three times - to borrow the door's bar, to retitle it, and to take
// it down before a dialog - and every one of those was a ReferenceError.
//
// ⚠️⚠️ IT WAS SILENT, WHICH IS THE WHOLE PROBLEM. All three sat inside `try {} catch {}` written
// for a different reason ("a preflight that throws must not prevent an export"), so nothing
// logged and nothing broke loudly. What showed up instead were two unrelated-looking UI glitches:
// a progress bar that never animated, and an extra window appearing for a check that was already
// explained. Neither symptom pointed anywhere near scope.
//
// ⚠️⚠️ AND THE GUARD THAT EXISTED DID NOT COVER IT. test/export-outcome-shared.test.js already
// tests this exact class - by comparing INDENT LEVELS of `_sfExportOutcome`, the eject helpers,
// and the two helpers they call. It passed the whole time, because it checks A LIST OF NAMES
// that were the functions with the bug LAST time. A guard built around the previous instance is
// not a guard around the class. So this one checks the RELATIONSHIP instead: every reference,
// whoever makes it, including functions nobody has written yet.
//
// ⭐ His call is what widened it: "means we probably got this wrong on the other doors too."
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const FILE = path.join(__dirname, '..', 'renderer', 'index.html');

// ── The analysis ─────────────────────────────────────────────────────
//
// A top-level function runs in the file's outermost scope, so it can only see identifiers
// declared there. Anything declared at an indent - inside `if (isElectron)`, inside a DOM-ready
// callback - is invisible to it no matter how far up the file it appears.
//
// ⚠️ Only `_sf*` / `_sd*` helpers are checked. A general identifier sweep was the first cut and
// it reported 27,416 "violations": names like `depth`, `locked` and `tabBtn` are declared and
// re-declared all over a 46,000-line file, so the results were pure noise and would have been
// read as "this check does not work" rather than "this check is wrong". The prefixed helpers are
// the ones that are genuinely singular, which is what makes the answer trustworthy.
function outOfScopeRefs(src) {
  const L = src.split('\n');

  // Top-level functions: declared at column 0, closing at the next `}` at column 0.
  const fns = [];
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(?:async\s+)?function\s+([\w$]+)/);
    if (!m) continue;
    let j = i + 1;
    for (; j < L.length; j++) if (/^\}/.test(L[j])) break;
    fns.push({ name: m[1], s: i + 1, e: j + 1 });
  }

  // What a top-level function can legitimately see: anything declared at column 0.
  const topDecl = new Set();
  for (const s of L) {
    const m = s.match(/^(?:const|let|var)\s+([\w$]+)|^(?:async\s+)?function\s+([\w$]+)/);
    if (m) topDecl.add(m[1] || m[2]);
  }

  const viol = [];
  for (const f of fns) {
    for (let i = f.s; i < f.e; i++) {
      const raw = L[i - 1];
      if (/^\s*(\/\/|\*)/.test(raw)) continue;          // comments name these helpers constantly
      const hits = raw.match(/(?<![\w.$])_(?:sf|sd)[A-Za-z][\w]*/g);
      if (!hits) continue;
      for (const n of new Set(hits)) {
        if (topDecl.has(n)) continue;
        // ⭐ THE TWO LEGITIMATE WAYS TO CROSS THE BOUNDARY, and both are deliberate at the call
        // site rather than accidental: publish it on `window`, or guard with `typeof`. The
        // second is how the handful of pre-existing cross-boundary calls in this file are
        // written, and they are correct - a `typeof` guard cannot throw.
        if (new RegExp('window\\.' + n).test(raw)) continue;
        if (new RegExp('typeof\\s+' + n).test(raw)) continue;
        let local = false;
        for (let k = f.s; k < f.e; k++) {
          if (new RegExp('(?:const|let|var|function)\\s+' + n + '(?![\\w])').test(L[k - 1])) {
            local = true; break;
          }
        }
        if (local) continue;
        viol.push({ fn: f.name, line: i, name: n, src: raw.trim().slice(0, 100) });
      }
    }
  }
  return viol;
}

const H = fs.readFileSync(FILE, 'utf8');

// ── ⚠️⚠️ THE CHECKER PROVES ITSELF FIRST ──────────────────────────────
//
// A scope checker that reports zero is indistinguishable from a scope checker that is broken,
// and this file would be the second one to look green while the bug was live. So before its
// clean run means anything, it has to catch the ACTUAL defect: put the bare reference back into
// `_sfPreflightDestination` exactly as it was written this morning and confirm it is reported.
{
  const mutated = H.replace(
    'window._sfDeleteProgress.barEl();',
    '_sfDeleteProgress.barEl();');
  ok('the mutation actually applied (the anchor still exists)',
     mutated !== H,
     'the line was renamed - re-anchor this, do not delete the self-check');
  const caught = outOfScopeRefs(mutated)
    .some((v) => v.name === '_sfDeleteProgress' && v.fn === '_sfPreflightDestination');
  ok('⚠️⚠️ it catches the real defect when reintroduced',
     caught,
     'a green run below would mean nothing - this is the case it was written for');
}

// ── The file as it stands ────────────────────────────────────────────
{
  const viol = outOfScopeRefs(H);
  ok(`no top-level function reaches a block-scoped helper (${viol.length} found)`,
     viol.length === 0,
     viol.map((v) => `${v.fn}() line ${v.line} -> ${v.name}  |  ${v.src}`).join('\n       '));
}

// ── The specific crossing that caused it, pinned ─────────────────────
//
// ⚠️ The general check above would go quiet if someone deleted the `window.` publication AND
// every use in one go. This names the arrangement so the intent survives.
ok('_sfDeleteProgress is published on window for the shared preflight',
   /window\._sfDeleteProgress = _sfDeleteProgress;/.test(H),
   'the preflight is top-level and cannot see the declaration inside if (isElectron)');
ok('and the shared preflight reaches it through window',
   /window\._sfDeleteProgress\.hideNow\(\)/.test(H)
   && /window\._sfDeleteProgress\.barEl\(\)/.test(H),
   'a bare reference there is the ReferenceError this file exists to prevent');

console.log(failed ? `\n${failed} FAILED` : '\nexport-scope: all passing');
process.exit(failed ? 1 : 0);
