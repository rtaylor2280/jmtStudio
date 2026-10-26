// SD Export's slow-write warning waits for the plan when the card has a manifest.
//
//   1. The manifest check is one read of the card's manifest: 'ok' with one, 'absent' without,
//      'unreadable' for a damaged one (sfSyncManifest.readState, behind syncManifest:state).
//   2. The early gate holds the question back only when the state is 'ok', and then does not
//      count it as asked, so the runner's check asks it from the plan's numbers.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

console.log('1. the manifest state, from the real module');
{
  const sync = require(path.join(ROOT, 'sfSyncManifest.js'));
  const card = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-slow-manifest-'));
  check('no manifest reads absent', sync.readState(card).state === 'absent');
  sync.write(card, { version: 1, items: {} });
  const names = fs.readdirSync(card);
  check('CONTROL the write left a manifest on the card', names.some(n => /manifest/i.test(n)), names.join(', '));
  check('a written manifest reads ok', sync.readState(card).state === 'ok');
  fs.writeFileSync(path.join(card, names.find(n => /manifest/i.test(n))), '{ not json');
  check('a damaged manifest is not ok', sync.readState(card).state !== 'ok');
  fs.rmSync(card, { recursive: true, force: true });
}

console.log('2. the early gate');
{
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const pre  = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  check('main answers syncManifest:state from readState',
    /ipcMain\.handle\('syncManifest:state'[\s\S]{0,200}readState\(destDir\)\.state/.test(main));
  check('preload exposes it', /syncManifestState:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\('syncManifest:state'/.test(pre));

  const at = html.indexOf('let _manifestOk = false;');
  const seg = at > -1 ? html.slice(at, at + 1200) : '';
  check('CONTROL the early gate segment was found', seg.length > 0);
  check('only state ok counts', /_manifestOk = !!\(_ms && _ms\.ok && _ms\.state === 'ok'\)/.test(seg));
  check('the early preflight holds the question back with a manifest',
    /_sfPreflightDestination\(\{\s*destDir, totalBytes: _upper, fileCount: _upperFiles,\s*slowWriteDecided: _manifestOk,/.test(seg));
  check('held back is not counted as asked, so the runner asks',
    /_slowWriteAsked = !_manifestOk && !!\(_early\.info && _early\.info\.slowWrite\)/.test(seg));
  check('the runner is told what the early gate asked',
    /slowWriteDecided: _slowWriteAsked,/.test(html));
}

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
