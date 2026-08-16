// What the user is told when a compile fails.
//
// The defect these guard, hit live on 2026-08-12 with ProffieOS 8.10 on core 3.6:
// the build died with `exit status 1` and NO compiler diagnostic. The extractor
// found no ` error: ` line, fell through to "last ten non-empty lines", and those
// ten lines were arduino-cli's own post-failure "Used library / Used platform"
// table plus the echoed g++ invocation - a single line carrying every -D and -I
// on the command. The user was handed several thousand characters of include
// paths as the reason their build failed, with the ANSI colour escapes from that
// table rendered literally as `[92m`.
//
// The fixture below is Ryan's real captured output, trimmed in the middle of the
// long command lines only. The escape bytes are real here; his paste showed them
// already stripped by the terminal.
//
// ⚠️ THIS FILE USED TO MIRROR THE FUNCTION BODIES instead of importing them,
// because requiring toolchain.js pulls in electron via cacheManager. A test that
// reimplements its subject is testing itself: on 2026-08-15 the copy below passed
// while the real extractor handed a user
//     .../ld.exe: region…
//     collect2.exe: error: ld returned 1 exit status
// on a genuine FLASH overflow, byte count clipped away. The copy had also drifted
// - its failure-signal list was missing `std::bad_alloc` and `lto-wrapper`.
//
// The summariser now lives in ../compileErrors.js, which is pure text handling
// with no electron, so both sides import the SAME code. Do not reintroduce a
// local copy here. (2026-08-15)
//
// NOTE: core-detect.test.js and flash-error.test.js still mirror their subjects
// the old way, for the same original reason. Same hazard, not yet addressed.
'use strict';

const ESC = '\x1B';

const {
  extractCompileError,
  _stripAnsi,
} = require('../compileErrors');

// ── harness ────────────────────────────────────────────────────────────────
let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) { failures++; console.error(`FAIL: ${label}\n  expected ${expected}, got ${actual}`); }
  else console.log(`ok - ${label}`);
}
function checkThat(label, pass, detail) {
  if (!pass) { failures++; console.error(`FAIL: ${label}${detail ? '\n  ' + detail : ''}`); }
  else console.log(`ok - ${label}`);
}

// ── Ryan's real failure, 2026-08-12 ────────────────────────────────────────
const GPP = 'C:\\Users\\Ryan\\AppData\\Roaming\\jmt-studio\\arduino-data\\3.6.0\\packages\\proffieboard\\tools\\arm-none-eabi-gcc\\9-2020-q2-update/bin/arm-none-eabi-g++';
const LONG_CMD = `${GPP} -mcpu=cortex-m4 -mthumb -c -g -Os -w -std=gnu++11 ${'-IC:\\Users\\Ryan\\AppData\\Roaming\\jmt-studio\\arduino-data\\3.6.0\\packages\\proffieboard\\hardware\\stm32l4\\3.6/system/CMSIS/Include '.repeat(6)}-o out.o`;

const REAL_FAILURE = [
  'Generating function prototypes...',
  LONG_CMD,
  'C:\\Users\\Ryan\\AppData\\Roaming\\jmt-studio\\arduino-data\\3.6.0\\packages\\builtin\\tools\\ctags\\5.8-arduino11/ctags -u --language-force=c++ -f -',
  'Compiling sketch...',
  LONG_CMD,
  'Using library Wire at version 1.0 in folder: C:\\Users\\Ryan\\AppData\\Roaming\\jmt-studio\\arduino-data\\3.6.0\\packages\\proffieboard\\hardware\\stm32l4\\3.6\\libraries\\Wire',
  'Error during build: exit status 1',
  `${ESC}[92mUsed library${ESC}[0m ${ESC}[92mVersion${ESC}[0m ${ESC}[90mPath${ESC}[0m`,
  `${ESC}[93mWire${ESC}[0m         1.0     ${ESC}[90mC:\\Users\\Ryan\\AppData\\Roaming\\jmt-studio\\arduino-data\\3.6.0\\packages\\proffieboard\\hardware\\stm32l4\\3.6\\libraries\\Wire${ESC}[0m`,
  `${ESC}[92mUsed platform${ESC}[0m        ${ESC}[92mVersion${ESC}[0m ${ESC}[90mPath${ESC}[0m`,
  `${ESC}[93mproffieboard:stm32l4${ESC}[0m 3.6     ${ESC}[90mC:\\Users\\Ryan\\AppData\\Roaming\\jmt-studio\\arduino-data\\3.6.0\\packages\\proffieboard\\hardware\\stm32l4\\3.6${ESC}[0m`,
].join('\n');

const out = extractCompileError(REAL_FAILURE);

check('reports arduino-cli\'s own reason, and only that',
  out, 'Error during build: exit status 1');
