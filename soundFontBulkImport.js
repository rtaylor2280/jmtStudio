// Sound Fonts — bulk import (Phase 1 of the bulk-import feature).
//
// Two-phase contract:
//   1. scanForBulkImport(rootDir)      — fast disk walk, classifies what's
//                                        there. No hashing, no copying, no
//                                        network. Returns a plan the user
//                                        can review before committing.
//   2. runBulkImport(plan, userData,   — drives importSource + createEntry
//      callbacks)                       per planned source. Marks entries
//                                        as needsReview when required
//                                        fields couldn't be auto-filled.
//
// Partitioning rule (per spec):
//   - Zip file              -> one source. detectCandidates handles the
//                              internal candidate shape (multi-board,
//                              multi-font bundles, etc).
//   - Proffie-shape folder  -> one solo source per folder. Bulk never
//                              auto-bundles adjacent folders because
//                              there's no structural signal to tell
//                              "this was a single vendor delivery" from
//                              "user loosely organized N fonts together"
//                              (Ryan's SD backup is N loose fonts; an
//                              extracted vendor bundle has identical
//                              shape). If a user truly has a folder-form
//                              bundle they want preserved, they pick its
//                              root via the existing "Import folder"
//                              path, which lets detectCandidates run on
//                              the multi-board structure.
//   - Common folder         -> recognized but skipped in v1 (separate
//                              import surface owns common folders).
//
// Depth failsafe: if we descend past 6 levels without finding ANY Proffie
// shape OR zip, surface depthHalted=true so the caller can prompt the user
// before continuing further.

const fs = require('fs');
const path = require('path');
const { cleanSuggestedName } = require('./soundFontNameClean');
const soundFontSources = require('./soundFontSources');
const soundFontCandidates = require('./soundFontCandidates');
const soundFontEntries = require('./soundFontEntries');
const soundFontVendors = require('./soundFontVendors');
const soundFontCommon = require('./soundFontCommon');
const soundFontSharedTracks = require('./soundFontSharedTracks');
const soundFontFileHash = require('./soundFontFileHash');
const { checkWavBuffer, deriveFontName, docxToText, nameFromReadmeText } = require('./sdCardDetect');

const MAX_SCAN_DEPTH_BEFORE_HALT = 6;

// One read pass over a font folder that yields, together, everything the import
// would otherwise compute later ("quick import, ahead of time"):
//   - fileHashes: the per-file hash set { relPath: sha256 } over the REAL font
//     content (noise like ._*, .DS_Store, __MACOSX excluded — the same files the
//     import strips when it zips). Per-file is what enables percent-match, not
//     just exact-match.
//   - contentHash: those records folded into one digest for cheap exact-dedup.
//   - corruptFiles: [{ relPath, reason }] — wavs are header-checked off the SAME
//     buffer the hash reads, so nothing is read twice.
// Returns null when the folder can't be read.
function hashAndCheckFont(absDir) {
  const corruptFiles = [];
  const notNoise = (rel) => !soundFontSources.isNoisePath(rel);
  const records = soundFontFileHash.collectFileRecords(absDir, (relPath, buf, size) => {
    if (!/\.wav$/i.test(relPath) || !buf) return;
    const h = checkWavBuffer(buf, size);
    if (h && h.corrupt) corruptFiles.push({ relPath, reason: h.reason });
  }, notNoise);
  if (records === null) return null;
  const fileHashes = {};
  for (const r of records) fileHashes[r.relPath] = r.fileHash;
  return { contentHash: soundFontFileHash.hashRecords(records), fileHashes, corruptFiles };
}

// Noise file/dir segments we never want to descend into or count as
// content. Mirrors soundFontCandidates.isNoiseSegment but local so the
// module doesn't need to re-export it.
function isNoiseName(name) {
  if (name === '__MACOSX') return true;
  if (name === '.DS_Store') return true;
  if (name === 'Thumbs.db' || name === 'desktop.ini') return true;
  if (name.startsWith('._')) return true;
  return false;
}

// Detect Proffie-shape on a folder by reading its direct children.
// Matches the convention used by soundFontCandidates.looksLikeProffieFont
// but operates on a real on-disk path instead of an in-memory entries list.
function looksLikeProffieDir(absDir) {
  const EFFECT_FOLDERS = new Set([
    'boot', 'hum', 'swingh', 'swingl', 'clsh', 'blst', 'lock', 'force', 'in',
    'out', 'font', 'lb', 'bgnlb', 'endlb', 'bgnlock', 'endlock', 'melt',
    'bgnmelt', 'endmelt', 'drag', 'bgndrag', 'enddrag', 'swng', 'spin', 'stab',
    'preon', 'pwroff', 'pstoff',
  ]);
  const CORE_EFFECT_FILE = /^(boot|hum|font)\d*\.wav$/i;
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return false; }
  for (const e of entries) {
    if (isNoiseName(e.name)) continue;
    if (e.isDirectory()) {
      const lower = e.name.toLowerCase();
      if (EFFECT_FOLDERS.has(lower)) return true;
      if (/^alt\d{3}$/i.test(e.name)) return true;
    } else if (e.isFile()) {
      if (CORE_EFFECT_FILE.test(e.name)) return true;
    }
  }
  return false;
}

// Detect Proffie's "common" shared-wav folder convention. A common folder
// is one named "common" (any case) whose direct content is .wav files OR
// effect-name subdirs containing .wav files. We're permissive on shape
// because users name common folders by intent, not pattern.
function looksLikeCommonDir(name) {
  return /^common$/i.test(name);
}

// Detect Proffie's "tracks" shared-music folder convention. A tracks
// folder is one named "tracks" (any case) — the SD-card convention for
// menu/background music. Like common, this gets routed to its own
// bucket so the bulk runner can wire it into the shared-tracks importer
// rather than treating it as a font or skipping it.
function looksLikeTracksDir(name) {
  return /^tracks$/i.test(name);
}

