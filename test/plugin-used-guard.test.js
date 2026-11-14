// A build is kept, and reused, only when it used the plugin that was asked for. [B-672, B-668]
//
// 2026-11-13: a "4.6.0 JMT" build linked Arduino15's stock library (isolation was re-probed after a
// version switch), was cached under the JMT key, and was later flashed as JMT firmware.
//
// Run: node test/plugin-used-guard.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const tc = require('../toolchain');
const cache = require('../cacheManager');

// ── The compile-side check, on arduino-cli's own summary table ──
const tbl = (ver, p) => `Sketch uses 287792 bytes (56%)\nUsed library Version Path\nWire 1.0 X\nUsed platform        Version Path\nproffieboard:stm32l4 ${ver}     ${p}\n`;
const base = path.join(os.tmpdir(), 'U');
const jmt46 = path.join(base, 'JMT', '4.6.0-jmt');
const sys = path.join(base, 'Arduino15');
const plat = (tree, v) => path.join(tree, 'packages', 'proffieboard', 'hardware', 'stm32l4', v);

const r1 = tc.checkPlatformUsed(tbl('4.6', plat(jmt46, '4.6')), '4.6.0-jmt', jmt46);
ok('JMT asked, JMT tree used: kept', r1.ok && r1.verified, JSON.stringify(r1));
const r2 = tc.checkPlatformUsed(tbl('4.6', plat(sys, '4.6')), '4.6.0-jmt', jmt46);
ok('JMT asked, system plugin used: refused', !r2.ok, JSON.stringify(r2));
const r3 = tc.checkPlatformUsed(tbl('4.6', plat(sys, '4.6')), '4.6.0', path.join(base, 'JMT', '4.6.0'));
ok('4.6 asked, system 4.6 used: kept (adopting the user\'s own copy is allowed)', r3.ok && r3.verified, JSON.stringify(r3));
const r4 = tc.checkPlatformUsed(tbl('4.6', plat(sys, '4.6')), '3.6.0', path.join(base, 'JMT', '3.6.0'));
ok('3.6 asked, 4.6 used: refused', !r4.ok, JSON.stringify(r4));
const r5 = tc.checkPlatformUsed(tbl('4.6', plat(jmt46, '4.6')), '4.6.0', path.join(base, 'JMT', '4.6.0'));
ok('stock asked, JMT tree used: refused', !r5.ok, JSON.stringify(r5));
const r6 = tc.checkPlatformUsed('Sketch uses 1 bytes', '4.6.0', null);
ok('no table: not refused, but not verified (so not cached)', r6.ok && !r6.verified, JSON.stringify(r6));

// ── The cache-side check, on a stored build's map file ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-guard-'));
try {
  const entry = (name, core, libLine) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(path.join(d, 'build'), { recursive: true });
    const meta = { coreVersion: core, configHash: 'c', buildPkgHash: 'b' };
    fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify(meta));
    if (libLine) fs.writeFileSync(path.join(d, 'build', 'ProffieOS.ino.map'), `Archive member included\n${libLine}\n`);
    return { d, meta, mp: path.join(d, 'metadata.json') };
  };
  const good = entry('good', '4.6.0-jmt', ` .text 0x0 0x4 ${plat(jmt46, '4.6')}/system/STM32L4xx/Lib\\libstm32l452.a(startup.o)`);
  const bad  = entry('bad',  '4.6.0-jmt', ` .text 0x0 0x4 ${plat(sys, '4.6')}/system/STM32L4xx/Lib\\libstm32l452.a(startup.o)`);
  const nomap = entry('nomap', '4.6.0-jmt', null);
  const stock = entry('stock', '4.6.0', null);
  ok('a JMT entry that linked the JMT library is reused', cache._jmtEntryGenuine(good.d, good.meta, good.mp));
  ok('...and the verdict is stamped on it', JSON.parse(fs.readFileSync(good.mp, 'utf8')).jmtLibLinked === true);
  ok('a JMT entry that linked the stock library is NOT reused', !cache._jmtEntryGenuine(bad.d, bad.meta, bad.mp));
  ok('a JMT entry with no map to read is NOT reused', !cache._jmtEntryGenuine(nomap.d, nomap.meta, nomap.mp));
  ok('a stock entry is not asked', cache._jmtEntryGenuine(stock.d, stock.meta, stock.mp));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Wiring ──
const T = fs.readFileSync(path.join(__dirname, '..', 'toolchain.js'), 'utf8');
const sav = T.slice(T.indexOf('function setActiveCoreVersion'), T.indexOf('function setActiveCoreVersion') + 900);
ok('a switch to a JMT plugin marks it isolated at once (B-668)', /_useIsolatedCore = coreVersions\.isJmtVersion\(next\) \? true : null/.test(sav));
const comp = T.slice(T.indexOf('async function compile('));
ok('compile never re-probes the system plugin for a JMT build',
  /_useIsolatedCore = coreVersions\.isJmtVersion\(getActiveCoreVersion\(\)\) \|\| !\(await _systemCoreCanBuild\(\)\)/.test(comp));
const iCheck = comp.indexOf('checkPlatformUsed('), iProv = comp.indexOf('writeBuildProvenance('), iCache = comp.indexOf('cacheCompileResult(');
ok('the check runs before the build is labelled or cached', iCheck > 0 && iCheck < iProv && iCheck < iCache);
ok('an unconfirmed build is not cached', /if \(!bench && !result\.platformUnverified\)/.test(comp));
const C = fs.readFileSync(path.join(__dirname, '..', 'cacheManager.js'), 'utf8');
const lk = C.slice(C.indexOf('function lookupCache('), C.indexOf('function lookupCache(') + 600);
ok('every cache lookup applies the JMT check', /_jmtEntryGenuine\(/.test(lk));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
