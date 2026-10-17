// A common folder is a working copy of a source, the same as a font entry.      [B-493]
//
// The comparison rule lives in one place, `diffAgainstSource`, and both kinds call it. These
// cases cover the rule directly, the common-side reader on top of it, and the temp-file
// exclusion that keeps a transient from being reported as the user's own edit.
//
// Everything runs against a temporary tree. Nothing reads or writes a real library.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const fh = require(path.join(__dirname, '..', 'soundFontFileHash.js'));
const common = require(path.join(__dirname, '..', 'soundFontCommon.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const rec = (relPath, fileHash) => ({ relPath, fileHash, size: 1 });

// ── the shared rule ───────────────────────────────────────────────────────────────
{
  const src = [rec('common/a.wav', 'h1'), rec('common/b.wav', 'h2'), rec('fonts/x.wav', 'zz')];

  let d = fh.diffAgainstSource([rec('a.wav', 'h1'), rec('b.wav', 'h2')], src, 'common');
  ok('an untouched working copy differs in nothing',
     d.known && d.added === 0 && d.removed === 0 && d.changed === 0, JSON.stringify(d));

  d = fh.diffAgainstSource([rec('a.wav', 'h1'), rec('b.wav', 'h2'), rec('c.wav', 'h3')], src, 'common');
  ok('a file the source does not have is an addition', d.added === 1 && d.addedKeys[0] === 'c.wav');

  d = fh.diffAgainstSource([rec('a.wav', 'h1')], src, 'common');
  ok('a file the source has and the copy does not is a removal',
     d.removed === 1 && d.removedKeys[0] === 'b.wav');

  d = fh.diffAgainstSource([rec('a.wav', 'DIFFERENT'), rec('b.wav', 'h2')], src, 'common');
  ok('a different hash at the same path is a change',
     d.changed === 1 && d.changedKeys[0] === 'a.wav');

  // THE PREFIX IS WHAT KEEPS THE BUCKETS APART. `fonts/x.wav` sits in the same source and must
  // never be compared against a common's files.
  d = fh.diffAgainstSource([rec('a.wav', 'h1'), rec('b.wav', 'h2')], src, 'common');
  ok('records outside the subtree are not counted as removals', d.removed === 0,
     'a sibling bucket in the same source would otherwise read as deleted content');

  // Empty-dir markers: recorded by the item walker, never by the source walker. Diffing them
  // verbatim reports every vendor's empty effect folder as an addition. [B-342]
  d = fh.diffAgainstSource([rec('a.wav', 'h1'), rec('b.wav', 'h2'), rec('bgndrag', '<empty>')],
                           src, 'common');
  ok('an empty directory is not an addition', d.added === 0, JSON.stringify(d));

  d = fh.diffAgainstSource([rec('a.wav', 'h1')], src, 'nothing-here');
  ok('no source records under the subtree answers UNKNOWN, not unchanged', !d.known,
     'unknown and unchanged must not collapse: one shows nothing, the other shows a verdict');

  ok('a missing manifest answers UNKNOWN', !fh.diffAgainstSource(null, src, 'common').known);
}

// ── the temp-file exclusion, against real files on disk ───────────────────────────
// The restore deduper links to `<name>.dedupe-tmp` and renames. A rename that fails leaves the
// temp behind, where it reads as a file the source does not have. One survived on a real
// library from 2026-10-07 and would have reported that common as customized.
{
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'b493-tmp-'));
  fs.writeFileSync(path.join(r, 'hum.wav'), 'aaa');
  fs.writeFileSync(path.join(r, 'boot.wav'), 'bbb');
  const clean = fh.collectFileRecords(r).map(x => x.relPath).sort();

  fs.writeFileSync(path.join(r, 'mexit.wav.dedupe-tmp'), 'ccc');
  const withTmp = fh.collectFileRecords(r).map(x => x.relPath).sort();

  ok('a leftover dedupe temp is not recorded as content',
     JSON.stringify(withTmp) === JSON.stringify(clean),
     `clean=${JSON.stringify(clean)} withTmp=${JSON.stringify(withTmp)}`);

  // Nested, because the deduper writes beside whatever file it was linking.
  fs.mkdirSync(path.join(r, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(r, 'sub', 'x.wav.dedupe-tmp'), 'ddd');
  ok('and it is excluded at depth too, not only at the root',
     !fh.collectFileRecords(r).some(x => x.relPath.endsWith('.dedupe-tmp')));

  // The control: an ordinary file with a similar name is still content.
  fs.writeFileSync(path.join(r, 'dedupe-tmp.wav'), 'eee');
  ok('a real file whose name merely contains the word is kept',
     fh.collectFileRecords(r).some(x => x.relPath === 'dedupe-tmp.wav'),
     'the exclusion is a suffix, not a substring');

  fs.rmSync(r, { recursive: true, force: true });
}

// ── the common-side reader ────────────────────────────────────────────────────────
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b493-'));
  const SF = path.join(root, 'soundFonts');
  const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const SRC = 'ffffffff-1111-2222-3333-444444444444';
  const cDir = path.join(SF, 'common', UUID);
  fs.mkdirSync(path.join(cDir, 'files'), { recursive: true });
  fs.mkdirSync(path.join(SF, 'sources', SRC), { recursive: true });
  fs.mkdirSync(path.join(SF, '.filehashes', 'commons'), { recursive: true });
  fs.mkdirSync(path.join(SF, '.filehashes', 'sources'), { recursive: true });

  fs.writeFileSync(path.join(cDir, 'files', 'a.wav'), 'aaa');
  fs.writeFileSync(path.join(cDir, 'files', 'b.wav'), 'bbb');
  const writeMeta = (extra = {}) => fs.writeFileSync(path.join(cDir, 'meta.json'),
    JSON.stringify(Object.assign({
      schemaVersion: 1, uuid: UUID, name: 'Voicepack_Test',
      sourceUuid: SRC, sourceSubPath: 'common',
    }, extra), null, 2));
  writeMeta();

  // The source manifest is authored to MATCH what the walker will record for the files above,
  // so "unchanged" is a real agreement rather than two empty sets.
  const liveRecs = fh.collectFileRecords(path.join(cDir, 'files'));
  fh.writeFileHashManifest(path.join(SF, '.filehashes', 'sources', `${SRC}.json`),
    liveRecs.map(x => rec(`common/${x.relPath}`, x.fileHash)));

  let r = common.getCommonCustomization(root, UUID);
  ok('an untouched common reports not customized',
     r.known && r.customized === false, JSON.stringify(r));

  // Edit it. The reader must notice without being told the content changed - the recompute is
  // driven by the live file count and byte total, not by a flag a writer might forget to set.
  fs.writeFileSync(path.join(cDir, 'files', 'c.wav'), 'ccc');
  r = common.getCommonCustomization(root, UUID);
  ok('adding a file makes it customized, with no dirty flag set by hand',
     r.known && r.customized === true && r.added === 1, JSON.stringify(r));

  // And the temp file must not do the same thing.
  fs.rmSync(path.join(cDir, 'files', 'c.wav'));
  fs.writeFileSync(path.join(cDir, 'files', 'c.wav.dedupe-tmp'), 'ccc');
  r = common.getCommonCustomization(root, UUID);
  ok('a leftover temp does NOT make it customized',
     r.known && r.customized === false, `${JSON.stringify(r)} - this is the false positive`);
  fs.rmSync(path.join(cDir, 'files', 'c.wav.dedupe-tmp'));

  // THE STAMP, which is what makes a list able to ask. A second read must come back from
  // the stamp rather than re-deriving, and it must still be the right answer.
  r = common.getCommonCustomization(root, UUID);
  const stamped = JSON.parse(fs.readFileSync(path.join(cDir, 'meta.json'), 'utf8')).customization;
  ok('the answer is stamped onto the common',
     !!stamped && stamped.v === 1 && stamped.srcUuid === SRC && !!stamped.forHash,
     JSON.stringify(stamped));
  ok('and a repeat read comes back cached with the same verdict',
     r.cached === true && r.customized === false, JSON.stringify(r));

  // SELF-INVALIDATING, which is the whole reason it is safe to cache. Change the content and
  // the stamp must not be believed - a cache that outlives its subject is worse than none.
  fs.writeFileSync(path.join(cDir, 'files', 'd.wav'), 'ddd');
  r = common.getCommonCustomization(root, UUID);
  ok('a content change invalidates the stamp rather than being masked by it',
     r.known && r.customized === true && r.added === 1 && !r.cached, JSON.stringify(r));
  fs.rmSync(path.join(cDir, 'files', 'd.wav'));
  r = common.getCommonCustomization(root, UUID);
  ok('and removing it again returns to not customized',
     r.known && r.customized === false, JSON.stringify(r));

  // Unknowns must not read as "unchanged".
  writeMeta({ sourceUuid: undefined });
  ok('a common with no source answers UNKNOWN',
     common.getCommonCustomization(root, UUID).known === false);
  writeMeta();
  fs.rmSync(path.join(SF, '.filehashes', 'sources', `${SRC}.json`), { force: true });
  ok('a missing source manifest answers UNKNOWN',
     common.getCommonCustomization(root, UUID).known === false);
  ok('an unknown uuid answers UNKNOWN', common.getCommonCustomization(root, 'nope').known === false);

  fs.rmSync(root, { recursive: true, force: true });
}

