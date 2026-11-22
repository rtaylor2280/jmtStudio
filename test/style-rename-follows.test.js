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

console.log('3b. a config opened later: one review, fonts and styles, a decision per line [B-656]');
// Runs the REAL config-open review (_sfCheckConfigFormerNames) with the modal stubbed: the stub
// records the rows it was shown and answers with the given choice per kind. B-651 shipped a
// wrong return-value test because its tests only read the code; this one runs it.
const runOpenCheck = async (choiceFor, libEntries, prefix = '') => {
  const pp = require(path.join(ROOT, 'renderer', 'presetParser.js'));
  let text = prefix + [
    'Preset presets[] = {',
    '  { "Astral-Projection;common", "",',
    '    StylePtr<AstralProjection>(),',
    '    "astral"},',
    '};',
    'BladeConfig blades[] = { { 0, WS281XBladePtr<144, bladePin, Color8::GRB, PowerPINS<bladePowerPin2> >(), CONFIGARRAY(presets) } };',
  ].join('\n');
  const shown = [];
  const apply = (edits) => {
    const lines = text.split('\n');
    const starts = [0]; for (const l of lines) starts.push(starts[starts.length - 1] + l.length + 1);
    const off = (ln, col) => starts[ln - 1] + col - 1;
    for (const e of [...edits].sort((x, y) => off(y.range.startLineNumber, y.range.startColumn) - off(x.range.startLineNumber, x.range.startColumn))) {
      text = text.slice(0, off(e.range.startLineNumber, e.range.startColumn)) + e.text + text.slice(off(e.range.endLineNumber, e.range.endColumn));
    }
  };
  const ctx3 = {
    presetParser: pp, fileIsOpen: true, editor: { getValue: () => text }, currentFilePath: 'bvmTest.h',
    _sfFontPathParts: (v) => String(v ?? '').split(';').map((x) => x.trim()),
    _sfSharedDirs: (v) => String(v ?? '').split(';').map((x) => x.trim()).slice(1).filter(Boolean),
    _sfPromptFormerNames: async (rows) => { shown.push(rows); return rows.map((row) => ({ row, choice: choiceFor(row.kind), owner: row.owners[0] })); },
    _stylesEditorInstance: null,
    window: {
      _libraryStyleEntries: () => libEntries,
      _atomicEdit: (e, src, edits) => apply(edits),
      electronAPI: {
        listEntries: async () => ({ ok: true, entries: [{ name: 'Astral-Projection2', meta: { formerNames: ['Astral-Projection'] } }] }),
        sharedTracksListFiles: async () => ({ ok: true, files: [] }),
        listCommons: async () => ({ ok: true, commons: [{ meta: { name: 'common' }, uuid: 'c1' }] }),
      },
    },
  };
  vm.runInNewContext(slice('const _sfFontRenameEdits = ', '// An import met fonts already in the library'), ctx3);
  await ctx3.window._sfCheckConfigFormerNames();
  return { text, shown };
};
const LIB1 = [{ name: 'AstralProjectionBVM', meta: { formerNames: ['AstralProjection'] } }];
const openCheckDone = (async () => {
  const both = await runOpenCheck(() => 'update', LIB1);
  check('ONE review for a renamed font and a renamed style', both.shown.length === 1, String(both.shown.length));
  const kinds = (both.shown[0] || []).map((r) => r.kind);
  check('a row per thing: the font and the style', JSON.stringify(kinds) === '["font","style"]', JSON.stringify(kinds));
  check('Update on both: the font folder and the style are both renamed, in one edit',
    /"Astral-Projection2;common"/.test(both.text) && /StylePtr<AstralProjectionBVM>\(\)/.test(both.text) && !/StylePtr<AstralProjection>\(\)/.test(both.text), both.text);
  const split = await runOpenCheck((k) => (k === 'style' ? 'later' : 'update'), LIB1);
  check('a decision per line: font updated, style Not now',
    /"Astral-Projection2;common"/.test(split.text) && /StylePtr<AstralProjection>\(\)/.test(split.text), split.text);
  const twin = await runOpenCheck(() => 'update', [{ name: 'A1', meta: { formerNames: ['AstralProjection'] } }, { name: 'A2', meta: { formerNames: ['AstralProjection'] } }]);
  const sRow = (twin.shown[0] || []).find((r) => r.kind === 'style');
  check('a name two styles once had: one row, both offered to pick from', sRow && sRow.owners.map((o) => o.name).join() === 'A1,A2', JSON.stringify(sRow && sRow.owners));
  const has = await runOpenCheck(() => 'update', [...LIB1, { name: 'AstralProjection', meta: {} }]);
  check('a name the library has now is never offered (AstralProjection AND AstralProjectionBVM)', !(has.shown[0] || []).some((r) => r.kind === 'style'));
  const own = await runOpenCheck(() => 'update', LIB1, 'using AstralProjection = Layers<White>;\n');
  check('a style the config defines itself is never offered', !(own.shown[0] || []).some((r) => r.kind === 'style'), JSON.stringify((own.shown[0] || []).map((r) => r.kind)));
})();

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
  const open = slice('// The same review covers a style the Style Library renamed', '\n}\n');
  check('config open runs the one review, never a separate style prompt',
    /window\._sfCheckConfigFormerNames\?\.\(\)/.test(open) && !html.includes('_styleCheckConfigFormerNames'));
  const prompt = slice('function _sfPromptFormerNames(rows)', 'function _sfFormerNamesAwait(');
  check('both kinds: a Sound fonts section and a Styles section, each with its own sentence',
    /_section\('Sound fonts', _soundDesc[,)]/.test(prompt) && /_section\('Styles', _styleDesc\)/.test(prompt));
  check('the style sentence says Not now leaves a preset that will not compile; no promise about compile',
    /<strong>Not now<\/strong> leaves the old names, and those presets will not compile until they are changed\./.test(prompt)
    && !/Compile offers/.test(html));
  check('the sound sentence does not say saber, and is not definite about the card',
    /If your card still has/.test(prompt) && !/card in your saber/.test(html) && /keeps the names the presets have now/.test(prompt));
  check('a style row: Update or Not now, nothing else',
    /radio\('update', 'Update', !many, tips\.update, true\) \+ radio\('later', 'Not now', false, tips\.later, true\)/.test(prompt));
  const awaitFn = slice('function _sfFormerNamesAwait(', '\n}\n');
  check('Set all leaves style rows alone', /:not\(\[data-former-style\]\)/.test(awaitFn));
  // Nothing is picked for them when more than one could be meant (his, 2026-11-09). Built by the
  // real row builder, then read back.
  {
    const ctxRow = { _preflightEsc: (x) => String(x) };
    vm.runInNewContext(slice('function _sfFormerRow(r, i) {', '\nfunction _sfFormerNamesAwait') + '\nthis.row = _sfFormerRow;', ctxRow);
    const two = [{ name: 'CelsiusBVM' }, { name: 'CyberneticCerebrumBVM' }];
    const sRow = ctxRow.row({ kind: 'style', d: 'Celsius', count: 1, owners: two }, 4);
    check('a style line with two matches: the dropdown starts on "Choose a style"', /<option value="" selected>Choose a style<\/option>/.test(sRow), sRow);
    check('...it starts UNDECIDED: Update off, Not now not chosen either',
      /value="update" data-former-style disabled>Update/.test(sRow) && /value="later" data-former-style>Not now/.test(sRow) && !/checked/.test(sRow), sRow);
    const fRow = ctxRow.row({ kind: 'font', d: 'Celsius', count: 1, owners: [{ name: 'Celsius2' }, { name: 'Celsius3' }] }, 1);
    check('a font line with two matches: "Choose a font", nothing chosen, Update off',
      /Choose a font<\/option>/.test(fRow) && /value="ignore">Ignore/.test(fRow) && /value="update" disabled>Update/.test(fRow) && !/ checked/.test(fRow), fRow);
    const one = ctxRow.row({ kind: 'style', d: 'Astral', count: 1, owners: [{ name: 'AstralBVM' }] }, 0);
    check('one match: unchanged, Update chosen, no dropdown', /value="update" data-former-style checked>Update/.test(one) && !/<select/.test(one), one);
  }
  check('choosing turns Update on and selects it; the prompt turns it off and undecides it again',
    /up\.disabled = sel\.value === '';/.test(awaitFn) && /if \(sel\.value !== ''\) \{ up\.checked = true;/.test(awaitFn)
    && /else if \(up\.checked\) up\.checked = false;/.test(awaitFn)
    && /list\.addEventListener\('change', onPick\)/.test(awaitFn) && /list\.removeEventListener\('change', onPick\)/.test(awaitFn));
  check('Apply never takes the first by default: Update with nothing chosen leaves the line',
    /if \(sel && sel\.value === '' && choice === 'update'\) choice = row\.kind === 'style' \? 'later' : 'ignore';/.test(awaitFn));
  check('Set all skips a line that has no choice yet', /:not\(:disabled\)/.test(awaitFn));
  check('Apply with an undecided line applies nothing: it marks every one red, says what is needed, scrolls to the first',
    /const open = _undecided\(\);\s*if \(open\.length\) \{/.test(awaitFn) && /el\.classList\.add\('sf-former-undecided'\)/.test(awaitFn)
    && /msg\.textContent = `Choose \$\{noun\}, or \$\{rows\[i\]\.kind === 'style' \? 'Not now' : 'Ignore'\}\.`;/.test(awaitFn)
    && /scrollIntoView/.test(awaitFn) && /return;\s*\}\s*const picks = rows\.map/.test(awaitFn));
  check('deciding a line - a radio, the dropdown, or Set all - clears its red mark',
    /if \(radio\) \{ _clearMark\(radio\.closest\('\.sf-save-conflict-row'\)\); return; \}/.test(awaitFn)
    && /up\.checked = true; _clearMark\(/.test(awaitFn) && /el\.classList\.remove\('sf-former-undecided'\)/.test(awaitFn));
  check('Set all shows only with two or more sound rows', /const _soundRows = rows\.filter\(\(r\) => r\.kind !== 'style'\)\.length;/.test(prompt) && /_soundRows > 1/.test(prompt));
  check('with styles below, Set all sits inside the Sound fonts section; the top one hides',
    /_section\('Sound fonts', _soundDesc, _soundRows > 1 \? _bulkHtml : ''\)/.test(prompt)
    && /bulkRow\.style\.display = \(!_both && _soundRows > 1\) \? '' : 'none'/.test(prompt)
    && /list\.addEventListener\('click', onBulk\)/.test(awaitFn) && /list\.removeEventListener\('click', onBulk\)/.test(awaitFn));
  check('the setting names styles too', html.includes('Update the open config when a font or style it uses is renamed'));
  check('the library entries are exposed for the check', html.includes('window._libraryStyleEntries = _libraryEntries;'));
}

openCheckDone.catch((e) => { check('the config-open check ran', false, e && e.stack); }).then(() => {
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
});
