// The provenance package written to an SD card by SD Export. [B-229]
//
// WHAT THIS IS FOR. A saber changes hands and the person now holding it has no reliable way to
// know what is in it. The maker may or may not have left a copy of the config on the card, it
// may or may not match, and firmware cannot be read back off a Proffieboard. The journal entry
// from 2026-06-27 — a replacement saber that shipped with a generic config rather than the one
// it was built from — is that gap, in the first person. Writing the config next to the fonts it
// references, with a plain-text note saying what it is, closes it for any card this app touches.
//
// AND THE NOTE MUST SAY WHAT THE CONFIG IS *NOT*. The 2026-06-29 correction in
// `local/specs/sd-card-management.md` is the whole reason this file is trustworthy rather than
// marketing: a config sitting on an SD card proves nothing about what is flashed to the board.
// A provenance file that implied otherwise would manufacture exactly the false confidence the
// feature exists to remove. That paragraph is not filler; do not trim it for brevity.
//
// SCOPE, and it is narrow ON PURPOSE. This runs for SD Export and nothing else: the button's
// name says the export creates an SD card, not a backup or a move. Twelve other export doors
// share the same runner; none of them is seeding a card, and dropping a config into a folder
// someone asked for one font is noise.
//
// TONE. No exclamation marks, no emoji, no "powered by". The Proffie community reads
// promotional language as spam, and the value here is that the file is useful and restrained.
// The folder being clean is the marketing surface.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { localDateString } = require('./localDate');

// NOT `README.txt`, which is the obvious name and the wrong one. This file is REWRITTEN on
// every export so it can never go stale, which is the right call — but "always replace"
// aimed at a generic name would silently destroy a maker's own README.txt the first time one
// existed. A name that says who owns it makes overwriting unambiguously safe, and it sorts
// next to `jmt-studio-manifest.json`, which is the other file we already put at a destination.
const README_NAME = 'JMT-STUDIO-README.txt';

// ONE STRING, AND IT IS NOT THE ONLY PLACE IT BELONGS. As of 2026-10-01 this is the FIRST
// author credit anywhere in the product: `build.copyright` in package.json is empty, so the
// shipped Windows exe carries no copyright metadata at all, and LICENSE.txt asserts proprietary
// rights in the first person ("allows me to...") without ever naming who holds them. Those two
// matter more than this file does. Defined here as a constant so that when they are filled in,
// it is this value being reused rather than a third wording invented at the time.
// "Copyright", not "©", and that is an encoding decision rather than a style one. Everything
// else in this document is plain ASCII; the symbol would be its only non-ASCII byte, written with
// no BOM, onto FAT32, for an audience whose editor is whatever opens on a double-click. The same
// reasoning that made this file CRLF applies — it is written for a reader, not a developer — and
// the word carries identical legal weight, so the symbol buys nothing and can only render wrong.
// The year runs from the first release to the year the file is written, so it is never stale.
const creditFor = (year) => `Copyright ${year > 2026 ? `2026-${year}` : '2026'} Ryan Taylor`;

// CRLF, not LF. This lands on a FAT32 card that will most often be opened by double-clicking it
// on Windows, and Notepad showed LF-only text as one run-on line for most of its life. The
// audience for this file is someone who received a saber, not a developer with an editor.
const NL = '\r\n';

function line(label, value) {
  return '  ' + String(label).padEnd(28) + value;
}

