# Font Library

**Target release:** v1.8.0 (headline feature)
**Status:** Open spec, design questions partially resolved (Q1, Q2, Q4, Q5 resolved 2026-06-06)
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

Metadata storage shape TBD (likely a sibling `meta.json` next to the font folder, or a top-level library index).

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

Clicking a card opens the contents of the font folder, not a form. The detail view lets the user:

- Rename individual files inside the folder
- Drag files in (from desktop or another folder)
- Import files via a picker
- Delete files

All operations are undoable. See Engineering notes on the undo system.

Metadata editing (name, author, purchased, acquisition date, description, linked style) lives somewhere accessible from this view. Placement is an open question.

## Open questions

These are blocking design decisions. Each will be answered with Ryan during the build and the answer logged here.

### 1. Multi-version source folders — RESOLVED 2026-06-06

**Decision:** User picks a single folder. App auto-detects the multi-version structure: if a `Proffie/` subfolder is present, treat that as the import target; otherwise use the picked folder directly. Users who already drilled into the Proffie subfolder before picking also get correct behavior. The on-disk library name comes from the user-supplied metadata name (not the source folder name), so a user who picked the `Proffie/` subfolder will rename it to something meaningful like `Vader` before save.

Validation mirrors the OS-versions import pattern (minimum: folder exists and contains at least one `.wav` file). See Validation section under Import flow.

### 2. Style library link direction — RESOLVED 2026-06-06

**Decision:** One optional default style per font. The same style can be the default for unlimited fonts (one-to-many: style → fonts).

If the linked style is removed from the Style Library after the link was made, do NOT silently un-link. The style picker on a preset using that font shows an empty selection with a red note beneath: `Default style "<name>" is unavailable`. The link is preserved so re-adding the style restores the auto-populate behavior without manual re-linking.

### 3. MTP trigger flow — OPEN

When the user picks "Push to saber via mass storage," does the app:

- Auto-send `sd 1` over the existing serial connection (smoother flow, requires serial to be active).
- Require the user to enable mass storage on the saber manually via button presses, and the app just detects the mount.

**Cody's lean:** Auto-send `sd 1`. The user is already in Config Manager when this matters; serial is already connected.
**Resolution:** TBD.

### 4. Library deduplication — RESOLVED 2026-06-06

**Decision:** Names are required and must be unique. Enforce at save time with inline validation error ("Name already in use") and block save until the user supplies a unique name. No silent overwrite, no auto-rename suffix.

### 5. UI placement — RESOLVED 2026-06-06

**Decision:** New top-level tab placed after Style Library and before OS Versions. Tab order: Config Manager → Style Library → Font Library → OS Versions.

UI shape: card grid modeled on the Style Library (alphabetical, with search and filter). Clicking a card does NOT open a form. It opens a detail view of the font folder's contents where the user can rename files, drag in new files, import via picker, and delete files. All operations undoable. See UI structure section above.

### 6. Metadata edit placement — OPEN (new)

The card view opens a file-contents view, not a metadata form. So where does metadata editing (name, author, purchased, date, description, linked style) live?

Candidates:
- A toggle or tab inside the detail view ("Files" / "Properties")
- A properties drawer that slides out from the side of the detail view
- A button or icon on the card that opens metadata in a dialog without entering the detail view
- Right-click on the card → Edit metadata

**Cody's lean:** Toggle inside the detail view (Files | Properties). Keeps the detail view as the single place to work with one font, no extra UI surface for the user to learn.
**Resolution:** TBD.

### 7. Undo scope — OPEN (new)

"All undoable" was specified for the file operations inside a font folder (rename / drag-in / import / delete). What else falls under undo?

- File operations inside a folder (definitely yes)
- Deleting an entire font from the library
- Renaming a font (changes the on-disk folder name)
- Editing metadata fields
- Import of a new font (probably yes, as "remove the just-imported font")

Also: is undo a global stack (one Ctrl+Z affects whatever was last done across the module), or per-font (each font's detail view has its own history)? Per-font is more contained; global is more in line with usual app expectations.

**Cody's lean:** Undo covers everything that mutates library state. Global stack scoped to the Font Library tab.
**Resolution:** TBD.

## Engineering notes

- **MTP cross-platform mount detection is the hardest engineering piece.** Reader-path SD writing is straightforward; MTP requires per-OS code for mount detection, drive enumeration, and safe-eject. If scope tightens before ship, MTP becomes a Phase 2 feature behind the reader path.
- **Undo system.** Required by spec ("all undoable"). Operations on files inside a font folder (rename, drag-in, import, delete) need to be reversible. Implementation approach: command pattern with an operation log per session, where each operation knows how to invert itself. Deletes must be soft (move to a session-scoped trash area inside userData) so undo can restore. Final scope of what undo covers is open question 7.
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
- Editing or transcoding font files inside the app.
- Validating internal font folder structure (intentional, see User context).
- Per-font preview audio in the library UI (could be added in v2; not part of v1 scope unless Ryan calls it in).
