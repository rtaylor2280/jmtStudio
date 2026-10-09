/**
 * proffieos.js
 * Manages ProffieOS source versions and config staging.
 *
 * Versions live under userData/proffieOS_versions/{version_name}/ProffieOS/.
 * One version is "selected" per session; its ProffieOS folder is hashed once
 * and cached in memory for cache validation.
 *
 * No versions are bundled with the app — users import or download them.
 */

const { app } = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
// Shared because a directory something still holds open cannot be removed on
// Windows, and this app had grown three separate answers to that. Used here to
// clear a half-copied version tree after a cancel.
const fsRemove = require('./fsRemove');

// ── Constants ──────────────────────────────────────────
const CONFIG_FILENAME  = 'my_config.h';
const STYLES_FILENAME  = 'my_styles.h';

// ── Version state ──────────────────────────────────────
let _selectedVersion = null;
const _hashCache = new Map(); // versionName → hash string
const _osVersionCache = new Map(); // versionName → "v8.10" | null

// ── Path helpers ───────────────────────────────────────

// All versions live in userData — writable, survives reinstalls, not shipped with app.
function getUserVersionsPath() {
  return path.join(app.getPath('userData'), 'proffieOS_versions');
}

// User's persistent my_styles.h — source of truth; copied to config dir at compile time.
function getUserStylesPath() {
  return path.join(app.getPath('userData'), STYLES_FILENAME);
}

function hasUserStyles() {
  return fs.existsSync(getUserStylesPath());
}

