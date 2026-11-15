// The Win32 half of winDisks.js: every disk question answered in-process through koffi. [B-681]
//
// NO CHILD PROCESSES. Behaviour-based antivirus kills an Electron app that keeps starting
// PowerShell and fsutil (QA BUG-012), so the volume list, the board-card lookup, the drive kind and
// the eject are all direct Win32 calls here: GetLogicalDrives, GetDriveTypeW,
// GetVolumeInformationW, GetDiskFreeSpaceExW, DeviceIoControl and the SetupAPI disk interfaces.
//
// RUNS ON A WORKER THREAD, NEVER ON THE MAIN ONE. A volume or IOCTL call can block for as long as
// a dead or slow device takes to answer, so winDisks.js starts this file as a worker per call and
// gives up on it after the same time limit the PowerShell call had. The worker sets
// SEM_FAILCRITICALERRORS on its own thread so an empty slot never raises the "insert a disk" box.
//
// The pure helpers at the top (drive kind, descriptor parsing, serial formatting, row shaping)
// take no koffi and run anywhere, which is what lets them be unit-tested without hardware.
// koffi is required lazily inside bind(), so loading this file on macOS or Linux loads nothing.

'use strict';

// ── Pure helpers ────────────────────────────────────────────────────────────

// GetDriveTypeW codes. They are the same numbers as Win32_LogicalDisk.DriveType.
const DRIVE_NO_ROOT_DIR = 1;
const DRIVE_REMOVABLE = 2;
const DRIVE_FIXED = 3;
const DRIVE_CDROM = 5;

// The kinds fsutil's "fsinfo drivetype" named, as exportDestination.driveKind returns them.
// Unknown (0) and no-root (1) are not a kind: null, "cannot tell". [B-028]
function driveKindFromType(t) {
  switch (t) {
    case 2: return { removable: true, kind: 'removable' };
    case 3: return { removable: false, kind: 'fixed' };
    case 4: return { removable: false, kind: 'network' };
    case 5: return { removable: false, kind: 'cdrom' };
    case 6: return { removable: false, kind: 'ramdisk' };
    default: return null;
  }
}

// Volume serial as Win32_LogicalDisk.VolumeSerialNumber writes it: 8 upper-case hex digits.
function volumeSerialHex(n) {
  return (Number(n) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

// A NUL-terminated UTF-16LE string out of a buffer.
function utf16z(buf, offset = 0) {
  let end = offset;
  while (end + 1 < buf.length && (buf[end] | buf[end + 1])) end += 2;
  return buf.toString('utf16le', offset, end);
}

// A GUID string into the 16 bytes Windows lays it out as (first three groups little-endian).
function guidBytes(s) {
  const h = String(s).replace(/[{}-]/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(h)) throw new Error('bad GUID: ' + s);
  const b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0);
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4);
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16);
  return b;
}

// STORAGE_DEVICE_DESCRIPTOR, as IOCTL_STORAGE_QUERY_PROPERTY returns it:
//   0 Version, 4 Size, 8 DeviceType, 9 DeviceTypeModifier, 10 RemovableMedia, 11 CommandQueueing,
//   12 VendorIdOffset, 16 ProductIdOffset, 20 ProductRevisionOffset, 24 SerialNumberOffset,
//   28 BusType. Each offset points at an ASCII string inside the buffer; 0 means absent.
const BUS_TYPES = { 7: 'USB', 0xA: 'SAS', 0xB: 'SATA', 0xC: 'SD', 0xD: 'MMC', 0x11: 'NVMe' };
function parseDeviceDescriptor(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) return null;
  const str = (off) => {
    if (!off || off >= buf.length) return '';
    let e = off;
    while (e < buf.length && buf[e]) e++;
    return buf.toString('latin1', off, e).trim();
  };
  const bus = buf.readUInt32LE(28);
  return {
    removableMedia: !!buf[10],
    busType: BUS_TYPES[bus] || bus,
    vendor: str(buf.readUInt32LE(12)),
    product: str(buf.readUInt32LE(16)),
    revision: str(buf.readUInt32LE(20)),
    serial: str(buf.readUInt32LE(24)),
  };
}

