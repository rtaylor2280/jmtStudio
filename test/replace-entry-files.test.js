/**
 * Replace from folder: a font's files swap for a folder's, the font itself stays  [B-585]
 *
 * The ask: bringing curated versions in over stock fonts meant add-then-delete, which loses the
 * name, tags, notes, links and place in the source. Replace changes only the files.
 *
 * Run: node test/replace-entry-files.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-replace-'));
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'electron') return { app: { getPath: () => userData, isPackaged: false } };
  return origLoad.call(this, req, ...a);
};
const entries = require(path.join(__dirname, '..', 'soundFontEntries.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}
function put(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }

const root = entries.ensureEntriesRoot(userData);
const fontDir = path.join(root, 'OB_EP3');
const meta0 = {
  schemaVersion: 1, entryUuid: 'u-123', name: 'OB_EP3', sourceUuid: 's-1', candidatePath: 'OB_EP3 - Proffie',
  tags: ['Obi-Wan Kenobi'], userNotes: 'my notes', demoUrl: 'https://demo', contentFileCount: 3,
};
put(path.join(fontDir, 'meta.json'), JSON.stringify(meta0));
put(path.join(fontDir, 'hum.wav'), 'OLD-HUM');
put(path.join(fontDir, 'clsh', 'clsh1.wav'), 'OLD-CLASH');
put(path.join(fontDir, 'stock_only.wav'), 'GONE');
put(path.join(fontDir, 'a_font.png'), 'PNG');

const curated = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-curated-'));
put(path.join(curated, 'hum.wav'), 'NEW-HUM');
put(path.join(curated, 'swing', 'swing1.wav'), 'NEW-SWING');

(async () => {
  const r = await entries.replaceEntryFiles({ userData, name: 'OB_EP3', folderPath: curated });
  ok('replace succeeds', r && r.ok, JSON.stringify(r));
  ok('the files are the folder\'s', fs.readFileSync(path.join(fontDir, 'hum.wav'), 'utf8') === 'NEW-HUM'
    && fs.existsSync(path.join(fontDir, 'swing', 'swing1.wav')));
  ok('files only the old version had are gone',
    !fs.existsSync(path.join(fontDir, 'stock_only.wav')) && !fs.existsSync(path.join(fontDir, 'clsh')));
  ok('the font keeps its image when the folder brings none', fs.existsSync(path.join(fontDir, 'a_font.png')));
  const m = JSON.parse(fs.readFileSync(path.join(fontDir, 'meta.json'), 'utf8'));
  ok('name, id, tags, notes, links and source are kept',
    m.name === 'OB_EP3' && m.entryUuid === 'u-123' && m.tags[0] === 'Obi-Wan Kenobi' && m.userNotes === 'my notes'
    && m.demoUrl === 'https://demo' && m.sourceUuid === 's-1' && m.candidatePath === 'OB_EP3 - Proffie');
  ok('the file count follows the new files (two sounds and the kept image)', m.contentFileCount === 3, m.contentFileCount);
  ok('the content record is rebuilt, nothing reported missing', !m.contentHashDirty && !m.missingFiles && !!m.contentHash,
    JSON.stringify({ d: m.contentHashDirty, mf: m.missingFiles, h: m.contentHash }));
  ok('effects follow the new files', Array.isArray(m.effects) && m.effects.includes('swing') && !m.effects.includes('clsh'),
    JSON.stringify(m.effects));
  const work = path.join(path.dirname(root), '.replace-work');
  ok('no staging or retired copy is left', !fs.existsSync(work) || fs.readdirSync(work).length === 0);
  ok('only one font in the library', entries.listEntries(userData).length === 1);
  ok('the folder picked is not changed', fs.readFileSync(path.join(curated, 'hum.wav'), 'utf8') === 'NEW-HUM');

  const bad = await entries.replaceEntryFiles({ userData, name: 'OB_EP3', folderPath: path.join(curated, 'nope') });
  ok('a failed replace reports it', bad && bad.ok === false);
  ok('and leaves the font as it was', fs.readFileSync(path.join(fontDir, 'hum.wav'), 'utf8') === 'NEW-HUM'
    && JSON.parse(fs.readFileSync(path.join(fontDir, 'meta.json'), 'utf8')).entryUuid === 'u-123');
  ok('an unknown font is refused', (await entries.replaceEntryFiles({ userData, name: 'Nope', folderPath: curated })).ok === false);

  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(curated, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
