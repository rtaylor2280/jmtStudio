// Reorganize operations for a sound font entry. Powers the Reorganize
// modal in the entry detail view: bucket detection, layout restructure
// (flat ↔ grouped), reorder-and-renumber within a bucket, and a
// folder-scoped find/replace with wildcard support.
//
// Conventions:
//   - "Bucket"  — a Proffie sound effect group, e.g. "boot", "clsh",
//                 "swingh". Detected from a subfolder name OR from the
//                 letters-only prefix on a root-level file.
//   - "Effect"  — the canonical lowercase bucket name (no number suffix).
//   - "Padded"  — preserves the user's local padding convention. Mixed
//                 widths fall back to no padding (matches the same rule
//                 the file-ops Proffie variant name helper uses).
//
// All operations work on an entry directory (userData/soundFonts/library/
// <name>/). Single-file singletons that sit at the entry root remain at
// the root after a Group restructure; the user can manually fold them
// into a subfolder if they want one.

const fs = require('fs');
const path = require('path');

// Letters-or-empty + digits-or-empty + extension. Empty stem ('.wav')
// fails downstream because we reject names where both groups are empty.
// Bare-numeric files ('1.wav') parse with effect='' — they're canonical
// inside a named subfolder ('boot/1.wav' plays as boot) but anomalous
// at the entry root.
const _FILE_NAME_RE = /^([a-zA-Z]*)(\d*)(\.[a-zA-Z0-9]+)$/;

function _root(userData, entryName) {
  if (!entryName) throw new Error('Missing entry name');
  const root = path.resolve(path.join(userData, 'soundFonts', 'library', entryName));
  if (!fs.existsSync(root)) throw new Error('Entry not found');
  return root;
}

function _safe(root, sub) {
  const target = path.resolve(root, String(sub || '').replace(/\\/g, '/'));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Path escapes entry root');
  }
  return target;
}

// Parse a filename into { effect, num, ext, raw }. Returns null when the
// name doesn't match the <letters><digits?>.<ext> shape — those files
// land in their own one-off "bucket" keyed by the full stem.
function _parseName(name) {
  const m = name.match(_FILE_NAME_RE);
  if (!m) return null;
  if (!m[1] && !m[2]) return null; // reject '.wav' (no stem)
  return {
    effect: m[1].toLowerCase(),
    num: m[2] === '' ? null : parseInt(m[2], 10),
    padLen: m[2].length,
    ext: m[3].toLowerCase(),
    raw: name,
  };
}

