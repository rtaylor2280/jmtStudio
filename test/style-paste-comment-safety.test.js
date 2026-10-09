/**
 * Two clipboard-parsing faults, both found in normal use  [B-458] [B-459]
 *
 * [B-459] `_extractStylePtrInner` counted `<` and `>` with no comment awareness, so a
 * single unbalanced angle inside a comment moved the depth, the slice ended at the
 * wrong `>`, and the extracted expression came out genuinely short a bracket. The
 * paste then failed with "Unmatched < … closing '>' missing for 'Layers'?" on a style
 * that compiles. `_findBracketError` was innocent — it strips comments correctly and
 * was reporting a real imbalance in text that had already been cut wrong upstream.
 *
 * ⭐ The corpus is why this is a bug and not a curiosity: 43,993 style pastes across
 * 196 files produced 30 failures, ALL 30 comment-caused and none malformed. Against
 * vendor style files — the things people paste FROM — 24 of 103 (23%), of which
 * Greyscale Free alone is 18, because the catalogue shares one file template.
 * ⭐ And the common trigger is COMMENTED-OUT CODE (`//LockupTrL<Layers<`), not prose,
 * which is why `//` matters as much as block comments.
 *
 * [B-458] `_parseClipboardStyle` tested bare `source:` / `url:` labels while
 * `_buildStyleBlock` writes them with a `//` prefix, so Paste & Parse could not read a
 * block this app had written: source, url and tags all fell into notes. There was no
 * `tags:` branch at all, and because the writer closes its banner on the first line the
 * metadata body ran all the way to the FOOTER's closing marker, dragging the `using`
 * statement in with it.
 *
 * ⚠️ Both fixes must leave the FOREIGN formats alone — Fett263 pastes use bare labels,
 * naked URLs, `copyright …` and `OS8.10 …` lines, and those paths were never broken.
 *
 * Run: node test/style-paste-comment-safety.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Lift the real functions and run them, rather than asserting on their source —
// the faults were both behavioural, so behaviour is what to test.
const lift = (name) => {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let i = html.indexOf('{', start), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return html.slice(start, end);
};

// `_flattenExpr` is a one-line const arrow, not a function declaration.
const liftConst = (name) => {
  const m = html.match(new RegExp(`^const ${name} = .*$`, 'm'));
  if (!m) throw new Error(`${name} not found`);
  return m[0];
};

let _extractStylePtrInner, _parseClipboardStyle, _findBracketError, _buildStyleBlock,
    _styleCodeStart;
{
  const src = ['_lineCommentsToBlock', '_styleCodeStart', '_extractStylePtrInner',
               '_findUsingExprEnd', '_parseClipboardStyle', '_splitTemplatePrefix',
               '_findBracketError', '_buildStyleBlock']
    .map(lift).join('\n') + '\n' + liftConst('_flattenExpr') + '\n' +
    '\nreturn { _extractStylePtrInner, _parseClipboardStyle, _findBracketError,'
    + ' _buildStyleBlock, _styleCodeStart };';
  ({ _extractStylePtrInner, _parseClipboardStyle, _findBracketError, _buildStyleBlock,
     _styleCodeStart } = new Function(src)());
  ok('functions lifted and compiled', typeof _extractStylePtrInner === 'function');
}

// ───────────────────────────────────────────────────────────────────────────
// [B-459] angle brackets inside comments
// ───────────────────────────────────────────────────────────────────────────

// The extractor's job is to hand back a BALANCED expression. Assert that property
// directly, counting outside comments, rather than eyeballing a string.
function balanced(expr) {
  if (expr === null) return false;
  const bare = expr.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  let d = 0;
  for (const c of bare) { if (c === '<') d++; else if (c === '>') { d--; if (d < 0) return false; } }
  return d === 0;
}

{
  // ⚠️ CONTROL FIRST. If the plain case does not come out balanced, nothing below
  // means anything — the harness would be measuring its own breakage.
  ok('CONTROL: a comment-free style extracts balanced',
     balanced(_extractStylePtrInner('StylePtr<Layers<Red,Blue>>()')));
  ok('CONTROL: a genuinely unterminated style still returns null',
     _extractStylePtrInner('StylePtr<Layers<Red,Blue') === null);

  // ⭐ THE MINIMAL REPRO. One stray `>` in prose was enough.
  ok('⭐ a block comment with a stray ">" does not truncate',
     balanced(_extractStylePtrInner('StylePtr<Layers</* a -> b */Red,Blue>>()')),
     'the `tip->emitter` shape that first surfaced this');
  ok('a block comment with a stray "<" does not truncate',
     balanced(_extractStylePtrInner('StylePtr<Layers</* a < b */Red,Blue>>()')));

  // ⭐⭐ THE SHAPE THAT ACTUALLY DOMINATES THE CORPUS: commented-out code.
  ok('⭐⭐ a // line of commented-out code does not truncate',
     balanced(_extractStylePtrInner('StylePtr<Layers<\n//LockupTrL<Layers<\nRed,Blue>>()')),
     '`//LockupTrL<Layers<` is two `<` and no `>` — 18 Greyscale files carry this shape');
  ok('a // comment at end of line does not truncate',
     balanced(_extractStylePtrInner('StylePtr<Layers<Red, // was AlphaL<White,Int<0>>\nBlue>>()')));
  ok('a block comment holding whole commented-out layers does not truncate',
     balanced(_extractStylePtrInner(
       'StylePtr<Layers</* AlphaL<White,Bump<Scale<BladeAngle<>,Int<4000>>> */Red,Blue>>()')));

  // The real-world comment from the Courkrus style: `twistangle<>` plus `tip->emitter`.
  const MELT = 'StylePtr<Layers<'
    + '/* Melt - BC custom melt effects, uses twistangle<>. Remap Fire to travel tip->emitter */'
    + 'Red,Blue>>()';
  ok('his actual Melt header comment does not truncate', balanced(_extractStylePtrInner(MELT)));

  // ⚠️ The content must still be RIGHT, not merely balanced — a scanner that returned
  // the empty string would pass the balance check on its own. The inner of
  // `StylePtr<Layers<…>>` is `Layers<…>`: one `>` closes Layers, one closes StylePtr.
  ok('the extracted expression is the whole inner expression',
     _extractStylePtrInner('StylePtr<Layers</* x -> y */Red,Blue>>()')
       === 'Layers</* x -> y */Red,Blue>',
     JSON.stringify(_extractStylePtrInner('StylePtr<Layers</* x -> y */Red,Blue>>()')));

  // Defensive half, unmeasured in the corpus: a commented-out StylePtr must not be
  // mistaken for the real one.
  ok('a commented-out StylePtr is skipped in favour of the live one',
     _extractStylePtrInner('//StylePtr<Layers<Old>>()\nStylePtr<Layers<New>>()') === 'Layers<New>',
     JSON.stringify(_extractStylePtrInner('//StylePtr<Layers<Old>>()\nStylePtr<Layers<New>>()')));

  // ⭐ End to end: the paste path must now report a clean style as clean.
  const verdict = (text) => {
    const parsed = _parseClipboardStyle(text);
    if (!parsed.expr) return 'noexpr';
    const err = _findBracketError(`using _check_ = ${parsed.expr};`);
    return err ? (err.unreadable ? 'unreadable' : err.message) : 'ok';
  };
  ok('⭐ end to end: the minimal repro now passes the bracket check',
     verdict('StylePtr<Layers</* a -> b */Red,Blue>>()') === 'ok',
     verdict('StylePtr<Layers</* a -> b */Red,Blue>>()'));
  ok('end to end: the commented-out-code shape passes too',
     verdict('StylePtr<Layers<\n//LockupTrL<Layers<\nRed,Blue>>()') === 'ok');
  // ⚠️ AND A GENUINELY BROKEN STYLE MUST STILL BE CAUGHT. A fix that silences the
  // checker would pass every test above and be worse than the bug.
  ok('⚠️ a genuinely unbalanced style is STILL reported',
     verdict('StylePtr<Layers<Red,Blue>>()'.replace('Blue>>', 'Blue>')) !== 'ok');
}

