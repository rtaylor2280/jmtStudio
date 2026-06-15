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

// Read + validate a backup zip without unpacking it. Returns the manifest
// + a survey of what's actually inside the zip (counts per bucket measured
// from the entry list, so a tampered manifest doesn't silently mismatch
// the real contents). Errors carry a `reason` code so the renderer can
// branch UX between "not a backup" vs "wrong schema" vs "unreadable file".
async function inspectBackup(zipPath) {
  if (!zipPath) return { ok: false, reason: 'missing-path', error: 'Missing zip path' };
  if (!fs.existsSync(zipPath)) return { ok: false, reason: 'missing-file', error: 'File not found' };
  const StreamZip = require('node-stream-zip');
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  } catch (err) {
    return { ok: false, reason: 'unreadable', error: String(err && err.message || err) };
  }
  try {
    let entries;
    try { entries = await zip.entries(); }
    catch (err) { return { ok: false, reason: 'unreadable', error: String(err && err.message || err) }; }
    const manifestEntry = entries['manifest.json'];
    if (!manifestEntry) {
      return { ok: false, reason: 'not-a-backup', error: 'This zip is not a JMT Studio Sound Font library backup.' };
    }
    let manifest;
    try {
      const buf = await zip.entryData('manifest.json');
      manifest = JSON.parse(buf.toString('utf8'));
    } catch (err) {
      return { ok: false, reason: 'bad-manifest', error: 'The backup file is damaged or its manifest is not readable.' };
    }
    if (!manifest || manifest.type !== BACKUP_TYPE) {
      return { ok: false, reason: 'not-a-backup', error: 'This zip is not a JMT Studio Sound Font library backup.' };
    }
    if (typeof manifest.schemaVersion !== 'number' || manifest.schemaVersion > SCHEMA_VERSION) {
      return {
        ok: false,
        reason: 'newer-schema',
        error: `This backup was created by a newer version of JMT Studio (schema ${manifest.schemaVersion}). Update JMT Studio to import it.`,
      };
    }
    // Measure actual bucket contents from the entry list. Counts top-level
    // subdirs under each bucket (sources/<uuid>, library/<name>, common/<uuid>).
    // Bytes sum from entry sizes for accuracy.
    const buckets = { sources: { count: 0, bytes: 0 }, library: { count: 0, bytes: 0 }, common: { count: 0, bytes: 0 } };
    const topDirs = { sources: new Set(), library: new Set(), common: new Set() };
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.name || e.name === '/' || e.name === 'manifest.json') continue;
      const parts = e.name.split('/');
      const bucket = parts[0];
      if (!buckets[bucket]) continue;
      if (parts[1] && parts[1] !== '') topDirs[bucket].add(parts[1]);
      if (!e.isDirectory) buckets[bucket].bytes += (e.size || 0);
    }
    for (const b of Object.keys(buckets)) buckets[b].count = topDirs[b].size;
    const observedTotal = buckets.sources.bytes + buckets.library.bytes + buckets.common.bytes;
    return {
      ok: true,
      manifest,
      observed: {
        counts: { sources: buckets.sources.count, library: buckets.library.count, common: buckets.common.count },
        totals: { sources: buckets.sources.bytes, library: buckets.library.bytes, common: buckets.common.bytes, totalBytes: observedTotal },
      },
    };
  } finally {
    try { await zip.close(); } catch {}
  }
}

