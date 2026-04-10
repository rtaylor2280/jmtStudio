/**
 * proffieos.js
 * Manages bundled ProffieOS source and config staging.
 *
 * When packaged, ProffieOS source lives in process.resourcesPath (read-only
 * when installed to Program Files). On first launch, initWorkspace() copies
 * it to userData so the app can write my_config.h regardless of install location.
 */

const { app } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Constants ──────────────────────────────────────────
const PROFFIE_VERSION   = '8.1';
const CONFIG_FILENAME   = 'my_config.h';

// ── Path helpers ───────────────────────────────────────

// The bundled (read-only when packaged) ProffieOS source in resources.
function getResourcesProffieOSPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ProffieOS')
    : path.join(__dirname, 'resources', 'ProffieOS');
}

// The writable workspace in userData — only used when packaged.
// Must be named "ProffieOS" to match ProffieOS.ino (arduino-cli requires folder = sketch name).
function getWorkspacePath() {
  return path.join(app.getPath('userData'), 'ProffieOS');
}

// The root used for compilation and config staging.
// Dev: resources (already writable).
// Packaged: userData workspace (always writable).
function getProffieOSRoot() {
  return app.isPackaged ? getWorkspacePath() : getResourcesProffieOSPath();
}

function getConfigStagingPath() {
  return path.join(getProffieOSRoot(), 'config', CONFIG_FILENAME);
}

function getInoPath() {
  return path.join(getProffieOSRoot(), 'ProffieOS.ino');
}

// ── Workspace init (packaged only) ─────────────────────

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
 * Copies the bundled ProffieOS source to a writable userData workspace.
 * No-op in dev mode. Only copies if workspace doesn't exist yet.
 * Returns { ok: true } or { ok: false, error: string }
 */
function initWorkspace(onLog) {
  if (!app.isPackaged) return { ok: true };

  const workspace = getWorkspacePath();
  if (fs.existsSync(path.join(workspace, 'ProffieOS.ino'))) {
    return { ok: true }; // Already set up
  }

  const source = getResourcesProffieOSPath();
  if (onLog) onLog('Setting up ProffieOS workspace (first run)...', false);

  try {
    copyDirSync(source, workspace);
    if (onLog) onLog('Workspace ready.', false);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to set up ProffieOS workspace:\n${e.message}` };
  }
}

// ── Validation ─────────────────────────────────────────

/**
 * Validates the bundled ProffieOS source in resources (not the workspace).
 * Called before initWorkspace so we confirm the source exists before copying.
 */
function validateProffieOSSource() {
  const root = getResourcesProffieOSPath();

  if (!fs.existsSync(root)) {
    return { ok: false, error: `ProffieOS v${PROFFIE_VERSION} source not found at:\n${root}` };
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

// ── Config staging ─────────────────────────────────────

/**
 * Writes the provided config content to the workspace staging path.
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
 * Returns content string or null.
 */
function readStagedConfig() {
  const p = getConfigStagingPath();
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
  catch { return null; }
}

// ── Info ───────────────────────────────────────────────

function getInfo() {
  return {
    version:     PROFFIE_VERSION,
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
  getProffieOSRoot,
  getConfigStagingPath,
  getInoPath,
  getResourcesPath,
  validateProffieOSSource,
  initWorkspace,
  stageConfig,
  readStagedConfig,
  getInfo,
  PROFFIE_VERSION,
  CONFIG_FILENAME
};
