// Does the curation sidecar ACTUALLY end up inside the exported archive?
//
// ⭐⭐ WHY THIS IS AN INTEGRATION TEST AND NOT A WIRING CHECK. [B-420, 2026-09-23]
// The sidecar used to be added by rebuilding the finished zip (`injectIntoZip`): unpack the whole
// archive, write the sidecar into the tree, re-compress everything. It now rides through the single
// compression pass as an `extraEntries` append, which is one pass instead of three.
//
// ⚠️⚠️ THE FAILURE SHAPE IS SILENT, WHICH IS THE ENTIRE ARGUMENT FOR OPENING THE ZIP. An export that
// completes with NO sidecar in it looks exactly like a successful export: the progress bar fills,
// the byte count is right, the summary says what it always says, and the file opens fine. Nothing
// is red. You only discover it when a font is deleted and re-imported months later and the tags,
// the purchase link and the demo URL are gone - at which point the source is gone too.
//
// So the assertion is made against the ARTIFACT, not against the call. Things that could break it
// and would not show up anywhere else:
//   • the append never happens (a wrong opts key, a silently-dropped parameter);
//   • the payload gets STAGED again. An earlier cut of this path wrote the sidecar and copied the
//     attachments and any customized font into a temp dir so archiver could read them back out. It
//     produced a correct archive, so only the "read where it already lives" check below can see it -
//     and for a customized font that copy is a whole font written and re-read for nothing.
//   • the root meta.json of a customized entry starts shipping. It is an app artifact, not font
//     content, and a restore that finds one would treat our bookkeeping as the vendor's.
//
// ⚠️ A FILTER USED TO BE ABLE TO EAT IT, AND DELIBERATELY NO LONGER CAN. While the payload was
// staged, it went through `_selectFolderFiles` like ordinary source content - and `_isNoisePath`
// rejects __MACOSX, .DS_Store, Thumbs.db, desktop.ini and `._`-prefixed names, so
// '.jmt-curation.json' survived only by starting '.j' rather than '._'. One character, and widening
// that filter to "skip dotfiles" would have silently killed curation on export. The sidecar is now
// appended directly as bytes and never meets the filter, which removes the dependency rather than
// documenting it.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const StreamZip = require('node-stream-zip');

const sources = require('../soundFontSources');
const cur = require('../soundFontCuration');
const SIDECAR = '.jmt-curation.json';

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// A minimal but genuinely well-formed 16-bit mono PCM wav, so the export's damaged-wav check keeps
// it. `dataBytes` is the payload size; the header is the standard 44 bytes.
const wav = (dataBytes) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);      // PCM
  h.writeUInt16LE(1, 22);      // mono
  h.writeUInt32LE(44100, 24);  // sample rate
  h.writeUInt32LE(88200, 28);  // byte rate = rate * channels * bytesPerSample
  h.writeUInt16LE(2, 32);      // block align
  h.writeUInt16LE(16, 34);     // bits per sample
  h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([h, Buffer.alloc(dataBytes)]);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-sidecar-test-'));
const entriesOf = async (zipPath) => {
  const z = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });
  try { return Object.keys(await z.entries()); } finally { await z.close(); }
};

