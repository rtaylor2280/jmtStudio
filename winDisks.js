// Windows disk facts for card detection, export destinations and safe eject. [B-681]
//
// The Windows counterpart of macDisks.js and linuxDisks.js. NO CHILD PROCESSES: every answer is a
// Win32 call made in-process through koffi (winDisksNative.js), because behaviour-based antivirus
// kills an Electron app that keeps launching PowerShell, cmd.exe and fsutil (QA BUG-012). A guard
// test (test/windows-shellouts-one-place.test.js) holds this file at zero launches.
//
// SAME SHAPES, SAME TIME LIMITS. Each export resolves exactly what the PowerShell / fsutil version
// resolved, and degrades to the same failure value after the same time limit. The callers keep
// their own platform switches, health stamping and verdict logic.
//
// OFF THE MAIN THREAD. Each call runs on its own worker thread (winNativeRun.js), and a worker
// that has not answered in time is abandoned with the failure value.

'use strict';

const { runNative } = require('./winNativeRun');

// Run one winDisksNative operation on a fresh worker. Resolves its value, `failValue` when the
// worker fails or throws, or `timeoutValue` (failValue unless given) when it has not answered
// within `timeoutMs`. The worker rules - never terminated, answered only once it has exited, a
// quit held while a call is in flight - are in winNativeRun.js, shared with winSystem.js.
function _run(op, args, timeoutMs, failValue, timeoutValue = failValue) {
  return runNative('winDisksNative.js', op, args, timeoutMs, failValue, timeoutValue);
}

// ── Removable drives with media, for SD Export's button ── [B-664]
// Removable (GetDriveTypeW 2) and ready (GetVolumeInformationW answers): what DriveInfo's
// Removable + IsReady said. The rationale is in cardPresence.js.
// UNKNOWN IS NOT "NO CARDS" ([B-028]). A check that fails or times out returns null.
// Kept separate from enumerateVolumes on purpose: the two answer different questions at
// different prices.
function listReadyRemovable() {
  return _run('listReady', [], 8000, null);
}

// ── Volume rows ── [B-420]
// Resolves rows { drive, mountPath, fileSystem, label, volumeSerial, hasMedia, sizeBytes,
// freeBytes, driveType }, in the shape the Win32_LogicalDisk query gave (winDisksNative.volumeRow),
// or [] when the enumeration fails. Health is NOT read here: sdCardDetect.js stamps it from the
// filesystem's dirty flag. Why `onlyLetter` exists is documented on
// sdCardDetect.enumerateVolumesWindows.
//
// removableOnly keeps DriveType 2 only (SD readers, USB sticks); false is used when the user
// points at a drive explicitly, so its metadata can still be reported.
//
// hasMedia separates "no card in this slot" from "card present but unreadable". A multi-slot
// reader publishes a letter for EVERY slot, occupied or not, and an empty slot has no size
// (verified 2026-08-06 against a two-slot reader), so hasMedia is "the size could be read".
//
// FILTERED BEFORE THE VOLUME IS READ. A row excluded by removableOnly or onlyLetter is never
// asked for its label or size, so a network drive is never contacted; its type comes from the
// mount manager, which answers locally.
function enumerateVolumes(removableOnly, onlyLetter = null) {
  let L = null;
  if (onlyLetter) {
    L = String(onlyLetter).slice(0, 1).toUpperCase();
    if (!/^[A-Z]$/.test(L)) return Promise.resolve([]);
  }
  // [B-420] No volume query may block indefinitely: any volume can be slow or dead (a dying card,
  // a stalled reader, a drive mid-format, an unreachable share). 10 s, then [] = "could not
  // enumerate", which is the [B-028] rule: failing to identify something is never evidence about
  // it, and must never be read as "no cards".
  return _run('enumerate', [!!removableOnly, L], 10000, [])
    .then((rows) => (Array.isArray(rows) ? rows : []));
}

// ── Board card or reader? ── [B-420]
// Resolves classifyTransport(model, pnp) (exportDestination.js, passed in as macDisks.classify
// takes it) plus `removable`, or null for "cannot tell".
//
// ASK ABOUT ONE DRIVE. The volume's own device number (IOCTL_STORAGE_GET_DEVICE_NUMBER) picks
// out its disk among the present disk interfaces; that disk's device instance ID is
// Win32_DiskDrive.PNPDeviceID and its friendly name is Win32_DiskDrive.Model, so classifyTransport
// sees the same two strings the CIM association walk handed it.
// A letter with no disk partition behind it (a network path, a subst, an empty slot, a virtual
// file system) yields null, as the walk did by finding no association. [B-028]
function classify(driveLetter, classifyTransport) {
  const letter = String(driveLetter || '').slice(0, 1).toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return Promise.resolve(null);
  // [B-420] Bounded, same rule as enumerateVolumes. Degrades to null = "cannot tell".
  return _run('classify', [letter], 8000, null).then((o) => {
    if (!o || !o.pnp) return null;
    const c = classifyTransport(o.model, o.pnp);
    c.removable = (o.driveType === 2);
    return c;
  });
}

// ── The FAST half: is it removable? ── [B-005 item 4]
// GetDriveTypeW, the same fact fsutil's "fsinfo drivetype" printed. Resolves { removable, kind }
// or null - never an assumption. [B-028]
// MATCH THE KIND, DO NOT INFER IT FROM THE ABSENCE OF ANOTHER. "not Fixed" is not "removable":
// unknown and no-root come back null so callers keep treating them as "cannot tell".
function driveKind(driveLetter) {
  const L = String(driveLetter || '').slice(0, 1).toUpperCase();
  if (!/^[A-Z]$/.test(L)) return Promise.resolve(null);
  // [B-420] Bounded: 5 s means "this volume is not answering".
  const { driveKindFromType } = require('./winDisksNative');
  return _run('driveType', [L], 5000, null).then((t) => (t === null ? null : driveKindFromType(t)));
}

// ── Safe eject ── [B-005 item 4]
// The volume-level eject sequence in winDisksNative.opEject: lock, dismount, allow removal, eject.
// Resolves one of
//     { ok: true,  raw: 'ejected' }              the device was asked to release the media
//     { ok: true,  raw: 'no-item' | 'no-verb' }  nothing was asked: no such volume, or not ejectable
//     { ok: false, busy: true, raw: 'busy: ...' } the lock was refused: something has it open
//     { ok: false, raw: 'error: ...' }            a step failed for another reason
//     { ok: true,  raw: 'pending' }               no answer within EJECT_TIMEOUT_MS
// safeEject.js still verifies by watching the media leave; this result only says what was asked
// and what refused. 'pending' hands the verdict to that watch rather than guessing.
const EJECT_TIMEOUT_MS = 30000;
function eject(letter) {
  const L = String(letter || '').slice(0, 1).toUpperCase();
  if (!/^[A-Z]$/.test(L)) return Promise.resolve({ ok: false, raw: 'bad-mount-path' });
  return _run('eject', [L], EJECT_TIMEOUT_MS, null, { ok: true, raw: 'pending' })
    .then((r) => r || { ok: false, raw: 'error: the eject could not run' });
}

module.exports = {
  listReadyRemovable, enumerateVolumes, classify, driveKind, eject, EJECT_TIMEOUT_MS,
};
