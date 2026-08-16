// The proffieboard index publishes some core versions with two parts and some
// with three: 3.6 installs into a directory named `3.6`, 4.6.0 into `4.6.0`.
// We normalise to three parts everywhere so sorting and comparison behave, but
// a normalised string handed back to arduino-cli matches nothing, and
// `core uninstall proffieboard:stm32l4@3.6.0` removed nothing while reporting
// no error anyone ever saw.
//
// This locks in the split: normalised for our reasoning, the on-disk string for
// anything spoken to the CLI.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const cv   = require('../coreVersions');

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}` +
              (ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
}

// Build a throwaway tree shaped exactly like arduino-cli's.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-corever-'));
const hw   = cv.getHardwarePath(root);
fs.mkdirSync(hw, { recursive: true });

function plant(dirName, withBoardsTxt = true) {
  const d = path.join(hw, dirName);
  fs.mkdirSync(d, { recursive: true });
  if (withBoardsTxt) fs.writeFileSync(path.join(d, 'boards.txt'), 'name=stub\n');
}

plant('3.6');        // two-part, the one that broke uninstall
plant('4.6.0');      // three-part, as the system tree has it
plant('2.2', false); // present but incomplete: no boards.txt

try {
  check('two-part dir resolves from a normalised query',
        cv.installedVersionString(root, '3.6.0'), '3.6');
  check('two-part dir resolves from its own raw string',
        cv.installedVersionString(root, '3.6'), '3.6');
  check('three-part dir round-trips unchanged',
        cv.installedVersionString(root, '4.6.0'), '4.6.0');
  check('three-part dir resolves from a two-part query',
        cv.installedVersionString(root, '4.6'), '4.6.0');
  check('a version that is not there returns null',
        cv.installedVersionString(root, '5.0.0'), null);
  check('a directory without boards.txt does not count as installed',
        cv.installedVersionString(root, '2.2.0'), null);
  check('a missing tree returns null rather than throwing',
        cv.installedVersionString(path.join(root, 'nope'), '3.6.0'), null);

  // The companion invariant: listInstalled keeps reporting NORMALISED strings,
  // because everything else compares and sorts on those.
  check('listInstalled still normalises',
        cv.listInstalled(root).join(','), '3.6.0,4.6.0');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncore-version-string: all checks passed');
