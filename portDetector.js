/**
 * portDetector.js
 * Detects serial ports using arduino-cli board list.
 * This correctly identifies Proffieboards using installed board packages,
 * matching the same logic Arduino IDE uses.
 */

const { spawn }    = require('child_process');
const proffie      = require('./proffieos');
const path         = require('path');

const BOARD_MANAGER_URL = 'https://profezzorn.github.io/arduino-proffieboard/package_proffieboard_index.json';

// ── CLI path ───────────────────────────────────────────
function getCliPath() {
  const platform = process.platform === 'win32' ? 'windows'
                 : process.platform === 'darwin'  ? 'mac'
                 : 'linux';
  const bin = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
  return path.join(proffie.getResourcesPath(), 'arduino-cli', platform, bin);
}

function getArduinoDataPath() {
  // Always use the prod userData path for arduino-data so installed packages are
  // shared between dev and prod builds. In dev mode, app.getPath('userData') is
  // overridden to 'jmt-studio-dev', which would be missing the board packages.
  const { app } = require('electron');
  const base = app.isPackaged
    ? app.getPath('userData')
    : path.join(app.getPath('appData'), 'jmt-studio');
  return path.join(base, 'arduino-data');
}

// ── Run arduino-cli board list ─────────────────────────
function runBoardList() {
  return new Promise((resolve) => {
    const cli      = getCliPath();
    const dataPath = getArduinoDataPath();
    const yamlPath = path.join(dataPath, 'arduino-cli.yaml');
    // On Windows, use our config file so arduino-cli finds the toolchain-installed core.
    // On Mac/Linux, omit --config-file and let arduino-cli use the system default path,
    // which correctly finds cores installed by Arduino IDE or our toolchain.
    const args = process.platform === 'win32'
      ? ['board', 'list', '--json', `--config-file=${yamlPath}`, `--additional-urls=${BOARD_MANAGER_URL}`]
      : ['board', 'list', '--json', `--additional-urls=${BOARD_MANAGER_URL}`];

    // Ensure the binary is executable on Mac/Linux (git may store without execute bit)
    if (process.platform !== 'win32') {
      try { require('fs').chmodSync(cli, 0o755); } catch {}
    }

    let stdout = '';
    let stderr = '';
    const proc = spawn(cli, args, { cwd: dataPath });
    const timer = setTimeout(() => { proc.kill(); resolve({ ok: false, error: 'board list timed out' }); }, 10000);

    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error('[portDetector] arduino-cli board list failed:', stderr);
        resolve({ ok: false, error: stderr || `exit code ${code}` });
        return;
      }
      resolve({ ok: true, raw: stdout });
    });
    proc.on('error', e => {
      clearTimeout(timer);
      console.error('[portDetector] spawn error:', e.message);
      resolve({ ok: false, error: e.message });
    });
  });
}

// ── Parse board list JSON output ───────────────────────
// arduino-cli board list --json emits structured data; no regex needed.
function parseBoardList(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { console.error('[portDetector] JSON parse failed:', raw); return []; }
  const detected = data.detected_ports || [];
  return detected.map(entry => {
    const port     = entry.port || {};
    const address  = port.address || '';
    if (!address || (!address.startsWith('COM') && !address.startsWith('/dev/'))) return null;

    const variants = (entry.matching_boards || []).map(b => ({
      boardName: b.name || '',
      fqbn:      b.fqbn || ''
    }));

    const primary =
      variants.find(v => v.fqbn.includes('proffieboard')) ||
      variants.find(v => v.boardName.toLowerCase().includes('proffieboard')) ||
      variants.find(v => v.boardName.toLowerCase().includes('butterfly')) ||
      variants[0] || { boardName: 'Unknown', fqbn: '' };

    const isProffieboard = variants.some(v =>
      v.fqbn.includes('proffieboard') ||
      v.boardName.toLowerCase().includes('proffieboard') ||
      v.boardName.toLowerCase().includes('butterfly')
    );

    return {
      path:          address,
      protocol:      port.protocol       || 'serial',
      type:          port.protocol_label || '',
      boardName:     primary.boardName   || 'Unknown',
      fqbn:          primary.fqbn        || '',
      core:          '',
      serialNumber:  (port.properties || {}).serialNumber || '',
      isProffieboard,
      variants
    };
  }).filter(Boolean);
}

// ── Linux USB presence check ───────────────────────────
// Reads /sys/bus/usb/devices without needing any group membership.
// Returns true if a Proffieboard (VID 1209, PID 6668) is visible at the USB layer.
function checkLinuxUsbPresence() {
  if (process.platform !== 'linux') return false;
  const fs = require('fs');
  try {
    const base = '/sys/bus/usb/devices';
    for (const dev of fs.readdirSync(base)) {
      try {
        const vendor = fs.readFileSync(`${base}/${dev}/idVendor`,  'utf8').trim();
        if (vendor !== '1209') continue;
        const product = fs.readFileSync(`${base}/${dev}/idProduct`, 'utf8').trim();
        if (product === '6668') return true;
      } catch {}
    }
  } catch {}
  return false;
}

// ── List ports ─────────────────────────────────────────
async function listPorts() {
  const result = await runBoardList();

  if (!result.ok) {
    // Fall back to basic serialport list if arduino-cli fails
    try {
      const { SerialPort } = require('serialport');
      const raw = await SerialPort.list();
      const ports = raw.map(p => ({
        path:           p.path,
        boardName:      p.manufacturer || 'Unknown',
        isProffieboard: false,
        protocol:       'serial',
        fqbn:           '',
        core:           ''
      }));
      return { ok: true, ports, proffieports: [], fallback: true };
    } catch (e) {
      return { ok: false, ports: [], proffieports: [], error: result.error };
    }
  }

  const ports       = parseBoardList(result.raw);
  const proffieports = ports.filter(p => p.isProffieboard);

  return { ok: true, ports, proffieports };
}

// ── Get recommended port ───────────────────────────────
async function getRecommendedPort() {
  const result = await listPorts();

  if (!result.ok) {
    return { ok: false, autoSelected: false, ports: [], message: result.error };
  }

  const { proffieports, ports } = result;

  if (proffieports.length === 0) {
    // If arduino-cli didn't detect a working Proffieboard (we're here), but a
    // Proffieboard IS visible on the USB bus, that's a permission problem on
    // Linux — the device file exists at /dev/ttyACM* but the user isn't in
    // dialout so it can't be opened. (The earlier `ports.length === 0`
    // condition broke this — arduino-cli still enumerates the device file
    // even when it can't probe it, so `ports` isn't empty in this state.)
    const linuxSerialPermissionIssue = checkLinuxUsbPresence();
    return {
      ok: true,
      autoSelected: false,
      port: null,
      ports,
      proffieports: [],
      linuxSerialPermissionIssue,
      message: linuxSerialPermissionIssue
        ? 'Proffieboard detected via USB but serial access is blocked.'
        : ports.length === 0
          ? 'No serial ports detected. Connect your Proffieboard.'
          : `No Proffieboard detected. ${ports.length} other port(s) available.`
    };
  }

  if (proffieports.length === 1) {
    return {
      ok: true,
      autoSelected: true,
      port: proffieports[0],
      ports,
      proffieports,
      message: `Proffieboard detected on ${proffieports[0].path}.`
    };
  }

  return {
    ok: true,
    autoSelected: false,
    port: null,
    ports,
    proffieports,
    message: `${proffieports.length} Proffieboards detected. Select a port.`
  };
}

module.exports = { listPorts, getRecommendedPort };