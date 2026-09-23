// Every export can be stopped, and stopping is always safe.            [B-005 item 4]
//
// ⭐⭐ WHY THIS EXISTS. The only way out of a running export was force-quitting the app, and
// force-quitting mid-write to a FAT32 card over USB mass storage is the precise corruption the
// whole SD guard was built to prevent. His words on a 109 MB export stuck at 32.3 MB: "no
// cancel... the only way out is potentially damaging." Nine doors had to gain one.
//
// The two invariants worth a test are not "does the button exist" - they are the ones that turn
// a cancel back into the hazard it was meant to remove:
//
//   1. STOPPING HAPPENS BETWEEN FILES. The check sits at the TOP of a copy loop, so the file in
//      flight always finishes. Move it below the copy and a cancel truncates a .wav on a card.
//   2. THE ZIP WRITER ABORTS, IT NEVER THROWS. Its progress hook is an EventEmitter handler, and
//      a throw inside one is an uncaught exception in the main process - the [B-418] shape, where
//      the app just disappears. Every other stopping point throws because it is on a call stack.
'use strict';
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const main = read('main.js');
const copy = read('sfExportCopy.js');
const sources = read('soundFontSources.js');
const entries = read('soundFontEntries.js');
const common = read('soundFontCommon.js');
const tracks = read('soundFontSharedTracks.js');
const html = read('renderer/index.html');
const gate = read('bulkImportGate.js');

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`);
}

// ── 1. Every writing export handler takes a cancel token ──
// His nine doors resolve to six handlers. A door added later that skips the wrapper is a door
// with no way out, which is exactly how this became a release blocker.
// ⚠️⚠️ SLICED TO THE NEXT HANDLER, NOT A CHARACTER COUNT. This used to take 700 chars from
// the handler's opening line, and a comment growing above the wrapper pushed the call out of
// the window - a false failure about code that was correct. Fixed-width slices have produced
// six false results in this suite in two days. Anchor on something that must exist.
for (const h of ['entries:exportToFolder', 'common:exportAsZip', 'common:exportToFolder',
                 'sharedTracks:exportToFolder', 'sfFile:export', 'sources:exportToDownloads',
                 // Added 2026-09-20: it writes a user-chosen destDir and had NO cancel at all.
                 // Missed by every earlier sweep because its name says nothing about exporting.
                 'sources:extractTo']) {
  const i = main.indexOf(`ipcMain.handle('${h}'`);
  const next = i < 0 ? -1 : main.indexOf('ipcMain.handle(', i + 20);
  const body = i < 0 ? '' : main.slice(i, next > i ? next : main.length);
  ok(`${h} runs under the cancel gate`, /_withExportCancel\(/.test(body),
     'a door that skips the wrapper is a door with no way out');
}

// ── 2. The gate is the tested one, not a second copy of that state ──
ok('the export gate reuses the module that already went wrong twice',
   /_exportGate = require\('\.\/bulkImportGate'\)\.createGate\(\{ exclusive: false \}\)/.test(main),
   'a private copy of this state is the one thing not to duplicate');
ok('a non-exclusive gate always issues a token',
   /if \(exclusive && busy\) return null;/.test(gate),
   'refusing a token would make an export silently uncancellable');
ok('a run retires only its own token',
   /end\(token\) \{[\s\S]{0,120}?tokens\.delete\(token\)/.test(gate)
   && !/tokens\.clear\(\)/.test(gate),
   'clearing the set disarms every other run in flight');
// ⚠️ The signature gained `opts` when the token started carrying the destination verdict
// ([B-005] item 4), so this used to be anchored on `_withExportCancel(run)` exactly and went
// stale the moment a parameter was added. Matched loosely on the name now - the assertion is
// about the finally, not about the arity.
ok('the wrapper retires the token in a finally',
   /async function _withExportCancel\([^)]*\) \{[\s\S]{0,700}?finally \{[\s\S]{0,80}?_exportGate\.end\(token\)/.test(main),
   'a leaked token makes the next cancel report work it is not stopping');
ok('the token carries the board-card verdict so cancel never re-measures',
   /token\.boardCard = !!opts\.boardCard/.test(main),
   'classifying at cancel time would cost ~1.9s at the exact moment the user wants it to stop');

// ── 3. ⚠️⚠️ THE SAFETY INVARIANT: nothing truncated is ever left behind ──
//
// ⚠️ THIS SECTION USED TO ASSERT "between files, never inside one" AND THAT RULE IS GONE.
// It was the right hazard with the wrong remedy: stopping only between files does keep a
// truncated .wav off the card, but it makes the user wait out the current write, which on a
// board's USB bridge is minutes. Interrupting mid-file and DELETING the partial gives the
// identical guarantee in about a second. The old assertion is kept in this comment on
// purpose - a reversed decision that leaves no trace reads later as an oversight.
//
// ⚠️⚠️ AND STRIP THE COMMENTS BEFORE CHECKING ORDER. The first version of this compared
// indexOf('shouldStop()') against indexOf('copyFileWithProgress') over the raw source, so
// the moment a comment above the loop MENTIONED copyFileWithProgress the test failed on
// prose while the code was correct. A positional check over text that includes commentary
// is measuring the documentation, not the program.
{
  const decomment = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const i = copy.indexOf('for (const item of fs.readdirSync(srcDir');
  const body = decomment(copy.slice(i, copy.indexOf('} else if (item.isFile())', i)));
  const stopAt = body.indexOf('shouldStop()');
  const copyAt = body.indexOf('copyFileWithProgress');
  ok('⚠️ the walk still checks cancel before descending',
     stopAt > -1 && (copyAt === -1 || stopAt < copyAt),
     'the between-files check is still the first line of defence, just no longer the only one');
  ok('cancel propagates into nested folders',
     /await copyTreeWithProgress\(srcPath, destPath, \{[^}]*shouldStop/.test(copy),
     'stopping at the top level while subtrees run on is a cancel in name only');

  // ── The new half: the file copy itself stops and cleans up ──
  // ⚠️ RE-ANCHORED 2026-09-23. This pinned the exact argument list, and the third argument
  // changed when the chunk sink began carrying the file's name - so it failed on a change that
  // left its own subject untouched. The rule is that shouldStop REACHES the copy, whatever is
  // handed in beside it; this file already carries the lesson that a test pinned to an
  // identifier fails on a rename and passes on a deletion elsewhere.
  ok('⚠️⚠️ the tree walk hands shouldStop DOWN to the file copy',
     /await copyFileWithProgress\(srcPath, destPath,[\s\S]{0,140}?,\s*shouldStop\)/.test(copy),
     'without this the walk stops between files and the current write runs to completion');

  const fn = decomment(copy.slice(copy.indexOf('function copyFileWithProgress'),
                                 copy.indexOf('async function copyTreeWithProgress')));
  ok('⚠️⚠️ the chunk handler checks cancel BEFORE writing the chunk',
     /rs\.on\('data'[\s\S]{0,200}?shouldStop\(\)[\s\S]{0,120}?ws\.write/.test(fn),
     'checking after the write pays for one more chunk on the transport we are trying to stop using');
  ok('⚠️⚠️ the drain wait has its own exit',
     /once\('drain'[\s\S]{0,160}?shouldStop\(\)/.test(fn),
     'a cancel pressed while a slow card drains would otherwise wait out the whole write');
  ok('⚠️⚠️ a torn-down write deletes its partial',
     /unlinkSync\(destPath\)/.test(fn) && /dropPartial\(\)/.test(fn),
     'a truncated .wav left on a card is the exact state the old between-files rule existed to prevent');
  ok('the partial is removed on the shared failure path, not only on cancel',
     /const fail = \(err\) => \{[\s\S]{0,300}?dropPartial\(\)/.test(fn),
     'a disk error mid-write leaves the same truncated file a cancel would');
}

// ── 3b. The throw has to be readable as a cancel everywhere it can now land ──
//
// ⚠️⚠️ ADDING A THROW TO A PATH THAT ALREADY HAD A CATCH-ALL IS HOW "Export failed: Export
// cancelled" GETS REINTRODUCED. copyFileWithProgress can now throw where it previously only
// returned, so every catch between it and the user has to tell a cancel from a fault.
{
  const tracks = read('soundFontSharedTracks.js');
  ok('the tracks export reads a cancel as a cancel, not an error',
     /isCancel\(err\)\)\s*\{\s*_canceled = true/.test(tracks),
     'this catch stringifies whatever it gets into a red failure dialog');
}

// ── 4. ⚠️⚠️ THE CRASH INVARIANT: the zip writer aborts, never throws ──
{
  const i = sources.indexOf("archive.on('entry'");
  const handler = sources.slice(i, sources.indexOf('});', i));
  ok('⚠️⚠️ the zip writer ABORTS from its event handler',
     /archive\.abort\(\)/.test(handler));
  ok('⚠️⚠️ and never throws from inside it',
     !/throw /.test(handler),
     'a throw in an EventEmitter handler is an uncaught exception in main - the B-418 crash');
  // ⚠️ BOTH SETTLE PATHS, because a cancelled zip can leave by either. If the rejection wins the
  // race the code after the await never runs; if 'close' wins, it does. Only one of the two had
  // cleanup at first, and the missing one left a part-built .zip at the destination wearing the
  // real filename - the artefact most likely to be mistaken for a finished export.
  ok('a cancelled zip removes its partial on the returning path',
     /if \(_canceled\) \{[\s\S]{0,200}?unlinkSync\(destZipPath\)[\s\S]{0,140}?throw _cancelErr\(\)/.test(sources));
  ok('and on the rejecting path',
     /catch \(err\) \{[\s\S]{0,400}?isCancel\(err\)\) \{ try \{ fs\.unlinkSync\(destZipPath\)/.test(sources));

  // ⚠️⚠️ A CANCEL MUST NEVER BE REPORTED AS A DAMAGED SOURCE. Aborting the archive looks exactly
  // like a file that will not read - entries stop completing - so the stall watchdog fired and
  // told him his font was corrupt. It is not, and that message is far worse than none.
  ok('⚠️⚠️ the stall watchdog stands down when the stop was deliberate',
     /if \(_canceled\) \{ clearInterval\(watchdog\); return finish\(reject, _cancelErr\(\)\); \}/.test(sources),
     'his report: cancelled during compress, got "the source has a damaged or unreadable file"');
  ok('every settle path reports a cancel as a cancel',
     /const settle = \(fn, arg\) => finish\(_canceled \? reject : fn, _canceled \? _cancelErr\(\) : arg\);/.test(sources),
     'tearing a stream down surfaces as close, error or warning - which one is not ours to predict');
  // ⚠️ SCOPED TO THE BLOCK, NOT A CHARACTER BUDGET. Written first as a {0,420} window between
  // abort and destroy, which the explanatory comment between them promptly overran - the same
  // stale-by-construction shape corrected in export-conflict-one-dialog.test.js an hour earlier.
  ok('aborting also closes the sink so nothing waits on the watchdog',
     (() => {
       const i = sources.indexOf('if (!_canceled && opts.shouldStop && opts.shouldStop()) {');
       if (i < 0) return false;
       const block = sources.slice(i, sources.indexOf('\n    }', i));
       return /archive\.abort\(\)/.test(block) && /fileStream\.destroy\(\)/.test(block);
     })(),
     'abort stops the feed but leaves the stream open - that 90s wait IS what he sat through');
}

// ── 5. A cancel is an outcome, never a failure ──
ok('a distinct cancel type, not a string match',
   /class ExportCancelled extends Error/.test(copy) && /const isCancel = \(err\)/.test(copy),
   'without it a user cancel surfaces as a red "Export failed: Export cancelled"');
ok('the multi-file loop does not file a cancel as a failed file',
   /isCancel\(err\)\) \{ _canceled = true; break; \}[\s\S]{0,120}?failed\.push/.test(main),
   'it would end in "some files failed to export" naming the user click as the fault');
// ⚠️ THIS USED TO CHECK THE FUNNEL'S OWN INLINE ORDERING - that `res.canceled` appeared
// before `_sfExportFailed` within 1,200 characters of the tooBig branch. The funnel now
// delegates to `_sfExportOutcome`, so that ordering lives in ONE place and is asserted in
// export-outcome-shared.test.js. Demanding the old inline shape here would push the code back
// toward the per-door copies this work removed.
{
  // ⚠️⚠️ ANCHORED ON THE FUNCTION, NOT ON THE LINE THIS TEST WAS ABOUT.
  // It used to slice from `if (res.tooBig) {` - the very code the migration DELETED - so the
  // segment silently became an empty string and every assertion over it passed or failed for
  // reasons unrelated to the door. An anchor that is itself the subject of the change cannot
  // survive the change.
  const i = html.indexOf('const _sfExportFiles = async');
  const j = html.indexOf('// Unified dispatcher', i);
  const seg = (i > 0 && j > i) ? html.slice(i, j) : '';
  // ⚠️⚠️ RE-ANCHORED 2026-09-22. Both assertions described the funnel owning its own
  // refusal and its own ending. Both branches now run through the shared runner, which owns the
  // refusal and the ending for every door - so the old checks would pass only on an UNMIGRATED
  // door. The rules they protect are unchanged and now hold for fourteen doors instead of four.
  ok('the funnel hands its refusal and its ending to the runner',
     /await _sfRunExport\(\{/.test(seg)
     && !/_sfRefuseNotEnoughRoom/.test(seg)
     && !/_sfExportOutcome\(/.test(seg),
     'a door keeping either one back also keeps the bug they were built for: a tooBig recovery '
     + 'that writes first, and a cancel reported as a success');
  ok('⭐ and both of its branches go through it',
     (seg.match(/await _sfRunExport\(\{/g) || []).length >= 2,
     'multi-path is doors 2/5/7/9 and single-path is the right-click items; one migrated and '
     + 'one left behind is how this function had two personalities in the first place');
}

// ── 6. Partial cleanup follows what the thing IS ──
// A font is a unit and half of one mounts, lists, then fails when a sound is called for. Tracks
// are independent files and every one that finished is complete. Different answers on purpose.
// ⚠️ THIS USED TO BE ONE REGEX WITH A 320-CHARACTER WINDOW and went stale the moment the
// replace path gained its restore branch, which now sits between the two anchors. Fixed-width
// slices have produced three false failures in this suite in two days; assert the BEHAVIOURS
// instead, each on its own.
//
// A cancelled font export has two correct endings, and which one applies depends on whether
// anything was there before:
//   no original  -> the partial folder was minted by this call, so it simply goes
//   an original  -> the partial is renamed to DELETE.<name> and the original comes back
ok('a cancelled font export with no original removes its partial',
   /out\.partialRemoved = removed/.test(entries) && /fs\.promises\.rm\(targetDir/.test(entries),
   'a folder this call created is safe to remove and a half font must not stay on a card');
ok('a cancelled font export with an original RESTORES it instead',
   /rename\(asideDir, targetDir\)/.test(entries) && /out\.restored = true/.test(entries),
   'removing the partial without restoring would leave the user with neither font');
// ⚠️ Another fixed-width window (320 chars), stale the moment this door gained the same
// board-card offer the font door had. Assert the two behaviours instead.
ok('a cancelled voice-pack export removes its partial when removal is cheap',
   /out\.partialRemoved = removed/.test(common) && /fs\.promises\.rm\(targetDir/.test(common),
   'a half voice pack on a card mounts and then fails when a sound is called for');
ok('⭐ and OFFERS instead when removal would be slow, exactly as the font door does',
   /opts\.boardCard && _ed\.isSlowWriteJob/.test(common) && /out\.offerCleanup = junk/.test(common),
   'same shape of job, same destination, same thresholds - it must get the same treatment');
ok('a cancelled tracks export KEEPS what landed',
   /isCancel\(err\)\) \{\s*\n\s*return \{ ok: true, canceled: true, destPath: targetDir/.test(tracks)
   && !/isCancel\(err\)\)[\s\S]{0,200}?rm\(targetDir/.test(tracks),
   'finished tracks are complete playable files; deleting them tidies nothing');

// ── 7. The button lives on the modal, and never outlives its work ──
ok('the shared progress modal owns the cancel affordance',
   /id="sf-bulk-progress-cancel"/.test(html) && /offerCancel\(onCancel\)/.test(html),
   'nine doors wiring their own button is nine chances to word it differently');
ok('it is hidden until an operation opts in',
   /id="sf-bulk-progress-actions" style="display:none/.test(html),
   'a button that cannot stop anything is worse than no button');
// ⚠️ ASSERTS THE INTENT, NOT LINE ADJACENCY. This used to require `clearCancel()` on the line
// immediately before `classList.add('active')`, and adding the eject-checkbox reset between
// them broke it - a false failure about correct code. Adjacency is not the property that
// matters; being inside the opening block is.
{
  const i = html.indexOf("if (m && !m.classList.contains('active'))");
  const j = html.indexOf("m.classList.add('active')", i);
  const openBlock = (i > 0 && j > i) ? html.slice(i, j) : '';
  ok('the handler is cleared when the modal opens',
     /this\.clearCancel\(\);/.test(openBlock),
     'a stale handler is a button reporting it stopped something already finished');
  ok('⭐ and so is the eject checkbox',
     /this\.clearEject\(\);/.test(openBlock),
     'a box left ticked from a previous export would eject a card this run never asked about');
  ok('the handler is cleared when the modal closes',
     /clearCancel\(\);\s*\n\s*this\.modal\(\)\?\.classList\.remove\('active'\)/.test(html));
}
ok('⚠️ it says what is still happening rather than vanishing',
   /Cancelling… \(finishing current file\)/.test(html),
   'main stops BETWEEN files, so the modal must not disappear while a copy is still running');

// ── 8. The renderer-side loop stops too ──
// Main stopping the current font is only half of it: the bulk export's loop lives here, and
// without this the next font starts and the cancel reads as having been ignored.
ok('the bulk export breaks its own loop on a cancel',
   /if \(r && r\.canceled\) \{ _exportCanceled = true; break; \}/.test(html));
ok('and the steps after it do not start',
   /for \(const cs of commonSlots\) \{\s*\n\s*if \(_exportCanceled\) break;/.test(html)
   && /if \(includeTracks && willWriteTracks && !_exportCanceled\)/.test(html));
ok('a stopped bulk export still gets its full summary, headed by the fact it stopped',
   /if \(canceled\) \{[\s\S]{0,260}?Export stopped/.test(html),
   'swapping in a short dialog throws away the counts and free space exactly when they matter');

// ── 9. ⚠️⚠️ THE LOOP MUST YIELD, OR THE CANCEL CANNOT BE DELIVERED ──
// A flag is worthless if nothing can set it. The right-click multi-file export walked folders
// with copyFileSync inside a readdirSync loop - not one await in it - so main's event loop never
// yielded, the export:cancel IPC was never delivered, the window went "Not Responding", and the
// export finished anyway. Third appearance of this defect class here (see [B-398], and
// soundFontSharedTracks.js:89 "a synchronous loop cannot report on itself").
ok('⚠️⚠️ the multi-file export walks folders with the ASYNC shared copier',
   /await copyTreeWithProgress\(srcAbs, outRoot, \{[\s\S]{0,300}?shouldStop: _shouldStop/.test(main),
   'a synchronous walk blocks the event loop and cannot receive the cancel at all');
ok('and the hand-rolled synchronous walk is gone',
   !/const walk = \(sd, dd\) =>/.test(main),
   'leaving it reachable is leaving the freeze reachable');

// ── 10. A bar still climbing after Cancel reads as being ignored ──
ok('the modal stops claiming progress once stopping',
   /if \(this\.cancelling\) \{[\s\S]{0,260}?indeterminate/.test(html)
   && /setProgress\(frac, detail\) \{[\s\S]{0,260}?if \(this\.cancelling\)/.test(html),
   'his report: "this may or may not be hung... really not sure" - it was not, it just looked it');
ok('but the filename and the clock keep moving',
   /if \(this\.cancelling\) \{[\s\S]{0,480}?d\.textContent = file[\s\S]{0,160}?elapsedText/.test(html),
   'freezing everything is how "stopping" becomes indistinguishable from "hung"');
ok('the stopping state is reset with the handler',
   /clearCancel\(\) \{\s*\n\s*this\.cancelling = false;/.test(html));

console.log(failures ? `\nexport-cancel: ${failures} failing` : '\nexport-cancel: all passing');
process.exit(failures ? 1 : 0);
