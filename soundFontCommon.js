// Sound Fonts — Common folder storage layer.
//
// A "common folder" is a parallel pool of shared .wav files that Proffie
// configs reference via the ";common" suffix on a preset's font field
// (e.g. "Father;common" layers the common pool on top of the Father font).
// Configurations almost always use one. Power users with multiple sabers
// may keep several variants (different voice packs, different languages).
//
// Storage layout under userData/soundFonts/common/:
//   <uuid>/
//     meta.json   — { schemaVersion, uuid, name, createdAt, importedFrom }
//     files/      — the actual wav files (and any nested subfolders like
//                   clrlst/) that get copied to <SD card>/common/ on Save.
//
// The "active" common folder (the one Save will include, and the one the
// in-config in-use indicator reads from) is tracked at the prefs level
// rather than per-common-meta so switching is a single atomic flip.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const StreamZip = require('node-stream-zip');

function commonRoot(userData) {
  return path.join(userData, 'soundFonts', 'common');
}

function ensureCommonRoot(userData) {
  const root = commonRoot(userData);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function _readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); }
  catch { return null; }
}

// Recursively walk a directory and yield file stats. Used for size + count
// rollups so the side panel can show "N files (M MB)" per common.
function _walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch {}
        out.push({ abs, rel: path.relative(dir, abs).replace(/\\/g, '/'), size });
      }
    }
  }
  return out;
}

// List every common folder on disk with a rollup of file count + total bytes
// so the side panel can render meaningful per-row meta without each row
// having to re-walk its own files.
function listCommons(userData) {
  const root = commonRoot(userData);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const meta = _readMeta(dir);
    if (!meta) continue;
    const files = _walkFiles(path.join(dir, 'files'));
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    // mmain.wav is the Proffie-convention "main voice" — a common
    // folder that ships one is auditionable via a quick-play affordance
    // in the side panel. Cheap check: walk already happened, just look
    // for the relative path. Case-insensitive in case a maker shipped
    // MMain.wav or similar.
    const hasMmain = files.some(f => String(f.rel).toLowerCase() === 'mmain.wav');
    out.push({ uuid: entry.name, meta, fileCount: files.length, totalBytes, hasMmain });
  }
  out.sort((a, b) => (a.meta.name || '').localeCompare(b.meta.name || ''));
  return out;
}

// Names are user-facing and must be unique (case-insensitive). Reserved
// against the existing set; null in `excludeUuid` lets a rename check skip
// itself when validating its own current name.
function nameInUse(userData, name, excludeUuid = null) {
  if (!name) return false;
  const lc = String(name).toLowerCase();
  for (const c of listCommons(userData)) {
    if (excludeUuid && c.uuid === excludeUuid) continue;
    if ((c.meta.name || '').toLowerCase() === lc) return true;
  }
  return false;
}

// Recursive folder copy used by import + duplicate. Files only (no symlinks,
// no device files). Throws on first I/O error so the caller can clean up
// the partial destination tree before surfacing the failure.
function _copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(srcDir, e.name);
    const destPath = path.join(destDir, e.name);
    if (e.isDirectory()) _copyDirRecursive(srcPath, destPath);
    else if (e.isFile()) fs.copyFileSync(srcPath, destPath);
  }
}

// Best-effort cleanup of a partial common dir on import failure.
function _cleanupPartial(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Find a sub-path within a directory tree whose basename is "common"
// (case-insensitive). Returns the absolute path or null. Used to detect
// the typical voicepack shape where wavs live one level down inside a
// "common" folder wrapped by an outer name like "ProffieOS_Voicepack_English_A".
function _findCommonSubfolder(rootDir) {
  if (!fs.existsSync(rootDir)) return null;
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const abs = path.join(cur, e.name);
      if (e.name.toLowerCase() === 'common') return abs;
      stack.push(abs);
    }
  }
  return null;
}

// Check whether a directory has at least one .wav file (recursively).
// Used as the "is this worth wrapping as a common folder" signal when the
// user-picked source doesn't have a recognizable "common" subfolder.
function _hasAnyWav(dir) {
  const files = _walkFiles(dir);
  return files.some(f => /\.wav$/i.test(f.rel));
}

