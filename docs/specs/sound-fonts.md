# Sound Fonts Library

**Target release:** v1.8.0 (headline feature, multi-slice)
**Status:** Spec rewrite 2026-06-07 around the source-and-entry two-tier model. Replaces the prior single-tier `font-library.md` design.
**Owner:** Ryan
**Last updated:** 2026-06-07

## Naming

- **Tab label:** "Sound Fonts" (matches the existing tab strip pattern)
- **Full noun phrase:** "Sound Fonts Library" (used in modal titles, headings, settings labels, docs)
- **Code/internal references:** `soundFonts` (camelCase) for IPC names and the on-disk root
- **On-disk root:** `userData/soundFonts/`

## Model overview

Two-tier architecture, distinct concepts:

1. **Sources** — the user's archive of purchases as delivered. Each source is one purchase from one vendor, stored in its original form (zip file OR folder, no conversion). Includes everything the user got: board flavors they don't use, music tracks, quotes, READMEs, extras. The source never travels to the saber; it's the user's archive of what they own.
2. **Library entries** — curated subsets of a source, assembled by the user for SD card use. Each library entry is one font ready to load on a saber. An entry references its source and can have content added to it later by browsing back to the source.

One source can produce many library entries (e.g. an Emperor purchase contains four distinct fonts inside; the user can create one library entry per font). One library entry references exactly one source (its provenance).

```
userData/soundFonts/
  sources/
    <uuid>/
      source.zip          ← if imported as zip
      source/             ← if imported as folder
      meta.json           ← vendor, website, hash, format, dates, etc.
  library/
    <entryName>/
      <Proffie-conformant content extracted from the source>
      meta.json           ← linked sourceUuid, custom name, notes, etc.
```

Exactly one of `source.zip` or `source/` exists per source. `meta.json.format` is `"zip"` or `"folder"`.

## Primary scenario: time-of-purchase import

The model is designed for the user who imports fonts as they buy them, a few at a time. Each purchase arrives as a separate download (typically a zip). The user picks the zip (or folder, if it came that way or was pre-extracted), and JMT Studio handles the rest.

Flow:
1. User clicks **Import Sound Font** (toolbar button, single button regardless of format)
2. Native picker opens with both file and folder modes available
3. User picks a `.zip` or a folder
4. App computes a SHA-256 hash of the source as stored. If the hash matches an existing source, surface the duplicate handling UX (see open question 1).
5. App reads the source contents (zip table-of-contents OR filesystem walk) and identifies candidate Proffie-conformant fonts inside (see Proffie validation contract below). Auto-detects vendor by matching README content against the vendor lookup table.
6. App opens the **Import** dialog with two regions:
   - **Source metadata** (top): vendor (auto-detected if matched, free text + autocomplete from lookup if not), website (auto-filled from lookup), purchase date (defaults to source folder/zip creation time), notes. Informational hint near the picker reminds the user they can provide the original zip or whole folder, not just the Proffie subfolder.
   - **Candidate library entries** (bottom): list of fonts the app found inside the source. Each row: checkbox (default checked), editable name, status badge (`New` / `Duplicate with existing entry` / `Rename to import`), candidate's relative path inside the source, wav count. Select all / deselect all affordance.
7. User reviews, edits names if needed, unchecks anything they don't want, and confirms.
8. App writes the source to `userData/soundFonts/sources/<uuid>/`. For each checked candidate, it extracts the Proffie content to `userData/soundFonts/library/<entryName>/` and writes the link metadata.
9. View refreshes. New entries appear in the card grid; the source is referenced from each.

