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
// Safe to import: coreVersions pulls in nothing from this module, so there is no cycle, and reusing
// its version normalisation beats a second copy of the two-part / three-part rule living here.
const coreVersions = require('./coreVersions');

// The core version is NOT a constant here any more, and deliberately not
// imported from toolchain either.
//
// It used to be a copy of toolchain's constant with a comment asking whoever
// edited one to remember the other. That was survivable while exactly one core
// was ever installed. Now the core is chosen per ProffieOS version, and a cache
// key computed from a stale copy of the version is not a cosmetic bug: two
// builds against different cores collide on one key and the second one gets
// handed the first one's binary. A stale binary flashed to a board is the worst
// outcome this app has.
//
// So every entry point that needs it takes it as an explicit argument and
// refuses to guess. Importing toolchain would also be a require cycle, since
// toolchain already imports this module.

const MAX_ENTRIES_PER_LINEAGE = 5;

// Identifies WHICH algorithm produced an entry's configHash. Stamped into metadata.json on write
// and checked by evictStaleHashEntries() on launch: an entry keyed by a different algorithm can
// never be hit again, so it is provably dead and safe to delete.
//
// BUMP THIS whenever computeConfigHash's output changes for the same input — including changes to
// stripCommentsForHash, normalizeForHash, or computeRelevantStylesContent. Forgetting to bump does
// not corrupt anything; it just leaves unreachable entries occupying disk until the per-lineage cap
// pushes them out, which is the exact condition this field exists to end.
//
//   1 — pre-1.8: raw text with only `// @jmt:` lines removed
//   2 — 1.8: comments stripped and whitespace normalised, on both config and styles
//
// This is also why legacy-hash MIGRATION was deliberately not built. Migrating meant renaming
// directories on the cache LOOKUP path — a write inside the one function that decides whether to
// trust a prebuilt binary. Stamping the version instead gets the cleanup half with no such risk,
// and every future hash change becomes self-cleaning rather than a one-off chore.
const CONFIG_HASH_VERSION = 2;

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