(async () => {
  // A source tree standing in for the pooled store's folder, and a staged payload dir standing in
  // for what writeIntoTree produces. Deliberately mirrors the real call: the payload is NOT inside
  // the source tree, because the source tree is the user's stored data and must not be written to.
  const srcDir = path.join(tmp, 'source');
  fs.mkdirSync(path.join(srcDir, 'Proffie', 'font'), { recursive: true });
  // ⚠️ REAL RIFF HEADERS, BECAUSE THE EXPORT STRIPS DAMAGED WAVS. The first cut of this test wrote
  // Buffer.alloc(2048) and both "wavs" were correctly thrown away as corrupt, leaving one file in
  // the archive - so the test failed on its own fixture, not on the code. That is the fixture-I-
  // authored trap: the walk under test has opinions about its input, and a stand-in that ignores
  // them tests nothing. Keeping the note so nobody "simplifies" these back to zero-filled buffers.
  fs.writeFileSync(path.join(srcDir, 'Proffie', 'font', 'hum.wav'), wav(2048));
  fs.writeFileSync(path.join(srcDir, 'Proffie', 'font', 'swing1.wav'), wav(4096));
  fs.writeFileSync(path.join(srcDir, 'readme.txt'), 'vendor notes');

  // The payload's files as they really live: a receipt in our own store, and a customized font as a
  // whole entry folder. Neither is inside the source tree, and neither may be copied to be archived.
  const storeDir = path.join(tmp, 'store');
  fs.mkdirSync(path.join(storeDir, 'receipts'), { recursive: true });
  fs.writeFileSync(path.join(storeDir, 'receipts', 'receipt.pdf'), Buffer.alloc(256, 3));
  const customDir = path.join(storeDir, 'library', 'MyFont');
  fs.mkdirSync(path.join(customDir, 'font'), { recursive: true });
  fs.writeFileSync(path.join(customDir, 'meta.json'), '{"app":"artifact"}');  // excluded by rule
  fs.writeFileSync(path.join(customDir, 'font', 'clash1.wav'), wav(1024));

  const payload = {
    schemaVersion: 1,
    tags: ['dueling'],
    links: { demo: 'https://example/x' },
    attachments: [{ file: '.jmt-curation/receipt.pdf',
                    _abs: path.join(storeDir, 'receipts', 'receipt.pdf') }],
    customized: [{ dir: '.jmt-curation/customized/MyFont', _absDir: customDir, candidatePath: 'MyFont' }],
  };

  // ⭐ planForArchive decides names and byte-sources; it writes nothing.
  const plan = cur.planForArchive(payload);
  ok('the plan produces the sidecar as bytes, not a file',
     !!(plan && typeof plan.sidecarJson === 'string' && plan.sidecarJson.length > 0),
     'the sidecar has to reach archiver as a buffer — staging it to disk only to read it back is '
     + 'the waste this path exists to avoid');

  // ⚠️⚠️ THE ASSERTION THAT PROVES NOTHING IS COPIED. Every payload entry must point INTO THE STORE,
  // where the file already lives. If any absPath sits under a staging directory instead, the plan
  // copied data in order to read it straight back out - which for a customized font means copying a
  // whole font. That regression would pass every other check in this file.
  ok('⚠️⚠️ every payload entry is read where it already lives',
     plan.entries.length > 0 && plan.entries.every((e) => e.absPath.startsWith(storeDir)),
     'a payload entry points outside the store, so something staged a copy: '
     + plan.entries.map((e) => e.absPath).join(', '));

  ok('the customized font folder is carried, minus its root meta.json',
     plan.entries.some((e) => e.name === '.jmt-curation/customized/MyFont/font/clash1.wav')
     && !plan.entries.some((e) => /customized\/MyFont\/meta\.json$/.test(e.name)),
     'the root meta.json is an app artifact, not font content, and must not ship');

  // The sidecar rides as bytes; everything else points at real files. This is exactly what the zip
  // branch of exportToDownloads builds.
  const extraEntries = [
    { name: SIDECAR, buffer: Buffer.from(plan.sidecarJson, 'utf8') },
    ...plan.entries,
  ];
  ok('the written sidecar carries no machine-specific paths',
     !/_abs|_absDir|[A-Za-z]:\\\\|\/tmp\//.test(plan.sidecarJson),
     'an absolute path in the sidecar leaks this machine into every archive it ships in');

  // ── WITH a payload ────────────────────────────────────────────────
  const withPath = path.join(tmp, 'with.zip');
  const rWith = await sources.zipFolderToFile(srcDir, withPath, null, { extraEntries });
  const namesWith = await entriesOf(withPath);

  ok('⚠️⚠️ the sidecar is really inside the exported archive', namesWith.includes(SIDECAR),
     `the export completed and reported success, but ${SIDECAR} is not in the zip. This is the `
     + 'silent failure: a delete gated on this export would destroy the source and the curation '
     + `with it. Entries seen: ${namesWith.join(', ')}`);
  ok('and so are the payload files it points at',
     namesWith.some((n) => n.replace(/\\/g, '/') === '.jmt-curation/receipt.pdf')
     && namesWith.some((n) => n.replace(/\\/g, '/')
          === '.jmt-curation/customized/MyFont/font/clash1.wav'),
     'a sidecar referencing receipts or a customized font that are not in the archive makes the '
     + `restore invent an empty one. Entries: ${namesWith.join(', ')}`);
  ok('and the vendor content is still all there',
     ['Proffie/font/hum.wav', 'Proffie/font/swing1.wav', 'readme.txt']
       .every((n) => namesWith.map((x) => x.replace(/\\/g, '/')).includes(n)),
     'carrying the sidecar must not cost a single vendor file');

  // ── WITHOUT a payload: an uncurated source is byte-for-byte what we hold ──
  const noPath = path.join(tmp, 'plain.zip');
  await sources.zipFolderToFile(srcDir, noPath, null, {});
  const namesNo = await entriesOf(noPath);
  ok('an uncurated export carries no sidecar at all', !namesNo.includes(SIDECAR),
     'an export with nothing of the owner in it must be a clean copy of the vendor bundle');
  ok('⚠️ and the control proves the assertion above can fail',
     namesWith.includes(SIDECAR) !== namesNo.includes(SIDECAR),
     'both archives agree on the sidecar, so the test is not distinguishing the two cases and its '
     + 'pass means nothing');

  // ── ⚠️⚠️ THE COUNTS DESCRIBE THE ARCHIVE, APPENDED ENTRIES INCLUDED ──
  //
  // ⭐ THIS ASSERTION USED TO SAY THE OPPOSITE, AND IT WAS WRONG. It required fileCount === 3 (the
  // vendor files only) and justified it as "the honest reading of files". It is not honest: these
  // numbers are the export's denominator, and the appended entries are compressed like everything
  // else. Ryan found it on a real export whose customized font carried a pile of tracks he had added
  // for earlier testing: "you see the progress bars at 100% for a really long time because it was
  // like 1.4 gigabytes out of 300 MB."
  // ⚠️⚠️ THE TEST MADE THE DEFECT LOOK DECIDED. A wrong assertion with a confident comment is worse
  // than no test at all - it converts "nobody has looked at this" into "someone looked and chose
  // this", and the next reader stops. Bugs are supposed to look like bugs.
  ok('⚠️⚠️ the reported fileCount includes the appended entries',
     rWith && rWith.fileCount === 3 + extraEntries.length,
     `expected ${3 + extraEntries.length} (3 vendor + ${extraEntries.length} appended), got `
     + `${rWith && rWith.fileCount}. A count that omits what it compressed is a denominator that `
     + 'cannot reach 100%.');
  {
    // The real defect was BYTES, not the file tally: a customized font is large, so the shortfall
    // pins the bar. Compare the reported total against what is actually on disk.
    const onDisk = fs.statSync(withPath).size;
    const vendorOnly = [
      path.join(srcDir, 'Proffie', 'font', 'hum.wav'),
      path.join(srcDir, 'Proffie', 'font', 'swing1.wav'),
      path.join(srcDir, 'readme.txt'),
    ].reduce((n, f) => n + fs.statSync(f).size, 0);
    const payloadBytes = plan.entries.reduce((n, e) => n + fs.statSync(e.absPath).size, 0)
                       + Buffer.byteLength(plan.sidecarJson, 'utf8');
    ok('⚠️⚠️ totalBytes covers the payload, not just the vendor tree',
       rWith && rWith.totalBytes >= vendorOnly + payloadBytes - 8,
       `reported ${rWith && rWith.totalBytes} but the archive carries ${vendorOnly} of vendor `
       + `content plus ${payloadBytes} of payload. Under-reporting here is what made a 1.05 GB job `
       + `measure itself against 336 MB. (zip on disk: ${onDisk})`);
    ok('⭐ and the control proves the payload is big enough to matter',
       payloadBytes > 0 && vendorOnly > 0);
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failed ? `\nexport-sidecar-in-zip: ${failed} failing`
                     : '\nexport-sidecar-in-zip: all passing');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
