/**
 * portDetector.js
 * Detects serial ports using arduino-cli board list.
 * This correctly identifies Proffieboards using installed board packages,
 * matching the same logic Arduino IDE uses.
 */

const { execFile } = require('child_process');
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
    const args     = ['board', 'list', '--json', '--config-file', yamlPath, '--additional-urls', BOARD_MANAGER_URL];

    execFile(cli, args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: err.message, raw: stderr });
        return;
      }
      resolve({ ok: true, raw: stdout });
    });
  });
}

// ── Parse board list JSON output ───────────────────────
// arduino-cli board list --json emits structured data; no regex needed.
function parseBoardList(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return []; }

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
    return {
      ok: true,
      autoSelected: false,
      port: null,
      ports,
      proffieports: [],
      message: ports.length === 0
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