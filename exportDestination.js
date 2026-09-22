// ── Export destination: capacity and transport ──────────────────────── [B-203]
//
// One service, so every door that writes bulk data to a user-chosen destination asks
// the same question in the same way. A check wired into one door is worse than no check,
// because it reads as covered.
//
// ⭐⭐ THE DOOR MAP LIVES IN `local/export-doors.md`. READ IT BEFORE ADDING A CAPABILITY
// TO ANY EXPORT PATH. It lists the doors the way a USER reaches them, with the handler and
// module each one lands in, and `test/export-door-map.test.js` fails when the two drift.
//
// ⚠️⚠️ THIS COMMENT USED TO ASSERT A DOOR COUNT AND LIST THE HANDLERS, AND THE COUNT WAS
// WRONG - in a way a handler list cannot reveal. Four separate menu items share
// `sfFile:export`, so counting functions undercounts the ways in; and a handler counted as
// covered was also reachable from a call site carrying none of the guards. Three features
// in a row (09-11 export surface, 09-19 cancel wiring, 09-20 cancel reporting) shipped with
// a gap found by USING the app, never by reading it.
//
// ⚠️ The number is deliberately not repeated here. A count in prose is a claim nobody
// re-checks, and it read as authoritative for weeks while being false. The map holds it and
// a test asserts it.
//
// ⭐ So: handlers are an implementation column, and the UI path is the identity. Count the
// ways in, not the functions.
//
// WHAT IT ANSWERS
//   - How much room is there, and will this write fit?
//   - Is the destination removable? (the free-space rule applies to removable media)
//   - Is it a card attached through a Proffieboard? (that write is much slower)
//
// ⭐ TWO SOURCES ON PURPOSE, AND THE SPLIT IS DELIBERATE.
//   fs.statfs gives the NUMBERS: measured 2026-09-19 at ~2ms on every transport tried -
//   four Proffieboards, two USB card readers, a built-in SDHC slot, local NVMe, and an
//   SMB share - and it is one implementation on Windows, macOS and Linux. It also hands
//   back the cluster size, which is what makes the on-disk cost exact instead of padded.
//   Volume enumeration gives the CLASSIFICATION, and it is Windows-only and costs a
//   PowerShell spawn. So the numbers are always cheap and always available; the labels
//   degrade to null off Windows rather than being guessed.
//
// ⚠️ DEGRADE TO "CANNOT TELL", NEVER TO AN ASSUMPTION. removable and transport are
// true/false/null, and null means unknown. The [B-028] rule applies: failing to identify
// something is not evidence of a contradiction, so an unknown destination must not be
// refused and must not be silently treated as fixed.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ── "This job is big enough to be worth warning about" ───────────────── [B-238]
//
// ⚠️⚠️ ONE DEFINITION. These were written out three times - as literals in two main.js
// handlers and as named constants in the renderer - while a comment above one of the
// literals claimed they were "deliberately read from the SAME constants the renderer
// uses, so the two can never drift apart." They were not; nothing connected them. A
// comment asserting a link is not a link.
//
// The cancel-cleanup rule ([B-005] item 4) made this a fourth reader: the same
// over-threshold-and-on-a-board job that earns a slow-write WARNING is the one whose
// cleanup is slow enough to be worth OFFERING rather than doing. Same question, so it
// must be the same numbers.
//
// ⚠️ EITHER limb, not both. A folder of many small wavs is slow because of the per-file
// round trip; one huge track is slow because of the bytes. Neither alone catches both.
const SLOW_WRITE_MIN_FILES = 150;
const SLOW_WRITE_MIN_BYTES = 60 * 1024 * 1024;

function isSlowWriteJob(fileCount, totalBytes) {
  return (Number(fileCount) || 0) >= SLOW_WRITE_MIN_FILES
      || (Number(totalBytes) || 0) >= SLOW_WRITE_MIN_BYTES;
}

// ⭐ THE ONE TRANSPORT THAT IS ACTUALLY SLOW. His ruling 2026-09-20: "if we can't tell,
// then we assume it's not card through proffie. it's only card through proffie that's the
// long part." A card in a reader or a built-in slot writes at normal speed; the cost is
// the Proffieboard's USB bridge, ~773 ms per file (measured 2026-09-19).
//
// ⚠️ NULL MEANS CANNOT TELL AND MUST READ AS FALSE HERE. transport is Windows-only and
// degrades to null. This matches what the [B-238] warning path already does - its catch
// reads "cannot tell: proceed, never block on an unknown device" - so an unmeasurable
// destination gets the fast, silent behaviour rather than an unnecessary prompt.
const isSlowTransport = (transport) => transport === 'proffieboard';

