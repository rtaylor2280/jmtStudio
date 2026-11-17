// Board Forensics parsers [B-543], against replies copied from a real board.
//
// Every fixture below is text a Proffieboard sent (serial 205638A45031, ProffieOS v7.14, factory
// firmware from a board supplier, read 2026-11-16), trimmed but not edited, so the parsers are
// tested against what boards actually print rather than what the parser expects.
'use strict';

const assert = require('assert');
const bf = require('../boardForensics');

let failed = 0, passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message); }
};

const VERSION = 'v7.14\r\nconfig/V3.9_config_config.h\r\nprop: SaberFett263Buttons\r\nbuttons: 2\r\ninstalled: Aug 28 2026 18:55:38\r\n';

const PRESETS =
  'Failed to mount SD card.\r\nFONT=Darth Maul;MC\r\nTRACK=tracks/Darth Maul.wav\r\nSTYLE1=builtin 0 1\r\nSTYLE2=builtin 0 2\r\nSTYLE3=builtin 0 3\r\nNAME=0\r\nVARIATION=0\r\n' +
  'Failed to mount SD card.\r\nFONT=Windu;MC\r\nTRACK=tracks/Windu.wav\r\nSTYLE1=builtin 14 1\r\nSTYLE2=builtin 14 2\r\nSTYLE3=builtin 14 3\r\nNAME=Windu\r\nVARIATION=0\r\n' +
  'Failed to mount SD card.\r\nFONT=Darksaber;MC\r\nTRACK=tracks/Darksaber BOBF.wav\r\nSTYLE1=builtin 40 1\r\nSTYLE2=builtin 40 2\r\nSTYLE3=builtin 40 3\r\nNAME=0\r\nVARIATION=0\r\n' +
  'Failed to mount SD card.\r\nFailed to mount SD card.\r\n';

const SCANID =
  'blade = 0\r\nWS2811 Blade with 128 leds.\r\nWS2811 Blade with 26 leds.\r\nWS2811 Blade with 26 leds.\r\nFailed to mount SD card.\r\n' +
  'Style RAM = 144\r\nStyle RAM = 144\r\nStyle RAM = 144\r\nFailed to mount SD card.\r\nScanning sound font: Darth Maul NOT FOUND!\r\n' +
  'Scanning sound font: MC NOT FOUND!\r\nActivating polyphonic font.\r\nDISPLAY WAKEUP\r\nI2C init..\r\nDisplay initialized.\r\nAmplifier off.\r\n';

const NAMED =
  'standard\r\nadvanced\r\nfire\r\nunstable\r\nstrobe\r\ncycle\r\nrainbow\r\ncharging\r\nbuiltin 0 1\r\nbuiltin 0 2\r\nbuiltin 0 3\r\n' +
  'builtin 1 1\r\nbuiltin 1 2\r\nbuiltin 1 3\r\nTime = 3000. PLI_OFF_TIME expired.\r\nDISPLAY SLEEP\r\n';

const DFU_LIST =
  'dfu-util 0.9\n\nFound DFU: [0483:df11] ver=2200, devnum=41, cfg=1, intf=0, path="1-5.2.3", alt=3, name="@Device Feature/0xFFFF0000/01*004 e", serial="205638A45031"\n' +
  'Found DFU: [0483:df11] ver=2200, devnum=41, cfg=1, intf=0, path="1-5.2.3", alt=2, name="@OTP Memory /0x1FFF7000/01*0001Ke", serial="205638A45031"\n' +
  'Found DFU: [0483:df11] ver=2200, devnum=41, cfg=1, intf=0, path="1-5.2.3", alt=1, name="@Option Bytes  /0x1FFF7800/01*040 e", serial="205638A45031"\n' +
  'Found DFU: [0483:df11] ver=2200, devnum=41, cfg=1, intf=0, path="1-5.2.3", alt=0, name="@Internal Flash  /0x08000000/0256*0002Kg", serial="205638A45031"\n' +
  'Cannot open DFU device 04f2:b6cb\n';

const OPTION_BYTES = Buffer.from('aaf8ffff55070000ffffffff000000000000ffffffff0000ffff00ff0000ff00ffff00ff0000ff00', 'hex');

t('version reply: every field', () => {
  const v = bf.parseVersionReply(VERSION);
  assert.strictEqual(v.version, 'v7.14');
  assert.strictEqual(v.configFile, 'config/V3.9_config_config.h');
  assert.strictEqual(v.prop, 'SaberFett263Buttons');
  assert.strictEqual(v.buttons, 2);
  assert.strictEqual(v.installed, 'Aug 28 2026 18:55:38');
});

