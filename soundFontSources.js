// Sound Fonts — source storage layer (Phase 1, slice 1).
//
// A "source" is one user purchase as delivered, stored verbatim. Each source
// lives at userData/soundFonts/sources/<uuid>/ and contains either a
// source.zip (for zip-delivered fonts) or a source/ subfolder (for
// folder-delivered fonts), plus a meta.json describing it. The source is the
// archive; library entries (Phase 2) are curated subsets of a source.
//
// Hashing is content-based:
//   - Zip sources hash the literal zip bytes (sha256 streamed).
//   - Folder sources hash a deterministic walk: lexicographic sort of relative
//     paths, normalized to forward slashes, with each path and its content
//     fed into the digest.
//
// Cross-format duplicates (same font as both zip and folder) are not detected
// in v1; this is a documented limitation in docs/specs (now local/specs).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const StreamZip = require('node-stream-zip');

// OS-level archive noise: macOS Finder shadow tree, AppleDouble sidecars,
// Windows / Mac metadata leftovers. Never real content. Filtered at
// extractTo so library entries don't carry junk onto the SD card.
function _isNoisePath(relPath) {
  const parts = String(relPath || '').split('/').filter(Boolean);
  for (const seg of parts) {
    if (seg === '__MACOSX') return true;
    if (seg === '.DS_Store') return true;
    if (seg === 'Thumbs.db' || seg === 'desktop.ini') return true;
    if (seg.startsWith('._')) return true;
  }
  return false;
}

function sourcesRoot(userData) {
  return path.join(userData, 'soundFonts', 'sources');
}

function ensureSourcesRoot(userData) {
  const root = sourcesRoot(userData);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

async function hashZipFile(filePath, onProgress) {
  const totalBytes = fs.statSync(filePath).size;
  const hash = crypto.createHash('sha256');
  let bytesHashed = 0;
  let lastEmit = Date.now();
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      hash.update(chunk);
      bytesHashed += chunk.length;
      const now = Date.now();
      if (onProgress && (now - lastEmit > 100 || bytesHashed === totalBytes)) {
        onProgress({ bytesHashed, totalBytes });
        lastEmit = now;
      }
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

// Streamed file copy with progress. Used for zip sources so large files report
// progress the same way folder imports do (otherwise the user sees 0% then
// 100% with no in-flight signal for multi-GB copies).
async function copyFileStreamed(srcPath, destPath, onProgress) {
  const totalBytes = fs.statSync(srcPath).size;
  let bytesCopied = 0;
  let lastEmit = Date.now();
  await new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(srcPath);
    const writeStream = fs.createWriteStream(destPath);
    readStream.on('data', chunk => {
      bytesCopied += chunk.length;
      const now = Date.now();
      if (onProgress && (now - lastEmit > 100 || bytesCopied === totalBytes)) {
        onProgress({ bytesCopied, totalBytes });
        lastEmit = now;
      }
    });
    readStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
    readStream.pipe(writeStream);
  });
}

// Zip-on-folder-import optimization (zips a folder into source.zip during
// import, then operates on it as a zip source for the rest of its life).
//
// Why: folder imports used to do TWO file-by-file walks of the source —
// once to hash for dedup (hashFolder), once to copy file-by-file
// (copyFolderRecursive). Bench data from 2026-06-23: 143 folder-solo
// sources at 6.64 GB took 58m32s vs 130 zip-majority sources at ~30 GB
// taking 10m17s, an asymmetric ~5x per-source / ~26x per-GB cost from
// the second walk alone. This helper collapses the work into one pass:
// walk the folder once (sorted, noise-filtered), pipe each file through
// archiver, hash the resulting zip bytes as they stream out to disk.
//
// Determinism — the resulting source.zip must be byte-identical across
// re-imports of the same content for the dedup hash to land in the same
// spot. Three rules:
//   1. Files added in lexicographic relative-path order (walkFolderSorted).
//   2. Per-file mtime forced to epoch and mode forced to 0o644 so OS
//      metadata (file-system mtimes, varying permissions) can't leak
//      into the zip and break dedup across machines / sync states.
//   3. Compression level 1 (fast deterministic deflate) — audio doesn't
//      compress much anyway and level 1 saves real seconds on multi-GB
//      voicepacks.
// Noise files (__MACOSX, .DS_Store, ._*, Thumbs.db, desktop.ini) are
// filtered the same way they are at extractTo time so the stored zip
// contains clean content.
//
// Hash-while-writing — a Transform between archive.pipe and the file
// write stream taps every output chunk into a sha256 update. The hash
// is the source identity hash by the time the write stream's 'close'
// event fires, so we get dedup-grade content identity for free as part
// of the import work, with no separate read pass.
//
// Compat — old format=folder sources continue to work; openSource()
// dispatches on meta.format, and existing folder-format sources have
// their `source/` tree intact. Only NEW folder picks get the zip
// transform; re-importing a folder that's already in the library as
// format=folder will not find the prior import via findByHash (the old
// hash was an aggregate of per-file hashes, the new one is a hash of
// the zip stream — different shape). Acceptable edge case for the
// one-time format transition.
// Which files of a picked folder actually become the source, and which are dropped.
//
// Lifted out of zipFolderToFile unchanged so the storage step can choose what it
// WRITES without re-deciding what it KEEPS ([B-309]). Two callers, one answer: a
// second copy of this rule would be free to drift, and the drift would show up as
// two imports of the same folder disagreeing about their own contents.
//
// Damaged wavs are dropped BEFORE anything reads them in full. That salvages the
// good files — which is what importing a damaged font is expected to mean — and,
// because the scrambled file is never read through, it removes the very read that
// can stall the pass on a failing card.
//
// ⚠️ THIS IS NO LONGER OPT-IN, AND THAT IS THE WHOLE OF [B-361]'s CORRECTION
// (2026-09-09). It used to run only when the caller already knew the font was
// corrupt — a fact that could only come from the card browser's recursive
// pre-walk. So corruption was detected only for SD-card imports, and only by
// reading the whole card a second time; a folder or zip picked from disk was
// never checked at all. The free version (hashAndCheckFont, written 2026-07-19)
// was never wired to a caller and had never run.
//
// The check now rides the walk that selects the files, which is the read the
// import performs anyway. It is header-only (256 bytes) against a file the zip
// is about to read in full moments later, so the "don't touch a bad sector
// unprompted" caution the opt-in was protecting no longer applies — the full
// read is the exposure, and it happens regardless.
//
// `strippedFiles` is therefore both the strip record AND the detection result:
// non-empty means this source was damaged, and the reasons ride along for the
// review row and the post-import summary.
// ⚠️⚠️ ASYNC SINCE [B-398], AND IT IS THE THIRD PASS PER SOURCE, NOT THE FIRST.
//
// The first fix for B-398 caught the copy loop and the hash pass and I reported the bug closed.
// His own probe log said otherwise: a 9347ms stall inside importSource on a build that already had
// both — WORSE than the 4955ms that opened the entry. This pass is why. It reads the leading bytes
// of EVERY file (see the one-read comment below) before a single byte is copied, so a folder of
// several hundred wavs is several hundred synchronous opens with nothing yielding between them.
//
// ⭐ THE LESSON, WORTH MORE THAN THE FIX: "I found A blocking pass" is not "I found THE blocking
// passes". Counting them is cheap and the instrument was already running — I claimed the win off
// his "Yes! now it's fixed" instead of reading the log that was sitting right there.
//
// ⚠️ The .filter() callback could not await, so this is an explicit loop. The predicate body below
// is UNCHANGED - only `return false` became `continue` and `return true` became a push.
async function _selectFolderFiles(srcDir) {
  const strippedFiles = [];   // damaged wavs, removed
  const blockedFiles = [];    // programs, removed ([B-214])
  const notedFiles = [];      // macro documents and un-inspectable archives, KEPT
  const { checkWavBuffer, classifyFileBuffer } = require('./sdCardDetect');
  const { breathe } = require('./soundFontFileHash');
  const files = [];
  for (const f of walkFolderSorted(srcDir)) {
    if (_isNoisePath(f.relPath)) continue;
    await breathe();
    {
      // ONE read, BOTH predicates. This used to call checkWavHealth, which opens the
      // file itself - so a wav was opened twice, once for the header and again by the
      // zip moments later. Reading the head here and passing the bytes to both checks
      // is what hashAndCheckFont was written to do in the first place, and it is the
      // only way the executable test is free: it needs the leading bytes of EVERY
      // file, not just the wavs.
      const head = _readHead(f.absPath);
      // Executables first: a file that is a program is out whatever else it may be,
      // and a program named .wav must never reach the wav check and be judged as
      // merely corrupt.
      const v = classifyFileBuffer(head, f.relPath);
      if (v.kind === 'program') { blockedFiles.push({ relPath: f.relPath, kind: 'program', reason: v.reason, byContent: !!v.byContent, disguised: !!v.disguised }); continue; }
      if (v.kind === 'macro') {
        blockedFiles.push({ relPath: f.relPath, kind: 'macro',
          reason: 'A document that can contain macros has no use on a saber card. It was left out.' });
        continue;
      }
      // ⚠️ AN ARCHIVE WE CANNOT OPEN IS NOW REFUSED HERE TOO ([B-368], 2026-09-11). This
      // was missed when opaque became a blocking verdict: the purge and the carry
      // predicate were both updated and THIS selector was not, so a source exported as a
      // zip still carried the rar out. Exactly the failure the standing rule names - a
      // rule written beside one caller never reaches the others - and the tell was a
      // clean close-out on an export that had one sitting in it.
      if (v.kind === 'opaque') {
        blockedFiles.push({ relPath: f.relPath, kind: 'opaque', reason: v.reason });
        continue;
      }
      // Kept, and said out loud anyway: anything else we cannot fully judge is not a
      // finding, but silence would read as "checked and clean", which is not what happened.
      if (v.kind !== 'ok') notedFiles.push({ relPath: f.relPath, kind: v.kind, reason: v.reason });
      if (!/\.wav$/i.test(f.relPath)) { files.push(f); continue; }
      const h = checkWavBuffer(head || Buffer.alloc(0), f.size);
      if (h && h.corrupt) { strippedFiles.push({ relPath: f.relPath, reason: h.reason }); continue; }
      files.push(f);
    }
  }
  return { files, strippedFiles, blockedFiles, notedFiles };
}

// Remove every executable from an already-extracted tree, and say what went.
//
// The ZIP route needs this rather than a filter at extraction time, for one
// reason worth keeping: inner archives are expanded AFTER the outer one, so a
// program hidden inside a nested zip does not exist yet while the outer archive
// is being read. Sweeping the finished tree covers both depths with one pass.
//
// ⚠️ IDENTITY IS NOT AFFECTED, and this is the fact that unblocked the whole
// question. A picked archive is identified by the sha256 of THE FILE ON THE
// USER'S DISK, taken before anything is written and never recomputed from what
// we store. So dedup and provenance against the vendor's original still refer to
// the archive they actually have; we are only declining to keep part of it, and
// the meta records exactly which part.
// ⚠️⚠️ ONE WALK, TWO DRAINS - the same split as soundFontFileHash._walkRecords, for the same
// reason. [B-398] needs the IMPORT path to yield between files, but three other callers
// (_createZipSource, _createFolderSource, _virtualizeSource) are synchronous functions, and making
// THEM async cascades outward for no benefit - they run once over a tree that is already in hand.
// So the rules live here once and callers differ only in how they drain. A second copy of the
// program/macro/opaque verdicts is a future disagreement about what is safe to keep.
// ⚠️ It YIELDS BEFORE the read, so the breath lands between files rather than after the work.
function* _purgeWalk(rootDir, blocked, noted) {
  const { classifyFileBuffer } = require('./sdCardDetect');
  const walk = function* (dir, rel) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { yield* walk(abs, r); continue; }
      if (!e.isFile()) continue;
      yield;
      const verdict = classifyFileBuffer(_readHead(abs), r);
      if (verdict.kind === 'macro') {
        let msize = 0; try { msize = fs.statSync(abs).size; } catch {}
        try { fs.unlinkSync(abs); } catch { continue; }
        blocked.push({ relPath: r, kind: 'macro', size: msize,
          reason: 'A document that can contain macros has no use on a saber card. It was left out.' });
        continue;
      }
      // ⚠️ AN ARCHIVE WE CANNOT OPEN DOES NOT COME IN ([B-368], his call 2026-09-11).
      // Not a threat claim - we genuinely cannot say what is inside. The argument is
      // simpler than safety: "they have no business being on a card, because Proffie
      // can't read it and JMT Studio can't read it, so it doesn't do any good for them."
      // MEASURED before deciding: 332 zip against 3 rar across his whole font archive,
      // and no 7z anywhere. Zip stays the readable case - we expand it and recurse.
      if (verdict.kind === 'opaque') {
        let osize = 0; try { osize = fs.statSync(abs).size; } catch {}
        try { fs.unlinkSync(abs); } catch { continue; }
        blocked.push({ relPath: r, kind: 'opaque', size: osize,
          reason: 'This archive format cannot be opened, here or on a saber, so its contents could not be checked. It was left out.' });
        continue;
      }
      if (verdict.kind !== 'program') {
        if (verdict.kind !== 'ok') noted.push({ relPath: r, kind: verdict.kind, reason: verdict.reason });
        continue;
      }
      let size = 0;
      try { size = fs.statSync(abs).size; } catch {}
      try { fs.unlinkSync(abs); } catch { continue; } // could not remove it: do not claim we did
      blocked.push({ relPath: r, kind: 'program', reason: verdict.reason, byContent: !!verdict.byContent, disguised: !!verdict.disguised, size });
    }
  };
  yield* walk(rootDir, '');
}

// Drain it all at once. Byte-for-byte what the three synchronous callers already had.
function _purgeExecutables(rootDir) {
  const blocked = [], noted = [];
  for (const _ of _purgeWalk(rootDir, blocked, noted)) { /* drain */ }
  return { blocked, noted };
}

// Drain it with a breath between files, for the import path. [B-398]
async function _purgeExecutablesAsync(rootDir) {
  const blocked = [], noted = [];
  const { breathe } = require('./soundFontFileHash');
  for (const _ of _purgeWalk(rootDir, blocked, noted)) await breathe();
  return { blocked, noted };
}

// First 256 bytes of a file, or null if it cannot be opened. 256 is what
// checkWavBuffer needs to walk a RIFF chunk list; the executable magic numbers
// need 4. One size serves both so there is one read per file, not two.
function _readHead(absPath) {
  let fd;
  try { fd = fs.openSync(absPath, 'r'); } catch { return null; }
  try {
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    return n > 0 ? buf.subarray(0, n) : Buffer.alloc(0);
  } catch { return null; }
  finally { try { fs.closeSync(fd); } catch {} }
}

// ⚠️ One constructor for the cancel signal so the rejecting path and the returning path cannot
// drift into throwing two different things. [B-005 item 4]
function _cancelErr() { return new (require('./sfExportCopy').ExportCancelled)(); }

