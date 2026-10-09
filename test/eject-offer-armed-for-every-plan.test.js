// The bulk import's eject offer is armed for EVERY plan shape, not only the ones that analyze.
//
// One lookup decides two controls: `showPhase` gates the mid-import eject checkbox on
// `ejectOffer.available`, and `syncSummaryEjectRow` gates the summary's eject row on the same
// field. So a plan that never arms the offer loses both, and the user sees an import off a card
// that never once offers to release it.
//
// That is what happened on 2026-10-06 to door 9, "Import as common folder". The arming lived
// inside `_runAnalyze`, and a common-folders-only plan skips the analyze entirely - the analyze
// gate is `if (total > 0 || _hasTracks)`, and a common-only plan satisfies neither. The report was
// both faces of it at once: "missing the eject" and "no eject and no check box during import".
//
// The slow-import warning had already been moved out of that same gate for the same reason, and
// its comment states the principle: a plan that skips the analyze is still an import off the same
// slow card. Removability is a fact about the FOLDER, so the question belongs where the folder is
// known, not where the analysis happens to run.
//
// The register had even predicted the hazard - door 9 is filed as "routes to the bulk runner as a
// common-only plan, which SKIPS the analyze" - and nothing checked what skipping cost. This is
// that check.

'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'renderer', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}

// The predicate, run against a copy of the source so the control below can drive it with a
// deliberately broken one. It never touches the file on disk.
const GATE = 'if (total > 0 || _hasTracks) {';
function armedBeforeAnalyzeGate(code) {
  const call = code.indexOf('armEjectOffer(plan.rootDir');
  const gate = code.indexOf(GATE);
  if (call < 0 || gate < 0) return { okay: false, why: 'call or gate not found', call, gate };
  if (call > gate) return { okay: false, why: 'the arming sits after the analyze gate', call, gate };
  return { okay: true, call, gate };
}

// ── The arming exists and is reachable without analyzing ─────────────────────
ok('armEjectOffer is defined', /const armEjectOffer = \(root\) =>/.test(src),
   'the helper both callers depend on');

const verdict = armedBeforeAnalyzeGate(src);
ok('the offer is armed BEFORE the analyze gate', verdict.okay,
   `${verdict.why || ''} - a plan that skips the analyze (common-only) would get no eject offer, `
   + 'which costs the mid-import checkbox and the summary row together');

// Exactly one call site. A second one is not harmless: arming resets `available` to false before
// the lookup resolves, so a late second call can blank an offer the first one already made. The
// definition reads `const armEjectOffer = (root) =>` and carries no parenthesis after the name, so
// every match here is a call.
const calls = (src.match(/armEjectOffer\(/g) || []).length;
ok('it is armed from exactly one place', calls === 1,
   `found ${calls} call sites - each one resets the offer, so a second call can blank a live one`);

// ── And it sits in the stretch that every plan shape runs ────────────────────
// Between the slow-import warning and the analyze gate. Pinned to those two landmarks rather than
// to a brace-matched function body: this file's comments and template literals contain braces, so
// a counted body is not trustworthy here, and the landmarks say the actual requirement anyway.
{
  const warned = src.indexOf('bulkSlowWarned = true;');
  const call = src.indexOf('armEjectOffer(plan.rootDir');
  const gate = src.indexOf(GATE);
  ok('both landmarks were located', warned > 0 && gate > warned,
     `warned@${warned} gate@${gate}`);
  ok('the arming sits between the slow warning and the analyze gate',
     warned > 0 && call > warned && call < gate,
     'that stretch is the only code every plan shape runs - a common-only plan reaches it and '
     + 'then skips the analyze entirely');
}

// ── And the analyze no longer resolves the lookup itself ─────────────────────
{
  const i = src.indexOf('const _runAnalyze = async (plan) =>');
  const gate = src.indexOf(GATE);
  const body = (i >= 0 && gate > i) ? src.slice(i, gate) : '';
  ok('the analyze body was located', body.length > 400, `${body.length} chars`);
  ok('it does not resolve an eject context inline', !/_sfEjectContext\(/.test(body),
     'a second inline copy of the lookup would drift from the helper, and putting it back here is '
     + 'exactly the defect this test exists for');
}

// ── Both consumers still depend on the field, or this test guards nothing ────
ok('the mid-import checkbox is gated on the offer',
   /phase === 'progress' && unattended && ejectOffer\.available/.test(src),
   'if this stops reading `available`, the arming is no longer what decides the checkbox');
ok('the summary row is gated on the offer',
   /if \(!ejectOffer\.available \|\| !ejectOffer\.target\) return;/.test(src),
   'if this stops reading `available`, the arming is no longer what decides the row');

// ── ⚠️ THE CONTROL: the check must be able to fail ───────────────────────────
// A source scan that reports clean is indistinguishable from one that cannot see its subject.
// Reintroduce the original defect - the arming only inside the analyze, i.e. after the gate - in a
// COPY of the source, and confirm the predicate rejects it.
{
  const broken = src.replace(/\n *armEjectOffer\(plan\.rootDir \|\| null\);/,
    '\n    // moved back inside the analyze')
    .replace(GATE, GATE + '\n      armEjectOffer(plan.rootDir || null);');
  ok('the mutation was applied', broken !== src,
     'anchor moved - the control below proves nothing without it');
  ok('⚠️ arming only after the analyze gate IS rejected', !armedBeforeAnalyzeGate(broken).okay,
     'the predicate cannot see the original defect, so its clean verdict means nothing');
}

console.log('');
console.log(fail === 0
  ? `eject-offer-armed-for-every-plan: all ${pass} checks passed`
  : `eject-offer-armed-for-every-plan: ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
