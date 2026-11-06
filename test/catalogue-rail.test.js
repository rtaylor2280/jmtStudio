/**
 * The catalogue fetches only what changed, and changes nothing unless the whole result is good.
 *
 * Run: node test/catalogue-rail.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CatalogueRail, catalogueFiles, catalogueProblem, headOf, INDEX_PATH } = require('../catalogueRail');
const { DataRail } = require('../dataRail');
const compileErrorData = require('../compileErrorData');

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

const hash = n => n.toString(16).padStart(16, '0');
const font = (id, n) => ({ id, name: id, demo: 'https://youtu.be/x', store: `https://shop.test/${id}`,
  sounds: [[`hum.wav`, hash(n)], [`clsh01.wav`, hash(n + 1)], [`swng01.wav`, hash(n + 2)]] });
const catalogue = (version, creators) => catalogueFiles({ schema: 1, version, updated: `2030-01-0${version}`, creators });
const base = () => [
  { id: 'kyber', name: 'Kyberphonic', website: 'https://kyber.test/', fonts: [font('kyber--a', 10), font('kyber--b', 20)] },
  { id: 'other', name: 'Other', website: '', fonts: [font('other--c', 30)] },
];

const BASE = 'https://data.test/';
function rig(shipped, published, over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-rail-'));
  const bundled = path.join(dir, 'shipped.json');
  if (shipped) fs.writeFileSync(bundled, `${JSON.stringify(shipped.data)}\n`);
  const fetched = [];
  const applied = [];
  const rail = new CatalogueRail({
    bundled, kept: path.join(dir, 'kept', 'font-catalogue.json'), apply: d => applied.push(d),
    get: async (url) => {
      const file = url.slice(BASE.length);
      fetched.push(file);
      if (over[file] !== undefined) return over[file];
      if (!published.files.has(file)) throw new Error('offline');
      return published.files.get(file);
    },
  });
  const entry = { file: INDEX_PATH, version: published.data.version, sha256: published.indexSha };
  return { rail, entry, fetched, applied, dir };
}

(async () => {
  console.log('1. the published files');
  const one = catalogue(1, base());
  ok('one index, one file per creator, one per font', one.files.size === 6, String(one.files.size));
  ok('the snapshot carries every checksum', catalogueProblem(one.data) === null, catalogueProblem(one.data));
  ok('the same data gives the same files', catalogue(1, base()).indexSha === one.indexSha);

  console.log('2. only what changed');
  const added = base();
  added[0].fonts.push(font('kyber--new', 40));
  const two = catalogue(2, added);
  let r = rig(one, two);
  ok('one new font: updated', await r.rail.check(BASE, r.entry) === 'updated');
  ok('fetches the index, that creator and that font, nothing else',
    r.fetched.join() === `${INDEX_PATH},fonts/creators/kyber.json,fonts/sounds/kyber--new.json`, r.fetched.join());
  ok('all four fonts arrive', r.applied[0].creators.flatMap(c => c.fonts).length === 4);
  ok('and it is kept', headOf(path.join(r.dir, 'kept', 'font-catalogue.json')).version === 2);
  ok('a font not fetched keeps its sounds', r.applied[0].creators[1].fonts[0].sounds.length === 3);

  const again = new CatalogueRail({ bundled: path.join(r.dir, 'shipped.json'), kept: path.join(r.dir, 'kept', 'font-catalogue.json'),
    apply: () => {}, get: async () => { throw new Error('none'); } });
  ok('a restart starts from the kept copy', again.current.version === 2 && /kept/.test(again.file));

  console.log('3. nothing to do');
  r = rig(one, one);
  ok('same version: current, with no fetch', await r.rail.check(BASE, r.entry) === 'current' && !r.fetched.length);
  r = rig(null, one);
  ok('no shipped file: starts at nothing and fetches it all', r.rail.current.version === 0
    && await r.rail.check(BASE, r.entry) === 'updated' && r.fetched.length === 6, r.fetched.join());

  console.log('4. it never makes anything worse');
  for (const [name, file, text] of [
    ['a changed font file', 'fonts/sounds/kyber--new.json', '{"id":"kyber--new","sounds":[]}\n'],
    ['a changed creator file', 'fonts/creators/kyber.json', '{}\n'],
    ['a changed index', INDEX_PATH, '{}\n'],
  ]) {
    r = rig(one, two, { [file]: text });
    ok(`${name}: failed, nothing applied, nothing kept`, await r.rail.check(BASE, r.entry) === 'failed'
      && !r.applied.length && r.rail.current.version === 1 && !fs.existsSync(path.join(r.dir, 'kept', 'font-catalogue.json')));
  }
  const gone = rig(one, two);
  gone.rail.opts.get = async () => { throw new Error('offline'); };
  ok('offline: failed, still on the shipped copy', await gone.rail.check(BASE, gone.entry) === 'failed' && gone.rail.current.version === 1);

  const bad = (edit) => { const d = JSON.parse(JSON.stringify(one.data)); edit(d); return catalogueProblem(d); };
  ok('a link that is not a web address is refused', bad((d) => { d.creators[0].fonts[0].store = 'file:///c:/x'; }) !== null);
  ok('a sound without a real hash is refused', bad((d) => { d.creators[0].fonts[0].sounds[0][1] = 'zz'; }) !== null);
  ok('a font id that could climb out of its folder is refused', bad((d) => { d.creators[0].fonts[0].id = '../../x'; }) !== null);
  ok('the same font twice is refused', bad((d) => { d.creators[1].fonts[0].id = 'kyber--a'; }) !== null);

  console.log('5. through the rail, one number for both');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rail-both-'));
  const bundledFile = path.join(dir, 'shipped.json');
  fs.writeFileSync(bundledFile, `${JSON.stringify(one.data)}\n`);
  const repo = new Map(two.files);
  repo.set('index.json', JSON.stringify({ schema: 1, datasets: {
    'error-messages': { file: 'error-messages.json', version: compileErrorData.version, sha256: 'x' },
    'font-catalogue': { file: INDEX_PATH, version: 2, updated: '2030-01-02', sha256: two.indexSha, minAppVersion: '1.8.0' },
  } }));
  const get = async (url) => {
    const file = url.split('/main/')[1];
    if (!repo.has(file)) throw new Error('offline');
    return repo.get(file);
  };
  let got = null;
  const catalogueRail = new CatalogueRail({ bundled: bundledFile, kept: path.join(dir, 'kept.json'), apply: (d) => { got = d; }, get });
  const rail = new DataRail({ userData: dir, appVersion: '1.8.0', bundled: compileErrorData, apply: () => {}, get, catalogue: catalogueRail,
    isAtLeast: (have, want) => have.localeCompare(want, undefined, { numeric: true }) >= 0 });
  ok('before: the two versions added', rail.status().version === compileErrorData.version + 1, String(rail.status().version));
  ok('a newer catalogue updates through the same check', await rail.check() === 'updated' && !!got);
  ok('after: the number went up, so About shows it', rail.status().version === compileErrorData.version + 2, String(rail.status().version));
  ok('and shows the later date', rail.status().updated === '2030-01-02', rail.status().updated);

  const held = new CatalogueRail({ bundled: bundledFile, kept: path.join(dir, 'other.json'), apply: () => {}, get });
  const old = new DataRail({ userData: dir, appVersion: '1.7.9', bundled: compileErrorData, apply: () => {}, get, catalogue: held,
    isAtLeast: (have, want) => have.localeCompare(want, undefined, { numeric: true }) >= 0 });
  ok('an app older than the catalogue asks for keeps what it has', await old.check() === 'current' && held.current.version === 1);

  console.log(failed ? `\n${failed} FAILURE(S)` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
