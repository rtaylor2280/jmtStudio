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

  // A customizable subfolder anywhere in the path wins first — a wav under
  // quote/ or tracks/ is customizable no matter what it's named.
  for (const d of dirs) if (CUSTOMIZABLE_DIRS.has(d)) return 'customizable';
  // Wrapper / junk dirs → out of scope for both signals.
  for (const d of dirs) if (IGNORE_DIRS.has(d)) return 'ignore';

  // Only audio contributes to the signals. Config (.ini), docs (.txt/.md/.rtf),
  // and images are hashed by the manifest but not scored here.
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
  for (const r of records || []) {
    if (!r || r.fileHash === '<empty>') continue;
    const cls = classifyRelPath(r.relPath);
    if (cls === 'core') core.add(r.fileHash);
    else if (cls === 'customizable') customizable.add(r.fileHash);
  }
  return {
    core,
    customizable,
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
      else customizable.add(h);
    }
  };
  walk(fontDir, '');

  return {
    core,
    customizable,
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

  return {
    coreContainment,
    coreJaccard,
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
  variantContainment: 0.50,
  // A font whose character set is smaller than this can't be classified
  // confidently (mostly quotes/tracks, or a fragment) — flag low-confidence.
  minCoreForConfidence: 3,
};

// verdict: 'have_it' | 'variant' | 'new', plus lowConfidence when the card
// font has too few character sounds to trust the score.
function classifyVerdict(cmp, thresholds = DEFAULT_THRESHOLDS) {
  const lowConfidence = cmp.cardCoreCount < thresholds.minCoreForConfidence;
  let verdict;
  if (cmp.coreContainment >= thresholds.haveItContainment &&
      cmp.coreJaccard >= thresholds.haveItJaccard) {
    verdict = 'have_it';
  } else if (cmp.coreContainment >= thresholds.variantContainment) {
    verdict = 'variant';
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
        };
      }
    }
  }

  let best = null;
  let bestCmp = null;
  for (const lib of library) {
    if (!lib.sets || lib.sets.core.size === 0) continue;
    const cmp = compareSets(cardSets, lib.sets);
    if (!bestCmp ||
        cmp.coreContainment > bestCmp.coreContainment ||
        (cmp.coreContainment === bestCmp.coreContainment && cmp.coreJaccard > bestCmp.coreJaccard)) {
      best = lib;
      bestCmp = cmp;
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
  return { bestMatch: best.name, exact: false, ...bestCmp, verdict, lowConfidence };
}

module.exports = {
  classifyRelPath,
  setsFromRecords,
  setsFromDir,
  buildFontSetsFromDir,
  signatureOf,
  compareSets,
  classifyVerdict,
  matchAgainstLibrary,
  CUSTOMIZABLE_DIRS,
  IGNORE_DIRS,
  DEFAULT_THRESHOLDS,
};
