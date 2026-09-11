// Sound Fonts — Common folder storage layer.
//
// A "common folder" is a parallel pool of shared .wav files that Proffie
// configs reference via the ";common" suffix on a preset's font field
// (e.g. "Father;common" layers the common pool on top of the Father font).
// Configurations almost always use one. Power users with multiple sabers
// may keep several variants (different voice packs, different languages).
//
// Storage layout under userData/soundFonts/common/:
//   <uuid>/
//     meta.json   — { schemaVersion, uuid, name, createdAt, importedFrom }
//     files/      — the actual wav files (and any nested subfolders like
//                   clrlst/) that get copied to <SD card>/common/ on Save.
//
// The "active" common folder (the one Save will include, and the one the
// in-config in-use indicator reads from) is tracked at the prefs level
// rather than per-common-meta so switching is a single atomic flip.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const StreamZip = require('node-stream-zip');
const { copyTreeWithProgress } = require('./sfExportCopy');

function commonRoot(userData) {
  return path.join(userData, 'soundFonts', 'common');
}

function ensureCommonRoot(userData) {
  const root = commonRoot(userData);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function _readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); }
  catch { return null; }
}

// Recursively walk a directory and yield file stats. Used for size + count
// rollups so the side panel can show "N files (M MB)" per common.
function _walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch {}
        out.push({ abs, rel: path.relative(dir, abs).replace(/\\/g, '/'), size });
      }
    }
  }
  return out;
}

// List every common folder on disk with a rollup of file count + total bytes
// so the side panel can render meaningful per-row meta without each row
// having to re-walk its own files.
function listCommons(userData) {
  const root = commonRoot(userData);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const meta = _readMeta(dir);
    if (!meta) continue;
    const files = _walkFiles(path.join(dir, 'files'));
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    // mmain.wav is the Proffie-convention "main voice" — a common
    // folder that ships one is auditionable via a quick-play affordance
    // in the side panel. Cheap check: walk already happened, just look
    // for the relative path. Case-insensitive in case a maker shipped
    // MMain.wav or similar.
    const hasMmain = files.some(f => String(f.rel).toLowerCase() === 'mmain.wav');
    // The declared voice pack version, straight from this pack's own
    // voicepack.ini. null when there is no ini, which ProffieOS treats as
    // version 1 — so absence is a real answer, not missing data.
    const voicepackVersion = _readVoicePackVersion(path.join(dir, 'files'));
    out.push({ uuid: entry.name, meta, fileCount: files.length, totalBytes, hasMmain, voicepackVersion });
  }
  out.sort((a, b) => (a.meta.name || '').localeCompare(b.meta.name || ''));
  return out;
}

// Names are user-facing and must be unique (case-insensitive). Reserved
// against the existing set; null in `excludeUuid` lets a rename check skip
// itself when validating its own current name.
function nameInUse(userData, name, excludeUuid = null) {
  if (!name) return false;
  const lc = String(name).toLowerCase();
  for (const c of listCommons(userData)) {
    if (excludeUuid && c.uuid === excludeUuid) continue;
    if ((c.meta.name || '').toLowerCase() === lc) return true;
  }
  return false;
}

// Next free common-folder name using the app-wide `_N` convention. Same rule as
// the renderer's _jmtNumberedName, kept here because main-process callers cannot
// reach it: strip a trailing _N off the base, then take one above the highest _N
// already taken (never the first gap, so a name that was freed does not get
// silently reused).
//
// It exists because the voicepack installer had grown its OWN numbering - a
// " (2)" suffix - so the same library ended up holding `X (2)` from a download
// and `X_1` from a duplicate. One convention, one helper. OS Versions' "copy" is
// the only deliberate exception in the app. (2026-08-31, found in a dev pass.)
function nextNumberedName(userData, base) {
  const root = String(base || '').replace(/_\d+$/, '');
  if (!root) return '';
  if (!nameInUse(userData, root)) return root;
  const prefix = root.toLowerCase() + '_';
  let max = 0;
  for (const c of listCommons(userData)) {
    const nm = (c.meta.name || '').toLowerCase();
    if (!nm.startsWith(prefix)) continue;
    const rest = nm.slice(prefix.length);
    if (/^\d+$/.test(rest) && parseInt(rest, 10) > max) max = parseInt(rest, 10);
  }
  // Never mint _1 ([B-343], his rule): the ORIGINAL is implicitly number one,
  // so the first copy is _2. An existing higher _N still numbers above itself;
  // names already on disk are data and are not migrated.
  let n = Math.max(max + 1, 2);
  while (nameInUse(userData, `${root}_${n}`)) n++;
  return `${root}_${n}`;
}

// Recursive folder copy used by import + duplicate. Files only (no symlinks,
// no device files). Throws on first I/O error so the caller can clean up
// the partial destination tree before surfacing the failure.
function _copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(srcDir, e.name);
    const destPath = path.join(destDir, e.name);
    if (e.isDirectory()) _copyDirRecursive(srcPath, destPath);
    else if (e.isFile()) fs.copyFileSync(srcPath, destPath);
  }
}

// Best-effort cleanup of a partial common dir on import failure.
function _cleanupPartial(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Find a sub-path within a directory tree whose basename is "common"
// (case-insensitive). Returns the absolute path or null. Used to detect
// the typical voicepack shape where wavs live one level down inside a
// "common" folder wrapped by an outer name like "ProffieOS_Voicepack_English_A".
function _findCommonSubfolder(rootDir) {
  if (!fs.existsSync(rootDir)) return null;
  const stack = [rootDir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const abs = path.join(cur, e.name);
      if (e.name.toLowerCase() === 'common') return abs;
      stack.push(abs);
    }
  }
  return null;
}

// Check whether a directory has at least one .wav file (recursively).
// Used as the "is this worth wrapping as a common folder" signal when the
// user-picked source doesn't have a recognizable "common" subfolder.
function _hasAnyWav(dir) {
  const files = _walkFiles(dir);
  return files.some(f => /\.wav$/i.test(f.rel));
}

// Import a common folder from a folder on disk. If the picked folder
// contains a "common" subfolder anywhere inside, that subfolder's contents
// become the new common's files. Otherwise — as long as there's at least
// one .wav somewhere under the picked folder — the entire picked folder
// is wrapped as the common (so a user who points at a loose folder of
// wavs gets the right result).
//
// ── Human-readable marker ────────────────────────────────────────────────
// Once a common folder is exported it is just called "common", and nothing
// inside says WHICH voice pack it is: meta.json lives outside files/ and never
// ships, and voicepack.ini carries a version number but no name. So neither the
// user nor the app can tell Bane from HAL 9000 on a card without listening to it.
//
// A .txt is inert to ProffieOS: Effect::ScanAll bails immediately when
// IdentifyExtension() returns UNKNOWN (sound/effect.h), which is why
// voicepack.ini can already sit in there safely. Named after the pack so a plain
// directory listing answers the question without opening anything.
//
// Written at EXPORT, into the destination, never into the library copy. That was
// caught that on 2026-07-30 and he was right: storing it in files/ would pollute
// the content hash, go stale on every add/delete, and need a backfill. Generated
// fresh at export it is always true, and the library copy stays a pristine copy
// of the upstream pack. destDir is REQUIRED so that invariant is structural
// rather than a convention someone has to remember.
//
// IT MUST BE OBVIOUS WE WROTE THIS. The file lands beside NoSloppy's own
// a_ReadMe.txt and cover art, in the same naming style, and it talks ABOUT the
// pack — so without a clear byline a reader reasonably assumes it shipped with
// the pack, and anything wrong in it lands on him. Hence the JMT_ in the
// filename (the only part most people ever see) and the byline on line 2, above
// any fact that could be mistaken for the pack's own documentation.
//
// NOT printed: a content hash. Nothing reads it since the card compare moved to
// live hashing (2026-07-31), and the value we used to print was taken at the
// UUID dir, so its paths carry a "files/" prefix and it can NEVER be reproduced
// by hashing the folder the file sits in. Anyone trying to verify it would fail
// and conclude their card was corrupt. If a hash returns here it must be one
// computed the way commonMatchesAt computes it, so it is reproducible.
const _COMMON_README_MARK = 'Generated by JMT Studio';

