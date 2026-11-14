#!/usr/bin/env node
/**
 * Does each compiler installed on this computer match its official fingerprint? [B-671]
 * Read-only. The proof, per platform, that toolVerify's folder fingerprint equals the archive
 * fingerprint scripts/tool-fingerprint.js wrote: run it on each OS before a release.
 *
 *   node scripts/verify-installed-compilers.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const tv   = require('../toolVerify');
const manifest = require('../resources/jmt-plugin/manifest.json');

const home = os.homedir();
const roots = process.platform === 'win32'
  ? [path.join(process.env.LOCALAPPDATA, 'Arduino15'), path.join(process.env.LOCALAPPDATA, 'JMT'), path.join(process.env.APPDATA, 'jmt-studio', 'arduino-data')]
  : process.platform === 'darwin'
    ? [path.join(home, 'Library', 'Arduino15'), path.join(home, 'Library', 'Application Support', 'jmt-studio', 'arduino-data')]
    : [path.join(home, '.arduino15'), path.join(home, '.config', 'jmt-studio', 'arduino-data')];

// A data directory itself, or a root holding per-version data directories.
function dataDirs(root) {
  const out = [];
  if (fs.existsSync(path.join(root, 'packages'))) out.push(root);
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (d.isDirectory() && /^\d+\.\d+(\.\d+)?(-jmt)?$/.test(d.name)) out.push(path.join(root, d.name));
    }
  } catch {}
  return out;
}

(async () => {
  console.log(`host keys: ${tv.hostKeys().join(', ')}`);
  let checked = 0, bad = 0;
  for (const root of roots) {
    for (const dd of dataDirs(root)) {
      for (const key of Object.keys(manifest.tools || {})) {
        const [name, ver] = key.split('@');
        const dir = path.join(dd, 'packages', 'proffieboard', 'tools', name, ver);
        if (!fs.existsSync(dir)) continue;
        const exp = tv.expectedFor(manifest, name, ver);
        const t0 = Date.now();
        const got = await tv.fingerprintDir(dir);
        const s = ((Date.now() - t0) / 1000).toFixed(1);
        checked++;
        if (!exp) { bad++; console.log(`NO FINGERPRINT  ${dir}`); continue; }
        if (!got.ok) { bad++; console.log(`UNREADABLE      ${dir}: ${got.error}`); continue; }
        const match = got.digest === exp.digest;
        if (!match) bad++;
        console.log(`${match ? 'MATCH   ' : 'MISMATCH'}  ${got.files}/${exp.files} files  ${s} s  ${dir}`);
      }
    }
  }
  console.log(checked ? `\n${checked} checked, ${bad} not matching` : '\nno installed compilers found');
  process.exit(bad ? 1 : 0);
})();
