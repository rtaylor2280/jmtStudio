/**
 * effect-args.js
 * Canonical 38-arg ProffieOS StylePtr argument registry.
 * Defines fixed CSV offset positions for serializing/parsing parens strings.
 *
 * Public API:  window.proffieArgs = { registry, resolveColorDefault, readRegistryArg, writeRegistryArg }
 */

(function (root) {
  'use strict';

  // ── Canonical 38-arg table ────────────────────────────────────────────────
  // csvOffset is pre-computed: sum of widths of all preceding args.
  // kind: 'RgbArg' (3 CSV slots) | 'IntArg' (1 CSV slot)
  // Edit this table when ProffieOS adds new args — never change existing offsets.

  const registry = [
    { pos:  1, name: 'BASE_COLOR_ARG',          kind: 'RgbArg', width: 3, csvOffset:  0, label: 'Primary Base Color' },
    { pos:  2, name: 'ALT_COLOR_ARG',            kind: 'RgbArg', width: 3, csvOffset:  3, label: 'Alternate or Force Color' },
    { pos:  3, name: 'STYLE_OPTION_ARG',         kind: 'IntArg', width: 1, csvOffset:  6, label: 'Style Option' },
    { pos:  4, name: 'IGNITION_OPTION_ARG',      kind: 'IntArg', width: 1, csvOffset:  7, label: 'Ignition Options' },
    { pos:  5, name: 'IGNITION_TIME_ARG',        kind: 'IntArg', width: 1, csvOffset:  8, label: 'Ignition Time' },
    { pos:  6, name: 'IGNITION_DELAY_ARG',       kind: 'IntArg', width: 1, csvOffset:  9, label: 'Ignition Delay Time' },
    { pos:  7, name: 'IGNITION_COLOR_ARG',       kind: 'RgbArg', width: 3, csvOffset: 10, label: 'Ignition Power Up Color' },
    { pos:  8, name: 'IGNITION_POWER_UP_ARG',    kind: 'IntArg', width: 1, csvOffset: 13, label: 'Ignition Power Up Options' },
    { pos:  9, name: 'BLAST_COLOR_ARG',          kind: 'RgbArg', width: 3, csvOffset: 14, label: 'Blast Color' },
    { pos: 10, name: 'CLASH_COLOR_ARG',          kind: 'RgbArg', width: 3, csvOffset: 17, label: 'Clash Color' },
    { pos: 11, name: 'LOCKUP_COLOR_ARG',         kind: 'RgbArg', width: 3, csvOffset: 20, label: 'Lockup Color' },
    { pos: 12, name: 'LOCKUP_POSITION_ARG',      kind: 'IntArg', width: 1, csvOffset: 23, label: 'Clash/Lockup Position' },
    { pos: 13, name: 'DRAG_COLOR_ARG',           kind: 'RgbArg', width: 3, csvOffset: 24, label: 'Drag Color' },
    { pos: 14, name: 'DRAG_SIZE_ARG',            kind: 'IntArg', width: 1, csvOffset: 27, label: 'Drag Size' },
    { pos: 15, name: 'LB_COLOR_ARG',             kind: 'RgbArg', width: 3, csvOffset: 28, label: 'Lightning Block Color' },
    { pos: 16, name: 'STAB_COLOR_ARG',           kind: 'RgbArg', width: 3, csvOffset: 31, label: 'Stab / Melt Color' },
    { pos: 17, name: 'MELT_SIZE_ARG',            kind: 'IntArg', width: 1, csvOffset: 34, label: 'Stab / Melt Size' },
    { pos: 18, name: 'SWING_COLOR_ARG',          kind: 'RgbArg', width: 3, csvOffset: 35, label: 'Swing Color' },
    { pos: 19, name: 'SWING_OPTION_ARG',         kind: 'IntArg', width: 1, csvOffset: 38, label: 'Swing Options' },
    { pos: 20, name: 'EMITTER_COLOR_ARG',        kind: 'RgbArg', width: 3, csvOffset: 39, label: 'Emitter Color' },
    { pos: 21, name: 'EMITTER_SIZE_ARG',         kind: 'IntArg', width: 1, csvOffset: 42, label: 'Emitter Size' },
    { pos: 22, name: 'PREON_COLOR_ARG',          kind: 'RgbArg', width: 3, csvOffset: 43, label: 'PreOn Color' },
    { pos: 23, name: 'PREON_OPTION_ARG',         kind: 'IntArg', width: 1, csvOffset: 46, label: 'PreOn Option' },
    { pos: 24, name: 'PREON_SIZE_ARG',           kind: 'IntArg', width: 1, csvOffset: 47, label: 'PreOn Size' },
    { pos: 25, name: 'RETRACTION_OPTION_ARG',    kind: 'IntArg', width: 1, csvOffset: 48, label: 'Retraction Options' },
    { pos: 26, name: 'RETRACTION_TIME_ARG',      kind: 'IntArg', width: 1, csvOffset: 49, label: 'Retraction Time' },
    { pos: 27, name: 'RETRACTION_DELAY_ARG',     kind: 'IntArg', width: 1, csvOffset: 50, label: 'Retraction Delay Time' },
    { pos: 28, name: 'RETRACTION_COLOR_ARG',     kind: 'RgbArg', width: 3, csvOffset: 51, label: 'Retraction Cool Down Color' },
    { pos: 29, name: 'RETRACTION_COOL_DOWN_ARG', kind: 'IntArg', width: 1, csvOffset: 54, label: 'Retraction Cool Down Options' },
    { pos: 30, name: 'POSTOFF_COLOR_ARG',        kind: 'RgbArg', width: 3, csvOffset: 55, label: 'PostOff Color' },
    { pos: 31, name: 'OFF_COLOR_ARG',            kind: 'RgbArg', width: 3, csvOffset: 58, label: 'Off Color' },
    { pos: 32, name: 'OFF_OPTION_ARG',           kind: 'IntArg', width: 1, csvOffset: 61, label: 'Off Options' },
    { pos: 33, name: 'ALT_COLOR2_ARG',           kind: 'RgbArg', width: 3, csvOffset: 62, label: 'Generic 2nd Alt Color' },
    { pos: 34, name: 'ALT_COLOR3_ARG',           kind: 'RgbArg', width: 3, csvOffset: 65, label: 'Generic 3rd Alt Color' },
    { pos: 35, name: 'STYLE_OPTION2_ARG',        kind: 'IntArg', width: 1, csvOffset: 68, label: 'Generic 2nd Style Option' },
    { pos: 36, name: 'STYLE_OPTION3_ARG',        kind: 'IntArg', width: 1, csvOffset: 69, label: 'Generic 3rd Style Option' },
    { pos: 37, name: 'IGNITION_OPTION2_ARG',     kind: 'IntArg', width: 1, csvOffset: 70, label: 'Ignition BEND Option' },
    { pos: 38, name: 'RETRACTION_OPTION2_ARG',   kind: 'IntArg', width: 1, csvOffset: 71, label: 'Retraction BEND Option' },
  ];

  // ── Color default resolver ─────────────────────────────────────────────────

  const NAMED_COLORS = {
    Red:     [65535,     0,     0],
    Green:   [    0, 65535,     0],
    Blue:    [    0,     0, 65535],
    White:   [65535, 65535, 65535],
    Black:   [    0,     0,     0],
    Yellow:  [65535, 65535,     0],
    Cyan:    [    0, 65535, 65535],
    Magenta: [65535,     0, 65535],
    Orange:  [65535, 16383,     0],
    Purple:  [32767,     0, 65535],
    Pink:    [65535,     0, 32767],
  };

  /**
   * Convert a ProffieOS color default expression (e.g. "Red", "Rgb<255,0,0>")
   * to [r, g, b] in 0–65535 space.
   */
  function resolveColorDefault(expr) {
    if (!expr) return [0, 0, 0];
    const s = expr.trim();
    if (NAMED_COLORS[s]) return NAMED_COLORS[s].slice();

    // Rgb16<r,g,b> — values 0–65535
    const m16 = /^Rgb16\s*<\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*>$/.exec(s);
    if (m16) return [parseInt(m16[1], 10), parseInt(m16[2], 10), parseInt(m16[3], 10)];

    // Rgb<r,g,b> — values 0–255
    const m8 = /^Rgb\s*<\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*>$/.exec(s);
    if (m8) return [
      Math.round(parseInt(m8[1], 10) * 257),
      Math.round(parseInt(m8[2], 10) * 257),
      Math.round(parseInt(m8[3], 10) * 257),
    ];

    return [0, 0, 0];
  }

  // ── Parens string helpers ──────────────────────────────────────────────────

  /** Parse parens CSV string into a sparse array of strings (empty string = not set). */
  function parseParts(parensStr) {
    if (!parensStr) return [];
    return parensStr.split(',');
  }

  /**
   * Read the CSV values for a named arg from the parens string.
   * Returns { values: number[]|null (null for each unset slot), isDefault: boolean }.
   * isDefault is true when ALL slots for this arg are absent/empty.
   */
  function readRegistryArg(argName, parensStr) {
    const reg = registry.find(r => r.name === argName);
    if (!reg) return null;
    const parts = parseParts(parensStr);
    const values = [];
    let allEmpty = true;
    for (let i = 0; i < reg.width; i++) {
      const raw = (parts[reg.csvOffset + i] || '').trim();
      if (raw !== '') { allEmpty = false; values.push(parseInt(raw, 10) || 0); }
      else            { values.push(null); }
    }
    return { values, isDefault: allEmpty, reg };
  }

  /**
   * Write new values for a named arg into the parens string.
   * Pass null for newValues to clear (reset to default / empty).
   * Returns the updated parens string with no trailing commas.
   */
  function writeRegistryArg(argName, newValues, currentParensStr) {
    const reg = registry.find(r => r.name === argName);
    if (!reg) return currentParensStr || '';

    const parts = parseParts(currentParensStr);
    const needed = reg.csvOffset + reg.width;
    while (parts.length < needed) parts.push('');

    if (newValues === null) {
      for (let i = 0; i < reg.width; i++) parts[reg.csvOffset + i] = '';
    } else {
      for (let i = 0; i < reg.width; i++) {
        parts[reg.csvOffset + i] = String(newValues[i] != null ? newValues[i] : 0);
      }
    }

    // Trim trailing empty slots
    while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();

    return parts.join(',');
  }

  function colorLabel(r16, g16, b16) {
    for (const [name, vals] of Object.entries(NAMED_COLORS)) {
      if (vals[0] === r16 && vals[1] === g16 && vals[2] === b16) return name;
    }
    return `Rgb<${Math.round(r16/257)},${Math.round(g16/257)},${Math.round(b16/257)}>`;
  }

  root.proffieArgs = { registry, resolveColorDefault, readRegistryArg, writeRegistryArg, colorLabel };

})(window);
