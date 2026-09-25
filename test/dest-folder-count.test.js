// What the summary counts as a font at the destination.  [B-420, 2026-09-24]
//
// ⭐⭐ HIS CATCH, ON A FRESHLY FORMATTED CARD: *"29 fonts writen... but 30 fonts at the
// destination"*. The card held 29 fonts + `common` + `tracks` + `System Volume Information` = 32
// folders. `soundFonts:listDestFolders` filtered only DOT-PREFIXED names, which covers macOS and
// misses the one Windows puts on every removable volume it writes to. The caller reserves `common`
// and `tracks`, leaving 30 - and the one folder not in the selection was SVI, reported as "1 not
// part of this export".
//
// ⚠️⚠️ IT WAS WRONG ON EVERY CARD EXPORT, NOT JUST THAT ONE. A blank card is what made it visible,
// because the true count is knowable at a glance. On a populated card it silently added one to the
// total and asserted a font at the destination that had never existed.
//
// ⭐ WHY THIS IS A TEST AND NOT A COMMENT: the filter is one `.filter()` in an IPC handler, and the
// thing it must exclude is invisible on the developer's own disk - SVI lives on removable volumes,
// not on the C: drive anyone runs the suite from. A rule nothing exercises is a rule that comes
// back.
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (name, cond, why) => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}` + (cond || !why ? '' : `\n       ${why}`));
};

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const H = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');

// ── 1. The handler excludes the OS's own folders ─────────────────────
{
  const i = main.indexOf("ipcMain.handle('soundFonts:listDestFolders'");
  const j = main.indexOf('});', i);
  const raw = i > 0 ? main.slice(i, j) : '';
  // ⚠️⚠️ COMMENTS STRIPPED FIRST, AND THIS FILE IS WHY. The first version of these assertions
  // matched the whole handler including its explanation - which NAMES "System Volume Information"
  // in prose directly above the filter. Deleting the entry from the code left the test green,
  // proved by mutation. A check that can be satisfied by a comment about the check is decoration.
  const body = raw.replace(/\/\/.*$/gm, '');
  ok('the listDestFolders handler was located', body.length > 0,
     're-anchor if the channel is renamed');

  ok('⭐ System Volume Information is excluded', /'system volume information'/.test(body),
     'Windows creates it on every removable volume, so without this every card export counts '
     + 'one phantom font');
  ok('  and the recycle bin', /\$recycle\.bin/i.test(body));
  ok("  and chkdsk's recovered-cluster folders", /\^found\\\.\\d\{3\}\$/.test(body),
     'found.000 appears exactly when a card has been repaired - which is when someone is '
     + 'staring at a destination listing trying to work out what is really on it');
  ok('⚠️ the dot-prefixed filter is kept, not replaced', /!e\.name\.startsWith\('\.'\)/.test(body),
     'that one covers .Spotlight-V100 and .Trashes on macOS; both filters are needed');
  ok('⚠️ the match is case-insensitive', /toLowerCase\(\)/.test(body),
     'FAT32 volumes do not preserve case the way the name is written');
}

// ── 2. The caller still reserves the shared folders ──────────────────
//
// ⚠️ The count is produced by TWO filters in two processes - the OS folders here, `common` and
// `tracks` in the renderer. Asserting only one leaves the other free to rot, and a wrong count
// reads as a real fact about the user's card.
{
  ok('⭐ the summary reserves every shared folder the config declares',
     /const reserved = new Set\(\['common', 'tracks'\]\)/.test(H)
     && /for \(const _r of \(commonFolderNames \|\| \[\]\)\) if \(_r\) reserved\.add/.test(H),
     'reserving only a hardcoded "common" is [B-014]: an MC folder on the card was counted as a '
     + 'font and reported as "1 not part of this export" on every export from such a config');
}

// ── 3. ⚠️⚠️ AND THE ARITHMETIC, AGAINST THE REAL CARD THAT FOUND IT ──
//
// The two filters above can each be present and still produce a wrong number. This runs his
// actual listing through both and asserts the sentence the user would have read.
{
  // ⚠️⚠️ THE SET IS READ OUT OF main.js, NOT RETYPED HERE. A hand-copied list is a fixture
  // testing a fixture: it would keep agreeing with itself after the real one changed, which is
  // exactly how this file first passed a mutation that removed an entry from the shipped code.
  const setSrc = /const OS_FOLDERS = new Set\(\[([\s\S]*?)\]\)/.exec(main.replace(/\/\/.*$/gm, ''));
  ok('the OS folder list was read from main.js', !!setSrc,
     'if this cannot be parsed the arithmetic below is testing nothing');
  const OS_FOLDERS = new Set(
    (setSrc ? setSrc[1] : '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean),
  );
  ok(`  it has entries (${OS_FOLDERS.size})`, OS_FOLDERS.size >= 2);
  const onCard = ['Ahsoka', 'common', 'Dark_Ani', 'DarkSaber', 'Darth_Maul', 'Decay', 'Dooku',
    'Electro', 'Energy', 'G-Grievous', 'Inquisitor', 'Kyber_Prime_Blade_Assembly_Preon',
    'Kyber_Prime_Blast_Effect_Color_Changing', 'Kyber_Prime_Long_Preon',
    'Kyber_Prime_Red_No_Preon', 'Kyber_Spark_blue', 'Kyber_Spark_orange', 'Kyber_Spark_red',
    'Lightsaber_Of_The_Bells', 'Nexus', 'Quigon', 'Skotos', 'Sonic_Distortion_1',
    'Sonic_Distortion_2', 'Sonic_Distortion_3', 'Sonic_Distortion_All_Preon-Out-In', 'Starwave',
    'Techno', 'The_Sorcerer', 'tracks', 'Yaddle', 'System Volume Information'];

  const returned = onCard
    .filter((nm) => !nm.startsWith('.'))
    .filter((nm) => !OS_FOLDERS.has(nm.toLowerCase()) && !/^found\.\d{3}$/i.test(nm));
  const reserved = new Set(['common', 'tracks']);
  const fontish = returned.filter((f) => !reserved.has(f));
  const exported = onCard.filter((nm) => !reserved.has(nm) && nm !== 'System Volume Information');
  const extra = fontish.filter((f) => !new Set(exported).has(f)).length;

  ok(`⭐ his card counts as ${fontish.length} fonts (it reported 30)`, fontish.length === 29,
     '29 fonts were written to a blank card; anything else is counting a folder that is not a font');
  ok(`⭐ and nothing is "not part of this export" (it reported ${extra ? extra : 'none'})`,
     extra === 0,
     'a stray count here tells the user something is on their card that they did not put there');
}

console.log(failed ? `\n${failed} FAILED` : '\ndest-folder-count: all passing');
process.exit(failed ? 1 : 0);
