// The Linux card layer, against lsblk captured on a real machine (Ubuntu 26.04 on the Yoga, a
// Transcend reader holding PROFFIE, a Proffieboard V3 presenting 16kbTest).
//
//   1. Rows: mounted cards are found, system volumes are fixed, snaps and empty slots are not cards.
//   2. The board's card is named as a board card, with the board's own serial.
//   3. /proc/mounts: the longest mount wins, and \040 decodes to a space.
//   4. Eject takes the device, never the mount path, and never powers the device off.
//   5. Every door that asks "is this a card" has a Linux branch.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const L = require(path.join(ROOT, 'linuxDisks.js'));
const { classifyTransport } = require(path.join(ROOT, 'exportDestination.js'));
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'linux-fixtures', n + '.json'), 'utf8'));
const rowsOf = (t) => L.mountedFrom(t).map(({ part, disk }) => L.volumeRow(part, disk));

(async () => {
  console.log('1. rows');
  const all = rowsOf(fx('lsblk-all-reader'));
  const card = all.find(r => r.mountPath === '/run/media/ryan/PROFFIE');
  check('the reader card is a removable FAT32 row with its label, size and free space',
    card && card.driveType === 2 && card.fileSystem === 'FAT32' && card.label === 'PROFFIE' && card.hasMedia
      && card.sizeBytes > 30e9 && card.freeBytes > 20e9 && card.deviceId === '/dev/sdb1' && card.wholeDisk === '/dev/sdb',
    JSON.stringify(card));
  check('/ and /boot/efi are fixed, so the card scan never lists them',
    all.filter(r => r.mountPath === '/' || r.mountPath === '/boot/efi').every(r => r.driveType === 3));
  check('snap loop devices are not volumes at all', !all.some(r => /^\/dev\/loop/.test(r.deviceId)));
  const empty = { blockdevices: [{ type: 'disk', path: '/dev/sdc', rm: true, size: 0, mountpoints: [null],
    children: [{ path: '/dev/sdc1', fstype: 'vfat', fsver: 'FAT32', mountpoints: ['/media/ryan/GHOST'] }] }] };
  check('an empty reader slot (size 0) reads hasMedia false, so scan() drops it', rowsOf(empty)[0].hasMedia === false);
  check('a card with no partition table (filesystem on the whole disk) is still found',
    rowsOf({ blockdevices: [{ type: 'disk', path: '/dev/sdd', rm: true, size: 1000, fstype: 'exfat', mountpoints: ['/media/ryan/BARE'] }] })[0].fileSystem === 'exFAT');
  check('sizes read with or without -b', L.volumeRow({ mountpoints: ['/m'], fssize: '14.5G' }, { size: '1' }).sizeBytes === Math.round(14.5 * 1024 ** 3));

  console.log('2. the board card');
  const board = fx('lsblk-board-card');
  const c = await L.classify('/run/media/ryan/16kbTest/fonts', classifyTransport, board);
  check('Tlera DOSFS is a proffieboard, with the board serial off the same row',
    c && c.transport === 'proffieboard' && c.boardSerial === '206F32914630' && c.removable === true, JSON.stringify(c));
  const r = await L.classify('/run/media/ryan/PROFFIE', classifyTransport, fx('lsblk-reader-card'));
  check('the Transcend reader is not a board and carries no serial', r && r.transport !== 'proffieboard' && !r.boardSerial, JSON.stringify(r));
  check('driveKind: the card is removable, the home folder is fixed',
    (await L.driveKind('/run/media/ryan/PROFFIE/x', fx('lsblk-all-reader'))).kind === 'removable'
    && (await L.driveKind('/home/ryan/Desktop', fx('lsblk-all-reader'))).kind === 'fixed');

  console.log('3. /proc/mounts');
  const pm = [
    '/dev/sda2 / ext4 rw 0 0',
    '/dev/sdb1 /run/media/ryan/MY\\040CARD vfat rw 0 0',
    'server:/x /mnt/nas nfs4 rw 0 0',
  ].join('\n');
  const m = L.procMountOf('/run/media/ryan/MY CARD/fonts/Ahsoka', pm);
  check('a label with a space decodes, and the card mount beats /', m && m.root === '/run/media/ryan/MY CARD' && m.source === '/dev/sdb1', JSON.stringify(m));
  check('a home folder sits on /', L.procMountOf('/home/ryan', pm).root === '/');
  check('a sibling with a longer name is not inside the mount', L.procMountOf('/run/media/ryan/MY CARD2', pm).root === '/');

  console.log('4. eject');
  const se = fs.readFileSync(path.join(ROOT, 'safeEject.js'), 'utf8');
  const lin = se.slice(se.indexOf('  linux: {'));
  check('unmount is given the device from /proc/mounts', /udisksctl', \['unmount', '-b', dev\]/.test(lin));
  check('never the mount path (the old bug)', !/'unmount', '-b', String\(mountPath/.test(lin));
  check('no power-off: on a board it would drop the serial port too', !/'power-off'/.test(lin));
  check('the system disk and plain folders resolve to nothing to eject', /m\.root === '\/'\) return null/.test(lin) && /\^\\\/dev\\\//.test(lin));
  check('a missing udisksctl falls back to gio', /r\.missing\) r = await _exec\('gio'/.test(lin) && /missing: !!\(err && err\.code === 'ENOENT'\)/.test(se));

  console.log('5. the doors');
  const sd = fs.readFileSync(path.join(ROOT, 'sdCardDetect.js'), 'utf8');
  const ed = fs.readFileSync(path.join(ROOT, 'exportDestination.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  check('card scan and the all-volumes list both read linuxDisks',
    (sd.match(/os\.platform\(\) === 'linux'\) return _withHealth\(await require\('\.\/linuxDisks'\)\.enumerateVolumes/g) || []).length === 2);
  check('a picked Linux mount root is assessed as a card', /A Linux mount root/.test(sd) && /match\.mountPath === norm/.test(sd));
  check('export drive kind and board check have Linux branches',
    /require\('\.\/linuxDisks'\)\.driveKind/.test(ed) && /require\('\.\/linuxDisks'\)\.classify/.test(ed));
  check('the renderer reads /media and /run/media roots as volumes', (html.match(/\(\?:\\\/run\)\?\\\/media\\\/\[\^\/\]\+\\\/\[\^\/\]\+/g) || []).length === 2);

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
