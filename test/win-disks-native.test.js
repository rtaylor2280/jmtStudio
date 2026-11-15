// The native Windows disk layer, checked without hardware. [B-681]
//
// winDisksNative.js answers the volume list, the drive kind, the board-card lookup and the eject
// through Win32 calls instead of PowerShell and fsutil. The calls themselves need a real machine
// (the live old-vs-new comparison is run by hand on one); everything that turns their raw answers
// into the shapes the callers read is pure, and is pinned here:
//   - drive type code -> { removable, kind }, the fsutil vocabulary
//   - STORAGE_DEVICE_DESCRIPTOR bytes -> vendor / product / bus / removable
//   - volume serial formatting and the null-vs-0 rules of a volume row
//   - the IOCTL codes, recomputed from CTL_CODE so a mistyped constant cannot pass
//   - the eject step -> result mapping, and safeEject's handling of each result
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const N = require('../winDisksNative');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── koffi stays unloaded until a native call is made ────────────────────────
ok('requiring winDisksNative does not load koffi',
   !Object.keys(require.cache).some((k) => /[\\/]node_modules[\\/]koffi[\\/]/.test(k)),
   'a macOS or Linux build must never load Windows DLLs');

// ── drive type -> kind ──────────────────────────────────────────────────────
{
  const want = {
    0: null, 1: null,
    2: { removable: true, kind: 'removable' },
    3: { removable: false, kind: 'fixed' },
    4: { removable: false, kind: 'network' },
    5: { removable: false, kind: 'cdrom' },
    6: { removable: false, kind: 'ramdisk' },
    7: null, 99: null,
  };
  for (const [t, w] of Object.entries(want)) {
    ok(`drive type ${t} -> ${w ? w.kind : 'null'}`, same(N.driveKindFromType(Number(t)), w));
  }
  ok('undefined and null are "cannot tell"',
     N.driveKindFromType(undefined) === null && N.driveKindFromType(null) === null);
}

// ── volume serial: 8 upper-case hex digits, as Win32_LogicalDisk wrote it ──
ok('serial 0x19831116 -> 19831116', N.volumeSerialHex(0x19831116) === '19831116');
ok('serial 0xC0AFEFD5 -> C0AFEFD5', N.volumeSerialHex(0xC0AFEFD5) === 'C0AFEFD5');
ok('a short serial is zero-padded', N.volumeSerialHex(0xABC) === '00000ABC');
ok('a negative int32 reads as its unsigned value', N.volumeSerialHex(-1) === 'FFFFFFFF');

// ── UTF-16 strings and GUIDs ────────────────────────────────────────────────
{
  const b = Buffer.alloc(32);
  b.write('B614-32K', 0, 'utf16le');
  ok('a NUL-terminated UTF-16 string is read to the NUL', N.utf16z(b) === 'B614-32K');
  ok('an empty buffer reads as the empty string', N.utf16z(Buffer.alloc(8)) === '');
  const d = Buffer.alloc(16); d.writeUInt32LE(8, 0); d.write('\\\\?', 4, 'utf16le');
  ok('a string at an offset is read from that offset', N.utf16z(d, 4) === '\\\\?');

  const g = N.guidBytes(N.GUID_DEVINTERFACE_DISK);
  ok('GUID_DEVINTERFACE_DISK is laid out as Windows stores it',
     g.toString('hex') === '0763f553bfb6d01194f200a0c91efb8b', g.toString('hex'));
  let threw = false;
  try { N.guidBytes('not-a-guid'); } catch { threw = true; }
  ok('a malformed GUID throws rather than becoming zeros', threw);
}

