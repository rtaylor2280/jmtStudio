// ── Main-thread stall probe ─────────────────────────────────────────── [B-398]
//
// Windows greys a window when the process that owns it stops pumping messages for ~5s. In Electron
// that window belongs to the MAIN process, so "not responding" is a statement about main's event
// loop and nothing else. This measures exactly that: a heartbeat that should fire every 200ms, and
// a record of how late it actually was — attributed to whatever work was in flight at the time.
//
// ⚠️⚠️ THE ENTRY FORBIDS GUESSING WHICH PASS BLOCKS. [B-398]: "NOT DIAGNOSED: which pass is
// blocking. Zipping, hashing and buildLibraryIndex are all candidates and picking by plausibility
// is what produced a wrong diagnosis on [B-296] earlier the same day. Instrument first."
//
// ⚠️ INERT UNLESS SWITCHED ON. It ships disabled and costs one absent-file check at startup, so it
// can live in the tree without being a permanent tax. Enable by creating the flag file — no
// relaunch-from-a-terminal, no env var, because the person running it is testing a GUI app.
//
// ⚠️ THE PROBE MUST NOT BE THE THING THAT BLOCKS. Records are buffered in memory and written only
// on flush(). A synchronous append per event would add disk I/O to the main thread while measuring
// main-thread stalls, which is the instrument-changes-the-measurement trap this project keeps
// finding.
'use strict';

const fs = require('fs');
const path = require('path');

const TICK_MS = 200;        // heartbeat interval
const STALL_MS = 400;       // a gap beyond this is worth recording (2x the tick)
const MAX_RECORDS = 5000;   // bounded, so a long run cannot grow without limit
const AUTOFLUSH_MS = 15000; // write what we have periodically, so a force-quit loses seconds

let enabled = false;
let userDataDir = null;
let timer = null;
let last = 0;
let lastFlush = 0;
const stack = [];           // active phase labels, innermost last
const timeline = [];        // {t, type, label} - replayed at flush to attribute each stall
const records = [];
const phaseTotals = new Map();

function flagPath(userData) { return path.join(userData, '.stall-probe'); }
function logPath(userData) { return path.join(userData, 'stall-probe.log'); }

// Called once at startup. Returns whether the probe armed.
function init(userData) {
  userDataDir = userData;
  try { enabled = fs.existsSync(flagPath(userData)); } catch { enabled = false; }
  if (!enabled) return false;
  last = Date.now();
  lastFlush = last;
  timer = setInterval(() => {
    const now = Date.now();
    const late = now - last - TICK_MS;
    last = now;
    if (late >= STALL_MS && records.length < MAX_RECORDS) {
      // ⚠️⚠️ ATTRIBUTION IS RESOLVED AT FLUSH, NOT HERE, and the self-test is why. A heartbeat can
      // only fire once the loop is free again — by which time the phase that blocked it has
      // already ended and popped. Reading the stack at this moment reported "(idle)" for a
      // deliberate 1.2s block: the instrument naming the wrong phase, which is the single thing
      // it exists to get right. Record the WINDOW and resolve it against the timeline later.
      records.push({
        t: new Date(now).toISOString(),
        stalledMs: late,
        from: now - late - TICK_MS,   // when the loop went away
        to: now,                      // when it came back
      });
    }
    // ⚠️⚠️ CRASH-SAFE. A flush only at the end of the operation loses EVERYTHING if the app is
    // killed — and for a bug whose symptom is Windows offering to end the program, being killed is
    // the most likely outcome of a successful reproduction. Write periodically so the worst case
    // costs the last few seconds rather than the whole run.
    // ⚠️ Interval-gated, not per-stall: the write happens between stalls, never inside one, so
    // the probe still cannot be the thing that blocks.
    if (records.length && now - lastFlush >= AUTOFLUSH_MS) {
      lastFlush = now;
      flush('auto — run still in progress');
    }
  }, TICK_MS);
  if (timer.unref) timer.unref();   // never hold the process open
  return true;
}

// Wrap a phase. begin/end are cheap enough to leave in hot paths when disabled.
function begin(label) {
  if (!enabled) return;
  const now = Date.now();
  stack.push({ label, at: now });
  if (timeline.length < MAX_RECORDS * 4) timeline.push({ t: now, type: 'begin', label });
}
function end(label) {
  if (!enabled) return;
  // ⚠️ Pop by LABEL, not blindly: an early return or a throw inside a phase would otherwise leave
  // the stack skewed and every later stall attributed to the wrong work.
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].label !== label) continue;
    const ms = Date.now() - stack[i].at;
    const cur = phaseTotals.get(label) || { calls: 0, totalMs: 0, worstMs: 0 };
    cur.calls++; cur.totalMs += ms; cur.worstMs = Math.max(cur.worstMs, ms);
    phaseTotals.set(label, cur);
    stack.splice(i, 1);
    if (timeline.length < MAX_RECORDS * 4) timeline.push({ t: Date.now(), type: 'end', label });
    return;
  }
}

