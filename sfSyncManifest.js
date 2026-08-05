// Destination sync manifest — the hash of every file we wrote to an export
// location, alongside the size and modified time it had there afterwards.
//
// THE SHAPE, and it is settled (2026-07-31). Comparison is PER FILE, over only
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

// Spelled out, not abbreviated, and no leading dot. A dot does not hide a
// file on Windows - it only hid the extension in Explorer, which is exactly
// how it went unrecognised. Someone who finds this on their card should be
// able to read the name and then read the file. (Renamed 2026-08-01.)
const MANIFEST_NAME = 'jmt-studio-manifest.json';
const MANIFEST_NOTE = 'Written by JMT Studio. Records what was last exported to this destination so a repeat export can skip files that have not changed. Safe to delete: the next export simply re-reads everything.';
const MANIFEST_VERSION = 1;

// FAT32 timestamps land on 2-second boundaries, so a value can legitimately
// read back up to 2s from what we observed.
const MTIME_TOLERANCE_MS = 2000;

function manifestPath(destDir) {
  return path.join(destDir, MANIFEST_NAME);
}

// Reading has FOUR outcomes, and collapsing them into one null is what caused
// the damage described below. Callers that only READ can keep using read();
// anything that WRITES has to know the difference.
//
//   absent       — nothing is here. Starting fresh is correct.
//   ok           — parsed and usable.
//   incompatible — a format version this build cannot use. The records are
//                  unusable by definition, so replacing them is right.
//   unreadable   — a manifest IS here and we could not read or parse it.
//
// That last one is the dangerous case. A truncated read over a slow link, an
// I/O error, a half-written file: the old code called every one of those
// "absent", rebuilt from an empty object and wrote. Seen 2026-08-01 while
// exporting through a board mounted as mass storage — a 507 KB manifest
// covering 61 fonts became a 14 KB file covering 3, and every export after it
// had to re-hash a card it had already recorded. The cache that makes an
// export cheap was eaten by the export that needed it.
//
// Same distinction as everywhere else in this file: an unknown resolves toward
// reading, never toward assuming. "I could not read it" is not "it is not
// there", and only one of those two justifies a write.
function readState(destDir) {
  if (!destDir) return { manifest: null, state: 'absent' };
  let raw;
  try {
    raw = fs.readFileSync(manifestPath(destDir), 'utf8');
  } catch (err) {
    // ENOENT is a real answer: there is no manifest. Every other errno means
    // one may well be sitting there that we simply could not get at.
    return { manifest: null, state: (err && err.code === 'ENOENT') ? 'absent' : 'unreadable' };
  }
  let m = null;
  try { m = JSON.parse(raw); } catch { return { manifest: null, state: 'unreadable' }; }
  if (!m || typeof m !== 'object') return { manifest: null, state: 'unreadable' };
  if (m.version !== MANIFEST_VERSION) return { manifest: null, state: 'incompatible' };
  // Right version, no items: malformed rather than obsolete. Refuse to write
  // over it. The escape hatch is the one already documented at the top — delete
  // the file and the next export rebuilds it as it goes.
  if (!m.items) return { manifest: null, state: 'unreadable' };
  return { manifest: m, state: 'ok' };
}

function read(destDir) {
  return readState(destDir).manifest;
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
    // JSON cannot carry a comment, so the explanation is the first key. Same
    // idea as the card marker: whoever finds this should learn what wrote it
    // and that removing it costs them nothing, without having to ask.
    const withNote = Object.assign({ _note: MANIFEST_NOTE }, manifest);
    fs.writeFileSync(tmpPath, JSON.stringify(withNote));
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
  const { manifest, state } = readState(destDir);
  // Refuse rather than clobber. Not writing costs one item's worth of re-reads
  // next time; writing over a manifest we failed to read costs every OTHER
  // item's records, silently, and there is nothing left to notice it from.
  if (state === 'unreadable') return false;
  const m = manifest || { version: MANIFEST_VERSION, items: {} };
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
  readState,
  write,
  mergeItem,
  forgetItem,
};
