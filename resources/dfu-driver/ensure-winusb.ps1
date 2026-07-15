param(
  [Parameter(Mandatory=$true)][string]$InfPath,
  [string]$ResultPath
)
# Ensures the JMT Studio WinUSB driver is bound to the STM32 bootloader
# (USB\VID_0483&PID_DF11) so dfu-util can flash. Runs elevated.
#
# Stage-once: the signed package is added to the driver store only if it is not
# already there (so a user sees the publisher prompt at most once, ever). Then
# the present DFU device is force-bound to it — force is required because ST's
# WHQL STTub30 outranks our WinUSB for a fresh device node.
$ErrorActionPreference = 'Continue'

$dbg = Join-Path $env:TEMP 'jmt-dfu-helper-debug.log'
function Dbg($m) { try { ('[{0}] {1}' -f (Get-Date -Format o), $m) | Add-Content -Path $dbg } catch {} }

function Write-Result([string]$status, [string]$detail) {
  if (-not $ResultPath) { Dbg 'Write-Result: no ResultPath'; return }
  try {
    $json = [pscustomobject]@{ status = $status; detail = $detail } | ConvertTo-Json -Compress
    # WriteAllText = UTF-8 WITHOUT BOM (a BOM breaks the app-side JSON.parse) and
    # is more reliable than Set-Content under elevation.
    [System.IO.File]::WriteAllText($ResultPath, $json)
    Dbg ("Write-Result '$status' -> exists=" + (Test-Path $ResultPath) + " path=$ResultPath")
  } catch {
    Dbg "Write-Result FAILED: $_"
  }
}

try {
  if (-not (Test-Path $InfPath)) { Write-Result 'error' "Driver INF not found: $InfPath"; exit 2 }

  # 1) Stage into the driver store, but only if our package isn't already there.
  $already = ((pnputil /enum-drivers) -join "`n") -match 'jmt_proffie_winusb\.inf'
  if (-not $already) {
    $add = pnputil /add-driver $InfPath /install 2>&1 | Out-String
    # Do NOT judge success by the exit code. /install returns non-zero (e.g. 259)
    # even when the package staged fine, because a higher-ranked driver (ST's
    # STTub30) kept it from auto-binding to the device. The force-bind below is
    # what actually binds ours. The only real staging failure is the package
    # never reaching the store, which happens if the user declined the prompt.
    $staged = ((pnputil /enum-drivers) -join "`n") -match 'jmt_proffie_winusb\.inf'
    if (-not $staged) { Write-Result 'error' ("Driver install was not completed (the Windows install prompt may have been declined): " + $add.Trim()); exit 3 }
  }

  # 2) Force-bind every present 0483:DF11 device to our INF (overrides STTub30).
  Add-Type -Namespace NewDev -Name Api -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("newdev.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode, SetLastError=true)]
public static extern bool UpdateDriverForPlugAndPlayDevicesW(System.IntPtr h, string hwid, string inf, uint flags, out bool reboot);
'@
  Dbg "helper start; alreadyStaged=$already resultPath=$ResultPath"

  $reboot = $false
  $INSTALLFLAG_FORCE = 1
  try { [void][NewDev.Api]::UpdateDriverForPlugAndPlayDevicesW([IntPtr]::Zero, 'USB\VID_0483&PID_DF11', $InfPath, $INSTALLFLAG_FORCE, [ref]$reboot) } catch { Dbg "UpdateDriver threw: $_" }

  # 3) Judge by OUTCOME, not by the P/Invoke return value (GetLastWin32Error is
  # unreliable under PowerShell). A force-bind re-enumerates the device (unbind
  # the old driver, bind WinUSB), which takes a moment, so poll until it settles
  # on WinUSB rather than checking once, too early.
  $svc = ''
  $dev = $null
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Milliseconds 400
    $dev = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_0483&PID_DF11' } | Select-Object -First 1
    if ($dev) { $svc = '' + (Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName 'DEVPKEY_Device_Service' -ErrorAction SilentlyContinue).Data }
    Dbg "poll $i present=$([bool]$dev) svc='$svc'"
    if ($svc -match 'winusb') { break }
  }

  if ($svc -match 'winusb') { Dbg 'verdict ok';           Write-Result 'ok' 'DFU driver installed and device bound.'; exit 0 }
  if (-not $dev)           { Dbg 'verdict staged-nodev';  Write-Result 'staged-nodev' 'Driver installed; no bootloader connected to bind yet.'; exit 0 }
  Dbg "verdict error svc='$svc'"
  Write-Result 'error' ("The driver installed, but Windows has not attached WinUSB to the bootloader yet (currently: $svc). Reconnect the board and try again.")
  exit 4
} catch {
  Write-Result 'error' $_.Exception.Message
  exit 1
}
