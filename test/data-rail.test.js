/**
 * The rail never makes anything worse: only a newer, intact, valid copy changes what Studio shows.
 *
 * Run: node test/data-rail.test.js
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DataRail, problemWith, patternIsSafe, DATASET } = require('../dataRail');
const matrix = require('../compileErrorMatrix');
const bundled = require('../compileErrorData');

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const newer = (over = {}) => ({ ...bundled, version: bundled.version + 1, updated: '2030-01-02', ...over });

function rig(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rail-'));
  const applied = [];
  const rail = new DataRail({
    userData: dir, appVersion: '1.8.0', bundled, apply: d => applied.push(d),
    isAtLeast: (have, want) => have.localeCompare(want, undefined, { numeric: true }) >= 0,
    get: async (url) => {
      const name = url.split('/').pop();
      if (!(name in files)) throw new Error('offline');
      return files[name];
    },
  });
  return { rail, applied, dir };
}

const site = (data, entry = {}) => {
  const text = JSON.stringify(data);
  return {
    'index.json': JSON.stringify({ schema: 1, datasets: { [DATASET]:
      { file: 'error-messages.json', version: data.version, sha256: sha(text), ...entry } } }),
    'error-messages.json': text,
  };
};

(async () => {
  ok('the shipped data is valid', problemWith(bundled) === null, problemWith(bundled));
  ok('a pattern that backtracks is refused', !patternIsSafe('(a+)+$', ''));
  ok('a pattern that cannot compile is refused', !patternIsSafe('(', ''));
  ok('an ordinary pattern passes', patternIsSafe('was not declared', ''));

  {
    const { rail, applied } = rig(site(newer()));
    ok('a newer copy is taken', await rail.check() === 'updated' && applied.length === 1);
    ok('the status follows it', rail.status().updated === '2030-01-02');
  }
  {
    const { rail, applied } = rig({});
    ok('offline changes nothing', await rail.check() === 'failed' && applied.length === 0);
    ok('a failed check shows in the status', rail.status().lastCheck === 'failed');
  }
  {
    const { rail, applied } = rig(site(bundled));
    ok('the same version is left alone', await rail.check() === 'current' && applied.length === 0);
    ok('a good check leaves no failure in the status', rail.status().lastCheck === 'current');
  }
  {
    const files = site(newer());
    files['error-messages.json'] += ' ';
    const { rail, applied } = rig(files);
    ok('a bad checksum is refused', await rail.check() === 'failed' && applied.length === 0);
  }
  {
    const evil = newer({ signatures: [{ ...bundled.signatures[0], match: '(a+)+$' }] });
    const { rail, applied } = rig(site(evil));
    ok('a dangerous pattern refuses the whole file', await rail.check() === 'failed' && applied.length === 0);
  }
  {
    const { rail, applied } = rig(site(newer({ schema: 2 })));
    ok('a schema this app cannot read is refused', await rail.check() === 'failed' && applied.length === 0);
  }
  {
    const { rail, applied } = rig(site(newer(), { minAppVersion: '9.0.0' }));
    ok('data for a newer app is left alone', await rail.check() === 'current' && applied.length === 0);
  }
  {
    const files = site(newer());
    const first = rig(files);
    await first.rail.check();
    const again = new DataRail({ ...first.rail.opts, apply: d => first.applied.push(d) });
    again.loadKept();
    ok('a kept copy loads at the next start', first.applied.length === 2 && again.status().updated === '2030-01-02');
    fs.writeFileSync(again.file, 'not json');
    const broken = new DataRail({ ...first.rail.opts });
    broken.loadKept();
    ok('a damaged kept copy falls back to the shipped data', broken.status().version === bundled.version);
  }

  const original = matrix.SIGNATURES.length;
  matrix.setSignatures([
    ...bundled.signatures,
    { id: 'needs-new-logic', severity: 'error', match: 'x', precondition: 'notInThisRelease', title: 't', meaning: 'm', fix: 'f' },
    { id: 'for-a-newer-app', severity: 'error', match: 'x', minAppVersion: '9.0.0', title: 't', meaning: 'm', fix: 'f' },
    { id: 'plain-new-entry', severity: 'error', match: 'brand new error', title: 'New title', meaning: 'm', fix: 'f' },
  ], '1.8.0');
  ok('an entry naming logic this app lacks is skipped', !matrix.SIGNATURES.some(s => s.id === 'needs-new-logic'));
  ok('an entry for a newer app is skipped', !matrix.SIGNATURES.some(s => s.id === 'for-a-newer-app'));
  ok('a pattern-only entry works with no release', matrix.resolve('brand new error').title === 'New title');
  matrix.setSignatures(bundled.signatures, '1.8.0');
  ok('the shipped set restores', matrix.SIGNATURES.length === original);

  console.log(failed ? `\n${failed} failure(s)` : '\nall data rail tests passed');
  process.exit(failed ? 1 : 0);
})();