// ── STORAGE_DEVICE_DESCRIPTOR ───────────────────────────────────────────────
{
  // Built as the board's disk answers: removable, USB, "Tlera" / "DOSFS" / "0.01".
  const buf = Buffer.alloc(128);
  buf.writeUInt32LE(1, 0); buf.writeUInt32LE(128, 4);
  buf[10] = 1;
  buf.write('Tlera\0', 40, 'latin1'); buf.writeUInt32LE(40, 12);
  buf.write('DOSFS           \0', 50, 'latin1'); buf.writeUInt32LE(50, 16);
  buf.write('0.01\0', 70, 'latin1'); buf.writeUInt32LE(70, 20);
  buf.writeUInt32LE(0, 24);
  buf.writeUInt32LE(7, 28);
  const d = N.parseDeviceDescriptor(buf);
  ok('vendor is read and trimmed', d && d.vendor === 'Tlera', JSON.stringify(d));
  ok('product is read and its space padding trimmed', d && d.product === 'DOSFS', JSON.stringify(d));
  ok('revision is read', d && d.revision === '0.01');
  ok('an absent serial (offset 0) is the empty string', d && d.serial === '');
  ok('RemovableMedia is read as a boolean', d && d.removableMedia === true);
  ok('bus type 7 is USB', d && d.busType === 'USB');
  const reader = Buffer.from(buf); reader.writeUInt32LE(0x0C, 28); reader[10] = 0;
  ok('bus type 0x0C is SD, and a fixed device is not removable',
     N.parseDeviceDescriptor(reader).busType === 'SD' && N.parseDeviceDescriptor(reader).removableMedia === false);
  const odd = Buffer.from(buf); odd.writeUInt32LE(0x99, 28);
  ok('an unnamed bus type comes back as its number', N.parseDeviceDescriptor(odd).busType === 0x99);
  const wild = Buffer.from(buf); wild.writeUInt32LE(5000, 12);
  ok('an offset past the buffer reads as empty, not as a throw', N.parseDeviceDescriptor(wild).vendor === '');
  ok('a short buffer is null', N.parseDeviceDescriptor(Buffer.alloc(16)) === null);
  ok('a non-buffer is null', N.parseDeviceDescriptor('x') === null);

  ok('the model is the friendly name when there is one',
     N.modelFrom('Tlera DOSFS USB Device', d) === 'Tlera DOSFS USB Device');
  ok('without one it is vendor and product', N.modelFrom('', d) === 'Tlera DOSFS');
  ok('without either it is empty', N.modelFrom('', null) === '');
}

// ── volume rows: CIM's null-vs-0 rules ──────────────────────────────────────
{
  const card = N.volumeRow('E', 2, { label: 'B614-32K', fileSystem: 'FAT32', serial: 0x1A2B3C4D },
                           { total: 31914983424, free: 1000 });
  ok('a readable card row has every field',
     same(card, { drive: 'E:', mountPath: 'E:\\', fileSystem: 'FAT32', label: 'B614-32K',
                  volumeSerial: '1A2B3C4D', hasMedia: true, sizeBytes: 31914983424,
                  freeBytes: 1000, driveType: 2 }), JSON.stringify(card));
  const empty = N.volumeRow('F', 2, null, null);
  ok('an empty slot: null names, hasMedia false, sizes 0 (the [int64] cast of a null Size)',
     same(empty, { drive: 'F:', mountPath: 'F:\\', fileSystem: null, label: null, volumeSerial: null,
                   hasMedia: false, sizeBytes: 0, freeBytes: 0, driveType: 2 }), JSON.stringify(empty));
  const unlabelled = N.volumeRow('E', 2, { label: '', fileSystem: 'FAT32', serial: 1 }, { total: 1, free: 1 });
  ok('an unlabelled card keeps the empty-string label, not null', unlabelled.label === '');
}

// ── drive letters out of a GetLogicalDrives mask ───────────────────────────
ok('mask bits map to letters, A first',
   same(N.lettersOf((1 << 0) | (1 << 2) | (1 << 3) | (1 << 25)), ['A', 'C', 'D', 'Z']));
ok('bit 31 does not sign-flip the scan', same(N.lettersOf(0x80000001), ['A']));

