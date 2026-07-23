// Canonical content hash for a single top-level Sound Fonts item (an
// entry, a source, or a common). The library backup uses this to decide
// whether the backup's copy of an item is byte-identical to the user's
// current on-disk copy — the answer drives whether Replace-import can
// skip-and-move-from-snapshot (cheap) or has to wipe-and-extract.
//
// What "canonical" means here:
//   - Walk the tree under the item's root recursively.
//   - For every regular file, capture its path (relative to the item
//     root, forward-slash separated) + size + sha256 of its bytes.
//   - For every empty directory, capture an explicit marker (path +
//     '<empty>') so add/remove of an empty subfolder is visible — the
//     mere presence of an empty dir doesn't change file content but it
//     does change the user's intent for the tree shape.
//   - Sort the collected records by relative path so two trees that
//     differ only in walk order still hash to the same digest.
//   - Serialize as one line per record (`path\0size\0fileHash\n`) and
//     sha256 the serialized stream. Return the hex digest.
//
// Per-item meta.json exclusion: the item-root `meta.json` file is
// metadata, not content — it changes on every rename, tag edit, or
// description tweak. Including it would make the hash flip for purely
// cosmetic edits and defeat the "this is the same audio" use case the
// backup is solving. The existing fileCount+totalBytes proxy already
// excludes meta.json the same way; this module matches that contract.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Per-file hash manifest. The per-file records this module already computes for the
// aggregate content hash, persisted so provenance / percent-match / card-matching can
// read a saved set instead of re-walking on demand. Stored in a CENTRAL store keyed by
// uuid (soundFonts/.filehashes/<kind>/<uuid>.json — caller owns the layout), deliberately
// OUTSIDE any entry or source folder so it can never leak onto an SD card through an
// export/write path. A rebuildable cache, never a source of truth — missing/stale is fine
// (recompute rebuilds it).
const FILE_HASH_MANIFEST_SCHEMA = 1;

