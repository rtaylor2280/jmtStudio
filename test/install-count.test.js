// Install count [B-687]: one download per version per computer, retried until it succeeds, nothing sent.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ic = require('../installCount');

let failed = 0, passed = 0;
const pending = [];
const t = (name, fn) => pending.push(async () => {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message); }
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'install-count-'));

t('first run downloads the version file once; later launches do not', async () => {
  const ud = tmp();
  const urls = [];
  const get = async (u) => { urls.push(u); return '{}'; };
  assert.strictEqual(await ic.countFirstRun({ userData: ud, version: '1.8.0', get }), true);
  assert.strictEqual(await ic.countFirstRun({ userData: ud, version: '1.8.0', get }), false);
  assert.deepStrictEqual(urls, ['https://github.com/rtaylor2280/jmtStudio/releases/download/counters/first-run-1.8.0.json']);
  fs.rmSync(ud, { recursive: true, force: true });
});

t('a failed download writes no marker, so the next launch tries again', async () => {
  const ud = tmp();
  assert.strictEqual(await ic.countFirstRun({ userData: ud, version: '1.8.0', get: async () => { throw new Error('offline'); } }), false);
  assert.strictEqual(fs.existsSync(path.join(ud, ic.MARKER)), false);
  assert.strictEqual(await ic.countFirstRun({ userData: ud, version: '1.8.0', get: async () => '{}' }), true);
  fs.rmSync(ud, { recursive: true, force: true });
});

t('each new version counts once on the same computer', async () => {
  const ud = tmp();
  const get = async () => '{}';
  await ic.countFirstRun({ userData: ud, version: '1.8.0', get });
  assert.strictEqual(await ic.countFirstRun({ userData: ud, version: '1.8.1', get }), true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ud, ic.MARKER), 'utf8')).counted, ['1.8.0', '1.8.1']);
  fs.rmSync(ud, { recursive: true, force: true });
});

t('the request carries nothing but the version in the file name', async () => {
  const u = ic.COUNTER_URL('1.8.0');
  assert.ok(!u.includes('?'), 'no query string');
  assert.ok(/\/first-run-1\.8\.0\.json$/.test(u));
});

t('a bad version or a missing folder does nothing', async () => {
  let called = false;
  const get = async () => { called = true; };
  assert.strictEqual(await ic.countFirstRun({ userData: tmp(), version: 'dev', get }), false);
  assert.strictEqual(await ic.countFirstRun({ userData: '', version: '1.8.0', get }), false);
  assert.strictEqual(called, false);
});

(async () => {
  for (const run of pending) await run();
  console.log(`\ninstall-count: ${failed ? failed + ' FAILED, ' : 'all '}${passed} passed`);
  process.exit(failed ? 1 : 0);
})();
