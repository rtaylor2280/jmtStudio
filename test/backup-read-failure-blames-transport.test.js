// A failed read over the board must not be reported as a damaged backup.  [B-479]
//
// A control is what makes this a defect rather than a guess: the same bytes on the same card
// restored cleanly through a reader and came back "Bad archive" through the saber. The message
// accuses the one file a person cannot afford to distrust.
//
// Two halves are checked here and they fail in opposite directions, which is why both are needed:
//   - too narrow, and a good backup is still called damaged (the reported defect)
//   - too wide, and a genuinely corrupt file or a non-backup gets excused as "probably the cable",
//     which sends someone to a reader to re-read a file that will never load
//
// This EXECUTES the real predicate lifted out of renderer/index.html rather than grepping for it.
// The renderer has no module boundary, so a grep can only prove a call is PRESENT, never that it
// is REACHED or that it answers correctly - which is exactly how [B-478] stayed broken through
// nine passing checks.
//
// Run: node test/backup-read-failure-blames-transport.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

// ── lift the predicate out of the page ──────────────────────────────────────
function lift(decl) {
  const s = H.indexOf(decl);
  if (s < 0) throw new Error(`not found in index.html: ${decl}`);
  let depth = 0, j = H.indexOf('{', H.indexOf(') {', s));
  for (; j < H.length; j++) {
    const c = H[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return H.slice(s, j);
}
const src = lift('function _sfReadFailureIsLikelyTransport');
ok('the predicate was lifted out of the page', src.length > 80, `${src.length} chars`);

// eslint-disable-next-line no-new-func
const isTransport = new Function(`${src}; return _sfReadFailureIsLikelyTransport;`)();

// ── the reported defect ─────────────────────────────────────────────────────
ok('a zip read failure on a board card blames the transport',
   isTransport('unreadable', true) === true,
   'this is the "Bad archive" that accused a provably good backup');
ok('and so does a manifest that would not parse off the same card',
   isTransport('bad-manifest', true) === true,
   'both codes mean the bytes did not read as a zip');

// ── too wide: the ways this fix could itself mislead ────────────────────────
ok('a file that is not a backup is NOT excused by the transport',
   isTransport('not-a-backup', true) === false,
   'content verdict - equally true through a reader, so a card reader will not help');
ok('a newer-schema backup is NOT excused by the transport',
   isTransport('newer-schema', true) === false);
ok('a missing file is NOT excused by the transport',
   isTransport('missing-file', true) === false);

// ── the transport argument has to be a definite yes ─────────────────────────
ok('a read failure from a normal disk keeps the plain message',
   isTransport('unreadable', false) === false,
   'nothing about a local read failure implicates a cable');
ok('an UNESTABLISHED transport keeps the plain message',
   isTransport('unreadable', null) === false,
   'null means nobody asked; with no answer we do not get to blame the wire either');
ok('and an undefined verdict is treated the same as unestablished',
   isTransport('unreadable', undefined) === false);
ok('a truthy non-true verdict does not slip through',
   isTransport('unreadable', 'yes') === false,
   'the probe returns true/false/null; a string here would mean the caller changed shape');

// ── the branch is actually wired to the dialog ──────────────────────────────
// The predicate being correct is worth nothing if the import handler never consults it. Static,
// and named as static: this asserts the call EXISTS, which is the one thing a page-level grep can
// honestly claim. The dialog copy below is what makes a reached branch visible on screen.
{
  const call = /_sfReadFailureIsLikelyTransport\(\s*reason\s*,\s*window\._sfDestIdentity\.knownIsBoardCard\(\s*zipPath\s*\)\s*\)/.test(H);
  ok('the import handler consults the predicate with the cached verdict', call,
     'a fresh isBoardCard() call here would cost a ~1,900 ms spawn for a fact already held');
  ok('and the card-transport dialog copy exists to be shown',
     H.includes('Could not read the backup from this card'));
  // Matched as one contiguous phrase, NOT as a pattern spanning the rest of the sentence: the
  // copy is built from concatenated string literals, so any re-wrap puts a quote and a newline
  // in the middle of a sentence and a span-matching regex fails on formatting alone. That is a
  // test that cries wolf, which is worse than one assertion less.
  ok('the copy points at a card reader rather than at the file',
     H.includes('Put the card in a card reader'),
     'the next action is the whole point of this message');
  ok('and it does not claim the size of the file, which it never checks',
     !H.includes('on a file this large'),
     'it fires on a 50-byte file just as readily as on a 576 MB one');
  ok('and it does not claim the backup is fine, only that this is not evidence it is bad',
     H.includes('This does not mean your backup is bad'),
     'we know his file was good; a user has no such control, so do not overclaim');
}

console.log(failed ? `\n${failed} FAILED` : '\nbackup-read-failure-blames-transport: all passing');
process.exit(failed ? 1 : 0);
