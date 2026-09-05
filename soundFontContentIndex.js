// Library-wide content index — "never store an identical wav twice" as a
// PROPERTY of the library rather than a sweep that runs afterwards.
// ([B-315] + [B-316] + [B-317], built as one mechanism 2026-09-05.)
//
// ── WHAT THIS IS ────────────────────────────────────────────────────────────
// Three backlog entries described the same check from three directions:
//   [B-315] hash a file being ADDED and point at what we already hold
//   [B-317] dedup ACROSS sources, not just within one
//   [B-316] an added file is a thing in the library, not a property of one font
// They collapse into one question asked at every point where a file ENTERS the
// library: do we already hold these bytes? If yes, make another NAME for them.
// If no, write them once, somewhere with a home.
//
// Doing it at write time rather than as a pass afterwards is the whole point:
// as a pass, "stored once" is a state we arrive at, with a window where the
// bytes are doubled. At write time it is a property we hold. Import a 200 MB
// bundle that is 80% recycled and only the new 20% ever reaches the disk.
//
// ── WHY A HARDLINK ──────────────────────────────────────────────────────────
// Same reasoning as the entry-pointer work ([B-309], copyFolderRecursive): a
// hardlink is an equal NAME for the same content, not a reference to another
// file. Delete either name and the other keeps working; the bytes are freed
// when the last name goes. The filesystem does the refcounting, so there is no
// table of ours to keep correct and no in-use guard to write.
//
// ⚠️ ONLY SAFE BECAUSE NOTHING WRITES CONTENT IN PLACE. Sources are immutable,
// and every entry operation is a rename, an unlink, or a create-with-a-free-
// name. Writing through a shared name would reach into the vendor's copy. That
// invariant is the precondition for this whole approach — see
// test/entry-pointers.test.js, which exists so it fails rather than being
// remembered.
//
// ── THE INDEX IS A CACHE, NEVER A SOURCE OF TRUTH ───────────────────────────
// ⚠️⚠️ A stale index that reports a match would link to content that has since
// changed, and that is the one way to get a WRONG FILE silently — the worst
// outcome this code can produce, far worse than storing a duplicate. So the
// index NARROWS THE SEARCH; IT NEVER AUTHORISES THE LINK. Every candidate is
// re-hashed and proven to be what the index claims before anything points at
// it. A miss costs a copy: correct, only larger. A wrong link costs his audio.
//
// The index is built from data already on disk — the per-file manifests under
// soundFonts/.filehashes/ already hold every source and entry file with its
// sha256, so building it is reading, not re-hashing.
//
// ── THE POOL ────────────────────────────────────────────────────────────────
// Content that arrives WITHOUT a source (a wav added by hand, a customized
// version pulled off an SD card) needs a home that is not "whichever font
// happened to receive it first" — that answer is a false provenance, and it
// leaves nowhere to look for a sound you want to reuse. So added content lands
// in soundFonts/pool/ and the font gets a pointer, exactly as it gets a pointer
// into a source. One rule, no second category of file.
//
// ⚠️ THE POOL IS NOT A SOURCE, deliberately. Source immutability is load-
// bearing across the design: `hash` stays stable so dedup can rewrite what we
// hold while re-import recognition still works, and Customized diffs against a
// fixed reference point. A source that grew whenever a file was added would
// have no stable identity and its manifest would shift underneath every entry
// pointing at it.
//
// RETENTION IS ONE CONDITION, and the filesystem evaluates it: a pooled file is
// kept as long as at least one font points at it. The pool holds a name too, so
// "at least one user" is exactly `nlink >= 2`. A pooled file that falls to
// nlink 1 has only the pool holding it — zero users — and its name is dropped.
// An orphan IS nlink === 1, so it is detectable rather than bookkeeping we have
// to keep correct.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fileHash = require('./soundFontFileHash');

const POOL_INDEX_VERSION = 1;

function soundFontsRoot(userData) {
  return path.join(userData, 'soundFonts');
}

