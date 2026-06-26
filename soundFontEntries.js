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
const crypto = require('crypto');
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

// entryUuid backfill: every library entry needs a per-folder identity so
// the backup merge step can disambiguate duplicates (Sabine vs Sabine_KT
// that both came from the same source candidate). Entries created before
// entryUuid landed get a fresh uuid assigned on first read and persisted
// to disk so subsequent reads see the same value. The field is treated
// as immutable once written (see _ENTRY_META_IMMUTABLE below).
function _readEntryMeta(entryDir) {
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(entryDir, 'meta.json'), 'utf8')); }
  catch { return null; }
  if (meta && !meta.entryUuid) {
    meta.entryUuid = crypto.randomUUID();
    try { fs.writeFileSync(path.join(entryDir, 'meta.json'), JSON.stringify(meta, null, 2)); }
    catch {}
  }
  return meta;
}

function listEntries(userData) {
  const root = entriesRoot(userData);
  if (!fs.existsSync(root)) return [];
  const srcRoot = soundFontSources.sourcesRoot(userData);
  const sourceMetaCache = new Map();
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = _readEntryMeta(path.join(root, entry.name));
    if (!meta) continue;
    // Project source-level fields (vendor / vendorWebsite / purchased /
    // acquisitionDate) onto the returned entry meta. Source is the single
    // source of truth — any entry-level stored values are stale carryover
    // from before the refactor and get overwritten in the response.
    if (meta.sourceUuid) {
      let srcMeta = sourceMetaCache.get(meta.sourceUuid);
      if (srcMeta === undefined) {
        srcMeta = soundFontSources.readSourceMeta(path.join(srcRoot, meta.sourceUuid)) || null;
        sourceMetaCache.set(meta.sourceUuid, srcMeta);
      }
      if (srcMeta) _projectSourceFieldsOntoEntry(meta, srcMeta);
    }
    // hasTracks: surfaces in the preset sidecar's track picker so only
    // entries with a ProffieOS-conventional tracks/ subfolder appear in
    // the dropdown. A singular "track/" is a common typo the prop won't
    // see, so we don't count it.
    let hasTracks = false;
    try { hasTracks = fs.statSync(path.join(root, entry.name, 'tracks')).isDirectory(); }
    catch {}
    out.push({ name: entry.name, meta, hasTracks });
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
    // Description seeding for version-grouped imports. When the source
    // shipped multiple versions (versionGroupSiblings non-empty), seed
    // the description with the bare version string (e.g. "V2") so the
    // user has a visible indicator of which version this entry is —
    // useful when both V1 and V2 of the same bundle land in the library.
    // Skipped when:
    //   - user supplied an explicit description (their text wins)
    //   - solo path-versioned (Dark_Apprentice_V2.4 with no sibling) —
    //     there's no other version to distinguish from, the bundleName
    //     already carries the version visibly in the source title.
    let initialDescription = (metadata && metadata.description) || '';
    if (!initialDescription
        && candidate.takenVersion
        && Array.isArray(candidate.versionGroupSiblings)
        && candidate.versionGroupSiblings.length > 0) {
      initialDescription = candidate.takenVersion;
    }
    const meta = {
      schemaVersion: 1,
      entryUuid: crypto.randomUUID(),
      name: entryName,
      sourceUuid,
      candidatePath: candidate.path || '',
      multiBoard: !!candidate.multiBoard,
      otherFlavors: candidate.otherFlavors || [],
      nested: !!candidate.nested,
      // Version-group metadata from the candidate detector — captures
      // "this entry was V2 of a multi-version bundle, and the bundle
      // also contained V1 alternates" without forcing future surfaces
      // to re-run detection. Forward-looking; entries imported before
      // these fields were persisted carry null/false (no migration —
      // the detection backfill script under local/ handles those if
      // needed).
      takenVersion: candidate.takenVersion || null,
      preferredInVersionGroup: !!candidate.preferredInVersionGroup,
      alternateVersion: !!candidate.alternateVersion,
      preferredSiblingVersion: candidate.preferredSiblingVersion || null,
      versionGroupSiblings: Array.isArray(candidate.versionGroupSiblings)
        ? candidate.versionGroupSiblings
        : [],
      tags: initialTags,
      linkedStyleLibraryEntry: (metadata && metadata.linkedStyleLibraryEntry) || null,
      purchased: !!(metadata && metadata.purchased),
      author: (metadata && metadata.author) || '',
      acquisitionDate: (metadata && metadata.acquisitionDate)
        || (source.meta && source.meta.sourceFileDate)
        || (source.meta && source.meta.importedAt && source.meta.importedAt.slice(0, 10))
        || new Date().toISOString().slice(0, 10),
      description: initialDescription,
      demoUrl: (metadata && metadata.demoUrl) || '',
      userNotes: (metadata && metadata.userNotes) || '',
      addedFromSource: [],
      contentFileCount: result.fileCount,
      contentTotalBytes: result.totalBytes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(entryDir, 'meta.json'), JSON.stringify(meta, null, 2));

    // Stamp the content hash at creation so future surveyMerge /
    // exportBackup calls can skip the per-item tree walk and read the
    // stored value directly. Lazy backfill in getEntryContentHash
    // catches any entries that pre-date this slice.
    try { recomputeEntryContentHash(userData, entryName); } catch {}

    // Propagate source-level fields to source meta if the source is
    // missing them. Keeps freshly-imported sources consistent with the
    // single-source-of-truth design without waiting for the next
    // migration pass. Vendor + website are typically already on source
    // (set during import-time detection); purchased + acquisitionDate
    // historically lived only on entries and need this push.
    try {
      const srcMetaCur = soundFontSources.readSourceMeta(path.join(soundFontSources.sourcesRoot(userData), sourceUuid));
      if (srcMetaCur) {
        const srcUpdates = {};
        if (srcMetaCur.purchased == null) srcUpdates.purchased = meta.purchased;
        if (!srcMetaCur.acquisitionDate && meta.acquisitionDate) srcUpdates.acquisitionDate = meta.acquisitionDate;
        if (!srcMetaCur.vendor && meta.author) srcUpdates.vendor = meta.author;
        if (Object.keys(srcUpdates).length > 0) {
          soundFontSources.updateSourceMeta(userData, sourceUuid, srcUpdates);
        }
      }
    } catch {}

    // Re-project the (possibly just-updated) source values onto the
    // returned meta so the caller sees canonical post-write state.
    try {
      const srcMetaPost = soundFontSources.readSourceMeta(path.join(soundFontSources.sourcesRoot(userData), sourceUuid));
      if (srcMetaPost) _projectSourceFieldsOntoEntry(meta, srcMetaPost);
    } catch {}

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
      // entryUuid is regenerated so the duplicate is a distinct library
      // entry. sourceUuid + candidatePath are provenance and stay
      // shared with the original (they DID come from the same source
      // candidate), but the per-entry identity diverges.
      const now = new Date().toISOString();
      const meta = { ...srcMeta };
      meta.entryUuid = crypto.randomUUID();
      meta.name = sanitized;
      meta.createdAt = now;
      meta.updatedAt = now;
      meta.addedFromSource = [];
      // Drop the source's stamped hash — content matches now, but
      // recomputing keeps fileCount/totalBytes/contentHashedAt accurate
      // for this duplicate.
      delete meta.contentHash;
      delete meta.contentHashedAt;
      fs.writeFileSync(path.join(destDir, 'meta.json'), JSON.stringify(meta, null, 2));
      try { recomputeEntryContentHash(userData, sanitized); } catch {}
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
    // Propagate the entry-level demoUrl from the duplicated entry.
    // linkUrl lives on source meta now and is naturally shared across
    // every entry from the same source — no propagation needed for it.
    if (srcMeta.demoUrl) {
      try {
        const newMetaPath = path.join(destDir, 'meta.json');
        const written = JSON.parse(fs.readFileSync(newMetaPath, 'utf8'));
        written.demoUrl = srcMeta.demoUrl;
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
  'schemaVersion', 'entryUuid', 'sourceUuid', 'candidatePath', 'multiBoard',
  'otherFlavors', 'nested', 'contentFileCount', 'contentTotalBytes', 'createdAt',
]);

// Source-level fields that the entry-detail UI presents as if they were
// entry fields, but that actually live on the source meta. The single
// source per source-of-truth design (decided 2026-06-23): one creator,
// one website, one purchased flag, one acquisition date per source —
// every entry derived from that source displays and edits the same value.
//
// Read path: listEntries() joins to source meta and projects these onto
// each returned entry.meta (overriding any stale entry-level values that
// may still exist on disk from before the refactor).
//
// Write path: updateEntryMeta() routes updates touching these keys to
// updateSourceMeta() instead of writing them to entry meta. The user can
// edit on either the entry-detail or source-detail UI surface; both
// converge on the same source row on disk.
//
// Map: entry-side key → source-side key (the names differ because the
// schemas grew independently before the unification).
const _ENTRY_TO_SOURCE_FIELD_MAP = {
  author: 'vendor',
  vendorWebsite: 'vendorWebsite',
  purchased: 'purchased',
  acquisitionDate: 'acquisitionDate',
  // linkUrl — "where to get this font" — is a per-source property
  // (one purchase / download page per bundle, shared across every
  // font from the source). Lives on source meta; projected onto
  // entries the same way author / website / purchased do, so the
  // entry detail UI can edit it without knowing where it physically
  // lives. demoUrl stays purely entry-level since each font in a
  // bundle can have its own demo.
  linkUrl: 'linkUrl',
};
const _ENTRY_FIELDS_ON_SOURCE = new Set(Object.keys(_ENTRY_TO_SOURCE_FIELD_MAP));

// Cache the source-meta load per entry-list call so a bundle with N
// derived entries only reads its source once.
function _projectSourceFieldsOntoEntry(entryMeta, sourceMeta) {
  if (!entryMeta || !sourceMeta) return;
  entryMeta.author = sourceMeta.vendor || '';
  entryMeta.vendorWebsite = sourceMeta.vendorWebsite || '';
  entryMeta.purchased = sourceMeta.purchased === true;
  entryMeta.acquisitionDate = sourceMeta.acquisitionDate || '';
  entryMeta.linkUrl = sourceMeta.linkUrl || '';
  // Expose the auto-detected flag so the renderer can show a "verified"
  // badge or de-emphasize when the user later confirms a heuristic match.
  entryMeta.vendorAutoDetected = sourceMeta.vendorAutoDetected === true;
}

// Migration: hoist source-level fields from any derived entry up to its
// source when the source is missing them. Idempotent — runs to completion
// then becomes a no-op (the source will have the fields and the projection
// at read time will mirror them back). Called on startup (main.js) so
// existing libraries from before this refactor transparently migrate.
function migrateSourceLevelFields(userData) {
  const libRoot = entriesRoot(userData);
  const srcRoot = soundFontSources.sourcesRoot(userData);
  if (!fs.existsSync(libRoot) || !fs.existsSync(srcRoot)) {
    return { ok: true, migrated: 0, skipped: 0 };
  }

  // Group entries by sourceUuid; pick the most-informative values
  // (any-true for purchased, earliest for acquisitionDate, first
  // non-empty for the strings).
  const bySrc = new Map();
  for (const e of fs.readdirSync(libRoot, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const meta = _readEntryMeta(path.join(libRoot, e.name));
    if (!meta || !meta.sourceUuid) continue;
    if (!bySrc.has(meta.sourceUuid)) bySrc.set(meta.sourceUuid, []);
    bySrc.get(meta.sourceUuid).push(meta);
  }

  let migrated = 0;
  let skipped = 0;
  for (const [uuid, entries] of bySrc.entries()) {
    const srcDir = path.join(srcRoot, uuid);
    const srcMeta = soundFontSources.readSourceMeta(srcDir);
    if (!srcMeta) { skipped++; continue; }

    const updates = {};
    // purchased: any entry true → source true. The whole-bundle-same-tier
    // assumption (vendors never mix free/paid in a single source) means
    // we don't need a tiebreaker.
    if (srcMeta.purchased == null) {
      const any = entries.some(en => en.purchased === true);
      if (any || entries.some(en => en.purchased === false)) {
        updates.purchased = any;
      }
    }
    // acquisitionDate: earliest non-empty wins (the moment the bundle
    // entered the user's library — re-imports of the same source might
    // have different sourceFileDate values across entries).
    if (!srcMeta.acquisitionDate) {
      const dates = entries.map(en => en.acquisitionDate).filter(Boolean).sort();
      if (dates.length) updates.acquisitionDate = dates[0];
    }
    // vendor (author): first non-empty (entries should agree if vendor
    // detection fired; if they disagree it's user edits and we take any).
    if (!srcMeta.vendor) {
      const authors = entries.map(en => en.author).filter(Boolean);
      if (authors.length) updates.vendor = authors[0];
    }
    if (!srcMeta.vendorWebsite) {
      const sites = entries.map(en => en.vendorWebsite).filter(Boolean);
      if (sites.length) updates.vendorWebsite = sites[0];
    }

    if (Object.keys(updates).length === 0) { skipped++; continue; }
    const res = soundFontSources.updateSourceMeta(userData, uuid, updates);
    if (res && res.ok) migrated++;
  }
  return { ok: true, migrated, skipped };
}
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

  // Split updates into source-level (routed to updateSourceMeta) and
  // entry-level (written here). Source-level keys are mapped to their
  // source-side name (e.g. author → vendor) before forwarding. When the
  // user touches vendor or vendorWebsite from the entry-detail UI, we
  // also clear vendorAutoDetected so future re-detection passes don't
  // overwrite their decision.
  const sourceUpdates = {};
  if (updates && typeof updates === 'object') {
    for (const key of Object.keys(updates)) {
      if (_ENTRY_META_IMMUTABLE.has(key)) continue;
      if (_ENTRY_FIELDS_ON_SOURCE.has(key)) {
        const sourceKey = _ENTRY_TO_SOURCE_FIELD_MAP[key];
        sourceUpdates[sourceKey] = updates[key];
        continue;
      }
      meta[key] = updates[key];
    }
  }
  if (Object.keys(sourceUpdates).length > 0) {
    if (!meta.sourceUuid) return { ok: false, error: 'Entry has no sourceUuid; cannot route source-level update' };
    if ('vendor' in sourceUpdates || 'vendorWebsite' in sourceUpdates) {
      sourceUpdates.vendorAutoDetected = false;
    }
    const srcRes = soundFontSources.updateSourceMeta(userData, meta.sourceUuid, sourceUpdates);
    if (!srcRes || !srcRes.ok) return { ok: false, error: (srcRes && srcRes.error) || 'Source update failed' };
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

  // Re-project the (possibly just-updated) source meta onto the response
  // so callers see the canonical post-write state, not the stale entry
  // fields. Mirrors what listEntries() does on read.
  if (meta.sourceUuid) {
    const srcRoot = soundFontSources.sourcesRoot(userData);
    const srcMeta = soundFontSources.readSourceMeta(path.join(srcRoot, meta.sourceUuid));
    if (srcMeta) _projectSourceFieldsOntoEntry(meta, srcMeta);
  }
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
  out.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }));
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
      // Natural sort so "Sabine_2" precedes "Sabine_10" instead of
      // the lexicographic order that would put 10 before 2.
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    return out;
  };
  return walk(root, '');
}

