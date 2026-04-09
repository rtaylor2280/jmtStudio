/**
 * portDetector.js
 * Detects serial ports using arduino-cli board list.
 * This correctly identifies Proffieboards using installed board packages,
 * matching the same logic Arduino IDE uses.
 */

const { execFile } = require('child_process');
const proffie      = require('./proffieos');
const path         = require('path');

// ── CLI path ───────────────────────────────────────────
function getCliPath() {
  const bin = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
  return path.join(proffie.getResourcesPath(), 'arduino-cli', bin);
}

function getArduinoDataPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'arduino-data');
}

// ── Run arduino-cli board list ─────────────────────────
function runBoardList() {
  return new Promise((resolve) => {
    const cli      = getCliPath();
    const dataPath = getArduinoDataPath();
    const yamlPath = path.join(dataPath, 'arduino-cli.yaml');
    const args     = ['board', 'list', '--config-file', yamlPath];

    execFile(cli, args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: err.message, raw: stderr });
        return;
      }
      resolve({ ok: true, raw: stdout });
    });
  });
}

// ── Parse board list output ────────────────────────────
// arduino-cli board list output format:
// Port         Protocol Type              Board Name                    FQBN                                          Core
// COM6         serial   Serial Port (USB) Proffieboard V3               proffieboard:stm32l4:Proffieboard-L433CC      proffieboard:stm32l4
// COM4         serial   Serial Port (USB) Unknown
function parseBoardList(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const ports = [];
  let current = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Match port line — starts with COM or /dev/
    const portMatch = line.match(/^(COM\d+|\/dev\/\S+)\s+(\S+)\s+(.+?)(?:\s{2,}(\S.*?))?(?:\s{2,}(\S+:\S+:\S+))?(?:\s{2,}(\S+:\S+))?\s*$/);

    if (portMatch) {
      if (current) ports.push(current);
      const boardName = portMatch[4] ? portMatch[4].trim() : 'Unknown';
      const fqbn = portMatch[5] ? portMatch[5].split(/\s+/)[0].trim() : '';
      current = {
        path:           portMatch[1].trim(),
        protocol:       portMatch[2].trim(),
        type:           portMatch[3].trim(),
        boardName,
        fqbn,
        core:           portMatch[6] ? portMatch[6].trim() : '',
        isProffieboard: false,
        variants:       []
      };
      if (boardName !== 'Unknown' && fqbn) {
        current.variants.push({ boardName, fqbn });
      }
    } else if (current && line.match(/^\s+\S/)) {
        const cols = line.trim().split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
        const fqbnIdx = cols.findIndex(c => c.includes(':') && c.split(':').length >= 3);
        if (fqbnIdx > 0) {
            const boardName = cols[fqbnIdx - 1];
            const fqbn      = cols[fqbnIdx].split(/\s+/)[0].trim();
            current.variants.push({ boardName, fqbn });
            if (boardName.toLowerCase().includes('proffieboard')) {
                current.boardName = boardName;
                current.fqbn      = fqbn;
            }
        }
    }
  }
  if (current) ports.push(current);

  // Mark Proffieboard ports
  ports.forEach(p => {
    p.isProffieboard =
      p.fqbn.includes('proffieboard') ||
      p.boardName.toLowerCase().includes('proffieboard') ||
      p.boardName.toLowerCase().includes('butterfly') ||
      p.variants.some(v =>
        v.fqbn.includes('proffieboard') ||
        v.boardName.toLowerCase().includes('proffieboard')
      );
  });

  return ports.filter(p => p.path && (p.path.startsWith('COM') || p.path.startsWith('/dev/')));
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