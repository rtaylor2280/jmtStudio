// The font catalogue in a form that only opens for someone holding the fonts.
//
// Each distinct sound is a box, found by one fingerprint of that sound and opened by another. A box
// holds, for every font that has the sound, which font it is, how many sounds the font has, and one
// share of each of the font's two keys. The maker key needs as many shares as it takes to name the
// maker; the font key as many as it takes to name the font. With fewer, the key cannot be rebuilt.

'use strict';

const crypto = require('crypto');

const SCHEMA = 2;
const P = (1n << 127n) - 1n;            // a Mersenne prime; shares and secrets live below it
const SECRET_BITS = 126n;
const BYTES = 16;

const mod = a => ((a % P) + P) % P;
const toBig = buf => BigInt(`0x${buf.toString('hex') || '0'}`);
const toBuf = n => Buffer.from(n.toString(16).padStart(BYTES * 2, '0'), 'hex');

function powMod(base, exp) {
  let r = 1n; let b = mod(base); let e = exp;
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
}

const randomSecret = (random = crypto.randomBytes) => toBig(random(BYTES)) & ((1n << SECRET_BITS) - 1n);

// Shares 1..n of a secret; any k of them rebuild it.
function split(secret, k, n, random = crypto.randomBytes) {
  const coeffs = [secret];
  for (let i = 1; i < k; i++) coeffs.push(mod(toBig(random(BYTES))));
  const shares = [];
  for (let x = 1n; x <= BigInt(n); x++) {
    let y = 0n;
    for (let i = coeffs.length - 1; i >= 0; i--) y = mod(y * x + coeffs[i]);
    shares.push([Number(x), y]);
  }
  return shares;
}

// The secret from shares [x, y]; meaningless when there are fewer than were needed.
function combine(shares) {
  let secret = 0n;
  for (let i = 0; i < shares.length; i++) {
    const xi = BigInt(shares[i][0]);
    let num = 1n; let den = 1n;
    for (let j = 0; j < shares.length; j++) {
      if (j === i) continue;
      const xj = BigInt(shares[j][0]);
      num = (num * xj) % P;
      den = mod(den * (xj - xi));
    }
    secret = mod(secret + shares[i][1] * num % P * powMod(den, P - 2n));
  }
  return secret;
}

const sha = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(String(p), 'utf8')))).digest();
const keyOf = secret => sha('jmt-catalogue-key', toBuf(secret));
const boxIndex = (salt, hash) => sha(salt, 'i', String(hash).toLowerCase()).subarray(0, 12).toString('base64url');
const boxKey = (salt, hash) => sha(salt, 'k', String(hash).toLowerCase());

function seal(key, value, random = crypto.randomBytes) {
  let text = JSON.stringify(value);
  text += ' '.repeat((64 - (Buffer.byteLength(text) % 64)) % 64);   // lengths say little about the words
  const iv = random(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
}

// The value, or null when the key is not the one it was sealed with.
function open(key, sealed) {
  try {
    const buf = Buffer.from(sealed, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8'));
  } catch { return null; }
}

// The fewest sounds that reach a share, counted the way the catalogue counts them.
function needed(total, share, floor) {
  let m = 1;
  while (m < total && m / total < share) m++;
  return Math.max(floor, m);
}

// thresholds: { maker, font, floor } as shares of a font's sounds and the fewest sounds.
function lock(data, thresholds, random = crypto.randomBytes) {
  const salt = random(16);
  const fonts = [];
  const boxes = new Map();
  for (const creator of data.creators) {
    for (const font of creator.fonts) {
      const ref = fonts.length;
      const total = font.sounds.length;
      const makerSecret = randomSecret(random);
      const fontSecret = randomSecret(random);
      const makerShares = split(makerSecret, needed(total, thresholds.maker, thresholds.floor), total, random);
      const fontShares = split(fontSecret, needed(total, thresholds.font, thresholds.floor), total, random);
      fonts.push({
        m: seal(keyOf(makerSecret), { name: creator.name, website: creator.website || '' }, random),
        f: seal(keyOf(fontSecret), { name: font.name, demo: font.demo || '', store: font.store || '', tags: font.tags || [], free: !!font.free }, random),
      });
      font.sounds.forEach(([, hash], i) => {
        const h = String(hash).toLowerCase();
        if (!boxes.has(h)) boxes.set(h, []);
        boxes.get(h).push([ref, total, makerShares[i][0], toBuf(makerShares[i][1]).toString('base64'), toBuf(fontShares[i][1]).toString('base64')]);
      });
    }
  }
  const sealed = {};
  for (const h of [...boxes.keys()].sort((a, b) => boxIndex(salt, a).localeCompare(boxIndex(salt, b)))) {
    sealed[boxIndex(salt, h)] = seal(boxKey(salt, h), boxes.get(h), random);
  }
  return { schema: SCHEMA, version: data.version, updated: data.updated, salt: salt.toString('base64'), fonts, boxes: sealed };
}

const shareOf = b64 => toBig(Buffer.from(b64, 'base64'));

module.exports = { SCHEMA, lock, open, boxIndex, boxKey, keyOf, combine, split, shareOf, needed, randomSecret, P };