// Walk an entry's tree to count files + sum bytes, EXCLUDING the
// root-level meta.json (same exclusion the content hash uses, so the
// safety-net signal matches the hash's content scope). Used both for
// recomputing the meta's fileCount/totalBytes when computing the
// content hash AND for the cheap-signal safety check that decides
// whether a stored hash is still trustworthy.
function _walkContentSignals(entryDir) {
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
  walk(entryDir, '');
  return { fileCount, totalBytes };
}

// Compute the entry's content hash and persist it (plus the matching
// contentFileCount + contentTotalBytes signals) to meta.json. Clears
// the dirty flag on success — this IS the resolve path for a flagged
// entry. Returns the hash, or null if the entry / meta is unreadable.
//
// Field naming: contentFileCount / contentTotalBytes are the canonical
// signal field names, shared with the sources + common helpers so the
// persistent-hash contract is identical across all three buckets.
function recomputeEntryContentHash(userData, entryName) {
  const root = entriesRoot(userData);
  const entryDir = path.join(root, entryName);
  const metaPath = path.join(entryDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  const { hashItemDir } = require('./soundFontFileHash');
  const hash = hashItemDir(entryDir);
  if (!hash) return null;
  const { fileCount, totalBytes } = _walkContentSignals(entryDir);
  meta.contentHash = hash;
  meta.contentFileCount = fileCount;
  meta.contentTotalBytes = totalBytes;
  meta.contentHashedAt = new Date().toISOString();
  meta.contentHashDirty = false;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
  return hash;
}

// Mark the entry as having been content-modified since its last hash
// stamp. Cheap — just a meta.json write of one boolean. Called by every
// file-op site so the eventual rehash (at modal close OR on next read)
// knows to recompute instead of trusting the stored value. Many ops in
// a row collapse into one rehash.
function markEntryContentDirty(userData, entryName) {
  const root = entriesRoot(userData);
  const metaPath = path.join(root, entryName, 'meta.json');
  if (!fs.existsSync(metaPath)) return;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return; }
  if (meta.contentHashDirty) return; // already flagged
  meta.contentHashDirty = true;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
}