// The model Win32_DiskDrive reports is the disk's friendly name. When a disk has none, the
// descriptor's vendor and product stand in for it.
function modelFrom(friendlyName, descriptor) {
  const f = String(friendlyName || '').trim();
  if (f) return f;
  if (!descriptor) return '';
  return [descriptor.vendor, descriptor.product].filter(Boolean).join(' ').trim();
}

// One volume row, in the shape the Win32_LogicalDisk query returned. [B-420]
//   vi   GetVolumeInformationW's answer, or null when it failed (no media, unreadable, unreachable)
//   sz   GetDiskFreeSpaceExW's { total, free }, or null when it failed
// CIM gave null for FileSystem, VolumeName and VolumeSerialNumber when the volume could not be
// read, and its [int64] cast turned a null Size into 0. hasMedia is the Size test made before that
// cast, so an empty reader slot stays distinguishable from a card.
function volumeRow(letter, driveType, vi, sz) {
  const drive = letter + ':';
  return {
    drive,
    mountPath: drive + '\\',
    fileSystem: vi ? vi.fileSystem : null,
    label: vi ? vi.label : null,
    volumeSerial: vi ? volumeSerialHex(vi.serial) : null,
    hasMedia: !!sz,
    sizeBytes: sz ? sz.total : 0,
    freeBytes: sz ? sz.free : 0,
    driveType,
  };
}

// The letters set in a GetLogicalDrives mask, A first.
function lettersOf(mask) {
  const out = [];
  for (let i = 0; i < 26; i++) if ((mask >>> 0) & (1 << i)) out.push(String.fromCharCode(65 + i));
  return out;
}

// What the eject sequence's steps mean to safeEject.js. Lock refused = something has the volume
// open = busy; any other failed step is an error, never busy. [B-681]
function ejectResult(step, err) {
  if (step === 'done') return { ok: true, raw: 'ejected' };
  if (step === 'lock') return { ok: false, busy: true, raw: `busy: lock refused (error ${err})` };
  return { ok: false, raw: `error: ${step} failed (error ${err})` };
}

// ── Win32 bindings, bound once per worker ────────────────────────────────────

const IOCTL_STORAGE_GET_DEVICE_NUMBER = 0x002D1080;
const IOCTL_STORAGE_QUERY_PROPERTY    = 0x002D1400;
const IOCTL_DISK_GET_PARTITION_INFO_EX = 0x00070048;
const FSCTL_LOCK_VOLUME               = 0x00090018;
const FSCTL_DISMOUNT_VOLUME           = 0x00090020;
const IOCTL_STORAGE_MEDIA_REMOVAL     = 0x002D4804;
const IOCTL_STORAGE_EJECT_MEDIA       = 0x002D4808;
const FILE_DEVICE_DISK = 7;
const GENERIC_READ_WRITE = 0xC0000000;
const FILE_SHARE_READ_WRITE = 3;
const OPEN_EXISTING = 3;
const SEM_FAILCRITICALERRORS = 0x0001;
const DIGCF_PRESENT = 0x02;
const DIGCF_DEVICEINTERFACE = 0x10;
const SPDRP_FRIENDLYNAME = 0x0C;
const GUID_DEVINTERFACE_DISK = '53F56307-B6BF-11D0-94F2-00A0C91EFB8B';
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;
const LOCK_TRIES = 10;
const LOCK_RETRY_MS = 300;

