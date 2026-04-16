const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── File operations ──────────────────────────────────
  openFile:      ()                     => ipcRenderer.invoke('dialog:open'),
  readFile:      (filePath)             => ipcRenderer.invoke('file:read', filePath),
  saveFile:      (filePath, content)    => ipcRenderer.invoke('file:save', { filePath, content }),
  saveAs:        (defaultName, content) => ipcRenderer.invoke('dialog:saveAs', { defaultName, content }),
  getSavePath:   (defaultName)          => ipcRenderer.invoke('dialog:getSavePath', { defaultName }),
  getLastFile:    ()                     => ipcRenderer.invoke('store:getLastFile'),
  setLastFile:    (filePath)             => ipcRenderer.invoke('store:setLastFile', filePath),
  clearLastFile:  ()                     => ipcRenderer.invoke('store:clearLastFile'),
  getRecentFiles:    ()           => ipcRenderer.invoke('store:getRecentFiles'),
  removeRecentFile:  (filePath)  => ipcRenderer.invoke('store:removeRecentFile', filePath),
  getSetting: (key, def)         => ipcRenderer.invoke('store:getSetting', key, def),
  setSetting: (key, value)       => ipcRenderer.invoke('store:setSetting', key, value),

  // ── Style Library ──────────────────────────────────────
  readStylesFile:   ()          => ipcRenderer.invoke('styles:read'),
  writeStylesFile:  (content)   => ipcRenderer.invoke('styles:write', content),
  exportStylesFile: ()          => ipcRenderer.invoke('styles:export'),
  replaceStylesFile:()          => ipcRenderer.invoke('styles:replace'),
  getFavorites:      ()                        => ipcRenderer.invoke('favorites:get'),
  addFavorite:       (filePath)                => ipcRenderer.invoke('favorites:add', filePath),
  removeFavorite:    (filePath)                => ipcRenderer.invoke('favorites:remove', filePath),
  reorderFavorites:  (orderedPaths)            => ipcRenderer.invoke('favorites:reorder', orderedPaths),
  setTitle:      (title)                => ipcRenderer.send('title:set', title),

  // ── Toolchain ────────────────────────────────────────
  initToolchain: ()              => ipcRenderer.invoke('toolchain:initialize'),
  compile: (configContent, fqbn, buildOptions) => 
    ipcRenderer.invoke('toolchain:compile', { configContent, fqbn, buildOptions }),
  flash:   (port, fqbn)          => ipcRenderer.invoke('toolchain:flash', { port, fqbn }),
  getToolStatus:  ()             => ipcRenderer.invoke('toolchain:getStatus'),
  abortCompile:   ()             => ipcRenderer.invoke('toolchain:abort'),
  getAppVersion:  ()             => ipcRenderer.invoke('app:getVersion'),
  isDevMode:      ()             => ipcRenderer.invoke('app:isDevMode'),
  checkCache: (configContent, fqbn, usb) =>
    ipcRenderer.invoke('cache:check', { configContent, fqbn, usb }),
  getCacheSize:    () => ipcRenderer.invoke('cache:getSize'),
  clearCache:      () => ipcRenderer.invoke('cache:clear'),
  getDataSize:     () => ipcRenderer.invoke('cache:getDataSize'),

  // ── Port detection ───────────────────────────────────
  listPorts:          () => ipcRenderer.invoke('ports:list'),
  listPortsRaw:       () => ipcRenderer.invoke('ports:listRaw'),
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
  // ── ProffieOS versions ───────────────────────────────────
  listProffieVersions: ()                        => ipcRenderer.invoke('proffieOS:listVersions'),
  getSelectedVersion:  ()                        => ipcRenderer.invoke('proffieOS:getSelected'),
  selectVersion:       (name)                    => ipcRenderer.invoke('proffieOS:selectVersion', name),
  selectFolder:        ()                        => ipcRenderer.invoke('dialog:selectFolder'),
  validateVersionSource: (sourcePath)            => ipcRenderer.invoke('proffieOS:validateSource', sourcePath),
  importVersion:       (sourcePath, versionName) => ipcRenderer.invoke('proffieOS:importVersion', { sourcePath, versionName }),
  listVersionsDetails: ()                      => ipcRenderer.invoke('versions:listDetails'),
  readVersionNotes:    (name)                  => ipcRenderer.invoke('versions:readNotes', name),
  writeVersionNotes:   (name, content)         => ipcRenderer.invoke('versions:writeNotes', { name, content }),
  renameVersion:       (oldName, newName)      => ipcRenderer.invoke('versions:rename', { oldName, newName }),
  duplicateVersion:    (name, newName)         => ipcRenderer.invoke('versions:duplicate', { name, newName }),
  deleteVersion:       (name)                  => ipcRenderer.invoke('versions:delete', name),
  exportVersion:       (name)                  => ipcRenderer.invoke('versions:export', name),
  listVersionDir:      (name, subPath)         => ipcRenderer.invoke('versions:listDir', { name, subPath }),
  readVersionFile:     (name, subPath)         => ipcRenderer.invoke('versions:readFile', { name, subPath }),
  searchVersionFiles:  (name, query)           => ipcRenderer.invoke('versions:search', { name, query }),

  // ── DFU ──────────────────────────────────────────────
  detectDFU:    () => ipcRenderer.invoke('dfu:detect'),
  flashDFU:     () => ipcRenderer.invoke('dfu:flash'),
  runDfuSetup:  () => ipcRenderer.invoke('dfu:runSetup'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  onAppClosing:    (cb) => ipcRenderer.on('app:closing', cb),
  doClose:         () => ipcRenderer.send('app:doClose'),

  // ── Dev-only ─────────────────────────────────────────
  devGetRendererPath: () => ipcRenderer.invoke('dev:getRendererPath'),
  devWriteFile:       (filePath, content) => ipcRenderer.invoke('dev:writeFile', { filePath, content })

});