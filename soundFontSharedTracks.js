// Shared Tracks Folder — a single, app-global folder that maps to /tracks/
// at the SD card root (ProffieOS prop_base.h ListTracks scans both
// /tracks/ and /<anydir>/tracks/, so a top-level /tracks/ folder is the
// universal-tracks location that doesn't require living inside a common
// folder). Flat structure: .wav files directly inside, arbitrary names.
// No tags/creator/source-link metadata — it's a curation surface, not a
// library entry.

const fs = require('fs');
const path = require('path');
const hashIndex = require('./soundFontSharedTracksHash');

function sharedTracksRoot(userData) {
  return path.join(userData, 'soundFonts', 'sharedTracks');
}

function exists(userData) {
  try { return fs.statSync(sharedTracksRoot(userData)).isDirectory(); }
  catch { return false; }
}

function create(userData) {
  const root = sharedTracksRoot(userData);
  try {
    fs.mkdirSync(root, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Flat list of .wav files. Sorted natural so "track2" precedes "track10".
function listFiles(userData) {
  const root = sharedTracksRoot(userData);
  if (!exists(userData)) return [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.wav$/i.test(e.name)) continue;
    let size = 0;
    try { size = fs.statSync(path.join(root, e.name)).size; } catch {}
    out.push({ name: e.name, size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

// Sanitize a destination filename. Same conservative rules as Proffie-safe
// names elsewhere — spaces become underscores, then filesystem-disallowed
// characters get replaced, then length is capped. Extension preserved.
function _safeFileName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const ext = (trimmed.match(/\.[^.]+$/) || [''])[0];
  const stem = trimmed.slice(0, trimmed.length - ext.length);
  const safeStem = stem
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 100);
  return safeStem + ext.toLowerCase();
}

// Suggest a non-colliding filename. If "track.wav" exists, returns
// "track_1.wav", then "track_2.wav", etc.
function _uniqueName(root, desired) {
  if (!fs.existsSync(path.join(root, desired))) return desired;
  const ext = (desired.match(/\.[^.]+$/) || [''])[0];
  const stem = desired.slice(0, desired.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!fs.existsSync(path.join(root, candidate))) return candidate;
  }
  throw new Error('Could not find a non-colliding filename');
}

function addFiles(userData, sourceFilePaths) {
  if (!Array.isArray(sourceFilePaths) || sourceFilePaths.length === 0) {
    return { ok: false, error: 'No files supplied' };
  }
  if (!exists(userData)) {
    const cr = create(userData);
    if (!cr.ok) return cr;
  }
  const root = sharedTracksRoot(userData);
  const added = [];
  const skipped = [];
  for (const src of sourceFilePaths) {
    if (!/\.wav$/i.test(src)) { skipped.push({ src, reason: 'Not a .wav file' }); continue; }
    const base = path.basename(src);
    const safe = _safeFileName(base);
    if (!safe) { skipped.push({ src, reason: 'Invalid filename' }); continue; }
    const dest = _uniqueName(root, safe);
    try {
      fs.copyFileSync(src, path.join(root, dest));
      // Hash + record. Failure here doesn't abort the add — the file
      // is on disk and ensureIndex will backfill it on next read.
      try { hashIndex.recordAdd(userData, dest); } catch {}
      added.push(dest);
    } catch (err) {
      skipped.push({ src, reason: String(err && err.message || err) });
    }
  }
  return { ok: true, added, skipped };
}

function renameFile(userData, oldName, newName) {
  if (!oldName || !newName) return { ok: false, error: 'Missing name' };
  const safe = _safeFileName(newName);
  if (!safe) return { ok: false, error: 'Invalid filename' };
  if (!/\.wav$/i.test(safe)) return { ok: false, error: 'New name must end in .wav' };
  const root = sharedTracksRoot(userData);
  const src = path.join(root, oldName);
  const dst = path.join(root, safe);
  if (!fs.existsSync(src)) return { ok: false, error: 'Source file not found' };
  if (src === dst) return { ok: true, newName: safe };
  if (fs.existsSync(dst)) return { ok: false, error: 'A file with that name already exists' };
  try {
    fs.renameSync(src, dst);
    try { hashIndex.recordRename(userData, oldName, safe); } catch {}
    return { ok: true, newName: safe };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function deleteFile(userData, name) {
  if (!name) return { ok: false, error: 'Missing name' };
  const root = sharedTracksRoot(userData);
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return { ok: true }; // already gone — idempotent
  try {
    fs.unlinkSync(file);
    try { hashIndex.recordDelete(userData, name); } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Delete the entire folder (and its contents). Idempotent.
function deleteAll(userData) {
  const root = sharedTracksRoot(userData);
  if (!fs.existsSync(root)) return { ok: true };
  try {
    fs.rmSync(root, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Conflict-probe for the bulk Export flow — true when destDir already
// has a top-level `tracks` folder that an export would collide with.
function folderExistsAt(destDir) {
  if (!destDir) return false;
  try { return fs.existsSync(path.join(destDir, 'tracks')); }
  catch { return false; }
}

// Copy the singleton sharedTracks folder into destDir/tracks/. Mirrors
// exportCommonToFolder's mode semantics (skip / replace / rename) so
// the bulk Export flow can treat tracks and common uniformly. SD card
// convention pins the destination name to literal "tracks" — rename
// mode bumps to "tracks_N" on collision since Proffie only matches
// the literal path.
function exportToFolder(userData, destDir, mode = 'rename') {
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const srcDir = sharedTracksRoot(userData);
  if (!fs.existsSync(srcDir)) return { ok: false, error: 'Shared tracks folder not found' };
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create destination: ${err.message}` }; }
  }
  let targetName = 'tracks';
  const exists = fs.existsSync(path.join(destDir, targetName));
  if (exists) {
    if (mode === 'skip') {
      return { ok: true, skipped: true, destPath: path.join(destDir, targetName) };
    }
    if (mode === 'replace') {
      try { fs.rmSync(path.join(destDir, targetName), { recursive: true, force: true }); }
      catch (err) { return { ok: false, error: `Cannot remove existing folder: ${err.message}` }; }
    } else {
      let n = 1;
      while (fs.existsSync(path.join(destDir, targetName))) {
        targetName = `tracks_${n}`;
        n++;
      }
    }
  }
  const targetDir = path.join(destDir, targetName);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    // Flat folder — only .wav files at the top level (matches listFiles
    // contract). The .jmt-hashes.json sidecar stays in userData and
    // never ships to the SD card.
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (!/\.wav$/i.test(ent.name)) continue;
      const srcPath = path.join(srcDir, ent.name);
      const destPath = path.join(targetDir, ent.name);
      fs.copyFileSync(srcPath, destPath);
    }
    return { ok: true, destPath: targetDir };
  } catch (err) {
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Read a single file as bytes — used by the in-app audio player.
function readFileBytes(userData, name) {
  if (!name) return null;
  const root = sharedTracksRoot(userData);
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return null;
  try { return fs.readFileSync(file); }
  catch { return null; }
}

module.exports = {
  sharedTracksRoot,
  exists,
  create,
  listFiles,
  addFiles,
  renameFile,
  deleteFile,
  deleteAll,
  folderExistsAt,
  exportToFolder,
  readFileBytes,
};
