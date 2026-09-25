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
// ── The manifest is BORROWED, not re-fetched per item ──────────── [B-173 point 1, 2026-09-24]
//
// ⭐⭐ MEASURED BEFORE BUILDING, as the entry demands: a 25-font compare parsed the destination
// manifest TWENTY-FIVE TIMES - `cacheFor` is called once per font and each call read and parsed
// the whole file. On a real card that is a 505 KB file re-read over USB per font, ~12.3 MB for one
// scan, to answer questions about a document that cannot have changed.
//
// ⭐⭐ WHY A MEMO IS SAFE HERE, AND WHY IT IS VALIDATED RATHER THAN TIMED. [B-402] already made the
// write a SINGLE commit at the end of an operation, so the manifest on disk does not change while
// a compare runs. That makes borrowing correct - but "correct because of something another entry
// did" is exactly the kind of reasoning that rots when the other thing changes.
//
// ⚠️ SO THE MEMO IS NOT TRUSTED ON A LIFETIME. It carries the file's size and mtime and re-stats
// before every use: one stat instead of a full read and parse, and it self-invalidates the moment
// anything writes the file - including another process, which no borrow/release protocol of ours
// could have noticed. A stale manifest would make a compare report "unchanged" for a file that
// changed, and silently skip it on the export. That is a wrong answer about the user's card, not
// a slow one, so it is not a risk worth taking to save a stat.
//
// ⚠️ Keyed by the manifest PATH, so two destinations in one session cannot read each other's.
let _memo = null;   // { path, size, mtimeMs, result }