let W = null;
function bind() {
  if (W) return W;
  const koffi = require('koffi');
  const k32 = koffi.load('kernel32.dll');
  const sapi = koffi.load('setupapi.dll');
  const ptr = koffi.sizeof('void *');
  W = {
    koffi, ptr,
    GetLogicalDrives: k32.func('uint32 __stdcall GetLogicalDrives()'),
    GetDriveTypeW: k32.func('uint32 __stdcall GetDriveTypeW(str16 root)'),
    SetThreadErrorMode: k32.func('bool __stdcall SetThreadErrorMode(uint32 mode, _Out_ uint32 *old)'),
    GetVolumeInformationW: k32.func('bool __stdcall GetVolumeInformationW(str16 root, void *name, uint32 nameLen, _Out_ uint32 *serial, _Out_ uint32 *maxComp, _Out_ uint32 *flags, void *fs, uint32 fsLen)'),
    GetDiskFreeSpaceExW: k32.func('bool __stdcall GetDiskFreeSpaceExW(str16 root, void *freeCaller, void *total, void *free)'),
    CreateFileW: k32.func('void * __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void *sec, uint32 disp, uint32 flags, void *tmpl)'),
    DeviceIoControl: k32.func('bool __stdcall DeviceIoControl(void *h, uint32 code, void *inBuf, uint32 inLen, void *outBuf, uint32 outLen, _Out_ uint32 *ret, void *ov)'),
    CloseHandle: k32.func('bool __stdcall CloseHandle(void *h)'),
    GetLastError: k32.func('uint32 __stdcall GetLastError()'),
    SetupDiGetClassDevsW: sapi.func('void * __stdcall SetupDiGetClassDevsW(void *guid, str16 enumerator, void *hwnd, uint32 flags)'),
    SetupDiEnumDeviceInterfaces: sapi.func('bool __stdcall SetupDiEnumDeviceInterfaces(void *set, void *devInfo, void *guid, uint32 idx, void *ifData)'),
    SetupDiGetDeviceInterfaceDetailW: sapi.func('bool __stdcall SetupDiGetDeviceInterfaceDetailW(void *set, void *ifData, void *detail, uint32 size, _Out_ uint32 *required, void *devInfo)'),
    SetupDiGetDeviceInstanceIdW: sapi.func('bool __stdcall SetupDiGetDeviceInstanceIdW(void *set, void *devInfo, void *buf, uint32 size, _Out_ uint32 *required)'),
    SetupDiGetDeviceRegistryPropertyW: sapi.func('bool __stdcall SetupDiGetDeviceRegistryPropertyW(void *set, void *devInfo, uint32 prop, _Out_ uint32 *type, void *buf, uint32 size, _Out_ uint32 *required)'),
    SetupDiDestroyDeviceInfoList: sapi.func('bool __stdcall SetupDiDestroyDeviceInfoList(void *set)'),
  };
  W.SetThreadErrorMode(SEM_FAILCRITICALERRORS, [0]);
  return W;
}

function invalid(h) {
  if (h === null || h === undefined) return true;
  const a = W.koffi.address(h);
  return a === 0n || a === 0xFFFFFFFFFFFFFFFFn || a === 0xFFFFFFFFn;
}

const rootOf = (L) => L + ':\\';

function volumeInfo(L) {
  const name = Buffer.alloc(261 * 2), fsName = Buffer.alloc(261 * 2);
  const serial = [0];
  if (!W.GetVolumeInformationW(rootOf(L), name, 261, serial, [0], [0], fsName, 261)) return null;
  return { label: utf16z(name), fileSystem: utf16z(fsName), serial: serial[0] };
}

function freeSpace(L) {
  const fc = Buffer.alloc(8), tot = Buffer.alloc(8), fr = Buffer.alloc(8);
  if (!W.GetDiskFreeSpaceExW(rootOf(L), fc, tot, fr)) return null;
  return { total: Number(tot.readBigUInt64LE(0)), free: Number(fr.readBigUInt64LE(0)) };
}

// Open a device with no access rights: enough for the storage queries, no admin needed.
function openQuery(devPath) {
  const h = W.CreateFileW(devPath, 0, FILE_SHARE_READ_WRITE, null, OPEN_EXISTING, 0, null);
  return invalid(h) ? null : h;
}

// STORAGE_DEVICE_NUMBER { DeviceType, DeviceNumber, PartitionNumber }, or null.
function deviceNumber(h) {
  const out = Buffer.alloc(12);
  if (!W.DeviceIoControl(h, IOCTL_STORAGE_GET_DEVICE_NUMBER, null, 0, out, 12, [0], null)) return null;
  return { type: out.readUInt32LE(0), number: out.readUInt32LE(4), partition: out.readUInt32LE(8) };
}

function descriptorOf(h) {
  const q = Buffer.alloc(12);   // STORAGE_PROPERTY_QUERY { StorageDeviceProperty, PropertyStandardQuery }
  const out = Buffer.alloc(1024);
  if (!W.DeviceIoControl(h, IOCTL_STORAGE_QUERY_PROPERTY, q, 12, out, 1024, [0], null)) return null;
  return parseDeviceDescriptor(out);
}

