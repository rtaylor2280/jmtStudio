// Sound Fonts — the curation sidecar. [B-283]
//
// THE PROBLEM: deleting a source cascades to its entries, and re-importing
// gets the FONTS back with none of the curation. Dates come back on their own
// (they derive from the archive's file date). What no heuristic can recover is
// the hand-authored part — the purchase link, the style-library link, the demo
// URL, the tags, a renamed entry. That is the part with the user's time in it.
//
// THE SHAPE (Ryan, 2026-09-02): one file at the ROOT of an exported zip. On a
// zip import it is stripped the moment it is seen, along with anything it
// points at, and the archive is repackaged BEFORE it is hashed. Everything
// downstream then runs exactly as it does today — no hash-exclusion threaded
// through the hasher, no second identity system.
//
// WHY REPACKAGING IS SAFE, and what it does and does not buy:
//   - It does NOT recover the vendor original's hash. The vendor zipped with
//     their settings and we zip with ours, so the bytes differ regardless.
//     That match was never achievable and is not lost here.
//   - It DOES make two JMT exports of the same source hash identically, because
//     zipFolderToFile is deterministic on purpose (sorted walk, statConcurrency
//     1). Export, curate differently, export again, strip both — same bytes.
//     That is the "I exported before deleting, now I'm bringing it back" case,
//     which is the whole reason this exists.
//
// THE COST IS GATED. A zip with no sidecar pays one root-entry listing and
// nothing else. Only an archive that actually carries curation pays the re-zip.
//
// PHASE 2, NOT HERE: carrying a MODIFIED library entry, where the user changed
// the actual files rather than the curation. Deliberately out of scope.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const StreamZip = require('node-stream-zip');

const SIDECAR_NAME = '.jmt-curation.json';
// Files the sidecar brings along (proofs of purchase) live under one root
// folder so the strip is a prefix test rather than a per-file lookup, and so a
// human opening the zip can see at a glance what is ours and what is the font.
const PAYLOAD_DIR = '.jmt-curation';
const SCHEMA_VERSION = 1;

// Source-level fields worth carrying. Deliberately NOT the derived ones:
// purchaseDate / acquisitionDate come from the archive's file date and restore
// themselves correctly, so shipping them would only create a chance to be wrong.
const SOURCE_FIELDS = ['bundleName', 'vendor', 'vendorWebsite', 'linkUrl', 'userNotes', 'purchased'];
// Entry-level fields, keyed by candidatePath — the only stable identifier an
// entry has across a delete and re-import. A name can be edited; the path the
// font occupies inside the archive cannot.
const ENTRY_FIELDS = ['name', 'tags', 'linkedStyleLibraryEntry', 'author', 'description', 'demoUrl', 'userNotes', 'purchased'];

function _pick(obj, fields) {
  const out = {};
  if (!obj) return out;
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[f] = v;
  }
  return out;
}

