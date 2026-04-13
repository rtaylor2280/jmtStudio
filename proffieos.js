/**
 * proffieos.js
 * Manages bundled ProffieOS source versions and config staging.
 *
 * Versions live under resources/proffieOS_versions/{version_name}/ProffieOS/.
 * One version is "selected" per session; its ProffieOS folder is hashed once
 * and cached in memory for cache validation.
 *
 * When packaged, ProffieOS source lives in process.resourcesPath (read-only
 * when installed to Program Files). initWorkspace() copies the selected version
 * to userData so the app can write my_config.h regardless of install location.
 */

const { app } = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// ── Constants ──────────────────────────────────────────
const CONFIG_FILENAME = 'my_config.h';

// ── Version state ──────────────────────────────────────
let _selectedVersion = null;
const _hashCache = new Map(); // versionName → hash string

// ── Path helpers ───────────────────────────────────────

// Bundled versions path (read-only when packaged in Program Files).
function getBundledVersionsPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'proffieOS_versions')
    : path.join(__dirname, 'resources', 'proffieOS_versions');
}

// User-imported versions path (always writable, survives reinstalls).
function getUserVersionsPath() {
  return path.join(app.getPath('userData'), 'proffieOS_versions');
}

// Legacy alias — kept for internal callers that haven't been updated.
function getVersionsRootPath() { return getBundledVersionsPath(); }

// Internal: resolves which root a version folder lives in.
function _resolveVersionFolder(name) {
  const userPath    = path.join(getUserVersionsPath(), name);
  if (fs.existsSync(userPath)) return { folderPath: userPath, source: 'user' };
  const bundledPath = path.join(getBundledVersionsPath(), name);
  if (fs.existsSync(bundledPath)) return { folderPath: bundledPath, source: 'bundled' };
  return null;
}

