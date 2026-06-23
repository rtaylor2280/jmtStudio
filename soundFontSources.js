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
async function importSource({ userData, sourcePath, originalName, metadata, onProgress, forceNewSource }) {
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

  const format = isZip ? 'zip' : 'folder';
  const name = originalName || path.basename(sourcePath);

  // Phase 1: hash the source. For folders we also collect totalBytes/fileCount.
  const emit = (stage, payload) => {
    if (onProgress) onProgress({ stage, ...payload });
  };
  emit('hashing', { percent: 0 });

  let hash;
  let fileSize = 0;
  let totalBytes = 0;
  let fileCount = 0;

  try {
    if (isZip) {
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
    } else {
      const r = await hashFolder(sourcePath, ({ bytesHashed, totalBytes: tb, currentFile }) => {
        emit('hashing', {
          percent: tb > 0 ? Math.floor((bytesHashed / tb) * 100) : 0,
          bytes: bytesHashed,
          totalBytes: tb,
          currentFile,
        });
      });
      hash = r.hash;
      totalBytes = r.totalBytes;
      fileCount = r.fileCount;
      fileSize = r.totalBytes;
    }
  } catch (err) {
    return { ok: false, error: `Hash failed: ${err.message}` };
  }

  // Phase 2: dedup check. If hash matches an existing source, short-circuit
  // unless the caller is explicitly asking to re-import as a new source
  // (Q1's "Re-import as new" branch in the renderer flow).
  if (!forceNewSource) {
    const existing = findByHash(userData, hash);
    if (existing) {
      emit('done', { isDuplicate: true });
      return { ok: true, isDuplicate: true, uuid: existing.uuid, hash, format };
    }
  }

  // Phase 3: copy source into storage under a new UUID. On any error during
  // copy, the partial UUID dir is cleaned up so the library stays consistent.
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
      const destFolder = path.join(uuidDir, 'source');
      let copied = 0;
      emit('copying', { percent: 0, total: fileCount });
      await copyFolderRecursive(sourcePath, destFolder, (_srcFile) => {
        copied++;
        emit('copying', {
          percent: fileCount > 0 ? Math.floor((copied / fileCount) * 100) : 0,
          current: copied,
          total: fileCount,
        });
      });
    }

    // Capture the original archive's modification date as the default
    // acquisitionDate. We use mtime, NOT birthtime: on Windows + Google
    // Drive (and most sync clients) birthtime gets rewritten to the local
    // sync moment, which masks the real date a file has been in the
    // user's collection. mtime survives sync because preserving it is
    // exactly what "modified time" means. This is also what Explorer
    // shows in its "Date modified" column, so the modal default matches
    // what the user sees in the OS file picker. Formatted YYYY-MM-DD UTC.
    //
    // Both the date string (for the UI default) and the precise
    // milliseconds (for export-time mtime preservation, so a re-exported
    // source carries the original date out to the user's Downloads) are
    // stored on the source meta.
    let sourceFileDate = null;
    let sourceFileMtimeMs = null;
    try {
      if (stat.mtimeMs && stat.mtimeMs > 0) {
        sourceFileDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);
        sourceFileMtimeMs = stat.mtimeMs;
      }
    } catch {}

    const meta = {
      schemaVersion: 1,
      uuid,
      format,
      originalName: name,
      hash,
      vendor: (metadata && metadata.vendor) || null,
      vendorWebsite: (metadata && metadata.vendorWebsite) || null,
      vendorAutoDetected: !!(metadata && metadata.vendorAutoDetected),
      purchaseDate: (metadata && metadata.purchaseDate) || null,
      sourceFileDate,
      sourceFileMtimeMs,
      importedAt: new Date().toISOString(),
      userNotes: (metadata && metadata.userNotes) || '',
      fileSize,
      readmePaths: [],
    };

    fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify(meta, null, 2));

    emit('done', { isDuplicate: false });
    return { ok: true, isDuplicate: false, uuid, hash, format, sourceFileDate };
  } catch (err) {
    cleanupPartialSource(uuidDir);
    return { ok: false, error: `Import failed: ${err.message}` };
  }
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

function _createZipSource({ uuid, uuidDir, meta }) {
  const zipPath = path.join(uuidDir, 'source.zip');

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
      const norm = _normalizeSubPath(filePath);
      if (!norm) throw new Error('readFile requires a path');
      const abs = path.join(folderRoot, norm);
      if (!fs.existsSync(abs)) throw new Error(`Not found in source: ${norm}`);
      return await fs.promises.readFile(abs);
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
        const archive = archiver('zip', { zlib: { level: 6 } });
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
async function listSourceFiles(userData, uuid) {
  const source = openSource(userData, uuid);
  if (!source) return [];
  const all = await source.listAll();
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
  for (const e of all) {
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

module.exports = {
  sourcesRoot,
  ensureSourcesRoot,
  hashZipFile,
  hashFolder,
  listSources,
  cleanupOrphanSources,
  findByHash,
  importSource,
  openSource,
  deleteSource,
  updateSourceMeta,
  readSourceMeta,
  listSourceDocs,
  readSourceFileBytes,
  exportSourceFileTo,
  listSourceFiles,
  extractSourceFileTo,
};
