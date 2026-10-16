/**
 * Listing the library does not modify the library  [2026-10-15]
 *
 * `_readEntryMeta` assigned an `entryUuid` to any entry that lacked one and persisted it, so
 * every read of the library was a potential write to the user's meta.json. The only entries that
 * could lack the field predate it, and the field predates every release that carries the sound
 * font library at all - v1.7.2 has no `soundFontEntries.js` - so the write had no audience and
 * the read path paid for it anyway.
 *
 * WHY A TEST AND NOT JUST THE REMOVAL: a read that writes is the kind of thing that gets
 * reintroduced as a convenience ("we have the meta open, may as well fix it up"), and it fails
 * silently - nothing errors, the file is simply different afterwards. The property worth holding
 * is not "no uuid backfill", it is that enumerating the library leaves it byte-for-byte alone.
 *
 * ⚠️ THE FIXTURE OMITS entryUuid DELIBERATELY. An entry that already has one would be left alone
 * by the old code too, so it would pass against both and prove nothing.
 *
 * Run: node test/reading-entries-does-not-write.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const entries = require(path.join(ROOT, 'soundFontEntries.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const ud  = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-'));
const lib = path.join(ud, 'soundFonts', 'library');

// One entry WITHOUT entryUuid - the only shape the removed write could ever have fired on - and
// one with, so the ordinary case is covered in the same run.
const noUuid = path.join(lib, 'Legacy_Font');
fs.mkdirSync(noUuid, { recursive: true });
fs.writeFileSync(path.join(noUuid, 'hum.wav'), 'audio');
const legacyMeta = JSON.stringify({ schemaVersion: '1', name: 'Legacy_Font' }, null, 2);
fs.writeFileSync(path.join(noUuid, 'meta.json'), legacyMeta);

const withUuid = path.join(lib, 'Modern_Font');
fs.mkdirSync(withUuid, { recursive: true });
fs.writeFileSync(path.join(withUuid, 'hum.wav'), 'audio');
fs.writeFileSync(path.join(withUuid, 'meta.json'), JSON.stringify(
  { schemaVersion: '1', name: 'Modern_Font', entryUuid: 'u-modern' }, null, 2));

const metaPath = path.join(noUuid, 'meta.json');
const before = fs.readFileSync(metaPath, 'utf8');
ok('precondition: the fixture entry genuinely has no entryUuid',
   !JSON.parse(before).entryUuid, before);

const listed = entries.listEntries(ud).map(e => e.name).sort();
ok('both entries still list', listed.join(',') === 'Legacy_Font,Modern_Font', JSON.stringify(listed));

const after = fs.readFileSync(metaPath, 'utf8');
ok('READING THE LIBRARY LEFT meta.json BYTE-FOR-BYTE ALONE', after === before,
   'a read path that writes is how a library changes under a user who only looked at it');
ok('and it still has no entryUuid afterwards', !JSON.parse(after).entryUuid, after);

// Read twice: a write-on-read would show up on the first call, but a lazily-cached one could
// wait for the second.
entries.listEntries(ud);
ok('still untouched after a second read', fs.readFileSync(metaPath, 'utf8') === before);

try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? '\nOK' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
