// Destination sync manifest.
//
// It stores a hash per file at an export destination, with the size and modified
// time that file had there afterwards. Comparison is per file, over only the
// files the library is writing, and mtime's single job is to say whether the
// user invalidated an entry.
//
// The dangerous direction is a false reuse: it would skip a copy and leave a
// stale card while telling nobody. So these prove that change is noticed, that
// every unknown resolves toward reading, and that the cost is PROPORTIONAL —
// one touched file costs one entry, not the folder it lives in.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const sync = require('../sfSyncManifest');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label);
  console.log('     expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function mkDest() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-sync-'));
}

// What a caller does after writing files: record what is now there.
function record(dest, item, entries) {
  return sync.mergeItem(dest, item, new Map(entries));
}

// ── round trip ─────────────────────────────────────────────────────────────

{
  const dest = mkDest();
  record(dest, 'Ahsoka', [
    ['boot.wav', [4, 1000, 'HASH-BOOT']],
    ['swing/swing1.wav', [8, 2000, 'HASH-SWING']],
  ]);
  const cache = sync.cacheFor(dest, 'Ahsoka');
  check('entries come back keyed by relative path',
    [cache.get('boot.wav'), cache.get('swing/swing1.wav')],
    [[4, 1000, 'HASH-BOOT'], [8, 2000, 'HASH-SWING']]);
}

{
  const dest = mkDest();
  check('no manifest yields an empty cache, so everything is read',
    sync.cacheFor(dest, 'Ahsoka').size, 0);
}

{
  const dest = mkDest();
  record(dest, 'Ahsoka', [['boot.wav', [4, 1000, 'H']]]);
  check('an item we never recorded yields an empty cache',
    sync.cacheFor(dest, 'Vader').size, 0);
}

// ── merge, not replace ─────────────────────────────────────────────────────

{
  // A comparison only consults the files the library is writing, so it has no
  // business discarding what is known about anything else.
  const dest = mkDest();
  record(dest, 'tracks', [
    ['mars.wav',  [10, 1000, 'H-MARS']],
    ['venus.wav', [20, 1000, 'H-VENUS']],
  ]);
  record(dest, 'tracks', [['mars.wav', [11, 2000, 'H-MARS-2']]]);
  const cache = sync.cacheFor(dest, 'tracks');
  check('the touched entry is updated', cache.get('mars.wav'), [11, 2000, 'H-MARS-2']);
  check('the untouched entry survives', cache.get('venus.wav'), [20, 1000, 'H-VENUS']);
}

{
  const dest = mkDest();
  record(dest, 'Ahsoka', [['boot.wav', [4, 1000, 'H-A']]]);
  record(dest, 'common', [['mmain.wav', [6, 1000, 'H-C']]]);
  check('items are independent (first)',
    sync.cacheFor(dest, 'Ahsoka').get('boot.wav'), [4, 1000, 'H-A']);
  check('items are independent (second)',
    sync.cacheFor(dest, 'common').get('mmain.wav'), [6, 1000, 'H-C']);
}

{
  const dest = mkDest();
  record(dest, 'tracks', [['mars.wav', [10, 1000, 'H']]]);
  sync.forgetItem(dest, 'tracks');
  check('a forgotten item is gone', sync.cacheFor(dest, 'tracks').size, 0);
}

// ── failing toward reading ─────────────────────────────────────────────────

{
  const dest = mkDest();
  record(dest, 'tracks', [['mars.wav', [10, 1000, 'H']]]);
  fs.writeFileSync(sync.manifestPath(dest), 'not json at all');
  check('an unreadable manifest yields nothing, so everything is read',
    sync.cacheFor(dest, 'tracks').size, 0);
}

// ── refusing to clobber what we could not read ─────────────────────────────
//
// Failing toward reading is only half of it. The other half is that a failed
// READ must never authorise a WRITE. Collapsing "unreadable" into "absent" let
// mergeItem rebuild from an empty object, so one bad read of a manifest holding
// sixty items left a manifest holding one — and every export afterwards paid to
// re-hash a destination that had already been recorded. (2026-08-01: observed on
// a card mounted through a board as mass storage; 61 items became 3.)
{
  const dest = mkDest();
  record(dest, 'many', [['a.wav', [1, 1000, 'A']]]);
  record(dest, 'others', [['b.wav', [2, 2000, 'B']]]);
  const corrupt = '{"version":1,"items":{ truncated';
  fs.writeFileSync(sync.manifestPath(dest), corrupt);

  check('merging into an unreadable manifest is refused',
    record(dest, 'third', [['c.wav', [3, 3000, 'C']]]), false);
  check('and the file on disk is left exactly as it was',
    fs.readFileSync(sync.manifestPath(dest), 'utf8'), corrupt);
}