// ── Free space ───────────────────────────────────────────────────────
//
// ⚠️ USE bavail, NOT bfree. They are identical on Windows (verified: both 59485676 on
// C:) but on POSIX bfree counts root-reserved blocks a normal user cannot write into.
// bavail is correct on both, so this needs no platform branch.
//
// ⚠️ THE DESTINATION MAY NOT EXIST YET. An export commonly names a folder that is about
// to be created, and statfs on a missing path throws ENOENT. Walk up to the nearest
// existing ancestor: free space is a property of the filesystem, not of the leaf.
async function _statfsNearest(destDir) {
  let p = path.resolve(destDir);
  for (;;) {
    try {
      return { st: await fs.promises.statfs(p), at: p };
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
        const up = path.dirname(p);
        if (up === p) throw e;      // reached the root and still nothing
        p = up;
        continue;
      }
      throw e;
    }
  }
}

// ── On-disk cost ─────────────────────────────────────────────────────
//
// ⭐ CLUSTER-ROUNDED, NOT PADDED WITH A MARGIN. FAT32 rounds every file up to a cluster,
// and a sound-font card uses 32 KB clusters (measured on his 16 GB card; NTFS volumes
// here use 4 KB). So a byte-sum underestimates what a write actually consumes, and the
// error is not a constant you could pick a fudge factor for - it depends entirely on the
// file-size mix. Measured across 486 real files in six of his font folders: 4.5% overall,
// ranging 1.7% to 7.4% per folder, and a folder of tiny files is far worse.
// Since statfs already returns the cluster size, the honest cost is computable rather
// than estimated, at no extra I/O.
//
// ⚠️ DIRECTORIES COST A CLUSTER EACH TOO. On FAT32 that is another 32 KB per folder, and
// a font is a nested tree. dirCount is optional because some callers genuinely only have
// a file list, but passing it makes the answer closer.
function onDiskCost(fileSizes, blockSize, dirCount = 0) {
  const bs = Number(blockSize) > 0 ? Number(blockSize) : 4096;
  let total = 0;
  for (const s of fileSizes || []) {
    const n = Number(s) || 0;
    total += Math.ceil(n / bs) * bs;
  }
  return total + (Math.max(0, dirCount | 0) * bs);
}

