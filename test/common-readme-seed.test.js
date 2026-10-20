// A pack's own readme fills in what we would otherwise ask the user to type.   [B-493]
//
// NoSloppy's voicepacks ship `a_ReadMe.txt` in a fixed shape, and two of its lines are fields
// this app has somewhere to put:
//
//     <PackName> - <Creator> <year>
//     <blank>
//     <one-line description>
//     <blank>
//     <support url>
//
// The CREATOR half reaches the source through the vendor table. The DESCRIPTION has no other
// home, so the import seeds it onto the working copy.
//
// MEASURED AGAINST THE REAL PACKS before this was written: 10 of 16 common folders on the dev
// fixture carry a readme of this shape and parse correctly; the other 6 ship none and come back
// empty. These cases pin the shape and the ways it can be absent.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');
const C = require('../soundFontCommon.js');
const V = require('../soundFontVendors.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
function wav(body) {
  const data = Buffer.alloc(1024, body);
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
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-rdme-${n}-`));

// Build a pack folder whose readme is whatever the case needs.
function pack(readme) {
  const d = tmp('pack');
  put(d, 'common/mmain.wav', wav('M'));
  put(d, 'common/voicepack.ini', Buffer.from('version=2\r\n'));
  if (readme !== null) put(d, 'common/a_ReadMe.txt', Buffer.from(readme));
  return d;
}

(async () => {
  const dirs = [];
  const run = async (label, readme) => {
    const src = pack(readme);
    const ud = tmp('ud');
    dirs.push(src, ud);
    const r = await C.importCommonFromFolder(ud, path.join(src, 'common'), label);
    if (!r || !r.ok) return { err: r && r.error, ud };
    const c = C.listCommons(ud)[0];
    return { desc: (c && c.meta && c.meta.description) || null, ud, uuid: r.sourceUuid };
  };

  console.log('a readme in the shipped shape seeds the description');

  const real = await run('Shaped',
    'ProffieOS_V2_Voicepack_Din_Djarin - NoSloppy 2024\r\n'
    + '\r\n'
    + 'Din Djarin - The Mandalorian\r\n'
    + '\r\n'
    + 'https://www.buymeacoffee.com/BrianConner\r\n');
  check('the description is the line after the credit, not the credit itself',
        real.desc === 'Din Djarin - The Mandalorian', JSON.stringify(real.desc));

  // CRLF is what these files actually ship with, so LF-only is the variant worth proving too.
  const lf = await run('Unix',
    'Pack - NoSloppy 2024\n\nA one line summary.\n\nhttps://example.com/\n');
  check('line endings do not change the answer', lf.desc === 'A one line summary.',
        JSON.stringify(lf.desc));

  // Thrawn's real readme has TWO blank lines after the credit line.
  const gap = await run('Gap', 'Pack - NoSloppy 2024\r\n\r\n\r\nExtra blank line above.\r\n');
  check('more than one blank line after the credit is still fine',
        gap.desc === 'Extra blank line above.', JSON.stringify(gap.desc));

  // ── The ways it is absent, each of which must leave the field empty ──
  const none = await run('NoReadme', null);
  check('no readme leaves the description empty', none.desc === null, JSON.stringify(none.desc));

  const creditOnly = await run('CreditOnly', 'Pack - NoSloppy 2024\r\n');
  check('a credit line with nothing under it seeds nothing',
        creditOnly.desc === null, JSON.stringify(creditOnly.desc));

  // The support URL sits where a description would be when the description is missing.
  // Seeding a link as the description would be worse than seeding nothing.
  const urlNext = await run('UrlNext',
    'Pack - NoSloppy 2024\r\n\r\nhttps://www.buymeacoffee.com/BrianConner\r\n');
  check('a URL in the description slot is refused', urlNext.desc === null,
        JSON.stringify(urlNext.desc));

  const empty = await run('Empty', '');
  check('an empty readme seeds nothing', empty.desc === null, JSON.stringify(empty.desc));

  // ── The creator half, through the table rather than the parser ──
  {
    const src = pack('Pack - NoSloppy 2024\r\n\r\nSomething.\r\n');
    const ud = tmp('ud');
    dirs.push(src, ud);
    const r = await C.importCommonFromFolder(ud, path.join(src, 'common'), 'Creator');
    const sm = S.readSourceMeta(path.join(S.sourcesRoot(ud), r.sourceUuid));
    check('the import detects and records the creator',
          !!(sm && sm.vendor === 'Brian Conner (NoSloppy)' && sm.vendorAutoDetected === true),
          JSON.stringify({ v: sm && sm.vendor, auto: sm && sm.vendorAutoDetected }));
  }
  // A pack by someone else must not be claimed by the handle pattern.
  {
    const src = pack('Pack - SomeoneElse 2024\r\n\r\nSomething.\r\n');
    const ud = tmp('ud');
    dirs.push(src, ud);
    const r = await C.importCommonFromFolder(ud, path.join(src, 'common'), 'Other');
    const sm = S.readSourceMeta(path.join(S.sourcesRoot(ud), r.sourceUuid));
    check('a readme naming someone else is not claimed',
          !(sm && sm.vendor === 'Brian Conner (NoSloppy)'), JSON.stringify(sm && sm.vendor));
  }

  // The language packs ship LICENSE.txt and no a_ReadMe.txt. First lines as shipped in English E.
  const licensed = async (label, license) => {
    const src = pack(null);
    put(src, 'common/LICENSE.txt', Buffer.from(license));
    const ud = tmp('ud');
    dirs.push(src, ud);
    const r = await C.importCommonFromFolder(ud, path.join(src, 'common'), label);
    return S.readSourceMeta(path.join(S.sourcesRoot(ud), r.sourceUuid));
  };
  {
    const sm = await licensed('License',
      'Edit Mode Menu Prompts Copyright (c) 2021 Brian Conner\r\n'
      + ' This audio was created using text-to-speech services provided free for\r\n'
      + ' commercial use by FreeTTS and Google Translate.\r\n');
    check('a LICENSE.txt-only language pack is credited',
          !!(sm && sm.vendor === 'Brian Conner (NoSloppy)' && sm.vendorAutoDetected === true),
          JSON.stringify({ v: sm && sm.vendor, auto: sm && sm.vendorAutoDetected }));
  }
  {
    const sm = await licensed('Modifier', 'Font by Someone.\r\nModifications by Brian Conner\r\n');
    check('a modifier credit in LICENSE.txt is not claimed',
          !(sm && sm.vendor === 'Brian Conner (NoSloppy)'), JSON.stringify(sm && sm.vendor));
  }

  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
