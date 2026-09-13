/**
 * MOUNT_SD_SETTING with no mass storage  [B-170]
 *
 * FOUND IN USE: typed `sd 1` at the serial monitor, got `Whut? :sd`. The config had
 * MOUNT_SD_SETTING; the board had no such command.
 *
 * WHY. ProffieOS.ino undefines it when USB_CLASS_MSC is absent:
 *     #if !defined(USB_CLASS_MSC)
 *     #undef MOUNT_SD_SETTING
 *     #endif
 * USB_CLASS_MSC comes from the USB type, and the app defaults to cdc_webusb — Serial +
 * WebUSB, no mass storage. So the define is written, accepted, compiled away, and the
 * only evidence is a serial command that does not exist.
 *
 * ⭐ THE ASYMMETRY IS THE ACTUAL BUG. The dangerous direction — mass storage WITHOUT
 * MOUNT_SD_SETTING, which auto-mounts and corrupts the card — already has a
 * four-touchpoint guard. The inverse is harmless to the card, simply does not work, and
 * was unguarded. A guard that fires one way teaches the user the pairing is enforced,
 * which makes the unguarded direction MORE confusing.
 *
 * ⚠️⚠️ WARN ONLY, AND IT OFFERS NOTHING. His ruling 2026-09-13. The entry proposed
 * offering to switch the USB type; switching TO mass storage is the exact direction the
 * four-touchpoint guard exists to prevent, so a convenience here could quietly undo a
 * card-safety feature.
 *
 * Run: node test/mount-sd-usb-check.test.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const preflight = require(path.join(ROOT, 'renderer', 'preflight.js'));
require(path.join(ROOT, 'renderer', 'preflight-checks.js'));

const check = preflight.checks().find(c => c.id === 'mount-sd-without-mass-storage');

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const cfg = (defines) => `#define NUM_BLADES 1\n${defines}\nPreset p[] = {};`;
const run = (defines, usbType) => check.run(preflight.buildContext({ text: cfg(defines), usbType }));

ok('the check is registered', !!check);
ok('it is a WARN, not a block', check && check.severity === 'warn',
   'the config builds and runs; what is missing is one command');

// ── it fires where it should ───────────────────────────────────────────────
{
  const r = run('#define MOUNT_SD_SETTING', 'cdc_webusb');
  ok('MOUNT_SD_SETTING on a non-MSC USB type warns', !!(r && r.findings));
  ok('it states the CONSEQUENCE, not the mechanism',
     /the "sd" command will not exist on the board/.test(r.findings[0].detail)
     && !/USB_CLASS_MSC/.test(r.findings[0].detail), r.findings[0].detail);
  ok('it says the saber still works', /build and run\s*\n?\s*normally|build and run normally/.test(r.findings[0].detail.replace(/\s+/g, ' ')),
     r.findings[0].detail);
  // ⚠️ THE ONE THAT MATTERS MOST HERE.
  ok('it offers NO fix', r.findings[0].fix === null,
     'switching to mass storage is the direction that corrupts cards');
}

// ── it stays quiet where it should ─────────────────────────────────────────
{
  ok('a mass-storage USB type is silent', run('#define MOUNT_SD_SETTING', 'cdc_msc') === null);
  ok('and so are its variants',
     run('#define MOUNT_SD_SETTING', 'cdc_msc_hid') === null
     && run('#define MOUNT_SD_SETTING', 'cdc_msc_dap') === null);
  ok('no define, no warning', run('#define ENABLE_SD', 'cdc_webusb') === null);
  ok('a commented-out define is ignored, as the compiler ignores it',
     run('//#define MOUNT_SD_SETTING', 'cdc_webusb') === null);
  ok('no USB type selected is UNSURE, not a guess',
     run('#define MOUNT_SD_SETTING', '').unsure === 'no USB type is selected',
     'guessing the default would fire on configs nobody has chosen a USB type for');
}

// ── the scope, which the measurement decided ───────────────────────────────
{
  // ⭐⭐ The entry said "directly or via ENABLE_ALL_EDIT_OPTIONS". Measured across 156
  // wild configs: direct = 0, ENABLE_ALL = 61 (39%). Every hit came from the blanket
  // flag, which means "turn on every edit-mode option" rather than "I want SD mount".
  // Warning two configs in five teaches people to ignore the gate.
  ok('ENABLE_ALL_EDIT_OPTIONS alone does NOT warn',
     run('#define ENABLE_ALL_EDIT_OPTIONS', 'cdc_webusb') === null,
     'a blanket flag is not a request for this specific setting');
  ok('but the direct define still does, even alongside it',
     !!run('#define ENABLE_ALL_EDIT_OPTIONS\n#define MOUNT_SD_SETTING', 'cdc_webusb'));
}

// ── the corpus ─────────────────────────────────────────────────────────────
{
  const rd = (d) => {
    try {
      return fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.h'))
        .map(f => path.join(ROOT, d, f));
    } catch { return []; }
  };
  const known = ['local/ConfigExamples', 'local/test-configs'].flatMap(rd);
  const wild  = ['local/nightly/error-exp/wild/configs',
                 'local/nightly/error-exp/wild/configs2'].flatMap(rd);
  const fires = (files, usb) => files.filter(f => {
    try { const r = check.run(preflight.buildContext({ text: fs.readFileSync(f, 'utf8'), usbType: usb })); return !!(r && r.findings); }
    catch { return false; }
  }).length;

  if (!known.length) console.log('SKIP  no config corpus on this machine');
  else ok(`none of the ${known.length} known-good configs warn`, fires(known, 'cdc_webusb') === 0);
  if (wild.length) {
    // ⚠️ THIS NUMBER IS THE WHOLE ARGUMENT FOR THE NARROWED SCOPE. It was 61 before.
    ok(`none of the ${wild.length} wild configs warn at the default USB type`,
       fires(wild, 'cdc_webusb') === 0,
       'if this grows, check whether ENABLE_ALL crept back into the predicate');
  }
}

// ── the wiring, which is where this class of check usually dies ────────────
{
  const bp = fs.readFileSync(path.join(ROOT, 'renderer', 'buildPanel.js'), 'utf8');
  ok('buildPanel exports the USB type', /window\.getSelectedUsb\s+= \(\) => selectedUsb;/.test(bp));
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  ok('the preflight context reads it', /usbType: \(typeof window\.getSelectedUsb === 'function'/.test(html));
  // ⚠️ The accessor was added BEFORE the reader. The context's own note records a first
  // draft that called a getSelectedBoardLabel() which did not exist — optional chaining
  // would have returned '' forever while looking wired.
  ok('the accessor exists, so the optional chain is not hiding a missing name',
     /window\.getSelectedUsb/.test(bp) && bp.indexOf('window.getSelectedUsb') > 0);
  ok('the context carries usbType', /usbType:\s+o\.usbType \|\| '',/.test(
     fs.readFileSync(path.join(ROOT, 'renderer', 'preflight.js'), 'utf8')));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall mount-sd usb check tests passed');
process.exit(failures ? 1 : 0);
