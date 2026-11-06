// Identifies a font by its sounds against the catalogue that ships with the app.
//
// The percentage is how many of the catalogue font's sounds were found, so sounds someone added
// never count against a match. Thresholds come from measuring how much fonts really share: two
// fonts from different sources never passed 53%, and two creators never passed 9%.

'use strict';

const fs = require('fs');
const path = require('path');
const { segmentCandidateRecords, setsFromRecords } = require('./soundFontCompare');

const FILL_AT = 0.70;
const NAME_AT = 0.55;
const CREATOR_AT = 0.35;
const MIN_SOUNDS = 3;
const NAME_LEAD = 1.1;
const HASH_CHARS = 16;
const TIER_RANK = { creator: 1, name: 2, fill: 3 };

class FontCatalogue {
  constructor(data) {
    this.fonts = [];
    this.byHash = new Map();
    for (const creator of (data && data.creators) || []) {
      for (const font of creator.fonts || []) {
        const entry = { font, creator, total: font.sounds.length };
        this.fonts.push(entry);
        for (const [, hash] of font.sounds) {
          if (!this.byHash.has(hash)) this.byHash.set(hash, []);
          this.byHash.get(hash).push(entry);
        }
      }
    }
  }

  // hashes: the sounds found, full or shortened. Null when nothing reaches a suggestion.
  identify(hashes) {
    const found = new Map();
    for (const h of new Set([...hashes].map(x => String(x).slice(0, HASH_CHARS)))) {
      for (const entry of this.byHash.get(h) || []) found.set(entry, (found.get(entry) || 0) + 1);
    }
    const scored = [...found]
      .map(([entry, matched]) => ({ ...entry, matched, share: matched / entry.total }))
      .filter(s => s.matched >= MIN_SOUNDS && s.share >= CREATOR_AT);
    if (!scored.length) return null;

    // The most sounds wins, so a small add-in sitting inside a bigger font never takes its name,
    // even when only part of the bigger font is there.
    const most = Math.max(...scored.map(s => s.matched));
    const past = scored.filter(s => s.share >= FILL_AT && s.matched * 2 >= most);
    const pool = past.length ? past : scored;
    pool.sort((a, b) => b.matched - a.matched || b.share - a.share);
    const [best, next] = pool;

    const tied = next && next.matched === best.matched && next.share === best.share;
    const leads = !next || best.matched >= next.matched * NAME_LEAD;
    let tier = 'creator';
    if (best.share >= FILL_AT && !tied) tier = 'fill';
    else if (best.share >= NAME_AT && leads) tier = 'name';

    return {
      tier,
      creator: { name: best.creator.name, website: best.creator.website },
      font: tier === 'creator' ? null : { name: best.font.name, demo: best.font.demo, store: best.font.store },
      matched: best.matched,
      total: best.total,
      percent: Math.round(best.share * 100),
    };
  }

  // Per board variant, so a font sold for several boards is read on its best one.
  identifyRecords(records, candidatePath) {
    let best = null;
    for (const g of segmentCandidateRecords(records, candidatePath)) {
      const result = this.identify(setsFromRecords(g.records).core);
      if (result && (!best || result.matched > best.matched)) best = result;
    }
    return best;
  }

  // A source can hold several fonts: one result per font, and the strongest of them.
  identifySource(records, paths) {
    const byPath = {};
    let best = null;
    for (const p of paths) {
      const result = this.identifyRecords(records, p);
      if (!result) continue;
      byPath[p] = result;
      const rank = TIER_RANK[result.tier] - (best ? TIER_RANK[best.tier] : 0);
      if (rank > 0 || (rank === 0 && result.matched > best.matched)) best = result;
    }
    return { byPath, best };
  }
}

// Loaded the first time a font is identified, so it costs nothing until then. With no data file,
// nothing matches and import works as it always has.
let _current = null;
let _file = path.join(__dirname, 'fontCatalogueData.json');
function current() {
  if (_current) return _current;
  let data = null;
  try { data = JSON.parse(fs.readFileSync(_file, 'utf8')); } catch {}
  _current = new FontCatalogue(data);
  return _current;
}
// Which file to load from, when a newer copy than the shipped one is kept.
function useFile(file) { _file = file; _current = null; }
// A newer catalogue, taking effect for the next font identified.
function setData(data) { _current = new FontCatalogue(data); }

// A match past the line beats whatever the files said. A suggestion never replaces a creator the
// files named outright.
function mergeDetection(detection, found) {
  const { byPath, best } = found;
  const merged = { ...detection, catalogue: { byPath, store: '' } };
  if (!best) return merged;
  const fills = best.tier === 'fill';
  if (fills) merged.catalogue.store = best.font.store;
  if (!fills && detection.vendor && detection.confidence === 'content') return merged;
  return { ...merged, vendor: best.creator.name, vendorWebsite: best.creator.website || null,
    confidence: fills ? 'content' : 'structural', matchType: 'catalogue',
    matched: best.matched, total: best.total };
}

// The bulk doors work from a row's enrichment. A row can hold a whole bundle, so only a single font
// takes a name and links from its match.
function applyToEnrichment(e, result) {
  if (!result) return;
  const fills = result.tier === 'fill';
  if (fills || !e.vendor) {
    e.vendor = result.creator.name;
    e.vendorWebsite = result.creator.website || null;
    e.vendorConfidence = fills ? 'content' : 'structural';
  }
  if (fills && e.fontCount === 1) {
    e.suggestedName = result.font.name;
    e.nameSource = 'catalogue';
    e.catalogueDemo = result.font.demo;
    e.catalogueStore = result.font.store;
  }
}

module.exports = { FontCatalogue, current, useFile, setData, mergeDetection, applyToEnrichment, FILL_AT, NAME_AT, CREATOR_AT };
