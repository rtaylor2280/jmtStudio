'use strict';
// Board Forensics [B-543]: read everything a Proffieboard will tell us, copy its firmware, keep it
// per board, and put it back on request.
//
// Storage: <userData>/board-forensics/<SERIAL>/
//   board.json            the board's record: its captures, which one is the original, offer state
//   <captureId>/          one folder per capture, never rewritten once saved
//     report.json         everything parsed, plus the raw replies it was parsed from
//     serial.txt          the serial transcript exactly as received
//     dfu-list.txt        dfu-util -l output for this board
//     firmware-full.bin   the whole flash as read
//     firmware.bin        the same image with the erased tail (0xFF) trimmed; this is what restore writes
//     option-bytes.bin    read protection level and other option bytes
//     otp.bin             one-time-programmable area
//     strings.txt         printable text found in the image
// The first capture of a board with a verified firmware image is its "original" and is never
// replaced. Raw replies are kept so later features can re-parse what this version does not
// understand yet.
//
// Every successful flash adds an entry to board.json "flashes": when, which config, the versions
// and the build's cache key. Its firmware, config text and my_styles.h are in the board's own
// flashes/<flashId>/ folder, as hard links to <userData>/board-forensics/store/<sha256>, which holds one
// file per distinct content. A recording's firmware is linked into the store the same way. So each
// content is on disk once, a board's folder holds everything it needs, deleting a board folder leaves
// whatever another board still links to, and a store file with no other link is used by nothing.
// Where a link cannot be made, the file is copied.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const SCHEMA = 1;
const DIR_NAME = 'board-forensics';

// Read-only queries, in order. `scanid` re-runs blade detection, which is what makes each blade
// print its LED count; it is skipped when the saber is on.
const SERIAL_COMMANDS = [
  'version', 'help', 'get_on', 'get_preset', 'get_volume', 'battery_voltage', 'id',
  'list_presets', 'list_named_styles', 'list_fonts', 'list_tracks',
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Resolves with the promise's value, or `fallback` once `ms` pass, whichever comes first.
const within = (p, ms, fallback) => Promise.race([p, sleep(ms).then(() => fallback)]);

// ── Parsers (pure) ─────────────────────────────────────

// Reply to `version`: version line, CONFIG_FILE, prop, buttons, installed. Any line may be absent.
function parseVersionReply(text) {
  const out = { version: null, configFile: null, prop: null, buttons: null, installed: null };
  if (!text) return out;
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    let m;
    if (!out.version && (m = l.match(/^v?(\d+\.\d+[\w.\-]*)$/))) { out.version = 'v' + m[1].replace(/[.\-]+$/, ''); continue; }
    if (!out.version && /^\$Id:/.test(l)) { out.version = l; continue; }
    if (!out.configFile && /\.h$/i.test(l) && !/\s/.test(l)) { out.configFile = l; continue; }
    if ((m = l.match(/^prop:\s*(.+)$/i))) { out.prop = m[1].trim(); continue; }
    if ((m = l.match(/^buttons:\s*(\d+)/i))) { out.buttons = Number(m[1]); continue; }
    if ((m = l.match(/^installed:\s*(.+)$/i))) { out.installed = m[1].trim(); continue; }
  }
  return out;
}

// Reply to `list_presets`: blocks starting at FONT=. Lines the firmware prints in between
// (e.g. "Failed to mount SD card.") are counted, not kept in the presets.
function parsePresets(text) {
  const presets = [];
  let cur = null;
  let sdMountFailures = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (/^Failed to mount SD card/i.test(l)) { sdMountFailures++; continue; }
    const m = l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'FONT') {
      cur = { index: presets.length, font: val, fontFolders: val.split(';').map(s => s.trim()).filter(Boolean),
              track: null, styles: [], name: null, variation: null };
      presets.push(cur);
      continue;
    }
    if (!cur) continue;
    if (key === 'TRACK') cur.track = val;
    else if (/^STYLE\d+$/.test(key)) cur.styles[Number(key.slice(5)) - 1] = val;
    else if (key === 'NAME') cur.name = val;
    else if (key === 'VARIATION') cur.variation = Number(val);
    else (cur.extra || (cur.extra = {}))[key] = val;
  }
  return { presets, sdMountFailures };
}

// Reply to `scanid`: which blade config was chosen and what each blade reported.
function parseScanid(text) {
  const out = { bladeConfig: null, blades: [], displayInitialized: false, fontsScanned: [], styleRam: [] };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim();
    let m;
    if ((m = l.match(/^blade\s*=\s*(\d+)/i))) out.bladeConfig = Number(m[1]);
    else if ((m = l.match(/^(\w+)\s+Blade with\s+(\d+)\s+leds?/i))) out.blades.push({ type: m[1], leds: Number(m[2]) });
    else if (/^Display initialized/i.test(l)) out.displayInitialized = true;
    else if ((m = l.match(/^Scanning sound font:\s*(.+?)\s*(NOT FOUND!?)?$/i))) out.fontsScanned.push({ name: m[1], found: !m[2] });
    else if ((m = l.match(/^Style RAM\s*=\s*(\d+)/i))) out.styleRam.push(Number(m[1]));
  }
  return out;
}

// Reply to `list_named_styles`: names, plus how many `builtin p b` entries there were.
function parseNamedStyles(text) {
  const names = [];
  let builtinCount = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (/^builtin\s+\d+\s+\d+$/.test(l)) { builtinCount++; continue; }
    if (/^[A-Za-z][\w-]*$/.test(l)) names.push(l);
  }
  return { names, builtinCount };
}

// Reply lines that are not an answer: the firmware's "Whut? :cmd" for an unknown command.
const isUnknownCommand = (text) => /Whut\?/i.test(String(text || ''));

function parseNumber(text, re = /(-?\d+(?:\.\d+)?)/) {
  if (!text || isUnknownCommand(text)) return null;
  const m = String(text).match(re);
  return m ? Number(m[1]) : null;
}

// Plain list replies (list_fonts, list_tracks): non-empty lines that are not status chatter.
function parseList(text) {
  if (!text || isUnknownCommand(text)) return null;
  return String(text).split(/\r?\n/).map(l => l.trim())
    .filter(l => l && !/^Failed to mount SD card/i.test(l));
}

// dfu-util -l lines for one serial: alt settings and their memory layout.
//   name="@Internal Flash  /0x08000000/0256*0002Kg"
function parseDfuListing(text, serial) {
  const regions = [];
  for (const l of String(text || '').split(/\r?\n/)) {
    if (!/Found DFU:/.test(l)) continue;
    if (serial) {
      const sm = l.match(/serial="([^"]*)"/);
      if (!sm || sm[1].toUpperCase() !== String(serial).toUpperCase()) continue;
    }
    const alt = l.match(/alt=(\d+)/);
    const nm = l.match(/name="@([^/"]+)\/(0x[0-9A-Fa-f]+)\/(\d+)\*(\d+)\s*([KMB ]?)([a-g]?)"?/);
    if (!alt || !nm) continue;
    const mult = nm[5] === 'K' ? 1024 : nm[5] === 'M' ? 1024 * 1024 : 1;
    const pages = Number(nm[3]);
    const pageSize = Number(nm[4]) * mult;
    regions.push({ alt: Number(alt[1]), name: nm[1].trim(), start: nm[2].toLowerCase(), pages, pageSize, size: pages * pageSize });
  }
  return regions;
}

