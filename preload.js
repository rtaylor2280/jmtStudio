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
  stylesFileExists: ()          => ipcRenderer.invoke('styles:exists'),
  getStylesPath:    ()          => ipcRenderer.invoke('styles:getPath'),
  importStylesFile: ()          => ipcRenderer.invoke('styles:import'),
  deleteStylesFile: ()          => ipcRenderer.invoke('styles:delete'),
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
  getAppVersion:      ()         => ipcRenderer.invoke('app:getVersion'),
  isDevMode:          ()         => ipcRenderer.invoke('app:isDevMode'),
  getArduinoDataPath: ()         => ipcRenderer.invoke('app:getArduinoDataPath'),
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
  importVersion:       (sourcePath, versionName, proffieVersion) => ipcRenderer.invoke('proffieOS:importVersion', { sourcePath, versionName, proffieVersion }),
  listVersionsDetails: ()                      => ipcRenderer.invoke('versions:listDetails'),
  readVersionNotes:    (name)                  => ipcRenderer.invoke('versions:readNotes', name),
  writeVersionNotes:   (name, content)         => ipcRenderer.invoke('versions:writeNotes', { name, content }),
  renameVersion:       (oldName, newName)      => ipcRenderer.invoke('versions:rename', { oldName, newName }),
  duplicateVersion:    (name, newName)         => ipcRenderer.invoke('versions:duplicate', { name, newName }),
  deleteVersion:       (name)                  => ipcRenderer.invoke('versions:delete', name),
  openVersionFolder:   (name)                  => ipcRenderer.invoke('versions:openFolder', name),
  exportVersion:       (name)                  => ipcRenderer.invoke('versions:export', name),
  listVersionDir:      (name, subPath)         => ipcRenderer.invoke('versions:listDir', { name, subPath }),
  readVersionFile:     (name, subPath)         => ipcRenderer.invoke('versions:readFile', { name, subPath }),
  searchVersionFiles:  (name, query)           => ipcRenderer.invoke('versions:search', { name, query }),
  fetchReleases:       ()                       => ipcRenderer.invoke('versions:fetchReleases'),
  downloadRelease:     (downloadUrl, versionName, proffieVersion) => ipcRenderer.invoke('versions:downloadRelease', { downloadUrl, versionName, proffieVersion }),
  onDownloadProgress:  (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('versions:downloadProgress', handler);
    return () => ipcRenderer.removeListener('versions:downloadProgress', handler);
  },
  fetchJmtManifest:    ()                    => ipcRenderer.invoke('versions:fetchJmtManifest'),
  checkJmtIntegrity:   (versionName, files)  => ipcRenderer.invoke('versions:checkJmtIntegrity', { versionName, files }),
  applyJmtFeatures:    (name)                => ipcRenderer.invoke('versions:applyJmtFeatures', name),
  onJmtProgress:       (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('versions:jmtProgress', handler);
    return () => ipcRenderer.removeListener('versions:jmtProgress', handler);
  },

  // ── DFU ──────────────────────────────────────────────
  detectDFU:    () => ipcRenderer.invoke('dfu:detect'),
  flashDFU:     () => ipcRenderer.invoke('dfu:flash'),
  downloadDfuSetup:  () => ipcRenderer.invoke('dfu:downloadSetup'),
  installDfuSetup:   () => ipcRenderer.invoke('dfu:installSetup'),
  cleanupDfuSetup:   () => ipcRenderer.invoke('dfu:cleanupSetup'),
  onDfuSetupStatus: (cb) => {
    const handler = (_, msg) => cb(msg);
    ipcRenderer.on('dfu:setupStatus', handler);
    return () => ipcRenderer.removeListener('dfu:setupStatus', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  checkForUpdate:  (force) => ipcRenderer.invoke('app:checkForUpdate', { force: !!force }),
  downloadUpdate:  (downloadUrl, assetName) => ipcRenderer.invoke('app:downloadUpdate', { downloadUrl, assetName }),
  installUpdate:   () => ipcRenderer.invoke('app:installUpdate'),
  onUpdateProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('app:updateProgress', handler);
    return () => ipcRenderer.removeListener('app:updateProgress', handler);
  },

  onAppClosing:    (cb) => ipcRenderer.on('app:closing', cb),
  doClose:         () => ipcRenderer.send('app:doClose'),

  readClipboard:   () => ipcRenderer.invoke('clipboard:read'),

});