// ───────────────────────────────────────────────────────────────────────────
// [B-458] our own exported block must round-trip
// ───────────────────────────────────────────────────────────────────────────
{
  // Built by the real writer, so the test cannot drift from the format we emit.
  const block = _buildStyleBlock(
    'ArrowStyle', 'Layers<Red,Blue>', 'Teirfon Orbital',
    ['OS8.10', 'accent'], 'https://example.com', 'first note line\nsecond note line');

  ok('CONTROL: the writer still emits `// source:`', /^\/\/ source: /m.test(block), block);

  const p = _parseClipboardStyle(block);
  ok('⭐ round trip: name',   p.name === 'ArrowStyle', p.name);
  ok('⭐ round trip: source', p.source === 'Teirfon Orbital', JSON.stringify(p.source));
  ok('⭐ round trip: url',    p.url === 'https://example.com', JSON.stringify(p.url));
  ok('⭐ round trip: tags',   p.tags === 'OS8.10, accent', JSON.stringify(p.tags));
  ok('⭐ round trip: expr',   p.expr === 'Layers<Red,Blue>', JSON.stringify(p.expr));

  // ⚠️ The notes field is where everything used to end up, so assert what is ABSENT
  // as well as what is present — that is the half the original bug failed.
  ok('round trip: notes keep their text', /first note line/.test(p.notes), JSON.stringify(p.notes));
  ok('⭐ notes do NOT contain the source line',  !/source:/i.test(p.notes), JSON.stringify(p.notes));
  ok('⭐ notes do NOT contain the url line',     !/url:/i.test(p.notes),    JSON.stringify(p.notes));
  ok('⭐ notes do NOT contain the tags line',    !/tags:/i.test(p.notes),   JSON.stringify(p.notes));
  ok('⭐ notes do NOT keep the `notes:` label',  !/notes:/i.test(p.notes),  JSON.stringify(p.notes));
  ok('⭐⭐ notes do NOT swallow the `using` line', !/using\s/.test(p.notes), JSON.stringify(p.notes));
  ok('⭐⭐ notes do NOT swallow the footer',       !/Add to preset/.test(p.notes), JSON.stringify(p.notes));
}