async function zipFolderToFile(srcDir, destZipPath, onProgress, opts = {}) {
  const archiver = require('archiver');
  const { Transform, Readable } = require('stream');

  const { files, strippedFiles, blockedFiles, notedFiles } = await _selectFolderFiles(srcDir);
  // ⚠️⚠️ THE EXTRA ENTRIES ARE IN THE ARCHIVE, SO THEY ARE IN THE TOTAL. [B-420, 2026-09-23]
  // His report, exporting a source whose customized font carried a pile of tracks he had added for
  // earlier testing: *"you see the progress bars at 100% for a really long time because it was like
  // 1.4 gigabytes out of 300 MB."*
  // ⭐ The denominator came from `_selectFolderFiles(srcDir)` alone - the VENDOR tree - while the
  // sidecar payload rode in through `extraEntries` and was compressed without ever being counted. A
  // customized font is a whole font, so the shortfall is not a rounding error: the bar pinned at
  // 100% and stayed there for the rest of the job.
  // ⚠️ I ASSERTED THIS UNDERCOUNT IN A TEST AND CALLED IT HONEST ("the reported fileCount counts the
  // source tree, not the appended sidecar"). It is not honest - these numbers describe the ARCHIVE,
  // and the archive contains every byte we put in it. A test can write a defect down and make it
  // look decided; that is worse than leaving it undocumented.
  const _extra = (opts.extraEntries || []);
  const _extraBytes = _extra.reduce((s, e) => {
    if (e.buffer) return s + e.buffer.length;
    try { return s + (fs.statSync(e.absPath).size || 0); } catch { return s; }
  }, 0);
  const totalBytes = files.reduce((s, f) => s + f.size, 0) + _extraBytes;
  const fileCount = files.length + _extra.length;
  // Buffer entries report no stats on the 'entry' event, so their size is looked up by name.
  const _extraBufByName = new Map(
    _extra.filter((e) => e.buffer).map((e) => [e.name, e.buffer.length]));

  const archive = archiver('zip', {
    zlib: { level: 1 },
    forceZip64: true,
    // statConcurrency: 1 is REQUIRED for a deterministic archive. The default (4)
    // stats files concurrently and appends them in I/O-completion order, not the
    // sorted submission order — so the same folder produced different zip bytes
    // (and thus a different content hash) on each import, silently breaking
    // dedup. Serializing the stat restores stable, order-deterministic output.
    statConcurrency: 1,
  });

  const hasher = crypto.createHash('sha256');
  const hashTap = new Transform({
    transform(chunk, _encoding, callback) {
      hasher.update(chunk);
      this.push(chunk);
      callback();
    },
  });
  const fileStream = fs.createWriteStream(destZipPath);
  archive.pipe(hashTap).pipe(fileStream);

  const EPOCH = new Date(0);
  const MODE = 0o644;

  let filesProcessed = 0;
  let lastEmit = Date.now();
  let lastProgressMs = Date.now(); // watchdog: last time the archive actually moved

  // ⭐⭐ BYTES ARE COUNTED AS THEY ARE READ, NOT AS ENTRIES COMPLETE. [B-420, 2026-09-24]
  // Reported: `Compressing · 286.7 MB of 286.7 MB` sitting still for twenty seconds at the end
  // of an export. Two separate faults met there and this is the second one - the first was a
  // denominator that left the curation payload out. Even with the denominator right, NOTHING was
  // emitted while a single entry was being compressed: `onProgress` was called only from the
  // 'entry' event, and archiver's own source says that fires *after* "the entry's input has been
  // processed and appended". So one 300 MB file meant no bar, no byte count and no filename change
  // for its entire duration. A progress bar whose grain is one file cannot describe a job whose
  // files are that big.
  //
  // ⚠️ SUPPLYING `stats` IS WHAT KEEPS THE ARCHIVE BYTE-IDENTICAL, AND IT IS NOT OPTIONAL HERE.
  // That hash is what dedup matches sources on, so re-hashing every export would silently stop it
  // matching anything already in the library. `test/zip-byte-identity.test.js` asserts the
  // relationship rather than a pinned digest, and it carries a control so it cannot pass blind.
  // ⭐ It also makes the ordering stronger, not weaker: an entry carrying `stats` skips archiver's
  // `_statQueue` entirely (core.js:111) and goes straight onto the ordered queue, so submission
  // order holds BY CONSTRUCTION instead of depending on `statConcurrency: 1` staying set.
  //
  // ⚠️⚠️ THE STREAM MUST BE LAZY. `archive.file()` uses `lazyReadStream` internally for a reason:
  // handing archiver a live `fs.createReadStream` per entry opens every file in the source at
  // submission time, which on a large font is thousands of descriptors at once. The async
  // generator below is not iterated until archiver pulls from it, so exactly one file is open.
  let bytesStreamed = 0;      // read off disk, live
  let bufferBytes = 0;        // buffer entries have nothing to read - counted when they land
  let currentName = null;     // the entry actually being read right now, not the last one finished
  // ⚠️⚠️ `objectMode: false` IS LOAD-BEARING, AND THE TEST IS HOW I FOUND OUT. `Readable.from`
  // defaults to OBJECT MODE, which changes how the bytes are handed downstream and re-hashed every
  // archive - the identity test went red on the first run of this change, against a hand-probe
  // that had used `.pipe()` and said it was identical. **The probe and the production call were
  // not the same call**, which is exactly why the assertion lives in the suite rather than in a
  // scratch file I ran once and believed.
  //
  // ⚠️⚠️ EVERY STREAM THIS OPENS IS TRACKED, AND THAT IS NOT BELT-AND-BRACES. [2026-09-24]
  // Taking ownership of the read stream is what bought chunk-resolution progress, and it also took
  // on the lifecycle archiver used to handle. `archive.abort()` stops PULLING and drops the source
  // WITHOUT destroying it — so an abandoned generator sits suspended at its `yield` holding an open
  // descriptor, indefinitely.
  // ⭐ MEASURED COST, ON A REAL LIBRARY, THE DAY IT SHIPPED: a few cancelled exports, then a delete of
  // the entry and got `ENOTEMPTY: directory not empty`. Exactly one file was locked —
  // `Angelic_Plazma_stereo_track.wav`, the customized payload file ta cancel of export had been
  // reading. A leaked handle is not a slow leak here; it is a file that cannot be deleted.
  // ⚠️ `archive.file()` never had this problem because archiver created the lazy stream and its own
  // teardown owned it. **Taking a resource off a library takes its cleanup with it.**
  const lazyCounted = (absPath, name) => Readable.from((async function* () {
    const rs = fs.createReadStream(absPath);
    try {
      currentName = name;
      for await (const chunk of rs) {
        bytesStreamed += chunk.length;
        lastProgressMs = Date.now();
        yield chunk;
      }
    } finally {
      // ⚠️ THE `finally` IS THE WHOLE RELEASE, AND I NEARLY BUILT A SECOND ONE. [2026-09-24]
      // Taking ownership of the read stream took on the lifecycle `archive.file()` used to handle,
      // so this must run on the ordinary end AND when a consumer destroys us mid-read. It does:
      // both abort sites destroy the sink, that propagates back through the pipe, `for await`
      // exits, and this fires.
      // ⚠️ I first reasoned that `archive.abort()` drops sources WITHOUT destroying them and added
      // a tracked Set swept at every abort site. Then a mutation test removed that sweep and the
      // cancel test still passed — the teardown was already complete. **Defensive code for a case
      // I could not make happen is a second mechanism to keep in agreement forever**, so it went.
      // `test/zip-cancel-releases-files.js` cancels mid-entry and then deletes the fixture, which
      // is the symptom rather than the mechanism.
      try { rs.destroy(); } catch {}
    }
  })(), { objectMode: false });
  // ⭐ ONE EMITTER, TWO CALLERS: an entry landing, and the watchdog tick. The tick is what makes a
  // long single entry legible; the entry event is what keeps the count and the name honest at a
  // boundary. Both go through here so they cannot report different things about the same moment.
  // ⚠️ MONOTONIC BY CONSTRUCTION - `bytesStreamed` only ever grows and buffer entries only add - so
  // nothing here can walk the bar backwards. The renderer keeps its own floor for the multi-PASS
  // case, which is a different problem: two passes over one source are two measurements.
  // ⚠️ DECLARED BEFORE ITS CALLERS ON PURPOSE. A `const` referenced by a handler defined above it
  // works only because the handler cannot fire until finalize(); this project has already lost a
  // live flash to a renderer `ReferenceError` that no check it runs could see, so the ordering is
  // made true rather than merely safe.
  const emit = () => {
    if (!onProgress) return;
    const now = Date.now();
    if (now - lastEmit < 100 && filesProcessed !== fileCount) return;
    lastEmit = now;
    onProgress({
      bytesProcessed: Math.min(bytesStreamed + bufferBytes, totalBytes),
      totalBytes,
      // The entry being READ, which during a long compress is the one the user is waiting on.
      // ⚠️ It used to name `files[filesProcessed]` and fall back to the entry that just finished,
      // so once the vendor list ran out - exactly when the curation payload starts - the display
      // froze on a stale vendor filename for the rest of the job.
      currentFile: currentName || (files[0] && files[0].relPath) || '',
    });
  };

  // ⚠️⚠️ CANCEL ABORTS HERE; IT MUST NEVER THROW HERE. [B-005 item 4] This is an EventEmitter
  // handler, and a throw inside one is an uncaught exception in the main process - the [B-418]
  // crash shape, where the app simply vanishes. Every other stopping point in this feature
  // throws because it is on a normal call stack; this one aborts the archive and lets the
  // stream machinery below settle the promise.
  let _canceled = false;
  archive.on('entry', (entry) => {
    if (!_canceled && opts.shouldStop && opts.shouldStop()) {
      _canceled = true;
      try { archive.abort(); } catch {}
      // ⚠️⚠️ DESTROY THE SINK TOO, OR NOTHING SETTLES FOR NINETY SECONDS. abort() stops archiver
      // feeding the stream but does not close it, so the promise below sat there until the
      // stall watchdog gave up - and that watchdog's whole job is to say the SOURCE is damaged.
      // His report: he cancelled during compress and eventually got "the source has a damaged
      // or unreadable file", about a font that is perfectly fine. [B-005 item 4]
      try { fileStream.destroy(); } catch {}
      return;
    }
    filesProcessed++;
    lastProgressMs = Date.now();
    // ⚠️ A BUFFER ENTRY HAS NOTHING TO READ, so the stream tap never sees it. It is in the
    // denominator, so it has to reach the numerator somewhere, and landing is the only moment it
    // can. A denominator and a numerator that disagree about what they include is the exact shape
    // of the defect this whole change exists to remove, just pointed the other way.
    if (!(entry.stats && entry.stats.size)) bufferBytes += (_extraBufByName.get(entry.name) || 0);
    emit();
  });

  // First emission up front so a section never opens blind on a huge first file.
  if (onProgress && files.length) onProgress({ bytesProcessed: 0, totalBytes, currentFile: files[0].relPath });

  // Add files in pre-sorted order. With statConcurrency:1 above, archiver stats
  // and appends them one at a time IN this submission order, so the zip bytes are
  // deterministic (concurrent stat was reordering them and breaking dedup).
  for (const f of files) {
    // ⚠️ `stats` here is the byte-identity guarantee AND the ordering guarantee - see the long
    // note above the tap. The extra statSync is a second stat per file (walkFolderSorted already
    // did one for size); against compressing the same file it does not register, and it buys a
    // submission order that no longer depends on a setting.
    archive.append(lazyCounted(f.absPath, f.relPath),
                   { name: f.relPath, date: EPOCH, mode: MODE, stats: fs.statSync(f.absPath) });
  }

  // ⭐⭐ THE CURATION SIDECAR GOES IN HERE, INSIDE THE ONE COMPRESSION PASS. [B-420]
  // It used to be added by `injectIntoZip`: take the archive we had just finished, extract the
  // WHOLE thing to a temp tree, write the sidecar into it, and re-compress everything - a second
  // full extract and a second full compress of content we wrote moments earlier, to carry a few
  // small files. `writeIntoTree`'s own comment says "just before it is archived", which is this
  // point; the old call site ran it after.
  // ⚠️ Ryan, 2026-09-23: *"How can curation have after compression? It goes inside the zip…."*
  // The design predates the pooled store, when the archive itself was the stored artifact and had
  // to be rebuilt to stay byte-canonical. Nothing is stored as an archive now.
  // ⚠️⚠️ THIS USED TO SAY "APPENDED LAST, AFTER the sorted files, so the archive stays
  // order-deterministic" AND THAT WAS TRUE OF THE SUBMISSION, NOT OF THE ARCHIVE. [2026-09-24]
  // The vendor tree went in with `archive.file()` and the sidecar with `archive.append()`, and
  // those use two different queues: an entry carrying stats goes straight onto the ordered queue,
  // while a bare `file()` waits in `_statQueue` to be stat-ed first. Measured: the sidecar came
  // out FIRST, ahead of every vendor file. Nothing caught it because the archive was valid, the
  // entry count was right, and the only thing it contradicted was this comment.
  // ⭐ Every entry now goes in the same way - append, with stats supplied - so submission order
  // IS archive order, and `test/zip-byte-identity.test.js` asserts the position rather than
  // trusting a sentence. Same EPOCH date and MODE as every other entry, or these few files would
  // be the only ones carrying real timestamps.
  //
  // ⭐ AN ENTRY IS A NAME PLUS A SOURCE OF BYTES, and the source may be either a path on disk or a
  // buffer in memory. That is the whole reason nothing needs staging: the sidecar is JSON we just
  // built, so it goes straight in as bytes and never becomes a file; attachments and customized
  // font folders are already real files, so archiver reads them where they sit.
  // ⚠️ The first cut of this staged all of it into a temp dir so archiver could read it back - which
  // meant COPYING a customized font (a whole font) to read it straight out again. Ryan caught the
  // smell before it was measured: "does it get written in a temp file then either placed in the tree
  // or appended to the archive?" The answer should be no in both cases, and now is.
  for (const e of (opts.extraEntries || [])) {
    if (e.buffer) archive.append(e.buffer, { name: e.name, date: EPOCH, mode: MODE });
    // ⭐ THE PAYLOAD GETS THE SAME TAP AS THE VENDOR TREE, which is the half the screenshots was
    // about: a customized font is where the big files are, so a bar that only moves for vendor
    // content goes quiet for exactly the stretch the user is waiting on.
    else archive.append(lazyCounted(e.absPath, e.name),
                        { name: e.name, date: EPOCH, mode: MODE, stats: fs.statSync(e.absPath) });
  }

  // ⚠️ A 'finalizing' phase was briefly emitted here and REMOVED, because nothing could
  // receive it: the common-zip door's progress travels on a delta-only channel that carries a
  // byte count and drops every other field. Adding it would have been one more producer with
  // no consumer - the exact thing `test/export-wiring.test.js` exists to catch, written a few
  // hours earlier. The tail is explained renderer-side instead, where the numbers already are.
  // See the note on `Compressing ·` in the common-zip door. [B-005 item 4]

  try {
  await new Promise((resolve, reject) => {
    // Watchdog: if no entry completes for a long stretch, a file is unreadable
    // (a damaged wav on a bad sector can make the OS read hang indefinitely).
    // Abort rather than hang the whole import forever — the caller cleans up the
    // partial uuid dir and surfaces a real error instead of a frozen modal.
    const STALL_MS = 90000;
    // ⭐⭐ 250 ms, AND THAT TICK RATE IS THE MID-ENTRY CANCEL. [B-005 item 4] This interval used
    // to run every 5 s purely as a stall watchdog, and the cancel check lived only in the
    // 'entry' handler - so a zip could only stop BETWEEN entries. One large entry (a 40 MB
    // track being compressed) meant the user waited out the whole thing with Cancel already
    // pressed, which is the original complaint arriving in a different unit.
    //
    // ⭐ Polling here rather than reaching into archiver: the abort works the same whether we
    // are between entries or halfway through one, and a timer needs nothing from the library's
    // internals. The stall test still uses its own elapsed window, so lowering the tick does
    // not make it trigger sooner.
    const watchdog = setInterval(() => {
      // ⚠️⚠️ A CANCEL IS NOT A STALL, AND THIS WATCHDOG ACCUSES THE SOURCE. Deliberately
      // stopping the archive looks identical to a file that will not read: entries stop
      // completing. Without this the user's own Cancel came back as "the source has a damaged
      // or unreadable file" - a false accusation about his font, which is far worse than no
      // message at all. [B-005 item 4]
      if (!_canceled && opts.shouldStop && opts.shouldStop()) {
        // Same teardown the 'entry' handler does, for the same reasons documented there:
        // abort the archive AND destroy the sink, or nothing settles until the stall window.
        _canceled = true;
        try { archive.abort(); } catch {}
        try { fileStream.destroy(); } catch {}
      }
      if (_canceled) { clearInterval(watchdog); return finish(reject, _cancelErr()); }
      // ⭐⭐ THE TICK IS THE PROGRESS BEAT NOW, NOT JUST THE CANCEL AND STALL BEAT. [B-420]
      // This is what makes a 300 MB entry legible: bytes read tick up four times a second while
      // one file compresses, instead of the whole display holding still until it lands.
      emit();
      // ⭐ AND THE STALL WATCHDOG STOPPED LYING ABOUT BIG FILES AS A SIDE EFFECT. `lastProgressMs`
      // used to advance only when an entry COMPLETED, so any single entry taking longer than the
      // 90 s window was accused of being "a damaged or unreadable file" - a false accusation about
      // a healthy font, which is the same wrong message a cancel used to produce. It now advances
      // on every chunk, so the window means what it says: nothing has been read for 90 seconds.
      if (Date.now() - lastProgressMs > STALL_MS) {
        clearInterval(watchdog);
        try { archive.abort(); } catch {}
        reject(new Error('Stalled reading a file — the source has a damaged or unreadable file. Nothing was imported.'));
      }
    }, 250);
    const finish = (fn, arg) => { clearInterval(watchdog); fn(arg); };
    // ⚠️ EVERY path below funnels through this. Tearing a stream down mid-write can surface as
    // 'error', 'warning' or a plain 'close', and which one arrives is not ours to predict - so
    // once _canceled is set, whatever turns up means the same thing.
    const settle = (fn, arg) => finish(_canceled ? reject : fn, _canceled ? _cancelErr() : arg);
    fileStream.on('close', () => settle(resolve));
    fileStream.on('error', (e) => settle(reject, e));
    archive.on('error', (e) => settle(reject, e));
    archive.on('warning', (err) => {
      // ENOENT during walk just means a file vanished between readdir
      // and read — rare but not fatal; surface anything else.
      if (err.code === 'ENOENT') return;
      settle(reject, err);
    });
    archive.finalize();
  });
  } catch (err) {
    // ⚠️ THE REJECTING PATH SKIPS THE CLEANUP BELOW, so it does its own. Without this a
    // cancelled zip export left the half-built archive sitting at the destination - the one
    // artefact most likely to be mistaken for a finished export. [B-005 item 4]
    if (require('./sfExportCopy').isCancel(err)) { try { fs.unlinkSync(destZipPath); } catch {} }
    throw err;
  }

  // ⚠️ Belt and braces: if 'close' won the race before _canceled was read, the rejection above
  // never happened and we land here instead. Either way the half-written zip goes. [B-005 item 4]
  if (_canceled) {
    try { fs.unlinkSync(destZipPath); } catch {}
    throw _cancelErr();
  }
  // ⚠️ THE SUCCESS PATH RELEASES THEM TOO. Every stream should already have ended on its own, and
  // "should already" is exactly the assumption that left a 26.7 MB file locked on a real library. One
  // sweep costs nothing and makes the guarantee unconditional rather than probable.
  return { hash: hasher.digest('hex'), totalBytes, fileCount, strippedFiles, blockedFiles, notedFiles };
}

// Walk a folder tree, return an array of {relPath, absPath, size} sorted
// deterministically by forward-slash relative path. Used by both the hash
// pass and the import-copy pass so they see the same files in the same order.
function walkFolderSorted(rootDir) {
  const out = [];
  const walk = (dir, relBase) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, rel);
      else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch {}
        out.push({ relPath: rel, absPath: abs, size });
      }
    }
  };
  walk(rootDir, '');
  return out;
}

