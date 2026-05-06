const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path        = require('path');
const fs          = require('fs');
const crypto      = require('crypto');
const toolchain   = require('./toolchain');
const portDetect  = require('./portDetector');
const proffie     = require('./proffieos');
const cacheManager = require('./cacheManager');

// ── Separate userData for dev vs prod ──────────────────
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'jmt-studio-dev'));
}

// ── Persist last file path ─────────────────────────────
const Store = {
  _path: path.join(app.getPath('userData'), 'prefs.json'),
  get(key) {
    try { return JSON.parse(fs.readFileSync(this._path, 'utf8'))[key]; }
    catch { return null; }
  },
  set(key, val) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(this._path, 'utf8')); } catch {}
    data[key] = val;
    fs.writeFileSync(this._path, JSON.stringify(data), 'utf8');
  }
};

function addRecentFile(filePath) {
  let files = Store.get('recentFiles') || [];
  files = [filePath, ...files.filter(f => f !== filePath)].slice(0, 20); // store up to max possible
  Store.set('recentFiles', files);
}

// ── Window ─────────────────────────────────────────────
let win;

function showSplash(parentWin) {
  const [cx, cy] = parentWin.getContentBounds
    ? (() => { const b = parentWin.getBounds(); return [b.x + b.width / 2, b.y + b.height / 2]; })()
    : [960, 540];

  const splash = new BrowserWindow({
    width: 400,
    height: 400,
    x: Math.round(cx - 200),
    y: Math.round(cy - 200),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: { contextIsolation: true }
  });

  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  splash.setIgnoreMouseEvents(true);

  setTimeout(() => {
    if (splash.isDestroyed()) return;
    // Fade out using native window opacity — 400ms over ~24 steps
    const duration = 400;
    const interval = 16;
    const steps = duration / interval;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      if (splash.isDestroyed()) { clearInterval(timer); return; }
      splash.setOpacity(1 - step / steps);
      if (step >= steps) {
        clearInterval(timer);
        if (!splash.isDestroyed()) splash.destroy();
      }
    }, interval);
  }, 1500);
}

