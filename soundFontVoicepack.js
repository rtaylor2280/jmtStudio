// Sound Font common-folder voicepack catalog + downloader.
//
// Architecture (post-refactor):
//   V1 — in-app download from hubbe.net (per-variant stable URLs).
//        Sample = small ~84KB sibling .wav on hubbe.net. Install =
//        full ~15MB zip from hubbe.net.
//   V2 — preview-only in-app; install via external link to Brian's
//        Dropbox folder. The V2 mmain.wav is byte-identical to V1's
//        for every variant that exists in both (19 of 20), so the
//        V2 sample reuses V1's sibling sample URL — no bundle fetch
//        needed. English G is the one V2-only variant; its sample
//        ships as a bundled file in renderer/assets/voicepacks/.
//
// Why V2 install goes external: NoSloppy distributes V2 only as a
// single ~435MB Dropbox folder (no per-file URLs without auth). The
// per-file content is CC BY 4.0 so we could legally redistribute,
// but that means we'd either host the files ourselves or force a
// 435MB download for users who want one ~10MB variant. Both worse
// than just opening Brian's folder in the browser, letting the user
// download the variant they want, and importing via the existing
// "Pick .zip file…" flow.
//
// Attribution: all voicepacks are by Brian Conner (NoSloppy), released
// under CC BY 4.0. Surfaced in the picker modal footer.

const fs = require('fs');
const path = require('path');
const os = require('os');
const soundFontCommon = require('./soundFontCommon');

const HUBBE_BASE = 'https://fredrik.hubbe.net/lightsaber/sound';
const NOSLOPPY_V2_FOLDER_URL = 'https://www.dropbox.com/scl/fo/zojbb933bcysjll16dz6h/ADyeV3F3TxUAiCic9BGit9Q?rlkey=4z7pt3vmj6v2cuenniyfyz57i';

const V1_VARIANTS = {
  English:  ['A', 'B', 'C', 'D', 'E', 'F'],
  Italian:  ['A', 'B', 'C', 'D', 'E'],
  Russian:  ['A', 'B', 'C'],
  Spanish:  ['A', 'B'],
  French:   ['A'],
  Chinese:  ['A'],
  Japanese: ['A'],
};

// V2 catalog entries. Each variant has its own Dropbox direct-download
// URL (token unique per file, can't be constructed — sourced manually
// from the folder UI). 17 of 20 variants have URLs hardcoded here;
// English F and G fall back to external install (browser redirect to
// Brian's folder) until those URLs are added. ChineseA is named without
// the language/variant underscore — Brian's not strictly consistent on
// naming, so we keep baseName explicit per entry.
//
// Dropbox URL pattern: ?dl=0 (view) vs ?dl=1 (download). We store the
// view URL here; the install path appends &dl=1 when fetching.
const _DBX_RLKEY = '4z7pt3vmj6v2cuenniyfyz57i';
const _DBX_FOLDER_ID = 'zojbb933bcysjll16dz6h';
const _dbxUrl = (token, baseName) =>
  `https://www.dropbox.com/scl/fo/${_DBX_FOLDER_ID}/${token}/${baseName}?rlkey=${_DBX_RLKEY}&dl=1`;