// Detect buckets in an entry. Returns a flat list ordered by:
// subfolder buckets first (alphabetical by subfolderName), then root
// buckets (alphabetical by effect). A conflict (same effect exists at
// root AND in a subfolder) yields TWO buckets with a stable display
// label suffix "(2)" on the second; both flagged isConflict=true.
//
// Bucket shape:
//   {
//     id: 'sub:boot' | 'root:font',  // unique within the response
//     label: 'boot' | 'font (2)',    // user-visible
//     effect: 'boot',
//     location: 'subfolder' | 'root',
//     subfolderName: 'boot' | null,
//     files: [{ path, name, num, padLen, ext, isMisnamed }],
//     hasMisnamed: boolean,
//     isConflict: boolean,
//   }
function detectBuckets(userData, entryName) {
  const root = _root(userData, entryName);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const subBuckets = [];
  const rootBucketsByEffect = new Map();
  for (const e of entries) {
    if (e.name === 'meta.json') continue;
    if (e.isDirectory()) {
      const effect = e.name.toLowerCase();
      const folder = path.join(root, e.name);
      let inner;
      try { inner = fs.readdirSync(folder, { withFileTypes: true }); }
      catch { inner = []; }
      const files = [];
      let hasMisnamed = false;
      for (const f of inner) {
        if (!f.isFile()) continue;
        const parsed = _parseName(f.name);
        // Inside a named subfolder, a bare-numeric file (1.wav) plays as
        // the folder's effect — that's canonical Proffie. Only flag
        // misnamed when the file's own effect prefix exists AND differs
        // from the folder's name.
        const isMisnamed = !parsed || (parsed.effect !== '' && parsed.effect !== effect);
        if (isMisnamed) hasMisnamed = true;
        files.push({
          path: `${e.name}/${f.name}`,
          name: f.name,
          num: parsed ? parsed.num : null,
          padLen: parsed ? parsed.padLen : 0,
          ext: parsed ? parsed.ext : path.extname(f.name).toLowerCase(),
          isMisnamed,
        });
      }
      subBuckets.push({
        id: `sub:${e.name}`,
        label: e.name,
        effect,
        location: 'subfolder',
        subfolderName: e.name,
        files: _sortBucketFiles(files),
        hasMisnamed,
        isConflict: false,
      });
    } else if (e.isFile()) {
      const parsed = _parseName(e.name);
      // Root-level files derive their bucket from the letters prefix
      // when present. Bare-numeric ('1.wav') and unparseable names fall
      // back to the stem so they still surface as a one-off bucket the
      // user can see and act on — never silently orphaned.
      const stem = e.name.replace(/\.[^.]*$/, '').toLowerCase();
      const effect = (parsed && parsed.effect) ? parsed.effect : stem;
      if (!rootBucketsByEffect.has(effect)) {
        rootBucketsByEffect.set(effect, {
          id: `root:${effect}`,
          label: effect,
          effect,
          location: 'root',
          subfolderName: null,
          files: [],
          hasMisnamed: false,
          isConflict: false,
        });
      }
      const b = rootBucketsByEffect.get(effect);
      b.files.push({
        path: e.name,
        name: e.name,
        num: parsed ? parsed.num : null,
        padLen: parsed ? parsed.padLen : 0,
        ext: parsed ? parsed.ext : path.extname(e.name).toLowerCase(),
        isMisnamed: false,
      });
    }
  }
  // Conflict pass — same effect present in BOTH a subfolder and at root.
  // Mark both, append " (2)" to whichever shows second in the final order.
  const subEffects = new Set(subBuckets.map(b => b.effect));
  for (const b of subBuckets) {
    if (rootBucketsByEffect.has(b.effect)) {
      b.isConflict = true;
      const other = rootBucketsByEffect.get(b.effect);
      other.isConflict = true;
      other.label = `${other.effect} (2)`;
    }
  }
  // Sort and merge: subfolders first (alpha), then root effects (alpha).
  subBuckets.sort((a, b) => a.subfolderName.localeCompare(b.subfolderName));
  const rootBuckets = Array.from(rootBucketsByEffect.values())
    .sort((a, b) => a.effect.localeCompare(b.effect));
  for (const b of subBuckets) b.files = _sortBucketFiles(b.files);
  for (const b of rootBuckets) b.files = _sortBucketFiles(b.files);
  return [...subBuckets, ...rootBuckets];
}

// Sort: unnumbered file first (Proffie treats it as position 1), then by
// ascending number. Stable for misnamed entries — they get sorted to the
// end by their raw name so the reorder UI surfaces them as anomalies.
function _sortBucketFiles(files) {
  return files.slice().sort((a, b) => {
    if (a.isMisnamed !== b.isMisnamed) return a.isMisnamed ? 1 : -1;
    const aHas = a.num !== null;
    const bHas = b.num !== null;
    if (aHas !== bHas) return aHas ? 1 : -1; // unnumbered first
    if (aHas && bHas) return a.num - b.num;
    return a.name.localeCompare(b.name);
  });
}

// Quick layout summary used to enable/disable Restructure buttons.
//   canGroup    — at least one multi-file bucket sits at root
//   canFlatten  — at least one subfolder bucket exists
// Mixed fonts (some root multi-file + some subfolders) → both true.
function detectLayout(userData, entryName) {
  const buckets = detectBuckets(userData, entryName);
  let canGroup = false;
  let canFlatten = false;
  for (const b of buckets) {
    if (b.location === 'subfolder') canFlatten = true;
    if (b.location === 'root' && b.files.length >= 2) canGroup = true;
  }
  return { canGroup, canFlatten, buckets };
}

// Decide the padding width to use when renumbering. Mirrors the
// Proffie-variant naming rule in soundFontFileOps:
//   - One distinct width in input → keep it
//   - Multiple widths (mixed) → no padding (user style varies; safer to
//     normalize toward Proffie's lenient parser)
//   - No padding at all in input → no padding
function _pickPadLen(files) {
  const widths = new Set();
  for (const f of files) {
    if (f.num === null) continue;
    if (f.padLen > 0) widths.add(f.padLen);
  }
  if (widths.size === 1) return [...widths][0];
  return 0;
}

function _padded(num, padLen) {
  return padLen > 0 ? String(num).padStart(padLen, '0') : String(num);
}

