// The merge survey keeps the main process answering while it works.
//
// The survey compares a backup with the current library before a Merge or a Replace. It runs on
// the main process, and on a full library it ran unbroken: 31.8 s measured on 2026-10-21, the
// window reported Not Responding. It now yields between items. The check is a heartbeat timer:
// while the survey runs over a library of many items, no gap between its turns may be long.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');
const E = require('../soundFontEntries.js');
const B = require('../soundFontBackup.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-svy-${n}-`)); dirs.push(d); return d; };

async function library(n) {
  const ud = tmp('ud');
  for (let i = 0; i < n; i++) {
    const uuid = `src-${i}`;
    const dir = path.join(S.sourcesRoot(ud), uuid);
    fs.mkdirSync(path.join(dir, 'source', `Font${i}`), { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      schemaVersion: 1, uuid, format: 'folder', originalName: `Font${i}`, importedAt: '2026-10-01T00:00:00.000Z',
    }));
    for (const s of ['hum', 'out', 'in', 'clsh1', 'swng1']) {
      fs.writeFileSync(path.join(dir, 'source', `Font${i}`, `${s}.wav`), Buffer.alloc(2048, i + s.length));
    }
    await S.ensureSourceManifest(ud, uuid);
    const r = await E.createEntry({ userData: ud, sourceUuid: uuid, candidate: { path: `Font${i}`, name: `Font${i}` }, name: `Font${i}` });
    if (!r || !r.ok) throw new Error(`entry ${i}: ${r && r.error}`);
  }
  return ud;
}

(async () => {
  console.log('a survey over a library of 120 fonts');
  const ud = await library(120);
  const zip = path.join(tmp('zip'), 'b.zip');
  const ex = await B.exportBackup({ userData: ud, destPath: zip, appVersion: 'test' });
  check('precondition: the backup exported', ex && ex.ok !== false, JSON.stringify(ex && ex.error));

  let beats = 0, last = Date.now(), worst = 0;
  const timer = setInterval(() => { const t = Date.now(); worst = Math.max(worst, t - last); last = t; beats++; }, 0);
  const t0 = Date.now();
  const res = await B.surveyMerge({ userData: ud, zipPath: zip });
  const total = Date.now() - t0;
  clearInterval(timer);
  console.log(`    survey ${total} ms, longest stretch without a turn ${worst} ms, ${beats} turns`);
  check('precondition: the survey ran and found every item identical',
    res && res.ok !== false && res.library && res.library.identical.length === 120,
    JSON.stringify(res && res.library && { id: res.library.identical.length, c: res.library.conflict.length }));
  // The symptom is ONE LONG STRETCH, not a low turn count: the zip reads already yield, so the old
  // survey got plenty of turns and still held the process for most of its run in one block
  // (measured on 120 fonts: 656 ms of an 894 ms survey; after the fix, 58 ms of 833). It grows
  // with the library, which is how it reached 31.8 s. No stretch may take a quarter of the run.
  check('NO SINGLE STRETCH HOLDS THE PROCESS FOR A QUARTER OF THE SURVEY', worst < total / 4,
    `longest ${worst} ms of ${total} ms`);

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
