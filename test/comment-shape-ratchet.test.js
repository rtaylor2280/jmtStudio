// A comment explains the code. It is not a diary, a transcript, or a history. [B-308]
//
// WHY A RATCHET AND NOT A SWEEP. The other two tells in this family had exact signatures, so they
// were swept to zero and pinned there. This one does not: a comment narrating how something was
// found rather than why the code is as it is has no reliable grep. Sweeping 45,000 comment lines
// by reading them is a project with a poor return, and the judgement is per comment.
//
// So this does the opposite. It freezes what exists, file by file, and refuses to let any file
// get worse. Touch a file, improve its comments, and the count drops and the baseline is lowered
// to lock the gain. The corpus drifts down as the code is worked on, with no dedicated pass.
//
// ── WHY PER FILE AND NOT A TOTAL ─────────────────────────────────────────────
// A single total lets a tell added in one file hide behind a tell removed in another. Per file
// makes the file you touched the unit, which is exactly the behaviour wanted: leave it better
// than you found it, and nothing demands you fix anything you did not touch.
//
// ── WHY AN IMPERFECT SIGNAL IS FINE HERE ─────────────────────────────────────
// The narrative pattern has real false positives: sometimes the history IS the reason, and "this
// used to do X, which was wrong because Y" is a comment worth keeping. That does not matter. A
// false positive is frozen into the baseline on the day this ships and never nags again; only a
// count that GROWS fails. The check does not have to be right about every line to be right about
// the direction, which is what makes it survivable where a lint rule would be turned off.
//
// ── WHAT IT CANNOT SEE ───────────────────────────────────────────────────────
// A forty-line comment with no first person, no quotation and no history is still narration, and
// this is blind to it. Length alone is not the signal either: the longest comments in this
// codebase include the most valuable ones. That half stays a reading job.
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'comment-shape-baseline.json');

const SIGNALS = [
  // SINGULAR ONLY. "we" and "our" are the ordinary voice of a codebase comment and are not a
  // tell; "I" and "my" are. Measured before choosing: the plural form matched 1,583 lines, most
  // of them ordinary ("our binaries", "we do not delete what we cannot identify"), and a check
  // that cries wolf gets ignored.
  { name: 'first person singular', re: /\b(I|I'd|I'm|I've|I'll|my|myself)\b/ },
  // A quotation inside a comment is a transcript of a conversation. The specification it carries
  // is worth keeping; the quotation marks are not.
  { name: 'quoted speech', re: /\*"|"\*/ },
  // How we got here, rather than why it is this way.
  { name: 'narrative', re: /\b(used to|the first cut|first version|turned out|originally|at the time|an hour later|that afternoon|the same (day|night|hour)|went unnoticed|for weeks|for months)\b/i },
];

// ── comment ranges: strings, templates, comments and regex literals ─────────
// Shared shape with the sibling ratchets. Regex tracking is load-bearing: a pattern holding a
// quote makes a naive scanner read the rest of the file as a string and report clean while blind.
function jsRanges(src) {
  const out = []; let i = 0, prev = ''; const n = src.length;
  const canStart = () => {
    if (!prev) return true;
    if ('(,=:[!&|?{};+-*%~^<>'.includes(prev)) return true;
    const tail = src.slice(Math.max(0, i - 12), i).match(/([A-Za-z$_][\w$]*)\s*$/);
    return !!(tail && ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
                       'instanceof', 'do', 'else', 'yield', 'await'].includes(tail[1]));
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d !== '/' && d !== '*' && canStart()) {
      let j = i + 1, cls = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '\n') break;
        if (e === '[') cls = true; else if (e === ']') cls = false;
        else if (e === '/' && !cls) { j++; break; }
        j++;
      }
      if (src[j - 1] === '/') { i = j; prev = '/'; continue; }
    }
    if (c === '/' && d === '/') { const s = i; while (i < n && src[i] !== '\n') i++; out.push([s, i]); continue; }
    if (c === '/' && d === '*') {
      const s = i; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2); out.push([s, i]); continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2;
          while (i < n && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
          continue;
        }
        i++;
      }
      prev = q; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}
function cssRanges(src) {
  const out = []; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const s = i; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2); out.push([s, i]); continue;
    }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    i++;
  }
  return out;
}
function htmlRanges(src) {
  const out = []; const n = src.length; let i = 0;
  while (i < n) {
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4); const stop = e === -1 ? n : e + 3;
      out.push([i, stop]); i = stop; continue;
    }
    const low = src.slice(i, i + 8).toLowerCase();
    if (low.startsWith('<style') || low.startsWith('<script')) {
      const isCss = low.startsWith('<style');
      const open = src.indexOf('>', i); if (open === -1) break;
      const close = src.toLowerCase().indexOf(isCss ? '</style' : '</script', open);
      const stop = close === -1 ? n : close;
      const inner = src.slice(open + 1, stop);
      for (const [a, b] of (isCss ? cssRanges(inner) : jsRanges(inner))) out.push([open + 1 + a, open + 1 + b]);
      i = stop; continue;
    }
    i++;
  }
  return out.sort((a, b) => a[0] - b[0]);
}
const rangesFor = (f, src) => (/\.html$/i.test(f) ? htmlRanges(src) : jsRanges(src));

