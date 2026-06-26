const fs = require('fs');
const path = require('path');
const os = require('os');
const StreamZip = require('node-stream-zip');
const { cleanSuggestedName, deriveBundlePrefix } = require('./soundFontNameClean');

// Composite-path separator that encodes "inside an inner zip." When a
// candidate's path contains this character, the part before it is the
// inner zip name (within the outer source), and the part after is the
// subtree prefix inside the inner zip's contents. _extractNestedZipToDir
// reads this to extract exactly the right slice instead of dumping the
// whole inner zip and post-processing.
const INNER_ZIP_SEP = '!';

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

// ── Effect vocabulary ──────────────────────────────────────
//
// EFFECT_NAMES is the canonical set of Proffie effect names this app
// recognizes. Used as subfolder names (hum/, swingh/, blst/) and as
// file-name prefixes for flat-layout fonts (hum01.wav, swingh1.wav,
// blst1.wav). Drives both the looksLikeProffieFont gating and the
// per-entry effects array that renders the entry-detail chip row.
//
// Source: empirically curated against the real-world Proffie ecosystem
// (Fett263, Kyberphonic, Greyscale, BKSaberSounds, JayDalorian, etc.).
// Utility-font effects (altchng, trloop, ccchange, choosefont) are
// included so minimal alt-driven fonts like Fett263's HeMan still
// register. Auxiliary content (tracks/, quote/, quotes/, common/) is
// excluded — these are bundled alongside fonts but are not effects in
// the ProffieOS sense.
//
// Maintenance discipline (do this when surfaces start mentioning effects
// we don't recognize):
//   1. Diff-check against the canonical ProffieOS sources:
//      - Fredrik Hubbe's docs: https://fredrik.hubbe.net/lightsaber/sound.html
//      - ProffieOS source: the Effect class registrations (search for
//        EFFECT() macro usages in proffieboard/sound/effect.h or
//        equivalent).
//   2. Monitor the unknownEffects array surfaced by entry meta after
//      backfill. When an unknown name shows up repeatedly across user
//      libraries, that's organic feedback that it should be promoted
//      to EFFECT_NAMES.
//   3. When adding here, also update _SF_KNOWN_EFFECTS in
//      renderer/index.html (the renderer mirrors this list because it
//      computes "missing" client-side; an IPC bridge is overkill until
//      the list starts churning).
//
// Safety net for delayed maintenance: the unknown-effect detection in
// _collectRootEffectTypesWithUnknown surfaces any "looks like an effect
// dir" folder (numbered .wav children) that isn't in EFFECT_NAMES.
// Those render as gray chips in the entry detail so users see the
// effect even if our vocabulary is behind. Missing chips stay against
// the known set only (we can't predict what's not there if we don't
// know the universe).
const EFFECT_NAMES = new Set([
  'boot', 'hum', 'swingh', 'swingl', 'swing', 'clsh', 'blst', 'lock', 'force',
  'in', 'out', 'font', 'lb', 'bgnlb', 'endlb', 'bgnlock', 'endlock', 'melt',
  'bgnmelt', 'endmelt', 'drag', 'bgndrag', 'enddrag', 'swng', 'spin', 'stab',
  'preon', 'pwroff', 'pstoff',
  // 2026-06-26 promotions from the unknown-effect safety-net (color
  // landed in 64 of 186 entries, lowbatt in 53; both are legit Proffie
  // effects ProffieOS recognizes at runtime).
  'color', 'lowbatt',
  'altchng', 'trloop', 'ccchange', 'choosefont',
]);