// Resolve the dirty flag if set — call from the renderer when an
// entry's detail modal closes so a batched rehash happens once per
// editing session instead of per file op. No-op when not flagged.
function resolveEntryContentDirty(userData, entryName) {
  const root = entriesRoot(userData);
  const metaPath = path.join(root, entryName, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.contentHashDirty) return null;
  return recomputeEntryContentHash(userData, entryName);
}

// Trusted read of the entry's content hash. Stored hash trusted when
// (a) meta.contentHashDirty is not set AND (b) the cheap-signal walk
// (fileCount + totalBytes) matches what's stored. Either failing
// condition forces a recompute. The dirty flag is the primary signal
// for "content changed since last stamp"; the cheap-signal walk is the
// backup catch for any op path that forgot to mark dirty.
function getEntryContentHash(userData, entryName) {
  const root = entriesRoot(userData);
  const entryDir = path.join(root, entryName);
  const metaPath = path.join(entryDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.contentHashDirty
      && meta.contentHash
      && typeof meta.contentFileCount === 'number'
      && typeof meta.contentTotalBytes === 'number') {
    const live = _walkContentSignals(entryDir);
    if (live.fileCount === meta.contentFileCount && live.totalBytes === meta.contentTotalBytes) {
      return meta.contentHash;
    }
  }
  return recomputeEntryContentHash(userData, entryName);
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
  migrateSourceLevelFields,
  recomputeEntryContentHash,
  getEntryContentHash,
  markEntryContentDirty,
  resolveEntryContentDirty,
};
