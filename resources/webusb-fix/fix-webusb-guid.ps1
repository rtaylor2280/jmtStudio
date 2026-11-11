param(
  [Parameter(Mandatory=$true)][string]$Serial,
  [string]$ResultPath
)
# Repairs Windows' saved WebUSB setting for one Proffieboard, so browser tools
# (ProffieOS Workbench) can claim its WebUSB interface. Runs elevated. [B-660]
#
# WHY THIS EXISTS (proven 2026-11-10 on a real board): Windows reads a USB
# function's extra properties (the MS OS 2.0 registry property that carries the
# WebUSB interface's DeviceInterfaceGUIDs) once, then sets ExtPropDescSemaphore
# and never asks again. Interface 2 exists in EVERY Proffieboard build, WebUSB or
# not, so a build without WebUSB wipes the GUID while the semaphore stays set,
# and every later WebUSB build is left with no GUID: Chromium logs "no device
# path" and Workbench says only "Unable to claim interface".
#
# THE FIX: remove Windows' saved node for interface 2 and the per-device
# descriptor cache, then rescan. Windows rebuilds the node from the board and
# reads the GUID fresh. No replug, and the serial port (interface 0) is never
# touched.
$ErrorActionPreference = 'Continue'

function Write-Result([string]$status, [string]$detail) {
  if (-not $ResultPath) { return }
  try {
    $json = [pscustomobject]@{ status = $status; detail = $detail } | ConvertTo-Json -Compress
    # WriteAllText = UTF-8 without a BOM (a BOM breaks the app-side JSON.parse).
    [System.IO.File]::WriteAllText($ResultPath, $json)
  } catch {}
}

try {
  if ($Serial -notmatch '^[0-9A-Fa-f]{12}$') { Write-Result 'error' "Not a board serial: $Serial"; exit 2 }

  $parentKey = "HKLM:\SYSTEM\CurrentControlSet\Enum\USB\VID_1209&PID_6668\$Serial"
  $prefix = (Get-ItemProperty -Path $parentKey -Name ParentIdPrefix -ErrorAction SilentlyContinue).ParentIdPrefix
  if (-not $prefix) { Write-Result 'error' 'Windows has no record of this board.'; exit 3 }

  $instance = "USB\VID_1209&PID_6668&MI_02\$prefix&0002"
  $params   = "HKLM:\SYSTEM\CurrentControlSet\Enum\USB\VID_1209&PID_6668&MI_02\$prefix&0002\Device Parameters"

  pnputil /remove-device $instance | Out-Null
  # The descriptor cache is keyed by VID, PID and device revision, so clear every
  # revision this board family has used rather than guessing one.
  Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\usbflags' -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -match '^12096668' } |
    ForEach-Object { Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue }
  pnputil /scan-devices | Out-Null

  # Judge by OUTCOME: poll until the GUID lands (it took ~7 s when measured).
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $g = $null
    try { $g = (Get-Item -Path $params -ErrorAction Stop).GetValue('DeviceInterfaceGUIDs') } catch {}
    if ($g -and ("$g" -match '\{[0-9A-Fa-f-]{36}\}')) { Write-Result 'ok' 'WebUSB is set up for this board.'; exit 0 }
  }
  Write-Result 'still-missing' 'Windows did not pick up the WebUSB setting. Unplug the board and plug it back in.'
  exit 4
} catch {
  Write-Result 'error' $_.Exception.Message
  exit 1
}