function importStylesFile(sourcePath) {
  try {
    fs.copyFileSync(sourcePath, getUserStylesPath());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function deleteUserStyles() {
  try {
    const p = getUserStylesPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Internal: resolves a version folder in userData.
function _resolveVersionFolder(name) {
  const userPath = path.join(getUserVersionsPath(), name);
  if (fs.existsSync(userPath)) return { folderPath: userPath, source: 'user' };
  return null;
}

// Returns alphabetically sorted list of available version names.
function listVersions() {
  const root = getUserVersionsPath();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort().reverse();
}

// ProffieOS source path for a given version name.
function getVersionSourcePath(versionName) {
  const resolved = _resolveVersionFolder(versionName);
  return resolved ? path.join(resolved.folderPath, 'ProffieOS') : path.join(getUserVersionsPath(), versionName, 'ProffieOS');
}

// ── Reported OS version ────────────────────────────────

/**
 * The ProffieOS version a tree actually IS, read from its own source rather
 * than inferred from the folder name. Folder names are whatever the user typed
 * ("Test ProffieOS 8.10 (copy)"); this is the string the firmware reports over
 * serial, so it is the only value that can be compared against a live board.
 *
 * Returns "v8.10" style, or null if the line is missing (a hand-edited or
 * partial tree). Cached — an installed tree's version never changes.
 */
function getVersionOSVersion(versionName) {
  if (_osVersionCache.has(versionName)) return _osVersionCache.get(versionName);
  let found = null;
  try {
    const ino = path.join(getVersionSourcePath(versionName), 'ProffieOS.ino');
    const m = fs.readFileSync(ino, 'utf8').match(/^const\s+char\s+version\s*\[\s*\]\s*=\s*"([^"]+)"/m);
    if (m) found = m[1].trim();
  } catch { /* unreadable tree → null, caller degrades */ }
  _osVersionCache.set(versionName, found);
  return found;
}

// { versionName → "v8.10" | null } for every installed tree.
function getOSVersionMap() {
  const map = {};
  for (const name of listVersions()) map[name] = getVersionOSVersion(name);
  return map;
}

// ── Version selection ──────────────────────────────────

function setSelectedVersion(name) {
  _selectedVersion = name;
}

function getSelectedVersion() {
  if (_selectedVersion) return _selectedVersion;
  const versions = listVersions();
  return versions.length > 0 ? versions[0] : null;
}

// ── Folder hashing ─────────────────────────────────────

/**
 * Recursively hashes all files in a directory, sorted by relative path
 * for stability. Returns a 16-char hex string.
 * Result is cached in memory by versionName — computed at most once per session.
 */
function hashVersion(versionName) {
  if (_hashCache.has(versionName)) return _hashCache.get(versionName);

  const dirPath = getVersionSourcePath(versionName);
  const hash    = crypto.createHash('sha256');

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel      = path.relative(dirPath, fullPath);
      if (entry.isDirectory()) {
        // Skip config/ — it's the user-variable slot, tracked separately by configHash
        if (entry.name === 'config' && dir === dirPath) continue;
        walk(fullPath);
      } else {
        hash.update(rel + '\0');
        // For ProffieOS.ino, skip the CONFIG_FILE define line — we manage that
        // line ourselves via ensureConfigFileRef(), so it must not affect the hash.
        if (entry.name === 'ProffieOS.ino' && dir === dirPath) {
          const content = fs.readFileSync(fullPath, 'utf8')
            .split(/\r?\n/)
            .filter(l => !/^\s*(?:\/\/)?\s*#\s*define\s+CONFIG_FILE\b/.test(l))
            .join('\n');
          hash.update(content);
        } else {
          hash.update(fs.readFileSync(fullPath));
        }
        hash.update('\0');
      }
    }
  }

  walk(dirPath);
  const result = hash.digest('hex').slice(0, 16);
  _hashCache.set(versionName, result);
  return result;
}

// In-memory hash cache is computed once per versionName per session. When something
// programmatically modifies a version's source files (currently: JMT add-on apply),
// the cached value goes stale and the compile-cache check returns false hits. The
// caller must drop the cached entry so the next hashVersion() walks the folder fresh.
function invalidateVersionHash(versionName) {
  if (versionName) _hashCache.delete(versionName);
  else _hashCache.clear();
}

// ── ArgumentName enum ──────────────────────────────────
// ProffieOS defines `enum ArgumentName { BASE_COLOR_ARG = 1, ALT_COLOR_ARG = 2, ... }`
// in styles/edit_mode.h. The enum's slot numbers determine where each arg lands in a
// StylePtr<>("…") parens string: slots are space-separated, `~` for empty, with
// multi-component values like RGB (`65535,0,0`) staying as a single comma-joined
// slot token.
//
// We can't hardcode the list because args differ between OS versions (e.g.
// RETRACTION_OPTION2_ARG was added after 6.x). Reading from the user's selected
// version is authoritative. Cached per-versionName to avoid repeated file reads
// during preset list render / slot tile build / arg editor open; invalidated on
// programmatic source mutation (currently: JMT add-on apply) the same way
// _hashCache is.
//
// Returns an array of { name, comment, slot } objects, sorted by slot ascending.
// The line-comment (// …) following each entry is captured for use as a tooltip on
// arg labels. Alias entries (e.g. `LAST_ARG = RETRACTION_OPTION2_ARG`) are skipped
// — they reference another slot rather than defining a new one.
const _argumentNamesCache = new Map(); // versionName → Array<{name, comment, slot}>

function getArgumentNames(versionName) {
  if (!versionName) return [];
  if (_argumentNamesCache.has(versionName)) return _argumentNamesCache.get(versionName);
  const editModePath = path.join(getVersionSourcePath(versionName), 'styles', 'edit_mode.h');
  const entries = [];
  try {
    if (fs.existsSync(editModePath)) {
      const text = fs.readFileSync(editModePath, 'utf8');
      // Match `enum ArgumentName { ... }` (optionally `: type`); first match wins.
      const m = text.match(/\benum\s+ArgumentName\b[^{]*\{([\s\S]*?)\}/);
      if (m) {
        // Strip block comments first (rare in this enum but safe), then walk lines.
        // One entry per line is the convention; if the user's enum is one-liner the
        // parser yields no entries and callers see an empty array.
        const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
        let nextSlot = 1;
        for (const rawLine of body.split(/\r?\n/)) {
          const cmtIdx = rawLine.indexOf('//');
          const comment = cmtIdx >= 0 ? rawLine.slice(cmtIdx + 2).trim() : '';
          // Strip the comment, trailing comma, and surrounding whitespace
          const code = (cmtIdx >= 0 ? rawLine.slice(0, cmtIdx) : rawLine)
            .replace(/,/g, '')
            .trim();
          if (!code) continue;
          const lm = code.match(/^([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/);
          if (!lm) continue;
          const name = lm[1];
          const valueRaw = lm[2] && lm[2].trim();
          let slot;
          if (valueRaw) {
            if (/^\d+$/.test(valueRaw)) {
              slot = parseInt(valueRaw, 10);
              nextSlot = slot + 1;
            } else {
              // Alias entry (NAME = OTHER_NAME) — skip; it's not a new slot.
              continue;
            }
          } else {
            slot = nextSlot++;
          }
          entries.push({ name, comment, slot });
        }
      }
    }
  } catch { /* swallow — empty array signals "unknown enum" to callers */ }
  _argumentNamesCache.set(versionName, entries);
  return entries;
}

function invalidateArgumentNames(versionName) {
  if (versionName) _argumentNamesCache.delete(versionName);
  else _argumentNamesCache.clear();
}

// ── Workspace (packaged only) ──────────────────────────

// The writable workspace in userData — must be named "ProffieOS" to match
// ProffieOS.ino (arduino-cli requires the folder to match the sketch name).
function getWorkspacePath() {
  return path.join(app.getPath('userData'), 'ProffieOS');
}

// Tracks which version is currently copied into the workspace.
function getWorkspaceVersionFilePath() {
  return path.join(getWorkspacePath(), '_version.txt');
}

function getWorkspaceVersion() {
  const p = getWorkspaceVersionFilePath();
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null; }
  catch { return null; }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// The same copy, but the event loop stays alive and a cancel can land. [B-488]
//
// ⭐⭐ WHY THIS EXISTS BESIDE copyDirSync RATHER THAN REPLACING IT. This hit the
// version import with the window reading "JMT Studio (Not Responding)" and the
// dialog's Cancel unavailable. `copyDirSync` is a synchronous recursive walk, and
// Electron routes frame presentation AND input dispatch through the main process,
// so for the whole copy the app cannot repaint and cannot receive the cancel IPC
// — the button is not ignoring the click, nothing is listening. Exactly the shape
// written up in [B-462] for the bulk scan.
//
// ⚠️ MEASURED on a real source (346 files, 2.6 MB, read from a Drive-backed
// folder): 2,092 ms cold, 1,638 ms warm, 893 ms local-to-local. Short, and that
// is the point — the blocking time scales with whatever the user points at, and
// nothing bounds what that is.
//
// ⚠️ THE OTHER TWO copyDirSync CALLERS ARE LEFT ALONE ON PURPOSE (`initWorkspace`
// and the prop copy). They are different doors with their own sizes and their own
// walk entries; converting them is not this fix.
//
// ⚠️⚠️ YIELDS ON A TIME BUDGET, NOT A FILE COUNT, AND THAT CORRECTION CAME FROM
// TESTING IT. The first cut yielded every 24 files and it was reported "still
// went briefly unresponsive because I tried to click again and it wasn't showing
// canceling". A COUNT CANNOT BOUND THE BLOCK: a ProffieOS tree holds both 2 KB
// headers and much larger assets, so 24 files is a few milliseconds in one folder
// and a visible stall in another. Budgeting by elapsed time bounds it regardless
// of what the files turn out to be.
//
// One frame at 60 Hz is ~16 ms, so that is the ceiling on how long a click can sit
// unpainted. The cost is more setImmediate calls on fast trees, which is cheap
// next to a window that does not answer.
const YIELD_AFTER_MS = 16;

async function copyDirCancellable(src, dest, opts = {}) {
  const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : () => false;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  let copied = 0;
  let lastYield = Date.now();

  async function walk(s, d) {
    if (shouldStop()) return false;
    fs.mkdirSync(d, { recursive: true });
    for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
      if (shouldStop()) return false;
      const sp = path.join(s, entry.name);
      const dp = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!await walk(sp, dp)) return false;
      } else {
        fs.copyFileSync(sp, dp);
        copied++;
        if (Date.now() - lastYield >= YIELD_AFTER_MS) {
          lastYield = Date.now();
          onProgress({ copied });
          // Hand the loop back so a repaint and the cancel IPC can happen. The
          // check above means this costs at most one frame of latency on the
          // click, whatever the files weigh.
          await new Promise((r) => setImmediate(r));
        }
      }
    }
    return true;
  }

  const finished = await walk(src, dest);
  onProgress({ copied });
  return { completed: finished, copied };
}

/**
 * Ensures the selected version is in the writable workspace.
 * No-op in dev (source is already writable).
 * Re-copies if the workspace holds a different version.
 */
function initWorkspace(onLog) {
  if (!app.isPackaged) return { ok: true };

  const version = getSelectedVersion();
  if (!version) return { ok: false, error: 'No ProffieOS version available.' };

  const workspace        = getWorkspacePath();
  const workspaceVersion = getWorkspaceVersion();

  if (workspaceVersion === version && fs.existsSync(path.join(workspace, 'ProffieOS.ino'))) {
    return { ok: true };
  }

  const source = getVersionSourcePath(version);
  if (onLog) onLog(`Setting up ProffieOS workspace for ${version}...`, false);

  try {
    if (fs.existsSync(workspace)) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
    copyDirSync(source, workspace);
    fs.writeFileSync(getWorkspaceVersionFilePath(), version, 'utf8');
    if (onLog) onLog('Workspace ready.', false);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to set up ProffieOS workspace:\n${e.message}` };
  }
}

// ── Compile paths ──────────────────────────────────────

// The root used for compilation and config staging.
function getProffieOSRoot() {
  if (app.isPackaged) return getWorkspacePath();
  const version = getSelectedVersion();
  return version ? getVersionSourcePath(version) : null;
}

function getConfigStagingPath() {
  return path.join(getProffieOSRoot(), 'config', CONFIG_FILENAME);
}


function getInoPath() {
  return path.join(getProffieOSRoot(), 'ProffieOS.ino');
}

// ── Validation ─────────────────────────────────────────

/**
 * Validates the selected version's source in resources.
 * Called before initWorkspace to confirm source exists before copying.
 */
function validateProffieOSSource() {
  const version = getSelectedVersion();
  if (!version) {
    return { ok: false, error: `No ProffieOS versions found. Please import or download a version first.` };
  }

  const root = getVersionSourcePath(version);
  if (!fs.existsSync(root)) {
    return { ok: false, error: `ProffieOS source not found at:\n${root}` };
  }

  const ino = path.join(root, 'ProffieOS.ino');
  if (!fs.existsSync(ino)) {
    return { ok: false, error: `ProffieOS.ino not found at:\n${ino}` };
  }

  const configDir = path.join(root, 'config');
  if (!fs.existsSync(configDir)) {
    return { ok: false, error: `Config directory not found at:\n${configDir}` };
  }

  return { ok: true };
}

// ── CONFIG_FILE reference guard ────────────────────────

/**
 * Ensures ProffieOS.ino has exactly one correct #define CONFIG_FILE line.
 * - If correct line exists and no others → no-op
 * - If correct line exists but others also present → comment out the others
 * - If correct line is absent → insert it before the first existing define (or
 *   after the opening comment block if none exist), comment out any wrong ones
 */
function ensureConfigFileRef(onLog) {
  const inoPath = getInoPath();
  let content;
  try { content = fs.readFileSync(inoPath, 'utf8'); }
  catch (e) { return { ok: false, error: `Cannot read ProffieOS.ino: ${e.message}` }; }

  const targetDefine = `#define CONFIG_FILE "config/${CONFIG_FILENAME}"`;
  const lineEnding   = content.includes('\r\n') ? '\r\n' : '\n';
  const lines        = content.split(/\r?\n/);

  const isDefine  = l => /^\s*#\s*define\s+CONFIG_FILE\b/.test(l);
  const isCorrect = l => /^\s*#\s*define\s+CONFIG_FILE\s+"config\/my_config\.h"\s*$/.test(l);

  // Only track defines at the top level — skip anything inside #if/#ifdef blocks.
  // ProffieOS.ino has #define CONFIG_FILE inside #ifdef CONFIG_FILE_TEST which must not
  // be mistaken for an unconditional define.
  let depth = 0;
  const defineIdxs = [];
  lines.forEach((l, i) => {
    if (/^\s*#\s*if(?:def|ndef)?\b/.test(l)) { depth++; return; }
    if (/^\s*#\s*endif\b/.test(l))            { depth--; return; }
    if (depth === 0 && isDefine(l)) defineIdxs.push(i);
  });
  const correctIdx = defineIdxs.find(i => isCorrect(lines[i]));

  // Already exactly right — nothing to do
  if (defineIdxs.length === 1 && correctIdx !== undefined) return { ok: true };

  const newLines = [...lines];
  let changed = false;

  // Comment out all wrong top-level CONFIG_FILE defines
  defineIdxs.forEach(i => {
    if (!isCorrect(newLines[i])) {
      newLines[i] = `// ${newLines[i].trim()} // [JMT Studio: replaced]`;
      changed = true;
    }
  });

  // Insert correct define if missing — place it just before the #ifndef CONFIG_FILE guard
  if (correctIdx === undefined) {
    let insertAt;
    const ndefIdx = lines.findIndex(l => /^\s*#\s*ifndef\s+CONFIG_FILE\b/.test(l));
    if (ndefIdx >= 0) {
      insertAt = ndefIdx;
    } else if (defineIdxs.length > 0) {
      insertAt = defineIdxs[0];
    } else {
      insertAt = 0;
    }
    newLines.splice(insertAt, 0, targetDefine);
    changed = true;
  }

  if (!changed) return { ok: true };

  try {
    fs.writeFileSync(inoPath, newLines.join(lineEnding), 'utf8');
    if (onLog) onLog('CONFIG_FILE reference corrected in ProffieOS.ino.', false);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Cannot write ProffieOS.ino: ${e.message}` };
  }
}

// ── Config staging ─────────────────────────────────────

/**
 * Writes config content to the workspace staging path.
 * Returns { ok: true, stagedPath } or { ok: false, error: string }
 */
function stageConfig(configContent) {
  if (!configContent || configContent.trim() === '') {
    return { ok: false, error: 'Config is empty. Open or edit a config file before compiling.' };
  }

  const stagingPath = getConfigStagingPath();

  try {
    fs.mkdirSync(path.dirname(stagingPath), { recursive: true });
    fs.writeFileSync(stagingPath, configContent, 'utf8');
    return { ok: true, stagedPath: stagingPath };
  } catch (e) {
    return { ok: false, error: `Failed to stage config:\n${e.message}` };
  }
}

/**
 * Reads the currently staged config back (for verification or display).
 */
function readStagedConfig() {
  const p = getConfigStagingPath();
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
  catch { return null; }
}

// ── Styles staging ─────────────────────────────────────

function stageStyles(content) {
  try {
    fs.writeFileSync(getUserStylesPath(), content || '', 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function readStagedStyles() {
  const p = getUserStylesPath();
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }
  catch { return ''; }
}

// ── Import ─────────────────────────────────────────────

/**
 * Copies an existing ProffieOS source folder into the versions directory
 * under a user-supplied name. sourcePath must be a folder named "ProffieOS"
 * containing ProffieOS.ino.
 */
// coreVersion is stamped at import time so every tree carries the core that was
// current when it arrived. Passed in rather than resolved here: resolving means
// a network call, this function is synchronous, and proffieos cannot require
// toolchain without a cycle. Omitting it leaves the version following latest,
// which is the correct degradation rather than a failure.
async function importVersion(sourcePath, versionName, proffieVersion, coreVersion, opts = {}) {
  if (path.basename(sourcePath) !== 'ProffieOS') {
    return { ok: false, error: 'Selected folder must be named "ProffieOS".' };
  }
  const name = (versionName || '').trim();
  if (!name) {
    return { ok: false, error: 'Version name is required.' };
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    return { ok: false, error: 'Version name contains invalid characters.' };
  }
  if (!fs.existsSync(path.join(sourcePath, 'ProffieOS.ino'))) {
    return { ok: false, error: 'Selected folder does not contain ProffieOS.ino — is this a valid ProffieOS source?' };
  }
  const dest = path.join(getUserVersionsPath(), name, 'ProffieOS');
  if (fs.existsSync(dest)) {
    return { ok: false, error: `A version named "${name}" already exists.` };
  }
  try {
    // ⚠️ A CANCEL MUST NOT LEAVE A HALF-COPIED VERSION ON THE LIST. The version
    // directory is created here, so if we created it and the copy did not finish,
    // it is ours to remove — and `versionDir` is the whole of what we made, which
    // is why the removal targets it rather than `dest`. The existsSync guard
    // above already refused a name that was in use, so this can only ever remove
    // a tree this call brought into being. [B-488]
    const versionDir = path.dirname(dest);
    fs.mkdirSync(versionDir, { recursive: true });
    const copy = await copyDirCancellable(sourcePath, dest, opts);
    if (!copy.completed) {
      try { await fsRemove.rmWithRetry(versionDir); } catch { /* best effort */ }
      return { ok: false, cancelled: true, error: 'Import cancelled.' };
    }
    const ver  = (proffieVersion || '').trim();
    const core = (coreVersion || '').trim();
    if (ver || core) {
      const meta = { source: 'import' };
      if (ver)  meta.proffieVersion = ver;
      if (core) meta.coreVersion    = core;
      fs.writeFileSync(
        path.join(path.dirname(dest), '.jmt_meta.json'),
        JSON.stringify(meta, null, 2),
        'utf8'
      );
    }
    return { ok: true, versionName: name };
  } catch (e) {
    return { ok: false, error: `Import failed: ${e.message}` };
  }
}

// Copy a single prop header into ONE version's props/ folder. [B-446]
//
// Per version by design, settled 2026-09-29: the file lands in the version that was
// selected and nowhere else. Duplicating a version copies its whole tree, so an
// imported prop follows a duplicate for free without this having to fan out.
//
// ⚠️ THIS IS A DOOR THAT WRITES A CHOSEN FILE INTO THE TREE WE THEN COMPILE, so it
// refuses two things and neither check is invented here:
//   · A program. `checkExecutableFile` is the programs-only predicate, by content AND
//     by name, with the trailing-dot/space strip that stops `evil.exe.` sneaking past.
//     soundFontAttachments guards with the same one for the same reason.
//     ⚠️ NOT `checkCarryableFile` - its refusal wording is card-scoped ("no use on a
//     saber card", "left out") and reads as nonsense in a props folder.
//   · Anything that is not `.h`. The include the Prop dropdown writes is
//     `../props/<file>`, so a non-header cannot be compiled by the only path that
//     would reference it.
//
// `overwrite` is opt-in rather than automatic: props/ holds ProffieOS's own shipped
// props, and writing over saber_fett263_buttons.h is both a real possibility and a
// legitimate act (re-importing your own prop after editing it is the obvious second
// use). So the caller confirms; this refuses until it does.
function importProp(versionName, sourcePath, opts) {
  const o = opts || {};
  const name = (versionName || '').trim();
  if (!name) return { ok: false, error: 'No ProffieOS version selected.' };
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: 'That file could not be found.' };
  }

  const file = path.basename(sourcePath);
  if (!/\.h$/i.test(file)) {
    return { ok: false, error: 'A prop must be a .h header file.' };
  }
  // Defence in depth against a chosen path carrying separators in its basename.
  if (file !== path.basename(file) || /[\\/]/.test(file)) {
    return { ok: false, error: 'That file name cannot be used.' };
  }

  try {
    const verdict = require('./sdCardDetect').checkExecutableFile(sourcePath, file);
    if (verdict && verdict.blocked) {
      return { ok: false, error: verdict.disguised
        ? `${file} is a program, despite its name. It was not imported.`
        : `${file} is a program file, which cannot be a prop. It was not imported.` };
    }
  } catch { /* predicate unavailable: fall through to the extension check alone */ }

  const propsDir = path.join(getUserVersionsPath(), name, 'ProffieOS', 'props');
  if (!fs.existsSync(propsDir)) {
    return { ok: false, error: `${name} has no props folder — is this a complete ProffieOS tree?` };
  }

  const dest = path.join(propsDir, file);
  const existed = fs.existsSync(dest);
  if (existed && !o.overwrite) {
    return { ok: false, exists: true, file,
             error: `${name} already has a prop called ${file}.` };
  }
  try {
    fs.copyFileSync(sourcePath, dest);
    _recordAddedProp(name, file);
    // The version's content hash is what decides whether a cached build can be
    // reused. Adding a file to the tree changes what would compile, so a stale
    // hash here would hand back a build made without this prop.
    try { invalidateVersionHash(name); } catch {}
    return { ok: true, file, versionName: name, replaced: existed };
  } catch (e) {
    return { ok: false, error: `Import failed: ${e.message}` };
  }
}

// ── Provenance: which props did the USER put here? ─────
//
// Import is the only moment this is CERTAIN. Everything after it is inference, so
// the answer is recorded at the one point we know it rather than reconstructed
// later from a folder listing that cannot tell a stock prop from a brought one.
//
// ⚠️ THE LIMIT IS PART OF THE DESIGN, not a shortfall: versions installed before
// this existed have no record, so nothing in them is removable until it is
// imported through the app. That is correct. We genuinely do not know what was in
// those folders when they arrived, and an app that offers to delete a file it
// cannot vouch for is the one overstepping. [B-446]
function _recordAddedProp(versionName, file) {
  try {
    const meta  = readVersionMeta(versionName);
    const added = Array.isArray(meta.addedProps) ? meta.addedProps.slice() : [];
    if (!added.includes(file)) added.push(file);
    writeVersionMeta(versionName, { addedProps: added });
  } catch { /* provenance is a convenience; never fail the import over it */ }
}

function _forgetAddedProp(versionName, file) {
  try {
    const meta = readVersionMeta(versionName);
    if (!Array.isArray(meta.addedProps)) return;
    writeVersionMeta(versionName, { addedProps: meta.addedProps.filter(f => f !== file) });
  } catch { /* as above */ }
}

// The props in this version that the user added, as a plain array.
function addedProps(versionName) {
  const meta = readVersionMeta(versionName);
  return Array.isArray(meta.addedProps) ? meta.addedProps : [];
}

// Remove a prop this app put there. [B-446] requirement 3.
//
// ⚠️ REFUSES ANYTHING NOT IN addedProps, and that refusal is the feature. A prop
// that shipped with ProffieOS is not ours to delete, and one we have no record of
// is one we cannot vouch for - which reads the same way from here.
function removeProp(versionName, file) {
  const name = (versionName || '').trim();
  if (!name) return { ok: false, error: 'No ProffieOS version selected.' };
  if (!file || file !== path.basename(file) || /[\\/]/.test(file)) {
    return { ok: false, error: 'That file name cannot be used.' };
  }
  if (!addedProps(name).includes(file)) {
    return { ok: false, error: `${file} was not added through JMT Studio, so it is not ours to delete.` };
  }
  const target = path.join(getUserVersionsPath(), name, 'ProffieOS', 'props', file);
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    _forgetAddedProp(name, file);
    // Removing a file changes what would compile, same as adding one.
    try { invalidateVersionHash(name); } catch {}
    return { ok: true, file, versionName: name };
  } catch (e) {
    return { ok: false, error: `Could not remove ${file}: ${e.message}` };
  }
}

// What would copying this prop into each destination do? [B-446] requirement 4.
//
// Answered BEFORE anything is written, because the menu rows carry the consequence
// and picking a row is the consent - there is no confirm dialog downstream to catch
// a surprise. `replaces` is why a row reads "(replaces)"; `majorDiffers` is why one
// reads "(different major)", and that is per DESTINATION rather than per operation:
// across several destinations a blanket warning either cries wolf over the safe ones
// or buries the one that matters.
function planPropCopy(fromVersion, file, toVersions) {
  const src = path.join(getUserVersionsPath(), fromVersion, 'ProffieOS', 'props', file);
  const srcMajor = String(getVersionOSVersion(fromVersion) || '').split('.')[0];
  return (toVersions || []).map(to => {
    const dest = path.join(getUserVersionsPath(), to, 'ProffieOS', 'props', file);
    const toMajor = String(getVersionOSVersion(to) || '').split('.')[0];
    return {
      version:      to,
      replaces:     fs.existsSync(dest),
      majorDiffers: !!(srcMajor && toMajor && srcMajor !== toMajor),
      ok:           fs.existsSync(src),
    };
  });
}

// Copy one prop into one or more other versions. [B-446] requirement 4.
function copyPropToVersions(fromVersion, file, toVersions) {
  const src = path.join(getUserVersionsPath(), fromVersion, 'ProffieOS', 'props', file);
  if (!fs.existsSync(src)) return { ok: false, error: `${file} is not in ${fromVersion}.` };
  // ⚠️ SAME RESTRICTION AS removeProp, AND FOR A HARDER REASON THAN SYMMETRY.
  // A prop that shipped with ProffieOS already exists in every version that ships
  // it, so copying one across does not ADD anything - it overwrites the
  // destination's own correct copy with a file written against a different OS
  // release. That is not a useful operation; it is a way to quietly break a working
  // tree. Only a prop the user brought here is ours to move. [B-446]
  if (!addedProps(fromVersion).includes(file)) {
    return { ok: false, error: `${file} was not added through JMT Studio, so it is not ours to copy.` };
  }

  const done = [], failed = [];
  for (const to of (toVersions || [])) {
    if (to === fromVersion) continue;          // never a destination for itself
    const propsDir = path.join(getUserVersionsPath(), to, 'ProffieOS', 'props');
    if (!fs.existsSync(propsDir)) { failed.push({ version: to, error: 'no props folder' }); continue; }
    try {
      const replaced = fs.existsSync(path.join(propsDir, file));
      fs.copyFileSync(src, path.join(propsDir, file));
      // A copied prop is user-added in its DESTINATION too, or it would land
      // there unremovable - the exact hole requirement 3 exists to close.
      _recordAddedProp(to, file);
      try { invalidateVersionHash(to); } catch {}
      done.push({ version: to, replaced });
    } catch (e) {
      failed.push({ version: to, error: e.message });
    }
  }
  return { ok: failed.length === 0, file, done, failed };
}

// ── Info ───────────────────────────────────────────────

function getInfo() {
  const version = getSelectedVersion();
  return {
    version:     version || '—',
    root:        getProffieOSRoot(),
    inoPath:     getInoPath(),
    configPath:  getConfigStagingPath(),
    sourceValid: validateProffieOSSource().ok
  };
}

// ── Version metadata ───────────────────────────────────

function _dirSizeSync(p) {
  if (!fs.existsSync(p)) return 0;
  return fs.readdirSync(p, { withFileTypes: true }).reduce((sum, e) => {
    const full = path.join(p, e.name);
    return sum + (e.isDirectory() ? _dirSizeSync(full) : fs.statSync(full).size);
  }, 0);
}

function getNotesPath(versionName) {
  const resolved = _resolveVersionFolder(versionName);
  return resolved ? path.join(resolved.folderPath, 'notes.txt') : null;
}

function _getMetaPath(versionName) {
  const resolved = _resolveVersionFolder(versionName);
  return resolved ? path.join(resolved.folderPath, '.jmt_meta.json') : null;
}

function readVersionMeta(versionName) {
  const p = _getMetaPath(versionName);
  if (!p || !fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeVersionMeta(versionName, updates) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  try {
    const existing = readVersionMeta(versionName);
    fs.writeFileSync(
      path.join(resolved.folderPath, '.jmt_meta.json'),
      JSON.stringify({ ...existing, ...updates }, null, 2),
      'utf8'
    );
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Per-version core selection ─────────────────────────
//
// Which Proffieboard core this ProffieOS version builds against. Stored on the
// version rather than app-wide because the two move together: a config that
// fits on core 3.6 and overflows on 4.6 is a property of this tree and this
// board, not of the user.
//
// Null means "not chosen", and the caller resolves that to whatever is newest.
// An absent value is deliberately NOT written as the current latest at read
// time - that would silently freeze a version onto today's core the first time
// anything glanced at it.
function getVersionCore(versionName) {
  const meta = readVersionMeta(versionName);
  return meta.coreVersion || null;
}

// Passing null clears the choice and returns the version to following latest.
function setVersionCore(versionName, coreVersion) {
  return writeVersionMeta(versionName, { coreVersion: coreVersion || null });
}

/**
 * One-time upgrade backfill: pin every existing version to the core it has
 * actually been building with.
 *
 * Before 1.8 the core was hardcoded, so every tree on the machine was built
 * against that one version whether anyone chose it or not. Leaving those trees
 * on "follow latest" would look harmless right up until a newer core is
 * published, and then, with no user action at all, they would each get a
 * different compiler: the whole build cache misses, a several-hundred-megabyte
 * core downloads, and a config that only just fitted may stop linking. Newer
 * cores produce larger binaries, which is the entire reason this feature exists.
 *
 * So an upgrade must be something the user chooses, not something that happens
 * to them. Pinning here makes follow-latest an opt-in.
 *
 * The value is passed in rather than read from disk on purpose. Every pre-1.8
 * build used the hardcoded version regardless of what else is installed, and
 * inspecting a machine that has several cores on it invites the wrong answer.
 *
 * Callers must guard this to run once. It only ever fills a MISSING field, so a
 * second run is harmless, but a user who deliberately cleared a version back to
 * follow-latest must not have it silently re-pinned.
 */
function backfillVersionCores(coreVersion) {
  if (!coreVersion) return { ok: false, error: 'A core version is required.', stamped: [] };
  const stamped = [];
  for (const name of listVersions()) {
    const meta = readVersionMeta(name);
    if (meta.coreVersion) continue;
    const res = writeVersionMeta(name, { coreVersion });
    if (res.ok) stamped.push(name);
  }
  return { ok: true, stamped, coreVersion };
}

function readNotes(versionName) {
  const p = getNotesPath(versionName);
  if (!p || !fs.existsSync(p)) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function writeNotes(versionName, content) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  try {
    fs.writeFileSync(path.join(resolved.folderPath, 'notes.txt'), content, 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function listVersionsDetails() {
  return listVersions().map(name => {
    const resolved = _resolveVersionFolder(name);
    if (!resolved) return null;
    const { folderPath } = resolved;
    const notes = readNotes(name);
    const meta  = readVersionMeta(name);
    let modified = null;
    try { modified = fs.statSync(folderPath).mtime.toISOString(); } catch {}
    return {
      name,
      size: _dirSizeSync(folderPath),
      modified,
      notes,
      notesPreview:   notes ? notes.split('\n').find(l => l.trim()) || null : null,
      proffieVersion: meta.proffieVersion || null,
      jmtVersion:     meta.jmtVersion     || null,
      coreVersion:    meta.coreVersion    || null,
    };
  }).filter(Boolean);
}

// Which JMT Add-ons release a build of `configContent` against `versionName`
// actually compiled in, or null. [B-473]
//
// ONE DEFINITION BECAUSE THERE ARE TWO CALLERS: a fresh compile asks via
// toolchain, and a cache restore asks over IPC. They have to agree, and the
// second copy is where they would stop agreeing.
//
// Null has two distinct causes and the caller cannot tell them apart, which is
// fine - both mean "no add-ons are in this binary": the tree has none
// installed, or it has them and this config includes none of their headers.
//
// The file list is the one the apply step recorded in `.jmt_meta.json`, so this
// follows the add-ons as they gain and lose files instead of freezing today's
// filenames - and it covers the headers with no `jmt_` prefix (charge_state.h,
// charge_full_prop.h) without naming them.
// Split from the disk read on purpose: THIS half is the decision and it is where
// the bugs would be, so it has to be reachable by a test without a version folder
// on disk. A test that has to fabricate a tree ends up asserting over source text
// instead of running the code.
function _addonsVersionFromMeta(meta, configContent) {
  const m = meta || {};
  if (!m.jmtVersion) return null;
  const files = Array.isArray(m.jmtInstalledFiles) ? m.jmtInstalledFiles : [];
  if (!files.length) return null;
  // `^[ \t]*#include` rather than a loose search: a commented-out `//#include`
  // is not in the build, so it must not produce a stamp claiming it was.
  const included = new Set(
    [...String(configContent || '').matchAll(/^[ \t]*#include[ \t]+"([^"]+)"/gm)]
      .map(m2 => m2[1].split(/[\\/]/).pop())
  );
  const used = files.some(p => included.has(String(p).split(/[\\/]/).pop()));
  return used ? m.jmtVersion : null;
}

function getCompiledAddonsVersion(versionName, configContent) {
  return _addonsVersionFromMeta(readVersionMeta(versionName), configContent);
}

// ── Version operations ─────────────────────────────────

function _validateVersionName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Name cannot be empty.';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(trimmed)) return 'Name contains invalid characters.';
  return null;
}

function renameVersion(oldName, newName) {
  const resolved = _resolveVersionFolder(oldName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const err = _validateVersionName(newName);
  if (err) return { ok: false, error: err };
  const trimmed = newName.trim();
  const destPath = path.join(getUserVersionsPath(), trimmed);
  if (fs.existsSync(destPath)) return { ok: false, error: `A version named "${trimmed}" already exists.` };
  try {
    fs.renameSync(resolved.folderPath, destPath);
    return { ok: true, newName: trimmed };
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      const hint = process.platform === 'darwin'
        ? 'Close any Finder windows showing this folder and try again.'
        : process.platform === 'win32'
          ? 'Close any Explorer windows showing this folder and try again.'
          : 'Close any file manager windows showing this folder and try again.';
      return { ok: false, error: `Couldn't rename the folder — it may be open or briefly locked by the system. ${hint}` };
    }
    return { ok: false, error: e.message };
  }
}

// ⚠️ CANCELLABLE FOR THE SAME REASON AS importVersion, AND IT IS NOT OPTIONAL
// SCOPE: Duplicate shares the import modal AND its single Cancel button. [B-488]
// Leaving this one synchronous would ship a button that works on the Import path
// and is drawn-but-dead on the Duplicate path — which is the precise defect
// [B-462] was filed for ("it shows a cancrl button but it doesnt work. thats
// wrong too"). One button, one promise.
async function duplicateVersion(versionName, newName, opts = {}) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const err = _validateVersionName(newName);
  if (err) return { ok: false, error: err };
  const trimmed = newName.trim();
  if (_resolveVersionFolder(trimmed)) return { ok: false, error: `A version named "${trimmed}" already exists.` };
  const destPath = path.join(getUserVersionsPath(), trimmed);
  try {
    const copy = await copyDirCancellable(resolved.folderPath, destPath, opts);
    if (!copy.completed) {
      // The name was refused above if it already existed, so destPath is only
      // ever a tree this call created.
      try { await fsRemove.rmWithRetry(destPath); } catch { /* best effort */ }
      return { ok: false, cancelled: true, error: 'Duplicate cancelled.' };
    }
    return { ok: true, newName: trimmed };
  } catch (e) { return { ok: false, error: e.message }; }
}

function deleteVersion(versionName) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  try {
    fs.rmSync(resolved.folderPath, { recursive: true, force: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function listVersionDir(versionName, subPath) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const fullPath = subPath ? path.join(resolved.folderPath, subPath) : resolved.folderPath;
  if (!fullPath.startsWith(resolved.folderPath)) return { ok: false, error: 'Invalid path.' };
  if (!fs.existsSync(fullPath)) return { ok: false, error: 'Path not found.' };
  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        size: e.isFile() ? fs.statSync(path.join(fullPath, e.name)).size : null,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    return { ok: true, entries };
  } catch (e) { return { ok: false, error: e.message }; }
}

function readVersionFile(versionName, subPath) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const fullPath = path.join(resolved.folderPath, subPath);
  if (!fullPath.startsWith(resolved.folderPath)) return { ok: false, error: 'Invalid path.' };
  try {
    const stats = fs.statSync(fullPath);
    if (stats.size > 2 * 1024 * 1024) return { ok: false, error: 'File too large to preview (> 2 MB).' };
    const content = fs.readFileSync(fullPath, 'utf8');
    return { ok: true, content };
  } catch (e) { return { ok: false, error: e.message }; }
}

const _SEARCH_TEXT_EXTS = new Set([
  'h','cpp','c','ino','cc','md','txt','py','sh','bat',
  'json','yml','yaml','xml','html','css','js','ts',
  'gitignore','gitattributes','mk','makefile',
]);
const _SEARCH_MAX_FILE_BYTES = 512 * 1024; // skip files > 512 KB

function searchVersionFiles(versionName, query) {
  const resolved = _resolveVersionFolder(versionName);
  if (!resolved) return { ok: false, error: 'Version not found.' };
  const searchRoot = path.join(resolved.folderPath, 'ProffieOS');
  if (!fs.existsSync(searchRoot)) return { ok: false, error: 'ProffieOS directory not found.' };
  const q = (query || '').toLowerCase().trim();
  if (!q) return { ok: true, results: [] };
  const results = [];
  (function walk(dir, relPath) {
    if (results.length >= 300) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= 300) return;
      const rel = relPath ? `${relPath}/${e.name}` : e.name;
      const fullEntry = path.join(dir, e.name);
      const nameLower = e.name.toLowerCase();
      const nameMatch = nameLower.includes(q);
      if (e.isDirectory()) {
        if (nameMatch) results.push({ name: e.name, path: `ProffieOS/${rel}`, type: 'dir', size: null, matchType: 'name', matchCount: 0, matchLine: null });
        walk(fullEntry, rel);
      } else {
        let size = null;
        try { size = fs.statSync(fullEntry).size; } catch {}
        if (nameMatch) {
          results.push({ name: e.name, path: `ProffieOS/${rel}`, type: 'file', size, matchType: 'name', matchCount: 0, matchLine: null });
        } else {
          // Content search — only for known text extensions within size limit
          const ext = (nameLower.split('.').pop() || '').toLowerCase();
          if (_SEARCH_TEXT_EXTS.has(ext) && size != null && size <= _SEARCH_MAX_FILE_BYTES) {
            try {
              const text = fs.readFileSync(fullEntry, 'utf8');
              let matchCount = 0, firstLine = null;
              for (const line of text.split('\n')) {
                if (line.toLowerCase().includes(q)) {
                  matchCount++;
                  if (!firstLine) firstLine = line.trim().slice(0, 140);
                }
              }
              if (matchCount > 0) {
                results.push({ name: e.name, path: `ProffieOS/${rel}`, type: 'file', size, matchType: 'content', matchCount, matchLine: firstLine });
              }
            } catch {}
          }
        }
      }
    }
  })(searchRoot, '');
  return { ok: true, results };
}

// Returns the top-level resources directory (arduino-cli, tools, etc.)
function getResourcesPath() {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, 'resources');
}

module.exports = {
  listVersions,
  getVersionOSVersion,
  getOSVersionMap,
  getSelectedVersion,
  setSelectedVersion,
  hashVersion,
  invalidateVersionHash,
  getArgumentNames,
  invalidateArgumentNames,
  getProffieOSRoot,
  getConfigStagingPath,
  getInoPath,
  getResourcesPath,
  validateProffieOSSource,
  initWorkspace,
  ensureConfigFileRef,
  stageConfig,
  readStagedConfig,
  stageStyles,
  readStagedStyles,
  hasUserStyles,
  importStylesFile,
  deleteUserStyles,
  getUserStylesPath,
  STYLES_FILENAME,
  importVersion,
  importProp,
  addedProps,
  removeProp,
  planPropCopy,
  copyPropToVersions,
  getInfo,
  CONFIG_FILENAME,
  listVersionsDetails,
  readNotes,
  writeNotes,
  readVersionMeta,
  writeVersionMeta,
  getCompiledAddonsVersion,
  _addonsVersionFromMeta,   // exported for test only
  getVersionCore,
  setVersionCore,
  backfillVersionCores,
  renameVersion,
  duplicateVersion,
  deleteVersion,
  listVersionDir,
  readVersionFile,
  searchVersionFiles,
  getUserVersionsPath,
};
