// A receipt goes with its source, including through a restore.
//
// Found 2026-10-20 on a wiped library: a proof of purchase from 10-08 was still in the store with
// no source linking it. Deleting a source releases its receipts, but a merge carries every
// attachment in the archive, linked or not, and a Replace restores the store as it was - so a
// receipt that lost its source once rode every backup after. The rule: a deleted source's receipt
// is deleted, whatever path it took.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../soundFontAttachments.js');
const B = require('../soundFontBackup.js');
const C = require('../soundFontCommon.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-rcpt-${n}-`)); dirs.push(d); return d; };
const put = (dir, name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
const store = (ud) => {
  try { return fs.readdirSync(path.join(ud, 'soundFonts', 'attachments')); } catch { return []; }
};

// One voicepack whose source holds a receipt, and one receipt no source holds.
async function library() {
  const ud = tmp('ud');
  const src = tmp('src');
  fs.mkdirSync(path.join(src, 'Pack', 'common'), { recursive: true });
  const w = Buffer.alloc(600, 1); w.write('RIFF', 0); w.write('WAVE', 8);
  fs.writeFileSync(path.join(src, 'Pack', 'common', 'mmain.wav'), w);
  const r = await C.importCommonFromFolder(ud, path.join(src, 'Pack'), 'Pack');
  const files = tmp('files');
  // The store does not yet create its own folder on a library's first receipt (reported
  // separately), so the fixture does.
  fs.mkdirSync(path.join(ud, 'soundFonts', 'attachments'), { recursive: true });
  const kept = await A.addAttachmentToSourcesStreaming(ud, { filePath: put(files, 'kept.pdf', '%PDF kept'), uuids: [r.sourceUuid] });
  const loose = await A.addAttachmentToSourcesStreaming(ud, { filePath: put(files, 'loose.pdf', '%PDF loose'), uuids: [] });
  return { ud, sourceUuid: r.sourceUuid, kept: kept.id, loose: loose.id };
}

(async () => {
  console.log('the startup sweep');
  {
    const { ud, kept, loose } = await library();
    check('precondition: both receipts are in the store', store(ud).includes(kept) && store(ud).includes(loose));
    const r = A.pruneUnlinkedAttachments(ud);
    check('THE ONE NO SOURCE HOLDS GOES', !store(ud).includes(loose), JSON.stringify(store(ud)));
    check('the held one stays', store(ud).includes(kept));
    check('and it says what it removed', r.removed.length === 1 && r.removed[0] === loose, JSON.stringify(r));
  }

  console.log('a source\'s own picture is held too');
  {
    const { ud, sourceUuid } = await library();
    const png = put(tmp('pic'), 'pic.png', '\x89PNG picture');
    const pic = await A.setSourcePicture(ud, sourceUuid, png);
    A.pruneUnlinkedAttachments(ud);
    check('the picture survives the sweep', store(ud).includes(pic.id));
  }

  console.log('through a backup');
  {
    const { ud, kept, loose } = await library();
    const zip = path.join(tmp('zip'), 'b.zip');
    await B.exportBackup({ userData: ud, destPath: zip, appVersion: 'test' });

    const ud2 = tmp('replace');
    const rs = await B.applyReplace({ userData: ud2, zipPath: zip });
    check('REPLACE DOES NOT BRING BACK A RECEIPT NO SOURCE HOLDS', !store(ud2).includes(loose), JSON.stringify(store(ud2)));
    check('it brings back the held one', store(ud2).includes(kept));
    check('and counts only that one', rs.counts && rs.counts.attachments === 1, JSON.stringify(rs.counts));

    const ud3 = tmp('merge');
    const mr = await B.applyMerge({ userData: ud3, zipPath: zip, plan: { library: {}, common: {}, sources: {} } });
    check('A MERGE THAT TAKES NO SOURCE BRINGS NO RECEIPT', store(ud3).length === 0, JSON.stringify(store(ud3)));
    check('and says it added none', mr.counts && mr.counts.attachments && mr.counts.attachments.added === 0, JSON.stringify(mr.counts && mr.counts.attachments));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
