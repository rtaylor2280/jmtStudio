// The compile error messages travel locked. Each version of the data has its own key, which Studio
// gets from the JMT key service (keys.jmtfoundry.com) once per install, locked to that install:
//
//   1. The first time it needs a key, Studio makes a key pair for this install. The private half
//      stays on this computer, protected by safeStorage; the public half goes to the key service.
//   2. The key service returns that version's key, locked so only this install's private half can
//      open it (P-256 ECDH, HKDF-SHA256, AES-GCM).
//   3. Studio opens it and keeps it, protected by safeStorage, so it works offline from then on.
//
// The scheme matches jmt-studio-worker/src/keys.js byte for byte.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATASET = 'error-messages';
const LOCK_SCHEME = 'aes-256-gcm-1';
const WRAP_SCHEME = 'p256-hkdf-aesgcm-1';
const KEY_SERVICE = 'https://keys.jmtfoundry.com';

const subtle = crypto.webcrypto.subtle;

function _lockAad(version) {
  return Buffer.from(`${LOCK_SCHEME}|${DATASET}|v${version}`, 'utf8');
}

// Plain data (the parsed object) -> the locked file's object.
function lock(data, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(_lockAad(data.version));
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { schema: data.schema, dataset: DATASET, version: data.version, updated: data.updated,
           scheme: LOCK_SCHEME, iv: iv.toString('base64'), data: body.toString('base64') };
}

// Null when a locked file looks usable, otherwise why not. Says nothing about the contents.
function lockedProblem(locked) {
  if (!locked || locked.dataset !== DATASET || locked.scheme !== LOCK_SCHEME) return 'not locked error data';
  if (!Number.isInteger(locked.version) || locked.version < 1 || typeof locked.updated !== 'string') return 'version';
  if (typeof locked.iv !== 'string' || typeof locked.data !== 'string') return 'body';
  return null;
}

// The locked file's object -> the plain data. Throws when the key is wrong or the file was altered.
function unlock(locked, key) {
  const problem = lockedProblem(locked);
  if (problem) throw new Error(problem);
  const body = Buffer.from(locked.data, 'base64');
  if (body.length < 17) throw new Error('body');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(locked.iv, 'base64'));
  decipher.setAAD(_lockAad(locked.version));
  decipher.setAuthTag(body.subarray(body.length - 16));
  const text = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8');
  const data = JSON.parse(text);
  if (data.version !== locked.version) throw new Error('version');
  return data;
}

async function _hkdf(ikm, salt, info) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return Buffer.from(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: Buffer.from(salt, 'utf8'), info: Buffer.from(info, 'utf8') }, base, 256));
}

function installIdOf(publicRaw) {
  return crypto.createHash('sha256').update(publicRaw).digest('hex').slice(0, 16);
}

// Opens a key the key service locked to this install.
async function unwrap(wrapped, privateKey, publicRaw) {
  if (!wrapped || wrapped.scheme !== WRAP_SCHEME) throw new Error('unknown wrap scheme');
  const id = installIdOf(publicRaw);
  if (wrapped.installId !== id) throw new Error('wrapped for another install');
  const eph = await subtle.importKey('raw', Buffer.from(wrapped.epk, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = Buffer.from(await subtle.deriveBits({ name: 'ECDH', public: eph }, privateKey, 256));
  const wrapBytes = await _hkdf(shared, `jmt-studio/wrap/${id}`, `${WRAP_SCHEME}|v${wrapped.version}`);
  const wrapKey = await subtle.importKey('raw', wrapBytes, 'AES-GCM', false, ['decrypt']);
  const aad = Buffer.from(`${WRAP_SCHEME}|${DATASET}|v${wrapped.version}|${id}`, 'utf8');
  const key = Buffer.from(await subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(wrapped.iv, 'base64'), additionalData: aad }, wrapKey, Buffer.from(wrapped.ct, 'base64')));
  if (key.length !== 32) throw new Error('key length');
  return key;
}

