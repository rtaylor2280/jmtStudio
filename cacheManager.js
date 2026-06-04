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
 *         metadata.json        ← both hashes + build context + configId
 *
 * Eviction policy: per-lineage LRU, keep last 5 slots per configId per buildPkg.
 * Legacy entries (no configId) are treated as a single group and kept to 5.
 */

const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const { app } = require('electron');

// Must stay in sync with CORE_VERSION in toolchain.js
const CORE_VERSION = '4.6.0';

const MAX_ENTRIES_PER_LINEAGE = 5;

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

// Provenance sidecar — records which proffieOS source hash produced the binary
// currently sitting in build-output. Written on cache save AND cache restore so it
// reflects the build the user is about to flash. Read at flash time to verify the
// source hasn't changed externally since this build was made.
//
// Separate file (not metadata.json) so the cache stays the authoritative cache
// store and this file stays a small, single-purpose flash safety net.
const BUILD_PROVENANCE_FILE = '_jmt_build_meta.json';

function writeBuildProvenance(buildOutputPath, proffieOSHash) {
  try {
    fs.mkdirSync(buildOutputPath, { recursive: true });
    fs.writeFileSync(
      path.join(buildOutputPath, BUILD_PROVENANCE_FILE),
      JSON.stringify({ proffieOSHash, writtenAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch { /* sidecar is advisory — failure shouldn't abort a successful compile */ }
}

function readBuildProvenance(buildOutputPath) {
  try {
    const p = path.join(buildOutputPath, BUILD_PROVENANCE_FILE);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

// ── Hashing ────────────────────────────────────────────

/**
 * Extracts only the `using Name = Code;` definitions from stylesContent that are
 * directly referenced in configContent, plus any helpers those styles depend on
 * transitively. Returns a stable sorted string for hashing.
 *
 * This ensures that adding or modifying styles not used in a specific config
 * does not invalidate that config's cache entry.
 */
function computeRelevantStylesContent(configContent, stylesContent) {
  if (!stylesContent) return '';

  // Parse all `using Name = Code;` from the styles file (compacted single-line form)
  const usingsMap = {};
  const usingRe = /^using\s+(\w+)\s*=\s*(.+);[ \t]*$/gm;
  let m;
  while ((m = usingRe.exec(stylesContent)) !== null) {
    usingsMap[m[1]] = m[2].trim();
  }

  const allNames = Object.keys(usingsMap);
  if (!allNames.length) return stylesContent; // unparseable — fall back to full content

  // Find style names directly referenced in the config
  const directRefs = allNames.filter(name => new RegExp(`\\b${name}\\b`).test(configContent));
  if (!directRefs.length) return '';

  // Resolve transitive helper dependencies
  const resolved = new Set(directRefs);
  const queue = [...directRefs];
  while (queue.length) {
    const name = queue.shift();
    const code = usingsMap[name];
    if (!code) continue;
    for (const n of allNames) {
      if (!resolved.has(n) && new RegExp(`\\b${n}\\b`).test(code)) {
        resolved.add(n);
        queue.push(n);
      }
    }
  }

  // Stable sorted output: name=code pairs
  return [...resolved].sort().map(n => `${n}=${usingsMap[n]}`).join('\n');
}

/**
 * Computes a stable hash of config content.
 * Strips @jmt: metadata lines before hashing — timestamp/board changes
 * on save do not represent a meaningful config change.
 * Only styles referenced by the config (and their helpers) contribute to the hash.
 */
function computeConfigHash(content, stylesContent = '') {
  const stripped = content
    .split('\n')
    .filter(l => {
      const t = l.trim();
      return !t.startsWith('// @jmt:') && t !== '// Jedi Master Tech';
    })
    .join('\n')
    .trim();
  const h = crypto.createHash('sha256').update(stripped, 'utf8');
  // Only factor in styles if this config actually includes my_styles.h
  if (stylesContent && /^\s*#include\s+"[^"]*my_styles\.h"\s*$/m.test(stripped)) {
    const relevant = computeRelevantStylesContent(stripped, stylesContent);
    if (relevant) h.update('\0styles\0').update(relevant, 'utf8');
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Computes a stable hash of the build package identity.
 * Any change to FQBN, USB mode, core version, or ProffieOS source produces a new hash.
 */
function computeBuildPackageHash(fqbn, usb, proffieOSHash) {
  const identity = `fqbn=${fqbn}|usb=${usb}|core=${CORE_VERSION}|os=${proffieOSHash || ''}`;
  return crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Extracts the @jmt:config_id from config content, if present.
 * Returns the UUID string or null.
 */
function extractConfigId(content) {
  const m = content.match(/^\/\/ @jmt:config_id\s+(\S+)/m);
  return m ? m[1] : null;
}

// ── Eviction ───────────────────────────────────────────

/**
 * Reads all configHash subdirectories under a buildPkg directory,
 * groups them by configId (null = legacy), and removes the oldest
 * entries beyond MAX_ENTRIES_PER_LINEAGE within each group.
 */
function evictOldEntries(buildPkgHash) {
  const pkgDir = path.join(getCacheRoot(), buildPkgHash);
  if (!fs.existsSync(pkgDir)) return;

  // Collect all valid config-hash entries with their metadata
  const entries = [];
  for (const entry of fs.readdirSync(pkgDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(pkgDir, entry.name, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      entries.push({
        configHash: entry.name,
        configId:   meta.configId || null,
        compiledAt: meta.compiledAt || '',
        dir:        path.join(pkgDir, entry.name),
      });
    } catch {
      // Corrupt metadata — skip
    }
  }

  // Group by configId (null entries share a single legacy group)
  const groups = new Map();
  for (const e of entries) {
    const key = e.configId || '__legacy__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  // Within each group: sort newest-first, delete beyond the limit
  for (const group of groups.values()) {
    group.sort((a, b) => (b.compiledAt > a.compiledAt ? 1 : -1)); // newest first
    const toDelete = group.slice(MAX_ENTRIES_PER_LINEAGE);
    for (const e of toDelete) {
      try { fs.rmSync(e.dir, { recursive: true, force: true }); } catch {}
    }
  }
}

/**
 * Runs eviction across every buildPkg directory in the cache root.
 * Called at app startup to clean up legacy entries and enforce limits.
 */
function startupEviction() {
  const cacheRoot = getCacheRoot();
  if (!fs.existsSync(cacheRoot)) return;
  try {
    for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        evictOldEntries(entry.name);
      }
    }
  } catch {}
}

// ── Cache write ────────────────────────────────────────

/**
 * Copies all files from buildOutputPath into the cache directory
 * and writes a metadata.json with both identity hashes, configId, and build context.
 * Evicts old entries for the same configId lineage after writing.
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
    configId:      meta.configId || null,
    fqbn:          meta.fqbn,
    usb:           meta.usb,
    proffieOSHash: meta.proffieOSHash,
    coreVersion:   CORE_VERSION,
    compiledAt:    meta.compiledAt,
    toolVersion:   meta.toolVersion,
  };
  fs.writeFileSync(path.join(cacheDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

  // Mirror the source hash into build-output so flash can verify what's about
  // to be sent matches the current OS source state.
  writeBuildProvenance(buildOutputPath, meta.proffieOSHash);

  // Evict oldest entries beyond MAX_ENTRIES_PER_LINEAGE for this configId
  evictOldEntries(buildPkgHash);

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

  // Restored build's provenance comes from the cache entry's metadata.
  writeBuildProvenance(buildOutputPath, entry.metadata.proffieOSHash);

  return { ok: true, buildPath: buildOutputPath, metadata: entry.metadata };
}

// ── Public API ─────────────────────────────────────────

/**
 * Given config content + build parameters, checks the cache and restores if hit.
 * Returns { hit, buildPath?, metadata? }
 */
function checkAndRestore(configContent, fqbn, usb, proffieOSHash, stylesContent = '') {
  const configHash   = computeConfigHash(configContent, stylesContent);
  const buildPkgHash = computeBuildPackageHash(fqbn, usb, proffieOSHash);
  const result       = restoreToOutput(configHash, buildPkgHash);
  if (!result.ok) return { hit: false };
  return { hit: true, buildPath: result.buildPath, metadata: result.metadata };
}

/**
 * Saves a completed compile to the cache.
 * Extracts configId from configContent automatically.
 * Called from toolchain.js after a successful compile.
 */
function cacheCompileResult(buildOutputPath, configContent, fqbn, usb, proffieOSHash, compiledAt, toolVersion, stylesContent = '') {
  const configHash   = computeConfigHash(configContent, stylesContent);
  const buildPkgHash = computeBuildPackageHash(fqbn, usb, proffieOSHash);
  const configId     = extractConfigId(configContent);
  return saveToCache(buildOutputPath, configHash, buildPkgHash, {
    fqbn, usb, proffieOSHash, compiledAt, toolVersion, configId,
  });
}

module.exports = {
  computeConfigHash,
  computeBuildPackageHash,
  checkAndRestore,
  cacheCompileResult,
  readBuildProvenance,
  startupEviction,
};
