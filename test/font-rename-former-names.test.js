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
  const fifty = Array.from({ length: 50 }, (_, i) => `n${49 - i}`);   // n49 (newest) .. n0 (oldest)
  const pushed = w(fifty, 'new', 'cur');
  check('fifty at most (B-641, was five), the oldest pushed out',
    entries.FORMER_NAMES_MAX === 50 && pushed.length === 50 && pushed[0] === 'new' && pushed[49] === 'n1' && !pushed.includes('n0'),
    JSON.stringify({ max: entries.FORMER_NAMES_MAX, len: pushed.length, first: pushed[0], last: pushed[49] }));
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

    // addFormerName: an import met an IDENTICAL font under another name [B-641]
    make('Kyber', { formerNames: ['Kyber_old'] });
    r = entries.addFormerName(ud, 'Kyber', 'Kyber_Dawn');
    check('addFormerName: the incoming name goes first',
      r && r.ok && r.changed && JSON.stringify(metaOf('Kyber').formerNames) === '["Kyber_Dawn","Kyber_old"]', JSON.stringify({ r, m: metaOf('Kyber') }));
    r = entries.addFormerName(ud, 'Kyber', 'kyber');
    check('addFormerName: the font\'s own name (any case) is never added', r && r.ok && r.changed === false
      && JSON.stringify(metaOf('Kyber').formerNames) === '["Kyber_Dawn","Kyber_old"]');
    r = entries.addFormerName(ud, 'Kyber', 'kyber_dawn');
    check('addFormerName: a name it already has (any case) at the front changes nothing', r && r.ok && r.changed === false);
    r = entries.addFormerName(ud, 'Kyber', 'Kyber_old');
    check('addFormerName: a name it already has further back moves to the front',
      r && r.ok && r.changed && JSON.stringify(metaOf('Kyber').formerNames) === '["Kyber_old","Kyber_Dawn"]');
    make('Plain');
    r = entries.addFormerName(ud, 'Plain', '  CardName  ');
    check('addFormerName: a font with no list gets one, the name trimmed',
      r && r.ok && JSON.stringify(metaOf('Plain').formerNames) === '["CardName"]' && metaOf('Plain').name === 'Plain');
    r = entries.addFormerName(ud, 'Plain', '   ');
    check('addFormerName: a blank name is refused', r && r.ok === false);
    r = entries.addFormerName(ud, 'NoSuchFont', 'X');
    check('addFormerName: a missing font is an error, not a throw', r && r.ok === false);
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
    && /many \? 'None of these' : `Not this \$\{noun\}`, false, tips\.forget\)/.test(prompt));
  check('every choice has a hover saying what it does', /<label title="\$\{_preflightEsc\(tip\)\}">/.test(prompt)
    && /no config asks about it again\.`/.test(prompt));
  check('two or more owners: the row picks the font from a dropdown', /data-former-pick/.test(prompt));
  check('every Update is one edit; Not this font forgets the name on the font(s)',
    /if \(edits\.length\) _sfApplyFontRenameEdits\(edits\);/.test(html) && /forgetFormerName\(\{ entryName: e\.name, oldName: p\.row\.d \}\)/.test(html));
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
  check('and is wired to their settings', /\['setting-sd-include-config', 'sdExportIncludeConfig', 'never'\],\s*\['setting-images-always-rename', 'imagesAlwaysRename', 'ask'\],\s*\['setting-font-rename-update', 'fontRenameAlwaysUpdate', 'ask'\],/.test(html));
  check('each is Ask / Always / Never', ['setting-sd-include-config', 'setting-images-always-rename', 'setting-font-rename-update'].every((id) => {
    const at = body.indexOf(`id="${id}"`);
    const seg = body.slice(at, body.indexOf('</div>', at));
    return /data-choice="ask">Ask<[\s\S]*data-choice="always">Always<[\s\S]*data-choice="never">Never</.test(seg);
  }));
  check('the section hides with the Sound Fonts tab', /for \(const id of \['setting-remembered-item'\]\)/.test(html));

  // Never. [B-571]
  const fnAt = html.indexOf('async function _jmtRememberedChoice(');
  const fnSrc = html.slice(fnAt, html.indexOf('\n}\n', fnAt) + 2);
  const remembered = async (stored, legacyFalse) => {
    const ctx = { window: { electronAPI: { getSetting: async () => stored } } };
    vm.runInNewContext(fnSrc + '\nthis.f = _jmtRememberedChoice;', ctx);
    return ctx.f('k', legacyFalse);
  };
  check('a remembered choice reads its three values',
    (await remembered('ask')) === 'ask' && (await remembered('always')) === 'always' && (await remembered('never')) === 'never');
  check('true from before reads as Always, unset as Ask', (await remembered(true)) === 'always' && (await remembered(null)) === 'ask');
  check('false from before is Ask for the renames, Never for SD Export',
    (await remembered(false)) === 'ask' && (await remembered(false, 'never')) === 'never');
  check('an unreadable setting is Ask', await (async () => {
    const ctx = { window: { electronAPI: { getSetting: async () => { throw new Error('x'); } } } };
    vm.runInNewContext(fnSrc + '\nthis.f = _jmtRememberedChoice;', ctx);
    return (await ctx.f('k')) === 'ask';
  })());
  check('each dialog has a Never button, and it saves Never',
    ['Never update', 'Never rename', 'Never include'].every((t) => html.includes(`leadText: '${t}'`))
    && /if \(choice === 'lead'\) \{ try \{ await window\.electronAPI\.setSetting\('fontRenameAlwaysUpdate', 'never'\)/.test(html)
    && /if \(choice === 'lead'\) \{ try \{ await window\.electronAPI\.setSetting\('imagesAlwaysRename', 'never'\)/.test(html)
    && /if \(_ans === 'lead'\) await window\._sfSdSetConfigChoice\('never'\);/.test(html));
  check('no dialog carries a "Don\'t ask again" box', !html.includes(`label: "Don't ask again"`));
  // Font rename, image rename, and a font's style as its Last used style [B-569].
  check('Never skips the question', (html.match(/if \(remembered === 'never'\) return;/g) || []).length === 3);
  check('the Never button sits before Cancel and resolves lead',
    /id="modal-confirm-lead"[^>]*><\/button>\s*<button class="modal-btn-cancel" id="modal-confirm-cancel"/.test(html)
    && /leadBtn\.onclick\s*=\s*\(\) => cleanup\('lead'\)/.test(html));
  check('SD Export asks every time on Ask; Include and Don\'t include are this export only',
    /window\._sfSdConfigChoice\(\) === 'ask'/.test(html)
    && /_thisTime = _ans === 'middle' \|\| _ans === 'confirm';/.test(html)
    && !/_ans === 'cancel'[^\n]*_sfSdSetConfigChoice/.test(html));
  check('an image copied in the app keeps its name on Paste; a clipboard image is named after the item',
    /fromCopied = !!\(tmp && tmp\.ok\);/.test(html)
    && /await setFromFile\(tmp\.filePath, fromCopied\);/.test(html)
    && /const _sfSetEntryPicture = async \(filePath, keepName = false\)/.test(html)
    && /const _sfSetSourcePicture = async \(filePath, keepName = false\)/.test(html)
    && /_sfPasteImageVia\(async \(fp, keepName\) => \{/.test(html));
  check('a change in Files redraws the Image row, the picture and Included Files',
    /if \(_sfEntryFilesTree !== _sfPictureRowTree\) \{\s*_sfPictureRowTree = _sfEntryFilesTree;\s*try \{ _sfRenderEntryPictureViews\(\); \} catch \{\}/.test(html)
    && /const _sfRenderEntryPictureViews = async \(\) => \{[\s\S]{0,200}_sfRenderEntryPictureRow\(\);\s*_sfRenderPicture\(\{ imgId: 'sf-entry-picture'[\s\S]{0,600}_sfRenderDocChips\(/.test(html));
  check('every remembered-choice dialog has the X',
    /confirmText: 'Always update', confirmKind: 'primary',\s*closeX: true,/.test(html)
    && /confirmText: 'Always rename', confirmKind: 'primary',\s*closeX: true,/.test(html)
    && /confirmText: 'Always include',\s*confirmKind: 'primary',\s*closeX: true,/.test(html));
  check('the write uses this export\'s answer, not the setting again',
    /const _incl = _sdWantCfg;/.test(html) && /_sdWantCfg = _wantCfg;/.test(html));

  // ── 6. [B-641] An import that matched a font you have, and did not import it, records the
  // incoming name as a former name of that font.
  console.log('6. import aliases');
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-alias-'));
  const root2 = entries.entriesRoot(ud2);
  const make2 = (name, extra = {}) => {
    fs.mkdirSync(path.join(root2, name), { recursive: true });
    fs.writeFileSync(path.join(root2, name, 'meta.json'), JSON.stringify({ schemaVersion: 1, name, ...extra }));
  };
  const meta2 = (name) => JSON.parse(fs.readFileSync(path.join(root2, name, 'meta.json'), 'utf8'));
  try {
    make2('Terra', { sourceUuid: 'src-one' });
    make2('BundleA', { sourceUuid: 'src-bundle' }); make2('BundleB', { sourceUuid: 'src-bundle' });
    const r = entries.addImportAliases(ud2, [
      { entryName: 'Terra', incomingName: 'Kyber_Dawn' },          // matched by content
      { sourceUuid: 'src-one', incomingName: 'Terra_Card.zip' },   // same download, one font
      { sourceUuid: 'src-bundle', incomingName: 'Pack.zip' },      // a bundle: no one font to name
      { entryName: 'Terra', incomingName: 'terra' },               // its own name: nothing
      { entryName: 'Missing', incomingName: 'X' },                 // gone: skipped, no throw
      null, { entryName: 'Terra' },
    ]);
    check('addImportAliases: by font, and by a one-font source; .zip dropped; newest first',
      r && r.ok && r.added === 2 && JSON.stringify(meta2('Terra').formerNames) === '["Terra_Card","Kyber_Dawn"]',
      JSON.stringify({ r, m: meta2('Terra') }));
    check('addImportAliases: a bundle source names no font',
      !('formerNames' in meta2('BundleA')) && !('formerNames' in meta2('BundleB')));
    // One owner per name: an identical copy met again does not give the name to a second font.
    make2('DarkAnakin', { formerNames: ['Card_DA'] }); make2('DarkAnakin_2');
    const r1 = entries.addImportAliases(ud2, [{ entryName: 'DarkAnakin_2', incomingName: 'Card_DA' }]);
    check('addImportAliases: a name another font already holds as an alias stays with it',
      r1.added === 0 && !('formerNames' in meta2('DarkAnakin_2')), JSON.stringify({ r1, m: meta2('DarkAnakin_2') }));
    const r2 = entries.addImportAliases(ud2, [{ entryName: 'DarkAnakin_2', incomingName: 'darkanakin' }]);
    check('addImportAliases: a name that is another font\'s own name is not added', r2.added === 0);
    const r3 = entries.addImportAliases(ud2, [{ entryName: 'Terra', incomingName: 'Dup' }, { entryName: 'DarkAnakin', incomingName: 'dup' }]);
    check('addImportAliases: within one batch the first owner keeps it', r3.added === 1 && !(meta2('DarkAnakin').formerNames || []).includes('dup'), JSON.stringify(r3));
  } finally {
    try { fs.rmSync(ud2, { recursive: true, force: true }); } catch {}
  }
  const bulkSrc = fs.readFileSync(path.join(ROOT, 'soundFontBulkImport.js'), 'utf8');
  check('a stored-download duplicate names its FONT (one entry from that source), not the source',
    /listEntries\(userData\)\s*\.filter\(e => e && e\.meta && e\.meta\.sourceUuid === r\.existingUuid\)/.test(bulkSrc)
    && /const nm = fonts\.length === 1 \? fonts\[0\]\.name : null;/.test(bulkSrc)
    && !/existing\.name \|\| \(existing\.meta && existing\.meta\.name\)/.test(bulkSrc));
  const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const preSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  check('IPC: entries:addImportAliases handled in main and exposed in preload',
    /ipcMain\.handle\('entries:addImportAliases'[\s\S]{0,200}soundFontEntries\.addImportAliases\(/.test(mainSrc)
    && /addImportAliases:\s*\(params\)\s*=> ipcRenderer\.invoke\('entries:addImportAliases', params\)/.test(preSrc));
  check('renderer helper records, then re-runs the open config\'s lookup only when something was added',
    /window\._sfRecordImportAliases = async \(pairs, \{ recheck = false \} = \{\}\) => \{[\s\S]{0,400}addImportAliases\(\{ pairs: list \}\)[\s\S]{0,120}\(recheck \|\| \(r && r\.ok && r\.added > 0\)\) setTimeout\(\(\) => \{ window\._sfCheckConfigFormerNames\?\.\(\); \}, 0\)/.test(html));
  check('card import: quick and guided mark what goes in; closeModal records the rest, matched or same download',
    /for \(const s of fresh\) s\._willImport = true;/.test(html)
    && /for \(const r of guidedRows\) if \(r\.src\) delete r\.src\._willImport;/.test(html)
    && /for \(const r of chosen\) if \(r\.src\) r\.src\._willImport = true;/.test(html)
    && /if \(!s \|\| s\._willImport\) continue;[\s\S]{0,900}const _sameFont = s\._duplicate \|\| \(s\._match && \(s\._match\.verdict === 'have_it' \|\| s\._match\.verdict === 'version'\)\);\s*if \(!_sameFont\) continue;\s*if \(s\._match && s\._match\.matchName\) pairs\.push\(\{ entryName: s\._match\.matchName, incomingName: incoming \}\)[\s\S]{0,200}s\._duplicate && s\._existingUuid\) pairs\.push\(\{ sourceUuid: s\._existingUuid/.test(html));
  const closeAt = html.indexOf('const closeModal = () => {');
  const closeBody = html.slice(closeAt, html.indexOf('currentPlan = null;', closeAt));
  check('card import: the record happens BEFORE the plan is dropped',
    closeAt > 0 && closeBody.includes('window._sfRecordImportAliases?.(pairs, { recheck: _ran || _trackPairs.length > 0 })'));   // slice ends at currentPlan = null
  check('single import: the review marks what it commits, before its nothing-ticked return',
    /_sfImport\._importedPaths = new Set\(picks\.map\(p => \(p\.candidate && p\.candidate\.path\) \|\| ''\)\);\s*(\/\/[^\n]*\n\s*)*if \(picks\.length === 0 && custPicks\.length === 0\) return;/.test(html));
  const sfCloseAt = html.indexOf('const _sfCloseImport = () => {');
  const sfClose = html.slice(sfCloseAt, html.indexOf('_sfImport = null;', sfCloseAt) + 20);
  check('single import: every exit records unimported matches, before _sfImport is cleared',
    /const mr = _sfImport && _sfImport\._matchRes;[\s\S]{0,500}\(x\.verdict === 'have_it' \|\| x\.verdict === 'version'\) && !\(done && done\.has\(x\.path \|\| ''\)\)[\s\S]{0,120}entryName: x\.matchName, incomingName: x\.name/.test(sfClose));
  const dupAt2 = html.indexOf('const _sfHandleDuplicate = ');
  const dupBody = html.slice(dupAt2, html.indexOf('const _sfPopulateReview', dupAt2));
  check('same download: Open existing and Cancel record it; Re-import as new does not',
    /const onKeep = async \(\) => \{\s*recordAlias\(\);/.test(dupBody)
    && /const onCancel = \(\) => \{ recordAlias\(\);/.test(dupBody)
    && !/const onReimport[^\n]*recordAlias/.test(dupBody));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
