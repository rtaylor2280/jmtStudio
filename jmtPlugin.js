/**
 * The JMT plugin [B-668]: a stock Proffieboard plugin with the 4 GiB USB Mass Storage fix, built
 * BESIDE the stock one and never in place of it.
 *
 * THE BUG. The plugin's Mass Storage code (usbd_msc_scsi.c, ST's USB Device library V2.4.2, 2015)
 * turns a block number into a 32-bit BYTE address, so every read and write past 4 GiB wraps to the
 * start of the card. ST fixed it in their own library in 2020 (v2.5.1: the address stays in blocks);
 * the plugin still carries the 2015 copy. Proven on a board and soaked clean 2026-11-11/12.
 *
 * THE FIX ships prebuilt in resources/jmt-plugin/<base>/: one library per chip family, rebuilt with
 * that plugin's own compiler. Verified by building firmware stock vs JMT for 3.6 and 4.6 on V3 and
 * V2: the only function that differs is SCSI_ProcessCmd, where the two byte-address multiplies are
 * gone (local/b668-jmt-plugin).
 *
 * THE TREE. "<root>/4.6.0-jmt" is a complete arduino-cli data directory of its own:
 *   - the platform directory is a real COPY (66 MB) with the fixed libraries swapped in and
 *     platform.txt stamped "4.6.0-jmt.1", which is how coreVersions recognises it;
 *   - the compiler it depends on (about 1.4 GB) is HARD-LINKED to the stock tree's files: no second
 *     copy, and if the stock tree is ever removed anyway the links keep the data, so the JMT plugin
 *     keeps building. Only a compiler verified file for file against the official release is ever
 *     linked (verifyTools, B-671); the caller checks before it calls createJmtTree.
 * Nothing in the stock tree is written. The board names are the same, so configs do not change.
 *
 * Built in "<tree>.partial" and renamed into place only once verified, so an interrupted build
 * never leaves something every "is it installed" check would believe.
 */
'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const coreVersions = require('./coreVersions');

const REVISION_SUFFIX = '.1';

// What a JMT plugin is, in one line: beside it in the selector, and in every build it makes.
const NOTE = 'Includes the 4 GB SD card fix from JMT Sabers · jmtfoundry.com';   // platform.txt says "4.6.0-jmt.1"; a later fix would be .2

function _resourcesDir(resourcesPath) { return path.join(resourcesPath, 'jmt-plugin'); }

function readManifest(resourcesPath) {
  try { return JSON.parse(fs.readFileSync(path.join(_resourcesDir(resourcesPath), 'manifest.json'), 'utf8')); }
  catch { return null; }
}

/** Stock versions a JMT plugin exists for, e.g. ['3.6.0', '4.6.0']. */
function supportedBases(resourcesPath) {
  const m = readManifest(resourcesPath);
  return m && m.bases ? Object.keys(m.bases).map(coreVersions.normalizeVersion) : [];
}

function isSupported(resourcesPath, version) {
  return supportedBases(resourcesPath).includes(coreVersions.baseVersion(version));
}

/**
 * The compilers `base` depends on, as "name@version" (from the manifest, which records the stock
 * platform's own dependencies) [B-671].
 */
function toolKeys(manifest, base) {
  return (manifest && manifest.baseTools && manifest.baseTools[coreVersions.baseVersion(base)]) || [];
}

/** The same, as directories under packages/proffieboard: "tools/<name>/<version>". */
function toolDirs(manifest, base) {
  return toolKeys(manifest, base).map((k) => { const [n, v] = k.split('@'); return path.join('tools', n, v); });
}

/**
 * Are the compilers `base` needs in `tree` exactly the official release? [B-671]
 * Resolves { ok: true } or { ok: false, why } with why a plain sentence.
 */
async function verifyTools(tree, base, resourcesPath) {
  const toolVerify = require('./toolVerify');
  const manifest = readManifest(resourcesPath);
  const keys = toolKeys(manifest, base);
  if (!keys.length) return { ok: false, why: `there is no record of the official compiler for ${base}` };
  for (const k of keys) {
    const [name, ver] = k.split('@');
    const expected = toolVerify.expectedFor(manifest, name, ver);
    if (!expected) return { ok: false, why: `there is no record of the official compiler ${ver} for this computer` };
    const dir = path.join(tree, 'packages', coreVersions.PACKAGE_NAME, 'tools', name, ver);
    if (!fs.existsSync(dir)) return { ok: false, why: `compiler ${ver} is not there` };
    const r = await toolVerify.verifyToolDir(dir, expected);
    if (!r.ok) {
      return { ok: false, why: r.reason === 'mismatch'
        ? `compiler ${ver} is not exactly the official release (${r.files} files, the release has ${r.expectedFiles})`
        : `compiler ${ver} could not be checked (${r.reason})` };
    }
  }
  return { ok: true };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Hard-link a directory tree into place, copying only where a link is impossible (another volume,
// or a filesystem without them). Symlinks are recreated as symlinks.
function _linkTree(src, dst, stats) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(s), d);
    } else if (ent.isDirectory()) {
      _linkTree(s, d, stats);
    } else {
      try { fs.linkSync(s, d); stats.linked++; }
      catch { fs.copyFileSync(s, d); stats.copied++; }
    }
  }
}

/**
 * Build the JMT plugin for `base` from the stock tree holding it.
 *
 * @param baseTree      arduino-cli data directory holding stock `base` (ours or the system one)
 * @param jmtTree       where the JMT tree goes, e.g. <root>/4.6.0-jmt; must not exist
 * @param resourcesPath Studio's resources directory
 * Returns { ok, version, stats } or { ok: false, error }. Never touches baseTree.
 */
