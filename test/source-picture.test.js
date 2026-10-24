// A source has its own picture, and a font's or common folder's picture is its own.  [B-511]
//
// Item: its own folder, then the creator's picture beside it, then its source's OWN picture.
// Source: the one the user set, then one at the top of the download, then borrowed from the first
// item alphabetically. A borrowed picture shows on the source only: in a bundle, Pack B must not
// show Pack A's character. Built through the real multi-pack common import, so the bundle has the
// importer's layout. The user-set picture lives in the attachments store: it must not count as
// proof of purchase, and its bytes go when the last holder lets go.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../soundFontCommon.js');
const P = require(process.env.PIC || '../soundFontPicture.js');
const A = require('../soundFontAttachments.js');
const S = require('../soundFontSources.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-srcpic-${n}-`)); dirs.push(d); return d; };
function put(root, rel, buf) {
  const abs = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return abs;
}
function wav(fill) {
  const data = Buffer.alloc(512, fill);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
const png = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, n)]);

// Pack A ships its character beside its common folder; Pack B ships none.
async function bundle(build) {
  const src = tmp('src'); const ud = tmp('ud');
  put(src, 'Bundle/PackA/common/mmain.wav', wav(1));
  put(src, 'Bundle/PackA/a_Alpha.jpg', png(1));
  put(src, 'Bundle/PackB/common/mmain.wav', wav(2));
  if (build) build(path.join(src, 'Bundle'));
  const r = await C.importCommonFromFolder(ud, path.join(src, 'Bundle'), 'Bundle', undefined, null, { bundle: true });
  if (!r || !r.ok) throw new Error(`import failed: ${r && r.error}`);
  const all = C.listCommons(ud);
  return { ud, sourceUuid: r.sourceUuid,
           a: all.find((c) => c.meta.name === 'PackA').uuid, b: all.find((c) => c.meta.name === 'PackB').uuid };
}

