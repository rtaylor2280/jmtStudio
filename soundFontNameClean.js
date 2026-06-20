// Sound Fonts — default name cleaner.
//
// Derives a tidy library-entry name from a raw inner-folder name or zip
// stem. Runs server-side once per candidate in detectCandidates, so the
// rename field in the import review modal already shows the clean form.
// Idempotent: cleanSuggestedName(cleanSuggestedName(x)) === cleanSuggestedName(x).
//
// Pipeline order:
//   1. Leading vendor-version prefix     (1.1-, 2.0-, 1.2 )
//   2. Known maker prefix                (KSith_, JUANSITH'S , RENvious_)
//   3. Accent transliteration            (acute, grave, diaeresis, etc.)
//   4. Punctuation strip                 (apostrophes drop entirely)
//   5. Trailing tail loop                (version stamp + platform tokens)
//   6. Non-ASCII drop                    (CJK, leftover Unicode)
//   7. Separator collapse                (multi _ / - / whitespace -> one)
//   8. Title Case                        (lowercase-only segments only)
//   9. Disk-safe final pass              (mirrors _sanitizeEntryName)
//
// The user can always type over the result in the import review modal;
// this just lowers the friction in the common case.

// Maker prefixes worth stripping by default. Order matters when one
// contains another (longer first). Both apostrophe variants of
// JUANSITH'S are listed because we strip the prefix BEFORE we
// transliterate accents (so the acute-S still matches at this stage).
const VENDOR_PREFIXES = [
  "JUANSITH'S ",
  "JUANSITH´S ",
  'KSith_',
  'RENvious_',
];

// Trailing tokens that get peeled iteratively. Each loop iteration tries
// a version match first, then walks this list; longer multi-word tokens
// have to come before their shorter substrings so 'CFX SS' wins over
// 'CFX'. The 'AND' / '&' connectors are here so multi-platform stamps
// (PROFFIE AND XENOPIXEL V3) unwind cleanly across iterations.
const TRAILING_TOKENS = [
  'CFX SS',
  'CFXSS',
  'GOLDEN HARVEST',
  'GOLDENHARVEST',
  'XENOPIXEL',
  'PROFFIE',
  'ASTERIA',
  'VERSO',
  'XENO',
  'GHV3',
  'CFX',
  'WAV',
  'PACK',
  'BUNDLE',
  'AND',
  '&',
];

// Trailing version stamp. Anchored at end of string and allows either
// a separator-led attachment (_v1.1, -V2.4,  V3) OR letter-attached
// attachment (UltimateDarksideV2.3, DarkV3). Requires either a v/V
// prefix or a decimal segment; bare integers (Spectre_5, Survivor2)
// are preserved because they are identity, not version.
const TRAILING_VERSION_RX = /(?:[\s_-]+|(?<=[A-Za-z]))(?:[vV]\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*)\s*$/;

// Leading vendor-version prefix (1.1-, 2.0_, 1.2 ).
const LEADING_VERSION_RX = /^\s*\d+(?:\.\d+)?\s*[-_\s]+\s*/;

// Common Latin-script accent transliteration. Covers what shows up in
// font-maker naming (Spanish, French, German diacritics + the acute
// JUANSITH'S uses). Anything outside this map and outside the safe
// ASCII set gets nuked by dropNonAscii later in the pipeline.
const ACCENT_MAP = {
  '´': "'", '`': "'", '’': "'", '‘': "'",
  'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a', 'å': 'a',
  'Á': 'A', 'À': 'A', 'Ä': 'A', 'Â': 'A', 'Ã': 'A', 'Å': 'A',
  'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
  'É': 'E', 'È': 'E', 'Ë': 'E', 'Ê': 'E',
  'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
  'Í': 'I', 'Ì': 'I', 'Ï': 'I', 'Î': 'I',
  'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
  'Ó': 'O', 'Ò': 'O', 'Ö': 'O', 'Ô': 'O', 'Õ': 'O',
  'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
  'Ú': 'U', 'Ù': 'U', 'Ü': 'U', 'Û': 'U',
  'ñ': 'n', 'Ñ': 'N',
  'ç': 'c', 'Ç': 'C',
  'ß': 'ss',
};

function stripLeadingVersion(s) {
  return s.replace(LEADING_VERSION_RX, '');
}

function stripVendorPrefix(s) {
  for (const p of VENDOR_PREFIXES) {
    if (s.toLowerCase().startsWith(p.toLowerCase())) {
      return s.slice(p.length);
    }
  }
  return s;
}

function transliterate(s) {
  let out = '';
  for (const ch of s) out += ACCENT_MAP[ch] !== undefined ? ACCENT_MAP[ch] : ch;
  return out;
}

// Apostrophes (after transliteration) collapse to nothing so
// JUANSITH'S becomes JUANSITHS rather than JUANSITH_S.
function stripPunctuation(s) {
  return s.replace(/['`]/g, '');
}

function stripTrailingTail(s) {
  let cur = s;
  // Hard cap to defend against pathological inputs that somehow keep
  // peeling without converging. Each iteration must reduce length.
  for (let guard = 0; guard < 20; guard++) {
    const versionStripped = cur.replace(TRAILING_VERSION_RX, '');
    if (versionStripped !== cur) { cur = versionStripped; continue; }
    let matched = false;
    for (const tok of TRAILING_TOKENS) {
      const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`[\\s_-]+${escaped}\\s*$`, 'i');
      if (rx.test(cur)) {
        cur = cur.replace(rx, '');
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  return cur;
}

function dropNonAscii(s) {
  // Anything outside the safe set becomes a single underscore. The
  // collapse pass downstream merges runs.
  return s.replace(/[^A-Za-z0-9_\-\s.]/g, '_');
}

function collapseSeparators(s) {
  return s
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .replace(/[_\-]+$/g, '')
    .replace(/^[_\-]+/g, '');
}

// Title-case segments under two rules:
//   - All-lowercase ASCII letters: always (windu -> Windu).
//   - All-uppercase ASCII letters: only when length >= ALL_CAPS_MIN_LEN
//     (SATELE -> Satele) so short acronyms like ANH, ESB, ROTJ, HE, MAN
//     stay as acronyms rather than becoming Anh / Esb / Rotj.
// Mixed case (KSith, Survivor2, Dark2V3) is always left as-is.
const ALL_CAPS_MIN_LEN = 5;
function titleCase(s) {
  return s.split(/([_\-])/).map((part, i) => {
    if (i % 2 === 1) return part;
    if (/^[a-z]+$/.test(part)) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }
    if (/^[A-Z]+$/.test(part) && part.length >= ALL_CAPS_MIN_LEN) {
      return part.charAt(0) + part.slice(1).toLowerCase();
    }
    return part;
  }).join('');
}

// Mirrors soundFontEntries._sanitizeEntryName so the cleaner's output is
// always disk-safe even if a future step accidentally leaves a banned
// char in place.
function diskSafe(s) {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
}

function cleanSuggestedName(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = stripLeadingVersion(s);
  s = stripVendorPrefix(s);
  s = transliterate(s);
  s = stripPunctuation(s);
  s = stripTrailingTail(s);
  s = dropNonAscii(s);
  s = collapseSeparators(s);
  s = titleCase(s);
  s = diskSafe(s);
  return s;
}

module.exports = {
  cleanSuggestedName,
  VENDOR_PREFIXES,
  TRAILING_TOKENS,
  ACCENT_MAP,
};
