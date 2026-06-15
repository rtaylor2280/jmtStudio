// Sound Fonts — library entry storage (Phase 1, slice 5).
//
// A "library entry" is a curated Proffie sound font extracted from one
// candidate inside a source. Entries live at userData/soundFonts/library/
// <name>/ with a meta.json that links back to the source by UUID. One source
// can produce many entries; each entry references exactly one source.
//
// Extraction handles two source-side shapes:
//   - Simple: candidate.path points at a folder inside the source; the
//     source's extractTo method copies the subtree directly.
//   - Nested: candidate.path points at an inner .zip inside the source
//     (Greyscale's Proffie.zip board flavor, Power_Of_Many's per-character
//     zips). We spool the inner zip to a temp file, open it, extract its
//     contents into the entry dir, and clean up temp.

const fs = require('fs');
const path = require('path');
const os = require('os');
const StreamZip = require('node-stream-zip');
const soundFontSources = require('./soundFontSources');

function entriesRoot(userData) {
  return path.join(userData, 'soundFonts', 'library');
}

function ensureEntriesRoot(userData) {
  const root = entriesRoot(userData);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function _readEntryMeta(entryDir) {
  try { return JSON.parse(fs.readFileSync(path.join(entryDir, 'meta.json'), 'utf8')); }
  catch { return null; }
}

function listEntries(userData) {
  const root = entriesRoot(userData);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = _readEntryMeta(path.join(root, entry.name));
    if (meta) out.push({ name: entry.name, meta });
  }
  return out;
}

function findEntryByName(userData, name) {
  if (!name) return null;
  const dir = path.join(entriesRoot(userData), name);
  if (!fs.existsSync(dir)) return null;
  const meta = _readEntryMeta(dir);
  return meta ? { name, meta } : null;
}

// Sanitize a user-supplied entry name to a Proffie-safe form. The entry
// folder name ends up on the saber's SD card and is referenced by name in
// the user's ProffieOS config presets, so it has to be more conservative
// than filesystem-safe: spaces become underscores (Proffie config syntax
// chokes on spaced font names), then characters disallowed by Windows /
// Linux / Mac filesystems are replaced, then length is capped.
function _sanitizeEntryName(name) {
  return String(name || '').trim()
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 200);
}

