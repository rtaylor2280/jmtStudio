// Library-wide content index — never store an identical wav twice.
// [B-315] + [B-316] + [B-317], built as one mechanism.
//
// Two claims are under test and they pull in opposite directions:
//   1. Content we already hold must be LINKED, not copied. That is the feature.
//   2. A link must only ever be made to bytes PROVEN to be the content claimed.
//
// The second is why most of these cases exist. Storing a duplicate costs disk;
// linking to the wrong file silently replaces someone's audio with someone
// else's, and the vendor's copy may be the only one that ever existed. So the
// index is allowed to be wrong — it is a cache — and the code is not allowed to
// trust it. The tampering cases below are the ones that would have caught that.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CI = require('../soundFontContentIndex');
const FH = require('../soundFontFileHash');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

function wav(payload) {
  const data = Buffer.from(payload);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii'); head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(44100, 24); head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const ino = (p) => { const s = fs.statSync(p); return `${s.dev}:${s.ino}`; };
const shared = (a, b) => ino(a) === ino(b);

function newUserData() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-ci-'));
  return path.join(root, 'userData');
}

// A stored source, with the per-file manifest the index is built from. Built
// directly on disk — none of this needs the import path to exist.
function makeSource(userData, uuid, files) {
  const dir = path.join(userData, 'soundFonts', 'sources', uuid);
  const src = path.join(dir, 'source');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    schemaVersion: 1, uuid, format: 'folder', originalName: `Bundle ${uuid}`,
  }));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(src, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  writeManifest(userData, 'sources', uuid, src);
  return src;
}

function makeEntry(userData, name, entryUuid, files) {
  const dir = path.join(userData, 'soundFonts', 'library', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 1, entryUuid, name }));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  writeManifest(userData, 'entries', entryUuid, dir);
  return dir;
}

function writeManifest(userData, kind, uuid, itemRoot) {
  const records = FH.collectFileRecords(itemRoot) || [];
  FH.writeFileHashManifest(
    path.join(userData, 'soundFonts', '.filehashes', kind, `${uuid}.json`),
    records, FH.hashRecords(records));
}

// An incoming file somewhere outside the library, as every add path sees one.
function incoming(userData, name, body) {
  const dir = path.join(userData, '..', 'incoming');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, body);
  return abs;
}

