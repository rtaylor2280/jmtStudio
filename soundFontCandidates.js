const { cleanSuggestedName, deriveBundlePrefix } = require('./soundFontNameClean');

// Sound Fonts — candidate detection (Phase 1, slice 4).
//
// A "candidate" is something inside a source that could become a library
// entry: a Proffie-shaped font, picked out of whatever vendor structure
// wraps it. One source can produce many candidates (Father has V1 and V2,
// Power_Of_Many_Bundle has nine character fonts), or just one (HE-MAN ships
// PROFFIE/XENO V3 board flavors that are the same font).
//
// Detection walks the source's entry tree and applies four cases:
//   1. Multi-board flavors: siblings named Cfx/Proffie/Verso/etc. (folders)
//      or Asteria.zip/Proffie.zip/etc. (Greyscale inner zips). One candidate,
//      pointed at the Proffie variant.
//   2. Multi-version siblings: distinct Proffie-shaped folders at the same
//      level. Each is its own candidate.
//   3. Bundle of inner zips: root contains multiple .zip files whose stems
//      are NOT board indicators. Each inner zip is a deferred candidate
//      (library-entry creation in Phase 2 will need nested-zip extraction).
//   4. Single Proffie font: the dir itself satisfies the Proffie validation
//      shape. One candidate.
//
// Wrapper folders (a single outer folder that contains the real content) are
// transparent: the walker descends through them before classifying.

// ── Board name detection ────────────────────────────────
//
// Each board has multiple naming variants observed across vendors. The
// matcher returns a board key when the name matches any pattern, otherwise
// null. Matching is case-insensitive and tolerates surrounding text so
// "Dark Ani - Proffie", "PROFFIE", "proffie", and "1.1-Origin/Proffie" all
// register as the Proffie board.

const BOARD_PATTERNS = [
  { key: 'proffie',       rx: /(^|[\s_\-/])proffie(?:board)?(\b|[\s_\-/]|$)/i },
  { key: 'cfx',           rx: /(^|[\s_\-/])cfx(\b|[\s_\-/]|$)/i },
  { key: 'ghv3',          rx: /(^|[\s_\-/])gh\s?v\s?3([\s_\-/]|$)/i },
  { key: 'cfx-ghv3',      rx: /(^|[\s_\-/])cfx[\s_\-]?gh\s?v\s?3([\s_\-/]|$)/i },
  { key: 'xeno',          rx: /(^|[\s_\-/])xeno(pixel)?(\s?v?3)?([\s_\-/]|$)/i },
  { key: 'verso',         rx: /(^|[\s_\-/])verso[_]?([\s_\-/]|$)/i },
  { key: 'asteria',       rx: /(^|[\s_\-/])asteria([\s_\-/]|$)/i },
  { key: 'goldenharvest', rx: /(^|[\s_\-/])golden[\s_\-]?harvest([\s_\-/]|$)/i },
];

function identifyBoard(name) {
  for (const { key, rx } of BOARD_PATTERNS) {
    if (rx.test(name)) return key;
  }
  return null;
}

function isProffieBoardName(name) {
  return BOARD_PATTERNS[0].rx.test(name); // proffie entry
}

// ── Proffie font shape detection ────────────────────────

// Standard Proffie effect subfolder names. tracks/quote/quotes are excluded
// here on purpose: they are auxiliary content (menu music, movie quotes)
// commonly bundled alongside a font but never on their own. A folder
// containing only tracks/ or quote/ is NOT a Proffie font.
const EFFECT_FOLDER_NAMES = new Set([
  'boot', 'hum', 'swingh', 'swingl', 'clsh', 'blst', 'lock', 'force', 'in',
  'out', 'font', 'lb', 'bgnlb', 'endlb', 'bgnlock', 'endlock', 'melt',
  'bgnmelt', 'endmelt', 'drag', 'bgndrag', 'enddrag', 'swng', 'spin', 'stab',
  'preon', 'pwroff', 'pstoff',
]);

// Effect-name prefix for flat-layout Proffie fonts (hum1.wav, hum.wav,
// boot.wav, font.wav etc). Limited to the three reliable "core" effects
// so a bonus folder full of unrelated .wav files doesn't get
// mis-detected. Trailing variant tokens are tolerated: digits (boot1.wav),
// underscore-N (hum_1.wav), space-paren-N (font (1).WAV — Shadow Lord
// uses this shape) — so flat-layout fonts that originated from
// numbered-export tools still register.
const CORE_EFFECT_FILE_PATTERN = /^(boot|hum|font)(\s*\(\d+\)|[_\s]?\d+)?\.wav$/i;

