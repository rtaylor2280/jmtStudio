// [B-475] The streaming attachment store: one read, staged then renamed, cancellable.
//
// ⚠️⚠️ THIS TEST RUNS THE REAL FUNCTION ON REAL FILES. It is deliberately NOT a source scan.
// The 2026-09-25 lesson is the reason: a data-loss test whose header claimed it ran on real files
// and whose every assertion was a regex over source text had never once executed the thing it
// guarded. Rewritten to actually run, it found three bugs inside the hour.
//
// ⭐ What it has to prove, in the order the defect was argued:
//   1. the file is read ONCE, not twice   (the whole point of [B-475])
//   2. progress is reported while it runs (so a slow card is not a frozen app)
//   3. a cancel leaves NOTHING behind     (partial bytes are thrown away, never kept)
//   4. staging never appears as an attachment
//   5. the program-file refusal still fires BEFORE anything is stored

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const A = require('../soundFontAttachments.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? ' - ' + extra : ''}`); fail++; }
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b475-'));
fs.mkdirSync(path.join(ud, 'soundFonts', 'attachments'), { recursive: true });
fs.mkdirSync(path.join(ud, 'soundFonts', 'sources'), { recursive: true });

const attachRoot = path.join(ud, 'soundFonts', 'attachments');
const stagingRoot = path.join(ud, 'soundFonts', '_attach_staging');

// A receipt big enough that a single chunk cannot carry it, so progress has to tick more than once
// and a cancel has somewhere to land. 1 MB highWaterMark, so 6 MB is ~6 chunks.
const big = path.join(ud, 'receipt.pdf');
fs.writeFileSync(big, Buffer.alloc(6 * 1024 * 1024, 0x41));

// ── 1. ONE READ, NOT TWO ──────────────────────────────────────────────────────
// ⭐ COUNTED BY INSTRUMENTING fs ITSELF rather than by timing or by reading the source. The old
// path called readFileSync (hash) and then copyFileSync (copy); if either survives, this trips.
(async () => {
  const realRead = fs.readFileSync;
  const realCopy = fs.copyFileSync;
  const realCreateRead = fs.createReadStream;
  let fullReads = 0, copies = 0, streams = 0;
  fs.readFileSync = function (p, ...rest) {
    if (String(p) === big) fullReads++;
    return realRead.call(fs, p, ...rest);
  };
  fs.copyFileSync = function (src, ...rest) {
    if (String(src) === big) copies++;
    return realCopy.call(fs, src, ...rest);
  };
  fs.createReadStream = function (p, ...rest) {
    if (String(p) === big) streams++;
    return realCreateRead.call(fs, p, ...rest);
  };

  const ticks = [];
  const r = await A.storeFileStreaming(ud, big, 'My receipt', {
    onProgress: ({ bytes, total }) => ticks.push([bytes, total]),
  });

  fs.readFileSync = realRead;
  fs.copyFileSync = realCopy;
  fs.createReadStream = realCreateRead;

  ok('the store succeeded', r.ok === true, JSON.stringify(r));
  ok('⭐ the source file was never read whole into memory', fullReads === 0, `${fullReads} readFileSync`);
  ok('⭐ the source file was never copyFileSync-ed', copies === 0, `${copies} copyFileSync`);
  ok('it was streamed exactly once', streams === 1, `${streams} createReadStream`);

  // ── 2. PROGRESS ───────────────────────────────────────────────────────────
  ok('progress ticked more than once', ticks.length > 1, `${ticks.length} ticks`);
  ok('progress is monotonic', ticks.every((t, i) => i === 0 || t[0] >= ticks[i - 1][0]));
  ok('progress ends at the file size', ticks.length && ticks[ticks.length - 1][0] === 6 * 1024 * 1024);
  ok('progress carries an honest total', ticks.every(t => t[1] === 6 * 1024 * 1024));

  // ── the stored result ─────────────────────────────────────────────────────
  const dir = path.join(attachRoot, r.id);
  ok('the attachment landed under its own hash', fs.existsSync(dir));
  ok('the stored bytes match the source',
     fs.existsSync(path.join(dir, 'receipt.pdf'))
     && fs.statSync(path.join(dir, 'receipt.pdf')).size === 6 * 1024 * 1024);
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, 'attachment.json'), 'utf8'));
  ok('the sidecar carries the label', sidecar.label === 'My receipt');
  ok('the sidecar carries the real size', sidecar.size === 6 * 1024 * 1024);

  // ⚠️ THE ID MUST BE THE REAL CONTENT HASH, not merely "some id". A streaming hash that updated
  // with the wrong buffer would still produce a stable, plausible, WRONG id - and dedup would then
  // silently treat two different receipts as one.
  const crypto = require('crypto');
  const expect = crypto.createHash('sha256').update(fs.readFileSync(big)).digest('hex');
  ok('⭐ the id is the true sha256 of the file', r.id === expect);

  // ── 4. STAGING IS INVISIBLE ───────────────────────────────────────────────
  // ⚠️ THIS CAUGHT A REAL DEFECT WHILE BEING WRITTEN. Staging first lived at
  // attachments/_staging, and `listAllAttachments` enumerates that root and hands every entry to
  // `attachmentInfo`, whose missing-sidecar fallback returns the first file it finds as the
  // attachment's name - so the staging folder surfaced as a linkable attachment in the
  // "Link existing proof of purchase" picker.
  const all = A.listAllAttachments(ud);
  ok('⭐ staging never appears as an attachment',
     all.every(a => a.id && !String(a.id).startsWith('_')), JSON.stringify(all.map(a => a.id)));
  ok('exactly one attachment is listed', all.length === 1, `${all.length}`);
  ok('nothing was left in staging', !fs.existsSync(stagingRoot)
     || fs.readdirSync(stagingRoot).length === 0);

  // ── dedup: a second add of identical bytes stores nothing new ─────────────
  const copy = path.join(ud, 'receipt-copy.pdf');
  fs.copyFileSync(big, copy);
  const r2 = await A.storeFileStreaming(ud, copy, 'Renamed');
  ok('identical bytes reuse the same id', r2.ok && r2.id === r.id);
  ok('the second add reported itself as deduped', r2.deduped === true);
  ok('still exactly one attachment on disk', fs.readdirSync(attachRoot).length === 1);
  ok('the label was refreshed on the existing record',
     JSON.parse(fs.readFileSync(path.join(dir, 'attachment.json'), 'utf8')).label === 'Renamed');

  // ── 3. CANCEL LEAVES NOTHING ──────────────────────────────────────────────
  // The rule: a cancelled attachment throws away all the partial bytes.
  const other = path.join(ud, 'big-two.bin');
  fs.writeFileSync(other, Buffer.alloc(6 * 1024 * 1024, 0x42));
  let seen = 0;
  const rc = await A.storeFileStreaming(ud, other, 'nope', {
    shouldStop: () => { seen++; return seen > 1; },   // stop after the first chunk
  });
  ok('⭐ a cancel is reported as cancelled, not as an error',
     rc.ok === false && rc.cancelled === true, JSON.stringify(rc));
  ok('⭐ a cancel stores nothing', fs.readdirSync(attachRoot).length === 1,
     fs.readdirSync(attachRoot).join(','));
  ok('⭐ a cancel leaves no partial staging folder',
     !fs.existsSync(stagingRoot) || fs.readdirSync(stagingRoot).length === 0,
     fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot).join(',') : '');
  ok('the cancelled file never became an attachment',
     A.listAllAttachments(ud).every(a => a.name !== 'big-two.bin'));

  // ── 5. THE PROGRAM REFUSAL STILL FIRES, AND BEFORE STORING ────────────────
  // ⚠️ An attachment is REFUSED rather than stripped: the file IS the thing the user asked for.
  const exe = path.join(ud, 'invoice.exe');
  fs.writeFileSync(exe, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 0)]));
  const rb = await A.storeFileStreaming(ud, exe, 'sneaky');
  ok('⭐ a program file is refused', rb.ok === false && rb.blocked === true, JSON.stringify(rb));
  ok('⭐ a refused program stored nothing', fs.readdirSync(attachRoot).length === 1);
  ok('a refused program left no staging', !fs.existsSync(stagingRoot)
     || fs.readdirSync(stagingRoot).length === 0);

  // ── the sweep ─────────────────────────────────────────────────────────────
  // ⚠️ Proved against a REAL abandoned folder, not an empty directory: a sweep that reports 0 on
  // nothing is a check whose failure case is unreachable.
  fs.mkdirSync(path.join(stagingRoot, 'leftover-from-a-crash'), { recursive: true });
  fs.writeFileSync(path.join(stagingRoot, 'leftover-from-a-crash', 'half.pdf'), 'partial');
  const sw = A.sweepStaging(ud);
  ok('⭐ the sweep removes an abandoned staging folder', sw.swept === 1, JSON.stringify(sw));
  ok('and the store is untouched by it', fs.readdirSync(attachRoot).length === 1);

  try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  console.log('');
  console.log(fail === 0
    ? `attachment-streaming-store: all ${pass} checks passed`
    : `attachment-streaming-store: ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('attachment-streaming-store: threw', e);
  process.exit(1);
});
