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
  const { skipRootMeta = false, fileFilter = null, recurse = true, onBytes = null } = opts;
  for (const item of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, item.name);
    const destPath = path.join(destDir, item.name);
    if (item.isDirectory()) {
      if (!recurse) continue;
      fs.mkdirSync(destPath, { recursive: true });
      // skipRootMeta is intentionally not propagated — it applies at the root
      // only, matching the legacy walk that skipped meta.json solely there.
      await copyTreeWithProgress(srcPath, destPath, { fileFilter, recurse, onBytes });
    } else if (item.isFile()) {
      if (skipRootMeta && item.name === 'meta.json') continue;
      if (fileFilter && !fileFilter(item.name)) continue;
      await copyFileWithProgress(srcPath, destPath, onBytes);
    }
  }
}

module.exports = { copyFileWithProgress, copyTreeWithProgress };
