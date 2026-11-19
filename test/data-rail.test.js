/**
 * The rail never makes anything worse: only a newer, intact, valid copy changes what Studio shows.
 * The messages are locked, shipped copy and updates alike, and open only with their version's key.
 *
 * Run: node test/data-rail.test.js
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DataRail, problemWith, patternIsSafe, DATASET, RELEASE_BASE } = require('../dataRail');
const { unlock } = require('../errorDataLock');
const matrix = require('../compileErrorMatrix');
const { sample, lockedSample } = require('./plain-error-data');

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

// One key per version, as the key service hands them out. keyService.online = false refuses all.
function keyService() {
  const keys = new Map();
  const svc = { online: true, asked: 0, keyFor: v => { if (!keys.has(v)) keys.set(v, crypto.randomBytes(32)); return keys.get(v); } };
  svc.unlock = async (locked) => {
    svc.asked++;
    if (!svc.online) throw new Error('offline');
    return unlock(locked, svc.keyFor(locked.version));
  };
  return svc;
}

const shipped = (svc) => lockedSample(4, '2026-11-18', svc.keyFor(4)).locked;

function rig(svc, files, bundled = shipped(svc)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rail-'));
  const applied = [];
  const rail = new DataRail({
    userData: dir, appVersion: '1.8.0', bundled, unlock: svc.unlock, apply: d => applied.push(d),
    isAtLeast: (have, want) => have.localeCompare(want, undefined, { numeric: true }) >= 0,
    get: async (url) => {
      const name = url.split('/').pop();
      if (!(name in files)) throw new Error('offline');
      return files[name];
    },
  });
  return { rail, applied, dir };
}

// A published version: the locked file and an index naming it.
const site = (svc, version, over = {}, entry = {}) => {
  const data = { ...sample(version, '2030-01-02'), ...over };
  const { lock } = require('../errorDataLock');
  const text = JSON.stringify(lock(data, svc.keyFor(version)));
  return {
    'index.json': JSON.stringify({ schema: 1, datasets: { [DATASET]:
      { file: 'error-messages.locked.json', version, sha256: sha(text), ...entry } } }),
    'error-messages.locked.json': text,
  };
};

(async () => {
  ok('a pattern that backtracks is refused', !patternIsSafe('(a+)+$', ''));
  ok('a pattern that cannot compile is refused', !patternIsSafe('(', ''));
  ok('an ordinary pattern passes', patternIsSafe('was not declared', ''));
  ok('the sample data is valid', problemWith(sample()) === null);

  {
    const svc = keyService();
    const { rail, applied } = rig(svc, {});
    ok('nothing is open before start', !rail.status().unlocked && applied.length === 0);
    ok('start opens the shipped copy with its key', await rail.start() === true && applied.length === 1 && rail.status().unlocked);
    ok('a second start does nothing', await rail.start() === true && applied.length === 1);
  }
  {
    const svc = keyService();
    svc.online = false;
    const { rail, applied } = rig(svc, {});
    ok('with no key yet, start opens nothing and says so', await rail.start() === false && applied.length === 0);
    svc.online = true;
    ok('a later start (toolchain setup) opens it', await rail.start() === true && applied.length === 1);
  }
  {
    const svc = keyService();
    const other = keyService();
    const { rail, applied } = rig(svc, {}, shipped(other));
    ok('a shipped copy locked under another key does not open', await rail.start() === false && applied.length === 0);
  }
  {
    const svc = keyService();
    const { rail, applied } = rig(svc, site(svc, 5));
    await rail.start();
    ok('a newer copy is taken', await rail.check() === 'updated' && applied.length === 2 && applied[1].version === 5);
    ok('the status follows it', rail.status().updated === '2030-01-02');
    ok('it is kept locked on disk', !fs.readFileSync(rail.file, 'utf8').includes('Sample title'));
  }
  {
    const svc = keyService();
    svc.online = false;
    const { rail, applied } = rig(svc, site(svc, 5));
    ok('a check that cannot reach the key service changes nothing', await rail.check() === 'failed' && applied.length === 0);
  }
  {
    const svc = keyService();
    const { rail, applied } = rig(svc, {});
    await rail.start();
    ok('offline changes nothing', await rail.check() === 'failed' && applied.length === 1);
    ok('a failed check shows in the status', rail.status().lastCheck === 'failed');
  }
  {
    const svc = keyService();
    const { rail, applied } = rig(svc, site(svc, 4));
    await rail.start();
    ok('the same version is left alone', await rail.check() === 'current' && applied.length === 1);
    ok('a good check leaves no failure in the status', rail.status().lastCheck === 'current');
  }
  {
    const svc = keyService();
    const files = site(svc, 5);
    files['error-messages.locked.json'] = files['error-messages.locked.json'].replace('"version":5', '"version":5 ');
    const { rail, applied } = rig(svc, files);
    await rail.start();
    ok('a bad checksum is refused', await rail.check() === 'failed' && applied.length === 1);
  }
  {
    const svc = keyService();
    const evil = { signatures: [{ ...sample().signatures[0], match: '(a+)+$' }] };
    const { rail, applied } = rig(svc, site(svc, 5, evil));
    await rail.start();
    ok('a dangerous pattern refuses the whole file', await rail.check() === 'failed' && applied.length === 1);
  }
  {
    const svc = keyService();
    const { rail, applied } = rig(svc, site(svc, 5, { schema: 2 }));
    await rail.start();
    ok('a schema this app cannot read is refused', await rail.check() === 'failed' && applied.length === 1);
  }
  {
    const svc = keyService();
    const { rail, applied } = rig(svc, site(svc, 5, {}, { minAppVersion: '9.0.0' }));
    await rail.start();
    ok('data for a newer app is left alone', await rail.check() === 'current' && applied.length === 1);
  }
  {
    const svc = keyService();
    const first = rig(svc, site(svc, 5));
    await first.rail.start();
    await first.rail.check();
    const applied = [];
    const again = new DataRail({ ...first.rail.opts, apply: d => applied.push(d) });
    await again.start();
    ok('a kept copy opens at the next start', applied.length === 1 && applied[0].version === 5 && again.status().updated === '2030-01-02');
    fs.writeFileSync(again.file, 'not json');
    const broken = new DataRail({ ...first.rail.opts, apply: () => {} });
    await broken.start();
    ok('a damaged kept copy falls back to the shipped data', broken.status().version && broken.status().updated === '2026-11-18');
  }
  {
    const svc = keyService();
    const damaged = shipped(svc);
    const body = Buffer.from(damaged.data, 'base64'); body[5] ^= 1;
    damaged.data = body.toString('base64');
    const { rail, applied } = rig(svc, site(svc, 4), damaged);
    ok('a damaged shipped copy opens nothing', await rail.start() === false && applied.length === 0);
    ok('the next check mends it from the published copy of the same version',
      await rail.check() === 'updated' && applied.length === 1 && rail.status().unlocked);
    const after = [];
    const next = new DataRail({ ...rail.opts, apply: d => after.push(d) });
    ok('and the start after that opens the mended copy with no check', await next.start() === true && after.length === 1);
  }
  {
    const svc = keyService();
    const { rail, applied } = rig(svc, site(svc, 4), { version: 0, updated: '' });
    ok('an unreadable shipped copy is mended the same way', await rail.check() === 'updated' && applied.length === 1);
  }
  {
    const svc = keyService();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rail-'));
    const plainKept = path.join(dir, 'studio-data', `${DATASET}.json`);
    fs.mkdirSync(path.dirname(plainKept), { recursive: true });
    fs.writeFileSync(plainKept, JSON.stringify(sample(9)));
    rig(svc, {});
    new DataRail({ userData: dir, appVersion: '1.8.0', bundled: shipped(svc), unlock: svc.unlock, apply: () => {}, get: async () => '' });
    ok('a plain copy kept by an earlier build is removed', !fs.existsSync(plainKept));
  }
  {
    const svc = keyService();
    const { rail } = rig(svc, site(svc, 5));
    rail.opts.catalogue = { current: { version: RELEASE_BASE - 4, updated: '2026-01-01' }, check: async () => 'current' };
    ok('the shipped data reads 1.0', rail.status().version === '1.0', rail.status().version);
    await rail.start();
    await rail.check();
    ok('one dataset moving up by one reads 1.1', rail.status().version === '1.1', rail.status().version);
    rail.opts.catalogue.current.version++;
    ok('the other moving up too reads 1.2', rail.status().version === '1.2', rail.status().version);
  }

  matrix.setSignatures([
    ...sample().signatures,
    { id: 'needs-new-logic', severity: 'error', match: 'x', precondition: 'notInThisRelease', title: 't', meaning: 'm', fix: 'f' },
    { id: 'for-a-newer-app', severity: 'error', match: 'x', minAppVersion: '9.0.0', title: 't', meaning: 'm', fix: 'f' },
    { id: 'plain-new-entry', severity: 'error', match: 'brand new error', title: 'New title', meaning: 'm', fix: 'f' },
  ], '1.8.0');
  ok('an entry naming logic this app lacks is skipped', !matrix.SIGNATURES.some(s => s.id === 'needs-new-logic'));
  ok('an entry for a newer app is skipped', !matrix.SIGNATURES.some(s => s.id === 'for-a-newer-app'));
  ok('a pattern-only entry works with no release', matrix.resolve('brand new error').title === 'New title');
  matrix.setSignatures(sample().signatures, '1.8.0');
  ok('a set replaces the last one', matrix.SIGNATURES.length === 1);

  console.log(failed ? `\n${failed} failure(s)` : '\nall data rail tests passed');
  process.exit(failed ? 1 : 0);
})();
