// A folder is a Proffie font, a Xeno font, or neither, by its own files; the card's verdict follows
// its fonts, never the other board's files left at its root. [B-461]
//
// The card report printed "27 sound fonts" one line under "This looks like a Xeno card, not
// Proffie." The card was a Proffie card carrying another board's leftover config.ini and set/. And
// five real Xeno backups showed the opposite error: a Xeno font holding one plain boot.wav was
// counted as a Proffie font, by the card count and by the import scan alike.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../sdCardDetect.js');
const B = require('../soundFontBulkImport.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'b461-'));
const file = (p, body = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
function card(name, build) {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  build(root);
  return D.assessCard({ drive: root, mountPath: root, fileSystem: 'FAT32', label: null,
    volumeSerial: null, sizeBytes: null, freeBytes: null, health: 'Healthy', isFolder: false });
}
// A Proffie saber font, unpacked layout, as on his E: card.
const proffieFont = (dir) => { file(path.join(dir, 'hum1.wav')); for (const fx of ['clsh', 'font', 'swng', 'in', 'out']) file(path.join(dir, fx, `${fx}1.wav`)); };
// A real Xeno font: "name (N).wav", a fontconfig.ini, and (in some) one plain boot.wav.
const xenoFont = (dir, { strayBoot = false, fontconfig = true } = {}) => {
  for (const fx of ['clash', 'hum', 'swing', 'blaster', 'lock']) for (let i = 1; i <= 4; i++) file(path.join(dir, `${fx} (${i}).wav`));
  if (fontconfig) file(path.join(dir, 'fontconfig.ini'), '[x]');
  if (strayBoot) file(path.join(dir, 'boot.wav'));
};
const xenoCardRoot = (root) => file(path.join(root, 'setting', 'config.ini'), '[x]');
const leftoverRoot = (root) => {
  file(path.join(root, 'config.ini'), '[Speed]\nSpeedofturnon= 5\n');
  file(path.join(root, 'system_flag.ini'), '[Sound_Light_Flag]\nSoundflag= 28\n');
  file(path.join(root, 'global.ini'), 'x');
  file(path.join(root, 'set', 'charging.wav'));
};

console.log('which folders are Proffie fonts, and what the card is (B-461)');

// 1. HIS E: CARD, an SNV4 card body (system_flag.ini, all-lightfile/) with Proffie-format fonts.
const c1 = card('e-card', (root) => {
  leftoverRoot(root); file(path.join(root, 'all-lightfile', 'file1', 'light1.bin'));
  for (let i = 1; i <= 5; i++) proffieFont(path.join(root, String(i)));
});
check('control: all five fonts are counted', c1.classification.counts.fonts === 5, String(c1.classification.counts.fonts));
check('IT APPEARS TO BE AN SNV4 CARD, NOT XENO', c1.classification.kind === 'snv4' && c1.verdict.headline === 'This appears to be an SNV4 card.',
  `${c1.classification.kind} | ${c1.verdict.headline}`);
check('and its Proffie-format fonts are offered',
  c1.verdict.detail === 'Some of its sound fonts may still be usable: 5 are in Proffie format and can be added to your library.', c1.verdict.detail);

// 1b. Another board's files at the root WITHOUT the SNV4 marks: the fonts decide, leftovers named.
const c1b = card('leftovers', (root) => {
  file(path.join(root, 'config.ini'), '[x]'); file(path.join(root, 'global.ini')); file(path.join(root, 'set', 'charging.wav'));
  for (let i = 1; i <= 2; i++) proffieFont(path.join(root, String(i)));
});
check('THE FONTS DECIDE: A PROFFIE CARD WITH LEFTOVERS', c1b.classification.kind === 'proffie' && c1b.verdict.headline === 'This is a Proffie card.',
  `${c1b.classification.kind} | ${c1b.verdict.headline}`);
check('the leftovers are named, global.ini is not one of them',
  /settings files from another board \(config\.ini, set\/\)\. ProffieOS ignores them\./.test(c1b.verdict.detail) && !/global\.ini/.test(c1b.verdict.detail),
  c1b.verdict.detail);

// 2. A REAL XENO CARD, one font holding a stray boot.wav.
const c2 = card('xeno-real', (root) => { xenoCardRoot(root); xenoFont(path.join(root, '1'), { strayBoot: true }); for (let i = 2; i <= 4; i++) xenoFont(path.join(root, String(i))); });
check('A XENO FONT WITH ONE PLAIN boot.wav IS NOT A PROFFIE FONT', c2.classification.counts.fonts === 0, String(c2.classification.counts.fonts));
check('the card reads Xeno, with no Proffie claim', c2.classification.kind === 'xeno' && c2.verdict.headline === 'This looks like a Xeno card, not Proffie.',
  `${c2.classification.kind} | ${c2.verdict.headline}`);
check('an older Xeno font with no fontconfig.ini is still Xeno, by its file names',
  B.looksLikeProffieDir(path.join(base, 'xeno-real', '2')) === false
  && (() => { const d = path.join(base, 'xeno-old'); xenoFont(d, { fontconfig: false, strayBoot: true }); return !B.looksLikeProffieDir(d); })(), '');
check('THE IMPORT SCAN AGREES: it will not import the Xeno font', B.looksLikeProffieDir(path.join(base, 'xeno-real', '1')) === false, '');

// 3. A Xeno card someone added one Proffie font to: it says both.
const c3 = card('xeno-plus', (root) => { xenoCardRoot(root); xenoFont(path.join(root, '1')); xenoFont(path.join(root, '2')); proffieFont(path.join(root, '3')); });
check('a Xeno card holding a Proffie font says both',
  c3.verdict.headline === 'This is a Xeno card holding 1 Proffie font.' && /Its other 2 fonts are not Proffie\./.test(c3.verdict.detail),
  `${c3.verdict.headline} | ${c3.verdict.detail}`);

// 4. A BLASTER FONT has no hum, and is a font.
const c4 = card('blaster', (root) => { for (const f of ['blast01.wav', 'clipin.wav', 'clipout.wav', 'empty.wav', 'full.wav', 'jam.wav']) file(path.join(root, 'E11', f)); });
check('A BLASTER FONT (NO HUM) IS A PROFFIE FONT', c4.classification.counts.fonts === 1 && c4.classification.kind === 'proffie',
  `${c4.classification.counts.fonts} ${c4.classification.kind}`);
check('the import scan takes it too', B.looksLikeProffieDir(path.join(base, 'blaster', 'E11')) === true, '');

// 5. Voice prompts alone are not a font.
const c5 = card('voice', (root) => { for (const f of ['battery.wav', 'mnum1.wav', 'volup.wav', 'mute.wav']) file(path.join(root, 'voice', f)); });
check('a folder of voice prompts only is not a font', c5.classification.counts.fonts === 0, String(c5.classification.counts.fonts));

// 6. Proffie numbered banks, nothing else: a Proffie card, not mixed.
const c6 = card('banks', (root) => { for (let i = 1; i <= 3; i++) proffieFont(path.join(root, String(i))); });
check('numbered Proffie banks read as a Proffie card, not mixed',
  c6.classification.kind === 'proffie' && c6.classification.mixed === false && !/another board/.test(c6.verdict.detail),
  `${c6.classification.kind} mixed=${c6.classification.mixed} | ${c6.verdict.detail}`);

// 7. A named-font Proffie card in the effect-folder layout, with no common folder.
const c7 = card('named', (root) => { proffieFont(path.join(root, 'Ahsoka')); });
check('a named-font Proffie card reads as Proffie (was unrecognized when its font used effect folders)', c7.classification.kind === 'proffie' && c7.verdict.headline === 'This is a Proffie card.',
  `${c7.classification.kind} | ${c7.verdict.headline}`);

fs.rmSync(base, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
