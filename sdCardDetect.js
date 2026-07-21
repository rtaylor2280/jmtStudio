// SD card detection for the "Read my Proffie SD card" flow (Path-2 onboarding) and the
// SD-management surface. READ-ONLY: enumerates removable volumes, reads identity
// (Volume Serial Number + a .jmt-sd-id sidecar), OS health, and classifies each card as
// proffie / xeno-gh / empty / unknown so the UI can present what's on the card and route
// it correctly. Nothing is ever written to a card here.
//
// Ported from the local/sd-spike detection spike (validated read-only against five real
// cards). Windows implemented (async PowerShell); macOS/Linux stubbed with the same shape.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const SIDECAR_NAME = '.jmt-sd-id';

// ── Platform enumeration ────────────────────────────────
function enumerateVolumesWindows(removableOnly) {
  // DriveType=2 = removable media (SD readers, USB sticks). Merge HealthStatus from
  // Get-Volume, which Win32_LogicalDisk does not carry. removableOnly=false is used when
  // the user explicitly points at a drive, so its metadata can still be reported.
  const filter = removableOnly ? ' -Filter "DriveType=2"' : '';
  const ps = [
    '$vols = Get-CimInstance Win32_LogicalDisk' + filter,
    '$out = foreach ($v in $vols) {',
    '  $letter = $v.DeviceID.TrimEnd(":")',
    '  $h = $null',
    '  try { $h = (Get-Volume -DriveLetter $letter -ErrorAction Stop).HealthStatus } catch {}',
    '  [pscustomobject]@{',
    '    drive        = $v.DeviceID',
    '    mountPath    = $v.DeviceID + "\\"',
    '    fileSystem   = $v.FileSystem',
    '    label        = $v.VolumeName',
    '    volumeSerial = $v.VolumeSerialNumber',
    '    sizeBytes    = [int64]$v.Size',
    '    freeBytes    = [int64]$v.FreeSpace',
    '    health       = $h',
    '    driveType    = [int]$v.DriveType',
    '  }',
    '}',
    'ConvertTo-Json -InputObject @($out) -Depth 4',
  ].join('\n');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const parsed = JSON.parse((stdout || '').trim() || '[]');
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch { resolve([]); }
      });
  });
}

async function enumerateRemovableVolumes() {
  if (os.platform() === 'win32') return enumerateVolumesWindows(true);
  // TODO: macOS (diskutil list -plist external physical) / Linux (lsblk -J + udisks2).
  return [];
}

async function enumerateAllVolumes() {
  if (os.platform() === 'win32') return enumerateVolumesWindows(false);
  return [];
}

