// [B-424] EVERY LINK-IMPORT TIER WIRES A CANCEL. ANY CANCEL, AT ANY MOMENT, LEAVES NO ORPHAN.
//
// THE RULE, 2026-10-07, after four cancelled link imports each left a fully committed source
// (25 MB, 129 MB, 224 MB, 23 MB): *"it shouldn't matter when I click cancel. any cancel.. no orphan
// ever."* Not "cancel during these phases" - any cancel.
//
// THE DEFECT THIS GUARDS, and why reading one tier proved nothing. Importing from a link has
// TWO tiers, and only the first was wired:
//   · `_sfLinkImport`   - the headless fetch. Cancel bound, label set, result handled. Correct.
//   · `_sfBrowserImport` - the in-app browser the user actually clicks Download in. NO cancel
//     binding at all. The press fell through to the modal's generic close, which cancels the
//     SOURCE-IMPORT gate that has not started yet, so the download carried on unwatched and the
//     finished file went straight to the importer.
// Both tiers show the same modal and the same Cancel button, so nothing on screen distinguishes
// them - which is exactly why this is a test and not a reading. Reported: *"I was given the BVM
// browser page. then I clicked on the font I wanted and the download button. then it went back to
// the progress bar and I immediately clicked cancel. that's when you got the orphan."*
//
// AND A FINISHED DOWNLOAD DOES NOT UN-ASK THE QUESTION. A small font can COMPLETE in the gap
// between the click and the cancel reaching main, so main legitimately resolves `{ok:true}` - the
// bytes really did arrive. Importing it anyway is the 23 MB orphan.
'use strict';
const fs = require('fs');
const path = require('path');

const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const P = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}
// Comment-only lines are blanked so the prose documenting a banned shape is never mistaken for it.
// Lines are blanked rather than removed so reported line numbers still point at the real file.
const scan = (src) => src.split('\n')
  .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n');
const h = scan(H);
const m = scan(M);

// ── 1. BOTH TIERS EXIST AND BOTH BIND THE CANCEL BUTTON ──────────────────────
const TIERS = [
  { name: '_sfLinkImport (headless fetch)', start: '_sfLinkImport = async',
    cancelCall: 'cancelLinkImport(' },
  { name: '_sfBrowserImport (in-app browser)', start: '_sfBrowserImport = async',
    cancelCall: 'linkImportBrowserCancel(' },
];
for (const t of TIERS) {
  const at = h.indexOf(t.start);
  ok(`tier located: ${t.name}`, at > -1,
     `"${t.start}" not found - if it was renamed, re-point this entry; the checks below measure nothing without it`);
  if (at < 0) continue;
  // The tier's body: up to the next tier definition or 6k chars, whichever is shorter.
  const body = h.slice(at, at + 6000);
  ok(`${t.name} binds the Cancel button`,
     /cancelBtn\s*;/.test(body) && /\.onclick\s*=/.test(body),
     'no cancel binding in this tier - the press falls through to the modal close, which cancels a '
     + 'gate this tier never started');
  ok(`${t.name} calls its own cancel IPC`, body.includes(t.cancelCall),
     `expected ${t.cancelCall} - a tier that cancels the WRONG gate reports success and keeps going`);
  ok(`${t.name} says what is being given up`,
     /Stopping…/.test(body),
     'the house cancel shape: a label that promises what is discarded. See "How a cancel is wired"');
}

