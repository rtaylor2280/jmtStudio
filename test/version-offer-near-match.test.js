// A single folder nearly identical to a font whose source holds only that font is offered as a version
// of it, as an identical folder is on the duplicate-source dialog. [BUG-030]
'use strict';
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let fails = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fails++; };

const fn = HTML.slice(HTML.indexOf('async function _sfVersionOfferFor'), HTML.indexOf('function _sfShowVersionOffer'));
check('the offer exists', fn.length > 0);
check('one font only', /cands\.length !== 1/.test(fn));
check('never a zip', /\\.zip\$/.test(fn));
check('near matches only (have_it or version), never an owned copy; extras owned elsewhere still count', /x\.identical/.test(fn) && /'have_it'/.test(fn) && /'version'/.test(fn));
check('the matched font is alone in its source', /sourceUuid === srcUuid\)\.length !== 1/.test(fn));
check('a folder of several fonts is refused', /'contains'/.test(fn) && /'not-a-font'/.test(fn));

const show = HTML.slice(HTML.indexOf('function _sfShowVersionOffer'), HTML.indexOf('function _sfShowDuplicateFont'));
check('Add as a version goes through Add from folder on the matched font', /_sfAddFontFromFolder\(vo\.matchName, sourcePath\)/.test(show));
check('Add as a version discards the source this import stored', /_sfCloseImport\(\);\s*\/\/ discards/.test(show));
check('the button names the font', /Add as a version of \$\{vo\.matchName\}/.test(show));

const run = HTML.slice(HTML.indexOf('const _preMatch = await _sfMatchCandidatesOnce();'), HTML.indexOf('const _pickProof'));
check('asked after the owned-copy check, never after Re-import as a new source', /else if \(!forceNewSource\)/.test(run) && /_sfVersionOfferFor\(_preMatch, sourcePath\)/.test(run));
check('the dialog markup is there', /id="modal-sf-version-offer"/.test(HTML) && /id="sf-verof-add"/.test(HTML));

check('main reports identical only for the same files', /identical: _owned && !_elsewhere/.test(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')));
check('an owned-elsewhere copy is not "already in your library"', /x\.identical \|\| matchRes\.results\.length > 1/.test(HTML));

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log('\nall passing');
