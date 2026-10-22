// Which link a source keeps as its Download. [B-487]
//
// The latest link in the chain that is a place to download from again: the file's own link when it
// is on a file-sharing host, else the latest link before it that is not a login page. Never a
// store's own file URL, which is commonly signed and expires within minutes.
'use strict';

const L = require('../soundFontLinkImport.js');

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  <- got ${got}, want ${want}`}`);
  if (!ok) failures++;
}

const DOC = 'https://onedrive.example.org/kyberphonic-order-1234.docx';
const DROPBOX = 'https://www.dropbox.com/s/abc123/Font.zip?dl=1';

console.log('a document whose link leads to a file-sharing host');
check('NOT THE PASTED DOCUMENT: THE SHARE LINK INSIDE IT', L.pickDownloadUrl([DOC, DROPBOX]), DROPBOX);

console.log('a store that signs its own file URL');
check('BVM: NOT THE EXPIRING FILE LINK, NOT THE CHECKOUT RECORD: ITS FONTS PAGE',
  L.pickDownloadUrl(['https://www.bvm-sabers.co.uk/checkout/success?session_id=cs_live_x', 'https://www.bvm-sabers.co.uk/api/downloads/SIGNEDTOKEN']),
  'https://www.bvm-sabers.co.uk/fonts');
check('BVM free font from the in-app browser: the page it was clicked on',
  L.pickDownloadUrl(['https://www.bvm-sabers.co.uk/fonts', 'https://www.bvm-sabers.co.uk/api/downloads/T']),
  'https://www.bvm-sabers.co.uk/fonts');
check('BVM token pasted on its own: its fonts page',
  L.pickDownloadUrl(['https://www.bvm-sabers.co.uk/api/downloads/T']), 'https://www.bvm-sabers.co.uk/fonts');
check('an unknown store: the page before the file is the best guess',
  L.pickDownloadUrl(['https://store.example/orders/5', 'https://store.example/api/downloads/T']), 'https://store.example/orders/5');
check('a Stripe checkout page is a record, not a download',
  L.pickDownloadUrl(['https://checkout.stripe.com/c/pay/cs_x', 'https://store.example/files/T']), null);

check('BVM: the tab the page remembers is not part of the link',
  L.pickDownloadUrl(['https://www.bvm-sabers.co.uk/fonts?tier=premium', 'https://www.bvm-sabers.co.uk/api/downloads/T']),
  'https://www.bvm-sabers.co.uk/fonts');
check('BVM fonts page is public, so it is the Link too', L.publicLinkFor('https://www.bvm-sabers.co.uk/fonts'), 'https://www.bvm-sabers.co.uk/fonts');
check('an unknown store page is never offered as the Link', L.publicLinkFor('https://store.example/orders/5'), null);
check('a share link is not offered as the Link', L.publicLinkFor('https://www.dropbox.com/s/x/y.zip?dl=1'), null);

console.log('a login on the way');
check('A LOGIN PAGE IS NEVER THE DOWNLOAD',
  L.pickDownloadUrl(['https://shop.example.com/my-account/downloads', 'https://shop.example.com/my-account/', 'https://shop.example.com/files/x.zip?key=1']),
  null);
check('the page after the login is kept',
  L.pickDownloadUrl(['https://shop.example.com/login', 'https://shop.example.com/orders/88/downloads', 'https://shop.example.com/files/x.zip']),
  'https://shop.example.com/orders/88/downloads');

console.log('a pointer file holding a share link (JayDalorian\'s WooCommerce .txt)');
check('the share link', L.pickDownloadUrl(['https://jaydalorian.example/?download_file=9&order=wc_order_x', 'https://www.dropbox.com/scl/fi/zz/Excalibur.zip?dl=1']),
  'https://www.dropbox.com/scl/fi/zz/Excalibur.zip?dl=1');

console.log('the in-app browser');
check('a download clicked on a Google Drive page',
  L.pickDownloadUrl(['https://drive.google.com/file/d/ID/view', 'https://drive.google.com/uc?id=ID&export=download']),
  'https://drive.google.com/uc?id=ID&export=download');

console.log('edges');
check('a pasted share link on its own', L.pickDownloadUrl([DROPBOX]), DROPBOX);
check('a pasted store file link on its own keeps nothing', L.pickDownloadUrl(['https://store.example/api/downloads/T']), null);
check('nothing followed', L.pickDownloadUrl([]), null);
check('a temporary content host is not a file host', L.isFileHost('https://uc123.dl.dropboxusercontent.com/cd/0/get/x'), false);

console.log(failures ? `\n${failures} FAILED` : '\nall passing');
process.exit(failures ? 1 : 0);
