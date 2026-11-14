// Build space counts a hard-linked file once. A JMT tree hard-links its compiler from the base
// tree, so a per-entry stat.size sum counted ~1.4 GB twice in the footprint, and a reset removing
// the JMT tree while its base stays promised bytes it could not free. [B-677]
//
// Run: node test/build-space-hard-links.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
function lift(decl) {
  const s = M.indexOf(decl);
  if (s < 0) throw new Error(`not found in main.js: ${decl}`);
  let depth = 0, j = M.indexOf('{', M.indexOf(') {', s));
  for (; j < M.length; j++) {
    const c = M[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return M.slice(s, j);
}
// eslint-disable-next-line no-new-func
const { _dirSize, _reclaimTally } = new Function('fs', 'path',
  `${lift('function _walkBytes')}\n${lift('function _dirSize')}\n${lift('function _reclaimTally')}\n` +
  'return { _dirSize, _reclaimTally };')(fs, path);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-links-'));
try {
  // base/ holds the compiler and a file of its own; jmt/ links the compiler and has its own file.
  const base = path.join(root, 'base'), jmt = path.join(root, 'jmt');
  fs.mkdirSync(path.join(base, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(jmt, 'tools'), { recursive: true });
  const GCC = 10000, OWN_B = 300, OWN_J = 70;
  fs.writeFileSync(path.join(base, 'tools', 'gcc'), Buffer.alloc(GCC));
  fs.writeFileSync(path.join(base, 'platform.txt'), Buffer.alloc(OWN_B));
  fs.linkSync(path.join(base, 'tools', 'gcc'), path.join(jmt, 'tools', 'gcc'));
  fs.writeFileSync(path.join(jmt, 'lib.a'), Buffer.alloc(OWN_J));

  console.log('1. footprint');
  ok('one tree alone counts its files', _dirSize(base) === GCC + OWN_B, String(_dirSize(base)));
  ok('the parent walked once counts the linked compiler once',
    _dirSize(root) === GCC + OWN_B + OWN_J, String(_dirSize(root)));
  const seen = new Set();
  const both = _dirSize(base, seen) + _dirSize(jmt, seen);
  ok('two walks sharing one set count it once', both === GCC + OWN_B + OWN_J, String(both));
  ok('CONTROL two walks without a shared set count it in each',
    _dirSize(base) + _dirSize(jmt) === 2 * GCC + OWN_B + OWN_J);

  console.log('2. reset reclaim');
  {
    const r = _reclaimTally();
    let bytes = r.size(jmt, 'tools');
    bytes += r.settle().tools || 0;
    ok('removing the JMT tree while its base stays frees only its own files', bytes === OWN_J, String(bytes));
  }
  {
    const r = _reclaimTally();
    let bytes = r.size(base, 'tools') + r.size(jmt, 'tools');
    bytes += r.settle().tools || 0;
    ok('removing both frees the compiler once', bytes === GCC + OWN_B + OWN_J, String(bytes));
  }
  {
    const r = _reclaimTally();
    const tools = r.size(base, 'tools');
    const orphan = r.size(jmt, 'orphan');
    const s = r.settle();
    ok('the freed compiler lands in the bucket that saw it first, once',
      tools + (s.tools || 0) === GCC + OWN_B && orphan + (s.orphan || 0) === OWN_J, JSON.stringify(s));
  }

  console.log('3. wiring');
  const sv = M.slice(M.indexOf('async function _surveyBuildSpace'), M.indexOf("ipcMain.handle('space:survey'"));
  ok('the footprint shares one set across the tree roots', /_dirSize\(r, footprintSeen\)/.test(sv));
  ok('removed trees and tool folders are sized through the tally',
    /toolBytes \+= reclaim\.size\(treePath, 'tools'\)/.test(sv) && /strayToolBytes \+= reclaim\.size\(t\.path, 'stray'\)/.test(sv)
    && /orphanTreeBytes \+= reclaim\.size\(p, 'orphan'\)/.test(sv));
  ok('the tally is settled before the total', sv.indexOf('reclaim.settle()') > 0 && sv.indexOf('reclaim.settle()') < sv.indexOf('const total ='));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
