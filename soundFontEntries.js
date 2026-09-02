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
const { copyTreeWithProgress } = require('./sfExportCopy');

function entriesRoot(userData) {
  return path.join(userData, 'soundFonts', 'library');
}

function ensureEntriesRoot(userData) {
  const root = entriesRoot(userData);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

// Central per-file manifest store, kept OUTSIDE entry/source folders so it can never
// export to an SD card. Keyed by uuid: entries/<entryUuid>.json (the live current state
// of a library font), sources/<sourceUuid>.json (the static source version). See
// local/sound-font-provenance-design.md §12.4.
function fileHashManifestPath(userData, kind, uuid) {
  return path.join(userData, 'soundFonts', '.filehashes', kind, `${uuid}.json`);
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
// Filesystem-metadata noise that hitchhikes inside zips and should
// never land on disk. Mirrors soundFontSources._isNoisePath which the
// non-nested extractTo already applies; the nested extractor needs
// its own copy because the source-side helper isn't exported.
//   __MACOSX/   — Mac Finder AppleDouble sidecar tree
//   .DS_Store  — Mac Finder per-folder metadata
//   ._<name>   — Mac AppleDouble companion files (flat alongside their real twin)
//   Thumbs.db, desktop.ini — Windows Explorer leftovers
function _isNoisePath(relPath) {
  const parts = String(relPath || '').split('/').filter(Boolean);
  for (const seg of parts) {
    if (seg === '__MACOSX') return true;
    if (seg === '.DS_Store') return true;
    if (seg === 'Thumbs.db' || seg === 'desktop.ini') return true;
    if (seg.startsWith('._')) return true;
  }
  return false;
}
// Composite-path separator matching soundFontCandidates.INNER_ZIP_SEP.
// Detection writes paths like "Ahsoka.zip!Ahsoka/Proffie" — left of the
// separator is the inner zip name within the source, right is the
// subtree prefix inside that inner zip whose contents we want at the
// entry root. Extraction trusts detection: no wrapper-stripping, no
// heuristics, just open the inner zip and pull exactly the slice the
// candidate points at.
const _NESTED_INNER_ZIP_SEP = '!';
async function _extractNestedZipToDir(source, innerZipPath, destDir, onProgress) {
  // Parse the composite path. Older candidates that pre-date the
  // architecture fix (or any case where detection couldn't identify a
  // sub-path) extract the whole inner zip — preserved for safety, but
  // any candidate that goes through detectCandidates today carries a
  // composite path.
  let innerZipName = innerZipPath;
  let subTreePrefix = '';
  const sepIdx = innerZipPath.indexOf(_NESTED_INNER_ZIP_SEP);
  if (sepIdx !== -1) {
    innerZipName = innerZipPath.slice(0, sepIdx);
    const rawSub = innerZipPath.slice(sepIdx + 1);
    subTreePrefix = rawSub && !rawSub.endsWith('/') ? rawSub + '/' : rawSub;
  }
  const buf = await source.readFile(innerZipName);
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
      for (const key of keys) {
        const e = entryMap[key];
        if (!e.name || e.name === '/' || e.isDirectory) continue;
        if (_isNoisePath(e.name)) continue;
        if (subTreePrefix && !e.name.startsWith(subTreePrefix)) continue;
        const relName = subTreePrefix ? e.name.slice(subTreePrefix.length) : e.name;
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

  // Curation sidecar ([B-283]): if this source arrived from a JMT export that
  // carried its curation, the block for THIS candidate path fills anything the
  // caller did not specify. The caller always wins — the review screen is where
  // the user just made decisions, and a file on disk must not overrule them.
  // Keyed by candidatePath because it is the only identifier an entry has that
  // survives a rename.
  if (source.meta && source.meta.curation) {
    try {
      const fromSidecar = require('./soundFontCuration')
        .entryCurationFor(source.meta.curation, candidate.path || '');
      if (fromSidecar) {
        metadata = { ...fromSidecar, ...(metadata || {}) };
      }
    } catch { /* curation is a bonus, never a blocker */ }
  }

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
      // Persisted effects fields — Proffie effect types present in
      // this entry's file tree. `effects` is the canonical-known set
      // (boot, hum, swingh, etc.), drives the entry-detail blue chips
      // and the missing-effect rubric. `unknownEffects` is the safety
      // net for forward-compat: any folder that looks effect-shaped
      // (has .wav children, not in the exclusion list) but isn't in
      // EFFECT_NAMES renders as a gray chip so users see the effect
      // even when our vocabulary lags ProffieOS. Both are maintained
      // by the markEntryEffectsDirty / resolveEntryEffectsDirty pair
      // mirroring contentHash's dirty-flag pattern. The vocabulary
      // maintenance discipline is documented at EFFECT_NAMES in
      // soundFontCandidates.js.
      ...(() => {
        const { effects, unknownEffects } = computeEntryEffects(entryDir);
        return { effects, unknownEffects };
      })(),
      effectsDirty: false,
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
        // Date unification 2026-06-26: hoist entry.acquisitionDate up to
        // source.purchaseDate (was acquisitionDate). Both the import-time
        // default and the bulk-import path now converge here.
        if (!srcMetaCur.purchaseDate && meta.acquisitionDate) srcUpdates.purchaseDate = meta.acquisitionDate;
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
  // Date unification 2026-06-26: the source schema previously kept the
  // user-facing date under two names — `purchaseDate` (set at import +
  // single-source review modal; read by source detail UI) and
  // `acquisitionDate` (set by the entry → source migration hoist; read
  // by the entry-side projection). The two diverged for bulk-imported
  // sources, leaving the source detail's Acquired field empty even when
  // the corresponding entry showed a date. Both routings now converge
  // on source.purchaseDate; acquisitionDate stays as a legacy fallback
  // in the projection and migrateSourceLevelFields backfills any null
  // purchaseDate from the legacy field or sourceFileDate.
  acquisitionDate: 'purchaseDate',
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
  // Date fallback chain reads source.purchaseDate first (canonical post-
  // unification), then source.acquisitionDate (legacy migration field),
  // then source.sourceFileDate (raw archive mtime, always populated at
  // import). The fallback covers existing on-disk data that pre-dates the
  // unification — once migrateSourceLevelFields runs, purchaseDate carries
  // the value and the fallback is a no-op.
  entryMeta.acquisitionDate = sourceMeta.purchaseDate
    || sourceMeta.acquisitionDate
    || sourceMeta.sourceFileDate
    || '';
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
    // purchaseDate: hoist any per-entry acquisitionDate up to the source.
    // Earliest non-empty wins (the moment the bundle entered the user's
    // library — re-imports of the same source might have different
    // sourceFileDate values across entries). Falls back to the source's
    // existing acquisitionDate (set by an earlier migration pass) and
    // finally to sourceFileDate (the archive mtime, always present from
    // import). Writing to source.purchaseDate is the canonical field
    // after the 2026-06-26 unification — see _ENTRY_TO_SOURCE_FIELD_MAP.
    if (!srcMeta.purchaseDate) {
      const dates = entries.map(en => en.acquisitionDate).filter(Boolean).sort();
      const picked = dates[0]
        || srcMeta.acquisitionDate
        || srcMeta.sourceFileDate
        || null;
      if (picked) updates.purchaseDate = picked;
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
  // Capture entryUuid BEFORE removing the folder so the central per-file manifest
  // can be dropped too. The store is keyed by uuid and lives OUTSIDE this folder,
  // so rmSync below doesn't touch it — we clean it explicitly. Best-effort: an
  // orphaned manifest is harmless, but removing it keeps the store honest.
  let entryUuid = null;
  try { entryUuid = (JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) || {}).entryUuid || null; }
  catch {}
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    if (entryUuid) {
      try { fs.rmSync(fileHashManifestPath(userData, 'entries', entryUuid), { force: true }); } catch {}
    }
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
// Is the copy at destDir/<name>/ byte-identical to this library entry?
//
// Exists so the conflict dialog stops asking keep-or-replace about folders that
// do not differ. Before this, exporting the same selection to the same card
// twice put every font in front of the user as a "conflict" when nothing had
// changed, which is both noise and a lie: there was nothing to decide.
//
// Roots correspond directly here, unlike the common folder: the export copies
// the entry dir's contents into destDir/<name>/, and collectFileRecords already
// excludes the item-root meta.json, which is the only thing that does not ship.
// So the two trees hash comparably with no special casing.
//
// Same discipline as commonMatchesAt: cheap signal first and only as a NEGATIVE
// (differing counts prove difference; matching counts prove nothing), content
// read before claiming sameness, and anything unreadable comes back
// not-identical so the caller asks rather than assuming.
function entryMatchesAt(userData, name, destDir) {
  if (!name || !destDir) return { ok: false, error: 'Missing name or destDir' };
  const srcDir  = path.join(entriesRoot(userData), name);
  const destFont = path.join(destDir, name);
  let destExists = false;
  try { destExists = fs.existsSync(destFont) && fs.statSync(destFont).isDirectory(); } catch {}
  if (!destExists) return { ok: true, exists: false, identical: false, reason: 'missing' };
  if (!fs.existsSync(srcDir)) return { ok: true, exists: true, identical: false, reason: 'unreadable' };

  // LIBRARY SIDE, trusted. Per-file hashes were computed when the entry was
  // hashed and live in the central manifest, kept in step with meta.contentHash
  // by the same walk. Re-deriving them would read the library to learn what we
  // already wrote down. The dirty flag is the app's own signal that they need
  // recomputing, and it is honoured here rather than second-guessed.
  const { readFileHashManifest, hashFile } = require('./soundFontFileHash');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(srcDir, 'meta.json'), 'utf8')); } catch {}
  if (meta.contentHashDirty || !meta.entryUuid || !meta.contentHash) {
    try { recomputeEntryContentHash(userData, name); } catch {}
    try { meta = JSON.parse(fs.readFileSync(path.join(srcDir, 'meta.json'), 'utf8')); } catch {}
  }
  let libRecords = null;
  if (meta.entryUuid) {
    const mf = readFileHashManifest(fileHashManifestPath(userData, 'entries', meta.entryUuid));
    if (mf && Array.isArray(mf.records) && mf.contentHash === meta.contentHash) libRecords = mf.records;
  }
  if (!libRecords) {
    const { collectFileRecords } = require('./soundFontFileHash');
    libRecords = collectFileRecords(srcDir);
  }
  if (!libRecords) return { ok: true, exists: true, identical: false, reason: 'unreadable' };

  // DESTINATION SIDE. The manifest holds a hash per file; mtime exists only to
  // say whether the user invalidated an entry. We consult ONLY the files the
  // library is writing — anything else on the card, recorded or not, is none of
  // this comparison's business. Self-healing: a file with no entry, or an
  // invalidated one, is hashed, and only that file.
  const sync = require('./sfSyncManifest');
  let cache = new Map();
  try { cache = sync.cacheFor(destDir, name); } catch {}
  const refreshed = new Map();
  let identical = true, hashed = 0, reused = 0;

  for (const rec of libRecords) {
    if (!rec || rec.fileHash === '<empty>') continue;   // empty-dir marker
    const abs = path.join(destFont, rec.relPath);
    let st = null;
    try { st = fs.statSync(abs); } catch { st = null; }
    if (!st) { identical = false; continue; }           // library has it, card does not
    const mtime = Math.round(st.mtimeMs);
    const ent = cache.get(rec.relPath);
    const valid = ent && ent[0] === st.size
      && Math.abs((ent[1] || 0) - mtime) <= sync.MTIME_TOLERANCE_MS;
    const destHash = valid ? (reused++, ent[2]) : (hashed++, hashFile(abs));
    refreshed.set(rec.relPath, [st.size, mtime, destHash]);
    if (destHash !== rec.fileHash) identical = false;
  }
  try { sync.mergeItem(destDir, name, refreshed); } catch {}

  return { ok: true, exists: true, identical, reason: identical ? null : 'hash', reused, hashed };
}

async function exportEntryToFolder(userData, name, destDir, mode = 'rename', onBytes = null) {
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
    // Streamed copy with write-paced byte progress. The internal meta.json at
    // the entry root is skipped (app artifact, not a font file); nested
    // meta.json files inside font subdirs are kept on the off chance a vendor
    // shipped one.
    await copyTreeWithProgress(srcDir, targetDir, { skipRootMeta: true, onBytes });
    // Record what we just wrote, with the destination's own timestamps, so the
    // next export can tell "unchanged since we wrote it" with stat calls instead
    // of reading the folder back. Best effort: a manifest we cannot write only
    // costs a re-read next time.
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
  // One walk yields the per-file records; fold them for the aggregate AND persist them
  // as the entry's LIVE manifest in the central store, so meta.contentHash and the
  // manifest stay in step and no second read is added. (hashRecords over the unfiltered
  // records is byte-for-byte what hashItemDir returned before.)
  const { collectFileRecords, hashRecords, writeFileHashManifest } = require('./soundFontFileHash');
  const records = collectFileRecords(entryDir);
  if (records === null) return null;
  const hash = hashRecords(records);
  const { fileCount, totalBytes } = _walkContentSignals(entryDir);
  const hashedAt = new Date().toISOString();
  if (!meta.entryUuid) meta.entryUuid = crypto.randomUUID();
  meta.contentHash = hash;
  meta.contentFileCount = fileCount;
  meta.contentTotalBytes = totalBytes;
  meta.contentHashedAt = hashedAt;
  meta.contentHashDirty = false;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
  // Best-effort LIVE entry manifest → central store (never in the entry folder, so it
  // can't leak to a card). A rebuildable cache, so a miss never fails the recompute.
  writeFileHashManifest(fileHashManifestPath(userData, 'entries', meta.entryUuid), records, hash, hashedAt);
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

// ── SEEN: what makes a font stop being NEW ────────────────────────────────
// NEW is "never seen", not a clock. Every time-based rule breaks: "since last
// launch" resets five times an hour for a heavy user and never for someone who
// leaves the app open; "within N days" keeps flagging fonts you already worked
// through, while a user away N+1 days sees nothing new when everything is.
// Never-seen survives an absence and makes the badge about the USER. It sits
// beside Needs review because it is the same shape - a worklist that clears by
// acting rather than by waiting. [B-213]
//
// SEEN MEANS LOOKED AT *OR* USED, and "used" cannot be derived:
// _sfComputeInUseFonts parses only the config currently OPEN in the editor, so
// a derived badge would pop back to NEW the moment that config closed. Hence a
// stamp. ONE field, SEVERAL writers - detail view opened, assigned to a preset,
// exported to a card - so a fourth way to use a font gets it for free.
//
// WRITE-ONCE ON PURPOSE: the FIRST time counts. Re-opening a font must not keep
// moving the date, because the date is also what a "recently seen" sort would
// read, and a value that moves every time you glance at it sorts by nothing.
function markEntrySeen(userData, entryName, whenIso) {
  const root = entriesRoot(userData);
  const metaPath = path.join(root, entryName, 'meta.json');
  if (!fs.existsSync(metaPath)) return false;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return false; }
  if (meta.seenAt) return false;                 // already seen — first wins
  meta.seenAt = whenIso || new Date().toISOString();
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch { return false; }
  return true;
}

// One-time backfill, and it MUST run in the same build that ships the badge.
// Absent seenAt means never seen, so without this every entry already in the
// library lights up NEW at once - wrong, useless, and it would train the user to
// ignore the badge on the first day it exists. Stamping them makes NEW start
// EMPTY and only ever mean what arrives afterwards.
//
// Stamped with the entry's own createdAt where it has one, rather than "now":
// pretending the whole library was seen at upgrade-time is a lie that a later
// "recently seen" sort would read back as fact.
function backfillSeenAt(userData) {
  const root = entriesRoot(userData);
  if (!fs.existsSync(root)) return { ok: true, stamped: 0 };
  let stamped = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(root, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
    catch { continue; }
    if (meta.seenAt) continue;
    meta.seenAt = meta.createdAt || new Date().toISOString();
    try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); stamped++; }
    catch {}
  }
  return { ok: true, stamped };
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

