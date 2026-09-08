// Sound Fonts — the curation sidecar. [B-283]
//
// THE PROBLEM: deleting a source cascades to its entries, and re-importing
// gets the FONTS back with none of the curation. Dates come back on their own
// (they derive from the archive's file date). What no heuristic can recover is
// the hand-authored part — the purchase link, the style-library link, the demo
// URL, the tags, a renamed entry. That is the part with the user's time in it.
//
// THE SHAPE (Ryan, 2026-09-02): one file at the ROOT of an exported zip. On a
// zip import it is stripped the moment it is seen, along with anything it
// points at, and the archive is repackaged BEFORE it is hashed. Everything
// downstream then runs exactly as it does today — no hash-exclusion threaded
// through the hasher, no second identity system.
//
// WHY REPACKAGING IS SAFE, and what it does and does not buy:
//   - It does NOT recover the vendor original's hash. The vendor zipped with
//     their settings and we zip with ours, so the bytes differ regardless.
//     That match was never achievable and is not lost here.
//   - It DOES make two JMT exports of the same source hash identically, because
//     zipFolderToFile is deterministic on purpose (sorted walk, statConcurrency
//     1). Export, curate differently, export again, strip both — same bytes.
//     That is the "I exported before deleting, now I'm bringing it back" case,
//     which is the whole reason this exists.
//
// THE COST IS GATED. A zip with no sidecar pays one root-entry listing and
// nothing else. Only an archive that actually carries curation pays the re-zip.
//
// PHASE 2 — CUSTOMIZED FONTS RIDE TOO ([B-311], 2026-09-07). A library entry
// whose files diverged from its source (the Customized marker) is the one thing
// a delete used to destroy outright: the vendor's bytes are re-importable, the
// user's edits existed nowhere else. Now each customized entry's folder is
// packed under PAYLOAD_DIR/customized/<n>, pointed at by the sidecar's
// `customized` list, and stripped before hashing exactly like a receipt — "a
// custom font folder is a receipt, only larger" (the [B-304] dictation). On
// re-import they are recreated as entries, and the candidate path they came
// from is left OUT of importedPaths unless a stock copy of it also existed —
// his rule (2026-09-07): "If I customized, its original is unchecked. If I made
// a copy so I have the customized and the original, they are both checked.
// Matches what was there before deletion."

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const StreamZip = require('node-stream-zip');

const SIDECAR_NAME = '.jmt-curation.json';
// Files the sidecar brings along (proofs of purchase) live under one root
// folder so the strip is a prefix test rather than a per-file lookup, and so a
// human opening the zip can see at a glance what is ours and what is the font.
const PAYLOAD_DIR = '.jmt-curation';
const SCHEMA_VERSION = 1;

// Source-level fields worth carrying. Deliberately NOT the derived ones:
// purchaseDate / acquisitionDate come from the archive's file date and restore
// themselves correctly, so shipping them would only create a chance to be wrong.
// ⚠️ bundleName WAS REMOVED FROM THIS LIST EARLIER ON 2026-09-03 AND THAT WAS
// WRONG — RESTORED. I checked `_writeSourceMetaAndStamp`, saw it never writes a
// bundleName, and concluded the field did not exist. It is written LATER, by the
// review's commit (`updateSourceMeta({ bundleName: userBundle })`), and 56 of
// Ryan's 159 sources carry one. Checking the wrong writer is not the same as
// checking for the field.
// It is also the field that MATTERS MOST here: bundleName is the user-facing
// Source Name, so it is hand-authored the moment anyone renames a source, and
// `originalName` (the archive's filename) cannot stand in for it. Without this a
// restore falls back to the file it was picked from — which for an auto-numbered
// export reads "Outcast_Knight (1)".
const SOURCE_FIELDS = ['bundleName', 'vendor', 'vendorWebsite', 'linkUrl', 'userNotes', 'purchased'];
// Entry-level fields, keyed by candidatePath — the only stable identifier an
// entry has across a delete and re-import. A name can be edited; the path the
// font occupies inside the archive cannot.
const ENTRY_FIELDS = ['name', 'tags', 'linkedStyleLibraryEntry', 'author', 'description', 'demoUrl', 'userNotes', 'purchased'];
// Record provenance, not curation: WHEN this entry existed in the library.
//
// ⚠️ THE LINE IS HISTORY versus ATTENTION, and it took two passes to find.
// `createdAt` is when the font entered the user's collection - a fact about the
// font's place in the library, and restoring it is what makes a round trip
// leave no trace. `seenAt` is whether they have LOOKED at it since it appeared,
// and it just appeared. Restoring it suppressed the NEW badge, so three fonts
// landed in the grid with nothing marking them.
// Ryan, 2026-09-03: "yes, the created date goes back to original, but the new
// tag should still come on." HISTORY IS RESTORED; ATTENTION STATE IS NOT.
// ⚠️ There is a real argument the other way and it should be seen before this is
// "fixed" back: the badge's own definition is "never opened and never used"
// (index.html:19498), and a restored font HAS been used. His call stands
// because the badge's value AT IMPORT is showing what just landed.
// Safe from the one-time `backfillSeenAt`, which is gated behind a persisted
// flag precisely so it cannot silently re-stamp newly arrived entries.
//
// ⚠️ entryUuid is deliberately NOT here either. It is the record's identity, and
// restoring one while a copy of that entry still exists would put two rows in
// the library under the same id. The timestamps carry no such hazard.
const ENTRY_PROV_FIELDS = ['createdAt', 'updatedAt', 'acquisitionDate'];