function _appVersion() {
  try { return require('./package.json').version || ''; } catch { return ''; }
}
function _safeFileName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'common';
}
function _readVoicePackVersion(filesDir) {
  try {
    const ini = fs.readFileSync(path.join(filesDir, 'voicepack.ini'), 'utf8');
    const m = ini.match(/voice_pack_version\s*=\s*(\d+)/i);
    if (m) return m[1];
  } catch {}
  return null;
}
const _mb = (b) => (b / (1024 * 1024)).toFixed(1) + ' MB';

// The voicepack version on its own means nothing to a reader who does not
// already know the V1/V2 story — and that story is exactly what the forum keeps
// getting wrong. The qualifier is most useful in the case that actually hurts:
// a V1 pack on an OS8 prop is the failure the compile preflight exists to catch,
// and this puts the diagnosis on the card, where someone will find it while
// troubleshooting rather than having to already suspect it.
function _versionLine(ver) {
  if (ver === '2') return '2  (what ProffieOS 8 expects)';
  if (ver === '1') return '1  (ProffieOS 8 props usually require version 2)';
  return ver || 'not stated (no voicepack.ini)';
}

// Writes (or refreshes) the marker at `destDir` (the exported folder itself, not
// the destination root). Returns { ok, fileName } or { ok:false, error }.
function writeCommonReadme(userData, uuid, destDir) {
  // Required, not defaulted: the library copy must never gain a marker, and a
  // default that quietly pointed at files/ is the one mistake that would undo
  // the whole design.
  if (!destDir) return { ok: false, error: 'destDir is required' };
  const uuidDir  = path.join(commonRoot(userData), uuid);
  const filesDir = destDir;
  if (!fs.existsSync(filesDir)) return { ok: false, error: 'destination not found' };
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(uuidDir, 'meta.json'), 'utf8')); } catch {}
  const name = meta.name || uuid;
  // 'a_' prefix follows NoSloppy's existing convention (a_ReadMe.txt, a_<Character>.jpg
  // ship in 11 of the official V2 packs) so it sorts to the top of a directory
  // listing with the other metadata instead of scattering among the wavs. 'JMT_'
  // then separates ours from his at a glance, in the one place a reader always
  // looks. The pack name stays in the filename so a plain listing still answers
  // 'which pack is this' without opening anything.
  const fileName = `a_JMT_${_safeFileName(name)}.txt`;

  // A rename (or the older a_<Name>.txt filename) would otherwise leave a stale
  // marker behind. Detection is by BODY, never by filename, so old-format
  // markers migrate automatically on the next export. Only ever remove a file we
  // recognise as ours — never anything the user put here.
  try {
    for (const e of fs.readdirSync(filesDir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.txt') || e.name === fileName) continue;
      const body = fs.readFileSync(path.join(filesDir, e.name), 'utf8');
      if (body.includes(_COMMON_README_MARK)) fs.unlinkSync(path.join(filesDir, e.name));
    }
  } catch {}

  // Counted with the same marker-exclusion the card compare uses, so the two can
  // never disagree about what belongs to the pack.
  const { fileCount, totalBytes } = _dirSignals(filesDir, _excludeOurMarkers(filesDir));
  const ver = _readVoicePackVersion(filesDir);
  const av  = _appVersion();
  const folder = path.basename(filesDir) || 'common';
  const lines = [
    name,
    `${_COMMON_README_MARK}${av ? ' ' + av : ''}. This marker is not part of the voice pack.`,
    '',
    'Common folder (voice pack) for ProffieOS.',
    `Presets use it by adding ";${folder}" to their font path.`,
    '',
    `Voice pack version : ${_versionLine(ver)}`,
    `Files              : ${fileCount}  (${_mb(totalBytes)})`,
    `Written to card    : ${require('./localDate').localDateString()}`,
    '',
    'This file is ignored by ProffieOS. Deleting it is safe.',
  ];

  // The mark is what identifies this file as ours — for the cleanup above and,
  // more importantly, for the marker-subtraction in commonMatchesAt. A wording
  // edit that dropped it would make every exported card read as different from
  // the library forever after, silently. Fail loudly instead.
  const body = lines.join('\r\n') + '\r\n';
  if (!body.includes(_COMMON_README_MARK)) {
    return { ok: false, error: 'marker text no longer contains the identifying phrase' };
  }

  try {
    fs.writeFileSync(path.join(filesDir, fileName), body);
    return { ok: true, fileName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Source-backed common import ([B-327], 2026-09-07) ─────────────────────
// A common is the same two-layer pair a font is: an immutable SOURCE stored
// like any other import (dedup at the door, provenance, cross-linked against
// the library), with an editable working copy on top in common/<uuid>/files/.
// "Just because they get marked to live on the side car and use common folder
// controls, doesn't mean they have to be truly different than any other
// source." The working copy's files are hardlinks into the source tree, so a
// fresh common costs only what the library does not already hold.
//
// ⚠️ ORDER IS LOAD-BEARING ([B-334]): the source is deduped BEFORE the working
// copy links to it, so the links land on canonical names nothing rewrites.
//
// The shared body behind both routes. `sourcePath` is the picked folder OR the
// picked zip; importSource treats either as a source. Returns
// { ok, uuid, name, sourceUuid, savings } where savings carries what the
// close-out sentence needs (archiveBytes / contentBytes / crossLinked).
async function _importCommonAsSource(userData, sourcePath, name, onProgress) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: 'Source not found' };
  }
  const cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (nameInUse(userData, cleanName)) {
    return { ok: false, error: `A common folder named "${cleanName}" already exists` };
  }
  const S = require('./soundFontSources');
  // onProgress rides straight into importSource ([B-352]): the source
  // pipeline has emitted per-byte hashing/copying stages all along — this
  // caller just never asked, so a bulk common import ran with a dead bar.
  const imp = await S.importSource({
    userData, sourcePath, originalName: path.basename(sourcePath), metadata: {},
    onProgress: typeof onProgress === 'function' ? onProgress : undefined,
  });
  if (!imp || !imp.ok) return { ok: false, error: (imp && imp.error) || 'Source import failed' };
  const sourceUuid = imp.uuid;
  // A duplicate archive is not an error here: the same zip may already be in
  // the library (even as a font source). Commons and fonts sharing one source
  // is the point of the model - reuse it and only build the working copy.
  let dedupSaved = 0;
  if (!imp.isDuplicate) {
    // [B-334]: canonicalize the source BEFORE anything links to it.
    try {
      await S.ensureSourceManifest(userData, sourceUuid, () => {});
      const dd = await S.dedupeSource(userData, sourceUuid, () => {});
      if (dd && dd.deduped && dd.savedBytes) dedupSaved = dd.savedBytes;
    } catch {}
  }
  // Find the common content INSIDE the stored source tree (the same
  // common-subfolder detection the old import ran on the picked folder), and
  // require at least one wav, or this was never a sound asset import.
  const srcObj = S.openSource(userData, sourceUuid);
  if (!srcObj) return { ok: false, error: 'Stored source could not be opened' };
  const treeRoot = path.join(sourcesRoot_(userData), sourceUuid, 'source');
  const contentDir = _findCommonSubfolder(treeRoot) || treeRoot;
  if (!_hasAnyWav(contentDir)) {
    // A fresh source with no wavs is useless - reclaim it rather than leaving
    // an orphan for the sweep. A REUSED (duplicate) source is someone else's
    // and is left alone.
    if (!imp.isDuplicate) { try { S.deleteSource(userData, sourceUuid); } catch {} }
    return { ok: false, error: 'No .wav files found in the picked source' };
  }
  const subPath = path.relative(treeRoot, contentDir).replace(/\\/g, '/');
  ensureCommonRoot(userData);
  const uuid = crypto.randomUUID();
  const uuidDir = path.join(commonRoot(userData), uuid);
  const filesDir = path.join(uuidDir, 'files');
  try {
    fs.mkdirSync(filesDir, { recursive: true });
    // POINTERS, NOT A SECOND COPY: the working copy hardlinks into the
    // (already canonical) source tree. Rename or delete a name here and the
    // source keeps its own; edit paths replace files, never write in place,
    // so the pool is never written through.
    await srcObj.extractTo(subPath, filesDir, null, { link: true });
    const meta = {
      schemaVersion: 1,
      uuid,
      name: cleanName,
      createdAt: new Date().toISOString(),
      importedFrom: path.basename(sourcePath),
      // The tie that keeps the source alive: cleanupOrphanSources counts
      // common references the same way it counts library entries. ([B-327])
      sourceUuid,
      // Where in the source tree this working copy came from, so a future
      // compare/reset knows its baseline.
      sourceSubPath: subPath,
    };
    fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify(meta, null, 2));
    try { recomputeCommonContentHash(userData, uuid); } catch {}
    return {
      ok: true, uuid, name: cleanName, sourceUuid,
      // ⚠️ CARRY WHAT WAS REFUSED ([B-214], 2026-09-10). importSource already strips
      // programs and macro documents out of a common folder - that half always
      // worked - but this return read four fields off `imp` and not this one, so the
      // commons door removed files and said nothing. It was the last of the five
      // doors with a silent strip.
      blockedFiles: imp.blockedFiles || [],
      notedFiles: imp.notedFiles || [],
      savings: {
        archiveBytes: imp.archiveBytes || 0,
        contentBytes: imp.contentBytes || 0,
        crossLinked: imp.crossLinked || null,
        dedupSaved,
        reusedSource: !!imp.isDuplicate,
      },
    };
  } catch (err) {
    _cleanupPartial(uuidDir);
    return { ok: false, error: `Import failed: ${err.message}` };
  }
}
// The sources root without importing soundFontSources at module load (the two
// modules require each other lazily).
function sourcesRoot_(userData) {
  return path.join(userData, 'soundFonts', 'sources');
}

