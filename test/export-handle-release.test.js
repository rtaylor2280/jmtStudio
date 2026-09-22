// A write to the user's destination must resolve on 'close', never on 'finish'.  [B-420]
//
// ⭐⭐ WHY THIS IS A GUARD AND NOT A COMMENT: THE SAME MECHANISM HAS NOW COST TWO DEFECTS,
// and the second one shipped with the fix for the first one sitting eight lines above it.
//
//   2026-09-02  CANCEL side.  An export cancelled to a board card left the partial folder
//               behind. `ws.destroy()` is asynchronous, the unlink raced the handle, and the
//               caller's recursive remove lost the same race. Fixed by waiting for 'close'.
//   2026-09-22  SUCCESS side. A completed export could not be ejected. Same handle, same
//               window, opposite branch - `ws.on('finish')` resolved the copy with the final
//               file still open, so the volume could not be locked and the eject reported
//               `busy` against a card nothing of the user's was touching.
//
// ⚠️ 'finish' MEANS THE BYTES ARE WITH THE OS. IT DOES NOT MEAN THE FD IS CLOSED. On POSIX the
// distinction is nearly invisible - you may unlink an open file, and an unmount is not gated on
// one handle. On Windows a dismount needs an EXCLUSIVE VOLUME LOCK, so a single open handle
// anywhere on the volume is the difference between a safe eject and a false "in use".
//
// ⚠️⚠️ NO BEHAVIOURAL TEST CAN REPLACE THIS ONE, WHICH IS THE WHOLE REASON IT IS A SOURCE GUARD.
// The race is decided by how fast the destination releases a handle. Every suite in this folder
// copies to a local temp dir, where 'close' follows 'finish' fast enough that the wrong code
// passes every time - which is exactly how the success side survived the cancel-side fix. The
// fixture was faithful to the API and not to the destination.
//
// ⭐ SCOPE, deliberately: the DESTINATION path only. The import/library writers
// (soundFontSources.copyFileStreamed, soundFontEntries' zip extraction) carry the same shape and
// are NOT covered here - they write into userData, where no volume is ever ejected. They are
// worth fixing on their own evidence, not folded into this one.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ── 1. The per-file export copier ────────────────────────────────────
// This is the one that failed. Every door that copies files rather than writing a zip routes
// here: the font card, tracks, and the whole file-selection funnel.
const copy = read('sfExportCopy.js');

ok('sfExportCopy resolves the copy on close',
   /ws\.on\('close',\s*\(\)\s*=>\s*\{[\s\S]{0,160}?resolve\(\);/.test(copy),
   'the success path must wait for the fd, or a completed export holds its last file open and '
   + 'the eject that follows reports a card that is not busy as busy');

ok('sfExportCopy has no finish-resolve left anywhere',
   !/\.on\('finish'/.test(copy),
   "'finish' fires before the handle is released; this file writes to the user's destination, "
   + 'so every stream in it has to settle on close');

ok('the cancel path still waits for the handle before unlinking',
   /ws\.once\('close',\s*r\)/.test(copy),
   'dropPartial waits for close before unlink — this is the 2026-09-02 fix and removing it '
   + 'brings back the partial folder left on a cancelled board-card export');

// ── 2. The zip writers ───────────────────────────────────────────────
// ⭐ THESE ARE THE CONTROL GROUP, AND THEY ARE WHY THE DIAGNOSIS HELD. All three already waited
// for 'close', and Backup — the one door whose eject checkbox tested clean end to end — is one
// of them. The doors that failed were the ones routed through the copier above. Keep them
// asserted so the corroboration stays true rather than becoming a story about last Tuesday.
for (const f of ['soundFontBackup.js', 'soundFontCommon.js', 'soundFontSources.js']) {
  const src = read(f);
  ok(`${f} settles its archive on the stream's close`,
     /\.on\('close'/.test(src),
     'an archive whose promise settles on finish hands back a zip whose handle is still open, '
     + 'which blocks both an eject and any rename of the file just written');
}

console.log(failed === 0
  ? '\nexport-handle-release: all checks passed'
  : `\nexport-handle-release: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
