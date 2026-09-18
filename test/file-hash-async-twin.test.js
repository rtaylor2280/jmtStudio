// [B-398] collectFileRecordsAsync must be the SAME WALK as collectFileRecords, not a lookalike.
//
// The async twin exists so a long import can yield to the event loop between files instead of
// blocking the main thread for seconds. That is only safe if it produces byte-identical records:
// these feed content hashes, dedup decisions and the sync manifest, so a twin that disagreed by
// one record would silently change what the app thinks is identical.
//
// ⚠️ THE RULES ARE THE FRAGILE PART, not the recursion: root-only meta.json exclusion, the
// empty-dir marker, the directory whose only child was excluded, and the noise filter. The
// fixture below exercises every one of them ON PURPOSE — a tree of plain files in one flat folder
// would pass against almost any wrong implementation.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const fhm = require('../soundFontFileHash');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + detail : ''));
}

function mkTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-twin-'));
  const w = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  w('meta.json', '{"excluded":"at the root only"}');
  w('hum.wav', 'HUM-BYTES');
  w('swing/swing1.wav', 'SWING-ONE');
  w('swing/swing2.wav', 'SWING-TWO');
  w('nested/meta.json', '{"kept":"nested meta is real content"}');
  w('.DS_Store', 'noise');
  w('noisy/.DS_Store', 'the only child here is noise');
  fs.mkdirSync(path.join(root, 'genuinelyEmpty'), { recursive: true });
  return root;
}

// Same filter shape the import uses: truthy to INCLUDE.
const noiseFilter = (rel) => !/(^|\/)\.DS_Store$/.test(rel);

(async () => {
  const root = mkTree();

  const syncRecs  = fhm.collectFileRecords(root, null, noiseFilter);
  const asyncRecs = await fhm.collectFileRecordsAsync(root, null, noiseFilter);

  check('the fixture actually exercises the edge cases',
    syncRecs.some(r => r.fileHash === '<empty>')
      && syncRecs.some(r => r.relPath === 'nested/meta.json')
      && !syncRecs.some(r => r.relPath === 'meta.json')
      && !syncRecs.some(r => /\.DS_Store/.test(r.relPath)),
    'got: ' + JSON.stringify(syncRecs.map(r => r.relPath)));

  check('async twin returns identical records, in identical order',
    JSON.stringify(asyncRecs) === JSON.stringify(syncRecs),
    'sync : ' + JSON.stringify(syncRecs.map(r => r.relPath))
      + '\n     async: ' + JSON.stringify(asyncRecs.map(r => r.relPath)));

  // The digest is what dedup actually compares on, so assert at that level too.
  check('both fold to the same canonical digest',
    fhm.hashRecords(asyncRecs) === fhm.hashRecords(syncRecs));

  // onFile piggybacking (the wav corruption check rides this) must fire the same way.
  const seenSync = [], seenAsync = [];
  fhm.collectFileRecords(root, (rel) => seenSync.push(rel), noiseFilter);
  await fhm.collectFileRecordsAsync(root, (rel) => seenAsync.push(rel), noiseFilter);
  check('onFile fires for the same files in the same order',
    JSON.stringify(seenAsync) === JSON.stringify(seenSync),
    'sync : ' + JSON.stringify(seenSync) + '\n     async: ' + JSON.stringify(seenAsync));

  // Null contract: a missing path and a plain file both mean "no comparison available".
  check('missing path returns null on both',
    fhm.collectFileRecords(path.join(root, 'nope')) === null
      && (await fhm.collectFileRecordsAsync(path.join(root, 'nope'))) === null);
  check('a file (not a directory) returns null on both',
    fhm.collectFileRecords(path.join(root, 'hum.wav')) === null
      && (await fhm.collectFileRecordsAsync(path.join(root, 'hum.wav'))) === null);

  // ⭐ The point of the twin: it must actually hand control back. If it resolved on the microtask
  // queue instead of the event loop, a pending timer could never run mid-walk — which is exactly
  // the bug where a "fixed" import still freezes the window.
  let timerRan = false;
  setTimeout(() => { timerRan = true; }, 0);
  await fhm.collectFileRecordsAsync(root, null, noiseFilter);
  check('it yields to the EVENT LOOP, so pending timers run during the walk', timerRan,
    'a timer queued before the walk had still not run after it — the walk is not really yielding');

  console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
