// @ts-nocheck
/**
 * buildPanel.js
 * Renderer-side logic for compile, flash, port detection, and log panel.
 * Loaded by index.html after Monaco is initialized.
 * Expects window.electronAPI and window.getEditorContent to be available.
 */

// ── Known boards (used when no port is connected) ──────
const KNOWN_BOARDS = [
  { boardName: 'Proffieboard V3', fqbn: 'proffieboard:stm32l4:ProffieboardV3-L452RE' },
  { boardName: 'Proffieboard V2', fqbn: 'proffieboard:stm32l4:ProffieboardV2-L433CC' },
  { boardName: 'Proffieboard',    fqbn: 'proffieboard:stm32l4:Proffieboard-L433CC' },
];

// ── State ──────────────────────────────────────────────
let selectedPort              = null;
let selectedPortIsProffieboard = false;
let selectedPortSN            = null;   // serial number of the currently selected port
let lastFlashedSN             = null;   // SN of the board we last flashed this session
// Frozen at the start of a touch-reset flash. During the touch-reset → DFU →
// reboot sequence, the serial port briefly disappears; refreshPorts runs and
// clearDetectedBoard() wipes selectedPort/selectedPortSN to null. By the time
// onBuildDone fires with type:'flash', the live state has been clobbered and
// setFlashedTimestamp(null, null) silently drops the metadata update. The
// guards on the setter mask the upstream bug, so the file's @jmt:board_sn
// and @jmt:last_port stayed at whatever was loaded from the file.
let _flashTargetPort          = null;
let _flashTargetSN            = null;
let selectedFqbn              = null;
let compileSuccess      = false;   // true after successful compile this session
let cacheCheckPending   = false;   // true while cache check is in flight
let _cacheCheckSeq      = 0;       // only the newest checkCacheForConfig run may write state
// Carried from a failed flash into the Bootloader Mode modal, which clears its own log on open.
// Set only when the port the user picked was never identified as a Proffieboard.
let _dfuPortNote        = null;

// The last thing the toolchain indicator was told, so an install can take it over and give it back.
//
// That indicator is written once by `toolchain:initialize` at startup and never revisited, but a
// plugin install started from the Versions panel goes through `core:install` on a different
// channel. So the app said "Toolchain ready" beside a Compile button it had just disabled with
// "Downloading and installing Proffieboard Plugin 3.6.0" - contradicting itself on one screen while
// holding the answer in `_coreInstallInFlight`, which only `compileBlockedReason` ever read.
// (2026-08-14)
let _lastToolchainStatus = null;
// True while a plugin install started by the MAIN process (ensureCore, at startup
// or on a version switch) is running. The panel's own installs set
// window._coreInstallInFlight; this one had no equivalent, so nothing in the
// renderer knew it was happening. (2026-08-15)
let _startupCoreInstall  = false;
window.setToolchainBusy = (label) => {
  setStatus('toolchain', 'pending', label);
};
window.clearToolchainBusy = () => {
  if (_lastToolchainStatus) setStatus('toolchain', _lastToolchainStatus.state, _lastToolchainStatus.message);
};
// The selected ProffieOS version is pinned to a plugin that is not on the
// machine. Distinct from "busy": nothing is arriving, and nothing will until the
// user asks for it.
//
// That indicator is written once by toolchain:initialize at startup and never
// revisited, so it went on reading "Toolchain ready" while the plugin the next
// build needs was absent. Reachable three ways, not just one: cancelling an
// install, an install that failed offline, or pinning to a plugin you have never
// downloaded. Deliberately does NOT overwrite _lastToolchainStatus, so the real
// startup answer is still there to restore. (2026-08-15)
window.setToolchainPluginMissing = (version) => {
  if (version) setStatus('toolchain', 'error', `Proffieboard Plugin ${version} is not installed`);
  else if (_lastToolchainStatus) setStatus('toolchain', _lastToolchainStatus.state, _lastToolchainStatus.message);
};
let toolchainReady  = false;
let isBusy          = false;   // true while compile/flash running
let unsubs          = [];      // IPC listener cleanup functions
// Splash-aware deferral for the toolchain-setup branch of onBuildStatus.
// During first-launch toolchain install the IPC fires before the splash has
// finished destroying, and opening the build log mid-paint produced a layout
// glitch where the panel briefly grabbed the full window. We now defer that
// single open until the splash-dismissed signal arrives; other openLog
// callsites (compile fail, flash fail) run long after splash and never need
// to wait.
let _splashDismissed       = false;
let _queuedOpenLogForSetup = false;
let cachedPorts = [];
let selectedUsb = 'cdc_webusb'; // default Serial + WebUSB
// Only the newest refreshPorts run may write. Enumerating serial ports takes a
// noticeable moment at startup, and the dropdown is live the whole time - so a
// port picked during that window was overwritten the instant the in-flight
// refresh came back and rebuilt the list. Same shape as _cacheCheckSeq: an async
// run finishing after a newer user action and writing anyway. (2026-08-15)
let _portRefreshSeq    = 0;
// What port DETECTION last reported, kept so clearing a selection can restore it
// rather than replacing it with a statement about the selection. (2026-08-15)
let _lastPortDetectMsg = null;
let _userChosePort     = false;   // true after user manually picks a port
let _userChosenPortPath = null;   // the path they chose
let compileTimerInterval  = null;
let flashTimerInterval    = null;
let contentDebounceTimer  = null;
let _compileStartTime     = 0;
// One-shot lead message typed into the flash hint line when an SD fix at the
// flash gate resolved to a cached build (no recompile). Set by _flashAfterSdFix.
let _sdFlashLeadMsg       = null;

// ── Compile hint typewriter ────────────────────────────
let _hintActive          = false;
let _hintIndex           = 0;
let _hintTimeout         = null;   // initial 60s delay
let _hintTypingTimer     = null;   // setInterval for character typing
let _hintFadeTimeout     = null;   // hold-then-fade timer
let _hintNextTimeout     = null;   // gap between messages
let _hintDurationTimeout = null;   // clears last-compile duration before first hint
let _leadHint            = null;   // one-off message shown first (e.g. SD-guard Easter egg)

