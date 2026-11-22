// No emphasis emoji in a code comment. [B-308]
//
// WHY THIS IS A TEST. 5,189 of them were swept out of 167 files on 2026-10-09. They arrive one at
// a time, each one feeling like a reasonable way to flag an important line, and the codebase is a
// third comments by volume, so the drift back is fast and invisible. The attribution rule in the
// sibling check regrew from zero four separate times on memory alone.
//
// WHAT IS A TELL AND WHAT IS NOT. A star or a warning sign used to SHOUT at the next reader is
// decoration that reads as machine-written; emphasis in prose is word order and sentence length.
// A pictograph that is CONTENT is a different thing and is left alone: a comment describing the
// play glyph on a button, an arrow in a diagram, the copyright sign.
//
// ── THE DANGEROUS PART, AND WHY THIS IS POSITION-AWARE ────────────────────────
// The same warning character appears in both a comment and the user interface:
//     content: ' ⚠'                     the badge on a broken style card
//     appendLog(`\n⚠ ${error}`)         the prefix on every build-log error line
// A character search would have deleted both. Nothing here may be decided by the character
// alone; a marker is only a tell if it sits inside a comment, so this check carries its own
// comment scanner and proves it on those two cases before reporting anything.
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// The emphasis set only. Everything else stays: the survey that preceded the sweep found the
// lightning, gear, play, folder, bulb, eject, note and arrow glyphs in use as content, either in
// a UI label or in a comment describing one.
const MARKERS = /⚠️|⚠|⭐|⛔|⏭|✅|❌|🚨|🔇/u;
const MARKERS_G = /⚠️|⚠|⭐|⛔|⏭|✅|❌|🚨|🔇/gu;

// ── Comment ranges ───────────────────────────────────────────────────────────
// Tracks strings, template literals, comments and REGEX LITERALS. The last is not optional:
// main.js holds /[\/:*?"<>|]/g, a quote inside a character class, and without regex tracking the
// scanner reads it as a string start and loses three hundred lines of comment coverage. It
// reported clean while being blind, which is the failure this whole file exists to avoid.
function jsRanges(src) {
  const out = [];
  let i = 0, prev = '';
  const n = src.length;
  const regexCanStart = () => {
    if (!prev) return true;
    if ('(,=:[!&|?{};+-*%~^<>'.includes(prev)) return true;
    const tail = src.slice(Math.max(0, i - 12), i).match(/([A-Za-z$_][\w$]*)\s*$/);
    return !!(tail && ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
                       'instanceof', 'do', 'else', 'yield', 'await'].includes(tail[1]));
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d !== '/' && d !== '*' && regexCanStart()) {
      let j = i + 1, cls = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '\n') break;
        if (e === '[') cls = true;
        else if (e === ']') cls = false;
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

