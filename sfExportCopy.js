// Sound Fonts — streamed directory copy with write-paced byte progress.
//
// The bulk-export path (fonts + common + shared tracks → a destination folder,
// usually an SD card) uses this so the progress bar reflects bytes actually
// WRITTEN to the destination rather than bytes read from the fast local disk.
// That distinction matters when the destination is slow (a saber's SD card
// mounted over USB): a read-paced counter would sprint ahead and then sit
// frozen while the card drains. Here the read stream is paused on write
// backpressure, so byte reporting tracks the card's real write speed and the
// bar keeps moving honestly even in the slow case.
//
// The copy is async (stream-based) on purpose. A synchronous copyFileSync
// loop blocks the main process and would starve the progress IPC — the events
// would all flush at the end, defeating the point. Awaiting between chunks
// lets the main event loop breathe and deliver progress mid-copy.
const fs = require('fs');
const path = require('path');

// Copy one file to the destination, invoking onBytes(n) as each chunk is
// accepted by the (possibly slow) destination write stream. 1 MB chunks keep
// throughput high on fast local copies while still yielding often enough for a
// smooth crawl on slow media.
function copyFileWithProgress(srcPath, destPath, onBytes) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(srcPath, { highWaterMark: 1 << 20 });
    const ws = fs.createWriteStream(destPath);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      rs.destroy();
      ws.destroy();
      reject(err);
    };
    rs.on('error', fail);
    ws.on('error', fail);
    rs.on('data', (chunk) => {
      const canContinue = ws.write(chunk);
      if (onBytes) onBytes(chunk.length);
      // Backpressure: the destination can't keep up, so stop reading until it
      // drains. This is what paces byte reporting to the card's write speed.
      if (!canContinue) {
        rs.pause();
        ws.once('drain', () => rs.resume());
      }
    });
    rs.on('end', () => ws.end());
    ws.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
}

// Recursively copy a directory tree with per-chunk byte progress.
//   skipRootMeta  drop a top-level meta.json (an app artifact) — root only,
//                 nested meta.json files are preserved
//   fileFilter    predicate(name) — copy only files whose name matches
//   recurse       descend into subdirectories (default true; false = flat)
//   onBytes       called with the byte length of each chunk written
async function copyTreeWithProgress(srcDir, destDir, opts = {}) {
  // relBase threads the path RELATIVE TO THE STORE ROOT down the recursion. A bare
  // basename was enough while a refusal was only ever reported ([B-214]); it is not
  // enough now that the user can act on one ([B-364]), because removal has to resolve
  // the finding back to a real file and "hum2.wav" does not say which folder.
  const { skipRootMeta = false, fileFilter = null, recurse = true, onBytes = null,
          refused = null, relBase = '' } = opts;
  for (const item of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, item.name);
    const destPath = path.join(destDir, item.name);
    if (item.isDirectory()) {
      if (!recurse) continue;
      fs.mkdirSync(destPath, { recursive: true });
      // skipRootMeta is intentionally not propagated — it applies at the root
      // only, matching the legacy walk that skipped meta.json solely there.
      await copyTreeWithProgress(srcPath, destPath, { fileFilter, recurse, onBytes, refused,
        relBase: relBase ? `${relBase}/${item.name}` : item.name });
    } else if (item.isFile()) {
      if (skipRootMeta && item.name === 'meta.json') continue;
      if (fileFilter && !fileFilter(item.name)) continue;
      // ⚠️ THE WAY OUT NEEDS THE SAME GUARD AS THE WAY IN ([B-214]). Entries imported
      // before this existed were never filtered, so the library can still hold a program
      // from a card read months ago. Without this, exporting would put it back onto a
      // card and pass it to the next person. Collected rather than silently dropped:
      // an unexplained omission during an export is its own kind of dishonesty.
      if (refused) {
        // checkCarryableFile, not checkExecutableFile: two different things must not be
        // carried out, and only one of them is a program ([B-368]).
        const v = require('./sdCardDetect').checkCarryableFile(srcPath, item.name);
        if (v.blocked) {
          refused.push({
            relPath: relBase ? `${relBase}/${item.name}` : item.name,
            name: item.name,
            kind: v.kind,
            reason: v.reason,
            disguised: !!v.disguised,
          });
          continue;
        }
      }
      await copyFileWithProgress(srcPath, destPath, onBytes);
    }
  }
}

module.exports = { copyFileWithProgress, copyTreeWithProgress };
