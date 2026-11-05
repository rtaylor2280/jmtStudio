// node test/error-fixtures/harness.js capture [id ...]   compile each fault, save compiler output
// node test/error-fixtures/harness.js publish <folder>   write the numbered configs to a folder
//
// Compiles run one at a time: parallel arduino-cli compiles fail silently under load.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { FAULTS, ALL_AT_ONCE, TEST_ORDER, apply } = require('./faults');

const ROOT = path.join(__dirname, '..', '..');
const CAPTURED = path.join(__dirname, 'captured');
const CLI = path.join(ROOT, 'resources', 'arduino-cli', 'windows', 'arduino-cli.exe');
const FQBN = 'proffieboard:stm32l4:ProffieboardV3-L452RE:usb=cdc_webusb,dosfs=sdmmc1,speed=80,opt=os,pclk=2';
const SKETCH = { '8.10': path.join(ROOT, 'local', 'nightly', 'flash-exp', 'ProffieOS'),
                 '7.15': path.join(ROOT, 'local', 'error-harness', 'os715', 'ProffieOS', 'ProffieOS') };
const BUILD = path.join(ROOT, 'local', 'error-harness', 'build');

const MAX_LINES = 80;
const MAX_LINE = 400;

// The diagnostics only, with the machine's own paths removed.
function trim(out, sketch) {
  const esc = sketch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\/g, '[\\\\/]');
  return out.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
    .filter(l => !/^(Used |Error during|Multiple libraries|FQBN|Platform |In file included|\s+from |\s*$)/.test(l))
    .filter(l => !/\\Arduino15\\/.test(l))
    .map(l => l.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/g, '<HOME>'))
    .filter(l => !/arm-none-eabi-g\+\+|arduino-builder|^"?[A-Z]:\\.*\.exe/.test(l))
    .map(l => l.replace(new RegExp(esc, 'gi'), '<OS>').slice(0, MAX_LINE))
    .slice(0, MAX_LINES)
    .join('\n');
}

function compile(text, os) {
  const sketch = SKETCH[os];
  fs.writeFileSync(path.join(sketch, 'config', 'my_config.h'), text);
  const r = spawnSync(CLI, ['compile', '--fqbn', FQBN, '--build-path', `${BUILD}_${os}`, sketch],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}`, sketch };
}

function capture(ids) {
  fs.mkdirSync(CAPTURED, { recursive: true });
  for (const f of FAULTS) {
    if (ids.length && !ids.includes(f.id)) continue;
    const t0 = Date.now();
    const r = compile(apply(f), f.os || '8.10');
    fs.writeFileSync(path.join(CAPTURED, `${f.id}.txt`),
      `${r.ok ? 'COMPILED' : 'FAILED'}\n${trim(r.out, r.sketch)}\n`);
    console.log(`${r.ok ? 'COMPILED' : 'FAILED  '} ${f.id} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

function publish(CONFIGS) {
  fs.mkdirSync(CONFIGS, { recursive: true });
  const number = n => String(n).padStart(2, '0');
  TEST_ORDER.forEach((id, i) => {
    const f = FAULTS.find(x => x.id === id);
    const name = `${number(i + 1)}_${id}`;
    const head = [
      `// ${name} - Error Intelligence harness.`,
      `// Fault: one deliberate mistake on a working one-blade config.`,
      `// You should see: ${f.see}`,
      f.sig ? `// Compile signature: ${f.sig}` : '// This one builds. The card is a warning.',
      '// A failure looks like: no card, a different message, or the raw compiler error.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(CONFIGS, `${name}.h`), head + apply(f));
  });
  const all = [
    `// ${number(TEST_ORDER.length + 1)}_ALL_at_once - Error Intelligence harness.`,
    '// Every preflight check that can fire together, so the dialog holds as many cards as it can.',
    '// Select a +JMT version and saber_fett263_buttons.h is already in, then Compile.',
    '// You should see: the headline with the count, a list of cards that scrolls, Cancel Compile and',
    '// Compile anyway still on screen, and a card leaving the list each time you use a fix button.',
    '// A failure looks like: the dialog running off the screen, buttons you have to scroll to, or a',
    '// card that stays after its fix. Compile anyway stops at the first compile error, as it should.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(CONFIGS, `${number(TEST_ORDER.length + 1)}_ALL_at_once.h`), all + ALL_AT_ONCE);
  console.log(`${TEST_ORDER.length + 1} written to ${CONFIGS}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'capture') capture(rest);
else if (cmd === 'publish' && rest[0]) publish(rest[0]);
else console.log('capture [id ...] | publish <folder>');
