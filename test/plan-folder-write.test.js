// What a Replace actually has to write.                    [B-005 item 7b, 2026-09-26]
//
// ⭐⭐ THE DEFECT THIS EXISTS TO CLOSE was measured, not argued: detection is per-file, the WRITE
// was not. One wav deleted from a font outside the app was caught instantly and for free, and
// Replace then rewrote the whole 44.6 MB folder to restore 2.1 MB. A second case had NOTHING to
// write - two fonts differed only because files had been added to them on the card - and Replace
// moved 64.3 MB anyway.
//
// ⚠️⚠️ SO THE TWO HALVES ARE TESTED AS A PAIR. Replace means MAKE IT MATCH. An additive write
// that never removes leaves the extras behind, which is the opposite of what Replace was asked
// for; a removing write that re-copies everything is the cost this is here to avoid. A plan that
// gets one half right and the other wrong looks correct in whichever direction you test first.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const entries = require('../soundFontEntries');
const sync = require('../sfSyncManifest');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const write = (root, files) => {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
};

// One library font and a destination folder of the caller's choosing.
function setup(libFiles, cardFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-plan-write-'));
  const userData = path.join(root, 'userData');
  const dest = path.join(root, 'card');
  const libDir = path.join(userData, 'soundFonts', 'library', 'Ahsoka');
  fs.mkdirSync(libDir, { recursive: true });
  write(libDir, libFiles);
  // No entryUuid, so the records come from a live walk - the path a freshly imported font takes.
  fs.writeFileSync(path.join(libDir, 'meta.json'), JSON.stringify({ schemaVersion: 1, name: 'Ahsoka' }));
  if (cardFiles !== null) write(path.join(dest, 'Ahsoka'), cardFiles);
  return { userData, dest };
}

const FONT = {
  'hum.wav':           'AAAA-hum',
  'swing1.wav':        'BBBB-swing',
  'bgndrag/drag1.wav': 'CCCC-drag',
};

const sorted = (a) => [...a].sort();

