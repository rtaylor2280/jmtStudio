/**
 * The OS tree's name index, and the two features that read it  [B-584]
 *
 * One walk of a version's ProffieOS folder gives every name and the files it appears in. The
 * editor's #define autocomplete offers from it, and "Defines nothing reads" answers from it, so
 * the list can never offer a name the check then flags. These cases pin that shared answer:
 *   · whole words, case-sensitive (FETT263_SWING is NOT read because FETT263_SWING_ON is)
 *   · config/ never counts (it holds our staged copy of the user's own config)
 *   · props/ counts only for the prop the config includes, plus prop_base.h
 *   · the stamp lets the renderer keep its copy; invalidateVersionHash drops the index
 *
 * Run: node test/version-name-index.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-name-index-'));
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'electron') return { app: { getPath: () => userData, isPackaged: false } };
  return origLoad.call(this, req, ...a);
};
const proffie = require(path.join(ROOT, 'proffieos.js'));
const preflight = require(path.join(ROOT, 'renderer', 'preflight.js'));
const checks = require(path.join(ROOT, 'renderer', 'preflight-checks.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const V = 'Fake 8.10';
const SRC = path.join(userData, 'proffieOS_versions', V, 'ProffieOS');
function put(rel, text) {
  const p = path.join(SRC, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
put('ProffieOS.ino', '#ifdef CONFIG_PRESETS\n#endif\n#if NUM_BLADES > 0\n#endif\n#ifdef ENABLE_MOTION\n#endif\n');
put('common/sound.h', 'int v = VOLUME;\n');
put('common/charge_state.h', '// JMT Charge Detect Support\n/* BLOCK_WORD\n   MORE_BLOCK */ int a = READ_AFTER_BLOCK;\n'
  + 'const char* s = "STRING_WORD \\" ESCAPED_WORD"; char q = \'"\'; int b = READ_AFTER_STRING; // TAIL_WORD\n'
  + '#ifdef REAL_OPTION // COMMENT_ON_IF\n#endif\n');
put('props/prop_base.h', '#ifdef MOTION_TIMEOUT\n#endif\n');
put('props/saber_fett263_buttons.h', '#ifdef FETT263_SWING_ON\n#endif\n#ifdef FETT263_SWING_ON_SPEED\n#endif\n');
put('props/saber_sa22c_buttons.h', '#ifdef SA22C_NO_LOCKUP_HOLD\n#endif\n');
put('config/my_config.h', '#define STAGED_ONLY\n');
put('props/big.bin', 'BINARY_ONLY');

const CONFIG = (defines) => `
#ifdef CONFIG_TOP
${defines.map(d => `#define ${d}`).join('\n')}
#endif
#ifdef CONFIG_PROP
#include "../props/saber_fett263_buttons.h"
#endif
#ifdef CONFIG_PRESETS
Preset presets[] = {
  { "font;common", "tracks/a.wav", StylePtr<Black>(), "One" },
};
BladeConfig blades[] = { { 0, WS281XBladePtr<1, bladePin>(), CONFIGARRAY(presets) }, };
#endif
`;

function makeCtx(text, withIndex) {
  return preflight.buildContext({
    text,
    versionName: V,
    readVersionFile: async (v, rel) => proffie.readVersionFile(v, rel),
    searchVersionFiles: async (v, q) => proffie.searchVersionFiles(v, q),
    versionNameIndex: withIndex ? async (v) => proffie.getVersionNameIndex(v) : undefined,
  });
}
const flagged = (res) => (((res.findings.find(f => f.checkId === 'define-nothing-reads') || {}).rows) || [])
  .map(r => r.label).sort();

(async () => {
  // ── The index itself ──
  const idx = proffie.getVersionNameIndex(V);
  ok('builds', idx.ok && Array.isArray(idx.files) && idx.names);
  ok('a plain-name read is indexed (VOLUME)', !!idx.names.VOLUME && idx.names.VOLUME.c === 0);
  ok('a preprocessor test marks the name as a condition', idx.names.FETT263_SWING_ON.c === 1);
  ok('only text files are read', !idx.names.BINARY_ONLY);
  ok('whole words only', !idx.names.FETT263_SWING);
  ok('case-sensitive', !idx.names.volume);
  ok('words in comments are not names (the bare JMT)',
    !idx.names.JMT && !idx.names.BLOCK_WORD && !idx.names.MORE_BLOCK && !idx.names.TAIL_WORD && !idx.names.COMMENT_ON_IF);
  ok('words in strings are not names', !idx.names.STRING_WORD && !idx.names.ESCAPED_WORD);
  ok('code after a comment or a string still counts',
    !!idx.names.READ_AFTER_BLOCK && !!idx.names.READ_AFTER_STRING && idx.names.REAL_OPTION.c === 1);
  const again = proffie.getVersionNameIndex(V, idx.stamp);
  ok('same stamp answers unchanged, without the index', again.ok && again.unchanged && !again.names);
  proffie.invalidateVersionHash(V);
  const rebuilt = proffie.getVersionNameIndex(V, idx.stamp);
  ok('invalidateVersionHash drops it, next call rebuilds with a new stamp',
    rebuilt.ok && !rebuilt.unchanged && rebuilt.stamp !== idx.stamp);
  ok('an unknown version is not an index', proffie.getVersionNameIndex('Nope').ok === false);

  // ── The check reads it ──
  const text = CONFIG(['VOLUME 1500', 'MOTION_TIMEOUT 1', 'FETT263_SWING_ON', 'FETT263_SWING',
                       'SA22C_NO_LOCKUP_HOLD', 'STAGED_ONLY']);
  const viaIndex = flagged(await preflight.run(makeCtx(text, true)));
  ok('index: a substring of a real name is flagged', viaIndex.includes('FETT263_SWING'), viaIndex.join(' '));
  ok('index: another prop\'s define is flagged', viaIndex.includes('SA22C_NO_LOCKUP_HOLD'));
  ok('index: config/ does not count', viaIndex.includes('STAGED_ONLY'));
  ok('index: core, prop_base and the selected prop count',
    !viaIndex.includes('VOLUME') && !viaIndex.includes('MOTION_TIMEOUT') && !viaIndex.includes('FETT263_SWING_ON'));
  const viaSearch = flagged(await preflight.run(makeCtx(text, false)));
  ok('without an index the search still answers', viaSearch.includes('SA22C_NO_LOCKUP_HOLD'), viaSearch.join(' '));

  // ── Autocomplete's list is the same answer ──
  const names = await checks.treeNames(makeCtx(text, true));
  const has = (n) => names.some(x => x.name === n);
  ok('treeNames offers core, prop_base and the selected prop', has('VOLUME') && has('MOTION_TIMEOUT') && has('FETT263_SWING_ON_SPEED'));
  ok('treeNames leaves out other props and config/', !has('SA22C_NO_LOCKUP_HOLD') && !has('STAGED_ONLY'));
  const swing = names.find(x => x.name === 'FETT263_SWING_ON');
  ok('treeNames carries the file and the condition mark',
    swing && swing.cond === true && swing.files[0] === 'ProffieOS/props/saber_fett263_buttons.h');
  ok('treeNames without an index is "cannot tell"',
    (await checks.treeNames(makeCtx(text, false))) === null);

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