function _statQuiet(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// ── Counters, printed once per compare ───────────────────────────────
//
// Borrowing the manifest is invisible from the app: reading it once and reading it per item
// return the same answer and draw the same screen, and differ only in time over a slow
// transport. These totals make the difference watchable in the terminal `npm start` runs in.
// `parses` holding at 1 while `reuses` climbs is the whole assertion.
//
// The per-item compare is one IPC call each (the loop is in the renderer), so there is no
// operation boundary here to summarise at - hence running totals rather than a final line.
//
// ⚠️ No flag to arm, unlike the stall probe: an instrument you have to switch on is one you
// find switched off on the day it matters. Cost is one line per compare.
// ⚠️ ASCII only in the output. An em dash reaches a Windows terminal as mojibake.
//
// ⚠️ `state` is on the line because a fresh card otherwise looks identical to a broken borrow:
// `absent` is never memoised (no stat to validate against), so every item re-attempts the read
// and every line reads `parses=1 reuses=0` - the same shape as a memo that has stopped working.
let _counts = { path: null, state: 'none', parses: 0, reuses: 0, stats: 0, hashes: 0 };

// A fresh parse starts a new borrow, so the totals reset with it: `parses=1` then means "picked
// up once and held", and anything above 1 means the borrow broke.
//
// ⚠️ Monotonic, and separate from the totals on purpose. Deciding whether a compare consulted
// the manifest by asking whether the totals CHANGED is wrong in the case that matters: on a card
// with no manifest every read lands on the same values, so identical numbers mean the opposite
// of nothing happening. This only ever goes up.
let _touches = 0;

function _countParse(mPath, state) {
  _touches++;
  _counts = { path: mPath, state: state || 'none', parses: 1, reuses: 0, stats: 0, hashes: 0 };
}
function _countReuse() { _touches++; _counts.reuses++; }

// Bumped by the three compare loops beside their per-file statSync. Kept here rather than in a
// new module because all three already require this one, so it costs no new wiring.
function countStat(n) { _counts.stats += (n || 1); }

// Hashes read off the DESTINATION, and the number that says whether the manifest is being
// believed. Without it, two runs of identical measured work can differ by a factor of ten with
// nothing on the line to explain it.
//
// ⚠️ Read it as a discriminator, not as more data. `hashes=0` means every recorded hash was
// trusted, so any time spent went somewhere outside the compare. `hashes>0` on a card that was
// just exported to means entries are being REJECTED and the card re-read, which is a validation
// defect rather than a slow disk. The two call for opposite work.
function countHash(n) { _counts.hashes += (n || 1); }
function counts() { return Object.assign({}, _counts); }

// ⚠️ A plain-words tail rather than a bare state word. `absent` next to `parses=1 reuses=0` still
// leaves the reader to connect the two; the whole reason the state is here is that the numbers
// alone read as a failure on a card that has simply never been written to.
const _STATE_NOTE = {
  absent:      '  (no manifest on the card yet - every item re-reads, and that is correct)',
  unreadable:  '  (manifest unreadable - falling back to hashing everything)',
  incompatible:'  (manifest from another version - it will be rebuilt)',
};

// ⚠️⚠️ A LINE THAT PRINTS WHEN NOTHING HAPPENED IS THE INSTRUMENT LYING. Found 2026-09-25 while
// mid-export to a freshly formatted card, `entryMatchesAt` returns `missing` the moment
// the destination folder does not exist, BEFORE `cacheFor` is reached - so on a fresh card no
// manifest is consulted at all. The report still fired once per font and would have shown the
// counters left by something else, which reads as "the borrow is working" over work never done.
// Compare against the last line printed and say so when nothing moved.
let _lastTouches = 0;

function report(label) {
  const c = _counts;
  const untouched = _lastTouches === _touches;
  _lastTouches = _touches;
  console.log('[manifest] ' + String(label || '')
    + (untouched
        ? '  no manifest consulted (nothing at the destination to compare)'
        : '  borrow: parses=' + c.parses + ' reuses=' + c.reuses + ' stats=' + c.stats
          + ' hashed=' + c.hashes
          + (_STATE_NOTE[c.state] || '')));
}

// ⚠️⚠️ THE MEMO HANDS OUT A COPY, NEVER ITS OWN OBJECT. [B-173, 2026-09-24]
//
// `mergeItems` and `mergeItem` both do `readState()` and then MUTATE the manifest in place
// (`m.items[name] = { files }`) before writing it. Handing them the cached object made the memo
// mutate itself by reference — which happened to look correct, and is exactly the kind of
// accident that reads as working until it does not: a caller that mutates and then FAILS to
// write would leave the memo holding records that were never persisted, and the next compare
// would believe files are recorded on the card that are not there. That is a wrong answer about
// the user's card, which is the one failure this cache is not allowed to introduce.
//
// ⭐ Found by mutation-testing the guard, not by reading: removing the explicit invalidation left
// every test green because the in-place mutation was keeping the cache accidentally fresh.
//
// ⚠️ A clone per call is memory work. The thing it replaces is a 505 KB read and parse off a card
// over USB, so this is cheap by several orders of magnitude and not worth optimising until
// measured. Points 2-4 of [B-173] are where the remaining cost actually is.
function _copyOut(result) {
  if (!result || !result.manifest) return result;
  return { manifest: structuredClone(result.manifest), state: result.state };
}

function readState(destDir) {
  if (!destDir) return { manifest: null, state: 'absent' };
  const mPath = manifestPath(destDir);
  const st = _statQuiet(mPath);
  if (_memo && _memo.path === mPath && st
      && _memo.size === st.size && _memo.mtimeMs === st.mtimeMs) {
    _countReuse();
    return _copyOut(_memo.result);
  }
  // ⚠️ ONE EXIT, so every outcome is memoised on the same terms. A `return` added later that
  // skips the memo would quietly reintroduce the per-item read this exists to remove, and
  // nothing would go red - it would just get slow again.
  const keep = (result) => {
    // Counted here rather than beside the readFileSync so that every outcome which ends a
    // borrow is counted on the same terms as the one exit above. See the note on `_countParse`.
    _countParse(mPath, result && result.state);
    if (st) _memo = { path: mPath, size: st.size, mtimeMs: st.mtimeMs, result };
    // ⚠️ The CALLER gets a copy too, not the object we just memoised - otherwise the very first
    // read after a parse hands out the live cache and the mutation problem returns.
    return _copyOut(result);
  };
  let raw;
  try {
    raw = fs.readFileSync(mPath, 'utf8');
  } catch (err) {
    // ENOENT is a real answer: there is no manifest. Every other errno means
    // one may well be sitting there that we simply could not get at.
    // ⚠️ NOT MEMOISED WHEN ABSENT - there is no stat to validate against, so a later write
    // would have nothing to invalidate.
    // ⭐ STILL COUNTED AS A PARSE. The card was touched, and because nothing is memoised this
    // path repeats per item - so a destination with no manifest reads `parses=1 reuses=0` on
    // every line, which is the honest picture rather than a borrow that looks like it held.
    const state = (err && err.code === 'ENOENT') ? 'absent' : 'unreadable';
    _countParse(mPath, state);
    return { manifest: null, state };
  }
  let m = null;
  try { m = JSON.parse(raw); } catch { return keep({ manifest: null, state: 'unreadable' }); }
  if (!m || typeof m !== 'object') return keep({ manifest: null, state: 'unreadable' });
  if (m.version !== MANIFEST_VERSION) return keep({ manifest: null, state: 'incompatible' });
  // Right version, no items: malformed rather than obsolete. Refuse to write
  // over it. The escape hatch is the one already documented at the top — delete
  // the file and the next export rebuilds it as it goes.
  if (!m.items) return keep({ manifest: null, state: 'unreadable' });
  return keep({ manifest: m, state: 'ok' });
}

// ⚠️ Cleared by OUR writes as well as detected by the stat. The stat alone would catch it, but a
// filesystem with coarse mtime granularity can land a write inside the same millisecond as the
// read that preceded it - and on FAT32 the granularity is 2 SECONDS. Belt and braces, and the
// braces are the cheap half.
function _forgetMemo(destDir) {
  if (!destDir) { _memo = null; return; }
  if (_memo && _memo.path === manifestPath(destDir)) _memo = null;
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
    // ⚠️⚠️ THE MEMO MUST GO HERE, NOT BE LEFT TO THE STAT. [B-173, 2026-09-24] FAT32 records
    // mtime with TWO-SECOND granularity, so a write landing close behind the read that preceded
    // it can leave size and mtime both unchanged - and a memo validated only by those would then
    // serve the pre-write manifest. Since this process is the only writer, clearing here is what
    // actually makes the memo safe; the stat is the backstop for anything outside our control.
    _forgetMemo(destDir);
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
// [B-402] ⭐⭐ COMMIT EVERYTHING THE OPERATION LEARNED, IN ONE WRITE.
//
// His design: "we gather all the information and at the very end we drop a SINGLE manifest
// update based on what we learned along the way." The first cut wrote per exported item, which
// is several writes AND silently drops any item the operation looked at but did not export — a
// font already identical at the destination was hashed by the compare and then never recorded,
// so a card kept in sync re-hashed every matching font on every future export. That is exactly
// the cost the manifest exists to avoid, reintroduced while removing a different one.
//
// `items` is { itemName: Map|Array of [relPath, [size, mtime, hash]] }. Every item merges over
// what is already recorded, then ONE write. Items the operation never touched keep their
// records untouched.
//
// ⚠️ ALL-OR-NOTHING ON PURPOSE. The per-item write existed so an interrupted export left the
// card's manifest matching what was on it. A single terminal write means an interrupted export
// records nothing — which is CORRECT rather than merely simpler: the entries it would have
// written describe files that may not have finished copying, and a missing record self-heals
// into a re-read while a wrong one does not.
function mergeItems(destDir, items) {
  if (!destDir || !items) return false;
  const names = Object.keys(items);
  if (!names.length) return false;
  const { manifest, state } = readState(destDir);
  if (state === 'unreadable') return false;
  const m = manifest || { version: MANIFEST_VERSION, items: {} };
  const before = manifest ? JSON.stringify(m.items) : null;
  let touched = false;
  for (const itemName of names) {
    const observed = items[itemName] instanceof Map ? items[itemName] : new Map(items[itemName] || []);
    if (!observed.size) continue;
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
    touched = true;
  }
  if (!touched) return false;
  // Same no-op guard as below, applied to the WHOLE manifest rather than one item.
  if (before !== null && before === JSON.stringify(m.items)) return true;
  return write(destDir, m);
}

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
  // [B-402] ⭐ A WRITE THAT CHANGES NOTHING IS STILL A WRITE. Every caller merged its
  // observations over what was already recorded and then wrote unconditionally, so a run
  // where every file was a cache hit spent a temp file and a rename recording what was
  // already there. On a destination reached through the board's mass storage that is a write
  // cycle bought with no information.
  //
  // ⚠ The comparison is on the SERIALISED form because that is exactly what write() would
  // put on disk. `files` is rebuilt sorted on every merge, so an unchanged item serialises
  // identically - key order cannot drift and produce a false difference.
  // ⚠ Returns TRUE when it skips: the caller asked for the manifest to say this, and it does.
  // Reporting false would read as a failure to record.
  if (manifest) {
    try {
      if (JSON.stringify(m.items[itemName]) === JSON.stringify(rec)) return true;
    } catch {}
  }
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
  mergeItems,
  manifestPath,
  cacheFor,
  countStat,
  countHash,
  counts,
  report,
  read,
  readState,
  write,
  mergeItem,
  forgetItem,
};
