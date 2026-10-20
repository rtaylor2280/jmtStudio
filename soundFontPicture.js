// A picture for a common folder, a font, or a source.
//
// Rule, the same for all three: an image in the item's own folder first, so a user can set their
// own by adding one; otherwise the image beside the item in its source (where Brian Conner's
// voicepacks ship `a_<Character>.jpg` next to `common/`). Tiebreak: an `a_` name wins, then the
// first alphabetically. Returns { kind, id, subPath } in the shape the existing byte readers take
// (common: uuid, entry: name, source: uuid), or null.
'use strict';

const fs = require('fs');
const path = require('path');

const PICTURE_RX = /\.(png|jpe?g|gif|webp|bmp)$/i;

function pickPicture(names) {
  const imgs = names.filter((n) => PICTURE_RX.test(n)).sort((a, b) => a.localeCompare(b));
  return imgs.find((n) => /^a_/i.test(n)) || imgs[0] || null;
}

function filesIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  } catch { return []; }
}

// The image in the source folder that holds `itemPath` (the item's path inside the source).
// `listings` (optional) maps sourceUuid -> its listAll() promise, so a caller checking several items
// of one source reads its listing once: ~300 ms each on a large bundle, nine times for nine fonts.
async function besideInSource(userData, sourceUuid, itemPath, listings) {
  if (!sourceUuid) return null;
  try {
    let all = listings && listings.get(sourceUuid);
    if (!all) {
      const source = require('./soundFontSources').openSource(userData, sourceUuid);
      if (!source) return null;
      all = source.listAll();
      if (listings) listings.set(sourceUuid, all);
    }
    const sub = String(itemPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const prefix = sub.includes('/') ? sub.slice(0, sub.lastIndexOf('/') + 1) : '';
    const names = (await all)
      .filter((e) => !e.isDir && e.fileName.startsWith(prefix) && !e.fileName.slice(prefix.length).includes('/'))
      .map((e) => e.fileName.slice(prefix.length));
    const pick = pickPicture(names);
    return pick ? { kind: 'source', id: sourceUuid, subPath: prefix + pick } : null;
  } catch { return null; }
}

async function findCommonPicture(userData, uuid, listings) {
  const C = require('./soundFontCommon');
  const dir = path.join(C.commonRoot(userData), uuid);
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; }
  const own = pickPicture(filesIn(path.join(dir, 'files')));
  if (own) return { kind: 'common', id: uuid, subPath: own };
  return besideInSource(userData, meta.sourceUuid, meta.sourceSubPath, listings);
}

async function findEntryPicture(userData, name, listings) {
  const E = require('./soundFontEntries');
  const dir = path.join(E.entriesRoot(userData), name);
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; }
  const own = pickPicture(filesIn(dir));
  if (own) return { kind: 'entry', id: name, subPath: own };
  return besideInSource(userData, meta.sourceUuid, meta.candidatePath, listings);
}

// A source shows the picture of the first common folder built from it that has one, then the
// first font; failing both, an image at the source's own top level.
// Reads each common's meta.json directly: listCommons also sizes every common's files, which
// costs most of a second on a real library and none of it is needed here.
async function findSourcePicture(userData, sourceUuid) {
  const listings = new Map();
  const root = require('./soundFontCommon').commonRoot(userData);
  let uuids = [];
  try { uuids = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
  catch {}
  for (const uuid of uuids) {
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(root, uuid, 'meta.json'), 'utf8')); } catch { continue; }
    if (!meta || meta.sourceUuid !== sourceUuid) continue;
    const pic = await findCommonPicture(userData, uuid, listings);
    if (pic) return pic;
  }
  const E = require('./soundFontEntries');
  for (const e of E.listEntriesBySourceUuid(userData, sourceUuid)) {
    const pic = await findEntryPicture(userData, e.name, listings);
    if (pic) return pic;
  }
  return besideInSource(userData, sourceUuid, '', listings);
}

module.exports = { pickPicture, findCommonPicture, findEntryPicture, findSourcePicture };
