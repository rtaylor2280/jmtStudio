// The predicate that decides whether a file gets READ AT ALL.        [B-005 item 7b, 2026-09-26]
//
// ⚠️⚠️ THIS HAD NO COVERAGE AND NOBODY KNEW, because it existed as four byte-identical copies
// rather than as a thing with a name. Proved on 2026-09-26 by gutting it to `return !!entry` and
// running the whole suite: 114 files, ZERO red. Every manifest test was passing on paths that
// never depended on the rule being right.
//
// ⭐⭐ WHAT IT COSTS TO GET WRONG, in both directions:
//   TOO LOOSE - a stale record is believed, the file is never re-read, and the card silently
//               stops matching what the app reports. That is the failure the manifest exists to
//               prevent, arriving through the manifest itself.
//   TOO TIGHT - every record is invalidated on every run, so a warm card re-hashes everything.
//               [B-173] measured that: 1 second becomes 15 on a reader, 4 seconds becomes 3
//               minutes through a board.
// Neither failure raises an error. Both look like the app working.
'use strict';

const sync = require('../sfSyncManifest');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const TOL = sync.MTIME_TOLERANCE_MS;
const rec = (size, mtime) => [size, mtime, 'deadbeef'];

ok('the tolerance is the FAT32 one', TOL === 2000,
   'two seconds is not a fudge factor - it is the granularity FAT32 stores modified times at. '
   + 'Changing it changes which files are trusted on every card in the world');

// ── The rule holds when nothing moved ─────────────────────────────────
ok('an exact match is valid', sync.entryValid(rec(100, 5000), 100, 5000) === true);

// ── SIZE is exact. No tolerance, ever. ────────────────────────────────
ok('⭐⭐ one byte of size difference invalidates',
   sync.entryValid(rec(100, 5000), 101, 5000) === false,
   'size is free to compare and it is the only cheap signal that content changed. A tolerance '
   + 'here would trust a record for a file that is provably not the one it describes');
ok('a smaller file invalidates too',
   sync.entryValid(rec(100, 5000), 99, 5000) === false);

// ── MTIME carries the tolerance, and the boundary is inclusive ────────
ok('⭐ a difference INSIDE the tolerance is still valid',
   sync.entryValid(rec(100, 5000), 100, 5000 + TOL - 1) === true,
   'FAT32 rounds to two seconds, so a file written by us and read back differs by up to that '
   + 'much without anyone touching it');
ok('⭐⭐ exactly the tolerance is valid - the boundary is INCLUSIVE',
   sync.entryValid(rec(100, 5000), 100, 5000 + TOL) === true,
   'an exclusive boundary re-hashes every file that landed exactly on the rounding edge, which '
   + 'on FAT32 is a large share of them');
ok('⭐⭐ one millisecond past it is NOT valid',
   sync.entryValid(rec(100, 5000), 100, 5000 + TOL + 1) === false,
   'past the storage granularity a difference is real - somebody changed the file');
ok('⭐ and it is symmetric: EARLIER by more than the tolerance also invalidates',
   sync.entryValid(rec(100, 5000 + TOL + 1), 100, 5000) === false,
   'Math.abs, not a subtraction - a file replaced with an OLDER timestamp is just as changed as '
   + 'one replaced with a newer one, and restoring from a backup does exactly that');
ok('earlier but inside the tolerance is still valid',
   sync.entryValid(rec(100, 5000 + TOL), 100, 5000) === true);

// ── Absent or malformed records are never valid ───────────────────────
// ⚠️ A record that cannot be understood must read as "re-read this file", never as "trust it".
for (const [label, entry] of [
  ['no entry at all', undefined],
  ['null', null],
  ['an empty array', []],
  ['a record with no mtime', [100]],
]) {
  ok(`⚠️ ${label} is not valid`, sync.entryValid(entry, 100, 5000) === false,
     'an unreadable record means the file has not been accounted for; treating it as valid '
     + 'skips the only read that would have noticed');
}

// ⚠️ A MISSING mtime FIELD MUST NOT BECOME A FREE PASS. `entry[1] || 0` turns undefined into 0,
// and 0 is within tolerance of 0 - so a malformed record would validate against a file whose
// mtime happened to be near the epoch. Only reachable with a hand-edited manifest, and the point
// of the size check is that it still has to agree.
ok('⚠️ a record missing its mtime does not validate against a size-matched file',
   sync.entryValid([100], 100, 0) === false,
   'the entry has no hash either, so trusting it would hand back `undefined` as a file hash');

console.log(failed ? `\n${failed} FAILED` : '\nentry-valid: all passing');
process.exit(failed ? 1 : 0);
