// The destination manifest is borrowed once, and never served stale.  [B-173 point 1, 2026-09-24]
//
// ⭐⭐ MEASURED BEFORE IT WAS BUILT, as the entry demanded. A 25-font compare parsed the
// destination manifest TWENTY-FIVE TIMES — `cacheFor` is called once per font and each call read
// and parsed the whole file. On a real card that is a 505 KB file re-read over USB per font, roughly
// 12.3 MB for one scan, to answer questions about a document that cannot have changed mid-scan.
// After: ONE parse.
//
// ⚠️⚠️ THE DANGEROUS HALF IS NOT THE SPEED, IT IS STALENESS. A memo that serves a pre-write
// manifest makes a compare report "unchanged" for a file that DID change, and the export then
// skips it. That is a wrong answer about the user's card, not a slow one — so these tests are
// mostly about invalidation, not about the saving.
//
// ⚠️⚠️ AND THE STAT ALONE IS NOT ENOUGH ON FAT32, which is what SD cards are: mtime granularity is
// TWO SECONDS, so a write landing close behind the read before it can leave size and mtime both
// unchanged. The memo is therefore cleared explicitly by our own writes, with the stat as the
// backstop for anything outside this process.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const sync = require('../sfSyncManifest');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'b173-borrow-'));
const DEST = path.join(ROOT, 'dest');
fs.mkdirSync(DEST, { recursive: true });

const rec = (name, hash) => ({ [name]: [['a.wav', [10, 1000, hash]]] });

// ── 1. It is read once, not once per call ────────────────────────────
{
  sync.mergeItems(DEST, rec('Font', 'h1'));
  const real = fs.readFileSync;
  let parses = 0;
  fs.readFileSync = function (p, ...r) {
    if (String(p).endsWith(sync.MANIFEST_NAME)) parses++;
    return real.call(this, p, ...r);
  };
  for (let i = 0; i < 20; i++) sync.cacheFor(DEST, 'Font');
  fs.readFileSync = real;
  ok(`⭐ 20 lookups parse the manifest once (${parses})`, parses === 1,
     'this is the whole point of the entry: a 25-font scan parsed a 505 KB file 25 times');
}

// ── 2. ⚠️ OUR OWN WRITE INVALIDATES IT ───────────────────────────────
//
// The case FAT32's two-second mtime cannot be trusted to catch.
//
// ⚠️⚠️ THE COLLISION IS FORCED, NOT HOPED FOR. On NTFS mtime moves by 100 ns so the stat catches
// any write and this passes for the wrong reason — which it did, and a mutation removing the
// explicit invalidation went UNCAUGHT. FAT32 is what SD cards are and its mtime granularity is
// TWO SECONDS, so a real card genuinely can present an unchanged size and mtime after a write.
// The test reproduces that by restoring the timestamp and keeping the payload the same length.
{
  const p = sync.manifestPath(DEST);
  // ⚠️⚠️ THE TIMESTAMP IS PINNED ON BOTH SIDES, NOT RESTORED AFTERWARDS. Restoring with
  // `utimesSync(p, st0.atime, st0.mtime)` does NOT reproduce the original: mtimeMs carries
  // sub-millisecond precision that utimes cannot express, so ...862.8667 came back as ...863.
  // The stat then caught the write and the mutation that removes the explicit invalidation
  // passed — the check was green for the wrong reason. Pinning both reads to the same whole
  // second is what makes the collision real.
  const T = new Date(Math.floor(Date.now() / 1000) * 1000 - 60000);
  fs.utimesSync(p, T, T);
  const before = sync.cacheFor(DEST, 'Font').get('a.wav');   // memo stores THIS stat
  const st0 = fs.statSync(p);

  // OUR writer changes the value. 'XX' is the same length as 'h1', so the size is unchanged.
  sync.mergeItems(DEST, rec('Font', 'XX'));
  fs.utimesSync(p, T, T);                                    // same instant, exactly

  const st1 = fs.statSync(p);
  ok('  (the collision is real: identical size and mtime after a write)',
     st1.size === st0.size && st1.mtimeMs === st0.mtimeMs,
     'if these differ the stat alone catches the write and the case below proves nothing');

  const after = sync.cacheFor(DEST, 'Font').get('a.wav');
  ok('⭐⭐ a write is seen even when size and mtime cannot show it',
     before && after && before[2] === 'h1' && after[2] === 'XX',
     'serving the pre-write manifest makes a compare say "unchanged" for a file that changed, '
     + 'and the export silently skips it — on FAT32 the stat cannot be the only guard');
}

