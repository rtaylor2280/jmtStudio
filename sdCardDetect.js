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
  //
  // hasMedia distinguishes "no card in this slot" from "card present but unreadable".
  // A multi-slot reader publishes a drive letter for EVERY slot, occupied or not, so an
  // empty slot arrives here looking like a volume. Win32_LogicalDisk reports Size as null
  // for it (verified 2026-08-06 against a two-slot reader: the loaded slot reported a size,
  // the empty one reported null), and the storage layer agrees — Win32_DiskDrive gives that
  // slot a blank MediaType and a null Size. Note this must be tested BEFORE the [int64] cast
  // below, which turns null into 0 and destroys the distinction. Empty slots cannot be
  // reached through partition associations, since a slot with no media has no partitions,
  // which is why the answer is taken here rather than derived downstream.
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
    '    hasMedia     = ($null -ne $v.Size)',
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
  //
  // CONTRACT for whoever implements these: set hasMedia to false for a reader slot with no
  // card in it, and true otherwise. scan() drops anything with hasMedia === false, because
  // an empty slot is not a card and must never be reported as a damaged one. Answer it from
  // whatever the platform states directly rather than re-deriving Windows-shaped nulls:
  // udisks2 exposes a HasMedia property, and lsblk reports size 0 for an empty slot. macOS
  // may never present the case at all, since it does not usually mount an empty slot; if so,
  // returning true unconditionally is correct there. Neither has been tested.
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
// Folders left on a card by whoever preloaded it - a seller's note, usually
// CJK-bracketed and often called "attention please". They are NOT fonts, so they
// are skipped by the font count and the import scan. That is the whole of it.
//
// ⚠️ IT USED TO BE CALLED VENDOR_NOTE_DIR_RX AND DROVE A "this card shows signs of
// being counterfeit" VERDICT. Removed 2026-08-31, his call: "not sure where we
// decided to call this counterfeit. and we are not even testing." He was right on
// both counts. The app performs NO capacity test anywhere, and a folder name is a
// property of whoever last wrote to the card, not of the card - copy that folder
// onto a genuine SanDisk and it would have been accused too. Asserting counterfeit
// about hardware someone paid for, on that evidence, is the app stating something
// it cannot show.
// The contrast that settles it, and it is the standard to hold: [B-214] refuses
// executables by reading `MZ` out of the file. That is a fact about the bytes. This
// was an inference about a vendor. Assert the consequence you can prove, never the
// identity you inferred (ui-conventions, 2026-08-28).
// Do NOT reintroduce a verdict here. If fake capacity is ever worth answering, it
// takes a write-verify pass over the whole card, and nothing less.
const VENDOR_NOTE_DIR_RX = /【|attention\s*please|警告|注意/i;

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
  const namedFontDirs = dirNames.filter(n => !NON_FONT_DIRS.has(n.toLowerCase()) && !/^\d+$/.test(n) && !/^\d+-/.test(n) && !VENDOR_NOTE_DIR_RX.test(n));
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
    if (NON_FONT_DIRS.has(n.toLowerCase()) || VENDOR_NOTE_DIR_RX.test(n)) return false;
    const ents = safeReaddir(path.join(vol.mountPath, n));
    if (ents.__error) return false;
    if (ents.some(e => e.isFile() && CORE_EFFECT_FILE.test(e.name))) return true;
    return ents.some(e => e.isDirectory() && (EFFECT_DIR_NAMES.has(e.name.toLowerCase()) || /^alt\d{3}$/i.test(e.name)));
  }).length;
  const configFiles = files.filter(f => isProffieConfigFile(path.join(vol.mountPath, f.name), f.name)).length;
  const otherFiles = Math.max(0, files.filter(f => f.name.toLowerCase() !== SIDECAR_NAME).length - configFiles);
  // Collection shape ([B-348]): real cards do not carry zip archives in bulk —
  // a folder with several top-level zips is a font COLLECTION (downloads,
  // backups), which belongs in Bulk Import (async scan, honest progress,
  // cancel), not the card browser's health walk. Names/dirents only — this
  // test must stay cheap enough to run before ANY file content is read, so it
  // can never hydrate a cloud placeholder.
  const zipFiles = files.filter(f => /\.zip$/i.test(f.name)).length;
  const collectionShape = zipFiles >= 3;

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
    counts: { fonts: fontFolders, configs: configFiles, otherFiles, zips: zipFiles },
    collectionShape,
    contentTypes, mixed,
    signals: { matched, namedFontDirs: namedFontDirs.length, numberedFontDirs: numberedDirs.length, nNameDirs: nNameDirs.length, provenProffieFonts },
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
  // Drop empty reader slots. They are not cards, and reporting one as "this card couldn't be
  // read, it may be damaged" is both false and alarming — a two-slot reader holding one card
  // would otherwise list a phantom damaged card beside the real one, and a reader with nothing
  // in it would list only phantoms instead of falling through to "No SD card found".
  // Only a slot with no media is dropped; a card that IS present but unreadable still surfaces,
  // because that one may genuinely be damaged and the user needs to know. A user who explicitly
  // points at an empty slot still gets it assessed, since assessPicked does not come through here.
  return vols.filter(v => v.hasMedia !== false).map(assessCard);
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
// ── EXECUTABLES ON A SOUND-FONT CARD ([B-214]) ──────────────────────────────
//
// Chinese-made sabers and preloaded Proffie cards circulate with EXE files sitting
// inside font folders, named after their own parent folder so a double-click looks
// like opening the font (Crucible thread 8143: Worm:Win32/Nuqel.BJ at
// G:\CalKestis\CalKestis.exe, remediation INCOMPLETE). Nothing executable has any
// business in a font, so the import strips it rather than warning about it.
//
// TWO TESTS, AND THE SECOND IS THE POINT. An extension blocklist has an obvious
// evasion: rename CalKestis.exe to CalKestis.wav and it walks straight through,
// while the board simply fails to play it. So the extension list is the FLOOR. The
// real test is the leading bytes, which say what a file IS whatever it is called -
// and it is close to free, because the import already opens every one of these
// files to hash it.
//
// Deliberately NOT here: shebang scripts (#!), which are unremarkable text on a
// card that has been near a Mac, and archives, which are ordinary font delivery.
// The list is what executes on a desktop OS if double-clicked.
const _EXE_EXT_RX = /\.(exe|com|scr|pif|bat|cmd|msi|dll|lnk|vbs|vbe|jse|wsf|ps1|hta|cpl|jar|app)$/i;

