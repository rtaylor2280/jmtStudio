/**
 * The Board and USB fields compare against the BUILD, never against the saved file  [B-385]
 *
 * REPORTED 2026-09-14, from the config header. USB was switched to
 * Serial + Mass Storage + WebUSB, got the red field, saved, and the red vanished.
 *     "that's a lie because it says last compiled. that would still be true even when saved."
 *
 * ⭐⭐ THE SPEC, and it is the whole entry: "it's job is to show if the current selection
 * matches the last compiled version. that's it."
 *
 * WHAT WAS WRONG. The field OR'd two tests: `baselineX` (resets on Save — "differs from the
 * file on disk") and the build record ("differs from the binary"). The red means RECOMPILE
 * BEFORE FLASHING, and saving builds nothing, so a save could never legitimately clear it.
 * The dirty marker already answers the file question.
 *
 * ⚠️ AND THE FIRST ATTEMPT AT THIS FIX ONLY REWORDED THE SAVE BRANCH, which left the wrong
 * comparison in place with better words on it. The correction: "looking at the wrong field...
 * it's supposed to compare compiled not saved." The save comparison is GONE from both fields;
 * these tests exist to keep it gone.
 *
 * THE THIRD STATE. `@jmt:compiled_usb` / `compiled_board` arrived 2026-08-15, so a config
 * built before then carries a compile TIMESTAMP and no settings — the question cannot be
 * answered. It must say so and must NOT go red. Measured over 88 real configs on 2026-09-14:
 * 58 carry the timestamp, 12 carry the settings.
 *
 * These tests LIFT the shipped tooltip expressions out of the source and EXECUTE them; a
 * string match would pass for a rewrite that changes the meaning.
 *
 * Run: node test/compile-vs-save-indicators.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const bp   = fs.readFileSync(path.join(ROOT, 'renderer', 'buildPanel.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Lift `<lhs> = <expr>;` and return the expression source.
function liftAssignment(src, lhs) {
  const at = src.indexOf(lhs + ' = ');
  if (at < 0) return null;
  const from = at + (lhs + ' = ').length;
  let depth = 0, inTpl = false;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (inTpl) { if (c === '`' && src[i - 1] !== '\\') inTpl = false; continue; }
    if (c === '`') { inTpl = true; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(from, i);
  }
  return null;
}

const USB_LABELS = { cdc_msc: 'Serial + Mass Storage', cdc_webusb: 'Serial + WebUSB' };

// ── the USB field ──────────────────────────────────────────────────────────
{
  const expr = liftAssignment(bp, 'usbEl.title');
  ok('the USB tooltip expression was lifted', !!expr && expr.length > 30, String(expr).slice(0, 120));

  const title = new Function('buildMoved', 'builtUsb', 'USB_LABELS', 'buildUnknown', 'compiledAt',
                             'return ' + expr);

  const moved = title(true, 'cdc_webusb', USB_LABELS, false, 'Aug 7');
  ok('a build mismatch names the mode the binary was built with',
     /Last built with Serial \+ WebUSB/.test(moved) && /recompile before flashing/.test(moved), moved);

  const unknown = title(false, null, USB_LABELS, true, 'Aug 7 5:32 PM');
  ok('⭐ cannot-tell: compiled, but the build recorded no USB mode',
     /did not record its USB mode/.test(unknown) && /Aug 7 5:32 PM/.test(unknown), unknown);
  ok('and it says what to do about it', /recompile to start checking it/.test(unknown), unknown);

  ok('a matching build is silent', title(false, 'cdc_webusb', USB_LABELS, false, 'Aug 7') === '');
  ok('a never-compiled config is silent', title(false, null, USB_LABELS, false, null) === '');

  // ⭐⭐ THE REGRESSION THIS FILE EXISTS FOR.
  const fn = bp.slice(bp.indexOf('function updateUsbChangedIndicator'),
                      bp.indexOf('function updateUsbChangedIndicator') + 1800);
  ok('⭐⭐ the USB field does not consult the saved file at all',
     !/getBaselineUsb|baseline/.test(fn),
     'the red means "recompile before flashing"; a save must never be able to clear it');
  ok('and the red is driven by the build comparison alone',
     /classList\.toggle\('field-changed', buildMoved\)/.test(fn), fn.slice(0, 200));
  ok('no tooltip claims "since last compile" while measuring something else',
     !/since last compile/i.test(fn), fn);
}

// ── the Board field ────────────────────────────────────────────────────────
{
  const expr = liftAssignment(html, 'boardSel.title');
  ok('the Board tooltip expression was lifted', !!expr && expr.length > 30, String(expr).slice(0, 120));

  const title = new Function('noBoard', 'boardSel', 'boardBuildMoved', 'metaCompiledFqbn',
                             '_boardNameForFqbn', 'boardBuildUnknown', 'window',
                             'return ' + expr);
  const sel  = { value: 'proffieboard:stm32l4:Proffieboard-L433CC' };
  const name = () => 'Proffieboard V2';
  const win  = { getCompiledAtLabel: () => 'Aug 7 5:32 PM' };

  const moved = title(false, sel, true, 'proffieboard:stm32l4:Proffieboard-L433CC', name, false, win);
  ok('a Board mismatch names the board the binary was built for',
     /Last built for Proffieboard V2/.test(moved), moved);

  const unknown = title(false, sel, false, null, name, true, win);
  ok('Board has the cannot-tell state too',
     /did not record which board it used/.test(unknown) && /Aug 7 5:32 PM/.test(unknown), unknown);

  ok('a matching Board build is silent', title(false, sel, false, null, name, false, win) === '');
  ok('no-board still wins over everything',
     /No board detected/.test(title(true, sel, true, 'x', name, true, win)));

  const fn = html.slice(html.indexOf('function updateChangedIndicators'),
                        html.indexOf('function updateChangedIndicators') + 2600);
  ok('⭐⭐ the Board field does not consult the saved file either',
     !/boardChanged/.test(fn),
     'same reason as USB — saving builds nothing, so it cannot resolve a build mismatch');
  ok('Board red comes from noBoard or the build comparison only',
     /classList\.toggle\('field-changed', noBoard \|\| boardBuildMoved\)/.test(fn));
}

// ── the accessors the comparison rests on ──────────────────────────────────
{
  ok('the build record is what both fields read',
     /window\.getCompiledUsb = \(\) => metaCompiledUsb;/.test(html)
     && /window\.getCompiledAtLabel = \(\) =>/.test(html));
  ok('the timestamp is formatted by the one formatter, not re-implemented',
     /getCompiledAtLabel = \(\) => \(metaCompiled \? fmtTimestamp\(metaCompiled\) : null\)/.test(html));
  // ⚠️ OS Version was deliberately NOT swept in this pass — it still uses
  // `versionChanged` (the save test) alongside `_buildTargetMoved()`, and that is an
  // an open call rather than an oversight. Asserted so the inconsistency is
  // visible and deliberate; delete this once it is ruled on.
  ok('OS Version still carries the save comparison — KNOWN, not swept',
     /const versionChanged = baselineVersion !== null/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall build-comparison indicator tests passed');
process.exitCode = failures ? 1 : 0;
