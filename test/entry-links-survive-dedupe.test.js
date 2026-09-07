// [B-334] Entries must link to canonical names, which means dedup runs BEFORE
// entry creation. The bug this guards against: entries hardlinked to source
// names, then the within-source dedup rewrote those names onto one canonical
// inode, leaving every affected entry file the last holder of the old bytes -
// a lone full copy (nlink=1), silently outside the pool. On a real four-board-
// variant vendor font that orphaned the entire entry (75/75 files, measured on
// disk 2026-09-07). The close-out numbers reconcile among themselves either
// way, which is why only an ON-DISK inode check can see this.
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');
const E = require('../soundFontEntries.js');
const B = require('../soundFontBulkImport.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
function wav(body) {
  // Minimal valid PCM WAV around distinguishable payloads.
  const data = Buffer.alloc(64 * 1024, body);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
function put(root, rel, buf) {
  const abs = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-b334-${n}-`));
function walkWavs(dir) {
  const out = []; const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let es; try { es = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile() && /\.wav$/i.test(e.name)) out.push(abs);
    }
  }
  return out;
}

// A font whose files are heavily duplicated INSIDE the source (the board-variant
// shape): two "variants" carrying identical wavs, plus one unique file each.
// Internal duplication is what arms the dedup pass; without it the pass is a
// no-op and the old bug was invisible.
function makeVariantSource(root, name) {
  for (const flavor of [`${name}/${name} - Proffie`, `${name}/${name} - CFX`]) {
    put(root, `${flavor}/hum.wav`, wav('H'));
    put(root, `${flavor}/out.wav`, wav('O'));
    put(root, `${flavor}/in.wav`, wav('I'));
    put(root, `${flavor}/clsh1.wav`, wav('C'));
    put(root, `${flavor}/swng1.wav`, wav('S'));
    put(root, `${flavor}/config.ini`, Buffer.from('volume=1000\r\n'));
  }
}

(async () => {
  {
    console.log('bulk import of an internally-duplicated source leaves entry files POOLED');
    const userData = tmp('ud');
    const set = tmp('set');
    makeVariantSource(set, 'VariantFont');
    const scan = await B.scanForBulkImport({ rootDir: set });
    check('scan finds the source', scan.ok && scan.plan.sources.length >= 1,
      JSON.stringify(scan.plan && scan.plan.sources));
    const run = await B.runBulkImport({ plan: scan.plan, userData }, {});
    const sum = run.summary;
    check('it imported', sum.imported.length === 1 && sum.failed.length === 0,
      JSON.stringify({ f: sum.failed, i: sum.imported.length }));
    check('the dedup pass genuinely fired (the case is armed)',
      (sum.imported[0].dedupSaved || 0) > 0, JSON.stringify(sum.imported[0]));
    const libRoot = path.join(userData, 'soundFonts', 'library');
    const entryDirs = fs.readdirSync(libRoot);
    check('an entry exists', entryDirs.length >= 1, entryDirs.join());
    for (const d of entryDirs) {
      const wavs = walkWavs(path.join(libRoot, d));
      const lone = wavs.filter(f => fs.statSync(f).nlink < 2);
      check(`⭐ every wav in entry "${d}" shares its inode (none orphaned)`,
        lone.length === 0,
        `${lone.length} of ${wavs.length} lone: ${lone.map(f => path.basename(f)).join(', ')}`);
    }
  }

  {
    console.log('the single-flow order (dedup, then createEntry) links to canonicals');
    const userData = tmp('ud2');
    const src = tmp('src2');
    makeVariantSource(src, 'SoloVariant');
    const imp = await S.importSource({
      userData, sourcePath: path.join(src, 'SoloVariant'), originalName: 'SoloVariant', metadata: {},
    });
    check('imported', imp.ok && !imp.isDuplicate, imp.error);
    // The fixed renderer order: optimize the source FIRST...
    await S.ensureSourceManifest(userData, imp.uuid, () => {});
    const dd = await S.dedupeSource(userData, imp.uuid, () => {});
    check('dedup reclaimed the duplicate variant', !!(dd && dd.deduped && dd.savedBytes > 0),
      JSON.stringify(dd));
    // ...then create the entry.
    // A picked folder's CONTENTS become the source tree root (no wrapper dir),
    // so the candidate path starts at the variant folder itself.
    const er = await E.createEntry({
      userData, sourceUuid: imp.uuid,
      candidate: { path: 'SoloVariant - Proffie' }, name: 'SoloVariant',
    });
    check('entry created', !!(er && er.ok), er && er.error);
    const wavs = walkWavs(path.join(userData, 'soundFonts', 'library', 'SoloVariant'));
    const lone = wavs.filter(f => fs.statSync(f).nlink < 2);
    check('⭐ every entry wav shares its inode with the deduped source',
      wavs.length > 0 && lone.length === 0,
      `${lone.length} of ${wavs.length} lone`);
  }

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error('SUITE ERROR:', e); process.exit(1); });