function _formatCompileDuration(seconds) {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} minute${m !== 1 ? 's' : ''}` : `${m}m ${s}s`;
}

function startCompileHints(leadMessage) {
  stopCompileHints();
  _hintActive = true;
  _hintIndex  = 0;
  _leadHint   = leadMessage || null;

  // A lead (compile opener / Easter egg / fix message) types in immediately and
  // holds; the authored hint cycle still begins at the 60s mark and replaces it,
  // so the timed hints stay exactly as written.
  if (_leadHint) _showNextHint();
  _hintTimeout = setTimeout(_showNextHint, 60000);
}

function stopCompileHints() {
  _hintActive = false;
  clearTimeout(_hintTimeout);
  clearTimeout(_hintFadeTimeout);
  clearTimeout(_hintNextTimeout);
  clearTimeout(_hintDurationTimeout);
  clearInterval(_hintTypingTimer);
  _hintTimeout = _hintFadeTimeout = _hintNextTimeout = _hintTypingTimer = _hintDurationTimeout = null;
  _leadHint = null;
  const el = document.getElementById('bm-hint');
  if (el) { el.style.transition = 'none'; el.style.opacity = '0'; el.textContent = ''; }
}

function _showNextHint() {
  if (!_hintActive) return;
  let text, isLead = false;
  if (_leadHint) {
    text = _leadHint;   // one-off lead (opener / Easter egg / fix) shows before the cycle
    _leadHint = null;
    isLead = true;
  } else {
    const hints = (typeof COMPILE_HINTS !== 'undefined') ? COMPILE_HINTS : [];
    if (_hintIndex >= hints.length) return; // list exhausted — stop quietly
    text = hints[_hintIndex++];
  }
  const el = document.getElementById('bm-hint');
  if (!el) return;

  // Reset for new message
  el.style.transition = 'none';
  el.style.opacity    = '1';
  el.textContent      = '';

  // Type one character at a time
  let i = 0;
  _hintTypingTimer = setInterval(() => {
    if (!_hintActive) { clearInterval(_hintTypingTimer); _hintTypingTimer = null; return; }
    el.textContent = text.slice(0, ++i);
    if (i >= text.length) {
      clearInterval(_hintTypingTimer);
      _hintTypingTimer = null;
      if (isLead) return; // lead holds until the 60s timer starts the authored cycle
      // Hold fully-typed for 12s, then fade out
      _hintFadeTimeout = setTimeout(() => {
        if (!_hintActive) return;
        el.style.transition = 'opacity 400ms ease';
        el.style.opacity = '0';
        // After fade completes, wait ~11s then show next
        _hintNextTimeout = setTimeout(() => {
          if (!_hintActive) return;
          el.style.transition = 'none';
          el.textContent = '';
          _showNextHint();
        }, 11400); // 400ms fade + 11s gap ≈ 25s total cycle
      }, 12000);
    }
  }, 28); // ~28ms/char ≈ 35 chars/sec
}

// Types a one-off message into #bm-hint (the italicized, under-the-box hint line),
// same treatment as the compile hints. Used for the SD-guard flash Easter egg,
// where the hint cycle isn't running. Cancels any cycling hints; types once and
// holds until the flash finishes (finishBuildModal -> stopCompileHints clears it).
function typeHintMessage(text) {
  stopCompileHints();
  _hintActive = true;
  const el = document.getElementById('bm-hint');
  if (!el) return;
  el.style.transition = 'none';
  el.style.opacity    = '1';
  el.textContent      = '';
  let i = 0;
  _hintTypingTimer = setInterval(() => {
    if (!_hintActive) { clearInterval(_hintTypingTimer); _hintTypingTimer = null; return; }
    el.textContent = text.slice(0, ++i);
    if (i >= text.length) { clearInterval(_hintTypingTimer); _hintTypingTimer = null; }
  }, 28);
}
let isDfuMode       = false;   // true when bootloader (DFU) mode is active
let dfuDeviceReady  = false;   // true after DFU device detected in waiting modal
let _portsBeforeDfu = [];      // port paths present before entering DFU — used to identify the newly-appeared board after flash
let _dfuRetryRecheck     = false;  // retry button should re-poll (not restart flash flow)
let _dfuRetryAutoFlash   = true;   // whether to auto-flash when retry re-poll succeeds
window._isFlashing = false;
window.onEditorContentChanged = () => {
  if (compileSuccess) {
    compileSuccess = false;
    setFlashEnabled(false);
    cacheCheckPending = true;
    updateCompileButton();
    setStatus('compile', 'warn', 'Config changed — recompile needed');
  }
  // Debounced cache check: if user reverts content to a previously compiled state, restore
  clearTimeout(contentDebounceTimer);
  contentDebounceTimer = setTimeout(() => checkCacheForConfig(false), 600);
};

// Invalidate a successful compile from outside the editor-change path (e.g. the
// SD guard switching the USB mode at flash time, which makes the built binary
// stale). Mirrors the invalidation in onEditorContentChanged.
window.invalidateCompile = (msg) => {
  if (compileSuccess) {
    compileSuccess = false;
    setFlashEnabled(false);
    cacheCheckPending = true;
    updateCompileButton();
  }
  setStatus('compile', 'warn', msg || 'Recompile needed');
};

// ── DOM refs ───────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) els[id] = document.getElementById(id);
  return els[id];
}

// NOTE: `isVersionSentinel` is a GLOBAL declared in index.html and used freely
// here. Do NOT redeclare it — this file and index.html's inline script are both
// classic scripts sharing one global lexical scope, so a `const`/`let` of that
// name here is a SyntaxError that kills this whole file at parse time (and with
// it every build-panel function). Cost that once, on 2026-07-29.

// ── Init ───────────────────────────────────────────────
async function initBuildPanel() {
  // Clean up any previous listeners
  unsubs.forEach(fn => fn());
  unsubs = [];

  // Wire IPC listeners
  // A plugin install has moved past intent into real work. Only now is there
  // something in the log worth showing. (2026-08-15)
  if (window.electronAPI.onCoreInstallProgress) {
    unsubs.push(window.electronAPI.onCoreInstallProgress(({ phase }) => {
      // Keyed on the phase ALONE, not on a flag set by the setup signal. That
      // flag made opening depend on a message arriving first, which is a chain
      // with a startup race in it - and the failure was silent, so a real
      // download went unshown. A `downloading` phase happens only during a
      // plugin install, so it is sufficient on its own. `index` is deliberately
      // excluded: that step is a small catalogue fetch and it is where an
      // offline attempt dies, which is the case that should NOT open a panel.
      // (2026-08-15)
      if (phase !== 'downloading') return;
      if (_splashDismissed) openLog();
      else _queuedOpenLogForSetup = true;
    }));
  }
  unsubs.push(window.electronAPI.onBuildLog(onBuildLog));
  unsubs.push(window.electronAPI.onBuildStatus(onBuildStatus));
  unsubs.push(window.electronAPI.onBuildDone(onBuildDone));
  unsubs.push(window.electronAPI.onPortsChanged(() => refreshPorts()));
  // Splash-dismissed signal — release any queued openLog from a toolchain-setup
  // event that fired before the splash finished. Also query the current state
  // in case the signal fired before this listener was registered (race window
  // on slow renderer startup).
  unsubs.push(window.electronAPI.onSplashDismissed(() => {
    _splashDismissed = true;
    if (_queuedOpenLogForSetup) {
      openLog();
      _queuedOpenLogForSetup = false;
    }
  }));
  window.electronAPI.isSplashDismissed().then(dismissed => {
    if (!dismissed || _splashDismissed) return;
    _splashDismissed = true;
    if (_queuedOpenLogForSetup) {
      openLog();
      _queuedOpenLogForSetup = false;
    }
  });

  // Each installed tree's real ProffieOS version, so a connected board's report
  // can be compared against it. Cheap (one small read per tree, cached in main).
  loadOSVersionMap();

  // ArgumentName enum is loaded lazily — base color swatches don't need it
  // (those come from the styles file), and the legacy hardcoded table covers
  // common args until the user does something that requires the live enum
  // (opens Advanced for the first time, or hovers a tooltip). Saves the IPC
  // roundtrip when the user never touches Advanced.

  // Wire buttons
  el('bp-btn-compile').addEventListener('click', doCompile);
  el('bp-btn-flash').addEventListener('click', doFlash);
  el('bp-btn-refresh-ports').addEventListener('click', async () => {
    const btn = el('bp-btn-refresh-ports');
    btn.style.animation = 'spin 0.7s linear infinite';
    await refreshPorts();
    btn.style.animation = '';
  });
  el('bp-port-select').addEventListener('change', onPortChange);
  el('bp-btn-exit-dfu').addEventListener('click', exitDfuMode);
  document.getElementById('linux-serial-copy')?.addEventListener('click', (e) => {
    navigator.clipboard.writeText('sudo usermod -aG dialout $USER').then(() => {
      e.target.textContent = 'Copied!';
      setTimeout(() => { e.target.textContent = 'Copy Commands'; }, 2000);
    });
  });
  document.getElementById('linux-udev-copy')?.addEventListener('click', (e) => {
    const cmd = document.getElementById('linux-udev-cmd')?.textContent || '';
    navigator.clipboard.writeText(cmd).then(() => {
      e.target.textContent = 'Copied!';
      setTimeout(() => { e.target.textContent = 'Copy Commands'; }, 2000);
    });
  });
  el('bp-log-toggle').addEventListener('click', toggleLog);
  el('bp-log-clear').addEventListener('click', () => { clearLog(); closeLog(); });
  wireSerialMonitor();
  document.getElementById('input-board').addEventListener('change', onInputBoardChange);
  // Seed selectedFqbn from dropdown without triggering a cache check (no file open yet)
  const _initBoardSel = document.getElementById('input-board');
  const _initBoardOpt = _initBoardSel ? _initBoardSel.options[_initBoardSel.selectedIndex] : null;
  selectedFqbn = (_initBoardOpt && _initBoardOpt.dataset.fqbn) ? _initBoardOpt.dataset.fqbn : null;
  el('bp-usb-select').addEventListener('change', e => {
    const prevUsb = selectedUsb;
    selectedUsb = e.target.value;
    updateUsbChangedIndicator();
    // USB mode is persisted per-config via the @jmt:usb marker, so a change is a
    // saveable config edit — mark dirty like the other meta fields do.
    window.markConfigDirty?.();
    // Touchpoint 1: changing INTO a Mass Storage mode is the first chance to
    // offer the SD-card guard. Programmatic setSelectedUsb (config load) does not
    // fire this handler, so loads never trigger it; they warn at compile instead.
    if (/msc/i.test(selectedUsb) && !/msc/i.test(prevUsb || '')) {
      window._notePreMassStorageMode?.(prevUsb); // remember what to revert to
      window.offerMountSdSettingOnSelect?.(selectedUsb);
    }
    if (compileSuccess) {
      compileSuccess = false;
      setFlashEnabled(false);
      setStatus('compile', 'warn', 'USB mode changed — recompile needed');
    }
    cacheCheckPending = true;
    updateCompileButton();
    checkCacheForConfig('USB mode changed — recompile needed');
  });
  document.getElementById('input-version').addEventListener('change', onOsVersionChange);
  document.getElementById('bm-close').addEventListener('click', () => {
    stopPortWatch();
    document.getElementById('build-modal').style.display = 'none';
  });
  document.getElementById('bm-v1-feedback-link').addEventListener('click', e => {
    e.preventDefault();
    const subject = encodeURIComponent('JMT Studio — Proffieboard V1 Flash Feedback');
    const body    = encodeURIComponent('Hi,\n\nI just flashed a Proffieboard V1 using JMT Studio. Here\'s what happened:\n\n');
    window.electronAPI?.openExternal(`mailto:studio@jmtfoundry.com?subject=${subject}&body=${body}`);
  });
  document.getElementById('bm-board-flash').addEventListener('click', () => {
    const port = document.getElementById('bm-board-port-select').value;
    if (!port) return;
    const found = cachedPorts.find(p => p.path === port);
    selectedPort = port;
    selectedPortIsProffieboard = true;
    const portSelect = el('bp-port-select');
    portSelect.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = port; opt.textContent = port;
    portSelect.appendChild(opt);
    portSelect.value = port;
    setFlashEnabled(true);
    updatePortChangedIndicator();
    if (found) applyDetectedBoard(found);
    else setStatus('port', 'ok', `Proffieboard on ${port}`);
    stopPortWatch();
    document.getElementById('bm-board-select-wrap').style.display = 'none';
    doFlash();
  });
  document.getElementById('bm-dfu-setup').addEventListener('click', async () => {
    const setupBtn  = document.getElementById('bm-dfu-setup');
    const manualRow = document.getElementById('bm-manual-row');

    if (setupBtn.dataset.phase === 'copy-linux') {
      navigator.clipboard.writeText(setupBtn.dataset.command).then(() => {
        setupBtn.textContent = 'Copied!';
        setTimeout(() => { setupBtn.textContent = 'Copy Commands'; }, 2000);
      });
      return;
    }

    // Windows: single-step install. Stage our Trusted-Signing-signed WinUSB
    // package once and force-bind the board to it. No per-board download, no
    // driver-store pile. Replaces the old download-and-run-proffie-dfu-setup
    // two-phase flow.
    setupBtn.disabled    = true;
    setupBtn.textContent = 'Installing driver...';
    manualRow.style.display = 'none';
    document.getElementById('bm-close').style.display = 'none';
    document.getElementById('bm-status').textContent = 'Installing DFU driver...';
    setBarMode('knightrider');
    appendModalLog('', false);
    appendModalLog('──────────────────────────────────', false);

    const unsub  = window.electronAPI.onDfuSetupStatus(msg => appendModalLog(msg, false));
    const result = await window.electronAPI.ensureDfuDriver();
    unsub();

    setupBtn.disabled = false;

    if (result.ok) {
      appendModalLog('✓ DFU driver installed.', false);
      appendModalLog('Verifying DFU connection...', false);
      await new Promise(r => setTimeout(r, 800));
      appendModalLog('──────────────────────────────────', false);
      startDfuWaitModal(true, _dfuRetryAutoFlash, true);
    } else {
      appendModalLog('', false);
      appendModalLog(result.detail || 'Driver install was cancelled or failed.', true);
      appendModalLog('Click Install DFU Driver to try again, or use a manual option below.', false);
      setupBtn.textContent = '▶ Install DFU Driver';
      setupBtn.style.display = 'inline-block';
      manualRow.style.display = 'flex';
      document.getElementById('bm-close').style.display = 'inline-block';
    }
  });
  document.getElementById('bm-dfu-manual').addEventListener('click', () => {
    window.electronAPI.openExternal('https://pod.hubbe.net/proffieboard-setup.html#os-specific-setup');
  });
  document.getElementById('bm-zadig').addEventListener('click', () => {
    window.electronAPI.openExternal('https://zadig.akeo.ie');
  });
  document.getElementById('bm-dfu-feedback-link').addEventListener('click', e => {
    e.preventDefault();
    const subject = encodeURIComponent('JMT Studio — DFU Setup Feedback');
    const body    = encodeURIComponent('Hi,\n\nHere\'s my experience with the DFU/Bootloader mode setup in JMT Studio:\n\n');
    window.electronAPI.openExternal(`mailto:studio@jmtfoundry.com?subject=${subject}&body=${body}`);
  });
  document.getElementById('bm-abort').addEventListener('click', async () => {
    if (isDfuMode && !isBusy) return; // DFU waiting: cancel handled by startDfuWaitModal's own handler
    document.getElementById('bm-abort').disabled = true;
    document.getElementById('bm-abort').textContent = 'Aborting...';
    await window.electronAPI.abortCompile();
  });
  document.getElementById('bm-retry').addEventListener('click', () => {
    document.getElementById('build-modal').style.display = 'none';
    if (_dfuRetryRecheck) {
      _dfuRetryRecheck = false;
      startDfuWaitModal(true, _dfuRetryAutoFlash);
      return;
    }
    doFlash();
  });

  // Initial state
  setFlashEnabled(false);
  setStatus('toolchain', 'pending', 'Initializing...');

  // Initialize toolchain
  await window.electronAPI.initToolchain();

  // Initial port scan
  await refreshPorts();
}

// ── Compile ────────────────────────────────────────────
async function doCompile() {
  if (isBusy) return;
  if (!toolchainReady) {
    appendLog('Toolchain not ready.', true);
    return;
  }
  if (!selectedFqbn) {
    appendLog('No board selected. Select a board type or connect a Proffieboard to compile.', true);
    return;
  }

  const initialContent = window.getEditorContent();
  if (!initialContent || initialContent.trim() === '') {
    appendLog('Cannot compile: editor is empty.', true);
    setStatus('compile', 'error', 'No config loaded');
    return;
  }

  // SD-corruption guard (primary gate): a Mass Storage USB mode with no
  // MOUNT_SD_SETTING auto-mounts and can corrupt an inserted card. Warn here,
  // before building the risky binary; "Add define & compile" injects it and the
  // build below compiles it in. Runs before the dirty check so an added define
  // is offered for saving too. The flash path keeps its own check as a net for
  // cache-restored builds that never pass through here.
  const _sdCompile = window.checkMassStorageSafety
    ? await window.checkMassStorageSafety(selectedUsb, 'compile')
    : true;
  if (!_sdCompile) return; // Cancel from the SD guard

  // Voicepack preflight: on OS8 the prop can require a voicepack with no user
  // opt-in, and a preset that lists no shared folder announces "voice pack not
  // found" on every switch to it. Config-only check; see the block above
  // window.checkVoicepackDeclared in index.html for the traced mechanism.
  // Sits here for the same reason the SD guard does — "Add ;common" edits the
  // config, so it must run before the dirty check to be offered for saving.
  const _vpkCompile = window.checkVoicepackDeclared
    ? await window.checkVoicepackDeclared()
    : true;
  if (!_vpkCompile) return; // Cancel from the voicepack gate

  // Dirty checks — prompt the user instead of auto-saving. Config first (Save As is
  // offered since the user may want to compile a copy at a new path), then Style
  // Library if applicable (fixed path, no Save As). Cancel from either bails out.
  if (window.getIsDirty?.()) {
    const fileName = window._currentFilePath
      ? window._currentFilePath.split(/[\\/]/).pop()
      : 'this config';
    // Hide Discard for compile — discarding would build from on-disk content (the
    // un-edited version), which is almost never what the user wants. Cancel / Save
    // / Save As are the meaningful options.
    const choice = await window.promptUnsaved(
      `Unsaved changes in "${fileName}" — save before compiling?`,
      { saveAs: true, discard: false }
    );
    if (choice === 'cancel') return;
    // Cancelling the Save / Save As file picker (or a write failure) bails the
    // compile — same effect as picking Cancel on the dirty modal.
    if (choice === 'save'   && !await window.doSave())   return;
    if (choice === 'saveas' && !await window.doSaveAs()) return;
  }
  if (window._isStylesDirty?.()) {
    const choice = await window.promptUnsaved(
      'Unsaved changes in Style Library (my_styles.h) — save before compiling?',
      { discard: false }
    );
    if (choice === 'cancel') return;
    if (choice === 'save')   await window.saveStylesFile();
  }

  // Re-read content in case Save As changed the path / metadata.
  const content = window.getEditorContent();

  showBuildModal('⚙ Compiling...');
  const _recompileReason = window.consumeSdRecompileReason?.();
  startCompileHints(_recompileReason || (_sdCompile === 'compile-anyway'
    ? 'Compiling without SD card protection. I have a bad feeling about this…'
    : 'Compiling ProffieOS with your config into firmware for the board…'));
  setBusy(true);
  clearLog();
  compileSuccess = false;
  setFlashEnabled(false);
  setStatus('compile', 'pending', 'Compiling...');

  const result = await window.electronAPI.compile(content, selectedFqbn, { usb: selectedUsb });
  setBusy(false);
  if (result.ok) {
    compileSuccess = true;
    if (!isDfuMode) setFlashEnabled(!!selectedPort); // DFU mode: onBuildDone sets flash state
    updateCompileButton();
  }
}

// After an SD fix at the flash gate, the config/USB changed. Prefer a cached
// build for the corrected inputs (instant) over a full recompile; only rebuild
// on a cache miss. Either way we end at a flash.
async function _flashAfterSdFix() {
  await window.checkCacheForConfig?.();   // restores build + sets compileSuccess on a HIT
  if (compileSuccess) {
    // Cache hit: the corrected build is already restored. Turn the "recompiling…"
    // lead into a "using cached build…" message for the flash hint line, then
    // flash without rebuilding.
    const reason = window.consumeSdRecompileReason?.();
    _sdFlashLeadMsg = reason ? reason.replace('recompiling…', 'using cached build…') : null;
    doFlash();                            // routes to DFU internally; re-checks guard (now safe) + flashes
  } else {
    doCompile();                          // MISS: real build (consumes the reason for its hint), auto-flashes
  }
}

// ── Flash ──────────────────────────────────────────────
async function doFlash() {
  if (isDfuMode) { await doFlashDFU(); return; }

  // Clear any note left by a PREVIOUS attempt, so this one can only ever carry
  // its own.
  //
  // The note is set when a flash fails against a port we did not identify, and
  // consumed by the Bootloader modal - but only if that modal opens. A failure
  // that ends at "Flash Failed" instead (a touch-reset error, say) sets it and
  // never spends it, and the note then surfaces in the NEXT DFU session, which
  // may be a different port and a perfectly good board. One-shot on USE is not
  // the same as one-shot per attempt, and only the second is true here.
  // (2026-08-15)
  _dfuPortNote = null;

  if (isBusy) return;
  if (!compileSuccess) {
    appendLog('Compile first before flashing.', true);
    return;
  }

  // NOTE: do NOT add a pre-flight guard that refuses when the selected port is not a recognised
  // Proffieboard. One was tried on 2026-08-14 and removed the same hour: a board we do not
  // recognise but which DOES answer the 1200-bps touch reset - a clone, a future revision, a custom
  // build - is precisely the case ungating exists for, and a guard here refuses it before the reset
  // is ever sent. The attempt has to happen. Anything that reads as "we know this will fail"
  // belongs AFTER the attempt, where the touch reset has actually answered. (2026-08-14)

  // SD-corruption guard. Returns: 'recompile' (a fix was applied at the gate,
  // so recompile it and let the compile auto-flash), false (cancel), or
  // true/'flash-anyway' (proceed; 'flash-anyway' logs the Easter egg below).
  const _sdFlash = window.checkMassStorageSafety
    ? await window.checkMassStorageSafety(selectedUsb, 'flash')
    : true;
  if (_sdFlash === 'recompile') { _flashAfterSdFix(); return; }
  if (!_sdFlash) {
    // Cancelled — the auto-flash-after-compile path pre-sets "flashing..." and
    // hides Close, so restore a usable, closable state instead of stranding it.
    if (el('bm-status')) el('bm-status').textContent = 'Flash cancelled. Click Flash to try again.';
    if (el('bm-close'))  el('bm-close').style.display = 'inline-block';
    if (el('bm-abort'))  el('bm-abort').style.display = 'none';
    setFlashEnabled(true);
    return;
  }

  // Pre-flash port check — verify board is still present
  if (!selectedPort) {
    showWaitForBoardInModal();
    startPortWatch('wait-flash');
    return;
  }
  const rawPorts = await window.electronAPI.listPortsRaw();
  if (!rawPorts.find(p => p.path === selectedPort)) {
    // The board that was selected is gone. Swapping boards is normal - unplug one, plug
    // the next in, flash - and the app should not stall waiting for a board the user has
    // already replaced. Before giving up, ask what IS connected:
    //   exactly one Proffieboard -> unambiguous, adopt it and carry on
    //   none, or several         -> genuinely needs the user, so wait as before
    // Without this the flash never even reaches the toolchain, so the serial-matching
    // there never gets a chance to help. (2026-07-26: unplugged one board, plugged
    // the other in, clicked Flash, and came back to a "Connect Board" prompt with a board
    // sitting right there.)
    let adopted = null;
    try {
      const detected = await window.electronAPI.getRecommendedPort();
      const boards = (detected && detected.ok && detected.proffieports) || [];
      if (boards.length === 1) adopted = boards[0];
    } catch {}

    if (adopted) {
      appendModalLog(`${selectedPort} is gone — using the connected board on ${adopted.path}.`, false);
      selectedPort = adopted.path;
      selectedPortSN = adopted.serialNumber || null;
      selectedPortIsProffieboard = true;
      _flashTargetPort = selectedPort;
      _flashTargetSN   = selectedPortSN;
      // Keep the dropdown honest - it should show the board being flashed.
      try { if (portSelect) portSelect.value = adopted.path; } catch {}
      if (typeof applyDetectedBoard === 'function') { try { applyDetectedBoard(adopted); } catch {} }
      setStatus('port', 'ok', `Proffieboard on ${adopted.path}`);
    } else {
      appendModalLog('Selected port disconnected — waiting for board...', true);
      showWaitForBoardInModal();
      startPortWatch('wait-flash');
      return;
    }
  }

  // Reuse modal in flash mode — clear prior attempt's log so retries (watcher-triggered
  // or manual Retry) don't pile up. Persistent build-output panel keeps full history.
  stopCompileHints();
  stopCompileTimer();
  document.getElementById('bm-title').textContent = '⚡ Flashing...';
  document.getElementById('bm-title').style.color = 'var(--c-text-bright)';
  document.getElementById('bm-log').innerHTML = '';
  document.getElementById('bm-status').textContent = '';
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-close').style.display = 'none';
  if (_sdFlash === 'flash-anyway') {
    typeHintMessage('Flashing without SD card protection. I have a bad feeling about this…');
  } else if (_sdFlashLeadMsg) {
    typeHintMessage(_sdFlashLeadMsg);
    _sdFlashLeadMsg = null;
  }
  document.getElementById('bm-retry').style.display = 'none';
  document.getElementById('build-modal').style.display = 'flex';
  startFlashTimer();
  setBarMode('flash');
  window._isFlashing = true;
  await pauseSerialBeforeFlash();

  setBusy(true);
  setStatus('flash', 'pending', `Flashing on ${selectedPort}...`);

  // Capture target port + SN before the IPC kicks off — the touch-reset
  // inside the main process will disconnect the serial port, which races
  // refreshPorts and can null out the live selectedPort/selectedPortSN
  // before onBuildDone reads them. Frozen here so the success handler can
  // still write the right values into the file metadata.
  _flashTargetPort = selectedPort;
  _flashTargetSN   = selectedPortSN;

  // Send the serial too, not just the port. The port only drives the touch reset; without
  // the serial dfu-util matches on VID:PID alone and flashes whichever board is in the
  // bootloader. This value was already being frozen here and then left unused.
  await window.electronAPI.flash(selectedPort, selectedFqbn, _flashTargetSN);
  setBusy(false);
}

// ── Port detection ─────────────────────────────────────
function _setLinuxSerialNotice(show) {
  const notice = document.getElementById('linux-serial-notice');
  if (notice) notice.style.display = show ? 'block' : 'none';
}
function _setLinuxUdevNotice(show) {
  const notice = document.getElementById('linux-udev-notice');
  if (notice) notice.style.display = show ? 'block' : 'none';
}

async function refreshPorts() {
  if (isDfuMode) return; // port selection is locked while in DFU mode
  const seq = ++_portRefreshSeq;
  const result = await window.electronAPI.getRecommendedPort();
  // Superseded while we were enumerating. Returning without touching anything is
  // the point: the newer run owns the dropdown, and rebuilding it here would
  // discard whatever the user selected in the meantime.
  if (seq !== _portRefreshSeq) return;
  _setLinuxSerialNotice(result.linuxSerialPermissionIssue || false);
  _setLinuxUdevNotice(result.linuxUdevRulesMissing || false);

  const portSelect = el('bp-port-select');
  portSelect.innerHTML = '';

  if (!result.ok || result.ports.length === 0) {
    portSelect.innerHTML = '<option value="">No ports detected</option>';
    selectedPort = null;
    selectedPortIsProffieboard = false;
    clearDetectedBoard();
    setStatus('port', 'error', 'No device detected');
    setFlashEnabled(false);
    addDfuSentinel();
    return;
  }

  cachedPorts = result.ports;

  if (result.autoSelected && result.port) {
    // Single Proffieboard detected — auto-select it
    result.proffieports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path; opt.textContent = p.path;
      portSelect.appendChild(opt);
    });
    portSelect.value = result.port.path;
    selectedPort = result.port.path;
    selectedPortIsProffieboard = true;
    applyDetectedBoard(result.port);
    // A real board turning up outranks a manual pick of a port we never identified. That pick was
    // a this-moment choice, not a standing preference, and leaving it set means it can win again
    // later - the multi-board branch below explicitly prefers `manualPath` over everything. Drop
    // it so a genuine Proffieboard is never passed over for a port that is not one. A manual
    // choice of a REAL board is untouched. (2026-08-14)
    if (_userChosePort && _userChosenPortPath &&
        !result.proffieports.some(p => p.path === _userChosenPortPath)) {
      _userChosePort      = false;
      _userChosenPortPath = null;
    }
    // SN-based filter scoping: same board re-enumerating (e.g. post-flash) → keep;
    // different physical board auto-selected → clear. The dropdown's `change`
    // event doesn't fire for programmatic `.value =`, so we have to call this
    // explicitly here. Path-based scoping wouldn't be safe — post-flash the path
    // may change for the same board.
    _onPortChangedClearFilters();
  } else if (result.proffieports.length > 1) {
    // Multiple Proffieboards — prefer: user's manual choice > SN match > last COM path
    result.proffieports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path; opt.textContent = p.path;
      portSelect.appendChild(opt);
    });
    const lastPort  = window.getLastPort?.()    || null;
    const metaSN    = window.getMetaBoardSN?.() || null;
    const manualPath = (_userChosePort && _userChosenPortPath) ? _userChosenPortPath : null;
    const preferred =
      (manualPath ? result.proffieports.find(p => p.path       === manualPath) : null) ||
      (metaSN     ? result.proffieports.find(p => p.serialNumber === metaSN)    : null) ||
      (lastPort   ? result.proffieports.find(p => p.path       === lastPort)   : null);
    if (preferred) {
      portSelect.value = preferred.path;
      selectedPort = preferred.path;
      selectedPortIsProffieboard = true;
      applyDetectedBoard(preferred);
      _onPortChangedClearFilters(); // same rationale as the single-Proffie branch above
    } else {
      _userChosePort      = false;
      _userChosenPortPath = null;
      portSelect.value = '';
      selectedPort = null;
      selectedPortIsProffieboard = false;
      clearDetectedBoard();
      setStatus('port', 'warn', `${result.proffieports.length} Proffieboards — select port`);
    }
  } else {
    // No Proffieboard detected — show all ports for manual inspection but don't select any
    const placeholder = document.createElement('option');
    placeholder.value = ''; placeholder.textContent = '—';
    portSelect.appendChild(placeholder);
    result.ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path; opt.textContent = p.path;
      portSelect.appendChild(opt);
    });
    // Keep a manual pick if that port is still present.
    //
    // This branch runs when NO Proffieboard is detected, which is exactly when a
    // user is most likely to be choosing a port by hand - and it used to blank
    // the selection unconditionally. The multi-board branch above has honoured
    // `manualPath` all along; this one never did, so a pick made here was
    // silently discarded by the next refresh. Since flashing was ungated, an
    // unrecognised port is now a legitimate choice and has to survive.
    // (2026-08-15)
    const keep = (_userChosePort && _userChosenPortPath &&
                  result.ports.some(p => p.path === _userChosenPortPath))
                 ? _userChosenPortPath : null;
    if (keep) {
      portSelect.value = keep;
      selectedPort = keep;
      selectedPortIsProffieboard = false;
      clearDetectedBoard();
      // Detection message REMEMBERED, selection message SHOWN. The two are
      // different statements and the status line reports the one that matches
      // what is on screen: a port IS selected, so saying "No Proffieboard
      // detected" describes the machine while the dropdown says COM4 - true,
      // and about the wrong thing. Same wording onPortChange uses for a manual
      // pick of an unidentified port, so the state reads the same however it
      // was reached. The remembered one is restored when the pick is cleared.
      // (2026-08-15)
      _lastPortDetectMsg = result.message;
      setStatus('port', 'warn', `Port: ${keep}`);
    } else {
      _userChosePort      = false;
      _userChosenPortPath = null;
      portSelect.value = '';
      selectedPort = null;
      selectedPortIsProffieboard = false;
      clearDetectedBoard();
      _lastPortDetectMsg = result.message;
      setStatus('port', 'warn', result.message);
    }
  }

  updatePortChangedIndicator();
  addDfuSentinel();
  // NOTE: filter clearing is handled inside the auto-select branches above via
  // _onPortChangedClearFilters, which uses SN-based identity. Same physical
  // board re-enumerating after flash keeps filters (SN matches); a different
  // board taking over the dropdown clears them (SN differs).

  stopPortWatch();

  // Reconcile flash state with current port + compile state
  if (!compileSuccess) {
    await checkCacheForConfig();          // may set compileSuccess + call setFlashEnabled
  } else {
    // compileSuccess already true — update button to reflect new port state
    setFlashEnabled(!!selectedPort);
  }

  // Auto-open the serial monitor when refreshPorts produces a port for the first
  // time. Covers the case where the user opened the Serial Monitor tab BEFORE
  // connecting a board (or before a USB port enumerated) — without this, the tab
  // just sits at "no port selected" until they bump the dropdown. Guards:
  //   - _serialActive: user is on the serial pane right now
  //   - !_serialOpen: not already connected
  //   - selectedPort: refreshPorts found one to use
  //   - !window._isFlashing: don't grab the port mid-flash
  //   - !_serialAutoPaused: the post-flash reopen is owned by resumeSerialAfterFlash;
  //     don't race it
  if (_serialActive && !_serialOpen && selectedPort && !window._isFlashing && !_serialAutoPaused) {
    await openSerialMonitor();
    el('bp-serial-input')?.focus();
  }
}

// Adds the DFU mode sentinel as the last option in the port select
function addDfuSentinel() {
  const portSelect = el('bp-port-select');
  const existing = portSelect.querySelector('option[value="__dfu_mode__"]');
  if (existing) existing.remove();
  const opt = document.createElement('option');
  opt.value = '__dfu_mode__';
  opt.textContent = '⚡ Switch to Bootloader Mode (DFU)';
  opt.style.color = '#4af';
  portSelect.appendChild(opt);
}


// Updates the read-only toolbar board display
function updateBoardDisplay(name) {
  const disp = el('bp-board-display');
  if (disp) disp.value = name || '';
}

const USB_LABELS = {
  cdc:         'Serial',
  cdc_msc:     'Serial + Mass Storage',
  cdc_hid:     'Serial + Keyboard + Mouse',
  cdc_msc_hid: 'Serial + Mass Storage + Keyboard + Mouse',
  cdc_dap:     'Serial + CMSIS-DAP',
  cdc_msc_dap: 'Serial + Mass Storage + CMSIS-DAP',
  cdc_webusb:  'Serial + WebUSB',
  none:        'No USB',
};

function updateUsbChangedIndicator() {
  const baseline = window.getBaselineUsb ? window.getBaselineUsb() : null;
  const changed  = baseline !== null && selectedUsb !== baseline;
  // Same rule as Board and OS Version. `baseline` resets on save, so it answers
  // "matches the file on disk"; the build record answers "matches the binary".
  // This is the one where being wrong is worst: a config saved with Mass Storage
  // that was never built that way reads, to anyone helping, as a board running
  // Mass Storage - and Mass Storage without MOUNT_SD_SETTING is what corrupts
  // SD cards. (2026-08-15)
  const builtUsb   = window.getCompiledUsb ? window.getCompiledUsb() : null;
  const buildMoved = !!(builtUsb && selectedUsb && builtUsb !== selectedUsb);
  const usbEl    = el('bp-usb-select');
  usbEl.classList.toggle('field-changed', changed || buildMoved);
  usbEl.title = buildMoved
    ? `Last built with ${USB_LABELS[builtUsb] || builtUsb} — recompile before flashing`
    : changed
      ? `USB mode changed since last compile (was: ${USB_LABELS[baseline] || baseline}) — recompile before flashing`
      : '';
}

// Two things can make the port worth a second look, and they share the existing `.field-changed`
// red rather than inventing a second warning colour.
//
// Flashing is no longer gated on the port being a recognised Proffieboard, so this is what replaces
// the block: the control is live, and it says plainly that we did not find a board here. Marking is
// not refusing - the user may know better, and `flash()` resolves identity by serial number anyway.
// (2026-08-14)
function updatePortChangedIndicator() {
  const lastPort = window.getLastPort ? window.getLastPort() : null;
  const changed  = lastPort !== null && selectedPort !== null && selectedPort !== lastPort;
  const unknown  = !!selectedPort && !selectedPortIsProffieboard && !isDfuMode;
  const portEl   = el('bp-port-select');
  portEl.classList.toggle('field-changed', changed || unknown);
  // "Not a Proffieboard" wins the tooltip when both apply: whether this port is a board at all
  // matters more than whether it is the same one as last time.
  portEl.title = unknown
    ? 'No Proffieboard was detected on this port. Flashing will still try.'
    : changed
      ? `Port changed since last compile (was: ${lastPort}). Verify the correct board is connected.`
      : '';
}

// Marks the Detected field when a Proffieboard is on the selected port.
// Version (V2/V3) cannot be determined from USB data — user selects it via the Board dropdown.
function applyDetectedBoard(port) {
  if (!port) return;
  selectedPortSN = port.serialNumber || null;
  updateBoardDisplay(port.serialNumber ? `SN: ${port.serialNumber}` : 'Proffieboard');
  window.updateSnIndicator?.();
  setStatus('port', 'ok', `Proffieboard on ${port.path}`);
  updateCompileButton();
  probeBoardOSVersion(port);
  if (selectedFqbn) { cacheCheckPending = true; checkCacheForConfig(); }
}

// Clears the Detected field when no Proffieboard is on the selected port.
function clearDetectedBoard() {
  selectedPortSN = null;
  updateBoardDisplay('');
  window.updateSnIndicator?.();
  updateCompileButton();
  forgetBoardOSVersion();
}

function onPortChange(e) {
  if (e.target.value === '__dfu_mode__') {
    enterDfuMode();
    return;
  }
  selectedPort = e.target.value || null;
  _userChosePort      = !!selectedPort;
  _userChosenPortPath = selectedPort;
  const port = selectedPort ? cachedPorts.find(p => p.path === selectedPort) : null;
  selectedPortIsProffieboard = port ? port.isProffieboard : false;
  updatePortChangedIndicator();
  if (!selectedPort) {
    clearDetectedBoard();
    setFlashEnabled(false);
    // Back to what DETECTION says, not to a statement about the dropdown.
    //
    // Clearing the selection returns you to the state you opened in, and that
    // state is "no Proffieboard detected" - a fact about the machine. "No port
    // selected" is true and useless: it reports the thing the user just did,
    // and drops the only part that explains why they had to choose by hand.
    // Same rule as the rest of today - say the fact that carries information.
    // (2026-08-15)
    setStatus('port', _lastPortDetectMsg ? 'warn' : 'error',
              _lastPortDetectMsg || 'No port selected');
    return;
  }
  if (port) {
    if (port.isProffieboard) applyDetectedBoard(port);
    else { clearDetectedBoard(); setStatus('port', 'warn', `Port: ${selectedPort}`); }
  }
  setFlashEnabled(compileSuccess);
  // Different physical board → drop any suppression filters from the previous one
  _onPortChangedClearFilters();
  // If serial monitor is active, reconnect to the new port
  if (_serialActive && !window._isFlashing) {
    (async () => {
      if (_serialOpen) await closeSerialMonitor();
      if (selectedPort) openSerialMonitor();
    })();
  }
}

// Driven by the meta bar board <select> — sets selectedFqbn.
// User always selects V2/V3 manually; detection only confirms a Proffieboard is present.
function onInputBoardChange() {
  const sel    = document.getElementById('input-board');
  const opt    = sel ? sel.options[sel.selectedIndex] : null;
  const newFqbn = (opt && opt.dataset.fqbn) ? opt.dataset.fqbn : null;

  if (newFqbn === selectedFqbn) { updateCompileButton(); return; }

  if (compileSuccess) {
    compileSuccess = false;
    setFlashEnabled(false);
    setStatus('compile', 'warn', 'Board changed — recompile needed');
  }
  selectedFqbn = newFqbn;
  cacheCheckPending = true;
  updateCompileButton();
  checkCacheForConfig('Board changed — recompile needed');
}

// Changing the Proffieboard core changes the build identity exactly as a board
// or USB change does, so the compiled state must be dropped the same way.
//
// Without this the Flash button stays armed over a binary produced by a
// DIFFERENT core than the one the app now reports. The build cache itself is
// safe, because the core is part of its key, but the CURRENT session's compiled
// state is not keyed by anything - it is just a boolean. Same shape as flashing
// the wrong board, and just as invisible to the person doing it.
//
// Called from the Versions panel, and only when the change lands on the
// version currently selected for building.
window.onCoreVersionChanged = function (label) {
  const msg = label || 'Build core changed — recompile needed';
  if (compileSuccess) {
    compileSuccess = false;
    setFlashEnabled(false);
    setStatus('compile', 'warn', msg);
  }
  cacheCheckPending = true;
  updateCompileButton();
  checkCacheForConfig(msg);
  // Repaint the status bar's plugin label. It reads a cached value filled from
  // the version details, and the pin has just changed underneath it, so without
  // this the bar keeps naming the previous plugin until something else happens
  // to refresh the selected version.
  window._refreshSelectedVersionJmtState?.();
};

// ── IPC event handlers ─────────────────────────────────
// A single expanded-template compile error can be tens of thousands of chars
// wide (SingleValueAdapter<IntSVF<...>> chains plus an equally long caret
// underline). Rendering raw lines that big chokes the DOM and buries the real
// "file:line: error:" message. Cap what we render — the head always carries the
// location and the actual error text. The full output still reaches the error
// parser in the main process, so nothing diagnostic is lost.
const MAX_LOG_LINE = 1000;
function _truncateLogLine(line) {
  if (typeof line !== 'string' || line.length <= MAX_LOG_LINE) return line;
  return line.slice(0, MAX_LOG_LINE) + ` … [${line.length - MAX_LOG_LINE} more chars]`;
}

function onBuildLog({ line, isError }) {
  const shown = _truncateLogLine(line);
  appendLog(shown, isError);
  appendModalLog(shown, isError);
}

function onBuildStatus({ type, ok, needsProffieOS, message, coreVersion, running }) {
  // A background repair is fetching a plugin nothing is pinned to. The panel has
  // to know, so it does not offer to install the same one again - but Compile
  // stays available, because this plugin is not what the current build needs and
  // blocking on it would be a lie about what is in the way. (2026-08-15)
  if (type === 'plugin-heal') {
    window._backgroundPluginInstall = running ? (coreVersion || true) : null;
    // Say what this download IS. The log opens on the first real download phase,
    // so without a header the user gets several hundred megabytes of arduino-cli
    // output with nothing explaining why it started - they asked for nothing and
    // something large began. One line of framing turns that from alarming into
    // informative, and it is the same slot first-time setup already uses.
    //
    // "You can keep working" is a fact, not reassurance: this plugin is not the
    // one the current build needs, which is exactly why Compile stays enabled.
    // (2026-08-15)
    const notice = document.getElementById('bp-setup-notice');
    if (notice) {
      if (running) {
        notice.textContent = coreVersion
          ? `Proffieboard Plugin ${coreVersion} is expected but is not on this computer, so it is `
            + `being restored in the background. You can keep working - nothing is waiting on it.`
          : `A Proffieboard Plugin is expected but is not on this computer, so it is being restored `
            + `in the background. You can keep working - nothing is waiting on it.`;
        notice.style.display = '';
      } else {
        notice.style.display = 'none';
      }
    }
    try { window.vpRefresh?.(); } catch {}
    return;
  }
  if (type === 'toolchain-setup') {
    setStatus('toolchain', 'pending', 'Setting up the Proffieboard Plugin...');
    // Do NOT open the log here. This fires on the INTENT to install, and offline
    // the attempt dies within a second or two - so the panel slid open, promised
    // something was happening, and then sat empty or filled with arduino-cli's
    // DNS failures. A panel that opens for nothing is worse than one that opens
    // late.
    //
    // Opened instead on the first real phase from arduino-cli (see the
    // subscription in initBuildPanel), which is emitted only once a download is
    // genuinely under way. A failure before that point leaves the log shut and
    // the status line carrying the message, which is all there is to say.
    // (2026-08-15)
    // The log opens on the first real download phase; see initBuildPanel.
    const notice = document.getElementById('bp-setup-notice');
    // NOT "First-time setup", and NOT "this only happens once". Both were true
    // when a single plugin was hardcoded and the only way to see this banner was
    // a fresh install. Since 1.8 a plugin is chosen per ProffieOS version, so
    // this fires whenever a pinned one is absent: after picking a different
    // plugin, after one is removed by another Arduino tool, after a reset. A
    // returning user was being told it was their first time and that it would
    // not recur, twice wrong in one sentence.
    //
    // Naming the version answers the question the old copy could not: it is not
    // "setup", it is THIS version needing a plugin you do not have yet.
    // (2026-08-15)
    // A plugin install is running in the MAIN process, started by ensureCore
    // rather than by the panel. Same flag the panel's own installs use, because
    // the consequences are identical: Compile must stay blocked, the plugin
    // dropdown must stay locked, and the Install button must not offer to start
    // a second concurrent install of the plugin already arriving. Without this,
    // the panel had no idea and offered exactly that. (2026-08-15)
    _startupCoreInstall = true;
    window._coreInstallInFlight = coreVersion || true;
    updateCompileButton();
    // Repaint the versions panel now rather than waiting for the next time
    // something happens to render it. It may already have drawn "not installed,
    // Install X" a moment before this signal arrived, and that stale offer would
    // then stand for the whole download. (2026-08-15)
    try { window.vpRefresh?.(); } catch {}
    if (notice) {
      notice.textContent = coreVersion
        ? `Downloading and installing Proffieboard Plugin ${coreVersion}. This can take several `
          + `minutes on a slower connection. Compile and flash will be available when it finishes.`
        : `Downloading and installing the Proffieboard Plugin. This can take several minutes on a `
          + `slower connection. Compile and flash will be available when it finishes.`;
    }
    if (notice) notice.style.display = '';
    // Hide port/compile/flash during setup — the user has nothing to act on
    // there until the toolchain is ready, and showing them muddies the
    // "we're working on it" signal that the banner is trying to convey.
    ['port', 'compile', 'flash'].forEach(t => {
      const item = document.getElementById(`bp-status-${t}-item`);
      if (item) item.style.display = 'none';
    });
  } else if (type === 'toolchain') {
    toolchainReady = ok && !needsProffieOS;
    // Three-state status: toolchain failed → error/red; toolchain installed
    // but no ProffieOS → error/red with next-action text; both ready → green.
    // No-ProffieOS uses red+hidden-secondaries (single dominant signal, no
    // gated indicators competing for attention) — cleaner than yellow + visible
    // indicators when there's only one action the user can take.
    const state = !ok || needsProffieOS ? 'error' : 'ok';
    // Remembered so a plugin install can borrow this indicator and hand it back unchanged.
    _lastToolchainStatus = { state, message };
    // The main-process install has finished, one way or the other. Release the
    // lock and re-render the versions panel: it drew "not installed" while that
    // was true, and nothing else would ever correct it - the plugin arrived
    // without the panel being told, so it went on offering to install something
    // already on disk. (2026-08-15)
    if (_startupCoreInstall) {
      _startupCoreInstall = false;
      window._coreInstallInFlight = null;
      updateCompileButton();
      try { window.vpRefresh?.(); } catch {}
    }
    setStatus('toolchain', state, message);
    const notice = document.getElementById('bp-setup-notice');
    if (notice) notice.style.display = 'none';
    // Show port/compile/flash only when compile is actually reachable. Hide
    // during both hard-failure and no-ProffieOS states — they're noise when
    // the user can't act on them.
    const showSecondary = ok && !needsProffieOS;
    ['port', 'compile', 'flash'].forEach(t => {
      const item = document.getElementById(`bp-status-${t}-item`);
      if (item) item.style.display = showSecondary ? '' : 'none';
    });
    // The status has already narrowed this to a single possible action, so offer
    // it instead of describing it. The row is otherwise empty here for exactly
    // that reason — the other three indicators just got hidden.
    const getBtn = document.getElementById('bp-btn-get-proffieos');
    if (getBtn) getBtn.style.display = (ok && needsProffieOS) ? '' : 'none';
  } else if (type === 'compile') {
    if (ok === null) {
      setStatus('compile', 'pending', message);
    } else {
      setStatus('compile', ok ? 'ok' : 'error', ok ? 'Compile successful' : 'Compile error');
      if (!ok) openLog();
    }
  } else if (type === 'flash') {
    if (ok === null) {
      setStatus('flash', 'pending', message);
    } else {
      setStatus('flash', ok ? 'ok' : 'error', ok ? 'Flash successful' : 'Flash error');
      if (!ok) openLog();
    }
  }
}

function onBuildDone({ type, ok, error, aborted, retriable, needsDfuDriver, sourceChanged, coreVersion, osVersion, compiledFqbn, compiledUsb }) {
  if (type === 'compile') {
    if (ok) {
      compileSuccess = true;
      updateCompileButton();
      const durationSec = _compileStartTime ? Math.round((Date.now() - _compileStartTime) / 1000) : null;
      if (window.setCompiledTimestamp) window.setCompiledTimestamp(undefined, durationSec, coreVersion, osVersion, compiledFqbn, compiledUsb);
      stopCompileTimer();
      stopCompileHints();
      appendLog('\n✓ Firmware ready.', false);

      if (isDfuMode) {
        // DFU mode — don't watch serial ports
        document.getElementById('bm-title').textContent = '✓ Compile Successful';
        document.getElementById('bm-title').style.color = 'var(--c-success-text)';
        document.getElementById('bm-abort').style.display = 'none';
        setBarMode('success');
        if (dfuDeviceReady) {
          document.getElementById('bm-close').style.display = 'none';
          document.getElementById('bm-status').textContent = 'DFU device ready. Flashing...';
          setFlashEnabled(true);
          setTimeout(() => doFlash(), 1200);
        } else {
          // Auto-proceed to DFU detection/driver flow — don't make them close and restart
          document.getElementById('bm-status').textContent = 'Checking for DFU device...';
          setTimeout(() => startDfuWaitModal(), 1200);
        }
      } else if (selectedPortIsProffieboard && selectedPort) {
        // Board already connected — show success then flash immediately
        document.getElementById('bm-title').textContent = '✓ Compile Successful';
        document.getElementById('bm-title').style.color = 'var(--c-success-text)';
        document.getElementById('bm-abort').style.display = 'none';
        document.getElementById('bm-close').style.display = 'none';
        document.getElementById('bm-status').textContent = 'Board connected. Flashing...';
        setBarMode('success');
        setFlashEnabled(true);
        setTimeout(() => doFlash(), 1200);
      } else {
        // No board — show wait UI and start watcher
        setFlashEnabled(false);
        document.getElementById('bm-title').textContent = '✓ Compile Successful';
        document.getElementById('bm-title').style.color = 'var(--c-success-text)';
        document.getElementById('bm-abort').style.display = 'none';
        document.getElementById('bm-close').style.display = 'inline-block';
        document.getElementById('bm-status').textContent = 'Connect your Proffieboard to flash...';
        setBarMode('success');
        startPortWatch('wait-flash');
      }
    } else if (aborted) {
      compileSuccess = false;
      setFlashEnabled(false);
      finishBuildModal(false, '⊘ Compile Aborted', 'Compile was stopped.');
    } else {
      compileSuccess = false;
      setFlashEnabled(false);
      finishBuildModal(false, '✗ Compile Failed', error);
      if (error) appendLog(`\n⚠ ${error}`, true);
    }
  }
  if (type === 'flash') {
    window._isFlashing = false;
    stopFlashTimer();
    resumeSerialAfterFlash();
    // Whatever we knew about the board's ProffieOS is now about the firmware we
    // just replaced. Drop it so the re-enumerated board is asked again.
    forgetBoardOSVersion();
    if (!ok) {
      // A flash can only fail this way against a port the user picked, so when that port was never
      // identified as a Proffieboard, say so once here - AFTER the attempt, never before it. It is
      // a note, not a verdict: an unrecognised board that simply did not answer the touch reset
      // lands in exactly this branch, and for that user the bootloader instructions below are
      // correct. Hence "may not be", and hence gating it strictly on the port having been
      // unidentified, so a real board's failure keeps its own message untouched. (2026-08-14)
      if (!isDfuMode && selectedPort && !selectedPortIsProffieboard) {
        const note = `${selectedPort} was not identified as a Proffieboard, so it may not be the `
                   + `right port.`;
        appendLog(`\nNote: ${note}`, true);
        // The Bootloader Mode modal clears bm-log when it opens, so a line written here would be
        // wiped before it is ever seen. Hand it to the modal instead - that is the surface the user
        // is actually looking at when this happens.
        _dfuPortNote = note;
      }
      // Auto-recovery: touch reset succeeded and the board IS in DFU, but the WinUSB
      // driver isn't bound on this USB instance. Switch to DFU mode and run the driver
      // install flow with autoFlash=true so the flash continues once the driver lands.
      if (needsDfuDriver) {
        if (error) appendLog(`\n⚠ ${error}`, true);
        _setupDfuModeUI();
        startDfuWaitModal(true, true, false);
        return;
      }
      // Source-hash sanity check tripped — the cached/last build no longer matches the
      // current OS source. Roll back compileSuccess so the Compile button re-enables
      // and the user can recompile against the new source state.
      if (sourceChanged) {
        compileSuccess = false;
        setFlashEnabled(false);
        setStatus('compile', 'warn', 'OS source changed — recompile needed');
        updateCompileButton();
      }
      _flashTargetPort = null;
      _flashTargetSN   = null;
      finishBuildModal(false, '✗ Flash Failed', error, { retriable: !!retriable });
      if (error) appendLog(`\n⚠ ${error}`, true);
      return;
    }
    if (isDfuMode) {
      // Post-DFU flash: lastFlashedSN + setFlashedTimestamp set in watchForSerialAfterDfu once real port is known
      document.getElementById('bm-title').textContent = '✓ Flash Complete';
      document.getElementById('bm-title').style.color = 'var(--c-success-text)';
      document.getElementById('bm-abort').style.display = 'none';
      document.getElementById('bm-close').style.display = 'inline-block';
      // Reset close label — the DFU driver-fix flow renames it to "Cancel" because
      // there IS something cancellable mid-install. Once we've reached "✓ Flash
      // Complete" the button just dismisses the modal, and "Cancel" reads wrong.
      // This path was missed by TC-1140's original fix in finishBuildModal because
      // the DFU success path doesn't call finishBuildModal.
      document.getElementById('bm-close').textContent = 'Close';
      document.getElementById('bm-status').textContent = 'Watching for board restart...';
      setBarMode('success');
      appendModalLog('Flash complete. Waiting for board to restart...', false);
      watchForSerialAfterDfu();
    } else {
      // Prefer the frozen target captured at doFlash entry — selectedPort/SN
      // may have been cleared by mid-flash port detection. Fall back to live
      // values for paths that didn't go through doFlash (auto-flash after
      // compile, watcher-triggered flash) where the target wasn't frozen.
      // Never record an UNIDENTIFIED port as this config's last-flashed port. `_flashTargetPort` is
      // the board the resolver actually settled on, so it is always trustworthy; the fallback is
      // live state, and since flashing is no longer gated on the port being a recognised
      // Proffieboard that fallback can now be something like COM3. Persisting it means the config
      // reopens pointed at a port no board will ever appear on, and the next flash sits waiting for
      // a connection that cannot happen. Better to record nothing than a wrong port. (2026-08-14)
      const flashedPort = _flashTargetPort || (selectedPortIsProffieboard ? selectedPort : null);
      const flashedSN   = _flashTargetSN   || selectedPortSN;
      lastFlashedSN = flashedSN;
      if (window.setFlashedTimestamp) window.setFlashedTimestamp(flashedPort, flashedSN);
      _flashTargetPort = null;
      _flashTargetSN   = null;
      updatePortChangedIndicator();
      finishBuildModal(true, '✓ Flash Complete', 'Firmware flashed successfully.', { isFlash: true });
    }
  }
}

// ── Build modal ────────────────────────────────────────
function showBuildModal(title) {
  stopCompileHints();
  const modal = document.getElementById('build-modal');
  modal.style.display = 'flex';
  document.getElementById('bm-title').textContent = title;
  document.getElementById('bm-title').style.color = 'var(--c-text-bright)';
  document.getElementById('bm-log').innerHTML = '';
  document.getElementById('bm-status').textContent = '';
  document.getElementById('bm-close').style.display = 'none';
  document.getElementById('bm-retry').style.display = 'none';
  document.getElementById('bm-retry').textContent = '↺ Retry Flash';
  const _dfuSetupBtn = document.getElementById('bm-dfu-setup');
  _dfuSetupBtn.style.display = 'none';
  _dfuSetupBtn.textContent = '▶ Install DFU Driver';
  delete _dfuSetupBtn.dataset.phase;
  document.getElementById('bm-manual-row').style.display = 'none';
  document.getElementById('bm-dfu-note').style.display = 'none';
  document.getElementById('bm-board-select-wrap').style.display = 'none';
  const abortBtn = document.getElementById('bm-abort');
  abortBtn.style.display = 'inline-block';
  abortBtn.disabled = false;
  abortBtn.textContent = '⊘ Abort';
  // Reset both timers
  document.getElementById('bm-timer-compile').style.display = 'none';
  document.getElementById('bm-timer-flash').style.display = 'none';
  setBarMode('knightrider');
  startCompileTimer();
}

function setBarMode(mode) {
  const bar = document.getElementById('bm-bar');
  bar.className = '';
  bar.style.width     = '';
  bar.style.left      = '0';
  bar.style.animation = '';
  bar.style.background = '';
  if (mode === 'knightrider') bar.classList.add('bm-bar-knightrider');
  else if (mode === 'flash') {
    bar.style.position = 'absolute';
    bar.style.left     = '0';
    bar.style.width    = '0%';
    bar.style.background = getComputedStyle(document.documentElement).getPropertyValue('--jmt-blue').trim();
  }
  else if (mode === 'success') { bar.classList.add('bm-bar-success'); bar.style.left = '0'; }
  else if (mode === 'error')   { bar.classList.add('bm-bar-error');   bar.style.left = '0'; }
}

// ── Port watcher ───────────────────────────────────────
// Polls SerialPort.list() cheaply every 1s; on change fires getRecommendedPort().
// Only used for 'wait-flash' context (active flash operation waiting for board).
// Passive board detection is handled by the background poller in main.js.

let _portWatchInterval = null;
let _portWatchContext  = null;
let _lastRawPortKey    = null;

function startPortWatch(context) {
  _portWatchContext = context;
  if (_portWatchInterval) return; // already running, context updated above
  _lastRawPortKey = null;

  _portWatchInterval = setInterval(async () => {
    try {
      const raw = await window.electronAPI.listPortsRaw();
      const key = raw.map(p => p.path).sort().join(',');
      if (key === _lastRawPortKey) return;
      _lastRawPortKey = key;
      const result = await window.electronAPI.getRecommendedPort();
      handlePortWatchResult(result);
    } catch {}
  }, 1000);
}

function stopPortWatch() {
  if (_portWatchInterval) {
    clearInterval(_portWatchInterval);
    _portWatchInterval = null;
  }
  _lastRawPortKey   = null;
  _portWatchContext = null;
}

async function handlePortWatchResult(result) {
  const proffieports = result.ok ? (result.proffieports || []) : [];

  if (_portWatchContext === 'wait-flash') {
    if (proffieports.length === 0) return; // still waiting

    if (proffieports.length === 1 || result.autoSelected) {
      const port = result.port || proffieports[0];
      stopPortWatch();
      _selectPortAndFlash(port, result);
    } else {
      // Multiple boards — show selector; prefer metaPort if stored
      showMultiBoardSelect(proffieports);
    }
  }
}

function _selectPortAndFlash(port, result) {
  selectedPort = port.path;
  selectedPortIsProffieboard = true;
  if (result.ports) cachedPorts = result.ports;

  const portSelect = el('bp-port-select');
  portSelect.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = port.path; opt.textContent = port.path;
  portSelect.appendChild(opt);
  addDfuSentinel();
  portSelect.value = port.path;
  setFlashEnabled(true);
  updatePortChangedIndicator();
  applyDetectedBoard(port);
  document.getElementById('bm-board-select-wrap').style.display = 'none';
  document.getElementById('bm-status').textContent = 'Board detected. Flashing...';
  setTimeout(() => doFlash(), 1200);
}

function showWaitForBoardInModal() {
  document.getElementById('build-modal').style.display = 'flex';
  document.getElementById('bm-title').textContent = '⚡ Connect Board';
  document.getElementById('bm-title').style.color = 'var(--c-text-bright)';
  document.getElementById('bm-status').textContent = 'Connect your Proffieboard to continue...';
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-retry').style.display = 'none';
  document.getElementById('bm-close').style.display = 'inline-block';
  document.getElementById('bm-board-select-wrap').style.display = 'none';
  setBarMode('knightrider');
}

function showMultiBoardSelect(proffieports) {
  const sel = document.getElementById('bm-board-port-select');
  const currentVal = sel.value;
  sel.innerHTML = '';

  // Prefer port stored in file metadata
  const preferred = window.getLastPort ? window.getLastPort() : null;
  const sorted = preferred
    ? [proffieports.find(p => p.path === preferred), ...proffieports.filter(p => p.path !== preferred)].filter(Boolean)
    : proffieports;

  sorted.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.path; opt.textContent = p.path;
    sel.appendChild(opt);
  });
  if (currentVal) sel.value = currentVal; // preserve selection if already shown

  document.getElementById('bm-status').textContent = 'Multiple Proffieboards detected. Select one:';
  document.getElementById('bm-board-select-wrap').style.display = 'flex';
}

/**
 * Render a terminal status: first line emphasised, the rest muted beneath it.
 *
 * Every summary already arrives as "what happened\nwhat to do", so the split is
 * structural and needs no knowledge of the message - it improves all of them,
 * not just the ones we thought about.
 *
 * Built with textContent per node rather than innerHTML ON PURPOSE. This string
 * carries compiler output and user file paths; a config named with a `<` would
 * either break the markup or inject it. Formatting comes from structure, never
 * from markup embedded in the message. (2026-08-15)
 */
function _setStatusTiered(elm, msg) {
  if (!elm) return;
  elm.textContent = '';
  if (!msg) return;
  const [lead, ...rest] = String(msg).split('\n');
  const leadEl = document.createElement('span');
  leadEl.className = 'bm-status-lead';
  leadEl.textContent = lead;
  elm.appendChild(leadEl);
  // A BLANK LINE in the message means "separate what follows". It becomes a
  // margin on the next line rather than an empty row: the message says where the
  // break belongs, the display decides what it costs - and a margin is tunable
  // where a blank line is a whole line-height in a modal that is already tall.
  // Messages with no blank line render exactly as before. (2026-08-15)
  let gapPending = false;
  for (const line of rest) {
    if (!line.trim()) { gapPending = true; continue; }
    const detailEl = document.createElement('span');
    detailEl.className = 'bm-status-detail' + (gapPending ? ' bm-status-gap' : '');
    detailEl.textContent = line;
    elm.appendChild(detailEl);
    gapPending = false;
  }
}

function finishBuildModal(success, title, statusMsg, { retriable = false, isFlash = false } = {}) {
  stopCompileHints();
  stopPortWatch();
  stopCompileTimer();
  stopFlashTimer();
  document.getElementById('bm-title').textContent = title;
  document.getElementById('bm-title').style.color = success ? 'var(--c-success-text)' : 'var(--c-danger-text)';
  _setStatusTiered(document.getElementById('bm-status'), statusMsg || '');
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-dfu-setup').style.display = 'none';
  document.getElementById('bm-manual-row').style.display = 'none';
  document.getElementById('bm-retry').style.display = retriable ? 'inline-block' : 'none';
  const _closeBtn = document.getElementById('bm-close');
  _closeBtn.style.display = 'inline-block';
  // Reset the close-button label. Mid-flow paths (e.g. the DFU driver-fix screen)
  // rename it to "Cancel" because there IS something cancellable in that context.
  // Once the flow reaches a terminal state — success or failure — the button just
  // dismisses the modal, and "Cancel" reads wrong (e.g. after "✓ Flash Complete").
  _closeBtn.textContent = 'Close';
  const isV1 = selectedFqbn && selectedFqbn.includes('Proffieboard-L433CC') && !selectedFqbn.includes('V2');
  document.getElementById('bm-v1-feedback').style.display = (success && isFlash && isV1) ? 'block' : 'none';
  setBarMode(success ? 'success' : 'error');
}

function appendModalLog(line, isError) {
  const log  = document.getElementById('bm-log');
  const span = document.createElement('span');
  span.textContent = line + '\n';
  if (isError) span.style.color = '#e66';
  else if (line.startsWith('---') || line.startsWith('✓')) span.style.color = '#4af';
  log.appendChild(span);
  log.scrollTop = log.scrollHeight;
}

// ── Log panel ──────────────────────────────────────────
function appendLog(line, isError) {
  const panel = el('bp-log-content');
  const span  = document.createElement('span');
  span.textContent = line + '\n';
  if (isError) span.classList.add('log-error');
  else if (line.startsWith('---') || line.startsWith('✓')) span.classList.add('log-highlight');
  panel.appendChild(span);
  panel.scrollTop = panel.scrollHeight;
}

function clearLog() {
  el('bp-log-content').innerHTML = '';
}

function _setLogChevron(open) {
  const tog = el('bp-log-toggle');
  if (tog) tog.textContent = open ? '▲' : '▼';
}

function openLog() {
  el('bp-log-body').classList.add('open');
  _setLogChevron(true);
  _syncSerialPauseToCollapse(true);
}

function closeLog() {
  el('bp-log-body').classList.remove('open');
  _setLogChevron(false);
  _syncSerialPauseToCollapse(false);
}

function toggleLog() {
  const open = el('bp-log-body').classList.toggle('open');
  _setLogChevron(open);
  _syncSerialPauseToCollapse(open);
}

// ── Serial Monitor ─────────────────────────────────────
let _serialActive   = false;   // serial tab is the active pane
let _serialOpen     = false;   // port is currently open
let _serialPaused   = false;   // user pressed pause — incoming data buffered, not shown
let _serialPending  = '';      // partial trailing line (no \n yet)
let _serialPausedBuf = '';     // data captured while paused — flushed on resume
let _serialAutoPaused = false; // auto-paused during flash; resume after
let _serialAutoScroll = true;  // snap-to-bottom on new lines; flips off when user scrolls up
let _serialPendingNewLines = 0; // lines arrived while scrolled up; surfaced via the jump pill
let _serialUnsubData   = null;
let _serialUnsubClosed = null;
let _suppressionRules  = [];   // [{ type: 'prefix'|'exact'|'contains', text: '...' }]
let _serialPortForFilters    = null; // port path the current rule set was scoped to
let _serialBoardSNForFilters = null; // board SN the current rule set was scoped to —
                                     // SN survives flash re-enumeration even when
                                     // the COM path changes, so it's the reliable
                                     // "same physical board?" check.
let _suppressPopoverEl = null;
let _serialCtxMenuEl   = null;
const SERIAL_MAX_LINES = 1000;

// TEMP: collapse-pause verification — flip to false (or grep-remove all
// SERIAL_DEBUG references) once the behavior is verified.
const SERIAL_DEBUG = true;
let _serialRxBytes = 0;
function _debugSerial(event, extra) {
  if (!SERIAL_DEBUG) return;
  const tab      = _serialActive ? 'serial' : 'build';
  const bodyOpen = el('bp-log-body')?.classList.contains('open') ? 'open' : 'collapsed';
  console.log(
    `[serial-debug] ${event}${extra ? ' ' + extra : ''} | `
    + `tab=${tab} body=${bodyOpen} paused=${_serialPaused} `
    + `bufBytes=${_serialPausedBuf.length} rxTotal=${_serialRxBytes}`
  );
}

function _matchesAnyRule(lineText) {
  for (const r of _suppressionRules) {
    if (!r || !r.text) continue;
    if (r.type === 'exact'    && lineText === r.text)         return true;
    if (r.type === 'prefix'   && lineText.startsWith(r.text)) return true;
    if (r.type === 'contains' && lineText.includes(r.text))   return true;
  }
  return false;
}

// Persistent in-log hint. Appended at the head of the first connection's output
// so the user has a discoverable reminder about right-click → suppress even when
// the board fires welcome text the instant the port opens (ProffieOS does this).
// Styled with a JMT-blue left border to distinguish from real serial data.
//
// Gate: only emit when the log is empty. Without this, every open/close cycle
// (tab switch, flash reconnect) would prepend another hint to existing data and
// pile up. The empty-log check means: first session open shows the hint; after
// any data has arrived, subsequent reconnects don't re-emit. Cleared logs are
// also "empty" so a fresh hint reappears after a manual clear.
function _serialAppendHint(text) {
  const log = el('bp-serial-log');
  if (!log) return;
  if (log.children.length > 0) return;
  const div = document.createElement('div');
  div.className = 'serial-line serial-hint';
  div.textContent = text;
  log.appendChild(div);
  if (_serialAutoScroll) log.scrollTop = log.scrollHeight;
}

function _serialAppendLine(lineText) {
  const log = el('bp-serial-log');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'serial-line';
  div.textContent = lineText;
  if (_matchesAnyRule(lineText)) div.classList.add('suppressed');
  log.appendChild(div);
  while (log.children.length > SERIAL_MAX_LINES) log.removeChild(log.firstChild);
  // Only snap-to-bottom while the user is following the live tail. When they
  // scroll up to read history, _serialAutoScroll is false and new lines stay
  // off-screen — Arduino IDE pet peeve fix. Bump the jump-pill counter so the
  // user knows new data has arrived and can click to catch up.
  if (_serialAutoScroll) {
    log.scrollTop = log.scrollHeight;
  } else {
    _serialPendingNewLines++;
    _updateJumpPill();
  }
}

// Jump-pill control. Visible only while the user is scrolled up AND lines have
// arrived since they scrolled away. Hidden whenever they return to the tail
// (by clicking the pill, scrolling manually, sending a command, or clearing).
function _updateJumpPill() {
  const pill = el('bp-serial-jump-pill');
  if (!pill) return;
  if (_serialPendingNewLines > 0 && !_serialAutoScroll) {
    const count = el('bp-serial-jump-count');
    if (count) count.textContent = _serialPendingNewLines > 99 ? '99+' : String(_serialPendingNewLines);
    pill.classList.add('visible');
  } else {
    pill.classList.remove('visible');
  }
}

function _jumpToBottom() {
  const log = el('bp-serial-log');
  if (!log) return;
  _serialAutoScroll = true;
  _serialPendingNewLines = 0;
  log.scrollTop = log.scrollHeight;
  _updateJumpPill();
}

function _serialAppend(text) {
  if (!text) return;
  const cleaned = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const combined = _serialPending + cleaned;
  const lines = combined.split('\n');
  _serialPending = lines.pop(); // last item is incomplete (or '' if chunk ended in \n)
  for (const line of lines) _serialAppendLine(line);
}

function _serialFlushPending() {
  if (_serialPending) {
    _serialAppendLine(_serialPending);
    _serialPending = '';
  }
}

function _serialReapplySuppression() {
  const log = el('bp-serial-log');
  if (!log) return;
  for (const div of log.children) {
    if (_matchesAnyRule(div.textContent)) div.classList.add('suppressed');
    else div.classList.remove('suppressed');
  }
}

// Filters are session-scoped — intentionally NOT persisted across launches.

function _addSuppressionRule(rule) {
  if (!rule || !rule.text || !rule.type) return;
  if (_suppressionRules.some(r => r.type === rule.type && r.text === rule.text)) return;
  _suppressionRules.push(rule);
  _serialPortForFilters = selectedPort;
  _updateFilterBadge();
  _serialReapplySuppression();
  if (_suppressPopoverEl) _buildSuppressPopoverContent();
}

function _removeSuppressionRule(index) {
  _suppressionRules.splice(index, 1);
  _updateFilterBadge();
  _serialReapplySuppression();
  if (_suppressPopoverEl) _buildSuppressPopoverContent();
}

function _clearAllSuppression() {
  if (_suppressionRules.length === 0) return;
  _suppressionRules = [];
  _updateFilterBadge();
  _serialReapplySuppression();
  _dismissSuppressPopover();
}

function _onPortChangedClearFilters() {
  // Identity check: prefer board SN over COM path because SN survives flash
  // re-enumeration (same physical board, possibly new path → keep filters), while
  // a different board's SN never matches (physical swap → clear filters). Fall
  // back to path comparison only when SN isn't available on both sides (e.g.
  // non-Proffie USB serial devices that don't expose a serial number).
  const currentPort = selectedPort ? cachedPorts.find(p => p.path === selectedPort) : null;
  const currentSN   = currentPort?.serialNumber || null;
  const isDifferent = (_serialBoardSNForFilters && currentSN)
    ? currentSN !== _serialBoardSNForFilters
    : selectedPort !== _serialPortForFilters;

  if (_suppressionRules.length > 0 && isDifferent) {
    _suppressionRules = [];
    _updateFilterBadge();
    _serialReapplySuppression();
    _dismissSuppressPopover();
  }
  _serialPortForFilters    = selectedPort;
  _serialBoardSNForFilters = currentSN;
}

function _updateFilterBadge() {
  const root  = el('build-log');
  const count = el('bp-serial-filters-count');
  if (!root || !count) return;
  const n = _suppressionRules.length;
  count.textContent = n;
  // Class-based visibility — the CSS hides these on the build-output tab regardless.
  root.classList.toggle('has-filters',      n > 0);
  root.classList.toggle('has-many-filters', n > 1);
}

// ── Right-click context menu on serial log lines ──────
function _dismissSerialContextMenu() {
  if (_serialCtxMenuEl) { _serialCtxMenuEl.remove(); _serialCtxMenuEl = null; }
  document.removeEventListener('mousedown', _dismissSerialContextMenuOnOutside, true);
}
function _dismissSerialContextMenuOnOutside(e) {
  if (_serialCtxMenuEl && !_serialCtxMenuEl.contains(e.target)) _dismissSerialContextMenu();
}

function _buildSuppressOptionsForLine(lineText) {
  const opts = [];
  const labelMatch = lineText.match(/^([A-Za-z][\w ]*?:)/);
  if (labelMatch) {
    const lbl = labelMatch[1];
    opts.push({
      label: `Suppress lines starting with "${lbl}"`,
      rule: { type: 'prefix', text: lbl }
    });
  } else {
    const truncated = lineText.slice(0, 24);
    if (truncated) {
      opts.push({
        label: `Suppress lines starting with "${truncated}${lineText.length > 24 ? '…' : ''}"`,
        rule: { type: 'prefix', text: truncated }
      });
    }
  }
  const exactPreview = lineText.length > 60 ? lineText.slice(0, 56) + '…' : lineText;
  opts.push({
    label: `Suppress exact: "${exactPreview}"`,
    rule: { type: 'exact', text: lineText }
  });
  return opts;
}

function _showSerialContextMenu(x, y, lineText) {
  _dismissSerialContextMenu();
  if (!lineText) return;
  const menu = document.createElement('div');
  menu.className = 'serial-ctx-menu';
  const options = _buildSuppressOptionsForLine(lineText);
  for (const opt of options) {
    const item = document.createElement('div');
    item.className = 'serial-ctx-item';
    item.textContent = opt.label;
    item.title = opt.label;
    item.addEventListener('click', () => {
      _addSuppressionRule(opt.rule);
      _dismissSerialContextMenu();
    });
    menu.appendChild(item);
  }
  // Always show "Manage filters" entry when there's at least one rule
  if (_suppressionRules.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'serial-ctx-sep';
    menu.appendChild(sep);
    const manage = document.createElement('div');
    manage.className = 'serial-ctx-item';
    manage.textContent = `Manage filters (${_suppressionRules.length})…`;
    manage.addEventListener('click', () => {
      _dismissSerialContextMenu();
      _toggleSuppressPopover(true);
    });
    menu.appendChild(manage);
  }
  document.body.appendChild(menu);
  _serialCtxMenuEl = menu;
  // Clamp inside viewport
  const r = menu.getBoundingClientRect();
  if (x + r.width  > window.innerWidth)  x = Math.max(4, window.innerWidth  - r.width  - 4);
  if (y + r.height > window.innerHeight) y = Math.max(4, window.innerHeight - r.height - 4);
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  setTimeout(() => document.addEventListener('mousedown', _dismissSerialContextMenuOnOutside, true), 0);
}

// ── Filter management popover ─────────────────────────
function _dismissSuppressPopover() {
  if (_suppressPopoverEl) { _suppressPopoverEl.remove(); _suppressPopoverEl = null; }
  document.removeEventListener('mousedown', _dismissSuppressPopoverOnOutside, true);
}
function _dismissSuppressPopoverOnOutside(e) {
  if (!_suppressPopoverEl) return;
  const badge = el('bp-serial-filters');
  if (_suppressPopoverEl.contains(e.target)) return;
  if (badge && badge.contains(e.target)) return;
  _dismissSuppressPopover();
}

function _buildSuppressPopoverContent() {
  if (!_suppressPopoverEl) return;
  _suppressPopoverEl.innerHTML = '';
  if (_suppressionRules.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'serial-suppress-empty';
    empty.textContent = 'No active filters';
    _suppressPopoverEl.appendChild(empty);
    return;
  }
  _suppressionRules.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'serial-suppress-row';
    const typeSpan = document.createElement('span');
    typeSpan.className = 'serial-suppress-type';
    typeSpan.textContent = r.type === 'prefix' ? 'starts with' : r.type === 'exact' ? 'exact' : r.type;
    const textSpan = document.createElement('span');
    textSpan.className = 'serial-suppress-text';
    textSpan.textContent = r.text;
    textSpan.title = r.text;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'serial-suppress-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove this filter';
    removeBtn.addEventListener('click', e => { e.stopPropagation(); _removeSuppressionRule(i); });
    row.appendChild(typeSpan);
    row.appendChild(textSpan);
    row.appendChild(removeBtn);
    _suppressPopoverEl.appendChild(row);
  });
}

function _toggleSuppressPopover(forceOpen) {
  if (_suppressPopoverEl && !forceOpen) { _dismissSuppressPopover(); return; }
  if (_suppressPopoverEl) _dismissSuppressPopover();
  const pop = document.createElement('div');
  pop.className = 'serial-suppress-popover';
  document.body.appendChild(pop);
  _suppressPopoverEl = pop;
  _buildSuppressPopoverContent();
  // Anchor above the badge
  const badge = el('bp-serial-filters');
  const rect = badge ? badge.getBoundingClientRect() : null;
  const r = pop.getBoundingClientRect();
  let left = rect ? rect.left : 100;
  let top  = rect ? rect.top - r.height - 4 : 100;
  if (top < 4) top = rect ? rect.bottom + 4 : 100;
  if (left + r.width > window.innerWidth) left = Math.max(4, window.innerWidth - r.width - 4);
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;
  setTimeout(() => document.addEventListener('mousedown', _dismissSuppressPopoverOnOutside, true), 0);
}

function _serialSetStatus(text, connected) {
  const s = el('bp-serial-status');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('connected', !!connected);
  const send  = el('bp-serial-send');
  const input = el('bp-serial-input');
  if (send)  send.disabled  = !connected;
  if (input) input.disabled = !connected;
}

async function openSerialMonitor() {
  if (_serialOpen) return;
  if (!selectedPort) {
    _serialSetStatus('no port selected', false);
    _updateSerialPauseButton();
    return;
  }
  _serialSetStatus(`connecting ${selectedPort}...`, false);
  const res = await window.electronAPI.openSerial(selectedPort, 115200);
  if (!res || !res.ok) {
    _serialSetStatus(`error: ${res?.error || 'failed to open'}`, false);
    _updateSerialPauseButton();
    return;
  }
  _serialOpen = true;
  _serialSetStatus(`${selectedPort} @ 115200`, true);
  _updateSerialPauseButton();
  // Drop a persistent hint at the head of the connection's output so the user
  // sees the right-click→suppress affordance even when the board fires welcome
  // text the instant the port opens (ProffieOS does this).
  _serialAppendHint('💡 Right-click any line to suppress similar lines. Active filters appear in the toolbar above.');
  if (!_serialUnsubData) {
    _serialUnsubData = window.electronAPI.onSerialData(({ text }) => {
      _serialRxBytes += text.length;
      if (_serialPaused) {
        _serialPausedBuf += text;
        if (_serialPausedBuf.length > 200000) {
          _serialPausedBuf = _serialPausedBuf.slice(-150000);
        }
        _debugSerial('rx', `+${text.length}B → buffer`);
        return;
      }
      _debugSerial('rx', `+${text.length}B → display`);
      _serialAppend(text);
    });
  }
  if (!_serialUnsubClosed) {
    _serialUnsubClosed = window.electronAPI.onSerialClosed(({ reason, error }) => {
      _serialOpen = false;
      if (reason === 'error' && error) {
        _serialSetStatus(`disconnected: ${error}`, false);
      } else {
        _serialSetStatus('disconnected', false);
      }
      _updateSerialPauseButton();
    });
  }
}

async function closeSerialMonitor() {
  if (!_serialOpen) {
    _serialSetStatus('disconnected', false);
    _updateSerialPauseButton();
    return;
  }
  await window.electronAPI.closeSerial();
  _serialOpen = false;
  _serialSetStatus('disconnected', false);
  _updateSerialPauseButton();
  // The monitor was holding the port, which is the one blocking reason that lasts
  // as long as the user wants it to. Releasing it is a real trigger, and without
  // this the version stayed unknown until some unrelated port event happened to
  // fire. NOT on the flash path: pauseSerialBeforeFlash sets _serialAutoPaused
  // before calling us, and the flash needs the port we would be grabbing.
  // (probeBoardOSVersion also guards on isBusy, so this is belt and braces.)
  if (!_serialAutoPaused && !_boardOSVersion && selectedPort && selectedPortIsProffieboard) {
    _probedSN = null;
    probeBoardOSVersion({ path: selectedPort, isProffieboard: true, serialNumber: selectedPortSN });
  }
}

function _switchLogTab(name) {
  const buildBtn  = document.querySelector('.bp-log-tab[data-tab="build"]');
  const serialBtn = document.querySelector('.bp-log-tab[data-tab="serial"]');
  const buildPane = el('bp-pane-build');
  const serialPane = el('bp-pane-serial');
  const root = el('build-log');
  if (!buildBtn || !serialBtn || !buildPane || !serialPane || !root) return;

  const isSerial = (name === 'serial');
  buildBtn.classList.toggle('active', !isSerial);
  serialBtn.classList.toggle('active', isSerial);
  buildPane.classList.toggle('active', !isSerial);
  serialPane.classList.toggle('active', isSerial);
  root.classList.toggle('serial-active', isSerial);
  _serialActive = isSerial;

  // Always open body when switching tabs (and resume serial if it was collapsed-paused)
  el('bp-log-body').classList.add('open');
  _setLogChevron(true);
  _syncSerialPauseToCollapse(true);

  if (isSerial) {
    if (!_serialOpen && selectedPort && !window._isFlashing) {
      openSerialMonitor();
    } else if (!selectedPort) {
      _serialSetStatus('no port selected', false);
    }
    setTimeout(() => el('bp-serial-input')?.focus(), 0);
  } else {
    if (_serialOpen) closeSerialMonitor();
  }
}

async function _sendSerial() {
  if (!_serialOpen) return;
  const input = el('bp-serial-input');
  if (!input) return;
  const text = input.value;
  if (!text) return;
  input.value = '';
  // Sending is an explicit "I'm at the live tail" action — re-engage auto-scroll
  // and hide the pill, even if the user had scrolled up to read history.
  _serialAutoScroll = true;
  _serialPendingNewLines = 0;
  _updateJumpPill();
  // Echo locally so user sees what they sent
  _serialAppend(`> ${text}\n`);
  const log = el('bp-serial-log');
  if (log) log.scrollTop = log.scrollHeight;
  await window.electronAPI.writeSerial(text + '\n');
}

// Single source of truth for the pause-button label. The button is overloaded
// across three states: paused / running / disconnected. Disconnected wins —
// when the port isn't open, there's nothing to pause and the button repurposes
// as a retry so the user can recover from "access denied" / "device gone"
// without leaving the tab. Called from every state transition that affects
// _serialOpen or _serialPaused.
function _updateSerialPauseButton() {
  const btn = el('bp-serial-pause');
  if (!btn) return;
  // ❚❚ (two HEAVY VERTICAL BAR, U+275A from Dingbats) renders monochrome by
  // default and visually reads as "pause" without triggering Windows' colored
  // emoji glyph for ⏸. Tried VS-15 first; Windows ignored it for U+23F8.
  if (!_serialOpen) {
    btn.textContent = '↺ retry';
    btn.title       = 'Try to connect to the selected port again';
  } else if (_serialPaused) {
    btn.textContent = '▶ resume';
    btn.title       = 'Resume incoming data (buffered while paused)';
  } else {
    btn.textContent = '❚❚ pause';
    btn.title       = 'Pause incoming data (still buffered)';
  }
  // Close button is only meaningful while a port is open — when there's no
  // connection there's nothing to close, and tab-switch already handles release
  // on its own. Hidden when disconnected keeps the toolbar uncluttered.
  const closeBtn = el('bp-serial-close');
  if (closeBtn) closeBtn.style.display = _serialOpen ? '' : 'none';
}

function _setSerialPaused(paused) {
  if (_serialPaused === paused) return;
  _serialPaused = paused;
  _updateSerialPauseButton();
  if (!paused && _serialPausedBuf) {
    const flushed = _serialPausedBuf.length;
    _serialAppend(_serialPausedBuf);
    _serialPausedBuf = '';
    _debugSerial('resume', `flushed ${flushed}B`);
  } else {
    _debugSerial(paused ? 'paused' : 'resumed (no buffer)');
  }
}

function _togglePauseSerial() {
  // Disconnected → retry. The user clicked the button thinking "do something
  // useful" — opening (or re-opening) the port is the only sensible action.
  if (!_serialOpen) {
    openSerialMonitor();
    return;
  }
  _setSerialPaused(!_serialPaused);
}

// Collapsing the log panel auto-pauses serial (no DOM cost while hidden).
// Expanding always resumes — even if the user had manually paused — so the
// expand/collapse behavior stays predictable rather than surfacing a stale
// paused state with no visible explanation.
function _syncSerialPauseToCollapse(open) {
  _debugSerial('syncCollapse', `open=${open}`);
  _setSerialPaused(!open);
}

function _clearSerialLog() {
  const log = el('bp-serial-log');
  if (log) log.innerHTML = '';
  _serialPausedBuf = '';
  _serialPending   = '';
  // After clearing, user is implicitly "at the bottom" of an empty log — re-engage
  // auto-scroll so new lines tail-follow without requiring a manual scroll. Drop
  // the pending-new-lines counter and hide the pill since there's nothing to catch
  // up on.
  _serialAutoScroll = true;
  _serialPendingNewLines = 0;
  _updateJumpPill();
}

// Called before flash starts — release the COM port so flashing can take it.
async function pauseSerialBeforeFlash() {
  if (_serialOpen) {
    _serialAutoPaused = true;
    _serialAppend('\n— port released for flash —\n');
    await closeSerialMonitor();
  }
}

// Called after flash completes — reconnect if user was using the monitor.
async function resumeSerialAfterFlash() {
  if (_serialAutoPaused) {
    _serialAutoPaused = false;
    if (_serialActive && selectedPort) {
      // Give the board ~800ms to enumerate after reset
      setTimeout(() => { if (_serialActive && !window._isFlashing) openSerialMonitor(); }, 800);
    }
  }
}
window.pauseSerialBeforeFlash  = pauseSerialBeforeFlash;
window.resumeSerialAfterFlash  = resumeSerialAfterFlash;

function wireSerialMonitor() {
  document.querySelectorAll('.bp-log-tab').forEach(btn => {
    btn.addEventListener('click', () => _switchLogTab(btn.dataset.tab));
  });
  el('bp-serial-send')?.addEventListener('click', _sendSerial);
  el('bp-serial-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _sendSerial(); }
  });
  el('bp-serial-pause')?.addEventListener('click', _togglePauseSerial);
  // Close = switch to Build Output (which calls closeSerialMonitor inside
  // _switchLogTab) + collapse the log body. The tab switch handles port release;
  // the collapse gives a visible "done" cue. Order matters — _switchLogTab
  // force-opens the body, so the collapse has to run AFTER. No separate "close
  // port" IPC needed — we're leaning on existing machinery so there's only one
  // closure path to reason about.
  el('bp-serial-close')?.addEventListener('click', () => {
    _switchLogTab('build');
    if (el('bp-log-body').classList.contains('open')) toggleLog();
  });
  el('bp-serial-clear')?.addEventListener('click', _clearSerialLog);
  el('bp-serial-filters')?.addEventListener('click', () => _toggleSuppressPopover());
  el('bp-serial-filters-clearall')?.addEventListener('click', e => { e.stopPropagation(); _clearAllSuppression(); });
  // Right-click anywhere on a line in the serial log → suppression menu
  el('bp-serial-log')?.addEventListener('contextmenu', e => {
    const line = e.target.closest('.serial-line');
    if (!line) return;
    e.preventDefault();
    _showSerialContextMenu(e.clientX, e.clientY, line.textContent);
  });
  // ESC dismisses any open serial-side overlay
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (_serialCtxMenuEl)  _dismissSerialContextMenu();
      if (_suppressPopoverEl) _dismissSuppressPopover();
    }
  });
  _serialSetStatus('disconnected', false);

  // Smart auto-scroll: the log scrolls to the bottom on every new line by default,
  // but pauses snap-to-bottom while the user is scrolled up reading history. Once
  // they scroll back to the bottom (within 20px tolerance so touchpad momentum /
  // accidental wheel ticks don't kick them out of auto-follow), snap-to-bottom
  // resumes. _sendSerial and _jumpToBottom also re-engage on explicit user intent.
  const _serialLog = el('bp-serial-log');
  if (_serialLog) {
    _serialLog.addEventListener('scroll', () => {
      const atBottom = (_serialLog.scrollHeight - _serialLog.scrollTop - _serialLog.clientHeight) <= 20;
      _serialAutoScroll = atBottom;
      if (atBottom) {
        _serialPendingNewLines = 0;
        _updateJumpPill();
      }
    });
  }

  // Jump-pill click → snap to bottom and re-engage auto-scroll.
  el('bp-serial-jump-pill')?.addEventListener('click', _jumpToBottom);

  // End key (when serial pane is active and the user isn't typing in an input)
  // jumps to bottom. Mirrors standard text-region behavior without stealing End
  // from the send input — that input owns its own End handling for text cursor.
  document.addEventListener('keydown', e => {
    if (e.key !== 'End' || !_serialActive) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    _jumpToBottom();
  });

  // When the user alt-tabs back to JMT Studio while the serial pane is open, the OS
  // gives focus to the window but no element receives document focus, so keystrokes
  // go nowhere until the user manually clicks something. Refocus the send input so
  // they can keep typing immediately. setTimeout(0) defers past Electron's own focus
  // bookkeeping.
  window.addEventListener('focus', () => {
    if (!_serialActive || !_serialOpen) return;
    const input = el('bp-serial-input');
    if (!input) return;
    setTimeout(() => input.focus(), 0);
  });
}

// ── UI helpers ─────────────────────────────────────────

// Single source of truth for whether Compile can run, and — the part that was
// missing — WHY it can't. Compile has six independent preconditions and only one
// of them (no file open) is evident from looking at the screen, so a greyed-out
// button with no explanation leaves the user guessing. That is especially true
// for a first-timer, whose most likely blocker is an OS version they never
// noticed they had to choose.
//
// Both callers route through here deliberately. The two disabled-state
// assignments had already drifted: setBusy() omitted the OS-version check that
// updateCompileButton() applied, so whether Compile was enabled with no version
// selected depended on which ran last.
//
// Order matters: most fundamental first, so the tooltip names the thing they
// should deal with rather than whichever check happens to be listed first.
function compileBlockedReason() {
  if (isBusy)                   return 'A build or flash is already running.';
  if (!window._currentFilePath) return 'Open a config file to compile.';
  if (!selectedFqbn)            return 'Select your board.';
  const version = document.getElementById('input-version')?.value;
  if (!version || isVersionSentinel(version)) {
    return 'Select a ProffieOS version. If the list is empty, download or import one first.';
  }
  // Plugin still arriving. Compiling against a half-present core fails in
  // ways that look like the config's fault rather than a download's.
  if (window._coreInstallInFlight) {
    // Same words as the Versions panel's own label. "Getting" was dropped there as a state that
    // described nothing; leaving it alive here is the "grep the term, not the feature" miss.
    // The flag carries a version string when one is known and plain `true` when
    // it is not, so it can never be interpolated blind - that renders
    // "Proffieboard Plugin true" into a tooltip. (2026-08-15)
    const which = window._coreInstallInFlight;
    return typeof which === 'string'
      ? `Downloading and installing Proffieboard Plugin ${which}. Compile once it is ready.`
      : 'Downloading and installing the Proffieboard Plugin. Compile once it is ready.';
  }
  // A cache check does NOT block compiling, and it used to. Every other reason above describes a
  // real inability - busy, no file, no board, no version, a half-present plugin. This one only said
  // "wait, we might restore this for you", and the cost was a visible disable/enable on every
  // config open, board change, USB change and OS version change. Coalescing the overlapping checks
  // reduced it from several flickers to one; the flicker is gone entirely only by not blocking.
  // Clicking Compile during the lookup is legitimate - the user gets a compile, which is what they
  // asked for. checkCacheForConfig bails if a build started while it was reading, so a late cache
  // hit can no longer overwrite a running compile. (2026-08-14)
  if (compileSuccess)           return 'Already compiled. Flash it, or edit the config to build again.';
  return null;
}

function applyCompileButtonState() {
  const btn = el('bp-btn-compile');
  if (!btn) return;
  const reason = compileBlockedReason();
  btn.disabled = !!reason;
  btn.title    = reason || '';
}

function setBusy(busy) {
  isBusy = busy;
  applyCompileButtonState();
  if (isDfuMode) {
    el('bp-btn-flash').disabled = busy || !compileSuccess;
  } else {
    el('bp-btn-flash').disabled = busy || !compileSuccess || !selectedPort;
  }
  applyFlashTitle();
  el('bp-btn-refresh-ports').disabled = busy;
  el('bp-port-select').disabled = busy;
}

function updateCompileButton() {
  applyCompileButtonState();
}
window.updateCompileButton = updateCompileButton;
window.getLastFlashedSN    = () => lastFlashedSN;

// Why Flash is unavailable, in plain terms. Deliberately does NOT restructure the
// enable logic the way compileBlockedReason() does: setFlashEnabled() takes an
// explicit `enabled` flag that ten call sites pass on purpose, and collapsing that
// into state-derived conditions would discard information. So this only explains
// the button; it never decides it.
//
// Because the reason is derived from state rather than from the caller's flag,
// there may be paths where the button is disabled and none of these match. In
// that case we say NOTHING rather than something vague: a tooltip that does not
// help teaches people not to hover, and then the useful ones go unread too.
// It also makes the gap a diagnostic — a disabled Flash button with no tooltip
// means a blocking condition this function does not model, which is a bug to
// fix here rather than paper over.
// A port we did not identify as a Proffieboard is NOT a blocking reason. Detection is arduino-cli
// matching a board name, and it is not the last word: a board can be there and unrecognised, and
// the user may know something we do not. Refusing the attempt bought nothing either - `flash()`
// resolves which board it is actually talking to by serial number, corrects a wrong selection when
// exactly one board is present, and refuses only when genuinely ambiguous. That is a better
// decision than this gate could make, made later with more information.
//
// Offering a port in the dropdown and then refusing it was the incoherent part: show it or do not.
// (2026-08-14)
function flashBlockedReason() {
  if (isBusy)         return 'A build or flash is already running.';
  // No OS version selected means the config asked for one we do not have. Any
  // binary sitting in the cache was built against the version the app used to
  // SUBSTITUTE in that case, so offering to flash it puts firmware on a board
  // that this config never asked for - the same harm the empty selection exists
  // to prevent, arriving through the other button. compileSuccess survives a
  // cache restore, so it cannot be the only gate. (2026-08-19)
  const _ver = el('input-version')?.value;
  if (!_ver || isVersionSentinel(_ver)) {
    return window._configOsVersionMissing
      ? `This config was written for ${window._configOsVersionMissing}, which isn't installed. Install it, or pick a version, before flashing.`
      : 'Select a ProffieOS version before flashing.';
  }
  if (!compileSuccess) return 'Compile first, then flash.';
  if (!isDfuMode && !selectedPort) return 'Connect your Proffieboard and select its port.';
  return null;
}

