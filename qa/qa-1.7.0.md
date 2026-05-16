# JMT Studio v1.7.0 — Full QA Test Plan

**Version:** 1.7.0  
**Tester:** Ryan Taylor  
**Date:** 5.10.26  
**Platform / OS:** Windows 11 Pro  
**Build type:** Dev / Production

Mark each test: ✅ Pass · ❌ Fail · ⏭ Skip (note reason)  
Log failures in the **Bug Log** at the bottom with TC reference.

---

## Features in this release

- **New Config** — `+ New` toolbar button and `Create New Config` empty-state button; editable filename until first save; favorites blocked until saved
- **Smart background port polling** — main process polls `SerialPort.list()` every 4.5 s, signals renderer on change; tab-aware and window-aware (stops on blur, restarts on focus)
- **Preset navigation arrows** — ◁ ▷ buttons in the preset detail pane header
- **System theme default** — default appearance is now "System" instead of "Dark"
- **`checkArduinoRunning` macOS/Linux fix** — `ps aux` branch added for non-Windows
- **Mac packaging** — proper notarization via `afterSign` script; arch-aware updater (Intel vs Apple Silicon); non-Windows users redirected to download site for updates
- **Linux packaging** — first-class `.deb` package alongside AppImage; no-space install path; auto-set chrome-sandbox permissions; full icon pipeline (hicolor sizes)
- **Linux DFU** — bundled dfu-util 0.11 with libusb; udev rules guidance matching pod.hubbe.net; copy-commands button; manual reboot flow
- **DFU/compile fixes** — `selectedFqbn` seeded on init; cache check on DFU entry; DFU sentinel written even with no ports; `getArduinoDataPath` cross-platform
- **Config scaffolding** — Add Preset and Link Style Library both create `#ifdef CONFIG_PRESETS` / `#endif` scaffolding when missing; bare `Preset` blocks get wrapped automatically; either order (link-first or preset-first) works
- **Link Style Library — undoable** — wrap + include insert is now a single undoable Monaco edit
- **Style Library search expansion** — search now matches inside style code, notes, and URL (was metadata-only)
- **About → Tip Jar** — new Ko-fi link in About modal
- **OS Versions → "Learn more"** — link to jedimastertech.com/jmt-addons below the Add JMT Features / Check for Updates button
- **Monaco icon font fix** — `codicon.ttf` now bundled correctly; diff revert arrow and other Monaco glyphs render properly (no tofu)
- **Preset array name in sidecar** — vertical strip label reflects the actual `Preset NAME[]` identifier from source (uppercased); was hardcoded "PRESETS"
- **Rename preset array via pencil** — ✎ button next to the sidecar `×` opens an inline rename input below the header; Enter/✓ commits an undoable single-token rename of the `Preset NAME[]` declaration; Escape/✕/blur cancels; space → `_` like the Style Library name fields
- **Multiple preset banks in strip** — vertical strip renders one label per `Preset NAME[]` array, thin divider between labels, active bank highlighted in JMT blue; click a bank to switch (or close sidecar if clicking the active one); `+` button below the labels creates a new bank (next available `presetsN`) and drops straight into rename mode
- **Parser accepts empty `Preset NAME[]` blocks** — content-based filter relaxed for arrays declared with the literal `Preset` type so newly-created empty banks show up in the strip immediately
- **Right-click bank label** — hidden context menu (same styling as the preset-row menu) with `⧉ Duplicate` and `× Delete`. Both actions are single undoable Monaco edits. Delete shows a native confirm with the bank name and preset count.
- **In-app confirm modal** — new reusable `promptConfirm({title, message, confirmText, confirmKind})` matching the app's modal styling; replaces all `window.confirm()` callsites in the renderer (bank delete, style delete, helper delete, style library removal)
- **Link JMT Add-ons** — new toolbar button alongside `Link Style Library`; shows only when the selected OS version has JMT installed (`.jmt_meta.json → jmtVersion`) and the config doesn't already include `jmt_fett263_wrapper.h`. Clicking inserts the wrapper include in `CONFIG_PROP` (creates the block if missing), with the same Cancel / Comment Out / Remove It conflict modal pattern used for `my_styles.h` when another prop include is present. Single undoable Monaco edit.
- **Named-color slot fix** — slots with built-in ProffieOS colors (`Black`, `Red`, `Cyan`, etc. — see `NAMED_COLORS` in `effect-args.js`) no longer get the misleading "library not linked" warning; reclassified as `slot-inline` instead of `slot-helper`
- **Linux serial permission notice** — when a Proffieboard is detected at the USB layer but serial access is blocked (user not in `dialout` group), a yellow banner appears with a `Copy Commands` button that copies `sudo usermod -aG dialout $USER` to clipboard. Driven by new `checkLinuxUsbPresence()` in `portDetector.js` reading `/sys/bus/usb/devices`.
- **First-run toolchain setup transparency** — on first launch (or when the bundled core version changes), the build output panel auto-opens and a blue notice ("First-time setup: downloading and installing required build tools...") is shown. Hides automatically when toolchain is ready. Driven by `needsCoreInstall()` sentinel in `toolchain.js`.
- **`portDetector.js` JSON refactor** — switched from hand-rolled regex parsing of tabular `arduino-cli board list` output to the `--json` flag with structured parsing. Closes the "regex fragile" backlog item.
- **Touch reset error path — retriable with hedged hint** — `touchReset` in `toolchain.js` now tags failures with a `cause` (`'port-locked'` vs `'driver'`). Driver-layer failures (e.g. Windows `SetCommState` error 121, often a flaky USB cable, marginal USB port, or wedged COM driver) are now retriable and emit a softly-worded suggestion in the build log; the modal subtitle hints at trying a different cable/port before pressing the reset button. Existing port-locked path (Arduino IDE detection) is unchanged.
- **DFU auto-recovery after touch reset** — when touch reset succeeds (board enters DFU) but `waitForDfu` can't reach the device, `flash` in `toolchain.js` now calls `detectDFU` and: if accessible (late race) → proceeds to flash; otherwise returns `needsDfuDriver: true`. The renderer detects the flag in `onBuildDone`, switches to DFU mode UI, and opens the bootloader-wait modal in `isRetry=true, autoFlash=true` mode — driver install flow with no boot instructions (board's already in DFU), and the flash continues automatically once the driver binds. Recovers the common "WinUSB not bound on this USB port" case without dead-ending the user.
- **Style Library — Charging Styles section** — third file section alongside Helper functions and Using styles. Entries whose using-code references any JMT-dependent symbol (currently `ChargeFullPropF`, single source of truth at `_SL_JMT_DEPENDENT_SYMBOLS`) are auto-classified as `isCharging` and emitted inside the section, which is wrapped in `#ifdef FUNCTIONS_CHARGE_FULL_PROP_H` / `#endif`. Configs without the JMT functions include compile cleanly (preprocessor skips the block); configs with it pick up the styles. Existing libraries migrate automatically on next save or load via the same machinery that organizes helpers today.

---

## 35. NEW CONFIG FLOW

### 35.1 Entry points

- [x] TC-464: Empty state (no file open) shows a `+ Create New Config` button below the `Open Config File` button ✅
- [x] TC-465: `+ New` button is visible in the toolbar at all times (file open or not) ✅
- [x] TC-466: Both empty-state buttons (`Open Config File` and `+ Create New Config`) are equal width ✅

### 35.2 Entering new-config state