The import runs in the background using the existing queue infrastructure. Multiple sources can be queued (one zip at a time per the user's purchase pattern, but multiple zips can be queued during a shopping-session bulk).

## Deferred scenario: bulk legacy import

Ryan's existing collection (70+ pre-extracted bundles, mixed structures, partial vendor signatures) is a different problem. Same underlying crawl mechanism (find Proffie-conformant content at any depth), very different UX. The primary path assumes one source per import; the legacy path assumes a top-level folder containing many sources at various nesting depths. UX needs a review modal with many more candidates, vendor-pattern detection across mixed conventions, and likely a "skip what's already imported" rule using the duplicate hash.

**Defer to its own slice.** Build the primary path first. Once it's solid, the bulk path scopes naturally from the same primitives.

## Source storage

### Layout

```
userData/soundFonts/sources/<uuid>/
  source.zip OR source/           ← exactly one
  meta.json
```

### `meta.json` schema (source)

```json
{
  "schemaVersion": 1,
  "uuid": "...",
  "format": "zip" | "folder",
  "originalName": "Emperor.zip" | "Emperor",
  "hash": "sha256:...",
  "vendor": "Kyberphonic" | null,
  "vendorWebsite": "https://www.kyberphonicfonts.com" | null,
  "vendorAutoDetected": true | false,
  "purchaseDate": "2025-10-09",
  "importedAt": "2026-06-07T...",
  "userNotes": "",
  "fileSize": 1234567,
  "readmePaths": ["_ReadMe.rtf"]
}
```

### Format dispatch

A single source interface abstracts the two formats. Operations:

- **browse(path)** — list contents at a given path inside the source
- **readFile(path)** — return bytes for a single file (used for audio preview and library entry construction)
- **extractTo(path, destDir)** — extract a subtree to a destination directory
- **hash()** — SHA-256 of the source as stored
- **exportToDownloads()** — copy the source archive (zip or folder) into the user's Downloads folder

Zip-backed implementation uses a Node zip library (yauzl or node-stream-zip). Folder-backed uses `fs.promises` operations. Higher-level code (browse UI, library entry creation, audio preview) is format-agnostic.

### Duplicate detection

On import:
1. Hash the source as stored (zip bytes or folder content hash)
2. Compare against all existing sources' hashes
3. If a match is found, surface the duplicate (see open question 1)

**Known limitation:** cross-format duplicates are not detected. The same font imported once as a folder and again as a zip will have different hashes (different bytes). Logged as a known v1 constraint, not addressed in v1. May revisit if user reports show it matters.

## Library entries

### Layout

```
userData/soundFonts/library/<entryName>/
  <Proffie-conformant content>      ← see validation contract
  meta.json
```

Files are organized per the Proffie spec (see validation contract). The entry root contains effect subfolders, optional `config.ini`, optional `smoothsw.ini`, optional `alt000/`, `alt001/`, etc., and optionally `tracks/`, `quote/`, or other curated additions.

### `meta.json` schema (entry)

```json
{
  "schemaVersion": 1,
  "name": "Emperor V2 - Senate Chamber",
  "sourceUuid": "...",
  "candidatePath": "Emperor_V2/Senate_Chamber",
  "linkedStyleLibraryEntry": null,
  "purchased": true,
  "author": "Kyberphonic",
  "acquisitionDate": "2025-10-09",
  "description": "",
  "userNotes": "",
  "addedFromSource": [
    { "destPath": "tracks/01.wav", "sourcePath": "Emperor_V2/_Extras/Music/track3.wav", "originalName": "track3.wav" },
    { "destPath": "quote/01.wav", "sourcePath": "Emperor_V2/_Extras/Quotes/Part_1/quote5.wav", "originalName": "quote5.wav" }
  ],
  "createdAt": "2026-06-07T...",
  "updatedAt": "2026-06-07T..."
}
```

The `addedFromSource` array tracks every curation operation so the user can see provenance and the app can later show "you have track3.wav as tracks/01.wav" when browsing the source.

### Composition

An entry is created by extracting the Proffie content of a candidate from the source. Subsequent curation (adding tracks, quotes, alts) extracts additional files and places them per the Proffie spec.

## Proffie sound font validation contract

From `pod.hubbe.net/sound/`:

A valid Proffie sound font folder follows one of two naming conventions, and can mix them:

- **Flat:** all audio files at the root, named `EffectNameNNN.wav` (e.g. `hum1.wav`, `clash01.wav`, `swingh001.wav`)
- **Subfolder:** effect-named subdirectories at the root, each containing `NNN.wav` files (e.g. `hum/001.wav`, `clsh/02.wav`)

**Optional configuration files at the root:**
- `config.ini` — font-level configuration
- `smoothsw.ini` — SmoothSwing configuration

**Alt folders** for content variations (e.g. light/dark mode):
- Named `alt000`, `alt001`, etc. — three digits, starting at 000
- Every alt MUST have an identical file structure to the others; only audio content differs

**Sub-sub-sounds** add a deeper layer (`swng/01/000.wav`) for randomness within deterministic selection. Three-digit names, 000-indexed.

**Standard effect subfolders observed in real fonts:** `boot/`, `hum/`, `swingh/`, `swingl/`, `clsh/`, `blst/`, `lock/`, `force/`, `in/`, `out/`, `font/`, `lb/`, `bgnlb/`, `endlb/`, `bgnlock/`, `endlock/`, `melt/`, `bgnmelt/`, `endmelt/`, `drag/`, `bgndrag/`, `enddrag/`, `swng/`, `spin/`, `stab/`. Not all are required; the spec doesn't mandate any specific effect, but a saber needs `boot/` or `hum/` content to be playable.

**Not in the Proffie spec but commonly used by vendors:** `tracks/` for menu music, `quote/` (or `quotes/`) for movie quotes, `_Extras/` for bonus content. The app treats these as community conventions when curating from a source.

### Validation rules for a library entry

Before an entry is considered "ready for SD," it must:

1. Contain at least one of: a `boot/*.wav`, `hum/*.wav`, `font.wav`, or an effect-numbered file at root
2. If alt folders exist, all alts must have an identical file structure (same set of files, only content differs)
3. Sub-sub-sound directories follow the 000-indexed three-digit naming

Failures surface as warnings in the entry detail view, non-blocking. The user can ship a non-conformant entry to SD if they want; the app just won't claim it's standards-compliant.

## Vendor lookup table

Curated reference of known sound font vendors with detection patterns. Lives in the app, JMT-maintained, extended as new vendors are observed. Used during import to auto-fill source metadata (vendor, website, purchased status) by matching README content against patterns.

### Schema

```json
{
  "vendors": [
    {
      "id": "kyberphonic",
      "displayName": "Kyberphonic",
      "website": "https://www.kyberphonicfonts.com",
      "purchasedDefault": true,
      "detectionPatterns": [
        {
          "type": "readmeContent",
          "regex": "purchasing.*from\\s+Kyberphonic",
          "fileMatch": "_ReadMe\\.rtf"
        },
        {
          "type": "readmeFileSize",
          "fileMatch": "_ReadMe\\.rtf",
          "bytes": 1710
        }
      ]
    },
    ...
  ]
}
```

Multiple patterns per vendor (any-match wins). `readmeContent` is the canonical detection; `readmeFileSize` is a fast-path optimization for vendors with stable boilerplate READMEs.

### Seed list (from Ryan's collection)

Initial seed, verified during the spec rewrite from inspecting actual files in Ryan's `G:\My Drive\Ryan\Lightsaber\Sound Fonts` collection:

- **Kyberphonic** — `_ReadMe.rtf` at bundle root, 1710 bytes, content starts "Thank you for purchasing this font from Kyberphonic!" — verified across Ben, Emperor, PowerOfManyBundle, 決闘_The_Duel. Website: kyberphonicfonts.com (per the README).
- **BKSaberSounds** — `readme.txt` (lowercase) at bundle root, plain text, starts `'<Font Name>' by BKSaberSounds -<date>`. Verified in Dark AniV1.3. Website: needs research.
- **KSith** — `readme.txt` INSIDE the Proffie folder (not at bundle root), plain text, format `<Font Name> by KSith (v<version> - <date>)`. Verified in KSith_Ghost. Likely same convention across KSith_Rescue, KSith_ShadowBlade, KSith_Extraneous. Website: needs research.
- **JayDaloRian** — `ReadMe.txt` (mixed case) inside SOME sub-fonts in the JAYDALORIAN bundle. Format `Copyright: Jérôme Tremblay (JayDaloRian)`. Pattern is inconsistent across sub-fonts. Website: needs research.
- **Greyscale Free / Greyscale Sound Designs** — no detectable vendor signature in metadata files. Identifiable instead by structural pattern: bundles delivering content in a fixed `Asteria.zip + CFX-GHV3.zip + Proffie.zip + Verso.zip + Xeno3.zip` board-flavor zip set per sub-font, plus a `proffie_blade_style.txt` at each sub-font root. Useful as a fallback pattern. Website: needs research.

### Fallback when vendor unknown

When no pattern matches and no readme is found, the import dialog presents a free-text vendor field with autocomplete suggestions from the lookup table. If the user enters a new vendor not in the table, offer to add it (with website) so the next user with the same vendor benefits. Builds the table organically over time.

## Curation flow

### Source-aware browse UI in the entry detail view

When the user opens a library entry's detail view, there's a **Browse Source** affordance (button, panel, or expandable section). Activating it shows a navigable tree of the original source contents (read directly from the zip table-of-contents or from the source folder).

Tree shows:
- File names with format icons (audio file, text file, config file)
- Hierarchical structure
- Greyed-out indicator on files already added to this entry (with the `addedFromSource` mapping showing where each one is)

For audio files, click to play (audio preview, see below). For any file or folder, contextual actions:
- **Add as track** — places in `tracks/NNN.wav`, renumbered to the next available slot
- **Add as quote** — places in `quote/NNN.wav`, renumbered
- **Add to alt N** — appends to a specific alt folder, with structure validation
- **Replace effect file** — overwrites an existing entry-side file (e.g. swap a hum)
- **Add to <effect> folder** — for any effect-named subfolder in the entry

The action chooser is dynamic based on what file is selected (a wav has track/quote/alt options; an `_ReadMe` doesn't).

### Audio preview

Click any wav (in the entry's file list OR in the source browse) to play it. Uses Electron's HTML5 `<audio>` element. For zip-backed sources, the audio data is streamed by reading the file bytes from the zip and passing them as a Blob URL to the audio element.

Stop/seek controls function. Multiple wavs can be queued for preview (click to play, click next to interrupt and play that one).

### Quote renumbering on add

The Proffie spec requires numbered filenames in effect subfolders (`001.wav, 002.wav, ...`). When the user adds a quote (or any numbered effect file), the app:

1. Finds the next available index in the destination folder (e.g. if `quote/001.wav` and `quote/002.wav` exist, next is `003.wav`)
2. Copies the source file to the destination with the new numbered name
3. Records the original filename in `addedFromSource` so the user can reverse-lookup which one it was

If the user selects multiple files for bulk-add, they're assigned sequential indices in pick order.

### Track and quote folders

Per the Proffie spec, `tracks/` and `quote/` aren't formally defined. The app uses these conventions because they're common in the community and useful for the user's curation workflow. Files end up in `<entry>/tracks/NNN.wav` or `<entry>/quote/NNN.wav`.

If the user wants a different folder (e.g. `music/`), they can rename or move within the entry detail view's file list editor (covered in a later slice).

## Settings and tab management

Unchanged from the framework slice:

- "Show Sound Fonts tab" toggle in Settings, default on, key `soundFontsTabEnabled`
- Toggle interactive only when the library has zero entries; locks with hint when entries exist
- Disabling the tab while it's active switches to Config Manager

## Phased build order

Each phase ships independently and produces a working state.

**Phase 1: Source storage and import rebuild** *(replaces the current import flow)*
- Source storage layout (`userData/soundFonts/sources/<uuid>/`)
- Zip and folder format dispatch
- Source meta.json schema and writer
- Hash computation and duplicate detection
- Vendor lookup table (seeded) and detection logic
- New import dialog with source metadata + candidate list
- Background queue and progress (carry forward from current build)

**Phase 2: Library entries replace current single-tier model**
- Library entry layout (`userData/soundFonts/library/<entryName>/`)
- Entry meta.json schema and writer
- Candidate extraction from source into entry
- Card grid displays entries (not raw fonts as today)
- Migration path from the current single-tier `<name>/` folders is needed (likely: detect old layout on startup, surface "rebuild library from sources" prompt, or auto-migrate by treating each old folder as a folder-format source and creating one entry from it)

**Phase 3: Source-aware browse UI in entry detail view**
- Entry detail view (basic) with metadata form + entry file list (from current spec)
- Browse Source panel showing the source's tree
- Provenance display (`addedFromSource` mapping)

**Phase 4: Curation operations and audio preview**
- Audio preview via HTML5 `<audio>` (both for entry files and source files)
- Add as track / quote / alt operations with auto-placement
- Quote renumbering
- Conventional folder handling (`tracks/`, `quote/`)

**Phase 5: SD card transport** *(unchanged from the original spec)*
- Reader path (mounted drive)
- USB mass storage path (`sd 1` / `sd 0` with safe-eject)
- Three deployment modes (whole library, selected entries, auto-match to open config)

**Phase 6: Bulk legacy import** *(deferred scope, separate slice)*
- Top-folder picker
- Recursive candidate discovery
- Review modal with many candidates, vendor pattern matching, skip-if-already-imported
- Pushes through the same queue as primary path

## Open questions

These need to be settled before Phase 1 code lands.

### Q1: Duplicate handling UX

When the user picks a zip whose hash matches an existing source, what happens?

Options:
- (a) Skip silently (default), show a passing notification
- (b) Surface a modal with three actions: Skip / Open existing source's entries / Re-import as a new source (forces a new UUID)
- (c) Always treat as new (no dedup), surface only a passive "you already have this" hint

**Cody's lean:** (b). The user might be importing intentionally (e.g. they forgot they already had it, or they want a second copy for any reason). Three actions gives them control without forcing a flow.

### Q2: Multiple font candidates inside one source

Emperor zip has 4-5 distinct fonts inside. How does the candidate selection work at import time?

Options:
- (a) Auto-create entries for all detected candidates
- (b) Show the candidate list and let the user select which to create entries for (default: all checked)
- (c) Create one default entry (e.g. the most likely "main" font), offer to create more from the source's Browse UI later

**Cody's lean:** (b). The user is making the curation decision at the moment they have the most context. (a) creates clutter for fonts they don't want. (c) hides the multi-font reality.

### Q3: Vendor unknown fallback flow

When the lookup table doesn't match anything in the source, how do we prompt for vendor?

Options:
- (a) Empty text field, user types vendor name (or leaves blank)
- (b) Text field with autocomplete from the lookup table (so they get suggestions for known vendors they're typing)
- (c) Same as (b), plus "this is a new vendor" affordance that prompts for website and adds to the lookup table for future imports

**Cody's lean:** (c). Builds the lookup table organically. Low marginal effort per user since they're typing anyway.

## Known limitations

- **Cross-format duplicate detection.** A font imported once as a folder and again as a zip won't be flagged as a duplicate (different stored bytes, different hashes). Accepted v1 constraint per 2026-06-07. May revisit if user reports show it matters.
- **Vendor detection coverage** is bounded by the seed list. Vendors not in the lookup table require user-entered metadata. The lookup grows over time as users contribute new entries.
- **JayDaloRian-style partial signatures.** A vendor whose READMEs only appear in some sub-fonts will be auto-detected for those and require manual entry for the rest. The user can mark "same as the others" in the import flow, but we don't auto-propagate.
- **Embedded zip board flavors (Greyscale Free pattern).** Zips inside zips, with the inner ones being per-board content. Phase 1 imports the outer source as-is; the user has to extract the inner Proffie.zip manually before creating a library entry from that branch. Phase 2+ may add native nested-zip extraction.

## What carries forward from the current v1 build

The existing v1 implementation (framework slice + import slice + background queue) doesn't get thrown away. Reusable infrastructure:

- **IPC framework** (preload bridge, main handlers structure)
- **Background queue + progress reporting** (the entire `_sfImportQueue` system, queue limit, serial execution, per-card progress)
- **Tab framework** (tab placement, switching, toolbar containers)
- **Settings toggle** (the entire `soundFontsTabEnabled` mechanism)
- **Empty state pattern** (the three-layer view switch logic)
- **Card grid component** (basic card rendering, search filter, alphabetical sort)
- **Audio preview infrastructure** (not yet built but planned for the v1 detail view)
- **Modal scaffolding and styling**

## What gets replaced

- **Storage layout.** Single-tier `userData/soundFonts/<name>/` becomes two-tier `sources/<uuid>/` + `library/<entryName>/`. Migration required for the small number of fonts already imported during v1 development.
- **Import modal.** Current form (name, author, purchased, date, description) becomes source metadata + candidate list. The current per-font metadata moves to the entry layer.
- **`scanSoundFontFolder` IPC.** Becomes a richer `scanSourceCandidates` that returns multiple candidates with hierarchical names.
- **`importSoundFont` IPC.** Splits into `importSource` (writes source storage) and `createEntryFromCandidate` (extracts a specific candidate into a library entry).
- **Card grid contents.** Cards represent entries (not raw fonts as today). Source provenance shown on the card.

## Migration note for existing in-development fonts

The current `userData/soundFonts/<name>/` folders (created during v1 development) need to be migrated to the new model. Two viable paths:

1. **Auto-migrate on startup.** Each existing folder is treated as a folder-format source (new UUID, hash computed from the folder contents). A library entry is created with the same name, referencing that source. Existing meta.json (`name`, `author`, etc.) maps cleanly to the new entry meta + source meta split.
2. **Prompt the user.** On first launch after Phase 1 lands, show a one-time migration dialog listing the affected folders and asking the user to confirm.

Auto-migration is friendlier. Prompt is safer. Pick at Phase 1 implementation time.

## Superseded v1 design (kept for historical reference)

The prior `docs/specs/font-library.md` design (committed 2026-06-06, multiple revisions through 2026-06-07) was a single-tier model: pick a folder, copy its Proffie content into `userData/soundFonts/<name>/`, treat that as the font. It worked for the simple case of one font per folder with optional board-flavor siblings.

The v1 design accumulated incremental fixes for vendor variations: multi-version detection (Proffie subfolder auto-detection), contains-proffie matching for names like `Vader-Proffie/`, alt-folder structure recognition for fonts that use the `alt000` convention. The background import queue with serial execution and per-card progress was added to address the apparent-freeze UX of synchronous large-file copies.

What broke the v1 model: real-world purchase structures are far more varied than the spec assumed. Bundles contain multiple distinct fonts (Emperor has 4-5). Vendor delivery is zip-native, not folder-native. Users want their archive preserved (zip + all board flavors + extras + READMEs), not just the Proffie content. Curation (cherry-picking tracks, quotes, alts from the source) is a real workflow that the single-tier model has no place for. The source-and-entry split addresses all of these by separating "what I bought" (archive) from "what I'm using" (library), and adding a curation flow that connects them.

The git history preserves the prior `font-library.md` content at commits before this rewrite (latest: a1ce9ed adding the bulk crawl as a future iteration). This section is the audit trail of "why we changed direction."
