/**
 * The locked error messages: they open only with their version's key, and an install collects
 * that key once from the key service, locked to it, then works offline.
 *
 * The key service side here follows jmt-studio-worker/src/keys.js; the live check in that repo
 * runs the app's unwrap against the deployed service.
 *
 * Run: node test/error-data-lock.test.js
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lock, unlock, lockedProblem, ErrorKeys, installIdOf, WRAP_SCHEME, DATASET } = require('../errorDataLock');
const { sample } = require('./plain-error-data');

const subtle = crypto.webcrypto.subtle;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };

async function hkdf(ikm, salt, info) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return Buffer.from(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: Buffer.from(salt), info: Buffer.from(info) }, base, 256));
}

// The key service, in memory: a key per version, wrapped to whichever install asks.
function keyService(published = 4) {
  const keys = new Map();
  const svc = { requests: 0, online: true, published, keyFor: v => { if (!keys.has(v)) keys.set(v, crypto.randomBytes(32)); return keys.get(v); } };
  svc.post = async (url, body, headers) => {
    svc.requests++;
    svc.lastHeaders = headers;
    svc.lastBody = body;
    if (!svc.online) throw new Error('offline');
    if (!url.endsWith('/v1/key') || !/^JMTStudio\/\d+\.\d+\.\d+/.test(headers['User-Agent'])) return { status: 404, json: null };
    if (body.version > svc.published) return { status: 404, json: null };
    const raw = Buffer.from(body.publicKey, 'base64');
    const id = installIdOf(raw);
    const installKey = await subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const shared = Buffer.from(await subtle.deriveBits({ name: 'ECDH', public: installKey }, eph.privateKey, 256));
    const wrapKey = await subtle.importKey('raw', await hkdf(shared, `jmt-studio/wrap/${id}`, `${WRAP_SCHEME}|v${body.version}`), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.randomBytes(12);
    const ct = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from(`${WRAP_SCHEME}|${DATASET}|v${body.version}|${id}`) },
      wrapKey, svc.keyFor(body.version)));
    return { status: 200, json: { scheme: WRAP_SCHEME, installId: id, version: body.version,
      epk: Buffer.from(await subtle.exportKey('raw', eph.publicKey)).toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') } };
  };
  return svc;
}

// Stands in for safeStorage: reversible, and visibly not the plain bytes.
const protect = { encrypt: b => Buffer.from(b.toString('base64').split('').reverse().join('')),
                  decrypt: b => Buffer.from(b.toString().split('').reverse().join(''), 'base64') };

const keysAt = (dir, svc, over = {}) => new ErrorKeys({ dir, protect, appVersion: '1.8.0', platform: 'win32', post: svc.post, ...over });

(async () => {
  console.log('1. the lock');
  const key = crypto.randomBytes(32);
  const data = sample(4);
  const locked = lock(data, key);
  const text = JSON.stringify(locked);
  ok('the locked file names its version and date only', locked.version === 4 && locked.updated === data.updated && lockedProblem(locked) === null);
  ok('nothing readable is in it', !text.includes('Sample title') && !text.includes('sample error'));
  ok('it opens to the same data with its key', JSON.stringify(unlock(locked, key)) === JSON.stringify(data));
  ok('another key cannot open it', throws(() => unlock(locked, crypto.randomBytes(32))));
  ok('a version relabelled cannot open it', throws(() => unlock({ ...locked, version: 5 }, key)));
  const body = Buffer.from(locked.data, 'base64'); body[3] ^= 1;
  ok('an altered body cannot open', throws(() => unlock({ ...locked, data: body.toString('base64') }, key)));
  ok('a plain file is not a locked one', lockedProblem(data) !== null);

  console.log('2. an install collects its key once');
  {
    const svc = keyService();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const lockedV4 = lock(sample(4), svc.keyFor(4));
    const ek = keysAt(dir, svc);
    ok('no identity before it is needed', ek.installId() === null && !fs.existsSync(ek.file));
    const opened = await ek.unlock(lockedV4);
    ok('the first unlock asks the key service and opens the data', opened.signatures[0].title === 'Sample title' && svc.requests === 1);
    ok('it asks as Studio', /^JMTStudio\/1\.8\.0 \(win32\)$/.test(svc.lastHeaders['User-Agent']));
    ok('the kept file is protected', !fs.readFileSync(ek.file, 'utf8').includes('privateKey'));
    svc.online = false;
    const later = keysAt(dir, svc);
    ok('the next start opens it offline from the kept key', (await later.unlock(lockedV4)).version === 4 && svc.requests === 1);
    ok('the same install keeps the same id', later.installId() === ek.installId() && /^[0-9a-f]{16}$/.test(ek.installId()));
    svc.online = true;
    svc.published = 5;
    await later.unlock(lock(sample(5), svc.keyFor(5)));
    ok('a new version asks once more with the same identity', svc.requests === 2 && later.installId() === ek.installId() && later.has(4) && later.has(5));
  }
  {
    const svc = keyService();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const ek = keysAt(dir, svc);
    await Promise.all([ek.key(4), ek.key(4), ek.key(4)]);
    ok('three asks at once make one request', svc.requests === 1);
  }

  {
    const svc = keyService();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const ek = keysAt(dir, svc);
    await ek.unlock(lock(sample(4), svc.keyFor(4)));
    const rotated = keyService();
    const after = keysAt(dir, rotated);
    const opened = await after.unlock(lock(sample(4), rotated.keyFor(4)));
    ok('a kept key from before the secret was replaced is asked for again, once',
      opened.version === 4 && rotated.requests === 1 && after.installId() === ek.installId());
    const stranger = keysAt(dir, rotated);
    ok('and is kept again', (await stranger.unlock(lock(sample(4), rotated.keyFor(4)))).version === 4 && rotated.requests === 1);
    ok('a file no key opens still fails after the one retry',
      await rejects(keysAt(dir, rotated).unlock(lock(sample(4), crypto.randomBytes(32)))) && rotated.requests === 2);
  }

  {
    const svc = keyService();
    const ek = keysAt(fs.mkdtempSync(path.join(os.tmpdir(), 'keys-')), svc);
    ok('a file that is not locked data is refused without asking the key service',
      await rejects(ek.unlock({ version: 0, updated: '' })) && await rejects(ek.unlock(null)) && svc.requests === 0);
  }

  console.log('2b. a lost key file registers as a replacement, not a new install');
  {
    const svc = keyService();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const noted = { id: null, get() { return this.id; }, set(id) { this.id = id; } };
    const locked4 = lock(sample(4), svc.keyFor(4));
    const first = keysAt(dir, svc, { registered: noted });
    await first.unlock(locked4);
    ok('a first registration says it replaces nothing', !('replaces' in svc.lastBody) && noted.id === first.installId());
    const oldId = first.installId();
    fs.rmSync(first.file);
    const again = keysAt(dir, svc, { registered: noted });
    await again.unlock(locked4);
    ok('after the key file is lost it registers again, naming the install it replaces',
      svc.lastBody.replaces === oldId && again.installId() !== oldId && noted.id === again.installId());
    const wiped = { id: null, get() { return this.id; }, set(id) { this.id = id; } };
    const fresh = keysAt(fs.mkdtempSync(path.join(os.tmpdir(), 'keys-')), svc, { registered: wiped });
    await fresh.unlock(locked4);
    ok('with the Studio data gone too it is a new install', !('replaces' in svc.lastBody));
  }
  {
    const svc = keyService();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const locked4 = lock(sample(4), svc.keyFor(4));
    await keysAt(dir, svc).unlock(locked4);
    const noted = { id: null, get() { return this.id; }, set(id) { this.id = id; } };
    const later = keysAt(dir, svc, { registered: noted });
    await later.unlock(locked4);
    ok('an install registered before ids were noted gets its id noted when it opens the data',
      noted.id === later.installId() && svc.requests === 1);
  }

  console.log('3. what it refuses');
  {
    const svc = keyService(4);
    const ek = keysAt(fs.mkdtempSync(path.join(os.tmpdir(), 'keys-')), svc);
    ok('a version not yet published gets no key', await rejects(ek.key(5)) && !ek.has(5));
    svc.online = false;
    ok('offline it fails and keeps nothing', await rejects(ek.key(4)) && !ek.has(4));
  }
  {
    const svc = keyService();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const a = keysAt(dir, svc);
    await a.key(4);
    const theirs = await svc.post('https://keys.jmtfoundry.com/v1/key',
      { publicKey: (await (async () => { const p = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        return Buffer.from(await subtle.exportKey('raw', p.publicKey)).toString('base64'); })()), version: 4 },
      { 'User-Agent': 'JMTStudio/1.8.0 (win32)' });
    const { unwrap } = require('../errorDataLock');
    const state = JSON.parse(protect.decrypt(fs.readFileSync(a.file)).toString());
    const priv = await subtle.importKey('pkcs8', Buffer.from(state.identity.privateKey, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    ok('a key locked to another install does not open here',
      await rejects(unwrap(theirs.json, priv, Buffer.from(state.identity.publicKey, 'base64'))));
  }
  {
    const svc = keyService();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
    const a = keysAt(dir, svc);
    await a.key(4);
    const firstId = a.installId();
    fs.writeFileSync(a.file, 'damaged');
    const b = keysAt(dir, svc);
    ok('a damaged kept file starts a new identity and asks again', (await b.key(4)).length === 32 && b.installId() !== firstId && svc.requests === 2);
  }

  console.log(failed ? `\n${failed} FAILURE(S)` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