// A folder counts as a Proffie font when ANY of:
//   - it contains at least one standard effect subfolder, or
//   - it contains at least one alt### subfolder, or
//   - it contains at least one core-effect-named .wav at root (flat layout).
// The presence of arbitrary .wav files alone is not enough; we need a Proffie
// naming signal to avoid mistaking a "bonus music" folder for a font.
function looksLikeProffieFont(childFolders, childFiles) {
  for (const f of childFolders) {
    const lower = f.name.toLowerCase();
    if (EFFECT_FOLDER_NAMES.has(lower)) return true;
    if (/^alt\d{3}$/i.test(f.name)) return true;
  }
  for (const f of childFiles) {
    if (CORE_EFFECT_FILE_PATTERN.test(f.name)) return true;
  }
  return false;
}

// ── Entry tree helpers ──────────────────────────────────

// OS-level zip artifacts that are never real content. Mac Finder zips
// drop a parallel __MACOSX/ tree of AppleDouble metadata (._foo.wav for
// every foo.wav); ignoring that whole subtree is critical because its
// shadow .wav names trip the candidate walker into seeing a duplicate
// Proffie-shaped folder. AppleDouble files can also appear outside
// __MACOSX/ when someone has copied files across volumes, so we match
// them on the segment regardless of where they show up.
function isNoiseSegment(seg) {
  if (seg === '__MACOSX') return true;
  if (seg === '.DS_Store') return true;
  if (seg === 'Thumbs.db' || seg === 'desktop.ini') return true;
  if (seg.startsWith('._')) return true;
  return false;
}

// Group source.listAll() output into a map of parentDir -> array of children
// with { name, isDir, fileName, size }. Synthesizes ancestor directory
// entries when the zip only enumerates files (most do); without this, the
// walker has no folders to descend into.
function groupByParent(entries) {
  const map = new Map();
  const ensure = (parent, name, isDir, size) => {
    if (!map.has(parent)) map.set(parent, []);
    const arr = map.get(parent);
    const existing = arr.find(x => x.name === name);
    if (existing) {
      // Promote a synthesized dir entry to a real one if we later see it
      // explicitly. Keep largest known size.
      if (isDir) existing.isDir = true;
      if (size && size > (existing.size || 0)) existing.size = size;
      return;
    }
    const fileName = parent ? `${parent}/${name}` : name;
    arr.push({ name, isDir, fileName, size: size || 0 });
  };

  for (const e of entries) {
    const isTrailingSlash = e.isDir && /\/$/.test(e.fileName);
    const stripped = isTrailingSlash ? e.fileName.replace(/\/$/, '') : e.fileName;
    if (!stripped) continue;
    const parts = stripped.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.some(isNoiseSegment)) continue;
    // Synthesize directory entries for every ancestor along the path.
    for (let i = 0; i < parts.length - 1; i++) {
      const ancestorParent = parts.slice(0, i).join('/');
      ensure(ancestorParent, parts[i], true, 0);
    }
    // Add the leaf entry with the real isDir/size.
    const leafParent = parts.slice(0, -1).join('/');
    const leafName = parts[parts.length - 1];
    ensure(leafParent, leafName, e.isDir, e.size);
  }
  return map;
}

// Recursive count of .wav files under a given dir.
function countWavsUnder(byParent, dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const children = byParent.get(d) || [];
    for (const c of children) {
      if (c.isDir) {
        stack.push(c.fileName);
      } else if (/\.wav$/i.test(c.name)) {
        total++;
      }
    }
  }
  return total;
}

// ── Multi-board sibling detection ───────────────────────

