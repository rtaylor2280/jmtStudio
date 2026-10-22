// The saved-links strip's bridge to main: the rows to show and the confirmation to flash.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkPicks', {
  onUpdate: (fn) => ipcRenderer.on('linkpicks:update', (_e, u) => fn(u)),
});