// Two-phase rename inside a single directory: rename every member of
// `pairs` ({ from, to }) through a temporary name first, then to its
// final name. Avoids collisions when the new sequence overlaps the old.
function _atomicRenameBatch(dir, pairs) {
  if (!pairs.length) return { ok: true };
  const tag = `__sfrx_${process.pid}_${Date.now()}__`;
  const tempPairs = [];
  // Phase 1 — move each `from` to a unique temp name.
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const tmp = `${tag}${i}_${p.from}`;
    const fromAbs = path.join(dir, p.from);
    const tmpAbs = path.join(dir, tmp);
    if (!fs.existsSync(fromAbs)) continue;
    fs.renameSync(fromAbs, tmpAbs);
    tempPairs.push({ tmp, to: p.to, from: p.from });
  }
  // Phase 2 — move each temp to the final name.
  for (const t of tempPairs) {
    const tmpAbs = path.join(dir, t.tmp);
    const toAbs = path.join(dir, t.to);
    fs.renameSync(tmpAbs, toAbs);
  }
  return { ok: true };
}

// Restructure → grouped layout. Every root-level bucket with 2+ files is
// moved into a subfolder named after the effect; singletons stay at root
// per the "only group when more than one" rule. Misnamed files inside an
// existing subfolder are NOT touched here — that's a separate fix the
// user makes via rename or move.
function restructureToGrouped(userData, entryName) {
  const root = _root(userData, entryName);
  const buckets = detectBuckets(userData, entryName);
  const moved = [];
  for (const b of buckets) {
    if (b.location !== 'root') continue;
    if (b.files.length < 2) continue;
    // Subfolder name uses the effect verbatim. If a subfolder with the
    // same name already exists (conflict bucket) we bail and let the
    // user resolve the conflict by hand — auto-merging would silently
    // mix files from two distinct sources.
    const dir = path.join(root, b.effect);
    if (fs.existsSync(dir)) {
      throw new Error(`Cannot group "${b.effect}" — a subfolder with that name already exists`);
    }
    fs.mkdirSync(dir);
    for (const f of b.files) {
      const src = path.join(root, f.name);
      const dst = path.join(dir, f.name);
      fs.renameSync(src, dst);
      moved.push({ from: f.name, to: `${b.effect}/${f.name}` });
    }
  }
  return { ok: true, moved };
}

// Restructure → flat layout. Every subfolder is dissolved: each file
// moves to root with its filename made unique by prefixing the effect
// when needed. Singletons inside a subfolder also move out. Misnamed
// files keep their original name (would collide with another bucket if
// renamed). Folder is removed after its contents are out.
function restructureToFlat(userData, entryName) {
  const root = _root(userData, entryName);
  const buckets = detectBuckets(userData, entryName);
  const moved = [];
  for (const b of buckets) {
    if (b.location !== 'subfolder') continue;
    for (const f of b.files) {
      const src = path.join(root, b.subfolderName, f.name);
      // If the file already begins with the effect prefix (e.g.
      // boot01.wav inside boot/), keep its name. If it's just digits
      // (1.wav inside boot/), prepend the effect: boot1.wav.
      const parsed = _parseName(f.name);
      let target;
      if (parsed && parsed.effect === b.effect) {
        target = f.name;
      } else if (parsed && parsed.effect === '' && parsed.num !== null) {
        target = `${b.effect}${_padded(parsed.num, parsed.padLen)}${parsed.ext}`;
      } else if (f.isMisnamed) {
        target = f.name; // keep — won't collide with bucket's own files
      } else {
        target = `${b.effect}${f.name}`;
      }
      const dst = path.join(root, target);
      if (fs.existsSync(dst)) {
        throw new Error(`Cannot flatten — "${target}" already exists at the entry root`);
      }
      fs.renameSync(src, dst);
      moved.push({ from: `${b.subfolderName}/${f.name}`, to: target });
    }
    // Folder should be empty now; remove it.
    try { fs.rmdirSync(path.join(root, b.subfolderName)); } catch {}
  }
  return { ok: true, moved };
}

