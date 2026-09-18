// ── One import at a time, and cancel means cancel ─────────────────────── [B-413]
//
// Extracted from main.js so it can be tested. It is ten lines of state, and it went wrong twice
// while being written — once in the original, once in my replacement for it — which is the
// argument for it living somewhere a test can reach.
//
// WHAT WENT WRONG ORIGINALLY. main.js held `let _bulkImportCancelToken = null`, reassigned at the
// top of every run, while each running import checked the token IT had captured in a closure. Two
// defects fell out, disarming each other's runs in opposite directions:
//
//   1. A NEW run overwrote the pointer, so cancel only ever reached the LATEST run. Any earlier
//      one still going became permanently un-cancellable — the click set a flag nobody read.
//   2. The `finally` nulled the pointer, so when the OLD run ended it disarmed the NEW one.
//
// ⚠️ OBSERVED, NOT THEORISED, 2026-09-18: he cancelled a 136-source import and the probe kept
// naming new sources for eight minutes, marching alphabetically past the cancel point, while the
// modal was gone and the library was being written. From the UI there was nothing to see at all.
//
// ⚠️⚠️ THE FIX'S OWN TRAP, HIT WHILE WRITING IT: a `clear()` in the finally reads as tidy and is
// the original bug wearing new clothes — it disarms every other live run exactly as `= null` did.
// A run may only ever retire ITS OWN token.
'use strict';

function createGate() {
  const tokens = new Set();
  let busy = false;

  return {
    // Returns null when something is already running. The caller must treat null as "refuse",
    // not as "carry on with no token" — a run with no token cannot be cancelled at all.
    begin() {
      if (busy) return null;
      busy = true;
      const token = { cancelled: false };
      tokens.add(token);
      return token;
    },

    // Retire one run. Never touches anybody else's token.
    end(token) {
      if (token) tokens.delete(token);
      busy = false;
    },

    // ⭐ Cancels EVERYTHING in flight. If a run somehow survived its own retirement, the user's
    // click still has to reach it — that is the failure this whole module exists to prevent.
    cancelAll() {
      let n = 0;
      for (const t of tokens) { t.cancelled = true; n++; }
      return n;
    },

    isBusy() { return busy; },
    liveCount() { return tokens.size; },
  };
}

module.exports = { createGate };
