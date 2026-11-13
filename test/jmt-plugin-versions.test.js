// The JMT plugin's version identity [B-668].
//
//   1. "-jmt" survives normalising, in every spelling, and never collapses to the stock version.
//      It used to: normalizeVersion parsed each part with parseInt, so "4.6.0-jmt" became "4.6.0",
//      and a JMT cancel would have deleted the stock tree.
//   2. Ordering: 4.6.0 < 4.6.0-jmt < 4.7.0, so "newer available" still means a real release.
//   3. A JMT tree is recognised from its platform.txt stamp, while its directory keeps
//      arduino-cli's own name ("4.6"), and the stock tree beside it still reads as stock.
//   4. The reset's tool sweep keeps a JMT tree's compiler (the index only lists the stock version's).
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const cv   = require('../coreVersions');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  <- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures++;
}

console.log('1. the mark survives normalising');
for (const s of ['4.6-jmt', '4.6.0-jmt', '4.6.0-jmt.1', '4.6.0 JMT', '4.6-JMT', ' 4.6.0-jmt ']) {
  check(`"${s}" -> 4.6.0-jmt`, cv.normalizeVersion(s), '4.6.0-jmt');
}
check('stock is unchanged: 3.6 -> 3.6.0', cv.normalizeVersion('3.6'), '3.6.0');
check('a stock string is not JMT', cv.isJmtVersion('4.6.0'), false);
check('"jmt" inside a word is not the mark', cv.isJmtVersion('4.6.0-notjmtx'), false);
check('baseVersion of 4.6-jmt', cv.baseVersion('4.6-jmt'), '4.6.0');
check('baseVersion of stock is itself', cv.baseVersion('3.6'), '3.6.0');
check('jmtVersionOf 3.6', cv.jmtVersionOf('3.6'), '3.6.0-jmt');
check('twin of stock', cv.twinVersion('4.6.0'), '4.6.0-jmt');
check('twin of JMT', cv.twinVersion('4.6.0-jmt'), '4.6.0');

console.log('2. ordering');
check('4.6.0 < 4.6.0-jmt', cv.compareVersions('4.6.0', '4.6.0-jmt') < 0, true);
check('4.6.0-jmt < 4.7.0', cv.compareVersions('4.6.0-jmt', '4.7') < 0, true);
check('4.6.0-jmt == 4.6-jmt', cv.compareVersions('4.6.0-jmt', '4.6-jmt'), 0);
check('nothing newer than 4.6.0-jmt when 4.6 is the newest release', cv.newerThan('4.6.0-jmt', ['3.6', '4.6']), null);
check('4.7 is newer than 4.6.0-jmt', cv.newerThan('4.6.0-jmt', ['4.6', '4.7']), '4.7.0');
check('offered list keeps an installed JMT plugin, beside its stock version',
  cv.offeredVersions(['3.6', '4.6'], ['4.6.0-jmt']), ['4.6.0-jmt', '4.6.0', '3.6.0']);

console.log('3. a JMT tree on disk');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-ver-'));
function mkTree(name, dirName, platformVersion, boardsExtra = '') {
  const t  = path.join(root, name);
  const hw = path.join(cv.getHardwarePath(t), dirName);
  fs.mkdirSync(hw, { recursive: true });
  fs.writeFileSync(path.join(hw, 'boards.txt'), `x.name=x\n${boardsExtra}`);
  fs.writeFileSync(path.join(hw, 'platform.txt'), `name=Proffieboard\nversion=${platformVersion}\n`);
  return t;
}
const stock = mkTree('4.6.0', '4.6', '4.6', 'menu.pclk=PCLK\n');
const jmt   = mkTree('4.6.0-jmt', '4.6', '4.6.0-jmt.1', 'menu.pclk=PCLK\n');
check('stock tree lists 4.6.0', cv.listInstalled(stock), ['4.6.0']);
check('JMT tree lists 4.6.0-jmt', cv.listInstalled(jmt), ['4.6.0-jmt']);
check('JMT installed in its tree', cv.isVersionInstalled(jmt, '4.6-jmt'), true);
check('stock is NOT installed in the JMT tree', cv.isVersionInstalled(jmt, '4.6.0'), false);
check('JMT is NOT installed in the stock tree', cv.isVersionInstalled(stock, '4.6.0-jmt'), false);
check('arduino-cli name for the JMT plugin is the directory', cv.installedVersionString(jmt, '4.6.0-jmt'), '4.6');
check('pclk read from the JMT tree', cv.coreSupportsOption(jmt, '4.6.0-jmt', 'pclk'), true);

console.log('4. the reset keeps a JMT tree\'s compiler');
const toolsDir = path.join(jmt, 'packages', 'proffieboard', 'tools', 'arm-none-eabi-gcc', '14-2-rel1-xpack');
fs.mkdirSync(toolsDir, { recursive: true });
const deps = { '4.6.0': ['arm-none-eabi-gcc@14-2-rel1-xpack'] };
check('kept JMT plugin: its gcc is not an orphan', cv.unusedToolDirs(jmt, ['4.6.0-jmt'], deps).length, 0);
check('removed JMT plugin: its gcc is reclaimable', cv.unusedToolDirs(jmt, [], deps).length, 1);

fs.rmSync(root, { recursive: true, force: true });
if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
