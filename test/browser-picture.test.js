// The in-app browser can save an image, or the frame a paused YouTube video shows, as a font image,
// from the font and source windows and from import review (held on the row until Import). [B-563]
//
//   1. videoFrameRect: the picture inside the element (no letterbox), offset by its frame, inset so
//      YouTube's rounded corners are left out, kept on screen.
//   2. Wiring: the menu items, who gets them, and how the picture reaches the font.
'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}
const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'soundFontLinkImport.js'));
const R = L.videoFrameRect;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('1. the frame rectangle');
let r = R({ x: 100, y: 50, w: 1280, h: 720, vw: 1920, vh: 1080 }, null, null, 6);
check('same shape: the element, inset 6 on every side', eq(r, { x: 106, y: 56, width: 1268, height: 708 }), JSON.stringify(r));
r = R({ x: 0, y: 0, w: 1000, h: 1000, vw: 1920, vh: 1080 }, null, null, 0);
check('wider video in a square box: the bars above and below are left out', eq(r, { x: 0, y: 219, width: 1000, height: 562 }), JSON.stringify(r));
r = R({ x: 10, y: 20, w: 640, h: 360, vw: 1280, vh: 720 }, { x: 300, y: 400 }, null, 6);
check('an embedded player is moved by its frame offset', eq(r, { x: 316, y: 426, width: 628, height: 348 }), JSON.stringify(r));
r = R({ x: -100, y: 600, w: 1280, h: 720, vw: 1920, vh: 1080 }, null, { w: 1200, h: 900 }, 6);
check('kept on screen: clipped to the window', eq(r, { x: 0, y: 606, width: 1174, height: 294 }), JSON.stringify(r));
check('a player scrolled out of view: nothing', R({ x: 0, y: 2000, w: 640, h: 360, vw: 1280, vh: 720 }, null, { w: 1200, h: 900 }, 6) === null);
check('no video size yet: nothing', R({ x: 0, y: 0, w: 640, h: 360, vw: 0, vh: 0 }, null, null, 6) === null);

