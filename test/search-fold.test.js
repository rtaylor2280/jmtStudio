'use strict';
// Runs the page's own search helpers, lifted out of renderer/index.html.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const start = html.indexOf('function _searchFold(text)');
const end = html.indexOf('function _applyStylesSearch()');
if (start < 0 || end < start) { console.error('search helpers not found'); process.exit(1); }
const slice = html.slice(start, end);
if (!/function _searchHit/.test(slice)) { console.error('slice is missing _searchHit'); process.exit(1); }
const { _searchBlob, _searchHit } = new Function(`${slice}; return { _searchBlob, _searchHit };`)();

let failed = 0;
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++; };
const q = text => text.toLowerCase();

const halo = _searchBlob(['Halo_Blade_Style-1', 'JayDalorian']);
ok('a hyphen finds an underscore name', _searchHit(_searchBlob(['Quantum_Style_1']), q('style-1')));
ok('an underscore finds a hyphen name', _searchHit(halo, q('style_1')));
ok('a space finds both', _searchHit(halo, q('style 1')) && _searchHit(_searchBlob(['Binary_Light']), q('binary light')));
ok('no separator finds both', _searchHit(_searchBlob(['He-Man']), q('heman')) && _searchHit(_searchBlob(['Obi-Wan Kenobi']), q('obi wan')));
ok('plain text still matches', _searchHit(halo, q('halo')));
ok('an empty query matches', _searchHit(halo, ''));
ok('a miss is a miss', !_searchHit(halo, q('quantum')));
ok('a match cannot run across two fields', !_searchHit(_searchBlob(['Fire', 'Kyberphonic']), q('fire kyber')));
ok('punctuation only matches as typed', _searchHit(_searchBlob(['Style-1']), '-') && !_searchHit(_searchBlob(['Style 1']), '-'));
ok('missing fields are skipped', _searchHit(_searchBlob(['Fire', undefined, '', 'Greyscale']), q('grey')));

console.log(failed ? `\n${failed} failure(s)` : '\nall search tests passed');
process.exit(failed ? 1 : 0);
