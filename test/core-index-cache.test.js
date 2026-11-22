// The board index is cached for 24 hours, and the cache hit is the common path.
// It used to return { versions } without toolDeps, while the network path and
// both error paths all carried it. Nothing crashed: unusedToolDirs returns []
// the moment the map is empty, so a core's compiler was simply never counted or
// reclaimed. On a real machine that was ~1.4 GB reported as ~130 MB, and the
// symptom only appeared once the TTL had been warmed - a fresh fetch looked fine.
//
// Guards the shape of every return path rather than the one that broke.

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-idxcache-'));

// A cache entry that is fresh, so listAvailable takes the cache-hit branch and
// never touches the network.
fs.writeFileSync(path.join(tmp, 'core-index-cache.json'), JSON.stringify({
  fetchedAt: new Date().toISOString(),
  versions:  ['3.6.0', '4.6.0'],
  toolDeps:  {
    '3.6.0': ['arm-none-eabi-gcc@9-2020-q2-update'],
    '4.6.0': ['arm-none-eabi-gcc@14-2-rel1-xpack'],
  },
}), 'utf8');

(async () => {
  try {
    const res = await cv.resolveLatest(tmp);

    check('cache hit is not reported stale', res.stale, false);
    check('cache hit still carries toolDeps', Object.keys(res.toolDeps || {}).length, 2);
    check('the dependency itself survives',
          (res.toolDeps['3.6.0'] || []).join(','), 'arm-none-eabi-gcc@9-2020-q2-update');

    // Installing a core is what makes a directory a tree, so the fixtures below
    // create one. The original fixture wrote only the tool directories, which
    // modelled a tree holding no core at all - the one case where every tool is
    // genuinely an orphan - and so could not tell the two rules below apart.
    const mkTree = (name, installed) => {
      const root = path.join(tmp, name);
      const hw   = path.join(root, 'packages', 'proffieboard', 'hardware', 'stm32l4');
      for (const v of installed) {
        fs.mkdirSync(path.join(hw, v), { recursive: true });
        fs.writeFileSync(path.join(hw, v, 'boards.txt'), '', 'utf8');
      }
      return root;
    };
    const addTool = (root, ver) => fs.mkdirSync(
      path.join(root, 'packages', 'proffieboard', 'tools', 'arm-none-eabi-gcc', ver),
      { recursive: true });

    // The end-to-end consequence, and the shape of the ~1.4 GB case in the header:
    // one tree with 4.6 installed, still carrying the compiler a previous 3.6 left
    // behind. 4.6 is kept, so its own compiler stays and the stale one is offered.
    const legacy = mkTree('legacy', ['4.6']);
    addTool(legacy, '9-2020-q2-update');
    addTool(legacy, '14-2-rel1-xpack');

    const orphans = cv.unusedToolDirs(legacy, ['4.6.0'], res.toolDeps)
      .map(o => `${o.tool}@${o.version}`).sort();
    check('the stale compiler is reclaimable',
          orphans.join(','), 'arm-none-eabi-gcc@9-2020-q2-update');
    check('the kept core\'s own compiler is never offered',
          orphans.includes('arm-none-eabi-gcc@14-2-rel1-xpack'), false);

    // Per-core trees: a tool's identity is `name@version` with no tree in it, so
    // two trees whose cores share a compiler hold two physical copies. Sparing
    // one tree's copy because a core in ANOTHER tree needs that name reported
    // 64.2 MB where 707.5 MB was reclaimable. (2026-08-12)
    const treeA = mkTree('treeA', ['3.6']);   // kept
    addTool(treeA, '9-2020-q2-update');
    const treeB = mkTree('treeB', ['2.2']);   // being removed, same compiler
    addTool(treeB, '9-2020-q2-update');

    check('a kept core protects its own tree\'s copy',
          cv.unusedToolDirs(treeA, ['3.6.0'], res.toolDeps).length, 0);
    check('but not an identical copy in another tree',
          cv.unusedToolDirs(treeB, ['3.6.0'], res.toolDeps)
            .map(o => `${o.tool}@${o.version}`).join(','),
          'arm-none-eabi-gcc@9-2020-q2-update');

    // And the guard that makes the bug invisible: an empty map disables the whole
    // mechanism silently, which is why the missing field cost nothing visible.
    check('an empty toolDeps map reclaims nothing at all',
          cv.unusedToolDirs(legacy, ['4.6.0'], {}).length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\ncore-index-cache: all checks passed');
})();
