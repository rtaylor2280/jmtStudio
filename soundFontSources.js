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
      // Name the file now STARTING (submission order == completion order with
      // statConcurrency: 1), not the one just finished — during a long compress
      // the display shows the file actually being worked while the bar honestly
      // holds at completed bytes, instead of a stale name on a full-looking bar.
      const next = files[filesProcessed];
      onProgress({ bytesProcessed, totalBytes, currentFile: (next && next.relPath) || entry.name });
      lastEmit = now;
    }
  });
  // First emission up front so a section never opens blind on a huge first file.
  if (onProgress && files.length) onProgress({ bytesProcessed: 0, totalBytes, currentFile: files[0].relPath });

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
async function importSource({ userData, sourcePath, originalName, metadata, onProgress, forceNewSource, prepareOnly, stripCorrupt, knownHash }) {
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

  // ── Curation sidecar ([B-283]) ──
  // A zip we exported can carry the hand-authored curation that a delete would
  // otherwise destroy. It is stripped HERE, before anything else looks at the
  // archive, and the archive is repackaged — so the hash, the dedup check, the
  // stored source and every consumer downstream see the font exactly as the
  // vendor shipped it, with our additions gone. Nothing else in the pipeline
  // learns that curation exists.
  // The cost is gated: an ordinary vendor zip pays one central-directory read
  // and moves on. Only an archive that actually carries a sidecar is repacked.
  let curation = null;
  let curationTmp = null;
  let curationPayloadDir = null;
  if (isZip && !knownHash) {
    try {
      const cur = require('./soundFontCuration');
      curation = await cur.peekZip(sourcePath);
      if (curation) {
        emit('hashing', { percent: 0 });
        const stripped = await cur.stripAndRepackage(sourcePath, curation, (p) => onProgress && onProgress({ stage: 'hashing', percent: 0, ...p }));
        sourcePath = stripped.zipPath;
        curationTmp = stripped.tmpDir;
        curationPayloadDir = stripped.payloadDir;
        try { stat = fs.statSync(sourcePath); } catch {}
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
  let fileSize = 0;
  let totalBytes = 0;
  let fileCount = 0;
  let strippedFiles = []; // damaged wavs dropped when stripCorrupt is set (folder imports)

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
      const existing = findByHash(userData, hash);
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
          // Duplicate — but for folders the hash IS the zip-transform, so the
          // finished archive already exists. KEEP it as a staged source (the
          // folder analog of the zip path's knownHash hand-off): "import again
          // as a new source" finalizes it directly with no re-zip; keep/cancel
          // discard it. The orphan sweep reclaims a crashed straggler after 6h.
          try { fs.writeFileSync(path.join(uuidDir, '.preparing'), ''); } catch {}
          let sfd = null, sfm = null;
          try {
            if (stat.mtimeMs && stat.mtimeMs > 0) {
              sfd = new Date(stat.mtimeMs).toISOString().slice(0, 10);
              sfm = stat.mtimeMs;
            }
          } catch {}
          emit('done', { isDuplicate: true });
          _dropCurationTmp();
          return { ok: true, isDuplicate: true, uuid: existing.uuid, hash, format,
            staged: { uuid, format, name, hash, fileSize, sourceFileDate: sfd, sourceFileMtimeMs: sfm } };
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
      // Curation travels with the prepared source rather than being applied
      // now: the meta this belongs on does not exist until finalize. The temp
      // dir holding the receipts stays alive until then, and finalize removes it.
      return { ok: true, isDuplicate: false, prepared: true, uuid, uuidDir, hash, format, name, fileSize, sourceFileDate, sourceFileMtimeMs, totalBytes, fileCount, strippedFiles, curation, curationTmp, curationPayloadDir };
    }

    const res = await _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, strippedFiles, curation, curationPayloadDir });
    emit('done', { isDuplicate: false });
    _dropCurationTmp();
    return { ...res, strippedFiles, curationApplied: res.curationApplied || null };
  } catch (err) {
    cleanupPartialSource(uuidDir);
    _dropCurationTmp();
    return { ok: false, error: `Import failed: ${err.message}` };
  }
}

// Shared meta writer + candidate-cache warm. Used by importSource's finalize
// path AND finalizePreparedSource (the deferred commit of a prepareOnly source),
// so the written meta is identical whichever way a source is committed.
async function _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, strippedFiles, curation, curationPayloadDir }) {
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
    // The curation this archive arrived carrying, kept whole on the source so
    // createEntry can read the per-candidate half later without the review
    // screen having to carry it through. Source-level fields are applied
    // immediately, just below. ([B-283])
    ...(curation ? { curation } : {}),
  };
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
  // Warm the candidate cache (best-effort; a stamp failure just leaves it cold).
  try { await recomputeAndStampCandidates(userData, uuid); } catch {}
  return { ok: true, isDuplicate: false, uuid, hash, format, sourceFileDate, curationApplied };
}