// EVERY FACT IN HERE IS PASSED IN. This module does not look at the editor, the store or the
// filesystem to decide what is true — the renderer already knows all of it, and a second source
// for the same fact is a second thing to keep in agreement forever.
function buildReadme({
  configName = '', configSource = '', stylesName = '', stylesUsed = 0, fontCount = 0,
  commonFolders = [], appVersion = '', dateStr = null, leftovers = [],
} = {}) {
  const date = dateStr || localDateString();

  // THE FONTS WERE NEVER THE WHOLE EXPORT, and the first version of this line said they were.
  // A run that also writes a voice pack reported only "4 sound fonts", so the note undercounted
  // what it was describing — on a file whose entire job is to say what is on the card.
  // NAMED FROM WHAT WAS WRITTEN, not from what was asked for. `commonOutcomes` has three
  // states and only `written` is this export putting a folder there; `current` means it was
  // already correct and `kept` means the user's own was preserved. Claiming either of those as
  // something "the export included" would be the same overstatement in the other direction.
  // The folder is not always called `common` — a config can point at another slot — so the
  // real names are used rather than the convention.
  const bits = [`${fontCount} sound font${fontCount === 1 ? '' : 's'}`];
  const folders = (commonFolders || []).filter(Boolean);
  if (folders.length === 1) bits.push(`the ${folders[0]} folder`);
  else if (folders.length > 1) bits.push(`the ${folders.join(', ')} folders`);
  const included = bits.length > 1
    ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`
    : bits[0];

  const inventory = [];
  if (configName) {
    inventory.push(line(configName, configSource && configSource !== configName
      ? `the config this card was prepared for (${configSource})`
      : 'the config this card was prepared for'));
  }
  // "the styles this config uses", NOT "the style library". What lands on the card is a NEW
  // file built from the entries this config references plus whatever those depend on — settled,
  // because a maker's whole library has no business riding along with one saber. Describing it
  // as the library would be a small lie that matters to the one person most likely to read it:
  // the maker, checking what they just handed over.
  if (stylesName) {
    inventory.push(line(stylesName, stylesUsed
      ? `the ${stylesUsed} style${stylesUsed === 1 ? '' : 's'} this config uses`
      : 'the styles this config uses'));
  }
  // SAYS WHAT IT IS, AND NOTHING ABOUT WHAT TO DO WITH IT. "a record of what was last written
  // here" read like a log the user was meant to open. An earlier fix swung the other way and
  // instructed - "Leave it; nothing to read" - which is the app telling someone how to keep their
  // own card tidy. Naming it as the app's own file does the whole job: nobody deletes a tool's
  // working file on purpose, and the closing paragraph says what keeping it buys.
  // A config or styles file an earlier export left: kept because this export did not replace it,
  // or because it was changed since. A bare name counts as changed. [B-229]
  for (const l of (leftovers || [])) {
    const { name, changed } = typeof l === 'string' ? { name: l, changed: true } : l;
    inventory.push(line(name, changed ? 'from an earlier export, changed since' : 'from an earlier export'));
  }
  inventory.push(line('jmt-studio-manifest.json', "JMT Studio's own record of this card"));

  const parts = [];
  parts.push('JMT Studio');
  parts.push('==========');
  parts.push('');
  parts.push(`This card was last written by JMT Studio on ${date}.`);
  parts.push(`Export included ${included}.`);
  if (appVersion) parts.push(`JMT Studio ${appVersion}`);
  parts.push('');
  parts.push('WHAT IS HERE');
  parts.push('');
  parts.push(...inventory);
  parts.push('');

  if (configName) {
    // THE SECTION THE FEATURE EXISTS FOR. See the header.
    parts.push('WHAT THE CONFIG IS, AND IS NOT');
    parts.push('');
    parts.push('The config is the source that was exported alongside these fonts, so the');
    parts.push('card and the config stay together. It is not proof of what is currently');
    parts.push("on the saber's board: firmware cannot be read back, and a board can be");
    parts.push('reflashed without this card being touched.');
    parts.push('');
  }

  if (configName) {
    // JMT STUDIO FIRST, BY ARDUINO SECOND. The files are plain ProffieOS either way: the config
    // includes the styles file by name, so the two only need to sit side by side. "Append", never
    // "Import": importing replaces a whole Style Library, and the person most likely to follow
    // this has one of their own.
    parts.push('TO BUILD THIS CONFIG');
    parts.push('');
    parts.push(`In JMT Studio: open ${configName}.`);
    if (stylesName) {
      parts.push(`In the Style Library, use Append to add ${stylesName} to your library, or`);
      parts.push('Create Style Library to import it if you do not have one. Then compile.');
    } else {
      parts.push('Then compile.');
    }
    parts.push('');
    parts.push(stylesName
      ? `Without JMT Studio: put ${configName} and ${stylesName} in the config folder`
      : `Without JMT Studio: put ${configName} in the config folder`);
    parts.push('of your ProffieOS download (ProffieOS/config), and set this line in');
    parts.push('ProffieOS/ProffieOS.ino:');
    parts.push('');
    parts.push(`  #define CONFIG_FILE "config/${configName}"`);
    parts.push('');
  }

  parts.push('OPENING IT');
  parts.push('');
  parts.push('JMT Studio is a free desktop app for editing, compiling, and flashing');
  parts.push(configName
    ? 'ProffieOS configs. Open the config above to see or change what this'
    : 'ProffieOS configs. It prepared the sound fonts on this card.');
  if (configName) parts.push('saber is set up to do.');
  parts.push('');
  parts.push('  https://jmtfoundry.com/jmtstudio/');
  parts.push('');
  // A SOFTWARE CREDIT, AND ITS PLACEMENT IS THE WHOLE REASON IT IS SAFE. It sits under the
  // app's own URL, in the section about the app, so it reads as "who wrote this tool" — which is
  // what it is. The one place it must never go is near the config or the fonts: this file is
  // written onto cards that OTHER makers prepare for THEIR customers, and a person's name beside
  // the saber's contents would read as authorship of the saber. That is the exact confusion the
  // "WHAT THE CONFIG IS, AND IS NOT" section exists to remove.
  // No "powered by", no tagline. The tone rule at the top of this file applies hardest here,
  // because a credit line is the easiest place in the document to start selling.
  parts.push(`  ${creditFor(Number(String(date).slice(0, 4)) || new Date().getFullYear())}`);
  parts.push('');
  // NOTHING HERE INVITES DELETING ANYTHING, AND THAT IS THE POINT. Two drafts got this
  // wrong in opposite directions. The first said "any of these files can be deleted without
  // affecting the fonts or how the saber runs" - true about the saber, and an invitation to bin
  // the attribution on a file whose whole job is attribution. Nobody in this community writes
  // that: Fett263 asks explicitly that the attributions are not removed, so telling people to go
  // ahead and delete ours is a strange thing to ship. The second overcorrected into "leaving the
  // manifest is worth it", which argues a case at the reader instead of stating a fact.
  // State what each file IS and what keeping it buys, and let that be the whole argument. The
  // saber reassurance stays because someone receiving a saber genuinely wonders whether these
  // extra files matter.
  parts.push('This file is rewritten every time JMT Studio exports to this card, so the');
  parts.push('date above is the last export and not when the card was made. None of these');
  parts.push('files affect how the saber runs. The manifest is JMT Studio\'s record of');
  parts.push('what is already here, which saves time on future exports.');
  parts.push('');

  return parts.join(NL);
}