// Returns { ok: true, uuid, name } on success, { ok: false, error } on failure.
async function importCommonFromFolder(userData, folderPath, name, onProgress) {
  return await _importCommonAsSource(userData, folderPath, name, onProgress);
}

// Import a common folder from a zip file. The zip IS the source now - its
// bytes are the provenance identity, so no temp extraction happens outside
// the source pipeline.
async function importCommonFromZip(userData, zipPath, name) {
  return await _importCommonAsSource(userData, zipPath, name);
}

// Answer "do I already have this pack?" by CONTENT, not name. ([B-340])
// Every card names its common folder literally "common", so a name test made
// every later card's pack read as owned - and the bulk path then dropped a
// voicepack the user did not have. The digest compared here is
// hashItemDir(files) - exactly what the [B-327] manifests store as
// contentHash - so an incoming folder hashes once and existing commons are a
// manifest read. A dirty or missing manifest falls back to a live hash of
// that common's files, so an edited pack is never judged by stale rows.
// ── WHAT WOULD BE REFUSED, BEFORE ANYTHING IS IMPORTED ([B-214], 2026-09-10) ──
//
// Every other door warns BEFORE it acts: the card panel lists programs and makes
// you press "Import fonts anyway", and the font review shows what was refused with
// Cancel as the recommended button. The commons door imported first and reported
// afterwards, which is a different contract - a fait accompli instead of a choice.
// His call: "the other imports stop it from importing and check then import anyway...
// seems inconsistent."
//
// So this answers the question the dialog needs BEFORE the copy happens. The strip
// inside importSource is unchanged and still authoritative; this only decides what
// to say up front. Reads 256 bytes per file, same as every other check.
async function scanIncomingCommon(srcPath) {
  const out = { blocked: [], noted: [] };
  if (!srcPath || !fs.existsSync(srcPath)) return out;
  const { classifyFileBuffer } = require('./sdCardDetect');
  const take = (rel, buf) => {
    const v = classifyFileBuffer(buf, rel);
    if (v.kind === 'program' || v.kind === 'macro') {
      out.blocked.push({ relPath: rel, kind: v.kind, reason: v.reason,
        byContent: !!v.byContent, disguised: !!v.disguised });
    } else if (v.kind !== 'ok') {
      out.noted.push({ relPath: rel, kind: v.kind, reason: v.reason });
    }
  };
  const st = fs.statSync(srcPath);
  if (st.isDirectory()) {
    const walk = (dir, rel) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const abs = path.join(dir, e.name);
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) { walk(abs, r); continue; }
        if (!e.isFile()) continue;
        let buf = Buffer.alloc(0);
        try {
          const fd = fs.openSync(abs, 'r');
          try { const b = Buffer.alloc(256); const n = fs.readSync(fd, b, 0, 256, 0); buf = b.subarray(0, n); }
          finally { fs.closeSync(fd); }
        } catch { continue; }
        take(r, buf);
      }
    };
    walk(srcPath, '');
    return out;
  }
  // A picked .zip: read each entry's leading bytes without extracting the archive.
  const zip = new StreamZip.async({ file: srcPath });
  try {
    const entries = await zip.entries();
    for (const name of Object.keys(entries)) {
      const e = entries[name];
      if (e.isDirectory) continue;
      let buf = Buffer.alloc(0);
      try { const full = await zip.entryData(name); buf = full.subarray(0, 256); } catch { continue; }
      take(name, buf);
    }
  } finally { try { await zip.close(); } catch {} }
  return out;
}

function classifyIncomingCommon(userData, folderPath) {
  const out = { ownedByContent: false, matchName: null, nameTaken: false, contentHash: null };
  if (!folderPath || !fs.existsSync(folderPath)) return out;
  const fh = require('./soundFontFileHash');
  const contentDir = _findCommonSubfolder(folderPath) || folderPath;
  try { out.contentHash = fh.hashItemDir(contentDir); } catch { out.contentHash = null; }
  if (!out.contentHash) return out;
  for (const c of listCommons(userData)) {
    let digest = null;
    if (!(c.meta && c.meta.contentHashDirty)) {
      try {
        const mf = fh.readFileHashManifest(
          path.join(userData, 'soundFonts', '.filehashes', 'commons', `${c.uuid}.json`));
        digest = (mf && mf.contentHash) || null;
      } catch { digest = null; }
    }
    if (!digest) {
      try { digest = fh.hashItemDir(path.join(commonRoot(userData), c.uuid, 'files')); } catch { digest = null; }
    }
    if (digest && digest === out.contentHash) {
      out.ownedByContent = true;
      out.matchName = (c.meta && c.meta.name) || c.uuid;
      break;
    }
  }
  return out;
}

function getCommon(userData, uuid) {
  if (!uuid) return null;
  const dir = path.join(commonRoot(userData), uuid);
  const meta = _readMeta(dir);
  if (!meta) return null;
  const files = _walkFiles(path.join(dir, 'files'));
  return { uuid, meta, fileCount: files.length, totalBytes: files.reduce((s, f) => s + f.size, 0) };
}

// Group management. Each common folder optionally carries a `group`
// string in its meta.json — a free-form label used by the renderer
// to render commons in collapsible sections. Identity by name (not
// uuid) since groups are user-facing labels; renaming the group
// updates all member commons' meta.group field in place. Group order
// is a separate concern persisted as a renderer preference (see the
// SF settings keys); this module only owns the per-common membership.
function setCommonGroup(userData, uuid, groupName) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const clean = String(groupName || '').trim();
  const dir = path.join(commonRoot(userData), uuid);
  const metaPath = path.join(dir, 'meta.json');
  const meta = _readMeta(dir);
  if (!meta) return { ok: false, error: 'Common folder not found' };
  if (clean) meta.group = clean;
  else delete meta.group;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch (err) { return { ok: false, error: `Cannot write meta: ${err.message}` }; }
  return { ok: true };
}

