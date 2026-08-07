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

// arduino-cli is only an orchestrator — the compile is done by a tree of child
// processes it spawns (the proffieboard gcc toolchain, and cc1plus grinding
// through the actual C++). Node's proc.kill() signals ONLY arduino-cli, so its
// gcc children keep running to completion and keep streaming the whole error
// dump into the pipe — which is why "Abort" appeared to hang and had to be
// waited out. Kill the entire tree instead.
function _killTree(proc) {
  if (!proc) return;
  const pid = proc.pid;
  if (process.platform === 'win32') {
    // /T = whole tree, /F = force. Fire-and-forget; if taskkill can't spawn,
    // fall back to at least killing the parent.
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { try { proc.kill('SIGKILL'); } catch {} }
  } else {
    // Spawned detached on POSIX, so the child leads its own process group
    // (pgid = pid). A negative pid signals the whole group, taking gcc/cc1plus
    // down with it.
    try { process.kill(-pid, 'SIGKILL'); }
    catch { try { proc.kill('SIGKILL'); } catch {} }
  }
}

function abort() {
  if (_currentProc) {
    _aborted = true;
    _killTree(_currentProc);
    // Don't null _currentProc here — let the 'close' handler clear it once the
    // tree is actually dead, so a second Abort click during a slow kill still
    // finds the process instead of getting "No active process to abort".
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
// gcc/ld/lto-wrapper write warnings and notes to stderr alongside real errors, so
// marking every stderr line as an error painted ordinary build noise red — the
// harmless "memory region `SRAM2' not declared" and the LTRANS note show up on
// EVERY build, which trains the eye to ignore red exactly when it matters. Default
// stderr to error (an ld failure like "region `FLASH' overflowed" says neither
// "error" nor "warning"), but never flag a warning or note.
function _isCompileErrorLine(line) {
  return !/\b(warning|note)\s*:/i.test(line);
}

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

    // detached on POSIX makes the child a process-group leader so abort() can
    // tree-kill the whole gcc/cc1plus group (see _killTree). No-op on Windows,
    // where detached would spawn a separate console; taskkill /T handles the
    // tree there instead.
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

    const proc = spawn(v.cliPath, fullArgs, {
      cwd: dataPath,
      detached: process.platform !== 'win32',
      env,
    });
    // A raw probe is not the user's build and must not become the abortable
    // process. Registering it meant Abort pressed during the probe killed the
    // probe instead, set the aborted flag, and then mislabelled whatever
    // failed next as "aborted".
    if (!opts.raw) _currentProc = proc;

    let stdout = '', stderr = '';

    // Buffer the incomplete tail of each chunk. Splitting a raw chunk emits the
    // partial last line immediately, which is why a long path could surface as a
    // lone "C" followed by ":/Users/..." on the next line.
    function makeLineReader(onLine) {
      let buf = '';
      return {
        push(chunk) {
          buf += chunk;
          const parts = buf.split(/\r?\n/);
          buf = parts.pop();
          parts.filter(Boolean).forEach(onLine);
        },
        flush() { if (buf.trim()) onLine(buf); buf = ''; },
      };
    }

    const outReader = makeLineReader(l => { stdout += l + '\n'; onLog(l, false); });
    const errReader = makeLineReader(l => { stderr += l + '\n'; onLog(l, _isCompileErrorLine(l)); });

    proc.stdout.on('data', d => outReader.push(d.toString()));
    proc.stderr.on('data', d => errReader.push(d.toString()));

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

  // Also check our own arduino-data directory directly, for the exact version.
  // Any-version-will-do is what let a 3.6 install masquerade as 4.6.0.
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
// ── Compile metrics (dev/test instrumentation) ─────────
// One JSONL record per compile, appended to local/compile-metrics.jsonl, for
// the dynamic-speed research (the opt / toolchain-version time-vs-fit tradeoff:
// backlog "Fast when you can, slower when you need it"). Dev-only by
// construction: local/ is gitignored and absent from packaged builds, so the
// sink silently no-ops in prod. Nothing here is allowed to throw into compile.
const METRICS_PATH = path.join(__dirname, 'local', 'compile-metrics.jsonl');

// Pull flash + RAM usage and ceilings out of arduino-cli's size summary. The
// two sentences the toolchain prints look like:
//   Sketch uses 245678 bytes (46%) of program storage space. Maximum is 524288 bytes.
//   Global variables use 34567 bytes (26%) of dynamic memory, ... Maximum is 131072 bytes.
function _parseSizeReport(output) {
  const out = {};
  const flash = output.match(/Sketch uses (\d+) bytes[\s\S]*?Maximum is (\d+) bytes/);
  if (flash) { out.flashBytes = +flash[1]; out.flashMax = +flash[2]; }
  const ram = output.match(/Global variables use (\d+) bytes[\s\S]*?Maximum is (\d+) bytes/);
  if (ram) { out.ramBytes = +ram[1]; out.ramMax = +ram[2]; }
  if (out.flashBytes != null && out.flashMax) out.flashPct = +(100 * out.flashBytes / out.flashMax).toFixed(1);
  if (out.ramBytes != null && out.ramMax) out.ramPct = +(100 * out.ramBytes / out.ramMax).toFixed(1);
  if (out.flashBytes != null && out.ramBytes != null) {
    out.fits = out.flashBytes <= out.flashMax && out.ramBytes <= out.ramMax;
  }
  return out;
}

// Coarse failure bucket so the corpus can separate "didn't fit" from "toolchain
// ran out of memory building it" from "the config has a real error" — these
// mean very different things for the fast-vs-safe heuristic.
function _classifyCompileError(output) {
  if (/region `?FLASH'? overflowed/i.test(output)) return 'flash_overflow';
  if (/region `?RAM'? overflowed/i.test(output)) return 'ram_overflow';
  if (/out of memory|lto-wrapper.*(memory|failed)|\bKilled\b|std::bad_alloc/i.test(output)) return 'lto_oom';
  if (/error:/i.test(output)) return 'compile_error';
  return 'unknown';
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

// Measurable config inputs to correlate against fit/time when hunting a
// threshold. Rough on purpose — Phase 1 is exploratory.
function _configFeatures(configContent) {
  const raw = String(configContent || '');
  // Count ACTIVE code only. These counts previously included commented-out lines, which inflated
  // every figure for anyone who keeps alternatives commented in their config — and comparing a
  // config's "size" against fit/time is meaningless if half the count never reaches the compiler.
  // Same stripper the cache hash uses, so the two can't drift. (backlog.txt:711, found 2026-07-25)
  const c = cache.stripCommentsForHash(raw);
  const count = (re) => (c.match(re) || []).length;
  return {
    // configBytes stays RAW on purpose: existing records were logged raw, and silently changing
    // its meaning would make old and new rows incomparable without anyone noticing.
    configBytes: raw.length,
    activeBytes: c.replace(/\s+/g, ' ').trim().length,
    includeCount: count(/^\s*#include\b/gm),
    defineCount: count(/^\s*#define\b/gm),
    styleCount: count(/Style\w*Ptr\s*</g),
    bladeConfigCount: count(/CONFIGARRAY\s*\(/g),
  };
}

function _shortConfigHash(configContent) {
  try {
    return require('crypto').createHash('sha256')
      .update(String(configContent || ''), 'utf8').digest('hex').slice(0, 12);
  } catch { return null; }
}

function _logCompileMetrics(record) {
  try {
    // dirname is local/; present in dev, absent (inside asar) in packaged prod.
    if (!fs.existsSync(path.dirname(METRICS_PATH))) return;
    fs.appendFileSync(METRICS_PATH, JSON.stringify(record) + '\n');
  } catch {}
}

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
  // Optimization level (the dynamic-speed research knob). Board menu values are
  // os|o1|o2|o3 (os = -Os + newlib-nano, the size-optimized default we ship).
  // Overridable via buildOptions.opt or the JMT_COMPILE_OPT env var so A/B runs
  // don't need a code edit.
  const opt = (buildOptions && buildOptions.opt) || process.env.JMT_COMPILE_OPT || 'os';
  // LTO knob — the second dynamic-speed lever, and the one that matters for a
  // fit-constrained config where opt-level can't move. ProffieOS builds with
  // whole-program `-flto`; the link-time LTRANS pass re-optimizes the ENTIRE
  // program on every build and is a large slice of wall-clock. Turning it off
  // (a `-fno-lto` appended after the platform's `-flto`, so it wins) skips that
  // pass for a much faster DEV build, at the cost of a bigger binary (LTO's
  // cross-unit dead-code elimination is lost, typically +10-20% size). Default
  // ON so ship builds stay fully squeezed to fit; turn off per-build via
  // buildOptions.lto === false or JMT_COMPILE_LTO=0.
  const lto = (buildOptions && buildOptions.lto === false) ? false
            : !/^(0|false|off)$/i.test(process.env.JMT_COMPILE_LTO || '');
  // Bench runs bypass the persistent cache: a cache hit would report ~0ms
  // (useless for timing) and bench builds shouldn't pollute the real cache.
  const bench = !!(buildOptions && buildOptions.bench);

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
    '--fqbn', `${fqbn}:usb=${usb},dosfs=${dosfs},speed=80,opt=${opt},pclk=2`,
    '--build-path', buildPath,
    '--warnings', 'none',
    '--verbose',
  ];
  // Extra compiler flags, composed per-language. `compiler.{c,cpp}.extra_flags`
  // is the platform's designated user hook (empty by default) and the recipes
  // place it AFTER the platform flags, so anything here wins.
  const cppExtra = [];
  const cExtra   = [];
  // -fmax-errors caps the cascade at the source. A ProffieOS config error is
  // almost always a single bad preset; once gcc's parser derails on it, every
  // following line is garbage AND each expanded-template error is tens of
  // thousands of chars wide. Without this, one typo dumps megabytes of output
  // and the compile has to be waited out. 5 keeps the real error plus a little
  // context, then gcc stops.
  cppExtra.push('-fmax-errors=5');
  cExtra.push('-fmax-errors=5');
  if (!lto) {
    // `-fno-lto` after the platform's `-flto` wins, so objects are built
    // without LTO bytecode; the link's `-flto` then no-ops and the expensive
    // LTRANS pass simply doesn't run.
    cppExtra.push('-fno-lto');
    cExtra.push('-fno-lto');
  }
  args.push('--build-property', `compiler.cpp.extra_flags=${cppExtra.join(' ')}`,
            '--build-property', `compiler.c.extra_flags=${cExtra.join(' ')}`);
  args.push(sketchPath);

  const t0 = Date.now();
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

  const durationMs = Date.now() - t0;
  const wasAborted = _aborted;

  const output = (result.stdout || '') + (result.stderr || '');
  const sizeReport = result.ok ? _parseSizeReport(output) : {};

  _logCompileMetrics({
    ts: new Date().toISOString(),
    durationMs,
    ok: result.ok,
    aborted: wasAborted,
    errorClass: result.ok ? null : (wasAborted ? 'aborted' : _classifyCompileError(output)),
    coreVersion: CORE_VERSION,
    opt,
    lto,
    usb,
    dosfs,
    fqbn,
    bench,
    proffieOSVersion: (() => { try { return proffie.getSelectedVersion(); } catch { return null; } })(),
    configHash: _shortConfigHash(configContent),
    ...sizeReport,
    ..._configFeatures(configContent),
  });

  if (result.ok) {
    onLog(`--- Compile successful (${(durationMs / 1000).toFixed(1)}s) ---`, false);
    // Save to persistent cache (skipped for bench runs so timing harnesses
    // never pollute the real cache).
    if (!bench) {
      try {
        const { app } = require('electron');
        const proffieOSHash = proffie.hashVersion(proffie.getSelectedVersion());
        const stylesContent = proffie.readStagedStyles();
        cache.cacheCompileResult(buildPath, configContent, fqbn, usb, proffieOSHash,
          new Date().toISOString(), app.getVersion(), stylesContent, durationMs);
      } catch {}
    }
    return { ok: true, buildPath, durationMs, ...sizeReport };
  } else {
    _aborted = false;
    if (wasAborted) {
      onLog('--- Compile aborted ---', true);
      clearPartialBuild(buildPath);
      return { ok: false, aborted: true, error: 'Compile aborted' };
    }
    onLog('--- Compile failed ---', true);
    const cleanError = extractCompileError(result.stderr + result.stdout);
    return { ok: false, error: cleanError, durationMs, errorClass: _classifyCompileError(output) };
  }
}

// Bench harness for the dynamic-speed research: compile one config across a
// list of optimization levels back-to-back, cache-bypassed, returning a timing
// + fit record per level. Each underlying compile() also appends its own line
// to local/compile-metrics.jsonl, so the persistent corpus grows either way.
async function benchCompile(configContent, fqbn, buildOptions, optList, onLog) {
  const opts = Array.isArray(optList) && optList.length ? optList : ['os', 'o2'];
  const runs = [];
  for (const opt of opts) {
    onLog(`=== bench: opt=${opt} ===`, false);
    const r = await compile(configContent, fqbn, { ...(buildOptions || {}), opt, bench: true }, onLog);
    runs.push({
      opt,
      ok: !!r.ok,
      durationMs: r.durationMs != null ? r.durationMs : null,
      flashBytes: r.flashBytes, flashMax: r.flashMax, flashPct: r.flashPct,
      ramBytes: r.ramBytes, ramMax: r.ramMax, ramPct: r.ramPct,
      fits: r.fits,
      error: r.ok ? null : (r.error || null),
    });
    if (r.aborted) break; // user killed the run mid-bench
  }
  return { ok: true, runs };
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

// Returns the Windows driver service currently bound to the STM32 bootloader
// (e.g. 'WinUSB', 'STTub30'), or '' if none/unknown. Lets us tell a genuine
// WinUSB bind-in-progress from a wrong driver that will never become openable.
function _getDfuBoundService() {
  if (process.platform !== 'win32') return Promise.resolve('');
  const { execFile } = require('child_process');
  const ps = "$d = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_0483&PID_DF11' } | Select-Object -First 1; if ($d) { (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_Service' -ErrorAction SilentlyContinue).Data }";
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 4000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || '').trim());
    });
  });
}

