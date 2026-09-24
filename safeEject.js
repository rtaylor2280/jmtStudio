// ── Safely ejecting removable media ──────────────────────────── [B-005 item 4, 2026-09-20]
//
// His requirement: an export to removable media should be able to end with the card safely
// released, rather than the user guessing when it is finished writing.
//
// ⭐⭐ THE VERIFICATION IS ALREADY CROSS-PLATFORM; ONLY THE INVOKE IS NOT. That is the whole
// shape of this module and the reason extending it is cheap. Everything expensive that was
// learned on 2026-09-20 - verify by observation rather than by the eject command's return
// value, debounce a second, and watch the FILESYSTEM rather than the volume table - is
// platform-neutral. `/Volumes/NAME` disappearing on a Mac is the identical signal to `E:\`
// going absent on Windows. So each platform supplies two things and inherits the rest.
//
// ⭐ MEASURED ON HIS BENCH, WINDOWS, 2026-09-20 - the rules below are not reasoned:
//
//     E:  proffieboard (Tlera DOSFS)   gone at 20.18s, never returned   letter LINGERS
//     I:  card-reader (USB, 2 slots)   gone 31.67 -> BACK 31.93 -> gone letter LINGERS
//     F:  card-slot (laptop side port) gone at 67.50s, clean            letter VANISHES
//
// ⚠️⚠️ TWO OS BEHAVIOURS, ONE CHECK. With the reader still attached, Windows keeps the drive
// letter listed as an empty removable drive (`Size=<null>`) - a reader with no card in it.
// Only the built-in slot makes it vanish. **`fs.existsSync` is false for all three**, which is
// why the mount path is what gets watched and not the volume table: enumeration still reports
// E:, H: and I: as present after a successful eject, and would have told him not to unplug a
// card that was already safe. Device status is worse - after E: ejected, the Tlera disk, the
// mass-storage interface and COM6 all still reported OK. Same trap as 2026-09-15.
//
// ⭐ THE BOARD SURVIVES AN EJECT COMPLETELY - COM6 stays alive and the board stays flashable.
//
// ⚠️ HOST-SIDE ONLY, HIS RULING. ProffieOS has `sd 1` / `sd 0` to hand the card between the
// saber and the computer, and this module sends neither: "it's no different really than
// physically pulling and then putting back in. just a manual command to do it on purpose.
// shouldn't change anything for eject." If a remount is ever built, read
// `local/sd-access-test.js` first - it validated that protocol and carries the ordering rule.
//
// ── PORTING STATUS ──────────────────────────────────────────────────────────────────────
//
// ⚠️⚠️ WINDOWS IS MEASURED. macOS AND LINUX ARE WIREFRAMED AND UNVALIDATED. Every non-Windows
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
// ⭐⭐ `vocab.lingersAfterEject` IS A BEHAVIOUR FLAG, NOT A STRING. On Windows the drive letter
// stays listed as an empty drive and the success message MUST say so - without it the app
// contradicts what the user can see, which is exactly how he read a successful eject as a
// failure ("didn't work. I see it's still connected... (E)"). On macOS and Linux the mount
// point goes away, so that sentence would be a lie rather than a reassurance. **A per-OS
// string table would have shipped the Windows explanation everywhere.**

const _exec = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() });
  });
});

