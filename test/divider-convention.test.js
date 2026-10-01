// `.ui-divider` is the ONLY divider class. The two older ones must stay deleted.
//
// ⭐⭐ WHY THIS EXISTS. 2026-09-30, [B-448]. Three classes did the same job under
// different names - `.ui-divider`, `.toolbar-divider` (stretch) and
// `.sf-toolbar-divider` (fixed, weaker border colour) - and a FOURTH was nearly
// added on 2026-09-29 before anyone noticed the duplication. That is the whole
// failure: "reuse the existing pattern" is useless advice when nobody can tell
// which of three is the pattern.
//
// ⚠️ THE DEFINITION OF DONE WAS DELETION, NOT MIGRATION. Moving the call sites and
// leaving the classes defined means the next person can still reach for the wrong
// one, and the convention goes straight back to depending on memory - which is how
// three of them accumulated in the first place. This test is what makes a wrong
// choice a failing build instead of a style that quietly drifts.
//
// ⚠️ IT MUST SCAN .js AS WELL AS .html. Dividers are emitted from template literals
// too (versionsPanel.js builds the version card's action row that way), so a check
// reading only index.html would pass while a regression lived in the renderer.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DEAD = ['toolbar-divider', 'sf-toolbar-divider'];

const FILES = [
  'renderer/index.html',
  ...fs.readdirSync(path.join(root, 'renderer'))
       .filter(f => f.endsWith('.js'))
       .map(f => path.join('renderer', f)),
];

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (detail) console.log(`       ${detail}`);
}

// ⚠️ MATCH THE ATTRIBUTE, NOT THE WORD. index.html now carries a comment that names
// both dead classes on purpose, explaining why they are gone, and another test file
// keeps them as fixture strings. A bare substring search would flag all of those and
// the check would be switched off the first week. Only a real `class=` token counts.
const CLASS_ATTR = /class\s*=\s*("([^"]*)"|'([^']*)')/g;

function deadClassUses(src) {
  const hits = [];
  let m;
  CLASS_ATTR.lastIndex = 0;
  while ((m = CLASS_ATTR.exec(src)) !== null) {
    const tokens = (m[2] !== undefined ? m[2] : m[3]).split(/\s+/).filter(Boolean);
    for (const t of tokens) if (DEAD.includes(t)) hits.push({ token: t, index: m.index });
  }
  return hits;
}

const offenders = [];
for (const rel of FILES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  for (const hit of deadClassUses(src)) {
    const line = src.slice(0, hit.index).split('\n').length;
    offenders.push(`${rel}:${line} (${hit.token})`);
  }
}

ok('no markup uses a deleted divider class',
   offenders.length === 0,
   offenders.length ? `use .ui-divider instead: ${offenders.join(', ')}` : '');

// The other half: the classes must not be DEFINED either, or a call site can come
// back and look correct.
{
  const css = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
  for (const dead of DEAD) {
    const rule = new RegExp(`^\\s*\\.${dead}\\s*\\{`, 'm');
    ok(`.${dead} is not defined in the stylesheet`, !rule.test(css),
       'a defined class is a reachable class, which is how three of these accumulated');
  }
  const uiRule = css.match(/^\s*\.ui-divider\s*\{/gm) || [];
  ok('.ui-divider is defined exactly once', uiRule.length === 1,
     `found ${uiRule.length} definitions; two would be the same duplication under one name`);
}

// ⚠️ THE CONTROL. This is a regex over source text - the shape that has passed while
// asserting nothing before. Prove it catches the thing it is for.
{
  const mutant = '<div class="toolbar-divider"></div>';
  ok('⚠️⚠️ a real use of a dead class IS caught', deadClassUses(mutant).length === 1,
     'if this fails the check above is worthless, whatever it reports');
}
{
  const mutant = 'return `<div class="sf-toolbar-divider"></div>`;';
  ok('⚠️⚠️ a dead class inside a template literal IS caught', deadClassUses(mutant).length === 1,
     'this is the .js half - the case index.html alone cannot see');
}
// And the false-positive half, which is not hypothetical: the real stylesheet comment
// names both dead classes, and it must not trip this.
{
  const prose = '/* ⚠️ Two older ones existed - `.toolbar-divider` and `.sf-toolbar-divider`. */';
  ok('prose naming a dead class is not flagged', deadClassUses(prose).length === 0,
     'a check that cries wolf is a check that gets deleted');
}
{
  const live = '<div class="ui-divider" id="divider-undoredo"></div>';
  ok('the surviving class is not flagged', deadClassUses(live).length === 0,
     'the convention itself must pass');
}

console.log(`\ndivider-convention: ${failures ? `${failures} FAILED` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
