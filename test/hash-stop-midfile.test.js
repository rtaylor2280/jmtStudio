// A Cancel during a destination check stops the read mid-file, not after it.
//
// One sound file read through a board's USB link takes seconds, and the scan used to finish the
// whole file before looking at the stop flag. Seen 2026-11-13 on a board card: Cancel sat on
// "finishing the current file" during a phase that only reads.
//
// Run: node test/hash-stop-midfile.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const ROOT = path.join(__dirname, '..');
const { hashFileAsync } = require(path.join(ROOT, 'soundFontFileHash'));

(async () => {
  const f = path.join(os.tmpdir(), `jmt-stop-midfile-${process.pid}.bin`);
  fs.writeFileSync(f, Buffer.alloc(4 * 1024 * 1024, 7));   // 64 chunks of 64 KiB
  try {
    let chunks = 0;
    const stopped = await hashFileAsync(f, { shouldStop: () => ++chunks > 1 });
    ok('a stop raised mid-file ends the read early', chunks < 64, `chunks=${chunks}`);
    ok('...and reports unknown (null), never a digest', stopped === null, `got ${stopped}`);
    const full = await hashFileAsync(f);
    ok('CONTROL without a stop the same file hashes', typeof full === 'string' && full.length === 64);
  } finally {
    try { fs.unlinkSync(f); } catch {}
  }

  // Every card-side compare passes its stop flag into the read and checks it right after.
  const src = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');
  const sites = [
    ['soundFontEntries.js', /await hashFileAsync\(abs, \{ shouldStop: opts\.shouldStop \}\)\);\s*if \(opts\.shouldStop && opts\.shouldStop\(\)\) return \{ ok: true, canceled: true \};/],
    ['soundFontEntries.js', /await hashFileAsync\(childAbs, \{ shouldStop: opts\.shouldStop \}\)\);\s*if \(opts\.shouldStop && opts\.shouldStop\(\)\) return \{ ok: true, canceled: true \};/],
    ['soundFontEntries.js', /destHash = await hashFileAsync\(f\.abs, \{ shouldStop \}\);\s*if \(shouldStop && shouldStop\(\)\) return \{ ok: true, canceled: true \};/],
    ['soundFontCommon.js', /await hashFileAsync\(abs, \{ shouldStop \}\)\);\s*if \(shouldStop && shouldStop\(\)\) return \{ ok: true, canceled: true \};/],
    ['soundFontSharedTracks.js', /await hashFileAsync\(dst, \{ shouldStop \}\)\);\s*if \(shouldStop && shouldStop\(\)\) return \{ ok: true, canceled: true \};/],
  ];
  for (const [file, re] of sites) ok(`${file}: the read takes the stop flag and is checked after`, re.test(src(file)));

  console.log(failed ? `\nhash-stop-midfile: ${failed} FAILED` : '\nhash-stop-midfile: all passing');
  process.exit(failed ? 1 : 0);
})();
