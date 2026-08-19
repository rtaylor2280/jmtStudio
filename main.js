const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path        = require('path');
const fs          = require('fs');
const crypto      = require('crypto');
const toolchain   = require('./toolchain');
const portDetect  = require('./portDetector');
const proffie     = require('./proffieos');
const cacheManager = require('./cacheManager');
const coreVersions = require('./coreVersions');
const soundFontSources = require('./soundFontSources');
const soundFontVendors = require('./soundFontVendors');
const soundFontCandidates = require('./soundFontCandidates');
const soundFontEntries = require('./soundFontEntries');
const soundFontCommon = require('./soundFontCommon');
const soundFontBackup = require('./soundFontBackup');
const soundFontBulkImport = require('./soundFontBulkImport');
const soundFontFileOps = require('./soundFontFileOps');
const soundFontReorganize = require('./soundFontReorganize');
const soundFontVoicepack = require('./soundFontVoicepack');
const sdCardDetect = require('./sdCardDetect');
const soundFontSharedTracks = require('./soundFontSharedTracks');
const soundFontAttachments = require('./soundFontAttachments');
const soundFontLinkImport = require('./soundFontLinkImport');

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
let _splashDismissed = false; // tracked so the renderer can defer
                              // build-panel-open until splash is gone

function showSplash(parentWin) {
  // Center on the primary display's work area, NOT on parentWin.getBounds().
  // On Linux/X11+Wayland, maximize() is async — parent bounds reflect the
  // pre-maximize size when showSplash runs immediately after maximize, which
  // (combined with the `height: 1` constructor trick anchoring the window mid-
  // screen) pushes the splash off the bottom edge of the display.
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const cx = display.workArea.x + display.workArea.width  / 2;
  const cy = display.workArea.y + display.workArea.height / 2;

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

  // Single point of truth for "splash is done." Idempotent so any code path
  // that ends the splash sequence can call it safely.
  const markDismissed = () => {
    if (_splashDismissed) return;
    _splashDismissed = true;
    if (parentWin && !parentWin.isDestroyed()) {
      parentWin.webContents.send('app:splash-dismissed');
    }
  };

  setTimeout(() => {
    if (splash.isDestroyed()) { markDismissed(); return; }
    // Fade out using native window opacity — 400ms over ~24 steps
    const duration = 400;
    const interval = 16;
    const steps = duration / interval;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      if (splash.isDestroyed()) { clearInterval(timer); markDismissed(); return; }
      splash.setOpacity(1 - step / steps);
      if (step >= steps) {
        clearInterval(timer);
        if (!splash.isDestroyed()) splash.destroy();
        markDismissed();
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
    minHeight: 692,
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
    // First-run: maximize. The app's UI (config editor, style library, preset
    // sidecar, build output) breathes better at full size, and a first-time
    // user shouldn't have to manually expand to see everything. Returning
    // users land at their saved bounds / maximized state instead.
    // (Without this, the constructor's `height: 1` trick would leave the
    // window positioned for a 1px-tall window — bottom hangs off-screen.)
    if (bounds.x == null) win.maximize();
    else if (wasMax) win.maximize();
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

  win.on('blur',  () => stopPortPolling());
  win.on('focus', () => { if (_portPollingWanted) { startPortPolling(); _pollPortsNow(); } });

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

  // Upgrade backfill, once ever. Everything installed before 1.8 was built with
  // the hardcoded core, so pin those trees to it rather than leaving them on
  // follow-latest. Otherwise the day a newer core is published every existing
  // user silently changes compiler, loses their whole build cache, downloads a
  // new toolchain and may find a config that used to fit no longer links.
  //
  // Guarded by a flag rather than by "is the field missing", so a user who
  // deliberately clears a version back to follow-latest is not re-pinned on the
  // next launch. Synchronous and local: no network, so it cannot delay startup.
  if (!Store.get('coreBackfillDone')) {
    try {
      const res = proffie.backfillVersionCores(coreVersions.PRE_1_8_CORE_VERSION);
      if (res.ok) {
        Store.set('coreBackfillDone', true);
        if (res.stamped.length) {
          console.log(`[core] pinned ${res.stamped.length} existing version(s) to core ${res.coreVersion}`);
        }
      }
    } catch (e) {
      // Leaving the flag unset means it retries next launch, which is the safe
      // direction: an un-run backfill is recoverable, a half-recorded one is not.
      console.warn('[core] backfill failed, will retry next launch:', e.message);
    }
  }

  // Point the toolchain at this version's core before the window opens. Not
  // awaited: it can touch the network, and a slow or unreachable index must
  // never delay the app appearing. Until it lands the toolchain holds its
  // default, and every consumer of the value runs later than this anyway.
  if (initVersion) _applyCoreForVersion(initVersion);

  createWindow();
  startPortPolling();
  scheduleOrphanCacheSweep();
});

// Drop buildPkg directories whose ProffieOS hash no longer belongs to any installed version.
// Deliberately NOT in the pre-window block above: it has to hash every installed OS tree, measured
// at ~4.5s cold for eight versions on a dev profile, and that is not a cost to put in front of the
// window appearing. Deferred until after first paint, and the hashing is not wasted — it warms the
// same per-version cache that every later compile-cache check reads.
//
// Self-healing by design: it runs every launch, so a version deleted today is reclaimed tomorrow
// with no user action and nothing to remember.
//
// TRIGGERED BY TOOLCHAIN RESOLUTION, NOT BY A CLOCK. (2026-08-15)
//
// It used to fire on a bare 5-second timer, chosen to clear first paint. But a
// plugin removed by another Arduino tool is re-downloaded during startup, and
// several hundred megabytes is nowhere near done at t+5s - so the sweep ran
// against a machine mid-repair, seeing an installed set that was briefly
// missing a plugin whose builds it was deciding about.
//
// Nothing was lost, because protection is by PIN and the pin outlives the
// files. But the sweep should not depend on that being airtight; it should see
// the settled machine. Now it waits for `toolchain:initialize` to finish -
// success or failure - so `listAvailableCores()` reports what is really there.
//
// Runs once per launch. The timer survives only as a backstop for a launch
// where initialize is never invoked at all, and it is deliberately long: firing
// early would restore the exact condition this removed.
let _orphanSweepRan = false;
// Plugins this app has installed or adopted, and therefore expects to find.
//
// PERSISTS INTENT, NEVER PRESENCE. Nothing reads this to decide whether a plugin
// is on disk - that is always a live check, because another Arduino tool can
// change the tree between builds, and trusting a remembered answer is exactly
// the 1.7.2 defect. It answers only "should this be here", which no amount of
// looking at the disk can tell you once both the files and the pin are gone.
// (2026-08-15)
const PLUGIN_RECORD_KEY = 'installedPlugins';

function _recordedPlugins() {
  const rec = Store.get(PLUGIN_RECORD_KEY);
  return (rec && typeof rec === 'object') ? rec : {};
}
function _recordPlugin(version, source) {
  const v   = coreVersions.normalizeVersion(version);
  const rec = _recordedPlugins();
  // firstSeen is not refreshed on later installs: it records when this machine
  // first expected the plugin, which is the useful fact, not the last time we
  // happened to confirm it.
  if (!rec[v]) rec[v] = { source, firstSeen: new Date().toISOString() };
  else rec[v].source = source;
  Store.set(PLUGIN_RECORD_KEY, rec);
}
function _forgetPlugin(version) {
  const v   = coreVersions.normalizeVersion(version);
  const rec = _recordedPlugins();
  if (!(v in rec)) return;
  delete rec[v];
  Store.set(PLUGIN_RECORD_KEY, rec);
}
// A plugin install that was in flight when the app went away.
//
// The marker goes up before the install and comes down only after the on-disk
// verify, never on an exit code alone. So a marker still standing at startup
// means the process did not finish - killed, crashed, or the machine went off.
// A failed install leaves it standing too, deliberately: a tree that failed
// halfway is exactly as indeterminate as one that was interrupted, and cleaning
// it costs nothing but a re-download of scaffolding.
//
// Recovery is identical to a cancel: remove the versioned tree, which is a
// container we created for one plugin and which has no other contents worth
// keeping. (2026-08-15)
const PENDING_INSTALL_KEY = 'pendingPluginInstall';

async function _recoverInterruptedInstall() {
  const pending = Store.get(PENDING_INSTALL_KEY);
  if (!pending) return;
  Store.delete(PENDING_INSTALL_KEY);
  try {
    const res = await toolchain.cancelCoreInstall(pending);
    if (res && res.removed) {
      console.log(`[core] cleaned a partial ${pending} install left by a previous session`);
    }
  } catch (e) {
    console.warn('[core] could not clean a partial install:', e.message);
  }
}

toolchain.setPluginHooks({
  record: _recordPlugin,
  forget: _forgetPlugin,
  begin:  (v) => Store.set(PENDING_INSTALL_KEY, coreVersions.normalizeVersion(v)),
  end:    ()  => Store.delete(PENDING_INSTALL_KEY),
});

// Runs before anything reads the trees, because a partial install would lie
// about what is present - and the backfill just below is one of the readers.
_recoverInterruptedInstall();

// One-time backfill. The record starts empty, so every plugin already on this
// machine was invisible to it - and a plugin installed before the record existed
// could never be recognised as dormant, which is the exact case it was built
// for. Anything present at first run was put there deliberately, by this app or
// by Arduino IDE, so recording it is a statement of fact rather than a guess.
//
// Guarded by its own flag rather than by "is the record empty", so a user who
// deliberately clears it is not silently refilled on the next launch.
// (2026-08-15)
if (!Store.get('pluginRecordBackfilled')) {
  try {
    for (const c of toolchain.listAvailableCores()) _recordPlugin(c.version, c.source);
    Store.set('pluginRecordBackfilled', true);
  } catch (e) {
    console.warn('[core] plugin record backfill failed, will retry next launch:', e.message);
  }
}

/**
 * Plugins we expect but cannot find. The DORMANT set.
 *
 * Anything here has cached builds worth keeping and is worth fetching again
 * when there is a connection - it is a machine that has drifted from the state
 * the app put it in, not a decision the user made.
 */
function _dormantPlugins() {
  const present = new Set(
    toolchain.listAvailableCores().map(c => coreVersions.normalizeVersion(c.version))
  );
  return Object.keys(_recordedPlugins()).filter(v => !present.has(v));
}

function runOrphanCacheSweep() {
  if (_orphanSweepRan) return;
  _orphanSweepRan = true;
  {
    try {
      const validOsHashes = new Set();
      let failed = false;
      for (const v of proffie.listVersions()) {
        try { validOsHashes.add(proffie.hashVersion(v)); }
        catch { failed = true; }   // could not hash one -> its entries would look orphaned
      }
      // Abort on ANY failure rather than sweeping against a partial set. A version we failed to
      // hash is a version whose live cache entries we would delete. Better to keep dead bytes for
      // one launch than to throw away a 38-minute build.
      if (failed) {
        // Say so. Without this line an aborted sweep and a sweep with nothing to do look identical
        // in the log, and a sweep that aborts every launch would silently never reclaim anything.
        console.log('[cache] orphan sweep skipped: an installed OS version could not be hashed');
        return;
      }

      // Two independent kinds of dead weight. Orphaned PACKAGES are whole directories whose OS
      // version is gone. Stale ENTRIES sit inside perfectly live packages and went dead when the
      // config hash algorithm changed — the sweep above cannot see those, and nothing else
      // reclaims them.
      // PROTECTED cores, which is wider than installed and deliberately so.
      //
      // arduino-cli keeps one platform version per data directory, so "installed" flips every time
      // someone switches. Keyed on that alone this sweep would delete every 4.6 build the moment a
      // user tried 3.6 — the exact opposite of what a cache is for.
      //
      // Protected = available anywhere (their system tree or ours) OR still named by an installed
      // ProffieOS version. The second half is what saves the user whose system core was upgraded by
      // another program while a version still points at the old one: the intent outlived the files,
      // so the builds are kept and they get offered the download instead.
      // Built by coreVersions.protectedCoreSet so the rule has one definition and
      // a test. It was assembled inline here, which left the guard between an
      // interrupted download and a 38-minute build as the only untested part of
      // this path. (2026-08-15)
      const protectedCores = coreVersions.protectedCoreSet({
        available: toolchain.listAvailableCores().map(c => c.version),
        pinned:    proffie.listVersions().map(n => proffie.getVersionCore(n)),
        // Recorded intent. Without this term, a plugin removed outside the app
        // AND a pin moved away leaves its builds looking abandoned when they are
        // only dormant - and moving the pin is exactly what an offline user does
        // to keep working.
        expected:  Object.keys(_recordedPlugins()),
        active:    toolchain.getActiveCoreVersion(),
      });

      const pkgs    = cacheManager.evictOrphanedBuildPkgs(validOsHashes, protectedCores);
      const entries = cacheManager.evictStaleHashEntries();
      const mb = b => (b / 1048576).toFixed(0);
      if (pkgs.removed.length) {
        // Reports BUILDS, the unit shown in Settings. "Packages" is this file's
        // internal grouping and reconciles with nothing the user can see.
        const n = pkgs.builds || pkgs.removed.length;
        // NOT "no longer on this computer" - that is the wrong criterion and it
        // contradicts the protection this app now provides.
        //
        // A dormant plugin is also absent, and its builds are deliberately KEPT,
        // because something still expects it. What makes a build reclaimable is
        // that NOTHING REQUESTS IT: no installed ProffieOS version names it, it
        // is in no tree, and it is in no record. Absence is not the test; being
        // unwanted is. Writing it as absence would describe the dormant case too
        // and be false about it.
        //
        // Leads with "no longer needed" for the same reason the order was
        // changed before: the reader's first question is whether anything of
        // value went, and the answer is that nothing could ever have used these
        // again. Cause second, size last. (2026-08-15)
        const line = `${n} cached build${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} no longer ` +
                     `needed - nothing requests the ProffieOS version or Proffieboard Plugin ` +
                     `${n === 1 ? 'it was' : 'they were'} built for. Removed, freeing ` +
                     `${mb(pkgs.bytes)} MB.`;
        console.log(`[cache] ${line}`);
        // Also where the user can find it. Cached builds disappearing with no
        // explanation anywhere they would look is the same reason-for-a-change
        // gap as the rest of today; until now this only existed in a terminal
        // nobody but a developer has open.
        //
        // Written straight to the log rather than through the setup signal, so
        // it does NOT open the panel: nothing is happening that needs watching
        // and the work is already finished. It waits there for anyone who opens
        // the log, which is the whole difference between a record and an
        // interruption. Silent when nothing was reclaimed, which is nearly
        // always. (2026-08-15)
        if (win && !win.isDestroyed()) {
          win.webContents.send('build:log', { line, isError: false });
        }
      }
      if (pkgs.skipped) console.log(`[cache] orphan sweep skipped: ${pkgs.skipped}`);
      // Distinguished from "nothing to reclaim" so a core-enumeration failure that quietly disables
      // half the sweep on every launch is visible rather than silent.
      if (pkgs.coreCheckSkipped) {
        console.log('[cache] orphan sweep ran on OS version only: no installed cores could be enumerated');
      }
      if (!pkgs.removed.length && !pkgs.skipped && !entries.removed) {
        console.log('[cache] sweep found nothing to reclaim');
      }
      if (entries.removed) {
        console.log(`[cache] removed ${entries.removed} entr(ies) keyed by a superseded config hash, ${mb(entries.bytes)} MB`);
      }
    } catch {}
  }
}

// Fetch back plugins the machine has drifted away from.
//
// Runs after the toolchain has settled, so the plugin the user actually needs is
// already handled and this only ever deals with the rest. Nothing is blocked on
// it: these are plugins no ProffieOS version is currently pointing at, so the
// user is not waiting, and if it fails they are no worse off than before.
//
// Deliberately NOT silent. It is a real download and it says so in the log,
// because a several-hundred-megabyte fetch nobody asked for should be visible
// even when it is the right thing to do. Restoring what the app installed is
// repair, not a new decision - but repair still gets announced.
//
// Once per launch, sequential, and never retried after a failure in the same
// session: offline is the common reason, and hammering it helps nobody.
// (2026-08-15)
let _healRan = false;
async function healDormantPlugins() {
  if (_healRan) return;
  _healRan = true;

  const dormant = _dormantPlugins();
  if (!dormant.length) return;

  const log = makeLogger();
  for (const version of dormant) {
    // The user may have started their own install in the meantime; theirs wins.
    if (toolchain.getActiveCoreVersion() === version) continue;
    // A header, not a sentence. What follows is several hundred megabytes of
    // arduino-cli output that started without the user asking for anything, and
    // one line at the top of it scrolls away before the download even begins.
    //
    // Same shape as the compile identity block: what this is, what it is about,
    // and why it is happening - stated before any work, so the log is
    // self-describing when it is read later or pasted into a support thread.
    // (2026-08-15)
    log('', false);
    log('--- Restoring a missing Proffieboard Plugin ---', false);
    log(`Plugin:  ${version}`, false);
    // States the two things that are KNOWN: it is expected, and it is absent.
    //
    // An earlier version said it "was installed by JMT Studio and has been
    // removed since", which asserts an agent and an event we have no evidence
    // for. Today the cause is someone clearing disk space by hand; tomorrow it
    // is a restore from a backup that did not include it, or something nobody
    // has thought of. The cause does not change what happens next and we cannot
    // know it, so we do not claim it. (2026-08-15)
    log('Reason:  JMT Studio expects this plugin and it is not on this computer', false);
    log('Nothing is waiting on this. Compiling and flashing stay available.', false);
    // Tell the renderer. A background heal was invisible to it, so the plugin
    // dropdown would cheerfully start a SECOND install of the plugin already
    // arriving. Deliberately NOT the toolchain-setup signal: this must not block
    // Compile, because the plugin being fetched is one nothing is pinned to and
    // the user's own build is unaffected. (2026-08-15)
    const announce = (running) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('build:status', { type: 'plugin-heal', coreVersion: version, running });
      }
    };
    announce(true);
    try {
      // activate:false - fetch it without making it the session's plugin. The
      // heal serves a version nobody selected, so hijacking the active core (and
      // the isolation flag with it) is how a background repair reached into a
      // tree it had no business in.
      const res = await toolchain.ensureCore(_installPhaseLogger(log), version, { activate: false });
      if (res && res.ok) log(`--- Proffieboard Plugin ${version} restored ---`, false);
      else {
        log(`Could not restore Proffieboard Plugin ${version} right now. ` +
            `Its saved builds are kept and it will be tried again next launch.`, false);
        break;   // almost certainly offline; the rest will fail the same way
      }
    } catch { break; }
    finally { announce(false); _clearInstallPhase(); }
  }
  // No pin restore needed any more: activate:false means the session's active
  // core was never moved. Restoring it afterwards was patching a side effect
  // that should not have existed.
}

