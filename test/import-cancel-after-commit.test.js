// [B-424] A CANCEL THAT ARRIVES AFTER THE SOURCE IS COMMITTED MUST STILL DISCARD IT.
//
// ⭐⭐ THE DEFECT, found by the dev pass 2026-10-07 and twice in one evening. Every checkpoint in
// `importSource` guarded work still IN PROGRESS. None guarded the moment just after the commit -
// meta written, candidates stamped - so a cancel landing there was noticed by nobody: the function
// returned `ok:true`, and the renderer's rollback was racing a main process that had been busy
// writing the very thing it was supposed to remove. Result on disk: a complete 25 MB source, then
// a complete 129 MB source, each with nothing in the library or commons pointing at it.
//
// ⭐ HIS RULE, which is what makes "too late" wrong here: *"if I click it, it should just discard
// on an import."* An import writes nothing to the user's card, so there is no point at which our
// copy cannot be thrown away. The "too late" instinct belongs to EXPORT, where bytes are
// already on the user's media.
//
// ⚠️ AND A CANCEL IS NOT A FAILURE. The catch reported every cancel as "Import failed: ...", which
// is the user's own click shown back to them as a red error.
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../soundFontSources.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
function wav(body) {
  const data = Buffer.alloc(32 * 1024, body);
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
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `jmt-b424-cac-${n}-`));
const sourcesRoot = (ud) => path.join(ud, 'soundFonts', 'sources');
const liveSources = (ud) => {
  const root = sourcesRoot(ud);
  if (!fs.existsSync(root)) return [];
  try { return fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory()); }
  catch { return []; }
};

(async () => {
  // ── 1. THE REGRESSION ──────────────────────────────────────────────────────
  {
    console.log('a cancel landing after the commit discards the committed source');
    const userData = tmp('ud');
    const src = tmp('font');
    put(src, 'MyFont/hum.wav', wav('H'));
    put(src, 'MyFont/swing.wav', wav('S'));
    put(src, 'MyFont/font.wav', wav('F'));

    // ⭐ FIRES ONLY ONCE A SOURCE IS COMMITTED. Returning true from the start would be caught by
    // an EARLY checkpoint and prove nothing about the one being added - the whole point is a
    // cancel that arrives too late for every guard that already existed.
    const shouldStop = () => {
      for (const d of liveSources(userData)) {
        if (fs.existsSync(path.join(sourcesRoot(userData), d, 'meta.json'))) return true;
      }
      return false;
    };

    const r = await S.importSource({
      userData, sourcePath: path.join(src, 'MyFont'), originalName: 'MyFont', metadata: {},
      shouldStop,
    });

    check('the import reports NOT ok', !!(r && r.ok === false), JSON.stringify(r));
    check('⭐ and reports it as CANCELLED, not failed',
      !!(r && r.cancelled === true),
      `a cancel surfaced as a failure: ${JSON.stringify(r)}`);
    check('⚠️ and does not say "Import failed"',
      !/Import failed/i.test(String((r && r.error) || '')), (r && r.error) || '');

    // ⭐⭐ THE ASSERTION THAT MATTERS. Before this fix the directory survived in full.
    const left = liveSources(userData);
    check('⭐⭐ nothing is left on disk', left.length === 0,
      `${left.length} source dir(s) survived the cancel: ${left.join(', ')} - this is the orphan`);

    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(src, { recursive: true, force: true }); } catch {}
  }

  // ── 2. THE CONTROL: an uncancelled import of the same shape must SURVIVE ───
  // ⚠️ Without this, a checkpoint that threw unconditionally would pass every check above.
  {
    console.log('\nthe same import, uncancelled, keeps its source');
    const userData = tmp('ud2');
    const src = tmp('font2');
    put(src, 'MyFont/hum.wav', wav('H'));
    put(src, 'MyFont/swing.wav', wav('S'));
    put(src, 'MyFont/font.wav', wav('F'));

    const r = await S.importSource({
      userData, sourcePath: path.join(src, 'MyFont'), originalName: 'MyFont', metadata: {},
      shouldStop: () => false,
    });

    check('the import succeeds', !!(r && r.ok), JSON.stringify(r && r.error));
    check('it is not flagged cancelled', !(r && r.cancelled), JSON.stringify(r));
    check('⭐ and the source is still there', liveSources(userData).length === 1,
      `expected exactly one source, found ${liveSources(userData).length}`);

    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(src, { recursive: true, force: true }); } catch {}
  }

  console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
  process.exit(failures ? 1 : 0);
})();
