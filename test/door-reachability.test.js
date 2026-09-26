// Every door the maps claim is covered must actually be reachable.  [B-389, 2026-09-26]
//
// ⚠️⚠️ FOUND BY AUDITING PROGRESS BARS, WHICH IS NOT WHERE ANYONE WOULD LOOK FOR IT. Two IPC
// handlers emit progress to channels no renderer subscribes to. Pulling that thread found the
// reason: nothing in the app can invoke them at all. `sources:extractTo` and
// `soundFonts:importFont` have a handler, a preload bridge, and ZERO callers - and git says
// neither ever had one, so they were born unwired rather than regressed.
//
// ⭐⭐ THE DEFECT IS NOT THE DEAD CODE, IT IS THE FALSE COVERAGE. `sources:extractTo` is named
// by export-door-map, import-door-map AND export-cancel as a live door, and on 2026-09-20 it
// was given a cancel. Three maps and a hardening pass, all spent on a door nobody can open, and
// every one of those tests passed - because they check MAIN-SIDE properties (the handler exists,
// it runs under the cancel gate) and none of them asks whether a user can reach it.
//
// ⭐ SO THIS IS AN ASSERTION, NOT AN EXEMPTION. The other maps keep listing these doors, because
// the day one is wired up it must already have its cancel and its preflight. What this file adds
// is the other half: while a door is unreachable, say so out loud, and FAIL THE MOMENT THAT
// CHANGES so it gets folded into the covered set deliberately rather than silently.
// The door-map files say it themselves: "an allowlist is how a check quietly stops checking."
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const main    = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

// Every renderer file, so "no caller" means no caller anywhere rather than no caller in the
// one file I happened to open.
const rendererDir = path.join(root, 'renderer');
const rendererText = fs.readdirSync(rendererDir)
  .filter((f) => /\.(js|html)$/i.test(f))
  .map((f) => fs.readFileSync(path.join(rendererDir, f), 'utf8'))
  .join('\n');

// handler -> the preload bridge that would reach it, and why it is listed here.
const UNREACHABLE = {
  'sources:extractTo': {
    bridge: 'extractFromSource',
    note: 'extract a subtree of a source to a chosen folder; hardened with a cancel 2026-09-20',
  },
  'soundFonts:importFont': {
    bridge: 'importSoundFont',
    note: 'copy a font folder into the library, with its own progress channel',
  },
};

for (const [handler, { bridge, note }] of Object.entries(UNREACHABLE)) {
  // The handler and the bridge both still exist - if either goes, this entry is stale and
  // should be deleted rather than left asserting something about nothing.
  ok(`${handler} still exists in main`, main.includes(`ipcMain.handle('${handler}'`),
     `the handler is gone, so this entry is stale - remove it (${note})`);
  ok(`preload still bridges it as ${bridge}`, new RegExp(`\\b${bridge}\\s*:`).test(preload),
     'the bridge is gone, so this entry is stale - remove it');

  // ⭐⭐ THE ONE THAT MATTERS. Red here is GOOD NEWS that needs acting on, not a broken test.
  const calls = (rendererText.match(new RegExp(`\\b${bridge}\\s*\\(`, 'g')) || []).length;
  ok(`${handler} is still unreachable (${bridge}: ${calls} callers)`, calls === 0,
     `${bridge} now has a caller, so this door is LIVE. It is named by the export and import `
     + `door maps and by export-cancel as though it were already covered, and that was only `
     + `true while nobody could open it. Give it the preflight and cancel coverage those maps `
     + `claim for it, then delete its entry here.`);
}

// ⚠️ And the progress channels they emit to. These are the thread that led here: a send() with
// no listener is invisible at runtime - no error, no warning, just a measurement nobody shows.
const ORPHAN_CHANNELS = {
  'sources:extractProgress':    'emitted by sources:extractTo',
  'soundFonts:importProgress':  'emitted by soundFonts:importFont',
  'bulkImport:enrichProgress':  'emitted during bulk import enrich - the op IS reachable, so this '
                              + 'one is a genuinely missing consumer rather than a dead door, and '
                              + 'it is [B-389]\'s own known instance: the analyze bar stalls short '
                              + 'because the enrich phase reports to nobody',
};

for (const [channel, note] of Object.entries(ORPHAN_CHANNELS)) {
  const emitted = main.includes(`'${channel}'`);
  if (!emitted) { ok(`${channel} is no longer emitted`, true); continue; }
  const listens = new RegExp(`ipcRenderer\\.on\\(\\s*'${channel}'`).test(preload);
  // The bridge may exist while nothing uses it; what decides is whether a renderer subscribes.
  const bridgeName = (preload.match(new RegExp(`(\\w+)\\s*:\\s*\\(cb\\)[^}]*?'${channel}'`, 's')) || [])[1];
  const consumed = bridgeName
    ? new RegExp(`\\b${bridgeName}\\s*\\(`).test(rendererText) : false;
  ok(`${channel} still has no renderer consumer`, !consumed,
     `a consumer appeared for ${channel}. That is the fix - remove this entry. (${note})`);
  if (!listens) ok(`${channel} bridge still present`, true);
}

console.log(`\ndoor-reachability: ${failed === 0 ? 'all passing' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
