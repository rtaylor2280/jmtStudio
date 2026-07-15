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

    // detached on POSIX makes the child a process-group leader so abort() can
    // tree-kill the whole gcc/cc1plus group (see _killTree). No-op on Windows,
    // where detached would spawn a separate console; taskkill /T handles the
    // tree there instead.
    const proc = spawn(v.cliPath, fullArgs, {
      cwd: dataPath,
      detached: process.platform !== 'win32',
    });
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

async function ensureCore(onLog) {
  const dataPath     = getArduinoDataPath();
  const sentinelPath = path.join(dataPath, '.core-installed');

  // Sentinel file written after any successful install (including "already installed" via Arduino IDE).
  // Avoids re-running the index download on every startup for users who have the core installed
  // via Arduino IDE rather than our own arduino-data directory.
  if (fs.existsSync(sentinelPath) && fs.readFileSync(sentinelPath, 'utf8').trim() === CORE_VERSION) {
    onLog(`Core ${CORE_ID}@${CORE_VERSION} already installed.`, false);
    _ensureLinuxDfuSuffix(onLog);
    _ensureMacDfuSuffix(onLog);
    return { ok: true };
  }

  // Also check our own arduino-data directory directly
  const hardwarePath = path.join(dataPath, 'packages', 'proffieboard', 'hardware', 'stm32l4');
  const isInstalled = fs.existsSync(hardwarePath) &&
    fs.readdirSync(hardwarePath).some(v =>
      fs.existsSync(path.join(hardwarePath, v, 'boards.txt'))
    );

  if (isInstalled) {
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

// Measurable config inputs to correlate against fit/time when hunting a
// threshold. Rough on purpose — Phase 1 is exploratory.
function _configFeatures(configContent) {
  const c = String(configContent || '');
  const count = (re) => (c.match(re) || []).length;
  return {
    configBytes: c.length,
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
  const result = await runCli(args, onLog);
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
          new Date().toISOString(), app.getVersion(), stylesContent);
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

    const check = () => {
      const { execFile } = require('child_process');
      execFile(dfuUtil, ['-l'], { timeout: 3000, cwd: toolsDir, env: getDfuEnv(toolsDir) }, async (err, stdout, stderr) => {
        const output  = (stdout || '') + (stderr || '');
        const lines   = output.split(/\r?\n/);
        const elapsed = Date.now() - start;

        const openable = lines.some(l =>
          l.trim().startsWith('Found DFU:') &&
          (l.includes('0483:df11') || l.includes('1209:6668'))
        );
        if (openable) {
          onLog(`DFU device ready after ${(elapsed / 1000).toFixed(1)}s.`, false);
          return resolve({ openable: true, everPresent: true, elapsedMs: elapsed });
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

  // Wait for the bootloader to become accessible, then flash. The wait is
  // patient (see waitForDfuAccessible) so a fresh board's WinUSB bind delay is
  // no longer misread as a missing driver and diverted into manual DFU mode.
  const acc = await waitForDfuAccessible(onLog);

  if (acc.openable) {
    return await runDfuFlash(dfuPath, toolsDir, onLog);
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
    const direct = await runDfuFlash(dfuPath, toolsDir, onLog);
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
  CORE_VERSION
};