// Backstop only. If the renderer never asks the toolchain to initialize - a
// window that fails to load, a future path that skips it - the sweep would
// otherwise never run at all. Three minutes is long enough that a real startup,
// including a plugin download, has finished first; the point is that it fires
// eventually, not promptly. Missing one launch costs nothing, since the sweep
// is self-healing and runs again next time.
function scheduleOrphanCacheSweep() {
  setTimeout(runOrphanCacheSweep, 180000);
}
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
      { name: 'Proffie Config', extensions: ['h', 'hpp', 'txt'] },
      { name: 'All Files',      extensions: ['*'] }
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
  // Same phase reporting as a panel-initiated install: this path runs the exact
  // same ensureCore, so it should look the same while it does. (2026-08-15)
  const log = _installPhaseLogger(makeLogger());

  // The version being fetched travels with the signal so the notice can name it.
  // Without that the banner has to speak in generalities, and generalities are
  // what let it claim to be first-time setup. (2026-08-15)
  if (toolchain.needsCoreInstall() && win && !win.isDestroyed()) {
    win.webContents.send('build:status', {
      type: 'toolchain-setup',
      ok: null,
      coreVersion: toolchain.getActiveCoreVersion(),
      message: 'Setting up the Proffieboard Plugin...'
    });
  }

  const result = await toolchain.initialize(log);
  if (win && !win.isDestroyed()) {
    // When the toolchain itself is ready but no ProffieOS version is present,
    // we surface that as an error-state next-action message in the same status
    // slot rather than a misleading green "Toolchain ready" while compile is
    // still gated. The renderer reads needsProffieOS to pick the right state.
    const msg = !result.ok            ? result.error
              // Kept short because the renderer puts a "Get ProffieOS" button
              // beside it; repeating the instruction in words would be noise.
              : result.needsProffieOS ? 'No ProffieOS installed.'
                                      : 'Toolchain ready';
    win.webContents.send('build:status', {
      type: 'toolchain',
      ok: result.ok,
      needsProffieOS: !!result.needsProffieOS,
      message: msg
    });
  }

  // The machine has settled: any plugin this startup needed has been installed
  // or has definitively failed. Only now can the sweep read a true picture of
  // what is on disk. Called on failure too - a toolchain that could not resolve
  // does not make the cache rules wrong, and skipping it would mean an offline
  // launch never reclaims anything. Guarded to run once per launch, so the
  // repeat calls from every version switch are free. (2026-08-15)
  _clearInstallPhase();
  runOrphanCacheSweep();
  // Re-enabled 2026-08-15 once installs stopped inferring their destination.
  // The failure was never the heal itself: ensureCore resolved WHERE to install
  // from a session-wide flag, so any caller asking about a plugin other than the
  // one in play could send it into the user's own Arduino15. Fixed at the source
  // - the tree is a parameter now - and the heal additionally runs with
  // activate:false, so it cannot touch session state at all.
  // PREVIOUS NOTE, kept because it is the reason this exists:
  //
  // It called ensureCore for a plugin nobody had selected, and ensureCore decides
  // WHERE to install from `_useIsolatedCore` - a session-wide flag describing the
  // plugin in play, not the one being fetched. Asked for a plugin out of band,
  // that flag was stale, and arduino-cli installed into the USER'S OWN Arduino15,
  // replacing their 4.6 with 3.6 and uninstalling the 4.6 compiler.
  //
  // Do not re-enable until ensureCore names its target tree explicitly, the way
  // uninstallCore already does. That function's comment says exactly this and
  // dates from 2026-08-12: a destructive command must never ask "are we isolated
  // right now", it must name the tree it means. The lesson was learned for
  // uninstall and never carried across to install.
  healDormantPlugins();

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

// Dynamic-speed research bench: compile the given config across a list of
// optimization levels, cache-bypassed, returning a timing/fit record per level.
// Dev/test instrumentation — driven from the DevTools console via jmtBench().
ipcMain.handle('toolchain:benchCompile', async (_, { configContent, fqbn, buildOptions, optList }) => {
  const log = makeLogger();
  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', { type: 'compile', ok: null, message: 'Benchmarking compile...' });
  }
  const result = await toolchain.benchCompile(configContent, fqbn, buildOptions, optList, log);
  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', { type: 'compile', ok: true, message: 'Bench complete' });
  }
  return result;
});