function poolRoot(userData) {
  return path.join(soundFontsRoot(userData), 'pool');
}

function ensurePoolRoot(userData) {
  const root = poolRoot(userData);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function _poolIndexPath(userData) {
  return path.join(poolRoot(userData), '.jmt-pool.json');
}

// Composite paths ("Grip/Proffie.zip/Proffie/boot.wav") name a file INSIDE an
// inner archive. They are records in a manifest but not files on disk, so they
// can never be a link target. Same exclusion _dedupeFolderSource makes.
function _isCompositePath(relPath) {
  return /\.zip\//i.test(String(relPath || ''));
}

// ── Pool index (hash -> stored filename) ────────────────────────────────────
// Mirrors soundFontSharedTracksHash's sidecar: lives inside the folder it
// describes, dot-prefixed so it never shows in a file listing, and rebuildable
// from the folder's contents if it is lost.
//
// Files are stored under their ORIGINAL NAME rather than under their hash. A
// folder of a3f9c1....wav is not something you can look through, and "there is
// somewhere to LOOK for a sound you want to reuse" is half of why the pool
// exists. The index carries the hash; the disk carries the name.

function _emptyPoolIndex() {
  return { version: POOL_INDEX_VERSION, files: {} };
}

function readPoolIndex(userData) {
  const p = _poolIndexPath(userData);
  if (!fs.existsSync(p)) return _emptyPoolIndex();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.files || typeof raw.files !== 'object') {
      return _emptyPoolIndex();
    }
    return raw;
  } catch {
    // Corrupt — return empty so ensurePoolIndex rebuilds from the folder. Don't
    // delete the bad file; the next write overwrites it.
    return _emptyPoolIndex();
  }
}

function writePoolIndex(userData, index) {
  ensurePoolRoot(userData);
  try {
    fs.writeFileSync(_poolIndexPath(userData), JSON.stringify(index, null, 2));
    return true;
  } catch { return false; }
}

// Idempotent reconcile against what is actually in the folder: hash anything on
// disk with no record, drop records whose file has gone. Cheap in the steady
// state — it only hashes files it has never seen.
function ensurePoolIndex(userData) {
  const root = poolRoot(userData);
  if (!fs.existsSync(root)) return _emptyPoolIndex();
  const index = readPoolIndex(userData);
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return index; }

  const onDisk = new Set();
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.startsWith('.')) continue; // our own sidecar
    onDisk.add(e.name);
  }

  const named = new Set();
  let mutated = false;
  for (const h of Object.keys(index.files)) {
    const rec = index.files[h];
    if (!rec || !rec.name || !onDisk.has(rec.name)) { delete index.files[h]; mutated = true; continue; }
    named.add(rec.name);
  }
  for (const name of onDisk) {
    if (named.has(name)) continue;
    const abs = path.join(root, name);
    let h = null;
    try { h = fileHash.hashFile(abs); } catch { h = null; }
    if (!h) continue;
    let size = 0;
    try { size = fs.statSync(abs).size; } catch {}
    index.files[h] = { name, size, addedAt: new Date().toISOString() };
    mutated = true;
  }
  if (mutated) writePoolIndex(userData, index);
  return index;
}

// A free name in the pool. A collision here means two DIFFERENT files share a
// name (identical content never reaches this point — it linked instead), so the
// suffix is disambiguation, not a Proffie variant. Uses the app's " (1)"
// convention rather than Proffie's "hum1.wav" numbering, because a pooled file
// is not a variant of anything and numbering it like one would read as a claim
// about the sound.
function _freePoolName(root, desired) {
  const safe = String(desired || 'sound.wav').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  if (!fs.existsSync(path.join(root, safe))) return safe;
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext);
  for (let n = 1; n < 10000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!fs.existsSync(path.join(root, candidate))) return candidate;
  }
  return `${stem} (${crypto.randomUUID().slice(0, 8)})${ext}`;
}