async function hashFolder(folderPath, onProgress) {
  const files = walkFolderSorted(folderPath);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const hash = crypto.createHash('sha256');
  let bytesHashed = 0;
  // Throttle onProgress to ~100ms so a fast disk doesn't flood the renderer
  // with hundreds of events per second (which can make the CSS-transitioned
  // progress bar look jittery on screen).
  let lastEmit = Date.now();
  const emitMaybe = (currentFile, force) => {
    if (!onProgress) return;
    const now = Date.now();
    if (force || now - lastEmit > 100) {
      onProgress({ bytesHashed, totalBytes, currentFile });
      lastEmit = now;
    }
  };
  for (const f of files) {
    hash.update(f.relPath);
    hash.update('\0');
    const stream = fs.createReadStream(f.absPath);
    await new Promise((resolve, reject) => {
      stream.on('data', chunk => {
        hash.update(chunk);
        bytesHashed += chunk.length;
        emitMaybe(f.relPath, false);
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  }
  emitMaybe('', true);
  return { hash: hash.digest('hex'), totalBytes, fileCount: files.length };
}

function readSourceMeta(uuidDir) {
  const metaPath = path.join(uuidDir, 'meta.json');
  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
}

// Scan the sources dir for orphan UUID dirs and remove them. Two
// flavors of orphan:
//   - Corrupt shape: meta without archive, or archive without parseable
//     meta. The user can't open these and they shouldn't exist.
//   - Entry-less: a healthy source whose UUID isn't referenced by any
//     library entry. The only legitimate path to a source goes through
//     a library entry; an entry-less source has no UI surface. This
//     happens when an import was abandoned before the review modal was
//     committed, or when the user deleted every entry from a source
//     without deleting the source itself.
//
// Both flavors get torn down. Safe to call repeatedly. The renderer
// must guard against running this while a review modal is in-flight
// (its in-progress source has no entries yet); the `refreshSoundFontsView`
// caller already does that via `if (!_sfImport)`, and `importSource`
// callers are safe because the new source UUID doesn't exist yet at
// cleanup time.
//
// Returns { removed: [<uuid>...], errors: [<string>...] } so the caller
// can surface what happened.
// Remove every staged-but-never-committed source. Called at app STARTUP and at
// QUIT, which are the two moments nothing can be in flight. ([B-298])
//
// THE REASONING, because it is what makes this safe to do unconditionally: a
// staged source can never be used again once its session ends. The plan holding
// its uuid lives in the renderer, and nothing in the app adopts an orphaned
// prepared source. So across sessions it is not "possibly in flight" - it is
// garbage, always, and keeping it buys nothing.
//
// The no-meta test is the safety rail: finalize unlinks the marker BEFORE it
// stamps meta.json, so a committed source never wears one. Requiring both
// conditions means a real source cannot be caught by this even if a marker were
// somehow left behind on one.
function clearStagedSources(userData) {
  const root = sourcesRoot(userData);
  const result = { removed: [], bytes: 0 };
  if (!fs.existsSync(root)) return result;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return result; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const uuidDir = path.join(root, entry.name);
    // Keyed on meta.json, NOT on the .preparing marker. importSource creates the
    // dir and writes the archive BEFORE it writes the marker, so quitting inside
    // that window leaves a staged source wearing no marker at all — found on a
    // real quit 2026-09-02, a 32 KB source.zip alone in its directory.
    //
    // meta.json is the honest test: _writeSourceMetaAndStamp is the only thing
    // that writes it, and it is the last step of committing. No meta therefore
    // means never committed, and an uncommitted source cannot be adopted by a
    // later session. The marker is an IN-SESSION signal only. ([B-298])
    if (fs.existsSync(path.join(uuidDir, 'meta.json'))) continue; // committed — never touch
    let bytes = 0;
    try {
      const walk = (d) => {
        for (const it of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, it.name);
          if (it.isDirectory()) walk(p);
          else { try { bytes += fs.statSync(p).size; } catch {} }
        }
      };
      walk(uuidDir);
    } catch {}
    try {
      fs.rmSync(uuidDir, { recursive: true, force: true });
      result.removed.push(entry.name);
      result.bytes += bytes;
    } catch {}
  }
  return result;
}

function cleanupOrphanSources(userData) {
  const root = sourcesRoot(userData);
  const result = { removed: [], errors: [] };
  if (!fs.existsSync(root)) return result;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (err) { result.errors.push(`Cannot read sources root: ${err.message}`); return result; }
  // Build the set of source UUIDs that library entries reference. Any
  // source NOT in this set is an entry-less orphan candidate.
  const entriesRoot = path.join(userData, 'soundFonts', 'library');
  const referencedUuids = new Set();
  if (fs.existsSync(entriesRoot)) {
    let entryNames = [];
    try { entryNames = fs.readdirSync(entriesRoot); } catch {}
    for (const entryName of entryNames) {
      const metaPath = path.join(entriesRoot, entryName, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (m && m.sourceUuid) referencedUuids.add(m.sourceUuid);
      } catch {}
    }
  }
  // COMMONS ARE OWNERS TOO ([B-327]). A source-backed common references its
  // source exactly the way an entry does; without this, every voicepack's
  // source would read as entry-less and be swept on the next library render -
  // the sweep taking the provenance out from under a living common.
  const commonsRoot = path.join(userData, 'soundFonts', 'common');
  if (fs.existsSync(commonsRoot)) {
    let commonNames = [];
    try { commonNames = fs.readdirSync(commonsRoot); } catch {}
    for (const cname of commonNames) {
      const metaPath = path.join(commonsRoot, cname, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (m && m.sourceUuid) referencedUuids.add(m.sourceUuid);
      } catch {}
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const uuid = entry.name;
    const uuidDir = path.join(root, uuid);
    // In-flight PREPARED source (prepareOnly staged the zip; meta comes at
    // finalize). Marked with .preparing so a sibling prepare/import in the same
    // bulk run doesn't sweep it as an "archive without meta" orphan. Skip recent
    // ones; only reclaim a marker older than 6h (a crashed session's straggler).
    // A marker present DURING a session always means in-flight, so it is always
    // skipped. There is no age test any more: clearStagedSources() removes every
    // marker at startup and at quit, so anything wearing one here was staged by
    // THIS session and may still be on its way to finalize. ([B-298])
    //
    // The old rule reclaimed a marker over six hours old, which was a guess at
    // "is this still running?" - wrong in both directions. It let an abandoned
    // stage sit for six hours, and it would delete a genuinely running analyze
    // the moment it crossed the line.
    if (fs.existsSync(path.join(uuidDir, '.preparing'))) continue;
    const metaPath = path.join(uuidDir, 'meta.json');
    const hasMeta = fs.existsSync(metaPath);
    const hasZip = fs.existsSync(path.join(uuidDir, 'source.zip'));
    const hasFolder = fs.existsSync(path.join(uuidDir, 'source'));
    const hasArchive = hasZip || hasFolder;
    let meta = null;
    if (hasMeta) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
      catch { meta = null; }
    }
    const formatExpected = meta && meta.format;
    const formatPresent = formatExpected === 'zip' ? hasZip
      : formatExpected === 'folder' ? hasFolder
      : hasArchive;
    const isCorrupt = !meta || !formatPresent;
    const isEntryLess = !referencedUuids.has(uuid);
    if (!isCorrupt && !isEntryLess) continue;
    try {
      // ⚠️ THROUGH deleteSource, NOT A BARE rmSync. This is the SECOND door to
      // removing a source and it had drifted from the first: the plain rmSync
      // left the per-source file-hash manifest behind in .filehashes/sources/
      // AND never released the source's attachments, so a receipt nobody
      // pointed at stayed in the store forever.
      // Found 2026-09-03 the hard way: entries were moved out of the library to
      // free their names, which made their source entry-less, and the next
      // import swept it here - taking the source the dedup check was about to
      // look for. The receipt survived only because another source happened to
      // link it too.
      // One definition of "delete a source", used by both callers. If the rule
      // grows again, it grows in one place.
      const r = deleteSource(userData, uuid);
      if (r && r.ok) result.removed.push(uuid);
      else result.errors.push(`Could not remove ${uuid}: ${(r && r.error) || 'unknown error'}`);
    } catch (err) {
      result.errors.push(`Could not remove ${uuid}: ${err.message}`);
    }
  }
  return result;
}

function listSources(userData) {
  const root = sourcesRoot(userData);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const uuidDir = path.join(root, entry.name);
    const meta = readSourceMeta(uuidDir);
    if (meta) out.push({ uuid: entry.name, meta });
  }
  return out;
}

function findByHash(userData, hash) {
  for (const s of listSources(userData)) {
    if (!s.meta) continue;
    if (s.meta.hash === hash) return s;
    // ⚠️ THE RESTORED-SOURCE CASE, and it runs the OTHER WAY from
    // findByProvenance ([B-283], Ryan 2026-09-03: "if I were to then try to
    // re-import from the vendor's source... it'll tell me that it already
    // existed in my library").
    // A source restored from a JMT export holds `hash` = the EXPORT's bytes and
    // `originArchiveHash` = the vendor archive it came from. So re-picking the
    // vendor's original zip computes the vendor hash, which matches nothing in
    // `hash` and would import a second copy of something already held.
    // Matching origin here closes it. Recognition only — the caller's answer is
    // a duplicate prompt the user can override, never a refusal.
    if (s.meta.originArchiveHash && s.meta.originArchiveHash === hash) return s;
  }
  return null;
}

// Find a source by the identity a curated export CLAIMS to have come from.
// ([B-283], 2026-09-03.)
//
// ⚠️ WHY A SECOND LOOKUP EXISTS AT ALL, because "just make the bytes match" is
// the obvious answer and it is not available: a JMT export can never be
// byte-identical to the vendor's archive. Zip bytes encode the compression
// level, per-entry timestamps, entry order, unix modes and the central
// directory layout — our zipper is not theirs, so the archive hash differs
// however carefully the sidecar is stripped. Stripping buys agreement between
// two JMT exports; it cannot buy agreement with the original.
//
// So identity has to be asked a different question, and the export carries the
// answer: the ORIGINAL source's hashes, recorded when it was exported.
// Matching either against a live source means "you already have this", which
// is the case where the user exported, did NOT delete, and re-imported.
//
// ⚠️ A SIDECAR IS USER-EDITABLE, so this is a CLAIM, not proof. It is used only
// to say "you already have this" — a recognition, never a permission and never
// a licence to overwrite the source it points at.
function findByProvenance(userData, provenance) {
  if (!provenance) return null;
  const { archiveHash, contentHash } = provenance;
  if (!archiveHash && !contentHash) return null;
  for (const s of listSources(userData)) {
    const m = s.meta;
    if (!m) continue;
    // The original still sitting in the library under its vendor hash, or a
    // previous restore of the same original carrying the same provenance.
    if (archiveHash && (m.hash === archiveHash || m.originArchiveHash === archiveHash)) return s;
    if (contentHash && m.originContentHash === contentHash) return s;
  }
  return null;
}

// Patch fields on a source's meta.json in place. Used after the user
// reviews an import and edits source-level metadata (bundle/source name,
// vendor overrides, etc.) before committing entries. Refuses to touch
// immutable fields like uuid, hash, originalName, format, importedAt.
const _SOURCE_META_IMMUTABLE = new Set(['schemaVersion', 'uuid', 'hash', 'format', 'originalName', 'importedAt', 'fileSize']);
function updateSourceMeta(userData, uuid, updates) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  if (!updates || typeof updates !== 'object') return { ok: false, error: 'Missing updates' };
  const dir = path.join(sourcesRoot(userData), uuid);
  const metaPath = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) return { ok: false, error: 'Source not found' };
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch (err) { return { ok: false, error: `Cannot read meta: ${err.message}` }; }
  for (const key of Object.keys(updates)) {
    if (_SOURCE_META_IMMUTABLE.has(key)) continue;
    meta[key] = updates[key];
  }
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch (err) { return { ok: false, error: `Cannot write meta: ${err.message}` }; }
  return { ok: true, meta };
}