// Call AFTER the disabled state has been set, so the tooltip matches reality.
function applyFlashTitle() {
  const btn = el('bp-btn-flash');
  if (!btn) return;
  btn.title = btn.disabled ? (flashBlockedReason() || '') : '';
}

function setFlashEnabled(enabled) {
  // A state-derived condition rather than a caller flag, same as !selectedPort:
  // no version selected means there is nothing this config legitimately built
  // against, whatever the cache is holding. Ten call sites pass `enabled` for
  // their own reasons and none of them know about this one.
  const _ver     = el('input-version')?.value;
  const _noVer   = !_ver || isVersionSentinel(_ver);
  if (isDfuMode) {
    el('bp-btn-flash').disabled = !enabled || isBusy || _noVer;
  } else {
    el('bp-btn-flash').disabled = !enabled || !selectedPort || isBusy || _noVer;
  }
  applyFlashTitle();
}

function startCompileTimer() {
  _compileStartTime = Date.now();
  document.getElementById('bm-timer-compile').style.display = 'inline';
  document.getElementById('bm-timer-compile-val').textContent = '0:00';
  // Persistent left-justified "last compile" for this config (its home now, so it
  // isn't lost when the hint line shows something else).
  const _lastDur = window.getLastCompileDuration?.();
  const _lastEl  = document.getElementById('bm-timer-last');
  if (_lastEl) {
    // Keep the left slot PRESENT in compile mode even when empty: as a zero-width
    // flex item it holds position 0, so the live Compile Time stays pinned to the
    // RIGHT edge under space-between. (Collapsing it would leave a single child,
    // which space-between pins LEFT.) Flash mode hides it instead, so there the
    // two timers hug opposite edges.
    _lastEl.textContent = _lastDur
      ? `Last compile: ${Math.floor(_lastDur / 60)}:${(_lastDur % 60).toString().padStart(2, '0')}`
      : '';
    _lastEl.style.display = 'inline';
  }
  const start = _compileStartTime;
  compileTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    document.getElementById('bm-timer-compile-val').textContent =
      `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  }, 1000);
}

function stopCompileTimer() {
  if (compileTimerInterval) { clearInterval(compileTimerInterval); compileTimerInterval = null; }
  // Keep the frozen value visible — showBuildModal() hides it on next compile reset
}

function startFlashTimer() {
  document.getElementById('bm-timer-flash').style.display = 'inline';
  document.getElementById('bm-timer-flash-val').textContent = '0:00';
  // Don't show last-compile during a flash (no last-flash time tracked yet).
  // Collapse the slot entirely so Compile Time / Flash Time hug the row edges.
  const _lastEl = document.getElementById('bm-timer-last');
  if (_lastEl) { _lastEl.textContent = ''; _lastEl.style.display = 'none'; }
  const start = Date.now();
  flashTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    document.getElementById('bm-timer-flash-val').textContent =
      `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  }, 1000);
}

