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
let selectedFqbn              = null;
let compileSuccess      = false;   // true after successful compile this session
let cacheCheckPending   = false;   // true while cache check is in flight
let toolchainReady  = false;
let isBusy          = false;   // true while compile/flash running
let unsubs          = [];      // IPC listener cleanup functions
let cachedPorts = [];
let selectedUsb = 'cdc_webusb'; // default Serial + WebUSB
let _userChosePort     = false;   // true after user manually picks a port
let _userChosenPortPath = null;   // the path they chose
let compileTimerInterval  = null;
let flashTimerInterval    = null;
let contentDebounceTimer  = null;
let _compileStartTime     = 0;

// ── Compile hint typewriter ────────────────────────────
let _hintActive          = false;
let _hintIndex           = 0;
let _hintTimeout         = null;   // initial 60s delay
let _hintTypingTimer     = null;   // setInterval for character typing
let _hintFadeTimeout     = null;   // hold-then-fade timer
let _hintNextTimeout     = null;   // gap between messages
let _hintDurationTimeout = null;   // clears last-compile duration before first hint

function _formatCompileDuration(seconds) {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} minute${m !== 1 ? 's' : ''}` : `${m}m ${s}s`;
}

function startCompileHints() {
  stopCompileHints();
  _hintActive = true;
  _hintIndex  = 0;

  const lastDuration = window.getLastCompileDuration?.();
  if (lastDuration) {
    const el = document.getElementById('bm-hint');
    if (el) {
      el.style.transition = 'none';
      el.style.opacity = '1';
      el.textContent = `Last compiled version of this config took about ${_formatCompileDuration(lastDuration)}.`;
    }
    // Clear 15s before the first hint appears
    _hintDurationTimeout = setTimeout(() => {
      const el = document.getElementById('bm-hint');
      if (el && _hintActive) { el.style.opacity = '0'; setTimeout(() => { if (el) el.textContent = ''; }, 400); }
    }, 45000);
  }

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
  const el = document.getElementById('bm-hint');
  if (el) { el.style.transition = 'none'; el.style.opacity = '0'; el.textContent = ''; }
}

function _showNextHint() {
  if (!_hintActive) return;
  const hints = (typeof COMPILE_HINTS !== 'undefined') ? COMPILE_HINTS : [];
  if (_hintIndex >= hints.length) return; // list exhausted — stop quietly

  const text = hints[_hintIndex++];
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

// ── DOM refs ───────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) els[id] = document.getElementById(id);
  return els[id];
}

// ── Init ───────────────────────────────────────────────
async function initBuildPanel() {
  // Clean up any previous listeners
  unsubs.forEach(fn => fn());
  unsubs = [];

  // Wire IPC listeners
  unsubs.push(window.electronAPI.onBuildLog(onBuildLog));
  unsubs.push(window.electronAPI.onBuildStatus(onBuildStatus));
  unsubs.push(window.electronAPI.onBuildDone(onBuildDone));
  unsubs.push(window.electronAPI.onPortsChanged(() => refreshPorts()));

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
  el('bp-log-clear').addEventListener('click', clearLog);
  wireSerialMonitor();
  document.getElementById('input-board').addEventListener('change', onInputBoardChange);
  // Seed selectedFqbn from dropdown without triggering a cache check (no file open yet)
  const _initBoardSel = document.getElementById('input-board');
  const _initBoardOpt = _initBoardSel ? _initBoardSel.options[_initBoardSel.selectedIndex] : null;
  selectedFqbn = (_initBoardOpt && _initBoardOpt.dataset.fqbn) ? _initBoardOpt.dataset.fqbn : null;
  el('bp-usb-select').addEventListener('change', e => {
    selectedUsb = e.target.value;
    updateUsbChangedIndicator();
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
    window.electronAPI.cleanupDfuSetup();
  });
  document.getElementById('bm-v1-feedback-link').addEventListener('click', e => {
    e.preventDefault();
    const subject = encodeURIComponent('JMT Studio — Proffieboard V1 Flash Feedback');
    const body    = encodeURIComponent('Hi,\n\nI just flashed a Proffieboard V1 using JMT Studio. Here\'s what happened:\n\n');
    window.electronAPI?.openExternal(`mailto:jmtstudio@jedimastertech.com?subject=${subject}&body=${body}`);
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

    if (setupBtn.dataset.phase === 'install') {
      // Phase 2: Install the downloaded file
      setupBtn.disabled    = true;
      setupBtn.textContent = 'Installing...';
      manualRow.style.display = 'none';
      document.getElementById('bm-close').style.display = 'none';
      document.getElementById('bm-status').textContent = 'Installing driver utility...';
      setBarMode('knightrider');
      appendModalLog('', false);
      appendModalLog('──────────────────────────────────', false);

      const unsub = window.electronAPI.onDfuSetupStatus(msg => appendModalLog(msg, false));
      const result = await window.electronAPI.installDfuSetup();
      unsub();

      delete setupBtn.dataset.phase;
      setupBtn.disabled = false;

      if (result.ok) {
        appendModalLog('✓ Driver installed successfully.', false);
        appendModalLog('Waiting for Windows to register the driver...', false);
        await new Promise(r => setTimeout(r, 2000));
        appendModalLog('──────────────────────────────────', false);
        startDfuWaitModal(true, _dfuRetryAutoFlash, true);
      } else {
        appendModalLog('', false);
        appendModalLog(result.error || 'Installation was cancelled or failed.', true);
        appendModalLog('Click Install DFU Tool to try again, or use a manual option below.', false);
        setupBtn.textContent = '▶ Install DFU Tool';
        setupBtn.dataset.phase = 'install';
        manualRow.style.display = 'flex';
        document.getElementById('bm-close').style.display = 'inline-block';
      }
      return;
    }

    // Phase 1: Download
    setupBtn.disabled    = true;
    setupBtn.textContent = 'Downloading...';
    manualRow.style.display = 'none';
    document.getElementById('bm-close').style.display = 'none';
    appendModalLog('', false);
    appendModalLog('──────────────────────────────────', false);

    const unsub = window.electronAPI.onDfuSetupStatus(msg => appendModalLog(msg, false));
    const result = await window.electronAPI.downloadDfuSetup();
    unsub();

    setupBtn.disabled = false;

    if (result.ok) {
      appendModalLog('✓ proffie-dfu-setup.exe downloaded.', false);
      appendModalLog('✓ SHA256 verified.', false);
      appendModalLog('', false);
      appendModalLog('Windows will ask for permission to run the installer — click Yes.', false);
      appendModalLog('Click Install DFU Tool to continue.', false);
      setupBtn.textContent = '▶ Install DFU Tool';
      setupBtn.dataset.phase = 'install';
      manualRow.style.display = 'flex';
      document.getElementById('bm-close').style.display = 'inline-block';
    } else if (result.hashMismatch) {
      appendModalLog('', false);
      appendModalLog('Downloaded file does not match our records.', true);
      appendModalLog('Verify the current hash at the official setup page:', false);
      const _hashLog = document.getElementById('bm-log');
      const _hashLink = document.createElement('a');
      _hashLink.textContent = 'pod.hubbe.net/proffieboard-setup.html';
      _hashLink.href = '#';
      _hashLink.style.cssText = 'color:#4af;text-decoration:underline;cursor:pointer;';
      _hashLink.addEventListener('click', e => {
        e.preventDefault();
        window.electronAPI.openExternal('https://pod.hubbe.net/proffieboard-setup.html#os-specific-setup');
      });
      const _hashLinkWrap = document.createElement('span');
      _hashLinkWrap.appendChild(_hashLink);
      _hashLinkWrap.appendChild(document.createTextNode('\n'));
      _hashLog.appendChild(_hashLinkWrap);
      _hashLog.scrollTop = _hashLog.scrollHeight;
      appendModalLog('', false);
      appendModalLog(`  Expected:   ${result.expected}`, false);
      appendModalLog(`  Downloaded: ${result.actual}`, false);
      appendModalLog('', false);
      appendModalLog('If the downloaded hash matches the site, you can proceed.', false);
      setupBtn.style.display = 'none';
      setupBtn.dataset.phase = 'install';
      document.getElementById('bm-install-anyway').style.display = 'inline-block';
      manualRow.style.display = 'flex';
      document.getElementById('bm-close').style.display = 'inline-block';
    } else {
      appendModalLog('', false);
      appendModalLog(result.error || 'Download failed.', true);
      appendModalLog('Try a manual option below, or check your internet connection.', false);
      setupBtn.textContent = '⬇ Download DFU Tool';
      setupBtn.style.display = 'inline-block';
      manualRow.style.display = 'flex';
      document.getElementById('bm-close').style.display = 'inline-block';
    }
  });
  document.getElementById('bm-install-anyway').addEventListener('click', () => {
    document.getElementById('bm-install-anyway').style.display = 'none';
    const setupBtn = document.getElementById('bm-dfu-setup');
    setupBtn.dataset.phase = 'install';
    setupBtn.click();
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
    window.electronAPI.openExternal(`mailto:jmtstudio@jedimastertech.com?subject=${subject}&body=${body}`);
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
  startCompileHints();
  setBusy(true);
  clearLog();
  compileSuccess = false;
  setFlashEnabled(false);
  setStatus('compile', 'pending', 'Compiling...');

  const result = await window.electronAPI.compile(content, selectedFqbn, { usb: selectedUsb });
  setBusy(false);
  if (result.ok) {
    compileSuccess = true;
    if (!isDfuMode) setFlashEnabled(selectedPortIsProffieboard && !!selectedPort); // DFU mode: onBuildDone sets flash state
    updateCompileButton();
  }
}

// ── Flash ──────────────────────────────────────────────
async function doFlash() {
  if (isDfuMode) { await doFlashDFU(); return; }

  if (isBusy) return;
  if (!compileSuccess) {
    appendLog('Compile first before flashing.', true);
    return;
  }

  // Pre-flash port check — verify board is still present
  if (!selectedPort || !selectedPortIsProffieboard) {
    showWaitForBoardInModal();
    startPortWatch('wait-flash');
    return;
  }
  const rawPorts = await window.electronAPI.listPortsRaw();
  if (!rawPorts.find(p => p.path === selectedPort)) {
    appendModalLog('Selected port disconnected — waiting for board...', true);
    showWaitForBoardInModal();
    startPortWatch('wait-flash');
    return;
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
  document.getElementById('bm-retry').style.display = 'none';
  document.getElementById('build-modal').style.display = 'flex';
  startFlashTimer();
  setBarMode('flash');
  window._isFlashing = true;
  await pauseSerialBeforeFlash();

  setBusy(true);
  setStatus('flash', 'pending', `Flashing on ${selectedPort}...`);

  await window.electronAPI.flash(selectedPort, selectedFqbn);
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
  const result = await window.electronAPI.getRecommendedPort();
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
    portSelect.value = '';
    selectedPort = null;
    selectedPortIsProffieboard = false;
    clearDetectedBoard();
    setStatus('port', 'warn', result.message);
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
    setFlashEnabled(selectedPortIsProffieboard && !!selectedPort);
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
  const usbEl    = el('bp-usb-select');
  usbEl.classList.toggle('field-changed', changed);
  usbEl.title = changed
    ? `USB mode changed since last compile (was: ${USB_LABELS[baseline] || baseline}) — recompile before flashing`
    : '';
}

function updatePortChangedIndicator() {
  const lastPort = window.getLastPort ? window.getLastPort() : null;
  const changed  = lastPort !== null && selectedPort !== null && selectedPort !== lastPort;
  const portEl   = el('bp-port-select');
  portEl.classList.toggle('field-changed', changed);
  portEl.title = changed
    ? `Port changed since last compile (was: ${lastPort}) — verify the correct board is connected`
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
  if (selectedFqbn) { cacheCheckPending = true; checkCacheForConfig(); }
}

// Clears the Detected field when no Proffieboard is on the selected port.
function clearDetectedBoard() {
  selectedPortSN = null;
  updateBoardDisplay('');
  window.updateSnIndicator?.();
  updateCompileButton();
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
    setStatus('port', 'error', 'No port selected');
    return;
  }
  if (port) {
    if (port.isProffieboard) applyDetectedBoard(port);
    else { clearDetectedBoard(); setStatus('port', 'warn', `Port: ${selectedPort}`); }
  }
  setFlashEnabled(selectedPortIsProffieboard && compileSuccess);
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

// ── IPC event handlers ─────────────────────────────────
function onBuildLog({ line, isError }) {
  appendLog(line, isError);
  appendModalLog(line, isError);
}

function onBuildStatus({ type, ok, needsProffieOS, message }) {
  if (type === 'toolchain-setup') {
    setStatus('toolchain', 'pending', 'Setting up build tools...');
    openLog();
    const notice = document.getElementById('bp-setup-notice');
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

function onBuildDone({ type, ok, error, aborted, retriable, needsDfuDriver, sourceChanged }) {
  if (type === 'compile') {
    if (ok) {
      compileSuccess = true;
      updateCompileButton();
      const durationSec = _compileStartTime ? Math.round((Date.now() - _compileStartTime) / 1000) : null;
      if (window.setCompiledTimestamp) window.setCompiledTimestamp(undefined, durationSec);
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
          document.getElementById('bm-status').textContent = 'DFU device ready — flashing...';
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
        document.getElementById('bm-status').textContent = 'Board connected — flashing...';
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
    if (!ok) {
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
      lastFlashedSN = selectedPortSN;
      if (window.setFlashedTimestamp) window.setFlashedTimestamp(selectedPort, selectedPortSN);
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
  _dfuSetupBtn.textContent = '⬇ Download DFU Tool';
  delete _dfuSetupBtn.dataset.phase;
  document.getElementById('bm-install-anyway').style.display = 'none';
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
  document.getElementById('bm-status').textContent = 'Board detected — flashing...';
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

  document.getElementById('bm-status').textContent = 'Multiple Proffieboards detected — select one:';
  document.getElementById('bm-board-select-wrap').style.display = 'flex';
}

function finishBuildModal(success, title, statusMsg, { retriable = false, isFlash = false } = {}) {
  stopCompileHints();
  stopPortWatch();
  stopCompileTimer();
  stopFlashTimer();
  document.getElementById('bm-title').textContent = title;
  document.getElementById('bm-title').style.color = success ? 'var(--c-success-text)' : 'var(--c-danger-text)';
  document.getElementById('bm-status').textContent = statusMsg || '';
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-dfu-setup').style.display = 'none';
  document.getElementById('bm-install-anyway').style.display = 'none';
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
function setBusy(busy) {
  isBusy = busy;
  el('bp-btn-compile').disabled = busy || !selectedFqbn || compileSuccess || !window._currentFilePath || cacheCheckPending;
  if (isDfuMode) {
    el('bp-btn-flash').disabled = busy || !compileSuccess;
  } else {
    el('bp-btn-flash').disabled = busy || !compileSuccess || !selectedPort || !selectedPortIsProffieboard;
  }
  el('bp-btn-refresh-ports').disabled = busy;
  el('bp-port-select').disabled = busy;
}

function updateCompileButton() {
  const version = document.getElementById('input-version')?.value;
  const hasVersion = version && version !== '__add_version__';
  if (!isBusy) el('bp-btn-compile').disabled = !selectedFqbn || !hasVersion || compileSuccess || !window._currentFilePath || cacheCheckPending;
}
window.updateCompileButton = updateCompileButton;
window.getLastFlashedSN    = () => lastFlashedSN;

function setFlashEnabled(enabled) {
  if (isDfuMode) {
    el('bp-btn-flash').disabled = !enabled || isBusy;
  } else {
    el('bp-btn-flash').disabled = !enabled || !selectedPort || !selectedPortIsProffieboard || isBusy;
  }
}

function startCompileTimer() {
  _compileStartTime = Date.now();
  document.getElementById('bm-timer-compile').style.display = 'inline';
  document.getElementById('bm-timer-compile-val').textContent = '0:00';
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
  // Callers (board change, USB change, OS version change, etc.) pre-set cacheCheckPending=true
  // to disable Compile immediately. If this run can't proceed (no API, no FQBN, empty editor),
  // we must clear that flag here — otherwise Compile stays disabled forever after a + New flow
  // where loadContent dispatches a board='' change while content/FQBN are still unset.
  const content = (window.electronAPI && window.getEditorContent) ? window.getEditorContent() : null;
  const canCheck = !!(window.electronAPI && selectedFqbn && content && content.trim());

  if (!canCheck) {
    if (cacheCheckPending) { cacheCheckPending = false; updateCompileButton(); }
    return;
  }

  cacheCheckPending = true;
  updateCompileButton();

  let result;
  try {
    result = await window.electronAPI.checkCache(content, selectedFqbn, selectedUsb);
  } catch {
    cacheCheckPending = false;
    updateCompileButton();
    return;
  }
  cacheCheckPending = false;

  if (result.hit) {
    compileSuccess = true;
    setFlashEnabled(isDfuMode ? compileSuccess : (selectedPortIsProffieboard && !!selectedPort));
    updateCompileButton();
    setStatus('compile', 'ok', 'Compile restored from cache');
    if (window.setCompiledTimestamp) window.setCompiledTimestamp(result.metadata.compiledAt);
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
    document.getElementById('bm-install-anyway').style.display = 'none';
    document.getElementById('bm-manual-row').style.display = 'none';
    document.getElementById('bm-dfu-note').style.display = 'none';
    document.getElementById('bm-retry').style.display = 'none';
    document.getElementById('bm-close').style.display = 'none';
    document.getElementById('bm-abort').style.display = 'inline-block';
    setBarMode('knightrider');
    appendModalLog('Verifying DFU connection...', false);
    document.getElementById('bm-status').textContent = 'Verifying connection...';
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

    if (isRetry && dfuResult.found && !dfuResult.accessible) {
      // Device found but driver not yet active — give Windows up to 10s to finish applying it
      if (!notAccessibleStart) notAccessibleStart = Date.now();
      if (Date.now() - notAccessibleStart > 10000) break;  // give up, show error
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
        appendModalLog('STM32 Bootloader detected but the WinUSB driver cannot access it.', false);
        appendModalLog('', false);
        appendModalLog('  Detected: STM32 Bootloader (0483:df11)', false);
        appendModalLog('', false);
        if (justInstalled) {
          appendModalLog('Unplug the board, reconnect it in Bootloader Mode, then click Try Again.', false);
          appendModalLog('If it still fails, download and reinstall the DFU Tool below.', false);
        } else {
          appendModalLog('The WinUSB driver may be missing, outdated, or installed by another tool.', false);
          appendModalLog('Download and install the DFU Tool below to fix it.', false);
        }
      } else {
        appendModalLog('A Windows driver is required to communicate with the STM32 Bootloader.', false);
        appendModalLog('Windows binds this driver per USB port — you may need to re-run this when switching ports or after some Windows updates.', false);
        appendModalLog('', false);
        appendModalLog('  Detected: STM32 Bootloader (0483:df11)', false);
        appendModalLog('', false);
        appendModalLog('JMT Studio will download the official Proffie DFU setup tool and run', false);
        appendModalLog('it unchanged. You will be asked by Windows before anything is installed.', false);
        appendModalLog('', false);
        appendModalLog('Click Download DFU Tool, or use a manual option below.', false);
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
    dfuSetupBtn.textContent = '⬇ Download DFU Tool';
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
    'Flash complete — board not yet detected. Try power cycling.';
  appendModalLog('Board not detected after restart. Try power cycling or reconnecting.', true);
}

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
  setStatus('toolchain', 'error', 'No ProffieOS versions found. Please import or download a version first.');
  ['port', 'compile', 'flash'].forEach(t => {
    const item = document.getElementById(`bp-status-${t}-item`);
    if (item) item.style.display = 'none';
  });
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
};