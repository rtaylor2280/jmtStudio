// Linux disk facts for card detection and export destinations.
//
// Everything here comes from `lsblk -J -b`, which a normal user can run on any distribution with
// util-linux. Shapes were captured from a real machine (Ubuntu 26.04 on a Lenovo Yoga, a Transcend
// SD reader and a Proffieboard V3 presenting its card) and are kept in test/linux-fixtures/.
//
// Simpler than macOS: lsblk names the board's card directly - vendor "Tlera", model "DOSFS",
// serial = the board's own serial - so no separate USB lookup is needed.
//
// Read-only. Every call is bounded and degrades to null or [] when a command fails, so a missing
// answer is "cannot tell", never "no card".

'use strict';

const { execFile } = require('child_process');

const LSBLK_COLS = 'NAME,PATH,PKNAME,TYPE,RM,HOTPLUG,TRAN,VENDOR,MODEL,SERIAL,SIZE,FSTYPE,FSVER,LABEL,UUID,MOUNTPOINTS,FSAVAIL,FSSIZE';

function _run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout, windowsHide: true },
      (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

async function lsblk() {
  const out = await _run('lsblk', ['-J', '-b', '-o', LSBLK_COLS], 8000);
  if (!out) return null;
  try { return JSON.parse(out); } catch { return null; }
}

const _trim = (s) => (s == null ? '' : String(s).trim());
// Bytes. `-b` gives plain numbers; without it lsblk writes "14.6G", which is read too, so a
// version that ignores -b still gives a size rather than "no media".
const _num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const m = /^([\d.]+)\s*([KMGTP])i?B?$/i.exec(String(v).trim());
  return m ? Math.round(parseFloat(m[1]) * 1024 ** ('KMGTP'.indexOf(m[2].toUpperCase()) + 1)) : null;
};
const _mounts = (d) => (Array.isArray(d.mountpoints) ? d.mountpoints : [d.mountpoint]).filter(Boolean);

// "FAT32" / "FAT16" / "exFAT" / ..., the way the Windows rows name a file system.
function _fileSystemName(d) {
  const t = _trim(d.fstype).toLowerCase();
  const v = _trim(d.fsver).toUpperCase();
  if (t === 'vfat') return /^FAT(12|16|32)$/.test(v) ? v : 'FAT';
  if (t === 'exfat') return 'exFAT';
  if (t === 'ntfs' || t === 'ntfs3') return 'NTFS';
  return t || null;
}

// Every mounted volume on a whole disk: its partitions with a mount point, and a disk formatted
// without a partition table that carries its own. `disk` travels with each, for the device facts.
function mountedFrom(tree) {
  const out = [];
  for (const disk of (tree && tree.blockdevices) || []) {
    if (!disk || disk.type !== 'disk') continue;
    if (_mounts(disk).length) out.push({ part: disk, disk });
    for (const p of disk.children || []) if (_mounts(p).length) out.push({ part: p, disk });
  }
  return out;
}

// The record sdCardDetect builds on Windows. driveType keeps the Windows numbering the app
// already reads: 2 removable, 3 fixed. A card reader and the board's card are both rm + usb.
function volumeRow(part, disk) {
  const mount = _mounts(part)[0];
  if (!mount) return null;
  const removable = disk.rm === true || disk.rm === '1' || disk.hotplug === true || disk.hotplug === '1';
  return {
    drive: null,
    mountPath: mount,
    fileSystem: _fileSystemName(part),
    label: _trim(part.label) || null,
    volumeSerial: null,
    volumeUuid: _trim(part.uuid) || null,
    hasMedia: (_num(disk.size) || 0) > 0,
    sizeBytes: _num(part.fssize) || _num(part.size) || 0,
    freeBytes: _num(part.fsavail),
    driveType: removable ? 2 : 3,
    deviceId: part.path || null,
    wholeDisk: disk.path || null,
  };
}