function stopFlashTimer() {
  if (flashTimerInterval) { clearInterval(flashTimerInterval); flashTimerInterval = null; }
}

/**
 * Sets a status indicator.
 * type: 'toolchain' | 'compile' | 'flash' | 'port'
 * state: 'ok' | 'error' | 'warn' | 'pending'
 */
// ── Port status DFU popover ────────────────────────────
let _portTip = null;

function _ensurePortTip() {
  if (_portTip) return;
  _portTip = document.createElement('div');
  _portTip.className = 'port-tip-popover';
  _portTip.innerHTML =
    'No Proffieboard detected. &nbsp;' +
    '<button class="port-tip-dfu-btn" id="port-tip-dfu-btn">⚡ Try Bootloader Mode (DFU)</button>';
  document.body.appendChild(_portTip);
  _portTip.querySelector('#port-tip-dfu-btn').addEventListener('click', () => {
    _hidePortTip();
    enterDfuMode();
  });
  // Keep tip visible while hovering it
  _portTip.addEventListener('mouseenter', () => clearTimeout(_portTipHideTimer));
  _portTip.addEventListener('mouseleave', _hidePortTip);
}

let _portTipHideTimer = null;
let _portTipEnabled   = false;  // only true when no Proffieboard detected

function _showPortTip(anchorEl) {
  if (!_portTipEnabled || isDfuMode) return;
  _ensurePortTip();
  const rect = anchorEl.getBoundingClientRect();
  _portTip.style.display = 'block';
  // Position above the anchor, right-aligned to it
  _portTip.style.left = Math.max(4, rect.right - _portTip.offsetWidth) + 'px';
  _portTip.style.top  = (rect.top - _portTip.offsetHeight - 6) + 'px';
}