// Given the folder children at a dir, decide whether they constitute the
// multi-board flavors of a single font. Returns { proffieChild, otherFlavors,
// matchType } when they do, or null when they don't.
//
// Rules:
//   - At least two children are recognized board names.
//   - At least one of those children is the Proffie board.
//   - Folder-form siblings (e.g. Cfx/Proffie/Verso/) and zip-form siblings
//     (e.g. Asteria.zip/Proffie.zip) are both supported. Mixed-form is also
//     accepted as long as the Proffie sibling exists in some form.
function detectMultiBoardSiblings(childFolders, childFiles) {
  const boardFolderHits = [];
  for (const f of childFolders) {
    const board = identifyBoard(f.name);
    if (board) boardFolderHits.push({ ...f, board });
  }
  const boardZipHits = [];
  for (const f of childFiles) {
    if (!/\.zip$/i.test(f.name)) continue;
    const stem = f.name.replace(/\.zip$/i, '');
    const board = identifyBoard(stem);
    if (board) boardZipHits.push({ ...f, board });
  }
  const allHits = [...boardFolderHits, ...boardZipHits];
  if (allHits.length < 2) return null;
  const proffie = allHits.find(h => h.board === 'proffie');
  if (!proffie) return null;
  const others = allHits.filter(h => h !== proffie).map(h => h.name);
  return {
    proffieChild: proffie,
    otherFlavors: others,
    matchType: proffie.isDir ? 'folder-siblings' : 'inner-zip-siblings',
  };
}

// ── Bundle-of-inner-zips detection ──────────────────────

// Names that look like bonus/non-font content inside a multi-font bundle.
// Underscore prefixes ("_Extras", "_Bonus", "_ReadMe") are the convention
// across most vendors; numbered prefixes ("1- Bonus Sounds") show up in
// JayDaloRian and similar. The word-match catches plain "extras", "media",
// "manuals", etc. that some vendors ship at the bundle root.
const NON_FONT_BUNDLE_NAME = /^(?:\d+\s*[-_]\s*)?(?:_|extras?\b|bonus\b|pictures?\b|media\b|movie\b|movies\b|manuals?\b|instructions?\b|copyright\b|read.?me\b|license\b)/i;

// True when the children at this dir look like a multi-font bundle (multiple
// inner zips whose stems are NOT board indicators, e.g. Power_Of_Many_Bundle
// with Sol.zip/Yord.zip/Osha.zip). The Greyscale inner-zip case is excluded
// because those stems ARE board indicators (handled by multi-board). Bonus-
// content zips like _Extras.zip are filtered out by name convention.
function detectBundleOfZips(childFiles) {
  const zips = childFiles.filter(f => /\.zip$/i.test(f.name));
  if (zips.length < 2) return null;
  const candidateZips = zips.filter(z => {
    const stem = z.name.replace(/\.zip$/i, '');
    if (identifyBoard(stem)) return false;
    if (NON_FONT_BUNDLE_NAME.test(stem)) return false;
    return true;
  });
  if (candidateZips.length < 2) return null;
  return candidateZips;
}

// Walk down from startDir looking for the actual Proffie-font root. Many
// vendor archives wrap the real content in extra layers: JayDaloRian's
// Proffie/ holds an instruction `resource.txt` plus the actual font inside
// a `<FontName>/` subfolder. This helper descends through such wrappers
// until it finds a folder whose direct contents satisfy looksLikeProffieFont.
// Returns null if multiple sibling folders match (ambiguous, leave it to the
// caller) or if nothing matches.
function findDeepestProffieRoot(byParent, startDir) {
  const children = byParent.get(startDir) || [];
  const folders = children.filter(c => c.isDir);
  const files = children.filter(c => !c.isDir);

  if (looksLikeProffieFont(folders, files)) return startDir;
  if (folders.length === 0) return null;

  const matches = [];
  for (const f of folders) {
    const sub = findDeepestProffieRoot(byParent, f.fileName);
    if (sub) matches.push(sub);
  }
  // Exactly one descendant is a real Proffie root → that's the path. More
  // than one is multi-version-inside-Proffie, which we don't try to flatten
  // automatically; the caller falls back to the original multi-board path.
  return matches.length === 1 ? matches[0] : null;
}

// ── Main walker ─────────────────────────────────────────

