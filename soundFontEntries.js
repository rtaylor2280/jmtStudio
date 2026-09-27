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
const { rmWithRetry } = require('./fsRemove');

// ⭐⭐ WHAT ONE FILE COSTS, EXPRESSED AS BYTES. [B-005 item 7b, 2026-09-26]
//
// A differential repair does three kinds of work - it writes bytes, it parks files aside, and it
// disposes of the parked copies - and only the first is measured in bytes. The progress bar needs
// one currency, so per-file work is converted at this rate.
//
// ⭐ MEASURED, NOT PICKED. On REVANTEDJMT (FAT32, direct reader) over two runs: park ~30 ms/file,
// dispose ~23 ms/file, write ~4.6 MB/s. At that write rate 30 ms is ~142 KB and 23 ms is ~109 KB,
// so 128 KB sits between them. Delete cost is independent of file SIZE - 200 files of 4 KB took
// 4765 ms while 4 files of 10 MB took 265 ms - which is why this is per file and not per byte.
//
// ⚠️ THE SLOPE TRANSFERS, THE MAGNITUDE DOES NOT. Another card, and especially a card behind a
// Proffieboard (a USB round trip per file), will have a different constant. That is tolerable by
// construction: this only sets the PACE at which the bar crosses per-file work. A wrong value
// paces unevenly; it can never make the bar claim done before the work is finished, because the
// same number sizes the denominator and advances the numerator. The value it replaced was an
// implicit zero, which is the only one that does lie.
const PER_FILE_UNIT = 128 * 1024;

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

// Copy a folder that is already on disk into a new entry directory, returning
// and reporting in exactly the shape createEntry expects back from
// source.extractTo. Backs the folder-attach path ([B-304]): the BYTES come from
// a folder the user picked, while the entry's identity still comes from the
// source it is being attached to.
//
// A root meta.json is skipped, and that is not housekeeping. inspectFolderAsFont
// skips it when it counts the folder, so copying it would make the entry's
// stored file count disagree with the figure the user was shown in the dialog
// one click earlier. (It would also be overwritten by this entry's own meta
// write moments later.)
// ⭐ A FONT FOLDER IS ONLY EVER POINTERS ([B-315] + [B-316], 2026-09-05).
//
// This is the recovery path — attaching the folders off a saber's SD card is how
// the customized versions of a font come home — and such a folder is mostly
// sounds the library already has. Those link to the copy we hold. What is left
// is the part that was actually customized, and it goes to the POOL, with this
// folder holding a name for it like any other file.
//
// ⚠️ THE RULE IS ABOUT THE FOLDER, NOT ABOUT THE ODDS. An attached folder that
// happens to be entirely novel is not a reason to start keeping real bytes in an
// entry: "just because it happens to be all unique if you added a folder doesn't
// mean we start keeping real files in a folder" (2026-09-05). Every file in
// every font folder points at something with a home — a vendor source or the
// pool — so there is one rule and no second category of file.
//
// What the dedup ratio here actually measures is how much of the font is still
// stock: a file left alone is byte-identical to the vendor's and links, a file
// customized is not and is stored. The files that do NOT dedup are exactly the
// ones the operation exists to recover.
//
// `contentIndex` is built once by the caller and threaded through, so a whole
// folder costs one pass over the manifests.
async function _copyFolderIntoDir(folderPath, destDir, onProgress, contentIndex) {
  // Picking an ancestor of the destination would have the walk copying its own
  // output forever. Cheap to rule out, and impossible to recover from if not.
  const srcRes = path.resolve(folderPath);
  const dstRes = path.resolve(destDir);
  if (dstRes === srcRes || dstRes.startsWith(srcRes + path.sep)) {
    throw new Error('That folder contains the library, so it cannot be added to it');
  }
  let fileCount = 0, totalBytes = 0, linkedFiles = 0, linkedBytes = 0;
  const refusedIn = [];
  const walk = (dir, relBase) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        fs.mkdirSync(path.join(destDir, rel), { recursive: true });
        walk(abs, rel);
      } else if (e.isFile()) {
        if (rel === 'meta.json') continue;
        // ⚠️ "Add from folder…" IS AN IMPORT DOOR ([B-370], his catch 2026-09-11: "just
        // added a folder with known threats"). It builds a whole entry out of an
        // arbitrary folder on disk, and this walk was the copy — unchecked. So Studio
        // itself put programs in a font, and the export dialog would then tell the user
        // something else on their computer had. His rule: never in, never out.
        // Refused rather than stripped-and-reported: nothing is destroyed, the file
        // simply does not arrive and the user's own folder is untouched.
        {
          const _v = require('./sdCardDetect').checkCarryableFile(abs, e.name);
          if (_v.blocked) {
            refusedIn.push({ name: e.name, relPath: rel, kind: _v.kind,
              reason: _v.reason, disguised: !!_v.disguised });
            continue;
          }
        }
        const dest = path.join(destDir, rel);
        let size = 0;
        try { size = fs.statSync(abs).size; } catch {}
        let linked = false;
        if (contentIndex) {
          // Give the content a home first. storeInPool hands back what we
          // already hold when we hold it, so nothing is written twice; only
          // genuinely novel bytes land in the pool. Then the name here is a link
          // to that home, whichever it turned out to be.
          const home = contentIndex.store({ srcAbs: abs, preferredName: path.basename(rel) });
          if (home.ok) {
            const r = contentIndex.ingest({ srcAbs: home.absPath, destAbs: dest });
            // ingestFile only reports !ok when the COPY failed too, which is a
            // real error; let the plain copy below raise it so the message is
            // the one this path has always produced.
            if (r.ok) linked = r.linked;
            else fs.copyFileSync(abs, dest);
          } else {
            fs.copyFileSync(abs, dest);
          }
        } else {
          fs.copyFileSync(abs, dest);
        }
        if (linked) { linkedFiles++; linkedBytes += size; }
        fileCount++;
        totalBytes += size;
        if (onProgress) onProgress({ fileCount, totalBytes, currentFile: rel });
      }
    }
  };
  fs.mkdirSync(destDir, { recursive: true });
  walk(srcRes, '');
  return { fileCount, totalBytes, linkedFiles, linkedBytes, refused: refusedIn };
}

