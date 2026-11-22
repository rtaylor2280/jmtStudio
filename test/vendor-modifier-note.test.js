// The Thexter default fonts are credited to Thexter and carry a "Modifications by Brian Conner"
// line, which detection hands back as `vendorNote` for the source's notes.
// Readme text is the shipped SmthJedi/ReadMe.txt from profezzorn/SoundFonts.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');
const V = require('../soundFontVendors.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const SMTHJEDI = 'SmthJedi\r\n'
  + 'Smoothswing sound font for ProffieOS by Thexter.\r\n'
  + '\r\n'
  + 'Modifications by Brian Conner 2022:\r\n'
  + 'Sounds for boot.wav sourced from creative-commons licensed freesound.org.\r\n'
  + 'See license.txt for more details.\r\n';

async function detect(readme) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-vnote-'));
  fs.mkdirSync(path.join(d, 'SmthJedi'));
  fs.writeFileSync(path.join(d, 'SmthJedi', 'ReadMe.txt'), readme);
  fs.writeFileSync(path.join(d, 'SmthJedi', 'hum.wav'), Buffer.alloc(64));
  try {
    return await V.detectVendor(S.openSourceAtPath(d), {});
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

(async () => {
  const r = await detect(SMTHJEDI);
  check('the creator is Thexter, not the modifier', r && r.vendor === 'Thexter',
        JSON.stringify(r && r.vendor));
  check('the modifier line comes back as the note, without its trailing colon',
        r && r.vendorNote === 'Modifications by Brian Conner 2022', JSON.stringify(r && r.vendorNote));

  const plain = await detect(SMTHJEDI.replace(/Modifications by[^\r\n]*\r\n/, ''));
  check('a Thexter readme with no modifier line has no note',
        plain && plain.vendor === 'Thexter' && plain.vendorNote == null,
        JSON.stringify({ v: plain && plain.vendor, n: plain && plain.vendorNote }));
  check('and no conversion credit', plain && plain.creditNote == null, JSON.stringify(plain && plain.creditNote));

  // A font converted from Xenopixel: the converter's summary names nobody, so there is no creator,
  // but the conversion is credited whatever creator is or is not found.
  const CONVERTED = '=====================================\r\nCONVERSION SUMMARY\r\n'
    + '=====================================\r\nConverted: 2025-08-07 13:29:39\r\nSource: Xenopixel font\r\n'
    + 'Target: Proffie format\r\nFont Name: Techno\r\n\r\nConverter: Xenopixel to Proffie v1.0\r\n'
    + '=====================================\r\n';
  const conv = await detect(CONVERTED);
  check('A CONVERTED FONT CARRIES THE CONVERSION CREDIT', conv && conv.creditNote === 'Converted to Proffie by JMT Sabers',
        JSON.stringify(conv && conv.creditNote));
  check('with no creator invented for it', conv && conv.vendor == null, JSON.stringify(conv && conv.vendor));
  const both = await detect(SMTHJEDI + '\r\nConverter: Xenopixel to Proffie v1.0\r\n');
  check('and a creator match keeps its own note beside it',
        both && both.vendor === 'Thexter' && both.vendorNote === 'Modifications by Brian Conner 2022'
        && both.creditNote === 'Converted to Proffie by JMT Sabers', JSON.stringify(both && { v: both.vendor, n: both.vendorNote, c: both.creditNote }));

  console.log(failures ? `\n${failures} FAILED` : '\nall passing');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
