// extractFlashError - synthetic log tests.
//
// The point of this file: two branches cannot be reached with hardware, because
// dfu-util always names an error when a real cable comes out. Feeding the function
// a constructed log is the only way to exercise them:
//   - the stopped-short backstop (progress exists, stops < 100%, NO named error)
//   - the error-preferring fallback (no interruption signature at all)
// Everything else here is a real log captured from a board on 2026-07-26.
//
// The functions are taken from toolchain.js itself, so the test runs the shipped code and cannot
// drift from it; requiring the module would pull in electron.
'use strict';

const _src = require('fs').readFileSync(require('path').join(__dirname, '..', 'toolchain.js'), 'utf8');
function _take(name) {
  const start = _src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('toolchain.js has no function ' + name);
  let depth = 0;
  for (let i = _src.indexOf('{', start); i < _src.length; i++) {
    if (_src[i] === '{') depth++;
    else if (_src[i] === '}' && --depth === 0) return _src.slice(start, i + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}
// eslint-disable-next-line no-eval
const { extractFlashError } = new Function(
  _take('_isDfuProgressLine') + _take('_looksLikeFlashError') + _take('extractFlashError')
  + '; return { extractFlashError };')();

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
// [B-289] An interruption states what happened and that the board is fine, and stops there: the
// next step depends on whether the board still has a port, which only the window knows.
{
  const out = extractFlashError([HANDSHAKE, prog(80, 167936), 'Error during download get_status'].join('\n'));
  const ok = INTERRUPTED.test(out) && /cannot be erased\.$/.test(out) && !/flash again|Bootloader Mode/i.test(out);
  if (!ok) fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + 'an interruption leaves the next step to the window');
  if (!ok) console.log('        got: ' + JSON.stringify(out));
}
console.log(fail ? `\n${fail} FAILED` : `\nall ${cases.length + 1} passed`);
process.exitCode = fail ? 1 : 0;
