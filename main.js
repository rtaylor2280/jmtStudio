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
// [B-398] Main-thread stall probe. Inert unless userData/.stall-probe exists.
const stallProbe = require('./stallProbe');
const soundFontFileOps = require('./soundFontFileOps');
const soundFontReorganize = require('./soundFontReorganize');
const soundFontVoicepack = require('./soundFontVoicepack');
const sdCardDetect = require('./sdCardDetect');
const soundFontSharedTracks = require('./soundFontSharedTracks');
const soundFontRemoval = require('./soundFontRemoval');
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
  },
  // ⚠️ [B-299] THIS WAS MISSING, AND TWO CALLERS USED IT. Both threw. The one in
  // the plugin `end:` hook meant the pending-install marker was never taken down
  // after a SUCCESSFUL install — so a standing marker stopped meaning "interrupted"
  // and started meaning "the last install finished and could not say so".
  //
  // ⭐⭐ ADDING THIS ALONE WOULD HAVE BEEN A DATA-LOSS BUG. The recovery path below
  // called Store.delete and then cancelCoreInstall(pending), which removes the whole
  // versioned tree. It never ran only because this line threw first. Measured on the
  // dev profile 2026-09-02 and STILL TRUE 2026-09-13: pendingPluginInstall = "3.6.0"
  // with a complete, in-use 802 MB core sitting under that version. The naive
  // one-line fix eats it on the next launch. Read _recoverInterruptedInstall before
  // touching any of this.
  delete(key) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(this._path, 'utf8')); } catch { return; }
    if (!(key in data)) return;
    delete data[key];
    fs.writeFileSync(this._path, JSON.stringify(data), 'utf8');
  }
};

function addRecentFile(filePath) {
  let files = Store.get('recentFiles') || [];
  files = [filePath, ...files.filter(f => f !== filePath)].slice(0, 20); // store up to max possible
  Store.set('recentFiles', files);
}

// ── Window ─────────────────────────────────────────────
// Every BrowserWindow we open spreads this. macOS takes its icon from the app
// bundle, so it deliberately contributes nothing there; Windows and Linux fall
// back to the stock Electron atom without it.
const WINDOW_ICON =
    process.platform === 'win32' ? { icon: path.join(__dirname, 'assets', 'icon.ico') }
  : process.platform === 'linux' ? { icon: path.join(__dirname, 'assets', 'logo.png') }
  : {};

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
    ...WINDOW_ICON,
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
    ...WINDOW_ICON,
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
  // [B-398] Arm the stall probe before any work can happen, so a freeze during the very first
  // import is still measured. Returns false and costs nothing when the flag file is absent.
  try {
    if (stallProbe.init(app.getPath('userData'))) {
      console.log('[stall-probe] armed ->', stallProbe.logPath(app.getPath('userData')));
      // [B-398] Record the STACK of a main-process crash, then re-raise the same visible
      // failure so behaviour is unchanged - the diagnostic must not turn a crash into a
      // non-crash.
      stallProbe.captureCrashes((err) => {
        try { dialog.showErrorBox('A JavaScript error occurred in the main process',
          'Uncaught Exception:' + String.fromCharCode(10) + String((err && err.stack) || err)); } catch {}
        app.quit();
      });
    }
  } catch {}
  // Evict stale cache entries before window opens
  try { cacheManager.startupEviction(); } catch {}

  // Clear sound-font sources that were staged by an import that never finished.
  // At startup nothing can be in flight BY DEFINITION, so this needs no age test
  // and no judgement — a staged source cannot be adopted by a later session, so
  // it is garbage the moment its own session ends. ([B-298])
  //
  // Deliberately here rather than on the Sound Fonts tab's own sweep: this app
  // is primarily a config editor, and a user who imports once and then spends
  // three weeks in Config Manager would never trigger a tab-render cleanup.
  // Startup is the one moment no habit of theirs can dodge.
  try {
    const staged = soundFontSources.clearStagedSources(app.getPath('userData'));
    if (staged.removed.length) {
      console.log(`[startup] cleared ${staged.removed.length} staged source(s), ${(staged.bytes / 1048576).toFixed(1)} MB`);
    }
  } catch {}
  // [B-364] Same lifecycle, same reasoning: a program pulled out of the library is held
  // only long enough for the user to say whether they want a copy. If they said yes it
  // was released and deleted already; if they closed the app instead, it dies here.
  // Either way it never survives its own session.
  try {
    const imp = soundFontRemoval.sweepImpounded(app.getPath('userData'));
    if (imp.removed) {
      console.log(`[startup] cleared ${imp.removed} impounded program file(s), ${imp.bytes} bytes`);
    }
  } catch {}

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