checkThat('no ANSI escape survives', !/\x1B\[/.test(out), JSON.stringify(out));
checkThat('no literal colour token survives', !/\[9[0-9]m/.test(out), JSON.stringify(out));
checkThat('the echoed compiler command is never the summary', !out.includes('-mcpu='), out.slice(0, 120));
checkThat('no include path is shown', !out.includes('-IC:\\'), out.slice(0, 120));
checkThat('summary stays short', out.length < 200, `length ${out.length}`);

// ── ANSI stripping at the line reader ──────────────────────────────────────
check('strips SGR colour codes',
  _stripAnsi(`${ESC}[92mUsed library${ESC}[0m`), 'Used library');
check('leaves ordinary text alone',
  _stripAnsi('Compiling sketch...'), 'Compiling sketch...');
check('leaves a bare bracket alone',
  _stripAnsi('array[92] = x'), 'array[92] = x');

// ── real diagnostics still win over the fallback ───────────────────────────
const WITH_DIAG = [
  'Compiling sketch...',
  LONG_CMD,
  'C:\\x\\config\\my_config.h:41:12: error: \'Blakc\' was not declared in this scope',
  'Error during build: exit status 1',
  `${ESC}[92mUsed platform${ESC}[0m 3.6`,
].join('\n');

check('a real diagnostic beats the arduino-cli summary line',
  extractCompileError(WITH_DIAG),
  'my_config.h:41 — \'Blakc\' was not declared in this scope');

// ── flash overflow: the linker says neither "error" nor "warning" ──────────
//
// ⚠️ THE PATH HERE IS THE POINT. This fixture used to read "c:/.../ld.exe:" -
// a tidied-up 12-character stand-in - and the test passed for a year while the
// real case failed every time. The genuine prefix arm-none-eabi emits is 174
// characters, which is longer than the 180-char clip budget, so the message got
// cut at "…/ld.exe: region…" and the byte count never reached the user.
//
// Shortening a fixture for readability removed the only property that breaks it.
// Any future edit here keeps a REAL path. (2026-08-15)
const LD = 'C:/Users/Ryan/AppData/Local/Arduino15/packages/proffieboard/tools/'
         + 'arm-none-eabi-gcc/14-2-rel1-xpack/bin/../lib/gcc/arm-none-eabi/14.2.1/'
         + '../../../../arm-none-eabi/bin/ld.exe';

const OVERFLOW = [
  'Compiling sketch...',
  LONG_CMD,
  `${LD}: region \`FLASH' overflowed by 5400 bytes`,
  'collect2.exe: error: ld returned 1 exit status',
  'Error during build: exit status 1',
].join('\n');

// The byte count survives a path longer than the whole clip budget.
checkThat('an overflow surfaces the byte count, not the command',
  extractCompileError(OVERFLOW).includes('5,400 bytes'),
  extractCompileError(OVERFLOW));

// It is TRANSLATED, not merely relayed: the user is told what to do about it.
checkThat('an overflow is explained, not quoted',
  /Config overflow/.test(extractCompileError(OVERFLOW))
  && /Reduce preset count/.test(extractCompileError(OVERFLOW)),
  extractCompileError(OVERFLOW));

// With board capacity supplied, BOTH figures are stated - and both are measured.
// The total is deliberately not computed: boards.txt and the linker's FLASH
// region agree on a V2 (262,144) but differ by 16 KB on a V3 (507,904 vs
// 524,288), and the overflow is measured against the linker's. A derived "used"
// would be quietly wrong on the commonest board.
check('capacity is stated when known',
  extractCompileError(OVERFLOW, { boardName: 'Proffieboard V2', maxFlash: 262144 }),
  'Config overflow: 5,400 bytes over.\n'
  + 'Your config needs 267,544 bytes. Proffieboard V2 holds 262,144.\n'
  + '\n'
  + 'Reduce preset count or reuse styles across presets to fit.');

// The blank line is load-bearing: the renderer turns it into a margin, which is
// what separates the instruction from the diagnosis. Without it they run together.
checkThat('the instruction is separated from the diagnosis',
  extractCompileError(OVERFLOW, { boardName: 'Proffieboard V2', maxFlash: 262144 })
    .split('\n').indexOf('') > 0,
  extractCompileError(OVERFLOW, { boardName: 'Proffieboard V2', maxFlash: 262144 }));

// No capacity: say less rather than something shaped like more.
// No capacity: the headline carries its own object, and no total is invented.
check('capacity is omitted when unknown, not guessed',
  extractCompileError(OVERFLOW),
  "Config overflow: 5,400 bytes over the board's flash.\n"
  + '\n'
  + 'Reduce preset count or reuse styles across presets to fit.');

// A corpus average is not a fact about THIS build. An earlier draft printed
// "one distinct style costs roughly 7,600 bytes" beside the user's own byte
// count, which reads as a measurement of their config. It is not one.
checkThat('no corpus averages are presented as this build\'s numbers',
  !/7,?600|24 bytes/.test(
    extractCompileError(OVERFLOW, { boardName: 'Proffieboard V2', maxFlash: 262144 })),
  extractCompileError(OVERFLOW, { boardName: 'Proffieboard V2', maxFlash: 262144 }));

// The linker's exit announcement and arduino-cli's echo of it are both noise.
checkThat('an overflow summary carries no exit-status noise',
  !/ld returned|exit status/i.test(extractCompileError(OVERFLOW)),
  extractCompileError(OVERFLOW));

// A long tool path must not eat the message on failures we do NOT translate.
const UNTRANSLATED = [
  'Compiling sketch...',
  LONG_CMD,
  `${LD}: cannot find -lnosuchlib`,
  'collect2.exe: error: ld returned 1 exit status',
].join('\n');

checkThat('a long tool path is stripped, not clipped through',
  extractCompileError(UNTRANSLATED).includes('cannot find -lnosuchlib'),
  extractCompileError(UNTRANSLATED));

// The narrow strip must never touch a SOURCE diagnostic - losing the filename
// would cost the user the one thing they need to open.
const SRC_DIAG = [
  'Compiling sketch...',
  "C:\\Users\\Ryan\\config\\my_config.h:431:1: error: expected ',' or ';' before 'BladeConfig'",
].join('\n');

check('a source path keeps its file and line',
  extractCompileError(SRC_DIAG),
  "my_config.h:431 — expected ',' or ';' before 'BladeConfig'");

// ── degenerate input ───────────────────────────────────────────────────────
check('nothing usable still says something honest',
  extractCompileError(`${LONG_CMD}\n\n`),
  'The compiler stopped without reporting a reason.');

console.log(failures ? `\n${failures} failure(s)` : '\nAll passed');
process.exit(failures ? 1 : 0);
