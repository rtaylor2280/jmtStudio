/**
 * The content pool and the library meta survive a backup round trip  [B-498]
 *
 * A Replace renames the whole soundFonts root aside and rebuilds it from the zip, so anything the
 * zip does not carry comes back empty. The export walked a fixed list of buckets, and pool/ and
 * the root `_jmt_library_meta.json` were not on it: a restored library had an empty pool and no
 * meta. The pool is where a user looks for a sound to reuse, so emptying it loses something they
 * cannot get back from the fonts.
 *
 * The pooled file must also come back SHARED with the font file it was pooled from, not as a
 * second copy, or the restore doubles the bytes the pool exists to save.
 *
 * REAL ROUND TRIPS through exportBackup / inspectBackup / surveyMerge / applyReplace.
 *
 * Run: node test/pool-survives-backup.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
// Overridable so a control run can point the same assertions at a copy without the fix.
const backup = require(process.env.B498_MODULE || path.join(ROOT, 'soundFontBackup.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const tmps = [];
function store() { const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b498-')); tmps.push(ud); return ud; }
function cleanup() { for (const t of tmps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} } }

function wav(seed) {
  const head = Buffer.from('RIFF....WAVEfmt ', 'ascii');
  const body = Buffer.alloc(512);
  for (let i = 0; i < body.length; i++) body[i] = (seed * 31 + i * 7) & 0xff;
  return Buffer.concat([head, body]);
}

// One font, its hum pooled under its own name (a hard link, as the pool stores it), the pool
// index, and the library meta.
function buildLibrary(ud) {
  const SF = path.join(ud, 'soundFonts');
  const dir = path.join(SF, 'library', 'Font_0');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'hum.wav'), wav(1));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    schemaVersion: '1', name: 'Font_0',
    entryUuid: 'c0000000-0000-4000-9000-000000000000', createdAt: '2026-01-01T00:00:00Z',
  }, null, 2));
  const pool = path.join(SF, 'pool');
  fs.mkdirSync(pool, { recursive: true });
  fs.linkSync(path.join(dir, 'hum.wav'), path.join(pool, 'hum.wav'));
  fs.writeFileSync(path.join(pool, '.jmt-pool.json'),
    JSON.stringify({ version: 1, files: { abc: { name: 'hum.wav', size: 528 } } }, null, 2));
  fs.writeFileSync(path.join(SF, '_jmt_library_meta.json'),
    JSON.stringify({ createdAt: '2026-01-01T00:00:00Z', schemaVersion: 1 }, null, 2));
  return { SF, pool, hum: path.join(dir, 'hum.wav') };
}

const zipNames = async (dest) => {
  // Read the way the app reads it: the zip stores numbered objects, the paths are the library's.
  const zip = await backup.openBackupZip(dest, { skipEntryNameValidation: true });
  try { return Object.keys(await zip.entries()); }
  finally { await zip.close(); }
};
const ino = (p) => { const s = fs.statSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; };

(async () => {

{
  const ud = store();
  const { pool, hum } = buildLibrary(ud);
  ok('precondition: the pooled file shares one copy with the font file',
     ino(path.join(pool, 'hum.wav')) === ino(hum));
}

// ── export carries them ───────────────────────────────────────────────────
{
  const ud = store();
  buildLibrary(ud);
  const dest = path.join(ud, 'out.zip');
  const r = await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });
  const got = await zipNames(dest);
  ok('the archive carries the pooled file', got.includes('pool/hum.wav'), got.join(', '));
  ok('and the pool index', got.includes('pool/.jmt-pool.json'), got.join(', '));
  ok('and the library meta', got.includes('_jmt_library_meta.json'), got.join(', '));
  ok('the font is still carried', got.some((g) => g.startsWith('library/Font_0/')));
  ok('the pool is not counted as a font', r.manifest.counts.library === 1,
     `counts.library=${r.manifest.counts.library}`);
}

// ── it does not read as an item anywhere a zip is counted ─────────────────
{
  const ud = store();
  buildLibrary(ud);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });
  const ins = await backup.inspectBackup(dest);
  ok('inspect counts the real font only', ins.ok && ins.observed.counts.library === 1,
     `inspect reported ${ins.ok ? ins.observed.counts.library : ins.error}`);
  const sv = await backup.surveyMerge({ userData: store(), zipPath: dest });
  const added = [...(sv.library.add || []), ...(sv.common.add || []), ...(sv.sources.add || [])]
    .map((a) => a.name || a.id);
  ok('the merge survey offers the real font only', added.length === 1, `survey offered: ${added.join(', ')}`);
}

// ── replace puts them back, shared ────────────────────────────────────────
{
  const ud = store();
  const { SF, pool, hum } = buildLibrary(ud);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });
  fs.rmSync(SF, { recursive: true, force: true });

  await backup.applyReplace({ userData: ud, zipPath: dest });
  ok('THE POOLED FILE IS BACK', fs.existsSync(path.join(pool, 'hum.wav')));
  ok('with its bytes', fs.existsSync(path.join(pool, 'hum.wav'))
     && fs.readFileSync(path.join(pool, 'hum.wav')).equals(wav(1)));
  ok('and shares one copy with the font file again',
     fs.existsSync(path.join(pool, 'hum.wav')) && ino(path.join(pool, 'hum.wav')) === ino(hum),
     'a second copy doubles the bytes the pool exists to save');
  ok('the pool index is back', fs.existsSync(path.join(pool, '.jmt-pool.json')));
  ok('the library meta is back', fs.existsSync(path.join(SF, '_jmt_library_meta.json')));
}

// ── replace over a library that is still there ────────────────────────────
// The unchanged font is moved across, not extracted, so the pooled file is the only name of its
// object written from the zip. It still has to share one copy with the font file.
{
  const ud = store();
  const { SF, pool, hum } = buildLibrary(ud);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });
  fs.rmSync(path.join(SF, 'pool'), { recursive: true, force: true });
  await backup.applyReplace({ userData: ud, zipPath: dest });
  ok('precondition: the font is still there', fs.existsSync(hum));
  ok('the pooled file is back over a kept library', fs.existsSync(path.join(pool, 'hum.wav')));
  ok('AND SHARES ONE COPY WITH THE KEPT FONT FILE',
     fs.existsSync(path.join(pool, 'hum.wav')) && ino(path.join(pool, 'hum.wav')) === ino(hum),
     'the font was moved, not extracted, so nothing else in this read wrote its bytes');
}

cleanup();
console.log(failures === 0 ? '\nOK' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

})().catch(err => { cleanup(); console.error(err); process.exit(1); });
