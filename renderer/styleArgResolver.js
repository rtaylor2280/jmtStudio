/**
 * styleArgResolver.js
 * Parses RgbArg/IntArg from a ProffieOS style expression and reads/writes
 * positional values in the StylePtr parens string ("65535,0,0").
 *
 * Public API:  window.styleArgResolver = { findArgs, resolveStyleArgs, readArgValue, writeArgValue, styleColors, proffieToCSS, cssToProffie }
 */

(function (root) {
  'use strict';

  /**
   * Find all RgbArg/IntArg instances in a style expression, in order of
   * appearance. Each entry has: { kind, name, defaultExpr, width, start, end }
   * where width is 3 for RgbArg and 1 for IntArg, defaultExpr is the second
   * template parameter (e.g. "Red" from RgbArg<BASE_COLOR_ARG, Red>), and
   * start and end are where the whole argument sits in expr.
   */
  function findArgs(expr) {
    if (!expr) return [];
    const re = /\b(RgbArg|IntArg)\s*</g;
    const args = [];
    let m;
    while ((m = re.exec(expr)) !== null) {
      // Walk forward to find the matching closing '>' (handles nested templates)
      let depth = 1, i = m.index + m[0].length;
      while (i < expr.length && depth > 0) {
        if (expr[i] === '<') depth++;
        else if (expr[i] === '>') depth--;
        i++;
      }
      const inner = expr.slice(m.index + m[0].length, i - 1);
      const commaIdx = inner.indexOf(',');
      if (commaIdx < 0) continue;
      const name        = inner.slice(0, commaIdx).trim();
      const defaultExpr = inner.slice(commaIdx + 1).trim();
      args.push({
        kind:        m[1],
        name,
        defaultExpr,
        width: m[1] === 'RgbArg' ? 3 : 1,
        start: m.index,
        end:   i,
      });
    }
    return args;
  }

  // ── Parens helpers — delegate to window.proffieArgs for slot-based format ──
  //
  // Read/write all go through proffieArgs.readRegistryArg / writeRegistryArg so
  // the slot-map-aware logic lives in one place (effect-args.js). styleArgResolver
  // adds the value of starting from a STYLE EXPRESSION (extracting the arg names
  // it actually uses), then per-arg read/write are slot-keyed.

  /**
   * Resolve each arg used by the expression to its current values in the parens
   * string. Returns array of { kind, name, width, slot, values } in order of
   * appearance in the expression. `slot` is the ArgumentName enum slot number
   * (or null when the arg isn't recognised by the current OS version).
   */
  function resolveStyleArgs(expr, parensStr) {
    const args = findArgs(expr);
    const proffie = (typeof window !== 'undefined' ? window.proffieArgs : null);
    return args.map(arg => {
      let values = [];
      let slot   = null;
      if (proffie && typeof proffie.readRegistryArg === 'function') {
        const res = proffie.readRegistryArg(arg.name, parensStr);
        if (res) {
          values = res.values.map(v => v == null ? 0 : v);
          slot   = (proffie.slotMap && proffie.slotMap[arg.name] != null) ? proffie.slotMap[arg.name] : null;
        }
      }
      return { kind: arg.kind, name: arg.name, width: arg.width, slot, values };
    });
  }

  /**
   * Look up a single arg by name. Returns the resolved entry or null.
   */
  function readArgValue(expr, parensStr, argName) {
    return resolveStyleArgs(expr, parensStr).find(a => a.name === argName) || null;
  }

  /**
   * Write new values for one arg into the parens string. Returns the updated
   * parens string (modern slot-based format). No-ops when the arg isn't used by
   * the style expression OR isn't in the current OS version's ArgumentName enum.
   */
  function writeArgValue(expr, parensStr, argName, newValues) {
    const args = findArgs(expr);
    if (!args.some(a => a.name === argName)) return parensStr || '';
    const proffie = (typeof window !== 'undefined' ? window.proffieArgs : null);
    if (!proffie || typeof proffie.writeRegistryArg !== 'function') return parensStr || '';
    return proffie.writeRegistryArg(argName, newValues, parensStr || '');
  }

  /**
   * Convert ProffieOS color values (0–65535 per channel) to CSS rgb().
   */
  function proffieToCSS(r, g, b) {
    return `rgb(${Math.round((r || 0) / 257)},${Math.round((g || 0) / 257)},${Math.round((b || 0) / 257)})`;
  }

  /**
   * Convert CSS 0–255 per channel to ProffieOS 0–65535.
   */
  function cssToProffie(r, g, b) {
    return [Math.round(r * 257), Math.round(g * 257), Math.round(b * 257)];
  }

  /**
   * A style's colours as written: { args, main, mainText }. args holds each RgbArg it uses, once, in the
   * registry's order, as { name, label, rgb16 }, the default it is written with. A default that
   * isn't a colour yet (a template parameter) has no value to show, so it is left out. main is
   * the first colour written outside its arguments when it has no Base, or null, and mainText
   * that colour as the code spells it. [B-608] own is the style without its segments: a Base only
   * a segment brings colours that segment, not the blade, so it is no Base here. [B-611]
   */
  function styleColors(code, own = code) {
    const pa = root.proffieArgs;
    const clean = (c) => String(c || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      .replace(/^\s*using\s+[^=]+=/, '');
    const text = clean(code), ownText = clean(own);
    const found = new Map();
    for (const a of findArgs(text)) {
      if (a.kind !== 'RgbArg' || found.has(a.name)) continue;
      const rgb16 = pa.resolveColorDefault(a.defaultExpr);
      if (!rgb16.some(Boolean) && !/^(Black|BLACK|Rgb(16)?\s*<\s*0\s*,\s*0\s*,\s*0\s*>)$/.test(a.defaultExpr)) continue;
      const reg = pa.registry.find(r => r.name === a.name);
      found.set(a.name, { name: a.name, label: reg ? reg.label : a.name, pos: reg ? reg.pos : Infinity, rgb16 });
    }
    if (!findArgs(ownText).some(a => a.name === 'BASE_COLOR_ARG')) found.delete('BASE_COLOR_ARG');
    const args = [...found.values()].sort((a, b) => a.pos - b.pos);
    const hit = found.has('BASE_COLOR_ARG') ? null : mainColor(ownText);
    return { args, main: hit ? hit.rgb16 : null, mainText: hit ? hit.matchStr : null };
  }

  /**
   * The first colour written into a style, read past its arguments: an argument's default is what
   * that argument starts as, not what the blade paints. This is a detected colour wherever one is
   * shown or used. { rgb16, matchStr, matchIndex, scale } or null, matchIndex being a place in text
   * as given, so the arguments are blanked rather than cut. [B-611]
   */
  function mainColor(text) {
    const pa = root.proffieArgs;
    if (!pa) return null;
    const src = String(text || '');
    return pa.earliestColor(findArgs(src).filter(a => a.kind === 'RgbArg')
      .reduce((t, a) => t.slice(0, a.start) + ' '.repeat(a.end - a.start) + t.slice(a.end), src));
  }

  root.styleArgResolver = { findArgs, resolveStyleArgs, readArgValue, writeArgValue, styleColors, mainColor, proffieToCSS, cssToProffie };

})(window);
