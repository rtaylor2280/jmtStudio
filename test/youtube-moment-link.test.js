// A YouTube Demo saved at a moment in the video. [B-521]
//
// The in-app browser reads where a YouTube player is and saves a link that opens there. The id
// comes from whichever link shape the page or its embedded player uses; anything that is not
// YouTube gives no id, so the timed item is never offered for it.
'use strict';

const L = require('../soundFontLinkImport.js');

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  <- got ${got}, want ${want}`}`);
  if (!ok) failures++;
}

console.log('the video id, from every link shape');
check('watch page', L.youtubeVideoId('https://www.youtube.com/watch?v=OVaql8OJahk&t=5'), 'OVaql8OJahk');
check('short link', L.youtubeVideoId('https://youtu.be/OVaql8OJahk'), 'OVaql8OJahk');
check('embedded player on a creator page', L.youtubeVideoId('https://www.youtube.com/embed/OVaql8OJahk?rel=0'), 'OVaql8OJahk');
check('privacy-mode embed', L.youtubeVideoId('https://www.youtube-nocookie.com/embed/OVaql8OJahk'), 'OVaql8OJahk');
check('shorts', L.youtubeVideoId('https://youtube.com/shorts/nQd1xfltS-k'), 'nQd1xfltS-k');
check('mobile', L.youtubeVideoId('https://m.youtube.com/watch?v=abcdef12'), 'abcdef12');

console.log('not YouTube: no id, so no timed Demo');
check('Vimeo', L.youtubeVideoId('https://vimeo.com/123456'), null);
check('a creator page', L.youtubeVideoId('https://saberfont.com/Fallen-Order-Bundle-for-Proffie_p_1339.html'), null);
check('YouTube home, no video', L.youtubeVideoId('https://www.youtube.com/'), null);
check('not a link', L.youtubeVideoId('not a url'), null);

console.log('the link and its label');
const m = L.youtubeMoment('OVaql8OJahk', 151.8);
check('whole seconds, rounded down', m.url, 'https://www.youtube.com/watch?v=OVaql8OJahk&t=151s');
check('m:ss', m.label, '2:31');
check('under a minute', L.youtubeMoment('x', 28).label, '0:28');
check('past an hour', L.youtubeMoment('x', 3725).label, '1:02:05');

// Copy link to highlight in the in-app browser.
const H = L.highlightLink;
check('a word', H('https://shop.example/fonts', 'Analog'), 'https://shop.example/fonts#:~:text=Analog');
check('spaces collapse and encode', H('https://a.b/p', '  Free   Smoothswing '), 'https://a.b/p#:~:text=Free%20Smoothswing');
check("',', '-' and '&' are escaped", H('https://a.b/p', 'Rock-and-roll, Salt & Pepper'),
  'https://a.b/p#:~:text=Rock%2Dand%2Droll%2C%20Salt%20%26%20Pepper');
check('a #section anchor is kept', H('https://a.b/p#fonts', 'Analog'), 'https://a.b/p#fonts:~:text=Analog');
check('an earlier highlight is replaced', H('https://a.b/p#:~:text=Old', 'Analog'), 'https://a.b/p#:~:text=Analog');
check('across lines: first and last words', H('https://a.b/p', 'Analog\nChapter 10 | A steam whistle commanded a sudden halt'),
  'https://a.b/p#:~:text=Analog,whistle%20commanded%20a%20sudden%20halt');
check('long on one line: first five and last five words',
  H('https://a.b/p', 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'),
  'https://a.b/p#:~:text=one%20two%20three%20four%20five,twelve%20thirteen%20fourteen%20fifteen%20sixteen');
check('nothing selected: no item', H('https://a.b/p', '  \n '), null);
check('not a web page: no item', H('file:///C:/x.html', 'Analog'), null);
check('saving keeps the highlight intact', L.stripSessionParams(H('https://a.b/p', 'Salt & Pepper')), 'https://a.b/p#:~:text=Salt%20%26%20Pepper');

const mainSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
const ctxAt = mainSrc.indexOf("page.webContents.on('context-menu'");
const ctx = ctxAt > -1 ? mainSrc.slice(ctxAt, mainSrc.indexOf('Menu.buildFromTemplate(items)', ctxAt)) : '';
check('the menu was located', ctx.length > 500, true);
check('highlight built from the page and the selection', /highlightLink\(\s*soundFontLinkImport\.stripSessionParams\(page\.webContents\.getURL\(\)\), params\.selectionText\)/.test(ctx), true);
check('Copy link to highlight, only with a selection', /\.\.\.\(highlight \? \[\{ label: 'Copy link to highlight', click: \(\) => clipboard\.writeText\(highlight\) \}\] : \[\]\)/.test(ctx), true);
check('Save as Link to highlight saves it as the Link', /label: 'Save as Link to highlight', click: \(\) => save\('linkUrl', 'Link', highlight,/.test(ctx), true);
check('no Demo to highlight (a Demo is a video)', !/Save as Demo to highlight/.test(ctx), true);

console.log(failures ? `\nyoutube-moment-link: ${failures} FAILED` : '\nyoutube-moment-link: all passed');
process.exit(failures ? 1 : 0);
