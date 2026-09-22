// Every file dialog must say WHERE to open. [2026-09-22]
//
// ⭐⭐ WHY THIS EXISTS, AND IT IS THE THIRD TIME THIS CLASS HAS APPEARED.
//
//   [B-291]     a remembered directory on an unplugged drive made WINDOWS demand the disk
//               ("Please insert a disk into USB Drive (J:)") over the app. Fixed with
//               `liveDir` - for the config dialogs and the backup dialogs.
//   2026-09-22  the export dialogs never got it, and the failure was WORSE than B-291's:
//               `defaultPath: safeFile + '.zip'` carries NO DIRECTORY, so Windows fell back to
//               its OWN memory of the last folder this app saved into. The card was gone, and
//               Save hung the dialog. Twice. `liveDir` could not have helped - there was no
//               stored path to validate, because the stale location lived in the shell's MRU.
//
// ⚠️⚠️ THE LESSON IS THE ONE THIS PROJECT KEEPS PAYING FOR: a rule written beside the caller
// that taught it never reaches the other callers. B-291 fixed three dialogs and there were
// seventeen. So this is a CHECK THAT FAILS, not a note asking the next person to remember.
//
// ⭐ A RATCHET, NOT A BLANKET RULE. Several dialogs are legitimately unguarded today and are
// not export paths; forcing all of them now would be a different change with its own risk. The
// list below is what was unguarded on 2026-09-22 and it may only SHRINK. A new dialog, or a
// newly-unguarded one, fails this test.
//
// ⚠️ "Guarded" means the options object names a real source for its starting directory -
// `exportDefaultPath`, `liveDir`, a `lastDir` resolved from one of those, or an `app.getPath`.
// A bare filename is NOT a starting directory, which is the exact defect this file was born of.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const LINES = SRC.split('\n');

// Pull each dialog call's options object by brace-matching from the opening paren, so a call
// is never mis-measured by a fixed-width window. ⚠️ A fixed slice is what made an earlier audit
// of this same file report two guarded dialogs as unguarded.
function callSites() {
  const out = [];
  const re = /dialog\.(showSaveDialog|showOpenDialog)\s*\(/g;
  let m;
  while ((m = re.exec(SRC))) {
    let i = re.lastIndex, depth = 1;
    while (i < SRC.length && depth > 0) {
      const c = SRC[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const body = SRC.slice(m.index, i);
    const line = SRC.slice(0, m.index).split('\n').length;
    const title = (body.match(/title:\s*'([^']*)'/) || [])[1] || '(untitled)';
    out.push({ line, title, body, kind: m[1] });
  }
  return out;
}

// ⚠️ FIND THE ASSIGNMENT, DO NOT GUESS A SCOPE. The first cut of this walked back to the
// nearest `ipcMain.handle(` within 120 lines and called anything further "unguarded" - which
// reported `Export file` as a defect when its handler opens at 3342 and its guard sits at 3602,
// 307 lines from the call. A window that happens to fit today's layout is an instrument that
// will lie the moment a handler grows. Look for the binding itself.
function guardOfNearest(varName, line) {
  const re = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*([^\\n]*)`);
  for (let i = line - 1; i >= 0; i--) {
    const m = LINES[i].match(re);
    if (m) return m[1];
  }
  return '';
}

const GUARD = /exportDefaultPath\s*\(|liveDir\s*\(|liveDirSafe\s*\(|app\.getPath\s*\(/;

function isGuarded(site) {
  const dp = site.body.match(/defaultPath:\s*([^\n]*)/);
  if (!dp) return false;                       // no starting directory at all -> Windows MRU
  const expr = dp[1];
  if (GUARD.test(expr)) return true;
  // `defaultPath: lastDir` / `path.join(lastDir, x)` is fine IF lastDir came from a guard.
  const named = expr.match(/\b([A-Za-z_$][\w$]*Dir)\b/);
  if (named) return GUARD.test(guardOfNearest(named[1], site.line));
  return false;
}

// ── The ratchet: unguarded as of 2026-09-22. MAY ONLY SHRINK. ──────────
const KNOWN_UNGUARDED = [
  'Import Style Library',
  'Export Style Library',
  'Replace Style Library',
  'Import Default Template',
  'Attach files to this source',
  'Choose a proof-of-purchase file',
  'Add files to common folder',
  'Select ProffieOS Folder',
  '(untitled)',
];

const sites = callSites();
ok('dialog call sites were located', sites.length >= 15,
   `found ${sites.length}; re-check the brace matcher if this dropped`);

const unguarded = sites.filter((s) => !isGuarded(s));
const unexpected = unguarded.filter((s) => !KNOWN_UNGUARDED.includes(s.title));

for (const s of unexpected) {
  ok(`"${s.title}" (main.js:${s.line}) names a starting directory`, false,
     'without one, Windows opens this dialog wherever the app last saved - which may be a card '
     + 'that is no longer in the machine, and the dialog then blocks. Use exportDefaultPath().');
}
if (!unexpected.length) {
  ok('no newly-unguarded dialogs', true);
}

// ⭐ THE RATCHET'S OTHER HALF, AND THE HALF THAT USUALLY GETS LEFT OUT: if a known-unguarded
// dialog gets fixed, this list has to shrink with it, or the next regression hides inside a
// stale allowance.
const stale = KNOWN_UNGUARDED.filter(
  (t) => t !== '(untitled)' && !unguarded.some((s) => s.title === t));
for (const t of stale) {
  ok(`"${t}" is still in the unguarded list`, false,
     'it is guarded now - remove it from KNOWN_UNGUARDED so the ratchet keeps its teeth');
}

// The three that were fixed on 2026-09-22 are asserted BY NAME, because they are the ones a
// user actually reaches with a card in their hand.
for (const t of ['Export common folder', 'Choose destination for sound fonts',
                 'Choose a drive or SD-card folder']) {
  const s = sites.find((x) => x.title === t);
  ok(`"${t}" is guarded`, !!s && isGuarded(s),
     s ? 'this is an export path that lands on removable media; it hung his app twice'
       : `call site not found - was it renamed?`);
}

console.log(failed === 0
  ? '\ndialog-default-path: all checks passed'
  : `\ndialog-default-path: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