t('version reply: factory $Id build keeps the $Id line as the version', () => {
  const v = bf.parseVersionReply('$Id: ce12a06a1e236b5101ec60c950530a9a4719a74d $\r\nconfig/default_proffieboard_config.h\r\nprop: Saber\r\nbuttons: 2\r\ninstalled: Mar 30 2023 03:03:48\r\n');
  assert.ok(/^\$Id:/.test(v.version));
  assert.strictEqual(v.prop, 'Saber');
});

t('presets: fonts, common folder, track, three styles, names; SD noise counted not kept', () => {
  const { presets, sdMountFailures } = bf.parsePresets(PRESETS);
  assert.strictEqual(presets.length, 3);
  assert.deepStrictEqual(presets[0].fontFolders, ['Darth Maul', 'MC']);
  assert.strictEqual(presets[0].track, 'tracks/Darth Maul.wav');
  assert.deepStrictEqual(presets[1].styles, ['builtin 14 1', 'builtin 14 2', 'builtin 14 3']);
  assert.strictEqual(presets[1].name, 'Windu');
  assert.strictEqual(presets[2].track, 'tracks/Darksaber BOBF.wav');
  assert.strictEqual(sdMountFailures, 5);
});

t('scanid: blade config and LED count per blade, display, fonts looked for', () => {
  const s = bf.parseScanid(SCANID);
  assert.strictEqual(s.bladeConfig, 0);
  assert.deepStrictEqual(s.blades.map(b => b.leds), [128, 26, 26]);
  assert.ok(s.blades.every(b => b.type === 'WS2811'));
  assert.strictEqual(s.displayInitialized, true);
  assert.deepStrictEqual(s.fontsScanned, [{ name: 'Darth Maul', found: false }, { name: 'MC', found: false }]);
});

t('named styles: names kept, builtin entries counted, status chatter dropped', () => {
  const n = bf.parseNamedStyles(NAMED);
  assert.deepStrictEqual(n.names, ['standard', 'advanced', 'fire', 'unstable', 'strobe', 'cycle', 'rainbow', 'charging']);
  assert.strictEqual(n.builtinCount, 6);
});

t('simple values: battery, blade id, volume, preset; "Whut?" is no answer', () => {
  assert.strictEqual(bf.parseNumber('4.07\r\n', /(\d+\.\d+)/), 4.07);
  assert.strictEqual(bf.parseNumber('ID: 934487.50\r\n', /ID:\s*([\d.]+)/i), 934487.5);
  assert.strictEqual(bf.parseNumber('1000\r\n', /^\s*(\d+)/m), 1000);
  assert.strictEqual(bf.parseNumber('Whut? :dir\r\n'), null);
  assert.strictEqual(bf.isUnknownCommand('Whut? :help\r\n'), true);
});

t('dfu listing: regions for this serial only, sizes from page counts', () => {
  const r = bf.parseDfuListing(DFU_LIST, '205638a45031');
  const flash = r.find(x => x.alt === 0);
  assert.strictEqual(flash.start, '0x08000000');
  assert.strictEqual(flash.size, 512 * 1024);
  assert.strictEqual(r.find(x => /option/i.test(x.name)).size, 40);
  assert.strictEqual(r.find(x => /otp/i.test(x.name)).size, 1024);
  assert.strictEqual(bf.parseDfuListing(DFU_LIST, 'AAAAAAAAAAAA').length, 0);
  assert.strictEqual(bf.generationForFlashSize(flash.size), 'V3');
});

t('option bytes: 0xAA is level 0 (readable), 0xCC level 2, anything else level 1', () => {
  assert.strictEqual(bf.parseOptionBytes(OPTION_BYTES).rdpLevel, 0);
  assert.strictEqual(bf.parseOptionBytes(Buffer.from([0xCC])).rdpLevel, 2);
  assert.strictEqual(bf.parseOptionBytes(Buffer.from([0xBB])).rdpLevel, 1);
});

t('used length trims only the erased tail', () => {
  const b = Buffer.from([1, 2, 0xFF, 3, 0xFF, 0xFF, 0xFF]);
  assert.strictEqual(bf.usedLength(b), 4);
  assert.strictEqual(bf.usedLength(Buffer.alloc(4, 0xFF)), 0);
});

t('streamed lines: one per preset, blades per LED count, diagnostics-off said plainly', () => {
  const p = bf.replyLines('list_presets', PRESETS);
  assert.ok(p.includes('No SD card mounted in the board.'));
  assert.ok(p.includes('Presets: 3'));
  assert.ok(p.some(l => /^\s+1\s+Darth Maul \+ MC · tracks\/Darth Maul\.wav$/.test(l)), p.join('|'));
  assert.ok(p.some(l => /Windu \+ MC · tracks\/Windu\.wav · "Windu"$/.test(l)));
  const s = bf.replyLines('scanid', SCANID);
  assert.deepStrictEqual(s.filter(l => /Blade \d/.test(l)).map(l => l.trim()), ['Blade 1: 128 LEDs (WS2811)', 'Blade 2: 26 LEDs (WS2811)', 'Blade 3: 26 LEDs (WS2811)']);
  assert.deepStrictEqual(bf.replyLines('help', 'Whut? :help\r\n'), ['Serial diagnostic commands are turned off in this build.']);
  assert.deepStrictEqual(bf.replyLines('version', VERSION).slice(0, 2), ['ProffieOS v7.14', 'Config file: config/V3.9_config_config.h']);
});