// ── Identity (VSN is a weak key; .jmt-sd-id sidecar is primary) ──
function isDegenerateVsn(vsn) {
  if (!vsn) return true;
  const hex = String(vsn).replace(/[^0-9a-fA-F]/g, '');
  if (!hex.length) return true;
  if (/^0+$/.test(hex)) return true;
  if (/^[fF]+$/.test(hex)) return true;
  return false;
}
function formatVsn(vsn) {
  if (!vsn) return null;
  const hex = String(vsn).replace(/[^0-9a-fA-F]/g, '').toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
function readSidecar(mountPath) {
  try { return (fs.readFileSync(path.join(mountPath, SIDECAR_NAME), 'utf8').trim()) || null; }
  catch { return null; }
}
function resolveIdentity(vol) {
  const sidecar = readSidecar(vol.mountPath);
  const vsnDegenerate = isDegenerateVsn(vol.volumeSerial);
  let key, basis, trust;
  if (sidecar) { key = `sid:${sidecar}`; basis = 'jmt-sd-id sidecar'; trust = 'strong'; }
  else if (!vsnDegenerate) { key = `vsn:${formatVsn(vol.volumeSerial)}`; basis = 'volume serial (no sidecar yet)'; trust = 'weak'; }
  else { key = null; basis = 'unidentifiable: degenerate VSN and no sidecar'; trust = 'none'; }
  return { sidecar, vsnDegenerate, key, basis, trust };
}

// ── Classification (Proffie vs Xeno/GH vs empty) ──
const NON_FONT_DIRS = new Set([
  'system volume information', 'set', 'common', 'tracks', 'poweron', 'all-lightfile',
  'sd config', '$recycle.bin', 'found.000',
]);
const FAKE_MARKER_RX = /【|attention\s*please|警告|注意/i;

function safeReaddir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); }
  catch (e) { return { __error: e.message }; }
}
function looksLikeProffieFontDir(dirPath) {
  const ents = safeReaddir(dirPath);
  if (ents.__error) return false;
  const names = ents.filter(e => e.isFile()).map(e => e.name.toLowerCase());
  const hasHum = names.some(n => n === 'hum.wav' || /^hum\d*\.wav$/.test(n));
  const hasEffect = names.some(n => /^(blst|clsh|clash|swng|swing|boot|out|in|preon|font|lock|drag)\d*\.wav$/.test(n));
  return hasHum && hasEffect;
}
function classifyCard(vol) {
  const rootEnts = safeReaddir(vol.mountPath);
  if (rootEnts.__error) return { kind: 'unreadable', confidence: 'n/a', signals: { error: rootEnts.__error } };
  const dirs = rootEnts.filter(e => e.isDirectory());
  const files = rootEnts.filter(e => e.isFile());
  const dirNames = dirs.map(d => d.name);
  const fileNamesLower = files.map(f => f.name.toLowerCase());
  const dirNamesLower = dirNames.map(d => d.toLowerCase());
  const hasDir = (n) => dirNamesLower.includes(n.toLowerCase());
  const hasFile = (n) => fileNamesLower.includes(n.toLowerCase());

  // Font-folder categories (per soundboard-sd-signatures.md).
  const numberedDirs = dirNames.filter(n => /^\d+$/.test(n));            // Xeno/SN/TXQ: 1/ 2/ 3/
  const nNameDirs    = dirNames.filter(n => /^\d+-\S/.test(n));          // CFX: 1-Graflex/
  const namedFontDirs = dirNames.filter(n => !NON_FONT_DIRS.has(n.toLowerCase()) && !/^\d+$/.test(n) && !/^\d+-/.test(n) && !FAKE_MARKER_RX.test(n));
  const provenProffieFonts = namedFontDirs.filter(n => looksLikeProffieFontDir(path.join(vol.mountPath, n))).length;

  // Proffie common/ voicepack: known voicepack sounds OR e_*.wav error files.
  let hasCommonVoicepack = false;
  if (hasDir('common')) {
    const commonPath = path.join(vol.mountPath, dirNames[dirNamesLower.indexOf('common')]);
    const ce = safeReaddir(commonPath);
    const cf = ce.__error ? [] : ce.filter(e => e.isFile()).map(e => e.name.toLowerCase());
    hasCommonVoicepack = cf.some(n => ['battery.wav', 'battlevl.wav', 'font.wav', 'hundred.wav', 'mnum000.wav'].includes(n) || /^e_.*\.wav$/.test(n));
  }

  // Board config markers - the strong family discriminators.
  const hasConfigTxt    = hasFile('config.txt');
  const hasColorsTxt    = hasFile('colors.txt');
  const hasGeneralTxt   = hasFile('general.txt');
  const hasRootConfigIni = hasFile('config.ini') || hasFile('rgb_config.ini') || hasFile('system_flag.ini');
  const hasOtaSnv4      = hasFile('ota.snv4');
  const hasGhMarker     = fileNamesLower.some(n => n === 'phase4.ghv' || n === 'update_d.dat' || n === 'update.dat');
  const hasSetDir       = hasDir('set') || hasDir('setting');
  const looseRootWavs   = fileNamesLower.some(n => /^(boot|on|off|clash|swing|swingh|swingl|hum)\d*\.wav$/.test(n));

  const meaningfulDirs = dirNames.filter(n => !NON_FONT_DIRS.has(n.toLowerCase()));
  const meaningfulFiles = files.filter(f => f.name.toLowerCase() !== SIDECAR_NAME);
  const isEmpty = meaningfulDirs.length === 0 && meaningfulFiles.length === 0 && numberedDirs.length === 0;
  const fakeMarker = dirNames.find(n => FAKE_MARKER_RX.test(n)) || null;

  // Counts for the report. Font folders = any top-level dir (minus system dirs)
  // that is a Proffie font: it holds .wav files DIRECTLY (flat layout) OR it
  // contains Proffie effect subfolders like font/ hum/ clsh/ swng/ (the standard
  // "unpacked" layout — Starkiller, ObiWan 2, V1-*, Yoda, ... on real cards).
  // Both are valid fonts and the import scan counts both, so the summary MUST
  // too — otherwise subfolder-layout fonts silently drop and the card disagrees
  // with import (was the 47-vs-64 gap). Mirrors looksLikeProffieDir in
  // soundFontBulkImport.js so the two counts stay in agreement.
  const EFFECT_DIR_NAMES = new Set([
    'boot', 'hum', 'swingh', 'swingl', 'clsh', 'blst', 'lock', 'force', 'in',
    'out', 'font', 'lb', 'bgnlb', 'endlb', 'bgnlock', 'endlock', 'melt',
    'bgnmelt', 'endmelt', 'drag', 'bgndrag', 'enddrag', 'swng', 'spin', 'stab',
    'preon', 'pwroff', 'pstoff',
  ]);
  // Flat layout must carry a CORE effect file (boot/hum/font.wav) — not just any
  // .wav — so menu voice-prompt packs (MC: maccept/maffirm/... with no hum) don't
  // get miscounted as fonts. This is exactly looksLikeProffieDir's rule, so the
  // summary count and the import scan agree.
  const CORE_EFFECT_FILE = /^(boot|hum|font)\d*\.wav$/i;
  const fontFolders = dirNames.filter(n => {
    if (NON_FONT_DIRS.has(n.toLowerCase()) || FAKE_MARKER_RX.test(n)) return false;
    const ents = safeReaddir(path.join(vol.mountPath, n));
    if (ents.__error) return false;
    if (ents.some(e => e.isFile() && CORE_EFFECT_FILE.test(e.name))) return true;
    return ents.some(e => e.isDirectory() && (EFFECT_DIR_NAMES.has(e.name.toLowerCase()) || /^alt\d{3}$/i.test(e.name)));
  }).length;
  const configFiles = files.filter(f => isProffieConfigFile(path.join(vol.mountPath, f.name), f.name)).length;
  const otherFiles = Math.max(0, files.filter(f => f.name.toLowerCase() !== SIDECAR_NAME).length - configFiles);

  // === Family classification (flowchart order: highest-specificity first) ===
  let kind, confidence; const matched = [];
  if ((hasDir('soundfonts') && hasDir('effectfonts')) || hasGeneralTxt || hasGhMarker) {
    kind = 'golden-harvest'; confidence = 'high'; matched.push('Golden Harvest layout');
  } else if (nNameDirs.length >= 1 || (hasConfigTxt && hasColorsTxt)) {
    kind = 'cfx'; confidence = 'high'; matched.push('CFX layout (N-name / config.txt+colors.txt)');
  } else if (namedFontDirs.length >= 1 && !hasConfigTxt && !hasColorsTxt && !hasGeneralTxt && !hasRootConfigIni && (hasCommonVoicepack || provenProffieFonts >= 1)) {
    kind = 'proffie';
    confidence = (hasCommonVoicepack && provenProffieFonts >= 1) ? 'high' : 'medium';
    matched.push('Proffie: named fonts, no foreign config' + (hasCommonVoicepack ? ', common voicepack' : ''));
  } else if (hasRootConfigIni && looseRootWavs && numberedDirs.length === 0 && !hasSetDir && namedFontDirs.length === 0) {
    kind = 'verso'; confidence = 'medium'; matched.push('Verso: root config.ini + loose wavs');
  } else if (numberedDirs.length >= 1 && (hasSetDir || hasRootConfigIni)) {
    kind = 'xeno'; confidence = numberedDirs.length >= 3 ? 'high' : 'medium';
    matched.push(hasOtaSnv4 ? 'SN (ota.snv4)' : hasDir('setting') ? 'Xeno v3 (setting/)' : 'Xeno-family (numbered + set/)');
  } else if (isEmpty) {
    kind = 'empty'; confidence = 'high';
  } else {
    kind = 'unrecognized'; confidence = 'low';
    matched.push(`unrecognized (named:${namedFontDirs.length} numbered:${numberedDirs.length} n-name:${nNameDirs.length})`);
  }

  // Mixed content: which recognizable content types are present, beyond the primary family.
  const contentTypes = [];
  if (provenProffieFonts >= 1) contentTypes.push('Proffie');
  if (numberedDirs.length >= 3) contentTypes.push('Xeno-style');
  if (nNameDirs.length >= 1) contentTypes.push('CFX-style');
  const mixed = contentTypes.length > 1;

  return {
    kind, confidence,
    counts: { fonts: fontFolders, configs: configFiles, otherFiles },
    contentTypes, mixed,
    signals: { matched, namedFontDirs: namedFontDirs.length, numberedFontDirs: numberedDirs.length, nNameDirs: nNameDirs.length, provenProffieFonts, fakeCapacityMarker: fakeMarker },
  };
}

