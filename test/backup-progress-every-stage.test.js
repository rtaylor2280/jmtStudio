/**
 * A backup reports every stage before the write, in an honest unit for each  [BUG-023]
 *
 * The first minutes of a large backup showed only an elapsed clock, then "0 B of 14.93 GB" with
 * a name, and the main process was held for 2 m 13 s. His words: "it's not actually doing
 * anything." What has to hold:
 *   - the survey reports files so far (no total: it is the first pass) and returns fileCount
 *     and bytes per item
 *   - the stages arrive in order: reading, checking, preparing, then the write
 *   - checking counts files against a total; preparing counts BYTES against a total, and both
 *     reach their total
 *   - the backup door turns each stage into its own line and hands the write back to the bytes
 *
 * Run: node test/backup-progress-every-stage.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const backup = require(process.env.BUG023_MODULE || path.join(ROOT, 'soundFontBackup.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

function wav(seed, n) {
  const head = Buffer.from('RIFF....WAVEfmt ', 'ascii');
  const body = Buffer.alloc(n);
  for (let i = 0; i < body.length; i++) body[i] = (seed * 31 + i * 7) & 0xff;
  return Buffer.concat([head, body]);
}

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'bug023-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bug023o-'));
  try {
    const SF = path.join(ud, 'soundFonts');
    for (const [i, name] of ['Font_A', 'Font_B', 'Font_C'].entries()) {
      const dir = path.join(SF, 'library', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
        schemaVersion: '1', name, entryUuid: `d0000000-0000-4000-9000-00000000000${i}`,
        createdAt: '2026-01-01T00:00:00Z',
      }));
      // Very different sizes, the case a per-item count gets wrong.
      fs.writeFileSync(path.join(dir, 'hum.wav'), wav(i + 1, i === 2 ? 200000 : 2000));
      fs.writeFileSync(path.join(dir, 'swing.wav'), wav(i + 7, 1000));
    }

    const seen = [];
    const s = await backup.surveyLibraryAsync(ud, { onItem: (p) => seen.push(p) });
    ok('the survey returns a file count', s.fileCount >= 6, `fileCount=${s.fileCount}`);
    ok('the survey returns bytes per item', s.itemBytes && s.itemBytes['library/Font_C'] > 200000,
      JSON.stringify(s.itemBytes));
    ok('the survey reports files so far, with no total',
      seen.length >= 3 && seen.every((p) => typeof p.files === 'number' && p.total === undefined)
        && seen[seen.length - 1].files === s.fileCount,
      JSON.stringify(seen));

    const ticks = [];
    await backup.exportBackup({ userData: ud, destPath: path.join(out, 'b.zip'), appVersion: 'test',
                                onProgress: (p) => ticks.push(p) });
    const order = [];
    for (const t of ticks) {
      const st = t.stage || (typeof t.processedBytes === 'number' ? 'writing' : 'other');
      if (order[order.length - 1] !== st) order.push(st);
    }
    const want = ['reading', 'checking', 'preparing', 'writing'];
    const firstOf = want.map((w) => order.indexOf(w));
    ok('the stages arrive in order: reading, checking, preparing, writing',
      firstOf.every((x) => x >= 0) && firstOf.every((x, i) => i === 0 || x > firstOf[i - 1]),
      order.join(' > '));

    const chk = ticks.filter((t) => t.stage === 'checking');
    const lastChk = chk[chk.length - 1] || {};
    ok('checking counts files against a total and reaches it',
      lastChk.filesTotal > 0 && lastChk.files === lastChk.filesTotal,
      JSON.stringify(lastChk));

    const prep = ticks.filter((t) => t.stage === 'preparing');
    const lastPrep = prep[prep.length - 1] || {};
    ok('preparing counts bytes against a total and reaches it',
      lastPrep.prepareTotalBytes > 200000 && lastPrep.preparedBytes === lastPrep.prepareTotalBytes,
      JSON.stringify(lastPrep));
    const prepBytes = prep.map((t) => t.preparedBytes);
    ok('preparing never goes backwards', prepBytes.every((v, i) => i === 0 || v >= prepBytes[i - 1]),
      prepBytes.join(','));

    // Sound is stored, text is compressed. Method 0 is store, 8 is deflate. The archive holds
    // numbered objects, so each is matched to its library path through paths.json.
    {
      const SZ = require('node-stream-zip');
      const z = new SZ.async({ file: path.join(out, 'b.zip') });
      const entries = await z.entries();
      const paths = JSON.parse((await z.entryData('paths.json')).toString()).files || {};
      await z.close();
      const methodOf = (rel) => { const o = paths[rel]; return o && entries[o] ? entries[o].method : null; };
      const wavRels = Object.keys(paths).filter((r) => /\.wav$/i.test(r));
      const metaRels = Object.keys(paths).filter((r) => /meta\.json$/i.test(r));
      ok('every wav is stored, not compressed', wavRels.length >= 6 && wavRels.every((r) => methodOf(r) === 0),
        wavRels.map((r) => `${r}=${methodOf(r)}`).join(', '));
      ok('text is still compressed', metaRels.length >= 1 && metaRels.every((r) => methodOf(r) === 8),
        metaRels.map((r) => `${r}=${methodOf(r)}`).join(', '));
    }

    // A program disguised as a wav, with a second name in another font, is refused under BOTH
    // names: the carry check is made per name, never per stored file.
    {
      const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bug023b-'));
      try {
        const mk = (name) => {
          const dir = path.join(ud2, 'soundFonts', 'library', name);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: '1', name }));
          fs.writeFileSync(path.join(dir, 'hum.wav'), wav(3, 3000));
          return dir;
        };
        const a = mk('Font_X'); const b = mk('Font_Y');
        const prog = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0x90)]);
        fs.writeFileSync(path.join(a, 'boot.wav'), prog);
        fs.linkSync(path.join(a, 'boot.wav'), path.join(b, 'boot.wav'));
        const r = await backup.exportBackup({ userData: ud2, destPath: path.join(out, 'c.zip'), appVersion: 'test' });
        const refusedNames = (r.refused || []).map((x) => `${x._id}/${x._itemRel}`).sort();
        ok('a linked disguised program is refused under both names',
          refusedNames.includes('Font_X/boot.wav') && refusedNames.includes('Font_Y/boot.wav'),
          JSON.stringify(refusedNames));
      } finally { try { fs.rmSync(ud2, { recursive: true, force: true }); } catch {} }
    }

    // The door: one line per stage, and the write handed back to the bytes.
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    const d0 = html.indexOf('const _sfRunExportBackup = async');
    const door = d0 >= 0 ? html.slice(d0, html.indexOf('produce: async', d0)) : '';
    ok('the door names reading with files so far', /p\.stage === 'reading'[\s\S]*?Measuring your library/.test(door));
    ok('the door counts checking in files', /p\.stage === 'checking'[\s\S]*?Screening files/.test(door));
    ok('the door counts preparing in bytes', /p\.stage === 'preparing'[\s\S]*?preparedBytes/.test(door));
    ok('the write names itself and clears the stage bar', /label: _wt \? `Writing/.test(door) && /frac: null/.test(door));
    ok('the runner lets a null clear the line and the bar',
      /if \(p\.label === null\) labelOverride = null;/.test(html) && /if \(p\.frac === null\) fracOverride = null;/.test(html));
  } finally {
    for (const t of [ud, out]) { try { fs.rmSync(t, { recursive: true, force: true }); } catch {} }
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