// Folders we explicitly skip when looking for "is this an effect dir?"
// because they're known non-effect content. Comparing lowercase.
//   - tracks/track: menu music / blade music (both pluralizations seen)
//   - quote, quotes: movie quote samples
//   - common: Proffie SD-card convention for shared sounds (lives at
//     SD root in deployment but vendors sometimes ship inside font)
//   - __macosx: Mac OS zip metadata artifact
//   - _extras, extras, extra, bonus: vendor-pack auxiliary content
//   - proffie/asteria/cfx/cfx-ghv3/ghv3/verso/xeno3/xenopixel/
//     goldenharvest: board-format wrapper folders. These should never
//     appear at the entry root in a properly-imported font; when they
//     do it's the architecture issue tracked in backlog (nested-zip
//     extraction not stripping the wrapper). Excluding here keeps the
//     unknown-effect surface clean of those false positives.
const EFFECT_DIR_EXCLUSIONS = new Set([
  'tracks', 'track', 'quote', 'quotes', 'common', '__macosx',
  '_extras', 'extras', 'extra', 'bonus',
  'proffie', 'proffieboard', 'asteria', 'cfx', 'cfx-ghv3', 'cfxghv3',
  'ghv3', 'verso', 'xeno3', 'xenopixel', 'xeno', 'goldenharvest',
]);

// "Does this folder look like an effect dir?" Conservative heuristic:
// only true when the folder name is not on the exclusion list AND it
// contains at least one .wav file (numbered or flat). Empty folders
// and folders with random non-audio content don't auto-promote to
// "effect." Caller supplies the folder's immediate children.
function looksLikeEffectDir(folderName, childDirents) {
  if (!folderName) return false;
  const lower = String(folderName).toLowerCase();
  if (EFFECT_DIR_EXCLUSIONS.has(lower)) return false;
  if (lower.startsWith('.')) return false; // hidden dirs
  if (!Array.isArray(childDirents)) return false;
  for (const c of childDirents) {
    if (c && !c.isDir && /\.wav$/i.test(String(c.name || c.fileName || ''))) return true;
  }
  return false;
}

// Minimum distinct effect types a folder must have (counting alt expansion)
// to register as a Proffie font. Empirically verified across 69 sources:
// every real font in the library passes 3+, every bonus / not-a-font folder
// caps at 2. See local/analyze-detection.js for the data.
const MIN_EFFECT_TYPES = 3;

// Extract the effect-name stem from a .wav filename. Recognizes flat-layout
// shapes: hum.wav, hum01.wav, hum_1.wav, hum 1.wav, hum (1).wav, font (1).WAV.
// Returns the lowercased stem if it's a known effect, else null.
function effectStemFromFile(name) {
  const m = String(name).match(/^([a-zA-Z]+)(?:\s*\(\d+\)|[_\s]?\d+)?\.wav$/i);
  if (!m) return null;
  const stem = m[1].toLowerCase();
  return EFFECT_NAMES.has(stem) ? stem : null;
}

// Collect the distinct effect-type set at a folder's immediate level,
// without descending into alt children.
function _collectRootEffectTypes(folders, files) {
  const types = new Set();
  for (const f of folders) {
    const lower = f.name.toLowerCase();
    if (EFFECT_NAMES.has(lower)) types.add(lower);
  }
  for (const f of files) {
    const stem = effectStemFromFile(f.name);
    if (stem) types.add(stem);
  }
  return types;
}

// Collect effect types including a peek into the first alt### sibling.
// Alts mirror each other (the maker MUST ship identical effect shapes
// across alts), so one is enough. Alt-only effects (hum1+hum2 inside the
// alts, with in/out shared at root) get unioned into the parent's count
// so the parent registers as the font.
function _collectEffectTypes(folders, files, byParent) {
  const types = _collectRootEffectTypes(folders, files);
  const firstAlt = folders.find(f => /^alt\d{3}$/i.test(f.name));
  if (!firstAlt) return types;
  const altChildren = byParent.get(firstAlt.fileName) || [];
  const altFolders = altChildren.filter(c => c.isDir);
  const altFiles = altChildren.filter(c => !c.isDir);
  const altTypes = _collectRootEffectTypes(altFolders, altFiles);
  for (const t of altTypes) types.add(t);
  return types;
}

