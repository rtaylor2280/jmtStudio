// Eviction releases a config's claim; a shared build is deleted only when nobody claims it. [B-209]
//
// A build can serve several configs: two configs that differ only in their @jmt block hash the
// same, and Save As claims the build it inherits. Eviction counted an entry under its creator only,
// so config A's sixth compile deleted a build config B still relied on, and B's next compile was
// a full rebuild of something already on disk.
//
// Runs the real cacheManager against a temporary cache folder, through the same calls the app
// makes: cacheCompileResult after a compile, claimForConfig on Save As, startupEviction at launch.
'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const Module = require('module');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'b209-'));
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return realLoad.call(this, request, ...rest);
};
const C = require('../cacheManager.js');
Module._load = realLoad;

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const BOARD = ['proffieboard:stm32l4:ProffieboardV3-L452RE', 'serial', 'oshash', '4.6.0'];
const pkgDir = path.join(userData, 'build-cache', C.computeBuildPackageHash(...BOARD));
const out = path.join(userData, 'build-output');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ProffieOS.ino.bin'), 'firmware');

let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 1) + (clock++) * 60000).toISOString();
const config = (n) => `// test config\nPreset presets[] = { { "font${n}", "tracks/t.wav", StyleNormalPtr<RED, WHITE, 300, 800>(), "f${n}" } };\n`;
const compile = (n, id) => C.cacheCompileResult(out, config(n), ...BOARD, stamp(), 'test', '', 1000, id);
const dirOf = (n) => path.join(pkgDir, C.computeConfigHash(config(n), ''));
const metaOf = (n) => JSON.parse(fs.readFileSync(path.join(dirOf(n), 'metadata.json'), 'utf8'));
const exists = (n) => fs.existsSync(dirOf(n));

console.log('eviction releases claims (B-209)');

// ── THE BUG: A's sixth build must not delete the build B relies on ───────────
compile(0, 'cfg-A');                                   // S, built by A
check('control: Save As claims the build', C.claimForConfig(config(0), ...BOARD, '', 'cfg-B') === true);
for (let n = 1; n <= 4; n++) compile(n, 'cfg-A');      // A now holds 5: nothing moves
check('at five builds nothing is released', JSON.stringify(metaOf(0).configIds) === '["cfg-A","cfg-B"]', JSON.stringify(metaOf(0).configIds));
compile(5, 'cfg-A');                                   // A's sixth
check('A\'S SIXTH BUILD KEEPS THE BUILD B STILL CLAIMS', exists(0));
check('A released its claim, B\'s is kept', exists(0) && JSON.stringify(metaOf(0).configIds) === '["cfg-B"]', exists(0) ? JSON.stringify(metaOf(0).configIds) : 'deleted');
check('the creator is still recorded as the creator', exists(0) && metaOf(0).configId === 'cfg-A');
check('A\'s five newest are all kept', [1, 2, 3, 4, 5].every(exists));

// ── When the last claimant releases it, it goes ─────────────────────────────
for (let n = 10; n <= 13; n++) compile(n, 'cfg-B');    // B holds S + 4
check('B at five builds still keeps S', exists(0));
compile(14, 'cfg-B');                                  // B's sixth: S is B's oldest
check('WHEN NOBODY CLAIMS IT, THE BUILD IS DELETED', !exists(0));

// ── A shared build counts in every claimant's five ──────────────────────────
compile(20, 'cfg-C');
C.claimForConfig(config(20), ...BOARD, '', 'cfg-D');
for (let n = 21; n <= 25; n++) compile(n, 'cfg-D');    // D: shared + 5 own -> D releases shared
check('a claimant\'s own five push a shared build out of ITS lineage', exists(20) && JSON.stringify(metaOf(20).configIds) === '["cfg-C"]',
  exists(20) ? JSON.stringify(metaOf(20).configIds) : 'deleted');
check('and only one of D\'s builds was let go', [21, 22, 23, 24, 25].every(exists));

// ── Never-owned builds keep the old shared keep-five by age ─────────────────
for (let n = 30; n <= 36; n++) compile(n, null);       // a config Studio never saved: no config_id
check('never-owned builds: newest five kept', [32, 33, 34, 35, 36].every(exists));
check('never-owned builds: the two oldest deleted, as before', !exists(30) && !exists(31));
check('an empty claim list from birth is not read as "every owner released it"', exists(36) && JSON.stringify(metaOf(36).configIds) === '[]');

// ── Fixtures on disk, run at launch ────────────────────────────────────────
// A second package directory, written by hand, so the shapes the app no longer writes can be set up.
const legacyPkg = path.join(userData, 'build-cache', 'legacy-pkg');
const entry = (name, meta) => { fs.mkdirSync(path.join(legacyPkg, name), { recursive: true });
  fs.writeFileSync(path.join(legacyPkg, name, 'metadata.json'), JSON.stringify(meta, null, 2)); };
const legacyMeta = (name) => JSON.parse(fs.readFileSync(path.join(legacyPkg, name, 'metadata.json'), 'utf8'));
// Pre-2026-08-19 entries: a creator scalar, no configIds array.
for (let i = 1; i <= 6; i++) entry(`old${i}`, { configId: 'cfg-E', compiledAt: `2026-01-0${i}T00:00:00.000Z` });
// Built in March but used yesterday: not the oldest.
entry('usedRecently', { configId: 'cfg-F', configIds: ['cfg-F'], compiledAt: '2026-03-01T00:00:00.000Z', lastUsedAt: '2026-10-23T00:00:00.000Z' });
for (let i = 1; i <= 5; i++) entry(`newer${i}`, { configId: 'cfg-F', configIds: ['cfg-F'], compiledAt: `2026-04-0${i}T00:00:00.000Z` });
const untouchedBefore = fs.readFileSync(path.join(legacyPkg, 'newer5', 'metadata.json'), 'utf8');
C.startupEviction();
check('a legacy entry with only a creator is owned: its oldest is let go', !fs.existsSync(path.join(legacyPkg, 'old1')));
check('and its other five are kept, unrewritten', [2, 3, 4, 5, 6].every(i => fs.existsSync(path.join(legacyPkg, `old${i}`)))
  && legacyMeta('old2').configIds === undefined);
check('A BUILD USED YESTERDAY IS NOT THE OLDEST, WHENEVER IT WAS COMPILED', fs.existsSync(path.join(legacyPkg, 'usedRecently')) && !fs.existsSync(path.join(legacyPkg, 'newer1')));
check('an entry nothing released is not rewritten', fs.readFileSync(path.join(legacyPkg, 'newer5', 'metadata.json'), 'utf8') === untouchedBefore);

fs.rmSync(userData, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
