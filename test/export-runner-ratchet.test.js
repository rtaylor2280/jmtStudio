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
// ⚠️⚠️ THESE NUMBERS MUST MOVE WHEN A DOOR LANDS, AND THE SELF-PROOF IS WHAT FORCES IT.
// Door 1 (font card) migrated 2026-09-22 and every headline check still passed at the old
// numbers - 3 doors clears a floor of 2 comfortably. What failed was mutation (c): it removes
// one `_sfRunExport` and asserts the count drops BELOW the floor, which stops being true the
// moment there is slack. **A ratchet with slack cannot detect the regression it exists for**, so
// the self-proof failing is the file telling us to tighten, not a broken test.
const MIGRATED_MIN   = 8;   // + source export, 1..N in one operation  (2026-09-23)
// ⚠️ The runner's OWN preflight call is filtered out below, so this counts doors only. The
// ceiling is deliberately the measured truth with NO slack: slack is room for one more door to
// be added the old way without anything going red.
const UNMIGRATED_MAX = 2;   // primary-early, bulk                      (2026-09-23)
// ⭐ SOURCE EXPORT CAME OFF THIS LIST 2026-09-23. It ran its own `_sfPreflightDestination`;
// it now goes through the runner's, which is what took the ceiling from three to two. The
// self-proof below FAILED first and that is what forced this edit - with slack in the
// numbers, mutation (c) could no longer push the count past a floor, so the ratchet could
// not detect the regression it exists for. Tightening is the required response, not a
// convenience: "a ratchet with slack cannot detect the regression it exists for".
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
  // ⭐ ZERO AS OF 2026-09-23. The last ending outside the runner was the source door's own
  // "Export stopped" dialog, which drew a SECOND one on top of the shared ending the moment
  // that door migrated - he hit it on the first cancel. With it gone the runner is the only
  // thing that ends an export, and a ceiling of zero says so rather than leaving room for
  // one nobody is tracking.
  const OUTSIDE_MAX = 0;   // tightened 2026-09-23 when source export landed
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
    // ⚠️⚠️ RE-ANCHORED 2026-09-22. This ended at `_sfAddCommonFiles`, and the new
    // common-as-folder door was then inserted BETWEEN the two - so door 8's body silently
    // grew to include a different door's code. It still passed, which is the dangerous part:
    // an anchor that has drifted reports on the wrong region without failing, so the door it
    // names stops being the door it checks.
    { name: 'common-as-zip (door 8)',
      start: 'const _sfExportCommonPrompt = async (uuid)',
      end:   'const _sfExportCommonFolderPrompt = async (uuid)' },
    { name: 'common-as-folder (new, 2026-09-22)',
      start: 'const _sfExportCommonFolderPrompt = async (uuid)',
      end:   'const _sfAddCommonFiles = async' },
    // ⚠️ ADDED WHEN DOOR 1 LANDED (2026-09-22). Raising the count floor is only half a
    // migration: without an entry here the door is counted as migrated and then never checked
    // for regrowing the machinery, which is the drift this section exists to catch. A door on
    // the runner that nobody named is exactly the "covered handler reachable from an unguarded
    // call site" shape in exportDestination.js's header.
    { name: 'font card (door 1)',
      start: "mkItem('↗ Export font folder…'",
      end:   "mkItem('× Delete'" },
    // ⚠️⚠️ TRACKS CARRIES ONE DOCUMENTED EXEMPTION, AND IT IS NAMED RATHER THAN OMITTED.
    // It raises its own progress bar inside `plan`, which looks exactly like the regression
    // this section exists to catch. It is not: `plan` runs BEFORE the runner raises anything,
    // and this door's plan is the long per-track comparison that used to run in total silence
    // after the picker ("there seemed to be no scan at all on the tracks export"). The runner
    // checks the DOM and will not open a second modal on top of it.
    // ⭐ Leaving the door OFF this list instead would have been the easy move and the wrong
    // one: it would be counted as migrated by the floor and then never checked for the other
    // five things. An exemption that is written down can be argued with; an absence cannot.
    { name: 'tracks (door 6)',
      start: 'const _sfExportSharedTracks = async () => {',
      end:   'window._sfExportSharedTracks = _sfExportSharedTracks;',
      except: ['raises the progress modal itself'] },
    // ⚠️⚠️ THE FUNNEL IS HALF MIGRATED ON PURPOSE, AND THE HALVES SERVE DIFFERENT DOORS.
    //
    // `_sfExportFiles` has two branches. The MULTI-PATH branch is doors 2, 5, 7 and 9 - the
    // "select files → Export" items his count names - and it is on the runner as of 2026-09-22.
    // The SINGLE-PATH branch serves menu items that are NOT in that count: single-file
    // "Export…", "Export folder…" and "Export ZIP…" (which passes `asFile` and produces a
    // different artifact). Those are the open question recorded in the register.
    //
    // ⭐ The single-path branch cannot move yet for the reason its own comment gives: it chooses
    // between a SAVE dialog and a FOLDER dialog based on whether the path is a directory, which
    // the renderer cannot know without probing, and probing before opening a picker is the
    // delay-before-the-dialog the "a click always acts instantly" rule forbids. ⏭ The unlock is
    // that the CALL SITES already know - "Export folder…" passes `dirSubPath` - so the fact just
    // needs threading through. That is a change to ten call sites and it waits for his ruling on
    // whether those items are doors.
    //
    // ⚠️ So the two exemptions below are the single-path branch, not the migrated one. They are
    // asserted positively: if that branch stops doing these, the exemption is stale and says so.
    // ⚠️ ADDED WHEN SOURCE EXPORT LANDED (2026-09-23). Raising the floor is half a migration:
    // without an entry here the door counts as migrated and is then never checked for regrowing
    // the machinery the runner owns - the same "covered but unlisted" hole this file exists for.
    // ⭐ This door is also where the bulk delete's SECOND surface used to live. It has no
    // exemption: the caller-drawn step bar is gone, not tolerated.
    { name: 'source export (doors 3·4·12·13)',
      start: 'const _sfRunSourceExport = async ({ sources',
      end:   'const _sfExportSourceBeforeDelete = async' },
    { name: 'the funnel (doors 2·5·7·9)',
      start: 'const _sfExportFiles = async ({ kind, id, subPaths, asFile, isDir })',
      end:   '// Unified dispatcher',
      // ⭐⭐ THE EXEMPTIONS ARE GONE, AND THE FILE IS HOW WE FOUND OUT. They were recorded on
      // 2026-09-22 for the single-path branch, and when that branch migrated later the same day
      // both went stale - the positive assertion failed and named itself, which is exactly what
      // an exemption asserted positively is for. An exemption that is merely SKIPPED would have
      // sat here forever describing a door that had moved on.
    },
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
      // ⚠️ An exemption must still be ASSERTED, not skipped. If the exempted thing stops being
      // present, the exemption is stale and should be deleted - and a silently-skipped check
      // would never tell us. So the expectation simply inverts.
      if ((d.except || []).includes(what)) {
        ok(`  ${d.name} still ${what} (documented exemption)`, pattern.test(body),
           'the exemption in this file says this door does it deliberately. If that is no '
           + 'longer true, remove the exemption rather than leaving a check that asserts nothing');
        continue;
      }
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