(function main() {

  {
    console.log('content we already hold is linked, not copied');
    const userData = newUserData();
    const src = makeSource(userData, 'src-a', { 'Proffie/hum.wav': wav('HUM'), 'Proffie/boot.wav': wav('BOOT') });
    const index = CI.buildIndex(userData);

    const inbox = incoming(userData, 'hum.wav', wav('HUM'));
    const dest = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'hum.wav');
    const r = CI.ingestFile({ index, srcAbs: inbox, destAbs: dest });

    check('it reports a link', r.ok && r.linked === true, JSON.stringify(r));
    check('and the destination shares an inode with what we held',
      shared(dest, path.join(src, 'Proffie/hum.wav')));
    check('and the bytes at the destination are right', sha(dest) === sha(inbox));
    check('the saving is counted', index.stats.bytesSaved > 0 && index.stats.linked === 1,
      JSON.stringify(index.stats));
  }

  {
    console.log('genuinely new content is written once and becomes linkable itself');
    const userData = newUserData();
    makeSource(userData, 'src-a', { 'Proffie/hum.wav': wav('HUM') });
    const index = CI.buildIndex(userData);

    const inbox = incoming(userData, 'quote.wav', wav('QUOTE-NEVER-SEEN'));
    const first = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'quote.wav');
    const r1 = CI.ingestFile({ index, srcAbs: inbox, destAbs: first });
    check('the first write is a copy', r1.ok && r1.linked === false, JSON.stringify(r1));

    // The second write of the SAME content in the SAME run must find the first.
    // This is what makes an internally-repetitive bundle land once rather than
    // once per copy — the index has to learn from its own writes.
    const second = path.join(userData, 'soundFonts', 'library', 'Ezra', 'quote.wav');
    const r2 = CI.ingestFile({ index, srcAbs: inbox, destAbs: second });
    check('the second write links to the first', r2.ok && r2.linked === true, JSON.stringify(r2));
    check('and the two share an inode', shared(first, second));
  }

  {
    console.log('⚠️ a stale index row does NOT authorise a link');
    // The dangerous case, and the only one that can lose his audio. Build the
    // index, then change the file it points at behind its back. A hit on hash H
    // now names a file that no longer contains H. Linking on the strength of
    // the row would put the WRONG SOUND at the destination and report success.
    const userData = newUserData();
    const src = makeSource(userData, 'src-a', { 'Proffie/hum.wav': wav('HUM') });
    const index = CI.buildIndex(userData);
    fs.writeFileSync(path.join(src, 'Proffie/hum.wav'), wav('SOMETHING-ELSE-ENTIRELY'));

    const inbox = incoming(userData, 'hum.wav', wav('HUM'));
    const dest = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'hum.wav');
    const r = CI.ingestFile({ index, srcAbs: inbox, destAbs: dest });

    check('it refuses the link and copies instead', r.ok && r.linked === false, JSON.stringify(r));
    check('⭐ the destination has the CONTENT THAT WAS ASKED FOR', sha(dest) === sha(inbox));
    check('and not the bytes the stale row pointed at',
      sha(dest) !== sha(path.join(src, 'Proffie/hum.wav')));
    check('the stale row is counted, not swallowed', index.stats.staleCandidates === 1,
      JSON.stringify(index.stats));
  }

  {
    console.log('⚠️ the destination is the file we were HANDED, never the one we were told about');
    // ingestFile once accepted a caller-supplied hash. Pass one that does not
    // describe srcAbs and, if the library holds THAT content, the destination
    // gets those bytes — the wrong sound, reported as a success. The argument is
    // gone; this case exists so it cannot come back. Note what the earlier
    // version of this test got wrong: it ALSO tampered with the candidate, so it
    // passed on the stale-row refusal while the real hazard sat live underneath.
    // The candidate here is deliberately intact, so only the right mechanism can
    // save it.
    const userData = newUserData();
    const src = makeSource(userData, 'src-a', { 'Proffie/hum.wav': wav('HUM') });
    const index = CI.buildIndex(userData);
    const humAbs = path.join(src, 'Proffie/hum.wav');

    const inbox = incoming(userData, 'other.wav', wav('COMPLETELY-DIFFERENT'));
    const dest = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'other.wav');
    const r = CI.ingestFile({ index, srcAbs: inbox, destAbs: dest, hash: sha(humAbs) });
    check('⭐ the destination holds the incoming bytes', sha(dest) === sha(inbox));
    check('and NOT the sound the bogus hash named', sha(dest) !== sha(humAbs));
    check('it is a copy, because this content is genuinely new', r.linked === false, JSON.stringify(r));
  }

  {
    console.log('dedup reaches ACROSS sources, not just within one [B-317]');
    const userData = newUserData();
    const a = makeSource(userData, 'src-a', { 'Proffie/clash1.wav': wav('CLASH') });
    makeSource(userData, 'src-b', { 'Proffie/other.wav': wav('OTHER') });
    const index = CI.buildIndex(userData);

    // A file arriving into source B whose content source A already holds.
    const inbox = incoming(userData, 'clash1.wav', wav('CLASH'));
    const dest = path.join(userData, 'soundFonts', 'sources', 'src-b', 'source', 'Proffie', 'clash1.wav');
    const r = CI.ingestFile({ index, srcAbs: inbox, destAbs: dest });
    check('it links across the source boundary', r.ok && r.linked === true, JSON.stringify(r));
    check('and shares an inode with the other vendor bundle',
      shared(dest, path.join(a, 'Proffie/clash1.wav')));
  }

  {
    console.log('content that lives only in an entry is still found');
    // Post-[B-309] an entry is usually pointers into its source, so indexing
    // entries looks redundant. It is not: an added file, or a nested-zip
    // extraction, exists in an entry and nowhere else. Missing it would copy
    // bytes we already hold.
    const userData = newUserData();
    makeSource(userData, 'src-a', { 'Proffie/hum.wav': wav('HUM') });
    const entry = makeEntry(userData, 'Ahsoka', 'entry-uuid-1', { 'custom.wav': wav('HAND-MADE') });
    const index = CI.buildIndex(userData);

    const inbox = incoming(userData, 'custom.wav', wav('HAND-MADE'));
    const dest = path.join(userData, 'soundFonts', 'library', 'Ezra', 'custom.wav');
    const r = CI.ingestFile({ index, srcAbs: inbox, destAbs: dest });
    check('it links to the entry-only file', r.ok && r.linked === true, JSON.stringify(r));
    check('and shares its inode', shared(dest, path.join(entry, 'custom.wav')));
  }

  {
    console.log('the pool gives sourceless content a home [B-316]');
    const userData = newUserData();
    makeSource(userData, 'src-a', { 'Proffie/hum.wav': wav('HUM') });
    const index = CI.buildIndex(userData);

    const inbox = incoming(userData, 'my-quote.wav', wav('MY-QUOTE'));
    const r = CI.storeInPool({ index, srcAbs: inbox, preferredName: 'my-quote.wav' });
    check('it is stored', r.ok && r.stored === true, JSON.stringify(r));
    check('under its own name, not its hash', r.name === 'my-quote.wav', r.name);
    check('in the pool', path.dirname(r.absPath) === CI.poolRoot(userData));
    check('with the right bytes', sha(r.absPath) === sha(inbox));

    // A font pointing at it is a link, exactly as a pointer into a source is.
    const dest = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'quote.wav');
    const r2 = CI.ingestFile({ index, srcAbs: inbox, destAbs: dest });
    check('and a font pointing at it links rather than copies', r2.linked === true, JSON.stringify(r2));
    check('sharing the pooled inode', shared(dest, r.absPath));
  }

  {
    console.log('the same sound added twice is one file, whichever door it came through');
    const userData = newUserData();
    const src = makeSource(userData, 'src-a', { 'Proffie/hum.wav': wav('HUM') });
    const index = CI.buildIndex(userData);

    const inbox = incoming(userData, 'hum-copy.wav', wav('HUM'));
    const r = CI.storeInPool({ index, srcAbs: inbox, preferredName: 'hum-copy.wav' });
    check('content a source already holds is NOT re-stored', r.ok && r.stored === false, JSON.stringify(r));
    check('and the caller is pointed at the copy we have',
      r.absPath === path.join(src, 'Proffie', 'hum.wav'), r.absPath);
    check('so nothing lands in the pool', !fs.existsSync(path.join(CI.poolRoot(userData), 'hum-copy.wav')));

    // Two genuinely different sounds that happen to share a name both survive.
    const one = incoming(userData, 'a.wav', wav('ONE'));
    const two = incoming(userData, 'b.wav', wav('TWO'));
    const p1 = CI.storeInPool({ index, srcAbs: one, preferredName: 'quote.wav' });
    const p2 = CI.storeInPool({ index, srcAbs: two, preferredName: 'quote.wav' });
    check('a name collision between different content is disambiguated',
      p1.name === 'quote.wav' && p2.name === 'quote (1).wav', `${p1.name} / ${p2.name}`);
    check('and both keep their own bytes',
      sha(p1.absPath) === sha(one) && sha(p2.absPath) === sha(two));
  }

  {
    console.log('a pooled file is kept while a font uses it and released when none does');
    const userData = newUserData();
    const index = CI.buildIndex(userData);
    const usedIn = incoming(userData, 'used.wav', wav('USED'));
    const orphan = incoming(userData, 'orphan.wav', wav('ORPHANED'));
    const used = CI.storeInPool({ index, srcAbs: usedIn, preferredName: 'used.wav' });
    const dead = CI.storeInPool({ index, srcAbs: orphan, preferredName: 'orphan.wav' });

    // One font takes a name for `used`. Nothing ever points at `dead`.
    const fontFile = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'used.wav');
    CI.ingestFile({ index, srcAbs: usedIn, destAbs: fontFile });

    const r = CI.releasePoolOrphans(userData);
    check('the unused one is released', !fs.existsSync(dead.absPath));
    check('the used one is kept', fs.existsSync(used.absPath));
    check('and the font still reads its sound', sha(fontFile) === sha(usedIn));
    check('the release is counted', r.removed === 1, JSON.stringify(r));

    // ⭐ And it is the LAST user that frees it, not the first deletion.
    fs.rmSync(fontFile);
    const r2 = CI.releasePoolOrphans(userData);
    check('once the last font is gone the file follows', !fs.existsSync(used.absPath) && r2.removed === 1,
      JSON.stringify(r2));
  }

  {
    console.log('the pool index reconciles with the folder rather than diverging from it');
    const userData = newUserData();
    const index = CI.buildIndex(userData);
    const inbox = incoming(userData, 'x.wav', wav('X'));
    CI.storeInPool({ index, srcAbs: inbox, preferredName: 'x.wav' });

    // A file dropped in by hand, and a record whose file was removed by hand.
    fs.writeFileSync(path.join(CI.poolRoot(userData), 'y.wav'), wav('Y'));
    fs.rmSync(path.join(CI.poolRoot(userData), 'x.wav'));

    const pool = CI.ensurePoolIndex(userData);
    const names = Object.values(pool.files).map(f => f.name).sort();
    check('the hand-dropped file is indexed and the vanished one dropped',
      names.length === 1 && names[0] === 'y.wav', JSON.stringify(names));

    // And a rebuilt library index can then link to it.
    const idx2 = CI.buildIndex(userData);
    const yIn = incoming(userData, 'y-again.wav', wav('Y'));
    const dest = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'y.wav');
    check('so it is a link target like anything else',
      CI.ingestFile({ index: idx2, srcAbs: yIn, destAbs: dest }).linked === true);
  }

  {
    console.log('a corrupt pool sidecar costs a rebuild, never a file');
    const userData = newUserData();
    const index = CI.buildIndex(userData);
    const inbox = incoming(userData, 'z.wav', wav('Z'));
    const stored = CI.storeInPool({ index, srcAbs: inbox, preferredName: 'z.wav' });
    fs.writeFileSync(path.join(CI.poolRoot(userData), '.jmt-pool.json'), '{ not json');

    const pool = CI.ensurePoolIndex(userData);
    check('the file is still there', fs.existsSync(stored.absPath));
    check('and it is back in the index', Object.values(pool.files).some(f => f.name === 'z.wav'),
      JSON.stringify(pool.files));
  }

  {
    console.log('a composite path is never offered as a link target');
    // "Grip/Proffie.zip/Proffie/hum.wav" is a manifest record for a file inside
    // an inner archive. It is not a file on disk, so it can only ever be a
    // failed link — and a failed link that fell back to a copy would be a silent
    // performance cliff rather than an error.
    const userData = newUserData();
    const src = path.join(userData, 'soundFonts', 'sources', 'src-a', 'source');
    fs.mkdirSync(path.join(src, 'Grip'), { recursive: true });
    fs.writeFileSync(path.join(src, 'Grip', 'Proffie.zip'), Buffer.from('PK-not-a-real-zip'));
    const body = wav('INNER');
    const innerHash = crypto.createHash('sha256').update(body).digest('hex');
    FH.writeFileHashManifest(
      path.join(userData, 'soundFonts', '.filehashes', 'sources', 'src-a.json'),
      [{ relPath: 'Grip/Proffie.zip/Proffie/hum.wav', size: body.length, fileHash: innerHash }],
      'aggregate');

    const index = CI.buildIndex(userData);
    check('the composite record is not in the index', !index.byHash.has(innerHash));
    const inbox = incoming(userData, 'hum.wav', body);
    const dest = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'hum.wav');
    const r = CI.ingestFile({ index, srcAbs: inbox, destAbs: dest });
    check('so the file is copied and correct', r.linked === false && sha(dest) === sha(inbox));
  }

  {
    console.log('an empty library ingests without an index to consult');
    const userData = newUserData();
    const index = CI.buildIndex(userData);
    const inbox = incoming(userData, 'first.wav', wav('FIRST'));
    const dest = path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'first.wav');
    const r = CI.ingestFile({ index, srcAbs: inbox, destAbs: dest });
    check('the very first file in a fresh library is copied cleanly',
      r.ok && r.linked === false && sha(dest) === sha(inbox), JSON.stringify(r));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
