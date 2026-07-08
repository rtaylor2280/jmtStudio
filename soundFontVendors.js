// Sound Fonts — vendor lookup table and detection (Phase 1, slice 3).
//
// The seed table encodes the patterns verified during the 2026-06-11 crawl
// of the pristine vendor archive. Each vendor has one or more patterns; the
// detector walks a Source's full entry tree and returns the first match in
// vendor list order. Content-match patterns win when present; structural
// patterns are fallbacks for vendors that ship without a readme.
//
// Detection returns { vendorId, vendor, vendorWebsite, vendorAutoDetected,
// purchasedDefault, matchedFile, matchType } on success, or
// { vendorId: null, vendor: null, vendorAutoDetected: false } on no match.

const vendors = [
  // JMT Sabers — the house brand. Ryan's own fonts carry a readme.txt that
  // names "JMT Sabers"; the content match is specific enough to sit first
  // without false-matching any third-party vendor.
  {
    id: 'jmtsabers',
    displayName: 'JMT Sabers',
    website: 'https://jmtsabers.com',
    purchasedDefault: false,
    patterns: [
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)readme\.txt$/i,
        contentMatch: /JMT\s*Sabers/i,
      },
    ],
  },
  {
    id: 'kyberphonic',
    displayName: 'Kyberphonic',
    website: 'https://www.kyberphonicfonts.com',
    purchasedDefault: true,
    patterns: [
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)_ReadMe\.rtf$/i,
        contentMatch: /Kyberphonic/,
      },
    ],
  },
  {
    id: 'bksabersounds',
    displayName: 'BKSaberSounds',
    website: 'https://www.bksabersounds.com',
    purchasedDefault: true,
    patterns: [
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)readme\.txt$/i,
        contentMatch: /by\s+BKSaberSounds/i,
      },
    ],
  },
  {
    id: 'ksith',
    displayName: 'KSith',
    website: 'https://www.ksithsaberfonts.com/',
    purchasedDefault: undefined,
    patterns: [
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)readme\.txt$/i,
        contentMatch: /by\s+KSith/i,
      },
      // KSith ships every font with the prefix "KSith_" in the zip
      // filename (KSith_Ghost.zip, KSith_Rescue.zip, KSith_ShadowBlade.zip,
      // etc.). Catches the few KSith zips that ship without a readme.
      // Does NOT help Cere.zip — Cere is unsigned KSith and the
      // filename doesn't carry the prefix; hash registry is the only
      // path for that one.
      {
        type: 'sourceFilename',
        match: /^KSith_/i,
      },
    ],
  },
  // The next three vendors share a filename convention that's
  // self-identifying: "ReadMe - <VendorName> (Font Creator).txt". The
  // filename alone is the declaration — structuralAll file-existence
  // check is enough. Verified against Ryan's archive: each pattern
  // catches the right vendor with no overlap (DoubleAgent.zip ->
  // Mountain Sabers, Shadow Lord.zip -> Orlando Dove, The_Water_Saber.zip
  // -> Synthetic Epiphany). If a vendor outside this trio ever adopts
  // the same shape, add their entry alongside.
  {
    id: 'mountainsabers',
    displayName: 'Mountain Sabers',
    website: 'https://www.mountainsabersfonts.com',
    purchasedDefault: true,
    patterns: [
      {
        type: 'structuralAll',
        requireAll: [
          /(^|\/)ReadMe\s*-\s*Mountain\s+Sabers\s*\(Font\s+Creator\)\.txt$/i,
        ],
      },
      // Content-phrase fallback for fonts whose readme uses a non-standard
      // filename ("READ ME.txt", "ReadMe.txt", "README.md", etc.) but whose
      // body still names Mountain Sabers. Angelic Plazma ships with
      // "READ ME.txt" that opens "This is a Mountain Sabers Signature
      // Series sound font." — the structuralAll above misses it on
      // filename alone, but the body is a clean signal.
      {
        // Mountain Sabers name their attribution file inconsistently: some
        // fonts ship "READ ME.txt" (Stargate, Ultron), others carry it only
        // in "disclaimer.txt" ("Mountain Sabers is not affiliated with...").
        // Read both shapes so a disclaimer-only font still auto-detects the
        // vendor. The "Mountain Sabers" content match keeps it specific.
        type: 'readmeContent',
        fileMatch: /(^|\/)(read[\s_-]?me|disclaimer)\b[^/]*\.(txt|rtf|md)$/i,
        contentMatch: /Mountain\s+Sabers/i,
      },
      // Filename fallback for Mountain Sabers' bundle archives that
      // ship without per-font readmes (Mountain Sabers Free Pack
      // contains JURASSIC/, STARGATE/, etc. with no readmes inside).
      // Source archive name carries the vendor.
      {
        type: 'sourceFilename',
        match: /^Mountain\s+Sabers/i,
      },
    ],
  },
  {
    id: 'orlandodove',
    displayName: 'Orlando Dove',
    website: null,
    purchasedDefault: false, // Distributed free via YouTube
    patterns: [
      {
        type: 'structuralAll',
        requireAll: [
          /(^|\/)ReadMe\s*-\s*Orlando\s+Dove\s*\(Font\s+Creator\)\.txt$/i,
        ],
      },
    ],
  },
  {
    id: 'syntheticepiphany',
    displayName: 'Synthetic Epiphany',
    website: 'https://www.etsy.com/shop/syntheticepiphany',
    purchasedDefault: true,
    patterns: [
      {
        type: 'structuralAll',
        requireAll: [
          /(^|\/)ReadMe\s*-\s*Synthetic\s+Epiphany\s*\(Font\s+Creator\)\.txt$/i,
        ],
      },
    ],
  },
  {
    id: 'juansith',
    displayName: 'Juansith',
    website: 'https://www.saberfont.com',
    purchasedDefault: undefined,
    patterns: [
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)Read me\.txt$/i,
        contentMatch: /JUANSITH/i,
      },
      // Juansith always names their zips "JUANSITH'S <FontName>.zip"
      // (or with the acute-S variant "JUANSITH´S"). The TALZIN BLADE
      // and SKOLL zips ship without any text files at all, so the
      // filename is the only signal. Matches on the JUANSITH stem so
      // both apostrophe variants land.
      {
        type: 'sourceFilename',
        match: /^JUANSITH/i,
      },
    ],
  },
  {
    id: 'robpetkau',
    displayName: 'Rob Petkau',
    website: 'https://www.saberfont.com',
    purchasedDefault: undefined,
    patterns: [
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)readme\.txt$/i,
        // Require both signals so we don't false-match Juansith fonts that
        // also reference saberfont.com.
        contentMatch: /Rob Petkau/i,
        contentMatchAll: [/Rob Petkau/i, /saberfont\.com/i],
      },
    ],
  },
  {
    id: 'projectfonts',
    displayName: 'Project Fonts',
    website: 'https://www.saberfont.com',
    purchasedDefault: undefined,
    patterns: [
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)readme\.txt$/i,
        // Both signals required so we don't false-match Rob Petkau or
        // Juansith readmes that also mention saberfont.com.
        contentMatchAll: [/by\s+Project\s+Fonts/i, /saberfont\.com/i],
      },
    ],
  },
  {
    id: 'jaydalorian',
    displayName: 'JayDalorian',
    website: 'https://jaydalorian.com/',
    purchasedDefault: undefined,
    patterns: [
      // Older shape: ReadMe.txt at bundle root. Newer shape: Copyright ©.txt.
      // Standalone single-board fonts (e.g. Heavy) ship without a readme at
      // all — the attribution is the last line of Blade_Style.txt instead.
      // Three filename forms accepted; contentMatch is narrow enough
      // ("Jaydalorian" or "Jérôme Tremblay") that broadening the filename
      // surface doesn't introduce false positives.
      // Case-insensitive match catches the variant cap "JayDaloRian" some
      // readmes use vs the website's canonical "JayDalorian".
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)(ReadMe\.txt|Copyright .+\.txt|Blade[\s_-]?Style\.txt)$/i,
        contentMatch: /jaydalorian|J[ée]r[ôo]me\s+Tremblay/i,
      },
      // Structural fallback for variants that ship without any text identifier
      // but include the newer-shape helper files.
      {
        type: 'structuralAll',
        requireAll: [
          /(^|\/)[Pp]roffie\/resource\.txt$/i,
          /(^|\/)Cfx\/Blade Style \+ config\.txt$/i,
        ],
      },
      // JayDalorian's free releases (and many older paid releases)
      // prefix the zip filename with a version like "1.1-" or "1.2-".
      // Catches the few that ship without a readme or the structural
      // helper files: 1.1-BlasterMode.zip, 1.1-The New Year Saber,
      // 1.2-lightsaber of the bells, etc. Pattern is narrow enough
      // (leading digit.digit followed by a separator) that other
      // vendors don't accidentally match — checked against Ryan's full
      // collection.
      {
        type: 'sourceFilename',
        match: /^\s*\d+\.\d+\s*[-_\s]/,
      },
    ],
  },
  // Greyscale sits LAST in the vendor list because its phrase-content
  // pattern reads every .txt file in the archive. Putting it last means
  // we only pay that cost on sources that have already failed every
  // other vendor's cheap, narrowly-targeted pattern. Within Greyscale's
  // own patterns the order is also cheapest-first (narrow-filename
  // readme content, then two structural file/shape checks) so even
  // most Greyscale fonts skip the broad scan.
  {
    id: 'greyscale',
    displayName: 'Greyscale Fonts',
    website: 'https://www.greyscalefonts.com',
    purchasedDefault: undefined,
    patterns: [
      // Pattern 1 (cheap): Greyscale credits themselves in their readmes
      // via one of two phrasings: a copyright line ("copyright (C)
      // Greyscale Fonts <year>", "© Greyscale Fonts") OR a "created by
      // Greyscale Fonts" tagline (Engine Grip, Exalted, etc.). Pattern
      // accepts both. Collaboration fonts that list Greyscale further
      // down as a contributor (e.g. JayDalorian's Decimate, where the
      // readme has a "Greyscale Fonts- Blasters and Clashes" line)
      // don't match because that phrasing isn't preceded by "created
      // by" / copyright.
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)(read.?me|ReadMe)\.txt$/i,
        contentMatch: /(?:created\s+by|copyright|©|\(c\))[^\n]{0,40}Greyscale Fonts/i,
      },
      // Pattern 2 (cheap): inner-zip five-board set at a common depth
      // (Asteria.zip / CFX-GHv3.zip / Proffie.zip / Verso.zip /
      // Xeno3.zip). The unpacked-folder form of the same names is NOT a
      // Greyscale signature: it's the community-standard multi-board
      // export shape used by many other vendors including character-
      // font makers. Don't extend this pattern to folders without
      // additional textual evidence.
      {
        type: 'structuralSiblings',
        requireAll: [
          /^Asteria\.zip$/i,
          /^CFX-GH(?:V|v)3\.zip$/i,
          /^Proffie\.zip$/i,
          /^Verso\.zip$/i,
          /^Xeno3?\.zip$/i,
        ],
      },
      // Pattern 3 (cheap): Greyscale ships a distinctive style helper
      // file inside most of their fonts (paid and free, with or without
      // a readme): exact filename `proffie_blade_style.txt`, anywhere in
      // the archive tree. Verified against Ryan's archive: 7/7 known
      // Greyscale fonts with the standard filename include it
      // (Stitched, Skotos, Null, EngineGrip, Apocalypse, Decay,
      // Volatile), 6/6 known non-Greyscale fonts don't (Cere, KSith_Ghost,
      // KSith_Rescue, Father (Kyberphonic), Dark_Apprentice
      // (BKSaberSounds), SATELE (Juansith)). Catches the no-readme paid
      // Greyscale fonts that the readme content pattern misses.
      {
        type: 'structuralAll',
        requireAll: [
          /(^|\/)proffie_blade_style\.txt$/i,
        ],
      },
      // Pattern 4 (expensive — broad .txt scan, kept LAST): some
      // Greyscale fonts name the style file differently
      // (paradise_proffie_style.txt, binary_dark_and_light.txt,
      // magnetic_blade_style.txt etc.) so the file-existence pattern
      // above misses them. We fall through to scanning every .txt file
      // in the archive for an authorial disclaimer phrase that is
      // distinctive to Greyscale. Verified against Ryan's archive: 21/24
      // known Greyscale fonts contain this exact sentence somewhere in
      // a .txt file; 0/11 non-Greyscale fonts contain it anywhere. The
      // 3 still-uncovered fonts (Coda, Defect, Masterless) need manual
      // creator entry or the future hash registry.
      {
        type: 'readmeContent',
        fileMatch: /\.txt$/i,
        contentMatch: /I'm not claiming to be an expert, I'm still learning too/,
      },
    ],
  },
];

