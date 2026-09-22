// Replace mode must never leave the user with neither font.  [B-005 item 4]
//
// ⚠️⚠️ THIS IS A DATA-LOSS TEST, SO IT RUNS ON REAL FILES. Replace used to `rm` the existing
// font tree and THEN start copying, so a cancel or an error mid-copy left the destination with
// a half-written font and no original - the same ordering that destroyed 708 MB on 2026-09-02.
// The rule that came out of that incident is the one being asserted here: move the original
// aside, put the new one in place, and only then delete the original. At no instant may the
// destination be empty while the replacement is still a hope.
//
// ⭐ The naming (2026-09-20): ORIGINAL.<name> is the parked real font and must never be
// deleted by a user tidying up; DELETE.<name> is disposable. The names carry the instruction
// because a person browsing the card is the one who has to tell them apart.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const SRC = fs.readFileSync(path.join(__dirname, '..', 'soundFontEntries.js'), 'utf8');

// Narrow to exportEntryToFolder so a match somewhere else in a 5k-line module cannot pass
// for a match here - the "grep the whole file" mistake this suite has already made twice.
//
// ⚠️⚠️ ANCHORED ON TWO MARKERS, NOT A CHARACTER COUNT. The first cut of this sliced 9,000
// chars forward and reported the success-path disposal MISSING - it sits about 150 lines
// down, past the window. That is the third fixed-width-slice error in this codebase's tests
// in two days: a window chosen by eye is a sample, and a negative result drawn from a sample
// is unfalsifiable by the very evidence that produced it. Anchor on text that must exist.
const START = 'let asideDir = null;';
const END   = 'Best-effort cleanup of a partial copy on failure';
const i = SRC.indexOf(START);
const j = SRC.indexOf(END, i);
const fn = (i === -1 || j === -1) ? '' : SRC.slice(i, j);
ok('found the replace path to examine (both anchors present)', fn.length > 0,
   'an anchor moved - fix the anchor rather than widening a guess');

// ── Ordering: aside BEFORE copy, delete only AFTER ───────────────────
ok('⚠️⚠️ the original is RENAMED aside, not deleted, before the copy',
   /rename\(path\.join\(destDir, targetName\), asideDir\)/.test(fn),
   'an rm before the write lands is the 2026-09-02 bug exactly');
ok('no rm of the live font before the copy starts',
   !/rm\(path\.join\(destDir, targetName\)/.test(fn),
   'that call emptied the destination while the replacement was still a hope');
ok('the aside uses the ORIGINAL. prefix',
   /`ORIGINAL\.\$\{targetName\}`/.test(fn), 'his naming - a folder a user must not delete');
ok('the junk uses the DELETE. prefix',
   /`DELETE\.\$\{targetName\}`/.test(fn), 'his naming - a folder a user may safely delete');

// ── The cancel path restores ─────────────────────────────────────────
ok('⚠️ cancel renames the partial aside and puts the original back',
   /out\.restored = true/.test(fn) && /rename\(asideDir, targetDir\)/.test(fn),
   'a cancel that only removed the partial would leave the user with no font at all');
ok('cancel reports leftovers it could not clear',
   /out\.leftovers\.push/.test(fn),
   'a whole font sitting under ORIGINAL.<name> must be named, not silently left');

// ── The failure path restores too ────────────────────────────────────
ok('⚠️ a non-cancel failure also restores the original',
   /restoredOriginal = true/.test(fn),
   'a full card mid-copy would otherwise park the font under ORIGINAL.<name> forever');

// ── THE ONE THAT WOULD HAVE DESTROYED FONTS ──────────────────────────
//
// ⚠️⚠️ The outer catch clears a partial with rmSync(targetDir). That was safe while targetDir
// could only ever hold OUR half-written copy. The restore puts the USER'S font at that exact
// path, so the same line became a delete of the thing the restore had just saved. A cleanup
// stops being safe when the thing it cleans up changes identity.
ok('⚠️⚠️ the outer catch will NOT rm a restored original',
   /if \(!restoredOriginal\) \{\s*try \{ fs\.rmSync\(targetDir/.test(SRC),
   'unguarded, the failure path restores the font and the next line deletes it');

// ── Success disposes of the aside ────────────────────────────────────
ok('a successful replace disposes of the superseded copy',
   /rename\(asideDir, junk\)/.test(fn),
   'otherwise a replace silently leaves two copies on the card');
ok('and reports it when disposal failed rather than erroring',
   /replacedLeftover/.test(SRC),
   'the export succeeded - a leftover folder is untidy, not a failure');

// ── A stale aside from a crashed run must not jam the next attempt ───
ok('a leftover ORIGINAL. from an interrupted run is cleared first',
   /if \(fs\.existsSync\(asideDir\)\)/.test(fn),
   'otherwise the second attempt fails on a name that is already taken');

console.log(failed ? `\n${failed} FAILED` : '\nreplace-aside-behavior: all passing');
process.exit(failed ? 1 : 0);
