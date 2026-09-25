// There is exactly ONE source implementation.  [B-428, 2026-09-24]
//
// ⭐⭐ WHY THIS IS A TEST AND NOT A TIDY-UP. `soundFontSources.js` carried THREE source factories
// and only `_createFolderSource` was ever reachable - the store is an unpacked pool, so no source
// has ever had `format: 'zip'`, and the virtual view additionally required `meta.deduped`. The dead
// ones were not harmless:
//
//   • WRONG EDITS. `async exportToDownloads` matched three identical copies. With four lines of
//     context, still two. The only way in was a line-number-targeted edit into a file with three
//     indistinguishable versions - which is how a change lands that neither of us can see in a
//     diff. It blocked [B-420]'s sidecar fix mid-flight.
//   • WRONG ANSWERS. Conclusions were built on the dead zip path three times in one week and
//     withdrawn each time. His words: *"No, Cody, that's also wrong, and I've had to correct you
//     on this a lot over the last week."*
//
// ⭐ The durable fix was that the misleading code stops existing - 911 lines removed. This guard is
// what stops a second implementation growing back, and it is the entry's own stated DONE WHEN.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'soundFontSources.js'), 'utf8');
const cur = fs.readFileSync(path.join(root, 'soundFontCuration.js'), 'utf8');
// ⚠️ COMMENTS STRIPPED. The history of what was removed is deliberately kept in prose right where
// the code used to be, so a check that reads comments would report the corpse as the patient.
const code = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const S = code(src);
const C = code(cur);

// ── The entry's own DONE WHEN ────────────────────────────────────────
{
  const n = (S.match(/async exportToDownloads/g) || []).length;
  ok(`⭐ exactly one exportToDownloads (${n})`, n === 1,
     'a second copy means an edit can land in the wrong one and be invisible in review - which '
     + 'is the concrete harm this entry was filed for, not tidiness');
}

// ── The dead factories are gone from CODE ────────────────────────────
{
  for (const n of ['_createZipSource', '_virtualizeSource', '_dedupeInnerZipSource',
                   '_extractCanonicalsToDisk']) {
    const c = (S.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
    ok(`  ${n} is gone from code (${c})`, c === 0,
       'still referenced - either it came back or something calls it again');
  }
  for (const n of ['injectIntoZip', 'stripAndRepackage']) {
    const c = (C.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
    ok(`  ${n} is gone from code (${c})`, c === 0);
  }
}

// ── openSource resolves ONE format ───────────────────────────────────
//
// ⚠️ ASSERTED POSITIVELY, not by absence. "No zip branch" would also pass if openSource were
// deleted; what must be true is that it resolves the folder format and refuses anything else.
{
  const i = S.indexOf('function openSource(');
  const j = S.indexOf('\n}', i);
  const body = i > 0 ? S.slice(i, j) : '';
  ok('openSource was located', body.length > 0);
  ok('⭐ it returns the folder source', /_createFolderSource\(\{ uuid, uuidDir, meta \}\)/.test(body));
  ok('⭐ and throws on anything else', /throw new Error\(`Unknown source format/.test(body));
  ok('⚠️ and has no format branch left', !/meta\.format === 'zip'/.test(body),
     'the zip format has never existed on disk; a branch for it is a claim that it might');
}

// ── dedupeSource keeps the live folder path and nothing else ─────────
{
  const i = S.indexOf('async function dedupeSource(');
  const j = S.indexOf('\n}', i);
  const body = i > 0 ? S.slice(i, j) : '';
  ok('dedupeSource was located', body.length > 0);
  ok('⭐ the folder path is intact', /_dedupeFolderSource\(/.test(body),
     'this is the one that actually runs - three callers in main, bulk import and common');
  ok('⚠️ and it returns rather than falling through', /return \{ deduped: false, reason: 'not-zip' \};/.test(body),
     'removing the zip body left this function ending on an `if` with no return, which resolves '
     + 'to undefined and would break every caller that reads `.deduped`');
}

console.log(failed ? `\n${failed} FAILED` : '\none-source-impl: all passing');
process.exit(failed ? 1 : 0);
