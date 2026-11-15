// Windows disk facts for card detection, export destinations and safe eject. [B-681]
//
// The Windows counterpart of macDisks.js and linuxDisks.js. Every PowerShell, cmd.exe and fsutil
// launch the card code makes lives here, so the set of outside programs Studio starts for a card
// is in one file that a guard test (test/windows-shellouts-one-place.test.js) holds in place.
//
// The commands, arguments, timeouts and parsing are the ones the callers ran before the move;
// the callers keep their own platform switches, health stamping and verdict logic.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ── Removable drives with media, for SD Export's button ── [B-664]
// DriveInfo answers "which removable drives have media" from the volume itself, without the CIM
// walk the full scan pays. The rationale and measurements are in cardPresence.js.
// UNKNOWN IS NOT "NO CARDS" ([B-028]). A check that fails or times out returns null.
// Kept separate from enumerateVolumes on purpose: the two answer different questions at
// different prices.
function listReadyRemovable() {
  const ps = "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Removable' -and $_.IsReady } "
           + "| ForEach-Object { $_.Name + '|' + $_.VolumeLabel }";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 8000 }, (err, stdout) => {
        if (err) { resolve(null); return; }
        resolve(String(stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map((l) => {
          const i = l.indexOf('|');
          return { mountPath: i < 0 ? l : l.slice(0, i), label: i < 0 ? '' : l.slice(i + 1) };
        }));
      });
  });
}

// ── Volume rows from Win32_LogicalDisk ── [B-420]
// Resolves the parsed rows (an object is wrapped in an array), or [] when the spawn or the parse
// fails. Health is NOT read here: sdCardDetect.js stamps it from the filesystem's dirty flag.
// Why `onlyLetter` exists is documented on sdCardDetect.enumerateVolumesWindows.
function enumerateVolumes(removableOnly, onlyLetter = null) {
  // DriveType=2 = removable media (SD readers, USB sticks). removableOnly=false is used when
  // the user explicitly points at a drive, so its metadata can still be reported.
  //
  // hasMedia distinguishes "no card in this slot" from "card present but unreadable".
  // A multi-slot reader publishes a drive letter for EVERY slot, occupied or not, so an
  // empty slot arrives here looking like a volume. Win32_LogicalDisk reports Size as null
  // for it (verified 2026-08-06 against a two-slot reader: the loaded slot reported a size,
  // the empty one reported null), and the storage layer agrees — Win32_DiskDrive gives that
  // slot a blank MediaType and a null Size. Note this must be tested BEFORE the [int64] cast
  // below, which turns null into 0 and destroys the distinction. Empty slots cannot be
  // reached through partition associations, since a slot with no media has no partitions,
  // which is why the answer is taken here rather than derived downstream.
  // FILTERED IN THE CIM QUERY, NOT IN JAVASCRIPT AFTERWARDS. That is the whole point: a row
  // excluded here is never materialised, so its VolumeName is never read and no network round
  // trip happens. Filtering the returned array would be too late - the blocking has already
  // occurred by the time the array could be looked at.
  const clauses = [];
  if (removableOnly) clauses.push('DriveType=2');
  if (onlyLetter) {
    const L = String(onlyLetter).slice(0, 1).toUpperCase();
    if (!/^[A-Z]$/.test(L)) return Promise.resolve([]);
    clauses.push(`DeviceID='${L}:'`);
  }
  const filter = clauses.length ? ` -Filter "${clauses.join(' AND ')}"` : '';
  const ps = [
    '$vols = Get-CimInstance Win32_LogicalDisk' + filter,
    '$out = foreach ($v in $vols) {',
    // NO `Get-Volume` PER VOLUME. [B-441] HealthStatus is computed in JS from the filesystem's
    // own dirty flag - one method, the card surface and the export refusal both. See
    // `_healthFromDirtyBit` in sdCardDetect.js. A per-volume Get-Volume was measured
    // 2026-09-27 at 124 ms warm and 1864 ms cold, inside a loop over every volume.
    '  $letter = $v.DeviceID.TrimEnd(":")',
    '  [pscustomobject]@{',
    '    drive        = $v.DeviceID',
    '    mountPath    = $v.DeviceID + "\\"',
    '    fileSystem   = $v.FileSystem',
    '    label        = $v.VolumeName',
    '    volumeSerial = $v.VolumeSerialNumber',
    '    hasMedia     = ($null -ne $v.Size)',
    '    sizeBytes    = [int64]$v.Size',
    '    freeBytes    = [int64]$v.FreeSpace',
    // `health` is NOT emitted here - it is stamped on in JS by sdCardDetect.js, so that the card
    // surface and the export refusal cannot end up answering from two different signals.
    '    driveType    = [int]$v.DriveType',
    '  }',
    '}',
    'ConvertTo-Json -InputObject @($out) -Depth 4',
  ].join('\n');
  return new Promise((resolve) => {
    // [B-420] Anything that can break when the drives on a system change is fragile and the
    // wrong architecture. Filtering network drives fixes one INSTANCE. The CLASS is that any
    // volume can be slow or dead - a dying card, a stalled reader, a drive mid-format - and the
    // app must not care what happens to be attached.
    // So no volume query may block indefinitely. 10s is far outside the ~3,100-3,200 ms this
    // is documented at, so a healthy-but-slow system still answers; a wedged one gives up.
    // Degrades to [] = "we could not enumerate", which is the [B-028] rule: failing to
    // identify something is never evidence about it, and must never be read as "no cards".
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { maxBuffer: 1024 * 1024, windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const parsed = JSON.parse((stdout || '').trim() || '[]');
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch { resolve([]); }
      });
  });
}

