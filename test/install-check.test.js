// [B-681] The launch check for files the install shipped with (installCheck.js).
// Every file it lists must exist in the project and be packaged where the check looks for it,
// or the check either cries wolf on every launch or watches a file the build never ships.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ic = require('../installCheck');

const ROOT = path.join(__dirname, '..');
const RES = path.join(ROOT, 'resources');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const PLATFORMS = [['win32', 'x64'], ['darwin', 'arm64'], ['linux', 'x64']];

for (const [platform, arch] of PLATFORMS) {
  check(`${platform}: every listed file exists in the project`, () => {
    const absent = ic.requiredFiles({ resourcesPath: RES, appDir: ROOT, platform, arch })
      .filter((f) => !fs.existsSync(f.file)).map((f) => path.relative(ROOT, f.file));
    assert.deepStrictEqual(absent, []);
  });

  check(`${platform}: every listed file is packaged where the check looks`, () => {
    const filters = pkg.build.extraResources.flatMap((e) => e.filter || []);
    const unpack = pkg.build.asarUnpack || [];
    const glob = (pat, rel) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$').test(rel);
    const notShipped = [];
    for (const f of ic.requiredFiles({ resourcesPath: RES, appDir: ROOT, platform, arch })) {
      const underRes = !path.relative(RES, f.file).startsWith('..');
      const rel = path.relative(underRes ? RES : ROOT, f.file).split(path.sep).join('/');
      const ok = underRes ? filters.some((p) => glob(p, rel)) : unpack.some((p) => glob(p, rel));
      if (!ok) notShipped.push(rel);
    }
    assert.deepStrictEqual(notShipped, []);
  });
}

check('nothing is reported missing in this project tree', () => {
  assert.deepStrictEqual(ic.missingFiles({ resourcesPath: RES, appDir: ROOT }), []);
});

check('a removed file is reported, with what stops working', () => {
  const all = ic.requiredFiles({ resourcesPath: RES, appDir: ROOT, platform: 'win32', arch: 'x64' });
  const gone = new Set([all.find((f) => /arduino-cli\.exe$/.test(f.file)).file]);
  const missing = ic.missingFiles({ resourcesPath: RES, appDir: ROOT, platform: 'win32', arch: 'x64' },
    (p) => !gone.has(p));
  assert.strictEqual(missing.length, 1);
  const d = ic.describe(missing);
  assert.ok(/compiling will not work/.test(d.message), d.message);
  assert.ok(/Missing: arduino-cli\.exe\./.test(d.message), d.message);
  assert.ok(/[Rr]einstalling JMT Studio/.test(d.message), d.message);
});

check('several missing files name each purpose once', () => {
  const all = ic.requiredFiles({ resourcesPath: RES, appDir: ROOT, platform: 'win32', arch: 'x64' });
  const gone = new Set(all.filter((f) => /dfu-util|dfu-suffix|koffi\.node/.test(f.file)).map((f) => f.file));
  const d = ic.describe(ic.missingFiles({ resourcesPath: RES, appDir: ROOT, platform: 'win32', arch: 'x64' },
    (p) => !gone.has(p)));
  assert.ok(/these will not work: flashing, card reading and ejecting\./.test(d.message), d.message);
  assert.ok(/Missing: dfu-util\.exe, dfu-suffix\.exe, koffi\.node\./.test(d.message), d.message);
});

check('an empty file counts as missing (what some antivirus leaves behind)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-check-'));
  const res = path.join(dir, 'resources');
  fs.mkdirSync(path.join(res, 'jmt-plugin'), { recursive: true });
  fs.writeFileSync(path.join(res, 'jmt-plugin', 'manifest.json'), '');
  const missing = ic.missingFiles({ resourcesPath: res, appDir: dir, platform: 'freebsd' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.strictEqual(missing.length, 1);
  assert.ok(/manifest\.json$/.test(missing[0].file));
});

check('nothing missing describes as null', () => {
  assert.strictEqual(ic.describe([]), null);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
