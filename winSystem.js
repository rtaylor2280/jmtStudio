// Windows process, registry, elevation and archive calls. [B-681]
//
// Every taskkill, tasklist, reg and PowerShell launch outside the card code lives here, so the set
// of outside programs Studio starts on Windows is in two files (this one and winDisks.js) that a
// guard test (test/windows-shellouts-one-place.test.js) holds in place. The toolchain's own
// programs (arduino-cli, dfu-util, objcopy) are not here: they are the toolchain itself.
//
// The commands, arguments, timeouts and parsing are the ones the callers ran before the move;
// the callers keep their own platform switches, polling and result handling.

'use strict';

const { execFile, spawn } = require('child_process');

// Kill a process tree. /T = whole tree, /F = force. Fire-and-forget; a spawn that throws
// propagates, so the caller (toolchain._killTree) can fall back to killing the parent.
function killTree(pid) {
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

// Is an Arduino IDE process running? Resolves false when the process list cannot be read.
function arduinoRunning() {
  return new Promise(resolve => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 3000 }, (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve(stdout.toLowerCase().includes('arduino'));
    });
  });
}

// The Windows driver service bound to the STM32 bootloader (e.g. 'WinUSB', 'STTub30'), or '' if
// none/unknown.
function dfuBoundService() {
  const ps = "$d = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_0483&PID_DF11' } | Select-Object -First 1; if ($d) { (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_Service' -ErrorAction SilentlyContinue).Data }";
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 4000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || '').trim());
    });
  });
}

// ── Elevated helper launches ──
// Self-elevate a PowerShell that runs the bundled helper. Single-quote every
// path (doubling embedded quotes) so spaces in "Program Files" survive.
// -WindowStyle Hidden on both the outer probe shell and the elevated helper
// keeps the raw PowerShell console off the user's screen. The UAC prompt and
// the "install this device software" dialog are separate system windows and
// still appear (that consent is intentional); only the console is suppressed.
// If the user declines the UAC prompt, Start-Process throws and the launcher exits non-zero.
// `done(error)` is the execFile callback; the caller polls the helper's result file from it.

// The WinUSB DFU driver install (resources/dfu-driver/ensure-winusb.ps1).
function launchDfuDriverHelper(helper, infPath, resultPath, done) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const psCmd =
    `$a=@('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',${q(helper)},` +
    `'-InfPath',${q(infPath)},'-ResultPath',${q(resultPath)});` +
    `try { Start-Process -FilePath 'powershell' -ArgumentList $a -Verb RunAs -WindowStyle Hidden | Out-Null; exit 0 } catch { exit 3 }`;
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCmd],
    { timeout: 120000, windowsHide: true }, done);
}

// The WebUSB interface-GUID fix (resources/webusb-fix/fix-webusb-guid.ps1).
function launchWebUsbFixHelper(helper, serial, resultPath, done) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const psCmd =
    `$a=@('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',${q(helper)},` +
    `'-Serial',${q(serial.trim())},'-ResultPath',${q(resultPath)});` +
    `try { Start-Process -FilePath 'powershell' -ArgumentList $a -Verb RunAs -WindowStyle Hidden | Out-Null; exit 0 } catch { exit 3 }`;
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCmd],
    { timeout: 120000, windowsHide: true }, done);
}

// One registry value. Resolves the raw `reg query` output, or null when the key or value is
// absent or the query fails. A plain read; needs no admin.
function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 },
      (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

// Unpack a downloaded zip (Get ProffieOS). Resolves on success, rejects with the execFile error.
function expandArchive(zipPath, extractDir) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`
    ], { timeout: 120000 }, err => err ? reject(err) : resolve());
  });
}

module.exports = {
  killTree, arduinoRunning, dfuBoundService, launchDfuDriverHelper, launchWebUsbFixHelper,
  regQuery, expandArchive,
};
