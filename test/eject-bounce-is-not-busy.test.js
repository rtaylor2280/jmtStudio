// A CARD THAT RELEASES AND COMES BACK IS `returned`, NEVER `busy`.
//
// WHY THIS EXISTS. Exporting to a card with "eject when finished" ticked, 2026-10-06:
//     "Something is still using L:, so it could not be released.
//      Close anything using the card and try again."
// Nothing was using it. An independent eject of the same volume, at the same moment, reported
// "it ejected and the reader re-mounted it straight away". The eject WORKED and the card came
// back - which is `returned`, a state this module already had a name and a message for.
//
// THE DEFECT WAS A WRONG QUESTION, NOT A WRONG VALUE. `ejectVolume` chose between the two
// outcomes with `mediaPresent(mountPath)` - "is it here now" - which cannot separate them: a card
// that released and was re-mounted is present, exactly like one that never moved. `waitForMediaGone`
// knew the answer and discarded it, returning only whether the absence had been STABLE.
//
// AND THE DIRECTION OF THE LIE IS WHAT MAKES IT WORTH A TEST. `busy` is ADVICE - close your
// files - and it cannot be acted on when nothing is open. The user hunts for a phantom. Same
// family as [B-394]: reporting that a program survived in the library, which was the one outcome
// we could prove had not happened.
//
// Any disk can do this - the re-mount is ordinary behaviour, not one dock's quirk. That is why
// this is a code fix rather than a hardware hunt.

'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? ' - ' + extra : ''}`); fail++; }
}

// ── A fake volume, driven by a script of presence readings ───────────────────
// `mediaPresent` is `fs.existsSync(mountPath)`, so stubbing existsSync drives the real
// `waitForMediaGone` and the real `ejectVolume` over a scripted bounce. Nothing about the module
// is mocked - only the world it looks at.
const MOUNT = 'Z:\\';
const realExists = fs.existsSync;

function withPresence(readings, run) {
  let i = 0;
  fs.existsSync = function (p) {
    if (String(p) === MOUNT) {
      const v = readings[Math.min(i, readings.length - 1)];
      i++;
      return v;
    }
    return realExists.call(fs, p);
  };
  return Promise.resolve()
    .then(run)
    .finally(() => { fs.existsSync = realExists; });
}

// Load a FRESH copy so the platform table is intact and nothing is cached from another suite.
function freshModule() {
  const p = require.resolve('../safeEject.js');
  delete require.cache[p];
  return require(p);
}

(async () => {
  const SE = freshModule();

  if (process.platform !== 'win32') {
    console.log('  (skipped: windows-only platform table)');
    console.log('eject-bounce-is-not-busy: skipped');
    process.exit(0);
  }

  // ── 1. waitForMediaGone must REPORT that it saw the media leave ─────────────
  // Present, gone for one poll, then back for the rest. With STABLE_MS at 1000 and POLL_MS at
  // 250, one absent sample never reaches stability - which is exactly a bounce.
  await withPresence([true, false, true, true, true, true, true, true], async () => {
    const res = await SE.waitForMediaGone(MOUNT, 900);
    ok('a bounce is not reported as stably gone', res.gone === false, JSON.stringify(res));
    ok('but waitForMediaGone RECORDS that it left', res.everGone === true,
       'everGone is the one fact the classifier needs and it used to be discarded: '
       + JSON.stringify(res));
  });

  // ── 2. A volume that NEVER leaves must not claim it did ────────────────────
  // The control for the check above. Without it, `everGone: true` could be hard-coded and
  // every assertion here would still pass.
  await withPresence([true, true, true, true, true, true, true, true], async () => {
    const res = await SE.waitForMediaGone(MOUNT, 900);
    ok('a volume that never left reports everGone false', res.everGone === false,
       JSON.stringify(res));
  });

  // ── 3. A stable departure still reports `gone` ─────────────────────────────
  await withPresence([true, false, false, false, false, false, false, false, false, false],
    async () => {
      const res = await SE.waitForMediaGone(MOUNT, 5000);
      ok('a stable departure is still gone', res.gone === true, JSON.stringify(res));
      ok('and it reports everGone too', res.everGone === true, JSON.stringify(res));
    });

  // ── 4. THE CLASSIFICATION, which is the defect itself ──────────────────────
  // Drive the whole of ejectVolume over a bounce. The shell verb cannot run here, so `invoke`
  // is replaced - but ONLY the launcher. The decision under test is untouched.
  const SE2 = freshModule();
  SE2._PLATFORMS.win32.invoke = async () => ({ ok: true, raw: 'launched' });

  await withPresence([true, true, false, true, true, true, true, true, true, true], async () => {
    const r = await SE2.ejectVolume(MOUNT, { timeoutMs: 900 });
    ok('a bounce is classified `returned`, not `busy`', r.status === 'returned',
       `got ${r.status} - "busy" tells the user to close files that are not open`);
    ok('and it carries everGone so a caller can say what happened', r.everGone === true,
       JSON.stringify(r));
  });

  // ── 5. A GENUINELY BUSY VOLUME MUST STILL REPORT `busy` ────────────────────
  // THE CHECK THAT STOPS THE FIX GOING TOO FAR. `busy` is the case the whole feature exists
  // for - the one where pulling the card WOULD have been unsafe - so a change that made every
  // outcome `returned` would be worse than the bug it replaced, and would pass check 4.
  const SE3 = freshModule();
  SE3._PLATFORMS.win32.invoke = async () => ({ ok: true, raw: 'launched' });

  await withPresence([true, true, true, true, true, true, true, true, true, true], async () => {
    const r = await SE3.ejectVolume(MOUNT, { timeoutMs: 900 });
    ok('a volume that never released is still `busy`', r.status === 'busy',
       `got ${r.status} - the unsafe case must keep its own name`);
    ok('and busy reports everGone false', r.everGone === false, JSON.stringify(r));
  });

  // ── 6. ALREADY GONE is untouched ───────────────────────────────────────────
  const SE4 = freshModule();
  SE4._PLATFORMS.win32.invoke = async () => ({ ok: true, raw: 'launched' });
  await withPresence([false, false, false], async () => {
    const r = await SE4.ejectVolume(MOUNT, { timeoutMs: 900 });
    ok('a volume already gone is `ejected`, alreadyGone', r.status === 'ejected' && r.alreadyGone,
       JSON.stringify(r));
  });

  console.log('');
  console.log(fail === 0
    ? `eject-bounce-is-not-busy: all ${pass} checks passed`
    : `eject-bounce-is-not-busy: ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  fs.existsSync = realExists;
  console.error('eject-bounce-is-not-busy: threw', e);
  process.exit(1);
});