// Regex-literal ranges, by the same tokenizer. A marker inside a PATTERN is data the test
// matches on, not emphasis: stripping one broke test/error-config-filename.test.js, which
// asserts the source contains appendLog with a warning glyph in it.
function jsRegexRanges(src) {
  const out = [];
  let i = 0, prev = '';
  const n = src.length;
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
      const s = i;
      let j = i + 1, cls = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '\n') break;
        if (e === '[') cls = true;
        else if (e === ']') cls = false;
        else if (e === '/' && !cls) { j++; break; }
        j++;
      }
      if (src[j - 1] === '/') { out.push([s, j]); i = j; prev = '/'; continue; }
    }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
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
      const e = src.indexOf('-->', i + 4);
      const stop = e === -1 ? n : e + 3;
      out.push([i, stop]); i = stop; continue;
    }
    const low = src.slice(i, i + 8).toLowerCase();
    if (low.startsWith('<style') || low.startsWith('<script')) {
      const isCss = low.startsWith('<style');
      const open = src.indexOf('>', i);
      if (open === -1) break;
      const closeTag = isCss ? '</style' : '</script';
      const close = src.toLowerCase().indexOf(closeTag, open);
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

let files;
try {
  files = execSync('git ls-files', { cwd: ROOT, maxBuffer: 1 << 28 }).toString()
    .split('\n').map((s) => s.trim())
    .filter((f) => f && /\.(js|html)$/.test(f) && fs.existsSync(path.join(ROOT, f)));
} catch {
  console.log('  skip  not a git checkout, so the file list is unavailable');
  process.exit(0);
}

const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/');
const hits = [];
let scannedRanges = 0, outsideMarkers = 0;
for (const f of files) {
  if (f === SELF) continue;                               // this file names the markers on purpose
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const ranges = rangesFor(f, src);
  scannedRanges += ranges.length;
  const inAny = (idx) => ranges.some(([a, b]) => idx >= a && idx < b);
  let m;
  MARKERS_G.lastIndex = 0;
  while ((m = MARKERS_G.exec(src))) {
    if (!inAny(m.index)) { outsideMarkers++; continue; }   // UI text, left alone
    const line = src.slice(0, m.index).split('\n').length;
    hits.push(`${f}:${line}  ${(src.split('\n')[line - 1] || '').trim().slice(0, 92)}`);
  }
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}

// ── The controls, before the result is allowed to mean anything ──────────────
// Both are real lines in this codebase that a character sweep would destroy.
{
  const html = fs.readFileSync(path.join(ROOT, 'renderer/index.html'), 'utf8');
  const r = htmlRanges(html);
  const badge = html.indexOf("content: ' ⚠'");
  ok('the broken-style badge is seen as UI, not a comment',
     badge > 0 && !r.some(([a, b]) => badge >= a && badge < b),
     'the scanner would sweep the badge off every broken style card');

  const build = fs.readFileSync(path.join(ROOT, 'renderer/buildPanel.js'), 'utf8');
  const log = build.indexOf('appendLog(`\\n⚠ ');
  const rb = jsRanges(build);
  ok('the build-log error prefix is seen as UI, not a comment',
     log > 0 && !rb.some(([a, b]) => log >= a && log < b),
     'the scanner would strip the warning glyph from every error line in the build log');

  // and the inverse: a marker that IS in a comment must be seen
  const probe = jsRanges("const a = 1; // ⚠ note\n");
  ok('a marker inside a line comment is seen as a comment',
     probe.some(([a, b]) => "const a = 1; // ⚠ note\n".indexOf('⚠') >= a
                         && "const a = 1; // ⚠ note\n".indexOf('⚠') < b),
     'the scanner cannot find a comment it is standing in');
}

ok(`the scan reached the source: ${files.length} files, ${scannedRanges.toLocaleString()} comment ranges`,
   files.length > 100 && scannedRanges > 5000,
   'too little was read for a clean result to mean anything');

ok(`no emphasis emoji in code comments: ${hits.length}`, hits.length === 0,
   `${hits.length} found. Emphasis in a comment is word order and sentence length, not a glyph.`
   + `\n       ` + hits.slice(0, 12).join('\n       ')
   + (hits.length > 12 ? `\n       ... and ${hits.length - 12} more` : ''));

// ── test assertion labels ────────────────────────────────────────────────────
// A third category, neither comment nor UI: the text a test prints when it runs. 962 of these
// were swept on 2026-10-09. They are developer-facing, they ship in a public repository, and a
// glyph adds nothing a capital letter does not.
//
// Two things are deliberately NOT caught here. A marker inside a REGEX LITERAL is a pattern the
// test matches on. And three files name the markers as data: the roadmap ratchet detects one and
// keys its baseline on it, and the two tell-ratchets carry planted controls they must detect.
{
  const NAMES_MARKERS_ON_PURPOSE = new Set([
    'test/comment-roadmap-ratchet.test.js',
    'test/comment-attribution-ratchet.test.js',
    'test/comment-emoji-ratchet.test.js',
  ]);
  const labelHits = [];
  let keptInPatterns = 0;
  for (const f of files) {
    if (!/^test\/.*\.js$/.test(f) || NAMES_MARKERS_ON_PURPOSE.has(f)) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const cr = jsRanges(src), rr = jsRegexRanges(src);
    const inside = (i, rs) => rs.some(([a, b]) => i >= a && i < b);
    let m;
    MARKERS_G.lastIndex = 0;
    while ((m = MARKERS_G.exec(src))) {
      if (inside(m.index, cr)) continue;
      if (inside(m.index, rr)) { keptInPatterns++; continue; }
      const line = src.slice(0, m.index).split('\n').length;
      labelHits.push(`${f}:${line}  ${(src.split('\n')[line - 1] || '').trim().slice(0, 88)}`);
    }
  }
  ok(`no emphasis emoji in test assertion labels: ${labelHits.length}`, labelHits.length === 0,
     `${labelHits.length} found.\n       ` + labelHits.slice(0, 10).join('\n       '));
  console.log(`  note  ${keptInPatterns} marker(s) inside regex literals left alone (pattern data)`);
}

console.log(`\n  note  ${outsideMarkers} markers outside comments were left alone (UI text)`);
console.log(`\ncomment-emoji-ratchet: ${fail ? fail + ' FAILED, ' : 'all '}${pass} passed`);
process.exit(fail ? 1 : 0);
