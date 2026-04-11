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
let selectedFqbn              = null;
let compileSuccess      = false;   // true after successful compile this session
let cacheCheckPending   = false;   // true while cache check is in flight
let toolchainReady  = false;
let isBusy          = false;   // true while compile/flash running
let unsubs          = [];      // IPC listener cleanup functions
let cachedPorts = [];
let selectedUsb = 'cdc_webusb'; // default Serial + WebUSB
let compileTimerInterval  = null;
let flashTimerInterval    = null;
let waitForBoardInterval  = null;
let contentDebounceTimer  = null;
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

  // Wire buttons
  el('bp-btn-compile').addEventListener('click', doCompile);
  el('bp-btn-flash').addEventListener('click', doFlash);
  el('bp-btn-refresh-ports').addEventListener('click', refreshPorts);
  el('bp-port-select').addEventListener('change', onPortChange);
  el('bp-log-toggle').addEventListener('click', toggleLog);
  el('bp-log-clear').addEventListener('click', clearLog);
  document.getElementById('input-board').addEventListener('change', onInputBoardChange);
  el('bp-usb-select').addEventListener('change', e => {
    selectedUsb = e.target.value;
    updateUsbChangedIndicator();
    checkCacheForConfig();
  });
  document.getElementById('bm-close').addEventListener('click', () => {
    stopWaitForBoard();
    document.getElementById('build-modal').style.display = 'none';
  });
  document.getElementById('bm-abort').addEventListener('click', async () => {
    document.getElementById('bm-abort').disabled = true;
    document.getElementById('bm-abort').textContent = 'Aborting...';
    await window.electronAPI.abortCompile();
  });
  document.getElementById('bm-retry').addEventListener('click', () => {
    document.getElementById('build-modal').style.display = 'none';
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
    appendLog('No board selected. Choose a board from the Board dropdown.', true);
    return;
  }

  const content = window.getEditorContent();
  if (!content || content.trim() === '') {
    appendLog('Cannot compile: editor is empty.', true);
    setStatus('compile', 'error', 'No config loaded');
    return;
  }

  // Save to original location first
  await window.doSave();

  showBuildModal('⚙ Compiling...');
  setBusy(true);
  clearLog();
  compileSuccess = false;
  setFlashEnabled(false);
  setStatus('compile', 'pending', 'Compiling...');

  const result = await window.electronAPI.compile(content, selectedFqbn, { usb: selectedUsb });
  setBusy(false);
  if (result.ok) {
    compileSuccess = true;
    setFlashEnabled(!!selectedPort);
    updateCompileButton();
  }
}

// ── Flash ──────────────────────────────────────────────
async function doFlash() {
  if (isBusy) return;
  if (!compileSuccess) {
    appendLog('Compile first before flashing.', true);
    return;
  }
  if (!selectedPort) {
    appendLog('No port selected.', true);
    return;
  }

  // Reuse modal in flash mode
  stopCompileTimer();
  document.getElementById('bm-title').textContent = '⚡ Flashing...';
  document.getElementById('bm-title').style.color = '#eee';
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-close').style.display = 'none';
  document.getElementById('build-modal').style.display = 'flex';
  startFlashTimer();
  setBarMode('flash');
  window._isFlashing = true;

  setBusy(true);
  setStatus('flash', 'pending', `Flashing on ${selectedPort}...`);

  await window.electronAPI.flash(selectedPort, selectedFqbn);
  setBusy(false);
}

