// Destination sync manifest — what we last wrote to an export location, so a
// later export can tell "unchanged since we wrote it" from "needs reading".
//
// THE PROBLEM IT SOLVES. Deciding whether a copy on a card matches the library
// requires reading it, and the cost lands on the STEADY STATE: a card already in
// sync has everything present, so everything gets hashed. A 2.4 GB shared tracks
// folder is minutes of SD reading on every single export, to discover that
// nothing needs doing.
//
// WHY THIS IS SOUND, when the common-folder marker was not. That marker asserted
// CONTENT, and once a file changed nothing on disk contradicted it — so it could
// declare a stale card current. This records size + mtime, which the filesystem
// itself invalidates: edit a file and the OS moves its mtime. The claim stays
// falsifiable by two stat calls, which is the same cheap-negative shape used
// everywhere else here. The recorded hash is only ever trusted for a file whose
// size and mtime still match what we observed when we wrote it.
//
// THREE THINGS THAT WILL BITE, designed for:
//
//  1. FAT32 (which is what SD cards are) stores mtime at 2-second granularity,
//     in LOCAL time, with no timezone. So a comparison needs tolerance, and the
//     mtime we record must be the one OBSERVED AT THE DESTINATION AFTER WRITING,
//     never the source file's. A DST boundary shifts every timestamp on the card
//     by an hour; that fails the comparison, everything gets re-read once, and
//     the manifest is rewritten with fresh values. A once-a-year full verify is
//     the right trade against special-casing timezone arithmetic.
//
//  2. Some copy tools preserve mtime (rsync -t and friends). A same-size,
//     same-mtime, different-content replacement evades detection. Rare and
//     deliberate. Deleting this file forces a full verify.
//
//  3. A missing, unreadable, or version-mismatched manifest must fail toward
//     READING, never toward "assume unchanged". Same rule as everywhere else: an
//     unknown asks, it does not assume.
//
// The file is written at the destination root and is inert to ProffieOS (it
// scans for .wav; IdentifyExtension returns UNKNOWN for anything else).

const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = '.jmt-sync.json';
const MANIFEST_VERSION = 1;

// FAT32 timestamps land on 2-second boundaries, so a value can legitimately
// read back up to 2s from what we observed.
const MTIME_TOLERANCE_MS = 2000;

function manifestPath(destDir) {
  return path.join(destDir, MANIFEST_NAME);
}

// Canonical per-file records for `root`, in the exact shape soundFontFileHash
// folds into a digest: { relPath, size, fileHash }, sorted by path, with empty
// directories marked and the item-root meta.json excluded. `hashOne(abs)`
// supplies a hash for any file we cannot take from the cache.
//
// `cache` is a Map of relPath -> [size, mtimeMs, fileHash] from a previous run.
// A file whose size and mtime still match its cached entry reuses that hash and
// is never read. Everything else is hashed. THIS is the granularity that
// matters: adding or editing one file in a folder costs one hash, not the whole
// folder. (Ryan, 2026-07-31 — the first cut was all-or-nothing per item.)
//
// Returns { records, reused, hashed, live } or null when the tree cannot be
// walked, and null means the caller must not claim anything about it.
function resolveRecords(root, hashOne, cache, filter) {
  if (!root || !fs.existsSync(root)) return null;
  const records = [];
  const live = new Map();
  let reused = 0, hashed = 0;
  const walk = (absDir, relDir) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { throw new Error('unreadable'); }
    if (entries.length === 0 && relDir !== '') {
      records.push({ relPath: relDir, size: 0, fileHash: '<empty>' });
      return;
    }
    let saw = false;
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (rel === MANIFEST_NAME && relDir === '') continue;
      if (filter && !filter(rel)) continue;
      if (e.isDirectory()) { saw = true; walk(abs, rel); continue; }
      if (!e.isFile()) continue;
      if (relDir === '' && e.name === 'meta.json') continue;
      saw = true;
      let st;
      try { st = fs.statSync(abs); } catch { throw new Error('unreadable'); }
      const mtime = Math.round(st.mtimeMs);
      const cached = cache && cache.get(rel);
      let fileHash;
      if (cached && cached[0] === st.size && Math.abs((cached[1] || 0) - mtime) <= MTIME_TOLERANCE_MS) {
        fileHash = cached[2];
        reused++;
      } else {
        fileHash = hashOne(abs);
        hashed++;
      }
      records.push({ relPath: rel, size: st.size, fileHash });
      live.set(rel, [st.size, mtime, fileHash]);
    }
    if (relDir !== '' && !saw) records.push({ relPath: relDir, size: 0, fileHash: '<empty>' });
  };
  try { walk(root, ''); } catch { return null; }
  records.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return { records, reused, hashed, live };
}

function read(destDir) {
  if (!destDir) return null;
  try {
    const raw = fs.readFileSync(manifestPath(destDir), 'utf8');
    const m = JSON.parse(raw);
    if (!m || m.version !== MANIFEST_VERSION || !m.items) return null;
    return m;
  } catch { return null; }
}

function write(destDir, manifest) {
  if (!destDir || !manifest) return false;
  try {
    fs.writeFileSync(manifestPath(destDir), JSON.stringify(manifest));
    return true;
  } catch { return false; }
}

// The cached per-file table for an item, as a Map ready for resolveRecords.
// Empty Map when there is nothing recorded, which simply means everything gets
// hashed — an unknown reads, it never assumes.
function cacheFor(destDir, itemName) {
  const m = read(destDir);
  const rec = m && m.items && m.items[itemName];
  const out = new Map();
  if (!rec || !Array.isArray(rec.files)) return out;
  for (const f of rec.files) {
    if (!Array.isArray(f) || f.length < 4) continue;
    out.set(f[0], [f[1], f[2], f[3]]);
  }
  return out;
}

// Store the table we just observed. `live` is resolveRecords' live Map, whose
// mtimes are the DESTINATION's own — never the source's, or the first scan
// after a copy would re-read everything.
function recordItem(destDir, itemName, live) {
  if (!destDir || !itemName || !live) return false;
  const files = [];
  for (const [rel, [size, mtime, hash]] of live) files.push([rel, size, mtime, hash]);
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const m = read(destDir) || { version: MANIFEST_VERSION, items: {} };
  m.items[itemName] = { files };
  return write(destDir, m);
}

function forgetItem(destDir, itemName) {
  const m = read(destDir);
  if (!m || !m.items || !m.items[itemName]) return false;
  delete m.items[itemName];
  return write(destDir, m);
}

// Convenience used by every caller: resolve an item at the destination, reusing
// what the manifest can vouch for, then persist the refreshed table. Returns
// { hash, reused, hashed } or null when the tree could not be read.
function hashItemUsingManifest(destDir, itemName, hashOne, hashRecords, filter) {
  const root = path.join(destDir, itemName);
  const res = resolveRecords(root, hashOne, cacheFor(destDir, itemName), filter);
  if (!res) return null;
  try { recordItem(destDir, itemName, res.live); } catch {}
  return { hash: hashRecords(res.records), reused: res.reused, hashed: res.hashed };
}

module.exports = {
  MANIFEST_NAME,
  MANIFEST_VERSION,
  MTIME_TOLERANCE_MS,
  manifestPath,
  resolveRecords,
  cacheFor,
  read,
  write,
  recordItem,
  forgetItem,
  hashItemUsingManifest,
};