function walkForCandidates(byParent, currentDir, candidates, fallbackName) {
  const children = byParent.get(currentDir) || [];
  const childFolders = children.filter(c => c.isDir);
  const childFiles = children.filter(c => !c.isDir);

  // CASE A: this dir IS a Proffie font.
  if (looksLikeProffieFont(childFolders, childFiles)) {
    // Walk up the path from the leaf, skipping board names (Proffie,
    // CFX, Verso, etc.), to find a meaningful candidate name. The leaf
    // itself is preferred when it's not a board. When all segments are
    // board names (or there are no segments), fall back to the source
    // name. Examples:
    //   1.1-BlasterMode.zip/Proffie/        -> "1.1-BlasterMode"
    //   JURASSIC/Proffie/                   -> "JURASSIC"
    //   Mountain_Sabers/STARGATE/Proffie/   -> "STARGATE"
    //   Cere/                               -> "Cere" (not board, keep leaf)
    const segments = currentDir ? currentDir.split('/').filter(Boolean) : [];
    let name = fallbackName;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (!identifyBoard(segments[i])) { name = segments[i]; break; }
    }
    candidates.push({
      name,
      path: currentDir,
      wavCount: countWavsUnder(byParent, currentDir),
      multiBoard: false,
      otherFlavors: [],
      nested: false,
    });
    return;
  }

  // CASE B: multi-board siblings (folders or inner zips). One candidate.
  const multiBoard = detectMultiBoardSiblings(childFolders, childFiles);
  if (multiBoard) {
    const name = currentDir ? currentDir.split('/').pop() : fallbackName;
    const initialPath = multiBoard.proffieChild.fileName;
    const isInnerZip = multiBoard.matchType === 'inner-zip-siblings';
    // For folder-form multi-board, descend through any wrapper layers (e.g.
    // JayDaloRian's Proffie/resource.txt + Proffie/<FontName>/) so the path
    // points at the actual font root. For inner-zip form we can't peek
    // inside the nested archive at detection time; the extractor handles
    // wrapper stripping on its end.
    const proffiePath = isInnerZip
      ? initialPath
      : (findDeepestProffieRoot(byParent, initialPath) || initialPath);
    candidates.push({
      name,
      path: proffiePath,
      wavCount: isInnerZip ? null : countWavsUnder(byParent, proffiePath),
      multiBoard: true,
      otherFlavors: multiBoard.otherFlavors,
      nested: isInnerZip,
    });
    return;
  }

  // CASE C: bundle of non-board inner zips. Each is its own candidate.
  const bundleZips = detectBundleOfZips(childFiles);
  if (bundleZips) {
    for (const z of bundleZips) {
      candidates.push({
        name: z.name.replace(/\.zip$/i, ''),
        path: z.fileName,
        wavCount: null,
        multiBoard: false,
        otherFlavors: [],
        nested: true,
      });
    }
    return;
  }

  // CASE D: descend. Each child folder may be its own candidate or another
  // wrapper layer. fallbackName is NOT overwritten with folder.name on
  // recursion: it's only consulted at the root level (when currentDir is
  // empty), so threading it unchanged lets deep cases like the CASE A
  // board-override use the source name as the real fallback (e.g.
  // 1.1-BlasterMode.zip's only child "Proffie/" can now correctly fall
  // back to "1.1-BlasterMode" instead of "Proffie").
  if (childFolders.length === 0) return;
  for (const folder of childFolders) {
    walkForCandidates(byParent, folder.fileName, candidates, fallbackName);
  }
}

// Find the deepest folder path shared by every candidate. For multi-font
// bundles like Spectre_5 (Huyang, Sabine) or Father (Father_V1, ANH, ESB,
// R1, ROTJ), this surfaces the outer bundle name. Returns null when there's
// only one candidate or when the shared folder is a generic board name (so
// e.g. multiple KSith fonts that all live under "Proffie/" don't get
// "Proffie" suggested as the bundle).
function detectBundleName(candidates) {
  if (!candidates || candidates.length < 2) return null;
  const parts = candidates.map(c => String(c.path || '').split('/').filter(Boolean));
  if (parts.some(p => p.length === 0)) return null;
  const minLen = Math.min(...parts.map(p => p.length));
  const common = [];
  for (let i = 0; i < minLen; i++) {
    const seg = parts[0][i];
    if (parts.every(p => p[i] === seg)) common.push(seg);
    else break;
  }
  if (common.length === 0) return null;
  const last = common[common.length - 1];
  if (/^(proffie|cfx|verso|asteria|xenopixel|xeno|goldenharvest|ghv3|cfx-?ghv3)$/i.test(last)) return null;
  return last;
}

