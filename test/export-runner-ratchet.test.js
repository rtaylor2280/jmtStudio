// The migration can only go forwards.  [B-420]
//
// ⭐⭐ WHAT THIS IS FOR. Thirteen doors are being moved onto one shared export runner. The whole
// value of that is destroyed the moment door fourteen arrives by copy-pasting door eleven, or a
// migrated door quietly grows its own progress modal again because that was easier than adding
// an option. The framing: "I juswt don't want to have to write 11 different processes when
// there is truly only one with variation."
//
// ⚠️ A ratchet, not a gate. It does not demand that every door be migrated today - it demands
// that MIGRATED doors stay clean, and that the number of UNMIGRATED ones can only fall. Both
// counts are written down here, so moving them is a deliberate edit with a diff, never a drift.
//
// ⭐ WHY THE COUNTS ARE THE MECHANISM. This codebase has been bitten three times by "a handler
// counted as covered was also reachable from a call site carrying none of the guards"
// (exportDestination.js's own header). A per-door assertion cannot see a door nobody listed.
// A count that must decrease can.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

// ── Where the runner is, so "inside it" is answerable ────────────────
// ⚠️ Two markers, never a character count. A fixed-width slice over this file has silently
// stopped covering its target three times.
const RUNNER_START = 'const _sfRunExport = async (door';
const RUNNER_END   = '// Convenience for the export+delete sequence';
const rs = H.indexOf(RUNNER_START);
const re = H.indexOf(RUNNER_END, rs);
ok('the runner was located', rs > 0 && re > rs,
   're-anchor RUNNER_START/RUNNER_END if _sfRunExport or the comment after it is renamed');
const insideRunner = (idx) => idx > rs && idx < re;

