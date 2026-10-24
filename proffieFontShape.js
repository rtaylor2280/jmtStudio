// Is this folder a Proffie font, a Xeno font, or neither? Decided from the folder's own files, never
// from what else sits on the card. One rule for every reader: the card report's count and family,
// the card import's font list, and the bulk import scan. [B-461]
//
// XENO FIRST. Measured on 14 real Xeno card backups: every numbered font folder names its sounds
// "clash (12).wav" (a space and brackets), and the Xeno3 ones carry a fontconfig.ini in each folder.
// Proffie never names a file that way. A Xeno folder can still hold one plain "boot.wav", which is
// why one Proffie-looking file is not enough: the majority of its sounds decides.
//
// THEN PROFFIE. A sound named for a ProffieOS effect, flat (blast01.wav) or in a folder named for it
// (blast/). No single effect is required: a blaster font has no hum. The names are every EFFECT in
// the ProffieOS 8.10 source, all props, less the voice prompts, so a voicepack alone is not a font.
'use strict';

const EFFECT_NAMES = new Set([
  'altchng', 'armhum', 'armor', 'armor_alarm', 'armor_compromised', 'array', 'auto', 'bgnarm',
  'bgnauto', 'bgndrag', 'bgnidle', 'bgnlb', 'bgnlock', 'bgnmelt', 'bladeid', 'bladein', 'bladeout',
  'blast', 'blaster', 'blst', 'blstbgn', 'blstend', 'bmbegin', 'bmend', 'boom', 'boot', 'ccbegin',
  'ccchange', 'ccend', 'chhum', 'clash', 'clipin', 'clipout', 'clsh', 'color', 'death', 'destruct',
  'dim', 'drag', 'empty', 'endarm', 'endauto', 'enddrag', 'endlb', 'endlock', 'endmelt', 'faston',
  'fastout', 'font', 'force', 'full', 'fuzz', 'hazard', 'health', 'hswing', 'hum', 'humm', 'idle',
  'in', 'jam', 'lb', 'lock', 'lockup', 'lowbatt', 'lswing', 'major_fracture', 'major_laceration',
  'mdauto', 'mdkill', 'mdstun', 'medkit', 'melt', 'minor_fracture', 'minor_laceration', 'mode',
  'morphine', 'out', 'plioff', 'plion', 'poweroff', 'poweron', 'poweronf', 'preon', 'press', 'pstoff',
  'push', 'pwroff', 'quote', 'range', 'release', 'reload', 'reset', 'slsh', 'spin', 'stab', 'stun',
  'swing', 'swingh', 'swingl', 'swng', 'tr', 'trloop', 'unjam', 'vmbegin', 'vmend',
]);
// Left out on purpose: battery, mclick, medit, mnum, mute, volup, voldown, volmax, volmin. They are
// voice prompts, and a folder of only those is a voicepack.

const XENO_SOUND = /^[a-z_]+ \(\d+\)\.wav$/i;
const PROFFIE_SOUND = /^([a-z_]+?)\d*\.wav$/i;
const ALT_DIR = /^alt\d{3}$/i;

function isProffieSoundName(name) {
  const m = PROFFIE_SOUND.exec(name);
  return !!(m && EFFECT_NAMES.has(m[1].toLowerCase()));
}

// `entries` are the folder's direct children as fs.Dirent (or {name, isFile(), isDirectory()}).
// Returns 'xeno', 'proffie' or null.
function fontShapeOf(entries) {
  let wavs = 0, xenoNamed = 0, proffieNamed = 0, effectDirs = 0, fontconfig = false;
  for (const e of entries) {
    const name = e.name;
    if (name.startsWith('._')) continue;
    if (e.isDirectory()) {
      if (EFFECT_NAMES.has(name.toLowerCase()) || ALT_DIR.test(name)) effectDirs++;
    } else if (e.isFile()) {
      if (/^fontconfig\.ini$/i.test(name)) fontconfig = true;
      if (!/\.wav$/i.test(name)) continue;
      wavs++;
      if (XENO_SOUND.test(name)) xenoNamed++;
      else if (isProffieSoundName(name)) proffieNamed++;
    }
  }
  if (fontconfig || (wavs > 0 && xenoNamed * 2 > wavs)) return 'xeno';
  if (proffieNamed > 0 || effectDirs > 0) return 'proffie';
  return null;
}

module.exports = { fontShapeOf, isProffieSoundName, EFFECT_NAMES };