// Remove a source from disk. Used when the user cancels an import after the
// source was already written but before any library entries referenced it.
function deleteSource(userData, uuid) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const dir = path.join(sourcesRoot(userData), uuid);
  if (!fs.existsSync(dir)) return { ok: true, deleted: false };
  try {
    // ⚠️ RELEASE THE ATTACHMENTS FIRST, WHILE THE META STILL EXISTS TO NAME THEM.
    // Deleting the source dir takes its meta.json with it, and the meta is the
    // ONLY record of which attachments this source linked - so after the rmSync
    // nothing knows, and a receipt nobody points at sits in the store forever.
    // Nothing reclaimed it either: pruneDanglingLinks only drops LINKS pointing
    // at missing files, never files with no remaining links, and it runs only
    // during backup/restore.
    // unlinkAttachment already does the refcounted half correctly - it removes
    // the stored file only when no other source still links it - so this is
    // reusing that rule, not inventing a second one. A receipt shared by five
    // sources survives the deletion of one. (2026-09-03.)
    // Found via the import review: cancelling an import deletes the staged
    // source, so every cancelled import that had touched a receipt leaked one.
    try {
      const att = require('./soundFontAttachments');
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      for (const id of (Array.isArray(meta.attachments) ? meta.attachments : [])) {
        try { att.unlinkAttachment(userData, uuid, id); } catch {}
      }
    } catch { /* no meta, or unreadable: nothing to release */ }
    fs.rmSync(dir, { recursive: true, force: true });
    removeSourceManifest(userData, uuid); // drop the central per-file manifest too
    return { ok: true, deleted: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Recursively copy a folder. Async file-by-file so the caller can report
// progress and we don't pull all bytes into memory at once. Skips OS-level
// noise (__MACOSX subtree, AppleDouble ._* files, .DS_Store, Thumbs.db,
// desktop.ini) so library entries land clean even when the source folder
// has metadata leftovers from a Mac or Windows copy.
// `link: true` makes each destination file a HARDLINK to the source file rather
// than a copy, which is what turns a library entry into a folder of pointers
// ([B-309]). A hardlink is an equal NAME for the same content, not a reference to
// another file, and that distinction is the whole design:
//   - renaming the entry's name leaves the source's name alone
//   - deleting the entry's name leaves the content alive under the source's name
//   - deleting the SOURCE leaves the entry working, with the link count dropped
//   - the bytes exist once and are freed when the last name goes
// There is nothing to refcount and no in-use guard to write, because the
// filesystem already does exactly that accounting. A symlink or a reference table
// would need both.
//
// ⚠️ FALLS BACK TO COPYING, never fails. Hardlinks need the same volume and a
// filesystem that supports them; an export to a USB stick satisfies neither. A
// copy is always correct, just larger, so the fallback costs space and never
// correctness.
//
// ⚠️ AND IT IS ONLY SAFE BECAUSE NOTHING WRITES CONTENT INTO AN EXISTING ENTRY
// FILE. Every entry operation is a rename, an unlink, or a create-with-a-free-name
// (_proffieVariantName). Writing through a shared name would reach into the
// vendor's copy — see the invariant test in test/entry-pointers.test.js, which
// exists so that stops being a thing we remember and starts being a thing that
// fails.
async function copyFolderRecursive(srcDir, destDir, onFile, opts) {
  const link = !!(opts && opts.link);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    if (_isNoisePath(e.name)) continue;
    const srcPath = path.join(srcDir, e.name);
    const destPath = path.join(destDir, e.name);
    if (e.isDirectory()) {
      await copyFolderRecursive(srcPath, destPath, onFile, opts);
    } else if (e.isFile()) {
      let linked = false;
      if (link) {
        try { fs.linkSync(srcPath, destPath); linked = true; } catch { linked = false; }
      }
      if (!linked) await fs.promises.copyFile(srcPath, destPath);
      if (onFile) onFile(srcPath);
    }
  }
}

// Link a freshly stored source's files to identical content the library already
// holds, ACROSS sources ([B-317], 2026-09-05). Two vendors shipping the same wav,
// or the same font bought twice under different names, were stored twice — §13
// dedup only ever looked WITHIN one bundle. Measured on a 61-source library:
// 317 MB / 15.3% beyond what within-source dedup reaches.
//
// `records` is the per-file list collectFileRecords just produced for the totals,
// so the hashes are free and nothing is read twice.
//
// ⚠️ THIS RUNS AFTER EXTRACTION, NOT DURING IT, AND THAT IS A REAL DIFFERENCE.
// The property we want is "identical content is never stored twice"; what this
// gives is "…is never stored twice once the import finishes." Peak disk during
// an import is still the whole bundle, and only then falls to the novel part.
// The alternative is hashing inside _extractZipSubtree, which is shared with the
// entry-extraction path — deliberately not touched for a transient overshoot.
// Say the bound rather than calling the window harmless: on a 200 MB bundle that
// is 80% recycled, peak is 200 MB and steady state is 40 MB.
//
// ⚠️ Sources are immutable, which is why cross-source sharing is safe: nothing
// ever writes into one, so an inode shared between two vendors' bundles cannot
// surprise either. Deleting one source drops its names; the other's names keep
// the content alive.
async function _linkAgainstLibrary(userData, destDir, records, onProgress) {
  if (!userData || !Array.isArray(records) || !records.length) {
    return { linkedFiles: 0, savedBytes: 0 };
  }
  let CI;
  try { CI = require('./soundFontContentIndex'); } catch { return { linkedFiles: 0, savedBytes: 0 }; }
  const index = CI.buildIndex(userData);
  if (!index.byHash.size) return { linkedFiles: 0, savedBytes: 0 };

  let linkedFiles = 0, savedBytes = 0, done = 0;
  const total = records.length;
  for (const r of records) {
    done++;
    if (!r || !r.fileHash || r.fileHash === '<empty>') continue;
    if (_isCompositePath(r.relPath)) continue;
    const abs = path.join(destDir, r.relPath.replace(/\//g, path.sep));
    // findExisting re-hashes the candidate: the index narrows the search, it
    // never authorises the link.
    const existing = CI.findExisting(index, r.fileHash);
    if (!existing) continue;
    let st, existSt;
    try { st = fs.statSync(abs); existSt = fs.statSync(existing); } catch { continue; }
    // Already the same content by identity — nothing to do. Asking about inodes
    // rather than "is this shared with anything" is the same correction
    // _dedupeFolderSource had to make: our own files legitimately carry links.
    if (st.ino === existSt.ino && st.dev === existSt.dev) continue;
    // The file we are about to discard must be what the manifest says it is.
    let actual = null;
    try { actual = require('./soundFontFileHash').hashFile(abs); } catch {}
    if (actual !== r.fileHash) continue;
    const tmp = abs + '.xlink-tmp';
    try {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      fs.linkSync(existing, tmp);
      fs.renameSync(tmp, abs);
      linkedFiles++;
      savedBytes += st.size || 0;
    } catch {
      try { fs.rmSync(tmp, { force: true }); } catch {}
    }
    // ⚠️ PERCENT IS REQUIRED, not decorative. The import bar reads `percent` off
    // every event and falls to 0 when it is absent, so a stage that omits it
    // makes the bar snap backwards mid-import. Same failure the `expanding`
    // stage was split out to fix, reached from the other direction.
    if (onProgress && (done % 25 === 0 || done === total)) {
      onProgress({
        fileCount: done, totalFiles: total, currentFile: r.relPath,
        percent: total > 0 ? Math.max(0, Math.min(100, Math.floor((done / total) * 100))) : 0,
      });
    }
  }
  return { linkedFiles, savedBytes };
}

// Best-effort cleanup of a partial source directory on import failure.
function cleanupPartialSource(uuidDir) {
  try { fs.rmSync(uuidDir, { recursive: true, force: true }); }
  catch {}
}

// importSource({ userData, sourcePath, originalName?, metadata?, onProgress? })
//
// Returns one of:
//   { ok: true, isDuplicate: true,  uuid: <existing>, hash, format }
//   { ok: true, isDuplicate: false, uuid: <new>,      hash, format }
//   { ok: false, error: <string> }
//
// Progress events fire in three stages: hashing, copying, done.
// `stripCorrupt` is GONE as a parameter ([B-361], 2026-09-09): damaged wavs are
// now always detected and dropped by _selectFolderFiles, because the check rides
// the read the import already performs. Callers no longer have to know in advance
// that a font is damaged — which they could only learn from a full pre-walk of
// the card, the cost this entry removed.
async function importSource({ userData, sourcePath, originalName, metadata, onProgress, forceNewSource, prepareOnly, knownHash, deferCustomized }) {
  if (!userData) return { ok: false, error: 'Missing userData' };
  if (!sourcePath) return { ok: false, error: 'Missing sourcePath' };
  // Sweep corrupt source dirs (meta without archive, archive without
  // meta) BEFORE the hash dedup check. A stale meta from a crashed or
  // half-cancelled earlier import would otherwise let findByHash report
  // "already imported" pointing at a source whose archive is missing,
  // which is the exact stuck-state the user hit. Cleaning first
  // guarantees the dedup answer is honest.
  try { cleanupOrphanSources(userData); } catch {}
  if (!fs.existsSync(sourcePath)) return { ok: false, error: `Source not found: ${sourcePath}` };

  let stat;
  try { stat = fs.statSync(sourcePath); }
  catch (err) { return { ok: false, error: `Cannot stat source: ${err.message}` }; }

  const isFolder = stat.isDirectory();
  const isZip = stat.isFile() && /\.zip$/i.test(sourcePath);
  if (!isFolder && !isZip) {
    return { ok: false, error: 'Source must be a folder or a .zip file' };
  }

  // Folder-picked sources get zip-transformed on import (see
  // zipFolderToFile above for the why). format flips to 'zip' even
  // when the user picked a folder, so the rest of the source layer
  // (openSource, listSourceFiles, browse paths) treats it uniformly
  // as a zip source for the rest of its lifetime. originalName still
  // preserves the folder basename so the user-facing label is honest
  // about what they imported.
  // ⭐ ONE FORMAT ([B-309]). A source is stored as a tree whichever way it arrived.
  // The old value was 'zip' even for a folder pick, because a folder was zipped on
  // the way in; that conversion is gone, so the label is simply true now.
  const format = 'folder';
  const name = originalName || path.basename(sourcePath);

  const emit = (stage, payload) => {
    if (onProgress) onProgress({ stage, ...payload });
  };

  // ⚠️ THE ARCHIVE'S OWN DATE, CAPTURED BEFORE ANYTHING CAN REPLACE THE FILE.
  // The curation strip below repackages the zip into a temp file, and `stat` is
  // re-taken on that temp file because fileSize has to describe the repacked
  // archive. Its mtime is seconds old, so reading the date off it stamps every
  // curated import with TODAY. That is not cosmetic: purchaseDate and
  // acquisitionDate are derived from this, and the sidecar deliberately does
  // NOT carry them precisely because they restore themselves from the archive's
  // file date (soundFontCuration.js, SOURCE_FIELDS). Restore a backup zip made
  // in June and it would come back dated the day you restored it. Size comes
  // from the file we end up storing; the DATE belongs to the file the user
  // picked. ([B-283], 2026-09-03.)
  const inputMtimeMs = (stat && stat.mtimeMs) || 0;
  // The PICKED file's own size, captured before the curation strip can swap the
  // file underneath it (same reason as the date above). This is the number the
  // user saw in their Downloads folder, so it is the anchor the close-out's
  // savings sentence opens with ("Your download started at ..."). Folders have
  // no container; the close-out uses contentBytes as the anchor there.
  // Kept on the return value only, riding beside contentBytes. ([B-317])
  const inputArchiveBytes = stat && stat.isFile() ? stat.size : 0;

  // ── Curation sidecar ([B-283]) ──
  // A zip we exported can carry the hand-authored curation that a delete would
  // otherwise destroy. It is stripped HERE, before anything else looks at the
  // archive, and the archive is repackaged — so the hash, the dedup check, the
  // stored source and every consumer downstream see the font exactly as the
  // vendor shipped it, with our additions gone. Nothing else in the pipeline
  // learns that curation exists.
  // The cost is gated: an ordinary vendor zip pays one central-directory read
  // and moves on. Only an archive that actually carries a sidecar does anything more.
  let curation = null;
  let curationTmp = null;
  let curationPayloadDir = null;
  // ⚠️ THE PEEK RUNS FOR EVERY ZIP, INCLUDING THE knownHash HAND-OFF. This
  // used to be `isZip && !knownHash`, and the duplicate prompt's "import again
  // as a new source" passes knownHash — so that door skipped the strip
  // entirely: the forced source stored .jmt-curation/ (sidecar, receipts, the
  // customized-font payload) INSIDE its tree as vendor content, restored
  // nothing, and returned curation:null, which also disarmed the review's
  // sidecar-outranks-heuristic guard. Ryan hit the full stack live
  // (2026-09-08 00:44): re-importing his own export through the duplicate
  // prompt lost the restore and the checked state. Proven by headless replay
  // of both doors against his real export.
  //
  // ⭐ AND THE knownHash SHORTCUT GOT SIMPLER, NOT RISKIER. [B-427] It used to need a determinism
  // argument: the scan hashed the STRIPPED REPACK, so the shortcut was only sound because
  // stripAndRepackage plus zipFolderToFile reproduced the exact same bytes on a second run. Now the
  // hash is taken from the arriving file itself, so scan and import hash literally the same bytes and
  // there is no reproducibility claim to be wrong about. A load-bearing assumption was deleted rather
  // than re-verified, which is the better outcome of the two.
  // ⚠️⚠️ BOTH FORMATS PEEK NOW, and skipping the folder case is the live defect [B-427] closes.
  // [B-420] made folder exports carry a sidecar too, but this was still `if (isZip)` - so a folder
  // re-import stored our .jmt-curation.json and its payload INSIDE the tree as vendor content and
  // restored nothing. That is the exact failure recorded just above for the knownHash door, arriving
  // by a second route. Ryan accepted breaking it knowingly for a few hours: "it's totally fine to
  // break the imports right now since it's the next thing we're fixing after this is done."
  {
    try {
      const cur = require('./soundFontCuration');
      curation = isZip ? await cur.peekZip(sourcePath) : cur.peekDir(sourcePath);
      if (curation) {
        // ⭐⭐ NOTHING IS UNPACKED HERE ANY MORE. [B-427] This used to call
        // `stripAndRepackage`: a full extract of the archive to a temp tree, a full re-compress of
        // it, and then `sourcePath` was pointed at the repack so the hash and the pool extraction
        // both read from it - meaning the same content was extracted twice with a re-zip between.
        //
        // ⚠️ WHY THE REPACK WAS THERE, AND WHY IT NO LONGER IS. Its own comment said it outright:
        // "The repackaged archive is what gets hashed AND STORED, so the stored source is the font
        // as the vendor shipped it." That was the OLD storage model, where the archive itself was
        // the stored artifact and had to be byte-canonical so two exports of one source hashed
        // identically. The store is an unpacked content-addressed pool now - no archive is kept -
        // so there is nothing for canonical bytes to be canonical FOR.
        //
        // ⭐ THE SPLIT HAPPENS DURING THE POOL EXTRACTION INSTEAD, which was always going to run:
        // `_extractZipSubtree` takes `curationPayloadDir` and sends our files there while the
        // vendor's go to the tree. One pass, one write per file.
        // ⚠️ THE TEMP DIR SHAPE IS LOAD-BEARING. `_isCurationTmpDir` in main.js only accepts
        // os.tmpdir()/jmt-curation-*, and `sources:restoreCustomized` additionally requires the
        // payload dir to sit INSIDE it. Keep both or those IPCs refuse the restore.
        curationTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-curation-'));
        curationPayloadDir = path.join(curationTmp, 'payload');
        fs.mkdirSync(curationPayloadDir, { recursive: true });
      }
    } catch {
      // A sidecar we cannot read must never block the font behind it. Import
      // the archive as-is; the user loses the curation, not the fonts.
      curation = null;
    }
  }

  // Every exit that is not the prepareOnly hand-off is done with the temp dir
  // the strip produced. prepareOnly keeps it, because its commit happens later
  // and the receipts have to still be there.
  const _dropCurationTmp = () => {
    if (!curationTmp) return;
    try { fs.rmSync(curationTmp, { recursive: true, force: true }); } catch {}
    curationTmp = null;
  };

  emit('hashing', { percent: 0 });

  let hash;
  // [B-415] The digest of what the font CONTAINS, as opposed to `hash` which identifies the
  // source artifact. Equal for a folder; different for a zip. The intra-batch twin check reads
  // this one, so a zip and its extracted copy can recognise each other.
  let contentHash;
  // [B-415] Unique per-file digests of the staged tree, for the batch containment check.
  let fileHashes = [];
  let fileSize = 0;
  let totalBytes = 0;
  let fileCount = 0;
  let strippedFiles = []; // damaged wavs, always detected and dropped (folder imports)
  let blockedFiles = [];  // executables, never carried in, from either input ([B-214])
  let notedFiles = [];    // kept, but reported: macro documents, un-inspectable archives
  // What inner-archive expansion did. Reported rather than assumed, so a bundle
  // that refused to expand is visible instead of quietly looking ordinary.
  let innerArchives = { expanded: [], left: [] };
  let crossLinked = { linkedFiles: 0, savedBytes: 0 };

  // Zip-format input: hash THEN dedup THEN copy, like before. Dedup
  // can short-circuit cleanly before we write anything because the
  // input is already a single file we can stream-hash in place.
  if (isZip) {
    if (knownHash && forceNewSource) {
      // Duplicate-prompt hand-off: the initial scan already hashed this exact
      // file seconds ago and the user chose "import again as a new source" —
      // reuse that hash instead of re-reading the whole archive. Only honored
      // with forceNewSource (the dedup-check path must always hash fresh).
      hash = knownHash;
      fileSize = stat.size;
      totalBytes = stat.size;
      fileCount = 1;
    } else {
    try {
      hash = await hashZipFile(sourcePath, ({ bytesHashed, totalBytes: tb }) => {
        emit('hashing', {
          percent: tb > 0 ? Math.floor((bytesHashed / tb) * 100) : 0,
          bytes: bytesHashed,
          totalBytes: tb,
        });
      });
      fileSize = stat.size;
      totalBytes = stat.size;
      fileCount = 1;
    } catch (err) {
      return { ok: false, error: `Hash failed: ${err.message}` };
    }
    }
    if (!forceNewSource) {
      // Archive-bytes match first: an identical FILE re-picked. Then the
      // provenance claim, which catches the case bytes never can - exporting a
      // source, not deleting it, and importing the export back. ([B-283])
      const existing = findByHash(userData, hash)
        || findByProvenance(userData, curation && curation.provenance);
      if (existing) {
        emit('done', { isDuplicate: true });
        _dropCurationTmp();
        return { ok: true, isDuplicate: true, uuid: existing.uuid, hash, format };
      }
    }
  }

  ensureSourcesRoot(userData);
  const uuid = crypto.randomUUID();
  const uuidDir = path.join(sourcesRoot(userData), uuid);

  try {
    fs.mkdirSync(uuidDir, { recursive: true });

    // ── ONE STORAGE SHAPE: THE TREE ([B-309]) ────────────────────────────────
    // Both inputs land at uuid/source/. What changed is only WHERE THE BYTES GO;
    // identity, dedup, staging, curation and every consumer are untouched.
    // ⚠️ IDENTITY IS DELIBERATELY NOT REDEFINED HERE. `hash` stays what it has
    // always been: the identity of what ARRIVED. A picked archive is still
    // identified by its own sha256 (already computed above, before anything was
    // written), which is also what dedup relies on when it rewrites what we hold
    // and leaves `hash` alone. Only the FOLDER route's hash had to change, and
    // only because the zip it used to hash is no longer produced.
    const destDir = path.join(uuidDir, 'source');
    if (isZip) {
      emit('copying', { percent: 0, totalBytes });
      // Percent comes from the extractor, which knows the real uncompressed total.
      // ⭐ THE ONE EXTRACTION. [B-427] When the archive carried our sidecar, `curationPayloadDir` is
      // set and this same pass routes our files there while the vendor's go into the pool - replacing
      // a separate strip-and-repack that extracted everything, re-zipped it, and left this call to
      // extract it all over again.
      // ⚠️ shouldStop is passed through as null because this path never wired a cancel; leaving the
      // positional gap visible rather than hiding it behind the opts object, so it stays obvious that
      // an import staging pass is not yet cancellable.
      const result = await _extractZipSubtree(sourcePath, '', destDir, (p) => {
        emit('copying', {
          percent: p.percent, bytes: p.totalBytes, totalBytes: p.expectedBytes,
          currentFile: p.currentFile,
        });
      }, null, { curationPayloadDir });
      // Expand before measuring, so the figures describe what we actually keep
      // rather than the archives we just threw away.
      // Its OWN stage: this is a distinct operation with its own denominator, and
      // reusing 'copying' gave the user two consecutive bars labelled identically
      // with the second appearing to restart for no reason. (His catch, 2026-09-04.)
      innerArchives = await _expandInnerArchives(destDir, (p) => emit('expanding', p));
      // ⚠️ AFTER the inner expand, so a program inside a nested archive is caught too,
      // and BEFORE the records below, so the stored totals describe what is kept.
      const _purge = await _purgeExecutablesAsync(destDir);
      blockedFiles = _purge.blocked;
      notedFiles = _purge.noted;
      const fhz = require('./soundFontFileHash');
      // [B-398] Async twin: identical records, but it yields between files so the window keeps
      // answering Windows. The zip route's EXTRACT was already async — this hash pass was not,
      // which is why a zip source still stalled (899ms measured on 1.1-Energy.zip).
      const recz = (await fhz.collectFileRecordsAsync(destDir)) || [];
      // ⭐⭐ THE CONTENT DIGEST, SEPARATE FROM `hash`. [B-415] `hash` for a zip is the sha256 of
      // the ARCHIVE FILE on the user's disk, and it must stay that way: provenance and the
      // savings anchor are both written against what the creator actually shipped. But that
      // means a zip and its own extracted folder carry DIFFERENT hashes for identical fonts,
      // so the intra-batch twin check ([B-314]) could never see them as the same thing.
      // ⚠️ Costs nothing: recz is already in hand. The folder branch below has always had this
      // digest — it just happens to BE its `hash`, which is why the asymmetry went unnoticed.
      contentHash = fhz.hashRecords(recz);
      // ⭐⭐ [B-415] THE PER-FILE HASHES, carried out so the batch can ask CONTAINMENT and not
      // just equality. Measured on his own pair 2026-09-19: the full "1.2-lightsaber of the bells"
      // package is 213 files across six board folders; the copy on his desktop is 32 files that
      // are the CONTENTS of its proffie folder - and every one of that copy's 29 distinct hashes
      // is present in the original, 100% contained, nothing unique to it. Their contentHashes
      // share nothing, so equality can never see the relationship.
      // ⚠️ COSTS NO NEW I/O. These records are already in hand for contentHash - this is the cheap
      // path [B-415] said to look for before building the expensive one. A second hashing pass
      // over extracted content is exactly what [B-398] spent a day making yield; do not add one.
      fileHashes = fhz.uniqueFileHashes(recz);
      totalBytes = recz.reduce((s, r) => s + (r.size || 0), 0);
      fileCount = recz.length;
      fileSize = totalBytes;
      // ⚠️ THE TOTALS ABOVE STAY LOGICAL, deliberately, and are read before this
      // runs. They describe the CONTENT of the bundle, which is what the user
      // imported and what every downstream consumer means by its size. Linking
      // changes what the bundle OCCUPIES, never what it holds.
      crossLinked = await _linkAgainstLibrary(userData, destDir, recz,
        (p) => emit('deduping', p));
    } else {
      // Folder input: copy the selected files straight in. The selection (noise
      // filtering, corrupt-wav stripping) is the same list zipFolderToFile uses.
      // ⚠️ The hash can only be taken AFTER the copy, because there is no
      // container to hash on the way past — so the dedup check below stays where
      // it is, after the write, exactly as the zip-transform needed it.
      const sel = await _selectFolderFiles(sourcePath);
      strippedFiles = sel.strippedFiles;
      blockedFiles = sel.blockedFiles;
      notedFiles = sel.notedFiles;
      fs.mkdirSync(destDir, { recursive: true });
      // ⭐ OUR FILES ARE PARTITIONED OUT BEFORE THE COPY, not deleted afterwards. [B-427]
      // The zip route does this inside _extractZipSubtree; a folder input needs the same split here,
      // or the stored source keeps our sidecar as vendor content and the restore has nothing to read.
      // ⚠️ THE SIDECAR ITSELF IS NOT COPIED ANYWHERE. Its contents are already in hand from the peek,
      // so writing it out would only put a file on disk that nothing reads - same reasoning as the
      // zip route's drop.
      const _curMod = curation ? require('./soundFontCuration') : null;
      const _isOurs = (rel) => !!_curMod && (rel === _curMod.SIDECAR_NAME
        || rel === _curMod.PAYLOAD_DIR || rel.startsWith(`${_curMod.PAYLOAD_DIR}/`));
      const vendorFiles = sel.files.filter((f) => !_isOurs(f.relPath));
      const ourFiles = sel.files.filter((f) => _isOurs(f.relPath));
      let done = 0;
      // ⚠️ THE DENOMINATOR COUNTS WHAT THE LOOP COPIES. The strip got this wrong in the opposite
      // direction once - it totalled every entry while counting only content - so the bar parked short
      // by exactly the number of receipts riding along. Invisible on a big bundle, obvious on a
      // ten-file font with two proofs of purchase.
      const selTotal = vendorFiles.reduce((s, f) => s + f.size, 0);
      // ⚠️⚠️ AWAITED COPY, NOT copyFileSync. [B-398] This loop was the single worst offender
      // measured on his machine: 4955ms of unbroken main-thread work inside one folder source
      // (importSource:Techno), against the ~5s at which Windows greys the window and offers to
      // kill the app mid-write. A folder of several hundred wavs copied with no yield anywhere.
      // ⭐ The ZIP route never had this problem because _extractZipSubtree already awaited —
      // which is why the bug looked intermittent: it depended on whether the source was a folder.
      for (const f of vendorFiles) {
        const abs = path.join(destDir, f.relPath.replace(/\//g, path.sep));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        await fs.promises.copyFile(f.absPath, abs);
        done += f.size;
        // Copying, not hashing — the old zip-transform hashed as it wrote, this
        // does not, and the label followed the code rather than the truth.
        emit('copying', {
          percent: selTotal > 0 ? Math.floor((done / selTotal) * 100) : 0,
          bytes: done, totalBytes: selTotal, currentFile: f.relPath,
        });
      }
      // The payload rides to the same place the zip route puts it, keeping its full relative path so
      // restoreCustomizedEntries sees one layout regardless of which format it arrived in.
      for (const f of ourFiles) {
        if (f.relPath === _curMod.SIDECAR_NAME) continue;
        const payRoot = path.resolve(curationPayloadDir);
        const payDest = path.resolve(payRoot, f.relPath.replace(/\//g, path.sep));
        if (payDest !== payRoot && !payDest.startsWith(payRoot + path.sep)) continue;
        fs.mkdirSync(path.dirname(payDest), { recursive: true });
        await fs.promises.copyFile(f.absPath, payDest);
      }
      // Expand before measuring: the tree we describe must be the tree we keep.
      // Same stage as the zip route. It emitted 'hashing' here, which renders as
      // "Reading source" while the app is actually unpacking archives.
      innerArchives = await _expandInnerArchives(destDir, (p) => emit('expanding', p));
      const fhm = require('./soundFontFileHash');
      // [B-398] Async twin — see the zip route above for why.
      const recs = (await fhm.collectFileRecordsAsync(destDir)) || [];
      hash = fhm.hashRecords(recs);
      // [B-415] Same value, stated under the name the twin check reads. A folder has no
      // archive, so its identity and its content digest are one number - but the CHECK must
      // not have to know that.
      contentHash = hash;
      // [B-415] Same as the zip route above - see there for why containment needs these.
      fileHashes = fhm.uniqueFileHashes(recs);
      totalBytes = recs.reduce((s, r) => s + (r.size || 0), 0);
      fileCount = recs.length;
      fileSize = totalBytes;
      // ⚠️ AFTER the identity hash, and that ordering is load-bearing. `hash` is
      // what this source IS, and it must describe the tree the user handed us —
      // linking is a storage decision taken afterwards. Computing it the other
      // way round would still produce the same digest today (a link does not
      // change any file's content or path), but it would make re-import
      // recognition depend on what else happened to be in the library at the
      // time, which is not a property identity may have.
      crossLinked = await _linkAgainstLibrary(userData, destDir, recs,
        (p) => emit('deduping', p));
      if (!forceNewSource) {
        const existing = findByHash(userData, hash);
        if (existing) {
          // Duplicate — but for folders the hash IS the zip-transform, so the
          // finished archive already exists. KEEP it as a staged source (the
          // folder analog of the zip path's knownHash hand-off): "import again
          // as a new source" finalizes it directly with no re-zip; keep/cancel
          // discard it. The orphan sweep reclaims a crashed straggler after 6h.
          try { fs.writeFileSync(path.join(uuidDir, '.preparing'), ''); } catch {}
          let sfd = null, sfm = null;
          try {
            if (inputMtimeMs > 0) {
              sfd = require('./localDate').localDateString(inputMtimeMs); // [B-339] local, not UTC
              sfm = inputMtimeMs;
            }
          } catch {}
          emit('done', { isDuplicate: true });
          _dropCurationTmp();
          return { ok: true, isDuplicate: true, uuid: existing.uuid, hash, format,
            staged: { uuid, format, name, hash, fileSize, sourceFileDate: sfd, sourceFileMtimeMs: sfm, crossLinked } };
        }
      }
    }

    // The original archive's modification date, used as the default
    // acquisitionDate (mtime, not birthtime — birthtime gets rewritten by sync
    // clients). Read from inputMtimeMs, captured above BEFORE the curation strip
    // could swap the file underneath it, and used here so it's identical whether
    // we finalize now or later via a prepareOnly split.
    let sourceFileDate = null;
    let sourceFileMtimeMs = null;
    try {
      if (inputMtimeMs > 0) {
        sourceFileDate = require('./localDate').localDateString(inputMtimeMs); // [B-339] local, not UTC
        sourceFileMtimeMs = inputMtimeMs;
      }
    } catch {}

    // prepareOnly (the "analyze" half of bulk import): the zip is written, hashed,
    // and dedup-checked — but we DON'T write meta or create the entry yet. The
    // caller shows real stats, lets the user prune/edit, then calls
    // finalizePreparedSource to commit (no re-hash — the zip is already here).
    if (prepareOnly) {
      // Mark as in-flight so a sibling prepare/import doesn't sweep this staged
      // zip as an orphan before we finalize it.
      try { fs.writeFileSync(path.join(uuidDir, '.preparing'), ''); } catch {}
      emit('done', { isDuplicate: false, prepared: true });
      // Curation travels with the prepared source rather than being applied
      // now: the meta this belongs on does not exist until finalize. The temp
      // dir holding the receipts stays alive until then, and finalize removes it.
      return { ok: true, isDuplicate: false, prepared: true, uuid, uuidDir, hash, contentHash, fileHashes, format, name, fileSize, archiveBytes: inputArchiveBytes, sourceFileDate, sourceFileMtimeMs, totalBytes, fileCount, strippedFiles, blockedFiles, notedFiles, crossLinked, curation, curationTmp, curationPayloadDir };
    }

    const res = await _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, strippedFiles, blockedFiles, notedFiles, curation, curationPayloadDir, crossLinked, deferCustomized });
    emit('done', { isDuplicate: false });
    // Deferred customized payload: the review form now owns the decision, so
    // the strip's temp dir has to outlive this call — the commit restores the
    // checked rows from it, the cancel discards it. Everything else drops the
    // tmp here exactly as before. (2026-09-08.)
    const _pendingKeepsTmp = !!(res.customizedPending && res.customizedPending.length && curationTmp);
    if (!_pendingKeepsTmp) _dropCurationTmp();
    // ⚠️ THE PAYLOAD ITSELF GOES BACK TO THE CALLER, not just a count of what was
    // applied. The import review has to PRE-FILL from it, and until it did, the
    // review's empty fields were written straight over these values seconds after
    // they landed - so a curated re-import came back with almost nothing. Returning
    // only `curationApplied` was what forced the renderer to guess. ([B-283])
    // contentBytes is the LOGICAL size of what this source holds, before any
    // sharing. The close-out needs it to say what the font costs on disk
    // (holds minus saved), and it cannot be recovered later without
    // re-walking the tree. ([B-317], 2026-09-06.)
    return { ...res, strippedFiles, blockedFiles, notedFiles, crossLinked, contentBytes: fileSize,
      archiveBytes: inputArchiveBytes,
      curation: curation || null, curationApplied: res.curationApplied || null,
      // The payload's temp-dir handles ride to the caller ONLY while a deferred
      // restore is pending — same round-trip discipline as the staged folder
      // door, which already carries curationTmp through the renderer.
      ...(_pendingKeepsTmp ? { curationTmp, curationPayloadDir } : {}) };
  } catch (err) {
    cleanupPartialSource(uuidDir);
    _dropCurationTmp();
    return { ok: false, error: `Import failed: ${err.message}` };
  }
}

// Shared meta writer + candidate-cache warm. Used by importSource's finalize
// path AND finalizePreparedSource (the deferred commit of a prepareOnly source),
// so the written meta is identical whichever way a source is committed.
async function _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, strippedFiles, blockedFiles, notedFiles, curation, curationPayloadDir, crossLinked, deferCustomized }) {
  const meta = {
    schemaVersion: 1,
    uuid,
    format,
    originalName: name,
    hash,
    vendor: (metadata && metadata.vendor) || null,
    vendorWebsite: (metadata && metadata.vendorWebsite) || null,
    vendorAutoDetected: !!(metadata && metadata.vendorAutoDetected),
    purchaseDate: (metadata && metadata.purchaseDate) || sourceFileDate || null,
    sourceFileDate,
    sourceFileMtimeMs,
    importedAt: new Date().toISOString(),
    userNotes: (metadata && metadata.userNotes) || '',
    fileSize,
    readmePaths: [],
    // Provenance: damaged wavs that were removed on import (empty/absent when none).
    ...(strippedFiles && strippedFiles.length ? { strippedFiles } : {}),
    // ⚠️ RECORDED ON THE ENTRY, not just announced in a dialog ([B-214]). The dialog
    // closes; the question "what did this font arrive carrying" outlives it, and it is
    // the one a person asks long after the import. Same shape as strippedFiles above.
    ...(blockedFiles && blockedFiles.length ? { blockedFiles } : {}),
    ...(notedFiles && notedFiles.length ? { notedFiles } : {}),
    // The curation this archive arrived carrying, kept whole on the source so
    // createEntry can read the per-candidate half later without the review
    // screen having to carry it through. Source-level fields are applied
    // immediately, just below. ([B-283])
    ...(curation ? { curation } : {}),
    // What this bundle shared with content the library already held ([B-317]).
    // Written HERE rather than stamped afterwards so both doors to committing a
    // source — the direct finalize and finalizePreparedSource — record it the
    // same way, which is the reason this function exists.
    ...(crossLinked && crossLinked.linkedFiles ? { crossLinkStats: crossLinked } : {}),
  };
  // ── Provenance restore ([B-283]) ────────────────────────────────────────
  // "It should be identical to what it was before I deleted." Two halves:
  //
  // 1. THE DATES come back from the sidecar, not from the export's own file
  //    date. The export was written today; the bundle was acquired months ago,
  //    and reading the date off the file we just received makes every restored
  //    source look brand new.
  //
  // 2. THE ORIGINAL IDENTITY is recorded as originArchiveHash /
  //    originContentHash. ⚠️ IT DOES NOT OVERWRITE `hash`. `hash` is the
  //    sha256 of the source.zip we actually hold, and a great deal downstream
  //    verifies against it — a meta that lies about its own file is worse than
  //    one that cannot recognise a re-import. These are separate fields
  //    precisely so both statements stay true: this IS the same content, and
  //    this is NOT the same file.
  const _prov = (curation && curation.provenance) || null;
  if (_prov) {
    // THE RESTORE OVERRIDES THE DATE - the third of the three sources in his rule
    // (file's date / user's override / restore). Every name the value is kept
    // under is set, so no surface can come back blank: a source with no Acquired
    // date is a trace of the delete, and there are none in a real library.
    if (_prov.purchaseDate)      meta.purchaseDate      = _prov.purchaseDate;
    if (_prov.acquisitionDate)   meta.acquisitionDate   = _prov.acquisitionDate;
    if (_prov.sourceFileDate)    meta.sourceFileDate    = _prov.sourceFileDate;
    if (_prov.sourceFileMtimeMs) meta.sourceFileMtimeMs = _prov.sourceFileMtimeMs;
    if (_prov.updatedAt)         meta.updatedAt         = _prov.updatedAt;
    // A vendor the app once guessed must not come back as a user assertion.
    if (_prov.vendorAutoDetected) meta.vendorAutoDetected = true;
    if (_prov.archiveHash) meta.originArchiveHash = _prov.archiveHash;
    if (_prov.contentHash) meta.originContentHash = _prov.contentHash;
    // ⚠️ originalName IS PROVENANCE, and not carrying it made an artefact COMPOUND.
    // It is normally taken from the FILENAME OF THE FILE PICKED (:653). An export
    // written beside an existing one gets auto-numbered, so importing
    // "Outcast_Knight (1).zip" bakes that suffix into the library permanently -
    // originalName is in _SOURCE_META_IMMUTABLE and cannot be corrected afterwards.
    // The next export is named from it, collides again, and you get
    // "Outcast_Knight (1) (1).zip". Every round trip adds one. (Ryan hit exactly
    // this on 2026-09-03.)
    // A RESTORE IS NOT A FRESH IMPORT: the sidecar knows the true name, so use it
    // rather than whatever the file we happen to be holding is called.
    if (curation.originalName) meta.originalName = curation.originalName;
  }
  fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify(meta, null, 2));
  // Curation: apply the source fields and re-store the receipts that rode
  // along. Deliberately AFTER the meta write, because updateSourceMeta patches
  // a file that has to exist. Never fatal - a font that imports without its
  // curation is still an imported font.
  let curationApplied = null;
  if (curation) {
    try {
      curationApplied = require('./soundFontCuration')
        .applySourceCuration(userData, uuid, curation, curationPayloadDir);
    } catch { curationApplied = null; }
  }
  // Customized fonts that rode the export come back as library entries
  // ([B-311]), HERE so both commit doors restore them identically — same
  // reason this function exists. Must run while curationPayloadDir is still
  // alive: the direct door drops it right after this returns, the prepared
  // door in finalizePreparedSource's finally.
  //
  // ⚠️ EXCEPT when the caller defers ([B-311] rescope, 2026-09-08): the
  // single-import doors show a review AFTER the source commits, and an eager
  // restore put entries in the library before the user said import — the
  // review's own matcher then found the copy it had just created and told the
  // user their deleted font was "already in your library". Deferred, nothing
  // lands until Add to Library, and only the rows left checked. The bulk door
  // never defers: its finalize already runs after the user confirmed.
  let customizedRestored = null;
  let customizedPending = null;
  if (curation && curationPayloadDir && Array.isArray(curation.customized) && curation.customized.length) {
    if (deferCustomized) {
      customizedPending = curation.customized.map((c, i) => ({
        index: i,
        name: (c.curation && typeof c.curation.name === 'string' && c.curation.name.trim())
          ? c.curation.name.trim()
          : (String(c.entryName || '').trim() || 'Customized font'),
        candidatePath: c.candidatePath == null ? '' : c.candidatePath,
      }));
    } else {
      try {
        customizedRestored = await require('./soundFontCuration')
          .restoreCustomizedEntries(userData, uuid, curation, curationPayloadDir);
      } catch { customizedRestored = null; }
    }
  }
  // Warm the candidate cache (best-effort; a stamp failure just leaves it cold).
  try { await recomputeAndStampCandidates(userData, uuid); } catch {}
  // crossLinked is echoed so BOTH doors report it the same way, like the meta
  // write above. The direct path re-adds its own copy (same value); without
  // this echo the finalizePreparedSource door returned nothing, and the bulk
  // summary read crossSaved as 0 for every prepared source. (2026-09-07.)
  return { ok: true, isDuplicate: false, uuid, hash, format, sourceFileDate, curationApplied,
    customizedRestored, customizedPending, crossLinked: crossLinked || null };
}

// Commit a source previously staged by importSource({ prepareOnly: true }). Its
// uuid/source.zip is already on disk, hashed and dedup-cleared — this only writes
// the meta and warms the cache. NO re-hash. The prepared fields come back from
// the prepare result and pass straight through.
async function finalizePreparedSource({ userData, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, curation, curationTmp, curationPayloadDir, crossLinked, deferCustomized }) {
  if (!userData || !uuid) return { ok: false, error: 'Missing userData/uuid' };
  const uuidDir = path.join(sourcesRoot(userData), uuid);
  // A prepared source is a TREE now ([B-309]). Checked strictly rather than
  // permissively: accepting either shape here is how a mixed library would creep
  // in, and there is deliberately no such state.
  if (!fs.existsSync(path.join(uuidDir, 'source'))) return { ok: false, error: 'Prepared source is missing its files' };
  // No longer in-flight — clear the marker BEFORE stamping so it isn't hashed
  // into the source's content signature.
  try { fs.unlinkSync(path.join(uuidDir, '.preparing')); } catch {}
  let _keptTmpForPending = false;
  try {
    const res = await _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format: format || 'zip', name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, curation, curationPayloadDir, crossLinked, deferCustomized });
    // Deferred pending rows: the review still owes the restore, so the payload
    // stays alive past this call (same as the direct door). The commit or the
    // cancel is what finally drops it.
    _keptTmpForPending = !!(res.customizedPending && res.customizedPending.length && curationTmp);
    return _keptTmpForPending ? { ...res, curationTmp, curationPayloadDir } : res;
  } catch (err) {
    return { ok: false, error: `Finalize failed: ${err.message}` };
  } finally {
    // The prepare kept this alive so the receipts would still be on disk at
    // commit time. Whatever happened above, it is done with now — unless a
    // deferred restore is still pending on it. ([B-283])
    if (curationTmp && !_keptTmpForPending) { try { fs.rmSync(curationTmp, { recursive: true, force: true }); } catch {} }
  }
}

