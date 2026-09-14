/**
 * "Add to config" on a sound font card  [B-376]
 *
 * Three faults in one menu, reported 2026-09-12: "right click on sound font card add to
 * config fails silently when no presets in config. Also, replace existing preset
 * shouldn't be visible when there aren't any. Additionally, when no config is open,
 * these options should also not show up." Then, on the last two: "or greyed out".
 *
 * ⭐⭐ THE SILENT FAILURE IS A SCOPE BUG WEARING A GUARD. `_sfAddPresetWithFont` sits
 * at ~36176, OUTSIDE `presetSidecarModule` (an IIFE spanning ~39210-47800). Its two
 * cold paths tested `typeof _addFirstPreset === 'function'` against names declared
 * INSIDE that IIFE, which are invisible from outside it. Both tests were false every
 * time. Clicking "Add to config" on a config with no presets produced no preset and no
 * message, and had never once worked.
 *
 * ⚠️ THE GUARD IS WHAT HID IT. Without the typeof, the call throws on first use and is
 * fixed the same day. With it, an unreachable branch reads as defensive programming and
 * converts a crash into a silence — and nobody reports a silence.
 *
 * HIS RULING on the other two, 2026-09-13: grey-with-a-reason when a config is open but
 * cannot take the action, HIDE when no config is open.
 *
 * Run: node test/sound-font-card-menu.test.js
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

// ── the scope bug ──────────────────────────────────────────────────────────
{
  const iifeStart = html.indexOf('(function presetSidecarModule()');
  const addFn     = html.indexOf('const _sfAddPresetWithFont =');
  ok('the caller really is outside the module', addFn > 0 && iifeStart > 0 && addFn < iifeStart,
     `caller at ${addFn}, module opens at ${iifeStart}`);

  const defAdd    = html.indexOf('async function _addFirstPreset');
  const defInsert = html.indexOf('async function _insertFirstEntryIntoArray');
  ok('and both helpers really are inside it', defAdd > iifeStart && defInsert > iifeStart);

  // ⚠️⚠️ ANCHOR ON THE CONSTRUCT, NEVER ON A SLAB OF SOURCE. Two failures on one day
  // taught this file the same thing from both directions:
  //   * at a fixed 3000 chars the window cut off `await _insertInto(` the moment a
  //     comment was added above it, and reported unchanged, correct code as broken;
  //   * "slice to the end of the function" then overshot to 168 KB and swept in three
  //     unrelated, perfectly legitimate showToast calls, breaking an absence check.
  // Too small hides the subject; too large invents one. So each assertion below is
  // anchored to the thing it is about. (Third instance of this shape on 2026-09-14 —
  // see also favorites-reorder-freshness and compile-vs-save-indicators.)
  const guardAt = html.indexOf("if (typeof _addFirst !== 'function'", addFn);
  ok('the bridge guard was located', guardAt > addFn, `addFn ${addFn}, guard ${guardAt}`);
  // The guard block itself: from the `if` to the `}` that closes it.
  const guard = html.slice(guardAt, html.indexOf('\n        }', guardAt) + 10);
  // The cold paths sit immediately after the guard; a few hundred lines is ample and
  // cannot reach another function.
  const body  = html.slice(addFn, guardAt + 4000);
  // ⭐ THE ASSERTION THAT MATTERS. A bare `typeof _addFirstPreset` here can only ever
  // be false — if it comes back, the cold paths go silent again.
  //
  // ⚠️ MATCH THE CODE SHAPE, NOT THE SUBSTRING. The first draft searched for
  // `typeof _addFirstPreset ===` and matched the COMMENT four lines above that explains
  // the bug, so a correct fix reported as broken. An absence-assertion that can be
  // tripped by prose is measuring the wrong text; requiring the `if (...)` wrapper
  // means only real code can satisfy it.
  ok('no unsatisfiable typeof on the module-private names',
     !/if \(typeof _addFirstPreset === 'function'\)/.test(body)
     && !/if \(typeof _insertFirstEntryIntoArray === 'function'\)/.test(body),
     'these names are not in scope here; the test can only ever be false');

  ok('it calls through the published bridges',
     /window\._addFirstPreset/.test(body) && /window\._insertFirstEntryIntoArray/.test(body));
  ok('a missing bridge is reported to the DEVELOPER',
     /console\.error\('\[B-376\]/.test(body),
     'the whole cost of the original bug was that nothing said anything');
  // ⭐⭐ AND IT MUST NOT BE REPORTED TO THE USER. A missing bridge is our defect: the
  // user did not cause it and cannot act on it, so a toast blames the wrong party and
  // offers no way out. It also cannot reach a release — the publication assertions
  // below turn this suite red before a build exists — so the toast was defence for an
  // impossible state, wearing a message that implied the user had done something.
  // Shipped 2026-09-13, removed 2026-09-14.
  // ⚠️ SCOPED TO THE GUARD BLOCK, not the function — this file raises legitimate toasts
  // elsewhere (export, duplicate, remove-duplicates) and an absence check over the whole
  // body would fail on those, which is how the too-wide window was caught.
  ok('⭐ and NOT to the user — no toast on a development fault',
     !/showToast\(/.test(guard),
     'a toast here says "your action failed" about something the user neither caused nor can fix');
  ok('the cold paths await the scaffold',
     /await _addFirst\(/.test(body) && /await _insertInto\(/.test(body));
}

// ── the module publishes them ──────────────────────────────────────────────
{
  // ⭐⭐ THE ASSERTION THIS FILE WAS MISSING, AND A DEV TEST FOUND WHAT IT COULD NOT.
  // The suite checked the two SCAFFOLD bridges and passed, while the FONT-PATCH bridge
  // was absent: `_commitPresetFont` lives inside presetSidecarModule and the caller sits
  // outside it, so "Add to config" created a preset and then threw on the font write.
  // A bare `catch {}` swallowed it. The preset appeared with its seed font, silently —
  // the exact failure this entry is named for, in a third place.
  //
  // So: every module-private helper the SF view calls must be published, not just the
  // ones we happened to think of. Checked by name because there are only three.
  for (const fn of ['_addFirstPreset', '_insertFirstEntryIntoArray', '_commitPresetFont']) {
    ok(`${fn} is bridged across the IIFE boundary`,
       new RegExp(`window\\.${fn}\\s*=\\s*${fn};`).test(html),
       'the SF view calls it from outside presetSidecarModule');
  }
  // ⚠️ AND THE GUARD MUST NAME THE FUNCTION IT GUARDS. The original line tested
  // `window._commitFieldEdit` and then called `_commitPresetFont` — a guard that can
  // only ever pass, in front of a call that can only ever throw.
  {
    const patchAt = html.indexOf('const _sfPatchFreshPresetFont');
    const patchRaw = html.slice(patchAt, patchAt + 2600);
    // ⚠️⚠️ STRIP COMMENTS BEFORE AN ABSENCE CHECK. The first version of this assertion
    // failed against the CORRECT fix, because the comment directly above the code quotes
    // the old broken line to explain it. Identical to the trap in
    // favorites-reorder-freshness.test.js, walked into an hour after fixing it there:
    // an assertion over source text reads prose unless you take the prose out.
    // `[^\r\n]*`, not `.*$` — this file is CRLF and `.` will not cross `\r`.
    const patch = patchRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
    ok('the font write guards the name it calls',
       !/window\._commitFieldEdit\) _commitPresetFont\(/.test(patch),
       'guarding one name and calling another is a guard that cannot fail');
    // ⚠️ ANCHORED ON THE `catch`, not measured from the top of the function — adding four
    // lines of comment above it pushed this out of a fixed window and failed against
    // correct code. Fourth time in one day; the rule is finally applied rather than
    // written: find the construct, then read from it.
    const catchAt = html.indexOf('} catch (e) {', patchAt);
    const catchBlock = html.slice(catchAt, catchAt + 700);
    ok('and the patch failure is reported to the developer',
       catchAt > patchAt && /console\.error\('\[B-376\] could not apply the font/.test(catchBlock),
       'a bare catch {} here is what hid this for a day');
  }
  ok('_addFirstPreset is published', /window\._addFirstPreset\s*=\s*_addFirstPreset;/.test(html));
  ok('_insertFirstEntryIntoArray is published',
     /window\._insertFirstEntryIntoArray\s*=\s*_insertFirstEntryIntoArray;/.test(html));
}

// ── the menu items ─────────────────────────────────────────────────────────
{
  const menu = html.slice(html.indexOf("document.getElementById('sf-cards')?.addEventListener('contextmenu'"),
                          html.indexOf('buildSubmenu') + 200);
  ok('the menu region was located', menu.length > 500);

  // ⚠️ fileIsOpen, not currentFilePath: a new unsaved config has no path and is open.
  // Assert against the STATEMENT, not the region — the region contains a comment saying
  // "NOT currentFilePath", which a substring search reads as the thing it forbids.
  const cfgOpenStmt = (menu.match(/const _cfgOpen = [\s\S]*?;/) || [''])[0];
  ok('config-open is decided by fileIsOpen', /fileIsOpen/.test(cfgOpenStmt), cfgOpenStmt);
  ok('it does NOT test currentFilePath', !/currentFilePath/.test(cfgOpenStmt),
     'that would hide the items on a brand-new config, which is the likeliest case');

  ok('"Add to config" is only offered when a config is open',
     /if \(_cfgOpen\) \{[\s\S]{0,400}?\+ Add to config/.test(menu));
  ok('Replace is absent entirely with no config open',
     /const replaceItem = !_cfgOpen \? null :/.test(menu));
  ok('Replace is greyed WITH A REASON when there are no presets',
     /_presetCount === 0[\s\S]{0,200}?disabledReason:/.test(menu));
  ok('the reason names the way forward',
     /Use "Add to config" to create one\./.test(menu),
     'a disabled control that does not say what it needs is just a dead control');

  // A disabled item must not be clickable — the class alone is styling, not behaviour.
  // The early return is what makes "disabled" behaviour rather than styling: the
  // addEventListener below it is never reached for such an item.
  const disabledBranch = (menu.match(/if \(opts && opts\.disabledReason\) \{[\s\S]*?\n\s*\}/) || [''])[0];
  ok('a disabled item never binds a handler',
     /return d;/.test(disabledBranch) && !/addEventListener/.test(disabledBranch),
     disabledBranch.slice(0, 260));
  ok('the submenu does not open on a disabled parent',
     /if \(replaceItem && !replaceItem\.classList\.contains\('disabled'\)\)/.test(html));
}

// ── the CSS follows the existing convention ────────────────────────────────
{
  ok('.preset-ctx-item.disabled exists', /\.preset-ctx-item\.disabled \{/.test(html));
  ok('it uses opacity + not-allowed like the other .disabled rules',
     /\.preset-ctx-item\.disabled \{[^}]*opacity:[^}]*cursor: not-allowed/.test(html));
  ok('and kills the hover highlight, which is what reads as clickable',
     /\.preset-ctx-item\.disabled:hover \{/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall sound font card menu tests passed');
process.exit(failures ? 1 : 0);