// This install's identity and the keys it has collected, kept in one file under userData.
// opts: dir, protect ({ encrypt(Buffer) -> Buffer, decrypt(Buffer) -> Buffer } or null for none),
//       appVersion, platform, post(url, bodyObject, headers) -> Promise<{ status, json }>,
//       registered (optional { get() -> install id or null, set(id) }): where the install id is also
//       noted, apart from the key file, so an install whose key file is lost registers again as a
//       replacement of itself rather than as a new install.
class ErrorKeys {
  constructor(opts) {
    this.opts = opts;
    this.file = path.join(opts.dir, 'install-keys.bin');
    this._state = null;
    this._pending = new Map();
  }

  _read() {
    if (this._state) return this._state;
    try {
      let bytes = fs.readFileSync(this.file);
      if (this.opts.protect) bytes = this.opts.protect.decrypt(bytes);
      const state = JSON.parse(bytes.toString('utf8'));
      if (state && state.identity && state.keys) return (this._state = state);
    } catch {}
    return (this._state = { identity: null, keys: {} });
  }

  _write() {
    let bytes = Buffer.from(JSON.stringify(this._state), 'utf8');
    if (this.opts.protect) bytes = this.opts.protect.encrypt(bytes);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, bytes);
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  async _identity() {
    const state = this._read();
    if (!state.identity) {
      const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      state.identity = {
        privateKey: Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64'),
        publicKey: Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64'),
      };
      this._write();
    }
    const privateKey = await subtle.importKey('pkcs8', Buffer.from(state.identity.privateKey, 'base64'),
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    return { privateKey, publicRaw: Buffer.from(state.identity.publicKey, 'base64') };
  }

  has(version) { return !!this._read().keys[version]; }

  installId() {
    const state = this._read();
    return state.identity ? installIdOf(Buffer.from(state.identity.publicKey, 'base64')) : null;
  }

  // The key for a version: the kept one, or one asked for now. One request per version at a time.
  async key(version) {
    const kept = this._read().keys[version];
    if (kept) return Buffer.from(kept, 'base64');
    if (!this._pending.has(version)) {
      this._pending.set(version, this._fetch(version).finally(() => this._pending.delete(version)));
    }
    return this._pending.get(version);
  }

  async _fetch(version) {
    const { privateKey, publicRaw } = await this._identity();
    const id = installIdOf(publicRaw);
    const previous = this.opts.registered ? this.opts.registered.get() : null;
    const body = { publicKey: publicRaw.toString('base64'), version, appVersion: this.opts.appVersion, platform: this.opts.platform };
    if (typeof previous === 'string' && /^[0-9a-f]{16}$/.test(previous) && previous !== id) body.replaces = previous;
    const { status, json } = await this.opts.post(`${KEY_SERVICE}/v1/key`, body,
      { 'User-Agent': `JMTStudio/${this.opts.appVersion} (${this.opts.platform})` });
    if (status !== 200) throw new Error(`key service ${status}`);
    const key = await unwrap(json, privateKey, publicRaw);
    this._read().keys[version] = key.toString('base64');
    this._write();
    if (this.opts.registered && previous !== id) this.opts.registered.set(id);
    return key;
  }

  // A kept key that no longer opens its version (the key service's secret was replaced) is dropped
  // and asked for again, once.
  async unlock(locked) {
    const problem = lockedProblem(locked);
    if (problem) throw new Error(problem);
    const kept = this.has(locked.version);
    let data;
    try {
      data = unlock(locked, await this.key(locked.version));
    } catch (e) {
      if (!kept) throw e;
      delete this._read().keys[locked.version];
      this._write();
      data = unlock(locked, await this.key(locked.version));
    }
    this._noteRegistered();
    return data;
  }

  // An install registered before its id was noted gets it noted the first time it opens the data.
  _noteRegistered() {
    const id = this.installId();
    if (id && this.opts.registered && this.opts.registered.get() !== id) this.opts.registered.set(id);
  }
}

// The post() ErrorKeys uses in the app: JSON over HTTPS with a timeout.
async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

module.exports = { lock, unlock, lockedProblem, unwrap, installIdOf, ErrorKeys, postJson,
                   DATASET, LOCK_SCHEME, WRAP_SCHEME, KEY_SERVICE };