// ── Plain-language verdict for the UI (no jargon in headline/detail) ──
const FAMILY_LABELS = { cfx: 'CFX (Crystal Focus)', 'golden-harvest': 'Golden Harvest', verso: 'Verso', xeno: 'Xeno' };

function buildVerdict(card) {
  const cls = card.classification;
  const kind = cls.kind;
  const noun = card.isFolder ? 'folder' : 'card';
  if (kind === 'unreadable') return { level: 'bad', headline: `This ${noun} couldn't be read.`, detail: 'It may be damaged or not seated properly. Try re-inserting it, or a different reader.' };
  if (card.health && card.health !== 'Healthy') return { level: 'bad', headline: 'This card reports a health warning.', detail: 'Your computer flags this card as unhealthy, which can mean its files are corrupted. Inspect them before relying on it, and if they are damaged, reformat the card and repopulate it with known-good data before use rather than trusting what is on it now.' };
  if (cls.signals && cls.signals.fakeCapacityMarker) return { level: 'bad', headline: `This ${noun} shows signs of being counterfeit.`, detail: 'It carries markers common to fake-capacity cards. Verify it before relying on it.' };
  if (kind === 'empty') return { level: 'good', headline: `This ${noun} is empty.`, detail: 'There is nothing on it to import yet.' };
  if (kind === 'proffie') {
    const headline = card.isFolder ? 'These look like Proffie fonts.' : 'This is a Proffie card.';
    const detail = cls.mixed
      ? 'Mostly Proffie content, with some other-board fonts mixed in. Its Proffie fonts can be added to your library.'
      : 'Its fonts can be added to your library, and any config it carries can be opened.';
    return { level: 'good', headline, detail };
  }
  if (FAMILY_LABELS[kind]) {
    const detail = (cls.contentTypes && cls.contentTypes.includes('Proffie'))
      ? 'It also has some Proffie fonts. Converting the rest to Proffie is planned for a future update.'
      : 'Converting its fonts to Proffie is planned for a future update.';
    return { level: 'info', headline: `This looks like a ${FAMILY_LABELS[kind]} ${noun}, not Proffie.`, detail };
  }
  const detail = (cls.contentTypes && cls.contentTypes.length)
    ? `It has ${cls.contentTypes.join(' and ')} content but no clear board layout. You can still inspect its files.`
    : 'It does not match a known board layout. You can still inspect its files.';
  return { level: 'info', headline: `This ${noun} has content, but an unrecognized layout.`, detail };
}

