// A door may not choose which surface the user sees.  [B-420]
//
// ⭐⭐ WHY THIS EXISTS, AND IT IS EVIDENCE RATHER THAN CAUTION. Backup was the first door
// migrated onto the shared export runner, and the one written most carefully. In one evening it
// handed the runner wrong data THREE times:
//
//   • `ok: false` on a cancel      -> "Export failed: unknown error" for the user's own click
//   • a temp path in `leftovers`   -> a modal instead of a toast, saying nothing about why
//   • `alreadyOpen` assumed true   -> a 7 GB export with no bar and no Cancel button
//
// ⚠️⚠️ NOT ONE OF THEM THREW, AND NOT ONE FAILED A TEST. Each merely changed WHICH SURFACE
// appeared, and all three were found by clicking. That is the defect class this file guards: a
// door is free to be wrong about what it did, and the runner must not pass that wrongness
// through to the screen.
//
// ⭐ The rule for adding to this file: every assertion must trace to a SURFACE. If a normalised
// field cannot change what the user sees, it does not belong in the guard or in here.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const FILE = path.join(__dirname, '..', 'renderer', 'index.html');
const H = fs.readFileSync(FILE, 'utf8');

// ⚠️ Anchored between two markers, never a character count. A fixed-width slice over this file
// has silently stopped covering its target three times (most recently in
// backup-refusal-impound, which sliced 14,000 chars and broke when a door was migrated).
const runner = (() => {
  const i = H.indexOf('const _sfRunExport = async (door');
  const j = H.indexOf('// Convenience for the export+delete sequence', i);
  return (i > 0 && j > i) ? H.slice(i, j) : '';
})();
ok('the runner was located', runner.length > 0,
   're-anchor this if _sfRunExport or the comment after it is renamed');

