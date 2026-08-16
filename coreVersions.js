/**
 * Proffieboard core version resolution.
 *
 * Studio used to hardcode which core it installs. That quietly excluded anyone
 * on a flash-tight board: a style-heavy config that links on core 3.6 can
 * overflow on 4.6 by several kilobytes, and on a 256 KB V2/V2.2 that is a
 * quarter of the board. An Arduino IDE user just picks 3.6 from Boards Manager.
 * A Studio user had no lever at all.
 *
 * So the version is resolved at runtime from the same index Boards Manager
 * reads, and the choice is recorded per ProffieOS version rather than baked in.
 *
 * Three facts about that index, all verified against it rather than assumed,
 * because each one breaks an obvious implementation:
 *
 *   1. Versions are published WITHOUT a patch component ("4.6", "3.6"), while
 *      arduino-cli installs them into directories named "4.6.0". Comparing the
 *      two as strings fails. Everything here normalises before comparing.
 *
 *   2. The archive filename does not track the version. Version 4.6 downloads
 *      "v4.4.tar.gz" - both the url and archiveFileName say v4.4. So the
 *      version NEVER comes from parsing a URL, only from the version field.
 *
 *   3. The platforms array is not guaranteed ordered, and "latest" is not the
 *      last element. Latest is the maximum by semver, computed.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const INDEX_URL =
  'https://profezzorn.github.io/arduino-proffieboard/package_proffieboard_index.json';

const PACKAGE_NAME  = 'proffieboard';
const PLATFORM_ARCH = 'stm32l4';

// Used only when the index cannot be reached AND nothing has ever been cached,
// which is a first launch with no network. Picked as the newest version that
// existed when this shipped. It is a floor to keep the app usable, not a pin:
// the moment a fetch succeeds the real list replaces it.
const FALLBACK_VERSION = '4.6.0';

// The core every pre-1.8 build used, because it was hardcoded. Kept as its own
// constant rather than reusing FALLBACK_VERSION: they are equal today and mean
// completely different things. This one is a historical fact and must never
// change; the fallback is a floor that will move when a newer core ships.
const PRE_1_8_CORE_VERSION = '4.6.0';

// Oldest core offered as a choice.
//
// The index publishes nine versions: 0.1, 0.1.1, 0.1.2, 0.1.3, 0.1.7, 1.0, 2.2, 3.6, 4.6. Listing
// all of them would put six traps in a dropdown, so there is a floor, and where it sits is a
// judgement rather than a fact.
//
// 3.6 is the oldest core profezzorn names as a legitimate option - "3.6 has more bugs. If it works
// for you, then feel free to use it." Everything below it predates ProffieOS 7 by a wide margin, and
// offering those is an implicit endorsement of a choice that can only waste someone's evening.
//
// It was temporarily 2.2.0 from 2026-08-12 to 2026-08-15, purely to have a second installable core
// while the per-core-tree work was in progress. Restored before the QA gate, as that note required.
//
// WHAT A LOWER FLOOR STILL NEEDS, if it is ever revisited: an older core may not declare every
// board - 2.2 has no ProffieboardV3 - and a config pinned to one that lacks its board fails with a
// raw "Invalid FQBN", which is exactly the cryptic failure this whole feature exists to translate.
// The core/board compatibility check is the work that makes a lower floor safe rather than merely
// possible. Lowering this constant is a one-line change; that check is not.
//
// Note this is a floor on what is OFFERED, never on what is USED: `offeredVersions` adds anything
// already installed regardless, so moving this up can never hide a core the machine is holding.
const MIN_OFFERED_VERSION = '3.6.0';

// How long a cached index is trusted before a refresh is attempted. The list
// changes a few times a year, so this is about not hammering the host on every
// launch rather than about freshness.
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 8000;

// ── Version arithmetic ─────────────────────────────────

/**
 * "4.6" and "4.6.0" are the same version wearing different clothes. Returns a
 * three-part string so equality checks and directory lookups can be literal.
 */
function normalizeVersion(v) {
  const parts = String(v || '').trim().split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).map(p => String(parseInt(p, 10) || 0)).join('.');
}