(async () => {
  console.log('a bundle with no picture of its own');
  {
    const { ud, sourceUuid, a, b } = await bundle();
    const pa = await P.findCommonPicture(ud, a);
    check('Pack A shows the character beside it', pa && /PackA\/a_Alpha\.jpg$/.test(pa.subPath), JSON.stringify(pa));
    const pb = await P.findCommonPicture(ud, b);
    check('PACK B DOES NOT SHOW PACK A\'S CHARACTER', pb === null, JSON.stringify(pb));
    const ps = await P.findSourcePicture(ud, sourceUuid);
    check('the source borrows the first item\'s picture', ps && /PackA\/a_Alpha\.jpg$/.test(ps.subPath), JSON.stringify(ps));
  }

  console.log('a bundle whose creator put a picture at the top');
  {
    const { ud, sourceUuid, a, b } = await bundle((d) => put(d, 'cover.png', png(3)));
    const ps = await P.findSourcePicture(ud, sourceUuid);
    check('the source shows the top-level picture', ps && ps.kind === 'source' && ps.subPath === 'cover.png', JSON.stringify(ps));
    const pb = await P.findCommonPicture(ud, b);
    check('Pack B, with none of its own, shows the source\'s', pb && pb.subPath === 'cover.png', JSON.stringify(pb));
    const pa = await P.findCommonPicture(ud, a);
    check('Pack A keeps its own character', pa && /a_Alpha\.jpg$/.test(pa.subPath), JSON.stringify(pa));
  }

  console.log('whose image it is (what an Image row names)');
  {
    const { ud, sourceUuid, a, b } = await bundle();
    check('a creator image beside the pack is the creator\'s', ((await P.findCommonPicture(ud, a)) || {}).origin === 'creator');
    check('a creator image the source finds beside a pack is still the source\'s', ((await P.findSourcePicture(ud, sourceUuid)) || {}).origin === 'creator');
    await A.setSourcePicture(ud, sourceUuid, put(tmp('pick'), 'mine.png', png(50)));
    check('one set on the source is its own', ((await P.findSourcePicture(ud, sourceUuid)) || {}).origin === 'own');
    check('a pack showing the source\'s is INHERITED', ((await P.findCommonPicture(ud, b)) || {}).origin === 'source');
    put(path.join(C.commonRoot(ud), b, 'files'), 'pack-b.png', png(51));
    check('one in the pack\'s own folder is its own', ((await P.findCommonPicture(ud, b)) || {}).origin === 'own');
  }

  {
    // A bundle whose only image is one the user put in a pack's own folder: the source borrows it.
    const src = tmp('own'); const ud = tmp('ud');
    put(src, 'B/PackA/common/mmain.wav', wav(60));
    put(src, 'B/PackB/common/mmain.wav', wav(61));
    const r = await C.importCommonFromFolder(ud, path.join(src, 'B'), 'B', undefined, null, { bundle: true });
    const pb = C.listCommons(ud).find((c) => c.meta.name === 'PackB').uuid;
    put(path.join(C.commonRoot(ud), pb, 'files'), 'pack-b.png', png(62));
    check('one from a pack\'s own folder is BORROWED, not the source\'s', ((await P.findSourcePicture(ud, r.sourceUuid)) || {}).origin === 'borrowed');
  }

  console.log('a bundle borrowing picks by seed');
  {
    const { ud, sourceUuid, b } = await bundle();
    put(path.join(C.commonRoot(ud), b, 'files'), 'pack-b.png', png(70));
    const first = await P.findSourcePicture(ud, sourceUuid);
    check('with no seed, the first alphabetically', first && /PackA\/a_Alpha\.jpg$/.test(first.subPath), JSON.stringify(first));
    const s0 = await P.findSourcePicture(ud, sourceUuid, { seed: 0 });
    const s1 = await P.findSourcePicture(ud, sourceUuid, { seed: 1 });
    check('DIFFERENT SEEDS CAN PICK DIFFERENT ITEMS', s0 && s1 && s0.subPath !== s1.subPath, JSON.stringify([s0, s1]));
    const again = await P.findSourcePicture(ud, sourceUuid, { seed: 1 });
    check('the same seed picks the same one, so a window agrees with itself', again && again.subPath === s1.subPath);
    await A.setSourcePicture(ud, sourceUuid, put(tmp('pick'), 'mine.png', png(71)));
    const set = await P.findSourcePicture(ud, sourceUuid, { seed: 1 });
    check('an image of its own is never replaced by a random one', set && set.kind === 'attachment', JSON.stringify(set));
  }

  console.log('one for one: a source with a single item');
  {
    const src = tmp('one'); const ud = tmp('ud');
    put(src, 'Pack/common/mmain.wav', wav(40));
    put(src, 'Pack/a_Bane.jpg', png(40));
    const r = await C.importCommonFromFolder(ud, path.join(src, 'Pack'), 'Pack');
    const uuid = C.listCommons(ud)[0].uuid;
    const before = await P.findSourcePicture(ud, r.sourceUuid);
    check('precondition: the source shows the creator\'s image', before && before.subPath === 'a_Bane.jpg', JSON.stringify(before));
    put(path.join(C.commonRoot(ud), uuid, 'files'), 'bane.png', png(41));
    const after = await P.findSourcePicture(ud, r.sourceUuid);
    check('THE ITEM\'S OWN IMAGE IS THE SOURCE\'S TOO', after && after.kind === 'common' && after.id === uuid && after.subPath === 'bane.png',
          JSON.stringify(after));
    const pc = await P.findCommonPicture(ud, uuid);
    check('and the common folder shows the same one', pc && pc.subPath === 'bane.png', JSON.stringify(pc));
    const set = await A.setSourcePicture(ud, r.sourceUuid, put(tmp('pick'), 'chosen.png', png(42)));
    const chosen = await P.findSourcePicture(ud, r.sourceUuid);
    check('an image set on the source on purpose still wins', chosen && chosen.kind === 'attachment' && chosen.id === set.id,
          JSON.stringify(chosen));
  }
  {
    // A bundle is not one for one: an item's own image does not become the source's over the creator's.
    const { ud, sourceUuid, b } = await bundle((d) => put(d, 'cover.png', png(43)));
    put(path.join(C.commonRoot(ud), b, 'files'), 'pack-b.png', png(44));
    const ps = await P.findSourcePicture(ud, sourceUuid);
    check('a bundle keeps the creator\'s cover', ps && ps.subPath === 'cover.png', JSON.stringify(ps));
  }

  console.log('a picture the user sets on the source');
  {
    const { ud, sourceUuid, a, b } = await bundle();
    const file = put(tmp('pick'), 'mine.png', png(9));
    const r = await A.setSourcePicture(ud, sourceUuid, file);
    check('it is set', r && r.ok, JSON.stringify(r));
    const ps = await P.findSourcePicture(ud, sourceUuid);
    check('the source shows it', ps && ps.kind === 'attachment' && ps.id === r.id && ps.subPath === 'mine.png', JSON.stringify(ps));
    const pb = await P.findCommonPicture(ud, b);
    check('Pack B shows it', pb && pb.kind === 'attachment' && pb.id === r.id, JSON.stringify(pb));
    const pa = await P.findCommonPicture(ud, a);
    check('Pack A still shows its own character', pa && /a_Alpha\.jpg$/.test(pa.subPath), JSON.stringify(pa));

    check('it is not offered as proof of purchase', !A.listAllAttachments(ud).some((x) => x.id === r.id));
    check('nor listed as one on the source', A.listAttachments(ud, sourceUuid).length === 0);
    const att = path.join(ud, 'soundFonts', 'attachments', r.id);
    check('its bytes are in the store', fs.existsSync(att));

    // A proof of purchase with the same bytes, removed everywhere, must not take the picture with it.
    const proof = await A.addAttachmentToSourcesStreaming(ud, { filePath: file, uuids: [sourceUuid] });
    check('the same bytes can also be a proof', proof && proof.ok && proof.id === r.id, JSON.stringify(proof));
    A.removeAttachmentEverywhere(ud, r.id);
    check('REMOVING THE PROOF EVERYWHERE LEAVES THE PICTURE', fs.existsSync(att) && !!A.sourcePicture(ud, sourceUuid));

    const file2 = put(tmp('pick'), 'other.jpg', png(10));
    const r2 = await A.setSourcePicture(ud, sourceUuid, file2);
    check('replacing it frees the old bytes', r2.ok && !fs.existsSync(att) && fs.existsSync(path.join(ud, 'soundFonts', 'attachments', r2.id)));
    A.clearSourcePicture(ud, sourceUuid);
    check('clearing it frees its bytes', !fs.existsSync(path.join(ud, 'soundFonts', 'attachments', r2.id)));
    const back = await P.findSourcePicture(ud, sourceUuid);
    check('and the source borrows again', back && /a_Alpha\.jpg$/.test(back.subPath), JSON.stringify(back));

    const bad = await A.setSourcePicture(ud, sourceUuid, put(tmp('pick'), 'notes.txt', Buffer.from('hi')));
    check('a file that is not a picture is refused', bad && !bad.ok && /not an image/.test(bad.error || ''), JSON.stringify(bad));
  }

  console.log('deleting the source');
  {
    const { ud, sourceUuid } = await bundle();
    const r = await A.setSourcePicture(ud, sourceUuid, put(tmp('pick'), 'mine.png', png(11)));
    const att = path.join(ud, 'soundFonts', 'attachments', r.id);
    S.deleteSource(ud, sourceUuid);
    check('takes its picture\'s bytes with it', !fs.existsSync(att));
  }

  console.log('a backup round trip');
  {
    const B = require('../soundFontBackup.js');
    const { ud, sourceUuid, b } = await bundle();
    const pic = await A.setSourcePicture(ud, sourceUuid, put(tmp('pick'), 'mine.png', png(12)));
    const proof = await A.addAttachmentToSourcesStreaming(ud, { filePath: put(tmp('pick'), 'receipt.pdf', Buffer.from('%PDF-1.4 receipt')), uuids: [sourceUuid] });
    check('precondition: one picture and one proof', pic.ok && proof.ok && pic.id !== proof.id);
    const zip = path.join(tmp('zip'), 'b.zip');
    const ex = await B.exportBackup({ userData: ud, destPath: zip, appVersion: 'test' });
    check('THE BACKUP COUNTS ONE PROOF OF PURCHASE, NOT TWO', ex.manifest.counts.attachments === 1,
          `counts.attachments=${ex.manifest.counts.attachments}`);
    const ins = await B.inspectBackup(zip);
    check('and so does reading it back', ins.ok && ins.observed.counts.attachments === 1,
          JSON.stringify(ins.observed && ins.observed.counts));

    const ud2 = tmp('restore');
    const rs = await B.applyReplace({ userData: ud2, zipPath: zip });
    check('a restore counts one proof too', rs.counts && rs.counts.attachments === 1, JSON.stringify(rs.counts));
    const back = A.sourcePicture(ud2, sourceUuid);
    check('THE SOURCE\'S PICTURE COMES BACK', back && back.id === pic.id && back.name === 'mine.png', JSON.stringify(back));
    const pb = await P.findCommonPicture(ud2, b);
    check('and Pack B shows it again', pb && pb.kind === 'attachment' && pb.id === pic.id, JSON.stringify(pb));
  }

  console.log('a source export');
  {
    const CU = require(process.env.CUR || '../soundFontCuration.js');
    const { ud, sourceUuid } = await bundle();
    const pic = await A.setSourcePicture(ud, sourceUuid, put(tmp('pick'), 'mine.png', png(13)));
    // Proof of purchase NOT included: the picture rides anyway.
    const payload = CU.buildForSource(ud, sourceUuid, 'test', { includeAttachments: false });
    check('THE PICTURE RIDES WITHOUT BEING ASKED', payload && payload.picture && payload.picture.name === 'mine.png',
          JSON.stringify(payload && payload.picture));
    check('proof of purchase still waits to be asked', payload && payload.attachments.length === 0);
    const plan = CU.planForArchive(payload);
    check('the archive carries its bytes', plan.entries.some((e) => e.name === payload.picture.file));
    check('and the sidecar no machine path', !/_abs/.test(plan.sidecarJson) && /mine\.png/.test(plan.sidecarJson));

    const tree = tmp('tree');
    CU.writeIntoTree(tree, payload);
    const written = JSON.parse(fs.readFileSync(path.join(tree, CU.SIDECAR_NAME || '.jmt-curation.json'), 'utf8'));
    check('a folder export carries it too', fs.existsSync(path.join(tree, ...payload.picture.file.split('/'))));

    // The other end: a library with the same source and no picture.
    const { ud: ud2, sourceUuid: s2 } = await bundle();
    const r = CU.applySourceCuration(ud2, s2, written, tree);
    const back = A.sourcePicture(ud2, s2);
    check('ON IMPORT IT BECOMES THE SOURCE\'S OWN PICTURE', r.picture === true && back && back.id === pic.id, JSON.stringify({ r, back }));
    check('not a proof of purchase', A.listAttachments(ud2, s2).length === 0);
  }

  console.log('an item whose only change is a picture rides a source export');
  {
    const CU = require(process.env.CUR || '../soundFontCuration.js');
    // Common folders: Pack B gets a picture of its own, Pack A is untouched.
    const { ud, sourceUuid, b } = await bundle();
    put(path.join(C.commonRoot(ud), b, 'files'), 'pack-b.png', png(14));
    const cust = C.getCommonCustomization(ud, b);
    check('precondition: the picture alone is not customization', cust && cust.known && !cust.customized, JSON.stringify(cust));
    const payload = CU.buildForSource(ud, sourceUuid, 'test', { includeCustomized: true, customizedKind: 'common' });
    const riders = ((payload && payload.customized) || []).map((c) => c.commonName);
    check('THE COMMON FOLDER WITH ITS OWN PICTURE RIDES', riders.includes('PackB'), JSON.stringify(riders));
    check('the untouched one does not', !riders.includes('PackA'), JSON.stringify(riders));

    // Fonts: the same rule.
    const E = require('../soundFontEntries.js');
    const ud2 = tmp('fonts');
    const uuid = 'src-uuid-fontpic';
    const uuidDir = path.join(S.sourcesRoot(ud2), uuid);
    fs.mkdirSync(uuidDir, { recursive: true });
    fs.writeFileSync(path.join(uuidDir, 'meta.json'), JSON.stringify({ schemaVersion: 1, uuid, format: 'folder', originalName: 'Bundle' }));
    put(path.join(uuidDir, 'source'), 'Ahsoka/hum.wav', wav(30));
    put(path.join(uuidDir, 'source'), 'Obiwan/hum.wav', wav(31));
    await S.ensureSourceManifest(ud2, uuid);
    for (const n of ['Ahsoka', 'Obiwan']) {
      await E.createEntry({ userData: ud2, sourceUuid: uuid, candidate: { path: n, name: n }, name: n });
    }
    put(path.join(E.entriesRoot(ud2), 'Ahsoka'), 'ahsoka.png', png(15));
    const fc = E.getEntryCustomization(ud2, 'Ahsoka');
    check('precondition: a font\'s picture alone is not customization either', fc && fc.known && !fc.customized, JSON.stringify(fc));
    // [B-536] A font's image travels by itself, whatever the include-customized choice; the font
    // does not ride whole for it.
    const p2 = CU.buildForSource(ud2, uuid, 'test', { includeCustomized: false });
    const fr = ((p2 && p2.customized) || []).map((c) => c.entryName);
    const carried = (p2 && p2.entryPictures) || {};
    check('THE FONT\'S OWN PICTURE IS CARRIED, BOX UNTICKED', carried.Ahsoka && carried.Ahsoka.name === 'ahsoka.png', JSON.stringify(carried));
    check('and the font does not ride whole for it', !fr.includes('Ahsoka'), JSON.stringify(fr));
    check('the untouched font carries nothing', !carried.Obiwan && !fr.includes('Obiwan'), JSON.stringify(carried));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