function writeBuildProvenance(buildOutputPath, proffieOSHash, configHash = null, buildPkgHash = null) {
  try {
    fs.mkdirSync(buildOutputPath, { recursive: true });
    fs.writeFileSync(
      path.join(buildOutputPath, BUILD_PROVENANCE_FILE),
      JSON.stringify({ proffieOSHash, configHash, buildPkgHash,
                       writtenAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch { /* sidecar is advisory — failure shouldn't abort a successful compile */ }
}

/**
 * Does the build sitting in build-output belong to THIS config and these build settings?
 *
 * The build folder is a real place holding a real build, and until 2026-08-23 nothing could say
 * whose. That gap cost a flash: a compile succeeded, the cache save failed, and the next cache
 * lookup missed - so the app cleared its belief in a build that was sitting right there, valid, and
 * refused to flash it. A miss means "nothing is STORED", which says nothing about the folder.
 *
 * Ryan, finding it in one sentence: "shouldn't the build folder already be populated at this point
 * and not need cached version? sure it couldn't save it, but it should be still available at the
 * moment right?" Yes. This is how the app can now answer that instead of guessing. (B-216)
 */
function buildOutputMatches(configHash, buildPkgHash) {
  const prov = readBuildProvenance(getBuildOutputPath());
  if (!prov || !prov.configHash || !prov.buildPkgHash) return false;
  return prov.configHash === configHash && prov.buildPkgHash === buildPkgHash;
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

  // Strip comments here too, for three reasons beyond making comment edits free:
  //  1. The `usingRe` anchor below requires the line to END in `;`. A trailing `// note` broke
  //     that, so the style silently dropped out of the hash entirely — an edit to it then would
  //     not have invalidated the cache. Stripping makes MORE usings parse, never fewer.
  //  2. Style Library output carries inline /* … */ inside the expression, so the captured code
  //     was carrying comment text into the hash.
  //  3. Transitive dependency resolution below tests `\bName\b` against captured code. A comment
  //     merely MENTIONING another style's name created a false dependency.
  stylesContent = normalizeForHash(stripCommentsForHash(stylesContent));

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
 * Removes C and C++ comments, preserving string literals.
 *
 * This MUST be a single left-to-right state machine, NOT sequential regexes. A block-comment
 * regex run over raw text first mistakes a decorative banner like `//*******` for a block-comment
 * OPEN (its `//` + `*` contains the substring `/*`) and swallows every real line up to the next
 * `*​/`. Found 2026-07-30 on wild configs 2880_2 / 3011_20 / 3184_5 while building the precompile
 * lint; it never surfaced on in-house configs because none of them use `//*` banners. Users do.
 * String literals are copied verbatim so a `/*` inside "..." stays inert.
 *
 * Comments become spaces and newlines are preserved, so the caller still sees line structure.
 * normalizeForHash() is what actually collapses that away.
 */
function stripCommentsForHash(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '"') {                       // string literal — copy verbatim
      out += c; i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) { out += src[i] + src[i + 1]; i += 2; continue; }
        out += src[i]; i++;
      }
      if (i < n) { out += src[i]; i++; }
    } else if (c === '/' && d === '/') {   // line comment — blank to EOL, keep the newline
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {   // block comment — blank until close, keep newlines
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
    } else { out += c; i++; }
  }
  return out;
}

/**
 * Collapses whitespace so formatting-only edits hash identically.
 *
 * Stripping alone achieves nothing: comments are blanked TO SPACES, so a comment of a different
 * length still leaves different whitespace behind and the hash still moves. This is the half that
 * makes the transform do its job.
 *
 * Blank lines are dropped, which changes line numbering. That is safe here and was verified rather
 * than assumed (2026-08-07): every __LINE__ in ProffieOS lives in its own headers (common.h,
 * looper.h, current_preset.h, …), and each file carries its own __LINE__, so the config's line
 * count cannot shift any of them. The only casualty is line numbers in compiler diagnostics, which
 * are not the binary.
 */
function normalizeForHash(text) {
  return text
    .split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .filter(l => l !== '')
    .join('\n');
}

/**
 * Computes a stable hash of config content.
 * Strips @jmt: metadata lines before hashing — timestamp/board changes
 * on save do not represent a meaningful config change.
 * Comments and formatting are stripped too: they cannot reach codegen, so an edit to one must not
 * cost a full recompile. Note this makes the hash COARSER, which is the risky direction — a broken
 * stripper means two different configs collide and Studio restores a binary that is not the user's
 * source. That is why the stripper above is the one already hardened on real user configs.
 * Only styles referenced by the config (and their helpers) contribute to the hash.
 */
function computeConfigHash(content, stylesContent = '') {
  const stripped = normalizeForHash(stripCommentsForHash(
    content
      .split('\n')
      .filter(l => {
        const t = l.trim();
        return !t.startsWith('// @jmt:') && t !== '// Jedi Master Tech';
      })
      .join('\n')
  ));
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
function computeBuildPackageHash(fqbn, usb, proffieOSHash, coreVersion) {
  // Throwing beats defaulting. A missing core version would silently produce a
  // key that two different cores both match, and the symptom would be a stale
  // binary on someone's board rather than an error anyone could trace back
  // here. Loud and early is the only safe failure for a cache identity.
  if (!coreVersion) {
    throw new Error('computeBuildPackageHash requires an explicit coreVersion');
  }
  const identity = `fqbn=${fqbn}|usb=${usb}|core=${coreVersion}|os=${proffieOSHash || ''}`;
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

/**
 * Deletes individual cache entries whose configHash was produced by a superseded algorithm.
 *
 * Companion to evictOrphanedBuildPkgs, and it covers the case that one cannot see: when the hash
 * function changes, the entries go dead but their buildPkg directory stays perfectly alive (the OS
 * did not change, only how configs are keyed). Nothing else reclaims them — the per-lineage cap
 * only pushes them out once six newer builds of the SAME configId exist, so a rarely-compiled
 * config keeps its dead entry forever.
 *
 * Same exactness argument as the orphan sweep: an entry keyed by a different algorithm can never
 * be produced by a current lookup, so deleting it cannot cost a real hit.
 *
 * A missing `configHashVersion` means the entry predates the stamp, i.e. version 1. If a future
 * regression stopped WRITING the field, every entry would be re-declared stale on each launch —
 * wasteful, but never incorrect: the worst outcome is recompiling, not restoring a wrong binary.
 *
 * @returns {{removed: number, bytes: number}}
 */
function evictStaleHashEntries() {
  const result = { removed: 0, bytes: 0 };
  const cacheRoot = getCacheRoot();
  if (!fs.existsSync(cacheRoot)) return result;

  let pkgs;
  try { pkgs = fs.readdirSync(cacheRoot, { withFileTypes: true }); } catch { return result; }

  for (const pkg of pkgs) {
    if (!pkg.isDirectory()) continue;
    const pkgDir = path.join(cacheRoot, pkg.name);
    let entries;
    try { entries = fs.readdirSync(pkgDir, { withFileTypes: true }); } catch { continue; }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const entryDir = path.join(pkgDir, e.name);
      const metaPath = path.join(entryDir, 'metadata.json');

      let version;
      try {
        if (!fs.existsSync(metaPath)) continue;   // unidentifiable -> leave alone
        version = JSON.parse(fs.readFileSync(metaPath, 'utf8')).configHashVersion || 1;
      } catch { continue; }

      if (version === CONFIG_HASH_VERSION) continue;

      let bytes = 0;
      try {
        for (const f of fs.readdirSync(entryDir, { withFileTypes: true })) {
          if (f.isFile()) { try { bytes += fs.statSync(path.join(entryDir, f.name)).size; } catch {} }
        }
        fs.rmSync(entryDir, { recursive: true, force: true });
        result.removed++;
        result.bytes += bytes;
      } catch {}
    }

    // Directory left with nothing but its own manifest is dead weight; drop it too.
    try {
      const left = fs.readdirSync(pkgDir, { withFileTypes: true });
      if (!left.some(x => x.isDirectory())) fs.rmSync(pkgDir, { recursive: true, force: true });
    } catch {}
  }

  return result;
}

/**
 * Deletes whole buildPkg directories whose proffieOSHash no longer belongs to any installed OS
 * version. Those entries are provably unreachable: buildPkgHash is derived from that OS hash, so
 * if no installed version hashes to it, no lookup can ever produce that directory again.
 *
 * This exists because eviction was DEPTH-limited but not BREADTH-limited. MAX_ENTRIES_PER_LINEAGE
 * caps entries per configId lineage inside a directory; nothing capped the number of directories.
 * A new one is minted by a new OS version, a board change, a USB-mode change, and every JMT add-on
 * update — so the cache grew without bound and the dead weight was invisible. Measured on a dev
 * profile 2026-08-07: 1.6 GB across 17 buildPkg directories, most of them unreachable.
 *
 * Exactness is the point. A size cap or an age cap can delete a build the user is about to want;
 * an orphaned OS hash cannot be hit by definition, so this can never cost a real hit.
 *
 * The same argument applies to the CORE, which became a second way a directory can be stranded once
 * the core stopped being hardcoded. buildPkgHash is derived from the core version too, so a
 * directory built with a core that is no longer installed can never be produced by a lookup again.
 * Removing a toolchain used to leave its builds behind permanently: unusable, invisible, and
 * occupying space. An unreachable cached compile should always be reclaimed — that is already the
 * rule for the hash algorithm and the OS version, and the core is simply the third case.
 *
 * Note the asymmetry with the toolchain itself, which is deliberate. Reclaiming an unreachable BUILD
 * costs nothing, so it happens automatically. Removing the TOOLS costs a download that may be
 * metered or unavailable, so that stays user-initiated and is never done here.
 *
 * PROTECTED CORES IS WIDER THAN "INSTALLED", AND THE DIFFERENCE MATTERS.
 *
 * arduino-cli holds exactly ONE version of a platform per data directory - installing 3.6 uninstalls
 * 4.6 - so "installed" is a moving target that says nothing about intent. Keyed on that alone, this
 * sweep would delete every 4.6 build the moment somebody switched to 3.6, which is precisely the
 * switch-back-and-it-still-works property the cache exists to provide.
 *
 * So a core is protected if it is available ANYWHERE (the user's system tree or any of our per-core
 * trees) OR still named by an installed ProffieOS version. The second half covers the case where a
 * core vanishes outside the app: another tool upgrades the system 2.2 away while a version is still
 * pinned to it. Intent survives the disappearance, so the builds are kept and the user is offered
 * the download. Only when nothing has it and nothing wants it are the builds provably dead.
 *
 * @param {Set<string>|string[]} validOsHashes  every hash an installed version currently produces
 * @param {Set<string>|string[]} protectedCores every core available anywhere or referenced by a version
 * @returns {{removed: string[], bytes: number, skipped: string|null, coreCheckSkipped: boolean}}
 */
function evictOrphanedBuildPkgs(validOsHashes, protectedCores) {
  const valid = validOsHashes instanceof Set ? validOsHashes : new Set(validOsHashes || []);
  const cores = new Set(
    Array.from(protectedCores instanceof Set ? protectedCores : (protectedCores || []))
      .map(coreVersions.normalizeVersion)
  );
  // `removed` counts DIRECTORIES; `builds` counts what the user counts.
  //
  // A buildPkg directory holds one entry per config compiled against that
  // fqbn/usb/core/os combination, so removing one directory can remove several
  // builds. The log said "removed 1 orphaned build package(s)" while the Cached
  // Builds row dropped from 9 to 7 - both true, about different units, and
  // together they read as a miscount. The user's unit is the build, and nothing
  // outside this file has ever heard of a package. (2026-08-15)
  const result = { removed: [], builds: 0, bytes: 0, skipped: null, coreCheckSkipped: false };

  // THE GUARD THAT MATTERS: an empty set means "no installed version hashes to anything", which is
  // never true in practice — it means enumeration or hashing failed. Proceeding would read every
  // directory as orphaned and delete the entire cache. Fail closed.
  if (valid.size === 0) { result.skipped = 'no valid OS hashes supplied'; return result; }

  // Same guard, narrower blast radius. An empty set means enumeration failed, not that no core is
  // protected - the app could not have compiled anything without one, and every installed ProffieOS
  // version names one. Skip only the core rule rather than the whole sweep, so a core-side failure
  // cannot disable OS-orphan cleanup that is working perfectly well.
  if (cores.size === 0) result.coreCheckSkipped = true;

  const cacheRoot = getCacheRoot();
  if (!fs.existsSync(cacheRoot)) return result;

  let dirs;
  try { dirs = fs.readdirSync(cacheRoot, { withFileTypes: true }); }
  catch (e) { result.skipped = e.message; return result; }

  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const pkgDir = path.join(cacheRoot, d.name);

    // Read the key components from any entry inside. Every entry under one buildPkg shares them by
    // construction, since the directory name is their hash. Unreadable or empty -> leave it alone;
    // we do not delete what we cannot identify.
    let osHash = null, entryCore = null;
    try {
      for (const sub of fs.readdirSync(pkgDir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const metaPath = path.join(pkgDir, sub.name, 'metadata.json');
        if (!fs.existsSync(metaPath)) continue;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        osHash    = meta.proffieOSHash || null;
        entryCore = meta.coreVersion   || null;
        if (osHash) break;
      }
    } catch { continue; }

    if (!osHash) continue;

    // ORPHANED means any component of buildPkgHash can no longer be produced, so no lookup can ever
    // land here again. The key is fqbn|usb|core|os. fqbn and usb are always available - every board
    // and USB mode is declared by whatever core is installed - so the two that can actually vanish
    // are the OS version and the core. Both are checked here. If a component is ever added to the
    // key, it needs a check added here too, or the directories it strands become invisible dead
    // weight exactly as the core's did.
    const osGone   = !valid.has(osHash);
    // A missing coreVersion is a pre-1.8 entry, not evidence of a vanished core. Never inferred as
    // orphaned; the stale-hash sweep is what reclaims those.
    const coreGone = !result.coreCheckSkipped && !!entryCore &&
                     !cores.has(coreVersions.normalizeVersion(entryCore));

    if (!osGone && !coreGone) continue;

    let bytes = 0;
    try {
      (function measure(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) measure(full);
          else { try { bytes += fs.statSync(full).size; } catch {} }
        }
      })(pkgDir);
      // Counted BEFORE the delete, from the same walk that measured the bytes.
      let entries = 0;
      for (const e of fs.readdirSync(pkgDir, { withFileTypes: true })) {
        if (e.isDirectory() && fs.existsSync(path.join(pkgDir, e.name, 'metadata.json'))) entries++;
      }
      fs.rmSync(pkgDir, { recursive: true, force: true });
      result.removed.push(d.name);
      result.builds += entries;
      result.bytes += bytes;
    } catch {}
  }

  return result;
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
      coreVersion: meta.coreVersion,
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
    // Which algorithm produced configHash. Without this an entry keyed by an older algorithm is
    // indistinguishable from a live one, so it can only be reclaimed by aging out — a config
    // compiled twice a year would hold its dead entry indefinitely.
    configHashVersion: CONFIG_HASH_VERSION,
    buildPkgHash,
    configId:      meta.configId || null,
    // ONE ENTRY CAN BELONG TO SEVERAL CONFIGS. computeConfigHash strips comments, and
    // the @jmt: markers - including config_id itself - are comments. So two configs
    // that differ only in their metadata block hash identically and share this entry.
    // That is desirable: a cosmetic edit must not cost a rebuild. What was wrong is
    // that the entry could only name ONE of them, and the second config never wrote
    // anything (it takes the cache hit), so its dependence was invisible and could
    // never be reconstructed afterwards.
    // `configId` above is kept as the CREATOR and for entries written before this.
    // (2026-08-19. Ryan: "we need 1 to many and easiest way is to save the config ids
    // as an array. How we decide to work with those can be later." Deliberately data
    // only - nothing consumes this yet, and no behaviour changes.)
    configIds:     meta.configId ? [meta.configId] : [],
    fqbn:          meta.fqbn,
    usb:           meta.usb,
    proffieOSHash: meta.proffieOSHash,
    coreVersion:   meta.coreVersion,
    compiledAt:    meta.compiledAt,
    toolVersion:   meta.toolVersion,
    // How long this build actually took. Stored ON the entry rather than derived later, so the
    // Clear-cache warning can state what the user would really pay instead of guessing. An invented
    // "10 to 15 minutes" is wrong by 25x at both ends of the real range — a light config builds in
    // about 70 seconds, a heavy one in over half an hour. Null for entries written before this.
    compileDurationMs: meta.compileDurationMs ?? null,
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


/**
 * Records that a config relies on an already-cached build, WITHOUT restoring it.
 *
 * Save As is the case this exists for. The copy inherits a build that is already
 * on disk and already flashable, so it depends on that entry from the instant it
 * is written - but it changes no build input, so no cache check fires and the
 * dependence is never recorded. Running a full restore just to append one field
 * would re-copy the entire build tree to change a string.
 *
 * Returns true only when an entry existed and now names this config.
 */
function claimEntry(configHash, buildPkgHash, configId) {
  if (!configId) return false;
  const entry = lookupCache(configHash, buildPkgHash);
  if (!entry) return false;
  try {
    if (!Array.isArray(entry.metadata.configIds)) {
      entry.metadata.configIds = entry.metadata.configId ? [entry.metadata.configId] : [];
    }
    if (entry.metadata.configIds.includes(configId)) return true;
    entry.metadata.configIds.push(configId);
    fs.writeFileSync(
      path.join(entry.cacheDir, 'metadata.json'),
      JSON.stringify(entry.metadata, null, 2)
    );
    return true;
  } catch { return false; }
}

// ── Public API ─────────────────────────────────────────

/**
 * Given config content + build parameters, checks the cache and restores if hit.
 * Returns { hit, buildPath?, metadata? }
 */
/**
 * Claim path for callers that hold config content rather than raw hashes.
 * Mirrors checkAndRestore's inputs exactly so the two can never disagree about
 * which entry a given config maps to.
 */
function claimForConfig(configContent, fqbn, usb, proffieOSHash, coreVersion, stylesContent = '', explicitConfigId = null) {
  const configHash   = computeConfigHash(configContent, stylesContent);
  const buildPkgHash = computeBuildPackageHash(fqbn, usb, proffieOSHash, coreVersion);
  return claimEntry(configHash, buildPkgHash, explicitConfigId || extractConfigId(configContent));
}

/**
 * Answers "is there a stored build for this?" and WRITES NOTHING.
 *
 * This is what every UI-driven caller wants, and until 2026-08-23 there was no such function - the
 * only lookup available also copied the whole entry over build-output. Ten call sites used it, one
 * of them a 600 ms debounce on TYPING, so the build folder was being rewritten behind the user
 * constantly. A flash makes the board re-enumerate, that fired the port handler, and the restore
 * landed on top of the firmware the flash was mid-way through sending. (B-216)
 *
 * The rule this restores, which is what the app was always supposed to do: the build folder is
 * written when a build is actually needed, and never because something changed.
 *
 * Returns the entry's directory so a caller that DOES need the build can read it where it lies,
 * rather than copying it somewhere first.
 */
function checkOnly(configContent, fqbn, usb, proffieOSHash, coreVersion, stylesContent = '', explicitConfigId = null) {
  const configHash   = computeConfigHash(configContent, stylesContent);
  const buildPkgHash = computeBuildPackageHash(fqbn, usb, proffieOSHash, coreVersion);
  const entry = lookupCache(configHash, buildPkgHash);
  // Two independent questions, and the caller needs both. A cache miss with a matching build folder
  // is still a flashable state - that is exactly the case a failed save produces.
  const inOutput = buildOutputMatches(configHash, buildPkgHash);
  if (!entry) return { hit: false, buildOutputMatches: inOutput, configHash, buildPkgHash };
  return {
    hit: true,
    buildOutputMatches: inOutput,
    buildDir: entry.cacheDir,
    metadata: entry.metadata,
    configHash,
    buildPkgHash,
    configId: explicitConfigId || extractConfigId(configContent),
  };
}

/**
 * Records that an entry was actually USED: stamps lastUsedAt and appends the adopting configId.
 *
 * Separated from the lookup on purpose. A check is not a use - the old code stamped both on every
 * restore, which meant typing in the editor counted as using a build. Callers invoke this at the
 * moment they adopt the entry (skipping a compile, or flashing from it), so the record describes
 * what happened rather than what was considered.
 *
 * Writes only inside the cache entry. Never touches build-output.
 */
function adoptEntry(configHash, buildPkgHash, adoptingConfigId = null) {
  const entry = lookupCache(configHash, buildPkgHash);
  if (!entry) return { ok: false };
  try {
    entry.metadata.lastUsedAt = new Date().toISOString();
    if (adoptingConfigId) {
      if (!Array.isArray(entry.metadata.configIds)) {
        entry.metadata.configIds = entry.metadata.configId ? [entry.metadata.configId] : [];
      }
      if (!entry.metadata.configIds.includes(adoptingConfigId)) {
        entry.metadata.configIds.push(adoptingConfigId);
      }
    }
    fs.writeFileSync(path.join(entry.cacheDir, 'metadata.json'),
                     JSON.stringify(entry.metadata, null, 2));
  } catch { /* bookkeeping must never fail a build or a flash */ }
  return { ok: true, buildDir: entry.cacheDir, metadata: entry.metadata };
}

// checkAndRestore() and restoreToOutput() were REMOVED on 2026-08-23. Do not bring them back.
//
// They copied a cache entry over build-output, and were reachable from ten UI paths including a
// 600 ms debounce on typing. That is how a flash sent another config's firmware: a flash makes the
// board re-enumerate, port detection fired a "check", and the check rewrote the file dfu-util was
// mid-way through reading. It is also how another board's build.options.json reached a build tree
// whose object files came from somewhere else (B-196) - the entry holds no core/, libraries/ or
// sketch/, so restoring it bought no incremental speed while asserting a consistency that was false.
//
// Nothing needs this. A build is read WHERE IT LIVES: build-output after a compile, the entry
// itself after a hit. Use checkOnly() to ask, adoptEntry() to record a use.


/**
 * Saves a completed compile to the cache.
 * Extracts configId from configContent automatically.
 * Called from toolchain.js after a successful compile.
 */
function cacheCompileResult(buildOutputPath, configContent, fqbn, usb, proffieOSHash, coreVersion, compiledAt, toolVersion, stylesContent = '', compileDurationMs = null, explicitConfigId = null) {
  const configHash   = computeConfigHash(configContent, stylesContent);
  const buildPkgHash = computeBuildPackageHash(fqbn, usb, proffieOSHash, coreVersion);
  // The @jmt block is STRIPPED from the editor on load (index.html: `clean:
  // stripJmtLines(content)`) and re-injected only on save, so what the compile path
  // hands us has never contained config_id. Extraction from content was therefore
  // dead on arrival - every entry since the field was added recorded null. The
  // renderer holds the id in memory and now passes it explicitly; extraction stays
  // as the fallback for any caller that does have a full config. (2026-08-19)
  const configId     = explicitConfigId || extractConfigId(configContent);
  return saveToCache(buildOutputPath, configHash, buildPkgHash, {
    fqbn, usb, proffieOSHash, coreVersion, compiledAt, toolVersion, configId, compileDurationMs,
  });
}

module.exports = {
  computeConfigHash,
  computeBuildPackageHash,
  checkOnly,
  buildOutputMatches,
  writeBuildProvenance,
  adoptEntry,
  getBuildOutputPath,
  claimForConfig,
  cacheCompileResult,
  readBuildProvenance,
  startupEviction,
  evictOrphanedBuildPkgs,
  evictStaleHashEntries,
  CONFIG_HASH_VERSION,
  // Exported so toolchain's _configFeatures counts the same text this hashes. Two strippers is
  // how the metrics and the cache key drift apart.
  stripCommentsForHash,
};
