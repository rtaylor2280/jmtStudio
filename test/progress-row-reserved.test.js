// The progress modal must not change SIZE while it is on screen.        [2026-09-25]
//
// ⭐⭐ WHY THIS FILE EXISTS, and it is a specific failure rather than a principle. Retiring the
// Cancel button used `display:none`, which takes it out of the layout. The modal lost a button's
// height mid-operation, shrank, and re-centred - and a box that changes size and position is a
// NEW BOX as far as the eye is concerned.
//
// ⚠️⚠️ THE COST OF NOT HAVING THIS WAS AN EVENING. Ryan reported "an extra modal just before the
// summary" three separate times. Nothing in the code accounted for one, because there was never
// a second modal. Two full instrument traces came back clean because the instrument watched
// `.modal-overlay` gaining `.active` - a resize changes no classes and opens nothing, so it was
// invisible to the very thing built to find it, while the log looked complete. It was caught by
// pausing a screen recording: same phase, same text, Cancel in one frame and gone in the next.
//
// ⚠️ THE ASSERTIONS ARE ON THE MECHANISM, NOT ON A HEIGHT. Reserving with a hard-coded
// `min-height` would pass a test and still drift the day someone restyles the button. The space
// is held BY THE BUTTON ITSELF, so it cannot disagree with the button's real size.
'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

// Slice each method to its own body, anchored on its own name.
function bodyOf(sig, end = '\n        },') {
  const s = html.indexOf(sig);
  if (s < 0) return '';
  const e = html.indexOf(end, s);
  return e > s ? html.slice(s, e) : '';
}

{
  const block = bodyOf('        clearCancel() {');
  ok('clearCancel was located', block.length > 0,
     're-anchor if it is renamed - an empty slice passes everything below');
  ok('⭐⭐ it retires the cancel with `visibility`, keeping its space',
     /b\.style\.visibility\s*=\s*'hidden'/.test(block),
     'this is the phantom modal. `display:none` removes the button from the layout, the row '
     + 'loses a button\'s height, and the modal shrinks and re-centres while still on screen');
  ok('⭐⭐ and it does NOT take the button out of the layout',
     !/b\.style\.display\s*=\s*'none'/.test(block),
     'one line reintroduces the resize, and it will be reported as a modal nobody wrote');
}

{
  const block = bodyOf('        offerCancel(onCancel) {', '\n          b.onclick');
  ok('offerCancel was located', block.length > 0, 're-anchor if it is renamed');
  ok('⭐ it makes the button visible again',
     /b\.style\.visibility\s*=\s*''/.test(block),
     'a re-offer inside the same showing would otherwise wire a button nobody can see - the '
     + 'export hands scan -> recording -> copy through this one surface');
  ok('⭐ and it takes the reservation',
     /this\.cancelReserved\s*=\s*true/.test(block),
     'without it the row itself collapses on the next _syncActions');
}

{
  const block = bodyOf('        _syncActions() {');
  ok('_syncActions was located', block.length > 0, 're-anchor if it is renamed');
  ok('⭐⭐ the row is held by the RESERVATION, not by a live handler',
     /this\.cancelReserved\s*\|\|\s*ejectUp/.test(block),
     'keying on a wired handler collapsed the entire row - not just the button - on any door '
     + 'that offers no eject checkbox. Same defect, one size larger');
  ok('⚠️ and it no longer asks whether the cancel is wired',
     !/b\.onclick/.test(block),
     'that test is what tied the row\'s height to the handler\'s lifetime');
}

{
  // ⚠️ A RESERVATION THAT IS NEVER RELEASED IS A DEAD ROW UNDER EVERY LATER MODAL. It has to
  // outlive each PHASE (or the handovers jump) and die with the MODAL (or the next thing to use
  // this shared surface opens with empty space beneath it).
  const block = bodyOf('        _retireActions() {');
  ok('_retireActions was located', block.length > 0, 're-anchor if it is renamed');
  ok('⚠️ it releases the reservation', /this\.cancelReserved\s*=\s*false/.test(block),
     'held forever, every door that ever offered a cancel keeps a blank row for the session');

  for (const [label, sig, end] of [
    ['hideNow', '        hideNow() {', '\n        },'],
    ['hide',    '        async hide(minMs = 200) {', '\n      };'],
  ]) {
    const h = bodyOf(sig, end);
    ok(`${label} was located`, h.length > 0, 're-anchor if it is renamed');
    ok(`⭐ ${label} retires the row on the way down`, /_retireActions\(\)/.test(h),
       'the modal coming down is the ONLY moment the reservation may be dropped - doing it at '
       + 'the end of a phase is the resize this file exists to prevent');
  }
  ok('⚠️ and the never-shown early return retires too',
     /contains\('active'\)\) \{ this\.clearCancel\(\); this\._retireActions\(\)/.test(html),
     'hide() on a modal that never opened still has to leave the row clean for the next caller');
}

{
  // The detail line already reserved its own space; this pins it so the pair stays consistent.
  ok('⚠️ the detail line still reserves its line box',
     /\.sf-import-progress-detail\s*\{[^}]*min-height:\s*1em/.test(html),
     'it can go empty between phases, and without this it drops a line the same way the button '
     + 'dropped a row');
}

console.log(failed ? `\n${failed} FAILED` : '\nprogress-row-reserved: all passing');
process.exit(failed ? 1 : 0);
