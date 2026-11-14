/**
 * Is an installed compiler exactly the official release? [B-671]
 *
 * A JMT plugin shares its stock version's compiler through hard links instead of a second 1.4 GB
 * copy [B-668]. That compiler may be one Studio did not install (Arduino IDE's, in Arduino15), so
 * before a JMT plugin links to it, every file is checked against a fingerprint of the official
 * archive, made once from the archive itself (scripts/tool-fingerprint.js) and shipped in
 * resources/jmt-plugin/manifest.json. A mismatch means the compiler is not linked.
 *
 * THE FINGERPRINT. One sha256 over the sorted lines
 *     f <relative path> <sha256 of the file>
 *     l <relative path> <symlink target>
 * with "/" separators and the archive's single top folder removed, which is how arduino-cli lays
 * an archive out on disk. Directories carry no line. Extra files count: a folder holding anything
 * the release does not is not the release.
 *
 * Runs in a worker thread: about 1.4 GB is read, and the main process must keep answering.
 */
'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

function digestOfLines(lines) {
  const h = crypto.createHash('sha256');
  for (const l of lines.slice().sort()) h.update(l + '\n');
  return h.digest('hex');
}

function _hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

// The lines for an installed folder. Same rules as the archive side.
// FILES THE OPERATING SYSTEM LEAVES IN A FOLDER BY ITSELF are not part of the compiler and are
// skipped. Found on the Mac 2026-11-14: the official 14-2-rel1 install held 7,499 files against
// the release's 7,496, and the three extra were Finder's .DS_Store; everything else matched. These
// names never appear in a toolchain release, so skipping them cannot hide a changed compiler file.
const OS_CLUTTER = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

async function linesOfDir(root) {
  const lines = [];
  async function walk(rel) {
    const ents = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
    for (const e of ents) {
      if (OS_CLUTTER.test(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      const abs = path.join(root, r);
      if (e.isSymbolicLink()) lines.push(`l ${r} ${await fs.promises.readlink(abs)}`);
      else if (e.isDirectory()) await walk(r);
      else if (e.isFile()) lines.push(`f ${r} ${await _hashFile(abs)}`);
    }
  }
  await walk('');
  return lines;
}

async function fingerprintDirInline(root) {
  const lines = await linesOfDir(root);
  return { digest: digestOfLines(lines), files: lines.length };
}

/**
 * Fingerprint a folder off the main thread.
 * Resolves { ok: true, digest, files } or { ok: false, error }.
 */
function fingerprintDir(root) {
  return new Promise((resolve) => {
    let w;
    try { w = new Worker(__filename, { workerData: { root } }); }
    catch (e) { return resolve({ ok: false, error: e.message }); }
    w.once('message', (m) => resolve(m));
    w.once('error', (e) => resolve({ ok: false, error: e.message }));
    w.once('exit', (code) => { if (code !== 0) resolve({ ok: false, error: `stopped (${code})` }); });
  });
}

// arduino-cli's name for this computer's build of a tool, as the package index spells it.
function hostKeys() {
  const a = process.arch, p = process.platform;
  if (p === 'win32')  return ['i686-mingw32'];
  if (p === 'darwin') return a === 'arm64' ? ['arm64-apple-darwin', 'aarch64-apple-darwin'] : ['x86_64-apple-darwin'];
  if (p === 'linux')  return a === 'arm64' ? ['aarch64-linux-gnu'] : ['x86_64-pc-linux-gnu', 'x86_64-linux-gnu'];
  return [];
}

/**
 * The expected fingerprint of `toolName@toolVersion` on this computer, from a manifest's
 * `tools` block, or null when the manifest has none (then nothing can be verified).
 */
function expectedFor(manifest, toolName, toolVersion) {
  const t = manifest && manifest.tools && manifest.tools[`${toolName}@${toolVersion}`];
  if (!t) return null;
  for (const k of hostKeys()) if (t[k]) return t[k];
  return null;
}

/**
 * Is `dir` exactly the official build of the tool? Resolves { ok, reason? }.
 * reason: 'unknown' (no fingerprint for this computer), 'mismatch', or an error message.
 */
async function verifyToolDir(dir, expected) {
  if (!expected) return { ok: false, reason: 'unknown' };
  const got = await fingerprintDir(dir);
  if (!got.ok) return { ok: false, reason: got.error };
  if (got.digest !== expected.digest) {
    return { ok: false, reason: 'mismatch', files: got.files, expectedFiles: expected.files };
  }
  return { ok: true };
}

if (!isMainThread && workerData && workerData.root) {
  fingerprintDirInline(workerData.root)
    .then((r) => parentPort.postMessage({ ok: true, ...r }))
    .catch((e) => parentPort.postMessage({ ok: false, error: e.message }));
}

module.exports = { digestOfLines, linesOfDir, fingerprintDir, fingerprintDirInline, hostKeys, expectedFor, verifyToolDir };
