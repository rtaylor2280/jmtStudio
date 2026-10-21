// Re-link identical files the library holds as separate copies. [B-501]
//
// The library stores each distinct file once, every other name being a hard link to it. Ordinary
// things break those links without losing anything - a hand copy of the library, a restore across
// drives, a sync tool rewriting a file - and the library just grows, silently. Measured 2026-10-21:
// 1.75 GiB of identical files held apart, found only because a full restore happened to re-link
// them. This sweep finds and repairs that on its own.
//
// HOW: the content index already maps every file's hash to the paths that hold it. For each hash
// held by more than one stored copy (different file identity), the copy most names already share
// is kept, and every other name is re-pointed at it. Bytes are verified before any swap, on both
// sides, because a manifest can lag its file.
//
// SAFE TO STOP AT ANY POINT, by construction: a name is replaced by linking the kept copy under a
// temporary name and renaming that over the old one, and a rename is all-or-nothing. Interrupted
// before the rename, the old file is untouched and one temporary link (same bytes, no extra space)
// is left beside it; the next sweep removes it. No file's content is ever rewritten. A file that
// is in use refuses the rename and is skipped until next time.
'use strict';

const fs = require('fs');
const fsp = require('fs').promises;

const TMP = '.jmt-relink-tmp';
const _breathe = () => new Promise((r) => setImmediate(r));

// Returns what it did: { relinked: names re-pointed, savedBytes: space freed (only when every
// name of the dropped copy was re-pointed), groups: hashes found held apart, skipped, cleaned:
// leftover temporaries removed, stopped }.
async function relinkLibrary(userData, { shouldStop = () => false } = {}) {
  const CI = require('./soundFontContentIndex');
  const fh = require('./soundFontFileHash');
  const out = { groups: 0, relinked: 0, savedBytes: 0, skipped: 0, cleaned: 0, stopped: false };
  let index;
  try { index = CI.buildIndex(userData); } catch { return out; }

  for (const [hash, paths] of index.byHash) {
    if (shouldStop()) { out.stopped = true; break; }
    if (!Array.isArray(paths) || paths.length < 2) continue;
    await _breathe();

    // Group the names by the stored copy they point at.
    const copies = new Map();
    for (const p of paths) {
      let st;
      try { st = await fsp.stat(p, { bigint: true }); } catch { continue; }
      if (!st.isFile()) continue;
      const key = `${st.dev}:${st.ino}`;
      if (!copies.has(key)) copies.set(key, { dev: st.dev, size: Number(st.size), nlink: Number(st.nlink), paths: [] });
      copies.get(key).paths.push(p);
    }
    if (copies.size < 2) continue;
    out.groups++;

    // A temporary left by an interrupted run sits beside a name it was replacing, and an
    // interrupted replacement leaves its group still held apart, so this is the only place to look.
    for (const p of paths) {
      try { if (fs.existsSync(p + TMP)) { fs.rmSync(p + TMP, { force: true }); out.cleaned++; } } catch {}
    }

    // Keep the copy most names already share; it is the one already doing the most work.
    const ordered = [...copies.values()].sort((a, b) => b.nlink - a.nlink);
    const keep = ordered[0];
    const keepPath = keep.paths[0];
    if ((await fh.hashFileAsync(keepPath)) !== hash) { out.skipped += paths.length; continue; }

    for (const copy of ordered.slice(1)) {
      if (shouldStop()) { out.stopped = true; break; }
      // A link cannot cross drives; that copy stays, as the import would have left it.
      if (copy.dev !== keep.dev) { out.skipped += copy.paths.length; continue; }
      if ((await fh.hashFileAsync(copy.paths[0])) !== hash) { out.skipped += copy.paths.length; continue; }
      let done = 0;
      for (const p of copy.paths) {
        if (shouldStop()) { out.stopped = true; break; }
        const tmp = p + TMP;
        try {
          try { fs.rmSync(tmp, { force: true }); } catch {}
          fs.linkSync(keepPath, tmp);
          fs.renameSync(tmp, p);
          done++;
          out.relinked++;
        } catch {
          try { fs.rmSync(tmp, { force: true }); } catch {}
          out.skipped++;
        }
      }
      // Space comes back only when no name is left on the dropped copy. A name outside the
      // library (a copy of it elsewhere on the drive) keeps the bytes alive, and that is fine.
      if (done === copy.paths.length && copy.nlink === copy.paths.length) out.savedBytes += copy.size;
    }
    if (out.stopped) break;
  }
  return out;
}

module.exports = { relinkLibrary, TMP };
