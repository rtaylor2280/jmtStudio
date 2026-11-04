// A common folder's Files list shows each file's standing against its source, as a font's does: one
// comparison for both. [B-313] [B-587]
'use strict';
const fs = require('fs');
const path = require('path');
const { fileStatesAgainstSource } = require('../soundFontFileHash');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const entries = fs.readFileSync(path.join(__dirname, '..', 'soundFontEntries.js'), 'utf8');
const common = fs.readFileSync(path.join(__dirname, '..', 'soundFontCommon.js'), 'utf8');
let failed = 0;
const check = (name, ok, extra) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  <- ' + (extra ?? '')}`); if (!ok) failed++; };

const rec = (relPath, fileHash) => ({ relPath, fileHash });
const source = [rec('pack/quote/a.wav', 'A'), rec('pack/quote/b.wav', 'B'), rec('pack/boot.wav', 'C'), rec('pack/gone.wav', 'D'), rec('other/x.wav', 'X')];
const live = [rec('quote/a.wav', 'A'), rec('quote/renamed.wav', 'B'), rec('boot.wav', 'CHANGED'), rec('mine/new.wav', 'N')];
const r = fileStatesAgainstSource(live, source, 'pack', { inSource: () => true });
const by = Object.fromEntries(r.files.map(f => [f.path, f]));
check('an added file', by['mine/new.wav']?.state === 'added', JSON.stringify(by));
check('a changed file', by['boot.wav']?.state === 'changed');
check('a rename is one row, under the new name', by['quote/renamed.wav']?.state === 'renamed' && by['quote/renamed.wav'].from === 'quote/b.wav' && !by['quote/b.wav']);
check('a removed file, and it can come back', by['gone.wav']?.state === 'removed' && by['gone.wav'].inSource === true);
check('an unchanged file has no state', !by['quote/a.wav']);
check('nothing outside the source folder counts', !r.files.some(f => f.path.includes('x.wav')));
check('the source\'s folders', r.sourceDirs.includes('quote') && !r.sourceDirs.includes('mine'), JSON.stringify(r.sourceDirs));
const skipped = fileStatesAgainstSource(live, source, 'pack', { skip: (k) => k === 'gone.wav' });
check('skip leaves a file out of removed', !skipped.files.some(f => f.path === 'gone.wav'));

check('fonts and commons share the comparison', /fileStatesAgainstSource\(em\.records, sm\.records, meta\.candidatePath/.test(entries)
  && /fh\.fileStatesAgainstSource\(cm\.records, sm\.records, meta\.sourceSubPath/.test(common));
check('the common tree asks for its states', /window\.electronAPI\.commonFileStates\(\{ uuid: _sfSelectedCommonUuid \}\)/.test(html));
check('the same colours and hover, in the common\'s words', /\.sf-tree-row \.sf-tree-name\.sf-file-state-custom/.test(html) && /_sfFileStateTip\(st, 'common folder'\)/.test(html));
check('a removed file adds back from its right-click', /window\.electronAPI\.restoreCommonFile\(\{ uuid: _sfSelectedCommonUuid, path: absentRow\.dataset\.absentPath \}\)/.test(html));

const os = require('os');
const { restoreCommonFileFromSource } = require('../soundFontCommon');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'common-restore-'));
const commonDir = path.join(ud, 'soundFonts', 'common', 'c1');
const srcDir = path.join(ud, 'soundFonts', 'sources', 's1', 'source', 'common');
fs.mkdirSync(path.join(commonDir, 'files'), { recursive: true });
fs.mkdirSync(path.join(srcDir, 'quote'), { recursive: true });
fs.writeFileSync(path.join(commonDir, 'meta.json'), JSON.stringify({ sourceUuid: 's1', sourceSubPath: 'common' }));
fs.writeFileSync(path.join(srcDir, 'quote', 'a.wav'), 'A');
const back = restoreCommonFileFromSource(ud, 'c1', 'quote/a.wav');
check('a file added back lands with the other files', back.ok && fs.existsSync(path.join(commonDir, 'files', 'quote', 'a.wav')) && !fs.existsSync(path.join(commonDir, 'quote')), JSON.stringify(back));
check('adding back over a file already there stops', restoreCommonFileFromSource(ud, 'c1', 'quote/a.wav').ok === false);
fs.rmSync(ud, { recursive: true, force: true });

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
