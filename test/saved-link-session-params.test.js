// A Link or Demo saved from the in-app browser loses a site's login-session parameters. [B-521]
//
// A forum page copied while logged in carries PHPSESSID; saved as it is, the source would keep and
// export an address tied to that session. Only the session parameters go; the rest of the address,
// including its other parameters, is kept exactly.
'use strict';

const L = require('../soundFontLinkImport.js');

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  <- got ${got}, want ${want}`}`);
  if (!ok) failures++;
}

console.log('session parameters go');
check('PHPSESSID on a forum board, board kept',
  L.stripSessionParams('https://www.saberforum.com/index.php?PHPSESSID=b49lk8592l8bfv7rhp8e522u52&board=2.0'),
  'https://www.saberforum.com/index.php?board=2.0');
check('any case', L.stripSessionParams('https://x.example/p?phpsessid=abc&id=7'), 'https://x.example/p?id=7');
check('sid, sessionid, session_id',
  L.stripSessionParams('https://x.example/p?sid=1&sessionid=2&session_id=3&page=4'), 'https://x.example/p?page=4');
check('jsessionid in the path', L.stripSessionParams('https://x.example/shop/item;jsessionid=ABC123?id=9'),
  'https://x.example/shop/item?id=9');
check('nothing left after them: no stray ?', L.stripSessionParams('https://x.example/p?PHPSESSID=abc'),
  'https://x.example/p');

console.log('everything else is kept');
const yt = 'https://www.youtube.com/watch?v=OVaql8OJahk&t=151s';
check('a timed YouTube Demo', L.stripSessionParams(yt), yt);
const product = 'https://saberfont.com/Fallen-Order-Bundle-for-Proffie_p_1339.html';
check('a plain product page', L.stripSessionParams(product), product);
check('a parameter that only contains "sid"', L.stripSessionParams('https://x.example/p?side=left'),
  'https://x.example/p?side=left');
check('not a link, returned as given', L.stripSessionParams('not a url'), 'not a url');

console.log(failures ? `\nsaved-link-session-params: ${failures} FAILED` : '\nsaved-link-session-params: all passed');
process.exit(failures ? 1 : 0);
