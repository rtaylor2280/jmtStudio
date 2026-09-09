// [B-348] The SD browser's async health walk: direct-file marks, incremental
// folder badges, real cancellation, and parity with the sync checker that the
// detection-time budgeted scan still uses. The sync scanFolderHealth walk it
// replaced froze the app for minutes on a slow card (~36ms per file open ×
// 7,307 wavs, measured 2026-09-08 on a real Proffie card).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sd = require('../sdCardDetect.js');

const root = path.join(os.tmpdir(), 'jmt-test-sd-health-async');

function goodWav(p) {
  const data = Buffer.alloc(64);
  const buf = Buffer.alloc(44 + 64);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + 64, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(64, 40);
  data.copy(buf, 44);
  fs.writeFileSync(p, buf);
}
function corruptWav(p) {
  // declares a 100000-byte data chunk in a 60-byte file => truncated
  const buf = Buffer.alloc(60);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(100036, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('data', 12, 'ascii'); buf.writeUInt32LE(100000, 16);
  fs.writeFileSync(p, buf);
}

function setup() {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'GoodFont', 'clsh'), { recursive: true });
  fs.mkdirSync(path.join(root, 'BadFont', 'swng'), { recursive: true });
  goodWav(path.join(root, 'hum.wav'));
  corruptWav(path.join(root, 'boot.wav'));
  goodWav(path.join(root, 'GoodFont', 'hum.wav'));
  goodWav(path.join(root, 'GoodFont', 'clsh', 'clsh01.wav'));
  goodWav(path.join(root, 'BadFont', 'hum.wav'));
  corruptWav(path.join(root, 'BadFont', 'swng', 'swng01.wav'));
  corruptWav(path.join(root, 'BadFont', 'swng', 'swng02.wav'));
}

test('async SD health walk', async (t) => {
  setup();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await t.test('direct-file check flags corrupt wavs and only those', async () => {
    const fh = await sd.filesHealthAsync(root);
    assert.ok(fh.files['boot.wav'] && fh.files['boot.wav'].corrupt, 'boot.wav flagged');
    assert.strictEqual(fh.files['hum.wav'], undefined, 'hum.wav clean');
  });

  await t.test('tiny resident files are READ, not skipped as placeholders', async () => {
    // NTFS keeps small files resident in the MFT with zero allocated blocks —
    // the same stat signature as a cloud placeholder. The first heuristic
    // skipped every wav under ~700 bytes; the size floor keeps tiny files in
    // the walk (this fixture's wavs are all ~100 bytes, so the corruption
    // findings in the other subtests only exist because they were read).
    const fh = await sd.filesHealthAsync(root);
    assert.ok(Object.keys(fh.files).length > 0, 'tiny corrupt wavs were read and flagged');
  });

  await t.test('subtree walk badges corrupt folders incrementally and in order', async () => {
    const events = [];
    const sh = await sd.subtreeHealthAsync(root, ['GoodFont', 'BadFont'], {
      onDirDone: (p) => events.push(p),
    });
    assert.strictEqual(sh.dirs.BadFont && sh.dirs.BadFont.count, 2, 'BadFont badge count');
    assert.strictEqual(sh.dirs.GoodFont, undefined, 'GoodFont has no badge');
    assert.strictEqual(events.length, 2, 'one event per dir');
    assert.strictEqual(events[0].name, 'GoodFont');
    assert.strictEqual(events[1].name, 'BadFont');
    assert.strictEqual(sh.cancelled, false);
    // 5 wavs live under the two subfolders; the root's two belong to the
    // direct check, not the badge walk.
    assert.strictEqual(sh.seen, 5, 'files opened');
  });

  await t.test('cancellation abandons the walk and says so', async () => {
    let calls = 0;
    const sh = await sd.subtreeHealthAsync(root, ['GoodFont', 'BadFont'], {
      isCancelled: () => (++calls > 4),
    });
    assert.strictEqual(sh.cancelled, true, 'partial walk reports cancelled');
  });

  await t.test('async and sync wav checkers agree', async () => {
    const p = path.join(root, 'boot.wav');
    const size = fs.statSync(p).size;
    const syncH = sd.checkWavHealth(p, size);
    const asyncH = await sd.checkWavHealthAsync(p, size);
    assert.strictEqual(asyncH.corrupt, syncH.corrupt);
    assert.strictEqual(asyncH.reason, syncH.reason);
  });

  console.log('all async SD health tests passed');
});
