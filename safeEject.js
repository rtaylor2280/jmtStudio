// ── Safely ejecting removable media ──────────────────────────── [B-005 item 4, 2026-09-20]
//
// The requirement: an export to removable media should be able to end with the card safely
// released, rather than the user guessing when it is finished writing.
//
// THE VERIFICATION IS ALREADY CROSS-PLATFORM; ONLY THE INVOKE IS NOT. That is the whole
// shape of this module and the reason extending it is cheap. Everything expensive that was
// learned on 2026-09-20 - verify by observation rather than by the eject command's return
// value, debounce a second, and watch the FILESYSTEM rather than the volume table - is
// platform-neutral. `/Volumes/NAME` disappearing on a Mac is the identical signal to `E:\`
// going absent on Windows. So each platform supplies two things and inherits the rest.
//
// MEASURED ON THE BENCH, WINDOWS, 2026-09-20 - the rules below are not reasoned:
//
//     E:  proffieboard (Tlera DOSFS)   gone at 20.18s, never returned   letter LINGERS
//     I:  card-reader (USB, 2 slots)   gone 31.67 -> BACK 31.93 -> gone letter LINGERS
//     F:  card-slot (laptop side port) gone at 67.50s, clean            letter VANISHES
//
// TWO OS BEHAVIOURS, ONE CHECK. With the reader still attached, Windows keeps the drive
// letter listed as an empty removable drive (`Size=<null>`) - a reader with no card in it.
// Only the built-in slot makes it vanish. **`fs.existsSync` is false for all three**, which is
// why the mount path is what gets watched and not the volume table: enumeration still reports
// E:, H: and I: as present after a successful eject, and would have told the user not to unplug a
// card that was already safe. Device status is worse - after E: ejected, the Tlera disk, the
// mass-storage interface and COM6 all still reported OK. Same trap as 2026-09-15.
//
// THE BOARD SURVIVES AN EJECT COMPLETELY - COM6 stays alive and the board stays flashable.
//
// HOST-SIDE ONLY, THE RULING. ProffieOS has `sd 1` / `sd 0` to hand the card between the
// saber and the computer, and this module sends neither: "it's no different really than
// physically pulling and then putting back in. just a manual command to do it on purpose.
// shouldn't change anything for eject." If a remount is ever built, read
// `local/sd-access-test.js` first - it validated that protocol and carries the ordering rule.
//
// ── PORTING STATUS ──────────────────────────────────────────────────────────────────────
//
// WINDOWS IS MEASURED. macOS AND LINUX ARE WIREFRAMED AND UNVALIDATED. Every non-Windows
// branch below is written to the best available knowledge and marked `UNVERIFIED` where a
// specific claim needs a real box to settle. **Do not report those platforms as working on the
// strength of this file.** The 09-20 lesson is the reason for that caution: every single rule
// on the Windows side that I would have guessed, I would have guessed wrong.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ── What each platform supplies ──────────────────────────────────────
//
// `mountPathOf`  turn a destination directory into the path to WATCH
// `invoke`       ask the OS to release it (fire-and-forget; never trusted)
// `vocab`        the user-facing words, because the DIFFERENCE IS NOT ONLY WORDING
//
// `vocab.lingersAfterEject` IS A BEHAVIOUR FLAG, NOT A STRING. On Windows the drive letter
// stays listed as an empty drive and the success message MUST say so - without it the app
// contradicts what the user can see, which is exactly how the user read a successful eject as a
// failure ("didn't work. I see it's still connected... (E)"). On macOS and Linux the mount
// point goes away, so that sentence would be a lie rather than a reassurance. **A per-OS
// string table would have shipped the Windows explanation everywhere.**

const _exec = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim(),
              missing: !!(err && err.code === 'ENOENT') });
  });
});