function _pick(obj, fields) {
  const out = {};
  if (!obj) return out;
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[f] = v;
  }
  return out;
}

// Build the payload for a source: its own curated fields, one block per entry
// that came from it, and the attachments it links. Returns null when there is
// nothing worth carrying — an untouched source should not grow a sidecar,
// because that would change its exported bytes for no gain.
// opts.includeAttachments (default true) is the export's PARAMETER, not a
// question this module asks. Set false and the receipts are left behind while
// the fields still travel — which is the one thing the source-export checkbox
// can turn off. Skipping them here rather than filtering later matters: the
// "nothing worth carrying" test at the bottom then sees the real payload, so a
// source whose ONLY curation was a receipt correctly produces no sidecar at all
// and its exported bytes stay untouched.
function buildForSource(userData, uuid, appVersion, opts) {
  const includeAttachments = !(opts && opts.includeAttachments === false);
  // Same treatment as the receipts ([B-311], his call 2026-09-07: "option only
  // on direct export and automatic on delete with export first"): a parameter
  // of the export, defaulting to carry.
  const includeCustomized = !(opts && opts.includeCustomized === false);
  const sources = require('./soundFontSources');
  const entriesMod = require('./soundFontEntries');
  const attachMod = require('./soundFontAttachments');

  let sourceMeta = null;
  try {
    sourceMeta = JSON.parse(fs.readFileSync(
      path.join(userData, 'soundFonts', 'sources', uuid, 'meta.json'), 'utf8'));
  } catch { return null; }
  if (!sourceMeta) return null;

  const source = _pick(sourceMeta, SOURCE_FIELDS);
  // A vendor the app guessed is not curation — re-importing will guess it
  // again, and shipping it would let a stale guess outrank a fresh one.
  if (sourceMeta.vendorAutoDetected) { delete source.vendor; delete source.vendorWebsite; }

  const entries = {};
  const entryProvenance = {};
  const importedPaths = [];
  const customized = [];
  let entryList = [];
  try { entryList = entriesMod.listEntries(userData) || []; } catch { entryList = []; }
  for (const e of entryList) {
    const m = e && e.meta;
    if (!m || m.sourceUuid !== uuid) continue;
    // ⚠️ '' IS A VALID candidatePath, not a missing one - a single-font source
    // puts its font at the archive ROOT, so the path is the empty string. The
    // first version tested `if (!key) continue`, which silently dropped the
    // entry curation for every single-font source, the most common kind. Only
    // null/undefined means "no path". (Found on a real export 2026-09-02: an
    // entry with tags and a demo URL produced "entries": {}.)
    const key = m.candidatePath;
    if (key == null) continue;
    // ── Customized fonts ride whole ([B-311]) ──
    // Detected off the stamp getEntryCustomization maintains, so this is a
    // cache read for every entry the marker has already answered for. `known`
    // is required: an entry the diff cannot judge (missing manifest) must not
    // be shipped as customized on a guess — it stays on the stock path, which
    // loses nothing that exists.
    let _cust = null;
    try { _cust = entriesMod.getEntryCustomization(userData, e.name); } catch { _cust = null; }
    const _rides = includeCustomized && !!(_cust && _cust.known && _cust.customized);
    if (_rides) {
      customized.push({
        entryName: e.name,
        candidatePath: key,
        // Index-numbered so two entries with hostile names can never collide
        // inside the archive; the JSON carries the real name.
        dir: `${PAYLOAD_DIR}/customized/${customized.length}`,
        // The entry's OWN curation and provenance, carried ON the record rather
        // than in the candidatePath-keyed maps below — a stock copy and a
        // customized copy can share one candidatePath, and keyed maps hold one
        // block per key. Last-writer-wins there would cross their tags.
        curation: _pick(m, ENTRY_FIELDS),
        provenance: _pick(m, ENTRY_PROV_FIELDS),
        _absDir: path.join(entriesMod.entriesRoot(userData), e.name),
      });
    }
    // ⭐ WHICH CANDIDATES WERE ACTUALLY IMPORTED. (Ryan, 2026-09-03: "if I chose
    // to not import certain files, in other words left them unchecked, those
    // checked versus unchecked I don't believe are included and they should
    // be.") A bundle of six where he took three is a DECISION. Without this the
    // review re-opens with all six ticked by default and the restore quietly
    // undoes it - another trace of the delete.
    // ⚠️ IT CANNOT BE INFERRED FROM `entries`. That map only gains a key when
    // the font carried curation, so an imported-but-uncurated font would look
    // like one he had deliberately skipped - exactly backwards.
    // ⭐ A CUSTOMIZED ENTRY THAT RIDES THE PAYLOAD DOES NOT CLAIM ITS PATH
    // ([B-311], his rule 2026-09-07): the restore recreates the customized
    // version directly, so the vendor's candidate comes back UNCHECKED — "the
    // original is no longer one that you're including." A stock entry at the
    // same path still pushes it, which is exactly the both-copies case. And a
    // customized entry NOT riding (box unticked) pushes it too — the vendor
    // version is then the only restorable one, and it was imported.
    if (!_rides) importedPaths.push(key);
    // ⚠️ A RIDING ENTRY'S CURATION TRAVELS ON ITS RECORD, NOT IN THE KEYED
    // MAPS. The maps are keyed by candidatePath and a stock copy and a
    // customized copy can SHARE one path — letting the rider write here meant
    // last-writer-wins handed the customized entry's NAME to the stock
    // candidate's review row. Ryan hit the consequence live (2026-09-07): the
    // row offered "Volatile_2", the restore had already created Volatile_2,
    // and the commit died on "Entry already exists". The candidate row
    // describes the VENDOR's copy, so only entries restorable THROUGH the
    // candidate (the non-riding ones) may describe it.
    if (_rides) continue;
    const block = _pick(m, ENTRY_FIELDS);
    if (Object.keys(block).length === 0) continue;
    entries[key] = block;
    // Record-level provenance, kept SEPARATE from the curation block above
    // because they are different kinds of fact: `entries` is what the user
    // wrote, this is when the record existed.
    // ⭐ Ryan's bar, 2026-09-03: "there should be no trace of me ever deleting
    // and bringing it back." A createdAt of today is exactly such a trace - the
    // font entered HIS library in August; only the row is new. Same for the
    // NEW badge, which is `seenAt` being empty.
    const prov = _pick(m, ENTRY_PROV_FIELDS);
    if (Object.keys(prov).length > 0) entryProvenance[key] = prov;
  }

  const attachments = [];
  const ids = includeAttachments && Array.isArray(sourceMeta.attachments) ? sourceMeta.attachments : [];
  for (const id of ids) {
    let abs = null;
    try { abs = attachMod.attachmentFilePath(userData, id); } catch { abs = null; }
    if (!abs) continue;
    let info = {};
    try { info = attachMod.listAttachments(userData, uuid).find(a => a.id === id) || {}; } catch {}
    const fileName = info.name || path.basename(abs);
    attachments.push({
      id,
      name: fileName,
      label: info.label || '',
      // Path inside the zip. Namespaced by id so two receipts with the same
      // filename cannot collide in the archive.
      file: `${PAYLOAD_DIR}/${id}/${fileName}`,
      _abs: abs,
    });
  }

  // ── PROVENANCE ──────────────────────────────────────────────────────────
  // Ryan's bar, 2026-09-03: "it should for me be identical to what it was
  // before I deleted." Curation alone does not reach that. Two things were
  // still lost across the round trip, and neither is a value the user typed:
  //
  //   THE DATES. purchaseDate / acquisition were deliberately left OUT of
  //   SOURCE_FIELDS on the grounds that they "restore themselves from the
  //   archive's file date". ⚠️ THAT IS TRUE ONLY WHEN THE EXPORT AND THE
  //   ORIGINAL SHARE A DATE, which was the case the day it was measured and is
  //   false in general — the export was written TODAY, so a bundle acquired in
  //   August came back acquired today. Carry them.
  //
  //   THE IDENTITY. A rebuilt export can never match the vendor's archive
  //   bytes, so the app cannot recognise its own export as the same source.
  //   Carrying the ORIGINAL hashes is what makes "if I didn't delete first, it
  //   should know that it's imported" answerable.
  //
  // contentHash here is the PER-SOURCE MANIFEST's fold over the files INSIDE
  // the archive — the container-independent one. ⚠️ NOT meta.contentHash,
  // which is hashItemDir over the source DIRECTORY and therefore covers
  // exactly one file, source.zip, making it the archive hash under another
  // name. Two different values, same field name; do not swap them.
  const provenance = {
    archiveHash: sourceMeta.hash || null,
    contentHash: null,
    // ⭐ THE DATE, and his rule is the whole specification (2026-09-03): "the date
    // is the date of the file. The user can override that or the restore can
    // override it. That's it." One value, three sources, in precedence: the
    // file's date, the user's override, the restore's value.
    // ⚠️ IT IS CARRIED UNDER EVERY NAME THE APP CURRENTLY KEEPS IT UNDER. The same
    // value has accumulated three (purchaseDate / acquisitionDate /
    // sourceFileDate) plus a routing map and a legacy fallback, and picking which
    // ones "matter" is exactly the per-field judgement that dropped
    // acquisitionDate and left a restored source with a blank Acquired where the
    // original had 2025-08-21. Carry what was THERE, not what is READ.
    // (Collapsing the three names to one is its own job, deliberately not here.)
    purchaseDate: sourceMeta.purchaseDate || null,
    acquisitionDate: sourceMeta.acquisitionDate || null,
    sourceFileDate: sourceMeta.sourceFileDate || null,
    sourceFileMtimeMs: sourceMeta.sourceFileMtimeMs || null,
    updatedAt: sourceMeta.updatedAt || null,
    // Carried so a restored vendor keeps its provenance: a name the app guessed
    // must not come back looking like one the user asserted.
    vendorAutoDetected: !!sourceMeta.vendorAutoDetected,
  };
  try {
    const fh = require('./soundFontFileHash');
    const man = fh.readFileHashManifest(
      path.join(userData, 'soundFonts', '.filehashes', 'sources', `${uuid}.json`));
    if (man && man.contentHash) provenance.contentHash = man.contentHash;
  } catch { /* no manifest: identity falls back to the archive hash alone */ }

  const hasSource = Object.keys(source).length > 0;
  const hasEntries = Object.keys(entries).length > 0;
  // Provenance alone is worth carrying — an uncurated source that was deleted
  // and re-imported should still come back with its own dates and identity.
  const hasProv = !!(provenance.archiveHash || provenance.purchaseDate);
  // A partial import is itself a decision worth carrying, even with no curation
  // and no provenance: taking 3 of 6 fonts is a choice the restore must honour.
  const hasPartial = importedPaths.length > 0;
  if (!hasSource && !hasEntries && attachments.length === 0 && !hasProv && !hasPartial
      && customized.length === 0) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    writtenBy: `JMT Studio${appVersion ? ' ' + appVersion : ''}`,
    writtenAt: new Date().toISOString(),
    sourceUuid: uuid,
    originalName: sourceMeta.originalName || '',
    source,
    entries,
    entryProvenance,
    importedPaths,
    attachments,
    customized,
    provenance,
  };
}