// ── Port detection ─────────────────────────────────────
async function refreshPorts() {
  const btn = el('bp-btn-refresh-ports');
  btn.style.animation = 'spin 0.7s linear infinite';
  const result = await window.electronAPI.getRecommendedPort();
  btn.style.animation = '';

  const portSelect = el('bp-port-select');
  portSelect.innerHTML = '';

  if (!result.ok || result.ports.length === 0) {
    portSelect.innerHTML = '<option value="">No ports detected</option>';
    selectedPort = null;
    selectedPortIsProffieboard = false;
    updateBoardDisplay('');
    setStatus('port', 'error', 'No device detected');
    setFlashEnabled(false);
    return;
  }

  // Only show Proffieboard ports — fall back to all if none detected
  const displayPorts = result.proffieports.length > 0
    ? result.proffieports
    : result.ports;

  displayPorts.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = p.path;
    portSelect.appendChild(opt);
  });

  cachedPorts = result.ports;

  if (result.autoSelected && result.port) {
    portSelect.value = result.port.path;
    selectedPort = result.port.path;
    selectedPortIsProffieboard = true;
    const detectedName = detectedBoardName(result.port.variants);
    updateBoardDisplay(detectedName);
    autoSelectMetaBoard(detectedName);
    setStatus('port', 'ok', `Proffieboard on ${result.port.path}`);
  } else if (result.proffieports.length > 1) {
    const lastPort   = window.getLastPort ? window.getLastPort() : null;
    const preferred  = lastPort ? result.proffieports.find(p => p.path === lastPort) : null;
    if (preferred) {
      portSelect.value = preferred.path;
      selectedPort = preferred.path;
      selectedPortIsProffieboard = true;
      const detectedName = detectedBoardName(preferred.variants);
      updateBoardDisplay(detectedName);
      autoSelectMetaBoard(detectedName);
      setStatus('port', 'ok', `Proffieboard on ${preferred.path}`);
    } else {
      portSelect.value = '';
      selectedPort = null;
      selectedPortIsProffieboard = false;
      updateBoardDisplay('');
      setStatus('port', 'warn', `${result.proffieports.length} Proffieboards — select port`);
    }
  } else {
    // Non-Proffieboard port — show in dropdown but don't allow flash
    portSelect.value = displayPorts[0].path;
    selectedPort = displayPorts[0].path;
    selectedPortIsProffieboard = false;
    updateBoardDisplay('');
    setStatus('port', 'warn', result.message);
  }

  updatePortChangedIndicator();
  // After FQBN is resolved, check if a valid cache exists for the current config
  if (!compileSuccess) await checkCacheForConfig();
}

// Returns the best human-readable board name from a variants array
function detectedBoardName(variants) {
  if (!variants || variants.length === 0) return '';
  const sorted = [...variants].sort((a, b) => (b.boardName.includes('V3') ? 1 : 0) - (a.boardName.includes('V3') ? 1 : 0));
  return sorted[0].boardName.replace(/^Serial Port \(USB\)\s*/i, '').trim();
}

// Updates the read-only toolbar board display
function updateBoardDisplay(name) {
  const disp = el('bp-board-display');
  if (disp) disp.value = name || '';
}

function updateUsbChangedIndicator() {
  const baseline = window.getBaselineUsb ? window.getBaselineUsb() : null;
  el('bp-usb-select').classList.toggle('field-changed',
    baseline !== null && selectedUsb !== baseline);
}

function updatePortChangedIndicator() {
  const lastPort = window.getLastPort ? window.getLastPort() : null;
  el('bp-port-select').classList.toggle('field-changed',
    lastPort !== null && selectedPort !== null && selectedPort !== lastPort);
}

// Auto-selects the meta bar board dropdown if it is currently empty
function autoSelectMetaBoard(boardName) {
  if (!boardName) return;
  const sel = document.getElementById('input-board');
  if (!sel || sel.value) return; // already selected — don't override user choice
  const clean = boardName.replace(/^Serial Port \(USB\)\s*/i, '').trim().toLowerCase();
  const opt = Array.from(sel.options).find(o =>
    o.value && (o.value.toLowerCase().includes(clean) || clean.includes(o.value.toLowerCase()))
  );
  if (opt) {
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
  }
}

