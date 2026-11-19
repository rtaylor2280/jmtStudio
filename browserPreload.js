// The in-app browser's pages: the app's scrollbar, added as each page is created so it is there
// before the page first draws. Nothing is exposed to the page.
'use strict';

const { webFrame } = require('electron');

webFrame.insertCSS(
  '*::-webkit-scrollbar{width:6px;height:6px}'
  + '*::-webkit-scrollbar-track{background:transparent}'
  + '*::-webkit-scrollbar-thumb{background:#333333;border-radius:3px}'
  + '*::-webkit-scrollbar-corner{background:transparent}');

// In the window that imports from a link: a click on something labelled Download shows a bar until
// the download starts (the window then hides), because a site can take seconds to prepare a
// download (OneDrive zips a folder first) and nothing on the page says so. [BUG-029]
const WAIT_MS = 60000;
if ((process.argv || []).includes('--jmt-download-wait')) {
  let bar = null;
  let timer = null;
  const say = (text) => {
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('role', 'status');
      // In the app's colours: light mode when Studio passed --jmt-light.
      const light = (process.argv || []).includes('--jmt-light');
      bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;'
        + 'padding:10px 14px;border-radius:6px;'
        + (light ? 'background:#ffffff;color:#333333;border:1px solid #b0b0b0;box-shadow:0 2px 10px rgba(0,0,0,.15);'
                 : 'background:#1f2a36;color:#ffffff;box-shadow:0 2px 10px rgba(0,0,0,.4);')
        + 'font:14px/1.4 "Segoe UI",system-ui,sans-serif;pointer-events:none';
      (document.body || document.documentElement).appendChild(bar);
    }
    bar.textContent = text;
  };
  const labelOf = (el) => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'),
    el.hasAttribute('download') ? 'download' : ''].filter(Boolean).join(' ');
  window.addEventListener('click', (e) => {
    const el = e.target && e.target.closest
      ? e.target.closest('a,button,[role="button"],[role="menuitem"],input[type="button"],input[type="submit"]')
      : null;
    if (!el || !/download/i.test(labelOf(el))) return;
    say('Waiting for the site to start the download…');
    clearTimeout(timer);
    timer = setTimeout(() => say('The site hasn’t started a download. Try the Download button again.'), WAIT_MS);
  }, true);
}
