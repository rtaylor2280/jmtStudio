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
- **Serial Monitor — smart auto-scroll, jump-pill, focus restore** — log tail-follows the latest line by default, but pauses snap-to-bottom while the user is scrolled up reading history (Discord/Slack pattern, fixes the Arduino IDE pet peeve). A `↓ N new` pill overlays the bottom-right of the log when scrolled up with new lines arriving; click to jump back to the tail. Manual scroll back to within ~20px of the bottom re-engages auto-scroll. Sending a command, clearing the log, or pressing End (when serial tab active and no input is focused) all snap to bottom and re-engage. Window-focus listener restores `bp-serial-input` focus on alt-tab return so the user can keep typing without clicking. Pill count caps at `99+`. Behavior preserved across pause/resume, tab switching, board reconnect after flash.

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
- [x] TC-490a: After a successful compile of file A, click `+ New` → re-select the board → pick an OS version → type content → Compile button becomes enabled (status shows "Not compiled" or "Config changed — recompile needed", NOT stuck "Board changed — recompile needed" with disabled button) — regression for BUG-005. Two related bugs surfaced and fixed during retest: (1) the prior file's flash status ("Flash successful") carried into the new file because `loadContent` didn't scrub it — added `window.resetBuildStatusForFileLoad` and called it from `loadContent`. (2) After `+ New` → Save with no manual typing, the new file path was set via `setFilePath` but `updateCompileButton` wasn't re-evaluated, so the button stayed disabled by its `!window._currentFilePath` gate — added a `window.updateCompileButton?.()` call inside `setFilePath` so any path mutation re-evaluates. ✅

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
- [x] TC-525a: Trigger a flash failure that causes the wait-flash watcher to auto-retry (e.g. flaky touch reset, board disconnect during flash) → on each retry attempt the build modal log clears to show only the CURRENT attempt's output (no piled-up prior-attempt errors above the new "--- Flash started ---"); persistent build-output panel below the editor still preserves the full history — regression for BUG-006 ✅

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
- [x] TC-553a: Compile fails on a C++ template error (e.g. `StylePtr<SomeWrapperAlias>(...)` where the wrapper is a `template using` not a class) → modal "✗ Compile Failed" status box shows at most 3 short error lines in `basename:line — message` format (no absolute paths, no thousand-character template expansions). If more than 3 errors exist, a `…and N more (full output in Build Output panel)` footer appears. Full verbose output remains visible in the persistent Build Output panel below the editor. ✅
- [x] TC-553b: Same scenario — Close button MUST remain visible and clickable on the right side of the modal regardless of how long any individual error line is. If the summary still exceeds the status box (very long single message even after truncation), the status area scrolls internally — buttons never pushed off-screen. ✅
- [x] TC-553c: While a compile is running (bm-status empty), the bm-hint text ("Last compiled version of this config took about Xs.") MUST be left-aligned in the row below the build log — NOT shoved to the right under the Abort button. Regression check on the `#bm-status` flex sizing: with `flex-grow: 0`, the empty status doesn't compete with bm-hint for free space. ✅

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

