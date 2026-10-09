// The board-card classify is asked ONCE per drive, and a caller can tell whether it is already
// known without asking.
//
// `_sfDestIdentity.boardCard` is a ~1,900 ms PowerShell spawn. Two things depend on it: the slow
// import warning, which every import door routes through, and the card report's transport line.
// The report asks first, so by the time a user picks an import the answer is already held - unless
// something quietly drops it.
//
// Something did. `identity()` read `if (L !== this.letter || !this.fast)` and cleared `board` on
// BOTH conditions, so asking `removable()` for the same drive threw away a classify that had
// already been paid for. `_sfWarnSlowImport` asks `removable()` and THEN `isBoardCard()`, in that
// order, so the spawn ran twice on every warned import. Found 2026-10-07 when The ask was "just
// make sure you don't call to find out again since we already know."
//
// ⚠️ THIS IS A BEHAVIOURAL TEST, NOT A SOURCE SCAN, and it has to be. The broken and the fixed
// code both read as a reasonable cache; the difference is only visible by counting calls. It
// evaluates the real object literal out of the page with the two lookups stubbed.

'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}

// ── Lift the real object out of the page ─────────────────────────────────────
const START = 'const _sfDestIdentity = {';
const END = 'window._sfDestIdentity = _sfDestIdentity;';
const i = src.indexOf(START);
const j = src.indexOf(END, i);
ok('the identity object was located', i > 0 && j > i, `start=${i} end=${j}`);
const body = (i > 0 && j > i) ? src.slice(i, j) : '';

let classifyCalls = 0, fastCalls = 0;
function build() {
  classifyCalls = 0; fastCalls = 0;
  const fakeWindow = {
    electronAPI: {
      identifyExportDest: async () => { fastCalls++; return { ok: true, result: { removable: true, kind: 'card' } }; },
    },
  };
  const classify = async () => { classifyCalls++; return { ok: true, result: { transport: 'proffieboard' } }; };
  // eslint-disable-next-line no-new-func
  return new Function('window', '_sfClassifyDest', body + '\nreturn _sfDestIdentity;')(fakeWindow, classify);
}

(async () => {
  // ── One spawn per drive, however many times it is asked ────────────────────
  {
    const id = build();
    ok('a board card is reported as one', (await id.isBoardCard('F:\\Fonts')) === true);
    ok('the classify ran once', classifyCalls === 1, `ran ${classifyCalls} times`);
    await id.isBoardCard('F:\\Other');
    ok('asking again about the same drive does not re-run it', classifyCalls === 1,
       `ran ${classifyCalls} times - the memo is not holding`);
  }

  // ── ⚠️⚠️ THE REGRESSION ITSELF ────────────────────────────────────────────
  // The exact order `_sfWarnSlowImport` uses: removable, then isBoardCard.
  {
    const id = build();
    await id.isBoardCard('F:\\Fonts');          // the card report's question
    await id.removable('F:\\Fonts');            // the warning's first question
    await id.isBoardCard('F:\\Fonts');          // the warning's second question
    ok('⚠️ a removable() check between two board questions costs no second spawn',
       classifyCalls === 1,
       `ran ${classifyCalls} times - this is the defect: identity() dropped the cached verdict for `
       + 'the same drive, so every warned import paid ~1,900 ms twice');
  }

  // ── Known-vs-unknown, without ever starting a lookup ───────────────────────
  {
    const id = build();
    ok('nothing is known before anyone asks', id.knownIsBoardCard('F:\\x') === null);
    ok('and merely asking what is known starts no lookup', classifyCalls === 0,
       `ran ${classifyCalls} times - this accessor must never spawn`);
    await id.isBoardCard('F:\\x');
    ok('once established it reports the verdict', id.knownIsBoardCard('F:\\x') === true);
    ok('still only one spawn', classifyCalls === 1, `ran ${classifyCalls} times`);
    ok('a DIFFERENT drive is not known', id.knownIsBoardCard('G:\\x') === null,
       'a verdict about F: says nothing about G:');
    ok('and asking about it still started nothing', classifyCalls === 1, `ran ${classifyCalls} times`);
  }

  // ── Invalidation: a new device must not inherit the old verdict ────────────
  {
    const id = build();
    await id.isBoardCard('F:\\x');
    id.forget();
    ok('forget() clears the known verdict', id.knownIsBoardCard('F:\\x') === null,
       'an eject means the next card in that slot is a different device');

    const id2 = build();
    await id2.isBoardCard('F:\\x');
    ok('a different drive letter clears it too', id2.knownIsBoardCard('G:\\x') === null);
    await id2.removable('G:\\x');
    ok('and after moving to that drive, F: is no longer known either',
       id2.knownIsBoardCard('F:\\x') === null,
       'the memo holds one drive at a time; a stale verdict under a new letter is the hazard '
       + 'forget() exists for');
  }

  // ── The consumer actually uses the conditional ─────────────────────────────
  ok('the slow-import warning branches on what is already known',
     /const _known = window\._sfDestIdentity\.knownIsBoardCard\(sourceDir\);/.test(src)
     && /_known === null\)[\s\S]{0,120}?isBoardCard\(sourceDir\)/.test(src),
     'the memo makes a repeat call cheap; this makes NOT calling explicit, so a future change to '
     + 'the memo cannot silently restore the double spawn');

  console.log('');
  console.log(fail === 0
    ? `dest-identity-asks-once: all ${pass} checks passed`
    : `dest-identity-asks-once: ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
