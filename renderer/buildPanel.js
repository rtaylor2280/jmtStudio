/**
 * buildPanel.js
 * Renderer-side logic for compile, flash, port detection, and log panel.
 * Loaded by index.html after Monaco is initialized.
 * Expects window.electronAPI and window.getEditorContent to be available.
 */

// ── State ──────────────────────────────────────────────
let selectedPort    = null;
let selectedFqbn  = null;
let compileSuccess  = false;   // true after successful compile this session
let toolchainReady  = false;
let isBusy          = false;   // true while compile/flash running
let unsubs          = [];      // IPC listener cleanup functions
let cachedPorts = [];
let selectedUsb = 'cdc_webusb'; // default Serial + WebUSB
let compileTimerInterval = null;
let flashTimerInterval   = null;
window._isFlashing = false;
window.onEditorContentChanged = () => {
  if (compileSuccess) {
    compileSuccess = false;
    setFlashEnabled(false);
    setStatus('compile', 'warn', 'Config changed — recompile needed');
  }
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
  el('bp-board-select').addEventListener('change', onBoardChange);
  el('bp-usb-select').addEventListener('change', e => { selectedUsb = e.target.value; });
  document.getElementById('bm-close').addEventListener('click', () => {
    document.getElementById('build-modal').style.display = 'none';
  });
  document.getElementById('bm-abort').addEventListener('click', async () => {
    document.getElementById('bm-abort').disabled = true;
    document.getElementById('bm-abort').textContent = 'Aborting...';
    await window.electronAPI.abortCompile();
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
    appendLog('No board selected.', true);
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
  openLog();
  compileSuccess = false;
  setFlashEnabled(false);
  setStatus('compile', 'pending', 'Compiling...');

  const result = await window.electronAPI.compile(content, selectedFqbn, { usb: selectedUsb });
  setBusy(false);
  if (result.ok) {
    compileSuccess = true;
    setFlashEnabled(true);
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
  openLog();
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
    selectedFqbn = null;
    populateBoardSelect([]);
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
    populateBoardSelect(result.port.variants || []);
    setStatus('port', 'ok', `Proffieboard on ${result.port.path}`);
  } else if (result.proffieports.length > 1) {
    portSelect.value = '';
    selectedPort = null;
    selectedFqbn = null;
    populateBoardSelect([]);
    setStatus('port', 'warn', `${result.proffieports.length} Proffieboards — select port`);
  } else {
    portSelect.value = displayPorts[0].path;
    selectedPort = displayPorts[0].path;
    populateBoardSelect(displayPorts[0].variants || []);
    setStatus('port', 'warn', result.message);
  }
}

function populateBoardSelect(variants) {
  const boardSelect = el('bp-board-select');
  boardSelect.innerHTML = '';

  if (!variants || variants.length === 0) {
    boardSelect.innerHTML = '<option value="">Unknown</option>';
    selectedFqbn = null;
    return;
  }

  const sorted = [...variants].sort((a, b) => {
    const aV3 = a.boardName.includes('V3') ? -1 : 0;
    const bV3 = b.boardName.includes('V3') ? -1 : 0;
    return aV3 - bV3;
  });

  sorted.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.fqbn;
    opt.textContent = v.boardName;
    boardSelect.appendChild(opt);
  });

  // Try to match against loaded metadata board name
  const metaBoard = document.getElementById('input-board').value.trim().toLowerCase();
  const metaMatch = metaBoard
    ? sorted.find(v => v.boardName.toLowerCase().includes(metaBoard) ||
                       metaBoard.includes(v.boardName.toLowerCase()))
    : null;

  const selected = metaMatch || sorted[0];
  boardSelect.value = selected.fqbn;
  selectedFqbn = selected.fqbn;
  syncBoardMeta(selected.boardName);
}

function onPortChange(e) {
  selectedPort = e.target.value || null;
  if (!selectedPort) {
    selectedFqbn = null;
    populateBoardSelect([]);
    setStatus('port', 'error', 'No port selected');
    return;
  }
  const port = cachedPorts.find(p => p.path === selectedPort);
  if (port) {
    populateBoardSelect(port.variants || []);
    setStatus('port', port.isProffieboard ? 'ok' : 'warn',
      port.isProffieboard ? `Proffieboard on ${selectedPort}` : `Port: ${selectedPort}`);
  }
}

function onBoardChange(e) {
  selectedFqbn = e.target.value || null;
  const opt = el('bp-board-select').options[el('bp-board-select').selectedIndex];
  if (opt) syncBoardMeta(opt.textContent);
}

function syncBoardMeta(boardName) {
  if (!boardName) return;
  // Strip "Serial Port (USB) " prefix if present
  const clean = boardName.replace(/^Serial Port \(USB\)\s*/i, '').trim();
  const input = document.getElementById('input-board');
  if (input) input.value = clean;
  // Trigger banner/status update
  document.getElementById('input-board').dispatchEvent(new Event('input'));
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

function onBuildDone({ type, ok, error, aborted }) {
  if (type === 'compile') {
    if (ok) {
      compileSuccess = true;
      setFlashEnabled(true);
      if (window.setCompiledTimestamp) window.setCompiledTimestamp();
      if (selectedPort) {
        stopCompileTimer();
        // Don't show Close — transitioning straight to flash
        document.getElementById('bm-title').textContent = '✓ Compile Successful';
        document.getElementById('bm-title').style.color = '#4d4';
        document.getElementById('bm-status').textContent = 'Starting flash...';
        setBarMode('success');
        appendLog('\n✓ Firmware ready. Flashing...', false);
        setTimeout(() => doFlash(), 1500);
      } else {
        finishBuildModal(true, '✓ Compile Successful', 'No board connected — flash when ready.');
        appendLog('\n✓ Firmware ready. Connect board to flash.', false);
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
    if (ok && window.setFlashedTimestamp) window.setFlashedTimestamp();
    finishBuildModal(ok,
      ok ? '✓ Flash Complete' : '✗ Flash Failed',
      ok ? 'Firmware uploaded successfully.' : error
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

function finishBuildModal(success, title, statusMsg) {
  stopCompileTimer();
  stopFlashTimer();
  document.getElementById('bm-title').textContent = title;
  document.getElementById('bm-title').style.color = success ? '#4d4' : '#e44';
  document.getElementById('bm-status').textContent = statusMsg || '';
  document.getElementById('bm-abort').style.display = 'none';
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
  el('bp-btn-compile').disabled = busy;
  el('bp-btn-flash').disabled   = busy || !compileSuccess || !selectedPort;
  el('bp-btn-refresh-ports').disabled = busy;
  el('bp-port-select').disabled = busy;
}

function setFlashEnabled(enabled) {
  el('bp-btn-flash').disabled = !enabled || !selectedPort || isBusy;
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

// ── Expose init ────────────────────────────────────────
window.initBuildPanel  = initBuildPanel;
window.refreshPorts    = refreshPorts;