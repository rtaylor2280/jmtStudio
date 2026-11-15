// Windows process, registry, device, elevation and archive calls. [B-681]
//
// NO CHILD PROCESSES. The registry read, the DFU driver-service lookup, the process list and the
// process-tree kill are Win32 calls made in-process through koffi (winSystemNative.js, on a
// worker thread via winNativeRun.js), and the archive unpack is node-stream-zip, because
// behaviour-based antivirus kills an Electron app that keeps launching reg.exe, tasklist,
// taskkill and PowerShell (QA BUG-012). The two jobs that need administrator rights are done by
// Studio's own signed driver helper, started through the Windows administrator prompt. A guard
// test (test/windows-shellouts-one-place.test.js) holds this file and every other to no launches.
//
// SAME ANSWERS, SAME TIME LIMITS. Each export resolves what the launched program's version
// resolved, and degrades to the same failure value after the same time limit. The toolchain's own
// programs (arduino-cli, dfu-util, objcopy) are not here: they are the toolchain itself.

'use strict';

const { runNative } = require('./winNativeRun');
const N = require('./winSystemNative');

const _run = (op, args, timeoutMs, failValue) =>
  runNative('winSystemNative.js', op, args, timeoutMs, failValue);

// Kill a process tree: every descendant of `pid`, then `pid` itself, force-terminated (what
// taskkill /T /F did). Fire-and-forget: returns at once and never throws. The returned promise
// resolves { killed, failed } once the tree has been stopped, or null when the native call could
// not run at all, so the caller (toolchain._killTree) can fall back to killing the parent.
function killTree(pid) {
  return _run('killTree', [pid], 10000, null);
}

// Is an Arduino IDE process running? Resolves false when the process list cannot be read.
// 3 s, as the tasklist call had. The rule is winSystemNative.anyArduino.
function arduinoRunning() {
  return _run('processList', [], 3000, null).then((procs) => (procs ? N.anyArduino(procs) : false));
}

// The present devices whose instance ID matches `pattern` (Get-PnpDevice's case-insensitive
// -match), [{ id, service }] in enumeration order, or [] when none or the query fails. 4 s.
function pnpServices(pattern) {
  return _run('pnpServices', [String(pattern)], 4000, []).then((r) => (Array.isArray(r) ? r : []));
}

// The Windows driver service bound to the first present device matching `pattern`, or '' if
// none/unknown. Exposed with the pattern so the lookup can be checked against a device that is
// plugged in; dfuBoundService is the one the toolchain asks.
function boundServiceOf(pattern) {
  return pnpServices(pattern).then((r) => (r.length ? String(r[0].service || '').trim() : ''));
}

// The Windows driver service bound to the STM32 bootloader (e.g. 'WinUSB', 'STTub30'), or '' if
// none/unknown.
const DFU_INSTANCE_PATTERN = 'VID_0483&PID_DF11';
function dfuBoundService() {
  return boundServiceOf(DFU_INSTANCE_PATTERN);
}

// ── The driver helper: the two jobs that need administrator rights ──
// JMT Studio Driver Helper (driver-helper/DriverHelper.cs, built to
// resources/driver-helper/JMTStudioDriverHelper.exe and signed with Studio) installs the WinUSB
// DFU driver and repairs a board's WebUSB setting. It is started directly through the Windows
// administrator prompt, which names the signed publisher; no PowerShell, no hidden console.
// The helper writes its result file as its last action, and the caller polls for that file.
// `done(error)` is called once the helper is running (error null) or could not be started:
// error.code 1223 is the prompt declined.
const ELEVATED_START_MS = 120000;   // the prompt waits on the user
function _startHelper(exe, args, done) {
  _run('runElevated', [String(exe), args], ELEVATED_START_MS, { ok: false, error: 'no-answer' })
    .then((r) => {
      if (r && r.ok) return done(null);
      const e = new Error('The driver helper did not start' + (r && r.error ? ` (${r.error})` : ''));
      e.code = r && r.error;
      done(e);
    }, (err) => done(err || new Error('The driver helper did not start')));
}

// Install the WinUSB DFU driver (helper command dfu-driver).
function launchDfuDriverHelper(exe, infPath, resultPath, done) {
  _startHelper(exe, ['dfu-driver', '--inf', infPath, '--result', resultPath], done);
}

// Repair one board's WebUSB setting (helper command webusb). [B-660]
function launchWebUsbFixHelper(exe, serial, resultPath, done) {
  _startHelper(exe, ['webusb', '--serial', String(serial).trim(), '--result', resultPath], done);
}

// One registry value under HKLM. Resolves { type, data } (winSystemNative.decodeRegValue: a
// string for REG_SZ, an array for REG_MULTI_SZ), or null when the key or value is absent or the
// read fails or takes over 5 s. A plain read; needs no admin.
function regQuery(key, value) {
  return _run('regValue', [String(key), String(value)], 5000, null);
}

