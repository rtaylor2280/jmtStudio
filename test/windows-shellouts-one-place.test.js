// The only Windows shell-outs left are winSystem.js's two elevated helper launches. [B-681]
//
// PowerShell, cmd, reg, fsutil, tasklist and taskkill launched from an Electron app are the
// pattern behaviour-based antivirus blocks (QA BUG-012). Keeping every such launch in one file
// makes the set of outside programs Studio starts on Windows readable in one place, and lets
// them be replaced with native calls without hunting. This fails when one appears anywhere else.
//
// winDisks.js (card detection, export destinations, safe eject) answers everything through the
// Win32 API in winDisksNative.js, and winSystem.js's registry read, DFU driver-service lookup,
// process list and process-tree kill go through winSystemNative.js, both on workers started by
// winNativeRun.js. Those four files are held at ZERO launches and no child_process at all.
// winSystem.js keeps exactly two launches - the elevated DFU driver and WebUSB fix helpers,
// replaced in a later phase by a signed helper - and nothing else.
//
// WHAT COUNTS AS A LAUNCH: a string literal naming one of those programs as the first argument of
// execFile / execFileSync / spawn / spawnSync / exec / execSync / _exec, or as the start of the
// command string handed to exec / execSync. Comment lines are ignored, so prose that mentions a
// launch does not trip it.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALLOWED = new Set(['winSystem.js']);

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

// ── the native files launch nothing ─────────────────────────────────────────
{
  for (const f of ['winDisks.js', 'winDisksNative.js', 'winSystemNative.js', 'winNativeRun.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const hits = launchesIn(src);
    ok(`${f} has zero shell-outs`, hits.length === 0, hits.map((h) => `${h.line} ${h.text}`).join(' | '));
    // Wider than the launch pattern: no child process of ANY program, under any name.
    ok(`${f} does not use child_process`, !/child_process/.test(stripComments(src)));
  }
}

// ── winSystem.js: the two elevated helper launches, and nothing else ────────
// The scanner's own fixture above proves it can see a launch; this proves the real file still
// has the two it must find (so "nothing stray" is not a blind scan), that they are PowerShell,
// and that each sits in its own helper function. Everything else the file does is native.
{
  const SRC = fs.readFileSync(path.join(ROOT, 'winSystem.js'), 'utf8');
  const code = stripComments(SRC);
  const sys = launchesIn(SRC);
  const joined = (hs) => hs.map((h) => `${h.line} ${h.text}`).join(' | ');
  ok(`winSystem.js has exactly two launches: ${sys.length}`, sys.length === 2, joined(sys));
  ok('both are PowerShell', sys.every((h) => /\(\s*'powershell$/.test(h.text)), joined(sys));
  const bodyOf = (name) => {
    const at = code.indexOf(`function ${name}(`);
    if (at < 0) return '';
    const next = code.indexOf('\nfunction ', at + 1);
    return code.slice(at, next < 0 ? code.length : next);
  };
  for (const fn of ['launchDfuDriverHelper', 'launchWebUsbFixHelper']) {
    const body = bodyOf(fn);
    ok(`${fn} holds one of them`, launchesIn(body).length === 1, body ? '' : 'function not found');
    ok(`${fn} still elevates with -Verb RunAs`, /-Verb RunAs/.test(body));
  }
  ok('child_process is used for execFile only (the helper launches)',
     /const \{ execFile \} = require\('child_process'\);/.test(code)
     && (code.match(/child_process/g) || []).length === 1
     && !/\bspawn\s*\(/.test(code), 'a spawn here would be a launch the scan above has not been told about');
  for (const [fn, what] of [['killTree', 'taskkill'], ['arduinoRunning', 'tasklist'], ['dfuBoundService', 'Get-PnpDevice'],
                            ['regQuery', 'reg query'], ['expandArchive', 'Expand-Archive']]) {
    const body = bodyOf(fn);
    ok(`${fn} launches nothing (was ${what})`, !!body && launchesIn(body).length === 0
       && !/execFile|spawn|exec\(/.test(body), body ? body.slice(0, 200) : 'function not found');
  }
  ok('the native calls run on workers through winNativeRun',
     /require\('\.\/winNativeRun'\)/.test(code) && /runNative\('winSystemNative\.js'/.test(code));
  ok('the archive unpack is node-stream-zip, on a descriptor Studio owns',
     /openZipOwned\(zipPath, /.test(bodyOf('expandArchive')));
}

// ── no old program name survives in code anywhere ───────────────────────────
// Wider than the launch pattern: the program or cmdlet names in any code string (a command line
// built elsewhere and handed to a launcher would not be caught by the first-argument scan).
{
  const files = sourceFiles();
  const NAMES = /\b(?:tasklist|taskkill|Expand-Archive|Get-PnpDevice|fsutil)\b|['"`]reg(?:\.exe)?['"`]|\breg query\b/i;
  ok('the name scan sees a name in code',
     ["execFile('tasklist', [])", "const c = 'Expand-Archive -LiteralPath x';", "run('reg', ['query'])"].every((l) => NAMES.test(l))
     && !NAMES.test('const registry = regQuery(key);'));
  const found = [];
  for (const f of files) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    code.split('\n').forEach((l, i) => { if (NAMES.test(l)) found.push(`${f}:${i + 1}  ${l.trim().slice(0, 120)}`); });
  }
  ok(`no tasklist / taskkill / reg / fsutil / Expand-Archive / Get-PnpDevice in code: ${found.length}`,
     found.length === 0, found.join('\n       '));
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
  ok(`no Windows shell-out outside winSystem.js: ${stray.length}`, stray.length === 0,
     'Card, registry, device and process questions answer through the Win32 API '
     + '(winDisksNative.js, winSystemNative.js); a new launch belongs nowhere.\n       '
     + stray.join('\n       '));
}

console.log(`\nwindows-shellouts-one-place: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