// Discard a prepareOnly source the user chose not to keep: delete its staged
// uuid dir. SAFETY: only removes a source that was prepared but NEVER finalized
// (has source.zip but no meta.json). A finalized source (meta present) is a real
// library entry and is left alone — so the caller can safely discard every
// prepared uuid on modal close without risking committed ones. Idempotent.
function discardPreparedSource(userData, uuid) {
  if (!userData || !uuid) return;
  const uuidDir = path.join(sourcesRoot(userData), uuid);
  try {
    if (fs.existsSync(path.join(uuidDir, 'meta.json'))) return; // finalized — keep
    cleanupPartialSource(uuidDir);
  } catch {}
}

// ── Format dispatch (Phase 1, slice 2) ──────────────────
// A "Source" object abstracts read access to a stored source so higher layers
// (vendor detection, candidate detection, browse UI, library entry creation)
// don't care whether it's zip-backed or folder-backed. Operations:
//   browse(subPath)          -> array of entries at that path within the source
//   readFile(filePath)       -> Buffer of the file's contents
//   extractTo(subPath, dest) -> copies the subtree at subPath into dest
//   exportToDownloads(dest)  -> copies the original archive to dest
//
// All paths inside the source are forward-slash separated, root is ''.

// Open a zip for read. skipEntryNameValidation lets us walk zips that
// contain a literal "/" root entry or other shapes node-stream-zip considers
// absolute/malicious by default (several vendor zips do, e.g. JayDaloRian).
// We re-add zip-slip protection at extractTo time by validating that each
// destination path stays inside destDir.
function _openZip(zipPath) {
  return new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
}

// Normalize node-stream-zip's entries object into our internal shape: an
// array of { fileName, size, isDir }, filtering out the bare "/" root entry
// and any entry with an empty name.
async function _readAllZipEntries(zip) {
  const map = await zip.entries();
  const out = [];
  for (const key of Object.keys(map)) {
    const e = map[key];
    if (!e.name || e.name === '/') continue;
    out.push({
      fileName: e.name,
      size: e.size,
      isDir: e.isDirectory || /\/$/.test(e.name),
    });
  }
  return out;
}

async function _readZipEntryToBuffer(zip, entry) {
  return await zip.entryData(entry.fileName);
}

// Recurse a source zip to its LEAF files, descending into inner .zip entries so
// their contents are visible to the per-file hash system. A font delivered
// inside Proffie.zip is otherwise invisible to library dedup / compare / import
// matching — we never hashed it, so we can't know we already own it. Inner-zip
// leaves get a composite path "Inner.zip/inner/path" (forward-slash separators,
// the same convention _resolveCompositeReadBytes reads back). The inner .zip
// file itself is NOT recorded as a leaf: it's a container, rebuilt from its
// leaves on reconstruction. Arbitrary nesting depth. onLeaf(relPath, size, buf).
async function _collectZipLeaves(zip, prefix, keep, onLeaf, onRead) {
  const entries = await _readAllZipEntries(zip);
  const innerZips = [];
  for (const e of entries) {
    if (e.isDir) continue;
    const full = prefix + e.fileName;
    if (/\.zip$/i.test(e.fileName)) { innerZips.push({ e, full }); continue; }
    if (keep && !keep(full)) continue;
    let buf; try { buf = await _readZipEntryToBuffer(zip, e); } catch { continue; }
    onLeaf(full, e.size, buf);
    if (onRead) onRead(full, e.size);
  }
  for (const iz of innerZips) {
    let buf; try { buf = await _readZipEntryToBuffer(zip, iz.e); } catch { continue; }
    // The blob read is the byte cost; inner leaves below tick names only (0 bytes)
    // so a byte-driven caller total (outer entry table) still lands at 100%.
    if (onRead) onRead(iz.full, iz.e.size);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-manifest-inner-'));
    try {
      const tmpZip = path.join(tmpDir, 'inner.zip');
      fs.writeFileSync(tmpZip, buf);
      const innerZip = _openZip(tmpZip);
      try { await _collectZipLeaves(innerZip, iz.full + '/', keep, onLeaf, onRead && ((rel) => onRead(rel, 0))); }
      finally { await innerZip.close(); }
    } catch {} finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
  }
}

// A manifest record path that points INSIDE an inner zip (has a ".zip/" segment
// that isn't the final path component). These are the leaves _collectZipLeaves
// surfaces; trimming them needs the reconstruction promise honored everywhere.
function _isCompositePath(relPath) {
  return /\.zip\//i.test(String(relPath || ''));
}

// Split a composite path into [innerZipPath, innerRelPath]. The inner-zip path
// is everything up to and including the FIRST ".zip"; the rest is the path
// inside it. Non-composite paths return [null, path]. Library-wide scan proved
// nesting is exactly one level deep, so the first ".zip" is the only boundary.
//   "Grip/Proffie.zip/Proffie/boot.wav" -> ["Grip/Proffie.zip", "Proffie/boot.wav"]
//   "Grip/ReadMe.txt"                   -> [null, "Grip/ReadMe.txt"]
function _splitComposite(relPath) {
  const m = String(relPath || '').match(/^(.*?\.zip)\/(.*)$/i);
  return m ? [m[1], m[2]] : [null, String(relPath || '')];
}

async function _writeZipEntryToFile(zip, entry, destPath) {
  await new Promise((resolve, reject) => {
    zip.stream(entry.fileName)
      .then(stream => {
        const writeStream = fs.createWriteStream(destPath);
        stream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        stream.pipe(writeStream);
      })
      .catch(reject);
  });
}

// Build a one-level browse listing from a flat list of zip entries (or from
// pre-flattened folder entries). Each input entry is { fileName, size, isDir }
// where fileName is the full forward-slash path inside the source.
function _listAtPath(allEntries, basePath) {
  const prefix = basePath ? basePath.replace(/\/+$/, '') + '/' : '';
  const seenDirs = new Set();
  const items = [];
  for (const e of allEntries) {
    if (!e.fileName.startsWith(prefix)) continue;
    const rest = e.fileName.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (!e.isDir) {
        items.push({ name: rest, isDirectory: false, size: e.size, path: prefix + rest });
      } else if (!seenDirs.has(rest)) {
        // Trailing-slash entry at this level
        seenDirs.add(rest);
        items.push({ name: rest, isDirectory: true, path: prefix + rest });
      }
    } else {
      const dirName = rest.slice(0, slash);
      if (!seenDirs.has(dirName)) {
        seenDirs.add(dirName);
        items.push({ name: dirName, isDirectory: true, path: prefix + dirName });
      }
    }
  }
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  return items;
}

