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

const MAX_SCAN_DEPTH_BEFORE_HALT = 6;

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
  catch { return { kind: 'unreadable', proffieChildren: [], commonChildren: [], otherFolders: [], zips: [] }; }
  const proffieChildren = [];
  const commonChildren = [];
  const otherFolders = [];
  const zips = [];
  for (const e of entries) {
    if (isNoiseName(e.name)) continue;
    const full = path.join(absDir, e.name);
    if (e.isDirectory()) {
      if (looksLikeCommonDir(e.name)) {
        commonChildren.push({ name: e.name, absPath: full });
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
  return { kind: 'classified', proffieChildren, commonChildren, otherFolders, zips };
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
      && ctx.results.commonFolders.length === 0) {
    ctx.results.depthHalted = true;
    return;
  }
  const classification = classifyChildrenAt(absDir);
  if (classification.kind === 'unreadable') {
    ctx.results.skipped.push({ absPath: absDir, reason: 'unreadable' });
    return;
  }
  const { proffieChildren, commonChildren, otherFolders, zips } = classification;
  // Common folders surface as their own bucket so the caller can wire
  // them into the common-folder importer (out of scope for v1 bulk; just
  // catalogued).
  for (const c of commonChildren) {
    ctx.results.commonFolders.push({
      absPath: c.absPath,
      relPath: path.join(relPath, c.name),
      name: c.name,
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
    ctx.results.sources.push({
      kind: 'folder-solo',
      absPath: absDir,
      relPath,
      rawName: parentName,
      cleanedName: cleanSuggestedName(parentName),
      sizeBytes: safeDirSize(absDir),
    });
    return;
  }
  // Otherwise: every Proffie-shape direct child is its own solo source.
  // No auto-bundling — see header comment for the rationale.
  for (const p of proffieChildren) {
    ctx.results.sources.push({
      kind: 'folder-solo',
      absPath: p.absPath,
      relPath: path.join(relPath, p.name),
      rawName: p.name,
      cleanedName: cleanSuggestedName(p.name),
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
      skipped: [],
      depthHalted: false,
      totalSizeBytes: 0,
    },
  };
  // If the picked root itself IS a Proffie shape, emit as solo and skip
  // descent. Common single-font-folder case from "Import folder" workflow.
  if (looksLikeProffieDir(rootDir)) {
    ctx.results.sources.push({
      kind: 'folder-solo',
      absPath: rootDir,
      relPath: '',
      rawName: path.basename(rootDir),
      cleanedName: cleanSuggestedName(path.basename(rootDir)),
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
  const summary = { imported: [], skipped: [], failed: [], cancelled: false };
  if (!plan || !Array.isArray(plan.sources)) return { ok: false, error: 'Invalid plan' };
  const total = plan.sources.length;
  for (let i = 0; i < total; i++) {
    if (shouldCancel()) { summary.cancelled = true; break; }
    const src = plan.sources[i];
    onProgress({ stage: 'source-start', sourceIdx: i, total, label: src.cleanedName || src.rawName });
    try {
      const result = await importPlannedSource({ userData, src }, (subProgress) => {
        onProgress({ stage: 'source-progress', sourceIdx: i, total, label: src.cleanedName || src.rawName, sub: subProgress });
      });
      if (result.dedup) {
        summary.skipped.push({ src: src.relPath || src.absPath, reason: 'already-in-library', existingUuid: result.existingUuid });
      } else if (result.ok) {
        summary.imported.push({
          src: src.relPath || src.absPath,
          sourceUuid: result.sourceUuid,
          entries: result.entries,
        });
      } else {
        summary.failed.push({ src: src.relPath || src.absPath, reason: result.error });
      }
    } catch (err) {
      summary.failed.push({ src: src.relPath || src.absPath, reason: String(err && err.message || err) });
    }
  }
  onProgress({ stage: 'done', total });
  return { ok: true, summary };
}

// When an outer source has no detectable vendor and contains nested
// inner zips (Kyberphonic's "Tales" / "Power of Many" style bundles
// where each character ships as its own .zip inside an outer .zip),
// peek inside the first inner zip and run the same vendor detection
// against its entries. We assume all inner zips in a bundle are from
// the same vendor (true for every multi-font bundle in Ryan's
// collection). Inner zips that AREN'T fonts (like Kyberphonic's
// "_Extras.zip" sidecar) are skipped — pick a real font zip first.
async function _detectVendorInNestedZip(sourceObj) {
  let entries;
  try { entries = await sourceObj.listAll(); }
  catch { return null; }
  // Inner-zip candidates: top-level zip entries that aren't "_extras"
  // or otherwise sidecar-shaped.
  const innerZips = entries.filter(e =>
    !e.isDir
    && /\.zip$/i.test(e.fileName)
    && !e.fileName.includes('/')
    && !/^_extras\.zip$/i.test(e.fileName)
  );
  if (innerZips.length === 0) return null;
  // Pick the first non-sidecar inner zip and read its bytes via the
  // source object's readFile.
  const target = innerZips[0];
  let innerBuf;
  try { innerBuf = await sourceObj.readFile(target.fileName); }
  catch { return null; }
  // Open the inner zip from a temp file. node-stream-zip works with
  // file paths rather than buffers; cheaper to spill once than swap
  // libraries.
  const tmpDir = require('os').tmpdir();
  const crypto = require('crypto');
  const tmpPath = path.join(tmpDir, `jmt-vendor-peek-${crypto.randomUUID()}.zip`);
  try { fs.writeFileSync(tmpPath, innerBuf); }
  catch { return null; }
  let result = null;
  try {
    const StreamZip = require('node-stream-zip');
    const innerZip = new StreamZip.async({ file: tmpPath, skipEntryNameValidation: true });
    try {
      const map = await innerZip.entries();
      const innerEntries = [];
      for (const key of Object.keys(map)) {
        const e = map[key];
        if (!e.name || e.name === '/') continue;
        innerEntries.push({
          fileName: e.name,
          size: e.size,
          isDir: e.isDirectory || /\/$/.test(e.name),
        });
      }
      // Build a minimal source-like object that detectVendor accepts.
      // listAll returns the inner entries; readFile streams bytes out
      // of the inner zip when a pattern needs to read text. meta is
      // carried from the outer source so the originalName-based
      // sourceFilename pattern still tests against the OUTER name (the
      // bundle name typically carries vendor info too).
      const virtualSource = {
        meta: sourceObj.meta,
        listAll: async () => innerEntries,
        readFile: async (fileName) => innerZip.entryData(fileName),
      };
      result = await soundFontVendors.detectVendor(virtualSource);
    } finally {
      await innerZip.close();
    }
  } catch {}
  try { fs.unlinkSync(tmpPath); } catch {}
  return result;
}

// Import one planned source end-to-end: hash + copy via importSource,
// detect candidates, create entries with needsReview when applicable.
async function importPlannedSource({ userData, src }, onSubProgress) {
  const sourcePath = src.absPath;
  const originalName = path.basename(sourcePath) + (src.kind === 'zip' ? '' : '');
  // importSource handles dedup-by-hash automatically. We don't pre-fill
  // metadata.vendor — vendor detection runs AFTER the source is on disk
  // because the existing detector wants a Source object with listAll.
  const importRes = await soundFontSources.importSource({
    userData,
    sourcePath,
    originalName: src.kind === 'zip' ? path.basename(sourcePath) : path.basename(sourcePath),
    metadata: {},
    onProgress: (p) => onSubProgress && onSubProgress({ phase: 'import', ...p }),
  });
  if (!importRes || !importRes.ok) {
    return { ok: false, error: (importRes && importRes.error) || 'Import failed' };
  }
  if (importRes.isDuplicate) {
    return { ok: true, dedup: true, existingUuid: importRes.uuid };
  }
  const sourceUuid = importRes.uuid;
  // Vendor detection on the just-imported source. If the outer source
  // doesn't reveal a vendor and it's a bundle of nested zips (each
  // candidate carrying nested:true), peek inside the first inner zip
  // and re-run detection there. Kyberphonic's bundle releases (Tales,
  // Power of Many, etc.) put their _ReadMe.rtf inside each inner zip
  // rather than at the bundle root, so the outer-only scan misses them.
  let vendorRes = null;
  try {
    const sourceObj = soundFontSources.openSource(userData, sourceUuid);
    if (sourceObj) {
      vendorRes = await soundFontVendors.detectVendor(sourceObj);
      if ((!vendorRes || !vendorRes.vendor)) {
        const peeked = await _detectVendorInNestedZip(sourceObj);
        if (peeked && peeked.vendor) vendorRes = peeked;
      }
    }
  } catch {}
  const detectedVendor = vendorRes && vendorRes.vendor ? vendorRes.vendor : null;
  const detectedConfidence = vendorRes && vendorRes.confidence ? vendorRes.confidence : null;
  const detectedWebsite = vendorRes && vendorRes.vendorWebsite ? vendorRes.vendorWebsite : null;
  // purchased default order of precedence:
  //   1. Vendor's purchasedDefault when the detector knows (e.g. some
  //      vendors are paid-only, some are free-only)
  //   2. "free" in the source filename overrides to false (good signal
  //      across many vendors who name their freebies "Free Pack",
  //      "Free Decimate", etc.)
  //   3. Default paid (true)
  let purchasedDefault;
  if (vendorRes && vendorRes.purchasedDefault === false) {
    purchasedDefault = false;
  } else if (/\bfree\b/i.test(src.rawName || '')) {
    purchasedDefault = false;
  } else {
    purchasedDefault = true;
  }
  // Persist vendor info onto the source meta (mirrors what the review
  // modal would write at user-commit). For structural matches we still
  // apply the value AND mark needsReview so the user can verify.
  if (detectedVendor) {
    try {
      soundFontSources.updateSourceMeta(userData, sourceUuid, {
        vendor: detectedVendor,
        vendorWebsite: detectedWebsite,
        vendorAutoDetected: true,
        purchased: purchasedDefault,
      });
    } catch {}
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
  const candidates = (candidatesRes && candidatesRes.candidates) || [];
  if (candidates.length === 0) {
    // Source imported but no fonts found inside. Delete the source so the
    // orphan cleanup doesn't have to and the user can re-pick later.
    try { soundFontSources.deleteSource(userData, sourceUuid); } catch {}
    return { ok: false, error: 'No fonts found in source' };
  }
  const bundleName = candidatesRes.bundleName || null;
  const entries = [];
  const existingEntryNames = new Set();
  try {
    for (const e of soundFontEntries.listEntries(userData)) existingEntryNames.add(e.name);
  } catch {}
  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const cand = candidates[cIdx];
    let proposedName = cand.name || `font_${cIdx + 1}`;
    const reviewReasons = [];
    // Bundle prepend for ambiguous candidate names. In a multi-candidate
    // bundle, very short candidates (ANH / ESB / R1 / ROTJ from the
    // Father bundle) or pure version stubs (v1, 2.0) are meaningless
    // without bundle context, so we prepend automatically. The earlier
    // "all-caps" trigger was too aggressive — it caught real names like
    // JURASSIC / ULTRON / STARGATE (Mountain Sabers Free Pack) that
    // read fine on their own. Length <= 4 catches the actual acronyms
    // (longest Star Wars film code is ROTJ at 4) without over-firing.
    if (bundleName && candidates.length >= 2) {
      const needsContext = proposedName.length <= 4
        || /^[vV]?\d+(\.\d+)*$/.test(proposedName);
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
    const meta = {
      tags,
      author: detectedVendor || '',
      purchased: purchasedDefault,
      // Other fields default through createEntry's existing logic
      // (acquisitionDate falls back to sourceFileDate -> importedAt).
    };
    // creator_unknown_no_website was meant to flag manually-typed
    // vendors that aren't in our known list. In bulk we never type
    // manually — vendors are either auto-detected (in which case a
    // null website is intentional, like Orlando Dove who distributes
    // via YouTube only) or absent entirely. So only creator_empty
    // matters as a review trigger here.
    if (!detectedVendor) reviewReasons.push('creator_empty');
    const entryRes = await soundFontEntries.createEntry({
      userData, sourceUuid, candidate: cand, name: finalName, metadata: meta,
      onProgress: (p) => onSubProgress && onSubProgress({ phase: 'extract', candidate: cIdx + 1, totalCandidates: candidates.length, ...p }),
    });
    if (!entryRes || !entryRes.ok) {
      entries.push({ name: finalName, ok: false, error: entryRes && entryRes.error });
      continue;
    }
    // Stamp needsReview + reasons via updateEntryMeta if any reason fired.
    if (reviewReasons.length > 0) {
      try {
        soundFontEntries.updateEntryMeta({
          userData,
          currentName: finalName,
          updates: { needsReview: true, reviewReasons },
        });
      } catch {}
    }
    entries.push({ name: finalName, ok: true });
  }
  return { ok: true, sourceUuid, entries };
}

module.exports = {
  scanForBulkImport,
  runBulkImport,
  // exported for testing
  looksLikeProffieDir,
  looksLikeCommonDir,
  MAX_SCAN_DEPTH_BEFORE_HALT,
};