// STM32L4 option bytes: byte 0 is RDP. 0xAA = level 0 (readable), 0xCC = level 2 (permanent lock),
// anything else = level 1 (flash not readable over DFU).
function parseOptionBytes(buf) {
  if (!buf || !buf.length) return { rdpByte: null, rdpLevel: null };
  const b = buf[0];
  return { rdpByte: b, rdpLevel: b === 0xAA ? 0 : b === 0xCC ? 2 : 1, hex: buf.toString('hex') };
}

// Image length without the erased (0xFF) tail.
function usedLength(buf) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0xFF) end--;
  return end;
}

function extractStrings(buf, minLen = 6) {
  const out = [];
  let cur = '';
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 32 && c < 127) cur += String.fromCharCode(c);
    else { if (cur.length >= minLen) out.push(cur); cur = ''; }
  }
  if (cur.length >= minLen) out.push(cur);
  return out;
}

// Flash size decides board generation for restore: a V3 (L452) has 512 KB, a V2 (L433) 256 KB.
function generationForFlashSize(size) {
  if (size === 512 * 1024) return 'V3';
  if (size === 256 * 1024) return 'V2';
  return null;
}

// ── Serial ─────────────────────────────────────────────

// Sends each command at 115200 and collects the reply until the line goes quiet. Never opens at
// 1200 baud (that is the bootloader touch reset). Always closes the port.
async function querySerial(port, commands, { quietMs = 700, maxMs = 12000, firstByteMs = 2500, openRetryMs = 6000, onCommand, onReply } = {}) {
  const { SerialPort } = require('serialport');
  // A port that has just appeared can refuse to open for a moment (Windows "error code 31", "433",
  // "file not found") while the board finishes starting. Opening is retried for up to openRetryMs.
  let sp = null, opened = null;
  const openStart = Date.now();
  for (;;) {
    sp = new SerialPort({ path: port, baudRate: 115200, autoOpen: false });
    sp.on('error', () => {});
    opened = await within(new Promise((res) => sp.open(e => res(e ? e.message : 'ok'))), 5000, 'timed out opening the port');
    if (opened === 'ok' || Date.now() - openStart >= openRetryMs) break;
    try { sp.isOpen && sp.close(() => {}); } catch {}
    await sleep(500);
  }
  if (opened !== 'ok') {
    try { sp.isOpen && sp.close(() => {}); } catch {}
    return { ok: false, error: opened, replies: {} };
  }
  let buf = '';
  let lastData = 0;
  sp.on('data', (c) => { buf += c.toString('utf8'); lastData = Date.now(); });
  const replies = {};
  const order = [];
  try {
    await sleep(300);
    const preamble = buf;
    buf = '';
    if (preamble.trim()) replies._preamble = preamble;
    for (const cmd of commands) {
      if (onCommand) { try { onCommand(cmd); } catch {} }
      buf = '';
      lastData = 0;
      await within(new Promise((res) => sp.write(cmd + '\n', () => res())), 2000);
      const start = Date.now();
      for (;;) {
        await sleep(60);
        const now = Date.now();
        if (buf && now - lastData >= quietMs) break;
        if (!buf && now - start >= firstByteMs) break;
        if (now - start >= maxMs) break;
      }
      replies[cmd] = buf;
      order.push(cmd);
      if (onReply) { try { onReply(cmd, buf); } catch {} }
    }
  } finally {
    try { sp.removeAllListeners('data'); } catch {}
    await within(new Promise((res) => { try { sp.isOpen ? sp.close(() => res()) : res(); } catch { res(); } }), 3000);
  }
  return { ok: true, replies, order };
}

// One preset as text: font folders, track, and its name when it has one.
function presetText(p) {
  const name = p.name && p.name !== '0' ? ` · "${p.name}"` : '';
  return `${(p.fontFolders || []).join(' + ')}${p.track ? ` · ${p.track}` : ''}${name}`;
}

// Readable lines for one reply, written to the log as each reply arrives.
function replyLines(cmd, text) {
  const out = [];
  const unknown = isUnknownCommand(text);
  switch (cmd) {
    case 'version': {
      const v = parseVersionReply(text);
      if (v.version) out.push(`ProffieOS ${v.version}`);
      if (v.configFile) out.push(`Config file: ${v.configFile}`);
      if (v.prop) out.push(`Prop: ${v.prop}`);
      if (v.buttons != null) out.push(`Buttons: ${v.buttons}`);
      if (v.installed) out.push(`Built: ${v.installed}`);
      if (!out.length) out.push('No answer to version.');
      break;
    }
    case 'help':
      out.push(unknown ? 'Serial diagnostic commands are turned off in this build.'
                       : `Serial commands available: ${String(text).split(/\r?\n/).filter(l => l.trim()).length}`);
      break;
    case 'get_on': { const n = parseNumber(text, /^\s*(\d)/m); if (n != null) out.push(`Blade on: ${n ? 'yes' : 'no'}`); break; }
    case 'get_preset': { const n = parseNumber(text, /^\s*(-?\d+)/m); if (n != null) out.push(`Current preset: ${n + 1}`); break; }
    case 'get_volume': { const n = parseNumber(text, /^\s*(\d+)/m); if (n != null) out.push(`Volume: ${n}`); break; }
    case 'battery_voltage': { const n = parseNumber(text, /(\d+\.\d+)/); if (n != null) out.push(`Battery: ${n.toFixed(2)} V`); break; }
    case 'id': { const n = parseNumber(text, /ID:\s*([\d.]+)/i); if (n != null) out.push(`Blade ID: ${Math.round(n).toLocaleString('en-US')} ohms`); break; }
    case 'list_presets': {
      const { presets, sdMountFailures } = parsePresets(text);
      if (sdMountFailures) out.push('No SD card mounted in the board.');
      out.push(`Presets: ${presets.length}`);
      for (const p of presets) out.push(`  ${String(p.index + 1).padStart(2)}  ${presetText(p)}`);
      break;
    }
    case 'list_named_styles': {
      const n = parseNamedStyles(text);
      if (n.names.length) out.push(`Named styles: ${n.names.join(', ')}`);
      if (n.builtinCount) out.push(`Preset styles compiled in: ${n.builtinCount}`);
      break;
    }
    case 'list_fonts': case 'list_tracks': {
      const l = parseList(text);
      if (l && l.length) { out.push(`${cmd === 'list_fonts' ? 'Fonts' : 'Tracks'} on the card: ${l.length}`); for (const x of l) out.push(`  ${x}`); }
      break;
    }
    case 'scanid': {
      const s = parseScanid(text);
      if (s.bladeConfig != null) out.push(`Blade config: ${s.bladeConfig}`);
      s.blades.forEach((b, i) => out.push(`  Blade ${i + 1}: ${b.leds} LEDs (${b.type})`));
      if (s.displayInitialized) out.push('Display: found');
      break;
    }
    default: break;
  }
  return out;
}