// Apply a group label to many commons at once. Used by the "Group
// selected" multi-select action so a single backend call updates
// every member's meta in one pass.
function setCommonGroupMany(userData, uuids, groupName) {
  if (!Array.isArray(uuids) || uuids.length === 0) return { ok: false, error: 'No uuids provided' };
  for (const uuid of uuids) {
    const r = setCommonGroup(userData, uuid, groupName);
    if (!r.ok) return { ok: false, error: `Failed for ${uuid}: ${r.error}` };
  }
  return { ok: true, count: uuids.length };
}

// Rename a group across every common that has it. No-op if the new
// name is empty or matches the old name. Returns the number of
// commons that were updated.
function renameCommonGroup(userData, oldName, newName) {
  const oldClean = String(oldName || '').trim();
  const newClean = String(newName || '').trim();
  if (!oldClean) return { ok: false, error: 'Missing old group name' };
  if (!newClean) return { ok: false, error: 'New group name is required' };
  if (oldClean === newClean) return { ok: true, count: 0 };
  let updated = 0;
  for (const c of listCommons(userData)) {
    if ((c.meta.group || '') !== oldClean) continue;
    const r = setCommonGroup(userData, c.uuid, newClean);
    if (r.ok) updated++;
  }
  return { ok: true, count: updated };
}

// Delete a group — sets meta.group to empty on every member, leaving
// the commons themselves intact (they just become ungrouped).
function deleteCommonGroup(userData, groupName) {
  const clean = String(groupName || '').trim();
  if (!clean) return { ok: false, error: 'Missing group name' };
  let updated = 0;
  for (const c of listCommons(userData)) {
    if ((c.meta.group || '') !== clean) continue;
    const r = setCommonGroup(userData, c.uuid, '');
    if (r.ok) updated++;
  }
  return { ok: true, count: updated };
}

// Rename a common folder. Updates meta.json in place; the on-disk uuid
// directory is unchanged (uuid is the stable identifier; name is the
// user-facing label only). Validates the new name is non-empty and unique.
function renameCommon(userData, uuid, newName) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const cleanName = String(newName || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (nameInUse(userData, cleanName, uuid)) {
    return { ok: false, error: `A common folder named "${cleanName}" already exists` };
  }
  const dir = path.join(commonRoot(userData), uuid);
  const metaPath = path.join(dir, 'meta.json');
  const meta = _readMeta(dir);
  if (!meta) return { ok: false, error: 'Common folder not found' };
  meta.name = cleanName;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch (err) { return { ok: false, error: `Cannot write meta: ${err.message}` }; }
  return { ok: true };
}

// Duplicate a common folder. New uuid, new name (validated unique), same
// file contents copied byte-for-byte into the new dir's files/.
function duplicateCommon(userData, sourceUuid, newName) {
  if (!sourceUuid) return { ok: false, error: 'Missing source uuid' };
  const cleanName = String(newName || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (nameInUse(userData, cleanName)) {
    return { ok: false, error: `A common folder named "${cleanName}" already exists` };
  }
  const srcDir = path.join(commonRoot(userData), sourceUuid);
  if (!fs.existsSync(srcDir)) return { ok: false, error: 'Source common folder not found' };
  ensureCommonRoot(userData);
  const newUuid = crypto.randomUUID();
  const newDir = path.join(commonRoot(userData), newUuid);
  try {
    fs.mkdirSync(newDir, { recursive: true });
    // POINTERS, NOT A SECOND COPY ([B-327]): the duplicate's names hardlink
    // the original's files. Duplicating a 20 MB voicepack costs directory
    // entries; edits on either side replace files (never write in place), so
    // the two diverge safely from that moment.
    _linkOrCopyDirRecursive(path.join(srcDir, 'files'), path.join(newDir, 'files'));
    const sourceMeta = _readMeta(srcDir) || {};
    const meta = {
      schemaVersion: 1,
      uuid: newUuid,
      name: cleanName,
      createdAt: new Date().toISOString(),
      importedFrom: sourceMeta.name ? `Duplicate of ${sourceMeta.name}` : 'Duplicate',
      // The duplicate references the same immutable source as the original,
      // so the source survives whichever of the two is deleted first.
      ...(sourceMeta.sourceUuid ? { sourceUuid: sourceMeta.sourceUuid, sourceSubPath: sourceMeta.sourceSubPath } : {}),
    };
    fs.writeFileSync(path.join(newDir, 'meta.json'), JSON.stringify(meta, null, 2));
    try { recomputeCommonContentHash(userData, newUuid); } catch {}
    return { ok: true, uuid: newUuid, name: cleanName };
  } catch (err) {
    _cleanupPartial(newDir);
    return { ok: false, error: `Duplicate failed: ${err.message}` };
  }
}

// Link-first recursive copy: hardlink each file (same-volume, the normal
// case), fall back to a real copy when the filesystem refuses. Used by
// duplicateCommon; never writes through an existing name.
// Duplicating something ALREADY in the library, so the guard here is a backstop
// rather than the front door: anything imported since [B-214] was checked on the
// way in, but entries that predate it were not, and a duplicate should not spread
// a program file into a second copy.
function _linkOrCopyDirRecursive(srcDir, destDir, blocked, relBase) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    const rel = relBase ? relBase + '/' + e.name : e.name;
    if (e.isDirectory()) { _linkOrCopyDirRecursive(s, d, blocked, rel); continue; }
    if (!e.isFile()) continue;
    const v = require('./sdCardDetect').checkExecutableFile(s, rel);
    if (v.blocked) { if (blocked) blocked.push({ relPath: rel, reason: v.reason, byContent: !!v.byContent }); continue; }
    let linked = false;
    try { fs.linkSync(s, d); linked = true; } catch { linked = false; }
    if (!linked) fs.copyFileSync(s, d);
  }
}