// Convenience for an awaited step; returns whatever fn returns.
async function around(label, fn) {
  if (!enabled) return fn();
  begin(label);
  try { return await fn(); } finally { end(label); }
}

// ⭐ MARK A WHOLE FUNCTION WITHOUT EDITING ITS BODY. [B-398]
//
// Every stall outside the import path reads as "(idle - nothing marked)", which is enough to know
// something blocked and useless for knowing WHAT. Editing each function to add begin/try/finally
// means touching working logic in five modules purely to measure it; wrapping at the export site
// costs nothing and cannot change what the function does.
//
// ⚠️ TWO VARIANTS ON PURPOSE. Wrapping a synchronous function in an async one would change its
// contract for every caller — the exact signature change that broke four callers when addFiles
// went async. mark() stays sync, markAsync() awaits.
// ⚠️⚠️ THE `enabled` CHECK IS INSIDE THE WRAPPER, NOT OUTSIDE IT, AND THE FIRST CUT GOT THIS
// WRONG. It read `if (!enabled) return fn;` at wrap time — which reads like a free optimisation
// and is actually a dead instrument. These wrappers are applied where a module builds its
// module.exports, and that runs when main.js REQUIRES the module: before app.whenReady() calls
// init(), so `enabled` is still false and every wrapper hands back the unwrapped original.
//
// The symptom was not an error. It was a run where six freshly marked functions produced a log
// full of "(idle - nothing marked)" — an instrument reporting nothing while the thing it measures
// happens right in front of it. Exactly the class this file already carries two warnings about.
//
// The cost of checking per call is one boolean against work measured in hundreds of milliseconds.
function mark(label, fn) {
  return function (...args) {
    if (!enabled) return fn.apply(this, args);
    begin(label);
    try { return fn.apply(this, args); } finally { end(label); }
  };
}
function markAsync(label, fn) {
  return async function (...args) {
    if (!enabled) return fn.apply(this, args);
    begin(label);
    try { return await fn.apply(this, args); } finally { end(label); }
  };
}

