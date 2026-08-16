// Choosing WHICH Proffieboard core version to build against.
//
// core-detect.test.js guards the older question: can the core on this machine
// build at all. This one guards what happens once the version stopped being
// hardcoded and became a per-ProffieOS-version choice.
//
// The defect that motivated it: Studio pinned core 4.6, and a style-heavy
// config that links on 3.6 can overflow 4.6 by several kilobytes. On a 256 KB
// V2/V2.2 that is a quarter of the board, so a pinned 4.6 quietly told those
// owners the app was not for them. An Arduino IDE user just picks 3.6 from
// Boards Manager; a Studio user had no lever.
//
// coreVersions.js is required directly rather than mirrored, because it has no
// electron dependency. The FQBN and cache-identity bodies ARE mirrored, same
// convention as core-detect.test.js and flash-error.test.js.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const cv   = require('../coreVersions');

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) { failures++; console.error(`FAIL: ${label}\n  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  else console.log(`ok - ${label}`);
}

// ── version normalisation ──────────────────────────────────────────────────
//
// The index publishes two-part versions ("4.6") and arduino-cli installs them
// into three-part directories ("4.6.0"). Comparing those as strings says they
// are different versions, which would reinstall a core that is already there
// on every single launch.

check('two-part index form normalises',  cv.normalizeVersion('4.6'),   '4.6.0');
check('three-part dir form is stable',   cv.normalizeVersion('4.6.0'), '4.6.0');
check('3.6 normalises',                  cv.normalizeVersion('3.6'),   '3.6.0');
check('already-three-part stays put',    cv.normalizeVersion('0.1.7'), '0.1.7');
check('surrounding whitespace ignored',  cv.normalizeVersion(' 4.6 '), '4.6.0');
check('index form equals directory form', cv.compareVersions('4.6', '4.6.0'), 0);

// ── ordering ───────────────────────────────────────────────────────────────
//
// Lexical sort puts "4.6" below "0.1.7" and would pick the wrong latest. These
// are the nine versions actually published as of 2026-08-08.

const REAL_PUBLISHED = ['0.1', '0.1.1', '0.1.2', '0.1.3', '0.1.7', '1.0', '2.2', '3.6', '4.6'];

check('4.6 beats 3.6',        cv.compareVersions('4.6', '3.6') > 0, true);
check('1.0 beats 0.1.7',      cv.compareVersions('1.0', '0.1.7') > 0, true);
check('0.1.3 beats 0.1.2',    cv.compareVersions('0.1.3', '0.1.2') > 0, true);
check('latest of real list',  cv.normalizeVersion(cv.pickLatest(REAL_PUBLISHED)), '4.6.0');

// Order must not matter. The index makes no ordering promise, and "last element
// is newest" is the kind of assumption that holds until the day it does not.
check('latest is order-independent',
  cv.normalizeVersion(cv.pickLatest(REAL_PUBLISHED.slice().reverse())), '4.6.0');
check('latest of a single-item list', cv.pickLatest(['3.6']), '3.6');
check('latest of nothing is null',    cv.pickLatest([]), null);

// ── installed-core detection, against real directory layouts ───────────────
//
// Built on disk rather than mocked so the readdir and boards.txt handling are
// actually exercised. Two cores side by side is the whole point: once a user
// can pick, "some core is installed" stops being an answer to "is 3.6 here".

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-core-test-'));
const hw  = path.join(tmp, 'packages', 'proffieboard', 'hardware', 'stm32l4');

// 3.6 has four menu options. 4.6 adds pclk. These lines are the shape that
// matters from the real boards.txt files.
fs.mkdirSync(path.join(hw, '3.6.0'), { recursive: true });
fs.writeFileSync(path.join(hw, '3.6.0', 'boards.txt'),
  'menu.usb=USB Type\nmenu.dosfs=DOSFS\nmenu.speed=CPU Speed\nmenu.opt=Optimize\n');

fs.mkdirSync(path.join(hw, '4.6.0'), { recursive: true });
fs.writeFileSync(path.join(hw, '4.6.0', 'boards.txt'),
  'menu.usb=USB Type\nmenu.dosfs=DOSFS\nmenu.speed=CPU Speed\nmenu.opt=Optimize\nmenu.pclk=Periphereal Clock\n');

// A directory with no boards.txt is a half-finished or interrupted install. It
// must not count as installed, or the app skips an install it actually needs.
fs.mkdirSync(path.join(hw, '2.2.0'), { recursive: true });

check('both usable cores listed', cv.listInstalled(tmp), ['3.6.0', '4.6.0']);
check('3.6 found',                cv.isVersionInstalled(tmp, '3.6'),   true);
check('4.6 found by index form',  cv.isVersionInstalled(tmp, '4.6'),   true);
check('4.6 found by dir form',    cv.isVersionInstalled(tmp, '4.6.0'), true);
check('boards.txt-less dir is not installed', cv.isVersionInstalled(tmp, '2.2'), false);
check('absent version is absent', cv.isVersionInstalled(tmp, '1.0'),   false);

// The exactness that matters. With 4.6 present, asking about 3.6 must not be
// satisfied by "well, a core is here and it can build."
fs.rmSync(path.join(hw, '3.6.0'), { recursive: true, force: true });
check('3.6 gone even though 4.6 remains', cv.isVersionInstalled(tmp, '3.6'), false);
fs.mkdirSync(path.join(hw, '3.6.0'), { recursive: true });
fs.writeFileSync(path.join(hw, '3.6.0', 'boards.txt'),
  'menu.usb=USB Type\nmenu.dosfs=DOSFS\nmenu.speed=CPU Speed\nmenu.opt=Optimize\n');

// ── the option that actually breaks the build ──────────────────────────────
//
// Verified against the v3.6 and v4.4 tags for both board types: pclk is the
// ONLY option that differs between the two cores. usb, dosfs, speed and opt are
// identical, including cdc_msc and sdmmc1.

check('4.6 declares pclk',      cv.coreSupportsOption(tmp, '4.6', 'pclk'),  true);
check('3.6 does NOT declare pclk', cv.coreSupportsOption(tmp, '3.6', 'pclk'), false);
check('both declare usb',       cv.coreSupportsOption(tmp, '3.6', 'usb'),   true);
check('both declare dosfs',     cv.coreSupportsOption(tmp, '3.6', 'dosfs'), true);
check('both declare speed',     cv.coreSupportsOption(tmp, '3.6', 'speed'), true);
check('both declare opt',       cv.coreSupportsOption(tmp, '3.6', 'opt'),   true);
check('made-up option is absent', cv.coreSupportsOption(tmp, '4.6', 'zzz'), false);
check('uninstalled core supports nothing', cv.coreSupportsOption(tmp, '9.9', 'usb'), false);

// ── FQBN composition (mirrored from toolchain.js compile()) ────────────────
//
// Sending an option a core does not declare rejects the entire FQBN before a
// single file compiles: "invalid option 'pclk'", a build that fails in 0:00.
// That is precisely what made 3.6 unusable in this app.

function composeFqbn(fqbn, { usb, opt }, supportsPclk) {
  const dosfs = fqbn.includes('L452') ? 'sdmmc1' : 'sdspi';
  const options = [`usb=${usb}`, `dosfs=${dosfs}`, 'speed=80', `opt=${opt}`];
  if (supportsPclk) options.push('pclk=2');
  return `${fqbn}:${options.join(',')}`;
}

const V3 = 'proffieboard:stm32l4:ProffieboardV3-L452RE';
const V2 = 'proffieboard:stm32l4:ProffieboardV2-L433CC';

check('V3 on 4.6 carries pclk',
  composeFqbn(V3, { usb: 'cdc_webusb', opt: 'os' }, true),
  `${V3}:usb=cdc_webusb,dosfs=sdmmc1,speed=80,opt=os,pclk=2`);

check('V2 on 3.6 omits pclk entirely',
  composeFqbn(V2, { usb: 'cdc', opt: 'os' }, false),
  `${V2}:usb=cdc,dosfs=sdspi,speed=80,opt=os`);

// The V2/V2.2 owner on 3.6 is the whole reason this feature exists, so the
// exact string they get is worth pinning rather than inferring.
check('3.6 output contains no pclk token',
  composeFqbn(V2, { usb: 'cdc', opt: 'os' }, false).includes('pclk'), false);

// dosfs still keyed off the board, not the core. Regressing this would send
// sdmmc1 to a V2, which cannot do SDIO.
check('V2 stays on sdspi',   composeFqbn(V2, { usb: 'cdc', opt: 'os' }, true).includes('dosfs=sdspi'),  true);
check('V3 stays on sdmmc1',  composeFqbn(V3, { usb: 'cdc', opt: 'os' }, true).includes('dosfs=sdmmc1'), true);

// ── cache identity (mirrored from cacheManager.computeBuildPackageHash) ────
//
// The failure this guards is the worst one the app has: two builds against
// DIFFERENT cores colliding on one cache key, so the second is handed the
// first one's binary and it gets flashed to a board. The core version has to be
// part of the identity, and it has to be the resolved one rather than a copy of
// a constant that no longer describes the build.

const crypto = require('crypto');
function buildPkgHash(fqbn, usb, proffieOSHash, coreVersion) {
  if (!coreVersion) throw new Error('computeBuildPackageHash requires an explicit coreVersion');
  const identity = `fqbn=${fqbn}|usb=${usb}|core=${coreVersion}|os=${proffieOSHash || ''}`;
  return crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 16);
}

const h46 = buildPkgHash(V2, 'cdc', 'oshash', '4.6.0');
const h36 = buildPkgHash(V2, 'cdc', 'oshash', '3.6.0');
check('different cores produce different keys', h46 === h36, false);
check('same core reproduces the same key',
  buildPkgHash(V2, 'cdc', 'oshash', '4.6.0') === h46, true);

// Existing users must not have their cache invalidated by this change. Before,
// the identity was built from a hardcoded '4.6.0'; the resolver now yields the
// same normalised string, so keys for the default case are unchanged.
check('default resolution matches the old hardcoded key',
  buildPkgHash(V2, 'cdc', 'oshash', cv.normalizeVersion(cv.FALLBACK_VERSION)) === h46, true);

// Missing core version must throw rather than default. A silent default is how
// a wrong key gets computed and nobody finds out until a board is flashed.
let threw = false;
try { buildPkgHash(V2, 'cdc', 'oshash', undefined); } catch { threw = true; }
check('missing coreVersion throws', threw, true);

// ── what gets offered, and the floor ───────────────────────────────────────
//
// The index publishes back to 0.1. Listing all nine puts eight traps in a dropdown, because
// anything below 3.6 predates ProffieOS 7 and cannot build a modern config. 3.6 is the floor for a
// reason rather than by taste: the oldest with a demonstrated use (flash-constrained V2/V2.2) and
// the oldest profezzorn names as legitimate.

// The floor is read from the module, never restated here. It is expected to move over time - it
// went 3.6.0 -> 2.2.0 on 2026-08-12 - and a suite carrying its own copy of the value turns every
// adjustment into a two-file edit plus a red run that says nothing is wrong. One definition,
// in coreVersions.js, and these checks follow wherever it goes.
const FLOOR = cv.normalizeVersion(cv.MIN_OFFERED_VERSION);

// Everything at or above the floor, newest first.
const ABOVE_FLOOR = REAL_PUBLISHED
  .map(cv.normalizeVersion)
  .filter(v => cv.compareVersions(v, FLOOR) >= 0)
  .sort(cv.compareVersions)
  .reverse();

// Value assertions on the floor are gone, since restating it is the duplication this avoids. What
// is still worth checking is that whatever it is set to is a version that actually exists: a typo
// like '3.7.0' or '2.20.0' would silently offer a list nobody can install.
check('the floor is a version the index actually publishes',
  REAL_PUBLISHED.map(cv.normalizeVersion).includes(FLOOR), true);
check('everything below the floor is dropped, newest first',
  cv.offeredVersions(REAL_PUBLISHED, []), ABOVE_FLOOR);

// An installed core is ALWAYS listed, floor or not. Hiding a core the machine is actually holding
// would make the UI lie about the machine, which is worse than one extra old entry.
// Derived, so this keeps testing what it says when the floor moves. Hardcoding 2.2.0 here meant
// that the moment the floor dropped to 2.2.0 the case still passed while no longer exercising a
// below-floor version at all.
const BELOW_FLOOR = REAL_PUBLISHED
  .map(cv.normalizeVersion)
  .filter(v => cv.compareVersions(v, FLOOR) < 0)
  .sort(cv.compareVersions)
  .pop();

check('installed below-floor core is still shown',
  cv.offeredVersions(REAL_PUBLISHED, [BELOW_FLOOR]), [...ABOVE_FLOOR, BELOW_FLOOR]);
check('installed core already above the floor is not duplicated',
  cv.offeredVersions(REAL_PUBLISHED, [ABOVE_FLOOR[0]]), ABOVE_FLOOR);

// ── "a newer one exists" ───────────────────────────────────────────────────
//
// Replaced follow-latest. A version never moves on its own; it reports that something newer is out
// there and leaves the choice alone. Stated as a fact so somebody pinned to 3.6 because 4.6
// overflows their board is not nudged into a build that cannot link for them.

check('newer exists when pinned below newest', cv.newerThan('3.6.0', REAL_PUBLISHED), '4.6.0');
check('nothing newer when pinned to newest',   cv.newerThan('4.6.0', REAL_PUBLISHED), null);
check('index form compares correctly',         cv.newerThan('4.6',   REAL_PUBLISHED), null);
check('no published list means no claim',      cv.newerThan('4.6.0', []), null);

// ── which toolchain directories are safe to remove ─────────────────────────
//
// The compiler is where the gigabyte lives; the core itself is about 66 MB. Cores do not share one:
// 3.6 wants ARM's gcc 9-2020-q2-update and 4.6 wants xPack's 14-2-rel1-xpack, five major versions
// and two distributors apart. So removing a core must take its compiler and must never take one a
// remaining core still needs.

const TOOL_DEPS = {
  '3.6.0': ['arm-none-eabi-gcc@9-2020-q2-update'],
  '4.6.0': ['arm-none-eabi-gcc@14-2-rel1-xpack'],
};

const toolsRoot = path.join(tmp, 'packages', 'proffieboard', 'tools', 'arm-none-eabi-gcc');
fs.mkdirSync(path.join(toolsRoot, '9-2020-q2-update'), { recursive: true });
fs.mkdirSync(path.join(toolsRoot, '14-2-rel1-xpack'),  { recursive: true });

const namesOf = list => list.map(t => t.version).sort();

check('keeping 4.6 frees gcc 9 only',
  namesOf(cv.unusedToolDirs(tmp, ['4.6.0'], TOOL_DEPS)), ['9-2020-q2-update']);
check('keeping 3.6 frees gcc 14 only',
  namesOf(cv.unusedToolDirs(tmp, ['3.6.0'], TOOL_DEPS)), ['14-2-rel1-xpack']);
check('keeping both frees nothing',
  cv.unusedToolDirs(tmp, ['3.6.0', '4.6.0'], TOOL_DEPS).length, 0);

// Fail safe when the dependency map is unavailable, which is an offline first run with nothing
// cached. Failing to reclaim is recoverable; deleting a compiler someone needs is not.
check('no dependency map means remove nothing',
  cv.unusedToolDirs(tmp, ['4.6.0'], {}).length, 0);
check('undefined dependency map means remove nothing',
  cv.unusedToolDirs(tmp, ['4.6.0'], undefined).length, 0);

// ── tool dependencies come from the index, never inferred ──────────────────
const FAKE_INDEX = { packages: [{ name: 'proffieboard', platforms: [
  { version: '3.6', toolsDependencies: [{ name: 'arm-none-eabi-gcc', version: '9-2020-q2-update' }] },
  { version: '4.6', toolsDependencies: [{ name: 'arm-none-eabi-gcc', version: '14-2-rel1-xpack' }] },
]}]};
check('deps keyed by normalised version',
  cv.extractToolDeps(FAKE_INDEX)['3.6.0'], ['arm-none-eabi-gcc@9-2020-q2-update']);
check('deps for a package that is not there',
  cv.extractToolDeps({ packages: [] }), {});

// ── orphan definition (mirrored from cacheManager.evictOrphanedBuildPkgs) ──
//
// The definition was enumerated ad hoc - "the OS version is gone" - when it should be derived from
// the key. buildPkgHash is fqbn|usb|core|os, so ORPHANED means any component can no longer be
// produced. fqbn and usb always can; the OS version and the core are the two that vanish.
//
// Wrong in either direction is expensive. Too narrow and removing a toolchain strands its builds
// permanently, invisible and unreclaimable. Too broad and it deletes a build someone is about to
// want, which on a heavy config is over half an hour of their time.

function isOrphaned({ osHash, entryCore }, validOsHashes, installedCores, coreCheckSkipped) {
  if (!osHash) return false;                       // cannot identify it, so never delete it
  const osGone   = !validOsHashes.has(osHash);
  const coreGone = !coreCheckSkipped && !!entryCore &&
                   !installedCores.has(cv.normalizeVersion(entryCore));
  return osGone || coreGone;
}

const OS_LIVE  = new Set(['osA', 'osB']);
const CORES_IN = new Set(['4.6.0']);

check('live OS + installed core survives',
  isOrphaned({ osHash: 'osA', entryCore: '4.6.0' }, OS_LIVE, CORES_IN, false), false);
check('deleted OS version is orphaned',
  isOrphaned({ osHash: 'osZ', entryCore: '4.6.0' }, OS_LIVE, CORES_IN, false), true);
check('uninstalled core is orphaned even though the OS version is live',
  isOrphaned({ osHash: 'osA', entryCore: '3.6.0' }, OS_LIVE, CORES_IN, false), true);
check('index-form core matches installed dir form',
  isOrphaned({ osHash: 'osA', entryCore: '4.6' }, OS_LIVE, CORES_IN, false), false);

// THE DISTINCTION THAT DECIDES WHETHER PEOPLE LOSE WORK: a core does not have to be IN USE for its
// builds to be kept, only INSTALLED. Someone pinned to 4.6 with 3.6 sitting installed and
// unreferenced must keep every 3.6 build, because selecting 3.6 again makes them reachable
// instantly and rebuilding them costs real time.
const CORES_BOTH_INSTALLED = new Set(['3.6.0', '4.6.0']);
check('installed-but-unused core keeps its builds',
  isOrphaned({ osHash: 'osA', entryCore: '3.6.0' }, OS_LIVE, CORES_BOTH_INSTALLED, false), false);

// Never delete what we cannot identify. A pre-1.8 entry has no coreVersion recorded; that is a
// missing field, not evidence of an uninstalled core. The stale-hash sweep reclaims those instead.
check('entry with no recorded core is left alone',
  isOrphaned({ osHash: 'osA', entryCore: null }, OS_LIVE, CORES_IN, false), false);
check('entry with no OS hash is left alone',
  isOrphaned({ osHash: null, entryCore: '3.6.0' }, OS_LIVE, CORES_IN, false), false);

// Fail closed, with a narrow blast radius. An empty installed-core set means enumeration failed,
// not that no core exists - nothing could have compiled without one. Skip the core rule only; a
// core-side failure must not disable OS-orphan cleanup that is working.
check('core check skipped: uninstalled core is NOT swept',
  isOrphaned({ osHash: 'osA', entryCore: '3.6.0' }, OS_LIVE, new Set(), true), false);
check('core check skipped: OS rule still applies',
  isOrphaned({ osHash: 'osZ', entryCore: '3.6.0' }, OS_LIVE, new Set(), true), true);

// ── protectedCoreSet: which plugins' builds survive a sweep ────────────────
//
// The checks above hand `evictOrphanedBuildPkgs` a protected set already built.
// These test how that set is BUILT, which is the half that decides whether
// anyone loses a long compile.
//
// Why it carries more weight than it looks: the sweep fires 5 seconds after
// launch, deliberately deferred past first paint. A several-hundred-megabyte
// plugin re-download is nowhere near done by then, so a plugin removed by
// another Arduino tool is reliably ABSENT when the sweep runs. The pin is not a
// backstop in that window - it is the only thing keeping those builds.
const P = cv.protectedCoreSet;

check('an installed plugin nobody pinned still protects its builds',
  P({ available: ['3.6.0'], pinned: [], active: null }).has('3.6.0'), true);
check('a pinned plugin protects its builds even when NOT installed',
  P({ available: [], pinned: ['4.6.0'], active: null }).has('4.6.0'), true);
check('a pin on a non-active OS version counts',
  P({ available: [], pinned: [null, '2.2.0', null], active: '4.6.0' }).has('2.2.0'), true);
check('the active plugin is protected even if both lists missed it',
  P({ available: [], pinned: [], active: '4.6.0' }).has('4.6.0'), true);
check('unpinned AND uninstalled is the only unprotected case',
  P({ available: ['4.6.0'], pinned: ['4.6.0'], active: '4.6.0' }).has('3.6.0'), false);
check('index form and directory form collapse to one entry',
  P({ available: ['3.6'], pinned: ['3.6.0'], active: null }).size, 1);
check('a pin written as 3.6 protects builds recorded as 3.6.0',
  P({ available: [], pinned: ['3.6'], active: null }).has('3.6.0'), true);
check('null and empty pins never become entries',
  P({ available: [], pinned: [null, '', undefined], active: null }).size, 0);
check('no arguments yields an empty set, which the sweep fails closed on',
  P().size, 0);

check('an EXPECTED but absent plugin protects its builds (the dormant case)',
  P({ available: [], pinned: [], expected: ['3.6.0'], active: '4.6.0' }).has('3.6.0'), true);
check('expected survives the pin moving away, which is the whole point',
  P({ available: ['4.6.0'], pinned: ['4.6.0'], expected: ['3.6.0'], active: '4.6.0' }).has('3.6.0'), true);
check('a forgotten plugin is NOT protected, so a deliberate uninstall still reclaims',
  P({ available: ['4.6.0'], pinned: ['4.6.0'], expected: ['4.6.0'], active: '4.6.0' }).has('3.6.0'), false);
check('expected normalises like every other term',
  P({ available: [], pinned: [], expected: ['3.6'], active: null }).has('3.6.0'), true);

// ── cleanup ────────────────────────────────────────────────────────────────
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