// Commit a source previously staged by importSource({ prepareOnly: true }). Its
// uuid/source.zip is already on disk, hashed and dedup-cleared — this only writes
// the meta and warms the cache. NO re-hash. The prepared fields come back from
// the prepare result and pass straight through.
async function finalizePreparedSource({ userData, uuid, format, name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, curation, curationTmp, curationPayloadDir }) {
  if (!userData || !uuid) return { ok: false, error: 'Missing userData/uuid' };
  const uuidDir = path.join(sourcesRoot(userData), uuid);
  if (!fs.existsSync(path.join(uuidDir, 'source.zip'))) return { ok: false, error: 'Prepared source is missing its archive' };
  // No longer in-flight — clear the marker BEFORE stamping so it isn't hashed
  // into the source's content signature.
  try { fs.unlinkSync(path.join(uuidDir, '.preparing')); } catch {}
  try {
    return await _writeSourceMetaAndStamp({ userData, uuidDir, uuid, format: format || 'zip', name, hash, fileSize, sourceFileDate, sourceFileMtimeMs, metadata, curation, curationPayloadDir });
  } catch (err) {
    return { ok: false, error: `Finalize failed: ${err.message}` };
  } finally {
    // The prepare kept this alive so the receipts would still be on disk at
    // commit time. Whatever happened above, it is done with now. ([B-283])
    if (curationTmp) { try { fs.rmSync(curationTmp, { recursive: true, force: true }); } catch {} }
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

    // Export the source. 'zip' (default) copies the on-disk archive exactly (it IS a zip
    // already, so the copy is instant and bit-perfect); 'folder' extracts the tree. The
    // freshly written file keeps its natural "now" timestamp so it's findable.
    async exportToDownloads(destDir, { format = 'zip', onProgress } = {}) {
      if (!destDir) throw new Error('exportToDownloads requires destDir');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const baseName = String(meta.originalName || uuid).replace(/\.zip$/i, '');
      const files = (await this.listAll()).filter(e => !e.isDir);
      const folders = _topFolders(files.map(e => ({ relPath: e.fileName })));
      const totalBytes = files.reduce((s, e) => s + (e.size || 0), 0);
      if (format === 'folder') {
        const destPath = _uniqueDestPath(destDir, baseName);
        const r = await this.extractTo('', destPath, (p) => onProgress && onProgress({
          phase: 'reconstruct', fileCount: p.fileCount, totalFiles: files.length,
          bytesDone: p.totalBytes, totalBytes, currentFile: p.currentFile,
        }));
        return { destPath, format: 'folder', fileCount: r.fileCount != null ? r.fileCount : files.length, totalBytes: r.totalBytes != null ? r.totalBytes : totalBytes, folders };
      }
      const destName = /\.zip$/i.test(String(meta.originalName || '')) ? meta.originalName : `${baseName}.zip`;
      const destPath = _uniqueDestPath(destDir, destName);
      await fs.promises.copyFile(zipPath, destPath);
      // Windows copyFile inherits the SOURCE file's mtime, which would backdate
      // this fresh export to its import date and bury it in a date-sorted view.
      // Stamp "now" so it lands under Today like any download.
      try { const now = new Date(); await fs.promises.utimes(destPath, now, now); } catch {}
      if (onProgress) onProgress({ phase: 'compress', bytesDone: totalBytes, totalBytes, currentFile: destName });
      return { destPath, format: 'zip', fileCount: files.length, totalBytes, folders };
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

    // Export the source. 'zip' (default) archives the folder tree into one tidy artifact;
    // 'folder' copies the tree as-is. Both stream real per-file progress. The freshly written
    // output keeps its natural "now" timestamp so it's findable in a date-sorted view.
    async exportToDownloads(destDir, { format = 'zip', onProgress } = {}) {
      if (!destDir) throw new Error('exportToDownloads requires destDir');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const baseName = String(meta.originalName || uuid).replace(/\.zip$/i, '');
      const files = (await this.listAll()).filter(e => !e.isDir);
      const folders = _topFolders(files.map(e => ({ relPath: e.fileName })));
      const totalBytes = files.reduce((s, e) => s + (e.size || 0), 0);
      if (format === 'folder') {
        const destPath = _uniqueDestPath(destDir, baseName);
        const r = await this.extractTo('', destPath, (p) => onProgress && onProgress({
          phase: 'reconstruct', fileCount: p.fileCount, totalFiles: files.length,
          bytesDone: p.totalBytes, totalBytes, currentFile: p.currentFile,
        }));
        return { destPath, format: 'folder', fileCount: r.fileCount != null ? r.fileCount : files.length, totalBytes: r.totalBytes != null ? r.totalBytes : totalBytes, folders };
      }
      const destPath = _uniqueDestPath(destDir, `${baseName}.zip`);
      await zipFolderToFile(folderRoot, destPath, (p) => onProgress && onProgress({
        phase: 'compress', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes || totalBytes, currentFile: p.currentFile,
      }));
      return { destPath, format: 'zip', fileCount: files.length, totalBytes, folders };
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
  let src;
  if (meta.format === 'zip') src = _createZipSource(ctx);
  else if (meta.format === 'folder') src = _createFolderSource(ctx);
  else throw new Error(`Unknown source format: ${meta.format}`);
  // A deduped source (§13) presents a VIRTUAL full tree over its trimmed archive: every
  // consumer keeps seeing the complete multi-format bundle; only the bytes on disk are
  // deduped. Flag off (no meta.deduped, the case for every source today) → the physical
  // source is returned unchanged, so this is inert until dedup actually ships.
  if (meta.deduped) {
    const bc = _loadSourceBreadcrumb(userData, uuid, uuidDir);
    if (bc && Array.isArray(bc.records)) return _virtualizeSource(src, bc.records);
  }
  return src;
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

// Extract every canonical leaf of an inner-zip source to disk, opening each inner
// zip exactly ONCE (not once per file), and verify each canonical's bytes hash to
// the value it is the canonical for. Returns { canonDisk: Map(canonicalPath ->
// diskPath), cleanup() }. Throws on a missing or hash-mismatched canonical. This
// is both the fast bytes source for reconstructBundle and the safety check
// dedupeSource verifies before it trims — a slim inner zip is small, so one read
// per inner zip replaces thousands of per-file re-reads.
async function _extractCanonicalsToDisk(physical, canonicalByHash, opts = {}) {
  const crypto = require('crypto');
  const hashByCanon = new Map();
  for (const [h, p] of canonicalByHash) hashByCanon.set(p, h);
  const outer = [];
  const inner = new Map(); // innerZipPath -> [{ rel, canon }]
  for (const canon of canonicalByHash.values()) {
    const [iz, rel] = _splitComposite(canon);
    if (iz === null) outer.push(canon);
    else { if (!inner.has(iz)) inner.set(iz, []); inner.get(iz).push({ rel, canon }); }
  }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-canon-'));
  const cleanup = () => { try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} };
  const canonDisk = new Map();
  const verify = (canon, buf) => {
    const want = hashByCanon.get(canon);
    if (want && crypto.createHash('sha256').update(buf).digest('hex') !== want)
      throw new Error(`canonical hash mismatch: ${canon}`);
  };
  const onProgress = opts.onProgress;
  const phase = opts.phase || 'reading';
  const totalFiles = canonicalByHash.size;
  let done = 0, bytesDone = 0;
  const tick = (currentFile, n) => {
    done++; bytesDone += n;
    if (onProgress) onProgress({ phase, fileCount: done, totalFiles, bytesDone, currentFile });
  };
  try {
    let i = 0;
    for (const canon of outer) {
      const buf = await physical.readFile(canon);
      verify(canon, buf);
      const dp = path.join(ws, 'o' + (i++)); fs.writeFileSync(dp, buf); canonDisk.set(canon, dp);
      tick(canon, buf.length);
    }
    for (const [iz, members] of inner) {
      const izBuf = await physical.readFile(iz);
      const izDir = fs.mkdtempSync(path.join(ws, 'iz-'));
      const izFile = path.join(izDir, 'i.zip'); fs.writeFileSync(izFile, izBuf);
      const izZip = _openZip(izFile);
      try {
        const ents = new Map((await _readAllZipEntries(izZip)).filter(e => !e.isDir).map(e => [e.fileName, e]));
        for (const m of members) {
          const e = ents.get(m.rel);
          if (!e) throw new Error(`canonical missing from inner zip: ${m.canon}`);
          const buf = await _readZipEntryToBuffer(izZip, e);
          verify(m.canon, buf);
          const dp = path.join(izDir, 'c' + (i++)); fs.writeFileSync(dp, buf); canonDisk.set(m.canon, dp);
          tick(m.canon, buf.length);
        }
      } finally { await izZip.close(); }
    }
    return { canonDisk, cleanup };
  } catch (e) { cleanup(); throw e; }
}

// Transparent virtualization (§13.2). Wrap a physical, possibly-deduped source so it presents
// the FULL original tree from the breadcrumb, resolving any trimmed path to its canonical
// present twin by content hash. Inert-safe: if every breadcrumb path is still physically
// present (source not yet deduped), it behaves identically to the physical source. Only
// listAll / browse / readFile are virtualized — the programmatic readers every consumer uses;
// extractTo stays physical (reconstruction gets its own path in a later step).
function _virtualizeSource(physical, records) {
  const recs = (records || []).filter(r => r && r.fileHash !== '<empty>');
  const byPath = new Map();
  const byHash = new Map();
  for (const r of recs) {
    byPath.set(r.relPath, r);
    if (!byHash.has(r.fileHash)) byHash.set(r.fileHash, []);
    byHash.get(r.fileHash).push(r.relPath);
  }
  const virtualEntries = recs.map(r => ({ fileName: r.relPath, size: r.size, isDir: false }));
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  // Inner-zip sources present differently. A trimmed leaf lives INSIDE an inner
  // zip, so the outer physical.listAll() can't report leaf-level presence; and
  // the deterministic canonical (one per hash, computed the same way dedupeSource
  // trims) IS exactly what survives in the slim archive. So presence = the
  // canonical set, and a trimmed leaf resolves to its canonical twin (present in
  // its real inner zip) via the existing composite readFile. No slim-archive
  // recursion needed — dedupeSource and this share _pickCanonical.
  const hasInner = recs.some(r => _isCompositePath(r.relPath));
  let canonicalByHash = null;
  if (hasInner) {
    canonicalByHash = new Map();
    for (const [h, paths] of byHash) canonicalByHash.set(h, _pickCanonical(paths));
  }
  let presentSet = null;
  async function present() {
    if (presentSet) return presentSet;
    if (hasInner) {
      presentSet = new Set([...canonicalByHash.values()]);
    } else {
      const phys = await physical.listAll();
      presentSet = new Set(phys.filter(e => !e.isDir).map(e => e.fileName));
    }
    return presentSet;
  }
  return Object.assign({}, physical, {
    virtualized: true,
    async listAll() { return virtualEntries.map(e => ({ ...e })); },
    async browse(subPath) { return _listAtPath(virtualEntries, norm(subPath)); },
    async readFile(p) {
      const key = norm(p);
      const pres = await present();
      if (pres.has(key)) return await physical.readFile(key);
      // Trimmed path — resolve to any present twin sharing its content hash.
      const rec = byPath.get(key);
      if (rec) {
        for (const twin of (byHash.get(rec.fileHash) || [])) {
          if (pres.has(twin)) return await physical.readFile(twin);
        }
      }
      return await physical.readFile(key); // not found → let the physical layer throw normally
    },
    // Reconstruct the FULL original subtree (trimmed board formats rebuilt from canonical
    // copies) to destDir. This is the export/reconstruction path (§13.3) — every consumer that
    // extracts a deduped source gets the complete bundle back, byte-identical per file.
    async extractTo(subPath, destDir, onProgress) {
      const base = norm(subPath);
      const prefix = base ? base + '/' : '';
      const destResolved = path.resolve(destDir);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      let fileCount = 0, totalBytes = 0;
      for (const r of recs) {
        if (base && r.relPath !== base && !r.relPath.startsWith(prefix)) continue;
        const rel = base ? r.relPath.slice(prefix.length) : r.relPath;
        if (!rel) continue;
        const destPath = path.join(destDir, rel.replace(/\//g, path.sep));
        const resolved = path.resolve(destPath);
        if (resolved !== destResolved && !resolved.startsWith(destResolved + path.sep)) {
          throw new Error(`Refused to extract outside destination: ${rel}`);
        }
        const buf = await this.readFile(r.relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, buf);
        fileCount++; totalBytes += buf.length;
        if (onProgress) onProgress({ fileCount, totalBytes, currentFile: rel });
      }
      return { fileCount, totalBytes };
    },
    // Rebuild the FULL original bundle to destDir WITH inner zips intact — each
    // inner zip rebuilt from its members' canonical copies. This is the faithful
    // refill for a deduped inner-zip source: the exported bundle matches the
    // original structure (Proffie.zip, Verso.zip, ... as real zips), not an
    // exploded tree. Per-leaf byte-identical; inner-zip container bytes need not
    // match. (extractTo above stays the "unwrapped tree" path for subtree/entry
    // extraction; export routes here when the source has inner zips.)
    async reconstructBundle(destDir, onProgress) {
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      // Pull every canonical to disk once (each inner zip opened a single time),
      // reporting it as the 'reading' phase so the UI isn't blind while it runs;
      // then rebuild ('reconstruct' phase) is pure file copies + one re-zip.
      const { canonDisk, cleanup } = await _extractCanonicalsToDisk(physical, canonicalByHash,
        { phase: 'reading', onProgress: onProgress && ((p) => onProgress({ phase: 'reading', fileCount: p.fileCount, totalFiles: p.totalFiles, currentFile: p.currentFile })) });
      try {
        const outer = [];
        const groups = new Map(); // innerZipPath -> [{ innerRel, rec }]
        for (const r of recs) {
          const [iz, innerRel] = _splitComposite(r.relPath);
          if (iz === null) outer.push(r);
          else { if (!groups.has(iz)) groups.set(iz, []); groups.get(iz).push({ innerRel, rec: r }); }
        }
        let fileCount = 0, totalBytes = 0;
        const totalFiles = recs.length;
        const emit = (rel, n) => { fileCount++; totalBytes += n; if (onProgress) onProgress({ phase: 'reconstruct', fileCount, totalFiles, totalBytes, currentFile: rel }); };
        const diskOf = (r) => {
          const dp = canonDisk.get(canonicalByHash.get(r.fileHash));
          if (!dp) throw new Error(`reconstruct: no canonical for ${r.relPath}`);
          return dp;
        };
        for (const r of outer) {
          const dest = path.join(destDir, r.relPath.replace(/\//g, path.sep));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(diskOf(r), dest);
          emit(r.relPath, r.size || 0);
        }
        for (const [iz, members] of groups) {
          const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-innerbuild-'));
          try {
            for (const m of members) {
              const f = path.join(tmp, m.innerRel.replace(/\//g, path.sep));
              fs.mkdirSync(path.dirname(f), { recursive: true });
              fs.copyFileSync(diskOf(m.rec), f);
              emit(m.rec.relPath, m.rec.size || 0);
            }
            const dest = path.join(destDir, iz.replace(/\//g, path.sep));
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            await zipFolderToFile(tmp, dest);
          } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
        }
        return { fileCount, totalBytes };
      } finally { cleanup(); }
    },
    // Export the FULL original bundle (trimmed board formats rebuilt), not the slim on-disk
    // archive. `format` is 'zip' (default — a single archive, for backup / re-import) or
    // 'folder' (the extracted tree, ready to drop on a card). `onProgress` reports real work
    // — every reconstructed file, with a running byte total — so the UI shows files flying by
    // against an accurate bar instead of a blind spinner. The rebuilt output is content-per-file
    // identical to the original (its zip-container bytes need not match). The freshly written
    // file keeps its natural "now" timestamp so it's findable in a date-sorted view; the
    // acquired date lives on the entry in-app, not on the exported file.
    async exportToDownloads(destDir, { format = 'zip', onProgress } = {}) {
      if (!destDir) throw new Error('exportToDownloads requires destDir');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const meta = physical.meta || {};
      const baseName = (meta.originalName || 'source').replace(/\.zip$/i, '');
      const grandTotal = recs.reduce((s, r) => s + (r.size || 0), 0);
      const grandFiles = recs.length;
      const folders = _topFolders(recs);
      // Inner-zip sources rebuild their inner zips (faithful refill); folder-only
      // sources write the flat tree. Same progress shape either way.
      const reconstruct = (dest, onProg) => hasInner ? this.reconstructBundle(dest, onProg) : this.extractTo('', dest, onProg);
      if (format === 'folder') {
        const destPath = _uniqueDestPath(destDir, baseName);
        await reconstruct(destPath, (p) => onProgress && onProgress({
          phase: p.phase || 'reconstruct', fileCount: p.fileCount, totalFiles: p.totalFiles || grandFiles,
          bytesDone: p.totalBytes || 0, totalBytes: grandTotal, currentFile: p.currentFile,
        }));
        return { destPath, format: 'folder', fileCount: grandFiles, totalBytes: grandTotal, folders, reconstructed: true };
      }
      // zip: reconstruct to a temp tree, then archive it. Two passes keep memory bounded on
      // multi-GB voicepacks (no whole-bundle buffering) and reuse the proven zipFolderToFile
      // output. Reconstruction reports real per-file progress; compression reports byte progress.
      const destPath = _uniqueDestPath(destDir, `${baseName}.zip`);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-srcexport-'));
      try {
        await reconstruct(tmp, (p) => onProgress && onProgress({
          phase: p.phase || 'reconstruct', fileCount: p.fileCount, totalFiles: p.totalFiles || grandFiles,
          bytesDone: p.totalBytes || 0, totalBytes: grandTotal, currentFile: p.currentFile,
        }));
        await zipFolderToFile(tmp, destPath, (p) => onProgress && onProgress({
          phase: 'compress', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes || grandTotal,
          currentFile: p.currentFile,
        }));
      } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
      return { destPath, format: 'zip', fileCount: grandFiles, totalBytes: grandTotal, folders, reconstructed: true };
    },
  });
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

// Trim an inner-zip source: the duplicates live inside inner zips, so we rebuild
// each inner zip keeping ONLY its canonical members (the copies it holds the
// canonical for), write the slimmed inner zips + outer canonicals into a new
// source.zip, then reconstruct EVERY original leaf through the virtualization and
// confirm its hash BEFORE swapping the fat archive out. On any mismatch the
// original is untouched. Canonicals stay in real inner zips, so the virtualization
// reads trimmed leaves by resolving to their present canonical twin.
async function _dedupeInnerZipSource(userData, uuid, uuidDir, meta, records, byHash, canonicalByHash, bc, onProgress) {
  const crypto = require('crypto');
  const fh = require('./soundFontFileHash');
  const zipPath = path.join(uuidDir, 'source.zip');
  const physical = openSource(userData, uuid); // fat source, composite-aware reads
  if (!physical) return { deduped: false, reason: 'open-failed' };

  // Running trim total: the moment the hash groups exist we know exactly which
  // bytes are duplicates — (copies - 1) × size per unique file, attributed to its
  // canonical. Accumulated as each canonical is read so the number tracks real work.
  const sizeByHash = new Map();
  for (const r of records) if (!sizeByHash.has(r.fileHash)) sizeByHash.set(r.fileHash, r.size || 0);
  const dupBytesByCanon = new Map();
  for (const [h, paths] of byHash) {
    const canon = canonicalByHash.get(h);
    if (canon) dupBytesByCanon.set(canon, (paths.length - 1) * (sizeByHash.get(h) || 0));
  }
  // The running total is denominated in DISK bytes, not raw content bytes: the
  // duplicates live inside a compressed archive, so raw trimmed content overstates
  // what the file will actually shrink by (the TurboTax effect, 2026-07-23).
  // Scale by the archive's measured compression ratio; the close-out reports exact.
  let trimmedSoFar = 0;
  const contentBytes = records.reduce((s, r) => s + (r.size || 0), 0);
  const archiveBytes = (() => { try { return fs.statSync(zipPath).size; } catch { return 0; } })();
  const diskRatio = (contentBytes > 0 && archiveBytes > 0) ? Math.min(1, archiveBytes / contentBytes) : 1;
  const prog = onProgress ? (p) => {
    if (p && p.phase === 'reading' && p.currentFile && dupBytesByCanon.has(p.currentFile)) {
      trimmedSoFar += dupBytesByCanon.get(p.currentFile);
      dupBytesByCanon.delete(p.currentFile); // count each canonical once
    }
    onProgress({ ...p, savedBytes: Math.round(trimmedSoFar * diskRatio) });
  } : null;

  const outerCanon = [];
  const innerGroups = new Map(); // innerZipPath -> [{ innerRel, canon }]
  for (const canon of canonicalByHash.values()) {
    const [iz, innerRel] = _splitComposite(canon);
    if (iz === null) outerCanon.push(canon);
    else { if (!innerGroups.has(iz)) innerGroups.set(iz, []); innerGroups.get(iz).push({ innerRel, canon }); }
  }

  const slimTree = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-izdedup-tree-'));
  const slimSrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-izdedup-src-'));
  const slimZip = path.join(slimSrcDir, 'source.zip');
  let releaseFat = null;
  try {
    // Pull every canonical out of the FAT source ONCE (each fat inner zip opened
    // a single time, hash-verified), so building the slim is file copies — not a
    // per-file re-extraction of multi-hundred-MB inner zips.
    const { canonDisk: fatCanon, cleanup } = await _extractCanonicalsToDisk(physical, canonicalByHash,
      { phase: 'reading', onProgress: prog });
    releaseFat = cleanup;
    // Rebuild progress: one section per metric (House rule, 2026-07-23). Placement
    // ticks are their own 'rebuild' section (file counts, fast fs copies); the
    // per-inner-zip compressions are a separate 'innercompress' section carrying
    // CUMULATIVE bytes across all inner zips so its bar fills once, monotonically.
    const totalPlace = canonicalByHash.size;
    let placed = 0;
    const tickPlace = (cur) => { placed++; if (prog) prog({ phase: 'rebuild', fileCount: placed, totalFiles: totalPlace, currentFile: cur }); };
    const canonSize = new Map();
    for (const [h, canon] of canonicalByHash) canonSize.set(canon, sizeByHash.get(h) || 0);
    let innerCompressTotal = 0;
    for (const members of innerGroups.values())
      for (const m of members) innerCompressTotal += (canonSize.get(m.canon) || 0);
    let innerCompressedBase = 0;
    // Outer canonical files (not inside any inner zip) go in verbatim.
    for (const canon of outerCanon) {
      const dest = path.join(slimTree, canon.replace(/\//g, path.sep));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(fatCanon.get(canon), dest);
      tickPlace(canon);
    }
    // Each inner zip rebuilt from ONLY its canonical members (the slim version).
    // Two passes, NOT interleaved: place every group's members first (one
    // continuous Rebuilding section), then compress every rebuilt zip (one
    // continuous Compressing section). Interleaving alternated the visible
    // sections per zip and made the bar sawtooth (2026-07-23). Costs a
    // little more temp disk (all group trees live until compressed) — fine.
    const groupTmp = []; // [{ iz, izTmp, groupBytes }]
    try {
      for (const [iz, members] of innerGroups) {
        const g = { iz, izTmp: fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-izdedup-inner-')), groupBytes: 0 };
        groupTmp.push(g);
        for (const m of members) {
          const f = path.join(g.izTmp, m.innerRel.replace(/\//g, path.sep));
          fs.mkdirSync(path.dirname(f), { recursive: true });
          fs.copyFileSync(fatCanon.get(m.canon), f);
          g.groupBytes += (canonSize.get(m.canon) || 0);
          tickPlace(m.canon);
        }
      }
      for (const g of groupTmp) {
        const dest = path.join(slimTree, g.iz.replace(/\//g, path.sep));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await zipFolderToFile(g.izTmp, dest, prog && ((p) => prog({
          phase: 'innercompress',
          bytesDone: innerCompressedBase + (p.bytesProcessed || 0),
          totalBytes: innerCompressTotal,
          currentFile: p.currentFile,
        })));
        innerCompressedBase += g.groupBytes;
        try { fs.rmSync(g.izTmp, { recursive: true, force: true }); } catch {}
      }
    } finally {
      for (const g of groupTmp) { try { fs.rmSync(g.izTmp, { recursive: true, force: true }); } catch {} }
    }
    await zipFolderToFile(slimTree, slimZip, prog && ((p) => prog({ phase: 'compress', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes, currentFile: p.currentFile })));

    // VERIFY-BEFORE-COMMIT: extract every canonical from the slim archive once,
    // hash-checking each against the value it is the canonical for, and confirm
    // every original leaf maps to a present canonical. Reconstruction copies those
    // exact canonical bytes into each leaf, so a passing check means every leaf
    // reconstructs to its recorded hash. Reads through the slim physical source
    // the virtualization also uses; opens each inner zip once.
    const slimPhysical = _createZipSource({ uuid, uuidDir: slimSrcDir, meta });
    const { canonDisk, cleanup: releaseCanon } = await _extractCanonicalsToDisk(slimPhysical, canonicalByHash,
      { phase: 'verify', onProgress: prog });
    try {
      for (const r of records) {
        if (!canonDisk.has(canonicalByHash.get(r.fileHash)))
          throw new Error(`verify(inner-zip): no canonical present for ${r.relPath}`);
      }
    } finally { releaseCanon(); }

    // COMMIT: keep the fat archive until the slim one is safely in place. slimZip
    // lives in the OS temp dir (possibly another volume), so copy then unlink
    // rather than rename across devices. Streamed so the multi-hundred-MB copy
    // reports instead of freezing the bar on the last verify file.
    const oldBytes = (() => { try { return fs.statSync(zipPath).size; } catch { return 0; } })();
    const bak = zipPath + '.pre-dedup';
    fs.renameSync(zipPath, bak);
    try {
      await copyFileStreamed(slimZip, zipPath, prog && ((p) => prog({ phase: 'commit', bytesDone: p.bytesCopied, totalBytes: p.totalBytes, currentFile: 'source.zip' })));
    }
    catch (e) { try { fs.rmSync(zipPath, { force: true }); } catch {} try { fs.renameSync(bak, zipPath); } catch {} throw e; }
    fs.rmSync(bak, { force: true });
    const newBytes = (() => { try { return fs.statSync(zipPath).size; } catch { return 0; } })();

    fh.writeFileHashManifest(path.join(uuidDir, '.jmt-source-manifest.json'), records, bc.contentHash, bc.hashedAt);
    try {
      updateSourceMeta(userData, uuid, { deduped: true, innerZipDeduped: true, dedupStats: {
        originalFiles: records.length, uniqueFiles: canonicalByHash.size,
        originalArchiveBytes: oldBytes, dedupedArchiveBytes: newBytes,
      } });
    } catch {}
    return { deduped: true, innerZip: true, originalFiles: records.length,
      uniqueFiles: canonicalByHash.size, savedBytes: Math.max(0, oldBytes - newBytes) };
  } catch (e) {
    return { deduped: false, reason: String(e && e.message || e) };
  } finally {
    try { releaseFat(); } catch {}
    try { fs.rmSync(slimTree, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(slimSrcDir, { recursive: true, force: true }); } catch {}
  }
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
  if (meta.format !== 'zip') return { deduped: false, reason: 'not-zip' };

  const crypto = require('crypto');
  const fh = require('./soundFontFileHash');
  let bc = fh.readFileHashManifest(fileHashManifestPath(userData, 'sources', uuid));
  if (!bc || !Array.isArray(bc.records)) bc = await ensureSourceManifest(userData, uuid, onProgress);
  if (!bc || !Array.isArray(bc.records)) return { deduped: false, reason: 'no-breadcrumb' };
  const records = bc.records.filter(r => r.fileHash !== '<empty>');

  const byHash = new Map();
  for (const r of records) {
    if (!byHash.has(r.fileHash)) byHash.set(r.fileHash, []);
    byHash.get(r.fileHash).push(r.relPath);
  }
  const canonicalByHash = new Map();
  for (const [h, paths] of byHash) canonicalByHash.set(h, _pickCanonical(paths));
  if (canonicalByHash.size === records.length) return { deduped: false, reason: 'no-duplicates' };

  // Inner-zip sources trim a different shape: the duplicates live INSIDE inner
  // zips, so we rebuild slimmed inner zips (canonical members only) and lean on
  // the virtualization to reconstruct on read. Separate path, verified through
  // that same virtualization before commit.
  if (records.some(r => _isCompositePath(r.relPath))) {
    return await _dedupeInnerZipSource(userData, uuid, uuidDir, meta, records, byHash, canonicalByHash, bc, onProgress);
  }

  const zipPath = path.join(uuidDir, 'source.zip');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-dedup-'));
  const tmpZip = path.join(uuidDir, '.source.zip.dedup-tmp');
  try {
    // Running trim total, same shape as the inner-zip path: (copies - 1) × size
    // per unique file, accumulated as each canonical is pulled, scaled to DISK
    // bytes by the archive's measured compression ratio (see inner-zip note).
    const sizeByHash = new Map();
    for (const r of records) if (!sizeByHash.has(r.fileHash)) sizeByHash.set(r.fileHash, r.size || 0);
    let trimmedSoFar = 0;
    const gContentBytes = records.reduce((s, r) => s + (r.size || 0), 0);
    const gArchiveBytes = (() => { try { return fs.statSync(zipPath).size; } catch { return 0; } })();
    const gDiskRatio = (gContentBytes > 0 && gArchiveBytes > 0) ? Math.min(1, gArchiveBytes / gContentBytes) : 1;
    // Extract ONLY the canonical files (one per unique hash) to a temp folder at their paths.
    const zip = _openZip(zipPath);
    try {
      const entries = await _readAllZipEntries(zip);
      const entryByName = new Map(entries.filter(e => !e.isDir).map(e => [e.fileName, e]));
      let done = 0;
      for (const [h, canonPath] of canonicalByHash) {
        const src = entryByName.has(canonPath) ? canonPath
          : (byHash.get(h) || []).find(p => entryByName.has(p));
        if (!src) throw new Error(`canonical missing in archive for hash ${h.slice(0, 8)}`);
        const buf = await _readZipEntryToBuffer(zip, entryByName.get(src));
        const dest = path.join(tmpDir, src.replace(/\//g, path.sep));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        done++;
        trimmedSoFar += ((byHash.get(h) || []).length - 1) * (sizeByHash.get(h) || 0);
        if (onProgress) onProgress({ phase: 'reading', fileCount: done, totalFiles: canonicalByHash.size, currentFile: src, savedBytes: Math.round(trimmedSoFar * gDiskRatio) });
      }
    } finally { await zip.close(); }

    // Build the slim archive (deterministic) to a temp file.
    await zipFolderToFile(tmpDir, tmpZip, onProgress && ((p) => onProgress({ phase: 'compress', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes, currentFile: p.currentFile, savedBytes: Math.round(trimmedSoFar * gDiskRatio) })));

    // VERIFY-BEFORE-COMMIT: every ORIGINAL path must reconstruct to its recorded hash.
    const vzip = _openZip(tmpZip);
    try {
      const vents = await _readAllZipEntries(vzip);
      const vby = new Map(vents.filter(e => !e.isDir).map(e => [e.fileName, e]));
      let vdone = 0;
      for (const r of records) {
        const ent = vby.get(canonicalByHash.get(r.fileHash)) || vby.get(r.relPath);
        if (!ent) throw new Error(`verify: ${r.relPath} unresolved in slim archive`);
        const buf = await _readZipEntryToBuffer(vzip, ent);
        if (crypto.createHash('sha256').update(buf).digest('hex') !== r.fileHash)
          throw new Error(`verify: ${r.relPath} hash mismatch`);
        vdone++;
        if (onProgress) onProgress({ phase: 'verify', fileCount: vdone, totalFiles: records.length, currentFile: r.relPath, savedBytes: Math.round(trimmedSoFar * gDiskRatio) });
      }
    } finally { await vzip.close(); }

    // COMMIT: keep the fat archive until the slim one is safely in place.
    const oldBytes = (() => { try { return fs.statSync(zipPath).size; } catch { return 0; } })();
    const bak = zipPath + '.pre-dedup';
    fs.renameSync(zipPath, bak);
    try { fs.renameSync(tmpZip, zipPath); }
    catch (e) { try { fs.renameSync(bak, zipPath); } catch {} throw e; }
    fs.rmSync(bak, { force: true });
    const newBytes = (() => { try { return fs.statSync(zipPath).size; } catch { return 0; } })();

    // Durable breadcrumb travels WITH the source (load-bearing once trimmed, §13.1).
    fh.writeFileHashManifest(path.join(uuidDir, '.jmt-source-manifest.json'), records, bc.contentHash, bc.hashedAt);
    try {
      updateSourceMeta(userData, uuid, { deduped: true, dedupStats: {
        originalFiles: records.length, uniqueFiles: canonicalByHash.size,
        originalArchiveBytes: oldBytes, dedupedArchiveBytes: newBytes,
      } });
    } catch {}

    return { deduped: true, originalFiles: records.length, uniqueFiles: canonicalByHash.size,
      savedBytes: Math.max(0, oldBytes - newBytes) };
  } catch (e) {
    return { deduped: false, reason: String(e && e.message || e) };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(tmpZip, { force: true }); } catch {}
  }
}

module.exports = {
  sourcesRoot,
  ensureSourcesRoot,
  ensureSourceManifest,
  removeSourceManifest,
  dedupeSource,
  _virtualizeSource,
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
