// Sound Font library backup — exports the entire SF library tree under
// userData/soundFonts/ into a single .jmt-soundfontlibrary.zip with a
// manifest.json at the root so the file is self-identifying and a future
// import can validate before extracting.
//
// Layout inside the zip:
//   manifest.json
//   sources/<uuid>/...     — raw source archives + per-source meta.json
//   entries/<name>/...     — extracted font folders + per-entry meta.json
//   common/<uuid>/...      — common folder roots + per-common meta.json
//
// Library-state settings (currently just the starred-common uuid) are
// embedded in manifest.json so an empty-install restore lands at the exact
// prior visual state.

const fs = require('fs');
const path = require('path');
const soundFontEntries = require('./soundFontEntries');

const SCHEMA_VERSION = 1;
const BACKUP_TYPE = 'jmt-soundfontlibrary';

// Side-effect call into soundFontEntries: its _readEntryMeta backfills
// entryUuid into any legacy meta.json that doesn't have one. Running
// listEntries here means the backup's downstream disk reads (export
// hashing + archive writes + merge classification) all see meta with
// the uuid persisted, instead of a half-populated mid-flight state.
function _ensureLibraryBackfill(userData) {
  try { soundFontEntries.listEntries(userData); } catch {}
}

// Path helpers — match the layout the rest of the SF modules use so this
// stays the single source of truth for "what does the library look like
// on disk."
function _soundFontsRoot(userData) {
  return path.join(userData, 'soundFonts');
}
function _sourcesRoot(userData) {
  return path.join(_soundFontsRoot(userData), 'sources');
}
function _entriesRoot(userData) {
  // On-disk directory is "library" (legacy naming from when the module
  // landed). User-facing copy still says "fonts" — this is the only place
  // the disk name leaks into the backup layout.
  return path.join(_soundFontsRoot(userData), 'library');
}
function _commonRoot(userData) {
  return path.join(_soundFontsRoot(userData), 'common');
}

// Recursive byte sum for a directory tree. Used both for the manifest's
// total-bytes field and for the export progress accounting (we tick bytes
// after each file lands in the archive). Silent on per-file errors so a
// transient permissions blip doesn't abort the whole survey.
function _dirBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;
  const walk = (cur) => {
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        try { total += fs.statSync(abs).size; } catch {}
      }
    }
  };
  walk(dir);
  return total;
}

// Survey what's in the library — count + size per bucket. Bucket keys
// match the on-disk directory names ('sources', 'library', 'common',
// 'sharedTracks') so the archive layout, manifest counts, and restore
// code all use the same vocabulary. Renderer translates 'library' to
// "fonts" for display. sharedTracks is a flat singleton folder (counts
// = number of .wav files, not subdirs).
function surveyLibrary(userData) {
  const buckets = ['sources', 'library', 'common'];
  const counts = { sources: 0, library: 0, common: 0, sharedTracks: 0 };
  const totals = { sources: 0, library: 0, common: 0, sharedTracks: 0 };
  for (const b of buckets) {
    const root = path.join(_soundFontsRoot(userData), b);
    if (!fs.existsSync(root)) continue;
    let names;
    try { names = fs.readdirSync(root, { withFileTypes: true }); }
    catch { continue; }
    const dirs = names.filter(d => d.isDirectory());
    counts[b] = dirs.length;
    for (const d of dirs) totals[b] += _dirBytes(path.join(root, d.name));
  }
  // sharedTracks — flat folder, count .wav files at top level only.
  const stRoot = path.join(_soundFontsRoot(userData), 'sharedTracks');
  if (fs.existsSync(stRoot)) {
    let stEntries;
    try { stEntries = fs.readdirSync(stRoot, { withFileTypes: true }); }
    catch { stEntries = []; }
    for (const e of stEntries) {
      if (!e.isFile()) continue;
      if (!/\.wav$/i.test(e.name)) continue;
      counts.sharedTracks++;
      try { totals.sharedTracks += fs.statSync(path.join(stRoot, e.name)).size; } catch {}
    }
  }
  const totalBytes = totals.sources + totals.library + totals.common + totals.sharedTracks;
  return { counts, totals, totalBytes };
}

// Throughput benchmark for the destination path. Writes a small temp file
// next to the eventual zip and measures wall-clock to derive an MB/s rate.
// 16 MB is large enough to swamp filesystem cache noise on a typical SSD
// without being heavy enough to feel like work to the user. Falls back to
// a conservative 30 MB/s if the benchmark fails outright.
async function benchmarkDestination(destDirOrFile) {
  // The proposed zip path won't exist yet (we benchmark BEFORE writing) —
  // fall through to the parent dir in that case. Real directories are
  // used directly; everything else also falls back to the parent.
  let destDir;
  try {
    const st = fs.statSync(destDirOrFile);
    destDir = st.isDirectory() ? destDirOrFile : path.dirname(destDirOrFile);
  } catch {
    destDir = path.dirname(destDirOrFile);
  }
  const tmpPath = path.join(destDir, `.jmt-bench-${Date.now()}.tmp`);
  const SIZE = 16 * 1024 * 1024;
  const buf = Buffer.alloc(SIZE, 0xAA);
  let mbps = 30;
  try {
    const start = Date.now();
    await fs.promises.writeFile(tmpPath, buf);
    const elapsedMs = Math.max(1, Date.now() - start);
    mbps = (SIZE / (1024 * 1024)) / (elapsedMs / 1000);
  } catch {}
  try { await fs.promises.unlink(tmpPath); } catch {}
  // Clamp to a sane band — a single benchmark can be noisy on a cold cache
  // or hammered drive; bounding it keeps the user-facing estimate honest.
  mbps = Math.max(5, Math.min(500, mbps));
  return mbps;
}

// Estimate seconds-to-complete given total bytes + measured throughput.
function estimateSeconds(totalBytes, mbps) {
  if (!totalBytes || !mbps) return 0;
  return totalBytes / (mbps * 1024 * 1024);
}

// Suggested default filename for the save dialog. ISO date stamp keeps
// repeated backups sortable in a folder.
function suggestedFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `jmt-soundfontlibrary-${stamp}.zip`;
}

// Snapshot the library-state settings that travel with the backup. Kept
// tight on purpose — only true library state, not session prefs or tab
// visibility toggles. New entries here need to be load-bearing for "fresh
// install + import = exact prior state."
function _captureLibrarySettings(prefs) {
  return {
    starredCommon: prefs.starredCommon || '',
  };
}

