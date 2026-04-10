/**
 * toolchain.js
 * Manages arduino-cli: initialization, compile, and flash.
 * All operations run in the Electron main process.
 * Emits progress via a callback so main.js can forward to renderer via IPC.
 */

const path      = require('path');
const fs        = require('fs');
const { spawn } = require('child_process');
const proffie   = require('./proffieos');

// ── Abort state ───────────────────────────────────────
let _currentProc = null;
let _aborted     = false;

function clearPartialBuild(buildPath) {
  ['ProffieOS.elf', 'ProffieOS.bin', 'ProffieOS.dfu'].forEach(f => {
    const fp = path.join(buildPath, f);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
  });
}

function abort() {
  if (_currentProc) {
    _aborted = true;
    _currentProc.kill();
    _currentProc = null;
    return { ok: true };
  }
  return { ok: false, error: 'No active process to abort' };
}

// ── Constants ──────────────────────────────────────────
const CORE_ID       = 'proffieboard:stm32l4';
const CORE_VERSION  = '4.6.0';
const CLI_WIN       = 'arduino-cli.exe';
const CLI_MAC       = 'arduino-cli';

// Additional URL needed for proffieboard core
const BOARD_MANAGER_URL = 'https://profezzorn.github.io/arduino-proffieboard/package_proffieboard_index.json';

// ── CLI path resolution ────────────────────────────────
function getCliPath() {
  const bin = process.platform === 'win32' ? CLI_WIN : CLI_MAC;
  return path.join(proffie.getResourcesPath(), 'arduino-cli', bin);
}

function getArduinoDataPath() {
  // Isolated data dir inside userData so we don't pollute system Arduino install
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'arduino-data');
}

function getBuildOutputPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'build-output');
}

// ── Validation ─────────────────────────────────────────
function validateCli() {
  const cliPath = getCliPath();
  if (!fs.existsSync(cliPath)) {
    return { ok: false, error: `arduino-cli not found at:\n${cliPath}\n\nCheck that the binary is included in resources/arduino-cli/` };
  }
  return { ok: true, cliPath };
}

// ── Run arduino-cli command ────────────────────────────
/**
 * Spawns arduino-cli with given args.
 * Calls onLog(line, isError) for each line of stdout/stderr.
 * Returns promise resolving to { ok, code, stdout, stderr }
 */
function runCli(args, onLog) {
  return new Promise((resolve) => {
    const v = validateCli();
    if (!v.ok) {
      onLog(v.error, true);
      return resolve({ ok: false, code: -1, stdout: '', stderr: v.error });
    }

    const dataPath = getArduinoDataPath();
    fs.mkdirSync(dataPath, { recursive: true });

    // Inject isolated data dir and board manager URL into every command
    const fullArgs = [
      ...args,
      `--config-file=${path.join(dataPath, 'arduino-cli.yaml')}`
    ];

    onLog(`> arduino-cli ${fullArgs.join(' ')}`, false);

    const proc = spawn(v.cliPath, fullArgs, { cwd: dataPath });
    _currentProc = proc;

    let stdout = '', stderr = '';

    proc.stdout.on('data', d => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      lines.forEach(l => { stdout += l + '\n'; onLog(l, false); });
    });

    proc.stderr.on('data', d => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      lines.forEach(l => { stderr += l + '\n'; onLog(l, true); });
    });

    proc.on('close', code => {
      _currentProc = null;
      resolve({ ok: code === 0, code, stdout, stderr });
    });

    proc.on('error', e => {
      _currentProc = null;
      const msg = `Failed to start arduino-cli: ${e.message}`;
      onLog(msg, true);
      resolve({ ok: false, code: -1, stdout: '', stderr: msg });
    });
  });
}

// ── First-run: write arduino-cli config yaml ───────────
async function ensureCliConfig(onLog) {
  const dataPath  = getArduinoDataPath();
  const yamlPath  = path.join(dataPath, 'arduino-cli.yaml');

  fs.mkdirSync(dataPath, { recursive: true });

  if (!fs.existsSync(yamlPath)) {
    onLog('Writing arduino-cli config...', false);
    const yaml = [
      `board_manager:`,
      `  additional_urls:`,
      `    - ${BOARD_MANAGER_URL}`,
      `directories:`,
      `  data: "${dataPath.replace(/\\/g, '/')}"`,
      `  downloads: "${path.join(dataPath, 'staging').replace(/\\/g, '/')}"`,
      `  user: "${path.join(dataPath, 'user').replace(/\\/g, '/')}"`,
    ].join('\n');
    fs.writeFileSync(yamlPath, yaml, 'utf8');
  }
}