// Decode a Buffer to text, handling BOM-tagged UTF-8 / UTF-16 LE / UTF-16 BE
// plus unmarked UTF-16 LE (Windows Notepad with non-ASCII content frequently
// saves as UTF-16 LE without a BOM). Detection of unmarked UTF-16 LE: look at
// the first ~256 bytes; if more than 70% of odd-position bytes are null,
// assume UTF-16 LE.
function _decodeText(buf) {
  if (!buf || buf.length === 0) return '';
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const body = buf.slice(2);
    const swapped = Buffer.allocUnsafe(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return swapped.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return buf.slice(3).toString('utf8');
  }
  const sample = buf.slice(0, Math.min(256, buf.length));
  let nullCount = 0;
  let oddPositions = 0;
  for (let i = 1; i < sample.length; i += 2) {
    oddPositions++;
    if (sample[i] === 0) nullCount++;
  }
  if (oddPositions > 0 && nullCount / oddPositions > 0.7) {
    return buf.toString('utf16le');
  }
  return buf.toString('utf8');
}

function _parentDirOf(filePath) {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

function _basenameOf(filePath) {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? filePath : filePath.slice(idx + 1);
}

// Group basenames by their parent path. Used by structuralSiblings matching
// (all required basenames must appear in the same parent dir).
function _groupByParent(entries) {
  const map = new Map();
  for (const e of entries) {
    if (e.isDir) continue;
    const parent = _parentDirOf(e.fileName);
    const name = _basenameOf(e.fileName);
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(name);
  }
  return map;
}

function _matchesStructuralSiblings(entries, requireAll) {
  const byParent = _groupByParent(entries);
  for (const [parent, names] of byParent) {
    const allHit = requireAll.every(rx => names.some(n => rx.test(n)));
    if (allHit) return parent || '/';
  }
  return null;
}

// Companion to _matchesStructuralSiblings for vendors whose board flavors
// ship as folders rather than inner zips. Greyscale uses this layout
// alongside the zip form (e.g. Cere unpacks as Cere/Asteria/, Cere/Proffie/,
// etc. while older releases shipped Cere/Asteria.zip etc.). Groups
// directory basenames by their parent and checks that all required regexes
// hit somewhere in the same parent. Returns the parent path (or '/' at
// root) when matched.
function _matchesStructuralFolderSiblings(entries, requireAll) {
  const folderNamesByParent = new Map();
  for (const e of entries) {
    if (!e.isDir) continue;
    const clean = String(e.fileName).replace(/\/$/, '');
    if (!clean) continue;
    const slashIdx = clean.lastIndexOf('/');
    const parent = slashIdx === -1 ? '' : clean.slice(0, slashIdx);
    const name = slashIdx === -1 ? clean : clean.slice(slashIdx + 1);
    if (!name) continue;
    if (!folderNamesByParent.has(parent)) folderNamesByParent.set(parent, []);
    folderNamesByParent.get(parent).push(name);
  }
  for (const [parent, names] of folderNamesByParent) {
    const allHit = requireAll.every(rx => names.some(n => rx.test(n)));
    if (allHit) return parent || '/';
  }
  return null;
}

function _matchesStructuralAll(entries, requireAll) {
  return requireAll.every(rx =>
    entries.some(e => !e.isDir && rx.test(e.fileName))
  );
}

function _contentPasses(content, pattern) {
  if (pattern.contentMatchAll) {
    return pattern.contentMatchAll.every(rx => rx.test(content));
  }
  if (pattern.contentMatch) {
    return pattern.contentMatch.test(content);
  }
  return false;
}

// Header-line attribution shapes used across community-shared fonts:
//   "by Dayad Jocen (http://therebelarmory.com/user/1738)"
//   "Created by Joe Smith"
//   "Author: Jane Doe"
//   "Font by Greyscale Fonts"
// Anchored at line start, no /i — the lead-in tokens are listed in both
// cases explicitly to keep the captured-name section strict ([A-Z] start
// downstream). Name body excludes parens/commas/semicolons so list forms
// ("Joe Smith, contributor") don't get over-captured. Trailing
// parenthetical is captured as a URL candidate; validated downstream.
const _CREATOR_LINE_RX = /^\s*(?:[Bb]y|[Cc]reated\s+[Bb]y|[Aa]uthor|[Ff]ont\s+[Bb]y|[Dd]esigned\s+[Bb]y|[Mm]ade\s+[Bb]y|[Ss]ound\s+[Ff]ont\s+[Bb]y)[\s:]+([^(),;\n]{1,60}?)\s*(?:\(([^)]+)\))?\s*$/;

