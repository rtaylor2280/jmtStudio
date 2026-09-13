/**
 * The Delete key works wherever the Delete button shows  [B-374]
 *
 * "multi select in preset styles side car delete key doesn't work only have right
 * click delete." Select several presets, press Delete → nothing. The only way out was
 * right-click → Delete, found by looking for it.
 *
 * ⭐ NOT A NEW DECISION. [B-336] settled this for the Sound Font Library on 2026-09-07
 * (commit c67e252): Delete AND Backspace both fire the same path as the visible
 * control. This is that rule reaching a surface it did not cover, so this suite asserts
 * the sidecar binding MATCHES the font-grid one rather than that it exists.
 *
 * ⚠️ THE GUARDS ARE THE WORK, NOT THE KEY BINDING — and the focus guard matters more
 * here than in the font grid. The sidecar sits beside preset name fields, font and
 * track combos, the inline style editor, and Monaco, whose focused element is a hidden
 * TEXTAREA. A binding that does not yield to a focused input eats a Backspace mid-
 * rename or mid-edit.
 *
 * Run: node test/preset-delete-key.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Both handlers, located by the state each one reads — unambiguous, unlike "keydown".
// ⚠️ SLICE TO THE HANDLER, NOT A CHAR COUNT. A generous window ran past the end of
// this listener into _showPresetContextMenu and picked up ITS parsePresets call, so
// "does not reimplement the deletion" failed against code that does no such thing.
const sidecar = (() => {
  const c = html.indexOf('[B-374] THE DELETE KEY WORKS WHEREVER');
  if (c < 0) return '';
  const h = html.indexOf("document.addEventListener('keydown'", c);
  const end = html.indexOf('\n    });', h);
  return h < 0 || end < 0 ? '' : html.slice(h, end + 8);
})();
const fontGrid = (() => {
  const i = html.indexOf('[B-336] Delete and Backspace are ALIASES');
  return i < 0 ? '' : html.slice(i, i + 1600);
})();

ok('the sidecar binding exists', sidecar.length > 0);
ok('the B-336 font-grid binding is still there to match against', fontGrid.length > 0);

// ── both keys, per his ruling on B-336 ─────────────────────────────────────
{
  const bothKeys = /e\.key !== 'Delete' && e\.key !== 'Backspace'/;
  ok('the sidecar takes BOTH Delete and Backspace', bothKeys.test(sidecar));
  ok('and so does the font grid, unchanged', bothKeys.test(fontGrid));
}

// ── the guards, copied not re-derived ──────────────────────────────────────
{
  ok('it requires a selection',
     /_selectedLive\.size === 0 && _selectedDisabled\.size === 0/.test(sidecar),
     'both kinds count — live presets and disabled ones');
  ok('it requires the config tab and an open file',
     /_activeTab !== 'config' \|\| !fileIsOpen/.test(sidecar));
  ok('it requires the sidecar to be open', /!_sidecarOpen/.test(sidecar),
     'the selection survives a collapse, so the flag has to be checked');
  ok('no modal may be open above it',
     /document\.querySelector\('\.modal-overlay\.active'\)/.test(sidecar));

  // ⭐ THE ONE THAT PROTECTS TYPING. Monaco's focused element is a TEXTAREA, so this
  // single check covers the config editor as well as every field in the sidecar.
  const focusGuard = /ae\.tagName === 'INPUT' \|\| ae\.tagName === 'TEXTAREA' \|\| ae\.tagName === 'SELECT'[\s\S]{0,60}?isContentEditable/;
  ok('it yields to any focused text surface', focusGuard.test(sidecar));
  ok('the font grid uses the same focus guard', focusGuard.test(fontGrid),
     'one predicate, two surfaces — a second one would drift');
}

// ── it is an ALIAS, not a second implementation ────────────────────────────
{
  ok('it calls the same function the menu item calls', /_batchDelete\(\);/.test(sidecar));
  ok('it does not reimplement the deletion',
     !/_atomicEdit|presetParser\.parsePresets/.test(sidecar),
     'an alias that rebuilds the work is how two paths start behaving differently');
  ok('it preventDefaults so the key does not also act elsewhere',
     /e\.preventDefault\(\);/.test(sidecar));

  // ⚠️ NO CONFIRM HERE, and that is the rule rather than a miss: the right-click Delete
  // does not confirm either, and a gate on one door and not the other is drift. Undo
  // covers it — _batchDelete is a single atomic edit.
  ok('it adds no confirm the button does not have',
     !/promptConfirm|confirm\(/.test(sidecar));
  const batch = html.slice(html.indexOf('function _batchDelete'), html.indexOf('function _batchDelete') + 1800);
  ok('_batchDelete is one atomic edit, so Ctrl+Z takes it back in one step',
     /_atomicEdit\(editor,'batch-delete', edits\);/.test(batch));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall preset delete key tests passed');
process.exit(failures ? 1 : 0);