function deleteCommon(userData, uuid) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const dir = path.join(commonRoot(userData), uuid);
  if (!fs.existsSync(dir)) return { ok: true, deleted: false };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    // The per-file manifest goes with it ([B-327]) - a manifest surviving its
    // common is the receipt-nobody-points-at mistake the source side already
    // fixed once. The SOURCE is deliberately left alone: cleanupOrphanSources
    // reclaims it on the next pass if nothing else references it.
    try { fs.rmSync(path.join(userData, 'soundFonts', '.filehashes', 'commons', `${uuid}.json`), { force: true }); } catch {}
    return { ok: true, deleted: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Proffie-style variant numbering for wav file collisions. The Proffie
// firmware reads multi-variant sound effects from <name>.wav,
// <name>2.wav, <name>3.wav... (no spaces, no parens, no underscore —
// just the digit appended directly). Use this helper everywhere a wav
// file might collide on copy/move/add inside a common (the destination
// SD layout depends on these names being Proffie-readable).
//
//   destDir   absolute dir we're writing into
//   srcName   the source file's basename (e.g. "boot.wav" or "boot2.wav")
//
// Tries the source name first (round-trip identity wins when free), then
// strips any trailing digits from the stem to find the "base," and walks
// 2, 3, 4... until a free slot opens up. So copying "boot.wav" into a
// dir already holding "boot.wav" yields "boot2.wav"; doing it again
// yields "boot3.wav"; copying an existing "boot5.wav" into the same dir
// yields "boot6.wav" (or whatever's next free).
function _proffieVariantName(destDir, srcName) {
  if (!fs.existsSync(path.join(destDir, srcName))) return srcName;
  const ext = path.extname(srcName);
  const stem = path.basename(srcName, ext);
  // Base = source stem with any trailing digits stripped. Used to scan
  // the destination for existing variants and infer the local convention.
  const baseMatch = stem.match(/^(.*?)(\d*)$/);
  const base = (baseMatch && baseMatch[1]) || stem;
  const srcPad = (baseMatch && baseMatch[2]) ? baseMatch[2].length : 0;
  // Scan dest for files matching <base>\d*<ext>. Each contributes its
  // digit-suffix length (padding seen locally) and value (max number
  // already used). The "1" slot is implicit when a bare <base><ext>
  // exists with no digits — Proffie's first variant slot.
  // Collect the DISTINCT padding lengths observed in the dest so we can
  // detect convention vs. ambiguity. The bare-base file (e.g., "boot.wav"
  // alongside "boot2.wav") doesn't contribute to padLens — it's the
  // implicit slot 1 in any convention.
  let maxNum = 0;
  const padLens = new Set();
  let entries;
  try { entries = fs.readdirSync(destDir); } catch { entries = []; }
  for (const file of entries) {
    if (path.extname(file) !== ext) continue;
    const fStem = path.basename(file, ext);
    if (fStem === base) { if (maxNum < 1) maxNum = 1; continue; }
    if (!fStem.startsWith(base)) continue;
    const rest = fStem.substring(base.length);
    if (!/^\d+$/.test(rest)) continue;
    const num = parseInt(rest, 10);
    if (num > maxNum) maxNum = num;
    padLens.add(rest.length);
  }
  let padLen;
  if (padLens.size === 0) padLen = srcPad;
  else if (padLens.size === 1) padLen = [...padLens][0];
  else padLen = 0; // Ambiguous mix → fall back to plain 1, 2, 3...
  let n = maxNum + 1;
  while (true) {
    const candidate = `${base}${String(n).padStart(padLen, '0')}${ext}`;
    if (!fs.existsSync(path.join(destDir, candidate))) return candidate;
    n++;
  }
}

// Validate a sub-path stays inside a common's files/ root. Defensive
// against any caller passing "../" sequences or absolute paths.
function _resolveFilesPath(userData, uuid, subPath) {
  const root = path.resolve(commonRoot(userData), uuid, 'files');
  const target = path.resolve(root, String(subPath || '').replace(/\\/g, '/'));
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('Path escapes common folder');
  }
  return target;
}

// Tree-shaped listing of one common's files/, used by the file browser UI.
// Returns { name, isDir, path, size, children? } recursively. Sort: dirs
// first, then files, each alphabetical.
function listCommonFiles(userData, uuid) {
  const root = path.join(commonRoot(userData), uuid, 'files');
  if (!fs.existsSync(root)) return [];
  const walk = (dir, relBase) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }
    const out = [];
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ name: e.name, isDir: true, path: rel, children: walk(abs, rel) });
      } else if (e.isFile()) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch {}
        out.push({ name: e.name, isDir: false, path: rel, size });
      }
    }
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      // Natural sort so numbered filenames land in human order.
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    return out;
  };
  return walk(root, '');
}

// Add one or more files into a common's files/ at the given subPath
// (default: root of files/). Files are copied; sources are left in place.
// Returns counts of added vs failed. Collisions are renamed with " (N)"
// suffix so an Add never silently overwrites an existing wav.
function addFilesToCommon(userData, uuid, subPath, sourceFilePaths) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  if (!Array.isArray(sourceFilePaths) || sourceFilePaths.length === 0) {
    return { ok: false, error: 'No source files provided' };
  }
  let destDir;
  try { destDir = _resolveFilesPath(userData, uuid, subPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const added = [];
  const failed = [];
  // One index for the whole batch ([B-327]): each added file lands as a link
  // when the library already holds its bytes (a wav shared with a font, or
  // with another common), and as a copy only when genuinely novel. ingestFile
  // writes via temp-name + rename, so nothing is ever written through an
  // existing name. The variant-rename collision rule is unchanged.
  let _idx = null;
  try { _idx = require('./soundFontContentIndex').buildIndex(userData); } catch { _idx = null; }
  for (const src of sourceFilePaths) {
    try {
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
        failed.push({ source: src, error: 'Not a file' });
        continue;
      }
      // ⚠️ THIS IS AN IMPORT DOOR ([B-214]). Common folders come off the same cards
      // the fonts do. Refused rather than stripped: the caller named this exact file,
      // so there is nothing left to add if it is dropped, and `failed` already reaches
      // the user with a per-file reason.
      const _v = require('./sdCardDetect').checkExecutableFile(src, path.basename(src));
      if (_v.blocked) { failed.push({ source: src, error: _v.reason }); continue; }
      const finalName = _proffieVariantName(destDir, path.basename(src));
      const dest = path.join(destDir, finalName);
      let done = false;
      if (_idx) {
        try { const r = _idx.ingest({ srcAbs: src, destAbs: dest }); done = !!(r && r.ok); } catch { done = false; }
      }
      if (!done) fs.copyFileSync(src, dest);
      added.push(path.basename(dest));
    } catch (err) {
      failed.push({ source: src, error: String(err && err.message || err) });
    }
  }
  if (added.length) {
    try { markCommonContentDirty(userData, uuid); } catch {}
  }
  return { ok: true, added, failed };
}

