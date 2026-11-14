// [B-677] Two reads of the same card path that overlap must both get the real answer.
// An export door primes the volume info while the export preflight checks the same volume, so two
// reads of \\.\E: overlap in normal use; the second one used to answer 'timeout' at once and the
// preflight refused the export of a working card.
// The [B-669] guarantee still holds: a read that never returns answers 'timeout' after its own time
// limit, and the stuck path is not given a second worker. Workers are counted by wrapping the
// Worker class before cardProbe captures it; a named pipe that never writes stands in for a hung
// card, as in card-probe-timeout.test.js.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const wt = require('worker_threads');

const started = [];
const RealWorker = wt.Worker;
wt.Worker = class CountingWorker extends RealWorker {
  constructor(src, opts) { super(src, opts); started.push(opts && opts.workerData && opts.workerData.path); }
};
const { readHead } = require('../cardProbe');
wt.Worker = RealWorker;

const workersFor = (p) => started.filter((x) => x === p).length;

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

(async () => {
  await check('two overlapping reads of one path both get the real bytes, from one worker', async () => {
    const f = path.join(os.tmpdir(), `card-probe-shared-${process.pid}.bin`);
    fs.writeFileSync(f, Buffer.from('FAT32 boot sector stand-in'));
    const [a, b] = await Promise.all([readHead(f, 5), readHead(f, 5)]);
    fs.unlinkSync(f);
    assert.strictEqual(a.ok, true, 'first read: ' + JSON.stringify(a));
    assert.strictEqual(b.ok, true, 'second read answered ' + JSON.stringify(b) + ' instead of the bytes');
    assert.strictEqual(a.buf.toString('ascii'), 'FAT32');
    assert.strictEqual(b.buf.toString('ascii'), 'FAT32');
    assert.strictEqual(workersFor(f), 1, `started ${workersFor(f)} workers`);
  });

  await check('a joining read that asks for fewer bytes gets only those', async () => {
    const f = path.join(os.tmpdir(), `card-probe-shared-len-${process.pid}.bin`);
    fs.writeFileSync(f, Buffer.from('FAT32 boot sector stand-in'));
    const [a, b] = await Promise.all([readHead(f, 9), readHead(f, 3)]);
    fs.unlinkSync(f);
    assert.strictEqual(a.buf.toString('ascii'), 'FAT32 boo');
    assert.strictEqual(b.buf.toString('ascii'), 'FAT');
  });

  await check('once a read has settled, the next read of that path starts fresh', async () => {
    const f = path.join(os.tmpdir(), `card-probe-shared-again-${process.pid}.bin`);
    fs.writeFileSync(f, Buffer.from('first'));
    const a = await readHead(f, 5);
    fs.writeFileSync(f, Buffer.from('again'));
    const b = await readHead(f, 5);
    fs.unlinkSync(f);
    assert.strictEqual(a.buf.toString('ascii'), 'first');
    assert.strictEqual(b.buf.toString('ascii'), 'again');
    assert.strictEqual(workersFor(f), 2);
  });

  if (process.platform !== 'win32') {
    console.log('  skip hung-read checks (named pipe stand-in is Windows only)');
  } else {
    const pipe = `\\\\.\\pipe\\jmt-card-probe-shared-${process.pid}`;
    const held = [];
    const server = net.createServer((sock) => { held.push(sock); });   // accepts, never writes
    await new Promise((res) => server.listen(pipe, res));

    await check('a hung read: an overlapping caller waits for the same limit and answers timeout, one worker', async () => {
      const t0 = Date.now();
      const first = readHead(pipe, 512, { timeoutMs: 400 });
      await new Promise((res) => setTimeout(res, 100));
      const second = readHead(pipe, 512, { timeoutMs: 400 });
      const [a, b] = await Promise.all([first, second]);
      const took = Date.now() - t0;
      assert.strictEqual(a.reason, 'timeout');
      assert.strictEqual(b.reason, 'timeout');
      assert.ok(took >= 380 && took < 3000, `took ${took} ms`);
      assert.strictEqual(workersFor(pipe), 1, `started ${workersFor(pipe)} workers`);
    });

    await check('after the limit, a read of the still-stuck path answers at once without a new worker', async () => {
      const t0 = Date.now();
      const r = await readHead(pipe, 512, { timeoutMs: 400 });
      assert.strictEqual(r.reason, 'timeout');
      assert.strictEqual(r.stillWaiting, true);
      assert.ok(Date.now() - t0 < 100, 'answered at once');
      assert.strictEqual(workersFor(pipe), 1, `started ${workersFor(pipe)} workers`);
    });

    for (const s of held) s.destroy();
    server.close();
  }

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
