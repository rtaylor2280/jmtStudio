// What the sound font library actually costs on disk, and what sharing saved. [B-318]
//
// Three numbers, one ruler:
//   apparent  every path's logical size, summed, no dedup. This is EXACTLY the rule Explorer,
//             Finder and `du` use, so it is the number the user reads off their own folder.
//   onDisk    the same sum with each distinct file stored once. Hardlinked names share bytes,
//             so this is what the volume is really holding.
//   saved     the difference, which is what the library's dedup is worth.
//
// ── WHY THE SLOW WAY IS THE ONLY CORRECT WAY ────────────────────────────────
// Measured 2026-10-09 against a real store, because the fast path looked obvious and was wrong:
//   walk and dedupe by file identity .... 2,243 ms   3.44 GB   ground truth
//   union of hash records already kept ...   30 ms   2.38 GB   short by 1.06 GB
// Two independent reasons the fast path fails. Manifest coverage is incomplete (5,112 hash
// records against 5,318 real files). And hash-dedup answers a different question: it says what
// we WOULD occupy if every duplicate were linked, while the volume reports what we DO occupy.
// Free space agrees with the second. Showing the first under-reports and lets the user's own
// file manager contradict us, which is the failure this readout exists to prevent.
//
// ── WHY THERE IS NO INCREMENTAL VERSION ─────────────────────────────────────
// Deleting a font frees nothing while any other name holds its bytes, so there is no delta to
// apply. And the total is not decomposable: per-bucket dedup sums to 5.45 GB where the true
// figure is 3.44 GB, because 2 GB of the sharing happens BETWEEN buckets. Any scheme that caches
// a number per font and adds them up is wrong by construction. The answer is to recompute, and
// to do it where nobody is waiting.
//
// There is no staleness flag either, for the same family of reason: it would depend on every one
// of the thirty-odd operations that change the library remembering to raise it, and a missed call
// shows a wrong figure with nothing to indicate it. The stamped figure is what to put on screen
// while a fresh walk runs, and nothing more.
//
// ── IT YIELDS, AND THAT IS NOT OPTIONAL ─────────────────────────────────────
// Fifteen thousand synchronous stat calls on the main process is a frozen window. Measured on
// that exact shape: 0 B of 62.4 MB after seventeen seconds, with the title bar reading Not
// Responding. The walk breathes between directories so the app stays answerable while it runs.

'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const SCHEMA = 1;

function soundFontsRoot(userData) {
  return path.join(userData, 'soundFonts');
}

// The figure is stamped onto the library's own meta rather than kept in a side cache, because it
// is a property OF the library rather than an optimisation about it. A reader that has the meta
// has the number, and nothing has to stay in agreement with anything else.
function metaPath(userData) {
  return path.join(soundFontsRoot(userData), '_jmt_library_meta.json');
}

function _readMeta(userData) {
  try { return JSON.parse(fs.readFileSync(metaPath(userData), 'utf8')) || {}; }
  catch { return {}; }
}

function _writeMeta(userData, meta) {
  const p = metaPath(userData);
  const tmp = p + '.tmp';
  try {
    // DOES NOT CREATE THE LIBRARY. `soundFonts:exists` decides whether the user has a library at
    // all by testing for this exact file, so stamping a size figure into a userData folder with
    // no library would make the app announce a library that was never created, and send the
    // empty-state layers the wrong way. A size readout must never bring app state into being.
    if (!fs.existsSync(soundFontsRoot(userData))) return false;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, p);          // temp-then-rename: never a half-written meta
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    return false;
  }
}

// ── read the last known figure ──────────────────────────────────────────────
// Returns null when nothing has been computed yet, or when the stamped figure came from an older
// schema and can no longer be trusted to mean the same thing.
//
// There is no staleness flag here on purpose. Flagging would mean every operation that changes
// the library remembering to call in, and the one that forgets shows a figure the user's own file
// manager contradicts — invisibly. The caller recomputes unconditionally instead and uses this
// only to have something honest on screen while the walk runs.
function read(userData) {
  const m = _readMeta(userData);
  const s = m.size;
  if (!s || s.schema !== SCHEMA || typeof s.onDisk !== 'number') return null;
  return s;
}

const _breathe = () => new Promise((r) => setImmediate(r));

// ── the walk ────────────────────────────────────────────────────────────────
// `shouldStop` lets a caller abandon it; the figure is simply not updated.
async function compute(userData, { shouldStop = null, onProgress = null } = {}) {
  const root = soundFontsRoot(userData);
  if (!fs.existsSync(root)) {
    return { schema: SCHEMA, apparent: 0, onDisk: 0, saved: 0, files: 0, folders: 0,
             distinct: 0, computedAt: new Date().toISOString(), ms: 0 };
  }
  const started = Date.now();
  let apparent = 0, onDisk = 0, files = 0, folders = 0;
  // Keyed on device AND inode. On Windows this is the NTFS file ID, which is how a hardlinked
  // name is recognised as the same bytes rather than a second copy.
  const seen = new Set();

  const walk = async (dir) => {
    if (shouldStop && shouldStop()) return false;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return true; }                       // unreadable: skip, never abort the whole figure
    for (const e of entries) {
      if (shouldStop && shouldStop()) return false;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        folders++;
        if (!(await walk(p))) return false;
        continue;
      }
      if (!e.isFile()) continue;                  // symlinks and sockets are not content
      let st;
      try { st = await fsp.stat(p); } catch { continue; }
      files++;
      apparent += st.size;
      const key = st.dev + ':' + st.ino;
      if (!seen.has(key)) { seen.add(key); onDisk += st.size; }
    }
    // Between directories rather than between files: the yield has to be often enough that the
    // window stays answerable, and rare enough that it does not dominate the walk.
    await _breathe();
    if (onProgress) { try { onProgress({ files, apparent }); } catch {} }
    return true;
  };

  const finished = await walk(root);
  if (!finished) return null;

  return {
    schema: SCHEMA,
    apparent, onDisk, saved: apparent - onDisk,
    files, folders, distinct: seen.size,
    computedAt: new Date().toISOString(),
    ms: Date.now() - started,
  };
}

// ── compute and stamp ───────────────────────────────────────────────────────
async function refresh(userData, opts = {}) {
  const figure = await compute(userData, opts);
  if (!figure) return null;                       // stopped: leave the old figure in place
  const m = _readMeta(userData);
  m.size = figure;
  _writeMeta(userData, m);
  return figure;
}

module.exports = {
  SCHEMA, soundFontsRoot, metaPath,
  read, compute, refresh,
};
