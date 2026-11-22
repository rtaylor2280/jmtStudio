// "Use as track for…" puts the track where the preset will find it on the card. [B-152]
//
// A wav from another font is put into the preset's own font at the same path before it is set as
// the track, so the track travels with that font. sameFileAt decides whether the preset's font
// already holds that exact file (reuse it) or not (copy it in, as a hard link, under the next free
// name if another file has the path). The copy itself is copyAcrossLocations, already covered;
// this covers the decision and runs the copy once end to end.
//
// Runs soundFontFileOps.js against a scratch userData.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const ops  = require('../soundFontFileOps');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-track-'));
const font = (name, files) => {
  for (const [rel, bytes] of Object.entries(files)) {
    const p = path.join(ud, 'soundFonts', 'library', name, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  }
};
const loc = (id, subPath) => ({ kind: 'entry', id, subPath });

(async () => {
  font('Father', { 'tracks/track1.wav': 'FATHER-TRACK' });
  font('Vader', { 'hum.wav': 'h' });
  font('Copy', { 'tracks/track1.wav': 'FATHER-TRACK' });
  font('Other', { 'tracks/track1.wav': 'SOMETHING-ELSE' });

  console.log('sameFileAt');
  check('nothing at the path: absent', ops.sameFileAt(ud, loc('Father', 'tracks/track1.wav'), loc('Vader', 'tracks/track1.wav')) === 'absent');
  check('equal bytes: same', ops.sameFileAt(ud, loc('Father', 'tracks/track1.wav'), loc('Copy', 'tracks/track1.wav')) === 'same');
  check('other bytes: different', ops.sameFileAt(ud, loc('Father', 'tracks/track1.wav'), loc('Other', 'tracks/track1.wav')) === 'different');

  console.log('put into the preset\'s font');
  const r = await ops.copyAcrossLocations({
    userData: ud, src: { kind: 'entry', id: 'Father' }, srcPaths: ['tracks/track1.wav'],
    dest: { kind: 'entry', id: 'Vader', subPath: 'tracks' },
  });
  check('lands at the same path', r.ok && r.added[0] === 'tracks/track1.wav', JSON.stringify(r));
  check('and is then the same file: a second pick reuses it',
    ops.sameFileAt(ud, loc('Father', 'tracks/track1.wav'), loc('Vader', 'tracks/track1.wav')) === 'same');
  const a = fs.statSync(path.join(ud, 'soundFonts', 'library', 'Father', 'tracks', 'track1.wav'));
  const b = fs.statSync(path.join(ud, 'soundFonts', 'library', 'Vader', 'tracks', 'track1.wav'));
  check('as a hard link where the disk allows it', a.ino === b.ino || a.nlink === 1, `${a.ino} ${b.ino}`);
  const r2 = await ops.copyAcrossLocations({
    userData: ud, src: { kind: 'entry', id: 'Father' }, srcPaths: ['tracks/track1.wav'],
    dest: { kind: 'entry', id: 'Other', subPath: 'tracks' },
  });
  check('a different file at the path: the new one lands beside it, theirs untouched',
    r2.ok && r2.added[0] !== 'tracks/track1.wav'
    && fs.readFileSync(path.join(ud, 'soundFonts', 'library', 'Other', 'tracks', 'track1.wav'), 'utf8') === 'SOMETHING-ELSE',
    JSON.stringify(r2));

  console.log('put in the Tracks folder');
  const tracks = { kind: 'sharedTracks', id: '' };
  check('no Tracks folder yet: absent', ops.sameFileAt(ud, loc('Father', 'tracks/track1.wav'), { ...tracks, subPath: 'track1.wav' }) === 'absent');
  const r3 = await ops.copyAcrossLocations({
    userData: ud, src: { kind: 'entry', id: 'Father' }, srcPaths: ['tracks/track1.wav'], dest: { ...tracks, subPath: '' },
  });
  check('lands flat, by its name, creating the folder', r3.ok && r3.added[0] === 'track1.wav', JSON.stringify(r3));
  check('a second pick reuses it', ops.sameFileAt(ud, loc('Father', 'tracks/track1.wav'), { ...tracks, subPath: 'track1.wav' }) === 'same');

  console.log('the question');
  {
    // With only "Add to Tracks" offered (the preset's font is not in the library) the question has one
    // button, and promptConfirm answers that with a boolean; the code must read true as that button.
    const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
    check('a one-button answer (true) counts as the button', html.includes("const choice = where === true ? 'confirm' : where;"));
    check('the singular track folder rename is shared, not copied',
      (html.match(/fileOpsRename\(\{\s*kind: 'entry', id: fontName, subPath: oldFolder/g) || []).length === 1);
  }

  if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall passed');
})();