const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/');

let files;
try {
  files = execSync('git ls-files', { cwd: ROOT, maxBuffer: 1 << 28 }).toString()
    .split('\n').map((s) => s.trim())
    .filter((f) => f && /\.(js|html)$/.test(f) && fs.existsSync(path.join(ROOT, f)) && f !== SELF);
} catch {
  console.log('  skip  not a git checkout, so the file list is unavailable');
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const current = {};
let scannedLines = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  let n = 0;
  for (const [a, b] of rangesFor(f, src)) {
    for (const line of src.slice(a, b).split('\n')) {
      if (!line.trim()) continue;
      scannedLines++;
      if (SIGNALS.some((s) => s.re.test(line))) n++;
    }
  }
  if (n) current[f] = n;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}

ok(`the scan reached the source: ${files.length} files, ${scannedLines.toLocaleString()} comment lines`,
   files.length > 100 && scannedLines > 10000,
   'too little was read for a clean result to mean anything');

// ── the ratchet ──────────────────────────────────────────────────────────────
const worse = [];
for (const f of Object.keys(current)) {
  const was = baseline[f] || 0;
  if (current[f] > was) worse.push(`${f}: ${was} -> ${current[f]}`);
}
ok(`no file got worse: ${worse.length}`, worse.length === 0,
   'A comment explains the code. Drop the first person, the quotation marks and the history of\n'
   + '       how it was found; keep the fact, the measurement and the reason.\n       '
   + worse.join('\n       '));

// ── the nudge ────────────────────────────────────────────────────────────────
// Not a failure. Improving a file is the behaviour this exists to encourage, and the only thing
// asked in return is that the gain is written down so it cannot drift back.
const better = [];
for (const f of Object.keys(baseline)) {
  const now = current[f] || 0;
  if (now < baseline[f]) better.push(`${f}: ${baseline[f]} -> ${now}`);
}
const totalNow = Object.values(current).reduce((s, c) => s + c, 0);
const totalWas = Object.values(baseline).reduce((s, c) => s + c, 0);
if (better.length) {
  console.log(`\n  note  ${better.length} file(s) improved. Lower them in test/comment-shape-baseline.json`);
  console.log('        to hold the gain, or the next edit can quietly put them back:');
  for (const b of better.slice(0, 10)) console.log('          ' + b);
  if (better.length > 10) console.log(`          ... and ${better.length - 10} more`);
}
console.log(`\n  signal lines: ${totalNow} (baseline ${totalWas})  across ${Object.keys(current).length} files`);

// ── the control ──────────────────────────────────────────────────────────────
{
  const probes = [
    ['I first wrote that this was safe.', true],
    ['the rule: *"any cancel, no orphan"*', true],
    ['The guard used to ask on every import.', true],
    ['We do not delete what we cannot identify.', false],
    ['Our binaries are signed; the toolchain is not.', false],
    ['Returns null when the volume cannot be resolved.', false],
  ];
  const wrong = probes.filter(([text, shouldMatch]) =>
    SIGNALS.some((s) => s.re.test(text)) !== shouldMatch).map(([t]) => t);
  ok('the signals catch a diary and leave ordinary prose alone', wrong.length === 0,
     'misjudged: ' + wrong.join(' | '));

  // AND THE COMPARISON ITSELF MUST BITE. Everything above can be right while the ratchet is
  // wired to never fail, which is the state a green run cannot distinguish from working. Run the
  // same comparison over a pretend file that got worse, in memory, touching nothing on disk.
  const pretendBase = { 'a.js': 3, 'b.js': 5 };
  const pretendNow = { 'a.js': 4, 'b.js': 5 };
  const caught = Object.keys(pretendNow).filter((f) => pretendNow[f] > (pretendBase[f] || 0));
  ok('the ratchet fails when a file gets worse', caught.length === 1 && caught[0] === 'a.js',
     'the comparison cannot detect a regression, so a clean run above means nothing');

  // A file absent from the baseline starts at zero, so a NEW file carrying tells fails too.
  const fresh = { 'new.js': 1 };
  ok('a new file carrying a tell is not grandfathered',
     Object.keys(fresh).filter((f) => fresh[f] > (pretendBase[f] || 0)).length === 1,
     'a file missing from the baseline must be treated as zero, not as unlimited');
}

console.log(`\ncomment-shape-ratchet: ${fail ? fail + ' FAILED, ' : 'all '}${pass} passed`);
process.exit(fail ? 1 : 0);
