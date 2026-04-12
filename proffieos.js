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

// Root folder containing all ProffieOS version subfolders.
function getVersionsRootPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'proffieOS_versions')
    : path.join(__dirname, 'resources', 'proffieOS_versions');
}

// Returns sorted list of available version names (subfolder names).
function listVersions() {
  const root = getVersionsRootPath();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

// ProffieOS source path for a given version name (read-only when packaged).
function getVersionSourcePath(versionName) {
  return path.join(getVersionsRootPath(), versionName, 'ProffieOS');
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
  const dest = path.join(getVersionsRootPath(), name, 'ProffieOS');
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
  CONFIG_FILENAME
};
