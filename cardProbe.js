// Reads the first bytes of a card (a raw volume such as \\.\E:, or a file on it) without ever
// blocking the main process [B-669]. The read runs in a worker thread with a time limit. A reader
// or card that stops answering leaves that worker waiting in the kernel, where nothing can end it,
// but the app goes on and the caller gets { ok: false, reason: 'timeout' }.
//
// While a read on a path is still waiting, a new read on the same path is not started: it answers
// 'timeout' at once, so a stuck card costs one waiting thread, not one per probe.
const { Worker } = require('worker_threads');

const DEFAULT_TIMEOUT_MS = 4000;
const _waiting = new Set();

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
let fd;
try {
  fd = fs.openSync(workerData.path, 'r');
  const buf = Buffer.alloc(workerData.length);
  const n = fs.readSync(fd, buf, 0, workerData.length, 0);
  parentPort.postMessage({ ok: true, bytes: buf.subarray(0, n) });
} catch (e) {
  parentPort.postMessage({ ok: false, reason: 'error', code: e && e.code });
} finally {
  try { if (fd !== undefined) fs.closeSync(fd); } catch {}
}
`;

// Resolves { ok: true, buf } | { ok: false, reason: 'timeout' | 'error', code? }. Never rejects.
function readHead(path, length, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (_waiting.has(path)) return Promise.resolve({ ok: false, reason: 'timeout', stillWaiting: true });
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const settle = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let w;
    try {
      w = new Worker(WORKER_SRC, { eval: true, workerData: { path, length } });
    } catch {
      settle({ ok: false, reason: 'error' });
      return;
    }
    _waiting.add(path);
    w.unref();
    const release = () => _waiting.delete(path);
    w.on('message', (m) => {
      release();
      settle(m && m.ok ? { ok: true, buf: Buffer.from(m.bytes) } : { ok: false, reason: 'error', code: m && m.code });
      w.terminate().catch(() => {});
    });
    w.on('error', () => { release(); settle({ ok: false, reason: 'error' }); });
    w.on('exit', () => { release(); settle({ ok: false, reason: 'error' }); });
    timer = setTimeout(() => settle({ ok: false, reason: 'timeout' }), timeoutMs);
  });
}

function isWaiting(path) { return _waiting.has(path); }

module.exports = { readHead, isWaiting, DEFAULT_TIMEOUT_MS };