// Classify direct children of a folder into four buckets used by the
// walker. Common folders are checked by NAME before Proffie-shape so
// "common" wins over the shape match (a common folder's shared wavs like
// boot.wav would otherwise trip the Proffie-file detector). Proffie
// children are further tagged with their board (e.g. proffie, cfx,
// verso) when their name matches a board pattern; that lets the walker
// distinguish a multi-board font from a bundle of unrelated fonts.
function classifyChildrenAt(absDir) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return { kind: 'unreadable', proffieChildren: [], commonChildren: [], tracksChildren: [], otherFolders: [], zips: [] }; }
  const proffieChildren = [];
  const commonChildren = [];
  const tracksChildren = [];
  const otherFolders = [];
  const zips = [];
  for (const e of entries) {
    if (isNoiseName(e.name)) continue;
    const full = path.join(absDir, e.name);
    if (e.isDirectory()) {
      if (looksLikeCommonDir(e.name)) {
        commonChildren.push({ name: e.name, absPath: full });
      } else if (looksLikeTracksDir(e.name)) {
        tracksChildren.push({ name: e.name, absPath: full });
      } else if (looksLikeProffieDir(full)) {
        const board = soundFontCandidates.identifyBoard(e.name);
        proffieChildren.push({ name: e.name, absPath: full, board });
      } else {
        otherFolders.push({ name: e.name, absPath: full });
      }
    } else if (e.isFile()) {
      if (/\.zip$/i.test(e.name)) zips.push({ name: e.name, absPath: full });
    }
  }
  return { kind: 'classified', proffieChildren, commonChildren, tracksChildren, otherFolders, zips };
}

// Recursive walk: at each directory, decide one of:
//   - Zips at this level -> emit each as a source
//   - This dir IS itself a Proffie shape -> emit dir as solo source (handled
//     by caller before descending in)
//   - Multiple Proffie-shape children -> emit this dir as bundled source
//   - One Proffie-shape child + other content -> emit child as solo, recurse
//     into other folders
//   - All other folders, no Proffie -> recurse into each
function walkForSources(absDir, relPath, depth, ctx) {
  if (depth > MAX_SCAN_DEPTH_BEFORE_HALT && ctx.results.sources.length === 0
      && ctx.results.commonFolders.length === 0
      && ctx.results.tracksFolders.length === 0) {
    ctx.results.depthHalted = true;
    return;
  }
  const classification = classifyChildrenAt(absDir);
  if (classification.kind === 'unreadable') {
    ctx.results.skipped.push({ absPath: absDir, reason: 'unreadable' });
    return;
  }
  const { proffieChildren, commonChildren, tracksChildren, otherFolders, zips } = classification;
  // Common folders surface as their own bucket. The runner wires them
  // into soundFontCommon.importCommonFromFolder.
  for (const c of commonChildren) {
    ctx.results.commonFolders.push({
      absPath: c.absPath,
      relPath: path.join(relPath, c.name),
      name: c.name,
    });
  }
  // Tracks folders surface as their own bucket. The runner wires the
  // .wav files inside into soundFontSharedTracks.addFiles. Bulk import
  // doesn't try to merge multiple tracks folders into one bucket — the
  // shared-tracks dest is global, so addFiles handles dedup-by-name
  // across all sources automatically.
  for (const t of tracksChildren) {
    ctx.results.tracksFolders.push({
      absPath: t.absPath,
      relPath: path.join(relPath, t.name),
      name: t.name,
    });
  }
  // Zips at this level: each is its own source.
  for (const z of zips) {
    ctx.results.sources.push({
      kind: 'zip',
      absPath: z.absPath,
      relPath: path.join(relPath, z.name),
      rawName: z.name.replace(/\.zip$/i, ''),
      cleanedName: cleanSuggestedName(z.name.replace(/\.zip$/i, '')),
      sizeBytes: safeStatSize(z.absPath),
    });
  }
  // Multi-board case: when every Proffie-shape direct child has a
  // recognized board name (Proffie, CFX, Verso, Asteria, Xeno, etc.),
  // those children are board variants of the PARENT font, not
  // independent fonts. Emit the parent as a single source and skip
  // descending so we don't double-count. Mirrors detectMultiBoardSiblings
  // in the single-import path. Only applies when the parent is a
  // non-root, non-board-named folder (so we don't accidentally collapse
  // the picked root into a one-font import when the user pointed at a
  // top-level collection).
  const allBoardNamed = proffieChildren.length > 0
    && proffieChildren.every(p => !!p.board);
  const parentName = path.basename(absDir);
  const parentIsBoardNamed = !!soundFontCandidates.identifyBoard(parentName);
  if (allBoardNamed && !parentIsBoardNamed) {
    const _nm = folderSourceName(absDir, parentName, false);
    ctx.results.sources.push({
      kind: 'folder-solo',
      absPath: absDir,
      relPath,
      rawName: parentName,
      cleanedName: _nm.name,
      nameSource: _nm.source,
      sizeBytes: safeDirSize(absDir),
    });
    return;
  }
  // Otherwise: every Proffie-shape direct child is its own solo source.
  // No auto-bundling — see header comment for the rationale.
  const _series = numberedSeriesMembers(proffieChildren.map(p => p.name));
  for (const p of proffieChildren) {
    const _nm = folderSourceName(p.absPath, p.name, _series.has(p.name));
    ctx.results.sources.push({
      kind: 'folder-solo',
      absPath: p.absPath,
      relPath: path.join(relPath, p.name),
      rawName: p.name,
      cleanedName: _nm.name,
      nameSource: _nm.source,
      sizeBytes: safeDirSize(p.absPath),
    });
  }
  // Recurse into non-Proffie, non-common subfolders. Track per-recurse
  // whether we found anything; a folder that produced zero sources and
  // zero common folders gets logged as skipped so the user can see what
  // was scanned-but-empty (e.g. a placeholder dir, a half-deleted font).
  for (const f of otherFolders) {
    const beforeSources = ctx.results.sources.length;
    const beforeCommons = ctx.results.commonFolders.length;
    walkForSources(f.absPath, path.join(relPath, f.name), depth + 1, ctx);
    const noFinds = ctx.results.sources.length === beforeSources
      && ctx.results.commonFolders.length === beforeCommons;
    if (noFinds && depth === 1) {
      // Only log skips at the top-level depth so the user sees what
      // directly-picked-folder contains, not every nested empty dir
      // along the way.
      ctx.results.skipped.push({
        absPath: f.absPath,
        relPath: path.join(relPath, f.name),
        reason: 'no Proffie content found',
      });
    }
  }
}

function safeStatSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function safeDirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (isNoiseName(e.name)) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) total += safeStatSize(full);
    }
  }
  return total;
}

// Names that are just a shared prefix plus a trailing number — Bank01/Bank02,
// Preset1/Preset2, or any prefix a given card happens to use — are slot names, not
// real font names (nobody names actual fonts Something01..SomethingNN). Detect the
// series across the sibling set and return the members, so their folder name gets
// distrusted and the readme/name-tag lookup drives the suggested name instead.
function numberedSeriesMembers(names) {
  const groups = new Map();
  for (const n of names) {
    const m = /^(.*?)(\d+)$/.exec(n);
    if (!m) continue;
    const prefix = m[1].toLowerCase().replace(/[\s_-]+$/, '');
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(n);
  }
  const members = new Set();
  for (const arr of groups.values()) {
    if (arr.length >= 3) arr.forEach(n => members.add(n));
  }
  return members;
}

// Suggested name for a folder-solo source. For a generic slot folder (its own name
// matches a known slot pattern, or `forceGeneric` from the sibling series) we let
// deriveFontName walk the confidence ladder (readme content -> name-tag -> folder).
// For a folder that already carries a real name we keep the import's own cleaner so
// existing naming is unchanged. Returns { name, source } — source feeds the review
// screen's low-confidence flag ('folder-fallback' = a generic name we couldn't better).
function folderSourceName(absDir, folderName, forceGeneric) {
  try {
    const d = deriveFontName(absDir, folderName, { forceGeneric });
    // Route discovered names through the app's default cleaner too, so a name-tag
    // "ben solo" or readme "DarkWolf" lands in the same underscore / Title-Case /
    // disk-safe convention as every other suggested name (deriveFontName finds the
    // name; cleanSuggestedName formats it). Fall back to the raw name if the cleaner
    // reduces it to nothing (a name made entirely of stripped tokens).
    if (d && (d.source === 'readme' || d.source === 'name-tag')) {
      return { name: cleanSuggestedName(d.name) || d.name, source: d.source };
    }
    if (d && d.source === 'folder-fallback') return { name: cleanSuggestedName(folderName), source: 'folder-fallback' };
  } catch { /* fall through to the plain cleaner */ }
  return { name: cleanSuggestedName(folderName), source: 'folder' };
}

// scanForBulkImport({ rootDir }) -> { ok, plan }
//   plan: {
//     rootDir,
//     sources: [{ kind, absPath, relPath, rawName, cleanedName, sizeBytes,
//                  candidateCount? }],
//     commonFolders: [{ absPath, relPath, name }],
//     skipped: [{ absPath, reason }],
//     depthHalted: bool,
//     totalSizeBytes,
//   }
// Pass 1: walk + classify. No hashing, no dedup. Fast enough to run on
// the renderer's "open this folder" click and show a summary right away.
function scanForBulkImport({ rootDir }) {
  if (!rootDir) return { ok: false, error: 'Missing rootDir' };
  if (!fs.existsSync(rootDir)) return { ok: false, error: `Folder not found: ${rootDir}` };
  let stat;
  try { stat = fs.statSync(rootDir); }
  catch (err) { return { ok: false, error: `Cannot stat folder: ${err.message}` }; }
  if (!stat.isDirectory()) return { ok: false, error: 'Picked path is not a folder' };
  const ctx = {
    results: {
      rootDir,
      sources: [],
      commonFolders: [],
      tracksFolders: [],
      skipped: [],
      depthHalted: false,
      totalSizeBytes: 0,
    },
  };
  // If the picked root itself IS a Proffie shape, emit as solo and skip
  // descent. Common single-font-folder case from "Import folder" workflow.
  if (looksLikeProffieDir(rootDir)) {
    const _nm = folderSourceName(rootDir, path.basename(rootDir), false);
    ctx.results.sources.push({
      kind: 'folder-solo',
      absPath: rootDir,
      relPath: '',
      rawName: path.basename(rootDir),
      cleanedName: _nm.name,
      nameSource: _nm.source,
      sizeBytes: safeDirSize(rootDir),
    });
  } else {
    walkForSources(rootDir, '', 1, ctx);
  }
  let totalSize = 0;
  for (const s of ctx.results.sources) totalSize += s.sizeBytes || 0;
  ctx.results.totalSizeBytes = totalSize;
  return { ok: true, plan: ctx.results };
}