// How toolchain.checkWebUsbWindows reads the two values, as it read reg.exe's printed line.
// ParentIdPrefix: a REG_SZ, its first whitespace-free run ("ParentIdPrefix  REG_SZ  (\S+)");
// null when absent, empty or of another type.
function webUsbParentPrefix(v) {
  if (!v || v.type !== 'REG_SZ') return null;
  const m = /\S+/.exec(N.regValueText(v));
  return m ? m[0] : null;
}
// DeviceInterfaceGUIDs: true when the value's text holds a {GUID}. The printed key path never
// held one (a ParentIdPrefix has no braces), so the value is all that was ever matched.
function webUsbHasGuid(v) {
  return /\{[0-9A-Fa-f-]{36}\}/.test(N.regValueText(v));
}

// ── Unpack a downloaded zip (Get ProffieOS) ──
// Every entry into extractDir, directories created, existing files overwritten, each file's
// modified time taken from the archive: what Expand-Archive -Force did. Resolves on success;
// rejects on any failure, an entry that would land outside extractDir, or after 120 s.
//
// ZIP-SLIP. An entry named "../x", "C:/x", "/x" or with a ":" (an NTFS stream) would write outside
// the folder or somewhere other than a plain file. Every name is checked before anything is
// written, and one such entry rejects the whole archive. Expand-Archive skipped such an entry with
// a non-terminating error and PowerShell still exited 0, so the unpack resolved with a file
// missing; an archive that is not a zip at all likewise resolved with nothing extracted. Both
// reject here, with the reason in the message.
// Backslashes in names are separators, as Windows' own unzip read them.
const EXPAND_TIMEOUT_MS = 120000;

// The absolute path an entry extracts to, or null when it would escape `root`. '' for an entry
// that names the root itself (a "./" directory entry).
function zipEntryTarget(root, name) {
  const path = require('path');
  const n = String(name).replace(/\\/g, '/');
  if (/^\//.test(n) || /^[A-Za-z]:/.test(n) || n.includes(':') || n.includes('\0')) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, n);
  if (target === base) return '';
  const rel = path.relative(base, target);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return target;
}

// A zip entry's DOS time as a local Date. node-stream-zip reads the DOS fields as UTC; DOS times
// are local, which is how Windows set the extracted file's modified time.
function zipLocalTime(entryTime) {
  const d = new Date(entryTime);
  if (isNaN(d)) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
                  d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

function expandArchive(zipPath, extractDir, timeoutMs = EXPAND_TIMEOUT_MS) {
  const fs = require('fs');
  const path = require('path');
  const { pipeline } = require('stream/promises');
  // Owns the descriptor: node-stream-zip leaks it on a failed read, and a leaked one keeps the
  // downloaded zip from being deleted afterwards. [B-479]
  const { openZipOwned } = require('./zipOpen');
  let zip = null;
  let timedOut = false;
  let timer = null;
  const work = (async () => {
    zip = openZipOwned(zipPath, { skipEntryNameValidation: true });
    const entries = Object.values(await zip.entries());
    const plan = entries.map((e) => {
      const target = zipEntryTarget(extractDir, e.name);
      if (target === null) throw new Error(`The archive entry "${e.name}" is outside the destination folder.`);
      if (target === '' && !e.isDirectory) throw new Error(`The archive entry "${e.name}" has no file name.`);
      return { e, target };
    });
    fs.mkdirSync(extractDir, { recursive: true });
    for (const { e, target } of plan) {
      if (timedOut) return;
      if (e.isDirectory) {
        if (target) fs.mkdirSync(target, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await pipeline(await zip.stream(e), fs.createWriteStream(target));
      const t = zipLocalTime(e.time);
      if (t) { try { fs.utimesSync(target, t, t); } catch {} }
    }
  })();
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Unpacking the archive took longer than ${Math.round(timeoutMs / 1000)} s.`));
    }, timeoutMs);
  });
  const guarded = work.catch((e) => {
    throw new Error(`The archive could not be unpacked: ${e && e.message || e}`);
  });
  // The archive is closed BEFORE the promise settles: a close still in flight would release its
  // descriptor number after the next open could have been handed the same one.
  return Promise.race([guarded, limit]).finally(async () => {
    clearTimeout(timer);
    if (zip) { try { await zip.close(); } catch {} }
  });
}

module.exports = {
  killTree, arduinoRunning, dfuBoundService, launchDfuDriverHelper, launchWebUsbFixHelper,
  regQuery, expandArchive, webUsbParentPrefix, webUsbHasGuid,
  pnpServices, boundServiceOf, zipEntryTarget, zipLocalTime, DFU_INSTANCE_PATTERN, EXPAND_TIMEOUT_MS,
};
