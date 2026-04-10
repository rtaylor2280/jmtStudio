const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── File operations ──────────────────────────────────
  openFile:      ()                     => ipcRenderer.invoke('dialog:open'),
  readFile:      (filePath)             => ipcRenderer.invoke('file:read', filePath),
  saveFile:      (filePath, content)    => ipcRenderer.invoke('file:save', { filePath, content }),
  saveAs:        (defaultName, content) => ipcRenderer.invoke('dialog:saveAs', { defaultName, content }),
  getSavePath:   (defaultName)          => ipcRenderer.invoke('dialog:getSavePath', { defaultName }),
  getLastFile:    ()                     => ipcRenderer.invoke('store:getLastFile'),
  clearLastFile:  ()                     => ipcRenderer.invoke('store:clearLastFile'),
  getRecentFiles:    ()           => ipcRenderer.invoke('store:getRecentFiles'),
  removeRecentFile:  (filePath)  => ipcRenderer.invoke('store:removeRecentFile', filePath),
  setTitle:      (title)                => ipcRenderer.send('title:set', title),

  // ── Toolchain ────────────────────────────────────────
  initToolchain: ()              => ipcRenderer.invoke('toolchain:initialize'),
  compile: (configContent, fqbn, buildOptions) => 
    ipcRenderer.invoke('toolchain:compile', { configContent, fqbn, buildOptions }),
  flash:   (port, fqbn)          => ipcRenderer.invoke('toolchain:flash', { port, fqbn }),
  getToolStatus:  ()             => ipcRenderer.invoke('toolchain:getStatus'),
  abortCompile:   ()             => ipcRenderer.invoke('toolchain:abort'),
  getAppVersion:  ()             => ipcRenderer.invoke('app:getVersion'),

  // ── Port detection ───────────────────────────────────
  listPorts:          () => ipcRenderer.invoke('ports:list'),
  getRecommendedPort: () => ipcRenderer.invoke('ports:getRecommended'),

  // ── Build events (main → renderer) ──────────────────
  // Each returns an unsubscribe function — call it to clean up
  onBuildLog: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('build:log', handler);
    return () => ipcRenderer.removeListener('build:log', handler);
  },
  onBuildStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('build:status', handler);
    return () => ipcRenderer.removeListener('build:status', handler);
  },
  onBuildDone: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('build:done', handler);
    return () => ipcRenderer.removeListener('build:done', handler);
  },
  onAppClosing:    (cb) => ipcRenderer.on('app:closing', cb),
  doClose:         () => ipcRenderer.send('app:doClose')

});