console.log('2. wiring');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
check('the inset clears a 12 px corner (more than 0.3 of the radius)', /const _YT_FRAME_INSET = 6;/.test(main));
check('only a paused video with a picture is offered', /if \(!v \|\| !v\.paused \|\| !v\.videoWidth\) return null;/.test(main));
check('only YouTube: frames are found by their YouTube video id', /async function _youtubeFrame\(page\)[\s\S]{0,300}soundFontLinkImport\.youtubeVideoId\(f\.url\)/.test(main));
check("YouTube's controls are hidden for the capture and put back after",
  /async function _captureYoutubeFrame[\s\S]{0,400}_YT_FRAME_HIDE[\s\S]{0,300}capturePage\(rect\)[\s\S]{0,400}finally \{[\s\S]{0,120}\.remove\(\)/.test(main));
check('an image is fetched with the page session and stored as PNG', /page\.webContents\.session\.fetch\(srcURL\)/.test(main) && /_decodeToPng\(raw\)/.test(main));
check('each picture has its own temp folder (cleanup removes a whole folder)', /function _pagePictureDir\(\) \{\s*return fs\.mkdtempSync\(path\.join\(require\('os'\)\.tmpdir\(\), 'jmt-linkimport-'\)\);/.test(main));
check('the items appear only when the opener takes pictures and fonts are known',
  /if \(names && names\.length && typeof images === 'function' && images\(\)\) \{/.test(main)
  && /pictureItem\('Save as font image'/.test(main) && /pictureItem\('Save video frame as font image'/.test(main));
check('the font and source windows and import review all ask for images',
  /linkCaptureOpen\(\{ url, fonts: names, forName, images: true \}\)/.test(html)
  && /linkCaptureOpen\(\{ url, fonts: _sfCaptureFontList\(\), allLabel: 'All checked fonts', images: true \}\)/.test(html));
check('each image carries a thumbnail for the review row', /nativeImage\.createFromPath\(pic\.filePath\)\.resize\(\{ height: 52 \}\)\.toDataURL\(\)/.test(main)
  && /value = \{ \.\.\.value, thumb \};/.test(main));

console.log('3. import review');
check('a row holds its image (a new one drops one saved earlier this session, keeps the one from before for Undo) and shows the thumbnail',
  /if \(row\.dataset\.image && row\.dataset\.image !== before\.get\(key\)\.filePath\) _sfDropReviewImage\(row\.dataset\.image\);\s*_sfReviewImages\.add\(value\.filePath\);\s*_sfImportSetImage\(row, value\.filePath, value\.thumb\);/.test(html)
  && /<img class="cand-image-thumb" alt="">/.test(html) && /<button class="cand-image-clear" title="Remove this font image">/.test(html));
check('the × drops it and deletes the file', /closest\('\.cand-image-clear'\)[\s\S]{0,200}_sfDropReviewImage\(row\.dataset\.image\);\s*delete row\.dataset\.image;/.test(html));
check('Import carries it with the row', /demoUrl,\s*image: row\.dataset\.image \|\| '',\s*\}\);/.test(html));
check('once the font is created, its image goes in through the Paste path, then the file goes',
  /else if \(pick\.image\) \{[\s\S]{0,600}_sfReplaceItemImage\(\{ kind: 'entry', id: fontName, oldSubPath: own && own\.subPath, filePath: pick\.image \}\)[\s\S]{0,60}_sfDropReviewImage\(pick\.image\);/.test(html));
check('closing the review, imported or not, deletes every image still held',
  /linkCaptureClose\(\); \} catch \{\}\s*for \(const f of Array\.from\(_sfReviewImages\)\) _sfDropReviewImage\(f\);/.test(html));
check("the picture replaces the font's own, the way Paste does, then the temp folder goes",
  /key\.startsWith\('image:'\)[\s\S]{0,700}_sfReplaceItemImage\(\{ kind: 'entry', id: name, oldSubPath: own && own\.subPath, filePath: value\.filePath \}\)[\s\S]{0,300}linkImportCleanup/.test(html));

console.log('4. Find');
check('Find sits between Add/Replace and Paste on both Image rows',
  /id="btn-sf-entry-picture-add"[^\n]*\n\s*<button class="sf-pop-action" id="btn-sf-entry-picture-find"[^\n]*>Find<\/button>\n\s*<button class="sf-pop-action" id="btn-sf-entry-picture-paste"/.test(html)
  && /id="btn-sf-source-picture-add"[^\n]*\n\s*<button class="sf-pop-action" id="btn-sf-source-picture-find"[^\n]*>Find<\/button>\n\s*<button class="sf-pop-action" id="btn-sf-source-picture-paste"/.test(html));
check('Find opens the same browser on Google Images, for this font or this source',
  /const SF_IMAGE_SEARCH_URL = 'https:\/\/images\.google\.com\/';/.test(html)
  && /btn-sf-entry-picture-find'\)\?\.addEventListener\('click', \(e\) => \{\s*if \(_sfDetailEdit\) _sfOpenSourceCapture\(e, SF_IMAGE_SEARCH_URL, _sfDetailSourceUuid\(\), _sfDetailOriginalName\);/.test(html)
  && /btn-sf-source-picture-find'\)\?\.addEventListener\('click', \(e\) => \{\s*if \(_sfSourceEdit\) _sfOpenSourceCapture\(e, SF_IMAGE_SEARCH_URL, _sfSourceOriginalUuid, null\);/.test(html));
check('not in the image right-click menu', !/Find image/.test(html));

console.log('5. Undo on the strip');
const strip = fs.readFileSync(path.join(ROOT, 'renderer', 'link-picks.html'), 'utf8');
const stripPre = fs.readFileSync(path.join(ROOT, 'linkPicksPreload.js'), 'utf8');
check('each row has an Undo button, JMT blue, on the right, with what it puts back as its hover',
  /grid-template-columns: max-content minmax\(0, 1fr\) max-content;/.test(strip)
  && /\.undo \{ background: var\(--jmt-blue\);/.test(strip)
  && /b\.textContent = 'Undo';\s*b\.title = undo;\s*b\.addEventListener\('click', \(\) => window\.linkPicks\.undo\(key\)\);/.test(strip)
  && /undo: \(key\) => ipcRenderer\.send\('linkpicks:undo', \{ key \}\)/.test(stripPre));
check('main removes the row and hands the undo to whoever opened the browser',
  /strip\.webContents\.ipc\.on\('linkpicks:undo'/.test(main)
  && /const undo = \(key\) => \{\s*if \(!shown\.has\(key\)\) return;\s*shown\.delete\(key\);/.test(main)
  && /onUndo: \(key\) => \{ try \{ event\.sender\.send\('linkCapture:undo', \{ key \}\); \} catch \{\} \},/.test(main)
  && /onUndo: \(key\) => \{\s*const v = picks\[key\];\s*delete picks\[key\];/.test(main));
check('font and source windows: the state before the session is recorded on the first save only',
  /if \(!before\.has\(key\)\) \{\s*before\.set\(key, sourceOpen \?/.test(html)
  && /pictureFromCopied\(\{ kind: 'entry', id: name, subPath: own\.subPath \}\)/.test(html));
check('their Undo puts back the Link, the Demo, the old image (or removes the new one), and unlinks only proofs it added',
  /await _sfCaptureApplyLink\(uuid, b\);/.test(html) && /if \(name\) await _sfCaptureApplyDemo\(name, b\);/.test(html)
  && /_sfReplaceItemImage\(\{ kind: 'entry', id: b\.name, oldSubPath: own && own\.subPath, filePath: b\.copy \}\)/.test(html)
  && /fileOpsDelete\(\{ kind: 'entry', id: b\.name, subPaths: \[own\.subPath\] \}\)/.test(html)
  && /if \(r && r\.ok && r\.id && !had\.includes\(r\.id\)\) \{/.test(html)
  && /unlinkAttachment\(\{ uuid, id \}\)/.test(html));
check('import review: its Undo puts back the Link field, the row Demo and image, and unlinks its proofs',
  /if \(_sfImportEls\.link\) _sfImportEls\.link\.value = b;/.test(html)
  && /_sfImportSetDemo\(b\.row, b\.value\)/.test(html) && /_sfImportSetImage\(b\.row, b\.filePath, b\.thumb\)/.test(html)
  && /unlinkAttachment\(\{ uuid: b\.uuid, id \}\)/.test(html));
check('saves and Undo show no toast on the strip (the row is the confirmation); failures still do',
  /try \{ onSave\(key, value\); \} catch \{\}\s*\/\/[^\n]*\n\s*show\(\);/.test(main)
  && !/show\('Undone'\)|show\(`Saved as|show\('Saved as/.test(main)
  && /show\('Could not get that image'\)/.test(main));
check('each browser session starts with nothing to undo', /_sfCapture = \{ uuid, names, before: new Map\(\) \};/.test(html)
  && /window\._sfCaptureTarget = 'import';\s*for \(const b of _sfImportCaptureBefore\.values\(\)\) \{ if \(b && b\.copy\)[^\n]*\n\s*_sfImportCaptureBefore = new Map\(\);/.test(html));

console.log('6. source image');
check('Save as source image (and the video frame one) for a bundle only, beside the font item',
  /if \(names\.length > 1\) items\.push\(sourceImageItem\(\(\) => _imageFromPage\(page, imgSrc\)\)\);/.test(main)
  && /if \(names\.length > 1\) items\.push\(\{ \.\.\.sourceImageItem\(\(\) => _captureYoutubeFrame\(page, frame\)\), label: 'Save video frame as source image' \}\);/.test(main)
  && /label: 'Save as source image'/.test(main));
check("the source's old image is copied before the first change (the store releases it on replace)",
  /ipcMain\.handle\('sources:pictureToTemp'/.test(main)
  && /if \(!before\.has\('sourceImage'\)\) \{[\s\S]{0,200}sourcePictureToTemp\(\{ uuid \}\)/.test(html));
check('Undo sets the copy back, or clears the source image when there was none',
  /if \(b\.copy\) await window\.electronAPI\.setSourcePicture\(\{ uuid, filePath: b\.copy \}\);\s*else await window\.electronAPI\.clearSourcePicture\(\{ uuid \}\);/.test(html));
check('font and source windows and import review all handle it',
  /key === 'sourceImage' && value && value\.filePath\) \{\s*try \{\s*await _sfCaptureSourceImage\(uuid, before, value\.filePath\);/.test(html)
  && /await window\._sfCaptureSourceImage\(_sfImport\.uuid, before, value\.filePath\);/.test(html));

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
