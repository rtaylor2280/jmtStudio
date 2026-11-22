// [B-413] Cancel must reach every live run, and a second import must not start.
//
// The bug this replaces was not subtle in effect — a cancelled import ran for eight more minutes
// and wrote the library — but it was invisible in the code: one shared pointer, reassigned per
// run, while each run checked the token it had closed over. These assert the two directions that
// pointer failed in, plus the refusal that stops the situation arising.
'use strict';

const { createGate } = require('../bulkImportGate');

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('PASS ' + label); return; }
  failures++;
  console.log('FAIL ' + label + (detail ? '\n     ' + detail : ''));
}

// ── the refusal ────────────────────────────────────────────────────────────
{
  const g = createGate();
  const a = g.begin();
  check('first run gets a token', !!a);
  check('a second run is refused while one is live', g.begin() === null,
    'two concurrent imports both write the library, the content pool and the hash index');
  g.end(a);
  check('after the first ends, a new run may start', !!g.begin());
}

// ── direction 1: a new run must not disarm an older one ────────────────────
//
// This is the original bug. The gate refuses concurrency now, so reaching this state requires
// forcing it — worth testing anyway, because "cancel reaches everything live" is the invariant,
// and a future caller that bypasses begin() must not silently lose cancellation.
{
  const g = createGate();
  const first = g.begin();
  g.end(first);          // pretend the guard was bypassed: retire, but keep using the token
  const second = g.begin();
  // Both tokens exist in the caller's hands; only `second` is registered.
  g.cancelAll();
  check('a live registered run is cancelled', second.cancelled === true);
  check('a retired token is NOT resurrected by cancelAll', first.cancelled === false,
    'cancelAll must only touch what is actually live');
}

// ── direction 2: one run ending must not disarm another ────────────────────
//
// The mirror defect: main.js set the shared pointer to null in its finally, so whichever run
// finished FIRST disarmed the other. Here, ending one token must leave the other cancellable.
{
  const g = createGate();
  const a = g.begin();
  // Force a second live token without the guard, to model two genuinely concurrent runs.
  const b = { cancelled: false };
  g.cancelAll();                       // baseline: only `a` is live
  check('baseline — only the registered run is live', a.cancelled === true && b.cancelled === false);

  const g2 = createGate();
  const x = g2.begin();
  g2.end(x);
  const y = g2.begin();
  g2.end(x);                            // retiring the OLD token again, after a new run started
  check('retiring an already-ended token does not deregister the live one',
    g2.liveCount() === 1,
    'end() on a stale token must not remove somebody else — this is the `= null` bug returning');
  g2.cancelAll();
  check('the live run is still reachable by cancel after that', y.cancelled === true,
    'a stale end() disarmed the live run — exactly the original defect');
}

// ── cancelAll reports what it reached ──────────────────────────────────────
{
  const g = createGate();
  check('cancelAll on an idle gate reaches nothing', g.cancelAll() === 0);
  const t = g.begin();
  check('cancelAll reports the number it cancelled', g.cancelAll() === 1);
  check('and it actually set the flag', t.cancelled === true);
}

console.log(failures === 0 ? '\nOK' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
