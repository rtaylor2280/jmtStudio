# Font Library

**Target release:** v1.8.0 (headline feature)
**Status:** Open spec, most design questions resolved (Q1, Q2, Q3, Q4, Q5, Q6 resolved 2026-06-06)
**Owner:** Ryan
**Last updated:** 2026-06-06

## Purpose

Make it easier to add sound fonts to a saber. Closes the loop between editing a config in JMT Studio and actually hearing the result on the hardware. Today users move font files around in Explorer or Finder; the Font Library brings that workflow inside the app.

## User context

Ryan (and the target user) has a folder of purchased sound fonts on their machine. Vendors typically ship each font as a top-level folder with subfolders for different boards: `Proffie/`, `Xeno/`, `CrystalFocus/`. JMT Studio only cares about the Proffie subfolder.

A "font folder" in our model is a named folder like `vader`, `VoltBlade`, `G-Grievous`, `Dark_Ani`. The contents inside vary by vendor (some have `hum.wav`, some have multiple `hum01.wav` / `hum02.wav`, some have `font.wav`, etc.). **We do not validate the internal structure of a font folder.** The contents are the contents. This is intentional because vendor variation is real and prescribing a structure would break legitimate fonts.

## Data model

### Library storage

Imported font folders are copied into a userData-backed library, not symlinked. Source folders may move or disappear; the library owns its own copy. Standard disk-space tradeoff for portability and reliability.

Proposed path: `userData/fontLibrary/<font-folder-name>/`

### Per-font metadata

Each library entry carries metadata alongside the font files:

- **name** — display name (defaults to the source folder name; user can override during import)
- **author** — string, free text (font creator / vendor)
- **purchased** — boolean
- **acquisitionDate** — date string (ISO format)
- **description** — string, free text
- **linkedStyleLibraryEntry** — optional reference by name to a style in the Style Library

When the linked-style field is populated, selecting that font on a preset auto-populates the linked style as the default for that preset slot. Useful UX: the font and its intended style travel together.

Metadata storage shape TBD. Two main candidates: a sibling JSON file inside each font folder (portable, vulnerable to user deletion), or a single central index at the library root (durable in-app, less portable). See open question 8.

## Import flow

1. User picks a folder from the filesystem.
2. App scans for vendor multi-version structure. If the picked folder contains a `Proffie/` subfolder (typically alongside `Xeno/`, `CrystalFocus/` siblings), auto-detect and treat that subfolder as the import target. If the user already navigated into the Proffie subfolder before picking, use the picked folder directly. Either path is supported because users will reasonably do both.
3. Validate the chosen folder (see Validation below). Block import on failure with an inline error.
4. Prompt for the metadata fields. **Name** is required and must be unique within the library. The default name is the source folder name (so a user who picked the `Proffie/` subfolder sees `Proffie` pre-filled, which they will almost always change to something meaningful like `Vader`).
5. Copy contents into `userData/fontLibrary/<name>/` using the user-supplied name as the on-disk folder name.
6. Add entry to the library index.

### Validation

Mirrors the validation pattern used for OS version imports. Minimum bar: the folder must exist and contain at least one `.wav` file. We do not enforce specific filenames like `hum.wav` or `font.wav` (vendor variation is real, see User context).

### Name uniqueness

Names are the canonical identifier in the library. The import flow rejects a duplicate name with an inline validation error ("Name already in use") and will not save until the user supplies a unique name. No silent overwrite, no auto-rename suffix.

## Transport to the saber

Two paths to write fonts to the saber's SD card:

### Path A: SD card via reader (simpler, lands first)

User physically removes the SD card from the saber and plugs it into a PC card reader. JMT Studio sees it as a mounted drive (drive letter on Windows, mount point on Mac/Linux). The user picks the destination drive. App writes selected fonts. App requires safe-eject before user removes the card.

This path is cross-platform straightforward and is the v1 default. Lands as Phase 1.

### Path B: USB mass storage via `sd 1` / `sd 0`

With the saber connected via USB serial (already the case when in Config Manager), JMT Studio sends the `sd 1` command over serial to ProffieOS 8+. The board exposes the SD card as a USB mass-storage device. App detects the new drive, writes fonts, ejects safely, sends `sd 0` to return the board to normal saber operation.

**Engineering note:** mount detection is OS-specific. Windows enumerates logical drives; Mac watches `/Volumes/`; Linux uses udev or polls `/media/$USER/`. Safe-eject is also OS-specific. Real engineering time. Phase 2 candidate if scope tightens before ship.

### Safe removal everywhere

Whether the card came in via reader or MTP, the app must always perform a safe-eject of the SD volume before allowing the user to physically remove the card or before sending `sd 0`. Writing to SD without eject risks file corruption. This is non-negotiable on both paths.

## Deployment modes

Three ways to push fonts onto the SD card:

