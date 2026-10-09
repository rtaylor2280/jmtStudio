// `_selectFolderFiles` must STOP when asked, not merely yield.
//
// WHY THIS IS A BEHAVIOURAL TEST AND NOT A SOURCE SCAN. The defect was "cancel does nothing
// for six minutes", and the thing that made it invisible is that the pass already looked correct:
// [B-398] made it `await breathe()` per file so the window stays responsive through it, and a
// source scan for "does this loop yield" would have come back green. A responsive window that
// ignores Cancel is the same wait with a nicer frame. Only an actual run can tell the difference
// between yielding and stopping, so this builds a tree and counts how far the walk gets.
//
// The measurement, bulk-importing a board card 2026-10-06: *"just finished... almost 6 min.
// cancelled only a few seconds in."* This pass reads the leading bytes of EVERY file before a byte
// is copied, and per-file open is the expensive operation over a board's USB mass storage.
//
// [B-462]

const fs = require('fs');
const os = require('os');
const path = require('path');

const sources = require('../soundFontSources');

let failures = 0;
const ok = (label, cond, hint) => {
  if (cond) { console.log(`  ok  ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${hint ? `\n       ${hint}` : ''}`);
};

// A minimal valid-enough wav head so the selector keeps the file rather than stripping it. The
// content does not matter to this test - only that the walk has real files to open.
const wavHead = () => {
  const b = Buffer.alloc(64);
  b.write('RIFF', 0); b.writeUInt32LE(56, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(20, 40);
  return b;
};

const TOTAL = 40;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-cancel-'));
try {
  for (let i = 0; i < TOTAL; i++) {
    fs.writeFileSync(path.join(root, `hum${String(i).padStart(3, '0')}.wav`), wavHead());
  }

  (async () => {
    // ── The control. Without it, "it threw" and "it is broken" look identical. ──
    const all = await sources._selectFolderFiles(root, null);
    ok('control: the walk reads every file when nothing cancels it',
       all && all.files.length === TOTAL,
       `expected ${TOTAL} files, got ${all && all.files.length} - the fixture is wrong and every `
       + 'result below is meaningless');

    // ── A predicate that never fires must not change the outcome. ──
    const unstopped = await sources._selectFolderFiles(root, () => false);
    ok('a shouldStop that never fires leaves the walk untouched',
       unstopped && unstopped.files.length === TOTAL,
       'passing a predicate changed the result on its own - the check is firing when it should not');

    // ── The real question: does it stop, and does it stop EARLY? ──
    // The predicate is called once per file, so its call count is how far the walk got. Asserting
    // only "it threw" would pass a version that walked all 40 files and threw on the last one -
    // which is precisely the six-minute bug, since on a card the cost IS the walking.
    let calls = 0;
    let threw = null;
    try {
      await sources._selectFolderFiles(root, () => { calls += 1; return calls >= 3; });
    } catch (e) { threw = e; }

    ok('a cancel mid-walk throws', threw !== null,
       'the walk ran to completion with the predicate returning true - cancel does nothing here, '
       + 'which is the original defect');
    ok('it throws the shared cancel signal, not a bare Error',
       !!(threw && threw.cancelled === true),
       'the caller duck-types on `err.cancelled === true` to tell a cancel from a failure; '
       + 'anything else is reported to the user as a broken import');
    ok('it stops EARLY rather than finishing the walk first',
       calls <= 5 && calls < TOTAL,
       `the predicate was asked ${calls} times out of ${TOTAL} - it kept reading after being told `
       + 'to stop, which on a board card is the whole wait');

    fs.rmSync(root, { recursive: true, force: true });
    console.log(failures === 0
      ? '\nselect-folder-cancel: all checks passed'
      : `\nselect-folder-cancel: ${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })().catch((e) => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    console.log(`  FAIL harness threw: ${e && e.message}`);
    process.exit(1);
  });
} catch (e) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(`  FAIL setup threw: ${e && e.message}`);
  process.exit(1);
}
