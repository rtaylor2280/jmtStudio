// Removing a path that something else may still be holding open.  [B-420, 2026-09-24]
//
// ⭐⭐ WHY THIS IS SHARED RATHER THAN PASTED A THIRD TIME. On Windows a directory containing a file
// with an open handle cannot be removed, and a handle can outlive the read or write that opened
// it. Three places in this app remove a directory that a user, an antivirus scanner or our own
// just-finished stream might still be touching, and each one had grown - or was about to grow -
// its own answer:
//   · `soundFontEntries.deleteEntry`          - reported as `ENOTEMPTY ... rmdir library\Decay`
//   · `soundFontCommon.exportCommonToFolder`  - reported as `EPERM ... rmdir <dest>\common\alts`
//   · `soundFontSharedTracks` replace         - same shape, not yet reported, same code
// The second was found on a real export to the Desktop on 2026-09-24; the third is the same three
// lines and would have been the next report. Writing the answer a third time is the moment the
// rule says to stop: it is one thing, so it lives in one place.
//
// ⚠️ THIS IS NOT A FORCE. It survives a CLOSING handle and nothing more - four attempts over
// 900 ms, then it throws the last error it saw. A path something genuinely holds open still
// fails, and it should: masking that would turn "the card is busy" into a silent half-delete.
//
// ⚠️⚠️ AWAITED, NEVER A SYNCHRONOUS SLEEP. An earlier cut of the retry in `deleteEntry` used
// `Atomics.wait`, which blocks the MAIN process for the whole backoff - and Electron routes frame
// presentation AND input dispatch through main, so the window freezes mid-operation. A retry that
// hangs the app is worse than the failure it was papering over.
'use strict';

const fs = require('fs');

// Attempt delays in ms: 150, 300, 450 between four tries. Short enough that a closing handle is
// usually gone by the second, bounded enough that a genuinely locked path fails while the user is
// still looking at the progress modal rather than wondering if it hung.
const ATTEMPTS = 4;
const BACKOFF_MS = 150;

/**
 * Recursively remove a path, retrying briefly while a handle closes.
 * Resolves when the path is gone; rejects with the LAST error if it never went.
 */
async function rmWithRetry(target, { attempts = ATTEMPTS, backoffMs = BACKOFF_MS } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      // ⚠️ No delay after the final attempt - waiting to report a failure is pure latency.
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = { rmWithRetry, ATTEMPTS, BACKOFF_MS };