function assessCard(vol) {
  const identity = resolveIdentity(vol);
  const classification = classifyCard(vol);
  const warnings = [];
  if (vol.health && vol.health !== 'Healthy') warnings.push(`OS health: ${vol.health}`);
  if (identity.vsnDegenerate && !vol.isFolder) warnings.push('degenerate volume serial (identity cannot rely on VSN)');
  if (classification.signals && classification.signals.fakeCapacityMarker) warnings.push(`possible counterfeit marker: "${classification.signals.fakeCapacityMarker}"`);
  const card = { ...vol, volumeSerialFmt: formatVsn(vol.volumeSerial), identity, classification, warnings };
  card.verdict = buildVerdict(card);
  return card;
}

// Assess an arbitrary folder (a drive root, or a copy of an SD card) the same way we
// assess a mounted card. No volume metadata (health / size / serial) exists for a folder,
// so those come back null; the classification and content counts still work.
function assessPath(dirPath) {
  return assessCard({
    drive: dirPath, mountPath: dirPath, fileSystem: null, label: null,
    volumeSerial: null, sizeBytes: null, freeBytes: null, health: null, isFolder: true,
  });
}

// Assess a user-picked path. If it's a drive ROOT (e.g. "H:"), look it up as a real
// volume so health/size/serial are reported — pointing us at a drive means it's a card,
// not a folder. Anything else (a real subfolder, e.g. an SD backup) is assessed as a folder.
async function assessPicked(pickedPath) {
  const norm = String(pickedPath || '').replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(norm)) {
    const letter = norm.toUpperCase(); // norm is already like "H:" (colon included)
    // Only a REMOVABLE volume is a real card (health/size/serial). Anything else - a
    // fixed drive (system or data) or a folder - is scanned as a folder: read its
    // content but make no "card" claim. Cross-platform, no system-drive special-casing.
    const vols = await enumerateAllVolumes();
    const match = vols.find(v => String(v.drive || '').toUpperCase() === letter);
    if (match && Number(match.driveType) === 2) return assessCard(match);
    return assessPath(norm + '\\');
  }
  return assessPath(pickedPath);
}

// Scan all removable volumes and assess each. Read-only.
async function scan() {
  const vols = await enumerateRemovableVolumes();
  return vols.map(assessCard);
}

