# JMT Studio v1.8.0 — Full QA Test Plan

**Version:** 1.8.0
**Tester:** Ryan Taylor
**Date:** TBD (in development as of 2026-06-06)
**Platform / OS:** Windows 11 Pro (primary), macOS (notarized build), Linux (.deb / AppImage)
**Build type:** Dev / Production

Mark each test: ✅ Pass · ❌ Fail · ⏭ Skip (note reason)
Log failures in the **Bug Log** at the bottom with TC reference.

---

## Features in this release

- **Sound Font Library (HEADLINE)** — new top-level tab placed between Style Library and OS Versions. Imports user-supplied font folders into a userData-backed library with per-font metadata (name, author, purchased, acquisition date, description, optional default style). Auto-detects vendor multi-version folder structure (Proffie / Xeno / CrystalFocus subfolders). Browse view modeled on Style Library cards; detail view shows an editable metadata form on top and an OS-Versions-style editable file list below with in-app `.wav` playback. Two transport paths to the saber's SD card: physical card via reader and USB mass storage via `sd 1` / `sd 0` serial commands with safe-eject before disable. Three deployment modes: whole library, selected fonts, auto-match to open config's presets. Visual styles editor integrates a font-folder dropdown with missing-state visual flag. (See `docs/specs/font-library.md` for the full design contract.)
- **Cmd+O / Ctrl+O keyboard shortcut** — opens a file from anywhere on the Config Manager tab. Mirrors the existing Cmd+S pattern with one intentional deviation: no `inMonaco` focus skip, because Monaco does not own an internal Cmd+O handler so there is nothing to defer to. Single-handler implementation in `renderer/index.html` covers Windows, macOS, and Linux via the `e.ctrlKey || e.metaKey` modifier check.

---

## 65. KEYBOARD SHORTCUT ADDITIONS

### 65.1 Cmd+O / Ctrl+O — Open from config tab

- [x] TC-1200: On the Config Manager tab with no file open, press Ctrl+O (Windows/Linux) → file picker opens; cancel returns to the empty state cleanly ✅ *(Windows verified 2026-06-06)*
- [x] TC-1201: On the Config Manager tab with a config file open and focus NOT inside Monaco (e.g. focus on the preset sidecar or toolbar), press Ctrl+O → file picker opens ✅ *(Windows verified 2026-06-06)*
- [x] TC-1202: On the Config Manager tab with a config file open and focus INSIDE the Monaco editor (the common case after opening any config), press Ctrl+O → file picker opens. This is the regression case for the initial 13a055c bug where the `inMonaco` guard was dead-blocking the shortcut. ✅ *(Windows verified 2026-06-06 — fix in b6a55c2)*
- [ ] TC-1203: With unsaved changes in the open config, press Ctrl+O → unsaved-changes guard fires (Save / Discard / Cancel modal); Save → save then open picker; Discard → open picker; Cancel → no file picker, current config unchanged
- [ ] TC-1204: On a non-config tab (Style Library, OS Versions, future Font Library), press Ctrl+O → no action; handler is scoped to `_activeTab === 'config'` and silently skips elsewhere
- [ ] TC-1205: Click in the recent files dropdown or the filename field so focus leaves Monaco, then press Ctrl+O → file picker still opens (handler is unconditional on focus location, only checks active tab)
- [x] TC-1206: macOS — Cmd+O opens the file picker with the same semantics as Windows Ctrl+O ✅ *(code review — single handler in renderer/index.html uses `e.ctrlKey || e.metaKey` modifier check, no platform-specific code path; covered by the same TC-1200 through TC-1205 logic)*

---

## 66. SOUND FONT LIBRARY

*(Implementation in progress. Detailed test plan grows as the module lands. Spec is committed at `docs/specs/font-library.md` and resolves Q1, Q2, Q3, Q4, Q5, Q6 as of 2026-06-06. Open: Q7 live-vs-staged operations, Q8 metadata storage location.)*

### 66.1 Tab placement and empty state

- [ ] TBD — tab appears between Style Library and OS Versions
- [ ] TBD — empty state offers Import Font(s) affordance

