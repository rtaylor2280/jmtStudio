// A renamed style: what still names it follows the rename. [B-651]
//
//   1. The old name is kept on the style as a `// formerly:` line, read back into meta.formerNames,
//      and a notes block after it does not swallow it.
//   2. Renaming back to a former name un-lists it; repeats are listed once.
//   3. The preset rewrite changes only whole-word uses inside a preset's style slots.
//   4. Wiring: both rename paths, the config-open check after the font check, the setting's label.
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const slice = (startMarker, endMarker) => {
  const a = html.indexOf(startMarker);
  if (a < 0) throw new Error('not found: ' + startMarker);
  const b = html.indexOf(endMarker, a);
  if (b < 0) throw new Error('end not found: ' + endMarker);
  return html.slice(a, b);
};

// The meta parser, the meta-line writer and the formerly helper, run together.
const ctx = {};
vm.runInNewContext([
  slice('function _parseStyleMeta(', '// One-shot flag, mirroring'),
  slice('const _STYLE_META_KEYS = ', '// Writes a bulk change as one undo step'),
  slice('function _styleSetFormerNames(', '\n}\n') + '\n}\n',
  'this.parse = _parseStyleMeta; this.setFormer = _styleSetFormerNames;',
].join('\n'), ctx);

const lib = (gap) => [
  '/*--------------------------------- Ocean ---------------------------------*/',
  gap,
  'using Ocean = Layers<Blue>;',
  '/*--------------------------------- Other ---------------------------------*/',
  'using Other = Layers<Red>;',
  '',
].join('\n');
const gapOf = (text, name) => {
  const at = text.indexOf(`using ${name} =`);
  const before = text.slice(0, at);
  return before.slice(before.lastIndexOf('*/') + 2);
};

console.log('1. the formerly line');
{
  const t = ctx.setFormer(lib('// creator: Ryan\n// notes: first line\n// second line'), 'Ocean', ['Sea']);
  const gap = gapOf(t, 'Ocean');
  check('written into the style\'s own gap', /\/\/ formerly: Sea/.test(gap), JSON.stringify(gap));
  check('written before the notes, so the notes keep their lines', gap.indexOf('formerly') < gap.indexOf('notes:'), JSON.stringify(gap));
  const meta = ctx.parse('', gap);
  check('read back as meta.formerNames', JSON.stringify(meta.formerNames) === '["Sea"]', JSON.stringify(meta.formerNames));
  check('the notes are unchanged', meta.userNotes === 'first line\nsecond line', JSON.stringify(meta.userNotes));
  check('the other style is untouched', !/formerly/.test(gapOf(t, 'Other')));
  // A formerly line written AFTER a notes block (hand-edited) is still a formerly line.
  const late = ctx.parse('', '\n// notes: hi\n// formerly: A, B\n');
  check('a formerly line after notes is still read as one', JSON.stringify(late.formerNames) === '["A","B"]' && late.userNotes === 'hi',
    JSON.stringify(late));
}

console.log('2. the list');
{
  let t = ctx.setFormer(lib(''), 'Ocean', ['Sea', 'Sea', 'Lake']);
  check('a repeat is listed once', /\/\/ formerly: Sea, Lake/.test(t), JSON.stringify(gapOf(t, 'Ocean')));
  t = ctx.setFormer(t, 'Ocean', ['Ocean', 'Sea']);
  check('the current name is never listed', /\/\/ formerly: Sea\n/.test(t) && !/formerly:[^\n]*Ocean/.test(t), JSON.stringify(gapOf(t, 'Ocean')));
  t = ctx.setFormer(t, 'Ocean', []);
  check('an empty list removes the line', !/formerly/.test(t), JSON.stringify(gapOf(t, 'Ocean')));
  const same = ctx.setFormer(lib(''), 'Missing', ['X']);
  check('a name not in the library leaves the text alone', same === lib(''));
}