function _hidePortTip() {
  _portTipHideTimer = setTimeout(() => {
    if (_portTip) _portTip.style.display = 'none';
  }, 120);
}

function _attachPortTip(textEl) {
  if (textEl._portTipAttached) return;
  textEl._portTipAttached = true;
  textEl.addEventListener('mouseenter', () => { clearTimeout(_portTipHideTimer); _showPortTip(textEl); });
  textEl.addEventListener('mouseleave', _hidePortTip);
}

function setStatus(type, state, message) {
  const dot  = el(`bp-status-${type}-dot`);
  const text = el(`bp-status-${type}-text`);
  if (!dot || !text) return;

  dot.className = `bp-status-dot bp-status-${state}`;
  text.textContent = message;
  text.title = message;   // full text on hover when the label is ellipsis-truncated

  if (type === 'port') {
    if (state === 'warn' || state === 'error') {
      _portTipEnabled = true;
      text.style.cursor = 'default';
      _attachPortTip(text);
    } else {
      _portTipEnabled = false;
      text.style.cursor = '';
      if (_portTip) _portTip.style.display = 'none';
    }
  }
}

// ── Cache check ────────────────────────────────────────
// missStatus: message to show on miss; false = don't update status on miss
async function checkCacheForConfig(missStatus) {
  // Only the NEWEST check may write. Opening or switching a config fires several of these in a
  // row - board change, USB change, OS version change, and the debounced content change - each
  // awaiting its own IPC round trip. Two problems came from letting them all write:
  //
  //   1. Correctness. Each run captures its own content/fqbn/usb, but they all resolve into the
  //      same shared state. Switch configs while one is in flight and the OLDER result can land
  //      last, so a stale HIT marks the new config "restored from cache" and enables Flash for a
  //      binary built from a different config. Same family as flashing whichever board happened
  //      to be in the bootloader.
  //   2. The visible half. Each run cleared cacheCheckPending on its way out, so the button went
  //      disabled -> enabled once per check: a flicker on every config open.
  //
  // A superseded run now returns WITHOUT clearing the flag, so the button stays disabled until
  // the last check settles. One disable, one enable. (2026-08-14)
  const seq = ++_cacheCheckSeq;

  // Callers (board change, USB change, OS version change, etc.) pre-set cacheCheckPending=true
  // to disable Compile immediately. If this run can't proceed (no API, no FQBN, empty editor),
  // we must clear that flag here — otherwise Compile stays disabled forever after a + New flow
  // where loadContent dispatches a board='' change while content/FQBN are still unset.
  const content = (window.electronAPI && window.getEditorContent) ? window.getEditorContent() : null;
  // The OS version is NOT a parameter of checkCache — the main process keys on
  // whatever selectVersion last told it. When the config asked for a version we
  // do not have, the renderer selects nothing and deliberately does NOT call
  // selectVersion('') (that would wipe Store.lastVersion over one bad config), so
  // main is still holding the previous version and will happily answer for it.
  // The result was "Compile restored from cache" over a config with no selection,
  // claiming a ready build for a version the user never chose — the same
  // substitution wearing a status message. Do not ask while nothing is selected.
  // (2026-08-19)
  const _ver     = el('input-version')?.value;
  const hasVer   = !!(_ver && !isVersionSentinel(_ver));
  const canCheck = !!(window.electronAPI && selectedFqbn && hasVer && content && content.trim());

  if (!canCheck) {
    // Blocked specifically because no version is selected, with a config open that
    // asked for one we do not have: any compileSuccess and any "restored from
    // cache" on screen belong to a DIFFERENT version and must not survive. Skipping
    // the check alone would leave the old claim standing, which is how the status
    // line kept promising a ready build over an empty selection. Narrowed to this
    // reason on purpose — the other !canCheck paths (+ New with no content or no
    // FQBN yet) must keep their existing behaviour.
    if (!hasVer && window._configOsVersionMissing && seq === _cacheCheckSeq) {
      compileSuccess = false;
      setFlashEnabled(false);
      setStatus('compile', '', 'Not compiled');
    }
    // Still guard the clear: a newer check may already be in flight and owns the button now.
    if (cacheCheckPending && seq === _cacheCheckSeq) { cacheCheckPending = false; updateCompileButton(); }
    return;
  }

  cacheCheckPending = true;
  updateCompileButton();

  let result;
  try {
    result = await window.electronAPI.checkCache(content, selectedFqbn, selectedUsb);
  } catch {
    if (seq !== _cacheCheckSeq) return;
    cacheCheckPending = false;
    updateCompileButton();
    return;
  }
  if (seq !== _cacheCheckSeq) return;   // superseded while we were reading the cache
  // A build started while we were reading. It owns compileSuccess, the flash button and the status
  // line from here; a late cache hit landing on top would claim "restored from cache" over a
  // compile that is actually running.
  if (isBusy) { cacheCheckPending = false; return; }
  cacheCheckPending = false;

  if (result.hit) {
    compileSuccess = true;
    setFlashEnabled(isDfuMode ? compileSuccess : !!selectedPort);
    updateCompileButton();
    setStatus('compile', 'ok', 'Compile restored from cache');
    // Carry the core through on a restore too. The cached entry records which
    // core produced it, so the config's marker stays truthful rather than
    // inheriting whatever core happens to be selected now.
    if (window.setCompiledTimestamp) {
      // A hit means this entry's buildPkgHash matched, and that hash is derived
      // from the selected version's ProffieOS source hash - so the entry WAS
      // built from the version now selected. The name is therefore recoverable
      // from the selection without storing it in the cache. (2026-08-15)
      // fqbn and usb come from the ENTRY, not from the current controls: they are
      // components of buildPkgHash, so a hit proves the entry was built with
      // exactly these, and the metadata has recorded them since before 1.8.
      window.setCompiledTimestamp(result.metadata.compiledAt, undefined,
                                  result.metadata.coreVersion,
                                  document.getElementById('input-version')?.value || null,
                                  result.metadata.fqbn, result.metadata.usb);
    }
  } else {
    // Cache miss → if we were claiming a valid cached compile, downgrade. The lookup
    // just ran with current inputs and didn't find a match, so the previous "success"
    // state was based on stale inputs (e.g., my_styles.h edited in another tab, OS
    // files changed via JMT apply, etc.). The miss is the authoritative truth.
    if (compileSuccess) {
      compileSuccess = false;
      setFlashEnabled(false);
    }
    updateCompileButton();
    // missStatus=false means the caller (content-change debounce) already set a more
    // specific status — don't overwrite it. Otherwise reflect the miss in the UI.
    if (missStatus !== false) {
      setStatus('compile', missStatus ? 'warn' : '', missStatus || 'Not compiled');
    }
  }
}

