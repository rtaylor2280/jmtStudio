// Records for files that are gone get removed — and only when that is provably safe.
//
// The manifest is described as MAINTAINED, so an entry for a file that is not on the card
// contradicts it. Merging alone can only add and overwrite, so deleting an extra from a card used
// to leave its record behind for ever: 124 entries against 109 files, found on a real card.
//
// ⚠️⚠️ THIS IS THE ONLY DIRECTION THAT DELETES, so the interesting cases are the ones where it must
// REFUSE. A comparison walks the LIBRARY's file list and therefore knows nothing about the rest of
// a folder; it may only claim its observations are the whole folder when
//   · every library file was FOUND, and
//   · the destination holds no more files than the library.
// Counts alone are not enough, and the case that proves it is cheap to construct: one library file
// absent and one stray present is N against N while the folders differ.
//
// ⚠️ The font compare is covered in entry-extra-files. This file covers COMMON and TRACKS, which
// are separate compares with their own walks - and separate compares are exactly where the misses
// of 2026-09-25 lived.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sync = require('../sfSyncManifest');
const { commonMatchesAt } = require('../soundFontCommon');
const { planExport } = require('../soundFontSharedTracks');

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

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

function commonSetup(libFiles, cardFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-common-'));
  const userData = path.join(root, 'userData');
  const dest = path.join(root, 'card');
  const libDir = path.join(userData, 'soundFonts', 'common', UUID, 'files');
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(userData, 'soundFonts', 'common', UUID, 'meta.json'),
    JSON.stringify({ schemaVersion: 1, uuid: UUID, name: 'Pack' }));
  write(libDir, libFiles);
  fs.mkdirSync(path.join(dest, 'common'), { recursive: true });
  write(path.join(dest, 'common'), cardFiles);
  return { userData, dest };
}

function tracksSetup(libFiles, cardFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-tracks-'));
  const userData = path.join(root, 'userData');
  const dest = path.join(root, 'card');
  write(path.join(userData, 'soundFonts', 'sharedTracks'), libFiles);
  fs.mkdirSync(path.join(dest, 'tracks'), { recursive: true });
  write(path.join(dest, 'tracks'), cardFiles);
  return { userData, dest };
}

const PACK = { 'mmain.wav': 'AAA', 'mfont.wav': 'BBB', 'nested/x.wav': 'CCC' };
const TRACKS = { 'one.wav': 'AAA', 'two.wav': 'BBB', 'three.wav': 'CCC' };

(async () => {
  // ── COMMON ────────────────────────────────────────────────────────────
  {
    const { userData, dest } = commonSetup(PACK, PACK);
    sync.mergeItems(dest, { common: [['ghost.wav', [1, 2, 'G']]] });
    const r = await commonMatchesAt(userData, UUID, dest, 'common');
    ok('⭐ a matching common folder reports its observations as complete',
       r.identical === true && r.complete === true,
       `got identical=${r.identical} complete=${r.complete}`);

    sync.mergeItems(dest, { common: r.observed }, { complete: ['common'] });
    const swept = (sync.read(dest).items.common.files || []).map((f) => f[0]).sort();
    ok(`⭐⭐ and the record for a file that is gone is removed (${swept.length})`,
       !swept.includes('ghost.wav') && swept.length === 3,
       `got ${JSON.stringify(swept)}`);
  }

  {
    // ⚠️ The guard, on the common compare's own walk.
    const card = { ...PACK, 'stray.wav': 'ZZZ' };
    delete card['mfont.wav'];
    const { userData, dest } = commonSetup(PACK, card);
    const r = await commonMatchesAt(userData, UUID, dest, 'common');
    ok('⭐⭐ common refuses the claim when one file is absent and one is stray',
       r.complete === false,
       'counts are 3 against 3 while the folders differ - claiming completeness here would '
       + 'delete the record for a file that was never examined');
  }

  {
    // A common folder holding MORE than the library is a difference, and says nothing complete.
    const { userData, dest } = commonSetup(PACK, { ...PACK, 'extra.wav': 'EEE' });
    const r = await commonMatchesAt(userData, UUID, dest, 'common');
    ok('⚠️ a common folder with an extra file differs, and claims nothing',
       r.identical === false && r.complete !== true,
       `got identical=${r.identical} complete=${r.complete}`);
  }

  // ── TRACKS ────────────────────────────────────────────────────────────
  {
    const { userData, dest } = tracksSetup(TRACKS, TRACKS);
    sync.mergeItems(dest, { tracks: [['ghost.wav', [1, 2, 'G']]] });
    const p = await planExport(userData, dest);
    ok('⭐ a matching tracks folder reports its observations as complete',
       p.ok === true && p.toAdd.length === 0 && p.complete === true,
       `got toAdd=${(p.toAdd || []).length} complete=${p.complete}`);

    sync.mergeItems(dest, { tracks: p.observed }, { complete: ['tracks'] });
    const swept = (sync.read(dest).items.tracks.files || []).map((f) => f[0]).sort();
    ok(`⭐⭐ and the record for a file that is gone is removed (${swept.length})`,
       !swept.includes('ghost.wav') && swept.length === 3,
       `got ${JSON.stringify(swept)}`);
  }

  {
    // ⚠️ One library track absent from the card, one stray present: 3 against 3.
    const card = { ...TRACKS, 'stray.wav': 'ZZZ' };
    delete card['two.wav'];
    const { userData, dest } = tracksSetup(TRACKS, card);
    const p = await planExport(userData, dest);
    ok('⭐⭐ tracks refuses the claim when one file is absent and one is stray',
       p.complete === false,
       `a track in toAdd means the destination was not fully accounted for. toAdd=${JSON.stringify(p.toAdd)}`);
  }

  {
    // A tracks folder holding MORE than the library still has every library track, so nothing is
    // in `toAdd` - the count is what catches it, which is why both conditions exist.
    const { userData, dest } = tracksSetup(TRACKS, { ...TRACKS, 'extra.wav': 'EEE' });
    const p = await planExport(userData, dest);
    ok('⭐⭐ tracks refuses the claim when the card holds MORE than the library',
       p.toAdd.length === 0 && p.complete === false,
       'every library track is present, so only the file count can notice the extra - without it '
       + 'the sweep would delete that extra\'s record on the next pass');
  }

  console.log(failed ? `\n${failed} FAILED` : '\nmanifest-sweep: all passing');
  process.exit(failed ? 1 : 0);
})();
