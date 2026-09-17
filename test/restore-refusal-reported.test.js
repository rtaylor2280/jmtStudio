/**
 * A restore that refuses a file says so  [B-401]
 *
 * Found 2026-09-16 by reading the IPC layer while wiring [B-399] into both restore paths.
 *
 * ⭐⭐ THE BACKEND ALWAYS DID THE WORK AND THE ANSWER WAS THROWN AWAY AT THE DOOR.
 * applyReplace and applyMerge both collect every declined file into `restoreRefused` and
 * return it as `result.refused` — that is [B-370], built on purpose. Neither ipcMain
 * handler passed it on, so the renderer could not report it.
 *
 * ⚠️⚠️ AND THE DIRECTION OF THE SILENCE IS THE BAD ONE. A restore that strips a program
 * out of the incoming archive is doing exactly the right thing, and then tells the user
 * their library restored cleanly. They have no way to learn their backup contained
 * something we would not put back — precisely the fact [B-370] exists to surface.
 *
 * ⚠️⚠️ THE ENTRY PRESCRIBED THE WRONG DIALOG, and that is the part worth pinning. It said
 * to call `_sfShowProgramRefusal`. That dialog IMPOUNDS first, which assumes the file is
 * in the library to be taken out of it. A restore never let it in — `_screenRestored`
 * unlinks the extracted file on the way past and the user's archive is untouched. Calling
 * it would fire an impound per finding against paths that do not exist and then report
 * those failures as the news. `_sfShowNotAdded` is the dialog built for this direction,
 * and its own comment says so: "THE IMPORT SIDE IS NOT THE EXPORT SIDE."
 *
 * Run: node test/restore-refusal-reported.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const html    = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const mainJs  = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const backend = fs.readFileSync(path.join(ROOT, 'soundFontBackup.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Body of one ipcMain.handle block, so an assertion cannot be satisfied by a match
// somewhere else in a 6000-line file.
function handlerBody(channel) {
  const i = mainJs.indexOf(`ipcMain.handle('${channel}'`);
  if (i < 0) return '';
  const j = mainJs.indexOf("\nipcMain.handle(", i + 1);
  return mainJs.slice(i, j < 0 ? mainJs.length : j);
}

// ── the backend was never the problem ──────────────────────────────────────
{
  ok('the backend returns refused from BOTH restore paths',
     (backend.match(/return \{[^}]*refused: restoreRefused[^}]*\}/g) || []).length === 2,
     'if this drops to 1, the defect moved upstream rather than being fixed');
}

// ── both handlers pass it on ───────────────────────────────────────────────
{
  for (const ch of ['sfBackup:applyMerge', 'sfBackup:applyReplace']) {
    const body = handlerBody(ch);
    ok(`${ch} passes refused through`, /refused: \(result && result\.refused\) \|\| \[\]/.test(body),
       'the handler returned ok/manifest/counts and dropped refused on the floor');
  }
  // ⚠️ The export side was always correct — it is what made this an asymmetry rather than
  // a design decision. It must stay correct.
  ok('⚠️ the export handler still passes refused (no regression)',
     /refused: result\.refused \|\| \[\]/.test(mainJs));
}

// ── the renderer reports it, on both doors ─────────────────────────────────
{
  ok('⭐ the merge completion reads refused',
     /const _mergeRefused = \(result && result\.refused\) \|\| \[\];/.test(html));
  ok('⭐ the replace completion reads refused',
     /const _replRefused = \(result && result\.refused\) \|\| \[\];/.test(html));

  // ⚠️ PRESENCE IS NOT EXECUTION. Reading the field and never acting on it is the same
  // silence wearing a variable name.
  ok('⭐⭐ merge SHOWS it and skips the plain completion',
     /if \(_mergeRefused\.length\) \{ await _sfShowNotAdded\(_mergeRefused, _mergeMsg\); return; \}/.test(html));
  ok('⭐⭐ replace SHOWS it and skips the plain completion',
     /if \(_replRefused\.length\) \{ await _sfShowNotAdded\(_replRefused, _replMsg\); return; \}/.test(html));

  // ⚠️⚠️ BOTH DOORS. This entry exists because only one had been walked through.
  ok('⚠️⚠️ neither door is left unwired',
     (html.match(/await _sfShowNotAdded\(_(merge|repl)Refused, _(merge|repl)Msg\);/g) || []).length === 2);
}

// ── the RIGHT dialog, for the right reason ─────────────────────────────────
{
  // A restore must never impound: the file never entered the library.
  const restoreRegion = (() => {
    const i = html.indexOf('const _mergeRefused');
    const j = html.indexOf('document.getElementById(\'btn-sf-export-backup\')');
    return i >= 0 && j > i ? html.slice(i, j) : '';
  })();
  ok('the restore region could be located', !!restoreRegion);
  ok('⚠️⚠️ no restore path calls the impounding dialog',
     !!restoreRegion && !/_sfShowProgramRefusal/.test(restoreRegion),
     'that dialog removes from the library; a restore never let the file in');

  // And the completion folds INTO it rather than showing first.
  ok('⭐ _sfShowNotAdded accepts a prefix to fold the completion into',
     /const _sfShowNotAdded = async \(refused, prefixHtml\) => \{/.test(html));
  ok('⭐⭐ and actually renders it',
     /\(prefixHtml \? `\$\{prefixHtml\}<div style="height:10px"><\/div>` : ''\)/.test(html),
     'accepting a parameter and ignoring it is the vacuous version of this fix');

  // ⚠️ The four pre-existing callers pass one argument; the new parameter must be optional.
  ok('⚠️ the existing import callers still work unchanged',
     (html.match(/await _sfShowNotAdded\(res\.refused\);/g) || []).length === 4,
     'a required second parameter would have silently changed four other surfaces');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall restore refusal tests passed');
process.exit(failures ? 1 : 0);