// Returns version names: bundled first (alphabetical), then user versions
// ordered by folder creation time oldest → newest.
function listVersions() {
  const bundled = [];
  const user    = [];

  const bundledRoot = getBundledVersionsPath();
  if (fs.existsSync(bundledRoot)) {
    fs.readdirSync(bundledRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .forEach(e => bundled.push(e.name));
  }
  bundled.sort();

  const userRoot = getUserVersionsPath();
  if (fs.existsSync(userRoot)) {
    fs.readdirSync(userRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .forEach(e => {
        let ctime = 0;
        try { ctime = fs.statSync(path.join(userRoot, e.name)).ctimeMs; } catch {}
        user.push({ name: e.name, ctime });
      });
  }
  user.sort((a, b) => a.ctime - b.ctime);

  // Deduplicate: bundled names take precedence
  const seen = new Set(bundled);
  return [...bundled, ...user.filter(v => !seen.has(v.name)).map(v => v.name)];
}

// ProffieOS source path for a given version name (read-only when packaged).
function getVersionSourcePath(versionName) {
  const resolved = _resolveVersionFolder(versionName);
  return resolved ? path.join(resolved.folderPath, 'ProffieOS') : path.join(getBundledVersionsPath(), versionName, 'ProffieOS');
}

// ── Version selection ──────────────────────────────────

function setSelectedVersion(name) {
  _selectedVersion = name;
}

function getSelectedVersion() {
  if (_selectedVersion) return _selectedVersion;
  const versions = listVersions();
  return versions.length > 0 ? versions[0] : null;
}

// ── Folder hashing ─────────────────────────────────────

/**
 * Recursively hashes all files in a directory, sorted by relative path
 * for stability. Returns a 16-char hex string.
 * Result is cached in memory by versionName — computed at most once per session.
 */
function hashVersion(versionName) {
  if (_hashCache.has(versionName)) return _hashCache.get(versionName);

  const dirPath = getVersionSourcePath(versionName);
  const hash    = crypto.createHash('sha256');

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel      = path.relative(dirPath, fullPath);
      if (entry.isDirectory()) {
        // Skip config/ — it's the user-variable slot, tracked separately by configHash
        if (entry.name === 'config' && dir === dirPath) continue;
        walk(fullPath);
      } else {
        hash.update(rel + '\0');
        // For ProffieOS.ino, skip the CONFIG_FILE define line — we manage that
        // line ourselves via ensureConfigFileRef(), so it must not affect the hash.
        if (entry.name === 'ProffieOS.ino' && dir === dirPath) {
          const content = fs.readFileSync(fullPath, 'utf8')
            .split(/\r?\n/)
            .filter(l => !/^\s*(?:\/\/)?\s*#\s*define\s+CONFIG_FILE\b/.test(l))
            .join('\n');
          hash.update(content);
        } else {
          hash.update(fs.readFileSync(fullPath));
        }
        hash.update('\0');
      }
    }
  }

  walk(dirPath);
  const result = hash.digest('hex').slice(0, 16);
  _hashCache.set(versionName, result);
  return result;
}

// ── Workspace (packaged only) ──────────────────────────

// The writable workspace in userData — must be named "ProffieOS" to match
// ProffieOS.ino (arduino-cli requires the folder to match the sketch name).
function getWorkspacePath() {
  return path.join(app.getPath('userData'), 'ProffieOS');
}

// Tracks which version is currently copied into the workspace.
function getWorkspaceVersionFilePath() {
  return path.join(getWorkspacePath(), '_version.txt');
}

function getWorkspaceVersion() {
  const p = getWorkspaceVersionFilePath();
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null; }
  catch { return null; }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Ensures the selected version is in the writable workspace.
 * No-op in dev (source is already writable).
 * Re-copies if the workspace holds a different version.
 */
function initWorkspace(onLog) {
  if (!app.isPackaged) return { ok: true };

  const version = getSelectedVersion();
  if (!version) return { ok: false, error: 'No ProffieOS version available.' };

  const workspace        = getWorkspacePath();
  const workspaceVersion = getWorkspaceVersion();

  if (workspaceVersion === version && fs.existsSync(path.join(workspace, 'ProffieOS.ino'))) {
    return { ok: true };
  }

  const source = getVersionSourcePath(version);
  if (onLog) onLog(`Setting up ProffieOS workspace for ${version}...`, false);

  try {
    if (fs.existsSync(workspace)) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
    copyDirSync(source, workspace);
    fs.writeFileSync(getWorkspaceVersionFilePath(), version, 'utf8');
    if (onLog) onLog('Workspace ready.', false);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to set up ProffieOS workspace:\n${e.message}` };
  }
}

// ── Compile paths ──────────────────────────────────────

// The root used for compilation and config staging.
function getProffieOSRoot() {
  if (app.isPackaged) return getWorkspacePath();
  const version = getSelectedVersion();
  return version ? getVersionSourcePath(version) : null;
}

function getConfigStagingPath() {
  return path.join(getProffieOSRoot(), 'config', CONFIG_FILENAME);
}

function getInoPath() {
  return path.join(getProffieOSRoot(), 'ProffieOS.ino');
}

// ── Validation ─────────────────────────────────────────

/**
 * Validates the selected version's source in resources.
 * Called before initWorkspace to confirm source exists before copying.
 */
function validateProffieOSSource() {
  const version = getSelectedVersion();
  if (!version) {
    return { ok: false, error: `No ProffieOS versions found in:\n${getVersionsRootPath()}` };
  }

  const root = getVersionSourcePath(version);
  if (!fs.existsSync(root)) {
    return { ok: false, error: `ProffieOS source not found at:\n${root}` };
  }

  const ino = path.join(root, 'ProffieOS.ino');
  if (!fs.existsSync(ino)) {
    return { ok: false, error: `ProffieOS.ino not found at:\n${ino}` };
  }

  const configDir = path.join(root, 'config');
  if (!fs.existsSync(configDir)) {
    return { ok: false, error: `Config directory not found at:\n${configDir}` };
  }

  return { ok: true };
}

// ── CONFIG_FILE reference guard ────────────────────────

/**
 * Ensures ProffieOS.ino has exactly one correct #define CONFIG_FILE line.
 * - If correct line exists and no others → no-op
 * - If correct line exists but others also present → comment out the others
 * - If correct line is absent → insert it before the first existing define (or
 *   after the opening comment block if none exist), comment out any wrong ones
 */
function ensureConfigFileRef(onLog) {
  const inoPath = getInoPath();
  let content;
  try { content = fs.readFileSync(inoPath, 'utf8'); }
  catch (e) { return { ok: false, error: `Cannot read ProffieOS.ino: ${e.message}` }; }

  const targetDefine  = `#define CONFIG_FILE "config/${CONFIG_FILENAME}"`;
  const lineEnding    = content.includes('\r\n') ? '\r\n' : '\n';
  const lines         = content.split(/\r?\n/);

  const isDefine  = l => /^\s*#\s*define\s+CONFIG_FILE\b/.test(l);
  const isCorrect = l => /^\s*#\s*define\s+CONFIG_FILE\s+"config\/my_config\.h"\s*$/.test(l);

  const defineIdxs = lines.reduce((acc, l, i) => { if (isDefine(l)) acc.push(i); return acc; }, []);
  const correctIdx = defineIdxs.find(i => isCorrect(lines[i]));

  // Already exactly right — nothing to do
  if (defineIdxs.length === 1 && correctIdx !== undefined) return { ok: true };

  const newLines = [...lines];
  let changed = false;

  // Comment out all wrong CONFIG_FILE defines
  defineIdxs.forEach(i => {
    if (!isCorrect(newLines[i])) {
      newLines[i] = `// ${newLines[i].trim()} // [JMT Studio: replaced]`;
      changed = true;
    }
  });

  // Insert correct define if missing
  if (correctIdx === undefined) {
    let insertAt;
    if (defineIdxs.length > 0) {
      insertAt = defineIdxs[0]; // before first existing (now-commented) define
    } else {
      // No existing defines — insert after opening comment block
      insertAt = 0;
      for (let i = 0; i < newLines.length; i++) {
        const t = newLines[i].trim();
        if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) {
          insertAt = i + 1;
        } else {
          break;
        }
      }
    }
    newLines.splice(insertAt, 0, targetDefine);
    changed = true;
  }

  if (!changed) return { ok: true };

  try {
    fs.writeFileSync(inoPath, newLines.join(lineEnding), 'utf8');
    if (onLog) onLog('CONFIG_FILE reference corrected in ProffieOS.ino.', false);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Cannot write ProffieOS.ino: ${e.message}` };
  }
}

// ── Config staging ─────────────────────────────────────

/**
 * Writes config content to the workspace staging path.
 * Returns { ok: true, stagedPath } or { ok: false, error: string }
 */
function stageConfig(configContent) {
  if (!configContent || configContent.trim() === '') {
    return { ok: false, error: 'Config is empty. Open or edit a config file before compiling.' };
  }

  const stagingPath = getConfigStagingPath();

  try {
    fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
    fs.writeFileSync(stagingPath, configContent, 'utf8');
    return { ok: true, stagedPath: stagingPath };
  } catch (e) {
    return { ok: false, error: `Failed to stage config:\n${e.message}` };
  }
}

/**
 * Reads the currently staged config back (for verification or display).
 */
function readStagedConfig() {
  const p = getConfigStagingPath();
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
  catch { return null; }
}

// ── Import ─────────────────────────────────────────────

/**
 * Copies an existing ProffieOS source folder into the versions directory
 * under a user-supplied name. sourcePath must be a folder named "ProffieOS"
 * containing ProffieOS.ino.
 */
function importVersion(sourcePath, versionName) {
  if (path.basename(sourcePath) !== 'ProffieOS') {
    return { ok: false, error: 'Selected folder must be named "ProffieOS".' };
  }
  const name = (versionName || '').trim();
  if (!name) {
    return { ok: false, error: 'Version name is required.' };
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    return { ok: false, error: 'Version name contains invalid characters.' };
  }
  if (!fs.existsSync(path.join(sourcePath, 'ProffieOS.ino'))) {
    return { ok: false, error: 'Selected folder does not contain ProffieOS.ino — is this a valid ProffieOS source?' };
  }
  const dest = path.join(getUserVersionsPath(), name, 'ProffieOS');
  if (fs.existsSync(dest)) {
    return { ok: false, error: `A version named "${name}" already exists.` };
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    copyDirSync(sourcePath, dest);
    return { ok: true, versionName: name };
  } catch (e) {
    return { ok: false, error: `Import failed: ${e.message}` };
  }
}

// ── Info ───────────────────────────────────────────────

function getInfo() {
  const version = getSelectedVersion();
  return {
    version:     version || '—',
    root:        getProffieOSRoot(),
    inoPath:     getInoPath(),
    configPath:  getConfigStagingPath(),
    sourceValid: validateProffieOSSource().ok
  };
}

// ── Version metadata ───────────────────────────────────

function _dirSizeSync(p) {
  if (!fs.existsSync(p)) return 0;
  return fs.readdirSync(p, { withFileTypes: true }).reduce((sum, e) => {
    const full = path.join(p, e.name);
    return sum + (e.isDirectory() ? _dirSizeSync(full) : fs.statSync(full).size);
  }, 0);
}

function getNotesPath(versionName) {
  const resolved = _resolveVersionFolder(versionName);
  return resolved ? path.join(resolved.folderPath, 'notes.txt') : null;
}

function readNotes(versionName) {
  const p = getNotesPath(versionName);
  if (!p || !fs.existsSync(p)) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function writeNotes(versionName, content) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  try {
    fs.writeFileSync(path.join(resolved.folderPath, 'notes.txt'), content, 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function listVersionsDetails() {
  return listVersions().map(name => {
    const resolved = _resolveVersionFolder(name);
    if (!resolved) return null;
    const { folderPath, source } = resolved;
    // Only versions that ship with the app and carry the (+JMT) marker are
    // treated as built-in (protected from rename/delete). Versions manually
    // placed in the bundled folder during dev are treated as user versions.
    const isBuiltIn = source === 'bundled' && name.includes('(+JMT)');
    const notes = readNotes(name);
    let modified = null;
    try { modified = fs.statSync(folderPath).mtime.toISOString(); } catch {}
    return {
      name,
      isBuiltIn,
      source,
      size: _dirSizeSync(folderPath),
      modified,
      notes,
      notesPreview: notes ? notes.split('\n').find(l => l.trim()) || null : null,
    };
  }).filter(Boolean);
}

// ── Version operations ─────────────────────────────────

function _validateVersionName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Name cannot be empty.';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(trimmed)) return 'Name contains invalid characters.';
  return null;
}

function renameVersion(oldName, newName) {
  const resolved = _resolveVersionFolder(oldName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  if (resolved.source === 'bundled' && oldName.includes('(+JMT)')) return { ok: false, error: 'Built-in versions cannot be renamed.' };
  const err = _validateVersionName(newName);
  if (err) return { ok: false, error: err };
  const trimmed = newName.trim();
  const destPath = path.join(getUserVersionsPath(), trimmed);
  if (fs.existsSync(destPath)) return { ok: false, error: `A version named "${trimmed}" already exists.` };
  try {
    fs.renameSync(resolved.folderPath, destPath);
    return { ok: true, newName: trimmed };
  } catch (e) { return { ok: false, error: e.message }; }
}

function duplicateVersion(versionName, newName) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const err = _validateVersionName(newName);
  if (err) return { ok: false, error: err };
  const trimmed = newName.trim();
  if (_resolveVersionFolder(trimmed)) return { ok: false, error: `A version named "${trimmed}" already exists.` };
  const destPath = path.join(getUserVersionsPath(), trimmed);
  try {
    copyDirSync(resolved.folderPath, destPath);
    return { ok: true, newName: trimmed };
  } catch (e) { return { ok: false, error: e.message }; }
}

function deleteVersion(versionName) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  if (resolved.source === 'bundled' && versionName.includes('(+JMT)')) return { ok: false, error: 'Built-in versions cannot be deleted.' };
  try {
    fs.rmSync(resolved.folderPath, { recursive: true, force: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function listVersionDir(versionName, subPath) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const fullPath = subPath ? path.join(resolved.folderPath, subPath) : resolved.folderPath;
  if (!fullPath.startsWith(resolved.folderPath)) return { ok: false, error: 'Invalid path.' };
  if (!fs.existsSync(fullPath)) return { ok: false, error: 'Path not found.' };
  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        size: e.isFile() ? fs.statSync(path.join(fullPath, e.name)).size : null,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    return { ok: true, entries };
  } catch (e) { return { ok: false, error: e.message }; }
}

function readVersionFile(versionName, subPath) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const fullPath = path.join(resolved.folderPath, subPath);
  if (!fullPath.startsWith(resolved.folderPath)) return { ok: false, error: 'Invalid path.' };
  try {
    const stats = fs.statSync(fullPath);
    if (stats.size > 2 * 1024 * 1024) return { ok: false, error: 'File too large to preview (> 2 MB).' };
    const content = fs.readFileSync(fullPath, 'utf8');
    return { ok: true, content };
  } catch (e) { return { ok: false, error: e.message }; }
}

const _SEARCH_TEXT_EXTS = new Set([
  'h','cpp','c','ino','cc','md','txt','py','sh','bat',
  'json','yml','yaml','xml','html','css','js','ts',
  'gitignore','gitattributes','mk','makefile',
]);
const _SEARCH_MAX_FILE_BYTES = 512 * 1024; // skip files > 512 KB

function searchVersionFiles(versionName, query) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const searchRoot = path.join(resolved.folderPath, 'ProffieOS');
  if (!fs.existsSync(searchRoot)) return { ok: false, error: 'ProffieOS directory not found.' };
  const q = (query || '').toLowerCase().trim();
  if (!q) return { ok: true, results: [] };
  const results = [];
  (function walk(dir, relPath) {
    if (results.length >= 300) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= 300) return;
      const rel = relPath ? `${relPath}/${e.name}` : e.name;
      const fullEntry = path.join(dir, e.name);
      const nameLower = e.name.toLowerCase();
      const nameMatch = nameLower.includes(q);
      if (e.isDirectory()) {
        if (nameMatch) results.push({ name: e.name, path: `ProffieOS/${rel}`, type: 'dir', size: null, matchType: 'name', matchCount: 0, matchLine: null });
        walk(fullEntry, rel);
      } else {
        let size = null;
        try { size = fs.statSync(fullEntry).size; } catch {}
        if (nameMatch) {
          results.push({ name: e.name, path: `ProffieOS/${rel}`, type: 'file', size, matchType: 'name', matchCount: 0, matchLine: null });
        } else {
          // Content search — only for known text extensions within size limit
          const ext = (nameLower.split('.').pop() || '').toLowerCase();
          if (_SEARCH_TEXT_EXTS.has(ext) && size != null && size <= _SEARCH_MAX_FILE_BYTES) {
            try {
              const text = fs.readFileSync(fullEntry, 'utf8');
              let matchCount = 0, firstLine = null;
              for (const line of text.split('\n')) {
                if (line.toLowerCase().includes(q)) {
                  matchCount++;
                  if (!firstLine) firstLine = line.trim().slice(0, 140);
                }
              }
              if (matchCount > 0) {
                results.push({ name: e.name, path: `ProffieOS/${rel}`, type: 'file', size, matchType: 'content', matchCount, matchLine: firstLine });
              }
            } catch {}
          }
        }
      }
    }
  })(searchRoot, '');
  return { ok: true, results };
}

// Returns the top-level resources directory (arduino-cli, tools, etc.)
function getResourcesPath() {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, 'resources');
}

module.exports = {
  listVersions,
  getSelectedVersion,
  setSelectedVersion,
  hashVersion,
  getProffieOSRoot,
  getConfigStagingPath,
  getInoPath,
  getResourcesPath,
  validateProffieOSSource,
  initWorkspace,
  ensureConfigFileRef,
  stageConfig,
  readStagedConfig,
  importVersion,
  getInfo,
  CONFIG_FILENAME,
  listVersionsDetails,
  readNotes,
  writeNotes,
  renameVersion,
  duplicateVersion,
  deleteVersion,
  listVersionDir,
  readVersionFile,
  searchVersionFiles,
  getBundledVersionsPath,
  getUserVersionsPath,
};