// ── Board card or reader? ── [B-420]
// Resolves { transport, boardSerial, model, removable } from classifyTransport
// (exportDestination.js, passed in as macDisks.classify takes it), or null for "cannot tell".
// ONE SPAWN, RETURNING BOTH removable AND transport. DriveType comes off the same
// Win32_LogicalDisk the association walk already lands on, so it costs nothing to carry it back.
function classify(driveLetter, classifyTransport) {
  const letter = String(driveLetter || '').slice(0, 1).toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return Promise.resolve(null);
  // ASK ABOUT ONE DRIVE, NOT ABOUT EVERY DRIVE. [B-420, 2026-09-24]
  //
  // Walking EVERY physical disk, then every partition of each, then every logical disk of each,
  // and filtering for the target letter INSIDE the innermost loop enumerates the whole storage
  // topology to answer a question about one letter — and on a bench with seven disks attached,
  // that cross-product IS two-and-a-half seconds before every export starts.
  //
  // Start from the letter and take two association hops. Measured on the bench, all four
  // drives, including the Proffieboard's own card:
  //     D: (fixed NVMe)      1,974 ms -> 216 ms
  //     E: (Tlera DOSFS)     1,950 ms -> 223 ms
  //     H: (USB card reader) 1,774 ms -> 189 ms
  //     I: (USB card reader) 1,739 ms -> 192 ms
  // Identical model, PNP id, interface and driveType in every case — this is a DELETION of work,
  // not a cache, so there is no staleness to reason about and no verdict being reused.
  //
  // `-First 1` on each hop is the same answer the full walk produced, not a narrowing: that walk
  // overwrote `$t` on every match and kept the LAST one, so it was already committing to a
  // single row. This commits to the first and documents that it is doing so.
  // A letter with no partition association (a network path, a subst) yields null, which is the
  // same "cannot tell" the full walk produced by never matching. [B-028]: failing to identify
  // something is never evidence about it.
  const ps = [
    '$t = $null',
    '$ld = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'' + letter + ':\'"',
    'if ($ld) {',
    '  $p = Get-CimAssociatedInstance -InputObject $ld -ResultClassName Win32_DiskPartition '
      + '-ErrorAction SilentlyContinue | Select-Object -First 1',
    '  if ($p) {',
    '    $d = Get-CimAssociatedInstance -InputObject $p -ResultClassName Win32_DiskDrive '
      + '-ErrorAction SilentlyContinue | Select-Object -First 1',
    '    if ($d) {',
    '      $t = [pscustomobject]@{ model = $d.Model; pnp = $d.PNPDeviceID; iface = $d.InterfaceType; driveType = [int]$ld.DriveType }',
    '    }',
    '  }',
    '}',
    'if ($t) { ConvertTo-Json -InputObject $t -Depth 3 } else { "null" }',
  ].join('\n');
  return new Promise((resolve) => {
    // [B-420] Bounded, same rule as sdCardDetect: no volume query may hang. 8s is well outside
    // the ~1,900-2,600 ms measured for this walk. Degrades to null = "cannot tell".
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { maxBuffer: 256 * 1024, windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        let o = null;
        try { o = JSON.parse(String(stdout).trim()); } catch { o = null; }
        if (!o || !o.pnp) { resolve(null); return; }
        const c = classifyTransport(o.model, o.pnp);
        c.removable = (o.driveType === 2);
        resolve(c);
      });
  });
}

