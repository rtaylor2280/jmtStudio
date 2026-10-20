// Copy a directory tree so that files sharing one copy on disk (hard links) still share one copy
// at the destination. Explorer, Copy-Item and robocopy expand every link into a full file, which
// turns a ~1.2 GB library into ~4 GB the moment it is copied. [B-503]
//
// Each file with more than one name is keyed by volume + 64-bit file id (bigint: an NTFS file id
// can exceed a double, and a rounded collision would link unrelated files). The first time a key
// is seen its bytes are copied; every later path with that key is hard-linked to that first copy,
// and only when the sizes also match.
//
// A destination that cannot hold links (another volume, FAT32, exFAT) gets full copies instead,
// and the result says so: `linksPreserved: false`. The destination must be empty or absent; this
// never overwrites anything.
'use strict';

const fs = require('fs');
const path = require('path');

// Errors that mean "this destination cannot hold a link", after which linking stops being tried.
const NO_LINKS = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL', 'ENOSYS']);

async function copyTreePreservingLinks(srcRoot, destRoot, { onProgress, shouldStop, linkFn } = {}) {
  const link = linkFn || ((a, b) => fs.promises.link(a, b));
  const src = path.resolve(srcRoot);
  const dest = path.resolve(destRoot);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    return { ok: false, error: 'Source folder not found' };
  }
  const rel = path.relative(src, dest);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return { ok: false, error: 'The destination is inside the source' };
  }
  if (fs.existsSync(dest)) {
    let entries = [];
    try { entries = fs.readdirSync(dest); } catch (err) { return { ok: false, error: String(err.message || err) }; }
    if (entries.length) return { ok: false, error: 'The destination folder is not empty' };
  }

  const firstCopy = new Map();   // `${dev}:${ino}` -> { destPath, size }
  let canLink = true;
  const out = { ok: true, files: 0, dirs: 0, copied: 0, linked: 0, bytesCopied: 0, bytesLinked: 0,
                linksPreserved: true, skipped: [] };

  const walk = async (srcDir, destDir) => {
    await fs.promises.mkdir(destDir, { recursive: true });
    out.dirs++;
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (shouldStop && shouldStop()) { const err = new Error('Copy stopped'); err.cancelled = true; throw err; }
      const s = path.join(srcDir, e.name);
      const d = path.join(destDir, e.name);
      if (e.isDirectory()) { await walk(s, d); continue; }
      if (!e.isFile()) { out.skipped.push(path.relative(src, s)); continue; }   // symlinks, devices
      const st = fs.statSync(s, { bigint: true });
      const size = Number(st.size);
      const key = st.nlink > 1n ? `${st.dev}:${st.ino}` : null;
      const prior = key ? firstCopy.get(key) : null;
      let done = false;
      if (prior && canLink && prior.size === size) {
        try { await link(prior.destPath, d); out.linked++; out.bytesLinked += size; done = true; }
        catch (err) {
          if (NO_LINKS.has(err && err.code)) { canLink = false; out.linksPreserved = false; }
          else throw err;
        }
      }
      if (!done) {
        await fs.promises.copyFile(s, d, fs.constants.COPYFILE_EXCL);
        try { await fs.promises.utimes(d, st.atime, st.mtime); } catch {}
        out.copied++;
        out.bytesCopied += size;
        if (key && !prior) firstCopy.set(key, { destPath: d, size });
        if (prior) out.linksPreserved = false;
      }
      out.files++;
      if (onProgress) onProgress({ files: out.files, bytesCopied: out.bytesCopied, file: path.relative(src, s) });
    }
  };

  try { await walk(src, dest); }
  catch (err) {
    if (err && err.cancelled) return { ...out, ok: false, cancelled: true, error: 'Copy stopped' };
    return { ...out, ok: false, error: String(err && err.message || err) };
  }
  return out;
}

// What a tree IS, for comparing two of them ([B-498]'s three assertions): every relative path's
// content hash, every directory (an empty one too), and the partition of paths into groups that
// share one file on disk. Two trees match only when all three do; the third is what tells a
// faithful copy from one that expanded every link into its own bytes.
function treeSignature(root) {
  const crypto = require('crypto');
  const files = new Map();      // rel -> sha256
  const dirs = new Set();
  const byId = new Map();       // `${dev}:${ino}` -> [rel...]
  const walk = (abs, relDir) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name);
      const r = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) { dirs.add(r); walk(a, r); continue; }
      if (!e.isFile()) continue;
      files.set(r, crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex'));
      const st = fs.statSync(a, { bigint: true });
      const k = `${st.dev}:${st.ino}`;
      if (!byId.has(k)) byId.set(k, []);
      byId.get(k).push(r);
    }
  };
  walk(root, '');
  const groups = new Set([...byId.values()].map((g) => g.sort().join('|')));
  return { files, dirs, groups };
}

function compareTreeSignatures(a, b) {
  const problems = [];
  for (const [r, h] of a.files) {
    if (!b.files.has(r)) problems.push(`missing after: ${r}`);
    else if (b.files.get(r) !== h) problems.push(`content differs: ${r}`);
  }
  for (const r of b.files.keys()) if (!a.files.has(r)) problems.push(`extra after: ${r}`);
  for (const d of a.dirs) if (!b.dirs.has(d)) problems.push(`folder missing after: ${d}`);
  for (const d of b.dirs) if (!a.dirs.has(d)) problems.push(`folder extra after: ${d}`);
  const sameGroups = a.groups.size === b.groups.size && [...a.groups].every((g) => b.groups.has(g));
  if (!sameGroups) problems.push(`sharing differs: ${a.groups.size} groups before, ${b.groups.size} after`);
  return { same: problems.length === 0, sameContent: !problems.some((p) => !p.startsWith('sharing')), sameSharing: sameGroups, problems };
}

module.exports = { copyTreePreservingLinks, treeSignature, compareTreeSignatures };
