// The re-link sweep finds identical files held as separate copies and stores them once. [B-501]
//
// Ordinary things break the library's hard links without losing anything - a hand copy, a restore
// across drives, a sync tool - and the library silently grows (2026-10-21: 1.75 GiB held apart).
// The sweep repairs it, verifies bytes before every swap, and is safe to stop at any point.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const S = require('../soundFontSources.js');
const R = require('../soundFontRelink.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-rl-${n}-`)); dirs.push(d); return d; };
const ino = (p) => fs.statSync(p, { bigint: true }).ino;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// Two sources, each its own copy on disk of the same two tracks, plus one file of their own.
async function library() {
  const ud = tmp('ud');
  for (const [uuid, own] of [['src-a', 'A'], ['src-b', 'B']]) {
    const root = path.join(S.sourcesRoot(ud), uuid, 'source', uuid);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(S.sourcesRoot(ud), uuid, 'meta.json'),
      JSON.stringify({ schemaVersion: 1, uuid, format: 'folder', originalName: uuid, importedAt: '2026-10-01T00:00:00.000Z' }));
    fs.writeFileSync(path.join(root, 'track1.wav'), Buffer.alloc(300 * 1024, 7));
    fs.writeFileSync(path.join(root, 'track2.wav'), Buffer.alloc(200 * 1024, 9));
    fs.writeFileSync(path.join(root, 'own.wav'), Buffer.alloc(50 * 1024, own.charCodeAt(0)));
    await S.ensureSourceManifest(ud, uuid);
  }
  const p = (uuid, f) => path.join(S.sourcesRoot(ud), uuid, 'source', uuid, f);
  return { ud, p };
}

(async () => {
  console.log('two sources holding the same tracks as separate copies');
  {
    const { ud, p } = await library();
    check('precondition: the shared track is two separate copies', ino(p('src-a', 'track1.wav')) !== ino(p('src-b', 'track1.wav')));
    const before = ['track1.wav', 'track2.wav', 'own.wav'].flatMap((f) => [sha(p('src-a', f)), sha(p('src-b', f))]);
    const r = await R.relinkLibrary(ud);
    check('THE SHARED TRACKS ARE STORED ONCE', ino(p('src-a', 'track1.wav')) === ino(p('src-b', 'track1.wav'))
      && ino(p('src-a', 'track2.wav')) === ino(p('src-b', 'track2.wav')), JSON.stringify(r));
    check('and it reports the space freed', r.relinked === 2 && r.savedBytes === 500 * 1024, JSON.stringify(r));
    check('each source keeps its own different file', ino(p('src-a', 'own.wav')) !== ino(p('src-b', 'own.wav')));
    const after = ['track1.wav', 'track2.wav', 'own.wav'].flatMap((f) => [sha(p('src-a', f)), sha(p('src-b', f))]);
    check('EVERY FILE READS EXACTLY AS BEFORE', JSON.stringify(before) === JSON.stringify(after));
    const again = await R.relinkLibrary(ud);
    check('a second sweep has nothing to do', again.relinked === 0 && again.groups === 0, JSON.stringify(again));
  }

  console.log('stopping');
  {
    const { ud, p } = await library();
    const r = await R.relinkLibrary(ud, { shouldStop: () => true });
    check('a stop before it starts changes nothing', r.stopped && r.relinked === 0
      && ino(p('src-a', 'track1.wav')) !== ino(p('src-b', 'track1.wav')), JSON.stringify(r));
    // An interrupted run leaves one temporary link beside the name it was replacing.
    fs.linkSync(p('src-a', 'track1.wav'), p('src-b', 'track1.wav') + R.TMP);
    const r2 = await R.relinkLibrary(ud);
    check("AN INTERRUPTED RUN'S LEFTOVER IS CLEANED UP", !fs.existsSync(p('src-b', 'track1.wav') + R.TMP) && r2.cleaned === 1,
      JSON.stringify(r2));
    check('and the sweep then completes', ino(p('src-a', 'track1.wav')) === ino(p('src-b', 'track1.wav')));
  }

  console.log('a manifest behind its file');
  {
    const { ud, p } = await library();
    // The file changed on disk after its hash was recorded: it must not be swapped on the record's word.
    fs.rmSync(p('src-b', 'track2.wav'));
    fs.writeFileSync(p('src-b', 'track2.wav'), Buffer.alloc(200 * 1024, 1));
    const r = await R.relinkLibrary(ud);
    check('A FILE WHOSE BYTES NO LONGER MATCH IS LEFT ALONE', sha(p('src-b', 'track2.wav')) !== sha(p('src-a', 'track2.wav'))
      && ino(p('src-b', 'track2.wav')) !== ino(p('src-a', 'track2.wav')), JSON.stringify(r));
    check('while the true duplicate is still linked', ino(p('src-a', 'track1.wav')) === ino(p('src-b', 'track1.wav')));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
