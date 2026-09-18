// [B-398] The streamed hash must equal the synchronous one, byte for byte.
//
// hashFileAsync exists because a yield BETWEEN files does not help when one file is the block:
// compare:font stalled 2526ms and tracks:planExport 623ms with the per-file breath already in
// place, because _hashFile reads a whole file in one synchronous go and a font's tracks are
// megabytes each.
//
// ⚠️⚠️ THESE HASHES DECIDE WHAT COUNTS AS THE SAME CONTENT. They drive the export compare, the
// sync manifest, and dedup. A twin that disagreed by one byte would not throw - it would quietly
// re-copy files that were already correct, or worse, call different files identical. So the
// agreement is asserted directly rather than assumed from "both are sha256".
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');

const fhm = require('../soundFontFileHash');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + detail : ''));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-hash-'));

// Sizes chosen to straddle the 64 KiB stream chunk boundary, since an off-by-one in chunk
// handling would show up exactly there and nowhere else.
const cases = [
  ['empty.bin',        Buffer.alloc(0)],
  ['tiny.bin',         Buffer.from('a')],
  ['just-under.bin',   crypto.randomBytes(64 * 1024 - 1)],
  ['exactly.bin',      crypto.randomBytes(64 * 1024)],
  ['just-over.bin',    crypto.randomBytes(64 * 1024 + 1)],
  ['multi-chunk.bin',  crypto.randomBytes(64 * 1024 * 3 + 777)],
];

(async () => {
  for (const [name, buf] of cases) {
    const abs = path.join(dir, name);
    fs.writeFileSync(abs, buf);
    const sync  = fhm.hashFile(abs);
    const async_ = await fhm.hashFileAsync(abs);
    check('streamed hash matches sync for ' + name + ' (' + buf.length + ' bytes)',
      async_ === sync, 'sync  ' + sync + '\n     async ' + async_);
  }

  // ⚠️ A file it cannot read must come back null, NOT a hash of nothing. A caller that receives a
  // plausible-looking digest for an unreadable file would record it as the destination's content
  // and then believe the card matched. Null means "unknown" and sends the caller to read it.
  const missing = await fhm.hashFileAsync(path.join(dir, 'does-not-exist.bin'));
  check('an unreadable file resolves null, not a digest', missing === null,
    'got ' + JSON.stringify(missing));

  // ⭐ The empty-file case is the one that could silently "work": sha256 of nothing is a real,
  // stable digest. Assert the twins agree on it rather than letting it pass by accident.
  const emptySync = fhm.hashFile(path.join(dir, 'empty.bin'));
  check('the empty file has a real digest both ways, not null',
    typeof emptySync === 'string' && emptySync.length === 64);

  console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
