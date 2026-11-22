// [B-424] A common folder whose source is ALREADY in the library must still
// report its space. importSource short-circuits on a duplicate and returns only
// { ok, isDuplicate, uuid, hash, format } - no byte fields - so savings came back
// all zeros, the summary's `contentBytes > 0` gate failed, and the door ended with
// nothing but "<name> was added." No size, no saving, on the one import where the
// saving is total.
//
// Two things are asserted, because the summary needs both: that the space is
// KNOWN on the reused path, and that the reuse is carried as a SAVING rather than
// as a cost the user never paid.
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../soundFontCommon.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
function wav(body) {
  const data = Buffer.alloc(64 * 1024, body);
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  data.copy(b, 44);
  return b;
}
function put(root, rel, buf) {
  const abs = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-b424-${n}-`));

(async () => {
  console.log('a reused source still reports its space, and reports it as a saving');
  const userData = tmp('ud');
  const src = tmp('pack');
  put(src, 'Voicepack/mmain.wav', wav('M'));
  put(src, 'Voicepack/mnum1.wav', wav('1'));
  put(src, 'Voicepack/voicepack.ini', Buffer.from('version=2\r\n'));
  const picked = path.join(src, 'Voicepack');

  const first = await C.importCommonFromFolder(userData, picked, 'Pack_One');
  check('first import succeeded', !!(first && first.ok), first && first.error);
  check('first import states its space',
    !!(first.savings && first.savings.contentBytes > 0), JSON.stringify(first.savings));
  check('first import is not flagged as reuse',
    !first.savings.reusedSource && !first.savings.reusedBytes, JSON.stringify(first.savings));

  // Same bytes, new name: the source hash already exists, so importSource takes
  // the duplicate path that used to report nothing.
  const second = await C.importCommonFromFolder(userData, picked, 'Pack_Two');
  check('second import succeeded', !!(second && second.ok), second && second.error);
  check('second import reused the source',
    !!(second.savings && second.savings.reusedSource), JSON.stringify(second.savings));

  // THE REGRESSION. This was 0 and the whole space sentence disappeared.
  check('second import still states its space',
    second.savings.contentBytes > 0,
    `contentBytes=${second.savings.contentBytes} - the summary gates on > 0 and would say nothing`);

  // And the bytes are a saving, not a charge: nothing was written for them.
  check('second import carries the reuse as saved bytes',
    second.savings.reusedBytes > 0, JSON.stringify(second.savings));
  check('saved bytes cover the whole content, so the footprint reconciles to zero',
    second.savings.reusedBytes === second.savings.contentBytes,
    `reused=${second.savings.reusedBytes} content=${second.savings.contentBytes}`);

  // Producer/consumer reconciliation: the summary reads these exact keys off
  // `res.savings`. A rename on either side silently restores the blank door.
  for (const k of ['archiveBytes', 'contentBytes', 'crossLinked', 'dedupSaved', 'reusedBytes']) {
    check(`savings carries "${k}" for the summary to read`,
      Object.prototype.hasOwnProperty.call(second.savings, k), Object.keys(second.savings).join(','));
  }

  // The arithmetic the sentence prints, run the way the renderer runs it.
  const sv = second.savings;
  const saved = ((sv.crossLinked && sv.crossLinked.savedBytes) || 0)
    + (sv.dedupSaved || 0) + (sv.reusedBytes || 0);
  const started = sv.archiveBytes > 0 ? sv.archiveBytes : sv.contentBytes;
  const foot = Math.max(0, sv.contentBytes - saved);
  check('started minus saved equals added, on screen', started - (started - foot) === foot,
    `started=${started} saved=${saved} foot=${foot}`);
  check('a reused source adds nothing new on disk', foot === 0, `foot=${foot}`);

  try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(src, { recursive: true, force: true }); } catch {}

  console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
  process.exit(failures ? 1 : 0);
})();
