/**
 * Exporting a file selection reports itself  [B-408]
 *
 * The fifth of [B-400]'s doors, split out because it could not be fixed the same way. Every
 * other export got a bar; this one stayed silent, and a wrapper could not change that:
 * `sfFile:export` opened its OWN picker partway through its own work, so a modal raised around
 * the call sat at zero BEHIND a native dialog for as long as the user was choosing a folder.
 * That reads as a hang — the failure `_sfExportSourceToDownloads` already warns about.
 *
 * ⭐⭐ THE ORDER HAD TO CHANGE, NOT THE DECORATION. The renderer asks first, so the destination
 * is known before any work starts and the bar can be honest from its first frame.
 *
 * ⚠️⚠️ ONLY THE MULTI-PATH CASE IS HOISTED, and that is a line rather than half a job. The
 * single-path branches choose between a SAVE dialog and a FOLDER dialog based on whether the
 * path is a directory — which the renderer cannot know without probing, and probing before
 * opening a picker is the delay-before-the-dialog that "a click always acts instantly" forbids.
 *
 * ⚠️ AND WHEN THE SIZE IS UNKNOWN IT SAYS SO. Source content lives inside an archive; a partial
 * total is worse than none, because the bar would reach 100% with files still to write.
 *
 * Run: node test/export-files-progress.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html   = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
// The shared copier, so the chunk-carries-its-filename rule can be asserted where it lives.
const copyJs = fs.readFileSync(path.join(ROOT, 'sfExportCopy.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Slice to the export helper itself, not a char window — the lesson relearned in
// preset-delete-key.test.js when comments pushed an assertion out of range.
const caller = (() => {
  const i = html.indexOf('const _sfExportFiles = async');
  if (i < 0) return '';
  const j = html.indexOf('\n      };', i);
  return j < 0 ? '' : html.slice(i, j);
})();
ok('the export helper was found', caller.length > 0);

// ── the renderer asks first ────────────────────────────────────────────────
{
  ok('⭐⭐ a multi-file export picks the destination BEFORE any work',
     /subPaths\.length > 1/.test(caller) && /pickExportDir/.test(caller),
     'the whole fix is the order; a bar in front of the old flow sat behind a native dialog');
  // ⚠️ RE-ANCHORED 2026-09-22 when the funnel migrated. This asserted the door called
  // `_sfRunWithByteProgress` ITSELF, which was "the shared runner" at the time this was written.
  // The runner now wraps produce in that call for every door, so the door naming it directly is
  // the OLD shape - the assertion had quietly inverted: passing meant unmigrated.
  ok('⭐ and runs through the shared runner rather than a fourth hand-rolled bar',
     /await _sfRunExport\(\{[\s\S]{0,600}?title: 'Exporting files'/.test(caller)
     && !/_sfRunWithByteProgress\('Exporting files'/.test(caller),
     'the runner owns the bar now; a door raising its own is the drift the ratchet exists to stop');
  ok('⚠️ the destination is handed to the backend',
     /destDir: pick\.destDir/.test(caller));
  ok('⚠️ cancelling at the picker does nothing at all',
     /if \(!pick \|\| !pick\.ok \|\| !pick\.destDir\) return;/.test(caller),
     'no modal, no work, no error — the user changed their mind');
  // ⚠️⚠️ RE-ANCHORED 2026-09-22, AND THE REASONING BEHIND IT WAS THE THING THAT WAS WRONG.
  // This asserted the single-item path let the BACKEND open the picker, on the grounds that the
  // renderer could not know directory-from-file without a probe, and probing before a dialog is
  // the delay the click-acts-instantly rule forbids. The premise was false: the CALL SITES knew
  // all along - "Export folder…" passes a directory and says so in its own label. The fact just
  // was not travelling.
  // ⭐ So the click is still instant AND the renderer owns the picker: no probe, one property.
  ok('⚠️⚠️ a single item needs no probe to choose its picker',
     /const _wantFolder = !!isDir && !asFile;/.test(caller)
     && /pickExportFilePath/.test(caller)
     && /pickExportDir/.test(caller),
     'the caller supplies isDir, so no work happens between the click and the dialog');
}

// ── the backend honours a pre-picked destination ───────────────────────────
{
  const handler = (() => {
    const i = mainJs.indexOf("ipcMain.handle('sfFile:export'");
    const j = mainJs.indexOf("\nipcMain.handle(", i + 1);
    return mainJs.slice(i, j < 0 ? mainJs.length : j);
  })();
  ok('the handler was found', handler.length > 0);
  ok('⭐ it accepts a destination instead of always asking',
     /destDir: preDest/.test(handler));
  ok('⚠️ but still asks when it is not given one',
     /let destDir = preDest \|\| null;/.test(handler) && /if \(!destDir\) \{/.test(handler),
     'the older callers must keep working unchanged');
  // ⚠️ TIGHTENED [B-203/238]: a PROBE also arrives with a destination and also has no bar -
  // it runs precisely so the question can be asked before anything is raised. Emitting
  // there would push bytes at a listener that does not exist yet and seed the real bar's
  // first frame from a call that wrote nothing.
  // ⚠️⚠️ THIS ASSERTION INVERTED ON 2026-09-23 AND WAS PINNING THE BUG IN PLACE. It required
  // the gate to read `preDest` ALONE - the destination FOLDER - and a single-file export
  // supplies `preFile` instead. So the renderer had chosen a destination, was showing a bar and
  // waiting for ticks, and this gate decided nobody was listening. Passing meant silent.
  // ⭐ The question the gate asks is "did the renderer choose the destination, and is therefore
  // driving a bar?" Either field answers it; neither alone does. `!probe` is untouched and is
  // still the point of the original tightening: a probe has no bar by design.
  ok('⭐ progress is emitted whenever the renderer chose the destination and means to write',
     /const _emit = \(\(preDest \|\| preFile\) && !probe\) \? _sfByteProgressEmitter\(event\) : null;/.test(handler),
     'a folder destination and a file destination are both destinations; gating on one of them '
     + 'left every single-file export with a bar nobody fed');
  // ── ⚠️⚠️ TRUE BYTES, NOT A LUMP WHEN THE FILE CLOSES ───────────── [B-420, 2026-09-23]
  //
  // ⭐ HIS REPORT, and the scenario is what made it legible: one large wav and three small ones.
  // "it sits at 0 for like a min... then goes to the top." The bar was on bytes, but bytes were
  // credited only once a whole file had been written - so the large file WAS the flat minute and
  // the three small ones were the jump. `writeBufferWithProgress` takes a per-chunk callback and
  // every call site passed `null` to it. A function named withProgress, handed no progress.
  //
  // ⭐ So the rule is: no export write may pass a null sink. Asserted as a COUNT of remaining
  // nulls rather than by inspecting one call, because there were four write sites across three
  // branches and checking the one I was looking at is how the other three stayed silent.
  {
    const nulls = [...handler.matchAll(/writeBufferWithProgress\([^)]*?,\s*null\s*,/g)].length;
    ok('⚠️⚠️ no export write is handed a null progress sink', nulls === 0,
       `${nulls} call site(s) still pass null - that write reports nothing while it runs`);
    ok('the single-file write reports its own bytes and name',
       /writeBufferWithProgress\(buf, filePath, \(n\) => \{[\s\S]{0,200}?_bDone \+= n;/.test(handler),
       'his rule: "it shouldn\'t matter if 1 or multiple"');
    ok('the multi-path file write reports its own bytes and name',
       /writeBufferWithProgress\(buf, out, \(n\) => \{[\s\S]{0,200}?_bDone \+= n;/.test(handler));
    ok('the folder write is given a chunk sink too',
       /await writeDirTo\(subPath, outRoot, \(n, rel\) => \{/.test(handler),
       'a whole font folder landing in one lump is the same defect with a bigger gap');
  }
  // ⚠️⚠️ AND THE OLD PER-FILE CREDIT MUST BE GONE, NOT KEPT AS A BELT-AND-BRACES. Crediting
  // `buf.length` as well as every chunk counts each file twice, and the bar reaches 100% at the
  // halfway mark - which looks like a FASTER export rather than a broken one, so nobody reports
  // it. One source of truth for `_bDone`.
  ok('⚠️⚠️ bytes are credited once, not twice',
     !/_bDone \+= \(buf \? buf\.length : 0\)/.test(handler),
     'the per-file lump and the per-chunk sink cannot both be live');
  // The name travels with the bytes: nowhere upstream can recover it, because by the time the
  // chunk arrives the walk has moved on to the next file. [his: "we need to show which file"]
  ok('the tree copier tells its caller which file each chunk came from',
     /onBytes \? \(\(n\) => onBytes\(n, _rel\)\) : null/.test(copyJs),
     'a bar that knows how much moved and not what moved is half an answer');

  ok('⚠️⚠️ the bar lands on 100% whatever route each item took',
     /_emit\.onBytes\(\{ done: _bTotal, total: _bTotal, name: '' \}\); _emit\.flush\(\);/.test(handler),
     '[B-389]: refused, failed or written, it still reaches the end');

  // ⚠️⚠️ The honesty rule: an incomplete total must become NO total.
  ok('⚠️⚠️ an unsizable selection reports total 0 rather than a partial one',
     /if \(!sizable\) _bTotal = 0;/.test(handler),
     'a partial total would sail the bar to 100% with files still to write');
}

// ── and the renderer draws "unknown" as unknown ────────────────────────────
{
  ok('⭐⭐ no total means an indeterminate bar, not one pinned at zero',
     /if \(!total\) \{[\s\S]{0,220}setIndeterminate\(/.test(html),
     'a determinate bar stuck at 0 reads as a hang; a fabricated fraction is worse');
  ok('⚠️ the component owns that state rather than the call site',
     /setIndeterminate\(labelText, file, elapsedText\) \{/.test(html),
     'hand-rolling it at one call site is how the next caller gets it wrong');
  ok('⚠️ and it still shows the filename and the clock',
     /setIndeterminate\(labelText, file, elapsedText\) \{[\s\S]{0,400}elapsedText \|\| ''/.test(html),
     'motion without a claim is the point — silence is what we are fixing');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall export-files progress tests passed');
process.exit(failures ? 1 : 0);
