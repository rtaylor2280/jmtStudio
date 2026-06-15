// Cross-location file operations for the Sound Fonts module. Unifies copy
// and move between any pair of locations: common-folder ↔ common-folder,
// common ↔ entry, entry ↔ entry. Source and destination are addressed by
// { kind, id } where:
//   kind === 'common'  → id is the common's uuid
//   kind === 'entry'   → id is the entry name (the on-disk dir name)
//
// Path resolution per kind:
//   common — userData/soundFonts/common/<uuid>/files/<subPath>
//   entry  — userData/soundFonts/library/<name>/<subPath>
//
// Both helpers validate the resolved path stays inside the location root
// to defend against any caller passing "../" sequences.

const fs = require('fs');
const path = require('path');

function _root(userData, kind, id) {
  if (!id) throw new Error('Missing location id');
  if (kind === 'common') return path.join(userData, 'soundFonts', 'common', id, 'files');
  if (kind === 'entry')  return path.join(userData, 'soundFonts', 'library', id);
  throw new Error(`Unknown location kind: ${kind}`);
}

function _resolve(userData, kind, id, subPath) {
  const root = path.resolve(_root(userData, kind, id));
  const target = path.resolve(root, String(subPath || '').replace(/\\/g, '/'));
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('Path escapes location root');
  }
  return target;
}

// Proffie-style variant naming with destination-aware convention. Scans
// the destination directory for files matching <base>\d*<ext>, finds the
// padding pattern in use (1/2/3-digit, or none), and walks from the
// highest existing N+1 using that padding. Preserves whatever convention
// the user has locally so a folder of boot01.wav/boot02.wav gets boot03,
// and a folder of boot.wav/boot2.wav gets boot3. Source's own padding
// raises the floor when wider than what's observed locally.
function _proffieVariantName(destDir, srcName) {
  if (!fs.existsSync(path.join(destDir, srcName))) return srcName;
  const ext = path.extname(srcName);
  const stem = path.basename(srcName, ext);
  const baseMatch = stem.match(/^(.*?)(\d*)$/);
  const base = (baseMatch && baseMatch[1]) || stem;
  const srcPad = (baseMatch && baseMatch[2]) ? baseMatch[2].length : 0;
  // Collect DISTINCT padding lengths observed locally. Multiple lengths
  // means the user's convention is mixed; fall back to plain 1, 2, 3
  // rather than guessing wrong.
  let maxNum = 0;
  const padLens = new Set();
  let entries;
  try { entries = fs.readdirSync(destDir); } catch { entries = []; }
  for (const file of entries) {
    if (path.extname(file) !== ext) continue;
    const fStem = path.basename(file, ext);
    if (fStem === base) { if (maxNum < 1) maxNum = 1; continue; }
    if (!fStem.startsWith(base)) continue;
    const rest = fStem.substring(base.length);
    if (!/^\d+$/.test(rest)) continue;
    const num = parseInt(rest, 10);
    if (num > maxNum) maxNum = num;
    padLens.add(rest.length);
  }
  let padLen;
  if (padLens.size === 0) padLen = srcPad;
  else if (padLens.size === 1) padLen = [...padLens][0];
  else padLen = 0; // Ambiguous → fall back to plain numbering.
  let n = maxNum + 1;
  while (true) {
    const candidate = `${base}${String(n).padStart(padLen, '0')}${ext}`;
    if (!fs.existsSync(path.join(destDir, candidate))) return candidate;
    n++;
  }
}