t('board records: original firmware, hardware and presets come from the original recording', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-records-'));
  try {
    const dir = path.join(ud, 'board-forensics', '205638A45031');
    const id = '2026-11-17T04-17-22-190Z';
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify({ schema: 1, serial: '205638A45031', original: id,
      captures: [{ id, at: '2026-11-17T04:17:22.191Z', firmware: true, version: 'v7.14' }] }));
    fs.writeFileSync(path.join(dir, id, 'report.json'), JSON.stringify({
      serial: { parsed: { version: bf.parseVersionReply(VERSION), presets: bf.parsePresets(PRESETS).presets, scan: bf.parseScanid(SCANID) } },
      dfu: { generation: 'V3' }, protection: { rdpLevel: 0 }, firmware: { usedBytes: 235648, flashSize: 524288 } }));
    const r = bf.boardRecords(ud, '205638a45031');
    assert.strictEqual(r.generation, 'V3');
    assert.strictEqual(r.original.installed, 'Aug 28 2026 18:55:38');
    assert.strictEqual(r.original.prop, 'SaberFett263Buttons');
    assert.deepStrictEqual(r.blades.map(b => b.leds), [128, 26, 26]);
    assert.strictEqual(r.presets.length, 3);
    assert.strictEqual(r.presets[1], 'Windu + MC · tracks/Windu.wav · "Windu"');
    assert.deepStrictEqual(r.recordings.map(c => c.isOriginal), [true]);
    assert.strictEqual(bf.boardRecords(ud, 'AAAAAAAAAAAA'), null);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

t('flash records: each flash listed, firmware and config stored once by content, unreadable store cannot flash', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-flashes-'));
  try {
    const fw = Buffer.alloc(4096, 0x5A);
    const cfg = '#ifdef CONFIG_TOP\n#endif\n';
    const a = bf.recordFlash(ud, { serial: '205638a45031', firmware: fw, configText: cfg, configName: 'ezra_bridger', proffieOSVersion: '8.10' });
    const b = bf.recordFlash(ud, { serial: '205638A45031', firmware: fw, configText: cfg, configName: 'ezra_bridger' });
    assert.strictEqual(a.firmwareSha256, b.firmwareSha256);
    const store = path.join(ud, 'board-forensics', 'store');
    assert.strictEqual(fs.readdirSync(store).length, 2, 'one firmware + one config, however many flashes');
    assert.ok(bf.getBlob(ud, a.firmwareSha256).equals(fw));
    assert.strictEqual(bf.getBlob(ud, a.configSha256).toString('utf8'), cfg);

    const s = bf.boardSummary(ud, '205638A45031');
    assert.strictEqual(s.known, true);
    assert.strictEqual(s.recorded, false, 'flashes alone are not a forensics recording');
    assert.strictEqual(s.flashes, 2);

    const r = bf.boardRecords(ud, '205638A45031');
    assert.deepStrictEqual(r.recordings.map(x => [x.kind, x.configName, x.canFlash]),
      [['flash', 'ezra_bridger', true], ['flash', 'ezra_bridger', true]]);
    assert.strictEqual(r.original, null);

    fs.writeFileSync(path.join(store, a.firmwareSha256), Buffer.alloc(4096, 0));
    assert.strictEqual(bf.getBlob(ud, a.firmwareSha256), null, 'a changed file no longer matches its hash');
    assert.strictEqual(bf.boardRecords(ud, '205638A45031').recordings[0].canFlash, false);
    assert.strictEqual(bf.recordFlash(ud, { serial: '205638A45031', firmware: Buffer.alloc(0) }), null);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

t('build stamp: the __DATE__ __TIME__ string in a firmware image matches the board\'s installed: line', () => {
  const img = Buffer.concat([Buffer.from([0x16, 0x18, 0x1c]), Buffer.from('Aug 28 2026 18:55:38\0\0\0', 'latin1'), Buffer.alloc(8, 0xFF)]);
  const stamp = bf.firmwareStamp(img);
  assert.strictEqual(stamp, 'Aug 28 2026 18:55:38');
  assert.strictEqual(bf.sameStamp(stamp, bf.parseVersionReply(VERSION).installed), true);
  assert.strictEqual(bf.firmwareStamp(Buffer.from('Nov  6 2026 01:02:03\0', 'latin1')), 'Nov  6 2026 01:02:03');
  assert.strictEqual(bf.sameStamp('Nov  6 2026 01:02:03', 'Nov 6 2026 01:02:03'), true, 'padded day matches either spacing');
  assert.strictEqual(bf.sameStamp('Nov 16 2026 21:16:12', 'Aug 28 2026 18:55:38'), false);
  assert.strictEqual(bf.firmwareStamp(Buffer.alloc(64, 0xFF)), null);
  assert.strictEqual(bf.sameStamp(null, null), false, 'nothing known is never a match');
});

t('event log: one JSON line per event, failed flashes kept, bad serial ignored, never creates a board record', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-events-'));
  try {
    bf.logEvent(ud, '205638a45031', 'flash', { ok: false, error: 'Cannot open DFU device', log: ['line 1', '! line 2'] });
    bf.logEvent(ud, '205638A45031', 'seen', { port: 'COM24', version: 'v7.14' });
    bf.logEvent(ud, 'COM24', 'seen', {});
    bf.logEvent('', '205638A45031', 'seen', {});
    const ev = bf.readEvents(ud, '205638A45031');
    assert.deepStrictEqual(ev.map(e => e.type), ['flash', 'seen']);
    assert.strictEqual(ev[0].ok, false);
    assert.deepStrictEqual(ev[0].log, ['line 1', '! line 2']);
    assert.ok(!isNaN(Date.parse(ev[0].at)));
    assert.strictEqual(bf.boardSummary(ud, '205638A45031').known, false, 'a log alone is not a board record');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

t('flash links: the same firmware on three boards is one file on disk; deleting a board leaves the others', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-links-'));
  try {
    const fw = Buffer.alloc(8192, 0x3C);
    const boards = ['205638A45031', '2085389D5031', '206F348D5430'];
    const entries = boards.map(sn => bf.recordFlash(ud, { serial: sn, firmware: fw, configText: '// cfg', configName: 'ezra_bridger' }));
    const own = (sn, e) => path.join(ud, 'board-forensics', sn, 'flashes', e.id, 'firmware.bin');
    const store = path.join(ud, 'board-forensics', 'store', entries[0].firmwareSha256);
    const ino = (f) => fs.statSync(f, { bigint: true }).ino;
    // Control: the test only means something if this volume makes links at all.
    let linksWork = true;
    try { fs.linkSync(store, store + '.probe'); fs.unlinkSync(store + '.probe'); } catch { linksWork = false; }
    for (let i = 0; i < 3; i++) assert.ok(fs.readFileSync(own(boards[i], entries[i])).equals(fw), 'each board holds its own readable copy');
    if (linksWork) {
      assert.strictEqual(new Set(boards.map((sn, i) => String(ino(own(sn, entries[i]))))).size, 1, 'one file on disk');
      assert.strictEqual(fs.statSync(store).nlink, 4, 'store + three boards');
    }
    fs.rmSync(path.join(ud, 'board-forensics', boards[0]), { recursive: true });
    assert.ok(fs.readFileSync(own(boards[1], entries[1])).equals(fw), 'another board keeps it');
    assert.ok(bf.flashFirmware(ud, boards[1], entries[1]).equals(fw));
    if (linksWork) assert.strictEqual(fs.statSync(store).nlink, 3);
    for (const sn of boards.slice(1)) fs.rmSync(path.join(ud, 'board-forensics', sn), { recursive: true });
    if (linksWork) assert.strictEqual(fs.statSync(store).nlink, 1, 'used by nothing: only the store holds it');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

t('recordings: identical firmware in two recordings becomes one file through the store', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-adopt-'));
  try {
    const a = path.join(ud, 'a.bin'), b = path.join(ud, 'b.bin');
    fs.writeFileSync(a, Buffer.alloc(4096, 7)); fs.writeFileSync(b, Buffer.alloc(4096, 7));
    const sa = bf.adoptIntoStore(ud, a), sb = bf.adoptIntoStore(ud, b);
    assert.strictEqual(sa, sb);
    assert.ok(fs.readFileSync(b).equals(Buffer.alloc(4096, 7)), 'contents unchanged');
    const ia = fs.statSync(a, { bigint: true }).ino, ib = fs.statSync(b, { bigint: true }).ino;
    const store = path.join(ud, 'board-forensics', 'store', sa);
    if (fs.statSync(store).nlink > 1) assert.strictEqual(ia, ib, 'both recordings share the store copy');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

console.log(`\nboard-forensics-parse: ${failed ? failed + ' FAILED, ' : 'all '}${passed} passed`);
process.exit(failed ? 1 : 0);
