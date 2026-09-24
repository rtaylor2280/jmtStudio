// Nothing here is allowed to exist without a caller.  [B-005 item 4]
//
// ⭐⭐ WHY THIS FILE EXISTS. On 2026-09-20 I built `exportDestination.preflight()`, its IPC and
// its preload bridge, and wired `boardCard` onto the cancel token - then reported all of it as
// built. It had ZERO callers. Every door still used the old pair of checks, and `token.boardCard`
// was set and never read. The code was correct, complete, tested, and did nothing.
//
// ⚠️ That is the failure this codebase already named: READ THE CONSUMER BEFORE BUILDING THE
// PRODUCER, and "a usage count of one, where the one is mine, is the tell." A producer with no
// consumer passes every test you write for it, because the tests are written by the same person
// who believed it was wired.
//
// So these assertions are about WIRING, not behaviour. They fail when something is defined and
// not used - the one condition a normal unit test cannot see.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const main = read('main.js');
const pre  = read('preload.js');
const H    = read('renderer/index.html');
const copy = read('sfExportCopy.js');
const dest = read('exportDestination.js');

// ── preflight: producer, IPC, bridge, and REAL callers on both sides ──
ok('exportDestination exports preflight', /preflight,/.test(dest) || /preflight\b/.test(dest));
ok('main exposes exportDest:preflight', /ipcMain\.handle\('exportDest:preflight'/.test(main));
ok('preload bridges it', /preflightExportDest:/.test(pre));
{
  const mainCalls = (main.match(/exportDestination'\)\.preflight\(/g) || []).length;
  ok(`⚠️⚠️ main.js actually CALLS preflight (${mainCalls} sites)`, mainCalls >= 2,
     'sfFile:export and sources:exportToDownloads both size the job in main - if they still '
     + 'compose checkFit + describe themselves, the refactor did nothing');
  const rendCalls = (H.match(/_sfPreflightDestination\(\{/g) || []).length;
  ok(`⚠️⚠️ the renderer actually CALLS its preflight helper (${rendCalls} sites)`, rendCalls >= 4,
     'the renderer-driven doors are the majority - a helper nobody calls is not a refactor');
}
// ── ⚠️⚠️ A REFUSAL MUST NOT ORPHAN THE DOOR'S PROGRESS MODAL ─────────
//
// He hit this on the tracks export to a full volume 2026-09-21: the refusal dialog drew on top
// of the door's "Comparing with your library · 54 of 54" modal, and dismissing the dialog
// revealed that modal **frozen and undismissable** — owned by a function that had already
// returned, with a bar nothing would ever move again.
//
// ⭐ CAUSE: the doors call `if (!pf.proceed) return;` and do NOT hide first, so the guarantee
// has to live in the preflight. Every path that sets `proceed:false` drops the bar before
// showing its dialog. ⚠️ If a new dialog path is added here without `dropBar()`, this fails.
{
  const i = H.indexOf('async function _sfPreflightDestination');
  const j = H.indexOf('window._sfPreflightDestination', i);
  const fn = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('the preflight can drop a door\'s bar before a dialog', /const dropBar = \(\) =>/.test(fn));
  const refusals = (fn.match(/out\.proceed = false/g) || []).length;
  const drops    = (fn.match(/dropBar\(\);/g) || []).length;
  ok(`every proceed:false path drops the bar first (${refusals} refusals, ${drops} drops)`,
     drops >= refusals && refusals > 0,
     'a door that returns on !proceed never hides the modal itself - if this helper does not, '
     + 'the modal is left on screen owned by a function that has already exited');
  ok('⚠️ and it only hides a modal that is actually up',
     /classList\.contains\('active'\)/.test(fn),
     'hiding unconditionally would close a surface this call never raised');
}

ok('the old refuse+warn pair is gone from every door',
   !/_sfRefuseNotEnoughRoom\(_d\)/.test(H) && !/await _sfWarnSlowWrite\(\{/.test(H),
   'two implementations of one decision is what this replaced');

// ⚠️⚠️ A DESTINATION CALL MUST HAPPEN UNDER AN EXPLANATION - AND WHERE THAT COMES FROM CHANGED.
//
// ⭐ THESE TWO ASSERTIONS INVERTED ON 2026-09-23. They required every destination call to be
// wrapped in `_sfPreflightBusy` - a 150 ms-delayed overlay - which was right while most doors
// had no progress surface. Once the runner began supplying a modal to every door, that wrapper
// became a SECOND surface for one wait: the funnel's multi-select export showed the small
// overlay for the probe, then the runner's modal for the free-space check. His call was to
// delete the overlay rather than guard it, so passing these meant the bug was still wired in.
//
// ⚠️ THE INTENT IS UNCHANGED AND IS WHAT IS ASSERTED NOW: nobody waits on a destination with
// nothing on screen. What supplies the explanation is the runner's own modal, which means the
// test is POSITIONAL - the raise has to precede both the plan and the preflight, and it sat
// below the plan until today, which is exactly how two surfaces appeared in sequence.
{
  const runner = H.slice(H.indexOf('const _sfRunExport = async'),
                         H.indexOf('const _sfRunExportBackup = async'));
  ok('the runner body was located', runner.length > 500,
     'anchor moved - re-find it before trusting the positions below');
  const raiseAt = runner.indexOf("_sfDeleteProgress.show('Checking the destination…'");
  const planAt = runner.indexOf('await door.plan()');
  const preflightAt = runner.indexOf('_sfPreflightDestination({');
  ok('the runner raises its modal, plans, then preflights - in that order',
     raiseAt > -1 && planAt > -1 && preflightAt > -1
       && raiseAt < planAt && planAt < preflightAt,
     `raise@${raiseAt} plan@${planAt} preflight@${preflightAt} - a raise AFTER the plan leaves a `
     + 'slow plan explaining itself with nothing, which is what the deleted overlay was covering');
  // A raise that is never taken back down strands an explanation over an operation that ended.
  ok('and it drops the modal again when the plan refuses or is cancelled',
     /_dropRaised\(\);\s*\n?\s*return out;/.test(runner) || /await _dropRaised\(\)/.test(runner),
     'both early exits out of plan() have to put back what the raise took');
}
// ⚠️⚠️ DELIBERATELY RED WHILE A DIAGNOSTIC IS IN THE TREE. [2026-09-23] A temporary
// `[bp]` console probe was added to the byte-progress runner to separate "no events arrive"
// from "events arrive and done stays 0", which reading could not. It must not be committed.
// ⭐ This is a guard, not a bug: if the suite is failing ONLY on this line, the probe is still
// in and the fix is to take it out - twice today something was left behind because removing it
// depended on someone remembering.
ok('no temporary console diagnostic is left in the renderer',
   !/\[bp\]/.test(H) && !/\[srcprog\]/.test(H),
   'REMOVE THE TEMPORARY DIAGNOSTIC before committing — two different probes have now needed '
   + 'this guard in one day, which is why it checks a set rather than a single marker');

// ── ⚠️⚠️ NOTHING IN AN EXPORT PATH MAY SWALLOW A CANCEL ──────────────
//
// ⭐⭐ HIS REASONING, 2026-09-23, and it is the instrument I should have used first: "when we
// cancelled before it was deleting the file. As it should. And you can't return to delete until
// export resolves. What is telling you is that there was an issue in the process."
//
// The delete is GATED on the export resolving successfully. So a font disappearing after a cancel
// is only possible if the export reported success - the outcome was proof of the defect before any
// file was examined. I went and diffed zip entries instead, trying to establish from the artifact
// what the system's own contract had already stated.
//
// THE DEFECT IT ENCODES: the curation injection was wrapped in `catch { /* best-effort */ }` so a
// curation failure could never sink a finished export. Correct intent - and it discarded the USER'S
// OWN STOP along with it, so the export reported success and the delete went ahead.
//
// ⚠️ A bare `catch {}` around anything that can throw ExportCancelled is this bug. Real errors may
// still be swallowed there; a cancel may not.
{
  const lines = main.split('\n');
  const THROWERS = /injectIntoZip|copyFileWithProgress|copyTreeWithProgress|writeBufferWithProgress|exportToDownloads|zipFolderToFile/;
  // ⚠️⚠️ THE REGION IS THE TRY BLOCK, NOT A FIXED WINDOW. [2026-09-23]
  // The first cut read the 14 lines PRECEDING the catch and asked whether a thrower appeared in
  // them. That is not the question. A thrower fourteen lines up may sit in a completely different
  // statement, and it produced two standing false positives that made this check red for a day:
  //     try { event.sender.send('soundFonts:exportProgress', ...); } catch {}
  //     try { await fs.promises.rm(dest, { recursive: true, force: true }); } catch {}
  // Neither guards a thrower - an IPC send and a cleanup rm cannot raise ExportCancelled - but both
  // had one nearby. A red check with known-bogus hits gets read as "that one is always red", which
  // is worse than no check: the day it goes red for a REAL reason, nobody looks.
  // ⭐ So walk back to the `try {` this catch belongs to and ask whether the thrower is INSIDE it.
  // ⚠️ AND A LINE-NUMBER EXEMPTION WOULD ALREADY HAVE ROTTED. The second site moved 6305 -> 6321
  // during this evening's edits. Exempting by call SHAPE survives the file moving; a line number
  // silently starts exempting whatever slid into its place. Same fixed-width-slice defect
  // test/export-runner-ratchet.test.js warns about in its own header - third instance in one day.
  const tryRegion = (i) => {
    for (let j = i; j >= Math.max(0, i - 40); j--) {
      if (/\btry\s*\{/.test(lines[j])) return lines.slice(j, i + 1).join('\n');
    }
    return lines.slice(Math.max(0, i - 14), i + 1).join('\n');  // no try found: keep the old window
  };
  const isBad = (i) => {
    if (!/catch\s*\{\s*\/\*|catch\s*\{\s*\}/.test(lines[i])) return false;  // bare/comment-only catch
    if (!THROWERS.test(tryRegion(i))) return false;                         // cannot receive a cancel
    const after = lines.slice(i, Math.min(i + 10, lines.length)).join('\n');
    return !/isCancel/.test(after);                                        // re-thrown is correct
  };
  const bad = [];
  lines.forEach((_l, i) => { if (isBad(i)) bad.push(`${i + 1}: ${lines[i].trim().slice(0, 70)}`); });
  ok('⚠️⚠️ no bare catch discards a cancel in an export path', bad.length === 0,
     bad.join(' | ') + ' — a swallowed cancel reports success, and anything gated on that success '
     + 'then runs. That is how a delete proceeded after the user stopped the export it depended on.');

  // ── ⚠️⚠️ AND THE CHECK PROVES IT STILL CATCHES THE REAL SHAPE ──────
  // Narrowing a matcher to kill false positives is exactly how a check quietly stops matching
  // anything. This reconstructs the ACTUAL defect - the curation catch as it was written before
  // [B-420] removed it - and requires that the narrowed logic still flags it.
  {
    const saved = lines.slice();
    const at = lines.length;
    lines.push(
      '        try {',
      '          const r = await cur.injectIntoZip(result.destPath, payload, onProgress);',
      '          if (r && r.injected) curation = r.carried;',
      '        } catch { /* best-effort: never sink a finished export */ }');
    ok('⚠️⚠️ the real swallowed-cancel shape IS still caught', isBad(at + 3),
       'the narrowed matcher no longer sees the defect it was written for, so a clean result from '
       + 'it means nothing at all');
    // A bare catch around something that CANNOT cancel must still pass, or the narrowing did nothing.
    const at2 = lines.length;
    lines.push("        try { event.sender.send('soundFonts:exportProgress', pending); } catch {}");
    ok('and a catch guarding a non-thrower is NOT flagged', !isBad(at2),
       'the false positives this narrowing exists to remove are still being reported');
    lines.length = 0; lines.push(...saved);
  }
}

ok('the deleted overlay has no callers left on the export path',
   !/_sfPreflightBusy\(/.test(H.replace(/\/\/[^\n]*/g, '')),
   'a live call to a deleted helper is a ReferenceError at the worst moment');

// ── boardCard: set AND read ──────────────────────────────────────────
ok('the gate token is given boardCard', /token\.boardCard = !!opts\.boardCard/.test(main));
ok('⚠️⚠️ and a door PASSES it to the module that decides cleanup',
   /boardCard: !!token\.boardCard/.test(main),
   'set-and-never-read is exactly what this file exists to catch');
ok('⚠️⚠️ and the module READS it to choose rename-vs-delete',
   /opts\.boardCard && _ed\.isSlowWriteJob/.test(read('soundFontEntries.js')),
   'without a reader, the whole board-card cleanup rule is decoration');
// ⚠️ THIS ASSERTED A VARIABLE NAME (`boardCard: _fontBoardCard`) AND THE NAME WAS THE WRONG
// THING TO HOLD ON TO. When door 1 moved onto the shared runner the local disappeared - the
// runner runs the one preflight now and hands `boardCard` to `produce` - so the check failed
// while the behaviour it guards was not merely intact but better. A test pinned to an
// identifier fails on a rename and passes on a deletion elsewhere.
//
// ⭐ The intent is what to assert: NO caller may invoke exportEntryToFolder without sending
// boardCard, whatever it happens to be called at that call site. Main cannot re-measure it -
// that is a ~1,900 ms device lookup, banned at cancel time.
{
  const calls = [...H.matchAll(/exportEntryToFolder\(\{[\s\S]{0,400}?\}\)/g)].map((m) => m[0]);
  ok('exportEntryToFolder call sites were located', calls.length >= 2,
     `found ${calls.length}; re-check the matcher if this dropped`);
  const missing = calls.filter((c) => !/\bboardCard\b/.test(c));
  ok('every renderer call SENDS boardCard from a preflight',
     missing.length === 0,
     'main cannot know it without re-measuring, which is banned at cancel time. Missing in: '
     + missing.map((c) => c.slice(0, 70).replace(/\s+/g, ' ')).join(' | '));
}

// ── The running tally the cleanup decision reads ─────────────────────
ok('the tree walk increments the file tally', /wrote\.files = \(wrote\.files \|\| 0\) \+ 1/.test(copy));
// ⚠️ RE-ANCHORED 2026-09-23, same reason as its twin in export-cancel: it pinned the exact
// argument list, and the third argument changed when the chunk sink began carrying the file's
// name. The ORDERING is the rule - the tally increments after the copy resolves - and that is
// what is asserted now, whatever is passed alongside it.
ok('⚠️ and counts AFTER the await, so an interrupted file is not counted',
   /await copyFileWithProgress\(srcPath, destPath,[\s\S]{0,140}?,\s*shouldStop\);\s*\n[\s\S]{0,400}?wrote\.files/.test(copy),
   'its partial is deleted, so counting it would inflate the tally by a file that is gone');
ok('a door threads the tally in', /wrote: token\.wrote/.test(main));

// ── ⚠️⚠️ THE OFFER MUST BE WIRED AT EVERY DOOR THAT CAN MAKE IT ──────
//
// Found reviewing for parity 2026-09-21. The font door offered the slow cleanup; the voice-pack
// door removed its partial unconditionally - so cancelling a voice pack could sit through a
// per-file delete across the bridge that cancelling a font never did. Same shape of job, same
// destination, same thresholds, two different treatments.
//
// ⚠️ And adding the branch was not enough: the handler passed no `boardCard` and the module
// threaded no `wrote`, so the new branch could never fire. A branch that cannot execute is the
// same defect as a producer with no consumer, wearing different clothes.
{
  const common = read('soundFontCommon.js');
  ok('the voice-pack door has the offer branch',
     /opts\.boardCard && _ed\.isSlowWriteJob/.test(common));
  // ⚠️ WINDOW WIDENED 2026-09-23, and the reason is worth keeping: this failed on a COMMENT.
  // Three explanatory lines were added between the call and its arguments and pushed
  // `boardCard` past a 400-character window, so a test about wiring went red over prose. The
  // fact it asserts was never touched. A distance-bounded match is a fine way to keep an
  // assertion near its subject and a bad way to pin one, because the gap is not the rule.
  ok('⚠️⚠️ and its handler actually passes boardCard',
     /soundFontCommon\.exportCommonToFolder[\s\S]{0,900}?boardCard: !!token\.boardCard/.test(main),
     'without it the branch is unreachable and the parity is cosmetic');
  ok('⚠️⚠️ and the module threads the tally into the copy',
     /wrote: opts\.wrote \|\| null/.test(common),
     'a zero tally never crosses the threshold, so the offer never fires');
  ok('the renderer sends boardCard on the bulk loop calls',
     /boardCard: _bulkBoardCard/.test(H),
     'established once per run - re-measuring per font would cost ~1.9s each');
  const perRunLookups = (H.match(/boardCard: _bulkBoardCard/g) || []).length;
  ok(`both bulk-loop doors send it (${perRunLookups} call sites)`, perRunLookups >= 2,
     'fonts and common folders both write in that loop');
}

// ── The cleanup offer reaches the user ───────────────────────────────
ok('the module can return an offer instead of deleting', /out\.offerCleanup = junk/.test(read('soundFontEntries.js')));
ok('⚠️⚠️ and the shared ending ACTS on it', /if \(r\.offerCleanup\) await _sfOfferPartialCleanup/.test(H),
   'a field nobody reads is the same bug in a different place');
ok('the remove IPC exists and is name-guarded',
   /ipcMain\.handle\('fs:removeSetAside'/.test(main) && /\^DELETE\\\./.test(main),
   'an unguarded recursive delete reachable from the renderer outlives the feature it was for');
ok('preload bridges the guarded remove', /removePath:/.test(pre));

// ── Safe eject: module, IPC, bridge, checkbox, and the end offer ──────
ok('safeEject module exists', fs.existsSync(path.join(root, 'safeEject.js')));
ok('main exposes media:eject', /ipcMain\.handle\('media:eject'/.test(main));
ok('preload bridges it', /ejectMedia:/.test(pre));
ok('⚠️ the checkbox exists in the markup', /id="sf-bulk-progress-eject"/.test(H));
ok('⚠️⚠️ and something ARMS it', /offerEject\(\)/.test(H),
   'a checkbox that is never shown is a requirement reported as built and absent in the app');
ok('⚠️⚠️ and the end-of-export path READS it', /_sfDeleteProgress\.wantsEject\(\)/.test(H),
   'a ticked box that changes nothing is worse than no box');
ok('it is cleared when the modal opens', /this\.clearEject\(\);/.test(H),
   'a box left ticked would eject a card the next export never asked about');

// ── The last uninterruptible write ───────────────────────────────────
ok('a chunked buffer writer exists', /async function writeBufferWithProgress/.test(copy));
ok('⚠️⚠️ and the single-file export branches USE it',
   (main.match(/writeBufferWithProgress\(buf,/g) || []).length >= 4,
   'writeFileSync blocks the event loop, so the cancel IPC cannot even be delivered');
ok('no synchronous whole-buffer export writes remain',
   !/fs\.writeFileSync\((outPath|filePath|out), buf\)/.test(main),
   'third instance of the same shape: a write with no checkpoints');

// ── Backup: the exemption he overruled elsewhere and never revisited ──
//
// ⚠️⚠️ THIS WAS ALMOST REPORTED AS DONE ON THE STRENGTH OF A COMMENT. The module's note said
// backup was no longer exempt, the register table said "now included" - and no caller
// preflighted it. The rule existed; the door did not follow it. Exactly the producer-without-
// consumer shape this file exists to catch, caught one step before it became a false claim.
// ⚠️⚠️ RE-ANCHORED 2026-09-21 [B-420]. Backup was the first door migrated onto the shared
// runner, so it no longer calls `_sfPreflightDestination` itself — the runner does, for every
// door, which is the entire point. The rule is unchanged and now holds by construction rather
// than by this door remembering: nothing can be written until the destination has been checked.
//
// ⭐ So the test moved UP a level. Instead of "does this door preflight", it asserts the two
// things that make the answer structural: the door goes through the runner, and the runner
// preflights before it produces.
ok('⚠️⚠️ the backup door goes through the shared export runner',
   /const _sfRunExportBackup = async \(destPath, survey\) => \{[\s\S]{0,2000}?await _sfRunExport\(\{/.test(H),
   'a truncated backup is the artefact someone reaches for when everything else went wrong');
{
  const i = H.indexOf('const _sfRunExport = async (door');
  const j = H.indexOf('// Convenience for the export+delete sequence', i);
  const body = (i > 0 && j > i) ? H.slice(i, j) : '';
  const pf  = body.indexOf('_sfPreflightDestination(');
  const prod = body.indexOf('door.produce(');
  ok('and the runner refuses before it produces anything',
     pf > 0 && prod > pf,
     'checking after the write begins is not a refusal, it is a post-mortem');
  ok('⭐ and the produce step runs through the shared progress surface',
     /_sfRunWithByteProgress\(_title, \(\) => door\.produce\(/.test(body),
     'a door painting its own bar is the drift this runner exists to end');
}

// ── ⚠️⚠️ DIALOG SIGNATURES, WHICH FAILED SILENTLY AND LOOKED FINE ─────
//
// `promptConfirm` takes ONE OBJECT. Called as (title, message, opts) the title string lands
// in `opts`, destructures to nothing, and EVERY default applies - so the dialog renders
// "Confirm / Are you sure?" with an OK and a Cancel that behave identically, because callers
// of an informational dialog ignore the result.
//
// ⭐ FOUR CALLS WERE WRONG AND TWO OF THEM WERE MINE, WRITTEN THE SAME NIGHT. His reports:
// "cancel and ok from there do the same thing", and - worse - "export on common folders went
// through eject... don't recall asking for it." He was never asked. He was shown a contextless
// "Are you sure?" and OK ejected his card.
//
// ⚠️ THE FIRST SWEEP FOR THESE MISSED TWO, because it matched `promptConfirm('` and both were
// written multiline with the title on the next line. A grep that encodes a formatting habit
// is not a sweep. This pattern tolerates the newline.
ok('⚠️⚠️ no promptConfirm call uses the positional form',
   (H.match(/promptConfirm\(\s*\n?\s*['`"]/g) || []).length === 0,
   'a string in the opts slot silently becomes "Confirm / Are you sure?" with two dead buttons');
ok('promptError is called positionally, as it is declared',
   (H.match(/promptError\(\{/g) || []).length === 0,
   'it takes (title, message) - the inverse mistake');
ok('showToast is called with a message first',
   (H.match(/showToast\(\{/g) || []).length === 0);

// ── The eject cannot fire without being asked for ────────────────────
// ⚠️⚠️ THE EJECT PROMPT IS GONE ON PURPOSE (2026-09-21). It was a modal of its own shown
// after the summary, and his ruling killed it: "The eject shouldn't be its own modal. It
// should take place on the summary screen, so it can show the status of it right there."
// Replacing the summary with an eject dialog threw away the counts, the destination and the
// free-space line at the moment the user is deciding whether to pull the card.
ok('⭐⭐ there is no standalone eject dialog',
   !/title: 'Eject the card\?'/.test(H) && !/_sfMaybeOfferEject\s*=/.test(H),
   'that is the surface he ruled against - the control belongs where the export reports');
ok('the eject control lives ON the summary',
   /id="sf-eject-btn"/.test(H) && /_sfEjectRowHtml\(ejectTarget/.test(H),
   'same pattern as the summary path link: injected into the HTML, wired after render');
ok('⭐ and reports status in place rather than closing the summary',
   /id="sf-eject-status"/.test(H),
   'the counts and free-space line have to stay on screen while they decide');
ok('⭐⭐ the checkbox PRESSES the button rather than running a second path',
   /if \(auto\) btn\.click\(\)/.test(H),
   'his framing: "whether you have to manually click the button or if the button is '
   + 'automatically clicked for you" - a parallel automatic path is a second thing to keep '
   + 'in agreement, which is the mistake this feature spent two days removing');
ok('doors without a summary carry it as a toast ACTION, not a new modal',
   /_sfOfferEjectInToast/.test(H) && /action: \{ label: 'Eject'/.test(H),
   'the toast helper already supports an action and already extends its timer for one');
ok('the checkbox is cleared when the modal opens', /if \(b\) b\.checked = false;/.test(H));
// ⚠️ Re-anchored 2026-09-21: same rule, new source. The offer reads the shared identity cache
// instead of a per-door PowerShell spawn; what is still under test is the STRICT comparison.
ok('the offer requires removable === true',
   /_sfDestIdentity\.removable\([^)]*\)\s*(?:!==|===)\s*true/.test(H),
   'null means cannot tell - offering on unknown would prompt about internal disks');
// ⚠️ THIS USED TO REQUIRE THE WINDOWS SENTENCE IN THE RENDERER, and that is now the wrong
// shape. The explanation moved into the platform table as `lingerNote`, which is a FUNCTION on
// Windows and NULL on macOS/Linux — because the lingering drive letter is a Windows BEHAVIOUR,
// not a phrasing. A test demanding the literal string would have pushed the code back toward
// shipping a Windows explanation on every platform.
{
  const eject = read('safeEject.js');
  // ⚠️ RE-ANCHORED 2026-09-21 [B-420]. The rule is unchanged - Windows has a note, the other
  // platforms have null - but the note is now ONE SHORT SENTENCE. The old text asserted the
  // volume was "the reader with no card in it", which we do not know and which was wrong for
  // his F:, and it ran to a paragraph in a status line beside a button. His verdict: "this isn't
  // a reader... way too much information."
  // ⭐ Microsoft's own wording for this state is "Safe To Remove Hardware" and explains nothing
  // further, so the inline status now says just that and this note is kept short for wherever
  // it is genuinely worth saying.
  ok('⭐ Windows still has a note about the letter that stays behind',
     /lingerNote: \(label\) =>/.test(eject) && /Windows may keep showing \$\{label\}/.test(eject),
     'measured: the letter lingers for board cards and USB readers, so the behaviour is real '
     + 'even though the inline status no longer explains it');
  ok('⭐⭐ and the other platforms OMIT it rather than translating it',
     /lingersAfterEject: false,[\s\S]{0,200}?lingerNote: null/.test(eject),
     'null is the signal to drop the sentence - on macOS the mount point really does go away');
  ok('⚠️ no eject message in the renderer names an operating system',
     (() => {
       const i = H.indexOf('const _sfMaybeOfferEject');
       const seg = i > 0 ? H.slice(i, i + 6000) : '';
       // Strip comments, then look for a bare OS name in a user-facing string.
       const code = seg.replace(/\/\/[^\n]*/g, '');
       return !/(['"`])[^'"`]*\b(Windows|macOS|Linux)\b[^'"`]*\1/.test(code);
     })(),
     'a Mac build must not say "Windows" - the OS name comes from vocab.osName');
}

// ── Doors with their own summary still get the offer ─────────────────
ok('⭐ the primary export carries the eject on its summary',
   (H.match(/\.\.\.\(await _sfEjectContext\(destDir\)\)/g) || []).length >= 2,
   'it keeps its own per-item summary, which is right - and the control now sits ON that '
   + 'summary rather than in a dialog after it');
// ⚠️ THIS ASSERTED A ONE-LINE SPELLING (`if (!canceled) _sfWireEjectRow`) and broke the moment
// the guarded call became a block, while the guard it protects was untouched. Third instance of
// this shape today, after `boardCard: _fontBoardCard` and `_sfResolveTrackConflicts(plan.differing)`.
// Assert the RELATIONSHIP: every wiring of the summary's eject row is preceded by the cancel
// guard, however the caller formats it.
ok('⚠️ a cancelled export gets no eject offer',
   (() => {
     const calls = [...H.matchAll(/_sfWireEjectRow\(\{\s*target:\s*ejectTarget/g)];
     if (!calls.length) return false;
     // The guard must appear between the start of the statement and the call, close enough that
     // it is plainly governing it rather than coincidentally nearby.
     return calls.every((m) => /if \(!canceled\)[\s\S]{0,120}$/.test(H.slice(0, m.index)));
   })(),
   'the card is half-written; the useful next action is deciding what to do about it');

// ── versions:export, the door that had nothing ───────────────────────
ok('versions:export runs a preflight', /_sizeOf\(srcRoot\)/.test(main) && /preflight\(destFolder/.test(main));
// ⚠️⚠️ SLICED TO THE NEXT HANDLER. The first cut used a 4,000-character window and failed on
// a gate 66 lines down - about 5,300 characters. That is the SEVENTH fixed-width-slice false
// failure across this suite in two days. The rule is now absolute: never bound a search by a
// character count; anchor on text that must exist.
{
  const i = main.indexOf("ipcMain.handle('versions:export'");
  const j = main.indexOf('ipcMain.handle(', i + 20);
  const body = (i > 0) ? main.slice(i, j > i ? j : main.length) : '';
  ok('versions:export runs under the cancel gate', /_withExportCancel\(/.test(body),
     'the largest multi-file export outside Sound Fonts, previously with no way to stop it');
}
ok('its synchronous recursive copy is gone',
   !/e\.isDirectory\(\) \? cpDir\(sp, dp\) : fs\.copyFileSync\(sp, dp\)/.test(main),
   'readdirSync + copyFileSync with no awaits is the shape that froze the app');

console.log(failed ? `\n${failed} FAILED` : '\nexport-wiring: all passing');
process.exit(failed ? 1 : 0);

// ── ⚠️⚠️ A CANCEL MUST NOT BE REPORTED AS A FAILURE ──────────────── [B-420]
//
// `_sfExportOutcome` tests `!r.ok` BEFORE it tests `r.canceled`, so a door whose produce()
// returns `ok:false` on a cancel gets "Export failed - unknown error" — the user's own click
// rendered as a red error. The convention (spelled out in export-outcome-shared.test.js) is
// that a cancel returns ok:true WITH canceled set.
//
// ⭐ FOUND BY HIM ON THE FIRST CANCEL OF THE FIRST MIGRATED DOOR, 2026-09-21. The backup IPC
// returns `{cancelled:true, ok:false}` and produce mapped `ok` straight across. The convention
// was already written down and I broke it anyway while migrating door one — which is precisely
// why it is normalised in the RUNNER now and not left to each door to remember.
{
  const i = H.indexOf('const _sfRunExport = async (door');
  const j = H.indexOf('// Convenience for the export+delete sequence', i);
  const body = (i > 0 && j > i) ? H.slice(i, j) : '';
  ok('⚠️⚠️ the runner forces ok:true when a door reports a cancel',
     /if \(res && res\.canceled\) res\.ok = true;/.test(body),
     'otherwise the outcome handler shows "Export failed" for a deliberate cancel');
  const norm = body.indexOf('res.ok = true');
  const read = body.indexOf('out.ok = !!(res && res.ok)');
  ok('⭐ and it does so BEFORE reading ok',
     norm > 0 && read > norm,
     'normalising after the read would leave out.ok false and still report a failure');
}

// ── ⚠️⚠️ EVERY "EXPORT COMPLETE" DIALOG MUST BE ABLE TO EJECT ────────
//
// ⭐⭐ THIS HAS NOW BEEN THE SAME BUG TWICE, WHICH IS WHY IT IS A CHECK AND NOT A NOTE.
// The during-export eject CHECKBOX is rendered by the progress modal, from a completely different
// code path to the summary that has to honour it. So a door can lose the eject BUTTON entirely and
// still look correct all the way through the export - the checkbox is right there, ticked.
//   • Backup lost it when it migrated to the shared runner. The note left beside that fix said
//     "nobody noticed, because the during-export checkbox still appeared."
//   • The source-export door lost it the same way, and Ryan found it on the first real export of
//     the evening, to F:: "I'm missing the eject. I saw the check box, but not here after."
//
// ⭐ `_sfCompletionNotice` and `_sfShowExportSummary` both derive the row themselves, so a door that
// goes through either is safe by construction. The defect shape is a door building its OWN summary
// with a bare promptConfirm - which is exactly what both offenders did.
//
// ⚠️ ANCHORED ON THE ENCLOSING HANDLER, NOT A FIXED WINDOW. A fixed slice around the title is the
// defect this same file was failing on earlier today (and that two other tests warn about): comments
// get added, the window stops covering the call, and the check silently passes. The region here runs
// from the nearest preceding handler/function anchor to the next one, so it grows with the code.
{
  const lines = H.split('\n');
  const ANCHOR = /addEventListener\(|^\s*(const|async function|function)\s+[A-Za-z_$][\w$]*\s*=?\s*(async)?\s*(\(|function)/;
  const CARRIES = /_sfEjectRowHtml|_sfWireEjectRow|_sfCompletionNotice|_sfShowExportSummary/;
  const regionOf = (i) => {
    let from = 0;
    for (let j = i; j >= 0; j--) { if (ANCHOR.test(lines[j])) { from = j; break; } }
    let to = lines.length;
    for (let j = i + 1; j < lines.length; j++) { if (ANCHOR.test(lines[j])) { to = j; break; } }
    return lines.slice(from, to).join('\n');
  };
  // ⚠️⚠️ "Export complete" WAS TOO NARROW, AND THREE DOORS PROVED IT IN ONE EVENING. [B-420]
  // The first cut keyed on that exact title. But a door that saves a file and then reveals it does
  // not have to be CALLED "Export complete" - the delete-and-export endings are titled "Deleted N
  // fonts" and "Deleted, and a copy was saved", and both were missing the eject while matching
  // nothing this check looked at.
  // ⭐ THE REAL PREDICATE IS "did this ending put a file somewhere the user might want to unplug?",
  // and the honest proxy for that is a handler that offers to REVEAL the destination. If it can say
  // "Show in folder", a card could be that folder.
  // ⚠️ `showItemInFolder` / `openFolder` deliberately, not the dialog title: the titles are user-
  // facing copy and will keep changing, while the reveal is structural.
  const REVEALS = /showItemInFolder\(|electronAPI\.openFolder\(/;
  const offenders = [];
  lines.forEach((l, i) => {
    const isCompletion = /title:\s*'Export complete'/.test(l);
    // A promptConfirm offering "Show in folder" is an ending about a destination.
    const isReveal = /confirmText:\s*'Show in folder'/.test(l);
    if (!isCompletion && !isReveal) return;
    const region = regionOf(i);
    if (isReveal && !REVEALS.test(region)) return;   // not actually revealing anything
    if (!CARRIES.test(region)) offenders.push(i + 1);
  });
  ok('⚠️⚠️ no "Export complete" dialog is built without an eject row', offenders.length === 0,
     `line(s) ${offenders.join(', ')} render a completion dialog whose handler never mentions an `
     + 'eject row. The checkbox shown DURING the export comes from the progress modal, so this '
     + 'reads as working right up until the user looks for the button it arms. Route the door '
     + 'through _sfCompletionNotice, or build the row the way it does.');

  // ⚠️⚠️ AND THE CHECK PROVES IT CAN FAIL. Narrowing by "enclosing handler" is exactly the kind of
  // region rule that can quietly select the whole file and pass everything.
  {
    const saved = lines.slice();
    lines.push("      document.getElementById('x').addEventListener('click', async () => {",
               "        const r = await promptConfirm({",
               "          title: 'Export complete',",
               "          messageHtml: 'done',",
               "        });",
               "      });");
    const at = lines.length - 4;   // the title line
    ok('⭐ a completion dialog with NO eject row IS caught',
       !CARRIES.test(regionOf(at)),
       'the region rule is selecting too much - it found an eject mention in a handler that has '
       + 'none, so a clean result from this check means nothing');
    lines.length = 0; lines.push(...saved);
  }
}