const PLATFORMS = {
  // ── Windows: measured 2026-09-20 ──
  win32: {
    osName: 'Windows',
    // ⚠️ The ROOT of the drive, not the export folder. `E:\fonts\Ahsoka` still exists as a
    // path string after an eject; `E:\` is what stops existing when the media goes.
    //
    // ⚠️⚠️ THE WHOLE `X:` PREFIX MUST BE PRESENT - TAKING THE FIRST CHARACTER IS DANGEROUS.
    // The first cut did `slice(0,1).toUpperCase()` and accepted anything, so the string
    // "not-a-path" resolved to `N:\` - a real drive on some machines, and one with nothing to
    // do with the export. An eject aimed by a typo at an unrelated volume is the worst thing
    // this module could do. Require the colon, and require a separator or end after it.
    mountPathOf: (destDir) => {
      const m = String(destDir || '').match(/^([A-Za-z]):(?:[\\/]|$)/);
      return m ? `${m[1].toUpperCase()}:\\` : null;
    },
    label: (mountPath) => String(mountPath || '').slice(0, 2),   // "E:"
    // ⚠️ PER-VOLUME, NOT PER-DEVICE. His USB reader has two slots on ONE device holding H: and
    // I:, so a device-level eject would dismount a sibling card he is still using.
    // ⚠️ No admin required, which is why this and not `mountvol /p`.
    // ⚠️⚠️ FIND THE VERB, DO NOT NAME IT. This called `InvokeVerb("Eject")`, which is a match
    // against the verb's DISPLAY name - and the display name on this machine is `E&ject`, with
    // the menu accelerator in it. `InvokeVerb` returns nothing whether it matched or missed, so
    // a miss is indistinguishable from a success that the media ignored.
    //
    // ⭐ AND THE DISPLAY NAME IS LOCALISED. On a German Windows the verb is `Aus&werfen`; on a
    // French one `&Éjecter`. The literal string "Eject" cannot match either, so every eject on a
    // non-English Windows would have silently done nothing while the app waited 15 seconds and
    // then told the user their card was in use. Nobody would have reported it as a bug - it
    // looks exactly like a busy volume. Measured 2026-09-21 by enumerating `Verbs()`.
    //
    // ⚠️ SO STRIP THE `&` AND COMPARE, and report WHICH branch happened, because `raw` is the
    // only evidence the caller gets about whether the verb ever fired:
    //     "ejected"      the verb was found and called
    //     "no-verb"      the volume offers no Eject - a real answer, not a timeout
    //     "no-item"      the shell has no such volume
    // ⚠️ `raw` IS NOT COSMETIC. It always said "invoked", which is what made the app's "in use"
    // report unreadable: it could not say whether the verb was refused or the wait ran out.
    // ⭐⭐ THE LAUNCHER IS THE FIX, NOT THE API. [2026-09-22]
    //
    // The same shell verb worked from a standalone PowerShell and did nothing useful from a
    // PowerShell that Electron spawned: the card ejected either way, but Windows' own
    // "Safe To Remove Hardware" notification only ever appeared from the standalone one.
    // Launching through `cmd /c start` - so the shell starts it and this process is not its
    // parent - makes the notification appear from inside the app.
    //
    // ⚠️⚠️ THE MECHANISM IS NOT KNOWN AND THIS COMMENT WILL NOT PRETEND OTHERWISE. Five
    // candidates were killed BY MEASUREMENT, not by argument: `-NonInteractive` (the standalone
    // host passes it too), the console window (`GetConsoleWindow()` returned 0 on both),
    // ApartmentState (STA on both), session id (1 on both), and job-object limits - both hosts
    // reported `LimitFlags 0x3C00` including SILENT_BREAKAWAY_OK. Every field available was
    // identical; only the parent process differed. So the fix was tested rather than reasoned,
    // and anyone extending this should treat "why" as open.
    //
    // ⚠️ THE SCRIPT GOES TO A FILE, NOT THROUGH `start`'s ARGUMENT PARSER. Quoting a multi-line
    // PowerShell script through cmd.exe, then `start`, then powershell is three levels of
    // escaping whose failure mode is silently running something else.
    //
    // ⚠️⚠️ AND THE COST IS REAL: `start` RETURNS AS SOON AS IT LAUNCHES, SO THERE IS NO STDOUT.
    // `raw` can no longer say whether the verb fired, was refused, or found no volume - the
    // three honest outcomes this module exists to report. It now says `launched` and nothing
    // more. **The verdict therefore rests ENTIRELY on `waitForMediaGone` observing the media
    // leave.** That is a narrower promise than this file used to make and it is not yet his
    // ruling; see the two-witnesses question in the notes.
    //
    // ⭐⭐ ASK READABLY, ACT DETACHED — AND THAT SPLIT IS WHY THE HONEST OUTCOMES SURVIVED.
    //
    // The detached launcher is what makes Windows draw its own notification, and the price is
    // that `start` returns immediately and hands back no stdout. Moving the whole operation
    // behind it therefore destroyed the one thing this module promises: `raw` could only ever
    // say 'launched', so a volume offering NO Eject verb became indistinguishable from one that
    // refused to leave, and both would have told the user to close files that were never open.
    // That is the localisation defect from 2026-09-21 coming straight back, and the suite
    // caught it - `test/safe-eject.test.js`, "no-verb is NOT reported as busy".
    //
    // ⭐ The resolution is that only the ACTION needs the detached host. The QUESTION - does
    // this volume even offer an Eject verb - is a plain read, so it runs in a normal child we
    // can hear back from. Two spawns instead of one, and the verdict keeps its detail.
    invoke: async (mountPath) => {
      const L = String(mountPath || '').slice(0, 1).toUpperCase();
      if (!/^[A-Z]$/.test(L)) return { ok: false, raw: 'bad-mount-path' };
      const letter = L;

      // ── The question, asked where we can read the answer ──
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
      const q = await _exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query]);
      // ⚠️ Both are real answers, not timeouts, and both must reach the caller unchanged - they
      // are the difference between "nothing was ever asked to release this" and "it refused".
      if (q.out === 'no-item' || q.out === 'no-verb') return { ok: true, raw: q.out };
      if (q.out && q.out.startsWith('error:')) return { ok: false, raw: q.out };

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
        await _exec('cmd.exe', ['/c', 'start', '', '/min', 'powershell.exe',
                                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp]);
        return { ok: true, raw: 'launched' };
      } catch (err) {
        return { ok: false, raw: 'launch-failed: ' + String(err && err.message || err) };
      }
    },
    vocab: {
      // MEASURED: the letter stays behind as an empty drive on board cards and USB readers.
      lingersAfterEject: true,
      volumeNoun: 'drive',
      // What is still visible afterwards, and why it is not a failure.
      // ⚠️ STATES THE FACT, DOES NOT HEDGE IT. [2026-09-24] This read "Windows may keep showing
      // <label> until you reconnect it" - and "may" is uncertainty about OUR OWN result, in the
      // one message whose whole job is to stop a successful eject reading as a failure.
      // ⭐ RE-MEASURED before rewording, an hour after a real eject: the letter was still listed
      // with `(no media)`. So it is not "may" and it is not gone - it is an EMPTY DRIVE, which is
      // also the detail that tells him what he is looking at rather than just that it is fine.
      // ⚠️ NO LABEL IN HERE. Its one consumer is the post-eject toast, which already opens with
      // the label ("I: ejected. Safe to remove."), so naming it again produced "I: ... I: stays
      // listed". The note is the SECOND half of a sentence about a thing already named.
      lingerNote: () =>
        'It stays listed as an empty drive until you reconnect it.',
      busyNote: (label) =>
        `Something still has ${label} open, so Windows would not release it.\n\n`
        + `Close anything using it, then try again. Unplugging it now risks damaging what is on it.`,
    },
  },

  // ── macOS: WIREFRAMED, UNVALIDATED ──
  darwin: {
    osName: 'macOS',
    // ⚠️ UNVERIFIED: derived by walking up to the /Volumes child. A card at
    // `/Volumes/MYCARD/fonts/Ahsoka` has the mount point `/Volumes/MYCARD`. This holds for the
    // normal case; a nested or non-/Volumes mount is NOT handled and should be checked against
    // `diskutil info -plist <path>` before this is trusted.
    mountPathOf: (destDir) => {
      const p = String(destDir || '');
      const m = p.match(/^(\/Volumes\/[^/]+)/);
      return m ? m[1] : null;
    },
    label: (mountPath) => path.basename(String(mountPath || '')),
    // ⚠️ UNVERIFIED: `diskutil eject` is the documented, non-sudo path and is what Finder's
    // eject uses underneath. Open to two unknowns on a real box: whether it returns non-zero
    // when something holds the volume (it should), and whether a Proffieboard-backed volume
    // needs `diskutil unmountDisk` instead because it presents as a whole disk.
    // ⚠️ The return value is NOT the verdict either way - same rule as Windows.
    invoke: async (mountPath) => {
      const r = await _exec('diskutil', ['eject', String(mountPath || '')]);
      return { ok: r.ok, raw: r.out || r.err };
    },
    vocab: {
      // ⚠️ UNVERIFIED but expected: macOS removes the /Volumes entry on eject, so there is no
      // lingering empty slot and the Windows explanation must NOT appear here.
      lingersAfterEject: false,
      volumeNoun: 'volume',
      lingerNote: null,
      busyNote: (label) =>
        `Something is still using ${label}, so macOS would not eject it.\n\n`
        + `Close anything using it, then try again. Unplugging it now risks damaging what is on it.`,
    },
  },

  // ── Linux: WIREFRAMED, UNVALIDATED ──
  linux: {
    osName: 'Linux',
    // ⚠️ UNVERIFIED: removable media typically mounts under /media/<user>/<label> or
    // /run/media/<user>/<label> depending on the distribution's udisks configuration. This
    // matches both shapes and should be checked against `findmnt -no TARGET --target <path>`,
    // which is the correct general answer and needs util-linux present.
    mountPathOf: (destDir) => {
      const p = String(destDir || '');
      const m = p.match(/^((?:\/run)?\/media\/[^/]+\/[^/]+)/);
      return m ? m[1] : null;
    },
    label: (mountPath) => path.basename(String(mountPath || '')),
    // ⚠️ UNVERIFIED: `udisksctl unmount` is the non-root path on any udisks2 desktop, which
    // covers the distributions this app is likely to meet. `eject` is the older fallback and
    // behaves differently (it targets the DEVICE, not the mount, so it has the sibling-volume
    // hazard the Windows notes describe). Settle which one on the VM before trusting this.
    invoke: async (mountPath) => {
      const r = await _exec('udisksctl', ['unmount', '-b', String(mountPath || '')]);
      return { ok: r.ok, raw: r.out || r.err };
    },
    vocab: {
      // ⚠️ UNVERIFIED but expected: the mount point is removed on unmount.
      lingersAfterEject: false,
      volumeNoun: 'volume',
      lingerNote: null,
      busyNote: (label) =>
        `Something is still using ${label}, so it could not be unmounted.\n\n`
        + `Close anything reading from the card and try again. Unplugging it now risks `
        + `damaging what is on it.`,
    },
  },
};