// ── Wait for DFU device to become accessible ───────────
// After a touch reset the board re-enumerates as the STM32 DFU bootloader, but
// on Windows the WinUSB driver has to bind to that bootloader's unique serial
// before dfu-util can open it. For a board this PC has flashed before the bind
// is instant; for a serial Windows hasn't seen it can lag several seconds
// behind enumeration. The old 10s gate treated that lag as a missing driver
// and diverted every fresh board into the manual Bootloader-Mode flow (holding
// BOOT, reinstalling the driver) even though the automatic path would have
// completed on its own a moment later. We now wait patiently for the device to
// become openable and report what we actually saw, so the caller can tell
// "still binding" from "never showed up at all".
//
// Resolves { openable, everPresent, elapsedMs }
//   openable    — dfu-util can open the device now; safe to flash
//   everPresent — the DFU VID:PID appeared at least once (board did enter DFU)
function waitForDfuAccessible(onLog, deadlineMs = 25000) {
  return new Promise((resolve) => {
    onLog('Waiting for DFU device...', false);
    const start    = Date.now();
    const dfuUtil  = getDfuUtilPath();
    const toolsDir = getToolsPath();
    ensureExecutable(dfuUtil);
    let everPresent  = false;
    let notedBinding = false;
    let probeError   = null;   // set once if dfu-util itself fails to run

    const check = () => {
      const { execFile } = require('child_process');
      execFile(dfuUtil, ['-l'], { timeout: 3000, cwd: toolsDir, env: getDfuEnv(toolsDir) }, async (err, stdout, stderr) => {
        const output  = (stdout || '') + (stderr || '');
        const lines   = output.split(/\r?\n/);
        const elapsed = Date.now() - start;
        // Same reasoning as detectDFU: a dfu-util that never ran looks exactly like a board
        // that is not there. Say so once rather than silently reporting "not found".
        if (err && !output.trim() && !probeError) {
          probeError = err.code || err.message;
          onLog(`Could not run the DFU check (${probeError}) - this is a tool problem, not necessarily a missing board.`, true);
        }

        const foundLines = lines.filter(l =>
          l.trim().startsWith('Found DFU:') &&
          (l.includes('0483:df11') || l.includes('1209:6668'))
        );
        // Collect the serial of every DFU device on the bus. The caller needs these to
        // confirm the board it INTENDED to flash is the one actually sitting in the
        // bootloader - dfu-util matches on VID:PID alone unless told otherwise, so
        // without this check a flash aimed at one board lands on whichever board
        // happens to be in DFU. The STM32 serial is identical in both modes
        // (VID_1209:PID_6668 running, VID_0483:PID_DF11 in DFU), so it maps directly
        // to the serial the port list reports.
        const serials = [...new Set(
          foundLines.map(l => (l.match(/serial="([^"]+)"/) || [])[1]).filter(Boolean)
        )];
        const openable = foundLines.length > 0;
        if (openable) {
          onLog(`DFU device ready after ${(elapsed / 1000).toFixed(1)}s.`, false);
          return resolve({ openable: true, everPresent: true, serials, elapsedMs: elapsed });
        }

        // Present on the bus but not openable. On Windows, find out WHY before
        // committing to the full wait: if WinUSB is mid-bind it will succeed on
        // its own, but if a non-WinUSB driver (e.g. ST's STTub30) is bound it
        // never will. In that case bail immediately with wrongDriver set so the
        // caller can install our driver instead of burning the whole deadline.
        const mentioned = output.includes('0483:df11') || output.includes('1209:6668');
        if (mentioned) {
          everPresent = true;
          if (!notedBinding && elapsed > 2000) {
            notedBinding = true;
            const svc = await _getDfuBoundService();
            if (svc && !/winusb/i.test(svc)) {
              onLog(`Board is in bootloader mode, but WinUSB is not the active driver (currently: ${svc}).`, false);
              return resolve({ openable: false, everPresent: true, wrongDriver: true, boundService: svc, elapsedMs: elapsed });
            }
            onLog('Board is in bootloader mode. Waiting for the USB driver to attach (this can take a few seconds on a board this PC hasn\'t flashed before)...', false);
          }
        }

        if (elapsed > deadlineMs) {
          onLog(`Timed out after ${(elapsed / 1000).toFixed(1)}s waiting for the DFU device to become accessible.`, true);
          // Say WHAT dfu-util actually reported, not just that we gave up. On 2026-07-26 this
          // timed out while the same binary listed the board in 66ms from a shell, and with no
          // record of the tool's output there was no way to tell "device absent" from "device
          // present but we could not open it" (libusb access on Windows is exclusive, so a
          // concurrent dfu-util - including a diagnostic one - can lock us out). Cheap, and it
          // only prints on the failure path.
          const reported = lines.map(l => l.trim()).filter(Boolean).slice(-4);
          onLog(reported.length
            ? `dfu-util reported: ${reported.join(' | ')}`
            : 'dfu-util returned no output at all.', false);
          return resolve({ openable: false, everPresent, elapsedMs: elapsed });
        }
        setTimeout(check, 750);
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

// dfu-util writes BOTH progress and diagnostics to stderr, and its libusb
// failures ("dfuse_download: libusb_control_transfer returned -1") never contain
// the word "error" — so the old bare `includes('error')` test missed the one line
// that mattered while progress lines carried the warning styling. Classify on the
// real patterns instead, and never flag a progress line.
function _isDfuProgressLine(line) {
  return /^\s*(Download|Upload)\s*\[/.test(line) || /\[[=\s]*\]\s*\d+%/.test(line);
}
function _looksLikeFlashError(line) {
  if (_isDfuProgressLine(line)) return false;
  return /error|libusb_control_transfer returned|LIBUSB_ERROR|cannot open|access is denied|no dfu capable|timed out|failed/i.test(line);
}

// ── Run dfu-util flash (shared by flash and flashDFU) ─
async function runDfuFlash(dfuPath, toolsDir, onLog, expectedSN) {
  onLog(expectedSN ? `Flashing firmware to board ${expectedSN}...` : 'Flashing firmware...', false);
  ensureExecutable(getDfuUtilPath());

  const flashResult = await new Promise(resolve => {
    // -S pins the flash to ONE board by serial. Without it, `-d 1209:6668,0483:df11`
    // matches ANY device with those IDs, so dfu-util flashes whichever board happens to
    // be in the bootloader - not the one the user selected. The COM port only ever drove
    // the touch reset; it never constrained the target.
    // Found 2026-07-26 by Note: he unplugged the board on COM12, plugged a DIFFERENT board
    // in, clicked Flash, and the log narrated COM12 while the firmware went to the board
    // that was actually present. Since 0483:df11 is the GENERIC STM32 bootloader ID, the
    // unconstrained form can also target a non-Proffieboard STM32 sitting in DFU.
    // When the serial is unknown (manual Bootloader Mode with no port selected) we keep
    // the old behaviour, because there is nothing better to go on.
    const dfuArgs = ['-d', '1209:6668,0483:df11'];
    if (expectedSN) dfuArgs.push('-S', expectedSN);
    dfuArgs.push('-a', '0', '-s', '0x08000000:leave', '-D', dfuPath);
    const proc = spawn(getDfuUtilPath(), dfuArgs, { cwd: toolsDir, env: getDfuEnv(toolsDir) });

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
      onLog(line, _looksLikeFlashError(line));
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
    // (so waitForDfuAccessible + detectDFU don't catch it as inaccessible) but the
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
    execFile(dfuUtil, ['-l'], { timeout: 5000, cwd: toolsDir, env: getDfuEnv(toolsDir) }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      const lines  = output.split(/\r?\n/);

      // Discarding this error made a real failure undiagnosable on 2026-07-26: after several
      // interrupted flashes the app could not see a DFU device that a shell dfu-util listed in
      // 66ms, and only an app restart cleared it. With the error swallowed, "the tool failed to
      // run" and "there is no board" produced the identical answer, so there was nothing to go
      // on. Report it instead of guessing - callers can still treat probeFailed as not-found,
      // but now the log says which one it was.
      if (err && !output.trim()) {
        return resolve({ found: false, probeFailed: true, error: err.code || err.message });
      }

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

// ── Ensure the WinUSB DFU driver is installed + bound ──
// Stages our one Trusted-Signing-signed WinUSB package (once) and force-binds
// the present bootloader to it, so dfu-util can flash. Windows-only; mac/linux
// reach the DFU device through libusb directly. Runs an elevated helper (one
// UAC prompt; a first-ever install also shows a one-time publisher prompt).
// Returns { ok, status, detail }.
function ensureDfuDriver(onLog) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: true, status: 'not-needed' });
  const os = require('os');
  const { execFile } = require('child_process');
  const resDir     = proffie.getResourcesPath();
  const helper     = path.join(resDir, 'dfu-driver', 'ensure-winusb.ps1');
  const infPath    = path.join(resDir, 'dfu-driver', 'jmt_proffie_winusb.inf');
  const resultPath = path.join(os.tmpdir(), `jmt-dfu-driver-${Date.now()}.json`);

  if (!fs.existsSync(helper) || !fs.existsSync(infPath)) {
    return Promise.resolve({ ok: false, status: 'error', detail: 'Bundled DFU driver package is missing from this build.' });
  }

  onLog('Installing the WinUSB driver...', false);

  // Self-elevate a PowerShell that runs the bundled helper. Single-quote every
  // path (doubling embedded quotes) so spaces in "Program Files" survive.
  // -WindowStyle Hidden on both the outer probe shell and the elevated helper
  // keeps the raw PowerShell console off the user's screen. The UAC prompt and
  // the "install this device software" dialog are separate system windows and
  // still appear (that consent is intentional); only the console is suppressed.
  // Do NOT rely on Start-Process -Wait/-PassThru to know when the elevated
  // helper finished: neither reliably waits across the UAC elevation boundary
  // (they can signal on the consent broker, not the real process), which made us
  // read the result before it was written and mis-report success as failure.
  // The helper writes its result JSON as its LAST action, so we poll for that
  // file as the completion signal instead. If the user declines the UAC prompt,
  // Start-Process throws and the launcher exits non-zero.
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const psCmd =
    `$a=@('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',${q(helper)},` +
    `'-InfPath',${q(infPath)},'-ResultPath',${q(resultPath)});` +
    `try { Start-Process -FilePath 'powershell' -ArgumentList $a -Verb RunAs -WindowStyle Hidden | Out-Null; exit 0 } catch { exit 3 }`;

  const dbg = (m) => { try { fs.appendFileSync(path.join(os.tmpdir(), 'jmt-dfu-app-debug.log'), `[${new Date().toISOString()}] ${m}\n`); } catch {} };

  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCmd],
      { timeout: 120000, windowsHide: true }, async (error) => {
        dbg(`launch done; err=${error ? (error.message || error.code) : 'none'}`);
        if (error) {
          // Non-zero exit from the launcher means the elevated launch failed,
          // almost always the user declining the UAC prompt.
          return resolve({ ok: false, status: 'cancelled', detail: 'Driver install was cancelled. Accept the Windows permission prompt to continue.' });
        }
        // Poll for the helper's result file (its final write) up to ~3 minutes,
        // which also covers the user answering the device-software prompt.
        const deadline = Date.now() + 180000;
        let result = null;
        while (Date.now() < deadline) {
          let raw = null;
          try { raw = fs.readFileSync(resultPath, 'utf8'); } catch {}
          if (raw) { try { result = JSON.parse(raw); break; } catch {} }
          await new Promise(r => setTimeout(r, 400));
        }
        dbg(`result=${JSON.stringify(result)}`);
        try { fs.unlinkSync(resultPath); } catch {}

        if (result && (result.status === 'ok' || result.status === 'staged-nodev')) {
          onLog('WinUSB driver ready.', false);
          return resolve({ ok: true, status: result.status, detail: result.detail });
        }
        if (!result) {
          return resolve({ ok: false, status: 'timeout', detail: 'Driver setup did not complete. Try again, or use a manual option.' });
        }
        resolve({ ok: false, status: result.status, detail: result.detail || 'Driver install failed.' });
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
// A real STM32 serial is 12 hex characters (e.g. 204F32634630) and is the SAME in both
// running and DFU modes, which is what makes it usable as identity across the transition.
// serialport does NOT always give us that: for a stale or orphaned Windows entry it falls
// back to the instance-path fragment (e.g. "6&1832F585&0&0000"), and handing THAT to
// `dfu-util -S` would match nothing and fail a flash on a perfectly good board. So only a
// value that looks like a board serial is allowed to pin anything; anything else is treated
// as "unknown", which restores the previous behaviour rather than breaking the flash.
const _isBoardSerial = (sn) => typeof sn === 'string' && /^[0-9A-Fa-f]{12}$/.test(sn.trim());

// expectedSN is the serial of the board the USER selected. It pins the flash to that
// board (see runDfuFlash) and lets us refuse when a different one is in the bootloader.
async function flash(port, fqbn, onLog, expectedSN) {
  onLog('--- Flash started ---', false);
  if (expectedSN && !_isBoardSerial(expectedSN)) expectedSN = null;

  if (!port) {
    const msg = 'No port selected.';
    onLog(msg, true);
    return { ok: false, error: msg };
  }

  // Decide WHICH board this flash targets, then pin dfu-util to it.
  //
  // Swapping boards is normal - unplug one, plug the next in, flash. The user did nothing
  // wrong, so the app must not turn its own stale selection into their error. Resolve it:
  //   selected board is present        -> use it
  //   it is not, but exactly ONE is    -> use that one and say so. No ambiguity exists.
  //   it is not, and SEVERAL are       -> genuinely ambiguous; refuse rather than guess
  // Only the last case is an error, and only because picking for the user there could
  // flash a board they never intended to touch.
  //
  // A port can stay listed for a second or two after its board is unplugged, so "the port
  // exists" was never evidence that the right board is on the end of it. Serial is the only
  // identity that survives the DFU transition, so it is what we resolve on.
  const _resolveTarget = (serials) => {
    if (!serials || !serials.length) return { sn: expectedSN || null };   // nothing to go on
    if (!expectedSN) return { sn: serials.length === 1 ? serials[0] : null };
    const match = serials.find(s => s.toUpperCase() === String(expectedSN).toUpperCase());
    if (match) return { sn: match };
    if (serials.length === 1) {
      onLog(`Board changed - flashing the connected board (${serials[0]}) instead of ${expectedSN}.`, false);
      return { sn: serials[0], switched: true };
    }
    const msg = `More than one board is in bootloader mode (${serials.join(', ')}) and none of `
              + `them is the one selected (${expectedSN}). Nothing was flashed.\n\n`
              + `Disconnect the boards you do not want to flash, or pick the right one from the port list.`;
    onLog(msg, true);
    return { error: { ok: false, error: msg, wrongBoard: true, expectedSN, foundSN: serials } };
  };

  const prep = await prepareFirmware(onLog);
  if (!prep.ok) return prep;

  const { dfuPath, toolsDir } = prep;

  // 1200-bps touch reset
  const resetResult = await touchReset(port, onLog);
  if (!resetResult.ok) {
    // A failed touch reset does NOT mean we cannot flash. The board may already BE
    // in the bootloader - after an interrupted flash it comes up in DFU, Windows can
    // leave a stale COM node behind, and opening that node fails ("SetCommState:
    // Unknown error code 31"). There is nothing to reset because the board is already
    // where the reset was trying to put it. Bailing out here told the user to try a
    // different cable while a ready-to-flash DFU device sat on the bus.
    // Probe briefly before giving up - dfu-util -l answers immediately when the device
    // is there, so this costs nothing in the genuine cable-fault case.
    // (Found 2026-07-26: board in DFU, LED confirming it, app still on COM12.)
    const already = await waitForDfuAccessible(onLog, 2500);
    if (already.openable) {
      const target = _resolveTarget(already.serials);
      if (target.error) return target.error;
      onLog('Board is already in bootloader mode - flashing directly.', false);
      return await runDfuFlash(dfuPath, toolsDir, onLog, target.sn);
    }
    let msg;
    if (resetResult.cause === 'port-locked') {
      msg = 'Flash stopped — free the port and click Retry Flash.';
    } else if (already.everPresent) {
      msg = 'The board is in bootloader mode but Windows will not let us open it yet. '
          + 'Give it a moment and click Retry Flash; if it persists, check the DFU driver.';
    } else if (resetResult.cause === 'driver') {
      msg = 'Touch reset didn\'t complete. Sometimes a different USB cable or port is enough — worth trying before pressing reset on the board.';
    } else {
      msg = 'Touch reset failed. Try pressing the reset button manually.';
    }
    return { ok: false, error: msg, retriable: resetResult.retriable };
  }
  await new Promise(r => setTimeout(r, 1000));

  // Wait for the bootloader to become accessible, then flash. The wait is
  // patient (see waitForDfuAccessible) so a fresh board's WinUSB bind delay is
  // no longer misread as a missing driver and diverted into manual DFU mode.
  const acc = await waitForDfuAccessible(onLog);

  if (acc.openable) {
    const target = _resolveTarget(acc.serials);
    if (target.error) return target.error;
    return await runDfuFlash(dfuPath, toolsDir, onLog, target.sn);
  }

  if (acc.wrongDriver) {
    // The board is in DFU but a non-WinUSB driver is bound, so it will never
    // become openable on its own. We do NOT auto-install anything here: route to
    // the driver-setup screen and let the user decide (our one-click install, or
    // their own tool). Asking first is deliberate. The app stays transparent and
    // the user keeps the choice; the setup is one-time, so a single click is a
    // fair trade for that trust.
    return { ok: false, error: `WinUSB is not attached to the bootloader (currently: ${acc.boundService}). Driver setup required.`, needsDfuDriver: true };
  }

  if (acc.everPresent) {
    // The board entered DFU but never reported openable within the window. The
    // `-l` probe can stay falsely negative while a device is mid-bind, so make
    // one real flash attempt anyway — `dfu-util -D` is a stronger test than
    // `-l` and usually succeeds here. Only a genuine failure means the driver
    // is actually wrong/missing and we should offer the setup flow.
    onLog('Attempting flash directly...', false);
    const direct = await runDfuFlash(dfuPath, toolsDir, onLog, expectedSN);
    if (direct.ok || direct.needsDfuDriver) return direct;
    // Real access failure. runDfuFlash only flags needsDfuDriver on Linux
    // (udev); on Windows set it here so we still route into the driver-setup
    // flow for a genuinely broken driver state.
    return { ok: false, error: direct.error, needsDfuDriver: true };
  }

  // The DFU device never appeared at all — the touch reset didn't carry the
  // board into bootloader mode. Hand off to the manual Bootloader-Mode flow,
  // which walks the user through entering DFU by hand.
  const msg = 'DFU device not detected. Switching to Bootloader Mode to recover.';
  onLog(msg, false);
  return { ok: false, error: msg, needsDfuDriver: true };
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
  // How far the transfer got before it died. The progress lines are the only place
  // this exists, and they are exactly what the old fallback threw away - yet the
  // stop point is the single most useful fact, because how deep the cut went decides
  // which recovery the user needs (measured on a real board 2026-07-26: ~52% still
  // enumerated on COM and a plain retry worked; ~62% and ~78% left it in bootloader
  // with no COM port, the deepest needing manual bootloader entry).
  const lastProgress = [...lines].reverse().find(l => _isDfuProgressLine(l));
  const pm = lastProgress && lastProgress.match(/(\d+)%\s+(\d+)\s+bytes/);
  const stoppedAt = pm ? ` It stopped at ${pm[1]}% (${Number(pm[2]).toLocaleString()} bytes).` : '';

  // Mid-transfer interruption. dfu-util names this TWO different ways depending on
  // how deep the transfer was, and neither contains the word "error" in the shape
  // the checks above look for:
  //   early - libusb reports the control transfer failing
  //   later - the erase/get_status special command fails instead
  // Matching only the first meant a late drop fell through to the tail below, and
  // because every non-progress line in a dfu-util run sits at the START (the status
  // handshake), "last 8 diagnostic lines" reliably returned the handshake - which
  // tells the user nothing. Found by deliberately pulling USB at 52/62/78%.
  // A completed flash always reaches 100%. So progress that exists and stops short IS
  // an interruption, whether or not dfu-util named one - which covers the deepest cuts,
  // where the only trace left in the tail is the status handshake from the top of the run.
  const stoppedShort = !!pm && Number(pm[1]) < 100;
  const dropLine = lines.find(l =>
    /libusb_control_transfer returned|LIBUSB_ERROR/i.test(l) ||
    /Error during special command|ERASE_PAGE|during download get_status/i.test(l));
  if (dropLine || stoppedShort) {
    // Wording checked against the ACTUAL controls: the port dropdown offers
    // "Switch to Bootloader Mode (DFU)" (buildPanel.js:726) and the no-port tip offers
    // "Try Bootloader Mode (DFU)" (buildPanel.js:1996). An earlier draft said "use Flash
    // via DFU", which is not a control that exists anywhere in the app - naming a button
    // that is not there is the same wrong-advice failure this whole pass is about.
    // The two tiers below are what actually happened on 2026-07-26: a board that leaves
    // the port list is simply waiting in the bootloader, but a board that KEEPS its port
    // while refusing to flash is running incomplete firmware, and only BOOT+RESET moves it.
    // KEEP THIS SHORT. The first draft ran five paragraphs and the verdict was fair:
    // "this looks like a wall of text... not a good error if they have to read a book."
    // Someone reading this has a saber that will not flash; they need the state, the
    // reassurance, and ONE next action. Everything else is escalation and belongs below
    // the fold, not in the panic moment. The raw dfu-util line still follows for anyone
    // who wants it, and the full log is in Build Output either way.
    // Blank lines between the blocks, not just newlines. #bm-status is white-space:
    // pre-wrap, so \n\n renders as real separation - and without it four short
    // sentences still read as one paragraph, which was the second note after the
    // length fix: "no spacing between these paragraphs... still looks hard to read."
    // Each block answers one question: what happened, is my board OK, what do I do,
    // what if that fails.
    // THREE blocks: what happened, what to do, and the raw line for whoever wants it.
    // The BOOT+RESET escalation was dropped deliberately - _checkDfuOnEntry already shows
    // boot instructions when the board is not in DFU yet, so telling them here is telling
    // them something they are about to be told. Note: "the still stuck part isn't needed
    // because it will be told them when they switch to bootloader mode. wasted text here."
    // No raw dfu-util line here. It is already in the log panel above, in red, and the
    // two surfaces have different jobs: the panel is the raw truth, this is the human
    // explanation. Repeating "Error during special command SET_ADDRESS get_status" under
    // a plain-English translation just undoes the translation - the command name tells a
    // user nothing they can act on, and which one appears is only a matter of which step
    // was in flight when the connection died.
    return 'The flash was interrupted before it finished' + (stoppedAt ? ' -' + stoppedAt.replace(' It stopped at', ' it stopped at').replace(/\.$/, '') : '') + '.\n\n'
         + 'The board is fine. It holds partial firmware until a flash completes, and the bootloader cannot be erased. '
         + 'Verify connection and flash again. If the board is not in the port list, pick "Switch to Bootloader Mode (DFU)" from the port dropdown.';
  }
  if (raw.includes('dfu-util: error')) {
    const errLine = lines.find(l => l.includes('dfu-util: error'));
    if (errLine) return errLine;
  }
  // dfu-util emits hundreds of progress lines, so a raw tail is almost always spam.
  // Prefer an actual error-looking line over position: the handshake sits at the top
  // of the run, so taking the LAST non-progress lines surfaces the least useful part
  // of the log. Fall back to the tail only when nothing looks like an error.
  // Lines that LOOK like errors but appear in completely successful flashes. dfu-util
  // clears a stale error state at the start of every run, so "dfuERROR, clearing status"
  // and its surrounding status chatter match a naive /error/ test while meaning nothing.
  // Observed verbatim in a successful flash on 2026-07-26; a synthetic-log test caught
  // the fallback surfacing them, which no hardware run would have shown.
  const _isBenignStatusLine = l =>
    /Determining device status|dfuERROR, clearing status|dfuIDLE, continuing|^\s*dfuERROR\s*$/i.test(l);

  const diagnostic = lines.filter(l => !_isDfuProgressLine(l));
  const errish = diagnostic.filter(l => _looksLikeFlashError(l) && !_isBenignStatusLine(l));
  if (errish.length) return (stoppedAt ? stoppedAt.trim() + '\n' : '') + errish.slice(-3).join('\n');

  // Last resort. If everything we have is the benign status chatter, dumping it would
  // present lines that appear in SUCCESSFUL flashes as though they were the failure -
  // the exact "wall of meaningless text" this pass set out to remove. Say the one true
  // thing instead: it never got as far as transferring.
  const meaningful = diagnostic.filter(l => !_isBenignStatusLine(l));
  if (!meaningful.length) {
    return 'The flash failed before it started transferring.\n\n'
         + 'Check the cable and the board connection, then flash again.';
  }
  return meaningful.slice(-8).join('\n');
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
  benchCompile,
  flash,
  flashDFU,
  detectDFU,
  ensureDfuDriver,
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