// Rename one file inside a common. Validates the new name doesn't collide
// with anything else in the same subfolder.
function renameCommonFile(userData, uuid, subPath, newName) {
  if (!uuid || !subPath) return { ok: false, error: 'Missing uuid or path' };
  const cleanName = String(newName || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (/[\\/]/.test(cleanName)) return { ok: false, error: 'Name cannot contain path separators' };
  let src, dest;
  try { src = _resolveFilesPath(userData, uuid, subPath); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(src)) return { ok: false, error: 'File not found' };
  dest = path.join(path.dirname(src), cleanName);
  if (fs.existsSync(dest)) return { ok: false, error: `A file named "${cleanName}" already exists here` };
  try {
    fs.renameSync(src, dest);
    try { markCommonContentDirty(userData, uuid); } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Delete one file (or empty folder) inside a common. Used by right-click
// from the file browser. Non-empty folders are intentionally rejected so
// the user has to clear them out deliberately rather than nuking a tree.
function deleteCommonFile(userData, uuid, subPath) {
  if (!uuid || !subPath) return { ok: false, error: 'Missing uuid or path' };
  let target;
  try { target = _resolveFilesPath(userData, uuid, subPath); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(target)) return { ok: false, error: 'Not found' };
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const contents = fs.readdirSync(target);
      if (contents.length > 0) {
        return { ok: false, error: 'Folder is not empty' };
      }
      fs.rmdirSync(target);
    } else {
      fs.unlinkSync(target);
    }
    try { markCommonContentDirty(userData, uuid); } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Create a new (empty) subfolder inside a common's files tree at the given
// parent path. Used by the "+ Folder" UI affordance. parentSubPath defaults
// to the files/ root when blank. Name validated for path separators and
// uniqueness within the parent.
function createCommonSubfolder(userData, uuid, parentSubPath, name) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const cleanName = String(name || '').trim();
  if (!cleanName) return { ok: false, error: 'Name is required' };
  if (/[\\/]/.test(cleanName)) return { ok: false, error: 'Name cannot contain path separators' };
  let parentDir;
  try { parentDir = _resolveFilesPath(userData, uuid, parentSubPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(parentDir)) {
    try { fs.mkdirSync(parentDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create parent: ${err.message}` }; }
  }
  const newDir = path.join(parentDir, cleanName);
  if (fs.existsSync(newDir)) {
    return { ok: false, error: `A folder named "${cleanName}" already exists here` };
  }
  try {
    fs.mkdirSync(newDir);
    const rel = path.join(parentSubPath || '', cleanName).replace(/\\/g, '/');
    try { markCommonContentDirty(userData, uuid); } catch {}
    return { ok: true, path: rel };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Copy one or more files between commons (or within the same common, into
// a different subpath). Collision-safe — destination names get " (N)"
// suffixed until free. Returns the list of paths actually written, scoped
// to the destination common's files/ root, so the caller can select the
// newly-pasted set in the UI. Failures are itemized.
function copyCommonFiles(userData, sourceUuid, sourcePaths, destUuid, destSubPath) {
  if (!sourceUuid || !destUuid) return { ok: false, error: 'Missing uuids' };
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return { ok: false, error: 'No source paths' };
  }
  let destDir;
  try { destDir = _resolveFilesPath(userData, destUuid, destSubPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const destFilesRoot = path.join(commonRoot(userData), destUuid, 'files');
  const added = [];
  const failed = [];
  for (const srcSubPath of sourcePaths) {
    try {
      let srcAbs;
      try { srcAbs = _resolveFilesPath(userData, sourceUuid, srcSubPath); }
      catch (err) { failed.push({ source: srcSubPath, error: err.message }); continue; }
      if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
        failed.push({ source: srcSubPath, error: 'Source file not found' });
        continue;
      }
      const finalName = _proffieVariantName(destDir, path.basename(srcAbs));
      const destPath = path.join(destDir, finalName);
      // Paste between commons is a new NAME, not new bytes ([B-327]): the
      // source of the copy is already a library file, so link it directly and
      // fall back to a real copy only when the filesystem refuses.
      let linked = false;
      try { fs.linkSync(srcAbs, destPath); linked = true; } catch { linked = false; }
      if (!linked) fs.copyFileSync(srcAbs, destPath);
      const rel = path.relative(destFilesRoot, destPath).replace(/\\/g, '/');
      added.push(rel);
    } catch (err) {
      failed.push({ source: srcSubPath, error: String(err && err.message || err) });
    }
  }
  if (added.length) {
    try { markCommonContentDirty(userData, destUuid); } catch {}
  }
  return { ok: true, added, failed };
}

// Move files within a single common into a different subPath. Used when the
// user drags files between folders of the same common — semantically a
// rename, not a copy, so the source is removed. No-op (skipped, not failed)
// when a file is already in the destination dir. Collision-safe — destination
// names get " (N)" suffixed when a different file with the same name already
// exists at the destination.
function moveCommonFiles(userData, uuid, sourcePaths, destSubPath) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    return { ok: false, error: 'No source paths' };
  }
  let destDir;
  try { destDir = _resolveFilesPath(userData, uuid, destSubPath || ''); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create dest: ${err.message}` }; }
  }
  const filesRoot = path.join(commonRoot(userData), uuid, 'files');
  const cleanDest = (destSubPath || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  const moved = [];
  const failed = [];
  let actuallyMoved = 0;
  for (const srcSubPath of sourcePaths) {
    try {
      let srcAbs;
      try { srcAbs = _resolveFilesPath(userData, uuid, srcSubPath); }
      catch (err) { failed.push({ source: srcSubPath, error: err.message }); continue; }
      if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isFile()) {
        failed.push({ source: srcSubPath, error: 'Source file not found' });
        continue;
      }
      // Already at destination — return the existing rel so the caller can
      // still select it, but don't actually move anything.
      const srcParts = srcSubPath.split('/'); srcParts.pop();
      const srcParent = srcParts.join('/');
      if (srcParent === cleanDest) {
        moved.push(srcSubPath);
        continue;
      }
      const finalName = _proffieVariantName(destDir, path.basename(srcAbs));
      const destPath = path.join(destDir, finalName);
      fs.renameSync(srcAbs, destPath);
      const rel = path.relative(filesRoot, destPath).replace(/\\/g, '/');
      moved.push(rel);
      actuallyMoved++;
    } catch (err) {
      failed.push({ source: srcSubPath, error: String(err && err.message || err) });
    }
  }
  if (actuallyMoved > 0) {
    try { markCommonContentDirty(userData, uuid); } catch {}
  }
  return { ok: true, moved, failed };
}

// Does a "common" folder already exist at this destination? Used by Save
// pre-scans so the conflict UI can include the common alongside font
// entries that would collide.
function commonFolderExistsAt(destDir, targetName = 'common') {
  if (!destDir) return false;
  try { return fs.existsSync(path.join(destDir, targetName || 'common')); }
  catch { return false; }
}

// Read the marker we wrote on a previous export, if the destination has one.
// Returns { name, version, fileName } or null.
//
// DISPLAY ONLY. This never decides whether a copy is skipped — see
// commonMatchesAt for why a file describing a filesystem we do not control
// cannot be trusted to suppress a question. What it is good for is NAMING what
// is on the card ("your card has Bane, your library has HAL 9000") and
// reporting the version a card is carrying, which is the useful fact when
// someone is troubleshooting a voice pack error.
//
// No contentHash: nothing reads it, and the value we used to write could not be
// reproduced by hashing the folder it sat in. A marker from an older build still
// parses fine here; its hash line is simply ignored.
function readCommonMarkerAt(destDir, targetName = 'common') {
  if (!destDir) return null;
  const dir = path.join(destDir, targetName || 'common');
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.txt')) continue;
    let body = '';
    try { body = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { continue; }
    if (!body.includes(_COMMON_README_MARK)) continue;
    // Leading digits only — the version line carries a plain-English qualifier
    // after the number ("2  (what ProffieOS 8 expects)").
    const version = (body.match(/^Voice pack version\s*:\s*(\d+)/mi) || [])[1] || null;
    const name = (body.split(/\r?\n/)[0] || '').trim() || null;
    return { name, version, fileName: e.name };
  }
  return null;
}

// ── Is the destination's copy the same content we hold? ──────────────────
// NEVER answered from the marker. The marker records what we wrote LAST time,
// not what is there NOW: anyone can delete a wav, drop a file in, or swap one
// by hand, and the marker would still recite the old hash. Trusting it means
// skipping the copy and leaving a card that genuinely differs, silently, while
// the user believes it is current. So the rule, and it generalises past this
// function: a cached claim about a filesystem we do not control may RAISE a
// question, never suppress one. Skipping requires reading the bytes.
// (2026-07-31 — found by deleting the marker, then sharpened to the real
// case: the folder can change underneath a marker that still looks current.)
//
// The marker's remaining job is to tell a HUMAN which pack this is, and to
// give the conflict prompt something concrete to say. Display, not decision.
//
// COMPARABLE ROOTS. The library's stored meta.contentHash is taken at the UUID
// dir, so its record paths are prefixed "files/" and can never equal a hash of
// a card's "common/" folder. Both sides are hashed at the roots that actually
// correspond: <uuid>/files and <destDir>/<targetName>.
//
// Markers are subtracted from BOTH sides, by DETECTION rather than by filename
// — the same rule writeCommonReadme's cleanup uses. Excluding only the name we
// are about to write would let a renamed pack's stale marker count as a real
// difference. Anything else at the destination (a hand-added wav, a text file
// that is not ours) correctly still counts as different.
function _isOurMarkerAt(absPath, name) {
  if (!name || !name.toLowerCase().endsWith('.txt')) return false;
  try { return fs.readFileSync(absPath, 'utf8').includes(_COMMON_README_MARK); }
  catch { return false; }
}

// filter(relPath) => truthy to INCLUDE, matching soundFontFileHash's contract.
// Only root-level .txt files can be ours; nested ones are real content.
function _excludeOurMarkers(root) {
  return (relPath) => {
    if (relPath.includes('/')) return true;
    return !_isOurMarkerAt(path.join(root, relPath), relPath);
  };
}

// Cheap signal: file count + total bytes under `root`, stat only, no reads.
// Mirrors the hash walk's exclusions (root meta.json, plus `excludeFn`) so the
// two can never disagree about what they are counting.
function _dirSignals(root, excludeFn) {
  let fileCount = 0, totalBytes = 0;
  const stack = [{ abs: root, rel: '' }];
  while (stack.length) {
    const { abs, rel } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (excludeFn && !excludeFn(childRel)) continue;
      if (e.isDirectory()) { stack.push({ abs: childAbs, rel: childRel }); continue; }
      if (!e.isFile()) continue;
      if (rel === '' && e.name === 'meta.json') continue; // hash walk skips it too
      fileCount++;
      try { totalBytes += fs.statSync(childAbs).size; } catch {}
    }
  }
  return { fileCount, totalBytes };
}

// Returns { ok, exists, identical, reason }.
//   exists    — the destination has the folder at all
//   identical — its content is byte-for-byte ours, markers subtracted
//   reason    — 'missing' | 'unreadable' | 'signals' | 'hash' | null
// The cheap signal is only sound as a NEGATIVE: differing counts or byte
// totals PROVE a difference (prompt, nothing read). Matching ones prove
// nothing, since a same-size swap defeats them, so they gate INTO the hash
// and never past it.
function commonMatchesAt(userData, uuid, destDir, targetName = 'common') {
  if (!uuid || !destDir) return { ok: false, error: 'Missing uuid or destDir' };
  const libDir  = path.join(commonRoot(userData), uuid, 'files');
  const cardDir = path.join(destDir, targetName || 'common');

  let cardExists = false;
  try { cardExists = fs.existsSync(cardDir) && fs.statSync(cardDir).isDirectory(); } catch {}
  if (!cardExists) return { ok: true, exists: false, identical: false, reason: 'missing' };
  if (!fs.existsSync(libDir)) return { ok: true, exists: true, identical: false, reason: 'unreadable' };

  const libFilter  = _excludeOurMarkers(libDir);
  const cardFilter = _excludeOurMarkers(cardDir);

  const mine  = _dirSignals(libDir, libFilter);
  const theirs = _dirSignals(cardDir, cardFilter);
  if (mine.fileCount !== theirs.fileCount || mine.totalBytes !== theirs.totalBytes) {
    return { ok: true, exists: true, identical: false, reason: 'signals' };
  }

  // Per file, over the LIBRARY's files only. Anything else on the card, recorded
  // or not, is none of this comparison's business. The destination manifest
  // supplies a hash per file; mtime says only whether the user invalidated it,
  // and an invalidated or missing entry costs one hash for that file alone.
  const { collectFileRecords, hashFile } = require('./soundFontFileHash');
  const libRecords = collectFileRecords(libDir, null, libFilter);
  if (!libRecords) return { ok: true, exists: true, identical: false, reason: 'unreadable' };

  const sync = require('./sfSyncManifest');
  const item = targetName || 'common';
  let cache = new Map();
  try { cache = sync.cacheFor(destDir, item); } catch {}
  const refreshed = new Map();
  let identical = true;

  for (const rec of libRecords) {
    if (!rec || rec.fileHash === '<empty>') continue;
    const abs = path.join(cardDir, rec.relPath);
    let st = null;
    try { st = fs.statSync(abs); } catch { st = null; }
    if (!st) { identical = false; continue; }
    const mtime = Math.round(st.mtimeMs);
    const ent = cache.get(rec.relPath);
    const valid = ent && ent[0] === st.size
      && Math.abs((ent[1] || 0) - mtime) <= sync.MTIME_TOLERANCE_MS;
    const destHash = valid ? ent[2] : hashFile(abs);
    refreshed.set(rec.relPath, [st.size, mtime, destHash]);
    if (destHash !== rec.fileHash) identical = false;
  }
  try { sync.mergeItem(destDir, item, refreshed); } catch {}
  return { ok: true, exists: true, identical, reason: identical ? null : 'hash' };
}

// Copy a common's files/ contents into destDir/<targetName>/. Mirrors
// soundFontEntries.exportEntryToFolder's mode semantics so the bulk Save
// flow can treat both uniformly. Target name is "common" by Proffie's SD
// convention; rename mode bumps to "common (N)" if collisions can't be
// avoided otherwise.
// Export a common OUT OF THE APP as a portable zip. A DIFFERENT VERB from
// exportCommonToFolder below, which puts a pack on an SD card - and the two were
// the same function until 2026-08-31, reached from a right-click that had nothing
// to do with cards. Three things were wrong with that: the pack's NAME was lost
// (the card path hardcodes `targetName = 'common'`, because that is what Proffie
// requires), a sync manifest was written into whatever folder the user picked,
// and the SD conflict dialog asked about replacing "the current common folder".
//
// THE SHAPE IS THE ONE THE PACKS ACTUALLY SHIP IN, verified 2026-08-31 against a
// real download (ProffieOS_V2_Voicepack_ChineseA.zip, 218 entries):
//     <Pack Name>.zip
//       └── common/
//             (the wavs)
// The pack's name lives in the FILENAME; there is no wrapper folder inside. An
// earlier version of this nested `<Pack>/common/` and the name read twice over -
// Ryan checked a real vendor zip and it does not do that.
// Two consequences worth keeping: unzipping hands you a `common/` folder that
// can go straight onto a card, and what we emit is indistinguishable from what
// people already receive. Our own importer takes either shape
// (_findCommonSubfolder searches for a `common` directory at any depth), so this
// round-trips: export it, hand it over, they import it and get the same pack.
//
// No manifest and no conflict prompt: nothing here is syncing with a card, and
// the destination is a single file the OS save dialog has already confirmed.
async function exportCommonAsZip(userData, uuid, destPath, onBytes = null) {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  if (!destPath) return { ok: false, error: 'Missing destPath' };
  const dir = path.join(commonRoot(userData), uuid);
  const srcDir = path.join(dir, 'files');
  if (!fs.existsSync(srcDir)) return { ok: false, error: `Common files not found: ${uuid}` };
  const meta = _readMeta(dir) || {};
  const packName = String(meta.name || 'common').trim() || 'common';

  const archiver = require('archiver');
  // Same atomic-write pattern as the backup writer: stream to a sibling
  // .partial and rename on success, so the user's chosen path is never a
  // half-written zip a sync agent can pick up.
  const partialPath = destPath + '.partial';
  return await new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let ws;
    try { ws = fs.createWriteStream(partialPath); }
    catch (err) { return done({ ok: false, error: `Cannot write: ${err.message}` }); }
    const archive = archiver('zip', { zlib: { level: 6 }, forceZip64: true });
    archive.on('error', (err) => {
      try { ws.destroy(); } catch {}
      try { fs.unlinkSync(partialPath); } catch {}
      done({ ok: false, error: `Export failed: ${err.message}` });
    });
    // Progress from archiver's own 'progress' event, NOT from 'data' chunks.
    // 'data' is COMPRESSED output, which cannot be measured against the pack's
    // known size on disk - the bar would run to some fraction of the total and
    // stop. `fs.processedBytes` is source bytes read, which is exactly what the
    // caller already knows the total of.
    if (onBytes) {
      let seen = 0;
      archive.on('progress', (p) => {
        const done = (p && p.fs && p.fs.processedBytes) || 0;
        if (done > seen) { const d = done - seen; seen = done; try { onBytes(d); } catch {} }
      });
    }
    ws.on('close', () => {
      if (settled) return;
      try { fs.renameSync(partialPath, destPath); }
      catch (err) {
        try { fs.unlinkSync(partialPath); } catch {}
        return done({ ok: false, error: `Cannot finalise: ${err.message}` });
      }
      done({ ok: true, path: destPath, name: packName });
    });
    archive.pipe(ws);
    archive.directory(srcDir, 'common');
    archive.finalize();
  });
}

