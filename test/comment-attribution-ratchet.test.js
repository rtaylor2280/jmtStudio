// No person named, and nobody referred to, in a code comment. [B-308]
//
// WHY THIS IS A TEST AND NOT A RULE. The rule has existed for months and has been swept to
// zero four times: 84 instances swept 2026-07-31, ~85 again five weeks later, 15 more inside one
// change on 2026-09-26, and 700+ across the tree on 2026-10-09. Three of those sweeps were
// followed by a promise to remember. None held. What holds is a check that fails.
//
// WHY IT MATTERS, and it is not tidiness. A solo developer does not write their own name in
// their own source, so every instance is a tell that somebody else did. The repository is public
// and the community this ships to is hostile to the idea; the cost of a tell lands on the author,
// not on the tool. The same applies to a third party: a comment narrating who said what is a
// transcript, and a transcript is not documentation.
//
// ── WHAT A COMMENT KEEPS ──────────────────────────────────────────────────────
// Everything that makes the comment worth having. A measurement, a defect it prevents, a reason
// the obvious approach is wrong, a constraint that will bite, a date, and the quoted
// SPECIFICATION. Only the attributor goes.
//
//   before   // His rule: "it shouldn't matter when I click cancel. any cancel.. no orphan ever."
//   after    // The rule: a cancel at any phase leaves no orphan.
//
// THIS IS NOT A REASON TO WRITE FEWER COMMENTS. On 2026-10-09 three of them did real work in
// one day: a measurement of per-file open cost settled a design argument, a header naming the
// synchronous-loop defect class explained an app freeze, and a third asserted a precondition that
// was never implemented and cost an hour. Comments are a third of this codebase on purpose.
//
// ── WHAT THIS IS NOT ──────────────────────────────────────────────────────────
// It is BLIND to the other two tells in the same family: emphasis emoji, and over-explanation
// that narrates how something was found rather than why the code is as it is. Neither has a
// signature this could grep without a parser. A green run here says nothing about either.
// It only sees lines it can prove are comments: a line whose first non-space characters are
// `//`, `*` or `/*`. A continuation line inside a CSS or HTML comment block is invisible to it,
// which is how twelve survived the 2026-10-09 sweep until they were found by hand.
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// THE NAME IS LEGITIMATE IN EXACTLY ONE PLACE: a copyright or licence line, which is supposed
// to say who owns the work. Matched by the surrounding words rather than by file, so moving the
// licence does not quietly widen the exemption.
const LEGITIMATE = /copyright|all rights reserved|shall \w+ \w+ be liable/i;

// Attribution, not pronouns in general. "the user clicked" is ordinary engineering prose; "he
// clicked" is a transcript. The possessive forms carry the same freight as the name.
// CASE-INSENSITIVE, AND THAT WAS A HOLE IN THE FIRST VERSION. It matched `his ` only when
// followed by a lowercase letter, so every SHOUTED heading sailed through: 111 lines reading
// "HIS RULE", "ON HIS MACHINE", "HE FOUND OUT THE HARD WAY". The check reported zero and meant
// it, which is the worst kind of green. Found by accident while sampling an unrelated sweep.
// A scan that cannot see the loudest instances is scoped to the author's assumptions, not to the
// rule.
const PATTERNS = [
  /\bRyan\b/i,
  /\bhis [a-z]/i,
  /\bhim\b/i,
  /\bhe (said|asked|caught|reported|found|hit|saw|wanted|chose|ruled|is|was|had|has|then|never|clicked|pressed|cancelled|selected|deleted|added|tested|noticed|spotted|flagged|refused|pushed|corrected|confirmed|rejected|overruled|accepted|argued|proposed|specified|excluded|meant|named|reached|confirms|chooses)\b/i,
];

let files;
try {
  files = execSync('git ls-files', { cwd: ROOT, maxBuffer: 1 << 28 }).toString()
    .split('\n').map((s) => s.trim())
    .filter((f) => f && /\.(js|html)$/.test(f) && fs.existsSync(path.join(ROOT, f)));
} catch {
  // Not a git checkout (a packaged build, a zip). Nothing to assert against.
  console.log('  skip  not a git checkout, so the file list is unavailable');
  process.exit(0);
}

const hits = [];
let commentLines = 0;
for (const f of files) {
  if (f === path.relative(ROOT, __filename).replace(/\\/g, '/')) continue;  // this file lists them
  const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trim();
    const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
    if (!isComment) return;
    commentLines++;
    if (LEGITIMATE.test(line)) return;
    if (!PATTERNS.some((re) => re.test(line))) return;
    hits.push(`${f}:${i + 1}  ${t.slice(0, 100)}`);
  });
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}

// PROVE THE SCAN REACHED THE SOURCE BEFORE TRUSTING A CLEAN RESULT. Zero hits is the same
// output whether every comment was read and none matched, or the file list came back empty and
// nothing was read at all. Measured floors, well under the real figures (200 files, 43,000
// comment lines at the time of writing), so ordinary growth never trips them.
ok(`the scan reached the source: ${files.length} files, ${commentLines.toLocaleString()} comment lines`,
   files.length > 100 && commentLines > 10000,
   'too little was read for a clean result to mean anything - the file list or the comment test '
   + 'is broken, not the codebase');

// ZERO, not a baseline. Unlike the em-dash ratchet there is no judgement call here and nothing
// worth keeping, so the bar is the whole rule rather than "no worse than today".
ok(`no attribution in code comments: ${hits.length}`, hits.length === 0,
   `${hits.length} found. Keep the fact, the date and the quoted rule; drop who said it.\n       `
   + hits.slice(0, 12).join('\n       ')
   + (hits.length > 12 ? `\n       ... and ${hits.length - 12} more` : ''));

// THE CONTROL. A check whose failure case is unreachable is decoration, and this one scans
// for patterns that are now absent by construction - exactly the shape that passes forever
// whether or not it works. So it is pointed at a line it MUST reject before its clean run counts.
for (const planted of [
  '  // The rule: it only fires when he asked for it.',
  '  // ⭐ HIS RULE, and it collapses to a single test.',   // the uppercase hole, 111 lines of it
  '  // MEASURED ON HIS MACHINE, three runs each.',
  '  // Found by Ryan on a second run.',
]) {
  const t = planted.trim();
  const seen = t.startsWith('//') && !LEGITIMATE.test(planted)
    && PATTERNS.some((re) => re.test(planted));
  ok(`the detector rejects: ${t.slice(0, 44)}`, seen,
     'the scan cannot see its own test case, so a clean run above means nothing');
}
{
  const legit = " const CREDIT = '// Copyright 2026 Someone Name';";
  ok('and a copyright line is exempt', LEGITIMATE.test(legit),
     'the exemption is what keeps the licence text from failing this forever');
}

console.log(`\ncomment-attribution-ratchet: ${fail ? fail + ' FAILED, ' : 'all '}${pass} passed`);
process.exit(fail ? 1 : 0);
