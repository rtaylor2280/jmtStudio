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
const cache     = require('./cacheManager');

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

// Every build appends this FQBN option. A core that predates it rejects the
// whole FQBN before compiling a single file, which surfaces to the user as
// "Invalid FQBN: ... invalid option 'pclk'" and a build that fails in 0:00.
// Probed as a CAPABILITY rather than matched as a version number: it tests the
// thing that actually breaks, survives future core releases, and cannot be
// fooled by a directory name.
const REQUIRED_FQBN_OPTION = 'pclk';
const PROBE_FQBN           = 'proffieboard:stm32l4:ProffieboardV3-L452RE';

// null until probed. true means the core arduino-cli finds on its own cannot
// build what we ask for, so every invocation gets pinned to our own directory.
let _useIsolatedCore = null;

// Additional URL needed for proffieboard core
const BOARD_MANAGER_URL = 'https://profezzorn.github.io/arduino-proffieboard/package_proffieboard_index.json';

// ── CLI path resolution ────────────────────────────────
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
  ensureExecutable(cliPath);
  return { ok: true, cliPath };
}

// ── Run arduino-cli command ────────────────────────────
/**
 * Spawns arduino-cli with given args.
 * Calls onLog(line, isError) for each line of stdout/stderr.
 * Returns promise resolving to { ok, code, stdout, stderr }
 */
