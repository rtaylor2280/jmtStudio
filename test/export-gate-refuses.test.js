// The destination gate must actually REFUSE, not merely exist.  [B-478]
//
// WHY THIS FILE IS DIFFERENT FROM THE OTHER RENDERER TESTS. Every other one reads
// `renderer/index.html` as TEXT and asserts that a call is present. That is how a door can be
// "wired" in nine separate checks and still write 9.55 GB to a volume that cannot hold it: the
// call was there, the refusal was not reached, and no amount of grepping could tell the two
// apart. The reported failure was exactly that shape, and four theories about it were killed by
// static reading before it became obvious that static reading was the problem.
//
// So this EXECUTES the real `_sfPreflightDestination` body, lifted out of index.html, against
// the REAL `exportDestination.preflight`, with the arguments `_sfRunExport` actually passes for
// the backup door. Only the UI surfaces are stubbed. If the gate declines to refuse a job larger
// than the volume, this goes red without anyone running the app or writing a byte.
//
// Run: node test/export-gate-refuses.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const root = path.join(__dirname, '..');
const H = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

// ── lift the gate out of the page ───────────────────────────────────────────
function lift(decl) {
  const s = H.indexOf(decl);
  if (s < 0) throw new Error(`not found: ${decl}`);
  let i = H.indexOf(') {', s) + 2;
  let depth = 0, j = i;
  for (; j < H.length; j++) {
    const c = H[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return H.slice(s, j);
}
const src = lift('async function _sfPreflightDestination');
ok('the gate was lifted out of the page', src.length > 2000, `${src.length} chars`);

const CONST = /const SF_SLOW_WRITE_MIN_BYTES = ([^;]+);/.exec(H);
ok('the slow-write constant was read from the page, not guessed', !!CONST);
// eslint-disable-next-line no-eval
const SF_SLOW_WRITE_MIN_BYTES = eval(CONST[1]);

// ── stubs: only the UI, never the decision ──────────────────────────────────
const calls = { room: 0, unhealthy: 0, slow: 0, preflights: [] };
const noEl = { classList: { contains: () => false, add() {}, remove() {} }, style: {}, textContent: '' };
const progress = {
  barEl: () => null, detailEl: () => null, labelEl: () => null, elapsedEl: () => null,
  hide: async () => {}, show: async () => {}, setPhase() {}, hideNow() {},
};
const makeWindow = () => ({
  _sfDeleteProgress: progress,
  electronAPI: {
    // The real thing. This is the whole point: the decision is not stubbed.
    preflightExportDest: async (args) => {
      calls.preflights.push(args);
      const r = await require(path.join(root, 'exportDestination')).preflight(args.destDir, args);
      return { ok: true, result: r };
    },
  },
});

const buildGate = () => {
  const win = makeWindow();
  const factory = new Function(
    'window', 'document', 'console', 'SF_SLOW_WRITE_MIN_BYTES',
    '_sfRefuseNotEnoughRoom', '_sfRefuseUnhealthyDestination', '_sfSlowWriteDialog',
    '_sfDeleteProgress',
    `${src}; return _sfPreflightDestination;`
  );
  return factory(
    win,
    { getElementById: () => noEl },
    { warn() {}, log() {} },
    SF_SLOW_WRITE_MIN_BYTES,
    async () => { calls.room++; },
    async () => { calls.unhealthy++; },
    async () => { calls.slow++; return true; },
    progress
  );
};

(async () => {
  const gate = buildGate();
  const here = os.tmpdir();            // a real, measurable, local destination

  // How much room is actually here? The refusal has to be judged against the truth, not a guess.
  const d = await require(path.join(root, 'exportDestination')).describe(here);
  ok('the test destination reports free space', !!(d && d.ok && d.bytesFree > 0),
     'without a measurable destination this file proves nothing');
  const free = d.bytesFree;

  // ── the case that failed in the wild ──────────────────────────────────────
  // Called exactly as `_sfRunExport` calls it for an archive door: no fileSizes, a byte total
  // from the door's plan, fileCount 1 because an archive writes one file.
  {
    calls.room = 0;
    const tooBig = free + 64 * 1024 * 1024 * 1024;   // comfortably more than the volume holds
    const out = await gate({ destDir: here, totalBytes: tooBig, fileCount: 1 });
    ok('a job larger than the volume is REFUSED', out && out.proceed === false,
       'the gate returned proceed:true for a job that cannot fit - this is the reported failure');
    ok('and the refusal dialog is the one that ran', calls.room === 1, `room refusals: ${calls.room}`);
  }

  // ── the converse, so the check above is not passing for the wrong reason ──
  {
    calls.room = 0;
    const out = await gate({ destDir: here, totalBytes: 8 * 1024 * 1024, fileCount: 1 });
    ok('a job that fits is allowed through', out && out.proceed !== false);
    ok('and nothing was refused', calls.room === 0);
  }

  // ── the silent-pass conditions, named so they cannot hide again ───────────
  {
    calls.room = 0;
    const out = await gate({ destDir: '', totalBytes: free * 4, fileCount: 1 });
    ok('an empty destDir proceeds WITHOUT refusing, by design', out && out.proceed !== false,
       'documented here because it is indistinguishable from approval at the call site');
    ok('and it never reached a preflight', calls.room === 0);
  }
  {
    calls.room = 0;
    const out = await gate({ destDir: here, totalBytes: 0, fileCount: 1 });
    ok('a job of unknown size proceeds, by design', out && out.proceed !== false,
       'bytes 0 means "could not size it", never "it is empty"');
  }

  // ── the argument shape the runner uses must still reach the fit limb ──────
  // A rename or a reorder in `_sfRunExport`'s call would silently stop refusing, which is the
  // defect class this whole file exists for.
  {
    calls.preflights.length = 0;
    await gate({ destDir: here, totalBytes: free + 1024 ** 3, fileCount: 1 });
    const sent = calls.preflights[calls.preflights.length - 1] || {};
    ok('the gate forwards a real byte total to preflight',
       Number(sent.totalBytes) > 0, `forwarded: ${sent.totalBytes}`);
    ok('and does not smuggle an empty fileSizes array that would zero it',
       !Array.isArray(sent.fileSizes) || sent.fileSizes.length > 0,
       'an empty array wins over totalBytes in preflight and sums to 0, which skips the fit check');
  }

  console.log(failed ? `\n${failed} FAILED` : '\nexport-gate-refuses: all passing');
  process.exit(failed ? 1 : 0);
})();
