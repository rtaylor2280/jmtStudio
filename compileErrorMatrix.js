// What a failed compile means, in plain words. Pure text in, pure text out.
//
// Each signature is one compiler message: `match` finds it on a line, the rest says what it
// means and what to do. `resolve` picks the one signature to show for a whole log:
//   1. Noise never wins while a real error matched.
//   2. A signature whose cascadeOf also matched is dropped: it is fallout from that one.
//   3. The earliest error wins, then one in the config over one in an OS file. A fault only
//      ever produces errors at or after itself, so the first error is closest to the cause.
//   4. Specificity decides only between signatures on the same line.
// With no match it returns null and the caller shows the compiler's own words.
//
// `stopsAfter` marks a message where the compiler stopped AFTER the mistake, so the reported
// line is where it noticed, not where the fault is.

'use strict';

const bundled = require('./compileErrorData');

// Compiler lines can run to thousands of characters of template arguments. Every signature
// reads the start of a line, and clipping bounds what a pattern can be made to do.
const MAX_LINE = 2000;

function _danglingPresetArray(ctx, g) {
  const src = ctx.configText || ctx.log || '';
  const sym = g.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp('CONFIGARRAY\\s*\\(\\s*' + sym + '\\s*\\)').test(src)) return false;
  return !new RegExp('Preset\\s+' + sym + '\\s*\\[').test(src);
}

