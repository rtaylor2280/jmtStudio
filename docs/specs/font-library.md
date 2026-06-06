# Font Library

**Target release:** v1.8.0 (headline feature)
**Status:** Open spec, design questions outstanding
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
2. App scans for vendor multi-version structure (`Proffie/`, `Xeno/`, `CrystalFocus/` subfolders).
3. If a Proffie subfolder is detected, app imports that subfolder. If structure is ambiguous, prompt. If structure is flat (no version subfolders), import the picked folder directly. **See open question 1.**
4. Copy contents into `userData/fontLibrary/<name>/`.
5. Prompt for or default the metadata fields.
6. Add entry to the library index.

### Deduplication

When the user imports a font whose name already exists in the library, the behavior is TBD. **See open question 4.**

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

The font-folder field today lives in [renderer/index.html](renderer/index.html) inside the preset detail editor (location to confirm during implementation).

## Open questions

These are blocking design decisions. Each will be answered with Ryan during the build and the answer logged here.

### 1. Multi-version source folders

When the user picks a folder that contains `Proffie/`, `Xeno/`, `CrystalFocus/` subfolders, how do we handle the import?

- Option A: Auto-detect the Proffie subfolder silently, prompt only on ambiguity.
- Option B: Always prompt the user to confirm which subfolder is the Proffie version.
- Option C: Take the picked folder as-is, assume the user pointed at the right place.

**Cody's lean:** A (auto-detect, prompt on ambiguity).
**Resolution:** TBD.

### 2. Style library link direction

- One default style per font (font → style), simpler.
- Or many-to-many between fonts and styles.
- If the linked style is later removed from the Style Library, do we silently un-link, warn on next use of the font, or keep a tombstoned reference?

**Cody's lean:** One style per font (font → style), silent un-link if the style is later removed (re-link manually is easy enough).
**Resolution:** TBD.

### 3. MTP trigger flow

When the user picks "Push to saber via mass storage," does the app:

- Auto-send `sd 1` over the existing serial connection (smoother flow, requires serial to be active).
- Require the user to enable mass storage on the saber manually via button presses, and the app just detects the mount.

**Cody's lean:** Auto-send `sd 1`. The user is already in Config Manager when this matters; serial is already connected.
**Resolution:** TBD.

### 4. Library deduplication

Same source folder imported twice, or two folders with the same name from different sources:

- Warn-and-skip the duplicate.
- Warn-and-overwrite the existing entry.
- Auto-rename with a suffix (`vader-2`).
- Let the user pick at import time.

**Cody's lean:** Let the user pick (warn + offer overwrite or rename).
**Resolution:** TBD.

### 5. UI placement

Top-level tab next to Config Manager / Style Library / OS Versions (matches the rest of the app's module shape), or embedded somewhere else?

**Cody's lean:** Top-level tab.
**Resolution:** TBD.

## Engineering notes

- **MTP cross-platform mount detection is the hardest engineering piece.** Reader-path SD writing is straightforward; MTP requires per-OS code for mount detection, drive enumeration, and safe-eject. If scope tightens before ship, MTP becomes a Phase 2 feature behind the reader path.
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