// ⚠️ NOBODY TESTS THE RAW REGEX. Windows discards trailing dots and spaces when it
// resolves a path, so "Payload.exe " and "Payload.exe." both LAUNCH as Payload.exe
// while failing a naive end-anchored match. That strip was written beside the first
// caller that needed it (checkExecutableBuffer, 2026-09-09) and never reached the
// other three: the card walk and the bulk-import walk both matched raw names, so the
// evasion passed both. Found by his test pass 2026-09-10 - the card report said 6
// program files when there were 7.
// So the RULE lives here as a function and the regex is no longer exported. A caller
// cannot reintroduce this by forgetting a step it can no longer see.
function _stripTrailingDotsSpaces(name) { return String(name || '').replace(/[. ]+$/, ''); }
function looksExecutableName(name) { return _EXE_EXT_RX.test(_stripTrailingDotsSpaces(name)); }

// Magic numbers, checked against the first bytes of the file itself.
//   MZ            DOS/Windows executable (PE lives behind this header too)
//   \x7fELF       Linux/Unix executable
//   \xFE\xED\xFA / \xCA\xFE\xBA\xBE   Mach-O and universal binaries (macOS)
function _looksExecutable(buf) {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0x4d && buf[1] === 0x5a) return true;                       // MZ
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true; // ELF
  const m = buf.readUInt32BE(0);
  // Mach-O 32/64 both endians, plus the fat/universal wrapper.
  if (m === 0xfeedface || m === 0xfeedfacf || m === 0xcefaedfe || m === 0xcffaedfe) return true;
  if (m === 0xcafebabe || m === 0xbebafeca) return true;
  return false;
}

