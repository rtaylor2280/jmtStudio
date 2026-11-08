// macOS disk facts for card detection and export destinations.
//
// Everything here comes from `diskutil ... -plist` and `system_profiler`, which a normal user can
// run. Shapes were captured from a real Mac (macOS 26, SABRENT reader, WD external HDD) and are
// kept in test/mac-fixtures/.
//
// Read-only. Every call is bounded and degrades to null or [] when a command fails, so a missing
// answer is "cannot tell", never "no card".

'use strict';

const { execFile } = require('child_process');

// ── A minimal XML plist reader ──
// Handles the types diskutil emits: dict, array, string, integer, real, true, false, date, data.
function parsePlist(xml) {
  const src = String(xml || '');
  const start = src.indexOf('<plist');
  if (start < 0) return null;
  const re = /<(\/?)(dict|array|key|string|integer|real|true|false|date|data)(\s*\/)?>/g;
  re.lastIndex = start;
  const stack = [];
  let root;
  let pendingKey = null;
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const put = (v) => {
    const top = stack[stack.length - 1];
    if (!top) { root = v; return; }
    if (Array.isArray(top)) top.push(v);
    else { top[pendingKey] = v; pendingKey = null; }
  };
  let m;
  while ((m = re.exec(src))) {
    const [, closing, tag, selfClose] = m;
    if (tag === 'dict' || tag === 'array') {
      if (selfClose) { put(tag === 'dict' ? {} : []); continue; }
      if (closing) {
        const done = stack.pop();
        if (!stack.length) root = done;
        continue;
      }
      const v = tag === 'dict' ? {} : [];
      put(v);
      stack.push(v);
      continue;
    }
    if (tag === 'true' || tag === 'false') { put(tag === 'true'); continue; }
    if (closing) continue;
    if (selfClose) { if (tag === 'key') pendingKey = ''; else put(tag === 'string' ? '' : null); continue; }
    const end = src.indexOf('</' + tag + '>', re.lastIndex);
    if (end < 0) return null;
    const text = decode(src.slice(re.lastIndex, end));
    re.lastIndex = end + tag.length + 3;
    if (tag === 'key') pendingKey = text;
    else if (tag === 'integer') put(parseInt(text, 10));
    else if (tag === 'real') put(parseFloat(text));
    else put(text);
  }
  return root === undefined ? null : root;
}

