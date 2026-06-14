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
  readDefaultTemplate: ()        => ipcRenderer.invoke('template:readDefault'),
  resetDefaultTemplate: ()       => ipcRenderer.invoke('template:resetDefault'),
  getTemplateStatus: ()          => ipcRenderer.invoke('template:getStatus'),
  importTemplate: ()             => ipcRenderer.invoke('template:import'),

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
  setPortPolling: (enabled) => ipcRenderer.send('ports:setPolling', enabled),
  onPortsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('ports:changed', handler);
    return () => ipcRenderer.removeListener('ports:changed', handler);
  },

  // ── Serial Monitor ───────────────────────────────────
  openSerial:  (port, baudRate)        => ipcRenderer.invoke('serial:open',   { port, baudRate }),
  closeSerial: ()                      => ipcRenderer.invoke('serial:close'),
  writeSerial: (text)                  => ipcRenderer.invoke('serial:write',  { text }),
  isSerialOpen: ()                     => ipcRenderer.invoke('serial:isOpen'),
  onSerialData: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('serial:data', handler);
    return () => ipcRenderer.removeListener('serial:data', handler);
  },
  onSerialClosed: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('serial:closed', handler);
    return () => ipcRenderer.removeListener('serial:closed', handler);
  },

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
  getArgumentNames:    (versionName)             => ipcRenderer.invoke('proffieOS:getArgumentNames', versionName),
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
  getAddonBranch:      ()                    => ipcRenderer.invoke('versions:getAddonBranch'),
  setAddonBranch:      (branch)              => ipcRenderer.invoke('versions:setAddonBranch', branch),
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

  // Splash lifecycle — used by the build panel to defer auto-opening
  // the log section until after the splash window has fully destroyed,
  // so the first-paint layout race that briefly let the panel grab the
  // full window during toolchain setup is avoided.
  onSplashDismissed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('app:splash-dismissed', handler);
    return () => ipcRenderer.removeListener('app:splash-dismissed', handler);
  },
  isSplashDismissed: () => ipcRenderer.invoke('app:isSplashDismissed'),

  // ── Sound Fonts Library ───────────────────────────────
  soundFontsExists:        ()                       => ipcRenderer.invoke('soundFonts:exists'),
  createSoundFonts:        ()                       => ipcRenderer.invoke('soundFonts:create'),
  listSoundFonts:          ()                       => ipcRenderer.invoke('soundFonts:listFonts'),
  listSoundFontsWithMeta:  ()                       => ipcRenderer.invoke('soundFonts:listFontsWithMeta'),
  scanSoundFontFolder:     (folderPath)             => ipcRenderer.invoke('soundFonts:scanFolder', folderPath),
  importSoundFont:         (params)                 => ipcRenderer.invoke('soundFonts:importFont', params),
  onSoundFontImportProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('soundFonts:importProgress', handler);
    return () => ipcRenderer.removeListener('soundFonts:importProgress', handler);
  },

  // ── Sound Fonts — sources (Phase 1) ───────────────────
  listSources:           ()           => ipcRenderer.invoke('sources:list'),
  sourceExistsByHash:    (hash)       => ipcRenderer.invoke('sources:existsByHash', hash),
  importSource:          (params)     => ipcRenderer.invoke('sources:import', params),
  deleteSource:          (params)     => ipcRenderer.invoke('sources:delete', params),
  updateSourceMeta:      (params)     => ipcRenderer.invoke('sources:updateMeta', params),
  onSourceImportProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('sources:importProgress', handler);
    return () => ipcRenderer.removeListener('sources:importProgress', handler);
  },

  // Format-dispatch reads (slice 2)
  browseSource:          (params)     => ipcRenderer.invoke('sources:browse', params),
  readSourceFile:        (params)     => ipcRenderer.invoke('sources:readFile', params),
  extractFromSource:     (params)     => ipcRenderer.invoke('sources:extractTo', params),
  exportSourceToDownloads: (params)   => ipcRenderer.invoke('sources:exportToDownloads', params),
  detectSourceVendor:    (params)     => ipcRenderer.invoke('sources:detectVendor', params),
  detectSourceCandidates: (params)    => ipcRenderer.invoke('sources:detectCandidates', params),

  // Library entries (Phase 1, slice 5)
  listEntries:           ()           => ipcRenderer.invoke('entries:list'),
  entryExistsByName:     (name)       => ipcRenderer.invoke('entries:existsByName', name),
  createEntry:           (params)     => ipcRenderer.invoke('entries:create', params),
  updateEntryMeta:       (params)     => ipcRenderer.invoke('entries:updateMeta', params),
  deleteEntry:           (params)     => ipcRenderer.invoke('entries:delete', params),
  listEntriesBySource:   (params)     => ipcRenderer.invoke('entries:listBySource', params),
  listSourceDocs:        (params)     => ipcRenderer.invoke('sources:listDocs', params),
  readSourceDocBytes:    (params)     => ipcRenderer.invoke('sources:readDocBytes', params),
  exportSourceDoc:       (params)     => ipcRenderer.invoke('sources:exportDoc', params),
  listEntryDocs:         (params)     => ipcRenderer.invoke('entries:listDocs', params),
  readEntryDocBytes:     (params)     => ipcRenderer.invoke('entries:readDocBytes', params),
  exportEntryDoc:        (params)     => ipcRenderer.invoke('entries:exportDoc', params),
  exportEntryToFolder:   (params)     => ipcRenderer.invoke('entries:exportToFolder', params),
  entryFolderExistsAt:   (params)     => ipcRenderer.invoke('entries:existsAt', params),
  selectSaveDestination: ()           => ipcRenderer.invoke('dialog:selectSaveDestination'),

  // Common folder management (Sound Fonts → side panel)
  listCommons:           ()           => ipcRenderer.invoke('common:list'),
  commonNameInUse:       (params)     => ipcRenderer.invoke('common:nameInUse', params),
  importCommonFromFolder:(params)     => ipcRenderer.invoke('common:importFromFolder', params),
  importCommonFromZip:   (params)     => ipcRenderer.invoke('common:importFromZip', params),
  renameCommon:          (params)     => ipcRenderer.invoke('common:rename', params),
  duplicateCommon:       (params)     => ipcRenderer.invoke('common:duplicate', params),
  deleteCommon:          (params)     => ipcRenderer.invoke('common:delete', params),
  listCommonFiles:       (params)     => ipcRenderer.invoke('common:listFiles', params),
  addCommonFiles:        (params)     => ipcRenderer.invoke('common:addFiles', params),
  renameCommonFile:      (params)     => ipcRenderer.invoke('common:renameFile', params),
  deleteCommonFile:      (params)     => ipcRenderer.invoke('common:deleteFile', params),
  createCommonSubfolder: (params)     => ipcRenderer.invoke('common:createSubfolder', params),
  copyCommonFiles:       (params)     => ipcRenderer.invoke('common:copyFiles', params),
  moveCommonFiles:       (params)     => ipcRenderer.invoke('common:moveFiles', params),
  readCommonFileBytes:   (params)     => ipcRenderer.invoke('common:readFileBytes', params),
  commonFolderExistsAt:  (params)     => ipcRenderer.invoke('common:folderExistsAt', params),
  exportCommonToFolder:  (params)     => ipcRenderer.invoke('common:exportToFolder', params),
  sfBackupPrep:          (params)     => ipcRenderer.invoke('sfBackup:prep', params),
  sfBackupExport:        (params)     => ipcRenderer.invoke('sfBackup:export', params),
  sfBackupCancel:        (params)     => ipcRenderer.invoke('sfBackup:cancel', params),
  selectBackupExportPath:()           => ipcRenderer.invoke('dialog:selectBackupExportPath'),
  selectBackupImportPath:()           => ipcRenderer.invoke('dialog:selectBackupImportPath'),
  sfBackupInspect:       (params)     => ipcRenderer.invoke('sfBackup:inspect', params),
  sfBackupApplyReplace:  (params)     => ipcRenderer.invoke('sfBackup:applyReplace', params),
  onSfBackupProgress:    (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('sfBackup:progress', handler);
    return () => ipcRenderer.removeListener('sfBackup:progress', handler);
  },
  selectCommonFiles:     ()           => ipcRenderer.invoke('dialog:selectCommonFiles'),
  selectCommonSource:    (params)     => ipcRenderer.invoke('dialog:selectCommonSource', params),
  onEntryCreateProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('entries:createProgress', handler);
    return () => ipcRenderer.removeListener('entries:createProgress', handler);
  },
  onSourceExtractProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('sources:extractProgress', handler);
    return () => ipcRenderer.removeListener('sources:extractProgress', handler);
  },

  selectSoundFontSource: (params) => ipcRenderer.invoke('dialog:selectSoundFontSource', params),

  readClipboard:   () => ipcRenderer.invoke('clipboard:read'),

});