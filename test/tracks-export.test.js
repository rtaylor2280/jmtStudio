// Shared tracks: planExport and additive export.
//
// The guarantee under all of it: NOTHING at the destination is ever deleted,
// including tracks the library has never heard of. A card is the user's, not a
// mirror of our library.
//
// A same-name file whose content differs is resolved per file by the caller,
// defaulting to Replace, because the shared tracks folder is the app's curated
// source for these files and a difference nearly always means the user updated
// theirs. Variant numbering (mars.wav -> mars2.wav) is deliberately NOT used:
// those work for font sounds because Proffie picks among them at random, but a
// preset names exactly ONE track path, so a numbered copy would never play.
//
// A content-comparing matchesAt used to live here, with six cases of its own.
// Both were removed 2026-08-27 (B-168): the ask-first redesign replaced it with
// existsAt, a single stat, and matchesAt sat behind a live IPC channel with no
// caller. The cases went with the code they tested rather than being kept as
// coverage of something nothing reaches.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const st = require('../soundFontSharedTracks');

let failures = 0;

function mkTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-tracks-'));
}

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

// libFiles land in the library's sharedTracks root; cardFiles land in
// <dest>/tracks (or nowhere when null).
function setup(libFiles, cardFiles) {
  const root     = mkTemp();
  const userData = path.join(root, 'userData');
  const dest     = path.join(root, 'card');
  const libDir   = path.join(userData, 'soundFonts', 'sharedTracks');
  fs.mkdirSync(libDir, { recursive: true });
  write(libDir, libFiles);
  if (cardFiles !== null) {
    const cardDir = path.join(dest, 'tracks');
    fs.mkdirSync(cardDir, { recursive: true });
    write(cardDir, cardFiles);
  }
  return { userData, dest, libDir, cardDir: path.join(dest, 'tracks') };
}

function check(label, actual, expected) {
  const ok = Object.entries(expected).every(([k, v]) => {
    const a = actual ? actual[k] : undefined;
    return Array.isArray(v) ? JSON.stringify(a) === JSON.stringify(v) : a === v;
  });
  if (ok) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label);
  console.log('     expected ' + JSON.stringify(expected));
  console.log('     actual   ' + JSON.stringify(actual));
}

const TRACKS = {
  'mars.wav':   'AAAA-mars',
  'venus.wav':  'BBBB-venus',
  'duel.wav':   'CCCC-duel',
};

// ----------------------------------------------------------------------

// ----------------------------------------------------------------------