function createJmtTree({ base, baseTree, jmtTree, resourcesPath, onLog = () => {} }) {
  base = coreVersions.baseVersion(base);
  const version  = coreVersions.jmtVersionOf(base);
  const manifest = readManifest(resourcesPath);
  const libs     = manifest && manifest.bases && manifest.bases[base];
  if (!libs) return { ok: false, error: `There is no JMT version of Proffieboard Plugin ${base}.` };
  if (!toolDirs(manifest, base).length) return { ok: false, error: `There is no record of the compiler Proffieboard Plugin ${base} uses.` };

  const dirName = coreVersions.installedVersionString(baseTree, base);
  if (!dirName) return { ok: false, error: `Proffieboard Plugin ${base} is not installed, so its JMT version cannot be made.` };
  if (fs.existsSync(jmtTree)) return { ok: false, error: `${jmtTree} already exists.` };

  // The fix replaces specific files. If the stock ones are not exactly the files it was made for,
  // a swapped library could mismatch the rest of the plugin, so refuse rather than guess.
  const hwSrc = path.join(coreVersions.getHardwarePath(baseTree), dirName);
  for (const [lib, want] of Object.entries(libs)) {
    const f = path.join(hwSrc, 'system', 'STM32L4xx', 'Lib', lib);
    let got = null;
    try { got = sha256(f); } catch {}
    if (got !== want.stock) {
      return { ok: false, error: `Proffieboard Plugin ${base} on this computer is not the release the JMT fix was made for ` +
                                 `(${lib} differs), so it was left alone.` };
    }
  }

  const tmp = jmtTree + '.partial';
  fs.rmSync(tmp, { recursive: true, force: true });
  const stats = { linked: 0, copied: 0 };
  try {
    onLog(`Making Proffieboard Plugin ${base} JMT beside ${base}...`, false);
    // Only what this plugin needs. A system Arduino15 also holds other vendors' packages.
    fs.mkdirSync(tmp, { recursive: true });
    for (const ent of fs.readdirSync(baseTree, { withFileTypes: true })) {
      if (ent.isFile() && /^(package_.*\.json|inventory\.yaml)$/.test(ent.name)) {
        fs.copyFileSync(path.join(baseTree, ent.name), path.join(tmp, ent.name));
      }
    }
    const pkgSrc = path.join(baseTree, 'packages', coreVersions.PACKAGE_NAME);
    const pkgDst = path.join(tmp, 'packages', coreVersions.PACKAGE_NAME);
    // Only the compiler(s) this version depends on, and only ones the caller verified against the
    // official release [B-671]. A system tree can hold other compilers; none of them is linked.
    for (const dir of toolDirs(manifest, base)) {
      _linkTree(path.join(pkgSrc, dir), path.join(pkgDst, dir), stats);
    }
    for (const ent of fs.readdirSync(pkgSrc, { withFileTypes: true })) {
      if (ent.isFile()) { fs.mkdirSync(pkgDst, { recursive: true }); fs.copyFileSync(path.join(pkgSrc, ent.name), path.join(pkgDst, ent.name)); }
    }
    const builtin = path.join(baseTree, 'packages', 'builtin');
    if (fs.existsSync(builtin)) _linkTree(builtin, path.join(tmp, 'packages', 'builtin'), stats);

    // The platform itself is a real copy: it is the part that changes.
    const hwDst = path.join(coreVersions.getHardwarePath(tmp), dirName);
    fs.mkdirSync(path.dirname(hwDst), { recursive: true });
    fs.cpSync(hwSrc, hwDst, { recursive: true });
    for (const lib of Object.keys(libs)) {
      const dst = path.join(hwDst, 'system', 'STM32L4xx', 'Lib', lib);
      fs.rmSync(dst, { force: true });   // a fresh file, never a write through a link
      fs.copyFileSync(path.join(_resourcesDir(resourcesPath), base, lib), dst);
    }
    const ptxt = path.join(hwDst, 'platform.txt');
    // The name is what Arduino IDE and arduino-cli show for the plugin, so it says whose fix it carries.
    fs.writeFileSync(ptxt, fs.readFileSync(ptxt, 'utf8')
      .replace(/^version=.*$/m, `version=${version}${REVISION_SUFFIX}`)
      .replace(/^name=(.*)$/m, (_, n) => `name=${n.trim()} (JMT Sabers 4 GB card fix)`));
    fs.writeFileSync(path.join(tmp, 'jmt-plugin.json'), JSON.stringify({
      base, version, revision: manifest.revision || 1, created: new Date().toISOString(),
      libs: Object.fromEntries(Object.entries(libs).map(([k, v]) => [k, v.jmt])),
    }, null, 2));

    // Verify before it becomes visible: recognised as the JMT version, and carrying OUR libraries.
    if (!coreVersions.isVersionInstalled(tmp, version)) throw new Error('the new plugin is not recognised');
    for (const [lib, want] of Object.entries(libs)) {
      if (sha256(path.join(hwDst, 'system', 'STM32L4xx', 'Lib', lib)) !== want.jmt) throw new Error(`${lib} did not copy correctly`);
    }
    if (sha256(path.join(hwSrc, 'system', 'STM32L4xx', 'Lib', Object.keys(libs)[0])) !== Object.values(libs)[0].stock) {
      throw new Error('the stock plugin changed while the JMT version was being made');
    }
    fs.renameSync(tmp, jmtTree);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: false, error: `Could not make Proffieboard Plugin ${base} JMT: ${e.message}` };
  }
  onLog(`Proffieboard Plugin ${base} JMT is ready (${stats.linked} files shared with ${base}, ${stats.copied} copied).`, false);
  return { ok: true, version, stats };
}

module.exports = { NOTE, readManifest, supportedBases, isSupported, createJmtTree, verifyTools, toolKeys, toolDirs, sha256 };