// Read-only directory listing for drilling into a card/folder in the report UI.
// OS-metadata noise that isn't real card content: macOS AppleDouble resource
// forks (._name — tiny sidecars that aren't playable audio and fail to decode),
// spotlight/trash dirs, Windows thumbnail/desktop files, the System Volume
// Information folder. Hidden from the browser so they don't clutter or
// masquerade as playable wavs.
function _isSdNoise(name) {
  if (name.startsWith('._')) return true;
  const lower = name.toLowerCase();
  return lower === '.ds_store'
    || lower === '.spotlight-v100'
    || lower === '.trashes'
    || lower === '.fseventsd'
    || lower === '.documentrevisions-v100'
    || lower === '.temporaryitems'
    || lower === 'thumbs.db'
    || lower === 'desktop.ini'
    || lower === 'system volume information';
}

function listDir(dirPath) {
  const ents = safeReaddir(dirPath);
  if (ents.__error) return { path: dirPath, error: ents.__error, entries: [] };
  const entries = ents.filter(e => !_isSdNoise(e.name)).map(e => {
    const full = path.join(dirPath, e.name);
    let size = null;
    if (e.isFile()) { try { size = fs.statSync(full).size; } catch { /* ignore */ } }
    return { name: e.name, path: full, isDir: e.isDirectory(), size, isText: /\.(txt|h|hpp|ini|cfg|md|log|csv|docx)$/i.test(e.name) };
  });
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : (a.isDir ? -1 : 1)));
  return { path: dirPath, entries };
}

// ── WAV corruption detection (validated against a real corrupted card) ──
// Cheap header inspection, no full decode. A wav is corrupt when it's 0 bytes /
// unreadable, its header isn't RIFF...WAVE (content scrambled), or its declared
// `data` chunk claims more bytes than the file holds (audio truncated). Trailing
// junk BEYOND a valid data chunk (e.g. zero-padding to a cluster boundary) is
// TOLERATED — it still plays. Returns { corrupt, reason } / { corrupt:false }.
// Validate a WAV from an already-read header buffer + the file's total size.
// Split out so callers that ALREADY hold the bytes (the bulk-import content-hash
// pass reads every file) can corruption-check off the SAME read, no re-open.
// `buf` only needs the first ~256 bytes; `size` is the whole file's byte length.
function checkWavBuffer(buf, size) {
  if (size === 0) return { corrupt: true, reason: 'This file is empty and will not play.' };
  const n = Math.min(buf.length, 256);
  if (n < 12) return { corrupt: true, reason: 'This file is too small to be valid audio.' };
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return { corrupt: true, reason: 'This file is corrupted (its data is scrambled) and will not play.' };
  }
  let off = 12;
  while (off + 8 <= n) {
    const id = buf.toString('ascii', off, off + 4);
    const csize = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      if (off + 8 + csize > size) return { corrupt: true, reason: 'This file is incomplete (cut off before the end) and may not play.' };
      return { corrupt: false };
    }
    off += 8 + csize + (csize & 1);
  }
  return { corrupt: false }; // no data chunk within the first 256 bytes — don't false-positive
}

function checkWavHealth(filePath, size) {
  if (size === 0) return { corrupt: true, reason: 'This file is empty and will not play.' };
  let fd;
  try { fd = fs.openSync(filePath, 'r'); }
  catch (e) { return { corrupt: true, reason: `This file could not be read (${e.code || 'error'}).` }; }
  try {
    const buf = Buffer.alloc(Math.min(size, 256));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return checkWavBuffer(n < buf.length ? buf.subarray(0, n) : buf, size);
  } catch (e) {
    return { corrupt: true, reason: `The audio header could not be read (${e.code || 'error'}).` };
  } finally { try { fs.closeSync(fd); } catch {} }
}

const _WAV_RX = /\.wav$/i;

// Recursive corruption tally for a subtree. Depth- and count-capped so the card
// root (dozens of fonts) can't spiral. Keeps the first reason for the tooltip.
function _scanSubtreeCorruption(dirPath, depth, acc) {
  if (depth > 6 || acc.count >= 50) return acc;
  const ents = safeReaddir(dirPath);
  if (ents.__error) return acc;
  for (const e of ents) {
    if (_isSdNoise(e.name)) continue;
    const full = path.join(dirPath, e.name);
    if (e.isFile()) {
      if (!_WAV_RX.test(e.name)) continue;
      let size = 0; try { size = fs.statSync(full).size; } catch {}
      const h = checkWavHealth(full, size);
      if (h.corrupt) { acc.count++; if (!acc.first) acc.first = h.reason; }
    } else if (e.isDirectory()) {
      _scanSubtreeCorruption(full, depth + 1, acc);
    }
    if (acc.count >= 50) break;
  }
  return acc;
}