// Build the payload for a source: its own curated fields, one block per entry
// that came from it, and the attachments it links. Returns null when there is
// nothing worth carrying — an untouched source should not grow a sidecar,
// because that would change its exported bytes for no gain.
function buildForSource(userData, uuid, appVersion) {
  const sources = require('./soundFontSources');
  const entriesMod = require('./soundFontEntries');
  const attachMod = require('./soundFontAttachments');

  let sourceMeta = null;
  try {
    sourceMeta = JSON.parse(fs.readFileSync(
      path.join(userData, 'soundFonts', 'sources', uuid, 'meta.json'), 'utf8'));
  } catch { return null; }
  if (!sourceMeta) return null;

  const source = _pick(sourceMeta, SOURCE_FIELDS);
  // A vendor the app guessed is not curation — re-importing will guess it
  // again, and shipping it would let a stale guess outrank a fresh one.
  if (sourceMeta.vendorAutoDetected) { delete source.vendor; delete source.vendorWebsite; }

  const entries = {};
  let entryList = [];
  try { entryList = entriesMod.listEntries(userData) || []; } catch { entryList = []; }
  for (const e of entryList) {
    const m = e && e.meta;
    if (!m || m.sourceUuid !== uuid) continue;
    // ⚠️ '' IS A VALID candidatePath, not a missing one - a single-font source
    // puts its font at the archive ROOT, so the path is the empty string. The
    // first version tested `if (!key) continue`, which silently dropped the
    // entry curation for every single-font source, the most common kind. Only
    // null/undefined means "no path". (Found on a real export 2026-09-02: an
    // entry with tags and a demo URL produced "entries": {}.)
    const key = m.candidatePath;
    if (key == null) continue;
    const block = _pick(m, ENTRY_FIELDS);
    if (Object.keys(block).length === 0) continue;
    entries[key] = block;
  }

  const attachments = [];
  const ids = Array.isArray(sourceMeta.attachments) ? sourceMeta.attachments : [];
  for (const id of ids) {
    let abs = null;
    try { abs = attachMod.attachmentFilePath(userData, id); } catch { abs = null; }
    if (!abs) continue;
    let info = {};
    try { info = attachMod.listAttachments(userData, uuid).find(a => a.id === id) || {}; } catch {}
    const fileName = info.name || path.basename(abs);
    attachments.push({
      id,
      name: fileName,
      label: info.label || '',
      // Path inside the zip. Namespaced by id so two receipts with the same
      // filename cannot collide in the archive.
      file: `${PAYLOAD_DIR}/${id}/${fileName}`,
      _abs: abs,
    });
  }

  const hasSource = Object.keys(source).length > 0;
  const hasEntries = Object.keys(entries).length > 0;
  if (!hasSource && !hasEntries && attachments.length === 0) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    writtenBy: `JMT Studio${appVersion ? ' ' + appVersion : ''}`,
    writtenAt: new Date().toISOString(),
    sourceUuid: uuid,
    originalName: sourceMeta.originalName || '',
    source,
    entries,
    attachments,
  };
}

// Drop the sidecar (and its payload files) into a reconstructed tree, just
// before it is archived. The _abs keys are stripped on the way out so the
// written JSON carries no machine-specific paths.
function writeIntoTree(treeDir, payload) {
  if (!payload) return false;
  for (const a of (payload.attachments || [])) {
    if (!a._abs) continue;
    const dest = path.join(treeDir, ...a.file.split('/'));
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(a._abs, dest);
    } catch { /* a receipt that cannot be read must not fail the export */ }
  }
  const clean = {
    ...payload,
    attachments: (payload.attachments || []).map(({ _abs, ...rest }) => rest),
  };
  try {
    fs.writeFileSync(path.join(treeDir, SIDECAR_NAME), JSON.stringify(clean, null, 2));
    return true;
  } catch { return false; }
}

