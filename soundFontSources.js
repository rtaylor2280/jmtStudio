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
async function zipFolderToFile(srcDir, destZipPath, onProgress, stripCorruptWavs) {
  const archiver = require('archiver');
  const { Transform } = require('stream');

  let files = walkFolderSorted(srcDir).filter(f => !_isNoisePath(f.relPath));
  // When the user chose to import a font flagged as corrupt, drop the damaged
  // wavs BEFORE they reach the archive. This salvages the good files (which is
  // what "import it anyway" is expected to mean) AND, because the scrambled
  // file is never read/zipped, removes the very read that can stall the pass.
  // Header-only check — the SAME one that flagged the font — so a flagged file
  // is readable here and won't hang. Opt-in (corrupt fonts only) so clean
  // imports pay nothing and no bad-sector header read is done unprompted.
  const strippedFiles = [];
  if (stripCorruptWavs) {
    const { checkWavHealth } = require('./sdCardDetect');
    files = files.filter(f => {
      if (!/\.wav$/i.test(f.relPath)) return true;
      const h = checkWavHealth(f.absPath, f.size);
      if (h && h.corrupt) { strippedFiles.push({ relPath: f.relPath, reason: h.reason }); return false; }
      return true;
    });
  }
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const fileCount = files.length;

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

  let bytesProcessed = 0;
  let filesProcessed = 0;
  let lastEmit = Date.now();
  let lastProgressMs = Date.now(); // watchdog: last time an entry actually completed
  archive.on('entry', (entry) => {
    filesProcessed++;
    lastProgressMs = Date.now();
    if (entry.stats && entry.stats.size) bytesProcessed += entry.stats.size;
    if (!onProgress) return;
    const now = Date.now();
    if (now - lastEmit > 100 || filesProcessed === fileCount) {
      onProgress({ bytesProcessed, totalBytes, currentFile: entry.name });
      lastEmit = now;
    }
  });

  // Add files in pre-sorted order. With statConcurrency:1 above, archiver stats
  // and appends them one at a time IN this submission order, so the zip bytes are
  // deterministic (concurrent stat was reordering them and breaking dedup).
  for (const f of files) {
    archive.file(f.absPath, { name: f.relPath, date: EPOCH, mode: MODE });
  }

  await new Promise((resolve, reject) => {
    // Watchdog: if no entry completes for a long stretch, a file is unreadable
    // (a damaged wav on a bad sector can make the OS read hang indefinitely).
    // Abort rather than hang the whole import forever — the caller cleans up the
    // partial uuid dir and surfaces a real error instead of a frozen modal.
    const STALL_MS = 90000;
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgressMs > STALL_MS) {
        clearInterval(watchdog);
        try { archive.abort(); } catch {}
        reject(new Error('Stalled reading a file — the source has a damaged or unreadable file. Nothing was imported.'));
      }
    }, 5000);
    const finish = (fn, arg) => { clearInterval(watchdog); fn(arg); };
    fileStream.on('close', () => finish(resolve));
    fileStream.on('error', (e) => finish(reject, e));
    archive.on('error', (e) => finish(reject, e));
    archive.on('warning', (err) => {
      // ENOENT during walk just means a file vanished between readdir
      // and read — rare but not fatal; surface anything else.
      if (err.code === 'ENOENT') return;
      finish(reject, err);
    });
    archive.finalize();
  });

  return { hash: hasher.digest('hex'), totalBytes, fileCount, strippedFiles };
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
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const uuid = entry.name;
    const uuidDir = path.join(root, uuid);
    // In-flight PREPARED source (prepareOnly staged the zip; meta comes at
    // finalize). Marked with .preparing so a sibling prepare/import in the same
    // bulk run doesn't sweep it as an "archive without meta" orphan. Skip recent
    // ones; only reclaim a marker older than 6h (a crashed session's straggler).
    const prepMarker = path.join(uuidDir, '.preparing');
    if (fs.existsSync(prepMarker)) {
      try {
        if (Date.now() - fs.statSync(prepMarker).mtimeMs < 6 * 3600 * 1000) continue;
      } catch { continue; }
    }
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
      fs.rmSync(uuidDir, { recursive: true, force: true });
      result.removed.push(uuid);
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
    if (s.meta && s.meta.hash === hash) return s;
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
    fs.rmSync(dir, { recursive: true, force: true });
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
async function copyFolderRecursive(srcDir, destDir, onFile) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    if (_isNoisePath(e.name)) continue;
    const srcPath = path.join(srcDir, e.name);
    const destPath = path.join(destDir, e.name);
    if (e.isDirectory()) {
      await copyFolderRecursive(srcPath, destPath, onFile);
    } else if (e.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
      if (onFile) onFile(srcPath);
    }
  }
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
async function importSource({ userData, sourcePath, originalName, metadata, onProgress, forceNewSource, prepareOnly, stripCorrupt }) {
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
  const format = 'zip';
  const name = originalName || path.basename(sourcePath);

  const emit = (stage, payload) => {
    if (onProgress) onProgress({ stage, ...payload });
  };
  emit('hashing', { percent: 0 });

  let hash;
  let fileSize = 0;
  let totalBytes = 0;
  let fileCount = 0;
  let strippedFiles = []; // damaged wavs dropped when stripCorrupt is set (folder imports)

  // Zip-format input: hash THEN dedup THEN copy, like before. Dedup
  // can short-circuit cleanly before we write anything because the
  // input is already a single file we can stream-hash in place.
  if (isZip) {
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
    if (!forceNewSource) {
      const existing = findByHash(userData, hash);
      if (existing) {
        emit('done', { isDuplicate: true });
        return { ok: true, isDuplicate: true, uuid: existing.uuid, hash, format };
      }
    }
  }

  ensureSourcesRoot(userData);
  const uuid = crypto.randomUUID();
  const uuidDir = path.join(sourcesRoot(userData), uuid);

  try {
    fs.mkdirSync(uuidDir, { recursive: true });

    if (isZip) {
      const destZip = path.join(uuidDir, 'source.zip');
      emit('copying', { percent: 0, totalBytes });
      await copyFileStreamed(sourcePath, destZip, ({ bytesCopied, totalBytes: tb }) => {
        emit('copying', {
          percent: tb > 0 ? Math.floor((bytesCopied / tb) * 100) : 0,
          bytes: bytesCopied,
          totalBytes: tb,
        });
      });
    } else {
      // Folder-format input: zip directly into the uuid dir in one pass.
      // The hash is the sha256 of the produced zip's bytes (tapped via
      // a Transform between archiver and the file write stream). Dedup
      // happens AFTER the write rather than before because the hash
      // doesn't exist until the zip pass completes; on a dup hit we
      // clean up the just-written zip via cleanupPartialSource below.
      // Same total I/O as the old two-walk shape (one pass instead of
      // two) so there's no extra cost paid for the post-write dedup.
      const destZip = path.join(uuidDir, 'source.zip');
      const result = await zipFolderToFile(sourcePath, destZip, ({ bytesProcessed, totalBytes: tb, currentFile }) => {
        emit('hashing', {
          percent: tb > 0 ? Math.floor((bytesProcessed / tb) * 100) : 0,
          bytes: bytesProcessed,
          totalBytes: tb,
          currentFile,
        });
      }, stripCorrupt);
      hash = result.hash;
      totalBytes = result.totalBytes;
      fileCount = result.fileCount;
      strippedFiles = result.strippedFiles || [];
      fileSize = fs.statSync(destZip).size;
      if (!forceNewSource) {
        const existing = findByHash(userData, hash);
        if (existing) {
          cleanupPartialSource(uuidDir);
          emit('done', { isDuplicate: true });
          return { ok: true, isDuplicate: true, uuid: existing.uuid, hash, format };
        }
      }
    }

    // Capture the original archive's modification date as the default
    // acquisitionDate (mtime, not birthtime — birthtime gets rewritten by sync
    // clients). Captured HERE so it's identical whether we finalize now or later
    // via a prepareOnly split.
    let sourceFileDate = null;
    let sourceFileMtimeMs = null;
    try {
      if (stat.mtimeMs && stat.mtimeMs > 0) {
        sourceFileDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);
        sourceFileMtimeMs = stat.mtimeMs;
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
      return { ok: true, isDuplicate: false, prepared: true, uuid, uuidDir, hash, format, name, fileSize, sourceFileDate, sourceFileMtimeMs, totalBytes, fileCount, strippedFiles };
    }

    const res = await _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, strippedFiles });
    emit('done', { isDuplicate: false });
    return { ...res, strippedFiles };
  } catch (err) {
    cleanupPartialSource(uuidDir);
    return { ok: false, error: `Import failed: ${err.message}` };
  }
}

