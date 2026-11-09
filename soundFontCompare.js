// Sound Fonts — content-based font comparison.
//
// Given two fonts (the user's library entries and the fonts in some external
// folder / SD card), decide how likely they are the SAME font, so the compare
// tool can flag which external fonts are worth importing (novel) vs already
// owned (duplicate).
//
// The match is a set-overlap over per-file CONTENT hashes (sha256 of the wav
// bytes), so it's blind to filenames, folder reorg, and duplicate copies of a
// sound within a font. Two ideas drive the model:
//
//   1. CONFIDENCE runs on the CHARACTER sounds only. A font's identity is its
//      hum / swing / clash / blast / boot / lock / etc. The confidence score
//      (containment) is computed over that "core" set alone.
//
//   2. force / quote / tracks are HASHED and REPORTED but never scored. They're
//      the interchangeable, frequently-personalized parts (a user swaps in
//      their own quotes, edits force pushes, changes menu music) — folding them
//      into the confidence number would make identical fonts look different.
//      We surface their overlap as a SEPARATE signal ("core 100%, but the
//      quotes differ") without letting it move the confidence.
//
// So the primary number is: of this external font's character sounds, what
// fraction do I already have in my closest library font — a confidence that
// they are the same font.
//
// v1 is bit-exact: it catches identical and reorganized copies, not re-encoded
// or trimmed audio. Audio fingerprinting is a separate, much larger project.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { collectFileRecords, hashFile } = require('./soundFontFileHash');
const { EFFECT_DIR_EXCLUSIONS } = require('./soundFontCandidates');

// The interchangeable / personalized buckets. Hashed and reported, never
// scored into the confidence number. Matched on both a path segment (force/,
// quote/, tracks/ subfolders) and a flat-file stem (force1.wav, quote3.wav).
const CUSTOMIZABLE_DIRS = new Set(['force', 'quote', 'quotes', 'track', 'tracks']);

// Font files that are not sounds: settings (.ini) and OLED display files (.bmp, .scr). [B-643]
const EXTRA_EXTS = ['.ini', '.bmp', '.scr'];
const { isOsNoiseName } = require('./osNoise');

// Non-effect wrapper / junk dirs that shouldn't count toward EITHER signal
// (board-format folders, SD common/, mac zip noise, vendor bonus dirs). Derived
// from the shared exclusion vocabulary minus the customizable buckets, which we
// handle above rather than ignore.
const IGNORE_DIRS = new Set(
  [...EFFECT_DIR_EXCLUSIONS].filter(d => !CUSTOMIZABLE_DIRS.has(d))
);

// Leading alpha stem of a flat file name (force1.wav -> "force", hum01 -> "hum").
function _stemOf(name) {
  const m = String(name).toLowerCase().match(/^([a-z]+)/);
  return m ? m[1] : '';
}

// Classify one relative path into the signal bucket it contributes to:
//   'core'         character sound → drives the confidence score
//   'customizable' force / quote / tracks → reported, not scored
//   'ignore'       non-audio (config, docs, images) or wrapper/junk dirs
function classifyRelPath(relPath) {
  const segs = String(relPath).toLowerCase().split('/').filter(Boolean);
  if (segs.length === 0) return 'ignore';
  const dirs = segs.slice(0, -1);
  const base = segs[segs.length - 1];

  // Operating-system clutter is never font content, wherever it sits (a desktop.ini inside quote/
  // is not a quote). The same list the card browser and import use.
  if (segs.some((s) => isOsNoiseName(s))) return 'ignore';

  // A customizable subfolder anywhere in the path wins first for AUDIO: a wav under quote/ or
  // tracks/ is customizable no matter what it's named.
  if (base.endsWith('.wav')) {
    for (const d of dirs) if (CUSTOMIZABLE_DIRS.has(d)) return 'customizable';
  }
  // Wrapper / junk dirs → out of scope for every signal.
  for (const d of dirs) if (IGNORE_DIRS.has(d)) return 'ignore';

  // Settings and display files are part of a font as much as its sounds: config.ini and
  // smoothsw.ini tune it, .bmp and .scr drive an OLED. They never decide identity (that is the
  // character sounds), but a copy carrying one the library lacks has something new. [B-643]
  if (EXTRA_EXTS.some((x) => base.endsWith(x))) return 'extra';

  // Docs (.txt/.md/.rtf) and anything else are hashed by the manifest but not scored here.
  if (!base.endsWith('.wav')) return 'ignore';

  // Flat-layout customizable file (force2.wav, quote01.wav) with no subfolder.
  if (CUSTOMIZABLE_DIRS.has(_stemOf(base))) return 'customizable';

  // Any remaining wav is character content (known effect or unrecognized —
  // unknown character sounds still define the font, so they count as core).
  return 'core';
}

