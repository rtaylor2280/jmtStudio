/**
 * A dropped item is dropped from the ARCHIVE WALK too, in every bucket.  [B-478]
 *
 * WHY THIS EXISTS, and it is a real defect found in a dev test on 2026-10-13. The export
 * reached the gate, listed a source as "cannot be backed up", the user agreed, and then the
 * export sat at 806 MB of 1.89 GB forever: zero bytes and zero CPU for ten seconds, parked on
 * a file inside the very source it had promised to leave out.
 *
 * THE MECHANISM, because it explains why the existing coverage stayed green. Two archive
 * shapes, and only one of them honoured the drop:
 *   · library and common  - archived per item from `bucketTops`, which the dropped item was
 *                           already removed from. These worked.
 *   · sources, attachments - archived as ONE whole-bucket archive.directory() call, which walks
 *                           the dropped item regardless of what `bucketTops` says.
 * The filter could not save it either: the count pass skips a dropped item BEFORE the walk that
 * fills `refusedAbs`, so its unreadable files were in no skip set at all. Archiver then read one,
 * the EPERM arrived as a stream-level error, and finalize() never settled.
 *
 * `backup-skips-unreadable.test.js` asserts the item rule against `library/TestFont` - the bucket
 * where it already held. The rule is the same in every bucket; the machinery is not.
 *
 * NO UNREADABLE FILE IS NEEDED TO CATCH THIS. The drop keys off skipPaths, so pointing it at a
 * perfectly readable file exercises the same branch and asserts the same property, on every
 * platform, with no ACL work.
 *
 * Run: node test/backup-drops-whole-source.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Overridable so the control run can point the same assertions at a pre-fix copy of the module
// and prove they fail. A test that has never failed is a claim, not a check.
const MODULE = process.env.B478_MODULE || path.join(__dirname, '..', 'soundFontBackup.js');
const backup = require(MODULE);

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

function wav(size, seed) {
  const b = Buffer.alloc(size);
  b.write('RIFF', 0); b.write('WAVE', 8);
  for (let i = 12; i < size; i += 97) b[i] = (seed * 31 + i) & 0xff;
  return b;
}

function entriesOf(zipPath) {
  const StreamZip = require(path.join(__dirname, '..', 'node_modules', 'node-stream-zip'));
  const z = new StreamZip.async({ file: zipPath });
  return z.entries()
    .then(e => Object.keys(e).map(n => n.replace(/\\/g, '/')))
    .finally(() => z.close());
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b478src-'));
  const userData = path.join(tmp, 'userData');
  const sfRoot = path.join(userData, 'soundFonts');

  // Two sources and two attachments: one of each to drop, one of each as the control that must
  // survive. Without the survivor, "no entries under the dropped id" would also pass on a run
  // that archived nothing at all.
  const mkSource = (id, seed) => {
    const root = path.join(sfRoot, 'sources', id);
    fs.mkdirSync(path.join(root, 'source'), { recursive: true });
    fs.writeFileSync(path.join(root, 'meta.json'), JSON.stringify({
      uuid: id, format: 'folder', originalName: `${id}.zip`, bundleName: id,
    }, null, 2));
    fs.writeFileSync(path.join(root, 'source', 'one.wav'), wav(2048, seed));
    fs.writeFileSync(path.join(root, 'source', 'two.wav'), wav(2048, seed + 1));
    return root;
  };
  const srcKeep = mkSource('src-keep', 10);
  const srcDrop = mkSource('src-drop', 20);

  const mkAttachment = (id, seed) => {
    const root = path.join(sfRoot, 'attachments', id);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'receipt.txt'), `receipt ${seed}`);
    fs.writeFileSync(path.join(root, 'note.txt'), `note ${seed}`);
    return root;
  };
  const attKeep = mkAttachment('att-keep', 1);
  const attDrop = mkAttachment('att-drop', 2);

  const libFont = path.join(sfRoot, 'library', 'TestFont');
  fs.mkdirSync(libFont, { recursive: true });
  fs.writeFileSync(path.join(libFont, 'hum.wav'), wav(2048, 7));

  // ── CONTROL: with nothing skipped, every fixture is in the archive ────────────────
  // This is the reading that says the assertions below can distinguish anything at all.
  {
    const dest = path.join(tmp, 'all.zip');
    await backup.exportBackup({ userData, destPath: dest, appVersion: '0.0.0-test' });
    const names = await entriesOf(dest);
    const files = names.filter(n => !n.endsWith('/'));
    ok('control: an unskipped export carries both sources',
       files.some(n => n.startsWith('sources/src-keep/')) && files.some(n => n.startsWith('sources/src-drop/')),
       files.filter(n => n.startsWith('sources/')).join(', '));
    ok('control: an unskipped export carries both attachments',
       files.some(n => n.startsWith('attachments/att-keep/')) && files.some(n => n.startsWith('attachments/att-drop/')),
       files.filter(n => n.startsWith('attachments/')).join(', '));
  }

  // ── A DROPPED SOURCE LEAVES NOTHING BEHIND ───────────────────────────────────────
  {
    const dest = path.join(tmp, 'src.zip');
    const r = await backup.exportBackup({
      userData, destPath: dest, appVersion: '0.0.0-test',
      skipPaths: [path.join(srcDrop, 'source', 'one.wav')],
    });
    const names = await entriesOf(dest);
    const dropped = names.filter(n => n.startsWith('sources/src-drop/') && !n.endsWith('/'));

    ok('the whole source is absent from the archive', dropped.length === 0,
       `still present: ${dropped.join(', ')}`);
    ok('its readable sibling went with it',
       !names.some(n => n.endsWith('src-drop/source/two.wav')),
       'a surviving sibling means the file was skipped instead of the item');
    ok('its meta.json went with it',
       !names.some(n => n === 'sources/src-drop/meta.json'),
       'a surviving meta.json describes content the archive does not hold');
    ok('the other source is untouched',
       names.some(n => n.endsWith('src-keep/source/one.wav')),
       names.filter(n => n.startsWith('sources/')).join(', '));
    ok('the drop is reported as an item',
       (r.skippedItems || []).some(i => i.bucket === 'sources' && i.top === 'src-drop'),
       JSON.stringify(r.skippedItems));

    // The manifest has to agree with what is really inside, or a restore trusts a count that
    // describes a source the archive never carried.
    const StreamZip = require(path.join(__dirname, '..', 'node_modules', 'node-stream-zip'));
    const z = new StreamZip.async({ file: dest });
    let man = null;
    try { man = JSON.parse((await z.entryData('manifest.json')).toString('utf8')); }
    finally { await z.close(); }
    const sourcesInZip = new Set(names.filter(n => n.startsWith('sources/'))
      .map(n => n.split('/')[1]).filter(Boolean));
    ok('the manifest source count equals the sources actually in the archive',
       man && man.counts.sources === sourcesInZip.size,
       `manifest ${man && man.counts.sources}, archive holds ${sourcesInZip.size} (${[...sourcesInZip].join(', ')})`);
  }

  // ── AND THE SAME FOR ATTACHMENTS ─────────────────────────────────────────────────
  // Attachments are exempt from the carry test, never from the readability skip, and they are
  // archived by the same whole-bucket call that let the source through.
  {
    const dest = path.join(tmp, 'att.zip');
    const r = await backup.exportBackup({
      userData, destPath: dest, appVersion: '0.0.0-test',
      skipPaths: [path.join(attDrop, 'receipt.txt')],
    });
    const names = await entriesOf(dest);
    const dropped = names.filter(n => n.startsWith('attachments/att-drop/') && !n.endsWith('/'));

    ok('the whole attachment is absent from the archive', dropped.length === 0,
       `still present: ${dropped.join(', ')}`);
    ok('the other attachment is untouched',
       names.some(n => n.endsWith('att-keep/receipt.txt')),
       names.filter(n => n.startsWith('attachments/')).join(', '));
    ok('the attachment drop is reported as an item',
       (r.skippedItems || []).some(i => i.bucket === 'attachments' && i.top === 'att-drop'),
       JSON.stringify(r.skippedItems));
  }

  // ── NOTHING WAS REMOVED FROM DISK ────────────────────────────────────────────────
  // Every file here is the user's own. The drop is about what the archive carries.
  ok('the dropped source is still on disk', fs.existsSync(path.join(srcDrop, 'source', 'two.wav')));
  ok('the dropped attachment is still on disk', fs.existsSync(path.join(attDrop, 'note.txt')));
  ok('the kept fixtures are still on disk',
     fs.existsSync(path.join(srcKeep, 'source', 'one.wav')) && fs.existsSync(path.join(attKeep, 'note.txt')));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
