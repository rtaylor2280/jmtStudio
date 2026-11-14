#!/usr/bin/env node
/**
 * Make the compiler fingerprints a JMT plugin checks before it shares a compiler [B-671].
 *
 * For every compiler a JMT plugin's stock version depends on, and every computer the package index
 * builds it for: download the official archive, refuse it unless it matches the index's own
 * sha256, fingerprint its contents the way toolVerify.js fingerprints an installed folder, and
 * write the result into resources/jmt-plugin/manifest.json under "tools".
 *
 * Development only. Run again when a JMT plugin is added for another stock version.
 *
 *   node scripts/tool-fingerprint.js --index <package_proffieboard_index.json> --cache <dir> [--only <host>]
 */
'use strict';

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { digestOfLines } = require('../toolVerify');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const INDEX = arg('--index');
const CACHE = arg('--cache');
const ONLY  = arg('--only');
const MANIFEST = path.join(__dirname, '..', 'resources', 'jmt-plugin', 'manifest.json');
const PLATFORM_VERSION = { '4.6.0': '4.6', '3.6.0': '3.6' };

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'jmt-studio-tool-fingerprint' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => { out.close(() => { fs.renameSync(tmp, dest); resolve(); }); });
      out.on('error', reject);
    }).on('error', reject);
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// Entries as { path, type: 'file'|'link'|'hardlink'|'dir', sha?, target? }, in archive order.
async function zipEntries(file) {
  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip.async({ file });
  const out = [];
  for (const e of Object.values(await zip.entries())) {
    if (e.isDirectory) { out.push({ path: e.name, type: 'dir' }); continue; }
    const data = await zip.entryData(e.name);
    // A Unix symlink stored in a zip: mode in the high 16 bits of the external attributes.
    const mode = (e.attr >>> 16) & 0o170000;
    if (mode === 0o120000) out.push({ path: e.name, type: 'link', target: data.toString('utf8') });
    else out.push({ path: e.name, type: 'file', sha: crypto.createHash('sha256').update(data).digest('hex') });
  }
  await zip.close();
  return out;
}

async function tarEntries(file) {
  const tar = require('tar');
  const out = [];
  const parser = new tar.Parse({ strict: true });
  parser.on('entry', (e) => {
    const p = e.path;
    if (e.type === 'Directory') { out.push({ path: p, type: 'dir' }); e.resume(); return; }
    if (e.type === 'SymbolicLink') { out.push({ path: p, type: 'link', target: e.linkpath }); e.resume(); return; }
    if (e.type === 'Link') { out.push({ path: p, type: 'hardlink', target: e.linkpath }); e.resume(); return; }
    const h = crypto.createHash('sha256');
    e.on('data', (c) => h.update(c));
    e.on('end', () => out.push({ path: p, type: 'file', sha: h.digest('hex') }));
  });
  let src;
  if (/\.tar\.bz2$|\.tar\.xz$/.test(file)) {
    // 7-Zip decompresses to a plain tar on stdout; the tar parser reads that.
    const sevenZip = require('7zip-bin').path7za;
    const p = spawn(sevenZip, ['x', '-so', file], { stdio: ['ignore', 'pipe', 'inherit'] });
    src = p.stdout;
  } else {
    src = fs.createReadStream(file).pipe(require('zlib').createGunzip());
  }
  await new Promise((resolve, reject) => {
    src.pipe(parser);
    parser.on('end', resolve);
    parser.on('error', reject);
    src.on('error', reject);
  });
  return out;
}

// arduino-cli removes the archive's single top folder; do the same, then make the lines.
function linesOf(entries) {
  const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const items = entries.map((e) => ({ ...e, path: norm(e.path), target: e.target }));
  const tops = new Set(items.map((e) => e.path.split('/')[0]).filter(Boolean));
  const strip = tops.size === 1 && items.some((e) => e.path.includes('/'));
  const top = strip ? [...tops][0] + '/' : '';
  const rel = (p) => (strip && p.startsWith(top) ? p.slice(top.length) : p);
  const shaOf = new Map(items.filter((e) => e.type === 'file').map((e) => [e.path, e.sha]));
  const lines = [];
  for (const e of items) {
    const r = rel(e.path);
    if (!r || e.type === 'dir') continue;
    if (e.type === 'file') lines.push(`f ${r} ${e.sha}`);
    else if (e.type === 'link') lines.push(`l ${r} ${e.target}`);
    else if (e.type === 'hardlink') {
      const sha = shaOf.get(norm(e.target));
      if (!sha) throw new Error(`hard link ${e.path} -> ${e.target}: target not found`);
      lines.push(`f ${r} ${sha}`);
    }
  }
  return lines;
}

async function main() {
  if (!INDEX || !CACHE) { console.error('usage: --index <json> --cache <dir> [--only <host>]'); process.exit(2); }
  fs.mkdirSync(CACHE, { recursive: true });
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const pkg = idx.packages.find((p) => p.name === 'proffieboard');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  manifest.tools = manifest.tools || {};

  for (const base of Object.keys(manifest.bases)) {
    const plat = pkg.platforms.find((p) => p.version === PLATFORM_VERSION[base]);
    if (!plat) throw new Error(`no platform ${base} in the index`);
    // What a JMT plugin of this base links: the stock platform's own compiler dependencies.
    manifest.baseTools = manifest.baseTools || {};
    manifest.baseTools[base] = plat.toolsDependencies
      .filter((d) => d.packager === 'proffieboard')
      .map((d) => `${d.name}@${d.version}`);
    for (const dep of plat.toolsDependencies) {
      if (dep.packager !== 'proffieboard') continue;
      const tool = pkg.tools.find((t) => t.name === dep.name && t.version === dep.version);
      const key = `${dep.name}@${dep.version}`;
      manifest.tools[key] = manifest.tools[key] || {};
      for (const sys of tool.systems) {
        if (ONLY && sys.host !== ONLY) continue;
        const file = path.join(CACHE, sys.archiveFileName);
        const want = sys.checksum.replace(/^SHA-256:/, '').toLowerCase();
        if (!fs.existsSync(file) || (await sha256File(file)) !== want) {
          console.log(`download ${sys.url}`);
          await download(sys.url, file);
        }
        const got = await sha256File(file);
        if (got !== want) throw new Error(`${sys.archiveFileName}: checksum ${got} is not the index's ${want}`);
        const entries = /\.zip$/i.test(file) ? await zipEntries(file) : await tarEntries(file);
        const lines = linesOf(entries);
        manifest.tools[key][sys.host] = { digest: digestOfLines(lines), files: lines.length, archive: sys.archiveFileName, archiveSha256: want };
        console.log(`${key} ${sys.host}: ${lines.length} entries ${manifest.tools[key][sys.host].digest.slice(0, 12)}`);
      }
    }
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
