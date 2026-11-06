/**
 * The catalogue fills in past 70%, suggests below that, and never lets a small add-in or a
 * wrong creator win. The percentage counts the catalogue font's sounds, so extras cost nothing.
 *
 * Run: node test/font-catalogue.test.js
 */
'use strict';

const { FontCatalogue, mergeDetection } = require('../fontCatalogue');
let shipped = null;
try { shipped = require('../fontCatalogueData.json'); } catch {}

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : `  ${detail}`}`);
};

const hashes = (tag, n, from = 0) => Array.from({ length: n }, (_, i) => `${tag}${String(i + from).padStart(6, '0')}`);
const sounds = list => list.map((h, i) => [`hum${i}.wav`, h]);
const font = (name, list) => ({ id: name, name, demo: `demo/${name}`, store: `store/${name}`, sounds: sounds(list) });

const big = hashes('big', 100);
const addin = big.slice(0, 5);
const cat = new FontCatalogue({ creators: [
  { id: 'a', name: 'Maker A', website: 'a.example', fonts: [font('Big', big), font('AddIn', addin)] },
  { id: 'b', name: 'Maker B', website: 'b.example', fonts: [font('Other', hashes('oth', 50))] },
  { id: 'c', name: 'Maker C', website: '', fonts: [font('V1', hashes('ver', 40)), font('V2', hashes('ver', 40))] },
] });

const whole = cat.identify(big);
ok('every sound found fills in', whole.tier === 'fill' && whole.font.name === 'Big' && whole.percent === 100);
const extras = cat.identify([...big, ...hashes('extra', 20)]);
ok('added sounds cost nothing', extras.tier === 'fill' && extras.percent === 100);
ok('a small add-in never takes the bigger font', whole.font.name !== 'AddIn');
ok('the add-in alone still names itself', cat.identify(addin).matched === 5);

ok('70 percent fills in', cat.identify(big.slice(10, 80)).tier === 'fill');
const below = cat.identify(big.slice(10, 79));
ok('69 percent is a name suggestion', below.tier === 'name' && below.font.name === 'Big');
ok('55 percent still suggests the name', cat.identify(big.slice(10, 65)).tier === 'name');
const creatorOnly = cat.identify(big.slice(10, 64));
ok('54 percent gives the creator only', creatorOnly.tier === 'creator' && creatorOnly.font === null
  && creatorOnly.creator.name === 'Maker A');
ok('35 percent still gives the creator', cat.identify(big.slice(10, 45)).tier === 'creator');
ok('34 percent gives nothing', cat.identify(big.slice(10, 44)) === null);
ok('two sounds are never enough', cat.identify(addin.slice(0, 2)) === null);
ok('two identical fonts do not guess a name', cat.identify(hashes('ver', 40)).tier === 'creator');

const records = list => list.map((h, i) => ({ relPath: `hum${i}.wav`, fileHash: h }));
const bundle = [...records(hashes('oth', 50)).map(r => ({ ...r, relPath: `One/${r.relPath}` })),
                ...records(big).map(r => ({ ...r, relPath: `Two/${r.relPath}` }))];
const found = cat.identifySource(bundle, ['One', 'Two']);
ok('a bundle is read font by font', found.byPath.One.font.name === 'Other' && found.byPath.Two.font.name === 'Big');
ok('the strongest font speaks for the bundle', found.best.font.name === 'Big');

const named = { vendor: 'From the readme', confidence: 'content' };
const fill = mergeDetection(named, cat.identifySource(records(big), ['']));
ok('a fill beats what the files said', fill.vendor === 'Maker A' && fill.confidence === 'content');
ok('a fill carries the store link', fill.catalogue.store === 'store/Big');
const hint = cat.identifySource(records(big.slice(0, 40)), ['']);
ok('a suggestion never replaces a named creator', mergeDetection(named, hint).vendor === 'From the readme');
ok('a suggestion fills a gap as a suggestion', mergeDetection({ vendor: null }, hint).confidence === 'structural');
ok('a suggestion carries no store link', mergeDetection({ vendor: null }, hint).catalogue.store === '');
ok('no match changes nothing', mergeDetection(named, { byPath: {}, best: null }).vendor === 'From the readme');

ok('an empty catalogue matches nothing', new FontCatalogue(null).identify(big) === null);
if (shipped) {
ok('the shipped catalogue has no personal share links',
  !JSON.stringify(shipped).match(/drive\.google|dropbox\.com/));
const full = new FontCatalogue(shipped);
let right = 0;
for (const e of full.fonts) {
  const r = full.identify(e.font.sounds.map(s => s[1]));
  if (r && r.tier === 'fill' && r.font.name === e.font.name) right++;
}
const sample = full.fonts[0].font.sounds.map(x => x[1]);
ok('full length hashes match too', full.identify(sample.map(h => h.padEnd(64, '0'))).tier === 'fill');
ok('the shipped fonts recognize themselves', right >= full.fonts.length - 1, `${right} of ${full.fonts.length}`);
}

console.log(failed ? `\n${failed} failure(s)` : '\nall font catalogue tests passed');
process.exit(failed ? 1 : 0);
