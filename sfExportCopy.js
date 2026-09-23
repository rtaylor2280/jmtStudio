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
// ── Stopping INSIDE a file, not just between files ──────────────── [B-005 item 4]
//
// ⭐⭐ THE ORIGINAL COMPLAINT WAS LATENCY, AND THIS IS WHERE IT LIVED. Cancel used to stop
// only between files, so pressing it bought "no more files after this one" and you still
// waited out the current write. A 40 MB track to a board over mass storage is minutes of
// that - his report was ~15 - with the button already pressed and the app looking hung.
//
// ⭐ IT COST ALMOST NOTHING TO FIX, which is the part worth remembering. This was already a
// 1 MB-chunked stream with backpressure - it already yielded between chunks and already had
// a natural checkpoint on every one. The fix is a check in the handler that was always
// there. It was parked overnight on a stated reason that turned out to be false: that these
// writes are shared with the import path. They are not - there are two callers and both are
// exports. ⚠️ Check the caller list before pricing a change out.
//
// ⚠️ THE PARTIAL MUST GO, AND IT MUST GO HERE. A stream torn down mid-write leaves a
// truncated file at the destination - on a card, a half-written .wav that looks like a real
// one. The unlink belongs in this function because this is the only scope that knows the
// write never completed; a caller sees a rejected promise and cannot tell a cancel from a
// disk error without being told. Nothing truncated is left either way, which is the same
// guarantee the between-files version gave - just reached in about a second instead of
// minutes.
function copyFileWithProgress(srcPath, destPath, onBytes, shouldStop = null) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(srcPath, { highWaterMark: 1 << 20 });
    const ws = fs.createWriteStream(destPath);
    let settled = false;
    // ⚠️ UNLINK ONLY WHAT WE OPENED. destPath was just created by createWriteStream above,
    // so removing it cannot touch a pre-existing file of his - the write had already
    // truncated it the moment the stream opened. Deleting on a path we did not open is the
    // shape that cost him 708 MB on 2026-09-02.
    //
    // ⚠️⚠️ WAIT FOR THE HANDLE TO CLOSE BEFORE UNLINKING. THIS IS A WINDOWS RACE AND IT
    // REACHED HIM. `ws.destroy()` is ASYNCHRONOUS, and on Windows deleting a file whose
    // handle is still open fails with EPERM/EBUSY - POSIX allows it, which is exactly why
    // the first cut looked correct. He cancelled an export to a board card and the partial
    // folder was still there afterwards; the unlink had silently lost the race, and so had
    // the caller's recursive remove of the folder, for the same reason.
    //
    // ⭐ MY OWN TEST PASSED THROUGH THIS. It copies to a local temp dir where the handle
    // releases fast enough to win the race every time. A timing bug that resolves quickly on
    // fast storage and slowly on a card is invisible to a test that only ever uses the fast
    // one - the fixture was faithful to the API and not to the destination.
    //
    // The retry is a backstop for a handle that outlives 'close' (antivirus, indexers); the
    // await is the actual fix.
    const dropPartial = async () => {
      await new Promise((r) => {
        if (ws.destroyed && ws.closed) return r();
        ws.once('close', r);
        setTimeout(r, 2000);          // never hang the cancel on a stream that will not close
      });
      for (let i = 0; i < 5; i++) {
        try { fs.unlinkSync(destPath); return; }
        catch (e) {
          if (e && e.code === 'ENOENT') return;            // already gone - fine
          if (!(e && (e.code === 'EBUSY' || e.code === 'EPERM'))) return;
          await new Promise((r) => setTimeout(r, 50 * (i + 1)));
        }
      }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      rs.destroy();
      ws.destroy();
      // ⚠️ The rejection waits for the cleanup. Rejecting first would let the caller's own
      // folder-removal start while this file's handle is still open - which is how a failed
      // unlink here turned into a failed rm of the whole folder there.
      dropPartial().then(() => reject(err), () => reject(err));
    };
    rs.on('error', fail);
    ws.on('error', fail);
    rs.on('data', (chunk) => {
      // ⭐ CHECKED BEFORE THE WRITE, NOT AFTER. Checking after would push one more chunk at
      // the destination - on the slow transport that is the expensive thing, and the whole
      // point is to stop paying for it.
      if (shouldStop && shouldStop()) { fail(new ExportCancelled()); return; }
      const canContinue = ws.write(chunk);
      if (onBytes) onBytes(chunk.length);
      // Backpressure: the destination can't keep up, so stop reading until it
      // drains. This is what paces byte reporting to the card's write speed.
      if (!canContinue) {
        rs.pause();
        // ⚠️ THE DRAIN WAIT IS THE LONGEST STALL ON A SLOW CARD, so it needs its own exit.
        // Without this a cancel pressed while the card is draining sits until the write
        // completes - the original bug, surviving inside the fix for it.
        ws.once('drain', () => {
          if (shouldStop && shouldStop()) { fail(new ExportCancelled()); return; }
          rs.resume();
        });
      }
    });
    rs.on('end', () => ws.end());
    // ⚠️⚠️ 'close', NOT 'finish' — AND THE REASON IS THE ONE ALREADY DOCUMENTED ABOVE, just
    // reached from the success side instead of the cancel side. [2026-09-22]
    //
    // 'finish' means the last chunk has been handed to the OS. The file HANDLE is still open
    // at that moment; 'close' is the event that says the fd is released. The cancel path was
    // taught this the expensive way (see dropPartial) and waits for 'close'; the success path
    // never was, so a completed export resolved with its final file still held.
    //
    // ⭐ WHY IT SURFACED AS AN EJECT BUG AND NOT A COPY BUG: nothing about the copy is wrong -
    // the bytes are all there. But Windows needs an EXCLUSIVE VOLUME LOCK to dismount, and one
    // open handle anywhere on the volume fails it. So the export finished, the eject fired
    // against a volume this process still had open, the Shell verb did nothing (it reports
    // nothing either way), and the poll ran to the ceiling and called it `busy` - advice to
    // close files that named no file the user could close. Eject the same card by hand a moment
    // later and it works, because the handle has since closed on its own.
    //
    // ⭐ THE CORROBORATION WAS ALREADY IN THE RECORD: every zip door waits for 'close'
    // (soundFontBackup, soundFontCommon, soundFontSources), and Backup is the one door whose
    // eject checkbox tested clean end to end. The doors that failed are the ones routed here.
    ws.on('close', () => {
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
// ── The one signal a cancelled export travels on ──────────────── [B-005 item 4]
//
// ⚠️ A DISTINCT TYPE, NOT A STRING MATCH. Every export handler already wraps its work in
// `catch (err) { return { ok: false, error: String(err.message) } }`, so without something
// recognisable a user's own cancel would surface as a red failure dialog reading "Export
// cancelled" - blaming the app for doing exactly what was asked. `isCancel` is what lets each
// handler tell "you stopped this" apart from "this broke".
class ExportCancelled extends Error {
  constructor() { super('Export cancelled'); this.name = 'ExportCancelled'; this.cancelled = true; }
}
// ⚠️ DUCK-TYPED ON PURPOSE. An instanceof check fails across module instances - the same file
// loaded twice yields two different classes - and a cancel that reads as a crash is worse than
// the small looseness here.
const isCancel = (err) => !!(err && err.cancelled === true);

// ── Writing bytes we already hold ─────────────────────────────── [B-005 item 4]
//
// ⚠️⚠️ THE LAST UNINTERRUPTIBLE WRITE IN THE EXPORT SURFACE. The single-file branches of
// `sfFile:export` used `fs.writeFileSync(outPath, buf)` - a synchronous whole-buffer write.
// Two problems, and the second is worse: it cannot be stopped partway, and being synchronous
// it BLOCKS THE EVENT LOOP, so the `export:cancel` IPC could not even be DELIVERED while it
// ran. A cancel flag is worthless if nothing can set it - the third instance of that exact
// shape in this feature, after `copyFileSync` in a `readdirSync` loop and a whole-file
// `copyFile` in reconstruction.
//
// ⭐ The bytes are already in memory here (the source was read to check it is not a program),
// so this is not a stream copy - it is a chunked write with the same two guarantees the file
// copy gives: it stops within about a second, and it leaves nothing truncated behind.
async function writeBufferWithProgress(buf, destPath, onBytes = null, shouldStop = null) {
  const CHUNK = 1 << 20;
  const fh = await fs.promises.open(destPath, 'w');
  let wrote = 0;
  try {
    for (let off = 0; off < buf.length; off += CHUNK) {
      // ⭐ Checked BEFORE each chunk: checking after would pay for one more write on the
      // transport we are trying to stop using.
      if (shouldStop && shouldStop()) throw new ExportCancelled();
      const end = Math.min(off + CHUNK, buf.length);
      await fh.write(buf, off, end - off);
      wrote += (end - off);
      if (onBytes) onBytes(end - off);
    }
  } catch (err) {
    // ⚠️ CLOSE BEFORE UNLINKING. On Windows a file with an open handle cannot be deleted, and
    // that race already reached him once: he cancelled to a board card and the partial was
    // still there afterwards. Closing first is what makes the removal actually happen.
    try { await fh.close(); } catch {}
    try { await fs.promises.unlink(destPath); } catch {}
    throw err;
  }
  await fh.close();
  return wrote;
}

async function copyTreeWithProgress(srcDir, destDir, opts = {}) {
  // relBase threads the path RELATIVE TO THE STORE ROOT down the recursion. A bare
  // basename was enough while a refusal was only ever reported ([B-214]); it is not
  // enough now that the user can act on one ([B-364]), because removal has to resolve
  // the finding back to a real file and "hum2.wav" does not say which folder.
  // ⭐ `wrote` IS A RUNNING TALLY THE CANCEL-CLEANUP RULE READS. [B-005 item 4] It decides
  // whether removing what landed is slow enough to be worth OFFERING rather than just doing.
  // ⚠️⚠️ THE FILE COUNT IS THE LIMB THAT MATTERS HERE, not the bytes. A delete across a
  // board's USB bridge costs a round trip PER FILE - measured ~773 ms - so 400 small wavs is
  // far slower to remove than one 60 MB track. Counting bytes only would have left the
  // expensive case looking cheap.
  const { skipRootMeta = false, fileFilter = null, recurse = true, onBytes = null,
          refused = null, relBase = '', shouldStop = null, wrote = null } = opts;
  for (const item of fs.readdirSync(srcDir, { withFileTypes: true })) {
    // ⭐⭐ THE FIRST OF TWO CHECKS, and the pair is the whole safety argument. [B-005 item 4]
    //
    // This one stops the walk between files; `copyFileWithProgress` stops INSIDE one and
    // deletes what it had written. Together they mean a cancel is honoured within about a
    // second at any point, and nothing truncated is ever left at the destination.
    //
    // ⚠️ THIS COMMENT USED TO SAY "CHECKED HERE AND ONLY HERE" and argued that stopping
    // between files was the safe choice because a mid-file stop leaves a truncated .wav on a
    // FAT32 card. The hazard was real; the conclusion was wrong. Deleting the partial gives
    // the same guarantee without the wait - which is what a 40 MB track over a board's USB
    // bridge turned into: minutes of it, with Cancel already pressed.
    //
    // ⭐ ONE CHECK COVERS TWO DOORS. Font exports and common-folder exports both walk their tree
    // through this function, so neither has to implement stopping and neither can get it wrong
    // in its own way.
    //
    // ⚠️ IT THROWS RATHER THAN RETURNING A FLAG. This walk is recursive; a flag would have to be
    // threaded back up through every level and checked at each one, and one missed level is a
    // cancel that copies a whole subtree anyway. A throw cannot be half-honoured.
    if (shouldStop && shouldStop()) throw new ExportCancelled();
    const srcPath = path.join(srcDir, item.name);
    const destPath = path.join(destDir, item.name);
    if (item.isDirectory()) {
      if (!recurse) continue;
      fs.mkdirSync(destPath, { recursive: true });
      // skipRootMeta is intentionally not propagated — it applies at the root
      // only, matching the legacy walk that skipped meta.json solely there.
      // ⚠️ shouldStop IS propagated: a cancel that stopped at the top level but copied every
      // nested folder to the end would be a cancel in name only.
      await copyTreeWithProgress(srcPath, destPath, { fileFilter, recurse, onBytes, refused, shouldStop, wrote,
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
      // ⭐⭐ THE CHUNK CARRIES THE FILE IT CAME FROM. [B-420, 2026-09-23 — his requirement:
      // "we need to show which file we're working on"]
      //
      // `onBytes` was called with a bare chunk length, so a caller driving a progress bar knew
      // how much had moved and never what was moving. The name is free here - the walk is
      // already holding it for the refusal list - and nowhere upstream can recover it, because
      // by the time the bytes arrive the loop has moved on.
      //
      // ⚠️ SECOND ARGUMENT, NOT A NEW CALLBACK. Every existing caller takes `(n)` and ignores
      // extra arguments, so this cannot break one; a parallel `onFile` channel would be a
      // second thing to keep in step with the first forever.
      const _rel = relBase ? `${relBase}/${item.name}` : item.name;
      await copyFileWithProgress(srcPath, destPath,
        onBytes ? ((n) => onBytes(n, _rel)) : null, shouldStop);
      // ⚠️ COUNTED AFTER THE AWAIT, so a file interrupted mid-write is not counted as landed.
      // Its partial is deleted by the copy itself, so counting it would inflate the tally the
      // cleanup decision reads - by exactly the file that no longer exists.
      if (wrote) wrote.files = (wrote.files || 0) + 1;
    }
  }
}

module.exports = { copyFileWithProgress, copyTreeWithProgress, writeBufferWithProgress,
                   ExportCancelled, isCancel };
