// A withdrawn eject offer must not leave a ticked box behind.  [B-462]
//
// The summary reads `ejectBox.checked` and passes it as `auto`, which presses Eject for the user.
// So hiding the control while it is still ticked is not cosmetic - it ejects a card on the
// strength of a control that was taken back.
const fs = require('fs'); const path = require('path');
const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
let bad = 0;
const ok = (l, c, x) => { if (c) { console.log('  ok   ' + l); return; } bad++; console.log('  FAIL ' + l); if (x) console.log('       ' + x); };

const i = H.indexOf('const showPhase = (phase) =>');
const j = H.indexOf('const closeModal = ', i);
const fn = (i > 0 && j > i) ? H.slice(i, j) : '';
ok('CONTROL: the showPhase slice is non-empty', fn.length > 500, 'an empty slice passes everything vacuously');

ok('the offer is computed once and drives both display and the tick',
   /const offered = \(phase === 'progress' && unattended && ejectOffer\.available\)/.test(fn),
   'two separate expressions would be free to disagree');
ok('a withdrawn offer clears the checkbox',
   /if \(!offered && phase === 'progress' && els\.ejectBox\) els\.ejectBox\.checked = false;/.test(fn));
ok('CRITICAL: it does NOT clear at the summary, where the value is read',
   /phase === 'progress' && els\.ejectBox/.test(fn),
   'clearing on every hide would discard a tick the user genuinely made');
ok('the summary still reads it as auto',
   /auto:\s+!!\(els\.ejectBox && els\.ejectBox\.checked\)/.test(H),
   'if this reader goes away the hazard changes shape and this test should be revisited');

// ── The offer retires when the run is being abandoned, and comes back afterwards. ──
// Ruled 2026-10-06: *"we don't have auto eject after cancel."* So a tick left live during a
// cancel is a promise the cancel path will not keep - the same shape as the quick-import box
// beside it, which has greyed since 2026-10-05. The ask was for it on consistency grounds; it holds
// on its own grounds too.
const cancelAt = H.indexOf('const _bulkBeginCancel = ');
const cancelEnd = H.indexOf('};', cancelAt);
const cancelFn = (cancelAt > 0 && cancelEnd > cancelAt) ? H.slice(cancelAt, cancelEnd) : '';
ok('CONTROL: the cancel-handler slice is non-empty', cancelFn.length > 200,
   'an empty slice passes everything vacuously');
ok('cancelling greys the eject offer as well as the quick-import offer',
   /els\.ejectBox\.disabled = true/.test(cancelFn) && /els\.ejectWrap\.style\.opacity = '0\.5'/.test(cancelFn),
   'the eject box stays live through a cancel - it offers an eject that will not happen');
ok('cancelling DISABLES rather than unchecks it',
   !/els\.ejectBox\.checked = false/.test(cancelFn),
   'clearing one box while merely dimming the other reads as the app changing his answer rather '
   + 'than retiring the question');

// A set with no matching reset is session-sticky: ONE cancel would leave the offer greyed for
// every import after it, on a card that is perfectly ejectable. Named four times this session.
const closeAt = H.indexOf('const closeModal = ');
const closeEnd = H.indexOf('\n  const ', closeAt + 10);
const closeFn = (closeAt > 0 && closeEnd > closeAt) ? H.slice(closeAt, closeEnd) : '';
ok('CONTROL: the closeModal slice is non-empty', closeFn.length > 200,
   'an empty slice passes everything vacuously');
ok('closeModal restores what the cancel greyed',
   /els\.ejectBox\.disabled = false/.test(closeFn) && /els\.ejectWrap\.style\.opacity = ''/.test(closeFn),
   'the grey survives the modal - one cancel disables the eject offer for the rest of the session');

console.log(bad ? ('\nbulk-eject-withdrawn: ' + bad + ' FAILED') : '\nbulk-eject-withdrawn: all checks passed');
process.exit(bad ? 1 : 0);