// Creators the user already labelled are matched, but only as a SUGGESTION. [B-484]
//
// WHAT THIS MECHANISM IS. The curated vendor table is a seed and cannot know a
// creator it was never given. Library learning existed for TYPING (the renderer
// merges library creators into the Creator datalist) but never for MATCHING, so a
// second font from a creator labelled by hand minutes earlier still came up "No
// creator matched". This layer closes that, last, after every curated pattern and
// the generic "by NAME" extractor have failed.
//
// THE THREE THINGS THAT MAKE IT SAFE ARE THE THREE THINGS A TIDY-UP WOULD
// REMOVE, so each is asserted here:
//
//   1. SUGGESTION, NOT AUTO-FILL. A learned hit returns confidence 'structural',
//      which the renderer renders as "Suggested: <name>" with an Apply link. A
//      wrong auto-filled creator is stored, propagates to every font from that
//      source, and the user has no reason to doubt it.
//   2. TWO MATCHES SUGGEST NOTHING. One real readme in this corpus credits
//      NoSloppy, Fett263 AND Brian Conner in its Special Thanks - so a readme
//      naming several known creators is the normal case, not the exotic one.
//   3. A SHORT NAME IS REJECTED. Matching compares text with punctuation and
//      spaces stripped, so "BVM Sabers" can find "BVMsabers" inside a URL - which
//      also means a short name matches inside ordinary words. The real library
//      this was built against contains a creator named "TEST", and sound font
//      readmes say "tested on real hardware" constantly.
//
// Readme text below is quoted from real archives; creator names are the ones
// actually present in the real library.
'use strict';

const V = require('../soundFontVendors.js');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// THE CREATORS BELOW ARE DELIBERATELY NOT IN THE CURATED TABLE, AND THE
// FIRST VERSION OF THIS FILE GOT THAT WRONG. It used the real "BVM Sabers",
// which worked only while that creator happened to be absent from the table; the
// moment a curated row for them was added, the table matched first and every
// assertion about the LEARNED layer failed. A test for the last-resort layer must
// not depend on who the earlier layers happen to know — so these names are
// invented, and that independence is asserted below rather than assumed.
//
// The readme SHAPES, however, are real: a creator named only inside a URL with no
// spaces, and authorship stated mid-line. Those are the two shapes measured in
// real archives, and they are what the layer has to cope with.
const V_ONE = 'Hollow Forge Audio';
const V_TWO = 'Nine Bells Soundworks';

// ── harvesting ─────────────────────────────────────────────────────────────
const SOURCES = [
  { uuid: 'a', meta: { vendor: V_ONE, vendorWebsite: 'https://hollowforgeaudio.example' } },
  { uuid: 'b', meta: { vendor: V_TWO, vendorWebsite: 'https://ninebells.example' } },
  { uuid: 'c', meta: { vendor: 'TEST' } },           // really in his library
  { uuid: 'd', meta: { vendor: 'Unknown' } },        // UI placeholder
  { uuid: 'e', meta: { vendor: V_ONE } },            // duplicate, no site
  { uuid: 'f', meta: {} },                           // never labelled
];
const learned = V.learnedVendorsFrom(SOURCES);
const names = learned.map(v => v.name);

// PRECONDITION: no curated row may claim these names, or everything below
// would be measuring an EARLIER layer. This is the check whose absence broke the
// first version of this file — it used a real creator, passed while that creator
// happened to be missing from the table, and failed the moment a curated row for
// them was added.
for (const n of [V_ONE, V_TWO]) {
  const claimed = V.vendors.some(v => String(v.displayName).toLowerCase() === n.toLowerCase());
  ok(`PRECONDITION: ${JSON.stringify(n)} is not in the curated table`, !claimed,
     'a curated row for this creator matches first, so this file would test the wrong layer');
}

ok('harvests distinct labelled creators', names.includes(V_ONE) && names.includes(V_TWO),
   `got ${JSON.stringify(names)}`);
ok('deduplicates the same creator', names.filter(n => n === V_ONE).length === 1);
ok('keeps the website from whichever copy had one',
   (learned.find(v => v.name === V_ONE) || {}).website === 'https://hollowforgeaudio.example');
ok('drops the too-short name "TEST"', !names.includes('TEST'),
   '"TEST" would match any readme containing the word "tested"');
