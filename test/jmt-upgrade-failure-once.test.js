// A JMT version that could not be made at startup is said once and not retried on every launch.
// Once the JMT choice is Always, startup makes every missing JMT version; a failure is recorded
// against the manifest revision and app version, keeps that base out of `due` until either
// changes, is cleared by a later success, and is shown once in plain words. [B-677]
//
// Run: node test/jmt-upgrade-failure-once.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const cv = require('../coreVersions');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const M = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const V = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'versionsPanel.js'), 'utf8');

function lift(src, decl) {
  const s = src.indexOf(decl);
  if (s < 0) throw new Error(`not found: ${decl}`);
  let depth = 0, j = src.indexOf('{', src.indexOf(') {', s));
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(s, j);
}

// eslint-disable-next-line no-new-func
const due = new Function(
  `${lift(M, 'function _jmtFailHolds')}\n${lift(M, 'function _jmtDue')}\nreturn _jmtDue;`)();
// eslint-disable-next-line no-new-func
const words = new Function(`${lift(V, 'function _vpJmtFailureWords')}\nreturn _vpJmtFailureWords;`)();

const base = {
  choice: 'always', supported: ['3.6.0', '4.6.0'], available: ['3.6.0', '4.6.0'],
  offered: { '3.6.0': 'x', '4.6.0': 'x' }, failed: {}, revision: 1, appVersion: '1.8.0',
  jmtVersionOf: cv.jmtVersionOf,
};
const fail36 = { '3.6.0': { revision: 1, appVersion: '1.8.0', error: 'boom' } };

console.log('1. due');
ok('Always, nothing failed: both are due', JSON.stringify(due(base)) === '["3.6.0","4.6.0"]', JSON.stringify(due(base)));
ok('a failure on this revision and app version keeps that base out',
  JSON.stringify(due({ ...base, failed: fail36 })) === '["4.6.0"]', JSON.stringify(due({ ...base, failed: fail36 })));
ok('a new manifest revision tries again',
  due({ ...base, failed: fail36, revision: 2 }).includes('3.6.0'));
ok('a new app version tries again',
  due({ ...base, failed: fail36, appVersion: '1.8.1' }).includes('3.6.0'));
ok('a base whose JMT version exists is not due',
  !due({ ...base, available: ['3.6.0', '4.6.0', '4.6.0-jmt'] }).includes('4.6.0'));
ok('Never: nothing is due', due({ ...base, choice: 'never' }).length === 0);
ok('Ask: only never-offered bases, still minus a held failure',
  JSON.stringify(due({ ...base, choice: 'ask', offered: {}, failed: fail36 })) === '["4.6.0"]');

console.log('2. the upgrade records and clears');
const up = M.slice(M.indexOf("ipcMain.handle('core:upgradeToJmt'"), M.indexOf('function _jmtOfferRecord'));
ok('a failure is recorded before returning', /if \(!made\.ok\) \{ _jmtFailRecord\(base, made\.error\); return made; \}/.test(up));
ok('a thrown install error is recorded too', /catch \(e\) \{ made = \{ ok: false/.test(up));
ok('a success clears the record', up.indexOf('_jmtFailClear(base)') > up.indexOf('_jmtFailRecord('));
const rec = lift(M, 'function _jmtFailRecord');
ok('the record carries the manifest revision and app version',
  /revision: _jmtManifestRevision\(\)/.test(rec) && /appVersion: app\.getVersion\(\)/.test(rec));
ok('the record lives beside the offers', /Store\.set\('jmtPluginFailed'/.test(rec));
const st = M.slice(M.indexOf("ipcMain.handle('core:jmtOfferState'"), M.indexOf("ipcMain.handle('core:jmtOfferAnswered'"));
ok('the offer state computes due through _jmtDue with the failures', /_jmtDue\(\{[^}]*failed/.test(st));

console.log('3. said once, in plain words');
const chk = lift(V, 'window.checkJmtPluginOffer = async function checkJmtPluginOffer');
ok('a startup failure shows a toast', /else \{[\s\S]*?showToast\?\.\(_vpJmtFailureWords\(base, res && res\.error\)/.test(chk));
const compilerErr = 'Proffieboard Plugin 3.6.0 JMT was not made: the compiler it would share is not exactly the ' +
  'official release, so it was left alone. C:\\x\\tools: mismatch';
const w1 = words('3.6.0', compilerErr);
ok('the compiler refusal is named plainly', /compiler it shares with 3\.6\.0 is not the official release/.test(w1), w1);
ok('no folder paths or check names reach the toast', !/C:\\|mismatch|digest|fingerprint/i.test(w1), w1);
const w2 = words('4.6.0', 'arduino-cli: exit status 1 ENOENT /tmp/foo');
ok('any other failure is generic, without the raw error', !/arduino-cli|ENOENT|\/tmp/.test(w2) && /Could not add 4\.6\.0 JMT/.test(w2), w2);
ok('it says what still works and how to try again', /works as before/.test(w2) && /Install JMT Patch/.test(w2));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
