/**
 * Compile errors name the user's file, not the staging copy  [B-373]
 *
 * `stageConfig` writes the editor's content to a FIXED path inside the selected OS
 * version's tree — `.../ProffieOS/config/my_config.h` — and arduino-cli compiles that
 * copy. gcc reports against the file it was handed, so a failure while working on
 * LGT1Button32.h read
 *
 *     my_config.h:37 — cannot convert 'const char*' to 'StyleFactory*' in initialization
 *     my_config.h:43 — ...
 *
 * and nothing on screen connected the two. The compile log's opening line does say
 * "Config staged to: ...\my_config.h", which is correct and is not where anyone looks
 * while reading an error.
 *
 * ⭐ THE LINE NUMBERS ARE RIGHT, and that is what makes this a fix rather than an
 * explanation. The staged copy is byte-identical to the buffer, so line 37 IS line 37
 * of what the user is looking at. Only the filename token is wrong — a substitution
 * with nothing to map and no way to point somewhere wrong.
 *
 * ⚠️ OURS ONLY. The toolchain's streamed output in Build Output is never rewritten:
 * that is what gets pasted into a forum thread and must match what the toolchain said.
 *
 * Run: node test/error-config-filename.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src  = fs.readFileSync(path.join(ROOT, 'renderer', 'buildPanel.js'), 'utf8');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Lift the real function and give it a stub DOM, so the substitution is exercised
// rather than pattern-matched.
const lift = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
};

const make = (filenameValue) => {
  const document = {
    getElementById: (id) => id === 'input-filename' ? { value: filenameValue } : null,
  };
  const body = `const _STAGED_CONFIG_BASENAME = 'my_config.h';\n${lift('_withUserConfigName')}\nreturn _withUserConfigName;`;
  return new Function('document', body)(document);
};

const ERR = "my_config.h:37 — cannot convert 'const char*' to 'StyleFactory*' in initialization";

// ── the reported case ──────────────────────────────────────────────────────
{
  const f = make('LGT1Button32');
  const out = f(ERR);
  ok('the user\'s filename replaces the staging one',
     out.startsWith('LGT1Button32.h:37'), out);
  ok('the line number is untouched', /:37 /.test(out), out);
  ok('the message body is untouched',
     /cannot convert 'const char\*' to 'StyleFactory\*' in initialization$/.test(out), out);
}

// ── several errors at once ─────────────────────────────────────────────────
{
  const f = make('Baylan');
  const many = ['my_config.h:37 — a', 'my_config.h:43 — b', 'my_config.h:49 — c'].join('\n');
  const out = f(many);
  ok('every occurrence is replaced', !/my_config\.h/.test(out), out);
  ok('and all three lines survive', out.split('\n').length === 3, out);
  ok('one substitution point covers every signature at once',
     out.split('Baylan.h').length - 1 === 3, out);
}

// ── the edges ──────────────────────────────────────────────────────────────
{
  // ⚠️ A config with no name yet: the staging basename IS what the user would
  // recognise, because `my_config` is also the default in the filename field. Nothing
  // to substitute, and inventing a name would be worse than leaving it.
  ok('an empty filename field leaves the text alone', make('')(ERR) === ERR);
  ok('a whitespace-only filename leaves the text alone', make('   ')(ERR) === ERR);
  ok('a config actually called my_config is a no-op', make('my_config')(ERR) === ERR);
  ok('...including when typed with the extension', make('my_config.h')(ERR) === ERR);

  // The field may or may not carry the extension; both must produce one `.h`.
  ok('a name without .h gets exactly one', make('Ahsoka')(ERR).startsWith('Ahsoka.h:37'),
     make('Ahsoka')(ERR));
  ok('a name WITH .h does not get two', make('Ahsoka.h')(ERR).startsWith('Ahsoka.h:37'),
     make('Ahsoka.h')(ERR));

  ok('empty input is returned unchanged', make('X')('') === '');
  ok('null input does not throw', make('X')(null) === null);
  // Nothing to do when the toolchain never mentioned the staged file.
  const unrelated = 'collect2: error: ld returned 1 exit status';
  ok('an error naming no config file is untouched', make('X')(unrelated) === unrelated);
}

// ── where it is applied ────────────────────────────────────────────────────
{
  ok('the dialog status goes through it',
     /_setStatusTiered\(document\.getElementById\('bm-status'\), _withUserConfigName\(/.test(src));
  ok('our appended summary line goes through it',
     /appendLog\(`\\n⚠ \$\{_withUserConfigName\(error\)\}`/.test(src));

  // ⚠️ THE ONE THING THAT MUST NOT BE REWRITTEN. onLog streams the toolchain's own
  // lines; if that ever gets wrapped, a forum paste stops matching what gcc said.
  const streamed = src.slice(0, src.indexOf('function _withUserConfigName'));
  ok('the raw toolchain stream is not rewritten',
     !/appendLog\(_withUserConfigName/.test(streamed)
     && !/onLog[^\n]*_withUserConfigName/.test(src),
     'Build Output must match what the toolchain actually printed');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall error filename tests passed');
process.exit(failures ? 1 : 0);