// Apply a user-staged reorder to a single bucket. orderedPaths is the
// full ordered list of file subpaths (relative to entry root) as they
// should appear after save. Files are renumbered 1..N in display order,
// preserving padding convention. Unnumbered file in the bucket gets a
// number; misnamed files at the tail keep their existing name (they
// were dragged but aren't part of the auto-numbered sequence).
function applyReorder(userData, entryName, bucketId, orderedPaths) {
  const root = _root(userData, entryName);
  const buckets = detectBuckets(userData, entryName);
  const bucket = buckets.find(b => b.id === bucketId);
  if (!bucket) throw new Error('Bucket not found');
  // Validate every path in orderedPaths belongs to the bucket. Drop any
  // that don't (defensive — UI should never send foreign paths).
  const bucketPaths = new Set(bucket.files.map(f => f.path));
  const ordered = orderedPaths.filter(p => bucketPaths.has(p));
  if (ordered.length === 0) return { ok: true, renamed: [] };
  // Decide pad width from existing files, not the reorder result.
  const padLen = _pickPadLen(bucket.files);
  // Where do files live? subfolder bucket → inside that subfolder;
  // root bucket → at root.
  const workingDir = bucket.location === 'subfolder'
    ? path.join(root, bucket.subfolderName)
    : root;
  // Build the rename pairs. Numbered position increments by 1 for every
  // non-misnamed file in display order; misnamed files keep their name.
  const pairs = [];
  let n = 1;
  for (const subPath of ordered) {
    const f = bucket.files.find(x => x.path === subPath);
    const oldBasename = f.name;
    if (f.isMisnamed) continue;
    // For a subfolder bucket where files use bare-numeric names (1.wav),
    // keep the bare-numeric scheme. Otherwise use <effect><N><ext>.
    const usesBareNumbers = bucket.location === 'subfolder'
      && bucket.files.every(x => x.isMisnamed || _parseName(x.name)?.effect === '');
    const newBasename = usesBareNumbers
      ? `${_padded(n, padLen)}${f.ext}`
      : `${bucket.effect}${_padded(n, padLen)}${f.ext}`;
    n++;
    if (oldBasename !== newBasename) pairs.push({ from: oldBasename, to: newBasename });
  }
  _atomicRenameBatch(workingDir, pairs);
  return {
    ok: true,
    renamed: pairs.map(p => ({
      from: bucket.location === 'subfolder' ? `${bucket.subfolderName}/${p.from}` : p.from,
      to:   bucket.location === 'subfolder' ? `${bucket.subfolderName}/${p.to}`   : p.to,
    })),
  };
}

// Apply a find pattern to a filename STEM (extension is handled by the
// caller, so we never touch it). Wildcards `*` and `?` get glob
// semantics — `*` matches any run of characters, `?` matches one. The
// matched span is replaced literally with the replace string; no
// preservation of "the rest of the match" — collisions that result are
// resolved by Proffie variant naming downstream.
function _findReplaceStem(stem, find, replaceStr) {
  const hasWild = /[*?]/.test(find);
  if (hasWild) {
    const escaped = find.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
    const m = stem.match(re);
    if (!m) return null;
    return stem.slice(0, m.index) + replaceStr + stem.slice(m.index + m[0].length);
  }
  const idx = stem.toLowerCase().indexOf(find.toLowerCase());
  if (idx < 0) return null;
  return stem.slice(0, idx) + replaceStr + stem.slice(idx + find.length);
}

// Pure in-memory Proffie variant — given a desired base filename and a
// Set of already-taken names in the same directory, return the next
// free variant using the same padding rules the file-ops helper uses.
// Used by find/replace so the user doesn't have to think about
// collisions: if "cls*" → "clash" sends 8 files at "clash.wav", they
// land as clash.wav, clash1.wav, clash2.wav... in stable input order.
function _virtualVariantName(desiredName, takenSet) {
  if (!takenSet.has(desiredName)) return desiredName;
  const ext = path.extname(desiredName);
  const stem = path.basename(desiredName, ext);
  const baseMatch = stem.match(/^(.*?)(\d*)$/);
  const base = (baseMatch && baseMatch[1]) || stem;
  const srcPad = (baseMatch && baseMatch[2]) ? baseMatch[2].length : 0;
  let maxNum = 0;
  const padLens = new Set();
  for (const name of takenSet) {
    if (path.extname(name) !== ext) continue;
    const nStem = path.basename(name, ext);
    if (nStem === base) { if (maxNum < 1) maxNum = 1; continue; }
    if (!nStem.startsWith(base)) continue;
    const rest = nStem.substring(base.length);
    if (!/^\d+$/.test(rest)) continue;
    const num = parseInt(rest, 10);
    if (num > maxNum) maxNum = num;
    padLens.add(rest.length);
  }
  let padLen;
  if (padLens.size === 0) padLen = srcPad;
  else if (padLens.size === 1) padLen = [...padLens][0];
  else padLen = 0;
  let n = maxNum + 1;
  while (true) {
    const candidate = `${base}${String(n).padStart(padLen, '0')}${ext}`;
    if (!takenSet.has(candidate)) return candidate;
    n++;
  }
}

