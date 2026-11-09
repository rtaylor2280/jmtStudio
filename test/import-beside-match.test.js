// A card font that is THE SAME FONT as one in the library, and is imported, comes in BESIDE it: a
// new library font in the matched font's own source, read from the card folder the way "Add from
// folder" reads one. Files the library already holds are links, not copies. Anything that does not
// fit falls back to the ordinary import. Real pipeline: a real source, a real entry. [B-643]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'soundFontSources'));
const E = require(path.join(ROOT, 'soundFontEntries'));
const B = require(path.join(ROOT, 'soundFontBulkImport'));
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
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-beside-' + t + '-'));

(async () => {
  const picked = tmp('picked');
  fs.mkdirSync(path.join(picked, 'Ahsoka'), { recursive: true });
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'hum.wav'), wav('HUM-VENDOR'));
  fs.writeFileSync(path.join(picked, 'Ahsoka', 'swing1.wav'), wav('SWING-VENDOR'));
  const userData = tmp('ud');
  const imp = await S.importSource({ userData, sourcePath: picked, originalName: 'Bundle', metadata: {} });
  const ent = await E.createEntry({ userData, sourceUuid: imp.uuid, candidate: { path: 'Ahsoka' }, name: 'Ahsoka',
    metadata: { tags: ['Vendor'], author: 'Someone' } });
  check('setup: a library font from a real source', ent && ent.ok, JSON.stringify(ent));

  // The card's copy: the same sounds, plus one quote the library does not have.
  const card = tmp('card');
  const cf = path.join(card, 'Ahsoka_Card');
  fs.mkdirSync(path.join(cf, 'quote'), { recursive: true });
  fs.writeFileSync(path.join(cf, 'hum.wav'), wav('HUM-VENDOR'));
  fs.writeFileSync(path.join(cf, 'swing1.wav'), wav('SWING-VENDOR'));
  fs.writeFileSync(path.join(cf, 'quote', 'q1.wav'), wav('A-NEW-QUOTE'));
  // Card clutter: a desktop.ini in every folder, which must never arrive.
  fs.writeFileSync(path.join(cf, 'desktop.ini'), '[.ShellClassInfo]');
  fs.writeFileSync(path.join(cf, 'quote', 'desktop.ini'), '[.ShellClassInfo]');

  const src = { absPath: cf, rawName: 'Ahsoka_Card', guidedName: 'Ahsoka', guidedTags: ['Card Find'],
    _match: { matchName: 'Ahsoka', verdict: 'have_it' } };
  const r = await B._importBesideMatch({ userData, src });
  check('it comes in beside the matched font, named free (_2)', r && r.ok && r.name === 'Ahsoka_2' && r.besideOf === 'Ahsoka', JSON.stringify(r));
  const made = E.findEntryByName(userData, 'Ahsoka_2');
  check('in the matched font\'s OWN source, at its place in it',
    made && made.meta.sourceUuid === imp.uuid && made.meta.candidatePath === 'Ahsoka', JSON.stringify(made && made.meta));
  check('it starts with the matched font\'s details, plus the row\'s tags',
    made && made.meta.author === 'Someone' && made.meta.tags.includes('Vendor') && made.meta.tags.includes('Card Find'));
  const dir = path.join(E.entriesRoot(userData), 'Ahsoka_2');
  check('the card\'s new quote is there', fs.existsSync(path.join(dir, 'quote', 'q1.wav')));
  check('OS clutter (desktop.ini) never comes in with a folder',
    !fs.existsSync(path.join(dir, 'desktop.ini')) && !fs.existsSync(path.join(dir, 'quote', 'desktop.ini')));
  const srcHum = path.join(S.sourcesRoot(userData), imp.uuid, 'source', 'Ahsoka', 'hum.wav');
  check('a sound the library already holds is a link, not a second copy',
    fs.statSync(path.join(dir, 'hum.wav')).ino === fs.statSync(srcHum).ino);
  check('the source gained no new source of its own', S.listSources(userData).length === 1, String(S.listSources(userData).length));
  check('the matched font itself is untouched', !fs.existsSync(path.join(E.entriesRoot(userData), 'Ahsoka', 'quote')));
  check('the card folder name is an alias of the NEW version', JSON.stringify(E.findEntryByName(userData, 'Ahsoka_2').meta.formerNames) === '["Ahsoka_Card"]',
    JSON.stringify(E.findEntryByName(userData, 'Ahsoka_2').meta.formerNames));
  // An alias the matched font held for that card name moves to the version.
  E.addFormerName(userData, 'Ahsoka', 'Ahsoka_Card2');
  const cf2 = path.join(card, 'Ahsoka_Card2'); fs.mkdirSync(cf2, { recursive: true });
  fs.writeFileSync(path.join(cf2, 'hum.wav'), wav('HUM-VENDOR')); fs.writeFileSync(path.join(cf2, 'swing1.wav'), wav('SWING-VENDOR'));
  const r2 = await B._importBesideMatch({ userData, src: { absPath: cf2, guidedName: 'DarkAhsoka', _match: { matchName: 'Ahsoka', verdict: 'have_it' } } });
  check('renamed in the review: the version has the card name, the matched font no longer does',
    r2 && r2.ok && JSON.stringify(E.findEntryByName(userData, 'DarkAhsoka').meta.formerNames) === '["Ahsoka_Card2"]'
    && !(E.findEntryByName(userData, 'Ahsoka').meta.formerNames || []).includes('Ahsoka_Card2'), JSON.stringify(r2));

  // An identical download (archive check: no verdict, _duplicate) is the same font and comes in beside.
  const cf3 = path.join(card, 'Ahsoka_Same'); fs.mkdirSync(cf3, { recursive: true });
  fs.writeFileSync(path.join(cf3, 'hum.wav'), wav('HUM-VENDOR')); fs.writeFileSync(path.join(cf3, 'swing1.wav'), wav('SWING-VENDOR'));
  const r3 = await B._importBesideMatch({ userData, src: { absPath: cf3, guidedName: 'Thor', _duplicate: true,
    _match: { label: 'Already in your library', matchName: 'Ahsoka', fullyOwned: true } } });
  check('an identical copy (no verdict) comes in beside, on the same source',
    r3 && r3.ok && E.findEntryByName(userData, 'Thor').meta.sourceUuid === imp.uuid && S.listSources(userData).length === 1, JSON.stringify(r3));

  console.log('falls back (null) when it does not apply');
  check('not the same font', (await B._importBesideMatch({ userData, src: { ...src, _match: { matchName: 'Ahsoka', verdict: 'new' } } })) === null);
  check('no match at all', (await B._importBesideMatch({ userData, src: { absPath: cf } })) === null);
  const zip = path.join(card, 'x.zip'); fs.writeFileSync(zip, 'PK');
  check('not a folder (an archive)', (await B._importBesideMatch({ userData, src: { ...src, absPath: zip } })) === null);
  check('the matched font is gone', (await B._importBesideMatch({ userData, src: { ...src, _match: { matchName: 'Nope', verdict: 'have_it' } } })) === null);

  console.log('wiring');
  {
    const h = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    check('single import: re-importing a FOLDER that IS one font comes in beside it; a release-shaped folder takes the old route',
      /if \(_ins && _ins\.ok && _ins\.verdict !== 'contains' && _ins\.verdict !== 'not-a-font'\) _versionOf = _fonts\[0\]\.name;/.test(h)
      && /if \(_versionOf && window\._sfAddFontFromFolder\)/.test(h)
      && /await window\._sfAddFontFromFolder\(_versionOf, sourcePath\);/.test(h)
      // The button says what it will do, from the same decision.
      && /_sfDupEls\.reimportBtn\.textContent = _versionOf \? `Add as a version of \$\{_versionOf\}` : 'Re-import as a new source';/.test(h)
      && /els\.reimportBtn\.textContent = _oneC \? `Add as a version of \$\{_oneC\.name\}` : 'Re-import as a new source';/.test(h)
      && /const _sfPickFontFolder = async \(words, givenPath = null\) =>/.test(h));
    check('single import: a re-import\'s review keeps matches ticked',
      /reimport: !!forceNewSource \}/.test(h) && /if \(hit\.fullyOwned && !_sfImport\.reimport && row\.dataset\.already !== '1'/.test(h));
  }
  const bulk = fs.readFileSync(path.join(ROOT, 'soundFontBulkImport.js'), 'utf8');
  check('the commit loop tries beside first, then the ordinary import',
    /const beside = await _importBesideMatch\(\{ userData, src \}[\s\S]{0,700}continue;\s*\}\s*const result = await importPlannedSource\(/.test(bulk));

  for (const d of [picked, userData, card]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