function transcriptText(replies, order) {
  const parts = [];
  if (replies._preamble) parts.push('===== (before the first command) =====\n' + replies._preamble);
  for (const cmd of order || Object.keys(replies)) {
    if (cmd === '_preamble') continue;
    parts.push(`===== ${cmd} =====\n${replies[cmd] || ''}`);
  }
  return parts.join('\n');
}

// ── DFU ────────────────────────────────────────────────

function _tc() { return require('./toolchain'); }

function dfuList() {
  const tc = _tc();
  const dfu = tc.getDfuUtilPath();
  tc.ensureExecutable(dfu);
  return new Promise((resolve) => {
    execFile(dfu, ['-l'], { timeout: 5000, cwd: tc.getToolsPath(), env: tc.getDfuEnv(tc.getToolsPath()) },
      (err, stdout, stderr) => resolve(((stdout || '') + (stderr || ''))));
  });
}

// One dfu-util upload (device -> file). `leave` makes the board jump back to its firmware after.
function dfuUpload({ serial, alt, address, length, outPath, leave = false, onBytes }) {
  const tc = _tc();
  const dfu = tc.getDfuUtilPath();
  tc.ensureExecutable(dfu);
  try { fs.unlinkSync(outPath); } catch {}
  const args = ['-d', '0483:df11'];
  if (serial) args.push('-S', serial);
  args.push('-a', String(alt), '-s', `${address}:${length}${leave ? ':leave' : ''}`, '-U', outPath);
  return new Promise((resolve) => {
    let out = '';
    const proc = spawn(dfu, args, { cwd: tc.getToolsPath(), env: tc.getDfuEnv(tc.getToolsPath()) });
    const take = (d) => {
      const s = d.toString();
      out += s;
      if (onBytes) {
        const all = [...s.matchAll(/(\d+)%\s+(\d+)\s+bytes/g)];
        if (all.length) { try { onBytes(Number(all[all.length - 1][2])); } catch {} }
      }
    };
    proc.stdout.on('data', take);
    proc.stderr.on('data', take);
    proc.on('error', (e) => resolve({ ok: false, error: e.message, output: out }));
    proc.on('close', (code) => {
      let size = -1;
      try { size = fs.statSync(outPath).size; } catch {}
      // A leave can end with a non-zero exit after a complete upload (the device is gone when
      // dfu-util asks for final status), so completeness is judged by the file, not the exit code.
      const complete = size === length;
      resolve({ ok: complete, exitCode: code, size, output: out,
                error: complete ? null : (out.split(/\r?\n/).filter(l => /error|cannot|fail/i.test(l)).slice(-2).join(' | ') || `read ${size} of ${length} bytes`) });
    });
  });
}

// Writes a raw image to flash at an address and stays in the bootloader. Every output line goes to
// log, so dfu-util's Download percentages reach the window.
function dfuDownload({ serial, alt, address, imagePath, log = () => {} }) {
  const tc = _tc();
  const dfu = tc.getDfuUtilPath();
  tc.ensureExecutable(dfu);
  // Both IDs, as the regular flash passes: the image's DFU suffix carries the board's runtime ID
  // (1209:6668, from tc.withDfuSuffix) and dfu-util refuses a file whose ID is not in -d.
  const args = ['-d', '1209:6668,0483:df11'];
  if (serial) args.push('-S', serial);
  args.push('-a', String(alt), '-s', String(address), '-D', imagePath);
  return new Promise((resolve) => {
    let out = '';
    // The regular flash's line handling and error classification (toolchain.js), so the log reads
    // the same.
    const emit = (line, isError) => { try { log(line, isError); } catch {} };
    // After "Download done." a "Cannot open DFU device" line is dfu-util's closing noise, not a failure
    // (the regular flash treats it the same). This write does not leave the bootloader, so the line is
    // shown as it is, without the regular flash's "left DFU mode" note.
    let downloadDone = false;
    const outEmu = tc.makeTermEmu((line) => {
      if (!line) return;
      if (tc.isDfuDownloadDone(line)) downloadDone = true;
      emit(line, false);
    });
    const errEmu = tc.makeTermEmu((line) => {
      if (!line) return;
      if (tc.isDfuDownloadDone(line)) downloadDone = true;
      const c = tc.classifyDfuStderrLine(line, downloadDone);
      const closingNoise = downloadDone && /cannot open dfu device/i.test(line);
      emit(closingNoise ? line : c.text, closingNoise ? false : c.isError);
    });
    const proc = spawn(dfu, args, { cwd: tc.getToolsPath(), env: tc.getDfuEnv(tc.getToolsPath()) });
    proc.stdout.on('data', (d) => { const s = d.toString(); out += s; outEmu.write(s); });
    proc.stderr.on('data', (d) => { const s = d.toString(); out += s; errEmu.write(s); });
    proc.on('error', (e) => resolve({ ok: false, error: e.message, output: out }));
    proc.on('close', (code) => {
      outEmu.flush(); errEmu.flush();
      const done = /Download done|File downloaded successfully/i.test(out);
      resolve({ ok: done, exitCode: code, output: out,
                error: done ? null : (out.split(/\r?\n/).filter(l => /error|cannot|fail/i.test(l)).slice(-2).join(' | ') || `dfu-util exited ${code}`) });
    });
  });
}

// Asks the bootloader to start the firmware, via a 4-byte read with :leave at the flash start.
async function leaveBootloader(serial) {
  const tmp = path.join(os.tmpdir(), `jmt-forensics-leave-${process.pid}.bin`);
  const r = await dfuUpload({ serial, alt: 0, address: '0x08000000', length: 4, outPath: tmp, leave: true });
  try { fs.unlinkSync(tmp); } catch {}
  return r;
}

// Waits for the board's serial port to come back after leaving the bootloader.
async function waitForPort(serial, timeoutMs = 20000) {
  const { SerialPort } = require('serialport');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const boards = ((await within(SerialPort.list(), 5000, [])) || []).filter(x => /^1209$/i.test(String(x.vendorId || ''))
                                                         && /^6668$/i.test(String(x.productId || '')));
      // Windows can report a composite device's port with an instance path in place of the serial,
      // so a single Proffieboard port is accepted when no port carries the serial.
      const exact = boards.find(x => String(x.serialNumber || '').toUpperCase() === String(serial).toUpperCase());
      if (exact) return exact;
      // Windows reports a composite board's port (serial + mass storage) with an instance path in
      // place of the serial. arduino-cli's list carries the board's serial, as _boardPortForSerial
      // in main.js uses it.
      if (boards.length) {
        const lp = await within(require('./portDetector').listPorts(), 8000, null);
        const hit = ((lp && lp.ports) || []).find(p => String(p.serialNumber || '').toUpperCase() === String(serial).toUpperCase());
        if (hit && hit.path) return { path: hit.path, serialNumber: String(serial).toUpperCase() };
      }
    } catch {}
    await sleep(700);
  }
  return null;
}

// ── Store ──────────────────────────────────────────────

function boardDir(userData, serial) {
  return path.join(userData, DIR_NAME, String(serial).toUpperCase());
}