// Build the comparable hash sets for one font from its per-file record list
// (as returned by collectFileRecords). Returns:
//   { core, customizable, coreSignature, coreCount, customizableCount }
// where core/customizable are Sets of content hashes (dedup within a font is
// intentional — a sound present twice is still just "present"), and
// coreSignature is a single rolled hash of the sorted core set for O(1)
// exact-duplicate detection.
function setsFromRecords(records) {
  const core = new Set();
  const customizable = new Set();
  const extra = new Set();
  for (const r of records || []) {
    if (!r || r.fileHash === '<empty>') continue;
    const cls = classifyRelPath(r.relPath);
    if (cls === 'core') core.add(r.fileHash);
    else if (cls === 'customizable') customizable.add(r.fileHash);
    else if (cls === 'extra') extra.add(r.fileHash);
  }
  return {
    core,
    customizable,
    extra,
    coreCount: core.size,
    customizableCount: customizable.size,
    coreSignature: signatureOf(core),
  };
}

// Convenience: build sets straight from a font directory on disk, reusing the
// canonical whole-file record walk (hashes EVERY file). Simple but reads every
// byte — fine for a single small font, wasteful across a big library.
function setsFromDir(fontDir) {
  const records = collectFileRecords(fontDir);
  if (records === null) return null;
  return setsFromRecords(records);
}

// Performant builder: classify each path FIRST, then hash only what feeds a
// signal. Skips 'ignore' files entirely (no read), and skips any single file
// larger than maxFileBytes — that's the giant tracks/ music, which is both the
// slowest to hash and the least useful for "is this the same font." Core and
// force/quote wavs are always small, so the cap never touches the confidence
// signal. This is the shape the background library-manifest builder wants:
// hashing a 38 GB library without dragging every track through sha256.
//   opts.maxFileBytes       skip-hash files larger than this (default 20 MiB)
//   opts.includeCustomizable hash force/quote/tracks too (default true)
// Returns the same shape as setsFromRecords, plus counts of what was skipped.
function buildFontSetsFromDir(fontDir, opts = {}) {
  const maxFileBytes = opts.maxFileBytes != null ? opts.maxFileBytes : 20 * 1024 * 1024;
  const includeCustomizable = opts.includeCustomizable !== false;
  if (!fontDir || !fs.existsSync(fontDir)) return null;

  const core = new Set();
  const customizable = new Set();
  const extra = new Set();
  let skippedLarge = 0;
  let hashedFiles = 0;

  const walk = (absDir, relDir) => {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, rel); continue; }
      if (!e.isFile()) continue;
      if (relDir === '' && e.name === 'meta.json') continue; // app artifact
      const cls = classifyRelPath(rel);
      if (cls === 'ignore') continue;
      if (cls === 'customizable' && !includeCustomizable) continue;
      let size = 0;
      try { size = fs.statSync(abs).size; } catch {}
      if (size > maxFileBytes) { skippedLarge++; continue; }
      let h;
      try { h = hashFile(abs); } catch { continue; }
      hashedFiles++;
      if (cls === 'core') core.add(h);
      else if (cls === 'extra') extra.add(h);   // [B-643]
      else customizable.add(h);
    }
  };
  walk(fontDir, '');

  return {
    core,
    customizable,
    extra,
    coreCount: core.size,
    customizableCount: customizable.size,
    coreSignature: signatureOf(core),
    skippedLarge,
    hashedFiles,
  };
}

