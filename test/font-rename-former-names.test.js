// A renamed font keeps its former names, so a config still naming it by an old one can be updated.
// [B-561]
//
//   1. _withFormerName: newest first, five at most, no repeats (any case), the new name never listed.
//   2. updateEntryMeta and renameEntries write them; an update cannot; a duplicate starts with none.
//   3. The export sidecar carries them, and an import as a new copy drops them (_dropFormerNames).
//   4. The renderer rewrites only a preset's font folder, keeps its shared folders, matches any case.
//   5. Wiring: the config-open review, both rename surfaces, the cache clear, Remembered choices.
//   forgetFormerName (in 2) removes one former name from one font.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const entries = require(path.join(ROOT, 'soundFontEntries.js'));
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');

(async () => {
  console.log('1. the list');
  const w = entries._withFormerName;
  check('first rename lists the old name', JSON.stringify(w(undefined, 'Terra', 'Terra_v2')) === '["Terra"]');
  check('newest first', JSON.stringify(w(['A'], 'B', 'C')) === '["B","A"]');
  check('five at most, the oldest pushed out',
    JSON.stringify(w(['E', 'D', 'C', 'B', 'A'], 'F', 'G')) === '["F","E","D","C","B"]');
  check('a repeat (any case) is listed once, at the front', JSON.stringify(w(['b', 'A'], 'A', 'C')) === '["A","b"]');
  check('renaming back to a former name un-lists it', JSON.stringify(w(['Terra'], 'Terra_v2', 'terra')) === '["Terra_v2"]');
  check('a case-only rename adds nothing', JSON.stringify(w([], 'terra', 'Terra')) === '[]');

  console.log('2. the rename paths');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-former-'));
  const root = entries.entriesRoot(ud);
  const make = (name, extra = {}) => {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'meta.json'), JSON.stringify({ schemaVersion: 1, name, ...extra }));
  };
  const metaOf = (name) => JSON.parse(fs.readFileSync(path.join(root, name, 'meta.json'), 'utf8'));
  try {
    make('Terra');
    let r = entries.updateEntryMeta({ userData: ud, currentName: 'Terra', newName: 'Terra_v2', updates: {} });
    check('updateEntryMeta: the rename lists the old name', r && r.ok && JSON.stringify(metaOf('Terra_v2').formerNames) === '["Terra"]',
      JSON.stringify(r));
    r = entries.updateEntryMeta({ userData: ud, currentName: 'Terra_v2', updates: { formerNames: ['X'], description: 'd' } });
    check('an update cannot write them', r && r.ok && JSON.stringify(metaOf('Terra_v2').formerNames) === '["Terra"]');
    make('A'); make('B');
    r = entries.renameEntries(ud, [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }]);
    check('renameEntries: a swap gives each font the other\'s name as its former one',
      r && r.ok && JSON.stringify(metaOf('B').formerNames) === '["A"]' && JSON.stringify(metaOf('A').formerNames) === '["B"]',
      JSON.stringify({ r, A: metaOf('A'), B: metaOf('B') }));
    make('Vx', { formerNames: ['o1', 'o2', 'o3', 'o4'] });
    const ren = (from, to) => entries.updateEntryMeta({ userData: ud, currentName: from, newName: to, updates: {}, visitName: 'Vx' });
    ren('Vx', 'Vy'); ren('Vy', 'Vz'); ren('Vz', 'Vw');
    check('one visit, three renames: only the opening name is recorded, and no old name is pushed out',
      JSON.stringify(metaOf('Vw').formerNames) === '["Vx","o1","o2","o3","o4"]', JSON.stringify(metaOf('Vw').formerNames));
    ren('Vw', 'Vx');
    check('renaming back to the opening name in the same visit restores the list exactly',
      JSON.stringify(metaOf('Vx').formerNames) === '["o1","o2","o3","o4"]', JSON.stringify(metaOf('Vx').formerNames));
    make('Orb', { formerNames: ['Orb_v1', 'ORB_OLD', 'Sphere'] });
    r = entries.forgetFormerName(ud, 'Orb', 'orb_old');
    check('forgetFormerName removes that one name (any case) and keeps the rest',
      r && r.ok && r.changed && JSON.stringify(metaOf('Orb').formerNames) === '["Orb_v1","Sphere"]' && metaOf('Orb').name === 'Orb',
      JSON.stringify({ r, meta: metaOf('Orb') }));
    r = entries.forgetFormerName(ud, 'Orb', 'Nope');
    check('a name it never had changes nothing', r && r.ok && r.changed === false
      && JSON.stringify(metaOf('Orb').formerNames) === '["Orb_v1","Sphere"]');
    entries.forgetFormerName(ud, 'Orb', 'Orb_v1'); entries.forgetFormerName(ud, 'Orb', 'Sphere');
    check('the last one removed leaves no list', !('formerNames' in metaOf('Orb')));
  } finally {
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  }
  const ents = fs.readFileSync(path.join(ROOT, 'soundFontEntries.js'), 'utf8');
  const dupAt = ents.indexOf('async function duplicateEntry(');
  const dup = ents.slice(dupAt, ents.indexOf("if (mode === 'source')", dupAt));
  check('a duplicate (current) drops them', /const meta = \{ \.\.\.srcMeta \};[\s\S]*delete meta\.formerNames;[\s\S]*writeFileSync/.test(dup));
  check('a duplicate (source) never copies them: its metadata list has no formerNames',
    !/formerNames/.test(ents.slice(ents.indexOf("if (mode === 'source')", dupAt), ents.indexOf("if (mode === 'source')", dupAt) + 1500)));
  check('createEntry takes them from the metadata, minus its own name',
    /metadata\.formerNames[\s\S]{0,120}_withFormerName\(metadata\.formerNames\.slice\(1\), metadata\.formerNames\[0\], entryName\)/.test(ents));

  console.log('3. export and import');
  const cur = require(path.join(ROOT, 'soundFontCuration.js'));
  check('the sidecar carries them', cur.ENTRY_FIELDS.includes('formerNames'));
  const back = cur.entryCurationFor({ entries: { '': { name: 'Terra_v2', formerNames: ['Terra'] } } }, '');
  check('and hands them back on import', back && JSON.stringify(back.formerNames) === '["Terra"]', JSON.stringify(back));
  const srcs = fs.readFileSync(path.join(ROOT, 'soundFontSources.js'), 'utf8');
  const dAt = srcs.indexOf('function _dropFormerNames(');
  let d = 0, dEnd = -1;
  for (let j = srcs.indexOf('{', dAt); j < srcs.length; j++) {
    if (srcs[j] === '{') d++; else if (srcs[j] === '}') { d--; if (!d) { dEnd = j + 1; break; } }
  }
  const ctx = {};
  vm.runInNewContext(srcs.slice(dAt, dEnd) + '; this.f = _dropFormerNames;', ctx);
  const payload = { entries: { '': { tags: ['x'], formerNames: ['A'] } }, copies: [{ curation: { formerNames: ['B'] } }],
                    customized: [{ curation: { name: 'C', formerNames: ['C0'] } }] };
  ctx.f(payload);
  check('import as new drops them from every block, keeping the rest',
    !JSON.stringify(payload).includes('formerNames') && payload.entries[''].tags[0] === 'x', JSON.stringify(payload));
  check('only on an import as new', /if \(curation && forceNewSource\) _dropFormerNames\(curation\);/.test(srcs));

  console.log('4. the preset rewrite');
  const pp = require(path.join(ROOT, 'renderer', 'presetParser.js'));
  const eAt = html.indexOf('const _sfFontRenameEdits = ');
  const eEnd = html.indexOf('// One atomic edit', eAt);
  const ctx2 = { presetParser: pp, _sfFontPathParts: (v) => String(v ?? '').split(';').map((s) => s.trim()) };
  vm.runInNewContext(html.slice(eAt, eEnd) + '; this.f = _sfFontRenameEdits;', ctx2);
  const cfg = [
    'Preset presets[] = {',
    '  { "terra;common", "tracks/a.wav",',
    '    StylePtr<Blue>(),',
    '    "one" },',
    '  { "Other", "",',
    '    StylePtr<Red>(),',
    '    "two" },',
    '};',
    'BladeConfig blades[] = { { 0, WS281XBladePtr<1, bladePin>(), CONFIGARRAY(presets) } };',
  ].join('\n');
  const edits = ctx2.f(cfg, (dName) => (dName.toLowerCase() === 'terra' ? 'Terra_v2' : null));
  check('one preset, matched without case', edits.length === 1, JSON.stringify(edits));
  check('the font folder renamed, its shared folder kept', edits[0] && edits[0].text === '"Terra_v2;common"', edits[0] && edits[0].text);
  const r0 = edits[0] && edits[0].range;
  const line = cfg.split('\n')[r0 ? r0.startLineNumber - 1 : 0];
  check('the range covers the quoted font value', r0 && line.slice(r0.startColumn - 1, r0.endColumn - 1) === '"terra;common"',
    JSON.stringify(r0));
  check('a shared folder of the same name is not touched',
    ctx2.f('Preset p[] = { { "X;terra", "", StylePtr<Red>(), "x" } };', (n) => (n.toLowerCase() === 'terra' ? 'T' : null)).length === 0);

  console.log('5. wiring');
  check('a config opening runs the former-names check', /setTimeout\(\(\) => \{ window\._sfCheckConfigFormerNames\?\.\(\); \}, 0\);\s*\}/.test(html));
  check('a library name is never questioned', /if \(have\.has\(lc\)\) continue;/.test(html));
  const pAt = html.indexOf('function _sfPromptFormerNames(');
  const prompt = html.slice(pAt, html.indexOf('\n}\n', pAt));
  check('the review is one list, a row per renamed font', pAt > 0 && prompt.length > 500
    && /_sfPromptFormerNames\(rows\)/.test(html) && /sf-save-conflict-row/.test(prompt));
  check('each row: Update (default), Ignore, Not this font / None of these',
    /radio\('update', 'Update', true, tips\.update\) \+ radio\('ignore', 'Ignore', false, tips\.ignore\)/.test(prompt)
    && /'None of these' : 'Not this font', false, tips\.forget\)/.test(prompt));
  check('every choice has a hover saying what it does', /<label title="\$\{_preflightEsc\(tip\)\}">/.test(prompt)
    && /no config asks about it again\.`/.test(prompt));
  check('two or more owners: the row picks the font from a dropdown', /data-former-pick/.test(prompt));
  check('every Update is one edit; Not this font forgets the name on the font(s)',
    /if \(to\.size\) _sfApplyFontRenameEdits\(/.test(html) && /forgetFormerName\(\{ entryName: e\.name, oldName: p\.row\.d \}\)/.test(html));
  const setAt = html.indexOf('function _sfSettleVisitRename(');
  const settle = html.slice(setAt, html.indexOf('\n      }\n', setAt));
  check('the font window asks once, on close, from the opening name to the final one', setAt > 0
    && /if \(!from \|\| !to \|\| from === to\) return;/.test(settle)
    && /window\._sfConfigFollowRenames\?\.\(\[\{ from, to \}\]\)/.test(settle)
    && /classList\.remove\('active'\);\s*_sfSettleVisitRename\(\);/.test(html)
    && /_sfSettleVisitRename\(\);\s*_sfDetailOriginalName = entry\.name;\s*_sfDetailVisitName = entry\.name;/.test(html));
  check('a save no longer asks; it passes the visit name', !/_sfConfigFollowRenames\?\.\(\[\{ from: _sfDetailOriginalName/.test(html)
    && /visitName: _sfDetailVisitName,/.test(html) && /updates, visitName \} = \{\}/.test(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8')));
  check('the source window offers it after its renames', /window\._sfConfigFollowRenames\?\.\(rr\.renamed\);/.test(html));
  check('Keep old name / Update / Always update', /cancelText: 'Keep old name',\s*middleText: 'Update',\s*confirmText: 'Always update'/.test(html));
  check('Always on: updated with a toast and Show', /if \(always\) \{\s*showToast\([\s\S]{0,300}label: 'Show', onClick: \(\) => switchTab\('config'\)/.test(html));
  check('every library refresh clears the play caches', /window\._presetPlayCachesClear\?\.\(\);/.test(html)
    && /window\._presetPlayCachesClear = \(\) => \{ _presetPlayCheckCache\.clear\(\); _presetEffectFileCache\.clear\(\); \};/.test(html));
  const body = html.slice(html.indexOf('id="settings-remembered-body"'), html.indexOf('<div class="about-section-heading">About</div>'));
  const aboutAt = html.indexOf('async function openAboutModal(');
  const aboutOpen = html.slice(aboutAt, html.indexOf('The modal opens HERE', aboutAt));
  check('Remembered choices opens collapsed every time Settings opens', aboutAt > 0
    && /getElementById\('settings-remembered-body'\)\.style\.display = 'none'/.test(aboutOpen)
    && /_rememberedBtn\.innerHTML = '&#9654; Show'/.test(aboutOpen));
  check('Remembered choices holds all three',
    ['setting-sd-include-config', 'setting-images-always-rename', 'setting-font-rename-update'].every((id) => body.includes(`id="${id}"`)));
  check('and is wired to their settings', /\['setting-images-always-rename', 'imagesAlwaysRename'\],\s*\['setting-font-rename-update', 'fontRenameAlwaysUpdate'\],/.test(html));
  check('the section hides with the Sound Fonts tab', /for \(const id of \['setting-remembered-item'\]\)/.test(html));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