function readBoard(userData, serial) {
  const f = path.join(boardDir(userData, serial), 'board.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function writeBoard(userData, serial, rec) {
  const dir = boardDir(userData, serial);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'board.json');
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, f);
}

function emptyBoard(serial) {
  return { schema: SCHEMA, serial: String(serial).toUpperCase(), firstSeen: new Date().toISOString(),
           original: null, captures: [], offerDeclined: false };
}

// What the renderer needs to decide menus and offers. "recorded" means board forensics has run on
// it; a board with only flash entries is known but not recorded.
function boardSummary(userData, serial) {
  const rec = readBoard(userData, serial);
  if (!rec) return { known: false, recorded: false, serial, hasOriginal: false, offerDeclined: false, captures: [], flashes: 0 };
  const captures = rec.captures || [];
  return { known: true, recorded: captures.length > 0, serial: rec.serial, hasOriginal: !!rec.original, original: rec.original,
           offerDeclined: !!rec.offerDeclined, captures, flashes: (rec.flashes || []).length };
}

// The build stamp ProffieOS compiles into its firmware (__DATE__ " " __TIME__), the same text the board
// reports as "installed:". Null if the image has none.
function firmwareStamp(buf) {
  if (!buf || !buf.length) return null;
  const m = /([A-Z][a-z]{2} [ \d]\d \d{4} \d\d:\d\d:\d\d)\0/.exec(buf.toString('latin1'));
  return m ? m[1] : null;
}
const sameStamp = (a, b) => !!a && !!b && String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim();

// The build stamp of the firmware on a board in bootloader mode, from one read of its flash.
// { stamp, empty } or null when the flash could not be read.
async function dfuFirmwareStamp(serial) {
  serial = String(serial || '').toUpperCase();
  const regions = parseDfuListing(await dfuList(), serial);
  const flash = regions.find(r => r.alt === 0) || { alt: 0, start: '0x08000000', size: 512 * 1024 };
  const out = path.join(os.tmpdir(), `jmt-forensics-stamp-${process.pid}.bin`);
  const r = await dfuUpload({ serial, alt: flash.alt, address: flash.start, length: flash.size, outPath: out });
  if (!r.ok) { try { fs.unlinkSync(out); } catch {} return null; }
  let buf = null;
  try { buf = fs.readFileSync(out); } catch {}
  try { fs.unlinkSync(out); } catch {}
  if (!buf) return null;
  const used = usedLength(buf);
  return { stamp: used ? firmwareStamp(buf.subarray(0, used)) : null, empty: used === 0 };
}

// Serial numbers of the Proffieboards in bootloader mode now, from dfu-util's device list.
async function dfuSerials() {
  const out = await dfuList();
  const set = new Set();
  for (const line of String(out || '').split(/\r?\n/)) {
    if (!/Found DFU:.*0483:df11/i.test(line)) continue;
    const m = /serial="([0-9A-Fa-f]{12})"/.exec(line);
    if (m) set.add(m[1].toUpperCase());
  }
  return [...set];
}

// The stamp of a build folder's firmware (build-output or a cache entry), cached by file and mtime.
let _stampCache = { file: null, mtimeMs: 0, stamp: null };
function buildStamp(dir) {
  try {
    const name = fs.readdirSync(dir).find(f => /\.dfu$/i.test(f)) || fs.readdirSync(dir).find(f => /\.bin$/i.test(f));
    if (!name) return null;
    const file = path.join(dir, name);
    const { mtimeMs } = fs.statSync(file);
    if (_stampCache.file === file && _stampCache.mtimeMs === mtimeMs) return _stampCache.stamp;
    const stamp = firmwareStamp(fs.readFileSync(file));
    _stampCache = { file, mtimeMs, stamp };
    return stamp;
  } catch { return null; }
}

// ── Event log ──────────────────────────────────────────
// Everything Studio does with a board, one JSON line each, in <userData>/board-forensics/<SN>/events.jsonl:
// flashes (failed ones too), forensics runs, restores, each time the board is seen, WebUSB checks.
// Verbose on purpose, for board history to draw on later. Kept to two files of 2 MB (events.1.jsonl
// is the older half). Never throws.
const EVENTS_MAX = 2 * 1024 * 1024;
function logEvent(userData, serial, type, data = {}) {
  try {
    if (!userData || !/^[0-9A-Fa-f]{12}$/.test(String(serial || ''))) return;
    const dir = boardDir(userData, serial);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'events.jsonl');
    try { if (fs.statSync(f).size > EVENTS_MAX) fs.renameSync(f, path.join(dir, 'events.1.jsonl')); } catch {}
    fs.appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), type, ...data }) + '\n');
  } catch {}
}

function readEvents(userData, serial) {
  const out = [];
  for (const name of ['events.1.jsonl', 'events.jsonl']) {
    try {
      for (const line of fs.readFileSync(path.join(boardDir(userData, serial), name), 'utf8').split('\n')) {
        if (line.trim()) { try { out.push(JSON.parse(line)); } catch {} }
      }
    } catch {}
  }
  return out;
}

// ── Store and flash records ────────────────────────────

function storeDir(userData) { return path.join(userData, DIR_NAME, 'store'); }

function putBlob(userData, buf) {
  const sha = sha256(buf);
  const dir = storeDir(userData);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, sha);
  if (!fs.existsSync(f)) {
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, f);
  }
  return sha;
}

// A hard link from src to dest, or a copy when the volume cannot hold one. Never overwrites.
function linkOrCopy(src, dest) {
  if (fs.existsSync(dest)) return;
  try { fs.linkSync(src, dest); } catch { fs.copyFileSync(src, dest); }
}

// A recording's file joins the store: when the store already has that content, the recording's file
// becomes a link to it (one copy on disk); otherwise the store links to the recording's file.
function adoptIntoStore(userData, file) {
  try {
    const sha = sha256(fs.readFileSync(file));
    const dir = storeDir(userData);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, sha);
    if (!fs.existsSync(target)) { linkOrCopy(file, target); return sha; }
    const a = fs.statSync(file, { bigint: true }), b = fs.statSync(target, { bigint: true });
    if (a.dev === b.dev && a.ino === b.ino) return sha;
    const tmp = file + '.link';
    try { fs.linkSync(target, tmp); fs.renameSync(tmp, file); } catch { try { fs.unlinkSync(tmp); } catch {} }
    return sha;
  } catch { return null; }
}

// The stored bytes, or null if missing or no longer matching their hash.
function getBlob(userData, sha) {
  if (!/^[0-9a-f]{64}$/.test(String(sha || ''))) return null;
  try {
    const b = fs.readFileSync(path.join(storeDir(userData), sha));
    return sha256(b) === sha ? b : null;
  } catch { return null; }
}

