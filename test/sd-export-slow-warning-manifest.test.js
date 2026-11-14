// SD Export's slow-write warning waits for the plan when the card has a manifest.
//
//   1. The manifest check is one read of the card's manifest: 'ok' with one, 'absent' without,
//      'unreadable' for a damaged one (sfSyncManifest.readState, behind syncManifest:state).
//   2. The early gate asks from the worst case: every selected folder the record does not cover.
//      With nothing uncovered it asks nothing, and the runner's check asks from the plan's numbers.
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
  check('main answers syncManifest:state from readState, with the folders the record covers',
    /ipcMain\.handle\('syncManifest:state'[\s\S]{0,300}readState\(destDir\)[\s\S]{0,300}covered: /.test(main));
  check('preload exposes it', /syncManifestState:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\('syncManifest:state'/.test(pre));

  // 2026-11-13: the question used to be held back whenever ANY record existed, so a card whose
  // record covered 44 of 259 folders compared for minutes through a board with no warning. Now the
  // worst case is every selected folder the record does NOT cover, asked before anything is read.
  const at = html.indexOf('let _manifestOk = false, _covered = new Set();');
  const seg = at > -1 ? html.slice(at, at + 1600) : '';
  check('CONTROL the early gate segment was found', seg.length > 0);
  check('only state ok counts', /_manifestOk = !!\(_ms && _ms\.ok && _ms\.state === 'ok'\)/.test(seg));
  check('covered folders come from that same answer, only when it is ok',
    /if \(_manifestOk && Array\.isArray\(_ms\.covered\)\) _covered = new Set\(_ms\.covered\);/.test(seg));
  check('a covered font is left out of the worst case', /for \(const nm of names\) \{\s*if \(_covered\.has\(nm\)\) continue;/.test(seg));
  check('a covered common slot is left out of the worst case', /for \(const cs of commonSlots\) \{\s*if \(_covered\.has\(cs\.slot\)\) continue;/.test(seg));
  check('the early preflight asks from the worst case, never held back',
    /_sfPreflightDestination\(\{\s*destDir, totalBytes: _upper, fileCount: _upperFiles, worstCase: true,\s*\}\)/.test(seg));
  // The right-click doors that compare through the destination ask the same worst case up front
  // (2026-11-13). The runner asks it before the plan.
  check('the runner asks a door\'s worst case before its plan, and not again after',
    /await door\.worstCase\(\)/.test(html) && /slowWriteDecided: door\.slowWriteDecided === true \|\| _slowAskedEarly,/.test(html));
  check('the right-click font export declares its worst case (fonts the record does not hold)',
    /worstCase: async \(\) => \{\s*let covered = new Set\(\);[\s\S]{0,400}for \(const nm of _fonts\) \{\s*if \(covered\.has\(nm\)\) continue;/.test(html));
  check('the tracks export declares its worst case (all tracks unless the record holds them)',
    /worstCase: async \(\) => \{[\s\S]{0,300}ms\.covered\.includes\('tracks'\)\) return null;/.test(html));
  // It is a worst case, so the dialog says "up to" (2026-11-13: it warned 110.4 MB, wrote 87.7).
  check('the dialog says "up to" for a worst case',
    /This \$\{w\.noun\} is \$\{upTo \? 'up to ' : ''\}\$\{size\}/.test(html)
    && /_sfSlowWriteDialog\(\{ \.\.\.p\.slowWrite, upTo: worstCase \}\)/.test(html));
  check('asked early is counted, so the runner does not ask twice',
    /_slowWriteAsked = !!\(_early\.info && _early\.info\.slowWrite\);/.test(seg));
  check('the runner is told what the early gate asked',
    /slowWriteDecided: _slowWriteAsked,/.test(html));
}

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
