// JMT sounds for a common folder: asked for from + Add, or offered at SD export when the open config
// needs one. Nothing is added without a yes, and a file already there stays. [B-167]
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('renderer/index.html');
const main = read('main.js');
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

console.log('the sounds');
check('always read from main, outside the add-on manifest', /_JMT_SOUNDS_BASE = `\$\{_JMT_REPO_BASE\}main\/sounds\/`/.test(main) && !/_JMT_SOUNDS_BASE[^\n]*_addonBranch/.test(main));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-held-'));
const uuid = 'held';
const files = path.join(dir, 'soundFonts', 'common', uuid, 'files');
fs.mkdirSync(files, { recursive: true });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
fs.writeFileSync(path.join(files, 'chargebegin.wav'), 'theirs');
fs.writeFileSync(path.join(files, 'chassisin.wav'), 'mine');
fs.writeFileSync(path.join(files, 'CHASSISOUT2.WAV'), 'out');
const { commonSoundsHeld } = require('../soundFontCommon');
const held = commonSoundsHeld(dir, uuid, [{ file: 'chargebegin.wav', sha256: sha('mine') }, { file: 'chassisin.wav', sha256: sha('mine') },
  { file: 'chassisout.wav', sha256: sha('out') }, { file: 'chargecomplete.wav', sha256: sha('x') }]);
check('the same bytes are already there', held.present.has('chassisin.wav'));
check('so is a numbered variant holding them, so adding twice adds nothing', held.present.has('chassisout.wav'));
check('a different file under the name is taken, not present', held.taken.has('chargebegin.wav') && !held.present.has('chargebegin.wav'));
check('a sound it lacks is neither', !held.present.has('chargecomplete.wav') && !held.taken.has('chargecomplete.wav'));
fs.rmSync(dir, { recursive: true, force: true });
check('present files are never asked for again', /filter\(s => !s\.present && \(files \|\| \[\]\)\.includes\(s\.file\)\)/.test(main));
check('bytes are collected as bytes, and checked against the hash', /c => chunks\.push\(c\)/.test(main) && /digest\('hex'\) !== s\.sha256/.test(main));
const fetchAt = main.indexOf('await _httpsGet(`${_JMT_SOUNDS_BASE}${s.file}`');
const addAt = main.indexOf("addFilesToCommon(app.getPath('userData'), uuid, '', paths)");
check('everything is fetched before anything is added', fetchAt > 0 && addAt > fetchAt && !/for \(const s of wanted\)[\s\S]{0,700}addFilesToCommon/.test(main.slice(fetchAt - 300, fetchAt + 200)));
check('the temp folder always goes', /finally \{\s+try \{ if \(dir\) fs\.rmSync\(dir, \{ recursive: true, force: true \}\); \} catch \{\}/.test(main));

console.log('the doors');
check('+ Add offers it, beside the other two', /id="btn-sf-common-add-jmt"/.test(html) && /closest\('#btn-sf-common-add-jmt'\)/.test(html));
check('only once a version has the add-ons, hidden until known', /id="btn-sf-common-add-jmt" class="styles-tag-dropdown-item" style="display:none"/.test(html) && /\.some\(d => d\.jmtVersion\)/.test(html));
check('both doors ask first', (html.match(/title: 'Add JMT add-on sounds\?'/g) || []).length === 2 && (html.match(/if \(yes\) await _sfAddJmtSounds\(uuid, missing\);/g) || []).length === 2);
check('a numbered sound says how to use it', /delete the existing \$\{one \? 'file' : 'files'\} and remove the number/.test(html) && /_sfJmtTakenNote\(sounds\.filter\(s => s\.taken\)/.test(html));
check('no reaching the repo says nothing changed', /'Could not reach the JMT add-on sounds', `Nothing was changed\./.test(html));
check('the export offers before it scans the card, and never stops', /if \(commonSlots\.length\) await _sfOfferJmtSoundsForExport\(commonSlots\);/.test(html) && !/_sfOfferJmtSoundsForExport\(commonSlots\)\) return/.test(html));
check('the export asks only for a JMT config needing the sound', /s\.needs\.some\(d => defines\.has\(d\)\)/.test(html) && /\\bjmt_\\w\+\\\.h\\b/.test(html));
check('preflight stays out of it', !/jmtSounds|JmtSounds/.test(read('renderer/preflight-checks.js')));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