// Read a single file and return its sha256 hex. Small files (most wavs
// are under 1 MB) go through the buffer-at-a-time fast path so we avoid
// the bookkeeping of a streamed Hash for thousands of tiny entries.
// Large files (a single source.zip can easily exceed 2 GiB for a
// Kyberphonic character bundle) MUST be streamed because fs.readFileSync
// throws ERR_FS_FILE_TOO_LARGE on anything over the signed-32-bit
// boundary (2 GiB). Threshold of 1 GiB is conservative — well under the
// hard limit but high enough that the common case stays on the fast path.
const _STREAM_HASH_THRESHOLD = 1024 * 1024 * 1024; // 1 GiB
function _hashFile(absPath) {
  let size;
  try { size = fs.statSync(absPath).size; }
  catch { size = 0; }
  if (size < _STREAM_HASH_THRESHOLD) {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  }
  // Streaming path for files past the readFileSync ceiling. Synchronous
  // wrapper around a stream so the caller's existing sync API doesn't
  // change. Uses a 1 MiB chunk size — balance between syscall overhead
  // and memory pressure on a multi-GB file.
  const fd = fs.openSync(absPath, 'r');
  try {
    const hash = crypto.createHash('sha256');
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// Walk the item root and collect records for every regular file +
// every empty directory under it. Returns an array of objects:
//   { relPath, size, fileHash }   for files
//   { relPath, size: 0, fileHash: '<empty>' }   for empty dirs
// Caller sorts and serializes. Sealed inside one helper so the
// canonical form is described in exactly one place.
// onFile (optional): called once per hashed regular file as
// onFile(relPath, buf, size) — buf is the file's bytes when it went through the
// buffered path (the common case; every wav), or null for a streamed big file.
// Lets a caller piggyback other per-file work (e.g. a wav corruption check off
// the header) on the SAME read the content hash already does — no second pass.
// filter (optional): filter(relPath) => truthy to INCLUDE a file/dir, falsy to
// skip it (and, for a dir, not descend). Used to drop non-content noise
// (AppleDouble ._*, .DS_Store, __MACOSX, Thumbs.db) so the per-file hash set
// represents only the real font content — matching what the import zips.
function _collectRecords(itemRoot, onFile, filter) {
  const records = [];
  // Walk relative to itemRoot so the captured paths are stable across
  // different on-disk locations (backup snapshot vs live tree etc.).
  const walk = (absDir, relDir) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    // If this directory has zero children, record it as empty (only
    // when it's NOT the item root itself — the root is implicit).
    if (entries.length === 0 && relDir !== '') {
      records.push({ relPath: relDir, size: 0, fileHash: '<empty>' });
      return;
    }
    let sawAnything = false;
    for (const e of entries) {
      const absChild = path.join(absDir, e.name);
      const relChild = relDir ? `${relDir}/${e.name}` : e.name;
      if (filter && !filter(relChild)) continue; // excluded (noise) — not content
      if (e.isDirectory()) {
        sawAnything = true;
        walk(absChild, relChild);
        continue;
      }
      if (!e.isFile()) continue; // skip symlinks, sockets, etc. — irrelevant for SF
      // Per-item meta.json exclusion: at the ITEM ROOT only. Nested
      // meta.json files (rare — some vendors ship them in subfolders)
      // are real content and stay in the hash.
      if (relDir === '' && e.name === 'meta.json') continue;
      sawAnything = true;
      let size = 0;
      try { size = fs.statSync(absChild).size; } catch {}
      // Buffered path (the common case) reads the bytes once, hashes them, and
      // hands the same buffer to onFile. Big files stream-hash (no buffer).
      let fileHash;
      let buf = null;
      if (size < _STREAM_HASH_THRESHOLD) {
        try { buf = fs.readFileSync(absChild); } catch { buf = null; }
        fileHash = buf ? crypto.createHash('sha256').update(buf).digest('hex') : _hashFile(absChild);
      } else {
        fileHash = _hashFile(absChild);
      }
      if (typeof onFile === 'function') { try { onFile(relChild, buf, size); } catch {} }
      records.push({ relPath: relChild, size, fileHash });
    }
    // Edge case: a directory whose only children are the excluded
    // root meta.json. Treat it as empty so the hash stays consistent
    // whether or not the user has only meta.json at the root.
    if (relDir !== '' && !sawAnything) {
      records.push({ relPath: relDir, size: 0, fileHash: '<empty>' });
    }
  };
  walk(itemRoot, '');
  return records;
}

// Public: hash one top-level item rooted at `itemRoot`. Returns the
// sha256 hex digest of the canonical serialization, or null when the
// path doesn't exist / can't be read at all (caller treats null as
// "no comparison available" → safe to wipe-and-extract).
// Public: collect the canonical per-file record list for an item, sorted.
// Returns [{ relPath, size, fileHash }] (empty-dir markers included as
// { relPath, size: 0, fileHash: '<empty>' }), or null when the path can't be
// read. This is the same walk hashItemDir folds into a digest — exposed so
// the compare tool can build per-file hash sets without re-walking or
// re-hashing. Same meta.json-at-root exclusion and big-file streaming.
function collectFileRecords(itemRoot, onFile, filter) {
  if (!itemRoot || !fs.existsSync(itemRoot)) return null;
  let stat;
  try { stat = fs.statSync(itemRoot); } catch { return null; }
  if (!stat.isDirectory()) return null;
  const records = _collectRecords(itemRoot, onFile, filter);
  // Stable order. Forward-slash paths sort consistently across platforms.
  records.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return records;
}

// Fold a sorted record list into the canonical digest. Split out so the
// digest and the record list share one definition of "canonical."
function hashRecords(records) {
  const lineHash = crypto.createHash('sha256');
  for (const r of records) {
    // \0 separators inside, \n between records. \0 can't appear in a
    // filesystem path on any target OS so it's a safe field separator.
    lineHash.update(r.relPath);
    lineHash.update('\0');
    lineHash.update(String(r.size));
    lineHash.update('\0');
    lineHash.update(r.fileHash);
    lineHash.update('\n');
  }
  return lineHash.digest('hex');
}

function hashItemDir(itemRoot) {
  const records = collectFileRecords(itemRoot);
  if (records === null) return null;
  return hashRecords(records);
}

// Write a per-file manifest to an explicit path (the caller owns the central-store
// layout, e.g. soundFonts/.filehashes/entries/<uuid>.json). `records` is the array
// collectFileRecords returns; `aggregate` is the folded hashRecords() digest, stored
// inside as a self-verify anchor (a reader can confirm freshness by re-folding records
// or comparing to meta.contentHash). Creates the parent dir. Best-effort: a write
// failure is swallowed because the manifest is a rebuildable cache — losing it only
// means the next consumer walks live. Returns true on write.
function writeFileHashManifest(filePath, records, aggregate, hashedAt) {
  if (!filePath || !Array.isArray(records)) return false;
  const payload = {
    schemaVersion: FILE_HASH_MANIFEST_SCHEMA,
    algo: 'sha256',
    hashedAt: hashedAt || new Date().toISOString(),
    contentHash: aggregate || hashRecords(records),
    records,
  };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload));
    return true;
  } catch { return false; }
}

// Read a per-file manifest from an explicit path. Returns the parsed object, or null
// when it is absent / unreadable. Callers verify freshness (re-fold `.records`, or
// compare `.contentHash` to the item's meta.contentHash) and fall back to a live walk
// on a miss — so a missing or stale manifest degrades gracefully, never breaks.
function readFileHashManifest(filePath) {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

// Convenience: hash every top-level child directory inside `bucketRoot`
// and return a { name: hash } map. The export pass uses this once per
// bucket (sources, library, common) so the renderer's progress UI can
// report bucket-by-bucket completion.
function hashBucketChildren(bucketRoot) {
  if (!bucketRoot || !fs.existsSync(bucketRoot)) return {};
  let entries;
  try { entries = fs.readdirSync(bucketRoot, { withFileTypes: true }); }
  catch { return {}; }
  const out = {};
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const h = hashItemDir(path.join(bucketRoot, e.name));
    if (h) out[e.name] = h;
  }
  return out;
}

module.exports = { hashItemDir, hashBucketChildren, collectFileRecords, hashRecords, hashFile: _hashFile,
  writeFileHashManifest, readFileHashManifest };