function onPortChange(e) {
  selectedPort = e.target.value || null;
  const port = selectedPort ? cachedPorts.find(p => p.path === selectedPort) : null;
  selectedPortIsProffieboard = port ? port.isProffieboard : false;
  updatePortChangedIndicator();
  if (!selectedPort) {
    updateBoardDisplay('');
    setFlashEnabled(false);
    setStatus('port', 'error', 'No port selected');
    return;
  }
  if (port) {
    const name = detectedBoardName(port.variants);
    updateBoardDisplay(port.isProffieboard ? name : '');
    if (port.isProffieboard) autoSelectMetaBoard(name);
    setStatus('port', port.isProffieboard ? 'ok' : 'warn',
      port.isProffieboard ? `Proffieboard on ${selectedPort}` : `Port: ${selectedPort}`);
  }
  setFlashEnabled(selectedPortIsProffieboard && compileSuccess);
}

// Driven by the meta bar board <select> — this is the single source of truth for selectedFqbn
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

function onBuildStatus({ type, ok, message }) {
  if (type === 'toolchain') {
    toolchainReady = ok;
    setStatus('toolchain', ok ? 'ok' : 'error', message);
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

function onBuildDone({ type, ok, error, aborted, retriable }) {
  if (type === 'compile') {
    if (ok) {
      compileSuccess = true;
      setFlashEnabled(!!selectedPort);
      updateCompileButton();
      if (window.setCompiledTimestamp) window.setCompiledTimestamp();
      startWaitForBoard();
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
    if (ok && window.setFlashedTimestamp) window.setFlashedTimestamp(selectedPort);
    finishBuildModal(ok,
      ok ? '✓ Flash Complete' : '✗ Flash Failed',
      ok ? 'Firmware uploaded successfully.' : error,
      { retriable: !!retriable }
    );
    if (!ok && error) appendLog(`\n⚠ ${error}`, true);
  }
}

// ── Build modal ────────────────────────────────────────
function showBuildModal(title) {
  const modal = document.getElementById('build-modal');
  modal.style.display = 'flex';
  document.getElementById('bm-title').textContent = title;
  document.getElementById('bm-title').style.color = '#eee';
  document.getElementById('bm-log').innerHTML = '';
  document.getElementById('bm-status').textContent = '';
  document.getElementById('bm-close').style.display = 'none';
  document.getElementById('bm-retry').style.display = 'none';
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
    bar.style.background = '#025192';
  }
  else if (mode === 'success') { bar.classList.add('bm-bar-success'); bar.style.left = '0'; }
  else if (mode === 'error')   { bar.classList.add('bm-bar-error');   bar.style.left = '0'; }
}

function stopWaitForBoard() {
  if (waitForBoardInterval) {
    clearInterval(waitForBoardInterval);
    waitForBoardInterval = null;
  }
}

function startWaitForBoard() {
  // Clear stale port state immediately — board must be verified before flash is allowed
  selectedPort = null;
  selectedPortIsProffieboard = false;
  setFlashEnabled(false);

  stopCompileTimer();
  document.getElementById('bm-title').textContent = '✓ Compile Successful';
  document.getElementById('bm-title').style.color = '#4d4';
  document.getElementById('bm-status').textContent = 'Connect a board to flash...';
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-close').style.display = 'inline-block';
  setBarMode('success');
  appendLog('\n✓ Firmware ready. Waiting for board...', false);

  async function pollForBoard() {
    if (!compileSuccess) { stopWaitForBoard(); return; }
    const result = await window.electronAPI.getRecommendedPort();
    if (result.ok && result.autoSelected && result.port) {
      stopWaitForBoard();
      selectedPort = result.port.path;
      selectedPortIsProffieboard = true;
      cachedPorts  = result.ports;
      const portSelect = el('bp-port-select');
      portSelect.innerHTML = `<option value="${result.port.path}">${result.port.path}</option>`;
      portSelect.value = result.port.path;
      setFlashEnabled(true);
      updatePortChangedIndicator();
      const name = detectedBoardName(result.port.variants);
      updateBoardDisplay(name);
      autoSelectMetaBoard(name);
      setStatus('port', 'ok', `Proffieboard on ${result.port.path}`);
      document.getElementById('bm-status').textContent = 'Board detected — flashing...';
      setTimeout(() => doFlash(), 1200);
    }
  }

  // Check immediately (handles board-was-connected case), then poll every 2s
  pollForBoard();
  waitForBoardInterval = setInterval(pollForBoard, 2000);
}

function finishBuildModal(success, title, statusMsg, { retriable = false } = {}) {
  stopCompileTimer();
  stopFlashTimer();
  document.getElementById('bm-title').textContent = title;
  document.getElementById('bm-title').style.color = success ? '#4d4' : '#e44';
  document.getElementById('bm-status').textContent = statusMsg || '';
  document.getElementById('bm-abort').style.display = 'none';
  document.getElementById('bm-retry').style.display = retriable ? 'inline-block' : 'none';
  document.getElementById('bm-close').style.display = 'inline-block';
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

function openLog() {
  const body = el('bp-log-body');
  const tog  = el('bp-log-toggle');
  body.classList.add('open');
  tog.textContent = '▲ Build Output';
}

function toggleLog() {
  const body = el('bp-log-body');
  const tog  = el('bp-log-toggle');
  const open = body.classList.toggle('open');
  tog.textContent = open ? '▲ Build Output' : '▼ Build Output';
}

// ── UI helpers ─────────────────────────────────────────
function setBusy(busy) {
  isBusy = busy;
  el('bp-btn-compile').disabled = busy || !selectedFqbn || compileSuccess || !window._currentFilePath || cacheCheckPending;
  el('bp-btn-flash').disabled   = busy || !compileSuccess || !selectedPort || !selectedPortIsProffieboard;
  el('bp-btn-refresh-ports').disabled = busy;
  el('bp-port-select').disabled = busy;
}

function updateCompileButton() {
  if (!isBusy) el('bp-btn-compile').disabled = !selectedFqbn || compileSuccess || !window._currentFilePath || cacheCheckPending;
}
window.updateCompileButton = updateCompileButton;

function setFlashEnabled(enabled) {
  el('bp-btn-flash').disabled = !enabled || !selectedPort || !selectedPortIsProffieboard || isBusy;
}

function startCompileTimer() {
  document.getElementById('bm-timer-compile').style.display = 'inline';
  document.getElementById('bm-timer-compile-val').textContent = '0:00';
  const start = Date.now();
  compileTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    document.getElementById('bm-timer-compile-val').textContent =
      `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  }, 1000);
}

function stopCompileTimer() {
  if (compileTimerInterval) { clearInterval(compileTimerInterval); compileTimerInterval = null; }
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
function setStatus(type, state, message) {
  const dot  = el(`bp-status-${type}-dot`);
  const text = el(`bp-status-${type}-text`);
  if (!dot || !text) return;

  dot.className = `bp-status-dot bp-status-${state}`;
  text.textContent = message;
}

// ── Cache check ────────────────────────────────────────
// missStatus: message to show on miss; false = don't update status on miss
async function checkCacheForConfig(missStatus) {
  if (!window.electronAPI || !window.getEditorContent) return;
  if (!selectedFqbn) return;
  const content = window.getEditorContent();
  if (!content || content.trim() === '') return;

  cacheCheckPending = true;
  updateCompileButton();

  const result = await window.electronAPI.checkCache(content, selectedFqbn, selectedUsb);
  cacheCheckPending = false;

  if (result.hit) {
    compileSuccess = true;
    setFlashEnabled(!!selectedPort);
    updateCompileButton();
    setStatus('compile', 'ok', 'Compile restored from cache');
    if (window.setCompiledTimestamp) window.setCompiledTimestamp(result.metadata.compiledAt);
  } else {
    updateCompileButton();
    if (!compileSuccess && missStatus !== false) {
      setStatus('compile', missStatus ? 'warn' : '', missStatus || 'Not compiled');
    }
  }
}

// ── Expose init ────────────────────────────────────────
window.initBuildPanel      = initBuildPanel;
window.refreshPorts        = refreshPorts;
window.checkCacheForConfig = checkCacheForConfig;
window.setSelectedUsb      = (usb) => {
  if (!usb) return;
  selectedUsb = usb;
  const sel = el('bp-usb-select');
  if (sel) sel.value = usb;
  updateUsbChangedIndicator();
};