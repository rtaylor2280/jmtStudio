// Destination sync manifest — the hash of every file we wrote to an export
// location, alongside the size and modified time it had there afterwards.
//
// THE SHAPE, and it is Ryan's (2026-07-31). Comparison is PER FILE, over only
// the files the library is about to write:
//
//   library hash (recorded at import, trusted)  vs  manifest hash (recorded here)
//
// Nothing else at the destination matters, including entries in this file for
// things we are not writing. mtime has exactly one job: to say whether the user
// invalidated an entry. It is not a content check and never stands in for one.
//
// SELF-HEALING, which is what makes it safe to be this simple. A file with no
// entry, or one whose size or mtime no longer match, is hashed — just that file
// — and its entry is refreshed. So a missing, partial, or stale manifest costs
// exactly the reads it is missing and nothing more. Delete this file and the
// next export rebuilds it as it goes.
//
// WHY IT IS PROPORTIONAL, which is the point: work inside JMT Studio and nothing
// is ever re-read, because every hash was recorded when the file was written.
// Work outside it and you pay for what you touched, not for the folder it lived
// in. A 2.4 GB tracks folder with one hand-edited wav costs one hash.
//
// WHY THIS IS NOT THE MARKER SHORTCUT REJECTED THE SAME MORNING. That marker
// asserted CONTENT, and once a file changed nothing on disk contradicted it, so
// it could call a stale card current. Size and mtime are observations the
// filesystem maintains: write a file and the clock moves. The claim stays
// falsifiable by a stat, and every unknown resolves toward reading.
//
// TWO THINGS THAT WILL BITE:
//
//  1. FAT32 (what SD cards are) keeps mtimes on 2-second boundaries, in local
//     time, with no zone. Hence the tolerance, and hence recording the mtime
//     OBSERVED AT THE DESTINATION AFTER WRITING rather than the source's. A
//     daylight saving change shifts every stamp on the card, which costs one
//     full re-read and a refreshed manifest — a better trade than doing timezone
//     arithmetic against a filesystem.
//
//  2. A tool that preserves mtime while replacing a file of identical length
//     (rsync -t and friends) goes unnoticed. Deliberate editing, Explorer
//     copies, and app writes all move it. Deleting this file forces a full
//     verify.
//
// Written at the destination root and inert to ProffieOS, which scans for .wav
// and gets UNKNOWN from IdentifyExtension for anything else.

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

function read(destDir) {
  if (!destDir) return null;
  try {
    const raw = fs.readFileSync(manifestPath(destDir), 'utf8');
    const m = JSON.parse(raw);
    if (!m || m.version !== MANIFEST_VERSION || !m.items) return null;
    return m;
  } catch { return null; }
}

// Write to a temp file, then rename over the real one. writeFileSync truncates
// first, so a plain write leaves a window where the manifest is empty or
// partial — and because we write at EVERY item by design, so the card is always
// left with a manifest matching what is on it, there are many such windows per
// export. The realistic interrupter is someone pulling the card. A truncated
// manifest defeats exactly the property the per-item write exists to provide.
//
// HONEST LIMIT: rename is atomic on journaled filesystems. FAT32, which is what
// SD cards are, has no journal, so a power loss during the directory-entry
// update can still corrupt. This narrows the window from the whole file write
// to one metadata update. A large improvement, not a guarantee — and a corrupt
// manifest still self-heals into a full re-read, so the worst case is slow
// rather than wrong.
function write(destDir, manifest) {
  if (!destDir || !manifest) return false;
  const finalPath = manifestPath(destDir);
  const tmpPath = finalPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(manifest));
    fs.renameSync(tmpPath, finalPath);
    return true;
  } catch {
    // A kill between the write and the rename leaves the temp behind. Clear it
    // on the way out so it cannot accumulate on the card.
    try { fs.unlinkSync(tmpPath); } catch {}
    return false;
  }
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

// Merge observed entries over what is already recorded. Entries for files we
// did not look at this time survive untouched: a comparison only ever consults
// the files the library is writing, so it has no business discarding knowledge
// about anything else. `observed` is a Map of relPath -> [size, mtimeMs, hash].
function mergeItem(destDir, itemName, observed) {
  if (!destDir || !itemName || !observed || observed.size === 0) return false;
  const m = read(destDir) || { version: MANIFEST_VERSION, items: {} };
  const existing = new Map();
  const rec = m.items[itemName];
  if (rec && Array.isArray(rec.files)) {
    for (const f of rec.files) {
      if (Array.isArray(f) && f.length >= 4) existing.set(f[0], [f[1], f[2], f[3]]);
    }
  }
  for (const [rel, v] of observed) existing.set(rel, v);
  const files = [];
  for (const [rel, [size, mtime, hash]] of existing) files.push([rel, size, mtime, hash]);
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  m.items[itemName] = { files };
  return write(destDir, m);
}

function forgetItem(destDir, itemName) {
  const m = read(destDir);
  if (!m || !m.items || !m.items[itemName]) return false;
  delete m.items[itemName];
  return write(destDir, m);
}

module.exports = {
  MANIFEST_NAME,
  MANIFEST_VERSION,
  MTIME_TOLERANCE_MS,
  manifestPath,
  cacheFor,
  read,
  write,
  mergeItem,
  forgetItem,
};
