// Per-track hash index for the Shared Tracks folder. Each track gets a
// stable UUID identity at add-time plus a SHA-256 of its content, so:
//   - Backup merge can skip files we already have under any name
//     (content-identity, not just filename-identity).
//   - Backup replace can move-instead-of-extract files that haven't
//     changed, saving the rewrite cost on a clean restore.
//   - Renames are cheap: same UUID + same hash, just patch the name
//     field. No re-hash needed.
//
// Sidecar location: <userData>/soundFonts/sharedTracks/.jmt-hashes.json
// Lives inside the folder so deleteAll() removes it as a side effect.
// Hidden by dot-prefix so it never appears in user-facing file
// listings (listFiles filters non-.wav).
//
// Index shape (version 1):
//   {
//     "version": 1,
//     "tracks": {
//       "<uuid>": {
//         "name": "yoda-trk.wav",
//         "size": 2400000,
//         "hash": "sha256-hex",
//         "addedAt": "2026-06-19T18:30:00Z"
//       },
//       ...
//     }
//   }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INDEX_VERSION = 1;

function _sharedTracksRoot(userData) {
  return path.join(userData, 'soundFonts', 'sharedTracks');
}

function _indexPath(userData) {
  return path.join(_sharedTracksRoot(userData), '.jmt-hashes.json');
}

function _emptyIndex() {
  return { version: INDEX_VERSION, tracks: {} };
}

// SHA-256 of a file's bytes. Returns null if the file can't be read so
// callers can decide whether to skip or surface an error.
function hashFile(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function readIndex(userData) {
  const p = _indexPath(userData);
  if (!fs.existsSync(p)) return _emptyIndex();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return _emptyIndex();
    if (!raw.tracks || typeof raw.tracks !== 'object') return _emptyIndex();
    return raw;
  } catch {
    // Corrupt index — return empty so a backfill rebuilds it. Don't
    // delete the bad file here; let the next write overwrite it.
    return _emptyIndex();
  }
}

