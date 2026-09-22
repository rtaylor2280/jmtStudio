// Cancelling a file copy — executed, not grepped.  [B-005 item 4]
//
// ⚠️⚠️ WHY THIS FILE EXISTS ALONGSIDE export-cancel.test.js. That suite greps source for the
// shape of the fix, which proves the lines are present and nothing about what they do. On
// 2026-09-19 a feature shipped green and did nothing, because every test built its own input
// and handed it to the algorithm, never exercising the seam. The claim here — "a cancelled
// copy leaves no file behind" — is about behaviour on a real disk, so it has to be run on
// one.
//
// sfExportCopy requires only fs and path, no electron, so it runs under plain node.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { copyFileWithProgress, copyTreeWithProgress, isCancel } = require('../sfExportCopy');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-cancel-'));
const src = path.join(tmp, 'src');
const dst = path.join(tmp, 'dst');
fs.mkdirSync(src, { recursive: true });
fs.mkdirSync(dst, { recursive: true });

// ⚠️ BIGGER THAN ONE CHUNK, OR THE TEST CANNOT FAIL. The read stream uses a 1 MB
// highWaterMark, so a small file arrives as a single 'data' event and completes before any
// cancel could land — the copy would succeed and the assertion would pass for the wrong
// reason. 5 MB gives at least five checkpoints.
const BIG = path.join(src, 'big.wav');
fs.writeFileSync(BIG, Buffer.alloc(5 * 1024 * 1024, 0x41));

(async () => {
  // ── 1. A cancel mid-file rejects, and takes the partial with it ──
  {
    const out = path.join(dst, 'big.wav');
    let chunks = 0;
    let err = null;
    try {
      await copyFileWithProgress(BIG, out, () => { chunks++; }, () => chunks >= 1);
    } catch (e) { err = e; }

    ok('a cancelled copy rejects', !!err, 'it resolved as if it had finished');
    ok('and rejects with something isCancel() recognises', isCancel(err),
       'a cancel that reads as a fault surfaces to the user as "Export failed"');
    ok('⚠️⚠️ and the truncated file is GONE from the destination', !fs.existsSync(out),
       'this is the whole safety argument for interrupting mid-write');
    ok('it stopped early rather than copying the whole file', chunks < 5,
       `copied ${chunks} chunks of ~5 — the check is not firing where it should`);
  }

  // ── 2. The uncancelled case still copies correctly ──
  //
  // ⚠️ THE CONTROL. Without it, a shouldStop wired to always-true would pass every
  // assertion above while having broken copying entirely.
  {
    const out = path.join(dst, 'ok.wav');
    await copyFileWithProgress(BIG, out, null, () => false);
    ok('an uncancelled copy still completes', fs.existsSync(out));
    ok('and lands byte-for-byte', fs.existsSync(out)
       && fs.statSync(out).size === fs.statSync(BIG).size,
       'the cancel check must not disturb the normal path');
  }

  // ── 3. A null shouldStop must behave exactly as before ──
  //
  // Callers that never pass one exist (import-side and older doors), and a copy that
  // throws because nobody handed it a predicate would be a regression with wide blast.
  {
    const out = path.join(dst, 'nostop.wav');
    await copyFileWithProgress(BIG, out, null);
    ok('no shouldStop at all still copies', fs.existsSync(out)
       && fs.statSync(out).size === fs.statSync(BIG).size);
  }

  // ── 4. Through the tree walk, the same guarantee holds ──
  //
  // ⭐ THE SEAM THAT MATTERS: the walk has to hand its predicate DOWN. A walk that stops
  // between files while the current write runs to completion is the original complaint —
  // ~15 minutes with Cancel already pressed.
  {
    const tsrc = path.join(tmp, 'tree');
    const tdst = path.join(tmp, 'treeout');
    fs.mkdirSync(tsrc, { recursive: true });
    for (const n of ['a.wav', 'b.wav', 'c.wav']) {
      fs.writeFileSync(path.join(tsrc, n), Buffer.alloc(3 * 1024 * 1024, 0x42));
    }
    fs.mkdirSync(tdst, { recursive: true });

    let bytes = 0;
    let err = null;
    try {
      await copyTreeWithProgress(tsrc, tdst, {
        onBytes: (n) => { bytes += n; },
        // Fire partway through the FIRST file, not on a file boundary.
        shouldStop: () => bytes > 1024 * 1024,
      });
    } catch (e) { err = e; }

    ok('a cancelled tree walk rejects as a cancel', isCancel(err));
    const left = fs.readdirSync(tdst);
    ok('⚠️⚠️ no truncated file is left in the destination tree',
       left.every((n) => fs.statSync(path.join(tdst, n)).size === 3 * 1024 * 1024),
       `destination holds ${JSON.stringify(left.map((n) =>
         [n, fs.statSync(path.join(tdst, n)).size]))} — a short file is a truncated one`);
    ok('it stopped inside the first file, not after all three',
       bytes < 9 * 1024 * 1024,
       `copied ${bytes} bytes of 9 MB — the cancel is landing on file boundaries only`);
  }

  // ── 5. ⚠️⚠️ THE WINDOWS HANDLE RACE, WHICH THIS SUITE ORIGINALLY MISSED ──
  //
  // He cancelled an export to a board card and the partial folder was STILL THERE. Cause: on
  // Windows, unlinking a file whose write handle is still open fails with EPERM/EBUSY - POSIX
  // permits it, which is why the first implementation looked right. `ws.destroy()` is async,
  // so the immediate `unlinkSync` after it was racing the handle release.
  //
  // ⭐⭐ AND EVERY ASSERTION ABOVE PASSED ANYWAY, because they copy to a local temp dir where
  // the handle releases fast enough to win every time. **A timing bug that resolves quickly on
  // fast storage and slowly on a card cannot be caught by a test that only uses fast storage.**
  // The fixture was faithful to the API and unfaithful to the destination. So this section
  // asserts the STRUCTURE of the fix, which does not depend on the disk underneath it.
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sfExportCopy.js'), 'utf8');
    ok('⚠️⚠️ the unlink waits for the write stream to close',
       /ws\.once\('close'/.test(src) && /async \(\) => \{[\s\S]{0,400}?unlinkSync\(destPath\)/.test(src),
       'unlinking straight after destroy() races the handle release and loses on slow media');
    ok('the wait cannot hang a cancel forever',
       /setTimeout\(r, 2000\)/.test(src),
       'a stream that never closes must not strand the user in Stopping...');
    ok('EBUSY/EPERM are retried, ENOENT is not an error',
       /EBUSY.*EPERM|EPERM.*EBUSY/.test(src) && /ENOENT.*return/.test(src),
       'a handle held by an indexer or AV outlives close');
    ok('⚠️ the rejection waits for the cleanup',
       /dropPartial\(\)\.then\(\(\) => reject\(err\), \(\) => reject\(err\)\)/.test(src),
       'rejecting first lets the caller rm the folder while this handle is still open - which '
       + 'is how one failed unlink became a whole folder left on his card');
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failed ? `\n${failed} FAILED` : '\nexport-cancel-behavior: all passing');
  process.exit(failed ? 1 : 0);
})();