// ── First-run: install core if not present ─────────────
async function ensureCore(onLog) {
  const dataPath    = getArduinoDataPath();
  const hardwarePath = path.join(dataPath, 'packages', 'proffieboard', 'hardware', 'stm32l4');

  // Check for boards.txt inside any installed version — this file only exists after
  // a complete successful install. The top-level packages/proffieboard dir is not
  // a reliable check because arduino-cli creates it during core update-index.
  // Note: arduino-cli installs 4.6.0 as directory "4.6", so we check version-agnostically.
  const isInstalled = fs.existsSync(hardwarePath) &&
    fs.readdirSync(hardwarePath).some(v =>
      fs.existsSync(path.join(hardwarePath, v, 'boards.txt'))
    );

  if (isInstalled) {
    onLog(`Core ${CORE_ID}@${CORE_VERSION} already installed.`, false);
    return { ok: true };
  }

  onLog(`Installing core ${CORE_ID}@${CORE_VERSION} — this may take a few minutes on first run...`, false);
  
  // Update index first
  const update = await runCli(['core', 'update-index'], onLog);
  if (!update.ok) return { ok: false, error: 'Failed to update board index.' };

  // Install core
  const install = await runCli(['core', 'install', `${CORE_ID}@${CORE_VERSION}`], onLog);
  if (!install.ok) return { ok: false, error: `Failed to install core ${CORE_ID}@${CORE_VERSION}.` };

  onLog(`Core installed successfully.`, false);
  return { ok: true };
}

// ── Initialize toolchain ───────────────────────────────
/**
 * Call once on app startup (or on demand).
 * Ensures CLI exists and core is installed.
 * Returns { ok, error? }
 */
async function initialize(onLog) {
  onLog('Initializing toolchain...', false);

  const cliCheck = validateCli();
  if (!cliCheck.ok) return { ok: false, error: cliCheck.error };
  onLog(`arduino-cli found at: ${cliCheck.cliPath}`, false);

  const sourceCheck = proffie.validateProffieOSSource();
  if (!sourceCheck.ok) return { ok: false, error: sourceCheck.error };
  onLog(`ProffieOS v${proffie.PROFFIE_VERSION} source validated.`, false);

  await ensureCliConfig(onLog);
  const coreResult = await ensureCore(onLog);
  if (!coreResult.ok) return { ok: false, error: coreResult.error };

  onLog('Toolchain ready.', false);
  return { ok: true };
}

// ── Compile ────────────────────────────────────────────
/**
 * Stages config, then compiles ProffieOS.
 * onLog(line, isError) streams output back to renderer.
 * Returns { ok, error?, buildPath? }
 */
async function compile(configContent, fqbn, buildOptions, onLog) {
  onLog('--- Compile started ---', false);

  const usb = (buildOptions && buildOptions.usb) || 'cdc_webusb';

  const staged = proffie.stageConfig(configContent);
  if (!staged.ok) { onLog(staged.error, true); return { ok: false, error: staged.error }; }
  onLog(`Config staged to: ${staged.stagedPath}`, false);

  const sketchPath = proffie.getProffieOSRoot();
  const buildPath  = getBuildOutputPath();
  fs.mkdirSync(buildPath, { recursive: true });

  const args = [
    'compile',
    '--fqbn', `${fqbn}:usb=${usb},dosfs=sdmmc1,speed=80,opt=os,pclk=2`,
    '--build-path', buildPath,
    '--warnings', 'none',
    sketchPath
  ];

  const result = await runCli(args, onLog);

  if (result.ok) {
    onLog('--- Compile successful ---', false);
    return { ok: true, buildPath };
  } else {
    const wasAborted = _aborted;
    _aborted = false;
    if (wasAborted) {
      onLog('--- Compile aborted ---', true);
      clearPartialBuild(buildPath);
      return { ok: false, aborted: true, error: 'Compile aborted' };
    }
    onLog('--- Compile failed ---', true);
    const cleanError = extractCompileError(result.stderr + result.stdout);
    return { ok: false, error: cleanError };
  }
}

