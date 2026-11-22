// A failed backup read must not keep the file open. [B-479]
//
// Reported from the real card: a restore from a board-mounted saber fails, and the card then
// refuses to eject with "In use". The holder was us. node-stream-zip opens the file itself, and
// when a read fails its close() reports success and leaks the descriptor anyway - so there is no
// error to log and nothing to notice. On a card that is the difference between ejecting and not.
//
// Measured 2026-10-11 against the shipped shape: a good zip inspects with an fd delta of 0, a
// truncated one leaves +1 behind. `_openBackupZip` opens the descriptor here and wraps close()
// so every existing cleanup path releases it; both cases then come back 0.
//
// THIS EXERCISES THE REAL `inspectBackup`, not a copy of its shape. A mirror of the code would
// pass while the shipped function leaked, which is the whole failure this file exists to catch.
//
// Run: node test/backup-inspect-releases-fd.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const backup = require('../soundFontBackup');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// A fresh descriptor's NUMBER rises as descriptors accumulate, so the delta across a call is
// the leak. Cheap, and it needs no platform-specific handle API.
const probe = () => { const fd = fs.openSync(__filename, 'r'); fs.closeSync(fd); return fd; };

const makeZip = (dest) => new Promise((resolve, reject) => {
  const out = fs.createWriteStream(dest);
  const a = archiver('zip', { zlib: { level: 1 } });
  out.on('close', resolve);
  a.on('error', reject);
  a.pipe(out);
  // The REAL constants, not a guessed string. A hand-written type silently makes the good
  // fixture a not-a-backup, and then the "successful inspect" case never exercises success.
  a.append(JSON.stringify({ type: backup.BACKUP_TYPE, schemaVersion: backup.SCHEMA_VERSION }),
           { name: 'manifest.json' });
  a.append(Buffer.alloc(512 * 1024, 5), { name: 'payload.bin' });
  a.finalize();
});

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-fd-'));
  try {
    const good = path.join(root, 'good.zip');
    await makeZip(good);
    const whole = fs.readFileSync(good);
    const bad = path.join(root, 'bad.zip');
    fs.writeFileSync(bad, whole.subarray(0, Math.floor(whole.length * 0.6)));

    // ── the fixture's own preconditions, before anything is concluded from it ──
    ok('the good zip inspects cleanly', (await backup.inspectBackup(good)).ok === true,
       'if the good case does not pass, the comparison below is meaningless');
    const badResult = await backup.inspectBackup(bad);
    ok('the truncated zip FAILS to inspect', badResult.ok === false,
       `got ok=${badResult.ok}; a fixture that does not fail cannot show a leak on the failure path`);
    ok('and fails for a read reason, not a content one',
       badResult.reason === 'unreadable' || badResult.reason === 'bad-manifest',
       `reason was ${badResult.reason} - only the read-failure reasons exercise this path`);

    // ── the assertions ──
    let before = probe();
    await backup.inspectBackup(good);
    await new Promise(r => setTimeout(r, 300));
    const goodDelta = probe() - before;
    ok('a SUCCESSFUL inspect releases the file', goodDelta === 0,
       `fd delta ${goodDelta}`);

    before = probe();
    await backup.inspectBackup(bad);
    await new Promise(r => setTimeout(r, 300));
    const badDelta = probe() - before;
    ok('a FAILED inspect releases the file too', badDelta === 0,
       `fd delta ${badDelta} - the read failed and the descriptor stayed open, which is what `
       + `stops a card ejecting after a failed restore`);

    // ── CONTROL: the probe must be able to SEE a held descriptor ──
    before = probe();
    const held = fs.openSync(bad, 'r');
    const heldDelta = probe() - before;
    fs.closeSync(held);
    ok('control: the probe detects a descriptor we hold on purpose', heldDelta > 0,
       'the probe cannot see a leak at all, so the two passes above prove nothing');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }

  console.log(`\nbackup-inspect-releases-fd: ${failed ? failed + ' FAILED' : 'all checks passed'}`);
  process.exit(failed ? 1 : 0);
})();
