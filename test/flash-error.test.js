// extractFlashError - synthetic log tests.
//
// The point of this file: two branches cannot be reached with hardware, because
// dfu-util always names an error when a real cable comes out. Feeding the function
// a constructed log is the only way to exercise them:
//   - the stopped-short backstop (progress exists, stops < 100%, NO named error)
//   - the error-preferring fallback (no interruption signature at all)
// Everything else here is a real log captured from Ryan's board on 2026-07-26.
//
// Function body is mirrored from toolchain.js; requiring it would pull in electron.
'use strict';

function _isDfuProgressLine(line) {
  return /^\s*(Download|Upload)\s*\[/.test(line) || /\[[=\s]*\]\s*\d+%/.test(line);
}
function _looksLikeFlashError(line) {
  if (_isDfuProgressLine(line)) return false;
  return /error|libusb_control_transfer returned|LIBUSB_ERROR|cannot open|access is denied|no dfu capable|timed out|failed/i.test(line);
}

function extractFlashError(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (raw.includes('Cannot open'))       return 'Port unavailable. Check connection and try again.';
  if (raw.includes('Access is denied'))  return 'Port access denied. Close any other programs using this port.';
  if (raw.includes('No DFU capable'))    return 'No DFU device found. Board may not be in bootloader mode.';
  if (raw.includes('timed out'))         return 'Upload timed out. Try reconnecting the board.';

  const lastProgress = [...lines].reverse().find(_isDfuProgressLine);
  const pm = lastProgress && lastProgress.match(/(\d+)%\s+(\d+)\s+bytes/);
  const stoppedAt = pm ? ` It stopped at ${pm[1]}% (${Number(pm[2]).toLocaleString()} bytes).` : '';

  const stoppedShort = !!pm && Number(pm[1]) < 100;
  const dropLine = lines.find(l =>
    /libusb_control_transfer returned|LIBUSB_ERROR/i.test(l) ||
    /Error during special command|ERASE_PAGE|during download get_status/i.test(l));
  if (dropLine || stoppedShort) {
    return 'The flash was interrupted before it finished' + (stoppedAt ? ' -' + stoppedAt.replace(' It stopped at', ' it stopped at').replace(/\.$/, '') : '') + '.\n\n'
         + 'The board is fine. It holds partial firmware until a flash completes, and the bootloader cannot be erased. '
         + 'Verify connection and flash again. If the board is not in the port list, pick "Switch to Bootloader Mode (DFU)" from the port dropdown.';
  }
  if (raw.includes('dfu-util: error')) {
    const errLine = lines.find(l => l.includes('dfu-util: error'));
    if (errLine) return errLine;
  }
  const _isBenignStatusLine = l =>
    /Determining device status|dfuERROR, clearing status|dfuIDLE, continuing|^\s*dfuERROR\s*$/i.test(l);
  const diagnostic = lines.filter(l => !_isDfuProgressLine(l));
  const errish = diagnostic.filter(l => _looksLikeFlashError(l) && !_isBenignStatusLine(l));
  if (errish.length) return (stoppedAt ? stoppedAt.trim() + '\n' : '') + errish.slice(-3).join('\n');
  const meaningful = diagnostic.filter(l => !_isBenignStatusLine(l));
  if (!meaningful.length) {
    return 'The flash failed before it started transferring.\n\n'
         + 'Check the cable and the board connection, then flash again.';
  }
  return meaningful.slice(-8).join('\n');
}

// ── fixtures ────────────────────────────────────────────────────────────────
const HANDSHAKE = [
  'Determining device status: state = dfuERROR, status = 10',
  'dfuERROR, clearing status',
  'Determining device status: state = dfuIDLE, status = 0',
  'dfuIDLE, continuing',
  'DFU mode device DFU version 011a',
  'Device returned transfer size 2048',
  'DfuSe interface name: "Internal Flash  "',
  'Downloading to address = 0x08000000, size = 207872',
].join('\n');
const prog = (pct, bytes) => `Download\t[==   ]  ${pct}%      ${bytes} bytes`;

const INTERRUPTED = /^The flash was interrupted before it finished/;

const cases = [
  // --- real logs from hardware, 2026-07-26 -------------------------------------
  { name: 'REAL libusb drop at 14%',
    raw: [HANDSHAKE, prog(10, 20480), 'dfuse_download: libusb_control_transfer returned -1', prog(14, 30720)].join('\n'),
    expect: INTERRUPTED, wants: '14% (30,720 bytes)' },

  { name: 'REAL ERASE_PAGE at 64%',
    raw: [HANDSHAKE, prog(62, 129024), 'Error during special command "ERASE_PAGE" get_status', prog(64, 133120)].join('\n'),
    expect: INTERRUPTED, wants: '64% (133,120 bytes)' },

  { name: 'REAL SET_ADDRESS at 19%',
    raw: [HANDSHAKE, prog(18, 38912), 'Error during special command "SET_ADDRESS" get_status', prog(19, 40960)].join('\n'),
    expect: INTERRUPTED, wants: '19% (40,960 bytes)' },

  // Fourth naming, captured 3:47 PM. Not a "special command" at all - this one fails on
  // the data transfer's own status read, which is why the regex needs all four forms.
  { name: 'REAL download get_status at 80%',
    raw: [HANDSHAKE, prog(79, 165888), 'Error during download get_status', prog(80, 167936)].join('\n'),
    expect: INTERRUPTED, wants: '80% (167,936 bytes)' },

  // --- UNREACHABLE ON HARDWARE: the whole reason this file exists ---------------
  { name: 'BACKSTOP: progress stops short with NO named error',
    raw: [HANDSHAKE, prog(75, 153600), prog(78, 159744)].join('\n'),
    expect: INTERRUPTED, wants: '78% (159,744 bytes)' },

  { name: 'BACKSTOP: stops short, no error, no handshake either',
    raw: [prog(31, 65536)].join('\n'),
    expect: INTERRUPTED, wants: '31% (65,536 bytes)' },

  // Deliberately NOT "dfu-util: error" - that has its own branch above. This has to be a
  // line that only _looksLikeFlashError catches, so the errish fallback is what answers.
  { name: 'FALLBACK: prefers a real error line over the benign status handshake',
    raw: [HANDSHAKE, 'usb_claim_interface failed'].join('\n'),
    expect: /usb_claim_interface failed/, wants: null },

  // The regression this fallback exists for: handshake ALONE must not be presented as
  // the error, because those lines appear in successful flashes.
  { name: 'FALLBACK: handshake alone is not surfaced as an error',
    raw: HANDSHAKE,
    expect: /^(?!.*dfuERROR, clearing status)/s, wants: null },

  // --- must NOT be treated as an interruption ----------------------------------
  { name: 'a completed flash reaching 100% is not an interruption',
    raw: [HANDSHAKE, prog(100, 207872), 'Download done.', 'File downloaded successfully'].join('\n'),
    expect: /^(?!The flash was interrupted)/, wants: null },
];

let fail = 0;
for (const c of cases) {
  const out = extractFlashError(c.raw);
  const okShape = c.expect.test(out);
  const okWants = !c.wants || out.includes(c.wants);
  const ok = okShape && okWants;
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + c.name);
  if (!ok) console.log('        got: ' + out.split('\n')[0]);
}
console.log(fail ? `\n${fail} FAILED` : `\nall ${cases.length} passed`);
process.exitCode = fail ? 1 : 0;