// Readme-shape filenames the generic extractor will scan. Tighter than
// the per-vendor patterns: only files whose stem starts with read[ _-]?me
// or credits/author/about. Excludes Blade_Style.txt and other in-font
// config files (no "by NAME" header convention there).
const _README_SHAPE_RX = /(^|\/)(read[\s_-]?me|credits|authors?|about)[^/]*\.(txt|rtf|md)$/i;

function _extractCreatorLineFromText(text) {
  const lines = text.split(/\r?\n/);
  let nonBlank = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    nonBlank++;
    if (nonBlank > 8) break;
    const m = line.match(_CREATOR_LINE_RX);
    if (!m) continue;
    const rawName = m[1].trim();
    if (rawName.length < 2) continue;
    // Capital-start guard filters noise lines that happened to start
    // with a lead-in token but whose "name" is lowercase prose.
    if (!/^[A-Z]/.test(rawName)) continue;
    let url = null;
    if (m[2]) {
      const cand = m[2].trim();
      if (/^https?:\/\/|^www\./i.test(cand)) url = cand;
    }
    return { name: rawName, url };
  }
  return null;
}

async function _extractGenericCreator(source, entries) {
  for (const e of entries) {
    if (e.isDir) continue;
    if (!_README_SHAPE_RX.test(e.fileName)) continue;
    let content;
    try {
      const buf = await source.readFile(e.fileName);
      content = _decodeText(buf);
    } catch { continue; }
    const hit = _extractCreatorLineFromText(content);
    if (hit) {
      return {
        vendorId: null,
        vendor: hit.name,
        vendorWebsite: hit.url || null,
        vendorAutoDetected: true,
        confidence: 'content',
        purchasedDefault: undefined,
        matchedFile: e.fileName,
        matchType: 'genericCreator',
      };
    }
  }
  return null;
}

