// "Add from library" lands pointers, not copies. [B-315]/[B-316]
//
// copyAcrossLocations was the last door writing real bytes into a font folder.
// Every other door now keeps one rule — every file in every font folder points
// at something with a home — and a single exception is enough to make the rule
// untrue, so these cases exist to hold it shut.
//
// The assertions are about inodes and link counts rather than about the code
// path taken, because "did it link" is the only question that matters and it is
// answerable from the filesystem.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const S = require('../soundFontSources');
const E = require('../soundFontEntries');
const fileOps = require('../soundFontFileOps');
const CI = require('../soundFontContentIndex');

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

const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-afl-' + t + '-'));
const ino = (p) => fs.statSync(p).ino;

// A library with one vendor source and two fonts made from it.
async function setup() {
  const picked = tmp('picked');
  fs.mkdirSync(path.join(picked, 'Ahsoka', 'extras'), { recursive: true });
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'hum.wav'), wav('HUM-VENDOR'));
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'swing1.wav'), wav('SWING-VENDOR'));
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'extras', 'quote1.wav'), wav('QUOTE-ONE'));
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'extras', 'quote2.wav'), wav('QUOTE-TWO'));
  const userData = tmp('ud');
  const imp = await S.importSource({ userData, sourcePath: picked, originalName: 'Bundle', metadata: {} });
  const a = await E.createEntry({ userData, sourceUuid: imp.uuid, candidate: { path: 'Ahsoka' }, name: 'Ahsoka' });
  const b = await E.createEntry({ userData, sourceUuid: imp.uuid, candidate: { path: 'Ahsoka' }, name: 'Ezra' });
  return {
    userData, sourceUuid: imp.uuid, a: a.name, b: b.name,
    srcFile: (rel) => path.join(S.sourcesRoot(userData), imp.uuid, 'source', 'Ahsoka', rel.replace(/\//g, path.sep)),
    entFile: (name, rel) => path.join(E.entriesRoot(userData), name, rel.replace(/\//g, path.sep)),
    pool: () => (fs.existsSync(CI.poolRoot(userData))
      ? fs.readdirSync(CI.poolRoot(userData)).filter(f => !f.startsWith('.')) : []),
  };
}

(async () => {

  {
    console.log('a file taken from another font is another NAME for it');
    const t = await setup();
    // Give font A something of its own first, so the copy is not trivially
    // satisfied by both fonts already pointing at the same source file.
    const outside = path.join(tmp('add'), 'mine.wav');
    fs.writeFileSync(outside, wav('MY-OWN-SOUND'));
    fileOps.addFilesAt({ userData: t.userData, kind: 'entry', id: t.a, subPath: '', sourceFilePaths: [outside] });

    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'entry', id: t.a }, srcPaths: ['mine.wav'],
      dest: { kind: 'entry', id: t.b, subPath: '' },
    });
    check('the copy succeeded', r && r.ok && r.added.length === 1, JSON.stringify(r));
    check('⭐ both fonts name the same file',
      ino(t.entFile(t.a, 'mine.wav')) === ino(t.entFile(t.b, 'mine.wav')));
    check('and it reads correctly in the new font',
      fs.readFileSync(t.entFile(t.b, 'mine.wav')).includes('MY-OWN-SOUND'));
    check('the pool still holds exactly one copy of it', t.pool().length === 1, JSON.stringify(t.pool()));
  }

  {
    console.log('a file taken from a SOURCE points at the source, not a new copy');
    const t = await setup();
    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'source', id: t.sourceUuid }, srcPaths: ['Ahsoka/extras/quote1.wav'],
      dest: { kind: 'entry', id: t.b, subPath: '' },
    });
    check('the copy succeeded', r && r.ok && r.added.length === 1, JSON.stringify(r));
    check('⭐ it is the source\'s own file', ino(t.entFile(t.b, 'quote1.wav')) === ino(t.srcFile('extras/quote1.wav')));
    check('and reads correctly', fs.readFileSync(t.entFile(t.b, 'quote1.wav')).includes('QUOTE-ONE'));
    check('⚠️ nothing was pooled — it already had a home in the source',
      t.pool().length === 0, JSON.stringify(t.pool()));
  }

  {
    console.log('a whole FOLDER taken from a source is pointers all the way down');
    // The directory branch is separate code from the single-file branch, so it
    // can regress on its own.
    const t = await setup();
    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'source', id: t.sourceUuid }, srcPaths: ['Ahsoka/extras'],
      dest: { kind: 'entry', id: t.b, subPath: '' },
    });
    check('the copy succeeded', r && r.ok, JSON.stringify(r));
    for (const f of ['quote1.wav', 'quote2.wav']) {
      check(`⭐ extras/${f} points at the source`,
        ino(t.entFile(t.b, `extras/${f}`)) === ino(t.srcFile(`extras/${f}`)));
    }
    check('and both read correctly',
      fs.readFileSync(t.entFile(t.b, 'extras/quote1.wav')).includes('QUOTE-ONE')
      && fs.readFileSync(t.entFile(t.b, 'extras/quote2.wav')).includes('QUOTE-TWO'));
  }

  {
    console.log('a whole FOLDER taken from another font links too');
    const t = await setup();
    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'entry', id: t.a }, srcPaths: ['extras'],
      dest: { kind: 'entry', id: t.b, subPath: '' },
    });
    check('the copy succeeded', r && r.ok, JSON.stringify(r));
    check('⭐ the nested files share inodes with the origin',
      ino(t.entFile(t.b, 'extras (1)/quote1.wav')) === ino(t.entFile(t.a, 'extras/quote1.wav'))
      || ino(t.entFile(t.b, 'extras/quote1.wav')) === ino(t.entFile(t.a, 'extras/quote1.wav')));
  }

  {
    console.log('⭐ THE INVARIANT: after every add-from-library, no font folder holds real bytes');
    // The general form of all of the above, asserted over the whole library
    // rather than per case — so a NEW copy path added later that forgets to
    // link is caught here even though nobody wrote a case for it.
    const t = await setup();
    const outside = path.join(tmp('add'), 'mine.wav');
    fs.writeFileSync(outside, wav('MY-OWN-SOUND'));
    fileOps.addFilesAt({ userData: t.userData, kind: 'entry', id: t.a, subPath: '', sourceFilePaths: [outside] });
    await fileOps.copyAcrossLocations({
      userData: t.userData, src: { kind: 'entry', id: t.a }, srcPaths: ['mine.wav'],
      dest: { kind: 'entry', id: t.b, subPath: '' } });
    await fileOps.copyAcrossLocations({
      userData: t.userData, src: { kind: 'source', id: t.sourceUuid }, srcPaths: ['Ahsoka/extras'],
      dest: { kind: 'entry', id: t.b, subPath: '' } });

    const offenders = [];
    for (const font of [t.a, t.b]) {
      (function walk(dir, rel) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) { walk(p, r); continue; }
          if (e.name === 'meta.json') continue; // the entry's own identity, never shared
          if (fs.statSync(p).nlink < 2) offenders.push(`${font}/${r}`);
        }
      })(path.join(E.entriesRoot(t.userData), font), '');
    }
    check('every content file in every font is a pointer', offenders.length === 0,
      offenders.join(', '));
  }

  {
    console.log('a link failure still lands the file rather than losing it');
    // The fallback matters more than the optimisation: a filesystem that will
    // not hardlink must cost space, never a missing sound. Simulated by copying
    // to a destination on another volume is not possible here, so this asserts
    // the weaker but checkable half — a source file that is genuinely absent
    // reports failure instead of silently producing an empty file.
    const t = await setup();
    const r = await fileOps.copyAcrossLocations({
      userData: t.userData,
      src: { kind: 'source', id: t.sourceUuid }, srcPaths: ['Ahsoka/does-not-exist.wav'],
      dest: { kind: 'entry', id: t.b, subPath: '' },
    });
    check('it is reported as failed', r.failed.length === 1 && r.added.length === 0, JSON.stringify(r));
    check('and no stub was left behind', !fs.existsSync(t.entFile(t.b, 'does-not-exist.wav')));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
