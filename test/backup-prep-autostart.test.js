// The backup prep screen starts itself on a timer, and the rules for that are not obvious. [B-420]
//
// ⭐⭐ WHY THIS IS TESTED AT ALL. A countdown that auto-clicks a button is a pattern with real
// constraints — it is trivially easy to build the version that is merely annoying, or the version
// that fires an action the user never sanctioned. Every assertion here corresponds to a rule
// written up in `local/ui-conventions.md` under "A dialog may start its own action on a timer",
// and each of those came from a specific failure mode rather than from taste.
//
// ⚠️ THE GATE THAT MATTERS MOST CANNOT BE GREPPED: the automatic action must be the SAFE one the
// user already implied. Here the destination is chosen in a file picker BEFORE this screen opens,
// so starting is what they asked for. If that ever stops being true — if this screen grows a real
// fork — the countdown has to go, and no test can notice that for you.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

// ⚠️ ANCHORED AND ASSERTED, NOT SLICED BLIND. An unmatched anchor makes `slice` measure something
// real and say nothing true about it — this suite has already shipped one "found 0" failure that
// read as a product defect when the heading had simply been renamed.
const at = html.indexOf('const _sfOpenExportBackup');
const end = html.indexOf('// Actual run — opens the progress modal', at);
ok('the backup prep flow was located', at > 0 && end > at,
   're-anchor on _sfOpenExportBackup if it is renamed; every assertion below is vacuous without it');
const win = (at > 0 && end > at) ? html.slice(at, end) : '';
ok('the located region is non-empty', win.length > 0);

console.log('backup-prep-autostart');

