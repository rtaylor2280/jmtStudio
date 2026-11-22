// The Win32 half of winSystem.js: registry, device, process-list and process-kill calls made
// in-process through koffi. [B-681]
//
// NO CHILD PROCESSES. Behaviour-based antivirus kills an Electron app that keeps starting
// reg.exe, tasklist, taskkill and PowerShell (QA BUG-012), so each of those is a direct Win32
// call here:
//   regValue      RegGetValueW on HKEY_LOCAL_MACHINE, read-only            (was reg query)
//   pnpServices   SetupAPI over every present device, instance ID + service (was Get-PnpDevice)
//   processList   CreateToolhelp32Snapshot + Process32FirstW / NextW       (was tasklist)
//   killTree      the same snapshot's parent links, then TerminateProcess   (was taskkill /T /F)
//
// RUNS ON A WORKER THREAD, NEVER ON THE MAIN ONE. winSystem.js starts this file through
// winNativeRun.js, one worker per call, with the time limit the launched program had.
//
// The pure helpers at the top (registry key and value decoding, process-entry parsing, the kill
// order) take no koffi and run anywhere, which is what lets them be unit-tested without hardware.
// koffi is required lazily inside bind(), so loading this file on macOS or Linux loads nothing.

'use strict';

// ── Pure helpers ────────────────────────────────────────────────────────────

// A NUL-terminated UTF-16LE string out of a buffer, read no further than `limit` bytes.
function utf16z(buf, offset = 0, limit = buf.length) {
  let end = offset;
  while (end + 1 < limit && (buf[end] | buf[end + 1])) end += 2;
  return buf.toString('utf16le', offset, end);
}

// A registry path as reg.exe took it ("HKLM\SYSTEM\..."), split into root and subkey. Only the
// local machine hive is read, so any other root is null (reg.exe would have read it, but no
// caller asks for one).
function splitRegKey(key) {
  const m = /^(HKLM|HKEY_LOCAL_MACHINE)\\(.+)$/i.exec(String(key || ''));
  return m ? { root: 'HKLM', subKey: m[2] } : null;
}

// Registry value types, named as reg.exe prints them.
const REG_TYPES = {
  0: 'REG_NONE', 1: 'REG_SZ', 2: 'REG_EXPAND_SZ', 3: 'REG_BINARY', 4: 'REG_DWORD',
  5: 'REG_DWORD_BIG_ENDIAN', 6: 'REG_LINK', 7: 'REG_MULTI_SZ', 11: 'REG_QWORD',
};

// One value's raw bytes into { type, data }:
//   REG_SZ, REG_EXPAND_SZ   the string (unexpanded, as reg.exe showed it)
//   REG_MULTI_SZ            an array of the strings, without the empty terminator
//   REG_DWORD, REG_QWORD    a number
//   anything else           the bytes, as a Buffer
function decodeRegValue(type, buf, size) {
  const name = REG_TYPES[type] || `REG_${type}`;
  const n = Math.min(size >>> 0, buf.length);
  switch (type) {
    case 1: case 2:
      return { type: name, data: utf16z(buf, 0, n) };
    case 7: {
      const all = buf.toString('utf16le', 0, n - (n % 2));
      const parts = all.split('\0');
      while (parts.length && parts[parts.length - 1] === '') parts.pop();
      return { type: name, data: parts };
    }
    case 4: return { type: name, data: n >= 4 ? buf.readUInt32LE(0) : 0 };
    case 11: return { type: name, data: n >= 8 ? Number(buf.readBigUInt64LE(0)) : 0 };
    default: return { type: name, data: Buffer.from(buf.subarray(0, n)) };
  }
}

// The text a value's data reads as, for a caller that searched reg.exe's printed line: strings
// as they are, the strings of a REG_MULTI_SZ joined as reg.exe joined them ("\0"), and '' for any
// other type (reg.exe printed those as hex or a number, which holds no text a caller looks for).
function regValueText(v) {
  if (!v) return '';
  if (typeof v.data === 'string') return v.data;
  if (Array.isArray(v.data)) return v.data.join('\\0');
  return '';
}