// ── DFU mode ───────────────────────────────────────────
// Sets DFU-mode UI state without driving any detection flow — caller decides what comes next.
function _setupDfuModeUI() {
  isDfuMode       = true;
  dfuDeviceReady  = false;
  _portsBeforeDfu = cachedPorts.map(p => p.path);
  stopPortWatch();

  ['bp-port-select', 'bp-board-display', 'bp-btn-refresh-ports',
    'bp-label-port', 'bp-label-detected'].forEach(id => {
    const e = el(id); if (e) e.style.display = 'none';
  });
  el('bp-dfu-mode-indicator').style.display = 'inline-flex';
  setFlashEnabled(compileSuccess);
}

function enterDfuMode() {
  _setupDfuModeUI();
  setStatus('port', 'warn', 'Checking for DFU device...');
  _checkDfuOnEntry();
}

async function _checkDfuOnEntry() {
  const result = await window.electronAPI.detectDFU();

  if (result.found && result.accessible) {
    dfuDeviceReady = true;
    setStatus('port', 'ok', 'DFU device ready');
    setFlashEnabled(compileSuccess);
    cacheCheckPending = true;
    updateCompileButton();
    checkCacheForConfig();
  } else if (result.found && !result.accessible) {
    // Board in DFU but driver missing — skip boot instructions, go straight to driver fix
    startDfuWaitModal(true, false);
  } else {
    // Board not yet in DFU — show boot instructions and poll
    startDfuWaitModal(false, false);
  }
}