function writeIndex(userData, index) {
  const root = _sharedTracksRoot(userData);
  if (!fs.existsSync(root)) return { ok: false, error: 'sharedTracks folder not found' };
  try {
    fs.writeFileSync(_indexPath(userData), JSON.stringify(index, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Lookup helpers. Index is passed in so callers can read once and do
// multiple lookups without re-reading the file.
function findByName(index, name) {
  if (!name) return null;
  for (const uuid of Object.keys(index.tracks)) {
    if (index.tracks[uuid].name === name) {
      return { uuid, ...index.tracks[uuid] };
    }
  }
  return null;
}

function findByHash(index, hash) {
  if (!hash) return [];
  const matches = [];
  for (const uuid of Object.keys(index.tracks)) {
    if (index.tracks[uuid].hash === hash) {
      matches.push({ uuid, ...index.tracks[uuid] });
    }
  }
  return matches;
}

// Name -> hash for every track in the library, from the index rather than by
// reading the files. ensureIndex already reconciles what appeared or vanished
// and hashes only what lacks a record, so the steady state costs nothing.
//
// Added 2026-07-31 because export was calling hashFile on every library track
// on every run — 500 tracks meant 500 local reads to discover nothing had
// changed. The index had been sitting there unused.
//
// Deliberately NOT validated against size or mtime. The library is ours: adds,
// renames and deletes all go through this index, and nothing else in the app
// defends against a file being hand-edited inside userData either. The
// destination manifest does check mtime, because a card is genuinely foreign
// and people do edit them. Different situations, different answers.
// (Ryan, 2026-07-31.)
function resolveHashes(userData) {
  const out = new Map();
  const index = ensureIndex(userData);
  for (const uuid of Object.keys(index.tracks || {})) {
    const rec = index.tracks[uuid];
    if (rec && rec.name && rec.hash) out.set(rec.name, rec.hash);
  }
  return out;
}

// Idempotent backfill: walk the .wav files in the folder and create
// records for any that don't have one in the index. Also prunes
// records whose file is no longer on disk. Called on every read path
// where the caller needs to trust the index against current state
// (modal open, backup export, merge survey). Cheap when the index is
// already in sync; only hashes files that lack a record.
function ensureIndex(userData) {
  const root = _sharedTracksRoot(userData);
  if (!fs.existsSync(root)) return _emptyIndex();
  const index = readIndex(userData);
  // Set of names currently on disk for prune check below.
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return index; }
  const onDiskNames = new Set();
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.wav$/i.test(e.name)) continue;
    onDiskNames.add(e.name);
  }
  // Add records for on-disk files missing from the index.
  let mutated = false;
  for (const name of onDiskNames) {
    if (findByName(index, name)) continue;
    const abs = path.join(root, name);
    const hash = hashFile(abs);
    if (!hash) continue;
    let size = 0;
    try { size = fs.statSync(abs).size; } catch {}
    const uuid = crypto.randomUUID();
    index.tracks[uuid] = {
      name,
      size,
      hash,
      addedAt: new Date().toISOString(),
    };
    mutated = true;
  }
  // Drop records whose file no longer exists on disk (user deleted via
  // file manager, restore-from-backup picked a different set, etc.).
  for (const uuid of Object.keys(index.tracks)) {
    if (!onDiskNames.has(index.tracks[uuid].name)) {
      delete index.tracks[uuid];
      mutated = true;
    }
  }
  if (mutated) writeIndex(userData, index);
  return index;
}

// Record a newly-added file. Computes hash from the on-disk file. If a
// record with the same name already exists, replace it (the add path
// resolved the collision with a renamed dest, so same-name = same file
// being re-added with the new content). Returns the new record on
// success or { error } on failure.
function recordAdd(userData, name) {
  const root = _sharedTracksRoot(userData);
  const abs = path.join(root, name);
  if (!fs.existsSync(abs)) return { error: 'File not found' };
  const hash = hashFile(abs);
  if (!hash) return { error: 'Hash failed' };
  let size = 0;
  try { size = fs.statSync(abs).size; } catch {}
  const index = readIndex(userData);
  // Drop any prior record with this name (caller-resolved collision).
  for (const uuid of Object.keys(index.tracks)) {
    if (index.tracks[uuid].name === name) delete index.tracks[uuid];
  }
  const uuid = crypto.randomUUID();
  index.tracks[uuid] = {
    name,
    size,
    hash,
    addedAt: new Date().toISOString(),
  };
  writeIndex(userData, index);
  return { uuid, name, size, hash };
}

// Insert a record with a known UUID + hash (used by backup restore so
// identity survives the round-trip). Overwrites any record with the
// same UUID or same name.
function recordInsert(userData, { uuid, name, size, hash, addedAt }) {
  if (!uuid || !name || !hash) return { ok: false, error: 'Missing fields' };
  const index = readIndex(userData);
  // Drop any prior record with this name to avoid stale duplicates.
  for (const u of Object.keys(index.tracks)) {
    if (index.tracks[u].name === name && u !== uuid) delete index.tracks[u];
  }
  index.tracks[uuid] = {
    name,
    size: size || 0,
    hash,
    addedAt: addedAt || new Date().toISOString(),
  };
  writeIndex(userData, index);
  return { ok: true };
}

function recordRename(userData, oldName, newName) {
  const index = readIndex(userData);
  let mutated = false;
  for (const uuid of Object.keys(index.tracks)) {
    if (index.tracks[uuid].name === oldName) {
      index.tracks[uuid].name = newName;
      mutated = true;
    }
  }
  if (mutated) writeIndex(userData, index);
  return { ok: true };
}

function recordDelete(userData, name) {
  const index = readIndex(userData);
  let mutated = false;
  for (const uuid of Object.keys(index.tracks)) {
    if (index.tracks[uuid].name === name) {
      delete index.tracks[uuid];
      mutated = true;
    }
  }
  if (mutated) writeIndex(userData, index);
  return { ok: true };
}

module.exports = {
  INDEX_VERSION,
  hashFile,
  resolveHashes,
  readIndex,
  writeIndex,
  ensureIndex,
  findByName,
  findByHash,
  recordAdd,
  recordInsert,
  recordRename,
  recordDelete,
};
