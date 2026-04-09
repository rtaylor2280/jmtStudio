/**
 * proffieos.js
 * Manages bundled ProffieOS source and config staging.
 * All paths are relative to process.resourcesPath (inside the Electron package).
 */

const { app } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Constants ──────────────────────────────────────────
const PROFFIE_VERSION   = '8.1';
const CONFIG_FILENAME   = 'my_config.h';

// In development (npm start), resources live in ./resources relative to project root.
// In production (packaged), they live in process.resourcesPath.
function getResourcesPath() {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, 'resources');
}

function getProffieOSRoot() {
  return path.join(getResourcesPath(), 'ProffieOS');
}

function getConfigStagingPath() {
  return path.join(getProffieOSRoot(), 'config', CONFIG_FILENAME);
}

function getInoPath() {
  return path.join(getProffieOSRoot(), 'ProffieOS.ino');
}

// ── Validation ─────────────────────────────────────────

/**
 * Checks that the ProffieOS source tree is present and minimally valid.
 * Returns { ok: true } or { ok: false, error: string }
 */
function validateProffieOSSource() {
  const root = getProffieOSRoot();

  if (!fs.existsSync(root)) {
    return { ok: false, error: `ProffieOS v${PROFFIE_VERSION} source not found at:\n${root}` };
  }

  const ino = getInoPath();
  if (!fs.existsSync(ino)) {
    return { ok: false, error: `ProffieOS.ino not found at:\n${ino}` };
  }

  const configDir = path.join(getProffieOSRoot(), 'config');
  if (!fs.existsSync(configDir)) {
    return { ok: false, error: `Config directory not found at:\n${configDir}` };
  }

  return { ok: true };
}

// ── Config staging ─────────────────────────────────────

/**
 * Writes the provided config content to the fixed staging path.
 * Validates that content is not empty before writing.
 * Returns { ok: true, stagedPath } or { ok: false, error: string }
 */
function stageConfig(configContent) {
  if (!configContent || configContent.trim() === '') {
    return { ok: false, error: 'Config is empty. Open or edit a config file before compiling.' };
  }

  const sourceCheck = validateProffieOSSource();
  if (!sourceCheck.ok) return sourceCheck;

  const stagingPath = getConfigStagingPath();

  try {
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

module.exports = {
  getProffieOSRoot,
  getConfigStagingPath,
  getInoPath,
  getResourcesPath,
  validateProffieOSSource,
  stageConfig,
  readStagedConfig,
  getInfo,
  PROFFIE_VERSION,
  CONFIG_FILENAME
};