// ── Extract readable compile error ─────────────────────
function extractCompileError(raw) {
  const lines = raw.split(/\r?\n/);
  // Look for lines with 'error:' that aren't just noise
  const errorLines = lines.filter(l =>
    l.includes('error:') && !l.includes('note:') && !l.startsWith('>')
  );
  if (errorLines.length) return errorLines.slice(0, 5).join('\n');
  // Fallback: last 10 non-empty lines
  return lines.filter(Boolean).slice(-10).join('\n');
}

// ── Tools path ─────────────────────────────────────────
function getToolsPath() {
  const platform = process.platform === 'win32' ? 'windows' : 'mac';
  return path.join(proffie.getResourcesPath(), 'tools', platform);
}

function getDfuUtilPath() {
  const bin = process.platform === 'win32' ? 'dfu-util.exe' : 'dfu-util';
  return path.join(getToolsPath(), bin);
}

function getDfuSuffixPath() {
  const bin = process.platform === 'win32' ? 'dfu-suffix.exe' : 'dfu-suffix';
  return path.join(getToolsPath(), bin);
}

// ── 1200-bps touch reset ───────────────────────────────
function touchReset(port, onLog) {
  return new Promise((resolve) => {
    onLog(`Sending 1200-bps touch reset on ${port}...`, false);
    const { SerialPort } = require('serialport');
    const sp = new SerialPort({ path: port, baudRate: 1200, autoOpen: false });
    sp.open(err => {
      if (err) {
        onLog(`Touch reset open error: ${err.message}`, true);
        return resolve(false);
      }
      sp.set({ dtr: false }, () => {
        setTimeout(() => {
          sp.close(() => resolve(true));
        }, 200);
      });
    });
  });
}

// ── Wait for DFU device ────────────────────────────────
function waitForDfu(onLog, timeoutMs = 10000) {
  return new Promise((resolve) => {
    onLog('Waiting for DFU device...', false);
    const start    = Date.now();
    const dfuUtil  = getDfuUtilPath();
    const toolsDir = getToolsPath();

    const check = () => {
      const { execFile } = require('child_process');
      execFile(dfuUtil, ['-l'], { timeout: 3000, cwd: toolsDir }, (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '');
        const found  = output.includes('1209:6668') || output.includes('0483:df11');
        if (found) {
          onLog('DFU device detected.', false);
          return resolve(true);
        }
        if (Date.now() - start > timeoutMs) {
          onLog('Timed out waiting for DFU device.', true);
          return resolve(false);
        }
        setTimeout(check, 500);
      });
    };
    check();
  });
}

// ── Flash ──────────────────────────────────────────────
/**
 * Uploads compiled firmware to connected Proffieboard.
 * port: serial port string e.g. 'COM3' or '/dev/ttyUSB0'
 * onLog(line, isError) streams output back to renderer.
 * Returns { ok, error? }
 */
