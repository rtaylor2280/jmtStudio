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

const SIGNATURES = [
  {
    id: "style-switched-off",
    severity: "error",
    match: /['`](?<symbol>[A-Za-z_]\w*)['`] was not declared in this scope/,
    specificity: 22,
    primary: true,
    precondition: _switchedOff,
    title: "{symbol} is switched off",
    meaning: "{symbol} sits inside #ifdef {guard}{where}, and this config never defines {guard}, so the compiler skips it.",
    fix: "Add #define {guard} to CONFIG_TOP, or use a different style.",
  },
  {
    id: "dangling-preset-array",
    severity: "error",
    match: /['`](?<symbol>[A-Za-z_]\w*)['`] was not declared in this scope/,
    specificity: 21,
    primary: true,
    precondition: _danglingPresetArray,
    title: "A blade points at a preset list that does not exist",
    meaning: "One of your BladeConfig rows ends with CONFIGARRAY({symbol}), but there is no \"Preset {symbol}[]\" defined in this config. The compiler cannot find the preset list that blade is supposed to use, so it reports {symbol} as undefined - and its \"did you mean\" guess is an unrelated name from inside ProffieOS.",
    fix: "Define \"Preset {symbol}[] = { ... };\" above your BladeConfig, or change the CONFIGARRAY(...) to the name of a preset array you already have (usually \"presets\").",
  },
  {
    id: "sram2-not-declared",
    severity: "noise",
    match: /memory region [`'"]?SRAM2['"`]? not declared/i,
    title: "Harmless warning, not an error",
    meaning: "This comes from the Proffieboard platform's own linker script and appears on every single build. It has nothing to do with your config.",
    fix: "Nothing to do. Ignore it.",
  },
  {
    id: "ltrans-serial",
    severity: "noise",
    match: /using serial compilation of (?<jobs>\d+) LTRANS jobs/i,
    title: "Harmless warning about how the compiler is optimizing",
    meaning: "The optimizer split your program into {jobs} chunks and is processing them one at a time. It is not an error, and it is not why your build is slow.",
    fix: "Nothing to do. Ignore it.",
  },
  {
    id: "not-declared-in-scope",
    severity: "error",
    match: /['`](?<symbol>[A-Za-z_]\w*)['`] was not declared in this scope/,
    rank: 1,
    primary: true,
    title: "{symbol} is not in this ProffieOS version",
    meaning: "It is either misspelled, or a style or setting from a different ProffieOS version.",
    fix: "Check the spelling, then check which ProffieOS version this style or config was written for.",
  },
  {
    id: "expected-primary-expression",
    severity: "error",
    match: /expected primary-expression before/,
    rank: 2,
    cascadeOf: ["not-declared-in-scope"],
    stopsAfter: true,
    title: "A style expression is malformed",
    meaning: "Usually a missing or extra angle bracket, a stray comma, or a template argument in the wrong place inside a style. The line the compiler names is where it gave up, which is often NOT where the mistake is.",
    fix: "Check the style above the reported line for balanced < > and ( ), and make sure each preset row has a comma after the track name and after each style.",
  },
  {
    id: "expected-brace-before",
    severity: "error",
    match: /expected ['`]\}['`] before/,
    stopsAfter: true,
    title: "Something is unbalanced earlier in your config",
    meaning: "A brace, bracket or comma is missing somewhere ABOVE this line. The compiler only noticed here.",
    fix: "Check the preset rows above for a missing comma after a track name, or a missing }.",
  },
  {
    id: "config-file-not-set",
    severity: "error",
    match: /#error Please set CONFIG_FILE/,
    rank: 3,
    title: "ProffieOS cannot find your config file",
    meaning: "The #define CONFIG_FILE line in ProffieOS.ino is missing, commented out, or has curly quotes instead of straight ones.",
    fix: "Remove the // from the #define CONFIG_FILE line, and make sure the quotes are straight.",
  },
  {
    id: "prop-file-near-match",
    severity: "error",
    match: /fatal error: (?<header>[\w\/.]*props\/\w+\.h): No such file or directory/,
    specificity: 13,
    primary: true,
    precondition: _nearProp,
    title: "Probably a typo in the prop name",
    meaning: "The config includes {header}, and this version's props folder does not have that file. It does have {near}.",
    fix: "If that's the one you meant, change the include to {near}. If not, choose Import prop in the Prop dropdown, switch to a version that has it, or link a different prop.",
  },
  {
    id: "prop-file-missing",
    severity: "error",
    match: /fatal error: (?<header>[\w\/.]*props\/\w+\.h): No such file or directory/,
    specificity: 12,
    primary: true,
    title: "This prop is not in the selected ProffieOS version",
    meaning: "The config includes {header}, and this version's props folder does not have that file.",
    fix: "Choose Import prop in the Prop dropdown to add it to this version, switch to a version that has it, or link a different prop.",
  },
  {
    id: "missing-core-header",
    severity: "error",
    match: /fatal error: (?<header>[\w\/.]+\.h): No such file or directory/,
    title: "{header} could not be found",
    meaning: "The config includes a file that is not in this ProffieOS version. It is usually a misspelled name, or a file from a different version.",
    fix: "Check the spelling on that include.",
  },
  {
    id: "redefinition-of-setup",
    severity: "error",
    match: /redefinition of ['`]void setup\(\)['`]/,
    precondition: _otherSetup,
    title: "setup() is defined twice",
    meaning: "ProffieOS already has a setup(), so nothing else can define one.",
    fix: "Remove the setup() from {place}.",
  },
  {
    id: "include-nested-too-deeply",
    severity: "error",
    match: /#include nested (?:too deeply|depth \d+ exceeds maximum)/,
    title: "Your config includes itself",
    meaning: "A #include line points back at the same file, so the compiler loops until it gives up. You will see the same filename repeated many times in the output.",
    fix: "Remove the #include line that names your own config file.",
  },
  {
    id: "smart-quotes",
    severity: "error",
    match: /extended character (?<ch>.) is not valid in an identifier/,
    title: "Curly quotes from a word processor",
    meaning: "Your config contains typographic quotes ( \" \" ‘ ’ ) instead of straight ones. Word and WordPad insert these automatically. They look almost identical but the compiler rejects them.",
    fix: "Replace curly quotes with straight \" and '. Edit configs in a code editor, not a word processor.",
  },
  {
    id: "missing-required-define",
    severity: "error",
    match: /(?<file>(?:props|common|styles|sound|blades|buttons|functions|transitions|display|modes)[\\/]\w+\.h|ProffieOS\.ino)[^\n]*['`](?<symbol>[A-Z][A-Z0-9_]+)['`] was not declared in this scope/,
    specificity: 10,
    title: "{symbol} is missing from your config",
    meaning: "The compiler needs {symbol}, and your config does not define it.",
    fix: "Add #define {symbol} to the CONFIG_TOP section, with its value.",
  },
  {
    id: "wrong-board-selected",
    severity: "error",
    match: /#error Please select (?<board>Proffieboard[^\n]*?) in Tools->Board/,
    primary: true,
    precondition: _selectedBoard,
    title: "This config is for {board}, and {selected} is selected",
    meaning: "The board include in your config and the Board dropdown disagree.",
    fix: "Select {board}, or change the board include to {selected}.",
  },
  {
    id: "preset-outside-section",
    severity: "error",
    match: /['`](?<symbol>Preset|BladeConfig)['`] does not name a type/,
    primary: true,
    title: "{symbol} is outside the CONFIG_PRESETS section",
    meaning: "Presets and blade configs have to sit between #ifdef CONFIG_PRESETS and its #endif.",
    fix: "Check that #ifdef CONFIG_PRESETS is above your presets and its #endif is below your BladeConfig.",
  },
  {
    id: "style-where-track-goes",
    severity: "error",
    match: /cannot convert ['`]StyleFactory\*['`] to ['`]const char\*['`] in initialization/,
    title: "A preset has a style where its track should be",
    meaning: "A preset is font, track, then styles. This one has only one string before its first style, usually because the comma between the font and the track is missing, so the two ran together.",
    fix: "Check the font and track at the start of this preset. Each needs its own quotes, with a comma between them.",
  },
  {
    id: "style-count-mismatch",
    severity: "error",
    match: /cannot convert ['`]const char\*['`] to ['`]StyleFactory\*['`] in initialization/,
    title: "A preset has fewer styles than you have blades",
    meaning: "NUM_BLADES says how many styles each preset needs. One of your presets has too few, so the compiler reached the preset NAME where it expected another style.",
    fix: "Give every preset exactly NUM_BLADES styles, or correct NUM_BLADES.",
  },
  {
    id: "unknown-identifier-with-suggestion",
    severity: "error",
    match: /['`](?<symbol>\w+)['`] was not declared in this scope; did you mean ['`](?<suggestion>\w+)['`]\?/,
    specificity: 10,
    primary: true,
    guard: "suggestionIsPlausible",
    title: "Probably a typo",
    meaning: "There is no \"{symbol}\". The compiler thinks you meant \"{suggestion}\".",
    fix: "If that's the name you meant, change {symbol} to {suggestion}. If not, check where {symbol} is defined.",
    fixIfImplausible: "There is no \"{symbol}\" here. Ignore the compiler's \"{suggestion}\" guess - that is an unrelated name from inside ProffieOS. Check your spelling of {symbol}, or whether it needs a different ProffieOS version.",
  },
  {
    id: "unterminated-ifdef",
    severity: "error",
    match: /unterminated #ifdef/,
    title: "A section of your config is never closed",
    meaning: "An #ifdef block (CONFIG_TOP, CONFIG_PRESETS, ...) is missing its #endif.",
    fix: "Add the missing #endif at the end of that section.",
  },
  {
    id: "template-arg-parse-error",
    severity: "error",
    match: /parse error in template argument list/,
    primary: true,
    title: "A style is missing a closing angle bracket",
    meaning: "The < > brackets in one of your styles do not balance - usually one > short.",
    fix: "Check the angle brackets in the style on the reported line.",
  },
  {
    id: "styleptr-unresolved",
    severity: "error",
    match: /cannot resolve overloaded function ['`]StylePtr['`]/,
    cascadeOf: ["template-arg-parse-error"],
    title: "A style expression is incomplete",
    meaning: "StylePtr<...> is missing its trailing () or its brackets do not balance, so the compiler cannot work out what style you meant.",
    fix: "Check that the style ends with >() and that < > and ( ) balance.",
  },
  {
    id: "endif-without-if",
    severity: "error",
    match: /#endif without #if/,
    primary: true,
    title: "An #endif has no matching #ifdef",
    meaning: "The #endif on this line has nothing to close. Either the section header above it is missing or misspelled, or there is one #endif too many.",
    fix: "Check that every #ifdef CONFIG_... has exactly one matching #endif.",
  },
  {
    id: "board-header-missing",
    severity: "error",
    match: /['`](?:SaberPins|batteryLevelPin|bladePowerPin\d?|powerButtonPin)['`] was not declared in this scope/,
    specificity: 10,
    title: "The board config was never included",
    meaning: "The compiler does not know which board you are on. Either the #include for the board config is missing, or your CONFIG_TOP section is misspelled so nothing in it ran.",
    fix: "Check the #include \"proffieboard_vN_config.h\" line and the spelling of #ifdef CONFIG_TOP.",
  },
  {
    id: "two-or-more-data-types",
    severity: "error",
    match: /two or more data types in declaration/,
    specificity: 12,
    primary: true,
    title: "A comma is missing between two style arguments",
    meaning: "Two style arguments ran together with no comma between them, so the compiler read them as a single broken declaration.",
    fix: "Find the two style names sitting next to each other on that line and put a comma between them.",
  },
  {
    id: "template-argument-invalid",
    severity: "error",
    match: /template argument \d+ is invalid/,
    specificity: 8,
    title: "A blade style has unbalanced brackets",
    meaning: "Something inside this style did not parse, usually an extra or missing ( or < somewhere earlier in the same style. The position shown is where the compiler gave up, not where the mistake is.",
    fix: "Check the bracket balance across the whole style, starting from the beginning of the line.",
  },
  {
    id: "blade-pixel-count-not-a-number",
    severity: "error",
    match: /no matching function for call to ['`]\w*BladePtr<"(?<value>[^"]*)"/,
    specificity: 15,
    primary: true,
    title: "The pixel count is in quotes",
    meaning: "The number of pixels must be a plain number, not text. \"{value}\" is written with quotes around it, so the compiler treated it as a string.",
    fix: "Remove the quotes around {value}.",
  },
  {
    id: "prop-include-outside-section",
    severity: "error",
    match: /sound[\\/]\w+\.h[^\n]*['`](?:BufferedWavPlayer|AudioStreamWork|RefPtr)['`] has not been declared/,
    specificity: 12,
    primary: true,
    title: "Your prop include is in the wrong section",
    meaning: "The prop file is included before ProffieOS has set up audio. That happens when the #include for the prop sits outside the CONFIG_PROP section.",
    fix: "Move the prop #include so it is between #ifdef CONFIG_PROP and its #endif.",
  },
  {
    id: "prop-button-count-unsupported",
    severity: "error",
    match: /#error (?<file>[^\n]*\.h) requires (?<allowed>[\d, ]+(?:or \d+)?) Buttons? for operation/,
    specificity: 20,
    primary: true,
    title: "This prop does not support your button count",
    meaning: "The prop file you chose supports {allowed} buttons. Your NUM_BUTTONS is set to something outside that range.",
    fix: "Set NUM_BUTTONS to one of {allowed}, or choose a prop that supports your button count.",
  },
  {
    id: "absolute-path-include",
    severity: "error",
    match: /fatal error: (?<path>[A-Za-z]:[\\/][^\n:]*): No such file or directory/,
    specificity: 20,
    primary: true,
    title: "An #include points at a full path that is not on this computer",
    meaning: "The include uses an absolute path ({path}) instead of a plain file name. Paths like that only work on the machine they were written on.",
    precondition: _fileName,
    fix: "Replace it with just the file name in quotes: #include \"{file}\".",
  },
  {
    id: "stray-brace-at-top-level",
    severity: "error",
    match: /expected unqualified-id before ['`]\{['`] token/,
    specificity: 12,
    title: "A { is sitting outside any list",
    meaning: "The compiler found a { where it expected a new declaration. Usually an extra } just above it closed a list early, or there is an extra { here.",
    fix: "Check the braces on this line and the lines just above it.",
  },
  {
    id: "audio-classes-missing-os7",
    severity: "error",
    match: /common[\\/]sd_card\.h[^\n]*['`]AudioStreamWork['`] has not been declared/,
    specificity: 15,
    primary: true,
    title: "ENABLE_AUDIO is missing or misspelled",
    meaning: "ProffieOS is building without audio support, so the SD card code cannot find the audio classes it needs. On ProffieOS 7 the ENABLE_AUDIO define is required.",
    fix: "Add #define ENABLE_AUDIO to the CONFIG_TOP section, and check it is spelled exactly that way.",
  },
  {
    id: "presets-section-missing",
    severity: "error",
    match: /['`](?<symbol>blades|presets)['`] was not declared in this scope(?:; did you mean ['`]\w+['`]\?)?/,
    specificity: 20,
    primary: true,
    title: "Your presets section was skipped",
    meaning: "The compiler cannot see \"{symbol}\", so #ifdef CONFIG_PRESETS is probably misspelled or missing.",
    fix: "Check the spelling of #ifdef CONFIG_PRESETS and that the section ends with #endif.",
  },
  {
    id: "style-element-wrong-os-version",
    severity: "error",
    match: /['`](?:class )?(?<element>\w+)<[^\n]*(?:['`] has no member named ['`](?:getColor|run|getColor2)['`]|>::getColor\()/,
    specificity: 15,
    primary: true,
    title: "{element} does not work in that position",
    meaning: "{element} exists in this ProffieOS version, but not where this style uses it, like a transition where a color goes.",
    fix: "Correct the style, or regenerate it in the style editor it came from.",
  },
  {
    id: "too-many-initializers-preset",
    severity: "error",
    match: /too many initializers for ['`]Preset['`]/,
    title: "A preset has too many entries",
    meaning: "A preset row has more fields than ProffieOS expects: usually more styles than you have blades, or an extra item after the preset name.",
    fix: "Each preset needs a font, a track, exactly NUM_BLADES styles, then the preset name.",
  },
  {
    id: "maxleds-static-assert",
    severity: "error",
    match: /static assertion failed:\s*update maxLedsPerStrip/i,
    title: "maxLedsPerStrip is smaller than one of your blades",
    meaning: "A blade is defined with more pixels than maxLedsPerStrip allows. ProffieOS catches this one deliberately.",
    fix: "Raise maxLedsPerStrip to at least the length of your longest blade.",
  },
  {
    id: "wrong-template-arg-count",
    severity: "error",
    match: /wrong number of template arguments \((?<got>\d+), should be (?<least>at least )?(?<want>\d+)\)/,
    precondition: _argCount,
    title: "{element} has the wrong number of settings",
    meaning: "{element} takes {takes}, and this style gives it {got}.",
    fix: "{settings}",
  },
  {
    id: "string-where-number-expected",
    severity: "error",
    match: /['`](?<value>"[^"]*")['`] is not a valid template argument for type ['`]int['`]/,
    title: "A number is in quotes",
    meaning: "A style setting expects a plain number, and this one is {value}.",
    fix: "Remove the quotes from {value}.",
  },
  {
    id: "empty-styleptr",
    severity: "error",
    match: /no matching function for call to ['`]StylePtr<>\(\)['`]/,
    title: "A style is empty",
    meaning: "StylePtr<> has nothing inside it.",
    fix: "Add a style between the angle brackets.",
  },
  {
    id: "duplicate-button",
    severity: "error",
    match: /redefinition of ['`]Button (?<name>\w+)['`]/,
    title: "Two buttons have the same name",
    meaning: "Button \"{name}\" is declared twice. Each button needs its own variable name.",
    fix: "Rename one of them (for example PowerButton and AuxButton).",
  },
  {
    id: "define-empty-used",
    severity: "error",
    match: /expected primary-expression/,
    specificity: 5,
    primary: true,
    precondition: _emptyDefineUsed,
    title: "{name} has no value",
    meaning: "Your config has #define {name}{where} with nothing after it, and ProffieOS needs a number there.",
    fix: "Add the number after {name}.",
  },
  {
    id: "define-empty-named",
    match: /operator ['`]==['`] has no left operand/,
    specificity: 5,
    primary: true,
    precondition: _emptyDefine,
    title: "{name} has no value",
    meaning: "Your config has #define {name}{where} with nothing after it, and ProffieOS needs a number there.",
    fix: "Add the number after {name}.",
  },
  {
    id: "define-with-no-value",
    severity: "error",
    match: /operator ['`]==['`] has no left operand/,
    title: "A #define has no value",
    meaning: "A #define was written with nothing after it, and ProffieOS needs a number there.",
    fix: "Add the number after the #define.",
  },
  {
    id: "bladeconfig-too-few-blades",
    severity: "error",
    match: /cannot convert ['`]Preset\*['`] to ['`]BladeBase\*['`]/,
    title: "A BladeConfig row has fewer blades than NUM_BLADES",
    meaning: "Each BladeConfig row needs one blade definition per blade, followed by CONFIGARRAY. Yours has too few, so CONFIGARRAY was read where a blade was expected.",
    fix: "Add the missing blade definition, or lower NUM_BLADES.",
  },
  {
    id: "bladeconfig-too-many-blades",
    severity: "error",
    match: /cannot convert ['`]BladeBase\*['`] to ['`]Preset\*['`]/,
    title: "A BladeConfig row has more blades than NUM_BLADES",
    meaning: "There are more blade definitions in that row than NUM_BLADES allows, so a blade ended up where CONFIGARRAY should be.",
    fix: "Remove the extra blade definition, or raise NUM_BLADES.",
  },
  {
    id: "expected-comma-or-semicolon",
    severity: "error",
    match: /expected ['`],['`] or ['`];['`] before/,
    stopsAfter: true,
    title: "A comma, semicolon or brace is missing just before here",
    meaning: "Something needs separating. This is what a missing comma after a track name, a missing semicolon after the presets array, or an unclosed brace all look like.",
    fix: "Check the end of the previous line for a missing , or ; and check your braces balance.",
  },
  {
    id: "malformed-include",
    severity: "error",
    match: /#include expects "FILENAME" or <FILENAME>/,
    title: "An #include line is malformed",
    meaning: "The filename after #include is not properly quoted - usually a missing quote, or curly quotes from a word processor instead of straight ones.",
    fix: "Write it as #include \"filename.h\" with straight double quotes.",
  },
  {
    id: "define-quoted-number-named",
    severity: "error",
    match: /invalid operands of types ['`][^'`]+['`] and ['`]const char ?\[\d+\]['`]/,
    specificity: 5,
    primary: true,
    precondition: _quotedNumber,
    title: "{name} has quotes around a number",
    meaning: "Your config has #define {name} {value}{where}, and ProffieOS needs a plain number there.",
    fix: "Remove the quotes.",
  },
  {
    id: "define-string-vs-number",
    severity: "error",
    match: /invalid operands of types ['`][^'`]+['`] and ['`]const char ?\[\d+\]['`]/,
    title: "A number has quotes around it",
    meaning: "A #define was given text in quotes, and ProffieOS needs a plain number there.",
    fix: "Remove the quotes.",
  },
  {
    id: "template-type-value-mismatch",
    severity: "error",
    match: /type\/value mismatch at argument (?<argn>\d+) in template parameter list/,
    precondition: _wrongKind,
    title: "Setting {argn} of {element} is the wrong kind of value",
    meaning: "{element} expects {wants} there{gets}.",
    fix: "Change setting {argn} of {element} to {wants}.",
  },
];

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

module.exports = { SIGNATURES, resolve, suggestionIsPlausible };
