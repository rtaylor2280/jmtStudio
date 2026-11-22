'use strict';
// A folder from a cloud drive is named after the folder, not the drive. [B-633]

const { archiveNameFromPage: n } = require('../soundFontLinkImport.js');

let failed = 0;
const ok = (name, got, want) => {
  const pass = got === want;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  <- ${got}`}`);
  if (!pass) failed++;
};

ok('a OneDrive folder takes the page title', n('OneDrive_1_11-6-2026.zip', 'Cal Kestis - OneDrive'), 'Cal Kestis.zip');
ok('the longer OneDrive title', n('OneDrive_2_11-6-2026.zip', 'Cal Kestis - Microsoft OneDrive'), 'Cal Kestis.zip');
ok('a Google Drive folder takes the page title', n('drive-download-20261106T120000Z-001.zip', 'Dagen - Google Drive'), 'Dagen.zip');
ok('a SharePoint folder', n('SharePoint_1_11-6-2026.zip', 'Fonts | SharePoint'), 'Fonts.zip');
ok('characters a file cannot hold are replaced', n('OneDrive_1_11-6-2026.zip', 'Kylo: Rough? - OneDrive'), 'Kylo_ Rough_.zip');
ok('a title that is a file keeps one extension', n('OneDrive_1_11-6-2026.zip', 'Ahsoka.zip - OneDrive'), 'Ahsoka.zip');
ok('a real file name is left alone', n('Cal_Kestis_V2.zip', 'Downloads - OneDrive'), 'Cal_Kestis_V2.zip');
ok('a name merely starting OneDrive words stays', n('OneDriveFont.zip', 'Thing - OneDrive'), 'OneDriveFont.zip');
ok('no title keeps the file name', n('OneDrive_1_11-6-2026.zip', ''), 'OneDrive_1_11-6-2026.zip');
ok('a drive page that names nothing keeps the file name', n('OneDrive_1_11-6-2026.zip', 'My files - OneDrive'), 'OneDrive_1_11-6-2026.zip');
ok('a bare drive title keeps the file name', n('drive-download-1.zip', 'Google Drive'), 'drive-download-1.zip');
ok('a sign-in page keeps the file name', n('OneDrive_1_11-6-2026.zip', 'Sign in - Microsoft OneDrive'), 'OneDrive_1_11-6-2026.zip');
ok('an address as a title keeps the file name', n('OneDrive_1_11-6-2026.zip', 'https://1drv.ms/f/abc'), 'OneDrive_1_11-6-2026.zip');

console.log(failed ? `\n${failed} failure(s)` : '\nall drive name tests passed');
process.exit(failed ? 1 : 0);
