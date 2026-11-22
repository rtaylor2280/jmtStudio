// A JMT plugin shares a compiler only when it is file for file the official release. [B-671]
//
// Run: node test/tool-verify.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const tv = require('../toolVerify');
const jmt = require('../jmtPlugin');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-verify-'));
  try {
    const dir = path.join(root, 'gcc');
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'lib', 'empty'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bin', 'gcc.exe'), 'compiler');
    fs.writeFileSync(path.join(dir, 'README'), 'readme');

    // Expected, written out by hand rather than produced by the code under test.
    const expected = {
      digest: tv.digestOfLines([`f bin/gcc.exe ${sha('compiler')}`, `f README ${sha('readme')}`]),
      files: 2,
    };

    ok('the release itself passes', (await tv.verifyToolDir(dir, expected)).ok);
    ok('the check runs off the main thread and reports the file count',
      (await tv.fingerprintDir(dir)).files === 2);

    fs.writeFileSync(path.join(dir, 'bin', 'gcc.exe'), 'compilex');
    const changed = await tv.verifyToolDir(dir, expected);
    ok('one changed byte fails', !changed.ok && changed.reason === 'mismatch', JSON.stringify(changed));
    fs.writeFileSync(path.join(dir, 'bin', 'gcc.exe'), 'compiler');

    fs.writeFileSync(path.join(dir, 'bin', 'extra.h'), 'x');
    const extra = await tv.verifyToolDir(dir, expected);
    ok('a file the release does not have fails', !extra.ok && extra.reason === 'mismatch' && extra.files === 3);
    fs.rmSync(path.join(dir, 'bin', 'extra.h'));

    fs.rmSync(path.join(dir, 'README'));
    const missing = await tv.verifyToolDir(dir, expected);
    ok('a missing file fails', !missing.ok && missing.reason === 'mismatch');
    fs.writeFileSync(path.join(dir, 'README'), 'readme');

    ok('back to the release, it passes again', (await tv.verifyToolDir(dir, expected)).ok);
    ok('no fingerprint for this computer is not a pass', (await tv.verifyToolDir(dir, null)).reason === 'unknown');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // The shipped manifest names the compiler each JMT base shares, with a fingerprint for every
  // computer arduino-cli builds it for.
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'jmt-plugin', 'manifest.json'), 'utf8'));
  for (const base of Object.keys(m.bases)) {
    const keys = jmt.toolKeys(m, base);
    ok(`${base} names its compiler`, keys.length === 1, JSON.stringify(keys));
    for (const k of keys) {
      const hosts = Object.keys((m.tools || {})[k] || {});
      ok(`${k} has a Windows fingerprint`, hosts.includes('i686-mingw32'), hosts.join(', '));
      ok(`${k} has Mac and Linux fingerprints`,
        hosts.some((h) => /darwin/.test(h)) && hosts.some((h) => /linux/.test(h)), hosts.join(', '));
    }
  }
  ok('the linked folder is the compiler alone',
    jmt.toolDirs(m, '4.6.0')[0] === path.join('tools', 'arm-none-eabi-gcc', '14-2-rel1-xpack'));

  // Wiring: the compiler is checked before the JMT tree is made, and createJmtTree links only it.
  const T = fs.readFileSync(path.join(__dirname, '..', 'toolchain.js'), 'utf8');
  const ens = T.slice(T.indexOf('async function _ensureJmtCore'), T.indexOf('async function _ensureJmtCore') + 4000);
  ok('_ensureJmtCore verifies before it creates',
    ens.indexOf('verifyTools(') > 0 && ens.indexOf('verifyTools(') < ens.indexOf('createJmtTree('));
  const J = fs.readFileSync(path.join(__dirname, '..', 'jmtPlugin.js'), 'utf8');
  ok('createJmtTree no longer links every tool folder', !/if \(ent\.name === 'hardware'\) continue;/.test(J));

  // Files the OS drops in a folder by itself (Finder's .DS_Store on the Mac, 2026-11-14) are skipped;
  // any other extra file still fails. The skip must stay that narrow.
  {
    const os = require('os');
    const tv = require('../toolVerify');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-clutter-'));
    try {
      fs.mkdirSync(path.join(d, 'bin'));
      fs.writeFileSync(path.join(d, 'bin', 'gcc'), 'compiler');
      const clean = await tv.fingerprintDirInline(d);
      for (const n of ['.DS_Store', 'Thumbs.db', 'desktop.ini', '._gcc']) fs.writeFileSync(path.join(d, 'bin', n), 'x');
      const cluttered = await tv.fingerprintDirInline(d);
      ok('OS clutter (.DS_Store, Thumbs.db, desktop.ini, ._*) does not change the fingerprint',
        cluttered.digest === clean.digest && cluttered.files === clean.files);
      fs.writeFileSync(path.join(d, 'bin', 'notes.txt'), 'x');
      const extra = await tv.fingerprintDirInline(d);
      ok('CONTROL any other extra file still changes it', extra.digest !== clean.digest);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }

  if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
