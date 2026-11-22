/**
 * [B-701] The locked catalogue answers exactly as the plain one does, for every font at every count of
 * its sounds, and gives nothing away without them: no names, no fingerprints, no key from too few shares.
 *
 * Uses the real catalogue when local/fontCatalogue.plain.json is here, and a made-up one always.
 * Run: node test/catalogue-lock.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FontCatalogue, LOCK_THRESHOLDS, FILL_AT } = require('../fontCatalogue');
const lock = require('../catalogueLock');

let failures = 0;
const check = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

const hex = () => crypto.randomBytes(8).toString('hex');
function madeUp() {
  const shared = [hex(), hex(), hex()];              // a boot sound and friends many fonts carry
  const creators = [];
  for (let c = 0; c < 3; c++) {
    const fonts = [];
    for (let f = 0; f < 4; f++) {
      const n = 20 + c * 17 + f * 9;
      const sounds = Array.from({ length: n }, (_, i) => [`s/${i}.wav`, i < 3 ? shared[i] : hex()]);
      fonts.push({ id: `c${c}-f${f}`, name: `Font ${c}.${f}`, demo: 'https://example.com/d', store: 'https://example.com/s', tags: ['t'], free: f === 1, sha256: '0'.repeat(64), sounds });
    }
    creators.push({ id: `c${c}`, name: `Maker ${c}`, website: `https://maker${c}.example`, sha256: '0'.repeat(64), fonts });
  }
  // A small font sitting wholly inside a bigger one, as add-ins do.
  creators[0].fonts.push({ ...creators[0].fonts[3], id: 'c0-inner', name: 'Inner', sounds: creators[0].fonts[3].sounds.slice(5, 25) });
  return { schema: 1, version: 3, updated: '2026-11-19', creators };
}

function sameAnswers(label, data, everyCount = true) {
  const plain = new FontCatalogue(data);
  const lockedData = JSON.parse(JSON.stringify(lock.lock(data, LOCK_THRESHOLDS)));
  const locked = new FontCatalogue(lockedData);
  let compared = 0; let differ = null; let named = 0; let filled = 0;
  const fonts = data.creators.flatMap(c => c.fonts);
  for (const font of fonts) {
    const hashes = font.sounds.map(s => s[1]);
    // Every count, or the counts around each line the catalogue draws plus a spread between them.
    const n = hashes.length;
    const lines = [LOCK_THRESHOLDS.maker, LOCK_THRESHOLDS.font, FILL_AT].map(t => lock.needed(n, t, LOCK_THRESHOLDS.floor));
    const counts = everyCount ? Array.from({ length: n }, (_, i) => i + 1)
      : [...new Set([1, 2, 3, 4, n, ...lines.flatMap(k => [k - 1, k, k + 1]), ...Array.from({ length: n }, (_, i) => i + 1).filter(m => m % 9 === 0)])]
        .filter(m => m >= 1 && m <= n);
    for (const m of counts) {
      const take = hashes.slice(0, m);
      const a = plain.identify(take);
      const b = locked.identify(take);
      compared++;
      if (a && a.tier !== 'creator') named++;
      if (a && a.tier === 'fill') filled++;
      if (!differ && JSON.stringify(a) !== JSON.stringify(b)) differ = { font: font.id, m, plain: a, locked: b };
    }
  }
  // Two fonts' sounds mixed, as a card holding a curated copy might.
  for (let i = 0; i + 1 < fonts.length; i += 2) {
    const mix = [...fonts[i].sounds.slice(0, Math.ceil(fonts[i].sounds.length * 0.6)), ...fonts[i + 1].sounds.slice(0, 7)].map(s => s[1]);
    compared++;
    if (!differ && JSON.stringify(plain.identify(mix)) !== JSON.stringify(locked.identify(mix))) differ = { mix: [fonts[i].id, fonts[i + 1].id] };
  }
  check(`${label}: locked answers exactly as plain over ${compared} lookups (${named} named, ${filled} filled)`,
    !differ && named > 0 && filled > 0, JSON.stringify(differ).slice(0, 600));
  return { data, lockedData };
}

function givesNothingAway(label, data, lockedData) {
  const text = JSON.stringify(lockedData);
  const words = new Set();
  for (const c of data.creators) {
    words.add(c.name);
    for (const f of c.fonts) { words.add(f.name); if (f.store) words.add(f.store); for (const s of f.sounds) { words.add(s[1]); words.add(s[0]); } }
  }
  const seen = [...words].filter(w => w && w.length >= 6 && text.includes(w));
  check(`${label}: no name, link, path or fingerprint appears in the locked file`, seen.length === 0, seen.slice(0, 5).join(', '));

  // Precondition: the catalogue gives these fonts' details from their sounds, so a miss below means the lock.
  const font = data.creators[0].fonts[0];
  const locked = new FontCatalogue(lockedData);
  const all = locked.identify(font.sounds.map(s => s[1]));
  check(`${label}: precondition, all of a font's sounds name it`, !!(all && all.font && all.font.name === font.name));

  const total = font.sounds.length;
  const kFont = lock.needed(total, LOCK_THRESHOLDS.font, LOCK_THRESHOLDS.floor);
  const kMaker = lock.needed(total, LOCK_THRESHOLDS.maker, LOCK_THRESHOLDS.floor);
  const salt = Buffer.from(lockedData.salt, 'base64');
  const shares = [];
  for (const [, h] of font.sounds) {
    const box = lock.open(lock.boxKey(salt, h), lockedData.boxes[lock.boxIndex(salt, h)]);
    const mine = box && box.find(e => e[0] === 0);
    if (mine) shares.push(mine);
  }
  check(`${label}: every sound of the font opens its own box`, shares.length === total);
  const rebuild = (n, which) => lock.open(lock.keyOf(lock.combine(shares.slice(0, n).map(s => [s[2], lock.shareOf(s[which === 'm' ? 3 : 4])]))), lockedData.fonts[0][which]);
  check(`${label}: ${kFont} sounds open the font, ${kFont - 1} do not`, !!rebuild(kFont, 'f') && rebuild(kFont - 1, 'f') === null);
  check(`${label}: ${kMaker} sounds open the maker, ${kMaker - 1} do not`, !!rebuild(kMaker, 'm') && rebuild(kMaker - 1, 'm') === null);

  const [, h0] = font.sounds[0];
  const wrong = lock.open(lock.boxKey(salt, hex()), lockedData.boxes[lock.boxIndex(salt, h0)]);
  check(`${label}: a box does not open with another sound's key`, wrong === null);
  const again = lock.lock(data, LOCK_THRESHOLDS);
  check(`${label}: a fresh lock shares no box names with the last one`, !Object.keys(again.boxes).some(k => k in lockedData.boxes));
}

const m = sameAnswers('made-up catalogue', madeUp());
givesNothingAway('made-up catalogue', m.data, m.lockedData);

const realFile = path.join(__dirname, '..', 'local', 'fontCatalogue.plain.json');
let real = null;
try { real = JSON.parse(fs.readFileSync(realFile, 'utf8')); } catch {}
if (real && real.schema === 1) {
  const r = sameAnswers('real catalogue', real, false);
  givesNothingAway('real catalogue', r.data, r.lockedData);
  console.log(`      locked size ${(JSON.stringify(r.lockedData).length / 1e6).toFixed(2)} MB, plain ${(JSON.stringify(real).length / 1e6).toFixed(2)} MB`);
} else {
  console.log('SKIP  real catalogue: local/fontCatalogue.plain.json is not here');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
