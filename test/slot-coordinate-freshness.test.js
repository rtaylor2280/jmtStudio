/**
 * A slot's coordinates go stale the moment anything writes  [B-371]
 *
 * THE CASE THIS EXISTS FOR, 2026-09-12 on LGT1Button32: pick a style from the Style
 * Library into a slot, then press that slot's x without closing the panel. The
 * library expression is LONGER than what it replaced, so the cached end column now
 * lands inside it. `_resetSlot` wrote a shorter string over that stale range and the
 * tail of the old expression survived:
 *
 *     StylePtr<Black>()65535,0,0"),
 *
 * The stray `"` closed the preset array early and the panel read "No presets found".
 * Disk was untouched — the damage was in the buffer — which is the only reason it
 * cost nothing.
 *
 * ⭐ THE FIX IS TO ASK AGAIN, NOT TO TRACK. `_collapseBladeSlot` already re-parsed
 * for exactly this reason and found its slot by POSITION. `_liveSlot` makes that the
 * one definition of "where is this slot now", and every writer goes through it.
 *
 * TWO HALVES HERE, and the second is the one that stops it coming back:
 *   A. the re-derivation is CORRECT — a fresh parse at (presetIdx, slotIdx) finds
 *      the right slot after the document has moved underneath it.
 *   B. every writer USES it — a static check, because the failure mode is somebody
 *      adding a sixth writer that reads the cached object like the first five did.
 *
 * Run: node test/slot-coordinate-freshness.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const presetParser = require(path.join(ROOT, 'renderer', 'presetParser.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── A. the re-derivation itself ────────────────────────────────────────────
//
// Reproduced with plain string offsets rather than Monaco: staleness is a property
// of "text moved", not of the editor, and a test that needs an editor cannot run.
{
  const before = [
    '#define NUM_BLADES 2',
    'Preset presets[] = {',
    '  { "F1", "t.wav", StylePtr<Rgb16<65535,0,0>>(), StylePtr<Blue>(), "One" },',
    '  { "F2", "t.wav", StylePtr<Green>(), StylePtr<White>(), "Two" },',
    '};',
    'BladeConfig blades[] = {{ 0, WS281XBladePtr<100,bladePin>(), CONFIGARRAY(presets) }};',
  ].join('\n');

  const p0 = presetParser.parsePresets(before);
  const slotBefore = p0.arrays[0].presets[0].styles[0];
  ok('the slot parses with coordinates', !!slotBefore && slotBefore.startLine === 3,
     JSON.stringify(slotBefore && { l: slotBefore.startLine, c: slotBefore.startCol }));

  // The library pick: a much longer expression in slot 0 of preset 0. This is the
  // write that invalidates every coordinate captured from `before`.
  const longExpr = 'StylePtr<PixelSwitchWrapper<ControlMainAssasinHumpFlicker<Rgb16<65535,0,0>>>>()';
  const lines = before.split('\n');
  lines[slotBefore.startLine - 1] =
      lines[slotBefore.startLine - 1].slice(0, slotBefore.startCol)
    + longExpr
    + lines[slotBefore.startLine - 1].slice(slotBefore.endCol);
  const after = lines.join('\n');

  ok('the write really did move the slot end',
     presetParser.parsePresets(after).arrays[0].presets[0].styles[0].endCol !== slotBefore.endCol);

  // ⭐ THE BUG, DEMONSTRATED. Using the pre-write coordinates to overwrite with the
  // shorter reset string leaves the tail of the long expression behind.
  {
    const l = after.split('\n');
    l[slotBefore.startLine - 1] =
        l[slotBefore.startLine - 1].slice(0, slotBefore.startCol)
      + 'StylePtr<Black>()'
      + l[slotBefore.startLine - 1].slice(slotBefore.endCol);
    const corrupted = l.join('\n');
    ok('STALE coordinates corrupt the line (this is the bug)',
       /StylePtr<Black>\(\)\w/.test(corrupted) || /StylePtr<Black>\(\)[^,\s]/.test(corrupted),
       l[slotBefore.startLine - 1].trim());
  }

  // ⭐ THE FIX. Re-parse and locate by POSITION — preset index and slot index — which
  // is what _liveSlot does. The same reset is then clean.
  {
    const fresh = presetParser.parsePresets(after).arrays[0].presets[0].styles[0];
    const l = after.split('\n');
    l[fresh.startLine - 1] =
        l[fresh.startLine - 1].slice(0, fresh.startCol)
      + 'StylePtr<Black>()'
      + l[fresh.startLine - 1].slice(fresh.endCol);
    const repaired = l.join('\n');
    ok('RE-DERIVED coordinates replace the slot exactly',
       /\{ "F1", "t\.wav", StylePtr<Black>\(\), StylePtr<Blue>\(\), "One" \}/.test(repaired),
       l[fresh.startLine - 1].trim());

    const reparsed = presetParser.parsePresets(repaired);
    ok('the array still parses after the repaired write',
       reparsed.arrays.length === 1 && reparsed.arrays[0].presets.length === 2,
       `arrays=${reparsed.arrays.length} presets=${reparsed.arrays[0]?.presets.length}`);
    ok('the untouched preset is unharmed',
       reparsed.arrays[0].presets[1].styles.length === 2);
  }

  // ⚠️ REFUSE, DO NOT GUESS. A position that no longer exists (the preset was deleted
  // while the panel was open) must yield nothing, so the caller declines to write.
  // Falling back to the cached object is what this whole change removes.
  {
    const shrunk = presetParser.parsePresets(
      before.replace('  { "F2", "t.wav", StylePtr<Green>(), StylePtr<White>(), "Two" },\n', ''));
    ok('a position that no longer exists resolves to nothing',
       !shrunk.arrays[0].presets[1]);
  }
}

// ── B. every writer re-derives ─────────────────────────────────────────────
//
// ⚠️ THIS IS THE HALF THAT MATTERS IN SIX MONTHS. Five separate writers had the same
// defect because each one independently reached for the slot it was handed. A sixth
// will too. Naming them here means adding one without _liveSlot fails this suite
// rather than waiting to corrupt somebody's config.
{
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

  ok('_liveSlot exists', /function _liveSlot\s*\(/.test(html));
  ok('_stampSlotPosition exists', /function _stampSlotPosition\s*\(/.test(html));
  ok('the tile stamps its slot position',
     /_stampSlotPosition\(slot, presetIdx, slotIdx\)/.test(html));

  // Pull each writer's body and require a _liveSlot call inside it.
  const bodyOf = (startRe) => {
    const m = html.match(startRe);
    if (!m) return null;
    return html.slice(m.index, m.index + 2600);
  };
  const WRITERS = [
    ['_resetSlot',         /function _resetSlot\s*\(/],
    ['_commitSlotEdit',    /function _commitSlotEdit\s*\(/],
    ['commitTemplateArgs', /function commitTemplateArgs\s*\(/],
    ['_modifySlotParens',  /function _modifySlotParens\s*\(/],
  ];
  for (const [name, re] of WRITERS) {
    const body = bodyOf(re);
    ok(`${name} re-derives before writing`, !!body && /_liveSlot\(/.test(body),
       body ? 'no _liveSlot call in the first 2600 chars' : 'function not found');
  }

  // ⭐ _resetSlot REFUSES rather than falling back. It is the one writer whose whole
  // job is to overwrite a range, so a stale range there is maximally destructive —
  // it is the path that produced the reported corruption.
  const reset = bodyOf(/function _resetSlot\s*\(/);
  ok('_resetSlot refuses when the slot cannot be located',
     /const live = _liveSlot\(slot\);\s*\r?\n\s*if \(!live\) return;/.test(reset),
     'expected a hard refusal, not `|| slot`');

  // The colour picker reads the slot text before replacing inside it. That read has
  // to come from the re-derived range or it reads one region and writes another.
  ok('the colour picker reads from the re-derived range',
     /_liveSlot\(slot\) \|\| slot;[\s\S]{0,400}?_slotRangeNow/.test(html));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall slot freshness tests passed');
process.exit(failures ? 1 : 0);