// Return a destination path inside targetDir for `filename` that does not
// collide with an existing file or folder. If `filename` is free, returns it
// directly. Otherwise appends " (N)" before the extension and increments N
// until a free name is found. Used by exportToDownloads so re-exports never
// overwrite the user's existing copy of a font.
function _uniqueDestPath(targetDir, filename) {
  const direct = path.join(targetDir, filename);
  if (!fs.existsSync(direct)) return direct;
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let n = 1;
  while (true) {
    const candidate = path.join(targetDir, `${stem} (${n})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    n++;
  }
}

// Top-level folders inside a set of file records (board-format dirs like
// Proffie / cfx / Verso, plus any other subfolder). Root-level files (a bare
// ReadMe.txt) are not folders. Used to describe an export in its completion
// summary ("includes Asteria, cfx, GoldenHarvest, …").
function _topFolders(records) {
  const set = new Set();
  for (const r of (records || [])) {
    const rel = String(r.relPath || '');
    const slash = rel.indexOf('/');
    if (slash > 0) set.add(rel.slice(0, slash));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function _normalizeSubPath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

// Composite-path resolver. Source-file paths from the renderer may traverse
// inner zips: "Indara.zip/Indara/Proffie/boot.wav" means open the outer
// source, pull Indara.zip out, open IT, then read Indara/Proffie/boot.wav
// from inside. The renderer's file-browser builds these paths when it
// splices inner-zip subtrees into the outer tree (see _sfPrefixSubtreePaths
// in renderer/index.html), and every file action (play, copy, extract,
// export) needs them resolved transparently so navigation isn't decorative.
//
// Takes a `readable` (anything with async readFile(flatPath)) and a path
// that may contain N levels of inner zips. Recurses once per zip layer:
// each layer reads the inner zip's bytes from its parent, opens it via a
// temp file (node-stream-zip can't open buffers in async mode), and runs
// the resolver on the remaining path against the inner zip's central
// directory. Multi-level nesting (a.zip/b.zip/c.wav) works the same way.
async function _resolveCompositeReadBytes(readable, subPath) {
  const normalized = String(subPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) throw new Error('readFile requires a path');
  const m = normalized.match(/^(.+?\.zip)\/(.+)$/i);
  if (!m) {
    // Flat path — read directly from the current readable.
    return await readable.readFile(normalized);
  }
  const innerZipPath = m[1];
  const insidePath = m[2];
  const innerBytes = await readable.readFile(innerZipPath);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-sf-readinner-'));
  const tmpZip = path.join(tmpDir, 'inner.zip');
  try {
    fs.writeFileSync(tmpZip, innerBytes);
    const zip = new StreamZip.async({ file: tmpZip, skipEntryNameValidation: true });
    try {
      const innerReadable = {
        async readFile(p) { return await zip.entryData(p); },
      };
      return await _resolveCompositeReadBytes(innerReadable, insidePath);
    } finally {
      await zip.close();
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}


// Extract a subtree of a zip onto disk. `subPath` of '' means the whole archive.
//
// ⭐ ONE IMPLEMENTATION, TWO CALLERS ([B-309]). This is the body that used to live
// inside _createZipSource.extractTo, lifted out unchanged so IMPORT can store a
// picked archive as a tree using the very same code a stored source uses to pull a
// candidate out of itself. The alternative — a second extractor written beside this
// one for the import path — is exactly the mistake that cost a build today: a
// parallel path drifts from the pipeline around it, and the drift is silent.
// Everything the original did is load-bearing and stays: noise filtering, the
// zip-slip guard, per-file progress, and the { fileCount, totalBytes } contract.
// ⭐⭐ `opts.curationPayloadDir` MAKES THIS THE ONLY EXTRACTION AN IMPORT NEEDS. [B-427]
// A zip carrying our sidecar used to be unpacked TWICE: `stripAndRepackage` extracted the whole
// archive to a temp tree, re-zipped it, and then THIS function extracted that repack into the pool -
// two complete extractions of identical content with a re-compress wedged between them. Ryan:
// "unpack, extract the side car, repack, then unpack also seems dumb."
// The repack existed because the ARCHIVE used to be the stored artifact and had to stay
// byte-canonical. The store is an unpacked pool now, so the split can happen during the one
// extraction that was always going to run: our files go to the payload dir, the vendor's go to the
// tree, and neither is written twice.
// ⚠️ ONLY WHEN EXTRACTING THE WHOLE ARCHIVE (no subPath). A subtree extraction is a different job -
// reading one folder out of a source - and must not start second-guessing what it finds.
async function _extractZipSubtree(zipPath, subPath, destDir, onProgress, shouldStop = null, opts = {}) {
  const norm = _normalizeSubPath(subPath);
  const prefix = norm ? norm + '/' : '';
  const _cur = (!norm && opts.curationPayloadDir) ? require('./soundFontCuration') : null;
  // The sidecar itself is DROPPED, not relocated: its contents already came back from peekZip as an
  // object, so extracting it would only put a file on disk that nothing reads.
  const _isSidecar = (rel) => !!_cur && rel === _cur.SIDECAR_NAME;
  // The payload files (receipts, a customized font) are the POINT of carrying the sidecar, so they
  // are extracted out of the way rather than discarded - they just must not land in the tree that
  // becomes the stored source.
  const _isPayload = (rel) => !!_cur
    && (rel === _cur.PAYLOAD_DIR || rel.startsWith(`${_cur.PAYLOAD_DIR}/`));
  const zip = _openZip(zipPath);
  try {
    const entries = await _readAllZipEntries(zip);
    const matching = entries.filter(e => {
      if (norm && !e.fileName.startsWith(prefix) && e.fileName !== norm && e.fileName !== prefix) return false;
      if (_isNoisePath(e.fileName)) return false;
      if (_isSidecar(e.fileName.replace(/\\/g, '/'))) return false;
      return true;
    });
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const destDirResolved = path.resolve(destDir);
    let fileCount = 0;
    let totalBytes = 0;
    // ⚠️ THE DENOMINATOR IS THE UNCOMPRESSED TOTAL, taken from the central directory
    // before a byte is written. Callers were computing a fraction against the
    // ARCHIVE'S file size while counting extracted bytes out, which reads over 100%
    // on anything that compresses at all - measured at 194% on a real bundle. The
    // entry table already knows the true total, so the percent is reported from here
    // and every caller stops having to invent one.
    const expectedBytes = matching.reduce((s, e) => s + (e.isDir ? 0 : (e.size || 0)), 0);
    for (const entry of matching) {
      // ⚠️ Between entries: the file just written is complete, the next never starts. The
      // `finally` below still closes the zip handle on the way out. [B-005 item 4]
      if (shouldStop && shouldStop()) throw new (require('./sfExportCopy').ExportCancelled)();
      const rel = norm ? entry.fileName.slice(prefix.length) : entry.fileName;
      if (!rel) continue;
      // ⭐ OUR FILES BRANCH OFF HERE, inside the same loop, so they cost one write like everything
      // else. [B-427] They keep their FULL relative path under the payload dir (so it holds
      // .jmt-curation/...), which is the layout restoreCustomizedEntries already reads.
      // ⚠️ AND THEY ARE NOT COUNTED. fileCount and totalBytes describe the STORED SOURCE - the
      // vendor's font - and a receipt riding along is not part of it. The strip made this mistake in
      // the other direction once: its denominator counted payload files its counter ignored, so the
      // bar parked short by exactly the number of receipts.
      if (_isPayload(rel.replace(/\\/g, '/'))) {
        if (entry.isDir) continue;
        const payRoot = path.resolve(opts.curationPayloadDir);
        const payDest = path.resolve(payRoot, rel.replace(/\//g, path.sep));
        if (payDest !== payRoot && !payDest.startsWith(payRoot + path.sep)) continue;  // zip-slip
        fs.mkdirSync(path.dirname(payDest), { recursive: true });
        await _writeZipEntryToFile(zip, entry, payDest);
        continue;
      }
      const destPath = path.join(destDir, rel.replace(/\//g, path.sep));
      // Zip-slip guard: refuse any entry whose resolved destination
      // escapes destDir (e.g. "../../etc/passwd"). node-stream-zip
      // doesn't validate this for us, so we enforce it here.
      const resolved = path.resolve(destPath);
      if (resolved !== destDirResolved && !resolved.startsWith(destDirResolved + path.sep)) {
        throw new Error(`Refused to extract outside destination: ${rel}`);
      }
      if (entry.isDir) {
        if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
        continue;
      }
      const parent = path.dirname(destPath);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      await _writeZipEntryToFile(zip, entry, destPath);
      fileCount++;
      totalBytes += entry.size || 0;
      if (onProgress) onProgress({
        fileCount, totalBytes, currentFile: rel,
        expectedBytes,
        percent: expectedBytes > 0 ? Math.max(0, Math.min(100, Math.floor((totalBytes / expectedBytes) * 100))) : 0,
      });
    }
    return { fileCount, totalBytes };
  } finally {
    await zip.close();
  }
}

const INNER_ARCHIVE_MAX_DEPTH = 4;

// Replace every .zip inside a freshly stored tree with a folder of the same name,
// repeating until none are left. [B-309]
//
// ⭐⭐ THIS IS WHAT RETIRES `nested`, AND IT RETIRES IT WITHOUT TOUCHING THE
// DETECTOR. detectCandidates emits a deferred, un-openable candidate whenever it
// meets an archive it cannot look inside; run this first and it never meets one.
// Everything downstream then applies for free: the manifest sees real files
// instead of one line per archive, dedup can find what sibling fonts share, entries
// become pointers, and the Customized marker can answer at all.
// Measured on a real bundle before this existed: Power_Of_Many stored TEN sealed
// archives totalling 2.18 GB as ELEVEN files, so its nine fonts got no dedup, no
// pointers and a permanently unknowable customization state.
//
// ⚠️ A FLAT LOOP, NOT MUTUAL RECURSION. An earlier version had this function and the
// extractor call each other, each holding its own cap — which reset at every level
// and therefore bounded nothing. Depth is a counter here and archives revealed by
// one pass are handled by the next.
//
// ⚠️ A NAME ALREADY TAKEN IS LEFT ALONE, never merged. A vendor shipping both
// Proffie/ and Proffie.zip is telling us something we cannot read, and merging one
// over the other silently picks a winner between two things that may differ. The
// cost of leaving it is only that this source keeps the old deferred-candidate
// behaviour, which is the honest outcome, and `left` reports it so the case stops
// being hypothetical if it ever occurs.
async function _expandInnerArchives(rootDir, onProgress) {
  const expanded = [], left = [];
  // ⚠️ THE BAR HAS TO MOVE, and it needs a denominator to move against. Forwarding
  // the inner extractor's payload untouched sent no `percent` at all — and this is
  // the LONGEST phase of importing a bundle-of-archives, so a motionless bar there
  // reads as hung at exactly the wrong moment. (Seen on a real import, 2m31s in.)
  // Progress is weighted by ARCHIVE SIZE, which is known from the walk before any
  // of it is opened. The denominator grows as deeper archives are revealed, so it
  // is `done / (done + remaining)` — honest at every instant rather than a number
  // that would need the future to be already known.
  let doneBytes = 0;
  for (let depth = 0; depth < INNER_ARCHIVE_MAX_DEPTH; depth++) {
    const found = walkFolderSorted(rootDir)
      .filter(f => /\.zip$/i.test(f.relPath) && !_isNoisePath(f.relPath))
      .filter(f => !left.includes(f.relPath));
    if (!found.length) break;
    const remaining = found.reduce((s, f) => s + (f.size || 0), 0);
    const denom = doneBytes + remaining;
    let did = false;
    for (const z of found) {
      const targetRel = z.relPath.replace(/\.zip$/i, '');
      const targetAbs = path.join(rootDir, targetRel);
      if (fs.existsSync(targetAbs)) { left.push(z.relPath); continue; }
      const startedAt = doneBytes;
      try {
        await _extractZipSubtree(z.absPath, '', targetAbs, onProgress
          ? (p) => {
              // Within one archive, advance proportionally through its own share.
              const inner = p.totalBytes > 0 ? Math.min(1, (p.totalBytes || 0) / Math.max(1, z.size)) : 0;
              const at = startedAt + (z.size || 0) * inner;
              onProgress({
                percent: denom > 0 ? Math.max(0, Math.min(100, Math.floor((at / denom) * 100))) : 0,
                bytes: Math.round(at), totalBytes: denom,
                currentFile: `${targetRel}/${p.currentFile || ''}`,
              });
            }
          : null);
      } catch {
        // An archive we cannot read is left as a file rather than failing the
        // whole import — the user keeps the bundle, minus one expansion.
        left.push(z.relPath);
        continue;
      }
      fs.rmSync(z.absPath, { force: true });
      // ⭐ AN ARCHIVE THAT WRAPS ITS CONTENT IN A FOLDER OF ITS OWN NAME IS UNWRAPPED.
      // Sol.zip containing Sol/ expanded to Sol/Sol/..., doubling a segment on every
      // path beneath it — noise in every candidate path, and real pressure on the
      // Windows path limit for deep track folders. Only collapsed when the single
      // top-level directory matches the archive name exactly, so a bundle whose one
      // folder is genuinely a different thing is left alone.
      try {
        const kids = fs.readdirSync(targetAbs, { withFileTypes: true });
        const only = kids.length === 1 && kids[0].isDirectory() ? kids[0].name : null;
        if (only && only.toLowerCase() === path.basename(targetRel).toLowerCase()) {
          const inner = path.join(targetAbs, only);
          const stash = targetAbs + '.unwrap-tmp';
          fs.renameSync(inner, stash);
          fs.rmSync(targetAbs, { recursive: true, force: true });
          fs.renameSync(stash, targetAbs);
        }
      } catch { /* leave the extra layer rather than risk the tree */ }
      doneBytes += (z.size || 0);
      expanded.push(z.relPath);
      did = true;
    }
    if (!did) break;
  }
  // Anything still on disk after the cap is reported, not silently accepted.
  for (const f of walkFolderSorted(rootDir)) {
    if (/\.zip$/i.test(f.relPath) && !_isNoisePath(f.relPath) && !left.includes(f.relPath)) {
      left.push(f.relPath);
    }
  }
  return { expanded, left };
}

function _createFolderSource({ uuid, uuidDir, meta }) {
  const folderRoot = path.join(uuidDir, 'source');

  // Flat-only read of a single file from the folder source. Same role as
  // _readFlat in _createZipSource: bottom of the composite-path recursion
  // for paths that traverse inner zips inside a folder-imported source
  // (vendor.zip files dropped inside a folder bundle).
  async function _readFlat(filePath) {
    const norm = _normalizeSubPath(filePath);
    if (!norm) throw new Error('readFile requires a path');
    const abs = path.join(folderRoot, norm);
    if (!fs.existsSync(abs)) throw new Error(`Not found in source: ${norm}`);
    return await fs.promises.readFile(abs);
  }

  return {
    uuid,
    meta,
    format: 'folder',

    async listAll() {
      const out = [];
      const walk = (dir, relBase) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
          const abs = path.join(dir, e.name);
          const rel = relBase ? `${relBase}/${e.name}` : e.name;
          if (e.isDirectory()) {
            out.push({ fileName: `${rel}/`, size: 0, isDir: true });
            walk(abs, rel);
          } else if (e.isFile()) {
            let size = 0;
            try { size = fs.statSync(abs).size; } catch {}
            out.push({ fileName: rel, size, isDir: false });
          }
        }
      };
      walk(folderRoot, '');
      return out;
    },

    async browse(subPath) {
      const norm = _normalizeSubPath(subPath);
      const target = norm ? path.join(folderRoot, norm) : folderRoot;
      if (!fs.existsSync(target)) return [];
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const items = entries.map(e => {
        const abs = path.join(target, e.name);
        const isDir = e.isDirectory();
        const rel = norm ? `${norm}/${e.name}` : e.name;
        let size;
        if (e.isFile()) {
          try { size = fs.statSync(abs).size; } catch {}
        }
        return { name: e.name, isDirectory: isDir, size, path: rel };
      });
      items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      return items;
    },

    async readFile(filePath) {
      // Composite-path support — see _createZipSource.readFile for the
      // full rationale. Folder sources can contain inner zips too
      // (vendor.zip dropped inside a folder bundle), so the same resolver
      // applies; the leaf flat read is _readFlat (defined above).
      return await _resolveCompositeReadBytes({ readFile: _readFlat }, filePath);
    },

    // opts.link — hand back POINTERS instead of copies. Used when the destination
    // is a library entry, which is a set of names over the source's files rather
    // than a second copy of them. Export leaves it off: a folder the user carries
    // away has to be independent files. ([B-309])
    async extractTo(subPath, destDir, onProgress, opts) {
      // ⚠️⚠️ THIS CHECK USED TO BE THE WHOLE STORY AND IT WAS WORTHLESS - it ran ONCE, on the
      // way in, so pressing Cancel a second later did nothing until the entire tree had copied.
      // The real check is inside copyFolderRecursive's per-file callback below. Kept here only
      // as the cheap early-out for a cancel that beat us to the door. [B-005 item 4]
      if (opts && opts.shouldStop && opts.shouldStop()) throw new (require('./sfExportCopy').ExportCancelled)();
      const norm = _normalizeSubPath(subPath);
      const srcDir = norm ? path.join(folderRoot, norm) : folderRoot;
      if (!fs.existsSync(srcDir)) throw new Error(`Not found in source: ${norm}`);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      let fileCount = 0;
      let totalBytes = 0;
      const stat = fs.statSync(srcDir);
      if (stat.isFile()) {
        const destPath = path.join(destDir, path.basename(srcDir));
        let linked = false;
        if (opts && opts.link) { try { fs.linkSync(srcDir, destPath); linked = true; } catch {} }
        if (!linked) await fs.promises.copyFile(srcDir, destPath);
        fileCount = 1;
        totalBytes = stat.size;
        if (onProgress) onProgress({ fileCount, totalBytes, currentFile: path.basename(srcDir) });
        return { fileCount, totalBytes };
      }
      await copyFolderRecursive(srcDir, destDir, (srcFile) => {
        // ⚠️ THE PER-FILE CHECK LIVES HERE, not at the function entry where it started - see the
        // note up top. This callback fires once per file, which is exactly the granularity the
        // promise on the button ("finishing current file") claims. [B-005 item 4]
        if (opts && opts.shouldStop && opts.shouldStop()) throw new (require('./sfExportCopy').ExportCancelled)();
        fileCount++;
        try { totalBytes += fs.statSync(srcFile).size; } catch {}
        if (onProgress) onProgress({ fileCount, totalBytes, currentFile: path.relative(srcDir, srcFile) });
      }, opts);
      return { fileCount, totalBytes };
    },

    // Export the source. 'zip' (default) archives the folder tree into one tidy artifact;
    // 'folder' copies the tree as-is. Both stream real per-file progress. The freshly written
    // output keeps its natural "now" timestamp so it's findable in a date-sorted view.
    async exportToDownloads(destDir, { format = 'zip', onProgress, shouldStop = null, curationPayload = null } = {}) {
      if (!destDir) throw new Error('exportToDownloads requires destDir');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      // ⚠️ THE EXPORT IS NAMED FROM originalName, AND THAT IS DELIBERATE.
      // (Ryan, 2026-09-03: "I don't want the file name to be overritable by user.
      // just the name.") The Source Name (bundleName) is the label he can edit;
      // the FILE keeps the name it arrived under. A rename must not silently
      // change what a subsequent export is called.
      // ⚠️ I briefly changed this to prefer bundleName and backed it out - it made
      // the filename user-overridable by the back door, which is the one thing he
      // ruled out. The suffix-compounding it was meant to solve is already fixed
      // upstream: a restore now takes originalName from the sidecar, so the
      // artefact never enters the library to be re-emitted.
      const baseName = String(meta.originalName || uuid).replace(/\.zip$/i, '');
      const files = (await this.listAll()).filter(e => !e.isDir);
      const folders = _topFolders(files.map(e => ({ relPath: e.fileName })));
      const totalBytes = files.reduce((s, e) => s + (e.size || 0), 0);
      if (format === 'folder') {
        const destPath = _uniqueDestPath(destDir, baseName);
        const r = await this.extractTo('', destPath, (p) => onProgress && onProgress({
          phase: 'reconstruct', fileCount: p.fileCount, totalFiles: files.length,
          bytesDone: p.totalBytes, totalBytes, currentFile: p.currentFile,
        }), { shouldStop });
        // ⚠️ THE WAY OUT NEEDS THE SAME GUARD AS THE WAY IN ([B-214], 2026-09-10).
        // The ZIP branch below is already safe for free: it goes through
        // zipFolderToFile, which runs _selectFolderFiles and drops programs. This
        // branch is a RAW extractTo, so without this it wrote the source verbatim -
        // measured: a full-source folder export carried four planted programs onto
        // the Desktop untouched.
        // NOT a legacy concern (there is no released version to have legacy data).
        // The source store is a writable folder in AppData: a worm can drop a file
        // into it WITHOUT going through import, and this is the path that would then
        // copy it onto a saber card and hand it to the next person.
        const _purged = _purgeExecutables(destPath);
        // ⭐ THE SIDECAR GOES INTO THE TREE WE JUST WROTE. [B-420] Free here, and the reason this
        // branch never needed the unpack-and-repack the zip branch was doing: `writeIntoTree`'s own
        // comment says "just before it is archived", and a folder export has no archive step at all.
        // ⚠️ AFTER the purge, deliberately. The purge judges VENDOR content for planted programs;
        // the payload is store-internal - receipts we wrote ourselves and entry folders that already
        // passed the inbound blocklist on import - so it needs no second screening, and running it
        // through one would only risk the purge deleting our own sidecar.
        const _carried = curationPayload
          ? (() => {
              const cur = require('./soundFontCuration');
              const w = cur.writeIntoTree(destPath, curationPayload);
              return cur.summarize(curationPayload, w.attachmentsWritten, w.customizedWritten);
            })()
          : null;
        // ⚠️ REPORT WHAT LANDED, NOT WHAT WE SET OUT TO WRITE. extractTo counts
        // before the purge runs, so the summary claimed 91 files when 86 were on
        // disk (his catch, 2026-09-10: the numbers ARE the test here - before minus
        // removed equals after, and it did not).
        const _rawN = r.fileCount != null ? r.fileCount : files.length;
        const _rawB = r.totalBytes != null ? r.totalBytes : totalBytes;
        const _goneB = _purged.blocked.reduce((n, x) => n + (x.size || 0), 0);
        return { destPath, format: 'folder',
          fileCount: Math.max(0, _rawN - _purged.blocked.length),
          totalBytes: Math.max(0, _rawB - _goneB),
          folders, curation: _carried, blocked: _purged.blocked, noted: _purged.noted };
      }
      const destPath = _uniqueDestPath(destDir, `${baseName}.zip`);
      // ⭐⭐ THE SIDECAR IS STAGED AND APPENDED, NOT WRITTEN INTO THE SOURCE. [B-420]
      // `folderRoot` below is the POOLED STORE'S OWN FOLDER, so `writeIntoTree` must NOT run against
      // it the way the folder branch does - that would put our sidecar inside the user's stored
      // source, permanently, and every future export would carry a stale copy of it. Staging the
      // payload's few small files and handing them to zipFolderToFile as `extraEntries` keeps the
      // store untouched and still costs exactly ONE compression pass.
      // ⭐ NOTHING IS STAGED. `planForArchive` returns the sidecar as a JSON STRING and the payload
      // files as { name, absPath } pointing at where they already live, so there is no temp dir, no
      // copy, and no cleanup that a cancel could skip. The sidecar never becomes a file on disk at
      // all - archiver takes it as bytes.
      // ⚠️ THE FIRST CUT DID STAGE IT, and the cost was not theoretical: it copied a customized font
      // into a temp dir purely so archiver could read it straight back out, which is the same
      // write-then-read-it-again waste this change removed from the rest of the path.
      let _extra = [], _carried = null;
      if (curationPayload) {
        const cur = require('./soundFontCuration');
        const plan = cur.planForArchive(curationPayload);
        if (plan) {
          // ⚠️ THE SIDECAR BYPASSES _selectFolderFiles, WHICH IS WHY IT IS SAFE FROM THE NOISE FILTER.
          // Staging it meant the filter got a vote: _isNoisePath drops __MACOSX, .DS_Store, Thumbs.db,
          // desktop.ini and `._`-prefixed names, and '.jmt-curation.json' survived by starting '.j'
          // rather than '._' - one character. Appending it directly removes that dependency entirely.
          // The test still opens the finished zip, because "no sidecar" is a silent success otherwise.
          _extra = [{ name: '.jmt-curation.json', buffer: Buffer.from(plan.sidecarJson, 'utf8') },
                    ...plan.entries];
          _carried = cur.summarize(curationPayload, plan.attachmentsWritten, plan.customizedWritten);
        }
      }
      // zipFolderToFile runs _selectFolderFiles, so it already refused any program
      // and its counts describe the ARCHIVE. Report those rather than the source
      // listing, or the summary over-reports by exactly what it left out.
      const _zr = await zipFolderToFile(folderRoot, destPath, (p) => onProgress && onProgress({
        phase: 'compress', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes || totalBytes, currentFile: p.currentFile,
      }), { shouldStop, extraEntries: _extra });
      return { destPath, format: 'zip',
        fileCount: (_zr && _zr.fileCount != null) ? _zr.fileCount : files.length,
        totalBytes: (_zr && _zr.totalBytes != null) ? _zr.totalBytes : totalBytes,
        folders, curation: _carried,
        blocked: (_zr && _zr.blockedFiles) || [], noted: (_zr && _zr.notedFiles) || [] };
    },
  };
}

// List vendor-supplied files in a source that sit OUTSIDE the board-flavor
// folders — readmes, license, blade-style snippets, anything else the vendor
// shipped alongside the actual font data. The exclusion rules:
//   - Files inside any directory that resolves to a board name (Proffie,
//     Asteria, CFX, Verso, etc.) are extracted as part of the font, not
//     bundle-level docs.
//   - Files whose leaf basename (without extension) is a board name are the
//     board-flavor zip deliveries themselves (Proffie.zip, Asteria.zip);
//     they're how the font is distributed, not bundle-level docs.
//   - Audio files are font content by definition — not vendor docs — and are
//     excluded regardless of where they sit. Bundles often have bonus audio
//     in non-board subfolders (_Extras, Quotes, Music) which would otherwise
//     swamp the doc list.
// Returns an array of { fileName, size } sorted lexicographically.
const _SOURCE_AUDIO_EXTENSIONS = /\.(wav|raw|ogg|mp3|aiff?|flac)$/i;
async function listSourceDocs(userData, uuid) {
  const source = openSource(userData, uuid);
  if (!source) return [];
  const { identifyBoard } = require('./soundFontCandidates');
  const all = await source.listAll();
  const docs = [];
  for (const e of all) {
    if (e.isDir) continue;
    const parts = String(e.fileName).split('/').filter(Boolean);
    const leaf = parts[parts.length - 1] || '';
    const ancestors = parts.slice(0, -1);
    // Exclude files inside board-named folders.
    if (ancestors.some(a => identifyBoard(a))) continue;
    // Exclude board-flavor distribution files (Proffie.zip, etc.).
    const leafStem = leaf.replace(/\.[^.]+$/, '');
    if (identifyBoard(leafStem)) continue;
    // Exclude audio — font content, not vendor docs.
    if (_SOURCE_AUDIO_EXTENSIONS.test(leaf)) continue;
    docs.push({ fileName: e.fileName, size: e.size || 0 });
  }
  docs.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return docs;
}

// Read the raw bytes of a single non-board file from a source. Caller decides
// whether to decode as text or treat as binary (export). The path must point
// at a real file inside the source (no traversal); the underlying Source's
// readFile validates this.
async function readSourceFileBytes(userData, uuid, subPath) {
  const source = openSource(userData, uuid);
  if (!source) throw new Error('Source not found');
  return await source.readFile(subPath);
}

// Walk every entry in a source and return the same tree shape the entry
// and common-folder browsers consume — { name, isDir, path, size?, children? }
// — so the renderer can reuse the same node helpers and rendering. Folders
// sort before files at each depth; alphabetical within. Implicit folders
// (entries with embedded slashes but no own dir entry) are synthesized so
// every file has a navigable parent in the tree.
// Shared tree-builder: takes a flat list of { fileName, isDir, size } entries
// (the shape exposed by source.listAll and by the node-stream-zip entry map
// after light reshaping) and returns a tree of { name, isDir, path, size?,
// children? } nodes. Folders sort before files at each depth, alphabetical
// natural-numeric within. Implicit folders (entries with embedded slashes but
// no own dir entry) get synthesized so every file has a navigable parent.
// Path field on each node is relative to the tree's root — for inner-zip
// trees that means relative to the INNER zip's root, not the outer source.
function _buildFileTreeFromEntries(entries) {
  const root = [];
  const dirNodes = new Map(); // 'a/b' → node
  const ensureDir = (relPath) => {
    if (!relPath) return null;
    if (dirNodes.has(relPath)) return dirNodes.get(relPath);
    const parts = relPath.split('/');
    const name = parts.pop();
    const parentRel = parts.join('/');
    const parentChildren = parentRel ? ensureDir(parentRel).children : root;
    const node = { name, isDir: true, path: relPath, children: [] };
    dirNodes.set(relPath, node);
    parentChildren.push(node);
    return node;
  };
  for (const e of entries) {
    const clean = String(e.fileName).replace(/\\/g, '/').replace(/\/+$/g, '');
    if (!clean) continue;
    if (e.isDir) { ensureDir(clean); continue; }
    const parts = clean.split('/');
    const name = parts.pop();
    const parentRel = parts.join('/');
    const parentChildren = parentRel ? ensureDir(parentRel).children : root;
    parentChildren.push({ name, isDir: false, path: clean, size: e.size || 0 });
  }
  const sortRec = (arr) => {
    arr.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      // Natural sort for files inside the source archive view.
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    for (const n of arr) if (n.isDir && n.children) sortRec(n.children);
  };
  sortRec(root);
  return root;
}

async function listSourceFiles(userData, uuid) {
  const source = openSource(userData, uuid);
  if (!source) return [];
  const all = await source.listAll();
  return _buildFileTreeFromEntries(all);
}

// Inner-zip descent for the file browser. Opens an inner zip embedded in the
// outer source archive and returns its tree in the same shape listSourceFiles
// uses, so the renderer can splice the result under the inner-zip node and
// keep navigating naturally. innerZipPath is relative to the outer source
// (e.g. "Indara.zip" for a top-level inner zip, "subdir/Indara.zip" for a
// nested one). Paths in the returned tree are relative to the INNER zip's
// root. The inner zip is materialized to a temp file because node-stream-zip
// only opens files, not buffers; temp dir is cleaned up before return. No
// caching today — every descent re-extracts. The eventual per-session cache
// for detectSourceCandidates can fold this in.
async function listSourceInnerZipFiles(userData, uuid, innerZipPath) {
  const source = openSource(userData, uuid);
  if (!source) return [];
  if (!innerZipPath) throw new Error('innerZipPath required');
  const bytes = await source.readFile(innerZipPath);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-sf-browse-'));
  const tmpZip = path.join(tmpDir, 'inner.zip');
  try {
    fs.writeFileSync(tmpZip, bytes);
    const zip = new StreamZip.async({ file: tmpZip, skipEntryNameValidation: true });
    try {
      const entryMap = await zip.entries();
      const entries = [];
      for (const k of Object.keys(entryMap)) {
        const e = entryMap[k];
        if (!e.name || e.name === '/') continue;
        entries.push({ fileName: e.name, isDir: !!e.isDirectory, size: e.size || 0 });
      }
      return _buildFileTreeFromEntries(entries);
    } finally {
      await zip.close();
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// Extract a single file from a source into destDir, preserving the source's
// basename, collision-safe via Proffie-style variant naming (so dragging
// boot01.wav into a dest of boot01/02 lands as boot03). Returns the final
// on-disk subPath relative to destRoot — used by copy-from-source so the
// caller can mirror the same "added" array the regular copy returns.
async function extractSourceFileTo(userData, uuid, subPath, destDir, finalName) {
  const source = openSource(userData, uuid);
  if (!source) throw new Error('Source not found');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const buf = await source.readFile(subPath);
  const destPath = path.join(destDir, finalName);
  await fs.promises.writeFile(destPath, buf);
  return { destPath };
}

// Copy a single source-supplied file to destDir, collision-safe. Used when
// the user asks to save a non-text doc out for opening in their OS.
async function exportSourceFileTo(userData, uuid, subPath, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const buf = await readSourceFileBytes(userData, uuid, subPath);
  // ⚠️ THE PER-FILE DOOR IS A DOOR ([B-214], his catch 2026-09-10). The whole-source
  // export refuses programs, so this one-file-at-a-time route out of the SAME store
  // has to as well - otherwise right-click > Export on the one file that matters
  // walks past every guard we built. Free here: the bytes are already in hand.
  {
    // checkCarryable, not the executable test ([B-370] sweep): this is an EXPORT door,
    // so it owes the same answer as every other one - archives and macro documents
    // do not leave either.
    const { checkCarryable } = require('./sdCardDetect');
    const v = checkCarryable(buf.subarray(0, 256), subPath);
    if (v.blocked) return { refused: true, reason: v.reason, relPath: String(subPath) };
  }
  const baseName = String(subPath).split('/').pop() || `source-${uuid}.bin`;
  const destPath = _uniqueDestPath(destDir, baseName);
  await fs.promises.writeFile(destPath, buf);
  return { destPath };
}

function openSource(userData, uuid) {
  const uuidDir = path.join(sourcesRoot(userData), uuid);
  const meta = readSourceMeta(uuidDir);
  if (!meta) return null;
  // ⚠️⚠️ ONE FORMAT, AND THAT IS THE WHOLE POINT OF [B-428]. This used to branch three ways -
  // `zip` to `_createZipSource`, `folder` to `_createFolderSource`, then optionally wrap the
  // result in `_virtualizeSource` for a deduped archive. Two of those three were unreachable:
  // the store is an unpacked pool, so no source has ever had `format: 'zip'`, and the virtual
  // view required `format !== 'folder'` as well as `meta.deduped`.
  //
  // ⭐ THEY WERE DELETED RATHER THAN COMMENTED, because reading them was actively misleading.
  // His words, after correcting me on it repeatedly in one week: *"No, Cody, that's also wrong,
  // and I've had to correct you on this a lot over the last week."* Dead code that reads as live
  // is not neutral - it is a source of confident wrong answers, and it made editing the live
  // `exportToDownloads` unsafe because the signature matched three identical copies.
  //
  // ⚠️ NO MIGRATION OBLIGATION: *"there's also not even any legacy zip at all. Because we don't
  // have a legacy library, we only have a test library, so it's irrelevant."*
  if (meta.format === 'folder') return _createFolderSource({ uuid, uuidDir, meta });
  throw new Error(`Unknown source format: ${meta.format}`);
}

// ── Persistent content hash (backup-side) ────────────────
// Sources are effectively immutable once imported — there's no in-app
// edit path that mutates the on-disk source.zip / source/ tree. So the
// hashItemDir result for a given source dir is stable across the source's
// lifetime, and stamping it onto meta.json once means every subsequent
// export reads it back instead of re-hashing multi-GB voicepacks. Mirrors
// the entries/common helpers (see soundFontEntries.recomputeEntryContentHash)
// so the surveyMerge + exportBackup paths can route all three buckets
// through the same shape.
//
// NB: source meta also has a `hash` field set at import time — that's the
// IDENTITY hash (zip bytes or canonical folder walk) used for import-dedup.
// That's a different shape from hashItemDir (which hashes the on-disk
// uuid dir contents including meta.json) and would NOT match what the
// restore side checks against. Keep them separate.
function _walkSourceContentSignals(sourceDir) {
  let fileCount = 0;
  let totalBytes = 0;
  const walk = (absDir, relBase) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (!relBase && e.name === 'meta.json') continue;
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        walk(abs, relBase ? `${relBase}/${e.name}` : e.name);
      } else if (e.isFile()) {
        fileCount++;
        try { totalBytes += fs.statSync(abs).size; } catch {}
      }
    }
  };
  walk(sourceDir, '');
  return { fileCount, totalBytes };
}

function recomputeSourceContentHash(userData, uuid) {
  if (!uuid) return null;
  const sourceDir = path.join(sourcesRoot(userData), uuid);
  const metaPath = path.join(sourceDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  const { hashItemDir } = require('./soundFontFileHash');
  const h = hashItemDir(sourceDir);
  if (!h) return null;
  const { fileCount, totalBytes } = _walkSourceContentSignals(sourceDir);
  meta.contentHash = h;
  meta.contentFileCount = fileCount;
  meta.contentTotalBytes = totalBytes;
  meta.contentHashedAt = new Date().toISOString();
  meta.contentHashDirty = false;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
  return h;
}

// ── Persistent candidate cache ────────────────────────
// Detection of candidates inside a source is deterministic — same source
// bytes always produce the same result — so there's no reason to recompute
// across sessions. Stamp the result onto source meta the first time we
// compute it; every subsequent call reads from meta. Survives backups
// because meta is in the backup; survives restores because it's still in
// meta after the restore unpacks. Pay the cost once per source, ever.
//
// Schema version on the cached blob lets us invalidate when detection
// logic changes meaningfully (the nested-zip refactor 2026-06-26 was such
// a change — it bumped the version to 2, so any candidates stamped under
// v1 will get re-detected on next read).
async function getCachedCandidates(userData, uuid) {
  if (!uuid) return null;
  const sourceDir = path.join(sourcesRoot(userData), uuid);
  const meta = readSourceMeta(sourceDir);
  if (!meta) return null;
  const candidatesMod = require('./soundFontCandidates');
  const currentSchema = candidatesMod.CANDIDATES_SCHEMA_VERSION;
  const cachedSchema = Number(meta.candidatesSchemaVersion) || 0;
  if (cachedSchema === currentSchema
      && Array.isArray(meta.candidates)) {
    // Fresh cache hit. Return in the same shape detectCandidates returns
    // so the IPC handler can spread it directly into the response.
    return {
      candidates: meta.candidates,
      bundleName: meta.candidatesBundleName || null,
      bundlePrefix: meta.candidatesBundlePrefix || null,
    };
  }
  // Cache miss or stale schema — recompute and stamp.
  return await recomputeAndStampCandidates(userData, uuid);
}

async function recomputeAndStampCandidates(userData, uuid) {
  if (!uuid) return null;
  const source = openSource(userData, uuid);
  if (!source) return null;
  const candidatesMod = require('./soundFontCandidates');
  const result = await candidatesMod.detectCandidates(source);
  // Best-effort stamp — a stamp failure shouldn't break the call; we just
  // pay re-detection on the next read until the next successful stamp.
  try {
    const sourceDir = path.join(sourcesRoot(userData), uuid);
    const meta = readSourceMeta(sourceDir);
    if (meta) {
      meta.candidates = result.candidates || [];
      meta.candidatesBundleName = result.bundleName || null;
      meta.candidatesBundlePrefix = result.bundlePrefix || null;
      meta.candidatesSchemaVersion = candidatesMod.CANDIDATES_SCHEMA_VERSION;
      meta.candidatesComputedAt = new Date().toISOString();
      fs.writeFileSync(path.join(sourceDir, 'meta.json'), JSON.stringify(meta, null, 2));
    }
  } catch {}
  return result;
}

function markSourceContentDirty(userData, uuid) {
  if (!uuid) return;
  const metaPath = path.join(sourcesRoot(userData), uuid, 'meta.json');
  if (!fs.existsSync(metaPath)) return;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return; }
  if (meta.contentHashDirty) return;
  meta.contentHashDirty = true;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
}

function resolveSourceContentDirty(userData, uuid) {
  if (!uuid) return null;
  const metaPath = path.join(sourcesRoot(userData), uuid, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.contentHashDirty) return null;
  return recomputeSourceContentHash(userData, uuid);
}

function getSourceContentHash(userData, uuid) {
  if (!uuid) return null;
  const sourceDir = path.join(sourcesRoot(userData), uuid);
  const metaPath = path.join(sourceDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.contentHashDirty
      && meta.contentHash
      && typeof meta.contentFileCount === 'number'
      && typeof meta.contentTotalBytes === 'number') {
    const live = _walkSourceContentSignals(sourceDir);
    if (live.fileCount === meta.contentFileCount && live.totalBytes === meta.contentTotalBytes) {
      return meta.contentHash;
    }
  }
  return recomputeSourceContentHash(userData, uuid);
}

// Open a Source-like reader over an arbitrary folder or .zip path that has
// NOT been imported into the library. Returns the same read interface the
// vendor/candidate detectors expect ({ meta, format, listAll, readFile,
// browse }) so guided-import enrichment can detect vendor and peek at files
// in place, before the user commits to importing anything. No hashing, no
// copy, no userData. Read-only.
function openSourceAtPath(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return null;
  let stat;
  try { stat = fs.statSync(absPath); } catch { return null; }
  const originalName = path.basename(absPath);
  const meta = { originalName };

  if (stat.isFile() && /\.zip$/i.test(absPath)) {
    async function _readFlat(filePath) {
      const norm = _normalizeSubPath(filePath);
      if (!norm) throw new Error('readFile requires a path');
      const zip = _openZip(absPath);
      try {
        const entries = await _readAllZipEntries(zip);
        const match = entries.find(e => e.fileName === norm);
        if (!match) throw new Error(`Not found in source: ${norm}`);
        return await _readZipEntryToBuffer(zip, match);
      } finally {
        await zip.close();
      }
    }
    return {
      meta,
      format: 'zip',
      async listAll() {
        const zip = _openZip(absPath);
        try { return await _readAllZipEntries(zip); }
        finally { await zip.close(); }
      },
      async browse(subPath) {
        const zip = _openZip(absPath);
        try {
          const entries = await _readAllZipEntries(zip);
          return _listAtPath(entries, _normalizeSubPath(subPath));
        } finally { await zip.close(); }
      },
      async readFile(filePath) {
        return await _resolveCompositeReadBytes({ readFile: _readFlat }, filePath);
      },
    };
  }

  if (stat.isDirectory()) {
    const folderRoot = absPath;
    async function _readFlat(filePath) {
      const norm = _normalizeSubPath(filePath);
      if (!norm) throw new Error('readFile requires a path');
      const abs = path.join(folderRoot, norm);
      if (!fs.existsSync(abs)) throw new Error(`Not found in source: ${norm}`);
      return await fs.promises.readFile(abs);
    }
    return {
      meta,
      format: 'folder',
      async listAll() {
        const out = [];
        const walk = (dir, relBase) => {
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
          catch { return; }
          for (const e of entries) {
            const abs = path.join(dir, e.name);
            const rel = relBase ? `${relBase}/${e.name}` : e.name;
            if (e.isDirectory()) { out.push({ fileName: `${rel}/`, size: 0, isDir: true }); walk(abs, rel); }
            else if (e.isFile()) {
              let size = 0;
              try { size = fs.statSync(abs).size; } catch {}
              out.push({ fileName: rel, size, isDir: false });
            }
          }
        };
        walk(folderRoot, '');
        return out;
      },
      async browse(subPath) {
        const norm = _normalizeSubPath(subPath);
        const target = norm ? path.join(folderRoot, norm) : folderRoot;
        if (!fs.existsSync(target)) return [];
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const items = entries.map(e => {
          const abs = path.join(target, e.name);
          const isDir = e.isDirectory();
          const rel = norm ? `${norm}/${e.name}` : e.name;
          let size;
          if (e.isFile()) { try { size = fs.statSync(abs).size; } catch {} }
          return { name: e.name, isDirectory: isDir, size, path: rel };
        });
        items.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        });
        return items;
      },
      async readFile(filePath) {
        return await _resolveCompositeReadBytes({ readFile: _readFlat }, filePath);
      },
    };
  }

  return null;
}

// ── Per-file source manifest (static provenance) ───────────────────────────
// Central per-file manifest path (mirrors the entries helper in soundFontEntries;
// kept here too so sources manage their own manifests without a cross-require).
function fileHashManifestPath(userData, kind, uuid) {
  return path.join(userData, 'soundFonts', '.filehashes', kind, `${uuid}.json`);
}

// Build (once) the STATIC comprehensive per-file manifest for a source: EVERY file in
// the source — extras, tracks, all variants, non-Proffie content — keyed by its path
// within the source. Frozen: the source is immutable, so if the manifest already exists
// we skip and never recompute. Async + ONE-OPEN (the zip is opened a single time and
// every entry is read from that handle, never re-opened per file) + yielding, so it can
// run deferred after import without freezing the UI. Returns { records, contentHash } or
// null. NOTE: an inner .zip nested inside the source is hashed as one blob — its contents
// are not recursed into yet; a follow-on if any bundles nest zips with variants inside.
async function ensureSourceManifest(userData, sourceUuid, onProgress) {
  if (!userData || !sourceUuid) return null;
  const fh = require('./soundFontFileHash');
  const crypto = require('crypto');
  const outPath = fileHashManifestPath(userData, 'sources', sourceUuid);
  const existing = fh.readFileHashManifest(outPath);
  if (existing) return existing; // static — computed once, never recomputed

  const uuidDir = path.join(sourcesRoot(userData), sourceUuid);
  const meta = readSourceMeta(uuidDir);
  if (!meta) return null;

  // Twin seeding: a source whose archive hash matches another source that
  // already has a manifest is byte-identical — same relPaths, same file hashes
  // (dedup keeps the ORIGINAL fat hash on meta, and manifests always describe
  // the full original tree). Copy the twin's records instead of re-reading the
  // whole archive: "import again as a new source" re-imports catalog instantly.
  if (meta.hash) {
    try {
      const rootDir = sourcesRoot(userData);
      for (const d of fs.readdirSync(rootDir)) {
        if (d === sourceUuid) continue;
        let m2 = null;
        try { m2 = JSON.parse(fs.readFileSync(path.join(rootDir, d, 'meta.json'), 'utf8')); } catch { continue; }
        if (!m2 || m2.hash !== meta.hash) continue;
        const twin = fh.readFileHashManifest(fileHashManifestPath(userData, 'sources', d));
        if (twin && Array.isArray(twin.records) && twin.records.length) {
          fh.writeFileHashManifest(outPath, twin.records, twin.contentHash, twin.hashedAt);
          return { records: twin.records, contentHash: twin.contentHash };
        }
      }
    } catch {}
  }

  const keep = (rel) => rel && rel !== 'meta.json' && !_isNoisePath(rel);
  const records = [];
  const pushHash = (rel, size, buf) => records.push({
    relPath: rel, size: (size != null ? size : buf.length),
    fileHash: crypto.createHash('sha256').update(buf).digest('hex'),
  });

  try {
    if (meta.format === 'zip') {
      // One open; recurse into inner zips so their leaves are hashed too (a font
      // shipped inside Proffie.zip must be knowable to library dedup/compare).
      const zip = _openZip(path.join(uuidDir, 'source.zip'));
      try {
        // Byte-driven 'catalog' progress: total from the outer entry table (inner-zip
        // leaves tick the name only — their bytes are counted once at the blob read).
        let totalBytes = 0, bytesDone = 0, fileCount = 0;
        if (onProgress) {
          for (const e of await _readAllZipEntries(zip)) {
            if (e.isDir) continue;
            if (/\.zip$/i.test(e.fileName) || keep(e.fileName)) totalBytes += (e.size || 0);
          }
        }
        const onRead = onProgress ? (rel, n) => {
          bytesDone += n; fileCount++;
          onProgress({ phase: 'catalog', bytesDone, totalBytes, fileCount, currentFile: rel });
        } : undefined;
        await _collectZipLeaves(zip, '', keep, (rel, size, buf) => pushHash(rel, size, buf), onRead);
      } finally { await zip.close(); }
    } else if (meta.format === 'folder') {
      // Folder readFile is a cheap fs read (no re-open cost), so the abstraction is fine.
      const source = openSource(userData, sourceUuid);
      if (!source) return null;
      const entries = await source.listAll();
      let totalBytes = 0, bytesDone = 0, fileCount = 0;
      if (onProgress) for (const e of entries) { if (!e.isDir && keep(e.fileName)) totalBytes += (e.size || 0); }
      for (const e of entries) {
        if (e.isDir || !keep(e.fileName)) continue;
        let buf; try { buf = await source.readFile(e.fileName); } catch { continue; }
        pushHash(e.fileName, e.size, buf);
        if (onProgress) {
          bytesDone += (e.size != null ? e.size : buf.length); fileCount++;
          onProgress({ phase: 'catalog', bytesDone, totalBytes, fileCount, currentFile: e.fileName });
        }
      }
    } else {
      return null;
    }
  } catch { return null; }

  records.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  const aggregate = fh.hashRecords(records);
  fh.writeFileHashManifest(outPath, records, aggregate);
  return { records, contentHash: aggregate };
}

// Drop a source's manifest (called on source delete — the store is keyed by uuid and
// lives outside the source folder, so removing the folder doesn't touch it).
function removeSourceManifest(userData, sourceUuid) {
  try { fs.rmSync(fileHashManifestPath(userData, 'sources', sourceUuid), { force: true }); } catch {}
}

// Load a deduped source's breadcrumb (its FULL original per-file tree). Prefers the durable
// in-source copy that dedup writes (§13.1 — it travels with the source and is load-bearing),
// falling back to the central manifest.
function _loadSourceBreadcrumb(userData, uuid, uuidDir) {
  const fh = require('./soundFontFileHash');
  return fh.readFileHashManifest(path.join(uuidDir, '.jmt-source-manifest.json'))
    || fh.readFileHashManifest(fileHashManifestPath(userData, 'sources', uuid));
}



// Alternate-board folder names to DEPRIORITIZE when choosing which copy of a duplicated file
// to keep as canonical — the Proffie / plain copy wins, so the deduped archive stays
// Proffie-shaped and the board formats are the ones reconstructed. Proffie is NOT in this set.
const _ALT_BOARD_RX = /^(cfx|verso|xeno|nec|nova|cfx-?ghv?\d*|golden.?harvest|goldenharvest|ghv?\d*|crystal.?focus)$/i;
function _canonScore(relPath) {
  return relPath.split('/').filter(s => _ALT_BOARD_RX.test(s)).length; // 0 = Proffie/plain = preferred
}
function _pickCanonical(paths) {
  return [...paths].sort((a, b) => {
    const sa = _canonScore(a), sb = _canonScore(b);
    if (sa !== sb) return sa - sb;                 // fewest alt-board segments wins (Proffie)
    if (a.length !== b.length) return a.length - b.length; // then shorter path
    return a < b ? -1 : 1;                         // then stable alphabetical
  })[0];
}


// §13 for a source stored as a TREE rather than an archive. Same rule as the zip path — one
// canonical copy per unique file, Proffie preferred, verify before commit — realised in the
// filesystem instead of in a manifest.
//
// ⭐ THE DUPLICATES BECOME HARDLINKS, AND THAT IS WHY THIS IS SMALLER THAN THE ZIP PATH.
// A trimmed archive has to record what it removed and reconstruct those paths on every read,
// which is what the breadcrumb and _virtualizeSource exist for. A hardlinked tree removes
// nothing: every original path is still a real file that opens, reads and copies normally, and
// an export still zips the complete bundle. The sharing is a filesystem fact, so nothing
// downstream has to know it happened.
//
// ⚠️ SAFE BECAUSE SOURCES ARE IMMUTABLE. Writing through one link would change every path that
// shares the file. Nothing writes into a stored source — entries are extracted copies — so the
// aliasing has no way to surprise anyone. That invariant is the precondition for this whole
// approach, not a footnote to it.
//
// VERIFY BEFORE COMMIT, per file rather than per archive: the duplicate's bytes are confirmed
// to match the canonical's recorded hash BEFORE it is replaced, and the link is created under a
// temp name and renamed over the original, so an interruption leaves either the original file
// or the finished link and never a hole.
async function _dedupeFolderSource(userData, uuid, uuidDir, meta, onProgress) {
  const fh = require('./soundFontFileHash');
  const crypto = require('crypto');
  const root = path.join(uuidDir, 'source');
  if (!fs.existsSync(root)) return { deduped: false, reason: 'no-tree' };

  let bc = fh.readFileHashManifest(fileHashManifestPath(userData, 'sources', uuid));
  if (!bc || !Array.isArray(bc.records)) bc = await ensureSourceManifest(userData, uuid, onProgress);
  if (!bc || !Array.isArray(bc.records)) return { deduped: false, reason: 'no-breadcrumb' };
  // Composite paths live inside an inner archive, which this cannot link. They are left
  // exactly as they are rather than failing the source.
  const records = bc.records.filter(r => r.fileHash !== '<empty>' && !_isCompositePath(r.relPath));
  if (!records.length) return { deduped: false, reason: 'no-records' };

  const byHash = new Map();
  for (const r of records) {
    if (!byHash.has(r.fileHash)) byHash.set(r.fileHash, []);
    byHash.get(r.fileHash).push(r.relPath);
  }
  if (byHash.size === records.length) return { deduped: false, reason: 'no-duplicates' };

  const hashOf = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  const byRel = new Map(records.map(r => [r.relPath, r.fileHash]));
  // Every path this pass writes or points at, so the post-check can speak only about
  // its own work.
  const touched = new Set();
  let linked = 0, savedBytes = 0, skipped = 0;
  const total = records.length - byHash.size;
  let done = 0;

  for (const [h, paths] of byHash) {
    if (paths.length < 2) continue;
    const canonRel = _pickCanonical(paths);
    const canonAbs = path.join(root, canonRel);
    if (!fs.existsSync(canonAbs)) { skipped += paths.length - 1; continue; }
    // The canonical must still be what the manifest says before anything is pointed at it.
    let canonOk = false;
    try { canonOk = hashOf(canonAbs) === h; } catch {}
    if (!canonOk) { skipped += paths.length - 1; continue; }
    touched.add(canonRel);

    for (const rel of paths) {
      if (rel === canonRel) continue;
      const abs = path.join(root, rel);
      done++;
      if (onProgress) onProgress({ phase: 'dedupe', fileCount: done, totalFiles: total, currentFile: rel });
      let st;
      try { st = fs.statSync(abs); } catch { skipped++; continue; }
      // ⚠️ IDEMPOTENCE IS "DOES THIS ALREADY POINT AT ITS CANONICAL", NOT "IS THIS
      // SHARED WITH ANYTHING". The first version skipped any file with nlink > 1,
      // which is wrong the moment anything else can hold a name: library entries are
      // created BEFORE optimize runs, so a source file a font points at already has
      // nlink 2 and was walked straight past. Measured on a real bundle — 3,132
      // duplicates found, only 2,329 linked, 803 skipped SILENTLY because this
      // branch does not even count them. Comparing inodes asks the question we
      // actually mean.
      let canonSt;
      try { canonSt = fs.statSync(canonAbs); } catch { skipped++; continue; }
      if (st.ino === canonSt.ino && st.dev === canonSt.dev) continue;
      // The duplicate must be what the manifest claims before it is thrown away.
      try { if (hashOf(abs) !== h) { skipped++; continue; } } catch { skipped++; continue; }
      const tmp = abs + '.dedup-tmp';
      try {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        fs.linkSync(canonAbs, tmp);
        fs.renameSync(tmp, abs);
        touched.add(rel);
        linked++;
        savedBytes += st.size;
      } catch (e) {
        // A filesystem that will not hardlink is a reason to leave the source whole,
        // never a reason to lose a file.
        try { fs.rmSync(tmp, { force: true }); } catch {}
        skipped++;
      }
    }
  }

  if (!linked) return { deduped: false, reason: skipped ? 'not-linkable' : 'no-duplicates' };

  // Post-check across THE PATHS THIS PASS TOUCHED, and only those.
  // ⚠️ It verified the whole tree at first, and a test tampering with one duplicate behind
  // the manifest's back exposed why that is wrong: dedup correctly REFUSED to link over the
  // altered file, and was then reported as verify-failed for damage it had declined to touch.
  // A pre-existing mismatch is a real finding, but it belongs to the source, not to this pass
  // — blaming it here would make the honest refusal look like the failure.
  let verified = 0;
  for (const rel of touched) {
    const rec = byRel.get(rel);
    const abs = path.join(root, rel);
    try { if (rec && hashOf(abs) === rec) verified++; } catch {}
  }
  if (verified !== touched.size) {
    return { deduped: false, reason: `verify-failed (${verified}/${touched.size})` };
  }

  try {
    updateSourceMeta(userData, uuid, { deduped: true, dedupStats: {
      originalFiles: records.length, uniqueFiles: byHash.size,
      linkedFiles: linked, savedBytes,
    } });
  } catch {}
  return { deduped: true, originalFiles: records.length, uniqueFiles: byHash.size,
    linkedFiles: linked, savedBytes, skipped };
}

// Trim intra-source duplicate files (§13): rewrite the archive keeping ONE canonical copy per
// unique file (Proffie-folder preferred), leaving a durable breadcrumb so every trimmed path
// reconstructs on demand. SAFETY: verify-before-commit — the slim archive is built to a temp
// file and EVERY original path is proven to reconstruct to its recorded hash BEFORE the fat
// archive is swapped out; on any failure the original is left untouched. Idempotent. ZIP only
// (folder sources: a later step). Returns { deduped, originalFiles, uniqueFiles, savedBytes }
// or { deduped:false, reason }.
async function dedupeSource(userData, uuid, onProgress) {
  const uuidDir = path.join(sourcesRoot(userData), uuid);
  const meta = readSourceMeta(uuidDir);
  if (!meta) return { deduped: false, reason: 'no-meta' };
  if (meta.deduped) return { deduped: false, reason: 'already' };
  if (meta.format === 'folder') {
    return await _dedupeFolderSource(userData, uuid, uuidDir, meta, onProgress);
  }
  // ⚠️ EVERYTHING BELOW THIS LINE USED TO BE THE ZIP DEDUPE - 105 lines of it, plus
  // `_dedupeInnerZipSource`, `_createZipSource`, `_virtualizeSource` and
  // `_extractCanonicalsToDisk`. All of it sat behind `meta.format === 'zip'`, and no source has
  // ever had that format. Removed by [B-428], 2026-09-24.
  // ⭐ The reason `not-zip` survives as a REASON STRING rather than being renamed: callers read
  // it, and a folder source that is already deduped returns `already` above, so this is the
  // honest answer for anything else - there is nothing here to dedupe.
  return { deduped: false, reason: 'not-zip' };
}

module.exports = {
  sourcesRoot,
  ensureSourcesRoot,
  ensureSourceManifest,
  removeSourceManifest,
  dedupeSource,
  isNoisePath: _isNoisePath,
  zipFolderToFile,
  walkFolderSorted,
  // exported for testing — lets a harness time the REAL selection walk rather
  // than a reimplementation of it ([B-361] cost measurement, 2026-09-09).
  _selectFolderFiles,
  openSourceAtPath,
  hashZipFile,
  hashFolder,
  listSources,
  cleanupOrphanSources,
  clearStagedSources,
  findByHash,
  importSource,
  finalizePreparedSource,
  discardPreparedSource,
  openSource,
  deleteSource,
  updateSourceMeta,
  readSourceMeta,
  listSourceDocs,
  readSourceFileBytes,
  exportSourceFileTo,
  listSourceFiles,
  listSourceInnerZipFiles,
  getCachedCandidates,
  recomputeAndStampCandidates,
  extractSourceFileTo,
  recomputeSourceContentHash,
  getSourceContentHash,
  markSourceContentDirty,
  resolveSourceContentDirty,
};
