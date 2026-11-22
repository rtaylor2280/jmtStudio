// [B-669] A card read that never returns must not block the main process.
// A named pipe whose server never writes blocks a read the way a hung card reader does
// (measured 2026-11-13: open 3 ms, read never returned), so the timeout path runs for real.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { readHead } = require('../cardProbe');

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

(async () => {
  await check('reads the first bytes of an ordinary file', async () => {
    const f = path.join(os.tmpdir(), `card-probe-${process.pid}.bin`);
    fs.writeFileSync(f, Buffer.from('FAT32 boot sector stand-in'));
    const r = await readHead(f, 5);
    fs.unlinkSync(f);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.buf.toString('ascii'), 'FAT32');
  });

  await check('a missing path answers error, not timeout', async () => {
    const r = await readHead(path.join(os.tmpdir(), 'no-such-card-' + process.pid), 512, { timeoutMs: 2000 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'error');
  });

  if (process.platform !== 'win32') {
    console.log('  skip hung-read checks (named pipe stand-in is Windows only)');
  } else {
    const pipe = `\\\\.\\pipe\\jmt-card-probe-${process.pid}`;
    const held = [];
    const server = net.createServer((sock) => { held.push(sock); });   // accepts, never writes
    await new Promise((res) => server.listen(pipe, res));

    await check('a read that never returns answers timeout, and the main loop keeps running', async () => {
      let ticks = 0;
      const iv = setInterval(() => { ticks++; }, 20);
      const t0 = Date.now();
      const r = await readHead(pipe, 512, { timeoutMs: 400 });
      const took = Date.now() - t0;
      clearInterval(iv);
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, 'timeout');
      assert.ok(took >= 380 && took < 3000, `took ${took} ms`);
      // A blocked main thread would have run the interval zero or one times.
      assert.ok(ticks >= 10, `main loop ticked only ${ticks} times during the wait`);
    });

    await check('a second read of the same stuck path does not start another worker', async () => {
      const t0 = Date.now();
      const r = await readHead(pipe, 512, { timeoutMs: 400 });
      assert.strictEqual(r.reason, 'timeout');
      assert.strictEqual(r.stillWaiting, true);
      assert.ok(Date.now() - t0 < 100, 'answered at once');
    });

    for (const s of held) s.destroy();
    server.close();
  }

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
