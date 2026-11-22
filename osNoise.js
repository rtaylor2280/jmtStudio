// Files and folders an operating system leaves on a card or in a download, which are never
// card content: macOS metadata (.Spotlight-V100, .fseventsd, ._ resource forks, __MACOSX in a
// zip) and Windows' own (System Volume Information, Thumbs.db, desktop.ini).
//
// One list for the card browser, the card classifier and the bulk import scan.

'use strict';

const NAMES = new Set([
  '__macosx',
  '.ds_store',
  '.spotlight-v100',
  '.trashes',
  '.fseventsd',
  '.documentrevisions-v100',
  '.temporaryitems',
  'thumbs.db',
  'desktop.ini',
  'system volume information',
]);

function isOsNoiseName(name) {
  const s = String(name || '');
  if (s.startsWith('._')) return true;
  return NAMES.has(s.toLowerCase());
}

module.exports = { isOsNoiseName };