// ── 3. An outside write is caught by the stat ────────────────────────
//
// ⚠️ Simulates something other than this process rewriting the file — the case no borrow/release
// protocol of ours could notice. Size is changed so the check cannot depend on mtime resolution.
{
  // ⚠️ THE ON-DISK SHAPE IS FLAT: [relPath, size, mtime, hash]. The nested form
  // [relPath, [size, mtime, hash]] is the INPUT shape `mergeItems` accepts, and `cacheFor`
  // silently skips any record shorter than 4 — so writing the wrong one here produced an empty
  // Map and read as a code failure. Checked against `cacheFor` rather than assumed, after the
  // first version of this test did exactly that.
  const p = sync.manifestPath(DEST);
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  m.items.Font.files = [['a.wav', 10, 1000, 'OUTSIDE'], ['b.wav', 1, 1, 'pad']];
  fs.writeFileSync(p, JSON.stringify(m));
  const got = sync.cacheFor(DEST, 'Font').get('a.wav');
  ok('⭐ an outside write is caught by the size/mtime check',
     got && got[2] === 'OUTSIDE',
     'the memo is validated, not timed — it must not depend on us being the only writer');
}

// ── 4. Two destinations do not share one memo ────────────────────────
//
// ⚠️⚠️ THE TWO MANIFESTS ARE MADE INDISTINGUISHABLE BY STAT, ON PURPOSE. A first version used two
// ordinary destinations, whose files differed in size and mtime — so the stat invalidated the
// memo anyway and a mutation that removed the path key went UNCAUGHT. Two cards written seconds
// apart with the same number of fonts is not an exotic case; it is a Tuesday.
{
  const D2 = path.join(ROOT, 'dest2');
  fs.mkdirSync(D2, { recursive: true });
  sync.mergeItems(D2, rec('Font', 'SECOND'));        // same length as 'OUTSIDE'? pad below
  const p1 = sync.manifestPath(DEST);
  const p2 = sync.manifestPath(D2);

  // Force identical size: make both files' payloads the same length.
  const m1 = JSON.parse(fs.readFileSync(p1, 'utf8'));
  const m2 = JSON.parse(fs.readFileSync(p2, 'utf8'));
  m1.items.Font.files = [['a.wav', 10, 1000, 'AAA']];
  m2.items.Font.files = [['a.wav', 10, 1000, 'BBB']];
  fs.writeFileSync(p1, JSON.stringify(m1));
  fs.writeFileSync(p2, JSON.stringify(m2));
  const T = new Date(Math.floor(Date.now() / 1000) * 1000 - 120000);
  fs.utimesSync(p1, T, T);
  fs.utimesSync(p2, T, T);

  const s1 = fs.statSync(p1), s2 = fs.statSync(p2);
  ok('  (the two manifests are indistinguishable by stat)',
     s1.size === s2.size && s1.mtimeMs === s2.mtimeMs,
     'if they differ the stat invalidates the memo and the path key is never exercised');

  const a = sync.cacheFor(DEST, 'Font').get('a.wav');
  const b = sync.cacheFor(D2, 'Font').get('a.wav');
  const a2 = sync.cacheFor(DEST, 'Font').get('a.wav');
  ok('⭐ each destination answers for itself',
     a && b && a2 && a[2] === 'AAA' && b[2] === 'BBB' && a2[2] === 'AAA',
     'keyed by manifest path; two cards in one session must not read each other');
}

// ── 4b. ⚠️⚠️ THE CACHE NEVER HANDS OUT ITS OWN OBJECT ────────────────
//
// `mergeItems` reads the manifest and then MUTATES it in place before writing. If readState
// returned the cached object, a caller that mutated and then failed to write would leave the memo
// holding records that were never persisted — and the next compare would believe files are
// recorded on the card that are not there.
// ⭐ This is the case that was missing when a mutation removing the copy went unnoticed.
{
  // ⚠️ THE MEMO IS INVALIDATED FIRST, so this exercises the FRESH-PARSE path. Without it the read
  // below is a memo hit, and a mutation that made the fresh path hand out its own object went
  // uncaught — the two return points have to be covered separately because they are two objects.
  const T2 = new Date(Math.floor(Date.now() / 1000) * 1000 - 30000);
  fs.utimesSync(sync.manifestPath(DEST), T2, T2);

  const first = sync.readState(DEST);
  ok('  (the manifest is readable for this check)', !!(first && first.manifest));
  if (first && first.manifest) {
    first.manifest.items.Font = { files: [['a.wav', 10, 1000, 'POISON']] };
    first.manifest.items.Injected = { files: [['x.wav', 1, 1, 'nope']] };
  }
  const second = sync.cacheFor(DEST, 'Font').get('a.wav');
  const injected = sync.readState(DEST).manifest.items.Injected;
  ok('⭐⭐ mutating a FRESHLY PARSED manifest cannot poison the cache',
     second && second[2] === 'AAA' && !injected,
     'the caller got a live reference to the cache, so its edits became the cached truth '
     + 'without ever reaching disk');

  // ⚠️ AND THE SAME THING VIA THE MEMO HIT. There are TWO return points — the fresh parse above
  // and the cached path — and they hand back two different objects. Covering one left a mutation
  // on the other completely unnoticed, in both directions as the cases were written.
  const hit = sync.readState(DEST);          // memo is warm now
  ok('  (this read came from the cache)', !!(hit && hit.manifest));
  if (hit && hit.manifest) hit.manifest.items.Injected2 = { files: [['y.wav', 1, 1, 'nope']] };
  const injected2 = sync.readState(DEST).manifest.items.Injected2;
  const third = sync.cacheFor(DEST, 'Font').get('a.wav');
  ok('⭐⭐ mutating a CACHED manifest cannot poison the cache',
     !injected2 && third && third[2] === 'AAA',
     'the cached path handed out its own object');
}