// Write what was collected and clear it. Safe to call when disabled (no-op).
function flush(note) {
  if (!enabled || !userDataDir) return null;
  // Replay the timeline to find what was active during each stall window. The innermost phase
  // that was open for the MIDPOINT of the gap is the culprit; a phase that merely started or
  // ended inside it was not what held the loop.
  for (const r of records) {
    const mid = r.from + (r.to - r.from) / 2;
    const open = [];
    for (const e of timeline) {
      if (e.t > mid) break;
      if (e.type === 'begin') open.push(e.label);
      else { const i = open.lastIndexOf(e.label); if (i >= 0) open.splice(i, 1); }
    }
    r.stack = open.slice();
    r.phase = open.length ? open[open.length - 1] : '(idle - nothing marked)';
  }

  const lines = [];
  lines.push('');
  lines.push('═══ stall probe ' + new Date().toISOString() + (note ? '  — ' + note : '') + ' ═══');
  lines.push('heartbeat ' + TICK_MS + 'ms, recording gaps >= ' + STALL_MS + 'ms');
  lines.push('');
  if (!records.length) {
    lines.push('  NO STALLS RECORDED. The main loop kept up throughout.');
  } else {
    const worst = records.reduce((a, b) => (b.stalledMs > a.stalledMs ? b : a));
    lines.push('  stalls: ' + records.length + '   worst: ' + worst.stalledMs + 'ms  in  ' + worst.phase);
    // Group by phase so the culprit is obvious without reading every line.
    const byPhase = new Map();
    for (const r of records) {
      const c = byPhase.get(r.phase) || { n: 0, total: 0, worst: 0 };
      c.n++; c.total += r.stalledMs; c.worst = Math.max(c.worst, r.stalledMs);
      byPhase.set(r.phase, c);
    }
    lines.push('');
    lines.push('  BY PHASE (where the loop was when it stopped answering):');
    for (const [p, c] of [...byPhase].sort((a, b) => b[1].total - a[1].total)) {
      lines.push('    ' + String(c.n).padStart(4) + ' stalls  worst ' + String(c.worst).padStart(6)
        + 'ms  total ' + String(c.total).padStart(7) + 'ms   ' + p);
    }
    lines.push('');
    lines.push('  WORST TEN, with the full stack:');
    for (const r of [...records].sort((a, b) => b.stalledMs - a.stalledMs).slice(0, 10)) {
      lines.push('    ' + String(r.stalledMs).padStart(6) + 'ms  ' + r.t + '  ' + (r.stack.join(' > ') || r.phase));
    }
  }
  if (phaseTotals.size) {
    lines.push('');
    lines.push('  PHASE DURATIONS (wall clock, not stall):');
    for (const [p, c] of [...phaseTotals].sort((a, b) => b[1].totalMs - a[1].totalMs)) {
      lines.push('    ' + String(c.calls).padStart(4) + 'x  worst ' + String(c.worstMs).padStart(7)
        + 'ms  total ' + String(c.totalMs).padStart(8) + 'ms   ' + p);
    }
  }
  lines.push('');
  const text = lines.join('\n');
  try { fs.appendFileSync(logPath(userDataDir), text + '\n'); } catch {}
  records.length = 0;
  phaseTotals.clear();
  // ⚠️⚠️ RE-SEED THE STILL-OPEN PHASES INSTEAD OF CLEARING THEM AWAY. [B-398]
  //
  // Clearing the timeline outright was a real defect, found 2026-09-18 on his first captured run:
  // a phase that began BEFORE an auto-flush and was still running after it lost its 'begin' event,
  // so every later stall inside it resolved to "(idle - nothing marked)" — while the log's own
  // phase list showed a 37-second bulkImport:analyze wrapped around those exact stalls. The
  // instrument reported "nothing was happening" during the busiest part of the run.
  //
  // Same failure as the original attribution bug this file already carries a warning about, one
  // flush later: the record of what was open has to survive as long as the phase itself does.
  // Their real start time is kept, so durations and midpoint attribution stay honest rather than
  // being re-dated to the flush.
  timeline.length = 0;
  for (const f of stack) timeline.push({ t: f.at, type: 'begin', label: f.label });
  return text;
}

// [B-398] Capture the STACK of a main-process crash instead of only its message.
//
// Electron's default handler shows "A JavaScript error occurred in the main process" with one line
// — "EBADF: bad file descriptor, read" — which names the syscall and not the caller. That is the
// same shape of unhelpful as a stall with no phase attached: enough to know something broke, not
// enough to know where.
//
// ⚠️⚠️ THIS DOES NOT SWALLOW ANYTHING. Installing an uncaughtException handler suppresses
// Electron's dialog, so this re-raises the same visible failure after writing the stack. A
// diagnostic that quietly turns crashes into non-crashes would hide the very thing it is here to
// study — and would change behaviour for anyone running without the flag.
//
// ⚠️ Gated on the same flag as the probe: off by default, so normal runs keep Electron's behaviour
// exactly.
function captureCrashes(onFatal) {
  if (!enabled) return false;
  const write = (kind, err) => {
    const stack = (err && err.stack) || String(err);
    const phases = stack_summary();
    const text = [
      '',
      '═══ ' + kind + '  ' + new Date().toISOString() + ' ═══',
      '  ' + String((err && err.message) || err),
      '',
      '  PHASES OPEN WHEN IT DIED (innermost last):',
      phases.length ? phases.map(p => '    ' + p).join('\n') : '    (none marked)',
      '',
      '  STACK:',
      String(stack).split('\n').map(l => '    ' + l).join('\n'),
      '',
    ].join('\n');
    try { fs.appendFileSync(logPath(userDataDir), text + '\n'); } catch {}
    try { flush(kind); } catch {}
  };
  process.on('uncaughtException', (err) => {
    write('UNCAUGHT EXCEPTION', err);
    if (typeof onFatal === 'function') { try { onFatal(err); } catch {} }
  });
  // ⚠️ A rejected promise nobody awaited does NOT kill the process by default in every Node
  // version, so it can corrupt a run silently. Record it and keep going.
  process.on('unhandledRejection', (reason) => write('UNHANDLED REJECTION', reason));
  return true;
}
function stack_summary() { return stack.map(f => f.label + '  (' + (Date.now() - f.at) + 'ms in)'); }

module.exports = { init, begin, end, around, mark, markAsync, flush, logPath, flagPath, captureCrashes,
  isEnabled: () => enabled };
