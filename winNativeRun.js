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
// Electron's shutdown stops every worker still running, and a worker stopped inside koffi takes
// the process down with the fatal N-API error above (measured: app.quit() with calls in flight,
// exit 0x86). So the first will-quit that finds workers running holds the quit until they have
// exited, or QUIT_WAIT_MS has passed, and then quits again. A normal call finishes in well under
// a second. A worker waiting on a wedged device past the limit is not waited for: the quit goes
// ahead, and the shutdown waits on that call as it would on any thread in the kernel.
// Studio's before-quit handlers are idempotent sweeps, so the second quit is safe to run.
// Outside Electron (tests, scripts) there is no app and nothing is hooked.
const _live = new Map();   // Worker -> promise that settles when it exits
const QUIT_WAIT_MS = 3000;
let _quitHooked = false;
function _guardQuit() {
  if (_quitHooked) return;
  _quitHooked = true;
  let app = null;
  try { app = require('electron').app; } catch { app = null; }
  if (!app || typeof app.on !== 'function') return;
  let held = false;
  app.on('will-quit', (e) => {
    if (held || _live.size === 0) return;
    held = true;
    e.preventDefault();
    const limit = new Promise((r) => setTimeout(r, QUIT_WAIT_MS));
    Promise.race([Promise.all([..._live.values()]), limit]).then(() => app.quit());
  });
}

module.exports = { runNative, serveNative, QUIT_WAIT_MS };
