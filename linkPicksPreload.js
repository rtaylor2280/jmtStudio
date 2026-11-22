// The saved-links strip's bridge to main: the rows to show, the confirmation to flash, and Undo on a row.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkPicks', {
  onUpdate: (fn) => ipcRenderer.on('linkpicks:update', (_e, u) => fn(u)),
  undo: (key) => ipcRenderer.send('linkpicks:undo', { key }),
});