// `targetName` is the folder to CREATE on the card. Its three siblings
// (commonFolderExistsAt, readCommonMarkerAt, commonMatchesAt) have taken this
// parameter all along; only the write hardcoded the name, so a config organised
// around "MC" was checked against MC and then written as common. [B-326]
async function exportCommonToFolder(userData, uuid, destDir, mode = 'rename', onBytes = null, targetName = 'common') {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const srcDir = path.join(commonRoot(userData), uuid, 'files');
  if (!fs.existsSync(srcDir)) return { ok: false, error: `Common files not found: ${uuid}` };
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create destination: ${err.message}` }; }
  }
  targetName = String(targetName || 'common').trim() || 'common';
  const exists = fs.existsSync(path.join(destDir, targetName));
  if (exists) {
    if (mode === 'skip') {
      return { ok: true, skipped: true, destPath: path.join(destDir, targetName) };
    }
    if (mode === 'replace') {
      try { fs.rmSync(path.join(destDir, targetName), { recursive: true, force: true }); }
      catch (err) { return { ok: false, error: `Cannot remove existing folder: ${err.message}` }; }
    } else {
      // Underscore (not parens) — folder names on SD ride the same
      // safety rule as font folders. The user-facing "rename" mode is
      // really staging, since Proffie only matches the literal "common"
      // folder; either way, _N is the safer suffix.
      // First suffix is _2 ([B-343]): the original is implicitly number one.
      let n = 2;
      while (fs.existsSync(path.join(destDir, targetName))) {
        targetName = `common_${n}`;
        n++;
      }
    }
  }
  const targetDir = path.join(destDir, targetName);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    // Streamed copy with write-paced byte progress. srcDir is the common's
    // `files/` subtree (its meta.json lives one level up, outside srcDir), so
    // there's nothing to skip here — every file ships.
    const _exportRefused = [];
    await copyTreeWithProgress(srcDir, targetDir, { onBytes, refused: _exportRefused });
    // Human-readable marker, written into the destination so the card can say
    // which voice pack it is carrying. Never written into the library copy.
    try { writeCommonReadme(userData, uuid, targetDir); } catch {}
    // Recorded AFTER the marker is written, so the signature includes it and a
    // later scan does not see the marker as an unexplained change.
    try {
      const { collectFileRecords } = require('./soundFontFileHash');
      const recs = collectFileRecords(srcDir);
      if (recs) {
        const observed = new Map();
        for (const r of recs) {
          if (!r || r.fileHash === '<empty>') continue;
          try {
            const st = fs.statSync(path.join(targetDir, r.relPath));
            observed.set(r.relPath, [st.size, Math.round(st.mtimeMs), r.fileHash]);
          } catch {}
        }
        require('./sfSyncManifest').mergeItem(destDir, targetName, observed);
      }
    } catch {}
    return { ok: true, destPath: targetDir };
  } catch (err) {
    // Best-effort cleanup of a partial copy so the user doesn't end up with
    // half a common folder mixed in with their other content.
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Read raw bytes of a single file inside a common's files/ tree. Used by
// the in-app text viewer (.txt/.md/.rtf/etc. that may live alongside wavs).
// Path is validated via _resolveFilesPath to stay inside files/.
function readCommonFileBytes(userData, uuid, subPath) {
  if (!uuid || !subPath) throw new Error('Missing uuid or subPath');
  const target = _resolveFilesPath(userData, uuid, subPath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`File not found: ${subPath}`);
  }
  return fs.readFileSync(target);
}

// Walk a common's tree to count files + sum bytes, excluding the
// root-level meta.json (matches the content hash's scope). Same shape
// as the entry-side helper; used both for stamping the content hash
// and for the cheap-signal safety check.
function _walkCommonContentSignals(commonDir) {
  let fileCount = 0;
  let totalBytes = 0;
  const walk = (absDir, relBase) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (!relBase && e.name === 'meta.json') continue;
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        walk(abs, relBase ? `${relBase}/${e.name}` : e.name);
      } else if (e.isFile()) {
        fileCount++;
        try { totalBytes += fs.statSync(abs).size; } catch {}
      }
    }
  };
  walk(commonDir, '');
  return { fileCount, totalBytes };
}

// Compute + persist the content hash for a common folder. Mirrors the
// entry-side helper exactly: hash the tree, walk the signals, write
// contentHash + contentFileCount + contentTotalBytes + contentHashedAt
// onto meta. Clears the dirty flag on success.
//
// Field naming: contentFileCount / contentTotalBytes are the canonical
// signal field names, shared with the sources + entries helpers so the
// persistent-hash contract is identical across all three buckets.
function recomputeCommonContentHash(userData, uuid) {
  if (!uuid) return null;
  const commonDir = path.join(commonRoot(userData), uuid);
  const metaPath = path.join(commonDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  const { hashItemDir } = require('./soundFontFileHash');
  const hash = hashItemDir(commonDir);
  if (!hash) return null;
  // Per-file manifest beside the sources' and entries' ([B-327]): this is what
  // lets buildIndex offer common content as link targets, so fonts and commons
  // pool against each other in both directions. Refreshed here because this
  // helper already runs at creation and whenever edits resolve their dirty
  // flag - the same lifecycle the tree hash rides. A stale row is safe:
  // findExisting re-hashes before ever handing out a link target.
  try {
    const fh = require('./soundFontFileHash');
    const recs = fh.collectFileRecords(path.join(commonDir, 'files')) || [];
    fh.writeFileHashManifest(
      path.join(userData, 'soundFonts', '.filehashes', 'commons', `${uuid}.json`), recs);
  } catch {}
  const { fileCount, totalBytes } = _walkCommonContentSignals(commonDir);
  meta.contentHash = hash;
  meta.contentFileCount = fileCount;
  meta.contentTotalBytes = totalBytes;
  meta.contentHashedAt = new Date().toISOString();
  meta.contentHashDirty = false;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
  return hash;
}

// Mark a common folder as content-modified — cheap meta.json write of
// one boolean. Set by every content-modifying op so the eventual
// rehash knows to recompute. Many ops collapse into one rehash.
function markCommonContentDirty(userData, uuid) {
  if (!uuid) return;
  const metaPath = path.join(commonRoot(userData), uuid, 'meta.json');
  if (!fs.existsSync(metaPath)) return;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return; }
  if (meta.contentHashDirty) return;
  meta.contentHashDirty = true;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
}

// Called from the renderer when a common-folder detail modal closes —
// triggers a batched rehash IF the common is flagged dirty. No-op
// otherwise.
function resolveCommonContentDirty(userData, uuid) {
  if (!uuid) return null;
  const metaPath = path.join(commonRoot(userData), uuid, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.contentHashDirty) return null;
  return recomputeCommonContentHash(userData, uuid);
}

// Trusted read of a common's content hash. Stored hash trusted when
// (a) meta.contentHashDirty is not set AND (b) the cheap-signal walk
// matches stored fileCount + totalBytes. Either failing forces a
// recompute. The dirty flag is the primary signal; the cheap-signal
// walk is the backup catch.
function getCommonContentHash(userData, uuid) {
  if (!uuid) return null;
  const commonDir = path.join(commonRoot(userData), uuid);
  const metaPath = path.join(commonDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.contentHashDirty
      && meta.contentHash
      && typeof meta.contentFileCount === 'number'
      && typeof meta.contentTotalBytes === 'number') {
    const live = _walkCommonContentSignals(commonDir);
    if (live.fileCount === meta.contentFileCount && live.totalBytes === meta.contentTotalBytes) {
      return meta.contentHash;
    }
  }
  return recomputeCommonContentHash(userData, uuid);
}

module.exports = {
  commonRoot,
  ensureCommonRoot,
  listCommons,
  getCommon,
  nameInUse,
  nextNumberedName,
  importCommonFromFolder,
  importCommonFromZip,
  classifyIncomingCommon,
  scanIncomingCommon,
  renameCommon,
  duplicateCommon,
  deleteCommon,
  setCommonGroup,
  setCommonGroupMany,
  renameCommonGroup,
  deleteCommonGroup,
  listCommonFiles,
  addFilesToCommon,
  renameCommonFile,
  deleteCommonFile,
  createCommonSubfolder,
  copyCommonFiles,
  moveCommonFiles,
  readCommonFileBytes,
  commonFolderExistsAt,
  exportCommonAsZip,
  exportCommonToFolder,
  writeCommonReadme,
  readCommonMarkerAt,
  commonMatchesAt,
  recomputeCommonContentHash,
  getCommonContentHash,
  markCommonContentDirty,
  resolveCommonContentDirty,
};
