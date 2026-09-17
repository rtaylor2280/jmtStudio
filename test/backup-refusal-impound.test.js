/**
 * A backup acts on what it refuses, and records a hash of what it carried  [B-394]
 *
 * ⭐ WHAT HE SAW, 2026-09-16, testing backup export/import: after a full REPLACE - which
 * wipes the library and restores the backup exactly - the import dialog STILL read
 * "335 items match, 2 differ". His words: "shouldn't have been possible to be different
 * unless backup is not backing up everything."
 *
 * It was backing up everything. Verified read-only at the time: both trees byte-identical,
 * nothing missing, all nine compared meta fields equal across 151 entries. What lied was
 * the hash the backup recorded ABOUT ITSELF.
 *
 * ⚠️⚠️ TWO PASSES OVER ONE TREE, DISAGREEING:
 *     count/archive  (soundFontBackup)   checkCarryableFile DECLINES blocked files
 *     hash/signals   (soundFontEntries)  no carry test at all - counts everything
 * So any item holding a refused file recorded a hash describing a SUPERSET of the
 * archive, permanently, and every later import reported a phantom conflict on files that
 * are identical.
 *
 * ⭐⭐ AND THE SECOND HALF IS HIS, AND IT IS UPSTREAM OF THE FIRST: "if we refuse to send
 * a file to a backup... because it's potentially harmful and bad... then it should have
 * told me, and deleted not just failed to export. and then it would not mismatch."
 * Remove the file and there is nothing left to reconcile.
 *
 * ⚠️ NOT A NEW DESIGN - A MISSED DOOR. [B-364] already built impound/Delete/Quarantine and
 * its close-out names the doors it was dev-tested across: "right-click export, whole-font
 * export, common, shared tracks and the source close-out". Backup is not in that list.
 * "We already covered this, but missed this use case and hadn't ever tested."
 *
 * ⭐ AND BACKUP IS THE ONLY PATH THAT WALKS THE WHOLE MANAGED STORE, so it is also the
 * only full sweep - the one thing that can find a finding in a library that predates the
 * guards, which no per-operation door ever tested.
 *
 * Run: node test/backup-refusal-impound.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const backup  = fs.readFileSync(path.join(ROOT, 'soundFontBackup.js'), 'utf8');
const html    = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const removal = require(path.join(ROOT, 'soundFontRemoval.js'));
const { collectFileRecords, hashRecords } = require(path.join(ROOT, 'soundFontFileHash.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// ── 1. the recorded hash describes the CARRIED set ─────────────────────────
{
  ok('the export hashes the carried set when anything was refused',
     /_refusedUnder\(abs\)\) return _carriedHash\(abs\)/.test(backup));
  ok('⭐ and only then - a clean item keeps the cached fast path',
     /if \(bucket !== 'attachments' && _refusedUnder\(abs\)\)/.test(backup),
     'recomputing every item would undo the persistent-hash work in B-315');
  ok('the carried hash uses the same canonical serialization',
     /collectFileRecords\(abs, null, keep\)/.test(backup) && /hashRecords\(records\)/.test(backup),
     'a different fold would make a clean item hash differently on the two paths');

  // Run it for real: identical content, one declined file, three digests.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b394-hash-'));
  const item = path.join(tmp, 'Ani-Mation');
  fs.mkdirSync(item, { recursive: true });
  fs.writeFileSync(path.join(item, 'hum.wav'), 'RIFF....audio');
  fs.writeFileSync(path.join(item, 'swing.wav'), 'RIFF....more');
  const bad = path.join(item, 'worm.exe');
  fs.writeFileSync(bad, 'MZ\x90\x00 program');

  const whole   = hashRecords(collectFileRecords(item));
  const refused = new Set([bad]);
  const keep    = (rel) => !refused.has(path.join(item, rel.split('/').join(path.sep)));
  const carried = hashRecords(collectFileRecords(item, null, keep));
  fs.unlinkSync(bad);
  const archived = hashRecords(collectFileRecords(item));

  ok('the whole-tree hash does NOT match the archive (this was the bug)', whole !== archived,
     'if these ever match, the fixture stopped containing a declinable file');
  ok('⭐⭐ the carried hash DOES match what the archive holds', carried === archived);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 2. a refusal is addressable by the removal module ──────────────────────
//
// ⚠️ THE ROOTS DIFFER PER KIND AND THAT IS THE WHOLE RISK. soundFontRemoval addresses
// (kind, id, relPath) against its own root, and two of them carry a subdirectory the
// bucket-relative path does not know about:
//     entry  -> library/<id>          common -> common/<id>/files
//     source -> sources/<id>/source   sharedTracks -> sharedTracks
// Get this wrong and a deletion points at the wrong file.
{
  ok('the export records the managed kind per refusal',
     /_kind = bucket === 'library' \? 'entry'/.test(backup));
  ok('⭐ and strips the store subdirectory for source and common',
     /bucket === 'sources' && _segs\[0\] === 'source'/.test(backup)
     && /bucket === 'common' && _segs\[0\] === 'files'/.test(backup),
     'without this the relPath escapes the item root and the removal is refused');
  ok('shared tracks carry no id',
     /_kind: 'sharedTracks', _id: '',/.test(backup));
  ok('⭐ the renderer addresses the store, not the bucket',
     /const relPath = String\(x\._itemRel \|\| x\.relPath/.test(html),
     'relPath stays bucket-relative so the REPORT can say where it came from');

  // Exercise the real module against a real store, one of every kind.
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b394-store-'));
  const SF = path.join(ud, 'soundFonts');
  const mk = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  const cases = [
    ['entry',        'Ani-Mation', 'worm.exe', ['library','Ani-Mation','worm.exe'],          ['library','Ani-Mation','hum.wav']],
    ['source',       'src-uuid',   'worm.exe', ['sources','src-uuid','source','worm.exe'],   ['sources','src-uuid','source','hum.wav']],
    ['common',       'com-uuid',   'worm.exe', ['common','com-uuid','files','worm.exe'],     ['common','com-uuid','files','boot.wav']],
    ['sharedTracks', '',           'worm.exe', ['sharedTracks','worm.exe'],                  ['sharedTracks','trk.wav']],
  ];
  for (const [, , , badRel, goodRel] of cases) {
    mk(path.join(SF, ...badRel),  'MZ\x90\x00prog');
    mk(path.join(SF, ...goodRel), 'RIFFaudio');
  }
  for (const [kind, id, rel, badRel] of cases) {
    const abs = path.join(SF, ...badRel);
    const existed = fs.existsSync(abs);
    let r; try { r = removal.impoundProgram(ud, { kind, id, relPath: rel }); }
    catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    ok(`${kind} — impound resolves and removes it`,
       existed && r && r.ok && !fs.existsSync(abs), JSON.stringify(r).slice(0, 110));
  }
  ok('⭐⭐ the audio beside it survives in all four stores',
     cases.every(([, , , , goodRel]) => fs.existsSync(path.join(SF, ...goodRel))),
     'a wrong relPath would take the neighbour instead');
  fs.rmSync(ud, { recursive: true, force: true });
}

// ── 3. the export REPORTS it, which is what it never did ───────────────────
{
  // ⚠️ MATCHES THE FIELD, NOT THE WHOLE RETURN SHAPE. The first cut of this pinned the
  // literal `return { destPath, manifest, refused }` and broke the day [B-399] added a
  // fourth field beside it — a red suite over a change that could not possibly have
  // dropped the refusals. An assertion should fail for the reason it is named after.
  ok('exportBackup still returns its refusals',
     /return \{ destPath, manifest, refused[,\s}]/.test(backup));
  ok('⭐⭐ and the export path now consumes them',
     /const _bkRefused = \(result && result\.refused\) \|\| \[\];/.test(html)
     && /_sfShowProgramRefusal\(\{\s*\n?\s*refused: _bkRefused/.test(html),
     'it read only ok/error/cancelled/residualPath and dropped the list on the floor');
  ok('⭐ the completion folds INTO that dialog rather than showing two',
     /prefixHtml: `<div>\$\{_sfEscape\(completionMessage\)/.test(html),
     'B-370: "done and continue are to be replaced, combine into one message"');

  // The dialog it routes into is the one that removes first and cannot be declined.
  const dlg = html.slice(html.indexOf('const _sfShowProgramRefusal'),
                         html.indexOf('const _sfShowProgramRefusal') + 9000);
  ok('⚠️ that dialog impounds BEFORE it reports',
     /const impounded = state \|\| await _sfImpoundRefusals/.test(dlg),
     'removal behind a dialog leaves dismissing it as a way to keep a program');
  ok('⚠️ and offers no way to decline', /hideCancel: true/.test(dlg)
     && /confirmText: 'Delete'/.test(dlg) && /altText: 'Quarantine…'/.test(dlg),
     'the choice is how it ends, never whether');
}


// ── ⚠️ THE THROW THAT HID ALL OF IT  [B-395] ──────────────────────────────
//
// The first run of this work produced NO dialog at all. Not a wiring failure - a
// pre-existing ReferenceError one line above it:
//     Uncaught (in promise) ReferenceError: startMs is not defined
//         at _sfRunExportBackup (index.html:38978)
// `_sfRunExportBackup` has no local `startMs`; its clock lives on the `state` object it
// shares with the 1s tick. Four sibling sites declare `const startMs` locally, this one
// never did, and the read sits at the very END of a SUCCESSFUL export - so it threw only
// after a full backup completed, and everything after it (including the refusal dialog)
// never ran. Present in HEAD, not introduced by this work.
//
// ⭐ IT ALSO EXPLAINS A SILENT ONE EARLIER THE SAME DAY: his 15GB export "finished" and
// he never saw Export complete. The zip was written; the dialog threw.
{
  const fn = html.slice(html.indexOf('const _sfRunExportBackup = async'),
                        html.indexOf('const _sfRunExportBackup = async') + 14000);
  ok('⚠️ the export clock reads the state object',
     /Date\.now\(\) - state\.startMs/.test(fn), 'a bare startMs is not in this scope');
  ok('⭐ and no bare startMs survives in this function',
     !/Date\.now\(\) - startMs/.test(fn),
     'it throws only on the success path, which is why nothing ever caught it');
}

// ── ⚠️⚠️ THE SECOND NAME IS NOT A FAILURE  [B-394] ────────────────────────
//
// ⭐ WHAT HE SAW, 2026-09-16, on the first full export after the fix above: the dialog
// reported three findings removed and then, in red, "1 could not be removed:
// 8.21打印.rar". His question was the right one - "is the .rar really still in my
// library?" It was not. Swept: no .rar, .exe or trk99.wav anywhere in the store.
//
// ⚠️ THE STORE HARDLINKS ONE FILE INTO SEVERAL BUCKETS ([B-315]), so that .rar wore two
// names - library/Ahsoka_2/ and sources/<uuid>/source/. The backup correctly refused it
// once PER BUCKET, and `_unlinkAndSweep` deliberately removes EVERY name `_findAllNames`
// reaches, because leaving one behind would leave the program in the library. So record
// two arrived at a path record one had already removed, `resolveManagedFile` said "File
// not found", and a complete success was reported as a failure.
//
// ⭐⭐ THE DIRECTION OF THE LIE IS THE WHOLE POINT. It told him a program had survived in
// his library - the one outcome we can actually PROVE did not happen. His quarantine
// README proved it at the time: one quarantine file, both paths listed under `Found in:`.
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'b394-link-'));
  const SF = path.join(ud, 'soundFonts');
  const entryAbs = path.join(SF, 'library', 'Ahsoka_2', 'vendor.rar');
  const srcAbs   = path.join(SF, 'sources', 'uuid-1', 'source', 'vendor.rar');
  fs.mkdirSync(path.dirname(entryAbs), { recursive: true });
  fs.mkdirSync(path.dirname(srcAbs),   { recursive: true });
  fs.writeFileSync(entryAbs, 'Rar!\x1a\x07\x00 opaque archive bytes');
  fs.writeFileSync(path.join(path.dirname(entryAbs), 'hum.wav'), 'RIFFaudio');

  let linked = true;
  try { fs.linkSync(entryAbs, srcAbs); } catch { linked = false; }
  ok('the fixture really is hardlinked (nlink 2)',
     linked && fs.statSync(entryAbs).nlink === 2,
     'without a real link this test proves nothing - it would just be two files');

  if (linked) {
    const first = removal.impoundProgram(ud, { kind: 'entry', id: 'Ahsoka_2', relPath: 'vendor.rar' });
    ok('the first refusal impounds it', first && first.ok, JSON.stringify(first).slice(0, 140));
    ok('⚠️ and the sweep takes BOTH names, which is what creates the second record',
       !fs.existsSync(entryAbs) && !fs.existsSync(srcAbs),
       'if only one name went, a program is still in the library and the rest is moot');

    // The batch's second record for the same file, addressed through the other bucket.
    const second = removal.impoundProgram(ud, { kind: 'source', id: 'uuid-1', relPath: 'vendor.rar' });
    ok('⭐⭐ the second refusal reports SUCCESS, not "could not be removed"',
       second && second.ok === true,
       'this is the exact line his dialog got wrong: ' + JSON.stringify(second).slice(0, 140));
    ok('⭐ and says so honestly - already impounded, nothing removed by this call',
       second && second.alreadyImpounded === true && second.nameCount === 0);
    ok('⭐⭐ and resolves to the SAME token, so it is one finding and not two',
       second && first && second.token === first.token,
       'a second token would copy one file into the quarantine folder twice');
    ok('it carries the original finding forward', second && second.sha256 === first.sha256);
    ok('⭐ the audio beside it is untouched',
       fs.existsSync(path.join(path.dirname(entryAbs), 'hum.wav')));

    // A genuine error must still surface as one.
    const bogus = removal.impoundProgram(ud, { kind: 'entry', id: 'Ahsoka_2', relPath: 'never-existed.exe' });
    ok('⚠️ a path we never impounded still fails',
       bogus && bogus.ok === false,
       'the holding-area lookup must not turn every missing file into a success');
    const esc = removal.impoundProgram(ud, { kind: 'entry', id: 'Ahsoka_2', relPath: '../../escape.exe' });
    ok('⚠️ and an escaping path is still refused outright', esc && esc.ok === false);
  }
  fs.rmSync(ud, { recursive: true, force: true });
}

// The renderer side of the same finding: one token is one row, however many names it wore.
{
  const fn = html.slice(html.indexOf('const _sfImpoundRefusals = async'),
                        html.indexOf('const _sfImpoundRefusals = async') + 3000);
  ok('⭐ the batch de-duplicates held findings by token',
     /if \(!held\.some\(h => h\.token === r\.token\)\)/.test(fn),
     'two records sharing a token would count one program as two');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall backup refusal + hash tests passed');
process.exit(failures ? 1 : 0);