// Record-level provenance for one candidate: the timestamps that make a
// restored entry indistinguishable from the one that was deleted. Separate
// from entryCurationFor because the caller applies them differently — curation
// is metadata the review may overrule, these are stamped after the record is
// built and nothing else competes for them.
function entryProvenanceFor(payload, candidatePath) {
  if (!payload || !payload.entryProvenance) return null;
  const block = payload.entryProvenance[_rootKey(candidatePath)];
  if (!block) return null;
  const out = _pick(block, ENTRY_PROV_FIELDS);
  return Object.keys(out).length ? out : null;
}

// Copy an entry's folder into the payload, skipping the root meta.json — the
// same exclusion exportEntryToFolder ships with (app artifact, not font
// content; a vendor's own nested meta.json deeper in the tree is kept).
// Returns true only if the whole tree copied; a half-carried customized font
// is worse than an honestly absent one, so the caller drops the record on
// false rather than shipping a folder missing files.
function _copyEntryDirInto(srcDir, destDir) {
  try {
    const stack = [['', true]];
    while (stack.length) {
      const [rel, isRoot] = stack.pop();
      const from = rel ? path.join(srcDir, rel) : srcDir;
      const to = rel ? path.join(destDir, rel) : destDir;
      fs.mkdirSync(to, { recursive: true });
      for (const d of fs.readdirSync(from, { withFileTypes: true })) {
        if (isRoot && d.name === 'meta.json') continue;
        if (d.isDirectory()) { stack.push([rel ? `${rel}/${d.name}` : d.name, false]); continue; }
        if (!d.isFile()) continue;
        fs.copyFileSync(path.join(from, d.name), path.join(to, d.name));
      }
    }
    return true;
  } catch { return false; }
}