// ── duplicate: two modes, and they must produce DIFFERENT bytes ───────────────────
// The whole reason "Duplicate from source" earns a menu slot is that it disagrees with
// "Duplicate" on a customized folder. A test that only checks both succeed would pass with
// mode ignored entirely, which is exactly the defect worth catching.
async function duplicateChecks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b493-dup-'));
  const SF = path.join(root, 'soundFonts');
  const UUID = '11111111-2222-3333-4444-555555555555';
  const SRC = '66666666-7777-8888-9999-aaaaaaaaaaaa';
  const cDir = path.join(SF, 'common', UUID);
  const srcTree = path.join(SF, 'sources', SRC, 'source', 'common');

  fs.mkdirSync(path.join(cDir, 'files'), { recursive: true });
  fs.mkdirSync(srcTree, { recursive: true });
  // the source as shipped
  fs.writeFileSync(path.join(srcTree, 'hum.wav'), 'vendor-hum');
  fs.writeFileSync(path.join(srcTree, 'boot.wav'), 'vendor-boot');
  fs.writeFileSync(path.join(SF, 'sources', SRC, 'meta.json'),
    JSON.stringify({ uuid: SRC, format: 'folder' }, null, 2));
  // the working copy, customized: one vendor file edited, one file added
  fs.writeFileSync(path.join(cDir, 'files', 'hum.wav'), 'MY-EDIT');
  fs.writeFileSync(path.join(cDir, 'files', 'boot.wav'), 'vendor-boot');
  fs.writeFileSync(path.join(cDir, 'files', 'mine.wav'), 'MY-FILE');
  fs.writeFileSync(path.join(cDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1, uuid: UUID, name: 'Pack', sourceUuid: SRC, sourceSubPath: 'common',
  }, null, 2));

  const read = (d, f) => { try { return fs.readFileSync(path.join(d, 'files', f), 'utf8'); } catch { return null; } };
  const dirOf = (uuid) => path.join(SF, 'common', uuid);

  const a = await common.duplicateCommon(root, UUID, 'Copy A', { mode: 'current' });
  ok('duplicate (current) succeeds', !!(a && a.ok), JSON.stringify(a));
  ok('and carries the edits', read(dirOf(a.uuid), 'hum.wav') === 'MY-EDIT'
     && read(dirOf(a.uuid), 'mine.wav') === 'MY-FILE');

  const b = await common.duplicateCommon(root, UUID, 'Copy B', { mode: 'source' });
  ok('duplicate from source succeeds', !!(b && b.ok), JSON.stringify(b));
  ok('and does NOT carry the edits', read(dirOf(b.uuid), 'hum.wav') === 'vendor-hum',
     'mode ignored means this reads MY-EDIT and the menu item is a lie');
  ok('nor the added file', read(dirOf(b.uuid), 'mine.wav') === null);
  ok('while still carrying what the vendor shipped', read(dirOf(b.uuid), 'boot.wav') === 'vendor-boot');

  // Both stay tied to the same immutable source, so neither delete can strand the other.
  const bMeta = JSON.parse(fs.readFileSync(path.join(dirOf(b.uuid), 'meta.json'), 'utf8'));
  ok('the duplicate references the same source', bMeta.sourceUuid === SRC
     && bMeta.sourceSubPath === 'common', JSON.stringify(bMeta));

  // A common with no stored source cannot offer the mode at all.
  fs.writeFileSync(path.join(cDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1, uuid: UUID, name: 'Pack',
  }, null, 2));
  const c = await common.duplicateCommon(root, UUID, 'Copy C', { mode: 'source' });
  ok('a common with no stored source refuses, and says why',
     !!(c && c.ok === false && /no stored source/i.test(c.error || '')), JSON.stringify(c));

  fs.rmSync(root, { recursive: true, force: true });
}

duplicateChecks().catch((err) => { failures++; console.log('FAIL  duplicate checks threw', err); })
  .then(() => {
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nall B-493 customization checks passed');
    process.exit(failures ? 1 : 0);
  });
