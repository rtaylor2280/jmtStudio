// Shared Tracks Folder — a single, app-global folder that maps to /tracks/
// at the SD card root (ProffieOS prop_base.h ListTracks scans both
// /tracks/ and /<anydir>/tracks/, so a top-level /tracks/ folder is the
// universal-tracks location that doesn't require living inside a common
// folder). Flat structure: .wav files directly inside, arbitrary names.
// No tags/creator/source-link metadata — it's a curation surface, not a
// library entry.

const fs = require('fs');
const fsp = require('fs').promises;   // [B-400] async copy, so the loop can yield
const path = require('path');
const { copyTreeWithProgress, copyFileWithProgress } = require('./sfExportCopy');
const hashIndex = require('./soundFontSharedTracksHash');

function sharedTracksRoot(userData) {
  return path.join(userData, 'soundFonts', 'sharedTracks');
}

function exists(userData) {
  try { return fs.statSync(sharedTracksRoot(userData)).isDirectory(); }
  catch { return false; }
}

function create(userData) {
  const root = sharedTracksRoot(userData);
  try {
    fs.mkdirSync(root, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Flat list of .wav files. Sorted natural so "track2" precedes "track10".
function listFiles(userData) {
  const root = sharedTracksRoot(userData);
  if (!exists(userData)) return [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.wav$/i.test(e.name)) continue;
    let size = 0;
    try { size = fs.statSync(path.join(root, e.name)).size; } catch {}
    out.push({ name: e.name, size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

// Sanitize a destination filename. Same conservative rules as Proffie-safe
// names elsewhere — spaces become underscores, then filesystem-disallowed
// characters get replaced, then length is capped. Extension preserved.
function _safeFileName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const ext = (trimmed.match(/\.[^.]+$/) || [''])[0];
  const stem = trimmed.slice(0, trimmed.length - ext.length);
  const safeStem = stem
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 100);
  return safeStem + ext.toLowerCase();
}

// Suggest a non-colliding filename. If "track.wav" exists, returns
// "track_2.wav", then "track_3.wav", etc. — the original is implicitly
// number one, so _1 is never minted ([B-343], his rule).
function _uniqueName(root, desired) {
  if (!fs.existsSync(path.join(root, desired))) return desired;
  const ext = (desired.match(/\.[^.]+$/) || [''])[0];
  const stem = desired.slice(0, desired.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!fs.existsSync(path.join(root, candidate))) return candidate;
  }
  throw new Error('Could not find a non-colliding filename');
}

// `onFileProgress({ done, total, name })` is OPTIONAL and fires once per file.
// Without it the caller can only report at FOLDER level, which on a tracks-only
// import means one unit of work: the bar sits at 0 and jumps to done, so a real
// copy of hundreds of megabytes looks like nothing is happening. (Ryan spotted it
// 2026-09-01: "might be doing the whole folder level rather than the files".)
// [B-400] ASYNC, and the async is the fix rather than a refactor that came with it.
//
// ⚠️⚠️ A SYNCHRONOUS LOOP CANNOT REPORT ON ITSELF. copyFileSync plus a readFileSync hash held the
// main process for the whole add, so every progress event describing this work queued behind the
// work and flushed after it finished. Wiring a callback into the old loop would have produced a
// bar that sat at zero and jumped to 100 - passing a three-file test and failing the case he
// reported. `await` per file is what lets the event loop breathe. Same mechanism [B-398] measured.
//
// ⭐ BYTES, NOT FILE COUNT, and that is his correctness point not a polish one: "if the user
// selects 100 long wav files... that's real bytes that need to be tracked for sure." A file-count
// bar sits at 99/100 with a third of the data still to move.
//
// ⚠️ WHY `onBytes` REPORTS {done, total} AND NOT A DELTA, unlike _sfExportProgressEmitter: a
// dropped or coalesced delta loses those bytes permanently and the bar ends short. An absolute
// pair self-corrects on the next message. The backend already knows the total here, so there is
// nothing to reconstruct.
//
// ⚠️⚠️ THE TOTAL COUNTS EACH FILE TWICE WHEN DEDUP IS ON, because each file IS read twice - once
// to hash for the duplicate check, once to copy. Counting the copy alone would run the bar at half
// speed and then jump. A duplicate is never copied, so its copy half is CREDITED the moment it is
// found - otherwise a duplicate-heavy add would stop short of 100%.
async function addFiles(userData, sourceFilePaths, onFileProgress, onBytes) {
  if (!Array.isArray(sourceFilePaths) || sourceFilePaths.length === 0) {
    return { ok: false, error: 'No files supplied' };
  }
  if (!exists(userData)) {
    const cr = create(userData);
    if (!cr.ok) return cr;
  }
  const root = sharedTracksRoot(userData);
  const added = [];
  const skipped = [];
  const refusedIn = [];
  // Tracks you ALREADY HAVE, by content. Reported separately from `skipped`,
  // which means "could not be added": having it already is a success, not a
  // failure. (2026-08-31 — [B-005] item 5.)
  //
  // WHY THIS WAS NEEDED. Every file used to be copied, and a name collision was
  // resolved by _uniqueName suffixing it — so re-importing the same card wrote
  // `track1_1.wav`, `track1_2.wav`, and the shared folder doubled every time.
  // `findByHash` has existed in soundFontSharedTracksHash the whole time and was
  // never called from here. Filename is not identity; content is.
  let _index = null;
  try { _index = hashIndex.ensureIndex(userData); } catch {}
  // [B-406] The library-wide content index, built ONCE for the whole batch — same as addFilesAt.
  // This is what lets a track link against bytes a font or source already holds instead of being
  // written fresh. Null on failure, and every use is guarded, so a broken index degrades to the
  // plain copy this always did.
  let _CI = null, _ciIndex = null;
  try { _CI = require('./soundFontContentIndex'); _ciIndex = _CI.buildIndex(userData); }
  catch { _CI = null; _ciIndex = null; }
  const duplicates = [];
  const _total = sourceFilePaths.length;
  let _done = 0;
  // Byte budget, stat'd up front. N stats against a copy of the same N files is noise, and it is
  // the only way the bar can be determinate from the first frame - which rule 6 requires, because
  // the modal is already on screen before this is called.
  const _srcOf = (e) => ((e && typeof e === 'object') ? e.path : e);
  const _sizes = new Map();
  let _bytesTotal = 0;
  const _hashing = !!_index;
  for (const e of sourceFilePaths) {
    const sp = _srcOf(e);
    let sz = 0;
    try { sz = fs.statSync(sp).size; } catch {}
    _sizes.set(sp, sz);
    _bytesTotal += _hashing ? sz * 2 : sz;
  }
  let _bytesDone = 0;
  const _emit = (name) => {
    if (typeof onBytes !== 'function') return;
    try { onBytes({ done: _bytesDone, total: _bytesTotal, name: name || '' }); } catch {}
  };
  const _credit = (n, name) => { _bytesDone += (n || 0); _emit(name); };
  _emit('');
  for (const entry of sourceFilePaths) {
    _done++;
    if (typeof onFileProgress === 'function') {
      const _n = (entry && typeof entry === 'object') ? (entry.name || entry.path) : entry;
      try { onFileProgress({ done: _done, total: _total, name: path.basename(String(_n || '')) }); } catch {}
    }
    // Either a path, or { path, name } when the caller has a name to land it under.
    // Bulk import's review lets the user rename a track before it is copied, and
    // that is the only moment the name can carry any context: this folder is one
    // flat global pool, so `track1.wav` from three cards is three collisions the
    // user can no longer tell apart afterwards. (2026-08-31.)
    const src = (entry && typeof entry === 'object') ? entry.path : entry;
    const wanted = (entry && typeof entry === 'object' && entry.name) ? entry.name : null;
    if (!src || !/\.wav$/i.test(src)) { skipped.push({ src, reason: 'Not a .wav file' }); continue; }
    // ⚠️ THE .wav TEST ABOVE IS A SHAPE TEST, NOT A SAFETY ONE ([B-370]). A program
    // renamed hum.wav passes it, which is precisely the disguise the content tier
    // exists for. Nothing is destroyed here - the track simply is not added, and the
    // user's own file stays where they picked it.
    {
      const _v = require('./sdCardDetect').checkCarryableFile(src, path.basename(src));
      if (_v.blocked) {
        refusedIn.push({ name: path.basename(src), kind: _v.kind, reason: _v.reason,
          disguised: !!_v.disguised });
        continue;
      }
    }
    const base = wanted || path.basename(src);
    const safe = _safeFileName(base);
    if (!safe) { skipped.push({ src, reason: 'Invalid filename' }); continue; }
    // Content check BEFORE the copy, so an identical track is never written and
    // never renamed. A hashing failure falls through to copying: not being able to
    // read a file is not evidence that we already have it.
    const _sz = _sizes.get(src) || 0;
    const _label = path.basename(String(src || ''));
    if (_index) {
      let _hashed = 0;
      try {
        // ⚠️ findByHash returns an ARRAY of matches and `[]` when there are none.
        // An empty array is truthy, so a bare `if (hit)` reports every track as a
        // duplicate against an empty library — which is exactly what it did until
        // the test caught it. Check the length.
        // [B-400] Streamed, so a single 400 MB wav moves the bar while it is read rather than
        // being one silent unit - and so it is not pulled into memory whole.
        const h = await hashIndex.hashFileAsync(src, (n) => { _hashed += n; _credit(n, _label); });
        const hits = h ? hashIndex.findByHash(_index, h) : null;
        if (hits && hits.length) {
          duplicates.push({ src, have: hits[0].name || '' });
          // ⚠️ CREDIT THE COPY THAT WILL NEVER HAPPEN. The budget charged this file twice;
          // a duplicate is not copied, so without this the bar stops short by one file's
          // size for every duplicate - and re-adding a card the user already has is ALL
          // duplicates, which is the most common way this path is used.
          _credit(_sz, _label);
          continue;
        }
      } catch {}
      // A hash that failed part-way still charged the budget for what it read; settle the
      // rest of the read half so the bar does not drift on an unreadable file.
      if (_hashed < _sz) _credit(_sz - _hashed, _label);
    }
    const dest = _uniqueName(root, safe);
    try {
      // [B-400] fsp.copyFile, not copyFileSync: the await is what yields the event loop so the
      // ticks emitted above can actually reach the renderer while the add is still running.
      //
      // [B-406] ⭐⭐ AND IT GOES THROUGH THE LIBRARY-WIDE POOL FIRST. His framing, and it is the
      // one that settles this: "tracks is just a font source under a different name" — for
      // STORAGE purposes it is a folder of wavs like any other, so "we never store the same bytes
      // twice" has to hold here too. A plain copy meant a track matching a wav already in a font
      // was written fresh, in the direction opposite to the one he found.
      //
      // ⚠️⚠️ THE SIDECAR STAYS, AND DOING ONLY ONE OF ITS JOBS IS THE POINT. sharedTracksHash was
      // doing TWO things: per-track UUID IDENTITY (so a renamed track survives a backup merge —
      // real, and genuinely specific to tracks) and CONTENT DEDUPE (a hash lookup — not specific
      // at all, and duplicated what the content index does for every other bucket). Conflating
      // them is what opted tracks out of the library-wide system. Identity stays here; bytes go
      // to the pool.
      //
      // ⚠️ ingest falls back to a copy on any failure, so this can only ever save writes, never
      // lose a file. And it re-hashes a candidate before linking, so a stale record costs one
      // wasted check rather than a wrong file.
      // ⚠️⚠️ THE INDEX IS BUILT ONCE, ABOVE THE LOOP. The first draft of this built it per file —
      // measured at 165ms on his store, so a 62-file add would have spent TEN SECONDS rebuilding
      // the same index 62 times. addFilesAt already does it correctly; copying the shape rather
      // than the idea is what avoids this.
      // ⚠️⚠️ `ingest` ALONE — NOT storeInPool FIRST, and the difference is the whole point.
      // His model, 2026-09-17: "I just assumed that tracks was its own pool because it's the only
      // dynamic source. so when I add a track, that is its home." He is right, and it is the
      // ORIGINAL design: [B-315] and [B-316] both say the content pool was MODELLED on
      // sharedTracksHash — "exactly like sharedTracks, which is already this pattern and proves it
      // works." Tracks was always a pool. Routing it through storeInPool layered a second pool on
      // top of the first and gave every novel track a redundant name.
      //
      // ⭐ THE RULE THIS MAKES VISIBLE, and it is worth stating because it was never written down:
      //     a bucket that IS a home            -> ingest alone   (commons, tracks)
      //     content with no home of its own    -> storeInPool first, then ingest   (font + Add)
      // A font file picked off the desktop has nowhere to live, so the pool gives it somewhere.
      // A track has the tracks folder. So novel audio simply stays here, and ingest still links
      // when the library already holds those bytes anywhere.
      //
      // ⚠️ The survival argument does not apply either: hardlinks keep bytes alive while ANY name
      // points at them, so a font linking straight to a track does not need a pool copy to
      // outlive a deleted track.
      const _destAbs = path.join(root, dest);
      let _linked = false;
      try {
        if (_CI && _ciIndex) {
          const r = _CI.ingestFile({ index: _ciIndex, srcAbs: src, destAbs: _destAbs });
          _linked = !!(r && r.ok);
        }
      } catch { _linked = false; }
      if (!_linked) await fsp.copyFile(src, _destAbs);
      _credit(_sz, _label);
      // Hash + record. Failure here doesn't abort the add — the file
      // is on disk and ensureIndex will backfill it on next read.
      try { hashIndex.recordAdd(userData, dest); } catch {}
      // Keep the in-memory index current within this call, so adding a batch
      // that contains the same track twice writes it once.
      if (_index) { try { _index = hashIndex.ensureIndex(userData); } catch {} }
      added.push(dest);
    } catch (err) {
      skipped.push({ src, reason: String(err && err.message || err) });
    }
  }
  // ⭐⭐ LAND ON 100%, ALWAYS. Files leave this loop by SIX routes - copied, duplicate, not a
  // .wav, refused, unsafe name, copy error - and only the first two settle their own budget.
  // Crediting at every skip point would work until the seventh route is added and silently
  // stops the bar at 94%. One terminal emit is honest (the work IS finished) and cannot be
  // outgrown. [B-400] - and [B-389]'s rule is exactly this: a bar always reaches 100% before
  // it moves on.
  _bytesDone = _bytesTotal;
  _emit('');
  return { ok: true, added, skipped, duplicates, refused: refusedIn };
}

function renameFile(userData, oldName, newName) {
  if (!oldName || !newName) return { ok: false, error: 'Missing name' };
  const safe = _safeFileName(newName);
  if (!safe) return { ok: false, error: 'Invalid filename' };
  if (!/\.wav$/i.test(safe)) return { ok: false, error: 'New name must end in .wav' };
  const root = sharedTracksRoot(userData);
  const src = path.join(root, oldName);
  const dst = path.join(root, safe);
  if (!fs.existsSync(src)) return { ok: false, error: 'Source file not found' };
  if (src === dst) return { ok: true, newName: safe };
  if (fs.existsSync(dst)) return { ok: false, error: 'A file with that name already exists' };
  try {
    fs.renameSync(src, dst);
    try { hashIndex.recordRename(userData, oldName, safe); } catch {}
    return { ok: true, newName: safe };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function deleteFile(userData, name) {
  if (!name) return { ok: false, error: 'Missing name' };
  const root = sharedTracksRoot(userData);
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return { ok: true }; // already gone — idempotent
  try {
    fs.unlinkSync(file);
    try { hashIndex.recordDelete(userData, name); } catch {}
    // [B-406] ⚠️⚠️ A DEFECT THIS ENTRY ITSELF INTRODUCED, caught before it shipped. Tracks now
    // store their bytes in the pool and hold a link, so removing the track's name is no longer
    // the same as freeing its space — the pool copy is left at nlink 1 and nothing reclaimed it.
    // Deleting tracks to free space is EXACTLY what he was doing the day this was written, so the
    // change would have quietly defeated the thing it was next to.
    // ⚠️ The sweep only removes pool files whose link count has fallen to 1, so a file any other
    // font, common or track still names is never touched. deleteEntry, deleteFiles and removal all
    // already call it; tracks was the fourth door and had never needed it before today.
    try { require('./soundFontContentIndex').releasePoolOrphans(userData); } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Delete the entire folder (and its contents). Idempotent.
function deleteAll(userData) {
  const root = sharedTracksRoot(userData);
  if (!fs.existsSync(root)) return { ok: true };
  try {
    fs.rmSync(root, { recursive: true, force: true });
    // [B-406] Same sweep as deleteFile, and this is the case where it matters most: deleting the
    // WHOLE folder drops every track name at once, so without this the pool keeps a copy of every
    // track that nothing else names — the entire folder's worth of bytes, invisibly.
    try { require('./soundFontContentIndex').releasePoolOrphans(userData); } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Conflict-probe for the bulk Export flow — true when destDir already
// has a top-level `tracks` folder that an export would collide with.
function folderExistsAt(destDir) {
  if (!destDir) return false;
  try { return fs.existsSync(path.join(destDir, 'tracks')); }
  catch { return false; }
}

// Does this destination already have a tracks/ folder? One stat, no reads.
//
// This replaced a content-comparing matchesAt, which was removed 2026-08-27
// (B-168) once it had no callers. The export flow asks the user BEFORE comparing
// anything, because if they say leave it alone there is nothing to compare and
// the whole folder is skipped. Hashing to decide whether a question is worth
// asking is backwards when the answer can make the work unnecessary.
//
// If something later needs a real content comparison here, read the per-file
// hash records the way the rest of the export path does. Do not reinstate a
// whole-folder rehash.
function existsAt(destDir) {
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const destTracks = path.join(destDir, 'tracks');
  let exists = false;
  try { exists = fs.existsSync(destTracks) && fs.statSync(destTracks).isDirectory(); } catch {}
  return { ok: true, exists };
}

// What WOULD an export do? Read-only, writes nothing, so the caller can put a
// real decision in front of the user before anything is touched. Splitting plan
// from apply is what lets the differences dialog work the same way it does for
// font folders.
// onFile(name, done, total) is called per track as it is compared. Tracks are a
// FLAT list of many files, unlike a font folder which the caller can tick once
// per folder, so without this the scan sits on "shared tracks" while hashing a
// hundred-plus wavs and reads as frozen. The app's convention for a long read is
// filenames going past, not a stalled bar.
function planExport(userData, destDir, onFile = null) {
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const srcDir = sharedTracksRoot(userData);
  if (!fs.existsSync(srcDir)) return { ok: false, error: 'Shared tracks folder not found' };
  const targetDir = path.join(destDir, 'tracks');
  const toAdd = [], unchanged = [], differing = [];
  let names = [];
  try {
    names = fs.readdirSync(srcDir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.wav$/i.test(e.name))
      .map(e => e.name);
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }

  // LIBRARY SIDE: hashes were computed when each track was imported and are
  // trusted. The library is ours and every add, rename and delete goes through
  // the index, so re-deriving them would be reading gigabytes to learn what we
  // already wrote down.
  let libHashes = new Map();
  try { libHashes = hashIndex.resolveHashes(userData); } catch {}

  // DESTINATION SIDE: the manifest holds a hash per file. mtime is there for one
  // job only, to tell whether the user invalidated an entry. We look up ONLY the
  // files the library is about to write; anything else at the destination, in
  // the manifest or not, is none of this comparison's business.
  //
  // Self-healing: a file with no entry, or one whose entry is invalidated, gets
  // hashed — just that file — and its entry is refreshed. So a missing or stale
  // manifest costs exactly the reads it is missing, never a full pass.
  const sync = require('./sfSyncManifest');
  const { hashFile } = require('./soundFontFileHash');
  let cache = new Map();
  try { cache = sync.cacheFor(destDir, 'tracks'); } catch {}
  const refreshed = new Map();

  let done = 0;
  for (const name of names) {
    if (onFile) { try { onFile(name, done, names.length); } catch {} }
    done++;
    const dst = path.join(targetDir, name);
    let st = null;
    try { st = fs.statSync(dst); } catch { st = null; }
    if (!st) { toAdd.push(name); continue; }

    const mtime = Math.round(st.mtimeMs);
    const entry = cache.get(name);
    const valid = entry
      && entry[0] === st.size
      && Math.abs((entry[1] || 0) - mtime) <= sync.MTIME_TOLERANCE_MS;

    let destHash = valid ? entry[2] : hashFile(dst);
    refreshed.set(name, [st.size, mtime, destHash]);

    const libHash = libHashes.get(name) || hashFile(path.join(srcDir, name));
    (destHash && libHash && destHash === libHash ? unchanged : differing).push(name);
  }
  if (onFile) { try { onFile('', names.length, names.length); } catch {} }

  // [B-402] RETURNED, NOT WRITTEN. A compare answers a question, and a question must not
  // mutate the thing it is asking about - the same principle the mass-storage guard is built
  // on, and the one he set at [B-358] for a different caller ('a read-only question can seed
  // jmt-studio-manifest.json at the destination').
  //
  // ⭐ NOTHING IS LOST BY DEFERRING IT. Everything here was computed as a side effect of work
  // the compare had to do anyway, so handing it back costs nothing and the caller writes it
  // ONCE, at the end, together with whatever the copies added. A standalone compare - the
  // user only asking - writes nothing at all, and re-asking simply re-hashes.
  //
  // ⚠ The old code wrote here AND again after copying, so one export touched the manifest
  // twice, seconds apart, the first describing a state that existed only until the copies
  // landed.
  return { ok: true, toAdd, unchanged, differing, observed: refreshed };
}

// ADDITIVE export. Deliberate call 2026-07-31: "always additive not replacing. so
// existing same hash files stay and anything new gets added."
//
// NOTHING AT THE DESTINATION IS EVER DELETED. That is the guarantee, and it
// includes tracks the library has never heard of — a card is the user's, not a
// mirror of our library.
//
// Per file:
//   * not there             -> copied
//   * there, byte-identical -> left alone
//   * there, DIFFERENT      -> the CALLER decides, per file, via `replace`
//
// That last case went through two wrong answers before this one. Proffie variant
// numbering (boot.wav -> boot2.wav) is wrong here: those are interchangeable
// alternatives picked at random, but a preset names exactly ONE track path, so
// mars2.wav would never play and would pile up another copy every export.
// Keeping the card's version silently was also wrong — the library is the
// curated source for these files, so a difference almost always means the user
// updated their copy and expects it to reach the card, and "keep" made the
// Update prompt contradict itself. So it asks, per file, defaulting to Replace.
async function exportToFolderAdditive(userData, destDir, opts = {}) {
  const { replace = [], onBytes = null } = opts;
  const plan = planExport(userData, destDir);
  if (!plan.ok) return plan;
  const srcDir = sharedTracksRoot(userData);
  const targetDir = path.join(destDir, 'tracks');
  try { fs.mkdirSync(targetDir, { recursive: true }); }
  catch (err) { return { ok: false, error: `Cannot create destination: ${err.message}` }; }

  const replaceSet = new Set(replace);
  const added = [], replaced = [], kept = [];
  // ⚠️ THE LAST UNGUARDED WAY OUT ([B-364], 2026-09-11). Every other export refuses a
  // program; this one copied straight through. The .wav filter on the legacy path below
  // is not a substitute - a program renamed to hum.wav passes an extension test and is
  // exactly the case content-checking exists for. Free here: the check reads 256 bytes
  // and this path already touches every file it copies.
  const refused = [];
  const copy = async (name) => {
    const src = path.join(srcDir, name);
    const v = require('./sdCardDetect').checkCarryableFile(src, name);
    if (v.blocked) {
      refused.push({ relPath: name, name, kind: v.kind, reason: v.reason, disguised: !!v.disguised });
      return false;
    }
    await copyFileWithProgress(src, path.join(targetDir, name), onBytes);
    return true;
  };
  try {
    for (const name of plan.toAdd) { if (await copy(name)) added.push(name); }
    for (const name of plan.differing) {
      if (replaceSet.has(name)) { if (await copy(name)) replaced.push(name); }
      else kept.push(name);
    }
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }

  // Only record when the destination now matches the library exactly. If the
  // user kept a differing track, the folder is deliberately NOT our content, so
  // recording a hash for it would let a later export skip a real difference.
  // Refresh the recorded table from what is now on the card, so the next scan
  // can reuse it. Recorded whatever the outcome: it describes the DESTINATION,
  // not our library, so a track the user chose to keep is simply recorded as it
  // is and will be compared against the library again next time.
  // Refresh entries for the files we just wrote, and only those. Their content
  // is the library's, so the hash is the library's — already known, nothing to
  // re-read. Anything else recorded for this folder is left alone.
  // [B-402] THE ONE WRITE, AND IT CARRIES EVERYTHING LEARNED ALONG THE WAY. His design:
  // "we gather all the information and at the very end we drop a single manifest update based
  // on what we learned along the way." Two sources feed it and neither costs a read:
  //   • the COMPARE already hashed every file that was at the destination, because comparing
  //     them is its job - `plan.observed`.
  //   • the COPIES know the library hash of what they just wrote, already in memory, so the
  //     card is never re-read to learn what we put on it.
  // ⚠ ORDER MATTERS: the copies go in SECOND so a file we just replaced overwrites the
  // compare's record of the old version, not the other way round.
  //
  // ⚠⚠ NO SEPARATE PASS, EVER. Building the manifest as its own task would re-read the card
  // to learn what it already told us - adding cost to reduce cost.
  // ⚠️ RETURNED, NOT WRITTEN. The CALLER commits everything the operation learned in ONE write at
  // the end, so an item that was only LOOKED at still gets recorded. Writing per item here dropped
  // exactly those, and a card kept in sync is mostly items that need no copying.
  let _observed = null;
  try {
    const { hashFile } = require('./soundFontFileHash');
    const libHashes = hashIndex.resolveHashes(userData);
    const observed = new Map(plan.observed || []);
    for (const name of [...added, ...replaced]) {
      try {
        const st = fs.statSync(path.join(targetDir, name));
        const h = libHashes.get(name) || hashFile(path.join(srcDir, name));
        if (h) observed.set(name, [st.size, Math.round(st.mtimeMs), h]);
      } catch {}
    }
    _observed = [...observed];
  } catch {}
  return { ok: true, destPath: targetDir, added, replaced, kept, unchanged: plan.unchanged, refused,
           observedItem: 'tracks', observed: _observed };
}

// Copy the singleton sharedTracks folder into destDir/tracks/. Mirrors
// exportCommonToFolder's mode semantics (skip / replace / rename) so
// the bulk Export flow can treat tracks and common uniformly. SD card
// convention pins the destination name to literal "tracks" — rename
// mode bumps to "tracks_N" on collision since Proffie only matches
// the literal path.
//
// NOTE: 'rename' produces tracks_1, which ProffieOS will never read — neither
// the OS8 Edit Track menu (which scans root "tracks" and <dir>/tracks) nor
// Fett263's Track Player (which scans <fontdir>/tracks) will ever look there.
// It is staging, not a usable outcome. exportToFolderAdditive above is the
// better answer and is what the bulk flow now uses.
async function exportToFolder(userData, destDir, mode = 'rename', onBytes = null) {
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const srcDir = sharedTracksRoot(userData);
  if (!fs.existsSync(srcDir)) return { ok: false, error: 'Shared tracks folder not found' };
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create destination: ${err.message}` }; }
  }
  let targetName = 'tracks';
  const exists = fs.existsSync(path.join(destDir, targetName));
  if (exists) {
    if (mode === 'skip') {
      return { ok: true, skipped: true, destPath: path.join(destDir, targetName) };
    }
    if (mode === 'replace') {
      try { fs.rmSync(path.join(destDir, targetName), { recursive: true, force: true }); }
      catch (err) { return { ok: false, error: `Cannot remove existing folder: ${err.message}` }; }
    } else {
      // First suffix is _2 ([B-343]): the original is implicitly number one.
      let n = 2;
      while (fs.existsSync(path.join(destDir, targetName))) {
        targetName = `tracks_${n}`;
        n++;
      }
    }
  }
  const targetDir = path.join(destDir, targetName);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    // Flat folder — only .wav files at the top level (matches listFiles
    // contract). The .jmt-hashes.json sidecar stays in userData and never
    // ships to the SD card. Streamed copy with write-paced byte progress.
    // ⚠️ The .wav fileFilter is a SHAPE test, not a safety one - a program renamed to
    // hum.wav passes it. `refused` is what reads the bytes ([B-364]).
    const _refused = [];
    await copyTreeWithProgress(srcDir, targetDir, {
      recurse: false,
      fileFilter: (name) => /\.wav$/i.test(name),
      onBytes,
      refused: _refused,
    });
    return { ok: true, destPath: targetDir, refused: _refused };
  } catch (err) {
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Read a single file as bytes — used by the in-app audio player.
function readFileBytes(userData, name) {
  if (!name) return null;
  const root = sharedTracksRoot(userData);
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return null;
  try { return fs.readFileSync(file); }
  catch { return null; }
}

// [B-398] Measurement only: markAsync/mark return the ORIGINAL function when the probe is off.
const _sp = require('./stallProbe');
module.exports = {
  sharedTracksRoot,
  exists,
  create,
  listFiles,
  addFiles,
  renameFile,
  deleteFile,
  deleteAll,
  folderExistsAt,
  existsAt,
  planExport: _sp.mark('tracks:planExport', planExport),
  exportToFolder,
  exportToFolderAdditive,
  readFileBytes,
};