// Shared meta writer + candidate-cache warm. Used by importSource's finalize
// path AND finalizePreparedSource (the deferred commit of a prepareOnly source),
// so the written meta is identical whichever way a source is committed.
async function _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, strippedFiles }) {
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
  };
  fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify(meta, null, 2));
  // Warm the candidate cache (best-effort; a stamp failure just leaves it cold).
  try { await recomputeAndStampCandidates(userData, uuid); } catch {}
  return { ok: true, isDuplicate: false, uuid, hash, format, sourceFileDate };
}

// Commit a source previously staged by importSource({ prepareOnly: true }). Its
// uuid/source.zip is already on disk, hashed and dedup-cleared — this only writes
// the meta and warms the cache. NO re-hash. The prepared fields come back from
// the prepare result and pass straight through.
async function finalizePreparedSource({ userData, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata }) {
  if (!userData || !uuid) return { ok: false, error: 'Missing userData/uuid' };
  const uuidDir = path.join(sourcesRoot(userData), uuid);
  if (!fs.existsSync(path.join(uuidDir, 'source.zip'))) return { ok: false, error: 'Prepared source is missing its archive' };
  // No longer in-flight — clear the marker BEFORE stamping so it isn't hashed
  // into the source's content signature.
  try { fs.unlinkSync(path.join(uuidDir, '.preparing')); } catch {}
  try {
    return await _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format: format || 'zip', name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata });
  } catch (err) {
    return { ok: false, error: `Finalize failed: ${err.message}` };
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

function _createZipSource({ uuid, uuidDir, meta }) {
  const zipPath = path.join(uuidDir, 'source.zip');

  // Flat-only read of a single file from the OUTER zip. The bottom of the
  // composite-path recursion in _resolveCompositeReadBytes — every inner
  // zip layer eventually resolves the leaf file via this function (which
  // is itself flat-only, no recursion). Separated from readFile so the
  // composite resolver has a non-recursive primitive to call.
  async function _readFlat(filePath) {
    const norm = _normalizeSubPath(filePath);
    if (!norm) throw new Error('readFile requires a path');
    const zip = _openZip(zipPath);
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
    uuid,
    meta,
    format: 'zip',

    // Flat list of every entry in the source, used by vendor and candidate
    // detection. Returns { fileName, size, isDir } in zip-listing order.
    async listAll() {
      const zip = _openZip(zipPath);
      try {
        return await _readAllZipEntries(zip);
      } finally {
        await zip.close();
      }
    },

    async browse(subPath) {
      const norm = _normalizeSubPath(subPath);
      const zip = _openZip(zipPath);
      try {
        const entries = await _readAllZipEntries(zip);
        return _listAtPath(entries, norm);
      } finally {
        await zip.close();
      }
    },

    async readFile(filePath) {
      // Composite-path support: paths that traverse inner zips
      // ("Indara.zip/Indara/boot.wav") get peeled one layer at a time
      // by _resolveCompositeReadBytes. The leaf flat-read for THIS
      // source goes through _readFlat above. Renderer's file browser
      // splices inner-zip subtrees with prefixed paths; every action
      // (play, copy, extract) flows through this entry point.
      return await _resolveCompositeReadBytes({ readFile: _readFlat }, filePath);
    },

    async extractTo(subPath, destDir, onProgress) {
      const norm = _normalizeSubPath(subPath);
      const prefix = norm ? norm + '/' : '';
      const zip = _openZip(zipPath);
      try {
        const entries = await _readAllZipEntries(zip);
        const matching = entries.filter(e => {
          if (norm && !e.fileName.startsWith(prefix) && e.fileName !== norm && e.fileName !== prefix) return false;
          if (_isNoisePath(e.fileName)) return false;
          return true;
        });
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const destDirResolved = path.resolve(destDir);
        let fileCount = 0;
        let totalBytes = 0;
        for (const entry of matching) {
          const rel = norm ? entry.fileName.slice(prefix.length) : entry.fileName;
          if (!rel) continue;
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
          if (onProgress) onProgress({ fileCount, totalBytes, currentFile: rel });
        }
        return { fileCount, totalBytes };
      } finally {
        await zip.close();
      }
    },

    async exportToDownloads(destDir) {
      if (!destDir) throw new Error('exportToDownloads requires destDir');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const destName = meta.originalName && /\.zip$/i.test(meta.originalName)
        ? meta.originalName
        : `${(meta.originalName || uuid).replace(/\.zip$/i, '')}.zip`;
      const destPath = _uniqueDestPath(destDir, destName);
      await fs.promises.copyFile(zipPath, destPath);
      // Stamp the exported file with the captured original mtime so a
      // round-trip (export now, re-import later) keeps showing the date
      // the user actually got the font. fs.utimes is cross-platform on
      // Windows / Mac / Linux. Older sources imported before this field
      // was captured have no mtime to apply; in that case the dest keeps
      // its just-written time (no regression from current behavior).
      if (meta.sourceFileMtimeMs && meta.sourceFileMtimeMs > 0) {
        const t = new Date(meta.sourceFileMtimeMs);
        try { await fs.promises.utimes(destPath, t, t); } catch {}
      }
      return { destPath };
    },
  };
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

    async extractTo(subPath, destDir, onProgress) {
      const norm = _normalizeSubPath(subPath);
      const srcDir = norm ? path.join(folderRoot, norm) : folderRoot;
      if (!fs.existsSync(srcDir)) throw new Error(`Not found in source: ${norm}`);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      let fileCount = 0;
      let totalBytes = 0;
      const stat = fs.statSync(srcDir);
      if (stat.isFile()) {
        const destPath = path.join(destDir, path.basename(srcDir));
        await fs.promises.copyFile(srcDir, destPath);
        fileCount = 1;
        totalBytes = stat.size;
        if (onProgress) onProgress({ fileCount, totalBytes, currentFile: path.basename(srcDir) });
        return { fileCount, totalBytes };
      }
      await copyFolderRecursive(srcDir, destDir, (srcFile) => {
        fileCount++;
        try { totalBytes += fs.statSync(srcFile).size; } catch {}
        if (onProgress) onProgress({ fileCount, totalBytes, currentFile: path.relative(srcDir, srcFile) });
      });
      return { fileCount, totalBytes };
    },

    async exportToDownloads(destDir) {
      if (!destDir) throw new Error('exportToDownloads requires destDir');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      // Folder sources are archived into a single zip on export so the user
      // gets one tidy artifact in Downloads instead of a loose tree of files,
      // and so the round-trip (re-import the exported file) works the same
      // way zip-format sources do.
      const baseName = String(meta.originalName || uuid).replace(/\.zip$/i, '');
      const destPath = _uniqueDestPath(destDir, `${baseName}.zip`);
      const archiver = require('archiver');
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(destPath);
        // forceZip64 so individual sources past the 2 GiB classic-zip
        // ceiling export cleanly. Same rationale as soundFontBackup.js.
        const archive = archiver('zip', { zlib: { level: 6 }, forceZip64: true });
        ws.on('close', resolve);
        ws.on('error', reject);
        archive.on('error', reject);
        archive.pipe(ws);
        archive.directory(folderRoot, false);
        archive.finalize();
      });
      // Apply the captured original folder mtime to the freshly written
      // zip so a round-trip preserves the user's collection date. Same
      // rationale as the zip-source path above.
      if (meta.sourceFileMtimeMs && meta.sourceFileMtimeMs > 0) {
        const t = new Date(meta.sourceFileMtimeMs);
        try { await fs.promises.utimes(destPath, t, t); } catch {}
      }
      return { destPath };
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
  const baseName = String(subPath).split('/').pop() || `source-${uuid}.bin`;
  const destPath = _uniqueDestPath(destDir, baseName);
  await fs.promises.writeFile(destPath, buf);
  return { destPath };
}

function openSource(userData, uuid) {
  const uuidDir = path.join(sourcesRoot(userData), uuid);
  const meta = readSourceMeta(uuidDir);
  if (!meta) return null;
  const ctx = { uuid, uuidDir, meta };
  if (meta.format === 'zip') return _createZipSource(ctx);
  if (meta.format === 'folder') return _createFolderSource(ctx);
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

module.exports = {
  sourcesRoot,
  ensureSourcesRoot,
  isNoisePath: _isNoisePath,
  zipFolderToFile,
  walkFolderSorted,
  openSourceAtPath,
  hashZipFile,
  hashFolder,
  listSources,
  cleanupOrphanSources,
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