function createWindow() {
  const bounds = Store.get('windowBounds')    || {};
  const wasMax = Store.get('windowMaximized') || false;

  win = new BrowserWindow({
    width:    bounds.width  || 1280,
    height:   1,
    ...(bounds.x != null && bounds.y != null ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#111111',
    titleBarStyle: 'default',
    ...(process.platform === 'win32'  ? { icon: path.join(__dirname, 'assets', 'icon.ico') }
      : process.platform === 'linux'  ? { icon: path.join(__dirname, 'assets', 'logo.png') }
      : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    win.setSize(bounds.width || 1280, bounds.height || 860);
    if (wasMax) win.maximize();
    showSplash(win);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setMenuBarVisibility(false);

  const saveBounds = () => {
    if (!win.isMaximized() && !win.isMinimized()) {
      Store.set('windowBounds', win.getBounds());
    }
    Store.set('windowMaximized', win.isMaximized());
  };
  win.on('resize', saveBounds);
  win.on('move',   saveBounds);

  // ── Close handler ──
  win.on('close', (e) => {
    e.preventDefault();
    win.webContents.send('app:closing');
  });

  // ── Block renderer reload shortcuts (Ctrl+R, Ctrl+Shift+R, F5) ──
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && input.key === 'r') || (ctrl && input.shift && input.key === 'r')) {
      e.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  // Evict stale cache entries before window opens
  try { cacheManager.startupEviction(); } catch {}

  // If launched via "Open With", override lastFile so the renderer loads it
  const argFile = process.argv.slice(1)
    .find(a => !a.startsWith('-') && /\.(h|txt)$/i.test(a) && fs.existsSync(a));
  if (argFile) {
    Store.set('lastFile', argFile);
    addRecentFile(argFile);
  }

  // Initialize selected ProffieOS version from prefs before window opens
  const versions    = proffie.listVersions();
  const lastVersion = Store.get('lastVersion');
  const initVersion = (lastVersion && versions.includes(lastVersion))
    ? lastVersion
    : (versions[0] || null);
  if (initVersion) proffie.setSelectedVersion(initVersion);

  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Log forwarder ──────────────────────────────────────
// Sends streaming log lines from toolchain to renderer
function makeLogger() {
  return (line, isError) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('build:log', { line, isError });
    }
  };
}

// ── IPC: File operations ───────────────────────────────
ipcMain.handle('dialog:open', async () => {
  const lastDir = Store.get('lastDir');
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open Config File',
    defaultPath: lastDir || app.getPath('documents'),
    filters: [
      { name: 'Header Files', extensions: ['h'] },
      { name: 'Text Files',   extensions: ['txt'] }
    ],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return null;
  const filePath = filePaths[0];
  Store.set('lastDir', path.dirname(filePath));
  Store.set('lastFile', filePath);
  addRecentFile(filePath);
  return { filePath, content: fs.readFileSync(filePath, 'utf8') };
});

ipcMain.handle('file:read', async (_, filePath) => {
  try { return { filePath, content: fs.readFileSync(filePath, 'utf8') }; }
  catch { return null; }
});

ipcMain.handle('file:save', async (_, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    Store.set('lastFile', filePath);
    Store.set('lastDir', path.dirname(filePath));
    addRecentFile(filePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('dialog:saveAs', async (_, { defaultName, content }) => {
  const lastDir = Store.get('lastDir');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save Config As',
    defaultPath: path.join(lastDir || app.getPath('documents'), defaultName || 'my_config.h'),
    filters: [{ name: 'Header Files', extensions: ['h'] }]
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    Store.set('lastFile', filePath);
    Store.set('lastDir', path.dirname(filePath));
    addRecentFile(filePath);
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('dialog:getSavePath', async (_, { defaultName }) => {
  const lastDir = Store.get('lastDir');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save Config As',
    defaultPath: path.join(lastDir || app.getPath('documents'), defaultName || 'my_config.h'),
    filters: [{ name: 'Header Files', extensions: ['h'] }]
  });
  if (canceled || !filePath) return null;
  Store.set('lastDir', path.dirname(filePath));
  return filePath;
});

ipcMain.on('app:doClose', () => {
  win.destroy();
});

ipcMain.handle('store:getLastFile',   () => Store.get('lastFile'));
ipcMain.handle('store:setLastFile',   (_, filePath) => Store.set('lastFile', filePath));
ipcMain.handle('store:clearLastFile', () => Store.set('lastFile', null));
ipcMain.handle('store:getRecentFiles', () => {
  const files = Store.get('recentFiles') || [];
  return files.map(fp => {
    if (!fs.existsSync(fp)) return { filePath: fp, exists: false, desc: null };
    try {
      const content = fs.readFileSync(fp, 'utf8');
      const m = content.match(/^\/\/ @jmt:description\s+(.+)$/m);
      return { filePath: fp, exists: true, desc: m ? m[1].trim() : null };
    } catch {
      return { filePath: fp, exists: false, desc: null };
    }
  });
});
ipcMain.handle('store:removeRecentFile', (_, filePath) => {
  const files = (Store.get('recentFiles') || []).filter(f => f !== filePath);
  Store.set('recentFiles', files);
});
// ── IPC: Style Library ─────────────────────────────────
ipcMain.handle('styles:exists', () => proffie.hasUserStyles());
ipcMain.handle('styles:getPath', () => proffie.getUserStylesPath());
ipcMain.handle('styles:delete', () => proffie.deleteUserStyles());
ipcMain.handle('styles:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import Style Library',
    filters: [{ name: 'Header File', extensions: ['h', 'hpp'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { ok: false };
  return proffie.importStylesFile(filePaths[0]);
});
ipcMain.handle('styles:read', () => proffie.readStagedStyles());
ipcMain.handle('styles:write', (_, content) => proffie.stageStyles(content));
ipcMain.handle('styles:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export Style Library',
    defaultPath: proffie.STYLES_FILENAME,
    filters: [{ name: 'Header File', extensions: ['h'] }]
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, proffie.readStagedStyles(), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('styles:replace', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Replace Style Library',
    filters: [{ name: 'Header / Text', extensions: ['h', 'hpp', 'txt'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    const content = fs.readFileSync(filePaths[0], 'utf8');
    return { ok: true, content };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('store:getSetting', (_, key, def) => {
  const val = Store.get(`settings.${key}`);
  return val !== undefined ? val : def;
});
ipcMain.handle('store:setSetting', (_, key, value) => {
  Store.set(`settings.${key}`, value);
});
ipcMain.on('title:set', (_, title) => win.setTitle(title));

// ── IPC: Toolchain ─────────────────────────────────────
ipcMain.handle('toolchain:initialize', async () => {
  const log = makeLogger();
  const result = await toolchain.initialize(log);
  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', {
      type: 'toolchain',
      ok: result.ok,
      message: result.ok ? 'Toolchain ready' : result.error
    });
  }
  return result;
});

ipcMain.handle('toolchain:compile', async (_, { configContent, fqbn, buildOptions }) => {
  const log = makeLogger();

  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', { type: 'compile', ok: null, message: 'Compiling...' });
  }

  const result = await toolchain.compile(configContent, fqbn, buildOptions, log);

  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', {
      type: 'compile',
      ok: result.ok,
      message: result.ok ? 'Compile successful' : result.error
    });
    win.webContents.send('build:done', { type: 'compile', ...result });
  }

  return result;
});

ipcMain.handle('toolchain:flash', async (_, { port, fqbn }) => {
  const log = makeLogger();

  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', { type: 'flash', ok: null, message: `Flashing on ${port}...` });
  }

  const result = await toolchain.flash(port, fqbn, log);

  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', {
      type: 'flash',
      ok: result.ok,
      message: result.ok ? 'Flash successful' : result.error
    });
    win.webContents.send('build:done', { type: 'flash', ...result });
  }

  return result;
});

ipcMain.handle('toolchain:getStatus', () => toolchain.getStatus());
ipcMain.handle('cache:check', (_, { configContent, fqbn, usb }) =>
  toolchain.checkCacheAndRestore(configContent, fqbn, usb));

ipcMain.handle('cache:getSize', () => {
  const cacheRoot = path.join(app.getPath('userData'), 'build-cache');
  function dirSize(p) {
    if (!fs.existsSync(p)) return 0;
    return fs.readdirSync(p, { withFileTypes: true }).reduce((sum, e) => {
      const full = path.join(p, e.name);
      return sum + (e.isDirectory() ? dirSize(full) : fs.statSync(full).size);
    }, 0);
  }
  return dirSize(cacheRoot);
});

ipcMain.handle('cache:clear', async () => {
  const userData    = app.getPath('userData');
  const cacheRoot   = path.join(userData, 'build-cache');
  const buildOutput = path.join(userData, 'build-output');
  function dirSize(p) {
    if (!fs.existsSync(p)) return 0;
    return fs.readdirSync(p, { withFileTypes: true }).reduce((sum, e) => {
      const full = path.join(p, e.name);
      return sum + (e.isDirectory() ? dirSize(full) : fs.statSync(full).size);
    }, 0);
  }
  const bytes = dirSize(cacheRoot) + dirSize(buildOutput);
  try {
    if (fs.existsSync(cacheRoot))   await fs.promises.rm(cacheRoot,   { recursive: true, force: true });
    if (fs.existsSync(buildOutput)) await fs.promises.rm(buildOutput, { recursive: true, force: true });
    return { ok: true, bytesCleared: bytes };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cache:getDataSize', () => {
  const userData = app.getPath('userData');
  function dirSize(p) {
    if (!fs.existsSync(p)) return 0;
    return fs.readdirSync(p, { withFileTypes: true }).reduce((sum, e) => {
      const full = path.join(p, e.name);
      return sum + (e.isDirectory() ? dirSize(full) : fs.statSync(full).size);
    }, 0);
  }
  return {
    cache:       dirSize(path.join(userData, 'build-cache')),
    arduinoData: dirSize(path.join(userData, 'arduino-data')),
    versions:    dirSize(path.join(userData, 'ProffieOS-versions')),
  };
});

ipcMain.handle('app:getVersion',      () => app.getVersion());
ipcMain.handle('app:isDevMode',       () => !app.isPackaged);
ipcMain.handle('app:getArduinoDataPath', () => {
  const os   = require('os');
  const base = app.isPackaged
    ? app.getPath('userData')
    : path.join(app.getPath('appData'), 'jmt-studio');
  const appPath = path.join(base, 'arduino-data');
  if (fs.existsSync(path.join(appPath, 'packages', 'proffieboard'))) return appPath;
  const systemPath = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Arduino15')
    : path.join(os.homedir(), '.arduino15');
  return systemPath;
});
ipcMain.handle('clipboard:read',      () => require('electron').clipboard.readText());

// ── IPC: App self-update ───────────────────────────────
const JMT_STUDIO_REPO = 'rtaylor2280/jmtStudio';
let _updateInfoCache    = null;
let _updateInfoCachedAt = 0;
const UPDATE_INFO_CACHE_TTL = 10 * 60 * 1000;

function _semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

ipcMain.handle('app:checkForUpdate', async (_, { force = false } = {}) => {
  const now = Date.now();
  if (!force && _updateInfoCache && (now - _updateInfoCachedAt < UPDATE_INFO_CACHE_TTL)) {
    return _updateInfoCache;
  }
  try {
    const body = await _httpsGet(
      `https://api.github.com/repos/${JMT_STUDIO_REPO}/releases/latest`,
      { 'User-Agent': 'JMT-Studio' }
    );
    const release        = JSON.parse(body);
    const latestVersion  = (release.tag_name || '').replace(/^v/, '');
    const currentVersion = app.getVersion();
    const hasUpdate      = _semverGt(latestVersion, currentVersion);
    const assetExt = process.platform === 'win32' ? '.exe'
                   : process.platform === 'darwin' ? '.dmg'
                   : '.AppImage';
    const asset = (release.assets || []).find(a => a.name.endsWith(assetExt));
    const result = {
      ok: true,
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseNotes: release.body || '',
      downloadUrl:  asset?.browser_download_url || null,
      assetName:    asset?.name || null,
    };
    _updateInfoCache    = result;
    _updateInfoCachedAt = Date.now();
    return result;
  } catch (e) {
    if (e.message === 'HTTP 404') {
      return { ok: true, hasUpdate: false, currentVersion: app.getVersion(), latestVersion: null };
    }
    return { ok: false, error: e.message };
  }
});

let _pendingUpdateExePath = null;
let _dfuSetupExePath      = null;

ipcMain.handle('app:downloadUpdate', async (_, { downloadUrl, assetName }) => {
  const os      = require('os');
  const exePath = path.join(os.tmpdir(), assetName);
  _pendingUpdateExePath = null;
  try {
    const file = fs.createWriteStream(exePath);
    let downloaded = 0;
    await new Promise((resolve, reject) => {
      _httpsGet(
        downloadUrl,
        { 'User-Agent': 'JMT-Studio' },
        (chunk, res) => {
          const total = parseInt(res.headers['content-length'] || '0', 10);
          downloaded += chunk.length;
          const pct = total ? Math.round((downloaded / total) * 100) : 0;
          if (win && !win.isDestroyed()) {
            win.webContents.send('app:updateProgress', { percent: pct, downloaded, total });
          }
          file.write(chunk);
        }
      ).then(() => file.end()).catch(reject);
      file.on('finish', resolve);
      file.on('error', reject);
    });
    _pendingUpdateExePath = exePath;
    return { ok: true };
  } catch (e) {
    try { fs.unlinkSync(exePath); } catch {}
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('app:installUpdate', async () => {
  if (!_pendingUpdateExePath || !fs.existsSync(_pendingUpdateExePath)) {
    return { ok: false, error: 'Installer not found.' };
  }
  const error = await shell.openPath(_pendingUpdateExePath);
  if (error) return { ok: false, error };
  setTimeout(() => app.quit(), 500);
  return { ok: true };
});
ipcMain.handle('toolchain:abort',     () => toolchain.abort());

// ── IPC: Port detection ────────────────────────────────
ipcMain.handle('ports:list', async () => {
  return await portDetect.listPorts();
});

ipcMain.handle('ports:listRaw', async () => {
  const { SerialPort } = require('serialport');
  const ports = await SerialPort.list();
  return ports.map(p => {
    // On Mac, serialport returns /dev/tty.* but arduino-cli uses /dev/cu.*
    // Normalize to cu.* so path comparisons succeed.
    let portPath = p.path;
    if (process.platform === 'darwin' && portPath.startsWith('/dev/tty.')) {
      portPath = '/dev/cu.' + portPath.slice('/dev/tty.'.length);
    }
    return { path: portPath };
  });
});

ipcMain.handle('ports:getRecommended', async () => {
  return await portDetect.getRecommendedPort();
});

// ── IPC: Favorites ─────────────────────────────────────
ipcMain.handle('favorites:get', () => {
  const favs = Store.get('favorites') || [];
  return favs.map(({ filePath }) => {
    if (!fs.existsSync(filePath)) return { filePath, exists: false, desc: null };
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const m = content.match(/^\/\/ @jmt:description\s+(.+)$/m);
      return { filePath, exists: true, desc: m ? m[1].trim() : null };
    } catch {
      return { filePath, exists: false, desc: null };
    }
  });
});

ipcMain.handle('favorites:add', (_, filePath) => {
  let favs = Store.get('favorites') || [];
  if (!favs.find(f => f.filePath === filePath)) {
    favs = [{ filePath }, ...favs];
    Store.set('favorites', favs);
  }
  return true;
});

ipcMain.handle('favorites:remove', (_, filePath) => {
  const favs = (Store.get('favorites') || []).filter(f => f.filePath !== filePath);
  Store.set('favorites', favs);
  return true;
});

ipcMain.handle('favorites:reorder', (_, orderedPaths) => {
  Store.set('favorites', orderedPaths.map(fp => ({ filePath: fp })));
  return true;
});

// ── IPC: ProffieOS versions ────────────────────────────
ipcMain.handle('proffieOS:listVersions', () => proffie.listVersions());

ipcMain.handle('proffieOS:getSelected', () => ({
  name: proffie.getSelectedVersion()
}));

ipcMain.handle('proffieOS:selectVersion', (_, name) => {
  proffie.setSelectedVersion(name);
  Store.set('lastVersion', name);
  return { ok: true, name };
});

ipcMain.handle('dialog:selectFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Select ProffieOS Folder',
    properties: ['openDirectory']
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});

ipcMain.handle('proffieOS:validateSource', (_, sourcePath) => {
  if (path.basename(sourcePath) !== 'ProffieOS') {
    return { ok: false, error: 'Folder must be named "ProffieOS".' };
  }
  if (!fs.existsSync(path.join(sourcePath, 'ProffieOS.ino'))) {
    return { ok: false, error: 'Folder does not contain ProffieOS.ino — not a valid ProffieOS source.' };
  }
  return { ok: true };
});

ipcMain.handle('proffieOS:importVersion', (_, { sourcePath, versionName, proffieVersion }) => {
  return proffie.importVersion(sourcePath, versionName, proffieVersion);
});

ipcMain.handle('versions:listDetails', () => proffie.listVersionsDetails());
ipcMain.handle('versions:readNotes',  (_, name) => proffie.readNotes(name));
ipcMain.handle('versions:writeNotes', (_, { name, content }) => proffie.writeNotes(name, content));
ipcMain.handle('versions:rename',     (_, { oldName, newName }) => proffie.renameVersion(oldName, newName));
ipcMain.handle('versions:duplicate',  (_, { name, newName }) => proffie.duplicateVersion(name, newName));
ipcMain.handle('versions:delete',     (_, name) => proffie.deleteVersion(name));
ipcMain.handle('versions:openFolder',  (_, name) => {
  const proffieSubdir = path.join(proffie.getUserVersionsPath(), name, 'ProffieOS');
  const target = fs.existsSync(proffieSubdir) ? proffieSubdir : path.join(proffie.getUserVersionsPath(), name);
  return shell.openPath(target);
});
ipcMain.handle('versions:listDir',    (_, { name, subPath }) => proffie.listVersionDir(name, subPath || ''));
ipcMain.handle('versions:readFile',   (_, { name, subPath }) => proffie.readVersionFile(name, subPath));
ipcMain.handle('versions:search',     (_, { name, query })   => proffie.searchVersionFiles(name, query));
ipcMain.handle('versions:export', async (_, name) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: `Export "${name}" to folder`,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Export Here',
  });
  if (canceled || !filePaths.length) return { ok: false, error: 'cancelled' };
  const destFolder = filePaths[0];
  const dest = path.join(destFolder, name);
  if (fs.existsSync(dest)) return { ok: false, error: `"${name}" already exists in the selected folder.` };
  const allVersions = proffie.listVersionsDetails();
  const versionInfo = allVersions.find(v => v.name === name);
  if (!versionInfo) return { ok: false, error: 'Version not found.' };
  function cpDir(s, d) {
    fs.mkdirSync(d, { recursive: true });
    fs.readdirSync(s, { withFileTypes: true }).forEach(e => {
      const sp = path.join(s, e.name), dp = path.join(d, e.name);
      e.isDirectory() ? cpDir(sp, dp) : fs.copyFileSync(sp, dp);
    });
  }
  try {
    cpDir(path.join(proffie.getUserVersionsPath(), name), dest);
    shell.showItemInFolder(dest);
    return { ok: true, dest };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: GitHub releases ───────────────────────────────
let _releasesCache    = null;
let _releasesCachedAt = 0;
const RELEASES_CACHE_TTL = 60 * 1000; // 1 minute

const _NETWORK_ERRORS = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENETUNREACH', 'EADDRNOTAVAIL']);

function _httpsGet(url, headers, onData, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 5) return reject(new Error('Too many redirects'));
    const https  = require('https');
    const parsed = new URL(url);
    const opts   = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers };

    const req = https.get(opts, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return _httpsGet(res.headers.location, headers, onData, redirectDepth + 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let buf = '';
      res.on('data', chunk => { buf += chunk; if (onData) onData(chunk, res); });
      res.on('end', () => resolve(buf));
      res.on('error', reject);
    });

    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timed out — check your internet connection.'));
    });

    req.on('error', err => {
      reject(_NETWORK_ERRORS.has(err.code)
        ? new Error('No internet connection.')
        : err);
    });
  });
}