function recordFlash(userData, { serial, firmware, configText = null, configName = null, configPath = null,
                                 stylesText = null, fqbn = null, usb = null, proffieOSVersion = null,
                                 coreVersion = null, configHash = null, buildPkgHash = null, appVersion = null } = {}) {
  if (!serial || !Buffer.isBuffer(firmware) || !firmware.length) return null;
  serial = String(serial).toUpperCase();
  const entry = {
    id: 'flash-' + captureIdNow(), at: new Date().toISOString(),
    configName, configPath, fqbn, usb, proffieOSVersion, coreVersion, configHash, buildPkgHash, appVersion,
    firmwareSha256: putBlob(userData, firmware), firmwareBytes: firmware.length,
    configSha256: configText != null ? putBlob(userData, Buffer.from(String(configText), 'utf8')) : null,
    stylesSha256: stylesText ? putBlob(userData, Buffer.from(String(stylesText), 'utf8')) : null,
  };
  // The board's own copies, as links to the store.
  try {
    const own = path.join(boardDir(userData, serial), 'flashes', entry.id);
    fs.mkdirSync(own, { recursive: true });
    const st = storeDir(userData);
    linkOrCopy(path.join(st, entry.firmwareSha256), path.join(own, 'firmware.bin'));
    if (entry.configSha256) linkOrCopy(path.join(st, entry.configSha256), path.join(own, 'config.h'));
    if (entry.stylesSha256) linkOrCopy(path.join(st, entry.stylesSha256), path.join(own, 'my_styles.h'));
  } catch {}
  const rec = readBoard(userData, serial) || emptyBoard(serial);
  (rec.flashes || (rec.flashes = [])).push(entry);
  writeBoard(userData, serial, rec);
  return entry;
}

// A flash's firmware: the board's own link first, the store as fallback. Null if neither matches its hash.
function flashFirmware(userData, serial, entry) {
  try {
    const b = fs.readFileSync(path.join(boardDir(userData, serial), 'flashes', entry.id, 'firmware.bin'));
    if (sha256(b) === entry.firmwareSha256) return b;
  } catch {}
  return getBlob(userData, entry.firmwareSha256);
}

// What the board records window shows: the board, its original firmware as the board reported it,
// the hardware it reported, its presets, and one line per recording.
// What one forensics capture recorded: its firmware as the board reported it, the hardware and the
// presets. Null if its report cannot be read.
function captureDetail(userData, serial, id) {
  let report;
  try { report = JSON.parse(fs.readFileSync(path.join(boardDir(userData, serial), id, 'report.json'), 'utf8')); }
  catch { return null; }
  const parsed = (report.serial && report.serial.parsed) || {};
  const v = parsed.version || {};
  const fw = report.firmware || {};
  const scan = parsed.scan || {};
  return {
    generation: (report.dfu && report.dfu.generation) || null,
    firmware: {
      id, version: v.version || null, installed: v.installed || null, configFile: v.configFile || null,
      prop: v.prop || null, buttons: v.buttons != null ? v.buttons : null,
      usedBytes: fw.usedBytes != null ? fw.usedBytes : null, flashSize: fw.flashSize || null,
      rdpLevel: report.protection ? report.protection.rdpLevel : null,
      readInBootloader: !!report.readInBootloader,
      neverFlashed: !!(report.firmware && report.firmware.empty),
      // Read in bootloader mode and its firmware was started to be asked, but nothing came back.
      askFailed: !!(report.readInBootloader && !(report.serial && report.serial.ok) && report.afterwards
        && (report.afterwards.askedViaFirmware === true || report.afterwards.returnedToFirmware === false)),
    },
    blades: (scan.blades || []).map(b => ({ leds: b.leds, type: b.type })),
    display: !!scan.displayInitialized,
    presets: (parsed.presets || []).map(presetText),
  };
}

function boardRecords(userData, serial) {
  const rec = readBoard(userData, serial);
  if (!rec) return null;
  const orig = rec.original ? captureDetail(userData, serial, rec.original) : null;
  const forensics = (rec.captures || []).map(c => {
    const d = c.id === rec.original ? orig : captureDetail(userData, serial, c.id);
    let stamp = null;
    try { stamp = firmwareStamp(fs.readFileSync(path.join(boardDir(userData, serial), c.id, 'firmware.bin'))); } catch {}
    return { kind: 'forensics', id: c.id, at: c.at, version: c.version || null, firmware: !!c.firmware, stamp,
             canFlash: !!c.firmware, isOriginal: c.id === rec.original, detail: d };
  });
  const flashes = (rec.flashes || []).map(f => { const blob = flashFirmware(userData, serial, f); return {
    kind: 'flash', id: f.id, at: f.at, version: f.proffieOSVersion || null, configName: f.configName || null,
    canFlash: !!blob, stamp: firmwareStamp(blob), isOriginal: false,
    detail: { configName: f.configName || null, configPath: f.configPath || null, proffieOSVersion: f.proffieOSVersion || null,
              coreVersion: f.coreVersion || null, usb: f.usb || null, firmwareBytes: f.firmwareBytes || null,
              hasConfig: !!f.configSha256 },
  }; });
  return {
    serial: rec.serial,
    generation: (orig && orig.generation) || null,
    original: orig ? orig.firmware : null,
    blades: orig ? orig.blades : [],
    display: orig ? orig.display : false,
    presets: orig ? orig.presets : [],
    recordings: [...forensics, ...flashes].sort((a, b) => String(a.at).localeCompare(String(b.at))),
    restores: rec.restores || [],
  };
}

function setOfferDeclined(userData, serial, declined = true) {
  const rec = readBoard(userData, serial) || emptyBoard(serial);
  rec.offerDeclined = !!declined;
  rec.offerDeclinedAt = declined ? new Date().toISOString() : null;
  writeBoard(userData, serial, rec);
  return boardSummary(userData, serial);
}

const captureIdNow = () => new Date().toISOString().replace(/[:.]/g, '-');

// ── Capture ────────────────────────────────────────────

