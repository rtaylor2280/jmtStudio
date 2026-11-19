/**
 * [BUG-031] The backup's "of files" is the footer's "of files", to the byte: the content pool, the
 * library's bookkeeping and the markers at a bucket's top level count in both.
 *
 * Run: node test/backup-files-match-footer.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../soundFontBackup');
const L = require('../soundFontLibrarySize');

let failures = 0;
const check = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-files-'));
  const sf = path.join(ud, 'soundFonts');
  const put = (rel, bytes) => {
    const p = path.join(sf, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes, 7));
    return p;
  };
  put('sources/u1/meta.json', 40);
  put('sources/u1/files/hum.wav', 1000);
  put('library/Kanan/hum.wav', 1200);
  put('library/Kanan/meta.json', 60);
  put('library/.seen-backfill-done', 24);
  put('common/c1/meta.json', 30);
  put('common/c1/files/mnum1.wav', 300);
  const track = put('pool/theme.wav', 5000);
  put('pool/.jmt-pool.json', 90);
  fs.mkdirSync(path.join(sf, 'sharedTracks'), { recursive: true });
  fs.linkSync(track, path.join(sf, 'sharedTracks', 'theme.wav'));
  fs.mkdirSync(path.join(sf, 'library', 'Kanan', 'tracks'), { recursive: true });
  fs.linkSync(track, path.join(sf, 'library', 'Kanan', 'tracks', 'theme.wav'));
  put('sharedTracks/.index.json', 12);
  put('.filehashes/u1.json', 80);
  put('_jmt_library_meta.json', 20);

  const footer = (await L.compute(ud)).apparent;
  const survey = await B.surveyLibraryAsync(ud, {});
  check('precondition: the bucket total leaves the pool and bookkeeping out', survey.totalBytes < footer,
    JSON.stringify({ total: survey.totalBytes, footer }));
  check('THE BACKUP\'S "OF FILES" IS THE FOOTER\'S, TO THE BYTE', survey.filesBytes === footer,
    JSON.stringify({ files: survey.filesBytes, footer }));
  check('and the quick survey agrees', B.surveyLibrary(ud).filesBytes === footer);
  const adjusted = B.applySkipAdjustment
    ? B.applySkipAdjustment(survey, { skipped: [], skippedItems: [{ bucket: 'library', bytes: 1200 }] })
    : null;
  if (adjusted) check('a dropped item comes off it too', adjusted.filesBytes === footer - 1200, JSON.stringify(adjusted));

  fs.rmSync(ud, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