// Copy one or more files between locations of any kind. Collision-safe —
// destination names get " (N)" suffixed (filesystem-safe, used for
// transient app storage; SD-bound flows still use the Proffie-style
// numbering helpers). Returns { ok, added, failed } shape mirroring the
// existing copyCommonFiles contract so the renderer can treat it the same.
//
// src.kind === 'source' is async — files live inside an archive and have
// to be extracted on the fly. We branch up front so the on-disk kinds
// stay synchronous (their callers don't need to await anything extra).
async function copyAcrossLocations({
  userData,
  src,    // { kind, id }
  srcPaths,
  dest,   // { kind, id, subPath }
}) {
  if (!src || !src.kind || !src.id) return { ok: false, error: 'Missing src' };
  if (!dest || !dest.kind || !dest.id) return { ok: false, error: 'Missing dest' };
  if (!Array.isArray(srcPaths) || srcPaths.length === 0) {
    return { ok: false, error: 'No source paths' };
  }
  let destDir;
  try { destDir = _resolve(userData, dest.kind, dest.id, dest.subPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const destRoot = path.resolve(_root(userData, dest.kind, dest.id));
  const added = [];
  const failed = [];
  if (src.kind === 'source') {
    // Lazy require to avoid a circular dep at module load (sources →
    // candidates → ... eventually back into ops in some flows).
    const soundFontSources = require('./soundFontSources');
    for (const srcSubPath of srcPaths) {
      try {
        const baseName = String(srcSubPath).split('/').pop();
        if (!baseName) { failed.push({ source: srcSubPath, error: 'Invalid source path' }); continue; }
        const finalName = _proffieVariantName(destDir, baseName);
        await soundFontSources.extractSourceFileTo(userData, src.id, srcSubPath, destDir, finalName);
        const rel = path.relative(destRoot, path.join(destDir, finalName)).replace(/\\/g, '/');
        added.push(rel);
      } catch (err) {
        failed.push({ source: srcSubPath, error: String(err && err.message || err) });
      }
    }
    return { ok: true, added, failed };
  }
  for (const srcSubPath of srcPaths) {
    try {
      let srcAbs;
      try { srcAbs = _resolve(userData, src.kind, src.id, srcSubPath); }
      catch (err) { failed.push({ source: srcSubPath, error: err.message }); continue; }
      if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
        failed.push({ source: srcSubPath, error: 'Source file not found' });
        continue;
      }
      const finalName = _proffieVariantName(destDir, path.basename(srcAbs));
      const destPath = path.join(destDir, finalName);
      fs.copyFileSync(srcAbs, destPath);
      const rel = path.relative(destRoot, destPath).replace(/\\/g, '/');
      added.push(rel);
    } catch (err) {
      failed.push({ source: srcSubPath, error: String(err && err.message || err) });
    }
  }
  return { ok: true, added, failed };
}

// Move files within a single location (any kind). Same-dir source/dest is
// a silent no-op per item; cross-dir moves rename via fs.renameSync and
// collision-rename with " (N)" if needed.
function moveWithinLocation({
  userData,
  kind,
  id,
  sourcePaths,
  destSubPath,
}) {
  if (!kind || !id) return { ok: false, error: 'Missing location' };
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return { ok: false, error: 'No source paths' };
  }
  let destDir;
  try { destDir = _resolve(userData, kind, id, destSubPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const filesRoot = path.resolve(_root(userData, kind, id));
  const cleanDest = (destSubPath || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  const moved = [];
  const failed = [];
  for (const srcSubPath of sourcePaths) {
    try {
      let srcAbs;
      try { srcAbs = _resolve(userData, kind, id, srcSubPath); }
      catch (err) { failed.push({ source: srcSubPath, error: err.message }); continue; }
      if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
        failed.push({ source: srcSubPath, error: 'Source file not found' });
        continue;
      }
      const srcParts = srcSubPath.split('/'); srcParts.pop();
      const srcParent = srcParts.join('/');
      if (srcParent === cleanDest) {
        moved.push(srcSubPath);
        continue;
      }
      const finalName = _proffieVariantName(destDir, path.basename(srcAbs));
      const destPath = path.join(destDir, finalName);
      fs.renameSync(srcAbs, destPath);
      const rel = path.relative(filesRoot, destPath).replace(/\\/g, '/');
      moved.push(rel);
    } catch (err) {
      failed.push({ source: srcSubPath, error: String(err && err.message || err) });
    }
  }
  return { ok: true, moved, failed };
}

// Delete one or more files OR directories from a location. Directories
// are removed recursively; the UI is expected to confirm with the user
// before calling this (which it does — promptConfirm in both the entry
// and common folder right-click paths). Iterates and aggregates errors
// so a single broken path doesn't abort the whole batch.
function deleteFilesAt({ userData, kind, id, subPaths }) {
  if (!kind || !id) return { ok: false, error: 'Missing location' };
  if (!Array.isArray(subPaths) || subPaths.length === 0) {
    return { ok: false, error: 'No paths' };
  }
  const deleted = [];
  const failed = [];
  for (const sub of subPaths) {
    try {
      const target = _resolve(userData, kind, id, sub);
      if (!fs.existsSync(target)) { failed.push({ source: sub, error: 'Not found' }); continue; }
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.unlinkSync(target);
      }
      deleted.push(sub);
    } catch (err) {
      failed.push({ source: sub, error: String(err && err.message || err) });
    }
  }
  return { ok: true, deleted, failed };
}

// Rename a file OR folder in place at any location. New name is validated
// against path separators + filesystem-illegal chars; collisions return
// an error rather than auto-disambiguating so the user sees their typed
// name landed (or didn't). fs.renameSync handles both files and dirs
// identically.
function renameFileAt({ userData, kind, id, subPath, newName }) {
  if (!kind || !id) return { ok: false, error: 'Missing location' };
  if (!subPath) return { ok: false, error: 'Missing path' };
  const clean = String(newName || '').trim();
  if (!clean) return { ok: false, error: 'Name is required' };
  if (/[\\/]/.test(clean)) return { ok: false, error: 'Name cannot contain path separators' };
  if (/[<>:"|?*\x00-\x1f]/.test(clean)) return { ok: false, error: 'Name contains invalid characters' };
  let srcAbs;
  try { srcAbs = _resolve(userData, kind, id, subPath); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(srcAbs)) return { ok: false, error: 'Source not found' };
  const isDir = fs.statSync(srcAbs).isDirectory();
  const destAbs = path.join(path.dirname(srcAbs), clean);
  if (fs.existsSync(destAbs)) {
    return { ok: false, error: `A ${isDir ? 'folder' : 'file'} named "${clean}" already exists here` };
  }
  try { fs.renameSync(srcAbs, destAbs); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  const root = path.resolve(_root(userData, kind, id));
  const rel = path.relative(root, destAbs).replace(/\\/g, '/');
  return { ok: true, path: rel, isDir };
}

// Create an empty subfolder inside a location at the given parent path.
// Mirrors soundFontCommon.createCommonSubfolder for entries (and now for
// commons too via the unified IPC). Name validated for path separators
// and uniqueness within the parent.
function createSubfolderAt({ userData, kind, id, parentSubPath, name }) {
  if (!kind || !id) return { ok: false, error: 'Missing location' };
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, error: 'Name is required' };
  if (/[\\/]/.test(clean)) return { ok: false, error: 'Name cannot contain path separators' };
  if (/[<>:"|?*\x00-\x1f]/.test(clean)) return { ok: false, error: 'Name contains invalid characters' };
  let parentDir;
  try { parentDir = _resolve(userData, kind, id, parentSubPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(parentDir)) {
    try { fs.mkdirSync(parentDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create parent: ${err.message}` }; }
  }
  const newDir = path.join(parentDir, clean);
  if (fs.existsSync(newDir)) return { ok: false, error: `A folder named "${clean}" already exists here` };
  try { fs.mkdirSync(newDir); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  const rel = path.join(parentSubPath || '', clean).replace(/\\/g, '/');
  return { ok: true, path: rel };
}

// Add one or more files from external absolute paths into a location at
// the given subPath. Used by the "+ Add" affordance in both common
// folders and entries — picks files from disk, copies them in with
// Proffie-style variant naming on collision.
function addFilesAt({ userData, kind, id, subPath, sourceFilePaths }) {
  if (!kind || !id) return { ok: false, error: 'Missing location' };
  if (!Array.isArray(sourceFilePaths) || sourceFilePaths.length === 0) {
    return { ok: false, error: 'No source paths' };
  }
  let destDir;
  try { destDir = _resolve(userData, kind, id, subPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const destRoot = path.resolve(_root(userData, kind, id));
  const added = [];
  const failed = [];
  for (const src of sourceFilePaths) {
    try {
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
        failed.push({ source: src, error: 'Not a file' });
        continue;
      }
      const finalName = _proffieVariantName(destDir, path.basename(src));
      const destPath = path.join(destDir, finalName);
      fs.copyFileSync(src, destPath);
      const rel = path.relative(destRoot, destPath).replace(/\\/g, '/');
      added.push(rel);
    } catch (err) {
      failed.push({ source: src, error: String(err && err.message || err) });
    }
  }
  return { ok: true, added, failed };
}

module.exports = {
  copyAcrossLocations,
  moveWithinLocation,
  deleteFilesAt,
  renameFileAt,
  createSubfolderAt,
  addFilesAt,
};