// Does the volume sit on a partition with length? This is the fact the Win32_LogicalDisk ->
// Win32_DiskPartition association stood for: an empty slot keeps its disk and a zero-length
// partition, so its device number alone is not enough.
function hasPartition(h) {
  const out = Buffer.alloc(256);   // PARTITION_INFORMATION_EX; PartitionLength at 16
  if (!W.DeviceIoControl(h, IOCTL_DISK_GET_PARTITION_INFO_EX, null, 0, out, 256, [0], null)) return false;
  return out.readBigInt64LE(16) > 0n;
}

// ── The operations the worker runs ──────────────────────────────────────────

function opListReady() {
  bind();
  const out = [];
  for (const L of lettersOf(W.GetLogicalDrives())) {
    if (W.GetDriveTypeW(rootOf(L)) !== DRIVE_REMOVABLE) continue;
    const vi = volumeInfo(L);
    if (vi) out.push({ mountPath: rootOf(L), label: vi.label });
  }
  return out;
}

// B-420: a row excluded by removableOnly or onlyLetter is never read, so a network drive is
// never contacted. The drive type comes from the mount manager, not from the volume.
function opEnumerate(removableOnly, onlyLetter) {
  bind();
  const rows = [];
  for (const L of lettersOf(W.GetLogicalDrives())) {
    if (onlyLetter && L !== onlyLetter) continue;
    const t = W.GetDriveTypeW(rootOf(L));
    if (removableOnly && t !== DRIVE_REMOVABLE) continue;
    const vi = volumeInfo(L);
    const sz = freeSpace(L);
    rows.push(volumeRow(L, t, vi, sz));
  }
  return rows;
}

function opDriveType(L) {
  bind();
  return W.GetDriveTypeW(rootOf(L));
}

