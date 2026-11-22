// A destination that cannot be read is not an empty one. [B-638]
//
// Seen 2026-11-07: a card pulled during a folder export's compare made 96 fonts read as "nothing
// at the destination", and the export would have written them without asking skip or replace.
//
// Run: node test/compare-unreadable-dest.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { entryMatchesAt } = require('../soundFontEntries');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b638-'));
  try {
    const userData = path.join(tmp, 'userData');
    fs.mkdirSync(userData);
    const card = path.join(tmp, 'card');
    fs.mkdirSync(card);

    const present = await entryMatchesAt(userData, 'Kenobi', card);
    ok('control: a reachable card without the font reads as missing',
      present && present.ok === true && present.exists === false && !present.destUnreadable,
      JSON.stringify(present));

    const gone = path.join(tmp, 'pulled-card');   // never created: a card that is no longer there
    const r = await entryMatchesAt(userData, 'Kenobi', gone);
    ok('a destination that is gone is reported as unreadable', r && r.destUnreadable === true, JSON.stringify(r));
    ok('and never as missing', !(r && r.ok && r.exists === false), JSON.stringify(r));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  ok('the folder export stops on an unreadable destination',
    /if \(mm && mm\.destUnreadable\) throw /.test(html));
  ok('the SD export stops on an unreadable destination',
    /if \(m && m\.destUnreadable\) \{ _scanDestUnreadable = true; break; \}/.test(html)
    && /if \(_scanDestUnreadable\) \{[\s\S]{0,200}_sfDeleteProgress\.hide\(\)[\s\S]{0,300}return false;/.test(html));

  if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nall passed');
})();