// A folder counts as a Proffie font when it contains at least
// MIN_EFFECT_TYPES distinct recognized effect types at its immediate
// level (with alt expansion). The threshold and vocabulary were tuned
// against the real-world library — see analyzer notes above.
function looksLikeProffieFont(childFolders, childFiles, byParent) {
  return _collectEffectTypes(childFolders, childFiles, byParent || new Map()).size >= MIN_EFFECT_TYPES;
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

// Walk down from startDir looking for Proffie-font roots. Returns an
// array of paths — empty when nothing matches, one entry when there's a
// single unambiguous root (e.g. JayDaloRian's wrapper `Proffie/<Font>/`),
// or multiple entries when the maker shipped sibling variants inside one
// board folder (e.g. Excalibur's `Proffie/long ignition/` +
// `Proffie/short ignition/`, Quantum's `Proffie/style 1..3/`).
//
// Caller decides what to do with multiple roots: CASE B (multi-board)
// emits one candidate per root; CASE A's wrapper-traversal at the leaf
// uses the single-root form below.
function findAllProffieRoots(byParent, startDir) {
  const children = byParent.get(startDir) || [];
  const folders = children.filter(c => c.isDir);
  const files = children.filter(c => !c.isDir);

  if (looksLikeProffieFont(folders, files, byParent)) return [startDir];
  if (folders.length === 0) return [];

  const matches = [];
  for (const f of folders) {
    for (const sub of findAllProffieRoots(byParent, f.fileName)) {
      matches.push(sub);
    }
  }
  return matches;
}

// Single-root form for callers that don't want the variant-emission
// behavior. Returns null when zero or multiple roots are found, the
// single path otherwise. Preserved for back-compat with CASE A's
// segment-walk-up naming logic.
function findDeepestProffieRoot(byParent, startDir) {
  const all = findAllProffieRoots(byParent, startDir);
  return all.length === 1 ? all[0] : null;
}

// ── Main walker ─────────────────────────────────────────

function walkForCandidates(byParent, currentDir, candidates, fallbackName) {
  const children = byParent.get(currentDir) || [];
  const childFolders = children.filter(c => c.isDir);
  const childFiles = children.filter(c => !c.isDir);

  // CASE A: this dir IS a Proffie font.
  if (looksLikeProffieFont(childFolders, childFiles, byParent)) {
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

  // CASE B: multi-board siblings (folders or inner zips).
  const multiBoard = detectMultiBoardSiblings(childFolders, childFiles);
  if (multiBoard) {
    const outerName = currentDir ? currentDir.split('/').pop() : fallbackName;
    const initialPath = multiBoard.proffieChild.fileName;
    const isInnerZip = multiBoard.matchType === 'inner-zip-siblings';

    if (isInnerZip) {
      // Can't peek inside nested archives at detection time; emit one
      // deferred candidate and let the extractor strip wrappers later.
      candidates.push({
        name: outerName,
        path: initialPath,
        wavCount: null,
        multiBoard: true,
        otherFlavors: multiBoard.otherFlavors,
        nested: true,
      });
      return;
    }

    // For folder-form multi-board, descend through any wrapper layers
    // (e.g. JayDaloRian's Proffie/resource.txt + Proffie/<FontName>/) so
    // the path points at the actual font root.
    const proffieRoots = findAllProffieRoots(byParent, initialPath);

    if (proffieRoots.length === 0) {
      // No font shape found inside Proffie — defensive fallback to the
      // bare board folder, same as the pre-variant behavior.
      candidates.push({
        name: outerName,
        path: initialPath,
        wavCount: countWavsUnder(byParent, initialPath),
        multiBoard: true,
        otherFlavors: multiBoard.otherFlavors,
        nested: false,
      });
      return;
    }

    if (proffieRoots.length === 1) {
      // Single unambiguous font inside the Proffie wrapper.
      candidates.push({
        name: outerName,
        path: proffieRoots[0],
        wavCount: countWavsUnder(byParent, proffieRoots[0]),
        multiBoard: true,
        otherFlavors: multiBoard.otherFlavors,
        nested: false,
      });
      return;
    }

    // Multi-variant: the Proffie folder contains multiple complete fonts
    // (e.g. JayDalorian Excalibur's long ignition + short ignition,
    // Quantum's style 1/2/3). Emit one candidate per variant, each
    // keeping the multi-board flag and otherFlavors list since the same
    // variants exist across all board folders. isVariant tells the
    // importer to ALWAYS prepend the bundle/source name to the variant
    // name so library entries surface as "Excalibur_Long_Ignition" etc
    // instead of bare "Long_Ignition" with no parent context.
    for (const rootPath of proffieRoots) {
      const variantName = rootPath.split('/').pop();
      candidates.push({
        name: variantName,
        path: rootPath,
        wavCount: countWavsUnder(byParent, rootPath),
        multiBoard: true,
        otherFlavors: multiBoard.otherFlavors,
        nested: false,
        isVariant: true,
      });
    }
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

// Parse a candidate's path for a version-marker component (X_V1 /
// X_V2.4 / X v3 / X-v1.0). Walks the path from the candidate-name end
// toward the root, returning the first matching component.
//
// Two-tier detection lives in one walk:
//   - Common pattern: vendor names the candidate folder `Font_V1` /
//     `Font_V2`. Match lands at the deepest path component (the
//     candidate's own name) — same behavior as the original name-only
//     parser.
//   - Divergent pattern: vendor puts the version marker on a PARENT
//     dir (`Bundle/Bundle_V1/Beskar/Proffie`, `Bundle/Bundle_V2/...`).
//     The candidate's own name has no version. Walk continues up and
//     finds the marker on the parent. Stem is the parent's stem, and
//     parentPath captures everything above so siblings in unrelated
//     bundles with similar stems don't accidentally group.
//
// Returns { stem, version, versionParts, parentPath } on match, null
// when no path component has a version suffix. Caller groups by
// `parentPath + '|' + stem` so detection works across both patterns
// without falling out of sync.
function _parseVersionFromCandidate(candidate) {
  const candidatePath = (candidate && candidate.path) || '';
  const parts = String(candidatePath).split('/').filter(Boolean);
  // Trailing board-flavor subfolders (Proffie, CFX, Verso, etc.) are
  // never the version marker — they're how vendors organize a font
  // for different boards. Skip them so the walk lands on the actual
  // font/version folder above. The list mirrors the dead-stem set in
  // detectBundleName.
  const BOARD_FOLDERS = /^(proffie|cfx|verso|asteria|xenopixel|xeno|goldenharvest|ghv3|cfx-?ghv3)$/i;
  // Track the deepest non-board index so we know whether the version
  // marker, if found, was on the candidate's own folder (its "name")
  // vs on a parent. Caller uses this to decide whether to strip the
  // version from the display name on a single-winner group.
  let deepestNonBoardIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (BOARD_FOLDERS.test(parts[i])) continue;
    if (deepestNonBoardIndex === -1) deepestNonBoardIndex = i;
    const m = parts[i].match(/^(.+?)[\s_-]+[vV](\d+(?:\.\d+)*)$/);
    if (!m) continue;
    const versionParts = m[2].split('.').map(s => parseInt(s, 10));
    if (versionParts.some(n => Number.isNaN(n))) continue;
    return {
      stem: m[1],
      version: 'V' + m[2],
      versionParts,
      parentPath: parts.slice(0, i).join('/'),
      versionFoundInName: i === deepestNonBoardIndex,
    };
  }
  return null;
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

// Mark version-sibling groups (candidates whose raw names share a stem
// and differ only by a trailing version suffix). The highest-version
// member becomes the "preferred" pick — its name is stripped to the
// stem so the entry presents cleanly, and downstream auto-import paths
// (bulk, default-checked review rows) take only this one. The OTHER
// versions remain in the candidate list flagged `alternateVersion: true`
// so manual paths (single-source review modal, "Add more fonts from
// source" picker, source detail) can surface them as available-but-
// not-auto-imported. Single-version sibling groups are left untouched.
// Mixed groups (some with versions, some without) treat the versioned
// ones as their own group and leave the unversioned one alone.
//
// Older design (2026-06-23, commit e2d301a) collapsed the losers INTO
// the winner via a `skippedVersions[]` metadata field, hiding them from
// every consumer including the picker. Ryan's correction (2026-06-24):
// "they are still fonts. just because we don't add them to the library
// doesn't mean they aren't still available for the user." So we no
// longer collapse — we annotate.
function _markVersionPreferences(candidates) {
  const parsed = candidates.map(c => ({ c, v: _parseVersionFromCandidate(c) }));
  const groups = new Map();
  const ungrouped = [];
  for (const item of parsed) {
    if (!item.v) { ungrouped.push(item.c); continue; }
    // Group by parentPath + stem so siblings under the same conceptual
    // bundle group together, but items in unrelated bundles with
    // similar stems don't accidentally collide (e.g. PackA/Font_V1 and
    // PackB/Font_V1 stay separate).
    const k = `${item.v.parentPath || ''}|${item.v.stem.toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  const out = ungrouped.slice();
  for (const items of groups.values()) {
    if (items.length === 1) {
      // Solo versioned candidate — leave as is; downstream name
      // cleaner strips the trailing version (if any) from the display.
      out.push(items[0].c);
      continue;
    }
    items.sort((a, b) => _compareVersionParts(a.v.versionParts, b.v.versionParts));
    // Pick the winning VERSION (not winning item). When multiple items
    // share the highest version (e.g. Father_V2 has ANH + ESB + R1 +
    // ROTJ), ALL of them are winners — the user wants the whole V2
    // generation imported, not just one of its members. Items at any
    // lower version are alternates.
    const winningVersion = items[items.length - 1].v.version;
    const winners = items.filter(it => it.v.version === winningVersion);
    const losers = items.filter(it => it.v.version !== winningVersion);
    const siblingsMeta = losers.map(l => ({
      version: l.v.version,
      path: l.c.path,
      rawName: l.c.name,
    }));
    for (const w of winners) {
      const wOut = { ...w.c };
      // Strip the version from the display name only on a single-
      // winner group where the version was IN the candidate's own
      // folder name. Multi-winner groups (Father_V2/{ANH,ESB,R1,ROTJ})
      // would collide on the bare stem; path-found versions don't
      // touch the candidate's name to begin with (the candidate name
      // is something like "Beskar", not "Bundle_V2").
      if (winners.length === 1 && w.v.versionFoundInName) {
        wOut.name = w.v.stem;
      }
      wOut.takenVersion = w.v.version;
      wOut.preferredInVersionGroup = true;
      wOut.versionGroupSiblings = siblingsMeta;
      out.push(wOut);
    }
    // Each loser remains a candidate. We keep its raw name so the
    // entry-name collision check in the importer can pick a unique
    // name; downstream cleanup at user commit time can rename.
    // alternateVersion flips the default check state in the review
    // modal and tells bulk to skip.
    for (const l of losers) {
      const lOut = { ...l.c };
      lOut.alternateVersion = true;
      lOut.takenVersion = l.v.version;
      lOut.preferredSiblingVersion = winningVersion;
      out.push(lOut);
    }
  }
  return out;
}

// Descend into an inner zip and run the same candidate walker against
// its contents. Returns the sub-candidates found, with their paths
// rewritten to the composite form "<innerZipName>!<subPath>" so
// extraction knows which inner zip to open and which slice to pull.
//
// If the inner zip's contents don't pass looksLikeProffieFont at any
// level, this returns an empty array — the user never sees a non-font
// surfaced as a font. That's the invariant that makes nested-zip
// imports honest: each inner zip is its own source, gated by the same
// detection rules as everything else.
async function _walkInnerZipCandidates(source, innerZipName, fallbackName) {
  const bytes = await source.readFile(innerZipName);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-sf-detect-'));
  const tmpZip = path.join(tmpDir, 'inner.zip');
  try {
    fs.writeFileSync(tmpZip, bytes);
    const zip = new StreamZip.async({ file: tmpZip, skipEntryNameValidation: true });
    try {
      const entryMap = await zip.entries();
      // Reshape the inner zip entries into the form groupByParent
      // expects (fileName, isDir, size). groupByParent already filters
      // noise segments (__MACOSX, .DS_Store, ._*) during grouping, so
      // we don't need to pre-filter here.
      const entries = [];
      for (const k of Object.keys(entryMap)) {
        const e = entryMap[k];
        if (!e.name || e.name === '/') continue;
        entries.push({ fileName: e.name, isDir: !!e.isDirectory, size: e.size || 0 });
      }
      const byParent = groupByParent(entries);
      const subCandidates = [];
      walkForCandidates(byParent, '', subCandidates, fallbackName);
      // Rewrite each sub-candidate's path to the composite form. They
      // remain nested:true so the extractor knows to open the inner
      // zip rather than read directly from the source.
      for (const sc of subCandidates) {
        sc.path = innerZipName + INNER_ZIP_SEP + sc.path;
        sc.nested = true;
      }
      return subCandidates;
    } finally {
      await zip.close();
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
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
  // Nested-zip descent. Any candidate the top-level walker emitted with
  // nested:true is a placeholder for an inner zip whose contents we
  // haven't actually examined. Open each one and rerun the full walker
  // against its contents. The result REPLACES the placeholder: an
  // inner zip might produce 0, 1, or many real candidates. Zero means
  // the inner zip isn't a Proffie font — the placeholder gets dropped
  // silently and the user never sees a phantom entry. This is the
  // invariant Ryan called out: never serve something as a font unless
  // it looks like one at the level we're pointing at.
  const expanded = [];
  const canReadInnerZips = typeof source.readFile === 'function';
  for (const c of rawCandidates) {
    if (!c.nested) { expanded.push(c); continue; }
    // If the source doesn't expose readFile (test mocks synthesize
    // sources from listAll only), the descent can't run — keep the
    // placeholder candidate so test fixtures don't regress. Real
    // import flows always have readFile.
    if (!canReadInnerZips) { expanded.push(c); continue; }
    try {
      // The inner zip's own basename (minus .zip) is the natural fallback
      // name if its internal walker can't pick a better one.
      const fallback = String(c.name || c.path || 'font').replace(/\.zip$/i, '');
      const inner = await _walkInnerZipCandidates(source, c.path, fallback);
      for (const sc of inner) expanded.push(sc);
    } catch (err) {
      // Couldn't open / walk this inner zip — drop the placeholder
      // rather than emit a known-broken entry. Log so the failure is
      // visible at the import level.
      console.warn(`[candidates] inner-zip descent failed for ${c.path}: ${err && err.message || err}`);
    }
  }
  rawCandidates.length = 0;
  for (const c of expanded) rawCandidates.push(c);
  // Multi-version sibling marking runs BEFORE name cleaning so the
  // sibling-detection regex sees the original `X_V1` / `X_V2` shape
  // (cleaning would strip the version and merge them via name
  // collision instead, which loses the version info).
  const candidates = _markVersionPreferences(rawCandidates);
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
  // Effect-detection primitives — used by the persistent effects field
  // on entry meta (computed at import + recomputed when entry contents
  // mutate). soundFontEntries.computeEntryEffects walks the extracted
  // entry dir using these.
  EFFECT_NAMES,
  EFFECT_DIR_EXCLUSIONS,
  effectStemFromFile,
  looksLikeEffectDir,
};