function exitDfuMode() {
  isDfuMode      = false;
  dfuDeviceReady = false;

  // Restore normal port elements
  ['bp-port-select', 'bp-board-display', 'bp-btn-refresh-ports',
    'bp-label-port', 'bp-label-detected'].forEach(id => {
    const e = el(id); if (e) e.style.display = '';
  });
  el('bp-dfu-mode-indicator').style.display = 'none';

  selectedPort = null;
  selectedPortIsProffieboard = false;
  setFlashEnabled(false);
  refreshPorts();
}

// Shows the waiting modal and polls for DFU device.
// autoFlash: true when triggered by Flash click; false when triggered by mode entry.
// justInstalled: true only when coming from a successful driver install — enables Try Again after replug.
async function startDfuWaitModal(isRetry = false, autoFlash = true, justInstalled = false) {
  if (!isRetry) {
    showBuildModal('⚡ Bootloader Mode (DFU)');
    appendModalLog('Put the board into Bootloader Mode:', false);
    appendModalLog('  1. Hold the BOOT button', false);
    appendModalLog('  2. Tap the RESET button', false);
    appendModalLog('  3. Release RESET', false);
    appendModalLog('  4. Release BOOT', false);
    appendModalLog('──────────────────────────────────', false);
    appendModalLog('Waiting for DFU device to appear...', false);
    document.getElementById('bm-status').textContent = 'Waiting for DFU device...';
  } else {
    // Board already in DFU mode — skip boot instructions, just re-poll
    const modal = document.getElementById('build-modal');
    modal.style.display = 'flex';
    document.getElementById('bm-log').innerHTML = '';
    document.getElementById('bm-title').textContent = '⚡ Bootloader Mode (DFU)';
    document.getElementById('bm-title').style.color = 'var(--c-text-bright)';
    document.getElementById('bm-dfu-setup').style.display = 'none';
    document.getElementById('bm-manual-row').style.display = 'none';
    document.getElementById('bm-dfu-note').style.display = 'none';
    document.getElementById('bm-retry').style.display = 'none';
    document.getElementById('bm-close').style.display = 'none';
    document.getElementById('bm-abort').style.display = 'inline-block';
    setBarMode('knightrider');
    appendModalLog('Verifying DFU connection...', false);
    document.getElementById('bm-status').textContent = 'Verifying connection...';
  }
  // Both branches above have finished writing (and the retry branch has cleared bm-log), so this
  // is the first point where the note survives. It is set only when the flash that landed here was
  // aimed at a port we never identified as a Proffieboard, so a real board's recovery is unchanged.
  // One-shot: cleared on use, so it cannot leak into a later, unrelated DFU session.
  if (_dfuPortNote) {
    appendModalLog('', false);
    appendModalLog(`Note: ${_dfuPortNote}`, false);
    _dfuPortNote = null;
  }
  stopCompileTimer();
  document.getElementById('bm-timer-compile').style.display = 'none';
  document.getElementById('bm-timer-flash').style.display = 'none';
  document.getElementById('bm-abort').textContent = '⊘ Cancel';

  let cancelled = false;
  const abortBtn = document.getElementById('bm-abort');
  const cancelHandler = () => { cancelled = true; };
  abortBtn.addEventListener('click', cancelHandler, { once: true });

  let dfuResult = { found: false, accessible: false };
  let retryTimedOut    = false;
  let notAccessibleStart = null;
  const retryStart  = isRetry ? Date.now() : null;

  while (!cancelled) {
    dfuResult = await window.electronAPI.detectDFU();

    if (dfuResult.found && dfuResult.accessible) break;  // fully ready — always stop

    if (!isRetry && dfuResult.found) break;  // boot-wait: break on found regardless of driver

    if (dfuResult.found && !dfuResult.accessible) {
      // Board is in DFU but WinUSB cannot access it yet.
      if (justInstalled) {
        // We just force-bound the driver, which is synchronous, so this short
        // grace only covers the brief re-enumeration window before dfu-util can
        // open the device. (The old libwdi installer bound asynchronously and
        // needed up to 10s here; ours does not.)
        if (!notAccessibleStart) notAccessibleStart = Date.now();
        if (Date.now() - notAccessibleStart > 3000) break;
      } else {
        // Cold entry: nothing is installing, so there is nothing to wait for.
        // Show the driver-fix screen immediately instead of stalling 10s.
        break;
      }
    } else {
      notAccessibleStart = null;  // device disappeared — reset grace timer
    }

    // If board is no longer detected after 8s, prompt re-entry — but only if it's
    // genuinely gone (found=false). If it's still found but driver can't access it,
    // the board IS connected; don't tell the user to re-enter bootloader mode.
    if (retryStart && !retryTimedOut && Date.now() - retryStart > 8000 && !dfuResult.found) {
      retryTimedOut = true;
      appendModalLog('', false);
      appendModalLog('Board may have exited Bootloader Mode.', false);
      appendModalLog('Re-enter it: hold BOOT, tap RESET, release both.', false);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  abortBtn.removeEventListener('click', cancelHandler);

  if (cancelled) {
    document.getElementById('build-modal').style.display = 'none';
    // Stay in DFU mode — user can compile and Flash later to resume
    if (dfuResult.found && !dfuResult.accessible) {
      const driverStatusMsg = navigator.platform.startsWith('Linux')
        ? 'udev rules required'
        : 'STM32 driver required';
      setStatus('port', 'warn', driverStatusMsg);
    } else {
      setStatus('port', 'warn', 'Put board in Bootloader Mode to flash');
    }
    return;
  }

  if (!dfuResult.accessible) {
    _dfuRetryAutoFlash = autoFlash;
    document.getElementById('bm-log').innerHTML = '';
    const driverStillLoading = notAccessibleStart !== null;
    const isWin   = navigator.platform.startsWith('Win');
    const isLinux = navigator.platform.startsWith('Linux');
    let linuxCopyCmd = '';

    // ── Messages ──────────────────────────────────────────
    if (isWin) {
      if (driverStillLoading) {
        appendModalLog('The driver installed, but Windows has not finished activating it on this board.', false);
        appendModalLog('', false);
        appendModalLog('  Detected: STM32 Bootloader (0483:df11)', false);
        appendModalLog('', false);
        appendModalLog('Unplug the board, reconnect it in Bootloader Mode, then click Try Again.', false);
        appendModalLog('If it still fails, click Install DFU Driver below.', false);
      } else {
        appendModalLog('STM32 Bootloader detected, but dfu-util cannot reach it. WinUSB is not the active driver on this board.', false);
        appendModalLog('', false);
        appendModalLog('  Detected: STM32 Bootloader (0483:df11)', false);
        appendModalLog('', false);
        appendModalLog("JMT Studio can set this up with its own signed driver. No download, and it will not stack up driver copies the way the manual tools do. On most systems it is a one-time setup and future boards just work.", false);
        appendModalLog('', false);
        appendModalLog('Click Install DFU Driver and accept the Windows prompts (permission, plus installing the driver the first time), or use a manual option below.', false);
      }
    } else if (isLinux) {
      appendModalLog('DFU device detected but cannot be accessed.', true);
      appendModalLog('Linux requires a udev rule to allow USB access.', false);
      appendModalLog('', false);
      appendModalLog('Paste the following into a terminal:', false);
      appendModalLog('', false);
      const arduinoDataPath = await window.electronAPI.getArduinoDataPath();
      linuxCopyCmd = `cd "${arduinoDataPath}/packages/proffieboard/hardware/stm32l4" && cd */drivers/linux && sudo cp *.rules /etc/udev/rules.d && sudo udevadm control --reload-rules && sudo udevadm trigger`;
      appendModalLog(`  ${linuxCopyCmd}`, false);
      appendModalLog('', false);
      appendModalLog('Then replug the board in bootloader mode and click Try Again.', false);
    } else {
      // Mac — DFU should work without any setup; this state is unexpected
      appendModalLog('DFU device could not be accessed.', true);
      appendModalLog('Try reconnecting the board.', false);
      appendModalLog('If the issue persists, visit pod.hubbe.net for setup help.', false);
    }

    // ── Title and shared button state ─────────────────────
    // Windows really does have a driver problem (WinUSB rebinding per port).
    // Linux/Mac don't — it's a permissions issue (udev rules), and calling it
    // a "driver" misleads users into searching for software that doesn't exist.
    document.getElementById('bm-title').textContent =
      isWin ? 'Fix DFU Driver' : 'Fix DFU Access';
    document.getElementById('bm-title').style.color = 'var(--c-warn-text)';
    document.getElementById('bm-abort').style.display = 'none';
    document.getElementById('bm-close').style.display = 'inline-block';
    document.getElementById('bm-close').textContent = 'Cancel';
    document.getElementById('bm-dfu-note').style.display = 'block';

    const dfuSetupBtn = document.getElementById('bm-dfu-setup');
    dfuSetupBtn.textContent = '▶ Install DFU Driver';
    delete dfuSetupBtn.dataset.phase;

    const retryBtn = document.getElementById('bm-retry');

    // ── Per-OS button and status logic ────────────────────
    if (isWin) {
      if (driverStillLoading) {
        if (justInstalled) {
          retryBtn.textContent = '↺ Try Again';
          retryBtn.style.display = 'inline-block';
          _dfuRetryRecheck   = true;
          _dfuRetryAutoFlash = autoFlash;
        } else {
          retryBtn.style.display = 'none';
        }
        document.getElementById('bm-status').textContent = justInstalled ? 'Driver installed - replug board to activate' : 'WinUSB driver unavailable';
      } else {
        retryBtn.style.display = 'none';
        document.getElementById('bm-status').textContent = 'Windows driver required';
      }
      dfuSetupBtn.style.display = 'inline-block';
      document.getElementById('bm-manual-row').style.display = 'flex';
    } else if (isLinux) {
      retryBtn.style.display = 'none';
      document.getElementById('bm-status').textContent = 'Reboot required';
      document.getElementById('bm-manual-row').style.display = 'none';
      dfuSetupBtn.textContent        = 'Copy Commands';
      dfuSetupBtn.dataset.phase      = 'copy-linux';
      dfuSetupBtn.dataset.command    = linuxCopyCmd;
      dfuSetupBtn.style.display      = 'inline-block';
    } else {
      // Mac
      retryBtn.style.display = 'none';
      document.getElementById('bm-status').textContent = 'DFU access failed';
      dfuSetupBtn.style.display = 'none';
      document.getElementById('bm-manual-row').style.display = 'none';
    }

    setBarMode('error');
    return;
  }

  // DFU device detected and accessible
  dfuDeviceReady = true;
  setStatus('port', 'ok', 'DFU device ready');
  updateCompileButton();

  document.getElementById('bm-log').innerHTML = '';
  appendModalLog('✓ Proffieboard detected in Bootloader Mode (DFU)', false);
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-title').textContent = '⚡ DFU Device Ready';
  document.getElementById('bm-title').style.color = 'var(--c-title-accent)';
  setBarMode('success');

  if (autoFlash && compileSuccess) {
    appendModalLog('Firmware ready — flashing now...', false);
    doFlashDFU();
  } else {
    appendModalLog('', false);
    if (compileSuccess) {
      appendModalLog('A compiled firmware is ready. If your configuration is verified,', false);
      appendModalLog('click Flash Now to upload it to the board.', false);
    } else {
      appendModalLog('Verify your configuration and compile to flash the board.', false);
    }
    document.getElementById('bm-status').textContent = 'Connection successful.';
    const closeBtn = document.getElementById('bm-close');
    closeBtn.style.display = 'inline-block';
    closeBtn.textContent = 'Close';
    if (compileSuccess) {
      const flashBtn = document.getElementById('bm-retry');
      flashBtn.textContent = '⚡ Flash Now';
      flashBtn.style.display = 'inline-block';
    }
    setFlashEnabled(compileSuccess);
  }
}

// Called when Flash is clicked in DFU mode, or auto-triggered from startDfuWaitModal.
async function doFlashDFU() {
  if (isBusy) return;
  if (!compileSuccess) {
    appendLog('Compile first before flashing.', true);
    return;
  }

  // Same SD-corruption guard as the serial flash path (the compiled binary
  // carries the USB mode regardless of which flash route uploads it).
  const _sdFlash = window.checkMassStorageSafety
    ? await window.checkMassStorageSafety(selectedUsb, 'flash')
    : true;
  if (_sdFlash === 'recompile') { _flashAfterSdFix(); return; }
  if (!_sdFlash) {
    // Cancelled — restore a usable, closable state instead of stranding it.
    if (el('bm-status')) el('bm-status').textContent = 'Flash cancelled. Click Flash to try again.';
    if (el('bm-close'))  el('bm-close').style.display = 'inline-block';
    if (el('bm-abort'))  el('bm-abort').style.display = 'none';
    setFlashEnabled(true);
    return;
  }

  if (!dfuDeviceReady) {
    // Device not yet detected — run the detection flow first, then flash
    await startDfuWaitModal();
    return;
  }

  // Verify the device is still connected before committing to flash
  const liveCheck = await window.electronAPI.detectDFU();
  if (!liveCheck.found || !liveCheck.accessible) {
    dfuDeviceReady = false;
    // found=true but not accessible → driver issue, skip boot instructions
    // found=false → board gone, show full boot instructions so user knows to replug
    await startDfuWaitModal(liveCheck.found && !liveCheck.accessible, true);
    return;
  }

  // Device confirmed present — go straight to flash
  document.getElementById('bm-title').textContent = '⚡ Flashing (DFU)...';
  document.getElementById('bm-title').style.color = 'var(--c-text-bright)';
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-retry').style.display = 'none';
  document.getElementById('bm-close').style.display = 'none';
  document.getElementById('bm-status').textContent = 'Uploading firmware...';
  document.getElementById('build-modal').style.display = 'flex';
  document.getElementById('bm-log').innerHTML = '';
  startFlashTimer();
  setBarMode('flash');
  window._isFlashing = true;
  await pauseSerialBeforeFlash();
  setBusy(true);
  setStatus('flash', 'pending', 'Flashing via DFU...');
  if (_sdFlash === 'flash-anyway') {
    typeHintMessage('Flashing without SD card protection. I have a bad feeling about this…');
  } else if (_sdFlashLeadMsg) {
    typeHintMessage(_sdFlashLeadMsg);
    _sdFlashLeadMsg = null;
  }

  await window.electronAPI.flashDFU();
  setBusy(false);
  // onBuildDone handles success/failure via IPC
}

async function watchForSerialAfterDfu() {
  const timeout    = 10000;
  const start      = Date.now();
  const preDfuPaths = new Set(_portsBeforeDfu);

  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 500));
    const result = await window.electronAPI.getRecommendedPort();
    if (result.ok && result.proffieports && result.proffieports.length > 0) {
      // Prefer the port that wasn't present before the DFU flash
      const newPort = result.proffieports.find(p => !preDfuPaths.has(p.path))
                   || result.proffieports[0];
      _userChosePort      = true;
      _userChosenPortPath = newPort.path;
      _portsBeforeDfu     = [];
      lastFlashedSN       = newPort.serialNumber || null;
      if (window.setFlashedTimestamp) window.setFlashedTimestamp(newPort.path, lastFlashedSN);
      appendModalLog(`✓ Board restarted on ${newPort.path}.`, false);
      document.getElementById('bm-status').textContent = 'Board is back online.';
      setTimeout(() => exitDfuMode(), 1500);
      return;
    }
  }

  _portsBeforeDfu = [];
  exitDfuMode();
  document.getElementById('bm-status').textContent =
    'Flash complete, but the board has not been detected yet. Try power cycling.';
  appendModalLog('Board not detected after restart. Try power cycling or reconnecting.', true);
}

// ── OS version signal ──────────────────────────────────
// Two quiet honesty fixes, no nagging and no blocking:
//   1. When the open config carries no @jmt:os_version marker, the app picks
//      one on the user's behalf. Say so in the field's tooltip instead of
//      leaving it silent. Nearly every config that isn't ours lacks the marker
//      (vendor files, web Configurator output, a friend's config).
//   2. When a connected board reports a DIFFERENT ProffieOS than the selected
//      tree, mark the field and say what was detected. Information, not a
//      command — upgrading on purpose is a normal thing to do, so compile is
//      never blocked and manual selection always wins.
// Everything here degrades to showing nothing: no board, no probe, no map, no
// signal. It is additive to a flow that already works.

let _osVersionMap    = null;   // folderName → "v8.10", from each tree's own .ino
let _boardOSVersion  = null;   // what the connected board reported, or null
// When that firmware was flashed, as the board itself reports it. A SEPARATE
// absence from _boardOSVersion: a board can answer `version` and not print an
// install date, and that is not a failed probe. (2026-08-19)
let _boardInstalled  = null;
// Why we do not have a version, when we do not have one. Until 2026-08-19 only the
// VALUE was kept, so every failure looked identical to success-with-a-match: the
// field went plain and the tooltip omitted the board entirely. An absent answer
// rendered as an agreeing one. null = never asked (transient, say nothing);
// otherwise the probe's own reason.
let _boardOSReason   = null;
let _probedSN        = null;   // board we already asked; don't re-probe per poll

// Whether the open config declared a version lives on window, not here: this
// file is injected at the end of boot, so a config restored before that would
// have had its answer dropped by a setter that did not exist yet.
// index.html owns the value; we only read it.

async function loadOSVersionMap() {
  try {
    const r = await window.electronAPI?.getOSVersionMap?.();
    if (r?.ok) _osVersionMap = r.map;
  } catch { _osVersionMap = null; }
  applyOSVersionSignal();
}