// Public: is this file executable, by name or by content? Takes the bytes the
// caller ALREADY read (same contract as checkWavBuffer, so one read serves both
// predicates). Returns { blocked, reason, byContent, byName, disguised } or
// { blocked: false }.
//
// The two reasons are worded differently ON PURPOSE. A file that admits what it is
// gets a plain statement; a file whose bytes disagree with its name is the case the
// user most needs to see, and it is stated as the mismatch it is.
//
// ⚠️ `disguised` IS THE ONE CONSUMERS SHOULD USE, AND IT EXISTS BECAUSE byContent
// ALONE READ AS CONCEALMENT AND IS NOT. Every real program has executable bytes, so
// byContent is true for an honestly named Installer.exe too - the UI called seven
// plainly named .exe files "disguised as a sound file" when only two were disguised
// (measured on his card, 2026-09-10). Concealment is byContent AND NOT byName.
// Shipped as a single flag rather than two, so no screen has to remember to combine
// them: a consumer that must AND two booleans correctly will eventually not.
function checkExecutableBuffer(buf, relPath) {
  const byContent = _looksExecutable(buf);
  // The trailing dot/space strip lives in looksExecutableName, above, so every
  // caller gets it. See the warning there for why it must not be inlined again.
  const byName = looksExecutableName(relPath);
  if (!byContent && !byName) return { blocked: false };
  if (byContent && !byName) {
    return { blocked: true, byContent: true, byName: false, disguised: true,
      reason: 'This file is a program, despite its name. It was left out.' };
  }
  return { blocked: true, byContent, byName: true, disguised: false,
    reason: 'This is a program file, which does not belong in a sound font. It was left out.' };
}
// Every executable-looking NAME on a card, found without opening a single file.
//
// This is the one card-wide walk that survives [B-361], and it survives because it
// is a different cost class from the one that was deleted. That walk OPENED 7,307
// files and cost minutes. This one reads directory entries only - no open, not even
// a stat, because a name test does not care about size. MEASURED 2026-09-09 on real
// cards: 100 ms for 1,401 folders / 7,563 files, and 61 ms for 1,012 / 6,162.
//
// ⚠️ NAMES ONLY, AND THAT LIMIT MUST TRAVEL WITH THE RESULT. A program renamed to
// hum.wav is invisible here; catching that needs the leading bytes, which is what
// the import does (checkExecutableBuffer, off the read it already performs). So a
// clean result here means "nothing is ADMITTING to being a program", never "this
// card is clean" - the same speak-to-proof discipline the wav sampling had.
function scanCardExecutables(mountPath, opts) {
  const o = opts || {};
  const maxReport = o.maxReport == null ? 50 : o.maxReport;
  const budgetMs = o.budgetMs == null ? 4000 : o.budgetMs;
  const t0 = Date.now();
  const out = { files: [], complete: true, scanned: 0, ms: 0 };
  const stack = [{ dir: mountPath, depth: 0 }];
  while (stack.length) {
    if (out.files.length >= maxReport || Date.now() - t0 > budgetMs) { out.complete = false; break; }
    const { dir, depth } = stack.pop();
    if (depth > 8) continue;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (_isSdNoise(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth === 0 && e.name.toLowerCase() === 'system volume information') continue;
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      out.scanned++;
      if (looksExecutableName(e.name)) {
        out.files.push(path.relative(mountPath, full).split(path.sep).join('/'));
      }
    }
  }
  out.ms = Date.now() - t0;
  return out;
}
// ── THREE TIERS, NOT TWO ([B-214], his calls 2026-09-09) ───────────────────
//
// BLOCK - a program. Removed, always, from every import path. A program in a
//   sound font is out of place by definition; that is the whole basis and it
//   does not need a malware claim behind it.
//
// WARN BUT ALLOW - a macro-enabled document (.docm and friends). These DO carry
//   a real Windows attack vector, but the common case is someone whose Word save
//   dialog chose the format for them without their noticing. Refusing a receipt
//   because of the letter "m" would cost a real user their proof of purchase to
//   guard against something that is usually nothing. Say it, keep it.
//
// OPAQUE - an archive format we cannot open (.rar, .7z and friends). Nothing is
//   wrong with it and nothing is claimed about it. It is reported precisely
//   BECAUSE silence would read as "checked and clean", which is the false
//   all-clear this feature is otherwise careful to avoid. We looked; we could
//   not see inside; the user should know which of those happened.
const _MACRO_EXT_RX = /\.(docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|sldm)$/i;
const _OPAQUE_ARCHIVE_RX = /\.(rar|7z|cab|iso|dmg|tar|tgz|gz|bz2|xz)$/i;

