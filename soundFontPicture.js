// A picture for a common folder, a font, or a source.  [B-511]
//
// A FONT OR COMMON FOLDER, first that exists:
//   1. an image in its own folder, which is how a user sets one;
//   2. the creator's picture for it: an image beside it in the download (where Brian Conner's
//      voicepacks ship `a_<Character>.jpg` next to `common/`);
//   3. its source's OWN picture (steps 1-2 below), never one the source borrowed, or every font
//      in a bundle would show whichever character came first.
// A SOURCE, first that exists:
//   1. the picture the user set on it, kept in the attachments store so the download is untouched;
//   2. ONE FOR ONE: when exactly one item is built from it (the usual voicepack, or a single font),
//      that item's own-folder image. The source and its item are the same thing to a person, so
//      the image they chose for the item is the source's too, over the creator's original;
//   3. the creator's picture: an image at the top level of the download;
//   4. borrowed: the first item built from it, alphabetically, with a picture of its own (steps
//      1-2 above). A borrowed picture shows on the source only.
// Tiebreak among images in one folder: an `a_` name wins, then the first alphabetically.
// Returns { kind, id, subPath, origin } in the shape the byte readers take (common: uuid, entry:
// name, source: uuid, attachment: attachment id), or null. `origin` says whose image it is, which is
// what an Image row names: 'own' (in the item's own folder, or set on the source), 'creator' (in
// the download), 'source' (an item showing its source's) or 'borrowed' (a source showing an image
// from an item's own folder). ANYTHING IN THE DOWNLOAD IS THE CREATOR'S AND BELONGS TO THE SOURCE,
// even beside an item's folder: a font's row names only its own; a source's row names its own and
// the creator's.
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

// An item's picture from its own folder or its creator (steps 1-2). `ownDir` is the folder the user
// edits; `itemPath` is where the item sits inside its download.
async function _itemOwnPicture(userData, kind, id, ownDir, sourceUuid, itemPath, listings) {
  const own = pickPicture(filesIn(ownDir));
  if (own) return { kind, id, subPath: own, origin: 'own' };
  const beside = await besideInSource(userData, sourceUuid, itemPath, listings);
  return beside && { ...beside, origin: 'creator' };
}

// A source's own picture (steps 1-2): set by the user, else at the top of the download.
async function findSourceOwnPicture(userData, sourceUuid, listings) {
  if (!sourceUuid) return null;
  try {
    const set = require('./soundFontAttachments').sourcePicture(userData, sourceUuid);
    if (set) return { kind: 'attachment', id: set.id, subPath: set.name, origin: 'own' };
  } catch {}
  const top = await besideInSource(userData, sourceUuid, '', listings);
  return top && { ...top, origin: 'creator' };
}

const _inherited = (pic) => pic && { ...pic, origin: 'source' };

function _readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { return null; }
}

async function findCommonPicture(userData, uuid, listings) {
  const dir = path.join(require('./soundFontCommon').commonRoot(userData), uuid);
  const meta = _readMeta(dir);
  if (!meta) return null;
  return (await _itemOwnPicture(userData, 'common', uuid, path.join(dir, 'files'),
                                meta.sourceUuid, meta.sourceSubPath, listings))
    || _inherited(await findSourceOwnPicture(userData, meta.sourceUuid, listings));
}

async function findEntryPicture(userData, name, listings) {
  const dir = path.join(require('./soundFontEntries').entriesRoot(userData), name);
  const meta = _readMeta(dir);
  if (!meta) return null;
  return (await _itemOwnPicture(userData, 'entry', name, dir, meta.sourceUuid, meta.candidatePath, listings))
    || _inherited(await findSourceOwnPicture(userData, meta.sourceUuid, listings));
}

// Every item built from a source, common folders and fonts together, sorted by the name a person
// sees. Reads each common's meta.json directly: listCommons also sizes every common's files, which
// costs most of a second on a real library and none of it is needed here.
function sourceItems(userData, sourceUuid) {
  const items = [];
  const croot = require('./soundFontCommon').commonRoot(userData);
  let uuids = [];
  try { uuids = fs.readdirSync(croot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch {}
  for (const uuid of uuids) {
    const meta = _readMeta(path.join(croot, uuid));
    if (!meta || meta.sourceUuid !== sourceUuid) continue;
    items.push({ label: String(meta.name || uuid), kind: 'common', id: uuid,
                 ownDir: path.join(croot, uuid, 'files'), itemPath: meta.sourceSubPath });
  }
  const E = require('./soundFontEntries');
  for (const e of E.listEntriesBySourceUuid(userData, sourceUuid)) {
    const meta = _readMeta(path.join(E.entriesRoot(userData), e.name)) || {};
    items.push({ label: String(e.name), kind: 'entry', id: e.name,
                 ownDir: path.join(E.entriesRoot(userData), e.name), itemPath: meta.candidatePath });
  }
  items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return items;
}

// `opts.seed` picks among the items that could lend an image instead of taking the first: a window
// draws one seed per opening and passes it to every lookup it makes, so each opening can show a
// different one while everything in that window agrees. No seed, the first alphabetically.
async function findSourcePicture(userData, sourceUuid, opts = {}) {
  const listings = new Map();
  try {
    const set = require('./soundFontAttachments').sourcePicture(userData, sourceUuid);
    if (set) return { kind: 'attachment', id: set.id, subPath: set.name, origin: 'own' };
  } catch {}
  const items = sourceItems(userData, sourceUuid);
  if (items.length === 1) {
    const own = pickPicture(filesIn(items[0].ownDir));
    if (own) return { kind: items[0].kind, id: items[0].id, subPath: own, origin: 'own' };
  }
  const top = await besideInSource(userData, sourceUuid, '', listings);
  if (top) return { ...top, origin: 'creator' };
  const seed = Number.isFinite(opts.seed) ? Math.abs(Math.floor(opts.seed)) : null;
  const found = [];
  for (const it of items) {
    const pic = await _itemOwnPicture(userData, it.kind, it.id, it.ownDir, sourceUuid, it.itemPath, listings);
    if (!pic) continue;
    // An image from the download is the source's own even when found beside an item.
    const out = { ...pic, origin: pic.origin === 'own' ? 'borrowed' : 'creator' };
    if (seed === null) return out;
    found.push(out);
  }
  return found.length ? found[seed % found.length] : null;
}

module.exports = { pickPicture, findCommonPicture, findEntryPicture, findSourcePicture, findSourceOwnPicture, sourceItems, PICTURE_RX };
