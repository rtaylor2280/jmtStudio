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

console.log(failures ? `\nyoutube-moment-link: ${failures} FAILED` : '\nyoutube-moment-link: all passed');
process.exit(failures ? 1 : 0);