console.log('3. the preset rewrite');
{
  const pp = require(path.join(ROOT, 'renderer', 'presetParser.js'));
  const ctx2 = { presetParser: pp };
  vm.runInNewContext(slice('const _styleRenameEdits = ', 'async function _styleConfigFollowRename(') + '; this.f = _styleRenameEdits;', ctx2);
  const cfg = [
    'Preset presets[] = {',
    '  { "Nomad;common", "tracks/a.wav",',
    '    StylePtr<Ocean>(),',
    '    "ocean"},',
    '  { "Terra;common", "tracks/b.wav",',
    '    StylePtr<OceanDeep>(),',
    '    "deep"},',
    '  { "Ocean;common", "",',
    '    StylePtr<Layers<Ocean, Ocean>>(),',
    '    "two"},',
    '};',
    'BladeConfig blades[] = { { 0, WS281XBladePtr<144, bladePin, Color8::GRB, PowerPINS<bladePowerPin2> >(), CONFIGARRAY(presets) } };',
  ].join('\n');
  const r = ctx2.f(cfg, new Map([['Ocean', 'Sea']]));
  const texts = r.edits.map((e) => e.text);
  check('two presets use it', r.presets === 2, JSON.stringify(r));
  check('a plain use is renamed', texts.includes('StylePtr<Sea>()'), JSON.stringify(texts));
  check('every use in a slot is renamed', texts.includes('StylePtr<Layers<Sea, Sea>>()'), JSON.stringify(texts));
  check('a longer name that starts with it is not', !texts.some((t) => /SeaDeep/.test(t)), JSON.stringify(texts));
  check('the font folder of the same name is not touched (only style slots are edited)',
    r.edits.every((e) => !/"/.test(e.text)), JSON.stringify(texts));
  const lines = cfg.split('\n');
  const e0 = r.edits[0];
  check('the range covers the slot exactly', lines[e0.range.startLineNumber - 1].slice(e0.range.startColumn - 1, e0.range.endColumn - 1) === 'StylePtr<Ocean>()',
    JSON.stringify(e0.range));
  check('nothing to rename, nothing edited', ctx2.f(cfg, new Map([['Nope', 'X']])).edits.length === 0);
}

console.log('4. wiring');
{
  const detail = slice('const newUsingCode = `using ${newName} =', '_detailName         = newName;');
  check('the detail rename keeps the old name', /_styleSetFormerNames\(current, newName, \[\.\.\.\(\(_detailEntry\?\.meta\?\.formerNames\) \|\| \[\]\), oldName\]\)/.test(detail));
  check('the detail rename follows, only on a real rename', /if \(newName !== oldName\) window\._styleAfterRename\?\.\(oldName, newName\);/.test(detail));
  const helper = slice("document.getElementById('btn-helper-save').addEventListener('click'", '// Now taking its colours');
  check('the helper editor knows the name it renamed from', /const _renamedFrom = _helperEditorOrigName && _helperEditorOrigName !== targetName/.test(helper));
  check('both helper save branches carry the old names', (helper.match(/_styleSetFormerNames\(newContent, targetName/g) || []).length === 2);
  check('both helper save branches follow the rename', (helper.match(/if \(_renamedFrom\) window\._styleAfterRename\?\.\(_renamedFrom, targetName\)/g) || []).length === 2);
  const after = slice('window._styleAfterRename = async', '\n};\n');
  check('fonts are re-pointed before the config is asked', after.indexOf('_styleRelinkFonts') < after.indexOf('_styleConfigFollowRename'));
  const relink = slice('async function _styleRelinkFonts(', '\n}\n');
  check('the relink matches the old name exactly and writes the new one',
    /linkedStyleLibraryEntry\) \|\| ''\) === from/.test(relink) && /updates: \{ linkedStyleLibraryEntry: to \}/.test(relink));
  const follow = slice('async function _styleConfigFollowRename(', '\n}\n');
  check('the config follow uses the font rename\'s remembered choice', /_jmtRememberedChoice\('fontRenameAlwaysUpdate'\)/.test(follow));
  const open = slice('// Then a style it names that a library style had before a rename', '\n}\n');
  check('at config open, the style check runs after the font check',
    /await window\._sfCheckConfigFormerNames\?\.\(\);[\s\S]*window\._styleCheckConfigFormerNames\?\.\(\);/.test(open));
  const chk = slice('window._styleCheckConfigFormerNames = async', '\n};\n');
  check('a former name two styles had is never guessed', /filter\(\(\[, o\]\) => o\.length === 1\)/.test(chk));
  check('a name the library has now is never offered', /if \(!f \|\| have\.has\(f\)\) continue;/.test(chk));
  check('the setting names styles too', html.includes('Update the open config when a font or style it uses is renamed'));
  check('the library entries are exposed for the check', html.includes('window._libraryStyleEntries = _libraryEntries;'));
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
