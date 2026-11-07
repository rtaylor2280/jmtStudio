'use strict';
// A build gets the published catalogue, or it stops. Runs build/fetch-catalogue.js against a small
// repo held in memory.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureCatalogue } = require('../build/fetch-catalogue');
const { catalogueFiles } = require('../catalogueRail');

let failed = 0;
const ok = (name, pass, got) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  <- ${got}`}`);
  if (!pass) failed++;
};
const BASE = 'https://raw.githubusercontent.com/rtaylor2280/jmt-studio-data/main/';

const font = { id: 'c--f', name: 'F', demo: 'https://x.test/d', store: 'https://x.test/s', sounds: [['hum.wav', 'a'.repeat(16)], ['clsh.wav', 'b'.repeat(16)]] };
const data = version => ({ schema: 1, version, updated: '2026-11-07', creators: [{ id: 'c', name: 'C', website: 'https://x.test', fonts: [font] }] });
const repo = (version) => {
  const { files, indexSha } = catalogueFiles(data(version));
  const pages = new Map();
  for (const [p, t] of files) pages.set(BASE + p, t);
  pages.set(`${BASE}index.json`, JSON.stringify({ schema: 1, datasets: { 'font-catalogue': { file: 'fonts/index.json', version, updated: '2026-11-07', sha256: indexSha } } }));
  return async url => { if (!pages.has(url)) throw new Error(`404 ${url}`); return pages.get(url); };
};
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-fetch-test-'));
const log = () => {};
const rejects = async (fn, re) => { try { await fn(); return false; } catch (e) { return re.test(e.message); } };

(async () => {
  let r = root();
  const v = await ensureCatalogue({ root: r, get: repo(6), log });
  const got = JSON.parse(fs.readFileSync(path.join(r, 'fontCatalogueData.json'), 'utf8'));
  ok('a machine with no copy gets the published one', v === 6 && got.creators[0].fonts[0].name === 'F', v);
  ok('sounds come with it', got.creators[0].fonts[0].sounds?.length === 2, JSON.stringify(got.creators[0].fonts[0]).slice(0, 90));

  await ensureCatalogue({ root: r, get: repo(7), log });
  ok('an old copy is brought up to date', JSON.parse(fs.readFileSync(path.join(r, 'fontCatalogueData.json'), 'utf8')).version === 7);

  const before = fs.readFileSync(path.join(r, 'fontCatalogueData.json'), 'utf8');
  await ensureCatalogue({ root: r, get: repo(7), log });
  ok('a current copy is left alone', fs.readFileSync(path.join(r, 'fontCatalogueData.json'), 'utf8') === before);

  ok('no network stops the build', await rejects(() => ensureCatalogue({ root: root(), get: async () => { throw new Error('offline'); }, log }), /stopped/));

  const broken = repo(6);
  ok('a download that does not finish stops the build', await rejects(() => ensureCatalogue({ root: root(), log,
    get: async url => { if (/creators|fonts\/[a-z]/.test(url.replace(`${BASE}fonts/index.json`, ''))) throw new Error('404'); return broken(url); } }), /stopped/));

  ok('an index without a catalogue stops the build', await rejects(() => ensureCatalogue({ root: root(), log,
    get: async () => JSON.stringify({ datasets: {} }) }), /stopped/));

  ok('the build runs this step', /"beforePack": "build\/fetch-catalogue\.js"/.test(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')));

  console.log(failed ? `\n${failed} failure(s)` : '\nall build catalogue tests passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