// The disk behind a letter: { model, pnp, driveType } or null. pnp is the disk's device instance
// ID, which is exactly Win32_DiskDrive.PNPDeviceID; model is its friendly name.
function opClassify(L) {
  bind();
  const driveType = W.GetDriveTypeW(rootOf(L));
  // Only a local disk volume has a disk partition behind it. Opening a network letter would
  // contact its host; CD-ROM and RAM disks were never on the association walk either.
  if (driveType !== DRIVE_REMOVABLE && driveType !== DRIVE_FIXED) return null;
  const hv = openQuery('\\\\.\\' + L + ':');
  if (!hv) return null;
  let target;
  try {
    if (!hasPartition(hv)) return null;
    target = deviceNumber(hv);
  } finally { W.CloseHandle(hv); }
  if (!target || target.type !== FILE_DEVICE_DISK) return null;

  const guid = guidBytes(GUID_DEVINTERFACE_DISK);
  const set = W.SetupDiGetClassDevsW(guid, null, null, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
  if (invalid(set)) return null;
  try {
    const p64 = W.ptr === 8;
    const ifSize = p64 ? 32 : 28;          // SP_DEVICE_INTERFACE_DATA
    const infoSize = p64 ? 32 : 28;        // SP_DEVINFO_DATA
    const detailCb = p64 ? 8 : 6;          // SP_DEVICE_INTERFACE_DETAIL_DATA_W.cbSize
    for (let i = 0; i < 256; i++) {
      const ifData = Buffer.alloc(ifSize);
      ifData.writeUInt32LE(ifSize, 0);
      if (!W.SetupDiEnumDeviceInterfaces(set, null, guid, i, ifData)) break;
      const detail = Buffer.alloc(4096);
      detail.writeUInt32LE(detailCb, 0);
      const info = Buffer.alloc(infoSize);
      info.writeUInt32LE(infoSize, 0);
      if (!W.SetupDiGetDeviceInterfaceDetailW(set, ifData, detail, detail.length, [0], info)) continue;
      const hd = openQuery(utf16z(detail, 4));
      if (!hd) continue;
      let num, desc;
      try { num = deviceNumber(hd); desc = num ? descriptorOf(hd) : null; } finally { W.CloseHandle(hd); }
      if (!num || num.type !== target.type || num.number !== target.number) continue;

      const idBuf = Buffer.alloc(2048);
      if (!W.SetupDiGetDeviceInstanceIdW(set, info, idBuf, 1024, [0])) return null;
      const nameBuf = Buffer.alloc(2048);
      const friendly = W.SetupDiGetDeviceRegistryPropertyW(set, info, SPDRP_FRIENDLYNAME, [0], nameBuf, nameBuf.length, [0])
        ? utf16z(nameBuf) : '';
      return { model: modelFrom(friendly, desc), pnp: utf16z(idBuf), driveType };
    }
    return null;
  } finally { W.SetupDiDestroyDeviceInfoList(set); }
}

// The documented removable-media eject, per VOLUME (a two-slot reader holds two letters on one
// device, and a device-level eject would take the sibling card too). No admin required.
//   lock      refused while anything has the volume open: the busy case, answered by the API
//   dismount  flushes and detaches the file system
//   removal   clears any prevent-removal hold; a failure here does not stop the eject
//   eject     asks the device to release the media
// "no-item" and "no-verb" keep the two answers that mean nothing was asked to release the card:
// no such volume, or a volume of a kind that is not ejected (fixed, network, RAM disk).
function opEject(L) {
  bind();
  const t = W.GetDriveTypeW(rootOf(L));
  if (t === DRIVE_NO_ROOT_DIR) return { ok: true, raw: 'no-item' };
  if (t !== DRIVE_REMOVABLE && t !== DRIVE_CDROM) return { ok: true, raw: 'no-verb' };
  const h = W.CreateFileW('\\\\.\\' + L + ':', GENERIC_READ_WRITE, FILE_SHARE_READ_WRITE, null, OPEN_EXISTING, 0, null);
  if (invalid(h)) {
    const e = W.GetLastError();
    if (e === ERROR_FILE_NOT_FOUND || e === ERROR_PATH_NOT_FOUND) return { ok: true, raw: 'no-item' };
    return ejectResult('open', e);
  }
  try {
    const ret = [0];
    let locked = false, err = 0;
    const nap = new Int32Array(new SharedArrayBuffer(4));
    for (let i = 0; i < LOCK_TRIES && !locked; i++) {
      locked = W.DeviceIoControl(h, FSCTL_LOCK_VOLUME, null, 0, null, 0, ret, null);
      if (!locked) { err = W.GetLastError(); Atomics.wait(nap, 0, 0, LOCK_RETRY_MS); }
    }
    if (!locked) return ejectResult('lock', err);
    if (!W.DeviceIoControl(h, FSCTL_DISMOUNT_VOLUME, null, 0, null, 0, ret, null)) return ejectResult('dismount', W.GetLastError());
    W.DeviceIoControl(h, IOCTL_STORAGE_MEDIA_REMOVAL, Buffer.from([0]), 1, null, 0, ret, null);
    if (!W.DeviceIoControl(h, IOCTL_STORAGE_EJECT_MEDIA, null, 0, null, 0, ret, null)) return ejectResult('eject', W.GetLastError());
    return ejectResult('done');
  } finally { W.CloseHandle(h); }
}

const OPS = { listReady: opListReady, enumerate: opEnumerate, driveType: opDriveType,
              classify: opClassify, eject: opEject };

// ── Worker entry ────────────────────────────────────────────────────────────
const wt = require('worker_threads');
if (!wt.isMainThread && wt.workerData && wt.workerData.winDisksOp) {
  const { winDisksOp, args } = wt.workerData;
  let msg;
  try { msg = { ok: true, value: OPS[winDisksOp](...(args || [])) }; }
  catch (e) { msg = { ok: false, error: String(e && e.message || e) }; }
  wt.parentPort.postMessage(msg);
}

const CODES = {
  IOCTL_STORAGE_GET_DEVICE_NUMBER, IOCTL_STORAGE_QUERY_PROPERTY, IOCTL_DISK_GET_PARTITION_INFO_EX,
  FSCTL_LOCK_VOLUME, FSCTL_DISMOUNT_VOLUME, IOCTL_STORAGE_MEDIA_REMOVAL, IOCTL_STORAGE_EJECT_MEDIA,
};

module.exports = {
  OPS, CODES, GUID_DEVINTERFACE_DISK,
  driveKindFromType, volumeSerialHex, utf16z, guidBytes, parseDeviceDescriptor, modelFrom,
  volumeRow, lettersOf, ejectResult,
};