- **Whole library** — copy every font in the library to the card.
- **Selected fonts** — user picks a subset via the library UI.
- **Auto-match to open config** — parse the open config's presets, extract font folder references, push only fonts that are referenced and exist in the library.

Auto-match is the smartest default for users with large libraries: minimizes SD content to what the open config actually needs.

## Visual styles editor integration

Once a library exists, the font folder field in the visual styles editor (currently free text) becomes a dropdown sourced from the library. If a preset references a font name that is not in the library, the dropdown shows a red / missing-state visual indicator so the user can see the gap before flashing.

### Linked-style behavior

When a preset uses a font whose `linkedStyleLibraryEntry` field is set, the style picker on that preset auto-populates with the linked style as the default. If the linked style has been removed from the Style Library since it was linked, the style picker shows an empty selection with a red note beneath it: `Default style "<name>" is unavailable`. The link is preserved (not silently dropped) so re-adding the style to the library restores the auto-populate behavior without manual re-linking.

The font-folder field today lives in [renderer/index.html](renderer/index.html) inside the preset detail editor (location to confirm during implementation).

## UI structure

New top-level tab placed after Style Library and before OS Versions. Tab order: Config Manager → Style Library → **Font Library** → OS Versions.

### Browse view (default)

Card grid modeled on the Style Library, alphabetical by name. Each card shows the font name and key metadata at a glance. Search and filter affordances above the grid.

### Font detail view (opens on card click)

The detail view is a single screen with two regions, modeled on existing app patterns:

**Top region — editable metadata form.** Look-and-feel of the Style Library's "open style for edit" modal, but with the metadata fields instead of style code: name, author, purchased, acquisition date, description, linked style. Always editable while the card is open.

**Bottom region — editable file list.** Structure modeled on the OS Versions file-view layout, but unlike OS Versions this list is editable. Operations:

- Rename individual files in the folder
- Drag files in from desktop or another folder
- Import files via a picker
- Delete files
- Click a `.wav` row to play the file in-app (audio playback)

All operations are undoable while the card is open. See Engineering notes on the undo system.

### In-app audio playback

Clicking a `.wav` file in the detail view's file list plays the sound through the system audio. Implementation uses Electron's built-in HTML5 audio support; no extra dependency. Required for v1 because reviewing a font's sounds is half the reason to open the detail view in the first place. (Out-of-scope until 2026-06-06; called in by Ryan during the spec session.)

## Open questions

These are blocking design decisions. Each will be answered with Ryan during the build and the answer logged here.

### 1. Multi-version source folders — RESOLVED 2026-06-06

**Decision:** User picks a single folder. App auto-detects the multi-version structure: if a `Proffie/` subfolder is present, treat that as the import target; otherwise use the picked folder directly. Users who already drilled into the Proffie subfolder before picking also get correct behavior. The on-disk library name comes from the user-supplied metadata name (not the source folder name), so a user who picked the `Proffie/` subfolder will rename it to something meaningful like `Vader` before save.

Validation mirrors the OS-versions import pattern (minimum: folder exists and contains at least one `.wav` file). See Validation section under Import flow.

### 2. Style library link direction — RESOLVED 2026-06-06

**Decision:** One optional default style per font. The same style can be the default for unlimited fonts (one-to-many: style → fonts).

If the linked style is removed from the Style Library after the link was made, do NOT silently un-link. The style picker on a preset using that font shows an empty selection with a red note beneath: `Default style "<name>" is unavailable`. The link is preserved so re-adding the style restores the auto-populate behavior without manual re-linking.

### 3. MTP trigger flow — RESOLVED 2026-06-06

**Decision:** App handles the full sequence over the existing serial connection: send `sd 1`, wait for the SD volume to mount, do the work, perform a safe unmount/eject of the volume, then send `sd 0` to return the board to normal saber operation. The user does not need to engage any buttons on the saber.

**Engineering caveat called out by Ryan:** safe unmount/eject is OS-specific and is the engineering risk. Windows path is well-known (e.g. `mountvol /D` or `RemoveDriveSafely.exe` patterns). Mac and Linux are TBD and need real testing. This was flagged at spec time so we do not assume the cross-platform piece is free.

### 4. Library deduplication — RESOLVED 2026-06-06

**Decision:** Names are required and must be unique. Enforce at save time with inline validation error ("Name already in use") and block save until the user supplies a unique name. No silent overwrite, no auto-rename suffix.

### 5. UI placement — RESOLVED 2026-06-06

**Decision:** New top-level tab placed after Style Library and before OS Versions. Tab order: Config Manager → Style Library → Font Library → OS Versions.

UI shape: card grid modeled on the Style Library (alphabetical, with search and filter). Clicking a card does NOT open a form. It opens a detail view of the font folder's contents where the user can rename files, drag in new files, import via picker, and delete files. All operations undoable. See UI structure section above.

### 6. Metadata edit placement — RESOLVED 2026-06-06

