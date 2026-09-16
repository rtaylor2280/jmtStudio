/**
 * Leaving Mass Storage comments out MOUNT_SD_SETTING  [B-170]
 *
 * ⏭ THIS ENTRY WAS RE-SPECCED 2026-09-16 AND THIS SUITE REPLACES A DELETED ONE.
 * The original shipped a PREFLIGHT check that warned when the define was inert. He
 * pulled it back out on 09-14, and the reason was a rule about the registry rather
 * than a judgement about the case: "we don't have anything else in pre-flight that's
 * convenience only... it will never cause an error in compile or on saber."
 * test/mount-sd-usb-check.test.js was deleted with it.
 *
 * ⭐ THE JOB DID NOT GO AWAY, IT MOVED TO THE POINT OF CHANGE. His words:
 *     "it moves it from the place it was in where it was doing it as part of a
 *      preflight to instead live on change, commenting it out so that it's not there
 *      when you don't need it and not giving anybody the impression that they still
 *      have it when they don't."
 * The reason is the user's BELIEF, not the dead code: an inert #define MOUNT_SD_SETTING
 * left in a config reads to its owner as SD protection they do not have.
 *
 * ⚠️ AND HIS RULE ABOUT WHAT THIS SUITE MAY CONTAIN, from the same conversation:
 *     "having a QA test to test the negative, meaning test that something's gone,
 *      doesn't really make sense... it's simply a dev test to prove that it's gone."
 * So nothing here asserts the absence of the old preflight check. This tests the
 * feature that replaced it.
 *
 * Run: node test/mount-sd-comment-on-leave.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const html  = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'renderer', 'buildPanel.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── the handler exists and is reachable from the dropdown ──────────────────
{
  ok('the leave handler is defined on window',
     /window\.commentMountSdSettingOnLeave = function \(\)/.test(html));

  // ⚠️ THE CHECK THAT ACTUALLY MATTERS. A handler nobody calls looks identical to a
  // working one from inside this file, and optional chaining means a wrong name fails
  // SILENTLY forever. A usage count of one, where the one is its own definition, is
  // the tell. So: assert the CALLER, in the other file.
  ok('⭐ the USB dropdown calls it',
     /window\.commentMountSdSettingOnLeave\?\.\(\)/.test(panel),
     'defined but never called is the failure mode this class of change dies of');

  const defs  = (html.match(/commentMountSdSettingOnLeave/g)  || []).length;
  const calls = (panel.match(/commentMountSdSettingOnLeave/g) || []).length;
  ok('…and the name matches on both sides', defs >= 1 && calls >= 1,
     `${defs} in index.html, ${calls} in buildPanel.js`);
}

// ── it fires on the TRANSITION out, not on every change ────────────────────
{
  const guard = /if \(!\/msc\/i\.test\(selectedUsb\) && \/msc\/i\.test\(prevUsb \|\| ''\)\) \{/;
  ok('⭐ gated on leaving Mass Storage, not merely on not being in it',
     guard.test(panel),
     're-picking another non-MSC mode would otherwise re-fire on an already-commented define');

  // The mirror it is modelled on must still be there and still be the other direction.
  ok('the ON direction is untouched',
     /if \(\/msc\/i\.test\(selectedUsb\) && !\/msc\/i\.test\(prevUsb \|\| ''\)\) \{/.test(panel));
  ok('and the two guards are opposites, not duplicates',
     panel.indexOf("if (/msc/i.test(selectedUsb) && !/msc/i.test(prevUsb || '')) {")
       !== panel.indexOf("if (!/msc/i.test(selectedUsb) && /msc/i.test(prevUsb || '')) {"));
}

// ── what it does, and what it must NOT do ──────────────────────────────────
{
  const fn = html.slice(html.indexOf('window.commentMountSdSettingOnLeave'),
                        html.indexOf('window.commentMountSdSettingOnLeave') + 700);

  ok('it only acts on an ACTIVE define',
     /if \(!_configHasMountSdSetting\(editor\.getValue\(\)\)\) return;/.test(fn), fn);
  ok('it reuses the existing commenter rather than a second one',
     /_commentOutMountSdSetting\(\)/.test(fn), fn);
  ok('it toasts, and says WHY rather than what was clicked',
     /showToast\('MOUNT_SD_SETTING does nothing without Mass Storage/.test(fn), fn);

  // ⚠️ NO DIALOG. ui-conventions.md: confirm when it destroys, toast when it does not,
  // never both. Commenting a line loses nothing and is one undo away.
  ok('⭐ no dialog on this path',
     !/promptConfirm|_offerProtectSd|promptError/.test(fn),
     'a confirm here would be the guard-by-reflex move; the trigger is unambiguous');

  // ⚠️ BUFFER ONLY. Keeps clear of the unruled 09-14 finding where an SD fix wrote a
  // config the user had not saved.
  ok('⭐ it does not write the file',
     !/_applySdFixAndMaybeSave|saveConfig|writeFile/.test(fn),
     'the edit is Monaco + setDirty; the normal save path owns the disk');

  // And the shared commenter it leans on must stay buffer-only too, or the assertion
  // above is true about the wrong layer.
  const commenter = html.slice(html.indexOf('function _commentOutMountSdSetting'),
                               html.indexOf('function _commentOutMountSdSetting') + 800);
  ok('…and neither does the commenter it calls',
     /_atomicEdit\(editor, 'mount-sd-setting-comment'/.test(commenter)
     && !/_applySdFixAndMaybeSave|writeFile/.test(commenter), commenter);
  ok('the edit is undoable as one step',
     /_atomicEdit\(/.test(commenter),
     'a multi-edit comment-out would need two undos and the toast promises one');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall mount-sd leave tests passed');
process.exit(failures ? 1 : 0);