async function flash(port, fqbn, onLog) {
  onLog('--- Flash started ---', false);

  if (!port) {
    const msg = 'No port selected.';
    onLog(msg, true);
    return { ok: false, error: msg };
  }

  // Check build output
  const buildPath = getBuildOutputPath();
  if (!fs.existsSync(buildPath)) {
    const msg = 'No compiled firmware found. Run Compile before flashing.';
    onLog(msg, true);
    return { ok: false, error: msg };
  }

  // Find .elf file
  const elfFiles = fs.readdirSync(buildPath).filter(f => f.endsWith('.elf'));
  if (!elfFiles.length) {
    const msg = 'No .elf file found in build output. Run Compile before flashing.';
    onLog(msg, true);
    return { ok: false, error: msg };
  }

  const elfPath  = path.join(buildPath, elfFiles[0]);
  const binPath  = path.join(buildPath, 'ProffieOS.bin');
  const dfuPath  = path.join(buildPath, 'ProffieOS.dfu');
  const toolsDir = getToolsPath();

  // ── Step 1: Convert .elf to .bin ──
  onLog('Converting firmware to binary...', false);
  const dataPath = getArduinoDataPath();

  const corePath = path.join(dataPath, 'packages', 'proffieboard', 'tools', 'arm-none-eabi-gcc');
  let objcopy = null;
  if (fs.existsSync(corePath)) {
    const versions = fs.readdirSync(corePath);
    if (versions.length) {
      objcopy = path.join(corePath, versions[0], 'bin',
        process.platform === 'win32' ? 'arm-none-eabi-objcopy.exe' : 'arm-none-eabi-objcopy');
    }
  }

  if (!objcopy || !fs.existsSync(objcopy)) {
    const msg = 'arm-none-eabi-objcopy not found. Core may not be installed correctly.';
    onLog(msg, true);
    return { ok: false, error: msg };
  }

  const objcopyResult = await new Promise(resolve => {
    const { execFile } = require('child_process');
    execFile(objcopy, ['-O', 'binary', elfPath, binPath], (err) => {
      if (err) resolve({ ok: false, error: err.message });
      else resolve({ ok: true });
    });
  });

  if (!objcopyResult.ok) {
    onLog(`objcopy failed: ${objcopyResult.error}`, true);
    return { ok: false, error: objcopyResult.error };
  }
  onLog('Binary created.', false);

  // ── Step 2: Add DFU suffix ──
  onLog('Adding DFU suffix...', false);
  fs.copyFileSync(binPath, dfuPath);

  const suffixResult = await new Promise(resolve => {
    const { execFile } = require('child_process');
    execFile(getDfuSuffixPath(),
      ['-v', '0x1209', '-p', '0x6668', '-d', '0xffff', '-a', dfuPath],
      { cwd: toolsDir },
      (err) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true });
      });
  });

  if (!suffixResult.ok) {
    onLog(`dfu-suffix failed: ${suffixResult.error}`, true);
    return { ok: false, error: suffixResult.error };
  }
  onLog('DFU suffix added.', false);

  // ── Step 3: 1200-bps touch reset ──
  await touchReset(port, onLog);
  await new Promise(r => setTimeout(r, 1000));

  // ── Step 4: Wait for DFU device ──
  const dfuFound = await waitForDfu(onLog);
  if (!dfuFound) {
    const msg = 'DFU device not detected. Try pressing the reset button or reconnecting.';
    onLog(msg, true);
    return { ok: false, error: msg };
  }

  // ── Step 5: Flash via dfu-util ──
  onLog('Flashing firmware...', false);

  const flashResult = await new Promise(resolve => {
    const proc = spawn(getDfuUtilPath(), [
      '-d', '1209:6668,0483:df11',
      '-a', '0',
      '-s', '0x08000000:leave',
      '-D', dfuPath
    ], { cwd: toolsDir });

    let stdout = '', stderr = '';

    proc.stdout.on('data', d => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      lines.forEach(l => { stdout += l + '\n'; onLog(l, false); });
    });

    proc.stderr.on('data', d => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      lines.forEach(l => {
        stderr += l + '\n';
        onLog(l, l.toLowerCase().includes('error'));
      });
    });

    proc.on('close', code => resolve({ ok: code === 0, stdout, stderr }));
    proc.on('error', e => resolve({ ok: false, error: e.message }));
  });

  if (flashResult.ok) {
    onLog('--- Flash successful ---', false);
    return { ok: true };
  } else {
    onLog('--- Flash failed ---', true);
    return { ok: false, error: extractFlashError(flashResult.stderr + flashResult.stdout) };
  }
}

// ── Extract readable flash error ───────────────────────
function extractFlashError(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (raw.includes('Cannot open'))       return 'Port unavailable. Check connection and try again.';
  if (raw.includes('Access is denied'))  return 'Port access denied. Close any other programs using this port.';
  if (raw.includes('No DFU capable'))    return 'No DFU device found. Board may not be in bootloader mode.';
  if (raw.includes('timed out'))         return 'Upload timed out. Try reconnecting the board.';
  if (raw.includes('dfu-util: error')) {
    const errLine = lines.find(l => l.includes('dfu-util: error'));
    if (errLine) return errLine;
  }
  return lines.slice(-8).join('\n');
}

// ── Status check ───────────────────────────────────────
function getStatus() {
  const cliOk    = validateCli().ok;
  const sourceOk = proffie.validateProffieOSSource().ok;
  const buildPath = getBuildOutputPath();
  const hasBuild  = fs.existsSync(buildPath) &&
    fs.readdirSync(buildPath).some(f => f.endsWith('.bin') || f.endsWith('.hex') || f.endsWith('.elf'));

  return {
    cliFound:    cliOk,
    sourceFound: sourceOk,
    ready:       cliOk && sourceOk,
    hasBuild
  };
}

module.exports = {
  initialize,
  compile,
  flash,
  abort,
  getStatus,
  validateCli,
  CORE_ID,
  CORE_VERSION
};