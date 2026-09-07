// Dedup ACROSS sources, at import. [B-317]
//
// §13 dedup only ever looked WITHIN one bundle, so two vendors shipping the same
// wav — or the same font bought twice under different names — were stored twice.
//
// These cases go through the REAL importSource rather than calling the linking
// helper directly. That is deliberate: a helper that works and is never reached
// is the failure mode this project has actually had, and a test that calls it
// directly cannot tell the difference. Every assertion here is about inodes on
// disk after an ordinary import.
//
// ⚠️ EVERY SOURCE HERE GETS AN ENTRY, because the app does. An entry-less source
// is swept by cleanupOrphanSources on the next import — designed behaviour, and
// the first draft of this file imported bare sources and watched them vanish
// between cases.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const S = require('../soundFontSources');
const E = require('../soundFontEntries');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` - ${detail}` : ''}`);
}

function wav(payload) {
  const data = Buffer.from(payload);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii'); head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(44100, 24); head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-xsrc-' + t + '-'));
const ino = (p) => { const s = fs.statSync(p); return `${s.dev}:${s.ino}`; };

function pickFolder(files) {
  const dir = tmp('pick');
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

const srcFile = (userData, uuid, rel) =>
  path.join(S.sourcesRoot(userData), uuid, 'source', rel.replace(/\//g, path.sep));

// Import a bundle and curate the font inside it, which is the ordinary path and
// the only one that leaves a source standing.
async function importFont(userData, files, entryName) {
  const imp = await S.importSource({
    userData, sourcePath: pickFolder(files), originalName: entryName + ' Bundle', metadata: {},
  });
  if (!imp.ok || imp.isDuplicate) return imp;
  const candidatePath = Object.keys(files)[0].split('/')[0];
  await E.createEntry({ userData, sourceUuid: imp.uuid, candidate: { path: candidatePath }, name: entryName });
  return imp;
}

(async () => {

  {
    console.log('two vendors shipping the same wav store it once');
    const userData = tmp('ud');
    const a = await importFont(userData, {
      'Ahsoka/hum.wav': wav('SHARED-HUM'), 'Ahsoka/swing1.wav': wav('A-SWING') }, 'Ahsoka');
    const b = await importFont(userData, {
      'Ezra/hum.wav': wav('SHARED-HUM'), 'Ezra/clash1.wav': wav('B-CLASH') }, 'Ezra');

    check('both imported as separate sources', a.ok && b.ok && a.uuid !== b.uuid,
      JSON.stringify({ a: a.uuid, b: b.uuid }));
    check('⭐ the shared sound is ONE file on disk',
      ino(srcFile(userData, a.uuid, 'Ahsoka/hum.wav')) === ino(srcFile(userData, b.uuid, 'Ezra/hum.wav')));
    check('and each bundle still reads its own bytes correctly',
      fs.readFileSync(srcFile(userData, b.uuid, 'Ezra/hum.wav')).includes('SHARED-HUM'));
    check('⚠️ content unique to each bundle is NOT shared',
      ino(srcFile(userData, a.uuid, 'Ahsoka/swing1.wav')) !== ino(srcFile(userData, b.uuid, 'Ezra/clash1.wav')));
  }

  {
    console.log('⭐ every original path still opens and reads what the vendor shipped');
    // The direction that matters. A source that got SMALLER without staying WHOLE
    // is unrecoverable — the vendor's copy is the only one there was.
    const userData = tmp('ud');
    const filesA = { 'A/hum.wav': wav('H'), 'A/swing1.wav': wav('S'), 'A/font.txt': 'meta' };
    const filesB = { 'B/hum.wav': wav('H'), 'B/swing1.wav': wav('S'), 'B/clash1.wav': wav('C') };
    const a = await importFont(userData, filesA, 'A');
    const b = await importFont(userData, filesB, 'B');

    let whole = true; const missing = [];
    for (const [uuid, files] of [[a.uuid, filesA], [b.uuid, filesB]]) {
      for (const [rel, body] of Object.entries(files)) {
        const abs = srcFile(userData, uuid, rel);
        if (!fs.existsSync(abs) || !fs.readFileSync(abs).equals(Buffer.from(body))) {
          whole = false; missing.push(rel);
        }
      }
    }
    check('both bundles are complete and byte-exact after linking', whole, missing.join(', '));
    check('and the two shared sounds really are shared',
      ino(srcFile(userData, a.uuid, 'A/hum.wav')) === ino(srcFile(userData, b.uuid, 'B/hum.wav'))
      && ino(srcFile(userData, a.uuid, 'A/swing1.wav')) === ino(srcFile(userData, b.uuid, 'B/swing1.wav')));
  }

  {
    console.log('deleting one source leaves the other whole');
    // The retention rule, exercised rather than argued: the surviving name keeps
    // the content alive, so there is nothing to refcount and no guard to write.
    const userData = tmp('ud');
    const a = await importFont(userData, { 'A/hum.wav': wav('SHARED') }, 'A');
    const b = await importFont(userData, { 'B/hum.wav': wav('SHARED'), 'B/extra.wav': wav('X') }, 'B');
    fs.rmSync(path.join(S.sourcesRoot(userData), a.uuid), { recursive: true, force: true });

    check('⭐ the survivor still reads its audio',
      fs.readFileSync(srcFile(userData, b.uuid, 'B/hum.wav')).includes('SHARED'));
    check('and nothing dangles', fs.statSync(srcFile(userData, b.uuid, 'B/hum.wav')).isFile());
  }

  {
    console.log('the source identity hash does not depend on what else is in the library');
    // `hash` is what a source IS. If linking ran before it were computed, or if
    // it folded in storage decisions, re-import recognition would start depending
    // on library contents at the time — which is not a property identity may have.
    const files = { 'A/hum.wav': wav('H'), 'A/swing1.wav': wav('S') };
    const empty = tmp('ud1');
    const solo = await importFont(empty, files, 'A');

    const populated = tmp('ud2');
    await importFont(populated, { 'Z/hum.wav': wav('H'), 'Z/other.wav': wav('O') }, 'Z');
    const withNeighbour = await importFont(populated, files, 'A');

    check('⭐ the same bundle hashes the same either way', solo.hash === withNeighbour.hash,
      `${solo.hash} vs ${withNeighbour.hash}`);
    check('and the second one really did share a file with its neighbour, so the case is live',
      fs.statSync(srcFile(populated, withNeighbour.uuid, 'A/hum.wav')).nlink >= 2,
      `nlink=${fs.statSync(srcFile(populated, withNeighbour.uuid, 'A/hum.wav')).nlink}`);
  }

  {
    console.log('re-importing the identical bundle is still recognised as a duplicate');
    // Linking must not disturb the dedup answer the import already gives.
    const userData = tmp('ud');
    const files = { 'A/hum.wav': wav('H'), 'A/swing1.wav': wav('S') };
    const first = await importFont(userData, files, 'A');
    const again = await S.importSource({ userData, sourcePath: pickFolder(files), originalName: 'A Bundle', metadata: {} });
    check('the second import reports a duplicate of the first',
      again.isDuplicate === true && again.uuid === first.uuid, JSON.stringify(again));
  }

  {
    console.log('a source imported into an empty library is left alone');
    const userData = tmp('ud');
    const r = await importFont(userData, { 'A/hum.wav': wav('H') }, 'A');
    check('it imports cleanly with nothing to link against', r.ok);
    // One name for the source and one for the entry that was just made from it —
    // that is the [B-309] pointer, not cross-source sharing.
    check('and its file is shared only with its own font',
      fs.statSync(srcFile(userData, r.uuid, 'A/hum.wav')).nlink === 2,
      String(fs.statSync(srcFile(userData, r.uuid, 'A/hum.wav')).nlink));
  }

  {
    console.log('⚠️ a source whose manifest is behind its files is not linked over');
    // The failure this must never have: the index says a path holds H, the path
    // has since changed, and the new bundle is pointed at the wrong sound. Here
    // the damage is on the CANDIDATE side, which is what findExisting re-hashes
    // for.
    const userData = tmp('ud');
    const a = await importFont(userData, { 'A/hum.wav': wav('SHARED') }, 'A');
    // Tamper behind the manifest's back, exactly as a hand-edit would.
    fs.writeFileSync(srcFile(userData, a.uuid, 'A/hum.wav'), wav('TAMPERED-DIFFERENT'));

    const b = await importFont(userData, { 'B/hum.wav': wav('SHARED'), 'B/x.wav': wav('X') }, 'B');
    check('⭐ the new bundle keeps the bytes it actually shipped',
      fs.readFileSync(srcFile(userData, b.uuid, 'B/hum.wav')).includes('SHARED'));
    check('and was NOT pointed at the tampered file',
      ino(srcFile(userData, b.uuid, 'B/hum.wav')) !== ino(srcFile(userData, a.uuid, 'A/hum.wav')));
  }

  {
    console.log('a ZIP source is deduped against the library too');
    // The zip route reaches the linking pass through a different branch of
    // importSource than the folder route, so it needs its own case — otherwise
    // half the feature could be missing and every other test here would pass.
    const userData = tmp('ud');
    const a = await importFont(userData, { 'A/hum.wav': wav('SHARED-HUM') }, 'A');

    const zipDir = pickFolder({ 'B/hum.wav': wav('SHARED-HUM'), 'B/x.wav': wav('X') });
    const zipPath = path.join(tmp('zip'), 'bundle.zip');
    await S.zipFolderToFile(zipDir, zipPath);
    const z = await S.importSource({ userData, sourcePath: zipPath, originalName: 'Zip Bundle', metadata: {} });
    check('the zip imported', z.ok && !z.isDuplicate, JSON.stringify(z).slice(0, 200));
    // The close-out's savings sentence anchors on the picked file's own size
    // ("Your download started at ..."), so the import result must carry it.
    // A folder has no container and must report 0, which tells the close-out
    // to anchor on contentBytes instead. ([B-317], 2026-09-07.)
    check('the zip route reports the archive\'s own size for the close-out anchor',
      z.archiveBytes === fs.statSync(zipPath).size,
      `archiveBytes=${z.archiveBytes} stat=${fs.statSync(zipPath).size}`);
    check('and the folder route reports no archive size',
      a.archiveBytes === 0, String(a.archiveBytes));
    if (z.ok && !z.isDuplicate) {
      await E.createEntry({ userData, sourceUuid: z.uuid, candidate: { path: 'B' }, name: 'B' });
      const zHum = srcFile(userData, z.uuid, 'B/hum.wav');
      check('⭐ its shared sound reads correctly', fs.readFileSync(zHum).includes('SHARED-HUM'));
      check('and it is the same file as the folder bundle\'s',
        ino(zHum) === ino(srcFile(userData, a.uuid, 'A/hum.wav')));
      check('while its own unique sound is not shared with anything',
        fs.statSync(srcFile(userData, z.uuid, 'B/x.wav')).nlink === 2,
        String(fs.statSync(srcFile(userData, z.uuid, 'B/x.wav')).nlink));
    }
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
