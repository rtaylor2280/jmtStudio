// A close match's "this copy has N files yours is missing" is split by the whole library: the
// files held elsewhere (another font, a source, shared tracks, a common, the pool) and the ones
// that are new. All elsewhere = owned: green, unticked, nothing lost by skipping. [B-643]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const compare = require(path.join(ROOT, 'soundFontCompare.js'));
const ci = require(path.join(ROOT, 'soundFontContentIndex.js'));

const sets = (core, cust = []) => {
  const c = new Set(core), u = new Set(cust);
  return { core: c, customizable: u, coreCount: c.size, customizableCount: u.size, coreSignature: compare.signatureOf(c) };
};
// 20 core sounds in common, the card adds 3 quote/track files the library font lacks.
const core = Array.from({ length: 20 }, (_, i) => `c${i}`);
const lib = [{ name: 'Vergence_Scatter_Dark', sets: sets(core, ['t1']), sourceUuid: 'vs-src' }];
const card = sets(core, ['t1', 'q1', 'q2', 'q3']);
// libraryHashes' shape: hash -> Set of 'src:<uuid>' / 'lib'.
const held = (pairs) => new Map(pairs.map(([h, ...w]) => [h, new Set(w)]));
const names = { 'other-src': 'Vergence Scatter' };
const opts = { sourceName: (u) => names[u] || null };

console.log('1. the missing hashes ride on the match');
const m0 = compare.matchAgainstLibrary(card, lib);
check('missing lists exactly the card files the font lacks',
  m0 && m0.missing && JSON.stringify(m0.missing.customizable.sort()) === '["q1","q2","q3"]' && m0.missing.core.length === 0,
  JSON.stringify(m0 && m0.missing));

console.log('2. the split and his wording (2026-11-08)');
const lead = "Nearly identical to Vergence_Scatter_Dark. This version has 3 quote or track files yours doesn't";
const run = (h) => { const x = compare.applyLibrarySplit(compare.matchAgainstLibrary(card, lib), h, opts); return [x, compare.verdictLabel(x)]; };
let [m, label] = run(held([['q1', 'src:vs-src'], ['q2', 'src:vs-src']]));
check('2 held, 1 new', m.missingSplit.elsewhere === 2 && m.missingSplit.fresh === 1, JSON.stringify(m.missingSplit));
check('some new, in its own source', label === `${lead}. 2 are in its source files but 1 is not in your library`, label);
check('some new is not owned', !compare.isFullyOwned(m));

[m, label] = run(held([['q1', 'src:other-src'], ['q2', 'src:other-src', 'lib']]));
check('some new, in another download, by its library name',
  label === `${lead}. 2 are in the Vergence Scatter source files but 1 is not in your library`, label);

[m, label] = run(held([['q1', 'src:other-src'], ['q2', 'lib']]));
check('some new, spread around: no location', label === `${lead}. 2 are in your library but 1 is not`, label);

[m, label] = run(held([['q1', 'src:vs-src'], ['q2', 'src:vs-src', 'lib'], ['q3', 'src:vs-src']]));
check('none new: owned', compare.isFullyOwned(m));
check('none new, in its own source',
  label === "Already in your library as Vergence_Scatter_Dark. This version has 3 quote or track files yours doesn't, but all are in its source files", label);
check('none new: the tip says a second copy is the only thing checking adds',
  /Every file in this font is already in your library/.test(compare.verdictTip(m)));
[m, label] = run(held([['q1', 'src:other-src'], ['q2', 'src:other-src'], ['q3', 'src:other-src']]));
check('none new, in another download', /but all are in the Vergence Scatter source files$/.test(label), label);
[m, label] = run(held([['q1', 'lib'], ['q2', 'src:other-src'], ['q3', 'lib']]));
check('none new, spread around', /but all are in your library$/.test(label), label);

[m, label] = run(new Map());
check('none held: "and none are in your library"', label === `${lead}, and none are in your library`, label);
check('none held is not owned', !compare.isFullyOwned(m));

m = compare.matchAgainstLibrary(card, lib);
check('without the library to ask, the old note stands',
  /yours is missing$/.test(compare.verdictLabel(m) || ''), compare.verdictLabel(m));
const same = compare.applyLibrarySplit(compare.matchAgainstLibrary(sets(core, ['t1']), lib), new Map(), opts);
check('an identical copy is unaffected by the split', compare.isFullyOwned(same) && compare.verdictLabel(same) === 'Already in your library');

console.log('3. libraryHashes counts only committed sources');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-libhash-'));
try {
  const sf = path.join(ud, 'soundFonts');
  const writeSrc = (uuid, files, committed) => {
    const root = path.join(sf, 'sources', uuid, 'source');
    fs.mkdirSync(root, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(root, f), f);
    if (committed) fs.writeFileSync(path.join(sf, 'sources', uuid, 'meta.json'), '{}');
    fs.mkdirSync(path.join(sf, '.filehashes', 'sources'), { recursive: true });
    fs.writeFileSync(path.join(sf, '.filehashes', 'sources', `${uuid}.json`), JSON.stringify({
      version: 1, records: files.map((f) => ({ relPath: f, fileHash: `h-${f}`, size: f.length })),
    }));
  };
  writeSrc('committed', ['a.wav'], true);
  writeSrc('staged', ['b.wav'], false);
  writeSrc('mine', ['c.wav'], true);
  const hs = ci.libraryHashes(ud, { excludeSourceUuids: ['mine'] });
  check('a committed source counts, and says which source', hs.has('h-a.wav') && hs.get('h-a.wav').has('src:committed'), JSON.stringify([...hs.keys()]));
  check('a staged source (no meta.json) does not: it is the card being analysed', !hs.has('h-b.wav'));
  check('an excluded source does not: the single import\'s own', !hs.has('h-c.wav'));
} finally {
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
}

console.log('4. wiring');
const bulk = fs.readFileSync(path.join(ROOT, 'soundFontBulkImport.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
check('card import: split before the label, flag on the row',
  /libraryHashes\(userData\)/.test(bulk) && /compare\.applyLibrarySplit\(m, _owned, \{ sourceName: \(u\) => soundFontSources\.sourceDisplayName\(userData, u\) \}\);\s*const label/.test(bulk) && /ownedElsewhere: !!\(m\.missingSplit/.test(bulk));
check('single import: split excludes its own source, flag on the result',
  /libraryHashes\(ud, \{ excludeSourceUuids: \[uuid\] \}\)/.test(main) && /compare\.applyLibrarySplit\(m, owned, \{ sourceName: \(u\) => soundFontSources\.sourceDisplayName\(ud, u\) \}\);/.test(main) && /ownedElsewhere: !!\(m\.missingSplit/.test(main));
check('both reviews leave the owned-elsewhere sentence as it is',
  /if \(m\.fullyOwned && !m\.ownedElsewhere && m\.matchName/.test(html) && /if \(m\.fullyOwned && !m\.ownedElsewhere\) _txt \+= m\.libHasMore/.test(html)
  && /note\.textContent = \(hit\.fullyOwned && !hit\.ownedElsewhere && hit\.matchName/.test(html));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
