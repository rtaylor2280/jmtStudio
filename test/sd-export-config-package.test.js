// The config an SD Export puts on a card. [B-229]
//
// It goes on as my_config.h whatever the source file is called, replacing the one there, and the
// readme names the source. It goes only when every library font it uses is on the card once the
// fonts are written, by this export or an earlier one; the styles file goes with it and never
// without it. A my_config.h the last export did not leave as it is gets replaced all the same and
// reported. A config an earlier export wrote under the source's own name is tidied away once a
// new my_config.h replaces it, unless it was changed since. With no new config, the card keeps
// what it had.
//
// Runs exportProvenance.js against scratch folders standing in for cards.
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeProvenance, CONFIG_NAME, README_NAME } = require('../exportProvenance');
const sync = require('../sfSyncManifest');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
function card(fonts) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-card-'));
  for (const f of fonts) fs.mkdirSync(path.join(d, f));
  return d;
}
const read = (d, n) => { try { return fs.readFileSync(path.join(d, n), 'utf8'); } catch { return null; } };
const CFG = '#include "C:/Users/someone/AppData/Roaming/jmt-studio/my_styles.h"\n// config A\n';
const STYLES = 'using A = Rgb<255,0,0>;\n';
const base = (d, extra) => writeProvenance({
  destDir: d, configSource: 'saber_a.h', configContent: CFG, usedFonts: ['Font1', 'Font2'],
  stylesName: 'my_styles.h', stylesContent: STYLES, stylesUsed: 1, fontCount: 1, dateStr: '2026-10-24',
  ...extra,
});

console.log('written under the fixed name');
{
  // Font2 came from an earlier export: on the card, not in this one.
  const d = card(['Font1', 'Font2']);
  const r = base(d);
  check('written as my_config.h', r.configWritten && read(d, CONFIG_NAME) !== null, JSON.stringify(r));
  check('no file under the source name', read(d, 'saber_a.h') === null);
  check('absolute include made relative', /#include "my_styles\.h"/.test(read(d, CONFIG_NAME)), read(d, CONFIG_NAME));
  check('styles file written beside it', read(d, 'my_styles.h') === STYLES);
  check('readme names the source', /my_config\.h\s+the config this card was prepared for \(saber_a\.h\)/.test(read(d, README_NAME)));
  check('nothing reported as replaced on a fresh card', r.replacedOther === false);

  const r2 = base(d, { configSource: 'saber_b.h', configContent: '// config B\n' });
  check('a second export overwrites it', read(d, CONFIG_NAME) === '// config B\n');
  check('replacing our own earlier file is not reported', r2.replacedOther === false, JSON.stringify(r2));
  check('readme names the new source', /\(saber_b\.h\)/.test(read(d, README_NAME)));
}

console.log('a my_config.h the last export did not leave');
{
  const d = card(['Font1', 'Font2']);
  fs.writeFileSync(path.join(d, CONFIG_NAME), '// someone else\n');
  const r = base(d);
  check('a hand-placed one is replaced and reported', r.replacedOther === true && /config A/.test(read(d, CONFIG_NAME)), JSON.stringify(r));
  base(d);
  fs.appendFileSync(path.join(d, CONFIG_NAME), '// edited on the card\n');
  const r3 = base(d);
  check('one changed on the card since is replaced and reported', r3.replacedOther === true);
  const r4 = base(d);
  check('the same bytes again are not reported', r4.replacedOther === false);
}

console.log('the fonts it uses');
{
  const d = card(['Font1']);
  const r = base(d);
  check('a used font missing from the card: no config', !r.configWritten && read(d, CONFIG_NAME) === null, JSON.stringify(r));
  check('the missing font is named', JSON.stringify(r.missingFonts) === '["Font2"]', JSON.stringify(r.missingFonts));
  check('no styles file without the config', read(d, 'my_styles.h') === null);
  check('the readme still goes down', read(d, README_NAME) !== null);
}
{
  const d = card(['Font1', 'Font2']);
  base(d);
  fs.rmSync(path.join(d, 'Font2'), { recursive: true });
  const r = base(d, { configContent: '// config B\n' });
  check('no new config: the card keeps the one it had', !r.configWritten && /config A/.test(read(d, CONFIG_NAME)));
  check('and the readme lists it from an earlier export',
    /my_config\.h\s+from an earlier export\r?\n/.test(read(d, README_NAME)), read(d, README_NAME));
  fs.mkdirSync(path.join(d, 'Font2'));
  const r2 = base(d, { configContent: '// config B\n' });
  check('the kept one still counts as ours: replaced without a report', r2.configWritten && r2.replacedOther === false, JSON.stringify(r2));
}

console.log('a config an earlier export wrote under its own name');
{
  const d = card(['Font1', 'Font2']);
  fs.writeFileSync(path.join(d, 'saber_a.h'), 'old');
  const m = sync.read(d) || { version: sync.MANIFEST_VERSION, items: {} };
  m.provenance = [{ name: 'saber_a.h', hash: hash('old') }];
  sync.write(d, m);
  const r = base(d);
  check('unchanged: removed once my_config.h replaces it', read(d, 'saber_a.h') === null && r.removed.includes('saber_a.h'), JSON.stringify(r));
}
{
  const d = card(['Font1', 'Font2']);
  fs.writeFileSync(path.join(d, 'saber_a.h'), 'old, then edited');
  const m = sync.read(d) || { version: sync.MANIFEST_VERSION, items: {} };
  m.provenance = [{ name: 'saber_a.h', hash: hash('old') }];
  sync.write(d, m);
  const r = base(d);
  check('changed since: kept', read(d, 'saber_a.h') !== null && r.leftovers.includes('saber_a.h'), JSON.stringify(r));
  check('and listed as changed', /saber_a\.h\s+from an earlier export, changed since/.test(read(d, README_NAME)));
}
{
  const d = card(['Font1']);
  fs.writeFileSync(path.join(d, 'saber_a.h'), 'old');
  const m = sync.read(d) || { version: sync.MANIFEST_VERSION, items: {} };
  m.provenance = [{ name: 'saber_a.h', hash: hash('old') }];
  sync.write(d, m);
  base(d);
  check('with no new config written it stays', read(d, 'saber_a.h') === 'old');
}

console.log('setting off');
{
  const d = card(['Font1', 'Font2']);
  const r = base(d, { configContent: null, stylesContent: null });
  check('no config, no styles, readme only', !r.configWritten && read(d, CONFIG_NAME) === null
    && read(d, 'my_styles.h') === null && read(d, README_NAME) !== null);
  check('no fonts reported missing when there is no config', r.missingFonts.length === 0);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
