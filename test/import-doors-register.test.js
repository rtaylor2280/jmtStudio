// The import door register must describe the app that exists.  [B-424, 2026-10-04]
//
// WHY A TEST AND NOT JUST A DOCUMENT. `local/import-doors.md` is the map of every way content
// gets INTO the library. The export side needed exactly this and the reason is on the record: its
// count was wrong three times, and every correction came from USING the app rather than from
// anyone reading code. The import count has the same history - eight doors on 2026-10-01, thirteen
// on 2026-10-04, twenty-nine once routes were separated from doors.
//
// A BEHAVIOUR SWEEP IS NOT A REGISTER. 2026-10-04 swept the check and the eject across every
// door by hand. That sweep rots the moment someone adds a door; this is what fails when they do.
//
// WHAT THIS CAN AND CANNOT SEE. It reconciles COUNTS and HANDLER NAMES. It cannot tell whether a
// door's eject is on the right surface or whether its ending matches the unit/files rule - those
// are judgements, and the register records them in prose for a human. A name-shaped detector also
// misses a door whose name does not admit what it does: `versions:copyProp` slipped past the
// handler sweep on 2026-09-29 because "copy" is not "import". That limit travels with the result.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const root = path.join(__dirname, '..');
const MAP = path.join(root, 'local', 'import-doors.md');

// local/ IS GITIGNORED, so a fresh clone genuinely has no map. Skip rather than fail - a check
// that cannot pass on a clean checkout is a check whoever hits it deletes.
if (!fs.existsSync(MAP)) {
  console.log('  skip  local/import-doors.md not present (gitignored working doc)');
  console.log('\nimport-doors-register: skipped');
  process.exit(0);
}

const mapText = fs.readFileSync(MAP, 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const vpanel = fs.readFileSync(path.join(root, 'renderer', 'versionsPanel.js'), 'utf8');

// ── 1. The decisions have to still be in the file ─────────────────────
//
// NOT DECORATION. The register exists to hold the rules the doors were built against; a copy
// that keeps the table and loses the reasoning is how the next person re-derives a decision that
// was already made and lands somewhere different.
for (const phrase of [
  'if it could be an SD card, it is in scope',
  'a whole unit gets a summary; individual files get a toast',
  'rides the ending that is already there',
]) {
  ok(`the register still states: "${phrase}"`,
     mapText.toLowerCase().includes(phrase.toLowerCase()),
     'a decision was dropped from the register - put it back rather than deleting the rule');
}

// ── 2. Call-site counts, reconciled against the register ──────────────
//
// THE COUNTS ARE THE POINT, because the count is what has been wrong every single time. These
// fail when a door gains or loses its check or its eject without the register moving with it.
// Comments are stripped first. A `//` line naming the helper is prose about the code, not a call
// site, and counting it is the same error as reading a stale comment as a fact - which this project
// has made four times. Anchored on `(` so a definition or a `window.x = x` export is not a call.
const strip = (src) => src.replace(/^\s*\/\/.*$/gm, '');
const code = strip(html) + '\n' + strip(vpanel);

const countOf = (re) => (code.match(re) || []).length;
// ONLY THE DEFINITION IS SUBTRACTED, NOT THE `window.x = x` EXPORT. The first cut of this
// subtracted both and reported 8 where the code has 9 - because an export line has no `(` after the
// name, so it was never in the count to begin with. Subtracting something the counter never saw is
// the same error as a control that passes for the wrong reason, and it under-reported silently.
const CHECK_CALLS = countOf(/(?:window\.)?_sfWarnSlowImport\s*\(/g)
  - countOf(/async function _sfWarnSlowImport\s*\(/g);
const EJECT_CALLS = countOf(/(?:window\.)?_sfOfferEjectInToast\s*\(/g)
  - countOf(/const _sfOfferEjectInToast\s*=\s*async/g);

// THE CONTROL COMES FIRST, AND IT REFUSES TO LET THE NUMBERS BE TRUSTED WITHOUT IT. A counter
// that returns zero looks identical to a counter that is broken, and this project has shipped a
// scan reporting "no space check anywhere" that was simply failing to look. If the known-positive
// is not found, the counts below mean nothing.
ok('the counter can see a known call site',
   /_sfWarnSlowImport\s*\(\s*runPlan\.rootDir/.test(code),
   'the bulk import check is gone or renamed - re-anchor this before reading any count below');
ok('the eject counter can see a known call site',
   /_sfOfferEjectInToast\s*\(\s*closeoutSrc\.sourcePath/.test(code),
   'the font close-out eject is gone or renamed - re-anchor before reading any count below');

const stated = (label) => {
  const m = new RegExp(`<!--\\s*${label}\\s*=\\s*(\\d+)\\s*-->`).exec(mapText);
  return m ? Number(m[1]) : null;
};
const statedCheck = stated('CHECK_CALL_SITES');
const statedEject = stated('EJECT_CALL_SITES');

ok('the register states a check call-site count', statedCheck !== null,
   'add `<!-- CHECK_CALL_SITES = n -->` to local/import-doors.md');
ok('the register states an eject call-site count', statedEject !== null,
   'add `<!-- EJECT_CALL_SITES = n -->` to local/import-doors.md');

if (statedCheck !== null) {
  ok(`check call sites match the register (code ${CHECK_CALLS}, register ${statedCheck})`,
     CHECK_CALLS === statedCheck,
     'a door gained or lost the slow-source check. Update the table AND this number together - '
     + 'and if a door gained one, say which door it is, not just the count.');
}
if (statedEject !== null) {
  ok(`eject call sites match the register (code ${EJECT_CALLS}, register ${statedEject})`,
     EJECT_CALLS === statedEject,
     'a door gained or lost its eject offer. Update the table AND this number together.');
}

// ── 3. Every inward handler the other test knows about is in the map ──
//
// Reuses `import-door-map.test.js`'s own INWARD list rather than keeping a second copy - two
// lists of the same thing is the drift this pair exists to prevent.
// COMMENTS STRIPPED FIRST, AND THIS IS NOT TIDINESS. The first cut matched the raw source
// with a non-greedy `[...]`, and the list contains a comment mentioning `[B-434]` - so the match
// ended at that bracket and the check reported "1 checked" while looking like it had passed over
// the whole list. A truncated instrument that still prints a number is the shape this project has
// been bitten by repeatedly; the count below is printed so a shrinking list is visible.
const doorMapSrc = strip(fs.readFileSync(path.join(__dirname, 'import-door-map.test.js'), 'utf8'));
const inwardBlock = /const INWARD\s*=\s*\[([\s\S]*?)\n\]/.exec(doorMapSrc);
ok('the INWARD list was located in import-door-map.test.js', !!inwardBlock,
   'that list was renamed - re-anchor this, do not drop the check');
if (inwardBlock) {
  const handlers = [...inwardBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const missing = handlers.filter((h) => !mapText.includes(h));
  // A SHRINKING LIST MUST FAIL TOO. If the anchor above ever truncates again, `handlers`
  // goes small and every name happens to be present - a green run that checked almost nothing.
  ok(`the INWARD list parsed to a plausible size (${handlers.length})`, handlers.length >= 10,
     'the list parsed to very few entries - the anchor truncated, so the result below means nothing');
  ok(`every inward handler appears in the register (${handlers.length} checked)`,
     missing.length === 0,
     missing.length
       ? `not in local/import-doors.md: ${missing.join(', ')}`
       : '');
}

console.log(failed ? `\n${failed} FAILED` : '\nimport-doors-register: all passing');
process.exit(failed ? 1 : 0);