const V2_ENTRIES = [
  { language: 'Chinese',  variant: 'A', baseName: 'ProffieOS_V2_Voicepack_ChineseA',  token: 'AFBb-PlpssZHgkW283uC3io' },
  { language: 'English',  variant: 'A', baseName: 'ProffieOS_V2_Voicepack_English_A', token: 'ALYFUNuFud8cuJz77YqGO2M' },
  { language: 'English',  variant: 'B', baseName: 'ProffieOS_V2_Voicepack_English_B', token: 'AAN1aPxvq0zT5xiFvIn9o2E' },
  { language: 'English',  variant: 'C', baseName: 'ProffieOS_V2_Voicepack_English_C', token: 'AFTVEgwHEOcZU2SeA3z_evk' },
  { language: 'English',  variant: 'D', baseName: 'ProffieOS_V2_Voicepack_English_D', token: 'ACYIT2FAfzh7jl6es2yfBqc' },
  { language: 'English',  variant: 'E', baseName: 'ProffieOS_V2_Voicepack_English_E', token: 'ABuldH6KOgc6qwfAwMDQvlY' },
  { language: 'English',  variant: 'F', baseName: 'ProffieOS_V2_Voicepack_English_F', token: 'AGoObHKDnwyZpALU5Jd-VTo' },
  { language: 'English',  variant: 'G', baseName: 'ProffieOS_V2_Voicepack_English_G', token: 'ANRAzrI6VftD6zYQKgwEQuI' },
  { language: 'French',   variant: 'A', baseName: 'ProffieOS_V2_Voicepack_French_A',  token: 'AKQ1C4wDxGYth_rcy8zRuZA' },
  { language: 'Italian',  variant: 'A', baseName: 'ProffieOS_V2_Voicepack_Italian_A', token: 'ACDWaqIXAN3O1GjvyrVNKaI' },
  { language: 'Italian',  variant: 'B', baseName: 'ProffieOS_V2_Voicepack_Italian_B', token: 'AJE_Bhy7djixzTpM9uX0knI' },
  { language: 'Italian',  variant: 'C', baseName: 'ProffieOS_V2_Voicepack_Italian_C', token: 'AP_-X1bXrRLvjYWNpkmbV4E' },
  { language: 'Italian',  variant: 'D', baseName: 'ProffieOS_V2_Voicepack_Italian_D', token: 'ALBbs2lMut5N18CYlw4jeSw' },
  { language: 'Italian',  variant: 'E', baseName: 'ProffieOS_V2_Voicepack_Italian_E', token: 'ACRIOY49kcxInzCUJVc4kvY' },
  { language: 'Japanese', variant: 'A', baseName: 'ProffieOS_V2_Voicepack_Japanese_A', token: 'AEGfKTwfndYtcYnDL9jN8aI' },
  { language: 'Russian',  variant: 'A', baseName: 'ProffieOS_V2_Voicepack_Russian_A', token: 'AOBQ7dAn3rYk0X5M0QK5j60' },
  { language: 'Russian',  variant: 'B', baseName: 'ProffieOS_V2_Voicepack_Russian_B', token: 'AOBdbl8obGhBIsH7n2B4BmY' },
  { language: 'Russian',  variant: 'C', baseName: 'ProffieOS_V2_Voicepack_Russian_C', token: 'ALPu40wqUC6nEtrRqVT_bsE' },
  { language: 'Spanish',  variant: 'A', baseName: 'ProffieOS_V2_Voicepack_Spanish_A', token: 'ACvrk5JGuzmvZz4tjOE4uJs' },
  { language: 'Spanish',  variant: 'B', baseName: 'ProffieOS_V2_Voicepack_Spanish_B', token: 'APJdScNo3fkyheMcDoWL4Cw' },
];

function _buildV1Catalog() {
  const out = [];
  for (const [language, variants] of Object.entries(V1_VARIANTS)) {
    for (const variant of variants) {
      const baseName = `ProffieOS_Voicepack_${language}_${variant}`;
      out.push({
        id: `v1-${language.toLowerCase()}-${variant.toLowerCase()}`,
        version: 'v1',
        language,
        variant,
        baseName,
        installType: 'in-app',
        zipUrl: `${HUBBE_BASE}/${baseName}.zip`,
        sampleUrl: `${HUBBE_BASE}/${baseName}.wav`,
      });
    }
  }
  return out;
}

function _buildV2Catalog() {
  return V2_ENTRIES.map(meta => {
    const v1HasMatch = (V1_VARIANTS[meta.language] || []).includes(meta.variant);
    const entry = {
      id: `v2-${meta.language.toLowerCase()}-${meta.variant.toLowerCase()}`,
      version: 'v2',
      language: meta.language,
      variant: meta.variant,
      baseName: meta.baseName,
    };
    // Install: direct Dropbox URL if we have the token; external
    // browser-redirect fallback if not (English F and G currently).
    if (meta.token) {
      entry.installType = 'in-app';
      entry.zipUrl = _dbxUrl(meta.token, meta.baseName);
    } else {
      entry.installType = 'external';
      entry.installUrl = NOSLOPPY_V2_FOLDER_URL;
    }
    // Sample: V1 sibling URL for variants V1 has too, bundled local
    // file for V2-only variants. Note V1 always uses Language_Variant
    // naming (with underscore) for sibling .wav even when V2's folder
    // omits it (Chinese case).
    if (v1HasMatch) {
      entry.sampleUrl = `${HUBBE_BASE}/ProffieOS_Voicepack_${meta.language}_${meta.variant}.wav`;
    } else {
      entry.sampleLocalPath = path.join('renderer', 'assets', 'voicepacks', `v2-${meta.language.toLowerCase()}-${meta.variant.toLowerCase()}-mmain.wav`);
    }
    return entry;
  });
}