// Health of a folder's direct entries, for the browser marks. Per direct FILE:
// is it a corrupt wav? Per direct SUBFOLDER: does its subtree hold any corrupt
// wav, and how many? Returns { files: {name:{corrupt,reason}}, dirs:
// {name:{count,reason}} }. Read-only, header-only.
function scanFolderHealth(dirPath) {
  const out = { files: {}, dirs: {} };
  const ents = safeReaddir(dirPath);
  if (ents.__error) return out;
  for (const e of ents) {
    if (_isSdNoise(e.name)) continue;
    const full = path.join(dirPath, e.name);
    if (e.isFile()) {
      if (!_WAV_RX.test(e.name)) continue;
      let size = 0; try { size = fs.statSync(full).size; } catch {}
      const h = checkWavHealth(full, size);
      if (h.corrupt) out.files[e.name] = h;
    } else if (e.isDirectory()) {
      const agg = _scanSubtreeCorruption(full, 0, { count: 0, first: null });
      if (agg.count > 0) out.dirs[e.name] = { count: agg.count, reason: agg.first };
    }
  }
  return out;
}

// Find Proffie config files at the top level of a card/folder. Root-level only, to
// match how classifyCard counts configs — a config on a card lives at the root. Returns
// [{ name, path }]; the marker test is the same one the classifier uses.
// Single source of truth for "is this a Proffie config file", shared by the
// "Open a config" chooser (findConfigs) AND the report's config COUNT
// (classifyCard) so the two can never disagree. CONFIG_TOP is the anchor —
// every ProffieOS config is built as `#ifdef CONFIG_TOP … #endif` and that
// token sits at the very top, so a 4 KB window always catches it. The
// `#include "proffieboard…"` / `proffieboard_v#` board line is a strong backup.
// A bare `BladeConfig` is deliberately NOT sufficient: that string turns up in
// readmes ("edit your BladeConfig{}") and pasted style snippets, so it's a
// false-positive path. Root-level files only (Proffie convention).
const CONFIG_EXT_RX = /\.(txt|h|hpp|ino)$/i;
const CONFIG_MARKER_RX = /CONFIG_TOP|proffieboard_v\d|#include\s+"proffieboard/i;
function isProffieConfigFile(fullPath, name) {
  if (!CONFIG_EXT_RX.test(name || fullPath)) return false;
  try { return CONFIG_MARKER_RX.test(fs.readFileSync(fullPath, 'utf8').slice(0, 4000)); }
  catch { return false; }
}

function findConfigs(dirPath) {
  const ents = safeReaddir(dirPath);
  if (ents.__error) return [];
  const out = [];
  for (const e of ents) {
    if (!e.isFile()) continue;
    const full = path.join(dirPath, e.name);
    if (isProffieConfigFile(full, e.name)) out.push({ name: e.name, path: full });
  }
  return out;
}

