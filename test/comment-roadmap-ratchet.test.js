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

ok(`roadmap language in comments has not grown (${hits.length} of ${BASELINE})`,
   hits.length <= BASELINE,
   'a comment that describes work not yet done is wrong the day it ships and nobody goes back '
   + 'to fix it. Say what the code DOES, and why it is shaped that way if a future reader would '
   + 'otherwise undo it. Park the plan where plans live.\n       New: '
   + hits.slice(BASELINE).map(h => `${h.file}:${h.line} "${h.word}"`).join(', '));

if (hits.length < BASELINE) {
  console.log(`  note  down to ${hits.length} - lower BASELINE in this file to hold the gain`);
}

console.log(failed ? `\n${failed} FAILED` : '\ncomment-roadmap-ratchet: all passing');
process.exit(failed ? 1 : 0);
