// Every compiler the shipped JMT plugin manifest shares has a fingerprint this computer can find,
// on every computer arduino-cli installs it on. An Apple Silicon Mac gets the Intel Mac build of
// a tool with no arm64 Mac build (arm-none-eabi-gcc 9-2020-q2-update, the 3.6.0 base), so that
// fingerprint must be the one checked there; the native build still wins when it exists. [B-677]
//
// Run: node test/tool-verify-host-keys.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const tv = require('../toolVerify');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'jmt-plugin', 'manifest.json'), 'utf8'));

const hosts = [
  ['win32', 'x64'], ['win32', 'arm64'],
  ['darwin', 'arm64'], ['darwin', 'x64'],
  ['linux', 'arm64'], ['linux', 'x64'],
];
for (const key of Object.keys(m.tools || {})) {
  const at = key.lastIndexOf('@');
  const name = key.slice(0, at), version = key.slice(at + 1);
  for (const [p, a] of hosts) {
    const exp = tv.expectedFor(m, name, version, tv.hostKeys(p, a));
    ok(`${key} has a fingerprint on ${p}/${a}`, !!(exp && exp.digest));
  }
}

// The 3.6.0 compiler on an Apple Silicon Mac is the Intel build.
const gcc9 = m.tools['arm-none-eabi-gcc@9-2020-q2-update'];
ok('Apple Silicon Mac checks the Intel build of the 3.6.0 compiler',
  tv.expectedFor(m, 'arm-none-eabi-gcc', '9-2020-q2-update', tv.hostKeys('darwin', 'arm64')) === gcc9['x86_64-apple-darwin']);

// The native arm64 build wins when the manifest has both.
const gcc14 = m.tools['arm-none-eabi-gcc@14-2-rel1-xpack'];
ok('Apple Silicon Mac checks the native build when there is one',
  tv.expectedFor(m, 'arm-none-eabi-gcc', '14-2-rel1-xpack', tv.hostKeys('darwin', 'arm64')) === gcc14['arm64-apple-darwin']);
ok('Intel Mac never picks an arm64 build',
  !tv.hostKeys('darwin', 'x64').some((k) => /arm64|aarch64/.test(k)));
ok('the no-argument form is this computer',
  JSON.stringify(tv.hostKeys()) === JSON.stringify(tv.hostKeys(process.platform, process.arch)));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