// Add the sidecar to a zip that has already been written. Done as a post-step
// on the finished export rather than inside the three exportToDownloads
// implementations, because they produce their archive three different ways (a
// pristine copyFile for zip sources, zipFolderToFile for folder sources, a
// reconstruct-then-zip for deduped ones) and only ONE of them has a temp tree
// to drop a file into. One function here covers all three.
//
// The pristine fast path stays pristine when there is nothing to carry: an
// uncurated source never reaches this, so its exported bytes are still the
// vendor's archive copied verbatim.
async function injectIntoZip(zipPath, payload, onProgress) {
  if (!payload) return { ok: true, injected: false };
  const sources = require('./soundFontSources');
  // ⚠️ THE WORKING TREE MUST LIVE BESIDE THE DESTINATION, NOT IN os.tmpdir().
  // The rebuilt archive is moved into place with renameSync, and rename CANNOT
  // cross volumes — it throws EXDEV. A user whose Desktop or Downloads is on a
  // different drive from the system temp (D:\Desktop with temp on C:, which is
  // exactly Ryan's machine) would hit that every single time. Staging in the
  // destination's own directory makes the move same-volume by construction.
  // Cost us a real 708 MB export on 2026-09-02. ([B-283])
  const tmpDir = fs.mkdtempSync(path.join(path.dirname(zipPath), '.jmt-curation-'));
  const treeDir = path.join(tmpDir, 'tree');
  fs.mkdirSync(treeDir, { recursive: true });
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
    const entries = await zip.entries();
    const keys = Object.keys(entries).filter(k => entries[k].name
      && entries[k].name !== '/' && !entries[k].isDirectory);
    let done = 0;
    for (const k of keys) {
      const rel = entries[k].name.replace(/\\/g, '/');
      const dest = path.resolve(treeDir, rel);
      if (!dest.startsWith(path.resolve(treeDir) + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await zip.extract(entries[k].name, dest);
      done++;
      if (onProgress) onProgress({ phase: 'curation-write', fileCount: done, totalFiles: keys.length });
    }
    await zip.close();
    zip = null;
    writeIntoTree(treeDir, payload);
    const outPath = path.join(tmpDir, 'out.zip');
    await sources.zipFolderToFile(treeDir, outPath, (p) => onProgress && onProgress({
      phase: 'curation-repack', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes, currentFile: p.currentFile,
    }));
    // ⚠️ ORDER IS LOad-BEARING: move the ORIGINAL aside first, put the rebuilt
    // one in place, and only then delete the original. The first version of this
    // deleted the destination BEFORE the rename and lost a 708 MB export when
    // the rename then failed. At no point may the destination path be empty
    // while the replacement is still only a hope.
    const backup = `${zipPath}.jmt-prev`;
    try { fs.rmSync(backup, { force: true }); } catch {}
    fs.renameSync(zipPath, backup);        // original safe, dest now free
    try {
      fs.renameSync(outPath, zipPath);     // same volume by construction
    } catch (err) {
      try { fs.renameSync(backup, zipPath); } catch {}  // put it back, exactly as it was
      throw err;
    }
    try { fs.rmSync(backup, { force: true }); } catch {}
    return { ok: true, injected: true };
  } catch (err) {
    // An export that succeeded must never be destroyed by a failure to decorate
    // it. Every path above either leaves the original in place or restores it.
    return { ok: false, injected: false, error: String(err && err.message || err) };
  } finally {
    if (zip) { try { await zip.close(); } catch {} }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// Is there a sidecar at the root of this zip? This is the check every ordinary
// import pays, so it reads the central directory and nothing else — no
// extraction, no hashing, no walk.
async function peekZip(zipPath) {
  let zip;
  try { zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true }); }
  catch { return null; }
  try {
    const entries = await zip.entries();
    if (!entries[SIDECAR_NAME]) return null;
    const buf = await zip.entryData(SIDECAR_NAME);
    const payload = JSON.parse(buf.toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    // A sidecar from a newer schema is data we cannot promise to read
    // correctly. Ignore it rather than half-apply it — the font still imports,
    // which is the important part.
    if (typeof payload.schemaVersion !== 'number' || payload.schemaVersion > SCHEMA_VERSION) return null;
    return payload;
  } catch { return null; }
  finally { try { await zip.close(); } catch {} }
}

// Extract everything EXCEPT the sidecar and the files it points at, then
// repackage. Returns { zipPath, tmpDir } — the caller owns tmpDir and must
// remove it. The repackaged archive is what gets hashed and stored, so the
// stored source is the font as the vendor shipped it, with our additions gone.
async function stripAndRepackage(zipPath, payload, onProgress) {
  const sources = require('./soundFontSources');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-curation-'));
  const treeDir = path.join(tmpDir, 'tree');
  fs.mkdirSync(treeDir, { recursive: true });
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
    const entries = await zip.entries();
    const keys = Object.keys(entries).filter((k) => {
      const e = entries[k];
      if (!e.name || e.name === '/' || e.isDirectory) return false;
      if (e.name === SIDECAR_NAME) return false;
      return true;
    });
    // Payload files (the receipts that rode along) are extracted OUT of the way
    // rather than discarded — they are the point of carrying them — but they do
    // not go into the tree that gets rehashed, so they cannot affect identity.
    const payloadDir = path.join(tmpDir, 'payload');
    let done = 0;
    for (const k of keys) {
      const rel = entries[k].name.replace(/\\/g, '/');
      const isPayload = rel === PAYLOAD_DIR || rel.startsWith(`${PAYLOAD_DIR}/`);
      const root = isPayload ? payloadDir : treeDir;
      const dest = path.resolve(root, rel);
      if (isPayload) {
        if (!dest.startsWith(path.resolve(payloadDir) + path.sep)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await zip.extract(entries[k].name, dest);
        continue;
      }
      // Zip-slip guard: an entry that resolves outside the tree is not ours.
      if (!dest.startsWith(path.resolve(treeDir) + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await zip.extract(entries[k].name, dest);
      done++;
      if (onProgress) onProgress({ phase: 'curation-strip', fileCount: done, totalFiles: keys.length });
    }
    await zip.close();
    zip = null;
    const outPath = path.join(tmpDir, path.basename(zipPath));
    await sources.zipFolderToFile(treeDir, outPath, (p) => onProgress && onProgress({
      phase: 'curation-repack', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes, currentFile: p.currentFile,
    }));
    try { fs.rmSync(treeDir, { recursive: true, force: true }); } catch {}
    return { zipPath: outPath, tmpDir, payloadDir };
  } catch (err) {
    if (zip) { try { await zip.close(); } catch {} }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

// Apply the source half after the import has landed: the curated fields, and
// the attachments the sidecar carried. Attachments are re-stored from the
// files that rode along inside the zip, which the caller extracted to attDir.
// Content-addressed, so a receipt already in the store is reused rather than
// duplicated.
function applySourceCuration(userData, uuid, payload, attDir) {
  if (!payload) return { ok: true, applied: 0, attachments: 0 };
  const sources = require('./soundFontSources');
  const attachMod = require('./soundFontAttachments');
  let applied = 0;
  const updates = _pick(payload.source, SOURCE_FIELDS);
  if (Object.keys(updates).length > 0) {
    try {
      const r = sources.updateSourceMeta(userData, uuid, updates);
      if (r && r.ok) applied = Object.keys(updates).length;
    } catch {}
  }
  let attached = 0;
  if (attDir) {
    for (const a of (payload.attachments || [])) {
      const abs = path.join(attDir, ...String(a.file || '').split('/'));
      if (!fs.existsSync(abs)) continue;
      try {
        const r = attachMod.addAttachmentToSources(userData, {
          filePath: abs, label: a.label || '', uuids: [uuid],
        });
        if (r && r.ok) attached++;
      } catch {}
    }
  }
  return { ok: true, applied, attachments: attached };
}

// The entry half. Returned as a metadata object for createEntry, which already
// takes one — so a re-imported font comes back with its tags, its style link
// and its demo URL without the review screen having to learn anything new.
function entryCurationFor(payload, candidatePath) {
  // Same rule as the writer: '' is the archive root and a legitimate key.
  if (!payload || !payload.entries || candidatePath == null) return null;
  const block = payload.entries[candidatePath];
  if (!block) return null;
  const out = _pick(block, ENTRY_FIELDS);
  // The name is the review's to decide — it is shown, edited and deduped
  // there. Handing it back as metadata would fight that.
  delete out.name;
  return Object.keys(out).length ? out : null;
}

// The suggested name for a candidate, separate from the metadata above so the
// review can OFFER it rather than have it applied behind the user.
function suggestedNameFor(payload, candidatePath) {
  if (!payload || !payload.entries || candidatePath == null) return null;
  const block = payload.entries[candidatePath];
  return (block && typeof block.name === 'string' && block.name.trim()) ? block.name : null;
}

module.exports = {
  SIDECAR_NAME, PAYLOAD_DIR, SCHEMA_VERSION,
  SOURCE_FIELDS, ENTRY_FIELDS,
  buildForSource, writeIntoTree, injectIntoZip, peekZip, stripAndRepackage,
  applySourceCuration, entryCurationFor, suggestedNameFor,
};