/** Negative if a < b, zero if equal, positive if a > b. */
function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map(Number);
  const pb = normalizeVersion(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Highest version in the list, or null for an empty list. */
function pickLatest(versions) {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  return versions.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

// ── Index cache on disk ────────────────────────────────

function getCachePath(userDataPath) {
  return path.join(userDataPath, 'core-index-cache.json');
}

function readCache(userDataPath) {
  try {
    const raw = fs.readFileSync(getCachePath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.versions) || parsed.versions.length === 0) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(userDataPath, versions, toolDeps) {
  try {
    fs.writeFileSync(
      getCachePath(userDataPath),
      JSON.stringify({ fetchedAt: new Date().toISOString(), versions, toolDeps: toolDeps || {} }, null, 2),
      'utf8'
    );
  } catch { /* cache is an optimisation; a failed write must not break startup */ }
}

// ── Index fetch ────────────────────────────────────────

function fetchIndexRaw() {
  return new Promise((resolve, reject) => {
    const req = https.get(INDEX_URL, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Index returned HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Index is not valid JSON: ${e.message}`)); }
      });
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error(`Index fetch timed out after ${FETCH_TIMEOUT_MS} ms`));
    });
    req.on('error', reject);
  });
}

/**
 * Pull the published version strings out of a parsed index. Normalised on the
 * way out so callers never have to think about the two-part form again.
 */
function extractVersions(index) {
  const pkg = (index && index.packages || []).find(p => p.name === PACKAGE_NAME);
  if (!pkg) return [];
  return (pkg.platforms || [])
    .filter(pl => pl.architecture === PLATFORM_ARCH || !pl.architecture)
    .map(pl => pl.version)
    .filter(Boolean)
    .map(normalizeVersion)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort(compareVersions);
}

/**
 * Which compiler each core needs: { "3.6.0": ["arm-none-eabi-gcc@9-2020-q2-update"], ... }
 *
 * Load-bearing for reclaiming space, because the compiler is where the gigabyte lives and the core
 * itself is only about 66 MB. Cores do NOT share one: 3.6 wants gcc 9-2020-q2-update from ARM and
 * 4.6 wants xPack's 14-2-rel1-xpack, which are different distributions five major versions apart.
 *
 * Removing a core therefore has to remove its compiler too, and must NOT remove a compiler another
 * installed core still depends on. Read from the index rather than inferred, because guessing wrong
 * in one direction leaves a gigabyte behind and in the other breaks a working install.
 */
function extractToolDeps(index) {
  const pkg = (index && index.packages || []).find(p => p.name === PACKAGE_NAME);
  const out = {};
  if (!pkg) return out;
  for (const pl of pkg.platforms || []) {
    if (!pl.version) continue;
    out[normalizeVersion(pl.version)] =
      (pl.toolsDependencies || []).map(t => `${t.name}@${t.version}`);
  }
  return out;
}

/**
 * Tool directories on disk that no core we are KEEPING still needs.
 *
 * keepCores is the set staying installed. Anything a kept core depends on is protected; whatever is
 * left over is genuinely unreferenced. When the dependency map is unavailable (offline first run,
 * nothing cached) this returns nothing at all rather than guessing - failing to reclaim is
 * recoverable, deleting a compiler someone needs is not.
 */
function unusedToolDirs(dataPath, keepCores, toolDeps) {
  if (!toolDeps || Object.keys(toolDeps).length === 0) return [];

  // Scope the "still needed" set to cores living in THIS tree.
  //
  // A tool's identity is `name@version` with no tree in it, but per-core trees
  // exist precisely so each tree carries its own physical copy. Building the set
  // from every kept core meant a tool was spared in tree A because a core in
  // tree B happened to depend on the same name and version. Measured 2026-08-12
  // with 2.2 and 3.6 in separate trees, both depending on
  // arm-none-eabi-gcc@9-2020-q2-update: removing 2.2 reported 64.2 MB (its
  // platform directory alone) and left its own 643.3 MB copy of the compiler
  // both uncounted and undeleted.
  //
  // Intersecting here rather than at the call sites keeps one definition: the
  // survey asks before removal (the tree still holds its core, which is not in
  // keep, so the set is empty and the tools count) and the reset asks after
  // (the tree is empty, so the set is empty and the tools go).
  const inThisTree = new Set(listInstalled(dataPath).map(normalizeVersion));
  const needed = new Set();
  for (const c of keepCores || []) {
    if (!inThisTree.has(normalizeVersion(c))) continue;
    for (const dep of toolDeps[normalizeVersion(c)] || []) needed.add(dep);
  }

  const toolsRoot = path.join(dataPath, 'packages', PACKAGE_NAME, 'tools');
  if (!fs.existsSync(toolsRoot)) return [];

  const orphans = [];
  try {
    for (const toolName of fs.readdirSync(toolsRoot)) {
      const toolDir = path.join(toolsRoot, toolName);
      let versions;
      try { versions = fs.readdirSync(toolDir, { withFileTypes: true }); } catch { continue; }
      for (const v of versions) {
        if (!v.isDirectory()) continue;
        if (needed.has(`${toolName}@${v.name}`)) continue;
        orphans.push({ tool: toolName, version: v.name, path: path.join(toolDir, v.name) });
      }
    }
  } catch { return []; }
  return orphans;
}

/**
 * Available versions, newest last. Never throws and never blocks startup: a
 * failed fetch falls back to the cache, and a missing cache falls back to a
 * known-good floor. The `stale` flag tells callers whether the list is
 * authoritative, so the UI can avoid claiming an update exists on guesswork.
 */
async function listAvailable(userDataPath, { force = false } = {}) {
  const cached = readCache(userDataPath);
  const fresh  = cached && (Date.now() - Date.parse(cached.fetchedAt) < INDEX_TTL_MS);

  if (cached && fresh && !force) {
    // toolDeps travels with versions. Dropping it here silently disabled every
    // caller that reclaims compilers: unusedToolDirs returns [] the moment the
    // map is empty, so within the 24h TTL - which is nearly always - a core's
    // gcc was never counted or removed. That is the larger half of a core by a
    // wide margin, so a reset offered ~130 MB when ~1.4 GB was reclaimable.
    // The network path and both error paths always carried it; only the common
    // case forgot. (2026-08-12)
    return { ok: true, versions: cached.versions, toolDeps: cached.toolDeps || {}, stale: false, source: 'cache' };
  }

  try {
    const raw      = await fetchIndexRaw();
    const versions = extractVersions(raw);
    if (versions.length === 0) throw new Error('Index contained no proffieboard platforms');
    const toolDeps = extractToolDeps(raw);
    writeCache(userDataPath, versions, toolDeps);
    return { ok: true, versions, toolDeps, stale: false, source: 'network' };
  } catch (e) {
    if (cached) {
      return {
        ok: true,
        versions: cached.versions,
        toolDeps: cached.toolDeps || {},
        stale: true,
        source: 'cache',
        error: e.message,
      };
    }
    return {
      ok: true,
      versions: [FALLBACK_VERSION],
      toolDeps: {},
      stale: true,
      source: 'fallback',
      error: e.message,
    };
  }
}

/** Convenience wrapper: the newest published version, resolved the safe way. */
async function resolveLatest(userDataPath, opts) {
  const res = await listAvailable(userDataPath, opts);
  return { ...res, latest: pickLatest(res.versions) || FALLBACK_VERSION };
}

/**
 * The versions worth putting in front of someone: published, at or above the floor, newest first.
 *
 * Anything already installed is included even if it sits below the floor, so the list can never
 * omit a core the machine is actually holding. Hiding something that exists would make the UI lie
 * about the machine, which is worse than showing one extra old entry.
 */
function offeredVersions(published, installed = []) {
  const floor = normalizeVersion(MIN_OFFERED_VERSION);
  const keep  = new Set(
    (published || [])
      .map(normalizeVersion)
      .filter(v => compareVersions(v, floor) >= 0)
  );
  for (const v of installed) keep.add(normalizeVersion(v));
  return Array.from(keep).sort(compareVersions).reverse();
}

/**
 * Is anything newer than what this version is pinned to?
 *
 * Answers the "a newer one exists" signal that replaced follow-latest. Deliberately just a fact,
 * not a recommendation: someone on 3.6 because 4.6 overflows their board should see that 4.7 exists
 * without being nudged toward a build that will not link for them.
 */
function newerThan(current, published) {
  const newest = pickLatest(published || []);
  if (!newest || !current) return null;
  return compareVersions(newest, current) > 0 ? normalizeVersion(newest) : null;
}

// ── Installed cores ────────────────────────────────────

function getHardwarePath(dataPath) {
  return path.join(dataPath, 'packages', PACKAGE_NAME, 'hardware', PLATFORM_ARCH);
}

/**
 * The version string arduino-cli itself uses for an installed core, given the
 * normalised version we track internally. Returns null when it is not present.
 *
 * These are NOT always the same string, and the difference is not cosmetic. The
 * proffieboard index publishes some versions with two parts and some with three:
 * 3.6 installs into a directory named `3.6`, while 4.6.0 installs into `4.6.0`.
 * We normalise to three parts everywhere so comparisons and sorting behave, but
 * a normalised string handed back to the CLI does not match what it has, and
 * `core uninstall proffieboard:stm32l4@3.6.0` silently removes nothing.
 *
 * So: normalised for our own reasoning, this for anything spoken to arduino-cli.
 * The directory name is the right source because arduino-cli created it, and the
 * JMT tree's own installed.json agrees with it. (2026-08-12)
 */
function installedVersionString(dataPath, version) {
  const want = normalizeVersion(version);
  const hw   = getHardwarePath(dataPath);
  if (!fs.existsSync(hw)) return null;
  try {
    for (const d of fs.readdirSync(hw)) {
      if (normalizeVersion(d) === want &&
          fs.existsSync(path.join(hw, d, 'boards.txt'))) return d;
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Which core versions are actually on disk, normalised. Directory names are the
 * only source here, which is fine because arduino-cli owns that layout, but see
 * isVersionInstalled for why a name alone is not enough to trust.
 */
function listInstalled(dataPath) {
  const hw = getHardwarePath(dataPath);
  if (!fs.existsSync(hw)) return [];
  try {
    return fs.readdirSync(hw)
      .filter(d => fs.existsSync(path.join(hw, d, 'boards.txt')))
      .map(normalizeVersion)
      .sort(compareVersions);
  } catch { return []; }
}

/**
 * Is this exact version installed and does it have a boards.txt we can read?
 *
 * Deliberately version-EXACT, unlike the older capability probe it sits beside.
 * That probe asks "can anything here build", which was the right question when
 * one version was allowed and any other was a mistake. Once the user picks a
 * version, "some core is present" stops being an answer.
 */
function isVersionInstalled(dataPath, version) {
  const want = normalizeVersion(version);
  const hw   = getHardwarePath(dataPath);
  if (!fs.existsSync(hw)) return false;
  try {
    return fs.readdirSync(hw).some(d =>
      normalizeVersion(d) === want &&
      fs.existsSync(path.join(hw, d, 'boards.txt'))
    );
  } catch { return false; }
}

/**
 * Does this installed core accept a given FQBN menu option?
 *
 * The one that matters today is `pclk`, absent in 3.6 and present from 4.4 on.
 * Studio appends it to every build, so sending it to 3.6 rejects the FQBN
 * before a single file compiles. Comparing version numbers would work right
 * now and rot later; asking boards.txt tests the thing that actually breaks.
 *
 * Verified across the 3.6 and 4.4 tags for both board types: `pclk` is the ONLY
 * option that differs. usb, dosfs, speed and opt are identical, including
 * cdc_msc and sdmmc1.
 */
function coreSupportsOption(dataPath, version, option) {
  const want = normalizeVersion(version);
  const hw   = getHardwarePath(dataPath);
  if (!fs.existsSync(hw)) return false;
  try {
    const dir = fs.readdirSync(hw).find(d => normalizeVersion(d) === want);
    if (!dir) return false;
    const boards = fs.readFileSync(path.join(hw, dir, 'boards.txt'), 'utf8');
    return boards.includes(`menu.${option}=`);
  } catch { return false; }
}

/**
 * Every plugin version whose cached builds must survive an orphan sweep.
 *
 * THE UNION IS THE POINT, and each term covers a case the others do not:
 *
 *   available - present in the user's Arduino tree or any of ours. A plugin
 *               nobody has pinned still protects its builds while it is there,
 *               because a lookup can still produce that key.
 *   pinned    - named by ANY installed ProffieOS version, active or not.
 *               Intent outlives the files: another Arduino tool can remove the
 *               plugin from under us, and the sweep runs 5 seconds after launch
 *               while a several-hundred-megabyte re-download is nowhere near
 *               done. Without this term, that sweep deletes builds the app is
 *               in the middle of making usable again.
 *   active    - the version in play, added explicitly so a failure to enumerate
 *               either list above cannot strand the one plugin certainly in use.
 *
 * Extracted from main.js so it can be tested. It was inline, which meant the
 * one rule standing between an interrupted download and somebody's 38-minute
 * build had no test, while the eviction function it feeds had sixty.
 * (2026-08-15)
 */
function protectedCoreSet({ available = [], pinned = [], expected = [], active = null } = {}) {
  const out = new Set();
  for (const v of available) if (v) out.add(normalizeVersion(v));
  for (const v of pinned)    if (v) out.add(normalizeVersion(v));
  // `expected` - plugins the app recorded installing or adopting, which are not
  // on disk right now. This is the DORMANT case and it is the reason the record
  // exists: a plugin removed behind the app's back, plus a pin moved elsewhere,
  // leaves nothing at all saying it ever mattered, so its builds read as dead
  // when they are only waiting for a download.
  //
  // A plugin is a published artifact and can always come back - today's testing
  // proved a returning one still hits the cache - whereas a deleted ProffieOS
  // version's source hash can never recur. Those two are not the same kind of
  // gone, and treating them alike is what made moving a pin destructive.
  //
  // Dropped only by a deliberate uninstall, which is the consented path and
  // already warns about the builds it strands. (2026-08-15)
  for (const v of expected)  if (v) out.add(normalizeVersion(v));
  if (active) out.add(normalizeVersion(active));
  return out;
}

module.exports = {
  protectedCoreSet,
  INDEX_URL,
  PACKAGE_NAME,
  PLATFORM_ARCH,
  FALLBACK_VERSION,
  PRE_1_8_CORE_VERSION,
  MIN_OFFERED_VERSION,

  normalizeVersion,
  compareVersions,
  pickLatest,
  offeredVersions,
  newerThan,

  listAvailable,
  resolveLatest,

  getHardwarePath,
  listInstalled,
  installedVersionString,
  isVersionInstalled,
  coreSupportsOption,

  extractToolDeps,
  unusedToolDirs,
};
