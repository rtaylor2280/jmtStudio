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

  // Values stored as 16-bit ProffieOS (0–65535). Proper-case entries come first
  // so reverse lookup (colorLabel) returns the canonical name, not an alias.
  const C = (r, g, b) => [r * 257, g * 257, b * 257];
  const NAMED_COLORS = {
    // ── Core ──────────────────────────────────────────────────────────────────
    Red:               C(255,   0,   0),
    Green:             C(  0, 255,   0),
    Blue:              C(  0,   0, 255),
    Yellow:            C(255, 255,   0),
    Cyan:              C(  0, 255, 255),
    Magenta:           C(255,   0, 255),
    White:             C(255, 255, 255),
    Black:             C(  0,   0,   0),
    Orange:            C(255,  97,   0),
    Pink:              C(255, 136, 154),
    Purple:            C(127,   0, 255),  // legacy alias → same as ElectricPurple
    // ── Extended ──────────────────────────────────────────────────────────────
    AliceBlue:         C(223, 239, 255),
    Aqua:              C(  0, 255, 255),  // alias for Cyan
    Aquamarine:        C( 55, 255, 169),
    Azure:             C(223, 255, 255),
    Bisque:            C(255, 199, 142),
    BlanchedAlmond:    C(255, 213, 157),
    Chartreuse:        C( 55, 255,   0),
    Coral:             C(255,  55,  19),
    Cornsilk:          C(255, 239, 184),
    DarkOrange:        C(255,  68,   0),
    DeepPink:          C(255,   0,  75),
    DeepSkyBlue:       C(  0, 135, 255),
    DodgerBlue:        C(  2,  72, 255),
    FloralWhite:       C(255, 244, 223),
    Fuchsia:           C(255,   0, 255),  // alias for Magenta
    GhostWhite:        C(239, 239, 255),
    GreenYellow:       C(108, 255,   6),
    HoneyDew:          C(223, 255, 223),
    HotPink:           C(255,  36, 118),
    Ivory:             C(255, 255, 223),
    LavenderBlush:     C(255, 223, 233),
    LemonChiffon:      C(255, 244, 157),
    LightCyan:         C(191, 255, 255),
    LightPink:         C(255, 121, 138),
    LightSalmon:       C(255,  91,  50),
    LightYellow:       C(255, 255, 191),
    Lime:              C(  0, 255,   0),  // alias for Green
    MintCream:         C(233, 255, 244),
    MistyRose:         C(255, 199, 193),
    Moccasin:          C(255, 199, 119),
    NavajoWhite:       C(255, 187, 108),
    OrangeRed:         C(255,  14,   0),
    PapayaWhip:        C(255, 221, 171),
    PeachPuff:         C(255, 180, 125),
    SeaShell:          C(255, 233, 219),
    Snow:              C(255, 244, 244),
    SpringGreen:       C(  0, 255,  55),
    SteelBlue:         C( 14,  57, 118),
    Tomato:            C(255,  31,  15),
    // ── ProffieOS 8.x ─────────────────────────────────────────────────────────
    ElectricPurple:    C(127,   0, 255),
    ElectricViolet:    C( 71,   0, 255),
    ElectricLime:      C(156, 255,   0),
    Amber:             C(255, 135,   0),
    CyberYellow:       C(255, 168,   0),
    CanaryYellow:      C(255, 221,   0),
    PaleGreen:         C( 28, 255,  28),
    Flamingo:          C(255,  80, 154),
    VividViolet:       C( 90,   0, 255),
    PsychedelicPurple: C(186,   0, 255),
    HotMagenta:        C(255,   0, 156),
    BrutalPink:        C(255,   0, 128),
    NeonRose:          C(255,   0,  55),
    VividRaspberry:    C(255,   0,  38),
    HaltRed:           C(255,   0,  19),
    MoltenCore:        C(255,  24,   0),
    SafetyOrange:      C(255,  33,   0),
    OrangeJuice:       C(255,  55,   0),
    ImperialYellow:    C(255, 115,   0),
    SchoolBus:         C(255, 176,   0),
    SuperSaiyan:       C(255, 186,   0),
    Star:              C(255, 201,   0),
    Lemon:             C(255, 237,   0),
    ElectricBanana:    C(246, 255,   0),
    BusyBee:           C(231, 255,   0),
    ZeusBolt:          C(219, 255,   0),
    LimeZest:          C(186, 255,   0),
    Limoncello:        C(135, 255,   0),
    CathodeGreen:      C(  0, 255,  22),
    MintyParadise:     C(  0, 255, 128),
    PlungePool:        C(  0, 255, 156),
    VibrantMint:       C(  0, 255, 201),
    MasterSwordBlue:   C(  0, 255, 219),
    BrainFreeze:       C(  0, 219, 255),
    BlueRibbon:        C(  0,  33, 255),
    RareBlue:          C(  0,  13, 255),
    OverdueBlue:       C( 13,   0, 255),
    ViolentViolet:     C( 55,   0, 255),
    // ── ALL_CAPS aliases (end = lower reverse-lookup priority) ────────────────
    RED:               C(255,   0,   0),
    GREEN:             C(  0, 255,   0),
    BLUE:              C(  0,   0, 255),
    YELLOW:            C(255, 255,   0),
    CYAN:              C(  0, 255, 255),
    MAGENTA:           C(255,   0, 255),
    WHITE:             C(255, 255, 255),
    BLACK:             C(  0,   0,   0),
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

  function isNamedColor(s) {
    return Object.prototype.hasOwnProperty.call(NAMED_COLORS, s);
  }

  function colorLabel(r16, g16, b16) {
    for (const [name, vals] of Object.entries(NAMED_COLORS)) {
      if (vals[0] === r16 && vals[1] === g16 && vals[2] === b16) return name;
    }
    return `Rgb<${Math.round(r16/257)},${Math.round(g16/257)},${Math.round(b16/257)}>`;
  }

  root.proffieArgs = { registry, resolveColorDefault, readRegistryArg, writeRegistryArg, colorLabel, isNamedColor, namedColors: NAMED_COLORS };

})(window);
