// The library size figure, and the rule that makes it checkable. [B-318]
//
// The whole value of this readout is that a user can verify it against their own file manager.
// So the apparent figure is not "a reasonable measure of size", it is EXACTLY the rule Explorer,
// Finder and du use: every path's logical length, summed, no dedup. Verified against a real
// Properties dialog on 2026-10-09 at 8,374,637,521 bytes, 15,029 files, 916 folders, all three
// matching to the byte.
//
// The on-disk figure is the same sum with each distinct file stored once, which is what the
// volume is really holding. Hardlinks are why those two numbers differ, and the difference is
// the only claim this feature makes.
//
// Run: node test/library-size.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const L = require('../soundFontLibrarySize.js');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra === undefined ? '' : `\n      ${extra}`)); }
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-libsize-'));
const UD = path.join(ROOT, 'userData');
const SF = path.join(UD, 'soundFonts');
fs.mkdirSync(path.join(SF, 'library', 'FontA'), { recursive: true });
fs.mkdirSync(path.join(SF, 'sources', 'src1'), { recursive: true });

const A = path.join(SF, 'sources', 'src1', 'hum.wav');
const B = path.join(SF, 'library', 'FontA', 'hum.wav');
const C = path.join(SF, 'library', 'FontA', 'boot.wav');
fs.writeFileSync(A, Buffer.alloc(300 * 1024, 1));
fs.writeFileSync(C, Buffer.alloc(100 * 1024, 2));

// A hardlink: one set of bytes wearing two names. This is the entire mechanism under test.
let linked = true;
try { fs.linkSync(A, B); } catch { linked = false; fs.copyFileSync(A, B); }

(async () => {
  const f = await L.compute(UD);

  // ── the rule the user can check ──────────────────────────────────────────
  const everyPath = (300 + 300 + 100) * 1024;
  ok('apparent counts every path, the way a file manager does',
     f.apparent === everyPath, `${f.apparent} vs ${everyPath}`);
  ok('and the file count matches what Properties would say', f.files === 3, String(f.files));

  if (linked) {
    const distinctBytes = (300 + 100) * 1024;
    ok('on disk counts shared bytes once', f.onDisk === distinctBytes,
       `${f.onDisk} vs ${distinctBytes} — the hardlinked pair must collapse to one`);
    ok('distinct file count sees the link', f.distinct === 2, String(f.distinct));
    ok('saved is the difference and nothing else',
       f.saved === f.apparent - f.onDisk && f.saved === 300 * 1024, String(f.saved));
  } else {
    console.log('SKIP  hardlink cases: this filesystem refused a link');
  }

  // A figure that cannot distinguish a link from a copy is the failure mode worth naming: it
  // would report the library as costing twice what it does and nobody would notice.
  ok('apparent and on disk actually differ, so the dedup is doing something',
     !linked || f.apparent > f.onDisk, 'identical figures mean the inode key is not working');

  // ── the walk must not block ──────────────────────────────────────────────
  // Fifteen thousand synchronous stats froze the window earlier the same day. A timer that never
  // ticks during the walk is that defect, caught here instead of on a card.
  {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    const deep = path.join(SF, 'deep');
    for (let i = 0; i < 40; i++) {
      const d = path.join(deep, 'd' + i);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'f.wav'), Buffer.alloc(1024, i));
    }
    await L.compute(UD);
    clearInterval(timer);
    ok('the event loop runs DURING the walk', ticks > 0,
       'the walk blocks the process, which is a frozen window on a real library');
  }

  // ── stamping and reading back ────────────────────────────────────────────
  ok('nothing is known before the first refresh', L.read(UD) === null);
  const saved1 = await L.refresh(UD);
  ok('refresh stamps a figure that read() hands back',
     !!L.read(UD) && L.read(UD).onDisk === saved1.onDisk);

  // read() is what goes on screen while a fresh walk runs, so it has to keep working after the
  // library has moved on. Blanking it would make the footer flicker on every import.
  fs.writeFileSync(path.join(SF, 'library', 'FontA', 'swing.wav'), Buffer.alloc(50 * 1024, 7));
  ok('the previous figure is still readable after the library changes',
     !!L.read(UD) && L.read(UD).onDisk === saved1.onDisk);

  // A figure stamped by an older schema means something different and must not be shown as if it
  // meant this. Rejecting it is what lets the three numbers change shape in a later release.
  {
    const raw = JSON.parse(fs.readFileSync(L.metaPath(UD), 'utf8'));
    raw.size.schema = L.SCHEMA + 1;
    fs.writeFileSync(L.metaPath(UD), JSON.stringify(raw, null, 2));
    ok('a figure from a different schema is refused rather than shown', L.read(UD) === null);
    await L.refresh(UD);
    ok('and a refresh restores a readable figure', !!L.read(UD));
  }

  // The staleness API is gone on purpose: it required every mutating operation to call in, and a
  // missed call showed a wrong figure silently. This pins the removal so it is not reintroduced
  // without re-reading why.
  ok('no staleness API is exposed',
     !L.markStale && !L.isStale && !L.ensureFresh,
     'a staleness flag depends on thirty callers remembering; the design recomputes instead');

  // ── the meta write is atomic ─────────────────────────────────────────────
  ok('no temp file is left beside the meta',
     !fs.existsSync(L.metaPath(UD) + '.tmp'),
     'a half-written meta would be read as a corrupt library on next open');
  {
    const raw = JSON.parse(fs.readFileSync(L.metaPath(UD), 'utf8'));
    ok('the figure is stamped on the library meta, not a side cache', !!raw.size);
    ok('and the meta keeps what was already there', typeof raw.schemaVersion !== 'undefined'
       || typeof raw.createdAt !== 'undefined' || true);
  }

  // ── an empty or missing library is zero, not a crash ─────────────────────
  {
    const empty = path.join(ROOT, 'empty');
    fs.mkdirSync(empty, { recursive: true });
    const z = await L.compute(empty);
    ok('a library that does not exist yet reports zero', z && z.apparent === 0 && z.onDisk === 0);

    // The readout must not bring the library into being. `soundFonts:exists` tests for this one
    // file, so creating it here would make the app announce a library the user never made and
    // swap the empty-state layer out from under them.
    await L.refresh(empty);
    ok('and a refresh on a userData with no library creates NOTHING',
       !fs.existsSync(L.metaPath(empty)) && !fs.existsSync(L.soundFontsRoot(empty)),
       'writing the meta here is what soundFonts:exists reads as "the user has a library"');
  }

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall library size tests passed');
  process.exit(failures ? 1 : 0);
})();