// runBulkImport({ plan, userData }, callbacks)
//   callbacks: { onProgress(payload), shouldCancel() }
//   Returns: { ok, summary: { imported: [...], skipped: [...], failed: [...] } }
// Each planned source:
//   1. Pipe through soundFontSources.importSource (handles hash + dedup +
//      copy + meta).
//   2. On dedup hit, record in summary.skipped and continue.
//   3. On success, detect candidates and create entries for every
//      candidate; mark each entry needsReview when required fields can't
//      be populated.
async function runBulkImport({ plan, userData }, callbacks = {}) {
  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : () => {};
  const shouldCancel = typeof callbacks.shouldCancel === 'function' ? callbacks.shouldCancel : () => false;
  const summary = { imported: [], skipped: [], failed: [], commonsImported: [], commonsSkipped: [], commonsFailed: [], tracksAdded: 0, tracksSkipped: 0, tracksFailed: 0, cancelled: false };
  if (!plan || !Array.isArray(plan.sources)) return { ok: false, error: 'Invalid plan' };
  const total = plan.sources.length;
  for (let i = 0; i < total; i++) {
    if (shouldCancel()) { summary.cancelled = true; break; }
    const src = plan.sources[i];
    onProgress({ stage: 'source-start', sourceIdx: i, total, label: src.cleanedName || src.rawName });
    try {
      const result = await importPlannedSource({ userData, src, fromSdCard: !!plan.fromSdCard }, (subProgress) => {
        onProgress({ stage: 'source-progress', sourceIdx: i, total, label: src.cleanedName || src.rawName, sub: subProgress });
      });
      if (result.dedup) {
        summary.skipped.push({ src: src.relPath || src.absPath, reason: 'already-in-library', existingUuid: result.existingUuid });
      } else if (result.ok) {
        summary.imported.push({
          src: src.relPath || src.absPath,
          sourceUuid: result.sourceUuid,
          entries: result.entries,
          bundleName: result.bundleName,
          multiCandidate: !!result.multiCandidate,
          versionsSkipped: result.versionsSkipped || 0,
          variantsEmitted: result.variantsEmitted || 0,
          strippedFiles: result.strippedFiles || [],
        });
      } else {
        summary.failed.push({ src: src.relPath || src.absPath, reason: result.error });
      }
    } catch (err) {
      summary.failed.push({ src: src.relPath || src.absPath, reason: String(err && err.message || err) });
    }
  }
  // Common folders: now imported as part of bulk (previously catalogued
  // but skipped per v1 scope). Each folder lands in the common bucket via
  // the same importCommonFromFolder API the manual common-import flow
  // uses, so dedup-by-name and wav-presence checks apply identically.
  // Name comes from the folder basename; user can rename post-import.
  const commons = Array.isArray(plan.commonFolders) ? plan.commonFolders : [];
  for (let i = 0; i < commons.length; i++) {
    if (shouldCancel()) { summary.cancelled = true; break; }
    const c = commons[i];
    onProgress({ stage: 'common-start', commonIdx: i, totalCommons: commons.length, label: c.name });
    try {
      const result = await soundFontCommon.importCommonFromFolder(userData, c.absPath, c.name);
      if (result && result.ok) {
        summary.commonsImported.push({ src: c.relPath || c.absPath, uuid: result.uuid, name: result.name });
      } else if (result && /already exists/i.test(result.error || '')) {
        summary.commonsSkipped.push({ src: c.relPath || c.absPath, reason: 'already-in-library' });
      } else {
        summary.commonsFailed.push({ src: c.relPath || c.absPath, reason: (result && result.error) || 'unknown error' });
      }
    } catch (err) {
      summary.commonsFailed.push({ src: c.relPath || c.absPath, reason: String(err && err.message || err) });
    }
  }
  // Tracks folders: each is a directory of .wav files (the SD-card
  // shared-tracks convention). Bulk gathers every .wav across all
  // tracks folders and pipes them through soundFontSharedTracks.addFiles
  // in one call so dedup-by-name applies across the union. The shared-
  // tracks bucket is a single global flat folder, so multiple "tracks"
  // dirs across the scanned tree all merge into the same destination —
  // identical-name files get a "(N)" suffix per the existing _uniqueName
  // contract in soundFontSharedTracks.
  const tracksDirs = Array.isArray(plan.tracksFolders) ? plan.tracksFolders : [];
  if (tracksDirs.length > 0 && !shouldCancel()) {
    onProgress({ stage: 'tracks-start', totalTracksFolders: tracksDirs.length });
    const wavPaths = [];
    for (const t of tracksDirs) {
      try {
        const entries = fs.readdirSync(t.absPath, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && /\.wav$/i.test(e.name)) {
            wavPaths.push(path.join(t.absPath, e.name));
          }
        }
      } catch {}
    }
    if (wavPaths.length > 0) {
      try {
        const result = soundFontSharedTracks.addFiles(userData, wavPaths);
        if (result && result.ok) {
          summary.tracksAdded = (result.added || []).length;
          // addFiles' skipped is per-file (Invalid filename, copy error,
          // etc.). It does NOT skip on duplicate name — uniqueName
          // suffix-numbers instead. So skipped here is genuine failure.
          summary.tracksFailed = (result.skipped || []).length;
        } else {
          summary.tracksFailed = wavPaths.length;
        }
      } catch (err) {
        summary.tracksFailed = wavPaths.length;
      }
    }
  }
  onProgress({ stage: 'done', total });
  return { ok: true, summary };
}

// ANALYZE phase ("prepare"): stage every planned source via importSource
// prepareOnly — zip + hash + dedup, no meta/entry yet — and fold in the
// already-computed corruption map (by top-level folder name). Returns per-source
// results the caller stamps back onto the plan (src._prepared / dup / corrupt)
// plus aggregate stats for the real-stats screen. This is exactly the hashing
// quick import does, just run BEFORE the keep/prune decision — the prepared zips
// are reused at commit (no re-hash). Emits byte progress for the existing bar.
async function analyzeBulkImport({ plan, userData, corruptFonts }, callbacks = {}) {
  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : () => {};
  const shouldCancel = typeof callbacks.shouldCancel === 'function' ? callbacks.shouldCancel : () => false;
  if (!plan || !Array.isArray(plan.sources)) return { ok: false, error: 'Invalid plan' };
  const sources = plan.sources;
  const total = sources.length;
  const cf = corruptFonts || {};
  const results = [];
  let newCount = 0, dupCount = 0, corruptCount = 0;
  for (let i = 0; i < total; i++) {
    if (shouldCancel()) return { ok: true, cancelled: true, results };
    const src = sources[i];
    const label = src.cleanedName || src.rawName;
    onProgress({ stage: 'source-start', sourceIdx: i, total, label });
    const corrupt = cf[src.rawName] || null;
    // Corrupt fonts are prepared the SAME way as clean ones, with stripCorrupt:
    // remove the damaged wavs FIRST, then hash the salvaged content. That clean,
    // stable hash means a corrupt font you ALREADY have dedups up front (shows as
    // "already in library" on the stats screen) instead of the user checking it
    // and only discovering the duplicate after it re-processes at commit. A
    // corrupt font that's genuinely NEW gets a prepared (stripped) zip, still
    // flagged corrupt so review keeps it unchecked-by-default — but committing it
    // now reuses the prepared zip (no re-strip/re-hash).
    let res;
    try {
      res = await soundFontSources.importSource({
        userData, sourcePath: src.absPath, originalName: path.basename(src.absPath),
        metadata: {}, prepareOnly: true, stripCorrupt: !!corrupt,
        onProgress: (p) => onProgress({ stage: 'source-progress', sourceIdx: i, total, label, sub: p }),
      });
    } catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
    if (res && res.ok && res.isDuplicate) {
      dupCount++;
      results.push({ idx: i, isDuplicate: true, existingUuid: res.uuid, corrupt });
    } else if (res && res.ok && res.prepared) {
      if (corrupt) corruptCount++; else newCount++;
      results.push({ idx: i, prepared: {
        uuid: res.uuid, hash: res.hash, format: res.format, name: res.name,
        fileSize: res.fileSize, sourceFileDate: res.sourceFileDate, sourceFileMtimeMs: res.sourceFileMtimeMs,
        strippedFiles: res.strippedFiles || [],
      }, corrupt });
    } else {
      results.push({ idx: i, error: (res && res.error) || 'prepare failed', corrupt });
    }
  }
  onProgress({ stage: 'done', total });
  return { ok: true, results, stats: { total, new: newCount, duplicate: dupCount, corrupt: corruptCount } };
}