// Rolled signature of a hash set: sha256 of the sorted members. Two fonts with
// an identical core set share a signature, so exact-duplicate detection is a
// map lookup instead of an intersection. Empty set → null (no signature).
function signatureOf(hashSet) {
  if (!hashSet || hashSet.size === 0) return null;
  const h = crypto.createHash('sha256');
  for (const x of [...hashSet].sort()) { h.update(x); h.update('\n'); }
  return h.digest('hex');
}

function _intersectionSize(a, b) {
  // Iterate the smaller set for speed.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const x of small) if (large.has(x)) n++;
  return n;
}

// Compare an external ("card") font's sets against a library font's sets.
// Confidence is CONTAINMENT of the card's core in the library's core: of the
// character sounds on the card, what fraction do we already own. Jaccard is
// reported alongside to distinguish "exact same" (high both) from "we own a
// superset/subset" (high containment, lower Jaccard). Customizable overlap is a
// separate, non-scoring signal.
function compareSets(card, lib) {
  const coreInter = _intersectionSize(card.core, lib.core);
  const coreUnion = card.core.size + lib.core.size - coreInter;
  const coreContainment = card.core.size ? coreInter / card.core.size : 0;
  const coreJaccard = coreUnion ? coreInter / coreUnion : 0;

  const custInter = _intersectionSize(card.customizable, lib.customizable);
  const custContainment = card.customizable.size
    ? custInter / card.customizable.size
    : null; // null = card has no customizable sounds to compare

  // How much of the LIBRARY font is in this copy: the catalogue's measure (fontCatalogue.js), so
  // sounds the copy ADDS never count against it. [B-643]
  const libCoverage = lib.core.size ? coreInter / lib.core.size : 0;

  return {
    coreContainment,
    coreJaccard,
    libCoverage,
    coreInter,
    cardCoreCount: card.core.size,
    libCoreCount: lib.core.size,
    custContainment,
    custInter,
    cardCustCount: card.customizable.size,
    libCustCount: lib.customizable.size,
  };
}

// Default classification thresholds. Deliberately conservative and tunable —
// calibrate against real corpora (an SD backup vs the library) before trusting
// them. coreContainment is the confidence; coreJaccard guards against a tiny
// card font being "contained" in a large library font by coincidence.
const DEFAULT_THRESHOLDS = {
  haveItContainment: 0.98,
  haveItJaccard: 0.90,
  // At least this much of the library font in the copy = the same font, a version of it. The
  // catalogue's line, measured on a 210-font library: different sources never above 53%, nothing
  // from 54 to 69% but versions of one font, everything 70 to 99% versions of one font. [B-643]
  versionCoverage: 0.70,
  // A font whose character set is smaller than this can't be classified
  // confidently (mostly quotes/tracks, or a fragment) — flag low-confidence.
  minCoreForConfidence: 3,
};

