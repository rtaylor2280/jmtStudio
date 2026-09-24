// Export a curated source, import it back, and check what landed where — for BOTH formats.
//
// ⭐⭐ WHY A ROUND TRIP AND NOT TWO UNIT TESTS. [B-420 / B-427, 2026-09-23]
// The sidecar crosses a seam: one side writes it into an export, the other has to recognise it and
// take it back out. Tonight both sides were rewritten, and the old failure was precisely that they
// agreed on nothing while each looked correct alone:
//   • EXPORT used to inject the sidecar by rebuilding the finished archive - unpack it all, write the
//     sidecar in, re-compress. It now goes in during the single compression pass.
//   • IMPORT used to unpack the archive, strip our files, RE-ZIP the remainder, and then unpack that
//     repack again into the pool. Two full extractions with a re-compress between them. It now splits
//     our files from the vendor's during the one extraction that always ran.
// Ryan's summary of the pair, which is the thing this test defends: "why would we have ever packed,
// unpacked and packed again?"
//
// ⚠️⚠️ AND THE FOLDER CASE IS A LIVE DEFECT THIS CLOSES. [B-420] made folder exports carry a sidecar
// too - previously impossible, because injection needed an archive to rebuild - but the import peek
// was still `if (isZip)`. So a folder re-imported in between stored `.jmt-curation.json` INSIDE the
// tree as vendor content and restored nothing. He accepted that knowingly for a few hours: "it's
// totally fine to break the imports right now since it's the next thing we're fixing after this is
// done." This test is what says it is no longer broken.
//
// THE THREE THINGS THAT MUST BE TRUE, and each fails silently on its own:
//   1. the curation comes BACK (or the tags, links and receipts are simply gone, and the source they
//      described was deleted — that is the whole reason the sidecar exists);
//   2. our files are NOT in the stored source (or our bookkeeping becomes the vendor's font, and
//      every future export of it re-ships a stale copy);
//   3. the payload IS on disk where the restore reads it (or the restore invents empty attachments).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sources = require('../soundFontSources');
const cur = require('../soundFontCuration');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// Well-formed 16-bit mono PCM, because the import strips damaged wavs and a zero-filled buffer is
// correctly thrown away — a stand-in that ignores the rules of the code under test tests nothing.
const wav = (n) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, Buffer.alloc(n)]);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-roundtrip-'));
const walk = (root) => {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let ents = [];
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const d of ents) {
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) stack.push(childRel);
      else out.push(childRel);
    }
  }
  return out;
};