// Replace-import: wipe the current SF library and restore from the backup
// exactly. The whole operation is atomic from the user's perspective —
// either the new library is fully in place or the original library is
// untouched.
//
// Mechanism:
//   1. Rename userData/soundFonts/ → userData/soundFonts.preimport-bak-<ts>/
//      so the original is preserved as a complete tree (cheap rename, not a
//      copy) and an interrupted extract leaves zero ambiguity about state.
//   2. Create fresh userData/soundFonts/ and extract every entry into it.
//   3. On success: delete the snapshot.
//   4. On cancel/error: delete the partial new dir + rename snapshot back.
//
// progress callback fires per entry with { processedBytes, totalBytes,
// currentItem }. Caller supplies an AbortSignal for cancellation.
async function applyReplace({
  userData,
  zipPath,
  onProgress = () => {},
  signal = null,
}) {
  if (!zipPath) throw new Error('Missing zipPath');
  if (!userData) throw new Error('Missing userData');
  const sfRoot = _soundFontsRoot(userData);
  const snapshotPath = `${sfRoot}.preimport-bak-${Date.now()}`;

  // Snapshot via rename. If the original doesn't exist yet (fresh install
  // path), there's nothing to preserve — just skip the rename.
  const hadOriginal = fs.existsSync(sfRoot);
  if (hadOriginal) {
    try { fs.renameSync(sfRoot, snapshotPath); }
    catch (err) { throw new Error(`Could not snapshot existing library: ${err.message}`); }
  }

  // Pre-extract survey for the identical-skip optimization. surveyMerge
  // expects the user's library at userData/soundFonts; we've just renamed
  // it to snapshotPath, so a junction symlink at the original location
  // lets the survey read the snapshot transparently. Done BEFORE creating
  // the fresh sfRoot so the symlink can actually take that path.
  const skipDirs = { sources: new Set(), library: new Set(), common: new Set() };
  if (hadOriginal) {
    let tmpLink = null;
    try {
      try {
        fs.symlinkSync(snapshotPath, sfRoot, 'junction');
        tmpLink = sfRoot;
      } catch {
        // Symlink failed (permissions, platform). Fall back to no
        // optimization — wipe-and-extract everything.
      }
      if (tmpLink) {
        const surveyRes = await surveyMerge({ userData, zipPath });
        for (const it of surveyRes.sources?.identical || []) skipDirs.sources.add(it.id);
        for (const it of surveyRes.library?.identical || []) skipDirs.library.add(it.id);
        for (const it of surveyRes.common?.identical  || []) skipDirs.common.add(it.id);
      }
    } catch {
      skipDirs.sources.clear();
      skipDirs.library.clear();
      skipDirs.common.clear();
    } finally {
      if (tmpLink) { try { fs.unlinkSync(tmpLink); } catch {} }
    }
  }

  // Create the fresh root early so a no-entries backup still lands a valid
  // empty dir rather than leaving the SF tab pointing at nothing.
  try { fs.mkdirSync(sfRoot, { recursive: true }); }
  catch (err) {
    // Couldn't even make the new root — try to put things back exactly as
    // they were so the user isn't worse off than when they started.
    if (hadOriginal) {
      try { fs.renameSync(snapshotPath, sfRoot); } catch {}
    }
    throw new Error(`Could not create library directory: ${err.message}`);
  }

  const StreamZip = require('node-stream-zip');
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  } catch (err) {
    // Rollback before re-throwing.
    try { fs.rmSync(sfRoot, { recursive: true, force: true }); } catch {}
    if (hadOriginal) {
      try { fs.renameSync(snapshotPath, sfRoot); } catch {}
    }
    throw new Error(`Could not open backup zip: ${err.message}`);
  }

  let cancelled = false;
  const onAbort = () => { cancelled = true; };
  if (signal) {
    if (signal.aborted) cancelled = true;
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  let manifest = null;
  let processedBytes = 0;
  let totalBytes = 0;
  // Items we move from snapshot to fresh root because they're 100%
  // identical to the backup. Tracked so a mid-run failure can move them
  // back to the snapshot during rollback and the user lands exactly
  // where they started.
  const reusedItems = []; // [{ snapshotAbs, freshAbs }, ...]

  try {
    const entries = await zip.entries();
    // Manifest first (small, needed for settings).
    try {
      const buf = await zip.entryData('manifest.json');
      manifest = JSON.parse(buf.toString('utf8'));
    } catch {}

    // Per-item directory-presence map for the verification step. For
    // each backup item we record which directories the zip contains
    // (both as implicit parents of files and explicit dir entries).
    // The survey already vouched for file content via count+bytes (or
    // source hash); the only realistic gap is on-disk dirs that the
    // backup doesn't have, which the size aggregate can't see.
    const zipDirsByItem = new Map(); // "bucket/id" → Set<relPath>
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.name || e.name === 'manifest.json') continue;
      const parts = e.name.split('/');
      if (parts.length < 3) continue;
      const itemKey = `${parts[0]}/${parts[1]}`;
      if (!zipDirsByItem.has(itemKey)) zipDirsByItem.set(itemKey, new Set());
      const dirsSet = zipDirsByItem.get(itemKey);
      const innerParts = parts.slice(2);
      const endIdx = e.isDirectory ? innerParts.length : innerParts.length - 1;
      let acc = '';
      for (let i = 0; i < endIdx; i++) {
        acc = acc ? `${acc}/${innerParts[i]}` : innerParts[i];
        if (acc) dirsSet.add(acc);
      }
    }

    // Walk an item dir on disk, returning the set of subdirectory paths
    // (relative to the item root). Empty folders the user added show up
    // here, and the zip-side set won't contain them — that's the catch.
    const onDiskDirsOf = (itemAbs) => {
      const out = new Set();
      const walk = (cur, rel) => {
        let items;
        try { items = fs.readdirSync(cur, { withFileTypes: true }); }
        catch { return; }
        for (const it of items) {
          if (!it.isDirectory()) continue;
          const rp = rel ? `${rel}/${it.name}` : it.name;
          out.add(rp);
          walk(path.join(cur, it.name), rp);
        }
      };
      walk(itemAbs, '');
      return out;
    };

    // Move truly-identical items from snapshot to fresh. Verify against
    // the zip first — if the snapshot dir has anything the zip doesn't,
    // or vice versa, drop the item from skipDirs so it gets re-extracted
    // (catches "user added an empty folder, content bytes still match"
    // case where survey's file-count + total-bytes check is too loose).
    for (const bucket of ['sources', 'library', 'common']) {
      const freshBucketDir = path.join(sfRoot, bucket);
      try { fs.mkdirSync(freshBucketDir, { recursive: true }); } catch {}
      for (const id of [...skipDirs[bucket]]) {
        const snapAbs = path.join(snapshotPath, bucket, id);
        const freshAbs = path.join(freshBucketDir, id);
        if (!fs.existsSync(snapAbs)) {
          skipDirs[bucket].delete(id);
          continue;
        }
        // Only the directory set might disagree with the zip when the
        // survey says identical — empty folders added (or removed)
        // since the backup was taken. Symmetric check: every on-disk
        // dir must be in the zip, every zip dir must be on-disk.
        const onDiskDirs = onDiskDirsOf(snapAbs);
        const zipDirs = zipDirsByItem.get(`${bucket}/${id}`) || new Set();
        let mismatch = false;
        for (const d of onDiskDirs) { if (!zipDirs.has(d)) { mismatch = true; break; } }
        if (!mismatch) {
          for (const d of zipDirs) { if (!onDiskDirs.has(d)) { mismatch = true; break; } }
        }
        if (mismatch) {
          skipDirs[bucket].delete(id);
          continue;
        }
        try {
          fs.renameSync(snapAbs, freshAbs);
          reusedItems.push({ snapshotAbs: snapAbs, freshAbs });
        } catch {
          skipDirs[bucket].delete(id);
        }
      }
    }

    // Survey total bytes up front, but only for entries we'll actually
    // extract — skipped items aren't part of the progress denominator.
    const isSkipped = (entryName) => {
      const parts = entryName.split('/');
      if (parts.length < 2) return false;
      const bucket = parts[0];
      const id = parts[1];
      return skipDirs[bucket] && skipDirs[bucket].has(id);
    };
    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (e.isDirectory) continue;
      if (e.name === 'manifest.json') continue;
      if (isSkipped(e.name)) continue;
      totalBytes += (e.size || 0);
    }

    // Extract each entry, validating that the resolved path stays inside
    // sfRoot (defense against a malicious zip with "../" entries). Skip
    // anything that lives under a top-level dir we already moved across
    // from the snapshot.
    for (const key of Object.keys(entries)) {
      if (cancelled) break;
      const e = entries[key];
      if (e.name === 'manifest.json') continue; // not a library file
      if (!e.name || e.name === '/') continue;
      if (isSkipped(e.name)) continue; // identical — already in place
      const normalized = e.name.replace(/\\/g, '/');
      const target = path.resolve(sfRoot, normalized);
      if (!target.startsWith(path.resolve(sfRoot) + path.sep) && target !== path.resolve(sfRoot)) {
        continue;
      }
      if (e.isDirectory) {
        try { fs.mkdirSync(target, { recursive: true }); } catch {}
        continue;
      }
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
      try {
        await zip.extract(e.name, target);
        processedBytes += (e.size || 0);
        onProgress({ phase: 'extracting', processedBytes, totalBytes, currentItem: e.name });
      } catch (err) {
        throw new Error(`Failed extracting ${e.name}: ${err && err.message || err}`);
      }
    }

    if (cancelled) {
      throw Object.assign(new Error('Cancelled'), { cancelled: true });
    }
  } catch (err) {
    // Rollback. Move reused items back to the snapshot first so the
    // snapshot is whole again, then nuke fresh and rename snapshot back.
    for (const r of reusedItems) {
      try { fs.renameSync(r.freshAbs, r.snapshotAbs); } catch {}
    }
    try { fs.rmSync(sfRoot, { recursive: true, force: true }); } catch {}
    if (hadOriginal) {
      try { fs.renameSync(snapshotPath, sfRoot); } catch {}
    }
    try { await zip.close(); } catch {}
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
    throw err;
  } finally {
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
  }
  try { await zip.close(); } catch {}

  // Success — discard the snapshot. Best-effort: if the rm fails the user
  // still has a working library, just a leftover backup dir to clean up
  // manually.
  if (hadOriginal) {
    try { fs.rmSync(snapshotPath, { recursive: true, force: true }); } catch {}
  }
  return { manifest };
}

