// A bulk import keeps what a JMT export carried.
//
// Found 2026-10-21 after a 129-source bulk import: ten fonts exported from JMT Studio came back
// without their creator, demo link or tags, and two were flagged "Creator field is empty" while
// the window showed a creator. The bulk path filled its own blanks first and those blanks were
// laid over the carried values, and the review was decided on detection alone.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');
const C = require('../soundFontCandidates.js');
const B = require('../soundFontBulkImport.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const dirs = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `jmt-bkc-${n}-`)); dirs.push(d); return d; };
function wav(body) {
  const data = Buffer.alloc(8 * 1024, body);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
function put(root, rel, buf) {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

// One exported font: no readme names a creator, so only the sidecar knows it.
async function exportedFont(set, sidecar) {
  const dir = path.join(set, 'Carried');
  for (const [n, c] of [['hum', 'H'], ['out', 'O'], ['in', 'I'], ['clsh1', 'C'], ['swng1', 'S'], ['font', 'F']]) {
    put(dir, `${n}.wav`, wav(c));
  }
  const cands = (await C.detectCandidates(S.openSourceAtPath(dir))).candidates;
  const key = cands[0].path || '';
  fs.writeFileSync(path.join(dir, '.jmt-curation.json'), JSON.stringify(sidecar(key)));
  return key;
}

async function bulk(set, ud) {
  const scan = await B.scanForBulkImport({ rootDir: set });
  const run = await B.runBulkImport({ plan: scan.plan, userData: ud }, {});
  // The stored meta, not the read-time view: that view fills a blank creator from the source,
  // which is exactly how the loss hid in the app.
  const lib = path.join(ud, 'soundFonts', 'library');
  const names = fs.existsSync(lib) ? fs.readdirSync(lib) : [];
  const entry = names.length ? JSON.parse(fs.readFileSync(path.join(lib, names[0], 'meta.json'), 'utf8')) : null;
  const src = entry && S.readSourceMeta(path.join(S.sourcesRoot(ud), entry.sourceUuid));
  return { run, entry, src };
}

(async () => {
  console.log('a font whose creator, link and tags ride only in its export');
  {
    const set = tmp('set');
    await exportedFont(set, (key) => ({
      schemaVersion: 1,
      source: { vendor: 'Evil Otto Jr', vendorWebsite: 'https://www.saberforum.com/', linkUrl: 'https://example.com/get', purchased: true },
      entries: { [key]: { name: 'Carried', author: 'Evil Otto Jr', demoUrl: 'https://example.com/demo', tags: ['Sith', 'Favourite'], userNotes: 'my note' } },
    }));
    const { run, entry, src } = await bulk(set, tmp('ud'));
    check('it imported', run.summary.imported.length === 1, JSON.stringify(run.summary.failed));
    check('precondition: the sidecar reached the source', src && src.curation && src.vendor === 'Evil Otto Jr', JSON.stringify(src && src.vendor));
    check('THE FONT KEEPS ITS CREATOR', entry && entry.author === 'Evil Otto Jr', JSON.stringify(entry && entry.author));
    check('AND ITS DEMO LINK', entry && entry.demoUrl === 'https://example.com/demo', JSON.stringify(entry && entry.demoUrl));
    check('and its tags', entry && JSON.stringify(entry.tags) === JSON.stringify(['Sith', 'Favourite']), JSON.stringify(entry && entry.tags));
    check('and its notes', entry && entry.userNotes === 'my note', JSON.stringify(entry && entry.userNotes));
    check('IT IS NOT FLAGGED "CREATOR FIELD IS EMPTY"', entry && !(entry.reviewReasons || []).includes('creator_empty'), JSON.stringify(entry && entry.reviewReasons));
    check('the creator is marked as the user\'s, not detected', src && src.vendorAutoDetected === false, JSON.stringify(src && src.vendorAutoDetected));
  }

  console.log('a carried source creator with no font-level creator');
  {
    const set = tmp('set');
    await exportedFont(set, (key) => ({
      schemaVersion: 1,
      source: { vendor: "Reaver's Arsenal", purchased: true },
      entries: { [key]: { name: 'Carried', demoUrl: 'https://example.com/demo' } },
    }));
    const { entry } = await bulk(set, tmp('ud'));
    check('the font takes the source\'s creator', entry && entry.author === "Reaver's Arsenal", JSON.stringify(entry && entry.author));
    check('and is not flagged', entry && !(entry.reviewReasons || []).includes('creator_empty'), JSON.stringify(entry && entry.reviewReasons));
  }

  console.log('a carried "free" answer outranks the paid default');
  {
    const set = tmp('set');
    await exportedFont(set, (key) => ({
      schemaVersion: 1,
      source: { vendor: 'BVM Sabers', purchased: false },
      entries: { [key]: { name: 'Carried', purchased: false } },
    }));
    const { entry, src } = await bulk(set, tmp('ud'));
    check('the source stays free', src && src.purchased === false, JSON.stringify(src && src.purchased));
    check('and so does the font', entry && entry.purchased === false, JSON.stringify(entry && entry.purchased));
  }

  console.log('a font the user renamed');
  {
    const set = tmp('set');
    await exportedFont(set, (key) => ({
      schemaVersion: 1,
      source: { vendor: 'Juansith' },
      entries: { [key]: { name: 'My_Blue_Font' } },
    }));
    const ud = tmp('ud');
    await bulk(set, ud);
    const names = fs.readdirSync(path.join(ud, 'soundFonts', 'library'));
    check('COMES BACK UNDER THE NAME THE USER GAVE IT', names.length === 1 && names[0] === 'My_Blue_Font', names.join());
  }

  console.log('no sidecar: nothing changes');
  {
    const set = tmp('set');
    const dir = path.join(set, 'Plain');
    for (const [n, c] of [['hum', 'H'], ['out', 'O'], ['in', 'I'], ['clsh1', 'C'], ['swng1', 'S']]) put(dir, `${n}.wav`, wav(c));
    const { entry } = await bulk(set, tmp('ud'));
    check('an undetected creator is still flagged', entry && (entry.reviewReasons || []).includes('creator_empty'), JSON.stringify(entry && entry.reviewReasons));
    check('with no creator invented', entry && !entry.author, JSON.stringify(entry && entry.author));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
