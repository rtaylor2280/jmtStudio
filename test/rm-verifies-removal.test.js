// A removal that did not happen must not report success.  [B-436, 2026-09-26]
//
// ⚠️⚠️ THE DEFECT THIS GUARDS WAS INVISIBLE AT RUNTIME. `rmWithRetry` documented itself as
// "resolves when the path is gone" and only ever checked that `fs.rm` did not throw. With
// `force: true` that call can return quietly while the directory survives, so:
//   · the four retries never engaged - nothing threw
//   · callers set `replacedLeftover = null` and recorded a clean disposal
//   · empty `DELETE.<name>` folders were found on the Desktop days later, unreported
// Two real samples, both the same shape: every FILE gone, every DIRECTORY left, at every level.
//
// ⭐ SO THE TEST FAKES THE FAILURE RATHER THAN WAITING FOR IT. The real cause is intermittent and
// was not reproduced in two attempts; what IS testable is the contract - if the path is still
// there afterwards, this must throw rather than return. Waiting for a flaky OS condition would
// be a test that passes for the wrong reason on most runs.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const fsRemove = require('../fsRemove');
const { rmWithRetry } = fsRemove;

const mkTree = (root, dirs = ['a', 'b/c'], files = 3) => {
  fs.mkdirSync(root, { recursive: true });
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (let i = 0; i < files; i++) fs.writeFileSync(path.join(root, `f${i}.wav`), 'x');
  return root;
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-rm-'));

  // ── 1. The happy path still resolves ────────────────────────────────
  {
    const t = mkTree(path.join(tmp, 'gone'));
    await rmWithRetry(t);
    ok('a removable tree is removed and resolves', !fs.existsSync(t),
       'the ordinary case must not have regressed into a throw');
  }

  // ── 2. rm resolves, path survives -> MUST THROW ─────────────────────
  //
  // ⭐ The real `fs.rm` is swapped for one that reports success and removes nothing. That is
  // precisely the observed behaviour, and the ONLY way to produce it on demand.
  {
    const t = mkTree(path.join(tmp, 'stubborn'));
    const realRm = fs.promises.rm;
    fs.promises.rm = async () => {};          // resolves, deletes nothing
    let threw = null;
    const t0 = Date.now();
    try { await rmWithRetry(t, { attempts: 3, backoffMs: 10 }); }
    catch (e) { threw = e; }
    fs.promises.rm = realRm;

    ok('⭐⭐ a silent non-removal throws instead of resolving', !!threw,
       'this is the whole defect: rm returned, the folder stayed, and the caller recorded success');
    ok('   and it names the path that survived',
       !!threw && String(threw.message).includes('stubborn') && threw.code === 'ERMINCOMPLETE',
       `the caller reports this to the user, so it has to say WHAT is still there. Got ${threw && threw.code}`);
    ok('   and it retried rather than giving up on the first pass',
       Date.now() - t0 >= 25,
       'the 900 ms of retries existed all along and were dead; with verification they must engage');
    fs.rmSync(t, { recursive: true, force: true });
  }

  // ── 3. THE SWEEP THAT IS NOT HERE ──────────────────────────────────
  //
  // ⚠️⚠️ A `sweepDisposalLeftovers(destDir)` helper was written and REMOVED the same evening, so
  // this asserts its ABSENCE rather than its behaviour. The reasoning, settled 2026-09-26: "meaning we delete
  // something later? On a separate export? Don't think we should. Reporting is good."
  // It deleted during an operation unrelated to what was being deleted, and it worked against
  // the reporting added in the same change - a leftover quietly swept by the next export is one
  // nobody ever learns about.
  // ⭐ The case exists because "clear the old leftovers too" reads as an obvious improvement and
  // will be proposed again. It was considered and refused on purpose.
  {
    ok('⚠️ no destination-wide sweep is exported', typeof fsRemove.sweepDisposalLeftovers !== 'function',
       'accumulation is the SYMPTOM. Tidying it away on an unrelated export hides the fault that '
       + 'the verification above exists to surface - and deletes on an operation that has nothing '
       + 'to do with the folder being removed.');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nrm-verifies-removal: ${failed === 0 ? 'all passing' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
})();