ok('drops the "Unknown" placeholder', !names.includes('Unknown'));
ok('ignores sources with no creator', learned.length === 2, `got ${learned.length}: ${JSON.stringify(names)}`);

// ── matching ───────────────────────────────────────────────────────────────
// Minimal source shaped like the real one: listAll + readFile.
const srcOf = (files) => ({
  meta: { originalName: 'x.zip' },
  listAll: async () => Object.keys(files).map(f => ({ fileName: f, isDir: false, size: files[f].length })),
  readFile: async (f) => Buffer.from(files[f], 'utf8'),
});

(async () => {
  // The real FREE readme SHAPE: the creator is named ONLY inside a URL, unspaced.
  const freeReadme = 'Thank You For Downloading\n\nFind My Other Free Fonts on My Facebook '
    + 'Page https://www.facebook.com/HollowForgeAudio\n';
  let r = await V.detectVendor(srcOf({ 'Fontname/Read Me.txt': freeReadme }), { learned });
  ok('matches a labelled creator written WITHOUT spaces in a URL', r.vendor === V_ONE,
     `got ${JSON.stringify(r.vendor)} - ${JSON.stringify(V_ONE)} must find "HollowForgeAudio"`);
  ok('a learned hit is a SUGGESTION, not an auto-fill', r.confidence === 'structural',
     `got ${JSON.stringify(r.confidence)} - 'content' would silently fill the field`);
  ok('reports where it matched', !!r.matchedFile);
  ok('is labelled as a learned match', r.matchType === 'learnedVendor', `got ${r.matchType}`);

  // Two known creators in one document: suggest nothing.
  //
  // FIXTURE PRECONDITION, AND THE FIRST VERSION OF THIS TEST GOT IT WRONG.
  // A line that STARTS "Sound font by X" is matched by the pre-existing generic
  // extractor (_CREATOR_LINE_RX is anchored at line start and lists "Sound Font
  // By" as a lead-in), so it returned before the learned layer ran and the
  // ambiguity branch was never exercised - a fixture impersonating a pass.
  // The wording below is the REAL shape: authorship appears MID-line, which is
  // exactly why the generic extractor does not fire on this creator's readmes.
  // The precondition is asserted rather than assumed.
  const twoNames = 'Sound Font For Proffie "Night Office" By Hollow-Forge-Audio. oct 5, 2026\n\n'
    + 'Special Thanks To Nine Bells Soundworks for the inspiration.\n';
  const preflight = await V.detectVendor(srcOf({ 'Read Me.txt': twoNames }), {});
  ok('FIXTURE PRECONDITION: the generic extractor does not claim this text',
     !preflight.vendor,
     `the generic extractor returned ${JSON.stringify(preflight.vendor)}, so the `
     + 'ambiguity branch below would never run and would pass vacuously');
  r = await V.detectVendor(srcOf({ 'Read Me.txt': twoNames }), { learned });
  ok('two learned creators in one readme suggests NEITHER', !r.vendor,
     `got ${JSON.stringify(r.vendor)} - guessing here misattributes somebody's work`);
  ok('and says why rather than looking like nothing was found',
     r.matchType === 'learnedVendorAmbiguous' && Array.isArray(r.ambiguousVendors)
       && r.ambiguousVendors.length === 2,
     `got ${JSON.stringify(r.matchType)} / ${JSON.stringify(r.ambiguousVendors)}`);

  // A readme naming nobody known stays unmatched.
  r = await V.detectVendor(srcOf({ 'Read Me.txt': 'A font by somebody else entirely.\n' }), { learned });
  ok('an unknown creator still returns no match', !r.vendor, `got ${JSON.stringify(r.vendor)}`);

  // Non-document files are not scanned for creator names.
  r = await V.detectVendor(srcOf({ 'Fontname/HollowForgeAudio.wav': 'x' }), { learned });
  ok('does not harvest creators from audio filenames', !r.vendor, `got ${JSON.stringify(r.vendor)}`);

  // With no learned list the behaviour is exactly as before.
  r = await V.detectVendor(srcOf({ 'Fontname/Read Me.txt': freeReadme }), {});
  ok('no learned list -> unchanged (no match)', !r.vendor, `got ${JSON.stringify(r.vendor)}`);
  r = await V.detectVendor(srcOf({ 'Fontname/Read Me.txt': freeReadme }));
  ok('no options at all -> does not throw and does not match', !r.vendor);

  console.log(failed ? `\n${failed} failure(s)` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