- [x] TC-467: Click `+ New` with no file open → editor clears, filename field becomes editable (no readonly attr, blue editing state visible) ✅
- [x] TC-468: Click `+ Create New Config` with no file open → same result as TC-467 ✅
- [x] TC-469: Click `+ New` with a file open and no unsaved changes → editor clears, filename field editable; no dialog ✅
- [x] TC-470: Click `+ New` with unsaved changes → "Unsaved Changes" modal appears; Cancel → returns to current file unchanged ✅
- [x] TC-471: Click `+ New` with unsaved changes → modal → Discard → enters new-config state, editor clears ✅
- [x] TC-472: Click `+ New` with unsaved changes → modal → Save → saves current file, then enters new-config state ✅
- [x] TC-473: In new-config state, filename field has placeholder hint text (not the previous file's name) ✅
- [x] TC-474: In new-config state, filename field text is selected/focused immediately so the user can just start typing ✅

### 35.3 Favorites blocked until saved

- [x] TC-475: In new-config state (unsaved), the Favorites star (★) is not interactive / shows as disabled ✅
- [x] TC-476: Hovering the star in new-config state does not show a click affordance ✅
- [x] TC-477: After first save, the star becomes interactive and can favorite the new file ✅

### 35.4 First save via doSaveAs

- [x] TC-478: In new-config state, type a filename (e.g. `my_saber`) in the filename field; click Save → native Save As dialog opens, pre-populated with `my_saber.h` ✅
- [x] TC-479: Cancel the Save As dialog → file is not saved, remains in new-config state with typed name preserved ✅
- [x] TC-480: Complete the Save As dialog → file is saved, window title updates to filename, filename field reverts to readonly mode ✅
- [x] TC-481: After first save, Ctrl+S saves directly (no dialog) as expected ✅
- [x] TC-482: If filename field is left empty and Save is clicked → Save As dialog opens with a blank/default pre-fill (no crash) ✅

### 35.5 Filename field state transitions

- [x] TC-483: Clicking a recent file in the dropdown while in new-config state opens that file and restores the filename field to readonly mode ✅
- [x] TC-484: Clicking a favorites card while in new-config state (unsaved) → unsaved guard fires (editor has content); proceed → opens favorite ✅
- [x] TC-485: After saving a new config, the filename field is readonly; clicking it opens the recent files dropdown as normal ✅
- [x] TC-486: After saving a new config, the `.editing` class is removed from the filename wrapper (no leftover blue editing styling) ✅

### 35.6 New config + editor integration

- [x] TC-487: New config state → editor is empty and editable (can type) ✅
- [x] TC-488: New config state → editing the editor marks file as dirty (● in title bar) ✅
- [x] TC-489: New config state → close (X) → unsaved guard fires if any content was added ✅
- [x] TC-490: New config state → close (X) with no edits made → closes cleanly without guard ✅
- [ ] TC-490a: After a successful compile of file A, click `+ New` → re-select the board → pick an OS version → type content → Compile button becomes enabled (status shows "Not compiled" or "Config changed — recompile needed", NOT stuck "Board changed — recompile needed" with disabled button) — regression for BUG-005

---

## 36. BACKGROUND PORT POLLING

> These tests cover the new main-process polling system added in 1.7.0.  
> Two polling systems exist: **background** (main.js, `SerialPort.list()`, 4.5 s interval) and  
> **wait-flash** (buildPanel.js, 1 s interval, only active during post-compile board wait).  
> These tests cover the **background** system only. Flash-watcher regressions are in Section 37.

### 36.1 Baseline: tab-aware polling

- [x] TC-491: Launch app → no background port detection runs before Config Manager tab is active *(plug/unplug while on Versions or Style Library does not refresh the port list)* ✅
- [x] TC-492: Switch to Config Manager tab → port list reflects current ports; an unplug or plug from this point forward is detected within ~5 s without a manual refresh ✅
- [x] TC-493: Switch to OS Versions tab → from that point onward, plug/unplug does not refresh the port list ✅
- [x] TC-494: Switch back to Config Manager → port list snaps to current state immediately (no waiting for the next poll tick) ✅
- [x] TC-495: Switch to Style Library tab → same: polling pauses; switch back → immediate refresh on return ✅

### 36.2 Baseline: window-aware polling

- [x] TC-496: With Config Manager tab active, background the app (click away) → polling stops; plug/unplug while backgrounded is not detected in real time ✅
- [x] TC-497: Foreground the app (click JMT Studio) → port list immediately reflects current state and resumes detecting changes ✅
- [x] TC-498: Background app on non-config tab → no detection (was already stopped by tab switch) ✅
- [x] TC-499: Background app, switch tabs to Config Manager (while still backgrounded) → polling does NOT start (window not focused) ✅
- [x] TC-500: Foreground app while on Config Manager tab → port list immediately reflects current state and resumes detecting changes ✅

### 36.3 Board connect detection

- [x] TC-501: Config Manager active, app focused, no board connected → plug in board → port list refreshes automatically, board appears in port dropdown without manual refresh ✅
- [x] TC-502: After auto-detect in TC-501 → port dropdown shows the new device with its expected SN/path; status row updates accordingly ✅
- [x] TC-503: Config Manager active, app focused, no board for an extended period (>30 s) → no spurious port list updates, no false-positive board notifications ✅

### 36.4 Board disconnect detection

- [x] TC-504: Config Manager active, app focused, board connected → unplug board → port list refreshes automatically, board disappears from dropdown ✅
- [x] TC-505: After auto-detect in TC-504 → status indicators clear (Detected/SN), Compile button reflects the no-board state ✅

### 36.5 Tab-switch combos with board state change

- [x] TC-506: Config Manager active, board connected → switch to OS Versions tab → unplug board (polling stopped) → switch back to Config Manager → board is immediately detected as gone (immediate poll on tab return) ✅
- [x] TC-507: OS Versions tab active, no board → plug in board → switch to Config Manager → board is immediately detected as present ✅
- [x] TC-508: Style Library tab active, board connected → unplug → switch to Config Manager → board gone detected immediately ✅
- [x] TC-509: Config Manager tab → blur app → unplug board (no polling active) → focus app → board gone detected immediately ✅

### 36.6 Focus/blur combos with board state change

- [x] TC-510: Config Manager active, focused, board connected → blur app → unplug board → focus app → board gone detected immediately (immediate poll on focus) ✅
- [x] TC-511: Config Manager active, focused, no board → blur app → plug in board → focus app → board detected immediately ✅
- [x] TC-512: No polling occurs while app is backgrounded — plug/unplug while blurred is NOT detected in real time; only detected after foregrounding ✅

### 36.7 Combined tab + blur combos

- [x] TC-513: Config Manager active → blur → switch to Versions tab (still blurred) → plug in board → focus app (still on Versions tab) → polling does NOT start (on Versions tab, not config) → switch to Config Manager → board detected immediately ✅
- [x] TC-514: Versions tab active → switch to Config Manager (gains polling) → blur (stops) → focus (restarts) → unplug board → detected immediately ✅

### 36.8 Rapid board changes

- [x] TC-515: Plug in board, immediately unplug before next poll tick → next poll detects final state (no board), no crash or stuck state ✅
- [x] TC-516: Unplug board, immediately plug back in before next tick → port list reflects current state after next poll ✅

### 36.9 Multiple boards

- [x] TC-517: Connect two Proffieboards → both appear in port dropdown ✅
- [x] TC-518: Unplug one of two boards → port list updates to show only the remaining board ✅

### 36.10 Polling does not interfere with compile/flash

- [x] TC-519: Start a compile → background polling continues in main process independently; compile is not affected ✅
- [x] TC-520: During flash (wait-flash watcher active) → background polling is still running; no port-list conflict or crash ✅

---

## 37. WAIT-FLASH PORT WATCHER — REGRESSION

> The `'monitor'` context was removed. Only `'wait-flash'` context remains.

- [x] TC-521: Compile successfully, then connect board when prompted → wait-flash watcher detects board, flash proceeds automatically ✅
- [x] TC-522: Compile finishes with no board → wait-flash watcher engages (board prompt shown); board appears → flash begins automatically (no manual click) ✅
- [x] TC-523: Compile successfully, disconnect board mid-wait (board was there, went away) → watcher continues waiting; reconnect → flash proceeds ✅
- [x] TC-524: Abort post-compile wait (close modal or cancel) → wait-flash watcher stops cleanly; reopening compile flow starts a fresh watcher only when the no-board branch is hit again ✅
- [x] TC-525: After flash completes, no residual port-watcher activity (plug/unplug after flash does not trigger a phantom flash retry) ✅
- [ ] TC-525a: Trigger a flash failure that causes the wait-flash watcher to auto-retry (e.g. flaky touch reset, board disconnect during flash) → on each retry attempt the build modal log clears to show only the CURRENT attempt's output (no piled-up prior-attempt errors above the new "--- Flash started ---"); persistent build-output panel below the editor still preserves the full history — regression for BUG-006

---

## 38. PRESET NAVIGATION ARROWS

- [x] TC-526: Open a config with at least 3 presets; select the **first** preset → ◁ button is disabled, ▷ button is enabled ✅
- [x] TC-527: Select the **last** preset → ◁ enabled, ▷ disabled ✅
- [x] TC-528: Select a **middle** preset → both ◁ and ▷ are enabled ✅
- [x] TC-529: Click ▷ from first preset → detail pane updates to second preset; second preset is scrolled into view in the list ✅
- [x] TC-530: Click ◁ from second preset → detail pane returns to first preset; first preset scrolled into view ✅
- [x] TC-531: Hold-click ▷ through all presets in sequence → each preset loads in order; ▷ disables on the last one ✅
- [x] TC-532: Config with exactly 1 preset → both ◁ and ▷ are disabled ✅
- [x] TC-533: After navigating away with arrows, clicking a preset directly in the sidecar list still selects it correctly ✅
- [x] TC-534: Nav arrows appear in the detail pane header (not the sidecar list rows) ✅

---

## 39. THEME DEFAULT (SYSTEM)

- [x] TC-535: Clear theme preference (`localStorage.removeItem('jmt-theme')` in DevTools) → restart or reload app → theme applied matches OS preference (dark if OS is dark, light if OS is light) ✅
- [x] TC-536: OS set to dark mode, no saved theme preference → app launches in dark mode ✅
- [x] TC-537: OS set to light mode, no saved theme preference → app launches in light mode ✅
- [x] TC-538: Choose "Dark" explicitly in Settings → preference saved; app stays dark even if OS is light ✅
- [x] TC-539: Choose "System" in Settings after previously choosing Dark → app immediately follows OS preference; preference saved ✅
- [x] TC-540: Theme preference persists across restart when explicitly set (Dark, Light, or System) ✅

---

## 40. checkArduinoRunning — macOS / Linux

> The Windows `tasklist` path is regression-tested separately (TC-545). These cover the new `ps aux` branch and the EBUSY detection.

- [ ] TC-541: *(macOS)* Arduino IDE Serial Monitor open → attempt flash → app correctly detects Arduino is running and shows the "Arduino IDE is open" warning, prevents flash
- [ ] TC-542: *(macOS)* Arduino IDE not running → attempt flash → flash proceeds normally, no false "Arduino running" warning
- [ ] TC-543: *(macOS)* `ps aux` call times out (simulated by a 3 s+ process) → `checkArduinoRunning` returns `false`, flash is not blocked
- [ ] TC-544: *(macOS)* EBUSY / "resource busy" error during flash → app shows a meaningful "port busy" message rather than a raw error
- [x] TC-545: *(Windows)* Existing `tasklist` behavior unchanged — plug in board, compile, flash → no regression ✅

---

## 41. REGRESSION — EXISTING FEATURES

### File operations

- [x] TC-546: Open an existing `.h` config → loads normally; filename field is readonly *(new-config state should not affect normal open)* ✅
- [x] TC-547: Save an existing file (Ctrl+S) → saves without dialog; no regression from doSave / doSaveAs refactor ✅
- [x] TC-547a: Save button mirrors dirty state — disabled (35% opacity, not-allowed cursor) when no unsaved changes; enabled on any edit; disabled again after Save commits. Same signal as the bottom-bar `●` dot. Save As stays always-enabled. ✅
- [x] TC-548: Recent files dropdown still opens from filename field click *(editing state should not be active for normal files)* ✅
- [x] TC-549: Relaunch app → last-used config is restored; editor content correct ✅

### Favorites

- [x] TC-550: Favorite an existing open file → star fills; favorites dropdown shows the file *(regression: favorites star not blocked for already-saved files)* ✅
- [x] TC-551: Unfavorite an existing file → star empties; file removed from dropdown ✅

### Build / Compile

- [x] TC-552: Compile a valid config → builds successfully ✅
- [x] TC-553: Compile fails → error shown in build log; retry or fix-and-recompile works ✅

### Flash — serial

- [x] TC-554: Flash to board with board already connected → flash completes ✅
- [x] TC-555: Flash with no board → wait prompt shown; connect board → auto-detected, flash proceeds ✅

### Flash — DFU

- [x] TC-556: DFU compile → compile completes → app correctly proceeds to DFU flash flow *(not "Connect your Proffieboard")* ✅

### Port dropdown — manual

- [x] TC-557: Refresh button in port area still works → port list updates manually ✅
- [x] TC-558: Port dropdown still shows detected boards correctly ✅

### Theme

- [x] TC-559: Dark mode → all panels, modals, buttons readable *(regression: no broken styles from theme-default change)* ✅
- [x] TC-560: Light mode → all panels readable ✅

### Preset sidecar — existing behavior

- [x] TC-561: Click a preset in the sidecar list → detail pane opens *(regression: nav arrows should not interfere with direct selection)* ✅
- [x] TC-562: Add a new preset → detail pane opens for the new preset; nav arrows update (new preset is last → ▷ disabled) ✅
- [x] TC-563: Delete a preset that is currently shown in detail pane → detail pane closes or moves to adjacent preset cleanly ✅
- [x] TC-564: With detail pane open, drag-reorder presets in the list → detail pane closes or updates correctly; nav arrows reflect new position ✅

---

## 42. MAC PACKAGING & UPDATER

### 42.1 Notarization

- [ ] TC-565: *(Mac)* Download the signed `.dmg` from the release page → open → drag to Applications → launch → **no** "unidentified developer" warning, no Gatekeeper block
- [ ] TC-566: *(Mac)* `spctl -a -vv "/Applications/JMT Studio.app"` reports `accepted`, source `Notarized Developer ID`
- [ ] TC-567: *(Mac)* Build pipeline log shows `afterSign` script ran and notarization submission succeeded *(verify in CI / build output)*

### 42.2 Arch-aware updater

- [ ] TC-568: *(Mac Intel)* App detects update available → downloads x64 binary, not arm64
- [ ] TC-569: *(Mac Apple Silicon)* App detects update available → downloads arm64 binary, not x64
- [ ] TC-570: *(Mac)* After update download, install proceeds and app relaunches into new version

### 42.3 Non-Windows update redirect

- [ ] TC-571: *(Mac)* When a major update is offered, app redirects user to the download site rather than auto-installing *(if that's the policy for non-Windows)*
- [ ] TC-572: *(Linux)* Same redirect behavior — clicking update opens the download page in browser
- [x] TC-573: *(Windows)* Auto-update still works as before — no regression from the non-Windows branch ✅ *(tested via package.json temp-downgrade to 1.6.4; flow surfaced BUG-002 install-button-unclickable and BUG-003 double unsaved-changes prompt, both fixed during the run; verified end-to-end after fixes — download, install, NSIS wizard, relaunch into installed 1.6.5; package.json reverted to 1.7.0)*

---

## 43. LINUX PACKAGING

### 43.1 .deb install

- [ ] TC-574: *(Linux)* `sudo dpkg -i jmt-studio_*.deb` → installs without errors; no script failures during `afterInstall`
- [ ] TC-575: *(Linux)* App appears in application menu as "JMT Studio" (with space in display name, despite no-space install path)
- [ ] TC-576: *(Linux)* Install path is space-free (e.g. `/opt/jmt-studio` or similar) — verify zygote launches without error
- [ ] TC-577: *(Linux)* `chrome-sandbox` SUID bit set after install (`ls -l /opt/.../chrome-sandbox` shows `4755`); app launches without `--no-sandbox`
- [ ] TC-578: *(Linux)* `sudo apt remove jmt-studio` → cleanly uninstalls; no orphan files in `/opt`

### 43.2 AppImage

- [ ] TC-579: *(Linux)* Launch AppImage via double-click or `./JMTStudio*.AppImage` → starts without sandbox errors
- [ ] TC-580: *(Linux)* AppImage runs on a distro where chrome-sandbox is restricted (e.g. recent Ubuntu) — `--no-sandbox` config takes effect

### 43.3 Icon pipeline

- [ ] TC-581: *(Linux)* Window icon shows the JMT Studio logo (not the default Electron icon)
- [ ] TC-582: *(Linux)* Application menu / taskbar icon shows the JMT Studio logo
- [ ] TC-583: *(Linux .deb)* After install, icons exist at standard hicolor sizes (`/usr/share/icons/hicolor/{16,32,48,64,128,256,512}x{16,32,48,64,128,256,512}/apps/jmt-studio.png`)
- [ ] TC-584: *(Linux .deb)* After uninstall, hicolor icons are removed cleanly

### 43.4 Display name vs install path

- [ ] TC-585: *(Linux)* Title bar shows "JMT Studio" with space; `package.json` `productName` is the space version where it should be, no-space where it needs to be (install path)
- [x] TC-586: *(Windows)* Same display name "JMT Studio" — no regression from the per-platform productName change ✅ *(verified throughout session — title bar, taskbar, NSIS installer wizard, Start Menu and Desktop shortcuts all read "JMT Studio")*
- [ ] TC-587: *(Mac)* Same display name "JMT Studio" — no regression

---

## 44. LINUX DFU

### 44.1 dfu-util bundle

- [ ] TC-588: *(Linux)* Bundled `dfu-util` is executable (`ls -l` shows `x` bits); runs without "permission denied"
- [ ] TC-589: *(Linux)* Bundled `libusb-1.0.so.0` is present in the same directory and loaded at runtime (`LD_LIBRARY_PATH` set correctly in toolchain.js)
- [ ] TC-590: *(Linux)* `dfu-util --version` invoked by app reports version 0.11

### 44.2 udev rules flow

- [ ] TC-591: *(Linux)* On first DFU attempt with no udev rules → app shows udev rules guidance matching pod.hubbe.net format
- [ ] TC-592: *(Linux)* "Copy Commands" button copies the chained `&&` command (single line) to clipboard
- [ ] TC-593: *(Linux)* Pasted command into terminal → installs `50-proffieboard.rules`, reloads udev; no syntax errors from the `&&` chain
- [ ] TC-594: *(Linux)* After udev rules install, "Reboot required" status shown; user reboots manually
- [ ] TC-595: *(Linux)* "Try Again" button is **hidden** during the reboot-required state (replaced by reboot guidance)
- [ ] TC-596: *(Linux)* After manual reboot, returning to app and entering DFU works without re-prompting for udev rules

### 44.3 DFU flash on Linux

- [ ] TC-597: *(Linux)* Compile a config → board in DFU → flash succeeds with bundled dfu-util
- [ ] TC-598: *(Linux)* Flash log shows clean download lines (terminal emulator works on Linux too)
- [ ] TC-599: *(Linux)* After flash, board reappears on serial; DFU mode exits automatically

---

## 45. DFU & COMPILE FIXES — Cross-platform

### 45.1 selectedFqbn seeding

- [x] TC-600: Open a config with Board set to Proffieboard V3 → on init, `selectedFqbn` is set from the board dropdown immediately (not undefined) → compile works without first changing the board dropdown ✅
- [x] TC-601: Change board dropdown to V2 → `selectedFqbn` updates; compile uses V2 FQBN ✅
- [x] TC-602: Open a config with Board set to "original" → `selectedFqbn` seeded correctly; compile targets the right toolchain ✅

### 45.2 Cache check on DFU entry

- [x] TC-603: Compile a config (cache miss → real build) → enter DFU mode → cache hit check runs; if cache is valid, flash proceeds without re-compile ✅
- [x] TC-604: Compile, enter DFU, exit DFU, re-enter DFU → cache hit still works; no race condition between cache check and flash start ✅
- [x] TC-605: Compile button state correct on DFU entry — not stuck disabled, reflects whether cache is valid ✅

### 45.3 DFU sentinel

- [x] TC-606: With **no ports detected** at all, enter DFU mode → sentinel file is still written so DFU flow can proceed ✅
- [x] TC-607: With one or more ports detected, enter DFU mode → sentinel written normally (no regression) ✅

### 45.3a Touch-reset → DFU auto-recovery (BUG-004)

> Repro setup: Device Manager → Universal Serial Bus devices → DFU device (VID 0483 PID DF11, visible only when board is in DFU) → Uninstall device with "Delete the driver software" → unplug → replug in CDC mode (no BOOT/RESET).

- [x] TC-610a: With WinUSB driver unbound for the DFU device, click Flash from a compiled config → touch reset succeeds → `waitForDfu` times out → app does NOT show "Flash Failed" dead-end → app auto-transitions to DFU mode UI (port elements hidden, DFU indicator shown) and opens the Bootloader Mode driver-install modal in `isRetry` mode (no BOOT/RESET instructions shown — board is already in DFU) ✅
- [x] TC-610b: From the recovery modal, click "Install DFU Tool" → driver installs → `detectDFU` flips to `found && accessible` → `doFlashDFU` fires automatically (autoFlash=true) → firmware uploads → board reboots and reappears on COM ✅
- [x] TC-610c: Recovery does NOT trigger in the late-race success case — if `detectDFU` returns `accessible: true` between `waitForDfu` giving up and the disambiguation call, app logs "DFU device detected (late). Proceeding with flash." and runs the flash directly without showing the recovery modal
- [x] TC-610d: Cancel button in the recovery modal aborts cleanly — app stays in DFU mode UI, no orphan state; user can compile and Flash again to re-trigger
- [x] TC-610e: Existing `_checkDfuOnEntry` path (user clicks Bootloader Mode entry manually) still uses its original `startDfuWaitModal(true, false)` call — `autoFlash=false` preserved; refactor to extract `_setupDfuModeUI` didn't regress this flow ✅

### 45.4 getArduinoDataPath

- [x] TC-608: Open Settings → cache size shown correctly (proves `getArduinoDataPath` returned a valid path on this platform) ✅
- [ ] TC-609: *(Linux/Mac)* `getArduinoDataPath` handler no longer throws "os is not defined" — Settings → cache size displays without error
- [x] TC-610: Clear Cache → cache is cleared at the correct platform-appropriate path (verify via Settings size dropping to 0 B) ✅ *(verified: 121.1 MB freed, label changed to "(empty)")*

---

## 46. CONFIG SCAFFOLDING & LINK STYLE LIBRARY — NEW CONFIG WORKFLOW

### 46.1 Add First Preset — no `Preset` block, no `#ifdef CONFIG_PRESETS`

- [x] TC-611: Brand-new (blank) config → click `+` Add Preset → file gets a `#ifdef CONFIG_PRESETS` / `Preset presets[] = { ... };` / `#endif` block appended at end of file ✅
- [x] TC-612: Same scenario, no `NUM_BLADES` defined and no `BladeConfig` present → first preset has exactly **one** `StylePtr<Black>()` style ✅
- [x] TC-613: Config has `#define NUM_BLADES 3` (no Preset block) → first preset has **three** `StylePtr<Black>()` styles ✅
- [x] TC-614: Config has `BladeConfig blades[]` with 2 blade entries (no NUM_BLADES) → first preset has **two** styles ✅
- [x] TC-615: After adding first preset, it is auto-selected; detail pane opens; sidecar list shows it with `new-preset` highlight animation ✅
- [x] TC-615a: BladeConfig entry uses `DimBlade(WS281XBladePtr<...>())` to wrap a switch blade → blade count detection counts the DimBlade as ONE slot, not two (does not double-count the inner WS281XBladePtr). Verified with Ryan's V2 config: 1 main `WS281XBladePtr<128,...>()` + 1 `DimBlade(30.0, WS281XBladePtr<NUM_SWITCH_LEDS,...>())` → 2 blades (BUG-009 regression) ✅
- [x] TC-615b: BladeConfig has whitespace and comments (e.g. blank line + `// JMT Octocore 33" Blade` comment) between the opening `{` and the first `{ ...entry... }` → blade count fallback still finds the first entry and counts correctly (the previous hardcoded `position 1` brittleness is fixed) (BUG-009 regression) ✅
- [x] TC-615c: File has `#ifdef CONFIG_PRESETS` containing only a `BladeConfig` (no `Preset NAME[]` declaration) → `+ Add Preset` inserts a new `Preset presets[] = {entry};` declaration INTO the existing `#ifdef` block, BEFORE the `BladeConfig` (Preset-first per ProffieOS convention). Does NOT append a second `#ifdef CONFIG_PRESETS` block at end of file (BUG-010 regression) ✅
- [x] TC-615d: File has bare `BladeConfig NAME[]` at top level (outside any `#ifdef`) and no `Preset[]` anywhere → `+ Add Preset` REPLACES the bare BladeConfig with a single new `#ifdef CONFIG_PRESETS` block containing Preset first, original BladeConfig second, then `#endif`. BladeConfig keeps its original column-0 alignment; no fresh scaffold appended at end of file (BUG-010 regression) ✅

### 46.2 Add First Preset — existing empty `Preset` block

- [x] TC-616: Config already has `#ifdef CONFIG_PRESETS` … `Preset presets[] = { };` … `#endif` → Add Preset inserts the entry **inside** the existing block; does NOT create a duplicate `#ifdef` or duplicate Preset declaration ✅
- [x] TC-617: Single-line form `Preset presets[] = {};` → first preset is inserted into that same block (brace-walker handles single-line case) ✅

### 46.3 Link Style Library — bare `Preset` block (no `#ifdef CONFIG_PRESETS`)

- [x] TC-618: Config has `Preset presets[] = { …entries… };` but **no ifdefs anywhere** → click Link Style Library → file gains `#ifdef CONFIG_PRESETS` / `#endif` around the Preset block, with `#include "…my_styles.h"` inserted right after the `#ifdef` line ✅
- [x] TC-619: After wrap in TC-618, existing Preset entries are unchanged (no entries shifted, deleted, or duplicated) ✅

### 46.4 Link Style Library — adjacent `BladeConfig`

- [x] TC-620: Config has `Preset presets[] = {…};` immediately followed by `BladeConfig blades[] = {…};` → Link Style Library wraps **both** blocks together inside one `#ifdef CONFIG_PRESETS` / `#endif` (not two separate wraps, not BladeConfig left outside) ✅
- [x] TC-621: Blank lines between Preset and BladeConfig are treated as adjacent — both blocks still wrapped together ✅
- [x] TC-622: Non-blank code between Preset and BladeConfig (e.g. a comment line with content) → BladeConfig is **not** swept in; only Preset block is wrapped ✅

### 46.5 Link Style Library — no `Preset` block at all (link runs first)

- [x] TC-623: Brand-new blank config → click Link Style Library → file gets fresh `#ifdef CONFIG_PRESETS\n\nPreset presets[] = {\n};\n\n#endif` scaffold appended, with `#include "…my_styles.h"` inserted right after the `#ifdef` line ✅
- [x] TC-624: After TC-623, click `+` Add Preset → entry is added **inside** the empty `Preset presets[] = {}` block created by Link Style Library (no duplicate scaffold) ✅

### 46.6 Link Style Library — existing structures (regression)

- [x] TC-625: Config already has `#ifdef CONFIG_PRESETS` → Link Style Library uses the existing ifdef; no duplicate wrap; include inserted right after `#ifdef CONFIG_PRESETS` ✅
- [x] TC-626: Config has `#ifdef CONFIG_PROP` (no CONFIG_PRESETS) → include inserted just before that section's `#endif` (existing CONFIG_PROP fallback path) ✅
- [x] TC-627: Config has JMT add-on includes (`charge_state.h`, `charge_full_prop.h`, `jmt_fett263_wrapper.h`) inside CONFIG_PRESETS → `my_styles.h` is inserted **after** the last JMT include (so it can use their symbols) ✅

### 46.7 Undo

- [x] TC-628: Link Style Library on a bare-Preset config → press Ctrl+Z → both the `#include` AND the `#ifdef/#endif` wrap are reverted in one step (no partial state) ✅
- [x] TC-629: Link Style Library on a blank config (TC-623 scenario) → Ctrl+Z → the entire scaffold AND the include are removed in one step ✅
- [x] TC-630: Link Style Library where the include was previously commented out → app uncomments it → Ctrl+Z → leading `//` is restored ✅
- [x] TC-631: Add First Preset on a blank config → Ctrl+Z → the entire scaffold + first preset is removed in one step ✅
- [x] TC-632: After undo in TC-628, redo (Ctrl+Y) re-applies the link operation cleanly ✅

### 46.8 Conflict resolution still works

- [x] TC-633: Config has an old `#include "wrong/path/my_styles.h"` → Link Style Library opens the conflict modal; choose "Remove It" → old include removed, new one inserted; Ctrl+Z reverts the whole operation ✅
- [x] TC-634: Same → choose "Comment Out & Link" → old include is commented, new one inserted; Ctrl+Z reverts both ✅

---

## 47. STYLE LIBRARY — SEARCH EXPANSION

- [x] TC-635: Add a style whose function body contains `TrFade` but has no matching name, tag, source, or effect → search "TrFade" → that card matches ✅
- [x] TC-636: Add a style with the note "Author: Fett263" (no match in any other field) → search "Fett263" → that card matches ✅
- [x] TC-637: Style has URL `https://example.com/coolblade` with no other matching field → search "coolblade" → that card matches ✅
- [x] TC-638: Existing search by name still works (regression) ✅
- [x] TC-639: Existing search by tag chip text still works (regression) ✅
- [x] TC-640: Existing search by effect chip text (e.g. "Blast") still works (regression) ✅
- [x] TC-641: Existing search by source field still works (regression) ✅
- [x] TC-643: Editing a style and saving → that style's blob is rebuilt; new searchable text in code/notes/URL is findable immediately ✅

---

## 48. ABOUT MODAL — TIP JAR

- [x] TC-644: Open About modal → "Tip Jar" row visible below "General Inquiries", showing `ko-fi.com/jedimastertech` ✅
- [x] TC-645: Tip Jar link is styled the same blue as Website / Support email links (consistent with About modal pattern) ✅
- [x] TC-646: Click the Tip Jar link → opens `https://ko-fi.com/jedimastertech` in the system browser ✅
- [x] TC-647: Tip Jar row appears in both light mode and dark mode with correct contrast ✅ *(trivial — feature is a single link; visible + clickable + styled like other About links covers everything that can fail)*

---

## 49. OS VERSIONS — JMT "LEARN MORE" LINK

- [x] TC-648: Open OS Versions, select any installed version → "Learn more" link visible directly below the `⚙ Add JMT Features` (or `⚙ Check for Updates`) button, right-aligned ✅
- [x] TC-649: Link is rendered in link-blue and is underlined (clearly clickable) ✅
- [x] TC-650: Hover the link → native browser tooltip shows the full URL `https://www.jedimastertech.com/jmt-addons` ✅
- [x] TC-651: Click the link → opens that URL in the system browser ✅ *(uses `shell.openExternal` — cross-platform; works identically on Mac/Linux without separate TCs)*
- [x] TC-652: The link appears for both `Add JMT Features` (no JMT installed) and `Check for Updates` (JMT installed) states ✅

---

## 50. MONACO ICON FONT (codicon)

> Regression test for the missing codicon.ttf fix — `renderer/vs/` rebuilt from `node_modules/monaco-editor/min/vs/`.

- [x] TC-653: Open a config, enter compare/diff view, modify a line → hover the gutter arrow on the modified line → revert-change widget shows a proper **arrow** glyph (not a tofu/square) ✅
- [x] TC-654: Click the revert arrow → line reverts to baseline (regression — BUG-021 behavior preserved) ✅
- [x] TC-655: Monaco find panel (Ctrl+F) chevrons and close icon render as proper icons, not tofu ✅
- [x] TC-656: Monaco context menu icons (right-click in editor) render as proper icons, not tofu ✅

---

## 51. PRESET ARRAY NAME — STRIP LABEL & RENAME

### 51.1 Dynamic strip label

- [x] TC-657: Open a config whose preset block is declared `Preset presets[] = { ... };` → collapsed sidecar strip label reads **PRESETS** ✅
- [x] TC-658: Open a config whose preset block is `Preset no_blade[] = { ... };` → strip label reads **NO_BLADE** (uppercased, underscores preserved) ✅
- [x] TC-659: Open a config with camelCase name `Preset mainBank[] = { ... };` → strip reads **MAINBANK** (lowercase letters uppercased; not "MAIN_BANK") ✅
- [x] TC-660: Open a brand-new (blank) config with no Preset block at all → strip falls back to **PRESETS** ✅
- [x] TC-661: Open the sidecar (expand) → strip label is hidden by the expanded inner panel (existing behavior, no regression) ✅
- [x] TC-662: Collapse the sidecar → strip label reappears with the correct uppercased name ✅

### 51.2 Strip label refreshes with source changes

- [x] TC-663: With sidecar OPEN, edit the array name directly in Monaco (e.g. change `presets` to `mybank`) → strip label updates within ~50 ms (after the rebuild debounce) ✅
- [x] TC-664: With sidecar COLLAPSED, edit the array name in Monaco → strip label still updates (refresh runs even when collapsed) ✅
- [x] TC-665: Undo (Ctrl+Z) the rename → strip reverts to original ✅

### 51.3 Pencil button visibility

- [x] TC-666: Open sidecar → ✎ pencil button visible in header between `+ Add Preset` and the `×` close button ✅
- [x] TC-667: Pencil tooltip reads "Rename preset array" ✅
- [x] TC-668: Pencil styled the same dim/hover treatment as Style Library helper pencil (existing `.helper-pencil-btn` look) ✅

### 51.4 Enter rename mode

- [x] TC-669: Click pencil → input row appears immediately below the header, pre-filled with the current array name (e.g. `presets`) in original case (NOT uppercased) ✅
- [x] TC-670: When the row opens, input is focused and its text is fully selected (user can just start typing) ✅
- [x] TC-671: Pencil button hides while the row is active (does not stack with ✓/✕) ✅
- [x] TC-672: The row sits between the header and the preset list with a subtle inset background + bottom border ✅

### 51.5 Confirm rename (✓ button)

- [x] TC-673: With cursor in input, change name to `mybank` and click ✓ → the `Preset presets[]` line in source becomes `Preset mybank[]`; nothing else in the file changes ✅
- [x] TC-674: After confirm: rename row hides, pencil reappears, strip label updates to **MYBANK** ✅
- [x] TC-675: The exact edit range is just the NAME token (`presets` → `mybank`); leading `Preset ` and trailing ` []` are untouched — verify by checking the line in source matches expected output character-for-character ✅

### 51.6 Cancel rename

- [x] TC-676: Click pencil → change input value → press Escape → row closes, source unchanged, pencil returns, strip label unchanged ✅
- [x] TC-677: Click pencil → change input value → click ✕ → same result as Escape ✅
- [x] TC-678: Click pencil → change input value → click elsewhere in the app (anywhere outside the input/buttons) → input blurs → row closes, source unchanged (revert-on-blur, matches Style Library helper rename pattern) ✅
- [x] TC-679: Click pencil → click ✓ immediately without changing the name → no-op; row closes cleanly, no edit pushed to Monaco undo stack ✅

### 51.7 Keyboard

- [x] TC-680: Click pencil → type new name → press **Enter** → save (same effect as clicking ✓) ✅
- [x] TC-681: Click pencil → press **Escape** with no edits → row closes; pencil returns ✅
- [x] TC-682: While input has focus, all normal text-editing keys (arrows, backspace, delete, home/end) operate within the input only — they edit/navigate the selected/typed text without triggering preset list navigation or other app shortcuts. (When the input opens with the name pre-selected per TC-670, arrow keys collapse the selection and move the caret within the input, as expected for any text field.) ✅

### 51.8 Space / hyphen → underscore sanitization

- [x] TC-683: With input focused, press the **space bar** → underscore (`_`) is inserted at the caret position; cursor advances by one char; no literal space appears ✅
- [x] TC-684: Type `my bank` (with a space) → input shows `my_bank` ✅
- [x] TC-685: Paste text `bank one` into the input (Ctrl+V) → pasted text becomes `bank_one`; runs of consecutive whitespace and/or hyphens collapse to a single underscore ✅
- [x] TC-686: After space→underscore, click ✓ → the renamed `Preset` declaration has no spaces in the identifier ✅

### 51.9 Identifier validation — pencil enforces, Monaco surfaces via markers

**Architecture under test:**
- **Preset[] declaration = source of truth.** CONFIGARRAY refs are a one-way live mirror.
- **Pencil = validated path.** Space / hyphen auto-convert to `_`; anything else outside `[A-Za-z_][A-Za-z0-9_]*` blocks save with an inline error.
- **Monaco source = permissive.** Any chars accepted (including invalid identifiers and empty names). Invalid states are flagged via red squiggle Monaco markers — no auto-correct, no toasts.
- **Sync runs every 50 ms rebuild tick.** Position-based: same-position Preset[] name change rewrites matching CONFIGARRAY refs in the same render cycle. Count change (insertion / deletion) → sync bails; orphans surface as markers.
- **Empty-name recovery:** exactly-one empty `CONFIGARRAY()` pairs with exactly-one empty→named Preset[] transition.

**Pencil validation**

- [x] TC-687: Pencil — clear input → inline error "Name is required" appears below input; input gets red border + bg; ✓ disabled; Enter does nothing (no commit); Esc cancels ✅
- [x] TC-687a: Pencil — type a name starting with a digit (e.g. `1bank`) → inline error "Name cannot start with a digit"; ✓ disabled; Enter blocked ✅
- [x] TC-687b: Pencil — type a name containing invalid chars (`$`, `@`, `!`, `#`, `%`, `^`, `&`, `*`, etc.) → inline error "Only letters, digits, and underscores allowed"; ✓ disabled; Enter blocked ✅
- [x] TC-687c: Pencil — press the **space bar** → underscore (`_`) inserted at caret; no literal space appears; no error (auto-correct path) ✅
- [x] TC-687d: Pencil — type a hyphen → underscore inserted; no error; ✓ enabled ✅
- [x] TC-687e: Pencil — paste `bank one-name` → space + hyphen collapsed to single underscores → input shows `bank_one_name`; no error ✅
- [x] TC-687f: Pencil — Esc / × / blur outside input always cancel cleanly, even while in an error state; source unchanged; row closes; pencil reappears ✅
- [x] TC-687g: Pencil opened on an existing invalid-name bank (e.g. `Preset bad-name[]` typed directly in Monaco) → inline error shows IMMEDIATELY on open; ✓ disabled until user fixes; Esc still backs out cleanly ✅

**Monaco source — permissive, marker-driven feedback**

- [x] TC-688: Manually type `Preset no-blade[]` in Monaco (hyphen direct) → parser accepts (regex `[\w-]*`); strip label shows **NO-BLADE**; sidecar correctly shows the bank's entries; Add Preset targets this bank (no duplicate scaffold). Red squiggle on `no-blade` with tooltip "Invalid preset bank name. Use letters, digits, and underscores; must not start with a digit." ✅
- [x] TC-688a: Type `Preset 9bank[]` in Monaco → strip shows **9BANK**; red squiggle on `9bank`; same tooltip as TC-688 ✅
- [x] TC-688b: Type `Preset [] = {` (empty name) in Monaco → strip shows **(UNNAMED)**; red squiggle on the `[]` portion; tooltip "Preset bank is missing a name." Bank is still selectable in the strip ✅
- [x] TC-688c: Type `Preset[] = {` (no space between `Preset` and `[]`) → red squiggle on `Preset[]`; tooltip "Preset bank is missing a name." ✅
- [x] TC-688d: NO toast fires for ANY Monaco-source edit — space / hyphen / invalid chars stay as user typed. The new design replaced auto-correct + toast with permissive parsing + markers ✅
- [x] TC-688e: Known limitation — typing a literal space in the middle of a Preset[] name (e.g. `Preset jedi knight[]`) breaks parser alignment (parser interprets as typeName=`jedi` name=`knight`). Sync pauses; CONFIGARRAY(jedi) becomes orphan (marker fires). Once the user removes the space, parser realigns; user manually fixes the CONFIGARRAY ref guided by the orphan marker. Accepted as a known limitation — pencil is the path that prevents this state ✅

**CONFIGARRAY live mirror (Preset[] → refs, never reverse)**

- [x] TC-688f: Rename a bank in Monaco letter-by-letter (e.g. `Preset jedi[]` → `Preset jediq[]` → `Preset jediqu[]` → ...) → matching `CONFIGARRAY(jedi)` ref updates per keystroke to the latest name (no debounce). No toast — back-fed CONFIGARRAY sync is silent ✅
- [x] TC-688g: Pencil rename a bank with CONFIGARRAY refs → declaration AND all refs update in same atomic Monaco edit; single Ctrl+Z reverts both ✅
- [x] TC-688h: Bank-swap edge case — two banks `Preset jedi[]` + `Preset sith[]` with refs. Cut-paste to reorder → sync skips both positions because each "old name" still exists in the current set (`currentSet.has(oldName)` guard); no false CONFIGARRAY rewrites ✅
- [x] TC-688i: Insertion of a new bank via `+ Add another preset bank` → counts differ → sync bails for that tick; new bank's CONFIGARRAY ref is scaffolded with matching name (handled by scaffolder, not sync); no spurious activity on other banks ✅
- [x] TC-688j: Delete a Preset[] bank (right-click → Delete) → orphan CONFIGARRAY ref (if any remained) surfaces as red squiggle: "No Preset[] declaration named "X". Add one or update this reference." ✅
- [x] TC-688k: Type an unrelated `CONFIGARRAY(typo)` in BladeConfig directly (no matching Preset[]) → red squiggle on `typo`; same orphan tooltip. CONFIGARRAY is allowed to be freely edited — orphan markers are the user feedback ✅
- [x] TC-688l: `CONFIGARRAY()` (empty parens) with no matching empty `Preset[]` → red squiggle on `CONFIGARRAY()`; tooltip "CONFIGARRAY reference is missing a name." ✅

**Empty-name round trip (null recovery)**

- [x] TC-688m: Delete all chars of a Preset[] name letter-by-letter in Monaco → name becomes empty; strip shows **(UNNAMED)**; CONFIGARRAY mirror follows letter-by-letter to `CONFIGARRAY()` ✅
- [x] TC-688n: With exactly one `Preset [] = {` and exactly one `CONFIGARRAY()` in the file, type a new name into the empty Preset[] in Monaco → on the same 50 ms rebuild tick, the lone `CONFIGARRAY()` refills with the new name (exactly-one rule) ✅
- [x] TC-688o: Two empty banks AND/OR two empty `CONFIGARRAY()` refs → empty-recovery is ambiguous; no auto-fill happens; markers on the empty Preset[] and empty CONFIGARRAY() guide manual fix ✅
- [x] TC-688p: Pencil rename on a null Preset[] bank → input opens empty with "Name is required" error; user types valid name + ✓ → declaration becomes `Preset NAME[]` AND (when exactly one empty `CONFIGARRAY()` exists) the empty ref is filled with NAME, all in one atomic edit (single Ctrl+Z reverts both) ✅

**Permissive name shape — preserved**

- [x] TC-689: Type mixed-case name `MyBank` via pencil → committed as typed; strip shows **MYBANK** (uppercased) but source preserves the original case ✅

### 51.10 Empty / no-op handling

- [x] TC-690: Click pencil → clear the input completely → "Name is required" inline error appears; ✓ disabled; Enter is blocked (no commit, row stays open). Esc / × closes the row without changes. *(Covered by TC-687 — kept here for the no-op-flow scenario.)* ✅
- [x] TC-691: Click pencil → leave value identical to current name → press Enter → no edit pushed; row closes; Ctrl+Z does not undo a phantom rename ✅

### 51.11 Undo / Redo

- [x] TC-692: Rename `presets` → `mybank` via pencil → Ctrl+Z → name reverts to `presets`; strip label re-updates to **PRESETS** ✅
- [x] TC-693: After undo in TC-692, Ctrl+Y re-applies the rename → name back to `mybank`; strip **MYBANK** ✅
- [x] TC-694: Rename is a **single** Monaco edit operation (one Ctrl+Z reverts the whole rename — not character-by-character) ✅

### 51.12 Sidecar close while rename is active

- [x] TC-695: Click pencil → start typing → click × (sidecar close) → sidecar closes; rename row resets; pencil button visibility resets; reopening sidecar shows no leftover state ✅
- [x] TC-696: After TC-695, the pencil is again visible and functional in the header ✅

### 51.13 Regression — header buttons still work

- [x] TC-697: `+` Add Preset button still adds a preset to the end of the active bank (no regression from header layout changes) ✅
- [x] TC-698: `×` close button still closes the sidecar (no regression) ✅
- [x] TC-699: Header layout fits comfortably; no buttons overlap or wrap to a second line at normal sidecar width ✅

### 51.14 Preset detail field-edit keyboard navigation

*Substantial work surfaced while testing §51.10/51.11. The Name / Font Folder / Track field pencils inside the preset detail panel now support full keyboard navigation with dirty-checked saves, live values across nav, and a .wav auto-append for tracks.*

**Tab loop & key bindings (text fields: Name, Font, Track)**

- [x] TC-975: In a text field input, press **Enter** → commit (only if dirty) + focus Monaco; Ctrl+Z works immediately without an extra click ✅
- [x] TC-976: Press **Tab** → commit (if dirty) + open the next field in the loop [Name → Font → Common → Track → Name] ✅
- [x] TC-977: Press **Shift+Tab** → commit (if dirty) + advance backward in the loop ✅
- [x] TC-978: Press **Esc** → cancel + focus Monaco (no commit, even when value is dirty) ✅
- [x] TC-979: Click ✓ → commit + focus Monaco; click ✕ → cancel + focus Monaco ✅
- [x] TC-980: Click another field's pencil while current field is dirty → current field saves + clicked pencil's edit opens, on a single click (not two) ✅
- [x] TC-981: Click another field's pencil while current field is unchanged → current field closes (no commit) + clicked pencil's edit opens ✅
- [x] TC-982: Click outside the detail panel (e.g. Monaco) while a field is dirty → blur saves; focus follows the click ✅
- [x] TC-983: Pencil ✎ is hidden while its own field's input is open (no stray tab stop / visual clutter) ✅

**Common checkbox keyboard handling**

- [x] TC-984: With Common checkbox focused, press **Space** → toggle the checkbox + open the Track input (auto-advance) ✅
- [x] TC-985: With Common focused, press **Tab** → focus Track input (no toggle); **Shift+Tab** → focus Font input ✅
- [x] TC-986: With Common focused, press **Enter** or **Esc** → focus Monaco (no toggle) ✅
- [x] TC-987: Mouse-click Common → toggle + focus Monaco (does not advance to Track) ✅

**Dirty check (no no-op undo crumbs)**

- [x] TC-988: Open a field's input, press Enter / Tab / ✓ without changing the value → no Monaco edit pushed; Ctrl+Z does not undo anything spurious ✅
- [x] TC-989: Tab through Name → Font → Common → Track without typing anything → zero undo steps generated for the pass-through ✅

**Live initial value (no stale data across nav)**

- [x] TC-990: Edit Font to "test", Tab to Track, type "this", click Font pencil → Font input reopens with "test" (the current displayed value), not the render-time blank ✅
- [x] TC-991: Same scenario but click Track pencil from Font → Track reopens with its current value ✅

**Tab order — only Name / Font / Common / Track receive tab focus**

- [x] TC-992: Tab key from the active Name input cycles only through Name → Font → Common → Track → Name. Preset nav arrows (◁ ▷ →), delete (×), and slot tiles are excluded from the tab cycle ✅

**Track auto-append `.wav`**

- [x] TC-993: Edit Track to a value without a `.wav` extension (e.g. `boot`) and commit → source value becomes `boot.wav`; displayed value matches ✅
- [x] TC-994: Edit Track to a value that already ends in `.wav` (or `.WAV`, case-insensitive) → no double-append ✅
- [x] TC-995: Commit an empty Track → stays empty (no `.wav` appended) ✅

**Auto-open on Add Preset opens Name only**

- [x] TC-996: `+ Add Preset` → Name input opens pre-selected with the default "Preset N"; user types replacement and Tabs through Font / Common / Track at their own pace. No auto-chain — keyboard navigation drives flow. ✅

### 51.15 Sidecar header — close icon + dynamic title

> Refinement (2026-05-15): the sidecar header now uses a chevron for "collapse" (× was reading as "delete" since `×` means destructive everywhere else in the app) and shows the active bank name live (instead of static "PRESET STYLES"), putting the rename pencil right next to the name it edits.

- [x] TC-997: Close button glyph is `‹` (left chevron, not `×`). Hover tooltip still reads "Close." Font size sized so the thinner glyph carries comparable visual weight to the prior `×`. ✅
- [x] TC-998: Header title pulls the active bank name from the same source as the vertical rail labels. Single-bank `presets` → title reads **PRESETS STYLES**. Switching banks updates the title within the same render frame. ✅
- [x] TC-999: Rename a bank via the pencil → title reflects the new name immediately. ✅
- [x] TC-1000: Empty / unnamed bank (`Preset [] = {`) → title shows **(UNNAMED) STYLES**. ✅
- [x] TC-1001: Brand-new config with no `Preset NAME[]` arrays at all → title falls back to **PRESETS STYLES**. ✅

---

## 52. MULTIPLE PRESET BANKS — STRIP & ADD

### 52.1 Parser accepts empty `Preset` arrays

- [x] TC-700: Config has `Preset presets[] = { ... };` (with entries) and `Preset presets2[] = { };` (empty) → parser returns BOTH arrays; strip shows both labels ✅
- [x] TC-701: Config has `BladeConfig blades[] = { …with content… };` → still **not** treated as a preset array (typeName filter still applies) ✅
- [x] TC-702: Custom-typed array containing StylePtr content (e.g. `SomeType arr[] = { StylePtr<…>() };`) → **ignored**, not treated as a preset bank. ProffieOS only recognizes `Preset` as a preset array typename — the parser's old content-based fallback was removed. ✅

### 52.2 Strip renders multiple banks

- [x] TC-703: Two-bank config (`presets`, `presets2`) → strip shows two vertical labels stacked top-to-bottom with a thin horizontal divider between them ✅
- [x] TC-704: Three-bank config → three labels, two dividers (one between each adjacent pair, none at top or bottom of the list) ✅
- [x] TC-705: Each label text is the array name uppercased (e.g. `no_blade` → **NO_BLADE**) ✅
- [x] TC-706 (zero banks): Blank/new config with no `Preset NAME[]` block at all → fallback "PRESETS" stub label is **neutral** (muted text color, never blue) — sidecar open or collapsed ✅
- [x] TC-706a (one bank, sidecar collapsed): Single-bank config, sidecar collapsed → lone label is **neutral** ✅
- [x] TC-706b (one bank, sidecar open): Single-bank config, sidecar open → lone label is still **neutral** (no other banks to distinguish from) ✅
- [x] TC-706c (2+ banks, sidecar collapsed): Multi-bank config, sidecar collapsed → all labels **neutral** (no bank is currently being viewed) ✅
- [x] TC-706d (2+ banks, sidecar open): Multi-bank config, sidecar open → **only the active bank** label is JMT blue; other bank labels are neutral ✅
- [x] TC-706e (state transitions): Open the sidecar on a multi-bank config → active bank turns blue. Close the sidecar → blue clears. Switch banks while open → blue moves to the new active bank. ✅
- [x] TC-707: Hovering an inactive label shows hover background (clearly clickable) ✅
- [x] TC-708: Native browser tooltip on each label shows the original-case name (e.g. hovering `NO_BLADE` shows `no_blade`) ✅

### 52.3 Strip vertical scrolling

- [x] TC-709: 10+ banks in source → strip scrolls vertically when the labels would overflow; toggle and `+` button remain visible (not scrolled out of view) ✅
- [x] TC-710: Scrollbar is hidden (no visible scrollbar chrome) but scroll-wheel still works inside the strip ✅

### 52.4 Click bank to switch active

- [x] TC-711: Sidecar open on bank A → click bank B label → sidecar stays open; preset list and detail pane update to bank B's content; bank B label becomes active (blue) ✅
- [x] TC-712: Sidecar open on bank A → click bank A label (the active one) → sidecar **closes** (toggle behavior on active bank) ✅
- [x] TC-713: Sidecar collapsed → click any bank label → sidecar opens with that bank active ✅
- [x] TC-714: After switching banks, `_selectedPresetIndex` resets to 0 (first preset of the new bank is highlighted) ✅

### 52.5 `+` button — naming logic

- [x] TC-715: No banks exist → click `+` → new bank named **`presets`** ✅
- [x] TC-716: Only `Preset presets[]` exists → click `+` → new bank named **`presets2`** ✅
- [x] TC-717: `presets` and `presets2` exist → click `+` → new bank named **`presets3`** ✅
- [x] TC-718: `presets`, `presets2`, `presets4` exist (gap) → click `+` → new bank named **`presets3`** (fills the gap, not `presets5`) ✅
- [x] TC-719: Banks named with non-`presets` pattern (e.g. `bank1`, `bank2`) → click `+` → new bank still named **`presets`** (next available simple default) — user can immediately rename via the auto-opened rename mode ✅

### 52.6 `+` button — insertion location

- [x] TC-720: Banks exist → new bank is inserted immediately after the last existing bank's closing `};` (still inside `#ifdef CONFIG_PRESETS` if present) ✅
- [x] TC-721: No banks and no `#ifdef CONFIG_PRESETS` → new bank is appended at end of file inside a fresh `#ifdef CONFIG_PRESETS … #endif` scaffold ✅
- [x] TC-722: No banks but `#ifdef CONFIG_PRESETS` already exists (rare — see Link Style Library flow) → new bank is created; existing CONFIG_PRESETS scaffold not duplicated *(acceptable if it appends a second scaffold — document actual behavior here)* ✅
- [x] TC-722a: Bare `Preset NAME[]` exists outside any `#ifdef CONFIG_PRESETS` (and no BladeConfig) → both the existing bank AND the new bank are wrapped together in a single new `#ifdef CONFIG_PRESETS … #endif` (no orphan bank left outside). ✅

### 52.7 `+` button — post-creation UX

- [x] TC-723: After `+` click: sidecar opens (if it was collapsed) with the new bank active ✅
- [x] TC-724: After `+` click: new bank is **pre-populated with one `Preset 1` entry** (not empty); preset list shows it; detail pane opens on it ✅
- [x] TC-724a: Style count of the auto-added preset respects blade count — 1 style if no `NUM_BLADES` and no `BladeConfig`; N styles if `NUM_BLADES N` is defined; entries from `BladeConfig` blade count if applicable ✅
- [x] TC-725: After `+` click: rename row also appears with the new name (`presets2`, etc.) pre-filled and the text selected, ready to type ✅
- [x] TC-726: If user immediately starts typing → typed text replaces the auto-selected default name; the `Preset 1` entry is untouched ✅
- [x] TC-727: If user presses Escape with no edits → rename closes; bank keeps the auto-generated name; `Preset 1` entry remains ✅
- [x] TC-727a: Bank creation + first-preset insertion + rename-open are in **one** undoable step — Ctrl+Z reverts the entire new bank (declaration + entry) at once ✅

### 52.8 Add Preset into empty active bank — bank specificity

> Regression case: only reachable when an empty bank exists in source (user hand-edited the source to remove all entries from a bank, or pre-existing empty bank). The `+` button no longer creates empty banks, but the code path must still handle them correctly.

- [x] TC-728: Manually edit source so config has `Preset presets[]` (with entries) and `Preset presets2[] = { };` (empty); switch active bank to `presets2` → click `+ Add Preset` in the header → first entry lands inside the `presets2` block specifically; `presets` is unchanged ✅
- [x] TC-729: After TC-728, the active bank's list shows the new preset; `presets` bank's list (switch to verify) is unchanged ✅
- [x] TC-730: Insert position is the line right after `Preset presets2[] = {` — entry sits between the opening `{` and the closing `};` ✅

### 52.9 Undo

- [x] TC-731: Click `+` to add a bank → press Ctrl+Z → new bank disappears from source; strip drops the label; if the user was in the new bank, active index falls back to the previously-active bank ✅
- [x] TC-732: After TC-731, Ctrl+Y re-adds the bank cleanly (single redo step) ✅
- [x] TC-733: Add bank → switch to existing bank → undo new-bank creation → editor focus is sane; sidecar doesn't crash (clamping `_activeArrayIndex` handles the now-shorter array list) ✅

### 52.10 Rename + multi-bank interaction

- [x] TC-734: Rename the active bank via pencil → strip label for that bank updates to the new name (uppercased); other bank labels unchanged ✅
- [x] TC-735: Rename `presets` → `mainbank` while two banks exist → only the first bank's label changes; `presets2` label stays put ✅
- [x] TC-736: Single rename Monaco edit only touches the NAME token of the active bank's declaration — verify by checking the other bank's declaration line is untouched ✅

### 52.11a Right-click bank context menu

- [x] TC-741: Right-click a bank label in the strip → small context menu appears at the cursor, same look as the preset-row context menu (same background, border, item styling) ✅
- [x] TC-742: Menu items in order: **⧉ Duplicate** then **× Delete**; Delete styled with the existing `.danger` (red-tinted) class ✅
- [x] TC-743: Click outside the menu → menu closes (existing global handler) ✅
- [x] TC-744: Press Escape with menu open → menu closes ✅
- [x] TC-745: Right-click another bank while a menu is open → previous menu closes, new menu opens at the new cursor position ✅
- [x] TC-746: Right-click the `+` button → no menu (only labels trigger it) ✅
- [x] TC-747: Right-click the divider between labels → no menu (only labels trigger it) ✅
- [x] TC-748: Right-click the fallback "PRESETS" stub (zero-banks state) → no menu (nothing to act on) ✅

### 52.11b Duplicate via context menu

- [x] TC-749: Right-click bank `presets` → click Duplicate → new bank `presets_copy` is inserted in source immediately after `presets`'s closing `};` ✅
- [x] TC-750: After duplicate, all entries from the source bank are present in the new bank (preset names, fonts, styles, tracks — full copy) ✅
- [x] TC-751: After duplicate: sidecar opens (if collapsed) with the new bank active; rename row opens automatically with `presets_copy` selected, ready to type a real name ✅
- [x] TC-752: Naming conflict — duplicate `presets` when `presets_copy` already exists → new bank named `presets_copy2`; if `presets_copy2` also taken → `presets_copy3`; etc. ✅
- [x] TC-753: Duplicate `jedi` → new bank named `jedi_copy` (suffix uses original name, not generic `presets`) ✅
- [x] TC-754: Duplicate is a single Monaco edit — Ctrl+Z removes the entire new bank in one step ✅

### 52.11c Delete via context menu

- [x] TC-755: Right-click a bank → click Delete → **in-app** confirm modal appears (same look as the Unsaved Changes / Delete Style modal — dark card, app fonts, no browser chrome). Title reads "Delete Preset Bank". Confirm button labeled "Delete" with the destructive (red) styling. ✅
- [x] TC-755a (0 presets): Bank with no entries → message reads exactly: `Delete preset bank "NAME"? This will remove the the preset bank from your config.` ✅
- [x] TC-755b (1 preset): Bank with one entry → message reads exactly: `Delete preset bank "NAME"? This will remove the preset bank along with its 1 preset.` (singular, no "s") ✅
- [x] TC-755c (N presets): Bank with 2+ entries → message reads exactly: `Delete preset bank "NAME"? This will remove the preset bank along with its N presets.` (plural, with the actual count substituted) ✅
- [x] TC-755d: No "Use Ctrl+Z to undo" footer in any of the three variants — the confirm body stays focused on what the action does, not how to recover ✅
- [x] TC-756: Confirm dialog → Cancel → bank intact, no source change, sidecar unchanged ✅
- [x] TC-757: Confirm dialog → OK → entire `Preset NAME[] = { … };` block is removed from source; trailing blank line after `};` is also eaten for clean spacing ✅
- [x] TC-758: Deleting the active bank → `_activeArrayIndex` falls back to the previous bank (or 0 if you deleted the first); strip highlights the new active bank ✅
- [x] TC-759: Deleting a non-active bank → active bank stays selected; only the deleted label is removed from the strip ✅
- [x] TC-760: Delete the only bank → strip falls back to the neutral "PRESETS" stub; sidecar (if open) shows empty state ✅
- [x] TC-761: Delete is a single Monaco edit — Ctrl+Z restores the bank and its contents intact, original line positions preserved ✅

### 52.11 Regression — single-bank behavior preserved

- [x] TC-737: Single-bank config (just `Preset presets[]`) → strip shows one label `PRESETS` (no divider above or below since there's only one) + `+` below ✅
- [x] TC-738: Clicking the lone bank label opens the sidecar (was previously: clicking strip opens sidecar; still works) ✅
- [x] TC-739: Clicking empty space in the strip (away from labels, toggle, `+`) still opens the sidecar (existing collapsed-strip-click behavior) ✅
- [x] TC-740: Toggle chevron (`›`) still works exactly as before — opens/closes the sidecar regardless of bank state ✅

---

## 53. LINK JMT ADD-ONS — PROP WRAPPER INCLUDE

### 53.1 Visibility — driven by selected OS version's `jmtVersion`

- [x] TC-762: Select an OS version where `.jmt_meta.json` has `jmtVersion` set → "Link JMT Add-ons" button visible in the toolbar next to "Link Style Library" ✅
- [x] TC-763: Select an OS version with NO `jmtVersion` field → button hidden, regardless of config contents ✅
- [x] TC-764: No config open → button **hidden** (not visible-but-disabled — both link buttons collapse from the toolbar to save space) ✅
- [x] TC-764a: Same rule applies to "Link Style Library" button — hidden when no config open ✅
- [x] TC-765: Config already includes `jmt_fett263_wrapper.h` (in any form/path that matches `#include "*jmt_fett263_wrapper.h"`) → button hidden ✅
- [x] TC-766: Switch OS version dropdown from non-JMT to JMT version → button appears within the same render frame ✅
- [x] TC-767: Switch OS version from JMT to non-JMT → button hides immediately ✅
- [x] TC-768: User manually types/deletes the wrapper `#include` in the editor → button hides/reappears live (driven by editor content change event) ✅
- [x] TC-768a (initial load): Quit and relaunch with a saved config that is open AND a JMT-installed OS version selected → button is **visible on first paint** (no need to switch tabs or change version to trigger detection — `populateVersionSelect` hook fires JMT state refresh on every dropdown population, including the boot-time one) ✅

### 53.2 Visibility — version metadata changes

- [x] TC-769: Run "Add JMT Features" on the currently-selected version (which previously had no JMT) → after success, the button appears without needing to re-select the version (driven by `_refreshSelectedVersionJmtState` in the post-apply path) ✅
- [x] TC-770: Rename a JMT-installed version → button stays visible as long as the renamed version remains selected ✅
- [x] TC-771: Delete the currently-selected JMT version → button hides (no selected version, or fallback to non-JMT version) ✅
- [x] TC-771a: "Add JMT Features" on a version whose `<name> +JMT` already exists → falls forward to `<name> +JMT2` / `+JMT3` / … instead of failing silently. After success, dropdown + toolbar button refresh as expected. ✅

### 53.3 Insert into existing `CONFIG_PROP` (no conflict)

- [x] TC-772: Config has `#ifdef CONFIG_PROP … #endif` block with no `#include "../props/…"` line → click Link JMT Add-ons → `#include "../props/jmt_fett263_wrapper.h"` is inserted just before the matching `#endif` ✅
- [x] TC-773: After insert: button hides; cursor moves to the new include line; line is centered in viewport ✅
- [x] TC-774: Existing CONFIG_PROP body content (defines, comments) is preserved unchanged around the insert ✅

### 53.4 Conflict — another `#include "../props/*.h"` present

- [x] TC-775: Config has `#include "../props/saber_fett263_buttons.h"` (or any non-wrapper prop include) → click → conflict modal opens titled "Existing Prop Include Found", showing the conflicting line in the code block ✅
- [x] TC-776: Conflict modal — Cancel → no source change, button still visible ✅
- [x] TC-777: Conflict modal — Comment Out & Link → original prop line gets `//` prefix; wrapper inserted before `#endif`. Both edits are part of one undo step. ✅
- [x] TC-778: Conflict modal — Remove It → original prop line removed entirely; wrapper inserted before `#endif`. Both edits are one undo step. ✅
- [x] TC-779: Conflict line shown verbatim with leading whitespace preserved in the code-block preview ✅

### 53.5 No `CONFIG_PROP` block — scaffold creation (with correct ordering)

- [x] TC-780: Config has no `#ifdef CONFIG_PROP` anywhere AND no `#ifdef CONFIG_PRESETS` → click → fresh `#ifdef CONFIG_PROP\n#include "../props/jmt_fett263_wrapper.h"\n#endif` block is appended at end of file ✅
- [x] TC-780a: Config has no CONFIG_PROP but DOES have CONFIG_PRESETS (e.g. `+ Add Preset` ran first) → click Link JMT → new CONFIG_PROP scaffold is inserted **immediately before** `#ifdef CONFIG_PRESETS` (correct ProffieOS section ordering: TOP → PROP → PRESETS → BUTTONS), with one blank line between them ✅
- [x] TC-780b: Same as TC-780a but with non-blank content immediately above CONFIG_PRESETS → a leading blank line is inserted before the new CONFIG_PROP block so it doesn't run flush against that content ✅
- [x] TC-780c: Same as TC-780a but with the line immediately above CONFIG_PRESETS already blank → no extra leading blank is inserted (avoids stacking double blanks) ✅
- [x] TC-781: Brand-new blank config (just created via `+ New`) → click Link JMT → produces a minimal config with just the CONFIG_PROP scaffold containing the wrapper include ✅
- [x] TC-781a: Brand-new blank config → `+ Add Preset` first, then Link JMT Add-ons → final order in source: `#ifdef CONFIG_PROP` (with include) then `#ifdef CONFIG_PRESETS` (with the preset) — not the other way around ✅
- [x] TC-782: Blank line is inserted before the appended end-of-file scaffold if the file didn't already end with one (so the block doesn't run into prior content) ✅

### 53.6 Commented-out wrapper recovery

- [x] TC-783: Config has `//#include "../props/jmt_fett263_wrapper.h"` (wrapper present but commented) → click → leading `//` is stripped, no new include added; button hides. Cursor moves to the now-uncommented include line (matches the normal-insert behavior). ✅
- [x] TC-784: TC-783 path is a single undoable edit — Ctrl+Z restores the `//` prefix ✅

### 53.7 Undo

- [x] TC-785: After successful link (no conflict), Ctrl+Z reverses the wrapper include and (if applicable) the CONFIG_PROP scaffold in one step; button reappears ✅
- [x] TC-786: After Comment Out & Link, Ctrl+Z reverts BOTH the comment-out AND the wrapper insert in one step ✅
- [x] TC-787: After Remove It & Link, Ctrl+Z restores the removed prop line AND removes the wrapper in one step ✅
- [x] TC-788: After scaffold creation (TC-780), Ctrl+Z removes the entire `#ifdef CONFIG_PROP … #endif` block including the include ✅
- [x] TC-788a: **Known limitation** — undo of the JMT link/uncomment correctly restores source content and places the cursor at the affected line, but Monaco's post-edit layout pass scrolls the viewport to the cursor's pre-edit position (often line 1 if the user clicked the toolbar while scrolled to top). User must scroll manually to see the change. Accepted; not worth the invasive workarounds attempted (deferred reveal / explicit setScrollTop did not override Monaco's behavior). ✅

### 53.8 Wrapper detection — variations

- [x] TC-789: Include with absolute-ish path `#include "props/jmt_fett263_wrapper.h"` (no `../`) → detection still treats it as linked; button hides ✅
- [x] TC-790: Include with mixed slashes or extra whitespace → still detected as linked ✅
- [x] TC-791: Include inside a block comment `/* ... #include "../props/jmt_fett263_wrapper.h" ... */` → currently treated as "linked" by the regex (known limitation; document if surprising in practice) ✅

### 53.10a Slot classification — full regression matrix

> The named-color fix in `_buildSlotTile` adds a new branch before the helper/ref/inline cascade. These tests verify every classification path still works as expected.

**Built-in color slots (the bug fix itself)**
- [x] TC-794g: Slot with `Black` → tile class is `slot-inline`; color swatch renders as `#000`; B1 badge present; clicking the tile opens the slot editor; no "library not linked" anywhere ✅
- [x] TC-794h: Slot with `White` → swatch `#fff`; otherwise identical to TC-794g ✅
- [x] TC-794i: Slot with TitleCase color from the extended palette (e.g. `DodgerBlue`) → swatch matches the palette's RGB; classified inline ✅
- [x] TC-794j: Slot with an ALL_CAPS color alias (`StylePtr<RED>()`, `StylePtr<CYAN>()`) → still inline (this path was already correct; verifying no regression) ✅

**True library references**
- [x] TC-794k: Slot with `MyCustomBlade` (not in `NAMED_COLORS`), library NOT linked → tile class `slot-unlinked`; red tile; "library not linked" label visible; full tooltip explains the situation ✅
- [x] TC-794l: Same slot, library linked → tile class `slot-helper`; no warning; tile clickable to slot editor ✅
- [x] TC-794m: Link/unlink the Style Library via the toolbar button → the same `MyCustomBlade` slot toggles between `slot-helper` and `slot-unlinked` correctly; the `Black` slot in the same preset stays `slot-inline` through both states ✅

**Pointer references**
- [x] TC-794n: Slot with `&jediStyle` (note the `&` prefix) → tile class `slot-ref`; clicking opens slot editor; not affected by library link state ✅

**Inline expressions**
- [x] TC-794o: Slot with `Layers<...>` → tile class `slot-inline`; existing inline behavior preserved ✅
- [x] TC-794p: Slot with `Mix<...,Black,Red,...>` (Black as INNER argument, not the outer style) → outer expression makes this `slot-inline`; the inner `Black` is just a color literal inside the expression, doesn't trigger named-color reclassification ✅
- [x] TC-794q: Slot with `StyleNormalPtr<CYAN,WHITE,300,800>` (top-level commas as raw arg list) → classified inline; no warnings ✅
- [x] TC-794r: Slot with a deeply nested expression (3+ angle bracket pairs) → classified inline by the parser's nesting rule ✅

**Missing / excess slots**
- [x] TC-794s: `NUM_BLADES 3`, preset has only 2 entries → blade 3 shows as a missing slot (`slot-missing` class, dashed border, "Add style for blade 3" tooltip) ✅
- [x] TC-794t: `NUM_BLADES 1`, preset has 3 entries → blades 2 and 3 show as excess (`slot-excess` class, yellow/warning treatment, excess tooltip) ✅
- [x] TC-794u: Missing/excess classes take precedence over named-color reclassification (a missing slot is still rendered as missing regardless of what's in `slot.expr`) ✅

**Slot actions (regression)**
- [x] TC-794v: × delete button on a `Black` slot → slot is removed correctly; preset is still parseable ✅
- [x] TC-794w: Click a `Black` slot → slot editor opens with `Black` pre-loaded; saving without changes leaves source unchanged ✅
- [x] TC-794x: Color picker on a `Black` slot → shows the named color as the current selection (recognized via `colorLabel` reverse lookup) ✅

**Defensive — proffieArgs availability**
- [x] TC-794y: If `window.proffieArgs` is somehow unavailable at slot render time (deferred load), the `?.()` chain returns undefined → `_isNamedColor` is false → fall back to the original classification (named color slots would render as `slot-helper`/`slot-unlinked` — same as before the fix; no crash). Verified manually via `window.proffieArgs = undefined; window._presetSidecar.rebuild()` — no console errors. ✅

### 53.10 Built-in named colors no longer flagged as unlinked

> Bug: parser classified single TitleCase tokens (e.g. `Black`, `Red`, `Cyan`) as `'helper'` (a library reference). Combined with "library not linked," default `StylePtr<Black>()` entries showed a misleading red warning even though `Black` is a built-in ProffieOS color, not a library style.

- [x] TC-794a: New preset with default `StylePtr<Black>()` slot, no style library linked → slot tile renders in normal inline-style coloring (NOT red, NOT "library not linked" label, NOT the alarmist tooltip) ✅
- [x] TC-794b: Same with `StylePtr<Red>()`, `StylePtr<Blue>()`, `StylePtr<Cyan>()`, `StylePtr<Magenta>()`, `StylePtr<White>()`, `StylePtr<Orange>()`, `StylePtr<Pink>()`, `StylePtr<Yellow>()`, `StylePtr<Green>()`, `StylePtr<Purple>()` → all treated as built-in colors, no warnings ✅
- [x] TC-794c: Extended palette names from `NAMED_COLORS` (`DodgerBlue`, `Chartreuse`, `DarkOrange`, etc.) → also recognized as built-in, no warning ✅
- [x] TC-794d: ALL_CAPS forms (`StylePtr<WHITE>()`, `StylePtr<CYAN>()`) → still treated as inline (existing behavior preserved) ✅
- [x] TC-794e: True library reference (e.g. `StylePtr<MyCustomBlade>()` where `MyCustomBlade` isn't in `NAMED_COLORS`), library not linked → STILL shows "library not linked" with red tile and tooltip (the real warning still works) ✅
- [x] TC-794f: Same true library reference, library NOW linked → tile renders normally without the warning (existing behavior preserved) ✅

### 53.9 Regression — Link Style Library unchanged

- [x] TC-792: With both buttons potentially visible (JMT version selected, style library imported, neither linked yet), each button operates independently — clicking one does not affect the other's state ✅
- [x] TC-793: Both Link buttons can be clicked in either order on the same config — final config has both `my_styles.h` and `jmt_fett263_wrapper.h` includes inside their respective sections ✅
- [x] TC-794: No styling regression — Link JMT Add-ons button matches the Link Style Library button visually (same `btn-blue` style, same height, sits adjacent in toolbar) ✅

### 53.11 Glow-swatch animation model

> Refinement (2026-05-15): replaced the per-LED sine + flicker model in `renderer/glow-swatch.js` with a scrolling rotoscope-band sweep ported from the JMT site. Single intensity knob replaces five tuning fields. Per-instance random scroll start so a grid of swatches doesn't march in lockstep.

- [x] TC-1002: Every animated swatch in the app shows a **steady diagonal scrolling band sweep** (not a sine breath + flicker). Animation looks consistent across swatches — same speed / band shape. ✅
- [x] TC-1003: Multiple swatches visible at the same time (color picker grid, expanded slot args) appear **offset from each other** — random per-instance start phase keeps them from syncing up. ✅
- [x] TC-1004: Public API unchanged — `GlowSwatch.create()` / `mount()` / `mountAll()` / `setColor()` / `setAnimated()` / `destroy()` all behave as before; no callers needed updates. ✅

### 53.12 Color picker popup — animation & open behavior

> Refinement (2026-05-15): hover priority for animation, opens to the page the current color lives on, small preview only animates when not matched by a quick-select cell.

- [x] TC-1005: Open the picker on a custom color that does NOT match any quick-select cell → the **small preview swatch** (next to the RGB inputs) animates; no cell is marked selected on the current page. ✅
- [x] TC-1006: Open the picker on a quick-select color (e.g. Cyan) → popup **opens on the page that color lives on**, the matching cell is selected and animates, the small preview is static. ✅
- [x] TC-1007: Hover priority — only one swatch animates at a time: **hovered cell beats selected cell beats preview**. Mouse-out restores the prior animator (selected cell or preview, whichever applies). ✅
- [x] TC-1008: Paging through the popup → animations on the previously-visible page stop (controllers for offscreen pages are killed). No accumulation. ✅

### 53.13 Expanded slot color swatches — hover-only animation

> Refinement (2026-05-15): inside an expanded slot, the `BASE_COLOR_ARG` (and other RgbArg) swatches and the **Detected Base Color** swatch are static by default and only animate on hover. An expanded slot can contain multiple swatches; animating them all continuously was too expensive. Also fixed: the Detected Base Color controller wasn't being destroyed when the slot closed.

- [x] TC-1009: Expand a slot with one or more color args (`BASE_COLOR_ARG`, secondary RgbArg, etc.) → swatches are **static**, no animation ticking. ✅
- [x] TC-1010: Hover a slot color swatch → that swatch animates. Mouse out → animation stops. ✅
- [x] TC-1011: Library style with a hardcoded base color → **Detected Base Color** swatch is static; hover animates; mouse out stops. ✅
- [x] TC-1012: Collapse a slot that had its Detected Base Color swatch visible → no leftover animation continues to tick in the background (controller destroyed on close — verified in DevTools that no orphan rAF activity remains). ✅

---

## 54. LINUX SERIAL PERMISSION NOTICE (dialout group)

> **Pending — requires Linux pass.** All TCs in this section need a Linux environment to verify (banner detection reads `/sys/bus/usb/devices`; copy-paste verifies in a Linux terminal; etc.). Left unchecked until the Linux QA pass.

### 54.1 Detection & banner display

- [ ] TC-795: *(Linux)* User NOT in `dialout` group, plug in Proffieboard → `/sys/bus/usb/devices` shows the device (VID 1209, PID 6668); no `/dev/ttyACM*` accessible to the user → yellow banner appears beneath the toolbar with the dialout message and `Copy Commands` button
- [ ] TC-796: *(Linux)* After adding user to dialout group and rebooting, plug in Proffieboard → banner does NOT appear; serial port detected normally
- [ ] TC-797: *(Linux)* Unplug board → banner hides on next port poll/refresh
- [ ] TC-798: *(Linux)* Plug board back in → banner reappears (if still no permissions)

### 54.2 Banner content & interaction

- [ ] TC-799: *(Linux)* Banner text reads: "Proffieboard detected via USB but serial port access is blocked. Add yourself to the `dialout` group, then reboot:" followed by the command `sudo usermod -aG dialout $USER`
- [ ] TC-800: *(Linux)* `Copy Commands` button copies `sudo usermod -aG dialout $USER` to the clipboard verbatim (no shell escapes)
- [ ] TC-801: *(Linux)* After clicking Copy, button text briefly changes to "Copied!" then reverts to "Copy Commands" after ~2 s
- [ ] TC-802: *(Linux)* Pasted command works in a real Linux terminal (manual verification): runs without syntax errors, adds user to dialout, requires reboot/logout to take effect

### 54.3 Platform gating

- [ ] TC-803: *(Windows)* Banner never appears — `checkLinuxUsbPresence()` returns false on non-Linux platforms
- [ ] TC-804: *(macOS)* Banner never appears
- [ ] TC-805: *(Linux, no Proffieboard plugged in)* Banner does not appear (no USB device matches VID:1209/PID:6668)

### 54.4 Integration with port polling

- [ ] TC-806: *(Linux)* Banner visibility tracks the `linuxSerialPermissionIssue` flag in `getRecommendedPort` results; updates on every port refresh (background poll, manual refresh button, port-changed event)
- [ ] TC-807: *(Linux)* Banner doesn't flicker when polling fires repeatedly with the same state

---

## 55. FIRST-RUN TOOLCHAIN SETUP TRANSPARENCY

> Driven by `toolchain.needsCoreInstall()` (sentinel-based: `.core-installed` file in Arduino data path with current `CORE_VERSION`).

### 55.1 First launch behavior

- [ ] TC-808: Fresh install (no `.core-installed` sentinel, or sentinel doesn't match current `CORE_VERSION`) → on app launch, toolchain status shows "Setting up build tools..." with pending (yellow/dim) indicator
- [ ] TC-809: First launch → Build Output panel auto-opens (does NOT stay collapsed) so the user sees install progress
- [ ] TC-810: First launch → blue notice `#bp-setup-notice` is visible inside Build Output: "First-time setup: downloading and installing required build tools. This only happens once and may take several minutes on slower connections. Compile and flash will be available when setup is complete."
- [ ] TC-811: While toolchain-setup status is pending, port/compile/flash status indicators are hidden (no broken Compile button visible)

### 55.2 Completion behavior

- [ ] TC-812: After core install completes, toolchain status flips to "Toolchain ready" (green/ok); `bp-setup-notice` hides automatically
- [ ] TC-813: After completion, port/compile/flash indicators reappear and behave normally
- [ ] TC-814: Sentinel `.core-installed` is now written to disk with the current `CORE_VERSION` string

### 55.3 Subsequent launches

- [ ] TC-815: Relaunch app after successful first-run → `needsCoreInstall()` returns false (sentinel matches version) → no toolchain-setup banner, Build Output stays collapsed, toolchain ready immediately
- [ ] TC-816: Manually delete the `.core-installed` sentinel → relaunch → first-run flow fires again (banner shown, Build Output opens)
- [ ] TC-817: Bump `CORE_VERSION` constant (simulated via dev build) → relaunch → first-run flow fires again (version mismatch detected)

### 55.4 Error handling

- [ ] TC-818: First launch with no internet → toolchain install fails → status flips to error with a meaningful message; `bp-setup-notice` hides; Build Output stays open so user can see the error log
- [ ] TC-819: First launch is interrupted (user closes app mid-install) → on next launch, `needsCoreInstall()` correctly detects the install is incomplete (sentinel never written) → first-run flow re-fires

---

## 56. IN-APP CONFIRM MODAL — MIGRATION

> Native `window.confirm()` calls in the renderer have been replaced with the in-app `promptConfirm({title, message, confirmText, confirmKind})` helper. Bank delete (covered in §52.11c) and the three Style Library sites below.

### 56.1 Style Library — Remove Style Library button

- [ ] TC-820: Style Library tab → click "Delete" (toolbar) → in-app modal opens with title "Remove Style Library" and body "Remove Style Library from JMT Studio? Any changes made since importing will be lost." Confirm button labeled "Remove" with destructive (red) styling
- [ ] TC-821: Cancel → modal closes, library untouched, all tabs/state preserved
- [ ] TC-822: Confirm → library is deleted; Style Library tab hides; tab focus falls back to Config Manager
- [ ] TC-823: Modal renders correctly in both light and dark mode

### 56.2 Style Library — Delete Style (visual view, card delete)

- [ ] TC-824: Click × on a style card → in-app modal opens with title "Delete Style" and body `Delete style "NAME"? This will remove it from your style library.` Confirm button labeled "Delete" (red)
- [ ] TC-825: Cancel → card remains, library state unchanged
- [ ] TC-826: Confirm → style removed from library, card disappears from grid, library marked dirty
- [ ] TC-827: Style name is quoted exactly as it appears in source (no escaping/transformation)

### 56.3 Style Library — Delete Helper (helpers panel)

- [ ] TC-828: Delete a helper that has NO dependents → in-app modal opens with title "Delete Helper" and body `Delete helper "NAME"? It has no known dependents in this file.`
- [ ] TC-829: Delete a helper that HAS dependents → modal body lists every affected style (`• Style1\n• Style2\n...`); Confirm marks those dependents as broken (red) in the visual view
- [ ] TC-830: Confirm message text formats line breaks correctly (each dependent on its own line)
- [ ] TC-831: Cancel → helper and dependents all preserved

### 56.4 Regression — no native `window.confirm` calls remain

- [ ] TC-832: Grep the renderer for `window.confirm(` or bare `confirm(` → no callsites should remain except inside the `_wireStyleNameSanitize` history comment
- [ ] TC-833: All four sites (bank delete, remove library, delete style, delete helper) use the same modal element (`#modal-confirm`) — never two modals open at the same time

---

## 57. portDetector JSON REFACTOR — REGRESSION

> `parseBoardList()` rewritten to consume `arduino-cli board list --json` instead of regex-parsing tabular output. Closes the "regex fragile" backlog item.

### 57.1 Detection still works on all platforms

- [ ] TC-834: *(Windows)* Connect Proffieboard V3 → detected; port path (`COM3` etc.) shown in port dropdown
- [ ] TC-835: *(Mac)* Connect Proffieboard → detected; `/dev/cu.*` path shown (not `/dev/tty.*` — tty→cu normalization preserved)
- [ ] TC-836: *(Linux)* Connect Proffieboard → detected; `/dev/ttyACM*` path shown
- [ ] TC-837: Detected board name and SN displayed correctly (no garbled characters from JSON parsing)

### 57.2 Multi-board scenarios

- [ ] TC-838: Two Proffieboards plugged in simultaneously → both appear in port dropdown with their SNs
- [ ] TC-839: Mix of Proffieboard + other USB serial devices (e.g. an Arduino Uno) → only the Proffieboard(s) are tagged as recommended; other devices appear but are not selected by default

### 57.3 No board / edge cases

- [ ] TC-840: No board connected → JSON output is empty array `[]`; port dropdown shows "—", no parse errors logged
- [ ] TC-841: arduino-cli returns malformed JSON (simulated corruption) → graceful failure, no crash; "—" shown
- [ ] TC-842: arduino-cli not installed yet (mid-toolchain-install) → falls through without crashing; refresh after install succeeds populates correctly

### 57.4 Behavioral parity with the old regex parser

- [ ] TC-843: Detected field shows the same information format as 1.6.5 (SN displayed, no V2/V3 inference since that's not derivable from USB data — see qa-1.6.3 BUG-035)
- [ ] TC-844: Recommended port auto-selection preserved (single Proffieboard auto-selects; multi-board cases require user choice)

---

## 58. STYLE LIBRARY — CHARGING STYLES SECTION

> New section in `my_styles.h` for styles that depend on JMT functions (currently `ChargeFullPropF` from `../functions/charge_full_prop.h`). Library entries that reference any symbol in `_SL_JMT_DEPENDENT_SYMBOLS` are auto-classified as `isCharging` and emitted under a `Charging Styles` banner wrapped in `#ifdef FUNCTIONS_CHARGE_FULL_PROP_H` / `#endif`. Section order in the file: Helper functions → Charging Styles → Using styles. Auto-migration uses the same machinery that auto-orders Helper functions today.

### 58.1 Classification on Add to Library

- [x] TC-845: Add to Library on a style that contains `ChargeFullPropF` anywhere in its expression → on next save the entry lands inside the Charging Styles section, between Helper functions and Using styles ✅
- [x] TC-846: Add to Library on a style that does NOT contain any JMT-dependent symbol → entry lands in Using styles section as before, no Charging Styles section emitted unless other charging entries exist ✅
- [x] TC-847: Detection is word-boundary based — a comment or string literal containing the word `ChargeFullPropF` would trigger classification (acceptable: user could comment-disable a charging entry and it'd still be guarded; doesn't break anything) ✅

### 58.2 Section banner and ifdef wrap

- [x] TC-848: After a save with at least one charging entry, the file contains the literal banner `/*****************************\n    Charging Styles\n*****************************/` ✅
- [x] TC-849: Immediately after the banner, the line `#ifdef FUNCTIONS_CHARGE_FULL_PROP_H` appears; the matching `#endif // FUNCTIONS_CHARGE_FULL_PROP_H` appears after the last charging entry in that section ✅
- [x] TC-850: All charging entries (and only charging entries) sit between the `#ifdef` and the `#endif`; helpers and non-charging styles are outside the guard ✅

### 58.3 Section ordering

- [x] TC-851: File order is consistently: JMT header → preamble → Helper functions section → Charging Styles section → Using styles section. Any section that has zero entries is omitted entirely (no empty banner) ✅
- [x] TC-852: If only charging entries exist (no helpers, no non-charging styles) → file contains JMT header + Charging Styles section + the `#ifdef` wrap; no empty Helper or Using banners ✅

### 58.4 Auto-migration of existing libraries

- [x] TC-853: Open a pre-1.7.0 style library where a `ChargingButtonStyle` (or any ChargeFullPropF-using entry) was sitting in the Using styles section without a guard → on next Save, entry migrates into a new Charging Styles section with the `#ifdef` wrap. No manual user action needed. ✅
- [x] TC-854: Same migration also fires on Style Library load via `_applyStyleLibraryStructure` at renderer/index.html:4445 — opening the Style Library tab on a pre-existing file rebuilds with the new structure ✅

### 58.5 Helpers vs charging precedence

- [x] TC-855: An entry that is BOTH a helper (referenced by another entry) AND charging (contains ChargeFullPropF) → classified as charging and lands in the Charging Styles section, NOT in Helper functions. Reason: it has to be inside the guard or it'll fail to compile without the JMT include. ✅

### 58.6 Strip and re-emit cycle

- [x] TC-856: `_stripStyleLibraryStructure` correctly unwraps the `#ifdef FUNCTIONS_CHARGE_FULL_PROP_H` / `#endif` pair as a paired match, preserving the entries between — no bare `#endif` lines accidentally stripped from elsewhere in the file (verified by trying a file with no other directives, only the charging guard) ✅
- [x] TC-857: Multiple save cycles on the same content produce identical output (idempotent — no drift in directive placement, banner spacing, or whitespace) ✅

### 58.7 Compile behavior

- [x] TC-858: Config that includes `../functions/charge_full_prop.h` (via JMT wrapper) compiles cleanly — charging entries' `using` declarations resolve, `StylePtr<ChargingButtonStyle>()` references work ✅
- [x] TC-859: Config that does NOT include the JMT charge-full-prop header compiles cleanly — `FUNCTIONS_CHARGE_FULL_PROP_H` undefined, preprocessor skips the entire Charging Styles block, `ChargeFullPropF` is never referenced, no symbol errors ✅
- [x] TC-860: Same non-JMT config with a preset that DOES reference `StylePtr<ChargingButtonStyle>()` → compile correctly fails because the alias isn't defined (expected — user has a wrong combo and we want the error, not silent breakage) ✅

### 58.8 Visual view

- [x] TC-861: Style Library visual view (cards) renders charging entries identically to other entries — the `#ifdef`/`#endif` directive lines are transparent to the parser; cards show name, source, search blob, etc. as normal ✅
- [x] TC-862: Search across cards still matches against charging entries (no accidental filtering by section) ✅

### 58.9 Delete handling

- [x] TC-863: Delete the last charging entry from the library → next save removes the entire Charging Styles section, its banner, and the `#ifdef`/`#endif` wrap (no empty guarded block left behind) ✅
- [x] TC-864: Delete a non-last charging entry → section + wrap remain; remaining charging entries stay inside ✅

---

## 59. NEW CONFIG — TEMPLATE SCAFFOLD

> `+ New` now opens a choice modal (Blank vs Use Template) — same shape as the Style Library create modal. "Use Template" reads from `userData/templates/default.h`, creating it on demand with a shipped V3 scaffold the first time. The same file is editable via Settings (Import / Reset to Default). Section-ordering fix: when `_addFirstPreset` / `_addPresetBank` falls through to the "no Preset block, no BladeConfig" branch and an `#ifdef CONFIG_BUTTONS` already exists, the fresh `#ifdef CONFIG_PRESETS` scaffold now lands BEFORE `CONFIG_BUTTONS` (was: end of file — out of order).

### 59.1 New Config modal

- [x] TC-865: Click `+ New` (toolbar) → modal "New Config" appears with title, close (×), text "Start with a blank file or use a structural template.", two primary buttons "+ Blank" and "📋 Use Template" ✅
- [x] TC-866: Click `+ Create New Config` (empty state, when no file is open) → same modal as TC-865 (single source) ✅
- [x] TC-867: Modal × close → cancels; editor unchanged; no new-config state ✅
- [x] TC-868: Unsaved-changes guard fires BEFORE the modal opens — if current file is dirty, Save/Discard/Cancel guard appears first; Cancel returns without opening the modal ✅
- [x] TC-869: Modal close handlers are wired one-shot per open — opening the modal twice in a row doesn't double-fire any button click ✅

### 59.2 Blank path

- [x] TC-870: From modal → click "+ Blank" → editor clears, filename field becomes editable, blue editing styling visible (existing new-config behavior preserved) ✅
- [x] TC-871: After Blank, editor is NOT dirty until user types — Save button disabled, no ● indicator in title bar ✅

### 59.3 Use Template path — first use (template file does not exist)

- [x] TC-872: First click of "Use Template" creates `<userData>/templates/default.h` with the shipped V3 scaffold content (DEFAULT_CONFIG_TEMPLATE in main.js); editor populates with that content ✅
- [x] TC-873: Editor is marked DIRTY after template load (template is not on disk yet — user must Save As); ● indicator visible in title bar; Save enabled ✅
- [x] TC-874: Filename field is editable (same new-config state as Blank); pre-filled with placeholder/default name ✅
- [x] TC-875: Template content includes all four standard sections in correct order: CONFIG_TOP → CONFIG_PROP → CONFIG_PRESETS → CONFIG_BUTTONS; CONFIG_PRESETS contains both a populated `Preset presets[]` and a populated `BladeConfig blades[]` ✅

### 59.4 Use Template path — subsequent uses

- [x] TC-876: Second click of "Use Template" (file already exists) → reads file as-is, does not overwrite or revert ✅
- [x] TC-877: Manually edit `<userData>/templates/default.h` outside the app (or via Import) → next "Use Template" click reflects the edits in the editor (file-based read is the source of truth, no caching) ✅

### 59.5 Section ordering — fresh CONFIG_PRESETS scaffold

- [x] TC-878: Config has `#ifdef CONFIG_BUTTONS` but no `#ifdef CONFIG_PRESETS` and no bare BladeConfig → click `+ Add Preset` (or strip `+` for new bank) → fresh `#ifdef CONFIG_PRESETS / Preset / #endif` scaffold lands IMMEDIATELY BEFORE `#ifdef CONFIG_BUTTONS`, not appended at end of file. Section order preserved: TOP → PROP → PRESETS → BUTTONS. ✅
- [x] TC-879: Same path with no CONFIG_BUTTONS in the file → fresh scaffold appends at end of file as before (no regression) ✅

### 59.6 Settings — Default Config Template row

- [x] TC-880: Settings modal shows "Default Config Template" row between "Recent Files" and the dev-only Style Library toggle; two buttons "Import" and "Reset to Default" ✅
- [x] TC-881: On Settings open, status is checked: if file content matches DEFAULT_CONFIG_TEMPLATE byte-for-byte → "Reset to Default" is disabled (muted/not clickable); if content differs → enabled ✅
- [x] TC-882: Status check also fires after any Reset / Import action, so the button enable/disable state stays consistent without closing/reopening Settings ✅

### 59.7 Reset action — inline confirmation panel

- [x] TC-883: Click "Reset to Default" (when enabled) → inline confirmation panel slides in below the row (same shape as Clear Cache); buttons "Cancel" and "Yes, Reset" (danger styling); main Reset button disables while panel is open ✅
- [x] TC-884: Confirmation text reads "Reset to default template?" (no "shipped version" wording per Ryan's edit) followed by "Any customizations you made to the template file will be lost. This does not affect saved config files." ✅
- [x] TC-885: Click "Cancel" → panel hides, Reset button re-enables based on current status, no file change ✅
- [x] TC-886: Click "Yes, Reset" → button shows "Resetting…" briefly → on success: panel hides, Reset button re-evaluates (now matches default → disabled). File at `<userData>/templates/default.h` overwritten with DEFAULT_CONFIG_TEMPLATE. ✅
- [x] TC-887: On reset failure (e.g. write error) → button shows "✗ Failed" for ~2.2s then returns to "Yes, Reset"; console logs the error ✅

### 59.8 Import action

- [x] TC-888: Click "Import" → native file picker opens with `.h` filter (and "All Files" fallback); title "Import Default Template" ✅
- [x] TC-889: User cancels file picker → button returns to "Import" silently, no feedback, no file change ✅
- [x] TC-890: User selects a `.h` file → file content is copied to `<userData>/templates/default.h` (overwriting); button shows "✓ Imported" for ~1.8s then returns to "Import" ✅
- [x] TC-891: After successful Import, status is refreshed: if imported content differs from DEFAULT_CONFIG_TEMPLATE → Reset to Default becomes enabled ✅
- [x] TC-892: After Import, next "Use Template" click in `+ New` reflects the imported content (file is the source of truth) ✅
- [x] TC-892a: **Fix (this session)** — when the imported source file has JMT metadata (`// Configuration edited with JMT Studio` + `// @jmt:<key> ...` lines for `config_id`, `name`, `created`, `updated`, `board`, `description`, etc.), those lines are **stripped** before writing to the template file. Templates are neutral starting points and shouldn't carry an imported config's identity / lineage. Leading blank lines left by the strip are also trimmed. ✅

### 59.9 Dev / prod path separation

- [x] TC-893: In dev mode (`npm start`), template file lives at `%APPDATA%/jmt-studio-dev/templates/default.h` ✅
- [ ] TC-894: In a packaged production build, template file lives at `%APPDATA%/jmt-studio/templates/default.h` (separate from dev — they don't share state)
- [ ] TC-895: *(Mac)* Template path is `~/Library/Application Support/jmt-studio/templates/default.h` (or `jmt-studio-dev/...` in dev)
- [ ] TC-896: *(Linux)* Template path is `~/.config/jmt-studio/templates/default.h`

### 59.10 Regression — existing new-config flow

- [x] TC-897: Filename field state transitions (TC-485, TC-486) still work after modal-based new-config flow — readonly mode restored after first save, no leftover `.editing` class ✅
- [x] TC-898: Favorites star still blocked until first save (TC-475) on template-loaded new config (same dirty-without-path state) ✅
- [x] TC-899: Close (X) with unsaved template content fires unsaved-changes guard (TC-489) ✅

---

## 60. BOARD DROPDOWN — INCLUDE LINE IS SOURCE OF TRUTH

> Board dropdown (V1/V2/V3) now mirrors the `#include "proffieboard_vN_config.h"` line in the config. Live auto-detect on edits (250ms debounce). User dropdown click rewrites the include line in place as a single undoable Monaco edit, with a toast notification + brief line-flash decoration. When no board include exists, a confirm modal asks before inserting one — placement: inside existing `#ifdef CONFIG_TOP` (top of block) if present, else a fresh CONFIG_TOP scaffold at the top of the file (after leading comments). Validated with Proffie Pro before shipping.

### 60.1 Include line wins at load time

- [x] TC-900: Open a config with `#include "proffieboard_v3_config.h"` and NO `@jmt:board` metadata → dropdown shows Proffieboard V3 ✅
- [x] TC-901: Open a config with `#include "proffieboard_v2_config.h"` AND `@jmt:board Proffieboard V3` metadata → dropdown shows V2 (include wins; metadata is fallback only) ✅
- [x] TC-902: Open a config with no recognized include but `@jmt:board Proffieboard V3` metadata → dropdown shows V3 (metadata fallback fires when include absent) ✅
- [x] TC-903: Open a config with no include and no metadata → dropdown empty (no detection possible) ✅
- [x] TC-904: Commented-out include `// #include "proffieboard_v3_config.h"` is NOT detected (regex requires start-of-line) → dropdown empty/falls back to metadata ✅

### 60.2 Live auto-detect during editing

- [x] TC-905: Type `#include "proffieboard_v2_config.h"` into an open config → within ~250ms the dropdown updates to Proffieboard V2 ✅
- [x] TC-906: Manually edit existing V3 include to V1 → after debounce, dropdown updates to "Proffieboard" (V1) ✅
- [x] TC-907: Delete the include line entirely → dropdown stays at its last value (no auto-clear; preserves last-known intent) ✅
- [x] TC-908: Type a malformed include (e.g. `proffieboard_v9_config.h`) → regex doesn't match → dropdown stays at current value ✅
- [x] TC-909: Comment out the include line → dropdown stays at last value (commented line doesn't match regex) ✅
- [x] TC-909a: Misspelled directive (e.g. `#inlcude "proffieboard_v3_config.h"`) → regex requires the exact `#include` keyword → no detection, dropdown unchanged. Fails by design (we don't try to "guess" intent from typos). ✅

### 60.3 Dropdown click rewrites include — existing include path

- [x] TC-910: Existing `#include "proffieboard_v3_config.h"` + click dropdown Proffieboard V2 → include line rewrites in place to `proffieboard_v2_config.h`. Single Monaco edit; Ctrl+Z reverts the entire rewrite as one undo step. ✅
- [x] TC-911: Toast appears bottom-right: "Board changed to Proffieboard V2 (include updated)." Auto-dismisses after ~4.5s. ✅
- [x] TC-912: Editor line containing the include flashes blue background for ~2.7s (200ms solid hold, then 2.4s CSS fade-out) — visible cue that the line was changed. ✅
- [x] TC-913: Original line's leading whitespace/indentation is preserved on rewrite (e.g. `\t#include "..."` stays tab-indented) ✅
- [x] TC-914: Repeated switching V3 → V2 → V3 → V2 works cleanly; each click is a separate undoable edit; no leftover decorations or stuck state ✅

### 60.4 No-op fast path

- [x] TC-915: Dropdown already V3 + include already V3 + user re-selects V3 → no rewrite, no toast, no flash (matching-state guard fires) ✅
- [x] TC-916: Programmatic dispatch — loadContent setting the dropdown via `dispatchEvent(new Event('change'))` → `event.isTrusted` is false → rewrite handler bails. Verified: opening a config doesn't trigger a phantom rewrite-toast. ✅
- [x] TC-917: Auto-detect's own `dispatchEvent` (after live detection) → same isTrusted=false → no rewrite cascade. No ping-pong between rewrite and auto-detect. ✅

### 60.5 Confirm modal — no include present

- [x] TC-918: Blank config (no include line anywhere) + click dropdown Proffieboard V3 → modal "Insert Board Include?" appears with two-paragraph body: "Your config has no board include yet." followed by "Add #include "proffieboard_v3_config.h" to make Proffieboard V3 part of the config?" Buttons: Cancel + Insert (green/save styling). ✅
- [x] TC-919: Click Cancel → modal closes, no file change, no toast, no flash. Dropdown stays at the chosen value (it was set before the modal opened, since the click event already fired). ✅
- [x] TC-920: Click Insert → include is inserted per placement rule (see 60.6 / 60.7), toast: "Board include added (Proffieboard V3).", line flashes ✅

### 60.6 Placement on insert — existing CONFIG_TOP

- [x] TC-921: File has `#ifdef CONFIG_TOP` block with `#define NUM_BLADES 1` etc. inside but NO board include → confirm → Insert → `#include "proffieboard_vN_config.h"` is inserted on the line immediately after `#ifdef CONFIG_TOP`, ABOVE all other content in the block. Other defines preserved unchanged. ✅
- [x] TC-922: Single undoable Monaco edit — Ctrl+Z removes the entire inserted line ✅

### 60.7 Placement on insert — no CONFIG_TOP

- [x] TC-923: File has no `#ifdef CONFIG_TOP` anywhere → confirm → Insert → fresh `#ifdef CONFIG_TOP\n#include "proffieboard_vN_config.h"\n#endif\n\n` block created at top of file ✅
- [x] TC-924: File starts with `// header comment` lines → block inserted AFTER the leading comments (comments preserved at top of file, CONFIG_TOP block follows) ✅
- [x] TC-925: File starts with a multi-line `/* block comment */` → block inserted after the closing `*/` ✅
- [x] TC-926: Empty file (no content at all) → block inserted at line 1 ✅
- [x] TC-927: File starts with content (no leading comments) → block inserted at line 1, pushing existing content down ✅

### 60.8 Regression

- [x] TC-928: Existing `onInputBoardChange` (FQBN update, cache check, recompile-needed status) still fires on both user dropdown clicks AND programmatic dispatches — no regression from adding the rewrite listener as a parallel change handler ✅
- [x] TC-929: Use Template flow — the template's `#include "proffieboard_v3_config.h"` correctly sets the dropdown to V3 at load (via include-first precedence) ✅
- [x] TC-930: Open an existing config that previously had `@jmt:board V2` saved + matching V2 include → dropdown shows V2 (include wins, but matches metadata anyway — no surprise) ✅

---

## 61. ATOMIC UNDO — BUTTON-INITIATED EDITS REGRESSION

> Every button-initiated `executeEdits` in `renderer/index.html` now goes through `_atomicEdit(monacoEditor, source, edits)` which wraps with `pushUndoStop()` before AND after. Each user action should produce exactly one undo step, never coalescing with typing or with another button click. The mixed-cadence test (click, click, type, click, click → 5 undos to fully revert) is the canonical signal.

### 61.1 Canonical mixed-cadence test

- [x] TC-931: Open a config with a populated Preset bank. Click + Add Preset twice → type 5 characters in the editor (anywhere, e.g. add a comment) → click + Add Preset twice more. Press Ctrl+Z five times. Each press should revert exactly one action in reverse order: last preset, prior preset, the typing, second preset, first preset. After 5 undos, file is back to original state. Ctrl+Y five times redoes them all in order. ✅

### 61.2 Preset operations (Add Preset cluster — atomic check)

- [x] TC-932: Click + Add Preset on a populated bank → Ctrl+Z reverts exactly that one entry (not adjacent typing or prior clicks) ✅
- [x] TC-933: Click + Add Preset on an EMPTY bank (whole-block replace path via `_insertFirstEntryIntoArray`) → Ctrl+Z restores the empty bank precisely; not just the entry text ✅
- [x] TC-934: Click + Add Preset when no Preset[] exists (scaffold creation via `_addFirstPreset`) → Ctrl+Z removes the entire scaffolded block in one step ✅
- [x] TC-935: Bank `+` (Add Bank) → Ctrl+Z removes the new bank declaration and its first preset entry as one step ✅
- [x] TC-936: Bank context menu → Duplicate → Ctrl+Z removes the duplicate bank in one step ✅
- [x] TC-937: Bank context menu → Delete (confirmed) → Ctrl+Z restores the deleted bank with all its entries intact ✅

### 61.3 Preset detail / field edits

- [x] TC-938: Edit a preset's font folder field, commit → Ctrl+Z reverts to the original folder value in one step (no character-by-character reversal) ✅
- [x] TC-939: Edit a preset's track field, commit → same atomic-undo behavior ✅
- [x] TC-940: Edit a preset's display name, commit → same atomic-undo behavior ✅
- [x] TC-941: Open the slot editor on a style tile, change a template parameter, save → Ctrl+Z reverts the whole slot save in one step ✅
- [x] TC-942: Slot editor — replace an entire slot expression (library style ↔ custom expression) → Ctrl+Z reverts in one step ✅

### 61.4 Preset list operations

- [x] TC-943: × delete a preset → Ctrl+Z restores the preset with its font, track, styles, and display name intact ✅
- [x] TC-944: Right-click → Disable preset → Ctrl+Z re-enables it (single undo) ✅
- [x] TC-945: Right-click → Enable disabled preset → Ctrl+Z re-disables it ✅
- [x] TC-946: Delete a disabled preset → Ctrl+Z restores the disabled preset (still in disabled state) ✅
- [x] TC-947: Drag-reorder preset within a bank → Ctrl+Z reverts the order in one step ✅
- [x] TC-948: Right-click → Isolate preset (debug) → Ctrl+Z restores all other presets to their original state. Focus deferred to next tick so Ctrl+Z reaches Monaco without an extra click. ✅

### 61.5 Preset bank rename

- [x] TC-949: Click pencil ✎ → type new name → Enter → Ctrl+Z reverts the rename in one step (not character-by-character) ✅

### 61.6 Toolbar source-modification buttons

- [x] TC-950: Click Link Style Library → Ctrl+Z reverts the inserted `#include` AND any scaffolding (e.g. `#ifdef CONFIG_PRESETS` wrap if added) as one step ✅
- [x] TC-951: Click Link Style Library on a config with a conflicting include → choose "Comment Out & Link" → Ctrl+Z reverts BOTH the comment-out AND the new include in one step ✅
- [x] TC-952: Click Link Style Library on a config with a conflicting include → choose "Remove It" → Ctrl+Z restores the removed include AND removes the new one in one step ✅
- [x] TC-953: Click Link JMT Add-ons → Ctrl+Z reverts the inserted wrapper include in one step ✅
- [x] TC-954: Link JMT Add-ons with conflict → Comment Out & Link / Remove It → Ctrl+Z reverts both edits in one step ✅
- [x] TC-954a: Link Style Library on a config with `#ifdef CONFIG_BUTTONS` but no `#ifdef CONFIG_PRESETS` → new CONFIG_PRESETS scaffold is inserted **before** CONFIG_BUTTONS, not appended after it (correct ProffieOS section order: TOP → PROP → PRESETS → BUTTONS). ✅

### 61.7 Board dropdown source modifications

- [x] TC-955: Existing `#include "proffieboard_v3_config.h"` + click dropdown V2 → include rewrites to V2 → Ctrl+Z reverts to V3 in one step (the rewrite is a single Monaco edit by design — TC-910 covered the basic case; this verifies undo isolation from other edits) ✅
- [x] TC-956: No include + click dropdown V3 + confirm Insert → new `#ifdef CONFIG_TOP` block with include inserted → Ctrl+Z removes the entire scaffolded block in one step ✅
- [ ] TC-957: Existing CONFIG_TOP + no board include + click dropdown V3 + confirm Insert → include inserted into existing CONFIG_TOP → Ctrl+Z removes just that line, CONFIG_TOP's other content intact

### 61.8 Coalescing-prevention edge cases

- [x] TC-958: Two rapid clicks on the same action button (e.g. + Add Preset twice within 100ms) → Ctrl+Z reverts each separately (no rapid-fire coalescing) ✅
- [x] TC-959: Action button click immediately followed by a single keystroke in the editor → Ctrl+Z reverts the keystroke first, then the action (no merge) ✅
- [x] TC-960: Typing in the editor immediately followed by an action button click → Ctrl+Z reverts the action first, then the typing (no merge) ✅
- [x] TC-961: After Ctrl+Z reverts an action, Ctrl+Y redoes it cleanly with no residual state (no orphan decorations, no stale parse results) ✅

### 61.9 Functional regression — verify operations still work end-to-end

> Any change to executeEdits wrapping has a non-zero risk of breaking the underlying behavior. Spot-check each operation type still produces correct source.

- [x] TC-962: Each operation in §61.2-§61.7 still produces the same source output as before the atomic-undo refactor (no shifted insertion points, no malformed output, no off-by-one line numbers) ✅
- [ ] TC-963: Operations that fire multiple internal `executeEdits` in a single user action (e.g. Link Style Library with conflict → 2 edits: comment-out + insert) still work correctly. Either both edits land OR neither does. Ctrl+Z reverts both as one user-perceived step.

### 61.10 Attached-comment preservation (scaffolder)

- [x] TC-964: Config has `#ifdef CONFIG_PRESETS` containing only `BladeConfig`, with a `// comment` line immediately above BladeConfig (no blank line between) → click + Add Preset → new Preset block is inserted ABOVE the comment, so the comment stays attached to BladeConfig. Comment and BladeConfig remain visually paired. ✅
- [x] TC-965: Same scenario but with multiple stacked `//` comments above BladeConfig (no blanks between them or to BladeConfig) → ALL of them stay with BladeConfig; Preset block goes above the entire comment cluster. ✅
- [x] TC-966: Same scenario but with a `/* single-line block comment */` above BladeConfig → also treated as attached and stays with BladeConfig. Multi-line `/* … */` blocks (closing `*/` on its own line) are also detected and walked back to their opener — the whole block is treated as a single attached unit. ✅
- [x] TC-967: Comment above BladeConfig but with a BLANK line between comment and BladeConfig → comment is NOT treated as attached (blank line breaks the attachment); Preset block inserts between the comment and BladeConfig. Acceptable: user's intent was ambiguous, blank-line convention takes precedence. ✅
- [x] TC-968: Bare BladeConfig outside any ifdef + `// comment` above it → click + Add Preset → the comment is INCLUDED in the new `#ifdef CONFIG_PRESETS` wrap, kept right above BladeConfig inside the wrap. ✅

### 61.11 Diff view (Show Changes / Compare File) — unified undo stack

> The diff editor's modified pane shares the main editor's Monaco model directly (Option A
> implementation). Edits in the diff go straight into the main model + undo stack — no
> separate stack, no merge step on close. Ctrl+Z behaves identically whether the diff is
> open or closed.

- [x] TC-969: Make several edits in the main editor (e.g. 3 + Add Preset clicks) → click "Show Changes" → close Show Changes without making any edits in the diff → press Ctrl+Z → undo reverts the last main-editor action. Verifies the diff transition doesn't wipe or duplicate any undo entries. ✅
- [x] TC-970: Make 3 main-editor edits → open Show Changes → make 2 edits in the diff's modified pane → press Ctrl+Z while still in diff view → reverts last diff-pane edit. Second Ctrl+Z reverts the other diff-pane edit. Third Ctrl+Z reverts the third main-editor edit. The undo stack walks back continuously, no boundary between diff-pane and main-editor edits. ✅
- [x] TC-971: Same as TC-969/TC-970 but for Compare File → undo behavior identical ✅
- [x] TC-972: Open Show Changes → close immediately without any edits → no spurious undo step. Ctrl+Z still goes back to the actual last action, not an empty no-op edit. Verifies the no-op-when-content-matches guard in closeDiff (defensive safety net even with shared model). ✅
- [x] TC-973: Make edits in diff view → close diff without any merge step happening (the shared-model design means no executeEdits should fire on close) → Ctrl+Y after closing redoes correctly without inserting a duplicate edit ✅
- [x] TC-974: Swap between Show Changes and Compare File and back to main editor — model disposal logic doesn't accidentally dispose the shared main-editor model (guard: `if (prev.modified !== curr) prev.modified.dispose()`). Verify by editing in the main editor after each transition; editor must remain functional. ✅

---

## 62. DIRTY MODAL — SAVE / SAVE AS / DISCARD + COMPILE FLOW

> Refinement (2026-05-16): compile no longer auto-saves silently. The unsaved-changes modal now offers a Save As button (between Discard and Save) for any flow where saving to a new path is meaningful, and the modal can selectively hide Discard for flows where discarding would be nonsensical (e.g. compile, which would otherwise build from the on-disk un-edited content). Compile walks config-dirty → styles-dirty in order, with cancel-from-Save-As-picker propagating as a hard stop on the compile.

### 62.1 Modal structure

- [x] TC-1013: Modal button order (when all shown): Cancel · Discard · Save As · Save. ✅
- [x] TC-1014: Save As is hidden by default; appears only when caller passes `{ saveAs: true }` to `promptUnsaved`. ✅
- [x] TC-1015: Discard is hidden when caller passes `{ discard: false }`. ✅
- [x] TC-1016: Save As styled green, matching the toolbar's Save / Save As `btn-green` styling. ✅

### 62.2 Compile flow — config dirty

- [x] TC-1017: Make any edit (dirty editor) → click Compile → unsaved-changes modal appears BEFORE compile starts (auto-save removed). ✅
- [x] TC-1018: Compile's modal shows Cancel · Save As · Save only — Discard is hidden (discarding would compile from on-disk un-edited content). ✅
- [x] TC-1019: Click Cancel → compile aborts; no source change; no compile started. ✅
- [x] TC-1020: Click Save (config has a path) → saves to current path → compile proceeds with fresh content. ✅
- [x] TC-1021: Click Save As → file picker opens; pick a path → file saved → compile proceeds using the new path / metadata. ✅
- [x] TC-1022: Click Save As → cancel the file picker → compile aborts (same effect as clicking Cancel on the dirty modal). ✅
- [x] TC-1023: Click Save when config has NO path → delegates to Save As → cancel the picker → compile aborts. ✅

### 62.3 Compile flow — style library dirty

- [x] TC-1024: Styles modal is only shown AFTER the config modal resolves (sequential, not concurrent). Skipped if config flow already aborted. ✅
- [x] TC-1025: Styles modal shows Cancel · Save only — no Save As (my_styles.h is at a fixed path) and no Discard. ✅
- [x] TC-1026: Click Cancel on styles modal → compile aborts. ✅
- [x] TC-1027: Click Save → my_styles.h saved → compile proceeds. ✅
- [x] TC-1028: Config not dirty + styles dirty → only the styles modal is shown; no config modal flash. ✅
- [x] TC-1029: Both config and styles dirty → config modal first, then styles modal, then compile starts. Cancelling either bails. ✅

### 62.4 Other guards — global Save As consistency

- [x] TC-1030: Close window (X / quit) with unsaved config → dirty modal shows Cancel · Discard · Save As · Save (Discard is still shown here because losing edits is a legitimate intent when closing). ✅
- [x] TC-1031: Close → Save / Save As → if the save (or picker) is cancelled, the app stays open instead of closing under the false assumption that the file got saved. ✅

### 62.5 Save / Save As return propagation

- [x] TC-1032: `doSave()` returns `true` on a successful write; returns `false` on write failure or when delegated-to Save As is cancelled. ✅
- [x] TC-1033: `doSaveAs()` returns `true` on a successful pick + write; returns `false` on file-picker cancel or write failure. ✅
- [x] TC-1034: `guardUnsaved()` returns `false` when the user's chosen Save / Save As didn't actually complete (cancelled picker, write failure) — consistent with picking Cancel. Surrounding actions (compile, close, navigate) bail accordingly. ✅

---

## Bug Log

| ID | TC | Severity | Description | Status |
|----|----|----------|-------------|--------|
| BUG-001 | §53 (TC-765, TC-772, TC-780, TC-783, TC-789, TC-791, TC-793) | P1 | Link JMT Add-ons inserted `../props/jmt_fett_prop.h` — wrong filename. Should be `../props/jmt_fett263_wrapper.h` (matches the include the JMT installer actually places, and matches the existing JMT-detector regex at renderer/index.html:4544). Fixed: 4 sites in renderer/index.html (`_JMT_PROP_INCLUDE_PATH`, `_JMT_PROP_INCLUDE_RE`, the commented-recovery detector, and the conflict-exclusion test) updated to `jmt_fett263_wrapper`. | Fixed |
| BUG-002 | §42 (TC-573) | P2 | "Install Now" button in About → Updates was unclickable: shown with not-allowed cursor and 50% opacity. Cause: the `#btn-install-update` element at renderer/index.html:2726 was missing the `enabled` class. The About-modal CSS at lines 967-968 makes `.settings-item-btn` disabled-looking by default and requires `.enabled` to make it interactive — every other About-modal button (Clear Cache, Check for Updates, Download Update) had `enabled`; this one didn't. Fixed: added `enabled` to the class list. | Fixed |
| BUG-003 | §42 (TC-573) | P2 | Unsaved-changes prompt fired twice on Install Now → Discard. Root cause: the install handler prompted (handler #1), then `installUpdate` IPC scheduled `app.quit()` in main; quit triggered `win.on('close')` at main.js:126 which sends `app:closing` back to renderer; the renderer's `onAppClosing` handler ran its own dirty-check (handler #2) — `isDirty` was still true because Discard doesn't clear the flag. Secondary issue: the install handler only checked config-dirty, ignoring unsaved styles, version notes, helper modal, and add-style modal — those would have been silently lost on install. Fixed by extracting the full guard chain into a shared `_runQuitGuards(verb)` function (renderer/index.html:8309-8349), wiring both the close handler and Install Now to call it, and adding a `_updateInstallPending` flag that short-circuits the close handler's guards when the install path has already run them. | Fixed |
| BUG-004 | §45 (new TC-610a/b/c) | P2 | Flash dead-ended with "DFU device not detected. Try pressing the reset button or reconnecting." when touch reset succeeded but the WinUSB driver wasn't bound to the current USB instance path. Common in real use — happens on first install, fresh USB port, new hub, or after Windows Update reshuffles bindings. Old behavior gave the user no path forward except manually entering Bootloader Mode. Fixed by having `toolchain.js flash()` call `detectDFU` on `waitForDfu` timeout: late race (`accessible`) → proceed to flash; otherwise → return `needsDfuDriver: true` flag. Renderer `onBuildDone` flash branch detects the flag, calls extracted `_setupDfuModeUI()` helper, and runs `startDfuWaitModal(true, true, false)` (isRetry skips boot instructions, autoFlash resumes once driver binds). Tested with deliberate Device Manager driver uninstall — recovery flow fires cleanly. | Fixed |
| BUG-005 | §35.6 (new TC-490a) | P2 | Clicking `+ New` after a successful compile left the Compile button stuck disabled, with status reading "Board changed — recompile needed" — even after the user re-selected the board, picked an OS version, and typed content. Root cause in `renderer/buildPanel.js`: callers (`onInputBoardChange`, content-change handler, USB change, OS version change, port-change-with-fqbn, DFU entry success) pre-set `cacheCheckPending = true` to disable Compile while an async cache check is in flight. But `checkCacheForConfig` has three early-return guards (no electronAPI, no `selectedFqbn`, empty editor content) that bail out without clearing the flag. The `+ New` flow hits this because `loadContent('', null)` dispatches a board=`''` change while content is still empty and FQBN about-to-be-cleared, so the cache check bails and `cacheCheckPending` is stuck `true` forever. `updateCompileButton` keeps the button disabled. Fixed in `checkCacheForConfig` by collapsing the guards into a single `canCheck` test and clearing `cacheCheckPending` + calling `updateCompileButton` on any bail-out. | Fixed |
| BUG-006 | §37 (new TC-525a) | P3 | Build modal log (`#bm-log`) accumulated across flash attempts — when the wait-flash watcher auto-triggered a retry (after a port disconnect during a failed flash) or the user clicked Retry Flash, the new attempt's "--- Flash started ---" line was appended below the prior attempt's error output. After several cycles the log became hard to read; users couldn't tell what was happening NOW vs what already failed. Cause: `doFlash` reused the open modal via `display = 'flex'` without clearing `bm-log`; only `showBuildModal` (compile entry) and the DFU-specific paths clear it. Fixed by adding `bm-log.innerHTML = ''` at the top of `doFlash`'s flash-execution path. The persistent build-output panel below the editor still preserves full history for diagnosis. | Fixed |
| BUG-007 | §47 (existing slot tile / detected-base-color path) | P3 | "Detected Base Color (Style Library)" reported the wrong color after converting a custom expression to a library entry via Add to Library. Example: an inline `StylePtr<Layers<AudioFlicker<RotateColorsX<Variation,Rgb<180,130,0>>,...>...>()` correctly detected the yellowish Rgb<180,130,0>; after "Add to Library" wrapped it as `using ReyScavenger = Layers<...>` and the preset became `StylePtr<ReyScavenger>()`, the same style was reported as White. Root cause in `renderer/index.html:10851-10861`: the library scanner only walked TitleCase named-color tokens and ignored `Rgb<...>` / `Rgb16<...>` literals, so an early `Rgb<180,130,0>` was skipped and a deeper-nested `White` (inside `AlphaL<White,Int<16000>>` within a `TransitionEffectL`) won by default. The custom-expression scanner at lines 10864-10889 already had the correct earliest-match-across-Rgb-and-named logic; the library scanner just never got the same treatment. Fixed by porting the same logic to the library branch — pick the earliest of `Rgb16<...>`, `Rgb<...>`, or named-color token. | Fixed |
| BUG-008 | §58 (TC-845 through TC-864) | New capability (not a regression) | Style Library entries that reference `ChargeFullPropF` made the user's whole library coupled to JMT-enabled OS versions: any config without `../functions/charge_full_prop.h` failed to compile because the `using` alias referenced an undeclared symbol, even when no preset actually used the alias. Ryan's reframe of the original per-entry `#ifdef` proposal: add `Charging Styles` as a third section in `my_styles.h` alongside the existing Helper / Using sections, wrap the whole section once with `#ifdef FUNCTIONS_CHARGE_FULL_PROP_H` / `#endif`. Implemented by reusing the existing strip-classify-emit machinery: added `_SL_CHARGING_HEADER`, `_SL_CHARGING_GUARD`, `_SL_JMT_DEPENDENT_SYMBOLS` constants; extended `_stripStyleLibraryStructure` to paired-match unwrap the `#ifdef`/`#endif`; added `entry.isCharging` to `_classifyStyleEntries`; updated `_applyStyleLibraryStructure` to emit the third section with the wrap (helpers → charging → using order, charging takes precedence over helper status). ~30 lines total. Existing libraries auto-migrate on next save or load — same machinery that auto-orders helpers today. | Fixed |
| BUG-009 | §46.1 (TC-615a, TC-615b) | P2 | Auto-add-first-preset under-counted blades when falling back to BladeConfig parsing — Ryan's V2 config with `WS281XBladePtr<128,...>()` + `DimBlade(30.0, WS281XBladePtr<...>())` (= 2 blades) produced 1 `StylePtr<Black>()` slot instead of 2. Two issues in `renderer/presetParser.js extractBladeCount`: (1) hardcoded `readBraceGroup(body.content, 1)` failed whenever the BladeConfig had whitespace or comments between the opening `{` and the first entry's `{` — `body.content[1]` was a newline, not a brace, so `readBraceGroup` returned null and the whole fallback short-circuited to `null` → caller defaulted to 1. (2) The original regex `\b(WS281XBladePtr\|...\|DimBlade\|...)\s*[<(]/g` counted the `WS281XBladePtr` inside `DimBlade(...)` separately, so even if (1) hadn't failed, the same config would have reported 3 blades. Fixed by scanning for the first nested `{` (skipping leading whitespace/comments) and by adding a `splitTopLevelCommas` helper that splits the entry by top-level commas (respecting `<>`, `()`, `{}`, strings, comments) then counts items whose OUTER identifier matches a blade type — so `DimBlade(WS281XBladePtr<...>())` counts as one slot (the outer DimBlade), not two. | Fixed |
| BUG-010 | §46.1 (TC-615c, TC-615d) | P2 | `_addFirstPreset` in `renderer/index.html` only handled two cases when no `Preset NAME[]` declaration was present: insert into existing Preset[], OR append a fresh `#ifdef CONFIG_PRESETS / Preset[] / #endif` scaffold at end of file. Two real-world scenarios fell through to the append path and produced wrong results: (1) `#ifdef CONFIG_PRESETS` already existed but contained only a BladeConfig (no Preset[]) → produced a DUPLICATE `#ifdef CONFIG_PRESETS` block at end of file. (2) Bare BladeConfig sat at top level outside any `#ifdef` → BladeConfig was left bare and the new Preset got appended in its own `#ifdef CONFIG_PRESETS` at end, splitting the logical pair into two locations. Fixed by adding two new branches before the fresh-scaffold fallback: (a) detect existing `#ifdef CONFIG_PRESETS` and insert Preset INTO it BEFORE any BladeConfig already inside (Preset-first per ProffieOS convention), else before `#endif`; (b) detect bare BladeConfig and replace its declaration in-place with a wrapped block containing Preset first, original BladeConfig second, then `#endif`. BladeConfig keeps its original file position. Same fix was then needed in `_addPresetBank` (bank-strip `+` button) which had a parallel scaffolding code path — refactored to share `_insertNewPresetScaffold` so the two entry points produce identical results. Section-ordering fix added at the same time: when fresh scaffold path runs and `#ifdef CONFIG_BUTTONS` exists, scaffold lands before it (not at EOF), preserving TOP → PROP → PRESETS → BUTTONS order. | Fixed |
| BUG-011 | §59 (TC-865 through TC-899) | New capability (not a regression) | `+ New` was a single-action button that always produced an empty editor — no starting point for new users. Added a two-button choice modal (Blank vs Use Template) mirroring the Style Library create modal, and an on-demand template file at `userData/templates/default.h` containing a V3 scaffold with all four ProffieOS sections (CONFIG_TOP / CONFIG_PROP / CONFIG_PRESETS / CONFIG_BUTTONS) and a populated Preset + BladeConfig. File is created on first request via `template:readDefault` IPC and read fresh each subsequent click — so any user modifications stick automatically. Settings → "Default Config Template" row exposes Import (file picker, replaces template) and Reset to Default (overwrites with shipped default). Reset uses the inline-panel confirmation pattern (matching Clear Cache); button is auto-disabled when current template content matches DEFAULT_CONFIG_TEMPLATE byte-for-byte (nothing to reset). Designed as a stepping stone toward 2.0's guided config generator — the file-based mechanism is the same, only the editing UX changes when we later add an in-app template editor. | Fixed |
| BUG-014 | §51 (TC-688 updated) | P2 | Hyphenated bank names (and style/helper names) broke the parser silently. Pencil rename → user types `my-bank` → original "permissive, commits as-is" design (TC-688) wrote `Preset my-bank[]` to source. The parser's identifier regex `\b(\w+)` doesn't match `my-bank` (hyphen isn't `\w`), so on next file load (or save/close/reopen) the bank disappeared from the visual view as if it didn't exist. Clicking "+ Add Preset" then scaffolded a duplicate `Preset presets[]` underneath, leaving the original `my-bank` bank orphaned. Worse: the rename UI updated the source in real time, so the visual view briefly looked correct while typing the partial name, then "broke" once the full hyphenated name committed. Fixed by extending `_wireStyleNameSanitize` (which already auto-converted spaces to underscores at input time) to also auto-convert hyphens — a typed `-` keystroke or hyphen in a paste becomes `_` immediately. Same function services style names, helper names, and preset bank renames, so the fix covers all entry points. Existing files with hyphenated names need manual one-time correction in source; future renames via the UI are protected. | Fixed |
| BUG-013 | §61 (TC-931 through TC-972) | P2 | Ctrl+Z reverted multiple user actions per press because Monaco's `executeEdits` coalesces nearby edits — including across different source strings, and including with adjacent typing — into a single undo step. Reproduction: click + Add Preset twice, type a few characters, click + Add Preset twice more → only 2 Ctrl+Z presses needed to fully revert all 5 actions. Fix: defined `_atomicEdit(monacoEditor, source, edits)` helper that wraps `executeEdits` with `editor.pushUndoStop()` before AND after, then converted all 23 button-initiated `executeEdits` callsites in `renderer/index.html` to use it. Covers every preset operation (add, delete, disable/enable, reorder, rename, duplicate, slot edits, field edits, template parameters), every bank operation, board dropdown rewrite + include insert, Link Style Library, and Link JMT Add-ons. Risk surface: 23 touched callsites — full regression coverage in §61. | Fixed |
| BUG-012 | §60 (TC-900 through TC-930) | New capability (not a regression) | Board dropdown (V1/V2/V3) had been an independent UI selector — could disagree with the `#include "proffieboard_vN_config.h"` line, which is meaningless because the compiler reads the include, not the dropdown. Reversed the precedence: `#include` line is the source of truth, `@jmt:board` metadata is defensive fallback. Live auto-detect on edit (250ms debounce) syncs the dropdown when the include line changes. User dropdown click rewrites the include line in place as a single undoable Monaco edit, with a toast ("Board changed to X (include updated).") and ~2.7s line flash. `event.isTrusted` guards the rewrite handler so programmatic dispatches from loadContent / auto-detect don't trigger phantom rewrites. When no include exists, a confirm modal asks before inserting one — placement: into existing `#ifdef CONFIG_TOP` at top of block if present, else fresh CONFIG_TOP scaffold at top of file (after leading comments, preserved verbatim). Misspelled / malformed directives correctly fail to match (by design — we don't guess from typos). Design validated with Proffie Pro before shipping; established the "scoped, visible, reversible" triad as a portable no-confirm-required green-light test for user-initiated source modifications. | Fixed |

**Severity:** P1 Blocker · P2 Major · P3 Minor · P4 Cosmetic

---

## Sign-off

- [ ] All P1 bugs resolved
- [ ] All P2 bugs resolved
- [ ] P3/P4 bugs reviewed and triaged
- [ ] Both dark and light modes verified
- [ ] Tested on Windows
- [ ] Tested on macOS (notarization, arch-aware updater, `checkArduinoRunning`, EBUSY)
- [ ] Tested on Linux (`.deb` install, AppImage, icon, udev rules, DFU flash)
- [ ] **Windows code signing applied** — production build signed via the Azure Artifact Signing cert; SmartScreen warning verified gone on a clean test install
- [ ] **Linux `.deb` metadata complete** — `Maintainer` field set in `electron-builder-linux.yml`, `license` field set in `package.json` / build config, SHA256 checksums published on the GitHub release
- [ ] Ready to ship
