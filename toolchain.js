/**
 * toolchain.js
 * Manages arduino-cli: initialization, compile, and flash.
 * All operations run in the Electron main process.
 * Emits progress via a callback so main.js can forward to renderer via IPC.
 */

const path      = require('path');
const fs        = require('fs');
const { spawn } = require('child_process');
const proffie      = require('./proffieos');
const cache        = require('./cacheManager');
const coreVersions = require('./coreVersions');

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

// Which core this session builds against.
//
// This was a hardcoded '4.6.0'. That silently excluded flash-tight boards: a
// style-heavy config can link on 3.6 and overflow 4.6 by kilobytes, which on a
// 256 KB V2/V2.2 is a quarter of the board. Now it is resolved from the
// published index at startup and can be overridden per ProffieOS version.
//
// FALLBACK_VERSION is a floor for a first launch with no network, not a pin.
let _activeCoreVersion  = coreVersions.FALLBACK_VERSION;
// True once the user (or a ProffieOS version's saved preference) has named a
// version explicitly, as opposed to us defaulting to whatever is newest. An
// explicit choice always builds against our own copy, because the core sitting
// on the machine is whatever some other Arduino tool installed and matching it
// by luck is not a guarantee.
let _coreVersionIsExplicit = false;

// Recording which plugins SHOULD be on this machine.
//
// The store lives in main.js; toolchain only reports. The distinction that makes
// this safe is worth stating, because a remembered answer here is what caused
// the 1.7.2 defect: this record NEVER answers "is it installed" - that stays a
// live disk check, since another Arduino tool can change the tree between builds.
// It answers "should it be here", which is intent, and intent is the one thing
// that genuinely cannot be discovered.
//
// Without it, a plugin removed behind the app's back plus a pin moved elsewhere
// leaves nothing saying it ever mattered - so its cached builds read as dead
// when they are only dormant, and the next sweep takes them. (2026-08-15)
let _recordPlugin = null;
let _forgetPlugin = null;
// Bracket an install so an interrupted one is recognisable next launch.
//
// arduino-cli unpacks as it goes, so a process killed mid-install can leave a
// platform directory complete enough that `isVersionInstalled` says yes -
// boards.txt written, tools missing - and the next compile then fails in a way
// that looks like the config's fault. A plugin that exists and cannot build is
// worse than no plugin, because every check that asks "is it there" is satisfied.
//
// A marker still standing at startup means the process did not finish.
// (2026-08-15)
let _beginInstall = null;
let _endInstall   = null;
function setPluginHooks({ record = null, forget = null, begin = null, end = null } = {}) {
  _recordPlugin = record;
  _forgetPlugin = forget;
  _beginInstall = begin;
  _endInstall   = end;
}

function getActiveCoreVersion() { return _activeCoreVersion; }

function setActiveCoreVersion(version, { explicit = true } = {}) {
  const next = coreVersions.normalizeVersion(version);
  if (next !== _activeCoreVersion) {
    // Isolation was decided for the previous version, so it has to be re-asked.
    _useIsolatedCore = null;
  }
  _activeCoreVersion     = next;
  _coreVersionIsExplicit = explicit;
  return _activeCoreVersion;
}

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

// Where arduino-cli keeps packages when nobody redirects it: the user's own
// tree, shared with Arduino IDE and every other Proffie tool.
//
// We never write here. It is read for two reasons: to adopt a core the user
// already has rather than making them download a second copy of it, and so the
// cache sweep can see that a core still exists before calling its builds dead.
function getSystemArduinoDataPath() {
  const os   = require('os');
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Arduino15');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Arduino15');
  return path.join(home, '.arduino15');
}

/**
 * Every core version reachable on this machine, and where each one lives.
 *
 * Returns [{ version, source }] with source 'system' or 'jmt'. The distinction is
 * user-visible on purpose: a system core is theirs, so it is offered but never
 * reclaimed, while a JMT core is ours to remove when nothing needs it.
 *
 * When a version exists in both, the system copy wins. That is the
 * leave-your-machine-alone choice, and it makes our redundant copy reclaimable
 * rather than permanent, so the footprint self-corrects downward.
 */
function listAvailableCores() {
  const seen = new Map();
  for (const v of coreVersions.listInstalled(getSystemArduinoDataPath())) {
    seen.set(coreVersions.normalizeVersion(v), 'system');
  }
  // Every tree of ours, not just the one the active core happens to live in.
  // Reading a single path meant a core installed into its own directory was
  // present on disk, usable, and invisible in the picker. (2026-08-12)
  for (const { version } of listCoreTrees()) {
    const n = coreVersions.normalizeVersion(version);
    if (!seen.has(n)) seen.set(n, 'jmt');
  }
  return Array.from(seen, ([version, source]) => ({ version, source }))
    .sort((a, b) => coreVersions.compareVersions(a.version, b.version));
}

// ── CLI path resolution ────────────────────────────────
function getCliPath() {
  const platform = process.platform === 'win32' ? 'windows'
                 : process.platform === 'darwin'  ? 'mac'
                 : 'linux';
  const bin = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
  return path.join(proffie.getResourcesPath(), 'arduino-cli', platform, bin);
}