// Survey both the backup zip and the current library to classify every
// item into one of three buckets per category:
//   identical — full match (content + user-curated meta), no prompt, no write
//   new       — no match in current, added silently if user applies
//   conflict  — same identity, but content or curated meta differs, needs choice
//
// Identity per category — what makes two items "the same item":
//   sources — uuid (the dir name under sources/)
//   library — sourceUuid + candidatePath from meta.json (stable across local
//             renames; the on-disk dir name can change but the source-origin
//             pair doesn't)
//   common  — uuid (the dir name under common/)
//
// "Match" check per category — when identity matches, are they identical:
//   sources — meta.hash (sha256 streamed at import; in meta.json already)
//   library — fileCount + totalBytes only. Content match is identical;
//             metadata differences (rename, tag edits, description edits)
//             on identical content are NOT a conflict — silent skip. The
//             user renaming a font isn't asking to be re-prompted about
//             their own rename.
//   common  — fileCount + totalBytes only. Same logic as library.
//
// For library/common the byte-count heuristic isn't bit-perfect (a file swap
// keeping total bytes would slip through) but it's cheap and catches the
// 99% case. Users who need perfect equivalence can pick Replace instead.
async function surveyMerge({ userData, zipPath }) {
  if (!zipPath) throw new Error('Missing zipPath');
  if (!userData) throw new Error('Missing userData');

  const StreamZip = require('node-stream-zip');
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  } catch (err) {
    throw new Error(`Could not open backup zip: ${err.message}`);
  }
  try {
    const entries = await zip.entries();

    // Build per-bucket per-top-dir aggregates from the zip's entry list.
    // Library entries are keyed by their on-disk dir name (which is also
    // the zip's dir name); the identity key (sourceUuid + candidatePath)
    // gets populated from each entry's meta.json in a second pass below.
    const zipSources = new Map(); // uuid -> { fileCount, totalBytes, hash, name }
    const zipLibrary = new Map(); // dirName -> { fileCount, totalBytes, identity, ...curatedFields }
    const zipCommon  = new Map(); // uuid -> { fileCount, totalBytes, displayName }

    for (const key of Object.keys(entries)) {
      const e = entries[key];
      if (!e.name || e.name === '/' || e.name === 'manifest.json') continue;
      const parts = e.name.split('/');
      if (parts.length < 2) continue;
      const bucket = parts[0];
      const id = parts[1];
      if (!id) continue;
      const isFile = !e.isDirectory;
      const size = e.size || 0;
      // Exclude per-item meta.json from content counts — it's metadata,
      // not sound content, and its bytes shift on every rename/tag edit.
      // Including it would let a pure rename fail the contentSame check by
      // a few-bytes delta and falsely register as a content conflict.
      const isItemMeta = parts.length === 3 && parts[2] === 'meta.json';
      if (bucket === 'sources') {
        if (!zipSources.has(id)) zipSources.set(id, { fileCount: 0, totalBytes: 0, hash: null, name: null });
        const agg = zipSources.get(id);
        if (isFile && !isItemMeta) { agg.fileCount++; agg.totalBytes += size; }
      } else if (bucket === 'library') {
        if (!zipLibrary.has(id)) zipLibrary.set(id, { fileCount: 0, totalBytes: 0, identity: null, name: id, meta: {} });
        const agg = zipLibrary.get(id);
        if (isFile && !isItemMeta) { agg.fileCount++; agg.totalBytes += size; }
      } else if (bucket === 'common') {
        if (!zipCommon.has(id)) zipCommon.set(id, { fileCount: 0, totalBytes: 0, displayName: null });
        const agg = zipCommon.get(id);
        if (isFile && !isItemMeta) { agg.fileCount++; agg.totalBytes += size; }
      }
    }

    // Pull source meta from each source's meta.json — needed for the
    // content hash. Source meta uses the field name `hash` (computed at
    // import time, see soundFontSources.js: hash.digest('hex')); do not
    // rename to `contentHash` here.
    for (const uuid of zipSources.keys()) {
      const metaPath = `sources/${uuid}/meta.json`;
      if (!entries[metaPath]) continue;
      try {
        const buf = await zip.entryData(metaPath);
        const meta = JSON.parse(buf.toString('utf8'));
        const agg = zipSources.get(uuid);
        agg.hash = meta.hash || null;
        agg.name = meta.bundleName || meta.originalName || uuid;
      } catch {}
    }

    // Pull common meta names for display.
    for (const uuid of zipCommon.keys()) {
      const metaPath = `common/${uuid}/meta.json`;
      if (!entries[metaPath]) continue;
      try {
        const buf = await zip.entryData(metaPath);
        const meta = JSON.parse(buf.toString('utf8'));
        zipCommon.get(uuid).displayName = meta.name || uuid;
      } catch {}
    }

    // User-curated meta fields for library entries. Drives the diff
    // detection in classifyLibrary — anything in this list that differs
    // between backup and current surfaces as a meta conflict. Excludes
    // identity (sourceUuid + candidatePath), system fields (createdAt,
    // updatedAt), and content fields (fileCount, totalBytes covered by
    // contentDiffers separately). Labels are the UI display strings.
    const LIBRARY_META_FIELDS = [
      { key: 'name',                    label: 'name' },
      { key: 'tags',                    label: 'tags',                normalize: (v) => Array.isArray(v) ? [...v].sort() : [] },
      { key: 'description',             label: 'description',         normalize: (v) => v || '' },
      { key: 'linkUrl',                 label: 'link URL',            normalize: (v) => v || '' },
      { key: 'linkLabel',               label: 'link label',          normalize: (v) => v || '' },
      { key: 'linkedStyleLibraryEntry', label: 'linked style',        normalize: (v) => v || '' },
      { key: 'purchased',               label: 'purchased flag',      normalize: (v) => !!v },
      { key: 'author',                  label: 'author',              normalize: (v) => v || '' },
      { key: 'acquisitionDate',         label: 'acquisition date',    normalize: (v) => v || '' },
      { key: 'userNotes',               label: 'notes',               normalize: (v) => v || '' },
    ];
    const readLibraryMeta = (meta, fallbackName) => {
      const out = { identity: null, name: fallbackName, fields: {} };
      const su = meta.sourceUuid || '';
      const cp = meta.candidatePath || '';
      out.identity = (su || cp) ? `${su}|${cp}` : null;
      out.name = meta.name || fallbackName;
      for (const f of LIBRARY_META_FIELDS) {
        const raw = meta[f.key];
        out.fields[f.key] = f.normalize ? f.normalize(raw) : raw;
      }
      return out;
    };

    // Pull library entry meta from the zip — identity (survives renames)
    // plus every user-curated field for diff detection.
    for (const dirName of zipLibrary.keys()) {
      const metaPath = `library/${dirName}/meta.json`;
      if (!entries[metaPath]) continue;
      try {
        const buf = await zip.entryData(metaPath);
        const meta = JSON.parse(buf.toString('utf8'));
        const parsed = readLibraryMeta(meta, dirName);
        const agg = zipLibrary.get(dirName);
        agg.identity = parsed.identity;
        agg.name = parsed.name;
        agg.meta = parsed.fields;
      } catch {}
    }

    // Now read the current library off disk in the same shape.
    const curSources = new Map();
    const curLibrary = new Map();
    const curCommon  = new Map();
    const sfRoot = _soundFontsRoot(userData);

    const readBucket = (bucketName, target, getMeta) => {
      const root = path.join(sfRoot, bucketName);
      if (!fs.existsSync(root)) return;
      let dirs;
      try { dirs = fs.readdirSync(root, { withFileTypes: true }); }
      catch { return; }
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const dirPath = path.join(root, d.name);
        let fileCount = 0, totalBytes = 0;
        // Same meta.json exclusion as the zip-side aggregation — the
        // item-root meta.json is metadata, not content. Including it
        // would let a pure local rename slip a few-bytes delta into the
        // contentSame check and falsely register as a content conflict.
        const walk = (cur) => {
          let items;
          try { items = fs.readdirSync(cur, { withFileTypes: true }); }
          catch { return; }
          for (const it of items) {
            const ap = path.join(cur, it.name);
            if (it.isDirectory()) walk(ap);
            else if (it.isFile()) {
              if (cur === dirPath && it.name === 'meta.json') continue;
              fileCount++;
              try { totalBytes += fs.statSync(ap).size; } catch {}
            }
          }
        };
        walk(dirPath);
        const extra = getMeta ? getMeta(dirPath) : {};
        target.set(d.name, { fileCount, totalBytes, ...extra });
      }
    };
    readBucket('sources', curSources, (dirPath) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dirPath, 'meta.json'), 'utf8'));
        return { hash: meta.hash || null, name: meta.bundleName || meta.originalName || '' };
      } catch { return { hash: null, name: '' }; }
    });
    readBucket('library', curLibrary, (dirPath) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dirPath, 'meta.json'), 'utf8'));
        const parsed = readLibraryMeta(meta, '');
        return { identity: parsed.identity, name: parsed.name, meta: parsed.fields };
      } catch { return { identity: null, name: '', meta: {} }; }
    });
    readBucket('common', curCommon, (dirPath) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dirPath, 'meta.json'), 'utf8'));
        return { displayName: meta.name || '' };
      } catch { return { displayName: '' }; }
    });

    // Classify each backup item per category.
    const classifySources = () => {
      const out = { identical: [], conflict: [], add: [] };
      for (const [uuid, z] of zipSources) {
        const c = curSources.get(uuid);
        if (!c) { out.add.push({ id: uuid, name: z.name || uuid, fileCount: z.fileCount, totalBytes: z.totalBytes }); continue; }
        if (z.hash && c.hash && z.hash === c.hash) {
          out.identical.push({ id: uuid, name: z.name || uuid });
        } else {
          // Source conflict always means content differs (sources have a
          // streamed hash at import time; matching uuid + differing hash =
          // content diff). Sources don't carry user-curated meta the user
          // typically edits, so meta-only conflicts aren't a thing here.
          out.conflict.push({
            id: uuid,
            name: z.name || uuid,
            contentDiffers: true,
            metaDiffers: false,
            backup: { fileCount: z.fileCount, totalBytes: z.totalBytes },
            current: { fileCount: c.fileCount, totalBytes: c.totalBytes, name: c.name },
          });
        }
      }
      return out;
    };

    // Library: identity-based matching so local renames are detected as
    // the same item. Conflict info splits content-diff from meta-diff and
    // includes a list of which specific meta fields differ so the UI can
    // tell the user "Sound files identical, only metadata differs:
    // acquisition date, tags" instead of a generic "metadata differs."
    const classifyLibrary = () => {
      const out = { identical: [], conflict: [], add: [] };
      const curByIdentity = new Map();
      for (const [dirName, c] of curLibrary) {
        if (c.identity) curByIdentity.set(c.identity, dirName);
      }
      const eq = (a, b) => {
        if (Array.isArray(a) && Array.isArray(b)) {
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
          return true;
        }
        return a === b;
      };
      const computeMetaDiff = (z, c) => {
        const labels = [];
        const details = [];
        for (const f of LIBRARY_META_FIELDS) {
          const zv = z.meta?.[f.key];
          const cv = c.meta?.[f.key];
          if (!eq(zv, cv)) {
            labels.push(f.label);
            // Carry raw values through so the renderer can show a real
            // side-by-side comparison (the user has to see what changed,
            // not just that something did).
            details.push({ key: f.key, label: f.label, backup: zv, current: cv });
          }
        }
        return { labels, details };
      };
      for (const [backupDirName, z] of zipLibrary) {
        let curDirName = null;
        if (z.identity && curByIdentity.has(z.identity)) {
          curDirName = curByIdentity.get(z.identity);
        } else if (curLibrary.has(backupDirName)) {
          // Fall-through: entries pre-dating sourceUuid/candidatePath in meta
          // (or sources imported without that data) match by dir name only.
          curDirName = backupDirName;
        }
        if (!curDirName) {
          out.add.push({ id: backupDirName, name: z.name || backupDirName, fileCount: z.fileCount, totalBytes: z.totalBytes });
          continue;
        }
        const c = curLibrary.get(curDirName);
        const contentDiffers = !(c.fileCount === z.fileCount && c.totalBytes === z.totalBytes);
        const { labels: diffFields, details: diffDetails } = computeMetaDiff(z, c);
        const metaDiffers = diffFields.length > 0;
        if (!contentDiffers && !metaDiffers) {
          out.identical.push({ id: backupDirName, name: z.name || backupDirName });
        } else {
          out.conflict.push({
            id: backupDirName,
            name: z.name || backupDirName,
            contentDiffers,
            metaDiffers,
            diffFields,
            diffDetails,
            backup: { fileCount: z.fileCount, totalBytes: z.totalBytes, name: z.name || backupDirName },
            current: { fileCount: c.fileCount, totalBytes: c.totalBytes, name: c.name || curDirName, dirName: curDirName },
          });
        }
      }
      return out;
    };

    // Common: uuid-based identity. Same content/meta split as library so
    // the UI can show a meta-only diff (local rename) distinctly from a
    // file-content diff.
    const classifyCommon = () => {
      const out = { identical: [], conflict: [], add: [] };
      for (const [uuid, z] of zipCommon) {
        const c = curCommon.get(uuid);
        const zName = z.displayName || uuid;
        if (!c) { out.add.push({ id: uuid, name: zName, fileCount: z.fileCount, totalBytes: z.totalBytes }); continue; }
        const cName = c.displayName || uuid;
        const contentDiffers = !(c.fileCount === z.fileCount && c.totalBytes === z.totalBytes);
        const metaDiffers = cName !== zName;
        if (!contentDiffers && !metaDiffers) {
          out.identical.push({ id: uuid, name: zName });
        } else {
          out.conflict.push({
            id: uuid,
            name: zName,
            contentDiffers,
            metaDiffers,
            backup: { fileCount: z.fileCount, totalBytes: z.totalBytes },
            current: { fileCount: c.fileCount, totalBytes: c.totalBytes, name: cName },
          });
        }
      }
      return out;
    };

    return {
      ok: true,
      sources: classifySources(),
      library: classifyLibrary(),
      common:  classifyCommon(),
    };
  } finally {
    try { await zip.close(); } catch {}
  }
}