// ── the IOCTL codes, recomputed from CTL_CODE ───────────────────────────────
{
  const CTL = (dev, fn, method, access) => ((dev << 16) | (access << 14) | (fn << 2) | method) >>> 0;
  const STORAGE = 0x2D, DISK = 0x07, FS = 0x09;
  const ANY = 0, READ = 1;
  const want = {
    IOCTL_STORAGE_GET_DEVICE_NUMBER: CTL(STORAGE, 0x0420, 0, ANY),
    IOCTL_STORAGE_QUERY_PROPERTY: CTL(STORAGE, 0x0500, 0, ANY),
    IOCTL_DISK_GET_PARTITION_INFO_EX: CTL(DISK, 0x0012, 0, ANY),
    FSCTL_LOCK_VOLUME: CTL(FS, 6, 0, ANY),
    FSCTL_DISMOUNT_VOLUME: CTL(FS, 8, 0, ANY),
    IOCTL_STORAGE_MEDIA_REMOVAL: CTL(STORAGE, 0x0201, 0, READ),
    IOCTL_STORAGE_EJECT_MEDIA: CTL(STORAGE, 0x0202, 0, READ),
  };
  for (const [k, v] of Object.entries(want)) {
    ok(`${k} = 0x${v.toString(16)}`, N.CODES[k] === v, `got 0x${(N.CODES[k] >>> 0).toString(16)}`);
  }
  ok('the storage queries need no access rights, so no admin',
     ((N.CODES.IOCTL_STORAGE_GET_DEVICE_NUMBER >>> 14) & 3) === 0
     && ((N.CODES.IOCTL_STORAGE_QUERY_PROPERTY >>> 14) & 3) === 0
     && ((N.CODES.IOCTL_DISK_GET_PARTITION_INFO_EX >>> 14) & 3) === 0);
}

// ── the eject sequence, in order, and what each step means ──────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'winDisksNative.js'), 'utf8');
  const body = src.slice(src.indexOf('function opEject'), src.indexOf('const OPS ='));
  const at = (s) => body.indexOf(s);
  const order = ['FSCTL_LOCK_VOLUME', 'FSCTL_DISMOUNT_VOLUME', 'IOCTL_STORAGE_MEDIA_REMOVAL',
                 'IOCTL_STORAGE_EJECT_MEDIA'].map(at);
  ok('the eject runs lock, dismount, allow removal, eject - in that order',
     order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), String(order));
  ok('the eject opens the VOLUME (\\\\.\\X:), not the disk',
     /'\\\\\\\\\.\\\\' \+ L \+ ':'/.test(body) && !/PhysicalDrive/.test(body),
     'a two-slot reader holds two letters on one device - a device eject takes both');
  ok('the lock is retried before the volume is called busy',
     /LOCK_TRIES/.test(body) && /Atomics\.wait/.test(body));
  ok('the worker suppresses the "insert a disk" box', /SetThreadErrorMode\(SEM_FAILCRITICALERRORS/.test(src));

  ok('a refused lock is busy', same(N.ejectResult('lock', 5),
     { ok: false, busy: true, raw: 'busy: lock refused (error 5)' }));
  ok('a failed dismount is an error, not busy',
     same(N.ejectResult('dismount', 1117), { ok: false, raw: 'error: dismount failed (error 1117)' }));
  ok('a failed eject is an error, not busy', !N.ejectResult('eject', 1).busy && !N.ejectResult('eject', 1).ok);
  ok('every step done is ejected', same(N.ejectResult('done'), { ok: true, raw: 'ejected' }));
}