// ── Transport ────────────────────────────────────────────────────────
//
// Windows only. Maps a drive letter to the device behind it so a card mounted through a
// Proffieboard can be told from the same card in a reader. Measured 2026-09-19, and the
// three shapes are not close calls:
//
//   Proffieboard  Tlera DOSFS USB Device
//                 USBSTOR\DISK&VEN_TLERA&PROD_DOSFS&REV_0.01\...&<serial>&0
//                 parent USB\VID_1209&PID_6668&MI_03, grandparent carries the SERIAL
//   USB reader    Generic MassStorageClass USB Device
//                 USBSTOR\DISK&VEN_GENERIC&PROD_MASSSTORAGECLASS&...
//   Built-in slot SDHC card, GLREADER\GENDISK\...
//
// ⚠️ THE SERIAL IS THE SAME ONE THE COM PORT AND FLASH PATH USE. One board, two
// transports, provably the same device - which is why it is returned rather than dropped.
//
// ⚠️⚠️ DELIBERATELY NOT FOLDED INTO sdCardDetect.enumerateVolumesWindows. That function
// runs on every card scan, and the disk->partition->logical-disk association chain
// measured 1,260ms against 29ms for a USB-disk-only query. Paying that on every scan to
// serve one export-time question would be the wrong trade. This is called lazily, for one
// destination, at the moment a write is planned.
// ⚠️⚠️ ONE SPAWN, RETURNING BOTH removable AND transport. The first cut asked
// sdCardDetect.enumerateAllVolumes for removable and then ran this for transport - two
// PowerShell spawns for one question. DriveType comes off the same Win32_LogicalDisk the
// association walk already lands on, so it costs nothing to carry it back here.
function _classifyWindows(driveLetter) {
  const letter = String(driveLetter || '').slice(0, 1).toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return Promise.resolve(null);
  const ps = [
    '$t = $null',
    'foreach ($d in Get-CimInstance Win32_DiskDrive) {',
    '  foreach ($p in (Get-CimAssociatedInstance -InputObject $d -ResultClassName Win32_DiskPartition -ErrorAction SilentlyContinue)) {',
    '    foreach ($l in (Get-CimAssociatedInstance -InputObject $p -ResultClassName Win32_LogicalDisk -ErrorAction SilentlyContinue)) {',
    '      if ($l.DeviceID -eq "' + letter + ':") {',
    '        $t = [pscustomobject]@{ model = $d.Model; pnp = $d.PNPDeviceID; iface = $d.InterfaceType; driveType = [int]$l.DriveType }',
    '      }',
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

// ── The FAST half: is it removable? ──────────────────────────────── [B-005 item 4]
//
// ⭐⭐ TWO QUESTIONS, TWO PRICES, AND THEY HAD BEEN WELDED TOGETHER. `_classifyWindows` above
// answers "removable?" and "board card?" in one spawn, which reads as efficient and is - IF
// you need both. The export doors almost never do. "Removable?" decides whether to offer a
// safe eject, and every export wants that; "board card?" only changes anything on a job big
// enough to warn about, which is the minority.
//
// ⭐ MEASURED ON HIS MACHINE 2026-09-21, three runs each, V::
//     bare PowerShell spawn (the floor)     311 / 261 / 259 ms
//     removable only, via Win32_LogicalDisk 798 / 865 / 668 ms
//     the board-card association walk      2032 / 2095 / 1854 ms
//     fsutil fsinfo drivetype               128 /  91 /  84 ms   <- this
//
// ⚠️ THE POINT OF THE MEASUREMENT IS THE SECOND ROW, NOT THE THIRD. Asking CIM for just the
// DriveType is barely cheaper than asking for everything, because ~300 ms of it is starting
// PowerShell at all. Splitting the question was worth nothing until the fast half stopped
// paying that floor. fsutil is a plain Win32 console tool - no shell, no profile, no CIM.
//
// ⭐ VERIFIED ACROSS ALL FOUR KINDS on real hardware the same day, 72-120 ms each: a card
// through a Proffieboard and a card in a USB reader both report Removable; a virtual disk
// reports Fixed; an SMB share reports Remote/Network. The network case is the one worth
// noting - DriveType 4 is not 2, so a share is correctly never offered an eject.
//
// ⚠️ Cross-checked against the CIM answer on the same volume (both said Fixed for V:), so
// this is a cheaper instrument for the same fact, not a different fact.
//
// ⚠️ Windows only, and it degrades to null - never to an assumption. [B-028]
function driveKind(destDir) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(null); return; }
    const m = /^([A-Za-z]):/.exec(path.resolve(String(destDir || '')));
    if (!m) { resolve(null); return; }
    // [B-420] Bounded. Measured at 72-128 ms, so 5s means "this volume is not answering".
    execFile('fsutil', ['fsinfo', 'drivetype', m[1].toUpperCase() + ':'],
      { windowsHide: true, maxBuffer: 64 * 1024, timeout: 5000 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const s = String(stdout || '');
        // ⚠️ MATCH THE KIND, DO NOT INFER IT FROM THE ABSENCE OF ANOTHER. "not Fixed" is not
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

// Split out so it can be tested against real device strings without a Windows box.
// ⚠️ ORDER MATTERS: the Proffieboard test is the most specific and runs first. A
// Proffieboard IS a USB mass-storage device, so a generic-mass-storage test placed above
// it would swallow every board.
function classifyTransport(model, pnp) {
  const m = String(model || '');
  const p = String(pnp || '');
  const hay = (m + ' ' + p).toUpperCase();

  if (/VEN_TLERA/.test(hay) || /TLERA/.test(hay) || /PROD_DOSFS/.test(hay)) {
    // The serial sits in the USBSTOR instance path as &<serial>&, 12 hex characters.
    const sn = p.match(/&([0-9A-Fa-f]{12})&/);
    return { transport: 'proffieboard', boardSerial: sn ? sn[1].toUpperCase() : null, model: m };
  }
  if (/GLREADER|GENDISK/.test(hay) || /^SDHC\b/i.test(m)) {
    return { transport: 'card-slot', boardSerial: null, model: m };
  }
  if (/PROD_MASSSTORAGECLASS|VEN_GENERIC/.test(hay)) {
    return { transport: 'card-reader', boardSerial: null, model: m };
  }
  if (/^USBSTOR\\/.test(p)) {
    return { transport: 'usb-storage', boardSerial: null, model: m };
  }
  return { transport: null, boardSerial: null, model: m };
}

// ── Describe a destination ───────────────────────────────────────────
//
// opts.classify - do the Windows device lookup (a PowerShell spawn). Off by default so a
// caller that only needs "will it fit" never pays for it.
async function describe(destDir, opts = {}) {
  const out = {
    ok: false, path: destDir || null, measuredAt: null,
    bytesFree: null, bytesTotal: null, blockSize: null,
    removable: null, driveKind: null,
    transport: null, boardSerial: null, deviceModel: null,
    reason: null,
  };
  if (!destDir) { out.reason = 'no-destination'; return out; }

  try {
    const { st, at } = await _statfsNearest(destDir);
    out.blockSize = st.bsize;
    out.bytesFree = st.bavail * st.bsize;
    out.bytesTotal = st.blocks * st.bsize;
    out.measuredAt = at;
    out.ok = true;
  } catch (e) {
    out.reason = (e && e.code) || 'statfs-failed';
    return out;
  }

  // ⚠️⚠️ CLASSIFICATION IS OPT-IN BECAUSE IT COSTS SECONDS, AND THE MEASUREMENT INVERTED
  // THE ORIGINAL DESIGN. Timed on his machine 2026-09-19:
  //
  //     fs.statfs (the whole fit answer)          0.2 - 0.7 ms
  //     sdCardDetect.enumerateRemovableVolumes  2,401 - 2,795 ms
  //     sdCardDetect.enumerateAllVolumes        3,162 - 3,244 ms
  //     this classify call                         ~1,900 ms
  //
  // The rule this was built to serve was "check free space on exports to REMOVABLE
  // media" - but establishing removable-ness costs roughly 12,000x what the fit check
  // costs. Gating a 0.2ms answer behind a 2.4s question makes the feature slower, not
  // cheaper. So the fit path is statfs ONLY and runs unconditionally; removable and
  // transport are decoration for the summary and for the slow-destination warning, and
  // no writer waits on them.
  //
  // Windows only. macOS and Linux need their own implementations (diskutil/ioreg, lsblk);
  // until those exist these stay null, which callers must read as "cannot tell" rather
  // than as "fixed disk".
  // ── The cheap fact, asked every time ──
  //
  // ⭐⭐ REMOVABLE IS NO LONGER GATED BEHIND `classify`. [B-005 item 4, 2026-09-21] It used to
  // be, because it arrived in the same spawn as the transport - so a door that only wanted to
  // know whether to offer a safe eject had to buy the board-card association walk to get it,
  // and the doors that refused to pay got `null` and silently never offered an eject.
  // ⚠️ At ~85 ms this is cheaper than the rest of any export's opening moves, so there is no
  // threshold on it and no flag for it. Every destination gets identified.
  if (opts.driveKind !== false) {
    const k = await driveKind(destDir);
    if (k) { out.removable = k.removable; out.driveKind = k.kind; }
  }

  // ── The expensive fact, asked only when it can change something ──
  //
  // ⚠️ `classify` now means ONLY "is this a card attached through a Proffieboard", which is
  // the ~1,900 ms question. It changes exactly two behaviours - the slow-write warning and
  // the cancel-cleanup offer - and both are gated on the same size threshold, so below that
  // threshold the answer cannot alter anything and is not worth waiting for.
  if (opts.classify && process.platform === 'win32') {
    const letter = path.resolve(destDir).slice(0, 1).toUpperCase();
    const c = await _classifyWindows(letter);
    if (c) {
      out.transport = c.transport;
      out.boardSerial = c.boardSerial;
      out.deviceModel = c.model;
      // ⚠️ Still honoured when it comes back: the association walk reads DriveType off the
      // same Win32_LogicalDisk row, so on the paths that do run it this is a free
      // confirmation of what fsutil already said.
      if (typeof c.removable === 'boolean') out.removable = c.removable;
    }
  }
  return out;
}

// ── The verdict a writer asks for ────────────────────────────────────
//
// Pass EITHER fileSizes (preferred - allows exact cluster rounding) or totalBytes.
//
// ⚠️ `fits` IS TRUE WHEN WE CANNOT MEASURE. A destination we failed to stat must not
// block a write the user asked for; the numbers are an improvement on blindness, not a
// gate that fails closed. Callers distinguish the cases with `ok`.
async function checkFit(destDir, { fileSizes, totalBytes, dirCount = 0, classify = false } = {}) {
  const d = await describe(destDir, { classify });
  const res = Object.assign({}, d, { needBytes: null, fits: true, shortfallBytes: 0 });
  if (!d.ok) return res;

  res.needBytes = Array.isArray(fileSizes)
    ? onDiskCost(fileSizes, d.blockSize, dirCount)
    : Math.ceil((Number(totalBytes) || 0) / d.blockSize) * d.blockSize;

  res.fits = res.needBytes <= d.bytesFree;
  res.shortfallBytes = res.fits ? 0 : (res.needBytes - d.bytesFree);
  return res;
}

// ── The one question every export door asks ──────────────────────────── [B-005, B-203, B-238]
//
// ⭐⭐ ONE CALL, FOUR CONSUMERS. Three separate questions get asked about the same destination
// - will it fit, is this slow enough to warn about, and (later) how should a cancel clean up
// and may we offer to eject - and they were being asked in two different architectures with
// the board-card test written out twice. This is the single entry point.
//
// ⭐ THE EXPENSIVE HALF IS PAID ONCE. `describe({classify:true})` spawns PowerShell and costs
// ~1,900 ms. It returns BOTH `transport` and `removable`, which is every fact the four
// consumers need, so one spawn serves all of them. ⚠️ It must never be called at cancel time
// or at eject time - the answer is captured here, at the start, and carried.
//
// ⚠️⚠️ THERE IS NO SIZE FLOOR ON THE FIT CHECK, AND ADDING ONE WAS A REAL DEFECT.
//
// A floor of 8 MB was introduced on 2026-09-20 to replace a per-door exemption list, on the
// reasoning that "a small job cannot meaningfully fill anything". **That is false, and he
// proved it within the hour:** exporting a small file selection to a nearly-full card produced
// *"The destination ran out of room partway through, so some files were not written"* - the
// post-hoc failure that [B-203] exists to prevent, on a job the floor had waved through.
//
// ⭐ WHETHER A WRITE FITS DEPENDS ON THE FREE SPACE, NOT ON THE SIZE OF THE WRITE. A 1 MB copy
// fails on a card with 500 KB free. The floor reasoned about only one side of the comparison.
//
// ⭐⭐ AND THE THING IT WAS OPTIMISING WAS ALREADY FREE. The fit check is one `statfs` -
// measured 0.2-0.7 ms on every transport tried. The expensive question is the device
// CLASSIFICATION at ~1,900 ms, and that is gated separately by the caller's `classify` flag.
// Conflating the two produced a threshold that bought nothing and disabled a real check.
//
// So: the fit check runs whenever there is a size to check, and the exemptions that floor was
// meant to provide are unnecessary - the small doors (style export, the two doc exports) do
// not call preflight at all.
const FIT_CHECK_MIN_BYTES = 0;

// ⚠️⚠️ BACKUP IS NOT EXEMPT, AND THE REASONING THAT EXCLUDED IT WAS OVERTURNED ELSEWHERE.
// It was left out because a zip writes COMPRESSED bytes, so an uncompressed total is only an
// upper bound and refusing on it could block an archive that would have fitted. That argument
// was then overruled for every other zip door on 2026-09-19, watching one fail mid-write:
// "we have a message for this already. it shouldn't have tried to go there." The asymmetry is
// the whole case - a rare false refusal costs a retry; attempting a write we can predict will
// fail costs a part-written archive on a card. ⭐ And it lands hardest on backup, because a
// truncated backup is the artefact someone reaches for on the day everything else went wrong.
async function preflight(destDir, {
  fileSizes = null, totalBytes = 0, fileCount = 0, dirCount = 0, classify = false,
} = {}) {
  const out = {
    ok: false, destDir: destDir || null,
    tooBig: null,        // { needBytes, bytesFree, shortfallBytes } when it will not fit
    slowWrite: null,     // { bytes, files } when big AND on a board card
    boardCard: false,    // carry this: cancel-cleanup reads it, never re-measures
    removable: null,     // null = cannot tell. Drives the eject offer, any removable media.
    driveKind: null,     // 'removable' | 'fixed' | 'network' | 'cdrom' | 'ramdisk' | null
    transport: null, boardSerial: null,
    bytesFree: null, blockSize: null,
    skippedFitCheck: false,
  };
  if (!destDir) return out;

  const bytes = Array.isArray(fileSizes)
    ? fileSizes.reduce((s, n) => s + (Number(n) || 0), 0)
    : (Number(totalBytes) || 0);
  const files = Array.isArray(fileSizes) ? fileSizes.length : (Number(fileCount) || 0);

  // ⭐⭐ THE THRESHOLD DECIDES THE LOOKUP, NOT THE CALLER. [B-005 item 4, 2026-09-21]
  //
  // ⚠️ THE CALLER COULD NOT GET THIS RIGHT, AND ONE OF THEM PROVED IT: the renderer's early
  // fit check carried the comment "NO DEVICE LOOKUP HERE. `classify` stays off: the ~1,900 ms
  // question is about warning, not fitting" - and it was false. It passed no flag, the
  // renderer computed `wantsDevice` from the job size behind its back, and a 1,000 MB early
  // check therefore paid the full association walk for an answer it discarded. A comment
  // asserting a behaviour the code does not implement is worse than no comment.
  //
  // ⭐ The board-card answer alters exactly two things and both are threshold-gated, so the
  // threshold IS the decision. Asking here means no door can forget it and no door can pay
  // for it by accident. `classify: true` still forces it, for a caller that genuinely needs
  // the transport regardless of size.
  const wantBoard = classify === true || isSlowWriteJob(files, bytes);

  const d = await describe(destDir, { classify: wantBoard });
  out.ok = !!d.ok;
  out.bytesFree = d.bytesFree;
  out.blockSize = d.blockSize;
  out.transport = d.transport;
  out.boardSerial = d.boardSerial;
  out.removable = d.removable;
  out.driveKind = d.driveKind;
  // ⚠️ FALSE HERE MEANS "not a board card OR we did not ask". Below the threshold nothing
  // reads it - the warning and the cleanup offer are both gated on the same size - so the
  // conflation is safe, and `transport: null` is what distinguishes the two for anyone
  // inspecting the result.
  out.boardCard = isSlowTransport(d.transport);

  // ── 1. Will it fit ──
  //
  // ⚠️ `fits` IS TRUE WHEN WE CANNOT MEASURE - an unmeasurable destination must not block a
  // write the user asked for. Unchanged from checkFit; restated because this is now the only
  // place a door sees it.
  // ⚠️ `bytes === 0` means WE COULD NOT SIZE IT, not "it is empty" - source content inside an
  // archive is the case. An unknown size must never produce a refusal, so it is the only
  // thing that skips the check. See the note on FIT_CHECK_MIN_BYTES for why there is no
  // lower bound beyond that.
  if (bytes <= FIT_CHECK_MIN_BYTES) {
    out.skippedFitCheck = true;
  } else if (d.ok) {
    const need = Array.isArray(fileSizes)
      ? onDiskCost(fileSizes, d.blockSize, dirCount)
      : Math.ceil(bytes / d.blockSize) * d.blockSize;
    if (need > d.bytesFree) {
      out.tooBig = { needBytes: need, bytesFree: d.bytesFree, shortfallBytes: need - d.bytesFree };
      // ⚠️ RETURN WITH THE REFUSAL AND NOTHING ELSE DECIDED. A door that cannot write has no
      // use for a slow-write warning, and stacking two dialogs on one refusal is the
      // "two stacked dialogs" shape he has already caught once.
      return out;
    }
  }

  // ── 2. Is it slow enough to be worth warning about ──
  //
  // ⚠️ THRESHOLD FIRST, LOOKUP SECOND. A job under the limits needs no device lookup at all,
  // and the lookup is the slowest thing in any pre-flight.
  if (isSlowWriteJob(files, bytes) && out.boardCard) {
    out.slowWrite = { bytes, files };
  }
  return out;
}

module.exports = {
  describe, checkFit, onDiskCost, classifyTransport, preflight, driveKind,
  SLOW_WRITE_MIN_FILES, SLOW_WRITE_MIN_BYTES, FIT_CHECK_MIN_BYTES,
  isSlowWriteJob, isSlowTransport,
};