async function _findReadmeMatch(source, entries, pattern) {
  // Read each matched file once; cache by path so multiple patterns scanning
  // the same files don't reread.
  for (const entry of entries) {
    if (entry.isDir) continue;
    if (!pattern.fileMatch.test(entry.fileName)) continue;
    let content;
    try {
      const buf = await source.readFile(entry.fileName);
      content = _decodeText(buf);
    } catch { continue; }
    if (_contentPasses(content, pattern)) {
      return { matchedFile: entry.fileName, matchedContent: content };
    }
  }
  return null;
}

async function detectVendor(source) {
  if (!source || typeof source.listAll !== 'function') {
    return { vendorId: null, vendor: null, vendorAutoDetected: false };
  }
  const entries = await source.listAll();

  // Confidence levels:
  //   - 'content'    — a file inside the source contains the vendor's
  //                    actual name as text. High confidence; safe to
  //                    auto-fill the vendor field.
  //   - 'structural' — only the file/folder shape matches a known
  //                    vendor's signature. Low confidence because the
  //                    same shape can be produced by other vendors using
  //                    similar tooling. Renderer treats this as a
  //                    suggestion the user has to apply explicitly.
  for (const vendor of vendors) {
    for (const pattern of vendor.patterns) {
      if (pattern.type === 'readmeContent') {
        const hit = await _findReadmeMatch(source, entries, pattern);
        if (hit) {
          return {
            vendorId: vendor.id,
            vendor: vendor.displayName,
            vendorWebsite: vendor.website,
            vendorAutoDetected: true,
            confidence: 'content',
            purchasedDefault: vendor.purchasedDefault,
            matchedFile: hit.matchedFile,
            matchType: 'readmeContent',
          };
        }
      } else if (pattern.type === 'structuralSiblings') {
        const parent = _matchesStructuralSiblings(entries, pattern.requireAll);
        if (parent) {
          return {
            vendorId: vendor.id,
            vendor: vendor.displayName,
            vendorWebsite: vendor.website,
            vendorAutoDetected: true,
            confidence: 'structural',
            purchasedDefault: vendor.purchasedDefault,
            matchedFile: null,
            matchType: 'structuralSiblings',
            matchedAt: parent,
          };
        }
      } else if (pattern.type === 'structuralFolderSiblings') {
        const parent = _matchesStructuralFolderSiblings(entries, pattern.requireAll);
        if (parent) {
          return {
            vendorId: vendor.id,
            vendor: vendor.displayName,
            vendorWebsite: vendor.website,
            vendorAutoDetected: true,
            confidence: 'structural',
            purchasedDefault: vendor.purchasedDefault,
            matchedFile: null,
            matchType: 'structuralFolderSiblings',
            matchedAt: parent,
          };
        }
      } else if (pattern.type === 'structuralAll') {
        if (_matchesStructuralAll(entries, pattern.requireAll)) {
          return {
            vendorId: vendor.id,
            vendor: vendor.displayName,
            vendorWebsite: vendor.website,
            vendorAutoDetected: true,
            confidence: 'structural',
            purchasedDefault: vendor.purchasedDefault,
            matchedFile: null,
            matchType: 'structuralAll',
          };
        }
      } else if (pattern.type === 'sourceFilename') {
        // Match against source.meta.originalName (the source archive's
        // delivered filename). Useful for vendors who consistently
        // prefix their zips (Juansith always ships "JUANSITH<...>.zip",
        // KSith always ships "KSith_<...>.zip", etc.). Cheap — no
        // reads, just a regex against a known string.
        const originalName = source.meta && source.meta.originalName;
        if (originalName && pattern.match.test(originalName)) {
          return {
            vendorId: vendor.id,
            vendor: vendor.displayName,
            vendorWebsite: vendor.website,
            vendorAutoDetected: true,
            confidence: 'structural',
            purchasedDefault: vendor.purchasedDefault,
            matchedFile: originalName,
            matchType: 'sourceFilename',
          };
        }
      }
    }
  }

  // No named vendor matched. Try generic creator extraction on
  // readme-shape files: catches one-off community contributors whose
  // README has a "by NAME" header but who aren't in the named-vendor
  // list (e.g. Tythonian Crystal by Dayad Jocen, hosted on rebelarmory).
  // matchType: 'genericCreator' so downstream code can distinguish from
  // named-vendor readmeContent matches.
  try {
    const generic = await _extractGenericCreator(source, entries);
    if (generic) return generic;
  } catch {}

  // Outer-source detection found nothing. If the source is a bundle of
  // inner zips (Kyberphonic ships Tales / Power of Many bundles where
  // each character is its own .zip inside the outer .zip and the
  // _ReadMe.rtf lives inside each inner zip rather than at the bundle
  // root), peek inside the first non-sidecar inner zip and re-run
  // detection against it.
  try {
    const nestedRes = await _detectVendorInNestedZip(source);
    if (nestedRes && nestedRes.vendor) return nestedRes;
  } catch {}

  return { vendorId: null, vendor: null, vendorAutoDetected: false };
}