// Import a common folder from a folder on disk. If the picked folder
// contains a "common" subfolder anywhere inside, that subfolder's contents
// become the new common's files. Otherwise — as long as there's at least
// one .wav somewhere under the picked folder — the entire picked folder
// is wrapped as the common (so a user who points at a loose folder of
// wavs gets the right result).
//
// Returns { ok: true, uuid, name } on success, { ok: false, error } on failure.
async function importCommonFromFolder(userData, folderPath, name) {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { ok: false, error: 'Source folder not found' };
  }
  const cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (nameInUse(userData, cleanName)) {
    return { ok: false, error: `A common folder named "${cleanName}" already exists` };
  }
  const sourceDir = _findCommonSubfolder(folderPath) || folderPath;
  // Sanity check: at least one .wav has to exist somewhere in the chosen
  // source dir, otherwise this isn't a sound asset folder at all.
  if (!_hasAnyWav(sourceDir)) {
    return { ok: false, error: 'No .wav files found in the picked folder' };
  }
  ensureCommonRoot(userData);
  const uuid = crypto.randomUUID();
  const uuidDir = path.join(commonRoot(userData), uuid);
  const filesDir = path.join(uuidDir, 'files');
  try {
    fs.mkdirSync(filesDir, { recursive: true });
    _copyDirRecursive(sourceDir, filesDir);
    const meta = {
      schemaVersion: 1,
      uuid,
      name: cleanName,
      createdAt: new Date().toISOString(),
      importedFrom: path.basename(folderPath),
    };
    fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify(meta, null, 2));
    // Stamp content hash at creation so surveyMerge / exportBackup
    // skip the per-item walk for this common on future calls.
    try { recomputeCommonContentHash(userData, uuid); } catch {}
    return { ok: true, uuid, name: cleanName };
  } catch (err) {
    _cleanupPartial(uuidDir);
    return { ok: false, error: `Import failed: ${err.message}` };
  }
}

