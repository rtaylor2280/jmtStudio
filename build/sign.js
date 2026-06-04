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

  // Skip bundled third-party tools — Proffieboard core dfu-util/dfu-suffix/
  // dfu-prefix, arduino-cli, etc. Those aren't ours and don't need our
  // signature; signing them would also break any signatures they ship with.
  // Only sign our own binaries: the main app .exe and the NSIS installer/
  // uninstaller.
  if (/[\\\/]resources[\\\/]/i.test(file)) {
    console.log(`[sign] Skipping third-party binary: ${file}`);
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
