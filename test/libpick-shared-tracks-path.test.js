// Add files from the library, browsing Shared Tracks: each track is its own selection. The flat
// list must give every node a path, because the selection is keyed by it; without one, three
// ticked tracks collapsed into one blank row and Add (1). [QA06, 2026-11-19]
//
// Run: node test/libpick-shared-tracks-path.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const at = html.indexOf("} else if (kind === 'sharedTracks') {", html.indexOf('_sfLibPickActive = { kind, id };'));
const slice = at > 0 ? html.slice(at, html.indexOf('} catch { _sfLibPickTree = []; }', at)) : '';
ok('the Shared Tracks branch of the library picker was found', slice.length > 0 && slice.length < 800, `length=${slice.length}`);
const map = slice.match(/\.map\(f => \(\{([^}]*)\}\)\)/);
ok('it maps each track to a node', !!map, slice);
ok('and each node carries its path (the file name, as everywhere else for Shared Tracks)',
  !!map && /\bpath:\s*f\.name\b/.test(map[1]), map && map[1]);

// The selection key really is the path: three nodes with three paths give three keys.
const keyFn = html.match(/const _sfLibPickKey = \(([^)]*)\) => ([^;]+);/);
ok('the selection key function was found', !!keyFn);
if (keyFn) {
  const key = new Function(...keyFn[1].split(',').map(s => s.trim()), `return ${keyFn[2]};`);
  const keys = new Set(['Ahsoka.wav', 'blind_cowboy.wav', 'code_fulcrum.wav'].map(p => key('sharedTracks', 'tracks', p)));
  ok('three tracks give three distinct keys', keys.size === 3, [...keys].join(' | '));
  ok('control: a missing path collapses them to one key', new Set([undefined, undefined].map(p => key('sharedTracks', 'tracks', p))).size === 1);
}

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