// Drop the sidecar (and its payload files) into a reconstructed tree, just
// before it is archived. The _abs / _absDir keys are stripped on the way out so
// the written JSON carries no machine-specific paths.
// Returns { ok, attachmentsWritten, customizedWritten } — the COUNTS are the
// point, not a nicety. A receipt that cannot be read is skipped rather than
// failing the export, so the number that landed can be lower than the number
// the payload lists. Anything reporting what the archive carries has to count
// what was written, or it describes a file that is not in there.
function writeIntoTree(treeDir, payload) {
  if (!payload) return { ok: false, attachmentsWritten: 0, customizedWritten: 0 };
  let attachmentsWritten = 0;
  for (const a of (payload.attachments || [])) {
    if (!a._abs) continue;
    const dest = path.join(treeDir, ...a.file.split('/'));
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(a._abs, dest);
      attachmentsWritten++;
    } catch { /* a receipt that cannot be read must not fail the export */ }
  }
  // Customized fonts ([B-311]): the whole entry folder, minus the root
  // meta.json. A record whose copy failed is REMOVED from the written sidecar,
  // not just uncounted — a sidecar pointing at a folder that is not in the
  // archive would make the restore invent an empty font.
  const carriedCustomized = [];
  // A dropped record hands its candidate path BACK to importedPaths: the
  // customized version is not in the archive, so the vendor's copy at that path
  // is the only restorable one again and must come back checked, exactly as if
  // the include box had been unticked for that font.
  const reclaimedPaths = [];
  for (const c of (payload.customized || [])) {
    if (!c._absDir || !c.dir) continue;
    const dest = path.join(treeDir, ...String(c.dir).split('/'));
    if (_copyEntryDirInto(c._absDir, dest)) {
      carriedCustomized.push(c);
    } else {
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
      if (c.candidatePath != null) reclaimedPaths.push(c.candidatePath);
    }
  }
  const clean = {
    ...payload,
    attachments: (payload.attachments || []).map(({ _abs, ...rest }) => rest),
    customized: carriedCustomized.map(({ _absDir, ...rest }) => rest),
    ...(reclaimedPaths.length ? {
      importedPaths: [...(payload.importedPaths || []), ...reclaimedPaths],
    } : {}),
  };
  try {
    fs.writeFileSync(path.join(treeDir, SIDECAR_NAME), JSON.stringify(clean, null, 2));
    return { ok: true, attachmentsWritten, customizedWritten: carriedCustomized.length };
  } catch { return { ok: false, attachmentsWritten, customizedWritten: carriedCustomized.length }; }
}