// Full verdict for one file. `kind` is one of:
//   'program' (blocked) | 'macro' (allowed, warned) | 'opaque' (allowed, noted) | 'ok'
// Takes bytes the caller already read, same contract as checkExecutableBuffer.
function classifyFileBuffer(buf, relPath) {
  const exe = checkExecutableBuffer(buf, relPath);
  if (exe.blocked) return { kind: 'program', blocked: true, byContent: !!exe.byContent,
    byName: !!exe.byName, disguised: !!exe.disguised, reason: exe.reason };
  const clean = String(relPath || '').replace(/[. ]+$/, '');
  if (_MACRO_EXT_RX.test(clean)) {
    return { kind: 'macro', blocked: false,
      reason: 'This document can contain macros, which are small programs. It was imported; open it with care.' };
  }
  if (_OPAQUE_ARCHIVE_RX.test(clean)) {
    return { kind: 'opaque', blocked: false,
      reason: 'This archive format cannot be opened here, so its contents were not checked.' };
  }
  return { kind: 'ok', blocked: false };
}

// THE ONE GUARD EVERY IMPORT PATH CALLS ([B-214]).
//
// Reads the head of a file on disk and runs both tiers against it: the cheap
// name test, then the leading bytes. Exists because the app has SIX places that
// copy user content onto the disk - sources by folder, sources by zip, common
// folders, shared tracks, attachments, and inner archives - and a rule written
// at one of them protects only that one. The gap is not theoretical: the folder
// and zip routes were guarded first, and a program could still walk in as an
// attachment or inside a common folder.
//
// Returns { blocked, reason, byContent } - the same shape as the buffer test,
// so a caller can report it identically wherever it fired.
// Same as classifyFileBuffer, for a caller holding a path rather than bytes.
function classifyFile(absPath, relPath) {
  const v = checkExecutableFile(absPath, relPath);
  if (v.blocked) return { kind: 'program', blocked: true, byContent: !!v.byContent, reason: v.reason };
  return classifyFileBuffer(null, relPath || absPath);
}

function checkExecutableFile(absPath, relPath) {
  let head = null;
  let fd;
  try { fd = fs.openSync(absPath, 'r'); } catch { fd = null; }
  if (fd != null) {
    try {
      const buf = Buffer.alloc(256);
      const n = fs.readSync(fd, buf, 0, 256, 0);
      head = n > 0 ? buf.subarray(0, n) : Buffer.alloc(0);
    } catch { head = null; }
    finally { try { fs.closeSync(fd); } catch {} }
  }
  return checkExecutableBuffer(head, relPath || absPath);
}

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