// Export the SF library to destPath as a .jmt-soundfontlibrary.zip. The
// caller is expected to pass an AbortSignal so cancellation can land mid-
// archive — partial zips are deleted on cancel/error so a half-baked file
// never gets mistaken for a valid backup.
//
// progress callback is invoked with { phase, processedBytes, totalBytes,
// currentItem } as items stream in. The renderer uses these to drive the
// progress modal label and percentage.
async function exportBackup({
  userData,
  destPath,
  appVersion,
  prefs = {},
  onProgress = () => {},
  signal = null,
}) {
  if (!destPath) throw new Error('Missing destPath');
  _ensureLibraryBackfill(userData);
  const survey = surveyLibrary(userData);

  // Content-hash pre-pass. One sha256 per top-level item, written into
  // the manifest so the Replace-import survey can do a true byte-level
  // skip-or-extract decision instead of the older fileCount+totalBytes
  // proxy + directory-set heuristic. Costs one full read of the library
  // up front; cheaper than the unbounded user-trust risk of "looked
  // identical, wasn't actually." Per-item progress emits so the UI can
  // tick a counter (large libraries with paid voicepacks can take
  // tens of seconds at this step on a spinning disk).
  const { hashItemDir } = require('./soundFontFileHash');
  const contentHashes = { sources: {}, library: {}, common: {} };
  // Pre-scan each bucket up front: per-bucket top-level item arrays
  // (drives both phase counters), plus per-item file counts (drives
  // the per-font / per-folder archive labels). One disk walk now
  // instead of duplicate walks per phase.
  const bucketTops = { sources: [], library: [], common: [] };
  const filesPerTopItem = new Map();
  // Commons live on disk under <uuid>/ — the user-facing label needs the
  // friendly name from meta.json. Read it once during pre-scan and look
  // it up by uuid in the archive entry handler.
  const commonNameByUuid = new Map();
  // Sources also live on disk under <uuid>/ — same idea for the
  // currentItem display path. The bucket label stays aggregate
  // ("Source Files") but the per-file line under the bar reads
  // "sources/<friendly>/file.ext" instead of leaking a raw uuid.
  const sourceNameByUuid = new Map();
  for (const bucket of ['sources', 'library', 'common']) {
    const root = path.join(_soundFontsRoot(userData), bucket);
    if (!fs.existsSync(root)) continue;
    let topEntries;
    try { topEntries = fs.readdirSync(root, { withFileTypes: true }); }
    catch { continue; }
    for (const top of topEntries) {
      if (!top.isDirectory()) continue;
      const abs = path.join(root, top.name);
      bucketTops[bucket].push({ name: top.name, abs });
      // archive.directory() emits 'entry' events for files AND
      // sub-directories. The user-facing counter should only track
      // files, so the pre-scan and the entry handler must agree on
      // "files only."
      let count = 0;
      const walk = (dir) => {
        let items;
        try { items = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const it of items) {
          if (it.isDirectory()) walk(path.join(dir, it.name));
          else if (it.isFile()) count++;
        }
      };
      walk(abs);
      filesPerTopItem.set(`${bucket}/${top.name}`, count);
      if (bucket === 'common') {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(abs, 'meta.json'), 'utf8'));
          if (m && m.name) commonNameByUuid.set(top.name, m.name);
        } catch {}
      }
      if (bucket === 'sources') {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(abs, 'meta.json'), 'utf8'));
          const friendly = (m && (m.bundleName || m.originalName)) || '';
          if (friendly) sourceNameByUuid.set(top.name, friendly);
        } catch {}
      }
    }
  }
  // sharedTracks: flat bucket, count individual .wav files.
  let sharedTracksItemCount = 0;
  try {
    const stRoot = path.join(_soundFontsRoot(userData), 'sharedTracks');
    if (fs.existsSync(stRoot)) {
      for (const f of fs.readdirSync(stRoot, { withFileTypes: true })) {
        if (f.isFile() && /\.wav$/i.test(f.name)) sharedTracksItemCount++;
      }
    }
  } catch {}

  // HASH PHASE — per-bucket aggregate counters, "Preparing" verb so
  // the user doesn't see the implementation term. Each phase emits
  // per-item progress; the label shape matches the archive phase so
  // the user reads one continuous mental model across both halves.
  //
  // Library + common route through the stored-hash helpers, which read
  // meta.contentHash when the cheap-signal safety net passes (file
  // count + total bytes match the on-disk reality). Skips the full
  // tree walk + sha256 for items that haven't been touched since the
  // last hash, which is the steady state. First export after this
  // slice triggers backfill — same cost as the old behavior; later
  // exports return near-instantly. Sources stay on hashItemDir
  // because source hashes live on source meta separately (different
  // identity model) and don't go through this path.
  const sfEntriesMod = require('./soundFontEntries');
  const sfCommonMod = require('./soundFontCommon');
  const sfSourcesMod = require('./soundFontSources');
  const hashForItem = (bucket, name, abs) => {
    if (bucket === 'library') return sfEntriesMod.getEntryContentHash(userData, name);
    if (bucket === 'common')  return sfCommonMod.getCommonContentHash(userData, name);
    // Sources are uuid-keyed on disk and effectively immutable post-
    // import — once the hash is stamped onto source meta.json, every
    // subsequent export reads it back instead of re-hashing multi-GB
    // voicepacks. Cheap-signal safety net catches manual on-disk edits.
    if (bucket === 'sources') return sfSourcesMod.getSourceContentHash(userData, name);
    return hashItemDir(abs);
  };
  const hashPhaseBucket = async (bucket, bucketLabel) => {
    const items = bucketTops[bucket];
    for (let i = 0; i < items.length; i++) {
      if (signal && signal.aborted) {
        const e = new Error('Cancelled');
        e.cancelled = true;
        throw e;
      }
      const item = items[i];
      // Sources and commons live under uuid-keyed dirs on disk; resolve
      // to the friendly name so the user-facing line doesn't leak a
      // raw uuid. Library items are already name-keyed.
      let friendlyItemName = item.name;
      if (bucket === 'sources' && sourceNameByUuid.has(item.name)) {
        friendlyItemName = sourceNameByUuid.get(item.name);
      } else if (bucket === 'common' && commonNameByUuid.has(item.name)) {
        friendlyItemName = commonNameByUuid.get(item.name);
      }
      onProgress({
        verb: 'Preparing',
        currentItem: `${bucket}/${friendlyItemName}`,
        topItemName: bucketLabel,
        topItemFilesProcessed: i + 1,
        topItemFilesTotal: items.length,
      });
      const h = hashForItem(bucket, item.name, item.abs);
      if (h) contentHashes[bucket][item.name] = h;
    }
  };
  await hashPhaseBucket('sources', 'Source Files');
  await hashPhaseBucket('library', 'Font Files');
  await hashPhaseBucket('common', 'Common Folder Files');

  // Build the manifest first so a corrupted partial zip still gets the
  // type marker even if it doesn't finish.
  const manifest = {
    type: BACKUP_TYPE,
    schemaVersion: SCHEMA_VERSION,
    appVersion: appVersion || '',
    exportedAt: new Date().toISOString(),
    counts: { ...survey.counts },
    totals: { ...survey.totals, totalBytes: survey.totalBytes },
    settings: _captureLibrarySettings(prefs),
    // Per-item canonical content hashes, see soundFontFileHash.js for
    // what's included and excluded. Backups without this field fall
    // through to the legacy count+bytes path on import — backward
    // compat is preserved by absence.
    contentHashes,
  };

  const archiver = require('archiver');
  // Atomic-write pattern: stream to a sibling .partial file, then rename
  // atomically into the user's chosen destPath on success. Two wins:
  //   1. The user's chosen filename is never a partially-written zip:
  //      it either doesn't exist yet or it's the final, complete file.
  //      Cloud-sync agents (Drive/OneDrive/Dropbox) never see the
  //      streaming write at the user-visible path; they only see the
  //      finished file appear via rename.
  //   2. On cancel, the user-facing path was never created, so there's
  //      no "looks like a backup but isn't" hazard. The .partial file
  //      may linger if we can't delete it (own write-stream handle, sync
  //      agent lock), but it's visibly intermediate by name.
  const partialPath = destPath + '.partial';
  const ws = fs.createWriteStream(partialPath);
  // forceZip64: archive can grow past the 2 GiB signed-32-bit boundary
  // that zip-stream (archiver's underlying writer) enforces on the
  // classic zip32 format. A multi-GB Sound Fonts library will routinely
  // exceed that ceiling. Modern unzippers (Windows Explorer, 7-Zip,
  // node-stream-zip) all handle zip64 transparently; the overhead is
  // a few bytes of extended local headers per entry, no per-file size
  // ceiling, no archive-wide size ceiling.
  const archive = archiver('zip', { zlib: { level: 6 }, forceZip64: true });

  // Hook cancellation. Aborting the archiver mid-stream + closing the
  // write stream lets us clean up the partial file in the finally block.
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    try { archive.abort(); } catch {}
    try { ws.destroy(); } catch {}
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  // Single-attempt unlink with a hard wall. fs.promises.unlink on Windows
  // can block indefinitely at the OS level when the file is held open
  // by ANY process, including our own not-yet-fully-closed write
  // stream. Node provides no way to cancel an in-flight unlink. The
  // race below lets us stop WAITING after the wall; the unlink itself
  // continues in the background and may eventually succeed (in which
  // case the residualPath we report becomes a harmless lie that the
  // user discovers as a missing file when they go to clean it up).
  // .catch() is attached to the unlink promise BEFORE the race so a
  // rejection arriving after the wall doesn't become an unhandled
  // rejection that destabilizes the main process.
  const cleanupPartialFile = async (p) => {
    let outcome = 'timeout';
    await Promise.race([
      fs.promises.unlink(p).then(
        () => { outcome = 'ok'; },
        (e) => { outcome = e.code || 'err'; }
      ),
      new Promise(r => setTimeout(r, 3000)),
    ]);
    return outcome === 'ok' || outcome === 'ENOENT';
  };
  // Hard outer ceiling on cancel response. If anything inside the main
  // flow hangs past this point after abort (archive.finalize stuck on
  // a slow drain, ws never emitting 'close', whatever), we forcibly
  // throw cancelled and return, leaving the in-flight work to die in
  // the background. The renderer never gets trapped in an endless
  // "Cleaning up…" state even if our own teardown deadlocks.
  // deadlineTimer is cleared in the finally if work wins the race, so
  // the deadline promise never rejects and there's no late unhandled
  // rejection floating in the loop.
  let deadlineTimer = null;
  const cancelDeadline = new Promise((_, reject) => {
    if (!signal) return;
    const onAbortDeadline = () => {
      deadlineTimer = setTimeout(() => {
        const e = new Error('Cancelled');
        e.cancelled = true;
        e.residualPath = partialPath;
        reject(e);
      }, 5000);
    };
    if (signal.aborted) onAbortDeadline();
    else signal.addEventListener('abort', onAbortDeadline, { once: true });
  });

  let processedBytes = 0;
  // Per-bucket counter state for the archive phase. Sources and
  // sharedTracks aggregate at the bucket level (counter = item index
  // / total items in bucket). Library and common are per-item — each
  // font / common folder has its own file counter that climbs as
  // its files stream into the zip.
  const archiveSources = { idx: 0, total: bucketTops.sources.length, seenTops: new Set() };
  const archiveSharedTracks = { idx: 0, total: sharedTracksItemCount };
  // Bucket-level file counters drive the inter-bucket gates. archiver
  // can interleave entries across bucket boundaries too (the whole
  // sources/ bucket dispatches as one archive.directory() call which
  // starts streaming while we move on to library) so the dispatch
  // loop awaits each bucket's full file count before queuing the next.
  let sourcesFilesEmitted = 0;
  const sourcesFilesExpected = bucketTops.sources.reduce(
    (sum, it) => sum + (filesPerTopItem.get(`sources/${it.name}`) || 0), 0
  );
  let sharedTracksFilesEmitted = 0;
  const sourcesBucketGate = (() => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  })();
  const sharedTracksBucketGate = (() => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  })();
  const archiveLibFile = new Map();   // fontName -> filesEmittedSoFar
  const archiveComFile = new Map();   // folderName -> filesEmittedSoFar
  // Per-item completion gates. archiver's internal queue does NOT
  // guarantee strict serialization between archive.directory() calls in
  // practice — the entry stream can interleave files from sibling top
  // items, which surfaces as the per-font label flipping back and forth
  // (Ahsoka 50, Apocalypse 1, Ahsoka 51, …). To fix, the dispatch loop
  // awaits this gate per item: when the entry handler observes the
  // counter reach the pre-scan total for that item, the gate resolves
  // and the next archive.directory() call gets queued. One font at a
  // time, contiguously.
  const itemDoneGates = new Map(); // topKey -> { promise, resolve }
  const _gateFor = (topKey) => {
    if (!itemDoneGates.has(topKey)) {
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      itemDoneGates.set(topKey, { promise, resolve });
    }
    return itemDoneGates.get(topKey);
  };
  archive.on('entry', (entry) => {
    // Skip directory entries — archive.directory() emits an 'entry'
    // for every sub-folder as well as every file. The user-facing
    // counter and the pre-scan total both treat "files only" so we
    // need to match here or the counter overshoots 100%.
    const isDir = (entry.type === 'directory')
      || (entry.stats && typeof entry.stats.isDirectory === 'function' && entry.stats.isDirectory());
    if (isDir) return;
    if (entry.stats && entry.stats.size) processedBytes += entry.stats.size;
    const parts = String(entry.name || '').split('/');
    const bucket = parts[0] || '';
    const topName = parts[1] || '';
    if (!topName) return;
    // Build the user-facing path: zip paths under sources/ and common/
    // are keyed by uuid on disk, but the user shouldn't see raw uuids
    // flashing through. Library zip paths are already name-keyed.
    const displayName = (() => {
      if (bucket === 'sources' && sourceNameByUuid.has(topName)) {
        return `sources/${sourceNameByUuid.get(topName)}/${parts.slice(2).join('/')}`;
      }
      if (bucket === 'common' && commonNameByUuid.has(topName)) {
        return `common/${commonNameByUuid.get(topName)}/${parts.slice(2).join('/')}`;
      }
      return entry.name;
    })();
    if (bucket === 'sources') {
      const topKey = `${bucket}/${topName}`;
      if (!archiveSources.seenTops.has(topKey)) {
        archiveSources.seenTops.add(topKey);
        archiveSources.idx++;
      }
      onProgress({
        verb: 'Backing up',
        processedBytes,
        totalBytes: survey.totalBytes,
        currentItem: displayName,
        topItemName: 'Source Files',
        topItemFilesProcessed: archiveSources.idx,
        topItemFilesTotal: archiveSources.total,
      });
      sourcesFilesEmitted++;
      if (sourcesFilesExpected > 0 && sourcesFilesEmitted >= sourcesFilesExpected) {
        sourcesBucketGate.resolve();
      }
    } else if (bucket === 'library' || bucket === 'common') {
      const counterMap = bucket === 'library' ? archiveLibFile : archiveComFile;
      const itemTotal = filesPerTopItem.get(`${bucket}/${topName}`) || 0;
      const newIdx = (counterMap.get(topName) || 0) + 1;
      counterMap.set(topName, newIdx);
      // Library dirs are name-keyed; common dirs are uuid-keyed and
      // must be translated to the friendly name from meta.json so the
      // user doesn't see a raw uuid in the label.
      const friendlyTop = bucket === 'common'
        ? (commonNameByUuid.get(topName) || topName)
        : topName;
      onProgress({
        verb: 'Backing up',
        processedBytes,
        totalBytes: survey.totalBytes,
        currentItem: displayName,
        topItemName: `${friendlyTop} Files`,
        topItemFilesProcessed: newIdx,
        topItemFilesTotal: itemTotal,
      });
      // Resolve the per-item gate once all files for this top item have
      // arrived. The dispatch loop awaits this before queuing the next
      // archive.directory() call so entries can't interleave.
      if (itemTotal > 0 && newIdx >= itemTotal) {
        _gateFor(`${bucket}/${topName}`).resolve();
      }
    } else if (bucket === 'sharedTracks') {
      archiveSharedTracks.idx++;
      onProgress({
        verb: 'Backing up',
        processedBytes,
        totalBytes: survey.totalBytes,
        currentItem: entry.name,
        topItemName: 'Shared Tracks',
        topItemFilesProcessed: archiveSharedTracks.idx,
        topItemFilesTotal: archiveSharedTracks.total,
      });
      sharedTracksFilesEmitted++;
      if (archiveSharedTracks.total > 0 && sharedTracksFilesEmitted >= archiveSharedTracks.total) {
        sharedTracksBucketGate.resolve();
      }
    }
  });

  const done = new Promise((resolve, reject) => {
    ws.on('close', resolve);
    ws.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', err => {
      // ENOENT warnings show up when files vanish mid-walk (rare); other
      // warnings are surfaced as failures so we don't ship a backup with
      // silent gaps.
      if (err.code === 'ENOENT') return;
      reject(err);
    });
  });
  // Pre-attach a no-op catch IMMEDIATELY so a rejection arriving before
  // the await in `work` (typically: ws.destroy() triggers pending write
  // callbacks to fail with ERR_STREAM_DESTROYED, archiver propagates,
  // done rejects) doesn't fire an UnhandledPromiseRejectionWarning in
  // the Node console. Awaits later still see the rejection because
  // .catch() creates a new derived promise; the original `done` keeps
  // its rejection state and the await observes it independently.
  done.catch(() => {});

  archive.pipe(ws);

  // Main streaming work wrapped so we can race it against cancelDeadline.
  const work = (async () => {
    // Manifest first so a partial-but-readable zip still identifies as
    // ours when someone tries to peek into it.
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Bucket-by-bucket archive order. For sources and sharedTracks the
    // whole bucket is walked at once (one archive.directory call) since
    // they're aggregate-labelled — interleaving within them doesn't
    // affect the user-facing counter. For library and common, each
    // top-level item is added separately so the per-item label stays
    // stable on one font / folder while its files stream through, then
    // flips to the next.
    if (!cancelled) {
      const srcRoot = path.join(_soundFontsRoot(userData), 'sources');
      if (fs.existsSync(srcRoot)) {
        archive.directory(srcRoot, 'sources');
        // Wait for the entire sources bucket to flush before starting
        // library, otherwise archiver interleaves sources entries with
        // the first library entries and the user-facing label flips
        // mid-bucket.
        if (sourcesFilesExpected > 0) await sourcesBucketGate.promise;
      }
    }
    if (!cancelled) {
      const libRoot = path.join(_soundFontsRoot(userData), 'library');
      if (fs.existsSync(libRoot)) {
        for (const item of bucketTops.library) {
          if (cancelled) break;
          const topKey = `library/${item.name}`;
          const expected = filesPerTopItem.get(topKey) || 0;
          archive.directory(item.abs, topKey);
          // Empty dirs would never resolve via the entry handler; just
          // skip the await in that case so the loop doesn't hang.
          if (expected > 0) await _gateFor(topKey).promise;
        }
      }
    }
    if (!cancelled) {
      const comRoot = path.join(_soundFontsRoot(userData), 'common');
      if (fs.existsSync(comRoot)) {
        for (const item of bucketTops.common) {
          if (cancelled) break;
          const topKey = `common/${item.name}`;
          const expected = filesPerTopItem.get(topKey) || 0;
          archive.directory(item.abs, topKey);
          if (expected > 0) await _gateFor(topKey).promise;
        }
      }
    }
    if (!cancelled) {
      const stRoot = path.join(_soundFontsRoot(userData), 'sharedTracks');
      if (fs.existsSync(stRoot)) {
        archive.directory(stRoot, 'sharedTracks');
        if (archiveSharedTracks.total > 0) await sharedTracksBucketGate.promise;
      }
    }

    if (!cancelled) await archive.finalize();
    await done.catch(() => {}); // swallow during cancel; race handles exits
  })();

  try {
    await Promise.race([work, cancelDeadline]);
  } catch (err) {
    // Cancel deadline fired OR work threw. Either way, attempt cleanup
    // of the .partial (best effort) and rethrow with the right shape.
    const cleaned = await cleanupPartialFile(partialPath);
    if (err && err.cancelled) {
      const e = new Error('Cancelled');
      e.cancelled = true;
      e.residualPath = cleaned ? null : partialPath;
      throw e;
    }
    if (cancelled) {
      const e = new Error('Cancelled');
      e.cancelled = true;
      e.residualPath = cleaned ? null : partialPath;
      throw e;
    }
    throw err;
  } finally {
    if (signal) {
      try { signal.removeEventListener('abort', onAbort); } catch {}
    }
    if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
    // Belt-and-suspenders: if cancelDeadline is still pending here
    // (work won the race or threw early), attach a no-op catch so a
    // late-arriving rejection can't become an unhandled rejection.
    cancelDeadline.catch(() => {});
    // Same for work, in case its internal awaits throw after race
    // already resolved.
    work.catch(() => {});
  }

  if (cancelled) {
    const cleaned = await cleanupPartialFile(partialPath);
    const e = new Error('Cancelled');
    e.cancelled = true;
    e.residualPath = cleaned ? null : partialPath;
    throw e;
  }

  // Success: atomic rename .partial → destPath. If destPath already
  // exists (overwrite), try to remove it first; on Windows newer Node
  // versions support overwrite-on-rename, but the explicit unlink is
  // a belt-and-suspenders that also surfaces a useful error if the
  // existing file is locked.
  if (fs.existsSync(destPath)) {
    try { await fs.promises.unlink(destPath); } catch {}
  }
  await fs.promises.rename(partialPath, destPath);
  return { destPath, manifest };
}

