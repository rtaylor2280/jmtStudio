// Sound Font library backup — exports the entire SF library tree under
// userData/soundFonts/ into a single .jmt-soundfontlibrary.zip with a
// manifest.json at the root so the file is self-identifying and a future
// import can validate before extracting.
//
// Layout inside the zip:
//   manifest.json
//   sources/<uuid>/...     — raw source archives + per-source meta.json
//   entries/<name>/...     — extracted font folders + per-entry meta.json
//   common/<uuid>/...      — common folder roots + per-common meta.json
//
// Library-state settings (currently just the starred-common uuid) are
// embedded in manifest.json so an empty-install restore lands at the exact
// prior visual state.

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const BACKUP_TYPE = 'jmt-soundfontlibrary';

// Path helpers — match the layout the rest of the SF modules use so this
// stays the single source of truth for "what does the library look like
// on disk."
function _soundFontsRoot(userData) {
  return path.join(userData, 'soundFonts');
}
function _sourcesRoot(userData) {
  return path.join(_soundFontsRoot(userData), 'sources');
}
function _entriesRoot(userData) {
  // On-disk directory is "library" (legacy naming from when the module
  // landed). User-facing copy still says "fonts" — this is the only place
  // the disk name leaks into the backup layout.
  return path.join(_soundFontsRoot(userData), 'library');
}
function _commonRoot(userData) {
  return path.join(_soundFontsRoot(userData), 'common');
}

// Recursive byte sum for a directory tree. Used both for the manifest's
// total-bytes field and for the export progress accounting (we tick bytes
// after each file lands in the archive). Silent on per-file errors so a
// transient permissions blip doesn't abort the whole survey.
function _dirBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;
  const walk = (cur) => {
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        try { total += fs.statSync(abs).size; } catch {}
      }
    }
  };
  walk(dir);
  return total;
}

// Survey what's in the library — count + size per bucket. Bucket keys
// match the on-disk directory names ('sources', 'library', 'common') so
// the archive layout, manifest counts, and restore code all use the same
// vocabulary. Renderer translates 'library' to "fonts" for display.
function surveyLibrary(userData) {
  const buckets = ['sources', 'library', 'common'];
  const counts = { sources: 0, library: 0, common: 0 };
  const totals = { sources: 0, library: 0, common: 0 };
  for (const b of buckets) {
    const root = path.join(_soundFontsRoot(userData), b);
    if (!fs.existsSync(root)) continue;
    let names;
    try { names = fs.readdirSync(root, { withFileTypes: true }); }
    catch { continue; }
    const dirs = names.filter(d => d.isDirectory());
    counts[b] = dirs.length;
    for (const d of dirs) totals[b] += _dirBytes(path.join(root, d.name));
  }
  const totalBytes = totals.sources + totals.library + totals.common;
  return { counts, totals, totalBytes };
}

// Throughput benchmark for the destination path. Writes a small temp file
// next to the eventual zip and measures wall-clock to derive an MB/s rate.
// 16 MB is large enough to swamp filesystem cache noise on a typical SSD
// without being heavy enough to feel like work to the user. Falls back to
// a conservative 30 MB/s if the benchmark fails outright.
async function benchmarkDestination(destDirOrFile) {
  // The proposed zip path won't exist yet (we benchmark BEFORE writing) —
  // fall through to the parent dir in that case. Real directories are
  // used directly; everything else also falls back to the parent.
  let destDir;
  try {
    const st = fs.statSync(destDirOrFile);
    destDir = st.isDirectory() ? destDirOrFile : path.dirname(destDirOrFile);
  } catch {
    destDir = path.dirname(destDirOrFile);
  }
  const tmpPath = path.join(destDir, `.jmt-bench-${Date.now()}.tmp`);
  const SIZE = 16 * 1024 * 1024;
  const buf = Buffer.alloc(SIZE, 0xAA);
  let mbps = 30;
  try {
    const start = Date.now();
    await fs.promises.writeFile(tmpPath, buf);
    const elapsedMs = Math.max(1, Date.now() - start);
    mbps = (SIZE / (1024 * 1024)) / (elapsedMs / 1000);
  } catch {}
  try { await fs.promises.unlink(tmpPath); } catch {}
  // Clamp to a sane band — a single benchmark can be noisy on a cold cache
  // or hammered drive; bounding it keeps the user-facing estimate honest.
  mbps = Math.max(5, Math.min(500, mbps));
  return mbps;
}