// verdict: 'have_it' | 'variant' | 'new', plus lowConfidence when the card
// font has too few character sounds to trust the score.
function classifyVerdict(cmp, thresholds = DEFAULT_THRESHOLDS) {
  const lowConfidence = cmp.cardCoreCount < thresholds.minCoreForConfidence;
  // A PURE SUPERSET IS OWNERSHIP, NOT A COINCIDENCE. [B-025]
  // The Jaccard guard exists to stop a TINY card font being "contained" in a big
  // library font by accident. But when containment is exactly 1, Jaccard is just
  // the size ratio between the two fonts — so an ordinary vendor revision (the
  // library copy has a few extra sounds) got penalised as if it were a
  // coincidence, and the row rendered amber and stayed CHECKED while its own note
  // said every sound in it was already owned. Importing it gains nothing.
  // The tiny-font case this guard was written for is already covered by
  // lowConfidence, which is why that is the condition here and not a lower bar:
  // moving the Jaccard bar tunes a number, this states the rule.
  const pureSuperset = cmp.coreContainment >= 1 && !lowConfidence;
  // THE SAME FONT, TWO WAYS IN. [B-643]
  //   have_it  this copy is (almost) entirely inside the library font: nearly identical, or a copy
  //            that LOST files (trimmed to fit a card, or damaged). The Jaccard guard above keeps a
  //            small set of shared stock sounds from passing.
  //   version  most of the library font is in this copy: a version that ADDS sounds.
  // There is no close-match tier: 50-97% containment paired stock-sound fonts with the wrong
  // font (a card's Yoda with Depa_Bilaba), and a wrong pairing points a config at that font.
  let verdict;
  if (cmp.coreContainment >= thresholds.haveItContainment &&
      (pureSuperset || cmp.coreJaccard >= thresholds.haveItJaccard)) {
    verdict = 'have_it';
  } else if (!lowConfidence && cmp.libCoreCount >= thresholds.minCoreForConfidence
      && cmp.libCoverage >= thresholds.versionCoverage) {
    verdict = 'version';
  } else {
    verdict = 'new';
  }
  return { verdict, lowConfidence };
}

// Match one card font against a whole library. `library` is an array of
// { name, sets } (sets from setsFromRecords/setsFromDir). Returns the best
// match (highest coreContainment, Jaccard as tie-break) with its verdict, plus
// an exact flag when a core-signature collision proved bit-identical character
// sounds. Library entries with an empty core set are skipped as non-matchable.
function matchAgainstLibrary(cardSets, library, thresholds = DEFAULT_THRESHOLDS) {
  // Exact fast path: identical core signature = same character sounds.
  if (cardSets.coreSignature) {
    for (const lib of library) {
      if (lib.sets.coreSignature && lib.sets.coreSignature === cardSets.coreSignature) {
        const cmp = compareSets(cardSets, lib.sets);
        return {
          bestMatch: lib.name,
          exact: true,
          ...cmp,
          verdict: 'have_it',
          lowConfidence: cardSets.core.size < thresholds.minCoreForConfidence,
          missing: _missingHashes(cardSets, lib.sets),
          bestSourceUuid: lib.sourceUuid || null,
        };
      }
    }
  }

  // Best = a font that IS the same font (have_it, then version) before one that merely shares
  // more; within a rank, the most shared (containment plus coverage), Jaccard as the tie-break.
  const RANK = { have_it: 2, version: 1, new: 0 };
  let best = null;
  let bestCmp = null;
  let bestRank = -1, bestScore = -1;
  for (const lib of library) {
    if (!lib.sets || lib.sets.core.size === 0) continue;
    const cmp = compareSets(cardSets, lib.sets);
    const rank = RANK[classifyVerdict(cmp, thresholds).verdict];
    const score = cmp.coreContainment + cmp.libCoverage;
    if (!bestCmp || rank > bestRank || (rank === bestRank && (score > bestScore
        || (score === bestScore && cmp.coreJaccard > bestCmp.coreJaccard)))) {
      best = lib; bestCmp = cmp; bestRank = rank; bestScore = score;
    }
  }

  if (!best) {
    return {
      bestMatch: null, exact: false,
      coreContainment: 0, coreJaccard: 0, coreInter: 0,
      cardCoreCount: cardSets.core.size, libCoreCount: 0,
      custContainment: null, custInter: 0,
      cardCustCount: cardSets.customizable.size, libCustCount: 0,
      verdict: 'new',
      lowConfidence: cardSets.core.size < thresholds.minCoreForConfidence,
    };
  }

  const { verdict, lowConfidence } = classifyVerdict(bestCmp, thresholds);
  return { bestMatch: best.name, exact: false, ...bestCmp, verdict, lowConfidence,
    missing: _missingHashes(cardSets, best.sets), bestSourceUuid: best.sourceUuid || null };
}

