/**
 * cacheManager.js
 * Persistent compiled-build caching for JMT Studio.
 *
 * Cache identity is composed of two independent parts:
 *   1. Config hash  — SHA-256 of the config content (metadata lines stripped)
 *   2. Build package hash — SHA-256 of FQBN + USB mode + core version
 *
 * Cache layout:
 *   {userData}/build-cache/
 *     {buildPkgHash}/
 *       manifest.json          ← human-readable build package identity
 *       {configHash}/
 *         <all build output files>
 *         metadata.json        ← both hashes + build context
 */

const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const { app } = require('electron');

// Must stay in sync with CORE_VERSION in toolchain.js
const CORE_VERSION = '4.6.0';

// ── Paths ──────────────────────────────────────────────

function getCacheRoot() {
  return path.join(app.getPath('userData'), 'build-cache');
}

function getCacheDir(buildPkgHash, configHash) {
  return path.join(getCacheRoot(), buildPkgHash, configHash);
}

function getBuildOutputPath() {
  return path.join(app.getPath('userData'), 'build-output');
}

// ── Hashing ────────────────────────────────────────────

/**
 * Computes a stable hash of config content.
 * Strips @jmt: metadata lines before hashing — timestamp/board changes
 * on save do not represent a meaningful config change.
 */
function computeConfigHash(content) {
  const stripped = content
    .split('\n')
    .filter(l => {
      const t = l.trim();
      return !t.startsWith('// @jmt:') && t !== '// Jedi Master Tech';
    })
    .join('\n')
    .trim();
  return crypto.createHash('sha256').update(stripped, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Computes a stable hash of the build package identity.
 * Any change to FQBN, USB mode, or core version produces a new hash.
 */
function computeBuildPackageHash(fqbn, usb) {
  const identity = `fqbn=${fqbn}|usb=${usb}|core=${CORE_VERSION}`;
  return crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 16);
}

// ── Cache write ────────────────────────────────────────

/**
 * Copies all files from buildOutputPath into the cache directory
 * and writes a metadata.json with both identity hashes and build context.
 */
function saveToCache(buildOutputPath, configHash, buildPkgHash, meta) {
  const cacheDir = getCacheDir(buildPkgHash, configHash);
  fs.mkdirSync(cacheDir, { recursive: true });

  // Write build package manifest once per package (human-readable)
  const pkgDir      = path.join(getCacheRoot(), buildPkgHash);
  const pkgManifest = path.join(pkgDir, 'manifest.json');
  if (!fs.existsSync(pkgManifest)) {
    fs.writeFileSync(pkgManifest, JSON.stringify({
      buildPkgHash,
      fqbn:        meta.fqbn,
      usb:         meta.usb,
      coreVersion: CORE_VERSION,
    }, null, 2), 'utf8');
  }

  // Copy all build output files into cache
  if (fs.existsSync(buildOutputPath)) {
    for (const entry of fs.readdirSync(buildOutputPath, { withFileTypes: true })) {
      if (entry.isFile()) {
        fs.copyFileSync(
          path.join(buildOutputPath, entry.name),
          path.join(cacheDir, entry.name)
        );
      }
    }
  }

  // Write metadata
  const metadata = {
    configHash,
    buildPkgHash,
    fqbn:        meta.fqbn,
    usb:         meta.usb,
    coreVersion: CORE_VERSION,
    compiledAt:  meta.compiledAt,
    toolVersion: meta.toolVersion,
  };
  fs.writeFileSync(path.join(cacheDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

  return { ok: true, cacheDir };
}

// ── Cache read ─────────────────────────────────────────

/**
 * Looks up a cache entry for the given identity pair.
 * Returns { cacheDir, metadata } if found and valid, or null.
 */
function lookupCache(configHash, buildPkgHash) {
  const cacheDir  = getCacheDir(buildPkgHash, configHash);
  const metaPath  = path.join(cacheDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) return null;

  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (metadata.configHash !== configHash || metadata.buildPkgHash !== buildPkgHash) return null;
    return { cacheDir, metadata };
  } catch {
    return null;
  }
}

/**
 * Restores a cached build to the build output directory.
 * Returns { ok, buildPath, metadata } on hit, or { ok: false } on miss.
 */
function restoreToOutput(configHash, buildPkgHash) {
  const entry = lookupCache(configHash, buildPkgHash);
  if (!entry) return { ok: false };

  const buildOutputPath = getBuildOutputPath();
  fs.mkdirSync(buildOutputPath, { recursive: true });

  for (const f of fs.readdirSync(entry.cacheDir, { withFileTypes: true })) {
    if (f.isFile() && f.name !== 'metadata.json') {
      fs.copyFileSync(
        path.join(entry.cacheDir, f.name),
        path.join(buildOutputPath, f.name)
      );
    }
  }

  return { ok: true, buildPath: buildOutputPath, metadata: entry.metadata };
}

// ── Public API ─────────────────────────────────────────

/**
 * Given config content + build parameters, checks the cache and restores if hit.
 * Returns { hit, buildPath?, metadata? }
 */
function checkAndRestore(configContent, fqbn, usb) {
  const configHash   = computeConfigHash(configContent);
  const buildPkgHash = computeBuildPackageHash(fqbn, usb);
  const result       = restoreToOutput(configHash, buildPkgHash);
  if (!result.ok) return { hit: false };
  return { hit: true, buildPath: result.buildPath, metadata: result.metadata };
}

/**
 * Saves a completed compile to the cache.
 * Called from toolchain.js after a successful compile.
 */
function cacheCompileResult(buildOutputPath, configContent, fqbn, usb, compiledAt, toolVersion) {
  const configHash   = computeConfigHash(configContent);
  const buildPkgHash = computeBuildPackageHash(fqbn, usb);
  return saveToCache(buildOutputPath, configHash, buildPkgHash, {
    fqbn, usb, compiledAt, toolVersion,
  });
}

module.exports = {
  computeConfigHash,
  computeBuildPackageHash,
  checkAndRestore,
  cacheCompileResult,
};