// A name the config or Style Library defines inside an #ifdef nothing turns on. Sets g.guard
// and g.where, which says where that #ifdef is.
function _switchedOff(ctx, g) {
  const sources = [[String(ctx.configText || ''), true], [String(ctx.stylesText || ''), false]];
  const defined = new Set(sources.flatMap(([src]) =>
    [...src.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)/gm)].map(m => m[1])));
  for (const [src, inConfig] of sources) {
    const stack = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^\s*#\s*ifdef\s+(\w+)/))) { stack.push({ guard: m[1], line: i + 1 }); continue; }
      if (/^\s*#\s*(if|ifndef)\b/.test(line)) { stack.push(null); continue; }
      if (/^\s*#\s*(else|elif)\b/.test(line)) { if (stack.length) stack[stack.length - 1] = null; continue; }
      if (/^\s*#\s*endif\b/.test(line)) { stack.pop(); continue; }
      if (!new RegExp('\\busing\\s+' + g.symbol + '\\s*=').test(line)) continue;
      const top = stack[stack.length - 1];
      if (!top || defined.has(top.guard)) continue;
      g.guard = top.guard;
      g.where = inConfig ? ` on line ${top.line}` : ' in your Style Library';
      return true;
    }
  }
  return false;
}

// True when a prop in the selected version is two edits from the name. Sets g.near.
function _nearProp(ctx, g) {
  const wanted = g.header.split('/').pop();
  let best = null, bestD = 3;
  for (const f of ctx.propFiles || []) {
    const d = editDistance(wanted.toLowerCase(), f.toLowerCase());
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best) return false;
  g.near = best;
  return true;
}

// Fills in what the compiler's next line says: which element, and the names of its settings.
function _argCount(ctx, g) {
  const m = String(ctx.log || '').match(/provided for ['`]template<(.+)>\s+(?:class|struct)\s+(\w+)['`]/);
  const n = Number(g.want);
  g.element = m ? m[2] : 'A style element';
  g.takes = `${g.least || ''}${n} setting${n === 1 ? '' : 's'}`;
  if (!m) { g.settings = 'Check the setting count against the same element in a working style.'; return true; }
  const names = [];
  let depth = 0, part = '';
  for (const c of `${m[1]},`) {
    if (c === '<') depth++;
    if (c === '>') depth--;
    if (c === ',' && depth === 0) { names.push(part.trim().split('=')[0].trim().split(/\s+/).pop()); part = ''; continue; }
    part += c;
  }
  g.settings = `Its settings are ${names.join(', ')}.`;
  return true;
}

// Fills in what the compiler says around a type/value mismatch: the element, what it wanted and
// what it got.
function _wrongKind(ctx, g) {
  const log = String(ctx.log || '');
  const named = log.match(/template parameter list for ['`]template<.*>\s+(?:using|class|struct)\s+(\w+)/);
  const kind = log.match(/note:\s+expected (a type|a constant of type ['`]?\w+['`]?), got ['`]?([^'`\n]+)/);
  g.element = named ? named[1] : 'this style';
  g.wants = !kind ? 'a different kind of value' : (kind[1] === 'a type' ? 'a color or style' : 'a number');
  g.gets = kind ? `, and this gives it ${kind[2].trim()}` : '';
  return true;
}

// Names the empty define from the source line the compiler echoes. Sets g.name and g.where.
function _emptyDefine(ctx, g) {
  const m = String(ctx.log || '').match(/#\s*if\s+(\w+)\s*==/);
  if (!m) return false;
  g.name = m[1];
  const i = String(ctx.configText || '').split('\n')
    .findIndex(l => new RegExp(`^\\s*#\\s*define\\s+${m[1]}\\s*(//.*)?$`).test(l));
  g.where = i < 0 ? '' : ` on line ${i + 1}`;
  return true;
}

// Finds the #define in the config that holds a quoted number. Sets g.name, g.value and g.where.
function _quotedNumber(ctx, g) {
  const lines = String(ctx.configText || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*#\s*define\s+(\w+)\s+("[\d.]+")/);
    if (!m) continue;
    g.name = m[1];
    g.value = m[2];
    g.where = ` on line ${i + 1}`;
    return true;
  }
  return false;
}

// The last part of a full path. Sets g.file.
function _fileName(ctx, g) {
  g.file = g.path.split(/[\\/]/).pop();
  return true;
}

// A define the config leaves empty that the compiler's output shows being used as a value. On/off
// flags are empty on purpose and are read with #ifdef, so they never appear in such a line.
function _emptyDefineUsed(ctx, g) {
  const lines = String(ctx.configText || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*#\s*define\s+([A-Z][A-Z0-9_]*)\s*(\/\/.*)?$/);
    if (!m) continue;
    if (!new RegExp(`^\\s*\\d+ \\|.*\\b${m[1]}\\b|expansion of macro ['\`]${m[1]}['\`]`, 'm').test(String(ctx.log || ''))) continue;
    g.name = m[1];
    g.where = ` on line ${i + 1}`;
    return true;
  }
  return false;
}

// Which file holds the setup() that is not ProffieOS's own. The compiler names both, the second
// as the error and the first as a note, and which is which depends on the include order.
function _otherSetup(ctx, g) {
  const found = [...String(ctx.log || '').matchAll(
    /(?:^|[\\/\s])([\w.-]+\.(?:h|ino)):(\d+):\d+:\s+(?:error: redefinition of|note:) ['`]void setup\(\)['`]/gm)];
  const other = found.find(m => !/^ProffieOS\.ino$/i.test(m[1]));
  g.place = !other || /^my_config\.h$/i.test(other[1]) ? 'your config' : `${other[1]} line ${other[2]}`;
  return true;
}

// The board this compile targeted, from the FQBN arduino-cli prints. Sets g.selected.
function _selectedBoard(ctx, g) {
  const m = String(ctx.log || '').match(/FQBN:\s*\S*?:Proffieboard(V\d)?-/);
  g.selected = m ? `Proffieboard${m[1] ? ` ${m[1]}` : ''}` : 'a different board';
  return true;
}

// A name sitting bare where a preset's font or track goes.
function _unquotedName(ctx, g) {
  const src = String(ctx.configText || '').split(/\bBladeConfig\b/)[0];
  return new RegExp(`\\{\\s*${g.symbol}\\s*,|\\{\\s*"[^"]*"\\s*,\\s*${g.symbol}\\s*,`).test(src);
}

// Logic a signature can name. Data travels without code, so an entry naming a function this
// release does not have is skipped.
const PRECONDITIONS = {
  unquotedName: _unquotedName,
  switchedOff: _switchedOff,
  danglingPresetArray: _danglingPresetArray,
  nearProp: _nearProp,
  otherSetup: _otherSetup,
  selectedBoard: _selectedBoard,
  fileName: _fileName,
  argCount: _argCount,
  emptyDefineUsed: _emptyDefineUsed,
  emptyDefine: _emptyDefine,
  quotedNumber: _quotedNumber,
  wrongKind: _wrongKind,
};

function _isAtLeast(have, want) {
  const a = String(have).split('.').map(Number), b = String(want).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

function _hydrate(list, appVersion) {
  const out = [];
  for (const e of list) {
    if (e.precondition && !PRECONDITIONS[e.precondition]) continue;
    if (e.minAppVersion && appVersion && !_isAtLeast(appVersion, e.minAppVersion)) continue;
    out.push({ ...e, match: new RegExp(e.match, e.flags || ''),
               precondition: e.precondition ? PRECONDITIONS[e.precondition] : undefined });
  }
  return out;
}

const SIGNATURES = _hydrate(bundled.signatures);

// Swaps in a newer set of messages, already validated by dataRail.
function setSignatures(list, appVersion) {
  const next = _hydrate(list, appVersion);
  SIGNATURES.length = 0;
  SIGNATURES.push(...next);
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

function suggestionIsPlausible(symbol, suggestion) {
  if (!symbol || !suggestion) return false;
  const d = editDistance(symbol.toLowerCase(), suggestion.toLowerCase());
  const budget = Math.max(2, Math.floor(Math.max(symbol.length, suggestion.length) * 0.25));
  return d <= budget;
}

// The staged config. Every other file in a build belongs to the OS.
const _IN_CONFIG = /(?:^|[\\/])(?:my_config|my_styles)\.h$/i;
const _DIAG = /^(?<pfile>.+?):(?<line>\d+):(?:\d+:)?\s*(?:fatal\s+)?(?:error|warning):/;

function _render(str, groups) {
  if (!str) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (groups && groups[k] != null ? groups[k] : `{${k}}`));
}

function resolve(log, configText, stylesText, propFiles) {
  const ctx = { log, configText: configText || log, stylesText, propFiles };
  const lines = String(log).split(/\r?\n/);

  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].length > MAX_LINE ? lines[i].slice(0, MAX_LINE) : lines[i];
    const diag = line.match(_DIAG);
    const inConfig = diag ? _IN_CONFIG.test(diag.groups.pfile) : true;
    for (const e of SIGNATURES) {
      const m = line.match(e.match);
      if (!m) continue;
      const groups = m.groups || {};
      if (e.precondition && !e.precondition(ctx, groups)) continue;
      candidates.push({ e, groups, idx: i, inConfig, line: diag ? Number(diag.groups.line) : null });
    }
  }
  if (!candidates.length) return null;

  const matched = new Set(candidates.map(c => c.e.id));
  let survivors = candidates.filter(c => !(c.e.cascadeOf && c.e.cascadeOf.some(id => matched.has(id))));
  if (survivors.some(c => c.e.severity === 'error')) {
    survivors = survivors.filter(c => c.e.severity !== 'noise');
  }
  if (!survivors.length) survivors = candidates;

  survivors.sort((a, b) =>
    a.idx - b.idx
    || (a.inConfig === b.inConfig ? 0 : a.inConfig ? -1 : 1)
    || (b.e.specificity || 0) - (a.e.specificity || 0)
    || (a.e.rank || 99) - (b.e.rank || 99));

  const win = survivors[0], e = win.e;
  let title = e.title, fix = e.fix;
  if (e.guard === 'suggestionIsPlausible'
      && !suggestionIsPlausible(win.groups.symbol, win.groups.suggestion)) {
    title = e.titleIfImplausible || 'That name is not defined';
    fix = e.fixIfImplausible || e.fix;
  }
  return {
    id: e.id,
    severity: e.severity,
    title: _render(title, win.groups),
    meaning: _render(e.meaning, win.groups),
    fix: _render(fix, win.groups),
    line: win.inConfig ? win.line : null,
    stopsAfter: !!e.stopsAfter,
  };
}

module.exports = { SIGNATURES, setSignatures, PRECONDITIONS, resolve, suggestionIsPlausible };
