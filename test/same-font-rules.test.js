// What counts as THE SAME FONT on import, what is ticked by default, and what is compared. [B-643]
//
//   1. Same font, two ways in: have_it (the copy is almost entirely inside the library font -
//      nearly identical, or one that LOST files) or version (at least 70% of the library font is in
//      the copy - one that ADDS files). Nothing else is a match: no close-match tier.
//   2. A trimmed copy is still the same font; a stock-sound font is not Depa_Bilaba.
//   3. Settings (.ini) and display (.bmp, .scr) files are compared; OS clutter never is.
//   4. The default tick follows whether anything on the card is new to the library.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const compare = require(path.join(ROOT, 'soundFontCompare.js'));
const sets = (core, cust = [], extra = []) => {
  const c = new Set(core);
  return { core: c, customizable: new Set(cust), extra: new Set(extra), coreCount: c.size,
    customizableCount: cust.length, coreSignature: compare.signatureOf(c) };
};
const range = (p, a, b) => Array.from({ length: b - a }, (_, i) => `${p}${a + i}`);

console.log('1. the two ways in');
const terra = { name: 'Terra', sets: sets(range('t', 0, 100)), sourceUuid: 's1' };
let m = compare.matchAgainstLibrary(sets(range('t', 0, 40)), [terra]);
check('a copy trimmed to 40 of 100 sounds is Terra (have_it): it lost files, it is still Terra',
  m.bestMatch === 'Terra' && m.verdict === 'have_it', JSON.stringify({ v: m.verdict, c: m.coreContainment, cov: m.libCoverage }));
m = compare.matchAgainstLibrary(sets([...range('t', 0, 75), ...range('x', 0, 30)]), [terra]);
check('a copy with 75 of Terra\'s 100 plus 30 of its own is a version of Terra',
  m.bestMatch === 'Terra' && m.verdict === 'version', JSON.stringify({ v: m.verdict, cov: m.libCoverage }));
m = compare.matchAgainstLibrary(sets([...range('t', 0, 60), ...range('x', 0, 30)]), [terra]);
check('60 of Terra\'s 100 is under the 70% line and nowhere near inside it: a new font', m.verdict === 'new', m.verdict);

console.log('2. the stock-sound false match is gone');
const depa = { name: 'Depa_Bilaba', sets: sets([...range('stock', 0, 40), ...range('d', 0, 90)]) };
const yoda = sets([...range('stock', 0, 40), ...range('y', 0, 10)]);
m = compare.matchAgainstLibrary(yoda, [depa]);
check('Yoda sharing 40 stock sounds with Depa_Bilaba is a new font (80% inside, 31% coverage)',
  m.verdict === 'new' && compare.verdictLabel(m) === null, JSON.stringify({ v: m.verdict, c: m.coreContainment, cov: m.libCoverage }));
check('the close-match tier is gone from the thresholds',
  !('variantContainment' in compare.DEFAULT_THRESHOLDS) && compare.DEFAULT_THRESHOLDS.versionCoverage === 0.70);
check('a qualifying font is picked over one that only shares more',
  compare.matchAgainstLibrary(sets(range('t', 0, 40)), [depa, terra]).bestMatch === 'Terra');

console.log('3. what is compared');
const cls = compare.classifyRelPath;
check('desktop.ini is clutter wherever it sits, quote/ included',
  cls('desktop.ini') === 'ignore' && cls('quote/desktop.ini') === 'ignore' && cls('Thumbs.db') === 'ignore' && cls('._hum.wav') === 'ignore');
check('config.ini, smoothsw.ini, .bmp and .scr are compared as settings/display files',
  cls('config.ini') === 'extra' && cls('smoothsw.ini') === 'extra' && cls('font.bmp') === 'extra' && cls('boot/anim.scr') === 'extra');
check('sounds sort as before', cls('hum.wav') === 'core' && cls('quote/q1.wav') === 'customizable' && cls('tracks/a.wav') === 'customizable');
check('docs stay out', cls('readme.txt') === 'ignore');
m = compare.matchAgainstLibrary(sets(range('t', 0, 100), [], ['cfgCard']), [{ name: 'Terra', sets: sets(range('t', 0, 100), [], ['cfgLib']) }]);
check('a different config.ini is something new, and says so',
  m.missing.extra.length === 1 && !compare.isFullyOwned(m) && /1 settings or display file/.test(compare.verdictLabel(compare.applyLibrarySplit(m, new Map()))),
  compare.verdictLabel(m));
const both = compare.setsFromRecords([{ relPath: 'hum.wav', fileHash: 'a' }, { relPath: 'config.ini', fileHash: 'b' }, { relPath: 'quote/desktop.ini', fileHash: 'c' }]);
check('setsFromRecords fills the extra set and drops clutter', both.extra.has('b') && !both.customizable.has('c') && both.core.has('a'));
const src = fs.readFileSync(path.join(ROOT, 'soundFontCompare.js'), 'utf8');
check('buildFontSetsFromDir (the card import\'s builder) keeps extras apart from quotes',
  /else if \(cls === 'extra'\) extra\.add\(h\);/.test(src) && (src.match(/return \{\r?\n    core,\r?\n    customizable,\r?\n    extra,/g) || []).length === 2);

console.log('4. the default tick');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const bulk = fs.readFileSync(path.join(ROOT, 'soundFontBulkImport.js'), 'utf8');
check('no close-match bucket, flag or skip anywhere',
  !/closeCount|r\.closeMatch|_closeMatch|Close match to a font you have \(skipped\)/.test(bulk + html));
check('the guided review unticks only what is owned (nothing new to the library)',
  /if \(m\.fullyOwned && row\.checkbox && row\.checkbox\.checked/.test(html));
check('quick import skips only what is owned', /const fresh = runPlan\.sources\.filter\(s => s\._prepared && !s\._corrupt && !s\._owned\s*\n/.test(html));
check('the single review unticks only what is owned (and not on a re-import)', /if \(hit\.fullyOwned && !_sfImport\.reimport && row\.dataset\.already !== '1'/.test(html));
check('quick import flags Needs review: close match only for the same font, not a raw 75% share',
  /\} else if \(\(m\.verdict === 'have_it' \|\| m\.verdict === 'version'\) && !\(src\._enrich && src\._enrich\.catalogueName\)\) \{/.test(bulk)
  && !/m\.coreContainment >= compare\.VARIANT_DISPLAY_MIN && !\(src\._enrich/.test(bulk));
check('the card review never shows two "Unknown" creator groups: a creator named Unknown is no creator',
  /const v = \/\^unknown\$\/i\.test\(_vRaw\) \? '' : _vRaw;/.test(html));

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