// Helper: when an outer source has no detectable vendor and contains
// nested inner zips, open the first inner zip and run detectVendor
// against its entries. Assumes all inner zips in a bundle share the
// same vendor (verified true across every multi-font bundle observed
// in the field). Inner zips named "_extras.zip" are skipped because
// they're sidecars, not real fonts.
async function _detectVendorInNestedZip(source) {
  if (!source || typeof source.listAll !== 'function' || typeof source.readFile !== 'function') return null;
  let entries;
  try { entries = await source.listAll(); }
  catch { return null; }
  const innerZips = entries.filter(e =>
    !e.isDir
    && /\.zip$/i.test(e.fileName)
    && !e.fileName.includes('/')
    && !/^_extras\.zip$/i.test(e.fileName)
  );
  if (innerZips.length === 0) return null;
  const target = innerZips[0];
  let innerBuf;
  try { innerBuf = await source.readFile(target.fileName); }
  catch { return null; }
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const crypto = require('crypto');
  const tmpPath = path.join(os.tmpdir(), `jmt-vendor-peek-${crypto.randomUUID()}.zip`);
  try { fs.writeFileSync(tmpPath, innerBuf); }
  catch { return null; }
  let result = null;
  try {
    const StreamZip = require('node-stream-zip');
    const innerZip = new StreamZip.async({ file: tmpPath, skipEntryNameValidation: true });
    try {
      const map = await innerZip.entries();
      const innerEntries = [];
      for (const key of Object.keys(map)) {
        const e = map[key];
        if (!e.name || e.name === '/') continue;
        innerEntries.push({
          fileName: e.name,
          size: e.size,
          isDir: e.isDirectory || /\/$/.test(e.name),
        });
      }
      // Virtual source-like wrapper. meta carries the OUTER source's
      // meta so sourceFilename patterns continue to test against the
      // delivered archive name (the bundle name often carries vendor
      // info too) rather than the inner zip's name.
      const virtualSource = {
        meta: source.meta,
        listAll: async () => innerEntries,
        readFile: async (fileName) => innerZip.entryData(fileName),
      };
      result = await detectVendor(virtualSource);
    } finally {
      await innerZip.close();
    }
  } catch {}
  try { fs.unlinkSync(tmpPath); } catch {}
  return result;
}

module.exports = {
  vendors,
  detectVendor,
};
