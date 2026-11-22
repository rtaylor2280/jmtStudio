// macOS card detection, read from real diskutil output. [Stage 0, 1.8]
//
// The fixtures in test/mac-fixtures/ were captured 2026-11-07 from a Mac mini (macOS 26) with a
// blank FAT32 card (PROFFIE) in a SABRENT USB reader, beside a WD 8 TB USB hard drive and two
// APFS externals. Nothing here runs diskutil; it parses what diskutil printed.
//
// Run: node test/mac-disks.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mac = require('../macDisks');
const sd = require('../sdCardDetect');
const { classifyTransport } = require('../exportDestination');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const FIX = path.join(__dirname, 'mac-fixtures');
const read = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');
const list = mac.parsePlist(read('list-external-physical.plist'));
const cardPart = mac.parsePlist(read('info-card-partition.plist'));
const cardWhole = mac.parsePlist(read('info-card-whole.plist'));
const hdd = mac.parsePlist(read('info-fixed-hdd.plist'));

console.log('plist parser, checked against a count made without it');
{
  // Top-level keys sit at one tab of indent in diskutil's output.
  const handCount = read('info-card-partition.plist').split('\n').filter(l => /^\t<key>/.test(l)).length;
  ok('parsed every top-level key', cardPart && Object.keys(cardPart).length === handCount,
    `parsed ${cardPart && Object.keys(cardPart).length}, file has ${handCount}`);
  ok('booleans are booleans', cardPart.RemovableMedia === true && hdd.RemovableMedia === false);
  ok('integers are numbers', cardPart.Size === 31910789120);
}

console.log('which volumes are listed');
{
  const m = mac.mountedFromList(list);
  ok('only the mounted FAT card is found', m.length === 1 && m[0].mountPoint === '/Volumes/PROFFIE',
    JSON.stringify(m));
  ok('it knows its whole disk', m[0] && m[0].wholeDisk === 'disk8');
  ok('control: the list does hold the two other external disks',
    list.AllDisksAndPartitions.length === 3);
}

console.log('the card record');
{
  const r = mac.volumeRowFromInfo(cardPart);
  ok('mount path', r.mountPath === '/Volumes/PROFFIE');
  ok('label', r.label === 'PROFFIE');
  ok('file system reads FAT32, as on Windows', r.fileSystem === 'FAT32', r.fileSystem);
  ok('removable', r.driveType === 2);
  // The file system's size (TotalSize, = VolumeSize), not the partition's (Size): Windows
  // reports the file system's size for a card too.
  ok('size and free space', r.sizeBytes === 31894028288 && r.freeBytes === 31891881984,
    `${r.sizeBytes} / ${r.freeBytes}`);
  ok('control: the partition is larger than its file system', cardPart.Size > r.sizeBytes);
  ok('no drive letter', r.drive === null);
  ok('no FAT serial on macOS, so none is invented', r.volumeSerial === null);
  ok('whole disk', r.wholeDisk === 'disk8');
}

console.log('a card is told from an external hard drive');
{
  ok('the hard drive is not removable media', hdd.RemovableMedia === false);
  ok('control: both report Ejectable, so Ejectable cannot be the test',
    hdd.Ejectable === true && cardWhole.Ejectable === true);
  const r = mac.volumeRowFromInfo({ ...hdd, MountPoint: '/Volumes/WD' });
  ok('a mounted fixed drive is driveType 3', r && r.driveType === 3);
  ok('nothing unmounted becomes a row', mac.volumeRowFromInfo(hdd) === null);
}

console.log('board or reader');
{
  const model = [cardWhole.IORegistryEntryName, cardWhole.MediaName].join(' ');
  ok('the SABRENT reader is not a board', classifyTransport(model, '').transport !== 'proffieboard', model);
  // Not yet captured from a real board on macOS; Windows sees the board's card as Tlera DOSFS.
  ok('a Tlera DOSFS device is a board', classifyTransport('Tlera DOSFS Media', '').transport === 'proffieboard');
  const sp = { SPUSBHostDataType: [{ _items: [
    { _name: 'Proffieboard', USBDeviceKeyVendorID: '0x1209', USBDeviceKeySerialNumber: '206f32914630' },
    { _name: 'Hub', USBDeviceKeyVendorID: '0x05e3', USBDeviceKeySerialNumber: 'Not Provided' },
  ] }] };
  ok('board serials come from vendor 0x1209 only', JSON.stringify(mac.proffieboardSerialsFrom(sp)) === '["206F32914630"]');
}

console.log('a blank card a Mac has mounted is empty');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macblank-'));
  try {
    for (const d of ['.Spotlight-V100', '.fseventsd', 'System Volume Information']) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, '._x'), '');
    const blank = sd.classifyCard({ mountPath: dir });
    ok('classified empty', blank.kind === 'empty', blank.kind);
    fs.mkdirSync(path.join(dir, 'SomethingElse'));
    fs.writeFileSync(path.join(dir, 'SomethingElse', 'notes.txt'), 'x');
    const notBlank = sd.classifyCard({ mountPath: dir });
    ok('control: a real folder beside them still counts', notBlank.kind !== 'empty', notBlank.kind);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log('mount root');
ok('a path inside a card', mac.mountRootOf('/Volumes/PROFFIE/fonts/Kenobi') === '/Volumes/PROFFIE');
ok('not a volume', mac.mountRootOf('/Users/me/Desktop') === null);

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