// onStage({ stage, label, fraction, detail }) drives the Board Forensics modal; log(line, isError)
// feeds its log.
// inBootloader: the board is already in bootloader mode (no serial port), so the serial questions are
// skipped and the board is left in the bootloader afterwards for the flash that follows. Version and
// build date then come from the firmware's own build stamp.
async function capture({ userData, port, serial, usb = null, appVersion = null, inBootloader = false, onStage = () => {}, log = () => {} }) {
  const tc = _tc();
  if (!tc.isBoardSerial(serial)) return { ok: false, error: 'This board did not report a serial number, so a capture cannot be kept for it.' };
  serial = String(serial).toUpperCase();
  const id = captureIdNow();
  const dir = path.join(boardDir(userData, serial), id);
  fs.mkdirSync(dir, { recursive: true });
  const report = {
    schema: SCHEMA, serial, captureId: id, capturedAt: new Date().toISOString(),
    studioVersion: appVersion, platform: process.platform, port, usb,
    serial: { ok: false, replies: {}, parsed: {} },
    dfu: null, protection: null, firmware: null, afterwards: null, errors: [], readInBootloader: !!inBootloader,
  };
  const stage = (s, label, fraction = null, detail = '') => { try { onStage({ stage: s, label, fraction, detail }); } catch {} };

  // 1. Ask the board.
  if (inBootloader) log(`Board ${serial} in bootloader mode.`, false);
  const askBoard = async (port) => {
  stage('serial', 'Asking the board what it runs', 0);
  const firstCmds = SERIAL_COMMANDS;
  const logReply = (cmd, text) => { for (const l of replyLines(cmd, text)) log(l, false); };
  log(`Board ${serial} on ${port}`, false);
  const q = await querySerial(port, firstCmds, {
    onCommand: (c) => stage('serial', 'Asking the board what it runs',
      firstCmds.indexOf(c) / (firstCmds.length + 1), c),
    onReply: logReply,
  });
  if (!q.ok) {
    report.errors.push({ stage: 'serial', error: q.error });
    log(`Could not open ${port}: ${q.error}`, true);
  } else {
    let replies = q.replies;
    let order = q.order;
    const isOn = parseNumber(replies.get_on, /^\s*(\d)/m);
    if (isOn === 1) {
      report.errors.push({ stage: 'serial', error: 'The saber was on, so the blade scan was skipped.' });
      log('The saber is on, so the blade scan (LED counts) was skipped.', false);
    } else {
      stage('serial', 'Asking the board what it runs', firstCmds.length / (firstCmds.length + 1), 'scanid');
      const s2 = await querySerial(port, ['scanid'], { quietMs: 1200, maxMs: 15000, onReply: logReply });
      if (s2.ok) { replies = { ...replies, ...s2.replies }; order = [...order, 'scanid']; }
    }
    report.serial.ok = true;
    report.serial.replies = replies;
    report.serial.order = order;
    const presets = parsePresets(replies.list_presets);
    const named = parseNamedStyles(replies.list_named_styles);
    report.serial.parsed = {
      version: parseVersionReply(replies.version),
      isOn,
      activePreset: parseNumber(replies.get_preset, /^\s*(-?\d+)/m),
      volume: parseNumber(replies.get_volume, /^\s*(\d+)/m),
      batteryVolts: parseNumber(replies.battery_voltage, /(\d+\.\d+)/),
      bladeIdOhms: parseNumber(replies.id, /ID:\s*([\d.]+)/i),
      presets: presets.presets,
      presetCount: presets.presets.length,
      sdCardMounted: presets.sdMountFailures === 0 && !!replies.list_presets,
      namedStyles: named.names,
      builtinStyleCount: named.builtinCount,
      scan: replies.scanid ? parseScanid(replies.scanid) : null,
      fonts: parseList(replies.list_fonts),
      tracks: parseList(replies.list_tracks),
      diagnosticsDisabled: isUnknownCommand(replies.help),
    };
    fs.writeFileSync(path.join(dir, 'serial.txt'), transcriptText(replies, order));
  }
  };
  if (!inBootloader) await askBoard(port);

  // 2. Into the bootloader.
  if (!inBootloader) {
  stage('bootloader', 'Switching the board to bootloader mode', null);
  const reset = await tc.touchReset(port, log);
  if (reset.ok) await sleep(1000);
  }
  const acc = await tc.waitForDfuAccessible(log);
  const inDfu = acc.openable && (!acc.serials || !acc.serials.length
    || acc.serials.some(s => s.toUpperCase() === serial));
  if (!inDfu) {
    report.errors.push({ stage: 'bootloader', error: acc.wrongDriver ? 'driver' : 'not-in-dfu' });
    report.firmware = { ok: false, error: 'The board did not enter bootloader mode, so its firmware was not copied.' };
    return _finish(userData, serial, id, dir, report, false, acc.wrongDriver ? { needsDfuDriver: true } : {});
  }

  // 3. Memory layout and read protection.
  const listing = await dfuList();
  fs.writeFileSync(path.join(dir, 'dfu-list.txt'), listing);
  const regions = parseDfuListing(listing, serial);
  const flash = regions.find(r => r.alt === 0) || { alt: 0, start: '0x08000000', size: 512 * 1024 };
  report.dfu = { regions, flashSize: flash.size, generation: generationForFlashSize(flash.size) };
  log(`Flash: ${flash.size / 1024} KB at ${flash.start}${report.dfu.generation ? ` (Proffieboard ${report.dfu.generation})` : ''}`, false);
  const obRegion = regions.find(r => /option/i.test(r.name));
  if (obRegion) {
    const obPath = path.join(dir, 'option-bytes.bin');
    const ob = await dfuUpload({ serial, alt: obRegion.alt, address: obRegion.start, length: obRegion.size, outPath: obPath });
    if (ob.ok) report.protection = parseOptionBytes(fs.readFileSync(obPath));
    if (report.protection && report.protection.rdpLevel === 0) log('Read protection: off', false);
  }
  if (report.protection && report.protection.rdpLevel > 0) {
    log('This board is read-protected. Its firmware cannot be copied.', true);
    report.firmware = { ok: false, locked: true, error: 'The board is read-protected, so its firmware cannot be copied.' };
    await leaveBootloader(serial);
    return _finish(userData, serial, id, dir, report, false);
  }

  // 4. The flash, twice.
  const reads = [];
  for (let n = 1; n <= 3; n++) {
    if (n === 3 && reads.length === 2 && reads[0].sha === reads[1].sha) break;
    const label = `Copying the firmware · read ${n} of ${n === 3 ? 3 : 2}`;
    stage('read', label, 0, '');
    const out = path.join(dir, n === 1 ? 'firmware-full.bin' : `firmware-full-read${n}.bin`);
    const r = await dfuUpload({ serial, alt: flash.alt, address: flash.start, length: flash.size, outPath: out,
      onBytes: (b) => stage('read', label, b / flash.size, `${Math.round(b / 1024)} of ${Math.round(flash.size / 1024)} KB`) });
    if (!r.ok) {
      log(`Read ${n} failed: ${r.error}`, true);
      reads.push({ n, ok: false, error: r.error });
      break;
    }
    reads.push({ n, ok: true, path: out, sha: sha256(fs.readFileSync(out)) });
    const prev = reads.length > 1 ? reads[reads.length - 2] : null;
    log(`Read ${n}: ${flash.size / 1024} KB, SHA-256 ${reads[reads.length - 1].sha.slice(0, 16)}...${prev && prev.ok && prev.sha === reads[reads.length - 1].sha ? ' (matches)' : ''}`, false);
  }
  const good = reads.filter(r => r.ok);
  const matchPair = good.length >= 2 && good.some((a, i) => good.some((b, j) => j > i && a.sha === b.sha));

  // OTP is small and kept for completeness.
  const otpRegion = regions.find(r => /otp/i.test(r.name));
  if (otpRegion) await dfuUpload({ serial, alt: otpRegion.alt, address: otpRegion.start, length: otpRegion.size, outPath: path.join(dir, 'otp.bin') });

  // 5. Back to the firmware. A board that came in bootloader mode is left there for the flash that
  // follows: an empty flash means it has never been flashed, and ProffieOS firmware is started first so
  // the board can be asked what it runs, then sent back to the bootloader the way a regular flash does.
  if (inBootloader) {
    let image = null;
    try { if (matchPair) image = fs.readFileSync(path.join(dir, 'firmware-full.bin')); } catch {}
    const usedNow = image ? usedLength(image) : null;
    // "Whut?" is ProffieOS's reply to an unknown serial command, so its firmware carries the string.
    // Anything else is not started: without a serial port it could not be sent back for the flash.
    const isProffieOS = !!image && usedNow > 0 && image.subarray(0, usedNow).includes(Buffer.from('Whut?'));
    if (usedNow === 0) {
      report.afterwards = { stayedInBootloader: true, neverFlashed: true };
      log('The flash is empty: this board has never been flashed.', false);
    } else if (isProffieOS) {
      stage('leave', "Starting the board's firmware to ask it what it runs", null);
      await leaveBootloader(serial);
      const back = await waitForPort(serial);
      if (back) {
        await sleep(800);
        await askBoard(back.path);
        stage('bootloader', 'Switching the board back to bootloader mode', null);
        const reset2 = await tc.touchReset(back.path, log);
        if (reset2.ok) await sleep(1000);
        const acc2 = await tc.waitForDfuAccessible(log);
        report.afterwards = { askedViaFirmware: true, port: back.path, returnedToBootloader: !!acc2.openable };
        if (!acc2.openable) log('The board did not go back into bootloader mode. Put it in bootloader mode again to flash it.', true);
      } else {
        report.afterwards = { askedViaFirmware: false, returnedToFirmware: false };
        log("The board's firmware did not open a serial port, so it could not be asked what it runs.", true);
      }
    } else {
      report.afterwards = { stayedInBootloader: true, notProffieOS: usedNow > 0 };
      if (usedNow > 0) log('The firmware on this board is not ProffieOS, so it was left in bootloader mode.', false);
    }
  } else {
  stage('leave', 'Returning the board to its firmware', null);
  await leaveBootloader(serial);
  const back = await waitForPort(serial);
  report.afterwards = { returnedToFirmware: !!back, port: back ? back.path : null, versionMatches: null };
  if (back) {
    await sleep(800);
    const again = await querySerial(back.path, ['version']);
    if (again.ok) {
      const after = parseVersionReply(again.replies.version);
      const before = report.serial.parsed && report.serial.parsed.version;
      report.afterwards.version = after;
      report.afterwards.versionMatches = before ? (after.version === before.version && after.installed === before.installed) : null;
    }
  } else {
    log('The board did not come back on USB yet. Unplug it and plug it back in if it stays dark.', true);
  }
  }

  // 6. Keep the image.
  if (!matchPair) {
    report.firmware = { ok: false, reads: reads.map(({ path: _p, ...r }) => r),
                        error: good.length < 2 ? 'The firmware could not be read completely.' : 'Two reads of the firmware did not match, so it was not kept as a backup.' };
    return _finish(userData, serial, id, dir, report, false);
  }
  const full = fs.readFileSync(path.join(dir, 'firmware-full.bin'));
  for (const r of good) if (r.n !== 1) { try { fs.unlinkSync(r.path); } catch {} }
  const used = usedLength(full);
  const image = full.subarray(0, used);
  fs.writeFileSync(path.join(dir, 'firmware.bin'), image);
  fs.writeFileSync(path.join(dir, 'strings.txt'), extractStrings(image).join('\n'));
  // Read in bootloader mode: no version reply, so the build date comes from the image itself.
  if (!report.serial.ok) {
    const stamp = firmwareStamp(image);
    report.serial.parsed = { version: { version: null, configFile: null, prop: null, buttons: null, installed: stamp } };
    if (stamp) log(`Firmware built ${stamp}`, false);
  }
  report.firmware = { ok: true, verified: true, reads: reads.map(({ path: _p, ...r }) => r),
                      flashSize: full.length, usedBytes: used, sha256Full: sha256(full), sha256: sha256(image),
                      address: flash.start, empty: used === 0 };
  // One copy on disk for identical firmware across recordings and boards.
  adoptIntoStore(userData, path.join(dir, 'firmware-full.bin'));
  adoptIntoStore(userData, path.join(dir, 'firmware.bin'));
  if (used === 0) log(`Flash read and verified: all ${Math.round(full.length / 1024)} KB empty. Kept as this board's never-flashed original.`, false);
  else log(`Firmware copied and verified: ${Math.round(used / 1024)} KB used of ${Math.round(full.length / 1024)} KB.`, false);
  return _finish(userData, serial, id, dir, report, true);
}