const plat = () => PLATFORMS[process.platform] || null;

// The renderer asks for this ONCE and composes its own messages, so no user-facing string in
// this app has to branch on an OS name. ⭐ That is what stops a Mac build saying "Windows".
function vocabulary() {
  const p = plat();
  if (!p) return { supported: false, osName: process.platform, volumeNoun: 'volume',
                   lingersAfterEject: false };
  return { supported: true, osName: p.osName, volumeNoun: p.vocab.volumeNoun,
           lingersAfterEject: p.vocab.lingersAfterEject };
}

// ⭐ FREE, SO IT CAN BE POLLED. Unlike the device classification, this is a stat - it can run
// four times a second without anyone noticing. Identical on every platform, which is the whole
// reason the port is cheap.
function mediaPresent(mountPath) {
  const p = String(mountPath || '');
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
}

// ⚠️⚠️ DEBOUNCED, BECAUSE ONE SAMPLE LIED. His I: went gone -> back -> gone across three
// consecutive 250 ms polls. Whether the reader briefly re-presented or the poll caught an
// intermediate teardown state does not matter: on a single sample, suspect the instrument.
// ⭐ Built from reasoning alone this would have been a single poll and a flaky message.
const POLL_MS = 250;
const STABLE_MS = 1000;

// ⚠️⚠️ 60s, AND 15s WAS BELOW A NUMBER WE HAD ALREADY MEASURED. [2026-09-21]
//
// The 09-20 bench run recorded the proffieboard volume dismounting at **20.18 s** - and the
// ceiling was then set to 15 s. So the one transport this feature exists for was guaranteed to
// time out, report `busy`, and tell the user to close files that were not open. It hit three
// times in a row on E: ("still got in use... it really doesn't want to work"), and the card was
// already gone by the time we looked. Earlier the same evening his F: went away roughly ninety
// seconds after the app had given up on it.
//
// ⭐ THE MEASUREMENT WAS IN OUR OWN FILE BEFORE THE CEILING WAS CHOSEN. Nothing new had to be
// learned to get this right; the number was written down in local/export-doors.md and the ceiling
// was picked without consulting it.
//
// ⚠️ WAITING LONGER IS THE CHEAP MISTAKE; A FALSE `busy` IS THE EXPENSIVE ONE. The poll is an
// `existsSync` - free - and the surface shows an animated "Ejecting" the whole time, so the cost
// of a generous ceiling is a longer honest wait. The cost of a short one is telling someone their
// card is in use when it is not, which is advice that cannot be acted on.
const DEFAULT_EJECT_TIMEOUT_MS = 60000;