// Parse a candidate's raw inner-folder name for a trailing version
// suffix (X_V1 / X_V2.4 / X v3 / X-v1.0). Returns { stem, version,
// versionParts } when the name ends in v<number>, or null when it
// doesn't. Used to identify "multi-version sibling" candidates that
// the vendor bundled together (V1 + V2 of the same font); the highest
// gets taken, the others are noted as skipped.
function _parseVersionFromName(name) {
  const m = String(name || '').match(/^(.+?)[\s_-]+[vV](\d+(?:\.\d+)*)$/);
  if (!m) return null;
  const parts = m[2].split('.').map(s => parseInt(s, 10));
  if (parts.some(n => Number.isNaN(n))) return null;
  return { stem: m[1], version: 'V' + m[2], versionParts: parts };
}

function _compareVersionParts(a, b) {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

// Collapse groups of candidates whose raw names share a stem and
// differ only by a trailing version suffix. The highest-version
// member wins, its name becomes the stem (the cleaner downstream then
// idempotently strips any nested version stamp), and the other
// members are attached as `skippedVersions` metadata so the import
// path can stamp the version on the new entry and surface a review
// reason. Single-version sibling groups are left untouched. Mixed
// groups (some with versions, some without) treat the versioned ones
// as their own group and leave the unversioned one alone.
function _collapseVersionSiblings(candidates) {
  const parsed = candidates.map(c => ({ c, v: _parseVersionFromName(c.name) }));
  const groups = new Map();
  const ungrouped = [];
  for (const item of parsed) {
    if (!item.v) { ungrouped.push(item.c); continue; }
    const k = item.v.stem.toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  const out = ungrouped.slice();
  for (const items of groups.values()) {
    if (items.length === 1) {
      // Solo versioned candidate — leave as is; downstream name
      // cleaner strips the trailing version.
      out.push(items[0].c);
      continue;
    }
    items.sort((a, b) => _compareVersionParts(a.v.versionParts, b.v.versionParts));
    const winner = items[items.length - 1];
    const losers = items.slice(0, -1);
    const merged = { ...winner.c };
    merged.name = winner.v.stem;
    merged.takenVersion = winner.v.version;
    merged.skippedVersions = losers.map(l => ({
      version: l.v.version,
      path: l.c.path,
      rawName: l.c.name,
    }));
    out.push(merged);
  }
  return out;
}

async function detectCandidates(source) {
  if (!source || typeof source.listAll !== 'function') {
    return { candidates: [] };
  }
  const entries = await source.listAll();
  const byParent = groupByParent(entries);
  const rawCandidates = [];
  const sourceFallbackName = (source.meta && source.meta.originalName)
    ? source.meta.originalName.replace(/\.zip$/i, '')
    : 'source';
  walkForCandidates(byParent, '', rawCandidates, sourceFallbackName);
  // Multi-version sibling collapse runs BEFORE name cleaning so the
  // sibling-detection regex sees the original `X_V1` / `X_V2` shape
  // (cleaning would strip the version and merge them via name
  // collision instead, which loses the version info).
  const candidates = _collapseVersionSiblings(rawCandidates);
  // Clean every candidate name through the shared pipeline before the
  // renderer sees them. Original name is preserved on rawName for any
  // future caller that needs the unmodified inner-folder string.
  for (const c of candidates) {
    c.rawName = c.name;
    const cleaned = cleanSuggestedName(c.name);
    if (cleaned) c.name = cleaned;
  }
  // The "bundle" concept only applies when a source produces multiple
  // candidate fonts. For a single-font source, the source name and the
  // font name are the same thing, so tagging the entry with the source
  // name would be redundant (and arguably wrong). Only stamp the bundle
  // name on candidates when count >= 2. The source's own friendly name is
  // a separate concern handled by the renderer when saving source meta.
  let bundleName = candidates.length >= 2 ? detectBundleName(candidates) : null;
  if (!bundleName && candidates.length >= 2) bundleName = sourceFallbackName;
  let bundlePrefix = null;
  if (bundleName) {
    const cleanedBundle = cleanSuggestedName(bundleName);
    if (cleanedBundle) bundleName = cleanedBundle;
    // Prefix is derived from the cleaned bundle name with Bundle/Pack
    // additionally stripped — those belong in the source's display name
    // but not on every per-font prefix.
    bundlePrefix = deriveBundlePrefix(bundleName) || bundleName;
    for (const c of candidates) {
      c.bundleName = bundleName;
      c.bundlePrefix = bundlePrefix;
    }
  }
  return { candidates, bundleName, bundlePrefix };
}

module.exports = {
  detectCandidates,
  detectBundleName,
  // exported for testing / introspection
  identifyBoard,
  looksLikeProffieFont,
};