// ── 2. THE BROWSER TIER DOES NOT IMPORT AFTER A CANCEL ───────────────────────
// THE 23 MB CASE. `r.ok` can be true and the cancel still stands.
{
  const at = h.indexOf('_sfBrowserImport = async');
  const body = at > -1 ? h.slice(at, at + 6000) : '';
  const runAt = body.indexOf('_sfRunImport(');
  ok('the browser tier still runs an import', runAt > -1,
     'the import call moved - this check cannot see what it is guarding');
  if (runAt > -1) {
    const before = body.slice(0, runAt);
    // THE GUARD ITSELF, not merely the word. The first version of this check tested for
    // `_biCancelling` anywhere above the import - which its own declaration satisfies - so deleting
    // the guard still passed. The control below is what caught that, on the first run.
    ok('a cancelled browser capture never reaches the importer',
       /if\s*\(\s*_biCancelling\s*&&/.test(before),
       'nothing between the capture returning and _sfRunImport tests whether the user cancelled, so '
       + 'a download that COMPLETED in the gap is imported anyway - that is the orphan');
    ok('and the temp file goes back rather than being left behind',
       /linkImportCleanup/.test(before),
       'the cancelled branch must return the captured file the same way the success path does');
  }
}

// ── 3. MAIN HONOURS A CANCEL EVEN ON A COMPLETED DOWNLOAD ────────────────────
{
  const at = m.indexOf("ipcMain.handle('linkImport:browser'");
  ok('the browser capture handler is where expected', at > -1);
  const body = at > -1 ? m.slice(at, at + 9000) : '';
  ok('the capture exposes a cancel hook', /_linkBrowserCancel\s*=/.test(body),
     'nothing registers a way to stop this capture');
  ok('the hook aborts the DownloadItem', /\.cancel\(\)/.test(body),
     'a flag cannot stop an Electron download - the item itself must be cancelled');
  const doneAt = body.indexOf("once('done'");
  ok('the done handler is where expected', doneAt > -1);
  if (doneAt > -1) {
    const done = body.slice(doneAt, doneAt + 1800);
    const completedAt = done.indexOf("state !== 'completed'");
    ok('the cancel is checked BEFORE the completed/failed split',
       /cancelled/.test(done) && done.indexOf('cancelled') < (completedAt > -1 ? completedAt : 1e9),
       'a download that completes before the cancel lands takes the success path, and the bytes '
       + 'arriving does not un-ask the question');
  }
  ok('and the temp dir is dropped, not left', /dropDestDir\(\)/.test(body),
     'a cancelled import keeps nothing - including the partial');
  // VERIFIED REMOVAL, NOT A HOPEFUL ONE. The first cancel after the tier was wired came back
  // with no orphan source and an EMPTY `jmt-linkimport-*` still in temp: a plain rmSync with
  // `force: true` had removed the partial FILE and left the DIRECTORY, returning quietly. That is
  // the shape [B-436] exists for - "it did not throw" is not "it is gone".
  ok('the drop uses rmWithRetry, which verifies', /rmWithRetry/.test(body),
     'a bare rmSync can return success while the directory survives, which is how an empty temp '
     + 'dir outlived a cancel that was otherwise correct');
}

// ── 4. THE IPC IS REACHABLE END TO END ───────────────────────────────────────
ok('main handles linkImport:browserCancel',
   M.includes("ipcMain.handle('linkImport:browserCancel'"));
ok('preload exposes it', /linkImportBrowserCancel\s*:/.test(P));
ok('the renderer calls it', H.includes('electronAPI.linkImportBrowserCancel('));

// ── AND THE CHECKS PROVE THEY CAN FAIL ──────────────────────────────────
// A structural scan that reports clean is indistinguishable from one whose matcher stopped
// matching. Both mutations recreate the shipped defect exactly.
{
  const mutated = h.replace('_biCancelling && r && r.ok', 'false && r && r.ok');
  ok('the guard mutation applied', mutated !== h,
     'anchor not found - the control below proves nothing');
  if (mutated !== h) {
    const at = mutated.indexOf('_sfBrowserImport = async');
    const body = mutated.slice(at, at + 6000);
    const before = body.slice(0, body.indexOf('_sfRunImport('));
    ok('removing the cancel guard IS caught', !/if\s*\(\s*_biCancelling\s*&&/.test(before),
       'check 2 would have passed the shipped bug');
  }
}
{
  const mutated = m.replace('if (cancelled) { await dropDestDir(); finish({ ok: false, cancelled: true }); return; }', '');
  ok('the main-side mutation applied', mutated !== m, 'anchor not found');
  if (mutated !== m) {
    const at = mutated.indexOf("ipcMain.handle('linkImport:browser'");
    const body = mutated.slice(at, at + 9000);
    const done = body.slice(body.indexOf("once('done'"), body.indexOf("once('done'") + 1800);
    const completedAt = done.indexOf("state !== 'completed'");
    const stillGuarded = /cancelled/.test(done) && done.indexOf('cancelled') < (completedAt > -1 ? completedAt : 1e9);
    ok('dropping the completed-download guard IS caught', !stillGuarded,
       'check 3 would have passed a completed-but-cancelled download straight to the importer');
  }
}

console.log('');
console.log(fail === 0
  ? `link-import-tiers-cancellable: all ${pass} checks passed`
  : `link-import-tiers-cancellable: ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
