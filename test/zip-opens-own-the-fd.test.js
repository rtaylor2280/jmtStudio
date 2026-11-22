// Every zip this app opens must own its file descriptor. [B-479]
//
// node-stream-zip opens the file itself when given `{ file }`, and when a read FAILS its
// close() reports success and leaks the descriptor anyway. No error, no exception, nothing to
// log - so a correct-looking `finally { await zip.close(); }` is not protection. Every site in
// this app had one and all of them leaked.
//
// WHAT IT COST: a restore from a board-mounted saber failed, and the card then refused to eject
// with "In use". The holder was us. `sdCardDetect.js` is on this list too, which means a zip on
// a card that failed to read was leaving a descriptor on that volume on every scan.
//
// WHY A RATCHET AND NOT JUST THE FIX: twelve sites were converted on 2026-10-11, and nothing
// stops the thirteenth being written the old way. `{ file: ... }` is the obvious spelling and
// the one every example online uses, so it will be reached for again. The failure is silent -
// no test goes red, no error appears, the descriptor just stays open - which is exactly the
// class of thing that only a check catches.
//
// Run: node test/zip-opens-own-the-fd.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const ROOT = path.join(__dirname, '..');

// Tracked source only, and never our own tooling or tests: `git ls-files` is the same scope the
// comment ratchets use, so an untracked scratch file cannot trip this and a new shipped module
// cannot escape it.
let files = [];
try {
  files = execFileSync('git', ['ls-files'], { cwd: ROOT, maxBuffer: 1 << 28 })
    .toString().split('\n')
    .filter(f => f.endsWith('.js'))
    .filter(f => !f.startsWith('dist/') && !f.startsWith('local/') && !f.startsWith('test/'))
    .filter(f => f !== 'zipOpen.js');
} catch (err) {
  console.log('  FAIL could not list tracked files: ' + err.message);
  process.exit(1);
}

// Comments are stripped so prose ABOUT the old spelling - including the comments in zipOpen.js
// and in this file's own siblings - is not mistaken for a call.
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const BY_PATH = /new\s+StreamZip\.async\s*\(\s*\{[^}]*\bfile\s*:/;
const findAll = (src) => {
  const out = [];
  const re = new RegExp(BY_PATH.source, 'g');
  let m;
  while ((m = re.exec(src))) out.push(src.slice(0, m.index).split('\n').length);
  return out;
};

const offenders = [];
let scanned = 0, owned = 0;
for (const f of files) {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  scanned++;
  const clean = decomment(src);
  owned += (clean.match(/openZipOwned\s*\(/g) || []).length;
  for (const line of findAll(clean)) offenders.push(`${f}:${line}`);
}

// ── the scan's own preconditions, before anything is concluded from a clean result ──
ok('the scan reached the source', scanned > 20,
   `only ${scanned} files scanned; a near-empty sweep passes for free`);
ok('and it found the owned-fd helper in use', owned > 0,
   'no openZipOwned call sites found at all - either the scan is pointed at the wrong tree '
   + 'or the fix is gone, and either way a clean result below means nothing');

// ── the assertion ──
ok('no zip is opened by path', offenders.length === 0,
   offenders.length
     ? `open by path, so a failed read leaks the descriptor:\n       ${offenders.join('\n       ')}`
       + '\n       Use openZipOwned(path, opts) from zipOpen.js instead.'
     : '');

// ── CONTROL: the detector must catch the shape it exists to prevent ──
const mutant = "const z = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true });";
ok('control: the detector CATCHES an open-by-path', findAll(mutant).length === 1,
   'the pattern does not match the very thing it bans, so the pass above is worthless');
ok('control: it does NOT flag the owned form',
   findAll("const z = openZipOwned(zipPath, { skipEntryNameValidation: true });").length === 0,
   'the detector fires on the correct form too, which would make it unusable');
ok('control: it does NOT flag the fd form',
   findAll("const z = new StreamZip.async({ fd, skipEntryNameValidation: true });").length === 0,
   'an explicit fd is the whole point of the fix and must not be flagged');
ok('control: prose about the old spelling is ignored',
   findAll(decomment("// never write new StreamZip.async({ file: p })")).length === 0,
   'comments explaining the rule would trip it, so every file documenting this would fail');

console.log(`\nzip-opens-own-the-fd: scanned ${scanned} files, ${owned} owned-open call sites`);
console.log(`zip-opens-own-the-fd: ${failed ? failed + ' FAILED' : 'all checks passed'}`);
process.exit(failed ? 1 : 0);