// Entry-wide find/replace. Walks every subfolder in the entry, only
// touches FILE basenames (folder names are left alone). Returns a
// preview by default; pass commit=true to actually rename.
//
// find supports wildcards (* and ?). When the pattern has no wildcards,
// it's a substring replacement (case-insensitive match, replacement
// string is the literal text from the field). With wildcards, the
// pattern matches the whole filename and the replacement string fully
// replaces it.
//
// Collision-safety per-directory: each directory's matches are committed
// in a two-phase atomic batch so renames that swap within a directory
// don't fight each other.
function findReplaceInEntry(userData, entryName, find, replace, opts = {}) {
  const root = _root(userData, entryName);
  const findStr = String(find || '');
  if (!findStr) return { ok: false, error: 'Find text is required' };
  const replaceStr = String(replace || '');
  // Group proposals by directory; per-folder we resolve collisions
  // using the Proffie variant rule against a virtual "taken" set seeded
  // with all the unchanged files in that directory.
  const byDir = new Map(); // absDir → { proposals, taken }
  const walk = (absDir, relDir) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    // First pass — collect file names + pick out which ones match the
    // find pattern. Non-matches join the taken set so collisions
    // against them get variant-resolved.
    const allFileNames = [];
    const matches = [];
    for (const e of entries) {
      const absChild = path.join(absDir, e.name);
      const relChild = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(absChild, relChild); continue; }
      if (!e.isFile()) continue;
      if (!relDir && e.name === 'meta.json') continue; // app-internal record
      allFileNames.push(e.name);
      const ext = path.extname(e.name);
      const stem = ext ? e.name.slice(0, -ext.length) : e.name;
      const newStem = _findReplaceStem(stem, findStr, replaceStr);
      if (newStem === null || newStem === stem) continue;
      matches.push({ oldName: e.name, newStem, ext, relChild });
    }
    if (!matches.length) return;
    // Seed taken with everyone who ISN'T being renamed.
    const matchedNames = new Set(matches.map(m => m.oldName));
    const taken = new Set(allFileNames.filter(n => !matchedNames.has(n)));
    const proposals = [];
    for (const m of matches) {
      const desired = m.newStem + m.ext;
      // Empty stem (someone replaced the whole name with nothing) is a
      // hard error — we won't try to invent a name for them.
      if (!m.newStem) {
        proposals.push({
          from: m.oldName, to: desired, relFrom: m.relChild,
          relTo: relDir ? `${relDir}/${desired}` : desired,
          error: 'Replacement would leave an empty name',
        });
        continue;
      }
      let finalName = desired;
      if (/[\\/<>:"|?*\x00-\x1f]/.test(desired)) {
        proposals.push({
          from: m.oldName, to: desired, relFrom: m.relChild,
          relTo: relDir ? `${relDir}/${desired}` : desired,
          error: 'Result has invalid characters',
        });
        continue;
      }
      finalName = _virtualVariantName(desired, taken);
      taken.add(finalName);
      proposals.push({
        from: m.oldName, to: finalName,
        relFrom: m.relChild,
        relTo: relDir ? `${relDir}/${finalName}` : finalName,
      });
    }
    byDir.set(absDir, { proposals, taken });
  };
  walk(root, '');
  const flat = [];
  for (const v of byDir.values()) for (const p of v.proposals) flat.push(p);
  if (!opts.commit) return { ok: true, preview: flat };
  // Commit — variant resolution already guaranteed every target name is
  // unique within its directory. Run the two-phase atomic rename per
  // folder so name swaps inside one dir don't fight each other.
  const renamed = [];
  for (const [absDir, v] of byDir.entries()) {
    const ok = v.proposals.filter(p => !p.error);
    _atomicRenameBatch(absDir, ok.map(p => ({ from: p.from, to: p.to })));
    for (const p of ok) renamed.push(p);
  }
  return { ok: true, renamed };
}

module.exports = {
  detectBuckets,
  detectLayout,
  restructureToGrouped,
  restructureToFlat,
  applyReorder,
  findReplaceInEntry,
};
