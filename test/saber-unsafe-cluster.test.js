/**
 * Only a 32 KB card through a saber on Windows is refused, at any size of write, and the refusal
 * reaches every door by riding `unhealthy`.
 *
 * Run: node test/saber-unsafe-cluster.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

const root = path.join(__dirname, '..');
const ed = fs.readFileSync(path.join(root, 'exportDestination.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

ok('the size is exactly 32 KB', require('../exportDestination').SABER_UNSAFE_CLUSTER === 32768);
ok('the comparison is exact, so 8, 16 and 64 KB pass',
  (ed.match(/d\.blockSize === SABER_UNSAFE_CLUSTER/g) || []).length === 2
  && !/blockSize\s*>=?\s*SABER_UNSAFE_CLUSTER/.test(ed));

const lookup = ed.indexOf("if (!wantBoard && process.platform === 'win32' && d.blockSize");
const refuse = ed.indexOf('out.unhealthy = { saberUnsafeCluster: true }');
const health = ed.indexOf('const bad = await destinationHealth');
const fit = ed.indexOf('out.tooBig = {');
ok('a small write still asks whether it is a board card', lookup > 0 && lookup < refuse);
ok('the refusal comes before health and fit', refuse < health && refuse < fit);
ok('only a board card is refused', /if \(out\.boardCard && d\.blockSize === SABER_UNSAFE_CLUSTER[ )]/.test(ed));

for (const site of ['destDir, totalBytes: _bTotal', 'destDir: target }', 'destDir: destFolder }']) {
  ok(`the main door refuses: ${site}`, main.includes(`unhealthy: _pf.unhealthy, ${site}`));
}
ok('the card door checks before it writes', /_bkFit && _bkFit\.unhealthy/.test(html));
ok('the dialog carries the 32 KB wording', html.includes('Not safe to write to this card over Proffieboard mass storage')
  && html.includes('This card has 32 KB clusters') && html.includes('Nothing was exported.'));
ok('there is no way to continue', /bad\.saberUnsafeCluster[\s\S]{0,1200}hideCancel: true/.test(html));

ok('the refusal offers the same Eject row', /bad\.saberUnsafeCluster[\s\S]{0,1800}_sfWireEjectRow\(\{ target: ctx\.ejectTarget/.test(html));

// A Mac recognises board cards too, so the refusal needs its own platform gate. Measured
// 2026-11-07: 32 KB written through the board on a Mac checked clean. [B-614]
ok('the refusal is Windows only, even for a board card a Mac recognises',
  /if \(out\.boardCard && d\.blockSize === SABER_UNSAFE_CLUSTER && process\.platform === 'win32'\)/.test(ed));

ok('the file still loads', childProcess.spawnSync(process.execPath, ['-e', "require('./exportDestination')"], { cwd: root }).status === 0);

console.log(failed ? `\n${failed} failure(s)` : '\nall saber cluster tests passed');
process.exit(failed ? 1 : 0);
