// A common folder Studio exported comes back under its own name, and Studio's marker stays out of
// the library copy without the copy being called customized. [2026-11-19, QA08]
//
// Run: node test/common-marker-roundtrip.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require(path.join(__dirname, '..', 'soundFontCommon'));

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
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
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-cmark-' + t + '-'));
const VOICE = Array.from({ length: 12 }, (_, i) => `v${i}`);

(async () => {
  const ud = tmp('ud');
  const dl = tmp('dl');
  fs.mkdirSync(path.join(dl, 'common'), { recursive: true });
  for (const n of VOICE) fs.writeFileSync(path.join(dl, 'common', `${n}.wav`), wav(`VOICE-${n}`));
  const a = await C.importCommonFromFolder(ud, dl, 'ProffieOS_V2_Voicepack_English_C', undefined, null, {});
  check('the pack is in the library', a && a.ok && a.uuid, JSON.stringify(a));

  const card = tmp('card');
  const ex = await C.exportCommonToFolder(ud, a.uuid, card, 'rename');
  const exported = path.join(card, 'common');
  const marker = fs.readdirSync(exported).find((n) => /^a_JMT_.*\.txt$/i.test(n));
  check('the export wrote its marker beside the wavs', ex && ex.ok && !!marker, JSON.stringify(ex) + ' ' + fs.readdirSync(exported).join(','));

  const insp = C.inspectIncomingCommonFolder(exported);
  check('the exported folder, picked as itself, offers the pack\'s own name',
    insp.markerName === 'ProffieOS_V2_Voicepack_English_C', JSON.stringify(insp));
  const insp2 = C.inspectIncomingCommonFolder(card);
  check('and so does the folder above it', insp2.markerName === 'ProffieOS_V2_Voicepack_English_C', JSON.stringify(insp2));
  check('control: a pack with no marker offers none', C.inspectIncomingCommonFolder(dl).markerName === null);

  const b = await C.importCommonFromFolder(ud, exported, 'English_C_back', undefined, null, {});
  check('it imports', b && b.ok && b.uuid, JSON.stringify(b));
  const files = fs.readdirSync(path.join(C.commonRoot(ud), b.uuid, 'files'));
  check('the marker is not in the library copy', !files.some((n) => /^a_JMT_/i.test(n)), files.join(','));
  check('every sound is', VOICE.every((n) => files.includes(`${n}.wav`)), files.join(','));
  const meta = C.getCommon(ud, b.uuid).meta;
  check('the import remembers the marker it left out', JSON.stringify(meta.markerFiles) === JSON.stringify([marker]), JSON.stringify(meta.markerFiles));
  const cust = C.getCommonCustomization(ud, b.uuid);
  check('and the copy is not called customized for lacking it', cust.known && !cust.customized, JSON.stringify(cust));

  fs.writeFileSync(path.join(C.commonRoot(ud), b.uuid, 'files', 'extra.wav'), wav('EXTRA'));
  C.markCommonContentDirty(ud, b.uuid);
  const cust2 = C.getCommonCustomization(ud, b.uuid);
  check('control: a real change still counts', cust2.known && cust2.customized && cust2.added === 1, JSON.stringify(cust2));

  const notes = tmp('notes');
  fs.mkdirSync(path.join(notes, 'common'));
  for (const n of VOICE) fs.writeFileSync(path.join(notes, 'common', `${n}.wav`), wav(`OTHER-${n}`));
  fs.writeFileSync(path.join(notes, 'common', 'a_ReadMe.txt'), 'A pack of my own\n\nnotes');
  const c = await C.importCommonFromFolder(ud, notes, 'Mine', undefined, null, {});
  const cfiles = fs.readdirSync(path.join(C.commonRoot(ud), c.uuid, 'files'));
  check('control: a pack\'s own text files are kept', cfiles.includes('a_ReadMe.txt'), cfiles.join(','));

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
