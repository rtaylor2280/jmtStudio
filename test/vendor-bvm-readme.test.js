// The BVM Sabers row must match BOTH readme spellings this creator ships. [B-484]
//
// WHY A TEST FOR ONE TABLE ROW. The row is two regexes, and a plausible-looking
// tidy-up of either silently drops 3 of the 4 archives on disk back to "No creator
// matched" — with nothing failing and nothing to notice. The two facts worth
// pinning are exactly the two that are surprising:
//
//   1. TWO FILENAME SPELLINGS. The free fonts ship "Read Me.txt" (with a space),
//      the paid one ships "ReadMe.txt". The conventional /readme\.txt$/i used by
//      other rows in this table matches only the paid one.
//   2. THE NAME IS FOUND DIFFERENTLY ON FREE VS PAID. The paid readme states
//      authorship in prose ("By BVM-Sabers"); the FREE readmes never say it, and
//      are matched only via the creator's own Facebook handle ("BVMsabers"). A
//      content pattern written against the paid readme's wording matches none of
//      the 26 free fonts.
//
// The row EARNS its place beside the learned-vendor layer rather than
// duplicating it: learned matching only fires after the user has labelled this
// creator by hand, and is deliberately a suggestion. This row makes it a content
// match on a first-ever import. See test/learned-vendor-match.test.js.
//
// Strings below are real, read out of the four archives on 2026-10-07. The
// regexes are read off the live table rather than restated, so a change to the
// row is what this measures — not a copy of it.
'use strict';

const { vendors } = require('../soundFontVendors.js');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const row = vendors.find(v => v.id === 'bvmsabers');
ok('the bvmsabers row exists', !!row, 'no vendor with id "bvmsabers" in the table');
if (!row) { console.log(`\n${failed} failure(s)`); process.exit(1); }

ok('display name is the one he entered himself', row.displayName === 'BVM Sabers',
   `got ${JSON.stringify(row.displayName)} — his own export of this source records "BVM Sabers"`);
ok('free is the default for a 26-free / 1-paid catalogue', row.purchasedDefault === false,
   `got ${JSON.stringify(row.purchasedDefault)}`);
ok('the row carries a website', /^https?:\/\/.+/.test(row.website || ''),
   `got ${JSON.stringify(row.website)}`);

const pats = (row.patterns || []).filter(p => p.type === 'readmeContent');
ok('the row has a readmeContent pattern', pats.length >= 1);

// ── 1. filenames, as they really appear in the archives ────────────────────
const FILES_MATCH = [
  'Absorbed/Read Me.txt',                   // free
  'Alias/Read Me.txt',                      // free
  'Astral Projection/Read Me.txt',          // free
  'Whispering Crystal/ReadMe.txt',          // paid
];
for (const f of FILES_MATCH) {
  ok(`filename matched: ${JSON.stringify(f)}`,
     pats.some(p => p.fileMatch.test(f)),
     'this is a real readme path from one of the four archives');
}
// Must not drag in every text file in the archive — that is the expensive
// broad-scan shape, and this row is not meant to be one.
const FILES_SKIP = [
  'Absorbed/FREE Sound Font For Proffie.txt',
  'Absorbed/Absorbed/bladestyle.txt',
  'Alias/Alias/style.txt',
];
for (const f of FILES_SKIP) {
  ok(`filename NOT matched: ${JSON.stringify(f)}`,
     !pats.some(p => p.fileMatch.test(f)),
     'the row should read the readme, not every .txt in the archive');
}

// ── 2. content, quoted from the real readmes ───────────────────────────────
// The FREE readmes: the creator is named ONLY inside this URL.
const FREE_README = 'Find My Other Free Fonts on My Facebook Page https://www.facebook.com/BVMsabers';
// The PAID readme: authorship in prose, plus the site.
const PAID_README = 'Sound Font For Proffie "Whispering Crystal" By BVM-Sabers. oct 5, 2026\n'
  + 'You Can Find All My Other Fonts https://www.bvm-sabers.co.uk/';

ok('content matched in the FREE readme (handle only, no prose authorship)',
   pats.some(p => p.contentMatch.test(FREE_README)),
   'a pattern written only for "By BVM-Sabers" matches none of the 26 free fonts');
ok('content matched in the PAID readme',
   pats.some(p => p.contentMatch.test(PAID_README)));

// Negative: the row must not claim a readme that merely credits other creators.
// BVM credits NoSloppy and Fett263, so the reverse confusion is live too.
const OTHER_README = 'Special Thanks To Brian Conner a.k.a NoSloppy For His Sound Font Naming\n'
  + 'Converter and Fett263 For His Style Library. Proffie sound font.';
ok('content NOT matched by a readme that only credits other creators',
   !pats.some(p => p.contentMatch.test(OTHER_README)),
   'this text names NoSloppy and Fett263 and must not read as BVM');

console.log(failed ? `\n${failed} failure(s)` : '\nall passed');
process.exit(failed ? 1 : 0);
