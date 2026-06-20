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
    ],
  },
  {
    id: 'greyscale',
    displayName: 'Greyscale Fonts',
    website: 'https://www.greyscalefonts.com',
    purchasedDefault: undefined,
    patterns: [
      // Greyscale's own readme template carries an authorial signature
      // ("copyright (C) Greyscale Fonts <year>"). Match against the
      // copyright-adjacent phrasing rather than the bare brand name so
      // collaboration fonts that merely credit Greyscale as a contributor
      // (e.g. JayDalorian's Decimate, where the readme lists "Greyscale
      // Fonts- Blasters and Clashes") don't false-positive here.
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)(read.?me|ReadMe)\.txt$/i,
        contentMatch: /(?:copyright|©|\(c\))[^\n]{0,40}Greyscale Fonts/i,
      },
      // The remaining ~17 Greyscale fonts ship no readme but have the
      // signature five-zip board-flavor set at a common depth.
      {
        type: 'structuralSiblings',
        requireAll: [
          /^Asteria\.zip$/i,
          /^CFX-GH(?:V|v)3\.zip$/i,
          /^Proffie\.zip$/i,
          /^Verso\.zip$/i,
          /^Xeno3\.zip$/i,
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
    id: 'jaydalorian',
    displayName: 'JayDalorian',
    website: 'https://jaydalorian.com/',
    purchasedDefault: undefined,
    patterns: [
      // Older shape: ReadMe.txt at bundle root. Newer shape: Copyright ©.txt.
      // Both contain the same identifier text. Case-insensitive match catches
      // the variant cap "JayDaloRian" some readmes use vs the website's
      // canonical "JayDalorian".
      {
        type: 'readmeContent',
        fileMatch: /(^|\/)(ReadMe\.txt|Copyright .+\.txt)$/i,
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
            purchasedDefault: vendor.purchasedDefault,
            matchedFile: null,
            matchType: 'structuralSiblings',
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
            purchasedDefault: vendor.purchasedDefault,
            matchedFile: null,
            matchType: 'structuralAll',
          };
        }
      }
    }
  }

  return { vendorId: null, vendor: null, vendorAutoDetected: false };
}

module.exports = {
  vendors,
  detectVendor,
};