(async () => {
  {
    // Nothing on the card yet: everything ships.
    const { userData, dest, cardDir } = setup(TRACKS, null);
    const r = await st.exportToFolderAdditive(userData, dest, {});
    check('empty destination gets every track',
      { ok: r.ok, added: r.added.length, unchanged: r.unchanged.length, kept: r.kept, replaced: r.replaced },
      { ok: true, added: 3, unchanged: 0, kept: [], replaced: [] });
    check('and they are really on disk',
      { n: fs.readdirSync(cardDir).length }, { n: 3 });
  }

  {
    // The steady state: same folder exported twice. Nothing is copied again.
    const { userData, dest } = setup(TRACKS, TRACKS);
    const r = await st.exportToFolderAdditive(userData, dest, {});
    check('an identical destination copies nothing',
      { ok: r.ok, added: r.added.length, unchanged: r.unchanged.length },
      { ok: true, added: 0, unchanged: 3 });
  }

  {
    // The point of additive: new tracks land, existing ones are untouched.
    const partial = { 'mars.wav': 'AAAA-mars' };
    const { userData, dest, cardDir } = setup(TRACKS, partial);
    const r = await st.exportToFolderAdditive(userData, dest, {});
    check('only the missing tracks are added',
      { ok: r.ok, added: r.added.length, unchanged: r.unchanged.length },
      { ok: true, added: 2, unchanged: 1 });
    check('the card now holds all three',
      { n: fs.readdirSync(cardDir).filter(f => f.endsWith('.wav')).length }, { n: 3 });
  }

  {
    // The plan step is read-only and is what lets the user decide before
    // anything is written.
    const changed = Object.assign({}, TRACKS, { 'mars.wav': 'ZZZZ-different' });
    delete changed['duel.wav'];
    const { userData, dest, cardDir } = setup(TRACKS, changed);
    const before = fs.readdirSync(cardDir).sort().join(',');
    const p = st.planExport(userData, dest);
    check('plan reports add / differ / unchanged',
      { ok: p.ok, toAdd: p.toAdd, differing: p.differing, unchanged: p.unchanged },
      { ok: true, toAdd: ['duel.wav'], differing: ['mars.wav'], unchanged: ['venus.wav'] });
    check('and plan writes nothing',
      { after: fs.readdirSync(cardDir).sort().join(',') }, { after: before });
  }

  {
    // Default behavior: a differing track is REPLACED with the library copy.
    // The library is the curated source for these files, so a difference nearly
    // always means the user updated theirs and expects it on the card.
    const changed = Object.assign({}, TRACKS, { 'mars.wav': 'ZZZZ-different' });
    const { userData, dest, cardDir } = setup(TRACKS, changed);
    const r = await st.exportToFolderAdditive(userData, dest, { replace: ['mars.wav'] });
    check('a differing track is replaced when chosen',
      { ok: r.ok, replaced: r.replaced, kept: r.kept }, { ok: true, replaced: ['mars.wav'], kept: [] });
    check('the library version is now on the card',
      { body: fs.readFileSync(path.join(cardDir, 'mars.wav'), 'utf8') }, { body: 'AAAA-mars' });
    check('and no variant-numbered copy is created',
      { has: fs.existsSync(path.join(cardDir, 'mars2.wav')) }, { has: false });
  }

  {
    // Declining leaves the card's copy alone, and it is reported so it cannot
    // quietly stay stale.
    const changed = Object.assign({}, TRACKS, { 'mars.wav': 'ZZZZ-different' });
    const { userData, dest, cardDir } = setup(TRACKS, changed);
    const r = await st.exportToFolderAdditive(userData, dest, { replace: [] });
    check('a differing track is kept when not chosen',
      { ok: r.ok, replaced: r.replaced, kept: r.kept }, { ok: true, replaced: [], kept: ['mars.wav'] });
    check("the card's own version survives untouched",
      { body: fs.readFileSync(path.join(cardDir, 'mars.wav'), 'utf8') }, { body: 'ZZZZ-different' });
  }

  {
    // Per file, not all-or-nothing.
    const changed = Object.assign({}, TRACKS, { 'mars.wav': 'ZZZZ-1', 'venus.wav': 'ZZZZ-2' });
    const { userData, dest, cardDir } = setup(TRACKS, changed);
    const r = await st.exportToFolderAdditive(userData, dest, { replace: ['venus.wav'] });
    check('one replaced, one kept',
      { replaced: r.replaced, kept: r.kept }, { replaced: ['venus.wav'], kept: ['mars.wav'] });
    check('mars kept the card version',
      { body: fs.readFileSync(path.join(cardDir, 'mars.wav'), 'utf8') }, { body: 'ZZZZ-1' });
    check('venus took the library version',
      { body: fs.readFileSync(path.join(cardDir, 'venus.wav'), 'utf8') }, { body: 'BBBB-venus' });
  }

  {
    // Nothing at the destination is ever removed, including files the library
    // has never heard of. A card is the user's, not a mirror of our library.
    const withStranger = Object.assign({}, TRACKS, { 'their-own.wav': 'EEEE-theirs' });
    const { userData, dest, cardDir } = setup(TRACKS, withStranger);
    const r = await st.exportToFolderAdditive(userData, dest, {});
    check('a track only the card has is left alone', { ok: r.ok }, { ok: true });
    check('and still exists afterwards',
      { has: fs.existsSync(path.join(cardDir, 'their-own.wav')) }, { has: true });
  }

  {
    // Non-wav files in the library are not tracks and must not ship.
    const noisy = Object.assign({}, TRACKS, { 'notes.txt': 'hello', '.jmt-hashes.json': '{}' });
    const { userData, dest, cardDir } = setup(noisy, null);
    const r = await st.exportToFolderAdditive(userData, dest, {});
    check('only wavs are exported',
      { ok: r.ok, added: r.added.length }, { ok: true, added: 3 });
    check('no sidecar or stray text file reaches the card',
      { n: fs.readdirSync(cardDir).filter(f => !f.endsWith('.wav')).length }, { n: 0 });
  }

  {
    const r = await st.exportToFolderAdditive('', '');
    check('missing arguments fail closed', r, { ok: false });
  }

  // -- the manifest, per file and self-healing ------------------------------

  // ⚠️⚠️ [B-402] THE COMPARE NO LONGER WRITES. It returns what it learned and the EXPORT writes
  // once, at the end, carrying it forward. His rule: "we gather all the information and at the very
  // end we drop a single manifest update based on what we learned along the way" — a question must
  // not mutate the thing it is asking about, which is the same principle the mass-storage guard is
  // built on. [B-358] set it in 2026-09-08 for one caller with a `writeCache:false` flag; this is
  // the same rule everywhere it was not applied.
  {
    const { userData, dest } = setup(TRACKS, TRACKS);
    const sync = require('../sfSyncManifest');
    const p1 = st.planExport(userData, dest);
    check('first pass classifies everything as unchanged',
      { unchanged: p1.unchanged.length, differing: p1.differing.length },
      { unchanged: 3, differing: 0 });
    check('⭐⭐ and it wrote NOTHING to the destination',
      { manifest: sync.read(dest) === null || sync.read(dest) === undefined }, { manifest: true });
    check('⭐ but it handed back what it hashed, so nothing is re-read later',
      { n: p1.observed instanceof Map ? p1.observed.size : -1 }, { n: 3 });
  }

  {
    // ⭐⭐ NOT EVEN THE EXPORT WRITES. It returns what the whole operation learned — the
    // compare's findings merged with the copies — and the CALLER commits once at the end.
    //
    // ⚠️⚠️ THE FIRST CUT WROTE PER EXPORTED ITEM AND SILENTLY DROPPED ANYTHING IT DID NOT COPY.
    // His dev test found it: 25 fonts exported, 24 written, "1 already identical" — and that one
    // was scanned, matched, and then absent from the manifest, so its hashes were re-read on
    // every later export. On a card kept in sync that is most of the card.
    const { userData, dest } = setup(TRACKS, TRACKS);
    const sync = require('../sfSyncManifest');
    const r = await st.exportToFolderAdditive(userData, dest);
    check('the export succeeded', { ok: !!r.ok }, { ok: true });
    check('⭐⭐ and it still wrote nothing itself',
      { manifest: !sync.read(dest) }, { manifest: true });
    check('⭐ it handed back one item of observations instead',
      { item: r.observedItem, n: Array.isArray(r.observed) ? r.observed.length : -1 },
      { item: 'tracks', n: 3 });

    // The caller's single commit is what puts it on disk.
    sync.mergeItems(dest, { [r.observedItem]: r.observed });
    const m = sync.read(dest);
    check('⭐⭐ the manifest appears only after the CALLER commits, with an entry per file',
      { n: m && m.items.tracks.files.length }, { n: 3 });
  }

  {
    // Only the invalidated file is re-read; the rest resolve from their entry.
    const { userData, dest, cardDir } = setup(TRACKS, TRACKS);
    st.planExport(userData, dest);
    const f = path.join(cardDir, 'mars.wav');
    fs.writeFileSync(f, 'ZZZZ-changed');
    const future = (Date.now() + 60000) / 1000;
    fs.utimesSync(f, future, future);
    const p2 = st.planExport(userData, dest);
    check('an invalidated entry is caught as differing',
      { differing: p2.differing.join(','), unchanged: p2.unchanged.length },
      { differing: 'mars.wav', unchanged: 2 });
  }

  {
    // Files the library is not writing are none of the comparison's business,
    // even when the manifest knows about them.
    const { userData, dest, cardDir } = setup(TRACKS, TRACKS);
    st.planExport(userData, dest);
    fs.writeFileSync(path.join(cardDir, 'stranger.wav'), 'not ours');
    const p2 = st.planExport(userData, dest);
    check('a file only the card has does not make anything differ',
      { differing: p2.differing.length, unchanged: p2.unchanged.length, toAdd: p2.toAdd.length },
      { differing: 0, unchanged: 3, toAdd: 0 });
  }

  // ⭐⭐ [B-402] A WRITE THAT CHANGES NOTHING IS STILL A WRITE, and on a card reached through
  // the board's mass storage it is a cycle bought with no information. mergeItem used to merge
  // and then write unconditionally, so a run where every file was a cache hit re-recorded what
  // was already there.
  // ⚠ Asserted on the FILE, not the return value: it returns true either way, because the
  // caller asked for the manifest to say this and it does.
  {
    const { dest } = setup(TRACKS, TRACKS);
    const sync = require('../sfSyncManifest');
    const obs = new Map([['a.wav', [10, 1000, 'h1']], ['b.wav', [20, 2000, 'h2']]]);
    sync.mergeItem(dest, 'tracks', obs);
    const mp = path.join(dest, 'jmt-studio-manifest.json');
    const before = fs.readFileSync(mp, 'utf8');
    const mtime = fs.statSync(mp).mtimeMs;
    sync.mergeItem(dest, 'tracks', new Map(obs));
    check('⭐⭐ re-recording identical data does not touch the file',
      { same: fs.readFileSync(mp, 'utf8') === before && fs.statSync(mp).mtimeMs === mtime },
      { same: true });
    sync.mergeItem(dest, 'tracks', new Map([['a.wav', [10, 1000, 'CHANGED']]]));
    const after = fs.readFileSync(mp, 'utf8');
    check('⚠️ but a real change still writes, and keeps the untouched sibling',
      { wrote: after !== before, kept: after.includes('b.wav') },
      { wrote: true, kept: true });
  }

  {
    // Entries for files we did not look at survive a later pass.
    const { userData, dest } = setup(TRACKS, TRACKS);
    const sync = require('../sfSyncManifest');
    st.planExport(userData, dest);
    sync.mergeItem(dest, 'tracks', new Map([['keepme.wav', [1, 2, 'abc']]]));
    st.planExport(userData, dest);
    const names = sync.read(dest).items.tracks.files.map(f => f[0]);
    check('an untouched entry is not discarded',
      { has: names.includes('keepme.wav') }, { has: true });
  }

  console.log('');
  if (failures) {
    console.error(failures + ' tracks-export test(s) failed');
    process.exit(1);
  }
  console.log('all tracks-export tests passed');
})();
