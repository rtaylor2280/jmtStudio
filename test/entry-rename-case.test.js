// A font can be renamed to a different capitalisation of its own name.
//
// 2026-10-21: renaming CAL_CYAN to Cal_Cyan failed with "An entry named "Cal_Cyan" already exists".
// Fonts are stored under their name, and on a case-insensitive drive the folder that "already
// exists" is the font's own. A case-only rename is not a collision; a rename onto another font is.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../soundFontEntries.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-rncase-'));
const root = E.entriesRoot(ud);
const mk = (name) => {
  fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, name, 'meta.json'), JSON.stringify({ name, entryUuid: `u-${name}` }));
  fs.writeFileSync(path.join(root, name, 'hum.wav'), `hum of ${name}`);
};
mk('CAL_CYAN'); mk('Other');

const r = E.updateEntryMeta({ userData: ud, currentName: 'CAL_CYAN', newName: 'Cal_Cyan', updates: {} });
check('A CASE-ONLY RENAME IS ACCEPTED', r && r.ok, JSON.stringify(r));
check('the folder now carries the new spelling', fs.readdirSync(root).includes('Cal_Cyan') && !fs.readdirSync(root).includes('CAL_CYAN'),
  fs.readdirSync(root).join(','));
check('its meta says so', JSON.parse(fs.readFileSync(path.join(root, 'Cal_Cyan', 'meta.json'), 'utf8')).name === 'Cal_Cyan');
check('and its files came with it', fs.readFileSync(path.join(root, 'Cal_Cyan', 'hum.wav'), 'utf8') === 'hum of CAL_CYAN');
check('no temporary folder is left behind', fs.readdirSync(root).length === 2, fs.readdirSync(root).join(','));

const r2 = E.updateEntryMeta({ userData: ud, currentName: 'Cal_Cyan', newName: 'other', updates: {} });
check('a rename onto ANOTHER font is still refused', r2 && !r2.ok && r2.existing, JSON.stringify(r2));

fs.rmSync(ud, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
