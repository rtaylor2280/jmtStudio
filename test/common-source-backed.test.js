// [B-327] Commons are sources: an immutable source underneath, an editable
// working copy on top, pooled against the whole library. These cases assert the
// contract ON DISK (inodes), the reference model (the orphan sweep must treat a
// common as a source owner), and both directions of cross-bucket linking.
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');
const E = require('../soundFontEntries.js');
const C = require('../soundFontCommon.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
function wav(body) {
  const data = Buffer.alloc(64 * 1024, body);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
function put(root, rel, buf) {
  const abs = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-b327-${n}-`));
const nlink = (p) => { try { return fs.statSync(p).nlink; } catch { return 0; } };

(async () => {
  {
    console.log('a common import is source-backed and its working copy is pooled');
    const userData = tmp('ud');
    const src = tmp('pack');
    put(src, 'Voicepack/mmain.wav', wav('M'));
    put(src, 'Voicepack/mnum1.wav', wav('1'));
    put(src, 'Voicepack/voicepack.ini', Buffer.from('version=2\r\n'));
    const r = await C.importCommonFromFolder(userData, path.join(src, 'Voicepack'), 'TestPack');
    check('imported', !!(r && r.ok), r && r.error);
    check('carries a sourceUuid', !!(r && r.sourceUuid), JSON.stringify(r));
    const filesDir = path.join(userData, 'soundFonts', 'common', r.uuid, 'files');
    check('working copy exists with the wavs at root',
      fs.existsSync(path.join(filesDir, 'mmain.wav')), filesDir);
    check('⭐ working-copy wavs are hardlinks into the source (nlink >= 2)',
      nlink(path.join(filesDir, 'mmain.wav')) >= 2,
      `nlink=${nlink(path.join(filesDir, 'mmain.wav'))}`);
    check('the manifest exists for the index',
      fs.existsSync(path.join(userData, 'soundFonts', '.filehashes', 'commons', `${r.uuid}.json`)));

    console.log('the orphan sweep leaves a common-owned source alone');
    const sweep = S.cleanupOrphanSources(userData);
    check('⭐ sweep removed nothing', sweep.removed.length === 0, JSON.stringify(sweep.removed));
    check('the source is still on disk',
      fs.existsSync(path.join(userData, 'soundFonts', 'sources', r.sourceUuid)));

    console.log('a font import links against the common (common -> font direction)');
    const fsrc = tmp('font');
    put(fsrc, 'MyFont/hum.wav', wav('M')); // same bytes as the common's mmain
    put(fsrc, 'MyFont/clsh1.wav', wav('C'));
    const fi = await S.importSource({ userData, sourcePath: path.join(fsrc, 'MyFont'), originalName: 'MyFont', metadata: {} });
    check('font source imported', fi.ok && !fi.isDuplicate, fi.error);
    check('⭐ it cross-linked against the common\'s content',
      !!(fi.crossLinked && fi.crossLinked.savedBytes > 0), JSON.stringify(fi.crossLinked));

    console.log('deleting the common leaves the source for the sweep, which then takes it');
    const del = C.deleteCommon(userData, r.uuid);
    check('common deleted', !!(del && del.ok));
    check('its manifest went with it',
      !fs.existsSync(path.join(userData, 'soundFonts', '.filehashes', 'commons', `${r.uuid}.json`)));
    const sweep2 = S.cleanupOrphanSources(userData);
    check('⭐ the now-unowned source is reclaimed', sweep2.removed.includes(r.sourceUuid),
      JSON.stringify(sweep2));
  }

  {
    console.log('duplicateCommon links instead of copying, and keeps the source alive');
    const userData = tmp('ud2');
    const src = tmp('pack2');
    put(src, 'P/mmain.wav', wav('Z'));
    put(src, 'P/voicepack.ini', Buffer.from('version=2\r\n'));
    const a = await C.importCommonFromFolder(userData, path.join(src, 'P'), 'PackA');
    check('imported', a.ok, a.error);
    const d = C.duplicateCommon(userData, a.uuid, 'PackB');
    check('duplicated', !!(d && d.ok), d && d.error);
    const aFile = path.join(userData, 'soundFonts', 'common', a.uuid, 'files', 'mmain.wav');
    const bFile = path.join(userData, 'soundFonts', 'common', d.uuid, 'files', 'mmain.wav');
    check('⭐ duplicate shares the inode', fs.statSync(aFile).ino === fs.statSync(bFile).ino);
    // Delete the ORIGINAL; the duplicate carries the sourceUuid, so the sweep
    // must leave the source standing.
    C.deleteCommon(userData, a.uuid);
    const sweep = S.cleanupOrphanSources(userData);
    check('⭐ source survives because the duplicate owns it too',
      !sweep.removed.includes(a.sourceUuid), JSON.stringify(sweep.removed));
  }

  {
    console.log('a zip common import dedups at the door against an existing source');
    const userData = tmp('ud3');
    const src = tmp('pack3');
    put(src, 'Q/mmain.wav', wav('Q'));
    put(src, 'Q/voicepack.ini', Buffer.from('version=2\r\n'));
    const zipDir = tmp('zip3');
    const zipPath = path.join(zipDir, 'Q.zip');
    await S.zipFolderToFile(path.join(src, 'Q'), zipPath);
    const a = await C.importCommonFromZip(userData, zipPath, 'QOne');
    check('first zip import ok', a.ok, a.error);
    const b = await C.importCommonFromZip(userData, zipPath, 'QTwo');
    check('second import of the same zip succeeds under a new name', b.ok, b.error);
    check('⭐ and reuses the SAME source instead of storing the archive twice',
      b.sourceUuid === a.sourceUuid && b.savings && b.savings.reusedSource === true,
      JSON.stringify({ a: a.sourceUuid, b: b.sourceUuid }));
  }

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error('SUITE ERROR:', e); process.exit(1); });
