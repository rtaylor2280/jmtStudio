// Data Studio can pick up between releases, from the jmt-studio-data repo.
//
// The app always has the copy it shipped with, so this only ever adds to it. A failed fetch, a bad
// checksum or a file that does not validate changes no data and interrupts nobody; the About row is
// the only place it shows. Nothing ever waits on it. A copy that passes is kept in userData and
// loaded at the next start.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE_URL = 'https://raw.githubusercontent.com/rtaylor2280/jmt-studio-data/main/';
const SCHEMA = 1;
const DATASET = 'error-messages';
const CATALOGUE_DATASET = 'font-catalogue';
const MAX_PATTERN = 300;
const MAX_SIGNATURES = 2000;
const MAX_TEXT = 1000;
const PATTERN_BUDGET_MS = 50;

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
  // opts: userData, appVersion, bundled, apply(data), get(url) -> Promise<string>, catalogue (optional)
  constructor(opts) {
    this.opts = opts;
    this.current = { version: opts.bundled.version, updated: opts.bundled.updated };
    this.lastCheck = null;
    this.file = path.join(opts.userData, 'studio-data', `${DATASET}.json`);
  }

  // The newer of the shipped copy and the last one kept.
  loadKept() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (problemWith(data) || data.version <= this.current.version) return;
      this.opts.apply(data);
      this.current = { version: data.version, updated: data.updated };
    } catch {}
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
      if (!(entry.version > this.current.version)) return 'current';
      if (this._tooNew(entry)) return 'current';
      const text = await this.opts.get(`${BASE_URL}${entry.file}`);
      if (_sha256(text) !== entry.sha256) return 'failed';
      const data = JSON.parse(text);
      if (problemWith(data) || data.version <= this.current.version) return 'failed';
      this.opts.apply(data);
      this.current = { version: data.version, updated: data.updated };
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, text);
      fs.renameSync(`${this.file}.tmp`, this.file);
      return 'updated';
    } catch { return 'failed'; }
  }

  // One number for About: the versions added, so it rises when either dataset does.
  status() {
    const catalogue = this.opts.catalogue && this.opts.catalogue.current;
    const version = this.current.version + (catalogue ? catalogue.version : 0);
    const updated = catalogue && catalogue.updated > this.current.updated ? catalogue.updated : this.current.updated;
    return { version, updated, lastCheck: this.lastCheck };
  }
}

module.exports = { DataRail, problemWith, patternIsSafe, DATASET, SCHEMA };
