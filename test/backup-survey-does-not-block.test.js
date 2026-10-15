// A backup export must not freeze the app while it surveys the library. [B-478]
//
// `exportBackup` runs in the MAIN process. `surveyLibrary` is synchronous, so for its whole
// duration the loop cannot dispatch input: the window stops answering clicks and Windows paints
// "Not Responding". That is exactly what was reported on 2026-10-11 - a checkbox that would not
// take a click mid-export - and the stall probe recorded blocks of 40,626 ms and 11,193 ms
// during those runs.
//
// MEASURED on the real library (12.13 GB, 22,483 files) with a 50 ms heartbeat alongside, which
// is what the UI actually feels:
//     surveyLibrary       3,649 ms wall, heartbeat ticked  0 times - loop fully blocked
//     surveyLibraryAsync  3,256 ms wall, heartbeat ticked 44 times, worst gap 416 ms
// Both returned 12,128,949,076 bytes. Identical answer; the async form is not slower.
//
// THE SYNC TWIN IS STILL EXPORTED AND STILL CALLABLE, which is the whole reason this file
// exists. Nothing stops a future edit reaching for the shorter name and quietly reintroducing a
// freeze that produces no error, no failing test and no wrong number - only a window that stops
// answering. A reviewer cannot see the difference between the two names at a glance.
//
// WHAT THIS ASSERTS: the body of `exportBackup` awaits the async survey and never calls the
// synchronous one. It is a source-shape check, so its own credibility rests on the control
// below: the same predicate is run against a MUTANT built in memory with the sync call put
// back, and it must go red. A check that cannot fail is not a check.
// The mutant is built from a string. The real file is never written to - undoing a test
// mutation of a tracked file is how 1,400 lines of uncommitted work were lost on 2026-10-06.
//
// Run: node test/backup-survey-does-not-block.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const SRC = fs.readFileSync(path.join(__dirname, '..', 'soundFontBackup.js'), 'utf8');

// ── isolate exportBackup's body by brace matching, not by line numbers ──────────
// A fixed line window silently stops covering the function the moment anything above it
// grows. Brace matching follows the function wherever it moves.
// SKIP THE PARAMETER LIST FIRST. `exportBackup` takes a DESTRUCTURED object, so the first
// "{" after the declaration opens the parameters, not the body. Matching from there returned a
// 104-character slice of the argument list, and every assertion over it passed for free. The
// "is substantial" precondition below is what caught it.
function bodyOf(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) return null;
  // walk the parameter list by paren depth, then take the first brace after it
  let j = src.indexOf('(', i);
  if (j < 0) return null;
  let pd = 0;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '(') pd++;
    else if (c === ')') { pd--; if (!pd) { j++; break; } }
  }
  j = src.indexOf('{', j);
  if (j < 0) return null;
  const start = j;
  let depth = 0;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  return null;
}

// Strip comments so prose ABOUT the sync call is not mistaken for a call to it. Without this
// the explanatory comment added beside the fix would itself fail the test.
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// A CALL to the sync survey: the bare name followed by "(", never the Async spelling.
const CALLS_SYNC  = (body) => /(?<!Async)\bsurveyLibrary\s*\(/.test(decomment(body));
const CALLS_ASYNC = (body) => /\bsurveyLibraryAsync\s*\(/.test(decomment(body));

const body = bodyOf(SRC, 'async function exportBackup(');

// ── the fixture's own precondition, asserted before anything is concluded from it ──
ok('exportBackup body was located', !!body,
   'brace matching found nothing - the assertions below would be vacuously true');
ok('the located body is substantial', !!body && body.length > 2000,
   `got ${body ? body.length : 0} chars; a short slice would pass every check for free`);

// ── the real assertions ─────────────────────────────────────────────────────────
ok('exportBackup does NOT call the synchronous surveyLibrary', !!body && !CALLS_SYNC(body),
   'a sync library walk on the main process blocks input for its whole duration');
ok('exportBackup DOES call surveyLibraryAsync', !!body && CALLS_ASYNC(body),
   'the survey has to happen - this guards against the call being deleted rather than swapped');
ok('the async survey is awaited', !!body && /await[^\n]*surveyLibraryAsync|surveyLibraryAsync[^\n]*\)\s*\)/.test(decomment(body)),
   'an un-awaited async survey hands back a promise, and survey.totals would be undefined');

// ── CONTROL: the predicate must reject the shape this test exists to prevent ─────
// Built in memory from the real source. Nothing is written to disk.
const mutant = body && body.replace(
  /await stallProbe\.around\('sfBackup:surveyLibrary',\s*\n?\s*\(\) => surveyLibraryAsync\(userData\)\)/,
  'surveyLibrary(userData)');
ok('control: the mutant really differs from the real body', !!mutant && mutant !== body,
   'the replacement did not apply, so the control below proves nothing');
ok('control: the predicate CATCHES a restored sync call', !!mutant && CALLS_SYNC(mutant),
   'the check cannot fail, which makes the passes above worthless');

// ── and the sync twin must keep its warning, since it stays callable ─────────────
ok('surveyLibrary still carries its do-not-call warning',
   /DO NOT CALL THIS FROM THE MAIN PROCESS/.test(SRC),
   'the function remains exported; the comment is what stops the next caller');

console.log(`\nbackup-survey-does-not-block: ${failed ? failed + ' FAILED' : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
