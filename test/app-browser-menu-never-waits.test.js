// The app browser's right-click menu opens even when the page has stopped answering. Each question the
// menu asks the page is answered within a second or replaced by a fallback. [QA14: a stuck save left the
// page unresponsive and the menu never opened.]
'use strict';

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  <- ' + (detail || '')}`);
  if (!ok) failures++;
}

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const a = main.indexOf('function _pageAnswer(');
const src = a > -1 ? main.slice(a, main.indexOf('\n}\n', a) + 2) : '';
check('CONTROL lifted _pageAnswer', src.includes('Promise.race'));
const _pageAnswer = new Function(`${src}; return _pageAnswer;`)();

(async () => {
  const t0 = Date.now();
  const never = new Promise(() => {});
  const r1 = await _pageAnswer(never, 'fallback', 100);
  check('a page that never answers gets the fallback, on time', r1 === 'fallback' && Date.now() - t0 < 1000, `${r1} after ${Date.now() - t0} ms`);
  check('an answer in time is used', (await _pageAnswer(Promise.resolve('answer'), 'fallback', 100)) === 'answer');
  check('a question that fails gets the fallback', (await _pageAnswer(Promise.reject(new Error('x')), true, 100)) === true);

  const block = main.slice(main.indexOf("page.webContents.on('context-menu'"), main.indexOf('Menu.buildFromTemplate(items).popup'));
  check('every question the menu asks the page goes through it',
    /await _pageAnswer\(_youtubeMoment\(page\), null\)/.test(block) && /await _pageAnswer\(_youtubeFrame\(page\), null\)/.test(block)
    && /await _pageAnswer\(_pdfAllowed\(page\), true\)/.test(block)
    && !/await _youtubeMoment\(|await _youtubeFrame\(|await _pdfAllowed\(/.test(block));

  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'link-picks.html'), 'utf8');
  check('a failure message on the save bar stays until the next update (no fade timer)',
    !/hideTimer/.test(html) && /toast\.classList\.remove\('show'\);\s*\}/.test(html));
  check('the stuck-save message says to restart Studio',
    main.includes("This page didn't finish rendering. Restart Studio before saving another page as proof."));

  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