// ── 5. An absent manifest stays absent, and then appears ─────────────
//
// ⚠️ Absent is deliberately NOT memoised: there is no stat to validate against, so nothing would
// invalidate it when the file arrives.
{
  const D3 = path.join(ROOT, 'dest3');
  fs.mkdirSync(D3, { recursive: true });
  const empty = sync.cacheFor(D3, 'Font');
  sync.mergeItems(D3, rec('Font', 'NEW'));
  const now = sync.cacheFor(D3, 'Font').get('a.wav');
  ok('⭐ a manifest that did not exist is picked up once it does',
     empty.size === 0 && now && now[2] === 'NEW',
     'memoising "absent" would make the first export of a session never see its own manifest');
}

// ── 6. ⚠️ THE COUNTERS AGREE WITH AN INDEPENDENT COUNT ───────────────
//
// [B-173, 2026-09-25] The borrow is invisible from the user's chair: a compare that parses once
// and one that parses twenty-five times return the same answer and draw the same screen. The
// counters exist so the claim can be WATCHED in the terminal `npm start` runs in, rather than
// taken on trust from a passing suite alone.
//
// ⚠️⚠️ SO THE INSTRUMENT ITSELF NEEDS A CONTROL, or it can go blind and report a healthy borrow
// while the real one broke. This does not re-prove read-once — test 1 already does that by
// counting real `readFileSync` calls. It RECONCILES the reported number against that independent
// count, which is the only thing that catches the counters drifting away from the behaviour.
{
  const D4 = path.join(ROOT, 'dest4');
  fs.mkdirSync(D4, { recursive: true });
  sync.mergeItems(D4, rec('Font', 'h1'));

  // ⚠️⚠️ DIRTY THE COUNTERS ON PURPOSE BEFORE MEASURING, and the reason is that the first draft
  // of this block did not — it read whatever the test above had left behind. A mutation removing
  // the parse counter from the fresh-read path SURVIVED, because the preceding block happened to
  // leave `parses` reading 1 and the assertions could not tell borrowed state from measured
  // state. Counters are module-level, so a test that does not establish its own start is
  // measuring leftovers. A fresh parse is DEFINED as starting a new borrow, so the marker below
  // must be gone by the end; if it survives, no borrow began and nothing else here means anything.
  sync.countStat(999);

  const real = fs.readFileSync;
  let realParses = 0;
  fs.readFileSync = function (p, ...r) {
    if (String(p).endsWith(sync.MANIFEST_NAME)) realParses++;
    return real.call(this, p, ...r);
  };
  for (let i = 0; i < 20; i++) sync.cacheFor(D4, 'Font');
  fs.readFileSync = real;

  const c = sync.counts();
  ok('⭐⭐ a fresh parse STARTS a borrow, clearing what came before',
     c.stats === 0,
     'the 999 marker survived, so no new borrow began and every number below is inherited');
  ok(`⭐⭐ reported parses match the real reads (said ${c.parses}, actually ${realParses})`,
     c.parses === realParses,
     'the counters are the thing being read live; if they disagree with reality they are worse than absent');
  ok(`⭐ reuses account for every remaining lookup (${c.reuses})`,
     c.parses + c.reuses === 20,
     'a lookup that is neither a parse nor a reuse means a path bypassed the memo uncounted');

  const before = sync.counts().stats;
  sync.countStat();
  sync.countStat(41);
  ok('⭐ the stat counter moves by what it is given - [B-173] point 2 is measured with it',
     sync.counts().stats === before + 42,
     'point 2 is judged by this number falling, so it has to be trustworthy before the work starts');
}

try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
console.log(failed ? `\n${failed} FAILED` : '\nmanifest-borrow: all passing');
process.exit(failed ? 1 : 0);
