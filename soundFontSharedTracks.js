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

// Only flat top-level .wav files count as track content. The library folder
// also carries a .jmt-hashes.json sidecar that never ships, so a comparison
// that included it would report every card as different.
function _wavOnly(relPath) {
  return !relPath.includes('/') && /\.wav$/i.test(relPath);
}

// Does destDir/tracks/ already hold exactly what we hold? Same discipline as
// commonMatchesAt: content is read, nothing is inferred from a sidecar or a
// remembered value, and anything unreadable comes back not-identical so the
// caller asks rather than assuming. Used to stay silent when a destination is
// already up to date, which is the one case where saying nothing is honest.
function matchesAt(userData, destDir) {
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const srcDir  = sharedTracksRoot(userData);
  const destTracks = path.join(destDir, 'tracks');

  let destExists = false;
  try { destExists = fs.existsSync(destTracks) && fs.statSync(destTracks).isDirectory(); } catch {}
  if (!destExists) return { ok: true, exists: false, identical: false, reason: 'missing' };
  if (!fs.existsSync(srcDir)) return { ok: true, exists: true, identical: false, reason: 'unreadable' };

  const { collectFileRecords, hashRecords } = require('./soundFontFileHash');
  const mine  = collectFileRecords(srcDir, null, _wavOnly);
  const theirs = collectFileRecords(destTracks, null, _wavOnly);
  if (!mine || !theirs) return { ok: true, exists: true, identical: false, reason: 'unreadable' };
  const identical = hashRecords(mine) === hashRecords(theirs);
  return { ok: true, exists: true, identical, reason: identical ? null : 'hash' };
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
  const { hashFile } = require('./soundFontFileHash');
  const toAdd = [], unchanged = [], differing = [];
  let names = [];
  try {
    names = fs.readdirSync(srcDir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.wav$/i.test(e.name))
      .map(e => e.name);
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  let done = 0;
  for (const name of names) {
    if (onFile) { try { onFile(name, done, names.length); } catch {} }
    const dst = path.join(targetDir, name);
    done++;
    if (!fs.existsSync(dst)) { toAdd.push(name); continue; }
    // Size first, and only as a NEGATIVE: different sizes prove a difference
    // with two stat calls and no reading. Matching sizes prove nothing, so they
    // fall through to the hash. Cuts the changed case to almost nothing; the
    // fully-synced case still reads, because there is no way to know two files
    // match without looking at them.
    const src = path.join(srcDir, name);
    let sameSize = true;
    try { sameSize = fs.statSync(src).size === fs.statSync(dst).size; } catch { sameSize = false; }
    if (!sameSize) { differing.push(name); continue; }
    let same = false;
    try { same = hashFile(src) === hashFile(dst); } catch { same = false; }
    (same ? unchanged : differing).push(name);
  }
  if (onFile) { try { onFile('', names.length, names.length); } catch {} }
  return { ok: true, toAdd, unchanged, differing };
}

// ADDITIVE export. Ryan's call 2026-07-31: "always additive not replacing. so
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
  matchesAt,
  planExport,
  exportToFolder,
  exportToFolderAdditive,
  readFileBytes,
};