// The card's files the matched font does not have, by content: the hashes behind "this copy has
// N files yours is missing", so a caller can ask whether each is anywhere else in the library.
// [B-643]
function _missingHashes(cardSets, libSets) {
  const out = { core: [], customizable: [], extra: [] };
  for (const b of ['core', 'customizable', 'extra']) {
    const lib = (libSets && libSets[b]) || new Set();
    for (const h of ((cardSets && cardSets[b]) || [])) if (!lib.has(h)) out[b].push(h);
  }
  return out;
}

// Splits a match's missing files into those the library already holds and those that are new,
// and says WHERE the held ones are when one place holds them all: the matched font's own source
// (`own`), another source by its library name (`sourceName`), or neither (spread across sources,
// shared tracks, commons, the pool). `owned` is libraryHashes' map, hash -> Set of 'src:<uuid>' /
// 'lib'; `sourceName(uuid)` names a source. Stamps m.missingSplit in place. A match whose missing
// files are all held is owned: skipping it loses nothing. [B-643]
function applyLibrarySplit(m, owned, { sourceName = null } = {}) {
  if (!m || !m.bestMatch || !m.missing || !owned) return m;
  let elsewhere = 0, fresh = 0;
  let common = null;   // source uuids holding EVERY held file
  for (const b of ['core', 'customizable', 'extra']) {
    for (const h of (m.missing[b] || [])) {
      if (!owned.has(h)) { fresh++; continue; }
      elsewhere++;
      const locs = owned.get(h);
      const srcs = new Set();
      if (locs && typeof locs.forEach === 'function') locs.forEach((k) => { if (String(k).startsWith('src:')) srcs.add(String(k).slice(4)); });
      common = common === null ? srcs : new Set([...common].filter((u) => srcs.has(u)));
    }
  }
  let own = false, place = null;
  if (elsewhere && common && common.size) {
    if (m.bestSourceUuid && common.has(m.bestSourceUuid)) own = true;
    else if (typeof sourceName === 'function') {
      for (const u of common) { const n = sourceName(u); if (n) { place = n; break; } }
    }
  }
  m.missingSplit = { elsewhere, fresh, own, sourceName: place };
  return m;
}

// "in its source files" / "in the X source files" / "in your library": where the held files are.
function _whereHeld(s) {
  if (s.own) return 'in its source files';
  if (s.sourceName) return `in the ${s.sourceName} source files`;
  return 'in your library';
}

// Owned by the split: it has files the matched font lacks, and every one is elsewhere in the
// library. [B-643]
function _ownedElsewhere(m) {
  return !!(m && m.bestMatch && !m.lowConfidence && _sameFont(m) && m.missingSplit
    && m.missingSplit.fresh === 0 && m.missingSplit.elsewhere > 0);
}

// ── Library-wide duplicate recognition (slice A, 2026-07-23) ────────────────
// The one primitive all three import surfaces call: given ONE candidate font's
// files (a slice of a source manifest), find its best match among library
// entries. Single-folder imports, bundle review rows, and SD import are just
// different call sites of matchCandidateAgainstLibrary.

// Board-format wrapper dirs — the subset of the exclusion vocabulary that is
// pure PACKAGING (a variant container), never content classification. These
// are stripped during candidate re-rooting; tracks/quotes/extras are NOT here
// because classifyRelPath scores those as content signals.
const BOARD_WRAPPER_DIRS = new Set([
  'proffie', 'proffieboard', 'asteria', 'cfx', 'cfx-ghv3', 'cfxghv3',
  'ghv3', 'verso', 'xeno3', 'xenopixel', 'xeno', 'goldenharvest',
]);