// ── The library-wide index ──────────────────────────────────────────────────
// Built per operation and held in memory, NOT persisted as a second store. The
// manifests under .filehashes already ARE this data; the index is only a
// reshaping of them (hash -> path instead of path -> hash). Persisting it would
// create a second copy to go stale, and a stale content index is exactly the
// failure this code must not have.
//
// One index is built at the start of an operation and threaded through every
// file it writes, so a 5,000-file import reads the manifests once — and so
// files written EARLIER in the same operation are available as link targets to
// files written later, which is what makes an internally-repetitive bundle land
// once rather than once per copy.

function _entryRootsByUuid(userData) {
  const out = new Map();
  const libRoot = path.join(soundFontsRoot(userData), 'library');
  let dirs;
  try { dirs = fs.readdirSync(libRoot, { withFileTypes: true }); }
  catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(libRoot, d.name);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      if (meta && meta.entryUuid) out.set(meta.entryUuid, dir);
    } catch { /* an entry without readable meta contributes nothing */ }
  }
  return out;
}

function _addManifestRecords(byHash, manifestPath, itemRoot) {
  const mf = fileHash.readFileHashManifest(manifestPath);
  if (!mf || !Array.isArray(mf.records)) return 0;
  let n = 0;
  for (const r of mf.records) {
    if (!r || !r.fileHash || r.fileHash === '<empty>') continue;
    if (_isCompositePath(r.relPath)) continue;
    const abs = path.join(itemRoot, r.relPath.replace(/\//g, path.sep));
    let list = byHash.get(r.fileHash);
    if (!list) { list = []; byHash.set(r.fileHash, list); }
    if (!list.includes(abs)) { list.push(abs); n++; }
  }
  return n;
}

// buildIndex(userData) -> Index
//
// Reads every per-file manifest plus the pool. Sources and entries are BOTH
// indexed even though post-[B-309] an entry's files are usually already
// hardlinks into its source: an entry can hold content no source has (an added
// file, a nested-zip extraction), and missing it would mean copying bytes we
// already hold. Duplicate rows pointing at one inode cost a map slot and
// nothing else.
function buildIndex(userData) {
  const byHash = new Map();
  const fhRoot = path.join(soundFontsRoot(userData), '.filehashes');

  const sourcesDir = path.join(fhRoot, 'sources');
  let sourceFiles = [];
  try { sourceFiles = fs.readdirSync(sourcesDir).filter(f => f.endsWith('.json')); } catch {}
  for (const f of sourceFiles) {
    const uuid = f.replace(/\.json$/, '');
    const root = path.join(soundFontsRoot(userData), 'sources', uuid, 'source');
    if (!fs.existsSync(root)) continue;
    _addManifestRecords(byHash, path.join(sourcesDir, f), root);
  }

  const entriesDir = path.join(fhRoot, 'entries');
  let entryFiles = [];
  try { entryFiles = fs.readdirSync(entriesDir).filter(f => f.endsWith('.json')); } catch {}
  if (entryFiles.length) {
    const roots = _entryRootsByUuid(userData);
    for (const f of entryFiles) {
      const uuid = f.replace(/\.json$/, '');
      const root = roots.get(uuid);
      if (!root) continue; // manifest for an entry that no longer exists
      _addManifestRecords(byHash, path.join(entriesDir, f), root);
    }
  }

  const pool = ensurePoolIndex(userData);
  const pRoot = poolRoot(userData);
  for (const h of Object.keys(pool.files)) {
    const rec = pool.files[h];
    if (!rec || !rec.name) continue;
    const abs = path.join(pRoot, rec.name);
    let list = byHash.get(h);
    if (!list) { list = []; byHash.set(h, list); }
    if (!list.includes(abs)) list.push(abs);
  }

  const index = {
    userData,
    byHash,
    // Paths proven this run to hold the content the index claims. Nothing
    // writes into a source or the pool during an operation, so one verification
    // holds for the rest of the run — which keeps a 5,000-file import from
    // re-reading the same canonical thousands of times.
    verified: new Map(),
    stats: { linked: 0, copied: 0, bytesSaved: 0, staleCandidates: 0 },
  };
  // Bound convenience methods so a caller threads ONE object through a walk
  // rather than the index plus the module. Same functions, same contracts.
  index.ingest = (opts) => ingestFile({ ...opts, index });
  index.store = (opts) => storeInPool({ ...opts, index });
  return index;
}

// findExisting(index, hash) -> absolute path we have PROVEN holds this content,
// or null. This is the only function that may return a link target, and it
// re-hashes before it does.
function findExisting(index, hash) {
  if (!index || !hash) return null;
  const already = index.verified.get(hash);
  if (already) {
    // Still there? A file can be deleted mid-operation by another path.
    if (fs.existsSync(already)) return already;
    index.verified.delete(hash);
  }
  const candidates = index.byHash.get(hash);
  if (!candidates || !candidates.length) return null;
  for (const abs of candidates) {
    let actual = null;
    try {
      if (!fs.existsSync(abs)) continue;
      const st = fs.statSync(abs);
      if (!st.isFile()) continue;
      actual = fileHash.hashFile(abs);
    } catch { actual = null; }
    if (actual === hash) {
      index.verified.set(hash, abs);
      return abs;
    }
    // The index claimed content this file no longer has. Drop the row so the
    // rest of the run does not pay to re-check it, and count it — a nonzero
    // number here means a manifest is behind its files, which is a real finding
    // even though the refusal itself is correct.
    index.stats.staleCandidates++;
    const list = index.byHash.get(hash);
    if (list) {
      const i = list.indexOf(abs);
      if (i >= 0) list.splice(i, 1);
    }
  }
  return null;
}

// Register content now present at absPath so later files in the same operation
// can link to it. Called after a genuine copy.
function recordContent(index, hash, absPath) {
  if (!index || !hash || !absPath) return;
  let list = index.byHash.get(hash);
  if (!list) { list = []; index.byHash.set(hash, list); }
  if (!list.includes(absPath)) list.push(absPath);
}

// ingestFile({ index, srcAbs, destAbs, allowLink? })
//
// THE ONE CALL every entry point makes. Puts the content of srcAbs at destAbs,
// as a hardlink to bytes we already hold when we hold them, and as a copy when
// we do not.
//
// ⚠️ THE INCOMING FILE IS HASHED HERE AND THE CALLER CANNOT SUPPLY THE ANSWER.
// This took a hash argument at first, as an optimisation for a caller that had
// already hashed the file. That is a way to lose someone's audio: hand it a
// hash that does not describe srcAbs, and if the library happens to hold THAT
// content the destination gets those bytes instead — a wrong file, reported as
// a success. The original test for it passed while the hazard was live, because
// it also tampered with the candidate, so the refusal came from the stale-row
// check rather than from anything defending this. Verified by probe, 2026-09-05.
// The read costs one pass over a file we were otherwise about to copy whole.
function ingestFile({ index, srcAbs, destAbs, allowLink = true }) {
  if (!srcAbs || !destAbs) return { ok: false, error: 'Missing path' };
  let size = 0;
  try {
    const st = fs.statSync(srcAbs);
    if (!st.isFile()) return { ok: false, error: 'Not a file' };
    size = st.size;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }

  let h = null;
  try { h = fileHash.hashFile(srcAbs); } catch { h = null; }

  try { fs.mkdirSync(path.dirname(destAbs), { recursive: true }); } catch {}

  if (allowLink && h && index) {
    const existing = findExisting(index, h);
    if (existing) {
      // Written under a temp name and renamed over the destination, so an
      // interruption leaves either nothing or the finished link — never a hole
      // where the file should be. Same shape as _dedupeFolderSource.
      const tmp = `${destAbs}.ingest-tmp`;
      try {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        fs.linkSync(existing, tmp);
        fs.renameSync(tmp, destAbs);
        if (index) {
          index.stats.linked++;
          index.stats.bytesSaved += size;
        }
        return { ok: true, linked: true, hash: h, size };
      } catch {
        // A filesystem that will not hardlink (a different volume, an
        // exFAT stick) is a reason to copy, never a reason to fail.
        try { fs.rmSync(tmp, { force: true }); } catch {}
      }
    }
  }

  try {
    fs.copyFileSync(srcAbs, destAbs);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  if (index) {
    index.stats.copied++;
    if (h) recordContent(index, h, destAbs);
  }
  return { ok: true, linked: false, hash: h, size };
}

// storeInPool({ index, srcAbs, preferredName })
//
// Give content a home in the library when it arrived without a source, and
// return the pooled path so the caller can link a font's name to it. If the
// content already exists anywhere in the library, THAT is returned and nothing
// new is written — a sound you add twice is one file, whichever door it came
// through.
//
// Returns { ok, absPath, hash, name, stored } where `stored: false` means the
// content was already held.
function storeInPool({ index, srcAbs, preferredName }) {
  if (!srcAbs) return { ok: false, error: 'Missing srcAbs' };
  let size = 0;
  try {
    const st = fs.statSync(srcAbs);
    if (!st.isFile()) return { ok: false, error: 'Not a file' };
    size = st.size;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }

  let h = null;
  try { h = fileHash.hashFile(srcAbs); } catch { h = null; }
  if (!h) return { ok: false, error: 'Hash failed' };

  const userData = index && index.userData;
  if (!userData) return { ok: false, error: 'Index has no userData' };

  const existing = findExisting(index, h);
  if (existing) {
    return { ok: true, absPath: existing, hash: h, name: path.basename(existing), stored: false };
  }

  const root = ensurePoolRoot(userData);
  const name = _freePoolName(root, preferredName || path.basename(srcAbs));
  const abs = path.join(root, name);
  try { fs.copyFileSync(srcAbs, abs); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }

  const pool = readPoolIndex(userData);
  pool.files[h] = { name, size, addedAt: new Date().toISOString() };
  writePoolIndex(userData, pool);
  recordContent(index, h, abs);
  return { ok: true, absPath: abs, hash: h, name, stored: true };
}

// releasePoolOrphans(userData)
//
// Drop pooled files nothing points at. The condition is the whole rule and the
// filesystem evaluates it: the pool holds one name, so a file with any user has
// nlink >= 2 and a file with none has nlink === 1.
//
// ⚠️ Called AFTER a font is deleted, never before — the link count only falls
// once the font's name is gone. deleteSource's refcounted unlinkAttachment
// carries the same ordering note for the same reason.
function releasePoolOrphans(userData) {
  const root = poolRoot(userData);
  if (!fs.existsSync(root)) return { removed: 0, freedBytes: 0 };
  const index = readPoolIndex(userData);
  let removed = 0, freedBytes = 0;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return { removed: 0, freedBytes: 0 }; }

  let mutated = false;
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const abs = path.join(root, e.name);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    // ⚠️ On a filesystem that did not support hardlinks every pooled file reads
    // as nlink 1 and this would delete the lot. Only act where the count is
    // meaningful: nlink 0 is impossible for an existing file, and anything
    // reporting < 1 is a filesystem we should not be reasoning about.
    if (typeof st.nlink !== 'number' || st.nlink < 1) continue;
    if (st.nlink >= 2) continue;
    try {
      fs.rmSync(abs, { force: true });
      removed++;
      freedBytes += st.size;
      for (const h of Object.keys(index.files)) {
        if (index.files[h] && index.files[h].name === e.name) { delete index.files[h]; mutated = true; }
      }
    } catch { /* leave it; an undeletable orphan costs space, not correctness */ }
  }
  if (mutated) writePoolIndex(userData, index);
  return { removed, freedBytes };
}

module.exports = {
  POOL_INDEX_VERSION,
  poolRoot,
  ensurePoolRoot,
  readPoolIndex,
  writePoolIndex,
  ensurePoolIndex,
  buildIndex,
  findExisting,
  recordContent,
  ingestFile,
  storeInPool,
  releasePoolOrphans,
};
