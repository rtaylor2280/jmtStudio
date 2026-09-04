// createEntry's folder-attach path - attaching a folder on disk as a VERSION of
// a font that is already in the library. [B-304]
//
// The reason this is worth a test rather than a read-through: the whole design
// rests on ONE claim, that swapping where the bytes come from swaps nothing
// else. Identity (sourceUuid, candidatePath) has to keep pointing at the source
// subtree the anchor came from, because that is what the Customized marker
// diffs against - and a wrong candidatePath does not fail loudly, it produces a
// font that reports confidently on somebody else's files.
//
// The dangerous direction throughout is a SILENT success: an entry that looks
// created and correct while holding the wrong tree, or claiming a file count
// that disagrees with the number the dialog just showed the user.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const soundFontEntries = require('../soundFontEntries');
const soundFontSources = require('../soundFontSources');

let failures = 0;

function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

// A folder-format source is just a directory plus a meta.json, which is what
// makes an end-to-end test affordable here: no zip, no import flow.
function setupSource(files) {
  const root     = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-folder-attach-'));
  const userData = path.join(root, 'userData');
  const uuid     = 'src-uuid-0001';
  const uuidDir  = path.join(soundFontSources.sourcesRoot(userData), uuid);
  fs.mkdirSync(uuidDir, { recursive: true });
  fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1,
    uuid,
    format: 'folder',
    originalName: 'Vendor Bundle',
    importedAt: '2026-08-01T00:00:00.000Z',
  }));
  write(path.join(uuidDir, 'source'), files);
  return { root, userData, uuid };
}

function entryFiles(userData, name) {
  const base = soundFontEntries.entriesRoot(userData);
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(path.join(base, name), '');
  return out.sort();
}

