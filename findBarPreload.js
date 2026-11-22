// The find bar's bridge to main: what it searches for, closing it, and the match count back.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('findBar', {
  query: (params) => ipcRenderer.send('findbar:query', params),
  close: () => ipcRenderer.send('findbar:close'),
  onResult: (fn) => ipcRenderer.on('findbar:result', (_e, r) => fn(r)),
  onFocus: (fn) => ipcRenderer.on('findbar:focus', () => fn()),
  searchThread: (text) => ipcRenderer.send('findbar:thread', { text }),
  onContext: (fn) => ipcRenderer.on('findbar:context', (_e, c) => fn(c)),
});
