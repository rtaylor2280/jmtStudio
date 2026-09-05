// A library entry is a folder of POINTERS into its source, not a second copy. [B-309]
//
// His spec, 2026-09-04: "a font folder is a folder full of pointers if you don't
// customize. You can rename a pointer without renaming its file it comes from.
// You can delete a pointer and it has no effect on the original either. I can also
// add to this... they live only in that font folder."
//
// Each case below is one clause of that. The last section is different in kind: it
// guards the invariant the whole design rests on, so that the day someone adds a
// write-in-place the suite says so instead of the vendor's audio quietly changing.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const S = require('../soundFontSources');
const E = require('../soundFontEntries');
const fileOps = require('../soundFontFileOps');

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

const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-ptr-' + t + '-'));

// Import a real source, then make an entry from it — the actual pipeline, not a
// hand-built approximation, so the test cannot pass on a shape the app never makes.
async function setup() {
  const picked = tmp('picked');
  fs.mkdirSync(path.join(picked, 'Ahsoka'), { recursive: true });
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'hum.wav'), wav('HUM-VENDOR'));
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'swing1.wav'), wav('SWING-VENDOR'));
  const userData = tmp('ud');
  const imp = await S.importSource({ userData, sourcePath: picked, originalName: 'Bundle', metadata: {} });
  const ent = await E.createEntry({
    userData, sourceUuid: imp.uuid, candidate: { path: 'Ahsoka' }, name: 'Ahsoka',
  });
  return {
    userData, sourceUuid: imp.uuid, entryName: ent.name,
    srcFile: (rel) => path.join(S.sourcesRoot(userData), imp.uuid, 'source', 'Ahsoka', rel),
    entFile: (rel) => path.join(E.entriesRoot(userData), ent.name, rel),
  };
}

