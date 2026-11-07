// Brings fontCatalogueData.json up to the published catalogue before a build packs the app.
//
// The file is not in git, because the catalogue is published on purpose rather than by a commit, so a
// machine building from main has no copy or an old one. Built without it, an install knows no fonts
// until it can download them, and nothing says so. Every platform goes through here, so all of them
// ship the published catalogue, and a build that cannot get it stops.

'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { CatalogueRail, INDEX_PATH, headOf } = require('../catalogueRail');

const BASE_URL = 'https://raw.githubusercontent.com/rtaylor2280/jmt-studio-data/main/';
const ROOT = path.join(__dirname, '..');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'JMT-Studio-build' } }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`${res.statusCode} from ${url}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

async function ensureCatalogue({ root = ROOT, get = httpsGet, log = console.log } = {}) {
  const target = path.join(root, 'fontCatalogueData.json');
  const stop = why => new Error(`Font catalogue: ${why} The build was stopped so it does not ship without one.`);
  let entry;
  try { entry = JSON.parse(await get(`${BASE_URL}index.json`)).datasets['font-catalogue']; }
  catch (e) { throw stop(`could not read what is published (${e.message}).`); }
  if (!entry || entry.file !== INDEX_PATH) throw stop('the published index has no catalogue.');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-catalogue-'));
  try {
    const kept = path.join(temp, 'font-catalogue.json');
    const rail = new CatalogueRail({ bundled: target, kept, apply: () => {}, get });
    const result = await rail.check(BASE_URL, entry);
    if (result === 'failed') throw stop(`version ${entry.version} did not download whole.`);
    if (result === 'updated') fs.copyFileSync(kept, target);
    const have = headOf(target);
    if (!have || have.version < entry.version) throw stop(`this copy is not version ${entry.version}.`);
    log(`  • font catalogue version ${have.version}${have.version > entry.version ? ` (published is ${entry.version})` : ''}`);
    return have.version;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

exports.default = () => ensureCatalogue();
exports.ensureCatalogue = ensureCatalogue;
