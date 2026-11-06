// Keeps the font catalogue current from the jmt-studio-data repo.
//
// A top index names each creator with a checksum, a creator's file names its fonts with a checksum
// each, and a font's file holds its sounds. Only what changed is fetched, so one new font costs one
// creator file and one font file. The whole catalogue is put together and checked before anything
// changes, and the result is kept as one file in the shape the app ships with.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

// The version without reading the whole catalogue: it sits at the front of the file.
function headOf(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 120);
    const version = /"version":\s*(\d+)/.exec(head);
    const updated = /"updated":\s*"([^"]+)"/.exec(head);
    return version && updated ? { version: Number(version[1]), updated: updated[1] } : null;
  } catch { return null; }
}

class CatalogueRail {
  // opts: bundled (shipped file), kept (file to keep a newer copy in), apply(data), get(url) -> Promise<string>
  constructor(opts) {
    this.opts = opts;
    const shipped = headOf(opts.bundled);
    const kept = headOf(opts.kept);
    this.file = kept && (!shipped || kept.version > shipped.version) ? opts.kept : opts.bundled;
    this.current = (this.file === opts.kept ? kept : shipped) || { version: 0, updated: '' };
  }

  async _fetch(baseUrl, file, sum) {
    const text = await this.opts.get(`${baseUrl}${file}`);
    if (sha256(text) !== sum) throw new Error('checksum');
    return JSON.parse(text);
  }

  // entry: this dataset's line from the repo's index.json.
  async check(baseUrl, entry) {
    if (!(entry.version > this.current.version)) return 'current';
    try {
      const index = await this._fetch(baseUrl, entry.file, entry.sha256);
      if (!index || index.schema !== SCHEMA || index.version !== entry.version || !Array.isArray(index.creators)) return 'failed';

      let have = {};
      try { have = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
      const creators = new Map((have.creators || []).map(c => [c.id, c]));
      const fonts = new Map((have.creators || []).flatMap(c => c.fonts).map(f => [f.id, f]));

      const data = { schema: SCHEMA, version: index.version, updated: index.updated, creators: [] };
      for (const { id, sha256: sum } of index.creators) {
        if (!ID.test(id)) return 'failed';
        const held = creators.get(id);
        if (held && held.sha256 === sum) { data.creators.push(held); continue; }
        const creator = await this._fetch(baseUrl, creatorPath(id), sum);
        const list = [];
        for (const font of creator.fonts) {
          if (!ID.test(font.id)) return 'failed';
          const old = fonts.get(font.id);
          const sounds = old && old.sha256 === font.sha256 ? old.sounds
            : (await this._fetch(baseUrl, fontPath(font.id), font.sha256)).sounds;
          list.push({ ...font, sounds });
        }
        data.creators.push({ ...creator, fonts: list, sha256: sum });
      }
      if (catalogueProblem(data)) return 'failed';

      fs.mkdirSync(path.dirname(this.opts.kept), { recursive: true });
      fs.writeFileSync(`${this.opts.kept}.tmp`, toText(data));
      fs.renameSync(`${this.opts.kept}.tmp`, this.opts.kept);
      this.file = this.opts.kept;
      this.current = { version: data.version, updated: data.updated };
      this.opts.apply(data);
      return 'updated';
    } catch { return 'failed'; }
  }
}

module.exports = { CatalogueRail, catalogueFiles, catalogueProblem, headOf, INDEX_PATH, SCHEMA };