// Build the "what do I own" index: one { name, sets } per library entry, read
// from the persisted per-file manifests (.filehashes/entries/<entryUuid>.json).
// ~200 small JSONs — cheap enough to build per import session. Entries without
// a manifest (or with an empty core set) can't match and are counted, not
// guessed at.
function buildLibraryIndex(userData) {
  const { readFileHashManifest } = require('./soundFontFileHash');
  const libRoot = path.join(userData, 'soundFonts', 'library');
  const index = [];
  let unmatchable = 0;
  let dirents = [];
  try { dirents = fs.readdirSync(libRoot, { withFileTypes: true }); } catch {}
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(libRoot, d.name, 'meta.json'), 'utf8')); } catch {}
    const entryUuid = meta && meta.entryUuid;
    const mf = entryUuid
      ? readFileHashManifest(path.join(userData, 'soundFonts', '.filehashes', 'entries', `${entryUuid}.json`))
      : null;
    if (!mf || !Array.isArray(mf.records)) { unmatchable++; continue; }
    const sets = setsFromRecords(mf.records);
    if (sets.core.size === 0) { unmatchable++; continue; }
    index.push({ name: d.name, sets, sourceUuid: (meta && meta.sourceUuid) || null });
  }
  return { index, unmatchable };
}

// Slice a SOURCE manifest down to one candidate's files, re-rooted the way
// entry extraction re-roots them, GROUPED per wrapper variant. A multi-board
// candidate must match on its best single variant — a library entry is one
// variant, so unioning Proffie+CFX+Xeno hashes would dilute containment and
// misread an owned font as merely a variant.
//   records:       full source manifest records (composite paths supported)
//   candidatePath: the candidate's root within the source ('' = whole source);
//                  accepts the detector's inner-zip form ("X.zip!subtree")
// Returns [{ wrapper, records }] with font-root-relative relPaths.
function segmentCandidateRecords(records, candidatePath) {
  const prefix = String(candidatePath || '')
    .replace(/\\/g, '/')
    .replace(/\.zip!/gi, '.zip/')   // detector's inner-zip separator → manifest form
    .replace(/\/+$/, '');
  const groups = new Map();
  for (const r of records || []) {
    if (!r || r.fileHash === '<empty>') continue;
    let rel = String(r.relPath).replace(/\\/g, '/');
    if (prefix) {
      if (!(rel === prefix || rel.startsWith(prefix + '/'))) continue;
      rel = rel === prefix ? '' : rel.slice(prefix.length + 1);
      if (!rel) continue;
    }
    // Consume leading PACKAGING layers only: inner-zip segments and known
    // board-format dirs. A font-name dir is left alone — classifyRelPath
    // only reacts to known effect/customizable/wrapper names, so unknown
    // leading dirs are harmless.
    let wrapper = '';
    for (let guard = 0; guard < 4; guard++) {
      const slash = rel.indexOf('/');
      if (slash < 0) break;
      const seg = rel.slice(0, slash);
      if (/\.zip$/i.test(seg) || BOARD_WRAPPER_DIRS.has(seg.toLowerCase())) {
        wrapper = wrapper ? `${wrapper}/${seg}` : seg;
        rel = rel.slice(slash + 1);
        continue;
      }
      break;
    }
    if (!groups.has(wrapper)) groups.set(wrapper, []);
    groups.get(wrapper).push({ relPath: rel, fileHash: r.fileHash, size: r.size });
  }
  return [...groups.entries()].map(([wrapper, recs]) => ({ wrapper, records: recs }));
}

// Match one candidate against the library: segment per variant, match each,
// return the strongest result (highest containment, Jaccard tie-break).
// Returns matchAgainstLibrary's shape plus { wrapper } for the winning variant,
// or null when the candidate has no scorable character sounds at all.
function matchCandidateAgainstLibrary(records, candidatePath, index, thresholds = DEFAULT_THRESHOLDS) {
  let best = null;
  for (const g of segmentCandidateRecords(records, candidatePath)) {
    const sets = setsFromRecords(g.records);
    if (sets.core.size === 0) continue;
    const m = matchAgainstLibrary(sets, index, thresholds);
    if (!best ||
        m.coreContainment > best.coreContainment ||
        (m.coreContainment === best.coreContainment && m.coreJaccard > best.coreJaccard)) {
      best = { ...m, wrapper: g.wrapper };
    }
  }
  return best;
}