const V1_CATALOG = _buildV1Catalog();
const V2_CATALOG = _buildV2Catalog();

function getCatalog() {
  return { v1: V1_CATALOG, v2: V2_CATALOG };
}

function getEntry(id) {
  return V1_CATALOG.find(e => e.id === id) || V2_CATALOG.find(e => e.id === id) || null;
}

// Fetch (or read) the preview sample for a voicepack and return the
// bytes. Two source types:
//   sampleUrl — HTTP fetch (V1 and V2-matching-V1)
//   sampleLocalPath — read from disk (V2-only variants bundled in renderer/assets)
// Local paths are resolved relative to the project root (where main.js
// lives), which works for both dev (running from source) and packaged
// (relative path resolution happens against app.getAppPath()).
async function downloadSample(id, appRoot) {
  const entry = getEntry(id);
  if (!entry) return { ok: false, error: `Unknown voicepack: ${id}` };

  if (entry.sampleLocalPath) {
    try {
      const absPath = path.isAbsolute(entry.sampleLocalPath)
        ? entry.sampleLocalPath
        : path.join(appRoot || __dirname, entry.sampleLocalPath);
      const buf = fs.readFileSync(absPath);
      return { ok: true, bytes: buf };
    } catch (err) {
      return { ok: false, error: `Could not read bundled sample: ${err.message}` };
    }
  }

  if (entry.sampleUrl) {
    try {
      const res = await fetch(entry.sampleUrl);
      if (!res.ok) return { ok: false, error: `Sample fetch failed (HTTP ${res.status})` };
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: true, bytes: buf };
    } catch (err) {
      return { ok: false, error: `Sample fetch error: ${err.message}` };
    }
  }

  return { ok: false, error: `No sample source defined for ${id}` };
}

// Download the full voicepack zip and import it as a common folder.
// Only valid for in-app installType entries (V1). External entries
// (V2) return an indicator so the renderer can open the source URL
// in the browser instead.
async function downloadAndInstall({ id, userData, onProgress }) {
  const entry = getEntry(id);
  if (!entry) return { ok: false, error: `Unknown voicepack: ${id}` };
  if (!userData) return { ok: false, error: 'Missing userData' };

  if (entry.installType === 'external') {
    return { ok: false, externalUrl: entry.installUrl, externalNote: 'This voicepack must be downloaded manually from the source.' };
  }

  // In-app install path: download the zip, route through the existing
  // common-folder zip importer. Used by both V1 (hubbe.net direct URLs)
  // and V2 (Dropbox per-variant URLs).
  const tmpZip = path.join(os.tmpdir(), `jmt-voicepack-${id}-${Date.now()}.zip`);
  try {
    if (onProgress) onProgress({ phase: 'downloading' });
    const res = await fetch(entry.zipUrl);
    if (!res.ok) return { ok: false, error: `Download failed (HTTP ${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    // Sanity check: real zip starts with PK\03\04. Dropbox returning
    // an HTML error page (e.g. rotated token, removed file) would
    // produce a "fake zip" that explodes later in importCommonFromZip.
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) {
      return { ok: false, error: 'Download did not return a zip file (source URL may have changed)' };
    }
    fs.writeFileSync(tmpZip, buf);

    if (onProgress) onProgress({ phase: 'installing' });
    let name = entry.baseName;
    let counter = 2;
    while (soundFontCommon.nameInUse(userData, name)) {
      name = `${entry.baseName} (${counter++})`;
      if (counter > 99) return { ok: false, error: 'Could not find a free name' };
    }
    return await soundFontCommon.importCommonFromZip(userData, tmpZip, name);
  } catch (err) {
    return { ok: false, error: `Install failed: ${err.message}` };
  } finally {
    try { fs.unlinkSync(tmpZip); } catch {}
  }
}

module.exports = {
  getCatalog,
  getEntry,
  downloadSample,
  downloadAndInstall,
};