// ── Effects detection (persisted on entry meta) ──────────
// Mirrors the contentHash dirty-flag pattern. computeEntryEffects walks
// the entry's extracted file tree and returns a sorted array of the
// Proffie effect types present (boot, hum, swingh, etc.). createEntry
// stamps it at import time using the same EFFECT_NAMES vocabulary
// soundFontCandidates.js uses for looksLikeProffieFont gating, so the
// import-time detection cost is already paid — we just persist the
// result. markEntryEffectsDirty / resolveEntryEffectsDirty handle the
// post-import maintenance loop when the user adds/deletes/renames
// files in the entry.

function computeEntryEffects(entryDir) {
  const { EFFECT_NAMES, EFFECT_DIR_EXCLUSIONS, effectStemFromFile } = require('./soundFontCandidates');
  // Two sets are tracked in parallel: `known` is the canonical Proffie
  // vocabulary that drives "missing" detection, and `unknown` is the
  // safety-net catch-all for any folder that looks effect-shaped but
  // isn't in our list. The unknown set is what keeps the app honest
  // about forward-compat: a future ProffieOS effect lands cleanly as
  // a gray chip without needing a release here. See the comment block
  // on EFFECT_NAMES in soundFontCandidates.js for the maintenance
  // discipline that drains the unknown set back into the known one.
  const known = new Set();
  const unknown = new Set();
  // Walk a single directory level. For each folder: known-name → add
  // to known set; non-excluded folder name not on the known set →
  // check its children for a .wav file (the "looks effect-shaped"
  // heuristic) and add to unknown if so. For each .wav file at this
  // level: apply the file-stem extractor (which already filters to
  // EFFECT_NAMES — flat-layout fonts use known names for their root
  // wavs, so unknown-stem files don't need surfacing).
  const harvest = (dir) => {
    let children;
    try { children = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }
    for (const c of children) {
      if (c.isDirectory()) {
        const lower = c.name.toLowerCase();
        if (EFFECT_NAMES.has(lower)) { known.add(lower); continue; }
        if (EFFECT_DIR_EXCLUSIONS.has(lower)) continue;
        if (lower.startsWith('.')) continue;
        // Alt expansion folders (alt000, alt001, ...) are walked
        // separately by expandAlt below — they aren't effects in their
        // own right, they're alt variant containers. Skip them at the
        // outer harvest so they don't surface as unknown.
        if (/^alt\d{3}$/.test(lower)) continue;
        // Heuristic: folder contains at least one .wav child? If so it
        // walks like an effect dir. Cheap one-level readdir per
        // unknown folder, only paid for non-canonical names.
        try {
          const inner = fs.readdirSync(path.join(dir, c.name), { withFileTypes: true });
          if (inner.some(g => g.isFile() && /\.wav$/i.test(g.name))) {
            unknown.add(lower);
          }
        } catch {}
      } else if (c.isFile()) {
        const stem = effectStemFromFile(c.name);
        if (stem) known.add(stem);
      }
    }
    return children;
  };
  // Alt expansion: peek into the first alt### subfolder. Alts mirror
  // each other so one is representative of the rest. Effects that live
  // only inside alts (alt-only hum variants, etc.) get unioned into
  // the parent's sets so the entry registers what's actually present.
  const expandAlt = (dir, dirents) => {
    const altDirent = dirents.find(c => c.isDirectory() && /^alt\d{3}$/i.test(c.name));
    if (!altDirent) return;
    harvest(path.join(dir, altDirent.name));
  };
  const rootDirents = harvest(entryDir);
  expandAlt(entryDir, rootDirents);
  return {
    effects: Array.from(known).sort(),
    unknownEffects: Array.from(unknown).sort(),
  };
}

