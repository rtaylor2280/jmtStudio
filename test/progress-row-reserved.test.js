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
  const block = bodyOf('        _retireReservations() {');
  ok('_retireReservations was located', block.length > 0, 're-anchor if it is renamed');
  ok('⚠️ it releases the reservation', /this\.cancelReserved\s*=\s*false/.test(block),
     'held forever, every door that ever offered a cancel keeps a blank row for the session');

  for (const [label, sig, end] of [
    ['hideNow', '        hideNow() {', '\n        },'],
    ['hide',    '        async hide(minMs = 200) {', '\n      };'],
  ]) {
    const h = bodyOf(sig, end);
    ok(`${label} was located`, h.length > 0, 're-anchor if it is renamed');
    ok(`⭐ ${label} retires the row on the way down`, /_retireReservations\(\)/.test(h),
       'the modal coming down is the ONLY moment the reservation may be dropped - doing it at '
       + 'the end of a phase is the resize this file exists to prevent');
  }
  ok('⚠️ and the never-shown early return retires too',
     /contains\('active'\)\) \{ this\.clearCancel\(\); this\._retireReservations\(\)/.test(html),
     'hide() on a modal that never opened still has to leave the row clean for the next caller');
}

{
  // ⚠️⚠️ THE ASSERTION THAT USED TO SIT HERE WAS TRUE AND IRRELEVANT, which is worse than absent.
  // It checked `min-height: 1em` on `.sf-import-progress-detail` and passed happily for the whole
  // time the row was collapsing to zero - because `#sf-bulk-progress-detail:empty { display:none }`
  // overrides it, and a `display:none` element has no height to have a minimum of. It gave cover
  // to the exact defect this file exists for. Assert the rule that GOVERNS, not a nearby one.
  ok('the deliberate collapse is still there',
     /#sf-bulk-progress-detail:empty\s*\{\s*display:\s*none/.test(html),
     '[B-420] a door that never writes a per-item line must not pay for a blank row - "why is '
     + 'there a blank space under the bar?" That report must stay fixed');
  ok('⭐⭐ but a showing that HAS used the row keeps it',
     /#modal-sf-bulk-progress\.sf-prog-detail-used\s+#sf-bulk-progress-detail:empty\s*\{\s*display:\s*block/.test(html),
     'the scan writes a name per item and clears it after the last one. Without this the row '
     + 'vanishes mid-operation: detail 16px -> 0, box 233 -> 196, and the modal re-centres');
  ok('⭐ and every write of the detail claims it',
     (html.match(/classList\.add\('sf-prog-detail-used'\)/g) || []).length === 5,
     'all five writers must mark it, or whichever one runs last in a given flow leaves the row '
     + 'collapsible and the resize comes back on that path only');
  ok('⚠️ marked on WRITE, not on phase',
     /if \(d\.textContent\) d\.closest\('\.modal-overlay'\)\?\.classList\.add/.test(html),
     'claiming the row whenever a phase starts would reserve it for doors that never use it, '
     + 'which is the [B-420] blank row again');
  ok('⚠️ and it is released with the modal',
     /_retireReservations\(\)[\s\S]{0,600}?classList\.remove\('sf-prog-detail-used'\)/.test(html),
     'held past the close, the next caller inherits a blank row it never wrote to');
}

console.log(failed ? `\n${failed} FAILED` : '\nprogress-row-reserved: all passing');
process.exit(failed ? 1 : 0);