// Spool the bytes of an inner zip from a source to a temp file, open it,
// extract its contents to destDir. Used for the nested-zip candidate case
// (Greyscale Proffie.zip, Power_Of_Many's per-character zips).
async function _extractNestedZipToDir(source, innerZipPath, destDir, onProgress) {
  const buf = await source.readFile(innerZipPath);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-sf-nested-'));
  const tmpZip = path.join(tmpDir, 'nested.zip');
  try {
    await fs.promises.writeFile(tmpZip, buf);
    const zip = new StreamZip.async({ file: tmpZip, skipEntryNameValidation: true });
    try {
      const entryMap = await zip.entries();
      const destDirResolved = path.resolve(destDir);
      let fileCount = 0;
      let totalBytes = 0;
      const keys = Object.keys(entryMap).sort();
      // Wrapper-strip detection: if every meaningful entry inside the inner
      // zip shares a single top-level folder prefix (Greyscale's Proffie.zip
      // wraps everything under "Proffie/"), strip it so the extracted entry
      // dir has the real Proffie content at root.
      const meaningfulNames = keys
        .map(k => entryMap[k].name)
        .filter(n => n && n !== '/' && !/\/$/.test(n));
      const topLevels = new Set();
      for (const n of meaningfulNames) {
        const slash = n.indexOf('/');
        topLevels.add(slash === -1 ? n : n.slice(0, slash));
      }
      let stripPrefix = '';
      if (topLevels.size === 1) {
        const only = [...topLevels][0];
        // Confirm it's a folder (something lives under it).
        if (meaningfulNames.some(n => n.startsWith(only + '/'))) {
          stripPrefix = only + '/';
        }
      }
      for (const key of keys) {
        const e = entryMap[key];
        if (!e.name || e.name === '/' || e.isDirectory) continue;
        if (stripPrefix && !e.name.startsWith(stripPrefix)) continue;
        const relName = stripPrefix ? e.name.slice(stripPrefix.length) : e.name;
        if (!relName) continue;
        const destPath = path.join(destDir, relName.replace(/\//g, path.sep));
        const resolved = path.resolve(destPath);
        if (resolved !== destDirResolved && !resolved.startsWith(destDirResolved + path.sep)) {
          throw new Error(`Refused to extract outside destination: ${relName}`);
        }
        const parent = path.dirname(destPath);
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
        await new Promise((resolve, reject) => {
          zip.stream(e.name)
            .then(stream => {
              const writeStream = fs.createWriteStream(destPath);
              stream.on('error', reject);
              writeStream.on('error', reject);
              writeStream.on('finish', resolve);
              stream.pipe(writeStream);
            })
            .catch(reject);
        });
        fileCount++;
        totalBytes += e.size || 0;
        if (onProgress) onProgress({ fileCount, totalBytes, currentFile: relName });
      }
      return { fileCount, totalBytes };
    } finally {
      await zip.close();
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// createEntry({ userData, sourceUuid, candidate, name?, metadata?, onProgress? })
//
// Extracts the candidate from the source into a new library entry. The name
// defaults to the candidate's suggested name; the caller is expected to have
// run findEntryByName first if they want to surface a friendlier collision
// message than the generic "already exists" error.
//
// Returns one of:
//   { ok: true, name, meta }
//   { ok: false, error: <string>, existing?: true }
async function createEntry({ userData, sourceUuid, candidate, name, metadata, onProgress }) {
  if (!userData) return { ok: false, error: 'Missing userData' };
  if (!sourceUuid) return { ok: false, error: 'Missing sourceUuid' };
  if (!candidate) return { ok: false, error: 'Missing candidate' };

  const entryName = _sanitizeEntryName(name || candidate.name);
  if (!entryName) return { ok: false, error: 'Invalid entry name' };

  if (findEntryByName(userData, entryName)) {
    return { ok: false, error: `Entry already exists: ${entryName}`, existing: true };
  }

  const source = soundFontSources.openSource(userData, sourceUuid);
  if (!source) return { ok: false, error: `Source not found: ${sourceUuid}` };

  const root = ensureEntriesRoot(userData);
  const entryDir = path.join(root, entryName);

  const emit = (stage, payload) => {
    if (onProgress) onProgress({ stage, ...payload });
  };

  try {
    fs.mkdirSync(entryDir, { recursive: true });
    emit('extracting', { percent: 0 });

    let result;
    if (candidate.nested) {
      result = await _extractNestedZipToDir(source, candidate.path, entryDir, (p) => {
        emit('extracting', p);
      });
    } else {
      result = await source.extractTo(candidate.path || '', entryDir, (p) => {
        emit('extracting', p);
      });
    }

    // Tags array. When the caller supplies metadata.tags, that wins (the
    // renderer pre-resolves the user-edited bundle name and any other tags
    // and passes them through). Otherwise we fall back to the candidate's
    // detected bundle name so a backend-only entry creation still gets
    // sensibly seeded.
    let initialTags;
    if (metadata && Array.isArray(metadata.tags)) {
      initialTags = [];
      for (const t of metadata.tags) {
        const trimmed = String(t || '').trim();
        if (trimmed && !initialTags.includes(trimmed)) initialTags.push(trimmed);
      }
    } else if (candidate.bundleName) {
      initialTags = [candidate.bundleName];
    } else {
      initialTags = [];
    }
    const meta = {
      schemaVersion: 1,
      name: entryName,
      sourceUuid,
      candidatePath: candidate.path || '',
      multiBoard: !!candidate.multiBoard,
      otherFlavors: candidate.otherFlavors || [],
      nested: !!candidate.nested,
      tags: initialTags,
      linkedStyleLibraryEntry: (metadata && metadata.linkedStyleLibraryEntry) || null,
      purchased: !!(metadata && metadata.purchased),
      author: (metadata && metadata.author) || '',
      acquisitionDate: (metadata && metadata.acquisitionDate) || new Date().toISOString().slice(0, 10),
      description: (metadata && metadata.description) || '',
      userNotes: (metadata && metadata.userNotes) || '',
      addedFromSource: [],
      fileCount: result.fileCount,
      totalBytes: result.totalBytes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(entryDir, 'meta.json'), JSON.stringify(meta, null, 2));
    emit('done', { fileCount: result.fileCount, totalBytes: result.totalBytes });
    return { ok: true, name: entryName, meta };
  } catch (err) {
    // Cleanup partial entry so the library stays consistent.
    try { fs.rmSync(entryDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Duplicate an existing entry into a new entry of the given name.
//   mode === 'current': copy the source entry's directory verbatim
//     (current files + accumulated edits). Meta is copied too, then
//     name + timestamps + addedFromSource are patched.
//   mode === 'source':  re-extract from the original archive via the
//     source. Files come back exactly as the vendor shipped them
//     (any local additions/edits are NOT carried over). User-facing
//     meta fields (tags, author, description, link*, purchased, etc.)
//     are seeded from the source entry so the duplicate looks like a
//     sibling rather than a stranger.
async function duplicateEntry({ userData, sourceName, newName, mode = 'current' }) {
  if (!userData) return { ok: false, error: 'Missing userData' };
  if (!sourceName) return { ok: false, error: 'Missing sourceName' };
  if (!newName) return { ok: false, error: 'Missing newName' };
  const sanitized = _sanitizeEntryName(newName);
  if (!sanitized) return { ok: false, error: 'Invalid new name' };
  const root = ensureEntriesRoot(userData);
  const srcDir = path.join(root, sourceName);
  if (!fs.existsSync(srcDir)) return { ok: false, error: `Entry not found: ${sourceName}` };
  const destDir = path.join(root, sanitized);
  if (fs.existsSync(destDir)) {
    return { ok: false, error: `An entry named "${sanitized}" already exists`, existing: true };
  }
  const srcMeta = _readEntryMeta(srcDir);
  if (!srcMeta) return { ok: false, error: 'Source entry has no readable meta' };

  if (mode === 'current') {
    try {
      // Recursive disk copy. Two-pass approach keeps it simple and
      // safe: build the destination tree, copy each file. No symlink
      // handling — entry trees are plain files.
      const walkCopy = (sd, dd) => {
        fs.mkdirSync(dd, { recursive: true });
        for (const ent of fs.readdirSync(sd, { withFileTypes: true })) {
          const s = path.join(sd, ent.name);
          const d = path.join(dd, ent.name);
          if (ent.isDirectory()) walkCopy(s, d);
          else if (ent.isFile()) fs.copyFileSync(s, d);
        }
      };
      walkCopy(srcDir, destDir);
      // Patch meta: new identity, fresh timestamps, drop the
      // additions log since the duplicated tree IS the new baseline.
      const now = new Date().toISOString();
      const meta = { ...srcMeta };
      meta.name = sanitized;
      meta.createdAt = now;
      meta.updatedAt = now;
      meta.addedFromSource = [];
      fs.writeFileSync(path.join(destDir, 'meta.json'), JSON.stringify(meta, null, 2));
      return { ok: true, name: sanitized, meta };
    } catch (err) {
      try { fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  if (mode === 'source') {
    // Reconstruct a candidate descriptor from the source entry's meta
    // so createEntry can re-extract from the archive.
    const candidate = {
      path: srcMeta.candidatePath || '',
      name: sanitized,
      multiBoard: !!srcMeta.multiBoard,
      otherFlavors: srcMeta.otherFlavors || [],
      nested: !!srcMeta.nested,
      bundleName: undefined, // tags below carry whatever bundle name we had
    };
    // Seed user-facing fields from the source entry so the duplicate
    // looks like a sibling. Files are fresh from the archive.
    const metadata = {
      tags: Array.isArray(srcMeta.tags) ? srcMeta.tags.slice() : [],
      author: srcMeta.author || '',
      acquisitionDate: srcMeta.acquisitionDate || new Date().toISOString().slice(0, 10),
      description: srcMeta.description || '',
      userNotes: srcMeta.userNotes || '',
      purchased: !!srcMeta.purchased,
      linkedStyleLibraryEntry: srcMeta.linkedStyleLibraryEntry || null,
    };
    const r = await createEntry({
      userData,
      sourceUuid: srcMeta.sourceUuid,
      candidate,
      name: sanitized,
      metadata,
    });
    if (!r || !r.ok) return r || { ok: false, error: 'Duplicate from source failed' };
    // Propagate link fields if any were set on the source entry.
    if (srcMeta.linkUrl || srcMeta.linkLabel) {
      try {
        const newMetaPath = path.join(destDir, 'meta.json');
        const written = JSON.parse(fs.readFileSync(newMetaPath, 'utf8'));
        if (srcMeta.linkUrl)   written.linkUrl   = srcMeta.linkUrl;
        if (srcMeta.linkLabel) written.linkLabel = srcMeta.linkLabel;
        fs.writeFileSync(newMetaPath, JSON.stringify(written, null, 2));
      } catch {}
    }
    return r;
  }
  return { ok: false, error: `Unknown mode: ${mode}` };
}

// Patch fields on an entry's meta.json, optionally renaming the folder.
// Refuses to touch immutable fields (uuid linkage, candidatePath, createdAt,
// schemaVersion, etc.). When `newName` is supplied and differs from the
// current name, the entry folder is renamed on disk and the meta.name field
// is kept in sync. Rename collisions surface as an error.
const _ENTRY_META_IMMUTABLE = new Set([
  'schemaVersion', 'sourceUuid', 'candidatePath', 'multiBoard', 'otherFlavors',
  'nested', 'fileCount', 'totalBytes', 'createdAt',
]);
function updateEntryMeta({ userData, currentName, newName, updates }) {
  if (!userData) return { ok: false, error: 'Missing userData' };
  if (!currentName) return { ok: false, error: 'Missing currentName' };
  const sanitizedNew = newName != null ? _sanitizeEntryName(newName) : null;
  const isRename = sanitizedNew && sanitizedNew !== currentName;

  const root = entriesRoot(userData);
  const curDir = path.join(root, currentName);
  if (!fs.existsSync(curDir)) return { ok: false, error: `Entry not found: ${currentName}` };

  // Rename target collision check.
  if (isRename) {
    if (!sanitizedNew) return { ok: false, error: 'Invalid new name' };
    const newDir = path.join(root, sanitizedNew);
    if (fs.existsSync(newDir)) return { ok: false, error: `An entry named "${sanitizedNew}" already exists`, existing: true };
  }

  // Read current meta.
  const curMetaPath = path.join(curDir, 'meta.json');
  let meta;
  try { meta = JSON.parse(fs.readFileSync(curMetaPath, 'utf8')); }
  catch (err) { return { ok: false, error: `Cannot read meta: ${err.message}` }; }

  // Apply updates, skipping immutable fields.
  if (updates && typeof updates === 'object') {
    for (const key of Object.keys(updates)) {
      if (_ENTRY_META_IMMUTABLE.has(key)) continue;
      meta[key] = updates[key];
    }
  }

  // Apply rename if requested.
  let finalDir = curDir;
  let finalName = currentName;
  if (isRename) {
    const newDir = path.join(root, sanitizedNew);
    try {
      fs.renameSync(curDir, newDir);
      finalDir = newDir;
      finalName = sanitizedNew;
      meta.name = finalName;
    } catch (err) {
      return { ok: false, error: `Rename failed: ${err.message}` };
    }
  }
  meta.updatedAt = new Date().toISOString();

  try { fs.writeFileSync(path.join(finalDir, 'meta.json'), JSON.stringify(meta, null, 2)); }
  catch (err) { return { ok: false, error: `Cannot write meta: ${err.message}` }; }

  return { ok: true, name: finalName, meta };
}

// Remove an entry from disk. Used by the rename safety guard and by the
// source-delete cascade (Phase 3, slice 10) — deleting a source should also
// drop every entry that referenced it.
function deleteEntry(userData, name) {
  if (!name) return { ok: false, error: 'Missing name' };
  const dir = path.join(entriesRoot(userData), name);
  if (!fs.existsSync(dir)) return { ok: true, deleted: false };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true, deleted: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// List non-audio files that ship inside an entry's extracted font folder.
// Audio (.wav) is the font itself; everything else (readmes, .tg config,
// blade-style snippets, ini files) is surfaced as "included files" so the
// user can preview or save without spelunking the filesystem. Walks the
// entry folder recursively but skips the auto-generated meta.json.
function listEntryDocs(userData, name) {
  if (!name) return [];
  const dir = path.join(entriesRoot(userData), name);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (curDir, relBase) => {
    let entries;
    try { entries = fs.readdirSync(curDir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const abs = path.join(curDir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!e.isFile()) continue;
      if (rel === 'meta.json') continue;
      if (/\.wav$/i.test(e.name)) continue;
      let size = 0;
      try { size = fs.statSync(abs).size; } catch {}
      out.push({ fileName: rel, size });
    }
  };
  walk(dir, '');
  out.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return out;
}

// Read raw bytes of a single included file from an entry's folder. Path is
// validated to stay within the entry directory to defend against traversal.
function readEntryFileBytes(userData, name, subPath) {
  if (!name || !subPath) throw new Error('Missing name or subPath');
  const dir = path.join(entriesRoot(userData), name);
  if (!fs.existsSync(dir)) throw new Error(`Entry not found: ${name}`);
  const normalized = String(subPath).replace(/\\/g, '/');
  const target = path.resolve(dir, normalized);
  if (!target.startsWith(path.resolve(dir) + path.sep) && target !== path.resolve(dir)) {
    throw new Error('Path escapes entry folder');
  }
  if (!fs.existsSync(target)) throw new Error(`File not found: ${subPath}`);
  return fs.readFileSync(target);
}

// Copy one included file out to destDir (typically Downloads), collision-safe.
function exportEntryFileTo(userData, name, subPath, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const buf = readEntryFileBytes(userData, name, subPath);
  const baseName = String(subPath).split(/[\\/]/).pop() || `entry-${name}.bin`;
  // Mirror _uniqueDestPath from soundFontSources: bump " (1)", " (2)" until free.
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let candidate = baseName;
  let n = 1;
  while (fs.existsSync(path.join(destDir, candidate))) {
    candidate = `${stem} (${n})${ext}`;
    n++;
  }
  const destPath = path.join(destDir, candidate);
  fs.writeFileSync(destPath, buf);
  return { destPath };
}

// Check whether a font folder named after an entry already exists at the
// user-chosen destination. Used by the bulk-save flow to pre-scan for
// duplicates before kicking off any copies.
function entryFolderExistsAt(name, destDir) {
  if (!name || !destDir) return false;
  return fs.existsSync(path.join(destDir, name));
}

// Copy an entry's font files out to a user-chosen folder (typically an SD
// card root). Recreates the entry's directory tree under destDir/<name>/
// using the entry name as the on-disk folder name — matching how Proffie
// expects fonts laid out on the SD card. Skips meta.json since that's an
// internal artifact, not part of the font.
//
// mode controls duplicate handling:
//   'rename'  — if <name> exists, fall through to "<name> (1)", " (2)", ...
//   'skip'    — if <name> exists, do nothing and return ok with skipped=true
//   'replace' — if <name> exists, remove it first, then copy the new tree
// Defaults to 'rename' for backward compat with non-conflict callers.
//
// Returns { ok, destPath } on copy success, { ok, skipped: true } when the
// caller asked to skip an existing folder, or { ok: false, error } otherwise.
function exportEntryToFolder(userData, name, destDir, mode = 'rename') {
  if (!name) return { ok: false, error: 'Missing name' };
  if (!destDir) return { ok: false, error: 'Missing destDir' };
  const srcDir = path.join(entriesRoot(userData), name);
  if (!fs.existsSync(srcDir)) return { ok: false, error: `Entry not found: ${name}` };
  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); }
    catch (err) { return { ok: false, error: `Cannot create destination: ${err.message}` }; }
  }
  // Per-mode conflict handling. 'rename' suffixes; 'skip' bails; 'replace'
  // wipes the existing tree first so the new font goes in cleanly with no
  // leftover files from the previous version (which could leave a half-old
  // half-new Frankenfont in the directory otherwise).
  let targetName = name;
  const exists = fs.existsSync(path.join(destDir, targetName));
  if (exists) {
    if (mode === 'skip') {
      return { ok: true, skipped: true, destPath: path.join(destDir, targetName) };
    }
    if (mode === 'replace') {
      try { fs.rmSync(path.join(destDir, targetName), { recursive: true, force: true }); }
      catch (err) { return { ok: false, error: `Cannot remove existing folder: ${err.message}` }; }
    } else {
      // 'rename' (default) — fall through to "<name>_N" until free.
      // Underscore (not parens) so the resulting folder name is safe
      // for Proffie's font-folder matcher on the SD card destination.
      let n = 1;
      while (fs.existsSync(path.join(destDir, targetName))) {
        targetName = `${name}_${n}`;
        n++;
      }
    }
  }
  const targetDir = path.join(destDir, targetName);
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const walk = (curSrc, curDest) => {
      const items = fs.readdirSync(curSrc, { withFileTypes: true });
      for (const item of items) {
        // Skip the internal meta.json at the entry root — it's an app
        // artifact, not a font file. (Nested meta.json files inside font
        // subdirs are kept on the off chance a vendor shipped one.)
        if (curSrc === srcDir && item.name === 'meta.json') continue;
        const srcPath = path.join(curSrc, item.name);
        const destPath = path.join(curDest, item.name);
        if (item.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          walk(srcPath, destPath);
        } else if (item.isFile()) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };
    walk(srcDir, targetDir);
    return { ok: true, destPath: targetDir };
  } catch (err) {
    // Best-effort cleanup of a partial copy on failure so the user doesn't
    // end up with half a font folder mixed in with their other content.
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  }
}

// Return entries that reference a given source uuid. Used by the source
// detail view to list "entries from this source" and by the delete cascade
// to enumerate what's about to be removed.
function listEntriesBySourceUuid(userData, sourceUuid) {
  if (!sourceUuid) return [];
  return listEntries(userData).filter(e => e.meta && e.meta.sourceUuid === sourceUuid);
}

// Tree-shaped listing of every file inside an entry's on-disk folder.
// Mirrors soundFontCommon.listCommonFiles in shape so the renderer can
// share the same node shape. Excludes the entry-root meta.json since it
// is an app-internal record (tags, link, etc.) — not part of what would
// land on the SD card. Sort: directories first, then files, each
// alphabetical for stable display order.
function listEntryFiles(userData, name) {
  if (!name) return [];
  const root = path.join(entriesRoot(userData), name);
  if (!fs.existsSync(root)) return [];
  const walk = (dir, relBase) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }
    const out = [];
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      // Skip the per-entry meta.json at the entry root — internal record,
      // not user-visible content. Nested meta.json files (rare, e.g.
      // vendor-included sub-meta) still appear.
      if (!relBase && e.name === 'meta.json') continue;
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
      return a.name.localeCompare(b.name);
    });
    return out;
  };
  return walk(root, '');
}

module.exports = {
  entriesRoot,
  ensureEntriesRoot,
  listEntries,
  findEntryByName,
  createEntry,
  duplicateEntry,
  updateEntryMeta,
  deleteEntry,
  listEntriesBySourceUuid,
  listEntryDocs,
  readEntryFileBytes,
  exportEntryFileTo,
  exportEntryToFolder,
  entryFolderExistsAt,
  listEntryFiles,
};