/**
 * Every Arduino data directory that belongs to US, newest question first: which
 * of our trees holds this core version?
 *
 * Returns { path, dirName } for the tree holding it, or null when no tree of
 * ours has it. The system tree is deliberately not searched. A core in the
 * user's Arduino15 belongs to them and to every other Proffie tool on the
 * machine, so it is never a candidate for removal and must not become one by
 * accident.
 *
 * Searches every tree of ours, which is what lets a reset remove 3.6 and 4.6
 * while 4.7 stays in use: each is targeted at its own directory rather than at
 * whatever the environment happens to point to.
 */
function findOurCoreTree(version) {
  const want = coreVersions.normalizeVersion(version);
  for (const { path: p } of listCoreTrees()) {
    const dirName = coreVersions.installedVersionString(p, want);
    if (dirName) return { path: p, dirName };
  }
  return null;
}

// The root every core tree of ours lives under. Always the prod userData path so
// installed packages are shared between dev and prod builds: in dev mode
// app.getPath('userData') is overridden to 'jmt-studio-dev', which would be
// missing the board packages.
function getCoreTreeRoot() {
  const { app } = require('electron');
  const base = app.isPackaged
    ? app.getPath('userData')
    : path.join(app.getPath('appData'), 'jmt-studio');
  return path.join(base, 'arduino-data');
}

// The pre-1.8 layout: one tree at the root, holding whatever single core the
// machine last installed. Kept as a first-class location rather than migrated,
// see getCoreTreePath.
function getLegacyCoreTreePath() {
  return getCoreTreeRoot();
}

/**
 * Where THIS core version lives, or would live.
 *
 * arduino-cli holds exactly one platform version per data directory - that is
 * why `core uninstall` refuses a version argument - so one directory can never
 * hold both 3.6 and 4.6. A user with no system Arduino tree at all therefore
 * could not have both, which is precisely the person this feature exists for.
 * One directory per core version is the only arrangement that works.
 *
 * Nothing is migrated. The pre-1.8 tree is adopted in place when it already
 * holds the version being asked for, so upgrading re-downloads nothing and there
 * is no move to half-finish. Every other version gets its own subdirectory, so
 * the legacy tree simply stops growing. (2026-08-12)
 */
function getCoreTreePath(version) {
  const want = coreVersions.normalizeVersion(version);
  const legacy = getLegacyCoreTreePath();
  if (coreVersions.installedVersionString(legacy, want)) return legacy;
  return path.join(getCoreTreeRoot(), want);
}

/**
 * Every tree of ours that currently holds a core, as { path, version }.
 *
 * The legacy tree is included when it holds one. Used by anything that has to
 * reason about the whole set rather than a single version: what is installed,
 * what a reset can reclaim, which tree an uninstall must target.
 */
// Every tree DIRECTORY, whether or not a core currently lives in it.
//
// `listCoreTrees` answers "which cores exist"; this answers "which directories
// are ours". Space accounting and the reset sweep need the second question, and
// using the first for them is a bug with a long tail. `listCoreTrees` yields a
// tree only while `listInstalled` finds a core in it, so a tree the reset has
// just emptied is excluded from the very sweep meant to include it - its
// `staging/` is skipped, and no later reset can reach it either, because the
// tree stays unlisted for as long as it holds no core.
//
// Reasoned from the call path, NOT from a disk measurement: a reading taken
// 2026-08-12 that appeared to show it was confounded by a reinstall running at
// the same time. Also catches the empty shells `runCli`'s unconditional mkdir
// leaves behind. (2026-08-12)
function listCoreTreePaths() {
  const root = getCoreTreeRoot();
  const out  = new Set([getLegacyCoreTreePath()]);
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      // Same rule as listCoreTrees: `staging` and `tmp` live here too and are
      // never trees.
      if (!/^\d+\.\d+(\.\d+)?$/.test(d.name)) continue;
      out.add(path.join(root, d.name));
    }
  } catch { /* no root yet: nothing installed */ }
  return Array.from(out);
}

function listCoreTrees() {
  const root = getCoreTreeRoot();
  const out  = [];
  const seen = new Set();

  const add = (p) => {
    const found = coreVersions.listInstalled(p);
    for (const v of found) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push({ path: p, version: v });
    }
  };

  add(getLegacyCoreTreePath());
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      // Only version-shaped subdirectories are trees. `staging` and `tmp` live
      // here too and must never be mistaken for one.
      if (!/^\d+\.\d+(\.\d+)?$/.test(d.name)) continue;
      add(path.join(root, d.name));
    }
  } catch { /* no root yet: nothing installed */ }

  return out;
}