// ── The six rules, each tied to the surface it protects ──────────────
const RULES = [
  ['a cancel is forced to ok:true',
   /if \(res\.canceled\) res\.ok = true;/,
   '_sfExportOutcome tests !ok BEFORE canceled, so ok:false renders a deliberate cancel as a '
   + 'red "Export failed: unknown error"'],

  ['the iterated fields are coerced to arrays',
   /for \(const k of \['leftovers', 'failed', 'refused', 'written'\]\)/,
   'each is length-tested or iterated to pick a surface; a bare string would count as one item '
   + 'and flip modal-vs-toast, and null would throw inside the notice'],

  ['leftovers is filtered to NAMED, actionable items',
   /res\.leftovers = res\.leftovers\.filter\(/,
   'leftovers decides modal-vs-toast on a cancel, but the notice only renders ORIGINAL./DELETE. '
   + 'names — a temp path forced a modal that then explained nothing'],

  ['⚠️⚠️ an unconfirmed teardown may not claim a clean finish',
   /if \(res\.teardownIncomplete\) \{[\s\S]{0,200}?res\.partialRemoved = false;[\s\S]{0,120}?res\.restored = false;/,
   'his catch: "we said it was done but it wasn\'t which means that if they then wanted to safe '
   + 'eject the board they couldn\'t" — a false all-clear on a card someone may then pull'],

  ['the cleanup offer is gated on the board card',
   /if \(res\.offerCleanup && !pf\.boardCard\) res\.offerCleanup = null;/,
   'offering a slow-cleanup choice where cleanup is not slow is a question with no purpose'],

  ['the sentence-gating booleans are coerced',
   /for \(const k of \['canceled', 'ok', 'restored', 'partialRemoved', 'teardownIncomplete'\]\)/,
   'a door handing back a path or a count would assert a headline it never meant'],
];
for (const [name, re, why] of RULES) ok(name, re.test(runner), why);

// ── ⚠️ ORDER: normalise BEFORE reading ──────────────────────────────
// Normalising after the reads would leave `out.ok` false on a cancel and still report a failure
// — the guard would be present, correct, and useless.
{
  const norm = runner.indexOf('if (res.canceled) res.ok = true;');
  const read = runner.indexOf('out.ok = !!(res && res.ok)');
  ok('⚠️ the guard runs before the runner reads the result',
     norm > 0 && read > norm,
     'a guard that runs after the read changes nothing the user can see');
}

// ── ⚠️ AND THE GUARD MUST NOT BE THE ONLY COPY OF THE RULE ──────────
// `_sfExportStoppedNotice` also decides modal-vs-toast from `leftovers`. It filters to named
// leftovers itself, deliberately: the guard protects doors that go through the runner, and this
// protects the notice from any caller that does not. Two independent checks of one rule is
// correct here — the failure mode is a false all-clear, and belt-and-braces is cheap.
ok('the stopped notice independently filters leftovers',
   /const _namedLeftovers = \(leftovers \|\| \[\]\)\.filter\(/.test(H),
   'the notice is reachable from callers that never touched the runner');

// ── A DOOR THAT DECLARES A SUMMARY MUST ACTUALLY DRAW ONE ────────────
//
// ⭐⭐ `ending: 'summary'` IS A DECLARATION, NOT A RENDERER. `_sfExportOutcome` does not draw a
// summary — it calls the door's `onCompleted` and lets the door draw its own ending. So a door
// can resolve to 'summary' and then show a toast, and nothing anywhere objects.
//
// ⚠️⚠️ THIS HAS NOW HAPPENED TWICE, IN THE SAME POSITION, ON CONSECUTIVE DAYS:
//   2026-09-21  common-as-zip declared a summary and drew nothing. His report: "there was also
//               no summary on it..."
//   2026-09-22  the font card declared a summary and drew a TOAST. His report: "on first test of
//               it, it came through as a toast".
//
// The runner already guards the first shape - a declared summary with no `onCompleted` degrades
// to a toast rather than to silence. That guard cannot see the second shape, because the
// `onCompleted` exists; it just draws the wrong thing. This check closes that.
//
// ⭐ His rule, 2026-09-21, is what decides which doors are in scope: "2,5,7,9 toast and all
// others summary. so the rule is file selection right click." The funnel doors carry
// `kind: 'files'`, which `_sfExportEnding` maps to a toast. Everything else owes a summary.
{
  // Brace-match each call so a door is never mis-measured by a fixed-width window.
  const doorCalls = [];
  const re = /await _sfRunExport\(\{/g;
  let m;
  while ((m = re.exec(H))) {
    let i = m.index + m[0].length - 1, depth = 0;
    do {
      if (H[i] === '{') depth++;
      else if (H[i] === '}') depth--;
      i++;
    } while (i < H.length && depth > 0);
    const body = H.slice(m.index, i);
    const kind = (body.match(/endState:\s*\{\s*kind:\s*'([^']+)'/) || [])[1] || 'tree';
    const override = (body.match(/\n\s*ending:\s*'([^']+)'/) || [])[1] || null;
    // ⚠️ THE DOOR'S OWN TITLE IS THE FIRST ONE, WHICHEVER QUOTE IT USES. Trying single quotes
    // across the whole body first picked up `title: 'Export complete'` from the
    // `_sfCompletionNotice` call NESTED INSIDE the door - so two different doors both reported
    // as "Export complete" and a failure would have named the wrong one. Order by position.
    const _t = [/title:\s*'([^']*)'/, /title:\s*`([^`]*)`/]
      .map((rx) => body.match(rx))
      .filter(Boolean)
      .sort((a, b) => a.index - b.index)[0];
    const title = (_t && _t[1]) || '(untitled)';
    doorCalls.push({ title, kind, override, body,
                     line: H.slice(0, m.index).split('\n').length });
  }
  ok('door call sites were located', doorCalls.length >= 3,
     `found ${doorCalls.length}; re-check the brace matcher if this dropped`);

  for (const d of doorCalls) {
    const ending = d.override || (d.kind === 'files' ? 'toast' : 'summary');
    if (ending !== 'summary') continue;
    // ⚠️ TWO SUMMARY SURFACES ARE LEGITIMATE, and the first cut of this rule knew about only
    // one. `_sfCompletionNotice` is the short one the archive and folder doors use;
    // `_sfShowExportSummary` is the full one with per-kind counts that tracks and the primary
    // export use. Both carry the eject row, which is what the rule actually cares about. A
    // check that names one implementation rejects the other for no reason.
    ok(`"${d.title}" (index.html:${d.line}) draws the summary it declares`,
       /_sfCompletionNotice\(|_sfShowExportSummary\(/.test(d.body),
       'its ending resolves to `summary`, but `_sfExportOutcome` only calls onCompleted - the '
       + 'door has to draw it. Without _sfCompletionNotice this door shows a toast, or nothing, '
       + 'while reporting itself as a summary door (and suppressing the eject row with it)');
    // ⚠️ AND THE EJECT ROW GOES WITH IT. A summary door that omits `summaryHasEject` gets a
    // SECOND eject offer as a toast, which is the parallel surface he ruled out: "the eject
    // shouldn't be its own modal. It should take place on the summary screen."
    ok(`  and declares summaryHasEject so the eject is not offered twice`,
       /summaryHasEject:\s*true/.test(d.body),
       'the during-export checkbox clicks the summary row; without this flag a toast eject '
       + 'fires as well');
  }
}

// ── ⚠️⚠️ THE TEST PROVES ITSELF ─────────────────────────────────────
//
// A guard test that reports green is indistinguishable from a guard test that cannot see. Every
// rule above is re-checked against a mutated copy with that rule deleted, and must fail.
{
  let caughtAll = true;
  const misses = [];
  for (const [name, re] of RULES) {
    const m = runner.match(re);
    if (!m) { misses.push(`${name} (not present to mutate)`); caughtAll = false; continue; }
    const mutated = runner.replace(m[0], '/* removed by mutation test */');
    if (re.test(mutated)) { misses.push(`${name} (survived removal)`); caughtAll = false; }
  }
  ok(`⚠️⚠️ every rule's assertion fails when that rule is removed (${RULES.length} checked)`,
     caughtAll,
     misses.join('; ') || 'a rule whose assertion survives its own deletion asserts nothing');
}

console.log(failed ? `\n${failed} FAILED` : '\nexport-contract-guard: all passing');
process.exit(failed ? 1 : 0);