**Decision:** Metadata lives at the top of the detail view as an always-editable form, with the file list directly below. Look-and-feel: Style Library "edit style" modal up top, OS Versions file-view structure below (but editable). Single screen, no tabs or drawers.

### 7. Undo scope — PARTIALLY RESOLVED 2026-06-06

**Resolved:** Undo is local to the open card. While a card is open, all mutations are reversible via undo. Closing the card commits the state (no further undo from outside the card).

**Open sub-question — live operations vs staged operations:**

Two architectures for the "while open, all undoable" behavior:

- **Live mode.** Each operation mutates disk immediately. Undo reverses it (e.g. rename back, restore deleted file from a session trash, etc.). Simpler implementation; works well when the user does not need an "abandon all changes" affordance.

- **Staged mode.** Operations accumulate in a pending change set held in memory (or in a temp area). The font folder on disk is untouched until the user explicitly saves; closing without saving discards. Allows true Cancel/Save semantics, a "pending changes" indicator, and a clean abandon path. More implementation surface: virtual file list rendering, staged copies for imports, deferred deletes.

Ryan flagged staged mode as potentially differentiating: "unique file management that would again set us apart." Real point — most file-management UIs are live-mutation; staged feels more like document editing, which is closer to how the rest of JMT Studio behaves (open config → edit → save).

**Cody's lean:** Staged mode in v1.8 if implementation effort is contained. The Save/Cancel framing is consistent with the rest of the app and the implementation is bounded (operation log + lazy apply on save). Live mode is the fallback if staged starts dragging schedule.
**Resolution:** TBD — decision before any detail-view code lands.

### 8. Metadata storage location — OPEN (new)

Where does the per-font metadata physically live on disk?

- **Option A — Sibling file in the font folder.** A uniquely-named JSON file inside each font folder (e.g. `_jmt_meta.json`). Self-contained, travels if the font is moved or reimported. Vulnerable to the user deleting it via the detail view's file list or external filesystem actions. Must be filtered out of SD-card writes (the board does not need it). Can also be filtered out of the in-app file list so the user is not exposed to deleting it accidentally.
- **Option B — Central index.** A single `userData/fontLibrary/_index.json` mapping folder name to metadata. Robust to in-app file edits (file not in the font folder, cannot be touched from the detail view). Less portable; if a font folder is renamed or moved outside the app, index goes out of sync.
- **Option C — Both.** Central index is authoritative; sibling file is a written-out backup that travels with the folder. Two write paths but no real data loss risk.

Ryan's instinct: Option A with the deletion risk accepted as "something we live with." Cody's view: Option A is fine if we filter the metadata file from the in-app file list (so it cannot be casually deleted), and from SD-card writes. That mitigates most of the risk without losing portability.

**Cody's lean:** Option A with in-app filtering. Filename uses a leading underscore or dot so it sorts out of the way and signals "internal."
**Resolution:** TBD.

## Engineering notes

- **MTP cross-platform safe-eject is the hardest engineering piece.** Reader-path SD writing is straightforward; MTP requires per-OS code for mount detection, drive enumeration, and crucially a safe-eject that the OS guarantees has flushed writes before we send `sd 0`. Windows path is well-known; Mac and Linux paths need real testing and possibly external helpers (`diskutil unmount` / `udisksctl`). Flagged by Ryan at spec time.
- **Undo system.** Required by spec ("all undoable while card open"). Two architectures on the table per open question 7 (live vs staged). Both share an operation-log design where each user action records an inverse. Staged mode adds a virtual-file-list rendering layer and defers all disk writes until save. Pick before any detail-view code lands.
- **Audio playback.** Click a `.wav` row in the detail view to play through system audio. Use Electron's HTML5 `<audio>` element or Web Audio API. No native dependency required. Should support stop/seek for longer files (clash hits and full hum loops are different sizes).
- **Config parser hook for auto-match push mode.** Need to identify where presets are parsed and pull the font-folder field cleanly. To confirm during implementation.
- **Visual styles editor dropdown location.** Need to find the current font-folder text field in the preset detail editor and replace it with a library-backed dropdown plus missing-state visual.
- **Auto-backup interaction.** A separate backlog item proposes auto-backup of user data. The font library may want to be included in that target list when that feature lands, but it does not block this one.

## Phased delivery option

If the v1.8 cycle gets tight before ship, the phased plan is:

- **Phase 1 (v1.8.0):** Library module (import, metadata, browse), SD-via-reader transport, visual styles editor dropdown integration. This is the user-facing headline.
- **Phase 2 (v1.8.x or v1.9):** MTP transport with `sd 1` / `sd 0`, cross-platform mount detection, safe-eject.

Both phases ship a useful product. Phase 1 alone closes the "drag files around in Explorer" pain.

## Out of scope for v1

- Browsing or searching a JMT-hosted online font catalog (parallel to Community Style Library; tracked separately on backlog).
- Editing or transcoding font files inside the app (rename and add/delete only; not waveform editing).
- Validating internal font folder structure (intentional, see User context).