// Retained so the many callers that just want "our data directory" keep working
// while the per-version call sites are converted. Resolves to the tree for the
// core currently in play, which is what every one of them meant.
function getArduinoDataPath() {
  return getCoreTreePath(getActiveCoreVersion());
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

// arduino-cli colours its post-build "Used library / Used platform" summary with
// ANSI SGR escapes. Nothing downstream renders them - the modal log, the Build
// Output panel and the error extractor all treat them as literal text - so they
// reach the user as `[92m` garbage in front of every column. Strip once at the
// single point every line passes through, rather than at each display site, so
// the captured stdout/stderr the classifier and size parser read is clean too.
// (2026-08-12)
//
// Imported rather than redefined: when the summariser moved to ./compileErrors.js
// it took a copy of this with it, and two copies of a stripping rule is how the
// display path and the classifier drift apart. (2026-08-15)
const { _stripAnsi } = require('./compileErrors');

// arduino-cli emits a progress line per chunk, so one 174 MB download produces
// dozens of them and buries every line that carries information. When it does
// not know the total it still divides by it:
//
//   proffieboard:stm32l4@3.6 370.95 KiB / ?  3798.50%
//
// A percentage of 78479% reads as a broken app even though the download is fine.
// The moving bar and phase label already say "working", so these carry nothing
// the user does not have, and dropping them makes `downloaded` and `installed`
// findable.
//
// Tight on purpose - a size fraction AND a percentage on one line. Compiler
// output has no such shape, so "Sketch uses 259008 bytes (98%)" is unaffected.
// (2026-08-15)
const _DL_PROGRESS_RE = /\s[\d.]+\s*(B|KiB|MiB|GiB)\s*\/\s*(\?|[\d.]+\s*(B|KiB|MiB|GiB))\s+[\d.]+%/;
function _isDownloadProgress(s) { return _DL_PROGRESS_RE.test(s); }

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

    // One resolved tree for BOTH the config file and the environment. They must
    // never disagree: a command aimed at 3.6's tree while reading 4.6's yaml is
    // reading a config whose entire content is the path of a different tree.
    const dataPath = opts.dataDir || getArduinoDataPath();
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
    // `_useIsolatedCore` says where we BUILD. It must never be read as where we
    // DELETE. On 2026-08-12 an uninstall inherited it while a system core was
    // adopted, so isolation was off, and `core uninstall proffieboard:stm32l4`
    // removed the user's OWN Arduino15 platform.
    //
    // So a destructive command never asks "are we isolated right now" - it names
    // the exact tree it means. `core uninstall` takes no version, which makes an
    // untargeted call a command to remove whatever happens to live wherever the
    // environment happens to point.
    const env = { ...process.env };
    if (!opts.raw && (opts.dataDir || _useIsolatedCore)) {
      env.ARDUINO_DIRECTORIES_DATA = dataPath;
    }

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
          parts.filter(Boolean).forEach(l => {
            const clean = _stripAnsi(l);
            if (!_isDownloadProgress(clean)) onLine(clean);
          });
        },
        flush() {
          if (buf.trim()) {
            const clean = _stripAnsi(buf);
            if (!_isDownloadProgress(clean)) onLine(clean);
          }
          buf = '';
        },
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
// Per TREE, not per app. Each core directory is a complete arduino-cli data
// directory with its own config, staging and user folders, because the config's
// whole job is to name the data directory it belongs to. One shared yaml would
// point every tree at whichever one wrote it first. Callers pass the tree they
// are about to use; omitting it means the one for the core in play.
async function ensureCliConfig(onLog, dataPath = getArduinoDataPath()) {
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

// Does the core we are actually going to build with declare this FQBN menu
// option?
//
// Only one option has ever differed between cores, and it is the one that
// matters: `pclk`, absent in 3.6 and present from 4.4 on. Compared across the
// 3.6 and 4.4 tags for both board types, usb / dosfs / speed / opt are
// identical down to cdc_msc and sdmmc1. Sending `pclk` to 3.6 rejects the whole
// FQBN before a single file compiles, which is what made 3.6 unusable here.
//
// Asked of boards.txt rather than of a version number, for the same reason the
// capability probe above is: it tests the thing that breaks and stays true when
// the next core lands.
//
// When we are NOT isolated the system core is in play, and it necessarily has
// the required option, because that is precisely what _systemCoreCanBuild
// tested to decide isolation. No second probe needed.
function _activeCoreSupports(option) {
  // Not isolated means _systemCoreCanBuild returned true, and that probe tests
  // for REQUIRED_FQBN_OPTION specifically. So that one option is known-present
  // and needs no filesystem lookup. Any other option would need its own probe;
  // there is no such caller today, and guessing true would be the kind of
  // silent wrong answer this function exists to avoid.
  if (_useIsolatedCore === false) return option === REQUIRED_FQBN_OPTION;
  return coreVersions.coreSupportsOption(getArduinoDataPath(), getActiveCoreVersion(), option);
}

/**
 * Download and install one plugin into ONE named tree.
 *
 * Extracted so the session path and the self-contained path cannot drift. The
 * tree is a parameter and never inferred, which is the property that matters:
 * arduino-cli holds one platform version per data directory, so installing
 * REPLACES, and an install that resolves its own destination can replace
 * something in a tree we do not own. (2026-08-15)
 */
async function _installCoreInto(onLog, version, dataPath, sentinelPath) {
  onLog(`Installing Proffieboard Plugin ${version} - this may take a few minutes on first run...`, false);

  // NAME THE TREE. Do not let `_useIsolatedCore` decide where an install lands.
  //
  // That flag describes the plugin currently IN PLAY, and it is session-wide and
  // mutable. Ask ensureCore for some other plugin - a background repair, a
  // version switch resolving out of order - and the flag can still be describing
  // the previous one. When it said "not isolated", ARDUINO_DIRECTORIES_DATA was
  // never set, and arduino-cli fell through to the USER'S OWN Arduino15 and
  // replaced the plugin living there. It uninstalled a working 4.6 and its
  // compiler from a tree this app is never allowed to write to.
  //
  // uninstallCore has said exactly this since 2026-08-12 - "a destructive
  // command never asks 'are we isolated right now', it names the exact tree it
  // means" - and installing is just as destructive, because arduino-cli holds
  // one platform version per data directory and installing REPLACES.
  //
  // dataPath is always one of ours here: everything above this line has already
  // returned for the adopt case. (2026-08-15)
  const opts = { dataDir: dataPath };
  await ensureCliConfig(onLog, dataPath);

  // From here until the verify below, this tree is in an indeterminate state.
  try { _beginInstall?.(version); } catch {}

  // Update index first - pass URL directly so it works regardless of config file parsing
  const update = await runCli(['core', 'update-index', `--additional-urls=${BOARD_MANAGER_URL}`], onLog, opts);
  // "Failed to update board index" describes our internal step, not the user's
  // situation. This step is a network fetch and being offline is far and away
  // the common reason it fails, so say the thing that is true - we could not
  // reach it - and name the action that fixes it. Deliberately not asserting
  // WHY it was unreachable: a proxy, DNS or the host being down all land here,
  // and "could not reach" covers every one of them. (2026-08-15)
  if (!update.ok) {
    return {
      ok: false,
      // Names what the USER wanted, not the step we were on. "Index" is
      // arduino-cli's vocabulary for a catalogue file; nobody asked for one.
      // They asked for a plugin, and they did not get it. (2026-08-15)
      error: `Could not download Proffieboard Plugin ${version}. Check your internet connection and try again.`,
    };
  }

  // Install core
  const install = await runCli(['core', 'install', `${CORE_ID}@${version}`, `--additional-urls=${BOARD_MANAGER_URL}`], onLog, opts);
  if (!install.ok) {
    return {
      ok: false,
      error: `Could not download Proffieboard Plugin ${version}. Check your internet connection and try again.`,
    };
  }

  // Verify rather than assume. arduino-cli can exit zero having resolved a
  // different version than the one asked for, and a wrong core reported as
  // right is the failure this whole path exists to prevent.
  if (!coreVersions.isVersionInstalled(dataPath, version)) {
    return {
      ok: false,
      error: `Proffieboard Plugin ${version} reported success but is not present on disk. ` +
             `Installed: ${coreVersions.listInstalled(dataPath).join(', ') || 'none'}.`,
    };
  }

  // Records the last version installed. Diagnostics only - nothing branches on it.
  try { fs.writeFileSync(sentinelPath, version, 'utf8'); } catch {}

  _ensureLinuxDfuSuffix(onLog);
  _ensureMacDfuSuffix(onLog);

  onLog(`Proffieboard Plugin installed successfully.`, false);
  try { _recordPlugin?.(version, 'jmt'); } catch {}
  // Cleared only after the on-disk verify above, so the marker never comes down
  // on the strength of an exit code alone.
  try { _endInstall?.(version); } catch {}
  return { ok: true, version, isolated: true };
}

/**
 * @param opts.activate  false = fetch this plugin WITHOUT making it the session's
 *                       active one and without touching the shared isolation
 *                       flag. For installs that serve something other than the
 *                       build in progress.
 *
 * The self-contained mode exists because the shared state is contagious. Asking
 * for a plugin used to mean adopting it: setActiveCoreVersion moved the session
 * onto it and re-decided `_useIsolatedCore`, a flag that describes where the
 * CURRENT build should come from. A background repair then left the session
 * pointing at a plugin nobody selected, and a stale isolation answer sent an
 * install into the user's own Arduino15. Restoring the pin afterwards patched
 * the symptom; not moving it is the fix. (2026-08-15)
 */
async function ensureCore(onLog, requestedVersion = null, { activate = true } = {}) {
  // Resolve the version BEFORE the tree. These lines used to be the other way
  // round, which read fine while every core shared one directory and becomes a
  // real defect the moment they do not: the install would target the previous
  // core's tree. (2026-08-12)
  if (requestedVersion && activate) setActiveCoreVersion(requestedVersion);
  const version      = activate
    ? getActiveCoreVersion()
    : coreVersions.normalizeVersion(requestedVersion);
  const dataPath     = getCoreTreePath(version);
  const sentinelPath = path.join(dataPath, '.core-installed');

  // Self-contained path. Decides isolation for THIS version only, from the disk,
  // and writes none of it back to module state.
  if (!activate) {
    if (coreVersions.isVersionInstalled(getSystemArduinoDataPath(), version)) {
      onLog(`Proffieboard Plugin ${version} is already on this system.`, false);
      try { _recordPlugin?.(version, 'system'); } catch {}
      return { ok: true, version, isolated: false };
    }
    if (coreVersions.isVersionInstalled(dataPath, version)) {
      try { _recordPlugin?.(version, 'jmt'); } catch {}
      return { ok: true, version, isolated: true };
    }
    return await _installCoreInto(onLog, version, dataPath, sentinelPath);
  }

  // Decide isolation before anything else: it determines whether "installed"
  // means the system core or ours, and it is what every later spawn keys off.
  //
  // An EXPLICIT version choice adopts the system core ONLY when that tree holds
  // exactly the version asked for, and the check happens here, at build time,
  // rather than being recorded anywhere. Another Arduino tool can change that
  // tree between builds, so a remembered answer is the 1.7.2 defect wearing a
  // new costume.
  //
  // Version-exact is what makes adoption safe. The earlier rule isolated on
  // every explicit choice on the grounds that a match would be coincidence, but
  // a coincidence you verify is just a fact: someone who picked 3.6 for a
  // flash-tight board still gets 3.6, they just do not re-download a copy of it
  // they already have. Always-isolate cost every user roughly 1.5 GB even when
  // their machine was already correct. (2026-08-12)
  if (_useIsolatedCore === null) {
    if (_coreVersionIsExplicit) {
      if (coreVersions.isVersionInstalled(getSystemArduinoDataPath(), version)) {
        _useIsolatedCore = false;
        onLog(`Proffieboard Plugin ${version} is already installed on this system. ` +
              `Building against it as-is - nothing to download, and your other Arduino ` +
              `tools are left untouched.`, false);
      } else {
        _useIsolatedCore = true;
        onLog(`Proffieboard Plugin ${version} was chosen for this ProffieOS version. ` +
              `Using JMT Studio's own copy so the build is against exactly that plugin; ` +
              `your other Arduino tools are left untouched.`, false);
      }
    } else {
      _useIsolatedCore = !(await _systemCoreCanBuild());
      if (_useIsolatedCore) {
        onLog(`The Proffieboard Plugin on this system cannot build for this board ` +
              `(no '${REQUIRED_FQBN_OPTION}' option). Using JMT Studio's own copy instead; ` +
              `your other Arduino tools are left untouched.`, false);
      }
    }
  }

  if (!_useIsolatedCore) {
    // System core is fine. Leave the machine exactly as it is - no install, no
    // download, no change from previous releases for the large majority.
    onLog(`The Proffieboard Plugin on this system can build for this board.`, false);
    _ensureLinuxDfuSuffix(onLog);
    _ensureMacDfuSuffix(onLog);
    // Adopted plugins are recorded too. If Arduino IDE later removes it, the
    // builds made with it are dormant rather than abandoned, exactly as for ours.
    try { _recordPlugin?.(version, 'system'); } catch {}
    return { ok: true, version, isolated: false };
  }

  // Isolated from here down, and now the question is version-EXACT rather than
  // "can anything here build". The old check accepted any core carrying the
  // required option, which was right when one version was allowed and every
  // other was a mistake. Once the user can choose, "some core is present" stops
  // being an answer: with 3.6 and 4.6 both installed, a capability check is
  // satisfied by the wrong one.
  //
  // The sentinel is no longer consulted for the decision. It held a single
  // version string, which cannot describe a machine with two cores on it, and
  // trusting it is what let 1.7.1 record a core it had not installed. The
  // directory check below is cheap and is actual evidence, so it does the work.
  if (coreVersions.isVersionInstalled(dataPath, version)) {
    onLog(`Proffieboard Plugin ${version} already installed.`, false);
    try { fs.writeFileSync(sentinelPath, version, 'utf8'); } catch {}
    _ensureLinuxDfuSuffix(onLog);
    _ensureMacDfuSuffix(onLog);
    try { _recordPlugin?.(version, 'jmt'); } catch {}
    return { ok: true, version, isolated: true };
  }

  return await _installCoreInto(onLog, version, dataPath, sentinelPath);
}

// Remove a core we installed, through arduino-cli rather than by deleting
// directories. The CLI owns that layout and knows how the platform relates to
// its tools; hand-deleting risks leaving the package index describing something
// that is no longer there.
//
// Refuses to remove the core currently in play. A reset that leaves the app
// unable to build is not a reset.
async function uninstallCore(onLog, version) {
  const target = coreVersions.normalizeVersion(version);
  if (target === getActiveCoreVersion()) {
    return { ok: false, error: `Proffieboard Plugin ${target} is in use and was not removed.` };
  }

  // Find the tree that holds THIS version, among ours only. The system tree is
  // never searched, so it can never be the thing removed.
  const tree = findOurCoreTree(target);
  if (!tree) {
    // Present in the system tree but not in any of ours: theirs to keep, and
    // saying so beats a silent success that implies we removed something.
    if (coreVersions.isVersionInstalled(getSystemArduinoDataPath(), target)) {
      return { ok: false, error: `Proffieboard Plugin ${target} belongs to your own Arduino installation and was left alone.` };
    }
    return { ok: true, version: target, alreadyAbsent: true };
  }

  // `core uninstall` takes PACKAGER:ARCH and REFUSES a version:
  //
  //     Invalid parameter proffieboard:stm32l4@3.6: version not allowed
  //
  // arduino-cli holds one platform version per data directory, so there is
  // nothing to disambiguate and the flag does not exist. We were passing
  // `@3.6.0`, which failed on the version being present at all rather than on
  // its format, removed nothing, and surfaced nowhere. Verified against the CLI
  // itself rather than reasoned about. (2026-08-12)
  //
  // Removing the arch removes whatever version that tree holds, which is why the
  // resolve above runs first and why the tree is named explicitly here: the two
  // together mean this can only ever delete the core it was asked to delete.
  const res = await runCli(['core', 'uninstall', CORE_ID], onLog, { dataDir: tree.path });
  if (!res.ok) return { ok: false, error: `Could not remove Proffieboard Plugin ${target}.` };

  // Verify rather than trust the exit code, the same way install does, and
  // verify in the tree we actually targeted.
  if (coreVersions.isVersionInstalled(tree.path, target)) {
    return { ok: false, error: `Proffieboard Plugin ${target} reported removed but is still present.` };
  }
  // The ONLY place intent is dropped. Reaching here means the user chose to
  // remove this plugin through Reset Build Space, which already counts and warns
  // about the builds that stops being usable. Anything else - a pin moving, a
  // directory vanishing - leaves the record standing, which is the whole point.
  try { _forgetPlugin?.(target); } catch {}
  return { ok: true, version: target, tree: tree.path };
}

/**
 * Cancel an install that is still running, and leave nothing half-written.
 *
 * A plain kill is not enough. arduino-cli unpacks as it goes, so an interrupted
 * install leaves a partly populated platform directory that `listInstalled`
 * may well report as present - a plugin that exists, cannot build, and would be
 * trusted by every check that asks "is it installed". Worse than no plugin.
 *
 * Deleting the whole directory is safe here BY CONSTRUCTION, and the guards
 * below are what make that true rather than hopeful:
 *   - it is under our own tree root, never the user's Arduino15
 *   - it is never the legacy root, which holds shared config and builtin tools
 *   - the name is version-shaped, so `staging` and `tmp` can never be the target
 * A versioned tree is a container we created to hold exactly one plugin, so if
 * that plugin never finished arriving the container has no other contents worth
 * keeping. Same reasoning the reset already uses to remove emptied trees.
 *
 * Does NOT touch `_aborted`. That flag belongs to the compile path, and setting
 * it here would make the next compile believe it had been cancelled.
 * (2026-08-15)
 */
async function cancelCoreInstall(version) {
  const target = coreVersions.normalizeVersion(version);
  if (!/^\d+\.\d+\.\d+$/.test(target)) {
    return { ok: false, error: 'Not a plugin version.' };
  }

  if (_currentProc) {
    try { _killTree(_currentProc); } catch {}
  }

  // Windows keeps file handles open until the tree is actually dead, so a
  // delete issued immediately fails with EBUSY. Wait for runCli's close handler
  // to clear the process, with a ceiling so a wedged kill cannot hang the UI.
  const deadline = Date.now() + 4000;
  while (_currentProc && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));
  }

  const root   = getCoreTreeRoot();
  const legacy = getLegacyCoreTreePath();
  const dir    = path.join(root, target);
  if (dir === legacy || !dir.startsWith(root + path.sep)) {
    return { ok: false, error: 'Refusing to remove that directory.' };
  }
  if (!fs.existsSync(dir)) return { ok: true, version: target, removed: false };

  // One retry: a handle can outlive the process by a moment.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true, version: target, removed: true };
    } catch (e) {
      if (attempt === 1) return { ok: false, error: `Could not remove the partial install: ${e.message}` };
      await new Promise(r => setTimeout(r, 400));
    }
  }
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

  // What this build is made of, stated before anything is staged.
  //
  // The log used to open with the config path and nothing else, so a build was
  // not self-describing: none of the four inputs that decide whether it links
  // appeared anywhere in it. The plugin was the worst of them - ensureCore is
  // the only code that ever names one and it runs at startup, so a normal
  // compile never printed the compiler that was about to read the config.
  //
  // Raw values on purpose. These are what arduino-cli is handed, so a log
  // pasted into a forum thread carries the real FQBN rather than a label only
  // this app uses. The friendly names live in the UI, where the user is looking
  // at the control that set them.
  //
  // The plugin's TREE is part of the fact, not decoration: the same version
  // number can be the user's own Arduino install or our copy, and which one is
  // in play is the first thing worth knowing about a build behaving oddly.
  // Isolation is resolved above, so this reports the real answer. (2026-08-15)
  onLog(`Board:               ${fqbn}`, false);
  onLog(`ProffieOS:           ${proffie.getSelectedVersion() || 'unknown'}`, false);
  onLog(`Proffieboard Plugin: ${getActiveCoreVersion()} ` +
        `(${_useIsolatedCore ? 'JMT Studio' : 'system'})`, false);
  onLog(`USB:                 ${usb}`, false);

  const refCheck = proffie.ensureConfigFileRef(onLog);
  if (!refCheck.ok) { onLog(refCheck.error, true); return { ok: false, error: refCheck.error }; }

  const staged = proffie.stageConfig(configContent);
  if (!staged.ok) { onLog(staged.error, true); return { ok: false, error: staged.error }; }
  // Padded to the same column as the build-identity block above, so the opening
  // of every compile log reads as one aligned run rather than four tidy lines
  // and a ragged one. (2026-08-15)
  onLog(`Config staged to:    ${staged.stagedPath}`, false);

  const sketchPath = proffie.getProffieOSRoot();
  const buildPath  = getBuildOutputPath();
  fs.mkdirSync(buildPath, { recursive: true });

  // dosfs=sdmmc1 uses SDIO high-speed on V3 (L452RE); V1/V2 only support sdspi
  const dosfs = fqbn.includes('L452') ? 'sdmmc1' : 'sdspi';

  // Composed rather than hardcoded, because the option set is not the same on
  // every core. `pclk` does not exist before 4.4, and passing an option a core
  // does not declare rejects the FQBN outright - the build fails in 0:00 with
  // "invalid option 'pclk'" and nothing is compiled. Every other option here is
  // present on both 3.6 and 4.6, so this is the only conditional needed.
  const fqbnOptions = [`usb=${usb}`, `dosfs=${dosfs}`, 'speed=80', `opt=${opt}`];
  if (_activeCoreSupports('pclk')) fqbnOptions.push('pclk=2');

  const args = [
    'compile',
    '--fqbn', `${fqbn}:${fqbnOptions.join(',')}`,
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
    onLog('The Proffieboard Plugin on this system cannot build for this board. ' +
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
    coreVersion: getActiveCoreVersion(),
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
          getActiveCoreVersion(), new Date().toISOString(), app.getVersion(),
          stylesContent, durationMs, buildOptions && buildOptions.configId);
      } catch {}
    }
    // coreVersion rides along so the renderer can stamp @jmt:core without a
    // second IPC round trip, and so the marker records the core that actually
    // produced THIS build rather than whatever is selected by the time the
    // event is handled.
    // osVersion rides along for the same reason coreVersion does, and it has to
    // come from HERE rather than from the renderer's dropdown: this is the tree
    // that was actually staged and compiled, read at the moment it succeeded.
    // The dropdown is a setting the user can move mid-build, and @jmt:os_version
    // follows it to disk on any save - so neither can stand in for "the version
    // this binary was built from". (2026-08-15)
    // The board and USB mode go back too, and for a reason beyond this app: a
    // config gets pasted into a forum thread when someone needs help, and a
    // helper reads its markers as facts about the saber. @jmt:board and
    // @jmt:usb are SETTINGS - they follow the dropdowns to disk on any save -
    // so "usb = cdc_msc" can mean "mass storage was flashed to this board" or
    // "they ticked the box once and never built". Those two diagnoses are
    // nothing alike, and mass storage without MOUNT_SD_SETTING is the setting
    // that corrupts SD cards.
    //
    // The FQBN rather than the friendly name: it is what was handed to
    // arduino-cli, it is unambiguous about the board variant, and it matches
    // the identity block printed at the top of the build log. (2026-08-15)
    return {
      ok: true, buildPath, durationMs,
      coreVersion:   getActiveCoreVersion(),
      osVersion:     proffie.getSelectedVersion(),
      compiledFqbn:  fqbn,
      compiledUsb:   usb,
      ...sizeReport,
    };
  } else {
    _aborted = false;
    if (wasAborted) {
      onLog('--- Compile aborted ---', true);
      clearPartialBuild(buildPath);
      return { ok: false, aborted: true, error: 'Compile aborted' };
    }
    onLog('--- Compile failed ---', true);
    // Capacity comes from the same output being summarised, so it can never
    // describe a different board than the one that failed.
    const cleanError = extractCompileError(result.stderr + result.stdout,
                                           _boardCapacityFrom(result.stdout));
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
// A line that is an echoed command, not a message. arduino-cli prints the full
// Compile-failure summarisation moved to ./compileErrors.js so the test suite can
// import the SAME code it checks - it previously kept a private copy, which passed
// while this one was broken. See that file's header. (2026-08-15)
const { extractCompileError } = require('./compileErrors');

// What the board can hold, for the message shown when a build does not fit.
//
// `Sketch uses X of Y` is printed by arm-none-eabi-size, which arduino-cli runs
// only AFTER a successful link - so on the one failure where the capacity matters
// most, it was never printed. The linker reports the shortfall and nothing else.
//
// Read from the boards.txt of the platform arduino-cli ACTUALLY used, which it
// names in its own output. Taking it from there rather than rebuilding the path
// is what makes this correct whether the plugin was adopted from the system tree
// or installed into one of ours - the two are different directories and only the
// output knows which one won.
//
// Returns null rather than a guess. A message that omits the capacity is worse
// than one that invents it. (2026-08-15)
const _PLATFORM_LINE_RE =
  /Using board '([^']+)' from platform in folder:\s*(.+?)\s*$/m;

