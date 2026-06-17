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

// Read a single file in one shot and return its sha256 hex. The Sound
// Fonts library is full of small files (most wavs are under 1 MB), so
// the buffer-at-a-time path is fine and avoids the bookkeeping of a
// streamed Hash for thousands of tiny entries.
function _hashFile(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Walk the item root and collect records for every regular file +
// every empty directory under it. Returns an array of objects:
//   { relPath, size, fileHash }   for files
//   { relPath, size: 0, fileHash: '<empty>' }   for empty dirs
// Caller sorts and serializes. Sealed inside one helper so the
// canonical form is described in exactly one place.
function _collectRecords(itemRoot) {
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
      const fileHash = _hashFile(absChild);
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
function hashItemDir(itemRoot) {
  if (!itemRoot || !fs.existsSync(itemRoot)) return null;
  let stat;
  try { stat = fs.statSync(itemRoot); } catch { return null; }
  if (!stat.isDirectory()) return null;
  const records = _collectRecords(itemRoot);
  // Stable order. Forward-slash paths sort consistently across
  // platforms; no normalization needed beyond walking.
  records.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
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

module.exports = { hashItemDir, hashBucketChildren };