// Merge-import: extract only the items the user opted into, leaving the
// rest of the current library untouched. Each item is processed in
// isolation with its own per-item rollback log so a mid-run cancel
// undoes just the writes from this run, leaving items the user already
// committed to in their original-or-replaced state.
//
// plan shape (per category, keyed by identifier):
//   sources: { uuid: 'install' | 'keep' | 'replace' }
//   library: { name: 'install' | 'keep' | 'replace' | 'both' }
//   common:  { uuid: 'install' | 'keep' | 'replace' }
// Items missing from the plan are left alone (covers "current items not
// in backup" and "identical items survey caller chose to skip silently").
//
// Per-item semantics:
//   install — backup-only item, no current version exists; extract fresh
//   keep    — collision exists, user wants to keep current; no-op
//   replace — collision exists, user wants the backup's version; snapshot
//             current to <name>.preimport-bak-<ts>/, extract backup, on
//             success delete the snapshot, on cancel/error restore it.
//             For library, the current dir name may differ from the backup
//             name (identity match across a local rename), so the caller
//             passes currentName explicitly so the right dir is replaced.
//   both    — library only; extract backup version. Rename to "<name> (N)"
//             only if the backup name would collide with something already
//             on disk; if it's free (e.g. user renamed locally), just use
//             the backup name as-is.
async function applyMerge({
  userData,
  zipPath,
  plan = { sources: {}, library: {}, common: {} },
  onProgress = () => {},
  signal = null,
}) {
  if (!zipPath) throw new Error('Missing zipPath');
  if (!userData) throw new Error('Missing userData');
  const sfRoot = _soundFontsRoot(userData);
  // Ensure all bucket roots exist so per-item extracts can write
  // without re-creating the parent every time.
  for (const b of ['sources', 'library', 'common']) {
    try { fs.mkdirSync(path.join(sfRoot, b), { recursive: true }); } catch {}
  }

  const StreamZip = require('node-stream-zip');
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  } catch (err) {
    throw new Error(`Could not open backup zip: ${err.message}`);
  }

  let cancelled = false;
  const onAbort = () => { cancelled = true; };
  if (signal) {
    if (signal.aborted) cancelled = true;
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  // Rollback log — each entry knows how to undo itself. Order matters on
  // rollback (LIFO) so a snapshot rename comes back AFTER its sibling
  // partial-write is removed.
  const rollbackLog = [];
  const rollbackAll = () => {
    while (rollbackLog.length > 0) {
      const op = rollbackLog.pop();
      try { op(); } catch {}
    }
  };

  // Build the work list — { bucket, id, mode, currentName, itemBytes }
  // per item. Plan values are either a string mode (sources / common) or
  // an object { mode, currentName } (library, since the current on-disk
  // name may differ from the backup id when an identity match crosses a
  // local rename).
  const entries = await zip.entries();
  const work = [];
  let totalBytes = 0;
  const buckets = { sources: 'sources', library: 'library', common: 'common' };
  for (const cat of Object.keys(buckets)) {
    const bucket = buckets[cat];
    const decisions = plan[cat] || {};
    for (const id of Object.keys(decisions)) {
      const raw = decisions[id];
      const mode = typeof raw === 'string' ? raw : (raw && raw.mode);
      const currentName = typeof raw === 'object' && raw ? (raw.currentName || id) : id;
      const customName = typeof raw === 'object' && raw ? (raw.customName || '') : '';
      if (!mode || mode === 'keep') continue;
      // Sum bytes for this top-level subdir within the zip.
      let itemBytes = 0;
      const prefix = `${bucket}/${id}/`;
      for (const key of Object.keys(entries)) {
        if (!key.startsWith(prefix)) continue;
        const e = entries[key];
        if (!e.isDirectory) itemBytes += (e.size || 0);
      }
      work.push({ bucket, id, mode, currentName, customName, itemBytes });
      totalBytes += itemBytes;
    }
  }

  let processedBytes = 0;

  // Extract every file under a zip prefix into a target dir on disk.
  // Validates path-escape per entry (defense against malicious zips).
  const extractPrefix = async (prefix, targetDir) => {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const key of Object.keys(entries)) {
      if (cancelled) return;
      if (!key.startsWith(prefix)) continue;
      const e = entries[key];
      if (e.name === prefix) continue; // bare top-dir entry
      const relUnderTop = e.name.substring(prefix.length);
      if (!relUnderTop) continue;
      const target = path.resolve(targetDir, relUnderTop);
      if (!target.startsWith(path.resolve(targetDir) + path.sep) && target !== path.resolve(targetDir)) {
        continue; // path escape — skip
      }
      if (e.isDirectory) {
        try { fs.mkdirSync(target, { recursive: true }); } catch {}
        continue;
      }
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
      try {
        await zip.extract(e.name, target);
        processedBytes += (e.size || 0);
        onProgress({ phase: 'merging', processedBytes, totalBytes, currentItem: e.name });
      } catch (err) {
        throw new Error(`Failed extracting ${e.name}: ${err && err.message || err}`);
      }
    }
  };

  try {
    for (const w of work) {
      if (cancelled) break;
      const bucketRoot = path.join(sfRoot, w.bucket);
      if (w.mode === 'install') {
        // No collision — extract to <bucket>/<id>/. Rollback: delete it.
        const target = path.join(bucketRoot, w.id);
        // If somehow already exists (race), treat as no-op rather than
        // overwriting silently. The survey would have flagged this.
        if (fs.existsSync(target)) continue;
        await extractPrefix(`${w.bucket}/${w.id}/`, target);
        rollbackLog.push(() => { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} });
      } else if (w.mode === 'replace') {
        // Snapshot the CURRENT dir (which may have a different name than
        // the backup's id when an identity-matched library entry was
        // renamed locally), extract backup under the backup's name, then
        // on rollback restore the snapshot.
        const currentDir = path.join(bucketRoot, w.currentName);
        const target = path.join(bucketRoot, w.id);
        const snap = `${currentDir}.preimport-bak-${Date.now()}`;
        const hadOriginal = fs.existsSync(currentDir);
        if (hadOriginal) {
          try { fs.renameSync(currentDir, snap); }
          catch (err) { throw new Error(`Snapshot failed for ${w.currentName}: ${err.message}`); }
        }
        // Rollback restores the original current dir from snapshot AND
        // removes anything we may have written to the backup's target.
        rollbackLog.push(() => {
          try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
          if (hadOriginal) { try { fs.renameSync(snap, currentDir); } catch {} }
        });
        await extractPrefix(`${w.bucket}/${w.id}/`, target);
        // Success — discard the per-item snapshot and no-op the rollback
        // so a later item failure can't half-undo this committed item.
        if (hadOriginal) {
          try { fs.rmSync(snap, { recursive: true, force: true }); } catch {}
        }
        rollbackLog[rollbackLog.length - 1] = () => {};
      } else if (w.mode === 'both') {
        // Library only — keep the current alongside the backup version.
        // Pick the on-disk name in priority order:
        //   1. User-provided custom name (sanitized for filesystem safety)
        //   2. Backup's name as-is, if free
        //   3. "<backupName>_N" with N=1,2,... until free
        // Underscore (not parens) so the resulting folder name is safe on
        // every filesystem AND inside Proffie/embedded sound players that
        // might be picky about spaces or punctuation in font dir names.
        const sanitize = (s) => String(s || '').trim()
          .replace(/\s+/g, '_')
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
          .slice(0, 200);
        const userPick = sanitize(w.customName);
        let chosenName;
        if (userPick && !fs.existsSync(path.join(bucketRoot, userPick))) {
          chosenName = userPick;
        } else {
          chosenName = w.id;
          let n = 0;
          while (fs.existsSync(path.join(bucketRoot, chosenName))) {
            n++;
            chosenName = `${w.id}_${n}`;
          }
        }
        const target = path.join(bucketRoot, chosenName);
        await extractPrefix(`${w.bucket}/${w.id}/`, target);
        rollbackLog.push(() => { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} });
        // Patch meta.json's 'name' field to match the on-disk dir so the
        // entry's UI display lines up. Only relevant for library bucket;
        // sources/common shouldn't hit 'both' under the v1 scope.
        if (w.bucket === 'library' && chosenName !== w.id) {
          const metaPath = path.join(target, 'meta.json');
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            meta.name = chosenName;
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
          } catch {}
        }
      }
    }

    if (cancelled) {
      throw Object.assign(new Error('Cancelled'), { cancelled: true });
    }
  } catch (err) {
    rollbackAll();
    try { await zip.close(); } catch {}
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
    throw err;
  } finally {
    if (signal) { try { signal.removeEventListener('abort', onAbort); } catch {} }
  }

  // Apply manifest settings (starredCommon) — only if the backup's value
  // isn't already what we have; otherwise it's a no-op.
  let manifestApplied = null;
  try {
    const buf = await zip.entryData('manifest.json');
    const manifest = JSON.parse(buf.toString('utf8'));
    manifestApplied = manifest;
  } catch {}

  try { await zip.close(); } catch {}
  return { manifest: manifestApplied };
}

module.exports = {
  SCHEMA_VERSION,
  BACKUP_TYPE,
  surveyLibrary,
  benchmarkDestination,
  estimateSeconds,
  suggestedFileName,
  exportBackup,
  inspectBackup,
  applyReplace,
  surveyMerge,
  applyMerge,
};