async function waitForMediaGone(mountPath, timeoutMs = DEFAULT_EJECT_TIMEOUT_MS) {
  const t0 = Date.now();
  let goneSince = null;
  for (;;) {
    if (!mediaPresent(mountPath)) {
      if (goneSince === null) goneSince = Date.now();
      if (Date.now() - goneSince >= STABLE_MS) return { gone: true, ms: Date.now() - t0 };
    } else {
      goneSince = null;   // came back (or never left) - reset rather than concluding
    }
    if (Date.now() - t0 > timeoutMs) {
      return { gone: false, ms: Date.now() - t0, stillPresent: mediaPresent(mountPath) };
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
// ⭐ 'busy' IS THE CASE THE FEATURE EXISTS FOR. It is the one where pulling the card WOULD have
// been unsafe, and it is precisely what a reassuring "safe to remove" message hides.
async function ejectVolume(destDirOrMount, { timeoutMs = DEFAULT_EJECT_TIMEOUT_MS } = {}) {
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

  const inv = await p.invoke(t.mountPath);

  // ⭐⭐ THE POLL IS BACK, AND IT IS NOW THE ONLY WITNESS WE HAVE. [2026-09-22]
  //
  // `cmd /c start` returns the moment it launches, so `raw` can no longer report whether the
  // verb fired, was refused, or found no volume. Everything this module promises - the three
  // honest outcomes, never a success dressed up - now rests entirely on watching the media
  // leave. The poll went from a check on the return value to the whole verdict.
  //
  // ⚠️ AND HIS ORIGINAL QUESTION IS FINALLY TESTABLE HERE. He proposed that this poll, opening
  // the volume ROOT every 250 ms, denies the exclusive lock a dismount needs and so prevents
  // the very thing it watches for. That was tested while the eject was broken for an unrelated
  // reason, so it never got a clean answer. With the eject working, a `busy` from this line
  // means the poll really is the blocker.
  const res = await waitForMediaGone(t.mountPath, timeoutMs);
  if (res.gone) return { status: 'ejected', ...t, ms: res.ms, raw: inv.raw };

  // ⚠️ "WE COULD NOT ASK" IS NOT "SOMETHING HAS IT OPEN". When the volume offered no Eject verb
  // and the media is still there, `busy` would tell the user to close their files - advice that
  // cannot possibly help, because nothing was ever asked to release the card. `unsupported` is
  // the honest branch and the renderer already draws it.
  //
  // ⭐ THIS BRANCH IS REACHABLE AGAIN BECAUSE THE QUESTION IS ASKED SEPARATELY FROM THE ACTION.
  // While the whole operation ran behind `cmd /c start`, `raw` could only say 'launched' and
  // this condition could never be true - a branch that reads as handling something while
  // handling nothing. Splitting ask from act is what restored it.
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
  return { status: mediaPresent(t.mountPath) ? 'busy' : 'returned', ...t,
           ms: res.ms, raw: inv.raw };
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
