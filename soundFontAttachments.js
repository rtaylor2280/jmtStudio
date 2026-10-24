// Sound Fonts — source attachments (receipts / proof-of-purchase / notes).
//
// Design (2026-07-09): attachments live in ONE central, content-addressed
// store at userData/soundFonts/attachments/<sha256>/, NOT inside any source
// folder. Sources LINK to attachments by id in their meta (`attachments: []`).
// Consequences:
//   - The source content hash / signals never see attachments (they only walk
//     the source folder), so attachments can't corrupt dedup or backup identity.
//   - Content-addressing dedups automatically: the same receipt added to five
//     sources is stored once and linked five times.
//   - Reference count is derived (which sources link the id), so unlinking the
//     last reference garbage-collects the stored file.
// Attachments are metadata/proof, never font content: excluded from the SD
// export and the zip by construction (they're not in the source archive).

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function attachmentsRoot(userData) { return path.join(userData, 'soundFonts', 'attachments'); }
function sourcesRoot(userData) { return path.join(userData, 'soundFonts', 'sources'); }
function sourceMetaPath(userData, uuid) { return path.join(sourcesRoot(userData), uuid, 'meta.json'); }

function readSourceMeta(userData, uuid) {
  try { return JSON.parse(fs.readFileSync(sourceMetaPath(userData, uuid), 'utf8')); }
  catch { return null; }
}
function writeSourceMeta(userData, uuid, meta) {
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(sourceMetaPath(userData, uuid), JSON.stringify(meta, null, 2));
}

// [B-511] A source's own picture is stored here too, because the store sits outside every source
// folder and the source's fingerprint never sees it. It is linked by its own field, `picture`, and
// its attachment.json says `role: 'picture'`, so it is never listed or counted as proof of
// purchase. It is still a reference: every id a source holds is in linkedIds, and that is what
// garbage collection counts.
const PICTURE_RX = /\.(png|jpe?g|gif|webp|bmp)$/i;
function linkedIds(meta) {
  const ids = (meta && Array.isArray(meta.attachments)) ? meta.attachments.slice() : [];
  if (meta && meta.picture && !ids.includes(meta.picture)) ids.push(meta.picture);
  for (const id of curationPictureIds(meta)) if (!ids.includes(id)) ids.push(id);
  return ids;
}
// [B-536] The images a source export carried for the source's fonts, stored here on import and
// linked from the curation kept on the source, so they wait safely until the fonts are made.
function _curationPictureRecords(meta) {
  const cur = meta && meta.curation;
  if (!cur) return [];
  const out = Object.values(cur.entryPictures || {});
  for (const c of (cur.copies || [])) if (c && c.picture) out.push(c.picture);
  return out.filter(Boolean);
}
function curationPictureIds(meta) {
  return _curationPictureRecords(meta).map((r) => r.id).filter(Boolean);
}
// Store each carried font image from the unpacked payload (`attDir`) and record its id on the source.
function storeCurationPictures(userData, uuid, attDir) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta || !attDir) return 0;
  let stored = 0;
  for (const r of _curationPictureRecords(meta)) {
    if (r.id || !r.file) continue;
    const abs = path.join(attDir, ...String(r.file).split('/'));
    try { if (!fs.statSync(abs).isFile()) continue; r.id = storeFile(userData, abs, null, 'picture'); stored++; }
    catch { /* an image that cannot be stored must not fail the import */ }
  }
  if (stored) writeSourceMeta(userData, uuid, meta);
  return stored;
}
function isPictureAttachmentDir(dirAbs) {
  try { return JSON.parse(fs.readFileSync(path.join(dirAbs, 'attachment.json'), 'utf8')).role === 'picture'; }
  catch { return false; }
}