// ── 1. THE RATCHET: how many doors are on the runner, how many are not ──
//
// ⚠️ MIGRATED must not fall and UNMIGRATED must not rise. Update both together, in one commit,
// when a door moves. If you are here because the numbers disagree: that is the point.
const MIGRATED_MIN   = 2;   // backup, common-as-zip          (2026-09-21)
// ⚠️ 5, not 6. The count from a plain grep is 6 because it includes the runner's OWN call. The
// ceiling is deliberately the measured truth with no slack: slack is room for one more door to be
// added the old way without anything going red.
const UNMIGRATED_MAX = 5;   // tracks, source, primary-early, bulk, font   (2026-09-21)
{
  const onRunner = (H.match(/await _sfRunExport\(\{/g) || []).length;
  ok(`⭐ doors on the shared runner: ${onRunner} (floor ${MIGRATED_MIN})`,
     onRunner >= MIGRATED_MIN,
     'a door came OFF the runner, or the floor was raised without migrating one');

  const directPf = [...H.matchAll(/await _sfPreflightDestination\(\{/g)]
    .filter((m) => !insideRunner(m.index)).length;
  ok(`⭐ doors still doing their own destination check: ${directPf} (ceiling ${UNMIGRATED_MAX})`,
     directPf <= UNMIGRATED_MAX,
     'a NEW door was added with its own preflight instead of going through the runner - which '
     + 'is exactly how thirteen separate processes happened the first time');
}

// ── 2. The shared ending is not bypassable ───────────────────────────
//
// ⚠️ On 2026-09-20 three doors reported a cancelled export as a success, each with its own
// hand-rolled ending. The runner now owns the ending; a door calling `_sfExportOutcome` itself
// is a door that can get `ok` vs `canceled` wrong again, because it skips the contract guard.
{
  const calls = [...H.matchAll(/await _sfExportOutcome\(/g)];
  const outside = calls.filter((m) => !insideRunner(m.index)).length;
  ok(`the runner calls the shared ending (${calls.length - outside} inside it)`,
     calls.length - outside >= 1);
  // ⚠️ Ceiling, not zero: the unmigrated doors legitimately still call it. It must only fall.
  const OUTSIDE_MAX = 3;
  ok(`⭐ endings drawn outside the runner: ${outside} (ceiling ${OUTSIDE_MAX})`,
     outside <= OUTSIDE_MAX,
     'a door bypassing the runner\'s ending also bypasses the contract guard, which is what '
     + 'stopped a cancel being reported as "Export failed: unknown error"');
}

// ── 3. A migrated door must not keep its own machinery ───────────────
//
// ⭐ The two migrated doors are named, and each is checked for the things the runner now owns.
// This is the assertion that catches a door quietly regrowing a bar because adding an option
// felt like more work.
{
  const doors = [
    { name: 'backup (door 10)',
      start: 'const _sfRunExportBackup = async (destPath, survey)',
      end:   '// Merge-import run' },
    { name: 'common-as-zip (door 8)',
      start: 'const _sfExportCommonPrompt = async (uuid)',
      end:   'const _sfAddCommonFiles = async' },
  ];
  // What the runner owns. A migrated door touching any of these is the regression.
  const FORBIDDEN = [
    ['raises the progress modal itself', /_sfDeleteProgress\.show\(/],
    ['runs its own destination check',   /_sfPreflightDestination\(/],
    ['wires its own Cancel button',      /_sfDeleteProgress\.offerCancel\(/],
    ['drives its own progress tick',     /setInterval\(/],
    ['shows its own fit refusal',        /_sfRefuseNotEnoughRoom\(/],
    ['shows its own slow-write warning', /_sfSlowWriteDialog\(/],
  ];
  for (const d of doors) {
    const i = H.indexOf(d.start);
    const j = H.indexOf(d.end, i);
    const body = (i > 0 && j > i) ? H.slice(i, j) : '';
    ok(`${d.name} was located`, body.length > 0, 're-anchor this door');
    for (const [what, pattern] of FORBIDDEN) {
      ok(`  ${d.name} no longer ${what}`, !pattern.test(body),
         'the runner owns this now - a door doing it again is the drift this file exists to stop');
    }
  }
}

// ── 4. ⚠️⚠️ AND THE RATCHET PROVES ITSELF ────────────────────────────
//
// A ratchet that cannot detect a regression is a comment. Each check above is re-run against a
// mutated copy that reintroduces exactly what it forbids, and must fail.
{
  const misses = [];
  // (a) a migrated door regrowing a progress modal
  {
    const i = H.indexOf('const _sfRunExportBackup = async (destPath, survey)');
    const j = H.indexOf('// Merge-import run', i);
    const mutated = H.slice(0, j) + "\n_sfDeleteProgress.show('x','y');\n" + H.slice(j);
    const mi = mutated.indexOf('const _sfRunExportBackup = async (destPath, survey)');
    const mj = mutated.indexOf('// Merge-import run', mi);
    if (!/_sfDeleteProgress\.show\(/.test(mutated.slice(mi, mj))) misses.push('regrown modal not caught');
  }
  // (b) a new door added with its own preflight
  // ⚠️ Appended at the END of the file, not inserted before RUNNER_END. My first draft of this
  // mutation inserted just above the end marker, which put the fake door INSIDE the runner's own
  // range - so the check filtered it out and the self-test reported "not caught". The mutation
  // has to land where a real new door would: outside.
  {
    const mutated = H + '\nawait _sfPreflightDestination({ destDir });\n';
    const mrs = mutated.indexOf(RUNNER_START);
    const mre = mutated.indexOf(RUNNER_END, mrs);
    const n = [...mutated.matchAll(/await _sfPreflightDestination\(\{/g)]
      .filter((m) => !(m.index > mrs && m.index < mre)).length;
    if (!(n > UNMIGRATED_MAX)) misses.push('new unmigrated door not caught');
  }
  // (c) a door coming off the runner
  {
    const mutated = H.replace(/await _sfRunExport\(\{/, 'await somethingElse({');
    const n = (mutated.match(/await _sfRunExport\(\{/g) || []).length;
    if (!(n < MIGRATED_MIN)) misses.push('door removed from the runner not caught');
  }
  ok('⚠️⚠️ the ratchet catches all three regressions when introduced',
     misses.length === 0, misses.join('; '));
}

console.log(failed ? `\n${failed} FAILED` : '\nexport-runner-ratchet: all passing');
process.exit(failed ? 1 : 0);