// DIRECTION matters (2026-07-23): "already in your library" may only be
// claimed when the library contains EVERYTHING the candidate has — character
// sounds AND the customizable content (quotes/tracks/force). Identity runs on
// core only (that's what makes recognition robust to personalization), but the
// ownership claim must count it all: a core-identical copy carrying tracks or
// quotes the library lacks is NOT fully owned — skipping it would lose them.
// (m.exact only proves the CORE matched, so it can't shortcut this check.)
// The same font by either way in. [B-643]
function _sameFont(m) {
  return !!m && (m.verdict === 'have_it' || m.verdict === 'version');
}

function isFullyOwned(m) {
  if (!m) return false;
  if (_ownedElsewhere(m)) return true;   // [B-643]
  if (m.verdict !== 'have_it') return false;
  // A settings or display file the font lacks is something new on the card. [B-643]
  if (m.missing && m.missing.extra && m.missing.extra.length && !m.missingSplit) return false;
  const coreMissing = Math.max(0, (m.cardCoreCount || 0) - (m.coreInter || 0));
  const custMissing = Math.max(0, (m.cardCustCount || 0) - (m.custInter || 0));
  return coreMissing === 0 && custMissing === 0;
}

// Compose the "what yours is missing" phrase across BOTH buckets: character
// sounds and the customizable content (quotes/tracks/force). Plain words only.
function _missingPhrase(m) {
  const core = Math.max(0, (m.cardCoreCount || 0) - (m.coreInter || 0));
  const cust = Math.max(0, (m.cardCustCount || 0) - (m.custInter || 0));
  const parts = [];
  if (core) parts.push(`${core} sound${core === 1 ? '' : 's'}`);
  if (cust) parts.push(`${cust} quote or track file${cust === 1 ? '' : 's'}`);
  const extra = (m && m.missing && m.missing.extra) ? m.missing.extra.length : 0;   // [B-643]
  if (extra) parts.push(`${extra} settings or display file${extra === 1 ? '' : 's'}`);
  if (parts.length > 2) return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return parts.join(' and ');
}

