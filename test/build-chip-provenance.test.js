/**
 * The build-status chips say WHICH build, not just that one happened  [B-028]
 *
 * THE REPRO, app left open ~9h overnight: compiled + flashed (9:22 PM), disconnected the
 * board, ran a second compile purely to warm the cache (9:55 PM), left it. In the
 * morning the chips read
 *     "Compile restored from cache"  +  "Flash successful"
 * together, which says "the current file is on the board". False twice over: the flash
 * predates the current build, and there was no board attached at all.
 *
 * ⭐ THE FLASH CHIP WAS A SESSION FLAG. It recorded that a flash had succeeded at some
 * point, never WHICH build it put there, so nothing could ever contradict it.
 *
 * ⚠️ AND THE MISLABEL HAD ITS OWN TRIGGER, pinned the same morning: clicking CLOSE on
 * the still-open build modal re-runs the content-hash cache check, which HITS — that
 * compile just populated the cache — and relabelled this session's own build "restored
 * from cache". The check could not tell "this hit IS the build I just made" from
 * "restored a prior build on open".
 *
 * Run: node test/build-chip-provenance.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src  = fs.readFileSync(path.join(ROOT, 'renderer', 'buildPanel.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── the flash chip carries an identity ─────────────────────────────────────
{
  ok('a flashed build is stamped', /let _flashedBuildKey\s+= null;/.test(src));
  const stamp = src.slice(src.indexOf('_flashedBuildKey = {'), src.indexOf('_flashedBuildKey = {') + 400);
  ok('the stamp records the config hash', /configHash:\s+\(_currentBuildKey && _currentBuildKey\.configHash\) \|\| null/.test(stamp), stamp);
  ok('and when it happened', /at: Date\.now\(\)/.test(stamp), stamp);
  ok('it is only set on a SUCCESSFUL flash',
     /if \(ok\) \{[\s\S]{0,400}?_flashedBuildKey = \{/.test(src));
}

// ── it degrades honestly instead of lying ──────────────────────────────────
{
  const fn = src.slice(src.indexOf('function _refreshFlashProvenance'),
                       src.indexOf('function _refreshFlashProvenance') + 1600);
  ok('the provenance check exists', fn.length > 200);
  ok('a superseded build says so, with a date',
     /Board has an older build \(\$\{when\}\)/.test(fn), fn);
  ok('it degrades rather than clearing',
     /setStatus\('flash', 'warn'/.test(fn),
     'the board really does have something on it; a date is more use than going blank');
  ok('and the hover says what to do about it', /Flash again to update it\./.test(fn));

  // ⚠️ THREE WAYS THIS COULD BECOME THE SAME BUG POINTED THE OTHER WAY.
  ok('no flash this session means it says nothing',
     /if \(!_flashedBuildKey\) return;/.test(fn),
     'it must not invent a flash that never happened');
  ok('an unknown hash on either side is NOT a mismatch',
     /if \(!currentConfigHash \|\| !_flashedBuildKey\.configHash\) return;/.test(fn),
     'calling the board stale because WE failed to identify a build is the same lie');
  ok('it does not seize a chip someone else owns',
     /if \(!\/\^Flash\/\.test\(text\.textContent \|\| ''\)\) return;/.test(fn), fn);
}

// ── the cache hit knows whose build it is ──────────────────────────────────
{
  ok('the session records what it genuinely compiled',
     /const _sessionBuiltHashes = new Set\(\);/.test(src));
  ok('a real compile files its hash as ours',
     /checkCacheForConfig\(false, \{ afterCompile: true \}\)/.test(src),
     'the compile result does not carry the hash; the cache check is where it is learned');
  ok('only an afterCompile check may file one',
     /if \(opts && opts\.afterCompile && result\.configHash\) _sessionBuiltHashes\.add/.test(src),
     'otherwise opening a config would claim its cached build as this session\'s work');

  const label = src.slice(src.indexOf("setStatus('compile', 'ok',\n"), src.indexOf("setStatus('compile', 'ok',\n") + 320)
             || src.slice(src.indexOf("_sessionBuiltHashes.has(result.configHash)") - 200, src.indexOf("_sessionBuiltHashes.has(result.configHash)") + 200);
  ok('a hit on OUR build reads "Compile successful"',
     /_sessionBuiltHashes\.has\(result\.configHash\)\)?\s*\r?\n?\s*\?\s*'Compile successful'/.test(src), label);
  ok('and a genuine restore still says so',
     /:\s*'Compile restored from cache'/.test(src), label);
}

// ── the stamp does not outlive its file ────────────────────────────────────
{
  const reset = src.slice(src.indexOf('window.resetBuildStatusForFileLoad'),
                          src.indexOf('window.resetBuildStatusForFileLoad') + 900);
  ok('opening another config clears the flash stamp', /_flashedBuildKey = null;/.test(reset), reset);
  ok('and clears the hover text with it', /_ft\.title = 'Not flashed';/.test(reset), reset);
}

// ── every current flash carries its timestamp ──────────────────────────────
{
  ok('a successful flash gets hover provenance', /if \(ok\) _decorateFlashChip\(\);/.test(src));
  const dec = src.slice(src.indexOf('function _decorateFlashChip'), src.indexOf('function _decorateFlashChip') + 400);
  ok('which names when it happened', /flashed \$\{when\}/.test(dec), dec);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall build chip provenance tests passed');
process.exit(failures ? 1 : 0);