// opts.raw runs arduino-cli with no config file and no environment override, so
// it resolves exactly as it would for someone typing the command themselves.
// That is the only way to find out which core a normal compile will really use.
function runCli(args, onLog, opts = {}) {
  return new Promise((resolve) => {
    const v = validateCli();
    if (!v.ok) {
      onLog(v.error, true);
      return resolve({ ok: false, code: -1, stdout: '', stderr: v.error });
    }

    const dataPath = getArduinoDataPath();
    fs.mkdirSync(dataPath, { recursive: true });

    // Inject isolated data dir and board manager URL into every command
    const fullArgs = opts.raw ? [...args] : [
      ...args,
      `--config-file=${path.join(dataPath, 'arduino-cli.yaml')}`
    ];

    onLog(`> arduino-cli ${fullArgs.join(' ')}`, false);

    // `--config-file` does NOT redirect platform discovery for `compile`.
    // Measured 2026-08-04: the same flag that makes `board details` report
    // "platform not installed" still lets `compile` resolve the core out of the
    // system Arduino15 tree, which Arduino IDE and other Proffie tools own. So a
    // core someone installed for a different program is what we were building
    // against, and a core predating the `pclk` FQBN option rejected every build
    // before it started. The environment variable DOES redirect it, so it is the
    // only isolation actually available — applied only when the system core
    // cannot build what we ask for, so machines that are already fine are left
    // exactly as they are and nobody re-downloads a core that works.
    const env = { ...process.env };
    if (!opts.raw && _useIsolatedCore) env.ARDUINO_DIRECTORIES_DATA = dataPath;

    const proc = spawn(v.cliPath, fullArgs, { cwd: dataPath, env });
    // A raw probe is not the user's build and must not become the abortable
    // process. Registering it meant Abort pressed during the probe killed the
    // probe instead, set the aborted flag, and then mislabelled whatever
    // failed next as "aborted".
    if (!opts.raw) _currentProc = proc;

    let stdout = '', stderr = '';

    proc.stdout.on('data', d => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      lines.forEach(l => { stdout += l + '\n'; onLog(l, false); });
    });

    proc.stderr.on('data', d => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      lines.forEach(l => { stderr += l + '\n'; onLog(l, true); });
    });

    // Only clear the handle if it is still ours. Clearing unconditionally meant
    // any process finishing could drop the handle for one still running, which
    // would leave Abort with nothing to kill.
    proc.on('close', code => {
      if (_currentProc === proc) _currentProc = null;
      resolve({ ok: code === 0, code, stdout, stderr });
    });

    proc.on('error', e => {
      if (_currentProc === proc) _currentProc = null;
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
// The Proffieboard core's Linux tools include a 32-bit dfu-suffix binary. On
// modern Ubuntu (no `:i386` libc compat by default), the kernel can't find
// the 32-bit dynamic linker `/lib/ld-linux.so.2` and fork/exec returns
// "no such file or directory" — referring to the missing linker, not the
// binary. Initial QA was checking "does the file exist" and skipping the
// patch when it did, which left the broken 32-bit binary in place.
//
// We bundle a 64-bit dfu-suffix in resources/tools/linux/ — overwrite the
// core's copy unconditionally on Linux so arduino-cli's compile path uses
// a binary that can actually exec. Note: dfu-suffix only needs libc (no
// libusb), so the swap doesn't require LD_LIBRARY_PATH magic.
function _ensureLinuxDfuSuffix(onLog) {
  if (process.platform !== 'linux') return;
  const bundled = path.join(getToolsPath(), 'dfu-suffix');
  if (!fs.existsSync(bundled)) return;

  // arduino-cli may run the core from our isolated arduino-data OR from the
  // Arduino IDE default at ~/.arduino15. When Arduino IDE was used previously
  // — or when --config-file doesn't redirect platform discovery for compile
  // on Linux — the system path wins even though we set directories.data in
  // our yaml. Patch both candidate locations so whichever path arduino-cli
  // ends up using has the working 64-bit binary.
  const candidates = [
    getArduinoDataPath(),
    path.join(require('os').homedir(), '.arduino15')
  ];

  for (const dataPath of candidates) {
    const hardwarePath = path.join(dataPath, 'packages', 'proffieboard', 'hardware', 'stm32l4');
    if (!fs.existsSync(hardwarePath)) continue;
    for (const v of fs.readdirSync(hardwarePath)) {
      const toolsLinux = path.join(hardwarePath, v, 'tools', 'linux');
      const targetPath = path.join(toolsLinux, 'dfu-suffix');
      try {
        fs.mkdirSync(toolsLinux, { recursive: true });
        fs.copyFileSync(bundled, targetPath);
        fs.chmodSync(targetPath, 0o755);
        onLog(`Patched dfu-suffix in ${toolsLinux} with bundled 64-bit binary.`, false);
      } catch (e) {
        onLog(`Could not patch dfu-suffix: ${e.message}`, true);
      }
    }
  }
}

// Same shape as the Linux patch, but for Mac. The proffieboard core ships an
// x86_64-only dfu-suffix at tools/macosx/dfu-suffix. Apple Silicon users
// without Rosetta installed (increasingly common on recent Macs that have
// never run an Intel app) hit the same cryptic fork/exec failure we saw on
// Linux. We bundle a universal binary (Mach-O fat, x86_64 + arm64) at
// resources/tools/mac/dfu-suffix — overwriting the core's copy makes compile
// work on all Apple Silicon Macs regardless of Rosetta state.
//
// Candidate locations mirror Linux: our isolated arduino-data plus the
// Arduino IDE default at ~/Library/Arduino15.
function _ensureMacDfuSuffix(onLog) {
  if (process.platform !== 'darwin') return;
  const bundled       = path.join(getToolsPath(), 'dfu-suffix');
  const bundledLibusb = path.join(getToolsPath(), 'libusb-1.0.0.dylib');
  if (!fs.existsSync(bundled)) return;

  const candidates = [
    getArduinoDataPath(),
    path.join(require('os').homedir(), 'Library', 'Arduino15')
  ];

  for (const dataPath of candidates) {
    const hardwarePath = path.join(dataPath, 'packages', 'proffieboard', 'hardware', 'stm32l4');
    if (!fs.existsSync(hardwarePath)) continue;
    for (const v of fs.readdirSync(hardwarePath)) {
      const toolsMac = path.join(hardwarePath, v, 'tools', 'macosx');
      const targetPath = path.join(toolsMac, 'dfu-suffix');
      try {
        fs.mkdirSync(toolsMac, { recursive: true });
        fs.copyFileSync(bundled, targetPath);
        fs.chmodSync(targetPath, 0o755);
        // Our universal dfu-suffix is dynamically linked against
        // libusb-1.0.0.dylib via @loader_path, so the dylib must sit
        // alongside the binary in the core's tools/macosx/ directory.
        // Without this, dyld fails with "Library not loaded" and the
        // compile aborts with "signal: abort trap".
        if (fs.existsSync(bundledLibusb)) {
          const targetLibusb = path.join(toolsMac, 'libusb-1.0.0.dylib');
          fs.copyFileSync(bundledLibusb, targetLibusb);
          fs.chmodSync(targetLibusb, 0o755);
        }
        onLog(`Patched dfu-suffix in ${toolsMac} with bundled universal binary.`, false);
      } catch (e) {
        onLog(`Could not patch dfu-suffix: ${e.message}`, true);
      }
    }
  }
}

// The board never got as far as being built for: arduino-cli rejected the FQBN
// or could not find the platform at all. Distinct from a config error, and the
// only failure worth retrying against a different core. Kept narrow on purpose -
// anything broader would re-run real compile errors.
function _looksLikeUnusableCore(result) {
  const output = (result.stdout || '') + (result.stderr || '');
  return /invalid option '[^']*'/i.test(output)
      || /Invalid FQBN/i.test(output)
      || /platform .* not (installed|found)/i.test(output);
}

// Is the core arduino-cli resolves on its own able to build what we ask for?
// Asked the way a plain compile would resolve it, because that is the question
// that matters: our config file does not control which platform `compile` picks.
async function _systemCoreCanBuild() {
  const probe = await runCli(['board', 'details', '-b', PROBE_FQBN], () => {}, { raw: true });
  return probe.ok && probe.stdout.includes(REQUIRED_FQBN_OPTION);
}

// Does OUR directory hold a core that can actually build for this board?
//
// The old check accepted any version directory containing a boards.txt and then
// wrote CORE_VERSION into the sentinel, so one wrong core made the app claim -
// permanently, on every launch - that the right one was installed. A presence
// check reporting itself as a version check is worse than no check.
//
// Matching the directory NAME does not work either: the same core installs as
// `4.6` or `4.6.0` depending on whether the request said `@4.6` or `@4.6.0`,
// and both are legitimate. So ask boards.txt what it can do, exactly as the
// system-core probe does. Version-agnostic, and it stays true when 4.7 lands.
function _ourCoreCanBuild(dataPath) {
  const hardwarePath = path.join(dataPath, 'packages', 'proffieboard', 'hardware', 'stm32l4');
  if (!fs.existsSync(hardwarePath)) return false;
  return fs.readdirSync(hardwarePath).some(v => {
    const boards = path.join(hardwarePath, v, 'boards.txt');
    try { return fs.readFileSync(boards, 'utf8').includes(REQUIRED_FQBN_OPTION); }
    catch { return false; }
  });
}

async function ensureCore(onLog) {
  const dataPath     = getArduinoDataPath();
  const sentinelPath = path.join(dataPath, '.core-installed');

  // Decide isolation before anything else: it determines whether "installed"
  // means the system core or ours, and it is what every later spawn keys off.
  if (_useIsolatedCore === null) {
    _useIsolatedCore = !(await _systemCoreCanBuild());
    if (_useIsolatedCore) {
      onLog(`The Proffieboard core on this system cannot build for this board ` +
            `(no '${REQUIRED_FQBN_OPTION}' option). Using JMT Studio's own copy instead; ` +
            `your other Arduino tools are left untouched.`, false);
    }
  }

  if (!_useIsolatedCore) {
    // System core is fine. Leave the machine exactly as it is - no install, no
    // download, no change from previous releases for the large majority.
    onLog(`Core ${CORE_ID} on this system can build for this board.`, false);
    _ensureLinuxDfuSuffix(onLog);
    _ensureMacDfuSuffix(onLog);
    return { ok: true };
  }

  // Isolated from here down: only our own directory counts. The sentinel is a
  // speed-up, never evidence - verify the files are actually there before
  // trusting it, or a stale sentinel silently skips the install it stands for.
  if (fs.existsSync(sentinelPath) &&
      fs.readFileSync(sentinelPath, 'utf8').trim() === CORE_VERSION &&
      _ourCoreCanBuild(dataPath)) {
    onLog(`Core ${CORE_ID}@${CORE_VERSION} already installed.`, false);
    _ensureLinuxDfuSuffix(onLog);
    _ensureMacDfuSuffix(onLog);
    return { ok: true };
  }

  // Also check our own arduino-data directory directly, for a core that can
  // actually build. Any-version-will-do is what let 3.6 masquerade as 4.6.0.
  if (_ourCoreCanBuild(dataPath)) {
    onLog(`Core ${CORE_ID}@${CORE_VERSION} already installed.`, false);
    fs.writeFileSync(sentinelPath, CORE_VERSION, 'utf8');
    _ensureLinuxDfuSuffix(onLog);
    _ensureMacDfuSuffix(onLog);
    return { ok: true };
  }

  onLog(`Installing core ${CORE_ID}@${CORE_VERSION} — this may take a few minutes on first run...`, false);

  // Update index first — pass URL directly so it works regardless of config file parsing
  const update = await runCli(['core', 'update-index', `--additional-urls=${BOARD_MANAGER_URL}`], onLog);
  if (!update.ok) return { ok: false, error: 'Failed to update board index.' };

  // Install core
  const install = await runCli(['core', 'install', `${CORE_ID}@${CORE_VERSION}`, `--additional-urls=${BOARD_MANAGER_URL}`], onLog);
  if (!install.ok) return { ok: false, error: `Failed to install core ${CORE_ID}@${CORE_VERSION}.` };

  // Write sentinel so subsequent startups skip this flow
  fs.writeFileSync(sentinelPath, CORE_VERSION, 'utf8');

  _ensureLinuxDfuSuffix(onLog);
  _ensureMacDfuSuffix(onLog);

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

  // Run the core install BEFORE checking ProffieOS — they're independent. The
  // proffieboard core is an arduino-cli platform install in arduino-data/ and
  // doesn't depend on a ProffieOS folder existing. Running it first lets the
  // first-run setup banner appear and progress while the user installs/imports
  // a ProffieOS version in parallel, instead of seeing only a red error first.
  await ensureCliConfig(onLog);
  const coreResult = await ensureCore(onLog);
  if (!coreResult.ok) return { ok: false, error: coreResult.error };

  // ProffieOS-dependent setup (workspace staging) runs only when a version is
  // installed. When none is present we still return ok — the toolchain itself
  // IS ready. `needsProffieOS: true` lets the renderer pick the right user-
  // facing message (warn state pointing at the next action) instead of a
  // misleading green "Toolchain ready" while compile is still blocked.
  const sourceCheck = proffie.validateProffieOSSource();
  if (!sourceCheck.ok) {
    onLog('Toolchain ready. (Install a ProffieOS version to enable compile.)', false);
    return { ok: true, needsProffieOS: true };
  }
  onLog(`ProffieOS source validated (${proffie.getSelectedVersion()}).`, false);

  const wsResult = proffie.initWorkspace(onLog);
  if (!wsResult.ok) return { ok: false, error: wsResult.error };

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

  // Normally decided during startup by ensureCore. Decide it here too rather
  // than assume the ordering: getting this wrong means silently compiling
  // against whichever core happens to be on the machine, which is the whole
  // defect this guards against, and it costs one cheap probe once per session.
  if (_useIsolatedCore === null) {
    _useIsolatedCore = !(await _systemCoreCanBuild());
  }

  const usb = (buildOptions && buildOptions.usb) || 'cdc_webusb';

  const refCheck = proffie.ensureConfigFileRef(onLog);
  if (!refCheck.ok) { onLog(refCheck.error, true); return { ok: false, error: refCheck.error }; }

  const staged = proffie.stageConfig(configContent);
  if (!staged.ok) { onLog(staged.error, true); return { ok: false, error: staged.error }; }
  onLog(`Config staged to: ${staged.stagedPath}`, false);

  const sketchPath = proffie.getProffieOSRoot();
  const buildPath  = getBuildOutputPath();
  fs.mkdirSync(buildPath, { recursive: true });

  // dosfs=sdmmc1 uses SDIO high-speed on V3 (L452RE); V1/V2 only support sdspi
  const dosfs = fqbn.includes('L452') ? 'sdmmc1' : 'sdspi';

  const args = [
    'compile',
    '--fqbn', `${fqbn}:usb=${usb},dosfs=${dosfs},speed=80,opt=os,pclk=2`,
    '--build-path', buildPath,
    '--warnings', 'none',
    '--verbose',
    sketchPath
  ];

  let result = await runCli(args, onLog);

  // Self-heal inside a running session. The core arduino-cli resolves can change
  // underneath us - somebody installs an older one for another Proffie tool
  // while this app is open - and the failure is a hard FQBN rejection before a
  // single file is built, so it costs nothing to catch. Re-probe, move to our
  // own copy if the system one has gone bad, and try once. The user gets a
  // slower compile instead of an error they have no way to act on. Guarded to
  // one retry, and only for this signature, so a genuine config error is never
  // compiled twice.
  if (!result.ok && !_aborted && _looksLikeUnusableCore(result)) {
    onLog('The Proffieboard core on this system cannot build for this board. ' +
          'Switching to JMT Studio\'s own copy...', false);
    _useIsolatedCore = null;
    const core = await ensureCore(onLog);
    if (core.ok && _useIsolatedCore) result = await runCli(args, onLog);
  }

  if (result.ok) {
    onLog('--- Compile successful ---', false);
    // Save to persistent cache
    try {
      const { app } = require('electron');
      const proffieOSHash = proffie.hashVersion(proffie.getSelectedVersion());
      const stylesContent = proffie.readStagedStyles();
      cache.cacheCompileResult(buildPath, configContent, fqbn, usb, proffieOSHash,
        new Date().toISOString(), app.getVersion(), stylesContent);
    } catch {}
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
// GCC template-instantiation errors can be many KB on a single line (the entire
// expanded `using` alias is rendered into the error). Stuffing that raw into the
// modal status overflows the buttons off-screen. Strategy:
//   1. Find lines containing ': error: ' (skip 'note:' clarifications and shell
//      echo lines).
//   2. For each, peel off the absolute path → keep just `basename:line` so the
//      user sees what file and where without 200 chars of `C:\Users\...\path`.
//   3. Truncate the error message itself to a hard cap so a single bad template
//      can't blow up the modal. Full verbose output is still in the build-output
//      panel for anyone who wants to copy/paste it.
//   4. Cap at 3 errors total — first usually identifies the root cause, the rest
//      are usually cascading from it.
// Falls back to the last 10 non-empty lines when no `error:` line matches.
function extractCompileError(raw) {
  const lines = raw.split(/\r?\n/);
  const errorLines = lines.filter(l =>
    / error: /.test(l) && !/ note: /.test(l) && !l.startsWith('>')
  );
  if (!errorLines.length) {
    return lines.filter(Boolean).slice(-10).join('\n');
  }
  const MAX_MSG = 180;
  const summarize = (line) => {
    const m = line.match(/^(?:.*[\\/])?([^\\/:]+):(\d+)(?::\d+)?:\s+error:\s+(.*)$/);
    if (!m) {
      return line.length > MAX_MSG ? line.slice(0, MAX_MSG) + '…' : line;
    }
    const file = m[1];
    const ln   = m[2];
    let msg    = m[3];
    if (msg.length > MAX_MSG) msg = msg.slice(0, MAX_MSG) + '…';
    return `${file}:${ln} — ${msg}`;
  };
  const summary = errorLines.slice(0, 3).map(summarize).join('\n');
  const moreCount = errorLines.length - 3;
  return moreCount > 0
    ? `${summary}\n…and ${moreCount} more (full output in Build Output panel)`
    : summary;
}

// ── Tools path ─────────────────────────────────────────
function getToolsPath() {
  const platform = process.platform === 'win32' ? 'windows'
                 : process.platform === 'darwin'  ? 'mac'
                 : 'linux';
  return path.join(proffie.getResourcesPath(), 'tools', platform);
}

function ensureExecutable(filePath) {
  if (process.platform !== 'win32' && fs.existsSync(filePath)) {
    try { fs.chmodSync(filePath, 0o755); } catch {}
  }
}

// On Linux, bundled dfu-util links against libusb-1.0.so.0 which we bundle
// in the same tools directory. Set LD_LIBRARY_PATH so the dynamic linker finds it.
function getDfuEnv(toolsDir) {
  if (process.platform !== 'linux') return undefined;
  const existing = process.env.LD_LIBRARY_PATH || '';
  return {
    ...process.env,
    LD_LIBRARY_PATH: existing ? `${toolsDir}:${existing}` : toolsDir
  };
}

function getDfuUtilPath() {
  const bin = process.platform === 'win32' ? 'dfu-util.exe' : 'dfu-util';
  return path.join(getToolsPath(), bin);
}

function getDfuSuffixPath() {
  const bin = process.platform === 'win32' ? 'dfu-suffix.exe' : 'dfu-suffix';
  return path.join(getToolsPath(), bin);
}

// ── Arduino IDE process check ──────────────────────────
function checkArduinoRunning() {
  return new Promise(resolve => {
    const { execFile, exec } = require('child_process');
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 3000 }, (err, stdout) => {
        if (err) { resolve(false); return; }
        resolve(stdout.toLowerCase().includes('arduino'));
      });
    } else {
      exec('ps aux', { timeout: 3000 }, (err, stdout) => {
        if (err) { resolve(false); return; }
        resolve(stdout.toLowerCase().includes('arduino'));
      });
    }
  });
}

// ── 1200-bps touch reset ───────────────────────────────
// Resolves { ok, retriable, cause }
//   cause: 'port-locked' (Arduino IDE / other app holds the port)
//        | 'driver'      (driver-layer failure — often a flaky cable, marginal USB port, or stuck COM driver)
//        | undefined     (success path)
function touchReset(port, onLog) {
  return new Promise((resolve) => {
    onLog(`Sending 1200-bps touch reset on ${port}...`, false);
    const { SerialPort } = require('serialport');
    const sp = new SerialPort({ path: port, baudRate: 1200, autoOpen: false });
    sp.open(async err => {
      if (err) {
        const isAccessDenied = err.message.toLowerCase().includes('access denied')
                            || err.message.toLowerCase().includes('cannot open')
                            || err.message.toLowerCase().includes('resource busy')
                            || err.message.toLowerCase().includes('ebusy');
        if (isAccessDenied) {
          const arduinoOpen = await checkArduinoRunning();
          if (arduinoOpen) {
            onLog(`Arduino IDE is open and is likely holding ${port}. Close Arduino IDE and retry.`, true);
          } else {
            onLog(`Port ${port} is in use by another application. Close it and retry.`, true);
          }
          return resolve({ ok: false, retriable: true, cause: 'port-locked' });
        }
        onLog(`Touch reset error: ${err.message}`, true);
        onLog('This is sometimes a flaky USB cable, a marginal USB port, or a stuck COM driver. Try a different cable or USB port, then retry.', false);
        return resolve({ ok: false, retriable: true, cause: 'driver' });
      }
      sp.set({ dtr: false }, () => {
        setTimeout(() => {
          sp.close(() => resolve({ ok: true, retriable: false }));
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
    ensureExecutable(dfuUtil);

    const check = () => {
      const { execFile } = require('child_process');
      execFile(dfuUtil, ['-l'], { timeout: 3000, cwd: toolsDir, env: getDfuEnv(toolsDir) }, (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '');
        const lines  = output.split(/\r?\n/);
        const found  = lines.some(l =>
          l.trim().startsWith('Found DFU:') &&
          (l.includes('0483:df11') || l.includes('1209:6668'))
        );
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

// ── Prepare firmware (shared by flash and flashDFU) ───
// Converts .elf → .bin → .dfu and returns { ok, dfuPath, toolsDir }
async function prepareFirmware(onLog) {
  const buildPath = getBuildOutputPath();
  if (!fs.existsSync(buildPath)) {
    const msg = 'No compiled firmware found. Run Compile before flashing.';
    onLog(msg, true);
    return { ok: false, error: msg };
  }

  const elfFiles = fs.readdirSync(buildPath).filter(f => f.endsWith('.elf'));
  if (!elfFiles.length) {
    const msg = 'No .elf file found in build output. Run Compile before flashing.';
    onLog(msg, true);
    return { ok: false, error: msg };
  }

  // Source-hash sanity check. The in-app flows that modify version source files
  // (e.g. JMT add-on apply) already invalidate the hash cache and force a recompile.
  // This catches the rare case where the source was edited outside JMT Studio while
  // a cached/freshly-compiled build was sitting in build-output. Recomputing fresh
  // (after invalidating the per-session memoization) and comparing to the provenance
  // sidecar that was written at compile/restore time will fail fast on a mismatch
  // so we never flash firmware that doesn't match the current source.
  //
  // Graceful migration: if no sidecar exists (older builds predating this code), skip
  // the check — first compile or restore after upgrade will populate the sidecar.
  const provenance = cache.readBuildProvenance(buildPath);
  if (provenance && provenance.proffieOSHash) {
    const versionName = proffie.getSelectedVersion();
    proffie.invalidateVersionHash(versionName);
    const freshHash = proffie.hashVersion(versionName);
    if (freshHash !== provenance.proffieOSHash) {
      const msg = 'ProffieOS source has changed since this build. Please recompile before flashing.';
      onLog(msg, true);
      return { ok: false, error: msg, sourceChanged: true };
    }
  }

  const elfPath  = path.join(buildPath, elfFiles[0]);
  const binPath  = path.join(buildPath, 'ProffieOS.bin');
  const dfuPath  = path.join(buildPath, 'ProffieOS.dfu');
  const toolsDir = getToolsPath();

  // Convert .elf to .bin
  onLog('Converting firmware to binary...', false);

  const objcopyBin = process.platform === 'win32' ? 'arm-none-eabi-objcopy.exe' : 'arm-none-eabi-objcopy';
  const searchBases = [
    getArduinoDataPath(),
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Arduino15')
      : process.platform === 'darwin'
        ? path.join(process.env.HOME || '', 'Library', 'Arduino15')
        : path.join(process.env.HOME || '', '.arduino15')
  ];

  let objcopy = null;
  for (const base of searchBases) {
    const toolPath = path.join(base, 'packages', 'proffieboard', 'tools', 'arm-none-eabi-gcc');
    if (!fs.existsSync(toolPath)) continue;
    for (const ver of fs.readdirSync(toolPath)) {
      const candidate = path.join(toolPath, ver, 'bin', objcopyBin);
      if (fs.existsSync(candidate)) { objcopy = candidate; break; }
    }
    if (objcopy) break;
  }

  if (!objcopy) {
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

  // Add DFU suffix (pure Node.js — no dfu-suffix binary needed)
  onLog('Adding DFU suffix...', false);
  try {
    const bin = fs.readFileSync(binPath);
    const suffix = Buffer.alloc(16);
    suffix.writeUInt16LE(0xffff, 0);  // bcdDevice
    suffix.writeUInt16LE(0x6668, 2);  // idProduct
    suffix.writeUInt16LE(0x1209, 4);  // idVendor
    suffix.writeUInt16LE(0x0100, 6);  // bcdDFU (DFU 1.0)
    suffix[8]  = 0x55;                // 'U'
    suffix[9]  = 0x46;                // 'F'
    suffix[10] = 0x44;                // 'D'
    suffix[11] = 16;                  // bLength
    // CRC32 over binary + first 12 suffix bytes (everything except dwCRC)
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bin.length; i++) {
      crc ^= bin[i];
      for (let j = 0; j < 8; j++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
    }
    for (let i = 0; i < 12; i++) {
      crc ^= suffix[i];
      for (let j = 0; j < 8; j++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
    }
    suffix.writeUInt32LE(crc >>> 0, 12);
    fs.writeFileSync(dfuPath, Buffer.concat([bin, suffix]));
  } catch (e) {
    onLog(`DFU suffix failed: ${e.message}`, true);
    return { ok: false, error: e.message };
  }
  onLog('DFU suffix added.', false);

  return { ok: true, dfuPath, toolsDir };
}

// ── Run dfu-util flash (shared by flash and flashDFU) ─
async function runDfuFlash(dfuPath, toolsDir, onLog) {
  onLog('Flashing firmware...', false);
  ensureExecutable(getDfuUtilPath());

  const flashResult = await new Promise(resolve => {
    const proc = spawn(getDfuUtilPath(), [
      '-d', '1209:6668,0483:df11',
      '-a', '0',
      '-s', '0x08000000:leave',
      '-D', dfuPath
    ], { cwd: toolsDir, env: getDfuEnv(toolsDir) });

    let stdout = '', stderr = '';

    // dfu-util uses bare \r as cursor-to-column-0 throughout output, on both
    // stdout and stderr depending on the build. Apply terminal emulator semantics
    // to both streams so chunk boundaries never produce partial log lines.
    function makeTermEmu(onFlush) {
      let line = '', pos = 0;
      return {
        write(str) {
          for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (ch === '\n') {
              onFlush(line);
              line = '';
              pos = 0;
            } else if (ch === '\r') {
              if (line.trim()) onFlush(line);
              line = '';
              pos = 0;
            } else {
              if (pos < line.length) {
                line = line.slice(0, pos) + ch + line.slice(pos + 1);
              } else {
                line += ch;
              }
              pos++;
            }
          }
        },
        flush() {
          if (line.trim()) { onFlush(line); line = ''; pos = 0; }
        }
      };
    }

    const outEmu = makeTermEmu(line => {
      if (!line) return;
      stdout += line + '\n';
      onLog(line, false);
    });
    const errEmu = makeTermEmu(line => {
      if (!line) return;
      stderr += line + '\n';
      onLog(line, line.toLowerCase().includes('error'));
    });

    proc.stdout.on('data', d => outEmu.write(d.toString()));
    proc.stderr.on('data', d => errEmu.write(d.toString()));

    proc.on('close', code => {
      outEmu.flush();
      errEmu.flush();
      resolve({ ok: code === 0, stdout, stderr });
    });
    proc.on('error', e => resolve({ ok: false, error: e.message }));
  });

  if (flashResult.ok) {
    onLog('--- Flash successful ---', false);
    return { ok: true };
  } else {
    onLog('--- Flash failed ---', true);
    const combined = (flashResult.stderr || '') + (flashResult.stdout || '');
    const error = extractFlashError(combined);
    // Linux without udev rules: dfu-util can enumerate the device via sysfs
    // (so waitForDfu + detectDFU don't catch it as inaccessible) but the
    // actual transfer fails inside libusb with LIBUSB_ERROR_ACCESS. Surface
    // the existing "Fix DFU Driver" modal so the user gets udev guidance
    // instead of a cryptic generic error.
    const needsDfuDriver =
      process.platform === 'linux' &&
      /LIBUSB_ERROR_ACCESS|cannot open DFU device|Permission denied/i.test(combined);
    return { ok: false, error, needsDfuDriver };
  }
}

// ── Detect DFU device ──────────────────────────────────
// Returns { found, accessible }
// found: DFU device is visible on USB
// accessible: driver is set up correctly (false = Windows driver issue)
function detectDFU() {
  const { execFile } = require('child_process');
  const dfuUtil  = getDfuUtilPath();
  const toolsDir = getToolsPath();

  ensureExecutable(getDfuUtilPath());
  return new Promise(resolve => {
    execFile(dfuUtil, ['-l'], { timeout: 5000, cwd: toolsDir, env: getDfuEnv(toolsDir) }, (_err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      const lines  = output.split(/\r?\n/);

      // Proffieboard DFU accessible: appears in a "Found DFU:" line with matching VID:PID
      const accessible = lines.some(l =>
        l.trim().startsWith('Found DFU:') &&
        (l.includes('0483:df11') || l.includes('1209:6668'))
      );
      if (accessible) return resolve({ found: true, accessible: true });

      // Proffieboard mentioned but not accessible (wrong driver on Windows)
      const mentioned = output.includes('0483:df11') || output.includes('1209:6668');
      if (mentioned) return resolve({ found: true, accessible: false });

      resolve({ found: false });
    });
  });
}

// ── Flash ──────────────────────────────────────────────
/**
 * Uploads compiled firmware via 1200-bps touch reset → DFU → dfu-util.
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

  const prep = await prepareFirmware(onLog);
  if (!prep.ok) return prep;

  const { dfuPath, toolsDir } = prep;

  // 1200-bps touch reset
  const resetResult = await touchReset(port, onLog);
  if (!resetResult.ok) {
    let msg;
    if (resetResult.cause === 'port-locked') {
      msg = 'Flash stopped — free the port and click Retry Flash.';
    } else if (resetResult.cause === 'driver') {
      msg = 'Touch reset didn\'t complete. Sometimes a different USB cable or port is enough — worth trying before pressing reset on the board.';
    } else {
      msg = 'Touch reset failed. Try pressing the reset button manually.';
    }
    return { ok: false, error: msg, retriable: resetResult.retriable };
  }
  await new Promise(r => setTimeout(r, 1000));

  // Wait for DFU device
  const dfuFound = await waitForDfu(onLog);
  if (!dfuFound) {
    // Touch reset succeeded — the board IS in DFU. dfu-util may not see it for two reasons:
    //   1. Late enumeration race (now accessible) — proceed straight to flash.
    //   2. Driver state on this USB instance (wrong driver bound, OR no driver bound at all
    //      after a Device Manager uninstall, OR on Linux, missing udev rules). In all of
    //      these we hand off to the renderer's bootloader-wait flow, which can offer
    //      the driver/permission setup and keep polling.
    const dfuState = await detectDFU();

    if (dfuState.accessible) {
      onLog('DFU device detected (late). Proceeding with flash.', false);
      return await runDfuFlash(dfuPath, toolsDir, onLog);
    }

    const msg = 'DFU device not accessible. Switching to Bootloader Mode to recover.';
    onLog(msg, false);
    return { ok: false, error: msg, needsDfuDriver: true };
  }

  return await runDfuFlash(dfuPath, toolsDir, onLog);
}

// ── Flash DFU ──────────────────────────────────────────
/**
 * Uploads compiled firmware directly via dfu-util (board already in bootloader mode).
 * No serial port or touch reset required.
 * onLog(line, isError) streams output back to renderer.
 * Returns { ok, error? }
 */
async function flashDFU(onLog) {
  onLog('--- DFU Flash started ---', false);

  const prep = await prepareFirmware(onLog);
  if (!prep.ok) return prep;

  return await runDfuFlash(prep.dfuPath, prep.toolsDir, onLog);
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

function checkCacheAndRestore(configContent, fqbn, usb) {
  const proffieOSHash = proffie.hashVersion(proffie.getSelectedVersion());
  const stylesContent = proffie.readStagedStyles();
  return cache.checkAndRestore(configContent, fqbn, usb, proffieOSHash, stylesContent);
}

function needsCoreInstall() {
  const dataPath     = getArduinoDataPath();
  const sentinelPath = path.join(dataPath, '.core-installed');
  if (!fs.existsSync(sentinelPath)) return true;
  return fs.readFileSync(sentinelPath, 'utf8').trim() !== CORE_VERSION;
}

module.exports = {
  initialize,
  compile,
  flash,
  flashDFU,
  detectDFU,
  abort,
  getStatus,
  checkCacheAndRestore,
  needsCoreInstall,
  validateCli,
  CORE_ID,
  CORE_VERSION,
  // Exported so portDetector can look for the core in the same place the
  // compiler does. Duplicating the rule is how the two drift apart, and a
  // board list reading a different directory than the compile is exactly the
  // class of bug this release exists to fix.
  coreCanBuildAt: _ourCoreCanBuild
};