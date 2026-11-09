// A common folder is the third thing a config names exactly ("Nomad;common"), so it gets what fonts
// and tracks got: the same-pack check by CONTENT on import (a fresh download of a pack you have is
// a different zip with the same sounds), a version beside on import anyway, aliases (kept-match and
// rename), and the config check. Real pipeline where it matters. [B-643]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'soundFontCommon'));
const S = require(path.join(ROOT, 'soundFontSources'));
let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
function wav(payload) {
  const data = Buffer.from(payload);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii'); head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(44100, 24); head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-cpack-' + t + '-'));
const pack = (dir, names, extra = {}) => {
  fs.mkdirSync(path.join(dir, 'common'), { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(dir, 'common', `${n}.wav`), wav(`VOICE-${n}`));
  for (const [n, body] of Object.entries(extra)) fs.writeFileSync(path.join(dir, 'common', n), body);
  return dir;
};
const VOICE = Array.from({ length: 20 }, (_, i) => `v${i}`);

(async () => {
  const ud = tmp('ud');
  console.log('1. the first import builds a common as always');
  const a = await C.importCommonFromFolder(ud, pack(tmp('dl1'), VOICE), 'Ezra', undefined, null, { askOnDuplicate: true });
  check('imported', a && a.ok && !a.isDuplicate && a.uuid, JSON.stringify(a));

  console.log('2. a fresh download of the same pack: asked, not built');
  // Byte-identical apart from OS clutter: the older archive check catches it, and hands back the name.
  const same = await C.importCommonFromFolder(ud, pack(tmp('dlx'), VOICE, { 'desktop.ini': '[x]' }), 'Ezra_x', undefined, null, { askOnDuplicate: true });
  check('an identical folder is caught by the archive check, with the incoming name for the alias',
    same && same.isDuplicate && same.incomingName === 'Ezra_x' && same.existingCommons[0].uuid === a.uuid, JSON.stringify(same));
  const dl2 = pack(tmp('dl2'), VOICE, { 'a_ReadMe.txt': 'a different readme' });   // a different download, same sounds
  const b = await C.importCommonFromFolder(ud, dl2, 'Ezra_2', undefined, null, { askOnDuplicate: true });
  check('it says the pack is already in the library, naming the common', b && b.ok && b.isDuplicate && b.sameContent
    && b.existingCommons.length === 1 && b.existingCommons[0].uuid === a.uuid, JSON.stringify(b));
  check('nothing new was left behind: one common, one source',
    C.listCommons(ud).length === 1 && S.listSources(ud).length === 1, `${C.listCommons(ud).length} / ${S.listSources(ud).length}`);

  console.log('3. import anyway: a version beside it, on the SAME source');
  const c = await C.importCommonFromFolder(ud, dl2, 'Ezra_card', undefined, null, { besideOf: a.uuid });
  check('built', c && c.ok && c.uuid && c.besideOf === 'Ezra', JSON.stringify(c));
  const cm = C.getCommon(ud, c.uuid);
  check('on the matched common\'s source, not its own', cm && cm.meta.sourceUuid === a.sourceUuid, JSON.stringify(cm && cm.meta));
  check('still one source', S.listSources(ud).length === 1, String(S.listSources(ud).length));

  console.log('4. a different pack is not the same pack');
  const other = await C.importCommonFromFolder(ud, pack(tmp('dl3'), Array.from({ length: 20 }, (_, i) => `x${i}`)), 'Bane', undefined, null, { askOnDuplicate: true });
  check('Bane imports as its own', other && other.ok && !other.isDuplicate, JSON.stringify(other));
  const half = await C.importCommonFromFolder(ud, pack(tmp('dl4'), [...VOICE.slice(0, 6), ...Array.from({ length: 14 }, (_, i) => `y${i}`)]), 'Mixed', undefined, null, { askOnDuplicate: true });
  check('a pack sharing 6 of 20 sounds is not Ezra', half && half.ok && !half.isDuplicate, JSON.stringify(half));

  console.log('5. aliases');
  let r = C.addCommonAlias(ud, a.uuid, 'common');
  check('a kept match records the incoming name', r.ok && r.changed && JSON.stringify(C.getCommon(ud, a.uuid).meta.aliases) === '["common"]');
  r = C.addCommonAlias(ud, a.uuid, 'Ezra');
  check('never its own name', r.ok && r.changed === false);
  C.renameCommon(ud, a.uuid, 'Ezra_Bridger');
  check('a rename keeps the old name', JSON.stringify(C.getCommon(ud, a.uuid).meta.aliases) === '["Ezra","common"]', JSON.stringify(C.getCommon(ud, a.uuid).meta.aliases));
  r = C.forgetCommonAlias(ud, a.uuid, 'COMMON');
  check('forget removes one, any case', r.ok && r.changed && JSON.stringify(C.getCommon(ud, a.uuid).meta.aliases) === '["Ezra"]');

  console.log('5b. a card common carrying OS clutter is still recognised (renamed, too)');
  const cardC = pack(tmp('cardc'), Array.from({ length: 20 }, (_, i) => `x${i}`), { 'desktop.ini': '[.ShellClassInfo]' });
  fs.writeFileSync(path.join(cardC, 'common', 'Thumbs.db'), 'x');
  const cls = C.classifyIncomingCommon(ud, cardC);
  check('owned by content: Bane, whatever its name, desktop.ini on the card or not',
    cls.ownedByContent && cls.matchName === 'Bane', JSON.stringify(cls));

  console.log('6. wiring');
  {
    const h = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    check('the card review\'s owned common says what you have it as, like a font row, not just "skipped"',
      /note\.textContent = `Already in your library\$\{_as\}`;/.test(h) && !/note\.textContent = owned \? 'skipped' : '';/.test(h));
  }
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  check('both import doors pass besideOf', (main.match(/besideOf: besideOf \|\| null \}\);/g) || []).length === 2);
  check('the dialog: kept = alias, import anyway = beside one matched common',
    /const onCancel = \(\) => \{ cleanup\(\); _recordAlias\(\); resolve\(\); \};/.test(html)
    && /if \(_one && _one\.uuid\) await _sfImportCommon\(mode, false, _again, linkUrl, _one\.uuid\);/.test(html));
  check('the config check covers common folders, one edit per preset with fonts',
    /rows\.push\(\{ kind: 'common', lc, d, owners, count \}\);/.test(html) && /_fontEdits = _sfFontListEdits\(editor\.getValue\(\), fontTo, commonTo\);/.test(html)
    && /forgetCommonAlias\(\{ uuid: e\.uuid, alias: p\.row\.d \}\)/.test(html));

  try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