// ── The FAST half: is it removable? ── [B-005 item 4]
// fsutil, not CIM: why, with the measurements, is on exportDestination.driveKind.
// Resolves { removable, kind } or null - never an assumption. [B-028]
function driveKind(driveLetter) {
  return new Promise((resolve) => {
    // [B-420] Bounded. Measured at 72-128 ms, so 5s means "this volume is not answering".
    execFile('fsutil', ['fsinfo', 'drivetype', driveLetter.toUpperCase() + ':'],
      { windowsHide: true, maxBuffer: 64 * 1024, timeout: 5000 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const s = String(stdout || '');
        // MATCH THE KIND, DO NOT INFER IT FROM THE ABSENCE OF ANOTHER. "not Fixed" is not
        // "removable" - Remote, CD-ROM and Unknown are all neither, and an unrecognised
        // string must come back null so callers keep treating it as "cannot tell".
        if (/Removable Drive/i.test(s))     { resolve({ removable: true,  kind: 'removable' }); return; }
        if (/Fixed Drive/i.test(s))         { resolve({ removable: false, kind: 'fixed' }); return; }
        if (/Remote\/Network Drive/i.test(s)) { resolve({ removable: false, kind: 'network' }); return; }
        if (/CD-ROM Drive/i.test(s))        { resolve({ removable: false, kind: 'cdrom' }); return; }
        if (/RAM Disk/i.test(s))            { resolve({ removable: false, kind: 'ramdisk' }); return; }
        resolve(null);
      });
  });
}

// ── Safe eject: the question and the action ── [B-005 item 4]
// Why the eject is split into a readable query and a detached launch is on safeEject.js
// PLATFORMS.win32.invoke. `exec` is safeEject's `_exec`, passed in rather than duplicated, so both
// spawns keep its options and its { ok, out, err, missing } result.

// The question, asked where the answer can be read. Resolves `exec`'s result; its `out` is
// "no-item", "no-verb", "has-verb" or "error: ...".
function ejectVerbQuery(letter, exec) {
  const query = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    '  $sh = New-Object -comObject Shell.Application',
    `  $item = $sh.Namespace(17).ParseName("${letter}:")`,
    '  if ($item -eq $null) { "no-item"; exit 0 }',
    '  $found = $false',
    // The accelerator can sit anywhere in the word, so remove every `&` rather than trimming
    // a prefix. `E&ject` and `&Eject` both have to reduce to `Eject`.
    "  foreach ($v in $item.Verbs()) { if ($v.Name -and ($v.Name -replace '&','') -eq 'Eject') { $found = $true } }",
    '  if ($found) { "has-verb" } else { "no-verb" }',
    '} catch { "error: " + $_.Exception.Message }',
  ].join('\n');
  return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query]);
}

// The action, launched detached through `cmd /c start` so Windows draws its own "Safe To Remove
// Hardware" notification. The script goes to a file in %TEMP%, not through `start`'s argument
// parser. Resolves { ok: true, raw: 'launched' } or { ok: false, raw: 'launch-failed: ...' }.
async function ejectLaunch(letter, exec) {
  const script = [
    '$sh = New-Object -comObject Shell.Application',
    `$item = $sh.Namespace(17).ParseName('${letter}:')`,
    'if ($null -ne $item) {',
    '  $verb = $null',
    // The accelerator can sit anywhere in the word, so remove every `&` rather than trimming
    // a prefix. `E&ject` and `&Eject` both have to reduce to `Eject`.
    "  foreach ($v in $item.Verbs()) { if ($v.Name -and ($v.Name -replace '&','') -eq 'Eject') { $verb = $v } }",
    '  if ($null -ne $verb) { $verb.DoIt() }',
    '}',
    // Holds the host open past DoIt(), which posts the verb rather than performing it.
    'Start-Sleep -Milliseconds 2500',
  ].join('\r\n');
  try {
    const tmp = path.join(require('os').tmpdir(), `jmt-eject-${letter}.ps1`);
    fs.writeFileSync(tmp, script, 'utf8');
    await exec('cmd.exe', ['/c', 'start', '', '/min', 'powershell.exe',
                           '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp]);
    return { ok: true, raw: 'launched' };
  } catch (err) {
    return { ok: false, raw: 'launch-failed: ' + String(err && err.message || err) };
  }
}

module.exports = {
  listReadyRemovable, enumerateVolumes, classify, driveKind, ejectVerbQuery, ejectLaunch,
};