### 66.2 Import flow — single Proffie folder

- [ ] TBD — user picks a folder containing a Proffie subfolder; app auto-detects and imports the Proffie subfolder
- [ ] TBD — user picks a flat folder (no Proffie subfolder); app imports it as-is
- [ ] TBD — user picks a folder with sibling Proffie/Xeno/CrystalFocus subfolders; app correctly identifies Proffie

### 66.3 Import flow — validation

- [ ] TBD — empty folder rejected with inline validation error
- [ ] TBD — folder with no .wav files rejected with inline validation error
- [ ] TBD — folder with at least one .wav file accepted

### 66.4 Import flow — name uniqueness

- [ ] TBD — duplicate name blocks save with inline error; user must supply unique name to proceed

### 66.5 Library browse view

- [ ] TBD — cards alphabetical
- [ ] TBD — search filters by name
- [ ] TBD — filter affordance present

### 66.6 Font detail view — metadata form

- [ ] TBD — form at top with all metadata fields editable
- [ ] TBD — name change writes to library index and to on-disk folder name
- [ ] TBD — linked style dropdown sourced from Style Library; empty option allowed

### 66.7 Font detail view — file list

- [ ] TBD — file list mirrors OS Versions file-view structure
- [ ] TBD — rename a file; persists on save (or commit, per Q7 resolution)
- [ ] TBD — drag a .wav from desktop in; appears in list
- [ ] TBD — import via file picker; appears in list
- [ ] TBD — delete a file; removed from list
- [ ] TBD — all operations undoable while card is open
- [ ] TBD — closing the card commits the staged changes (or applies live, per Q7 resolution)

### 66.8 In-app audio playback

- [ ] TBD — click a .wav row plays through system audio
- [ ] TBD — stop/seek controls function correctly on longer files (full hum loops)

### 66.9 SD card transport — reader path

- [ ] TBD — app detects mounted SD card (drive letter on Windows, mount point on Mac/Linux)
- [ ] TBD — user selects destination; selected fonts copied
- [ ] TBD — safe-eject prompt before user removes card

### 66.10 SD card transport — USB mass storage path

- [ ] TBD — app sends `sd 1` over serial; SD volume mounts on host OS
- [ ] TBD — work completes; app performs safe unmount; sends `sd 0`; board returns to saber mode
- [ ] TBD — Windows safe-eject verified end-to-end
- [ ] TBD — macOS safe-eject verified (engineering risk — see spec)
- [ ] TBD — Linux safe-eject verified (engineering risk — see spec)

### 66.11 Deployment modes

- [ ] TBD — whole library copies every font
- [ ] TBD — selected fonts copies the user-picked subset
- [ ] TBD — auto-match to open config's presets copies only fonts referenced by presets and present in the library

### 66.12 Visual styles editor integration

- [ ] TBD — font-folder field in preset detail editor becomes a dropdown sourced from the library
- [ ] TBD — preset referencing a font name not in the library shows red / missing-state visual
- [ ] TBD — selecting a font whose `linkedStyleLibraryEntry` is set auto-populates the linked style as the preset's default
- [ ] TBD — linked style later removed from Style Library → empty selection with red note `Default style "<name>" is unavailable`; link preserved for re-add

---

## Bug Log

| ID | TC | Severity | Description | Status |
|----|----|----------|-------------|--------|

*(No bugs logged yet for 1.8.0. Add entries as discovered.)*

**Severity:** P1 Blocker · P2 Major · P3 Minor · P4 Cosmetic

---

## Sign-off

- [ ] All P1 bugs resolved
- [ ] All P2 bugs resolved
- [ ] P3/P4 bugs reviewed and triaged
- [ ] Both dark and light modes verified
- [ ] Tested on Windows
- [ ] Tested on macOS (notarization confirmed, Mac-specific code paths verified)
- [ ] Tested on Linux (`.deb` install, AppImage, udev rules, DFU flash)
- [ ] **Windows code signing applied** — production build signed via Azure Artifact Signing cert; no SmartScreen warning on clean install
- [ ] **Linux `.deb` metadata complete** — Maintainer, license, SHA256 published
- [ ] Ready to ship
