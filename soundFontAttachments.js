// Sound Fonts — source attachments (receipts / proof-of-purchase / notes).
//
// Design (Ryan, 2026-07-09): attachments live in ONE central, content-addressed
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

// Attachments are small (receipts, PDFs, screenshots), so buffer-hash is fine.
function hashFile(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

// Store a file content-addressed; returns its id (sha256). Idempotent: identical
// bytes reuse the existing store dir, so nothing is duplicated on disk.
function storeFile(userData, srcAbsPath) {
  const id = hashFile(srcAbsPath);
  const dir = path.join(attachmentsRoot(userData), id);
  if (!fs.existsSync(dir)) {
    const name = path.basename(srcAbsPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(srcAbsPath, path.join(dir, name));
    let size = 0; try { size = fs.statSync(path.join(dir, name)).size; } catch {}
    fs.writeFileSync(path.join(dir, 'attachment.json'),
      JSON.stringify({ id, name, size, addedAt: new Date().toISOString() }, null, 2));
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
    if (m && Array.isArray(m.attachments) && m.attachments.includes(id)) n++;
  }
  return n;
}

// Store each file and link its id onto the source. Returns the source's
// resolved attachment list.
function addAttachments(userData, uuid, filePaths) {
  const meta = readSourceMeta(userData, uuid);
  if (!meta) return { ok: false, error: 'source not found' };
  const ids = Array.isArray(meta.attachments) ? meta.attachments.slice() : [];
  for (const fp of (filePaths || [])) {
    try { const id = storeFile(userData, fp); if (!ids.includes(id)) ids.push(id); }
    catch { /* skip unreadable file */ }
  }
  meta.attachments = ids;
  writeSourceMeta(userData, uuid, meta);
  return { ok: true, attachments: listAttachments(userData, uuid) };
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

module.exports = { addAttachments, listAttachments, attachmentFilePath, unlinkAttachment };