ipcMain.handle('versions:fetchReleases', async () => {
  const now = Date.now();
  if (_releasesCache && (now - _releasesCachedAt < RELEASES_CACHE_TTL)) {
    return { ok: true, releases: _releasesCache };
  }
  try {
    const body = await _httpsGet(
      'https://api.github.com/repos/profezzorn/ProffieOS/releases?per_page=100',
      { 'User-Agent': 'JMT-Studio' }
    );
    const all = JSON.parse(body);
    const releases = all
      .filter(r => {
        const major = parseFloat((r.tag_name || '').replace(/^v/, ''));
        return major >= 6 && r.assets && r.assets.length > 0;
      })
      .map(r => ({
        tag:         r.tag_name,
        version:     r.tag_name.replace(/^v/, ''),
        name:        r.name || r.tag_name,
        published:   r.published_at,
        prerelease:  r.prerelease,
        downloadUrl: r.assets[0].browser_download_url,
      }));
    _releasesCache    = releases;
    _releasesCachedAt = Date.now();
    return { ok: true, releases };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function _findProffieOSFolder(dir) {
  const queue = [dir];
  while (queue.length) {
    const current = queue.shift();
    try {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(current, entry.name);
        if (entry.name === 'ProffieOS' && fs.existsSync(path.join(full, 'ProffieOS.ino'))) return full;
        queue.push(full);
      }
    } catch {}
  }
  return null;
}

ipcMain.handle('versions:downloadRelease', async (event, { downloadUrl, versionName, proffieVersion }) => {
  const os   = require('os');
  const { execFile } = require('child_process');
  const tmpDir     = path.join(os.tmpdir(), `jmt-proffie-${Date.now()}`);
  const zipPath    = path.join(tmpDir, 'release.zip');
  const extractDir = path.join(tmpDir, 'extracted');
  try {
    fs.mkdirSync(extractDir, { recursive: true });

    // Download with progress
    const file = fs.createWriteStream(zipPath);
    let downloaded = 0;
    await new Promise((resolve, reject) => {
      _httpsGet(
        downloadUrl,
        { 'User-Agent': 'JMT-Studio' },
        (chunk, res) => {
          const total = parseInt(res.headers['content-length'] || '0', 10);
          downloaded += chunk.length;
          const pct = total ? Math.round((downloaded / total) * 100) : 0;
          win.webContents.send('versions:downloadProgress', { phase: 'downloading', percent: pct });
          file.write(chunk);
        }
      ).then(() => file.end()).catch(reject);
      file.on('finish', resolve);
      file.on('error', reject);
    });

    // Extract
    win.webContents.send('versions:downloadProgress', { phase: 'extracting' });
    await new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        execFile('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`
        ], { timeout: 120000 }, err => err ? reject(err) : resolve());
      } else {
        execFile('unzip', ['-q', zipPath, '-d', extractDir], { timeout: 120000 }, err => err ? reject(err) : resolve());
      }
    });

    // Find ProffieOS folder inside the extracted tree
    const proffieFolder = _findProffieOSFolder(extractDir);
    if (!proffieFolder) throw new Error('Could not find ProffieOS folder in downloaded zip.');

    // Import
    win.webContents.send('versions:downloadProgress', { phase: 'importing' });
    return proffie.importVersion(proffieFolder, versionName, proffieVersion);
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

// ── IPC: JMT add-ons ──────────────────────────────────
const JMT_MANIFEST_URL = 'https://raw.githubusercontent.com/rtaylor2280/jmt-proffie-addons/main/manifest.json';
const JMT_RAW_BASE     = 'https://raw.githubusercontent.com/rtaylor2280/jmt-proffie-addons/main/';
let _jmtManifestCache    = null;
let _jmtManifestCachedAt = 0;

async function _getJmtManifest() {
  const now = Date.now();
  if (_jmtManifestCache && (now - _jmtManifestCachedAt < RELEASES_CACHE_TTL)) {
    return { ok: true, manifest: _jmtManifestCache };
  }
  try {
    const body = await _httpsGet(JMT_MANIFEST_URL + '?_=' + Date.now(), { 'User-Agent': 'JMT-Studio', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' });
    const manifest = JSON.parse(body);
    _jmtManifestCache    = manifest;
    _jmtManifestCachedAt = Date.now();
    return { ok: true, manifest };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('versions:fetchJmtManifest', () => _getJmtManifest());

ipcMain.handle('versions:checkJmtIntegrity', (_, { versionName, files }) => {
  const proffieRoot = path.join(proffie.getUserVersionsPath(), versionName, 'ProffieOS');
  const results = files.map(file => {
    const filePath = path.join(proffieRoot, file.path);
    if (!fs.existsSync(filePath)) return { path: file.path, status: 'missing' };
    try {
      const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
      const hash    = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
      return { path: file.path, status: hash === file.sha256 ? 'ok' : 'modified' };
    } catch { return { path: file.path, status: 'error' }; }
  });
  return { ok: true, results };
});

ipcMain.handle('versions:applyJmtFeatures', async (event, versionName) => {
  const manifestResult = await _getJmtManifest();
  if (!manifestResult.ok) return manifestResult;
  const { manifest } = manifestResult;

  const proffieRoot = path.join(proffie.getUserVersionsPath(), versionName, 'ProffieOS');
  if (!fs.existsSync(proffieRoot)) return { ok: false, error: 'ProffieOS folder not found.' };

  const total = manifest.files.length;
  let done = 0;
  try {
    for (const file of manifest.files) {
      win.webContents.send('versions:jmtProgress', { file: file.path, done, total });
      const content = await _httpsGet(JMT_RAW_BASE + file.path, { 'User-Agent': 'JMT-Studio' });
      const dest = path.join(proffieRoot, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, 'utf8');
      done++;
      win.webContents.send('versions:jmtProgress', { file: file.path, done, total });
    }
    proffie.writeVersionMeta(versionName, { jmtVersion: manifest.version });
    _jmtManifestCache = null;  // force fresh fetch on next check
    return { ok: true, jmtVersion: manifest.version };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: DFU ───────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_, url) => {
  shell.openExternal(url);
});

ipcMain.handle('dfu:detect', async () => {
  return await toolchain.detectDFU();
});

ipcMain.handle('dfu:downloadSetup', async () => {
  const os     = require('os');
  const crypto = require('crypto');
  const DFU_SETUP_URL  = 'https://fredrik.hubbe.net/lightsaber/proffie-dfu-setup.exe';
  const DFU_SETUP_HASH = '4773c8693cf62777cd8da4c95441690e7ae7c4171e8c1d533b1f6225f3bdc29e';
  const exePath = path.join(os.tmpdir(), 'proffie-dfu-setup.exe');
  const sendStatus = (msg) => {
    if (win && !win.isDestroyed()) win.webContents.send('dfu:setupStatus', msg);
  };
  try {
    sendStatus('Downloading proffie-dfu-setup.exe from fredrik.hubbe.net...');
    const file = fs.createWriteStream(exePath);
    await new Promise((resolve, reject) => {
      _httpsGet(DFU_SETUP_URL, { 'User-Agent': 'JMT-Studio' }, (chunk) => {
        file.write(chunk);
      }).then(() => file.end()).catch(reject);
      file.on('finish', resolve);
      file.on('error',  reject);
    });
    sendStatus('Verifying file integrity...');
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');
    if (actualHash !== DFU_SETUP_HASH) {
      _dfuSetupExePath = exePath;
      return { ok: false, hashMismatch: true, expected: DFU_SETUP_HASH, actual: actualHash };
    }
    _dfuSetupExePath = exePath;
    return { ok: true };
  } catch (e) {
    try { fs.unlinkSync(exePath); } catch {}
    _dfuSetupExePath = null;
    const noNet = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(e.message);
    return { ok: false, error: noNet ? 'No internet connection.' : `Download failed: ${e.message}` };
  }
});

ipcMain.handle('dfu:cleanupSetup', () => {
  if (_dfuSetupExePath) {
    try { fs.unlinkSync(_dfuSetupExePath); } catch {}
    _dfuSetupExePath = null;
  }
});

ipcMain.handle('dfu:installSetup', async () => {
  const { execFile } = require('child_process');
  const exePath = _dfuSetupExePath;
  if (!exePath) return { ok: false, error: 'No downloaded installer found. Try downloading again.' };
  const sendStatus = (msg) => {
    if (win && !win.isDestroyed()) win.webContents.send('dfu:setupStatus', msg);
  };
  sendStatus('Running proffie-dfu-setup.exe...');
  const safe = exePath.replace(/'/g, "''");
  const psCmd = `$p = Start-Process -FilePath '${safe}' -ArgumentList '/S' -Verb RunAs -PassThru; if ($p) { $p.WaitForExit(); exit $p.ExitCode } else { exit 1 }`;
  return new Promise(resolve => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd],
      { timeout: 120000 }, (error) => {
        if (error) {
          resolve({ ok: false, error: 'Installation was cancelled. Accept the Windows security prompt to install.' });
        } else {
          try { fs.unlinkSync(exePath); } catch {}
          _dfuSetupExePath = null;
          resolve({ ok: true });
        }
      });
  });
});

ipcMain.handle('dfu:flash', async () => {
  const log = makeLogger();

  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', { type: 'flash', ok: null, message: 'Flashing via DFU...' });
  }

  const result = await toolchain.flashDFU(log);

  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', {
      type: 'flash',
      ok: result.ok,
      message: result.ok ? 'DFU flash successful' : result.error
    });
    win.webContents.send('build:done', { type: 'flash', ...result });
  }

  return result;
});