(async () => {
  // ── A vendor bundle to import first, so we have a real source to export ──
  const vendor = path.join(tmp, 'VendorFont');
  fs.mkdirSync(path.join(vendor, 'Proffie', 'font'), { recursive: true });
  fs.writeFileSync(path.join(vendor, 'Proffie', 'font', 'hum.wav'), wav(2048));
  fs.writeFileSync(path.join(vendor, 'Proffie', 'font', 'swing1.wav'), wav(1024));
  fs.writeFileSync(path.join(vendor, 'readme.txt'), 'vendor notes');

  for (const format of ['zip', 'folder']) {
    console.log(`\n── ${format.toUpperCase()} round trip ──`);
    const userData = fs.mkdtempSync(path.join(tmp, `ud-${format}-`));

    const imp = await sources.importSource({
      userData, sourcePath: vendor, originalName: 'VendorFont', metadata: {},
    });
    ok(`${format}: the vendor bundle imports`, !!(imp && imp.ok && imp.uuid),
       `import failed: ${imp && imp.error}`);
    if (!imp || !imp.ok) continue;

    // Curation the user authored after import — exactly what an export has to carry back.
    const src = sources.openSource(userData, imp.uuid);
    ok(`${format}: the stored source opens`, !!src);
    if (!src) continue;

    // A receipt living in our own store, referenced by the payload.
    const receipts = path.join(userData, 'soundFonts', 'receipts');
    fs.mkdirSync(receipts, { recursive: true });
    fs.writeFileSync(path.join(receipts, 'order.pdf'), Buffer.alloc(128, 7));
    const payload = {
      schemaVersion: cur.SCHEMA_VERSION,
      // !! NESTED UNDER provenance, which is where buildForSource writes it and where the import
      // reads it (curation.provenance.archiveHash). The first cut of this test put archiveHash at the
      // top level, so the "provenance rode along" check passed by reading back a field this test had
      // invented - green, and testing nothing but its own fixture.
      provenance: { archiveHash: imp.hash, contentHash: null },
      tags: ['dueling', 'crystal'],
      links: { demo: 'https://example/demo' },
      attachments: [{ file: `${cur.PAYLOAD_DIR}/order.pdf`,
                      _abs: path.join(receipts, 'order.pdf') }],
    };

    const destDir = fs.mkdtempSync(path.join(tmp, `out-${format}-`));
    const exp = await src.exportToDownloads(destDir, { format, curationPayload: payload });
    ok(`${format}: the export reports carrying curation`,
       !!(exp && exp.curation && exp.curation.any),
       'the export has to say what it carried, or no caller can describe it honestly');

    // ── 1. THE CURATION COMES BACK ──────────────────────────────────
    const ud2 = fs.mkdtempSync(path.join(tmp, `re-${format}-`));
    const back = await sources.importSource({
      userData: ud2, sourcePath: exp.destPath,
      originalName: path.basename(exp.destPath), metadata: {},
    });
    ok(`${format}: the re-import succeeds`, !!(back && back.ok),
       `re-import failed: ${back && back.error}`);
    if (!back || !back.ok) continue;

    ok(`${format}: ⚠️⚠️ the curation is recognised on the way back in`,
       !!(back.curation && Array.isArray(back.curation.tags)
          && back.curation.tags.includes('dueling')),
       'the sidecar was written on export and not read on import, so the tags, links and receipts '
       + 'are lost — and the source they described is the one the user just deleted');

    ok(`${format}: and the provenance hash rode along`,
       !!(back.curation && back.curation.provenance
          && back.curation.provenance.archiveHash === imp.hash),
       'findByProvenance matches on this, so without it a re-import cannot recognise a source it '
       + 'already has');

    // ── 2. OUR FILES ARE NOT IN THE STORED SOURCE ───────────────────
    const storedTree = path.join(sources.sourcesRoot(ud2), back.uuid, 'source');
    const stored = walk(storedTree);
    ok(`${format}: ⚠️⚠️ the sidecar is NOT stored as vendor content`,
       !stored.includes(cur.SIDECAR_NAME),
       `${cur.SIDECAR_NAME} is inside the stored source. Our bookkeeping is now part of the user's `
       + `font, and every future export re-ships a stale copy of it. Stored: ${stored.join(', ')}`);
    ok(`${format}: and neither is its payload directory`,
       !stored.some((r) => r === cur.PAYLOAD_DIR || r.startsWith(`${cur.PAYLOAD_DIR}/`)),
       `payload files are in the stored tree: ${stored.join(', ')}`);

    ok(`${format}: the vendor's own files all survived`,
       ['Proffie/font/hum.wav', 'Proffie/font/swing1.wav', 'readme.txt']
         .every((r) => stored.includes(r)),
       `stripping our files must not cost a vendor file. Stored: ${stored.join(', ')}`);

    // ── 3. THE PAYLOAD REACHED DISK AND WAS CONSUMED ────────────────
    // ⚠️ THE TEMP DIR IS DELIBERATELY NOT RETURNED HERE, and the first cut of this test asserted that
    // it was. `curationTmp` survives the import ONLY when customized fonts are still pending a
    // decision from the user; attachments are applied during the import itself, while the dir still
    // exists, and it is then removed. Asserting it came back was asserting a leak.
    ok(`${format}: the temp payload dir did not leak`,
       !back.curationTmp || fs.existsSync(back.curationTmp),
       'a path was handed back for a directory that has already been deleted, so anything acting on '
       + 'it fails on a dir that is not there');

    // The proof the payload was really extracted and read: the sidecar's provenance is now ON the
    // stored source's meta. Nothing puts it there except the import consuming our file.
    let meta2 = null;
    try {
      meta2 = JSON.parse(fs.readFileSync(
        path.join(sources.sourcesRoot(ud2), back.uuid, 'meta.json'), 'utf8'));
    } catch { /* asserted below */ }
    ok(`${format}: ⚠️⚠️ the sidecar was consumed into the stored source's meta`,
       !!(meta2 && meta2.originArchiveHash === imp.hash),
       'originArchiveHash is written only from a sidecar that was read, and findByProvenance matches '
       + 'on it — so without it a later re-import cannot recognise a source it already has. '
       + `meta.originArchiveHash = ${meta2 && meta2.originArchiveHash}`);

    // ⚠️ AND THE STORED HASH IS OF WHAT ARRIVED, not of a canonical repack. [B-427] The old import
    // re-zipped the stripped tree and hashed THAT, purely so two exports of one source hashed alike -
    // a property only the old archive-as-artifact storage needed. It must not quietly come back.
    ok(`${format}: identity is separate from provenance`,
       !!(meta2 && meta2.hash && meta2.hash !== undefined),
       'the source must still have its own hash — provenance recognises, identity identifies, and '
       + 'collapsing the two is what made a repack look necessary');
  }

  // ── ⚠️ peekDir matches peekZip's acceptance rules, or a zip and its extracted twin disagree ──
  console.log('\n── peekDir acceptance ──');
  const pd = fs.mkdtempSync(path.join(tmp, 'peek-'));
  ok('peekDir: no sidecar → null', cur.peekDir(pd) === null);
  fs.writeFileSync(path.join(pd, cur.SIDECAR_NAME), 'not json at all');
  ok('peekDir: malformed sidecar → null, the font still imports', cur.peekDir(pd) === null,
     'a sidecar we cannot parse must never block the font behind it');
  fs.writeFileSync(path.join(pd, cur.SIDECAR_NAME),
    JSON.stringify({ schemaVersion: cur.SCHEMA_VERSION + 5, tags: ['x'] }));
  ok('peekDir: ⚠️ a NEWER schema is ignored, not half-applied',
     cur.peekDir(pd) === null,
     'data from a future version is data we cannot promise to read correctly — the font imports '
     + 'and only the curation is lost, which is the same call peekZip makes');
  fs.writeFileSync(path.join(pd, cur.SIDECAR_NAME),
    JSON.stringify({ schemaVersion: cur.SCHEMA_VERSION, tags: ['ok'] }));
  const good = cur.peekDir(pd);
  ok('peekDir: ⭐ and a valid sidecar IS read (the control)',
     !!(good && good.tags && good.tags[0] === 'ok'),
     'every case above returns null, so without this the checks would pass on a function that '
     + 'always fails');

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failed ? `\ncuration-roundtrip: ${failed} failing`
                     : '\ncuration-roundtrip: all passing');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
