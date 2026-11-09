// A shared track has ALIASES: other names a config may use for the same file. One file, one place,
// many names - never a second copy. An import that meets the same audio under another name records
// it (two names for one recording on one card), a name given in the review is the real name with
// the card's as an alias, a rename keeps the old name, a backup carries them, and the config check
// offers a preset's track the library's name. [B-643]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'soundFontSharedTracks'));
const H = require(path.join(ROOT, 'soundFontSharedTracksHash'));
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
function wav(payload) {
  const data = Buffer.from(payload);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii'); head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(44100, 24); head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-talias-' + t + '-'));
const aliasesOf = (ud, name) => (T.listFiles(ud).find((f) => f.name === name) || {}).aliases || [];

(async () => {
  console.log('1. two names for one recording on one card');
  const ud = tmp('ud');
  const card = tmp('card');
  fs.writeFileSync(path.join(card, 'spectre_5.wav'), wav('MOON-HATI-THEME'));
  fs.writeFileSync(path.join(card, 'moon_hati.wav'), wav('MOON-HATI-THEME'));
  fs.writeFileSync(path.join(card, 'nomad.wav'), wav('NOMAD-THEME'));
  let r = await T.addFiles(ud, [path.join(card, 'spectre_5.wav'), path.join(card, 'moon_hati.wav'), path.join(card, 'nomad.wav')]);
  const names = T.listFiles(ud).map((f) => f.name).sort();
  check('one file for the shared recording, never a second copy', JSON.stringify(names) === '["nomad.wav","spectre_5.wav"]', JSON.stringify(names));
  check('the second name is an alias of the first', JSON.stringify(aliasesOf(ud, 'spectre_5.wav')) === '["moon_hati.wav"]', JSON.stringify(aliasesOf(ud, 'spectre_5.wav')));
  check('the import reports it', r.duplicates.some((d) => d.have === 'spectre_5.wav' && (d.aliases || []).includes('moon_hati.wav')), JSON.stringify(r.duplicates));

  console.log('2. a name given in the review is the real name; both card names are aliases');
  const ud2 = tmp('ud2');
  r = await T.addFiles(ud2, [
    { path: path.join(card, 'spectre_5.wav'), name: 'MoonHati_Theme.wav' },
    { path: path.join(card, 'moon_hati.wav'), name: 'moon_hati.wav' },
  ]);
  const n2 = T.listFiles(ud2).map((f) => f.name);
  check('the given name is the real name', JSON.stringify(n2) === '["moonhati_theme.wav"]' || JSON.stringify(n2) === '["MoonHati_Theme.wav"]', JSON.stringify(n2));
  const real = n2[0];
  const al = aliasesOf(ud2, real).map((x) => x.toLowerCase()).sort();
  check('all three names: the given one, the card original, the duplicate', JSON.stringify(al) === '["moon_hati.wav","spectre_5.wav"]', JSON.stringify(al));

  console.log('3. a rename keeps the old name');
  const rn = T.renameFile(ud, 'nomad.wav', 'Nomad_Theme.wav');
  check('renamed', rn && rn.ok, JSON.stringify(rn));
  check('the old name is an alias', aliasesOf(ud, rn.newName).includes('nomad.wav'), JSON.stringify(aliasesOf(ud, rn.newName)));
  T.renameFile(ud, rn.newName, 'nomad.wav');
  check('renaming back un-lists it and lists the other', JSON.stringify(aliasesOf(ud, 'nomad.wav')) === '["Nomad_Theme.wav"]', JSON.stringify(aliasesOf(ud, 'nomad.wav')));

  console.log('4. forget, cap, backup');
  const f = H.forgetAlias(ud, 'spectre_5.wav', 'MOON_HATI.wav');
  check('forgetAlias removes one (any case)', f.ok && f.changed && aliasesOf(ud, 'spectre_5.wav').length === 0);
  check('the cap is 50', H.ALIASES_MAX === 50);
  const idx = H.readIndex(ud);
  const u = Object.keys(idx.tracks).find((k) => idx.tracks[k].name === 'nomad.wav');
  const ud3 = tmp('ud3'); fs.mkdirSync(path.join(ud3, 'soundFonts', 'sharedTracks'), { recursive: true });
  H.recordInsert(ud3, { ...idx.tracks[u], uuid: u, aliases: ['old1.wav', 'nomad.wav', 'old2.wav'] });
  const back = H.readIndex(ud3).tracks[u];
  check('a restore brings aliases back, never the track\'s own name', JSON.stringify(back.aliases) === '["old1.wav","old2.wav"]', JSON.stringify(back.aliases));
  const bk = fs.readFileSync(path.join(ROOT, 'soundFontBackup.js'), 'utf8');
  check('the backup restore passes them', /addedAt: backupRecord\.addedAt,\s*aliases: backupRecord\.aliases,/.test(bk));

  console.log('5. the config check');
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  check('track rows: a track no shared track is named for, found in a track\'s aliases',
    /const owners = files\.filter\(\(f\) => \(f\.aliases \|\| \[\]\)\.some\(\(n\) => String\(n\)\.toLowerCase\(\) === lc\)\);/.test(html)
    && /rows\.push\(\{ kind: 'track', lc, d, owners, count \}\);/.test(html));
  check('a track edit swaps the file name and keeps its folder',
    /const dir = p\.track\.slice\(0, p\.track\.length - base\.length\);/.test(html) && /text: '"' \+ dir \+ to \+ '"',/.test(html));
  check('fonts and tracks apply as one edit', /\.\.\.\(trackTo\.size \? _sfTrackRenameEdits/.test(html) && /if \(edits\.length\) _sfApplyFontRenameEdits\(edits\);/.test(html));
  check('Not this track forgets the track alias', /sharedTracksForgetAlias\(\{ name: e\.name, alias: p\.row\.d \}\)/.test(html));
  check('one check at a time', /if \(_sfAliasCheckBusy\) return;/.test(html));
  check('card import close: a track left out as the same audio is aliased - to the library track, or to the first copy as it came in',
    /const target = it\.ownedIn === 'library' \? it\.matchName : came\.get\(lc\(it\.matchName\)\);/.test(html)
    && /await window\.electronAPI\.sharedTracksAddAlias\(tp\)/.test(html));
  check('the twin font left out gives its name to the copy that came in',
    /if \(!partner \|\| !partner\._willImport \|\| !s\.absPath\) continue;/.test(html) && /pairs\.push\(\{ entryName: target, incomingName: incoming \}\)/.test(html));
  check('IPC: sharedTracks:addAlias', /ipcMain\.handle\('sharedTracks:addAlias'/.test(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8')));
  check('an import that brought anything in rechecks, once', /window\._sfRecordImportAliases\?\.\(pairs, \{ recheck: _ran \|\| _trackPairs\.length > 0 \}\);/.test(html));
  check('a track rename rechecks the open config', /await _sfRefreshSharedTracksModal\(\);\s*\/\/[^\n]*\n[^\n]*\n\s*setTimeout\(\(\) => \{ window\._sfCheckConfigFormerNames\?\.\(\); \}, 0\);/.test(html));
  check('the review says what each choice means for the card: Update -> SD Export after flashing, Ignore -> card as it is',
    /The card in your saber still has '\s*\+ 'the old names, so after you flash, update the card from <strong>Sound Fonts &rarr; SD Export<\/strong>/.test(html)
    && /<strong>Ignore<\/strong> keeps the card\\'s names, and the card works as it is\./.test(html));
  check('the review\'s words claim neither renamed nor no-longer',
    /in this config \$\{one \? 'has another name' : 'have other names'\} in your library/.test(html) && /In your library: \$\{_preflightEsc\(r\.owners\[0\]\.name\)\}/.test(html));

  for (const d of [ud, ud2, ud3, card]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
