// Is there a card SD Export can write to? [B-664]
//
// SD EXPORT IS FOR A CARD, and its button is disabled until one is present. That makes this
// question one the app asks often - at startup, on every drive change, on focus - so it has
// to be cheap and it must never hang.
//
// WHY THIS IS NOT sdCardDetect.scan(). The full scan reads Win32_LogicalDisk through CIM and
// then assesses every card, and it was measured 2026-11-11 at 7.5-10 s with a board whose card
// had dropped mid-write, twice returning [] (its 10 s timeout) while a card sat in the reader.
// Fine for Read my SD card, which is a deliberate act; useless for a button's enabled state.
// DriveInfo answers "which removable drives have media" from the volume itself: measured
// 1-38 ms in-process with that same stuck drive attached. The cost here is the PowerShell
// start (~1 s), paid only when something changed.
//
// UNKNOWN IS NOT "NO CARDS" ([B-028]). A check that fails or times out returns null, and the
// caller keeps the last answer rather than disabling the button on a guess.
'use strict';
const os = require('os');
const { execFile } = require('child_process');

function _windowsCards() {
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

async function _otherCards() {
  try {
    const vols = await require('./sdCardDetect').enumerateRemovableVolumes();
    // Same rule as scan(): an empty reader slot is not a card.
    return (vols || []).filter(v => v && v.hasMedia !== false && v.mountPath)
      .map(v => ({ mountPath: v.mountPath, label: v.label || '' }));
  } catch { return null; }
}

// A Proffieboard on a serial port. Used only to say WHY the button is disabled: a board whose
// card is not shared is not a drive, so "No SD card found" would read as wrong to someone
// looking at their plugged-in board.
async function _boardConnected() {
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    return ports.some(p => String(p.vendorId || '').toLowerCase() === '1209');
  } catch { return null; }
}

// { cards: [{mountPath, label}] | null, boardConnected: bool | null }
async function check() {
  const [cards, boardConnected] = await Promise.all([
    os.platform() === 'win32' ? _windowsCards() : _otherCards(),
    _boardConnected(),
  ]);
  return { cards, boardConnected };
}

module.exports = { check };
