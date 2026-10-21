// Fonts renamed in one save are renamed as a set, so a name another font gives up is free to take.
//
// 2026-10-21: in the source window, swapping Cal_Blue and Cal_Cyan failed both ways with "An entry
// named ... already exists", because each row was renamed alone while the other still held its name.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../soundFontEntries.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
function library(names) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-rnbatch-'));
  dirs.push(ud);
  const root = E.entriesRoot(ud);
  for (const name of names) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'meta.json'), JSON.stringify({ name, entryUuid: `u-${name}` }));
    fs.writeFileSync(path.join(root, name, 'hum.wav'), `hum of ${name}`);
  }
  const hum = (n) => fs.readFileSync(path.join(root, n, 'hum.wav'), 'utf8');
  const metaName = (n) => JSON.parse(fs.readFileSync(path.join(root, n, 'meta.json'), 'utf8')).name;
  const list = () => fs.readdirSync(root).sort();
  return { ud, root, hum, metaName, list };
}

console.log('a swap');
{
  const L = library(['Cal_Blue', 'Cal_Cyan', 'Other']);
  const r = E.renameEntries(L.ud, [{ from: 'Cal_Blue', to: 'Cal_Cyan' }, { from: 'Cal_Cyan', to: 'Cal_Blue' }]);
  check('TWO FONTS CAN TRADE NAMES', r.ok && r.renamed.length === 2, JSON.stringify(r));
  check('each folder holds the other font now', L.hum('Cal_Cyan') === 'hum of Cal_Blue' && L.hum('Cal_Blue') === 'hum of Cal_Cyan');
  check('and each record carries its new name', L.metaName('Cal_Cyan') === 'Cal_Cyan' && L.metaName('Cal_Blue') === 'Cal_Blue');
  check('nothing temporary is left', L.list().join(',') === 'Cal_Blue,Cal_Cyan,Other', L.list().join(','));
}

console.log('a chain, and a change of case');
{
  const L = library(['A', 'B', 'c']);
  const r = E.renameEntries(L.ud, [{ from: 'A', to: 'B' }, { from: 'B', to: 'D' }, { from: 'c', to: 'C' }]);
  check('A NAME FREED BY ANOTHER ROW CAN BE REUSED', r.ok && L.hum('B') === 'hum of A' && L.hum('D') === 'hum of B', JSON.stringify(r));
  check('a case-only rename in the same save', L.list().includes('C') && !L.list().includes('c') && L.hum('C') === 'hum of c', L.list().join(','));
}

console.log('refusals: nothing moves');
{
  const L = library(['A', 'B', 'Other']);
  const r = E.renameEntries(L.ud, [{ from: 'A', to: 'Same' }, { from: 'B', to: 'same' }]);
  check('TWO FONTS CANNOT END UP WITH ONE NAME', !r.ok && r.failures.length === 1, JSON.stringify(r));
  const r2 = E.renameEntries(L.ud, [{ from: 'A', to: 'B' }, { from: 'B', to: 'other' }]);
  check("A NAME HELD BY A FONT OUTSIDE THE SAVE IS STILL REFUSED", !r2.ok && r2.failures.some((f) => f.existing), JSON.stringify(r2));
  check('and the refused save renamed nothing at all', L.list().join(',') === 'A,B,Other' && L.hum('A') === 'hum of A', L.list().join(','));
}

console.log('a kill between the two moves');
{
  const L = library(['Keep']);
  // What a kill after the first move leaves: the font under its temporary name, headed for "Next".
  fs.renameSync(path.join(L.root, 'Keep'), path.join(L.root, 'Next.jmt-rename-1700000000000'));
  const r = E.finishInterruptedRenames(L.ud);
  check('THE RENAME IS FINISHED AT STARTUP', r.finished === 1 && L.list().join(',') === 'Next' && L.metaName('Next') === 'Next',
    `${JSON.stringify(r)} ${L.list().join(',')}`);
  // Its target taken meanwhile: left where it is, never overwriting anything.
  const L2 = library(['Taken', 'X']);
  fs.renameSync(path.join(L2.root, 'X'), path.join(L2.root, 'Taken.jmt-rename-1700000000000'));
  const r2 = E.finishInterruptedRenames(L2.ud);
  check('a taken target is left alone', r2.finished === 0 && L2.hum('Taken') === 'hum of Taken', L2.list().join(','));
}

for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
