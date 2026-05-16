# JMT Studio — DFU Mode Complete Flow Documentation

Every screen, every message shown to the user, every button available, and every path through the DFU/Bootloader mode feature.

---

## 1. Entry Point

User selects **"⚡ Switch to Bootloader Mode (DFU)"** from the port dropdown.

`enterDfuMode()` runs:
- Normal port UI is hidden (port selector, board display, refresh button)
- DFU mode indicator appears
- Status bar shows: `Checking for DFU device...`
- `_checkDfuOnEntry()` is called immediately

---

## 2. `_checkDfuOnEntry()` — Three Branches

### Branch A — Board already in DFU, driver OK
**Condition:** `found: true, accessible: true`

- No modal opens
- `dfuDeviceReady = true`
- Port status → **"DFU device ready"**
- Flash button enabled (if a compile exists), disabled (if no compile yet)
- User continues from main UI — clicks Flash when ready → goes to [Section 6](#6-doflashdfu)

---

### Branch B — Board in DFU, driver missing
**Condition:** `found: true, accessible: false`

→ Opens `startDfuWaitModal(isRetry=true, autoFlash=false)`
→ Skips boot instructions, goes straight to poll
→ See [Section 4 — Poll Loop (isRetry=true)](#poll-loop-isretrytrue)

---

### Branch C — Board not in DFU yet
**Condition:** `found: false`

→ Opens `startDfuWaitModal(isRetry=false, autoFlash=false)`
→ Shows boot entry instructions
→ See [Section 3 — Boot Instructions Modal](#3-boot-instructions-modal-isretryfalse)

---

## 3. Boot Instructions Modal (`isRetry=false`)

**Modal title:** `⚡ Bootloader Mode (DFU)`
**Status bar:** `Waiting for DFU device...`
**Progress bar:** Knightrider animation

**Log shown to user:**
```
Put the board into Bootloader Mode:
  1. Hold the BOOT button
  2. Tap the RESET button
  3. Release RESET
  4. Release BOOT
──────────────────────────────────
Waiting for DFU device to appear...
```

**Buttons visible:**
| Button | Action |
|--------|--------|
| `⊘ Cancel` | Closes modal. Stays in DFU mode. Status → "Put board in Bootloader Mode to flash" |

→ Poll loop runs — see [Section 4 — Poll Loop (isRetry=false)](#poll-loop-isretryfalse)

---

## 4. Poll Loop

Checks for DFU device every 500ms.

### Poll Loop (`isRetry=false`)

| Result | What happens |
|--------|-------------|
| `found: true, accessible: true` | Break — device fully ready → [Section 5A — DFU Device Ready](#5a-dfu-device-ready) |
| `found: true, accessible: false` | Break immediately → [Section 5B — Fix DFU Driver (no driver)](#5b-fix-dfu-driver--no-driver-installed) |
| `found: false` | Keep polling |
| Cancel clicked | Modal closes. Status → "Put board in Bootloader Mode to flash". DFU mode stays active. |

### Poll Loop (`isRetry=true`)

| Result | What happens |
|--------|-------------|
| `found: true, accessible: true` | Break — device fully ready → [Section 5A — DFU Device Ready](#5a-dfu-device-ready) |
| `found: true, accessible: false` | Start 10-second grace timer. Keep polling. After 10s: break → [Section 5C — Fix DFU Driver (driver pending)](#5c-fix-dfu-driver--driver-pending) |
| `found: false` | Keep polling. If 8 seconds pass with nothing found, appends to log: |
| | `Board may have exited Bootloader Mode.` |
| | `Re-enter it: hold BOOT, tap RESET, release both.` |
| Cancel clicked | Modal closes. Status → "STM32 driver required" (if device was found) or "Put board in Bootloader Mode to flash". DFU mode stays active. |

**Note:** The 8-second board-exited hint and the 10-second grace timer run independently.

---

## 5A. DFU Device Ready

**Modal title:** `⚡ DFU Device Ready`
**Progress bar:** Success (solid blue)
**Port status:** `DFU device ready`

**Log shown:**
```
✓ Proffieboard detected in Bootloader Mode (DFU)
```

Then branches on `autoFlash` and `compileSuccess`:

---

### 5A-i. `autoFlash=true` AND compile exists

**Log appended:**
```
Firmware ready — flashing now...
```

→ Immediately proceeds to flash — see [Section 6 — doFlashDFU()](#6-doflashdfu)

---

### 5A-ii. `autoFlash=false` AND compile exists
*(Mode-entry path — user entered DFU before clicking Flash)*

**Log appended:**
```
A compiled firmware is ready. If your configuration is verified,
click Flash Now to upload it to the board.
```

**Status bar:** `Connection successful.`

**Buttons visible:**
| Button | Action |
|--------|--------|
| `⚡ Flash Now` | Closes modal → `doFlash()` → [Section 6](#6-doflashdfu) |
| `Close` | Closes modal. Flash button in main UI is now enabled. |

---

### 5A-iii. No compile exists (either `autoFlash` value)

**Log appended:**
```
Verify your configuration and compile to flash the board.
```

**Status bar:** `Connection successful.`

**Buttons visible:**
| Button | Action |
|--------|--------|
| `Close` | Closes modal. Flash button disabled in main UI. |

---

## 5B. Fix DFU Driver — No Driver Installed

Reached when: poll finds `found: true, accessible: false` in `isRetry=false` mode (driver never installed).

**Modal title:** `Fix DFU Driver` *(amber/warning color)*
**Status bar:** `Windows driver required`
**Progress bar:** Error (red)

**Log shown to user:**
```
A Windows driver is required to communicate with the STM32 Bootloader.

  Detected: STM32 Bootloader (0483:df11)

JMT Studio will download the official Proffie DFU setup tool and run
it unchanged. You will be asked by Windows before anything is installed.

Click Download DFU Tool, or use a manual option below.
```

**Footer note (small text):**
> DFU/Bootloader mode setup varies by system. We've done our best to simplify this process — [share your feedback](#) to help us improve it.
> *(clicking "share your feedback" opens a pre-addressed email to jmtstudio@jedimastertech.com)*

**Buttons visible:**
| Button | Action |
|--------|--------|
| `⬇ Download DFU Tool` | Phase 1: download → [Section 5B-1](#5b-1-phase-1-download) |
| `Cancel` | Closes modal. DFU mode stays active. |

**Secondary row (manual options):**
| Link | Destination |
|------|------------|
| `Proffieboard Setup Tool` | Opens proffieboard-setup.html#os-specific-setup in browser |
| `Zadig` | Opens zadig.akeo.ie in browser |

*(Mac/Linux: download and manual buttons are hidden; log shows "DFU device found but could not be opened. Check USB permissions and reconnect the board.")*

---

### 5B-1. Phase 1: Download

User clicked `⬇ Download DFU Tool`.

**Button changes to:** `Downloading...` (disabled)
**Manual row:** hidden
**Cancel:** hidden

**Log appended:**
```
──────────────────────────────────
Downloading proffie-dfu-setup.exe from fredrik.hubbe.net...
```

#### Download success:
**Log appended:**
```
✓ proffie-dfu-setup.exe downloaded.

  Windows will ask for permission to run the installer — click Yes.
Click Install DFU Tool to continue.
```

**Button changes to:** `▶ Install DFU Tool`
**Manual row:** shown again
**Cancel:** shown again

→ User clicks `▶ Install DFU Tool` → [Section 5B-2](#5b-2-phase-2-install)

#### Download failure:
**Log appended:**
```
[error message from system]
Try a manual option below, or check your internet connection.
```

**Button resets to:** `⬇ Download DFU Tool`
**Manual row:** shown
**Cancel:** shown

---

### 5B-2. Phase 2: Install

User clicked `▶ Install DFU Tool`.

**Button changes to:** `Installing...` (disabled)
**Status bar:** `Installing driver...`
**Manual row:** hidden
**Cancel:** hidden
**Progress bar:** Knightrider animation

**Log appended:**
```
──────────────────────────────────
Running proffie-dfu-setup.exe...
```

*(Windows UAC prompt appears — user must click Yes)*
*(Installer file is deleted from temp after this step, regardless of success or failure)*

#### Install success:
**Log appended:**
```
✓ Driver installed successfully.
Waiting for Windows to register the driver...
```

*(2-second pause while Windows processes the driver)*

**Log appended:**
```
──────────────────────────────────
Verifying DFU connection...
```

**Status bar:** `Verifying connection...`

→ Re-enters poll loop with `isRetry=true` → see [Section 4 — Poll Loop (isRetry=true)](#poll-loop-isretrytrue)

- If poll succeeds → [Section 5A — DFU Device Ready](#5a-dfu-device-ready) (with original `autoFlash` intent preserved)
- If 10s grace expires → [Section 5C — Fix DFU Driver (driver pending)](#5c-fix-dfu-driver--driver-pending)

#### Install failure (user clicked No on UAC, or error):
**Log appended:**
```
[blank line]
Installation was cancelled or failed.
Click Download DFU Tool to try again, or use a manual option below.
```

**Button resets to:** `⬇ Download DFU Tool`
**Manual row:** shown
**Cancel:** shown

---

## 5C. Fix DFU Driver — Driver Pending

Reached when: `isRetry=true` poll found `found: true, accessible: false` for more than 10 seconds (driver was installed but Windows hasn't bound it to the device yet).

**Modal title:** `Fix DFU Driver` *(amber/warning color)*
**Status bar:** `Driver pending — replug board`
**Progress bar:** Error (red)

**Log shown to user:**
```
The driver was installed but Windows has not activated it yet.

  Detected: STM32 Bootloader (0483:df11)

Unplug the board, reconnect it in Bootloader Mode, then click Try Again.
If it still fails, use Download DFU Tool or a manual option below.
```

**Footer note (small text):**
> DFU/Bootloader mode setup varies by system. We've done our best to simplify this process — [share your feedback](#) to help us improve it.

**Buttons visible:**
| Button | Action |
|--------|--------|
| `↺ Try Again` | Re-polls without re-downloading → `startDfuWaitModal(isRetry=true, autoFlash=<preserved>)` |
| `Cancel` | Closes modal. DFU mode stays active. |

**Secondary row (manual options):**
| Link | Destination |
|------|------------|
| `Proffieboard Setup Tool` | Opens proffieboard-setup.html#os-specific-setup in browser |
| `Zadig` | Opens zadig.akeo.ie in browser |

**Note:** "⬇ Download DFU Tool" is NOT shown here — the driver is already installed; re-downloading is not the right next step.

---

## 6. `doFlashDFU()`

Triggered by: Flash button click in DFU mode, or `autoFlash=true` after device detection.

### Guard checks (silent, no modal):
| Condition | Result |
|-----------|--------|
| Already busy (compile/flash running) | Returns immediately, nothing happens |
| No compiled firmware (`compileSuccess=false`) | Log entry: `Compile first before flashing.` Returns. |

### Device readiness check:

| `dfuDeviceReady` | Live `detectDFU()` result | Action |
|-----------------|--------------------------|--------|
| `false` | — | `startDfuWaitModal(isRetry=false, autoFlash=true)` — show boot instructions, wait, then auto-flash |
| `true` | `found: false` | `dfuDeviceReady = false` → `startDfuWaitModal(isRetry=false, autoFlash=true)` — board gone, show boot instructions |
| `true` | `found: true, accessible: false` | `dfuDeviceReady = false` → `startDfuWaitModal(isRetry=true, autoFlash=true)` — driver issue, skip instructions |
| `true` | `found: true, accessible: true` | Proceed to flash ↓ |

### Flash modal:

**Modal title:** `⚡ Flashing (DFU)...`
**Status bar:** `Uploading firmware...`
**Port status:** `Flashing via DFU...`
**Progress bar:** Flash animation
**Flash timer:** starts
**Log:** cleared, then filled by `dfu-util` output streamed from main process

**Buttons visible:** none during flash

---

## 7. After Flash — `onBuildDone`

### Flash success:

**Modal title:** `✓ Flash Complete` *(or equivalent success title)*

Calls `watchForSerialAfterDfu()` — polls `getRecommendedPort()` every 500ms for up to 10 seconds looking for the board on a serial port.

**Status bar:** `Board is back online.`

**Log appended:**
```
✓ Board restarted on [COM port].
```

Modal auto-closes after 1.5 seconds. `exitDfuMode()` is called:
- DFU mode indicator hidden
- Normal port UI restored
- Port selector updated with the newly-detected Proffieboard port (preferring a port that wasn't present before the DFU flash)
- `lastFlashedSN` updated to the new board's serial number

**If board is NOT detected within 10 seconds:**

**Status bar:** `Flash complete — board not yet detected. Try power cycling.`

**Log appended:**
```
Board not detected after restart. Try power cycling or reconnecting.
```

Modal stays open. User can close manually.

### Flash failure:

**Modal title:** `✗ Flash Failed`
**Progress bar:** Error (red)
**Status bar:** error message from `dfu-util` (e.g., `No DFU device found. Board may not be in bootloader mode.`)

**Buttons visible:**
| Button | Action |
|--------|--------|
| `↺ Retry Flash` | Closes modal → `doFlash()` → `doFlashDFU()` → live check → retry |
| `Close` | Closes modal. DFU mode stays active. |

---

## 8. Exiting DFU Mode

DFU mode is exited **only** via:

| Trigger | How |
|---------|-----|
| `exitDfuMode()` called after successful flash | Automatic, 1.5s after board detected on serial |
| User clicks **"Exit DFU"** button in main UI | Manual, always available while in DFU mode |

**What happens on exit:**
- `isDfuMode = false`, `dfuDeviceReady = false`
- DFU indicator hidden, normal port UI restored
- `refreshPorts()` runs to re-populate port selector
- Flash button disabled until a port is selected and compile state is valid

**Modal close (X or Cancel) does NOT exit DFU mode** — the user stays in DFU mode and can return to the flash flow later.

---

## State Preserved Across Modal Opens/Closes

| State | Persists |
|-------|----------|
| `isDfuMode` | Yes — stays true until Exit DFU or successful flash |
| `dfuDeviceReady` | Yes — reset only on live-check failure or `exitDfuMode()` |
| `compileSuccess` | Yes — carry-over from prior compile session |
| `_dfuRetryAutoFlash` | Yes — set when driver-fix screen opens, used by install handler and Try Again |
| `_portsBeforeDfu` | Set on DFU entry, cleared after `watchForSerialAfterDfu()` completes |
