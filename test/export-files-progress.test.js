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
  ok('⭐ and runs through the shared runner rather than a fourth hand-rolled bar',
     /_sfRunWithByteProgress\('Exporting files'/.test(caller));
  ok('⚠️ the destination is handed to the backend',
     /destDir: pick\.destDir/.test(caller));
  ok('⚠️ cancelling at the picker does nothing at all',
     /if \(!pick \|\| !pick\.ok \|\| !pick\.destDir\) return;/.test(caller),
     'no modal, no work, no error — the user changed their mind');
  // ⚠️ The single-item path MUST keep its instant click.
  ok('⚠️⚠️ a single item still lets the backend ask, so the click stays instant',
     /} else \{[\s\S]{0,400}sfExportFiles\(\{ kind, id, paths: subPaths, asFile \}\)/.test(caller),
     'probing whether one path is a directory before opening a picker is the delay the rule forbids');
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
  ok('⭐ progress is emitted only when the renderer supplied the destination',
     /const _emit = preDest \? _sfByteProgressEmitter\(event\) : null;/.test(handler),
     'a caller with no bar has no listener to send to');
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
