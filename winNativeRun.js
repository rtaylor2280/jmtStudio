// Runs one in-process Win32 operation on a worker thread. [B-681]
//
// Shared by winDisks.js (winDisksNative.js) and winSystem.js (winSystemNative.js), so every koffi
// call Studio makes is started, timed and waited for at quit in one way, under one quit guard.
//
// OFF THE MAIN THREAD. A volume, IOCTL or device query blocks for as long as a dead or slow device
// takes, so each call runs on its own worker thread, and a worker that has not answered in time is
// abandoned with the failure value. One worker per call, as one process per call was: a slow
// enumeration never holds up the check queued behind it.

'use strict';

const path = require('path');

// The worker file. In a packaged build it is unpacked from the asar archive (package.json
// asarUnpack), as koffi is, so the worker loads both from plain files on disk.
function _nativePath(file) {
  return path.join(__dirname, file)
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

// Run operation `op` of native file `file` on a fresh worker. Resolves its value, `failValue`
// when the worker fails or throws, or `timeoutValue` (failValue unless given) when it has not
// answered within `timeoutMs`. Off Windows nothing runs and `failValue` comes back.
//
// The worker file checks workerData.nativeFile against its own name before running anything, so
// a native file required by another one never runs an operation meant for it.
//
// NEVER TERMINATED, AND ANSWERED ONLY ONCE IT HAS EXITED. Stopping a worker while koffi is
// marshalling a call is a fatal N-API error that takes the whole process down (measured: exit
// 0x86, "Error::ThrowAsJavaScriptException napi_throw"), and a process that exits while a worker
// is still unloading koffi after its answer hits the same error. So a worker that runs out of time
// is abandoned, not stopped - it finishes or waits in the kernel on its own, as cardProbe.js lets
// its readers do [B-669] - and a normal answer is handed back on the worker's exit, so the caller
// can never race its teardown. unref() keeps an abandoned worker from holding the process open.
function runNative(file, op, args, timeoutMs, failValue, timeoutValue = failValue) {
  if (process.platform !== 'win32') return Promise.resolve(failValue);
  _guardQuit();
  // Once a quit has begun, nothing new starts: a call begun now could only add to what the quit
  // has to wait for.
  if (_quitting) return Promise.resolve(failValue);
  return new Promise((resolve) => {
    let w;
    let done = false;
    let timer = null;
    let answer = failValue;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(v);
    };
    try {
      const { Worker } = require('worker_threads');
      w = new Worker(_nativePath(file), { workerData: { nativeFile: file, nativeOp: op, args } });
      w.unref();
    } catch { finish(failValue); return; }
    _live.set(w, new Promise((r) => w.once('exit', () => { _live.delete(w); r(); })));
    timer = setTimeout(() => finish(timeoutValue), timeoutMs);
    w.once('message', (m) => { answer = m && m.ok ? m.value : failValue; });
    w.once('error', () => { answer = failValue; });
    w.once('exit', () => finish(answer));
  });
}

// The worker side: run the requested operation from `ops` when this worker was started for
// `file`, and post { ok, value } or { ok: false, error } back. A no-op on the main thread and in
// a worker started for another file.
function serveNative(file, ops) {
  const wt = require('worker_threads');
  if (wt.isMainThread || !wt.workerData || wt.workerData.nativeFile !== file) return;
  const { nativeOp, args } = wt.workerData;
  let msg;
  try { msg = { ok: true, value: ops[nativeOp](...(args || [])) }; }
  catch (e) { msg = { ok: false, error: String(e && e.message || e) }; }
  wt.parentPort.postMessage(msg);
}

// ── Quitting while a call is in flight ──
// A call still inside koffi when the process shuts down crashes it: the call returns into a
// torn-down environment and koffi's error is fatal. A volume read stalled on an unreachable
// network drive shows it: after a quit the process lingers with no window until the read
// returns, about 22 s later, then exits 134 with a napi_throw fatal error. The same happens to a
// worker stopped mid-call.
//
// So, from the moment a quit begins:
//   1. No new call starts (runNative answers its failure value at once).
//   2. The first will-quit that finds calls running holds the quit until they have exited, or
//      QUIT_WAIT_MS has passed. Every window is already closed by will-quit, so the wait is
//      invisible. A normal call finishes in well under a second; a slow card in a few.
//   3. Then the quit runs again, in full. Studio's before-quit handlers are idempotent sweeps,
//      so the second pass is safe.
//   4. If a call is STILL running when that quit completes, it is waiting on a device or host
//      that is not answering, and letting it return would crash the process. So the process ends
//      itself instead (process.kill on its own pid = TerminateProcess): no JavaScript and no
//      N-API code runs after that, and the kernel cancels the waiting request. Everything Studio
//      does on quit has already run by then.
// Outside Electron (tests, scripts) there is no app and nothing is hooked.
const _live = new Map();   // Worker -> promise that settles when it exits
const QUIT_WAIT_MS = 15000;
let _quitHooked = false;
let _quitting = false;
function _guardQuit() {
  if (_quitHooked) return;
  _quitHooked = true;
  let app = null;
  try { app = require('electron').app; } catch { app = null; }
  if (!app || typeof app.on !== 'function') return;
  app.on('before-quit', () => { _quitting = true; });
  let held = false;
  app.on('will-quit', (e) => {
    _quitting = true;
    if (held || _live.size === 0) return;
    held = true;
    e.preventDefault();
    const t0 = Date.now();
    console.log(`[native] quit held: ${_live.size} call(s) running`);
    const limit = new Promise((r) => setTimeout(r, QUIT_WAIT_MS));
    Promise.race([Promise.all([..._live.values()]), limit]).then(() => {
      console.log(`[native] quit resumed after ${Date.now() - t0} ms, ${_live.size} call(s) still running`);
      app.quit();
    });
  });
  app.on('quit', () => {
    if (_live.size === 0) return;
    console.log(`[native] ${_live.size} call(s) still running at exit: ending the process directly`);
    try { process.kill(process.pid); } catch { /* the normal exit goes ahead */ }
  });
}

module.exports = { runNative, serveNative, QUIT_WAIT_MS };
