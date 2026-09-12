/**
 * REFERENCE INTEGRITY — calls that point at nothing.
 *
 * Built 2026-09-12 after two bugs in one hour that no other test could see:
 *
 *   1. The voicepack migration deleted `_vpkEsc`, and the new preflight dialog
 *      was calling it. Everything compiled, all 29 suites went green, and the
 *      dialog threw ReferenceError the first time a check fired — so a config
 *      with a real problem failed SILENTLY at the gate.
 *   2. A first draft of the preflight context called
 *      `window.getSelectedBoardLabel()`, which does not exist. Optional chaining
 *      meant it would have returned '' forever while LOOKING wired.
 *
 * Both are the same class: a name that resolves in the author's head and nowhere
 * else. Neither is a syntax error, so `node --check` is blind to them, and the
 * renderer's own suites never execute the paths that would throw.
 *
 * ⚠️ THIS IS DELIBERATELY CRUDE. It is not a scope analyser and does not try to
 * be — it reads text, so it can only ever be a smoke alarm. Two rules keep it
 * honest:
 *   • It only looks at OUR OWN naming conventions (underscore-prefixed helpers,
 *     and `window.*` calls), because those are the ones we control.
 *   • Anything it cannot model goes in an ALLOWLIST with a reason, never a
 *     loosened regex. A check that is quietly widened until it passes is a check
 *     that has stopped working.
 *
 * ⭐ A FAILURE HERE IS USUALLY REAL. Before adding to an allowlist, prove the
 * name actually exists at runtime. Adding it because "that's probably fine" is
 * how this test becomes decoration.
 *
 * Run: node test/reference-integrity.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Comments must go first. `getSelectedBoardLabel` survives in index.html only
// inside a comment explaining that it does not exist, and a scanner that cannot
// tell those apart reports the explanation as the bug.
//
// ⚠️ THIS STRIPPER IS LINE-BASED ON PURPOSE, AND BOTH SIMPLER ALTERNATIVES WERE
// TRIED AND FAILED ON THE FIRST RUN.
//
//   A naive "delete // to end of line" ignores strings, so a `//` inside a URL
//   ate real code and reported `async function _offerBoardHelpIfMissing()` as
//   undefined.
//
//   preflight.js's stripper is a proper state machine and still gets this wrong,
//   because it does not know REGEX LITERALS: the `"` inside `/[&<>"]/g` opens a
//   string it never closes, and everything to the next quote vanishes — including
//   a comment that then read as a live `window.getSelectedBoardLabel()` call.
//   That is not a defect where it is used; it strips C++ config text, which has
//   no JS regex literals. It is simply the wrong tool for scanning our own source.
//
// So: string state never crosses a line boundary here. Quote counting is confined
// to the line a `//` sits on, which handles "https://" correctly and cannot be
// derailed by a regex literal. Block comments are handled across lines, since
// nothing in this codebase opens one inside a string.
//
// A false positive on the first run of a new check is how a check gets disabled,
// so this one had to be right before it was worth keeping.
function stripComments(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return noBlocks.split('\n').map(line => {
    let inStr = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        if (c === '\\') { i++; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

const html       = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const inlineSrc  = (html.match(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/i) || [])[1] || '';
const inlineCode = stripComments(inlineSrc);

// ── 1. underscore helpers called but never defined ──────────────────────
//
// `_name(` is our convention for a module-private helper, so a call with no
// definition anywhere in the same script is the _vpkEsc failure exactly.
{
  // ⭐ THE ASYMMETRY IS THE DESIGN, AND IT IS WHAT MAKES A CRUDE SCANNER SAFE.
  // DEFINITIONS are collected from the RAW source; CALLS only from the stripped
  // source. Get "defined" wrong and the worst case is a missed catch. Get
  // "called" wrong and the check screams about working code, which is how a test
  // gets switched off. So be generous about what counts as a definition and
  // strict about what counts as a call.
  // This is not hypothetical tuning: stripping blanked two real definitions
  // (`_offerBoardHelpIfMissing`, `_findAttachedCommentsStart`) because something
  // upstream opens a `/*` the stripper believes. Reading definitions raw makes
  // the scanner immune to its own stripper being imperfect.
  const defined = new Set();
  for (const re of [/function\s+([A-Za-z_$][\w$]*)/g,
                    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
                    /class\s+([A-Za-z_$][\w$]*)/g]) {
    for (const m of inlineSrc.matchAll(re)) defined.add(m[1]);
  }

  // Each entry is a TEXT artifact, not a real call. Verified 2026-09-12; if one
  // stops appearing, delete it rather than leaving a rule nothing exercises.
  const ARTIFACTS = new Map([
    ['_v',                'matched inside the proffieboard_v\\d+ regex literal'],
    ['_prepared',         'a property (s._prepared) the lookbehind does not catch in every form'],
    ['__CMT_',            'the comment placeholder in the formatter template, __CMT_${i}__'],
    ['_pruneDeadFollows', 'named only in a comment recording that it was removed'],
  ]);

  const missing = [];
  for (const m of inlineCode.matchAll(/(?<![.\w$])(_[A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (defined.has(name) || ARTIFACTS.has(name)) continue;
    if (missing.some(x => x.name === name)) continue;
    missing.push({ name, line: inlineCode.slice(0, m.index).split('\n').length });
  }

  ok('every _helper called in index.html is defined there',
     missing.length === 0,
     missing.map(m => `${m.name} (inline line ~${m.line})`).join(', '));

  // The scanner is only worth anything if it can still see. If the corpus of
  // calls collapses, the regex has drifted rather than the code getting cleaner.
  const callCount = [...inlineCode.matchAll(/(?<![.\w$])(_[A-Za-z_$][\w$]*)\s*\(/g)].length;
  ok('the scanner still sees a plausible number of helper calls',
     callCount > 500, `saw ${callCount}`);
}

// ── 2. window.* calls that nothing ever assigns ─────────────────────────
//
// The renderer is several scripts plus one big inline block sharing state
// through `window`, so a cross-file typo has no compiler to catch it. This is
// the getSelectedBoardLabel failure.
{
  // ⚠️ index.html CONTRIBUTES ITS EXTRACTED SCRIPT, NOT THE RAW FILE. The comment
  // stripper is a JS state machine that tracks string literals, and HTML is full
  // of quotes it has no business interpreting — pointed at the raw file it lost
  // its place and left a `window.getSelectedBoardLabel()` sitting inside a comment
  // looking like a live call. The scanner's own first two runs were both false
  // positives from reading text it should never have been handed.
  // Same asymmetry as section 1: assignments read RAW, calls read STRIPPED.
  let allRaw = inlineSrc + '\n';
  let all    = stripComments(inlineSrc) + '\n';

  const files = ['preload.js'].concat(
    fs.readdirSync(path.join(ROOT, 'renderer'))
      .filter(f => f.endsWith('.js'))
      .map(f => path.join('renderer', f)));

  for (const f of files) {
    try {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      allRaw += src + '\n';
      all    += stripComments(src) + '\n';
    } catch { /* optional */ }
  }

  const assigned = new Set();
  for (const m of allRaw.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) assigned.add(m[1]);
  // The renderer modules attach to a `root` that IS window in the browser.
  for (const m of allRaw.matchAll(/root\.([A-Za-z_$][\w$]*)\s*=/g)) assigned.add(m[1]);
  // preload exposes over the context bridge.
  for (const m of allRaw.matchAll(/exposeInMainWorld\(\s*['"]([\w$]+)['"]/g)) assigned.add(m[1]);

  // Genuine browser/DOM members reached through an explicit `window.`. Not ours,
  // never assigned by us, and each one verified as a real platform API.
  const PLATFORM = new Set([
    'matchMedia', 'addEventListener', 'removeEventListener', 'getComputedStyle',
    'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'scrollTo', 'open', 'close', 'focus', 'blur',
    'getSelection', 'postMessage', 'alert', 'confirm', 'prompt', 'fetch',
  ]);

  const missing = [];
  for (const m of all.matchAll(/window\.([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g)) {
    const name = m[1];
    if (assigned.has(name) || PLATFORM.has(name) || missing.includes(name)) continue;
    missing.push(name);
  }

  ok('every window.* function called in the renderer is assigned somewhere',
     missing.length === 0, missing.join(', '));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall reference integrity checks passed');
process.exit(failures ? 1 : 0);