// ── the foreign formats must be untouched ──────────────────────────────────
{
  const FETT = '/*--------------------- FettStyle ---------------------\n'
    + 'copyright Fett263\n'
    + 'https://fett263.com\n'
    + 'OS8.10 v1 Style\n'
    + 'a plain description line\n'
    + '-----------------------------------------------------*/\n'
    + 'using FettStyle = Layers<Red,Blue>;';
  const p = _parseClipboardStyle(FETT);
  ok('foreign: name still parsed',      p.name === 'FettStyle', p.name);
  ok('foreign: copyright → source',     p.source === 'Fett263', JSON.stringify(p.source));
  ok('foreign: naked URL → url',        p.url === 'https://fett263.com', JSON.stringify(p.url));
  ok('foreign: OS line → osVersion',    p.osVersion === 'OS8.10 v1', JSON.stringify(p.osVersion));
  ok('foreign: description → notes',    /a plain description line/.test(p.notes), JSON.stringify(p.notes));
  ok('foreign: expr still parsed',      p.expr === 'Layers<Red,Blue>', JSON.stringify(p.expr));

  // The `using NAME* = …` footnote-marker case called out beside the extractor.
  const STAR = 'using FettStyle* = Layers<Red,Blue>;';
  ok('foreign: a footnote-marker name still parses',
     _parseClipboardStyle(STAR).expr === 'Layers<Red,Blue>',
     JSON.stringify(_parseClipboardStyle(STAR).expr));
}

// ───────────────────────────────────────────────────────────────────────────
// [B-458] an INLINE comment is part of the code, not a metadata header
//
// Reported 2026-10-03 after the truncation fix landed: pasting a style straight out
// of a config put `StripesX<…>,` and `AlphaL<…>,` into the Notes field. The metadata
// scanner took the FIRST block comment anywhere in the text, and in a config slot
// that is `/* Base blade */` sitting INSIDE the expression — so the harvest began
// mid-code and ran to the next comment's close.
// ⚠️ The paste itself was already correct by then. A fix can be right and still leave
// a wrong-looking result on screen, which is why the eyes are the test that counts.
// ───────────────────────────────────────────────────────────────────────────
{
  const SLOT = 'StylePtr<Layers<\n'
    + '  /* Base blade */\n'
    + '  StripesX<Int<300>,Int<-4500>,Black,Red>,\n'
    + '  AlphaL<StaticFire<Black,DarkOrange,0,3,0,3000,70>,Int<16000>>,\n'
    + '  /* Swing color */\n'
    + '  Blue>>()';
  const p = _parseClipboardStyle(SLOT);

  ok('⭐⭐ an inline comment does not become metadata: notes stay empty',
     p.notes === '', JSON.stringify(p.notes));
  ok('⭐ and no style CODE leaks into notes',
     !/StripesX|AlphaL/.test(p.notes), JSON.stringify(p.notes));
  ok('no comment wrappers leak into notes',
     !/\/\*|\*\//.test(p.notes), JSON.stringify(p.notes));
  ok('the expression still parses whole',
     p.expr.startsWith('Layers<') && /Blue>$/.test(p.expr), JSON.stringify(p.expr.slice(-40)));
  ok('and it still passes the bracket check',
     _findBracketError(`using _check_ = ${p.expr};`) === null);

  // ⚠️ THE REGRESSION RISK: the config slot's "Add to Library" button relies on a
  // LEADING comment to supply the style name. A header before the code must still work.
  const HEADED = '/*--- MyAccent ---*/\n' + SLOT;
  const h = _parseClipboardStyle(HEADED);
  ok('⚠️ a LEADING header still supplies the name', h.name === 'MyAccent', h.name);
  ok('and a leading header with no body adds no notes', h.notes === '', JSON.stringify(h.notes));

  // _styleCodeStart is the whole rule, so assert it directly too.
  ok('code start ignores a comment that precedes it',
     _styleCodeStart('/* hdr */\nusing X = Red;') > 0);
  ok('code start finds a bare StylePtr at 0', _styleCodeStart('StylePtr<Red>()') === 0);
  ok('code start returns -1 when there is no code',
     _styleCodeStart('/* just a comment */') === -1);
  ok('⚠️ a commented-out `using` does not count as the code start',
     _styleCodeStart('// using Old = Red;\nusing New = Blue;')
       === '// using Old = Red;\n'.length,
     String(_styleCodeStart('// using Old = Red;\nusing New = Blue;')));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall style paste comment-safety tests passed');
process.exit(failures ? 1 : 0);
