// Windows code signing via Microsoft Trusted Signing.
//
// Called by electron-builder for each .exe that needs signing — the main app,
// the uninstaller, and the NSIS installer itself. Uses the `sign` CLI tool
// (from dotnet/sign) which talks to the Trusted Signing service.
//
// Auth: relies on the active `az login` session via Azure CLI credential.
// On a fresh machine you need:
//   winget install Microsoft.AzureCLI
//   winget install Microsoft.DotNet.SDK.8
//   dotnet tool install --global sign --prerelease
//   az login --tenant <your-tenant-id>
//
// Build invokes this for every binary; failures throw and halt the build.

const { spawnSync } = require('child_process');

const TRUSTED_SIGNING_ENDPOINT   = 'https://wus2.codesigning.azure.net';
const TRUSTED_SIGNING_ACCOUNT    = 'rtaylor-signing';
const CERTIFICATE_PROFILE        = 'jmt-studio-signing';

exports.default = async function sign(configuration) {
  const file = configuration.path;

  // [B-681] EVERY WINDOWS PROGRAM FILE STUDIO SHIPS IS SIGNED, the bundled tools (arduino-cli,
  // dfu-util, dfu-suffix and its library) and native modules (koffi, serialport) included.
  // Behaviour-based antivirus convicted the unsigned arduino-cli and Studio with it (QA BUG-012);
  // a signed file has a publisher it can check. None of these carries a signature of its own
  // (verified 2026-11-15), so signing breaks nothing. A file that already has a valid signature
  // keeps it and is not signed again.
  //
  // package.json win.signExts sends .node and .dll files here as well as .exe. Only Windows PE
  // files can be signed, so anything else that matches by name (koffi ships .node builds for
  // every platform) is passed over.
  if (!_isPortableExecutable(file)) {
    console.log(`[sign] Not a Windows program file, not signed: ${file}`);
    return;
  }
  if (_hasValidSignature(file)) {
    console.log(`[sign] Already signed, kept: ${file}`);
    return;
  }

  console.log(`[sign] Signing ${file}`);

  const args = [
    'code', 'trusted-signing',
    '--trusted-signing-endpoint', TRUSTED_SIGNING_ENDPOINT,
    '--trusted-signing-account', TRUSTED_SIGNING_ACCOUNT,
    '--trusted-signing-certificate-profile', CERTIFICATE_PROFILE,
    '--azure-credential-type', 'azure-cli',
    '--verbosity', 'Information',
    file,
  ];

  // No shell:true — that mode silently concatenates args, which breaks file
  // paths with spaces (e.g. "JMT-Studio Setup 1.7.0.exe"). Without shell:true
  // each array element is passed as a single argument verbatim. Node also
  // emits DEP0190 deprecation warnings under shell:true. On Windows the
  // dotnet-global "sign" tool is installed as sign.exe under
  // %USERPROFILE%\.dotnet\tools (on PATH), and Node's spawn resolves the
  // .exe extension via PATHEXT.
  const cmd    = process.platform === 'win32' ? 'sign.exe' : 'sign';
  const result = spawnSync(cmd, args, { stdio: 'inherit' });

  if (result.status !== 0) {
    throw new Error(`sign exited with code ${result.status} for ${file}`);
  }
};

// A Windows PE file starts with "MZ".
function _isPortableExecutable(file) {
  const fs = require('fs');
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(2);
    fs.readSync(fd, b, 0, 2, 0);
    fs.closeSync(fd);
    return b[0] === 0x4d && b[1] === 0x5a;
  } catch { return false; }
}

// True when Windows already finds a valid Authenticode signature on the file.
function _hasValidSignature(file) {
  const ps = `(Get-AuthenticodeSignature -LiteralPath '${String(file).replace(/'/g, "''")}').Status`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  return r.status === 0 && /^Valid\s*$/m.test(r.stdout || '');
}