// Discard prepared-but-not-committed sources (user pruned them or cancelled).
function discardPreparedSources(userData, uuids) {
  if (!Array.isArray(uuids)) return;
  for (const u of uuids) { try { soundFontSources.discardPreparedSource(userData, u); } catch {} }
}

// Import one planned source end-to-end: hash + copy via importSource,
// detect candidates, create entries with needsReview when applicable.
async function importPlannedSource({ userData, src, fromSdCard }, onSubProgress) {
  const sourcePath = src.absPath;
  const originalName = path.basename(sourcePath);
  // importSource handles dedup-by-hash automatically. We don't pre-fill
  // metadata.vendor — vendor detection runs AFTER the source is on disk
  // because the existing detector wants a Source object with listAll.
  let importRes;
  if (src._prepared && src._prepared.uuid) {
    // COMMIT path: this source was already staged by the analyze phase
    // (importSource prepareOnly) — its zip is on disk, hashed and dedup-cleared.
    // Finalize just writes meta; NO re-hash (this is what makes quick import fast).
    importRes = await soundFontSources.finalizePreparedSource({
      userData,
      uuid: src._prepared.uuid,
      format: src._prepared.format,
      name: src._prepared.name || originalName,
      hash: src._prepared.hash,
      fileSize: src._prepared.fileSize,
      sourceFileDate: src._prepared.sourceFileDate,
      sourceFileMtimeMs: src._prepared.sourceFileMtimeMs,
      metadata: {},
    });
    if (!importRes || !importRes.ok) {
      return { ok: false, error: (importRes && importRes.error) || 'Finalize failed' };
    }
  } else {
    // Legacy one-shot path (no analyze phase ran): hash + copy + dedup + finalize.
    // A font the user flagged corrupt but chose to import lands here (analyze
    // skips corrupt fonts, so they never get a _prepared zip). stripCorrupt
    // drops the damaged wavs at zip time — salvage the good files, and the bad
    // read never happens.
    importRes = await soundFontSources.importSource({
      userData,
      sourcePath,
      originalName,
      metadata: {},
      stripCorrupt: !!src._corrupt,
      onProgress: (p) => onSubProgress && onSubProgress({ phase: 'import', ...p }),
    });
    if (!importRes || !importRes.ok) {
      return { ok: false, error: (importRes && importRes.error) || 'Import failed' };
    }
    if (importRes.isDuplicate) {
      // Emit the 'skipped' tick then HOLD ~1.5s so the label is visible before
      // the next source-start event overwrites it.
      if (onSubProgress) {
        try { onSubProgress({ phase: 'import', stage: 'skipped', percent: 100 }); } catch {}
      }
      await new Promise(r => setTimeout(r, 1500));
      return { ok: true, dedup: true, existingUuid: importRes.uuid };
    }
  }
  const sourceUuid = importRes.uuid;
  // Vendor detection on the just-imported source. detectVendor handles
  // nested-zip bundle drilling internally so this single call covers
  // both Kyberphonic-style bundle-of-inner-zips and ordinary single-zip
  // shapes.
  let vendorRes = null;
  try {
    const sourceObj = soundFontSources.openSource(userData, sourceUuid);
    if (sourceObj) vendorRes = await soundFontVendors.detectVendor(sourceObj);
  } catch {}
  const detectedVendor = vendorRes && vendorRes.vendor ? vendorRes.vendor : null;
  const detectedConfidence = vendorRes && vendorRes.confidence ? vendorRes.confidence : null;
  const detectedWebsite = vendorRes && vendorRes.vendorWebsite ? vendorRes.vendorWebsite : null;
  // Guided-import override: a vendor the user typed/confirmed in the guided
  // review replaces the auto-detected one everywhere (source meta, entry
  // author, and the creator_empty review reason), and clears the
  // auto-detected flag since it's now user-chosen. The known-vendor website
  // is only carried over when the user's vendor still matches what we
  // detected; a different typed vendor gets no website guess.
  const _guidedVendor  = src.guidedVendor  && String(src.guidedVendor).trim();
  const _guidedWebsite = src.guidedWebsite && String(src.guidedWebsite).trim();
  const _guidedLink    = src.guidedLink    && String(src.guidedLink).trim();
  const _guidedNotes   = src.guidedNotes   && String(src.guidedNotes).trim();
  const _guidedDate    = src.guidedAcquisitionDate && String(src.guidedAcquisitionDate).trim();
  const vendorFromUser = !!_guidedVendor;
  let effectiveVendor = vendorFromUser ? _guidedVendor : detectedVendor;
  // SD-card path: an undetected vendor defaults to "Unknown" — an acceptable
  // creator for a font that came off someone's card — so it imports cleanly with
  // NO Needs-review flag, even on Quick import. The regular bulk path leaves it
  // empty so it hits creator_empty -> Needs review (let the user figure it out).
  if (!effectiveVendor && fromSdCard) effectiveVendor = 'Unknown';
  // Website precedence: an explicit guided website wins; otherwise the known-
  // vendor site, but only when the (auto-detected or user-confirmed) vendor
  // still matches what we detected — a different typed vendor gets no guess.
  const detectedVendorWebsite = (!vendorFromUser || _guidedVendor === detectedVendor) ? detectedWebsite : null;
  const effectiveWebsite = _guidedWebsite || detectedVendorWebsite;
  // purchased default order of precedence:
  //   1. Vendor's purchasedDefault when the detector knows (paid-only/free-only)
  //   2. "free" in the source filename
  //   3. Default paid (true)
  let purchasedDefault;
  if (vendorRes && vendorRes.purchasedDefault === false) purchasedDefault = false;
  else if (/\bfree\b/i.test(src.rawName || '')) purchasedDefault = false;
  else purchasedDefault = true;
  // The guided Free-content checkbox (sent on every guided-path source)
  // overrides the default; quick import sends none and keeps the default.
  const purchased = (typeof src.guidedFree === 'boolean') ? !src.guidedFree : purchasedDefault;
  // Persist vendor info onto the source meta (source of truth; projected onto
  // entries at read time). For structural matches we still apply the value AND
  // mark needsReview so the user can verify.
  if (effectiveVendor) {
    try {
      soundFontSources.updateSourceMeta(userData, sourceUuid, {
        vendor: effectiveVendor,
        vendorWebsite: effectiveWebsite,
        vendorAutoDetected: !vendorFromUser,
        purchased,
      });
    } catch {}
  }
  // Source-level extras for the no-vendor case (the with-vendor write above
  // already handles website + purchased). Website + free/paid are source-of-
  // truth fields. The date/link/notes are ENTRY-level and go through createEntry
  // below (acquisitionDate -> hoisted to source.purchaseDate; link -> demoUrl;
  // notes -> userNotes).
  const _extraMeta = {};
  if (!effectiveVendor && effectiveWebsite) _extraMeta.vendorWebsite = effectiveWebsite;
  if (!effectiveVendor && typeof src.guidedFree === 'boolean') _extraMeta.purchased = purchased;
  // Acquisition date -> source.purchaseDate (the projected source-of-truth
  // field). Written here so it overrides the file-date default the source
  // otherwise picks up, and so the read-time projection surfaces the user's value.
  if (_guidedDate) _extraMeta.purchaseDate = _guidedDate;
  if (Object.keys(_extraMeta).length) {
    try { soundFontSources.updateSourceMeta(userData, sourceUuid, _extraMeta); } catch {}
  }
  // Candidate detection -> create each as a library entry. Bundle name
  // (if any) becomes the first tag on every entry from this source.
  let candidatesRes;
  try {
    const sourceObj = soundFontSources.openSource(userData, sourceUuid);
    candidatesRes = await soundFontCandidates.detectCandidates(sourceObj);
  } catch (err) {
    return { ok: false, error: `Candidate detection failed: ${err.message}` };
  }
  const allCandidates = (candidatesRes && candidatesRes.candidates) || [];
  // Bulk auto-imports only the "preferred" pick from each version group.
  // Alternate versions (older V1 when V2 also shipped) stay in the source
  // and surface in the source-detail picker for manual import — the user
  // explicitly opts in, rather than getting both versions auto-installed.
  const candidates = allCandidates.filter(c => !c.alternateVersion);
  const alternatesSkipped = allCandidates.length - candidates.length;
  if (candidates.length === 0) {
    // Source imported but no fonts found inside. Delete the source so the
    // orphan cleanup doesn't have to and the user can re-pick later.
    try { soundFontSources.deleteSource(userData, sourceUuid); } catch {}
    return { ok: false, error: 'No fonts found in source' };
  }
  // A guided "Source name" override wins over the auto-detected bundle name;
  // it becomes the source's friendly name and the tag on every font from it.
  const _guidedSourceName = src.guidedSourceName && String(src.guidedSourceName).trim();
  const bundleName = _guidedSourceName || candidatesRes.bundleName || null;
  // Persist bundleName + multiCandidate on source meta so the renderer
  // can show "this source produced N fonts" without re-running detection,
  // and the entry detail can surface the bundle link for variants.
  // Single-source manual imports already set these on the source meta;
  // bulk was historically dropping them. Single-candidate sources still
  // get multiCandidate=false explicitly so the field is never absent.
  try {
    soundFontSources.updateSourceMeta(userData, sourceUuid, {
      bundleName: bundleName || undefined,
      multiCandidate: candidates.length >= 2,
    });
  } catch {}
  // Per-source stat tallies aggregated into the bulk summary so the
  // completion screen can show fonts-vs-sources granularity.
  // versionsSkippedHere counts how many alternate-version candidates we
  // skipped over at the filter step; variantsEmittedHere counts how
  // many isVariant rows we WILL import.
  const versionsSkippedHere = alternatesSkipped;
  let variantsEmittedHere = 0;
  for (const c of candidates) {
    if (c.isVariant) variantsEmittedHere++;
  }
  const entries = [];
  const existingEntryNames = new Set();
  try {
    for (const e of soundFontEntries.listEntries(userData)) existingEntryNames.add(e.name);
  } catch {}
  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const cand = candidates[cIdx];
    let proposedName = cand.name || `font_${cIdx + 1}`;
    // Guided-import name override applies only to single-candidate sources
    // (the folder-solo case the guided view is built around); a bundle that
    // yields several fonts keeps its per-candidate auto names since one
    // typed name can't stand in for many.
    if (src.guidedName && candidates.length === 1) {
      const gn = String(src.guidedName).trim();
      if (gn) proposedName = gn;
    }
    const reviewReasons = [];
    // Bundle prepend for ambiguous candidate names. Two triggers:
    //   1. Variants (cand.isVariant): the detector emitted multiple
    //      sibling fonts from inside one wrapper (e.g. JayDalorian
    //      Excalibur's long_ignition + short_ignition, Quantum's
    //      style_1/2/3). These names describe a variation, not an
    //      identity, so they MUST carry the parent name to be legible
    //      in the library ("Excalibur_Long_Ignition" not bare
    //      "Long_Ignition").
    //   2. Short / version-stub names in a multi-candidate bundle
    //      (ANH / ESB / R1 / ROTJ from Father; v1 / 2.0). The earlier
    //      "all-caps" trigger was too aggressive — caught real names
    //      like JURASSIC / ULTRON / STARGATE (Mountain Sabers Free
    //      Pack). Length <= 4 catches the acronyms (longest Star
    //      Wars film code is ROTJ at 4) without over-firing.
    if (bundleName && candidates.length >= 2) {
      const isVariant = !!cand.isVariant;
      const isShortAcronym = proposedName.length <= 4
        || /^[vV]?\d+(\.\d+)*$/.test(proposedName);
      const needsContext = isVariant || isShortAcronym;
      if (needsContext && !proposedName.toLowerCase().startsWith(bundleName.toLowerCase())) {
        proposedName = `${bundleName}_${proposedName}`;
      }
    }
    // Name collision: walk _N suffix until free. Per Ryan's spec
    // ("review is essentially needing fields we didn't have") an
    // auto-resolved collision isn't a missing-field problem — vendor
    // is detected, name is functional, no user action required.
    // The user can still rename to something better via the entry
    // detail; we just don't force a review flag for the auto _N.
    let finalName = proposedName;
    if (existingEntryNames.has(finalName)) {
      let n = 2;
      while (existingEntryNames.has(`${proposedName}_${n}`)) n++;
      finalName = `${proposedName}_${n}`;
    }
    existingEntryNames.add(finalName);
    // Creator status drives the rest of the review reasons. We supply
    // whatever vendor info we have; createEntry just writes it. We
    // intentionally do NOT flag structural-match auto-detections —
    // the detection is generally reliable (the pattern was chosen to
    // be distinctive), surfacing every one as Needs Review at scale
    // becomes noise. The vendorAutoDetected flag on the source meta
    // still indicates the auto-application for users who want to audit.
    const tags = bundleName ? [bundleName] : [];
    // Shared tags from the guided review's static tag bar — applied to every
    // font in this batch (deduped against the source-name tag above).
    if (Array.isArray(src.guidedSharedTags)) {
      for (const t of src.guidedSharedTags) {
        const tt = String(t || '').trim();
        if (tt && !tags.includes(tt)) tags.push(tt);
      }
    }
    // Multi-version sibling info: when the candidate detector collapsed
    // a group of X_V1/X_V2/... siblings down to the highest version,
    // surface the version in the description so the user can tell at a
    // glance which one this is, and add a review reason so bulk imports
    // get flagged for the user to acknowledge (single-import users see
    // the same info live in the review modal). Description is built
    // here only when the field would otherwise be empty — if the user
    // ever provides their own description during import, we don't
    // clobber it.
    let initialDescription = '';
    let versionInfo = null;
    if (cand.takenVersion && Array.isArray(cand.skippedVersions) && cand.skippedVersions.length > 0) {
      initialDescription = cand.takenVersion;
      versionInfo = {
        taken: cand.takenVersion,
        skipped: cand.skippedVersions.map(s => s.version),
      };
    }
    const meta = {
      tags,
      author: effectiveVendor || '',
      purchased,
      description: initialDescription,
      // Entry-level guided Details: link is the entry's demoUrl; notes are
      // userNotes. Acquisition date is a source-of-truth field (source.
      // purchaseDate), written directly to the source meta above so the
      // read-time projection can't clobber it with the folder's file date.
      demoUrl: _guidedLink || undefined,
      userNotes: _guidedNotes || undefined,
      // Other fields default through createEntry's existing logic
      // (acquisitionDate falls back to sourceFileDate -> importedAt).
    };
    // creator_unknown_no_website was meant to flag manually-typed
    // vendors that aren't in our known list. In bulk we never type
    // manually — vendors are either auto-detected (in which case a
    // null website is intentional, like Orlando Dove who distributes
    // via YouTube only) or absent entirely. So only creator_empty
    // matters as a review trigger here.
    if (!effectiveVendor) reviewReasons.push('creator_empty');
    if (versionInfo) reviewReasons.push('multiple_versions_in_source');
    const entryRes = await soundFontEntries.createEntry({
      userData, sourceUuid, candidate: cand, name: finalName, metadata: meta,
      onProgress: (p) => onSubProgress && onSubProgress({ phase: 'extract', candidate: cIdx + 1, totalCandidates: candidates.length, ...p }),
    });
    if (!entryRes || !entryRes.ok) {
      entries.push({ name: finalName, ok: false, error: entryRes && entryRes.error });
      continue;
    }
    // Stamp needsReview + reasons + structured versionInfo via
    // updateEntryMeta if any reason fired. versionInfo travels alongside
    // reviewReasons so the renderer can format the dynamic message
    // ("Source contained N versions...") without re-parsing the candidate.
    if (reviewReasons.length > 0) {
      try {
        const updates = { needsReview: true, reviewReasons };
        if (versionInfo) updates.versionInfo = versionInfo;
        soundFontEntries.updateEntryMeta({
          userData,
          currentName: finalName,
          updates,
        });
      } catch {}
    }
    entries.push({ name: finalName, ok: true });
  }
  return {
    ok: true,
    sourceUuid,
    entries,
    bundleName,
    multiCandidate: candidates.length >= 2,
    versionsSkipped: versionsSkippedHere,
    variantsEmitted: variantsEmittedHere,
    strippedFiles: (importRes && importRes.strippedFiles)
      || (src._prepared && src._prepared.strippedFiles) || [],
  };
}