// ── Async health walk ([B-348]) ────────────────────────
// (The SYNC scanFolderHealth/_scanSubtreeCorruption pair is gone — removed,
// not guarded, when the browser moved to the async walk below. Their checks
// and caps live on in _subtreeCorruptionAsync.)
// Same corruption checks as scanFolderHealth, rebuilt for the main process's
// event loop: fully async (fs.promises yields on every open/read/readdir),
// cancellable between files, and progress-reporting. Measured reality that
// forced this shape (2026-09-08, RevantedJMT): file OPENS on a slow card run
// ~36ms each, so 7,307 wavs cost minutes — the walk must never block, must
// say how far it is, and must be abandonable.
//
// Cloud placeholders are never hydrated: a file whose on-disk allocation is
// zero while its logical size is not (st.blocks === 0 && st.size > 0) is an
// online-only placeholder (OneDrive / Google Drive stream). Opening one
// triggers a hidden network download of the whole file, so it is skipped and
// tallied as notChecked instead of read.
const fsp = fs.promises;

function _isPlaceholderStat(st) {
  // blocks===0 alone is NOT enough: tiny files live RESIDENT in the NTFS MFT
  // and also report zero allocation (caught by the B-348 proof fixture — the
  // first heuristic skipped every wav under ~700 bytes as a "placeholder").
  // Above one cluster, zero allocation with nonzero size can only be a
  // sparse/placeholder file; below it, just read the file — even a true tiny
  // placeholder costs a one-cluster fetch, not a hidden bulk download.
  // (Google Drive stream defeats this signal entirely — placeholders report
  // full allocation, verified 2026-09-08 — which is why cloud MOUNTS get a
  // consent gate in the renderer instead of relying on per-file detection.)
  return st.size > 4096 && st.blocks === 0;
}

async function checkWavHealthAsync(filePath, size) {
  if (size === 0) return { corrupt: true, reason: 'This file is empty and will not play.' };
  let fh;
  try { fh = await fsp.open(filePath, 'r'); }
  catch (e) { return { corrupt: true, reason: `This file could not be read (${e.code || 'error'}).` }; }
  try {
    const buf = Buffer.alloc(Math.min(size, 256));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return checkWavBuffer(bytesRead < buf.length ? buf.subarray(0, bytesRead) : buf, size);
  } catch (e) {
    return { corrupt: true, reason: `The audio header could not be read (${e.code || 'error'}).` };
  } finally { try { await fh.close(); } catch {} }
}