(async () => {
  {
    // ⭐⭐ THE CONTROL, and the whole point: an identical folder is NO WORK AT ALL.
    const { userData, dest } = setup(FONT, FONT);
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok('an identical folder writes nothing and removes nothing',
       p.ok && p.toWrite.length === 0 && p.toDisplace.length === 0 && p.unchanged === 3,
       `if this is wrong every other case is meaningless. Got ${JSON.stringify(p)}`);
  }

  {
    // ⭐ The first measured case: one file gone from the card. Write ONE file, not the folder.
    const card = { ...FONT };
    delete card['swing1.wav'];
    const { userData, dest } = setup(FONT, card);
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok('⭐⭐ a missing file plans exactly that one file',
       JSON.stringify(p.toWrite) === JSON.stringify(['swing1.wav']) && p.unchanged === 2,
       'this is the 44.6 MB rewrite to restore 2.1 MB. Got ' + JSON.stringify(p.toWrite));
    ok('and nothing is displaced', p.toDisplace.length === 0);
  }

  {
    // ⭐⭐ The purer measured case: nothing to WRITE at all, only extras to remove.
    const { userData, dest } = setup(FONT, { ...FONT, 'song1.wav': 'XXXX', 'bgndrag/song2.wav': 'YYYY' });
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok('⭐⭐ extras alone mean ZERO bytes written',
       p.toWrite.length === 0 && p.bytesToWrite === 0,
       'Replace moved 64.3 MB across two fonts to achieve what two deletes would have done');
    ok('⭐⭐ and both extras are displaced, including the nested one',
       JSON.stringify(sorted(p.toDisplace)) === JSON.stringify(['bgndrag/song2.wav', 'song1.wav']),
       'an additive write that never removes leaves these behind, which is not what Replace means. '
       + `Got ${JSON.stringify(p.toDisplace)}`);
  }

  {
    // Changed content, same name. The one case that genuinely needs the hash.
    const { userData, dest } = setup(FONT, { ...FONT, 'hum.wav': 'DIFFERENT-CONTENT' });
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok('⭐ a file whose CONTENT changed is written',
       JSON.stringify(p.toWrite) === JSON.stringify(['hum.wav']) && p.unchanged === 2,
       `got ${JSON.stringify(p.toWrite)}`);
    ok('⚠️ and it had to be read to know that', p.hashed >= 1,
       'with no manifest there is nothing to reuse, so the destination file must be hashed');
  }

  {
    // ⚠️⚠️ SAME BASENAME IN TWO FOLDERS. A font is folders of wavs and `hum.wav` recurs; a plan
    // keyed on basename writes or skips both together. This is why the copy filter had to start
    // receiving the relative path.
    const lib = { 'hum.wav': 'ROOT-HUM', 'bgnmelt/hum.wav': 'MELT-HUM' };
    const card = { 'hum.wav': 'ROOT-HUM', 'bgnmelt/hum.wav': 'WRONG' };
    const { userData, dest } = setup(lib, card);
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok('⭐⭐ the nested twin is written and the root one is left alone',
       JSON.stringify(p.toWrite) === JSON.stringify(['bgnmelt/hum.wav']) && p.unchanged === 1,
       `keying on basename copies both or neither. Got ${JSON.stringify(p.toWrite)}`);
  }

  {
    // ⭐⭐ THE MANIFEST IS WHAT MAKES THE PLAN CHEAP. With valid records nothing is read at all.
    const { userData, dest } = setup(FONT, FONT);
    const warm = await entries.planFolderWrite(userData, 'Ahsoka', dest);   // cold: hashes
    const obs = [];
    for (const r of ['hum.wav', 'swing1.wav', 'bgndrag/drag1.wav']) {
      const st = fs.statSync(path.join(dest, 'Ahsoka', r));
      const { hashFile } = require('../soundFontFileHash');
      obs.push([r, [st.size, Math.round(st.mtimeMs), hashFile(path.join(dest, 'Ahsoka', r))]]);
    }
    sync.mergeItems(dest, { Ahsoka: obs });
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok(`⭐⭐ a recorded folder is planned with NO reads (cold hashed ${warm.hashed})`,
       p.hashed === 0 && p.reused === 3 && p.toWrite.length === 0,
       'this is the whole saving - on a board card a read is the expensive thing, and the plan '
       + `must not pay for one to learn what is already written down. Got ${JSON.stringify(p)}`);
  }

  {
    // ⚠️⚠️ A STALE RECORD CLAIMING THE FILE ALREADY MATCHES. This is the dangerous direction and
    // the only one that proves the guard: the card's copy differs from the library, but an old
    // record still carries the LIBRARY's hash for it, at the right size and a stale mtime.
    //   guard on  -> the record is invalid, the file is read, the difference is found, it is written
    //   guard off -> the record is believed, the file reads as matching, and it is NEVER WRITTEN
    // ⚠️ An earlier version of this case used a WRONG hash in the record, so the file was written
    // either way and the assertion passed without testing anything. Mutation testing caught it.
    const { hashFile } = require('../soundFontFileHash');
    const { userData, dest } = setup(FONT, { ...FONT, 'hum.wav': 'XXXX-hum' });   // same length
    const libHash = hashFile(path.join(userData, 'soundFonts', 'library', 'Ahsoka', 'hum.wav'));
    const cardSize = fs.statSync(path.join(dest, 'Ahsoka', 'hum.wav')).size;
    sync.mergeItems(dest, { Ahsoka: [['hum.wav', [cardSize, 1, libHash]]] });
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok('⭐⭐ a stale record claiming a match is re-read, not believed',
       p.toWrite.includes('hum.wav'),
       'believing it skips the only read that would have noticed, and the card keeps the wrong '
       + `file while the export reports success. Got toWrite=${JSON.stringify(p.toWrite)}`);
    ok('⚠️ and the reuse count proves it was not taken from the record',
       p.reused === 0,
       'hum.wav holds the only record in this fixture and it is stale, so NOTHING may be reused. '
       + `Believing it makes this 1. Got reused=${p.reused}`);
  }

  {
    // ⚠️ EMPTY DIRECTORIES ARE `<empty>` MARKERS, NOT FILES. They carry no content to compare,
    // and the copy walker creates directories itself - counting them reports work that does not
    // exist and asks the writer for a file that was never there.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-plan-empty-'));
    const userData = path.join(root, 'userData');
    const dest = path.join(root, 'card');
    const libDir = path.join(userData, 'soundFonts', 'library', 'Ahsoka');
    fs.mkdirSync(path.join(libDir, 'emptyfolder'), { recursive: true });
    write(libDir, FONT);
    fs.writeFileSync(path.join(libDir, 'meta.json'), JSON.stringify({ schemaVersion: 1, name: 'Ahsoka' }));
    write(path.join(dest, 'Ahsoka'), FONT);
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok('⭐⭐ an empty library folder is not planned as a file to write',
       p.toWrite.length === 0 && p.libFiles === 3,
       'a `<empty>` marker has no bytes and no destination file, so it can never match and would '
       + `be written forever. Got toWrite=${JSON.stringify(p.toWrite)} libFiles=${p.libFiles}`);
  }

  {
    // ⚠️ A cancel returns with no plan at all. A HALF plan is the dangerous shape: its
    // `toDisplace` would be complete while its `toWrite` was not, so acting on it would delete
    // files whose replacements were never planned.
    const { userData, dest } = setup(FONT, FONT);
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest, { shouldStop: () => true });
    ok('⭐⭐ a cancel yields no plan, not a partial one',
       p.ok === true && p.canceled === true && !p.toWrite && !p.toDisplace,
       `a partial plan removes files it never planned to replace. Got ${JSON.stringify(p)}`);
  }

  {
    // A folder that is not on the card yet: everything is written, nothing is displaced.
    const { userData, dest } = setup(FONT, null);
    const p = await entries.planFolderWrite(userData, 'Ahsoka', dest);
    ok('a font absent from the card plans every file',
       sorted(p.toWrite).length === 3 && p.toDisplace.length === 0 && p.unchanged === 0,
       `got ${JSON.stringify(p)}`);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nplan-folder-write: all passing');
  process.exit(failed ? 1 : 0);
})();
