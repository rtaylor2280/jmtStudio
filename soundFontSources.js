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
  for (const f of files) {
    hash.update(f.relPath);
    hash.update('\0');
    const stream = fs.createReadStream(f.absPath);
    await new Promise((resolve, reject) => {
      stream.on('data', chunk => {
        hash.update(chunk);
        bytesHashed += chunk.length;
        if (onProgress) onProgress({ bytesHashed, totalBytes, currentFile: f.relPath });
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  }
  return { hash: hash.digest('hex'), totalBytes, fileCount: files.length };
}

function readSourceMeta(uuidDir) {
  const metaPath = path.join(uuidDir, 'meta.json');
  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
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

// Recursively copy a folder. Async file-by-file so the caller can report
// progress and we don't pull all bytes into memory at once.
async function copyFolderRecursive(srcDir, destDir, onFile) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
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
async function importSource({ userData, sourcePath, originalName, metadata, onProgress }) {
  if (!userData) return { ok: false, error: 'Missing userData' };
  if (!sourcePath) return { ok: false, error: 'Missing sourcePath' };
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

  // Phase 2: dedup check. If hash matches an existing source, short-circuit.
  const existing = findByHash(userData, hash);
  if (existing) {
    emit('done', { isDuplicate: true });
    return { ok: true, isDuplicate: true, uuid: existing.uuid, hash, format };
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
      importedAt: new Date().toISOString(),
      userNotes: (metadata && metadata.userNotes) || '',
      fileSize,
      readmePaths: [],
    };

    fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify(meta, null, 2));

    emit('done', { isDuplicate: false });
    return { ok: true, isDuplicate: false, uuid, hash, format };
  } catch (err) {
    cleanupPartialSource(uuidDir);
    return { ok: false, error: `Import failed: ${err.message}` };
  }
}

module.exports = {
  sourcesRoot,
  ensureSourcesRoot,
  hashZipFile,
  hashFolder,
  listSources,
  findByHash,
  importSource,
};