// ── the time limits are the PowerShell ones ─────────────────────────────────
{
  const W = fs.readFileSync(path.join(ROOT, 'winDisks.js'), 'utf8');
  ok('listReadyRemovable: 8 s, null', /_run\('listReady', \[\], 8000, null\)/.test(W));
  ok('enumerateVolumes: 10 s, []', /_run\('enumerate', \[[^\]]*\], 10000, \[\]\)/.test(W));
  ok('classify: 8 s, null', /_run\('classify', \[letter\], 8000, null\)/.test(W));
  ok('driveKind: 5 s, null', /_run\('driveType', \[L\], 5000, null\)/.test(W));
  ok('an eject that does not answer hands the verdict to the media watch',
     /_run\('eject', \[L\], EJECT_TIMEOUT_MS, null, \{ ok: true, raw: 'pending' \}\)/.test(W));
  ok('each call runs on a worker thread', /new Worker\(_nativePath\(\)/.test(W));
  const code = W.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok('a worker is never terminated',
     !/\.terminate\(/.test(code),
     'stopping a worker inside a koffi call is a fatal N-API error that ends the whole process');
  ok('an answer is handed back on the worker\'s exit, not on its message',
     /once\('exit', \(\) => finish\(answer\)\)/.test(code) && !/once\('message', \(m\) => finish\(/.test(code),
     'a caller that exits right after the message races the worker unloading koffi');
  ok('a quit with calls in flight waits for them, within a limit',
     /app\.on\('will-quit'/.test(code) && /e\.preventDefault\(\)/.test(code) && /QUIT_WAIT_MS/.test(code));
  ok('a packaged build loads the worker from the unpacked copy', /app\.asar\.unpacked/.test(W));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const unpack = (pkg.build && pkg.build.asarUnpack) || [];
  ok('package.json unpacks koffi and the worker file from the asar',
     unpack.some((g) => /node_modules\/koffi/.test(g)) && unpack.includes('winDisksNative.js'),
     JSON.stringify(unpack));
  ok('koffi is pinned to an exact version', pkg.dependencies && pkg.dependencies.koffi === '2.16.3');
}

// ── safeEject reads each native result correctly ────────────────────────────
// Driven through the real ejectVolume with only `invoke` and the media's presence replaced.
(async () => {
  if (process.platform === 'win32') {
    const MOUNT = 'Z:\\';
    const realExists = fs.existsSync;
    const fresh = () => { const p = require.resolve('../safeEject.js'); delete require.cache[p]; return require(p); };
    const present = (seq) => {
      let i = 0;
      fs.existsSync = (p) => (String(p) === MOUNT ? seq[Math.min(i++, seq.length - 1)] : realExists.call(fs, p));
    };
    try {
      let SE = fresh();
      SE._PLATFORMS.win32.invoke = async () => N.ejectResult('lock', 5);
      present([true]);
      let r = await SE.ejectVolume(MOUNT, { timeoutMs: 5000 });
      ok('a refused lock is `busy` at once, without waiting out the watch',
         r.status === 'busy' && r.ms < 1000 && r.everGone === false && /lock refused/.test(r.raw), JSON.stringify(r));
      ok('and the busy result carries the mount path and label the busy note needs',
         r.mountPath === MOUNT && r.label === 'Z:');

      SE = fresh();
      SE._PLATFORMS.win32.invoke = async () => N.ejectResult('dismount', 1117);
      present([true]);
      r = await SE.ejectVolume(MOUNT, { timeoutMs: 5000 });
      ok('a failed step is `unsupported` at once, never `busy`',
         r.status === 'unsupported' && r.ms < 1000 && /dismount failed/.test(r.raw), JSON.stringify(r));

      SE = fresh();
      SE._PLATFORMS.win32.invoke = async () => N.ejectResult('done');
      present([true, false, false, false, false, false, false, false]);
      r = await SE.ejectVolume(MOUNT, { timeoutMs: 5000 });
      ok('a completed sequence is still verified by the media leaving',
         r.status === 'ejected' && r.raw === 'ejected' && r.ms >= SE.STABLE_MS, JSON.stringify(r));

      SE = fresh();
      SE._PLATFORMS.win32.invoke = async () => N.ejectResult('done');
      present([true]);
      r = await SE.ejectVolume(MOUNT, { timeoutMs: 900 });
      ok('a completed sequence whose media never leaves is `busy`, not a success dressed up',
         r.status === 'busy', JSON.stringify(r));

      SE = fresh();
      SE._PLATFORMS.win32.invoke = async () => ({ ok: true, raw: 'no-verb' });
      present([true]);
      r = await SE.ejectVolume(MOUNT, { timeoutMs: 900 });
      ok('a volume that is not ejectable is `unsupported`, not `busy`', r.status === 'unsupported', JSON.stringify(r));
    } finally { fs.existsSync = realExists; }
  } else {
    console.log('  skip safeEject result handling (Windows only)');
  }

  console.log(`\nwin-disks-native: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
