// A source's Download link rides an export only with the proof-of-purchase box ticked. [B-487]
//
// The link is private, tied to its buyer and often redeemable by anyone holding it ([B-497]), so
// it follows the same disclosure as the receipts. The public links (Website, Link) ride regardless.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../soundFontCuration.js');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-dlgate-'));
const uuid = 'src-dl';
const dir = path.join(ud, 'soundFonts', 'sources', uuid);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
  schemaVersion: 1, uuid, format: 'zip', originalName: 'X.zip',
  vendor: 'BVM Sabers', linkUrl: 'https://www.bvm-sabers.co.uk/fonts',
  downloadUrl: 'https://www.bvm-sabers.co.uk/checkout/success?session_id=cs_live_x',
}));

const withBox = C.buildForSource(ud, uuid, 'test', { includeAttachments: true });
const without = C.buildForSource(ud, uuid, 'test', { includeAttachments: false });
check('WITH THE BOX TICKED, THE DOWNLOAD LINK RIDES THE EXPORT',
  !!(withBox && withBox.source && withBox.source.downloadUrl), JSON.stringify(withBox && withBox.source));
check('WITH IT CLEARED, THE DOWNLOAD LINK STAYS BEHIND',
  !!without && !!without.source && !('downloadUrl' in without.source), JSON.stringify(without && without.source));
check('while the public Link rides either way', !!(without && without.source && without.source.linkUrl));

fs.rmSync(ud, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
