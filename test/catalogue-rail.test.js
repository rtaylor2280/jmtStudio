/**
 * The plain catalogue splits into its private files; the app's locked copy arrives whole and changes
 * nothing unless the whole file is good.
 *
 * Run: node test/catalogue-rail.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { CatalogueRail, catalogueFiles, catalogueProblem, lockedProblem, headOf, LOCKED_PATH } = require('../catalogueRail');
const { LOCK_THRESHOLDS } = require('../fontCatalogue');
const lock = require('../catalogueLock');
const { DataRail, RELEASE_BASE } = require('../dataRail');
const { lockedSample } = require('./plain-error-data');
const { unlock: unlockErrors } = require('../errorDataLock');
const errorsShipped = lockedSample(4, '2026-11-18');
const compileErrorData = errorsShipped.locked;
const unlockShipped = async locked => unlockErrors(locked, errorsShipped.key);

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
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const locked = (version, creators) => {
  const text = `${JSON.stringify(lock.lock({ schema: 1, version, updated: `2030-01-0${version}`, creators }, LOCK_THRESHOLDS))}\n`;
  return { text, data: JSON.parse(text), entry: { file: LOCKED_PATH, version, sha256: sha(text) } };
};
function rig(shipped, published, over) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-rail-'));
  const bundled = path.join(dir, 'shipped.json');
  if (shipped) fs.writeFileSync(bundled, shipped.text);
  const fetched = [];
  const applied = [];
  const rail = new CatalogueRail({
    bundled, kept: path.join(dir, 'kept', 'font-catalogue.json'), apply: d => applied.push(d),
    get: async (url) => {
      fetched.push(url.slice(BASE.length));
      if (over !== undefined) return over;
      if (url !== BASE + LOCKED_PATH) throw new Error('offline');
      return published.text;
    },
  });
  return { rail, entry: published.entry, fetched, applied, dir };
}

(async () => {
  console.log('1. the private files');
  const one = catalogue(1, base());
  ok('one index, one file per creator, one per font', one.files.size === 6, String(one.files.size));
  ok('the snapshot carries every checksum', catalogueProblem(one.data) === null, catalogueProblem(one.data));
  ok('the same data gives the same files', catalogue(1, base()).indexSha === one.indexSha);

  console.log('2. a newer locked catalogue');
  const l1 = locked(1, base());
  const added = base();
  added[0].fonts.push(font('kyber--new', 40));
  const l2 = locked(2, added);
  ok('the locked file has the shape the rail accepts', lockedProblem(l2.data) === null, lockedProblem(l2.data));
  let r = rig(l1, l2);
  ok('newer: updated', await r.rail.check(BASE, r.entry) === 'updated');
  ok('one file fetched, whole', r.fetched.join() === LOCKED_PATH, r.fetched.join());
  ok('what arrives is the locked file', r.applied[0] && r.applied[0].schema === lock.SCHEMA && r.applied[0].version === 2);
  ok('and it is kept', headOf(path.join(r.dir, 'kept', 'font-catalogue.json')).version === 2);
  const again = new CatalogueRail({ bundled: path.join(r.dir, 'shipped.json'), kept: path.join(r.dir, 'kept', 'font-catalogue.json'),
    apply: () => {}, get: async () => { throw new Error('none'); } });
  ok('a restart starts from the kept copy', again.current.version === 2 && /kept/.test(again.file));

  console.log('3. nothing to do');
  r = rig(l1, l1);
  ok('same version: current, with no fetch', await r.rail.check(BASE, r.entry) === 'current' && !r.fetched.length);
  r = rig(null, l1);
  ok('no shipped file: starts at nothing and fetches it', r.rail.current.version === 0 && await r.rail.check(BASE, r.entry) === 'updated');

  console.log('4. it never makes anything worse');
  const plainText = `${JSON.stringify(catalogue(2, added).data)}\n`;
  for (const [name, text, entry] of [
    ['a file that does not match its checksum', l2.text.replace('"version":2', '"version":2 '), l2.entry],
    ['the plain catalogue in its place', plainText, { ...l2.entry, sha256: sha(plainText) }],
    ['a version other than the index says', l2.text, { ...l2.entry, version: 3 }],
    ['a box that is not a box', l2.text.replace(/"boxes":\{"[^"]+"/, '"boxes":{"../../x"'), null],
  ]) {
    const e = entry || { ...l2.entry, sha256: sha(text) };
    r = rig(l1, { text, entry: e }, text);
    ok(`${name}: failed, nothing applied, nothing kept`, await r.rail.check(BASE, e) === 'failed'
      && !r.applied.length && r.rail.current.version === 1 && !fs.existsSync(path.join(r.dir, 'kept', 'font-catalogue.json')));
  }
  const gone = rig(l1, l2);
  gone.rail.opts.get = async () => { throw new Error('offline'); };
  ok('offline: failed, still on the shipped copy', await gone.rail.check(BASE, gone.entry) === 'failed' && gone.rail.current.version === 1);
  const prior = rig(l1, l2);
  fs.mkdirSync(path.join(prior.dir, 'kept'), { recursive: true });
  fs.writeFileSync(path.join(prior.dir, 'kept', 'font-catalogue.json'), `${JSON.stringify({ ...catalogue(9, base()).data })}\n`);
  const fresh = new CatalogueRail({ bundled: path.join(prior.dir, 'shipped.json'), kept: path.join(prior.dir, 'kept', 'font-catalogue.json'), apply: () => {}, get: async () => '' });
  ok('a plain copy kept from before the lock is not used, whatever its version', fresh.current.version === 1 && /shipped/.test(fresh.file));

  const bad = (edit) => { const d = JSON.parse(JSON.stringify(one.data)); edit(d); return catalogueProblem(d); };
  ok('a link that is not a web address is refused', bad((d) => { d.creators[0].fonts[0].store = 'file:///c:/x'; }) !== null);
  ok('a sound without a real hash is refused', bad((d) => { d.creators[0].fonts[0].sounds[0][1] = 'zz'; }) !== null);
  ok('a font id that could climb out of its folder is refused', bad((d) => { d.creators[0].fonts[0].id = '../../x'; }) !== null);
  ok('the same font twice is refused', bad((d) => { d.creators[1].fonts[0].id = 'kyber--a'; }) !== null);

  console.log('5. through the rail, one number for both');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rail-both-'));
  const bundledFile = path.join(dir, 'shipped.json');
  // Versions at the base, so the number is 1.0 before and 1.1 after (no clamping at zero).
  const c1 = RELEASE_BASE - compileErrorData.version;
  const s1 = locked(c1, base());
  const s2 = locked(c1 + 1, added);
  fs.writeFileSync(bundledFile, s1.text);
  const repo = new Map([[LOCKED_PATH, s2.text]]);
  repo.set('index.json', JSON.stringify({ schema: 1, datasets: {
    'error-messages': { file: 'error-messages.json', version: compileErrorData.version, sha256: 'x' },
    'font-catalogue': { ...s2.entry, updated: s2.data.updated, minAppVersion: '1.8.0' },
  } }));
  const get = async (url) => {
    const file = url.split('/main/')[1];
    if (!repo.has(file)) throw new Error('offline');
    return repo.get(file);
  };
  let got = null;
  const catalogueRail = new CatalogueRail({ bundled: bundledFile, kept: path.join(dir, 'kept.json'), apply: (d) => { got = d; }, get });
  const rail = new DataRail({ userData: dir, appVersion: '1.8.0', bundled: compileErrorData, unlock: unlockShipped, apply: () => {}, get, catalogue: catalogueRail,
    isAtLeast: (have, want) => have.localeCompare(want, undefined, { numeric: true }) >= 0 });
  ok('before: the two versions added, less the base, is 1.0', rail.status().version === '1.0', String(rail.status().version));
  ok('a newer catalogue updates through the same check', await rail.check() === 'updated' && !!got);
  ok('after: the catalogue counts in the number, 1.1', rail.status().version === '1.1', String(rail.status().version));
  ok('and shows the later date', rail.status().updated === s2.data.updated, rail.status().updated);

  const held = new CatalogueRail({ bundled: bundledFile, kept: path.join(dir, 'other.json'), apply: () => {}, get });
  const old = new DataRail({ userData: dir, appVersion: '1.7.9', bundled: compileErrorData, unlock: unlockShipped, apply: () => {}, get, catalogue: held,
    isAtLeast: (have, want) => have.localeCompare(want, undefined, { numeric: true }) >= 0 });
  ok('an app older than the catalogue asks for keeps what it has', await old.check() === 'current' && held.current.version === c1);

  console.log(failed ? `\n${failed} FAILURE(S)` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