const PLATFORMS = {
  // ── Windows: measured 2026-09-20 ──
  win32: {
    osName: 'Windows',
    // The ROOT of the drive, not the export folder. `E:\fonts\Ahsoka` still exists as a
    // path string after an eject; `E:\` is what stops existing when the media goes.
    //
    // THE WHOLE `X:` PREFIX MUST BE PRESENT - TAKING THE FIRST CHARACTER IS DANGEROUS.
    // The first cut did `slice(0,1).toUpperCase()` and accepted anything, so the string
    // "not-a-path" resolved to `N:\` - a real drive on some machines, and one with nothing to
    // do with the export. An eject aimed by a typo at an unrelated volume is the worst thing
    // this module could do. Require the colon, and require a separator or end after it.
    mountPathOf: (destDir) => {
      const m = String(destDir || '').match(/^([A-Za-z]):(?:[\\/]|$)/);
      return m ? `${m[1].toUpperCase()}:\\` : null;
    },
    label: (mountPath) => String(mountPath || '').slice(0, 2),   // "E:"
    // PER-VOLUME, NOT PER-DEVICE. The USB reader has two slots on ONE device holding H: and
    // I:, so a device-level eject would dismount a sibling card it is still using.
    // No admin required, which is why this and not `mountvol /p`.
    //
    // IN-PROCESS, NO CHILD PROCESS. [B-681] winDisks.eject runs the documented removable-media
    // sequence on the volume through the Win32 API: FSCTL_LOCK_VOLUME (retried), then
    // FSCTL_DISMOUNT_VOLUME, IOCTL_STORAGE_MEDIA_REMOVAL (allow) and IOCTL_STORAGE_EJECT_MEDIA.
    // Launching PowerShell from a %TEMP% script with -ExecutionPolicy Bypass is the pattern
    // behaviour-based antivirus kills the app for (QA BUG-012), so nothing is launched.
    //
    // `raw` IS EVIDENCE, NOT DECORATION, and each branch names itself:
    //     "ejected"      every step succeeded; the media watch still has the verdict
    //     "no-verb"      the volume is not a kind that ejects - a real answer, not a timeout
    //     "no-item"      there is no such volume
    //     "busy: ..."    the lock was refused, carrying `busy: true`: something has it open
    //     "error: ..."   another step failed, with the step and the Windows error code
    //     "pending"      the sequence did not answer in time; the media watch decides
    // A refused lock is the API's own statement that a handle is open, so `busy` no longer has to
    // be inferred from a watch that ran out.
    invoke: async (mountPath) => {
      const L = String(mountPath || '').slice(0, 1).toUpperCase();
      if (!/^[A-Z]$/.test(L)) return { ok: false, raw: 'bad-mount-path' };
      return require('./winDisks').eject(L);
    },
    vocab: {
      // MEASURED: the letter stays behind as an empty drive on board cards and USB readers.
      lingersAfterEject: true,
      volumeNoun: 'drive',
      busyNote: (label) =>
        `Something still has ${label} open, so Windows would not release it.\n\n`
        + `Close anything using it, then try again. Unplugging it now risks damaging what is on it.`,
    },
  },

  // ── macOS: WIREFRAMED, UNVALIDATED ──
  darwin: {
    osName: 'macOS',
    // UNVERIFIED: derived by walking up to the /Volumes child. A card at
    // `/Volumes/MYCARD/fonts/Ahsoka` has the mount point `/Volumes/MYCARD`. This holds for the
    // normal case; a nested or non-/Volumes mount is NOT handled and should be checked against
    // `diskutil info -plist <path>` before this is trusted.
    mountPathOf: (destDir) => {
      const p = String(destDir || '');
      const m = p.match(/^(\/Volumes\/[^/]+)/);
      return m ? m[1] : null;
    },
    label: (mountPath) => path.basename(String(mountPath || '')),
    // `diskutil eject` needs no sudo. Measured 2026-11-07 on macOS 26 with a card in a USB
    // reader: exit 0 and the /Volumes entry and the disk both disappear; with a process holding
    // the volume, exit 1, the card stays mounted, and the output names the holder
    // ("Unmount was dissented by PID 44405 (/bin/sleep)").
    // UNVERIFIED: whether a Proffieboard-backed volume needs `diskutil unmountDisk` instead.
    // The return value is NOT the verdict either way - same rule as Windows.
    invoke: async (mountPath) => {
      const r = await _exec('diskutil', ['eject', String(mountPath || '')]);
      return { ok: r.ok, raw: r.out || r.err };
    },
    vocab: {
      // Measured 2026-11-07: macOS removes the /Volumes entry on eject, so there is no
      // lingering empty slot and the Windows explanation must NOT appear here.
      lingersAfterEject: false,
      volumeNoun: 'volume',
      busyNote: (label) =>
        `Something is still using ${label}, so macOS would not eject it.\n\n`
        + `Close anything using it, then try again. Unplugging it now risks damaging what is on it.`,
    },
  },

  // ── Linux ──
  linux: {
    osName: 'Linux',
    // The mount point comes from the kernel's own table (/proc/mounts), not from the path's
    // shape: udisks mounts under /media/<user>/<label> or /run/media/<user>/<label> depending on
    // the distribution, and a hand-mounted card can be anywhere. Only a mount backed by a block
    // device (/dev/...) is something to eject; a folder on the system disk is not.
    mountPathOf: (destDir) => {
      const m = require('./linuxDisks').procMountOf(String(destDir || ''));
      if (!m || !/^\/dev\//.test(m.source) || m.root === '/') return null;
      return m.root;
    },
    label: (mountPath) => path.basename(String(mountPath || '')),
    // `udisksctl unmount -b <device>` needs no sudo from the desktop session, and it takes the
    // DEVICE, never the mount path (passing the path was the old bug). Unmount only, deliberately
    // no power-off: power-off asks the USB port to drop the whole device, which on a Proffieboard
    // is the board's serial port as well, and Studio still needs that to send `sd 1`. Unmount is
    // what makes the card safe to pull; the kernel flushes before it lets go.
    // Measured 2026-11-08 over SSH on Ubuntu 26.04: unmount works as the user.
    // `gio mount -u` is the fallback for a desktop without udisksctl on the PATH.
    invoke: async (mountPath) => {
      const m = require('./linuxDisks').procMountOf(String(mountPath || ''));
      const dev = m && /^\/dev\//.test(m.source) ? m.source : null;
      let r = dev ? await _exec('udisksctl', ['unmount', '-b', dev]) : { ok: false, out: '', err: 'no device for ' + mountPath };
      if (!r.ok && r.missing) r = await _exec('gio', ['mount', '-u', String(mountPath || '')]);
      return { ok: r.ok, raw: r.out || r.err };
    },
    vocab: {
      // udisks removes the /media/<user>/<label> folder on unmount, so nothing lingers.
      lingersAfterEject: false,
      volumeNoun: 'volume',
      busyNote: (label) =>
        `Something is still using ${label}, so it could not be unmounted.\n\n`
        + `Close anything reading from the card and try again. Unplugging it now risks `
        + `damaging what is on it.`,
    },
  },
};

const plat = () => PLATFORMS[process.platform] || null;

// The renderer asks for this ONCE and composes its own messages, so no user-facing string in
// this app has to branch on an OS name. That is what stops a Mac build saying "Windows".
function vocabulary() {
  const p = plat();
  if (!p) return { supported: false, osName: process.platform, volumeNoun: 'volume',
                   lingersAfterEject: false };
  return { supported: true, osName: p.osName, volumeNoun: p.vocab.volumeNoun,
           lingersAfterEject: p.vocab.lingersAfterEject };
}

// FREE, SO IT CAN BE POLLED. Unlike the device classification, this is a stat - it can run
// four times a second without anyone noticing. Identical on every platform, which is the whole
// reason the port is cheap.
function mediaPresent(mountPath) {
  const p = String(mountPath || '');
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
}

// DEBOUNCED, BECAUSE ONE SAMPLE LIED. The I: volume went gone -> back -> gone across three
// consecutive 250 ms polls. Whether the reader briefly re-presented or the poll caught an
// intermediate teardown state does not matter: on a single sample, suspect the instrument.
// Built from reasoning alone this would have been a single poll and a flaky message.
const POLL_MS = 250;
const STABLE_MS = 1000;

// 60s, AND 15s WAS BELOW A NUMBER WE HAD ALREADY MEASURED. [2026-09-21]
//
// The 09-20 bench run recorded the proffieboard volume dismounting at **20.18 s** - and the
// ceiling was then set to 15 s. So the one transport this feature exists for was guaranteed to
// time out, report `busy`, and tell the user to close files that were not open. It hit three
// times in a row on E: ("still got in use... it really doesn't want to work"), and the card was
// already gone by the time we looked. Earlier the same evening the F: went away roughly ninety
// seconds after the app had given up on it.
//
// THE MEASUREMENT WAS IN OUR OWN FILE BEFORE THE CEILING WAS CHOSEN. Nothing new had to be
// learned to get this right; the number was written down in local/export-doors.md and the ceiling
// was picked without consulting it.
//
// WAITING LONGER IS THE CHEAP MISTAKE; A FALSE `busy` IS THE EXPENSIVE ONE. The poll is an
// `existsSync` - free - and the surface shows an animated "Ejecting" the whole time, so the cost
// of a generous ceiling is a longer honest wait. The cost of a short one is telling someone their
// card is in use when it is not, which is advice that cannot be acted on.
const DEFAULT_EJECT_TIMEOUT_MS = 60000;

// `everGone` IS THE WHOLE POINT, AND IT WAS THE ONE THING NOT RECORDED. [2026-10-06]
// This function watched for a STABLE absence and threw away the fact that it had seen the media
// leave at all - so the caller, which has to choose between "never left" and "left and came
// back", had no way to tell them apart and guessed from whether the card was present at that
// instant. A card that releases and is re-mounted is present, so it was always "never left".
async function waitForMediaGone(mountPath, timeoutMs = DEFAULT_EJECT_TIMEOUT_MS, stableMs = STABLE_MS) {
  const t0 = Date.now();
  let goneSince = null;
  let everGone = false;
  for (;;) {
    if (!mediaPresent(mountPath)) {
      everGone = true;    // latched: a bounce is still a release
      if (goneSince === null) goneSince = Date.now();
      if (Date.now() - goneSince >= stableMs) {
        return { gone: true, ms: Date.now() - t0, everGone: true };
      }
    } else {
      goneSince = null;   // came back (or never left) - reset rather than concluding
    }
    if (Date.now() - t0 > timeoutMs) {
      return { gone: false, ms: Date.now() - t0, stillPresent: mediaPresent(mountPath), everGone };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// Turn an export destination into the thing to watch and the thing to call it.
function resolveTarget(destDir) {
  const p = plat();
  if (!p) return null;
  const mountPath = p.mountPathOf(destDir);
  if (!mountPath) return null;
  return { mountPath, label: p.label(mountPath) };
}

// Eject one volume and report what ACTUALLY happened.
//
// Three honest outcomes - never a success dressed up:
//   { status: 'ejected'  }  media gone and stayed gone
//   { status: 'returned' }  media came back; say so rather than claiming success
//   { status: 'busy'     }  media never went - something still has it open
//
// 'busy' IS THE CASE THE FEATURE EXISTS FOR. It is the one where pulling the card WOULD have
// been unsafe, and it is precisely what a reassuring "safe to remove" message hides.
// `stableMs` shortens the stay-gone watch for a card that cannot come back on its own: a card
// behind a Proffieboard, which only reaches the computer again on `sd 1` or a boot. The watch is
// there for readers that re-mount; there it only delays the board's restart, and in use,
// following Windows' notice, the board is unplugged before the reset is ever sent.
async function ejectVolume(destDirOrMount, { timeoutMs = DEFAULT_EJECT_TIMEOUT_MS, stableMs = STABLE_MS } = {}) {
  const p = plat();
  if (!p) return { status: 'unsupported', reason: `no platform support: ${process.platform}` };

  // Accept either a destination directory or an already-resolved mount path.
  const t = resolveTarget(destDirOrMount)
         || (mediaPresent(destDirOrMount) ? { mountPath: String(destDirOrMount),
                                              label: p.label(destDirOrMount) } : null);
  if (!t) return { status: 'busy', reason: 'could-not-resolve-mount-path' };

  if (!mediaPresent(t.mountPath)) {
    // Already gone - ejected earlier, or pulled. Not an error, and not something to
    // congratulate ourselves for either.
    return { status: 'ejected', ...t, alreadyGone: true, ms: 0 };
  }

  const t0 = Date.now();
  const inv = await p.invoke(t.mountPath);

  // ANSWERED BY THE CALL, SO NOT WAITED FOR. [B-681] A refused lock means something has the
  // volume open: that is `busy`, the same result the watch reports when the media never leaves,
  // returned at once instead of after the full timeout. A failed step that is not the lock cannot
  // release the card either, so it is `unsupported` at once; the watch would only reopen the
  // dismounted volume and run out the clock. Only a platform that reports `busy` takes the first
  // branch. The second is Windows only, where `ok: false` is a definite answer from the API; the
  // macOS and Linux tools keep the watch below.
  if (inv && inv.busy) {
    return { status: 'busy', ...t, ms: Date.now() - t0, raw: inv.raw, everGone: false };
  }
  if (inv && !inv.ok && p === PLATFORMS.win32) {
    return { status: 'unsupported', ...t, ms: Date.now() - t0, raw: inv.raw,
             reason: 'the eject failed' };
  }

  // THE WATCH HAS THE VERDICT ON SUCCESS. A call that reports success has asked the device to
  // let go; it has not shown the media left. Everything this module promises - the three honest
  // outcomes, never a success dressed up - rests on watching the media leave.
  //
  // The watch starts only after invoke resolves, so its 250 ms opens of the volume ROOT cannot
  // hold a handle against the lock the eject takes.
  const res = await waitForMediaGone(t.mountPath, timeoutMs, stableMs);
  if (res.gone) return { status: 'ejected', ...t, ms: res.ms, raw: inv.raw };

  // "WE COULD NOT ASK" IS NOT "SOMETHING HAS IT OPEN". When the volume offered no Eject verb
  // and the media is still there, `busy` would tell the user to close their files - advice that
  // cannot possibly help, because nothing was ever asked to release the card. `unsupported` is
  // the honest branch and the renderer already draws it.
  if (inv && (inv.raw === 'no-verb' || inv.raw === 'no-item')) {
    return { status: 'unsupported', ...t, ms: res.ms, raw: inv.raw,
             reason: 'volume offers no Eject verb' };
  }
  if (inv && !inv.ok) {
    return { status: 'unsupported', ...t, ms: res.ms, raw: inv.raw,
             reason: 'could not launch the eject' };
  }
  // Distinguish "never left" from "left and came back" - they mean different things to the
  // person holding the card, so they must not collapse into one message.
  //
  // THIS USED TO ASK `mediaPresent(...)`, WHICH IS THE WRONG QUESTION AND MADE THE COMMENT
  // ABOVE A LIE. [2026-10-06] "Is it here NOW" cannot separate the two cases, because a card that
  // released and was re-mounted is here now - exactly like one that never moved. So every bounce
  // was reported as `busy`, and `returned` was very nearly unreachable: it needed the media to be
  // absent at that instant while never having been stably absent for a whole second.
  //
  // MEASURED, NOT ARGUED (2026-10-06). An export to a card with eject ticked reported
  // "Something is still using L:, so it could not be released." An independent eject of the same
  // volume at the same moment reported that it ejected and the reader re-mounted it straight
  // away. Nothing had it open.
  // AND THAT IS THE WORST DIRECTION FOR THIS PARTICULAR LIE: `busy` is advice - close your
  // files and try again - and it cannot be acted on when there is nothing to close.
  // The re-mount is NOT a quirk of one dock; any disk can do it. Ordinary behaviour the
  // classifier has to handle, not hardware to be chased.
  return { status: res.everGone ? 'returned' : 'busy', ...t,
           ms: res.ms, raw: inv.raw, everGone: !!res.everGone };
}

// The OS-specific sentences, resolved here so no renderer string names an operating system.
function noteFor(kind, label) {
  const p = plat();
  if (!p) return null;
  const fn = p.vocab[kind];
  return typeof fn === 'function' ? fn(label) : null;
}

module.exports = {
  ejectVolume, waitForMediaGone, mediaPresent, resolveTarget, vocabulary, noteFor,
  POLL_MS, STABLE_MS,
  _PLATFORMS: PLATFORMS,   // tests assert every platform supplies the same shape
};