// Estimate seconds-to-complete given total bytes + measured throughput.
function estimateSeconds(totalBytes, mbps) {
  if (!totalBytes || !mbps) return 0;
  return totalBytes / (mbps * 1024 * 1024);
}

// Suggested default filename for the save dialog. ISO date stamp keeps
// repeated backups sortable in a folder.
function suggestedFileName() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `jmt-soundfontlibrary-${stamp}.zip`;
}

// Snapshot the library-state settings that travel with the backup. Kept
// tight on purpose — only true library state, not session prefs or tab
// visibility toggles. New entries here need to be load-bearing for "fresh
// install + import = exact prior state."
function _captureLibrarySettings(prefs) {
  return {
    starredCommon: prefs.starredCommon || '',
  };
}

// Export the SF library to destPath as a .jmt-soundfontlibrary.zip. The
// caller is expected to pass an AbortSignal so cancellation can land mid-
// archive — partial zips are deleted on cancel/error so a half-baked file
// never gets mistaken for a valid backup.
//
// progress callback is invoked with { phase, processedBytes, totalBytes,
// currentItem } as items stream in. The renderer uses these to drive the
// progress modal label and percentage.
async function exportBackup({
  userData,
  destPath,
  appVersion,
  prefs = {},
  onProgress = () => {},
  signal = null,
}) {
  if (!destPath) throw new Error('Missing destPath');
  const survey = surveyLibrary(userData);
  // Build the manifest first so a corrupted partial zip still gets the
  // type marker even if it doesn't finish.
  const manifest = {
    type: BACKUP_TYPE,
    schemaVersion: SCHEMA_VERSION,
    appVersion: appVersion || '',
    exportedAt: new Date().toISOString(),
    counts: { ...survey.counts },
    totals: { ...survey.totals, totalBytes: survey.totalBytes },
    settings: _captureLibrarySettings(prefs),
  };

  const archiver = require('archiver');
  const ws = fs.createWriteStream(destPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  // Hook cancellation. Aborting the archiver mid-stream + closing the
  // write stream lets us clean up the partial file in the finally block.
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    try { archive.abort(); } catch {}
    try { ws.destroy(); } catch {}
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let processedBytes = 0;
  archive.on('entry', (entry) => {
    if (entry.stats && entry.stats.size) processedBytes += entry.stats.size;
    onProgress({
      phase: 'archiving',
      processedBytes,
      totalBytes: survey.totalBytes,
      currentItem: entry.name,
    });
  });

  const done = new Promise((resolve, reject) => {
    ws.on('close', resolve);
    ws.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', err => {
      // ENOENT warnings show up when files vanish mid-walk (rare); other
      // warnings are surfaced as failures so we don't ship a backup with
      // silent gaps.
      if (err.code === 'ENOENT') return;
      reject(err);
    });
  });

  archive.pipe(ws);

  try {
    // Manifest first so a partial-but-readable zip still identifies as
    // ours when someone tries to peek into it.
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Each bucket walked separately so empty buckets just contribute no
    // entries. archiver.directory handles permission errors per file
    // (surfaced via 'warning' which we re-route above).
    for (const bucket of ['sources', 'library', 'common']) {
      if (cancelled) break;
      const root = path.join(_soundFontsRoot(userData), bucket);
      if (!fs.existsSync(root)) continue;
      onProgress({ phase: 'archiving', processedBytes, totalBytes: survey.totalBytes, currentItem: bucket });
      archive.directory(root, bucket);
    }

    if (!cancelled) await archive.finalize();
    await done;
  } catch (err) {
    // Anything thrown here (cancel-driven destroy, archiver error, write
    // stream EIO) routes through cleanup. Re-throw cancellation as a
    // distinct shape so the IPC layer can label it correctly.
    try { await fs.promises.unlink(destPath); } catch {}
    if (cancelled) {
      const e = new Error('Cancelled');
      e.cancelled = true;
      throw e;
    }
    throw err;
  } finally {
    if (signal) {
      try { signal.removeEventListener('abort', onAbort); } catch {}
    }
  }

  if (cancelled) {
    try { await fs.promises.unlink(destPath); } catch {}
    const e = new Error('Cancelled');
    e.cancelled = true;
    throw e;
  }
  return { destPath, manifest };
}

module.exports = {
  SCHEMA_VERSION,
  BACKUP_TYPE,
  surveyLibrary,
  benchmarkDestination,
  estimateSeconds,
  suggestedFileName,
  exportBackup,
};