(async () => {
  {
    console.log('an unmodified font folder is pointers, not copies');
    const t = await setup();
    const a = fs.statSync(t.srcFile('hum.wav')), b = fs.statSync(t.entFile('hum.wav'));
    check('⭐ the entry file IS the source file', a.ino === b.ino, `${a.ino} vs ${b.ino}`);
    check('link count reflects both names', b.nlink === 2, String(b.nlink));
    check('and it reads correctly', fs.readFileSync(t.entFile('hum.wav')).includes('HUM-VENDOR'));
  }

  {
    console.log('renaming a pointer does not rename its source file');
    const t = await setup();
    const r = fileOps.renameFileAt({
      userData: t.userData, kind: 'entry', id: t.entryName,
      subPath: 'hum.wav', newName: 'hum01.wav',
    });
    check('the rename succeeded', r && r.ok !== false, JSON.stringify(r));
    check('the entry now has the new name', fs.existsSync(t.entFile('hum01.wav')));
    check('⭐ the source still has its own name', fs.existsSync(t.srcFile('hum.wav')));
    check('and they are still the same content',
      fs.statSync(t.entFile('hum01.wav')).ino === fs.statSync(t.srcFile('hum.wav')).ino);
  }

  {
    console.log('deleting a pointer does not touch the original');
    const t = await setup();
    const r = fileOps.deleteFilesAt({
      userData: t.userData, kind: 'entry', id: t.entryName, subPaths: ['hum.wav'],
    });
    check('the delete succeeded', r && r.ok !== false, JSON.stringify(r));
    check('the entry no longer has it', !fs.existsSync(t.entFile('hum.wav')));
    check('⭐ the source still does', fs.existsSync(t.srcFile('hum.wav')));
    check('and its bytes are intact',
      fs.readFileSync(t.srcFile('hum.wav')).includes('HUM-VENDOR'));
    check('the link count dropped rather than the file dying',
      fs.statSync(t.srcFile('hum.wav')).nlink === 1);
  }

  {
    console.log('a file added to the font folder lives only there');
    const t = await setup();
    const outside = path.join(tmp('add'), 'custom.wav');
    fs.writeFileSync(outside, wav('MY-OWN-SOUND'));
    const r = fileOps.addFilesAt({
      userData: t.userData, kind: 'entry', id: t.entryName,
      subPath: '', sourceFilePaths: [outside],
    });
    check('the add succeeded', r && r.ok, JSON.stringify(r && r.failed));
    check('the entry has it', fs.existsSync(t.entFile('custom.wav')));
    check('⭐ the source does NOT', !fs.existsSync(t.srcFile('custom.wav')));
    // This asserted nlink === 1 until [B-316] gave added content a home of its
    // own. An added file is now stored in the pool and the entry holds a link to
    // it, so the count is 2 — the change the entry asked for, not a regression.
    // What the old line was really protecting is that adding a file must never
    // reach into the vendor's copy, and that is asserted directly below rather
    // than through a count that only happened to imply it.
    const added = fs.statSync(t.entFile('custom.wav'));
    check('⭐ it shares nothing with the source bundle', (() => {
      const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
      return walk(path.join(S.sourcesRoot(t.userData), t.sourceUuid))
        .every(p => fs.statSync(p).ino !== added.ino);
    })());
    check('and it has a home outside the font, so deleting the font cannot lose it',
      added.nlink >= 2, `nlink=${added.nlink}`);
  }

  {
    console.log('deleting the source leaves the font working');
    const t = await setup();
    // The whole reason hardlinks were chosen over a reference table: there is no
    // in-use guard to write, because the content outlives any single name.
    fs.rmSync(path.join(S.sourcesRoot(t.userData), t.sourceUuid), { recursive: true, force: true });
    check('⭐ the entry still reads its audio',
      fs.readFileSync(t.entFile('hum.wav')).includes('HUM-VENDOR'));
    check('nothing dangles - it is a real file', fs.statSync(t.entFile('hum.wav')).isFile());
  }

  {
    console.log('⚠️  THE INVARIANT: nothing may write content through a shared name');
    // This does NOT test app code. It demonstrates the failure mode the design
    // forbids, so the reason for the rule is executable rather than a comment
    // someone has to read and believe.
    const t = await setup();
    const before = fs.readFileSync(t.srcFile('hum.wav'));
    fs.writeFileSync(t.entFile('hum.wav'), wav('EDITED-IN-PLACE'));
    const after = fs.readFileSync(t.srcFile('hum.wav'));
    check('writing in place DOES reach the source (this is why the rule exists)',
      !before.equals(after));

    // And the real assertion: every writer the app actually has must avoid it.
    // Each of these is a rename, an unlink, or a create-with-a-free-name.
    const t2 = await setup();
    const srcIno = fs.statSync(t2.srcFile('hum.wav')).ino;
    const srcBytes = fs.readFileSync(t2.srcFile('hum.wav'));
    const outside = path.join(tmp('add2'), 'hum.wav');           // SAME name as a pointer
    fs.writeFileSync(outside, wav('COLLIDING-NAME'));
    fileOps.addFilesAt({
      userData: t2.userData, kind: 'entry', id: t2.entryName,
      subPath: '', sourceFilePaths: [outside],
    });
    check('⭐ adding a file whose NAME collides did not overwrite the pointer',
      fs.readFileSync(t2.srcFile('hum.wav')).equals(srcBytes));
    check('the source file is still the same inode',
      fs.statSync(t2.srcFile('hum.wav')).ino === srcIno);
    check('the added file landed under a free name instead',
      fs.readdirSync(path.dirname(t2.entFile('hum.wav'))).some(
        n => /hum/i.test(n) && n !== 'hum.wav'),
      fs.readdirSync(path.dirname(t2.entFile('hum.wav'))).join(', '));
  }

  {
    console.log('duplicating a font shares its bytes, and keeps its own identity');
    const t = await setup();
    const dupC = await E.duplicateEntry({
      userData: t.userData, sourceName: t.entryName, newName: 'Copy_current', mode: 'current',
    });
    const dupS = await E.duplicateEntry({
      userData: t.userData, sourceName: t.entryName, newName: 'Copy_source', mode: 'source',
    });
    check('both duplicates were created', dupC.ok && dupS.ok, JSON.stringify([dupC.error, dupS.error]));
    const f = (n, rel) => path.join(E.entriesRoot(t.userData), n, rel);
    check('⭐ Duplicate shares bytes with the original',
      fs.statSync(f('Copy_current', 'hum.wav')).ino === fs.statSync(t.entFile('hum.wav')).ino);
    check('⭐ Duplicate-from-source shares them too',
      fs.statSync(f('Copy_source', 'hum.wav')).ino === fs.statSync(t.srcFile('hum.wav')).ino);

    // ⚠️ The case that nearly shipped: meta.json must NOT be shared, because the
    // duplicate rewrites it. A link here would rename the ORIGINAL font.
    check('⚠️ meta.json is NOT shared between the two',
      fs.statSync(f('Copy_current', 'meta.json')).ino !== fs.statSync(t.entFile('meta.json')).ino);
    const origMeta = JSON.parse(fs.readFileSync(t.entFile('meta.json'), 'utf8'));
    check('⭐ and the original still knows its own name',
      origMeta.name === t.entryName, origMeta.name);
    const dupMeta = JSON.parse(fs.readFileSync(f('Copy_current', 'meta.json'), 'utf8'));
    check('while the duplicate has its own', dupMeta.name === 'Copy_current', dupMeta.name);
    check('and its own entryUuid', dupMeta.entryUuid !== origMeta.entryUuid);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
