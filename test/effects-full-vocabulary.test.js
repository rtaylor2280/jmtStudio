// Every ProffieOS 8.10 effect counts as known, so slsh, clash or poweron no longer show as unknown,
// and entries stamped with the older list are recomputed once. [B-557]
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const entries = require('../soundFontEntries.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-fx-'));
const dir = path.join(ud, 'soundFonts', 'library', 'Liquid-Sword');
const wav = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'RIFF'); };
wav(path.join(dir, 'slsh', 'slsh01.wav'));   // a real 8.10 effect the old list lacked, as a folder
wav(path.join(dir, 'clash01.wav'));          // and as a flat file
wav(path.join(dir, 'hum.wav'));
wav(path.join(dir, 'zzzfx', 'zzzfx1.wav'));  // control: effect-shaped, not a ProffieOS effect
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
  name: 'Liquid-Sword', effects: ['hum'], unknownEffects: ['slsh'],
}));
const meta = () => JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));

console.log('1. an entry stamped with the old list is recomputed');
const r1 = entries.restampStaleEffects(ud);
check('one entry recomputed', r1.restamped === 1, JSON.stringify(r1));
check('slsh (folder) and clash (flat file) are known', meta().effects.includes('slsh') && meta().effects.includes('clash'), JSON.stringify(meta().effects));
check('slsh is no longer unknown', !meta().unknownEffects.includes('slsh'), JSON.stringify(meta().unknownEffects));
check('the control stays unknown', JSON.stringify(meta().unknownEffects) === '["zzzfx"]', JSON.stringify(meta().unknownEffects));
check('stamped with the current list', meta().effectsVocab === entries.EFFECTS_VOCAB);

console.log('2. once only');
check('nothing recomputed on the second run', entries.restampStaleEffects(ud).restamped === 0);

fs.rmSync(ud, { recursive: true, force: true });
if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall passing');