// Read + validate a backup zip without unpacking it. Returns the manifest
// + a survey of what's actually inside the zip (counts per bucket measured
// from the entry list, so a tampered manifest doesn't silently mismatch
// the real contents). Errors carry a `reason` code so the renderer can
// branch UX between "not a backup" vs "wrong schema" vs "unreadable file".
async function inspectBackup(zipPath) {
  if (!zipPath) return { ok: false, reason: 'missing-path', error: 'Missing zip path' };
  if (!fs.existsSync(zipPath)) return { ok: false, reason: 'missing-file', error: 'File not found' };
  const StreamZip = require('node-stream-zip');
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  } catch (err) {
    return { ok: false, reason: 'unreadable', error: String(err && err.message || err) };
  }
  try {
    let entries;
    try { entries = await zip.entries(); }
    catch (err) { return { ok: false, reason: 'unreadable', error: String(err && err.message || err) }; }
    const manifestEntry = entries['manifest.json'];
    if (!manifestEntry) {
      return { ok: false, reason: 'not-a-backup', error: 'This zip is not a JMT Studio Sound Font library backup.' };
    }
    let manifest;
    try {
      const buf = await zip.entryData('manifest.json');
      manifest = JSON.parse(buf.toString('utf8'));
    } catch (err) {
      return { ok: false, reason: 'bad-manifest', error: 'The backup file is damaged or its manifest is not readable.' };
    }
    if (!manifest || manifest.type !== BACKUP_TYPE) {
      return { ok: false, reason: 'not-a-backup', error: 'This zip is not a JMT Studio Sound Font library backup.' };
    }
    if (typeof manifest.schemaVersion !== 'number' || manifest.schemaVersion > SCHEMA_VERSION) {
      return {
        ok: false,
        reason: 'newer-schema',
        error: `This backup was created by a newer version of JMT Studio (schema ${manifest.schemaVersion}). Update JMT Studio to import it.`,
      };
    }
    // Measure actual bucket contents from the entry list. Counts top-level
    // subdirs under each nested bucket (sources/<uuid>, library/<name>,
    // common/<uuid>). sharedTracks is flat — count .wav file entries
    // directly (no top-dir layer). Bytes sum from entry sizes either way.
    const buckets = {
      sources: { count: 0, bytes: 0 },
      library: { count: 0, bytes: 0 },
      common: { count: 0, bytes: 0 },
      sharedTracks: { count: 0, bytes: 0 },
    };
    const topDirs = { sources: new Set(), library: new Set(), common: new Set() };
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.name || e.name === '/' || e.name === 'manifest.json') continue;
      const parts = e.name.split('/');
      const bucket = parts[0];
      if (!buckets[bucket]) continue;
      if (bucket === 'sharedTracks') {
        // Flat: parts[1] is the filename. Count .wav files only.
        if (!e.isDirectory && parts[1] && /\.wav$/i.test(parts[1])) {
          buckets.sharedTracks.count++;
          buckets.sharedTracks.bytes += (e.size || 0);
        }
        continue;
      }
      if (parts[1] && parts[1] !== '') topDirs[bucket].add(parts[1]);
      if (!e.isDirectory) buckets[bucket].bytes += (e.size || 0);
    }
    for (const b of ['sources', 'library', 'common']) buckets[b].count = topDirs[b].size;
    const observedTotal = buckets.sources.bytes + buckets.library.bytes + buckets.common.bytes + buckets.sharedTracks.bytes;
    return {
      ok: true,
      manifest,
      observed: {
        counts: { sources: buckets.sources.count, library: buckets.library.count, common: buckets.common.count, sharedTracks: buckets.sharedTracks.count },
        totals: { sources: buckets.sources.bytes, library: buckets.library.bytes, common: buckets.common.bytes, sharedTracks: buckets.sharedTracks.bytes, totalBytes: observedTotal },
      },
    };
  } finally {
    try { await zip.close(); } catch {}
  }
}

