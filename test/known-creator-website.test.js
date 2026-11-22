// A creator the app knows brings its website, however the creator was set.
//
// 2026-10-21: typing "KSith" as a source's creator left it with no website, from the source window
// and from the font window alike, though the app knows ksithsaberfonts.com. The import screen
// filled it; the windows did not. The rule now lives where every creator write ends
// (updateSourceMeta), keyed on the creator CHANGING, so a website cleared on purpose stays cleared.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-kcw-'));
const mk = (u, m) => {
  fs.mkdirSync(path.join(S.sourcesRoot(ud), u, 'source'), { recursive: true });
  fs.writeFileSync(path.join(S.sourcesRoot(ud), u, 'meta.json'), JSON.stringify({ uuid: u, format: 'folder', originalName: u, ...m }));
};
const site = (u) => JSON.parse(fs.readFileSync(path.join(S.sourcesRoot(ud), u, 'meta.json'), 'utf8')).vendorWebsite;
mk('a', {}); mk('b', {}); mk('c', { vendor: 'My Maker', vendorWebsite: 'https://mymaker.example/' }); mk('d', {});

console.log('setting a creator');
// The source window sends every field on Save, the website included even when blank.
S.updateSourceMeta(ud, 'a', { vendor: 'KSith', vendorWebsite: '' });
check('A BUILT-IN CREATOR BRINGS ITS WEBSITE (source window)', site('a') === 'https://www.ksithsaberfonts.com/', site('a'));
// The font window routes only the creator.
S.updateSourceMeta(ud, 'b', { vendor: 'my maker' });
check('a creator already in the library brings the website it has there (font window)', site('b') === 'https://mymaker.example/', site('b'));
S.updateSourceMeta(ud, 'd', { vendor: 'Nobody Anyone Knows' });
check('an unknown creator gets nothing invented', !site('d'), JSON.stringify(site('d')));

console.log('leaving the user\'s choice alone');
S.updateSourceMeta(ud, 'a', { vendor: 'KSith', vendorWebsite: '' });
check('A WEBSITE CLEARED WHILE KEEPING THE CREATOR STAYS CLEARED', site('a') === '', JSON.stringify(site('a')));
S.updateSourceMeta(ud, 'c', { vendor: 'KSith' });
check('a website already on the source is never replaced', site('c') === 'https://mymaker.example/', site('c'));

fs.rmSync(ud, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
