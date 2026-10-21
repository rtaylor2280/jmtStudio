/**
 * A backup holds no library folders, stores each file once, and restores exactly  [B-498]
 *
 * The zip used to be the library tree itself, so every name a shared file had on disk was written
 * out in full (2.2 GB of library made a 4.9 GB zip), and unzipped by hand it looked like a folder
 * of fonts that could be copied to a card. Now every file's bytes are a numbered object under
 * store/, paths.json maps each library path to its object, and a plainly named file at the top
 * says what the zip is.
 *
 * What has to hold, each checked on a real export and a real restore:
 *   - the raw zip carries no library path at all, only the manifest, the instruction file, the
 *     paths file and numbered objects
 *   - a file with two names on disk is stored once, and both names point at it
 *   - Replace brings both names back as ONE file on disk, and brings an empty folder back
 *   - a merge that takes only the font whose bytes were stored under ANOTHER font still gets them
 *
 * Run: node test/backup-stores-once.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
// Overridable so a control run can point the same assertions at a copy without the change.
const backup = require(process.env.B498_MODULE || path.join(ROOT, 'soundFontBackup.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const tmps = [];
function store() { const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b498s-')); tmps.push(ud); return ud; }
function cleanup() { for (const t of tmps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} } }

function wav(seed) {
  const head = Buffer.from('RIFF....WAVEfmt ', 'ascii');
  const body = Buffer.alloc(4096);
  for (let i = 0; i < body.length; i++) body[i] = (seed * 31 + i * 7) & 0xff;
  return Buffer.concat([head, body]);
}
const ino = (p) => { const s = fs.statSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; };

// Font_A and Font_B share one hum on disk; Font_B also has its own swing and an empty folder.
function buildLibrary(ud) {
  const SF = path.join(ud, 'soundFonts');
  const mk = (name, i) => {
    const dir = path.join(SF, 'library', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      schemaVersion: '1', name, entryUuid: `c0000000-0000-4000-9000-00000000000${i}`,
      createdAt: '2026-01-01T00:00:00Z',
    }, null, 2));
    return dir;
  };
  const a = mk('Font_A', 0);
  const b = mk('Font_B', 1);
  fs.writeFileSync(path.join(a, 'hum.wav'), wav(1));
  fs.linkSync(path.join(a, 'hum.wav'), path.join(b, 'hum.wav'));
  fs.writeFileSync(path.join(b, 'swing.wav'), wav(2));
  fs.mkdirSync(path.join(b, 'tracks'));
  return { SF, a, b };
}

const rawNames = async (dest) => {
  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip.async({ file: dest, skipEntryNameValidation: true });
  try { return Object.keys(await zip.entries()); }
  finally { await zip.close(); }
};
const rawPaths = async (dest) => {
  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip.async({ file: dest, skipEntryNameValidation: true });
  try { return JSON.parse((await zip.entryData('paths.json')).toString('utf8')); }
  catch { return null; }
  finally { await zip.close(); }
};

(async () => {

{
  const ud = store();
  const { a, b } = buildLibrary(ud);
  ok('precondition: the two hums are one file on disk', ino(path.join(a, 'hum.wav')) === ino(path.join(b, 'hum.wav')));
}

// ── what the raw zip holds ────────────────────────────────────────────────
{
  const ud = store();
  buildLibrary(ud);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });
  const names = await rawNames(dest);
  const readme = names.find((n) => /^READ ME - /.test(n));
  ok('NO LIBRARY PATH IS IN THE RAW ZIP',
     names.every((n) => n === 'manifest.json' || n === 'paths.json' || n === readme || /^store\/\d+\.jmtdata$/.test(n)),
     names.join(', '));
  ok('the instruction file is at the top, its name saying what to do',
     !!readme && /Restore it from JMT Studio, do not unzip it/.test(readme), String(readme));

  const idx = await rawPaths(dest);
  const objects = names.filter((n) => n.startsWith('store/'));
  ok('the paths file names both hums', !!idx && !!idx.files['library/Font_A/hum.wav'] && !!idx.files['library/Font_B/hum.wav']);
  ok('A FILE WITH TWO NAMES IS STORED ONCE',
     !!idx && idx.files['library/Font_A/hum.wav'] === idx.files['library/Font_B/hum.wav'],
     idx && `${idx.files['library/Font_A/hum.wav']} vs ${idx.files['library/Font_B/hum.wav']}`);
  ok('every object is used, and nothing is stored twice',
     !!idx && objects.length === new Set(Object.values(idx.files)).size,
     idx && `${objects.length} objects, ${new Set(Object.values(idx.files)).size} distinct`);
  ok('the empty folder is listed', !!idx && idx.dirs.includes('library/Font_B/tracks'));

  const inspect = await backup.inspectBackup(dest);
  ok('it inspects as two fonts', inspect.ok && inspect.observed.counts.library === 2,
     JSON.stringify(inspect.observed && inspect.observed.counts));
}

// ── what the person sees: the instruction text and the bar ────────────────
{
  const ud = store();
  buildLibrary(ud);
  const dest = path.join(ud, 'out.zip');
  const ticks = [];
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test', onProgress: (p) => ticks.push(p) });
  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip.async({ file: dest, skipEntryNameValidation: true });
  let text = '';
  try {
    const name = Object.keys(await zip.entries()).find((n) => /^READ ME - /.test(n));
    text = (await zip.entryData(name)).toString('utf8');
  } finally { await zip.close(); }
  ok('the instruction file dates itself in words, not as a timestamp',
     /on [A-Z][a-z]+ \d{1,2}, \d{4}\./.test(text) && !/T\d\d:\d\d/.test(text), text.split('\n').pop() || text);

  // Font_B's hum is a second name for Font_A's: stored once, so the bar must not count it twice.
  // (Not "ends exactly at its total": the export stamps each meta.json after the size was taken,
  // so those arrive a few hundred bytes heavier than counted. That predates this format.)
  const withTotal = ticks.filter((t) => t.totalBytes);
  const last = withTotal[withTotal.length - 1];
  const onDisk = wav(1).length + wav(2).length;
  const at = withTotal.findIndex((t) => t.currentItem === 'library/Font_B/hum.wav');
  ok('A SECOND NAME ADDS NOTHING TO THE BAR',
     at > 0 && withTotal[at].processedBytes === withTotal[at - 1].processedBytes,
     at > 0 ? `${withTotal[at - 1].processedBytes} -> ${withTotal[at].processedBytes}` : 'no tick for it');
  const man = await (async () => {
    const z = new (require('node-stream-zip').async)({ file: dest, skipEntryNameValidation: true });
    try { return JSON.parse((await z.entryData('manifest.json')).toString('utf8')); } finally { await z.close(); }
  })();
  ok('the manifest records the on-disk figure, a shared file counted once',
     man.totals.onDiskBytes === man.totals.totalBytes - wav(1).length, JSON.stringify(man.totals));
  ok('and that total is the bytes on disk, not the sum of every name',
     !!last && last.totalBytes - onDisk < 4096 && last.totalBytes < onDisk + wav(1).length,
     last && `total ${last.totalBytes}, sound bytes on disk ${onDisk}`);
}

// ── Replace brings it back exactly ────────────────────────────────────────
{
  const ud = store();
  const { SF, a, b } = buildLibrary(ud);
  const dest = path.join(ud, 'out.zip');
  await backup.exportBackup({ userData: ud, destPath: dest, appVersion: 'test' });
  fs.rmSync(SF, { recursive: true, force: true });
  await backup.applyReplace({ userData: ud, zipPath: dest });

  const have = (p) => fs.existsSync(p);
  ok('both hums are back', have(path.join(a, 'hum.wav')) && have(path.join(b, 'hum.wav')));
  ok('with their bytes', have(path.join(b, 'hum.wav')) && fs.readFileSync(path.join(b, 'hum.wav')).equals(wav(1)));
  ok('AS ONE FILE ON DISK, as they were',
     have(path.join(a, 'hum.wav')) && have(path.join(b, 'hum.wav')) && ino(path.join(a, 'hum.wav')) === ino(path.join(b, 'hum.wav')));
  ok('the unshared file is back', have(path.join(b, 'swing.wav')) && fs.readFileSync(path.join(b, 'swing.wav')).equals(wav(2)));
  ok('the empty folder is back', have(path.join(b, 'tracks')) && fs.statSync(path.join(b, 'tracks')).isDirectory());
  ok('the instruction file does not land in the library', !fs.readdirSync(SF).some((n) => /^READ ME/.test(n)));
}

// ── a merge of only the font whose bytes sit under another ────────────────
{
  const a0 = store();
  buildLibrary(a0);
  const dest = path.join(a0, 'out.zip');
  await backup.exportBackup({ userData: a0, destPath: dest, appVersion: 'test' });
  const idx = await rawPaths(dest);
  ok('precondition: the shared hum was stored under Font_A, not Font_B',
     !!idx && idx.files['library/Font_B/hum.wav'] === idx.files['library/Font_A/hum.wav']);

  const ud = store();
  const r = await backup.applyMerge({ userData: ud, zipPath: dest,
    plan: { library: { Font_B: 'install' }, common: {}, sources: {} } });
  const B = path.join(ud, 'soundFonts', 'library', 'Font_B');
  ok('the merge took Font_B', r && r.counts && r.counts.library.added === 1, JSON.stringify(r && r.counts));
  ok('AND ITS HUM CAME WITH IT, from the object stored under Font_A',
     fs.existsSync(path.join(B, 'hum.wav')) && fs.readFileSync(path.join(B, 'hum.wav')).equals(wav(1)));
  ok('Font_A was not brought along', !fs.existsSync(path.join(ud, 'soundFonts', 'library', 'Font_A')));
}

cleanup();
console.log(failures === 0 ? '\nOK' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

})().catch(err => { cleanup(); console.error(err); process.exit(1); });
