// The font catalogue: its plain form, split into files for the private data repo, and the rail that
// keeps the app's locked copy (catalogueLock.js) current from the public one.
//
// The locked catalogue is one file, fetched whole, checked against its checksum and its shape before
// anything changes, and kept in the shape the app ships with.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const lock = require('./catalogueLock');

const SCHEMA = 1;
const ID = /^[a-z0-9]+(-+[a-z0-9]+)*$/;
const HASH = /^[0-9a-f]{16}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_CREATORS = 500;
const MAX_FONTS = 5000;
const MAX_SOUNDS = 5000;
const MAX_TAGS = 50;
const MAX_TEXT = 300;
const MAX_URL = 500;

const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const toText = obj => `${JSON.stringify(obj)}\n`;

const fontPath = id => `fonts/sounds/${id}.json`;
const creatorPath = id => `fonts/creators/${id}.json`;
const INDEX_PATH = 'fonts/index.json';
const LOCKED_PATH = 'font-catalogue.json';
const BOX = /^[A-Za-z0-9_-]{16}$/;
const SEALED = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_SEALED = 20000;

const fontFile = f => ({ id: f.id, sounds: f.sounds });
const creatorFile = c => ({ id: c.id, name: c.name, website: c.website,
  fonts: c.fonts.map(({ id, name, demo, store, tags, free, sha256: sum }) => ({
    id, name, demo, store, ...(tags && tags.length ? { tags } : {}), ...(free ? { free: true } : {}), sha256: sum,
  })) });

// The catalogue split into its published files, with each checksum written onto what it describes.
function catalogueFiles(data) {
  const files = new Map();
  const creators = data.creators.map((c) => {
    const fonts = c.fonts.map((f) => {
      const text = toText(fontFile(f));
      files.set(fontPath(f.id), text);
      return { ...f, sha256: sha256(text) };
    });
    const stamped = { ...c, fonts };
    const text = toText(creatorFile(stamped));
    files.set(creatorPath(c.id), text);
    return { ...stamped, sha256: sha256(text) };
  });
  const index = toText({ schema: SCHEMA, version: data.version, updated: data.updated,
    creators: creators.map(c => ({ id: c.id, sha256: c.sha256 })) });
  files.set(INDEX_PATH, index);
  return { files, data: { ...data, creators }, indexSha: sha256(index) };
}

const isText = (s, max = MAX_TEXT) => typeof s === 'string' && s.length <= max;
const isLink = s => s === '' || (isText(s, MAX_URL) && /^https?:\/\//i.test(s));

function fontProblem(f) {
  if (!f || !ID.test(f.id) || !f.name || !isText(f.name)) return 'font';
  if (!isLink(f.demo) || !isLink(f.store) || !SHA.test(f.sha256)) return `${f.id}: details`;
  if (f.tags !== undefined && (!Array.isArray(f.tags) || f.tags.length > MAX_TAGS || !f.tags.every(t => t && isText(t)))) return `${f.id}: tags`;
  if (f.free !== undefined && typeof f.free !== 'boolean') return `${f.id}: free`;
  if (!Array.isArray(f.sounds) || !f.sounds.length || f.sounds.length > MAX_SOUNDS) return `${f.id}: sounds`;
  for (const s of f.sounds) {
    if (!Array.isArray(s) || !isText(s[0]) || !HASH.test(s[1])) return `${f.id}: sound`;
  }
  return null;
}

// Null when the catalogue is usable, otherwise why it is not.
function catalogueProblem(data) {
  if (!data || data.schema !== SCHEMA) return 'schema';
  if (!Number.isInteger(data.version) || typeof data.updated !== 'string') return 'version';
  if (!Array.isArray(data.creators) || !data.creators.length || data.creators.length > MAX_CREATORS) return 'creators';
  const ids = new Set();
  for (const c of data.creators) {
    if (!c || !ID.test(c.id) || !c.name || !isText(c.name) || !isLink(c.website) || !SHA.test(c.sha256)) return 'creator';
    if (!Array.isArray(c.fonts) || !c.fonts.length || c.fonts.length > MAX_FONTS) return `${c.id}: fonts`;
    for (const f of c.fonts) {
      const problem = fontProblem(f);
      if (problem) return problem;
      if (ids.has(f.id)) return `${f.id}: twice`;
      ids.add(f.id);
    }
  }
  return null;
}

// Null when a locked catalogue is usable, otherwise why it is not.
function lockedProblem(data) {
  if (!data || data.schema !== lock.SCHEMA) return 'schema';
  if (!Number.isInteger(data.version) || typeof data.updated !== 'string') return 'version';
  if (typeof data.salt !== 'string' || Buffer.from(data.salt, 'base64').length !== 16) return 'salt';
  if (!Array.isArray(data.fonts) || !data.fonts.length || data.fonts.length > MAX_FONTS) return 'fonts';
  for (const f of data.fonts) {
    if (!f || !SEALED.test(f.m || '') || !SEALED.test(f.f || '') || f.m.length > MAX_SEALED || f.f.length > MAX_SEALED) return 'font';
  }
  if (!data.boxes || typeof data.boxes !== 'object' || Array.isArray(data.boxes)) return 'boxes';
  const keys = Object.keys(data.boxes);
  if (!keys.length || keys.length > MAX_FONTS * MAX_SOUNDS) return 'boxes';
  for (const k of keys) {
    const v = data.boxes[k];
    if (!BOX.test(k) || typeof v !== 'string' || v.length > MAX_SEALED || !SEALED.test(v)) return 'box';
  }
  return null;
}

// The version without reading the whole catalogue: it sits at the front of the file.
function headOf(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 120);
    const version = /"version":\s*(\d+)/.exec(head);
    const updated = /"updated":\s*"([^"]+)"/.exec(head);
    const schema = /"schema":\s*(\d+)/.exec(head);
    return version && updated ? { version: Number(version[1]), updated: updated[1], schema: schema ? Number(schema[1]) : 0 } : null;
  } catch { return null; }
}

class CatalogueRail {
  // opts: bundled (shipped file), kept (file to keep a newer copy in), apply(data), get(url) -> Promise<string>
  constructor(opts) {
    this.opts = opts;
    const shipped = headOf(opts.bundled);
    const held = headOf(opts.kept);
    const kept = held && held.schema === lock.SCHEMA ? held : null;   // a kept copy from before the lock is not used
    this.file = kept && (!shipped || kept.version > shipped.version) ? opts.kept : opts.bundled;
    this.current = (this.file === opts.kept ? kept : shipped) || { version: 0, updated: '' };
  }

  // entry: this dataset's line from the public repo's index.json.
  async check(baseUrl, entry) {
    if (!(entry.version > this.current.version)) return 'current';
    try {
      if (entry.file !== LOCKED_PATH) return 'failed';
      const text = await this.opts.get(`${baseUrl}${entry.file}`);
      if (sha256(text) !== entry.sha256) return 'failed';
      const data = JSON.parse(text);
      if (lockedProblem(data) || data.version !== entry.version) return 'failed';

      fs.mkdirSync(path.dirname(this.opts.kept), { recursive: true });
      fs.writeFileSync(`${this.opts.kept}.tmp`, text);
      fs.renameSync(`${this.opts.kept}.tmp`, this.opts.kept);
      this.file = this.opts.kept;
      this.current = { version: data.version, updated: data.updated };
      this.opts.apply(data);
      return 'updated';
    } catch { return 'failed'; }
  }
}

module.exports = { CatalogueRail, catalogueFiles, catalogueProblem, lockedProblem, headOf, INDEX_PATH, LOCKED_PATH, SCHEMA };
