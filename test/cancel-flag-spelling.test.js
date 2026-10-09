// The cancel flag is spelled `cancelled`. This is a RATCHET, not a blanket rule. [2026-10-07]
//
// ⭐⭐ WHY THE SPELLING IS A CORRECTNESS PROBLEM AND NOT TIDINESS. A result object carrying
// `canceled` read as `result.cancelled` is `undefined`, which is falsy, which reads as
// "not cancelled" - so the door reports SUCCESS after the user pressed Cancel. That is the
// identical failure already documented for `ok: true` (a cancel returns ok:true with the flag
// set, deliberately, so the user's own click is not a red error), which bit three export doors:
// quick export said *Exported as "Techno_2"* after a cancel, common-as-zip said nothing, and
// tracks committed a sync manifest describing files it never wrote. The spelling split is a
// SECOND, independent route to the same bug, and it fails open and silent.
//
// ⚠️⚠️ WHY THIS ASSERTS THE RIGHT SPELLING RATHER THAN MERELY THAT THE TWO SIDES AGREE.
// His call, 2026-10-07: *"if you're going to write a rule to test against, then it shouldn't just
// be do they match. It should be, is it the right one, the new one."* A match-test blesses two
// wrong-but-agreeing sites and freezes the split forever; this one fails on every NEW old-spelling
// site, so the old ones drain away as their files are touched for other reasons.
//
// ⚠️ WHY A RATCHET AND NOT A HARD ZERO. There are 69 old-spelling sites today across doors Ryan has
// already tested and signed off. Converting them is real work with a real retest and is filed
// separately for 1.8.1 - see the backlog. Until then the number may only SHRINK. A file that gains
// one fails here, named, immediately.
//
// ⭐ `cancelled` is the right one because it is what the newer modules already use - the gate,
// backup, export copy, bulk import, proffieos - and what every user-facing string says
// ("Import cancelled", "Merge cancelled").
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const root = path.join(__dirname, '..');

// Comments are stripped first, for the same reason the door register strips them: a `//` line
// naming a flag is prose about the code, not a site. Counting prose is how a stale comment becomes
// a fact.
const strip = (src) => src.replace(/^\s*\/\/.*$/gm, '');

// ── Only the CROSS-BOUNDARY flag. A local variable named `_scanCanceled` never crosses an IPC
// boundary and cannot cause the silent bug, so renaming those would be churn with no safety in it.
const WRITE_OLD = /\bcanceled\s*:/g;      // written into a returned object
const READ_OLD  = /\.canceled\b/g;        // read off a result

// ⚠️⚠️ THE CONTROL, AND IT RUNS BEFORE ANYTHING IS REPORTED. A scanner that returns zero looks
// exactly like a codebase that is clean. If the matcher cannot see a known positive, the baseline
// below is meaningless and this file must not pass.
{
  const sample = 'return { ok: true, canceled: true };\nif (r.canceled) return;\n';
  const stripped = strip('// canceled: true in a comment must NOT count\n' + sample);
  const writes = (stripped.match(WRITE_OLD) || []).length;
  const reads  = (stripped.match(READ_OLD) || []).length;
  ok('CONTROL: the matcher sees a known old-spelling write', writes === 1, `got ${writes}`);
  ok('CONTROL: the matcher sees a known old-spelling read', reads === 1, `got ${reads}`);
  ok('CONTROL: a commented-out occurrence is NOT counted',
     !/canceled: true in a comment/.test(stripped));
}

// ── The baseline. MEASURED 2026-10-07. These numbers may only go DOWN. ────────
//
// ⚠️ PER FILE, not a single total, so a file losing one while another gains one cannot cancel out
// and hide a new site. That is the same reason the door register states counts per door.
const BASELINE = {
  'main.js':                    32,
  'renderer/index.html':        26,
  'soundFontEntries.js':         7,
  'soundFontCommon.js':          3,
  'renderer/versionsPanel.js':   1,
};

// Files that must stay at zero: everything else that carries the flag. A new old-spelling site in
// a module that is already clean is the regression this is really guarding.
const MUST_BE_ZERO = [
  'preload.js', 'proffieos.js', 'soundFontBulkImport.js', 'soundFontBackup.js',
  'sfExportCopy.js', 'bulkImportGate.js', 'renderer/buildPanel.js',
];

const countIn = (rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  const src = strip(fs.readFileSync(abs, 'utf8'));
  return (src.match(WRITE_OLD) || []).length + (src.match(READ_OLD) || []).length;
};

console.log('');
let total = 0;
for (const [rel, allowed] of Object.entries(BASELINE)) {
  const n = countIn(rel);
  if (n === null) { ok(`${rel} exists`, false, 'file missing - re-anchor the baseline'); continue; }
  total += n;
  ok(`${rel}: old-spelling sites ${n} (baseline ${allowed}, may only shrink)`,
     n <= allowed,
     `${n - allowed} NEW site(s). The cancel flag is spelled \`cancelled\`. A result carrying `
     + `\`canceled\` read as \`.cancelled\` is undefined, so the door reports success after a cancel.`);
  if (n < allowed) {
    console.log(`       ⬇ ${allowed - n} converted since the baseline - lower the number in this file.`);
  }
}

for (const rel of MUST_BE_ZERO) {
  const n = countIn(rel);
  if (n === null) continue;
  ok(`${rel}: stays clean (0 old-spelling sites)`, n === 0,
     `${n} old-spelling site(s) appeared in a module that was already on \`cancelled\`.`);
}

console.log(`\n  (baseline total ${Object.values(BASELINE).reduce((a, b) => a + b, 0)}, `
  + `now ${total}. Converting these is filed for 1.8.1.)`);

console.log(failed ? `\n${failed} failure(s)` : '\nall passed');
process.exit(failed ? 1 : 0);
