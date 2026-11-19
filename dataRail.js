// Data Studio can pick up between releases, from the jmt-studio-data-public repo.
//
// The app always has the copy it shipped with, so this only ever adds to it. A failed fetch, a bad
// checksum or a file that does not validate changes no data and interrupts nobody; the About row is
// the only place it shows. Nothing ever waits on it. A copy that passes is kept in userData and
// loaded at the next start.
//
// The error messages are locked (errorDataLock.js), the shipped copy and every update alike, and are
// kept locked on disk. opts.unlock opens one, asking the key service for its key the first time.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { lockedProblem } = require('./errorDataLock');

const BASE_URL = 'https://raw.githubusercontent.com/rtaylor2280/jmt-studio-data-public/main/';
const SCHEMA = 1;
const DATASET = 'error-messages';
const CATALOGUE_DATASET = 'font-catalogue';
const MAX_PATTERN = 300;
const MAX_SIGNATURES = 2000;
const MAX_TEXT = 1000;
const PATTERN_BUDGET_MS = 50;
// About shows SCHEMA.n, where n is the dataset versions added together less this base, so the data 1.8
// shipped with (error messages 4, locked catalogue 8) reads 1.0 and each dataset publish adds one.
const RELEASE_BASE = 12;

const SAMPLES = ['a'.repeat(2000), `'${'a'.repeat(1000)}' was not declared in this scope`, ' '.repeat(2000),
                 `${'<'.repeat(1000)}${'>'.repeat(1000)}`];

// A pattern that backtracks badly would hang the main process, because a RegExp cannot be
// interrupted once running. Each one runs here first, in a context that can be timed out.
function patternIsSafe(source, flags) {
  if (typeof source !== 'string' || !source || source.length > MAX_PATTERN) return false;
  try { new RegExp(source, flags || ''); } catch { return false; }
  try {
    vm.runInNewContext('for (const s of samples) new RegExp(source, flags).test(s);',
      { source, flags: flags || '', samples: SAMPLES }, { timeout: PATTERN_BUDGET_MS });
  } catch { return false; }
  return true;
}

// Null when the data is usable, otherwise why it is not.
function problemWith(data) {
  if (!data || data.schema !== SCHEMA) return 'schema';
  if (!Number.isInteger(data.version) || typeof data.updated !== 'string') return 'version';
  if (!Array.isArray(data.signatures) || !data.signatures.length
      || data.signatures.length > MAX_SIGNATURES) return 'signatures';
  const ids = new Set();
  for (const s of data.signatures) {
    if (!s || typeof s.id !== 'string' || ids.has(s.id)) return 'id';
    ids.add(s.id);
    if (s.severity !== 'error' && s.severity !== 'noise') return `${s.id}: severity`;
    for (const k of ['title', 'meaning', 'fix']) {
      if (typeof s[k] !== 'string' || !s[k] || s[k].length > MAX_TEXT) return `${s.id}: ${k}`;
    }
    if (!patternIsSafe(s.match, s.flags)) return `${s.id}: pattern`;
  }
  return null;
}

const _sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

class DataRail {
  // opts: userData, appVersion, bundled (the locked shipped copy), unlock(locked) -> Promise<data>,
  //       apply(data), get(url) -> Promise<string>, isAtLeast(have, want), catalogue (optional)
  constructor(opts) {
    this.opts = opts;
    this.current = { version: opts.bundled.version, updated: opts.bundled.updated };
    this.unlocked = false;
    this.lastCheck = null;
    this.file = path.join(opts.userData, 'studio-data', `${DATASET}.locked.json`);
    try { fs.rmSync(path.join(opts.userData, 'studio-data', `${DATASET}.json`), { force: true }); } catch {}
  }

  _keptLocked() {
    try {
      const locked = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // A kept copy is only ever written after it opened, so the same version as the shipped one is a
      // repair of a shipped copy that would not open.
      if (!lockedProblem(locked) && locked.version >= this.opts.bundled.version) return locked;
    } catch {}
    return null;
  }

  async _open(locked) {
    const data = await this.opts.unlock(locked);
    if (problemWith(data) || data.version !== locked.version) throw new Error('invalid');
    return data;
  }

  // Opens the newer of the shipped copy and the last one kept. Safe to call again: it does nothing
  // once the messages are open, and a call that cannot reach the key service changes nothing.
  async start() {
    if (this.unlocked) return true;
    if (!this._starting) {
      this._starting = (async () => {
        for (const locked of [this._keptLocked(), this.opts.bundled]) {
          if (!locked) continue;
          try {
            const data = await this._open(locked);
            this.opts.apply(data);
            this.current = { version: data.version, updated: data.updated };
            this.unlocked = true;
            return true;
          } catch {}
        }
        return false;
      })().finally(() => { this._starting = null; });
    }
    return this._starting;
  }

  async check() {
    this.lastCheck = await this._check();
    return this.lastCheck;
  }

  async _check() {
    try {
      const index = JSON.parse(await this.opts.get(`${BASE_URL}index.json`));
      const entry = index && index.schema === SCHEMA && index.datasets && index.datasets[DATASET];
      if (!entry) return 'failed';
      const results = [await this._checkErrors(entry), await this._checkCatalogue(index.datasets[CATALOGUE_DATASET])];
      if (results.includes('failed')) return 'failed';
      return results.includes('updated') ? 'updated' : 'current';
    } catch { return 'failed'; }
  }

  _tooNew(entry) {
    return entry.minAppVersion && !this.opts.isAtLeast(this.opts.appVersion, entry.minAppVersion);
  }

  async _checkCatalogue(entry) {
    if (!this.opts.catalogue || !entry || this._tooNew(entry)) return 'current';
    return this.opts.catalogue.check(BASE_URL, entry);
  }

  async _checkErrors(entry) {
    try {
      if (!this.unlocked) await this.start();
      // A shipped copy that will not open (damaged on disk) is replaced by the published one, even at
      // the same version, so it mends at the next check instead of the next release.
      const repair = !this.unlocked;
      if (repair ? entry.version < this.opts.bundled.version : !(entry.version > this.current.version)) {
        return repair ? 'failed' : 'current';
      }
      if (this._tooNew(entry)) return 'current';
      const text = await this.opts.get(`${BASE_URL}${entry.file}`);
      if (_sha256(text) !== entry.sha256) return 'failed';
      const locked = JSON.parse(text);
      if (lockedProblem(locked) || locked.version !== entry.version) return 'failed';
      const data = await this._open(locked);
      this.opts.apply(data);
      this.current = { version: data.version, updated: data.updated };
      this.unlocked = true;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, text);
      fs.renameSync(`${this.file}.tmp`, this.file);
      return 'updated';
    } catch (e) { console.warn('[data rail] error messages:', e && e.message); return 'failed'; }
  }

  // About shows SCHEMA.n (see RELEASE_BASE) and the newest date across the datasets.
  status() {
    const catalogue = this.opts.catalogue && this.opts.catalogue.current;
    const n = Math.max(0, this.current.version + (catalogue ? catalogue.version : 0) - RELEASE_BASE);
    const version = `${SCHEMA}.${n}`;
    const updated = catalogue && catalogue.updated > this.current.updated ? catalogue.updated : this.current.updated;
    return { version, updated, lastCheck: this.lastCheck, unlocked: this.unlocked };
  }
}

module.exports = { DataRail, problemWith, patternIsSafe, DATASET, SCHEMA, RELEASE_BASE };