// ── 0. Cancel is live from the moment the modal opens, and it is instant ────
// ⚠️⚠️ THE BUG THIS PINS: the click listener used to be attached AFTER `await sfBackupPrep(...)`
// resolved, so for the whole survey of an 8.19 GB library the Cancel button was visible, enabled,
// and wired to nothing. Reported: clicking it *"doesn't do anything"*, and the summary came up
// afterwards as though he had never clicked.
// ⭐ And it closes on the click rather than waiting for the survey. Ruled: *"cancel is stop
// analyzing... should be instant in that phase."* The survey writes nothing, so abandoning it
// costs nothing — main finishing a read is not the user's problem.
{
  const prepAt = win.indexOf('cancelBtn.addEventListener(\'click\', onPrepCancel)');
  const awaitAt = win.indexOf('await window.electronAPI.sfBackupPrep');
  ok('⭐⭐ Cancel is wired BEFORE the survey is awaited, not after',
     prepAt > 0 && awaitAt > prepAt,
     'a visible, enabled button attached to no handler is a promise the dialog cannot keep');
  ok('⭐ and it closes the modal on the click itself',
     /onPrepCancel = \(\) => \{[\s\S]{0,200}prepModal\.classList\.remove\('active'\)/.test(win),
     'nothing is written during the survey, so there is nothing to wait for');
  // ⚠️ Matches the GUARD, not the exact statement after it — a temporary diagnostic inside the
  // branch is not a behaviour change, and an assertion that goes red for one is pinning
  // punctuation rather than intent.
  ok('⚠️ and the discarded result never reaches a dialog',
     /if \(prepCancelled\)[^\n]*return;/.test(win),
     'a red error over a screen they already dismissed is not an answer to "stop"');
}

// ── 1. It exists, and it fires the same action the button does ──────────────
ok('a countdown drives the primary action', /autoTimer = setInterval\(/.test(win));
ok('⭐ at zero it calls onStart — the same path the button takes, not a second copy',
   /stopAuto\(\); onStart\(\);/.test(win),
   'a timer with its own copy of the start logic is two mechanisms to keep in agreement forever');

// ── 2. NOTHING PAUSES IT, and that is the design ────────────────────────────
// ⚠️⚠️ THE FIRST CUT STOPPED THE COUNTDOWN ON ANY CLICK OR KEYPRESS, to satisfy the WCAG 2.2.1
// "turn off the time limit" limb. The verdict on what that produced: *"need for double cancel is
// odd."* Brushing the dialog put it back into waiting-forever — silently, permanently, with
// nothing to say it had happened. **The pause re-created the exact problem the countdown existed
// to remove**, and it made Cancel a two-click affair.
// ⭐ 2.2.1 protects users from being RUSHED INTO LOSING SOMETHING. Nothing is lost here: the
// destination was chosen before this screen opened, the timer only does what was already asked
// for, and the export it starts is itself cancellable in one click. Cancel is visible and one
// click away at every moment — that IS the escape hatch.
for (const ev of ['pointerdown', 'keydown', 'wheel', 'pointermove']) {
  ok(`⭐ no ${ev} listener re-creates the waiting-forever state`, !new RegExp(`'${ev}'`).test(win),
     'a pause makes Cancel ambiguous and hides the fact that the dialog has stopped counting');
}
ok('⭐ the copy points at Cancel, which is the real escape hatch',
   /Cancel if you do not want it/.test(win),
   'the instruction has to name the control that actually exists');

// ── 3. The timer cannot outlive its modal ───────────────────────────────────
ok('⚠️ the interval is cleared, and from the single exit path',
   /stopAuto\('closed'\);/.test(win) && /clearInterval\(autoTimer\)/.test(win),
   'an interval outliving its dialog fires into a screen that is gone and starts an export '
   + 'nobody asked for');
const cleanupAt = win.indexOf('const cleanup = ()');
const stopInCleanup = win.indexOf("stopAuto('closed')", cleanupAt);
ok('the clear is inside cleanup, not beside it',
   cleanupAt > 0 && stopInCleanup > cleanupAt && (stopInCleanup - cleanupAt) < 400,
   `cleanup at ${cleanupAt}, stopAuto('closed') at ${stopInCleanup}`);

// ── 4. It starts only once the screen is readable ───────────────────────────
const enableAt = win.indexOf('startBtn.disabled = false;');
const timerAt = win.indexOf('autoTimer = setInterval(');
ok('⭐ the clock starts after the summary is on screen, not during the survey',
   enableAt > 0 && timerAt > enableAt,
   'counting down while the survey runs spends the reading time before there is anything to read');

// ── 5. Screen readers: a status line, announced sparingly ───────────────────
ok('the countdown has a polite live region', /id="sf-backup-prep-auto"/.test(html)
   && /aria-live="polite"/.test(html.slice(html.indexOf('id="sf-backup-prep-auto"') - 200,
                                            html.indexOf('id="sf-backup-prep-auto"') + 200)));
ok('⚠️ it does not announce every tick',
   /autoLeft === 15 \|\| autoLeft === 5/.test(win),
   'a status line that re-speaks each second makes the dialog unusable with a screen reader');

// ── 6. The words match the code ─────────────────────────────────────────────
// ⚠️ An instruction that does not work is worse than no instruction: the user follows it, nothing
// happens, and they conclude the app is broken. This assertion has now been rewritten TWICE as the
// behaviour changed under it — first "move the mouse" when only clicks were listened for, then
// "click anywhere" once nothing pauses the countdown at all. Both times the copy was the thing
// lagging behind the code, which is the whole reason it is pinned here.
ok('⭐ the copy names no cancelling gesture that does not exist',
   !/Move the mouse/.test(win) && !/stop the countdown/.test(win),
   'nothing pauses this countdown, so the status line must not imply anything does');

// ── 7. THE SCREEN HAS TO REACH THE GLASS ────────────────────────────────────
// ⚠️⚠️ THE DEFECT, 2026-09-24. He reported Cancel doing nothing on the survey screen. Five
// renderer-side theories, none measured, all wrong — the renderer was never the blocked process.
// `surveyLibrary` is a synchronous recursive stat walk running in MAIN, and Electron routes frame
// presentation AND input dispatch through that process. So for ~1.9 s the modal existed in the DOM
// with a live handler and an enabled button, was never painted, and never received a click. The
// words once instrumented: *"never saw it."*
// ⭐ Nothing in the renderer could have fixed it, which is why this assertion lives against main.
{
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const h = mainJs.indexOf("ipcMain.handle('sfBackup:prep'");
  const hEnd = mainJs.indexOf('ipcMain.handle(', h + 10);
  ok('the prep handler was located', h > 0 && hEnd > h);
  const body = (h > 0 && hEnd > h) ? mainJs.slice(h, hEnd) : '';
  ok('⭐⭐ the prep handler awaits the YIELDING survey, so the window keeps painting',
     /await soundFontBackup\.surveyLibraryAsync\(/.test(body),
     'a synchronous walk here blocks frame presentation and input dispatch for its whole '
     + 'duration - the modal is in the DOM, unpainted and unclickable');
  ok('⚠️ and does not call the blocking one',
     !/soundFontBackup\.surveyLibrary\(/.test(body),
     'the sync twin still exists for callers with nothing on screen; this is not one of them');

  const backupJs = fs.readFileSync(path.join(__dirname, '..', 'soundFontBackup.js'), 'utf8');
  const a = backupJs.indexOf('async function surveyLibraryAsync');
  const aEnd = backupJs.indexOf('\nfunction surveyLibrary(', a);
  ok('the async survey was located', a > 0 && aEnd > a);
  const asyncBody = (a > 0 && aEnd > a) ? backupJs.slice(a, aEnd) : '';
  // ⚠️ The breath must be per TOP-LEVEL ITEM. A single multi-GB voicepack is what actually holds
  // the loop; yielding once per bucket would leave the longest stretch exactly as blocking.
  ok('⭐ it yields per directory, not merely per bucket',
     /for \(const d of dirs\) \{\s*\n\s*await breathe\(\);/.test(asyncBody),
     'four yields across four buckets would not unblock a single large source');
}

console.log(failed ? `\nbackup-prep-autostart: ${failed} FAILED` : '\nbackup-prep-autostart: all passing');
process.exit(failed ? 1 : 0);
