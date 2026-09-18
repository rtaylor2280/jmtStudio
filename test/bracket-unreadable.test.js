// [B-381] "I could not read it" must not be spelled the same as "it is fine".
//
// _findBracketError returned null for BOTH "the expression parsed and its brackets balance" and
// "this text is not a `using` declaration at all". Two callers coerce the result to a boolean, so
// unparseable text read as clean and the control it gates went ahead.
//
// ⚠️⚠️ THE ASYMMETRY IS THE ARGUMENT, and it is why this is a bug rather than a tidy-up. A false
// "there is an error" costs an annoyed user who can see their style is fine. A false "no error"
// costs a compile — and it is the answer that LOOKS like the check ran. [B-378] proved that class
// hides for months: the defect there was not that the check was wrong, it was that it was absent
// and said nothing.
//
// ⭐ HIS RULE, 2026-09-18, simpler than the entry's framing: "shouldn't even be able to get rid of
// the using and still save." The bracket state is beside the point. A style that is not a `using`
// declaration is not a style.
'use strict';

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + String(detail).slice(0, 400) : ''));
}

// ── the source of the ambiguity is gone ────────────────────────────────────
{
  const fn = html.slice(html.indexOf('function _findBracketError('),
                        html.indexOf('function _findBracketError(') + 3000);

  // ⚠️ Anchored on the SHAPE of the return, not on the message text, so rewording the copy does
  // not fail the test. The contract is what matters: a distinguishable third answer.
  ok('the unparseable branch returns a distinct answer, not null',
     /if\s*\(!m\)\s*\{[\s\S]{0,400}?unreadable:\s*true/.test(fn),
     fn.slice(fn.indexOf('if (!m)'), fn.indexOf('if (!m)') + 300));

  ok('and it no longer returns bare null there',
     !/const m = body\.match[\s\S]{0,120}?if \(!m\) return null;/.test(fn));
}

// ── every consumer that renders a marker checks it first ───────────────────
{
  // These paths read err.offsetInCode. An `unreadable` answer has none, so rendering it would
  // place a marker at position NaN rather than fail loudly — silent wrongness, again.
  // ⚠️ Anchor on the LOOP, not on _errorStyleNames.clear() — that string appears three times
  // and the first hit is a different function entirely. A test that slices the wrong window
  // reports correct code as broken, which is how this assertion failed on its first run.
  const decorAt = html.indexOf('const err = _findBracketError(e.usingCode);');
  const decor = html.slice(decorAt, decorAt + 700);
  ok('the library decoration loop skips unreadable before using an offset',
     /if \(!err \|\| err\.unreadable\) continue;/.test(decor), decor);

  const detailAt = html.indexOf("const banner  = document.getElementById('detail-error-banner');");
  const detail = html.slice(detailAt, detailAt + 2600);
  // ⚠️⚠️ ORDER IS CHECKED AGAINST CODE, NOT PROSE. The first cut compared indexOf('offsetInCode'),
  // which matched the WORD inside the explanatory comment sitting above the guard — so the test
  // failed on correct code because of a comment I had just written. Anchor on the call that
  // actually consumes the offset.
  const guardAt = detail.indexOf('if (err && err.unreadable)');
  const usesOffsetAt = detail.indexOf('getPositionAt(formattedErr.offsetInCode)');
  ok('the detail banner handles unreadable BEFORE anything reads an offset',
     guardAt > 0 && usesOffsetAt > 0 && guardAt < usesOffsetAt,
     `guard at ${guardAt}, offset use at ${usesOffsetAt}`);

  // ⭐ The Add Style surface deliberately accepts a bare expression — it synthesises a
  // `using _check_ = ` prefix so brackets are still checked, and wraps the real declaration once
  // a name exists. It must NOT start rejecting that.
  const addPath = html.slice(html.indexOf("const PREFIX = 'using _check_ = ';"),
                             html.indexOf("const PREFIX = 'using _check_ = ';") + 1400);
  ok('the Add Style path still synthesises a prefix rather than refusing bare expressions',
     /bracketCheckContent = hasUsing \? code : `\$\{PREFIX\}/.test(addPath), addPath);
  ok('and it drops an unreadable answer instead of rendering one',
     /if \(bracketErr && bracketErr\.unreadable\) bracketErr = null;/.test(addPath), addPath);
}

// ── the save gate ──────────────────────────────────────────────────────────
{
  const gate = html.slice(html.indexOf('function _detailHasError()'),
                          html.indexOf('function _detailHasError()') + 400);
  // It coerces with !! — which is exactly why returning an OBJECT for unreadable is what blocks
  // the save. Asserting the coercion is still there keeps that link explicit: change it to a
  // null-check and the fix silently stops working.
  ok('the save gate still coerces the answer, so a truthy unreadable blocks Save',
     /return !!\(_findBracketError\(compact\)/.test(gate), gate);

  const save = html.slice(html.indexOf('async function _saveDetail()'),
                          html.indexOf('async function _saveDetail()') + 300);
  ok('_saveDetail returns early when the gate is true',
     /if \(_detailHasError\(\)\) \{ _updateDetailErrorMarkers\(\); return; \}/.test(save), save);
}

console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
