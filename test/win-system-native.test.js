// The native Windows registry, device, process and archive layer, checked without hardware. [B-681]
//
// winSystem.js answers the WebUSB registry check, the DFU driver-service lookup, the Arduino
// process check, the process-tree kill and the Get ProffieOS unpack without launching reg.exe,
// PowerShell, tasklist or taskkill. The Win32 calls themselves need a real machine (the live
// old-versus-new comparison is run by hand on one); everything that turns their raw answers into
// what the callers read is pure, and is pinned here:
//   - registry key splitting, value decoding, and the two WebUSB decisions made from the values,
//     each against the reg.exe text the old regexes read
//   - the PROCESSENTRY32W layout and parsing, the "arduino" rule, the kill order and its
//     reused-PID guard
//   - the instance-ID matcher (Get-PnpDevice's case-insensitive -match)
//   - the zip-slip guard, and the unpack end to end on archives built here
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const N = require('../winSystemNative');
const S = require('../winSystem');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`); fail++; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const u16 = (s) => Buffer.from(s + '\0', 'utf16le');

// ── koffi stays unloaded until a native call is made ────────────────────────
ok('requiring winSystem and winSystemNative does not load koffi',
   !Object.keys(require.cache).some((k) => /[\\/]node_modules[\\/]koffi[\\/]/.test(k)),
   'a macOS or Linux build must never load Windows DLLs');

// ── registry keys and values ────────────────────────────────────────────────
{
  ok('HKLM\\ path splits', same(N.splitRegKey('HKLM\\SYSTEM\\X'), { root: 'HKLM', subKey: 'SYSTEM\\X' }));
  ok('HKEY_LOCAL_MACHINE\\ path splits', same(N.splitRegKey('HKEY_LOCAL_MACHINE\\A'), { root: 'HKLM', subKey: 'A' }));
  ok('another hive is not read', N.splitRegKey('HKCU\\Software') === null);
  ok('a bare hive is not read', N.splitRegKey('HKLM') === null && N.splitRegKey('') === null);

  const sz = u16('6&324d6679&0');
  ok('REG_SZ decodes to its string', same(N.decodeRegValue(1, sz, sz.length), { type: 'REG_SZ', data: '6&324d6679&0' }));
  const ex = u16('%SystemRoot%\\x');
  ok('REG_EXPAND_SZ stays unexpanded, as reg.exe showed it',
     same(N.decodeRegValue(2, ex, ex.length), { type: 'REG_EXPAND_SZ', data: '%SystemRoot%\\x' }));
  const multi = Buffer.from('{975F44D9-0D08-43FD-8B3E-127CA8AFFF9D}\0second\0\0', 'utf16le');
  ok('REG_MULTI_SZ decodes to its strings, without the terminator',
     same(N.decodeRegValue(7, multi, multi.length).data, ['{975F44D9-0D08-43FD-8B3E-127CA8AFFF9D}', 'second']));
  const emptyMulti = Buffer.from('\0\0', 'utf16le');
  ok('an empty REG_MULTI_SZ is an empty list', same(N.decodeRegValue(7, emptyMulti, emptyMulti.length).data, []));
  const dw = Buffer.alloc(4); dw.writeUInt32LE(0x84, 0);
  ok('REG_DWORD decodes to a number', same(N.decodeRegValue(4, dw, 4), { type: 'REG_DWORD', data: 0x84 }));
  const bin = Buffer.from([1, 2, 0xAB]);
  const b = N.decodeRegValue(3, Buffer.concat([bin, Buffer.alloc(5)]), 3);
  ok('REG_BINARY stays bytes, cut to the reported size', b.type === 'REG_BINARY' && Buffer.compare(b.data, bin) === 0);
  ok('the size the call reported bounds the string',
     N.decodeRegValue(1, Buffer.from('abcdef\0', 'utf16le'), 6).data === 'abc');

  ok('regValueText: a string as it is', N.regValueText({ type: 'REG_SZ', data: 'x y' }) === 'x y');
  ok('regValueText: a multi-string joined as reg.exe printed it',
     N.regValueText({ type: 'REG_MULTI_SZ', data: ['a', 'b'] }) === 'a\\0b');
  ok('regValueText: a number or bytes hold no text', N.regValueText({ type: 'REG_DWORD', data: 5 }) === ''
     && N.regValueText({ type: 'REG_BINARY', data: Buffer.from('{x}') }) === '' && N.regValueText(null) === '');
}

// ── the two WebUSB decisions, against the reg.exe text the old regexes read ─
// reg.exe printed "<key>\r\n    <name>    <TYPE>    <data>\r\n\r\n". Each case is rendered that way
// and read with the old regex, and the native value is read with the new helper: they must agree.
{
  const KEY = 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_1209&PID_6668&MI_02\\6&324d6679&0&0002\\Device Parameters';
  const regText = (name, v) => {
    if (!v) return null;
    const d = typeof v.data === 'string' ? v.data : Array.isArray(v.data) ? v.data.join('\\0')
      : typeof v.data === 'number' ? '0x' + v.data.toString(16) : Buffer.from(v.data).toString('hex').toUpperCase();
    return `\r\n${KEY}\r\n    ${name}    ${v.type}    ${d}\r\n\r\n`;
  };
  const prefixCases = [
    null,
    { type: 'REG_SZ', data: '6&324d6679&0' },
    { type: 'REG_SZ', data: '' },
    { type: 'REG_SZ', data: '7&abc&0 trailing words' },
    { type: 'REG_EXPAND_SZ', data: '6&324d6679&0' },
    { type: 'REG_DWORD', data: 1 },
  ];
  for (const v of prefixCases) {
    const t = regText('ParentIdPrefix', v);
    const m = t && t.match(/ParentIdPrefix\s+REG_SZ\s+(\S+)/i);
    ok(`ParentIdPrefix ${JSON.stringify(v)}: same prefix as the reg.exe regex`,
       (m ? m[1] : null) === S.webUsbParentPrefix(v), `old ${m && m[1]} new ${S.webUsbParentPrefix(v)}`);
  }
  const guidCases = [
    null,
    { type: 'REG_MULTI_SZ', data: ['{975F44D9-0D08-43FD-8B3E-127CA8AFFF9D}'] },
    { type: 'REG_MULTI_SZ', data: [] },
    { type: 'REG_MULTI_SZ', data: ['not a guid', '{975F44D9-0D08-43FD-8B3E-127CA8AFFF9D}'] },
    { type: 'REG_SZ', data: '{975F44D9-0D08-43FD-8B3E-127CA8AFFF9D}' },
    { type: 'REG_SZ', data: '{too-short}' },
    { type: 'REG_BINARY', data: Buffer.from('7B') },
  ];
  for (const v of guidCases) {
    const t = regText('DeviceInterfaceGUIDs', v);
    const old = !!(t && /\{[0-9A-Fa-f-]{36}\}/.test(t));
    ok(`DeviceInterfaceGUIDs ${JSON.stringify(v)}: same verdict as the reg.exe regex`, old === S.webUsbHasGuid(v));
  }
  const TC = fs.readFileSync(path.join(ROOT, 'toolchain.js'), 'utf8');
  const body = TC.slice(TC.indexOf('function checkWebUsbWindows'), TC.indexOf('function fixWebUsbWindows'));
  ok('checkWebUsbWindows reads values through the two helpers',
     /webUsbParentPrefix\(await reg\(/.test(body) && /webUsbHasGuid\(params\)/.test(body) && !/REG_SZ\\s\+/.test(body));
  ok('checkWebUsbWindows keeps its three answers',
     ['board not in the registry', 'guid present', 'WebUSB interface has no GUID'].every((s) => body.includes(s)));
}

// ── processes ───────────────────────────────────────────────────────────────
{
  ok('PROCESSENTRY32W is 568 bytes on 64-bit, 556 on 32-bit',
     N.processEntryLayout(8).size === 568 && N.processEntryLayout(4).size === 556);
  for (const ptr of [8, 4]) {
    const L = N.processEntryLayout(ptr);
    const buf = Buffer.alloc(L.size);
    buf.writeUInt32LE(L.size, 0);
    buf.writeUInt32LE(4242, L.pid);
    buf.writeUInt32LE(17, L.ppid);
    Buffer.from('arduino-cli.exe\0', 'utf16le').copy(buf, L.exe);
    ok(`a ${ptr * 8}-bit entry parses`, same(N.parseProcessEntry(buf, L), { pid: 4242, ppid: 17, exe: 'arduino-cli.exe' }));
    const full = Buffer.alloc(L.size);
    full.fill(0x41, L.exe);   // 'A' bytes with no terminator anywhere
    ok(`a ${ptr * 8}-bit name never reads past szExeFile`, N.parseProcessEntry(full, L).exe.length <= 260);
  }

  ok('Studio\'s own arduino-cli.exe counts', N.anyArduino([{ exe: 'arduino-cli.exe' }]));
  ok('the IDE counts, any case', N.anyArduino([{ exe: 'Arduino IDE.exe' }]) && N.anyArduino([{ exe: 'ARDUINO.EXE' }]));
  ok('other processes do not', !N.anyArduino([{ exe: 'node.exe' }, { exe: 'System' }, { exe: '' }]));
  ok('no list is not running', !N.anyArduino(null) && !N.anyArduino([]));

  // root 10 -> 11, 12; 11 -> 13; 12 -> 14 -> 15. 99 is unrelated.
  const procs = [10, 11, 12, 13, 14, 15, 99].map((pid) => ({ pid, ppid: { 10: 1, 11: 10, 12: 10, 13: 11, 14: 12, 15: 14, 99: 1 }[pid] }));
  const order = N.treeOrder(procs, 10);
  ok('the whole tree, nothing else', same([...order].sort((a, b) => a - b), [10, 11, 12, 13, 14, 15]), JSON.stringify(order));
  ok('the root is last', order[order.length - 1] === 10);
  ok('every child before its parent', procs.filter((p) => order.includes(p.pid) && p.pid !== 10)
     .every((p) => order.indexOf(p.pid) < order.indexOf(p.ppid)), JSON.stringify(order));
  const reused = new Map([[10, 1000], [11, 2000], [12, 500], [14, 600], [15, 700]]);
  const guarded = N.treeOrder(procs, 10, reused);
  ok('a "child" created before its parent is a reused ID, and is left alone with its subtree',
     !guarded.includes(12) && !guarded.includes(14) && !guarded.includes(15) && guarded.includes(11), JSON.stringify(guarded));
  ok('unknown creation times keep the child', N.treeOrder(procs, 10, new Map([[10, 1000]])).length === 6);
  ok('a root that has exited is still attempted, and its orphans found',
     same(N.treeOrder(procs.filter((p) => p.pid !== 10), 10).slice(-1), [10]) && N.treeOrder(procs.filter((p) => p.pid !== 10), 10).length === 6);
  const loop = [{ pid: 20, ppid: 21 }, { pid: 21, ppid: 20 }, { pid: 0, ppid: 0 }];
  ok('a parent loop (reused IDs) ends', same(N.treeOrder(loop, 20), [21, 20]));
  ok('the idle process (0, its own parent) is never a child', !N.treeOrder([{ pid: 0, ppid: 0 }], 0).slice(0, -1).length);

  const NS = fs.readFileSync(path.join(ROOT, 'winSystemNative.js'), 'utf8');
  const kill = NS.slice(NS.indexOf('function opKillTree'), NS.indexOf('const OPS ='));
  ok('the kill opens with terminate rights only (plus reading the creation time)',
     /PROCESS_TERMINATE \| PROCESS_QUERY_LIMITED_INFORMATION/.test(kill) && /TerminateProcess\(h, KILL_EXIT_CODE\)/.test(kill));
  ok('the kill walks in treeOrder and takes a second pass for late children',
     /treeOrder\(procs, root, created\)/.test(kill) && /pass < 2/.test(kill));
  ok('every opened process handle is closed', /finally \{\s*for \(const h of handles\.values\(\)\) if \(h\) W\.CloseHandle\(h\);/.test(kill));
}

// ── device instance IDs ─────────────────────────────────────────────────────
{
  const dfu = N.instanceMatcher(S.DFU_INSTANCE_PATTERN);
  ok('the DFU pattern is VID_0483&PID_DF11', S.DFU_INSTANCE_PATTERN === 'VID_0483&PID_DF11');
  ok('it matches the bootloader, any case', dfu('USB\\VID_0483&PID_DF11\\205937A74130') && dfu('usb\\vid_0483&pid_df11\\x'));
  ok('it does not match a running board', !dfu('USB\\VID_1209&PID_6668\\206F348D5430'));
  ok('an empty ID matches nothing', !dfu('') && !dfu(null));
  const NS = fs.readFileSync(path.join(ROOT, 'winSystemNative.js'), 'utf8');
  ok('every present device of every class is searched',
     /SetupDiGetClassDevsW\(null, null, null, DIGCF_ALLCLASSES \| DIGCF_PRESENT\)/.test(NS));
  ok('the service is SPDRP_SERVICE (DEVPKEY_Device_Service)', /SPDRP_SERVICE = 0x04/.test(NS));
  ok('the registry is read without expanding and without write rights',
     /RRF_RT_ANY \| RRF_NOEXPAND/.test(NS) && !/RegSetValue|RegCreateKey|RegDeleteKey|KEY_WRITE|KEY_ALL_ACCESS/.test(NS));
}

// ── the time limits are the launched programs' ones ─────────────────────────
{
  const W = fs.readFileSync(path.join(ROOT, 'winSystem.js'), 'utf8');
  ok('regQuery: 5 s, null', /_run\('regValue', \[String\(key\), String\(value\)\], 5000, null\)/.test(W));
  ok('arduinoRunning: 3 s, false', /_run\('processList', \[\], 3000, null\)\.then\(\(procs\) => \(procs \? N\.anyArduino\(procs\) : false\)\)/.test(W));
  ok('dfuBoundService: 4 s, \'\'', /_run\('pnpServices', \[String\(pattern\)\], 4000, \[\]\)/.test(W)
     && /function dfuBoundService\(\) \{\s*return boundServiceOf\(DFU_INSTANCE_PATTERN\);/.test(W));
  ok('killTree: fire-and-forget on a worker', /return _run\('killTree', \[pid\], 10000, null\);/.test(W));
  ok('expandArchive: 120 s', S.EXPAND_TIMEOUT_MS === 120000);
  const TC = fs.readFileSync(path.join(ROOT, 'toolchain.js'), 'utf8');
  const kt = TC.slice(TC.indexOf('function _killTree'), TC.indexOf('function _killTree') + 1200);
  ok('_killTree still falls back to killing the parent when the tree kill cannot run',
     /killTree\(pid\)\.then\(\(r\) => \{\s*if \(!r\) \{ try \{ proc\.kill\('SIGKILL'\); \} catch \{\} \}/.test(kt)
     && /\} catch \{ try \{ proc\.kill\('SIGKILL'\); \} catch \{\} \}/.test(kt));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const unpack = (pkg.build && pkg.build.asarUnpack) || [];
  ok('package.json unpacks the worker file and its runner from the asar',
     unpack.includes('winSystemNative.js') && unpack.includes('winNativeRun.js'), JSON.stringify(unpack));
  let ran = false;
  require('../winNativeRun').serveNative('winSystemNative.js', { x: () => { ran = true; } });
  ok('the worker entry does nothing on the main thread', !ran);
}

// ── the zip-slip guard ──────────────────────────────────────────────────────
{
  const root = path.resolve(os.tmpdir(), 'jmt-zip-root');
  const T = (n) => S.zipEntryTarget(root, n);
  ok('a plain name lands inside', T('ProffieOS/ProffieOS.ino') === path.join(root, 'ProffieOS', 'ProffieOS.ino'));
  ok('a backslash is a separator', T('a\\b.txt') === path.join(root, 'a', 'b.txt'));
  ok('unicode and spaces pass', T('ünï/日本 x.txt') === path.join(root, 'ünï', '日本 x.txt'));
  ok('a name starting with two dots is still a name', T('..hidden') === path.join(root, '..hidden'));
  ok('an inner ".." that stays inside passes', T('a/../b.txt') === path.join(root, 'b.txt'));
  for (const evil of ['../x', '..\\x', 'a/../../x', '/etc/x', '\\x', 'C:/x', 'C:x', 'c:\\x', 'a/b:stream', 'a\0b', '..']) {
    ok(`${JSON.stringify(evil)} is refused`, T(evil) === null, String(T(evil)));
  }
  ok('the root itself is "" (a "./" entry)', T('./') === '' && T('a/..') === '');
  const d = S.zipLocalTime(Date.UTC(2024, 1, 3, 15, 30, 16));
  ok('a DOS time is local time', d.getFullYear() === 2024 && d.getMonth() === 1 && d.getDate() === 3
     && d.getHours() === 15 && d.getMinutes() === 30 && d.getSeconds() === 16);
}

// ── expandArchive, end to end ───────────────────────────────────────────────
// A raw writer, so the archive holds exactly the names given: the app's archiver cleans "../"
// out of names, which would make a zip-slip fixture impossible.
function buildZip(entries) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const x of buf) c = table[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const time = (13 << 11) | (45 << 5) | 15, date = ((2024 - 1980) << 9) | (5 << 5) | 17;
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.data || '');
    const method = e.deflate ? 8 : 0;
    const body = method ? zlib.deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc32(raw), 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc32(raw), 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jmt-expand-'));
  try {
    const zip = path.join(work, 'p.zip');
    fs.writeFileSync(zip, buildZip([
      { name: 'ProffieOS/' },
      { name: 'ProffieOS/ProffieOS.ino', data: '// ino\n', deflate: true },
      { name: 'ProffieOS/empty folder/' },
      { name: 'ProffieOS/ünïcødé/日本語 file.txt', data: 'unicode ✓', deflate: true },
      { name: 'ProffieOS/a/b/c/deep.txt', data: 'new', deflate: false },
      { name: 'implicit/parent/file.txt', data: 'parents made on the way' },
    ]));
    const out = path.join(work, 'out');
    fs.mkdirSync(path.join(out, 'ProffieOS', 'a', 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(out, 'ProffieOS', 'a', 'b', 'c', 'deep.txt'), 'old content, longer than the new');
    fs.writeFileSync(path.join(out, 'unrelated.txt'), 'stays');
    await S.expandArchive(zip, out);
    const read = (...p) => fs.readFileSync(path.join(out, ...p), 'utf8');
    ok('files land with their content', read('ProffieOS', 'ProffieOS.ino') === '// ino\n'
       && read('ProffieOS', 'ünïcødé', '日本語 file.txt') === 'unicode ✓');
    ok('an existing file is overwritten, not appended to', read('ProffieOS', 'a', 'b', 'c', 'deep.txt') === 'new');
    ok('an empty folder is created', fs.statSync(path.join(out, 'ProffieOS', 'empty folder')).isDirectory());
    ok('missing parent folders are created', read('implicit', 'parent', 'file.txt') === 'parents made on the way');
    ok('a file outside the archive is left alone', read('unrelated.txt') === 'stays');
    const mt = fs.statSync(path.join(out, 'ProffieOS', 'ProffieOS.ino')).mtime;
    ok('a file keeps the archive\'s modified time', mt.getFullYear() === 2024 && mt.getMonth() === 4 && mt.getDate() === 17
       && mt.getHours() === 13 && mt.getMinutes() === 45);
    const fresh = path.join(work, 'fresh', 'deeper');
    await S.expandArchive(zip, fresh);
    ok('a destination that does not exist yet is created', fs.existsSync(path.join(fresh, 'ProffieOS', 'ProffieOS.ino')));

    for (const evil of ['../escaped.txt', 'ok/../../escaped.txt', '..\\escaped.txt']) {
      const slip = path.join(work, 'slip.zip');
      fs.writeFileSync(slip, buildZip([{ name: 'first.txt', data: 'f' }, { name: evil, data: 'evil' }]));
      const dest = path.join(work, 'slip', 'dest');
      fs.rmSync(path.join(work, 'slip'), { recursive: true, force: true });
      let err = null;
      try { await S.expandArchive(slip, dest); } catch (e) { err = e; }
      ok(`zip-slip ${JSON.stringify(evil)} rejects`, !!err && /outside the destination folder/.test(err.message), err && err.message);
      ok(`zip-slip ${JSON.stringify(evil)} writes nothing, inside or out`,
         !fs.existsSync(path.join(work, 'slip', 'escaped.txt')) && !fs.existsSync(path.join(dest, 'first.txt')));
    }
    fs.writeFileSync(path.join(work, 'bad.zip'), 'not a zip');
    let e1 = null;
    try { await S.expandArchive(path.join(work, 'bad.zip'), path.join(work, 'bad')); } catch (e) { e1 = e; }
    ok('a file that is not a zip rejects, with a reason', !!e1 && /could not be unpacked/.test(e1.message), e1 && e1.message);
    let e2 = null;
    try { await S.expandArchive(path.join(work, 'missing.zip'), path.join(work, 'm')); } catch (e) { e2 = e; }
    ok('a missing zip rejects', !!e2);
    let e3 = null;
    const big = path.join(work, 'big.zip');
    fs.writeFileSync(big, buildZip(Array.from({ length: 400 }, (_, i) => ({ name: `f${i}.txt`, data: 'x'.repeat(2000), deflate: true }))));
    try { await S.expandArchive(big, path.join(work, 'slow'), 1); } catch (e) { e3 = e; }
    ok('an unpack past its time limit rejects', !!e3 && /longer than/.test(e3.message), e3 && e3.message);
  } finally {
    await new Promise((r) => setTimeout(r, 50));
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\nwin-system-native: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