// Import a common folder from a zip file. Extracts to a temp dir first,
// then defers to importCommonFromFolder so the same common-subfolder
// detection + wav presence checks apply.
async function importCommonFromZip(userData, zipPath, name) {
  if (!zipPath || !fs.existsSync(zipPath)) {
    return { ok: false, error: 'Source zip not found' };
  }
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-common-import-'));
  try {
    const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
    try {
      await zip.extract(null, tmpDir);
    } finally {
      try { await zip.close(); } catch {}
    }
    return await importCommonFromFolder(userData, tmpDir, name);
  } catch (err) {
    return { ok: false, error: `Could not read zip: ${err.message}` };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function getCommon(userData, uuid) {
  if (!uuid) return null;
  const dir = path.join(commonRoot(userData), uuid);
  const meta = _readMeta(dir);
  if (!meta) return null;
  const files = _walkFiles(path.join(dir, 'files'));
  return { uuid, meta, fileCount: files.length, totalBytes: files.reduce((s, f) => s + f.size, 0) };
}

// Group management. Each common folder optionally carries a `group`
// string in its meta.json — a free-form label used by the renderer
// to render commons in collapsible sections. Identity by name (not
// uuid) since groups are user-facing labels; renaming the group
// updates all member commons' meta.group field in place. Group order
// is a separate concern persisted as a renderer preference (see the
// SF settings keys); this module only owns the per-common membership.
function setCommonGroup(userData, uuid, groupName) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const clean = String(groupName || '').trim();
  const dir = path.join(commonRoot(userData), uuid);
  const metaPath = path.join(dir, 'meta.json');
  const meta = _readMeta(dir);
  if (!meta) return { ok: false, error: 'Common folder not found' };
  if (clean) meta.group = clean;
  else delete meta.group;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch (err) { return { ok: false, error: `Cannot write meta: ${err.message}` }; }
  return { ok: true };
}

// Apply a group label to many commons at once. Used by the "Group
// selected" multi-select action so a single backend call updates
// every member's meta in one pass.
function setCommonGroupMany(userData, uuids, groupName) {
  if (!Array.isArray(uuids) || uuids.length === 0) return { ok: false, error: 'No uuids provided' };
  for (const uuid of uuids) {
    const r = setCommonGroup(userData, uuid, groupName);
    if (!r.ok) return { ok: false, error: `Failed for ${uuid}: ${r.error}` };
  }
  return { ok: true, count: uuids.length };
}

// Rename a group across every common that has it. No-op if the new
// name is empty or matches the old name. Returns the number of
// commons that were updated.
function renameCommonGroup(userData, oldName, newName) {
  const oldClean = String(oldName || '').trim();
  const newClean = String(newName || '').trim();
  if (!oldClean) return { ok: false, error: 'Missing old group name' };
  if (!newClean) return { ok: false, error: 'New group name is required' };
  if (oldClean === newClean) return { ok: true, count: 0 };
  let updated = 0;
  for (const c of listCommons(userData)) {
    if ((c.meta.group || '') !== oldClean) continue;
    const r = setCommonGroup(userData, c.uuid, newClean);
    if (r.ok) updated++;
  }
  return { ok: true, count: updated };
}

// Delete a group — sets meta.group to empty on every member, leaving
// the commons themselves intact (they just become ungrouped).
function deleteCommonGroup(userData, groupName) {
  const clean = String(groupName || '').trim();
  if (!clean) return { ok: false, error: 'Missing group name' };
  let updated = 0;
  for (const c of listCommons(userData)) {
    if ((c.meta.group || '') !== clean) continue;
    const r = setCommonGroup(userData, c.uuid, '');
    if (r.ok) updated++;
  }
  return { ok: true, count: updated };
}

// Rename a common folder. Updates meta.json in place; the on-disk uuid
// directory is unchanged (uuid is the stable identifier; name is the
// user-facing label only). Validates the new name is non-empty and unique.
function renameCommon(userData, uuid, newName) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const cleanName = String(newName || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (nameInUse(userData, cleanName, uuid)) {
    return { ok: false, error: `A common folder named "${cleanName}" already exists` };
  }
  const dir = path.join(commonRoot(userData), uuid);
  const metaPath = path.join(dir, 'meta.json');
  const meta = _readMeta(dir);
  if (!meta) return { ok: false, error: 'Common folder not found' };
  meta.name = cleanName;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch (err) { return { ok: false, error: `Cannot write meta: ${err.message}` }; }
  return { ok: true };
}

// Duplicate a common folder. New uuid, new name (validated unique), same
// file contents copied byte-for-byte into the new dir's files/.
function duplicateCommon(userData, sourceUuid, newName) {
  if (!sourceUuid) return { ok: false, error: 'Missing source uuid' };
  const cleanName = String(newName || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (nameInUse(userData, cleanName)) {
    return { ok: false, error: `A common folder named "${cleanName}" already exists` };
  }
  const srcDir = path.join(commonRoot(userData), sourceUuid);
  if (!fs.existsSync(srcDir)) return { ok: false, error: 'Source common folder not found' };
  ensureCommonRoot(userData);
  const newUuid = crypto.randomUUID();
  const newDir = path.join(commonRoot(userData), newUuid);
  try {
    fs.mkdirSync(newDir, { recursive: true });
    _copyDirRecursive(path.join(srcDir, 'files'), path.join(newDir, 'files'));
    const sourceMeta = _readMeta(srcDir) || {};
    const meta = {
      schemaVersion: 1,
      uuid: newUuid,
      name: cleanName,
      createdAt: new Date().toISOString(),
      importedFrom: sourceMeta.name ? `Duplicate of ${sourceMeta.name}` : 'Duplicate',
    };
    fs.writeFileSync(path.join(newDir, 'meta.json'), JSON.stringify(meta, null, 2));
    try { recomputeCommonContentHash(userData, newUuid); } catch {}
    return { ok: true, uuid: newUuid, name: cleanName };
  } catch (err) {
    _cleanupPartial(newDir);
    return { ok: false, error: `Duplicate failed: ${err.message}` };
  }
}

function deleteCommon(userData, uuid) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const dir = path.join(commonRoot(userData), uuid);
  if (!fs.existsSync(dir)) return { ok: true, deleted: false };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, deleted: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Proffie-style variant numbering for wav file collisions. The Proffie
// firmware reads multi-variant sound effects from <name>.wav,
// <name>2.wav, <name>3.wav... (no spaces, no parens, no underscore —
// just the digit appended directly). Use this helper everywhere a wav
// file might collide on copy/move/add inside a common (the destination
// SD layout depends on these names being Proffie-readable).
//
//   destDir   absolute dir we're writing into
//   srcName   the source file's basename (e.g. "boot.wav" or "boot2.wav")
//
// Tries the source name first (round-trip identity wins when free), then
// strips any trailing digits from the stem to find the "base," and walks
// 2, 3, 4... until a free slot opens up. So copying "boot.wav" into a
// dir already holding "boot.wav" yields "boot2.wav"; doing it again
// yields "boot3.wav"; copying an existing "boot5.wav" into the same dir
// yields "boot6.wav" (or whatever's next free).
function _proffieVariantName(destDir, srcName) {
  if (!fs.existsSync(path.join(destDir, srcName))) return srcName;
  const ext = path.extname(srcName);
  const stem = path.basename(srcName, ext);
  // Base = source stem with any trailing digits stripped. Used to scan
  // the destination for existing variants and infer the local convention.
  const baseMatch = stem.match(/^(.*?)(\d*)$/);
  const base = (baseMatch && baseMatch[1]) || stem;
  const srcPad = (baseMatch && baseMatch[2]) ? baseMatch[2].length : 0;
  // Scan dest for files matching <base>\d*<ext>. Each contributes its
  // digit-suffix length (padding seen locally) and value (max number
  // already used). The "1" slot is implicit when a bare <base><ext>
  // exists with no digits — Proffie's first variant slot.
  // Collect the DISTINCT padding lengths observed in the dest so we can
  // detect convention vs. ambiguity. The bare-base file (e.g., "boot.wav"
  // alongside "boot2.wav") doesn't contribute to padLens — it's the
  // implicit slot 1 in any convention.
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
  else padLen = 0; // Ambiguous mix → fall back to plain 1, 2, 3...
  let n = maxNum + 1;
  while (true) {
    const candidate = `${base}${String(n).padStart(padLen, '0')}${ext}`;
    if (!fs.existsSync(path.join(destDir, candidate))) return candidate;
    n++;
  }
}

// Validate a sub-path stays inside a common's files/ root. Defensive
// against any caller passing "../" sequences or absolute paths.
function _resolveFilesPath(userData, uuid, subPath) {
  const root = path.resolve(commonRoot(userData), uuid, 'files');
  const target = path.resolve(root, String(subPath || '').replace(/\\/g, '/'));
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('Path escapes common folder');
  }
  return target;
}

// Tree-shaped listing of one common's files/, used by the file browser UI.
// Returns { name, isDir, path, size, children? } recursively. Sort: dirs
// first, then files, each alphabetical.
function listCommonFiles(userData, uuid) {
  const root = path.join(commonRoot(userData), uuid, 'files');
  if (!fs.existsSync(root)) return [];
  const walk = (dir, relBase) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }
    const out = [];
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ name: e.name, isDir: true, path: rel, children: walk(abs, rel) });
      } else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch {}
        out.push({ name: e.name, isDir: false, path: rel, size });
      }
    }
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      // Natural sort so numbered filenames land in human order.
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    return out;
  };
  return walk(root, '');
}