// Rank text files by how likely they name the font (readme/font/title beat a random txt).
function _readmeRank(name) {
  const n = name.toLowerCase();
  if (/^readme/.test(n)) return 3;
  if (/font|name|title|info/.test(n)) return 2;
  return 1;
}
// Does a line genuinely read like a font NAME (vs a settings line, a url, a marketing
// blurb)? Conservative on purpose — real cards hide settings/promo text in "readme"s, and
// a confusing auto-name is worse than the honest folder name. The review screen fixes edges.
function _looksLikeName(s) {
  if (!s || s.length < 2 || s.length > 48) return false;
  if (/[=@/\\():]|https?:|please|etsy|shop|consider|enjoy|thanks|subscribe|patreon|youtube|tiktok|instagram|twitter|discord|www\.|\.wav|\.ini|\.txt|settings|threshold/i.test(s)) return false;
  if (s.split(/\s+/).length > 6) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  return letters >= Math.ceil(s.length * 0.5);
}
// Is this file a readme/prose file we should read CONTENT from (vs a bare name-tag
// txt whose value is its FILENAME)? Keeping the two apart stops us pulling a noisy
// description line out of a name-tag file and ranking it above the name itself. The
// extension guard also keeps us from reading a binary doc (.docx/.pdf/.rtf) as text.
function _isReadmeShaped(name) {
  if (!/\.(txt|text|md|nfo)$/i.test(name)) return false;
  if (/\.(md|nfo)$/i.test(name)) return true;
  const stem = name.toLowerCase().replace(/\.[^.]*$/, '').replace(/[\s._-]+/g, ' ').trim();
  return /^(read ?me|info|about|description|desc|notes?|credits?|changelog|change log|instructions?)\b/.test(stem);
}
// A ProffieOS preset literal in a readme names the font directly: the FIRST quoted
// string in `{ "fontdir", "track/path.wav", Style..., "display" }` is the font's
// folder name. The most reliable name a readme carries ("copy this into your config").
function _presetFontName(head) {
  const m = head.match(/\{\s*"([A-Za-z0-9][^"]{1,47})"\s*,\s*"/);
  if (!m) return null;
  const dir = m[1].trim().replace(/[.\s]+$/, '');
  return _looksLikeTagName(dir) ? dir : null;
}
// A font name quoted at the START of an early line — the common readme title form
// (`"DarkWolf" an exclusive sound font...`). Requiring the line to open with the
// quote avoids grabbing an incidental quoted word mid-sentence.
function _quotedTitle(head) {
  for (const raw of head.split(/\r?\n/).slice(0, 8)) {
    // Accept straight OR curly quotes ("Name" and “Name”) — .docx readmes smart-quote.
    const m = raw.trim().match(/^["“]([A-Za-z0-9][^"“”]{1,47})["”]/);
    if (m) {
      const s = m[1].trim().replace(/[.\s]+$/, '');
      if (_looksLikeTagName(s)) return s;
    }
  }
  return null;
}
// Extract a font name from readme TEXT. Order: a preset literal (author says "paste
// this") beats a clean name line beats a quoted title. Returns null when nothing
// qualifies. Shared so the async docx path can reuse the exact same extraction.
function nameFromReadmeText(text) {
  const head = String(text || '').slice(0, 4000);
  const preset = _presetFontName(head);   // author says "paste this into your config"
  if (preset) return preset;
  const quoted = _quotedTitle(head);      // a line that OPENS with the quoted name (title form)
  if (quoted) return quoted;
  const line = head.split(/\r?\n/).map(s => s.replace(/^["'\s#*=-]+|["'\s#*=-]+$/g, '').trim())
    .find(_looksLikeName);                // last resort: any line that reads like a bare name
  if (line) return line;
  return null;
}
// Pull a font name from a readme/prose file inside the folder. Returns null (→
// name-tag / folder fallback) when nothing qualifies.
function _readmeTitle(dirPath) {
  const ents = safeReaddir(dirPath);
  if (ents.__error) return null;
  const txts = ents.filter(e => e.isFile() && _isReadmeShaped(e.name))
    .sort((a, b) => _readmeRank(b.name) - _readmeRank(a.name));
  for (const t of txts) {
    try {
      const name = nameFromReadmeText(fs.readFileSync(path.join(dirPath, t.name), 'utf8'));
      if (name) return name;
    } catch { /* skip unreadable */ }
  }
  return null;
}
// Read a Word .docx as plain text WITHOUT converting it on disk — a .docx is a zip;
// its text lives in word/document.xml as <w:t> runs. Pull that one entry, turn
// paragraphs/tabs/breaks into whitespace, strip the tags, decode entities. Async
// (zip read); read-only. Shared by the doc viewer and the guided-import late naming.
async function docxToText(absPath) {
  const StreamZip = require('node-stream-zip');
  const zip = new StreamZip.async({ file: absPath });
  try {
    const buf = await zip.entryData('word/document.xml');
    let x = buf.toString('utf8')
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '');
    x = x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(+d))
      .replace(/&amp;/g, '&');
    return x.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    await zip.close();
  }
}
// Standard txt/doc filenames whose NAME is never the font's name — readmes,
// licenses, settings dumps, index/function listings. (Their CONTENT may name the
// font; that's _readmeTitle's job.) Matched on the basename with extension gone
// and spaces/punctuation squeezed to single spaces.
const _STD_TXT_NAMES = new Set([
  'readme', 'read me', 'license', 'licence', 'copyright', 'credits',
  'settings', 'config', 'configuration', 'changelog', 'change log',
  'notes', 'info', 'information', 'instructions', 'font list', 'fontlist',
  'sd config', 'sdconfig',
]);
function _isStdTxtName(fileName) {
  const k = fileName.toLowerCase().replace(/\.[^.]*$/, '').replace(/[\s._-]+/g, ' ').trim();
  if (_STD_TXT_NAMES.has(k) || _STD_TXT_NAMES.has(k.replace(/\s+/g, ''))) return true;
  if (/functions?$/.test(k)) return true;   // "proffie os6.5 functions"
  if (/proffie\s*os/.test(k)) return true;
  return false;
}
// Lighter name check for a FILENAME tag than the content-line check: filenames
// legitimately carry parens/case a settings line never would ("FinalStep(YellowRey)",
// "Ascension(green)"), so we only reject urls/marketing/obvious non-names here.
function _looksLikeTagName(s) {
  if (!s || s.length < 2 || s.length > 48) return false;
  if (/https?:|www\.|patreon|youtube|discord|\.wav$|\.ini$/i.test(s)) return false;
  if (s.split(/\s+/).length > 6) return false;
  return (s.match(/[A-Za-z]/g) || []).length >= 2;
}
// The "name tag" convention (Golden Harvest / profezzorn default sets and others):
// the font's real name rides along as a .txt file whose FILENAME is the name —
// usually a 0-byte file — next to a generic BankNN folder. A signal, not gospel:
// ranked below readme CONTENT and surfaced to the review screen for confirmation.
function _nameTagTitle(dirPath) {
  const ents = safeReaddir(dirPath);
  if (ents.__error) return null;
  const cands = [];
  for (const e of ents) {
    if (!e.isFile() || !/\.txt$/i.test(e.name)) continue;
    if (_isStdTxtName(e.name)) continue;
    // Drop the extension, then any trailing dots/spaces ("Name..txt" -> "Name").
    const stem = e.name.replace(/\.txt$/i, '').replace(/[.\s]+$/, '').trim();
    if (!_looksLikeTagName(stem)) continue;
    let size = 1;
    try { size = fs.statSync(path.join(dirPath, e.name)).size; } catch { /* keep 1 */ }
    cands.push({ stem, size });
  }
  if (!cands.length) return null;
  const empty = cands.filter(c => c.size === 0);
  if (empty.length === 1) return empty[0].stem;   // the deliberate 0-byte tag
  if (empty.length > 1) return null;              // ambiguous — don't guess
  return cands.length === 1 ? cands[0].stem : null; // a lone non-empty candidate
}
// Best-guess display name for a font folder. Slot-named folders (BankNN and any
// prefix+number series — see the scan's numbered-series detection) carry no real
// name, so for those we walk the confidence ladder: readme CONTENT (highest) ->
// name-tag filename -> lightly-cleaned folder name (lowest). `source` tells the UI
// where the name came from so it can flag the low-confidence folder fallback.
// `opts.forceGeneric` lets the caller mark a folder generic from sibling context
// even when its own name doesn't match a known slot pattern.
function deriveFontName(dirPath, folderName, opts) {
  const base = folderName || path.basename(dirPath);
  const generic = (opts && opts.forceGeneric)
    || /^(bank|preset|font|slot)\s*\d+$/i.test(base) || /^\d+$/.test(base) || /^\d+[-_ ]/.test(base);
  if (generic) {
    const title = _readmeTitle(dirPath);          // 1 & 2: readme / readme-shaped content
    if (title) return { name: title, source: 'readme' };
    const tag = _nameTagTitle(dirPath);           // 3: name-tag filename
    if (tag) return { name: tag, source: 'name-tag' };
  }
  const cleaned = base.replace(/[_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  return { name: cleaned || base, source: generic ? 'folder-fallback' : 'folder' };
}
// Enumerate the sound-font folders on a card/folder and gather what the import + naming
// review UI needs per font: a suggested name (+ where it came from) and the two preview
// sounds (font.wav / hum.wav). Read-only; no card writes.
function analyzeFonts(dirPath) {
  const ents = safeReaddir(dirPath);
  if (ents.__error) return { path: dirPath, error: ents.__error, fonts: [] };
  const fonts = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    if (NON_FONT_DIRS.has(e.name.toLowerCase()) || FAKE_MARKER_RX.test(e.name)) continue;
    const full = path.join(dirPath, e.name);
    if (!looksLikeProffieFontDir(full)) continue;
    const inner = safeReaddir(full);
    const files = inner.__error ? [] : inner.filter(x => x.isFile()).map(x => x.name);
    // The two SFL-standard preview sounds. hum is sometimes hum1.wav rather than hum.wav.
    const fontFile = files.find(f => f.toLowerCase() === 'font.wav');
    const humFile = files.find(f => f.toLowerCase() === 'hum.wav') || files.find(f => /^hum\d+\.wav$/i.test(f));
    const derived = deriveFontName(full, e.name);
    fonts.push({
      folder: e.name,
      path: full,
      suggestedName: derived.name,
      nameSource: derived.source,
      hasFontWav: !!fontFile,
      hasHumWav: !!humFile,
      fontWavPath: fontFile ? path.join(full, fontFile) : null,
      humWavPath: humFile ? path.join(full, humFile) : null,
      fileCount: files.length,
    });
  }
  fonts.sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true }));
  return { path: dirPath, fonts };
}

module.exports = { scan, assessCard, assessPath, assessPicked, classifyCard, listDir, findConfigs, deriveFontName, nameFromReadmeText, docxToText, analyzeFonts, resolveIdentity, isDegenerateVsn, formatVsn, enumerateAllVolumes, enumerateRemovableVolumes, scanFolderHealth, checkWavHealth, checkWavBuffer };