(async () => {
  // ── The main case: a folder attached as a version of an existing font ──────
  {
    console.log('attach a folder as a version of an existing font');
    const { root, userData, uuid } = setupSource({
      'Ahsoka/hum.wav':    'SOURCE-HUM',
      'Ahsoka/swing1.wav': 'SOURCE-SWING',
      'Obiwan/hum.wav':    'OTHER-FONT',
    });

    const anchor = await soundFontEntries.createEntry({
      userData, sourceUuid: uuid,
      candidate: { path: 'Ahsoka', name: 'Ahsoka' },
      name: 'Ahsoka',
    });
    check('the anchor entry is created', anchor && anchor.ok, anchor && anchor.error);

    // The folder the user picks. Deliberately DIFFERENT bytes from the source,
    // plus one extra file, so "did the right tree land" is answerable rather
    // than inferred.
    const picked = path.join(root, 'picked', 'Ahsoka_V2');
    write(picked, {
      'hum.wav':          'PICKED-HUM',
      'swing1.wav':       'PICKED-SWING',
      'swng/swng1.wav':   'PICKED-NESTED',
      'meta.json':        '{"stray":"library leftover"}',
    });

    const res = await soundFontEntries.createEntry({
      userData, sourceUuid: uuid,
      candidate: { path: anchor.meta.candidatePath, nested: !!anchor.meta.nested },
      name: 'Ahsoka_V2',
      folderSource: { folderPath: picked },
    });
    check('the attach succeeds', res && res.ok, res && res.error);
    if (!res || !res.ok) { failures++; return; }

    // Identity: the half that must come from the anchor.
    check('sourceUuid is the anchor\'s', res.meta.sourceUuid === uuid, res.meta.sourceUuid);
    check('candidatePath is the anchor\'s', res.meta.candidatePath === 'Ahsoka', res.meta.candidatePath);
    check('entryUuid is its own', res.meta.entryUuid !== anchor.meta.entryUuid);

    // Bytes: the half that must come from the picked folder. The failure this
    // catches is the one that looks fine on screen - a correctly-named entry
    // holding the SOURCE's files, i.e. a silent duplicate of the anchor.
    const files = entryFiles(userData, 'Ahsoka_V2');
    check('the picked folder\'s tree landed',
      JSON.stringify(files) === JSON.stringify(['hum.wav', 'meta.json', 'swing1.wav', 'swng/swng1.wav']),
      files.join(', '));
    const hum = fs.readFileSync(path.join(soundFontEntries.entriesRoot(userData), 'Ahsoka_V2', 'hum.wav'), 'utf8');
    check('the files are the PICKED bytes, not the source\'s', hum === 'PICKED-HUM', hum);

    // The stray root meta.json must not be counted. inspectFolderAsFont skips it
    // when it reports "N files" to the user, so counting it here would make the
    // entry disagree with the figure they approved one click earlier.
    check('the stray root meta.json is not counted', res.meta.contentFileCount === 3, String(res.meta.contentFileCount));
    check('bytes exclude it too',
      res.meta.contentTotalBytes === ('PICKED-HUM'.length + 'PICKED-SWING'.length + 'PICKED-NESTED'.length),
      String(res.meta.contentTotalBytes));
    // ...and the entry's own meta.json is the app's, written after the copy.
    const written = JSON.parse(fs.readFileSync(
      path.join(soundFontEntries.entriesRoot(userData), 'Ahsoka_V2', 'meta.json'), 'utf8'));
    check('the entry meta is ours, not the stray one', written.entryUuid === res.meta.entryUuid,
      JSON.stringify(written).slice(0, 60));

    // Stamping that must run identically on both paths - the whole argument for
    // an override on one line instead of a second entry writer.
    check('the content hash is stamped', !!written.contentHash);
    check('effects were scanned', Array.isArray(written.effects) && written.effects.length > 0,
      JSON.stringify(written.effects));
    check('createdAt is stamped', !!written.createdAt);

    // The anchor is untouched by any of it.
    const anchorHum = fs.readFileSync(path.join(soundFontEntries.entriesRoot(userData), 'Ahsoka', 'hum.wav'), 'utf8');
    check('the anchor still holds its own bytes', anchorHum === 'SOURCE-HUM', anchorHum);
  }

  // ── Refusals ──────────────────────────────────────────────────────────────
  {
    console.log('refusals');
    const { root, userData, uuid } = setupSource({ 'Ahsoka/hum.wav': 'SOURCE-HUM' });

    // Picking a folder that CONTAINS the library would have the walk copying its
    // own output. The guard exists because there is no recovering from it once
    // it starts, so it is checked rather than reasoned about.
    const ancestor = await soundFontEntries.createEntry({
      userData, sourceUuid: uuid,
      candidate: { path: 'Ahsoka' },
      name: 'Recursive',
      folderSource: { folderPath: userData },
    });
    check('an ancestor of the library is refused', ancestor && !ancestor.ok, JSON.stringify(ancestor).slice(0, 80));
    check('and nothing is left behind',
      !fs.existsSync(path.join(soundFontEntries.entriesRoot(userData), 'Recursive')));

    // A name already in use still loses, folder or not.
    await soundFontEntries.createEntry({
      userData, sourceUuid: uuid, candidate: { path: 'Ahsoka' }, name: 'Taken',
    });
    const picked = path.join(root, 'picked2');
    write(picked, { 'hum.wav': 'PICKED' });
    const dupe = await soundFontEntries.createEntry({
      userData, sourceUuid: uuid, candidate: { path: 'Ahsoka' }, name: 'Taken',
      folderSource: { folderPath: picked },
    });
    check('an existing name is refused', dupe && !dupe.ok && dupe.existing === true, JSON.stringify(dupe).slice(0, 80));
    const stillSource = fs.readFileSync(
      path.join(soundFontEntries.entriesRoot(userData), 'Taken', 'hum.wav'), 'utf8');
    check('and the existing entry is not overwritten', stillSource === 'SOURCE-HUM', stillSource);
  }

  // ── The claim the whole design rests on ───────────────────────────────────
  // Inheriting the anchor's candidatePath is only worth doing if the attached
  // entry then reports Customized against the RIGHT source subtree. Both
  // directions are checked, and `known` is asserted in both: an entry that
  // reports "unknowable" also reports customized:false, so a pass on the
  // identical case alone would prove nothing.
  {
    console.log('the attached entry diffs against the anchor\'s source subtree');
    const { root, userData, uuid } = setupSource({
      'Ahsoka/hum.wav':    'SOURCE-HUM',
      'Ahsoka/swing1.wav': 'SOURCE-SWING',
      'Obiwan/hum.wav':    'OTHER-FONT',
    });
    // Real hashes over the real tree - a hand-written manifest would only prove
    // the comparison can read what this test wrote.
    const { collectFileRecords, writeFileHashManifest } = require('../soundFontFileHash');
    const srcDir = path.join(soundFontSources.sourcesRoot(userData), uuid);
    writeFileHashManifest(
      path.join(srcDir, '.jmt-source-manifest.json'),
      collectFileRecords(path.join(srcDir, 'source')),
    );

    const anchor = await soundFontEntries.createEntry({
      userData, sourceUuid: uuid, candidate: { path: 'Ahsoka' }, name: 'Ahsoka',
    });

    // A folder holding exactly what the source subtree holds.
    const same = path.join(root, 'same');
    write(same, { 'hum.wav': 'SOURCE-HUM', 'swing1.wav': 'SOURCE-SWING' });
    const a = await soundFontEntries.createEntry({
      userData, sourceUuid: uuid,
      candidate: { path: anchor.meta.candidatePath, nested: !!anchor.meta.nested },
      name: 'Same', folderSource: { folderPath: same },
    });
    const cSame = soundFontEntries.getEntryCustomization(userData, a.name);
    check('an identical folder is knowable', cSame.known === true, JSON.stringify(cSame));
    check('and reports NOT customized', cSame.customized === false, JSON.stringify(cSame));

    // One changed file and one added file.
    const diff = path.join(root, 'diff');
    write(diff, { 'hum.wav': 'EDITED-HUM', 'swing1.wav': 'SOURCE-SWING', 'clash1.wav': 'NEW' });
    const b = await soundFontEntries.createEntry({
      userData, sourceUuid: uuid,
      candidate: { path: anchor.meta.candidatePath, nested: !!anchor.meta.nested },
      name: 'Diff', folderSource: { folderPath: diff },
    });
    const cDiff = soundFontEntries.getEntryCustomization(userData, b.name);
    check('a differing folder is knowable', cDiff.known === true, JSON.stringify(cDiff));
    check('and reports customized', cDiff.customized === true, JSON.stringify(cDiff));
    check('with the right counts', cDiff.changed === 1 && cDiff.added === 1 && cDiff.removed === 0,
      JSON.stringify(cDiff));
    // The diff is against Ahsoka/, not the whole bundle: Obiwan's file must not
    // show up as "removed". This is the assertion that a wrong candidatePath
    // would fail.
    check('the other font in the bundle is not counted', cDiff.removed === 0, JSON.stringify(cDiff));
  }

  // ── The archive path is unchanged ─────────────────────────────────────────
  // folderSource is absent on every other caller, and this is the assertion that
  // says so: same call, no override, files still come from the source.
  {
    console.log('the archive path is untouched when folderSource is absent');
    const { userData, uuid } = setupSource({ 'Ahsoka/hum.wav': 'SOURCE-HUM' });
    const res = await soundFontEntries.createEntry({
      userData, sourceUuid: uuid, candidate: { path: 'Ahsoka' }, name: 'Plain',
    });
    check('it still creates', res && res.ok, res && res.error);
    const hum = fs.readFileSync(path.join(soundFontEntries.entriesRoot(userData), 'Plain', 'hum.wav'), 'utf8');
    check('from the source', hum === 'SOURCE-HUM', hum);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