// Recursive corruption tally, async twin of _scanSubtreeCorruption. Same
// depth/count caps. opts.tick fires once per file OPENED (the honest unit of
// work — a skipped placeholder does not tick).
async function _subtreeCorruptionAsync(dirPath, depth, acc, cancelled, tick) {
  if (depth > 6 || acc.count >= 50 || cancelled()) return acc;
  let ents;
  try { ents = await fsp.readdir(dirPath, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (cancelled()) return acc;
    if (_isSdNoise(e.name)) continue;
    const full = path.join(dirPath, e.name);
    if (e.isFile()) {
      if (!_WAV_RX.test(e.name)) continue;
      let st = null; try { st = await fsp.stat(full); } catch { continue; }
      if (_isPlaceholderStat(st)) { acc.notChecked++; continue; }
      const h = await checkWavHealthAsync(full, st.size);
      acc.seen++;
      if (tick) { try { tick(); } catch {} }
      if (h.corrupt) { acc.count++; if (!acc.first) acc.first = h.reason; }
    } else if (e.isDirectory()) {
      await _subtreeCorruptionAsync(full, depth + 1, acc, cancelled, tick);
    }
    if (acc.count >= 50) break;
  }
  return acc;
}

// Walks each named subfolder of dirPath in turn — the folder-badge half of
// scanFolderHealth, made incremental. opts.onDirDone fires as EACH subfolder
// completes ({name, index, total, issue, seen}) so the UI can badge folders
// one by one instead of holding the whole card's answer hostage. Returns
// { dirs, cancelled, seen, notChecked } with the scanFolderHealth dirs shape.
async function subtreeHealthAsync(dirPath, dirNames, opts = {}) {
  const cancelled = opts.isCancelled || (() => false);
  const dirs = {};
  let seen = 0, notChecked = 0;
  for (let i = 0; i < dirNames.length; i++) {
    if (cancelled()) return { dirs, cancelled: true, seen, notChecked };
    const name = dirNames[i];
    const acc = { count: 0, first: null, seen: 0, notChecked: 0 };
    await _subtreeCorruptionAsync(path.join(dirPath, name), 0, acc, cancelled,
      opts.tick ? () => opts.tick(seen + acc.seen) : null);
    seen += acc.seen; notChecked += acc.notChecked;
    if (acc.count > 0) dirs[name] = { count: acc.count, reason: acc.first };
    if (opts.onDirDone) { try { opts.onDirDone({ name, index: i, total: dirNames.length, issue: dirs[name] || null, seen }); } catch {} }
  }
  return { dirs, cancelled: cancelled(), seen, notChecked };
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
// Async docx name-recovery — the .docx-shaped sibling of _readmeTitle. The sync readme
// ladder can't read a .docx (it's a zip that needs an async read, so _isReadmeShaped
// excludes it), which is why a docx-only-named font falls back to a generic name on the
// fast scan. This recovers it the same way a .txt readme is read: find every .docx in the
// folder (readme-named ranked first, exactly like the text path), translate each with the
// same docxToText the doc viewer uses, and run the identical nameFromReadmeText extraction.
// Returns the raw extracted name (caller cleans, matching _readmeTitle) or null. Read-only.
async function recoverNameFromDocx(dirPath) {
  const ents = safeReaddir(dirPath);
  if (ents.__error) return null;
  const docxs = ents.filter(e => e.isFile() && /\.docx$/i.test(e.name))
    .sort((a, b) => _readmeRank(b.name) - _readmeRank(a.name));
  for (const d of docxs) {
    try {
      const name = nameFromReadmeText(await docxToText(path.join(dirPath, d.name)));
      if (name) return name;
    } catch { /* skip unreadable / corrupt docx */ }
  }
  return null;
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
async function analyzeFonts(dirPath) {
  const ents = safeReaddir(dirPath);
  if (ents.__error) return { path: dirPath, error: ents.__error, fonts: [] };
  const fonts = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    if (NON_FONT_DIRS.has(e.name.toLowerCase()) || VENDOR_NOTE_DIR_RX.test(e.name)) continue;
    const full = path.join(dirPath, e.name);
    if (!looksLikeProffieFontDir(full)) continue;
    const inner = safeReaddir(full);
    const files = inner.__error ? [] : inner.filter(x => x.isFile()).map(x => x.name);
    // The two SFL-standard preview sounds. hum is sometimes hum1.wav rather than hum.wav.
    const fontFile = files.find(f => f.toLowerCase() === 'font.wav');
    const humFile = files.find(f => f.toLowerCase() === 'hum.wav') || files.find(f => /^hum\d+\.wav$/i.test(f));
    const derived = deriveFontName(full, e.name);
    // Docx recovery: the sync ladder above can't read a .docx, so a font whose only
    // real name lives in a Word readme lands as 'folder-fallback' here. Give it the
    // same second shot the import flow gets — same helper, one place.
    if (derived.source === 'folder-fallback') {
      try {
        const docxName = await recoverNameFromDocx(full);
        if (docxName) { derived.name = docxName; derived.source = 'readme'; }
      } catch { /* leave the fallback name */ }
    }
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

module.exports = { scan, assessCard, assessPath, assessPicked, classifyCard, listDir, findConfigs, deriveFontName, nameFromReadmeText, docxToText, recoverNameFromDocx, analyzeFonts, resolveIdentity, isDegenerateVsn, formatVsn, enumerateAllVolumes, enumerateRemovableVolumes, checkWavHealth, checkWavBuffer, checkExecutableBuffer, checkExecutableFile, classifyFileBuffer, classifyFile, scanCardExecutables, looksExecutableName, subtreeHealthAsync, checkWavHealthAsync };