// createEntry({ userData, sourceUuid, candidate, name?, metadata?, onProgress?, folderSource? })
//
// Extracts the candidate from the source into a new library entry. The name
// defaults to the candidate's suggested name; the caller is expected to have
// run findEntryByName first if they want to surface a friendlier collision
// message than the generic "already exists" error.
//
// `folderSource` ({ folderPath }) swaps WHERE THE FILES COME FROM and nothing
// else ([B-304], 2026-09-04). The source is still opened, so curation, restored
// provenance, source-field propagation, the content hash, the effect scan and
// every id are stamped by the same code on both paths — which is the whole
// reason this is an override on one line rather than a second entry writer.
// The caller supplies the candidate, so it decides what the new entry claims to
// be: attaching a folder as a version of an existing font passes THAT font's
// candidatePath, which is what lets the result diff against the same source
// subtree and report Customized on its own.
//
// Returns one of:
//   { ok: true, name, meta }
//   { ok: false, error: <string>, existing?: true }
async function createEntry({ userData, sourceUuid, candidate, name, metadata, onProgress, folderSource }) {
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
    if (folderSource && folderSource.folderPath) {
      // FIRST, deliberately: the candidate carries the anchor font's identity,
      // including its `nested` flag, and none of that describes where these
      // bytes live. Reading nested here would send a folder attach down the
      // inner-zip extractor.
      // One index for the whole folder, built here so the manifests are read
      // once rather than per file ([B-315]).
      const contentIndex = require('./soundFontContentIndex').buildIndex(userData);
      result = await _copyFolderIntoDir(folderSource.folderPath, entryDir, (p) => {
        emit('extracting', p);
      }, contentIndex);
    } else if (candidate.nested) {
      result = await _extractNestedZipToDir(source, candidate.path, entryDir, (p) => {
        emit('extracting', p);
      });
    } else {
      // ⭐ POINTERS, NOT A SECOND COPY ([B-309]). The entry's files are hardlinks to
      // the source's, so the bytes exist once. Each name is independent: rename or
      // delete one here and the source keeps its own; add a file and only this
      // folder has it; delete the whole source and this entry still works.
      // A zip source cannot link (there is no file on disk to name), so it copies —
      // the option is a request, not a requirement.
      result = await source.extractTo(candidate.path || '', entryDir, (p) => {
        emit('extracting', p);
      }, { link: true });
    }

    // Tags array. When the caller supplies metadata.tags, that wins (the
    // renderer pre-resolves the user-edited bundle name and any other tags
    // and passes them through). Otherwise we fall back to the candidate's
    // detected bundle name so a backend-only entry creation still gets
    // sensibly seeded.
    let initialTags;
    if (metadata && Array.isArray(metadata.tags)) {
      // Case-insensitive dedupe ([B-346] prerequisite): the backend is the
      // last write door, so it must enforce the one-definition-of-has rule
      // even when a caller (sidecar-restored tags, the bulk auto-bundle tag)
      // never went through a UI input's guard. First spelling wins.
      initialTags = [];
      const _seen = new Set();
      for (const t of metadata.tags) {
        const trimmed = String(t || '').trim();
        if (trimmed && !_seen.has(trimmed.toLowerCase())) {
          _seen.add(trimmed.toLowerCase());
          initialTags.push(trimmed);
        }
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
        || require('./localDate').localDateString(), // [B-339] local, not UTC
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

    // ── Record provenance restore ([B-283]) ──────────────────────────────
    // ⭐ Ryan's bar, 2026-09-03: "there should be no trace of me ever deleting
    // and bringing it back." A createdAt of today IS such a trace. The font
    // entered his library in August; only this row is new, and that is a
    // database fact he never asked to be shown. Same for the NEW badge, which
    // is simply `seenAt` being empty.
    // Applied AFTER the meta is built, deliberately: these compete with
    // nothing, so unlike curation there is no caller-wins question to settle.
    // ⚠️ entryUuid is NOT restored - see ENTRY_PROV_FIELDS. It is the record's
    // identity, and reviving one while a copy still exists would put two rows
    // in the library under the same id.
    if (source.meta && source.meta.curation) {
      try {
        const prov = require('./soundFontCuration')
          .entryProvenanceFor(source.meta.curation, candidate.path || '');
        if (prov) Object.assign(meta, prov);
      } catch { /* provenance is a restoration, never a blocker */ }
    }

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
    return { ok: true, name: entryName, meta, refused: (result && result.refused) || [] };
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
      // ⭐ POINTERS, like every other way a font enters the library ([B-309]).
      // A duplicate shares its original's bytes rather than doubling them, which
      // also means it shares whatever the original already shares with its source:
      // duplicating a 24 MB font costs kilobytes.
      // Safe for the same reason entry-to-source pointers are safe — nothing
      // writes content into an existing entry file, so the two names can never
      // surprise each other. Renaming, deleting and adding are all local to
      // whichever copy you do them in.
      // ⚠️ Copy is the fallback, never an error: a filesystem that will not link
      // still gets a correct duplicate, just a larger one.
      const walkCopy = (sd, dd) => {
        fs.mkdirSync(dd, { recursive: true });
        for (const ent of fs.readdirSync(sd, { withFileTypes: true })) {
          const s = path.join(sd, ent.name);
          const d = path.join(dd, ent.name);
          if (ent.isDirectory()) walkCopy(s, d);
          else if (ent.isFile()) {
            // ⚠️ meta.json IS NEVER LINKED. It is per-entry state, and the caller
            // rewrites the destination's copy immediately below — through a shared
            // name that write would land in the ORIGINAL entry's meta and rename a
            // font nobody touched. The one file here that is written rather than
            // only read is the one file that must stay private.
            const isEntryMeta = (sd === srcDir && ent.name === 'meta.json');
            let linked = false;
            if (!isEntryMeta) {
              try { fs.linkSync(s, d); linked = true; } catch { linked = false; }
            }
            if (!linked) fs.copyFileSync(s, d);
          }
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
      // seenAt is LIVED EXPERIENCE, not provenance, so it does not come across.
      // The spread above copies the whole source meta, and inheriting a seen
      // stamp made a brand-new duplicate permanently un-NEW: the badge means
      // "never opened and never used", and nobody has opened THIS one. Dropped
      // here beside the other per-entry fields rather than in the caller,
      // because every caller of a duplicate wants the same answer. [B-312]
      delete meta.seenAt;
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
      acquisitionDate: srcMeta.acquisitionDate || require('./localDate').localDateString(), // [B-339] local, not UTC
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
async function deleteEntry(userData, name) {
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
    // ⚠️⚠️ RETRIED, BECAUSE A HANDLE CAN OUTLIVE THE READ THAT OPENED IT. [2026-09-24]
    // Reported: deleting a font right after exporting it gave
    //   `ENOTEMPTY: directory not empty, rmdir '...\soundFonts\library\Decay'`
    // Exactly one file inside was locked — the wav that export had been reading — and it had
    // released by the time it was checked minutes later. **A transient lock, not a leak**, and a
    // single-attempt delete turns one into a hard failure the user has to understand and redo.
    // ⭐ THE PRECEDENT IS ALREADY IN THIS CODEBASE AND SAYS THE SAME THING. The export rollback in
    // `sources:exportManyToDownloads` retries four times with backoff, with the note: "on Windows a
    // path holding a file with an open handle cannot be removed, and a handle can outlive the
    // write." The same fact governs a read, and delete was the one destructive path without it.
    // ⚠️ Bounded, and it still FAILS if the path is genuinely held: the point is to survive a
    // closing handle, never to mask a file something has open for real.
    // ⚠️⚠️ AWAITED, NOT A SYNCHRONOUS SLEEP. My first cut used `Atomics.wait` to pause between
    // attempts — which blocks the MAIN process for up to 900 ms, and that is the exact defect
    // diagnosed hours earlier today: a synchronous walk in main left a modal in the DOM, unpainted
    // and unclickable, because Electron routes frame presentation and input dispatch through this
    // process. A retry that freezes the window is a worse bug than the failure it papers over.
    let _rmErr = null;
    for (let i = 0; i < 4; i++) {
      try { await fs.promises.rm(dir, { recursive: true, force: true }); _rmErr = null; break; }
      catch (e) {
        _rmErr = e;
        if (i < 3) await new Promise((r) => setTimeout(r, 150 * (i + 1)));
      }
    }
    if (_rmErr) throw _rmErr;
    if (entryUuid) {
      try { fs.rmSync(fileHashManifestPath(userData, 'entries', entryUuid), { force: true }); } catch {}
    }
    // ⚠️ AFTER the folder is gone, never before ([B-316], 2026-09-05). Pooled
    // content is kept exactly as long as something uses it — "once they're no
    // longer used by anything, they are deleted" — and the filesystem answers
    // that: the pool holds one name, so a file with any user has nlink >= 2.
    // The link count only falls once this font's names are actually removed, so
    // sweeping first would find every file still in use and free nothing.
    // deleteSource's refcounted unlinkAttachment carries the same ordering note
    // for the same reason.
    // Best-effort: a pooled orphan costs space, never correctness, and it is
    // reclaimed by the next deletion.
    try { require('./soundFontContentIndex').releasePoolOrphans(userData); } catch {}
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
  // Same guard as the source per-file export ([B-214], 2026-09-10): a one-file
  // export out of a store we manage must refuse a program exactly as the
  // whole-entry export does. Free here - the bytes are already in hand.
  {
    // checkCarryable, not the executable test ([B-370] sweep): this is an EXPORT door,
    // so it owes the same answer as every other one - archives and macro documents
    // do not leave either.
    const { checkCarryable } = require('./sdCardDetect');
    const v = checkCarryable(buf.subarray(0, 256), subPath);
    if (v.blocked) return { refused: true, reason: v.reason, relPath: String(subPath) };
  }
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
// [B-400] `opts.onBytes` reports the DESTINATION-side hashing, which is the expensive half of
// this question and used to run in total silence behind a right-click Export. A font is hundreds
// of files; on a card this is seconds of nothing happening.
// ⚠️⚠️ `opts.shouldStop` HONOURED 2026-09-24 [B-420]. This is a READ - it hashes a whole font at
// the destination to answer "is it already there" - and it had no stop check, so a cancel during
// the primary export's conflict scan waited for the current font to finish hashing. Same defect as
// `planExport`, one size smaller: bounded by a font rather than by a hundred tracks.
// ⭐ His rule for both: *"why would it need to do anything if all it was doing was analyzing?
// there's not a copy being made... so it should just stop."*
// ⭐ THE LIBRARY'S PER-FILE RECORDS, resolved one way.        [B-005 item 7b, 2026-09-26]
//
// Trusted, and cheap, because they were computed when the entry was hashed and live in the
// central manifest alongside `meta.contentHash`. Re-deriving them reads the library to learn what
// is already written down; the dirty flag is the app's own signal that they need recomputing and
// is honoured rather than second-guessed.
//
// ⚠️ EXTRACTED BECAUSE THE DIFFERENTIAL WRITE NEEDS THE SAME ANSWER AS THE COMPARE. If the write
// resolved the library's hashes even slightly differently from the compare that decided the
// folder differs, the two would disagree about which files need writing - and the disagreement
// would look like a working export that quietly skips a file.
function _libRecordsFor(userData, name, srcDir) {
  const { readFileHashManifest, collectFileRecords } = require('./soundFontFileHash');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(srcDir, 'meta.json'), 'utf8')); } catch {}
  if (meta.contentHashDirty || !meta.entryUuid || !meta.contentHash) {
    try { recomputeEntryContentHash(userData, name); } catch {}
    try { meta = JSON.parse(fs.readFileSync(path.join(srcDir, 'meta.json'), 'utf8')); } catch {}
  }
  if (meta.entryUuid) {
    const mf = readFileHashManifest(fileHashManifestPath(userData, 'entries', meta.entryUuid));
    if (mf && Array.isArray(mf.records) && mf.contentHash === meta.contentHash) return mf.records;
  }
  return collectFileRecords(srcDir);
}

// ⭐ EVERY FILE ACTUALLY PRESENT IN A DESTINATION FOLDER, with the size and mtime already in hand.
//
// ⚠️ ONE STAT PER FILE, CARRYING BOTH. Statting again later for the mtime doubles the metadata
// cost of a folder, and against a card over USB that is the difference between a phase that is
// instant and one that paces like a hash.
// ⚠️ Root `meta.json` is skipped for the same reason the hash walk skips it, so both sides of
// every comparison agree on what counts as a file of this font.
function _walkDestFolder(folder) {
  const files = [];
  const stack = [{ abs: folder, rel: '' }];
  while (stack.length) {
    const { abs, rel } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { stack.push({ abs: childAbs, rel: childRel }); continue; }
      if (!e.isFile()) continue;
      if (rel === '' && e.name === 'meta.json') continue;
      let size = 0, mtime = 0;
      try { const st = fs.statSync(childAbs); size = st.size; mtime = Math.round(st.mtimeMs); }
      catch {}
      files.push({ abs: childAbs, rel: childRel, size, mtime });
    }
  }
  return files;
}

async function entryMatchesAt(userData, name, destDir, opts = {}) {
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
  const { hashFile } = require('./soundFontFileHash');
  const libRecords = _libRecordsFor(userData, name, srcDir);
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
  let identical = true, hashed = 0, reused = 0, _anyMissing = false;

  // A file at the destination that the library does not have makes this folder DIFFER.
  //
  // The loop below walks the LIBRARY's file list, so anything extra in the destination folder is
  // structurally invisible to it: three wavs dropped into a font on the card, and every library
  // file still matches, so the compare reports the folder as ours. The card then holds content
  // the library does not, the app says it matches, Replace is never offered, and there is no way
  // to remove them through the app.
  //
  // One directory read answers it. The comparison is counts, which is sound only as a NEGATIVE -
  // a different count proves a difference, a matching one proves nothing - and the per-file pass
  // below still does the real work. `<empty>` records are directory markers, not files, so they
  // are subtracted from the library side to match what the walk counts.
  //
  // ⭐⭐ AND IT ANSWERS WITHOUT READING A BYTE, so it returns instead of hashing the folder to
  // confirm what it already knows. Hashing here would be work spent on a question with an answer.
  //
  // What that gives up is the observations this pass would have recorded - and they are not lost,
  // they are DEFERRED to the point where it is known whether they are worth paying for. The
  // choice does not exist yet at scan time:
  //   · REPLACE - the folder is about to be overwritten, so anything hashed here was wasted.
  //   · SKIP    - the card keeps what it has, so what is there is worth recording, INCLUDING the
  //               extra files. A skipped file is one the user decided to keep, which makes it
  //               ours to maintain even though we never wrote it.
  // `recordFolderAt` does that half, called on skip during the export.
  // ⚠️ Defaults that can never be equal, so a folder whose counts could not be measured cannot
  // accidentally claim completeness and license a deletion.
  let _libFiles = -1, _cardFiles = -2;
  try {
    _libFiles = libRecords.filter((r) => r && r.fileHash !== '<empty>').length;
    const { dirSignals } = require('./soundFontFileHash');
    _cardFiles = dirSignals(destFont).fileCount;
    if (_cardFiles !== _libFiles) {
      // ⭐⭐ AND SAY WHETHER THE MANIFEST ALREADY COVERS THIS FOLDER, because both numbers are
      // already in hand and the caller would otherwise go and re-derive them by walking the
      // folder again. A folder answered `recorded: true` needs nothing read, nothing stat'd and
      // no recording pass at all - which is the difference between a phase that flows through
      // like a hash and one that does not run.
      // ⚠️ COUNTS ONLY, which is sound for the same reason the check above is: this decides
      // whether there is anything to LEARN, not whether the folder matches. A swap that keeps
      // the count identical costs one stale record and is caught the next time the file is read.
      return { ok: true, exists: true, identical: false, reason: 'signals',
               recorded: _cardFiles === cache.size };
    }
  } catch { /* unreadable destination folder: the per-file pass reports it */ }

  // Byte budget for the compare: what the library says each file weighs. Derived from the
  // records we already hold, so it costs no extra reads.
  const _onBytes = typeof opts.onBytes === 'function' ? opts.onBytes : null;
  let _bTotal = 0, _bDone = 0;
  if (_onBytes) {
    for (const r of libRecords) {
      if (r && r.fileHash !== '<empty>') _bTotal += (r.size || r.bytes || 0);
    }
    try { _onBytes({ done: 0, total: _bTotal, name: '' }); } catch {}
  }
  // [B-398] door 2. Hashes every file of a font AND READS THE CARD - the same main-thread block as
  // the import, on slower storage. Yield between files so the window keeps answering Windows.
  // ⚠️ Shared breath, setImmediate not a microtask - see soundFontFileHash.breathe.
  const { breathe: _breathe, hashFileAsync } = require('./soundFontFileHash');
  for (const rec of libRecords) {
    // ⚠️ PER FILE. Each iteration can hash megabytes off slow storage; a check only at the top of
    // the pass would be no better than none.
    if (opts.shouldStop && opts.shouldStop()) return { ok: true, canceled: true };
    if (!rec || rec.fileHash === '<empty>') continue;   // empty-dir marker
    await _breathe();
    const abs = path.join(destFont, rec.relPath);
    let st = null;
    // [B-173] point 2 is exactly this call. Counted so the cost is visible in the terminal
    // before and after that work, rather than argued from the code.
    sync.countStat();
    try { st = fs.statSync(abs); } catch { st = null; }
    // ⚠️ A file the library has and the card does not means the set we just examined is NOT
    // the whole folder, which disqualifies the completeness claim below.
    if (!st) { identical = false; _anyMissing = true; continue; }   // library has it, card does not
    const mtime = Math.round(st.mtimeMs);
    const ent = cache.get(rec.relPath);
    const valid = sync.entryValid(ent, st.size, mtime);
    // ⚠️ AWAITED STREAM HASH. [B-398] A breath between files does not help when ONE file is the
    // block: measured 2526ms inside compare:font with the per-file yield already in place. A
    // font's tracks are megabytes each and hashFile reads one whole file synchronously.
    // [B-173] Counted so a rejected manifest entry is VISIBLE. hashed>0 on a card we just
    // exported to means entries are not being believed - a validation defect, not a slow disk.
    const destHash = valid ? (reused++, ent[2]) : (hashed++, sync.countHash(), await hashFileAsync(abs));
    refreshed.set(rec.relPath, [st.size, mtime, destHash]);
    if (destHash !== rec.fileHash) identical = false;
    if (_onBytes) {
      _bDone += (rec.size || rec.bytes || st.size || 0);
      try { _onBytes({ done: _bDone, total: _bTotal, name: String(rec.relPath || '').split('/').pop() }); } catch {}
    }
  }
  // ⭐ Land on 100%: files that are missing at the destination `continue` above without paying
  // their budget, and a library-only file is the common case here. [B-389].
  if (_onBytes) { try { _onBytes({ done: _bTotal, total: _bTotal, name: '' }); } catch {} }
  // ⚠️ THE CHECK'S CACHE IS THE SYNC MANIFEST, so a read-only question can
  // seed jmt-studio-manifest.json at the destination ([B-358], his second
  // catch 2026-09-08 14:49: the quick export's TOAST wording asks this
  // question, and the manifest followed the question, not the copy).
  // writeCache:false makes the question truly side-effect-free; the conflict
  // scans keep the default and their speed.
  // [B-402] RETURNED, NOT WRITTEN. A compare answers a question, and a question must not mutate
  // the thing it is asking about. [B-358] found this in 2026-09-08 and fixed it with the
  // `writeCache:false` flag at ONE call site, leaving the note that "the conflict scans keep the
  // default and their speed" — so the principle was set and then applied once.
  //
  // ⭐ The flag is gone because the choice it forced is gone. It made you pick between a
  // side-effect-free question and a warm cache next time; handing the observations back gives both
  // — the caller writes them ONCE at the end of a real export, and a question the user abandons
  // leaves nothing behind.
  //
  // ⚠️ AS AN ARRAY, not a Map: this return crosses the IPC boundary and a Map does not survive
  // structured cloning intact for our purposes. The export side rebuilds it.
  // ⚠️⚠️ `complete` MEANS "THESE OBSERVATIONS ARE THE WHOLE FOLDER", AND IT LICENSES DELETION.
  // The caller may drop records this list does not mention, so it has to be exactly right:
  //   · every library file was FOUND - one missing means the card holds something we never
  //     examined, even when the counts happen to agree (one absent, one extra).
  //   · the card's file count equals the library's - so the files just examined account for
  //     every file in the folder.
  // ⚠️ A CANCEL CANNOT REACH HERE. The stop check returns from inside the loop with no
  // observations at all, so a partial pass can never claim this - which is the whole risk:
  // records deleted for files the operation never got to.
  return { ok: true, exists: true, identical, reason: identical ? null : 'hash', reused, hashed,
           complete: !_anyMissing && _cardFiles === _libFiles,
           observed: [...refreshed] };
}

// ── The differential write's three primitives ───────────── [B-005 item 7b, 2026-09-26]
//
// ⭐⭐ A FILE MOVED WITHIN ONE VOLUME IS METADATA, AND THAT IS THE WHOLE ECONOMICS OF 7b. Parking
// a superseded file costs a directory entry rewrite, not a copy of its bytes - which is why the
// folder-level pattern (set aside, put the new one in place, dispose last) can come down to file
// level without the cost coming with it. `destDir` is one volume by construction, so no EXDEV.
async function _moveAside(fromRoot, toRoot, rel) {
  const from = path.join(fromRoot, rel), to = path.join(toRoot, rel);
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  // ⚠️ Windows `rename` will not replace a directory and is unreliable over an existing file on
  // some filesystems; removing the target first makes the behaviour the same everywhere.
  try { await fs.promises.rm(to, { force: true }); } catch {}
  await fs.promises.rename(from, to);
}

// ⚠️⚠️ THE UNDO IS DRIVEN BY A JOURNAL OF WHAT THIS CALL ACTUALLY DID, and it has to be. The old
// recovery was wholesale - delete the target, rename the aside back - which was correct only
// while the aside held a COMPLETE font and the target held nothing but our partial. A
// differential write inverts both: the aside holds a handful of displaced files and the target
// holds the user's font almost intact. Running the wholesale recovery over that destroys it.
//
// ⭐ ORIGINALS GO BACK FIRST. Restoring the user's data outranks tidying ours away, and if the
// process dies between the two halves, a file we created being left behind is recoverable while
// a file of theirs still parked under ORIGINAL.<name> is the loss the standing rule exists to
// prevent.
async function _undoDifferential(targetDir, asideDir, displaced, created) {
  for (const rel of displaced) { try { await _moveAside(asideDir, targetDir, rel); } catch {} }
  for (const rel of created) {
    try { await fs.promises.rm(path.join(targetDir, rel), { force: true }); } catch {}
  }
}

async function exportEntryToFolder(userData, name, destDir, mode = 'rename', onBytes = null, opts = {}) {
  // [B-402] What this export learned, handed back for the caller's single terminal write.
  let _observedOut = null, _observedItem = null;
  // Bytes this export did NOT have to write because the card already had them. Reported so
  // the summary can say what maintaining the record bought, in the one unit that is measured
  // rather than estimated. [B-005 item 7b]
  let _savedOut = 0;
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
  // Set when 'replace' moves an existing font out of the way. Non-null means there is a real
  // font of the user's parked at ORIGINAL.<name> that MUST be put back or deleted before we
  // return - never left behind, and never lost. [B-005 item 4]
  let asideDir = null;
  // ⚠️⚠️ GUARDS THE OUTER CATCH, AND WITHOUT IT THIS WHOLE FEATURE DESTROYS FONTS. That
  // handler does `rmSync(targetDir)` to clear a half-written copy on failure - correct while
  // targetDir could only ever hold OUR partial. Once the failure path restores the user's
  // font back to that exact path, the same line deletes the thing the restore just saved.
  // A cleanup that was safe by construction stopped being safe when the construction changed.
  let restoredOriginal = false;
  // ⭐⭐ THE JOURNAL OF WHAT THIS CALL DID TO AN EXISTING FOLDER. [B-005 item 7b, 2026-09-26]
  //
  // A differential replace leaves the user's folder in place and touches individual files, so
  // "undo" can no longer mean a wholesale swap. `_displaced` are files of theirs now parked under
  // ORIGINAL.<name>; `_created` are files that were not there before we wrote them. Between them
  // they describe every change, which is what lets any failure path put the folder back exactly.
  //
  // ⚠️ `_differential` GATES THE OLD WHOLESALE RECOVERY OFF. Those paths assume the aside is a
  // complete font and the target is only our partial - both false here, and both destructive if
  // run anyway.
  let _differential = false;
  const _displaced = [], _created = [], _awaitingWrite = new Set();
  const exists = fs.existsSync(path.join(destDir, targetName));
  if (exists) {
    if (mode === 'skip') {
      return { ok: true, skipped: true, destPath: path.join(destDir, targetName) };
    }
    if (mode === 'replace') {
      // ⭐⭐ MOVE THE ORIGINAL ASIDE; DO NOT DELETE IT. [B-005 item 4, his design 2026-09-20]
      //
      // This used to `rm` the existing font tree and THEN start copying, which is the exact
      // shape that destroyed 708 MB on 2026-09-02 and produced the standing rule: move the
      // original aside, put the new one in place, and only then delete the original. At no
      // instant may the destination be empty while the replacement is still a hope. A cancel
      // or a failure mid-copy used to leave the user with neither the old font nor a whole
      // new one.
      //
      // ⭐ AND ON A CARD IT IS ALSO MUCH FASTER, WHICH IS WHY IT SOLVES THE "too large to
      // clean up" PROBLEM. A rename is one metadata write; the delete it replaces is one
      // round trip PER FILE - 110 of them for his biggest font, across a board's USB bridge.
      // So the restore after a cancel is O(1) and instant no matter how big the font is;
      // only disposing of the junk afterwards is slow, and that is the part worth offering
      // rather than doing.
      //
      // ⚠️ SAME DIRECTORY, SO NO EXDEV. Renaming within destDir is same-volume by
      // construction - the second half of the 09-02 rule, and the reason this is not staged
      // through a temp dir.
      // ⚠️⚠️ A LEFTOVER FROM AN EARLIER RUN IS LEFT ALONE, DELIBERATELY. [B-436, 2026-09-26]
      // A sweep of every `DELETE.*` here was written and then REMOVED 2026-09-26, and the
      // second half of it is the part worth keeping: "meaning we delete something later? On a
      // separate export? Don't think we should. Reporting is good."
      //   · it deletes on an operation that has nothing to do with the folder being removed
      //   · and it works AGAINST the reporting added in the same change - a leftover quietly
      //     swept by the next export is one nobody ever learns about, which is the exact state
      //     [B-436] exists to end.
      // Only THIS item's leftover is cleared, below, by the export that owns it.
      asideDir = path.join(destDir, `ORIGINAL.${targetName}`);
      // ⚠️ A stale aside means a previous run died between the rename and the cleanup. Its
      // content is the OLDER copy of a font the user has since replaced, so the live tree
      // wins; clearing it is what makes this operation repeatable rather than jamming on the
      // second attempt.
      if (fs.existsSync(asideDir)) {
        try { await fs.promises.rm(asideDir, { recursive: true, force: true }); }
        catch (err) { return { ok: false, error: `Cannot clear a leftover ORIGINAL folder: ${err.message}` }; }
      }
      // ⭐⭐ THE FOLDER STAYS WHERE IT IS. [B-005 item 7b, 2026-09-26]
      //
      // It used to be renamed to ORIGINAL.<name> wholesale, which meant every file had to be
      // copied back from the library whether or not it had changed. Measured cost of that: 44.6 MB
      // rewritten to restore one 2.1 MB file, and 64.3 MB rewritten across two fonts that needed
      // NOTHING written at all - they differed only by files added on the card.
      //
      // ⭐ HIS FRAMING, and it is the design: bring what we were doing at the folder level down to
      // the file level. Each superseded file is parked under ORIGINAL.<name> individually, the new
      // one is written in its place, and the parked copies are disposed of at the end. Every
      // property of the folder-level rule survives - the destination is never empty, the original
      // is never deleted before the replacement is in place, and a stop is reversible - while the
      // cost drops from copying a folder to renaming the files that actually change.
      _differential = true;
    } else {
      // 'rename' (default) — fall through to "<name>_N" until free.
      // Underscore (not parens) so the resulting folder name is safe
      // for Proffie's font-folder matcher on the SD card destination.
      // Starts at _2 ([B-343], his rule): the ORIGINAL is implicitly
      // number one, so the first copy of "Ahsoka" is "Ahsoka_2", never
      // "Ahsoka_1". Names already minted on disk are data, not migrated.
      let n = 2;
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
    const _exportRefused = [];
    // ⭐⭐ WORK OUT WHAT ACTUALLY HAS TO CHANGE, THEN PARK ONLY THAT. [B-005 item 7b]
    //
    // ⚠️ THE PLAN IS ASKED FOR BEFORE ANYTHING MOVES, and a cancel during it costs nothing,
    // because at that point nothing has been touched.
    let _writeFilter = null;
    if (_differential) {
      // ⭐⭐ THE CALLER MAY HAVE PLANNED THIS ALREADY, AND IF SO THIS MUST NOT PLAN IT AGAIN.
      // [B-005 item 7b, 2026-09-26]
      //
      // The export doors now plan every font in their `plan:` hook, because that is what lets the
      // progress bar be sized correctly before it is drawn - it used to be sized from whole fonts
      // and then corrected downward per font, and watching the total shrink mid-run read as the
      // app being unsure of itself.
      //
      // ⚠️⚠️ REUSED, NOT RECOMPUTED, AND THAT IS THE WHOLE POINT ON A BOARD CARD. A plan is a stat
      // per file - 2,263 of them for a 29-font card, measured 2026-09-26 - and every one is a USB
      // round trip when the card is behind a Proffieboard. Planning here as well would pay that
      // walk twice for one export, which is precisely the cost the pre-planning was supposed to
      // move rather than add.
      //
      // ⚠️ A caller that does not pre-plan still works: door 1, the tests, and anything written
      // later fall through to planning here. One behaviour, two entry points - not two designs.
      const plan = (opts.plan && opts.plan.ok) ? opts.plan
        : await planFolderWrite(userData, name, destDir, { shouldStop: opts.shouldStop || null });
      if (plan && plan.canceled) {
        return { ok: true, canceled: true, destPath: targetDir, item: targetName,
                 partialRemoved: false, restored: true, leftovers: [] };
      }
      if (!plan || !plan.ok) {
        return { ok: false, error: (plan && plan.error) || `Cannot plan the write for ${name}` };
      }
      const toWrite = new Set(plan.toWrite);
      _writeFilter = (nm, rel) => toWrite.has(rel);
      // ⭐ What maintaining the record bought, in bytes that never had to be written. This is a
      // RESULT and it belongs in the summary, which already states it as "JMT Studio saved you X
      // of writing". It is deliberately no longer fed to the progress bar - see below.
      _savedOut = Math.max(0, (plan.bytesTotal || 0) - (plan.bytesToWrite || 0));

      // ⭐ THE TWO KINDS OF FILE THAT MOVE OUT OF THE WAY, and they are different on the way back.
      //   a superseded file - its replacement is about to be written, so undo RESTORES it
      //   an extra the library does not have - Replace means MAKE IT MATCH, so it just goes
      // ⚠️ A file we are about to write that was NOT there before is journalled as `_created`
      // instead: there is nothing to park, and undo has to DELETE it rather than restore it.
      for (const rel of [...plan.toDisplace, ...plan.toWrite]) {
        if (opts.shouldStop && opts.shouldStop()) {
          await _undoDifferential(targetDir, asideDir, _displaced, _created);
          return { ok: true, canceled: true, destPath: targetDir, item: targetName,
                   partialRemoved: false, restored: true, leftovers: [] };
        }
        if (!fs.existsSync(path.join(targetDir, rel))) { _created.push(rel); continue; }
        await _moveAside(targetDir, asideDir, rel);
        _displaced.push(rel);
        // ⚠️ THE BAR, NEVER THE TALLY. `opts.onBytes` also feeds `token.wrote.bytes`, which the
        // cancel-cleanup rule reads to decide whether removing what landed is slow enough to be
        // worth OFFERING rather than just doing. A park writes nothing to the card, so putting
        // these units through that sink would answer that question with work that never happened.
        if (typeof opts.onUnits === 'function') { try { opts.onUnits(PER_FILE_UNIT); } catch {} }
        // ⚠️⚠️ ONLY A SUPERSEDED FILE IS EXPECTING A REPLACEMENT. An EXTRA is parked because the
        // library does not have it and never will, so the post-copy check below must not treat
        // its absence as a write that failed and put it back. First run of the behavioural test
        // caught exactly that: the extra was dutifully restored and Replace stopped meaning
        // make-it-match.
        if (toWrite.has(rel)) _awaitingWrite.add(rel);
      }
    }
    try {
      await copyTreeWithProgress(srcDir, targetDir, { skipRootMeta: true, onBytes, refused: _exportRefused,
        shouldStop: opts.shouldStop || null,
        // ⚠️ null for a full write, so the ordinary export is byte-for-byte the operation it was.
        fileFilter: _writeFilter,
        // ⭐ The tally the cancel-cleanup rule reads. Owned by the caller's token so one
        // object counts for the whole operation, across every font in a bulk run.
        wrote: opts.wrote || null });
      // ⚠️⚠️ ANYTHING PARKED WHOSE REPLACEMENT NEVER ARRIVED GOES BACK. The copy can decline to
      // write a file it planned to - `refused` blocks a carryable it will not put on a card - and
      // without this the user's copy would be parked, never replaced, and then disposed of with
      // the aside. A silent deletion caused by a safety feature.
      if (_differential) {
        for (const rel of _displaced.slice()) {
          if (!_awaitingWrite.has(rel)) continue;   // an extra: it was parked to GO
          // ⚠️ `isFile`, not `existsSync`. A library entry that is a DIRECTORY makes the copy
          // walker create a directory of that name at the destination, which exists happily and
          // is not the file that was supposed to arrive. Found by the behavioural test.
          let arrived = false;
          try { arrived = fs.statSync(path.join(targetDir, rel)).isFile(); } catch {}
          if (arrived) continue;
          try {
            await _moveAside(asideDir, targetDir, rel);
            _displaced.splice(_displaced.indexOf(rel), 1);
            // ⚠️ THE BAR STILL OWES THIS FILE ITS UNIT. It was counted once for parking and once
            // for disposal; coming back instead of being disposed of is the same per-file move,
            // so the unit is paid here rather than in the disposal loop. Without this the bar
            // finishes short by one unit for every file a refusal sends back.
            if (typeof opts.onUnits === 'function') { try { opts.onUnits(PER_FILE_UNIT); } catch {} }
          } catch { /* reported by the leftover path; nothing is destroyed */ }
        }
      }
    } catch (err) {
      // ── Cancelled: take the half-written font back off the card ───── [B-005 item 4]
      //
      // ⭐⭐ REMOVING THE PARTIAL IS THE SAFER ANSWER, AND IT IS SAFE TO DO HERE. `targetDir` is
      // always a folder THIS call created a few lines above - 'rename' minted a fresh name,
      // 'replace' deleted the old tree first, 'skip' returned long ago - so there is no case
      // where this touches something that was already the user's.
      //
      // ⭐ A partial font is worse than a missing one. Half a font on a card looks installed,
      // mounts, appears in the preset list and then fails at the moment it is played, which is
      // the kind of failure that gets blamed on the board. A font that is simply absent tells
      // the truth, and re-exporting it is one click.
      //
      // ⚠️ BEST EFFORT, AND A FAILURE HERE IS NOT AN ERROR. If the card pulls out mid-cleanup
      // we still report the cancel honestly rather than converting it into a crash - the user
      // asked to stop, and telling them it broke instead would be its own lie.
      if (require('./sfExportCopy').isCancel(err)) {
        const out = { ok: true, canceled: true, destPath: targetDir, item: targetName,
                      partialRemoved: false, restored: false, leftovers: [] };
        // ⭐⭐ RESTORE FIRST, DISPOSE SECOND, AND THE ORDER IS THE WHOLE POINT. Getting his
        // font back is two metadata renames - instant even on a board card, and it must not
        // be made to wait behind a recursive delete that costs a round trip per file. If the
        // process dies between these two steps the user still has a complete font under
        // ORIGINAL.<name>, which is why the aside is renamed back LAST rather than first.
        // ⭐⭐ A DIFFERENTIAL REPLACE UNDOES ITS OWN JOURNAL AND NOTHING ELSE. [B-005 item 7b]
        //
        // ⚠️⚠️ THE WHOLESALE PATH BELOW WOULD DESTROY THE FONT HERE. It renames `targetDir` to
        // DELETE.<name> and the aside back into its place - correct while the aside was a COMPLETE
        // font and the target was only our partial. Under a differential write both are inverted:
        // the target IS the user's font, minus a few parked files, and the aside holds only those
        // few. Swapping them would replace a whole font with a handful of files.
        //
        // ⭐ AND THE REVERSAL IS CHEAP FOR THE SAME REASON THE WRITE IS. Every step is a rename
        // inside one directory, so stopping costs what it cost to start - no recursive delete, no
        // folder-sized copy back.
        // ⚠️⚠️ AND IT RETURNS HERE. Falling through reaches the retry-rm of `targetDir` below,
        // which is the ordinary path's way of taking a half-written font back off the card - and
        // under a differential write `targetDir` is the user's whole font. Found by the
        // behavioural test on its first run: cancelling mid-copy left an EMPTY folder.
        if (_differential) {
          await _undoDifferential(targetDir, asideDir, _displaced, _created);
          restoredOriginal = true;
          out.restored = true;
          out.partialRemoved = true;
          try { if (asideDir && fs.existsSync(asideDir)) await fs.promises.rm(asideDir, { recursive: true, force: true }); }
          catch { out.leftovers.push(asideDir); }
          return out;
        }
        if (asideDir) {
          // 1. Get the half-written tree out of the way under a name that says what it is.
          const junk = path.join(destDir, `DELETE.${targetName}`);
          try {
            if (fs.existsSync(junk)) await fs.promises.rm(junk, { recursive: true, force: true });
            if (fs.existsSync(targetDir)) {
              await fs.promises.rename(targetDir, junk);
              out.leftovers.push(junk);
            }
          } catch { /* fall through - the restore below matters more than tidiness */ }
          // 2. Put the original back where it belongs.
          try {
            await fs.promises.rename(asideDir, targetDir);
            out.restored = true;
          } catch {
            // ⚠️ The user's font is still WHOLE, just under the wrong name. Say so rather
            // than reporting a clean stop - they need to know a folder called ORIGINAL.<name>
            // is their font and must not be deleted.
            out.leftovers.push(asideDir);
          }
          // ⭐⭐ THE SAME OFFER THE NON-REPLACE PATH MAKES. [B-005 item 4] Found reviewing for
          // parity 2026-09-21: cancelling a REPLACE renamed the partial to DELETE.<name> and
          // merely MENTIONED it, while cancelling a fresh export OFFERED to clear it. Same
          // situation, same slow delete, two different treatments - and replace is the case
          // where the user most wants the card tidy, because they were deliberately
          // overwriting something.
          // ⚠️ Same condition as everywhere else: a board card, over the same thresholds.
          // Below that the removal is cheap and simply happens.
          {
            const _ed0 = require('./exportDestination');
            const _wf = (opts.wrote && opts.wrote.files) || 0;
            const _wb = (opts.wrote && opts.wrote.bytes) || 0;
            const junkLeft = out.leftovers.find((p) => /[\\/]DELETE\./.test(p));
            if (junkLeft) {
              if (opts.boardCard && _ed0.isSlowWriteJob(_wf, _wb)) {
                // ⚠️ Moved OUT of `leftovers`: naming it and then asking about it would state
                // the same fact twice, which is the noise this app keeps cutting.
                out.leftovers = out.leftovers.filter((p) => p !== junkLeft);
                out.offerCleanup = junkLeft;
              } else {
                try {
                  await fs.promises.rm(junkLeft, { recursive: true, force: true });
                  out.leftovers = out.leftovers.filter((p) => p !== junkLeft);
                } catch { /* keep it named so the user is told it is there */ }
              }
            }
          }
          return out;
        }
        // ── No aside: the partial is ours alone ──
        //
        // ⭐ Safe by construction - targetDir was minted by THIS call ('rename' picked a fresh
        // name, 'skip' returned long ago), so nothing here can touch something already the
        // user's.
        //
        // ⭐⭐ ON A BOARD CARD WITH A LOT ALREADY WRITTEN, RENAME AND OFFER - DO NOT DELETE.
        // [B-005 item 4, his ruling 2026-09-20] "on card specifically, we need to enable abort
        // and offer to clean if over 60mb already... offer to cleanup because if we've already
        // done a bunch, it will take a while to delete... and the user may want partial files
        // rather than wait." A recursive delete across the board's USB bridge is one round
        // trip PER FILE; the rename is a single metadata write. So the cancel COMPLETES
        // instantly either way, and the slow part becomes a choice instead of a wait.
        // ⚠️ Same thresholds as the slow-write warning, deliberately - it is the same question
        // about the same destination, so it must not get a second set of numbers.
        const _ed = require('./exportDestination');
        const wroteFiles = (opts.wrote && opts.wrote.files) || 0;
        const wroteBytes = (opts.wrote && opts.wrote.bytes) || 0;
        if (opts.boardCard && _ed.isSlowWriteJob(wroteFiles, wroteBytes)) {
          const junk = path.join(destDir, `DELETE.${targetName}`);
          try {
            if (fs.existsSync(junk)) await fs.promises.rm(junk, { recursive: true, force: true });
            await fs.promises.rename(targetDir, junk);
            out.offerCleanup = junk;      // renderer asks; nothing is deleted on our own say-so
            out.partialRemoved = false;
            return out;
          } catch { /* rename failed - fall through and try the ordinary removal */ }
        }

        // ⚠️⚠️ RETRIED, BECAUSE THIS SILENTLY FAILED ON HIS CARD. He cancelled an export to a
        // board card and the partial folder was still there afterwards. A single `rm` here
        // looked sufficient and was not: on Windows a directory containing a file whose
        // handle is still open cannot be removed (EBUSY/EPERM), and the write stream's handle
        // release is asynchronous. The real fix is upstream - the copy now waits for 'close'
        // before unlinking - but this is the second line of defence for a handle held by
        // something else, and the failure it guards against is invisible without it.
        // ⚠️ `removed` is REPORTED, not swallowed: the renderer tells the user a partial may
        // still be at the destination rather than claiming a clean stop.
        let removed = false;
        for (let i = 0; i < 4 && !removed; i++) {
          try { await fs.promises.rm(targetDir, { recursive: true, force: true }); removed = true; }
          catch { await new Promise((r) => setTimeout(r, 100 * (i + 1))); }
        }
        out.partialRemoved = removed;
        return out;
      }
      // ── A real failure, not a cancel ──
      // ⚠️ THE ASIDE MUST BE PUT BACK HERE TOO. Without this, any mid-copy error - a full
      // card, an unreadable source - left the user's font parked under ORIGINAL.<name> while
      // the error message talked about something else entirely.
      // ⚠️⚠️ A DIFFERENTIAL WRITE UNDOES ITS JOURNAL; THE WHOLESALE SWAP BELOW WOULD DESTROY THE
      // FONT, for the reason spelled out on the cancel path above.
      if (_differential) {
        await _undoDifferential(targetDir, asideDir, _displaced, _created);
        restoredOriginal = true;
        try { if (asideDir && fs.existsSync(asideDir)) await fs.promises.rm(asideDir, { recursive: true, force: true }); }
        catch { /* reported through the thrown error below */ }
      } else if (asideDir) {
        try {
          if (fs.existsSync(targetDir)) {
            await fs.promises.rm(targetDir, { recursive: true, force: true });
          }
          await fs.promises.rename(asideDir, targetDir);
          restoredOriginal = true;   // ⚠️ stops the outer catch deleting what we just restored
        } catch { /* reported through the thrown error below */ }
      }
      throw err;
    }
    // ── The replacement landed whole: NOW the original can go ──────── [B-005 item 4]
    //
    // ⭐ This is the "and only then delete the original" half of the rule. Everything above
    // this line is reversible; past it, the new font is complete at the destination and the
    // parked copy is genuinely superseded.
    //
    // ⚠️ RENAMED TO DELETE.<name> BEFORE REMOVAL, NOT REMOVED DIRECTLY. On a board card the
    // recursive delete is a round trip per file and can run to minutes; the rename is
    // instant. So the user's replace is COMPLETE the moment the rename returns, and a
    // disposal that fails or gets interrupted leaves something whose name says exactly what
    // it is rather than a second copy of a font they would have to identify.
    //
    // ⚠️ Not fatal if it fails. The export succeeded; a leftover folder is untidy, not
    // broken, and turning it into an error would report a successful write as a failure.
    let replacedLeftover = null;
    // ⚠️ A DIFFERENTIAL REPLACE MAY HAVE PARKED NOTHING AT ALL - a font that only gained files
    // displaces none of them - so the aside folder never comes into existence. Renaming a path
    // that is not there would throw and be reported as a leftover that does not exist.
    if (asideDir && fs.existsSync(asideDir)) {
      const junk = path.join(destDir, `DELETE.${targetName}`);
      try {
        if (fs.existsSync(junk)) await rmWithRetry(junk);
        await fs.promises.rename(asideDir, junk);
        replacedLeftover = junk;
        // ⭐⭐ UNLINKED ONE AT A TIME SO THE BAR CAN CROSS IT. [B-005 item 7b, 2026-09-26]
        //
        // This is the same work the recursive rm below would do - it unlinks each file too - but
        // done here it can report. Disposal is the longest unrepresented stretch in a repair
        // (~23 ms per file, ~4.7 s for 200 of them), and it runs AFTER the write, so leaving it
        // silent is what puts a finished-looking bar in front of a still-working app.
        //
        // ⚠️ `_displaced` is exactly what is still parked: anything restored above was spliced
        // out of it. Failures are swallowed on purpose - the rm that follows is the backstop,
        // and this loop is only here to pace the bar.
        // ⚠️⚠️ THAT LINE SAID "the real guarantee" UNTIL [B-436] SHOWED IT WAS NOT ONE. A bare
        // `fs.rm(force)` can resolve while the directory survives, which is how an empty
        // `DELETE.<name>` was left on a local disk with nothing reported. It is `rmWithRetry`
        // now, which verifies the path is actually gone and throws if it is not.
        for (const rel of _displaced) {
          try { await fs.promises.unlink(path.join(junk, rel)); } catch {}
          if (typeof opts.onUnits === 'function') { try { opts.onUnits(PER_FILE_UNIT); } catch {} }
        }
        // Sweeps the now-empty directories, and anything the loop above could not remove.
        // ⚠️ VERIFIED, not merely attempted - see [B-436]. This is the call whose silent
        // non-removal produced the leftovers, and the one whose failure must now be reported.
        await rmWithRetry(junk);
        replacedLeftover = null;
      } catch {
        // Whatever stage it reached, report what is still on disk so the caller can say so.
        replacedLeftover = fs.existsSync(junk) ? junk
          : (fs.existsSync(asideDir) ? asideDir : null);
      }
    }
    // Record what we just wrote, with the destination's own timestamps, so the
    // next export can tell "unchanged since we wrote it" with stat calls instead
    // of reading the folder back. Best effort: a manifest we cannot write only
    // costs a re-read next time.
    // ⚠️ CARD-SYNC BOOKKEEPING, NOT PART OF THE FONT ([B-358], Ryan 2026-09-08:
    // the quick export "shouldn't be sending a manifest"). The save-to-card
    // flow wants it — that destination is a card the sync will re-read — but a
    // one-off copy to some folder must not seed a jmt-studio-manifest.json
    // there. (The gate stops NEW writes; a manifest an earlier export already
    // left at a destination is data and stays until the user removes it.)
    if (opts.syncManifest !== false) try {
      // [B-398] MEASURED HERE, NOT GUESSED: with the export path marked, a font export stalled
      // 1496ms inside copy:font while compare:font — the pass everyone assumed was the expensive
      // one — ran 229ms and never stalled. The copy itself already streams and yields; THIS was
      // the blocker. A synchronous hash of the whole font, after the copy, to record what was
      // written.
      const { collectFileRecordsAsync, breathe } = require('./soundFontFileHash');
      const recs = await collectFileRecordsAsync(srcDir);
      if (recs) {
        // [B-402] RETURNED, NOT WRITTEN — the CALLER commits everything the operation learned in
        // one write at the end. Writing here meant one write per exported item, and it silently
        // skipped any item the operation looked at but did not export (a font already identical
        // at the destination), so its hashes were thrown away and re-read on every later export.
        // These hashes are the library's and already in memory; nothing here reads the card.
        const observed = new Map();
        // ⚠️ statSync is cheap on local disk and NOT cheap against a card over USB — this stats
        // every file of the font at the DESTINATION. Cheap-per-call times hundreds of calls with
        // nothing yielding is the same shape as the hash above, just less obvious. [B-398]
        for (const r of recs) {
          if (!r || r.fileHash === '<empty>') continue;
          await breathe();
          try {
            const st = fs.statSync(path.join(targetDir, r.relPath));
            observed.set(r.relPath, [st.size, Math.round(st.mtimeMs), r.fileHash]);
          } catch {}
        }
        _observedOut = [...observed];
        _observedItem = targetName;
      }
    } catch {}
    // ⚠️ RETURNED, NOT DROPPED ([B-364]). This list was collected and then thrown away,
    // so a font whose export silently came up one file short said nothing at all - the
    // exact silent strip the feature exists to prevent. It is also what the removal
    // buttons hang off: no list reaching the renderer means no way to act.
    return { ok: true, destPath: targetDir, refused: _exportRefused,
             observedItem: _observedItem, observed: _observedOut, savedBytes: _savedOut,
             // Non-null only when a replace could not dispose of the superseded copy. The
             // export SUCCEEDED; this just names a folder still sitting at the destination.
             replacedLeftover };
  } catch (err) {
    // ⚠️⚠️ THE ASIDE MUST BE PUT BACK ON *EVERY* FAILURE PATH, NOT JUST THE COPY'S.
    //
    // Found reviewing this on 2026-09-21, and the inner catch hid it well. That one restores
    // `ORIGINAL.<name>` and sets `restoredOriginal` - but it only wraps
    // `copyTreeWithProgress`. Anything throwing OUTSIDE it lands here instead:
    // `mkdirSync(targetDir)`, the sync-manifest write, the disposal of the aside itself. On
    // any of those the user's font was left parked under a name they never chose, and the
    // error message said nothing about it.
    //
    // ⭐ Not lost - but renamed and unmentioned is its own kind of loss, and it is precisely
    // the divergence between what he believes is on disk and what is on disk that the
    // standing rule exists to prevent. Guarded by existsSync so it cannot fight the inner
    // restore or resurrect a disposal that already succeeded.
    // ⚠️⚠️ AND THE SAME SPLIT HERE, WHICH IS THE MOST DANGEROUS OF THE THREE because this handler
    // catches everything nobody thought of. Under a differential write `targetDir` is the user's
    // font and `asideDir` holds only the files this call parked - so `rm(targetDir)` followed by
    // renaming the aside into its place would trade a whole font for a handful of files, on a
    // path taken precisely when something unexpected went wrong. [B-005 item 7b]
    if (_differential && !restoredOriginal) {
      try {
        await _undoDifferential(targetDir, asideDir, _displaced, _created);
        restoredOriginal = true;
        if (asideDir && fs.existsSync(asideDir)) {
          await fs.promises.rm(asideDir, { recursive: true, force: true });
        }
      } catch { /* the original error is still reported below; nothing is destroyed here */ }
    } else if (asideDir && !restoredOriginal) {
      try {
        if (fs.existsSync(asideDir)) {
          if (fs.existsSync(targetDir)) {
            await fs.promises.rm(targetDir, { recursive: true, force: true });
          }
          await fs.promises.rename(asideDir, targetDir);
          restoredOriginal = true;
        }
      } catch { /* the original error is still reported below; nothing is destroyed here */ }
    }
    // Best-effort cleanup of a partial copy on failure so the user doesn't
    // end up with half a font folder mixed in with their other content.
    // ⚠️⚠️ NEVER WHEN THE ORIGINAL HAS BEEN RESTORED. targetDir then holds the user's own
    // font, put back by the failure path above, and this line would delete it - turning a
    // recoverable failure into data loss. The rm is only safe while that path can only
    // contain a partial WE wrote. [B-005 item 4]
    // ⚠️⚠️ AND NEVER FOR A DIFFERENTIAL WRITE, RESTORED OR NOT. This line's whole licence is that
    // `targetDir` could only ever hold a partial WE created. A differential replace writes INTO
    // the user's existing folder, so that licence is gone: here the line deletes the font.
    if (!restoredOriginal && !_differential) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
    }
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

// ⭐ THE REVERSE, AND IT IS markEntrySeen's SIBLING ON PURPOSE. [B-297]
//
// Until now NEW could only ever be SPENT, never restored: the four stamp paths are all side
// effects of doing something else, so a badge cleared by accident was gone for good. His call
// looking at the card menu 2026-09-13: "this should have mark as seen and mark as new".
//
// ⚠️ ONE CARD, BY RIGHT-CLICK, AND NOWHERE ELSE. Symmetry was PROPOSED AND REFUSED — "don't need
// a button for mark new. I'm ok with right click, but not bulk." A library-wide "mark all new"
// would light up every font at once, which is exactly the state the backfill exists to prevent.
// The forward direction is the everyday one; the reverse is a per-font correction, and a
// right-click is the right weight for it.
//
// ⚠️ Same single write path as its twin rather than a direct meta write, so the "first wins"
// rule and the read-modify-write live in one place and cannot drift apart.
// Returns true only when something actually changed, matching markEntrySeen's contract — the
// caller uses that to avoid claiming work it did not do.
function markEntryNew(userData, entryName) {
  const root = entriesRoot(userData);
  const metaPath = path.join(root, entryName, 'meta.json');
  if (!fs.existsSync(metaPath)) return false;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  catch { return false; }
  if (!meta.seenAt) return false;                // already New — nothing to undo
  delete meta.seenAt;
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
// ⚠️⚠️ THE MARKER LIVES WITH THE DATA IT GUARDS. [B-297]
//
// It used to be `seenBackfillDone` in prefs.json while `seenAt` is a field on each entry's
// meta.json in the library. Two stores, so they desync BOTH ways:
//   * prefs lost, library kept    -> the backfill re-runs and stamps the real NEW set as seen.
//     FOUND EXACTLY THIS WAY while staging QA TC-3136 (rename prefs.json away and launch): 109
//     entries that had genuinely never been opened were stamped, all now carrying
//     seenAt == createdAt. Measured, not inferred.
//   * prefs kept, library restored from backup -> flagged done, so restored entries that were
//     never stamped all light up NEW at once. That is precisely the state the backfill exists to
//     prevent, and it is the MORE likely direction because the app ships backup and restore.
//
// A marker in the library root travels with the library, so a restored library carries its own
// migration state and prefs.json stops being load-bearing for something it does not own.
//
// ⚠️ MOVE THE FLAG, NEVER DROP IT. The persisted flag is deliberately what stops this being "a
// nightly eraser" ([B-213]): without it, importing a font and restarting silently empties NEW.
function _backfillMarkerPath(userData) {
  return path.join(entriesRoot(userData), '.seen-backfill-done');
}
function seenBackfillDone(userData) {
  try { return fs.existsSync(_backfillMarkerPath(userData)); } catch { return false; }
}
function markSeenBackfillDone(userData) {
  try {
    fs.mkdirSync(entriesRoot(userData), { recursive: true });
    fs.writeFileSync(_backfillMarkerPath(userData), new Date().toISOString());
    return true;
  } catch { return false; }
}

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
// Has this entry been CUSTOMIZED — does its content differ from the source archive
// it was extracted from? [B-304]
//
// ⭐ THE REFERENCE POINT IS THE SOURCE FILE, NOT "the source as it stands now"
// (2026-09-03: "it's not now, it's from its source file"). A stored source
// archive is immutable, so this is a fixed comparison that cannot drift — the same
// distinction the context menu already draws between Duplicate and Duplicate from
// source.
//
// ⚠️ NOTHING IS EXTRACTED AND NOTHING IS RE-HASHED. Both sides already keep per-file
// manifests: the entry's own, and the source's covering every file in the archive.
// The source's paths are archive-relative, so stripping the entry's candidatePath
// prefix lines the two up directly. Verified on real data 2026-09-03: 90 records
// each side, names equal after the strip, hashes equal.
//
// Returns { ok, known, customized, added, removed, changed }. `known: false` means we
// could not tell — a missing manifest, no candidatePath — and a caller must show
// NOTHING in that case rather than guessing either way. An entry wrongly flagged as
// the user's own work is worse than an unflagged one.
function getEntryCustomization(userData, entryName) {
  const unknown = { ok: true, known: false, customized: false, added: 0, removed: 0, changed: 0 };
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(entriesRoot(userData), entryName, 'meta.json'), 'utf8')); }
  catch { return unknown; }
  if (!meta || !meta.sourceUuid || meta.candidatePath == null || !meta.entryUuid) return unknown;
  // A nested-zip candidate lives inside an inner archive, so the source manifest has
  // no records at that path to compare against. Not customized — unknowable.
  if (meta.nested) return unknown;

  // ── THE STAMP (2026-09-03) ─────────────────────────────────────────────────
  // Customization is a FACT ABOUT THE FONT, so it lives on the font rather than in
  // a cache beside it. The only place it can change is inside the entry the user is
  // editing, and every file op there sets contentHashDirty — so keying the stamp to
  // the content hash it was derived from makes it self-invalidating: the detail view
  // stays live, and every other view reads an answer that is already computed.
  // That is what makes the marker affordable in the 220-card grid, where computing
  // it live would be 220 round trips.
  // srcUuid is part of the key because re-pointing an entry at a different source
  // changes the comparison even when the entry's own bytes did not.
  // ⚠️ FRESHNESS IS CHECKED AGAINST THE DISK, NOT AGAINST A FLAG.
  // `contentHashDirty` only becomes true if a writer remembers to set it, and one
  // did not: a font with a file added by hand reported contentHash, manifest and
  // stamp all agreeing with each other and all describing 67 files while 68 sat on
  // disk — so it was permanently, confidently wrong about itself with nothing able
  // to notice. (Found 2026-09-04: a duplicate of that font read "Customized" while
  // the original it was copied from did not.)
  // getEntryContentHash already solves this the reliable way — it compares the live
  // file count and byte total against the stored ones and recomputes on any
  // mismatch, which no addition or deletion can slip past. Reusing it here costs one
  // stat-walk (no hashing) and removes a whole class of silent staleness.
  try { getEntryContentHash(userData, entryName); } catch {}
  try { meta = JSON.parse(fs.readFileSync(path.join(entriesRoot(userData), entryName, 'meta.json'), 'utf8')); }
  catch { return unknown; }
  if (!meta || !meta.entryUuid) return unknown;

  // st.v gates the CODE the stamp came from, not the content: v2 is the
  // empty-dir fix ([B-342]); v3 is the Customized TAG riding the stamp
  // ([B-346]) — entries stamped customized before v3 would otherwise never
  // get the tag, because their valid cache short-circuits the writer that
  // adds it. The bump makes every pre-tag stamp recompute once on its next
  // open and backfill the tag. Bump on any future change to what
  // "customized" means or carries.
  const st = meta.customization;
  if (!meta.contentHashDirty && meta.contentHash && st && st.v === 3
      && st.forHash === meta.contentHash && st.srcUuid === meta.sourceUuid) {
    return { ok: true, known: true, customized: !!st.customized, added: st.added|0,
             removed: st.removed|0, changed: st.changed|0, tracksOnly: !!st.tracksOnly, cached: true };
  }
  // Persist a KNOWN answer onto the entry. Deliberately never stamps `unknown`:
  // unknown usually means a manifest is missing, and those get backfilled — a
  // stamped unknown would make a recoverable gap permanent.
  const stamp = (res) => {
    try {
      const p = path.join(entriesRoot(userData), entryName, 'meta.json');
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      m.customization = {
        v: 3, // stamp version, see the cache check above ([B-342]/[B-346])
        customized: res.customized, tracksOnly: !!res.tracksOnly,
        added: res.added, removed: res.removed, changed: res.changed,
        forHash: m.contentHash || null, srcUuid: m.sourceUuid || null,
        at: new Date().toISOString(),
      };
      // ── The "Customized" TAG rides the stamp ([B-346], his spec) ──────────
      // This function runs exactly at RE-DETERMINATION (the cached path above
      // returns without ever reaching here), which is the delta-driven
      // lifecycle he ruled: add when determined true (no-op if tagged),
      // remove when determined false, and a MANUAL tag delete sticks — a
      // mere re-read hits the cache and never rewrites the tag; only a real
      // content change lands here and re-adds it. Case-insensitive on both
      // sides so a hand-typed "customized" counts as the tag.
      const _tags = Array.isArray(m.tags) ? m.tags : [];
      const _hasTag = _tags.some(t => String(t).toLowerCase() === 'customized');
      if (res.customized && !_hasTag) m.tags = [..._tags, 'Customized'];
      else if (!res.customized && _hasTag) m.tags = _tags.filter(t => String(t).toLowerCase() !== 'customized');
      fs.writeFileSync(p, JSON.stringify(m, null, 2));
    } catch {}
    return res;
  };

  // ⚠️ readFileHashManifest is required LOCALLY here. It is pulled in inside other
  // functions in this file rather than at module scope, so it is not in scope by
  // default — assuming it was is the kind of thing that parses fine and throws live.
  const { readFileHashManifest } = require('./soundFontFileHash');
  // ⚠️ FRESHNESS FIRST, or this answers from a stale manifest. Editing an entry's
  // files marks it dirty and leaves the manifest behind until something recomputes;
  // reading it blind meant the marker only caught up on the NEXT open, which is
  // exactly what showed up after deleting a file (2026-09-03). Same guard the
  // content-hash comparison in this file already uses: recompute when dirty, then
  // trust the manifest ONLY if its hash still matches the meta's.
  if (meta.contentHashDirty || !meta.contentHash) {
    try { recomputeEntryContentHash(userData, entryName); } catch {}
    try { meta = JSON.parse(fs.readFileSync(path.join(entriesRoot(userData), entryName, 'meta.json'), 'utf8')); }
    catch { return unknown; }
    if (!meta || !meta.entryUuid) return unknown;
  }
  const em = readFileHashManifest(fileHashManifestPath(userData, 'entries', meta.entryUuid));
  if (!em || !Array.isArray(em.records)) return unknown;
  // A manifest that no longer describes the entry is not evidence of anything.
  if (em.contentHash && meta.contentHash && em.contentHash !== meta.contentHash) return unknown;
  // Two locations, same order the source layer uses: the breadcrumb kept beside the
  // archive first, then the central store. (soundFontSources._loadSourceBreadcrumb
  // does exactly this and is private, so the order is mirrored rather than called.)
  const sDir = path.join(userData, 'soundFonts', 'sources', meta.sourceUuid);
  const sm = readFileHashManifest(path.join(sDir, '.jmt-source-manifest.json'))
    || readFileHashManifest(fileHashManifestPath(userData, 'sources', meta.sourceUuid));
  if (!sm || !Array.isArray(sm.records)) return unknown;

  const cp = String(meta.candidatePath || '');
  const pfx = cp ? cp + '/' : '';
  // ⚠️ EMPTY-DIR MARKERS ARE NOT CONTENT ([B-342]). The entry walker records an
  // empty directory as a '<empty>' marker; the source manifest walker records
  // nothing for it. Diffing the two verbatim made every font whose vendor
  // ships empty effect folders read "Customized: 2 added" the moment it was
  // imported — Ryan hit it on Volatile (empty bgndrag/ + enddrag/ in the
  // vendor's own Proffie folder) on the first [B-311] dev pass, and a fresh
  // copy-from-source lit up the same way. Filtered on BOTH sides so the answer
  // cannot depend on which walker wrote which manifest. An empty folder the
  // user adds is invisible to the marker, deliberately: no audio, no
  // customization — and the export still carries it via the marker records.
  const src = new Map();
  for (const r of sm.records) {
    if (!r || r.fileHash === '<empty>') continue;
    const rp = String(r.relPath || '');
    if (pfx && !rp.startsWith(pfx)) continue;
    src.set(rp.slice(pfx.length), r.fileHash);
  }
  // No records under that path at all: the manifest predates this source's shape, or
  // the candidate is not a plain subtree. Cannot tell.
  if (src.size === 0) return unknown;

  const lib = new Map(em.records
    .filter(r => r && r.fileHash !== '<empty>')  // same rule as the source side ([B-342])
    .map(r => [String(r.relPath || ''), r.fileHash]));
  // ⭐ TRACKS ARE THEIR OWN STATE, not an exclusion (2026-09-03:
  // "Customized (tracks only)"). Measured on a real library the day this was built:
  // 50 of 220 entries differ from their source, and 31 of those differ ONLY by
  // tracks/ — music added through the shared-tracks feature rather than by editing
  // font files. Folding them in makes the marker common and therefore ignorable;
  // dropping them hides a real difference that an export still has to carry. So it
  // reports WHICH, and the label says which.
  const isTrack = (k) => k === 'tracks' || k.startsWith('tracks/');
  let added = 0, removed = 0, changed = 0, nonTrack = 0;
  for (const [k, h] of lib) {
    if (!src.has(k)) { added++; if (!isTrack(k)) nonTrack++; }
    else if (src.get(k) !== h) { changed++; if (!isTrack(k)) nonTrack++; }
  }
  for (const k of src.keys()) if (!lib.has(k)) { removed++; if (!isTrack(k)) nonTrack++; }
  const customized = (added + removed + changed) > 0;
  return stamp({
    ok: true, known: true, customized, added, removed, changed,
    // Only meaningful when customized. True = every difference is in tracks/.
    tracksOnly: customized && nonTrack === 0,
  });
}

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

// [B-398] Measurement only: markAsync/mark return the ORIGINAL function when the probe is off.
const _sp = require('./stallProbe');
// Record what is in a destination folder we have been told to KEEP.
//
// Called when the user answers Skip for a font that differs. Skip means "leave the card's version
// alone", which makes that folder theirs-and-ours: a file they chose to keep is one we maintain,
// even though we never wrote it. So this walks what is actually on the card - including files the
// library does not have - and hashes all of it.
//
// ⚠️ THE OTHER SIDE OF THE DEFERRAL IN `entryMatchesAt`. That compare returns as soon as a
// differing file count proves a difference, without reading anything, because at that moment
// nobody knows whether the folder is about to be overwritten. Replace makes the reading pointless;
// Skip makes it worth doing. This is the Skip half, run when the answer exists.
//
// ⚠️ EVERY file, not the library's list. The whole point is the files the library has no record
// of: hashing them now is what lets a later import of those same files into the library resolve
// to "already there" without re-reading the card.
//
// Returns [[relPath, [size, mtimeMs, hash]], ...] - the shape `syncManifest:commit` takes, as an
// array because a Map does not survive IPC.
async function recordFolderAt(destDir, name, opts = {}) {
  if (!destDir || !name) return { ok: false, error: 'Missing destDir or name' };
  const folder = path.join(destDir, name);
  try { if (!fs.statSync(folder).isDirectory()) return { ok: true, observed: [] }; }
  catch { return { ok: true, observed: [] }; }

  const { hashFileAsync, breathe } = require('./soundFontFileHash');
  const sync = require('./sfSyncManifest');

  // ⚠️ REUSE WHAT IS ALREADY RECORDED. Only the files the manifest cannot answer for need
  // reading - which, for a folder that differs because something was ADDED to it, is the added
  // file and nothing else. Re-hashing the whole folder would re-read tens of megabytes to learn
  // what is already written down, on the transport where that costs the most.
  //
  // Same validity rule the compare uses: size must match and mtime must be within the FAT32
  // tolerance, or the entry is stale and the file is read.
  let cache = new Map();
  try { cache = sync.cacheFor(destDir, name); } catch {}

  // ⚠️ THE WALK IS COLLECTED FIRST SO THE WORK CAN BE SIZED. Without a total the bar has nothing
  // to be a fraction OF, and a phase that reads whole wavs off a card with a motionless bar is
  // the "is it hung" shape this surface keeps having to remove. Directory reads and stats are
  // metadata - cheap next to the hashing that follows.
  const files = _walkDestFolder(folder);

  // ⚠️ BYTES, NOT FILE COUNT, and for the reason the tracks add already records: a file-count bar
  // sits at 99 of 100 with a third of the data still to move. Reported on the same channel
  // `entryMatchesAt` uses, so the renderer subscribes to one thing rather than learning a new one.
  const _onBytes = typeof opts.onBytes === 'function' ? opts.onBytes : null;
  const _total = files.reduce((n, f) => n + (f.size || 0), 0);
  let _done = 0;
  if (_onBytes) { try { _onBytes({ done: 0, total: _total, name: '' }); } catch {} }

  const observed = [];
  {
    for (const f of files) {
      if (opts.shouldStop && opts.shouldStop()) return { ok: true, canceled: true };
      const childAbs = f.abs, childRel = f.rel;
      // ⚠️ Per file: this reads whole wavs off a card, which is the block [B-398] measured.
      await breathe();
      try {
        const ent = cache.get(childRel);
        const valid = sync.entryValid(ent, f.size, f.mtime);
        const h = valid ? ent[2] : (sync.countHash(), await hashFileAsync(childAbs));
        if (h) observed.push([childRel, [f.size, f.mtime, h]]);
      } catch { /* a file that cannot be read simply goes unrecorded, and is re-read next time */ }
      // ⚠️ CREDITED WHETHER IT WAS READ OR REUSED. A reused entry costs no I/O, but it is still
      // one of the files this phase has to get through - crediting only the hashed ones would
      // stall the bar across every folder the manifest can already answer for, which is most of
      // them.
      _done += (f.size || 0);
      if (_onBytes) { try { _onBytes({ done: _done, total: _total, name: childRel }); } catch {} }
    }
  }
  // ⚠️ COMPLETE ONLY BECAUSE IT RAN TO THE END. Every stop above returns `canceled` with no
  // observations, so a partial walk can never license the caller to delete anything.
  return { ok: true, observedItem: name, observed, complete: true };
}

// ══ WHAT A REPLACE ACTUALLY HAS TO WRITE ══════════════════ [B-005 item 7b, 2026-09-26]
//
// ⭐⭐ THE SPLIT THIS CLOSES, and it was measured rather than argued. Detection has been
// per-file for a while; the WRITE was not. One wav deleted from G-Grievous outside the app was
// caught instantly and for free - a missing file is a failed stat, not a hash - and Replace then
// rewrote the whole 44.6 MB folder to put back 2.1 MB. A second case was purer still: two fonts
// differed ONLY because files had been ADDED to them on the card, so there was nothing to write
// at all, and Replace moved 64.3 MB across them anyway (~100 s on a board card).
//
// ⚠️⚠️ WHICH IS WHY REPLACE CANNOT SIMPLY BECOME ADDITIVE. With no library change an additive
// write does nothing and the extras survive - the opposite of what Replace was asked for. The
// operation is MAKE IT MATCH, so it has two halves and this function returns both: the files to
// write, and the files to get rid of.
//
// ⭐ `known` IS THE SCAN'S OWN OBSERVATIONS, and passing them is what stops the changed files
// being hashed TWICE. The export scan hashes what the manifest could not answer for, but its
// findings are not committed to the card until the end of the whole operation - so without this
// the write would re-hash exactly the files that changed, which are the expensive ones.
//
// Returns { ok, toWrite:[rel], toDisplace:[rel], unchanged, bytesToWrite, reused, hashed }.
// ⚠️ `toDisplace` paths are DESTINATION-relative and may name files no library ever had. Nothing
// here deletes anything - a plan is a question, and the caller decides what to do with it.
async function planFolderWrite(userData, name, destDir, opts = {}) {
  if (!userData || !name || !destDir) return { ok: false, error: 'Missing userData, name or destDir' };
  const srcDir = path.join(entriesRoot(userData), name);
  const targetDir = path.join(destDir, name);
  if (!fs.existsSync(srcDir)) return { ok: false, error: `Entry not found: ${name}` };

  const libRecords = _libRecordsFor(userData, name, srcDir);
  if (!libRecords) return { ok: false, error: `Cannot read the library copy of ${name}` };

  const { hashFileAsync, breathe } = require('./soundFontFileHash');
  const sync = require('./sfSyncManifest');
  const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : null;
  const onBytes = typeof opts.onBytes === 'function' ? opts.onBytes : null;

  // Destination side, one stat per file, and the walk doubles as the extras census.
  const present = new Map();
  for (const f of _walkDestFolder(targetDir)) present.set(f.rel, f);

  // ⚠️ THE SCAN'S OBSERVATIONS WIN OVER THE CARD'S MANIFEST, because they are NEWER. The manifest
  // on the card still describes the state before this operation started.
  let cache = new Map();
  try { cache = sync.cacheFor(destDir, name); } catch {}
  if (opts.known) { for (const [rel, v] of opts.known) cache.set(rel, v); }

  const toWrite = [], toDisplace = [];
  let unchanged = 0, bytesToWrite = 0, reused = 0, hashed = 0;
  // ⭐⭐ HOW MANY FILES GET MOVED ASIDE, which is the cost a byte count cannot see. Measured on a
  // card 2026-09-26: parking is ~30 ms per file and disposing ~23 ms per file, both INDEPENDENT of
  // file size - 200 files of 4 KB dispose in 4765 ms while 4 files of 10 MB dispose in 265 ms.
  // Only a file that is already at the destination is parked; a missing one is written outright.
  let parkCount = 0;

  // ⚠️ `<empty>` RECORDS ARE DIRECTORY MARKERS, NOT FILES. They carry no content to compare and
  // the copy walker creates directories on its own, so counting them would report work that does
  // not exist.
  const libFiles = libRecords.filter((r) => r && r.fileHash !== '<empty>');
  const libSet = new Set(libFiles.map((r) => r.relPath));

  // Only the files that must be READ are worth a progress total - the rest is metadata.
  const _total = libFiles.reduce((n, r) => {
    const f = present.get(r.relPath);
    return n + (f && !sync.entryValid(cache.get(r.relPath), f.size, f.mtime) ? (f.size || 0) : 0);
  }, 0);
  let _done = 0;
  if (onBytes) { try { onBytes({ done: 0, total: _total, name: '' }); } catch {} }

  for (const r of libFiles) {
    // ⚠️ BETWEEN FILES, like every other per-file loop here: one iteration can hash a whole wav
    // off a card, so a check only at the top would be no better than none.
    if (shouldStop && shouldStop()) return { ok: true, canceled: true };
    const f = present.get(r.relPath);
    if (!f) { toWrite.push(r.relPath); bytesToWrite += (r.size || 0); continue; }
    const ent = cache.get(r.relPath);
    let destHash;
    if (sync.entryValid(ent, f.size, f.mtime)) { destHash = ent[2]; reused++; }
    else {
      await breathe();
      sync.countHash();
      destHash = await hashFileAsync(f.abs);
      hashed++;
      _done += (f.size || 0);
      if (onBytes) { try { onBytes({ done: _done, total: _total, name: r.relPath }); } catch {} }
    }
    // ⚠️ AN UNREADABLE DESTINATION FILE IS NOT A MATCH. A null hash means we could not check, and
    // the safe reading of "could not check" during a MAKE IT MATCH is to write it.
    if (destHash && destHash === r.fileHash) unchanged++;
    // Present and differing, so its copy is parked before the replacement is written.
    else { toWrite.push(r.relPath); bytesToWrite += (r.size || 0); parkCount++; }
  }

  // ⭐ THE OTHER HALF. Anything at the destination the library does not have is what makes
  // Replace mean "make it match" rather than "add to it".
  for (const rel of present.keys()) if (!libSet.has(rel)) { toDisplace.push(rel); parkCount++; }

  // ⚠️ `bytesTotal` IS THE WHOLE FONT, and the caller needs it to keep a progress bar honest:
  // the denominator was sized from the font, so the bytes this plan does NOT write have to be
  // credited or the bar can never arrive. [B-360: the answer to a bar that will not finish is
  // the right denominator, not a clamp.]
  const bytesTotal = libFiles.reduce((n, r) => n + (r.size || 0), 0);
  return { ok: true, toWrite, toDisplace, unchanged, bytesToWrite, bytesTotal, reused, hashed,
           parkCount, workBytes: planWorkBytes({ bytesToWrite, parkCount }),
           libFiles: libFiles.length, destFiles: present.size };
}

// ⭐⭐ WHAT THIS REPAIR WILL ACTUALLY COST, IN ONE CURRENCY. [B-005 item 7b, 2026-09-26]
//
// The progress bar is sized from this and advanced by the same quantities, so the two cannot
// drift: every byte in `bytesToWrite` is reported by the copier, and every parked file is
// reported twice, once when it is moved aside and once when it is disposed of.
//
// ⚠️⚠️ THE WORK IS NOT ONLY BYTES, which is why this exists rather than using `bytesToWrite`
// directly. Measured on a card 2026-09-26, two runs: parking a file costs ~30 ms and disposing of
// it ~23 ms, both INDEPENDENT of its size. 200 files of 4 KB dispose in 4765 ms while 4 files of
// 10 MB dispose in 265 ms - 18x longer for one fiftieth of the data. A repair therefore pays per
// file three times (park, write, dispose) and only the write was ever on the bar: ~53 ms per file
// of invisible work, which is ~11 s sitting at 100% on a 200-file voicepack, and that is the
// stretch where someone force-quits mid-write. Through a board the per-file cost rises further,
// since each one is a USB round trip, so weighting by bytes alone is wrong in exactly the
// direction that hurts most.
//
// ⚠️ A FONT CAN COST MORE IN FILES THAN IN BYTES, and that is not an error to clamp away - a
// folder whose only change is forty small extras writes nothing at all and still has real work
// to show.
function planWorkBytes(plan) {
  if (!plan) return 0;
  return (plan.bytesToWrite || 0) + (plan.parkCount || 0) * 2 * PER_FILE_UNIT;
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
  entryMatchesAt: _sp.markAsync('compare:font', entryMatchesAt),
  recordFolderAt: _sp.markAsync('record:kept', recordFolderAt),
  exportEntryToFolder: _sp.markAsync('copy:font', exportEntryToFolder),
  planFolderWrite: _sp.markAsync('plan:font', planFolderWrite),
  planWorkBytes,
  entryFolderExistsAt,
  listEntryFiles,
  migrateSourceLevelFields,
  recomputeEntryContentHash,
  getEntryContentHash,
  getEntryCustomization,
  markEntryContentDirty,
  markEntrySeen,
  markEntryNew,
  seenBackfillDone,
  markSeenBackfillDone,
  backfillSeenAt,
  resolveEntryContentDirty,
  computeEntryEffects,
  recomputeEntryEffects,
  markEntryEffectsDirty,
  resolveEntryEffectsDirty,
};