// A FAILURE HERE MUST NOT FAIL THE EXPORT. The fonts are the job; this is a courtesy file
// written after they all landed. So every write is individually guarded and the result reports
// what happened rather than throwing — and it reports it per file, because "provenance failed"
// with three possible causes is the silent-predicate shape that hid [B-203] for a week.
function writeOne(destDir, name, content, wrote, failed) {
  try {
    fs.writeFileSync(path.join(destDir, name), content);
    wrote.push(name);
  } catch (err) {
    failed.push({ name, error: String((err && err.message) || err) });
  }
}

// THE CONFIG'S NAME ON A CARD IS FIXED. A card goes in one saber, so a second config exported to
// it replaces the first rather than sitting beside it; the readme names the file it came from.
const CONFIG_NAME = 'my_config.h';

// No absolute path leaves on a card: it names the maker's own folders and builds nowhere else. An
// include written with a full path becomes the file name alone, which is the file beside it on the
// card. Commented-out includes too; relative ones are left as written.
function relativeIncludes(text) {
  return String(text).replace(/(#\s*include\s*")(?:[A-Za-z]:[\\/]|\/)(?:[^"]*[\\/])?([^"\\/]+)"/g, '$1$2"');
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// `configContent` is the SAVED config file as it is on disk (`configSource` its file name), or
// null when the setting is off, nothing is open, or the user left it out. All of those are normal:
// the readme still goes down, and it does not claim a config it did not write.
// `usedFonts` are the library fonts the config uses. The config goes on only when every one of
// them is on the card once the fonts are written, by this export or an earlier one, so the card's
// config and fonts describe each other. The styles file goes with the config and never without it.
function writeProvenance({
  destDir, configSource = '', configContent = null, usedFonts = [],
  stylesName = '', stylesContent = null, stylesUsed = 0,
  fontCount = 0, commonFolders = [], appVersion = '', dateStr = null,
} = {}) {
  const wrote = [], failed = [];
  if (!destDir) return { ok: false, error: 'Missing destDir', wrote, failed };

  // What an earlier export put here, recorded in the card's manifest with each file's hash.
  const sync = require('./sfSyncManifest');
  const hashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  let prior = [];
  try { const m = sync.read(destDir); if (m && Array.isArray(m.provenance)) prior = m.provenance; } catch {}

  const missingFonts = typeof configContent === 'string'
    ? (usedFonts || []).filter((f) => f && !isDir(path.join(destDir, f)))
    : [];
  const haveConfig = typeof configContent === 'string' && !missingFonts.length;
  const haveStyles = haveConfig && !!(stylesName && typeof stylesContent === 'string');

  // A my_config.h already on the card that is not what the last export left, written by hand or
  // changed since, is replaced all the same, and the summary says so.
  let replacedOther = false;
  if (haveConfig) {
    const body = relativeIncludes(configContent);
    try {
      const cur = fs.readFileSync(path.join(destDir, CONFIG_NAME));
      const rec = prior.find((p) => p && p.name === CONFIG_NAME);
      replacedOther = hashOf(cur) !== hashOf(Buffer.from(body)) && (!rec || rec.hash !== hashOf(cur));
    } catch { /* none there */ }
    writeOne(destDir, CONFIG_NAME, body, wrote, failed);
  }
  if (haveStyles) writeOne(destDir, stylesName, stylesContent, wrote, failed);
  const configWritten = wrote.includes(CONFIG_NAME);

  // What earlier exports left and this one did not rewrite. With no new config written, they all
  // stay: the card keeps the config it had. With one written, a config or styles file under another
  // name (the user's own file name, from before the name was fixed) goes when its bytes are still
  // what was written; one changed since stays. Everything kept is named in the readme.
  const removed = [], leftovers = [], kept = [];
  for (const p of prior) {
    if (!p || !p.name || p.name === README_NAME || wrote.includes(p.name)) continue;
    let bytes;
    try { bytes = fs.readFileSync(path.join(destDir, p.name)); } catch { continue; }
    const same = hashOf(bytes) === p.hash;
    if (!configWritten || !same) { kept.push({ ...p, changed: !same }); continue; }
    try { fs.unlinkSync(path.join(destDir, p.name)); removed.push(p.name); }
    catch { kept.push({ ...p, changed: false }); }
  }

  const readme = buildReadme({
    configName: configWritten ? CONFIG_NAME : '',
    configSource,
    stylesName: wrote.includes(stylesName) ? stylesName : '',
    stylesUsed, fontCount, commonFolders, appVersion, dateStr,
    leftovers: kept.map((k) => ({ name: k.name, changed: k.changed })),
  });
  writeOne(destDir, README_NAME, readme, wrote, failed);

  try {
    const record = [
      ...wrote.filter((n) => n !== README_NAME)
        .map((n) => ({ name: n, hash: hashOf(fs.readFileSync(path.join(destDir, n))) })),
      // Kept files keep the hash they were written with, so a later change on the card still shows.
      ...kept.map(({ name, hash }) => ({ name, hash })),
    ];
    const m = sync.read(destDir) || { version: sync.MANIFEST_VERSION, items: {} };
    m.provenance = record;
    sync.write(destDir, m);
  } catch { /* the record only lets the next export tidy up; never fail this one over it */ }

  return {
    ok: failed.length === 0, wrote, failed, removed,
    leftovers: kept.filter((k) => k.changed).map((k) => k.name),
    configWritten, missingFonts, replacedOther,
  };
}

module.exports = { writeProvenance, buildReadme, relativeIncludes, README_NAME, CONFIG_NAME };