// Replace-import: wipe the current SF library and restore from the backup
// exactly. The whole operation is atomic from the user's perspective —
// either the new library is fully in place or the original library is
// untouched.
//
// Mechanism:
//   1. Rename userData/soundFonts/ → userData/soundFonts.preimport-bak-<ts>/
//      so the original is preserved as a complete tree (cheap rename, not a
//      copy) and an interrupted extract leaves zero ambiguity about state.
//   2. Create fresh userData/soundFonts/ and extract every entry into it.
//   3. On success: delete the snapshot.
//   4. On cancel/error: delete the partial new dir + rename snapshot back.
//
// progress callback fires per entry with { processedBytes, totalBytes,
// currentItem }. Caller supplies an AbortSignal for cancellation.
async function applyReplace({
  userData,
  zipPath,
  onProgress = () => {},
  signal = null,
}) {
  if (!zipPath) throw new Error('Missing zipPath');
  if (!userData) throw new Error('Missing userData');
  const sfRoot = _soundFontsRoot(userData);
  const snapshotPath = `${sfRoot}.preimport-bak-${Date.now()}`;

  // Snapshot via rename. If the original doesn't exist yet (fresh install
  // path), there's nothing to preserve — just skip the rename.
  const hadOriginal = fs.existsSync(sfRoot);
  if (hadOriginal) {
    try { fs.renameSync(sfRoot, snapshotPath); }
    catch (err) { throw new Error(`Could not snapshot existing library: ${err.message}`); }
  }

  // Pre-extract survey for the identical-skip optimization. surveyMerge
  // expects the user's library at userData/soundFonts; we've just renamed
  // it to snapshotPath, so a junction symlink at the original location
  // lets the survey read the snapshot transparently. Done BEFORE creating
  // the fresh sfRoot so the symlink can actually take that path.
  const skipDirs = { sources: new Set(), library: new Set(), common: new Set() };
  if (hadOriginal) {
    let tmpLink = null;
    try {
      try {
        fs.symlinkSync(snapshotPath, sfRoot, 'junction');
        tmpLink = sfRoot;
      } catch {
        // Symlink failed (permissions, platform). Fall back to no
        // optimization — wipe-and-extract everything.
      }
      if (tmpLink) {
        const surveyRes = await surveyMerge({ userData, zipPath });
        for (const it of surveyRes.sources?.identical || []) skipDirs.sources.add(it.id);
        for (const it of surveyRes.library?.identical || []) skipDirs.library.add(it.id);
        for (const it of surveyRes.common?.identical  || []) skipDirs.common.add(it.id);
      }
    } catch {
      skipDirs.sources.clear();
      skipDirs.library.clear();
      skipDirs.common.clear();
    } finally {
      if (tmpLink) { try { fs.unlinkSync(tmpLink); } catch {} }
    }
  }

  // Create the fresh root early so a no-entries backup still lands a valid
  // empty dir rather than leaving the SF tab pointing at nothing.
  try { fs.mkdirSync(sfRoot, { recursive: true }); }
  catch (err) {
    // Couldn't even make the new root — try to put things back exactly as
    // they were so the user isn't worse off than when they started.
    if (hadOriginal) {
      try { fs.renameSync(snapshotPath, sfRoot); } catch {}
    }
    throw new Error(`Could not create library directory: ${err.message}`);
  }

  const StreamZip = require('node-stream-zip');
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  } catch (err) {
    // Rollback before re-throwing.
    try { fs.rmSync(sfRoot, { recursive: true, force: true }); } catch {}
    if (hadOriginal) {
      try { fs.renameSync(snapshotPath, sfRoot); } catch {}
    }
    throw new Error(`Could not open backup zip: ${err.message}`);
  }

  let cancelled = false;
  const onAbort = () => { cancelled = true; };
  if (signal) {
    if (signal.aborted) cancelled = true;
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let manifest = null;
  let processedBytes = 0;
  let totalBytes = 0;
  // Items we move from snapshot to fresh root because they're 100%
  // identical to the backup. Tracked so a mid-run failure can move them
  // back to the snapshot during rollback and the user lands exactly
  // where they started. Both are hoisted to the function scope so the
  // catch block can iterate them without a ReferenceError when the
  // throw happens before their original (in-try) declarations would
  // have executed — the empty-library case used to hit exactly that.
  const reusedItems = []; // [{ snapshotAbs, freshAbs }, ...]
  const reusedFiles = []; // { snapshotAbs, freshAbs } for sharedTracks rollback

  try {
    const entries = await zip.entries();
    // Manifest first (small, needed for settings).
    try {
      const buf = await zip.entryData('manifest.json');
      manifest = JSON.parse(buf.toString('utf8'));
    } catch {}

    // When the manifest carries per-item content hashes, surveyMerge
    // already did a strict byte-level identical check (hash from
    // manifest vs hash of the live tree). The directory-set heuristic
    // below was the v1 stopgap for that gap; it's redundant when the
    // hash is authoritative. Old backups without contentHashes still
    // get the heuristic via the legacy path.
    const hasManifestContentHashes = !!(manifest && manifest.contentHashes);

    // Per-item directory-presence map for the verification step. For
    // each backup item we record which directories the zip contains
    // (both as implicit parents of files and explicit dir entries).
    // The survey already vouched for file content via count+bytes (or
    // source hash); the only realistic gap is on-disk dirs that the
    // backup doesn't have, which the size aggregate can't see.
    const zipDirsByItem = new Map(); // "bucket/id" → Set<relPath>
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.name || e.name === 'manifest.json') continue;
      const parts = e.name.split('/');
      if (parts.length < 3) continue;
      const itemKey = `${parts[0]}/${parts[1]}`;
      if (!zipDirsByItem.has(itemKey)) zipDirsByItem.set(itemKey, new Set());
      const dirsSet = zipDirsByItem.get(itemKey);
      const innerParts = parts.slice(2);
      const endIdx = e.isDirectory ? innerParts.length : innerParts.length - 1;
      let acc = '';
      for (let i = 0; i < endIdx; i++) {
        acc = acc ? `${acc}/${innerParts[i]}` : innerParts[i];
        if (acc) dirsSet.add(acc);
      }
    }

    // Walk an item dir on disk, returning the set of subdirectory paths
    // (relative to the item root). Empty folders the user added show up
    // here, and the zip-side set won't contain them — that's the catch.
    const onDiskDirsOf = (itemAbs) => {
      const out = new Set();
      const walk = (cur, rel) => {
        let items;
        try { items = fs.readdirSync(cur, { withFileTypes: true }); }
        catch { return; }
        for (const it of items) {
          if (!it.isDirectory()) continue;
          const rp = rel ? `${rel}/${it.name}` : it.name;
          out.add(rp);
          walk(path.join(cur, it.name), rp);
        }
      };
      walk(itemAbs, '');
      return out;
    };

    // Move truly-identical items from snapshot to fresh. Verify against
    // the zip first — if the snapshot dir has anything the zip doesn't,
    // or vice versa, drop the item from skipDirs so it gets re-extracted
    // (catches "user added an empty folder, content bytes still match"
    // case where survey's file-count + total-bytes check is too loose).
    const totalToReuse = skipDirs.sources.size + skipDirs.library.size + skipDirs.common.size;
    let reuseDone = 0;
    if (totalToReuse > 0) {
      onProgress({ phase: 'reusing', processedBytes: 0, totalBytes: 0, currentItem: `Reusing ${totalToReuse} unchanged items from your current library…` });
    }
    for (const bucket of ['sources', 'library', 'common']) {
      const freshBucketDir = path.join(sfRoot, bucket);
      try { fs.mkdirSync(freshBucketDir, { recursive: true }); } catch {}
      for (const id of [...skipDirs[bucket]]) {
        const snapAbs = path.join(snapshotPath, bucket, id);
        const freshAbs = path.join(freshBucketDir, id);
        if (!fs.existsSync(snapAbs)) {
          skipDirs[bucket].delete(id);
          continue;
        }
        // Only the directory set might disagree with the zip when the
        // survey says identical — empty folders added (or removed)
        // since the backup was taken. Symmetric check: every on-disk
        // dir must be in the zip, every zip dir must be on-disk.
        // Skipped entirely when the manifest carries content hashes
        // (surveyMerge already did a strict comparison).
        if (!hasManifestContentHashes) {
          const onDiskDirs = onDiskDirsOf(snapAbs);
          const zipDirs = zipDirsByItem.get(`${bucket}/${id}`) || new Set();
          let mismatch = false;
          for (const d of onDiskDirs) { if (!zipDirs.has(d)) { mismatch = true; break; } }
          if (!mismatch) {
            for (const d of zipDirs) { if (!onDiskDirs.has(d)) { mismatch = true; break; } }
          }
          if (mismatch) {
            skipDirs[bucket].delete(id);
            continue;
          }
        }
        try {
          fs.renameSync(snapAbs, freshAbs);
          reusedItems.push({ snapshotAbs: snapAbs, freshAbs });
        } catch {
          skipDirs[bucket].delete(id);
        }
      }
    }

    // sharedTracks per-file identical-skip. The bucket-level dir move
    // above doesn't apply (sharedTracks is flat files, not uuid-keyed
    // subdirs); we instead build a per-file skip set, move identical
    // files from snapshot to fresh, and let the extract loop skip the
    // ones we already moved. Files compared by hash via the local +
    // backup hash indexes — both ship in the sharedTracks folder so
    // they're available before any extraction has happened.
    const skipFiles = new Set();      // zip entry names to skip extracting
    // reusedFiles hoisted to outer scope above so the catch can iterate
    // it without a ReferenceError on early-throw paths.
    if (hadOriginal) {
      try {
        // Load the snapshot's hash index. ensureIndex would mutate the
        // snapshot dir which we want to leave pristine for rollback —
        // so we read raw and tolerate a missing index by giving up the
        // optimization (extract everything).
        const hashMod = require('./soundFontSharedTracksHash');
        const snapStRoot = path.join(snapshotPath, 'sharedTracks');
        const snapIndexPath = path.join(snapStRoot, '.jmt-hashes.json');
        let snapIndex = null;
        if (fs.existsSync(snapIndexPath)) {
          try { snapIndex = JSON.parse(fs.readFileSync(snapIndexPath, 'utf8')); } catch {}
        }
        // Load the backup's index from the zip.
        let backupIndex = null;
        try {
          const buf = await zip.entryData('sharedTracks/.jmt-hashes.json');
          backupIndex = JSON.parse(buf.toString('utf8'));
        } catch {}
        if (snapIndex && backupIndex && snapIndex.tracks && backupIndex.tracks) {
          // Snapshot-side: map hash → snapshot filename so we can
          // resolve a backup record to a snapshot file by content.
          const snapHashToName = new Map();
          for (const u of Object.keys(snapIndex.tracks)) {
            const r = snapIndex.tracks[u];
            if (r && r.hash && r.name) snapHashToName.set(r.hash, r.name);
          }
          // Ensure fresh sharedTracks dir exists for any moves.
          const freshStRoot = path.join(sfRoot, 'sharedTracks');
          try { fs.mkdirSync(freshStRoot, { recursive: true }); } catch {}
          for (const buuid of Object.keys(backupIndex.tracks)) {
            const br = backupIndex.tracks[buuid];
            if (!br || !br.name || !br.hash) continue;
            const snapName = snapHashToName.get(br.hash);
            if (!snapName) continue; // backup file isn't in snapshot — must extract
            const snapAbs = path.join(snapStRoot, snapName);
            if (!fs.existsSync(snapAbs)) continue;
            const freshAbs = path.join(freshStRoot, br.name);
            try {
              fs.renameSync(snapAbs, freshAbs);
              reusedFiles.push({ snapshotAbs: snapAbs, freshAbs });
              // Skip this entry during extraction since we've already
              // satisfied it via move-from-snapshot.
              skipFiles.add(`sharedTracks/${br.name}`);
            } catch {
              // Move failed (lock, permissions); fall back to extract.
            }
          }
        }
      } catch {}
    }

    // Survey total bytes up front, but only for entries we'll actually
    // extract — skipped items aren't part of the progress denominator.
    const isSkipped = (entryName) => {
      if (skipFiles.has(entryName)) return true;
      const parts = entryName.split('/');
      if (parts.length < 2) return false;
      const bucket = parts[0];
      const id = parts[1];
      return skipDirs[bucket] && skipDirs[bucket].has(id);
    };
    // Pre-pass: build totals once over the entries list.
    //   - totalBytes: denominator for the bar (overall byte progress)
    //   - filesPerTopItem: map "bucket/topName" → file count, so the
    //     renderer can show "Restoring Apocalypse (234 of 567 files)"
    //     as we process each top-level item.
    //   - sourceNameByUuid: friendly name for source uuids (sources
    //     are uuid-keyed on disk; library/common already use friendly
    //     names as their dir names).
    const filesPerTopItem = new Map();
    const sourceUuidSet = new Set();
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.name || e.name === 'manifest.json') continue;
      const parts = e.name.split('/');
      if (parts.length < 2) continue;
      const bucket = parts[0];
      // sharedTracks is a flat bucket — each file IS the top item.
      const topName = bucket === 'sharedTracks'
        ? (parts[parts.length - 1] || '')
        : (parts[1] || '');
      if (!topName) continue;
      const topKey = `${bucket}/${topName}`;
      if (bucket === 'sources') sourceUuidSet.add(topName);
      if (e.isDirectory) continue;
      if (isSkipped(e.name)) continue;
      totalBytes += (e.size || 0);
      filesPerTopItem.set(topKey, (filesPerTopItem.get(topKey) || 0) + 1);
    }
    const sourceNameByUuid = new Map();
    for (const uuid of sourceUuidSet) {
      try {
        const buf = await zip.entryData(`sources/${uuid}/meta.json`);
        const m = JSON.parse(buf.toString('utf8'));
        const friendly = (m && (m.bundleName || m.originalName)) || '';
        if (friendly) sourceNameByUuid.set(uuid, String(friendly).replace(/\.zip$/i, ''));
      } catch {}
    }
    // Same translation for commons — they're also uuid-keyed on disk +
    // in the zip, but the user sees friendly names everywhere else in
    // the app and shouldn't see raw uuids flashing through during
    // restore/merge.
    const commonNameByUuid = new Map();
    const commonUuidSet = new Set();
    for (const key of Object.keys(entries)) {
      const parts = (entries[key].name || '').split('/');
      if (parts[0] === 'common' && parts[1]) commonUuidSet.add(parts[1]);
    }
    for (const uuid of commonUuidSet) {
      try {
        const buf = await zip.entryData(`common/${uuid}/meta.json`);
        const m = JSON.parse(buf.toString('utf8'));
        if (m && m.name) commonNameByUuid.set(uuid, m.name);
      } catch {}
    }
    const friendlyTopName = (bucket, raw) => {
      if (bucket === 'sources' && sourceNameByUuid.has(raw)) return sourceNameByUuid.get(raw);
      if (bucket === 'common'  && commonNameByUuid.has(raw))  return commonNameByUuid.get(raw);
      return raw;
    };
    // Translate a zip entry path so users see friendly names instead of
    // raw uuids in the currentItem display ("sources/Ahsoka/source.zip"
    // not "sources/76ec9d60-...-/source.zip"). Library entries are
    // already name-keyed in the zip, and sharedTracks are flat — so the
    // remap only fires for sources and commons.
    const friendlyZipPath = (zipName) => {
      const parts = String(zipName || '').split('/');
      if (parts[0] === 'sources' && parts[1] && sourceNameByUuid.has(parts[1])) {
        return `sources/${sourceNameByUuid.get(parts[1])}/${parts.slice(2).join('/')}`;
      }
      if (parts[0] === 'common' && parts[1] && commonNameByUuid.has(parts[1])) {
        return `common/${commonNameByUuid.get(parts[1])}/${parts.slice(2).join('/')}`;
      }
      return zipName;
    };
    // Emit progress for reused items so the modal motion stays alive
    // during the snapshot-rehome phase. Each reused item gets a single
    // tick at its "100%" state.
    if (reusedItems.length > 0) {
      for (const r of reusedItems) {
        const rawName = path.basename(r.freshAbs);
        const bucketName = path.basename(path.dirname(r.freshAbs));
        const friendlyName = friendlyTopName(bucketName, rawName);
        const topKey = `${bucketName}/${rawName}`;
        const filesInItem = filesPerTopItem.get(topKey) || 0;
        onProgress({
          processedBytes,
          totalBytes,
          currentItem: `${bucketName}/${friendlyName}`,
          topItemName: friendlyName,
          topItemFilesProcessed: filesInItem,
          topItemFilesTotal: filesInItem,
        });
      }
    }
    // Pre-create empty directory entries up front. archiver emits
    // these for empty effect dirs (e.g., a font with an empty blst/
    // folder); we mkdirSync them once before the file-extract loop so
    // the per-bucket iteration below only handles files.
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.isDirectory) continue;
      if (!e.name || e.name === '/' || e.name === 'manifest.json') continue;
      if (isSkipped(e.name)) continue;
      const normalized = e.name.replace(/\\/g, '/');
      const target = path.resolve(sfRoot, normalized);
      if (!target.startsWith(path.resolve(sfRoot) + path.sep) && target !== path.resolve(sfRoot)) continue;
      try { fs.mkdirSync(target, { recursive: true }); } catch {}
    }

    // Group files by bucket and (where useful) by top-level item.
    // Sources and sharedTracks are AGGREGATE-labelled: each source is
    // just source.zip + meta.json so a "1 of 2 files" per-source label
    // would be noise, and each shared track is a single file so per-
    // item labelling is meaningless. Library and common are PER-ITEM
    // labelled: each font / common folder has many files and the
    // user wants the current font name on screen as the work
    // progresses.
    //
    // The label the renderer reads (topItemName) is constructed here
    // already with the right noun ("Source Files", "Ahsoka Files",
    // "Shared Tracks") so the renderer doesn't have to know about
    // per-bucket grammar.
    const bucketFiles = { sources: [], library: [], common: [], sharedTracks: [] };
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (e.isDirectory) continue;
      if (!e.name || e.name === '/' || e.name === 'manifest.json') continue;
      if (isSkipped(e.name)) continue;
      const parts = e.name.split('/');
      const bucket = parts[0] || '';
      if (bucketFiles[bucket]) bucketFiles[bucket].push(e);
    }

    const extractFile = async (e) => {
      const normalized = e.name.replace(/\\/g, '/');
      const target = path.resolve(sfRoot, normalized);
      if (!target.startsWith(path.resolve(sfRoot) + path.sep) && target !== path.resolve(sfRoot)) return false;
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
      try {
        await zip.extract(e.name, target);
        processedBytes += (e.size || 0);
        return true;
      } catch (err) {
        throw new Error(`Failed extracting ${e.name}: ${err && err.message || err}`);
      }
    };

    // Phase order: sources → library → common → sharedTracks.
    // Within sources and sharedTracks the label aggregates ("Source
    // Files (N of M, P%)") with all files in the bucket flying by
    // underneath. Within library and common the label flips per item
    // ("Ahsoka Files (45 of 451, 10%)") and stays on that item until
    // all of its files are extracted.

    // --- AGGREGATE: sources ---
    // Counter unit is SOURCES (top-level uuid), not files within
    // sources — folder-format sources have their full extracted tree
    // on disk so they contribute many files each, but the user's
    // mental unit is "129 sources" not "2222 source files." File
    // names still flash by underneath as each one extracts; the
    // top-line counter advances when we move to a new uuid.
    if (!cancelled && bucketFiles.sources.length > 0) {
      const sourcesByUuid = new Map();
      const sourceOrder = [];
      for (const e of bucketFiles.sources) {
        const parts = e.name.split('/');
        const uuid = parts[1] || '';
        if (!uuid) continue;
        if (!sourcesByUuid.has(uuid)) {
          sourcesByUuid.set(uuid, []);
          sourceOrder.push(uuid);
        }
        sourcesByUuid.get(uuid).push(e);
      }
      const totalSources = sourceOrder.length;
      for (let i = 0; i < totalSources; i++) {
        if (cancelled) break;
        const files = sourcesByUuid.get(sourceOrder[i]);
        for (const e of files) {
          if (cancelled) break;
          const ok = await extractFile(e);
          if (!ok) continue;
          onProgress({
            processedBytes,
            totalBytes,
            currentItem: friendlyZipPath(e.name),
            topItemName: 'Source Files',
            topItemFilesProcessed: i + 1,
            topItemFilesTotal: totalSources,
          });
        }
      }
    }

    // --- PER-ITEM: library (fonts) ---
    if (!cancelled && bucketFiles.library.length > 0) {
      const byItem = new Map();
      const itemOrder = [];
      for (const e of bucketFiles.library) {
        const parts = e.name.split('/');
        const rawTopName = parts[1] || '';
        if (!rawTopName) continue;
        if (!byItem.has(rawTopName)) {
          byItem.set(rawTopName, []);
          itemOrder.push(rawTopName);
        }
        byItem.get(rawTopName).push(e);
      }
      for (const itemName of itemOrder) {
        if (cancelled) break;
        const files = byItem.get(itemName);
        const itemTotal = files.length;
        const labelName = `${itemName} Files`;
        for (let i = 0; i < itemTotal; i++) {
          if (cancelled) break;
          const e = files[i];
          const ok = await extractFile(e);
          if (!ok) continue;
          onProgress({
            processedBytes,
            totalBytes,
            currentItem: e.name,
            topItemName: labelName,
            topItemFilesProcessed: i + 1,
            topItemFilesTotal: itemTotal,
          });
        }
      }
    }

    // --- PER-ITEM: common folders ---
    if (!cancelled && bucketFiles.common.length > 0) {
      const byItem = new Map();
      const itemOrder = [];
      for (const e of bucketFiles.common) {
        const parts = e.name.split('/');
        const rawTopName = parts[1] || '';
        if (!rawTopName) continue;
        if (!byItem.has(rawTopName)) {
          byItem.set(rawTopName, []);
          itemOrder.push(rawTopName);
        }
        byItem.get(rawTopName).push(e);
      }
      for (const itemName of itemOrder) {
        if (cancelled) break;
        const files = byItem.get(itemName);
        const itemTotal = files.length;
        // commons are uuid-keyed; use the friendly name from meta.json
        // for the label so the user sees the folder's display name.
        const friendlyItemName = friendlyTopName('common', itemName);
        const labelName = `${friendlyItemName} Files`;
        for (let i = 0; i < itemTotal; i++) {
          if (cancelled) break;
          const e = files[i];
          const ok = await extractFile(e);
          if (!ok) continue;
          onProgress({
            processedBytes,
            totalBytes,
            currentItem: friendlyZipPath(e.name),
            topItemName: labelName,
            topItemFilesProcessed: i + 1,
            topItemFilesTotal: itemTotal,
          });
        }
      }
    }

    // --- AGGREGATE: shared tracks ---
    if (!cancelled && bucketFiles.sharedTracks.length > 0) {
      const totalInBucket = bucketFiles.sharedTracks.length;
      for (let i = 0; i < totalInBucket; i++) {
        if (cancelled) break;
        const e = bucketFiles.sharedTracks[i];
        const ok = await extractFile(e);
        if (!ok) continue;
        onProgress({
          processedBytes,
          totalBytes,
          currentItem: e.name,
          topItemName: 'Shared Tracks',
          topItemFilesProcessed: i + 1,
          topItemFilesTotal: totalInBucket,
        });
      }
    }

    if (cancelled) {
      throw Object.assign(new Error('Cancelled'), { cancelled: true });
    }
  } catch (err) {
    // Rollback. Move reused items + reused per-file moves back to the
    // snapshot first so the snapshot is whole again, then nuke fresh
    // and rename snapshot back.
    for (const r of reusedItems) {
      try { fs.renameSync(r.freshAbs, r.snapshotAbs); } catch {}
    }
    for (const r of reusedFiles) {
      try { fs.renameSync(r.freshAbs, r.snapshotAbs); } catch {}
    }
    try { fs.rmSync(sfRoot, { recursive: true, force: true }); } catch {}
    if (hadOriginal) {
      try { fs.renameSync(snapshotPath, sfRoot); } catch {}
    }
    try { await zip.close(); } catch {}
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
    throw err;
  } finally {
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
  }
  try { await zip.close(); } catch {}

  // Success — discard the snapshot. Best-effort: if the rm fails the user
  // still has a working library, just a leftover backup dir to clean up
  // manually.
  if (hadOriginal) {
    try { fs.rmSync(snapshotPath, { recursive: true, force: true }); } catch {}
  }

  // Tally what landed in the fresh library so the renderer's completion
  // modal can stamp "Restored N sources, M fonts, P common folders." The
  // bucket dirs are authoritative — counts whatever's actually on disk
  // post-restore, which includes reused items moved from the snapshot.
  const counts = { sources: 0, library: 0, common: 0, sharedTracks: 0 };
  for (const bucket of ['sources', 'library', 'common']) {
    try {
      const d = fs.readdirSync(path.join(sfRoot, bucket), { withFileTypes: true });
      counts[bucket] = d.filter(x => x.isDirectory()).length;
    } catch {}
  }
  try {
    const d = fs.readdirSync(path.join(sfRoot, 'sharedTracks'), { withFileTypes: true });
    counts.sharedTracks = d.filter(x => x.isFile() && /\.wav$/i.test(x.name)).length;
  } catch {}

  return { manifest, counts };
}