function _finish(userData, serial, id, dir, report, firmwareOk, extra = {}) {
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  const rec = readBoard(userData, serial) || emptyBoard(serial);
  const v = report.serial && report.serial.parsed && report.serial.parsed.version;
  rec.captures = rec.captures || [];
  rec.captures.push({ id, at: report.capturedAt, firmware: !!firmwareOk,
                      sha256: firmwareOk ? report.firmware.sha256 : null,
                      version: v ? v.version : null, installed: v ? v.installed : null,
                      configFile: v ? v.configFile : null });
  if (firmwareOk && !rec.original) rec.original = id;
  writeBoard(userData, serial, rec);
  return { ok: !!firmwareOk, captureId: id, dir, report, isOriginal: rec.original === id, board: boardSummary(userData, serial), ...extra,
           error: firmwareOk ? null : (report.firmware && report.firmware.error) || 'The capture did not complete.' };
}

// ── Restore ────────────────────────────────────────────

// Flashes a forensics capture (captureId, default the original) or a recorded flash (flashId) back
// onto the board, then reads the flash back to compare.
async function restore({ userData, port, serial, captureId = null, flashId = null, onStage = () => {}, log = () => {} }) {
  const tc = _tc();
  serial = String(serial || '').toUpperCase();
  const rec = readBoard(userData, serial);
  if (flashId) return _restoreFlash({ tc, userData, port, serial, rec, flashId, onStage, log });
  const id = captureId || (rec && rec.original);
  if (!id) return { ok: false, error: 'There is no saved firmware for this board.' };
  const dir = path.join(boardDir(userData, serial), id);
  let report, image;
  try {
    report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    image = fs.readFileSync(path.join(dir, 'firmware.bin'));
  } catch {
    return { ok: false, error: 'The saved firmware for this board could not be read.' };
  }
  if (!report.firmware || !report.firmware.ok || sha256(image) !== report.firmware.sha256) {
    return { ok: false, error: 'The saved firmware does not match its record, so it was not flashed.' };
  }
  const stage = (s, label, fraction = null, detail = '') => { try { onStage({ stage: s, label, fraction, detail }); } catch {} };

  stage('bootloader', 'Switching the board to bootloader mode', null);
  if (port) {
    const reset = await tc.touchReset(port, log);
    if (reset.ok) await sleep(1000);
  }
  const acc = await tc.waitForDfuAccessible(log);
  if (!acc.openable || (acc.serials && acc.serials.length && !acc.serials.some(s => s.toUpperCase() === serial))) {
    return { ok: false, error: 'The board did not enter bootloader mode. Nothing was flashed.', needsDfuDriver: !!acc.wrongDriver };
  }
  const regions = parseDfuListing(await dfuList(), serial);
  const flash = regions.find(r => r.alt === 0);
  if (flash && report.dfu && report.dfu.flashSize && flash.size !== report.dfu.flashSize) {
    await leaveBootloader(serial);
    return { ok: false, error: `This firmware was saved from a board with ${report.dfu.flashSize / 1024} KB of flash and this board has ${flash.size / 1024} KB. Nothing was flashed.` };
  }

  // The whole flash as it was read, blank tail included, so nothing a later firmware left behind
  // survives. Records without a verified full image fall back to the used part.
  let full = null;
  try {
    const f = fs.readFileSync(path.join(dir, 'firmware-full.bin'));
    if (report.firmware.sha256Full && sha256(f) === report.firmware.sha256Full) full = f;
  } catch {}
  const writeImage = full || image;
  stage('write', 'Flashing the original firmware', null);
  const binPath = path.join(os.tmpdir(), `jmt-forensics-restore-${process.pid}.dfu`);
  fs.writeFileSync(binPath, tc.withDfuSuffix(writeImage));
  const w = await dfuDownload({ serial, alt: flash ? flash.alt : 0, address: flash ? flash.start : '0x08000000', imagePath: binPath, log });
  try { fs.unlinkSync(binPath); } catch {}
  if (!w.ok) { await leaveBootloader(serial); return { ok: false, error: w.error || 'The flash did not complete.' }; }

  // Read the flash back and compare it with the original.
  let flashMatches = null;
  if (full) {
    const label = 'Reading the flash back to compare';
    stage('readback', label, 0, '');
    const rbPath = path.join(os.tmpdir(), `jmt-forensics-readback-${process.pid}.bin`);
    const rb = await dfuUpload({ serial, alt: flash ? flash.alt : 0, address: flash ? flash.start : '0x08000000',
      length: full.length, outPath: rbPath, leave: true,
      onBytes: (b) => stage('readback', label, b / full.length, `${Math.round(b / 1024)} of ${Math.round(full.length / 1024)} KB`) });
    if (rb.ok) {
      const sha = sha256(fs.readFileSync(rbPath));
      flashMatches = sha === report.firmware.sha256Full;
      log(`Read back: ${full.length / 1024} KB, SHA-256 ${sha.slice(0, 16)}...${flashMatches ? ' (matches the original)' : ' (does not match the original)'}`, !flashMatches);
    } else {
      log(`Read back failed: ${rb.error}`, true);
      await leaveBootloader(serial);
    }
    try { fs.unlinkSync(rbPath); } catch {}
  } else {
    await leaveBootloader(serial);
  }

  stage('verify', 'Waiting for the board to restart', null);
  const back = await waitForPort(serial);
  let versionMatches = null, after = null;
  if (back) {
    stage('verify', 'Checking the version', null);
    await sleep(800);
    const q = await querySerial(back.path, ['version']);
    if (q.ok) {
      after = parseVersionReply(q.replies.version);
      const before = report.serial && report.serial.parsed && report.serial.parsed.version;
      versionMatches = before && before.version ? (after.version === before.version && after.installed === before.installed) : null;
    }
  }
  const restoreRec = { at: new Date().toISOString(), captureId: id, versionMatches, flashMatches, wholeFlash: !!full };
  const b = readBoard(userData, serial);
  if (b) { (b.restores || (b.restores = [])).push(restoreRec); writeBoard(userData, serial, b); }
  return { ok: true, captureId: id, port: back ? back.path : null, version: after, versionMatches, flashMatches };
}