function recomputeEntryEffects(userData, entryName) {
  const root = entriesRoot(userData);
  const entryDir = path.join(root, entryName);
  const metaPath = path.join(entryDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  const { effects, unknownEffects } = computeEntryEffects(entryDir);
  meta.effects = effects;
  meta.unknownEffects = unknownEffects;
  meta.effectsDirty = false;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
  return { effects, unknownEffects };
}

function markEntryEffectsDirty(userData, entryName) {
  const root = entriesRoot(userData);
  const metaPath = path.join(root, entryName, 'meta.json');
  if (!fs.existsSync(metaPath)) return;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return; }
  if (meta.effectsDirty) return;
  meta.effectsDirty = true;
  try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)); }
  catch {}
}

function resolveEntryEffectsDirty(userData, entryName) {
  const root = entriesRoot(userData);
  const metaPath = path.join(root, entryName, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return null; }
  if (!meta.effectsDirty) return null;
  return recomputeEntryEffects(userData, entryName);
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
  entryMatchesAt,
  exportEntryToFolder,
  entryFolderExistsAt,
  listEntryFiles,
  migrateSourceLevelFields,
  recomputeEntryContentHash,
  getEntryContentHash,
  markEntryContentDirty,
  markEntrySeen,
  backfillSeenAt,
  resolveEntryContentDirty,
  computeEntryEffects,
  recomputeEntryEffects,
  markEntryEffectsDirty,
  resolveEntryEffectsDirty,
};