// One argument as Windows' command-line parser (CommandLineToArgvW and the C runtime) reads it
// back unchanged: quoted when it holds a space, tab or quote or is empty, with the backslashes
// before a quote, or before the closing quote, doubled.
function quoteArg(a) {
  a = String(a);
  if (a !== '' && !/[\s"]/.test(a)) return a;
  let out = '"', slashes = 0;
  for (const c of a) {
    if (c === '\\') { slashes++; continue; }
    if (c === '"') { out += '\\'.repeat(slashes * 2 + 1) + '"'; slashes = 0; continue; }
    out += '\\'.repeat(slashes) + c; slashes = 0;
  }
  return out + '\\'.repeat(slashes * 2) + '"';
}

// PROCESSENTRY32W, as Process32FirstW / NextW fill it. 64-bit layout (568 bytes):
//   0 dwSize, 8 th32ProcessID, 16 th32DefaultHeapID (pointer), 24 th32ModuleID, 28 cntThreads,
//   32 th32ParentProcessID, 36 pcPriClassBase, 40 dwFlags, 44 szExeFile[260]
// 32-bit (556 bytes): the heap ID is 4 bytes, so everything after it sits 4 earlier.
function processEntryLayout(ptrSize) {
  return ptrSize === 8
    ? { size: 568, pid: 8, ppid: 32, exe: 44 }
    : { size: 556, pid: 8, ppid: 24, exe: 36 };
}
function parseProcessEntry(buf, layout) {
  return {
    pid: buf.readUInt32LE(layout.pid),
    ppid: buf.readUInt32LE(layout.ppid),
    exe: utf16z(buf, layout.exe, Math.min(buf.length, layout.exe + 520)),
  };
}

// Is an Arduino process running? The rule tasklist's output was read with: any process whose
// image name, lower-cased, contains "arduino". tasklist's other columns (PID, session name and
// number, memory) are numbers and session names such as "Console" or "Services", so the image
// name was the only column that could match. Studio's own arduino-cli.exe matches, as it did.
function anyArduino(procs) {
  return (procs || []).some((p) => String(p && p.exe || '').toLowerCase().includes('arduino'));
}

// The processes to stop for a tree rooted at `root`, descendants first and the root last (a
// post-order walk of the parent links). A child counts only when it was created no earlier than
// its parent, when both creation times are known: a parent ID on Windows can belong to a process
// that has since exited and had its ID reused, and such a stranger is not part of the tree.
// `created` maps pid -> creation time (any comparable number); a missing entry is unknown.
// The root is included whether or not it is in `procs`, so a vanished root is still attempted.
function treeOrder(procs, root, created = new Map()) {
  const kids = new Map();
  for (const p of procs || []) {
    if (p.pid === p.ppid || p.pid === 0) continue;
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p.pid);
  }
  const born = (pid) => (created.has(pid) ? created.get(pid) : null);
  const out = [];
  const seen = new Set();
  const walk = (pid) => {
    seen.add(pid);
    for (const c of kids.get(pid) || []) {
      if (seen.has(c)) continue;
      const bp = born(pid), bc = born(c);
      if (bp !== null && bc !== null && bc < bp) continue;
      walk(c);
    }
    out.push(pid);
  };
  walk(root);
  return out;
}

// Instance IDs matched as Get-PnpDevice's "-match" matched them: a case-insensitive regular
// expression, anywhere in the ID.
function instanceMatcher(pattern) {
  const re = new RegExp(pattern, 'i');
  return (id) => re.test(String(id || ''));
}

// ── Win32 bindings, bound once per worker ────────────────────────────────────

// HKEY_LOCAL_MACHINE is ((HKEY)(ULONG_PTR)(LONG)0x80000002): sign-extended on 64-bit Windows,
// so it is passed as a signed pointer-sized integer.
const HKEY_LOCAL_MACHINE = -2147483646;
const RRF_RT_ANY = 0x0000FFFF;
const RRF_NOEXPAND = 0x10000000;
const ERROR_SUCCESS = 0;
const ERROR_MORE_DATA = 234;
const DIGCF_PRESENT = 0x02;
const DIGCF_ALLCLASSES = 0x04;
const SPDRP_SERVICE = 0x04;
const TH32CS_SNAPPROCESS = 0x02;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
// taskkill /F exited its processes with exit code 1.
const KILL_EXIT_CODE = 1;

let W = null;
function bind() {
  if (W) return W;
  const koffi = require('koffi');
  const k32 = koffi.load('kernel32.dll');
  const adv = koffi.load('advapi32.dll');
  const sapi = koffi.load('setupapi.dll');
  W = {
    koffi, ptr: koffi.sizeof('void *'),
    RegGetValueW: adv.func('int32 __stdcall RegGetValueW(intptr_t hkey, str16 subKey, str16 value, uint32 flags, _Out_ uint32 *type, void *data, _Inout_ uint32 *size)'),
    SetupDiGetClassDevsW: sapi.func('void * __stdcall SetupDiGetClassDevsW(void *guid, str16 enumerator, void *hwnd, uint32 flags)'),
    SetupDiEnumDeviceInfo: sapi.func('bool __stdcall SetupDiEnumDeviceInfo(void *set, uint32 idx, void *info)'),
    SetupDiGetDeviceInstanceIdW: sapi.func('bool __stdcall SetupDiGetDeviceInstanceIdW(void *set, void *info, void *buf, uint32 size, _Out_ uint32 *required)'),
    SetupDiGetDeviceRegistryPropertyW: sapi.func('bool __stdcall SetupDiGetDeviceRegistryPropertyW(void *set, void *info, uint32 prop, _Out_ uint32 *type, void *buf, uint32 size, _Out_ uint32 *required)'),
    SetupDiDestroyDeviceInfoList: sapi.func('bool __stdcall SetupDiDestroyDeviceInfoList(void *set)'),
    CreateToolhelp32Snapshot: k32.func('void * __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)'),
    Process32FirstW: k32.func('bool __stdcall Process32FirstW(void *snap, void *entry)'),
    Process32NextW: k32.func('bool __stdcall Process32NextW(void *snap, void *entry)'),
    OpenProcess: k32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
    GetProcessTimes: k32.func('bool __stdcall GetProcessTimes(void *h, void *created, void *exited, void *kernel, void *user)'),
    TerminateProcess: k32.func('bool __stdcall TerminateProcess(void *h, uint32 code)'),
    CloseHandle: k32.func('bool __stdcall CloseHandle(void *h)'),
    GetLastError: k32.func('uint32 __stdcall GetLastError()'),
  };
  // SHELLEXECUTEINFOW, for starting the driver helper with the administrator prompt.
  W.SEI = koffi.struct('SHELLEXECUTEINFOW', {
    cbSize: 'uint32', fMask: 'uint32', hwnd: 'void *', lpVerb: 'str16', lpFile: 'str16',
    lpParameters: 'str16', lpDirectory: 'str16', nShow: 'int32', hInstApp: 'void *',
    lpIDList: 'void *', lpClass: 'str16', hkeyClass: 'void *', dwHotKey: 'uint32',
    hIconOrMonitor: 'void *', hProcess: 'void *',
  });
  W.ShellExecuteExW = koffi.load('shell32.dll').func('bool __stdcall ShellExecuteExW(_Inout_ SHELLEXECUTEINFOW *info)');
  return W;
}

function invalid(h) {
  if (h === null || h === undefined) return true;
  const a = W.koffi.address(h);
  return a === 0n || a === 0xFFFFFFFFFFFFFFFFn || a === 0xFFFFFFFFn;
}

// ── The operations the worker runs ──────────────────────────────────────────

// One registry value: { type, data } (decodeRegValue), or null when the key or the value is
// absent or cannot be read. A plain read; needs no admin.
function opRegValue(key, value) {
  bind();
  const k = splitRegKey(key);
  if (!k) return null;
  const type = [0];
  let size = [0];
  let rc = W.RegGetValueW(HKEY_LOCAL_MACHINE, k.subKey, String(value), RRF_RT_ANY | RRF_NOEXPAND, type, null, size);
  if (rc !== ERROR_SUCCESS) return null;
  // A value can grow between the size query and the read; ask again while it does.
  for (let tries = 0; tries < 4; tries++) {
    const buf = Buffer.alloc(Math.max(size[0], 2) + 2);
    size = [buf.length];
    rc = W.RegGetValueW(HKEY_LOCAL_MACHINE, k.subKey, String(value), RRF_RT_ANY | RRF_NOEXPAND, type, buf, size);
    if (rc === ERROR_SUCCESS) return decodeRegValue(type[0], buf, size[0]);
    if (rc !== ERROR_MORE_DATA) return null;
  }
  return null;
}

// Every PRESENT device whose instance ID matches `pattern` (instanceMatcher), in SetupAPI's
// enumeration order: [{ id, service }], service '' when the device has none.
// SPDRP_SERVICE is the property DEVPKEY_Device_Service names.
function opPnpServices(pattern) {
  bind();
  const match = instanceMatcher(pattern);
  const set = W.SetupDiGetClassDevsW(null, null, null, DIGCF_ALLCLASSES | DIGCF_PRESENT);
  if (invalid(set)) return [];
  const out = [];
  try {
    const infoSize = W.ptr === 8 ? 32 : 28;   // SP_DEVINFO_DATA
    for (let i = 0; i < 100000; i++) {
      const info = Buffer.alloc(infoSize);
      info.writeUInt32LE(infoSize, 0);
      if (!W.SetupDiEnumDeviceInfo(set, i, info)) break;
      const idBuf = Buffer.alloc(2048);
      if (!W.SetupDiGetDeviceInstanceIdW(set, info, idBuf, 1024, [0])) continue;
      const id = utf16z(idBuf);
      if (!match(id)) continue;
      const svc = Buffer.alloc(1024);
      const service = W.SetupDiGetDeviceRegistryPropertyW(set, info, SPDRP_SERVICE, [0], svc, svc.length, [0])
        ? utf16z(svc) : '';
      out.push({ id, service });
    }
  } finally { W.SetupDiDestroyDeviceInfoList(set); }
  return out;
}

// Every running process: [{ pid, ppid, exe }], or null when the list cannot be taken.
function opProcessList() {
  bind();
  const snap = W.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (invalid(snap)) return null;
  try {
    const layout = processEntryLayout(W.ptr);
    const entry = Buffer.alloc(layout.size);
    entry.writeUInt32LE(layout.size, 0);
    const out = [];
    if (!W.Process32FirstW(snap, entry)) return out;
    do { out.push(parseProcessEntry(entry, layout)); } while (W.Process32NextW(snap, entry));
    return out;
  } finally { W.CloseHandle(snap); }
}

// Creation time of a process, as a 100 ns FILETIME count, or null when it cannot be opened.
function createdAt(h) {
  const c = Buffer.alloc(8), x = Buffer.alloc(8), k = Buffer.alloc(8), u = Buffer.alloc(8);
  return W.GetProcessTimes(h, c, x, k, u) ? Number(c.readBigUInt64LE(0) / 10000n) : null;
}

// Stop `root` and every process under it, descendants first, then the root: what taskkill
// /pid <root> /T /F did. Two passes: the second catches a child a dying parent started while the
// first pass ran (a compiler driver mid-spawn). Resolves { killed: [pid], failed: [pid] }.
function opKillTree(root) {
  bind();
  root = Number(root) >>> 0;
  const handles = new Map();     // pid -> handle opened for terminate + times
  const created = new Map();
  const open = (pid) => {
    if (handles.has(pid)) return handles.get(pid);
    const h = W.OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    const ok = invalid(h) ? null : h;
    handles.set(pid, ok);
    if (ok) { const t = createdAt(ok); if (t !== null) created.set(pid, t); }
    return ok;
  };
  const killed = [], failed = [];
  const done = new Set();
  const stop = (pid) => {
    if (done.has(pid)) return;
    done.add(pid);
    const h = open(pid);
    if (h && W.TerminateProcess(h, KILL_EXIT_CODE)) killed.push(pid); else failed.push(pid);
  };
  try {
    for (let pass = 0; pass < 2; pass++) {
      const procs = opProcessList() || [];
      // Times are read for the root and its candidate children before any is stopped, so the
      // reused-ID check compares live processes.
      const under = new Set(treeOrder(procs, root, created));
      for (const p of procs) if (under.has(p.ppid) || p.pid === root) open(p.pid);
      const checked = treeOrder(procs, root, created);
      const fresh = checked.filter((pid) => !done.has(pid));
      if (pass > 0 && fresh.length === 0) break;
      for (const pid of fresh) stop(pid);
    }
  } finally {
    for (const h of handles.values()) if (h) W.CloseHandle(h);
  }
  return { killed, failed };
}

// Start `exe` with `args` through the Windows administrator prompt (the "runas" verb), as the
// signed driver helper is started. Returns once the helper is running: { ok: true }, or
// { ok: false, error } with the Windows error code, 1223 when the prompt was declined. The helper
// reports its own outcome in its result file, which the caller reads.
const SEE_MASK_NOCLOSEPROCESS = 0x40, SEE_MASK_NOASYNC = 0x100, SEE_MASK_FLAG_NO_UI = 0x400;
const SW_HIDE = 0;
function opRunElevated(exe, args) {
  bind();
  const info = {
    cbSize: W.koffi.sizeof(W.SEI),
    fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
    hwnd: null, lpVerb: 'runas', lpFile: String(exe),
    lpParameters: (args || []).map(quoteArg).join(' '), lpDirectory: null, nShow: SW_HIDE,
    hInstApp: null, lpIDList: null, lpClass: null, hkeyClass: null, dwHotKey: 0,
    hIconOrMonitor: null, hProcess: null,
  };
  const ok = W.ShellExecuteExW(info);
  const error = ok ? 0 : W.GetLastError();
  if (info.hProcess && !invalid(info.hProcess)) W.CloseHandle(info.hProcess);
  return ok ? { ok: true } : { ok: false, error };
}

const OPS = { regValue: opRegValue, pnpServices: opPnpServices, processList: opProcessList,
              killTree: opKillTree, runElevated: opRunElevated };

// ── Worker entry ────────────────────────────────────────────────────────────
// Runs only inside a worker winNativeRun.js started for this file.
require('./winNativeRun').serveNative('winSystemNative.js', OPS);

module.exports = {
  OPS, REG_TYPES,
  utf16z, splitRegKey, decodeRegValue, regValueText, quoteArg, processEntryLayout, parseProcessEntry,
  anyArduino, treeOrder, instanceMatcher,
};
