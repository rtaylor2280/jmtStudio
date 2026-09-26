// A font folder holding files the library does not have is NOT a match.
//
// The per-file comparison walks the LIBRARY's file list and looks each one up at the destination,
// so anything extra in the card's folder is invisible to it: every library file matches, the
// folder reports as ours, and the card quietly holds content we never put there.
//
// That is not academic. Drop three tracks into a font on the card, then try to replace the font
// from your library to get rid of them: the app says it already matches, never offers Replace,
// and there is no way to remove them through it. Replace already deletes the whole folder when it
// runs - the missing piece was only ever the verdict that lets it be offered.
//
// Run against the real `entryMatchesAt` rather than a hand-built input, because the defect lives
// in what the function chooses to look at.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { entryMatchesAt } = require('../soundFontEntries');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

// One library font, and a destination folder of the caller's choosing.
function setup(libFiles, cardFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-entry-extra-'));
  const userData = path.join(root, 'userData');
  const dest = path.join(root, 'card');
  const libDir = path.join(userData, 'soundFonts', 'library', 'Ahsoka');
  fs.mkdirSync(libDir, { recursive: true });
  write(libDir, libFiles);
  // No entryUuid, so the compare falls back to walking the library folder - which is the path a
  // freshly imported font takes anyway.
  fs.writeFileSync(path.join(libDir, 'meta.json'),
    JSON.stringify({ schemaVersion: 1, name: 'Ahsoka' }));
  if (cardFiles !== null) write(path.join(dest, 'Ahsoka'), cardFiles);
  return { userData, dest, root };
}

const FONT = {
  'hum.wav':            'AAAA-hum',
  'swing1.wav':         'BBBB-swing',
  'bgndrag/drag1.wav':  'CCCC-drag',
};

(async () => {
  {
    const { userData, dest } = setup(FONT, FONT);
    const r = await entryMatchesAt(userData, 'Ahsoka', dest);
    ok('a card folder matching the library is identical',
       r.ok === true && r.exists === true && r.identical === true,
       `the control: if this fails nothing below means anything. Got ${JSON.stringify(r)}`);
  }

  {
    // ⭐ The reported case: three files added to the card that the library never had.
    const { userData, dest } = setup(FONT, {
      ...FONT,
      'song1.wav': 'XXXX', 'song2.wav': 'YYYY', 'song3.wav': 'ZZZZ',
    });
    const r = await entryMatchesAt(userData, 'Ahsoka', dest);
    ok('⭐⭐ extra files on the card make the folder DIFFER',
       r.exists === true && r.identical === false,
       'every library file still matches, so without a look at what else is in that folder the '
       + 'app reports a match and Replace is never offered');
  }

  {
    // ⚠️ Nested, because the walk has to recurse. A font is folders of wavs, and an extra file
    // one level down is the same problem wearing a subdirectory.
    const { userData, dest } = setup(FONT, { ...FONT, 'bgndrag/song.wav': 'XXXX' });
    const r = await entryMatchesAt(userData, 'Ahsoka', dest);
    ok('⚠️ and an extra file in a SUBFOLDER counts too',
       r.identical === false,
       'a walk that only reads the top level would miss most of a font');
  }

  {
    // The other direction still works: a library file missing from the card was already caught by
    // its own failed stat, and must stay caught now that counts are compared as well.
    const card = { ...FONT };
    delete card['swing1.wav'];
    const { userData, dest } = setup(FONT, card);
    const r = await entryMatchesAt(userData, 'Ahsoka', dest);
    ok('a library file missing from the card still differs',
       r.identical === false,
       'the count check must not replace the per-file pass, only sit beside it');
  }

  {
    // ⭐⭐ The deferred half. The compare stops as soon as counts prove a difference, so nothing is
    // recorded then. Answering Skip is what makes the folder ours to maintain, and this is what
    // records it - the library's files AND the ones it has never seen.
    const { recordFolderAt } = require('../soundFontEntries');
    const { dest } = setup(FONT, { ...FONT, 'song1.wav': 'XXXX', 'bgndrag/song2.wav': 'YYYY' });
    const r = await recordFolderAt(dest, 'Ahsoka');
    const rels = (r.observed || []).map(([rel]) => rel).sort();
    ok('⭐ recording a kept folder covers the library files',
       rels.includes('hum.wav') && rels.includes('swing1.wav') && rels.includes('bgndrag/drag1.wav'),
       `got ${JSON.stringify(rels)}`);
    ok('⭐⭐ and the files the library has never seen',
       rels.includes('song1.wav') && rels.includes('bgndrag/song2.wav'),
       'these are the whole point: hashing them now is what lets a later import of the same files '
       + 'into the library resolve without re-reading the card');
    ok('every entry carries size, mtime and a hash',
       (r.observed || []).every(([, v]) => Array.isArray(v) && v.length === 3
         && typeof v[0] === 'number' && typeof v[1] === 'number' && typeof v[2] === 'string' && v[2]),
       'the shape syncManifest:commit takes - a short entry is silently skipped by cacheFor');
    ok('and the root meta.json is left out, as the hash walk leaves it out',
       !rels.includes('meta.json'),
       'recording it on one side only would make the folder differ forever');
  }

  console.log(failed ? `\n${failed} FAILED` : '\nentry-extra-files: all passing');
  process.exit(failed ? 1 : 0);
})();