function _boardCapacityFrom(output) {
  const m = String(output || '').match(_PLATFORM_LINE_RE);
  if (!m) return null;
  const [, boardId, platformDir] = m;
  try {
    const txt = fs.readFileSync(path.join(platformDir, 'boards.txt'), 'utf8');
    const esc = boardId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const max  = txt.match(new RegExp(`^${esc}\\.upload\\.maximum_size=(\\d+)`, 'm'));
    const name = txt.match(new RegExp(`^${esc}\\.name=(.+)$`, 'm'));
    if (!max) return null;
    return {
      boardName: name ? name[1].trim() : boardId,
      maxFlash:  Number(max[1]),
    };
  } catch { return null; }
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
          // Keep the diagnostic, drop what is not diagnostic. dfu-util prints a copyright and
          // warranty banner on every run, and on a busy machine it also reports failing to open
          // USB devices that have nothing to do with us - a webcam, a keyboard. Verbatim, that
          // handed a maker a licence notice and someone else's hardware ID as the explanation for
          // their flash failing.
          //
          // Anything mentioning OUR ids survives untouched, and so does any other genuine error,
          // because that is the whole reason this line exists. (2026-08-14)
          const BOILERPLATE = /copyright|free software|absolutely no warranty|report bugs|^dfu-util \d/i;
          const OUR_IDS     = /0483:df11|1209:6668/i;
          // "Cannot open DFU device 04f2:b6cb" for a device that is not a Proffieboard bootloader.
          const OTHER_DEVICE = /cannot open dfu device\s+([0-9a-f]{4}:[0-9a-f]{4})/i;

          const kept = lines
            .map(l => l.trim())
            .filter(Boolean)
            .filter(l => !BOILERPLATE.test(l))
            .filter(l => {
              const m = l.match(OTHER_DEVICE);
              return !m || OUR_IDS.test(m[1]);   // drop failures about other people's hardware
            })
            .slice(-4);

          onLog(kept.length
            ? `dfu-util reported: ${kept.join(' | ')}`
            : 'dfu-util did not find a Proffieboard bootloader.', false);
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

function checkCacheAndRestore(configContent, fqbn, usb, configId = null) {
  const proffieOSHash = proffie.hashVersion(proffie.getSelectedVersion());
  const stylesContent = proffie.readStagedStyles();
  return cache.checkAndRestore(configContent, fqbn, usb, proffieOSHash,
    getActiveCoreVersion(), stylesContent, configId);
}

// Drives the first-run setup banner. Asks about the version actually in play
// rather than a constant, so choosing a core the machine does not have yet
// surfaces the same honest "installing, this takes a few minutes" flow a first
// launch gets, instead of a silent stall inside the first compile.
//
// Reads the directory, not the sentinel. A single version string cannot
// describe a machine with two cores installed, and the sentinel saying "4.6"
// tells us nothing about whether the 3.6 someone just selected is present.
/**
 * Will starting a build actually DOWNLOAD something?
 *
 * Its only caller sends the `toolchain-setup` signal, which opens the build log and shows the
 * setup notice - a promise that a download is beginning. So the question it has to
 * answer is "is a download coming", not "is this version in our own tree".
 *
 * It used to ask the second, checking `getArduinoDataPath()` alone. That tree is ours, and it
 * ignores the system Arduino install we are perfectly willing to adopt - so anyone who already had
 * the Proffieboard Plugin from Arduino IDE, and anyone who had just run Reset Build Space, was told
 * JMT Studio was setting up a plugin and had the log panel opened for a download that never
 * happened. The worst instance is a genuine first run: most people arrive having already installed
 * the plugin by following pod.hubbe.net.
 *
 * `listAvailableCores()` is the same merged, version-exact view (system tree plus every tree of
 * ours) that the picker and the reset already use, so this answer cannot drift from theirs.
 * Adoption is still decided at build time by ensureCore; this only decides whether to promise a
 * download. (2026-08-14)
 */
function needsCoreInstall(version = null) {
  const want = coreVersions.normalizeVersion(version || getActiveCoreVersion());
  return !listAvailableCores()
    .some(c => coreVersions.normalizeVersion(c.version) === want);
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

  // Core version selection. CORE_VERSION used to be exported as a constant;
  // callers now ask for the version in play, because it changes per ProffieOS
  // version and a stale copy of it is how the build and the cache disagree.
  getActiveCoreVersion,
  setActiveCoreVersion,
  ensureCore,
  uninstallCore,
  cancelCoreInstall,
  setPluginHooks,

  // Where our own copy of the core lives. Exported for the same reason
  // coreCanBuildAt is: anything asking about installed cores has to look in the
  // directory the compiler will actually use. portDetector still keeps a local
  // copy of this rule, which is a drift risk worth collapsing separately.
  getArduinoDataPath,
  getCoreTreeRoot,
  getCoreTreePath,
  getLegacyCoreTreePath,
  listCoreTrees,
  listCoreTreePaths,
  getSystemArduinoDataPath,
  listAvailableCores,

  // Exported so portDetector can look for the core in the same place the
  // compiler does. Duplicating the rule is how the two drift apart, and a
  // board list reading a different directory than the compile is exactly the
  // class of bug this release exists to fix.
  coreCanBuildAt: _ourCoreCanBuild
};