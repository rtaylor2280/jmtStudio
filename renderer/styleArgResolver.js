/**
 * styleArgResolver.js
 * Parses RgbArg/IntArg from a ProffieOS style expression and reads/writes
 * positional values in the StylePtr parens string ("65535,0,0").
 *
 * Public API:  window.styleArgResolver = { findArgs, resolveStyleArgs, readArgValue, writeArgValue, proffieToCSS, cssToProffie }
 */

(function (root) {
  'use strict';

  /**
   * Find all RgbArg/IntArg instances in a style expression, in order of
   * appearance. Each entry has: { kind, name, width } where width is 3
   * for RgbArg and 1 for IntArg.
   */
  function findArgs(expr) {
    if (!expr) return [];
    const re = /\b(RgbArg|IntArg)\s*<\s*(\w+)\s*,\s*[^>]+>/g;
    const args = [];
    let m;
    while ((m = re.exec(expr)) !== null) {
      args.push({
        kind:  m[1],
        name:  m[2],
        width: m[1] === 'RgbArg' ? 3 : 1,
      });
    }
    return args;
  }

  /**
   * Parse the parens string ("65535,0,0") into an array of integers.
   */
  function parseParens(parensStr) {
    if (!parensStr) return [];
    return parensStr.split(',').map(s => {
      const v = parseInt(s.trim(), 10);
      return Number.isFinite(v) ? v : 0;
    });
  }

  /**
   * Resolve each arg to its values in the parens string.
   * Returns an array of { kind, name, width, startPos, values }.
   */
  function resolveStyleArgs(expr, parensStr) {
    const args = findArgs(expr);
    const vals = parseParens(parensStr);
    let pos = 0;
    return args.map(arg => {
      const startPos = pos;
      pos += arg.width;
      return {
        kind:     arg.kind,
        name:     arg.name,
        width:    arg.width,
        startPos,
        values:   vals.slice(startPos, pos),
      };
    });
  }

  /**
   * Look up a single arg by name. Returns the resolved entry or null.
   */
  function readArgValue(expr, parensStr, argName) {
    return resolveStyleArgs(expr, parensStr).find(a => a.name === argName) || null;
  }

  /**
   * Write new values for one arg into the parens string.
   * Returns the updated parens string.
   */
  function writeArgValue(expr, parensStr, argName, newValues) {
    const args = findArgs(expr);
    const vals = parseParens(parensStr);
    let pos = 0;
    for (const arg of args) {
      if (arg.name === argName) {
        for (let i = 0; i < arg.width; i++) {
          vals[pos + i] = newValues[i] != null ? newValues[i] : 0;
        }
        break;
      }
      pos += arg.width;
    }
    return vals.join(',');
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

  root.styleArgResolver = { findArgs, resolveStyleArgs, readArgValue, writeArgValue, proffieToCSS, cssToProffie };

})(window);