function _run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout, windowsHide: true },
      (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

async function diskutilInfo(target) {
  const out = await _run('diskutil', ['info', '-plist', String(target)], 8000);
  return out ? parsePlist(out) : null;
}

async function diskutilListPhysical() {
  const out = await _run('diskutil', ['list', '-plist', 'physical'], 8000);
  return out ? parsePlist(out) : null;
}

// Every mounted volume on a physical disk: partitions with a MountPoint, and whole disks
// formatted without a partition table that carry their own MountPoint.
function mountedFromList(list) {
  const out = [];
  for (const d of (list && list.AllDisksAndPartitions) || []) {
    if (d.MountPoint) out.push({ id: d.DeviceIdentifier, wholeDisk: d.DeviceIdentifier, mountPoint: d.MountPoint });
    for (const p of d.Partitions || []) {
      if (p.MountPoint) out.push({ id: p.DeviceIdentifier, wholeDisk: d.DeviceIdentifier, mountPoint: p.MountPoint });
    }
  }
  return out;
}

function _fileSystemName(info) {
  const type = String(info.FilesystemType || '').toLowerCase();
  const name = String(info.FilesystemName || '');
  if (type === 'msdos') {
    if (/FAT32/i.test(name)) return 'FAT32';
    if (/FAT16/i.test(name)) return 'FAT16';
    if (/FAT12/i.test(name)) return 'FAT12';
    return 'FAT';
  }
  if (type === 'exfat') return 'exFAT';
  return name || type || null;
}

// The record sdCardDetect builds on Windows, from one `diskutil info` result.
// driveType keeps the Windows numbering the app already reads: 2 removable, 3 fixed.
function volumeRowFromInfo(info) {
  if (!info || !info.MountPoint) return null;
  const removable = info.RemovableMedia === true;
  const size = Number(info.TotalSize || info.Size) || 0;
  const free = Number(info.FreeSpace != null ? info.FreeSpace : info.APFSContainerFree);
  return {
    drive: null,
    mountPath: info.MountPoint,
    fileSystem: _fileSystemName(info),
    label: info.VolumeName || null,
    volumeSerial: null,
    volumeUuid: info.VolumeUUID || null,
    hasMedia: true,
    sizeBytes: size,
    freeBytes: Number.isFinite(free) ? free : null,
    driveType: removable ? 2 : 3,
    deviceId: info.DeviceIdentifier || null,
    wholeDisk: info.ParentWholeDisk || info.DeviceIdentifier || null,
  };
}

async function enumerateVolumes(removableOnly, onlyMount = null) {
  const list = await diskutilListPhysical();
  const want = onlyMount ? String(onlyMount).replace(/\/+$/, '') : null;
  const rows = [];
  for (const m of mountedFromList(list)) {
    if (want && m.mountPoint !== want) continue;
    const row = volumeRowFromInfo(await diskutilInfo(m.id));
    if (!row) continue;
    if (removableOnly && row.driveType !== 2) continue;
    rows.push(row);
  }
  return rows;
}

// The /Volumes child a path sits under, or null.
function mountRootOf(p) {
  const m = String(p || '').match(/^(\/Volumes\/[^/]+)/);
  return m ? m[1] : null;
}

// removable / fixed / network for a destination path.
async function driveKind(destDir) {
  const root = mountRootOf(destDir);
  if (!root) return null;
  const info = await diskutilInfo(root);
  if (!info) return null;
  const fs = String(info.FilesystemType || '').toLowerCase();
  if (/^(smbfs|afpfs|nfs|webdav)$/.test(fs)) return { removable: false, kind: 'network' };
  if (info.RemovableMedia === true) return { removable: true, kind: 'removable' };
  if (info.RemovableMedia === false) return { removable: false, kind: 'fixed' };
  return null;
}

// Serial numbers of every attached Proffieboard (USB vendor 0x1209).
function proffieboardSerialsFrom(sp) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (String(n.USBDeviceKeyVendorID || '').toLowerCase() === '0x1209') {
      const sn = String(n.USBDeviceKeySerialNumber || '').trim();
      if (sn && !/not provided/i.test(sn)) out.push(sn.toUpperCase());
    }
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(sp);
  return out;
}

async function proffieboardSerials() {
  const out = await _run('system_profiler', ['SPUSBHostDataType', '-json'], 8000);
  if (!out) return null;
  try { return proffieboardSerialsFrom(JSON.parse(out)); } catch { return null; }
}

// Is the card at destDir mounted through a Proffieboard? Returns the same shape as the
// Windows lookup: { transport, boardSerial, model, removable }.
// The board presents its card as vendor "Tlera", product "DOSFS", which is what Windows matches
// on too; classifyTransport (exportDestination.js) reads it from the device name.
async function classify(destDir, classifyTransport) {
  const root = mountRootOf(destDir);
  if (!root) return null;
  const part = await diskutilInfo(root);
  if (!part) return null;
  const whole = part.ParentWholeDisk ? await diskutilInfo(part.ParentWholeDisk) : part;
  const model = [whole && whole.IORegistryEntryName, whole && whole.MediaName, part.MediaName]
    .filter(Boolean).join(' ');
  const c = classifyTransport(model, '');
  if (c.transport === 'proffieboard') {
    const serials = await proffieboardSerials();
    c.boardSerial = serials && serials.length === 1 ? serials[0] : null;
  }
  c.removable = part.RemovableMedia === true;
  return c;
}

module.exports = {
  parsePlist, mountedFromList, volumeRowFromInfo, proffieboardSerialsFrom, mountRootOf,
  diskutilInfo, enumerateVolumes, driveKind, classify, proffieboardSerials,
};