// Survey both the backup zip and the current library to classify every
// item into one of four buckets per category:
//   identical  — content match, no prompt, no write
//   conflict   — same identity, content or curated meta differs, needs choice
//   add        — in backup, not in current; added silently on merge apply
//   currentOnly — in current, not in backup; Replace would wipe, Merge keeps
//
// Identity per category — what makes two items "the same item":
//   sources — uuid (the dir name under sources/)
//   library — entryUuid (primary) or sourceUuid+candidatePath (legacy fallback)
//   common  — uuid (the dir name under common/)
//
// Content match per category uses the canonical-tree hash from
// manifest.contentHashes against the live on-disk hash via
// getXContentHash. The live side reads stored meta.contentHash when the
// cheap-signal safety net (contentFileCount + contentTotalBytes) passes,
// so most items short-circuit without re-walking the tree. Both sides
// exclude the item-root meta.json so a pure rename/tag-edit doesn't
// register as a content diff.
//
// sharedTracks aren't classified per-item (flat bucket of audio files,
// no curated meta) but the survey returns counts on both sides so the
// renderer's "Library matches backup" detection can see a delta there
// even when the three named buckets are all-identical.
async function surveyMerge({ userData, zipPath }) {
  if (!zipPath) throw new Error('Missing zipPath');
  if (!userData) throw new Error('Missing userData');
  _ensureLibraryBackfill(userData);

  const StreamZip = require('node-stream-zip');
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  } catch (err) {
    throw new Error(`Could not open backup zip: ${err.message}`);
  }
  // Hash the on-disk item lazily so a Replace-import that needs the
  // identical decision can compare against manifest.contentHashes when
  // present. Cached so repeated calls (e.g. one per bucket) only walk
  // the tree once per item.
  //
  // All three buckets (sources, library, common) route through their
  // persistent-hash helpers (getXContentHash). Each reads stored
  // meta.contentHash when the cheap-signal safety net
  // (contentFileCount + contentTotalBytes match current on-disk state)
  // passes; otherwise it recomputes and persists. Steady state: every
  // item short-circuits to a stat-walk, no byte reading. sharedTracks
  // and any future bucket fall through to direct hashItemDir.
  const { hashItemDir } = require('./soundFontFileHash');
  const sfEntriesMod = require('./soundFontEntries');
  const sfCommonMod = require('./soundFontCommon');
  const sfSourcesMod = require('./soundFontSources');
  const sfRoot = _soundFontsRoot(userData);
  const liveHashCache = new Map(); // "bucket/id" → hex or null
  const liveHashOf = (bucket, id) => {
    const k = `${bucket}/${id}`;
    if (liveHashCache.has(k)) return liveHashCache.get(k);
    let h = null;
    if (bucket === 'library') h = sfEntriesMod.getEntryContentHash(userData, id);
    else if (bucket === 'common') h = sfCommonMod.getCommonContentHash(userData, id);
    else if (bucket === 'sources') h = sfSourcesMod.getSourceContentHash(userData, id);
    else h = hashItemDir(path.join(sfRoot, bucket, id));
    liveHashCache.set(k, h);
    return h;
  };
  try {
    const entries = await zip.entries();
    // Manifest content hashes when present — drives the strict
    // identical check for library/common (and overrides the source
    // meta.hash for sources too, since the canonical-tree hash
    // catches local edits the import-time stream hash cannot).
    let manifestHashes = null;
    try {
      const mbuf = await zip.entryData('manifest.json');
      const m = JSON.parse(mbuf.toString('utf8'));
      if (m && m.contentHashes) manifestHashes = m.contentHashes;
    } catch {}

    // Build per-bucket per-top-dir aggregates from the zip's entry list.
    // Library entries are keyed by their on-disk dir name (which is also
    // the zip's dir name); the identity key (sourceUuid + candidatePath)
    // gets populated from each entry's meta.json in a second pass below.
    const zipSources = new Map(); // uuid -> { fileCount, totalBytes, hash, name }
    const zipLibrary = new Map(); // dirName -> { fileCount, totalBytes, identity, ...curatedFields }
    const zipCommon  = new Map(); // uuid -> { fileCount, totalBytes, displayName }

    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.name || e.name === '/' || e.name === 'manifest.json') continue;
      const parts = e.name.split('/');
      if (parts.length < 2) continue;
      const bucket = parts[0];
      const id = parts[1];
      if (!id) continue;
      const isFile = !e.isDirectory;
      const size = e.size || 0;
      // Exclude per-item meta.json from content counts — it's metadata,
      // not sound content, and its bytes shift on every rename/tag edit.
      // Including it would let a pure rename fail the contentSame check by
      // a few-bytes delta and falsely register as a content conflict.
      const isItemMeta = parts.length === 3 && parts[2] === 'meta.json';
      if (bucket === 'sources') {
        if (!zipSources.has(id)) zipSources.set(id, { fileCount: 0, totalBytes: 0, hash: null, name: null });
        const agg = zipSources.get(id);
        if (isFile && !isItemMeta) { agg.fileCount++; agg.totalBytes += size; }
      } else if (bucket === 'library') {
        if (!zipLibrary.has(id)) zipLibrary.set(id, { fileCount: 0, totalBytes: 0, identity: null, name: id, meta: {} });
        const agg = zipLibrary.get(id);
        if (isFile && !isItemMeta) { agg.fileCount++; agg.totalBytes += size; }
      } else if (bucket === 'common') {
        if (!zipCommon.has(id)) zipCommon.set(id, { fileCount: 0, totalBytes: 0, displayName: null });
        const agg = zipCommon.get(id);
        if (isFile && !isItemMeta) { agg.fileCount++; agg.totalBytes += size; }
      }
    }

    // Pull source meta from each source's meta.json — needed for the
    // content hash. Source meta uses the field name `hash` (computed at
    // import time, see soundFontSources.js: hash.digest('hex')); do not
    // rename to `contentHash` here.
    for (const uuid of zipSources.keys()) {
      const metaPath = `sources/${uuid}/meta.json`;
      if (!entries[metaPath]) continue;
      try {
        const buf = await zip.entryData(metaPath);
        const meta = JSON.parse(buf.toString('utf8'));
        const agg = zipSources.get(uuid);
        agg.hash = meta.hash || null;
        agg.name = meta.bundleName || meta.originalName || uuid;
      } catch {}
    }

    // Pull common meta names for display.
    for (const uuid of zipCommon.keys()) {
      const metaPath = `common/${uuid}/meta.json`;
      if (!entries[metaPath]) continue;
      try {
        const buf = await zip.entryData(metaPath);
        const meta = JSON.parse(buf.toString('utf8'));
        zipCommon.get(uuid).displayName = meta.name || uuid;
      } catch {}
    }

    // User-curated meta fields for library entries. Drives the diff
    // detection in classifyLibrary — anything in this list that differs
    // between backup and current surfaces as a meta conflict. Excludes
    // identity (sourceUuid + candidatePath), system fields (createdAt,
    // updatedAt), and content fields (fileCount, totalBytes covered by
    // contentDiffers separately). Labels are the UI display strings.
    const LIBRARY_META_FIELDS = [
      { key: 'name',                    label: 'name' },
      { key: 'tags',                    label: 'tags',                normalize: (v) => Array.isArray(v) ? [...v].sort() : [] },
      { key: 'description',             label: 'description',         normalize: (v) => v || '' },
      { key: 'demoUrl',                 label: 'demo URL',            normalize: (v) => v || '' },
      { key: 'linkedStyleLibraryEntry', label: 'linked style',        normalize: (v) => v || '' },
      { key: 'purchased',               label: 'purchased flag',      normalize: (v) => !!v },
      { key: 'author',                  label: 'author',              normalize: (v) => v || '' },
      { key: 'acquisitionDate',         label: 'acquisition date',    normalize: (v) => v || '' },
      { key: 'userNotes',               label: 'notes',               normalize: (v) => v || '' },
    ];
    // Two-tier identity:
    //   primary: entryUuid (uuid per library folder, generated at
    //            create/duplicate; legacy entries get a uuid backfilled
    //            by soundFontEntries._readEntryMeta on first read).
    //   legacy:  sourceUuid|candidatePath (provenance pair). Used as
    //            a fallback so backups taken before entryUuid existed
    //            still match against the current library.
    // A library entry can have both. Duplicates from the same source
    // share `legacy` but have distinct `primary`, which is exactly the
    // case the merge classifier needs to disambiguate.
    const readLibraryMeta = (meta, fallbackName) => {
      const out = { identity: null, legacyIdentity: null, name: fallbackName, fields: {} };
      out.identity = meta.entryUuid || null;
      const su = meta.sourceUuid || '';
      const cp = meta.candidatePath || '';
      out.legacyIdentity = (su || cp) ? `${su}|${cp}` : null;
      out.name = meta.name || fallbackName;
      for (const f of LIBRARY_META_FIELDS) {
        const raw = meta[f.key];
        out.fields[f.key] = f.normalize ? f.normalize(raw) : raw;
      }
      return out;
    };

    // Pull library entry meta from the zip — identity (survives renames)
    // plus every user-curated field for diff detection.
    for (const dirName of zipLibrary.keys()) {
      const metaPath = `library/${dirName}/meta.json`;
      if (!entries[metaPath]) continue;
      try {
        const buf = await zip.entryData(metaPath);
        const meta = JSON.parse(buf.toString('utf8'));
        const parsed = readLibraryMeta(meta, dirName);
        const agg = zipLibrary.get(dirName);
        agg.identity = parsed.identity;
        agg.legacyIdentity = parsed.legacyIdentity;
        agg.name = parsed.name;
        agg.meta = parsed.fields;
      } catch {}
    }

    // Now read the current library off disk in the same shape.
    const curSources = new Map();
    const curLibrary = new Map();
    const curCommon  = new Map();
    const sfRoot = _soundFontsRoot(userData);

    const readBucket = (bucketName, target, getMeta) => {
      const root = path.join(sfRoot, bucketName);
      if (!fs.existsSync(root)) return;
      let dirs;
      try { dirs = fs.readdirSync(root, { withFileTypes: true }); }
      catch { return; }
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const dirPath = path.join(root, d.name);
        let fileCount = 0, totalBytes = 0;
        // Same meta.json exclusion as the zip-side aggregation — the
        // item-root meta.json is metadata, not content. Including it
        // would let a pure local rename slip a few-bytes delta into the
        // contentSame check and falsely register as a content conflict.
        const walk = (cur) => {
          let items;
          try { items = fs.readdirSync(cur, { withFileTypes: true }); }
          catch { return; }
          for (const it of items) {
            const ap = path.join(cur, it.name);
            if (it.isDirectory()) walk(ap);
            else if (it.isFile()) {
              if (cur === dirPath && it.name === 'meta.json') continue;
              fileCount++;
              try { totalBytes += fs.statSync(ap).size; } catch {}
            }
          }
        };
        walk(dirPath);
        const extra = getMeta ? getMeta(dirPath) : {};
        target.set(d.name, { fileCount, totalBytes, ...extra });
      }
    };
    readBucket('sources', curSources, (dirPath) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dirPath, 'meta.json'), 'utf8'));
        return { hash: meta.hash || null, name: meta.bundleName || meta.originalName || '' };
      } catch { return { hash: null, name: '' }; }
    });
    readBucket('library', curLibrary, (dirPath) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dirPath, 'meta.json'), 'utf8'));
        const parsed = readLibraryMeta(meta, '');
        return {
          identity: parsed.identity,
          legacyIdentity: parsed.legacyIdentity,
          name: parsed.name,
          meta: parsed.fields,
        };
      } catch { return { identity: null, legacyIdentity: null, name: '', meta: {} }; }
    });
    readBucket('common', curCommon, (dirPath) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dirPath, 'meta.json'), 'utf8'));
        return { displayName: meta.name || '' };
      } catch { return { displayName: '' }; }
    });

    // Classify each backup item per category. The "identical" rule per
    // bucket prefers manifest.contentHashes when present (catches any
    // byte-level diff: file edit, rename, empty-folder add/remove),
    // and falls through to the legacy proxy when absent for backward
    // compat with older backup files.
    const sourceManifestHashes = (manifestHashes && manifestHashes.sources) || null;
    const classifySources = () => {
      const out = { identical: [], conflict: [], add: [], currentOnly: [] };
      const matched = new Set();
      for (const [uuid, z] of zipSources) {
        const c = curSources.get(uuid);
        if (!c) { out.add.push({ id: uuid, name: z.name || uuid, fileCount: z.fileCount, totalBytes: z.totalBytes }); continue; }
        matched.add(uuid);
        // Canonical-tree hash from the manifest vs the current on-disk
        // tree hash. Catches local edits to a source (trim, file removal)
        // that the import-time stream hash can't.
        const identical = !!(sourceManifestHashes && sourceManifestHashes[uuid]
          && sourceManifestHashes[uuid] === liveHashOf('sources', uuid));
        if (identical) {
          out.identical.push({ id: uuid, name: z.name || uuid });
        } else {
          // Source conflict always means content differs (sources don't
          // carry user-curated meta the user typically edits, so meta-
          // only conflicts aren't a thing here).
          out.conflict.push({
            id: uuid,
            name: z.name || uuid,
            contentDiffers: true,
            metaDiffers: false,
            backup: { fileCount: z.fileCount, totalBytes: z.totalBytes },
            current: { fileCount: c.fileCount, totalBytes: c.totalBytes, name: c.name },
          });
        }
      }
      // currentOnly — sources in the live library that aren't in the
      // backup at all. Drives the Replace-vs-Merge choice modal's
      // "would be removed" tally so the user sees the destructive
      // consequence before committing.
      for (const [uuid, c] of curSources) {
        if (matched.has(uuid)) continue;
        out.currentOnly.push({ id: uuid, name: c.name || uuid, fileCount: c.fileCount, totalBytes: c.totalBytes });
      }
      return out;
    };

    // Library: identity-based matching so local renames are detected as
    // the same item. Conflict info splits content-diff from meta-diff and
    // includes a list of which specific meta fields differ so the UI can
    // tell the user "Sound files identical, only metadata differs:
    // acquisition date, tags" instead of a generic "metadata differs."
    const libraryManifestHashes = (manifestHashes && manifestHashes.library) || null;
    const classifyLibrary = () => {
      const out = { identical: [], conflict: [], add: [], currentOnly: [] };
      const matchedDirs = new Set();
      // Primary identity (entryUuid) is unique per library folder, so a
      // single-value lookup is unambiguous. Legacy identity
      // (sourceUuid|candidatePath) is shared by duplicates, so its
      // lookup is multi-valued: the matcher prefers the candidate
      // whose dir name also matches the backup before falling through
      // to first-found.
      const curByEntryUuid = new Map();
      const curByLegacy = new Map();
      for (const [dirName, c] of curLibrary) {
        if (c.identity) curByEntryUuid.set(c.identity, dirName);
        if (c.legacyIdentity) {
          if (!curByLegacy.has(c.legacyIdentity)) curByLegacy.set(c.legacyIdentity, []);
          curByLegacy.get(c.legacyIdentity).push(dirName);
        }
      }
      const eq = (a, b) => {
        if (Array.isArray(a) && Array.isArray(b)) {
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
          return true;
        }
        return a === b;
      };
      const computeMetaDiff = (z, c) => {
        const labels = [];
        const details = [];
        for (const f of LIBRARY_META_FIELDS) {
          const zv = z.meta?.[f.key];
          const cv = c.meta?.[f.key];
          if (!eq(zv, cv)) {
            labels.push(f.label);
            // Carry raw values through so the renderer can show a real
            // side-by-side comparison (the user has to see what changed,
            // not just that something did).
            details.push({ key: f.key, label: f.label, backup: zv, current: cv });
          }
        }
        return { labels, details };
      };
      for (const [backupDirName, z] of zipLibrary) {
        let curDirName = null;
        // Priority order:
        //   1. entryUuid (primary identity): unique per library folder,
        //      so this is a clean 1-to-1 match across renames AND
        //      duplicates.
        //   2. sourceUuid|candidatePath (legacy identity): for backups
        //      taken before entryUuid existed. Multi-valued because
        //      duplicates share this key; prefer the dir-name match,
        //      fall through to first.
        //   3. Bare dir-name match: last-resort fallback for entries
        //      that pre-date even the legacy identity.
        if (z.identity && curByEntryUuid.has(z.identity)) {
          curDirName = curByEntryUuid.get(z.identity);
        }
        if (!curDirName && z.legacyIdentity && curByLegacy.has(z.legacyIdentity)) {
          const candidates = curByLegacy.get(z.legacyIdentity);
          curDirName = candidates.find(n => n === backupDirName) || candidates[0];
        }
        if (!curDirName && curLibrary.has(backupDirName)) {
          curDirName = backupDirName;
        }
        if (!curDirName) {
          out.add.push({ id: backupDirName, name: z.name || backupDirName, fileCount: z.fileCount, totalBytes: z.totalBytes });
          continue;
        }
        matchedDirs.add(curDirName);
        const c = curLibrary.get(curDirName);
        // Canonical-tree hash from the manifest vs the current on-disk
        // tree hash. The manifest key is the BACKUP-time dir name
        // (curDirName may have been locally renamed by the user);
        // content identity ignores the name and is what we're checking
        // here.
        const contentDiffers = !(libraryManifestHashes
          && libraryManifestHashes[backupDirName]
          && libraryManifestHashes[backupDirName] === liveHashOf('library', curDirName));
        const { labels: diffFields, details: diffDetails } = computeMetaDiff(z, c);
        const metaDiffers = diffFields.length > 0;
        if (!contentDiffers && !metaDiffers) {
          out.identical.push({ id: backupDirName, name: z.name || backupDirName });
        } else {
          out.conflict.push({
            id: backupDirName,
            name: z.name || backupDirName,
            contentDiffers,
            metaDiffers,
            diffFields,
            diffDetails,
            backup: { fileCount: z.fileCount, totalBytes: z.totalBytes, name: z.name || backupDirName },
            current: { fileCount: c.fileCount, totalBytes: c.totalBytes, name: c.name || curDirName, dirName: curDirName },
          });
        }
      }
      // currentOnly — library entries in the live library that aren't
      // present in the backup. Drives Replace's "would be removed" tally.
      for (const [dirName, c] of curLibrary) {
        if (matchedDirs.has(dirName)) continue;
        out.currentOnly.push({ id: dirName, name: c.name || dirName, fileCount: c.fileCount, totalBytes: c.totalBytes });
      }
      return out;
    };

    // Common: uuid-based identity. Same content/meta split as library so
    // the UI can show a meta-only diff (local rename) distinctly from a
    // file-content diff.
    const commonManifestHashes = (manifestHashes && manifestHashes.common) || null;
    const classifyCommon = () => {
      const out = { identical: [], conflict: [], add: [], currentOnly: [] };
      const matched = new Set();
      for (const [uuid, z] of zipCommon) {
        const c = curCommon.get(uuid);
        const zName = z.displayName || uuid;
        if (!c) { out.add.push({ id: uuid, name: zName, fileCount: z.fileCount, totalBytes: z.totalBytes }); continue; }
        matched.add(uuid);
        const cName = c.displayName || uuid;
        // Canonical-tree hash from the manifest vs the current on-disk
        // tree hash.
        const contentDiffers = !(commonManifestHashes
          && commonManifestHashes[uuid]
          && commonManifestHashes[uuid] === liveHashOf('common', uuid));
        const metaDiffers = cName !== zName;
        if (!contentDiffers && !metaDiffers) {
          out.identical.push({ id: uuid, name: zName });
        } else {
          out.conflict.push({
            id: uuid,
            name: zName,
            contentDiffers,
            metaDiffers,
            backup: { fileCount: z.fileCount, totalBytes: z.totalBytes },
            current: { fileCount: c.fileCount, totalBytes: c.totalBytes, name: cName },
          });
        }
      }
      // currentOnly — commons in the live library that aren't in the
      // backup. Drives Replace's "would be removed" tally.
      for (const [uuid, c] of curCommon) {
        if (matched.has(uuid)) continue;
        out.currentOnly.push({ id: uuid, name: c.displayName || uuid, fileCount: c.fileCount, totalBytes: c.totalBytes });
      }
      return out;
    };

    // SharedTracks aren't part of the per-item conflict/add classification
    // (they're a flat bucket of audio files, not user-curated entities)
    // but the choice modal needs to know if backup vs current differ so
    // "Library matches backup" can be honest about whether Replace would
    // be a true no-op. Count alone is the cheap signal — a sharedTracks
    // delta forces the "not identical" path even when sources/library/
    // common all match.
    let zipSharedTracksCount = 0;
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.name) continue;
      const parts = e.name.split('/');
      if (parts[0] !== 'sharedTracks') continue;
      if (e.isDirectory) continue;
      if (parts.length === 2 && /\.wav$/i.test(parts[1])) zipSharedTracksCount++;
    }
    let curSharedTracksCount = 0;
    try {
      const stRoot = path.join(_soundFontsRoot(userData), 'sharedTracks');
      if (fs.existsSync(stRoot)) {
        for (const f of fs.readdirSync(stRoot, { withFileTypes: true })) {
          if (f.isFile() && /\.wav$/i.test(f.name)) curSharedTracksCount++;
        }
      }
    } catch {}
    return {
      ok: true,
      sources: classifySources(),
      library: classifyLibrary(),
      common:  classifyCommon(),
      sharedTracks: { backup: zipSharedTracksCount, current: curSharedTracksCount },
    };
  } finally {
    try { await zip.close(); } catch {}
  }
}