- [x] TC-808: Fresh install (no `.core-installed` sentinel, or sentinel doesn't match current `CORE_VERSION`) → on app launch, toolchain status shows "Setting up build tools..." with pending (yellow/dim) indicator. **Caveat observed during QA**: on a truly fresh install with NO ProffieOS version available, `toolchain.initialize()` bails at `validateProffieOSSource()` BEFORE the setup banner gets to render. The user first sees a red "No ProffieOS versions found" error; only after installing/downloading a ProffieOS version does the setup banner appear. Logged to backlog as a first-run UX gap (banner should appear from the moment the app launches, regardless of whether a ProffieOS version is present). ✅
- [x] TC-809: First launch → Build Output panel auto-opens (does NOT stay collapsed) so the user sees install progress ✅
- [x] TC-810: First launch → blue notice `#bp-setup-notice` is visible inside Build Output: "First-time setup: downloading and installing required build tools. This only happens once and may take several minutes on slower connections. Compile and flash will be available when setup is complete." (Same caveat as TC-808 — appears once core install actually begins.) ✅
- [x] TC-811: While toolchain-setup status is pending, port/compile/flash status indicators are hidden (no broken Compile button visible) ✅

### 55.2 Completion behavior

- [x] TC-812: After core install completes, toolchain status flips to "Toolchain ready" (green/ok); `bp-setup-notice` hides automatically ✅
- [x] TC-813: After completion, port/compile/flash indicators reappear and behave normally ✅
- [x] TC-814: Sentinel `.core-installed` is now written to disk with the current `CORE_VERSION` string. Verified at `C:\Users\<user>\AppData\Roaming\jmt-studio\arduino-data\.core-installed`. ✅

### 55.3 Subsequent launches

- [x] TC-815: Relaunch app after successful first-run → `needsCoreInstall()` returns false (sentinel matches version) → no toolchain-setup banner, Build Output stays collapsed, toolchain ready immediately. Confirmed in VM: log on expand shows "Core proffieboard:stm32l4@4.6.0 already installed." → "Toolchain ready." ✅
- [x] TC-816: Manually delete the `.core-installed` sentinel → relaunch → first-run flow fires again (banner shown, Build Output opens). Verified on Win VM. ✅
- [ ] TC-817: Bump `CORE_VERSION` constant (simulated via dev build) → relaunch → first-run flow fires again (version mismatch detected)

### 55.4 Error handling

- [x] TC-818: First launch with no internet → toolchain install fails → status flips to error with a meaningful message; `bp-setup-notice` hides; Build Output stays open so user can see the error log. Verified on Win VM with network disconnected: status reads "Failed to update board index" (red), Build Output stays open showing DNS lookup failures ("no such host") for downloads.arduino.cc and profezzorn.github.io. App did not crash. ✅
- [x] TC-819: First launch is interrupted (user closes app mid-install) → on next launch, `needsCoreInstall()` correctly detects the install is incomplete (sentinel never written) → first-run flow re-fires. Verified on Win VM. ✅

---

## 56. IN-APP CONFIRM MODAL — MIGRATION

> Native `window.confirm()` calls in the renderer have been replaced with the in-app `promptConfirm({title, message, confirmText, confirmKind})` helper. Bank delete (covered in §52.11c) and the three Style Library sites below.

### 56.1 Style Library — Remove Style Library button

- [x] TC-820: Style Library tab → click "Delete" (toolbar) → in-app modal opens with title "Remove Style Library" and body "Remove Style Library from JMT Studio? Any changes made since importing will be lost." Confirm button labeled "Remove" with destructive (red) styling ✅
- [x] TC-821: Cancel → modal closes, library untouched, all tabs/state preserved ✅
- [x] TC-822: Confirm → library is deleted; Style Library tab hides; tab focus falls back to Config Manager ✅
- [x] TC-823: Modal renders correctly in both light and dark mode ✅

### 56.2 Style Library — Delete Style (visual view, card delete)

- [x] TC-824: Click × on a style card → in-app modal opens with title "Delete Style" and body `Delete style "NAME"? This will remove it from your style library.` Confirm button labeled "Delete" (red) ✅
- [x] TC-825: Cancel → card remains, library state unchanged ✅
- [x] TC-826: Confirm → style removed from library, card disappears from grid, library marked dirty ✅
- [x] TC-827: Style name is quoted exactly as it appears in source (no escaping/transformation) ✅
- [x] TC-827a: After confirming a delete, press Ctrl+Z (while still on the Style Library tab in visual view). The deleted card MUST reappear in its original position. Ctrl+Y after that restores the deletion. Mirrors the existing drag-reorder undo/redo behavior. (Regression: previously the visual-view undo stack only captured drag-reorders; deletes bypassed it and Ctrl+Z did nothing.) ✅

### 56.3 Style Library — Delete Helper (helpers panel)

- [x] TC-828: Delete a helper that has NO dependents → in-app modal opens with title "Delete Helper" and body `Delete helper "NAME"? It has no known dependents in this file.` ✅
- [x] TC-829: Delete a helper that HAS dependents → modal body lists every affected style (`• Style1\n• Style2\n...`); Confirm marks those dependents as broken (red) in the visual view ✅
- [x] TC-830: Confirm message text formats line breaks correctly (each dependent on its own line) ✅
- [x] TC-831: Cancel → helper and dependents all preserved ✅
> Error feedback shape: red border on the offending field (name input or Monaco body container) shows WHERE the problem is; **hovering the disabled Save button reveals the tooltip explaining WHY** it's disabled. There's no inline error text — the Save button stays disabled while any error holds, so a tooltip is the only surface the user can reach.

- [x] TC-831a: Raw-body auto-wrap via live sync — open Add Helper. **Tab into the body editor first** (skip the name field), type `Red`. Then click back into the name field and type "MyHelper". The body live-syncs to `using MyHelper = Red;` (Case 3 raw-expression wrap). Save commits and the helper appears in the list. Without the wrap, the parser's `using NAME =` regex couldn't find it and the helper would "disappear." ✅
- [x] TC-831b: Name/body live re-sync (was: mismatch error). Mismatch is now structurally impossible because both fields sync in real time. Test the sync: in add mode with name "MyHelper" already typed (body shows `using MyHelper = ;`), edit the body's `using` line to `using SomeOtherName = ;` → the name field updates to "SomeOtherName" automatically. Reverse: change the name field back to "MyHelper" → body's `using …` updates to match. ✅
- [x] TC-831c: Live name validation — start typing in the name field. The instant you type an invalid identifier (e.g. starts with a digit), red border appears on the name input and Save is disabled. Hover Save → tooltip explains the identifier rules. Fix the name → red + tooltip clear on next keystroke. ✅
- [x] TC-831d: Empty body after a valid name — type "MyHelper" (body prefills `using MyHelper = ;`). Now select-all in the body editor and delete → body is truly empty. **Body editor red border**, Save disabled. Hover Save → tooltip: "Helper body is empty — paste a style expression or type one between `=` and `;`." Type or paste anything → red border updates per the new state (skeleton-only triggers TC-831g, real expression clears). ✅
- [x] TC-831e: Live duplicate check — start typing a name that already exists. The instant the existing name is fully typed: red border on name input, Save disabled, hover-tooltip: `"<name>" already exists — choose a different name.` ✅
- [x] TC-831f: Name → body live sync — open Add Helper with empty body. Type a name; body prefills with `using NewName = ;` and the caret lands between `=` and `;`. Edit name → body's `using <name> = ;` updates to match. Type an expression between `=` and `;` (e.g. `Red`) → body becomes `using NewName = Red;`. Save works. Mirrors Add Style's name↔body sync. ✅
- [x] TC-831g: Empty-expression guard — type a name (body prefills `using NAME = ;`). Save is **disabled** immediately (no body expression yet). Hover Save → tooltip: `"Helper expression is empty — fill in something between '=' and ';'."` Body editor shows red border. Type an expression between `=` and `;` → red clears, tooltip clears, Save enables. Erase the expression again → state restores live. ✅
- [x] TC-831h: Tab/Enter order on Add Helper — click `+` to open Add Helper. **Initial focus is the name (title) field.** Type a name (body prefills `using NAME = ;`). Press **Enter** → focus moves into the body editor and the caret lands just after `= ` (right before the `;`). Type an expression, press **Tab** → focus follows the normal page order (does NOT jump back to the name field), Save commits when valid. ✅
- [x] TC-831i: Bracket / `<>` live check — same as Add Style. With a valid name, type `Red<` in the body → red squiggle marker under the `<`, body editor gets a red border, Save is disabled, hover Save → tooltip mentions "Unmatched <". Close the bracket → marker + border + tooltip clear, Save enables. Mirrors Add Style's `_findBracketError` behavior so the helper Monaco isn't a special case. ✅
- [x] TC-831j: Save-button tooltip actually shows when disabled — Chromium's default kills hover events on `:disabled` buttons. Confirm the tooltip is visible by hovering the disabled Save button in any of TC-831c / TC-831e / TC-831g / TC-831i. If the tooltip doesn't appear, the `pointer-events: auto` rule on `#btn-helper-save:disabled` regressed. ✅

### 56.4 Regression — no native `window.confirm` calls remain

- [x] TC-832: Grep the renderer for `window.confirm(` or bare `confirm(` → no callsites remain. All call paths funnel through `promptConfirm()` (renderer/index.html:3260). ✅
- [x] TC-833: All four sites use `#modal-confirm` via `promptConfirm`: Remove Library (5443), Delete Helper (6647), Delete Style (6654), Bank delete (14857). Each await blocks until the modal resolves, so two can't open concurrently. ✅

---

## 57. portDetector JSON REFACTOR — REGRESSION

> `parseBoardList()` rewritten to consume `arduino-cli board list --json` instead of regex-parsing tabular output. Closes the "regex fragile" backlog item.

### 57.1 Detection still works on all platforms

- [x] TC-834: *(Windows)* Connect Proffieboard V3 → detected; port path (`COM3` etc.) shown in port dropdown ✅
- [ ] TC-835: *(Mac)* Connect Proffieboard → detected; `/dev/cu.*` path shown (not `/dev/tty.*` — tty→cu normalization preserved)
- [ ] TC-836: *(Linux)* Connect Proffieboard → detected; `/dev/ttyACM*` path shown
- [x] TC-837: Detected board name and SN displayed correctly (no garbled characters from JSON parsing) ✅

### 57.2 Multi-board scenarios

- [x] TC-838: Two Proffieboards plugged in simultaneously → both appear in port dropdown with their SNs ✅
- [x] TC-839: Mix of Proffieboard + other USB serial devices (e.g. an Arduino Uno) → only the Proffieboard(s) are tagged as recommended; other devices appear but are not selected by default ✅

### 57.3 No board / edge cases

- [x] TC-840: No board connected → JSON output is empty array `[]`; port dropdown shows "—", no parse errors logged ✅
- [x] TC-841: arduino-cli returns malformed JSON (simulated corruption) → graceful failure, no crash; "—" shown ✅
- [x] TC-842: arduino-cli not installed yet (mid-toolchain-install) → falls through without crashing; refresh after install succeeds populates correctly ✅

### 57.4 Behavioral parity with the old regex parser

- [x] TC-843: Detected field shows the same information format as 1.6.5 (SN displayed, no V2/V3 inference since that's not derivable from USB data — see qa-1.6.3 BUG-035) ✅
- [x] TC-844: Recommended port auto-selection preserved (single Proffieboard auto-selects; multi-board cases require user choice) ✅
- [x] TC-844a: Polling survives a blur→focus cycle. With a Proffieboard plugged in on the Config tab, click into another app so JMT Studio loses focus. Unplug the board while JMT Studio is unfocused. Click back to JMT Studio. After up to one polling tick (≤5s), the port dropdown clears to "—" without needing a manual refresh. Plug the board back in → dropdown re-detects it automatically. Regression guard: `_portPollingWanted` defaulted to false, so the focus handler's `if (_portPollingWanted)` gate left polling dead after the first blur/focus. ✅

---

## 58. STYLE LIBRARY — CHARGING STYLES SECTION

> New section in `my_styles.h` for styles that depend on JMT functions (currently `ChargeFullPropF` from `../functions/charge_full_prop.h`). Library entries that reference any symbol in `_SL_JMT_DEPENDENT_SYMBOLS` are auto-classified as `isCharging` and emitted under a `Charging Styles` banner wrapped in `#ifdef FUNCTIONS_CHARGE_FULL_PROP_H` / `#endif`. Section order in the file: Helper functions → Charging Styles → Using styles. Auto-migration uses the same machinery that auto-orders Helper functions today.

### 58.1 Classification on Add to Library

- [x] TC-845: Add to Library on a style that contains `ChargeFullPropF` anywhere in its expression → on next save the entry lands inside the Charging Styles section, between Helper functions and Using styles ✅
- [x] TC-846: Add to Library on a style that does NOT contain any JMT-dependent symbol → entry lands in Using styles section as before, no Charging Styles section emitted unless other charging entries exist ✅
- [x] TC-847: Detection is word-boundary based — a comment or string literal containing the word `ChargeFullPropF` would trigger classification (acceptable: user could comment-disable a charging entry and it'd still be guarded; doesn't break anything) ✅
- [x] TC-847a: Add a new style via "Add to Library" with the library scrolled to the top (lots of existing entries below). On confirm, the modal closes and the **visual list scrolls so the new card is visible** (centered in viewport) with the orange highlight pulse — same animation used for "jump to card" navigation. Without the scroll, the new card lands at the bottom of a long list and the user can't tell the add succeeded. ✅

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
- [x] TC-894: In a packaged production build, template file lives at `%APPDATA%/jmt-studio/templates/default.h` (separate from dev — they don't share state). Verified on VM: lazy-created on first "+ New → Use Template" click. ✅
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
- [x] TC-942a: Click the X on a collapsed slot tile (reset to default StylePtr<Black>() OR excess-slot delete). Without moving the mouse or clicking anywhere else, press Ctrl+Z. The slot reverts in one step. (Regression: previously a sync `editor.focus()` inside the click handler was reasserted back onto the X button when the click event completed, so Ctrl+Z went to the button and did nothing until the user manually clicked into the Monaco editor.) ✅

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
- [x] TC-957: Existing CONFIG_TOP + no board include + click dropdown V3 + confirm Insert → include inserted into existing CONFIG_TOP → Ctrl+Z removes just that line, CONFIG_TOP's other content intact ✅
- [x] TC-957a: Live re-sync when include is removed — open a config with `#include "proffieboard_v3_config.h"` (dropdown shows Proffieboard V3). Manually delete the include line in the editor. After the 250ms debounce, the **board dropdown resets to "Select a board"** (blank). Re-paste the include → dropdown re-syncs to V3. Compile-time would catch a missing include anyway, but the dropdown shouldn't lie about the current config state. ✅

### 61.8 Coalescing-prevention edge cases

- [x] TC-958: Two rapid clicks on the same action button (e.g. + Add Preset twice within 100ms) → Ctrl+Z reverts each separately (no rapid-fire coalescing) ✅
- [x] TC-959: Action button click immediately followed by a single keystroke in the editor → Ctrl+Z reverts the keystroke first, then the action (no merge) ✅
- [x] TC-960: Typing in the editor immediately followed by an action button click → Ctrl+Z reverts the action first, then the typing (no merge) ✅
- [x] TC-961: After Ctrl+Z reverts an action, Ctrl+Y redoes it cleanly with no residual state (no orphan decorations, no stale parse results) ✅

### 61.9 Functional regression — verify operations still work end-to-end

> Any change to executeEdits wrapping has a non-zero risk of breaking the underlying behavior. Spot-check each operation type still produces correct source.

- [x] TC-962: Each operation in §61.2-§61.7 still produces the same source output as before the atomic-undo refactor (no shifted insertion points, no malformed output, no off-by-one line numbers) ✅
- [x] TC-963: Operations that fire multiple internal `executeEdits` in a single user action (e.g. Link Style Library with conflict → 2 edits: comment-out + insert) still work correctly. Either both edits land OR neither does. Ctrl+Z reverts both as one user-perceived step. ✅

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

## 63. SLOT EDITOR — MATCH B1 COLOR + SIDECAR SELF-HEAL

> Refinement (2026-05-16): tedium-buster for multi-blade configs — slots B2+ get a "Match B1" link next to the BASE_COLOR_ARG (and other RgbArg) swatches that pulls B1's effective base color in one click. Plus a defensive rebuild guard that self-heals when `_editingField` / `_keyboardNavInProgress` flags get stuck (caused stale list/detail until sidecar reopen).

### 63.1 Match B1 button — visibility

- [x] TC-1035: Slot tile B1 (index 0) opened in expanded editor → no Match button shown on any RgbArg row (you can't match yourself). ✅
- [x] TC-1036: Slot tile B2 (or later) opened → for each RgbArg row, a small blue "Match B1" link appears between the arg label and the reset (×) button. ✅
- [x] TC-1037: Button hidden when the current effective color already equals B1's effective color (whether the match comes from the default value or an explicit override). ✅
- [x] TC-1038: B1 has no resolvable color (no explicit colorArg, no registry default, no hardcoded literal in expression, no library hardcoded color) → button is not rendered. ✅

### 63.2 Match B1 button — dynamic label

- [x] TC-1039: B1 has no custom blade label → button reads **"Match B1"** (matches the default badge text). ✅
- [x] TC-1040: B1 renamed via the blade-label pencil (e.g. label "Main") → button reads **"Match MA"** — same abbreviation the slot-tile badge shows, so the affordance stays in sync. ✅
- [x] TC-1041: Hover tooltip on the button shows the full label (e.g. "Set this color to match Main (DeepSkyBlue)") — abbreviation in the button, full name + resolved color name in the tooltip. ✅

### 63.3 Match B1 button — apply behavior

- [x] TC-1042: Click Match B1 → the current arg's color is set to B1's effective base color in one atomic Monaco edit (single Ctrl+Z reverts). The slot tile swatch + the in-row swatch both reflect the new color immediately. ✅
- [x] TC-1043: After clicking Match B1, the button hides (current color now matches). Changing the color via the color picker brings the button back. ✅
- [x] TC-1044: B1 color resolved through the full fallback chain — explicit colorArg → registry default → library hardcoded → inline RgbArg default → hardcoded literal — same logic as the slot tile swatch (extracted into a shared `_resolveSlotColor()` helper so both views agree). ✅

### 63.4 Sidecar rebuild self-heal (stuck-flag defense)

- [x] TC-1045: Edit Monaco source to delete a preset entry → sidecar list updates within ~50ms without needing to close + reopen the sidecar. Previously the `_editingField` / `_keyboardNavInProgress` guards could leave the list rendering pre-edit data if one of those flags got stuck. ✅
- [x] TC-1046: Defensive self-heal: if either flag is true at rebuild time but no `.preset-edit-input` is in the DOM AND no Common checkbox currently has focus, the flags are reset and the render proceeds. Genuinely-open inputs still get the original skip behavior — no destructive re-render mid-typing. ✅

---

## §64 — Serial Monitor (BUG-015)

Build-output panel is now a tabbed container with two panes: **Build Output** (existing) and **Serial Monitor** (new). Serial Monitor connects to the selected COM port at 115200 8N1 and provides send / pause / clear, releasing the port automatically during flash.

### 64.1 Tab visibility & switching

- [x] TC-1050: Build-output panel header shows two tabs: "Build Output" (active by default) and "Serial Monitor". Chevron toggle button on the far left still expands/collapses the body. ✅
- [x] TC-1051: Clicking "Serial Monitor" tab switches to the serial pane: build content hidden, serial log + input row visible, action area changes from `✕ clear` to `<status> ⏸ pause ✕ clear`. ✅
- [x] TC-1052: Clicking "Build Output" tab returns to the build pane: serial log hidden, build content visible, action area shows only `✕ clear`. ✅
- [x] TC-1053: Switching to the Serial Monitor tab auto-opens the panel body (no need to click chevron first). ✅
- [x] TC-1054: Chevron click still collapses/expands the body regardless of which tab is active. ✅

### 64.2 Auto-connect lifecycle

- [x] TC-1055: With a Proffieboard selected in the port dropdown, click Serial Monitor tab → status changes to `connecting <port>...` then `<port> @ 115200` (green). Input + Send become enabled. ✅
- [x] TC-1056: With no port selected, click Serial Monitor tab → status reads `no port selected` (gray italic). Send and input remain disabled. ✅
- [x] TC-1057: With a Proffieboard powered on and idle, opening the monitor produces no spurious data (or only the board's startup banner if it just booted). ✅
- [x] TC-1058: Port handle is released when leaving the Serial Monitor pane. Two ways to verify:
    1. **In-app round-trip:** With the monitor connected, switch to Build Output, then back to Serial Monitor. The status briefly shows `disconnected` then re-connects cleanly with `<port> @ 115200`. A clean re-open proves the handle was released — if it were still held, the re-open would fail with "Access denied" / EBUSY.
    2. **External tool (optional):** While on Build Output, open the same COM port in Arduino IDE Serial Monitor or PuTTY. It opens cleanly. Switch JMT back to Serial Monitor → JMT re-acquires the port (Arduino/PuTTY will then fail to read until you close them). ✅
- [x] TC-1059: Switch ports in the port dropdown while Serial Monitor tab is active → old connection closes and new port auto-connects (status reflects new path). ✅
- [x] TC-1060: Pull USB cable while connected → status updates to `disconnected: <reason>` within ~1s, Send button disables, input disables. ✅
- [x] TC-1061: Replug board, re-select port → reopening Serial Monitor tab reconnects without app restart. ✅
- [x] TC-1061a: Pause-button repurposes as retry when disconnected. When the monitor is connected the button reads `⏸ pause`. Trigger any disconnect (unplug cable, PuTTY-style port contention causing "Access denied", or just `closeSerialMonitor` via tab-switch). The button label changes to `↺ retry` and its tooltip becomes "Try to connect to the selected port again." Click it → `connecting <port>...` then either `<port> @ 115200` on success or `error: ...` on failure (label stays `↺ retry` until a successful open). Gives users an explicit recovery path without having to leave the tab or restart the app. ✅
- [x] TC-1061b: Explicit `⏏ close` button. While connected, a `⏏ close` button appears in the serial actions row between `pause` and `clear`. Click it → tab switches to Build Output (releasing the port via existing `closeSerialMonitor` path), then the log body collapses. Button hides when disconnected (nothing to close). Surfaces the "I'm done with serial" intent that was previously hidden behind the tab switch, without adding a separate close-port IPC path. ✅
- [x] TC-1061c: Pause-button icon renders in the same monochrome weight as the other action symbols (`⏏ close`, `✕ clear`, `↺ retry`, `▶ resume`). The original `⏸` triggered Windows' colored emoji glyph and looked foreign in the row; swapped to `❚❚` (two HEAVY VERTICAL BAR from Dingbats) which renders mono by default. Verify by opening Serial Monitor: the pause bars should be the same color as the surrounding icons, no blue tint. ✅

### 64.3 Incoming data display

- [x] TC-1062: Type `version` in the input field (or use TC-1065 send) → multi-line response (firmware version, config name, prop type, install time) renders with newlines preserved, no extra blank lines (CRLF → LF normalization). (Note: ProffieOS has no `help` command — it replies `whut help` for unknown commands. `version` is the canonical short multi-line test; `list_presets` works as a longer alternative. `effects` was not recognized on the tested OS 8.10 build — likely OS/prop dependent, not reliable as a generic test command.) ✅
- [x] TC-1063: Long bursts (e.g., `list_presets` output) scroll smoothly and the view auto-scrolls to bottom. Manually scrolling up while data arrives — verify the view still auto-scrolls (acceptable trade-off; if not desired, document as known UX). ✅
- [x] TC-1064: Very large output (>200K chars) is capped — earliest text is trimmed, latest remains. No browser lockup or memory blow-up. ✅

### 64.4 Send

- [x] TC-1065: Type `version` into the input field → press Enter → command echoes locally as `> version`, then board's response streams in. Input field clears after send. ✅
- [x] TC-1066: Click `Send` button with text in the field → same behavior as Enter. ✅
- [x] TC-1067: Empty input + Enter / Send → no-op (no extra newline sent, no crash). ✅
- [x] TC-1068: Send with port closed (after disconnect) → button is disabled. Re-enabling only after reconnect. ✅

### 64.5 Pause

- [x] TC-1069: Click `⏸ pause` while data is streaming → button text changes to `▶ resume`, incoming data continues to be buffered (not shown). Send and clear remain functional. ✅
- [x] TC-1070: Click `▶ resume` → buffered data appears at once, view scrolls to bottom, button reverts to `⏸ pause`. ✅
- [x] TC-1071: Pause across long quiet stretches doesn't leak memory: paused buffer is capped at ~150K chars (oldest trimmed). Verified by code review (buildPanel.js:1473-1480) — only one growth path (`_serialPausedBuf += text` in the rx callback), immediate cap on every chunk, bounded between 150K and ~200K + max chunk size. ✅
- [x] TC-1072: Disconnect while paused → status updates to disconnected; clicking resume flushes whatever was buffered up to the disconnect moment. ✅
- [x] TC-1072a: Collapse the log body via the chevron while serial is streaming → button label flips to `▶ resume`, data buffers (DOM not updated while hidden). Expand → resumes automatically, buffered data flushes to log. ✅
- [x] TC-1072b: Manually click `⏸ pause`, then collapse, then expand → on expand, serial auto-resumes (overriding the manual pause) so the visible state matches the expectation that "opening the panel shows live data". Documented as predictable-over-precise. ✅
- ~~TC-1072c~~: *Dropped — collapse-while-disconnected is structurally a no-op (port closed on tab switch, no data flowing, no buffer state to manage). The Serial→Build round-trip behavior is already covered by TC-1058.*

### 64.6 Clear

- [x] TC-1073: Click `✕ clear` (serial actions) → serial log empties. Paused buffer (if any) is also cleared. Input field unaffected. Status unchanged. ✅
- [x] TC-1074: Build Output `✕ clear` button is unaffected — it only clears the build log content (verify by running a compile then clearing only the serial side). ✅

### 64.7 Flash coordination (BUG-015)

- [x] TC-1075: Serial Monitor open and streaming. Click `⚡ Compile` → compile runs normally, serial output continues during compile (compile doesn't touch the port). ✅
- [x] TC-1076: Serial Monitor open. Click `⚡ Flash` (post-compile) → log shows `— port released for flash —`, status flips to `disconnected`, flash proceeds without "port in use" / EBUSY error. ✅
- [x] TC-1077: After flash completes and board re-enumerates, Serial Monitor auto-reconnects within ~800ms (status returns to `<port> @ 115200`). Board's startup banner appears in the log. ✅
- [x] TC-1078: Flash failure (board pulled mid-flash) → after failure modal, serial does NOT auto-reconnect to a dead port — auto-reconnect only fires when serial tab is still active AND `_isFlashing` has cleared. Tested informally; no spurious reconnect or error observed. ✅
- ~~TC-1079~~: *Dropped — DFU flash uses the bootloader (the board is not running ProffieOS), so there is no serial port to monitor during the operation. The "serial open during DFU flash" state is structurally unreachable.*
- [x] TC-1080: Switch AWAY from Serial Monitor tab during a flash → no spurious reconnect attempt when flash completes. Not reachable through normal UI (flash modal limits interaction) but the guard is verified by code review at [buildPanel.js:619](renderer/buildPanel.js#L619) and [:1653](renderer/buildPanel.js#L1653) — both reconnect paths gate on `!_isFlashing`, and the post-flash setTimeout re-checks the flag at fire time. ✅
- [x] TC-1081: Open Serial Monitor tab DURING an active flash → tab switch never opens the port while `window._isFlashing === true`. Not reachable through normal UI but verified by code review at [buildPanel.js:1532](renderer/buildPanel.js#L1532): `_switchLogTab` only calls `openSerialMonitor` when `!window._isFlashing`. ✅

### 64.8 Regressions

- [x] TC-1082: Existing build-output behavior preserved: compile log streams into the build pane, `--- ... ---` and `✓` lines highlighted, errors red, auto-scroll works, `✕ clear` empties the build log. ✅
- [x] TC-1083: Chevron text shows only `▼` (collapsed) / `▲` (expanded) — no stale "Build Output" label embedded in the chevron (the tab strip now carries that label). ✅
- [x] TC-1084: Port polling, auto-detect, Proffieboard banner, DFU sentinel — all unchanged. Adding the serial monitor did not alter port-list handling. ✅
- [x] TC-1085: Style Library, presets, Monaco editing, all unrelated flows — sanity sweep that nothing else broke from the build-log DOM restructure. ✅

### 64.9 Line suppression — entry / context menu

- [x] TC-1086: Empty Serial Monitor log shows italic tip "Right-click a noisy line to suppress similar lines. Active filters appear next to ⏸ pause." The tip disappears as soon as any line lands in the log. ✅
- [x] TC-1087: Right-click a line of the form `ID: 12345678` → context menu appears with two options: `Suppress lines starting with "ID:"` and `Suppress exact: "ID: 12345678"`. Same for `Battery voltage: 4.123`. ✅
- [x] TC-1088: Right-click a line with no label/colon (e.g. `splode!`) → menu offers `Suppress lines starting with "splode!"` and `Suppress exact: "splode!"` (no label option). ✅
- [x] TC-1089: Right-click a very long line (>60 chars) → exact option preview truncates with `…`. The stored rule still holds the full text (verified: pasting an identical line still gets suppressed). ✅
- [x] TC-1090: Right-click near the right or bottom edge of the screen → menu clamps inside viewport (no scrollbars triggered). ✅
- [x] TC-1091: Press Esc with context menu open → menu dismisses. Click outside → menu dismisses. Click an option → menu dismisses and rule is applied. ✅
- [x] TC-1092: Right-click outside the serial log (e.g. on the input row or build pane) → no custom menu appears (native browser menu still suppressed only on `.serial-line` elements). ✅

### 64.10 Filter badge

- [x] TC-1093: With 0 filters: badge `funnel-icon + N` is hidden and the `clear filters` link is hidden. ✅
- [x] TC-1094: After adding 1 filter: badge shows `🔇 1`, `clear filters` link still hidden (per spec — single-filter cleanup happens via popover ✕). ✅
- [x] TC-1095: After adding a 2nd filter: badge shows `🔇 2`, `clear filters` link visible. Clicking `clear filters` empties the rule list, badge and link both hide. ✅
- [x] TC-1096: Click the badge `funnel-icon + N` → popover opens above the badge listing each filter with its type ("starts with" / "exact") and text, plus a per-filter `✕` button. Click outside or Esc → popover dismisses. ✅
- [x] TC-1097: Click a per-filter `✕` → that single filter is removed, popover content refreshes in place (does not close). Badge count decrements. Last filter removed → popover shows "No active filters". ✅

### 64.11 Suppression effect on the log

- [x] TC-1098: Add a `starts with "ID:"` filter while ID lines are streaming → all currently-displayed `ID:` lines disappear from the log, and incoming `ID:` lines never appear. Other content scrolls normally. ✅
- [x] TC-1099: Remove the filter → previously-suppressed lines reappear in their original positions (they were `display: none`, not deleted). Scroll position is preserved within reason. ✅
- [x] TC-1100: An `exact` filter only hides lines that match byte-for-byte. e.g. `Battery voltage: 4.123` filter does NOT hide `Battery voltage: 4.124`. ✅
- [x] TC-1101: A `prefix` filter is case-sensitive (matches "ID:" but not "id:"). Verified by code review ([buildPanel.js:1150](renderer/buildPanel.js#L1150)): `lineText.startsWith(r.text)` is byte-equal with no case fold. ✅
- [x] TC-1102: Suppression survives Pause/Resume — pause, add a filter, resume → resumed buffer is filtered through the rules on display. ✅
- [x] TC-1103: `✕ clear` (serial action) empties the log entirely, including currently-hidden suppressed lines. Filters themselves remain active. ✅

### 64.12 Session-scoped (intentionally NOT persisted)

- [x] TC-1104: Add 2 filters, close the app, reopen → on the next Serial Monitor tab visit, the badge is HIDDEN and incoming `ID:` / `Battery voltage:` lines are visible again. Filters are debug-session scoped and reset on every launch. ✅
- [x] TC-1105: No `serial.suppress` setting key is written to the user-data store at any point (filters live in memory only). ✅

### 64.13 Auto-clear on board / port change

- [x] TC-1106: With 2 filters active, change the port dropdown to a different path → badge and `clear filters` link both disappear. Filters do NOT carry over across user-initiated board switches. ✅
- [x] TC-1107: With 2 filters active, flash the board → port may re-enumerate to a different COM path → filters are PRESERVED (refreshPorts does not auto-clear; only the dropdown handler does). Confirms the heuristic: user action → wipe; auto re-enumerate → keep. ✅
- [x] TC-1108: With 2 filters active, unplug the board → status flips to disconnected, badge remains visible (rules still in memory). Replug same board → refreshPorts auto-selects, filters still apply. Pull cable then plug in a DIFFERENT board → filters auto-clear (no manual dropdown action needed; the auto-select triggers it because the new board's SN differs from the one the filters were scoped to). Earlier failure was because `refreshPorts` set the dropdown via `portSelect.value = …` programmatically, which doesn't fire `change`, so `onPortChange` and its clear logic never ran. Fixed by tracking filters by **board SN** (not COM path) and calling the clear helper from the auto-select branches in `refreshPorts`. Same SN re-enumeration (flash case, TC-1107) still preserves filters because the SN matches. ✅

### 64.14 Smart auto-scroll + jump-pill + focus restore

> Setup: compile+flash a config, open Serial Monitor with a board producing periodic output (10+ lines/sec works well — e.g. `monitor swings` or any verbose effect probe).

- [x] TC-1110: Default tail-follow — open serial tab, watch lines arrive. View scrolls to bottom on every new line. No pill visible. ✅
- [x] TC-1111: Scroll up at least 30px from bottom while data is streaming → lines keep arriving in DOM but view stays put. Pill appears at bottom-right: `↓ N new`. ✅
- [x] TC-1112: Pill count increments — continue watching while scrolled up. Pill's number updates as new lines arrive. ✅
- [x] TC-1113: Pill caps at `99+` — wait until many lines have arrived (>99). Pill shows `↓ 99+ new` instead of the full count. ✅
- [x] TC-1114: Click the pill → view snaps to bottom, pill disappears, new lines auto-follow again. ✅
- [x] TC-1115: Manual scroll back to tail — scroll down to within ~20px of the bottom. Pill disappears, auto-scroll resumes. ✅
- [x] TC-1116: Near-bottom tolerance — scroll up just ~10px from absolute bottom. Should still count as "at bottom" — pill should NOT appear on next incoming line. ✅
- [x] TC-1117: Far-up tolerance — scroll up ~30+ px from bottom. Pill DOES appear on next incoming line. ✅
- [x] TC-1118: Send command while scrolled up — scroll up, type a command in send input, press Enter. Auto-scroll re-engages, pill disappears, view snaps to bottom showing your echoed `> ...` line. ✅
- [x] TC-1119: Clear log while scrolled up — scroll up while pill is showing, click Clear. Log empties, pill disappears, next incoming line auto-follows from the top. ✅
- [x] TC-1120: End key with no input focus — scroll up. Click somewhere on the serial pane background (not the input). Press End. View jumps to bottom, pill disappears, auto-scroll resumes. ✅
- [x] TC-1121: End key inside send input — type text in send input, press Home then End. Cursor moves to end of input text (browser default). Pill state unchanged. ✅
- [x] TC-1122: End key when serial tab inactive — switch to Build Output tab. Press End. Nothing happens to serial (no interference with build pane). ✅
- [x] TC-1123: Pause while scrolled up — scroll up so pill is showing. Click Pause. Pill count stops incrementing (buffer captures lines silently). Pill stays at last count. ✅
- [x] TC-1124: Resume from pause while scrolled up — from TC-1123, click Resume. Buffered lines flush into log. Pill count jumps to reflect the flushed lines. View still doesn't auto-scroll. ✅
- [x] TC-1125: Tab switch round-trip — scroll up while pill visible. Switch to Build Output tab, switch back to Serial Monitor. Pill still visible with prior count, scroll position preserved. ✅
- [x] TC-1126: Window focus return — scroll up so pill visible. Alt-tab away to another app. Alt-tab back to JMT Studio. Send input re-receives focus (cursor in send field without clicking). Scroll position and pill preserved. ✅
- [x] TC-1127: SERIAL_MAX_LINES trim while scrolled up — scroll up, then wait for >1000 lines to arrive. Oldest lines get trimmed from top. View position adjusts naturally (visible content shifts). Pill keeps incrementing until you return to tail. ✅
- [x] TC-1128: Flash mid-scroll-up — scroll up while pill visible. Trigger a Flash. Serial pauses ("port released for flash" appears as a new line), flash runs, serial reconnects ~800ms after. Pill state and scroll position preserved across the cycle. ✅
- [x] TC-1129: Empty log → first line — click Clear so log is empty. Wait for first incoming line. Line appears at top of empty log. No pill (auto-scroll true post-clear). ✅
- [x] TC-1130: Visual placement — at minimum panel height, the pill must not overlap the send-input row. Pill uses JMT blue and brightens on hover. Fix: the global `button:hover { opacity: 0.82 }` rule was overriding the pill's `filter: brightness()` lift and reading as darken. Added `opacity: 1` to the pill's hover rule so the brightness filter reads cleanly. ✅
- [x] TC-1131: No console errors — run TC-1110 through TC-1129 with DevTools open. No errors logged during any scenario. ✅
- [x] TC-1132: Auto-connect on board arrival — start the app with NO board connected, switch to the Serial Monitor tab (status shows "no port selected"). Plug in the board. Once `refreshPorts` auto-selects the port, the serial monitor should auto-connect (`port @ 115200`), the send input should be focused, and incoming data should begin streaming. No manual dropdown bump or tab toggle required. ✅
- [x] TC-1133: Persistent connect hint — open Serial Monitor with a board that streams welcome text immediately on connect (ProffieOS does this — "Welcome to ProffieOS vX.Y", URL, "Battery voltage:"). The first line in the log should be a styled hint with a JMT-blue left border: "💡 Right-click any line to suppress similar lines. Active filters appear in the toolbar above." It must appear ABOVE the welcome text, not after it. Scroll up after data arrives to confirm the hint is still in scrollback. ✅
- [x] TC-1134: Hint does not accumulate across reconnects — with the monitor connected and data flowing, switch to Build Output tab and back to Serial Monitor (closes and reopens the monitor). The log should NOT have a second hint entry. Same after a flash cycle (pauseSerialBeforeFlash → resumeSerialAfterFlash) — exactly one hint at the top of scrollback regardless of reconnect count. ✅
- [x] TC-1135: Hint reappears after clear → reconnect — with the monitor connected, click Clear. Log is empty; CSS empty-state hint shows briefly. Switch to Build Output tab, then back to Serial Monitor (forces reconnect). The persistent hint entry should reappear at the top of the now-fresh log. ✅

### 64.15d Slot-based ArgumentName parens format

> Setup: Test against a few different OS versions to exercise the version-aware enum lookup (e.g. an older ProffieOS where RETRACTION_OPTION2_ARG doesn't exist alongside a newer one where it does).

> Debug tooling added: console logs `[slotMap] refresh requested … loaded vX.Y — N args` on every refresh, `[slotMap] invalidated (had N args)` on invalidate. Open DevTools console; call `window.debugSlotMap()` at any time to print the current version, count, and full sorted name→slot table.

- [x] TC-1159: New-format read — a slot's parens string is `"65535,0,0 ~ ~ ~ ~ ~ ~ ~ 0,65535,0"`. Opening that slot in the editor shows BASE_COLOR_ARG (slot 1) = Red and BLAST_COLOR_ARG (slot 9) = Green. All intermediate slots show as default. Verified on-device. ✅
- [x] TC-1160: Legacy-format backward read — a slot's parens string is in pure CSV form (e.g. `"65535,0,0,32768,16384,0,..."`). Opening the slot still resolves each named arg's value correctly — no visible regression for configs written by older JMT Studio builds. Verified on-device. ✅
- [x] TC-1161: Write produces new format — set BASE_COLOR_ARG via the color picker. Source updates to `"65535,0,0"` (single slot token), not `"65535,0,0"` followed by trailing zeros from older args. Verified by code review: `writeRegistryArg` → `_serializeSlots` ([effect-args.js:297](renderer/effect-args.js#L297)) always emits modern format and trims trailing empties. ✅
- [x] TC-1162: Sparse write — clear BASE_COLOR_ARG, then set only BLAST_COLOR_ARG (slot 9). Source becomes `"~ ~ ~ ~ ~ ~ ~ ~ 65535,0,0"` with `~` for skipped slots. Verified by code review: `_serializeSlots` iterates `1 … lastSet`, emitting `~` for every unset slot ([effect-args.js:304-307](renderer/effect-args.js#L304-L307)). ✅
- [x] TC-1163: Auto-migration on first edit — open a config saved by an older JMT Studio build (pure CSV parens). Change one arg value. Save the config. The parens string is now space-separated with `~` for empty slots — the comma-list format is gone. Verified by code review: `_parseAnyParens` ([effect-args.js:291](renderer/effect-args.js#L291)) detects legacy CSV via `csvOffset` and writes always go through `_serializeSlots` (modern), so any write through `writeRegistryArg` migrates the parens. ✅
- [x] TC-1164: OS version change refreshes the slot map — switch the OS version dropdown. Console should log `[slotMap] invalidated …` then (on next Advanced open) `[slotMap] refresh requested for version: <new>` followed by `[slotMap] loaded vX.Y — N args`. Confirmed in console: `invalidated (had 0 args)` → `refresh requested for version: (default)` → `loaded vProffieOS 6.9 — 32 args. Sample: BASE_COLOR_ARG@1, ALT_COLOR_ARG@2, …`. ✅
- [x] TC-1165: Unsupported arg in older OS — verified via OS 6.9 slot map dump (`debugSlotMap()` output, 32 args, none of which are the six 8.10-only args: `ALT_COLOR2_ARG`, `ALT_COLOR3_ARG`, `STYLE_OPTION2_ARG`, `STYLE_OPTION3_ARG`, `IGNITION_OPTION2_ARG`, `RETRACTION_OPTION2_ARG`). Path: `_slotFor` ([effect-args.js:233](renderer/effect-args.js#L233)) — when slotMap is loaded but the arg name isn't in it, returns null (the pre-IPC legacy-table fallback only fires when slotMap is empty). `writeRegistryArg` then returns the original parens unchanged. **Required code fix:** the original `_slotFor` had no "loaded" guard around the legacy fallback, so an unsupported arg would silently corrupt the parens via the legacy `pos`. Fix applied so the fallback is bootstrap-only, matching the function's own comment. ✅
- [x] TC-1166: Enum-comment tooltip — hover the BASE_COLOR_ARG label in the expanded slot editor. Tooltip reads just `Primary Base Color` (the enum line-comment, with no redundant arg-name prefix — the row already shows the name). Hover RETRACTION_OPTION2_ARG → tooltip from that arg's enum comment. ✅
- [x] TC-1166a: Clickable label — click the BASE_COLOR_ARG label text (NOT the swatch). The color picker opens, same as clicking the swatch. The slot edit does NOT close. Same for any other RgbArg row in the Advanced section. ✅
- [x] TC-1166b: IntArg label click — click an IntArg label (e.g. STYLE_OPTION_ARG). The number input gets focus and its contents are selected, ready to type-replace. Slot edit does NOT close. ✅
- [x] TC-1167: JMT apply invalidates the slot-name cache — apply a JMT add-on to the active OS version. Console should log `[slotMap] invalidated …`. Then open Advanced or call `window.debugSlotMap()` → triggers `[slotMap] refresh requested …` and reload. Verified: post-apply log shows `invalidated (had 38 args)`. **Required code fix:** `versionsPanel.js` was comparing `getSelectedVersion()`'s `{name: …}` object to a bare string (`modifiedName`), which is always false. The post-apply `onOsVersionChange` hook had been silently dead since written. Fixed by extracting `activeSel.name` before the comparison. ✅
- [x] TC-1168: Lazy enum load — start the app with a config open. Console should show NO `[slotMap] refresh requested` on startup. Open a preset's slot editor and click Advanced for the first time → console fires `[slotMap] refresh requested … loaded …`. Confirmed: no startup refresh log; first refresh only fired after Advanced was opened. ✅
- [x] TC-1168a: OS version change drops the cached enum — switch the OS version dropdown. Console fires `[slotMap] invalidated …`. NO refresh until you open Advanced or call `window.debugSlotMap()`, at which point the new version loads. Confirmed: `invalidated (had 32 args)` fired on version flip; refresh waited for the next read and then loaded the new 38-arg map. ✅
- [x] TC-1169: Initial slot-tile color render — close the app fully, reopen with a config that uses library helper styles (not just inline expressions). When the preset sidecar opens, each B1 (and any other non-wrapper) slot tile shows its color swatch on the very first paint — NOT after a visible re-render jump. `_openSidecar` awaits the styles file load before its first `_rebuildSidecar`, so the preset list paints once with everything in place. Brief delay (~50ms) between the sidebar visually appearing and the preset list rendering is acceptable; a re-render that shifts tile heights is NOT acceptable. ✅

### 64.15c Wrapper-vs-inner color mismatch disclosure

> Setup: a preset whose slot uses a template wrapper that defines its own `RgbArg<BASE_COLOR_ARG, ...>` default different from the inner style's first RgbArg default. Test case: `StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopeVader>>()` — wrapper paints white, Vader paints red, no colorArg in source.

- [x] TC-1148: Expanded view BASE_COLOR_ARG row shows the **wrapper's** default (e.g. white for PixelSwitchWrapper), NOT the inner's color. Label reads "BASE_COLOR_ARG (default)". ✅
- [x] TC-1149: Below the Inner Style row, an indented disclosure row appears with a ⚠ icon, a small swatch of the **inner's** color (red for Vader), and the text "Inner BASE_COLOR_ARG". Hovering the swatch shows just the color label as the tooltip — e.g. "Red", "Green", or "Rgb<118,42,200>" for custom values. No prose explanation, no style name. The swatch + tooltip is purely a "what color is the inner" surface. No "Match inner" button — the existing Match B1 + the swatch picker already cover the resolution paths. ✅
- [x] TC-1150a: Live show/hide — set a colorArg via the BASE_COLOR_ARG swatch picker (any non-matching color is fine). The disclosure row hides IMMEDIATELY without needing to close/reopen the slot. Click the BASE_COLOR_ARG row's X to clear → disclosure REAPPEARS in place IMMEDIATELY (regression test for the build-once-show-always vs build-conditionally bug). ✅
- [x] TC-1150b: Match B1 also hides the disclosure live — click Match B1, disclosure goes away (same updateReset hook that drives the swatch picker path). ✅
- [x] TC-1151: When wrapper-default = inner-color (e.g. both happen to be white), NO disclosure row appears. No false-positive warnings. ✅
- [x] TC-1152: When source already has a colorArg (`StylePtr<PixelSwitchWrapper<Vader>>("65535,0,0")`), NO disclosure row appears — the user has pinned a color so both wrapper and inner paint it (no mismatch by definition). ✅
- [x] TC-1153: For a NON-wrapper slot (e.g. just `MainHyperResponsiveRotoscopeVader` directly), NO disclosure row appears — only wrappers-with-INNER-class-param qualify. ✅
- [x] TC-1154: For a wrapper WITHOUT its own RgbArg (pure passthrough like `Quiet<Vader>`), NO disclosure row appears — there's no wrapper-default to mismatch against. ✅
- [x] TC-1155: Collapsed slot swatch in a mismatched wrapper case shows a small ⚠ icon overlaid at the top-right of the color dot. Hovering the icon shows a tooltip explaining the mismatch. ✅
- [x] TC-1156: Resolving the mismatch clears the collapsed tile's ⚠ icon — via any of the available paths (Match B1, BASE_COLOR_ARG swatch picker, or setting a colorArg in source). The icon hides live without needing to close/reopen the slot. ✅
- [x] TC-1157: Inner Style dropdown — clicking the field auto-selects existing text so typing replaces it (parallel to the outer Style Library dropdown behavior). ✅

### 64.15b Collapsed-slot color detection through wrapper INNER

> Setup: a preset where one blade slot uses a template wrapper with a class INNER parameter (e.g. `PixelSwitchWrapper<SomeColoredHelper>`), and the inner helper has a distinctive color in its definition (e.g. purple via `Rgb<118,0,194>`).

- [x] TC-1144: Color detection prefers leaf style — collapse the slot. The color dot/swatch on the tile MUST reflect the INNER helper's color (purple in this example), NOT a stray literal from the wrapper's own body (e.g. `White` baked into the wrapper's TransitionEffect machinery). Clarification from QA: when the wrapper has its own legitimate `RgbArg<BASE_COLOR_ARG, …>` default, the collapsed swatch shows the wrapper's default (e.g. White for PixelSwitchWrapper) and the ⚠ icon flags the mismatch. Leaf-resolve is the fallback path that prevents stray-literal pickups when the wrapper has no RgbArg. ✅
- [x] TC-1145: Same result when slot has no `colorArg` set — default state shows inner's color. ✅
- [x] TC-1146: Plain (non-wrapper) helper slots still detect their own color correctly — no regression from the leaf-resolve change. ✅
- [x] TC-1147: Two-level wrap (if ever encountered): `OuterWrap<InnerWrap<RealStyle>>` should resolve to `RealStyle`'s color. Recursion is capped at 5 levels defensively; normal usage is 0–1 levels. ✅

### 64.15a Close-button label after flash completion

- [x] TC-1140: Regular serial flash → "✓ Flash Complete" modal — the action button on the right MUST read "Close", not "Cancel". (Nothing to cancel once the flash is done.) ✅
- [x] TC-1141: DFU-driver-fix flow that proceeds to a successful flash → "✓ Flash Complete" modal — label must be "Close" even though the same button was labeled "Cancel" earlier in the flow. The reset happens in `finishBuildModal`, so any terminal state (success or failure) clears stale labels. **Re-verified after fix**: was originally marked done without on-device verification; real DFU flow on Windows VM exposed that the `isDfuMode === true` success path at [buildPanel.js:896-911](renderer/buildPanel.js#L896-L911) doesn't call `finishBuildModal`, so the "Cancel" label set during driver-fix UI persisted into the success modal. Added explicit `bm-close.textContent = 'Close'` in the DFU success branch. Confirmed on VM. ✅
- [x] TC-1142: Failed flash → "✗ Flash Failed" modal — label is "Close". A failed run also reaches a terminal state and shouldn't inherit "Cancel" from a prior driver-fix interaction. ✅
- [x] TC-1143: Compile-only success (no flash) → modal close button reads "Close". ✅

### 64.15 Inner Style auto-commit on slot open

> Setup: a preset with at least 2 blades where B1 uses a library style (helper) and B2 uses a template helper that has an `INNER` class parameter (e.g. `PixelSwitchWrapper`).

- [x] TC-1136: Auto-commit on B2 open — start with B2's source written as `StylePtr<PixelSwitchWrapper>("...")` (no inner style in the angle brackets). Click B2 to open the slot editor. Source should automatically update to `StylePtr<PixelSwitchWrapper<{B1's style name}>>("...")` within ~50ms (a "blink" as the slot re-opens with committed state). Inner Style dropdown shows the B1 style name. No manual interaction required. ✅
- [x] TC-1137: No overwrite when source already has a value — start with B2's source already specifying an INNER style different from B1's (e.g. `StylePtr<PixelSwitchWrapper<SomeOtherStyle>>("...")`). Click B2 to open the slot editor. Source MUST NOT change. Inner Style dropdown shows `SomeOtherStyle`, not B1's style. The pre-populate path is gated on `!editTemplateArgs[idx]` so an existing value wins. ✅
- [x] TC-1138: No auto-commit on B1 — open the B1 slot editor (the first blade). No pre-populate logic runs (it's gated on `slotIdx > 0`). Source unchanged, dropdown shows whatever B1 already has. ✅
- [x] TC-1139: Single undoable edit — perform TC-1136. Press Ctrl+Z once. Source should revert to bare `StylePtr<PixelSwitchWrapper>("...")` (no inner) in a single undo step. The auto-commit IS a real user-visible change and should be reversible like any other slot edit. ✅

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
| BUG-016 | §64.9–64.13 (TC-1086 through TC-1109) | New capability (not a regression) | Serial monitor's first cut showed every line — Proffie's `ID:` and `Battery voltage:` polling lines (plus user-added debug prints) made the log unreadable. Added line-by-line suppression: right-click any line opens a context menu offering "Suppress lines starting with '<label>:'" (auto-detected for `Label: value` shape), "Suppress lines starting with '<first 24 chars>'" (fallback), and "Suppress exact: '<line>'" — no regex-typing required. Each rule is `{type: 'prefix'\|'exact', text: '...'}` stored in user settings under `serial.suppress` so they persist across launches. Display-time filtering only — suppressed lines get `display:none` rather than being dropped, so removing a rule un-hides them in place. Badge `funnel-icon + N` appears next to ⏸ pause when ≥1 filter; a separate `clear filters` link appears only at ≥2 filters (so the cleanup button doesn't clutter the bar for the common single-filter case). Click the badge to open a popover with one ✕ per filter for individual removal. Auto-clear fires only on user-initiated port-dropdown change (not on refreshPorts auto-detect after flash re-enumeration, since that's the same board with a new COM path). Empty-state hint in the log surfaces the right-click affordance the first time the user opens the tab. | Fixed |
| BUG-015 | §64 (TC-1050 through TC-1085) | New capability (not a regression) | JMT Studio shipped without a serial monitor — users had to install Arduino IDE alongside JMT Studio just to talk to the board (read effect probes, run `help`, configure WS281X parameters, etc.). Added a second tab to the existing build-output panel ("Serial Monitor"), wired through the existing `serialport` dep in `main.js`. Tab switch auto-connects to the selected COM port at 115200 8N1; switching away or pulling the cable releases the port cleanly. Send field with Enter/Send button echoes locally as `> <cmd>` then streams board response. Pause buffers incoming data (capped ~150K chars) without losing it. Clear empties the log. Critically, flash is coordinated: before `electronAPI.flash` / `flashDFU` is invoked, the renderer calls `pauseSerialBeforeFlash()` which closes the port (avoiding Windows port-in-use); after `build:done(type:'flash')` fires, `resumeSerialAfterFlash()` reopens it ~800ms later if the user is still on the serial tab. CSS-only context switching: `#build-log.serial-active` class hides build actions, shows serial actions (status / pause / clear). Trade-offs documented: auto-scroll always follows tail (no scroll-lock-on-manual-scroll), and `_serialAutoPaused` resume only fires when the user is still on the serial tab — preventing background reconnects to a dead port after a failed flash. | Fixed |
| BUG-012 | §60 (TC-900 through TC-930) | New capability (not a regression) | Board dropdown (V1/V2/V3) had been an independent UI selector — could disagree with the `#include "proffieboard_vN_config.h"` line, which is meaningless because the compiler reads the include, not the dropdown. Reversed the precedence: `#include` line is the source of truth, `@jmt:board` metadata is defensive fallback. Live auto-detect on edit (250ms debounce) syncs the dropdown when the include line changes. User dropdown click rewrites the include line in place as a single undoable Monaco edit, with a toast ("Board changed to X (include updated).") and ~2.7s line flash. `event.isTrusted` guards the rewrite handler so programmatic dispatches from loadContent / auto-detect don't trigger phantom rewrites. When no include exists, a confirm modal asks before inserting one — placement: into existing `#ifdef CONFIG_TOP` at top of block if present, else fresh CONFIG_TOP scaffold at top of file (after leading comments, preserved verbatim). Misspelled / malformed directives correctly fail to match (by design — we don't guess from typos). Design validated with Proffie Pro before shipping; established the "scoped, visible, reversible" triad as a portable no-confirm-required green-light test for user-initiated source modifications. | Fixed |
| BUG-029 | §56.3 (TC-831a through TC-831e) | P2 | Adding a new helper silently failed when the user typed just the expression body (e.g. `Red`) instead of a full `using NAME = …;` statement: `_buildHelperBlock` wrapped the body verbatim in `/*--- NAME ---*/` headers, the parser then couldn't locate the entry via its `using NAME =` regex, and the helper "disappeared" from the visual view. The first attempt at this fix added save-time validation but the error wasn't visually clear (no red highlight on the offending field, error message tucked under the name even when the problem was in the body) and validation only fired on Save click, not as the user typed — Ryan called out that it wasn't "transparent" like Add Style's name validation. **Comprehensive fix.** Save handler: in Add mode, auto-wrap when the body lacks `using` (parallel to `_buildStyleBlock`); refuse the save when name/code names don't match; surface every error inline. Generalized `_showHelperNameError` into `_showHelperError(msg, where)` where `where ∈ {'name', 'body'}` so the right field gets the `invalid` red-border treatment. New `#styles-helper-monaco.invalid` CSS rule paints a red inset border on the body editor for body-side errors. Name input's existing `input` event now runs LIVE validation (identifier rules + duplicate-name check against the current styles) so the error appears as the user types, not after Save. Body editor's `onDidChangeModelContent` clears the body-invalid border as soon as the user edits — the user sees feedback that they're addressing the problem. Save button stays disabled while any error condition holds. | Fixed |
| BUG-028 | §56.2 (TC-827a) | P3 | Ctrl+Z in the Style Library visual view didn't bring back a card deleted via the × → confirm flow. The visual-view undo stack (`_styleReorderUndoStack` in `renderer/index.html`) only captured drag-reorder snapshots — the keydown handler that pops from this stack on Ctrl+Z had nothing to restore after a card delete. `_deleteStyleEntry` ran setValue on the styles editor (which clears Monaco's internal undo stack too), so neither path worked. Fixed by snapshotting the pre-delete styles content into `_styleReorderUndoStack` and clearing `_styleReorderRedoStack` right before the setValue, parallel to how drag-reorder does it at line 7214. Helpers go through the same `_deleteStyleEntry` function so this fix covers both card-delete and helper-delete. Stack also drives Ctrl+Y (redo) via the existing handler. | Fixed |
| BUG-027 | §61.3 (TC-942a) | P3 | Ctrl+Z was no-op after clicking the X on a collapsed slot tile (`_resetSlot` / `_deleteExcessSlot`) until the user clicked into the Monaco editor first. Both functions already called `editor.focus()` synchronously after `_atomicEdit`, but some browsers reassert focus on the just-clicked button when the click event finishes — overriding our focus call. Result: Ctrl+Z went to the (now-removed-from-DOM but still document.activeElement) button and dropped silently. Fixed by deferring the focus via `setTimeout(() => editor.focus(), 0)` so it runs after the click event has fully resolved and the browser's default focus management has played out. Did NOT centralize the fix in `_atomicEdit` because that function is also called from background flows (`_syncConfigArrayRefs` during rebuild) where stealing focus from the user's active edit would be worse than the bug it solves. | Fixed |
| BUG-026 | §64.15d (TC-1168, TC-1168a, TC-1169) | P3 | B1 (and any non-wrapper) slot's color swatch was missing on the very first sidecar render and only appeared after the user opened/closed a slot or switched presets. Root cause: `_openSidecar` called `_ensureStylesLoaded()` fire-and-forget, then `_rebuildSidecar()` ran synchronously — slot tiles built during that window saw `_silentStylesText` as null and `_getHelperRegistryArgs` returned empty, so no swatch rendered. The first attempted fix had `_ensureStylesLoaded` auto-trigger a second `_rebuildSidecar` after the styles text resolved, but the second render shifted tile heights and read as a "jumpy reload." Replaced with: `_openSidecar` now `await`s `_ensureStylesLoaded` BEFORE its first `_rebuildSidecar`, so the preset list paints once with everything in place. Sidebar visually opens immediately via the class toggles; preset content paints ~50ms later — clean single-pass render. In the same pass, the ArgumentName enum load was made fully lazy: removed from `initBuildPanel`, removed from `onOsVersionChange` (replaced with an invalidate via a new `invalidateSlotMap` helper on `proffieArgs`), triggered only on first Advanced-section open in any slot. Base-color swatches don't need the enum at all (they come from the styles file via `_getHelperRegistryArgs`); the legacy hardcoded table covers the common args until the enum loads. Saves an IPC roundtrip when the user never touches Advanced. | Fixed |
| BUG-025 | §64.15d (TC-1159 through TC-1168) | P1 | Style argument parens strings (`StylePtr<MyStyle>("65535,0,0,32768,…")`) were serialized as a comma-only flat CSV positioned by a hardcoded `csvOffset` registry. ProffieOS actually expects space-separated SLOTS keyed by the `enum ArgumentName` order in `styles/edit_mode.h`, with `~` for empty slots and comma-joined values inside Rgb slots. The hardcoded approach broke sparse args (couldn't skip slots) and version differences (e.g. `RETRACTION_OPTION2_ARG` slot index varies across OS versions). **Three-layer fix.** Main process: `proffieos.js getArgumentNames(versionName)` reads `<versionPath>/ProffieOS/styles/edit_mode.h`, parses `enum ArgumentName { … }` line-by-line, returns `[{name, comment, slot}]` ordered by slot. Cached per-version, invalidated alongside `_hashCache` on JMT apply. IPC handler `proffieOS:getArgumentNames`. Renderer: `proffieArgs.refreshSlotMap()` fetches the map and populates synchronous globals `slotMap` (name→slot) and `slotComments` (name→enum line-comment, used for tooltips). Wired into `initBuildPanel` and `onOsVersionChange` so the map stays current. Format: `effect-args.js readRegistryArg/writeRegistryArg` rewritten — `_isNewFormat` detects modern vs legacy (presence of space or `~` → new), `_parseNewSlots`/`_parseOldSlots` produce a 1-indexed slot array from either format, `_serializeSlots` emits the modern format with trailing-empty trim. Every write produces modern format; reads of legacy configs auto-migrate on first save. `styleArgResolver.js` resolveStyleArgs/writeArgValue now delegate parens read/write to `proffieArgs`. Tooltip on arg labels in the expanded slot editor now uses the enum's `//` comment (e.g. "Primary Base Color") when present. Args missing from the selected version's enum are reported as `unsupported: true` from readRegistryArg and ignored by writeRegistryArg rather than written to a wrong slot. | Fixed |
| BUG-024 | §64.15c (TC-1148 through TC-1158) | P2 | Wrapper slots with a class INNER parameter (e.g. `StylePtr<PixelSwitchWrapper<Vader>>()`, no colorArg) displayed the **inner's** BASE_COLOR_ARG defaultExpr in the expanded BASE_COLOR_ARG row instead of the **wrapper's** own — because of an "Merge INNER args first" priority in `renderer/index.html` (the makeArgRow registryArgs construction). On the saber this is a real two-color situation: wrapper paints its default during preon/postoff/transitions, inner paints its default during the active blade. Without disclosure, the user couldn't tell what was actually happening. **Three-phase fix.** Phase A: flipped merge priority so the outer (wrapper) helper's args land first; inner serves as fallback only for args the wrapper doesn't define. PixelSwitchWrapper's `Rgb<255,255,255>` now wins for BASE_COLOR_ARG; pure passthrough wrappers (no own RgbArg) still surface the inner's default. Phase B: new helper `_detectInnerColorMismatch(slot)` detects the wrapper-vs-inner color disagreement; expanded view appends an indented read-only disclosure row under Inner Style with the inner's swatch, color name, a ⚠ icon, and a one-click "Match inner" button that writes BASE_COLOR_ARG to the inner's color (parallel to existing Match B1). Disappears when colors align or a colorArg is set. Phase C: collapsed-slot swatch overlays a small ⚠ at top-right when the mismatch exists, providing at-a-glance signal. Also restored the Inner Style dropdown's select-all-on-focus behavior (parallel to the outer Style Library dropdown). | Fixed |
| BUG-023 | §64.15b (TC-1144 through TC-1147) | P3 | Collapsed-slot color swatch reported the wrong color for any slot using a template wrapper with a class INNER parameter. Example: B2 in source as `StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopePrequelsBaseColor>>("...")` — the helper resolves to a purple style (`Rgb<118,0,194>`), but the tile displayed a white dot labeled "White". Root cause in `renderer/index.html`: both color-detection sites (the inline collapsed-tile renderer near line 11050 and the shared `_resolveSlotColor` near line 11253) took the OUTER name from `slot.expr` and scanned that helper's body. For a wrapper like `PixelSwitchWrapper`, that body contains color literals from the wrapper's own machinery (TransitionEffect/AlphaL boilerplate), so an early `White` won over the user-visible color which actually comes from the inner style's body. Fixed by adding a `_resolveLeafStyleName(expr)` helper that walks down through wrapper INNER class params (using existing `_getHelperTemplateParams` / `_parseCurrentTemplateArgs`) to find the leaf style name, then scanning the LEAF's body for the earliest color. Both detection sites now use the leaf. Plain non-wrapper helpers are unaffected (no INNER param → leaf is themselves). Recursion capped at 5 levels defensively. | Fixed |
| BUG-022 | §64.15a (TC-1140 through TC-1143) | P3 | Build modal's close button still read "Cancel" after "✓ Flash Complete" (and after other terminal states once the user had passed through a flow that renamed it). Root cause: the DFU driver-fix screen at `renderer/buildPanel.js:2068` correctly sets `bm-close.textContent = 'Cancel'` because the user CAN cancel that intermediate step — but `finishBuildModal` (the terminal-state helper at line 1041) never reset the label, so the rename persisted into subsequent success/failure modals where there's nothing to cancel. Fixed by adding `_closeBtn.textContent = 'Close'` to `finishBuildModal` right after the show-button line, so every terminal modal state clears stale labels. Mid-flow labels (DFU "Cancel") still work because those code paths set the text after `finishBuildModal` isn't running. | Fixed |
| BUG-021 | §64.15 (TC-1136 through TC-1139) | P2 | Opening a B2+ slot whose template helper has an empty INNER class param (e.g. `StylePtr<PixelSwitchWrapper>("...")` in source) showed the Inner Style dropdown filled in with B1's style name as a default — but the source was NEVER actually updated until the user manually bumped the dropdown (even selecting the same value worked). The pre-populate code at `renderer/index.html:12058-12069` wrote the inferred default into `editTemplateArgs[idx]` (in-memory state) so the UI rendered it, but no `commitTemplateArgs()` call followed. Result: dropdown lied about a value the config didn't have, so compiles failed with `error: no matching function for call to 'StylePtr<template<class INNER> using PixelSwitchWrapper = ...'>` (cascading into `cannot convert 'Preset*' to 'BladeBase*'`) — the bare template-alias form is illegal as a `StylePtr<>` argument. Fixed by adding a `_prepopulatedFromB1` flag in the pre-populate loop and, when set, calling `commitTemplateArgs()` immediately, then returning early from `_startSlotArgEdit`. The commit triggers the standard atomicEdit + `_reopenAfterRebuild` flow, so the slot reopens (~50ms later) with the committed state — same pattern every dropdown change already uses. Gating: only fires when (a) editing B2 or higher, (b) B1 is a library helper, (c) the INNER slot is empty in source. Existing values are preserved (TC-1137). | Fixed |
| BUG-020 | §41 Build / Compile (TC-553a, TC-553b) | P2 | "✗ Compile Failed" modal overflowed and pushed the Close button off-screen on C++ template-instantiation errors. GCC fully expands template aliases inline, so a single error line for `StylePtr<PixelSwitchWrapper>` (where `PixelSwitchWrapper` is a `template<class INNER> using ... = TransitionEffect<...>`) can be several KB on one line. The modal status box (`#bm-status`) had no width or height constraint and lived in a `display:flex; justify-content:space-between` row — long content expanded the box, shoving the action buttons off the visible area. Two fixes: (1) `toolchain.js extractCompileError` rewritten to peel the leading absolute path (`C:\Users\Ryan\AppData\Roaming\…\config\`) and keep just `basename:line`, then cap the error message itself at 180 chars per line with an ellipsis, then cap total errors at 3 with a `…and N more (full output in Build Output panel)` footer pointing the user at the persistent verbose log. (2) `#bm-status` CSS gained `flex: 1 1 auto; min-width: 0; max-height: 5.4em; overflow-y: auto; word-break: break-word; white-space: pre-wrap` so it can't push siblings AND scrolls internally if any single line still doesn't fit. Buttons are now always reachable. | Fixed |
| BUG-019 | §64.14 (TC-1133 through TC-1135) | P3 | The CSS empty-state hint (`#bp-serial-log:empty::before`) vanished the instant ProffieOS streamed its welcome text on connect, so users never had a chance to read the right-click → suppress affordance. Pre-existing `::before` is fine when the log is genuinely empty (tab open, board not yet connected) but useless once data lands. Fixed by adding a persistent in-log hint entry via `_serialAppendHint()` called from `openSerialMonitor` after `_serialOpen = true`. Hint is a real DOM `.serial-line.serial-hint` element with JMT-blue left border, sits at top of scrollback, and survives the welcome flood. Gated to only emit when `log.children.length === 0`, so multiple open/close cycles (tab switch, flash reconnect) don't accumulate hints. Cleared logs are also "empty" — manual clear followed by a reconnect re-emits the hint. Subject to SERIAL_MAX_LINES trim but only after ~1000 lines, by which point the user has either internalized the affordance or doesn't need it. | Fixed |
| BUG-018 | §64.14 (TC-1132) | P2 | Opening the Serial Monitor tab BEFORE a board was connected left the tab stuck at "no port selected" forever. When the user later plugged in the board, port detection auto-selected the port (`refreshPorts` set `selectedPort`), but no listener tied that auto-detection to opening the monitor — the user had to bump the port dropdown or switch tabs to trigger the connect, which is not discoverable. The user-driven `onPortChange` handler already had the right logic (`if _serialActive && !window._isFlashing → reopen monitor`), but it only fires on dropdown clicks, not on auto-detection. Fixed in `renderer/buildPanel.js refreshPorts` by adding an auto-open trigger at the end of the function: if `_serialActive && !_serialOpen && selectedPort && !window._isFlashing && !_serialAutoPaused`, await `openSerialMonitor()` and refocus the send input. The `_serialAutoPaused` guard prevents racing with `resumeSerialAfterFlash`, which owns the post-flash reopen with its own 800ms delay. | Fixed |
| BUG-017 | §64.14 (TC-1110 through TC-1131) | New capability (not a regression) | Serial Monitor first cut always auto-scrolled the log to the latest line — Arduino IDE behavior, hostile to reading history. Independently, alt-tabbing back to JMT Studio with the serial tab open didn't restore document focus to the send input, so the user had to click something before typing. Two changes, both in `renderer/buildPanel.js`: (1) Smart auto-scroll — added `_serialAutoScroll` flag and scroll listener with 20px tolerance (loose enough that touchpad momentum doesn't kick the user out of auto-follow). `_serialAppendLine` only does `scrollTop = scrollHeight` when the flag is true; otherwise increments `_serialPendingNewLines` and surfaces a floating `↓ N new` pill at the bottom-right of the log (HTML + CSS in `renderer/index.html`). Click the pill, scroll back to bottom, send a command, clear the log, or press End (outside an input, serial tab active) → all snap to bottom + re-engage. Count caps at `99+`. (2) Focus restoration — `window.addEventListener('focus', ...)` in `wireSerialMonitor` calls `el('bp-serial-input').focus()` via `setTimeout(0)` when `_serialActive && _serialOpen`, so the send input is ready to receive keystrokes the moment the window regains focus. Defers past Electron's own focus bookkeeping. State preserved across pause/resume, tab switch, board reconnect after flash — verified explicitly in TC-1123 through TC-1128. | Fixed |

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
