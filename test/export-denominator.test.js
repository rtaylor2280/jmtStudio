// The bar's denominator must describe the ARCHIVE, not the source tree. [B-420]
//
// ⭐⭐ THE DEFECT, from the screenshots 2026-09-24: `Techno · Compressing · 362.9 MB of 7.7 MB`.
// The numerator counts what goes into the archive. The denominator counted `listAll()` — the
// source tree. A CUSTOMIZED font lives at a library entry's own folder, never inside the source,
// so the curation payload was structurally invisible to the total while being fully visible to
// the count. Measured on a real library the day it was fixed: `Decay` is an 80.2 MB tree
// carrying a 67.7 MB payload, so its bar ran to 184%.
//
// ⚠️ THE SEAM IS THE POINT. `zipFolderToFile` already computed the correct total and emitted it;
// this handler overwrote `p.totalBytes` with its own `grandBytes` on the way past. Two parties
// each building their own inventory of one job is the shape — the same shape as `r.hash` vs
// `r.fileHash` — and it is why the fix belongs where the number is BORN rather than at the emit.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

console.log('export-denominator');

// ⚠️ Anchors asserted before use — an unmatched anchor slices something real and reports nothing
// true about it. This suite has already shipped one "found 0" failure from exactly that.
const h = main.indexOf("ipcMain.handle('sources:exportManyToDownloads'");
const hEnd = main.indexOf("ipcMain.handle(", h + 10);
ok('the multi-source export handler was located', h > 0 && hEnd > h,
   're-anchor if the handler is renamed; every assertion below is vacuous without it');
const body = (h > 0 && hEnd > h) ? main.slice(h, hEnd) : '';
ok('the located region is non-empty', body.length > 0);

// ── 1. The payload is in the total ──────────────────────────────────────────
ok('⭐⭐ the curation payload is added to the job total',
   /grandBytes \+= bytes \* passes \+ payloadBytes;/.test(body),
   'without it the bar divides archive bytes by source-tree bytes, and a customized font is '
   + 'where the big files are');
ok('⭐ and to the file count',
   /grandFiles \+= flat\.length \+ payloadFiles;/.test(body));

// ⚠️ ONCE, NOT PER PASS. A space-optimized source moves its tree twice (rebuild, then archive),
// but the payload is APPENDED to the archive — it rides the compress pass only. Multiplying it by
// `passes` would overshoot the denominator on exactly the sources that already take longest.
ok('⚠️ the payload is counted once regardless of passes',
   !/payloadBytes \* passes/.test(body) && !/passes \* payloadBytes/.test(body),
   'the payload is appended to the archive, not carried through the rebuild');

// ── 2. ONE INVENTORY, AND THE COUNT IS THE ASSERTION ────────────────────────
// ⚠️⚠️ THIS SECTION USED TO PIN THE INLINE SIZING CODE, and it went red the moment that code was
// promoted into a shared helper — which is the test asking to be rewritten upward, not the change
// asking to be undone. It is also the better assertion: the defect was never "this handler sizes
// wrongly", it was **four places sizing the same job and three disagreeing**. A count is the only
// check that can see a fifth one arriving.
// ⭐ the screenshots caught two of the four in one export: `362.9 MB of 7.7 MB` mid-run from
// `grandBytes`, and `0 B of 80.2 MB` on the opening frame from `sources:exportSize`.
{
  const sizers = (main.match(/_sourceExportInventory\(/g) || []).length;
  ok('⭐⭐ every export sizer goes through the one inventory',
     sizers >= 4,
     `found ${sizers} (1 definition + call sites); the progress denominator, the opening-frame `
     + 'size and the fit check must all ask the same function');

  // ⚠️ THE NEGATIVE IS THE REAL GUARD. Any handler that sizes an export from `listAll()` is asking
  // the SOURCE what the export will write — and the source cannot see a customized font, which
  // lives at a library entry's own folder. On the Decay source that is 80.2 MB against 805.0 MB.
  const exportSizeAt = main.indexOf("ipcMain.handle('sources:exportSize'");
  const exportSizeEnd = main.indexOf('ipcMain.handle(', exportSizeAt + 10);
  const sizeBody = (exportSizeAt > 0) ? main.slice(exportSizeAt, exportSizeEnd) : '';
  ok('⚠️ the opening-frame sizer does not size from the source tree',
     sizeBody.length > 0 && !/\.listAll\(\)/.test(sizeBody),
     'listAll() cannot see the curation payload, so a denominator built from it starts ten times '
     + 'short and corrects itself a second later');
}

ok('⭐ and the export takes the payload the sizing pass built',
   /const curationPayload = it\.payload \|\| null;/.test(body),
   'rebuilding it at the write is how the denominator came to know nothing about it');
ok('the sized record carries the payload and its measurements',
   /sized\.push\(\{ \.\.\.it, bytes, files: flat\.length, passes, payload, payloadBytes, payloadFiles \}\)/
     .test(body));

// ⚠️ A payload we cannot build must never sink the export — it is metadata, not the goods.
// Asserted against the shared helper now, which is where the try/catch moved.
{
  const invAt = main.indexOf('async function _sourceExportInventory');
  const invEnd = main.indexOf("ipcMain.handle('sources:exportSize'", invAt);
  const inv = (invAt > 0 && invEnd > invAt) ? main.slice(invAt, invEnd) : '';
  ok('the shared inventory was located', inv.length > 0);
  ok('⚠️ a payload that cannot be built costs zero rather than throwing',
     /catch \{ payload = null; payloadBytes = 0; payloadFiles = 0; \}/.test(inv),
     'an unreadable receipt must not take the whole export down with it');
}

console.log(failed ? `\nexport-denominator: ${failed} FAILED` : '\nexport-denominator: all passing');
process.exit(failed ? 1 : 0);
