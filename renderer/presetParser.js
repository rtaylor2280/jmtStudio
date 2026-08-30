/**
 * presetParser.js
 * Parses ProffieOS config files to extract preset array structure.
 * Renderer-side module — operates on config text already in the Monaco editor.
 *
 * Public API:
 *   parsePresets(text)  → { arrays: PresetArray[], bladeCount: number, warnings: string[] }
 *
 * PresetArray  { name, startLine, endLine, presets: Preset[] }
 * Preset       { index, font, track, displayName, styles: StyleSlot[],
 *                fontRange, trackRange, displayNameRange,
 *                startLine, endLine, raw, parseError }
 * StyleSlot    { expr, isHelper, startLine, endLine, startCol, endCol }
 */

(function (root) {
  'use strict';

  // ── Low-level readers ──────────────────────────────────────────────────────

  /** Skip whitespace and C/C++ comments. Returns new position. */
  function skipWS(text, pos) {
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { pos++; continue; }
      if (text[pos] === '/' && text[pos + 1] === '/') {
        while (pos < text.length && text[pos] !== '\n') pos++;
        continue;
      }
      if (text[pos] === '/' && text[pos + 1] === '*') {
        pos += 2;
        while (pos < text.length && !(text[pos - 1] === '*' && text[pos] === '/')) pos++;
        pos++;
        continue;
      }
      break;
    }
    return pos;
  }

  /** Returns the 1-based line number for character offset `pos` in `text`. */
  function lineAt(text, pos) {
    let n = 1;
    for (let i = 0; i < pos && i < text.length; i++) {
      if (text[i] === '\n') n++;
    }
    return n;
  }

  /** Returns the 0-based column for character offset `pos` in `text`. */
  function colAt(text, pos) {
    let col = 0;
    for (let i = pos - 1; i >= 0 && text[i] !== '\n'; i--) col++;
    return col;
  }

  /**
   * Read a C string literal starting at pos (which must be `"`).
   * Returns { value, end } where end is the position after the closing `"`.
   */
  function readString(text, pos) {
    if (text[pos] !== '"') return null;
    let i = pos + 1, s = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') { s += text[i + 1] || ''; i += 2; continue; }
      if (ch === '"')  { return { value: s, end: i + 1 }; }
      s += ch; i++;
    }
    return null;
  }

  /**
   * Read a balanced brace group starting at pos (which must be `{`).
   * Handles nested braces, strings, and comments.
   * Returns { content, end } where end is after the closing `}`.
   */
  function readBraceGroup(text, pos) {
    if (text[pos] !== '{') return null;
    let depth = 0, i = pos;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"')               { const s = readString(text, i); if (s) { i = s.end; continue; } }
      if (ch === '/' && text[i+1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (ch === '/' && text[i+1] === '*')  { i += 2; while (i < text.length && !(text[i-1] === '*' && text[i] === '/')) i++; i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return { content: text.slice(pos, i + 1), end: i + 1 }; }
      i++;
    }
    return null;
  }

  /**
   * Read a balanced angle-bracket sequence starting at pos (which must be `<`).
   * Returns { inner, end } where inner is the content inside the outer `< >`.
   */
  function readAngleGroup(text, pos) {
    if (text[pos] !== '<') return null;
    let depth = 0, i = pos;
    while (i < text.length) {
      if (text[i] === '<') depth++;
      else if (text[i] === '>') { depth--; if (depth === 0) return { inner: text.slice(pos + 1, i), end: i + 1 }; }
      i++;
    }
    return null;
  }

  /**
   * Read a balanced parenthesis group starting at pos (which must be `(`).
   * Handles nested parens, strings, and C/C++ comments.
   * Returns { end } where end is after the closing `)`.
   */
  function readParenGroup(text, pos) {
    if (text[pos] !== '(') return null;
    let depth = 0, i = pos;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"')               { const s = readString(text, i); if (s) { i = s.end; continue; } }
      if (ch === '/' && text[i+1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (ch === '/' && text[i+1] === '*') { i += 2; while (i < text.length && !(text[i-1] === '*' && text[i] === '/')) i++; i++; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) return { end: i + 1 }; }
      i++;
    }
    return null;
  }

  // ── Blade count extraction ─────────────────────────────────────────────────

  /**
   * Splits a text segment by commas at depth 0, respecting <>, (), {}, strings, and
   * line/block comments. Trims items and drops empties. Used to break apart a
   * BladeConfig entry's items so each can be classified independently.
   */
  function splitTopLevelCommas(text) {
    const items = [];
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        const s = readString(text, i);
        if (s) { i = s.end; continue; }
      }
      if (ch === '/' && text[i+1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (ch === '/' && text[i+1] === '*') { i += 2; while (i < text.length && !(text[i-1] === '*' && text[i] === '/')) i++; i++; continue; }
      if (ch === '<' || ch === '(' || ch === '{') depth++;
      else if (ch === '>' || ch === ')' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) {
        items.push(text.slice(start, i));
        start = i + 1;
      }
      i++;
    }
    if (start < text.length) items.push(text.slice(start));
    return items.map(s => s.trim()).filter(s => s.length > 0);
  }

  /**
   * Extracts blade count from a config.
   * Primary: `#define NUM_BLADES N`
   * Fallback: count top-level blade-type expressions in the first BladeConfig entry.
   *   Correctly handles: leading whitespace/comments before the first entry,
   *   DimBlade-wrapped blades (count once, not twice), and CONFIGARRAY/trigger value
   *   items that aren't blade declarations.
   */
  function extractBladeCount(text) {
    const m = text.match(/#define\s+NUM_BLADES\s+(\d+)/);
    if (m) return parseInt(m[1], 10);

    const bcMatch = text.match(/BladeConfig\s+\w+\s*\[\s*\]\s*=\s*\{/);
    if (!bcMatch) return null;

    const bodyStart = bcMatch.index + bcMatch[0].length - 1;
    const body = readBraceGroup(text, bodyStart);
    if (!body) return null;

    // body.content = `{ ...entries... }`. Find the first nested `{` (start of first entry),
    // skipping leading whitespace, line comments, and block comments. The previous
    // implementation hardcoded position 1, which failed whenever a blank line or comment
    // sat between the outer `{` and the first entry.
    const inner = body.content;
    let i = 1; // skip the outer opening `{`
    while (i < inner.length) {
      const ch = inner[i];
      if (ch === '/' && inner[i+1] === '/') { while (i < inner.length && inner[i] !== '\n') i++; continue; }
      if (ch === '/' && inner[i+1] === '*') { i += 2; while (i < inner.length && !(inner[i-1] === '*' && inner[i] === '/')) i++; i++; continue; }
      if (ch === '{') break;
      i++;
    }
    if (i >= inner.length) return null;

    const firstEntry = readBraceGroup(inner, i);
    if (!firstEntry) return null;

    // Split the entry by top-level commas, count items whose leading identifier is a
    // blade type. This treats `DimBlade(WS281XBladePtr<...>())` as a single blade (not
    // two), and skips the trigger value and `CONFIGARRAY(presets)` which aren't blades.
    const entryBody = firstEntry.content.slice(1, -1);
    const items     = splitTopLevelCommas(entryBody);
    const bladeRe   = /^(WS281XBladePtr|SubBlade|SubBladeReverse|SubBladeWithStride|SimpleBladePtr|DimBlade|SSD1306Blade)\b/;
    const count     = items.filter(it => bladeRe.test(it)).length;
    return count > 0 ? count : null;
  }

  // ── StylePtr extraction ────────────────────────────────────────────────────

  /**
   * Returns true if `expr` has a comma at the top level (not inside <> brackets).
   * Used to detect raw argument lists like `CYAN, WHITE, 300, 800`.
   */
  function hasTopLevelComma(expr) {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '<') depth++;
      else if (expr[i] === '>') depth--;
      else if (expr[i] === ',' && depth === 0) return true;
    }
    return false;
  }

  /**
   * Returns the outer name of an expression — the identifier before any `<`.
   * e.g. `PixelSwitchWrapper<QuantumStyle3>` → `PixelSwitchWrapper`
   */
  function outerName(expr) {
    const m = expr.match(/^(\w+)/);
    return m ? m[1] : '';
  }

  /**
   * Extracts all style slots from a preset entry text span.
   * Handles:
   *   XxxStylePtr<T>()         — standard
   *   XxxStylePtr<T>("arg")    — with color arg
   *   XxxStylePtr<T>(// c\n"") — comment in parens
   *   &style_identifier        — raw pointer reference
   * Returns array of { type, expr, colorArg, startOffset, endOffset }.
   *   type     = 'styleptr' | 'ref'
   *   expr     = inner content of <> (for styleptr) or identifier (for ref)
   *   colorArg = string value from ("arg") or null
   */
  function extractStyleSlots(text) {
    const results = [];

    // Pass 1: XxxStylePtr<T>(...)
    const re = /\b\w*StylePtr\s*</g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const openAngle = m.index + m[0].length - 1;
      const angleGroup = readAngleGroup(text, openAngle);
      if (!angleGroup) continue;

      const parenStart = skipWS(text, angleGroup.end);
      if (text[parenStart] !== '(') continue;

      const parenGroup = readParenGroup(text, parenStart);
      if (!parenGroup) continue;

      // Extract color arg string from parens if present
      const parenInner = text.slice(parenStart + 1, parenGroup.end - 1).trim();
      let colorArg = null;
      if (parenInner) {
        // Strip comments then look for a string literal
        const stripped = parenInner.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
        const sm = stripped.match(/^"([^"\\]*)"/);
        if (sm) colorArg = sm[1];
      }

      results.push({
        type:        'styleptr',
        expr:        angleGroup.inner.trim(),
        colorArg,
        startOffset: m.index,
        endOffset:   parenGroup.end,
      });
      re.lastIndex = parenGroup.end;
    }

    // Pass 2: &style_identifier  (raw pointer, e.g. &style_pov, &style_charging)
    const refRe = /&(\w+)/g;
    let rm;
    while ((rm = refRe.exec(text)) !== null) {
      const name = rm[1];
      // Skip if this offset is already inside a StylePtr span
      if (results.some(r => rm.index >= r.startOffset && rm.index < r.endOffset)) continue;
      results.push({
        type:        'ref',
        expr:        name,
        colorArg:    null,
        startOffset: rm.index,
        endOffset:   rm.index + rm[0].length,
      });
    }

    // Sort by start offset so slots come out in source order
    results.sort((a, b) => a.startOffset - b.startOffset);
    return results;
  }

  /**
   * Classifies a style expression as 'helper', 'inline', or 'ref'.
   * 'ref'    = &style_identifier (pointer, not a StylePtr at all)
   * 'helper' = single named template from Style Library (CamelCase, ≤2 angle pairs, no top-level comma)
   * 'inline' = complex expression tree defined directly
   */
  function classifyStyle(type, expr) {
    if (type === 'ref') return 'ref';
    if (!expr) return 'inline';

    // Raw argument list (e.g. CYAN, WHITE, 300, 800 from StyleNormalPtr<CYAN,...>)
    if (hasTopLevelComma(expr)) return 'inline';

    const INLINE_ROOTS = /^(Layers|Mix|Blast|Lockup|InOut|Transition|TrLoop|TrWipe|TrJoin|TrConcat|TrFade|AudioFlicker|Strobe|Sparkle|Gradient|ColorSelect|EffectSequence|StyleFire|OnSpark|Pulsing|Bump|Scale|Ifon|ResponsiveStab|ResponsiveBlast|ResponsiveLightning|SimpleClash|AlphaL|HumpFlicker|RandomFlicker|BrownNoise|LocalizedClash|EASYBLADE)/;
    if (INLINE_ROOTS.test(expr)) return 'inline';

    // More than 2 angle-bracket pairs → complex nested tree
    if ((expr.match(/</g) || []).length > 2) return 'inline';

    // Single ALL_CAPS identifier with no angles (e.g. CYAN, WHITE) → inline color constant used as style
    if (/^[A-Z][A-Z0-9_]*$/.test(outerName(expr))) return 'inline';

    return 'helper';
  }

  // ── String extraction ──────────────────────────────────────────────────────

  /**
   * Extracts top-level string literals from a preset entry's inner text,
   * excluding any that fall inside a StylePtr<T>(args) span.
   */
  function extractTopLevelStrings(text, stylePtrSpans) {
    const strings = [];
    let i = 0;
    while (i < text.length) {
      // Skip line comments
      if (text[i] === '/' && text[i+1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      // Skip block comments
      if (text[i] === '/' && text[i+1] === '*') {
        i += 2;
        while (i < text.length && !(text[i-1] === '*' && text[i] === '/')) i++;
        i++;
        continue;
      }
      // Skip any character inside a StylePtr span
      const span = stylePtrSpans.find(s => i >= s.startOffset && i < s.endOffset);
      if (span) { i = span.endOffset; continue; }

      if (text[i] === '"') {
        const s = readString(text, i);
        if (s) {
          strings.push({ value: s.value, startOffset: i, endOffset: s.end });
          i = s.end;
          continue;
        }
      }
      i++;
    }
    return strings;
  }

  // ── Single preset entry parser ─────────────────────────────────────────────

  /**
   * Parses a single preset entry from its raw `{ ... }` text.
   * Returns { font, track, displayName, styles, _fontStr, _trackStr, _displayNameStr }.
   * The _xxxStr fields are { value, startOffset, endOffset } relative to inner text,
   * used by parsePresets to compute absolute Monaco ranges for field editing.
   */
  function parsePresetEntry(raw) {
    const inner = raw.slice(1, raw.length - 1); // strip outer { }
    const slots   = extractStyleSlots(inner);
    const strings = extractTopLevelStrings(inner, slots);

    // Display name = last string that comes after all style slots
    const lastSlotEnd = slots.length ? slots[slots.length - 1].endOffset : 0;
    let resolvedName = '';
    let nameStrIdx = -1;
    // Walk strings from last to first, pick the first one that follows the last slot
    for (let i = strings.length - 1; i >= 0; i--) {
      if (strings[i].startOffset > lastSlotEnd) {
        resolvedName = strings[i].value;
        nameStrIdx = i;
        break;
      }
    }
    // Fallback: if no string follows the slots, last string is the name (or empty)
    if (!resolvedName && strings.length > 2) {
      resolvedName = strings[strings.length - 1].value;
      nameStrIdx = strings.length - 1;
    }

    // strings[1] may coincide with displayName when there is no separate track field;
    // avoid returning it as trackStr in that case to prevent double-editing.
    const trackStr = (strings[1] && nameStrIdx !== 1) ? strings[1] : null;

    const styles = slots.map(sp => ({
      type:        sp.type,
      expr:        sp.expr,
      colorArg:    sp.colorArg,
      styleClass:  classifyStyle(sp.type, sp.expr),
      startOffset: sp.startOffset,
      endOffset:   sp.endOffset,
    }));

    return {
      font:        strings[0]?.value ?? '',
      track:       strings[1]?.value ?? '',
      displayName: resolvedName,
      styles,
      _fontStr:        strings[0] || null,
      _trackStr:       trackStr,
      _displayNameStr: nameStrIdx >= 0 ? strings[nameStrIdx] : null,
    };
  }

  /**
   * Converts a string offset object { startOffset, endOffset } (relative to innerBase in full text)
   * into an absolute Monaco-style range { startLine, startCol, endLine, endCol }.
   * startCol / endCol are 0-based; callers must add 1 when building Monaco IRange objects.
   */
  function makeStrRange(text, base, strObj) {
    if (!strObj) return null;
    return {
      startLine: lineAt(text, base + strObj.startOffset),
      startCol:  colAt(text, base + strObj.startOffset),
      endLine:   lineAt(text, base + strObj.endOffset),
      endCol:    colAt(text, base + strObj.endOffset),
    };
  }

  // ── Blade label extraction ─────────────────────────────────────────────────

  /**
   * Scans an array body for a `// @jmt-labels:` comment and parses Bn="label" pairs.
   * Returns { labels: { [n]: string }, labelBodyOffset: number|null }.
   * labelBodyOffset is the char offset within bodyContent where the comment starts.
   * Malformed comments are ignored gracefully.
   */
  function extractLabels(bodyContent) {
    const re = /\/\/\s*@jmt-labels:\s*(.*)/;
    const match = re.exec(bodyContent);
    if (!match) return { labels: {}, labelBodyOffset: null };
    const labels = {};
    try {
      const pairRe = /B(\d+)\s*=\s*"([^"]*)"/g;
      let pm;
      while ((pm = pairRe.exec(match[1])) !== null) {
        labels[parseInt(pm[1], 10)] = pm[2];
      }
    } catch (_) { /* ignore malformed */ }
    return { labels, labelBodyOffset: match.index };
  }

  /**
   * Scans an array body for a `// @jmt-follow:` comment and parses Bn=Bm pairs.
   * Returns { follows: { [follower]: target }, followBodyOffset: number|null }.
   *
   * Its own line, deliberately NOT merged into @jmt-labels. Two concerns on one comment line makes
   * the delete-when-empty logic fragile, which this codebase has been bitten by before, and the two
   * have independent lifetimes: a blade can be named without following, and vice versa.
   *
   * A follower may only target a LOWER-numbered blade. That makes cycles structurally impossible
   * instead of something to detect, and "never on B1" falls out of it rather than being a special
   * case. Pairs that break the rule are dropped here rather than trusted downstream. (B-219)
   */
  function extractFollows(bodyContent) {
    const re = /\/\/\s*@jmt-follow:\s*(.*)/;
    const match = re.exec(bodyContent);
    if (!match) return { follows: {}, followBodyOffset: null };
    const follows = {};
    try {
      const pairRe = /B(\d+)\s*=\s*B(\d+)/g;
      let pm;
      while ((pm = pairRe.exec(match[1])) !== null) {
        const follower = parseInt(pm[1], 10);
        const target   = parseInt(pm[2], 10);
        // Self-follow and forward references are meaningless; a malformed line must not be able to
        // make the app write a blade from itself or chase a cycle.
        if (target < follower) follows[follower] = target;
      }
    } catch (_) { /* ignore malformed */ }
    return { follows, followBodyOffset: match.index };
  }

  /** Whitespace-insensitive comparison of two slot expressions. */
  function sameExpr(a, b) {
    return (a || '').replace(/\s+/g, '') === (b || '').replace(/\s+/g, '');
  }

  /**
   * Decide which followers of `sourceBlade` should receive `newText` within ONE preset.
   *
   * Returns [{ blade, text }] for the blades that must be written, ascending. Pure: the caller
   * supplies the preset's current slot text and turns the result into editor edits.
   *
   * WHY THIS IS CONDITIONAL, and it is the load-bearing half of the no-override-list design.
   * Nothing anywhere records that a preset overrode a follower. It does not need to: the follower
   * holds TEXT, so a follower whose text still equals the target's PREVIOUS text was following, and
   * one that differs was overridden by hand. Writing unconditionally would silently destroy every
   * per-preset exception, which is the one thing the feature must never do.
   *
   * The cascade is stepwise for the same reason. With B2=B1 and B3=B2, an edit to B1 reaches B3 only
   * if B2 actually moved: if B2 is overridden in this preset, B3 is following a blade that did not
   * change, so it stays put. Termination is structural rather than guarded - a follower always has a
   * higher number than its target - and `done` covers a hand-edited line that broke the rule anyway.
   */
  function planFollowWrites(follows, sourceBlade, oldText, newText, currentTextByBlade) {
    if (!follows || sameExpr(oldText, newText)) return [];
    const writes = [];
    const done   = new Set([sourceBlade]);
    const queue  = [{ blade: sourceBlade, oldText }];
    while (queue.length) {
      const cur = queue.shift();
      for (const followerStr of Object.keys(follows)) {
        const follower = parseInt(followerStr, 10);
        if (follows[followerStr] !== cur.blade || done.has(follower)) continue;
        const followerText = currentTextByBlade[follower];
        if (followerText === undefined) continue;      // no such slot in this preset
        if (!sameExpr(followerText, cur.oldText)) continue;  // overridden here; leave it alone
        done.add(follower);
        writes.push({ blade: follower, text: newText });
        queue.push({ blade: follower, oldText: followerText });
      }
    }
    return writes.sort((a, b) => a.blade - b.blade);
  }

  /**
   * Old 1-based blade number to new 1-based blade number, for a move of fromIdx to toIdx.
   *
   * Pure and separately testable on purpose: a wrong entry here does not throw and does not look
   * wrong. It silently attaches every name to the wrong blade, which is the same invisible-failure
   * class as the reorder it serves. (B-220)
   */
  function planBladeReorder(count, fromIdx, toIdx) {
    const map = {};
    if (!(count > 0) || fromIdx === toIdx) {
      for (let i = 1; i <= count; i++) map[i] = i;
      return map;
    }
    const order = [];
    for (let i = 0; i < count; i++) order.push(i);
    const moved = order.splice(fromIdx, 1)[0];
    order.splice(toIdx, 0, moved);
    order.forEach((oldIdx, newIdx) => { map[oldIdx + 1] = newIdx + 1; });
    return map;
  }

  /**
   * Numbering, names and follow pairs after blade `bladeNum` STOPS EXISTING.
   *
   * Deletion is not a reorder with a gap. renumberLabels and renumberFollows both fall back to the
   * original number for a blade absent from the map (`map[n] || +n`), which is correct for a move
   * and would silently RESURRECT a deleted blade here - its name reappearing on whatever now holds
   * that number, its follow pair pointing at a blade that is gone. So the filtering happens once, in
   * this function, and callers cannot get it wrong by forgetting.
   *
   * Three shapes of follow pair, one answer each (B-226):
   *   deleted blade is the FOLLOWER  -> pair is dead
   *   deleted blade is the TARGET    -> pair is dead; the follower keeps the text it was given
   *   deleted blade is NEITHER       -> pair survives and renumbers
   * A chain produces both at once: deleting B2 with B4=B3 and B3=B2 kills one pair and renumbers
   * the other, from a single deletion.
   *
   * Returns pairs FILTERED but NOT renumbered - the caller passes them through the same
   * renumberLabels/renumberFollows the reorder uses, so there is one renumbering path, not two.
   */
  function planBladeDelete(count, bladeNum, labels, follows) {
    const map = {};
    for (let n = 1; n <= count; n++) {
      if (n === bladeNum) continue;              // gone, and deliberately absent from the map
      map[n] = n < bladeNum ? n : n - 1;
    }

    const keptLabels = {};
    for (const n of Object.keys(labels || {})) {
      if (+n === bladeNum) continue;             // a name belongs to its blade, so it goes too
      keptLabels[n] = labels[n];
    }

    const keptFollows = {};
    const droppedPairs = [];
    for (const follower of Object.keys(follows || {})) {
      const target = +follows[follower];
      if (+follower === bladeNum || target === bladeNum) {
        droppedPairs.push({ follower: +follower, target });
        continue;
      }
      keptFollows[follower] = target;
    }

    return { map, labels: keptLabels, follows: keptFollows, droppedPairs };
  }

  /** Blade names under a new numbering. The NAME FOLLOWS THE BLADE, never the slot. */
  function renumberLabels(labels, map) {
    const out = {};
    for (const n of Object.keys(labels || {})) out[map[n] || +n] = labels[n];
    return out;
  }

  /**
   * Follow pairs under a new numbering, dropping any the move inverted.
   *
   * A follower may only mirror a LOWER-numbered blade, which is what makes cycles impossible by
   * construction. A reorder can violate that - move a follower above its target and the pair points
   * forward. Such a pair is DROPPED rather than kept, because keeping it would trade a structural
   * guarantee for a class of cycle bugs. Nothing is lost but future propagation: every preset still
   * holds the text it was given.
   */
  function renumberFollows(follows, map) {
    const kept = {};
    let dropped = 0;
    for (const follower of Object.keys(follows || {})) {
      const f = map[follower] || +follower;
      const t = map[follows[follower]] || +follows[follower];
      if (t < f) kept[f] = t; else dropped++;
    }
    return { kept, dropped };
  }

  // ── Preset array detection ─────────────────────────────────────────────────

  /**
   * Finds all preset array declarations in `text`.
   * Matches: `TypeName name[] = {` blocks containing StylePtr. The name capture is
   * permissive — accepts hyphens in addition to word chars, and accepts the empty
   * name (`Preset [] = {`) — so a user-typed invalid-but-meaningful declaration still
   * parses into the visual view. The compiler will surface the actual identifier-
   * validity error when the user tries to compile, and Monaco markers flag it in
   * real time; meanwhile the visual editor doesn't silently lose the bank.
   */
  function findPresetArrayDeclarations(text) {
    const re = /\b(\w+)\s+([\w-]*)\s*\[\s*\]\s*=\s*\{/g;
    const results = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      // ProffieOS only recognizes `Preset NAME[] = { ... }` as a preset bank. Other
      // typenames (including `BladeConfig` and any random user-defined types) are not
      // preset arrays even if their body happens to contain StylePtr / &ref expressions.
      // The previous content-based fallback protected against nothing real and risked
      // surfacing stray bank labels for unrelated arrays.
      if (m[1] !== 'Preset') continue;
      const bodyStart = m.index + m[0].length - 1;
      const group = readBraceGroup(text, bodyStart);
      if (!group) continue;
      results.push({
        name:             m[2],
        typeName:         m[1],
        declarationStart: m.index,
        bodyStart,
        bodyEnd:          group.end,
        bodyContent:      group.content,
      });
    }
    return results;
  }

  /**
   * Splits an array body `{ entry, entry, ... }` into individual `{ ... }` entries,
   * tracking their character offsets within bodyContent.
   */
  function splitPresetEntries(bodyContent) {
    const entries = [];
    let i = 1; // skip opening {
    const end = bodyContent.length - 1;
    while (i < end) {
      i = skipWS(bodyContent, i);
      if (i >= end) break;
      if (bodyContent[i] === '{') {
        const group = readBraceGroup(bodyContent, i);
        if (group) {
          entries.push({ raw: group.content, startOffset: i, endOffset: group.end });
          i = group.end;
          const j = skipWS(bodyContent, i);
          if (bodyContent[j] === ',') i = j + 1;
          continue;
        }
      }
      i++;
    }
    return entries;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Parses `text` (full config file content).
   * Returns:
   *   {
   *     arrays:     PresetArray[],
   *     bladeCount: number | null,
   *     warnings:   string[]
   *   }
   */
  function parsePresets(text) {
    const warnings    = [];
    const bladeCount  = extractBladeCount(text);
    const declarations = findPresetArrayDeclarations(text);

    const arrays = declarations.map(decl => {
      const entries = splitPresetEntries(decl.bodyContent);
      const presets = [];

      entries.forEach((entry, idx) => {
        const absStart = decl.bodyStart + entry.startOffset;
        const absEnd   = decl.bodyStart + entry.endOffset;

        let parsed, parseError = null;
        try {
          parsed = parsePresetEntry(entry.raw);
        } catch (e) {
          parseError = e.message;
          parsed = { font: '', track: '', displayName: '', styles: [] };
        }

        if (!parseError && bladeCount !== null && parsed.styles.length !== bladeCount) {
          warnings.push(
            `Preset ${idx + 1} in "${decl.name}": expected ${bladeCount} blade style(s), found ${parsed.styles.length}`
          );
        }

        // Resolve absolute line/col for each style slot
        // slot offsets are relative to inner (entry.raw without outer braces), which starts at absStart + 1
        const innerBase = absStart + 1;
        const styles = parsed.styles.map(slot => ({
          type:       slot.type,
          expr:       slot.expr,
          colorArg:   slot.colorArg,
          styleClass: slot.styleClass,
          startLine:  lineAt(text, innerBase + slot.startOffset),
          endLine:    lineAt(text, innerBase + slot.endOffset),
          startCol:   colAt(text, innerBase + slot.startOffset),
          endCol:     colAt(text, innerBase + slot.endOffset),
        }));

        presets.push({
          index:            idx + 1,
          font:             parsed.font,
          track:            parsed.track,
          displayName:      parsed.displayName,
          fontRange:        makeStrRange(text, innerBase, parsed._fontStr),
          trackRange:       makeStrRange(text, innerBase, parsed._trackStr),
          displayNameRange: makeStrRange(text, innerBase, parsed._displayNameStr),
          styles,
          startLine:   lineAt(text, absStart),
          endLine:     lineAt(text, absEnd),
          raw:         entry.raw,
          parseError,
        });
      });

      const labelData = extractLabels(decl.bodyContent);
      const followData = extractFollows(decl.bodyContent);
      return {
        name:          decl.name,
        startLine:     lineAt(text, decl.declarationStart),
        endLine:       lineAt(text, decl.bodyStart + decl.bodyContent.length),
        bodyStartLine: lineAt(text, decl.bodyStart),
        presets,
        labels:        labelData.labels,
        labelLine:     labelData.labelBodyOffset !== null
                         ? lineAt(text, decl.bodyStart + labelData.labelBodyOffset)
                         : null,
        follows:       followData.follows,
        followLine:    followData.followBodyOffset !== null
                         ? lineAt(text, decl.bodyStart + followData.followBodyOffset)
                         : null,
      };
    });

    return { arrays, bladeCount, warnings };
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parsePresets, planFollowWrites, sameExpr, extractStyleSlots, planBladeReorder, planBladeDelete, renumberLabels, renumberFollows };
  } else {
    root.presetParser = { parsePresets, planFollowWrites, sameExpr, extractStyleSlots, planBladeReorder, planBladeDelete, renumberLabels, renumberFollows };
  }

}(typeof globalThis !== 'undefined' ? globalThis : this));