async function enumerateVolumes(removableOnly, onlyMount = null) {
  const tree = await lsblk();
  const want = onlyMount ? String(onlyMount).replace(/\/+$/, '') : null;
  const rows = [];
  for (const { part, disk } of mountedFrom(tree)) {
    const row = volumeRow(part, disk);
    if (!row) continue;
    if (want && row.mountPath !== want) continue;
    if (removableOnly && row.driveType !== 2) continue;
    rows.push(row);
  }
  return rows;
}

// The mount a path sits under: the longest mount point that is the path or a parent of it.
// Async because, unlike /Volumes on a Mac, a Linux mount can be anywhere.
async function mountOf(p, tree = null) {
  const target = String(p || '').replace(/\/+$/, '') || '/';
  let best = null;
  for (const m of mountedFrom(tree || await lsblk())) {
    for (const mp of _mounts(m.part)) {
      const root = mp.replace(/\/+$/, '') || '/';
      const inside = target === root || target.startsWith(root === '/' ? '/' : root + '/');
      if (inside && (!best || root.length > best.root.length)) best = { root, part: m.part, disk: m.disk };
    }
  }
  return best;
}

// /proc/mounts, parsed. The kernel writes a space in a path as \040 (tab \011, newline \012,
// backslash \134), so a card labelled "MY CARD" reads back as MY\040CARD until decoded.
const _unoct = (s) => String(s || '').replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
function parseProcMounts(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) {
    const [source, mp, type] = l.split(' ');
    if (mp) out.push({ source: _unoct(source), root: _unoct(mp), type: type || '' });
  }
  return out;
}

// The mount a path sits under, synchronously, from /proc/mounts: { source, root, type } or null.
// Eject needs this without waiting, and it is the kernel's own table, so it is never stale.
function procMountOf(p, text = null) {
  let rows;
  try { rows = parseProcMounts(text != null ? text : require('fs').readFileSync('/proc/mounts', 'utf8')); }
  catch { return null; }
  const target = String(p || '').replace(/\/+$/, '') || '/';
  let best = null;
  for (const r of rows) {
    const root = r.root.replace(/\/+$/, '') || '/';
    const inside = target === root || target.startsWith(root === '/' ? '/' : root + '/');
    if (inside && (!best || root.length > best.root.length)) best = { ...r, root };
  }
  return best;
}

// A network mount is not in lsblk at all; /proc/mounts says what it is.
function _networkMountOf(p) {
  const m = procMountOf(p);
  return m && /^(nfs4?|cifs|smb3?|sshfs|fuse\.sshfs|davfs|fuse\.rclone)$/.test(m.type) ? m : null;
}

// removable / fixed / network for a destination path.
async function driveKind(destDir, tree = null) {
  const m = await mountOf(destDir, tree);
  if (!m) return _networkMountOf(String(destDir || '')) ? { removable: false, kind: 'network' } : null;
  const removable = m.disk.rm === true || m.disk.rm === '1' || m.disk.hotplug === true || m.disk.hotplug === '1';
  return removable ? { removable: true, kind: 'removable' } : { removable: false, kind: 'fixed' };
}

// Is the card at destDir mounted through a Proffieboard? Returns the Windows lookup's shape:
// { transport, boardSerial, model, removable }. The board presents its card as vendor "Tlera",
// product "DOSFS" - the same words Windows and macOS match on - and on Linux the disk's serial IS
// the board's serial, so it is read straight off the same row.
async function classify(destDir, classifyTransport, tree = null) {
  const m = await mountOf(destDir, tree);
  if (!m) return null;
  const model = [_trim(m.disk.vendor), _trim(m.disk.model)].filter(Boolean).join(' ');
  const c = classifyTransport(model, '');
  if (c.transport === 'proffieboard') c.boardSerial = _trim(m.disk.serial).toUpperCase() || null;
  c.removable = m.disk.rm === true || m.disk.rm === '1' || m.disk.hotplug === true || m.disk.hotplug === '1';
  return c;
}

module.exports = {
  LSBLK_COLS, lsblk, mountedFrom, volumeRow, enumerateVolumes, mountOf, driveKind, classify,
  parseProcMounts, procMountOf, _fileSystemName,
};