// Asks the board what it is running. Fire-and-forget: a failure to answer is a
// non-event, because this only ever adds information.
async function probeBoardOSVersion(port) {
  if (!port?.isProffieboard || !port.path) return;
  const sn = port.serialNumber || port.path;
  if (sn === _probedSN) return;        // same board, already asked
  if (isBusy || isDfuMode) return;     // the port belongs to the build right now
  _probedSN = sn;
  try {
    const r = await window.electronAPI?.probeBoardVersion?.(port.path);
    _boardOSVersion = r?.ok ? r.version : null;
    _boardInstalled = r?.ok ? (r.installed || null) : null;
    _boardOSReason  = r?.ok ? null : (r?.reason || 'error');
    // "The port was busy" is not "the board won't answer." Clear the marker so
    // the next detection tries again, once the monitor or the flash is done.
    // A timeout or a failed open does mean the board is not talking, and that
    // one is left alone rather than retried on every port event.
    // EVERY transient reason clears the latch, not just these two. _probedSN is set
    // before the await and was only cleared for monitor-open and aborted, so a
    // 'timeout' or 'open-failed' disqualified that board for the LIFE OF THE
    // SESSION - keyed on serial number, so re-plugging did not help either. Both
    // are things that resolve on their own: a board mid-boot, a port still
    // enumerating, a driver hiccup. (2026-08-19)
    if (['monitor-open', 'aborted', 'timeout', 'open-failed', 'error'].includes(r?.reason)) {
      _probedSN = null;
    }
  } catch { _boardOSVersion = null; _boardInstalled = null; _boardOSReason = 'error'; _probedSN = null; }
  applyOSVersionSignal();
}

function forgetBoardOSVersion() {
  _boardOSVersion = null;
  _boardInstalled = null;
  _boardOSReason  = null;   // "not asked", not "asked and failed"
  _probedSN       = null;
  applyOSVersionSignal();
}

// The ProffieOS version the currently selected tree actually is, read from its
// source rather than its folder name (which is whatever the user typed).
function selectedTreeOSVersion() {
  const name = el('input-version')?.value;
  if (!name || isVersionSentinel(name)) return null;
  return _osVersionMap?.[name] || null;
}

function applyOSVersionSignal() {
  const sel = el('input-version');
  if (!sel) return;
  const name    = sel.value;
  const tree    = selectedTreeOSVersion();
  const mismatch = !!(_boardOSVersion && tree && _boardOSVersion !== tree);

  sel.classList.toggle('field-error', mismatch);

  // The field is 160px and folder names truncate, so the name stays the first
  // line of the tooltip — that was its only job before this signal existed.
  const notes = [];
  // The build target, as ONE line: "ProffieOS 7.15 +JMT on Plugin 3.6.0", and
  // when it has moved, "... but last built on ProffieOS 7.15 +JMT on Plugin
  // 4.6.0." A ProffieOS version and a plugin are one target, so they belong in
  // one sentence; splitting them made a tooltip that read as a list of alerts.
  // It REPLACES the bare name rather than sitting under it — the name is the
  // first half of the sentence. Falls back to the name when no plugin is known.
  // (2026-08-15)
  const target = window.getVersionTargetLine?.();
  if (target) notes.push(target);
  else if (name && !isVersionSentinel(name)) notes.push(name);
  // What the board is running. One sentence for both cases now: it used to add
  // "This will build against X", which restates the target line above it - and
  // once that line names the plugin too, the restatement is not even complete.
  // A owns the target; this owns the board. The contrast still lands, because
  // the two sit one line apart. (2026-08-15)
  // A board is connected and we have no version from it. Saying nothing here is
  // what made "could not read" render identically to "board agrees" - the whole
  // defect this entry opens with. Only speaks when there is a REASON: a null
  // reason means the probe has not run yet, which resolves in a moment and is not
  // worth a line. Deliberately no colour change: nothing is known to be WRONG, the
  // selected version may be perfectly right, and red would be a claim we cannot
  // support. This states what is unknown, which is all we have. (2026-08-19)
  if (!_boardOSVersion && _boardOSReason && selectedPort && selectedPortIsProffieboard) {
    // Each line names the way out, not just the fault. Same rule as the
    // empty-filter state in ui-conventions.md: say so, and offer the way out.
    // Ports ARE polled - every 4.5s in main (_pollPortsNow) - but the poll builds a
    // signature from the port PATHS and emits ports:changed only when that differs.
    // SerialPort.list() reports COM6 whether or not another process holds it open,
    // so the signature never moves and the poller correctly sees nothing. Releasing
    // a port from another program is therefore invisible to us, and the user has to
    // ask. Without naming the button a correct message dead-ends.
    // Deliberately NOT solved by probing on a timer: the probe is not passive - it
    // opens the port and writes to it, holding it for up to 2.5s - so a poller would
    // periodically seize the port the user may want for the Serial Monitor.
    // Ryan, 2026-08-19, on leaving it manual: "it's a very rare case."
    // monitor-open is the exception: closing the monitor re-probes on its own.
    // Short sentences rather than one clause-chain: this sits under a target line
    // that is already a mouthful, and each fact lands on its own. Also keeps dashes
    // out of a shipped UI string, which the keep-tells-out rule covers alongside
    // commit messages and public docs.
    const RETRY = 'Use ↺ next to Detected to retry.';
    const CANT  = "Could not read the board's ProffieOS.";
    const why = {
      'monitor-open': `${CANT} The Serial Monitor has the port. Close it and the check runs again.`,
      'timeout':      `${CANT} The board did not answer. ${RETRY}`,
      'open-failed':  `${CANT} Another program may have the port. ${RETRY}`,
      'write-failed': `${CANT} ${RETRY}`,
      'no-port':      `${CANT} ${RETRY}`,
    }[_boardOSReason] || `${CANT} ${RETRY}`;
    notes.push(why);
  }
  if (mismatch || (_boardOSVersion && !tree)) {
    // BUILT, not "installed" and not "flashed". The board prints `Installed:`, but
    // ProffieOS defines it as `const char install_time[] = __DATE__ " " __TIME__`
    // (common/common.h:19) — COMPILE-time macros. It is the build timestamp of the
    // firmware, not when anyone put it on the board. Ryan's own numbers said so
    // before the source did: board 10:29:12, his compile 10:29, his flash 10:30.
    // ProffieOS uses it as a build identity itself, invalidating saved presets via
    // `f->Expect(install_time)` (common/config_file.h:108).
    // "installed" is also already taken in this app and means "present on the
    // computer" — see ui-conventions.md. "built" matches what the target line
    // already says ("last built on ProffieOS 6.9") and what @jmt:compiled records.
    // already taken in this app and means something else: whether a ProffieOS tree
    // is present on the COMPUTER ("INSTALLED VERSIONS", "No versions installed",
    // "which isn't installed"). Both meanings appeared in one tooltip on
    // 2026-08-19 and Ryan caught the collision. "Flashed" is the community's word
    // for putting firmware on a board and matches @jmt:flashed, which is the same
    // event recorded from our side — so the eventual comparison reads straight.
    // The install date rides on the same sentence: both are facts about the board
    // in front of you, and it is what turns "a v6.9 board" into "THIS board, flashed
    // at 10:29" - the thing a version alone can never tell you when several configs
    // build against the same ProffieOS. Omitted silently when the board did not
    // print one, rather than saying 'unknown' about something nobody asked.
    notes.push(_boardInstalled
      ? `JMT Studio detected ProffieOS ${_boardOSVersion} on the connected board, built ${_boardInstalled}.`
      : `JMT Studio detected ProffieOS ${_boardOSVersion} on the connected board.`);
    // Naming the mismatch answers "do these match?" and drops the data. What
    // the user wants next is to switch to a tree that DOES match, and folder
    // names do not carry the version — three installed trees can all be v8.10.
    // _osVersionMap is the only thing that knows which is which, and it is
    // already loaded here, which is what makes the comparison above possible.
    // So this is a filter over a map in hand, not a new lookup. (2026-08-19)
    // Guarded on the map EXISTING, not just on it having matches: when the load
    // failed it is null, and "no installed version is v7.15" would then be a
    // confident claim about something unread. No map means no sentence.
    if (_osVersionMap) {
      const matches = Object.keys(_osVersionMap)
        .filter(folder => _osVersionMap[folder] === _boardOSVersion);
      if (matches.length) {
        notes.push(`You have ${_boardOSVersion} installed as: ${matches.join(', ')}.`);
      } else {
        // Two lines, two subjects: this one is about the BOARD's version, the
        // config-was-written-for line below is about the CONFIG's. They usually
        // differ and both earn their place. When they name the SAME version they
        // collapse into one fact stated twice, and the other line says it better
        // - it names what to do about it. So yield to it. (Ryan, 2026-08-19.)
        // Compared on the version number rather than the string, because one side
        // is a reported version ("v6.9") and the other a folder name
        // ("ProffieOS 6.9").
        const _num = v => (String(v || '').match(/(\d+\.\d+[\w.\-]*)/) || [])[1] || null;
        const boardNum  = _num(_boardOSVersion);
        const configNum = _num(window._configOsVersionMissing);
        const saidBelow = !!(boardNum && configNum && boardNum === configNum);
        // Silence with nothing else to say leaves a red field and a detected
        // version with no way forward, which is the dead end this note removes.
        if (!saidBelow) notes.push(`You have no ${_boardOSVersion} installed.`);
      }
    }
  }
  // The config named a version that is not installed, so it is building against
  // something it did not ask for. Same rule as above: no "it will build against
  // X instead" - the target line already said so.
  // NOT gated on a selection any more. Since 2026-08-19 an unhonoured request
  // leaves the dropdown EMPTY, so requiring `name` dropped this line in the exact
  // state it exists to describe — the one where nothing is selected because the
  // config asked for something absent.
  if (window._configOsVersionMissing && !isVersionSentinel(name)) {
    notes.push(`This config was written for ${window._configOsVersionMissing}, which isn't installed.`);
  }
  // Single newline. These are short lines about one field, not paragraphs of
  // prose, and blank lines between them made a three-item tooltip read as a
  // document. (2026-08-15)
  sel.title = notes.join('\n');
}
// Exported so updateChangedIndicators can ask for a repaint instead of writing
// sel.title itself, which is what made two owners of one property.
window.applyOSVersionSignal = applyOSVersionSignal;

window.refreshOSVersionSignal = applyOSVersionSignal;
window.reloadOSVersionMap     = loadOSVersionMap;

// ── ProffieOS version ──────────────────────────────────
function onOsVersionChange() {
  // IPC selectVersion is called by index.html's change handler.
  // Here we only handle compile-state invalidation.
  if (compileSuccess) {
    compileSuccess = false;
    setFlashEnabled(false);
    setStatus('compile', 'warn', 'OS version changed — recompile needed');
  }
  cacheCheckPending = true;
  updateCompileButton();
  applyOSVersionSignal();
  checkCacheForConfig('OS version changed — recompile needed');
  // Drop the previously-loaded ArgumentName slot map so the next lazy load
  // (when the user opens Advanced) pulls the new version's enum. Don't refetch
  // here — the enum isn't needed unless the user actually opens Advanced or
  // hovers a tooltip, so saving the IPC keeps the version-switch snappy.
  window.proffieArgs?.invalidateSlotMap?.();
}

// ── Expose init ────────────────────────────────────────
window.initBuildPanel           = initBuildPanel;
window.refreshPorts             = refreshPorts;
window.clearBuildLog            = clearLog;
// Exposed so other panels (e.g. JMT add-on apply in versionsPanel) can trigger the
// same recheck that the OS version dropdown does — invalidates compileSuccess and
// reruns the cache check against the now-different folder hash.
window.onOsVersionChange        = onOsVersionChange;
// Re-validate the cached compile state when the user returns to the Config Manager
// (from another tab, or after window focus returns to JMT Studio). Other tabs can
// touch sources we care about — Style Library edits change my_styles.h (affects
// configHash), OS Versions can apply JMT add-ons (affects buildPkgHash). The cache
// check uses fresh inputs; if anything changed, checkCacheForConfig miss-path
// downgrades compileSuccess and shows "recompile needed". No-op when not currently
// claiming a valid build (nothing to re-validate).
window.recheckOnConfigReturn = () => {
  if (!compileSuccess) return;
  checkCacheForConfig('Source changed — recompile needed');
};
window.resetCompileState        = () => {
  compileSuccess = false;
  setFlashEnabled(false);
  setStatus('compile', 'warn', 'Cache cleared — recompile needed');
  updateCompileButton();
};
// Used by `+ New` / Open to scrub stale compile + flash status that belonged
// to the previous file. Without this, the status bar carries "Flash successful"
// (or any other prior terminal state) into the freshly-loaded blank/template
// config, which misrepresents what's actually been done with the new content.
window.resetBuildStatusForFileLoad = () => {
  compileSuccess = false;
  setFlashEnabled(false);
  setStatus('compile', '', 'Not compiled');
  setStatus('flash',   '', 'Not flashed');
  updateCompileButton();
};
window.getToolchainReady        = () => toolchainReady;
window.resetToolchainStatus     = () => {
  toolchainReady = false;
  // Same single-dominant-signal pattern as the toolchain init flow: red dot,
  // accurate message, secondary indicators hidden (they can't be acted on
  // until a ProffieOS version is imported/downloaded, so they'd just be
  // visual noise).
  setStatus('toolchain', 'error', 'No ProffieOS installed.');
  ['port', 'compile', 'flash'].forEach(t => {
    const item = document.getElementById(`bp-status-${t}-item`);
    if (item) item.style.display = 'none';
  });
  const getBtn = document.getElementById('bp-btn-get-proffieos');
  if (getBtn) getBtn.style.display = '';
  updateCompileButton();
};
window.checkCacheForConfig      = checkCacheForConfig;
window.updateUsbChangedIndicator  = updateUsbChangedIndicator;
window.updatePortChangedIndicator = updatePortChangedIndicator;
window.setSelectedUsb      = (usb) => {
  if (!usb) return;
  selectedUsb = usb;
  const sel = el('bp-usb-select');
  if (sel) sel.value = usb;
  updateUsbChangedIndicator();
  window._resetMassStorageDecline?.(); // config load / mode set clears the SD decline state
};

// ── Dynamic-speed compile bench (dev/test) ─────────────
// Console helper for the "fast when you can, slower when you need it" research.
// Measures real compile time + flash/RAM fit for the CURRENTLY OPEN config
// across optimization levels, cache-bypassed. From the DevTools console:
//   await jmtBench()                       // defaults to ['os','o2']
//   await jmtBench(['os','o1','o2','o3'])  // full sweep
// Each run also appends a line to local/compile-metrics.jsonl. Every level is a
// full ProffieOS compile, so a multi-level sweep takes several minutes; the
// Abort button stops it after the current level.
window.jmtBench = async (optList = ['os', 'o2']) => {
  if (!selectedFqbn) { console.warn('[jmtBench] No board selected — pick a board first.'); return; }
  const content = window.getEditorContent();
  console.log(`[jmtBench] Sweeping opt=[${optList.join(', ')}] on ${selectedFqbn}. ${optList.length} full compile(s) — this takes a while...`);
  const res = await window.electronAPI.benchCompile(content, selectedFqbn, { usb: selectedUsb }, optList);
  const rows = (res.runs || []).map(r => ({
    opt: r.opt,
    ok: r.ok,
    seconds: r.durationMs != null ? +(r.durationMs / 1000).toFixed(1) : null,
    flashKB: r.flashBytes != null ? Math.round(r.flashBytes / 1024) : null,
    flashPct: r.flashPct != null ? r.flashPct : null,
    ramKB: r.ramBytes != null ? Math.round(r.ramBytes / 1024) : null,
    ramPct: r.ramPct != null ? r.ramPct : null,
    fits: r.fits,
    error: r.error || '',
  }));
  console.table(rows);
  return res;
};

// ── LTO A/B (the lever for a fit-constrained config) ───
// When you're already tight on flash, the opt-level knob can't move (dropping
// -Os overflows). LTO can: it's a big slice of compile wall-clock, and turning
// it off trades binary size (which you may have to spare) for speed. This runs
// the CURRENTLY OPEN config twice — LTO on, then off — cache-bypassed, and
// reports how much time LTO-off saves and whether the (larger) binary still
// fits flash. Two full compiles, so it takes a while. From the DevTools console:
//   await jmtBenchLto()
window.jmtBenchLto = async () => {
  if (!selectedFqbn) { console.warn('[jmtBenchLto] No board selected — pick a board first.'); return; }
  const content = window.getEditorContent();
  const runs = [];
  for (const useLto of [true, false]) {
    console.log(`[jmtBenchLto] compiling with LTO ${useLto ? 'ON' : 'OFF'} — full compile, hang tight...`);
    const r = await window.electronAPI.compile(content, selectedFqbn, { usb: selectedUsb, bench: true, lto: useLto });
    const flashMax = r.flashMax || 507904;
    runs.push({
      lto: useLto ? 'on' : 'off',
      ok: !!r.ok,
      minutes: r.durationMs != null ? +(r.durationMs / 60000).toFixed(1) : null,
      flashKB: r.flashBytes != null ? Math.round(r.flashBytes / 1024) : null,
      flashPct: r.flashPct != null ? r.flashPct : null,
      flashFits: r.flashBytes != null ? r.flashBytes <= flashMax : null,
      error: r.error || '',
    });
  }
  console.table(runs);
  const [on, off] = runs;
  if (on.minutes && off.minutes) {
    const saved = +(on.minutes - off.minutes).toFixed(1);
    const pct = on.minutes ? Math.round(100 * saved / on.minutes) : 0;
    console.log(`[jmtBenchLto] LTO off saved ${saved} min (${pct}%). Flash: on=${on.flashPct}% → off=${off.flashPct}%  ·  still fits flash? ${off.flashFits}`);
  }
  return runs;
};

// One-shot: a single LTO-OFF compile of the current config, cache-bypassed.
// Faster than jmtBenchLto (one compile, not two) — compare its minutes/flash to
// your known LTO baseline (the 17:49 run). Picks up any addon changes since it
// recompiles against the current ProffieOS version. From the DevTools console:
//   await jmtNoLto()
window.jmtNoLto = async () => {
  if (!selectedFqbn) { console.warn('[jmtNoLto] No board selected — pick a board first.'); return; }
  console.log('[jmtNoLto] compiling with LTO OFF — full compile, hang tight...');
  const r = await window.electronAPI.compile(window.getEditorContent(), selectedFqbn, { usb: selectedUsb, bench: true, lto: false });
  const flashMax = r.flashMax || 507904;
  const out = {
    ok: !!r.ok,
    minutes: r.durationMs != null ? +(r.durationMs / 60000).toFixed(1) : null,
    flashKB: r.flashBytes != null ? Math.round(r.flashBytes / 1024) : null,
    flashPct: r.flashPct != null ? r.flashPct : null,
    flashFits: r.flashBytes != null ? r.flashBytes <= flashMax : null,
    error: r.error || '',
  };
  console.table([out]);
  console.log(`[jmtNoLto] ${out.minutes} min · flash ${out.flashPct}% · fits flash? ${out.flashFits}  (compare vs your ~17.8 min LTO baseline)`);
  return out;
};