// ── Guided-import enrichment ────────────────────────────────────────────
// The fast scan intentionally skips vendor detection and file peeking so it
// can run instantly on an "open this folder" click. Guided import needs
// more per candidate: the detected vendor (shown up front, editable), the
// first font.wav / hum.wav for preview, and any readme/text docs to glance
// at. That heavier work runs ONLY when the user chooses to look closely, so
// quick import stays on the fast path. Read-only, no userData, no copy.

// Locate the first `${base}*.wav` (base 'font' -> font.wav, font1.wav, ...)
// at any depth. Prefer the bare name; otherwise the lowest-numbered variant.
function _pickFirstEffectWav(entries, base) {
  const rx = new RegExp(`(^|/)${base}(\\d*)\\.wav$`, 'i');
  let best = null, bestNum = Infinity;
  for (const e of entries) {
    if (e.isDir) continue;
    const m = e.fileName.match(rx);
    if (!m) continue;
    const num = m[2] === '' ? -1 : parseInt(m[2], 10); // bare name sorts first
    if (num < bestNum) { bestNum = num; best = e.fileName; }
  }
  return best;
}

// Enrich one planned source in place. Returns vendor guess + preview refs +
// text docs. fontWav/humWav/textFiles carry an absPath for folder sources
// (renderer plays/reads them by disk path directly); zip sources get
// fileName only for now (preview needs extraction — a later slice).
async function enrichSourceForGuided(src) {
  const out = {
    vendor: null, vendorConfidence: null, vendorWebsite: null,
    purchasedDefault: true, fontWav: null, humWav: null, textFiles: [],
    wavCount: 0,
    suggestedName: null, nameSource: null, // set only when late docx naming upgrades a fallback
    error: null,
  };
  try {
    const source = soundFontSources.openSourceAtPath(src.absPath);
    if (!source) { out.error = 'unreadable'; return out; }
    let vendorRes = null;
    try { vendorRes = await soundFontVendors.detectVendor(source); } catch {}
    if (vendorRes) {
      out.vendor = vendorRes.vendor || null;
      out.vendorConfidence = vendorRes.confidence || null;
      out.vendorWebsite = vendorRes.vendorWebsite || null;
      if (vendorRes.purchasedDefault === false) out.purchasedDefault = false;
    }
    if (out.purchasedDefault && /\bfree\b/i.test(src.rawName || '')) out.purchasedDefault = false;
    const entries = await source.listAll();
    const isFolder = source.format === 'folder';
    const toRef = (fileName) => fileName == null ? null : {
      fileName,
      absPath: isFolder ? path.join(src.absPath, fileName) : null,
    };
    out.fontWav = toRef(_pickFirstEffectWav(entries, 'font'));
    out.humWav = toRef(_pickFirstEffectWav(entries, 'hum'));
    out.wavCount = entries.reduce((n, e) => n + (!e.isDir && /\.wav$/i.test(e.fileName) ? 1 : 0), 0);
    for (const e of entries) {
      if (e.isDir) continue;
      if (/\.(txt|md|nfo|rtf)$/i.test(e.fileName) || /(^|\/)read\s?me/i.test(e.fileName)) {
        out.textFiles.push({
          fileName: e.fileName,
          size: e.size || 0,
          absPath: isFolder ? path.join(src.absPath, e.fileName) : null,
        });
      }
    }
    // Lead with the real readme: readme-shaped names first, then the
    // shallowest path (root docs before nested config .txt like leds.txt /
    // font_config.txt), then alphabetical. Keeps the peek's default on top.
    const _isReadme = (n) => /read\s?me/i.test(n.split('/').pop());
    const _depth = (n) => (n.match(/\//g) || []).length;
    out.textFiles.sort((a, b) => {
      const ar = _isReadme(a.fileName), br = _isReadme(b.fileName);
      if (ar !== br) return ar ? -1 : 1;
      const ad = _depth(a.fileName), bd = _depth(b.fileName);
      if (ad !== bd) return ad - bd;
      return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
    });
    // Late naming from a Word .docx readme. The sync scan can't crack a .docx (it's a
    // zip), so a font whose name fell back to the generic folder name gets one more
    // shot here in the async pass: read the docx text and run the same readme name
    // extraction. Read-only; on any failure the fallback name simply stands.
    if (src.nameSource === 'folder-fallback') {
      const docx = out.textFiles.find(t => t.absPath && /\.docx$/i.test(t.fileName));
      if (docx) {
        try {
          const nm = nameFromReadmeText(await docxToText(docx.absPath));
          if (nm) { out.suggestedName = cleanSuggestedName(nm) || nm; out.nameSource = 'readme'; }
        } catch { /* leave the fallback name */ }
      }
    }
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  return out;
}

// Enrich every source in a scan plan for the guided review. Sequential so a
// large library doesn't open hundreds of archives at once; emits per-source
// progress and honors cancellation. Result `enriched` aligns index-for-index
// with plan.sources.
async function enrichPlanForGuided({ plan }, callbacks = {}) {
  const onProgress = typeof callbacks.onProgress === 'function' ? callbacks.onProgress : () => {};
  const shouldCancel = typeof callbacks.shouldCancel === 'function' ? callbacks.shouldCancel : () => false;
  if (!plan || !Array.isArray(plan.sources)) return { ok: false, error: 'Invalid plan' };
  const total = plan.sources.length;
  const enriched = [];
  for (let i = 0; i < total; i++) {
    if (shouldCancel()) return { ok: true, cancelled: true, enriched };
    const src = plan.sources[i];
    const result = await enrichSourceForGuided(src);
    enriched.push(result);
    // Emit the finished result per candidate so the renderer can fill that
    // row in place and let the user work with it immediately, while the
    // remaining candidates keep loading below.
    onProgress({ idx: i, total, label: src.cleanedName || src.rawName, done: true, result });
  }
  return { ok: true, enriched };
}

module.exports = {
  scanForBulkImport,
  runBulkImport,
  analyzeBulkImport,
  discardPreparedSources,
  enrichSourceForGuided,
  enrichPlanForGuided,
  // exported for testing
  looksLikeProffieDir,
  looksLikeCommonDir,
  MAX_SCAN_DEPTH_BEFORE_HALT,
};