ipcMain.handle('toolchain:flash', async (_, { port, fqbn, expectedSN }) => {
  const log = makeLogger();
  await _abortVersionProbe?.();  // never let a version probe hold the port a flash needs

  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', { type: 'flash', ok: null, message: `Flashing on ${port}...` });
  }

  // expectedSN pins the flash to the board the user picked. Without it dfu-util targets
  // whichever board is in the bootloader, which is how a flash aimed at one board landed
  // on another (2026-07-26).
  const result = await toolchain.flash(port, fqbn, log, expectedSN);

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
ipcMain.handle('cache:check', (_, { configContent, fqbn, usb, configId }) =>
  toolchain.checkCacheAndRestore(configContent, fqbn, usb, configId));

// ── Config template (user-editable in a future release) ──────────────────────
// Read the default-config template from `userData/templates/default.h`. Create it on first
// request with the V3 scaffold below if it doesn't exist yet, then return the file contents.
// Future: a Settings UI will let the user edit the same file, and this handler picks up
// whatever the file currently contains — no further code change required.
const DEFAULT_CONFIG_TEMPLATE = [
  '#ifdef CONFIG_TOP',
  '#include "proffieboard_v3_config.h"',
  '#define NUM_BLADES 1                           \t// Number of blade definitions in CONFIG_PRESETS',
  '#define NUM_BUTTONS 2                          \t// Number of physical buttons',
  '#define VOLUME 1500                            \t// Master volume (0–2047)',
  'const unsigned int maxLedsPerStrip = 144;      \t// Max LEDs per strip (important for memory allocation)',
  '#define CLASH_THRESHOLD_G 2.0                  \t// Clash sensitivity (lower = more sensitive)',
  '#define ENABLE_AUDIO                           \t// Enables audio playback',
  '#define ENABLE_MOTION                          \t// Enables motion sensing (gyro/accel)',
  '#define ENABLE_WS2811                          \t// Enables NeoPixel (WS2811) LED output',
  '#define ENABLE_SD                              \t// Enables SD card support for sound fonts',
  '#define MOTION_TIMEOUT (60 * 6 * 1000)        \t// Time (ms) to shut down after inactivity (6 minutes)',
  '#define IDLE_OFF_TIME (60 * 7 * 1000)         \t// Time (ms) to power down completely after idle (7 minutes)',
  '',
  '#endif',
  '',
  '#ifdef CONFIG_PROP',
  '#include "../props/saber_fett263_buttons.h"',
  '#endif',
  '',
  '#ifdef CONFIG_PRESETS',
  '',
  'Preset presets[] = {',
  '',
  '{ "", "",',
  '  StylePtr<Black>(),',
  '',
  '  "Preset 1" },',
  '',
  '};',
  '',
  'BladeConfig blades[] = {',
  '',
  '{ 0, ',
  'WS281XBladePtr<128, bladePin, Color8::GRB, PowerPINS<bladePowerPin2, bladePowerPin3>>(),',
  'CONFIGARRAY(presets)',
  '},',
  '',
  '};',
  '#endif',
  '',
  '#ifdef CONFIG_BUTTONS',
  'Button PowerButton(BUTTON_POWER, powerButtonPin, "pow");',
  'Button AuxButton(BUTTON_AUX, auxPin, "aux");',
  '#endif',
  '',
].join('\n');

ipcMain.handle('template:readDefault', () => {
  try {
    const dir  = path.join(app.getPath('userData'), 'templates');
    const file = path.join(dir, 'default.h');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, DEFAULT_CONFIG_TEMPLATE, 'utf8');
    }
    const content = fs.readFileSync(file, 'utf8');
    return { ok: true, content, path: file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Overwrite the template file with the shipped default. Used by the Settings → Reset
// Default Template action and by users who want to revert custom edits.
ipcMain.handle('template:resetDefault', () => {
  try {
    const dir  = path.join(app.getPath('userData'), 'templates');
    const file = path.join(dir, 'default.h');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, DEFAULT_CONFIG_TEMPLATE, 'utf8');
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Report status of the template file. `isDefault` is true when the current file's content
// matches DEFAULT_CONFIG_TEMPLATE byte-for-byte — used by the Settings UI to disable
// "Reset to Default" when there's nothing to reset.
ipcMain.handle('template:getStatus', () => {
  try {
    const dir  = path.join(app.getPath('userData'), 'templates');
    const file = path.join(dir, 'default.h');
    if (!fs.existsSync(file)) {
      return { ok: true, exists: false, isDefault: true, path: file };
    }
    const content = fs.readFileSync(file, 'utf8');
    return { ok: true, exists: true, isDefault: content === DEFAULT_CONFIG_TEMPLATE, path: file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Open a file picker and replace the template file with the selected `.h` file's content.
ipcMain.handle('template:import', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: 'Import Default Template',
      filters: [{ name: 'Header Files', extensions: ['h'] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) {
      return { ok: false, cancelled: true };
    }
    const sourcePath = res.filePaths[0];
    const raw        = fs.readFileSync(sourcePath, 'utf8');
    // Strip JMT metadata — templates should be neutral starting points, not carry
    // the imported config's identity (config_id, name, dates, board pin, etc.).
    // Mirrors the renderer's stripJmtLines helper; kept inline here so the main
    // process doesn't need to require the renderer module.
    const content    = raw
      .replace(/^\/\/ Configuration edited with JMT Studio[^\n]*\n?/m, '')
      .replace(/^\/\/ @jmt:\S+[^\n]*\n?/gm, '')
      .replace(/^\n+/, '');                // trim leading blank lines left by the strip
    const dir        = path.join(app.getPath('userData'), 'templates');
    const file       = path.join(dir, 'default.h');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return { ok: true, path: file, sourcePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

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

// Two separate destructive actions, because they destroy different things and only one of them
// costs the user real work.
//
//   build-cache  — finished builds, one per config. Deleting forces a full recompile of each.
//   build-output — arduino-cli's --build-path: core.a plus library objects, AND whatever build is
//                  currently staged for Flash. Deleting loses no saved work; the next compile
//                  rebuilds the core and the next cache hit repopulates the staged build.
//
// They used to be one button called "Clear Compile Cache", which meant anyone reclaiming disk also
// threw away the compiler's intermediates, and the label reported a leftover build tree as though
// it were cached work — it once read 48.0 MB when the number of cached builds was zero.
function _dirSize(p) {
  if (!fs.existsSync(p)) return 0;
  return fs.readdirSync(p, { withFileTypes: true }).reduce((sum, e) => {
    const full = path.join(p, e.name);
    return sum + (e.isDirectory() ? _dirSize(full) : fs.statSync(full).size);
  }, 0);
}

ipcMain.handle('cache:clearBuilds', async () => {
  const cacheRoot = path.join(app.getPath('userData'), 'build-cache');
  const bytes = _dirSize(cacheRoot);
  try {
    if (fs.existsSync(cacheRoot)) await fs.promises.rm(cacheRoot, { recursive: true, force: true });
    return { ok: true, bytesCleared: bytes };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cache:resetWorkspace', async () => {
  const buildOutput = path.join(app.getPath('userData'), 'build-output');
  const bytes = _dirSize(buildOutput);
  try {
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
  // "cache" must match what cache:clear actually deletes — that handler nukes
  // both build-cache (keyed artifacts) AND build-output (last compile's tree).
  // Previously this only summed build-cache, so users saw "10.3 MB" before
  // clicking Clear and "38.2 MB freed" afterward, a 3-4× discrepancy that
  // erodes trust in the displayed numbers.
  // Break the total into its two halves. They are NOT the same kind of thing and lumping them
  // together misleads: right after a cache sweep the label read "48.0 MB" while cached builds were
  // literally zero — every byte was build-output, the build currently staged for flashing. A user
  // reads that as "48 MB of saved builds to reclaim" and is wrong about the only part that costs
  // them anything.
  const cacheRoot   = path.join(userData, 'build-cache');
  const outputRoot  = path.join(userData, 'build-output');

  // Count real cached builds and find the most expensive one, so the confirm dialog can state what
  // clearing actually costs instead of quoting an invented duration.
  let cachedBuilds = 0, longestCompileMs = null;
  (function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const pkg of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      for (const e of fs.readdirSync(path.join(dir, pkg.name), { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const mp = path.join(dir, pkg.name, e.name, 'metadata.json');
        if (!fs.existsSync(mp)) continue;
        cachedBuilds++;
        try {
          const d = JSON.parse(fs.readFileSync(mp, 'utf8')).compileDurationMs;
          if (typeof d === 'number' && (longestCompileMs === null || d > longestCompileMs)) longestCompileMs = d;
        } catch {}
      }
    }
  })(cacheRoot);

  const cachedBytes = dirSize(cacheRoot);
  const outputBytes = dirSize(outputRoot);

  // This used to also walk `arduino-data` and the ProffieOS versions tree and return both
  // sizes. Nothing ever read them. On a machine holding three cores that is 13,495 files and
  // ~1.9 GB measured synchronously on the main process every time Settings opens — about 1.4
  // seconds of blocked UI to produce two numbers no surface displays. Anything that needs the
  // core trees sized should ask `space:survey`, which itemises them for a reason. (2026-08-14)
  return {
    // Unchanged: must still equal what cache:clear deletes, or the old bug returns where the label
    // says 10.3 MB and 38.2 MB disappears.
    cache:       cachedBytes + outputBytes,
    cachedBytes,
    outputBytes,
    cachedBuilds,
    longestCompileMs,
  };
});

// ── Reset Build Space ──────────────────────────────────
//
// One action that shrinks the arduino-cli footprint as far as it safely can. A
// RESET, not a delete: it never goes below what is in use, so it can always
// still build afterwards.
//
// The parts have genuinely different costs to undo, which is why the modal
// itemises rather than quoting one number. Working files cost a slower next
// compile. Unpacked installers cost nothing at all. Build tools cost a download
// that may be metered or unavailable, and that is the one worth naming out loud.

// Every core any installed ProffieOS version points at. Stricter than "installed"
// on purpose: the automatic cache sweep only reclaims builds whose tools are
// GONE, while this decides which tools may be removed at all, and removing one a
// version still names would strand that version.
async function _referencedCores() {
  const refs = new Set();
  for (const name of proffie.listVersions()) {
    try {
      const eff = await _effectiveCoreFor(name);
      if (eff && eff.version) refs.add(coreVersions.normalizeVersion(eff.version));
    } catch { /* skip */ }
  }
  // The core in play right now, even if version enumeration missed it.
  refs.add(coreVersions.normalizeVersion(toolchain.getActiveCoreVersion()));
  return refs;
}

async function _surveyBuildSpace() {
  const userData  = app.getPath('userData');
  const dataPath  = toolchain.getArduinoDataPath();
  const idx  = await coreVersions.resolveLatest(userData);
  const keep = await _referencedCores();

  // Only cores WE downloaded are removable. A core in the user's own Arduino
  // tree is theirs: we may build against it, but reclaiming it would be reaching
  // into software we do not own, and the whole isolation design exists so we
  // never do that.
  const ours = toolchain.listAvailableCores()
    .filter(c => c.source === 'jmt')
    .map(c => c.version);

  const removableCores = ours.filter(v => !keep.has(coreVersions.normalizeVersion(v)));

  // Sized in the tree each core actually occupies. Reading one path measured
  // whichever tree the active core happened to resolve to, so two installed and
  // unused cores were reported as nothing to reclaim at all. (2026-08-12)
  // Needed by the removable-core loop below as well as the orphan-tree scan further down.
  const legacyPath = toolchain.getLegacyCoreTreePath();

  let toolBytes = 0;
  const treeFor = new Map(toolchain.listCoreTrees()
    .map(t => [coreVersions.normalizeVersion(t.version), t.path]));
  // Every tool directory already accounted for, so the stray sweep below cannot count one twice.
  const countedToolPaths = new Set();
  // Every TREE already counted whole. Anything living inside one of these has
  // been counted with it, so no later sum may add it again.
  //
  // NESTED PATHS CANNOT BE SUMMED - the rule footprintBytes below already
  // follows, and which `total` did not. A versioned tree is counted whole here,
  // and then its `staging/` was added again by stagingBytes and its leftover
  // compilers again by strayToolBytes. Measured on a real reset: a 1.92 GB
  // footprint reported 3.29 GB deleted and left 86.5 MB, so about 1.83 GB
  // actually went and the dialog claimed nearly double.
  //
  // The reset itself was correct throughout; only the accounting was wrong. That
  // is the harder kind to notice, because nothing misbehaves - the arithmetic
  // simply does not close, and only a before/after check finds it. (2026-08-15)
  const countedTreePaths = new Set();
  const insideCountedTree = p =>
    [...countedTreePaths].some(t => p === t || p.startsWith(t + path.sep));

  for (const v of removableCores) {
    const treePath = treeFor.get(coreVersions.normalizeVersion(v));
    if (!treePath) continue;
    // The directory is named whatever arduino-cli called it, which is not always
    // our normalised form: 3.6 lives in `3.6`, not `3.6.0`. Sizing the normalised
    // path measured a directory that does not exist, so the confirm dialog offered
    // to reclaim "0 B" of a core that was about 198 MB.
    const onDisk = coreVersions.installedVersionString(treePath, v);
    if (!onDisk) continue;

    // A VERSIONED tree exists only to hold this one plugin, so removing the plugin empties it and
    // the reset then deletes the whole directory. Count the whole directory.
    //
    // Counting just the platform and its compiler missed the tree's own arduino-cli scaffolding -
    // a ~50 MB `library_index.json`, the package indexes, the builtin tools - about 77 MB per tree
    // that got deleted and never itemised. A reset promising 1.19 GB removed 1.27 GB. The
    // `orphanTrees` bullet does not cover it either: that only sees trees ALREADY empty when the
    // survey ran, not one this reset is about to empty.
    //
    // The legacy root is different - it survives the reset - so there only the platform and the
    // tools it leaves behind are reclaimable. (2026-08-14)
    if (treePath !== legacyPath) {
      toolBytes += _dirSize(treePath);
      countedTreePaths.add(treePath);
      continue;
    }

    toolBytes += _dirSize(path.join(coreVersions.getHardwarePath(treePath), onDisk));
    // Its compiler too. Each tree carries its own toolchain - 3.6 needs
    // 9-2020-q2-update and 4.6 needs 14-2-rel1-xpack, sharing no bytes - and it
    // is the larger half by a wide margin. Counting only the platform reported a
    // fraction of what removing the core actually frees.
    for (const t of coreVersions.unusedToolDirs(treePath, Array.from(keep), idx.toolDeps)) {
      toolBytes += _dirSize(t.path);
      countedToolPaths.add(t.path);
    }
  }

  // Stray tool directories in trees we are NOT removing a plugin from.
  //
  // The survey counted unused tools only inside the trees of plugins being removed, while the reset
  // sweeps `unusedToolDirs` across EVERY tree - including trees whose plugin is kept, and the legacy
  // root. So a leftover compiler elsewhere was deleted and never itemised, and the arithmetic did
  // not close: a reset promising 1.88 GB removed about 2.08 GB, a ~160 MB silent surplus.
  //
  // Erring generous is still erring. The confirm has to state what the action does, and the sums
  // have to reconcile or nobody can check them. Counted with the same call the reset uses, over the
  // same set of trees, so the two cannot drift again. (2026-08-14)
  let strayToolBytes = 0;
  try {
    for (const treePath of toolchain.listCoreTreePaths()) {
      // Its whole directory is already in toolBytes, compilers included.
      if (insideCountedTree(treePath)) continue;
      for (const t of coreVersions.unusedToolDirs(treePath, Array.from(keep), idx.toolDeps)) {
        if (countedToolPaths.has(t.path) || insideCountedTree(t.path)) continue;
        countedToolPaths.add(t.path);
        strayToolBytes += _dirSize(t.path);
      }
    }
  } catch {}

  // Cached builds that only work with tools being removed. They go out together;
  // freeing the tools and stranding their builds would be a half-measure.
  let strandedBuilds = 0, strandedBytes = 0;
  if (removableCores.length) {
    const gone = new Set(removableCores.map(coreVersions.normalizeVersion));
    const root = path.join(userData, 'build-cache');
    try {
      for (const pkg of fs.readdirSync(root, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        for (const e of fs.readdirSync(path.join(root, pkg.name), { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const dir = path.join(root, pkg.name, e.name);
          const mp  = path.join(dir, 'metadata.json');
          if (!fs.existsSync(mp)) continue;
          let m; try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { continue; }
          if (m.coreVersion && gone.has(coreVersions.normalizeVersion(m.coreVersion))) {
            strandedBuilds++; strandedBytes += _dirSize(dir);
          }
        }
      }
    } catch { /* no cache yet */ }
  }

  const workspaceBytes = _dirSize(path.join(userData, 'build-output'));
  // Every tree has its own staging directory, so summing one of them under-reports
  // by however many cores have been installed since.
  const stagingRoots = new Set([dataPath, ...toolchain.listCoreTreePaths()]);
  let stagingBytes = 0;
  for (const r of stagingRoots) {
    // A tree counted whole above already includes its own staging.
    if (insideCountedTree(r)) continue;
    stagingBytes += _dirSize(path.join(r, 'staging'));
  }

  // Trees that no longer hold a plugin at all.
  //
  // Removing a core leaves its tree standing, full of arduino-cli scaffolding it regenerates on
  // the next install: `library_index.json` alone is ~54 MB, plus the package indexes, the builtin
  // discovery tools and `tmp/`. Measured on a real machine after a reset: 77 MB in each of two
  // emptied trees, ~154 MB total, none of it ours to keep and none of it the user's.
  //
  // Worse than the size, it was UNREACHABLE. `listCoreTrees()` yields a tree only while a core is
  // installed in it, so `toolBytes` above can never count an emptied one - the reset that emptied
  // the tree was also the last chance to reclaim it. Same shape as the 2026-08-12 bug where a
  // just-emptied tree was excluded from the sweep meant to include it.
  //
  // The LEGACY root is deliberately excluded: it is the shared arduino-cli data directory, holding
  // the config and the builtin tools every tree relies on. Only `arduino-data/<version>/` is a
  // per-plugin container that exists for one purpose and is finished when that purpose is.
  // (2026-08-14)
  const liveTrees   = new Set(toolchain.listCoreTrees().map(t => t.path));
  const orphanTrees = toolchain.listCoreTreePaths()
    .filter(p => p !== legacyPath && !liveTrees.has(p));
  let orphanTreeBytes = 0;
  for (const p of orphanTrees) orphanTreeBytes += _dirSize(p);

  // TWO numbers, because the row and the button answer different questions.
  //
  // `footprintBytes` is what Build Space IS: every byte the build system occupies, whether or not
  // it can be reclaimed today. `total` is what a reset would actually delete right now.
  //
  // They were one number, and the row showed the reclaimable one under a label that named the
  // thing. So the figure lurched by ~710 MB when a plugin merely stopped being referenced -
  // nothing moved on disk, but a whole tree crossed from "in use" to "removable". A size beside a
  // noun has to describe the noun.
  //
  // The footprint deliberately EXCLUDES cached builds. They are the row above's subject, and
  // counting stranded ones here made the two rows silently overlap. A reset still deletes them -
  // they are unusable once their plugin goes - so they stay in `total`. (2026-08-14)
  // ONE walk of the tree root, never a sum over `listCoreTreePaths()`. That list holds the legacy
  // root (`arduino-data/`) AND every versioned tree (`arduino-data/3.6.0/`), which live INSIDE it -
  // so summing them counted each versioned tree twice, and `staging` three times, since staging is
  // inside the trees. It reported 2.45 GB where a reset then freed 1.06 GB and left 183.5 MB; the
  // arithmetic not closing is what exposed it.
  //
  // NESTED PATHS CANNOT BE SUMMED. Walk the container once. `build-output` is the only part of the
  // build space living outside that root, so it is the only thing added - and `stagingBytes` is
  // deliberately NOT added here for the same reason. (2026-08-14)
  const footprintBytes = workspaceBytes + _dirSize(toolchain.getCoreTreeRoot());

  // Cached builds are NOT build space, in either number. Build space is temp files and plugins.
  // A reset still removes builds that only work with a plugin it is deleting - they are unusable
  // the moment it goes - but that is a CONSEQUENCE of the reset, not part of what build space is
  // made of, and counting it here made this row overlap the Cached Builds row above. The confirm
  // states it as a consequence and `strandedBytes` travels for exactly that. (2026-08-14)
  const total = workspaceBytes + stagingBytes + toolBytes + orphanTreeBytes + strayToolBytes;
  return {
    ok: true,
    workspaceBytes,
    stagingBytes,
    footprintBytes,
    orphanTrees: { paths: orphanTrees, bytes: orphanTreeBytes },
    strayToolBytes,
    tools: {
      versions: removableCores,
      bytes:    toolBytes,
      strandedBuilds,
      strandedBytes,
      // `redownloadBytes` was here - the compressed archive size, ~198 MB - and the confirm printed
      // it beside the reclaimed size. They are different measurements of the same thing (unpacked
      // on disk vs compressed download), so side by side they read as a contradiction. The bullet
      // now states the consequence without a figure, and nothing reads this, so it is gone rather
      // than computed and discarded. (2026-08-14)
    },
    total,
    // Nothing to RECLAIM is a real answer and the button should say so, even when the footprint
    // above it is large. The two are independent: a machine can be holding a gigabyte of build
    // space with none of it removable.
    empty: total === 0,
  };
}

ipcMain.handle('space:survey', async () => {
  try { return await _surveyBuildSpace(); }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('space:reset', async () => {
  const log      = makeLogger();
  const userData = app.getPath('userData');
  const dataPath = toolchain.getArduinoDataPath();
  const before   = await _surveyBuildSpace();
  const removed  = { tools: [], failed: [] };

  // Tools first. Their cached builds become reclaimable only once the tools are
  // actually gone, so ordering matters for the sweep below.
  for (const v of before.tools.versions) {
    const res = await toolchain.uninstallCore(log, v);
    if (res.ok) removed.tools.push(v); else removed.failed.push(res.error);
  }

  // Whatever arduino-cli left behind that no remaining core depends on, in every
  // tree rather than one. Re-listed AFTER the uninstalls above so a tree that has
  // just been emptied is included. (2026-08-12)
  // Tree DIRECTORIES, not trees-that-still-hold-a-core. `listCoreTrees` yields a
  // tree only while a core is installed in it, so the tree this reset has just
  // emptied - the one whose staging most needs sweeping - was the one guaranteed
  // to be excluded, and stayed excluded on every later reset too. (2026-08-12)
  const treesNow = new Set([dataPath, ...toolchain.listCoreTreePaths()]);
  try {
    const idx  = await coreVersions.resolveLatest(userData);
    const keep = await _referencedCores();
    for (const r of treesNow) {
      for (const t of coreVersions.unusedToolDirs(r, Array.from(keep), idx.toolDeps)) {
        try { fs.rmSync(t.path, { recursive: true, force: true }); } catch {}
      }
    }
  } catch {}

  const scratch = [path.join(userData, 'build-output')];
  for (const r of treesNow) scratch.push(path.join(r, 'staging'));
  for (const dir of scratch) {
    try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  // A versioned tree with no plugin left in it has no reason to exist. Remove the directory, not
  // just its contents: it is a per-plugin container we created, everything inside is arduino-cli
  // scaffolding regenerated on the next install, and leaving it standing puts ~77 MB somewhere no
  // later survey can see - `listCoreTrees()` skips a tree the moment it holds no core.
  //
  // Re-listed AFTER the uninstalls above so trees emptied by THIS run are included, not just ones
  // orphaned by a previous one. The legacy root is excluded: it is the shared arduino-cli data
  // directory, and its config, indexes and builtin tools are what every other tree depends on.
  // (2026-08-14)
  const legacyPath = toolchain.getLegacyCoreTreePath();
  let treesRemoved = 0;
  try {
    const stillLive = new Set(toolchain.listCoreTrees().map(t => t.path));
    for (const p of toolchain.listCoreTreePaths()) {
      if (p === legacyPath || stillLive.has(p)) continue;
      try {
        fs.rmSync(p, { recursive: true, force: true });
        treesRemoved++;
        log(`Removed empty Proffieboard Plugin tree: ${path.basename(p)}`, false);
      } catch (e) {
        removed.failed.push(`Could not remove the empty ${path.basename(p)} tree: ${e.message}`);
      }
    }
  } catch {}

  // This used to also evict the cached builds the removed plugins had just stranded, reusing the
  // launch sweep. Removed 2026-08-14, because it made one action own two things:
  //
  //   - Cached builds are NOT build space. They are the row above's subject, with its own button
  //     for deliberate clearing.
  //   - They are reclaimed anyway. The launch sweep evicts a build whose plugin is gone, so the
  //     space returns on its own at the next start; this only made it sooner.
  //   - The coupling caused a real defect. `strandedBytes` was inside `before.total` AND added
  //     again as `sweptBytes`, so the reported "freed" overstated by their size. One action
  //     reporting on two subjects is what produced the double-count.
  //
  // A reset therefore leaves those builds in place for one launch. The confirm still WARNS about
  // them, because losing them is a genuine consequence of removing the plugin - it just is not
  // this action's doing.

  const after = await _surveyBuildSpace();
  return {
    // A removal that failed must not read as a reset that worked. This returned
    // ok:true unconditionally and put failures in `errors`, which nothing read,
    // so a reset that removed nothing still printed a tick and a byte count.
    // Same shape as flashing a board and reporting success for a board that was
    // never written. (2026-08-12)
    ok: removed.failed.length === 0,
    freed: Math.max(0, before.total - after.total),
    removedTools: removed.tools,
    errors: removed.failed,
  };
});

ipcMain.handle('app:getVersion',      () => app.getVersion());
ipcMain.handle('app:isDevMode',       () => !app.isPackaged);
ipcMain.handle('app:isSplashDismissed', () => _splashDismissed);

// ── Sound Fonts Library ────────────────────────────────
// Library lives at userData/soundFonts/ with a top-level _jmt_library_meta.json
// as the "library exists" sentinel. Each imported font is a sibling folder.
// Library state is derived by scanning the directory; no central index.
const _soundFontsRoot = () => path.join(app.getPath('userData'), 'soundFonts');
const _soundFontsMeta = () => path.join(_soundFontsRoot(), '_jmt_library_meta.json');

ipcMain.handle('soundFonts:exists', () => {
  try { return fs.existsSync(_soundFontsMeta()); } catch { return false; }
});

ipcMain.handle('soundFonts:create', () => {
  try {
    const root = _soundFontsRoot();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const meta = _soundFontsMeta();
    if (!fs.existsSync(meta)) {
      fs.writeFileSync(meta, JSON.stringify({
        createdAt: new Date().toISOString(),
        schemaVersion: 1,
      }, null, 2));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('soundFonts:listFonts', () => {
  try {
    const root = _soundFontsRoot();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch { return []; }
});

// List fonts with their metadata blob for card rendering.
ipcMain.handle('soundFonts:listFontsWithMeta', () => {
  try {
    const root = _soundFontsRoot();
    if (!fs.existsSync(root)) return [];
    const entries = fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const name = e.name;
        const metaPath = path.join(root, name, '_jmt_font_meta.json');
        let meta = null;
        try {
          if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch {}
        return { name, meta };
      });
    return entries;
  } catch { return []; }
});

// Scan a candidate source folder. If it contains a `Proffie` subfolder alongside
// optional `Xeno`, `CrystalFocus`, or other version siblings, we treat the
// Proffie subfolder as the real source. Otherwise the picked folder is used
// as-is. Returns the resolved source path, a flag indicating whether a
// multi-version structure was detected, a recursive .wav count for validation,
// and a suggested name (the basename of the parent — what a user would
// recognize as the font's identity).
ipcMain.handle('soundFonts:scanFolder', (_, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { ok: false, error: 'Folder does not exist' };
    }
    const baseName = path.basename(folderPath);
    let resolvedPath = folderPath;
    let detectedMultiVersion = false;
    let suggestedName = baseName;
    const children = fs.readdirSync(folderPath, { withFileTypes: true });
    const proffieDir = children.find(e =>
      e.isDirectory() && /^proffie$/i.test(e.name));
    if (proffieDir) {
      resolvedPath = path.join(folderPath, proffieDir.name);
      detectedMultiVersion = true;
      // Suggested name stays as the OUTER folder's basename; the user almost
      // always wants the meaningful font name (e.g. "Vader") rather than
      // "Proffie".
      suggestedName = baseName;
      // But if the outer folder itself contains "proffie" too (e.g. user picked
      // something like Vader-Proffie/ where Vader-Proffie/Proffie/ exists),
      // walk up one more level for a cleaner suggestion.
      if (/proffie/i.test(baseName)) {
        const parent = path.basename(path.dirname(folderPath));
        if (parent && !/proffie/i.test(parent)) suggestedName = parent;
      }
    } else if (/proffie/i.test(baseName)) {
      // User picked a folder whose name contains "proffie" — could be the
      // bare Proffie subfolder itself, or a vendor-named variant like
      // Vader-Proffie/, Proffie-V1/, MyFont_Proffie/. In any of these cases
      // the parent's basename is almost always the cleaner suggestion.
      suggestedName = path.basename(path.dirname(folderPath));
    }
    // Recursive .wav count (we don't care WHERE the .wavs are, only that there
    // are any — vendor structure varies).
    const countWavs = (dir) => {
      let count = 0;
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) count += countWavs(full);
          else if (e.isFile() && /\.wav$/i.test(e.name)) count++;
        }
      } catch {}
      return count;
    };
    const wavCount = countWavs(resolvedPath);
    // Alt folders (alt000, alt001, ...) at the root are another valid content
    // marker. Some ProffieOS fonts ship with alt structures only and may not
    // have any .wav files at the root level; the wavs are inside the alts.
    // Treat their presence as a valid content signal regardless of wav count.
    const altFolders = fs.readdirSync(resolvedPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^alt\d+$/i.test(e.name))
      .map(e => e.name);
    return {
      ok: true,
      sourcePath: resolvedPath,
      detectedMultiVersion,
      suggestedName,
      wavCount,
      altFolderCount: altFolders.length,
      hasContent: wavCount > 0 || altFolders.length > 0,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Copy `sourcePath` recursively into userData/soundFonts/<name>/ asynchronously,
// reporting per-file progress via the `soundFonts:importProgress` IPC event so
// the renderer can show a progress bar instead of an apparent freeze. Files
// are enumerated first to compute the total, then copied one at a time;
// progress emits are throttled to ~100ms or every 10 files (whichever first)
// so we don't flood IPC on small files. The `_jmt_font_meta.json` is filtered
// out of any source content so a re-import of a previously-imported folder
// does not carry the prior identity. On error, any partial destination is
// cleaned up so the library stays consistent.
ipcMain.handle('soundFonts:importFont', async (event, { sourcePath, name, metadata }) => {
  let dest;
  try {
    if (!sourcePath || !name) return { ok: false, error: 'Missing sourcePath or name' };
    const root = _soundFontsRoot();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    dest = path.join(root, name);
    if (fs.existsSync(dest)) return { ok: false, error: 'A font with that name already exists' };

    // Walk source to enumerate files (and skip any existing JMT metadata).
    const files = [];
    let totalBytes = 0;
    const walk = (dir, relBase) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '_jmt_font_meta.json') continue;
        const full = path.join(dir, e.name);
        const rel = path.join(relBase, e.name);
        if (e.isDirectory()) walk(full, rel);
        else if (e.isFile()) {
          let size = 0;
          try { size = fs.statSync(full).size; } catch {}
          files.push({ full, rel, size });
          totalBytes += size;
        }
      }
    };
    walk(sourcePath, '');
    const total = files.length;

    const send = (payload) => {
      try { event.sender.send('soundFonts:importProgress', payload); } catch {}
    };
    send({ stage: 'starting', current: 0, total, bytes: 0, totalBytes });

    fs.mkdirSync(dest, { recursive: true });

    let copied = 0;
    let bytesCopied = 0;
    let lastEmit = Date.now();
    for (const f of files) {
      const destPath = path.join(dest, f.rel);
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      await fs.promises.copyFile(f.full, destPath);
      copied++;
      bytesCopied += f.size;
      const now = Date.now();
      if (now - lastEmit > 100 || copied % 10 === 0 || copied === total) {
        send({
          stage: 'copying',
          current: copied,
          total,
          bytes: bytesCopied,
          totalBytes,
          currentFile: f.rel,
        });
        lastEmit = now;
      }
    }

    const meta = {
      schemaVersion: 1,
      name,
      author: (metadata && metadata.author) || '',
      purchased: !!(metadata && metadata.purchased),
      acquisitionDate: (metadata && metadata.acquisitionDate) || new Date().toISOString().slice(0, 10),
      description: (metadata && metadata.description) || '',
      linkedStyleLibraryEntry: (metadata && metadata.linkedStyleLibraryEntry) || null,
      importedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dest, '_jmt_font_meta.json'), JSON.stringify(meta, null, 2));

    send({ stage: 'done', current: total, total, bytes: totalBytes, totalBytes });
    return { ok: true, name };
  } catch (err) {
    // Clean up partial destination so the library doesn't carry an incomplete copy.
    try { if (dest && fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true }); } catch {}
    return { ok: false, error: String(err && err.message || err) };
  }
});
// ── Sound Fonts — sources (Phase 1) ────────────────────
// Sources are the user's archive of purchases as delivered, stored verbatim
// under userData/soundFonts/sources/<uuid>/. Each source is either a
// source.zip (zip-delivered) or a source/ subfolder (folder-delivered) plus
// a meta.json. Library entries (Phase 2) reference sources by uuid.
ipcMain.handle('sources:list', () => {
  try { return { ok: true, sources: soundFontSources.listSources(app.getPath('userData')) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Bulk import — open a folder picker for the bulk-scan entry point.
// Returns the chosen path so the renderer can pass it to bulkImport:scan.
ipcMain.handle('bulkImport:pickRoot', async () => {
  try {
    const lastDir = Store.get('lastBulkImportRoot') || app.getPath('home');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Pick a folder of sound fonts to bulk import…',
      defaultPath: lastDir,
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    Store.set('lastBulkImportRoot', filePaths[0]);
    return { ok: true, rootDir: filePaths[0] };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Bulk import — phase 1: scan the picked folder and return a plan. Fast,
// no hashing, no disk writes. The renderer shows a pre-scan summary so
// the user can review and confirm before any sources get created.
ipcMain.handle('bulkImport:scan', async (_, { rootDir } = {}) => {
  try {
    return soundFontBulkImport.scanForBulkImport({ rootDir });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Bulk import — phase 2: execute the plan. Hashes each source, dedups
// against the library, copies and detects candidates, creates entries
// with needsReview when fields couldn't be auto-filled. Streams progress
// via the bulkImport:progress event.
let _bulkImportCancelToken = null;
ipcMain.handle('bulkImport:run', async (e, { plan } = {}) => {
  try {
    _bulkImportCancelToken = { cancelled: false };
    const myToken = _bulkImportCancelToken;
    const result = await soundFontBulkImport.runBulkImport(
      { plan, userData: app.getPath('userData') },
      {
        onProgress: (payload) => {
          try { e.sender.send('bulkImport:progress', payload); } catch {}
        },
        shouldCancel: () => myToken.cancelled,
      },
    );
    return result;
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    _bulkImportCancelToken = null;
  }
});

ipcMain.handle('bulkImport:cancel', () => {
  if (_bulkImportCancelToken) _bulkImportCancelToken.cancelled = true;
  return { ok: true };
});

// ANALYZE phase: stage every planned source (zip + hash + dedup, no meta yet)
// and return real stats + per-source prepared/dup/corrupt results. Reuses the
// same progress event + cancel token as run.
ipcMain.handle('bulkImport:analyze', async (e, { plan, corruptFonts } = {}) => {
  try {
    _bulkImportCancelToken = { cancelled: false };
    const myToken = _bulkImportCancelToken;
    const result = await soundFontBulkImport.analyzeBulkImport(
      { plan, userData: app.getPath('userData'), corruptFonts },
      {
        onProgress: (payload) => { try { e.sender.send('bulkImport:progress', payload); } catch {} },
        shouldCancel: () => myToken.cancelled,
      },
    );
    return result;
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    _bulkImportCancelToken = null;
  }
});

// Delete prepared-but-not-committed sources (user pruned them or closed the modal).
ipcMain.handle('bulkImport:discardPrepared', async (_, { uuids } = {}) => {
  try { soundFontBulkImport.discardPreparedSources(app.getPath('userData'), uuids || []); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Guided import — enrich a scan plan: per-candidate vendor detection (in
// place), first font.wav/hum.wav for preview, and readme/text docs. Runs
// only when the user opens the guided review, so quick import stays fast.
// Read-only: no hashing, no copy, no library writes. Streams progress via
// the bulkImport:enrichProgress event.
let _bulkEnrichCancelToken = null;
ipcMain.handle('bulkImport:enrichGuided', async (e, { plan } = {}) => {
  try {
    _bulkEnrichCancelToken = { cancelled: false };
    const myToken = _bulkEnrichCancelToken;
    return await soundFontBulkImport.enrichPlanForGuided(
      { plan },
      {
        onProgress: (payload) => {
          try { e.sender.send('bulkImport:enrichProgress', payload); } catch {}
        },
        shouldCancel: () => myToken.cancelled,
      },
    );
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    _bulkEnrichCancelToken = null;
  }
});

ipcMain.handle('bulkImport:enrichCancel', () => {
  if (_bulkEnrichCancelToken) _bulkEnrichCancelToken.cancelled = true;
  return { ok: true };
});

// Read one file out of an in-place (not-yet-imported) source — folder OR
// zip — for the guided review's font/hum previews and text peek. Works for
// both because openSourceAtPath abstracts the format. Read-only. Returns
// the raw bytes; the renderer decodes audio or text as needed.
ipcMain.handle('bulkImport:readCandidateFile', async (_, { absPath, innerPath } = {}) => {
  try {
    const source = soundFontSources.openSourceAtPath(absPath);
    if (!source) return { ok: false, error: 'unreadable source' };
    const buf = await source.readFile(innerPath);
    return { ok: true, bytes: buf };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:cleanupOrphans', () => {
  try {
    const result = soundFontSources.cleanupOrphanSources(app.getPath('userData'));
    return { ok: true, ...result };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('sources:existsByHash', (_, hash) => {
  try {
    const match = soundFontSources.findByHash(app.getPath('userData'), hash);
    return { ok: true, match };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:delete', (_, { uuid } = {}) => {
  try {
    return soundFontSources.deleteSource(app.getPath('userData'), uuid);
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:updateMeta', (_, { uuid, updates } = {}) => {
  try {
    return soundFontSources.updateSourceMeta(app.getPath('userData'), uuid, updates);
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:listFiles', async (_, { uuid } = {}) => {
  try {
    const files = await soundFontSources.listSourceFiles(app.getPath('userData'), uuid);
    return { ok: true, files };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Lazy descent into an inner zip from the source file browser. Pay-for-what-
// you-use: the outer listFiles call leaves inner zips as zip-shaped folders,
// and this handler fires only when the user actually navigates into one.
ipcMain.handle('sources:listInnerZipFiles', async (_, { uuid, innerZipPath } = {}) => {
  try {
    const files = await soundFontSources.listSourceInnerZipFiles(
      app.getPath('userData'), uuid, innerZipPath,
    );
    return { ok: true, files };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:browse', async (_, { uuid, path: subPath } = {}) => {
  try {
    const source = soundFontSources.openSource(app.getPath('userData'), uuid);
    if (!source) return { ok: false, error: `Source not found: ${uuid}` };
    const entries = await source.browse(subPath || '');
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:readFile', async (_, { uuid, path: filePath } = {}) => {
  try {
    const source = soundFontSources.openSource(app.getPath('userData'), uuid);
    if (!source) return { ok: false, error: `Source not found: ${uuid}` };
    const buf = await source.readFile(filePath);
    return { ok: true, data: buf };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:extractTo', async (event, { uuid, path: subPath, destDir } = {}) => {
  const send = (payload) => {
    try { event.sender.send('sources:extractProgress', { uuid, ...payload }); } catch {}
  };
  try {
    const source = soundFontSources.openSource(app.getPath('userData'), uuid);
    if (!source) return { ok: false, error: `Source not found: ${uuid}` };
    const result = await source.extractTo(subPath || '', destDir, send);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:detectVendor', async (_, { uuid } = {}) => {
  try {
    const source = soundFontSources.openSource(app.getPath('userData'), uuid);
    if (!source) return { ok: false, error: `Source not found: ${uuid}` };
    const detection = await soundFontVendors.detectVendor(source);
    return { ok: true, ...detection };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:detectCandidates', async (_, { uuid } = {}) => {
  try {
    // Persistent cache + on-meta storage: first call computes + stamps,
    // every call after that reads from meta. Survives backup / restore /
    // app restart because meta.json is the storage medium.
    const result = await soundFontSources.getCachedCandidates(app.getPath('userData'), uuid);
    if (!result) return { ok: false, error: `Source not found: ${uuid}` };
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// ── Sound Fonts — library entries (Phase 1, slice 5) ───
// Entries are curated subsets of a source, extracted into
// userData/soundFonts/library/<name>/ with a meta.json linking back to the
// source by UUID. Phase 2 wires these into the browse grid and migration.
// One-shot migration guard: source-level fields (vendor/website/purchased/
// acquisitionDate) became canonical on the source meta on 2026-06-23, but
// legacy entries from before that landed have these values stored on the
// entry meta. First entries:list call after launch runs the migration,
// which hoists any non-empty entry-level values up to their source if the
// source is missing them. Idempotent — subsequent runs short-circuit
// because the source already has the field.
let _entriesMigrationRan = false;
ipcMain.handle('entries:list', () => {
  try {
    if (!_entriesMigrationRan) {
      _entriesMigrationRan = true;
      try { soundFontEntries.migrateSourceLevelFields(app.getPath('userData')); } catch {}
    }
    return { ok: true, entries: soundFontEntries.listEntries(app.getPath('userData')) };
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('entries:existsByName', (_, name) => {
  try {
    const match = soundFontEntries.findEntryByName(app.getPath('userData'), name);
    return { ok: true, match };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('entries:delete', (_, { name } = {}) => {
  try {
    return soundFontEntries.deleteEntry(app.getPath('userData'), name);
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('entries:listBySource', (_, { sourceUuid } = {}) => {
  try {
    return { ok: true, entries: soundFontEntries.listEntriesBySourceUuid(app.getPath('userData'), sourceUuid) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('entries:updateMeta', (_, { currentName, newName, updates } = {}) => {
  try {
    return soundFontEntries.updateEntryMeta({
      userData: app.getPath('userData'),
      currentName,
      newName,
      updates,
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Duplicate an existing entry. mode='current' copies the on-disk
// state verbatim (local edits carried over); mode='source' re-extracts
// from the original archive (vendor-original files, user-facing meta
// seeded from the source entry).
ipcMain.handle('entries:duplicate', async (_, { sourceName, newName, mode } = {}) => {
  try {
    return await soundFontEntries.duplicateEntry({
      userData: app.getPath('userData'),
      sourceName, newName, mode,
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('entries:create', async (event, { sourceUuid, candidate, name, metadata } = {}) => {
  const send = (payload) => {
    try { event.sender.send('entries:createProgress', payload); } catch {}
  };
  try {
    return await soundFontEntries.createEntry({
      userData: app.getPath('userData'),
      sourceUuid,
      candidate,
      name,
      metadata,
      onProgress: send,
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:listDocs', async (_, { uuid } = {}) => {
  try {
    const docs = await soundFontSources.listSourceDocs(app.getPath('userData'), uuid);
    return { ok: true, docs };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:readDocBytes', async (_, { uuid, path: subPath } = {}) => {
  try {
    const buf = await soundFontSources.readSourceFileBytes(app.getPath('userData'), uuid, subPath);
    return { ok: true, bytes: Array.from(buf) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:exportDoc', async (_, { uuid, path: subPath } = {}) => {
  try {
    const result = await soundFontSources.exportSourceFileTo(
      app.getPath('userData'),
      uuid,
      subPath,
      app.getPath('downloads'),
    );
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// ── Source attachments (receipts / proof-of-purchase / reference docs) ──
// Central content-addressed store; sources link by id. Attachments never
// touch the source archive or its content hash. See soundFontAttachments.js.
ipcMain.handle('attachments:list', (_, { uuid } = {}) => {
  try { return { ok: true, attachments: soundFontAttachments.listAttachments(app.getPath('userData'), uuid) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:add', async (_, { uuid } = {}) => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Attach files to this source',
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  try { return soundFontAttachments.addAttachments(app.getPath('userData'), uuid, res.filePaths); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:open', (_, { id } = {}) => {
  try {
    const p = soundFontAttachments.attachmentFilePath(app.getPath('userData'), id);
    if (!p) return { ok: false, error: 'attachment not found' };
    shell.openPath(p);
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:unlink', (_, { uuid, id } = {}) => {
  try { return soundFontAttachments.unlinkAttachment(app.getPath('userData'), uuid, id); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:listAll', () => {
  try { return { ok: true, attachments: soundFontAttachments.listAllAttachments(app.getPath('userData')) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:link', (_, { uuid, ids } = {}) => {
  try { return soundFontAttachments.linkAttachments(app.getPath('userData'), uuid, ids || []); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:read', (_, { id } = {}) => {
  try { return soundFontAttachments.readAttachment(app.getPath('userData'), id); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:sourcesFor', (_, { id } = {}) => {
  try { return { ok: true, uuids: soundFontAttachments.sourcesForAttachment(app.getPath('userData'), id) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:linkToSources', (_, { id, uuids } = {}) => {
  try { return soundFontAttachments.linkAttachmentToSources(app.getPath('userData'), id, uuids || []); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:pickFile', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a proof-of-purchase file',
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, filePath: res.filePaths[0], fileName: path.basename(res.filePaths[0]) };
});
ipcMain.handle('attachments:addToSources', (_, { filePath, label, uuids } = {}) => {
  try { return soundFontAttachments.addAttachmentToSources(app.getPath('userData'), { filePath, label, uuids: uuids || [] }); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('attachments:removeEverywhere', (_, { id } = {}) => {
  try { return soundFontAttachments.removeAttachmentEverywhere(app.getPath('userData'), id); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('entries:listFiles', (_, { name } = {}) => {
  try {
    const files = soundFontEntries.listEntryFiles(app.getPath('userData'), name);
    return { ok: true, files };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Unified file ops (common ↔ entry, either direction, same kind same dir).
// Used by both the common-folder sidecar and the entry detail file browser
// so clipboard contents can survive switching between them.
ipcMain.handle('fileOps:copy', async (event, { src, srcPaths, dest, destNames } = {}) => {
  try {
    // Throttled per-file ticks so the renderer can show names going past. The
    // copy is synchronous here and, for shared tracks, hashes each file as it
    // lands, so thirty large tracks is a long silence without this.
    let last = 0;
    const onFile = (name, done, total) => {
      const now = Date.now();
      if (now - last < 60 && done < total) return;
      last = now;
      try { event.sender.send('fileOps:copyProgress', { name, done, total }); } catch {}
    };
    return await soundFontFileOps.copyAcrossLocations({ userData: app.getPath('userData'), src, srcPaths, dest, destNames, onFile });
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('fileOps:move', (_, { kind, id, sourcePaths, destSubPath } = {}) => {
  try { return soundFontFileOps.moveWithinLocation({ userData: app.getPath('userData'), kind, id, sourcePaths, destSubPath }); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('fileOps:delete', (_, { kind, id, subPaths } = {}) => {
  try { return soundFontFileOps.deleteFilesAt({ userData: app.getPath('userData'), kind, id, subPaths }); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('fileOps:rename', (_, { kind, id, subPath, newName } = {}) => {
  try { return soundFontFileOps.renameFileAt({ userData: app.getPath('userData'), kind, id, subPath, newName }); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('fileOps:createSubfolder', (_, { kind, id, parentSubPath, name } = {}) => {
  try { return soundFontFileOps.createSubfolderAt({ userData: app.getPath('userData'), kind, id, parentSubPath, name }); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('fileOps:addFiles', (_, { kind, id, subPath, sourceFilePaths, destNames } = {}) => {
  try { return soundFontFileOps.addFilesAt({ userData: app.getPath('userData'), kind, id, subPath, sourceFilePaths, destNames }); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Reorganize ops — bucket detection drives the Reorganize modal; the
// restructure/reorder/find&replace handlers commit changes to disk.
ipcMain.handle('reorganize:detect', (_, { name } = {}) => {
  try { return { ok: true, ...soundFontReorganize.detectLayout(app.getPath('userData'), name) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('reorganize:group', (_, { name } = {}) => {
  try { return soundFontReorganize.restructureToGrouped(app.getPath('userData'), name); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('reorganize:flatten', (_, { name } = {}) => {
  try { return soundFontReorganize.restructureToFlat(app.getPath('userData'), name); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('reorganize:reorder', (_, { name, bucketId, orderedPaths } = {}) => {
  try { return soundFontReorganize.applyReorder(app.getPath('userData'), name, bucketId, orderedPaths); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('reorganize:findReplace', (_, { name, find, replace, commit } = {}) => {
  try { return soundFontReorganize.findReplaceInEntry(app.getPath('userData'), name, find, replace, { commit: !!commit }); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('reorganize:renumber', (_, { name, subPath } = {}) => {
  try { return soundFontReorganize.renumberFolder(app.getPath('userData'), name, subPath); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});


// Generic audio file picker — used by the entry's "+ Add" affordance.
// Title differs from the common-folder picker so the dialog reads
// correctly in either context.
ipcMain.handle('dialog:selectAudioFiles', async (_, { title } = {}) => {
  const result = await dialog.showOpenDialog(win, {
    title: title || 'Add audio files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: ['wav'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, filePaths: result.filePaths };
});

ipcMain.handle('entries:listDocs', (_, { name } = {}) => {
  try {
    const docs = soundFontEntries.listEntryDocs(app.getPath('userData'), name);
    return { ok: true, docs };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('entries:readDocBytes', (_, { name, path: subPath } = {}) => {
  try {
    const buf = soundFontEntries.readEntryFileBytes(app.getPath('userData'), name, subPath);
    return { ok: true, bytes: Array.from(buf) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('entries:exportDoc', (_, { name, path: subPath } = {}) => {
  try {
    const result = soundFontEntries.exportEntryFileTo(
      app.getPath('userData'),
      name,
      subPath,
      app.getPath('downloads'),
    );
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Pick a destination directory for the bulk Save action — typically an SD
// card root or any folder the user wants Proffie-shaped font folders copied
// into. createDirectory lets the user make a subfolder on the fly.
ipcMain.handle('dialog:selectSaveDestination', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose destination for sound fonts',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, dirPath: result.filePaths[0] };
});

// Byte-progress emitter for the bulk-export handlers. Accumulates bytes and
// forwards them to the renderer as `soundFonts:exportProgress` events, but no
// more often than every ~80ms so a multi-GB export doesn't flood IPC. The
// renderer sums the deltas; flush() sends whatever's left so the sum stays
// exact (every byte copied is accounted for, no drift).
function _sfExportProgressEmitter(event) {
  let acc = 0;
  let last = 0;
  const send = () => {
    if (acc <= 0) return;
    try { event.sender.send('soundFonts:exportProgress', { delta: acc }); } catch {}
    acc = 0;
  };
  return {
    onBytes: (n) => {
      acc += n;
      const now = Date.now();
      if (now - last >= 80) { last = now; send(); }
    },
    flush: send,
  };
}

ipcMain.handle('entries:exportToFolder', async (event, { name, destDir, mode } = {}) => {
  try {
    const emit = _sfExportProgressEmitter(event);
    const r = await soundFontEntries.exportEntryToFolder(app.getPath('userData'), name, destDir, mode, emit.onBytes);
    emit.flush();
    return r;
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('entries:existsAt', (_, { name, destDir } = {}) => {
  try {
    return { ok: true, exists: soundFontEntries.entryFolderExistsAt(name, destDir) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Resolve a flagged entry's content hash AND effects — called from
// the renderer when the user leaves the entry detail view. No-op when
// neither flag is set; otherwise rehashes / re-detects once and clears
// the flags. Many file ops collapse into one rehash/re-detect this way
// instead of one per op. Both batches piggyback on a single IPC call
// because they share the same "user finished editing" moment.
ipcMain.handle('entries:resolveContentDirty', (_, { name } = {}) => {
  try {
    const userData = app.getPath('userData');
    const hash = soundFontEntries.resolveEntryContentDirty(userData, name);
    const effects = soundFontEntries.resolveEntryEffectsDirty(userData, name);
    return { ok: true, rehashed: hash != null, effectsRecomputed: effects != null };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// ── Common folder IPC ──────────────────────────────────
ipcMain.handle('common:list', () => {
  try { return { ok: true, commons: soundFontCommon.listCommons(app.getPath('userData')) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:nameInUse', (_, { name, excludeUuid } = {}) => {
  try { return { ok: true, inUse: soundFontCommon.nameInUse(app.getPath('userData'), name, excludeUuid) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:importFromFolder', async (_, { folderPath, name } = {}) => {
  try { return await soundFontCommon.importCommonFromFolder(app.getPath('userData'), folderPath, name); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:importFromZip', async (_, { zipPath, name } = {}) => {
  try { return await soundFontCommon.importCommonFromZip(app.getPath('userData'), zipPath, name); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:rename', (_, { uuid, newName } = {}) => {
  try { return soundFontCommon.renameCommon(app.getPath('userData'), uuid, newName); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:duplicate', (_, { uuid, newName } = {}) => {
  try { return soundFontCommon.duplicateCommon(app.getPath('userData'), uuid, newName); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:delete', (_, { uuid } = {}) => {
  try { return soundFontCommon.deleteCommon(app.getPath('userData'), uuid); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:listFiles', (_, { uuid } = {}) => {
  try { return { ok: true, files: soundFontCommon.listCommonFiles(app.getPath('userData'), uuid) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:addFiles', (_, { uuid, subPath, sourceFilePaths } = {}) => {
  try { return soundFontCommon.addFilesToCommon(app.getPath('userData'), uuid, subPath, sourceFilePaths); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:renameFile', (_, { uuid, subPath, newName } = {}) => {
  try { return soundFontCommon.renameCommonFile(app.getPath('userData'), uuid, subPath, newName); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:deleteFile', (_, { uuid, subPath } = {}) => {
  try { return soundFontCommon.deleteCommonFile(app.getPath('userData'), uuid, subPath); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:createSubfolder', (_, { uuid, parentSubPath, name } = {}) => {
  try { return soundFontCommon.createCommonSubfolder(app.getPath('userData'), uuid, parentSubPath, name); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:copyFiles', (_, { sourceUuid, sourcePaths, destUuid, destSubPath } = {}) => {
  try { return soundFontCommon.copyCommonFiles(app.getPath('userData'), sourceUuid, sourcePaths, destUuid, destSubPath); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:moveFiles', (_, { uuid, sourcePaths, destSubPath } = {}) => {
  try { return soundFontCommon.moveCommonFiles(app.getPath('userData'), uuid, sourcePaths, destSubPath); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:readFileBytes', (_, { uuid, subPath } = {}) => {
  try {
    const buf = soundFontCommon.readCommonFileBytes(app.getPath('userData'), uuid, subPath);
    return { ok: true, bytes: Array.from(buf) };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:folderExistsAt', (_, { destDir, targetName } = {}) => {
  try {
    const exists = soundFontCommon.commonFolderExistsAt(destDir, targetName);
    // Marker comes back with it so the renderer can NAME what is on the card.
    // It is display only — never the basis for skipping a copy. See
    // commonMatchesAt for why.
    return { ok: true, exists, marker: exists ? soundFontCommon.readCommonMarkerAt(destDir, targetName) : null };
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Byte-comparison of the destination's common folder against a library common.
// Reads content; the marker is not consulted. Sync inside a handler because the
// cheap file-count/byte pre-check short-circuits the expensive path in exactly
// the case that would be slow (a genuinely different folder).
ipcMain.handle('common:matchesAt', (_, { uuid, destDir, targetName } = {}) => {
  try {
    return soundFontCommon.commonMatchesAt(app.getPath('userData'), uuid, destDir, targetName);
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Refresh the marker at a destination WITHOUT copying anything. Used when the
// card already holds this exact pack: there is nothing to write but the folder
// should still be able to say what it is (the marker may have been deleted, the
// pack renamed, or the card written by something that never wrote one). The
// renderer passes the destination root; the target subfolder is resolved here
// so path construction stays on this side.
ipcMain.handle('common:writeMarker', (_, { uuid, destDir, targetName } = {}) => {
  try {
    if (!uuid || !destDir) return { ok: false, error: 'Missing uuid or destDir' };
    const target = path.join(destDir, targetName || 'common');
    if (!fs.existsSync(target)) return { ok: false, error: 'Destination folder not found' };
    return soundFontCommon.writeCommonReadme(app.getPath('userData'), uuid, target);
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:exportToFolder', async (event, { uuid, destDir, mode } = {}) => {
  try {
    const emit = _sfExportProgressEmitter(event);
    const r = await soundFontCommon.exportCommonToFolder(app.getPath('userData'), uuid, destDir, mode, emit.onBytes);
    emit.flush();
    return r;
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Resolve a flagged common folder's content hash — called from the
// renderer when the user navigates away from this common (select a
// different common, switch tabs, open a font detail). Mirrors the
// entry-side handler. No-op when not flagged dirty.
ipcMain.handle('common:resolveContentDirty', (_, { uuid } = {}) => {
  try {
    const hash = soundFontCommon.resolveCommonContentDirty(app.getPath('userData'), uuid);
    return { ok: true, rehashed: hash != null };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Group management — assign/unassign, rename across all members,
// delete (unsets group on every member). Group ORDER (drag-reorder of
// headers in the sidecar) is persisted as a renderer preference (see
// settings.soundFontGroupOrder), not in common meta.
ipcMain.handle('common:setGroup', (_, { uuid, groupName } = {}) => {
  try { return soundFontCommon.setCommonGroup(app.getPath('userData'), uuid, groupName); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('common:setGroupMany', (_, { uuids, groupName } = {}) => {
  try { return soundFontCommon.setCommonGroupMany(app.getPath('userData'), uuids, groupName); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('common:renameGroup', (_, { oldName, newName } = {}) => {
  try { return soundFontCommon.renameCommonGroup(app.getPath('userData'), oldName, newName); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('common:deleteGroup', (_, { name } = {}) => {
  try { return soundFontCommon.deleteCommonGroup(app.getPath('userData'), name); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// ── Shared Tracks folder IPC ──────────────────────────
// Single app-global folder that maps to /tracks/ at the SD card root —
// ProffieOS prop_base.h ListTracks scans /tracks/ as well as per-font
// /<font>/tracks/, so a top-level /tracks/ is the universal-tracks
// location that doesn't have to live inside a common folder.
ipcMain.handle('sharedTracks:exists', () => {
  try { return { ok: true, exists: soundFontSharedTracks.exists(app.getPath('userData')) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:create', () => {
  try { return soundFontSharedTracks.create(app.getPath('userData')); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:listFiles', () => {
  try { return { ok: true, files: soundFontSharedTracks.listFiles(app.getPath('userData')) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:addFiles', (_, { sourceFilePaths } = {}) => {
  try { return soundFontSharedTracks.addFiles(app.getPath('userData'), sourceFilePaths); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:renameFile', (_, { oldName, newName } = {}) => {
  try { return soundFontSharedTracks.renameFile(app.getPath('userData'), oldName, newName); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:deleteFile', (_, { name } = {}) => {
  try { return soundFontSharedTracks.deleteFile(app.getPath('userData'), name); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:delete', () => {
  try { return soundFontSharedTracks.deleteAll(app.getPath('userData')); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:folderExistsAt', (_, { destDir } = {}) => {
  try { return { ok: true, exists: soundFontSharedTracks.folderExistsAt(destDir) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:existsAt', (_, { destDir } = {}) => {
  try { return soundFontSharedTracks.existsAt(destDir); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:matchesAt', (_, { destDir } = {}) => {
  try { return soundFontSharedTracks.matchesAt(app.getPath('userData'), destDir); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
// Read-only: what would an export add, leave alone, or have to ask about.
// Top-level folder names at an export destination. Used by the save summary to
// answer "what else is on this card" without pulling in a full SD scan.
ipcMain.handle('soundFonts:entryMatchesAt', (_, { name, destDir } = {}) => {
  try { return soundFontEntries.entryMatchesAt(app.getPath('userData'), name, destDir); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('soundFonts:listDestFolders', (_, { destDir } = {}) => {
  try {
    if (!destDir || !fs.existsSync(destDir)) return { ok: true, folders: [] };
    const folders = fs.readdirSync(destDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);
    return { ok: true, folders };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:planExport', (event, { destDir } = {}) => {
  try {
    // Per-file ticks so the renderer can show names going past. Throttled: a
    // hundred-plus IPC sends in a tight loop would cost more than the hashing.
    let last = 0;
    const onFile = (file, done, total) => {
      const now = Date.now();
      if (now - last < 60 && done < total) return;
      last = now;
      try { event.sender.send('sharedTracks:planProgress', { file, done, total }); } catch {}
    };
    return soundFontSharedTracks.planExport(app.getPath('userData'), destDir, onFile);
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:exportToFolder', async (event, { destDir, mode, replace } = {}) => {
  try {
    const emit = _sfExportProgressEmitter(event);
    // Additive is the default for the bulk flow: nothing at the destination is
    // ever deleted, and a same-name file that differs is resolved per file by
    // `replace` (the renderer collects that from the differences dialog). The
    // older skip/replace/rename whole-folder modes stay reachable for callers
    // that still ask for them explicitly.
    const r = (!mode || mode === 'additive')
      ? await soundFontSharedTracks.exportToFolderAdditive(app.getPath('userData'), destDir, { replace, onBytes: emit.onBytes })
      : await soundFontSharedTracks.exportToFolder(app.getPath('userData'), destDir, mode, emit.onBytes);
    emit.flush();
    return r;
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sharedTracks:readFileBytes', (_, { name } = {}) => {
  try {
    const buf = soundFontSharedTracks.readFileBytes(app.getPath('userData'), name);
    if (!buf) return { ok: false, error: 'File not found' };
    return { ok: true, bytes: Array.from(buf) };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Voicepack catalog + downloader. First iteration: V1 packs from hubbe.net
// only. The catalog ships in the renderer at modal-open time; sample/install
// fetches happen on user action so we don't speculatively hit the network.
ipcMain.handle('voicepack:getCatalog', () => {
  try { return { ok: true, catalog: soundFontVoicepack.getCatalog() }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('voicepack:downloadSample', async (_, { id } = {}) => {
  try {
    const result = await soundFontVoicepack.downloadSample(id, app.getAppPath());
    if (!result.ok) return result;
    // Convert Buffer to ArrayBuffer-compatible payload for the renderer
    return { ok: true, bytes: Array.from(result.bytes) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('voicepack:install', async (_, { id } = {}) => {
  try {
    return await soundFontVoicepack.downloadAndInstall({ id, userData: app.getPath('userData') });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Export one or more files from any SF location to disk. Single-file
// mode pops a save dialog (user picks name + location); multi-file
// mode pops a folder picker and writes each file at the chosen folder
// with its original name, walking collisions through a " (N)" tail so
// nothing gets silently overwritten. Returns the list of written paths.
ipcMain.handle('sfFile:export', async (_, { kind, id, paths, suggestedName, asFile } = {}) => {
  // sharedTracks is the singleton flat folder — no id required. Every
  // other kind needs one.
  if (!kind || !Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'Missing kind/paths' };
  }
  if (kind !== 'sharedTracks' && !id) {
    return { ok: false, error: 'Missing id' };
  }
  const userData = app.getPath('userData');
  // Resolve bytes for a single FILE path. Reuses the existing kind-
  // aware byte readers — same code paths the doc viewer and audio
  // player use.
  const readBytes = async (subPath) => {
    if (kind === 'entry')  return soundFontEntries.readEntryFileBytes(userData, id, subPath);
    if (kind === 'common') return soundFontCommon.readCommonFileBytes(userData, id, subPath);
    if (kind === 'source') {
      const source = soundFontSources.openSource(userData, id);
      if (!source) throw new Error(`Source not found: ${id}`);
      return await source.readFile(subPath);
    }
    if (kind === 'sharedTracks') {
      const buf = soundFontSharedTracks.readFileBytes(userData, subPath);
      if (!buf) throw new Error(`File not found: ${subPath}`);
      return buf;
    }
    throw new Error(`Unknown kind: ${kind}`);
  };
  // Collision-safe target name inside a chosen destination folder.
  // Walks " (1)", " (2)"... until a free name is found so re-exports
  // never overwrite the user's existing copy.
  const uniqueIn = (dir, baseName) => {
    const direct = path.join(dir, baseName);
    if (!fs.existsSync(direct)) return direct;
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    let n = 1;
    while (true) {
      const cand = path.join(dir, `${stem} (${n})${ext}`);
      if (!fs.existsSync(cand)) return cand;
      n++;
    }
  };
  // Walk an inner-zip's central directory and return flat composite-pathed
  // entries matching the inside scope (everything under insidePath/, plus
  // the exact match if any). Used by isDirAtPath + writeDirTo to handle
  // composite paths like "Indara.zip/clash" — the outer zip's listAll
  // doesn't surface inner-zip contents, so we open it on the fly. Same
  // pattern as soundFontSources._resolveCompositeReadBytes but listing
  // instead of reading bytes. Composite path with no insidePath suffix
  // (just "Indara.zip") walks the inner zip's root.
  const _walkInnerZipForExport = async (sourceId, innerZipPath, insidePath) => {
    const source = soundFontSources.openSource(userData, sourceId);
    if (!source) return { exact: null, inside: [] };
    const innerBytes = await source.readFile(innerZipPath);
    const StreamZip = require('node-stream-zip');
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-export-inner-'));
    const tmpZip = path.join(tmpDir, 'inner.zip');
    try {
      fs.writeFileSync(tmpZip, innerBytes);
      const zip = new StreamZip.async({ file: tmpZip, skipEntryNameValidation: true });
      try {
        const entryMap = await zip.entries();
        const insidePrefix = insidePath
          ? (insidePath.endsWith('/') ? insidePath : insidePath + '/')
          : ''; // empty means "everything in the inner zip"
        let exact = null;
        const inside = [];
        for (const k of Object.keys(entryMap)) {
          const e = entryMap[k];
          if (!e.name || e.name === '/') continue;
          const flatName = e.name.replace(/\/+$/, '');
          const isDir = !!e.isDirectory || e.name.endsWith('/');
          const compositePath = `${innerZipPath}/${flatName}`;
          if (insidePath && flatName === insidePath) {
            exact = { fileName: compositePath, size: e.size || 0, isDir };
          }
          if (insidePrefix && flatName.startsWith(insidePrefix)) {
            inside.push({ fileName: compositePath, size: e.size || 0, isDir });
          } else if (!insidePath) {
            // Entire inner zip — every entry counts.
            inside.push({ fileName: compositePath, size: e.size || 0, isDir });
          }
        }
        return { exact, inside };
      } finally {
        await zip.close();
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  };
  // Match a composite source path: outer-side .zip + optional inside path.
  // Lazy match so "myname.zipfile" doesn't accidentally split on the .zip
  // (the lazy + matches the shortest prefix ending in .zip, then the
  // post-match anchors enforce that the whole input is matched cleanly).
  const _compositeMatch = (p) => (p.match(/^(.+?\.zip)(?:\/(.+))?$/i));
  // Probe whether a subPath inside the active location refers to a
  // directory. Source kind reads the archive listing; entry/common
  // resolve to disk. Composite paths (anything inside an inner zip)
  // peek through the inner zip's central directory.
  const isDirAtPath = async (subPath) => {
    if (kind === 'sharedTracks') return false; // flat folder, no subdirs
    if (kind === 'source') {
      const cm = _compositeMatch(subPath);
      if (cm) {
        const innerZipPath = cm[1];
        const insidePath = cm[2] || '';
        // An inner zip with no inside path (just "Indara.zip") IS a folder
        // semantically — it's how the file browser renders it via the
        // lazy-descent mark. Copy / export folder ops should walk its
        // contents. The "Export ZIP" affordance for raw-bytes export
        // lives on a separate menu item.
        if (!insidePath) return true;
        const { exact, inside } = await _walkInnerZipForExport(id, innerZipPath, insidePath);
        if (exact && exact.isDir) return true;
        return inside.length > 0;
      }
      const source = soundFontSources.openSource(userData, id);
      if (!source) return false;
      const all = await source.listAll();
      const exact = all.find(e => e.fileName === subPath);
      if (exact && exact.isDir) return true;
      const prefix = subPath.endsWith('/') ? subPath : subPath + '/';
      return all.some(e => e.fileName.startsWith(prefix));
    }
    const root = kind === 'entry'
      ? require('path').join(userData, 'soundFonts', 'library', id)
      : require('path').join(userData, 'soundFonts', 'common', id, 'files');
    const abs = require('path').join(root, subPath);
    try { return fs.statSync(abs).isDirectory(); } catch { return false; }
  };
  // Write a whole directory (source-side or on-disk) into outRoot,
  // preserving relative structure. Composite paths walk the inner zip.
  const writeDirTo = async (subPath, outRoot) => {
    if (!fs.existsSync(outRoot)) fs.mkdirSync(outRoot, { recursive: true });
    if (kind === 'source') {
      const cm = _compositeMatch(subPath);
      if (cm) {
        const innerZipPath = cm[1];
        const insidePath = cm[2] || '';
        const source = soundFontSources.openSource(userData, id);
        const { inside } = await _walkInnerZipForExport(id, innerZipPath, insidePath);
        const insidePrefix = insidePath
          ? (insidePath.endsWith('/') ? insidePath : insidePath + '/')
          : '';
        for (const entry of inside) {
          if (entry.isDir) continue;
          const innerFlat = entry.fileName.slice(innerZipPath.length + 1);
          const innerRel = insidePrefix ? innerFlat.slice(insidePrefix.length) : innerFlat;
          if (!innerRel) continue;
          const outPath = path.join(outRoot, innerRel.replace(/\//g, path.sep));
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          // source.readFile is composite-aware — entry.fileName carries the
          // full composite path, so the inner-zip layer gets peeled by the
          // resolver automatically.
          const buf = await source.readFile(entry.fileName);
          fs.writeFileSync(outPath, buf);
        }
        return;
      }
      const source = soundFontSources.openSource(userData, id);
      const all = await source.listAll();
      const prefix = subPath.endsWith('/') ? subPath : subPath + '/';
      for (const entry of all) {
        if (entry.isDir) continue;
        if (!entry.fileName.startsWith(prefix)) continue;
        const innerRel = entry.fileName.slice(prefix.length);
        if (!innerRel) continue;
        const outPath = path.join(outRoot, innerRel.replace(/\//g, path.sep));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const buf = await source.readFile(entry.fileName);
        fs.writeFileSync(outPath, buf);
      }
      return;
    }
    const root = kind === 'entry'
      ? path.join(userData, 'soundFonts', 'library', id)
      : path.join(userData, 'soundFonts', 'common', id, 'files');
    const srcAbs = path.join(root, subPath);
    const walk = (sd, dd) => {
      fs.mkdirSync(dd, { recursive: true });
      for (const ent of fs.readdirSync(sd, { withFileTypes: true })) {
        const s = path.join(sd, ent.name);
        const d = path.join(dd, ent.name);
        if (ent.isDirectory()) walk(s, d);
        else if (ent.isFile()) fs.copyFileSync(s, d);
      }
    };
    walk(srcAbs, outRoot);
  };
  const lastDir = Store.get('lastExportDir') || app.getPath('downloads');
  // Single-path mode: file → save dialog; folder → folder picker,
  // writes the folder inside the chosen parent with its original name.
  if (paths.length === 1) {
    const subPath = paths[0];
    const baseName = suggestedName || subPath.split('/').pop() || 'untitled';
    // asFile=true short-circuits the dir probe — used by "Export ZIP…"
    // on an inner-zip node, where the user wants the raw .zip bytes
    // exported as a standalone file rather than the contents extracted.
    // Same path is conceptually both (file-of-bytes + folder-of-contents)
    // so the caller picks which semantics with this flag.
    const isDir = asFile ? false : await isDirAtPath(subPath);
    if (isDir) {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: `Export "${baseName}" folder to…`,
        defaultPath: lastDir,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (canceled || !filePaths?.length) return { ok: false, canceled: true };
      const parent = filePaths[0];
      try {
        // Folder collision in chosen parent → walk " (N)" suffix
        // (matches the copy-paste convention for dirs).
        let finalName = baseName;
        if (fs.existsSync(path.join(parent, finalName))) {
          let n = 1;
          while (fs.existsSync(path.join(parent, `${baseName} (${n})`))) n++;
          finalName = `${baseName} (${n})`;
        }
        const outRoot = path.join(parent, finalName);
        await writeDirTo(subPath, outRoot);
        Store.set('lastExportDir', parent);
        return { ok: true, written: [outRoot] };
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
      }
    }
    const ext = path.extname(baseName).replace(/^\./, '') || '*';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export file',
      defaultPath: path.join(lastDir, baseName),
      filters: ext === '*'
        ? [{ name: 'All files', extensions: ['*'] }]
        : [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      const buf = await readBytes(subPath);
      fs.writeFileSync(filePath, buf);
      Store.set('lastExportDir', path.dirname(filePath));
      return { ok: true, written: [filePath] };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }
  // Multi-path → pick a destination folder. Files write with their
  // original names + " (N)" collision suffix. Folders write as named
  // subfolders inside the chosen destination, recursively.
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Export to folder',
    defaultPath: lastDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };
  const destDir = filePaths[0];
  const written = [];
  const failed = [];
  for (const subPath of paths) {
    try {
      const baseName = subPath.split('/').pop() || 'untitled';
      const isDir = await isDirAtPath(subPath);
      if (isDir) {
        let finalName = baseName;
        if (fs.existsSync(path.join(destDir, finalName))) {
          let n = 1;
          while (fs.existsSync(path.join(destDir, `${baseName} (${n})`))) n++;
          finalName = `${baseName} (${n})`;
        }
        const outRoot = path.join(destDir, finalName);
        await writeDirTo(subPath, outRoot);
        written.push(outRoot);
      } else {
        const buf = await readBytes(subPath);
        const out = uniqueIn(destDir, baseName);
        fs.writeFileSync(out, buf);
        written.push(out);
      }
    } catch (err) {
      failed.push({ source: subPath, error: String(err && err.message || err) });
    }
  }
  Store.set('lastExportDir', destDir);
  return { ok: true, written, failed };
});

// Batched sha256 hashing of a set of files for one (kind, id). The
// renderer uses this from the library picker to detect "this file
// already exists in the destination entry" without false positives
// from name collisions across different fonts. Source-kind opens the
// archive once for the whole batch instead of per-path so a folder of
// 100 wavs doesn't pay 100 zip-open round-trips.
ipcMain.handle('hash:files', async (_, { kind, id, paths } = {}) => {
  if (!kind || !id || !Array.isArray(paths)) return { ok: false, error: 'Missing kind/id/paths' };
  const userData = app.getPath('userData');
  const out = [];
  const hashBuf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  if (kind === 'entry') {
    for (const subPath of paths) {
      try {
        const buf = soundFontEntries.readEntryFileBytes(userData, id, subPath);
        out.push({ subPath, sha256: hashBuf(buf) });
      } catch (err) {
        out.push({ subPath, error: String(err && err.message || err) });
      }
    }
  } else if (kind === 'common') {
    for (const subPath of paths) {
      try {
        const buf = soundFontCommon.readCommonFileBytes(userData, id, subPath);
        out.push({ subPath, sha256: hashBuf(buf) });
      } catch (err) {
        out.push({ subPath, error: String(err && err.message || err) });
      }
    }
  } else if (kind === 'source') {
    // Open once, reuse for the whole batch — avoids re-parsing the zip
    // central directory per file when the batch is large.
    const source = soundFontSources.openSource(userData, id);
    if (!source) return { ok: false, error: `Source not found: ${id}` };
    for (const subPath of paths) {
      try {
        const buf = await source.readFile(subPath);
        out.push({ subPath, sha256: hashBuf(buf) });
      } catch (err) {
        out.push({ subPath, error: String(err && err.message || err) });
      }
    }
  } else {
    return { ok: false, error: `Unknown kind: ${kind}` };
  }
  return { ok: true, hashes: out };
});

// ─── SF Library Backup ────────────────────────────────────
// Survey + benchmark run together as the "prep" phase. The renderer uses
// these to populate the confirm dialog with counts/size/estimated time
// BEFORE committing to a destination, so the user can bail cheaply if the
// estimate looks wrong.
ipcMain.handle('sfBackup:prep', async () => {
  // Survey only — earlier iterations benchmarked the destination drive
  // and produced a time estimate, but the benchmark (a single large
  // contiguous write of zeros) doesn't model the real workload (many
  // small file reads + compression + streaming writes), so the estimate
  // was misleading. Better to show nothing than wrong numbers; the
  // progress bar + elapsed time during the run is honest information.
  try {
    const userData = app.getPath('userData');
    const survey = soundFontBackup.surveyLibrary(userData);
    return { ok: true, survey };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('dialog:selectBackupExportPath', async () => {
  const lastDir = Store.get('lastSfBackupDir') || Store.get('lastDir') || app.getPath('documents');
  const defaultName = soundFontBackup.suggestedFileName();
  // On Windows the native COM save dialog always shows its own
  // overwrite-confirm and Electron has no option to suppress it
  // (showOverwriteConfirmation is macOS/Linux only). So we lean on the
  // native prompt and skip our own in the renderer — adding ours on top
  // would surface as a double-prompt.
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export Sound Font library backup',
    defaultPath: path.join(lastDir, defaultName),
    filters: [
      { name: 'JMT Studio Sound Font library backup', extensions: ['zip'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { ok: false };
  Store.set('lastSfBackupDir', path.dirname(filePath));
  return { ok: true, filePath };
});

// In-flight export controller — keyed by opId so multiple sessions in
// theory can coexist, but the renderer only runs one at a time. Cancel
// fires the AbortController; the backup module's signal listener wipes
// the partial file before throwing.
const _sfBackupOps = new Map();
ipcMain.handle('sfBackup:export', async (event, { opId, destPath } = {}) => {
  if (!opId || !destPath) return { ok: false, error: 'Missing opId or destPath' };
  if (_sfBackupOps.has(opId)) return { ok: false, error: 'Op already running' };
  const controller = new AbortController();
  _sfBackupOps.set(opId, controller);
  try {
    const prefs = {
      // setSetting writes under "settings.<key>" — match the renderer's
      // storage path or this comes back undefined and the manifest ships
      // with an empty starredCommon even when one is set.
      starredCommon: Store.get('settings.soundFontStarredCommon') || '',
    };
    const result = await soundFontBackup.exportBackup({
      userData: app.getPath('userData'),
      destPath,
      appVersion: app.getVersion(),
      prefs,
      signal: controller.signal,
      onProgress: (p) => {
        try { event.sender.send('sfBackup:progress', { opId, ...p }); } catch {}
      },
    });
    return { ok: true, destPath: result.destPath, manifest: result.manifest };
  } catch (err) {
    if (err && err.cancelled) return { ok: false, cancelled: true, residualPath: err.residualPath || null };
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    _sfBackupOps.delete(opId);
  }
});

ipcMain.handle('sfBackup:cancel', (_, { opId } = {}) => {
  const controller = _sfBackupOps.get(opId);
  if (!controller) return { ok: false, error: 'No such op' };
  try { controller.abort(); } catch {}
  return { ok: true };
});

ipcMain.handle('dialog:selectBackupImportPath', async () => {
  const lastDir = Store.get('lastSfBackupDir') || Store.get('lastDir') || app.getPath('documents');
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import Sound Font library backup',
    defaultPath: lastDir,
    properties: ['openFile'],
    filters: [
      { name: 'JMT Studio Sound Font library backup', extensions: ['zip'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { ok: false };
  Store.set('lastSfBackupDir', path.dirname(filePaths[0]));
  return { ok: true, filePath: filePaths[0] };
});

ipcMain.handle('sfBackup:inspect', async (_, { zipPath } = {}) => {
  try { return await soundFontBackup.inspectBackup(zipPath); }
  catch (err) { return { ok: false, reason: 'unknown', error: String(err && err.message || err) }; }
});

// Replace-import: pre-wipe snapshot + extract + commit-or-rollback. Reuses
// the export op map for cancellation since opIds are unique strings; the
// inner module handles snapshot/rollback so this handler just plumbs IPC.
ipcMain.handle('sfBackup:surveyMerge', async (_, { zipPath } = {}) => {
  try {
    return await soundFontBackup.surveyMerge({
      userData: app.getPath('userData'),
      zipPath,
    });
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('sfBackup:applyMerge', async (event, { opId, zipPath, plan } = {}) => {
  if (!opId || !zipPath) return { ok: false, error: 'Missing opId or zipPath' };
  if (_sfBackupOps.has(opId)) return { ok: false, error: 'Op already running' };
  const controller = new AbortController();
  _sfBackupOps.set(opId, controller);
  try {
    const result = await soundFontBackup.applyMerge({
      userData: app.getPath('userData'),
      zipPath,
      plan: plan || { sources: {}, library: {}, common: {} },
      signal: controller.signal,
      onProgress: (p) => {
        try { event.sender.send('sfBackup:progress', { opId, ...p }); } catch {}
      },
    });
    // Merge doesn't auto-apply starredCommon — the user keeping their
    // current library implies keeping their current default. (Replace
    // does apply it; that path is for "wipe and restore exactly.")
    return { ok: true, manifest: result.manifest, counts: result.counts };
  } catch (err) {
    if (err && err.cancelled) return { ok: false, cancelled: true };
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    _sfBackupOps.delete(opId);
  }
});

ipcMain.handle('sfBackup:applyReplace', async (event, { opId, zipPath } = {}) => {
  if (!opId || !zipPath) return { ok: false, error: 'Missing opId or zipPath' };
  if (_sfBackupOps.has(opId)) return { ok: false, error: 'Op already running' };
  const controller = new AbortController();
  _sfBackupOps.set(opId, controller);
  try {
    const result = await soundFontBackup.applyReplace({
      userData: app.getPath('userData'),
      zipPath,
      signal: controller.signal,
      onProgress: (p) => {
        try { event.sender.send('sfBackup:progress', { opId, ...p }); } catch {}
      },
    });
    // Apply manifest-borne library settings (currently just starredCommon).
    // Skipped silently if the manifest is missing or doesn't have settings.
    const m = result && result.manifest;
    if (m && m.settings && typeof m.settings.starredCommon === 'string') {
      Store.set('settings.soundFontStarredCommon', m.settings.starredCommon);
    }
    return { ok: true, manifest: m, counts: result && result.counts };
  } catch (err) {
    if (err && err.cancelled) return { ok: false, cancelled: true };
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    _sfBackupOps.delete(opId);
  }
});

// Pick wav files to add into a common folder. Multi-select on by default;
// filtered to .wav and "all files" so users can still import oddly-named
// audio files the OS doesn't tag with .wav.
ipcMain.handle('dialog:selectCommonFiles', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Add files to common folder',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: ['wav'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, filePaths: result.filePaths };
});

// Pick a folder OR zip as the source for an "Import common folder" action.
// Mode is the same shape as dialog:selectSoundFontSource — folder vs file
// can't co-exist in one dialog on Windows/Linux.
ipcMain.handle('dialog:selectCommonSource', async (_, { mode = 'folder' } = {}) => {
  const opts = {
    title: mode === 'zip' ? 'Pick a voicepack zip' : 'Pick a folder containing common wav files',
  };
  if (mode === 'zip') {
    opts.properties = ['openFile'];
    opts.filters = [{ name: 'Zip files', extensions: ['zip'] }];
  } else {
    opts.properties = ['openDirectory'];
  }
  const result = await dialog.showOpenDialog(win, opts);
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, filePath: result.filePaths[0] };
});

ipcMain.handle('sources:exportToDownloads', async (event, { uuid, destDir, format } = {}) => {
  try {
    const source = soundFontSources.openSource(app.getPath('userData'), uuid);
    if (!source) return { ok: false, error: `Source not found: ${uuid}` };
    // Use Electron's resolved downloads path so relocated Known Folders on
    // Windows (e.g. D:\Downloads) are respected; falls through to system
    // defaults on Mac/Linux.
    const target = destDir || app.getPath('downloads');
    // Forward the export's cumulative progress snapshots (phase, bytes, current
    // file) to the renderer, throttled to ~80ms so a multi-GB reconstruction
    // doesn't flood IPC. These are snapshots, not byte deltas — send the latest.
    let lastSent = 0, pending = null;
    const onProgress = (p) => {
      pending = p;
      const now = Date.now();
      if (now - lastSent >= 80) {
        lastSent = now;
        try { event.sender.send('soundFonts:sourceExportProgress', pending); } catch {}
        pending = null;
      }
    };
    const result = await source.exportToDownloads(target, { format, onProgress });
    if (pending) { try { event.sender.send('soundFonts:sourceExportProgress', pending); } catch {} }
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Open a folder picker for source-export workflows. Returns the chosen
// path without running an export, so callers that need to export many
// sources to the same destination (bulk delete with "Export sources
// first") can pick once and then drive multiple exports. Remembers the
// last chosen dir.
ipcMain.handle('dialog:pickExportDir', async (_, { title } = {}) => {
  try {
    const lastDir = Store.get('lastExportDir') || app.getPath('downloads');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: title || 'Choose export destination…',
      defaultPath: lastDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    Store.set('lastExportDir', filePaths[0]);
    return { ok: true, destDir: filePaths[0] };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});


// Import-from-link: peel a purchase/receipt URL down to a font archive and
// download it to a temp file, streaming honest byte progress to the renderer.
// On success the renderer hands the temp path to sources:import like any zip.
ipcMain.handle('linkImport:start', async (event, { url } = {}) => {
  const os = require('os');
  const fsL = require('fs');
  const pathL = require('path');
  const send = (payload) => { try { event.sender.send('linkImport:progress', payload); } catch {} };
  let last = 0;
  const onProgress = (received, total) => {
    const now = Date.now();
    if (now - last >= 150 || (total && received >= total)) { last = now; send({ received, total }); }
  };
  try {
    // No destDir here on purpose: resolve() creates the temp dir lazily, only
    // when it actually has an archive to download. A failed fetch (gated, error)
    // leaves nothing behind.
    return await soundFontLinkImport.resolve(url, { onProgress });
  } catch (e) {
    return { ok: false, reason: 'error', message: String(e && e.message || e) };
  }
});

// Tier 2: open the link in a real in-app browser window (Chromium, with a
// persistent session so vendor logins carry over). The user clicks the vendor's
// own Download button; we intercept the session's will-download, stream honest
// byte progress, save to a temp file, and resolve with its path. Closing the
// window without downloading cancels. This covers OneDrive / KSith / login-gated
// vendors the headless peeler can't reach.
ipcMain.handle('linkImport:browser', async (event, { url, autoHidden } = {}) => {
  const os = require('os');
  const fsL = require('fs');
  const pathL = require('path');
  const { BrowserWindow, session } = require('electron');
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, message: 'Bad link.' };
  // Created lazily when a download actually starts, so a canceled window (no
  // download) leaves no empty temp dir behind.
  let destDir = null;
  const send = (payload) => { try { event.sender.send('linkImport:progress', payload); } catch {} };
  const ses = session.fromPartition('persist:jmt-linkimport');
  return await new Promise((resolve) => {
    let settled = false;
    let gotDownload = false;
    let bw = null;
    const onWillDownload = (_e, item) => {
      gotDownload = true;
      if (!destDir) {
        try { destDir = fsL.mkdtempSync(pathL.join(os.tmpdir(), 'jmt-linkimport-')); }
        catch (e) { finish({ ok: false, message: String(e && e.message || e) }); return; }
      }
      const name = (item.getFilename() || 'sound-font.zip').replace(/[<>:"|?*\x00-\x1f]/g, '_');
      const destPath = pathL.join(destDir, name);
      item.setSavePath(destPath);
      // The download is captured and continues in the background — hide the
      // window now (don't close: that could abort the download) so the user
      // sees the import progress modal instead of a window covering it.
      try { if (bw && !bw.isDestroyed()) bw.hide(); } catch {}
      let last = 0;
      item.on('updated', (__e, state) => {
        if (state !== 'progressing') return;
        const now = Date.now();
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        if (now - last >= 150 || (total && received >= total)) { last = now; send({ received, total }); }
      });
      item.once('done', async (__e, state) => {
        // We have the raw file (or a failure). Close the browser window now so a
        // follow-on download (peeling a captured .txt/.rtf pointer) runs clean.
        try { if (bw && !bw.isDestroyed()) bw.close(); } catch {}
        if (state !== 'completed') { finish({ ok: false, message: `The download ${state}.` }); return; }
        try {
          // A gated download may hand back a .txt/.rtf pointer, not the archive —
          // peel it the same way the headless resolver does.
          const r = await soundFontLinkImport.resolveLocalFile(destPath, {
            destDir,
            onProgress: (received, total) => { const now = Date.now(); if (now - last >= 150 || (total && received >= total)) { last = now; send({ received, total }); } },
          });
          finish(r && r.ok ? { ok: true, filePath: r.filePath, fileName: r.fileName } : { ok: false, message: (r && r.message) || 'That download could not be imported.' });
        } catch (e) { finish({ ok: false, message: String(e && e.message || e) }); }
      });
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { ses.removeListener('will-download', onWillDownload); } catch {}
      try { if (bw && !bw.isDestroyed()) bw.destroy(); } catch {}
      resolve(result);
    };
    ses.on('will-download', onWillDownload);
    bw = new BrowserWindow({
      parent: win,
      width: 1040, height: 780,
      show: !autoHidden,
      title: 'Download your font from the vendor',
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:jmt-linkimport', sandbox: true },
    });
    // Auto-hidden mode: we already have the vendor's session cookies, so try to
    // let the download fire with no window at all. If instead a PAGE finishes
    // loading (a login screen, or a page that needs a click) and no download has
    // started, reveal the window so the user can finish — and tell the renderer.
    if (autoHidden) {
      bw.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          if (!settled && !gotDownload && bw && !bw.isDestroyed() && !bw.isVisible()) {
            try { bw.show(); } catch {}
            send({ browserShown: true });
          }
        }, 2500);
      });
    }
    // If the page itself comes back as an HTTP error (e.g. Cloudflare 522 when
    // the vendor's origin is down), don't strand the user on the error page —
    // fail with a plain, retryable message.
    bw.webContents.on('did-navigate', (_e, _navUrl, httpResponseCode) => {
      if (!gotDownload && httpResponseCode && httpResponseCode >= 400) {
        finish({ ok: false, message: `The vendor site returned an error (HTTP ${httpResponseCode}). It may be temporarily down; try again in a few minutes.` });
      }
    });
    // A download link that opens via target=_blank / window.open: load it in the
    // same window so its download still fires on our session.
    bw.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      try { if (popupUrl) bw.loadURL(popupUrl); } catch {}
      return { action: 'deny' };
    });
    bw.on('closed', () => { if (!gotDownload) finish({ ok: false, canceled: true }); });
    bw.loadURL(url).catch(() => {});
  });
});

// Delete a link-import temp dir once the source has been copied into the library
// store, so a downloaded zip (and any .txt/.rtf pointer) never lingers as a
// duplicate. Guarded to only ever remove our own jmt-linkimport-* temp dirs.
ipcMain.handle('linkImport:cleanup', (_, { filePath } = {}) => {
  const os = require('os');
  const fsL = require('fs');
  const pathL = require('path');
  try {
    if (!filePath) return { ok: false };
    const dir = pathL.dirname(filePath);
    if (pathL.basename(dir).startsWith('jmt-linkimport-') && dir.startsWith(os.tmpdir())) {
      fsL.rmSync(dir, { recursive: true, force: true });
      return { ok: true };
    }
    return { ok: false };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// Guided bulk review duplicate recognition: a source that dodges the
// whole-source dedup (edited or partial copy — files deleted on a card, a
// tweaked quote) but whose CONTENT matches a library font must still surface.
// Folder shapes match straight off the disk via the selective hasher (core
// sounds only, skips tracks/large files); staged zips go through their
// manifest. Returns only rows with something to say.
ipcMain.handle('bulkImport:matchGuided', async (_event, { sources } = {}) => {
  if (!Array.isArray(sources) || !sources.length) return { ok: true, results: [] };
  try {
    const ud = app.getPath('userData');
    const compare = require('./soundFontCompare');
    const { index } = compare.buildLibraryIndex(ud);
    if (!index.length) return { ok: true, results: [] };
    const fsg = require('fs');
    const results = [];
    for (const s of sources) {
      if (!s) continue;
      let m = null;
      try {
        if (s.absPath && fsg.existsSync(s.absPath) && fsg.statSync(s.absPath).isDirectory()) {
          // 200MB cap, not the default 20MB: the ownership claim counts tracks,
          // and the library holds ~48 track wavs in the 20-60MB band that the
          // default would leave invisible. One card's worth of big tracks costs
          // seconds; the tight default exists for whole-library scans, not this.
          const sets = compare.buildFontSetsFromDir(s.absPath, { maxFileBytes: 200 * 1024 * 1024 });
          if (sets && sets.core.size) m = compare.matchAgainstLibrary(sets, index);
        } else if (s.preparedUuid) {
          const mf = await soundFontSources.ensureSourceManifest(ud, s.preparedUuid);
          if (mf && Array.isArray(mf.records)) m = compare.matchCandidateAgainstLibrary(mf.records, '', index);
        }
      } catch {}
      if (!m || !m.bestMatch) continue;
      const label = (m.verdict === 'variant' && m.coreContainment < compare.VARIANT_DISPLAY_MIN)
        ? null
        : compare.verdictLabel(m);
      if (!label) continue;
      results.push({ idx: s.idx, verdict: m.verdict, label, tip: compare.verdictTip(m), fullyOwned: compare.isFullyOwned(m), matchName: m.bestMatch });
    }
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Build (or twin-seed) a source's per-file manifest with progress on the
// import channel — the "Checking your library…" stage between copy and review.
// Byte-identical re-imports seed from their twin and return instantly; fresh
// sources pay the catalog HERE (with an honest bar) instead of silently after
// the review screen, so duplicate-recognition notes are ready when it opens
// and the later Optimize step skips its Cataloging section entirely.
ipcMain.handle('sources:ensureManifest', async (event, { uuid } = {}) => {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const send = (p) => { try { event.sender.send('sources:importProgress', p); } catch {} };
  let last = 0;
  try {
    const r = await soundFontSources.ensureSourceManifest(app.getPath('userData'), uuid, (p) => {
      const now = Date.now();
      if (now - last < 100) return;
      last = now;
      send({
        stage: 'checking',
        percent: p.totalBytes ? Math.floor(((p.bytesDone || 0) / p.totalBytes) * 100) : 0,
        bytes: p.bytesDone,
        totalBytes: p.totalBytes,
        currentFile: p.currentFile,
      });
    });
    return { ok: !!r };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Duplicate recognition for the import review (three scenarios, one matcher):
// ensure the source's per-file manifest (which also pre-warms the optimize
// step's cataloging pass), build the library index from the persisted entry
// manifests, and match each candidate. Returns only candidates with something
// worth saying — a have-it verdict, or a variant at/above the display bar —
// with the plain-language label prebuilt.
ipcMain.handle('sources:matchCandidates', async (_event, { uuid, candidates } = {}) => {
  if (!uuid || !Array.isArray(candidates)) return { ok: false, error: 'Missing uuid/candidates' };
  try {
    const ud = app.getPath('userData');
    const compare = require('./soundFontCompare');
    const mf = await soundFontSources.ensureSourceManifest(ud, uuid);
    if (!mf || !Array.isArray(mf.records)) return { ok: true, results: [] };
    const { index } = compare.buildLibraryIndex(ud);
    if (!index.length) return { ok: true, results: [] };
    const results = [];
    for (const c of candidates) {
      if (!c || c.path == null) continue;
      const m = compare.matchCandidateAgainstLibrary(mf.records, c.path, index);
      if (!m || !m.bestMatch) continue;
      const label = (m.verdict === 'variant' && m.coreContainment < compare.VARIANT_DISPLAY_MIN)
        ? null
        : compare.verdictLabel(m);
      if (!label) continue;
      results.push({ name: c.name, path: c.path, verdict: m.verdict, exact: !!m.exact, label, tip: compare.verdictTip(m), fullyOwned: compare.isFullyOwned(m), matchName: m.bestMatch });
    }
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Finalize a source STAGED by the folder-duplicate path (see importSource's
// folder branch): the zip is already built and hashed; this just writes meta.
// Used by the duplicate prompt's "import again as a new source" so a folder
// re-import doesn't redo the whole zip-transform.
ipcMain.handle('sources:finalizeStaged', async (_event, staged = {}) => {
  try {
    return await soundFontSources.finalizePreparedSource({
      userData: app.getPath('userData'),
      uuid: staged.uuid,
      format: staged.format,
      name: staged.name,
      hash: staged.hash,
      fileSize: staged.fileSize,
      sourceFileDate: staged.sourceFileDate,
      sourceFileMtimeMs: staged.sourceFileMtimeMs,
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('sources:import', async (event, { sourcePath, originalName, metadata, forceNewSource, knownHash } = {}) => {
  const send = (payload) => {
    try { event.sender.send('sources:importProgress', payload); } catch {}
  };
  try {
    return await soundFontSources.importSource({
      userData: app.getPath('userData'),
      sourcePath,
      originalName,
      metadata,
      forceNewSource,
      knownHash,
      onProgress: send,
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// Optimize a source: build its per-file manifest then intra-source dedup it (§13).
// SYNCHRONOUS — awaits completion so the caller knows it's done (no background lag, no
// stale-cache indicator). The single-file import path calls this from the renderer after
// commit; idempotent + verify-before-commit; single-format zips and folder sources are a
// no-op. Returns the dedup result.
ipcMain.handle('sources:optimize', async (event, { uuid } = {}) => {
  if (!uuid) return { ok: false, error: 'Missing uuid' };
  const ud = app.getPath('userData');
  // Forward the dedup's progress (throttled) so "Optimizing storage…" shows real
  // work instead of a bar frozen full from the copy phase before it.
  let lastSent = 0, pending = null;
  const onProgress = (p) => {
    pending = p;
    const now = Date.now();
    if (now - lastSent >= 80) { lastSent = now; try { event.sender.send('soundFonts:optimizeProgress', pending); } catch {} pending = null; }
  };
  try {
    await soundFontSources.ensureSourceManifest(ud, uuid, onProgress);
    const r = await soundFontSources.dedupeSource(ud, uuid, onProgress);
    if (pending) { try { event.sender.send('soundFonts:optimizeProgress', pending); } catch {} }
    return { ok: true, ...(r || {}) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

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
    const hasUpdate = _semverGt(latestVersion, currentVersion);
    let asset;
    if (process.platform === 'win32') {
      asset = (release.assets || []).find(a => a.name.endsWith('.exe'));
    } else if (process.platform === 'darwin') {
      if (process.arch === 'arm64') {
        asset = (release.assets || []).find(a => a.name.endsWith('-arm64.dmg'));
      } else {
        asset = (release.assets || []).find(a => a.name.endsWith('.dmg') && !a.name.includes('arm64'));
      }
    } else {
      asset = (release.assets || []).find(a => a.name.endsWith('.AppImage'));
    }
    const result = {
      ok: true,
      hasUpdate,
      currentVersion,
      latestVersion,
      platform:     process.platform,
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

// ── Port polling ───────────────────────────────────────
// Cheap SerialPort.list() every 4.5s; only fires the expensive arduino-cli
// call (via renderer refreshPorts) when the port path set actually changes.
// Polls only when config tab is active AND window is focused.
let _portPollTimer    = null;
let _portPollBusy     = false;
let _lastPortPaths    = null;
// Defaults to true because the renderer starts on the config tab — `switchTab`
// only fires when the user CHANGES tabs, so without this default the flag stays
// false until the user navigates away and back. Then the first blur→focus cycle
// leaves polling permanently off (the focus handler is gated by this flag).
let _portPollingWanted = true;

ipcMain.on('ports:setPolling', (_, enabled) => {
  _portPollingWanted = enabled;
  if (enabled) { startPortPolling(); _pollPortsNow(); }
  else stopPortPolling();
});

// On Linux, libudev (which serialport uses) has a settle gap after USB
// attach — the kernel creates /dev/ttyACM* but libudev's published list lags
// by several seconds. Polling SerialPort.list() alone catches removal
// promptly but misses insertion until libudev catches up. Cheap sysfs scan
// for Proffieboard VID 1209 closes that gap: the kernel populates
// /sys/bus/usb/devices/*/idVendor the instant the device attaches, before
// any userspace settle. Returns the count so a 0→1 transition (or back)
// flips the change signature even when SerialPort.list() hasn't updated.
function _countLinuxProffieUsb() {
  if (process.platform !== 'linux') return 0;
  try {
    const fs = require('fs');
    const base = '/sys/bus/usb/devices';
    let count = 0;
    for (const dev of fs.readdirSync(base)) {
      try {
        const v = fs.readFileSync(`${base}/${dev}/idVendor`, 'utf8').trim();
        if (v === '1209') count++;
      } catch {}
    }
    return count;
  } catch { return 0; }
}

async function _pollPortsNow() {
  if (_portPollBusy) return;
  _portPollBusy = true;
  try {
    const { SerialPort } = require('serialport');
    const raw   = await SerialPort.list();
    const paths = raw.map(p => p.path).sort().join('\0');
    const sig   = `${paths}|${_countLinuxProffieUsb()}`;
    if (_lastPortPaths === null) {
      _lastPortPaths = sig;
      return;
    }
    if (sig !== _lastPortPaths) {
      _lastPortPaths = sig;
      if (win && !win.isDestroyed()) win.webContents.send('ports:changed');
    }
  } catch {}
  finally { _portPollBusy = false; }
}

function startPortPolling() {
  if (_portPollTimer) return;
  _portPollTimer = setInterval(() => _pollPortsNow(), 4500);
}

function stopPortPolling() {
  if (_portPollTimer) {
    clearInterval(_portPollTimer);
    _portPollTimer = null;
  }
}

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

// ── IPC: Serial Monitor ────────────────────────────────
// One open SerialPort instance at a time, exposed to the renderer's serial
// monitor pane. Renderer drives open / close / write; main forwards 'data'
// chunks and unexpected 'close' / 'error' events. Flash auto-pauses by calling
// `serial:close` (renderer owns the policy — main just honours requests).
let _serialMonitorPort = null;

function _broadcastSerial(channel, payload) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  });
}

function _closeSerialMonitor() {
  if (!_serialMonitorPort) return;
  try { _serialMonitorPort.removeAllListeners(); } catch {}
  try {
    if (_serialMonitorPort.isOpen) _serialMonitorPort.close();
  } catch {}
  _serialMonitorPort = null;
}

ipcMain.handle('serial:open', async (_, { port, baudRate }) => {
  if (!port) return { ok: false, error: 'No port specified' };
  await _abortVersionProbe?.();  // the monitor owns the port; a probe must not block it
  _closeSerialMonitor();
  try {
    const { SerialPort } = require('serialport');
    const sp = new SerialPort({
      path: port,
      baudRate: baudRate || 115200,
      autoOpen: false,
    });
    await new Promise((resolve, reject) => {
      sp.open(err => err ? reject(err) : resolve());
    });
    _serialMonitorPort = sp;
    sp.on('data', chunk => {
      _broadcastSerial('serial:data', { text: chunk.toString('utf8') });
    });
    sp.on('close', () => {
      // Could be intentional (we asked) or external (board unplugged). Either
      // way, clear the ref and notify renderer so its UI updates.
      _serialMonitorPort = null;
      _broadcastSerial('serial:closed', { reason: 'close' });
    });
    sp.on('error', err => {
      _broadcastSerial('serial:closed', { reason: 'error', error: err.message });
      _closeSerialMonitor();
    });
    return { ok: true, port, baudRate: baudRate || 115200 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('serial:close', async () => {
  _closeSerialMonitor();
  return { ok: true };
});

ipcMain.handle('serial:write', async (_, { text }) => {
  if (!_serialMonitorPort || !_serialMonitorPort.isOpen) {
    return { ok: false, error: 'Port not open' };
  }
  return await new Promise(resolve => {
    _serialMonitorPort.write(text, err => {
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true });
    });
  });
});

ipcMain.handle('serial:isOpen', () => {
  return { ok: true, isOpen: !!(_serialMonitorPort && _serialMonitorPort.isOpen) };
});

/**
 * Asks a connected board what ProffieOS it is running, via the firmware's own
 * `version` command. Read-only and short-lived: open, ask, close.
 *
 * Deliberate limits:
 *  - 115200 only. Opening a Proffieboard's CDC port at 1200 baud is the
 *    bootloader-entry touch; probing must never risk knocking a board into DFU.
 *  - If the Serial Monitor already owns the port we decline rather than fight
 *    for it. Windows CDC is exclusive, and stealing it would also dump our
 *    query into the user's monitor window.
 *  - Every exit path closes the port, including the timeout.
 *
 * Never throws. A board that is busy, asleep, or flooding output just yields
 * ok:false, and the caller shows nothing.
 */
// Set while a version probe holds a port. A flash needs that same port, and the
// probe is never important enough to make one wait, let alone fail.
let _abortVersionProbe = null;

// Pulls the OS version out of a board's serial output. Exported for tests.
//
// Two accepted shapes, both deliberately narrow. ProffieOS answers `version`
// with the version alone on one line, immediately followed by CONFIG_FILE —
// so requiring that trailing `.h` line is what keeps a bare number from the
// board's ordinary chatter (a `3.85` battery reading, a preset index) from
// being mistaken for a version. The boot banner is accepted too, since a board
// that just enumerated may print it before our command lands.
function parseBoardVersion(buf) {
  // The suffix class has to allow `.` for point releases (8.10.1), which means it
  // also swallows sentence punctuation: a banner reading "Welcome to ProffieOS
  // v6.9." captured "6.9." and produced "v6.9.". Nothing equals that. The value is
  // compared against each installed tree's own version string, so one stray
  // character turns a matching board and tree into a mismatch - a red OS Version
  // field, and (once B-183 landed) "No installed version is v6.9.." printed over a
  // v6.9 tree sitting right there in the list. A trailing separator is never part
  // of a version, so it is stripped rather than excluded from the class.
  // (Found on Ryan's board 2026-08-19; every fixture here had used a banner with
  // no trailing period, which is why it survived.)
  const trim = v => v.replace(/[.\-]+$/, '');
  const banner = buf.match(/Welcome to ProffieOS\s+v?(\d+\.\d+[\w.\-]*)/i);
  if (banner) return 'v' + trim(banner[1]);
  // The follower line is what separates a real answer from the board's ordinary
  // chatter, and there is MORE THAN ONE SHAPE OF IT. 8.10 answers
  //   v8.10 / my_config.h / prop: ... — hence the original `.h` requirement.
  // 6.9 answers
  //   v6.9 / Installed: Aug 19 2026 10:29:12
  // with no CONFIG_FILE line at all, so the `.h` test rejected a correct reply and
  // the probe timed out with the answer sitting in the buffer. On 6.9 that left the
  // boot banner as the only path that ever worked, which is why detection succeeded
  // right after a flash or a power cycle and never again. (Read off Ryan's own board
  // 2026-08-19; every fixture here had been written against 8.10's shape.)
  //
  // Still deliberately narrow: a bare decimal followed by anything is NOT a version.
  // "3.85 / volts" and "2.0 / EVENT: Clash" must keep failing, which is the whole
  // reason a follower is required at all.
  const reply = buf.match(/^[ \t]*v?(\d+\.\d+[\w.\-]*)[ \t]*\r?\n[ \t]*(?:\S*\.h|Installed:)[ \t\S]*\r?$/m);
  if (reply) return 'v' + trim(reply[1]);
  return null;
}

// When the firmware was flashed, as the board reports it:
//   > version
//   v6.9
//   Installed: Aug 19 2026 10:29:12
// A `__DATE__ __TIME__` string in the board's own sense, with no timezone, so it
// is for DISPLAY and loose comparison against @jmt:flashed — never exact equality.
// Separate from parseBoardVersion on purpose: two facts, two absences. A board
// that reports a version and no install date must not look like a failed probe.
function parseBoardInstalled(buf) {
  const m = buf.match(/^[ \t]*Installed:[ \t]*(\S.*?)\s*$/m);
  return m ? m[1] : null;
}

ipcMain.handle('serial:probeVersion', async (_, { port } = {}) => {
  if (!port) return { ok: false, reason: 'no-port' };
  if (_serialMonitorPort && _serialMonitorPort.isOpen) {
    return { ok: false, reason: 'monitor-open' };
  }

  const { SerialPort } = require('serialport');
  let sp = null;
  // Resolves only once the port is genuinely released. Closing is asynchronous,
  // so an abort that did not wait for this would hand a still-open port to
  // whatever asked us to get out of the way.
  const shut = () => {
    if (!sp) return Promise.resolve();
    const p = sp;
    sp = null;
    try { p.removeAllListeners(); } catch {}
    return new Promise(res => {
      try { p.isOpen ? p.close(() => res()) : res(); } catch { res(); }
    });
  };

  try {
    sp = new SerialPort({ path: port, baudRate: 115200, autoOpen: false });
    await new Promise((res, rej) => sp.open(e => e ? rej(e) : res()));
  } catch (e) {
    await shut();
    return { ok: false, reason: 'open-failed', error: e.message };
  }

  return await new Promise(resolve => {
    let buf    = '';
    let done   = false;
    let closed = null;
    const finish = (result) => {
      if (done) return closed;
      done = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      closed = shut();
      _abortVersionProbe = null;
      closed.then(() => resolve(result));
      return closed;
    };
    // Returns a promise the caller awaits, so "stop using the port" means the
    // port is actually free when it resolves.
    _abortVersionProbe = () => finish({ ok: false, reason: 'aborted' });

    let graceTimer = null;
    sp.on('data', chunk => {
      buf += chunk.toString('utf8');
      const v = parseBoardVersion(buf);
      if (v) {
        const inst = parseBoardInstalled(buf);
        // 6.9 prints `Installed:` as the line right after the version, so it is
        // already here. 8.10 prints CONFIG_FILE, prop and buttons first, so a
        // finish-on-version would beat it by a few milliseconds and the date
        // would appear on old boards and not new ones. One short grace window,
        // set once, buys the rest of the reply without touching the 2.5s budget.
        if (inst) return finish({ ok: true, version: v, installed: inst });
        if (!graceTimer) {
          graceTimer = setTimeout(
            () => finish({ ok: true, version: v, installed: parseBoardInstalled(buf) }),
            250);
        }
        return;
      }
      // A flooding board (charge-detect chatter, a serial-print loop) would grow
      // this without bound. Keep a tail large enough to hold a whole reply.
      if (buf.length > 64 * 1024) buf = buf.slice(-8192);
    });
    sp.on('error', e => finish({ ok: false, reason: 'error', error: e.message }));
    sp.on('close', () => finish({ ok: false, reason: 'closed' }));

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 2500);

    // Leading newline clears any partial command the board may have buffered.
    try { sp.write('\nversion\n'); } catch (e) {
      finish({ ok: false, reason: 'write-failed', error: e.message });
    }
  });
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

// { folderName → "v8.10" } read from each tree's own ProffieOS.ino, so it can be
// compared against what a connected board reports over serial.
ipcMain.handle('proffieOS:osVersionMap', () => ({ ok: true, map: proffie.getOSVersionMap() }));

// Returns [{ name, comment, slot }] for the ArgumentName enum in the given version's
// styles/edit_mode.h. Falls back to [] when the version / file / enum can't be parsed.
// Pass null/undefined to use the currently selected version.
ipcMain.handle('proffieOS:getArgumentNames', (_, versionName) => {
  const v = versionName || proffie.getSelectedVersion();
  return { ok: true, version: v, entries: proffie.getArgumentNames(v) };
});

// ── Core version, per ProffieOS version ────────────────
//
// Every ProffieOS version is PINNED to a specific core. There is deliberately no
// "follow latest": a tree that followed latest would change compiler the day a
// new core shipped, which means a cache that misses, a download nobody asked
// for, and a config that only just fitted possibly failing to link. The rule is
// one sentence - your build core never changes unless you change it - and a
// newer core is surfaced as a fact to act on rather than applied silently.
//
// Resolution never touches the network. A version arrives stamped at download
// time; anything unstamped (an import made while the index was unreachable, or
// a tree that predates the field and missed the backfill) is healed here from
// what is already on disk, then written so it is pinned like everything else.
async function _effectiveCoreFor(versionName) {
  const saved = versionName ? proffie.getVersionCore(versionName) : null;
  if (saved) return { version: coreVersions.normalizeVersion(saved), pinned: true };

  // 4.6.0 is the default for everyone, every time, and it is a product decision
  // rather than a fallback: it is the most stable core and the experience we want
  // a first-time user to get. Adopted when the system already has exactly it,
  // installed into our own tree when not.
  //
  // Deliberately NOT "newest core already installed". That rule let the machine
  // choose the policy - a user whose system happened to hold only 3.6 would be
  // silently pinned to 3.6 on first launch and never see the default we intend.
  // An older core is a considered choice for a flash-tight board, never
  // something to inherit by accident. (2026-08-12)
  const healed = coreVersions.FALLBACK_VERSION;

  if (versionName) {
    try { proffie.setVersionCore(versionName, healed); } catch { /* pin next time */ }
  }
  return { version: healed, pinned: false, healed: true };
}

/**
 * Is this core reachable for a build at all, from EITHER tree?
 *
 * The Build Tools panel asks two questions that have to agree: the dropdown
 * labels each version system or installed from the union of both trees, while
 * this decides whether to offer a download. Asking only our own tree made the
 * panel label a core "system" and offer to install it on the very next line.
 *
 * Read live rather than recorded, matching ensureCore: another Arduino tool can
 * add or remove a system core between builds. (2026-08-12)
 */
function _coreIsAvailable(version) {
  const want = coreVersions.normalizeVersion(version);
  return toolchain.listCoreTrees().some(t => coreVersions.normalizeVersion(t.version) === want)
      || coreVersions.isVersionInstalled(toolchain.getSystemArduinoDataPath(), want);
}

// Point the toolchain at the right core for a version. Called on startup and on
// every version switch, because the FQBN, the install check and the build-cache
// key all read from it, and a switch that left it pointing at the old core
// would compile against one core and key the cache with another.
async function _applyCoreForVersion(versionName) {
  try {
    const eff = await _effectiveCoreFor(versionName);
    // Always explicit now. Every version names its core, so the build must go
    // against exactly that one rather than against whatever the machine happens
    // to have lying around from another Arduino tool.
    toolchain.setActiveCoreVersion(eff.version, { explicit: true });
    return eff;
  } catch {
    // Never let core resolution stop a version from being selected. The
    // toolchain keeps whatever it already had, which is a working default.
    return null;
  }
}

ipcMain.handle('proffieOS:selectVersion', async (_, name) => {
  proffie.setSelectedVersion(name);
  Store.set('lastVersion', name);
  const core = await _applyCoreForVersion(name);
  return { ok: true, name, core: core ? core.version : null };
});

// What the user can choose from, and what is already on disk. `stale` means the
// index could not be reached and this list came from cache or a floor, so the
// UI can avoid presenting a guess as the published truth.
ipcMain.handle('core:listAvailable', async () => {
  const res       = await coreVersions.resolveLatest(app.getPath('userData'), { force: false });
  const available = toolchain.listAvailableCores();      // [{version, source}]
  const byVersion = Object.fromEntries(available.map(c => [c.version, c.source]));
  return {
    ok:        true,
    // Filtered and newest-first. The index publishes back to 0.1, and everything
    // below the floor predates ProffieOS 7, so listing it would put eight traps
    // in a dropdown. Anything present on the machine is always included even
    // below the floor, so the list can never hide a core the user actually has.
    versions:  coreVersions.offeredVersions(res.versions, Object.keys(byVersion)),
    latest:    res.latest,
    // Where each one lives. 'system' means the user's own Arduino tree: usable,
    // and never ours to remove. 'jmt' means we downloaded it, so a reset can
    // take it back.
    sources:   byVersion,
    active:    toolchain.getActiveCoreVersion(),
    stale:     res.stale,
    source:    res.source,
  };
});

ipcMain.handle('core:getForVersion', async (_, name) => {
  const eff = await _effectiveCoreFor(name);
  const res = await coreVersions.resolveLatest(app.getPath('userData'));
  const installed = _coreIsAvailable(eff.version);
  return {
    ok:        true,
    name,
    pinned:    eff.version,
    installed,
    // Expected but absent. Lets the panel say "missing" - a fact about a machine
    // that has drifted - instead of "not installed", which reads as though the
    // user never had it. (2026-08-15)
    dormant:   !installed && Object.keys(_recordedPlugins())
                 .includes(coreVersions.normalizeVersion(eff.version)),
    // A newer core exists. Reported as a fact, never as a recommendation: someone
    // on 3.6 because 4.6 overflows their board should see that 4.7 exists without
    // being nudged into a build that cannot link for them. Suppressed when the
    // index could not be reached, since a cached list is no basis for the claim.
    newerAvailable: res.stale ? null : coreVersions.newerThan(eff.version, res.versions),
  };
});

// coreVersion is required. There is no "unset" any more - a version is always
// pinned, so clearing would just mean picking a different pin.
ipcMain.handle('core:setForVersion', async (_, { name, coreVersion }) => {
  if (!coreVersion) return { ok: false, error: 'A Proffieboard Plugin version is required.' };
  const res = proffie.setVersionCore(name, coreVersion);
  if (!res.ok) return res;
  // Only re-point the toolchain if this is the version currently selected;
  // editing another version's setting must not change what a build in flight
  // is compiling against.
  const appliedToActive = proffie.getSelectedVersion() === name;
  if (appliedToActive) await _applyCoreForVersion(name);
  const eff = await _effectiveCoreFor(name);
  return {
    ok:        true,
    name,
    pinned:    eff.version,
    installed: _coreIsAvailable(eff.version),
    // Tells the renderer whether the CURRENT compiled state just became stale.
    // The build cache is keyed by core so it is safe on its own, but the
    // session's "there is a good build ready to flash" flag is not keyed by
    // anything and has to be dropped explicitly.
    appliedToActive,
  };
});

// What switching this version to another core would actually cost the user.
//
// Follows the rule the Clear-cache dialog established: state what THEY would
// really pay, from what is recorded, never an invented duration. An invented
// "10 to 15 minutes" was wrong by 25x at both ends of the real range, because a
// light config builds in about 70 seconds and a heavy one in over half an hour.
//
// Cached builds are counted by walking metadata.json rather than by recomputing
// keys, because entries for one ProffieOS version are spread across a buildPkg
// directory per board and USB mode, and the metadata already records both the
// tree and the core each entry was built with.
ipcMain.handle('cache:coreSwitchImpact', async (_, { versionName, toCore }) => {
  const fromCore = (await _effectiveCoreFor(versionName)).version;
  const target   = coreVersions.normalizeVersion(toCore || fromCore);
  const osHash   = proffie.hashVersion(versionName);

  let losing = 0, longestLosingMs = null, keeping = 0;
  const root = path.join(app.getPath('userData'), 'build-cache');
  try {
    for (const pkg of fs.readdirSync(root, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      for (const e of fs.readdirSync(path.join(root, pkg.name), { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const mp = path.join(root, pkg.name, e.name, 'metadata.json');
        if (!fs.existsSync(mp)) continue;
        let m;
        try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { continue; }
        if (m.proffieOSHash !== osHash) continue;
        const entryCore = coreVersions.normalizeVersion(m.coreVersion || '');
        if (entryCore === target) { keeping++; continue; }
        if (entryCore === coreVersions.normalizeVersion(fromCore)) {
          losing++;
          const d = m.compileDurationMs;
          if (typeof d === 'number' && (longestLosingMs === null || d > longestLosingMs)) longestLosingMs = d;
        }
      }
    }
  } catch { /* no cache yet: losing stays 0, which is the truthful answer */ }

  return {
    ok: true,
    fromCore,
    toCore: target,
    changed: coreVersions.compareVersions(fromCore, target) !== 0,
    // Builds that stop being reachable. NOT deleted - the eviction sweep
    // reclaims them later - but they will not be hit again from this version.
    losing,
    // The real worst case from this user's own recorded builds. Null when
    // nothing recorded a duration, and the caller must then say nothing rather
    // than guess.
    longestLosingMs,
    // Reassurance where it is due: switching back to a core they have already
    // built with can still hit.
    keeping,
    installed: _coreIsAvailable(target),
  };
});

// Install on demand. Separate from selection on purpose: choosing a core the
// machine does not have yet is a several-hundred-megabyte download, and that
// deserves its own visible step rather than happening inside the first compile.
// Getting a plugin is two long phases wearing one word. arduino-cli already says
// which it is in its own output, so this reads the phase off the stream rather
// than inventing a second source of truth or guessing at percentages we cannot
// back up. Anything unrecognised leaves the phase alone. (2026-08-12)
//
// Shared by BOTH install paths. It used to live inside the `core:install`
// handler, so an install the user started from the panel reported its phases
// while the identical install started by ensureCore at startup reported nothing
// - same work, same wait, two different amounts of UI. (2026-08-15)
function _installPhaseLogger(base) {
  let phase = null;
  const send = (next) => {
    if (next === phase) return;
    phase = next;
    if (win && !win.isDestroyed()) win.webContents.send('core:installProgress', { phase: next });
  };
  return (line, isError) => {
    const s = String(line || '');
    if (/^Downloading index/i.test(s))            send('index');
    else if (/Downloading packages|Downloading\s+\S+@/i.test(s)) send('downloading');
    else if (/^Installing (platform|tool)|Installing\s+\S+@/i.test(s)) send('installing');
    base(line, isError);
  };
}
function _clearInstallPhase() {
  if (win && !win.isDestroyed()) win.webContents.send('core:installProgress', { phase: null });
}

ipcMain.handle('core:install', async (_, { coreVersion }) => {
  const log = _installPhaseLogger(makeLogger());
  try {
    return await toolchain.ensureCore(log, coreVersion);
  } finally {
    _clearInstallPhase();
  }
});

// Stop an install and remove what it had written so far. The renderer holds the
// dropdown locked while one runs, so this is the only way out of a long download
// the user has changed their mind about - and it has to leave the machine in the
// state it was in before, not with a half-unpacked plugin that later reads as
// installed. (2026-08-15)
ipcMain.handle('core:cancelInstall', async (_, { coreVersion }) => {
  try { return await toolchain.cancelCoreInstall(coreVersion); }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('dialog:selectFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Select ProffieOS Folder',
    properties: ['openDirectory']
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});

// Pick a sound font source: either a .zip file or a folder. Split into two
// modes because Electron's openFile + openDirectory only co-exist on macOS;
// on Windows and Linux the dialog has to commit to one. The renderer shows
// two buttons so the choice is explicit.
ipcMain.handle('dialog:selectSoundFontSource', async (_, { mode = 'folder' } = {}) => {
  const lastDir = Store.get('lastSfSourceDir') || app.getPath('documents');
  const opts = mode === 'zip'
    ? {
        title: 'Select Sound Font Zip',
        defaultPath: lastDir,
        properties: ['openFile'],
        filters: [{ name: 'Zip files', extensions: ['zip'] }],
      }
    : {
        title: 'Select Sound Font Folder',
        defaultPath: lastDir,
        properties: ['openDirectory'],
      };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, opts);
  if (canceled || !filePaths.length) return null;
  // Remember the PARENT of whatever was picked so the next open lands among
  // siblings: for a folder pick that's the folder's parent (not the imported
  // folder itself — fixes "you're stuck inside the folder you just imported"),
  // and for a zip pick it's still the folder of zips.
  try { Store.set('lastSfSourceDir', path.dirname(filePaths[0])); } catch {}
  return filePaths[0];
});

ipcMain.handle('proffieOS:validateSource', (_, sourcePath) => {
  if (path.basename(sourcePath) !== 'ProffieOS') {
    return { ok: false, error: 'Folder must be named "ProffieOS".' };
  }
  if (!fs.existsSync(path.join(sourcePath, 'ProffieOS.ino'))) {
    return { ok: false, error: 'Folder does not contain ProffieOS.ino, so it is not a valid ProffieOS source.' };
  }
  return { ok: true };
});

// The core to stamp onto a newly arrived ProffieOS version. Never null: every
// tree must land pinned, or it becomes the one version whose compiler can move
// under it. If the index cannot be reached we pin the newest core already on
// disk, which is both deterministic and the one guaranteed to work offline.
async function _coreToStamp() {
  // Across every tree of ours, not one of them. Reading a single path made the
  // offline answer depend on which core happened to be active at the time.
  const installedBest = () =>
    coreVersions.pickLatest(toolchain.listCoreTrees().map(t => t.version)) ||
    coreVersions.FALLBACK_VERSION;
  try {
    const res = await coreVersions.resolveLatest(app.getPath('userData'));
    return res.stale ? installedBest() : res.latest;
  } catch { return installedBest(); }
}

ipcMain.handle('proffieOS:importVersion', async (_, { sourcePath, versionName, proffieVersion }) => {
  return proffie.importVersion(sourcePath, versionName, proffieVersion, await _coreToStamp());
});

ipcMain.handle('versions:listDetails', async () => {
  const rows = proffie.listVersionsDetails();
  // EVERY ProffieOS version has a plugin. `listVersionsDetails` reads the raw
  // meta, which is null for a tree that arrived while the index was unreachable
  // and has not been looked at since - but that is an unstamped FILE, not an
  // absent choice. Resolution heals it, so callers get the version that would
  // actually be built with and nothing downstream has to model "no plugin" as a
  // state it can render.
  //
  // Routed through _effectiveCoreFor rather than defaulting here, so the rule
  // lives in one place and the value arrives normalised - `3.6` and `3.6.0`
  // otherwise reach the renderer as different strings and compare unequal.
  // Free: it does no I/O beyond the meta read and never touches the network.
  // (2026-08-15)
  for (const r of rows) {
    try { r.coreVersion = (await _effectiveCoreFor(r.name)).version; } catch { /* leave raw */ }
  }
  return rows;
});
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

    // Import. The core current at download time is stamped onto the tree, so a
    // version keeps building against the core it arrived with even after a
    // newer one is published. Following latest forever would silently change
    // the compiler under a config that was fitting on the old one.
    win.webContents.send('versions:downloadProgress', { phase: 'importing' });
    return proffie.importVersion(proffieFolder, versionName, proffieVersion, await _coreToStamp());
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

// ── IPC: JMT add-ons ──────────────────────────────────
// Branch is mutable — the renderer can flip between prod (`main`) and `dev` via the
// hidden devmode toggle in the versions panel. Session-only: every app launch resets
// to `main` so a user can never accidentally end up on dev.
let _addonBranch = 'main';
const _JMT_REPO_BASE  = 'https://raw.githubusercontent.com/rtaylor2280/jmt-proffie-addons/';
const _JMT_API_COMMIT = (branch) => `https://api.github.com/repos/rtaylor2280/jmt-proffie-addons/commits/${branch}`;
const _jmtRawBranch   = () => `${_JMT_REPO_BASE}${_addonBranch}/`;   // branch-tip base (edge-cache lagged)
const _jmtRawAt       = (sha) => `${_JMT_REPO_BASE}${sha}/`;         // SHA-pinned base (always fresh)
let _jmtManifestCache = null;
let _jmtCachedSha     = null;   // commit the cached manifest was fetched at
let _jmtShaLast       = null;   // last resolved branch-tip SHA (throttled)
let _jmtShaResolvedAt = 0;

// Resolve the current branch-tip commit SHA via the GitHub API. Branch-NAME raw
// URLs sit behind raw.githubusercontent's ~5-minute edge cache, so a fresh push
// isn't visible for minutes (the pain when iterating on the addons). A raw URL
// pinned to the full commit SHA is content-addressed and served immediately.
// We pay ONE lightweight API call (Accept: sha returns just the 40-char hash),
// then fetch manifest + every file from raw AT that SHA — no per-file API
// rate-limit exposure, no CDN lag. Throttled ~8s to collapse bursty UI calls.
async function _getJmtBranchSha() {
  const now = Date.now();
  if (_jmtShaLast && (now - _jmtShaResolvedAt < 8000)) return _jmtShaLast;
  const sha = (await _httpsGet(_JMT_API_COMMIT(_addonBranch), {
    'User-Agent': 'JMT-Studio', 'Accept': 'application/vnd.github.sha',
  })).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`unexpected SHA from GitHub API: ${sha.slice(0, 60)}`);
  _jmtShaLast = sha;
  _jmtShaResolvedAt = now;
  return sha;
}

// Returns { ok, manifest, sha }. The manifest at a given commit is immutable, so
// the cache is keyed by SHA: a matching SHA serves the cache (no staleness), a
// new SHA (a push) always re-fetches. Falls back to the branch-tip raw URL if
// the API is unreachable/rate-limited (may be edge-stale, but never fails hard).
async function _getJmtManifest() {
  let sha = null;
  try {
    sha = await _getJmtBranchSha();
  } catch {
    try {
      const body = await _httpsGet(`${_jmtRawBranch()}manifest.json?_=${Date.now()}`,
        { 'User-Agent': 'JMT-Studio', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' });
      return { ok: true, manifest: JSON.parse(body), sha: null };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  if (_jmtManifestCache && _jmtCachedSha === sha) {
    return { ok: true, manifest: _jmtManifestCache, sha };
  }
  try {
    const body = await _httpsGet(`${_jmtRawAt(sha)}manifest.json`, { 'User-Agent': 'JMT-Studio' });
    const manifest = JSON.parse(body);
    _jmtManifestCache = manifest;
    _jmtCachedSha     = sha;
    return { ok: true, manifest, sha };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('versions:fetchJmtManifest', () => _getJmtManifest());

ipcMain.handle('versions:getAddonBranch', () => _addonBranch);
ipcMain.handle('versions:setAddonBranch', (_, branch) => {
  _addonBranch = branch === 'dev' ? 'dev' : 'main';
  // Flush everything branch-scoped so the next fetch resolves the new branch's
  // tip SHA and manifest rather than reusing the previous branch's.
  _jmtManifestCache = null;
  _jmtCachedSha     = null;
  _jmtShaLast       = null;
  _jmtShaResolvedAt = 0;
  return { ok: true, branch: _addonBranch };
});

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
  // Files JMT previously installed that aren't in the incoming manifest — these
  // would be deleted on apply. Surface them to the renderer so the UI can disclose
  // the removal up front (otherwise the user only sees modified/missing files and
  // the cleanup happens silently).
  const meta          = proffie.readVersionMeta(versionName) || {};
  const prevInstalled = Array.isArray(meta.jmtInstalledFiles) ? meta.jmtInstalledFiles : [];
  const newSet        = new Set(files.map(f => f.path));
  const toRemove      = prevInstalled.filter(p => !newSet.has(p));
  return { ok: true, results, toRemove };
});

ipcMain.handle('versions:applyJmtFeatures', async (event, versionName) => {
  const manifestResult = await _getJmtManifest();
  if (!manifestResult.ok) return manifestResult;
  const { manifest, sha } = manifestResult;
  // Pull files from the SAME commit the manifest came from (SHA-pinned = fresh,
  // and guarantees files match the manifest even if a push lands mid-install).
  // Fall back to the branch tip only if the SHA couldn't be resolved.
  const _fileBase = sha ? _jmtRawAt(sha) : _jmtRawBranch();

  const proffieRoot = path.join(proffie.getUserVersionsPath(), versionName, 'ProffieOS');
  if (!fs.existsSync(proffieRoot)) return { ok: false, error: 'ProffieOS folder not found.' };

  // Reconcile against the previously-installed file list so files that existed in
  // the prior manifest but aren't in the new one get removed. Handles dev↔main
  // branch swaps where the file sets differ, and also covers prod when a future
  // manifest version drops a file. Only files JMT installed are eligible for
  // deletion — user-created files in the same folders are untouched because they
  // were never in jmtInstalledFiles.
  const prevMeta       = proffie.readVersionMeta(versionName) || {};
  const prevInstalled  = Array.isArray(prevMeta.jmtInstalledFiles) ? prevMeta.jmtInstalledFiles : [];
  const newFilePaths   = manifest.files.map(f => f.path);
  const newFileSet     = new Set(newFilePaths);
  const toDelete       = prevInstalled.filter(p => !newFileSet.has(p));

  const total = manifest.files.length;
  let done = 0;
  try {
    for (const relPath of toDelete) {
      const abs = path.join(proffieRoot, relPath);
      try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch {}
    }
    for (const file of manifest.files) {
      win.webContents.send('versions:jmtProgress', { file: file.path, done, total });
      const content = await _httpsGet(_fileBase + file.path, { 'User-Agent': 'JMT-Studio' });
      const dest = path.join(proffieRoot, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, 'utf8');
      done++;
      win.webContents.send('versions:jmtProgress', { file: file.path, done, total });
    }
    proffie.writeVersionMeta(versionName, {
      jmtVersion:        manifest.version,
      jmtInstalledFiles: newFilePaths,
    });
    // Source files of this version just changed — drop the cached folder hash so
    // the next compile-cache check sees the new buildPkg identity and re-enables
    // the Compile button when there's actually work to do. Also drop the cached
    // ArgumentName enum since JMT add-on apply could in principle modify
    // styles/edit_mode.h (unlikely today, defensive for the future).
    proffie.invalidateVersionHash(versionName);
    proffie.invalidateArgumentNames(versionName);
    _jmtManifestCache = null; _jmtCachedSha = null;  // force fresh fetch on next check
    return { ok: true, jmtVersion: manifest.version, removed: toDelete.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: DFU ───────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_, url) => {
  shell.openExternal(url);
});

// Reveal a file in the OS file manager with it selected (Explorer / Finder /
// Linux file manager — selection is best-effort on Linux). Used by the export
// completion summary so the user is taken straight to the artifact instead of
// hunting for it in a date-sorted folder. Resolve + existence-check first,
// because showItemInFolder silently does nothing on a bad/relative path; fall
// back to opening the containing folder so the user always lands somewhere.
ipcMain.handle('shell:showItemInFolder', async (_, p) => {
  try {
    if (!p) return { ok: false, error: 'no path' };
    const full = path.resolve(String(p));
    if (fs.existsSync(full)) { shell.showItemInFolder(full); return { ok: true }; }
    const dir = path.dirname(full);
    if (fs.existsSync(dir)) {
      const err = await shell.openPath(dir);
      return err ? { ok: false, error: err } : { ok: true, fallback: 'dir' };
    }
    return { ok: false, error: `Not found: ${full}` };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// Open a FOLDER, as opposed to revealing an item inside its parent. The two are
// genuinely different actions and the right one depends on what the path is: a
// source file wants showItemInFolder (land next to it, selected), an export
// destination wants this (land inside it, looking at what was written).
ipcMain.handle('shell:openFolder', async (_, p) => {
  try {
    if (!p) return { ok: false, error: 'no path' };
    const full = path.resolve(String(p));
    if (!fs.existsSync(full)) return { ok: false, error: `Not found: ${full}` };
    const err = await shell.openPath(full);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// Read-only scan of removable volumes for the "Read my Proffie SD card" flow.
ipcMain.handle('sdcard:scan', () => sdCardDetect.scan());

// Fallback when no card is auto-detected: let the user point at a drive or a folder
// (e.g. a copy of an SD card) and assess it the same way. Read-only.
ipcMain.handle('sdcard:pickFolder', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a drive or SD-card folder',
    properties: ['openDirectory'],
  });
  return (res.canceled || !res.filePaths.length) ? null : res.filePaths[0];
});
ipcMain.handle('sdcard:scanPath', (_, p) => sdCardDetect.assessPicked(p));
ipcMain.handle('sdcard:listDir', (_, p) => sdCardDetect.listDir(p));
ipcMain.handle('sdcard:folderHealth', (_, p) => { try { return sdCardDetect.scanFolderHealth(p); } catch { return { files: {}, dirs: {} }; } });
// The viewer is a translator, not a converter: a .docx is shown as plain text pulled
// from its zip in memory (sdCardDetect.docxToText), never written back to disk.
ipcMain.handle('sdcard:readText', async (_, p) => {
  try {
    if (/\.docx$/i.test(p)) return await sdCardDetect.docxToText(p);
    return fs.readFileSync(p, 'utf8').slice(0, 200000);
  } catch { return null; }
});
ipcMain.handle('sdcard:readBytes', (_, p) => {
  try { const b = fs.readFileSync(p); return b.length > 20 * 1024 * 1024 ? null : b.toString('base64'); } catch { return null; }
});
ipcMain.handle('sdcard:findConfigs', (_, p) => { try { return sdCardDetect.findConfigs(p); } catch { return []; } });
ipcMain.handle('sdcard:analyzeFonts', async (_, p) => { try { return await sdCardDetect.analyzeFonts(p); } catch (e) { return { path: p, error: String(e && e.message || e), fonts: [] }; } });
// Copy a file or folder OFF a card to a user-chosen location. Read-only on the card side;
// only ever writes to destDir. Collision-safe (" (N)" suffix).
ipcMain.handle('sdcard:copyOut', (_, { srcPath, destDir }) => {
  try {
    if (!srcPath || !destDir) return { ok: false, error: 'Missing path' };
    const base = path.basename(srcPath);
    const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
    let dest = path.join(destDir, base), n = 1;
    while (fs.existsSync(dest)) { dest = path.join(destDir, `${stem} (${n})${ext}`); n++; }
    const st = fs.statSync(srcPath);
    if (st.isDirectory()) fs.cpSync(srcPath, dest, { recursive: true });
    else fs.copyFileSync(srcPath, dest);
    return { ok: true, dest };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('dfu:detect', async () => {
  return await toolchain.detectDFU();
});

// Install + bind the JMT Studio WinUSB driver so dfu-util can flash. Replaces
// the old "download proffie-dfu-setup.exe and run it every time" path: that
// libwdi tool regenerated a fresh self-signed INF on each run (30+ copies piled
// up in the driver store) and could never win the ranking against ST's WHQL
// STTub30, so every new board re-triggered the whole dance. Instead we ship one
// tiny, Trusted-Signing-signed WinUSB package, stage it once, and force-bind the
// board to it. Windows-only; macOS/Linux reach the DFU device through libusb
// directly and need no driver.
ipcMain.handle('dfu:ensureDriver', async () => {
  // Delegates to the shared toolchain routine so the manual driver-fix button
  // and the automatic inline install in the flash path use one implementation.
  const onLog = (msg) => { if (win && !win.isDestroyed()) win.webContents.send('dfu:setupStatus', msg); };
  return await toolchain.ensureDfuDriver(onLog);
});

ipcMain.handle('dfu:flash', async () => {
  const log = makeLogger();
  await _abortVersionProbe?.();  // never let a version probe hold the port a flash needs

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
