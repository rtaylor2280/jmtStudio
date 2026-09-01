// Shared Tracks Folder — a single, app-global folder that maps to /tracks/
// at the SD card root (ProffieOS prop_base.h ListTracks scans both
// /tracks/ and /<anydir>/tracks/, so a top-level /tracks/ folder is the
// universal-tracks location that doesn't require living inside a common
// folder). Flat structure: .wav files directly inside, arbitrary names.
// No tags/creator/source-link metadata — it's a curation surface, not a
// library entry.

const fs = require('fs');
const path = require('path');
const { copyTreeWithProgress, copyFileWithProgress } = require('./sfExportCopy');
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

// `onFileProgress({ done, total, name })` is OPTIONAL and fires once per file.
// Without it the caller can only report at FOLDER level, which on a tracks-only
// import means one unit of work: the bar sits at 0 and jumps to done, so a real
// copy of hundreds of megabytes looks like nothing is happening. (Ryan spotted it
// 2026-09-01: "might be doing the whole folder level rather than the files".)
function addFiles(userData, sourceFilePaths, onFileProgress) {
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
  // Tracks you ALREADY HAVE, by content. Reported separately from `skipped`,
  // which means "could not be added": having it already is a success, not a
  // failure. (2026-08-31 — [B-005] item 5.)
  //
  // WHY THIS WAS NEEDED. Every file used to be copied, and a name collision was
  // resolved by _uniqueName suffixing it — so re-importing the same card wrote
  // `track1_1.wav`, `track1_2.wav`, and the shared folder doubled every time.
  // `findByHash` has existed in soundFontSharedTracksHash the whole time and was
  // never called from here. Filename is not identity; content is.
  let _index = null;
  try { _index = hashIndex.ensureIndex(userData); } catch {}
  const duplicates = [];
  const _total = sourceFilePaths.length;
  let _done = 0;
  for (const entry of sourceFilePaths) {
    _done++;
    if (typeof onFileProgress === 'function') {
      const _n = (entry && typeof entry === 'object') ? (entry.name || entry.path) : entry;
      try { onFileProgress({ done: _done, total: _total, name: path.basename(String(_n || '')) }); } catch {}
    }
    // Either a path, or { path, name } when the caller has a name to land it under.
    // Bulk import's review lets the user rename a track before it is copied, and
    // that is the only moment the name can carry any context: this folder is one
    // flat global pool, so `track1.wav` from three cards is three collisions the
    // user can no longer tell apart afterwards. (2026-08-31.)
    const src = (entry && typeof entry === 'object') ? entry.path : entry;
    const wanted = (entry && typeof entry === 'object' && entry.name) ? entry.name : null;
    if (!src || !/\.wav$/i.test(src)) { skipped.push({ src, reason: 'Not a .wav file' }); continue; }
    const base = wanted || path.basename(src);
    const safe = _safeFileName(base);
    if (!safe) { skipped.push({ src, reason: 'Invalid filename' }); continue; }
    // Content check BEFORE the copy, so an identical track is never written and
    // never renamed. A hashing failure falls through to copying: not being able to
    // read a file is not evidence that we already have it.
    if (_index) {
      try {
        // ⚠️ findByHash returns an ARRAY of matches and `[]` when there are none.
        // An empty array is truthy, so a bare `if (hit)` reports every track as a
        // duplicate against an empty library — which is exactly what it did until
        // the test caught it. Check the length.
        const h = hashIndex.hashFile(src);
        const hits = h ? hashIndex.findByHash(_index, h) : null;
        if (hits && hits.length) { duplicates.push({ src, have: hits[0].name || '' }); continue; }
      } catch {}
    }
    const dest = _uniqueName(root, safe);
    try {
      fs.copyFileSync(src, path.join(root, dest));
      // Hash + record. Failure here doesn't abort the add — the file
      // is on disk and ensureIndex will backfill it on next read.
      try { hashIndex.recordAdd(userData, dest); } catch {}
      // Keep the in-memory index current within this call, so adding a batch
      // that contains the same track twice writes it once.
      if (_index) { try { _index = hashIndex.ensureIndex(userData); } catch {} }
      added.push(dest);
    } catch (err) {
      skipped.push({ src, reason: String(err && err.message || err) });
    }
  }
  return { ok: true, added, skipped, duplicates };
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

// Does this destination already have a tracks/ folder? One stat, no reads.
//
// This replaced a content-comparing matchesAt, which was removed 2026-08-27
// (B-168) once it had no callers. The export flow asks the user BEFORE comparing
// anything, because if they say leave it alone there is nothing to compare and
// the whole folder is skipped. Hashing to decide whether a question is worth
// asking is backwards when the answer can make the work unnecessary.
//
// If something later needs a real content comparison here, read the per-file
// hash records the way the rest of the export path does. Do not reinstate a
// whole-folder rehash.
function existsAt(destDir) {
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const destTracks = path.join(destDir, 'tracks');
  let exists = false;
  try { exists = fs.existsSync(destTracks) && fs.statSync(destTracks).isDirectory(); } catch {}
  return { ok: true, exists };
}

// What WOULD an export do? Read-only, writes nothing, so the caller can put a
// real decision in front of the user before anything is touched. Splitting plan
// from apply is what lets the differences dialog work the same way it does for
// font folders.
// onFile(name, done, total) is called per track as it is compared. Tracks are a
// FLAT list of many files, unlike a font folder which the caller can tick once
// per folder, so without this the scan sits on "shared tracks" while hashing a
// hundred-plus wavs and reads as frozen. The app's convention for a long read is
// filenames going past, not a stalled bar.
function planExport(userData, destDir, onFile = null) {
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const srcDir = sharedTracksRoot(userData);
  if (!fs.existsSync(srcDir)) return { ok: false, error: 'Shared tracks folder not found' };
  const targetDir = path.join(destDir, 'tracks');
  const toAdd = [], unchanged = [], differing = [];
  let names = [];
  try {
    names = fs.readdirSync(srcDir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.wav$/i.test(e.name))
      .map(e => e.name);
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }

  // LIBRARY SIDE: hashes were computed when each track was imported and are
  // trusted. The library is ours and every add, rename and delete goes through
  // the index, so re-deriving them would be reading gigabytes to learn what we
  // already wrote down.
  let libHashes = new Map();
  try { libHashes = hashIndex.resolveHashes(userData); } catch {}

  // DESTINATION SIDE: the manifest holds a hash per file. mtime is there for one
  // job only, to tell whether the user invalidated an entry. We look up ONLY the
  // files the library is about to write; anything else at the destination, in
  // the manifest or not, is none of this comparison's business.
  //
  // Self-healing: a file with no entry, or one whose entry is invalidated, gets
  // hashed — just that file — and its entry is refreshed. So a missing or stale
  // manifest costs exactly the reads it is missing, never a full pass.
  const sync = require('./sfSyncManifest');
  const { hashFile } = require('./soundFontFileHash');
  let cache = new Map();
  try { cache = sync.cacheFor(destDir, 'tracks'); } catch {}
  const refreshed = new Map();

  let done = 0;
  for (const name of names) {
    if (onFile) { try { onFile(name, done, names.length); } catch {} }
    done++;
    const dst = path.join(targetDir, name);
    let st = null;
    try { st = fs.statSync(dst); } catch { st = null; }
    if (!st) { toAdd.push(name); continue; }

    const mtime = Math.round(st.mtimeMs);
    const entry = cache.get(name);
    const valid = entry
      && entry[0] === st.size
      && Math.abs((entry[1] || 0) - mtime) <= sync.MTIME_TOLERANCE_MS;

    let destHash = valid ? entry[2] : hashFile(dst);
    refreshed.set(name, [st.size, mtime, destHash]);

    const libHash = libHashes.get(name) || hashFile(path.join(srcDir, name));
    (destHash && libHash && destHash === libHash ? unchanged : differing).push(name);
  }
  if (onFile) { try { onFile('', names.length, names.length); } catch {} }

  // Persist what we learned, merged over what was already recorded, so entries
  // for files we did not look at this time survive untouched.
  try { sync.mergeItem(destDir, 'tracks', refreshed); } catch {}

  return { ok: true, toAdd, unchanged, differing };
}

// ADDITIVE export. Deliberate call 2026-07-31: "always additive not replacing. so
// existing same hash files stay and anything new gets added."
//
// NOTHING AT THE DESTINATION IS EVER DELETED. That is the guarantee, and it
// includes tracks the library has never heard of — a card is the user's, not a
// mirror of our library.
//
// Per file:
//   * not there             -> copied
//   * there, byte-identical -> left alone
//   * there, DIFFERENT      -> the CALLER decides, per file, via `replace`
//
// That last case went through two wrong answers before this one. Proffie variant
// numbering (boot.wav -> boot2.wav) is wrong here: those are interchangeable
// alternatives picked at random, but a preset names exactly ONE track path, so
// mars2.wav would never play and would pile up another copy every export.
// Keeping the card's version silently was also wrong — the library is the
// curated source for these files, so a difference almost always means the user
// updated their copy and expects it to reach the card, and "keep" made the
// Update prompt contradict itself. So it asks, per file, defaulting to Replace.
async function exportToFolderAdditive(userData, destDir, opts = {}) {
  const { replace = [], onBytes = null } = opts;
  const plan = planExport(userData, destDir);
  if (!plan.ok) return plan;
  const srcDir = sharedTracksRoot(userData);
  const targetDir = path.join(destDir, 'tracks');
  try { fs.mkdirSync(targetDir, { recursive: true }); }
  catch (err) { return { ok: false, error: `Cannot create destination: ${err.message}` }; }

  const replaceSet = new Set(replace);
  const added = [], replaced = [], kept = [];
  const copy = async (name) => {
    await copyFileWithProgress(path.join(srcDir, name), path.join(targetDir, name), onBytes);
  };
  try {
    for (const name of plan.toAdd) { await copy(name); added.push(name); }
    for (const name of plan.differing) {
      if (replaceSet.has(name)) { await copy(name); replaced.push(name); }
      else kept.push(name);
    }
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }

  // Only record when the destination now matches the library exactly. If the
  // user kept a differing track, the folder is deliberately NOT our content, so
  // recording a hash for it would let a later export skip a real difference.
  // Refresh the recorded table from what is now on the card, so the next scan
  // can reuse it. Recorded whatever the outcome: it describes the DESTINATION,
  // not our library, so a track the user chose to keep is simply recorded as it
  // is and will be compared against the library again next time.
  // Refresh entries for the files we just wrote, and only those. Their content
  // is the library's, so the hash is the library's — already known, nothing to
  // re-read. Anything else recorded for this folder is left alone.
  try {
    const sync = require('./sfSyncManifest');
    const { hashFile } = require('./soundFontFileHash');
    const libHashes = hashIndex.resolveHashes(userData);
    const observed = new Map();
    for (const name of [...added, ...replaced]) {
      try {
        const st = fs.statSync(path.join(targetDir, name));
        const h = libHashes.get(name) || hashFile(path.join(srcDir, name));
        if (h) observed.set(name, [st.size, Math.round(st.mtimeMs), h]);
      } catch {}
    }
    sync.mergeItem(destDir, 'tracks', observed);
  } catch {}
  return { ok: true, destPath: targetDir, added, replaced, kept, unchanged: plan.unchanged };
}

// Copy the singleton sharedTracks folder into destDir/tracks/. Mirrors
// exportCommonToFolder's mode semantics (skip / replace / rename) so
// the bulk Export flow can treat tracks and common uniformly. SD card
// convention pins the destination name to literal "tracks" — rename
// mode bumps to "tracks_N" on collision since Proffie only matches
// the literal path.
//
// NOTE: 'rename' produces tracks_1, which ProffieOS will never read — neither
// the OS8 Edit Track menu (which scans root "tracks" and <dir>/tracks) nor
// Fett263's Track Player (which scans <fontdir>/tracks) will ever look there.
// It is staging, not a usable outcome. exportToFolderAdditive above is the
// better answer and is what the bulk flow now uses.
async function exportToFolder(userData, destDir, mode = 'rename', onBytes = null) {
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
    // contract). The .jmt-hashes.json sidecar stays in userData and never
    // ships to the SD card. Streamed copy with write-paced byte progress.
    await copyTreeWithProgress(srcDir, targetDir, {
      recurse: false,
      fileFilter: (name) => /\.wav$/i.test(name),
      onBytes,
    });
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
  existsAt,
  planExport,
  exportToFolder,
  exportToFolderAdditive,
  readFileBytes,
};