// Add one or more files into a common's files/ at the given subPath
// (default: root of files/). Files are copied; sources are left in place.
// Returns counts of added vs failed. Collisions are renamed with " (N)"
// suffix so an Add never silently overwrites an existing wav.
function addFilesToCommon(userData, uuid, subPath, sourceFilePaths) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  if (!Array.isArray(sourceFilePaths) || sourceFilePaths.length === 0) {
    return { ok: false, error: 'No source files provided' };
  }
  let destDir;
  try { destDir = _resolveFilesPath(userData, uuid, subPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const added = [];
  const failed = [];
  for (const src of sourceFilePaths) {
    try {
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
        failed.push({ source: src, error: 'Not a file' });
        continue;
      }
      const finalName = _proffieVariantName(destDir, path.basename(src));
      const dest = path.join(destDir, finalName);
      fs.copyFileSync(src, dest);
      added.push(path.basename(dest));
    } catch (err) {
      failed.push({ source: src, error: String(err && err.message || err) });
    }
  }
  if (added.length) {
    try { markCommonContentDirty(userData, uuid); } catch {}
  }
  return { ok: true, added, failed };
}

// Rename one file inside a common. Validates the new name doesn't collide
// with anything else in the same subfolder.
function renameCommonFile(userData, uuid, subPath, newName) {
  if (!uuid || !subPath) return { ok: false, error: 'Missing uuid or path' };
  const cleanName = String(newName || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (/[\\/]/.test(cleanName)) return { ok: false, error: 'Name cannot contain path separators' };
  let src, dest;
  try { src = _resolveFilesPath(userData, uuid, subPath); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(src)) return { ok: false, error: 'File not found' };
  dest = path.join(path.dirname(src), cleanName);
  if (fs.existsSync(dest)) return { ok: false, error: `A file named "${cleanName}" already exists here` };
  try {
    fs.renameSync(src, dest);
    try { markCommonContentDirty(userData, uuid); } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Delete one file (or empty folder) inside a common. Used by right-click
// from the file browser. Non-empty folders are intentionally rejected so
// the user has to clear them out deliberately rather than nuking a tree.
function deleteCommonFile(userData, uuid, subPath) {
  if (!uuid || !subPath) return { ok: false, error: 'Missing uuid or path' };
  let target;
  try { target = _resolveFilesPath(userData, uuid, subPath); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(target)) return { ok: false, error: 'Not found' };
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const contents = fs.readdirSync(target);
      if (contents.length > 0) {
        return { ok: false, error: 'Folder is not empty' };
      }
      fs.rmdirSync(target);
    } else {
      fs.unlinkSync(target);
    }
    try { markCommonContentDirty(userData, uuid); } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Create a new (empty) subfolder inside a common's files tree at the given
// parent path. Used by the "+ Folder" UI affordance. parentSubPath defaults
// to the files/ root when blank. Name validated for path separators and
// uniqueness within the parent.
function createCommonSubfolder(userData, uuid, parentSubPath, name) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (/[\\/]/.test(cleanName)) return { ok: false, error: 'Name cannot contain path separators' };
  let parentDir;
  try { parentDir = _resolveFilesPath(userData, uuid, parentSubPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(parentDir)) {
    try { fs.mkdirSync(parentDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create parent: ${err.message}` }; }
  }
  const newDir = path.join(parentDir, cleanName);
  if (fs.existsSync(newDir)) {
    return { ok: false, error: `A folder named "${cleanName}" already exists here` };
  }
  try {
    fs.mkdirSync(newDir);
    const rel = path.join(parentSubPath || '', cleanName).replace(/\\/g, '/');
    try { markCommonContentDirty(userData, uuid); } catch {}
    return { ok: true, path: rel };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Copy one or more files between commons (or within the same common, into
// a different subpath). Collision-safe — destination names get " (N)"
// suffixed until free. Returns the list of paths actually written, scoped
// to the destination common's files/ root, so the caller can select the
// newly-pasted set in the UI. Failures are itemized.
function copyCommonFiles(userData, sourceUuid, sourcePaths, destUuid, destSubPath) {
  if (!sourceUuid || !destUuid) return { ok: false, error: 'Missing uuids' };
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return { ok: false, error: 'No source paths' };
  }
  let destDir;
  try { destDir = _resolveFilesPath(userData, destUuid, destSubPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const destFilesRoot = path.join(commonRoot(userData), destUuid, 'files');
  const added = [];
  const failed = [];
  for (const srcSubPath of sourcePaths) {
    try {
      let srcAbs;
      try { srcAbs = _resolveFilesPath(userData, sourceUuid, srcSubPath); }
      catch (err) { failed.push({ source: srcSubPath, error: err.message }); continue; }
      if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
        failed.push({ source: srcSubPath, error: 'Source file not found' });
        continue;
      }
      const finalName = _proffieVariantName(destDir, path.basename(srcAbs));
      const destPath = path.join(destDir, finalName);
      fs.copyFileSync(srcAbs, destPath);
      const rel = path.relative(destFilesRoot, destPath).replace(/\\/g, '/');
      added.push(rel);
    } catch (err) {
      failed.push({ source: srcSubPath, error: String(err && err.message || err) });
    }
  }
  if (added.length) {
    try { markCommonContentDirty(userData, destUuid); } catch {}
  }
  return { ok: true, added, failed };
}

// Move files within a single common into a different subPath. Used when the
// user drags files between folders of the same common — semantically a
// rename, not a copy, so the source is removed. No-op (skipped, not failed)
// when a file is already in the destination dir. Collision-safe — destination
// names get " (N)" suffixed when a different file with the same name already
// exists at the destination.
function moveCommonFiles(userData, uuid, sourcePaths, destSubPath) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return { ok: false, error: 'No source paths' };
  }
  let destDir;
  try { destDir = _resolveFilesPath(userData, uuid, destSubPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const filesRoot = path.join(commonRoot(userData), uuid, 'files');
  const cleanDest = (destSubPath || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  const moved = [];
  const failed = [];
  let actuallyMoved = 0;
  for (const srcSubPath of sourcePaths) {
    try {
      let srcAbs;
      try { srcAbs = _resolveFilesPath(userData, uuid, srcSubPath); }
      catch (err) { failed.push({ source: srcSubPath, error: err.message }); continue; }
      if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
        failed.push({ source: srcSubPath, error: 'Source file not found' });
        continue;
      }
      // Already at destination — return the existing rel so the caller can
      // still select it, but don't actually move anything.
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
      actuallyMoved++;
    } catch (err) {
      failed.push({ source: srcSubPath, error: String(err && err.message || err) });
    }
  }
  if (actuallyMoved > 0) {
    try { markCommonContentDirty(userData, uuid); } catch {}
  }
  return { ok: true, moved, failed };
}

// Does a "common" folder already exist at this destination? Used by Save
// pre-scans so the conflict UI can include the common alongside font
// entries that would collide.
function commonFolderExistsAt(destDir) {
  if (!destDir) return false;
  try { return fs.existsSync(path.join(destDir, 'common')); }
  catch { return false; }
}

// Copy a common's files/ contents into destDir/<targetName>/. Mirrors
// soundFontEntries.exportEntryToFolder's mode semantics so the bulk Save
// flow can treat both uniformly. Target name is "common" by Proffie's SD
// convention; rename mode bumps to "common (N)" if collisions can't be
// avoided otherwise.
function exportCommonToFolder(userData, uuid, destDir, mode = 'rename') {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const srcDir = path.join(commonRoot(userData), uuid, 'files');
  if (!fs.existsSync(srcDir)) return { ok: false, error: `Common files not found: ${uuid}` };
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create destination: ${err.message}` }; }
  }
  let targetName = 'common';
  const exists = fs.existsSync(path.join(destDir, targetName));
  if (exists) {
    if (mode === 'skip') {
      return { ok: true, skipped: true, destPath: path.join(destDir, targetName) };
    }
    if (mode === 'replace') {
      try { fs.rmSync(path.join(destDir, targetName), { recursive: true, force: true }); }
      catch (err) { return { ok: false, error: `Cannot remove existing folder: ${err.message}` }; }
    } else {
      // Underscore (not parens) — folder names on SD ride the same
      // safety rule as font folders. The user-facing "rename" mode is
      // really staging, since Proffie only matches the literal "common"
      // folder; either way, _N is the safer suffix.
      let n = 1;
      while (fs.existsSync(path.join(destDir, targetName))) {
        targetName = `common_${n}`;
        n++;
      }
    }
  }
  const targetDir = path.join(destDir, targetName);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const walk = (curSrc, curDest) => {
      const items = fs.readdirSync(curSrc, { withFileTypes: true });
      for (const item of items) {
        const srcPath = path.join(curSrc, item.name);
        const destPath = path.join(curDest, item.name);
        if (item.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          walk(srcPath, destPath);
        } else if (item.isFile()) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };
    walk(srcDir, targetDir);
    return { ok: true, destPath: targetDir };
  } catch (err) {
    // Best-effort cleanup of a partial copy so the user doesn't end up with
    // half a common folder mixed in with their other content.
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Read raw bytes of a single file inside a common's files/ tree. Used by
// the in-app text viewer (.txt/.md/.rtf/etc. that may live alongside wavs).
// Path is validated via _resolveFilesPath to stay inside files/.
function readCommonFileBytes(userData, uuid, subPath) {
  if (!uuid || !subPath) throw new Error('Missing uuid or subPath');
  const target = _resolveFilesPath(userData, uuid, subPath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`File not found: ${subPath}`);
  }
  return fs.readFileSync(target);
}

// Walk a common's tree to count files + sum bytes, excluding the
// root-level meta.json (matches the content hash's scope). Same shape
// as the entry-side helper; used both for stamping the content hash
// and for the cheap-signal safety check.
function _walkCommonContentSignals(commonDir) {
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
  walk(commonDir, '');
  return { fileCount, totalBytes };
}

// Compute + persist the content hash for a common folder. Mirrors the
// entry-side helper exactly: hash the tree, walk the signals, write
// contentHash + contentFileCount + contentTotalBytes + contentHashedAt
// onto meta. Clears the dirty flag on success.
//
// Field naming: contentFileCount / contentTotalBytes are the canonical
// signal field names, shared with the sources + entries helpers so the
// persistent-hash contract is identical across all three buckets.
function recomputeCommonContentHash(userData, uuid) {
  if (!uuid) return null;
  const commonDir = path.join(commonRoot(userData), uuid);
  const metaPath = path.join(commonDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  const { hashItemDir } = require('./soundFontFileHash');
  const hash = hashItemDir(commonDir);
  if (!hash) return null;
  const { fileCount, totalBytes } = _walkCommonContentSignals(commonDir);
  meta.contentHash = hash;
  meta.contentFileCount = fileCount;
  meta.contentTotalBytes = totalBytes;
  meta.contentHashedAt = new Date().toISOString();
  meta.contentHashDirty = false;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
  return hash;
}

// Mark a common folder as content-modified — cheap meta.json write of
// one boolean. Set by every content-modifying op so the eventual
// rehash knows to recompute. Many ops collapse into one rehash.
function markCommonContentDirty(userData, uuid) {
  if (!uuid) return;
  const metaPath = path.join(commonRoot(userData), uuid, 'meta.json');
  if (!fs.existsSync(metaPath)) return;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return; }
  if (meta.contentHashDirty) return;
  meta.contentHashDirty = true;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
}

// Called from the renderer when a common-folder detail modal closes —
// triggers a batched rehash IF the common is flagged dirty. No-op
// otherwise.
function resolveCommonContentDirty(userData, uuid) {
  if (!uuid) return null;
  const metaPath = path.join(commonRoot(userData), uuid, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.contentHashDirty) return null;
  return recomputeCommonContentHash(userData, uuid);
}

// Trusted read of a common's content hash. Stored hash trusted when
// (a) meta.contentHashDirty is not set AND (b) the cheap-signal walk
// matches stored fileCount + totalBytes. Either failing forces a
// recompute. The dirty flag is the primary signal; the cheap-signal
// walk is the backup catch.
function getCommonContentHash(userData, uuid) {
  if (!uuid) return null;
  const commonDir = path.join(commonRoot(userData), uuid);
  const metaPath = path.join(commonDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.contentHashDirty
      && meta.contentHash
      && typeof meta.contentFileCount === 'number'
      && typeof meta.contentTotalBytes === 'number') {
    const live = _walkCommonContentSignals(commonDir);
    if (live.fileCount === meta.contentFileCount && live.totalBytes === meta.contentTotalBytes) {
      return meta.contentHash;
    }
  }
  return recomputeCommonContentHash(userData, uuid);
}

module.exports = {
  commonRoot,
  ensureCommonRoot,
  listCommons,
  getCommon,
  nameInUse,
  importCommonFromFolder,
  importCommonFromZip,
  renameCommon,
  duplicateCommon,
  deleteCommon,
  setCommonGroup,
  setCommonGroupMany,
  renameCommonGroup,
  deleteCommonGroup,
  listCommonFiles,
  addFilesToCommon,
  renameCommonFile,
  deleteCommonFile,
  createCommonSubfolder,
  copyCommonFiles,
  moveCommonFiles,
  readCommonFileBytes,
  commonFolderExistsAt,
  exportCommonToFolder,
  recomputeCommonContentHash,
  getCommonContentHash,
  markCommonContentDirty,
  resolveCommonContentDirty,
};
