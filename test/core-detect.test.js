// Choosing which Proffieboard core to build against.
//
// The defect these guard, found 2026-08-04 from a user's screenshot: JMT Studio
// appends `pclk=2` to every FQBN, and `arduino-cli compile` resolves the platform
// from the SHARED Arduino15 tree regardless of the `--config-file` we pass. So a
// core installed for some other Proffie tool is what we were building against,
// and a core predating that option rejected the FQBN before compiling a single
// file - a 0-second failure reading "invalid option 'pclk'".
//
// The option lists below are REAL `board details` output captured from both cores
// on the same machine, not invented. 3.6 genuinely has four options; 4.6 has five.
// Note the differing column alignment between versions - a reason to match on the
// option token rather than on any fixed layout.
//
// Function bodies are mirrored from toolchain.js; requiring it would pull in
// electron. Same convention as flash-error.test.js.
'use strict';

const REQUIRED_FQBN_OPTION = 'pclk';

function systemCoreCanBuild(probeResult) {
  return probeResult.ok && probeResult.stdout.includes(REQUIRED_FQBN_OPTION);
}

function _looksLikeUnusableCore(result) {
  const output = (result.stdout || '') + (result.stderr || '');
  return /invalid option '[^']*'/i.test(output)
      || /Invalid FQBN/i.test(output)
      || /platform .* not (installed|found)/i.test(output);
}

let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) { failures++; console.error(`FAIL: ${label}\n  expected ${expected}, got ${actual}`); }
  else console.log(`ok - ${label}`);
}

// ── capability probe ───────────────────────────────────────────────────────

const OPTIONS_36 = `Option:        USB Type                                                  usb
Option:        DOSFS                                                     dosfs
Option:        CPU Speed                                                 speed
Option:        Optimize                                                  opt`;

const OPTIONS_46 = `Option:        USB Type                                                 usb
Option:        DOSFS                                                    dosfs
Option:        CPU Speed                                                speed
Option:        Optimize                                                 opt
Option:        Periphereal Clock                                        pclk`;

check('4.6 advertises pclk, so the system core is usable',
  systemCoreCanBuild({ ok: true, stdout: OPTIONS_46 }), true);

check('3.6 does not, so we must fall back to our own copy',
  systemCoreCanBuild({ ok: true, stdout: OPTIONS_36 }), false);

// No core at all is the clean-machine case, and it takes the same branch as a
// too-old core: install ours and pin to it.
check('no platform installed reads as unusable',
  systemCoreCanBuild({ ok: false, stdout: '' }), false);

// A probe that fails for some unrelated reason must not be read as "fine".
// Failing toward our own known-good core is the safe direction; the cost of
// being wrong is a download, not a broken build.
check('a probe that errors is not treated as usable',
  systemCoreCanBuild({ ok: false, stdout: OPTIONS_46 }), false);

// ── retry classifier ───────────────────────────────────────────────────────
// Only a board that was never built FOR may be retried against another core.
// Anything broader would silently compile a real config error twice.

check('the reported error retries',
  _looksLikeUnusableCore({ stderr:
    "Error during build: Invalid FQBN: getting build properties for board " +
    "proffieboard:stm32l4:ProffieboardV3-L452RE: invalid option 'pclk'" }), true);

check('a missing platform retries',
  _looksLikeUnusableCore({ stderr:
    "Error during build: Platform 'proffieboard:stm32l4' not found: platform not installed" }), true);

check('an unknown FQBN retries',
  _looksLikeUnusableCore({ stderr:
    'Error getting board details: Unknown FQBN: platform proffieboard:stm32l4 is not installed' }), true);

check('a real config error does NOT retry',
  _looksLikeUnusableCore({ stderr:
    "my_config.h:412:5: error: 'WavingFlagUSA' was not declared in this scope" }), false);

check('a flash overflow does NOT retry',
  _looksLikeUnusableCore({ stderr:
    "region `FLASH' overflowed by 5896 bytes\ncollect2: error: ld returned 1 exit status" }), false);

check('an out-of-memory does NOT retry',
  _looksLikeUnusableCore({ stderr: 'cc1plus.exe: out of memory allocating 65536 bytes' }), false);

check('a clean build does NOT retry',
  _looksLikeUnusableCore({ stdout: 'Sketch uses 188688 bytes (37%) of program storage space.' }), false);

check('empty output does NOT retry',
  _looksLikeUnusableCore({}), false);

// ── our own directory ──────────────────────────────────────────────────────
// Mirrors _ourCoreCanBuild. The trap this replaced: the SAME core installs into
// a `4.6` or a `4.6.0` directory depending on whether the request said `@4.6`
// or `@4.6.0`, and both are legitimate. A hardcoded directory name would have
// reinstalled the core on every single launch. Measured 2026-08-04: 4.6's
// boards.txt mentions pclk 40 times, 3.6's zero.
function ourCoreCanBuild(boardsTxtByVersion) {
  return Object.values(boardsTxtByVersion)
    .some(txt => typeof txt === 'string' && txt.includes(REQUIRED_FQBN_OPTION));
}

const BOARDS_46 = 'ProffieboardV3-L452RE.menu.pclk.2=Divide by 2\nProffieboardV3-L452RE.menu.usb.cdc=Serial';
const BOARDS_36 = 'ProffieboardV3-L452RE.menu.usb.cdc=Serial\nProffieboardV3-L452RE.menu.opt.os=Smallest Code';

check('a 4.6 install found under a "4.6" directory counts',
  ourCoreCanBuild({ '4.6': BOARDS_46 }), true);
check('the same core under "4.6.0" counts equally',
  ourCoreCanBuild({ '4.6.0': BOARDS_46 }), true);
check('a 3.6 install does not count',
  ourCoreCanBuild({ '3.6': BOARDS_36 }), false);
check('an empty directory does not count',
  ourCoreCanBuild({}), false);
check('an unreadable boards.txt does not count',
  ourCoreCanBuild({ '4.6': null }), false);
check('a usable core alongside an old one still counts',
  ourCoreCanBuild({ '3.6': BOARDS_36, '4.6': BOARDS_46 }), true);


// ── retry guard, including abort ───────────────────────────────────────────
// Mirrors the condition in compile(). The abort term matters: a build the user
// cancelled must never be silently re-run, however its output happens to read.
function shouldRetry(result, aborted) {
  return !result.ok && !aborted && _looksLikeUnusableCore(result);
}

const UNUSABLE = { ok: false, stderr: "invalid option 'pclk'" };

check('an unusable core retries when not aborted',
  shouldRetry(UNUSABLE, false), true);
check('an ABORTED compile never retries, even with a matching signature',
  shouldRetry(UNUSABLE, true), false);
check('a successful compile never retries',
  shouldRetry({ ok: true, stdout: '' }, false), false);

// ── board list follows the core ────────────────────────────────────────────
// Mirrors runBoardList. `matching_boards` is only populated when arduino-cli
// can see the platform, so a board list reading a different directory than the
// compiler reports a connected board as "No Proffieboard detected".
function boardListShouldPinToOurDir(ourDirHasCore) {
  return ourDirHasCore;
}

check('our dir holds the core, so board list is pinned to it',
  boardListShouldPinToOurDir(true), true);
check('our dir is empty, so board list keeps the system default',
  boardListShouldPinToOurDir(false), false);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('all retry and board-list checks passed');