// Plain-language verdict line for the review UI. No engineering terms — a
// verdict plus a sound-count sentence (per the standing no-jargon rule).
// Returns null when there's nothing worth saying (new font / no match).
function verdictLabel(m) {
  if (!m || !m.bestMatch || m.lowConfidence) return null;
  // [B-643] THE SPLIT, WHEN THE CALLER HAD THE LIBRARY TO ASK: what this copy has that the
  // matched font lacks is either elsewhere in the library or new, and the note says both.
  // This version = the copy being imported; yours = the matched library font. [B-643]
  if (_ownedElsewhere(m)) {
    return `Already in your library as ${m.bestMatch}. This version has ${_missingPhrase(m)} yours doesn't, but all are ${_whereHeld(m.missingSplit)}`;
  }
  if (!_sameFont(m)) return null;   // a new font gets no note [B-643]
  if (m.missingSplit && (m.missingSplit.elsewhere + m.missingSplit.fresh) > 0) {
    const s = m.missingSplit;
    const lead = `${m.verdict === 'have_it' ? `Nearly identical to ${m.bestMatch}` : `A version of ${m.bestMatch}`}. This version has ${_missingPhrase(m)} yours doesn't`;
    if (!s.elsewhere) return `${lead}, and none are in your library`;
    return (s.own || s.sourceName)
      ? `${lead}. ${s.elsewhere} ${s.elsewhere === 1 ? 'is' : 'are'} ${_whereHeld(s)} but ${s.fresh} ${s.fresh === 1 ? 'is' : 'are'} not in your library`
      : `${lead}. ${s.elsewhere} ${s.elsewhere === 1 ? 'is' : 'are'} in your library but ${s.fresh} ${s.fresh === 1 ? 'is' : 'are'} not`;
  }
  if (m.verdict === 'have_it') {
    if (isFullyOwned(m)) {
      // Short on purpose: the row shows the verdict, the checkbox tooltip
      // carries the detail (who it matches, what checking does). Callers
      // append "(as X)" only when the row's name differs from the match.
      return 'Already in your library';
    }
    return `Nearly identical to ${m.bestMatch}, but this copy has ${_missingPhrase(m)} yours is missing`;
  }
  if (m.verdict === 'variant') {
    // Superset case: everything this font has, an owned font already contains
    // (containment ~1 but Jaccard below the have-it bar = we own a superset).
    if (m.coreContainment >= 0.98) {
      return `All of its sounds are already in ${m.bestMatch} (which has more)`;
    }
    // The verdict stays conservative ("possibly a different version"), but the
    // note carries the concrete delta so the user sees what importing gains.
    // Containment below 0.98 guarantees a non-empty core delta; the bare
    // shares-% line remains only as a defensive fallback.
    const gain = _missingPhrase(m);
    if (gain) {
      return `Close match to ${m.bestMatch}: this copy has ${gain} yours doesn't (possibly a different version)`;
    }
    return `Close match to ${m.bestMatch}: shares ${Math.round(m.coreContainment * 100)}% of its sounds (possibly a different version)`;
  }
  return null;
}

// Checkbox tooltip — the teaching layer (2026-07-23): explains what
// checking the box actually does GIVEN this match. Null when the label is null.
function verdictTip(m) {
  if (!m || !m.bestMatch || m.lowConfidence) return null;
  if (_ownedElsewhere(m)) {
    return `Every file in this font is already in your library. Check the box to import a second copy anyway.`;
  }
  if (m.verdict === 'have_it') {
    if (isFullyOwned(m)) {
      return `Your library already has everything in this font (as ${m.bestMatch}). Check the box to import a second copy anyway. To customize ${m.bestMatch}, duplicating it in your library is the better path.`;
    }
    return `Importing keeps the ${_missingPhrase(m)} your ${m.bestMatch} copy doesn't have. Uncheck only if you don't want them.`;
  }
  if (m.verdict === 'variant') {
    const gain = _missingPhrase(m);
    const base = `Probably a different version of ${m.bestMatch}. Import it if you want both versions in your library.`;
    return gain ? `${base} Importing keeps the ${gain} your copy doesn't have.` : base;
  }
  return null;
}

// Display bar for the variant note on review screens: below this containment
// the engine still reports, but the UI stays silent — real-world calibration
// (2026-07-23 self-test on a 210-entry library) showed 50-70% catches
// same-maker DIFFERENT fonts (Father_ESB vs Father_ROTJ at 55%), where a
// "possibly a different version" note would be wrong. 80%+ is where true
// variants (color/ignition/style splits, bundle re-releases) actually live.
const VARIANT_DISPLAY_MIN = 0.75;

module.exports = {
  applyLibrarySplit,
  classifyRelPath,
  setsFromRecords,
  setsFromDir,
  buildFontSetsFromDir,
  signatureOf,
  compareSets,
  classifyVerdict,
  matchAgainstLibrary,
  buildLibraryIndex,
  segmentCandidateRecords,
  matchCandidateAgainstLibrary,
  verdictLabel,
  verdictTip,
  isFullyOwned,
  missingPhrase: _missingPhrase,
  VARIANT_DISPLAY_MIN,
  BOARD_WRAPPER_DIRS,
  CUSTOMIZABLE_DIRS,
  IGNORE_DIRS,
  DEFAULT_THRESHOLDS,
};