// ⭐⭐ VERIFY FIRST, AND NEVER AUTO-DELETE. [B-299], his ruling 2026-09-13.
//
// The version above deleted the marker and then removed the whole versioned tree, on
// the reasoning that a standing marker means an interrupted install. That reasoning
// was sound and its PREMISE was broken: `Store.delete` did not exist, so the `end:`
// hook threw and the marker was never taken down after a SUCCESSFUL install either.
// A standing marker therefore does not distinguish "interrupted" from "finished fine".
//
// The only thing that ever stopped it deleting a working 802 MB toolchain was the
// missing function throwing one line earlier. Making Store.delete work without this
// rewrite would have armed it.
//
// So: ask the disk. A complete core means the install finished and only the bookkeeping
// failed — take the marker down and say nothing. An incomplete one is NOT cleaned
// automatically, because "half-installed" is our inference and the tree is the user's
// 800 MB; the marker comes down so this does not re-fire every launch, and the state is
// reported for the OS Versions panel to offer a reinstall.
async function _recoverInterruptedInstall() {
  const pending = Store.get(PENDING_INSTALL_KEY);
  if (!pending) return;

  let complete = false;
  try {
    // getCoreTreePath, not a hand-built join: it adopts the legacy pre-1.8 tree when
    // that already holds the version, so a user who upgraded in place is not read as
    // having an empty versioned directory.
    complete = coreVersions.isVersionInstalled(toolchain.getCoreTreePath(pending), pending);
  } catch (e) {
    // ⚠️ A verify that FAILED is not a verify that said "incomplete". If we cannot
    // read the disk we know nothing, and the safe answer to knowing nothing is to
    // leave everything exactly as it is — marker included, so the question is asked
    // again next launch rather than silently settled.
    console.warn('[core] could not check the pending plugin install; leaving it alone:', e.message);
    return;
  }

  Store.delete(PENDING_INSTALL_KEY);
  if (complete) {
    console.log(`[core] plugin ${pending} is present and complete; clearing a stale pending marker`);
    return;
  }
  // Deliberately no removal. Nothing here is destroyed on the app's own initiative.
  // ⏭ The console warning is the ONLY record of this today. Surfacing it in the OS
  // Versions panel is [B-380] — deliberately not done here, because adding UI was not
  // what was asked for and the destructive behaviour is what had to go tonight.
  console.warn(`[core] plugin ${pending} was marked as installing and is not fully present. `
             + 'Leaving it in place — reinstall it from OS Versions if builds fail.');
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

// Same sweep on the way out, so a clean exit reclaims the space NOW instead of
// at the next launch. This is the optimisation, not the fix — the startup sweep
// is what guarantees the space comes back, because a force-quit, a crash or a
// power cut never reaches this handler. ([B-298])
//
// Synchronous on purpose: before-quit is not a place to start async work, and
// deleting a handful of directories is fast. If it throws we let the app exit
// anyway — startup will do it.
app.on('before-quit', () => {
  try { soundFontSources.clearStagedSources(app.getPath('userData')); } catch {}
  try { soundFontRemoval.sweepImpounded(app.getPath('userData')); } catch {}
});

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
// [B-291] A remembered directory may live on a drive that isn't plugged in
// today (USB stick, card reader). Handing that path to dialog.show*Dialog as
// defaultPath makes WINDOWS itself demand the disk — "Please insert a disk
// into USB Drive (J:)" — over the app. Resolve a remembered dir to itself
// only while it exists; otherwise return null so the call site's own `||`
// fallback (documents / downloads / home) fires, exactly as it already does
// when nothing was ever stored. The stored value is NOT cleared: the drive
// may come back, and forgetting it would punish unplugging a stick.
function liveDir(dir) {
  try { if (dir && fs.existsSync(dir)) return dir; } catch {}
  return null;
}

// ── Where an export picker should OPEN ──────────────────────────── [2026-09-22]
//
// ⚠️⚠️ `liveDir` ABOVE IS NOT ENOUGH FOR THE EXPORT DIALOGS, AND HE FOUND OUT THE HARD WAY.
// [B-291] guarded a remembered path we had STORED. The export pickers store nothing - they pass
// `defaultPath: 'name.zip'`, a bare filename with no directory - and when the path carries no
// directory, Windows falls back to ITS OWN memory of the last folder this app used. So the
// guard had nothing to guard: the stale location lives in the shell's MRU, not in our Store.
//
// Twice on 2026-09-22 that reopened the picker on a card that was gone, and Save hung the
// dialog. It is not only our dialog that stalls - a plain WMI enumeration of removable volumes
// from a separate process hung for 90 s at the same moment, because anything listing drives
// waits on the dead one.
//
// ⭐ HIS RULE, and it collapses to a single test: open the last location IF IT IS STILL LIVE,
// otherwise open at This PC. Whether the last place was removable stops mattering - a live card
// is a fine place to land, and a dead anything is not.
//
// ⚠️⚠️ AND THE LIVENESS TEST ITSELF MUST NOT BE ABLE TO HANG. `fs.existsSync` is exactly the
// call that stalled for 90 s on the stopped reader, and it is SYNCHRONOUS - using it here would
// move the freeze out of the dialog and into our main process, which is worse because it is
// ours. `fs.promises.access` blocks a threadpool thread instead, so the race below can give up
// and leave the app responsive.
// ⚠️⚠️ "OPEN AT THIS PC" WAS TRIED, MEASURED, AND REJECTED - 2026-09-22. DO NOT RE-ATTEMPT
// WITHOUT READING THIS. It is the obvious idea and it half-works, which is the worst kind.
//
// Measured with a probe (5 dialogs, including a control pointing at Downloads so "ignored
// entirely" could be told apart from "rejected this path"):
//
//   defaultPath                          opened at
//   ----------------------------------   -----------------------------
//   ::{20D04FE0-...-08002B30309D}        This PC          ✓
//   ::{20D04FE0-...}\probe.zip           I:\  (the MRU)   ✗
//   shell:MyComputerFolder               This PC          ✓
//   shell:MyComputerFolder\probe.zip     I:\  (the MRU)   ✗
//   <downloads>\probe.zip                D:\Downloads     ✓ (control - the mechanism works)
//
// ⭐ SO IT IS THIS PC *OR* A SUGGESTED FILENAME, NEVER BOTH. Electron takes one string for both
// and Windows only honours the shell path when it stands alone; add a filename and it silently
// falls back to its own MRU - the exact behaviour this whole helper exists to escape. And with
// the bare shell path, the CLSID itself lands in the File name box, which reads as broken.
// There is no separate name option on Windows (`nameFieldLabel` is macOS only).
//
// ⭐ HIS RULING: fall back to Downloads. Correct filename, ordinary folder, and never a path
// that can hang. The landing spot is polish; the defect - a picker opening on a card that left
// the machine, and blocking - is fixed by the liveness test either way.

async function liveDirSafe(dir, timeoutMs = 1500) {
  if (!dir) return null;
  try {
    const probe = fs.promises.access(dir).then(() => true, () => false);
    const timer = new Promise((r) => setTimeout(() => r(false), timeoutMs));
    return (await Promise.race([probe, timer])) ? dir : null;
  } catch { return null; }
}

// Returns what to hand `dialog.show*Dialog` as `defaultPath`.
//
// ⚠️ NEVER RETURN A BARE FILENAME. That is the original defect: with no directory, Windows uses
// its own memory of the last folder this app saved into, which is how a picker opened on a card
// that had left the machine and then blocked on Save. Always name a directory.
async function exportDefaultPath(storedDir, fileName) {
  const live = await liveDirSafe(storedDir);
  const dir = live || app.getPath('downloads');
  return fileName ? path.join(dir, fileName) : dir;
}
ipcMain.handle('dialog:open', async () => {
  const lastDir = liveDir(Store.get('lastDir'));
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
  const lastDir = liveDir(Store.get('lastDir'));
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
  const lastDir = liveDir(Store.get('lastDir'));
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

ipcMain.handle('toolchain:flash', async (_, { port, fqbn, expectedSN, sourceDir }) => {
  const log = makeLogger();
  await _abortVersionProbe?.();  // never let a version probe hold the port a flash needs

  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', { type: 'flash', ok: null, message: `Flashing on ${port}...` });
  }

  // expectedSN pins the flash to the board the user picked. Without it dfu-util targets
  // whichever board is in the bootloader, which is how a flash aimed at one board landed
  // on another (2026-07-26).
  const result = await toolchain.flash(port, fqbn, log, expectedSN, sourceDir);

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
// READ-ONLY. Answers whether a stored build exists and writes nothing - see checkOnly in
// cacheManager. Ten UI paths call this, including a typing debounce, and until 2026-08-23 every
// one of them silently rewrote the build folder. (B-216)
ipcMain.handle('cache:check', (_, { configContent, fqbn, usb, configId }) =>
  toolchain.checkCacheOnly(configContent, fqbn, usb, configId));

// Stamps an entry as used, at the moment a compile is skipped or a flash reads from it.
ipcMain.handle('cache:adopt', (_, { configHash, buildPkgHash, configId }) =>
  toolchain.adoptCacheEntry(configHash, buildPkgHash, configId));

// Save As inherits a build without touching a build input, so no check fires.
// Claim-only: append the new id, copy nothing.
ipcMain.handle('cache:claim', (_, { configContent, fqbn, usb, configId }) =>
  toolchain.claimCacheForConfig(configContent, fqbn, usb, configId));

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
      acquisitionDate: (metadata && metadata.acquisitionDate) || require('./localDate').localDateString(), // [B-339] local, not UTC
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
    // [B-328] Default to the PARENT of the last pick, not the pick itself.
    // Windows opens the dialog with defaultPath preselected in its parent's
    // view, so Select Folder returns the previous choice again unless the user
    // actively clears it - and zips are invisible in a folder picker, so a
    // set folder can look empty and the preselected subfolder like the only
    // option. One wrong pick then re-defaults every retry to the same wrong
    // folder. Opening BESIDE the last choice keeps the useful anchor without
    // re-answering the question on the user's behalf.
    const _storedRoot = Store.get('lastBulkImportRoot');
    const lastDir = liveDir(_storedRoot ? path.dirname(_storedRoot) : null) || app.getPath('home');
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
// ⚠️⚠️ A SET OF LIVE TOKENS, NOT ONE POINTER. [B-413]
//
// This was `let _bulkImportCancelToken = null`, reassigned at the top of every run, while each
// running import kept checking the token IT captured. Two defects fell out of that, and they
// disarm each other's runs in opposite directions:
//
//   1. A NEW run overwrote the pointer, so `bulkImport:cancel` only ever reached the LATEST run.
//      Any earlier one still going became permanently un-cancellable - clicking Cancel set a flag
//      nothing was reading.
//   2. The `finally` set the pointer to null. So when the OLD run finally ended it wiped the
//      pointer belonging to the NEW one, disarming that too.
//
// Observed 2026-09-18: he cancelled a 136-source import and the probe kept naming new sources for
// eight more minutes, marching alphabetically past the cancel point, while the modal was gone and
// the library was being written. He could see nothing at all.
//
// Cancel now means cancel EVERYTHING in flight, and each run removes only its own token.
// ⚠️ THE GATE LIVES IN ITS OWN MODULE so it can be tested (test/bulk-import-gate.test.js).
// Ten lines of state that went wrong twice while being written is exactly the thing that should
// not be sitting untestable inside main.js.
const _bulkGate = require('./bulkImportGate').createGate();

ipcMain.handle('bulkImport:run', async (e, { plan } = {}) => {
  // ⭐ ONE AT A TIME. Two concurrent imports both write the managed library, the content pool and
  // the hash index - and [B-407]'s "no duplicates ever" was never designed against two writers.
  // This is not a race worth supporting; it is one worth refusing.
  const myToken = _bulkGate.begin();
  if (!myToken) {
    return { ok: false, alreadyRunning: true,
             error: 'An import is already running. Wait for it to finish before starting another.' };
  }
  try {
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
    _bulkGate.end(myToken);   // only OUR token — never a blanket reset
  }
});

// ⚠️ Cancels EVERY live run, not just the most recent. If a previous run is somehow still going,
// the user's click should reach it too — that is the whole failure this replaces. [B-413]
ipcMain.handle('bulkImport:cancel', () => {
  return { ok: true, cancelled: _bulkGate.cancelAll() };
});

// ANALYZE phase: stage every planned source (zip + hash + dedup, no meta yet)
// and return real stats + per-source prepared/dup/corrupt results. Reuses the
// same progress event + cancel token as run.
ipcMain.handle('bulkImport:analyze', async (e, { plan } = {}) => {
  // [B-398] The freeze he screenshotted was during ANALYZE. Flush on the way out so the log
  // exists even if the run is cancelled or fails.
  // [B-413] Same guard as run: analyze stages and hashes into the store, so two at once is two
  // writers. This is the one he actually hit — a cancelled analyze that never stopped, then a
  // second analyze started on top of it.
  const _analyzeToken = _bulkGate.begin();
  if (!_analyzeToken) {
    return { ok: false, alreadyRunning: true,
             error: 'An import is already running. Wait for it to finish before starting another.' };
  }
  stallProbe.begin('bulkImport:analyze');
  // ⚠️ DECLARED ABOVE THE try, so the finally can reach it. A `const` inside the try is out of
  // scope there — a runtime ReferenceError that `node --check` passes happily. Same trap the
  // analyze loop in soundFontBulkImport already carries a warning about.
  try {
    const myToken = _analyzeToken;
    const result = await soundFontBulkImport.analyzeBulkImport(
      { plan, userData: app.getPath('userData') },
      {
        onProgress: (payload) => { try { e.sender.send('bulkImport:progress', payload); } catch {} },
        shouldCancel: () => myToken.cancelled,
      },
    );
    return result;
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    // ⚠️ ONLY OUR TOKEN. A blanket clear here would be the original bug wearing new clothes: it
    // would disarm any other live run exactly the way `= null` used to. [B-413]
    _bulkGate.end(_analyzeToken);
    stallProbe.end('bulkImport:analyze');
    stallProbe.flush('bulk import analyze');
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
// ⚠️ THE SECOND ONE WITH THE SAME DEFECT. [B-413] He asked "is that the only cancel that was
// broken?" and the honest answer was no: this held `let _bulkEnrichCancelToken = null`, reassigned
// per run and nulled in the finally — the identical shared-pointer bug as bulk import, where a new
// run disarms an older one and an ending run disarms a newer one.
//
// ⭐ Three OTHER cancels in this file were already correct and keyed per operation: sfBackup by
// opId (with its own "Op already running" refusal), sdcard health by jobId, core install by
// coreVersion. The codebase already knew the right answer; these two used a single variable.
// A rule applied in three places and missed in two is the standing failure this project keeps
// finding — the fix is not knowing better, it is sweeping for the shape.
const _enrichGate = require('./bulkImportGate').createGate();
ipcMain.handle('bulkImport:enrichGuided', async (e, { plan } = {}) => {
  const myToken = _enrichGate.begin();
  if (!myToken) {
    return { ok: false, alreadyRunning: true,
             error: 'A guided review is already being prepared. Wait for it to finish.' };
  }
  try {
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
    _enrichGate.end(myToken);
  }
});

ipcMain.handle('bulkImport:enrichCancel', () => {
  return { ok: true, cancelled: _enrichGate.cancelAll() };
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

// ⚠️⚠️ THIS DOOR HAD NO CANCEL UNTIL 2026-09-20, AND THE MODULE WAS READY THE WHOLE TIME.
// `extractTo` has accepted `opts.shouldStop` and threaded it into `_extractZipSubtree` all
// along; nothing here ever passed one. So the gap was a handler that never asked for a
// capability that already existed, which is why no amount of reading the extraction code
// would have revealed it.
//
// ⭐ IT WAS MISSED BECAUSE OF ITS NAME. Every sweep for export paths searched for "export",
// and this one is called extractTo - the same reason it sat outside the [B-005] cancel work
// on 09-19. Name the category by its EFFECT (it writes a user-chosen destDir) and it is
// obviously an export door.
ipcMain.handle('sources:extractTo', async (event, { uuid, path: subPath, destDir } = {}) =>
  _withExportCancel(async (shouldStop) => {
    const send = (payload) => {
      try { event.sender.send('sources:extractProgress', { uuid, ...payload }); } catch {}
    };
    try {
      const source = soundFontSources.openSource(app.getPath('userData'), uuid);
      if (!source) return { ok: false, error: `Source not found: ${uuid}` };
      const result = await source.extractTo(subPath || '', destDir, send, { shouldStop });
      return { ok: true, ...result };
    } catch (err) {
      // ⚠️ A cancel is an outcome, not a failure - without this the user's own click comes
      // back as a red "Export failed: Export cancelled", the exact shape `isCancel` exists
      // to prevent and the one that bit three other doors on 09-20.
      if (require('./sfExportCopy').isCancel(err)) return { ok: true, canceled: true };
      return { ok: false, error: String(err && err.message || err) };
    }
  }));

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
      // ⚠️ ONCE EVER, NOT ONCE PER LAUNCH - and the distinction is the whole
      // feature. `_entriesMigrationRan` above is a PROCESS flag, so it re-runs on
      // every start; a backfill behind it would stamp every newly imported font as
      // seen the next time the app opened. Import, restart, and NEW silently
      // empties. The persisted flag is what makes this a one-time upgrade step
      // rather than a nightly eraser. [B-213]
      // ⚠️ THE MARKER MOVED INTO THE LIBRARY. [B-297] It was a prefs.json key guarding a field that
      // lives on each entry's meta.json — two stores, desyncing both ways. Losing prefs re-ran the
      // backfill and stamped 109 genuinely-new entries as seen; restoring a library with prefs
      // intact would light every restored font up as NEW at once.
      // ⚠️ ONE-TIME ADOPTION, so an existing install does not re-run the backfill just because the
      // marker moved: if the old prefs key says done, write the new marker and stop. Without this
      // every current user's NEW set would be stamped once on upgrade — the exact bug, shipped as
      // the fix for it.
      try {
        const _ud = app.getPath('userData');
        if (!soundFontEntries.seenBackfillDone(_ud)) {
          if (Store.get('seenBackfillDone')) {
            soundFontEntries.markSeenBackfillDone(_ud);
            console.log('[seen] backfill marker adopted from prefs into the library');
          } else {
            const r = soundFontEntries.backfillSeenAt(_ud);
            soundFontEntries.markSeenBackfillDone(_ud);
            console.log(`[seen] one-time backfill stamped ${r.stamped} entries`);
          }
        }
      } catch {}
    }
    return { ok: true, entries: soundFontEntries.listEntries(app.getPath('userData')) };
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Stamp an entry as seen, so it stops being NEW. Idempotent and write-once;
// callers fire it freely and the first one wins. [B-213]
// Does this entry differ from the source archive it came from? [B-304]
// Cheap: a diff of two manifests already on disk, nothing extracted or re-hashed.
ipcMain.handle('entries:customization', (_, { name } = {}) => {
  try { return soundFontEntries.getEntryCustomization(app.getPath('userData'), name); }
  catch (err) { return { ok: false, known: false, error: String(err && err.message || err) }; }
});
// "Is this folder a font?" — asked BEFORE anything is copied, so a wrong pick
// costs the user a dialog rather than a bad entry attached to a real source.
ipcMain.handle('sources:inspectFolder', async (_, { folderPath } = {}) => {
  try { return await require('./soundFontCandidates').inspectFolderAsFont(folderPath); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('entries:markSeen', (_, { name } = {}) => {
  if (!name) return { ok: false, error: 'Missing name' };
  try { return { ok: true, stamped: soundFontEntries.markEntrySeen(app.getPath('userData'), name) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// [B-297] The reverse. One card at a time, from the right-click menu only - never bulk.
ipcMain.handle('entries:markNew', (_, { name } = {}) => {
  if (!name) return { ok: false, error: 'Missing name' };
  try { return { ok: true, cleared: soundFontEntries.markEntryNew(app.getPath('userData'), name) }; }
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

// ⚠️ `await`, because deleteEntry became async to retry a transient lock without freezing the
// window. A non-awaited promise would slip straight past this try/catch. [2026-09-24]
ipcMain.handle('entries:delete', async (_, { name } = {}) => {
  try {
    return await soundFontEntries.deleteEntry(app.getPath('userData'), name);
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

// folderSource ({ folderPath }) is the folder-attach path [B-304]: files come
// from a folder the user picked, identity still comes from the source named by
// sourceUuid + candidate. Absent on every other caller, which keeps the archive
// path byte-for-byte what it was.
ipcMain.handle('entries:create', async (event, { sourceUuid, candidate, name, metadata, folderSource } = {}) => {
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
      folderSource,
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

ipcMain.handle('fileOps:addFiles', async (event, { kind, id, subPath, sourceFilePaths, destNames } = {}) => {
  // [B-400] `event`, not `_` - same missing channel the tracks door had.
  try {
    const emit = _sfByteProgressEmitter(event);
    const r = await soundFontFileOps.addFilesAt({
      userData: app.getPath('userData'), kind, id, subPath, sourceFilePaths, destNames,
      onBytes: emit.onBytes,
    });
    emit.flush();
    return r;
  }
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
  // Same rule as the zip picker: last place if it is still live, Downloads otherwise. Passing no
  // defaultPath at all hands the choice to Windows' own MRU, which is how a picker lands on a
  // card that left the machine.
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose destination for sound fonts',
    defaultPath: await exportDefaultPath(Store.get('lastExportDir'), null),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  try { Store.set('lastExportDir', result.filePaths[0]); } catch {}
  return { ok: true, dirPath: result.filePaths[0] };
});

// Byte-progress emitter for the bulk-export handlers. Accumulates bytes and
// forwards them to the renderer as `soundFonts:exportProgress` events, but no
// more often than every ~80ms so a multi-GB export doesn't flood IPC. The
// renderer sums the deltas; flush() sends whatever's left so the sum stays
// exact (every byte copied is accounted for, no drift).
// [B-400] Progress for the +Add doors. ONE emitter and ONE channel for all three (tracks, font,
// common) - his rule from ui-conventions.md 2026-09-16: "if they all use the same style then it
// doesn't rely on us remembering to follow the rule but rather implement the pattern." Three
// hand-rolled bars would be three chances to drift.
//
// ⚠️ ABSOLUTE {done,total}, NOT A DELTA, unlike the export emitter below. The backends stream a
// hash in 64 KB chunks, so a large add produces thousands of ticks; throttling MUST drop most of
// them. A dropped delta is lost bytes and a bar that ends short, while a dropped absolute pair is
// simply a frame the user never saw. Self-correcting by construction.
// ⚠️⚠️ AND THE LAST ONE ALWAYS GOES. Throttling that can swallow the final tick is exactly the
// [B-389] defect - a bar that hands over before it reaches 100%.
function _sfByteProgressEmitter(event) {
  let last = 0;
  let pending = null;
  const send = (p) => {
    if (!p) return;
    try { event.sender.send('soundFonts:byteProgress', p); } catch {}
  };
  return {
    onBytes: (p) => {
      pending = p;
      const now = Date.now();
      if (now - last >= 80) { last = now; send(pending); pending = null; }
    },
    flush: () => { send(pending); pending = null; },
  };
}
function _sfExportProgressEmitter(event) {
  let acc = 0;
  let last = 0;
  // ⭐⭐ THE DELTA CHANNEL CARRIES A NAME TOO. [B-420, 2026-09-23 — his report on door 1:
  // "do we not have file names to fly by on this?"]
  //
  // Two channels report export progress: `soundFonts:byteProgress` sends ABSOLUTES and has
  // always carried a `name`, and this one sends DELTAS and had no name field at all. So the
  // doors on this pipe - "Export font folder…" and the common-folder export - showed bytes
  // climbing and never said what was moving, while funnel doors right beside them did.
  //
  // ⚠️ THE NAME WAS NOT MISSING UPSTREAM, IT WAS DROPPED HERE. `copyTreeWithProgress` hands its
  // sink `(chunkLength, relPath)`; this emitter took `(n)` and discarded the second argument
  // silently, which is the quietest way for a pipe to lose data.
  //
  // ⚠️ LAST-WRITER-WINS is the right rule for a name against an ACCUMULATED delta: the bytes are
  // a sum over the throttle window, and the only honest label for "what is happening now" is the
  // most recent file that window touched.
  let name = '';
  const send = () => {
    if (acc <= 0) return;
    try { event.sender.send('soundFonts:exportProgress', { delta: acc, name }); } catch {}
    acc = 0;
  };
  return {
    onBytes: (n, rel) => {
      acc += n;
      if (rel) name = String(rel);
      const now = Date.now();
      if (now - last >= 80) { last = now; send(); }
    },
    flush: send,
  };
}

// ── Cancelling an export ────────────────────────────────────── [B-005 item 4, 2026-09-19]
//
// ⭐⭐ THE EXIT IS THE HAZARD, NOT THE WAIT. He hit this on a real export: 109 MB to a card over
// mass storage, sat at 32.3 MB after two minutes, and "the only way out is potentially damaging -
// I'd have to force the app to close." Force-quitting mid-write to a FAT32 card is the precise
// failure the whole SD guard exists to prevent, so the app was offering a long operation whose
// only escape was the thing we spent the release preventing.
//
// ⭐ AND [B-238] MADE IT A PAIR. The slow-write warning now tells you before you start that this
// export will take much longer - and then gives you no way to act on it once running. Telling
// someone an operation is long while offering no exit is half a feature.
//
// ⚠️ ONE GATE FOR EVERY DOOR. Nine export doors, one cancel: a click cancels everything in flight
// rather than whichever run a pointer happened to be aimed at. That bug is not hypothetical - it
// is written up at the top of bulkImportGate.js, where it happened twice, which is also why this
// reuses that tested module instead of keeping its own copy of the state.
const _exportGate = require('./bulkImportGate').createGate({ exclusive: false });
ipcMain.handle('export:cancel', () => ({ ok: true, cancelled: _exportGate.cancelAll() }));

// ⭐ Every export handler wears the same three lines: take a token, hand `shouldStop` to the work,
// retire only your own token. Wrapped here so no door has to remember the order - and so `end()`
// lands in a finally, because a token left in the set makes the NEXT cancel report work it is not
// really doing.
// ⭐⭐ THE TOKEN CARRIES THE DESTINATION VERDICT. [B-005 item 4] The cleanup rule needs to know
// whether this is a board card, and that answer costs a ~1,900 ms PowerShell spawn - which
// must never be paid at the moment the user presses Cancel, since waiting is the whole
// complaint being fixed. The preflight already established it when the export STARTED, so the
// verdict rides here and cancel just reads it.
//
// ⚠️ `boardCard` DEFAULTS FALSE, AND THAT IS HIS RULING, NOT A SHORTCUT: "if we can't tell,
// then we assume it's not card through proffie. it's only card through proffie that's the long
// part." An unknown destination therefore gets the fast silent cleanup rather than a prompt
// nobody needed. Same degrade-to-safe as the [B-238] warning path.
//
// `wrote` is the running tally the cleanup decision needs - whether enough has landed that
// removing it would itself be slow enough to be worth offering rather than just doing.
async function _withExportCancel(run, opts = {}) {
  const token = _exportGate.begin();
  token.boardCard = !!opts.boardCard;
  token.wrote = { files: 0, bytes: 0 };
  try {
    return await run(() => !!(token && token.cancelled), token);
  } finally {
    _exportGate.end(token);
  }
}

// [B-402] `priorObserved` carries what the conflict scan already hashed for THIS destination in
// THIS operation, so the export can write the manifest once instead of the scan writing it and the
// export writing it again seconds later. It is an array of [relPath, [size, mtime, hash]] because
// it crosses the IPC boundary; the module rebuilds the Map.
ipcMain.handle('entries:exportToFolder', async (event, { name, destDir, mode, syncManifest, priorObserved, boardCard } = {}) => {
  // ⚠️ THIS ONE HANDLER IS TWO OF HIS DOORS. The right-click "Export font folder…" calls it once;
  // the REGULAR card export loops it, once per font. So cancelling here covers both, and the
  // bulk run stops at a font boundary as well as a file boundary. [B-005 item 4]
  //
  // ⭐⭐ `boardCard` COMES FROM THE RENDERER'S PREFLIGHT AND IS NOT RE-MEASURED. [B-005 item 4]
  // The cleanup rule needs to know whether this destination is a card behind a Proffieboard,
  // and that answer costs a ~1,900 ms PowerShell spawn. It was already established before the
  // write started; paying for it again at the moment the user presses Cancel would recreate
  // the exact complaint this work exists to fix.
  // ⚠️ Absent means FALSE, which is his ruling and not a shortcut: "if we can't tell, then we
  // assume it's not card through proffie." An unknown destination gets the fast, silent
  // cleanup rather than a prompt nobody needed.
  return _withExportCancel(async (shouldStop, token) => {
    try {
      const emit = _sfExportProgressEmitter(event);
      // The running tally decides whether a cleanup is big enough to be worth OFFERING rather
      // than just doing. It is kept on the token so one place owns it for every door.
      // ⚠️ onBytes takes a NUMBER - a chunk length - not a progress object. The first cut
      // read `p.done` off it and would have left the tally permanently zero, which reads
      // exactly like "nothing was written yet" and would have disabled the offer entirely.
      const r = await soundFontEntries.exportEntryToFolder(app.getPath('userData'), name, destDir, mode,
        // ⚠️ `rel` FORWARDED, NOT DROPPED. This wrapper sits between the copier and the emitter,
        // so a sink written as `(n)` is exactly where the filename dies - and it died the same
        // way at BOTH sites, which is why this is fixed as a pair. [2026-09-23]
        (n, rel) => { token.wrote.bytes += (Number(n) || 0); emit.onBytes(n, rel); },
        { syncManifest: syncManifest !== false, priorObserved, shouldStop,
          boardCard: !!token.boardCard, wrote: token.wrote });
      emit.flush();
      return r;
    } catch (err) {
      if (require('./sfExportCopy').isCancel(err)) return { ok: true, canceled: true };
      return { ok: false, error: String(err && err.message || err) };
    }
  }, { boardCard });
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

// [B-340] Content-identity answer for an incoming common folder, so the bulk
// chooser can promise exactly what the runner will do.
ipcMain.handle('common:classifyIncoming', (_, { folderPath } = {}) => {
  try { return { ok: true, ...soundFontCommon.classifyIncomingCommon(app.getPath('userData'), folderPath) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// What a picked common folder or zip would have refused, asked BEFORE the import
// runs so the dialog can offer a real choice ([B-214]).
ipcMain.handle('common:scanIncoming', async (_, { srcPath } = {}) => {
  try { return { ok: true, ...(await soundFontCommon.scanIncomingCommon(srcPath)) }; }
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

ipcMain.handle('common:addFiles', async (event, { uuid, subPath, sourceFilePaths } = {}) => {
  // [B-400] `event`, not `_` - the third door with no channel to report on.
  try {
    const emit = _sfByteProgressEmitter(event);
    const r = await soundFontCommon.addFilesToCommon(
      app.getPath('userData'), uuid, subPath, sourceFilePaths, emit.onBytes);
    emit.flush();
    return r;
  }
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
// Reads content; the marker is not consulted.
// ⚠️ ASYNC SINCE [B-398]. This used to be sync "because the cheap file-count/byte pre-check
// short-circuits the expensive path" — but the case that does NOT short-circuit is a genuinely
// different folder, which is exactly when it hashes 200+ files off the card and greys the window.
// ⚠️ THE `await` IS LOAD-BEARING, not cosmetic: without it the promise escapes this try/catch and
// a rejection becomes an unhandled one instead of the { ok:false } contract the renderer expects.
// ⚠️ GATED 2026-09-24 [B-420], same as its twin above.
ipcMain.handle('common:matchesAt', async (_, { uuid, destDir, targetName } = {}) => {
  return _withExportCancel(async (shouldStop) => {
  try {
    const r = await soundFontCommon.commonMatchesAt(app.getPath('userData'), uuid, destDir, targetName,
                                                    shouldStop);
    require('./sfSyncManifest').report('compare common "' + String(targetName || 'common') + '"');
    return r;
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
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

// Export a common OUT OF THE APP as a portable zip. Deliberately separate from
// common:exportToFolder, which is the SD-card path - different verb, different
// output, no manifest, no conflict prompt. (2026-08-31.)
//
// TWO handlers, not one, and the split is the point: the renderer cannot show a
// progress modal until it knows there is work to do. Folded together, the modal
// went up, the OS save dialog opened on top of it, and the bar sat at zero for as
// long as the user browsed for a folder - progress reported for a job that had
// not started, which is the same class of lie as a stale "Flash successful".
ipcMain.handle('common:pickExportZipPath', async (event, { uuid } = {}) => {
  try {
    const list = soundFontCommon.listCommons(app.getPath('userData'));
    const c = list.find(x => x.uuid === uuid);
    if (!c) return { ok: false, error: 'Common folder not found' };
    const packName = (c.meta && c.meta.name) || 'common';
    // Sanitise for a FILENAME only. The name inside the zip keeps the real
    // pack name; only the file on disk has to survive the filesystem.
    const safeFile = String(packName).replace(/[\/:*?"<>|]/g, '_').trim() || 'common';
    const win = BrowserWindow.fromWebContents(event.sender);
    // ⚠️ THIS LINE WAS `defaultPath: safeFile + '.zip'` AND IT HUNG HIS APP TWICE ON 2026-09-22.
    // A bare filename carries no directory, so Windows used its own memory of the last folder
    // this app saved into - a card that was no longer there - and the dialog blocked on Save.
    // [B-291]'s `liveDir` could not help: there was no stored path to validate.
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export common folder',
      defaultPath: await exportDefaultPath(Store.get('lastExportDir'), safeFile + '.zip'),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    // Remember it so the next export lands where the last one did - and so there IS a stored
    // path for the liveness test to have an opinion about.
    try { Store.set('lastExportDir', path.dirname(filePath)); } catch {}
    return { ok: true, filePath, name: packName };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('common:exportAsZip', async (event, { uuid, destPath } = {}) => {
  return _withExportCancel(async (shouldStop) => {                       // [B-005 item 4]
    try {
      if (!destPath) return { ok: false, error: 'Missing destPath' };
      const emit = _sfExportProgressEmitter(event);
      const r = await soundFontCommon.exportCommonAsZip(app.getPath('userData'), uuid, destPath, emit.onBytes,
        { shouldStop });
      emit.flush();
      return r;
    } catch (err) {
      if (require('./sfExportCopy').isCancel(err)) return { ok: true, canceled: true };
      return { ok: false, error: String(err && err.message || err) };
    }
  });
});

ipcMain.handle('common:exportToFolder', async (event, { uuid, destDir, mode, targetName, priorObserved, boardCard } = {}) => {
  // ⭐ `boardCard` and the running tally ride through exactly as they do for the font export,
  // so a cancelled voice pack gets the same offer instead of a silent per-file delete across
  // the bridge. Established by the renderer's preflight; never re-measured here. [B-005 item 4]
  return _withExportCancel(async (shouldStop, token) => {                // [B-005 item 4]
    try {
      const emit = _sfExportProgressEmitter(event);
      const r = await soundFontCommon.exportCommonToFolder(app.getPath('userData'), uuid, destDir, mode,
        // ⚠️ `rel` FORWARDED, NOT DROPPED. This wrapper sits between the copier and the emitter,
        // so a sink written as `(n)` is exactly where the filename dies - and it died the same
        // way at BOTH sites, which is why this is fixed as a pair. [2026-09-23]
        (n, rel) => { token.wrote.bytes += (Number(n) || 0); emit.onBytes(n, rel); },
        targetName, { priorObserved, shouldStop, boardCard: !!token.boardCard, wrote: token.wrote });
      emit.flush();
      return r;
    } catch (err) {
      if (require('./sfExportCopy').isCancel(err)) return { ok: true, canceled: true };
      return { ok: false, error: String(err && err.message || err) };
    }
  }, { boardCard });
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
ipcMain.handle('sharedTracks:addFiles', async (event, { sourceFilePaths } = {}) => {
  // [B-400] `event`, not `_`. The handler took no event at all, so there was no channel to
  // report on - the producer inside addFiles had existed since [B-281] and nothing here could
  // ever have used it.
  try {
    const emit = _sfByteProgressEmitter(event);
    // ⚠️ Under the SHARED gate, not a private flag. The gate is what `export:cancel` flips, and a
    // second copy of this state is the one thing [B-005] item 4 proved must not be duplicated.
    const r = await _withExportCancel(async (shouldStop) =>
      soundFontSharedTracks.addFiles(
        app.getPath('userData'), sourceFilePaths, null, emit.onBytes, shouldStop));
    emit.flush();
    return r;
  }
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
// Read-only: what would an export add, leave alone, or have to ask about.
// Top-level folder names at an export destination. Used by the save summary to
// answer "what else is on this card" without pulling in a full SD scan.
// [B-402] `writeCache` is accepted and ignored — the compare no longer writes at all, for any
// caller, so the flag [B-358] added has nothing left to switch off. Kept in the signature so an
// older renderer passing it cannot throw; drop it once nothing sends it.
// ⚠️ GATED 2026-09-24 [B-420] so a cancel can reach the hashing. Read-only, so stopping costs
// nothing and leaves nothing behind.
ipcMain.handle('soundFonts:entryMatchesAt', async (event, { name, destDir, reportProgress } = {}) => {
  return _withExportCancel(async (shouldStop) => {
  // [B-400] The destination-side hashing is the expensive half of this question and ran silent
  // behind a right-click Export. Opt-in: the bulk conflict scan drives its own bar already and
  // must not have a second one fighting it.
  // ⚠️⚠️ AWAIT, NOT FIRE-AND-RETURN. [B-398] made entryMatchesAt async, and without the await here
  // emit.flush() would run BEFORE any progress had been gathered — flushing an empty buffer and
  // leaving the bar dead for the whole compare. Electron would still resolve the returned promise,
  // so the result would look right while the progress reporting this handler exists for was gone.
  try {
    const emit = reportProgress ? _sfByteProgressEmitter(event) : null;
    const r = await soundFontEntries.entryMatchesAt(app.getPath('userData'), name, destDir,
      emit ? { onBytes: emit.onBytes, shouldStop } : { shouldStop });
    if (emit) emit.flush();
    // [B-173] One line per font in the `npm start` terminal. The loop over fonts is in the
    // renderer, so this handler IS the per-item boundary and the totals are cumulative for
    // the borrow: parses should read 1 for a whole scan while reuses climbs with it.
    require('./sfSyncManifest').report('compare font "' + String(name) + '"');
    return r;
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
});
// Record a folder the user chose to KEEP, so the work is paid for once rather than on every scan.
// Partner to the compare above: that one stops as soon as a file count proves a difference, and
// this one does the reading afterwards, only for folders Skip was answered for.
ipcMain.handle('soundFonts:recordFolderAt', async (event, { name, destDir } = {}) => {
  return _withExportCancel(async (shouldStop) => {
    // ⚠️ `event`, not `_`. Reading a folder off a card is whole wavs per file, so the phase needs
    // to move within a folder and not only between them - the same channel and the same emitter
    // `entryMatchesAt` already reports its destination-side hashing on.
    const emit = _sfByteProgressEmitter(event);
    try {
      const r = await soundFontEntries.recordFolderAt(destDir, name,
        { shouldStop, onBytes: emit.onBytes });
      emit.flush();
      require('./sfSyncManifest').report('record kept "' + String(name) + '"');
      return r;
    }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
});
// [B-402] THE ONE WRITER. Every compare and every export now RETURNS what it learned; the
// renderer accumulates it across the whole operation and commits here, once, at the end.
// ⚠️ `items` is { itemName: [[relPath,[size,mtime,hash]], ...] } because Maps do not survive IPC.
// ⚠️ A cancelled operation simply never calls this, which is the whole point: a question leaves
// nothing behind, and a completed operation records everything it saw — including items it only
// LOOKED at, which the per-item write used to drop.
ipcMain.handle('syncManifest:commit', (_, { destDir, items, complete } = {}) => {
  try {
    if (!destDir || !items) return { ok: false, error: 'Missing destDir or items' };
    // ⚠️ `complete` names the items whose observations are the WHOLE folder. Only those may
    // have records removed; everything else merges as before.
    const wrote = require('./sfSyncManifest').mergeItems(destDir, items,
      { complete: Array.isArray(complete) ? complete : [] });
    return { ok: true, wrote: !!wrote };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// ── Export destination: will it fit, and what is it attached to? ── [B-203]
//
// Two handlers because the costs differ by four orders of magnitude and callers must be
// able to choose. Measured on his machine 2026-09-19:
//   exportDest:check     0.3 ms   statfs only, safe anywhere, including before every write
//   exportDest:classify  1.9 ms   ...thousand. One PowerShell spawn. Never on a write path.
//
// ⚠️ check RUNS UNCONDITIONALLY, not only for removable media. The rule it serves was
// "check free space on exports to removable media", but establishing removable-ness costs
// 2.4-3.2s against 0.3ms for the fit answer itself - the gate was 12,000x the thing it
// gated. Checking everywhere is both cheaper and more correct, since a full internal disk
// truncates an export exactly as a full card does.
ipcMain.handle('exportDest:check', async (_, { destDir, fileSizes, totalBytes, dirCount } = {}) => {
  try {
    const r = await require('./exportDestination').checkFit(destDir, { fileSizes, totalBytes, dirCount });
    return { ok: true, result: r };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// ── The one preflight every door runs ───────────────── [B-005 item 4, B-203, B-238]
//
// ⭐⭐ ONE CALL, FOUR CONSUMERS: the fit refusal, the board-card warning, the cancel-cleanup
// rule, and the safe-eject offer. They were three questions asked in two different
// architectures with the board-card test written out twice; this is the single entry point
// and the reason the duplication can go.
//
// ⭐ `classify: true` pays the ~1,900 ms PowerShell spawn ONCE and the answer feeds all four -
// `transport` for the warning and the cleanup rule, `removable` for the eject offer.
// ⚠️⚠️ NEVER CALL THIS AT CANCEL TIME OR EJECT TIME. Two seconds at the moment a user presses
// Cancel would recreate the exact complaint this work exists to fix. The verdict is captured
// when the export STARTS and carried on the gate token.
// ⭐ And for a small job the caller can start it CONCURRENTLY with the work rather than ahead
// of it: the eject offer is not needed until the end, so the spawn overlaps the copy and
// costs nothing perceptible.
// ── Remove a partial this app set aside ─────────────────────── [B-005 item 4]
//
// ⚠️⚠️ THE NAME IS THE PERMISSION, AND THAT GUARD IS THE ENTIRE SAFETY ARGUMENT. A renderer
// that can ask main to recursively delete an arbitrary path is a foot-gun that outlives the
// feature it was added for - and this project has already paid once for a delete aimed at a
// path it did not own (708 MB, 2026-09-02). So this refuses anything whose final segment is
// not a folder WE minted: the `DELETE.` prefix is written by the cancel path and nowhere
// else, so a bug that passed the wrong path simply fails instead of destroying something.
//
// ⭐ It also means the user can act without us. Whatever they answer to the offer, the folder
// on the card says DELETE. in plain words, so "I'll clear it in Explorer later" is a real
// option rather than an abandoned mess.
ipcMain.handle('fs:removeSetAside', async (_, { target } = {}) => {
  try {
    const p = String(target || '');
    const leaf = path.basename(p);
    if (!p || !/^DELETE\./i.test(leaf)) {
      return { ok: false, error: 'refused: not a set-aside folder' };
    }
    // ⚠️ Retried for the same reason the cancel path retries: on Windows a directory holding
    // a file with an open handle cannot be removed, and a handle can outlive the write.
    for (let i = 0; i < 4; i++) {
      try { await fs.promises.rm(p, { recursive: true, force: true }); return { ok: true }; }
      catch (e) {
        if (i === 3) return { ok: false, error: String(e && e.message || e) };
        await new Promise((r) => setTimeout(r, 150 * (i + 1)));
      }
    }
    return { ok: false, error: 'unreachable' };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// ── Safely eject removable media after an export ────────────── [B-005 item 4]
//
// ⭐ VERIFIES BY OBSERVATION. The shell's Eject verb is fire-and-forget, so the module polls
// the filesystem until the media has been gone for a stable second. See safeEject.js for why
// that instrument and not volume enumeration - measured on his bench, where enumeration would
// have been wrong about two of three transports.
// ⚠️ Takes a drive letter, not a path: the eject is per-VOLUME, because one physical reader
// can hold two letters and a device-level eject would take a sibling card with it.
// ⚠️ TAKES A DESTINATION PATH, NOT A DRIVE LETTER. The letter was the Windows shape leaking
// into a shared contract; the module resolves a destination to whatever its platform watches
// (`E:\`, `/Volumes/NAME`, `/media/<user>/NAME`). Changing this now, while only Windows is
// implemented, is what makes the macOS and Linux ports additions behind an unchanged seam
// rather than a signature change that would force the Windows paths to be retested.
ipcMain.handle('media:eject', async (_, { destDir, timeoutMs } = {}) => {
  try {
    const r = await require('./safeEject').ejectVolume(destDir, { timeoutMs });
    return { ok: true, result: r };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// ⭐⭐ THE PER-OS VOCABULARY, ASKED FOR ONCE. His requirement: "if I build a Mac build, it
// doesn't use the Windows language or any of that. It has its own version."
//
// ⚠️ AND THE DIFFERENCE IS NOT ONLY WORDING - one message must not EXIST on some platforms.
// `lingersAfterEject` is true on Windows, where the drive letter stays listed as an empty
// drive and the success message has to say so or it contradicts what the user can see. On
// macOS and Linux the mount point goes away, so that same sentence would be a lie. A plain
// string table would have shipped the Windows explanation to every platform.
// ⚠️ THE RENDERER MUST NOT DECIDE WHAT LOOKS LIKE A VOLUME. It used to gate the eject offer on
// `/^[A-Za-z]:/` and derive a label with `slice(0,1)` — both Windows shapes, and the gate alone
// would have made the offer never appear on macOS, where a destination is `/Volumes/NAME`.
// Resolution belongs to the platform table: null means "nothing here to eject", whatever the OS.
ipcMain.handle('media:resolve', (_, { destDir } = {}) => {
  try { return { ok: true, target: require('./safeEject').resolveTarget(destDir) }; }
  catch { return { ok: true, target: null }; }
});


ipcMain.handle('media:vocabulary', () => {
  try { return { ok: true, vocab: require('./safeEject').vocabulary() }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// The OS-specific sentences themselves, resolved in main so no renderer string names an
// operating system. Returns null when a platform has no such note - which is the signal to
// omit the line entirely rather than substitute a generic one.
ipcMain.handle('media:note', (_, { kind, label } = {}) => {
  try { return { ok: true, note: require('./safeEject').noteFor(kind, label) }; }
  catch { return { ok: true, note: null }; }
});

// Cheap enough to call freely - a stat, not a spawn. Used to decide whether an eject offer
// still makes sense by the time an export finishes.
ipcMain.handle('media:present', (_, { driveLetter } = {}) => {
  try { return { ok: true, present: require('./safeEject').mediaPresent(driveLetter) }; }
  catch { return { ok: true, present: false }; }
});

ipcMain.handle('exportDest:preflight', async (_, args = {}) => {
  try {
    const r = await require('./exportDestination').preflight(args.destDir, args);
    return { ok: true, result: r };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// Slow, and deliberately separate. Start it when a destination is chosen and read it
// later; never await it between a user's click and the work starting.
ipcMain.handle('exportDest:classify', async (_, { destDir } = {}) => {
  try {
    const r = await require('./exportDestination').describe(destDir, { classify: true });
    return { ok: true, result: r };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// ── "What did the user just hand us?" ─────────────────────────────── [B-005 item 4]
//
// ⭐⭐ THE CHEAP HALF OF `classify`, AND THE REASON IT IS A SEPARATE DOOR. Measured on his
// machine 2026-09-21: this is ~85 ms where `exportDest:classify` is ~1,900-2,600 ms, because
// it never starts PowerShell. Every export wants to know whether the destination is removable
// (that is the whole safe-eject decision); almost none of them need to know whether it is a
// board card, and those that do are gated on a size threshold.
//
// ⚠️ THIS IS SAFE ON A WRITE PATH, unlike its expensive neighbour. See the cost table above
// `exportDest:check` - this belongs in the same tier as statfs, not in the classify tier.
//
// ⭐ His framing, which is what produced the split: "we don't have to do everything in the
// identify... so genuinely fast and tiny logic on it."
ipcMain.handle('exportDest:identify', async (_, { destDir } = {}) => {
  try {
    const k = await require('./exportDestination').driveKind(destDir);
    // ⚠️ null is a real answer and means "cannot tell" - off Windows, or an unrecognised
    // drive type. Callers must not read it as "fixed". [B-028]
    return { ok: true, result: k };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('soundFonts:listDestFolders', (_, { destDir } = {}) => {
  try {
    if (!destDir || !fs.existsSync(destDir)) return { ok: true, folders: [] };
    // ⚠️⚠️ THE OPERATING SYSTEM'S OWN FOLDERS ARE NOT FONTS. [B-420, 2026-09-24]
    //
    // This filtered dot-prefixed names only, which covers macOS (`.Spotlight-V100`, `.Trashes`)
    // and misses the one that matters on the platform this app mostly runs on: Windows creates
    // `System Volume Information` on EVERY removable volume it writes to. So it was counted as a
    // font at the destination.
    //
    // ⭐ HIS CATCH, on a freshly formatted card: *"29 fonts written... but 30 fonts at the
    // destination"*. 29 fonts + `common` + `tracks` + SVI = 32 folders; the caller reserves
    // `common` and `tracks`, leaving 30 - and the one not in the selection was SVI, reported as
    // "1 not part of this export". Both numbers off by exactly that folder.
    // ⚠️ IT WAS WRONG ON EVERY CARD EXPORT, not just this one. A fresh card makes it visible
    // because the true count is knowable at a glance; on a populated card it silently inflated
    // the total by one and asserted a stray font that was never there.
    //
    // ⚠️ MATCHED BY NAME, CASE-INSENSITIVELY, because Node's Dirent carries no Windows file
    // attributes - `hidden` and `system` are not reachable from readdir or stat here, so the
    // attribute test that would be more general is not available.
    // ⚠️ `found.NNN` is chkdsk's recovered-cluster output. It appears exactly when a card has been
    // repaired, which is precisely when someone is looking at a destination listing and trying to
    // work out what is really on their card.
    const OS_FOLDERS = new Set([
      'system volume information',
      '$recycle.bin',
      'recycler',
      'msocache',
      'system~1',
    ]);
    const folders = fs.readdirSync(destDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .filter(e => !OS_FOLDERS.has(e.name.toLowerCase()) && !/^found\.\d{3}$/i.test(e.name))
      .map(e => e.name);
    return { ok: true, folders };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
// ⚠️⚠️ GATED 2026-09-24 [B-420]. This is a pure READ - it hashes tracks to decide what a later
// export would write - and it had no cancel at all, so the primary export's scan sat through every
// remaining track after the user pressed Cancel. His report: *"it goes through about 10-20 more
// files before it cancels... it says stopping and files are still flying by."*
// ⭐ And his argument, which is the whole justification: *"why would it need to do anything if all
// it was doing was analyzing? there's not a copy being made... so it should just stop."*
ipcMain.handle('sharedTracks:planExport', async (event, { destDir } = {}) => {
  return _withExportCancel(async (shouldStop) => {
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
    const r = await soundFontSharedTracks.planExport(app.getPath('userData'), destDir, onFile, shouldStop);
    require('./sfSyncManifest').report('compare tracks');
    return r;
  }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
});
ipcMain.handle('sharedTracks:exportToFolder', async (event, { destDir, mode, replace } = {}) => {
  return _withExportCancel(async (shouldStop) => {                       // [B-005 item 4]
  try {
    const emit = _sfExportProgressEmitter(event);
    // Additive is the default for the bulk flow: nothing at the destination is
    // ever deleted, and a same-name file that differs is resolved per file by
    // `replace` (the renderer collects that from the differences dialog). The
    // older skip/replace/rename whole-folder modes stay reachable for callers
    // that still ask for them explicitly.
    const r = (!mode || mode === 'additive')
      ? await soundFontSharedTracks.exportToFolderAdditive(app.getPath('userData'), destDir, { replace, onBytes: emit.onBytes, shouldStop })
      : await soundFontSharedTracks.exportToFolder(app.getPath('userData'), destDir, mode, emit.onBytes, { shouldStop });
    emit.flush();
    return r;
  } catch (err) {
    if (require('./sfExportCopy').isCancel(err)) return { ok: true, canceled: true };
    return { ok: false, error: String(err && err.message || err) };
  }
  });
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
// ⚠️ A THIN REGISTRATION OVER AN IMPL FUNCTION, and the shape is the point: this handler has a
// dozen early returns (cancelled picker, refused program, tooBig, slowWrite, probe), and a token
// taken at the top of it would leak out of every one of them. A leaked token is not harmless -
// it stays in the gate's set, so the NEXT cancel reports work it is not really stopping. One
// wrapper, one finally, every exit covered. [B-005 item 4]
ipcMain.handle('sfFile:export', async (event, args = {}) =>
  _withExportCancel((shouldStop) => _sfFileExportImpl(event, args, shouldStop)));

// ⭐ `destFile` IS THE SINGLE-FILE TWIN OF `destDir`. [2026-09-22] Both exist so the RENDERER can
// own the picker and the runner can own everything after it. Without it the single-file branch
// opens its own save dialog partway through its own work, and any bar raised around that call sits
// at zero BEHIND a native dialog for as long as the user is choosing - which reads as a hang, and
// is the reason this branch could not migrate with the multi-path one.
async function _sfFileExportImpl(event, { kind, id, paths, suggestedName, asFile, destDir: preDest, destFile: preFile, confirmSlow, probe } = {}, _shouldStop = null) {
  // [B-408] ⚠⚠ THE PICKER USED TO OPEN PARTWAY THROUGH THIS CALL, and that is why this door was
  // the one export with no progress at all. A bar raised around it would sit at zero BEHIND a
  // native dialog for as long as the user was choosing a folder - which reads as a hang, the
  // exact failure _sfExportSourceToDownloads already warns about. A wrapper could not fix that;
  // the ORDER had to change.
  // ⭐ preDest lets the renderer ask FIRST, so the destination is known before any work starts
  // and a bar can be honest from its first frame. Only the MULTI-PATH branch takes it, because
  // that is the only branch the renderer can identify without probing whether a path is a
  // directory - and it is the only one where progress is worth anything. The single-file and
  // single-folder branches keep their own pickers and their instant click.
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
  // ⚠️ THE RIGHT-CLICK DOOR IS A DOOR TOO ([B-214] follow-on, 2026-09-11: "I need to
  // ensure that we are blocking the same way exports of individual files from right
  // click"). Every other way out of the managed store already refuses a program - the
  // whole-entry export, the whole-common export, the source archive export, and the
  // save-to-Downloads per-file route (exportEntryFileTo / exportSourceFileTo). This
  // handler had its own readBytes + writeFileSync and no check at all, so the Export
  // item on every file context menu in the app walked past all of them. It is the
  // WIDEST door of the set: eleven call sites across entry, source, common and
  // sharedTracks funnel through here.
  //
  // PROGRAMS ONLY, matching the export convention in sfExportCopy. A macro document is
  // refused on the way IN to a common folder; it is not stripped on the way out.
  //
  // COLLECTED, NEVER SILENTLY DROPPED, and returned to the caller: an unexplained
  // omission during an export is its own kind of dishonesty. A file that is refused is
  // skipped rather than failing the export - the rest of the selection still goes.
  const refused = [];
  const _note = (v, relPath) => {
    if (!v.blocked) return false;
    refused.push({ relPath: String(relPath), kind: v.kind, reason: v.reason, disguised: !!v.disguised });
    return true;
  };
  const refuseBuf = (buf, relPath) =>
    _note(require('./sdCardDetect').checkCarryable(buf && buf.subarray(0, 256), relPath), relPath);
  const refusePath = (absPath, relPath) =>
    _note(require('./sdCardDetect').checkCarryableFile(absPath, relPath), relPath);
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
  // ⭐ `onChunk(bytesWritten, relPath)` is optional and threaded to every write below, so a
  // folder export reports as it copies instead of in one lump at the end. [B-420, 2026-09-23]
  // ⚠️ All THREE branches take it - the two inner-zip walks and the on-disk tree. Wiring only
  // the tree would leave a source-folder export looking exactly as hung as before, which is the
  // per-caller shape this whole migration exists to stop.
  const writeDirTo = async (subPath, outRoot, onChunk = null) => {
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
          if (_shouldStop && _shouldStop()) throw new (require('./sfExportCopy').ExportCancelled)();
          if (entry.isDir) continue;
          const innerFlat = entry.fileName.slice(innerZipPath.length + 1);
          const innerRel = insidePrefix ? innerFlat.slice(insidePrefix.length) : innerFlat;
          if (!innerRel) continue;
          const outPath = path.join(outRoot, innerRel.replace(/\//g, path.sep));
          // source.readFile is composite-aware — entry.fileName carries the
          // full composite path, so the inner-zip layer gets peeled by the
          // resolver automatically.
          // Read and check BEFORE mkdir, so refusing a file does not leave an
          // empty directory behind at the destination.
          const buf = await source.readFile(entry.fileName);
          if (refuseBuf(buf, entry.fileName)) continue;
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          // [B-005 item 4] Chunked + cancellable; writeFileSync blocked the event loop so
          // the cancel IPC could not even be delivered while it ran.
          await require('./sfExportCopy').writeBufferWithProgress(buf, outPath,
            onChunk ? ((n) => onChunk(n, innerRel)) : null, _shouldStop);
        }
        return;
      }
      const source = soundFontSources.openSource(userData, id);
      const all = await source.listAll();
      const prefix = subPath.endsWith('/') ? subPath : subPath + '/';
      for (const entry of all) {
        if (_shouldStop && _shouldStop()) throw new (require('./sfExportCopy').ExportCancelled)();
        if (entry.isDir) continue;
        if (!entry.fileName.startsWith(prefix)) continue;
        const innerRel = entry.fileName.slice(prefix.length);
        if (!innerRel) continue;
        const outPath = path.join(outRoot, innerRel.replace(/\//g, path.sep));
        const buf = await source.readFile(entry.fileName);
        if (refuseBuf(buf, entry.fileName)) continue;
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        // [B-005 item 4] Chunked + cancellable - see the note on the sibling branch above.
        await require('./sfExportCopy').writeBufferWithProgress(buf, outPath,
          onChunk ? ((n) => onChunk(n, innerRel)) : null, _shouldStop);
      }
      return;
    }
    const root = kind === 'entry'
      ? path.join(userData, 'soundFonts', 'library', id)
      : path.join(userData, 'soundFonts', 'common', id, 'files');
    const srcAbs = path.join(root, subPath);
    // ⚠️⚠️ A SYNCHRONOUS WALK CANNOT BE CANCELLED, AND IT FROZE THE APP. [B-005 item 4]
    //
    // This used to be `copyFileSync` inside a `readdirSync` loop - not one await anywhere in it.
    // Main's event loop never yielded, so the `export:cancel` IPC could not even be DELIVERED
    // until the export had finished. From the outside: the window went "Not Responding", the
    // Cancel button did nothing, and the export completed anyway. His report, exactly: "right
    // click from font selected items turned to unresponsive while attempting to cancel. export
    // still finished."
    //
    // ⭐ A cancel flag is worthless if nothing can set it. The flag was fine; the loop was the
    // bug - the same not-yielding defect as [B-398]'s rmSync, in a different function.
    //
    // ⭐ FIXED BY DELETING IT rather than sprinkling awaits. copyTreeWithProgress is the shared
    // async copier that fonts and voice packs already use - it awaits a streamed copy per file,
    // so it yields between files by construction, and it ALREADY carries the shouldStop check at
    // the top of its loop. That is why cancelling a font export worked while this one hung.
    const { copyTreeWithProgress } = require('./sfExportCopy');
    const _walkRefused = [];
    await copyTreeWithProgress(srcAbs, outRoot, {
      // ⚠️ Same guard, same shape: copyTreeWithProgress runs checkCarryableFile itself and
      // collects what it refuses, which is what `refusePath` was doing here by hand.
      refused: _walkRefused,
      shouldStop: _shouldStop,
      relBase: subPath,
      onBytes: onChunk ? ((n, rel) => onChunk(n, rel)) : null,
    });
    // ⭐ A QUIET IMPROVEMENT WORTH NOTING: the old walk recorded a refusal under `ent.name` -
    // the bare basename. copyTreeWithProgress threads relBase, so a refusal now carries its
    // full relative path, which is what the removal buttons need to resolve the finding back
    // to a real file ([B-364]: "hum2.wav" does not say which folder).
    for (const b of _walkRefused) refused.push(b);
  };
  const lastDir = liveDir(Store.get('lastExportDir')) || app.getPath('downloads');
  // ⭐⭐ ONE FOLDER IS NOT A SPECIAL CASE, AND TREATING IT AS ONE LEFT IT UNGUARDED.
  // [B-203, B-238]
  //
  // This branch used to own the whole single-folder export: its own picker, its own
  // collision suffix, its own write, its own return - all of it BEFORE the sizing block,
  // the fit check and the slow-write warning further down. So "↗ Export folder…" on a
  // source or a font wrote through a Proffieboard with no warning and onto a full card
  // with no refusal, while the very same folder reached by multi-selecting its files got
  // both. He found the ordering bug on the multi-select door; this one would have been
  // next, and it fails SILENTLY rather than in the wrong order.
  //
  // ⭐ The duplicate is now deleted rather than patched. The shared flow below already
  // handles a directory in `paths` - same " (N)" collision walk, same writeDirTo - so a
  // lone folder just falls through to it and inherits the sizing and both guards. Only the
  // dialog TITLE was worth keeping, and it is carried down.
  //
  // ⚠️ IT STILL GETS NO PROGRESS BAR on the first call, and that is not an oversight. A bar
  // needs the destination up front, and the renderer cannot supply one without first
  // probing whether this path is a file or a folder - a delay between the click and the
  // picker, which is the one thing this door has always refused to pay.
  //
  // ⚠️ A single FILE still keeps its own branch: it needs a SAVE dialog, not a folder
  // picker, which the shared flow has no way to express.
  const _singleIsDir = paths.length === 1 && !asFile && await isDirAtPath(paths[0]);
  const _folderPickTitle = _singleIsDir
    ? `Export "${suggestedName || paths[0].split('/').pop() || 'untitled'}" folder to…`
    : null;
  // Single-FILE mode: save dialog, written at the path the user names.
  // asFile=true short-circuits the dir probe — used by "Export ZIP…" on an inner-zip node,
  // where the user wants the raw .zip bytes exported as a standalone file rather than the
  // contents extracted. Same path is conceptually both, so the caller picks the semantics.
  // ⚠️⚠️ `preDest || preFile` - THE GATE WAS HALF THE DESTINATIONS. [B-420, 2026-09-23]
  //
  // This read `preDest` alone, and `preDest` is the destination FOLDER. A single-file export
  // supplies `preFile` instead, so the renderer had picked a destination, was showing a bar and
  // waiting for ticks, and this decided nobody was listening. Combined with the probe defect
  // above it is why a one-file export reported nothing at all.
  // ⭐ The question the gate is asking is "did the renderer choose the destination, and is
  // therefore driving a bar?" - and either field answers it. Neither alone does.
  const _emit = ((preDest || preFile) && !probe) ? _sfByteProgressEmitter(event) : null;
  let _bDone = 0, _bTotal = 0;
  // [B-238] File count matters more than bytes on a slow transport (773 ms per file
  // measured through a board), so the threshold needs both.
  let _bFiles = 0;

  // ⚠️⚠️ `!probe` IS LOAD-BEARING AND ITS ABSENCE WAS A REAL DEFECT. [B-420, 2026-09-23]
  //
  // This branch never looked at `probe`, and the probe return lives at the BOTTOM of the
  // handler, past the multi-path flow - so a single-file probe fell in here and did the whole
  // export: read, write, remember the folder, report success. The runner then called `produce`
  // and wrote the identical file a SECOND time.
  //
  // ⭐ Three symptoms, one cause, all of them his: the file written twice; a bar that never
  // moved because the probe returned no `totalBytes`, so the runner ran at `total: 0`; and a
  // post-write "Not enough room" instead of a refusal, because the preflight reads 0 bytes as
  // "cannot measure" and correctly declines to refuse. The fit check simply never ran.
  //
  // ⭐ Falling THROUGH rather than sizing here: the shared block below already sizes any
  // `paths` for any kind, and a second sizer in this branch is how the two would drift.
  // His rule for the whole thing: "it shouldn't matter if 1 or multiple".
  if (paths.length === 1 && !_singleIsDir && !probe) {
    const subPath = paths[0];
    const baseName = suggestedName || subPath.split('/').pop() || 'untitled';
    const ext = path.extname(baseName).replace(/^\./, '') || '*';
    // ⚠️ THE PICKER OPENS FIRST, AND THE CHECK WAITS FOR IT (2026-09-11). Checking
    // before the dialog would avoid asking where to put a file we then refuse, which
    // is the warn-before-acting shape the common import uses. It is the wrong trade
    // HERE, for two reasons that are both about the common case:
    //   - A CLICK MUST REACT INSTANTLY. Any work between the click and the dialog is
    //     perceptible as nothing-happening, and users respond by clicking again. No
    //     amount of correctness downstream pays for that.
    //   - A program in the library is vanishingly rare. Optimising the click for the
    //     case that essentially never fires, at the cost of every ordinary export,
    //     is backwards.
    // So the near-certain path stays instant and the rare one pays an extra dialog.
    // ⚠️ ASK ONLY IF THE RENDERER HAS NOT. [2026-09-22] Same dialog, same defaults - the only
    // difference is WHEN it opens, which is exactly the note the multi-path branch already
    // carries. When the renderer picked, it also owns the bar, and this call is silent work
    // behind a destination that is already known.
    let filePath = preFile || null;
    if (!filePath) {
      const r = await dialog.showSaveDialog(win, {
        title: 'Export file',
        defaultPath: path.join(lastDir, baseName),
        filters: ext === '*'
          ? [{ name: 'All files', extensions: ['*'] }]
          : [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      filePath = r.filePath;
    }
    try {
      const buf = await readBytes(subPath);
      if (refuseBuf(buf, subPath)) return { ok: true, written: [], refused };
      // ⭐ ONE FILE REPORTS LIKE ANY OTHER. [B-420, 2026-09-23 — "it shouldn't matter if 1 or
      // multiple"] The sizing block never runs on this branch, so the totals are set here from
      // what is about to be written: one file, its own length. The bar is then driven by the
      // same per-chunk sink the multi-path branch uses.
      _bTotal = buf ? buf.length : 0;
      _bFiles = 1;
      if (_emit) _emit.onBytes({ done: 0, total: _bTotal, name: baseName });
      // [B-005 item 4] Chunked + cancellable, and it removes its own partial on a stop.
      await require('./sfExportCopy').writeBufferWithProgress(buf, filePath, (n) => {
        if (!_emit) return;
        _bDone += n;
        _emit.onBytes({ done: _bDone, total: _bTotal, name: baseName });
      }, _shouldStop);
      if (_emit) { _emit.onBytes({ done: _bTotal, total: _bTotal, name: baseName }); _emit.flush(); }
      Store.set('lastExportDir', path.dirname(filePath));
      return { ok: true, written: [filePath], refused };
    } catch (err) {
      // ⚠️⚠️ A CANCEL IS NOT A FAILURE, AND THIS BRANCH WAS THE ONE PLACE THAT SAID IT WAS.
      // [B-420, 2026-09-23 — his screenshots, same door, two endings]
      //
      // Seven other catches in this file normalise a stop to `{ ok: true, canceled: true }`;
      // this one returned `ok:false` with the cancellation as the error TEXT, so the funnel's
      // error path rendered "Export failed / Export cancelled" with a blue primary button -
      // an error dialog naming the user's own click as the fault. Cancel the SAME door with
      // more than one file selected and it correctly said "Export stopped / Nothing new was
      // copied." One gesture, two endings, decided by how many files were selected.
      //
      // ⭐ THE SHAPE IS THE LESSON, NOT THE LINE: a rule every door has to remember is a rule
      // some door forgets. Found by reconciling all eight catches against each other rather
      // than by reading this one, which looks perfectly correct on its own.
      //
      // ⚠️ `partialRemoved` is reported because `writeBufferWithProgress` unlinks what it had
      // written before it rethrows - so the honest notice is "the item being written was
      // removed", not a bare "stopped". The renderer reads exactly this field.
      if (require('./sfExportCopy').isCancel(err)) {
        return { ok: true, canceled: true, written: [], partialRemoved: true, refused };
      }
      return { ok: false, error: String(err && err.message || err) };
    }
  }
  // Multi-path → pick a destination folder. Files write with their
  // original names + " (N)" collision suffix. Folders write as named
  // subfolders inside the chosen destination, recursively.
  // [B-408] Ask only if the renderer has not already. Same dialog, same defaults - the only
  // difference is WHEN it opens.
  let destDir = preDest || null;
  // ⚠️ A PROBE NEVER ASKS. It falls through here only to be sized, and the destination it
  // reports against is the one the renderer already chose - so derive it from the file path
  // rather than raising a picker behind a modal the user did not ask for. [B-420, 2026-09-23]
  if (!destDir && probe && preFile) destDir = path.dirname(preFile);
  if (!destDir) {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      // ⚠️ The lone-folder title names the folder; the batch title cannot.
      title: _folderPickTitle || 'Export to folder',
      defaultPath: lastDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    destDir = filePaths[0];
  }
  const written = [];
  const failed = [];
  // [B-408] Byte-weighted progress, now that the destination is known before any work starts.
  // ⚠️ Emitted only when the renderer supplied the destination — the older callers that let this
  // handler open its own picker have no bar to drive, and sending to a listener that is not there
  // is harmless but pointless.
  // ⚠️ A PROBE DRIVES NOTHING. There is no bar up while it runs - that is the entire point
  // of it - so emitting would push bytes at a listener that does not exist yet and, worse,
  // seed the real bar's first frame from a call that wrote nothing.
  // ⚠️ SIZING RUNS WHETHER OR NOT THERE IS A BAR TO DRIVE. It used to be gated on `_emit`,
  // which meant the older callers that let this handler open its own picker computed no
  // total - and [B-203]'s fit check needs that total more than the bar does. The walk is
  // cheap against the copy that follows, and only the EMIT is conditional now. [B-203]
  {
    // ⚠️ Size the batch up front. A folder in the selection is walked for its total; a file is one
    // stat. Both are cheap against the copy that follows, and without a total the bar cannot be
    // determinate from the first frame.
    // ⚠️⚠️ SIZE ONLY WHAT CAN BE SIZED CHEAPLY, AND SAY SO WHEN IT CANNOT. entry / common /
    // sharedTracks live on disk, so a stat or a walk is exact and nearly free. `source` content
    // lives inside an archive, and composite inner-zip paths make an exact size real work — more
    // than this door is worth. If ANY path cannot be sized the total is INCOMPLETE, and an
    // incomplete total is worse than none: the bar would sail to 100% with files still to write.
    // So it reports total 0, and the renderer shows an indeterminate bar instead of a false one.
    const onDiskRoot = kind === 'entry'  ? path.join(userData, 'soundFonts', 'library', id)
                     : kind === 'common' ? path.join(userData, 'soundFonts', 'common', id, 'files')
                     : kind === 'sharedTracks' ? path.join(userData, 'soundFonts', 'sharedTracks')
                     : null;
    const sizeOnDisk = (abs) => {
      let st; try { st = fs.statSync(abs); } catch { return null; }
      if (st.isFile()) { _bFiles++; return st.size; }   // [B-238] count files too
      if (!st.isDirectory()) return null;
      let total = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          // [B-238] Per-file cost dominates on a board, so the count is tracked alongside.
          else { try { total += fs.statSync(p).size; _bFiles++; } catch {} }
        }
      };
      try { walk(abs); } catch { return null; }
      return total;
    };
    let sizable = !!onDiskRoot;
    if (sizable) {
      for (const sp of paths) {
        const n = sizeOnDisk(path.join(onDiskRoot, sp.split('/').join(path.sep)));
        if (n === null) { sizable = false; break; }
        _bTotal += n;
      }
    } else if (kind === 'source') {
      // ⭐⭐ SOURCE CONTENT *IS* CHEAP TO SIZE, and the note above was too pessimistic.
      // [B-408] treated archives as unsizable because a stat cannot reach inside one - but
      // a zip's CENTRAL DIRECTORY already carries every entry's uncompressed size, and
      // listAll() reads exactly that (and descends into inner zips, so composite paths are
      // covered too). No extraction, no decompression: one directory read.
      //
      // ⚠️⚠️ THIS IS WHY A SOURCE EXPORT RAN STRAIGHT INTO ENOSPC. `sizable` was false for
      // kind==='source', so _bTotal stayed 0 and [B-203]'s check below skipped itself - the
      // guard was present and silently inapplicable to a whole class of export. He found it
      // by right-clicking a source: five files failed mid-write with raw
      // "ENOSPC: no space left on device".
      try {
        const source = soundFontSources.openSource(userData, id);
        const all = source ? await source.listAll() : null;
        if (all && all.length) {
          let ok = true;
          for (const sp of paths) {
            const pref = sp.endsWith('/') ? sp : sp + '/';
            let n = 0, found = false;
            for (const e of all) {
              if (e.isDir) continue;
              if (e.fileName === sp || e.fileName.startsWith(pref)) {
                n += Number(e.size) || 0;
                _bFiles++;                                  // [B-238]
                found = true;
              }
            }
            // ⚠️ A path we cannot account for makes the whole total INCOMPLETE, and an
            // incomplete total is worse than none - it would under-report and let an export
            // through that cannot fit. Same rule the on-disk branch above follows.
            if (!found) { ok = false; break; }
            _bTotal += n;
          }
          sizable = ok;
        }
      } catch { sizable = false; }
      if (!sizable) _bTotal = 0;
    }
    if (!sizable) _bTotal = 0;
    if (_emit) _emit.onBytes({ done: 0, total: _bTotal, name: '' });
  }

  // ── Will it fit? ────────────────────────────────────────────────── [B-203]
  //
  // ⭐ THE BUDGET IS ALREADY COMPUTED ABOVE, so this costs one statfs (0.3ms) and nothing
  // else. That is the whole reason the check belongs HERE rather than in the renderer:
  // sizing happens in main immediately before the write, and a check that reuses that
  // number cannot drift out of step with the progress bar, because it IS the progress
  // total.
  //
  // ⚠️ ONLY WHEN THE TOTAL IS TRUSTWORTHY. `_bTotal` is 0 both when nothing was measured
  // and when the batch genuinely could not be sized (source content inside an archive -
  // see the note above about an INCOMPLETE total being worse than none). Either way a 0
  // means "we do not know", and an unknown size must not produce a refusal.
  //
  // ⚠️ REFUSE BY RETURNING, NOT BY THROWING. The renderer owns every dialog in this app;
  // main hands back `tooBig` with the three numbers and the renderer shows the same
  // sentence the bulk export already uses. Nothing is written on this path.
  // ⭐⭐ ONE PREFLIGHT, BOTH QUESTIONS. [B-005 item 4] This was two separate blocks asking
  // about the same destination - a `checkFit` and then a `describe({classify:true})` - with
  // the board-card test written out here AND again in the renderer. `preflight()` asks once,
  // and the answer it returns carries `boardCard` and `removable` so the cancel-cleanup rule
  // and the safe-eject offer reuse this lookup instead of each paying ~1,900 ms for their own.
  //
  // ⚠️ TWO-PHASE STILL, BECAUSE MAIN OWNS THE SIZE AND THE RENDERER OWNS THE DIALOG. The byte
  // and file totals were computed above; the renderer has neither and would have to guess
  // from subPaths.length, which counts a folder as one. So main decides WHETHER to ask and
  // returns WITHOUT writing; the renderer asks; on "Export anyway" it calls back with
  // confirmSlow. That split is legitimate - what was not is having two implementations of
  // the same question.
  //
  // ⚠️ `_bTotal` is 0 both when nothing was measured and when the batch could not be sized
  // (source content inside an archive). Either way it means "we do not know", and an unknown
  // size must never produce a refusal - the preflight's own size floor handles that, but the
  // guard stays explicit here because the two zeros mean different things upstream.
  let _pf = null;
  try {
    _pf = await require('./exportDestination').preflight(destDir, {
      totalBytes: _bTotal > 0 ? _bTotal : 0,
      fileCount: _bFiles,
      // Only pay the device lookup when the job is big enough for the answer to change
      // anything. Under the threshold there is no warning to give.
      classify: !confirmSlow && require('./exportDestination').isSlowWriteJob(_bFiles, _bTotal),
    });
  } catch { /* never fails closed: an unmeasurable destination still exports */ }

  if (_pf && _pf.tooBig) {
    // ⚠️ REFUSE BY RETURNING, NOT BY THROWING. The renderer owns every dialog in this app;
    // main hands back the three numbers and the renderer shows the same sentence every other
    // door uses. Nothing has been written at this point.
    // ⚠️ THE MEASUREMENT RIDES ON THE REFUSAL TOO. [2026-09-22] The refused case is exactly the
    // one the runner must not receive unmeasured: it sizes its own preflight from what `plan()`
    // returns, and zero bytes is read as "cannot measure", which deliberately does not refuse. A
    // refusal that hands back no numbers would turn into silence one layer up.
    return { ok: false, tooBig: _pf.tooBig, totalBytes: _bTotal, fileCount: _bFiles };
  }
  if (!confirmSlow && _pf && _pf.slowWrite) {
    // ⚠️ destDir RIDES ALONG so the retry does not re-open the picker. When main chose the
    // destination itself - the lone-folder door - the renderer has no other way to name it,
    // and asking the user to pick the same folder twice after agreeing to go ahead is its
    // own bug.
    return { ok: false, slowWrite: { ..._pf.slowWrite, destDir },
             totalBytes: _bTotal, fileCount: _bFiles };
  }

  // ── Probe: answer the two questions, write nothing ──────────────── [B-203, B-238]
  //
  // ⭐⭐ THE BAR MUST NOT BE UP WHEN WE ASK. This door was the last one still using the
  // two-phase handshake - renderer raises a determinate bar, main sizes, main hands back
  // slowWrite, renderer dialogs OVER its own moving bar. He caught it on a 57-file source
  // export: "does the regular progress bar before the 'this will take a while' message."
  // Every other door now asks before it shows anything.
  //
  // ⭐ A PROBE RATHER THAN A SECOND SIZING FUNCTION. The renderer cannot size this batch -
  // a folder in the selection counts as one path, and source content lives inside an
  // archive - and a parallel sizer in the renderer would be a second implementation to
  // keep in step with the bar's own total forever. So the renderer calls THIS handler,
  // which has already done the work by the time it reaches here, and it stops short of
  // the write. Same numbers, same thresholds, one implementation.
  //
  // ⚠️ Both refusals above return BEFORE this line, so a probe that gets here is a yes.
  //
  // ⭐⭐ THE PROBE REPORTS WHAT IT MEASURED, AND THAT IS WHAT LETS THIS DOOR MIGRATE. [2026-09-22]
  //
  // The runner sizes its own preflight from what `plan()` returns, and zero bytes is read as
  // "cannot measure" - which deliberately does not refuse. So a migration that left this
  // returning no numbers would have silently disabled the fit refusal and the slow-write warning
  // on this door while looking like a pure refactor.
  //
  // ⭐ `_bTotal` and `_bFiles` are the same pair this handler hands its OWN preflight a few lines
  // up, so the renderer's bar, the runner's preflight and main's own check all read one
  // measurement rather than three estimates free to drift apart.
  if (probe) return { ok: true, probed: true, totalBytes: _bTotal, fileCount: _bFiles };

  // ⚠️ BETWEEN ITEMS, and an item here can be a whole folder - so the tree walk below carries
  // shouldStop too and stops between FILES inside it. Checking only here would mean a cancel
  // during a 2 GB folder did nothing until that folder finished. [B-005 item 4]
  let _canceled = false;
  for (const subPath of paths) {
    if (_shouldStop && _shouldStop()) { _canceled = true; break; }
    try {
      const baseName = subPath.split('/').pop() || 'untitled';
      if (_emit) _emit.onBytes({ done: _bDone, total: _bTotal, name: baseName });
      const isDir = await isDirAtPath(subPath);
      if (isDir) {
        let finalName = baseName;
        if (fs.existsSync(path.join(destDir, finalName))) {
          let n = 1;
          while (fs.existsSync(path.join(destDir, `${baseName} (${n})`))) n++;
          finalName = `${baseName} (${n})`;
        }
        const outRoot = path.join(destDir, finalName);
        // ⭐⭐ THE FOLDER REPORTS AS IT COPIES NOW, rather than all at once at the end.
        // [B-420, 2026-09-23] Same defect as the file branch above and a worse case: a whole
        // font folder landed with the bar flat at 0, then jumped by its entire size.
        // ⚠️ The post-hoc credit that used to sit here - walking `outRoot` and summing what
        // landed - is GONE rather than kept alongside, for the same double-count reason.
        // ⚠️ It measured the DESTINATION, which was the right call when nothing else counted:
        // a zip source is not stat-able. Live chunks come from the write itself, so they are
        // exact on either side, and a refused file now correctly contributes nothing.
        await writeDirTo(subPath, outRoot, (n, rel) => {
          if (!_emit) return;
          _bDone += n;
          _emit.onBytes({ done: _bDone, total: _bTotal, name: rel || baseName });
        });
        written.push(outRoot);
      } else {
        const buf = await readBytes(subPath);
        if (refuseBuf(buf, subPath)) continue;
        const out = uniqueIn(destDir, baseName);
        // [B-005 item 4] Chunked + cancellable; leaves nothing truncated behind.
        // ⭐⭐ LIVE BYTES, NOT A LUMP ON COMPLETION. [B-420, 2026-09-23 — his report]
        //
        // This passed `null` as the progress sink to a function named `writeBufferWithProgress`,
        // so an 11 MB wav wrote eleven chunks and reported none of them. The bar only moved when
        // the whole file closed. His scenario made it unmistakable - one large wav and three
        // small ones - "it sits at 0 for like a min... then goes to the top", because the single
        // large file WAS the minute and the three small ones were the jump.
        //
        // ⚠️ AND THE OLD CREDIT LINE HAD TO GO WITH IT, not stay as a safety net: crediting
        // `buf.length` here as well as every chunk counts each file twice and the bar reaches
        // 100% at the halfway point. One source of truth for `_bDone`.
        await require('./sfExportCopy').writeBufferWithProgress(buf, out, (n) => {
          if (!_emit) return;
          _bDone += n;
          _emit.onBytes({ done: _bDone, total: _bTotal, name: baseName });
        }, _shouldStop);
        written.push(out);
      }
      if (_emit) _emit.onBytes({ done: _bDone, total: _bTotal, name: baseName });
    } catch (err) {
      // ⚠️⚠️ A CANCEL IS NOT A FAILURE, and this catch would have filed it as one. The tree walk
      // throws to stop, and landing in here would have added "Export cancelled" to the failed
      // list - so stopping an export would have ended in a red "some files failed to export"
      // dialog naming the user's own click as the fault. [B-005 item 4]
      if (require('./sfExportCopy').isCancel(err)) { _canceled = true; break; }
      failed.push({ source: subPath, error: String(err && err.message || err) });
    }
  }
  // ⭐ Land on 100% whatever route each item took — refused, failed, or written. [B-389].
  if (_emit) { _emit.onBytes({ done: _bTotal, total: _bTotal, name: '' }); _emit.flush(); }
  Store.set('lastExportDir', destDir);
  // ⚠️ `written` STILL GOES BACK ON A CANCEL. Whole files landed; the user is owed a list of
  // them, not a bare "cancelled". [B-005 item 4]
  return { ok: true, canceled: _canceled, written, failed, refused };
}

// ── [B-364] Acting on a program found in the managed store ──────────────────
//
// Reached from the refusal message an export produces, and ONLY from there: the
// app never sweeps the library looking for these ("I don't want to be constantly
// checking the library... this is a very rare case", 2026-09-11). Export is the
// one moment we already look, so it is the one moment we can offer to act.
//
// Both verbs re-verify the file is a program before touching it — see
// soundFontRemoval._confirmProgram. The renderer names the file; the bytes
// justify the removal.
// Impound: remove it from the store NOW and hold the bytes. Called as soon as an export
// reports a finding, before the user is asked anything — the report is a statement, not
// a request for permission.
ipcMain.handle('sfProgram:impound', async (_, { kind, id, relPath } = {}) =>
  soundFontRemoval.impoundProgram(app.getPath('userData'), { kind, id, relPath }));

// The user wants a copy. Asks once for a destination unless the renderer already has one
// for the batch, then releases and drops the holding entry immediately.
ipcMain.handle('sfProgram:release', async (_, { token, destDir, batchLabel } = {}) => {
  let target = destDir;
  if (!target) {
    const lastDir = liveDir(Store.get('lastExportDir')) || app.getPath('downloads');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose where to keep a copy',
      defaultPath: lastDir,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Save Copy Here',
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    target = filePaths[0];
  }
  const res = soundFontRemoval.releaseImpounded(app.getPath('userData'), { token, destDir: target, batchLabel });
  if (res.ok) Store.set('lastExportDir', target);
  return res;
});

// The user chose Delete. Nothing about the holding area reaches them; from their side
// they picked delete and the file is gone.
ipcMain.handle('sfProgram:discard', async (_, { token } = {}) =>
  soundFontRemoval.discardImpounded(app.getPath('userData'), { token }));

ipcMain.handle('sfProgram:delete', async (_, { kind, id, relPath } = {}) =>
  soundFontRemoval.deleteManagedFile(app.getPath('userData'), { kind, id, relPath }));

// Quarantine asks WHERE, every time — his rule: "if they choose quarantine, they
// have to tell us where to put it." No default location and no silent destination:
// the user is choosing where to keep a file they may want to analyse, and that is
// not a choice the app should make on their behalf.
// destDir is optional: the renderer asks ONCE for a batch and passes it in, so
// quarantining four findings does not open four folder pickers. Called without one
// (a single finding) it asks here.
ipcMain.handle('sfProgram:quarantine', async (_, { kind, id, relPath, destDir } = {}) => {
  let target = destDir;
  if (!target) {
    const lastDir = liveDir(Store.get('lastExportDir')) || app.getPath('downloads');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose where to keep the quarantined file',
      defaultPath: lastDir,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Quarantine Here',
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    target = filePaths[0];
  }
  const res = soundFontRemoval.quarantineManagedFile(app.getPath('userData'),
    { kind, id, relPath, destDir: target });
  if (res.ok) Store.set('lastExportDir', target);
  return res;
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
    // ⚠️⚠️ THE ASYNC TWIN, AND THE await IS THE ENTIRE FIX. [B-420, 2026-09-24]
    // The sync walk blocked this process for ~1.9 s on a real library, and Electron routes frame
    // presentation AND input dispatch through it — so the prep modal never painted and the clicks
    // on Cancel were never dispatched. It was reported as "cancel does nothing"; it was "the screen
    // was never there". Confirmed by instrumenting the renderer: handler attached, button enabled,
    // and not one click event delivered during the survey.
    const survey = await soundFontBackup.surveyLibraryAsync(userData);
    return { ok: true, survey };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('dialog:selectBackupExportPath', async () => {
  const lastDir = liveDir(Store.get('lastSfBackupDir')) || liveDir(Store.get('lastDir')) || app.getPath('documents');
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
    return { ok: true, destPath: result.destPath, manifest: result.manifest, refused: result.refused || [] };
  } catch (err) {
    // ⚠️ `teardownIncomplete` rides along. [B-420] It means the cancel deadline fired and the
    // archiver is STILL WRITING to the destination — so the renderer must not report a clean
    // finish and must not offer a safe eject on a card we are still holding open.
    if (err && err.cancelled) {
      return { ok: false, cancelled: true,
               residualPath: err.residualPath || null,
               teardownIncomplete: !!err.teardownIncomplete };
    }
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
  const lastDir = liveDir(Store.get('lastSfBackupDir')) || liveDir(Store.get('lastDir')) || app.getPath('documents');
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
    // [B-401] `refused` is what the restore DECLINED to write. The backend has always
    // collected it ([B-370]); both restore handlers used to drop it at the door, so the
    // renderer could never report it and a library restored with a program stripped out
    // said it restored cleanly. The export handler always passed it through - this was an
    // asymmetry, not a design.
    return { ok: true, manifest: result.manifest, counts: result.counts,
             refused: (result && result.refused) || [] };
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
    // [B-401] Same pass-through as applyMerge. BOTH doors, deliberately - fixing only the
    // one that was read first is the exact shape this entry was found by.
    return { ok: true, manifest: m, counts: result && result.counts,
             refused: (result && result.refused) || [] };
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

// includeCustomized ([B-311]) mirrors includeAttachments exactly: a parameter
// of the export, defaulting to carry, turned off only by the direct-export
// dialog's checkbox. The delete-with-export paths never pass false — that
// export is the last copy, so everything rides.
// ── How big is this source? ─────────────────────────────────────────── [B-203]
//
// ⭐ SO THE RENDERER CAN CHECK BEFORE IT RAISES A BAR. The source export used a two-phase
// handshake - start, let main decline, ask, restart - which meant the progress modal was
// already up when the dialog opened, and the question arrived on top of a bar. Every other
// door asks with a clear screen. His catch: "i think the order is off on this one... the
// progress bar... not like the other spots."
//
// ⚠️ CHEAP: a zip's central directory carries every entry's uncompressed size and listAll()
// reads exactly that, descending into inner zips. No extraction, one directory read.
// ⭐⭐ ONE INVENTORY FOR "WHAT WILL EXPORTING THIS SOURCE ACTUALLY WRITE". [B-420, 2026-09-24]
//
// There were FOUR places sizing the same job and three of them disagreed: this IPC (which seeds
// the bar before any progress arrives), `exportManyToDownloads`'s `grandBytes`, and
// `zipFolderToFile`'s own total — which was the only one right, and whose answer the others
// discarded. the screenshots caught the seam twice: `362.9 MB of 7.7 MB` mid-export, then
// `0 B of 80.2 MB` on the opening frame with the same export settling to `805.0 MB` a second later.
//
// ⚠️ THE SOURCE TREE IS NOT THE JOB. A customized font lives at a library entry's own folder, so
// `listAll()` cannot see it — on the Decay source that is 724.9 MB of payload against an 80.2 MB tree,
// a denominator ten times short. Any sizer that asks the SOURCE what the export will write is
// asking the wrong object.
//
// ⭐ So both callers come here. Not "the two I found" — the reconciliation test below pins the
// count, so a third sizer added later fails rather than quietly disagreeing.
async function _sourceExportInventory(userData, uuid, opts = {}) {
  const { includeAttachments = true, includeCustomized = true } = opts;
  const source = soundFontSources.openSource(userData, uuid);
  if (!source) return null;
  const all = await source.listAll();
  const flat = (all || []).filter((e) => e && !e.isDir);
  const treeBytes = flat.reduce((sum, e) => sum + (Number(e.size) || 0), 0);

  // ⚠️ A payload we cannot build costs zero rather than throwing. It is metadata riding along,
  // never the goods — the same rule the export itself follows.
  let payload = null, payloadBytes = 0, payloadFiles = 0;
  try {
    const cur = require('./soundFontCuration');
    payload = cur.buildForSource(userData, uuid, app.getVersion(),
                                 { includeAttachments, includeCustomized });
    const plan = payload ? cur.planForArchive(payload) : null;
    if (plan) {
      payloadBytes = Buffer.byteLength(plan.sidecarJson, 'utf8');
      for (const e of plan.entries) {
        payloadFiles++;
        try { payloadBytes += fs.statSync(e.absPath).size || 0; } catch { /* skipped at write too */ }
      }
      payloadFiles++;   // the sidecar itself
    }
  } catch { payload = null; payloadBytes = 0; payloadFiles = 0; }

  return { treeBytes, treeFiles: flat.length, payload, payloadBytes, payloadFiles,
           bytes: treeBytes + payloadBytes, files: flat.length + payloadFiles };
}

ipcMain.handle('sources:exportSize', async (_, { uuid, includeAttachments = true,
                                                 includeCustomized = true } = {}) => {
  try {
    const inv = await _sourceExportInventory(app.getPath('userData'), uuid,
                                             { includeAttachments, includeCustomized });
    if (!inv) return { ok: false, error: 'Source not found' };
    // ⚠️ `bytes` INCLUDES THE PAYLOAD, because this number becomes the bar's denominator on the
    // opening frame. Returning the tree here is what put `0 B of 80.2 MB` on screen for a job
    // that was about to report 805 MB.
    return { ok: true, bytes: inv.bytes, files: inv.files };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

ipcMain.handle('sources:exportToDownloads', async (event, { uuid, destDir, format, includeAttachments = true, includeCustomized = true, confirmSlow } = {}) =>
  _withExportCancel(async (shouldStop) => {                            // [B-005 item 4]
  try {
    const source = soundFontSources.openSource(app.getPath('userData'), uuid);
    if (!source) return { ok: false, error: `Source not found: ${uuid}` };
    // Use Electron's resolved downloads path so relocated Known Folders on
    // Windows (e.g. D:\Downloads) are respected; falls through to system
    // defaults on Mac/Linux.
    const target = destDir || app.getPath('downloads');

    // ── Will it fit? ────────────────────────────────────────────────── [B-203]
    //
    // ⚠️⚠️ THIS DOOR FAILED MID-WRITE TWICE ON HIS BENCH, once as a folder and once as a
    // zip, both with a raw Win32 string:
    //     ENOSPC: no space left on device, mkdir 'V:\1.1-G-Grievous'
    // "Delete source…" reaches it too, via its "Export source first" checkbox.
    //
    // ⭐ THE SIZE IS CHEAP AFTER ALL. A zip's central directory carries every entry's
    // UNCOMPRESSED size and listAll() reads exactly that, descending into inner zips - no
    // extraction, one directory read. Summing it is the whole cost.
    //
    // ⚠️⚠️ ZIP FORMAT INCLUDED, AND IT WAS EXCLUDED AT FIRST. The argument for leaving it
    // out was that a zip writes COMPRESSED bytes, so an uncompressed total is only an upper
    // bound and refusing on it could block an archive that would have fit. That is true and
    // it is beside the point, which he made after watching a zip export try and fail: "we
    // have a message for this already. it shouldn't have tried to go there."
    // ⭐ THE ASYMMETRY DECIDES IT: a rare false refusal costs a retry; attempting a write we
    // can predict will fail costs a part-written archive on a card, which is the condition
    // this entry exists to prevent.
    {
      try {
        // ⚠️⚠️ THE PAYLOAD COUNTS TOWARDS THE FIT, AND THIS ONE HAS DATA CONSEQUENCES. [B-420,
        // 2026-09-24] A fit check is a different QUESTION from a progress denominator — the ruling,
        // and it holds — but it is the same QUANTITY: how many bytes are about to be written. This
        // asked the source tree, which on the Decay source is 80.2 MB against 805.0 MB actually written.
        // A guard that exists to stop a part-written archive reaching a card cannot be ten times
        // short of what the archive contains.
        // ⭐ Same inventory as the bar, so the refusal and the readout can never describe different
        // jobs — which is how one of them came to be wrong without the other noticing.
        const _inv = await _sourceExportInventory(app.getPath('userData'), uuid,
                                                  { includeAttachments, includeCustomized });
        const flat = { length: _inv ? _inv.files : 0 };
        const need = _inv ? _inv.bytes : 0;
        // ⭐⭐ ONE PREFLIGHT, BOTH QUESTIONS. [B-005 item 4] Was a `checkFit` followed by a
        // separate `describe({classify:true})`, asking about the same destination twice with
        // the board-card test spelled out here and again in the renderer.
        //
        // ⚠️ Same two-phase handshake as sfFile:export and for the same reason: main has the
        // size (just summed above) and the renderer owns dialogs. Main decides whether to ask
        // and returns WITHOUT writing; on "Export anyway" the renderer calls back with
        // confirmSlow.
        //
        // ⚠️ Sources are the biggest single items in the library - his run from 467 MB to
        // 1,090 MB across up to 2,398 files - so this is the door where the warning matters
        // most, and it was the last one to get it.
        const _pf = await require('./exportDestination').preflight(target, {
          totalBytes: need,
          fileCount: flat.length,
          classify: !confirmSlow && require('./exportDestination').isSlowWriteJob(flat.length, need),
        });
        if (_pf && _pf.tooBig) return { ok: false, tooBig: _pf.tooBig };
        if (!confirmSlow && _pf && _pf.slowWrite) {
          return { ok: false, slowWrite: _pf.slowWrite };
        }
      } catch { /* never fails closed */ }
    }
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
    // Curation sidecar ([B-283]): a zip export carries the hand-authored values back with it, so
    // re-importing after a delete returns the link, the style link, the demo URL and the tags
    // rather than just the audio. buildForSource returns null for an uncurated source, so an
    // untouched export is still a byte-for-byte copy of what we hold.
    //
    // XX THE SIDECAR NOW GOES IN DURING THE EXPORT, NOT AFTER IT. [B-420, 2026-09-23]
    // This used to call injectIntoZip on the FINISHED archive: extract the whole thing back out,
    // write the sidecar into the tree, re-compress everything, rename into place. Ryan: "How can
    // curation have after compression? It goes inside the zip...." and "why would we have ever
    // packed, unpacked and packed again?" It predated the pooled store, when the archive itself
    // was the stored artifact and had to be rebuilt to stay byte-canonical. exportToDownloads
    // places it inline now, so there is no second pass to get stuck in and nothing to roll back.
    //
    // !! AN ENTIRE CLASS OF BUG WENT WITH IT. The old extract phase emitted no progress at all, so
    // it read as a hang at 0 B; the cancel thrown through it was swallowed by a best-effort catch;
    // the export then reported SUCCESS to a delete that went ahead and destroyed the font while
    // leaving a half-decorated zip on the card. His report: "it would have sat there at 0 bytes
    // forever. It is stuck." There is no longer any step between "the archive is written" and
    // "the export is done", which is what made that sequence possible.
    //
    // XX BOTH FORMATS CARRY IT NOW, and that is the point of the change rather than a side effect.
    // This was zip-only because the sidecar was injected by rebuilding an ARCHIVE, so a folder
    // export had nothing to inject into - a limitation of the mechanism that got written down as
    // if it were a rule. Writing into the tree works for both, so all four export doors produce
    // the same thing. He asked what was different about the contents of the four; nothing is.
    //
    // XX THE INVARIANT, HIS WORDS, AND IT IS THE TEST FOR ANY DOOR ADDED LATER (2026-09-23):
    // "The only difference between the doors is that some of them give options where you can
    // uncheck them, but that is not an asymmetry. That is just which ones are optional and which
    // ones are mandatory."
    // So a door may differ in WHICH OPTIONS IT EXPOSES - includeAttachments and includeCustomized
    // are checkboxes on some doors and fixed defaults on others. It may NOT differ in what the
    // export then does with the payload. Placement is identical everywhere; only the build is
    // parameterised. A door that differs in anything else is a defect, not a variant.
    //
    // !! THIS KNOWINGLY BREAKS FOLDER IMPORT UNTIL [B-427]. Import peeks inside ZIPS only, so a
    // folder re-imported today stores our .jmt-curation.json as vendor content and restores
    // nothing. Deliberate, his call, 2026-09-23: "it is totally fine to break the imports right now
    // since it is the next thing we are fixing after this is done. So you should do the export
    // correctly now and we will learn how to deal with the import later." And the reason it is
    // safe: "we are not coding for some other group of people who are using this mid-flight...
    // until we release it, it will not matter. And it is going to be all together in one shot for
    // QA anyway." There is no released build holding sources, so no mid-flight state to protect.
    let curationPayload = null;
    try {
      curationPayload = require('./soundFontCuration')
        .buildForSource(app.getPath('userData'), uuid, app.getVersion(),
                        { includeAttachments, includeCustomized });
    } catch { curationPayload = null; }  // a payload we cannot build must never sink the export
    const result = await source.exportToDownloads(target,
      { format, onProgress, shouldStop, curationPayload });
    // curation reports what the finished archive ACTUALLY carries, so any caller can say so without
    // re-deriving it from the library. Null means nothing was added - an uncurated source or a
    // folder export - and "there is nothing of yours in this file" describes both honestly.
    const curation = (result && result.curation && result.curation.any) ? result.curation : null;
    if (pending) { try { event.sender.send('soundFonts:sourceExportProgress', pending); } catch {} }
    return { ok: true, ...result, curation };
  } catch (err) {
    // ⚠️ A cancel is an outcome, not a failure. Without this the user's own click came back as
    // a red "Export failed: Export cancelled". [B-005 item 4]
    if (require('./sfExportCopy').isCancel(err)) return { ok: true, canceled: true };
    return { ok: false, error: String(err && err.message || err) };
  }
}));

// ── Export MANY sources as ONE operation ─────────────────── [B-420, 2026-09-23, his design]
//
// ⭐⭐ WHY THIS EXISTS AND WHY IT IS NOT A LOOP IN THE RENDERER. The bulk delete used to call the
// single-source export once per source, which made the export phase N operations wearing one
// caller-drawn bar - and that bar was a STEP COUNT ("Exporting sources 3 of 4"), so the slowest
// thing in the app reported no bytes and no filenames at all.
//
// ⭐ HIS RE-SCOPE, and it dissolved a question rather than answering it. I had asked whether the
// shared export runner should grow a "the caller paints, not you" mode to accommodate that second
// surface. His answer: "do the export of all 4... then once done it can return to delete and let
// delete do its thing being told the export was completed for all of them. so same as 1 or many."
// One operation means one surface, so the mode was never needed.
//   "one bar for the bytes over all 4 showing which source it's working on and all the files
//    flying by. so genuinely looks the same for 1 or 100 of them."
//
// ⚠️⚠️ CANCEL IS ALL OR NOTHING, AND THAT IS A DELIBERATE DELETION HE CONFIRMED. Stopping at
// source 3 of 4 removes the COMPLETED exports of 1 and 2, so that "Nothing was copied. Nothing was
// deleted." is true rather than a half-state the user has to go and inspect. An export that exists
// to be the last copy before a delete is worth nothing half-done.
//
// ⚠️⚠️ THE ROLLBACK LIVES HERE, IN MAIN, AND MUST NOT MOVE TO THE RENDERER. Every path removed is
// one THIS RUN created: `_uniqueDestPath` walks to a free name rather than overwriting, so an
// export never lands on anything pre-existing, and `exportToDownloads` hands back the path it
// chose. The alternative - an IPC that removes a path the renderer names - is a general
// delete-anything surface, and the only existing destructive path IPC (`fs:removeSetAside`)
// refuses anything it did not itself name. Same discipline, achieved by never exposing it.
ipcMain.handle('sources:exportManyToDownloads', async (event, { items = [], destDir, format,
                                                                includeAttachments = true,
                                                                includeCustomized = true,
                                                                confirmSlow } = {}) =>
  _withExportCancel(async (shouldStop) => {                            // [B-005 item 4]
  const userData = app.getPath('userData');
  const target = destDir || app.getPath('downloads');
  const list = Array.isArray(items) ? items.filter((x) => x && x.uuid) : [];
  if (!list.length) return { ok: false, error: 'No sources to export' };

  // ── 1. Size the WHOLE job, and preflight the sum ──
  // ⚠️ One preflight for the total, not one per source. Four exports that each fit individually
  // can still fail together, and finding that out on source three is the half-state this design
  // exists to remove.
  const sized = [];
  let grandBytes = 0, grandFiles = 0;
  for (const it of list) {
    try {
      // ⭐ THE SHARED INVENTORY, so this handler and `sources:exportSize` cannot disagree about
      // the same job. They did, and the gap was visible for a full second on a real export:
      // the opening frame read `0 B of 80.2 MB` and the next one `91.7 MB of 805.0 MB`.
      const _inv = await _sourceExportInventory(userData, it.uuid,
                                                { includeAttachments, includeCustomized });
      if (!_inv) return { ok: false, error: `Source not found: ${it.uuid}` };
      const bytes = _inv.treeBytes;
      const flat = { length: _inv.treeFiles };
      // ⚠️⚠️ COUNT THE PASSES, NOT THE BYTES. [2026-09-23, reported: the bar sat at 0 for the
      // whole rebuild and then climbed, which reads as one bar per source rather than one bar]
      //
      // A space-optimized source exported AS A ZIP moves its full size TWICE - reconstructed into
      // a temp tree, then archived from it ("two passes keep memory bounded on multi-GB
      // voicepacks"). A plain zip-backed source is a single copyFile, and a folder export is a
      // single walk. So a denominator of raw bytes is wrong for exactly the sources that take
      // longest, and the bar would hit 100% at the halfway mark - the same "counting the wrong
      // side of the operation" defect as the slow-write warning that counted zip entries.
      // ⭐ THE PREDICATE IS THE ONE `openSource` ITSELF USES to pick the virtualized
      // implementation: deduped, and not a folder. Read rather than guessed.
      // ⚠️ THE TOTAL THEREFORE EXCEEDS WHAT LANDS ON DISK for such a source, deliberately: it
      // measures WORK, which is what a progress bar is for. The summary reports the artifact.
      let passes = 1;
      try {
        const m = soundFontSources.readSourceMeta(
          path.join(soundFontSources.sourcesRoot(userData), it.uuid));
        if (format !== 'folder' && m && m.deduped && m.format !== 'folder') passes = 2;
      } catch { /* cannot tell - one pass is the honest floor, never a guessed two */ }
      // XX CURATION ADDS NO PASSES ANY MORE, AND THAT IS THE FIX RATHER THAN THE ACCOUNTING.
      // [B-420, 2026-09-23] It used to add TWO, and the two corrections that forced that still
      // stand - they are simply satisfied by construction now instead of by arithmetic: "to a user,
      // they don't know anything about curation etc. it's all part of the export" and "is there not
      // measurable bytes during curation? I don't understand why there wouldn't be."
      //
      // Writing the owner's tags in used to mean UNPACKING the finished archive and RE-ZIPPING it -
      // real work over the whole source that the denominator denied, which is what made a
      // finished-looking export sit at "0 B" for minutes. The sidecar now goes into the tree before
      // compression, so its bytes flow through the ONE compress pass already counted above, named
      // and measured like any other file.
      //
      // XX AND THE DEEPER PROBLEM IS GONE, NOT COUNTED. The old step ran AFTER the export
      // considered itself finished, which put it outside the cancel-and-rollback boundary: a cancel
      // there was discarded, nothing rolled back, and anything gated on the export - a delete - got
      // its green light early and destroyed the font. Counting the passes made the bar honest; it
      // could not fix that. There is now no pass that can begin after the export is done.
      // !! This also removes a buildForSource disk read that existed ONLY to guess a denominator.
      // [B-426 is closed by the same change]
      // ⭐⭐ THE CURATION PAYLOAD IS IN THE ARCHIVE, SO IT IS IN THE DENOMINATOR. [B-420, 2026-09-24]
      //
      // the screenshots: `Techno · Compressing · 362.9 MB of 7.7 MB`. The numerator counts what goes
      // into the archive; this total counted `listAll()`, which is the SOURCE TREE. A customized
      // font lives at a library entry's own folder, not inside the source, so it was structurally
      // invisible here - and it is where the big files are. Not a rounding error: a source whose
      // payload dwarfs its vendor tree reported a bar fifty times past its end.
      //
      // ⚠️ `zipFolderToFile` ALREADY COMPUTES THE RIGHT TOTAL and emits it; the renderer just never
      // saw it, because this handler overwrote `p.totalBytes` with `grandBytes` on the way past.
      // Fixing it at the emit would have been a third opinion about the same quantity. Fixed here,
      // where the number is born.
      //
      // ⚠️ THE PAYLOAD IS BUILT ONCE, HERE, AND CARRIED. The export loop below used to build it
      // again per source; it now takes this one. So the read [B-426] removed as "a disk read that
      // existed ONLY to guess a denominator" does not come back - this is the read the export was
      // already going to do, moved earlier and used twice instead of once.
      const { payload, payloadBytes, payloadFiles } = _inv;
      sized.push({ ...it, bytes, files: flat.length, passes, payload, payloadBytes, payloadFiles });
      // ⚠️ The payload rides the COMPRESS pass only - it is appended to the archive, not carried
      // through a rebuild - so it is added once regardless of `passes`.
      grandBytes += bytes * passes + payloadBytes;
      grandFiles += flat.length + payloadFiles;
    } catch (err) {
      return { ok: false, error: `Could not read source: ${String(err && err.message || err)}` };
    }
  }
  try {
    const _ed = require('./exportDestination');
    const _pf = await _ed.preflight(target, {
      totalBytes: grandBytes,
      fileCount: grandFiles,
      classify: !confirmSlow && _ed.isSlowWriteJob(grandFiles, grandBytes),
    });
    if (_pf && _pf.tooBig) return { ok: false, tooBig: _pf.tooBig };
    if (!confirmSlow && _pf && _pf.slowWrite) return { ok: false, slowWrite: _pf.slowWrite };
  } catch { /* never fails closed - failing to measure is not evidence of a problem [B-028] */ }

  // ── 2. One progress stream across the whole job ──
  // ⚠️ Byte offsets accumulate ACROSS sources so the bar is one bar. `sourceLabel` is what makes
  // it legible - the bytes alone cannot say which of four is being read.
  let lastSent = 0, pending = null;
  let baseBytes = 0, baseFiles = 0, currentLabel = '';
  // ⚠️ A source that rebuilds contributes TWICE, so the offset advances when its phase turns to
  // compress - otherwise the second pass would replay the first pass's bytes and the bar would
  // stall, then repeat. `phaseBase` is that within-source offset; `baseBytes` is the across-source
  // one. Both are needed, and conflating them is how a bar resets between sources.
  let phaseBase = 0, currentPasses = 1, sawCompress = false, currentSourceBytes = 0;
  let currentIndex = 0;
  const flush = () => {
    if (!pending) return;
    try { event.sender.send('soundFonts:sourceExportProgress', pending); } catch {}
    pending = null;
  };
  const onProgress = (p) => {
    // XX THERE IS NO CURATION PHASE TO ACCOUNT FOR ANY MORE. [B-420, 2026-09-23]
    // Two successive attempts lived here and both were treating a symptom. The first routed
    // curation-unpack/curation-repack around the job accumulator as "phase-local", because those
    // phases reported their OWN byte totals and folding them in collapsed the text to "0 B" while
    // the monotonic floor held the bar full - two readouts each correct about a different quantity.
    // He rejected the premise: "to a user, they don't know anything about curation etc. it's all
    // part of the export." The second counted them as ordinary passes, which made the bar honest.
    //
    // ⭐ Neither was the fix. The phases existed only because the sidecar was written by rebuilding
    // a finished archive; writing it into the tree before compression means there is nothing after
    // the compress pass to report, to offset, or to cancel out of. The accounting problem was a
    // shadow cast by the design, and it disappeared with it rather than being solved.
    // ⚠️ The transition is one-way per source: once compression starts the rebuild is behind us.
    if (currentPasses > 1 && p && p.phase === 'compress' && !sawCompress) {
      sawCompress = true;
      phaseBase = currentSourceBytes;
    }
    pending = {
      phase: p && p.phase,
      sourceLabel: currentLabel,
      // ⚠️ POSITION, because bytes alone cannot answer "where am I in this". [2026-09-23, his
      // call: "we just have to show 1 of 2 then 2 of 2 so the user knows where they are in
      // process"] Each source runs rebuild-then-archive, so a phase word changes twice per
      // source and the bar moves continuously - neither tells you how many are left.
      sourceIndex: currentIndex,
      sourceTotal: sized.length,
      fileCount: baseFiles + ((p && p.fileCount) || 0),
      totalFiles: grandFiles,
      bytesDone: baseBytes + phaseBase + ((p && p.bytesDone) || 0),
      totalBytes: grandBytes,
      currentFile: p && p.currentFile,
    };
    const now = Date.now();
    if (now - lastSent >= 80) { lastSent = now; flush(); }
  };

  // ── 3. Export each, remembering exactly what we created ──
  const created = [];        // ⚠️ paths THIS RUN minted - the only things the rollback may touch
  const exported = [];
  try {
    for (const it of sized) {
      if (shouldStop && shouldStop()) throw new (require('./sfExportCopy').ExportCancelled)();
      currentLabel = it.label || it.uuid;
      currentIndex = sized.indexOf(it) + 1;
      currentSourceBytes = it.bytes;
      currentPasses = it.passes || 1;
      phaseBase = 0;
      sawCompress = false;
      // ⭐⭐ SAY WHAT THE QUIET STRETCH IS DOING. [B-420, 2026-09-24]
      // Reported: *"this odd phase that appears like nothing... its short, but I don't get it."*
      // Between the modal opening and the first compressed byte there is real work that emitted
      // NOTHING, so the bar sat at `0 B of 805.0 MB` with no label and no filename: opening the
      // source, and `_selectFolderFiles` reading the first 256 bytes of every file to be sure none
      // of them is a disguised program. Measured at ~60 ms on the Decay source and ~520 ms on a 2,397
      // file bundle - short, and long enough to read as a stall when it is silent.
      // ⭐ NO NEW VOCABULARY. 'reading' already maps to "Reading files" in the door's phase table,
      // beside 'reconstruct' and 'compress'; this stretch simply never emitted one. The bar keeps
      // its own numbers, so this names the work without claiming progress it cannot measure.
      onProgress({ phase: 'reading', bytesDone: 0 });
      flush();
      const src = soundFontSources.openSource(userData, it.uuid);
      if (!src) throw new Error(`Source not found: ${it.uuid}`);
      // Curation sidecar rides along exactly as it does on the single export ([B-283]) - and, as
      // there, it is now placed DURING the export instead of being bolted onto the finished
      // archive. [B-420] The long note at the single-source door records what that removed.
      //
      // XX BOTH FORMATS CARRY IT, and that is the point of the change rather than a side effect.
      // This used to be zip-only because the sidecar was injected by rebuilding an ARCHIVE, so a
      // folder export had nothing to inject into. Writing it into the tree works for both, so all
      // four export doors now produce the same thing. Ryan asked what was different about the
      // contents of the four: the answer is now nothing.
      // !! THIS KNOWINGLY BREAKS FOLDER IMPORT UNTIL [B-427]. Import only peeks inside ZIPS, so a
      // folder re-imported today stores our .jmt-curation.json as vendor content and restores
      // nothing. His call, deliberately, 2026-09-23: "it is totally fine to break the imports right
      // now since it is the next thing we are fixing after this is done. So you should do the
      // export correctly now and we will learn how to deal with the import later."
      // ⭐ TAKEN FROM THE SIZING PASS, NOT REBUILT. [B-420, 2026-09-24] It used to be built here
      // and the denominator upstairs knew nothing about it - which is exactly how the bar came to
      // divide archive bytes by source-tree bytes. One build, one object, used by the total and by
      // the write, so the two cannot disagree about what is going in.
      const curationPayload = it.payload || null;
      const result = await src.exportToDownloads(target,
        { format, onProgress, shouldStop, curationPayload });
      if (result && result.destPath) created.push(result.destPath);
      const curation = (result && result.curation && result.curation.any) ? result.curation : null;
      // ⚠️ `destDir` IS THE CHOSEN DESTINATION, NOT THE THING WE CREATED IN IT. [B-420, 2026-09-23]
      // `destPath` is the folder or .zip this export produced; the eject offer needs the DIRECTORY
      // it landed in, because that is what resolves to a piece of removable media. The renderer had
      // to make do with destPath, which happens to be a directory for a folder export and is a FILE
      // for a zip - so the eject would have worked on exactly the format he tested and silently not
      // on the other one.
      exported.push({ uuid: it.uuid, label: currentLabel, destDir: target, ...result, curation });
      baseBytes += it.bytes * (it.passes || 1);
      baseFiles += it.files;
    }
  } catch (err) {
    // ⚠️⚠️ ROLL BACK EVERYTHING, INCLUDING THE SOURCES THAT FINISHED. This is the deliberate
    // deletion: without it a cancel at three of four leaves two archives at a destination the
    // user is about to be told nothing was copied to.
    // ⚠️ Retried, for the same reason `fs:removeSetAside` retries: on Windows a path holding a
    // file with an open handle cannot be removed, and a handle can outlive the write.
    const removed = [];
    const stubborn = [];
    for (const p of created) {
      let gone = false;
      for (let i = 0; i < 4 && !gone; i++) {
        try { await fs.promises.rm(p, { recursive: true, force: true }); gone = true; }
        catch { if (i < 3) await new Promise((r) => setTimeout(r, 150 * (i + 1))); }
      }
      (gone ? removed : stubborn).push(p);
    }
    flush();
    if (require('./sfExportCopy').isCancel(err)) {
      // ⚠️ `wroteCount: 0` is the TRUE number after a rollback, and the shared ending reads it to
      // say "Nothing new was copied." A count of what landed before the cancel would be a fact
      // about files that no longer exist.
      // ⚠️ `partialRemoved` IS WHAT THE SHARED ENDING READS to say the half-written thing was
      // taken back. The rollback IS that, for 1 source or for N - so the standalone door gets
      // the same sentence it used to hand-roll, from the one place that draws endings.
      return { ok: true, canceled: true, wroteCount: 0, rolledBack: removed.length,
               partialRemoved: removed.length > 0, leftovers: stubborn };
    }
    return { ok: false, error: String(err && err.message || err),
             rolledBack: removed.length, leftovers: stubborn };
  }
  flush();
  return { ok: true, exported, count: exported.length,
           totalBytes: grandBytes, fileCount: grandFiles };
}));

// Open a folder picker for source-export workflows. Returns the chosen
// path without running an export, so callers that need to export many
// sources to the same destination (bulk delete with "Export sources
// first") can pick once and then drive multiple exports. Remembers the
// last chosen dir.
// ── The single-FILE twin of pickExportDir ───────────────────────── [B-420, 2026-09-22]
//
// ⭐ WHY IT EXISTS: the right-click "Export…" on one file wrote through a save dialog that
// `sfFile:export` opened PARTWAY THROUGH ITS OWN WORK. Any progress bar raised around that call
// sat at zero behind a native dialog for as long as the user was choosing, which reads as a hang -
// so that branch could not join the shared runner while it owned the picker. Hoisting the dialog
// here is the same move the multi-path branch already made.
//
// ⚠️ THE NAMING RULES STAY IN MAIN, deliberately. The default name and the extension filter are
// computed the same way `_sfFileExportImpl` computes them, and duplicating that in the renderer
// would be a second implementation to keep in agreement forever - which is the disease this whole
// entry exists to cure. The renderer passes the basename it already has; main decides the rest.
ipcMain.handle('dialog:pickExportFilePath', async (_, { name } = {}) => {
  try {
    const lastDir = liveDir(Store.get('lastExportDir')) || app.getPath('downloads');
    const baseName = String(name || '').split(/[\\/]/).pop() || 'untitled';
    const ext = path.extname(baseName).replace(/^\./, '') || '*';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export file',
      defaultPath: path.join(lastDir, baseName),
      filters: ext === '*'
        ? [{ name: 'All files', extensions: ['*'] }]
        : [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    Store.set('lastExportDir', path.dirname(filePath));
    return { ok: true, destFile: filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('dialog:pickExportDir', async (_, { title } = {}) => {
  try {
    const lastDir = liveDir(Store.get('lastExportDir')) || app.getPath('downloads');
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
      title: 'Download your font from the creator',
      autoHideMenuBar: true,
      ...WINDOW_ICON,
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
        finish({ ok: false, message: `The creator's site returned an error (HTTP ${httpResponseCode}). It may be temporarily down; try again in a few minutes.` });
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
      // What the staged tree shared with the library at store time ([B-317]).
      // Measured during the copy, so it can only reach the meta by riding along.
      crossLinked: staged.crossLinked,
      // Carried straight through from the prepare result — the staged zip was
      // already stripped, and this is the curation that came out of it. ([B-283])
      curation: staged.curation,
      curationTmp: staged.curationTmp,
      curationPayloadDir: staged.curationPayloadDir,
      // This door serves the single-import review, so customized fonts wait
      // for Add to Library like every other row ([B-311] rescope, 2026-09-08).
      deferCustomized: true,
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// The strip's payload temp dir is only ever ours to remove: created by
// stripAndRepackage as os.tmpdir()/jmt-curation-*. Anything else is refused —
// same guard discipline as linkImport:cleanup.
const _isCurationTmpDir = (p) => {
  const os = require('os');
  const pathC = require('path');
  return !!p && pathC.basename(p).startsWith('jmt-curation-')
    && pathC.resolve(p).startsWith(pathC.resolve(os.tmpdir()) + pathC.sep);
};

// Restore the customized fonts the review left CHECKED, at Add to Library time
// ([B-311] rescope, 2026-09-08: "this shouldn't be put in my library until the
// user says import and only if checked"). The payload JSON is read back off the
// source's own meta — the sidecar was persisted there at commit — so the
// renderer only round-trips the temp-dir handles it was handed, like the staged
// folder door already does. The payload dir is dropped afterwards either way:
// with the restore done, nothing owes it anything.
ipcMain.handle('sources:restoreCustomized', async (event, { uuid, curationTmp, curationPayloadDir, picks } = {}) => {
  const fsr = require('fs');
  const pathR = require('path');
  try {
    if (!uuid || !Array.isArray(picks)) return { ok: false, error: 'Missing uuid/picks' };
    if (!_isCurationTmpDir(curationTmp)) return { ok: false, error: 'Not a curation temp dir' };
    if (!curationPayloadDir
        || !pathR.resolve(curationPayloadDir).startsWith(pathR.resolve(curationTmp) + pathR.sep)) {
      return { ok: false, error: 'Payload dir is not inside the curation temp dir' };
    }
    const ud = app.getPath('userData');
    const meta = soundFontSources.readSourceMeta(pathR.join(soundFontSources.sourcesRoot(ud), uuid));
    const curation = meta && meta.curation;
    if (!curation) return { ok: false, error: 'Source carries no curation' };
    const r = await require('./soundFontCuration')
      // XX FORWARDED ONTO THE CHANNEL THE RENDERER ALREADY HAS. [B-429] The restore reported nothing
      // for its whole life, so the import bar fell to 0% and held there. Nothing new was needed:
      // createEntry always accepted an onProgress and this channel always existed - the two were
      // simply never joined, and the renderer subscribed a moment too late to hear it anyway.
      .restoreCustomizedEntries(ud, uuid, curation, curationPayloadDir, picks,
        (p) => { try { event.sender.send('entries:createProgress', p); } catch {} });
    return r || { ok: false, error: 'Restore returned nothing' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    if (_isCurationTmpDir(curationTmp)) {
      try { fsr.rmSync(curationTmp, { recursive: true, force: true }); } catch {}
    }
  }
});

// Drop a deferred customized payload without restoring anything: the cancel
// path, and the commit path when every customized row was unchecked.
ipcMain.handle('sources:discardCustomized', (_event, { curationTmp } = {}) => {
  try {
    if (!_isCurationTmpDir(curationTmp)) return { ok: false };
    require('fs').rmSync(curationTmp, { recursive: true, force: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
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
      // Single-import door: customized fonts ride the review as rows and are
      // restored at Add to Library, checked rows only ([B-311], 2026-09-08).
      // The bulk door calls finalizePreparedSource directly and keeps its
      // eager restore — its commit already runs after the user confirmed.
      deferCustomized: true,
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

// ⚠️⚠️ THIS KILLED THE APP. Observed 2026-09-19 while sending `sd 1` from the Serial
// Monitor: "A JavaScript error occurred in the main process - Error: Writing to COM port
// (GetOverlappedResult): Operation aborted", and the app went down.
//
// The sequence: removeAllListeners() stripped the port's 'error' handler, and close() was
// called immediately after. A write still in flight is aborted by that close and the port
// emits 'error' - with nothing listening. An unhandled 'error' on an EventEmitter is not a
// swallowed warning, it is an uncaught exception, and in the main process that is fatal.
//
// The trap is that the code LOOKS defensive: every call is wrapped in try/catch. But those
// catch synchronous throws, and this error arrives asynchronously on an event, so not one
// of them could ever have caught it.
//
// So: drop the listeners that would talk to a renderer about a port we are deliberately
// discarding, and keep a sink on 'error' until the port is actually shut. The sink outlives
// this function because the abort can arrive after it returns.
function _closeSerialMonitor() {
  if (!_serialMonitorPort) return;
  const sp = _serialMonitorPort;
  _serialMonitorPort = null;
  try { sp.removeAllListeners('data'); } catch {}
  try { sp.removeAllListeners('close'); } catch {}
  try { sp.removeAllListeners('error'); } catch {}
  // Deliberately anonymous and never removed: this port is being thrown away, and its only
  // remaining job is to not take the process with it.
  try { sp.on('error', () => {}); } catch {}
  try { if (sp.isOpen) sp.close(() => {}); } catch {}
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
    // ⚠️ write() can THROW synchronously when the port went away between the isOpen check
    // above and this line - a board unplugged mid-command is exactly that window. Without
    // this, the throw escapes the Promise executor and becomes another uncaught exception
    // in the main process, which is the same fatal shape as the aborted-write event.
    try {
      _serialMonitorPort.write(text, err => {
        if (err) return resolve({ ok: false, error: err.message });
        resolve({ ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
    }
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
  //
  // CASE-INSENSITIVE ON THE FOLLOWER, and the source is why: ProffieOS prints
  // `installed: ` in lower case (ProffieOS.ino, the `version` command) on 7.7,
  // 7.15 and 8.10. Only 6.9 carries the capitalised form this pattern was written
  // against. A capital-only test therefore rejected the follower on every modern
  // board, leaving the CONFIG_FILE `.h` line as the sole path that worked.
  const reply = buf.match(/^[ \t]*v?(\d+\.\d+[\w.\-]*)[ \t]*\r?\n[ \t]*(?:\S*\.h|installed:)[ \t\S]*\r?$/mi);
  if (reply) return 'v' + trim(reply[1]);
  return null;
}

// True when the buffer holds ProffieOS's answer to `version`, WHATEVER the first
// line says. The reply has a recognisable shape even when the version string
// itself is unreadable: CONFIG_FILE, then `prop:`, then `buttons:`, then
// `installed:`. Ordinary board chatter does not emit `prop:` and `buttons:` on
// their own lines, so requiring both keeps this as narrow as parseBoardVersion.
//
// ⚠️⚠️ THIS EXISTS BECAUSE "NO VERSION" AND "NO ANSWER" ARE DIFFERENT FACTS AND
// THE APP REPORTED THEM AS ONE. Measured on a real board 2026-09-19: factory
// firmware built Mar 2023 answers `version` with
//     $Id: ce12a06a1e236b5101ec60c950530a9a4719a74d $
//     config/default_proffieboard_config.h
//     prop: Saber
//     buttons: 2
//     installed: Mar 30 2023 03:03:48
// No ProffieOS RELEASE does this - all thirteen trees on this machine define
// `const char version[] = "vX.Y"` - so it is a build made from a git checkout
// with ident expansion, which is what a manufacturer's QC flash looks like.
// parseBoardVersion is RIGHT to return null: there is no version there. The bug
// was downstream, where a null turned into a 2.5s timeout and the UI said "The
// board did not answer" about a board that had answered immediately. That sent
// the user to close the Serial Monitor and re-plug a working board.
//
// ⚠️ SCOPE: recognises the 7.x/8.x reply shape, which is the one observed. A
// 6.9-shaped reply (version + `Installed:` only, no prop/buttons) with an
// unreadable version has never been seen and is deliberately not guessed at.
function parseBoardReplied(buf) {
  return /^[ \t]*prop:[ \t]*\S/mi.test(buf) && /^[ \t]*buttons:[ \t]*\d/mi.test(buf);
}

// The line the board gave where a version belongs - the one immediately before
// CONFIG_FILE. Shown to the user so "not recognised" names what was actually
// received instead of asking them to go and look themselves.
function parseBoardVersionRaw(buf) {
  const m = buf.match(/^[ \t]*(\S[^\r\n]*?)[ \t]*\r?\n[ \t]*\S*\.h[ \t]*\r?$/mi);
  return m ? m[1].slice(0, 120) : null;
}

// When the firmware was flashed, as the board reports it:
//   > version
//   v6.9
//   Installed: Aug 19 2026 10:29:12
// A `__DATE__ __TIME__` string in the board's own sense, with no timezone, so it
// is for DISPLAY and loose comparison against @jmt:flashed — never exact equality.
// Separate from parseBoardVersion on purpose: two facts, two absences. A board
// that reports a version and no install date must not look like a failed probe.
//
// ⚠️ CASE-INSENSITIVE, AND IT WAS NOT. ProffieOS prints `installed: ` in lower
// case on 7.7, 7.15 and 8.10; only 6.9 prints `Installed:`. A capital-only match
// therefore returned null for EVERY modern board, so the build date silently
// never appeared - the one case the comment above says must not look like a
// failed probe. It survived because test/board-version-parse.test.js is
// synthetic by its own description and covers parseBoardVersion only; nothing
// exercised this function at all. (Read off the ProffieOS sources 2026-09-19.)
// ⚠️⚠️ A TERMINATED LINE IS REQUIRED, AND `$` IS NOT ENOUGH. Serial arrives in
// chunks and the probe runs this on every one, so a chunk boundary landing inside
// the date is an ordinary event. Under /m, `$` matches end-of-STRING as well as
// end-of-line, so a half-received line matched happily and returned a truncated
// date - the probe then finished on it, because a truthy install date ends the
// wait. Measured: a buffer cut after "Sep 19 2026 10:3" returned exactly that.
// Seen on his board 2026-09-19 as "built Sep 19 2026 10." in the tooltip.
// Demanding \n means a partial line yields null, the 250ms grace window runs, and
// the finished line is read instead. ProffieOS always terminates it ("\n" after
// install_time), so nothing legitimate is lost.
function parseBoardInstalled(buf) {
  const m = buf.match(/^[ \t]*installed:[ \t]*(\S[^\r\n]*?)[ \t]*\r?\n/mi);
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
  // ⚠️⚠️ SAME CRASH AS _closeSerialMonitor, AND THIS PATH IS MORE EXPOSED. It writes
  // `\nversion\n` and then closes, and it runs on its own whenever a board is detected -
  // so every probe is a write followed by a close, which is precisely the ordering that
  // aborts an in-flight write. Stripping the 'error' listener first leaves that abort
  // unhandled, and an unhandled 'error' event in the main process is fatal.
  // The try/catch around close() cannot help: the abort arrives asynchronously on an event.
  const shut = () => {
    if (!sp) return Promise.resolve();
    const p = sp;
    sp = null;
    try { p.removeAllListeners('data'); } catch {}
    try { p.removeAllListeners('close'); } catch {}
    try { p.removeAllListeners('error'); } catch {}
    try { p.on('error', () => {}); } catch {}   // sink: outlives this call on purpose
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
      // The board ANSWERED, but its version line is not one we can read. Finish on
      // that fact rather than letting the 2.5s timer call it silence: "did not
      // answer" sends the user after the port (close the monitor, re-plug the
      // board) when the port was never the problem.
      //
      // ⚠️⚠️ SAME GRACE WINDOW AS THE VERSION PATH, AND IT IS NOT OPTIONAL HERE.
      // parseBoardReplied goes true at `buttons:`, but `installed:` is the LAST line
      // of the reply and parseBoardInstalled now requires its terminating newline -
      // which routinely arrives in the NEXT chunk. Finishing immediately therefore
      // dropped the build date entirely, in the one state where it is the only
      // identifying fact the firmware has. Observed on his board 2026-09-19: the
      // date was present before the newline requirement went in and absent after.
      // Waiting the same 250ms lets the line complete.
      if (parseBoardReplied(buf)) {
        const unrecognised = () => finish({
          ok: false,
          reason: 'unrecognised',
          raw: parseBoardVersionRaw(buf),
          installed: parseBoardInstalled(buf),
        });
        if (parseBoardInstalled(buf)) return unrecognised();
        if (!graceTimer) graceTimer = setTimeout(unrecognised, 250);
        return;
      }
      // A flooding board (charge-detect chatter, a serial-print loop) would grow
      // this without bound. Keep a tail large enough to hold a whole reply.
      // ⚠️ Trimming must not cut a reply in half before the two tests above have
      // seen it, which is why it stays AFTER them rather than at the top.
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
  const lastDir = liveDir(Store.get('lastSfSourceDir')) || app.getPath('documents');
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
  // An export to a folder the user picked never refuses because something is already there, and
  // never overwrites: it lands beside it as name_1, name_2, the way a browser handles downloading
  // the same file twice. Nothing is destroyed, so there is no confirm to write and no destructive
  // path to guard. This used to dead-end on an error whose only button was OK.
  //
  // NOT the rule for names the app OWNS. A sound font library entry is keyed by its name and
  // deduped by content hash, so a silent _1 there would fragment the library - soundFonts:importFont
  // above refuses on purpose and must stay that way. See local/ui-conventions.md. (2026-08-23)
  let dest = path.join(destFolder, name);
  // First copy is _2 ([B-343]): the original is implicitly number one.
  for (let n = 2; fs.existsSync(dest) && n < 1000; n++) dest = path.join(destFolder, `${name}_${n}`);
  if (fs.existsSync(dest)) return { ok: false, error: 'Too many copies of this version in that folder.' };
  const allVersions = proffie.listVersionsDetails();
  const versionInfo = allVersions.find(v => v.name === name);
  if (!versionInfo) return { ok: false, error: 'Version not found.' };
  // ⭐⭐ THIS DOOR HAD NO CHECKS OF ANY KIND UNTIL 2026-09-20. [B-005 item 4, B-203, B-238]
  // It writes an ENTIRE ProffieOS tree to any folder the user points at - the largest
  // multi-file export outside the Sound Fonts tab - with no fit refusal, no slow-transport
  // warning and no cancel. Nothing stopped someone aiming it at a card.
  //
  // ⚠️ IT WAS EXEMPT BY OMISSION, NOT BY DECISION. It never appeared on any door list because
  // every sweep searched for "export" in the Sound Fonts code; it surfaced only when the
  // door-map test swept handler names across all of main. Same root cause as the two doors
  // whose names hid them - classify by what a call WRITES TO, never by where it lives.
  //
  // ⚠️ The old copy was `cpDir`: recursive `readdirSync` + `copyFileSync` with no awaits. That
  // is the shape that froze the app on him on 09-19 - a synchronous loop never yields, so even
  // a cancel flag could not have been delivered. Replaced with the shared streamed walk, which
  // yields, reports bytes, stops mid-file and removes its own partial.
  const _srcRoot = versionInfo.path || versionInfo.dir || null;
  const _sizeOf = (p) => {
    let bytes = 0, files = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.isFile()) { files++; try { bytes += fs.statSync(fp).size; } catch {} }
      }
    };
    try { walk(p); } catch {}
    return { bytes, files };
  };
  const srcRoot = _srcRoot || path.join(proffie.getUserVersionsPath(), name);
  const { bytes: _vBytes, files: _vFiles } = _sizeOf(srcRoot);

  // ── The same preflight every other door runs ──
  try {
    const _pf = await require('./exportDestination').preflight(destFolder, {
      totalBytes: _vBytes, fileCount: _vFiles,
      classify: require('./exportDestination').isSlowWriteJob(_vFiles, _vBytes),
    });
    // ⚠️ REFUSED BEFORE ANYTHING IS WRITTEN. An OS tree that does not fit used to write until
    // the disk filled and then fail with whatever error the filesystem produced.
    if (_pf && _pf.tooBig) return { ok: false, tooBig: _pf.tooBig };
    if (_pf && _pf.slowWrite) return { ok: false, slowWrite: { ..._pf.slowWrite, destDir: destFolder } };
  } catch { /* never fails closed: an unmeasurable destination still exports */ }

  // ⚠️ Under the gate, so the shared Cancel button can stop it like any other export.
  return _withExportCancel(async (shouldStop) => {
    try {
      const { copyTreeWithProgress } = require('./sfExportCopy');
      fs.mkdirSync(dest, { recursive: true });
      await copyTreeWithProgress(srcRoot, dest, { shouldStop });
      shell.showItemInFolder(dest);
      return { ok: true, dest };
    } catch (e) {
      if (require('./sfExportCopy').isCancel(e)) {
        // The destination was minted by this call (the _N loop above guarantees a fresh
        // name), so removing it cannot touch anything already the user's.
        try { await fs.promises.rm(dest, { recursive: true, force: true }); } catch {}
        return { ok: true, canceled: true };
      }
      return { ok: false, error: e.message };
    }
  });
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
  // ⭐ THIS PC IS THE RIGHT DEFAULT HERE EVEN WHEN NOTHING IS REMEMBERED: the user is choosing
  // a DRIVE, not a folder, and the drive list is where that choice lives.
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a drive or SD-card folder',
    defaultPath: await exportDefaultPath(Store.get('lastSdPickDir'), null),
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  try { Store.set('lastSdPickDir', res.filePaths[0]); } catch {}
  return res.filePaths[0];
});
ipcMain.handle('sdcard:scanPath', (_, p) => sdCardDetect.assessPicked(p));
ipcMain.handle('sdcard:listDir', (_, p) => sdCardDetect.listDir(p));
// The volume a path sits on, for naming it on screen. A bare drive root reads as
// "K:\\" in a sentence, which is the shortest and least identifiable thing we could
// print about a card the user physically holds and has probably labelled. [B-403]
// Read-only, and returns null rather than throwing on every platform but Windows.
ipcMain.handle('sdcard:volumeInfo', async (_, p) => {
  try {
    const m = /^([A-Za-z]):/.exec(String(p || ''));
    if (!m) return null;
    // ⚠️ [B-420] ONE ROW, NOT EVERY VOLUME. This enumerated the whole system to read a label
    // off a single drive - and an unfiltered enumeration includes mapped network drives, so a
    // share whose host was unreachable could block it for over a minute. Naming the card the
    // user is holding must never depend on a machine they are not using.
    const v = await sdCardDetect.volumeForLetter(m[1]);
    return v ? { drive: v.drive, label: v.label || null, driveType: v.driveType } : null;
  } catch { return null; }
});
// Card-wide executable NAME scan ([B-214]). Directory entries only, no file is
// opened, so it does not reintroduce what [B-361] removed. ~100ms on a full card.
ipcMain.handle('sdcard:executables', (_, p) => {
  try { return sdCardDetect.scanCardExecutables(p); }
  catch { return { files: [], complete: false, scanned: 0, ms: 0 }; }
});
// ── Async health walk ([B-348], narrowed by [B-361]) ────
// ONE caller remains: the right-click check on a SINGLE font folder. The
// whole-card walk this was built for is gone — browsing no longer reads file
// contents at all, and corruption is found at import, off the read the import
// already does. The filesHealth half (the current folder's direct wavs,
// checked before every paint) went with it.
// The sync folderHealth above froze the app for minutes on a slow card
// (~36ms per file OPEN × 7,307 wavs, measured 2026-09-08): a synchronous
// walk inside an ipcMain.handle blocks the main event loop, and with it
// every later IPC in the queue. These handlers run the same checks through
// sdCardDetect's async walk: the event loop breathes between files, progress
// streams to the caller, and a cancel actually abandons the work.
// Job registry: renderer passes a jobId it minted; cancel flips the flag the
// walk polls between files. Entries are cleaned up when the walk returns.
const _sdHealthJobs = new Map();
ipcMain.handle('sdcard:subtreeHealth', async (e, { dirPath, dirNames, jobId }) => {
  _sdHealthJobs.set(jobId, { cancelled: false });
  // Progress is throttled here, not in the module: per-dir completions always
  // go out (they carry badges), per-file ticks at most every 250ms.
  let lastTick = 0;
  try {
    return await sdCardDetect.subtreeHealthAsync(dirPath, dirNames || [], {
      isCancelled: () => _sdHealthJobs.get(jobId)?.cancelled !== false,
      onDirDone: (p) => { try { e.sender.send('sdcard:healthProgress', { jobId, kind: 'dir', ...p }); } catch {} },
      tick: (seen) => {
        const now = Date.now();
        if (now - lastTick < 250) return;
        lastTick = now;
        try { e.sender.send('sdcard:healthProgress', { jobId, kind: 'tick', seen }); } catch {}
      },
    });
  } catch { return { dirs: {}, cancelled: false, seen: 0, notChecked: 0 };
  } finally { _sdHealthJobs.delete(jobId); }
});
ipcMain.handle('sdcard:healthCancel', (_, jobId) => {
  const j = _sdHealthJobs.get(jobId);
  if (j) j.cancelled = true;
  return { ok: !!j };
});
// What KIND of folder is this, for the browser's right-click menu. [B-280/B-281]
//
// ⚠️ THE FONT TEST IS soundFontBulkImport.looksLikeProffieDir, NOT A COPY OF IT.
// That rule already exists twice (here and in sdCardDetect.classifyCard) with
// comments in both saying they must agree or the card count disagrees with the
// import. A third copy in the renderer is exactly the drift being removed.
//
// ⚠️ THE TRACKS TEST IS DELIBERATELY BROADER THAN THE SCANNER'S. `looksLikeTracksDir`
// matches the NAME `tracks` only, because the scanner walks a whole card unattended
// and must not guess. Here the user has right-clicked one specific folder, so intent
// is explicit and "holds wavs, is not a font" is the honest test. Two rules on
// purpose.
ipcMain.handle('sdcard:folderShape', (_, dirPath) => {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return { ok: false, error: 'Folder not found' };
    if (soundFontBulkImport.looksLikeProffieDir(dirPath)) return { ok: true, shape: 'font' };
    // ⚠️ looksLikeCommonDir takes a NAME, looksLikeProffieDir takes a PATH. Verified,
    // not assumed — passing the path to the name-based one silently never matches.
    if (soundFontBulkImport.looksLikeCommonDir(path.basename(dirPath))) {
      return { ok: true, shape: 'common' };
    }
    let wavs = 0;
    for (const e of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (e.isFile() && /\.wav$/i.test(e.name)) wavs++;
    }
    return { ok: true, shape: wavs > 0 ? 'tracks' : 'other', wavs };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});
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