// Merge-import: extract only the items the user opted into, leaving the
// rest of the current library untouched. Each item is processed in
// isolation with its own per-item rollback log so a mid-run cancel
// undoes just the writes from this run, leaving items the user already
// committed to in their original-or-replaced state.
//
// plan shape (per category, keyed by identifier):
//   sources: { uuid: 'install' | 'keep' | 'replace' }
//   library: { name: 'install' | 'keep' | 'replace' | 'both' }
//   common:  { uuid: 'install' | 'keep' | 'replace' }
// Items missing from the plan are left alone (covers "current items not
// in backup" and "identical items survey caller chose to skip silently").
//
// Per-item semantics:
//   install — backup-only item, no current version exists; extract fresh
//   keep    — collision exists, user wants to keep current; no-op
//   replace — collision exists, user wants the backup's version; snapshot
//             current to <name>.preimport-bak-<ts>/, extract backup, on
//             success delete the snapshot, on cancel/error restore it.
//             For library, the current dir name may differ from the backup
//             name (identity match across a local rename), so the caller
//             passes currentName explicitly so the right dir is replaced.
//   both    — library only; extract backup version. Rename to "<name> (N)"
//             only if the backup name would collide with something already
//             on disk; if it's free (e.g. user renamed locally), just use
//             the backup name as-is.
async function applyMerge({
  userData,
  zipPath,
  plan = { sources: {}, library: {}, common: {} },
  onProgress = () => {},
  signal = null,
}) {
  if (!zipPath) throw new Error('Missing zipPath');
  if (!userData) throw new Error('Missing userData');
  const sfRoot = _soundFontsRoot(userData);
  // Ensure all bucket roots exist so per-item extracts can write
  // without re-creating the parent every time.
  for (const b of ['sources', 'library', 'common']) {
    try { fs.mkdirSync(path.join(sfRoot, b), { recursive: true }); } catch {}
  }

  const StreamZip = require('node-stream-zip');
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  } catch (err) {
    throw new Error(`Could not open backup zip: ${err.message}`);
  }

  let cancelled = false;
  const onAbort = () => { cancelled = true; };
  if (signal) {
    if (signal.aborted) cancelled = true;
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  // Rollback log — each entry knows how to undo itself. Order matters on
  // rollback (LIFO) so a snapshot rename comes back AFTER its sibling
  // partial-write is removed.
  const rollbackLog = [];
  const rollbackAll = () => {
    while (rollbackLog.length > 0) {
      const op = rollbackLog.pop();
      try { op(); } catch {}
    }
  };

  // Build the work list — { bucket, id, mode, currentName, itemBytes }
  // per item. Plan values are either a string mode (sources / common) or
  // an object { mode, currentName } (library, since the current on-disk
  // name may differ from the backup id when an identity match crosses a
  // local rename).
  const entries = await zip.entries();
  const work = [];
  let totalBytes = 0;
  const buckets = { sources: 'sources', library: 'library', common: 'common' };
  for (const cat of Object.keys(buckets)) {
    const bucket = buckets[cat];
    const decisions = plan[cat] || {};
    for (const id of Object.keys(decisions)) {
      const raw = decisions[id];
      const mode = typeof raw === 'string' ? raw : (raw && raw.mode);
      const currentName = typeof raw === 'object' && raw ? (raw.currentName || id) : id;
      const customName = typeof raw === 'object' && raw ? (raw.customName || '') : '';
      if (!mode || mode === 'keep') continue;
      // Sum bytes for this top-level subdir within the zip.
      let itemBytes = 0;
      const prefix = `${bucket}/${id}/`;
      for (const key of Object.keys(entries)) {
        if (!key.startsWith(prefix)) continue;
        const e = entries[key];
        if (!e.isDirectory) itemBytes += (e.size || 0);
      }
      work.push({ bucket, id, mode, currentName, customName, itemBytes });
      totalBytes += itemBytes;
    }
  }

  let processedBytes = 0;

  // Per-bucket / per-mode tallies feed the renderer's completion-modal
  // summary so the user sees what actually changed instead of a generic
  // "Merge complete." line. The plan's "keep" decisions don't reach this
  // loop (filtered to work[] above), but we still count them from the
  // plan itself so the summary can mention "N kept yours" when the user
  // resolved conflicts conservatively.
  const counts = {
    sources: { added: 0, replaced: 0, keptBoth: 0, keptYours: 0 },
    library: { added: 0, replaced: 0, keptBoth: 0, keptYours: 0 },
    common:  { added: 0, replaced: 0, keptBoth: 0, keptYours: 0 },
    sharedTracks: { added: 0 },
  };
  for (const cat of Object.keys(counts)) {
    if (cat === 'sharedTracks') continue;
    const decisions = plan[cat] || {};
    for (const id of Object.keys(decisions)) {
      const raw = decisions[id];
      const mode = typeof raw === 'string' ? raw : (raw && raw.mode);
      if (mode === 'keep') counts[cat].keptYours++;
    }
  }

  // Group user-chosen work items by bucket for the phased extract
  // below. Each bucket's progress is labelled per the user's mental
  // unit — sources/sharedTracks aggregate ("Source Files X of Y"),
  // library/common per-item ("Ahsoka Files X of Y").
  const workByBucket = { sources: [], library: [], common: [] };
  for (const w of work) {
    if (workByBucket[w.bucket]) workByBucket[w.bucket].push(w);
  }

  // Friendly-name maps for the two uuid-keyed buckets so the user-facing
  // progress lines don't leak raw uuids. Sources and commons live under
  // uuid dirs both in the zip and on disk; library is already name-keyed.
  // Only build entries for items the user actually selected work for,
  // since the maps are progress-only — no need to pay the meta.json
  // reads for items being skipped.
  const sourceNameByUuid = new Map();
  const commonNameByUuid = new Map();
  for (const w of workByBucket.sources) {
    try {
      const buf = await zip.entryData(`sources/${w.id}/meta.json`);
      const m = JSON.parse(buf.toString('utf8'));
      const friendly = (m && (m.bundleName || m.originalName)) || '';
      if (friendly) sourceNameByUuid.set(w.id, String(friendly).replace(/\.zip$/i, ''));
    } catch {}
  }
  for (const w of workByBucket.common) {
    try {
      const buf = await zip.entryData(`common/${w.id}/meta.json`);
      const m = JSON.parse(buf.toString('utf8'));
      if (m && m.name) commonNameByUuid.set(w.id, m.name);
    } catch {}
  }
  // Translate a zip entry path so users see friendly names instead of
  // raw uuids — same shape as applyReplace's helper.
  const friendlyZipPath = (zipName) => {
    const parts = String(zipName || '').split('/');
    if (parts[0] === 'sources' && parts[1] && sourceNameByUuid.has(parts[1])) {
      return `sources/${sourceNameByUuid.get(parts[1])}/${parts.slice(2).join('/')}`;
    }
    if (parts[0] === 'common' && parts[1] && commonNameByUuid.has(parts[1])) {
      return `common/${commonNameByUuid.get(parts[1])}/${parts.slice(2).join('/')}`;
    }
    return zipName;
  };

  // Pre-count tracks the sharedTracks evaluation will walk through.
  // Counter advances per evaluation step (extract or skip-as-already-
  // present) so the user sees motion through the whole bucket.
  let sharedTracksEvalTotal = 0;
  for (const key of Object.keys(entries)) {
    if (!key.startsWith('sharedTracks/')) continue;
    const e = entries[key];
    if (!e.isDirectory && /\.wav$/i.test(e.name)) sharedTracksEvalTotal++;
  }

  // Extract every file under a zip prefix into a target dir on disk.
  // Validates path-escape per entry. The onFile callback fires per
  // extracted file so the caller can emit bucket-specific progress
  // (aggregate vs per-item) without the helper knowing about labels.
  const extractPrefix = async (prefix, targetDir, onFile) => {
    fs.mkdirSync(targetDir, { recursive: true });
    // First pass — mkdir all dir entries; collect file entries.
    const fileEntries = [];
    for (const key of Object.keys(entries)) {
      if (!key.startsWith(prefix)) continue;
      const e = entries[key];
      if (e.name === prefix) continue;
      const relUnderTop = e.name.substring(prefix.length);
      if (!relUnderTop) continue;
      const target = path.resolve(targetDir, relUnderTop);
      if (!target.startsWith(path.resolve(targetDir) + path.sep) && target !== path.resolve(targetDir)) continue;
      if (e.isDirectory) {
        try { fs.mkdirSync(target, { recursive: true }); } catch {}
        continue;
      }
      fileEntries.push({ entry: e, target });
    }
    for (let i = 0; i < fileEntries.length; i++) {
      if (cancelled) return;
      const { entry: e, target } = fileEntries[i];
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
      try {
        await zip.extract(e.name, target);
        processedBytes += (e.size || 0);
        if (onFile) onFile({ fileIdx: i + 1, fileTotal: fileEntries.length, fileName: e.name });
      } catch (err) {
        throw new Error(`Failed extracting ${e.name}: ${err && err.message || err}`);
      }
    }
  };

  // Process one work item's install/replace/both mode, invoking
  // onFile per extracted file. The mode-specific snapshot/rename
  // logic stays in place; only the progress emit shape moves to the
  // caller.
  const processWorkItem = async (w, onFile) => {
    const bucketRoot = path.join(sfRoot, w.bucket);
    if (w.mode === 'install') {
      const target = path.join(bucketRoot, w.id);
      if (fs.existsSync(target)) return;
      await extractPrefix(`${w.bucket}/${w.id}/`, target, onFile);
      rollbackLog.push(() => { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} });
      if (counts[w.bucket]) counts[w.bucket].added++;
    } else if (w.mode === 'replace') {
      const currentDir = path.join(bucketRoot, w.currentName);
      const target = path.join(bucketRoot, w.id);
      const snap = `${currentDir}.preimport-bak-${Date.now()}`;
      const hadOriginal = fs.existsSync(currentDir);
      if (hadOriginal) {
        try { fs.renameSync(currentDir, snap); }
        catch (err) { throw new Error(`Snapshot failed for ${w.currentName}: ${err.message}`); }
      }
      rollbackLog.push(() => {
        try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
        if (hadOriginal) { try { fs.renameSync(snap, currentDir); } catch {} }
      });
      await extractPrefix(`${w.bucket}/${w.id}/`, target, onFile);
      if (hadOriginal) {
        try { fs.rmSync(snap, { recursive: true, force: true }); } catch {}
      }
      rollbackLog[rollbackLog.length - 1] = () => {};
      if (counts[w.bucket]) counts[w.bucket].replaced++;
    } else if (w.mode === 'both') {
      // Library only — keep the current alongside the backup version.
      const sanitize = (s) => String(s || '').trim()
        .replace(/\s+/g, '_')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .slice(0, 200);
      const userPick = sanitize(w.customName);
      let chosenName;
      if (userPick && !fs.existsSync(path.join(bucketRoot, userPick))) {
        chosenName = userPick;
      } else {
        chosenName = w.id;
        let n = 0;
        while (fs.existsSync(path.join(bucketRoot, chosenName))) {
          n++;
          chosenName = `${w.id}_${n}`;
        }
      }
      const target = path.join(bucketRoot, chosenName);
      await extractPrefix(`${w.bucket}/${w.id}/`, target, onFile);
      rollbackLog.push(() => { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} });
      if (w.bucket === 'library' && chosenName !== w.id) {
        const metaPath = path.join(target, 'meta.json');
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          meta.name = chosenName;
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        } catch {}
      }
      if (counts[w.bucket]) counts[w.bucket].keptBoth++;
    }
  };

  // Emit one progress event indicating a bucket had nothing to do
  // (all items confirmed-matching), then briefly hold so the user
  // sees the message before the next phase overwrites it.
  const emitBucketSkip = async (label) => {
    onProgress({
      processedBytes,
      totalBytes,
      currentItem: 'all already in your library',
      topItemName: label,
      topItemFilesProcessed: 0,
      topItemFilesTotal: 0,
    });
    await new Promise(r => setTimeout(r, 800));
  };

  try {
    // PHASE 1 — sources (aggregate). Counter unit is source archives
    // (each work item = one source). Files within each source flash by
    // in currentItem; the counter advances when crossing to the next
    // source.
    if (!cancelled) {
      const items = workByBucket.sources;
      if (items.length === 0) {
        await emitBucketSkip('Source Files');
      } else {
        for (let i = 0; i < items.length; i++) {
          if (cancelled) break;
          const w = items[i];
          await processWorkItem(w, ({ fileName }) => {
            onProgress({
              processedBytes,
              totalBytes,
              currentItem: friendlyZipPath(fileName),
              topItemName: 'Source Files',
              topItemFilesProcessed: i + 1,
              topItemFilesTotal: items.length,
            });
          });
        }
      }
    }

    // PHASE 2 — library (per-item). Each font is its own scope, label
    // flips to the font name with files within it counted out.
    if (!cancelled) {
      const items = workByBucket.library;
      if (items.length === 0) {
        await emitBucketSkip('Fonts');
      } else {
        for (const w of items) {
          if (cancelled) break;
          // Library is name-keyed in the zip; w.id is already the friendly name.
          const labelName = `${w.id} Files`;
          await processWorkItem(w, ({ fileIdx, fileTotal, fileName }) => {
            onProgress({
              processedBytes,
              totalBytes,
              currentItem: fileName,
              topItemName: labelName,
              topItemFilesProcessed: fileIdx,
              topItemFilesTotal: fileTotal,
            });
          });
        }
      }
    }

    // PHASE 3 — common folders (per-item). Same shape as library, but
    // commons are uuid-keyed both in the zip and on disk, so the label
    // and the per-file path both need the friendly-name translation.
    if (!cancelled) {
      const items = workByBucket.common;
      if (items.length === 0) {
        await emitBucketSkip('Common Folders');
      } else {
        for (const w of items) {
          if (cancelled) break;
          const friendlyName = commonNameByUuid.get(w.id) || w.id;
          const labelName = `${friendlyName} Files`;
          await processWorkItem(w, ({ fileIdx, fileTotal, fileName }) => {
            onProgress({
              processedBytes,
              totalBytes,
              currentItem: friendlyZipPath(fileName),
              topItemName: labelName,
              topItemFilesProcessed: fileIdx,
              topItemFilesTotal: fileTotal,
            });
          });
        }
      }
    }

    // Shared Tracks — flat folder, no per-item prompts. Rules per
    // user spec, hash-aware:
    //   1. Backup record's content (hash) already exists locally under
    //      any filename  → skip (we already have the content)
    //   2. Local has the same filename but different hash → keep local
    //      (filename-collision: user's file wins)
    //   3. Else → extract the backup file and record it in the local
    //      hash index with the backup's UUID, so identity travels
    if (!cancelled) {
      const stPrefix = 'sharedTracks/';
      const stRootAbs = path.join(sfRoot, 'sharedTracks');
      const hasStEntries = Object.keys(entries).some(k => k.startsWith(stPrefix));
      if (hasStEntries) {
        try { fs.mkdirSync(stRootAbs, { recursive: true }); } catch {}
        const stCreated = [];
        // Read the backup's hash index from the zip if present. Older
        // backups (pre-hash-index) won't have it — those fall through
        // to filename-only identity for each extracted file.
        let backupIndex = null;
        try {
          const buf = await zip.entryData('sharedTracks/.jmt-hashes.json');
          const parsed = JSON.parse(buf.toString('utf8'));
          if (parsed && parsed.tracks && typeof parsed.tracks === 'object') {
            backupIndex = parsed;
          }
        } catch {}
        // Read (and backfill) the local index — drives the content
        // identity check for "already have this under any name".
        const hashMod = require('./soundFontSharedTracksHash');
        const localIndex = hashMod.ensureIndex(userData);
        const localHashes = new Set();
        const localNames = new Set();
        for (const u of Object.keys(localIndex.tracks || {})) {
          if (localIndex.tracks[u].hash) localHashes.add(localIndex.tracks[u].hash);
          if (localIndex.tracks[u].name) localNames.add(localIndex.tracks[u].name);
        }
        // sharedTracks counter advances per evaluation step (extract
        // OR skip-as-already-present) so the user sees motion through
        // the whole bucket, not just the few that get extracted.
        let stEvalDone = 0;
        const emitSharedTracksProgress = (currentItemPath) => {
          stEvalDone++;
          onProgress({
            processedBytes,
            totalBytes,
            currentItem: currentItemPath,
            topItemName: 'Shared Tracks',
            topItemFilesProcessed: stEvalDone,
            topItemFilesTotal: sharedTracksEvalTotal,
          });
        };
        // Helper that extracts a single backup track + records it.
        const extractTrack = async (entryName, fileName, backupRecord) => {
          const target = path.join(stRootAbs, fileName);
          await zip.extract(entryName, target);
          stCreated.push(target);
          const e = entries[entryName];
          if (e) processedBytes += (e.size || 0);
          emitSharedTracksProgress(entryName);
          // Record into the local index. Carry the backup's UUID so the
          // file's identity survives the round-trip across backups.
          if (backupRecord && backupRecord.uuid) {
            try {
              hashMod.recordInsert(userData, {
                uuid: backupRecord.uuid,
                name: fileName,
                size: backupRecord.size,
                hash: backupRecord.hash,
                addedAt: backupRecord.addedAt,
              });
              if (backupRecord.hash) localHashes.add(backupRecord.hash);
              localNames.add(fileName);
            } catch {}
          } else {
            // No backup record (legacy backup) — let recordAdd hash the
            // file on disk and assign a fresh UUID.
            try {
              const r = hashMod.recordAdd(userData, fileName);
              if (r && r.hash) localHashes.add(r.hash);
              localNames.add(fileName);
            } catch {}
          }
        };
        // First pass: process files we DO have an index record for.
        // Lets us make hash-based decisions without re-hashing the
        // backup files on the fly. Every evaluation step (extract OR
        // skip) advances the counter so the user sees motion through
        // the whole bucket, not just the extracted subset.
        const handledFiles = new Set(); // by filename
        if (backupIndex) {
          for (const buuid of Object.keys(backupIndex.tracks)) {
            if (cancelled) break;
            const br = backupIndex.tracks[buuid];
            if (!br || !br.name) continue;
            handledFiles.add(br.name);
            const entryName = `${stPrefix}${br.name}`;
            if (!entries[entryName]) continue; // index references a missing file (silent)
            // Rule 1: content already present locally under ANY name.
            if (br.hash && localHashes.has(br.hash)) { emitSharedTracksProgress(entryName); continue; }
            // Rule 2: filename collision with different content (or
            // local lacks a record for it — defensive). Local wins.
            if (localNames.has(br.name) || fs.existsSync(path.join(stRootAbs, br.name))) { emitSharedTracksProgress(entryName); continue; }
            // Rule 3: extract (extractTrack emits its own progress).
            try {
              await extractTrack(entryName, br.name, { uuid: buuid, ...br });
            } catch (err) {
              throw new Error(`Failed extracting ${entryName}: ${err && err.message || err}`);
            }
          }
        }
        // Second pass: any backup file the index didn't reference (or
        // legacy backups with no index at all). Filename-only union.
        // Same evaluation-step counter advancement as the first pass.
        for (const key of Object.keys(entries)) {
          if (cancelled) break;
          if (!key.startsWith(stPrefix)) continue;
          const e = entries[key];
          if (e.isDirectory) continue;
          const fileName = key.substring(stPrefix.length);
          if (!fileName || fileName.includes('/')) continue;
          if (handledFiles.has(fileName)) continue;
          // Legacy sidecars — silent skip (these aren't .wav and don't
          // count toward sharedTracksEvalTotal).
          if (fileName === '.jmt-meta.json') continue;
          if (fileName === '.jmt-hashes.json') continue;
          if (!/\.wav$/i.test(fileName)) continue;
          // Filename collision: local wins. Counter still advances.
          if (fs.existsSync(path.join(stRootAbs, fileName))) { emitSharedTracksProgress(e.name); continue; }
          try {
            await extractTrack(e.name, fileName, null);
          } catch (err) {
            throw new Error(`Failed extracting ${e.name}: ${err && err.message || err}`);
          }
        }
        rollbackLog.push(() => {
          for (const p of stCreated) { try { fs.unlinkSync(p); } catch {} }
        });
        counts.sharedTracks.added = stCreated.length;
      } else if (sharedTracksEvalTotal > 0) {
        // sharedTracks bucket has no zip entries — shouldn't happen
        // when hasStEntries is true above, but defensive for empty.
      } else {
        // No sharedTracks in backup — flash the bucket skip so the
        // user sees the phase was checked, then move on.
        await emitBucketSkip('Shared Tracks');
      }
    }

    if (cancelled) {
      throw Object.assign(new Error('Cancelled'), { cancelled: true });
    }
  } catch (err) {
    rollbackAll();
    try { await zip.close(); } catch {}
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
    throw err;
  } finally {
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
  }

  // Apply manifest settings (starredCommon) — only if the backup's value
  // isn't already what we have; otherwise it's a no-op.
  let manifestApplied = null;
  try {
    const buf = await zip.entryData('manifest.json');
    const manifest = JSON.parse(buf.toString('utf8'));
    manifestApplied = manifest;
  } catch {}

  try { await zip.close(); } catch {}
  return { manifest: manifestApplied, counts };
}

module.exports = {
  SCHEMA_VERSION,
  BACKUP_TYPE,
  surveyLibrary,
  benchmarkDestination,
  estimateSeconds,
  suggestedFileName,
  exportBackup,
  inspectBackup,
  applyReplace,
  surveyMerge,
  applyMerge,
};