// What a written sidecar actually carries, in the user's categories rather than
// the schema's field names. Returned by injectIntoZip so a caller that wants to
// SAY what went into the zip reads it off the export instead of re-deriving it
// from the library.
//
// ⚠️ THE RE-DERIVATION IS THE BUG THIS EXISTS TO PREVENT. The first disclosure
// was assembled in the renderer by re-reading the source and calling
// listAttachments — and it looked only at the source fields, so an export
// carrying an entry's tag and demo URL announced "Includes your links". A
// disclosure that under-reports is worse than none: it tells the user they know
// what is in the file when they do not. There is only one thing that knows what
// was written, and it is the payload that was written.
//
// Key PRESENCE is the whole test, deliberately. _pick already dropped
// undefined, null, blank strings and empty arrays on the way in, so a key that
// survived into the payload is a value the user actually has. Re-testing
// emptiness here would be a second definition of "empty", free to drift from
// the first.
// attachmentsWritten / customizedWritten, when given, override the payload's
// own counts. The payload says what we MEANT to carry; the writer says what
// landed. A receipt that could not be read is skipped silently, so counting
// the payload would claim a proof of purchase the recipient will not find —
// and the same honesty applies to a customized font whose copy failed.
function summarize(payload, attachmentsWritten, customizedWritten) {
  const none = { notes: false, tags: false, links: false, attachments: 0, customized: 0, any: false };
  if (!payload) return none;
  const src = payload.source || {};
  const blocks = Object.values(payload.entries || {});
  const on = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const anyEntry = (k) => blocks.some(b => on(b, k));

  const notes = on(src, 'userNotes') || anyEntry('userNotes');
  const tags = anyEntry('tags');
  // One bucket for every kind of link, because that is the word the user owns.
  // A style-library reference is not a URL, but "links" is what they would call
  // it, and splitting it out lengthens the sentence without telling them more.
  const links = on(src, 'linkUrl') || on(src, 'vendorWebsite')
    || anyEntry('demoUrl') || anyEntry('linkedStyleLibraryEntry');
  const attachments = typeof attachmentsWritten === 'number'
    ? attachmentsWritten
    : (payload.attachments || []).length;
  const customized = typeof customizedWritten === 'number'
    ? customizedWritten
    : (payload.customized || []).length;

  return {
    notes, tags, links, attachments, customized,
    any: notes || tags || links || attachments > 0 || customized > 0,
  };
}