{
  // An I/O failure that is not ENOENT must be treated the same way. A directory
  // where the manifest should be is the portable way to make the read throw.
  const dest = mkDest();
  fs.mkdirSync(sync.manifestPath(dest));
  check('a manifest that cannot be opened at all reads as unreadable',
    sync.readState(dest).state, 'unreadable');
  check('and merging into it is refused',
    record(dest, 'tracks', [['mars.wav', [10, 1000, 'H']]]), false);
}

{
  // The distinction that makes the refusal safe rather than paralysing: a
  // destination with no manifest is still a normal first export.
  const dest = mkDest();
  check('an absent manifest is absent, not unreadable', sync.readState(dest).state, 'absent');
  check('so the first write still lands',
    record(dest, 'tracks', [['mars.wav', [10, 1000, 'H']]]), true);
}

{
  const dest = mkDest();
  record(dest, 'tracks', [['mars.wav', [10, 1000, 'H']]]);
  const m = JSON.parse(fs.readFileSync(sync.manifestPath(dest), 'utf8'));
  m.version = 999;
  fs.writeFileSync(sync.manifestPath(dest), JSON.stringify(m));
  check('a manifest from a newer version yields nothing',
    sync.cacheFor(dest, 'tracks').size, 0);
}

{
  // A malformed row must not poison the rest of the table.
  const dest = mkDest();
  record(dest, 'tracks', [['mars.wav', [10, 1000, 'H']]]);
  const m = JSON.parse(fs.readFileSync(sync.manifestPath(dest), 'utf8'));
  m.items.tracks.files.push(['broken.wav']);        // too short
  m.items.tracks.files.push('nonsense');            // not even an array
  fs.writeFileSync(sync.manifestPath(dest), JSON.stringify(m));
  const cache = sync.cacheFor(dest, 'tracks');
  check('malformed rows are dropped, good ones survive',
    [cache.size, cache.get('mars.wav')], [1, [10, 1000, 'H']]);
}

{
  const dest = mkDest();
  check('merging nothing writes nothing', record(dest, 'tracks', []), false);
  check('and leaves no manifest behind', fs.existsSync(sync.manifestPath(dest)), false);
}

// ── the tolerance value is deliberate ──────────────────────────────────────

{
  // FAT32 keeps mtimes on 2-second boundaries, so callers compare with this
  // slack. If it ever changes, that is a decision, not a typo.
  check('FAT granularity tolerance is 2s', sync.MTIME_TOLERANCE_MS, 2000);
}

// -- atomic write -----------------------------------------------------------

{
  // A reader must never see a partial manifest. The write goes to a temp file
  // and is renamed into place, so a reader sees the old one or the new one.
  const dest = mkDest();
  record(dest, 'tracks', [['mars.wav', [10, 1000, 'H1']]]);
  record(dest, 'tracks', [['mars.wav', [11, 2000, 'H2']]]);
  check('the update landed', sync.cacheFor(dest, 'tracks').get('mars.wav'), [11, 2000, 'H2']);
  check('no temp file is left behind',
    fs.existsSync(sync.manifestPath(dest) + '.tmp'), false);
}

{
  // A stale temp from an earlier interruption must not be mistaken for the
  // manifest, and must be cleared rather than accumulating on the card.
  const dest = mkDest();
  fs.writeFileSync(sync.manifestPath(dest) + '.tmp', 'garbage from a killed run');
  record(dest, 'tracks', [['mars.wav', [10, 1000, 'H']]]);
  check('a stale temp does not survive the next write',
    fs.existsSync(sync.manifestPath(dest) + '.tmp'), false);
  check('and the real manifest is correct',
    sync.cacheFor(dest, 'tracks').get('mars.wav'), [10, 1000, 'H']);
}

console.log('');
if (failures) {
  console.error(failures + ' sync-manifest test(s) failed');
  process.exit(1);
}
console.log('all sync-manifest tests passed');
