// Builds resources/driver-helper/JMTStudioDriverHelper.exe from driver-helper/DriverHelper.cs. [B-681]
// Uses the C# compiler that ships with Windows (.NET Framework 4), so nothing needs installing.
// Windows only; signing happens in build/sign.js like Studio's own exe.
//
//   node scripts/build-driver-helper.js

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') {
  console.log('[driver-helper] Windows only; skipped.');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'driver-helper', 'DriverHelper.cs');
const MANIFEST = path.join(ROOT, 'driver-helper', 'DriverHelper.manifest');
const OUT_DIR = path.join(ROOT, 'resources', 'driver-helper');
const OUT = path.join(OUT_DIR, 'JMTStudioDriverHelper.exe');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

if (!fs.existsSync(CSC)) {
  console.error('[driver-helper] C# compiler not found at ' + CSC);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const r = spawnSync(CSC, [
  '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
  '/out:' + OUT, '/win32manifest:' + MANIFEST, SRC,
], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('[driver-helper] build failed');
  process.exit(r.status || 1);
}
console.log('[driver-helper] built ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