async function _restoreFlash({ tc, userData, port, serial, rec, flashId, onStage, log }) {
  const entry = rec && (rec.flashes || []).find(f => f.id === flashId);
  if (!entry) return { ok: false, error: 'That flash is not in this board\'s record.' };
  const image = flashFirmware(userData, serial, entry);
  if (!image) return { ok: false, error: 'The saved firmware for that flash could not be read, so nothing was flashed.' };
  const stage = (s, label, fraction = null, detail = '') => { try { onStage({ stage: s, label, fraction, detail }); } catch {} };

  stage('bootloader', 'Switching the board to bootloader mode', null);
  if (port) {
    const reset = await tc.touchReset(port, log);
    if (reset.ok) await sleep(1000);
  }
  const acc = await tc.waitForDfuAccessible(log);
  if (!acc.openable || (acc.serials && acc.serials.length && !acc.serials.some(s => s.toUpperCase() === serial))) {
    return { ok: false, error: 'The board did not enter bootloader mode. Nothing was flashed.', needsDfuDriver: !!acc.wrongDriver };
  }
  const flash = parseDfuListing(await dfuList(), serial).find(r => r.alt === 0);
  const alt = flash ? flash.alt : 0, address = flash ? flash.start : '0x08000000';

  stage('write', 'Flashing the saved firmware', null);
  const binPath = path.join(os.tmpdir(), `jmt-forensics-restore-${process.pid}.dfu`);
  fs.writeFileSync(binPath, tc.withDfuSuffix(image));
  const w = await dfuDownload({ serial, alt, address, imagePath: binPath, log });
  try { fs.unlinkSync(binPath); } catch {}
  if (!w.ok) { await leaveBootloader(serial); return { ok: false, error: w.error || 'The flash did not complete.' }; }

  const label = 'Reading the flash back to compare';
  stage('readback', label, 0, '');
  const rbPath = path.join(os.tmpdir(), `jmt-forensics-readback-${process.pid}.bin`);
  let flashMatches = null;
  const rb = await dfuUpload({ serial, alt, address, length: image.length, outPath: rbPath, leave: true,
    onBytes: (b) => stage('readback', label, b / image.length, `${Math.round(b / 1024)} of ${Math.round(image.length / 1024)} KB`) });
  if (rb.ok) {
    const sha = sha256(fs.readFileSync(rbPath));
    flashMatches = sha === entry.firmwareSha256;
    log(`Read back: ${Math.round(image.length / 1024)} KB, SHA-256 ${sha.slice(0, 16)}...${flashMatches ? ' (matches the saved firmware)' : ' (does not match the saved firmware)'}`, !flashMatches);
  } else {
    log(`Read back failed: ${rb.error}`, true);
    await leaveBootloader(serial);
  }
  try { fs.unlinkSync(rbPath); } catch {}

  stage('verify', 'Waiting for the board to restart', null);
  const back = await waitForPort(serial);
  let after = null;
  if (back) {
    stage('verify', 'Checking the version', null);
    await sleep(800);
    const q = await querySerial(back.path, ['version']);
    if (q.ok) after = parseVersionReply(q.replies.version);
  }
  const b = readBoard(userData, serial);
  if (b) { (b.restores || (b.restores = [])).push({ at: new Date().toISOString(), flashId, flashMatches, versionReply: after }); writeBoard(userData, serial, b); }
  return { ok: true, flashId, port: back ? back.path : null, version: after, versionMatches: null, flashMatches };
}

module.exports = {
  SERIAL_COMMANDS,
  parseVersionReply, parsePresets, parseScanid, parseNamedStyles, parseList, parseNumber,
  parseDfuListing, parseOptionBytes, usedLength, extractStrings, generationForFlashSize,
  isUnknownCommand, transcriptText, replyLines,
  querySerial, capture, restore,
  boardDir, readBoard, boardSummary, boardRecords, setOfferDeclined, presetText,
  recordFlash, putBlob, getBlob, flashFirmware, adoptIntoStore, firmwareStamp, sameStamp, buildStamp, logEvent, readEvents, dfuSerials, dfuFirmwareStamp,
};