// Add the sidecar to a zip that has already been written. Done as a post-step
// on the finished export rather than inside the three exportToDownloads
// implementations, because they produce their archive three different ways (a
// pristine copyFile for zip sources, zipFolderToFile for folder sources, a
// reconstruct-then-zip for deduped ones) and only ONE of them has a temp tree
// to drop a file into. One function here covers all three.
//
// The pristine fast path stays pristine when there is nothing to carry: an
// uncurated source never reaches this, so its exported bytes are still the
// vendor's archive copied verbatim.
async function injectIntoZip(zipPath, payload, onProgress) {
  if (!payload) return { ok: true, injected: false, carried: summarize(null) };
  const sources = require('./soundFontSources');
  // ⚠️ THE WORKING TREE MUST LIVE BESIDE THE DESTINATION, NOT IN os.tmpdir().
  // The rebuilt archive is moved into place with renameSync, and rename CANNOT
  // cross volumes — it throws EXDEV. A user whose Desktop or Downloads is on a
  // different drive from the system temp (D:\Desktop with temp on C:, which is
  // exactly Ryan's machine) would hit that every single time. Staging in the
  // destination's own directory makes the move same-volume by construction.
  // Cost us a real 708 MB export on 2026-09-02. ([B-283])
  const tmpDir = fs.mkdtempSync(path.join(path.dirname(zipPath), '.jmt-curation-'));
  const treeDir = path.join(tmpDir, 'tree');
  fs.mkdirSync(treeDir, { recursive: true });
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
    const entries = await zip.entries();
    const keys = Object.keys(entries).filter(k => entries[k].name
      && entries[k].name !== '/' && !entries[k].isDirectory);
    let done = 0;
    for (const k of keys) {
      const rel = entries[k].name.replace(/\\/g, '/');
      const dest = path.resolve(treeDir, rel);
      if (!dest.startsWith(path.resolve(treeDir) + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await zip.extract(entries[k].name, dest);
      done++;
      if (onProgress) onProgress({ phase: 'curation-write', fileCount: done, totalFiles: keys.length });
    }
    await zip.close();
    zip = null;
    const written = writeIntoTree(treeDir, payload);
    const outPath = path.join(tmpDir, 'out.zip');
    await sources.zipFolderToFile(treeDir, outPath, (p) => onProgress && onProgress({
      phase: 'curation-repack', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes, currentFile: p.currentFile,
    }));
    // ⚠️ ORDER IS LOad-BEARING: move the ORIGINAL aside first, put the rebuilt
    // one in place, and only then delete the original. The first version of this
    // deleted the destination BEFORE the rename and lost a 708 MB export when
    // the rename then failed. At no point may the destination path be empty
    // while the replacement is still only a hope.
    const backup = `${zipPath}.jmt-prev`;
    try { fs.rmSync(backup, { force: true }); } catch {}
    fs.renameSync(zipPath, backup);        // original safe, dest now free
    try {
      fs.renameSync(outPath, zipPath);     // same volume by construction
    } catch (err) {
      try { fs.renameSync(backup, zipPath); } catch {}  // put it back, exactly as it was
      throw err;
    }
    try { fs.rmSync(backup, { force: true }); } catch {}
    return { ok: true, injected: true, carried: summarize(payload, written.attachmentsWritten, written.customizedWritten) };
  } catch (err) {
    // An export that succeeded must never be destroyed by a failure to decorate
    // it. Every path above either leaves the original in place or restores it.
    // carried reports the empty set, not the payload: the archive on disk is the
    // one WITHOUT the sidecar, so anything else would describe a file that is
    // not there.
    return { ok: false, injected: false, carried: summarize(null), error: String(err && err.message || err) };
  } finally {
    if (zip) { try { await zip.close(); } catch {} }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// Is there a sidecar at the root of this zip? This is the check every ordinary
// import pays, so it reads the central directory and nothing else — no
// extraction, no hashing, no walk.
async function peekZip(zipPath) {
  let zip;
  try { zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true }); }
  catch { return null; }
  try {
    const entries = await zip.entries();
    if (!entries[SIDECAR_NAME]) return null;
    const buf = await zip.entryData(SIDECAR_NAME);
    const payload = JSON.parse(buf.toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    // A sidecar from a newer schema is data we cannot promise to read
    // correctly. Ignore it rather than half-apply it — the font still imports,
    // which is the important part.
    if (typeof payload.schemaVersion !== 'number' || payload.schemaVersion > SCHEMA_VERSION) return null;
    return payload;
  } catch { return null; }
  finally { try { await zip.close(); } catch {} }
}

// Extract everything EXCEPT the sidecar and the files it points at, then
// repackage. Returns { zipPath, tmpDir } — the caller owns tmpDir and must
// remove it. The repackaged archive is what gets hashed and stored, so the
// stored source is the font as the vendor shipped it, with our additions gone.
async function stripAndRepackage(zipPath, payload, onProgress) {
  const sources = require('./soundFontSources');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-curation-'));
  const treeDir = path.join(tmpDir, 'tree');
  fs.mkdirSync(treeDir, { recursive: true });
  let zip;
  try {
    zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
    const entries = await zip.entries();
    const keys = Object.keys(entries).filter((k) => {
      const e = entries[k];
      if (!e.name || e.name === '/' || e.isDirectory) return false;
      if (e.name === SIDECAR_NAME) return false;
      return true;
    });
    // Payload files (the receipts that rode along) are extracted OUT of the way
    // rather than discarded — they are the point of carrying them — but they do
    // not go into the tree that gets rehashed, so they cannot affect identity.
    const payloadDir = path.join(tmpDir, 'payload');
    const _isPayload = (rel) => rel === PAYLOAD_DIR || rel.startsWith(`${PAYLOAD_DIR}/`);
    // ⚠️ THE DENOMINATOR MUST COUNT ONLY WHAT THE COUNTER COUNTS. `done` is
    // incremented for CONTENT files only, so totalling every key made the strip
    // half stop short of its 50% by exactly the number of receipts riding along.
    // Invisible on a 1,500-file bundle, obvious on a ten-file font with two
    // proofs of purchase, where the bar parks at 40% and then jumps.
    const contentTotal = keys.reduce(
      (n, k) => n + (_isPayload(entries[k].name.replace(/\\/g, '/')) ? 0 : 1), 0);
    let done = 0;
    for (const k of keys) {
      const rel = entries[k].name.replace(/\\/g, '/');
      const isPayload = _isPayload(rel);
      const root = isPayload ? payloadDir : treeDir;
      const dest = path.resolve(root, rel);
      if (isPayload) {
        if (!dest.startsWith(path.resolve(payloadDir) + path.sep)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await zip.extract(entries[k].name, dest);
        continue;
      }
      // Zip-slip guard: an entry that resolves outside the tree is not ours.
      if (!dest.startsWith(path.resolve(treeDir) + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await zip.extract(entries[k].name, dest);
      done++;
      // currentFile keeps the line under the bar alive through the strip half;
      // without it the filename freezes while only the bar moves, which reads as
      // stuck on one file rather than working through many.
      if (onProgress) onProgress({ phase: 'curation-strip', fileCount: done, totalFiles: contentTotal, currentFile: rel });
    }
    await zip.close();
    zip = null;
    const outPath = path.join(tmpDir, path.basename(zipPath));
    await sources.zipFolderToFile(treeDir, outPath, (p) => onProgress && onProgress({
      phase: 'curation-repack', bytesDone: p.bytesProcessed, totalBytes: p.totalBytes, currentFile: p.currentFile,
    }));
    try { fs.rmSync(treeDir, { recursive: true, force: true }); } catch {}
    return { zipPath: outPath, tmpDir, payloadDir };
  } catch (err) {
    if (zip) { try { await zip.close(); } catch {} }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

// Apply the source half after the import has landed: the curated fields, and
// the attachments the sidecar carried. Attachments are re-stored from the
// files that rode along inside the zip, which the caller extracted to attDir.
// Content-addressed, so a receipt already in the store is reused rather than
// duplicated.
function applySourceCuration(userData, uuid, payload, attDir) {
  if (!payload) return { ok: true, applied: 0, attachments: 0 };
  const sources = require('./soundFontSources');
  const attachMod = require('./soundFontAttachments');
  let applied = 0;
  const updates = _pick(payload.source, SOURCE_FIELDS);
  if (Object.keys(updates).length > 0) {
    try {
      const r = sources.updateSourceMeta(userData, uuid, updates);
      if (r && r.ok) applied = Object.keys(updates).length;
    } catch {}
  }
  let attached = 0;
  if (attDir) {
    for (const a of (payload.attachments || [])) {
      const abs = path.join(attDir, ...String(a.file || '').split('/'));
      if (!fs.existsSync(abs)) continue;
      try {
        const r = attachMod.addAttachmentToSources(userData, {
          filePath: abs, label: a.label || '', uuids: [uuid],
        });
        if (r && r.ok) attached++;
      } catch {}
    }
  }
  return { ok: true, applied, attachments: attached };
}

// Recreate the customized fonts that rode the export ([B-311]). Runs at
// source-commit time, while the payload files the strip extracted are still on
// disk (payloadRootDir = the stripAndRepackage payloadDir). Each record becomes
// a real library entry via createEntry's folderSource path — the [B-304]
// primitive built for exactly this — so it points at the same source subtree it
// diverged from and the Customized marker comes back on its own from the diff.
//
// The entry's own curation is passed as caller metadata (createEntry's
// caller-wins rule), and its provenance is patched onto the meta AFTERWARDS —
// createEntry stamps the candidatePath-keyed provenance block at build time,
// which is the STOCK copy's history whenever both copies shared a path. "No
// trace of me ever deleting and bringing it back" applies to the customized
// row's own dates, so its record-level values win last.
//
// Never fatal, per the house rule for everything curation: a font that imports
// without its customized sibling is still an imported font.
//
// `picks` (optional): the review form's per-row selection — [{ index, name }].
// The single-import doors DEFER this restore to Add to Library so the user
// decides, row by row, what comes back (his call, 2026-09-08: "this shouldn't
// be put in my library until the user says import and only if checked").
// index addresses payload.customized; name is the form's edited value, and the
// collision suffix below still backstops it. No picks = restore everything
// with the sidecar's names (the bulk door, which commits post-review anyway).
async function restoreCustomizedEntries(userData, uuid, payload, payloadRootDir, picks) {
  const none = { ok: true, restored: 0, names: [] };
  if (!payload || !Array.isArray(payload.customized) || payload.customized.length === 0) return none;
  if (!payloadRootDir) return none;
  const entriesMod = require('./soundFontEntries');
  const names = [];
  const pickByIndex = Array.isArray(picks)
    ? new Map(picks.map(p => [Number(p.index), p])) : null;
  for (let ci = 0; ci < payload.customized.length; ci++) {
    const c = payload.customized[ci];
    const pick = pickByIndex ? pickByIndex.get(ci) : undefined;
    if (pickByIndex && !pick) continue; // unchecked row: not brought back
    const relDir = String(c.dir || '');
    // The dir must live under our payload folder — a hand-edited sidecar
    // pointing elsewhere is not ours to follow.
    if (!relDir.startsWith(`${PAYLOAD_DIR}/`)) continue;
    const dirAbs = path.join(payloadRootDir, ...relDir.split('/'));
    let isDir = false;
    try { isDir = fs.statSync(dirAbs).isDirectory(); } catch {}
    if (!isDir) continue;
    // The sidecar's curated name wins over the folder-time entryName, same
    // precedence the candidate review gives it — unless the review form handed
    // an edited name on the pick, which outranks both (it is the name the user
    // is looking at). Collisions take the app-wide underscore suffix (the
    // exportEntryToFolder convention) — reachable when an export is imported
    // as a NEW source while the original entry survives.
    const base = (pick && typeof pick.name === 'string' && pick.name.trim())
      ? pick.name.trim()
      : (c.curation && typeof c.curation.name === 'string' && c.curation.name.trim())
        ? c.curation.name.trim()
        : (String(c.entryName || '').trim() || 'Customized font');
    let name = base;
    for (let n = 2; entriesMod.findEntryByName(userData, name); n++) name = `${base}_${n}`;
    const metadata = { ...(c.curation || {}) };
    delete metadata.name;
    let r = null;
    try {
      r = await entriesMod.createEntry({
        userData,
        sourceUuid: uuid,
        candidate: { path: c.candidatePath == null ? '' : c.candidatePath, name },
        name,
        metadata,
        folderSource: { folderPath: dirAbs },
      });
    } catch { r = null; }
    if (!r || !r.ok) continue;
    if (c.provenance && Object.keys(c.provenance).length) {
      try {
        const mp = path.join(entriesMod.entriesRoot(userData), r.name, 'meta.json');
        const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
        for (const f of ENTRY_PROV_FIELDS) if (c.provenance[f]) m[f] = c.provenance[f];
        fs.writeFileSync(mp, JSON.stringify(m, null, 2));
      } catch { /* dates are a restoration, never a blocker */ }
    }
    names.push(r.name);
  }
  return { ok: true, restored: names.length, names };
}

// The entry half. Returned as a metadata object for createEntry, which already
// takes one — so a re-imported font comes back with its tags, its style link
// and its demo URL without the review screen having to learn anything new.
// ⚠️ THE READERS AND THE WRITER TREAT A MISSING PATH DIFFERENTLY, ON PURPOSE.
// buildForSource skips an entry whose stored candidatePath is null, because a
// missing recorded value must not be invented into a root key. Here we hold a
// LIVE candidate, and everywhere else in the app a candidate with no path IS
// the archive root — `source.extractTo(candidate.path || '', ...)` is the
// established form. So nullish normalises to '' rather than bailing out.
// The previous `candidatePath == null` bail could never fire: the only caller
// already passed `candidate.path || ''`, so the guard read as a real
// distinction while doing nothing. Normalising here makes the two agree.
function _rootKey(candidatePath) {
  return candidatePath == null ? '' : candidatePath;
}

function entryCurationFor(payload, candidatePath) {
  if (!payload || !payload.entries) return null;
  const block = payload.entries[_rootKey(candidatePath)];
  if (!block) return null;
  const out = _pick(block, ENTRY_FIELDS);
  // The name is the review's to decide — it is shown, edited and deduped
  // there. Handing it back as metadata would fight that.
  delete out.name;
  return Object.keys(out).length ? out : null;
}

// ⚠️ `suggestedNameFor` LIVED HERE AND NEVER HAD A CALLER (removed 2026-09-03).
// It was written for the import review to offer the sidecar's name, and the
// review was never wired to it - so a curated re-import came back with the
// detector's raw folder names (`1.blue`, `2.orange`, `3.red`) instead of the
// user's own. The review now reads the payload's entry blocks directly, since
// they are plain JSON and it already has them in hand, which makes a backend
// helper for one field lookup pure indirection. Deleted rather than left
// standing: dead code that describes a feature nobody can reach reads as
// evidence the feature exists.

module.exports = {
  SIDECAR_NAME, PAYLOAD_DIR, SCHEMA_VERSION,
  SOURCE_FIELDS, ENTRY_FIELDS,
  buildForSource, writeIntoTree, injectIntoZip, peekZip, stripAndRepackage, summarize,
  applySourceCuration, entryCurationFor, entryProvenanceFor, restoreCustomizedEntries,
  ENTRY_PROV_FIELDS,
};
