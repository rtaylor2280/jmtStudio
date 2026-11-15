// Every Windows shell-out lives in winDisks.js or winSystem.js. [B-681]
//
// PowerShell, cmd, reg, fsutil, tasklist and taskkill launched from an Electron app are the
// pattern behaviour-based antivirus blocks (QA BUG-012). Keeping every such launch in two files
// makes the set of outside programs Studio starts on Windows readable in one place, and lets
// them be replaced with native calls without hunting. This fails when one appears anywhere else.
//
// WHAT COUNTS AS A LAUNCH: a string literal naming one of those programs as the first argument of
// execFile / execFileSync / spawn / spawnSync / exec / execSync / _exec, or as the start of the
// command string handed to exec / execSync. Comment lines are ignored, so prose that mentions a
// launch does not trip it.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALLOWED = new Set(['winDisks.js', 'winSystem.js']);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}

const PROGRAMS = 'powershell|pwsh|cmd|reg|fsutil|tasklist|taskkill';
const LAUNCH_RE = new RegExp(
  String.raw`\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec|_exec)\s*\(\s*(['"\x60])\s*(?:`
  + PROGRAMS + String.raw`)(?:\.exe)?(?=\1|\s)`, 'gi');

// Blank out comment lines and block comments, keeping line numbers.
function stripComments(src) {
  const lines = src.split('\n');
  let inBlock = false;
  return lines.map((line) => {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return '';
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      return '';
    }
    if (t.startsWith('//') || t.startsWith('*')) return '';
    return line;
  }).join('\n');
}

function launchesIn(src) {
  const code = stripComments(src);
  const hits = [];
  let m;
  LAUNCH_RE.lastIndex = 0;
  while ((m = LAUNCH_RE.exec(code))) {
    const lineNo = code.slice(0, m.index).split('\n').length;
    hits.push({ line: lineNo, text: m[0] });
  }
  return hits;
}

// Repo-root .js files plus everything under renderer/ (not renderer/vs, the bundled Monaco).
function sourceFiles() {
  const out = [];
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.js')) out.push(e.name);
  }
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) {
        if (r === 'renderer/vs' || e.name === 'node_modules') continue;
        walk(r);
      } else if (e.isFile() && e.name.endsWith('.js')) out.push(r);
    }
  };
  walk('renderer');
  return out;
}

// ── the scanner can see a launch at all ─────────────────────────────────────
{
  const fixture = [
    "const { execFile } = require('child_process');",
    "execFile('powershell.exe', ['-NoProfile'], () => {});",
    "spawn('taskkill', ['/pid', '1', '/T', '/F']);",
    "exec(`reg query HKLM\\\\X /v Y`, () => {});",
    "await _exec('cmd.exe', ['/c', 'start']);",
    "// execFile('fsutil', ['fsinfo']) in a comment is prose, not a launch",
    "execFile(dfuUtil, ['-l']);",
    "execFile('unzip', ['-q']);",
    "execFile('registry-tool', []);",
  ].join('\n');
  const hits = launchesIn(fixture);
  ok('a fixture with four launches is caught four times', hits.length === 4, JSON.stringify(hits));
  ok('a launch inside a comment line is not counted', !hits.some((h) => /fsutil/.test(h.text)));
  ok('a program whose name only starts with one of these is not counted',
     !hits.some((h) => /registry-tool/.test(h.text)));
}

// ── the two homes really do hold the launches (so a clean result is not vacuous) ──
{
  const disks = launchesIn(fs.readFileSync(path.join(ROOT, 'winDisks.js'), 'utf8'));
  const sys = launchesIn(fs.readFileSync(path.join(ROOT, 'winSystem.js'), 'utf8'));
  const joined = (hs) => hs.map((h) => h.text).join(' | ');
  ok(`winDisks.js launches are found: ${disks.length}`, disks.length >= 6, joined(disks));
  for (const p of ['powershell.exe', 'fsutil', 'cmd.exe']) {
    ok(`winDisks.js: ${p} is found`, disks.some((h) => h.text.toLowerCase().includes(p)), joined(disks));
  }
  ok(`winSystem.js launches are found: ${sys.length}`, sys.length >= 7, joined(sys));
  for (const p of ['taskkill', 'tasklist', 'reg', 'powershell']) {
    ok(`winSystem.js: ${p} is found`, sys.some((h) => new RegExp(`['"\`]${p}`, 'i').test(h.text)), joined(sys));
  }
}

// ── nowhere else ────────────────────────────────────────────────────────────
{
  const files = sourceFiles();
  ok(`the scan reached the source: ${files.length} files`, files.length > 50);
  const stray = [];
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    for (const h of launchesIn(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
      stray.push(`${f}:${h.line}  ${h.text}`);
    }
  }
  ok(`no Windows shell-out outside winDisks.js / winSystem.js: ${stray.length}`, stray.length === 0,
     'Move the launch into winDisks.js (card and volume work) or winSystem.js (everything else).\n       '
     + stray.join('\n       '));
}

console.log(`\nwindows-shellouts-one-place: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
