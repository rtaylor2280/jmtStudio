"use strict";

// ── ProffieOS Config Parser ───────────────────────────────────────────────────
// Extracts presets, blade definitions, and using-aliases from a ProffieOS
// config file so the blade simulator can auto-populate from the active config.
//
// Returns:
//   { aliases: {Name: styleString}, blades: [{ledCount, start?, end?}], presets: [{name, styles[]}] }
// or null if no CONFIG_PRESETS block found.

// ── Internal helpers ──────────────────────────────────────────────────────────

function _stripComments(text) {
  // Block comments first, then line comments
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, '');
}

function _extractBlock(text, blockName) {
  const re = new RegExp(`#ifdef\\s+${blockName}[^\\n]*\\n`);
  const m  = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Walk forward counting #if/#ifdef/#ifndef / #endif nesting to find
  // the #endif that closes *this* block, not a nested one.
  let depth = 1, i = start;
  const openRe  = /#\s*(?:ifdef|ifndef|if)\b/g;
  const closeRe = /#\s*endif\b/g;
  while (i < text.length && depth > 0) {
    openRe.lastIndex  = i;
    closeRe.lastIndex = i;
    const openM  = openRe.exec(text);
    const closeM = closeRe.exec(text);
    if (!closeM) break;                         // no more #endifs — take the rest
    if (openM && openM.index < closeM.index) {
      depth++;
      i = openM.index + openM[0].length;
    } else {
      depth--;
      if (depth === 0) return text.slice(start, closeM.index);
      i = closeM.index + closeM[0].length;
    }
  }
  return text.slice(start);
}

// Split comma-separated fields, respecting <>, (), {}, and quoted strings.
function _splitFields(s) {
  const result = [];
  let start = 0, depth = 0, inStr = false, strChar = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === strChar && s[i - 1] !== '\\') inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true; strChar = c;
    } else if ('<({'.includes(c)) depth++;
    else if ('>)}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      result.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) result.push(last);
  return result;
}

// Find content between the outer { } of the first array matching declPattern.
function _extractArrayBody(text, declPattern) {
  const idx = text.search(declPattern);
  if (idx === -1) return null;
  const brace = text.indexOf('{', idx);
  if (brace === -1) return null;
  let depth = 0, end = -1;
  for (let i = brace; i < text.length; i++) {
    if      (text[i] === '{') depth++;
    else if (text[i] === '}') { if (--depth === 0) { end = i; break; } }
  }
  return end !== -1 ? text.slice(brace + 1, end) : null;
}

// Split an array body string into top-level { ... } entries.
function _extractEntries(body) {
  const entries = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length || body[i] !== '{') { i++; continue; }
    let depth = 0, start = i;
    for (; i < body.length; i++) {
      if      (body[i] === '{') depth++;
      else if (body[i] === '}') { if (--depth === 0) { i++; break; } }
    }
    entries.push(body.slice(start + 1, i - 1).trim());
  }
  return entries;
}

// ── Aliases ───────────────────────────────────────────────────────────────────

function _extractAliases(text) {
  const aliases = {};
  const re = /using\s+(\w+)\s*=/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const rest = text.slice(m.index + m[0].length);
    const semi = rest.indexOf(';');
    if (semi !== -1) aliases[name] = rest.slice(0, semi).trim();
  }
  return aliases;
}

// ── Blade config ──────────────────────────────────────────────────────────────

function _extractBlades(text) {
  const blades = [];
  const body = _extractArrayBody(text, /BladeConfig\s+blades\s*\[/);
  if (!body) return [{ ledCount: 144 }];

  // Each top-level entry in BladeConfig is one physical connector (one neopixel string).
  // It may contain sub-blade slices or a single full blade.
  const entries = _extractEntries(body);
  for (const entry of entries) {
    // Sub-blades: SubBladePtr<start, end, ...>
    const subRe = /SubBladePtr\s*<\s*(\d+)\s*,\s*(\d+)/g;
    let sub, hasSub = false;
    while ((sub = subRe.exec(entry)) !== null) {
      hasSub = true;
      const start = parseInt(sub[1]);
      const end   = parseInt(sub[2]);
      blades.push({ ledCount: end - start + 1, start, end });
    }
    if (!hasSub) {
      // Single blade — any *BladePtr<N, ...>
      const ws = entry.match(/\w+BladePtr\s*<\s*(\d+)/);
      if (ws) blades.push({ ledCount: parseInt(ws[1]) });
    }
  }

  return blades.length ? blades : [{ ledCount: 144 }];
}

// ── Presets ───────────────────────────────────────────────────────────────────

function _isStyle(field, aliases) {
  if (!field) return false;
  if (field.startsWith('"') || field.startsWith("'")) return false;
  // Inline template style
  if (field.includes('<')) return true;
  // Known using-alias
  if (aliases && Object.prototype.hasOwnProperty.call(aliases, field)) return true;
  return false;
}

function _extractPresets(text, aliases) {
  const presets = [];
  const body = _extractArrayBody(text, /Preset\s+presets\s*\[/);
  console.log('[configParser] _extractPresets: body found?', body !== null, body ? `(${body.length} chars)` : '');
  if (!body) {
    // Help diagnose: check if the pattern even exists
    const hasPresetDecl = /Preset\s+presets\s*\[/.test(text);
    console.warn('[configParser] No Preset presets[] body. Pattern match in block?', hasPresetDecl);
    console.log('[configParser] CONFIG_PRESETS block (first 600 chars):', text.slice(0, 600));
    return presets;
  }

  const entries = _extractEntries(body);
  console.log('[configParser] _extractPresets: entries found:', entries.length);

  for (const entry of entries) {
    const fields = _splitFields(entry);
    if (fields.length < 2) continue;

    // Last quoted string = display name; first = font dir (ignored here)
    const strings = fields.filter(f => f.startsWith('"'));
    const name    = strings.length
      ? strings[strings.length - 1].replace(/^"|"$/g, '').trim()
      : `Preset ${presets.length + 1}`;

    const styles  = fields.filter(f => _isStyle(f, aliases));
    console.log(`[configParser] preset "${name}": ${fields.length} fields, ${styles.length} styles`);
    presets.push({ name, styles });
  }

  return presets;
}

// ── Public API ────────────────────────────────────────────────────────────────

function parseConfig(configText) {
  if (!configText || !configText.trim()) return null;
  const clean = _stripComments(configText);
  const block  = _extractBlock(clean, 'CONFIG_PRESETS');
  console.log('[configParser] CONFIG_PRESETS block:', block ? `found (${block.length} chars), Preset presets[] present: ${/Preset\s+presets\s*\[/.test(block)}` : 'NOT FOUND');
  if (!block) return null;

  // Aliases may be defined anywhere in the file (including outside CONFIG_PRESETS)
  const aliases = _extractAliases(clean);
  const blades  = _extractBlades(block);
  const presets = _extractPresets(block, aliases);

  return { aliases, blades, presets };
}

// Recursively substitute using-aliases in a style string (up to 10 passes for
// aliases that reference other aliases).
function resolveAliases(styleText, aliases) {
  if (!aliases || !styleText) return styleText;
  let s = styleText;
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const [name, value] of Object.entries(aliases)) {
      const re   = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g');
      const next = s.replace(re, value);
      if (next !== s) { s = next; changed = true; }
    }
    if (!changed) break;
  }
  return s;
}

window.ConfigParser = { parse: parseConfig, resolveAliases };
