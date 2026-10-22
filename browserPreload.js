// The in-app browser's pages: the app's scrollbar, added as each page is created so it is there
// before the page first draws. Nothing is exposed to the page.
'use strict';

const { webFrame } = require('electron');

webFrame.insertCSS(
  '*::-webkit-scrollbar{width:6px;height:6px}'
  + '*::-webkit-scrollbar-track{background:transparent}'
  + '*::-webkit-scrollbar-thumb{background:#333333;border-radius:3px}'
  + '*::-webkit-scrollbar-corner{background:transparent}');
