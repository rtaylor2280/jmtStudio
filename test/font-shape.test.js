'use strict';
// What makes a folder a Proffie font, and what names it. Builds real folders and runs the real scan.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fontShapeOf } = require('../proffieFontShape');
const { scanForBulkImport } = require('../soundFontBulkImport');

let failed = 0;
const ok = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || detail === undefined ? '' : `  <- ${detail}`}`);
  if (!cond) failed++;
};

const F = name => ({ name, isFile: () => true, isDirectory: () => false });
const D = name => ({ name, isFile: () => false, isDirectory: () => true });
ok('numbered names and a fontconfig are Xeno', fontShapeOf([F('fontconfig.ini'), F('clash (1).wav'), F('hum (1).wav'), F('boot.wav')]) === 'xeno');
ok('a fontconfig with no effect folders is Xeno', fontShapeOf([F('fontconfig.ini'), F('boot.wav'), F('hum.wav')]) === 'xeno');
ok('effect folders beat a stray fontconfig', fontShapeOf([F('fontconfig.ini'), F('hum.wav'), D('clsh'), D('swng')]) === 'proffie');
ok('a folder that is not an effect does not', fontShapeOf([F('fontconfig.ini'), F('clash (1).wav'), F('hum (1).wav'), D('tracks')]) === 'xeno');
ok('a plain Proffie font', fontShapeOf([F('hum.wav'), D('clsh')]) === 'proffie');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-font-shape-'));
const font = (name, extra = {}) => {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'clsh'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'clsh', 'clsh01.wav'), 'x');
  fs.writeFileSync(path.join(dir, 'hum.wav'), 'x');
  for (const [file, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, file), text);
};

(async () => {
  try {
    font('Daki_v2', { 'fontconfig.ini': 'Daki=(0,66,255),1,0,0,0,0,0,500,500' });
    font('Quantum_Style_1', { 'Blade_Style 1.txt': 'StylePtr<Blue>()' });
    font('Quantum_Style_2', { 'Blade_Style 2.txt': 'StylePtr<Blue>()' });
    font('Quantum_Style_3', { 'Blade_Style 3.txt': 'StylePtr<Blue>()' });
    font('Bank_01');
    font('Bank_02');
    font('Bank_03');
    font('Generic_1', { 'Real Font Name.txt': '' });
    font('Generic_2', { 'Other Font Name.txt': '' });
    font('Generic_3', { 'Third Font Name.txt': '' });
    fs.mkdirSync(path.join(root, 'Shadow_Lord'));
    fs.writeFileSync(path.join(root, 'Shadow_Lord', 'fontconfig.ini'), 'x');
    fs.writeFileSync(path.join(root, 'Shadow_Lord', 'clash (1).wav'), 'x');
    fs.writeFileSync(path.join(root, 'Shadow_Lord', 'hum (1).wav'), 'x');

    const { candidatePreviewRefs } = require('../soundFontBulkImport');
    fs.writeFileSync(path.join(root, 'Daki_v2', 'font.wav'), 'x');
    const refs = await candidatePreviewRefs({ sourcePath: root, candidatePaths: ['Daki_v2', 'Bank_01', 'x.zip!Hidden'] });
    ok('a font finds its font and hum', refs.Daki_v2.font === 'Daki_v2/font.wav' && refs.Daki_v2.hum === 'Daki_v2/hum.wav', JSON.stringify(refs.Daki_v2));
    ok('a font with no font.wav finds only its hum', !refs.Bank_01.font && refs.Bank_01.hum === 'Bank_01/hum.wav', JSON.stringify(refs.Bank_01));
    ok('a font in a nested zip gets none', !refs['x.zip!Hidden']);
    const { plan } = await scanForBulkImport({ rootDir: root });
    const by = new Map(plan.sources.map(s => [s.rawName, s]));
    ok('fixture holds the fonts', plan.sources.length === 10, plan.sources.length);
    ok('a font with a stray fontconfig is one row', by.has('Daki_v2') && !by.has('clsh'));
    ok('a version in a folder name stays', by.get('Daki_v2').cleanedName === 'Daki_v2', by.get('Daki_v2').cleanedName);
    ok('a real Xeno font is reported skipped', plan.skipped.some(s => s.reason === 'no Proffie content found' && /Shadow_Lord$/.test(s.relPath)));
    ok('a blade style file does not name a font', /quantum/i.test(by.get('Quantum_Style_1').cleanedName), by.get('Quantum_Style_1').cleanedName);
    ok('a numbered real name is not flagged uncertain', by.get('Quantum_Style_1').nameSource === 'folder', by.get('Quantum_Style_1').nameSource);
    ok('a slot name still is', by.get('Bank_01').nameSource === 'folder-fallback', by.get('Bank_01').nameSource);
    ok('a name tag still names a numbered folder', /real/i.test(by.get('Generic_1').cleanedName) && by.get('Generic_1').nameSource === 'name-tag', by.get('Generic_1').cleanedName);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const card = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-asteria-'));
  try {
    const { classifyCard } = require('../sdCardDetect');
    fs.mkdirSync(path.join(card, 'Bank1', 'Clash'), { recursive: true });
    fs.mkdirSync(path.join(card, 'Bank1', 'Hum'));
    fs.writeFileSync(path.join(card, 'Bank1', 'Clash', 'clash1.wav'), 'x');
    fs.writeFileSync(path.join(card, 'Bank1', 'Hum', 'hum.wav'), 'x');
    fs.writeFileSync(path.join(card, 'SETTING.txt'), 'x');
    fs.writeFileSync(path.join(card, 'COLORMATRIX.txt'), 'x');
    const c = classifyCard({ mountPath: card });
    ok('an Asteria card is not called Proffie', c.kind === 'asteria', c.kind);
    ok('its banks are not offered as fonts', c.counts.fonts === 0, c.counts.fonts);
    fs.rmSync(path.join(card, 'SETTING.txt'));
    const p = classifyCard({ mountPath: card });
    ok('Bank folders alone stay Proffie', p.kind === 'proffie', p.kind);
  } finally {
    fs.rmSync(card, { recursive: true, force: true });
  }
  assert.ok(true);
  console.log(failed ? `\n${failed} failure(s)` : '\nall font shape tests passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
