// Comments explain the code. They do not track what is going to be built.
//
// A comment describing planned work is wrong the day that work ships, and nothing ever goes back
// to correct it - so it rots into a confident statement about a thing that already happened, or
// never will. The reader then has to decide which. That is worse than no comment.
//
// This does NOT sweep what is already here. The existing entries below are frozen as a baseline
// and left alone deliberately; several are legitimate (a note that a version check "stays true
// when 4.7 lands" explains today's code rather than promising tomorrow's). The check exists for
// one purpose: the number must not go UP.
//
// ⚠️ WHAT THIS CANNOT CATCH, said plainly so nobody mistakes a green run for a good comment: it
// finds roadmap VOCABULARY. It cannot see forty lines of narrative wrapped around a four-line
// conditional, or a paragraph of provenance where one sentence of reasoning would do. The only
// test for those is asked while writing: does this line stop someone making a wrong change? If
// not, it is decoration, and decoration is what makes real warnings easy to skim past.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ⚠️ `renderer/vs` is vendored Monaco - not ours to hold to this, and it carries its own hits.
const SKIP_DIRS = new Set(['node_modules', '.git', 'local', 'qa', 'dist', 'staging', '.claude', 'vs']);

const PATTERN = /(\bTODO\b|\bFIXME\b|⏭|\bwhen (?:it|that|this|[0-9][0-9a-z.]*) lands\b|will be (?:built|added|wired|done)\b|\bis being built\b|\bnot yet built\b|\bsomeday\b)/i;

// Frozen 2026-09-25. Lower it when real ones are removed; never raise it.
const BASELINE = 11;

// ⚠️⚠️ WHICH SITES, not just how many - so a failure can name the one that is actually NEW.
// The report used to be `hits.slice(BASELINE)`: everything past the eleventh in directory-walk
// order, which has nothing to do with which one was added. On 2026-10-01 it blamed
// `toolchain.js:654` for a line added in `renderer/index.html`, simply because index.html walks
// later. A check that fails loudly and points at the wrong file costs more than one that only
// says the number moved - the first thing it buys is a wasted search.
//
// ⚠️ MEASURED, NOT REMEMBERED. The first draft of this list was written from memory and got
// seven of eleven wrong: it named cacheManager.js, versionsPanel.js and preflight-checks.js,
// which have none, and missed compileErrors.js, sdCardDetect.js and four test files entirely.
// Regenerate it by running the same walk rather than by editing it by hand.
//
// ⚠️ Keyed on FILE + WORD and counted, not on line numbers. Lines shift constantly; a count per
// key survives that, and `filter-chip-grouping.test.js` genuinely holds two `⏭` so a plain Set
// would silently merge them and hide the next one.
const FROZEN = new Map(Object.entries({
  'compileErrors.js|when that lands':             1,
  'main.js|⏭':                                    1,
  'renderer/index.html|⏭':                        1,
  'renderer/index.html|will be added':            1,
  'sdCardDetect.js|todo':                         1,
  'test/export-runner-ratchet.test.js|todo':      1,
  'test/export-runner-ratchet.test.js|⏭':         1,
  'test/filter-chip-grouping.test.js|⏭':          2,
  'test/mount-sd-comment-on-leave.test.js|⏭':     1,
  'toolchain.js|when 4.7 lands':                  1,
}));
const keyOf = h => `${h.file}|${h.word.toLowerCase()}`;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.js') || e.name === 'index.html') {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT, [])) {
  // ⚠️ Skip this file. It quotes the very words it looks for, so without this the check counts
  // itself and the baseline drifts by however many examples the explanation needs.
  if (path.resolve(file) === path.resolve(__filename)) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    const s = line.trim();
    // Comment lines only. A string literal containing "TODO" is not a comment.
    if (!(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*'))) return;
    const m = PATTERN.exec(s);
    if (m) hits.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line: i + 1, word: m[0] });
  });
}

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// Everything beyond what the frozen multiset accounts for. A file+word that was already here
// twice and is now here three times reports the third.
const seen = new Map();
const added = [];
for (const h of hits) {
  const k = keyOf(h);
  const n = (seen.get(k) || 0) + 1;
  seen.set(k, n);
  if (n > (FROZEN.get(k) || 0)) added.push(h);
}

ok(`roadmap language in comments has not grown (${hits.length} of ${BASELINE})`,
   hits.length <= BASELINE,
   'a comment that describes work not yet done is wrong the day it ships and nobody goes back '
   + 'to fix it. Say what the code DOES, and why it is shaped that way if a future reader would '
   + 'otherwise undo it. Park the plan where plans live.\n       New: '
   + (added.length
       ? added.map(h => `${h.file}:${h.line} "${h.word}"`).join(', ')
       : '(count grew but every site matches the frozen set - regenerate FROZEN)'));

if (hits.length < BASELINE) {
  console.log(`  note  down to ${hits.length} - lower BASELINE in this file to hold the gain`);
}

console.log(failed ? `\n${failed} FAILED` : '\ncomment-roadmap-ratchet: all passing');
process.exit(failed ? 1 : 0);