// "SMALL" WAS AN ASSUMPTION AND IT IS WRONG. [B-475, 2026-10-06]
// This comment used to read "Attachments are small (receipts, PDFs, screenshots), so buffer-hash
// is fine", and the whole freeze follows from that one word. The proof-of-purchase picker applies
// NO file-type filter at all (`properties: ['openFile']`, main.js) - it is an any-file door, not a
// document door - so a 600 dpi multi-page scan, a phone video or a whole order zip go through here
// exactly as a 40 KB receipt does.
// `readFileSync` pulls the ENTIRE file into memory on the MAIN process, and `storeFile` then
// calls `copyFileSync`, reading it a second time. Both synchronous, both in main, so every window
// freezes and Windows paints "Not Responding" - with no progress and no cancel.
// Kept rather than deleted because `storeFile` below is still the synchronous path for callers
// that have not been migrated. New work uses `storeFileStreaming`.
function hashFile(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

// ── The streaming store ───────────────────────────────────────── [B-475, 2026-10-06]
//
// ONE READ, NOT TWO, AND THE PROGRESS FALLS OUT OF IT. The old path read the file once to
// compute its content id and again to copy it. Streaming it hashes and writes in the same pass,
// so the second read disappears and the per-chunk callback IS the byte progress both doors need -
// produced as a side effect of the work rather than as extra work.
//
// STAGE THEN RENAME, because an attachment is stored UNDER its own hash and the destination is
// therefore unknown until the last byte. The staging folder lives inside the attachments root on
// purpose: same volume means the commit is a rename (one metadata write) rather than a copy.
// It is also what makes the cancel rule cheap - a cancel is one folder delete, and there is
// never a partial directory sitting in the store looking like a real attachment.
//
// THE PROGRAM-FILE REFUSAL STAYS AHEAD OF THE COMMIT. An attachment is REFUSED rather than
// stripped, because the file IS the one thing the user asked for - there is nothing left to store
// if it goes. Easy to lose in a restructure, so it is the first thing this function does.
//
// Returns { ok, id } · { ok:false, blocked:true, error } · { ok:false, cancelled:true }.
async function storeFileStreaming(userData, srcAbsPath, label, opts = {}) {
  const { onProgress, shouldStop, role } = opts;
  if (!srcAbsPath) return { ok: false, error: 'no file' };

  const v = require('./sdCardDetect').checkExecutableFile(srcAbsPath, path.basename(srcAbsPath));
  if (v.blocked) {
    return { ok: false, blocked: true,
      error: 'That file is a program rather than a document, so it was not attached. '
           + 'Attachments are for receipts, manuals and notes.' };
  }

  let total = 0;
  try { total = fs.statSync(srcAbsPath).size; } catch { total = 0; }

  const root = attachmentsRoot(userData);
  // STAGING LIVES OUTSIDE THE ATTACHMENTS ROOT, AND THE FIRST CUT GOT THIS WRONG.
  // It staged into `attachments/_staging/...`, and `listAllAttachments` enumerates that root and
  // hands every entry to `attachmentInfo` - whose missing-sidecar FALLBACK reads the directory and
  // returns the first file it finds as the attachment's name. So `_staging` would have surfaced in
  // the "Link existing proof of purchase" picker as a real, linkable attachment.
  // Sibling of the root rather than inside it: same volume, so the commit is still a rename,
  // and no reader that walks a content store can ever see it.
  const staging = path.join(userData, 'soundFonts', '_attach_staging',
                            `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const name = path.basename(srcAbsPath);
  const stagedFile = path.join(staging, name);
  fs.mkdirSync(staging, { recursive: true });

  const discard = () => { try { fs.rmSync(staging, { recursive: true, force: true }); } catch {} };

  let id;
  try {
    id = await new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      let done = 0;
      let stopped = false;
      const rs = fs.createReadStream(srcAbsPath, { highWaterMark: 1024 * 1024 });
      const ws = fs.createWriteStream(stagedFile);
      const fail = (err) => { try { rs.destroy(); } catch {} try { ws.destroy(); } catch {} reject(err); };
      rs.on('data', (chunk) => {
        // CHECKED PER CHUNK, which is what makes a cancel feel immediate on a slow card
        // instead of after the whole file. [B-398] taught that yielding is not stopping.
        if (typeof shouldStop === 'function' && shouldStop()) {
          stopped = true;
          try { rs.destroy(); } catch {}
          try { ws.destroy(); } catch {}
          const e = new Error('cancelled'); e.cancelled = true;
          return reject(e);
        }
        h.update(chunk);
        done += chunk.length;
        if (typeof onProgress === 'function') {
          try { onProgress({ bytes: done, total }); } catch {}
        }
      });
      rs.on('error', fail);
      ws.on('error', fail);
      // 'close', NOT 'finish', AND THE DIFFERENCE IS A HARD FAILURE ON WINDOWS.
      // 'finish' means the data reached the OS; the file descriptor is still open. Resolving
      // there meant the commit renamed a directory that still held an open handle, and Windows
      // refused it outright:
      //     EPERM: operation not permitted, rename '..._attach_staging\...' -> '...attachments\...'
      // Found by RUNNING the thing on a real 6 MB file. Nothing about the code reads as wrong,
      // and a source-scanning test would have passed it: every word of the implementation is
      // correct except which event means "done".
      ws.on('close', () => { if (!stopped) resolve(h.digest('hex')); });
      rs.pipe(ws);
    });
  } catch (err) {
    discard();
    if (err && err.cancelled) return { ok: false, cancelled: true };
    return { ok: false, error: String((err && err.message) || err) };
  }

  const dir = path.join(root, id);
  const jp = path.join(dir, 'attachment.json');
  try {
    if (fs.existsSync(dir)) {
      // Already stored - the content hash IS the identity, so the bytes we just staged are
      // byte-for-byte what is already there. Discard them and only refresh the label.
      // A re-attach still costs ONE full read, and that is the floor rather than a defect:
      // the id cannot be known without reading the file. One read is the floor; two was the bug.
      discard();
      if (label != null) {
        try {
          const info = JSON.parse(fs.readFileSync(jp, 'utf8'));
          info.label = label || '';
          fs.writeFileSync(jp, JSON.stringify(info, null, 2));
        } catch {}
      }
      return { ok: true, id, deduped: true };
    }
    let size = 0;
    try { size = fs.statSync(stagedFile).size; } catch {}
    fs.writeFileSync(path.join(staging, 'attachment.json'), JSON.stringify(
      { id, name, size, label: label || '', ...(role ? { role } : {}), addedAt: new Date().toISOString() }, null, 2));
    // THE RENAME IS THE COMMIT, and nothing before it is visible to the store. A reader
    // walking attachments/ sees either nothing or a complete attachment, never a half-copied one.
    // The root does not exist until a library's first attachment, and a rename cannot create it.
    fs.mkdirSync(root, { recursive: true });
    fs.renameSync(staging, dir);
    return { ok: true, id };
  } catch (err) {
    discard();
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// Staging survives a crash mid-copy, so it needs a sweep. Called at startup; a no-op on a
// healthy store. It deliberately removes EVERY staging folder rather than aging them out: a
// staging dir is only live for the duration of one copy inside one process, so anything found
// here at startup is by definition abandoned.
function sweepStaging(userData) {
  const stage = path.join(userData, 'soundFonts', '_attach_staging');
  let n = 0;
  try {
    for (const d of fs.readdirSync(stage)) {
      try { fs.rmSync(path.join(stage, d), { recursive: true, force: true }); n++; } catch {}
    }
  } catch { return { ok: true, swept: 0 }; }
  return { ok: true, swept: n };
}

// Store a file content-addressed; returns its id (sha256). Idempotent: identical
// bytes reuse the existing store dir, so nothing is duplicated on disk. An
// optional label is the user's display name for the attachment (chips show
// label || filename); passing one updates it even on an already-stored file.
// AN ATTACHMENT IS AN IMPORT ([B-214]). Files are attached straight off the
// same cards the fonts come from, so this door is as able to carry a program as
// the font importer is. Refused rather than stripped, because an attachment IS
// the one file the user asked for: there is nothing left to store if it goes.
// Returns { ok:false, blocked } so the caller can say which file and why.
function storeFile(userData, srcAbsPath, label, role) {
  // THROWS rather than returning a verdict, because this function RETURNS AN ID
  // and both callers assign it straight into one. An object here would land in the
  // attachment list as though it were an id. Both callers already sit in a try/catch,
  // and addAttachmentToSources turns the message into its own error string, so
  // throwing is what actually reaches the user.
  const _v = require('./sdCardDetect').checkExecutableFile(srcAbsPath, path.basename(srcAbsPath));
  // Its own wording, NOT the card path's. There the file arrived uninvited among sound
  // files; here the user picked it on purpose and the likely story is the wrong entry in
  // a file picker. So it names what they were trying to do rather than lecturing about
  // sound fonts, and it does not carry the card warning's weight.
  if (_v.blocked) throw new Error(
    'That file is a program rather than a document, so it was not attached. '
    + 'Attachments are for receipts, manuals and notes.');
  const id = hashFile(srcAbsPath);
  const dir = path.join(attachmentsRoot(userData), id);
  const jp = path.join(dir, 'attachment.json');
  if (!fs.existsSync(dir)) {
    const name = path.basename(srcAbsPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(srcAbsPath, path.join(dir, name));
    let size = 0; try { size = fs.statSync(path.join(dir, name)).size; } catch {}
    fs.writeFileSync(jp, JSON.stringify({ id, name, size, label: label || '', ...(role ? { role } : {}), addedAt: new Date().toISOString() }, null, 2));
  } else if (label != null) {
    try { const info = JSON.parse(fs.readFileSync(jp, 'utf8')); info.label = label || ''; fs.writeFileSync(jp, JSON.stringify(info, null, 2)); } catch {}
  }
  return id;
}

function attachmentInfo(userData, id) {
  const dir = path.join(attachmentsRoot(userData), id);
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'attachment.json'), 'utf8')); }
  catch {
    // Fallback if the sidecar is missing: use the single stored file.
    try {
      const name = fs.readdirSync(dir).find(f => f !== 'attachment.json');
      if (!name) return null;
      let size = 0; try { size = fs.statSync(path.join(dir, name)).size; } catch {}
      return { id, name, size };
    } catch { return null; }
  }
}

function attachmentFilePath(userData, id) {
  const info = attachmentInfo(userData, id);
  if (!info) return null;
  const p = path.join(attachmentsRoot(userData), id, info.name);
  return fs.existsSync(p) ? p : null;
}

// How many sources currently link this attachment (drives garbage collection).
function refCount(userData, id) {
  let n = 0;
  let dirs; try { dirs = fs.readdirSync(sourcesRoot(userData)); } catch { return 0; }
  for (const u of dirs) {
    const m = readSourceMeta(userData, u);
    if (m && linkedIds(m).includes(id)) n++;
  }
  return n;
}

// Store each file and link its id onto the source. Returns the source's
// resolved attachment list.
function addAttachments(userData, uuid, filePaths) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta) return { ok: false, error: 'source not found' };
  const ids = Array.isArray(meta.attachments) ? meta.attachments.slice() : [];
  const refused = []; // files declined on the way in ([B-214]), reported not swallowed
  for (const fp of (filePaths || [])) {
    try { const id = storeFile(userData, fp); if (!ids.includes(id)) ids.push(id); }
    catch (err) { refused.push({ name: path.basename(fp), reason: String((err && err.message) || err) }); }
  }
  meta.attachments = ids;
  writeSourceMeta(userData, uuid, meta);
  return { ok: true, attachments: listAttachments(userData, uuid), refused };
}

function listAttachments(userData, uuid) {
  const meta = readSourceMeta(userData, uuid);
  const ids = (meta && Array.isArray(meta.attachments)) ? meta.attachments : [];
  return ids.map(id => attachmentInfo(userData, id)).filter(Boolean);
}

// Remove the link from this source; GC the stored file when no source links it.
function unlinkAttachment(userData, uuid, id) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta) return { ok: false, error: 'source not found' };
  meta.attachments = (Array.isArray(meta.attachments) ? meta.attachments : []).filter(x => x !== id);
  writeSourceMeta(userData, uuid, meta);
  if (refCount(userData, id) === 0) {
    try { fs.rmSync(path.join(attachmentsRoot(userData), id), { recursive: true, force: true }); } catch {}
  }
  return { ok: true, attachments: listAttachments(userData, uuid) };
}

// Remove an attachment from EVERY source that links it, then delete the stored
// file. Used by the "remove from all sources" choice.
function removeAttachmentEverywhere(userData, id) {
  let dirs; try { dirs = fs.readdirSync(sourcesRoot(userData)); } catch { dirs = []; }
  for (const u of dirs) {
    const m = readSourceMeta(userData, u);
    if (m && Array.isArray(m.attachments) && m.attachments.includes(id)) {
      m.attachments = m.attachments.filter(x => x !== id);
      writeSourceMeta(userData, u, m);
    }
  }
  // The same bytes can also be some source's picture, which this does not remove.
  if (refCount(userData, id) === 0) {
    try { fs.rmSync(path.join(attachmentsRoot(userData), id), { recursive: true, force: true }); } catch {}
  }
  return { ok: true };
}

// Every attachment in the store (across all sources), each with a derived
// usedBy count. Powers the "link existing" picker so one receipt can be
// attached to many sources without re-picking the file from disk.
function listAllAttachments(userData) {
  let ids; try { ids = fs.readdirSync(attachmentsRoot(userData)); } catch { return []; }
  const out = [];
  for (const id of ids) {
    const info = attachmentInfo(userData, id);
    if (info && info.role !== 'picture') out.push({ ...info, usedBy: refCount(userData, id) });
  }
  return out;
}

// Link attachments that already exist in the store to a source, by id (no file
// copy). This is how the same proof-of-purchase backs multiple sources.
function linkAttachments(userData, uuid, ids) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta) return { ok: false, error: 'source not found' };
  const cur = Array.isArray(meta.attachments) ? meta.attachments.slice() : [];
  for (const id of (ids || [])) {
    if (fs.existsSync(path.join(attachmentsRoot(userData), id)) && !cur.includes(id)) cur.push(id);
  }
  meta.attachments = cur;
  writeSourceMeta(userData, uuid, meta);
  return { ok: true, attachments: listAttachments(userData, uuid) };
}

// Which sources currently link this attachment (uuids). Powers the fan-out
// picker's "already linked" pre-check.
function sourcesForAttachment(userData, id) {
  const out = [];
  let dirs; try { dirs = fs.readdirSync(sourcesRoot(userData)); } catch { return out; }
  for (const u of dirs) {
    const m = readSourceMeta(userData, u);
    if (m && Array.isArray(m.attachments) && m.attachments.includes(id)) out.push(u);
  }
  return out;
}

// Link one attachment to many sources at once (the inverse of linkAttachments).
// This is the "one receipt, five fonts I bought together" flow. Idempotent per
// source. Returns how many sources were newly linked.
function linkAttachmentToSources(userData, id, uuids) {
  if (!fs.existsSync(path.join(attachmentsRoot(userData), id))) return { ok: false, error: 'attachment not found' };
  let linked = 0;
  for (const uuid of (uuids || [])) {
    const meta = readSourceMeta(userData, uuid);
    if (!meta) continue;
    const cur = Array.isArray(meta.attachments) ? meta.attachments.slice() : [];
    if (!cur.includes(id)) { cur.push(id); meta.attachments = cur; writeSourceMeta(userData, uuid, meta); linked++; }
  }
  return { ok: true, linked };
}

// Import-style add: store one file (with an optional display label) and link it
// to every chosen source in one action. This is the "browse a receipt, name it,
// tick the fonts it covers" flow. Returns the new attachment id.
function addAttachmentToSources(userData, { filePath, label, uuids } = {}) {
  if (!filePath) return { ok: false, error: 'no file' };
  let id;
  try { id = storeFile(userData, filePath, label); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  linkAttachmentToSources(userData, id, uuids || []);
  return { ok: true, id };
}

// Read an attachment's bytes for in-app preview. Returns the raw Buffer so the
// renderer can build a Blob (image / PDF / text) without touching disk itself.
function readAttachment(userData, id) {
  const p = attachmentFilePath(userData, id);
  if (!p) return { ok: false, error: 'attachment not found' };
  const info = attachmentInfo(userData, id) || {};
  const bytes = fs.readFileSync(p);
  return { ok: true, id, name: info.name || path.basename(p), size: info.size || bytes.length, bytes };
}

// Drop links that point at nothing. A source's meta.json travels inside
// the source folder, so a backup taken before the attachment store was
// carried (anything before 2026-09-02) restores `attachments: [id]` with
// no file behind it. listAttachments already filters those out, so they
// are invisible rather than broken — but invisible junk still gets copied
// forward into every future backup and quietly widens the gap between
// what meta claims and what exists. Runs after a restore/merge, and is a
// no-op on a healthy library.
function pruneDanglingLinks(userData) {
  let dirs; try { dirs = fs.readdirSync(sourcesRoot(userData)); } catch { return { ok: true, pruned: 0, sources: 0 }; }
  let pruned = 0, touched = 0;
  for (const u of dirs) {
    const m = readSourceMeta(userData, u);
    if (!m) continue;
    const pictureGone = !!m.picture && !fs.existsSync(path.join(attachmentsRoot(userData), m.picture));
    const list = Array.isArray(m.attachments) ? m.attachments : [];
    const kept = list.filter(id => fs.existsSync(path.join(attachmentsRoot(userData), id)));
    if (kept.length === list.length && !pictureGone) continue;
    pruned += list.length - kept.length + (pictureGone ? 1 : 0);
    touched++;
    if (list.length) m.attachments = kept;
    if (pictureGone) delete m.picture;
    try { writeSourceMeta(userData, u, m); } catch {}
  }
  return { ok: true, pruned, sources: touched };
}

// A receipt goes with its source (ruled 2026-10-20: a deleted source's receipt is deleted). Deleting
// a source already releases what it held; this removes what NO source holds,
// which a restore brings in (a merge carries every attachment in the archive) and an older build
// left behind - a proof of purchase from 10-08 survived a wiped library this way. A source's own
// picture is a holder like any other link. Run after a restore and once at startup.
function pruneUnlinkedAttachments(userData) {
  let ids = [];
  try {
    ids = fs.readdirSync(attachmentsRoot(userData), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return { ok: true, removed: [] }; }
  const held = new Set();
  let dirs = [];
  try { dirs = fs.readdirSync(sourcesRoot(userData)); } catch {}
  for (const u of dirs) for (const id of linkedIds(readSourceMeta(userData, u))) held.add(id);
  const removed = [];
  for (const id of ids) {
    if (held.has(id)) continue;
    try { fs.rmSync(path.join(attachmentsRoot(userData), id), { recursive: true, force: true }); removed.push(id); } catch {}
  }
  return { ok: true, removed };
}

// ── The streaming twin of addAttachmentToSources ──────────────── [B-475, 2026-10-06]
// Same contract, same return shape, one read instead of two, and it can report progress and be
// cancelled.
async function addAttachmentToSourcesStreaming(userData, { filePath, label, uuids } = {}, opts = {}) {
  if (!filePath) return { ok: false, error: 'no file' };
  const r = await storeFileStreaming(userData, filePath, label, opts);
  if (!r.ok) return r;
  linkAttachmentToSources(userData, r.id, uuids || []);
  return { ok: true, id: r.id, deduped: !!r.deduped };
}

// [B-511] Set, replace or clear a source's own picture. The previous picture's bytes go when
// nothing else holds them, the same refcount rule as a proof of purchase.
function _releaseIfUnused(userData, id) {
  if (id && refCount(userData, id) === 0) {
    try { fs.rmSync(path.join(attachmentsRoot(userData), id), { recursive: true, force: true }); } catch {}
  }
}
async function setSourcePicture(userData, uuid, filePath) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta) return { ok: false, error: 'source not found' };
  if (!PICTURE_RX.test(String(filePath || ''))) {
    return { ok: false, error: 'That is not an image. Use a PNG, JPG, GIF, WebP or BMP file.' };
  }
  const r = await storeFileStreaming(userData, filePath, null, { role: 'picture' });
  if (!r.ok) return r;
  const prior = meta.picture;
  meta.picture = r.id;
  writeSourceMeta(userData, uuid, meta);
  if (prior && prior !== r.id) _releaseIfUnused(userData, prior);
  return { ok: true, id: r.id };
}
// The synchronous twin, for a caller that is synchronous itself: a source export's picture coming
// back on import. Pictures are small; the streaming store is for receipts of any size.
function setSourcePictureSync(userData, uuid, filePath) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta) return { ok: false, error: 'source not found' };
  if (!PICTURE_RX.test(String(filePath || ''))) return { ok: false, error: 'not an image' };
  let id;
  try { id = storeFile(userData, filePath, null, 'picture'); }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
  const prior = meta.picture;
  meta.picture = id;
  writeSourceMeta(userData, uuid, meta);
  if (prior && prior !== id) _releaseIfUnused(userData, prior);
  return { ok: true, id };
}
function clearSourcePicture(userData, uuid) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta) return { ok: false, error: 'source not found' };
  const prior = meta.picture;
  if (!prior) return { ok: true };
  delete meta.picture;
  writeSourceMeta(userData, uuid, meta);
  _releaseIfUnused(userData, prior);
  return { ok: true };
}
// The picture the user set on a source, as { id, name }, or null.
function sourcePicture(userData, uuid) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta || !meta.picture) return null;
  const info = attachmentInfo(userData, meta.picture);
  if (!info || !attachmentFilePath(userData, meta.picture)) return null;
  return { id: meta.picture, name: info.name };
}

module.exports = {
  readSourceMeta, writeSourceMeta,
  linkedIds, curationPictureIds, storeCurationPictures, isPictureAttachmentDir, setSourcePicture, setSourcePictureSync, clearSourcePicture, sourcePicture,
  pruneDanglingLinks, pruneUnlinkedAttachments, sweepStaging,
  addAttachments, listAttachments, attachmentFilePath, unlinkAttachment,
  listAllAttachments, linkAttachments, readAttachment,
  sourcesForAttachment, linkAttachmentToSources, addAttachmentToSources,
  storeFileStreaming, addAttachmentToSourcesStreaming,
  removeAttachmentEverywhere,
};
