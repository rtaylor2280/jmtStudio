# JMT Studio v1.8.0 — QA Record

**Version:** 1.8.0
**Tester:** Ryan Taylor
**Date:** 2026-11-21 (release QA 2026-11-14 to 2026-11-21)
**Platform / OS:** Windows 11 Pro, macOS 26 (arm64), Ubuntu 26.04 LTS (.deb)
**Build type:** Signed release candidates QA01 to QA17; the release is built from QA17 (7e5632d)

Mark each test: ✅ Pass · ❌ Fail · ⏭ Skip (note reason)
Log failures in the **Bug Log** at the bottom with TC reference.

## Release QA

Every case below was tested on 1.8.0. The release itself was checked on all three platforms in a launch
pass, a risk-based run of the whole app from install to export, with every find fixed and the fix
retested before the next build.

| Platform | Machine | Pass | Builds | Result |
|----------|---------|------|--------|--------|
| Windows 11 Pro | Laptop; fresh standard users Shiny Echo and Old Wolffe | Windows launch pass | QA01 to QA11 | Passed; finds BUG-006 to BUG-039 below |
| macOS 26 (arm64) | Mac mini | Mac launch pass (M1 to M31) | QA09 to QA11 | Passed; finds M13, M20, M21, M24, M28, M31 fixed (section 494) |
| Ubuntu 26.04 LTS | Yoga, .deb | Linux launch pass (L1 to L36) | QA12 to QA17 | 35 passed, L6 skipped (the AppImage does not start on Ubuntu 26.04, as in 1.7.2; B-711 for 1.8.1); finds fixed in section 496 |

**Release candidate QA17 (commit 7e5632d), 2026-11-21:** installed and checked on Windows, macOS and
Linux. Signed on Windows; signed, notarized and stapled on macOS. Every QA build was recorded with its
commit and SHA-256.

**Cancelled cases:** TC-3175 to TC-3177, TC-3236, TC-4795 to TC-4798 and TC-4955 to TC-4960 test
behaviour that later work replaced, and are marked not to be run. TC-3561 and TC-3723 record known
behaviour and are not tests.

## 65. KEYBOARD SHORTCUT ADDITIONS

### 65.1 Cmd+O / Ctrl+O — Open from config tab
- [x] TC-1245: On the Config Manager tab with no file open, press Ctrl+O (Windows/Linux) → file picker opens; cancel returns to the empty state cleanly ✅
- [x] TC-1246: On the Config Manager tab with a config file open and focus NOT inside Monaco (e.g. focus on the preset sidecar or toolbar), press Ctrl+O → file picker opens ✅
- [x] TC-1247: On the Config Manager tab with a config file open and focus INSIDE the Monaco editor (the common case after opening any config), press Ctrl+O → file picker opens.
- [x] TC-1248: With unsaved changes in the open config, press Ctrl+O → unsaved-changes guard fires (Save / Discard / Cancel modal); Save → save then open picker; Discard → open picker; Cancel → no file picker, current config unchanged
- [x] TC-1249: On a non-config tab (Style Library, OS Versions, future Font Library), press Ctrl+O → no action; handler is scoped to `_activeTab === 'config'` and silently skips elsewhere
- [x] TC-1250: Click in the recent files dropdown or the filename field so focus leaves Monaco, then press Ctrl+O → file picker still opens (handler is unconditional on focus location, only checks active tab)
- [x] TC-1251: macOS — Cmd+O opens the file picker with the same semantics as Windows Ctrl+O ✅

## 66. SOUND FONT LIBRARY

### 66.1 Tab placement and empty state

### 66.2 Import flow — single Proffie folder

### 66.3 Import flow — validation

### 66.4 Import flow — name uniqueness

### 66.5 Library browse view

### 66.6 Font detail view — metadata form

### 66.7 Font detail view — file list

### 66.8 In-app audio playback

### 66.9 SD card transport — reader path

### 66.10 SD card transport — USB mass storage path

### ⛔ NOT IN 1.8 — DEFERRED. Do not test; do not go looking for it.

### 66.11 Deployment modes

### 66.12 Visual styles editor integration

## 67. STYLE LIBRARY — DYNAMIC FACETED TAG FILTER

### 67.1 Dropdown open / close
- [x] TC-1252: Click "Tags" button → dropdown opens below the button showing tag list
- [x] TC-1253: Click "Tags" button again while open → dropdown closes
- [x] TC-1254: Click outside the dropdown (any blank area, another card, the search input) → dropdown closes
- [x] TC-1255: Click a tag row in the dropdown → tag toggles in active set AND dropdown auto-closes (single-pick mental model; re-open to pick another).
- [x] TC-1256: Switch tabs while dropdown is open → dropdown closes via outside-click handler

### 67.2 Empty / edge cases
- [x] TC-1257: Library with no tagged styles → "Tags" button still visible; opening dropdown shows "No tags available" empty-state message
- [x] TC-1258: Library with cards but no user tags at all → dropdown shows "No tags available"
- [x] TC-1259: Active filter referencing a tag that no longer exists (e.g. user deleted all cards with that tag) → chip strip still shows it; results filter to zero; user can click × to remove and restore broader results

### 67.3 Tag selection via dropdown
- [x] TC-1260: Click an unselected tag row in dropdown → tag added to active set; chip appears in active-filters strip; results re-filter; dropdown rebuilds with updated counts and ordering
- [x] TC-1261: Click a currently-selected tag row (marked with checkmark) → tag removed from active set; chip disappears; dropdown re-renders
- [x] TC-1262: Dropdown rows sort: selected tags first, then by count descending, then alphabetical within same count
- [x] TC-1263: Each tag row shows tag name + `(N)` count where N is cards matching if added (or for selected tags, cards currently matching)
- [x] TC-1264: After narrowing via search or another tag, dropdown rebuilds — tags that would yield zero results no longer appear

### 67.4 Tag selection via card chip click
- [x] TC-1265: Click a tag chip on any card → tag added to active set (or removed if already selected); chip strip updates
- [x] TC-1266: Card-chip click and dropdown selection produce identical state (verify by alternating between the two interactions on the same tag)
- [x] TC-1267: All tag chips across all cards reflect active state (highlighted blue background) for tags in the active filter set

### 67.5 Active-filter chip strip
- [x] TC-1268: No active filters → chip strip is hidden (`display:none`); no visual footprint between search bar and cards
- [x] TC-1269: One or more active filters → chip strip visible with "Filtering by:" label followed by one chip per active tag
- [x] TC-1270: Each chip has × button → click removes that tag from active set, re-filters, re-renders dropdown if open
- [x] TC-1271: Any active filter, even a single one → "Clear all" link appears at the end of the chip strip (Style Library and Sound Fonts alike); click clears all active filters at once.

### 67.6 Filter composition (intersection semantics)
- [x] TC-1272: Search text "lightning" + tag filter "trans" → only cards matching BOTH show (intersection, not union)
- [x] TC-1273: Three selected tags → only cards with ALL three tags show
- [x] TC-1274: Typing in search box → tag filters remain active (search and tags are independent dimensions; regression from prior single-tag behavior where search cleared tags)
- [x] TC-1275: Clicking search clear (×) → search clears, tag filters remain active
- [x] TC-1276: Result count display ("N of M styles") reflects the intersection result

### 67.7 Badge on Tags button
- [x] TC-1277: No active filters → badge hidden
- [x] TC-1278: One or more active filters → badge visible showing count; "Tags" button shows blue accent (`has-active` class) to signal active state
- [x] TC-1279: Badge count updates live as tags are added/removed

### 67.8 Visual rebuild persistence
- [x] TC-1280: Active tag filters survive a card rebuild (e.g. saving a style triggers `_buildStylesVisual`); the active set is module-state, not DOM-state, so filters re-apply automatically after rebuild
- [x] TC-1281: Card tag chips render with `active` class for tags in the active set after rebuild (cosmetic continuity)

### 67.9 Cross-session persistence
- [x] TC-1282: Active tag filters do NOT persist across app restart (intentional — spec was "optional" for v1, not implemented); fresh launch shows no active filters

## 68. STYLE LIBRARY — EFFECT FILTER (mirror of tag filter, amber accent)

### 68.1 Dropdown open / close
- [x] TC-1283: Click "Effects" button → effect dropdown opens below the button showing effect list
- [x] TC-1284: Click "Effects" button again while open → dropdown closes
- [x] TC-1285: Click outside the dropdown → dropdown closes via outside-click handler
- [x] TC-1286: Click an effect row in the dropdown → effect toggles in active set AND dropdown auto-closes (same single-pick model as tags)
- [x] TC-1287: Open Tags dropdown, then click Effects button → Tags dropdown closes, Effects dropdown opens (only one facet dropdown open at a time via outside-click handler)

### 68.2 Empty / edge cases
- [x] TC-1288: Style with no parseable effects → "Effects" button visible; opening dropdown shows "No effects available"
- [x] TC-1289: Active effect filter referencing an effect that no longer exists on any card (rare — usually means file edits removed all references) → chip strip still shows it; results filter to zero; × removes and broadens

### 68.3 Effect selection via dropdown
- [x] TC-1290: Click unselected effect row → effect added to active set, amber chip appears in active-filter strip, results re-filter
- [x] TC-1291: Click selected effect row → effect removed from active set, chip disappears, results widen
- [x] TC-1292: Dropdown rows sort: selected first, then count desc, then alpha (same as tags)
- [x] TC-1293: Each row shows effect name + `(N)` count
- [x] TC-1294: Narrowing via search, selected tags, or other selected effects rebuilds dropdown to only show effects still present in current visible set

### 68.4 Effect selection via card chip click
- [x] TC-1295: Click an effect chip on any card → effect added to active set (or removed if already selected); strip and dropdown (if open) update
- [x] TC-1296: Card-chip click and dropdown selection produce identical state
- [x] TC-1297: All effect chips across all cards reflect active state (amber background, full opacity) for effects in the active set; non-active effect chips retain existing muted styling (0.7 opacity)

### 68.5 Active-filter chip strip (combined with tags)
- [x] TC-1298: One tag + one effect active → strip shows both chip types side by side; tag chips blue, effect chips amber, visually distinct at a glance
- [x] TC-1299: Each effect chip in the strip has its own × button → click removes that effect from active set
- [x] TC-1300: "Clear all" link appears when total active filters (tags + effects) ≥ 2; clicking it clears BOTH sets at once
- [x] TC-1301: All filters cleared → strip hides; "Filtering by:" label disappears

### 68.6 Filter composition across all three dimensions
- [x] TC-1302: Search "flame" + tag "fire" + effect "EFFECT_BLAST" → only cards matching ALL THREE show (full intersection)
- [x] TC-1303: Two tags + two effects → only cards with ALL FOUR present show
- [x] TC-1304: Selecting an effect narrows the Tags dropdown's available list and counts; selecting a tag narrows the Effects dropdown's available list and counts
- [x] TC-1305: Clearing search via × leaves both tag and effect filters active (regression check across all three dimensions)

### 68.7 Badge on Effects button
- [x] TC-1306: No active effect filters → effect badge hidden
- [x] TC-1307: One or more active effect filters → badge visible showing count; Effects button shows amber accent (`has-active` class)
- [x] TC-1308: Tag badge and Effect badge update independently as their respective filter sets change

### 68.8 Visual rebuild persistence
- [x] TC-1309: Active effect filters survive a card rebuild (saving a style triggers `_buildStylesVisual`); active set is module-state, filters re-apply automatically
- [x] TC-1310: Effect chips render with `active` class for effects in the active set after rebuild (cosmetic continuity)

### 68.9 Cross-session persistence
- [x] TC-1311: Active effect filters do NOT persist across app restart (intentional; same as tags); fresh launch shows no active filters

## 69. FIRST-LAUNCH BUILD OUTPUT SPLASH FIX (regression coverage)

### 69.1 Happy path — fresh-install first launch (toolchain not installed)
- [x] TC-1312: With no toolchain installed (delete `arduino-data` from userData or use a fresh machine), launch the app → splash window appears centered → during the splash period (~1.9 sec), the build output panel does NOT grab…
- [x] TC-1313: After splash fully dismisses on the same launch → build output panel opens automatically (toolchain-setup IPC was queued and released by the splash-dismissed signal).
- [x] TC-1314: After toolchain install completes → setup notice hides, status pill shows green/ok, port/compile/flash secondary indicators reappear (existing toolchain-ready behavior preserved).

### 69.2 Happy path — subsequent launches (toolchain already installed)
- [x] TC-1315: Launch with toolchain already installed → no toolchain-setup IPC fires → build output panel stays closed (no auto-open).
- [x] TC-1316: Same scenario, watch closely during splash → no layout glitch of any kind.

### 69.3 Other openLog callsites unchanged (regression)
- [x] TC-1317: Click Compile, wait for failure (e.g. introduce a syntax error in the open config) → build output panel opens immediately on the fail to show the error.
- [x] TC-1318: Trigger a flash failure → build output panel opens immediately on the fail.
- [x] TC-1319: Click the bp-log-toggle button to manually expand/collapse the panel → works as before; `toggleLog` is unaffected by the new defer logic.

### 69.4 Race-safety — signal-vs-query reconciliation
- [x] TC-1320: Simulate slow renderer init: open DevTools, hard-reload while toolchain-setup is pending → `initBuildPanel()` runs after splash already destroyed.
- [x] TC-1321: Listener-only path: if the splash-dismissed signal fires while the renderer's listener is registered (normal case), local flag flips to true and any queued open releases.
- [x] TC-1322: `markDismissed` in main.js is idempotent (early-return on already-dismissed).

### 69.5 Renderer reload — main process state preserved
- [x] TC-1323: After full app launch (splash done, panel state correct), force a renderer reload via DevTools → `initBuildPanel()` re-runs → `isSplashDismissed()` query returns true (main's `_splashDismissed` is preserved across…
- [x] TC-1324: After renderer reload, trigger a compile failure → panel opens immediately.

### 69.6 Edge cases
- [x] TC-1325: Splash externally destroyed (e.g. some Electron internal kills the splash window before the fade timer fires) → outer `setTimeout` sees `splash.isDestroyed()` is true on entry, calls `markDismissed()`, signal emits,…
- [x] TC-1326: Window closed during splash (user hits the close button during the ~1.9s splash window) → main process already in shutdown; renderer state irrelevant.

## 70. SOUND FONTS TAB — FRAMEWORK SLICE

### 70.1 Default tab presence
- [x] TC-1327: Fresh app install (no setting persisted yet) → Sound Fonts tab is visible in the tab strip, placed between Style Library and OS Versions
- [x] TC-1328: Clicking the Sound Fonts tab activates it: toolbar shows the empty `tab-btns-soundfonts` group (no buttons in this slice), view area shows layer-1 empty state
- [x] TC-1329: Switching away to Config Manager → Sound Fonts view hides, config view restored

### 70.2 Layer 1 — library not yet created
- [x] TC-1330: On fresh install, the active view shows: "No Sound Fonts Library yet" headline, one-sentence description, single primary button "Set Up Sound Fonts Library"
- [x] TC-1331: Layout is centered, single-card, no clutter; matches the visual register of other empty states in the app
- [x] TC-1332: Click "Set Up Sound Fonts Library" → main creates `userData/soundFonts/` directory and `_jmt_library_meta.json` file inside; view swaps to layer 2 immediately (no reload)
- [x] TC-1333: Verify on disk after click: directory exists; meta file contains `createdAt` (ISO date string) and `schemaVersion: 1`

### 70.3 Layer 2 — library exists, no fonts
- [x] TC-1334: After layer 1 button click, layer-2 empty state shows: "Import your first sound font" headline, description, "Import Sound Font" button (currently disabled with tooltip "Import flow coming soon"), and a hint…
- [x] TC-1335: Switch tabs away and back → layer 2 still shown (library still exists; this is the correct state)
- [x] TC-1336: Future regression note (for the next slice that adds import): clicking the Import button should kick off the import flow once it's built.

### 70.4 Settings toggle — default and behavior
- [x] TC-1337: Settings modal shows a row labeled "Show Sound Fonts tab" with a toggle, default position ON
- [x] TC-1338: With library not created (fresh install state) → toggle is interactive (not disabled).
- [x] TC-1339: With library created but empty (layer 2 state) → toggle is interactive.
- [x] TC-1340: Toggle off → Sound Fonts tab disappears from the strip immediately.
- [x] TC-1341: With tab disabled, restart app → tab stays disabled.
- [x] TC-1342: Toggle back on → tab reappears in its placement between Style Library and OS Versions
- [x] TC-1343: Disabling the tab while it's the active tab → app switches the active tab to Config Manager (no orphaned active-tab where the tab itself is invisible)

### 70.5 Settings toggle — locked when fonts present
- [x] TC-1344: With library having at least one font (manually drop a folder into `userData/soundFonts/` to simulate, since the import flow isn't built) → toggle is disabled and the "(remove all sound fonts to disable)" hint is visible
- [x] TC-1345: Click the locked toggle → no state change.
- [x] TC-1346: Remove the simulated font folder, reopen Settings → toggle becomes interactive again, hint hidden
- [x] TC-1347: Edge: programmatically uncheck the locked toggle (e.g. devtools `el.checked = false`) → on next change event, the bounce-back logic re-checks it.

### 70.6 IPC surface
- [x] TC-1348: `window.electronAPI.soundFontsExists()` → returns `false` on fresh install, `true` after Set Up button click
- [x] TC-1349: `window.electronAPI.createSoundFonts()` → idempotent.
- [x] TC-1350: `window.electronAPI.listSoundFonts()` → returns `[]` when library doesn't exist; `[]` when library exists but empty; `['fontA', 'fontB']` when folders are present at the root

### 70.7 Disk source-of-truth derivation
- [x] TC-1351: Library state is derived from disk on every view refresh (not cached).
- [x] TC-1352: Manually delete `_jmt_library_meta.json` from disk → next view refresh shows layer-1 ("not yet created") even if font folders are still present underneath.

### 70.8 Future-slice scaffolding (verify NOT present yet)
- [x] TC-1353: Import flow is NOT built yet → no native file picker fires from the "Import Sound Font" button (it's disabled)
- [x] TC-1354: Detail view is NOT built yet → there are no font cards to click into
- [x] TC-1355: Audio playback is NOT built yet → no `.wav` plays from anywhere in this slice
- [x] TC-1356: SD transport is NOT built yet → no Cloudflare-Pages-style "push to saber" affordances exist

## 71. SOUND FONTS — IMPORT FLOW

### 71.1 Entry points to the import modal
- [x] TC-1357: With library created but empty (layer 2 state), the "Import Sound Font" button on the empty-state card is enabled.
- [x] TC-1358: With at least one font imported (layer 3 state), the "+ Import Sound Font" button is visible in the toolbar (only when on the Sound Fonts tab).
- [x] TC-1359: The toolbar button is hidden when no library exists (layer 1) and when on any tab other than Sound Fonts.

### 71.2 Folder pick + scan — single Proffie-only folder
- [x] TC-1360: Click "Browse..." → native folder picker opens.
- [x] TC-1361: Name field pre-fills with the basename of the picked folder (when name was empty).

### 71.3 Folder pick + scan — multi-version vendor folder
- [x] TC-1362: Pick a vendor folder that contains a `Proffie/` subfolder (alongside `Xeno/`, `CrystalFocus/`, etc.) → scan info shows `Detected Proffie subfolder — importing from there.
- [x] TC-1363: The actual source path used for the import is the inner `Proffie/` subfolder, not the picked outer folder.
- [x] TC-1364: Suggested name is the OUTER folder's basename (e.g. picking `Vader/` with `Vader/Proffie/` inside → suggested name is `Vader`, not `Proffie`).
- [x] TC-1365: User drilled into `Proffie/` before picking (i.e. picked `.../Vader/Proffie/`) → scan does NOT add the detection notice (the folder IS the Proffie folder); suggested name is derived from the parent (`Vader`).
- [x] TC-1365a: User picks a folder whose basename CONTAINS "proffie" but is not exactly "proffie" (e.g. `Vader-Proffie/`, `Proffie-V1/`, `MyFont_Proffie/`) → suggested name comes from the parent folder's basename, not the…
- [x] TC-1365b: Edge — user picks `Vader-Proffie/` which contains a `Proffie/` subfolder inside it (rare but possible).

### 71.4 Validation — folder content
- [x] TC-1366: Pick a folder that exists but contains no `.wav` files at any depth → scan info shows `No .wav files found in this folder.` in red.
- [x] TC-1367: Pick a folder that doesn't exist (e.g. deleted between pick and scan) → scan info shows `Folder does not exist` in red.
- [x] TC-1368: Pick a folder containing only `.wav` files at deeply nested paths (e.g. `font/swings/clash01.wav`) → scan recursively counts them all.
- [x] TC-1368a: Pick a folder containing alt folders (e.g. `alt000/`, `alt001/`, `alt002/`) where each alt folder contains .wav files → scan info reads `Found N .wav files across X alt folders.` (combined phrasing).
- [x] TC-1368b: Edge: a folder with alt folders but no .wav files anywhere: validation still passes

### 71.5 Validation — name field
- [x] TC-1369: Empty name → "Name is required" error visible, import button disabled
- [x] TC-1370: Name with disallowed characters (e.g. `My/Font` or `Vader!`) → error "Use letters, numbers, spaces, underscore, or hyphen".
- [x] TC-1371: Name matching an existing font (case-insensitive) → error "A font with that name already exists".
- [x] TC-1372: Valid unique name + valid folder content → import button enabled.

### 71.6 Successful import
- [x] TC-1373: Fill name (e.g. "TestFont"), author, leave defaults for other fields, click Import → button text shows "Importing..." briefly, modal closes on success, browse view shows the new card.
- [x] TC-1374: On disk: verify `userData/soundFonts/TestFont/` exists with the copied .wav files inside, and `userData/soundFonts/TestFont/_jmt_font_meta.json` contains the metadata (schemaVersion: 1, name, author, purchased,…
- [x] TC-1375: Acquisition date defaults to today's date in YYYY-MM-DD format
- [x] TC-1376: Purchased checkbox unchecked by default; check it before import → metadata records `purchased: true`.
- [x] TC-1377: Description (multi-line text) is captured and persisted in metadata.

### 71.7 Re-import safety
- [x] TC-1378: Re-import the same source folder under a different name → both fonts exist in the library, each with its own folder and metadata.
- [x] TC-1379: When copying, any existing `_jmt_font_meta.json` in the source is filtered out of the copy (re-import of a previously-imported folder does not carry the prior identity).
- [x] TC-1380: Attempting to import with a name that matches an existing folder on disk (e.g. by manually creating a folder and trying to import to that name) → backend refuses with "A font with that name already exists" error.

### 71.8 Modal interactions
- [x] TC-1381: Cancel button closes modal without importing.
- [x] TC-1382: Cancel button is DISABLED during import (along with Browse and all form fields) so the user cannot trigger a partial-cleanup race.
- [x] TC-1383: On failed import (e.g. simulate by removing write permissions on userData/soundFonts/), the error surfaces via the styled `Import failed` modal (promptError, JMT-blue OK button, no OS chrome).

### 71.8a Background import queue (replaces the original "appears frozen" UX)
- [x] TC-1383a: Click Import on a small font (a few MB) → modal closes immediately.
- [x] TC-1383b: Click Import on a large font (200MB+ if available) → main process is NOT blocked.
- [x] TC-1383c: Pending card status text shows current state — `Queued` while waiting, `Preparing...` during enumeration, `Copying… X/Y · Z%` during the file-by-file copy, `Finishing up...` while the metadata file is written.
- [x] TC-1383d: Pending card includes the configured author in its preview when supplied; no description preview (description shows only on the real card once it lands).
- [x] TC-1383e: After successful background import, pending card disappears, real disk-backed card replaces it in the grid.
- [x] TC-1383f: If a background import errors mid-copy (simulate via removing the destination during the copy or revoking permissions), the partial dest is cleaned up in main.

### 71.8b Queue serialization and limit
- [x] TC-1383g: Open the import modal, queue Font A.
- [x] TC-1383h: Queue 5 imports in a row.
- [x] TC-1383i: Try to queue a font whose name matches one currently in the queue (not yet on disk) → name validation error reads `A font with that name is already queued for import`.
- [x] TC-1383j: Try to queue a font whose name matches a real disk font → name validation error reads `A font with that name already exists` (unchanged from TC-1371).
- [x] TC-1383k: Background imports continue running while the user is on a different tab (Config Manager, Style Library, OS Versions).
- [x] TC-1383l: Closing the Cancel button on the modal during a fresh open (no items queued) → queue-full hint is hidden, modal closes cleanly.

### 71.9 Browse view — card grid
- [x] TC-1384: With one font imported → grid shows one card with the font name.
- [x] TC-1385: With multiple fonts → cards sort alphabetically by name (case-sensitive locale compare).
- [x] TC-1386: Each card shows: name (bold), author (if present, prefixed "by"), description (clamped to 2 lines), purchased tag (if applicable).
- [x] TC-1387: Grid responsively reflows to fill the available width (CSS `auto-fill` grid).
- [x] TC-1388: Search count display: empty search → "N fonts"; with search query that matches some → "M of N"; matches none → "0 of N".

### 71.10 Browse view — search
- [x] TC-1389: Type a substring of a font name → only matching cards remain visible.
- [x] TC-1390: Search also matches the author and description fields (case-insensitive).
- [x] TC-1391: Clear the search box → all cards reappear.
- [x] TC-1392: Search does NOT clear when the user navigates away and back to the Sound Fonts tab (acceptable v1 behavior; can be reset on tab leave in a future polish slice).

### 71.11 View-state transitions
- [x] TC-1393: Start with no library → layer 1 (no-library).
- [x] TC-1394: From layer 2, import the first font → switch to layer 3 (browse grid), the empty-state card disappears.
- [x] TC-1395: Future (not part of this slice): deleting the last font should swap back to layer 2.

### 71.12 Settings toggle lock — now triggered for real
- [x] TC-1396: With 1+ fonts imported, open Settings → "Show Sound Fonts tab" toggle is now disabled with the "(remove all sound fonts to disable)" hint visible.
- [x] TC-1397: TC-1344 (manual font folder drop) and TC-1396 are equivalent in behavior; verify they produce the same lock state.

## 72. ERROR MODAL CONSISTENCY (alert → promptError sweep)

### 72.0 Universal acceptance criteria

### 72.1 Compare + Config Save
- [x] TC-1398: With a stale recent-files entry pointing at a path that no longer exists, click that entry in the Compare flow.
- [x] TC-1399: With a config file open whose on-disk file is read-only (set the file `chmod -w` on Mac/Linux, or Properties → Read-only on Windows), press Ctrl+S.
- [x] TC-1400: With a `.txt`-suffixed file open whose target `.h` path collides with an existing read-only file, press Ctrl+S.

### 72.2 Bulk import flow
- [x] TC-1401: Click "Bulk import from a folder", cancel the OS folder picker.
- [x] TC-1402: Pick a folder you cannot read (e.g. permission denied).
- [x] TC-1403: With backend forced to fail the scan phase (e.g. introduce a transient throw via DevTools), trigger the bulk import.
- [x] TC-1404: Force the run phase to fail (e.g. mid-stream backend error).

### 72.3 Style Library save guards + validation
- [x] TC-1405: In Code view (Save lives there now [B-574]), edit two styles to share the same `using` name.
- [x] TC-1406: In Code view, introduce a template-name conflict (same template name reused, different code).
- [x] TC-1407: Open a helper editor, corrupt the body (delete a closing brace), click Save.
- [x] TC-1408: Rename a helper to a name that doesn't exist in the file, click Save.
- [x] TC-1409: Open style detail, corrupt the `using` body, click Save.
- [x] TC-1410: Click Condense All when at least one style is structurally corrupted.
- [x] TC-1411: Click Expand All when condensation would produce a corrupt intermediate.

### 72.4 Common folder management (largest cluster)
- [x] TC-1412: Import a common folder, give it the name of an existing common, click Save in the rename prompt.
- [x] TC-1413: Click Common → Import, cancel the OS picker.
- [x] TC-1414: Trigger backend import failure (e.g. select a zip file with no read permissions).
- [x] TC-1415: Multi-select two commons, right-click → Group, give a name.
- [x] TC-1416: Right-click a grouped common → Remove from group, force failure.
- [x] TC-1417: Multi-select commons, apply to existing group via context menu, force failure.
- [x] TC-1418: Right-click a group header → Rename group, supply a new name, force failure.
- [x] TC-1419: Right-click a group header → Delete group, confirm, force failure.
- [x] TC-1420: Right-click a common → Duplicate, force failure.
- [x] TC-1421: Right-click a common → Delete, confirm, force failure.
- [x] TC-1422: Right-click a common → Export…, cancel picker (silent), then run with a read-only destination.
- [x] TC-1423: Inside a common, click + Add Files, cancel picker (silent).
- [x] TC-1424: Right-click a file in a common → Delete (single).
- [x] TC-1425: Multi-select files in a common, paste from another common's clipboard, force partial backend failure.
- [x] TC-1426: Paste from a non-common clipboard (entry or source kind) into a common, force a partial failure.
- [x] TC-1427: Drag-move files within a single common into a different subfolder, force partial backend failure.
- [x] TC-1428: Click +Folder inside a common, supply an invalid name (e.g. `..`).
- [x] TC-1429: Bulk-delete selected files in a common, force partial failure.

### 72.5 Shared Tracks
- [x] TC-1430: Open Shared Tracks, click +Add → Browse, pick a folder with unsupported file types (e.g. drag in a `.mp3`).
- [x] TC-1431: Trigger a top-level add-failure (e.g. revoke write perms mid-flow).
- [x] TC-1432: Paste files from clipboard into Shared Tracks, force top-level failure.
- [x] TC-1433: Same paste with a partial backend failure (some succeed, some fail).
- [x] TC-1434: Throw inside the IPC handler during paste.
- [x] TC-1435: Bulk-delete tracks where at least one fails.
- [x] TC-1436: Click "Create Shared Tracks folder" toolbar button when the folder already exists or permission is denied.
- [x] TC-1437: Right-click Shared Tracks card → Delete, confirm, force backend failure.

### 72.6 Single-source import + entry creation phase
- [x] TC-1438: Force the single-source `importSource` IPC to fail mid-stream.
- [x] TC-1439: During the entry-creation phase of an import, force one or more entries to fail their write.

### 72.7 Entry/source detail Save + edits
- [x] TC-1440: Open an entry detail, click into the name field, clear it, click ✓.
- [x] TC-1441: Open an entry detail, edit metadata, force `updateEntryMeta` to fail.
- [x] TC-1442: Open a source detail, edit fields, force `updateSourceMeta` to fail.
- [x] TC-1443: In source detail, change tags such that the bulk-cascade to entries has at least one failure.
- [x] TC-1444: In source detail, edit per-row entry names/descriptions such that at least one entry-edit fails.
- [x] TC-1445: In source detail, right-click an entry row → Duplicate, force failure.
- [x] TC-1446: Same row, right-click → Duplicate from source, force failure.
- [x] TC-1447: In source detail, click Export source, cancel picker (silent), then force backend failure.
- [x] TC-1448: In source detail, click Delete source (cascade), force at least one failure in the cascade.

### 72.8 Entry/source file operations
- [x] TC-1449: Paste files into an entry's file tree, force backend top-level failure.
- [x] TC-1450: Same paste with partial failures.
- [x] TC-1451: Multi-select files in entry, click Delete, force top-level failure.
- [x] TC-1452: Same multi-delete with partial failures.
- [x] TC-1453: Right-click a folder in entry tree → Delete, force backend failure.
- [x] TC-1454: Click +Folder in entry tree, supply an invalid name.
- [x] TC-1455: Click "Renumber current folder", force backend failure.
- [x] TC-1456: Click +Add inside entry, cancel picker (silent), then force partial failure on the file copy.
- [x] TC-1457: From the Library Picker "Add from library" flow, drop files into a destination with partial backend failure.
- [x] TC-1458: Drag-move files within an entry tree, force partial backend failure.

### 72.9 Bulk Export + Bulk Delete
- [x] TC-1459: Bulk Export from the SF grid, cancel folder picker (silent return).
- [x] TC-1460: Bulk Export with at least one per-source failure (e.g. revoke write perms on the dest before clicking).
- [x] TC-1461: Bulk Delete with "Export sources first" checked, force one of the export-to-Downloads steps to fail.
- [x] TC-1462: Bulk Delete where the export succeeded and some entry/source deletes fail.

### 72.10 Doc viewer (across kinds)
- [x] TC-1463: In an entry's file browser, click a readable text file (`.txt`, `.md`, `.rtf`).
- [x] TC-1464: Repeat in a source's file browser (`readSourceDocBytes`).
- [x] TC-1465: Repeat in a common's file browser (`readCommonFileBytes`).
- [x] TC-1466: Force the IPC to throw rather than return `{ ok: false }`.
- [x] TC-1467: Open a binary doc (no in-app preview path) and force the exportEntryDoc / exportSourceDoc IPC to fail.
- [x] TC-1468: Click an included-files chip on entry detail header or source detail.

### 72.11 Reorganize modal
- [x] TC-1469: Open Reorganize on an entry.
- [x] TC-1470: Click Group, force `reorganizeGroup` to fail.
- [x] TC-1471: Click Flatten, force `reorganizeFlatten` to fail.
- [x] TC-1472: Drag-reorder rows and click Reorder, force `reorganizeReorder` to fail.
- [x] TC-1473: Use Find & Replace, click Replace all, force `reorganizeFindReplace` commit to fail.

### 72.12 Backup export / import setup
- [x] TC-1474: Click Export Backup, cancel picker (silent).
- [x] TC-1475: Click Export Backup, pick a destination, force the prep IPC to fail or throw.
- [x] TC-1476: Click Import Backup, throw inside the picker.

### 72.13 Quit guards (informational class)
- [x] TC-1477: Start flashing a board (or set `window._isFlashing = true` via DevTools).
- [x] TC-1478: Start a Sound Font backup (or set `window._sfBackupBusy = true`).

### 72.14 versionsPanel (renderer/versionsPanel.js) [B-073]
- [x] TC-1479: In the OS Versions panel, select a version and click the `↗ Export` button in the detail action row (`⧉ Duplicate · ↗ Export · ✎ Rename · ✕ Delete`).
- [x] TC-2252: The renderer can no longer produce a native dialog.

### 72.15 Loop blocking guarantee (regression-bait for the `await` discipline)
- [x] TC-1480: Trigger the common-folder name-in-use re-prompt sequence (TC-1412).
- [x] TC-1481: Trigger the runQuitGuards flash guard.

### 72.16 Partial-failures helper rendering
- [x] TC-1482: Trigger any "Some X failed to Y" path (TC-1423 / TC-1429 / TC-1435 / TC-1444 / TC-1450 / TC-1452 / TC-1456 / TC-1462 — pick one easy to set up).
- [x] TC-1483: Verify the helper falls back gracefully when neither `source` nor `name` is present on a failure record — the bullet reads `• ?: <error>`.
- [x] TC-1484: Verify `error` field defaults to `unknown` when absent.

### 72.17 Sweep coverage spot-checks (visual code review pass)
- [x] TC-1485: `git grep -n "\\balert("` in `renderer/` returns only two hits: the comment at `renderer/index.html:5675` and the defensive fallback at `renderer/versionsPanel.js:573` (`else alert(...)` inside the…

### 72.18 Bulk-export byte-accurate progress bar
- [x] TC-1486: Select several fonts (mix of large and small) + include common + shared tracks, Save/Export to a local folder.
- [x] TC-1487: Bar fill is proportional to data volume, not step count.
- [x] TC-1488: Slow-destination motion (the point of the slice).
- [x] TC-1489: On completion the bar snaps to 100% before the modal closes, even if `contentTotalBytes` was missing/stale on an entry (denominator drift is absorbed).
- [x] TC-1490: Regression — quick single ops that reuse the shared modal (Delete files, Paste files, Move files, Add files, Duplicate/Import common) still show the legacy 50% "busy" fill and behave exactly as before.
- [x] TC-1491: Exported content is byte-identical to source.
- [x] TC-1492: `skip`-mode items (chosen in the conflict modal) contribute nothing to the byte total and don't move the bar; a Save where every item is skipped still shows the "Nothing to save" bail, not a 0-byte crawl.

### 72.19 Style Library — Paste Code (code-only smart paste)
- [x] TC-1493: Open an existing library style in the detail modal.
- [x] TC-1494: After a Paste Code, press Ctrl+Z (and separately the ↺ Undo button).
- [x] TC-1495: Paste-source variety — Paste Code correctly extracts the expression from each of: a full `using X = ...;` block (with metadata comments), a bare `StylePtr<...>()`, and a raw expression with no `using` wrapper.
- [x] TC-1496: Clipboard has no detectable style (e.g. plain prose, or empty).
- [x] TC-1497: A style whose editor content has a `template<...>` prefix line — after Paste Code the prefix line is preserved above the rewrapped `using` line.
- [x] TC-1498: Regression — the Add-Style modal's "Paste & Parse" still fills all fields (name, source, url, tags, notes) as before.

### 72.20 Sound Font library — Duplicate (card right-click + bulk toolbar)
- [x] TC-1499: Right-click a font card → Duplicate (a plain text menu item, NO `⧉` icon — the icon is toolbar-only).
- [x] TC-1500: Numbering + root-strip.
- [x] TC-1501: Select several fonts.
- [x] TC-1502: Click ⧉ Duplicate (N) → no confirm gate (duplicating is non-destructive).
- [x] TC-1503: Batch-safe naming
- [x] TC-1504: Bulk duplicate where one item fails (e.g. force an error in `duplicateEntry`) → the run completes the rest and reports the failure(s) via the partial-failures modal (`• <name>: <error>`); successful ones still land.
- [x] TC-1505: After a successful bulk duplicate, the selection clears and the grid refreshes to show the new copies.
- [x] TC-1506: Undo. After a bulk duplicate, the success toast shows an Undo button (toast stays ~8s).
- [x] TC-1507: Common folder duplicate → `_N`.
- [x] TC-1508: Preset-bank duplicate → `_N`.
- [x] TC-1509: Shared toast action doesn't regress plain toasts.

### 72.21 SD Card Corruption Guard (USB Mass Storage) + compile-modal polish [B-087]
- [x] TC-1510: Non-MS mode is never guarded.
- [x] TC-1511: No ENABLE_SD → no guard.
- [x] TC-1512: OS8 + active define → safe.
- [x] TC-1513: Pre-OS8 + active define STILL warns.
- [x] TC-1514: OS8, missing define.
- [x] TC-1515: OS8, commented define.
- [x] TC-1516: Add define. Inserts `#define MOUNT_SD_SETTING …` and marks the config dirty (Save enables).
- [x] TC-1517: Remove Mass Storage.
- [x] TC-1518: Not now. No change; a later compile of the same mode shows the "Still Off" reminder (see TC-1532).
- [x] TC-1519: MS → MS doesn't re-trigger.
- [x] TC-1520: Pre-OS8 select.
- [x] TC-1521: Pre-OS8 Keep with inert define.
- [x] TC-1522: Upgrade helper.
- [x] TC-1523: Downgrade warning.
- [x] TC-1524: Downgrade + Keep with active define
- [x] TC-1525: Marker-less reset.
- [x] TC-1526: USB change marks dirty.
- [x] TC-1527: OS8 compile modal.
- [x] TC-1528: Add define → compiles protected.
- [x] TC-1529: Remove Mass Storage → compiles safe.
- [x] TC-1530: Compile anyway → Easter egg.
- [x] TC-1531: Cancel aborts the compile.
- [x] TC-1532: Reminder framing.
- [x] TC-1533: Commented define at compile
- [x] TC-1534: Auto-flash not re-nagged.
- [x] TC-1535: Pre-OS8 compile
- [x] TC-1536: Flash modal. Flashing a Mass Storage binary missing the define → "SD Card Corruption Risk" with the "Fix it and recompile?" line naming both fixes; buttons Cancel / Flash anyway / Remove Mass Storage / Enable/Add…
- [x] TC-1537: Enable define → chain (silent).
- [x] TC-1538: Enable define → chain (prompts when other edits exist).
- [x] TC-1539: Remove Mass Storage → chain.
- [x] TC-1540: Flash anyway → Easter egg.
- [x] TC-1541: Cancel doesn't strand.
- [x] TC-1542: Pre-OS8 flash
- [x] TC-1543: Reverts to prior mode.
- [x] TC-1544: Fallback to WebUSB.
- [x] TC-1545: Placement under ENABLE_SD.
- [x] TC-1546: Placement fallback (N/A — unreachable path).
- [x] TC-1547: Uncomment in place.
- [x] TC-1548: Canonical comment.
- [x] TC-1550: Risk copy. Reads cleanly: names the flash-itself risk AND the every-connection risk; no "no safe-eject" contradiction; "SD card" never splits across a line; no cramped/stubby wrapping.
- [x] TC-1551: Last compile time.
- [x] TC-1552: First-ever compile.
- [x] TC-1553: Normal-compile opener.
- [x] TC-1554: Everything types.
- [x] TC-1555: No layout jump on flash.
- [x] TC-1556: Fix → cache HIT skips the rebuild.
- [x] TC-1557: Fix → cache MISS still recompiles.
- [x] TC-1558: Remove Mass Storage → cache HIT.
- [x] TC-1559: DFU parity. The cache-hit "using cached build…" message and instant-flash behavior work on a DFU flash, not just serial.
- [x] TC-1560: Guided path is not worse than manual.

## 73. SOUND FONTS — DEFAULT SD-CARD SET VENDOR RECOGNITION [B-153]
- [x] TC-1561: Default set attributes on import.
- [x] TC-1562: Algorithm-credit is not authorship (Thexter guard).
- [x] TC-1563: Modifier is not author.
- [x] TC-1564: Creator name trimmed of studio tail.
- [x] TC-1565: Creator websites.
- [x] TC-1566: No false positive on third-party fonts.

## 74. SD CARD — READ, INVESTIGATE & ACT (v1.8, card-in-reader only)

### 74.1 Detection & classification
- [x] TC-1567: With the five-card bench mounted, launch the flow → all removable cards are found and each is classified (no crash, no hang).
- [x] TC-1568: Card F (named font folders, common voicepack, no foreign config) → "This is a Proffie card." with a green (good) dot.
- [x] TC-1569: Cards H & J (numbered dirs + set/setting) → classified Xeno family (label "Xeno", not "Xenopixel").
- [x] TC-1570: Card E (no meaningful content) → empty-card state, not "unrecognized".
- [x] TC-1571: Card I (Windows reports unhealthy) → amber dot, "This card reports a health warning." and the detail line "Windows flags this card as unhealthy…" is RETAINED (a real signal).
- [x] TC-1572: Counts read correctly and pluralize (fonts / configs / other files); "1 config" is singular, not "1 configs".
- [x] TC-1573: A non-Proffie data folder (random files, no font/config markers) → generic "doesn't look like a known Proffie card" fallback, never a false Proffie/Xeno claim.
- [x] TC-1574: CFX (N-name or config.txt+colors.txt), Golden Harvest (SoundFonts/+EffectFonts/ or general.txt), and Verso (root config.ini + loose wavs) classify to their family.

### 74.2 Entry point
- [x] TC-1575: On the first-run Config Manager empty state, the "Read my Proffie SD card" link is present and launches the flow.
- [x] TC-1576: Clicking the link shows an immediate busy overlay ("Looking for your SD card…") — the click registers instantly, no dead-click gap before results.

### 74.3 Report & summary
- [x] TC-1577: Exactly one card present → the flow opens STRAIGHT into that card's browser (no intermediate one-item list), with the card summary pinned at the top.
- [x] TC-1902: Empty reader slots are never listed as cards.
- [x] TC-1903: A reader with NO card in it falls through correctly.
- [x] TC-1904: An explicitly chosen empty slot is still assessed.
- [x] TC-1905: A card that IS present but unreadable still surfaces.
- [x] TC-1578: Multiple cards present → a list titled "Multiple SD cards found (N)"; clicking a card opens its browser.
- [x] TC-1579: The bottom "← Other SD cards" button appears ONLY when more than one card is present, and returns to the multi-card list.
- [x] TC-1580: Single-card case → NO "Other SD cards" button (nothing above); Close exits the flow.
- [x] TC-1581: The card summary persists at the top of the browser while drilling into subfolders (not just at the card root).
- [x] TC-1582: The wide modal layout applies to the browse/text views only; the multi-card summary list stays the narrower width.
- [x] TC-1583: On a healthy card the "Its fonts can be added…" detail line is DROPPED (the action buttons already say it); on a warning/odd card the detail line stays.

### 74.4 Navigation (breadcrumb, SFL-style)
- [x] TC-1584: The browse view has NO top "← Back / folder-name" bar.
- [x] TC-1585: The breadcrumb (`F: / Rainbow / …`) segments are clickable; clicking a parent segment jumps to that depth; the current segment is inert.
- [x] TC-1586: Clicking a folder row drills in; the breadcrumb grows and the folder's contents list.
- [x] TC-1587: Clicking a text file opens its contents with the file shown as the inert last breadcrumb leaf; clicking a folder segment returns to the browse view.
- [x] TC-1588: Clicking a `.wav` opens the in-app audio player and plays it (reuses the SFL player).
- [x] TC-1589: File icons match the Sound Font Library exactly — folder 📁, `.wav` 🎵, everything else 📄 (audio is NOT a play triangle).

### 74.5 Per-card actions
- [x] TC-1590: Action buttons are gated by findings — "Open a config" only when configs > 0; "Import fonts to library" only when fonts > 0.
- [x] TC-1591: Launch context sets the hero — from Config Manager "Open a config" is the blue primary and Import is a ghost button; from the Sound Font Library the emphasis flips.
- [x] TC-1592: "Open a config" on a card with one config → opens it (via the save-a-copy flow, §74.6).
- [x] TC-1593: "Open a config" on card I (two configs) → a dropdown chooser lists both; pick one → it opens.
- [x] TC-1594: "Import fonts to library" → opens the existing bulk-import modal (scan → review → run with progress → summary) pointed at the card root; SD overlay steps aside.
- [x] TC-1595: Viewing a text file that reads like a config → an "Open in editor" button appears above it.

### 74.6 Config load-safety (never edit the card live)
- [x] TC-1596: Opening any card config NEVER points the editor at the card path — it prompts "Save Config As" for a user location first.
- [x] TC-1597: The saved copy is added to Recent files; the editor opens the COPY, so a later Save writes to the user's disk, not the card.
- [x] TC-1598: Cancelling the Save-As picker → nothing opens and the SD flow stays put.
- [x] TC-1599: On a successful open, the SD overlay closes (the flow "aborts" into editing).
- [x] TC-1600: The default save filename derives from the card config's name with a `.h` extension.

### 74.7 Smart naming (analyzeFonts / deriveFontName — engine)
- [x] TC-1601: `analyzeFonts` on a numbered card (H/J) → readme-derived names (folder "1" → AHSOKA, "2" → ANAKIN, "6" → DOOKULA).
- [x] TC-1602: On a named card (I) → folder names with camelCase split ("CalKestis" → "Cal Kestis", "DarkSaber" → "Dark Saber").
- [x] TC-1603: On a BankNN card (F) whose "readmes" are smooth-swing settings / marketing text → names fall back to the honest folder name ("Bank17"), NOT junk like "motion_threshold=20" or an Etsy plug.
- [x] TC-1604: Each font carries a `nameSource` of `readme` | `folder` | `folder-fallback` so the future review screen can flag low-confidence suggestions.
- [x] TC-1605: Preview sounds are located per font, including the `hum01.wav` variant (not only exact `hum.wav`); `fontWavPath`/`humWavPath` resolve to real files.

### 74.8 Save a copy off a card (copyOut)
- [x] TC-1606: `copyOut` a single file from a card to a chosen folder → the file lands in the destination; the card is unchanged.
- [x] TC-1607: `copyOut` a whole font folder → the folder is copied recursively to the destination.
- [x] TC-1608: When the destination already has a file/folder of that name → collision-safe " (N)" suffix, no overwrite.

### 74.9 Folder-picker fallback & content-vs-source
- [x] TC-1609: No removable card found → the flow offers "Browse a folder or drive" and a "No SD card found" explanation.
- [x] TC-1610: Picking a removable drive → treated as a card (health / size / filesystem shown).
- [x] TC-1611: Picking a fixed drive or a plain folder (e.g. D:\ or a card copy on disk) → treated as a FOLDER — "Folder" label, no card health/size, and NEVER called a "card" even when it holds Proffie fonts ("These look like…
- [x] TC-1612: Picking the system drive or any non-removable volume → folder treatment, no crash, no false "Proffie card" verdict.

## 75. SOUND FONTS — OPTIMIZE PROGRESS (all phases) + IMPORT CLOSE-OUT SCREEN

### 75.1 Single-import optimize progress
- [x] TC-1613: Import a fresh multi-board inner-zip bundle (e.g. Power of Many) → "Optimizing storage" walks the visible sections (Cataloging files → Trimming duplicates → Rebuilding → Compressing → Packaging → Verifying →…
- [x] TC-1614: The running "~X to reclaim" total shows during the Trimming section only (not carried through later sections) and is denominated in DISK bytes (raw duplicate content scaled by the archive's measured compression…
- [x] TC-1615: Import a single-format zip (no duplicates) → optimize completes quickly, no phase gets stuck, no "trimming" total shown (nothing to trim).
- [x] TC-1616: Re-import/review flows on an already-deduped source → optimize is a fast no-op, no bogus phase display.
- [x] TC-1624: The post-review stretch (Adding N of M + all Optimizing sections) shows an elapsed clock ("Xs/Xm elapsed") below the detail line, ticking every second on its own interval — it starts at Save (review think-time…
- [x] TC-1625: During Compressing/Packaging, the detail line names the file CURRENTLY being compressed (not the one that just finished): on a large file (multi-MB track wav, or a whole rebuilt inner zip during Packaging) its own…
- [x] TC-1626: Each section runs ONCE, in order — Rebuilding places ALL inner-zip groups before Compressing starts, so the bar never sawtooths (climb, drop, climb) from sections alternating per inner zip.
- [x] TC-1627: Duplicate prompt → "Import again as a new source" → the re-run SKIPS the second "Reading source…" hash pass (the scan's hash is handed off) and jumps straight to "Copying source…".
- [x] TC-1635: FOLDER duplicate → "Import again as a new source" → NO second zip-transform at all: the first pass's finished zip is kept staged and just finalized ("Finishing…" flashes, then review).
- [x] TC-1636: After "Copying source…" completes, the label reads "Finding fonts…" during the detection gap before the review screen — never a premature "Done".
- [x] TC-1637: No backdrop drop between the import progress modal and the close-out report: the report opens ABOVE the import modal, which then closes underneath while the report is up — the bare app never flashes through between…

### 75.4 Export source — import-convention progress + dim-only stacking
- [x] TC-1628: Export a deduped source → the progress modal uses the import layout: "Section · metric" line ABOVE the bar (Reading files/Rebuilding = n of m files; Compressing = X of Y bytes), current file below the bar, subdued…
- [x] TC-1629: Throughout the whole export flow (format choice, folder picker, progress, completion summary) the source-detail modal stays VISIBLE, LIGHTLY dimmed underneath (`--c-overlay-stacked` ~0.35, not the full 0.75 backdrop…
- [x] TC-1630: Bulk font export (Export to SD/folder) uses the same layout: "Copying · X of Y" above the bar, current font name below, elapsed line last.
- [x] TC-1631: "Export complete" summary reads as one verdict sentence ("Exported X as a Zip archive: 5,045 files · 2.61 GB, rebuilt in full from your space-optimized source.") with the Includes list subdued (names without .zip)…

### 75.5 Source detail — X vs Close semantics
- [x] TC-1632: Source detail opened FROM a font's entry detail: the bottom Close (or Discard) button steps BACK to the entry detail; the X dismisses the whole stack (no entry detail reappears — straight to the grid).
- [x] TC-1633: Modal cards have NO entrance animation (a fade-in was tried and REVERTED — it left the card invisible for its first frames, showing the app chrome through the dim as "the window vanished").
- [x] TC-1634: Entry⇄source detail swap is geometry-invariant: both modals share the SAME fixed frame (820px × min(90vh, 800px)), so the swap shows no size change in either direction, and the source modal does NOT grow as its async…

### 75.2 Bulk (quick) import optimize progress
- [x] TC-1617: Quick-import a batch including an inner-zip bundle → per-source label shows "Optimizing <name> · NN% · trimming X of duplicates" after the extract stage; the overall bar keeps advancing monotonically (no freeze at…

### 75.3 Import close-out (education) screen
- [x] TC-1618: Fresh single import from a DISK ZIP with dedup savings → close-out modal shows: fonts added, the savings sentence (see §168 — "Your zip started at … JMT Studio saved you …"; the old "found N duplicate files" copy is…
- [x] TC-1619: Fresh import from a FOLDER pick → same screen but "folder" wording in the delete-original guidance.
- [x] TC-1620: Import from LINK → NO delete-your-original suggestion (user never had a local file); shows "stored in your library — export a full copy any time" instead.
- [x] TC-1621: Import with NO dedup (single-format source) → no savings sentence of any kind; delete-original guidance still shown.
- [x] TC-1622: Add-more / Duplicate flows on an existing source → NO close-out screen; returns to the source detail as before.
- [x] TC-1623: Single-font name renders bold in the close-out when exactly one font was added; count ("N fonts") when multiple.

## 76. SOUND FONTS — DUPLICATE RECOGNITION (know what you already own)

### 76.1 Engine (harness-verified 2026-07-23)
- [x] TC-1638: `--self` on the real library: all DELETE twins have_it EXACT at 100%; variants band (Excalibur ignitions, Water Saber 1/2, FO colors) 80-95%; no false have_it.

### 76.2 Single-import review wiring
- [x] TC-1639: Import a bundle sharing fonts with the library (e.g. re-import Power of Many as a new source) → each owned candidate row gains a blue italic "Already in your library: matches X" note and UNCHECKS itself shortly after…
- [x] TC-1640: A row the user has touched (checkbox toggled or name edited) before the results land is NEVER auto-unchecked or relabeled out from under them.
- [x] TC-1641: Scenario 1 — import a lone Proffie-only folder of a font that lives inside an owned bundle → its single candidate gets the have-it note + unchecks (the whole-source hash never matched, the content did).
- [x] TC-1642: Add-more and Duplicate flows show NO recognition notes (add-more locks true dupes by candidatePath; duplicate mode exists to copy).
- [x] TC-1643: A "Checking your library…" stage runs BETWEEN Copying and the review screen (honest catalog progress bar; bytes + current file), so recognition notes are READY when the review opens — not minutes late on big bundles.
- [x] TC-1645: Byte-identical re-import ("import again as a new source") twin-seeds its manifest from the original source — "Checking your library…" passes near-instantly with NO re-hashing, and the review opens with all owned…
- [x] TC-1646: Bulk import ANALYZE modal follows the determinate-progress layout: "Analyzing fonts · N of M" above the bar, current source (and file when available) below it, elapsed clock last; the bar advances WITHIN each source…

### 76.3 Guided bulk / SD review
- [x] TC-1647: Guided bulk (SD card shape) — a source that dodges whole-source dedup because it was EDITED (e.g. KRossguard with a couple of files deleted on the card) surfaces a GREEN "Already in your library: matches X" note and…
- [x] TC-1648: Whenever recognition auto-unchecks rows (single review AND guided bulk), a GREEN summary hint explains it.
- [x] TC-1649: The detail line under EVERY determinate progress bar (import copy/optimize, export, bulk analyze/run, backup) is ONE line that truncates with an ellipsis — long paths never wrap, never grow the modal (supersedes the…
- [x] TC-1650: DIRECTION guard — "Already in your library" (green + auto-uncheck) is claimed ONLY when the library holds EVERY sound in the candidate.

### 76.3b Quick import (no review screen)
- [x] TC-1644: Quick-import a batch containing an owned font → the entry imports but lands flagged Needs Review with "This font's sounds match X, which is already in your library.

## 77. OS VERSION SIGNAL (say what was chosen, flag what the board says)

### 77.1 Tooltip honesty (no board required)
- [x] TC-1651: Open a config with NO `@jmt:os_version` marker (a vendor `.txt`, web Configurator output, a friend's config) → hovering the OS Version field shows the version name AND "This config does not specify a ProffieOS…
- [x] TC-1652: New config (+New) → same "does not specify" tooltip, because a new config is by definition using a version it never asked for.
- [x] TC-1653: A config whose marker names a version that is NOT installed → dropdown holds its current selection (existing behavior) and the "does not specify" tooltip applies, since the config's request could not be honored.
- [x] TC-1654: The version FOLDER NAME remains the first line of the tooltip in every state (the field is 160px and long names truncate — that was the tooltip's only job before this change).

### 77.2 Board comparison (board required)
- [x] TC-1655: Connect a board running a DIFFERENT ProffieOS than the selected tree (e.g. board on 7.14, tree is 8.10) → OS Version field turns red and its tooltip reads "JMT Studio detected ProffieOS v7.14 on the connected board.
- [x] TC-1656: Connect a board running the SAME version as the selected tree → no red, no detection line.
- [x] TC-1657: Manually change the OS Version dropdown to match the board → red clears immediately.
- [x] TC-1658: Disconnect the board → detection line and red clear (we no longer know).
- [x] TC-1659: Flash the board, then let it re-enumerate → the cached board version is discarded and the board is asked again, so a flash that CHANGES the OS version does not leave a stale mismatch (or a stale match) on screen.

### 77.3 The probe must never get in the way
- [x] TC-1660: Serial Monitor open → probe declines rather than fighting for the port.
- [x] TC-1661: Flash immediately after connecting a board
- [x] TC-1662: Board present but not answering (asleep, mid-boot, or flooding serial output like the charge-detect case) → probe times out silently after ~2.5s, no error surfaces anywhere, no red, and the app is exactly as usable…
- [x] TC-1663: Probing must NEVER knock a board into bootloader mode — the probe opens at 115200 only, never 1200 baud (the STM32 bootloader-entry touch).
- [x] TC-1664: Zero ProffieOS versions installed → no crash, no red, no detection line anywhere; the empty-dropdown + blocked-compile behavior is unchanged.

## 78. GETTING PROFFIEOS (offer the action, do not describe it)
- [x] TC-1665: Zero versions installed
- [x] TC-1672: The Get ProffieOS tooltip names BOTH routes: "Download an official ProffieOS release from GitHub, or import a folder you already have." The second clause matches the modal's own link wording, so the phrasing is…
- [x] TC-1671: The Download modal offers ↑ Import a ProffieOS folder you already have, mirroring the Import modal's existing link to Download.
- [x] TC-1666: Download the first version from that button, without leaving the config view
- [x] TC-1667: OS Version dropdown offers BOTH `↓ Download version...` and `＋ Import version...`.
- [x] TC-1668: Picking `↓ Download version...` opens the Download modal; cancelling returns the dropdown to its prior value with no dirty flag and no toolchain churn.
- [x] TC-1669: Sentinel rows are never treated as a version anywhere: compile stays blocked with its existing tooltip, no `@jmt:os_version` marker is ever written as `__download_version__`/`__add_version__`, the JMT add-on state…
- [x] TC-1670: Download from the OS Versions tab still behaves exactly as before (dropdown refresh, panel refresh, new version selected in the panel).

## 79. VOICEPACK PREFLIGHT (compile gate) — say it before the saber does
- [x] TC-1673: Fires correctly.
- [x] TC-1674: Stays silent when every preset declares one.
- [x] TC-1675: Stays silent when the prop does not require it.
- [x] TC-1676: Stays silent on OS7.
- [x] TC-1677: Derived props are detected.
- [x] TC-1678: Unknown prop names are detected.
- [x] TC-1679: The other branch fires too.
- [x] TC-1680: Cancel aborts cleanly.
- [x] TC-1681: Ignore proceeds.
- [x] TC-1682: Fix repairs only the flagged presets.
- [x] TC-1683: Fix then offers to save.
- [x] TC-1684: Fix uses a name the config already uses.
- [x] TC-1685: The card courtesy line echoes reality.
- [x] TC-1686: Deliberately compile-only.
- [x] TC-1687: Degrades quietly.

## 80. SOUND FONTS — WHAT A NEW PRESET CARRIES (shared folder, on write)
- [x] TC-1688: Matches the config's convention.
- [x] TC-1689: Matches a non-`common` convention.
- [x] TC-1690: One typo cannot hijack the convention.
- [x] TC-1691: Convention wins regardless of prop or OS.
- [x] TC-1692: Prop requirement covers the empty case.
- [x] TC-1693: Writes nothing when nothing needs it.
- [x] TC-1694: The library selection is irrelevant.
- [x] TC-1695: Cold path too.
- [x] TC-1696: The + button seeds it.
- [x] TC-1697: Seeding is name-aware and rule-gated.
- [x] TC-1698: Preset BANKS and the first preset of an empty config
- [x] TC-1699: The common checkbox writes the semicolon too.
- [x] TC-1700: A seeded preset is not flagged at compile.
- [x] TC-1701: Auto-included on a prop requirement.
- [x] TC-1702: The warning names the real reason.
- [x] TC-1703: The courtesy ask survives.
- [x] TC-1704: Config-selected common still wins.

## 81. COMMON FOLDER ON A CARD — which pack is this, and do not re-push it

### 81.1 The marker itself
- [x] TC-1705: Written on export, and says who wrote it.
- [x] TC-1706: The body answers the question without opening anything else.
- [x] TC-1707: The version says what it means.
- [x] TC-1708: It names the real folder.
- [x] TC-1709: The library copy is never touched.
- [x] TC-1710: A rename leaves exactly one marker, and old formats migrate.
- [x] TC-1711: It only ever deletes its own file.
- [x] TC-1736: A failed marker never fails the export.

### 81.2 Not re-pushing a pack the card already has
- [x] TC-1712: Identical pack is skipped silently.
- [x] TC-1713: A genuinely different pack still prompts.
- [x] TC-1730: Marker deleted by hand → still recognised, and quietly restored.
- [x] TC-1731: A lying marker is ignored.
- [x] TC-1732: A card we never wrote is recognised.
- [x] TC-1733: Same size, different bytes still prompts.
- [x] TC-1734: A user's own files are content, and are never deleted.
- [x] TC-1735: Nothing is written during a pre-scan.
- [x] TC-1714: Unreadable is never "current".
- [x] TC-1715: It compares the RIGHT common.

## 82. VOICEPACK PICKER — say which version, and where the file comes from [B-120]
- [x] TC-1716: V1 tooltip states the consequence, not just the fact.
- [x] TC-1717: V2 tooltip says what it adds and that it is safe on OS7.
- [x] TC-1718: The version note is visible without hovering anything.
- [x] TC-1719: The note hides on the More tab
- [x] TC-1720: The source line is correct the moment the modal OPENS.
- [x] TC-1721: The hosting disclaimer is always present
- [x] TC-1722: The Crucible link opens the thread, not a reply.
- [x] TC-1723: Install routing is unchanged (regression only).
- [x] TC-1724: The help line names the destination.

## 83. WHY A BUTTON IS DISABLED — Compile and Flash
- [x] TC-1725: Compile's six reasons, in priority order.
- [x] TC-1726: The drift is gone.
- [x] TC-1727: Flash's four reasons.
- [x] TC-1728: Silence beats a wrong guess.
- [x] TC-1729: Tooltips never change enablement.

## 84. SHARED TRACKS ON EXPORT — stop asking, and never overwrite [B-006]

### 84.1 The precedence ladder
- [x] TC-1737: The old prompt is gone.
- [x] TC-1738: Rule zero: the config wins.
- [x] TC-1739: Referenced but missing still warns.
- [x] TC-1740: Otherwise the setting decides, silently.

### 84.2 The checkbox on the card
- [x] TC-1741: Hidden until it matters, on the CARD.
- [x] TC-1768: Permanently present in the MODAL.
- [x] TC-1769: The two surfaces never disagree.
- [x] TC-1742: It is a saved setting, not a per-export choice.
- [x] TC-1743: Clicking it does not open the tracks modal.
- [x] TC-1744: Default is off

### 84.3 Additive export, and the one remaining ask
- [x] TC-1745: Nothing at the destination is ever deleted.
- [x] TC-1746: Only what is missing gets copied.
- [x] TC-1747: A same-name file that differs asks, per file, defaulting to Replace.
- [x] TC-1763: Choosing Skip keeps the card's copy, and says so.
- [x] TC-1764: Per file, not all-or-nothing.
- [x] TC-1765: Everything defaults to Replace now.
- [x] TC-1770: The common row names the PACK, not the folder.
- [x] TC-1771: Same in the standalone common export.
- [x] TC-1772: Per-row defaults still work.
- [x] TC-1773: The overwrite caution, and only when it applies.
- [x] TC-1774: Continue with an untouched dialog honours the real default.
- [x] TC-1766: Cancelling the tracks dialog aborts the whole save
- [x] TC-1767: Files that are merely missing are never asked about.
- [x] TC-1748: The tracks row is gone from the differences dialog.
- [x] TC-1749: The destination-mismatch ask fires once, and only with evidence.
- [x] TC-1750: Byte-identical says nothing at all.
- [x] TC-1751: No tracks folder at the destination, setting off → no ask.

### 84.4 Getting tracks onto a card on their own
- [x] TC-1752: Export from the tracks modal.
- [x] TC-1753: Export from the card.
- [x] TC-1754: Both routes are additive too
- [x] TC-1775: Byte-identical fonts are never asked about, and never re-copied.
- [x] TC-1776: The dialog only lists what actually differs, and its copy matches what is listed.
- [x] TC-1777: The left-alone sentence only appears when something actually was.
- [x] TC-1780: Same in the standalone common export.
- [x] TC-1781: The destination scan shows progress.
- [x] TC-1783: Track names go past during the scan.
- [x] TC-1784: The per-file ticks are throttled, not per-file-synchronous.
- [x] TC-1782: Pressing Continue shows something instantly.

## 85. EXPORT COMPLETION SUMMARY — say what was decided [B-009, B-215]
- [x] TC-1786: It follows the app's completion-summary format.
- [x] TC-1787: Show in folder opens the destination
- [x] TC-1755: It appears on success.
- [x] TC-1801: A no-write export uses the SUMMARY, not a separate dialog.
- [x] TC-1810: The destination line does not claim a save that did not happen.
- [x] TC-1812: Nothing in the export flow assumes the destination is an SD card.
- [x] TC-1811: No progress bar flashes on the way to a no-write summary.
- [x] TC-1802: The selection is cleared or kept according to whether there is anything to revisit.
- [x] TC-1756: Fonts are counted honestly.
- [x] TC-1757: The common folder says WHY it shipped.
- [x] TC-1758: An already-current common folder is reported, not silent.
- [x] TC-1759: Tracks report the CHANGE, and only explain what the app decided.
- [x] TC-1785: A no-change export still reports every part.
- [x] TC-1760: Kept tracks are named.
- [x] TC-1761: The destination is shown
- [x] TC-1762: Failures still take priority.

## 86. EXPORT SPEED — remember the card instead of re-reading it [B-162]
- [x] TC-1788: Second export to the same card is near-instant.
- [x] TC-1789: One hand-edited file costs one file.
- [x] TC-1790: Deleting the manifest costs one full pass, then heals.
- [x] TC-1791: A corrupt manifest heals the same way.
- [x] TC-1792: Files only the card has are ignored.
- [x] TC-1793: The library is never re-hashed.
- [x] TC-1794: A rename in the library adds rather than replaces.

## 87. COPY PROGRESS — names going past wherever files land
- [x] TC-1795: Paste into the shared tracks folder
- [x] TC-1796: Paste into a font's files
- [x] TC-1797: Add from library
- [x] TC-1798: The elapsed line moves during a single large file.
- [x] TC-1799: A failure still clears the progress.
- [x] TC-1800: Browse → Add files is the known exception

## 88. SHIFT-RANGE IN THE SOUND FONTS GRID
- [x] TC-1803: Shift adds a range.
- [x] TC-1804: It adds rather than replaces.
- [x] TC-1805: The anchor comes from selecting actions only.
- [x] TC-1806: The corner checkbox ranges too.
- [x] TC-1807: A stale anchor degrades safely.
- [x] TC-1808: Shift never opens an entry
- [x] TC-1809: The tracks card is not part of the range.

## 89. VOICE PACK VERSION GATE (export) — the pack has to be the one the prop needs
- [x] TC-1813: Fires only when V2 is genuinely required.
- [x] TC-1814: The message says only what is known.
- [x] TC-1822: It deliberately does NOT teach how to tell a V2 pack from a V1 one
- [x] TC-1815: Three ways out.
- [x] TC-1816: The dropdown is filtered to version 2 packs only
- [x] TC-1817: No V2 pack in the library at all
- [x] TC-1826: Getting a pack does not silently continue the export.
- [x] TC-1818: It resolves before the destination scan begins
- [x] TC-1823: A library with no voice packs exports fonts with NO prompt at all.
- [x] TC-1824: But the summary says so, once, in amber.
- [x] TC-1825: No note when nothing wanted one.
- [x] TC-1819: Silent when it should be.

## 279. A CONFIG'S PROP IS A FIELD YOU CAN READ AND CHANGE [B-444]
- [x] TC-3891: The list is the selected version's props, and it follows the version.
- [x] TC-3892: Picking a prop rewrites the include in place.
- [x] TC-3893: Picking `None (saber.h)` removes the include line.
- [x] TC-3894: A prop include OUTSIDE `CONFIG_PROP` is not read as the prop.
- [x] TC-3895: Hand-editing the include updates the field.
- [x] TC-3896: A config with no `CONFIG_PROP` block gets a correct scaffold.
- [x] TC-3897: The red state fires only on a genuinely missing prop.
- [x] TC-3898: An unreadable props folder is UNSURE, not missing.
- [x] TC-3899: `None (saber.h)` is dimmed; a real prop is not; `Not found…` is red.
- [x] TC-3900: The three tooltips say the right thing for their state.
- [x] TC-3901: The Link Prop and Link JMT Add-ons buttons are unchanged.
- [x] TC-3902: KNOWN GAP, recorded so it is not rediscovered: swapping away from the JMT wrapper turns the add-ons off, and it is unverified whether anything says so.

## 280. PLAIN WORDING IN SHIPPED UI TEXT — FIRST PASS [B-443]
- [x] TC-3903: Every "recompile needed" status reads with a comma.
- [x] TC-3904: The USB and Board mismatch tooltips still say what to do.
- [x] TC-3905: The Link a Prop modal subtitle wraps without stranding a word.
- [x] TC-3906: Favorites empty state and the unsaved-changes prompts read cleanly.

## 281. BRING YOUR OWN PROP, AND BE ABLE TO TAKE IT BACK OUT [B-446]
- [x] TC-3907: Import from the version card.
- [x] TC-3908: Import from the Prop dropdown.
- [x] TC-3909: It refuses a program.
- [x] TC-3910: It refuses a non-`.h`.
- [x] TC-3911: A name collision asks before replacing.
- [x] TC-3912: Copy to another version, and the row says what it will do.
- [x] TC-3913: A prop that came with ProffieOS offers NOTHING.
- [x] TC-3914: The menu shape follows the count of OTHER versions.
- [x] TC-3915: Delete, and the label does not repeat the filename.
- [x] TC-3916: Deleting the prop the OPEN config names warns first.
- [x] TC-3917: A cached build is not reused after the props folder changes.
- [x] TC-3918: The blue survives a repaint.
- [x] TC-3919: The divider sits at button height.

## 90. KNIGHT RIDER WAITING BAR — one animation, and it never rolls one way

### The bars that were wrong
- [x] TC-1827: Import ProffieOS Version.
- [x] TC-1828: Voice pack picker
- [x] TC-1829: Bulk import opens with the bar already sweeping back and forth.
- [x] TC-1830: Backup prep opens with the bar already sweeping back and forth.
- [x] TC-1831: Compare picker

### The four that switch mid-run, where a real counter stops meaning anything
- [x] TC-1832: Cancel an export.
- [x] TC-1833: Cancel a merge.
- [x] TC-1834: Cancel an import.
- [x] TC-1835: The inspect / scan phase

### Containment and regression
- [x] TC-1836: Every bar above stays inside its own track.
- [x] TC-1837: Measurable bars are untouched.
- [x] TC-1838: The compile bar is unchanged.
- [x] TC-1839: Both themes. The sweeping bar is visible against its track in dark and light mode.

## 91. PRESET VALIDITY IN THE LIST — bring the field red up to the name

### The mark itself
- [x] TC-1840: A preset whose TRACK does not resolve shows a red name in the list.
- [x] TC-1841: A preset whose FONT FOLDER is not in the library shows a red name in the list.
- [x] TC-1842: A preset with both good shows a normal name.
- [x] TC-1843: The selected row never shows red
- [x] TC-1844: Hovering a red name explains it

### It stays honest
- [x] TC-1845: Fix the track, the red clears.
- [x] TC-1846: Break a good track, the red appears
- [x] TC-1847: Rename a font in the library so a preset's font no longer matches
- [x] TC-1848: The list agrees with the detail, always.
- [x] TC-1849: Empty library does not paint everything red.

### Freshness across tabs (both found in use, 2026-07-31)
- [x] TC-1864: Rename a font in Sound Fonts, switch straight to Config.
- [x] TC-1865: Same for delete and for import
- [x] TC-1866: A font renamed AWAY stops resolving.
- [x] TC-1867: The track dropdown agrees.
- [x] TC-1868: Renaming does not cost a full re-listing storm.

### The refactor did not change the field (REGRESSION — the real risk here)
- [x] TC-1850: `tracks/<file>.wav`
- [x] TC-1851: `common/tracks/<file>.wav`
- [x] TC-1852: `<font>/tracks/<file>.wav`
- [x] TC-1853: An unrecognized first segment is NOT red.
- [x] TC-1854: The singular `track/` warning still works.
- [x] TC-1855: Both singular-folder wordings.
- [x] TC-1856: A value that is not a track path shape at all
- [x] TC-1857: Tooltips still match their state

## 92. RENAMING A FONT — remember hits, never misses
- [x] TC-1858: Rename a library font to a name a preset already uses.
- [x] TC-1859: Play a preset whose font does not exist, then create or rename a font into that name, then play again.
- [x] TC-1860: The Track dropdown recovers the same way.
- [x] TC-1861: Renaming away still behaves.
- [x] TC-1862: No slowdown on the good path.
- [x] TC-1863: Deleting a font behaves like renaming away

## 93. Destination manifest survives a bad read
- [x] TC-1869: — Export a selection to an SD card in a reader.
- [x] TC-1870: — With a manifest covering many fonts, corrupt it by truncating the file mid-JSON.
- [x] TC-1871: — Following TC-1870, delete the corrupt manifest and export again.
- [x] TC-1872: — Mount the card through a board as USB mass storage (USB type including Mass Storage, `MOUNT_SD_SETTING` present, `sd 1` at the serial monitor).
- [x] TC-1873: — Same as TC-1872 but pull the card mid-scan.
- [x] TC-1874: — A destination whose manifest was written by a future schema version (edit `version` to 999) is replaced cleanly on the next export rather than refused — an incompatible format is not the same as an unreadable one.
- [x] TC-1875: — Confirm the cost claim end to end: on a card with a valid manifest, an export of an unchanged selection performs no file reads of the destination beyond stats.

## 95. BUILD CACHE: comments must not cost a recompile (v1.8)
- [x] TC-1906: Compile a config.
- [x] TC-1907: Add a brand-new whole-line comment; also delete a different comment entirely.
- [x] TC-1908: Add a decorative banner line `//`.
- [x] TC-1909: Add a `/ multi-line block comment /`.
- [x] TC-1910: Re-indent lines / add trailing spaces / insert blank lines.
- [x] TC-1911: MUST MISS — uncomment a live `#define` (`//#define X` -> `#define X`).
- [x] TC-1912: MUST MISS — change text inside a string literal (a preset or font name, e.g. `"OldGlory;common"`).
- [x] TC-1913: MUST MISS — a comment that merely contains code text (`// #define NUM_BLADES 99`) is ignored, but changing the real `#define NUM_BLADES` value still misses.
- [x] TC-1914: Style Library: edit only a comment inside a `using` in `my_styles.h` -> hit.
- [x] TC-1915: One-time invalidation is expected.

## 96. BUILD CACHE: orphaned build packages are reclaimed (v1.8) [B-182]
- [x] TC-1916: Launch the app.
- [x] TC-1917: After the sweep, every remaining buildPkg directory's `proffieOSHash` matches an installed version.
- [x] TC-1918: Self-healing.
- [x] TC-1919: THE GUARD THAT MATTERS.
- [x] TC-1920: Restore a cached build; confirm `lastUsedAt` appears in that entry's `metadata.json` and updates on each restore.
- [x] TC-1922: Config hash version stamp.
- [x] TC-1923: Stale entries are reclaimed, not merely orphaned.
- [x] TC-1924: A buildPkg directory left with no entries after the stale sweep is removed too, so no empty shells accumulate.
- [x] TC-1925: An entry whose `metadata.json` is missing or unparseable is LEFT ALONE by both sweeps.
- [x] TC-1926: Settings → Clear Compile Cache shows GB above 1 GB (e.g. "1.26 GB") rather than four-digit MB.
- [x] TC-1921: Compile metrics: `_configFeatures` counts active code only.

## 97. CORE VERSION IS CHOSEN, NOT HARDCODED (v1.8)
- [x] TC-1927: THE CASE THAT MATTERS.
- [x] TC-1928: Fresh profile, first launch with network.
- [x] TC-1929: Offline first launch must not block.
- [x] TC-1930: Download a new ProffieOS version.
- [x] TC-1931: Versions view → Build Core.
- [x] TC-1932: Pick a core that is not installed.
- [x] TC-1933: Explicit choice forces isolation.
- [x] TC-1934: Set version A to 3.6 and version B to 4.6.
- [x] TC-1935: STALE BINARY GUARD — the worst failure this can have.
- [x] TC-1936: No cache invalidation for existing users.
- [x] TC-1937: Clearing a version's choice back to "Follow latest" works, and after a new core is published that version picks it up while a pinned version does not.
- [x] TC-1938: Delete the installed core directory for a version's chosen core, relaunch.
- [x] TC-1939: Index reachable but returning junk, or the host down mid-session.
- [x] TC-1940: Regression on the majority path — a user who never touches this setting sees no change: same core, same isolation behaviour, same compile times, no new prompts.

### 97.1 Upgrading from 1.7.2 — the change must be chosen, not inherited
- [x] TC-1941: : Real 1.7.2 → 1.8.0 upgrade. Every existing version's `.jmt_meta.json` gains `"coreVersion": "4.6.0"` on first launch.
- [x] TC-1942: Old cache entries are cleared on upgrade, the core is kept.
- [x] TC-1943: The backfill runs once.
- [x] TC-1944: Simulate a newer core being published (or wait for one).
- [x] TC-1945: Backfill on a profile with no installed versions, and on one where a version folder is unreadable.

### 97.2 Changing core on an existing version warns with real numbers
- [x] TC-1946: With cached builds present, change the core on that version.
- [x] TC-1946a: The dialog must NOT say the builds are lost, because they are not.
- [x] TC-1946b: Prove the reversibility rather than trusting the wording.
- [x] TC-1946d: THE ONE THAT CAN FLASH A WRONG BINARY. Test this before anything else here.
- [x] TC-1946e: Changing the core on a version that is not the one selected for building must NOT disturb the current compiled state or disable Flash.
- [x] TC-1946c: Disk consequence of the above, and it is expected rather than a bug: keeping both sets means the cache grows with each core used.
- [x] TC-1947: Cancel that dialog.
- [x] TC-1948: No cached builds for that version, or the target core already has cached builds.
- [x] TC-1949: Entries that recorded no duration.
- [x] TC-1950: The target core is not installed.

### 97.4 Pinned always — no "follow latest", and the version floor
- [x] TC-1955: The dropdown has no "Follow latest" entry.
- [x] TC-1956: Floor holds. Only 4.6.0 and 3.6.0 are offered.
- [x] TC-1957: An installed version below the floor IS still listed.
- [x] TC-1958: Pin a version to 3.6.
- [x] TC-1959: With the index unreachable, the "newer available" line is absent rather than guessed from a cached list.
- [x] TC-1960: A ProffieOS version with no core recorded (import made while offline) is healed on next read: pinned to the newest installed core and written to `.jmt_meta.json`.
- [x] TC-1961: Take the newer version from the dropdown.

### 97.5 Reset Build Space
- [x] TC-1962: The common case stays quiet.
- [x] TC-1963: The expensive case is named before committing.
- [x] TC-1964: Never below what is in use.
- [x] TC-1965: The tools currently building are never removed even if no version names them — `uninstallCore` refuses.
- [x] TC-1966: Nothing to reclaim → the row says so and no modal appears.
- [x] TC-1967: After a reset that removed tools, their stored compiles are gone too.
- [x] TC-1968: Flash is disabled after a reset — the staged build is gone, so `checkCacheForConfig` must run and downgrade the compiled state.
- [x] TC-1969: `staging/` is reclaimed.
- [x] TC-1970: Freed figure reported afterwards matches what the confirm promised, within rounding.
- [x] TC-1971: Reset with the index unreachable.

### 97.3 `@jmt:core` is recorded on compile
- [x] TC-1951: Fresh compile writes `// @jmt:core 4.6.0` into the saved config.
- [x] TC-1952: A cache restore stamps the core the ENTRY was built with
- [x] TC-1953: Open a pre-1.8 config with no `@jmt:core` line.
- [x] TC-1954: Compile on 3.6 and confirm the marker reads 3.6.0, so the config records the core that made it fit.

## 98. LINK PROP FROM THE OS VERSIONS FILE TREE (v1.8)

### 98.1 Where the action appears
- [x] TC-1972: With no config open, neither the viewer button nor the right-click item appears on a prop file.
- [x] TC-1973: With a config open, open `props/saber_BC_buttons.h` in the viewer — Link Prop appears next to Search.
- [x] TC-1974: Right-click a prop file in the tree with a config open → one item, "Link … as this config's prop".
- [x] TC-1975: Right-click a prop in search results as well as in the folder tree; both paths offer it, since both build rows through the same helper.
- [x] TC-1976: A `.h` in a subfolder under `props/` (if one exists) is NOT offered — only files directly in `props/`, because that is what `../props/<name>.h` can resolve.
- [x] TC-1977: Close the viewer, reopen a non-prop file: the button does not linger from the previous file.

### 98.2 The selected-version check
- [x] TC-1978: Config set to a version that HAS the prop → links normally, toast names the file.
- [x] TC-1979: The real case.
- [x] TC-1980: Same prop name present in both browsed and selected versions but with different contents → links without complaint.
- [x] TC-1981: No version selected for the config (sentinel) → a toast asks for one; no modal, no edit.
- [x] TC-1982: Version folder unreadable / listing fails → treated as absent and refused, never linked on a failed lookup.

### 98.3 Insertion, and the shared conflict modal
- [x] TC-1983: Config with an existing `#ifdef CONFIG_PROP` block → the include lands inside it, before the `#endif`, and the editor reveals the inserted line.
- [x] TC-1984: Config with NO `CONFIG_PROP` block but a `CONFIG_PRESETS` block → a new `CONFIG_PROP` scaffold is created before CONFIG_PRESETS, honouring ProffieOS section order.
- [x] TC-1985: Config with neither block → scaffold appended at end of file, with a blank line separating it from the previous content.
- [x] TC-1986: Existing DIFFERENT prop include present → conflict modal, and its intro names the prop being linked.
- [x] TC-1987: The prop being linked is already present but commented out → it is simply uncommented, no duplicate include, no modal.
- [x] TC-1987b: The duplicate-include regression (found 2026-08-11).
- [x] TC-1988: The prop is already present and active → toast says so and nothing is written.
- [x] TC-1989: Undo.
- [x] TC-1990: Linking marks the config dirty and the change survives a save/reopen.

### 98.4 The add-ons warning
- [x] TC-1991: Config currently uses `jmt_fett263_wrapper.h`, link a different prop → the conflict modal carries the extra warning.
- [x] TC-1991b: The warning's claim that `#defines` survive is true — after swapping props, confirm every `JMT_` / `CHARGE_DETECT_PIN` line is still in the config, untouched.
- [x] TC-1992: Config uses some other prop (not ours), link a different prop → conflict modal appears with NO add-ons warning.
- [x] TC-1993: Config uses another prop, link our wrapper via Link Prop from the tree → normal conflict modal, no add-ons warning (nothing of ours is being lost).
- [x] TC-1994: The existing Link JMT Add-ons toolbar button still behaves exactly as it did in 1.7.x — same modal, same insertion, same uncomment path.
- [x] TC-1995: After linking a non-JMT prop, the Link JMT Add-ons button reappears (the config no longer contains the wrapper), and clicking it swaps back cleanly.

### 98.6 The toolbar slot and the prop picker
- [x] TC-1998: Selected version HAS JMT add-ons, config does not use the wrapper → button reads Link JMT Add-ons and behaves exactly as in 1.7.x.
- [x] TC-1999: Selected version has NO add-ons, config names no prop → button reads Link Prop and opens the picker.
- [x] TC-2000: Selected version has NO add-ons, config already names a prop → no button.
- [x] TC-2001: Config already uses the wrapper → no button, in either version state.
- [x] TC-2002: The label and title actually change between the two modes — the static markup says "Link JMT Add-ons", so a mode switch that failed to set `textContent` would show the wrong word on the right action.
- [x] TC-2003: State tracks live edits.
- [x] TC-2004: Picker lists the props of the selected version, not of whatever the OS Versions tab was last browsing.
- [x] TC-2005: `prop_base.h` is excluded from the list.
- [x] TC-2006: When the selected version has JMT add-ons installed, `jmt_fett263_wrapper.h` appears in the picker like any other prop, tagged so it is recognisable.
- [x] TC-2007: Picking a prop writes it and closes the picker; Cancel writes nothing.
- [x] TC-2008: Since the config had no prop, the insert creates a `CONFIG_PROP` block if one is missing, in the right place relative to `CONFIG_PRESETS`.
- [x] TC-2009: A version whose props folder cannot be read → the picker says so rather than showing an empty box that looks like "this version has no props".
- [x] TC-2010: Performance.

### 98.5 Build-through
- [x] TC-1996: Link `saber_sa22c_buttons.h` into a working config and compile.
- [x] TC-1997: Link a prop, compile, then link a different one and compile again — the second build is not served from the first one's cache entry.

## 99. SETTINGS RESPONSIVENESS, COPY AND THE CACHE-CHECK RACE (v1.8) [B-102]

### 99.1 Settings opens instantly
- [x] TC-2011: Open Settings on a machine holding several Proffieboard Plugins.
- [x] TC-2012: Click the gear a second time straight after closing.
- [x] TC-2013: `arduino-data` and the ProffieOS versions tree are no longer walked on open.

### 99.2 Pending and failure states on the two size rows
- [x] TC-2014: On open, Clear Cached Builds and Reset Build Space both read `(calculating…)` with a gentle opacity pulse, and both buttons are disabled.
- [x] TC-2015: Both fill in with real figures and their buttons enable.
- [x] TC-2016: The pulse stops when the value lands.
- [x] TC-2017: Reopen Settings after a Clear or a Reset.
- [x] TC-2018: Failure path.

### 99.3 Tooltips: the label and the button say different things
- [x] TC-2019: Hover the label and then the button on Clear Cached Builds.
- [x] TC-2020: Same on Reset Build Space.
- [x] TC-2021: Default Config Template
- [x] TC-2022: No tooltip runs past roughly one line.

### 99.4 Words on the destructive controls
- [x] TC-2023: Nothing in the Settings modal says a variant of "frees" or "reclaim".
- [x] TC-2024: The Reset button's tooltip is not gentler than the dialog it opens.
- [x] TC-2025: With unused plugins in the list, the confirm closes with "Plugins your ProffieOS versions use are kept." — the one fear that list raises.
- [x] TC-2026: With only temp files to delete, that closing line is absent.
- [x] TC-2027: The plugin line pluralises correctly at one, two and three versions.
- [x] TC-2028: "Proffieboard Plugin" everywhere a user can read it — never "build tools".

### 99.5 Reset Build Space confirms INLINE
- [x] TC-2029: Click Reset.
- [x] TC-2030: The panel itemises only non-zero parts, and the total matches the row's own figure.
- [x] TC-2031: Cancel closes the panel and re-enables the Reset button.
- [x] TC-2032: Confirm.
- [x] TC-2033: Close and reopen Settings with a panel left open.
- [x] TC-2034: Failure path: the panel closes, the button re-enables, and the row names which part failed rather than a generic message.
- [x] TC-2035: The reset does not converge to zero, and that is correct.

### 99.5b Build Space is a footprint, and it owns only temp files and plugins
- [x] TC-2069: Note the Build Space figure, switch the Proffieboard Plugin on a ProffieOS version, reopen Settings.
- [x] TC-2070: Clear Cached Builds.
- [x] TC-2071: The confirm's bullets add up to the number in its first line.
- [x] TC-2072: With unused plugins and empty folders present, the empty plugin folders bullet appears and the reset removes those directories.
- [x] TC-2073: The reset does not delete cached builds.
- [x] TC-2074: Restart after that reset.
- [x] TC-2075: `✓ Reset (X deleted)` matches the drop in the Build Space figure.
- [x] TC-2076: Where the footprint is non-zero but nothing is reclaimable, the Reset button is disabled and says why — "Everything here is in use.

### 99.6 Busy dots
- [x] TC-2036: During a Reset the confirm button reads `Resetting` with animated dots cycling 1 → 2 → 3.
- [x] TC-2037: The button's width does not change as the dots animate, so buttons beside it do not shift.
- [x] TC-2038: On completion the label returns to `Yes, Reset` with no leftover dots.

### 99.7 The licence panel
- [x] TC-2039: View License expands and scrolls itself into view, with Hide License still visible above it.
- [x] TC-2040: On a window ~800px tall or more the whole licence fits with no scrollbar.
- [x] TC-2041: On a short window it scrolls internally, and reaching the bottom does not hand the wheel to the modal underneath.
- [x] TC-2042: The panel never grows past one page of the modal.

### 99.8 CSS defects that were rendering wrong
- [x] TC-2043: The release-notes body in Settings has a background.
- [x] TC-2044: Hovering an unknown effect chip lifts its background rather than clearing it.
- [x] TC-2045: Light mode, first run
- [x] TC-2046: Light mode, app launch

### 99.9 Cache check: no flicker, and no stale result winning
- [x] TC-2047: Open a config.
- [x] TC-2047b: Click Compile during a config open, deliberately racing the cache lookup.
- [x] TC-2048: Switch between two configs repeatedly and quickly.
- [x] TC-2049: Switch to a config with a known cache hit.
- [x] TC-2050: After all of the above, Compile ends up enabled.
- [x] TC-2051: Edit a config, then undo back to the compiled state.
- [x] TC-2052: A cached build is only offered when the whole build package matches.

### 99.10 The build log opens only when a download is actually coming
- [x] TC-2053: With the Proffieboard Plugin already installed in Arduino IDE, launch and open a config.
- [x] TC-2054: Run Reset Build Space, then build.
- [x] TC-2055: Genuine first run
- [x] TC-2056: Pin a ProffieOS version to a plugin nobody has installed.
- [x] TC-2057: Adoption stays version-exact — a system tree holding only 3.6 must NOT satisfy a 4.6.0 requirement, so that case still opens the log and downloads.
- [x] TC-2058: Once opened by a real download, the log stays open — it is the user's panel from then on.

### 99.11 Port selection is not gated, it is marked
- [x] TC-2059: The port status reads exactly `No Proffieboard detected.` — no count of other ports.
- [x] TC-2060: With no Proffieboard connected, the dropdown still lists every serial port.
- [x] TC-2061: Select a non-Proffieboard port (Bluetooth, a USB-serial adapter, an ESP32).
- [x] TC-2062: Flash is enabled
- [x] TC-2063: Press it with no board attached.
- [x] TC-2064: Press it with a real Proffieboard attached elsewhere.
- [x] TC-2065: Two Proffieboards attached, neither matching the selection → genuinely ambiguous, so it refuses rather than guessing.
- [x] TC-2066: Auto-flash after a compile still requires a confirmed Proffieboard.
- [x] TC-2067: The Serial Monitor attaches to a non-Proffieboard port and shows its output.
- [x] TC-2068: DFU mode is unaffected — it is the path for a board that does not enumerate as a Proffieboard, and it never depended on port identification.

## 100. AD-HOC WORK SHIPPED 2026-08-15 (built during the pre-commit dev test)

### 100.1 The slot editor keeps typed text when it closes
- [x] TC-2077: Type into a slot's custom expression, then close the sidecar.
- [x] TC-2078: Type into a slot, then click a different slot in the same preset.
- [x] TC-2079: Type into preset A's slot, switch to preset B, open B's slot.
- [x] TC-2080: Escape discards.
- [x] TC-2081: Ctrl+Z after a close-commit
- [x] TC-2082: The slot × resets to default (`StylePtr<Black>()`) and does not resurrect typed text.
- [x] TC-2083: Type an expression with unbalanced brackets, then close.

### 100.2 A new preset lands above the charge preset
- [x] TC-2084: On a config that defines `JMT_CHARGE_STYLE_PRESET`, click `+`.
- [x] TC-2085: On the same config, Sound Fonts → add a preset with a font.
- [x] TC-2086: On a config without the define, `+` appends at the very end, as before.
- [x] TC-2087: Comment the define out
- [x] TC-2088: A config where the charge preset is the only preset.

### 100.3 Compile failures are summarised, not dumped [B-032]
- [x] TC-2089: Force a flash overflow (a V3-sized config with the board set to Proffieboard V2 is the cheapest route).
- [x] TC-2090: The capacity line names the right board and its real limit — V2 262,144 and V3 507,904, read from the plugin's own `boards.txt`, not a table in our code.
- [x] TC-2091: The summary renders in two tiers — first line emphasised, the instruction muted beneath a gap.
- [x] TC-2092: Break a config
- [x] TC-2093: Any compile log — no `[92m`-style escape garbage anywhere.
- [x] TC-2094: A flash failure with a device in DFU carries no dfu-util copyright banner and no unrelated hardware IDs in the summary.
- [x] TC-2095: Known limitation, verify the wording is still honest
- [x] TC-2253: A RAM overflow is named as RAM.
- [x] TC-2254: A RAM overflow must not send the user to delete presets
- [x] TC-2255: No board capacity is quoted for RAM.
- [x] TC-2256: A host out-of-memory blames the computer, not the board.
- [x] TC-2257: Ordering: flash beats LTO noise.
- [x] TC-2258: A bare `lto-wrapper failed` is NOT translated.

### 100.4 Buttons that show a working state
- [x] TC-2096: Check for Updates

## 101. COPY STYLE EXPORTS A SELF-CONTAINED STYLE
- [x] TC-2097: The regression.
- [x] TC-2098: Non-templated entries are unchanged.
- [x] TC-2099: A wrapper stays previewable.
- [x] TC-2100: Replacing the stand-in works.
- [x] TC-2101: Every default is substituted, each marked with its own name.
- [x] TC-2102: Blocked entries disable the button.
- [x] TC-2103: The disabled state resets.
- [x] TC-2104: No trailing comma.
- [x] TC-2105: Copy Function is untouched.
- [x] TC-2106: The sidecar still reads template parameters with Style Library CLOSED.
- [x] TC-2107: Add to Library round-trip.
- [x] TC-2108: A style with a name that is a prefix of another identifier.

## 102. SLOT EDITOR: DEFINITIONS ARE FLAGGED, AND TEMPLATE ARGS KEEP THEIR BRACKETS [B-189]
- [x] TC-2109: Template arguments keep their brackets.
- [x] TC-2110: A pasted definition is flagged, not eaten.
- [x] TC-2111: Clicking away keeps the text.
- [x] TC-2112: `using` alone is flagged too.
- [x] TC-2113: A valid instantiation is NEVER flagged.
- [x] TC-2114: Bracket handling is unchanged.

## 103. LAST USED STYLE — THE FEATURE, AND THE TWO DEFECTS UNDER IT (v1.8) [B-130, B-178, B-191]

### 103.1 Style Library removal [B-191]
- [x] TC-2115: The field disappears when the library does.
- [x] TC-2116: The metadata survives.
- [x] TC-2117: The Styles tab still works after a delete.
- [x] TC-2118: A deleted library cannot leak into a config.

### 103.2 Auto-populate, both paths [B-178, B-210]
- [x] TC-2119: Preset editor path.
- [x] TC-2120: Sound Font Library path.
- [x] TC-2121: Blade 2 is left alone.
- [x] TC-2122: A style you chose is never overwritten.
- [x] TC-2123: The emitted syntax compiles.
- [x] TC-2124: The rest of the preset survives.
- [x] TC-2125: Slot editor is unchanged.
- [x] TC-2259: Nothing is written when the Style Library is not linked to this config [B-210].
- [x] TC-2260: Linking makes it work again.

### 103.3 The record itself [B-130]
- [x] TC-2126: The link updates on edit, not only on save.
- [x] TC-2127: A stale name reads as broken.
- [x] TC-2128: A stale name is never auto-applied.
- [x] TC-2129: Write-back matches what is in the config.
- [x] TC-2130: NOT YET RUN — backup / restore ride-through.

### 103.4 Known narrowings — confirm these are acceptable, they are not bugs [B-130]
- [x] TC-2131: A multi-font preset.
- [x] TC-2132: Only blade 1 is ever recorded.

## 104. PLATFORM VERIFICATION — things only a real machine can answer [B-047, B-048, B-050, B-051, B-054]

### 104.1 Windows — first-run window position [B-047]
- [x] TC-2133: First-run window position.

### 104.2 Windows — Start Menu icon refresh [B-048]
- [x] TC-2134: : Start Menu icon refreshes after an upgrade. Verified in code: `build/installer.nsh:8` calls `SHChangeNotify` with `SHCNE_UPDATEITEM` on the exe path.

### 104.3 Linux — Wayland session [B-050]
- [x] TC-2135: Wayland session smoke test.

### 104.4 macOS — port detection latency [B-051]
- [x] TC-2136: Port detection latency with a real board.
- [x] TC-2136b: If — and only if — TC-2136 shows a lag.

### 104.5 macOS — dfu-suffix on Apple Silicon [B-054]
- [x] TC-2137: dfu-suffix on non-Rosetta Apple Silicon.

## 105. STYLE LIBRARY: NO-RESULTS EMPTY STATE, AND AUTO-CLEAR AFTER DELETE [B-156]
- [x] TC-2138: A search matching nothing explains itself.
- [x] TC-2139: The escape hatch works.
- [x] TC-2140: Delete the last match of an active filter.
- [x] TC-2141: A typed search that matches nothing must NOT auto-clear.
- [x] TC-2142: Tag and effect filters get the same treatment.
- [x] TC-2143: Regression — a search WITH matches is untouched.
- [x] TC-2144: Regression — an empty library still reads correctly.

### 105.1 The active-query chip [B-156]
- [x] TC-2145: The typed query appears as a chip.
- [x] TC-2146: The chip's x clears only the search.
- [x] TC-2147: The chip tracks live typing.
- [x] TC-2148: A query with markup in it is not interpreted.
- [x] TC-2149: Clear all still governs everything.

## 106. OS VERSIONS: A DEFAULT YOU CAN SET, AND A SIDEBAR THAT KNOWS WHEN TO LEAVE [B-080, B-197, B-183]
- [x] TC-2150: The star only exists when there is a choice.
- [x] TC-2151: The untouched pick is now visible.
- [x] TC-2152: Clicking a hollow star sets it.
- [x] TC-2153: It survives a restart.
- [x] TC-2154: The payoff — a new config uses it.
- [x] TC-2155: A config with no OS version recorded at all.
- [x] TC-2156: A stale star degrades, it does not overwrite.
- [x] TC-2157: Clicking a star must not eat unsaved notes.
- [x] TC-2158: One version installed — no stars anywhere.

### 106.1 The sidebar appears only when there is something to choose [B-197]
- [x] TC-2159: Zero versions installed.
- [x] TC-2160: Exactly one version installed.
- [x] TC-2161: Import a second version from the one-version state.
- [x] TC-2162: Nothing became unreachable.
- [x] TC-2163: The OS Version dropdown offers no dead row.
- [x] TC-2164: The empty label reads as an absence.

### 106.2 A version mismatch names the trees that match [B-183]
- [x] TC-2165: The matching trees are named.
- [x] TC-2166: No matching tree says so.
- [x] TC-2167: An unread map produces no sentence at all.
- [x] TC-2168: Regression — no board, no line.
- [x] TC-2170: A board and a tree that agree must not read as a mismatch.
- [x] TC-2169: Regression — the tooltip does not restate itself.

## 107. THE OS VERSION SIGNAL STOPS SUBSTITUTING [B-183]
- [x] TC-2171: A config asking for a version you don't have selects NOTHING.
- [x] TC-2172: Compile refuses.
- [x] TC-2173: Flash refuses even when a build is cached.
- [x] TC-2174: No cache hit is even attempted.
- [x] TC-2175: Saving does NOT erase the request.
- [x] TC-2176: Installing the missing version resolves it, with no restart.
- [x] TC-2177: Install it, then delete it again — the note comes BACK.
- [x] TC-2178: An install does not steal a selection you made.
- [x] TC-2179: Opening another config clears the state.
- [x] TC-2180: Regression — a config naming NO version still gets the starred default.

### 107.1 Reading the board, and saying only what is known [B-183]
- [x] TC-2181: Version detection works WITHOUT a reset.
- [x] TC-2182: The build timestamp appears, and says "built".
- [x] TC-2183: No line says the same thing twice.
- [x] TC-2184: When they differ, both lines show.
- [x] TC-2186: The app says WHY it could not read the board.
- [x] TC-2187: A failed read is retried, not latched.
- [x] TC-2188: Closing the Serial Monitor re-reads the board.
- [x] TC-2189: Regression — flashing with the Serial Monitor open still works.
- [x] TC-2190: Flashing against a port another program holds names the cause and the action.
- [x] TC-2185: Regression — the matching case is silent.

## 108. SOUND FONTS — BULK CRAWL AND IMPORT [B-118]
- [x] TC-2191: The crawl finds fonts nested at different depths.
- [x] TC-2192: It stops descending once it identifies a font.
- [x] TC-2193: Non-font folders are ignored.
- [x] TC-2194: The review screen is editable before anything is imported.
- [x] TC-2195: A font already in your library is marked as a duplicate.
- [x] TC-2196: Name clash auto-suffixes rather than blocking.
- [x] TC-2197: Two copies of the same font inside one crawl both import.
- [x] TC-2198: Cancel mid-crawl leaves nothing half-done.
- [x] TC-2199: Cancel mid-import.
- [x] TC-2200: A large crawl is not blocked by the modal queue.
- [x] TC-2201: Regression — the failure paths in 72.2 still behave.

## 109. BUILD CACHE: ONE ENTRY CAN BELONG TO SEVERAL CONFIGS [B-207]
- [x] TC-2202: A fresh compile records its config.
- [x] TC-2203: A second config sharing the entry gets appended.
- [x] TC-2204: No duplicates.
- [x] TC-2205: An entry written before this upgrades cleanly.
- [x] TC-2206: A config with no id does not corrupt the entry.
- [x] TC-2208: Save As claims the build it inherits.
- [x] TC-2209: Save As with nothing cached is a silent no-op.
- [x] TC-2210: Save As does not re-restore.
- [x] TC-2207: Regression — nothing else changed.

## 110. SOUND FONTS - IMPORT FROM A PURCHASE LINK [B-086]

### The resolver (headless)
- [x] TC-2211: Dropbox file link.
- [x] TC-2212: Dropbox folder link.
- [x] TC-2213: `dl=0` is rewritten.
- [x] TC-2214: HTML page with a download button.
- [x] TC-2215: Tracking wrappers dissolve.
- [x] TC-2216: Depth cap. A link that redirects in a loop stops rather than hanging.

### Failing honestly
- [x] TC-2217: A login page is named as a login page.
- [x] TC-2218: A pointer file with no link inside.
- [x] TC-2219: Nonsense input.
- [x] TC-2220: The manual fallback is always reachable.

### The browser tier
- [x] TC-2221: Browser fallback appears only when it can help.
- [x] TC-2222: Gated vendor via the visible window.
- [x] TC-2223: A captured pointer file re-peels.
- [x] TC-2224: Cancel is clean.

### Progress and cleanup
- [x] TC-2225: Honest progress on a large download.
- [x] TC-2226: Temp file is removed.
- [x] TC-2227: A link import does not offer to keep the source zip.

### Not built on purpose

### Governor and regression
- [x] TC-2233: No bulk path exists.
- [x] TC-2234: Regression - the other two import paths.

## 111. SOUND FONTS - BACKUP AND RESTORE CARRY PROOF-OF-PURCHASE ATTACHMENTS [B-105]

### Export
- [x] TC-2235: The store is in the archive.
- [x] TC-2236: The links are in the archive.
- [x] TC-2237: One receipt, two sources, stored once.
- [x] TC-2238: The pre-export numbers include it.
- [x] TC-2239: A library with no attachments is unchanged.

### Restore - Replace
- [x] TC-2240: Round trip into an empty app.
- [x] TC-2241: Replace really replaces.
- [x] TC-2242: The many-to-one link survives.

### Restore - Merge
- [x] TC-2243: Merge does not duplicate what you already have.
- [x] TC-2244: Merge brings in what is new.
- [x] TC-2245: Same source, different lists, nothing lost.
- [x] TC-2246: The merge survey tells you first.

### Backward compatibility, and the damage this fixes
- [x] TC-2247: An old backup restores cleanly.
- [x] TC-2248: The dangling id, which is today's actual bug.
- [x] TC-2249: An orphan attachment is not garbage.
- [x] TC-2250: An interrupted restore does not leave a half-store.

### Why this is 1.8 and not later
- [x] TC-2251: The uninstall flow's backup carries attachments.

## 94. CARRIED FORWARD FROM v1.7.2 (original TC numbers kept)
- [x] TC-1900: In-app update 1.7.1 → 1.7.2.
- [x] TC-1901: Board detection with no Proffieboard platform in the system tree.

## 112. THE BUILD FOLDER HAS ONE WRITER [B-216, B-196]
- [x] TC-2261: A cache check writes nothing.
- [x] TC-2262: A cache-hit flash never touches the build folder.
- [x] TC-2263: Two configs, back to back.
- [x] TC-2264: DFU / bootloader mode still flashes.
- [x] TC-2265: Save As still claims its build
- [x] TC-2266: A build that could not be stored is still flashable.
- [x] TC-2267: That build survives an unrelated flash, and only that.
- [x] TC-2268: Editing invalidates.

## 113. EXPORT TO A CHOSEN FOLDER AUTO-NUMBERS INSTEAD OF REFUSING [B-217]
- [x] TC-2269: First export is unchanged.
- [x] TC-2270: Second export lands as `_1`, and the first is untouched.
- [x] TC-2271: Third export lands as `_2`.
- [x] TC-2272: A library entry name collision still REFUSES, and must.

## 114. FOLLOWER BLADES - ONE BLADE TAKES ITS STYLE FROM A LOWER ONE [B-219]

### The turn-on dialog - scope decides which dialog appears
- [x] TC-2273: Every preset already matches - no dialog at all.
- [x] TC-2274: Some presets differ - a three-button QUESTION.
- [x] TC-2275: No preset matches - a two-button CONFIRMATION, and NO toast.
- [x] TC-2276: Blanks and `StylePtr<Black>()` do not count toward "everything".
- [x] TC-2277: Replace All reports a count, and one undo takes it all back.
- [x] TC-2278: Keep Existing still fills the empties, and says so.
- [x] TC-2279: Cancel writes nothing and restores the control.

### The control - three states, and a selection that has to be made
- [x] TC-2280: Ticking Follow on B3 writes NOTHING until a target is chosen.
- [x] TC-2281: On B2 the tick commits immediately.
- [x] TC-2282: The checkbox reports THIS preset, not the declaration.
- [x] TC-2283: Checking the box on an overridden preset restores THAT preset only.
- [x] TC-2284: Unchecking is GLOBAL, and the tooltip says so before the click.
- [x] TC-2285: Changing the dropdown retargets every preset.

### What the tile shows
- [x] TC-2286: A following slot is muted; overriding un-mutes it as you type.
- [x] TC-2287: Hovering a resting followed tile swaps its content for the reason.
- [x] TC-2288: Opening a followed tile shows the two-line banner and stays muted.
- [x] TC-2289: Typing through the banner works.
- [x] TC-2290: Scanning the preset list shows which presets are customised.

### Propagation, chains and structure
- [x] TC-2291: Editing the target writes its followers in the SAME preset and nowhere else.
- [x] TC-2292: A chain propagates down, and an overridden link stops it.
- [x] TC-2293: Disabled presets are included.
- [x] TC-2294: Deleting a followed blade removes it everywhere it is over-count, and reports the pairs it killed.
- [x] TC-2295: B1 never offers the control.

## 115. GLOBAL BLADE REORDER - A BLADE'S POSITION IS ITS IDENTITY [B-220]
- [x] TC-2296: A drag moves the blade in EVERY preset, including disabled ones.
- [x] TC-2297: Blade names travel with the blade, not with the slot.
- [x] TC-2298: A follow pair renumbers when an unrelated blade moves past it.
- [x] TC-2299: A reorder that would INVERT a pair drops it and says so.
- [x] TC-2300: Reorder, then edit the source.
- [x] TC-2301: Duplicate a preset that contains followers.
- [x] TC-2302: Drop NUM_BLADES while a follow pair exists.

## 116. THE EXCESS SLOT TILE IS NOT A DELETE BUTTON [B-226]
- [x] TC-2303: Clicking an excess tile body opens the editor and deletes nothing.
- [x] TC-2304: The `×` still deletes an excess slot.
- [x] TC-2305: The `×` on a correct-count slot RESETS rather than deletes.
- [x] TC-2306: An excess tile still cannot be DRAGGED.

### Collapse - deleting any slot while a preset is over-count
- [x] TC-2307: The middle slot can go, and the rest move up.
- [x] TC-2308: Deleting slot 1 is allowed.
- [x] TC-2309: Presets already at `NUM_BLADES` are left alone.
- [x] TC-2310: Disabled presets collapse too.
- [x] TC-2311: SCOPE IS A QUESTION with two real answers.
- [x] TC-2312: This Preset touches exactly one preset.
- [x] TC-2313: This Preset writes NOTHING but the edit - no toast at all - and the follow consequence is in the DIALOG.
- [x] TC-2314: All N Presets does the full renumber.
- [x] TC-2315: One over-count preset means no question and no toast.
- [x] TC-2316: The loss count appears in the question when real styles would go.
- [x] TC-2317: Labels come with the blade.
- [x] TC-2318: Follow pairs - all three shapes, in one config if possible.
- [x] TC-2319: A chain drops one pair and renumbers another in a single delete.
- [x] TC-2320: Undo takes everything back in one step.
- [x] TC-2321: The `×` reverts to reset once the count is correct.

### The dialog and the toast - rewritten 2026-08-29 during the dev pass
- [x] TC-2349: The scope dialog names TWO operations.
- [x] TC-2350: The authored sentence appears only when authored styles are at stake, and it counts EVERY over-count preset.
- [x] TC-2351: The toast names the dropped follow pairs, and never names the target twice.
- [x] TC-2352: The toast says NOTHING about the pair when the FOLLOWER is what was deleted.
- [x] TC-2353: A dialog with nothing to add under its title shows no empty gap.
- [x] TC-2354: Removing the `// @jmt-follow` line does not steal the blank line above the presets.
- [x] TC-2355: Nothing in this feature calls it deleting a BLADE except the global path.

## 117. SAFE EJECT ON EXPORT — offered, never forced [B-184 + B-088 first slice]
- [x] TC-2322: Removable destination offers the eject.
- [x] TC-2323: NEVER AUTOMATIC.
- [x] TC-2324: Non-removable destination offers nothing.
- [x] TC-2325: The persisted checkbox.
- [x] TC-2326: The escape hatch on the complete dialog.
- [x] TC-2327: A failed eject says so.
- [x] TC-2328: Eject means flushed.
- [x] TC-2329: Platform absence is honest.

## 118. EXECUTABLES NEVER COME IN — content, not extension [B-214]

### 118.1 The SD card path — the real use case
- [x] TC-2330: An executable at the CARD ROOT is reported.
- [x] TC-2331: An executable inside a font folder is reported.
- [x] TC-2332: Import still succeeds, minus the file.
- [x] TC-2333: No override on this path.

### 118.2 Content, not extension — the part that makes it a check rather than a filter
- [x] TC-2334: A renamed executable is caught.
- [x] TC-2335: A real sound is not flagged.
- [x] TC-2336: An extension we do not model is judged on content.
- [x] TC-2337: The wording never claims safety.

### 118.3 Folder import — nothing to decide, it should just be absent
- [x] TC-2338: Folder import omits it with no prompt.

### 118.4 Zip import — the off case: warn strongly, default refuse, override allowed
- [x] TC-2339: The warning is strong and the default is refuse.
- [x] TC-2340: Taking the default leaves nothing behind.
- [x] TC-2341: The override works and keeps the archive byte-identical.

### 118.5 The outbound half — do not write one back out
- [x] TC-2342: Export never carries one to a card.

## 119. THE EXPORT THAT HAD NOTHING TO DO — a hang with no way out [B-204]
- [x] TC-2343: THE REGRESSION CASE. Export the same fonts to the same folder twice, tracks unchecked.
- [x] TC-2344: The summary is in front, not behind.
- [x] TC-2345: No flash on the transition.
- [x] TC-2346: "Card left as it was."
- [x] TC-2347: The other two summary paths still work.
- [x] TC-2348: Selection behaviour survives.

## 120. THE CARD SUMMARY COUNTS SUBFOLDER-LAYOUT FONTS [B-042]
- [x] TC-2356: The two surfaces agree.
- [x] TC-2357: Subfolder layouts are counted.
- [x] TC-2358: Flat layouts are unchanged.
- [x] TC-2359: No junk is counted.
- [x] TC-2360: It holds on an unfamiliar card.

## 121. SOUND FONTS — A FILTER THAT MATCHES NOTHING SAYS SO [B-056]
- [x] TC-2361: A truly empty library
- [x] TC-2362: A search with no matches KEEPS the query
- [x] TC-2363: Clear filters clears everything
- [x] TC-2364: Deleting the last filtered match auto-clears.
- [x] TC-2365: The auto-clear is armed by the DELETE, not by emptiness.
- [x] TC-2366: A delete that leaves matches behind changes nothing.

## 122. LIBRARY BACKUP KNOWS IDENTICAL BY CONTENT, NOT BY SIZE [B-091]
- [x] TC-2367: The manifest carries hashes.
- [x] TC-2368: Identical is decided by hash.
- [x] TC-2369: Metadata edits do not change identity.
- [x] TC-2370: An old backup still restores.
- [x] TC-2371: Replace skips the directory-set check when hashes are present
- [x] TC-2372: Same bytes under a different name.

## 123. THE COMMON FOLDER SIDECAR [B-121]
- [x] TC-2373: An imported common lands in the sidecar
- [x] TC-2374: Rename, duplicate and delete
- [x] TC-2375: The file tree lists the wavs
- [x] TC-2376: The default star is mutually exclusive.
- [x] TC-2377: The missing-common banner is delta-driven.
- [x] TC-2378: Bulk Save writes the default common
- [x] TC-2379: A common is never reported as a missing FONT.
- [x] TC-2429: Importing a common whose name is taken proposes `<name>_1`
- [x] TC-2433: Right-click Export on a common produces a named zip, not a card layout.
- [x] TC-2434: The exported zip is indistinguishable from a vendor pack, and round-trips.
- [x] TC-2435: No manifest, and no conflict prompt.
- [x] TC-2436: Cancelling the save dialog says nothing.
- [x] TC-2438: No progress until there is progress, and then it is real.
- [x] TC-2437: Bulk Save to a card is UNCHANGED.
- [x] TC-2432: Installing the same voicepack twice names it `<pack>_1`, not `<pack> (2)`.
- [x] TC-2430: A non-colliding import keeps its own name.
- [x] TC-2431: The collision retry helps rather than repeats.

## 124. WHICH COMMON THIS CONFIG USES [B-122]
- [x] TC-2380: It lives in the meta-bar
- [x] TC-2381: It hides when it has nothing to say
- [x] TC-2382: A saved name that is not in the library shows as a red ghost option
- [x] TC-2383: The selection round-trips.
- [x] TC-2384: Stripping JMT lines removes the marker cleanly
- [x] TC-2385: A config that references `;common` but has no saved marker
- [x] TC-2439: The control hides when the config does not use a common
- [x] TC-2440: It still shows when the PROP requires a voice pack
- [x] TC-2441: Saving a config that needs no common strips `@jmt:common` from the file.
- [x] TC-2442: A config that DOES need one keeps its marker across save and reopen.

## 125. A FOLDER IMPORT BECOMES A ZIP SOURCE [B-131]
- [x] TC-2386: A picked folder becomes a zip source.
- [x] TC-2387: Re-importing the same folder dedups.
- [x] TC-2388: Determinism. Two imports of byte-identical content produce the same source identity hash.
- [x] TC-2389: Noise is excluded
- [x] TC-2390: A real change is detected.
- [x] TC-2391: Old folder-format sources still work.
- [x] TC-2392: The zip pass is visible.

## 126. LINKS CAPTURED WHILE IMPORTING [B-136]
- [x] TC-2393: The source panel has both fields.
- [x] TC-2394: Link becomes the source default.
- [x] TC-2395: Each candidate row has a chain icon
- [x] TC-2396: The chain is a toggle, not a commit.
- [x] TC-2397: A carried demo URL is visible when collapsed
- [x] TC-2398: Smart paste, and its one refusal.
- [x] TC-2399: A clipboard that is empty, inaccessible or not a URL
- [x] TC-2400: The URL lands on the entry.

## 127. THE EFFECTS CATALOG IN THE ENTRY DETAIL [B-141]
- [x] TC-2401: A chip per detected effect.
- [x] TC-2402: A chip auditions its effect.
- [x] TC-2403: Utility effects appear too
- [x] TC-2404: The grid filter facet works in both polarities.
- [x] TC-2405: Grid cards carry effect chips
- [x] TC-2406: A sparse font still displays.

## 128. COMPILE ON A CONFIG THAT WAS NEVER SAVED [B-198]
- [x] TC-2407: Compile is offered on a new config.
- [x] TC-2408: The prompt names the real problem, with only the buttons that mean something.
- [x] TC-2409: Save asks for a name.
- [x] TC-2410: Save As is absent, not merely redundant.
- [x] TC-2411: Cancelling the picker bails the compile.
- [x] TC-2412: Cancel on the prompt bails.
- [x] TC-2413: A BLANK new config behaves the same as a template one.
- [x] TC-2414: Regression — nothing open still refuses.
- [x] TC-2415: Regression — a saved config with edits is unchanged.
- [x] TC-2416: Close prompt on a never-saved config.
- [x] TC-2417: New-config prompt on a never-saved config.
- [x] TC-2418: Regression — a SAVED file keeps Save As everywhere.
- [x] TC-2419: The unrelated caller is unaffected.

## 129. OPEN ASKS ABOUT A SWITCH THAT HAS NOT BEEN CHOSEN YET [B-240]
- [x] TC-2420: Cancelling the picker asks nothing.
- [x] TC-2421: Choosing a file asks in the right order.
- [x] TC-2422: Cancelling the prompt keeps the current file.
- [x] TC-2423: Discard now means what it says.
- [x] TC-2424: A clean config is unaffected.
- [x] TC-2425: The other switch paths are unchanged.

## 130. "CANCEL" ON AN OFFER THE USER NEVER STARTED [B-241]
- [x] TC-2426: The decline button reads "Not now".
- [x] TC-2427: Declining behaves exactly as before.
- [x] TC-2428: The offer genuinely returns

## 131. CARD IMPORT — THIN FONTS AND STAGED-ZIP CLEANUP [B-247]
- [x] TC-2443: Cancelling the bulk-import summary leaves no staged zips behind.
- [x] TC-2444: A partial import discards only what it did not commit.
- [x] TC-2445: A folder whose only audio is `font.wav` imports as a font.
- [x] TC-2446: A bundle root that happens to contain a stray `font.wav` still yields its children.
- [x] TC-2447: The single-font import modal agrees with the bulk path.

## 132. A FULLY-SKIPPED CREATOR STARTS COLLAPSED [B-249]
- [x] TC-2448: A creator whose every font is skipped opens collapsed.
- [x] TC-2449: A creator with even one importable font stays open
- [x] TC-2450: Collapse is initial state only.

## 133. COMPILE METRICS COUNT WHAT WAS ACTUALLY BUILT [B-017]
- [x] TC-2451: A comment-only edit does not change `activeBytes`.
- [x] TC-2452: Commenting out styles drops `styleCount` and `activeBytes` together.
- [x] TC-2453: The metrics and the cache key cannot drift apart.

## 134. A HEALTHY CARD THAT HOLDS A DEAD FILE [B-042 item 3]
- [x] TC-2454: A finding is reported beside the health line, not instead of it.
- [x] TC-2455: A clean scan says nothing at all.
- [x] TC-2456: A card with a volume warning is unaffected.
- [x] TC-2457: The card modal still opens promptly.

## 135. CLEAR COLLAPSES THE BUILD OUTPUT PANEL [B-253]
- [x] TC-2458: "clear" empties the Build Output panel and closes it.

## 136. HEAR A FONT BEFORE IMPORTING IT [B-257]
- [x] TC-2459: Candidate rows carry play chips.
- [x] TC-2460: A second click stops it.
- [x] TC-2461: A zip-sourced candidate plays without extracting.
- [x] TC-2462: A candidate missing an effect shows no chip for it.

## 137. CORRUPTION: INSPECT, AND IMPORT WITHOUT THE BAD FILES [B-262]
- [x] TC-2463: A font with one damaged file still imports, minus that file.
- [x] TC-2464: Cluster padding is NOT corruption.
- [x] TC-2465: A truly corrupt file is caught.
- [x] TC-2466: The SD browser marks corrupt rows

## 138. ADOPT: TAKE THE CARD'S NAME ONTO THE COPY YOU ALREADY OWN [B-246]
- [x] TC-2467: Adopt renames the library copy, immediately.
- [x] TC-2468: The field drives it, not the card's filename.
- [x] TC-2469: Undo puts the field back to the CARD's name, and Adopt returns.
- [x] TC-2470: Undo always returns to the name the screen opened with.
- [x] TC-2471: Adopting twice without undoing does not lose the way back.
- [x] TC-2472: A name another library track holds DISABLES Adopt, with the reason on hover.
- [x] TC-2473: A name another row in this import is arriving under also disables it.
- [x] TC-2474: Adopt is hidden when the names already match
- [x] TC-2475: If the library listing cannot be read, Adopt stays DISABLED.
- [x] TC-2476: A card duplicate that is ALSO in your library: adopt one, the twin is still adoptable.
- [x] TC-2477: A duplicate whose twin is only on the card gets NO Adopt button.
- [x] TC-2478: The .wav extension cannot be typed or deleted.

## 139. CORRUPTION IS RED WHEREVER IT APPEARS [B-282]
- [x] TC-2479: The card summary's file-corruption flag is RED
- [x] TC-2480: A green card dot beside red corruption text is CORRECT, not a conflict.
- [x] TC-2481: Both themes. The red comes from --c-danger-text, so it differs per theme.

## 140. RIGHT-CLICK IMPORT ON A CARD FOLDER TELLS THE TRUTH [B-280]
- [x] TC-2482: A Proffie font folder offers Import to Sound Font Library.
- [x] TC-2483: A folder of loose wavs offers Import as shared tracks
- [x] TC-2484: A folder that is neither shows a DISABLED line saying so
- [x] TC-2485: Do not fix this by removing the menu item.
- [x] TC-2486: A corrupted font still says fix the damaged file(s) first
- [x] TC-2487: A `common` folder is named as one
- [x] TC-2488: No action is offered before the folder has been read.
- [x] TC-2489: Right-click two folders quickly and the SECOND wins.
- [x] TC-2490: The font test is the shared one.

## 141. IMPORTING A TRACKS FOLDER ON ITS OWN [B-281]
- [x] TC-2491: It opens the SAME review, scoped to that one folder
- [x] TC-2492: The modal appears immediately, with a progress bar while the wavs are hashed.
- [x] TC-2493: The Review button is present and opens the list.
- [x] TC-2494: The tracks section is EXPANDED here.
- [x] TC-2495: No font chrome.
- [x] TC-2496: A font import opened afterwards has its FONT copy back.
- [x] TC-2497: Import commits exactly the checked tracks, under the names shown
- [x] TC-2498: A folder whose tracks you already own still opens.
- [x] TC-2499: The progress bar fills per FILE while tracks copy
- [x] TC-2500: On a full card the bar hands over to the tracks copy.

## 142. EVERY WINDOW WEARS THE JMT ICON [B-259]
- [x] TC-2501: The import-from-link vendor browser shows the JMT logo
- [x] TC-2502: The splash carries the icon too.
- [x] TC-2503: The main window is unchanged.
- [x] TC-2504: macOS still takes its icon from the app bundle.
- [x] TC-2505: A NEW window added later gets the icon by spreading `WINDOW_ICON`.

## 143. A VERSION SUFFIX NO LONGER NEEDS A SEPARATOR [B-171]
- [x] TC-2506: `OldGloryV1` + `OldGloryV2` in one source group as versions.
- [x] TC-2507: `RedSquadron_V1` + `RedSquadron_V2` behave identically to before.
- [x] TC-2508: The whole library is unaffected.
- [x] TC-2509: A board folder is still not a version.
- [x] TC-2510: A versioned folder beside an UNVERSIONED one still does not group.

## 144. AN UNKNOWN DURATION LOOKS UNKNOWN, NOT HALF DONE [B-244]
- [x] TC-2511: Deleting a single font animates.
- [x] TC-2512: Deleting several files from a common folder fills a REAL bar
- [x] TC-2513: A bulk tag update across several fonts does the same.
- [x] TC-2514: Deleting a source with more than one font counts them
- [x] TC-2515: Delete a source with "save a copy first" and the export phase now shows real progress
- [x] TC-2516: The standalone source export is unchanged.
- [x] TC-2517: A determinate bar never keeps the animation.
- [x] TC-2518: The three "Exporting (n of m)" bulk-export steps still work.
- [x] TC-2519: Deleting an 89 MB font with 199 files still shows no percentage

## 145. SAME AUDIO TWICE ON ONE CARD IS ONE DECISION, NOT TWO [B-279]
- [x] TC-2520: Two byte-identical tracks on a card behave as a radio.
- [x] TC-2521: Three or more identical copies behave the same way
- [x] TC-2522: The grey follows the CHECKBOX, not the analyze-time verdict.
- [x] TC-2523: The section master checkbox restores the analyze-time default
- [x] TC-2524: A track already in your library has a DISABLED checkbox
- [x] TC-2525: The two greys are now distinguishable
- [x] TC-2526: FONTS still allow the duplicate.

## 146. A FONT YOU FULLY OWN READS AS OWNED, NOT AS A VARIANT [B-025]
- [x] TC-2527: A strict subset of an owned font reads GREEN, "Already in your library", and unchecks itself.
- [x] TC-2528: The row is still re-checkable
- [x] TC-2529: The DIRECTION guard still holds.
- [x] TC-2530: A low-confidence match is still never claimed as owned.
- [x] TC-2531: Nothing else in the library moved.
- [x] TC-2532: The Leia off-by-one is NOT this bug and is not fixed by it.

## 147. A STYLE NAME HAS TO BE A NAME C++ CAN USE [B-157]
- [x] TC-2533: Add Style refuses an invalid name.
- [x] TC-2534: Rename refuses the same way
- [x] TC-2535: Closing with an invalid name offers only Discard and Cancel.
- [x] TC-2536: Save stays disabled on a pristine modal.
- [x] TC-2537: Space and hyphen still convert silently
- [x] TC-2538: Copy Style yields a bare expression.
- [x] TC-2539: A library that already holds a mangled name repairs on rename.
- [x] TC-2540: A DERIVED name is sanitized, never refused, and this must stay true.

## 148. A STRUCTURAL EDIT DROPS THE OPEN SLOT EDITOR [B-284]
- [x] TC-2541: Delete a preset with its slot editor open
- [x] TC-2542: Disable, then enable, a preset with the editor open
- [x] TC-2543: Reorder presets by dragging
- [x] TC-2544: The × on an over-count preset
- [x] TC-2545: Typing in the slot editor is DISCARDED by a structural edit, and that is correct.
- [x] TC-2546: THE NEGATIVE THAT MATTERS MOST — normal slot editing is untouched.
- [x] TC-2547: Editing the preset name, font or track does not close an open slot editor.
- [x] TC-2548: Undo after any structural edit
- [x] TC-2549: Two tags were deliberately left OUT and are still worth a look
- [x] TC-2550: Enable a disabled preset → that preset is selected and showing.
- [x] TC-2551: Delete the LAST enabled preset while a disabled one sits below it
- [x] TC-2552: Delete a preset in the middle
- [x] TC-2553: Delete the only preset
- [x] TC-2554: Deleting does NOT wrap to the first preset.

## 149. BATCH TAGS AT IMPORT, APPLIED TO EVERY FONT [B-261]
- [x] TC-2555: A tag typed in the guided review's tag bar lands on EVERY font in that batch.
- [x] TC-2556: A tag still typed but not committed to a chip is not lost
- [x] TC-2557: The automatic bundle-name tag survives and is not duplicated.
- [x] TC-2558: A SOLO import gets no automatic bundle tag
- [x] TC-2559: The tag bar is hidden on a tracks-only import.
- [x] TC-2560: Single-source import has no free-text batch tag, and that is the current state.

## 150. FACET DROPDOWNS SAY HOW THEY ARE SORTED [B-285]
- [x] TC-2561: Only the ACTIVE column is blue and carries the arrow.
- [x] TC-2562: Clicking the muted column activates it at its natural default
- [x] TC-2563: Clicking the ACTIVE column flips its direction
- [x] TC-2564: ONE preference, shared by all five.
- [x] TC-2565: It persists across a full app restart.
- [x] TC-2566: Selected-at-top never moves, under any sort.
- [x] TC-2567: The Effects tri-state keeps its own meaning of "selected"
- [x] TC-2568: The bar is STICKY.
- [x] TC-2569: The default is count descending on a fresh profile
- [x] TC-2570: An empty dropdown shows no bar
- [x] TC-2571: A malformed stored value falls back to the default rather than throwing.

## 151. NEW, THE SORT CONTROL, AND FILTERS THAT DO NOT MOVE UNDER YOU [B-213]
- [x] TC-2572: Open its detail view
- [x] TC-2573: Right-click → Add to config.
- [x] TC-2574: Right-click → Replace.
- [x] TC-2575: The sidecar font dropdown
- [x] TC-2576: Export to a card.
- [x] TC-2577: FLASH. Put a NEW font in the config by typing the folder name into the config TEXT (not a picker, or another path stamps it first), confirm it still reads NEW, then flash.
- [x] TC-2578: Opening a config does NOT clear NEW, deliberately.
- [x] TC-2579: On the first launch after upgrading, NEW is EMPTY
- [x] TC-2580: Import a font, restart, and it is STILL NEW.
- [x] TC-2581: Backfilled entries carry `seenAt = createdAt`, not the upgrade time.
- [x] TC-2582: All five orders, each flipping on a second click
- [x] TC-2583: Acquired and Added give visibly DIFFERENT orders.
- [x] TC-2584: Same-import fonts hold a stable order
- [x] TC-2585: The order survives a restart
- [x] TC-2586: With NEW on, opening a font leaves the card IN PLACE.
- [x] TC-2587: Same for Needs review
- [x] TC-2588: A font imported while the filter is on APPEARS.
- [x] TC-2589: Toggling the filter off and on re-asks the question
- [x] TC-2590: "Not in use" is hidden until the in-use filter is engaged
- [x] TC-2591: The reveal is EITHER polarity.
- [x] TC-2592: Counts do not swap
- [x] TC-2593: The active one FILLS rather than tinting blue, and its badge stays grey
- [x] TC-2594: The "Filtering by" strip names the polarity you picked
- [x] TC-2595: NEW appears in the "Filtering by" strip with its own × in green.
- [x] TC-2596: Removing one chip removes ONLY that filter.
- [x] TC-2597: Chip counts are cross-filter.
- [x] TC-2598: Needs review reads "Only fonts with something to confirm."
- [x] TC-2599: Effects chips sit at the BOTTOM of every card

## 152. ONE CONTROL, ONE MEANING, ON THE TRACKS CARD [B-287]
- [x] TC-2600: The grid tracks card no longer shows "Always include with exports"
- [x] TC-2601: The preference still exists and still works
- [x] TC-2602: `tracks ☐` appears inside the Export control
- [x] TC-2603: It overrides in BOTH directions, and neither changes the saved setting.
- [x] TC-2604: Clearing the selection resets the override
- [x] TC-2605: FORCED: open a config that references `tracks/`.
- [x] TC-2606: A deliberate untick suppresses the destination-mismatch prompt.
- [x] TC-2607: The four tooltip states.
- [x] TC-2608: The export summary says nothing extra for a per-run include
- [x] TC-2609: The control reads as ONE button
- [x] TC-2610: Nothing on it is blue, including the checkbox tick

## 153. RECOVERING A BOARD FROM AN INTERRUPTED FLASH [B-271]
- [x] TC-2611: An interrupted flash is named as an interruption, not as a cable fault.
- [x] TC-2612: Stopped-short is detected on its own.
- [x] TC-2613: The board that comes back in DFU recovers with NO user action.
- [x] TC-2614: The board that comes back on a COM port recovers with a plain retry.
- [x] TC-2615: When no port comes back, the route to recovery is discoverable without help.
- [x] TC-2616: The 2.5s DFU probe timeout is CORRECT BEHAVIOUR, not a bug — do not "fix" it.
- [x] TC-2617: The driver is not the cause and must not be re-installed.
- [x] TC-2618: Partial firmware that still boots does not get cable advice.
- [x] TC-2619: A recovered board is fully normal afterwards.

## 154. A BACKUP THAT CARRIES THE PROOF, NOT JUST THE FONTS [B-105]
- [x] TC-2620: Proofs of purchase survive export → restore.
- [x] TC-2621: The display name survives too.
- [x] TC-2622: One receipt linked to several sources is still shared afterwards.
- [x] TC-2623: The pre-backup summary names them, and the completion line matches it.
- [x] TC-2624: A library with no attachments says nothing about them.
- [x] TC-2625: The import preview counts them before you commit.
- [x] TC-2626: Progress names the document, never the hash.
- [x] TC-2627: The counter counts attachments, not files.
- [x] TC-2628: Merge only adds what is missing.
- [x] TC-2629: Merge carries them even for sources you chose to keep.
- [x] TC-2630: An OLD backup restores without leaving ghost links.
- [x] TC-2631: A cancelled merge leaves no half-written attachment.
- [x] TC-2632: Round-trip a real library.

## 155. CURATION SURVIVES A DELETE AND RE-IMPORT [B-283]
- [x] TC-2633: The hand-authored values come back.
- [x] TC-2634: The proof of purchase comes back with it
- [x] TC-2635: An UNCURATED source exports byte-for-byte as before.
- [x] TC-2636: A plain vendor zip imports exactly as it always did
- [x] TC-2637: The sidecar does not become part of the font.
- [x] TC-2638: Two exports with DIFFERENT curation still dedup against each other.
- [x] TC-2639: The review screen still owns the name.
- [x] TC-2640: Your decisions beat the file.
- [x] TC-2641: Bulk import carries it too.
- [x] TC-2642: An SD-card import is unaffected
- [x] TC-2643: A damaged sidecar loses the curation, never the font.
- [x] TC-2644: A folder export carries nothing
- [x] TC-2668: The export chooser is two buttons and one click.
- [x] TC-2669: The "carries your…" clause is accurate, and absent when it should be.
- [x] TC-2667: A SINGLE-FONT SOURCE carries its entry curation.
- [x] TC-2665: EXPORT TO A DIFFERENT DRIVE THAN THE SYSTEM TEMP.
- [x] TC-2666: A failed injection leaves the export intact.
- [x] TC-2645: A cancelled or failed import leaves no temp litter.
- [x] TC-2646: PHASE 2 IS NOT BUILT AND MUST NOT BE IMPLIED.

### 155.1 THE RESTORE LEAVES NO TRACE (added 2026-09-03)
- [x] TC-2670: The dates are the ORIGINAL dates, not today's.
- [x] TC-2671: A restored entry keeps its history.
- [x] TC-2672: But the NEW badge DOES appear.
- [x] TC-2673: The fonts you skipped stay skipped.
- [x] TC-2674: ORIGINAL FILE comes back clean, even from a renamed file.
- [x] TC-2675: Source Name pre-fills from the export, not the filename.
- [x] TC-2676: The file name is NOT user-editable; the Source Name is.

### 155.2 RECOGNISING WHAT YOU ALREADY HAVE (added 2026-09-03)
- [x] TC-2677: Import a curated export while the original is STILL in the library
- [x] TC-2678: After a restore, re-importing the VENDOR'S OWN ZIP is recognised.
- [x] TC-2679: And "Re-import as a new source" still works from that prompt

### 155.3 PROOF OF PURCHASE AT IMPORT TIME (added 2026-09-03)
- [x] TC-2680: A receipt can be attached during the import review
- [x] TC-2681: It can be removed from the review row directly
- [x] TC-2682: Cancelling the import leaves no orphan receipt.
- [x] TC-2683: Deleting a source releases its attachments.
- [x] TC-2684: The export checkbox controls the receipt.
- [x] TC-2685: The checkbox is absent when the source has no attachments.
- [x] TC-2686: Ticking "Export source first" relabels the button to "Export and Delete"

## 156. THE CARD IS A WAY IN FROM THE SOUND FONT LIBRARY [B-245]
- [x] TC-2647: The card route does not disappear once the library has fonts.
- [x] TC-2648: It closes the import modal before opening the card.
- [x] TC-2649: It is the same surface, not a second copy.
- [x] TC-2650: The hero button follows where you came FROM.
- [x] TC-2651: The Config Manager path is the regression risk
- [x] TC-2652: The empty state still offers both links
- [x] TC-2653: Spacing: the two links read as one block.
- [x] TC-2654: No card connected
- [x] TC-2655: Two cards connected

## 157. STAGED SOURCES DO NOT OUTLIVE THE SESSION THAT MADE THEM [B-298]
- [x] TC-2656: Quit mid-analyze, relaunch, the space is back.
- [x] TC-2657: It does not depend on visiting Sound Fonts.
- [x] TC-2658: A clean quit reclaims it immediately.
- [x] TC-2659: Cancel still works as it always did
- [x] TC-2660: A REAL SOURCE IS NEVER TOUCHED.
- [x] TC-2661: A LONG ANALYZE IS NOT SWEPT WHILE IT RUNS.
- [x] TC-2662: Nothing else changed about orphan cleanup.
- [x] TC-2663: An empty or absent sources folder is a silent no-op
- [x] TC-2664: A source staged but not yet MARKED is still cleared.

## 158. NO BAR CLAIMS A POSITION NOBODY MEASURED [B-303]
- [x] TC-2687: "+ Add more fonts from source" sweeps.
- [x] TC-2688: "+ Duplicate fonts from source" sweeps
- [x] TC-2689: A real import still shows a REAL bar afterwards.
- [x] TC-2690: Copy / hash / extract phases still report real percentages
- [x] TC-2691: Downloading a ProffieOS version is one continuous sweep
- [x] TC-2692: It ends cleanly
- [x] TC-2693: Cancel during a download leaves no stuck bar

## 159. ONE ELLIPSIS, NO EXTENSIONS IN BUTTONS, WORKING STATES THAT MOVE [B-300]
- [x] TC-2694: "Pick zip file…"
- [x] TC-2695: The voicepack help text quotes that button and matches it.
- [x] TC-2696: "Copying files" animates while a font imports
- [x] TC-2697: And shows THREE dots, not six.
- [x] TC-2698: "Duplicating files" behaves the same
- [x] TC-2699: "Compiling" on the build overlay animates.
- [x] TC-2700: "Scanning…" in the port dropdown does NOT animate, and that is correct.
- [x] TC-2701: Spot-check the mechanical swap

## 160. ATTACHING A FOLDER AS A VERSION OF A FONT [B-304]
- [x] TC-2702: The gate refuses a folder that is not a font.
- [x] TC-2703: A folder that CONTAINS fonts is refused differently
- [x] TC-2704: A real font folder is accepted
- [x] TC-2705: The name in the confirmation is the name that appears.
- [x] TC-2706: Cancel means cancel
- [x] TC-2707: The attach lands the PICKED folder's files, not the source's.
- [x] TC-2708: It joins the SAME source's list
- [x] TC-2709: An EDITED folder shows "Customized" on its new row
- [x] TC-2710: An UNEDITED copy of the same font shows NO marker.
- [x] TC-2711: Details are inherited like a sibling
- [x] TC-2712: The new row opens ready to rename
- [x] TC-2713: A big folder shows a bar that actually moves
- [x] TC-2714: A name already in the library is refused
- [x] TC-2715: Picking a folder that CONTAINS the library is refused.

## 161. A FONT YOU JUST MADE IS NEW TO THE LIBRARY [B-312]
- [x] TC-2716: Duplicate a font you have already opened → the duplicate shows New.
- [x] TC-2717: Duplicate from source shows New
- [x] TC-2718: A font added from a folder shows New
- [x] TC-2719: The ORIGINAL is unchanged
- [x] TC-2720: The New filter count goes up by one
- [x] TC-2721: Opening the new font clears its badge

## 162. EVERY STYLE WRAPPER FORM IS RECOGNISED, NOT JUST StylePtr [B-321]

### Recognition
- [x] TC-2722: A `StyleFirePtr` preset reports its real style count.
- [x] TC-2723: A `StyleRainbowPtr` preset does the same
- [x] TC-2724: The two X variants.
- [x] TC-2725: `ChargingStylePtr` and `StyleStrobePtr`
- [x] TC-2726: Plain `StylePtr` still works.
- [x] TC-2727: The preset ROW in the list.

### The write paths - these are the ones with teeth
- [x] TC-2728: Editing a slot KEEPS its wrapper.
- [x] TC-2729: Same for the X variants and ChargingStylePtr
- [x] TC-2730: A ref slot is untouched.
- [x] TC-2731: A genuinely missing slot still inserts correctly.
- [x] TC-2732: Follower blades still match.

### Paste and Copy Style
- [x] TC-2733: Paste a `StyleFirePtr<...>()` expression into a slot
- [x] TC-2734: Copy Style from a preset built with a non-StylePtr wrapper
- [x] TC-2735: A `using Name = ...;` paste

### The typo case, so the behaviour is on record rather than assumed
- [x] TC-2736: A misspelled wrapper is PRESERVED, not rewritten and not warned about.

## 163. THE BUILD MODAL TITLE ANIMATES ONLY WHILE IT IS WORKING [B-322]

### Working states - these must animate
- [x] TC-2737: Compiling. Start a compile.
- [x] TC-2738: Flashing. During a serial flash the title animates, and shows three dots not six.
- [x] TC-2739: Flashing (DFU).
- [x] TC-2740: Bootloader Mode (DFU)

### Terminal states - these must be still
- [x] TC-2741: Flash Complete.
- [x] TC-2742: Compile Successful
- [x] TC-2743: Compile Failed
- [x] TC-2744: Compile Aborted
- [x] TC-2745: DFU Device Ready

### Waiting on the user - still, deliberately
- [x] TC-2746: Connect Board
- [x] TC-2747: Fix DFU Driver / Fix DFU Access

### The toggle works both ways
- [x] TC-2748: A second compile animates again.
- [x] TC-2749: Compile then flash in one session.
- [x] TC-2750: The driver-install detour returns correctly.

## 164. A PRESET NEVER SHOWS "0", AND ONE CLICK NAMES IT FROM ITS FONT [B-323]

### What is shown
- [x] TC-2751: No preset displays `0`.
- [x] TC-2752: It is visibly a suggestion, not a value
- [x] TC-2753: A suggested name still goes red when its font is missing.
- [x] TC-2754: Selecting the row does not break it
- [x] TC-2755: A preset with a real name is untouched
- [x] TC-2756: A preset named `"1"`, `"2"` or `"29"` keeps its number.
- [x] TC-2757: A preset with no font folder

### Naming for real
- [x] TC-2758: Right-click one unnamed preset → `✎ Name from font`.
- [x] TC-2759: Multi-select several → `✎ Name from font (N)`.
- [x] TC-2760: `✎ Name All from font (N)`
- [x] TC-2761: One Ctrl+Z reverts the whole batch.
- [x] TC-2762: Ctrl+Z works without clicking anything first.
- [x] TC-2763: A name the user chose is never overwritten.
- [x] TC-2764: Neither menu item ever offers to do nothing.
- [x] TC-2765: Font, track and styles are undisturbed
- [x] TC-2766: The written name matches what was shown.
- [x] TC-2767: `Graflex3` stays `Graflex3`

### Editing by hand still works
- [x] TC-2768: Clicking a suggested name opens the editor EMPTY, not prefilled.
- [x] TC-2769: Type a name over a suggestion and confirm
- [x] TC-2770: Escape leaves the config untouched
- [x] TC-2771: Ctrl+V on a selected row

### Deliberately absent
- [x] TC-2772: Typing a letter on a selected preset row does NOT open a rename.

## 165. A SHARED FOLDER CAN BE CALLED ANYTHING [B-326]

### Nothing is falsely reported missing
- [x] TC-2773: No false red.
- [x] TC-2774: The missing-fonts banner has no chip for `MC`.
- [x] TC-2775: A genuinely missing font still shows a chip and still paints red.
- [x] TC-2776: The FONT column and the font combo read `Windu`, not `Windu;MC`.

### The checkbox tells the truth, and fixing it does not break the saber
- [x] TC-2777: The box is TICKED on a `;MC` preset
- [x] TC-2778: Ticking a box never appends a second shared folder.
- [x] TC-2779: Untick then retick restores `;MC` silently
- [x] TC-2780: The label is PER PRESET, not per config.
- [x] TC-2781: A preset declaring nothing
- [x] TC-2782: On a plain `;common` config the label reads `common`

### Swapping a font keeps the shared folder
- [x] TC-2783: Replace the font on a `;MC` preset
- [x] TC-2784: Same on a `;common` preset
- [x] TC-2785: A preset with two shared folders

### Export writes the folder the config actually names
- [x] TC-2786: Export to a card from the `;MC` config creates a folder named `MC`
- [x] TC-2787: The conflict dialog names the real folder.
- [x] TC-2788: The already-present check looks at the same folder it writes.
- [x] TC-2789: A plain `;common` config still exports `common`.
- [x] TC-2790: No config open

### The compile preflight is unchanged
- [x] TC-2791: A `;MC` config raises no voicepack warning
- [x] TC-2792: Strip the `;MC` from some presets

### Ambiguity, recorded as current behaviour rather than as a pass
- [x] TC-2793: With two shared names in the config, writes fall back to `common`.
- [x] TC-2794: With two names, export writes ONE folder, named `common`

## 166. THE CONFIG NAMES THE SHARED FOLDERS, YOU FILL THEM [B-014]

### One field per slot, and none where none is needed
- [x] TC-2795: A `;MC` config shows `MC FOLDER (VOICEPACK)`
- [x] TC-2796: A plain `;common` config is unchanged
- [x] TC-2797: Add `;common` to one preset of the MC config.
- [x] TC-2798: Type a name one character at a time.
- [x] TC-2799: Five or more slots
- [x] TC-2800: A config declaring no shared folder shows no field at all
- [x] TC-2801: A config declaring slots with a completely empty library
- [x] TC-2802: Fonts but no common folders

### Assignments persist, and clean up after themselves
- [x] TC-2803: Save and look at the file.
- [x] TC-2804: Reopen — every assignment comes back on the right field.
- [x] TC-2805: A slot you removed leaves nothing behind.
- [x] TC-2806: An old config still loads.
- [x] TC-2807: Nothing is written just because a control drew.

### Rename and merge
- [x] TC-2808: A lone non-`common` slot offers `Rename to "common"`.
- [x] TC-2809: The options are styled like the OS Version sentinels
- [x] TC-2810: One Ctrl+Z reverts the whole rename
- [x] TC-2811: The select snaps back
- [x] TC-2812: Rename to a name that does not exist yet carries the pack across.
- [x] TC-2813: Merge into a slot holding the SAME pack
- [x] TC-2814: Merge into a slot holding a DIFFERENT pack
- [x] TC-2815: A preset holding both names

### Duplicates
- [x] TC-2816: Point two slots at the same pack.
- [x] TC-2817: The open list is NOT all red.
- [x] TC-2818: Changing one field clears the red on ANOTHER.
- [x] TC-2819: Two slots with nothing assigned

### Export
- [x] TC-2820: A `;MC` config writes an `MC` folder to the card
- [x] TC-2821: Two slots write two folders
- [x] TC-2822: The summary has one line per folder
- [x] TC-2823: The destination font count is right.
- [x] TC-2824: Export twice — the second run recognises what the first wrote rather than offering to create it again, and refreshes each marker.
- [x] TC-2825: Two slots, same pack → a warning before writing.
- [x] TC-2826: A named pack missing from the library
- [x] TC-2827: A plain `;common` config exports exactly as before.

### The prop requirement follows the OS
- [x] TC-2828: Switch 8.10 +JMT → 7.15 with the config untouched.
- [x] TC-2829: Switch back to 8.10 +JMT
- [x] TC-2830: On 7.15 the tooltip falls through to the still-true sentence
- [x] TC-2831: The tooltip branches on TICKED.

## 167. SAY WHAT THE SABER WILL SAY ABOUT A VOICE PACK [B-003]

### The census on screen — all four surfaces per config
- [x] TC-2832: `vpk_bc_saber.h` — all surfaces ON.
- [x] TC-2833: `vpk_bc_blaster.h` — all surfaces ON.
- [x] TC-2834: `vpk_sa22c_menuspec.h` — all surfaces ON.
- [x] TC-2835: `vpk_noprop_menuspec.h` — all surfaces ON.
- [x] TC-2836: `vpk_sa22c_quiet.h` — every surface SILENT.
- [x] TC-2837: Fett-family configs unchanged

### The version flag itself
- [x] TC-2838: A no-ini pack reads `(version 1)`
- [x] TC-2839: Selecting it turns the field red
- [x] TC-2840: All-V2 packs are never annotated and never red.
- [x] TC-2841: Switch to 7.15

### Attribution — the message names what registered it
- [x] TC-2842: On the two menuspec fixtures
- [x] TC-2843: On fett/BC configs

### The export gate, now reachable
- [x] TC-2844: Export with a non-V2 pack selected fires the version dialog
- [x] TC-2845: The dialog copy states only what is known

### The download picker
- [x] TC-2846: The version note follows the selection.
- [x] TC-2847: The note and the V1 tooltip name the real triggers

## 168. THE CLOSE-OUT SAYS WHAT STUDIO SAVED YOU [B-317]
- [x] TC-2848: Zip import above the gate: the three numbers reconcile.
- [x] TC-2849: Folder import above the gate says "folder".
- [x] TC-2850: Link import above the gate says "download"
- [x] TC-2851: Below the gate: silence.
- [x] TC-2852: A zip that expands more than it shares shows no negative or nonsense saving
- [x] TC-2853: Everything already owned: "added nothing new on disk".
- [x] TC-2854: A multi-font package says "this font package"
- [x] TC-2855: The bulk summary speaks the same sentence, pluralized.
- [x] TC-2856: Bulk noun handles the shapes
- [x] TC-2857: Bulk brag gate matches the close-out.
- [x] TC-2858: The bulk summary reassures and never suggests deleting.

## 169. ENTRIES LINK TO CANONICAL NAMES, SO DEDUP RUNS FIRST [B-334]
- [x] TC-2859: On-disk pooling after a multi-variant import.
- [x] TC-2860: The phase order is visible
- [x] TC-2861: Bulk import same invariant
- [x] TC-2862: Free-space sanity

## 170. DELETE FIRES THE DELETE BUTTON [B-336] (amended [B-405] 2026-09-17)
- [x] TC-2863: Delete with a selection opens the confirm
- [x] TC-2864: The search box wins
- [x] TC-2865: Modals win: with a selection, open any modal (or the SD card browser) and press Delete → nothing fires underneath.

## 171. COMMONS ARE SOURCES [B-327]
- [x] TC-2866: A zip common import is source-backed and pooled.
- [x] TC-2867: Same zip again under a new name reuses the source
- [x] TC-2868: The real collection round-trips.
- [x] TC-2869: Delete releases the source safely.
- [x] TC-2870: Cross-bucket both directions
- [x] TC-2871: The sweep never takes an owned source

## 172. TWO SMALL REVIEW/CARD BEHAVIORS [B-331] [B-337]
- [x] TC-2872: [B-331] An all-skipped review opens fully expanded.
- [x] TC-2873: [B-337] SFL-launched card import lands in the library.
- [x] TC-2874: [B-328] The bulk modal waits for the folder.
- [x] TC-2875: [B-328] The picker opens beside the last pick, not on it.
- [x] TC-2876: [B-329] Type a new creator in bulk review.
- [x] TC-2877: [B-329] An existing name reuses its group.
- [x] TC-2878: [B-339] Evening imports are acquired today.
- [x] TC-2879: [B-332] The link import claims the attempt, not the outcome.
- [x] TC-2880: [B-330] The chooser's common row tells the truth.
- [x] TC-2881: [B-340] A different pack wearing the name "common" imports instead of being dropped.
- [x] TC-2882: [B-290] A directly-selected tracks or common folder survives the scan.

## 173. A CUSTOMIZED FONT SURVIVES THE EXPORT CYCLE [B-311]
- [x] TC-2883: The export dialog offers the customized box.
- [x] TC-2884: Both boxes are independent.
- [x] TC-2885: The zip actually holds the edits.
- [x] TC-2886: Re-import shows both truths: stock row unchecked, customized row checked.
- [x] TC-2887: The both-copies case restores both, both visible.
- [x] TC-2888: Delete-with-export-first carries the edits without asking.
- [x] TC-2889: A cancelled import leaves nothing — because nothing landed.
- [x] TC-2890: Import-as-new-source suffixes in the form, not at the crash site.
- [x] TC-2891: [B-342] Empty vendor folders are not customization.
- [x] TC-2892: The both-copies review offers the STOCK name.
- [x] TC-2893: The duplicate door keeps the sidecar.
- [x] TC-2894: The clean round trip, start to finish.
- [x] TC-2895: Customized rows are real rows.
- [x] TC-2896: Unchecking a customized row means it stays gone, and says so.
- [x] TC-2897: A customized-only commit is legal.
- [x] TC-2898: No self-match: a deleted font is not "already in your library".

## 174. FONTLESS IMPORTS ARE STILL IMPORTS [B-349] [B-350] [B-354]
- [x] TC-2899: Tracks-only Review Import actually imports.
- [x] TC-2900: Library hits and card twins are different counts.
- [x] TC-2901: Commons are visible in every chooser branch.
- [x] TC-2902: A lone common has real doors.
- [x] TC-2903: Skip-led summary lines keep their noun.
- [x] TC-2904: Fontless run summaries stay honest elsewhere

## 175. THE LITTLE-ONES BATCH (2026-09-08 midday) [B-341] [B-343] [B-344] [B-345] [B-346] [B-347] [B-351] [B-352] [B-353]
- [x] TC-2905: [B-345] tracks/ never gets the rename prompt.
- [x] TC-2906: [B-353] the shared-tracks review list reads down the columns.
- [x] TC-2907: [B-343] the first copy is _2, everywhere a name is minted.
- [x] TC-2908: [B-347] the tracks card modal takes Ctrl+C / Ctrl+V.
- [x] TC-2909: [B-352] a fontless run moves the bar.
- [x] TC-2910: [B-341] deleting a Customized font says so.
- [x] TC-2911: [B-346] Customized is a COMPUTED tag.
- [x] TC-2911b: [B-346] the tag follows the disk, whoever asked first.
- [x] TC-2912: [B-351] the review's common row.
- [x] TC-2913: [B-344] the missing-style tile inserts INSIDE the preset.
- [x] TC-2914: [B-341] the delete confirm has a visual hierarchy.
- [x] TC-2915: [B-359] +Add menus lead with From library.
- [x] TC-2916: [B-347] blank-space paste in the tracks modal.
- [x] TC-2917: [B-347] file rows lost Paste in the entry browser too.
- [x] TC-2918: [B-347] common tree paste names its destination.

## 176. THE SD HEALTH WALK BREATHES [B-348]
- [x] TC-2919: The card browser opens fast on a big card.
- [x] TC-2923: The single-folder door checks just that folder.
- [x] TC-2924: Collections get offered the right door.

## 177. THREE LITTLE ONES (2026-09-08 night) [B-291] [B-295] [B-307]
- [x] TC-2926: [B-291] a remembered folder on a gone drive falls back quietly.
- [x] TC-2927: [B-295] Cancel says what it costs, per phase.
- [x] TC-2928: [B-295] closing the window mid-import names the cost.
- [x] TC-2929: [B-307] the sort button tells the truth on first open.

## 178. CORRUPTION MOVES TO WHERE THE FILES ARE ALREADY READ [B-361]
- [x] TC-2930: Browsing a card is instant at every depth.
- [x] TC-2931: Clicking Import opens the review with no wait in front of it.
- [x] TC-2932: A damaged font is found by the import’s own read.
- [x] TC-2933: The summary row is RED.
- [x] TC-2934: Importing it anyway leaves the damage behind.
- [x] TC-2935: Quick import skips corrupt fonts entirely.
- [x] TC-2936: A folder from DISK is now checked too.
- [x] TC-2937: The card report no longer claims to have checked files.
- [x] TC-2938: Right-clicking a folder does not throw.
- [x] TC-2939: A solo import of a damaged font is still refused.
- [x] TC-2941: The explainer reads as three jobs, and names damage only when there is some.
- [x] TC-2940: Zip sources are honestly uncovered.

## 179. NOTHING EXECUTABLE REACHES THE LIBRARY [B-214]

### The three tiers
- [x] TC-2942: A program is refused, however it is named.
- [x] TC-2943: The trailing-space evasion.
- [x] TC-2944: A macro-enabled document is refused OFF A CARD.
- [x] TC-2945: The same document is ALLOWED as an attachment.
- [x] TC-2946: An un-inspectable archive is kept and said out loud.

### Where it is reported
- [x] TC-2947: The card report leads with it.
- [x] TC-2948: The buttons take a stance.
- [x] TC-2949: And the stance clears.
- [x] TC-2950: The browser marks the trail.
- [x] TC-2951: The stats screen names each kind.
- [x] TC-2952: The disguise sentence appears only when earned.
- [x] TC-2953: The review row and the summary say what went.

### The parts that are easy to leave out
- [x] TC-2954: A zip, and a zip inside a zip.
- [x] TC-2955: The name on screen is the name on disk.
- [x] TC-2956: An attachment is refused, not stripped.
- [x] TC-2957: Nothing goes back out either.
- [x] TC-2958: The entry remembers.

### The honest limits, which must NOT be reported as bugs
- [x] TC-2959: A shell script or a `.py` is not refused.
- [x] TC-2960: A payload appended behind a valid wav header passes.
- [x] TC-2961: The card report can only see NAMES.

## 180. THE WAY OUT NEEDS THE SAME GUARD AS THE WAY IN [B-214]

### Export
- [x] TC-2962: A full-source FOLDER export carries no program.
- [x] TC-2963: The same holds for a zip source export.
- [x] TC-2964: The export says what it refused to carry, in red.
- [x] TC-2965: Filenames in that message are quoted.
- [x] TC-2966: The exported file COUNT matches what landed.
- [x] TC-2967: A clean source says nothing.
- [x] TC-2968: A macro-only refusal does not talk about programs.

### Per-file export (right-click → Export)
- [x] TC-2969: One file at a time cannot walk past the guard.
- [x] TC-2970: The refusal is not reported as a success.
- [x] TC-2971: Ordinary files still export.

### Preview and open
- [x] TC-2972: A program never reaches the audio decoder.
- [x] TC-2973: A named program explains itself too.
- [x] TC-2974: Nothing is a dead click any more.
- [x] TC-2975: Real files still open.

### What the import review says
- [x] TC-2976: The single-source import review reports what it stripped.
- [x] TC-2977: The disguised count is the disguised count.
- [x] TC-2978: Cancel is the recommended action when anything was refused.
- [x] TC-2979: A clean source looks normal.
- [x] TC-2980: Cancel keeps nothing.

### Names cannot lie in our own lists
- [x] TC-2981: A right-to-left override is stripped everywhere a filename is shown.
- [x] TC-2982: Real names are unaffected.

### Failure reporting
- [x] TC-2983: A failure while drawing the import review does not look like a hang.

### Attachments (verified 2026-09-10, kept as cases)
- [x] TC-2984: A program cannot be attached as a proof of purchase.
- [x] TC-2985: The attachment refusal is a plain statement, not an alarm.
- [x] TC-2986: A macro-enabled document CAN be attached.

### The commons door
- [x] TC-2987: The commons import warns BEFORE it acts.
- [x] TC-2988: Cancel is the recommended button and Import anyway is NOT red.
- [x] TC-2989: Nothing executable lands.
- [x] TC-2990: The disguised one is named as disguised.
- [x] TC-2991: A clean common folder imports silently.
- [x] TC-2992: A picked ZIP is scanned too, without extracting it.
- [x] TC-2993: Cancel leaves the folder alone.

## 181. ONE PREDICATE, THREE KINDS, EVERY DOOR [B-368]
- [x] TC-2994: An unreadable archive does not leave.
- [x] TC-2995: Nor as a folder.
- [x] TC-2996: Nor on a card.
- [x] TC-2997: A macro document does not leave a font.
- [x] TC-2998: But a macro document DOES leave a proof of purchase.
- [x] TC-2999: A plain `.docx` is untouched anywhere.
- [x] TC-3000: A `.zip` is untouched.
- [x] TC-3001: All three kinds in one export produce ONE dialog, one voice.

## 182. NOTHING GETS IN, WHICHEVER DOOR [B-370]
- [x] TC-3002: + Add in a font refuses all three kinds.
- [x] TC-3003: And your originals really are untouched.
- [x] TC-3004: + Add in shared tracks catches a DISGUISED program.
- [x] TC-3005: + Add in a common refuses, and says so properly.
- [x] TC-3006: Add from folder…
- [x] TC-3007: Restoring a backup cannot reintroduce anything.
- [x] TC-3008: Duplicating a common folder does not spread one.

## 183. BACKUP CARRIES NOTHING IT SHOULD NOT [B-369]
- [x] TC-3009: A backup completes and excludes every kind.
- [x] TC-3010: Attachments survive the backup.
- [x] TC-3011: The backup is otherwise complete.
- [x] TC-3012: A clean library backs up unchanged.
- [x] TC-3013: Timing sanity on a real library.

### Behavioural antivirus — run this on a SIGNED build only
- [x] TC-3014: Does a SIGNED release trip behavioural AV?

## 184. EVERY DOOR CONSULTS ONE CONTENT INDEX [B-315]
- [x] TC-3015: + Add files lands a pointer when the library already holds the bytes.
- [x] TC-3016: A genuinely novel added file is stored once and reachable.
- [x] TC-3017: Add from folder gets the same treatment.
- [x] TC-3018: + Add in a common folder consults the same index.
- [x] TC-3019: Copy/paste across locations lands pointers, not copies.
- [x] TC-3020: Add from library, from a source subtree.
- [x] TC-3021: A file inside an inner zip has no on-disk original, and must still land.
- [x] TC-3022: A link never wins over correctness.

## 185. AN ADDED SOUND IS A THING IN YOUR LIBRARY [B-316]
- [x] TC-3023: An added file lives in the pool, not in the font folder.
- [x] TC-3024: An all-novel attached folder pools too.
- [x] TC-3025: The same sound added to two fonts is one file.
- [x] TC-3026: The last user releases it, and nothing before that does.
- [x] TC-3027: Deleting the FILE releases it too, not just deleting the font.
- [x] TC-3028: A borrowed sound survives its source being deleted.
- [x] TC-3029: The pool never silently grows.
- [x] TC-3030: A non-hardlink filesystem must not lose data.

## 186. ONE COPY ACROSS THE WHOLE LIBRARY [B-317]
- [x] TC-3031: The second of a sharing pair costs almost nothing.
- [x] TC-3032: Folder route, same result.
- [x] TC-3033: Three vendors shipping the same card collapse to one.
- [x] TC-3034: Free space is the measurement, and Explorer will disagree.
- [x] TC-3035: Re-importing a source we already hold adds nothing.
- [x] TC-3036: Deleting whichever came first must not strand the other.

## 187. THE CONTENT IS STILL CORRECT AFTER ALL THAT LINKING [B-315] [B-316] [B-317]
- [x] TC-3037: A font plays its own sounds after a heavy sharing import.
- [x] TC-3038: A CUSTOMIZED file does not come back as the vendor's original.
- [x] TC-3039: The Customized marker still reads correctly.
- [x] TC-3040: Export round-trips the real bytes.
- [x] TC-3041: A backup of a pointer-heavy library restores complete.
- [x] TC-3042: An interrupted add leaves no hole.

## 188. A PRESET SHORT OF A BLADE STYLE NEVER REACHES THE COMPILER [B-365]
- [x] TC-3043: The real case blocks, and names the presets.
- [x] TC-3044: The complete presets are not named.
- [x] TC-3045: A valid config is silent.
- [x] TC-3046: "Compile anyway" really compiles.
- [x] TC-3047: OK stops cleanly.
- [x] TC-3048: Fixing it in the app clears it.
- [x] TC-3049: One short preset reads as one.
- [x] TC-3050: Different shortfalls do not claim a shared count.
- [x] TC-3051: A commented-out preset is not counted.
- [x] TC-3052: An unnamed preset is still pointed at.
- [x] TC-3053: A long list truncates honestly.
- [x] TC-3054: Two preset banks: the offending one is named.
- [x] TC-3055: A config with no NUM_BLADES makes no claim.
- [x] TC-3056: The gate does not fire on the flash path.
- [x] TC-3057: Order with the other two gates.
- [x] TC-3058: Neither button is a bare "OK".
- [x] TC-3059: The slot count follows the shortfall.
- [x] TC-3108: Too many styles blocks, and names the presets.
- [x] TC-3109: It says REMOVE, not fill.
- [x] TC-3110: The correctly-counted preset is not named.
- [x] TC-3111: A commented-out over-count preset is not named.
- [x] TC-3112: Singular and plural both read.
- [x] TC-3113: Short and over at once are TWO rows, not one.
- [x] TC-3114: No fix button on either row.
- [x] TC-3115: The false-positive bar applies here too.

## 189. THE PREFLIGHT DIALOG BELONGS TO NO SINGLE CHECK [B-224]
- [x] TC-3060: Two checks firing produce ONE dialog.
- [x] TC-3061: Blocks are listed above warnings.
- [x] TC-3062: A fix in one row does not disturb another row.
- [x] TC-3063: Accepting a fix and then choosing Compile anyway still applies the fix.
- [x] TC-3064: Declining every fix changes nothing.
- [x] TC-3065: A fix is offered for saving.
- [x] TC-3066: The title matches the severity.
- [x] TC-3067: A broken check cannot stop a build.
- [x] TC-3068: A config that trips nothing is silent, as before.

## 190. PROP OPTIONS WITH NO PROP [B-089]
- [x] TC-3069: A config with prop options and no prop include warns.
- [x] TC-3070: It does not block.
- [x] TC-3071: Your own configs stay silent.
- [x] TC-3072: An empty CONFIG_PROP section warns the same as a missing one.
- [x] TC-3073: It aggregates.
- [x] TC-3074: No fix button.
- [x] TC-3075: A second family behaves the same.
- [x] TC-3076: It rides alongside the others.

## 191. A STYLE NAME THAT DOES NOT EXIST [B-324]
- [x] TC-3077: A real config is silent.
- [x] TC-3078: The documentation typo blocks.
- [x] TC-3079: One character away offers a fix.
- [x] TC-3080: Two characters away suggests but does not act.
- [x] TC-3081: A name nothing resembles lists what IS available.
- [x] TC-3082: The derivation is per OS VERSION, which a hardcoded list could not do.
- [x] TC-3083: Compile anyway reaches the toolchain.
- [x] TC-3084: Cancel is on the LEFT and is the default.
- [x] TC-3085: No OS version selected says nothing.
- [x] TC-3086: A tree edited mid-session is seen without a restart.

## 192. A SHARED FOLDER NAME THAT IS THE ODD ONE OUT [B-012]
- [x] TC-3087: A real config is silent.
- [x] TC-3088: The fault warns.
- [x] TC-3089: The fix repairs only that preset.
- [x] TC-3090: An even split is left alone.
- [x] TC-3091: A near-miss used more than once is left alone.
- [x] TC-3092: A lone outlier that is nowhere near is left alone.
- [x] TC-3093: Two uses is not a convention.
- [x] TC-3094: A nested path is repaired without losing the path.
- [x] TC-3095: It is a warning, not a block.
- [x] TC-3096: A preset with no font contributes nothing.
- [x] TC-3097: A LONE numbered folder is left alone.
- [x] TC-3098: And it is not about the word or the number.

## 193. A PROP THE SELECTED VERSION DOES NOT HAVE [B-185]
- [x] TC-3099: Switching to a version without the prop blocks.
- [x] TC-3100: The +JMT tree is silent.
- [x] TC-3101: It is per version, not per generation.
- [x] TC-3102: A config with no prop at all is silent.
- [x] TC-3103: A prop outside props/ is left alone.
- [x] TC-3104: An include outside CONFIG_PROP is not read as the prop.
- [x] TC-3105: Compile anyway reaches the toolchain.
- [x] TC-3106: No version selected says nothing.
- [x] TC-3107: An unreadable props folder is not a missing prop.

## 194. A SLOT'S COORDINATES GO STALE THE MOMENT ANYTHING WRITES [B-371]
- [x] TC-3116: The reported sequence.
- [x] TC-3117: The panel does not lose the config.
- [x] TC-3118: The same sequence with the colour picker.
- [x] TC-3119: The same sequence with template args.
- [x] TC-3120: The same sequence with the parens/arg editor.
- [x] TC-3121: Followers move with it.
- [x] TC-3122: It refuses rather than guessing.
- [x] TC-3123: Undo still works.

## 195. A DELETED FAVOURITE COMES BACK WHEN YOU REORDER [B-377]
- [x] TC-3124: The reported sequence.
- [x] TC-3125: The reorder still reorders.
- [x] TC-3126: Delete still deletes visually.
- [x] TC-3127: The last favourite.
- [x] TC-3128: Missing files keep their place.
- [x] TC-3129: Delete a missing-file favourite, then reorder.
- [x] TC-3130: The other two delete paths still work.

## 196. INSTALL RECOVERY VERIFIES, AND NEVER DELETES ON ITS OWN [B-299]
- [x] TC-3131: The armed case does not eat the core.
- [x] TC-3132: No UnhandledPromiseRejectionWarning at launch.
- [x] TC-3133: A successful install now clears its own marker.
- [x] TC-3134: Compile still works against the recovered core.
- [x] TC-3135: A genuinely interrupted install is NOT cleaned up.
- [x] TC-3136: A missing prefs.json does not throw.
- [x] TC-3137: An in-place upgraded (legacy) tree reads as installed.

## 197. "ADD TO CONFIG" ON A SOUND FONT CARD [B-376]
- [x] TC-3138: The reported case.
- [x] TC-3139: The no-array case.
- [x] TC-3140: The font name is not polluted.
- [x] TC-3141: The normal case still works.
- [x] TC-3142: Nothing is offered with no config open.
- [x] TC-3143: Replace is greyed, with a reason, when there are no presets.
- [x] TC-3144: The greyed item is inert.
- [x] TC-3145: A brand-new unsaved config counts as open.
- [x] TC-3146b: THE FONT ACTUALLY LANDS ON THE NEW PRESET.
- [x] TC-3146c: The shared folder rides on the path, not the name.
- [x] TC-3146d: No toast on a development fault.
- [x] TC-3146: Add to config still marks the font as seen.

## 198. THE DELETE KEY IN THE PRESETS SIDECAR [B-374]
- [x] TC-3147: The reported case.
- [x] TC-3148: Backspace does NOTHING here
- [x] TC-3149: One preset selected.
- [x] TC-3150: Disabled presets too.
- [x] TC-3151: Ctrl+Z brings them all back in ONE step.
- [x] TC-3152: It does not eat a Backspace while renaming.
- [x] TC-3153: It does not fire while typing in the config editor.
- [x] TC-3154: It does nothing with no selection.
- [x] TC-3155: It does nothing with the sidecar closed.
- [x] TC-3156: It does nothing on another tab.
- [x] TC-3157: It does nothing under a modal.

## 199. A LEADING HEADER COMMENT TURNED THE BRACKET CHECK OFF [B-378]
- [x] TC-3158: The reported case.
- [x] TC-3159: A `//` credit line does the same.
- [x] TC-3160: A multi-line Fett263-style header.
- [x] TC-3161: The squiggle lands on the right character.
- [x] TC-3162: A good style with a header stays silent.
- [x] TC-3163: Templated styles still work.
- [x] TC-3164: The 2026-07-13 false positive stays fixed.
- [x] TC-3165: The detail editor agrees with the Add Style box.
- [x] TC-3165b: A HEADER ABOVE A TEMPLATE PREFIX.
- [x] TC-3165c: And no false positive in that shape.
- [x] TC-3165d: A `//` line above a template prefix behaves the same.

## 200. A COMMENTED-OUT STYLE IS NOT A BLADE STYLE [B-372]
- [x] TC-3166: The panel tells the truth.
- [x] TC-3167: Block comments too.
- [x] TC-3168: The compile is now blocked.
- [x] TC-3169: Uncommenting restores it.
- [x] TC-3170: An inline comment INSIDE a live style is untouched.
- [x] TC-3171: A `//` inside a string is not a comment.
- [x] TC-3172: A commented-out `&style_ref` is not a slot either.
- [x] TC-3173: Every other wrapper name still parses.
- [x] TC-3174: No config regressed.

## 201. ONE DEFINITION OF WHAT A STYLE WRAPPER IS CALLED [B-379]
- [ ] TC-3175: ⏭ Cancelled, not to be run. "A charge preset at the right count is silent" is true under both patterns.
- [ ] TC-3176: ⏭ Cancelled, not to be run. "A charge preset one short is caught" is also true under both patterns, for the reason in the table above.
- [ ] TC-3177: ⏭ Cancelled, not to be run. The corpus figures are asserted by `test/blade-count-preflight.test.js` on every run.
- [x] TC-3389: THE ONLY CASE THAT DISCRIMINATES.

## 202. COMPILE ERRORS NAME NO FILE AT ALL [B-373]
- [x] TC-3178: The reported case.
- [x] TC-3179: The line numbers still point correctly.
- [x] TC-3180: Several errors all get it.
- [x] TC-3181: Build Output is unchanged.
- [x] TC-3182: A never-saved config.
- [x] TC-4125: A config actually named my_config.
- [x] TC-3184: An error that names no file.

### ⚠️ SUPERSEDED 2026-09-14 — the answer turned out to be a DELETION
- [x] TC-3178b: No filename anywhere in the summary.
- [x] TC-3179b: The line is the line you are looking at.
- [x] TC-3181b: Build Output is still verbatim.
- [x] TC-3183: No sentence appears twice.

## 203. ALREADY-OWNED FONTS: UNCHECKED, NEVER BLOCKED - AND NO FORM WHEN NOTHING CAN IMPORT [B-363]

### Half one - the row
- [x] TC-3310: The reported case, reversed.
- [x] TC-3311: Checking it is not a dead end.
- [x] TC-3312: The summary says skipped-by-default, and how to override.
- [x] TC-3313: Counts still read correctly.
- [x] TC-3314: A genuinely new font is untouched.
- [x] TC-3315: The guided bulk review says the same thing.

### Half two - no form when nothing can import
- [x] TC-3316: The interception.
- [x] TC-3317: THE CASE IT MUST NOT STEAL.
- [x] TC-3318: Import anyway is a real door.
- [x] TC-3319: Open existing lands on the font, not the grid.
- [x] TC-3320: Cancel leaves nothing behind.
- [x] TC-3321: Several matched fonts.
- [x] TC-3322: Add-more and duplicate mode are untouched.
- [x] TC-3323: Cancel during the match.
- [x] TC-3324: A long list scrolls.
- [x] TC-3325: Amber rows stay checkable.
- [x] TC-3326: Duplicate-in-library still works.

## 204. THE BULK PROGRESS BAR ONLY MOVES FORWARD [B-360]
- [x] TC-3194: The analyze never goes backward.
- [x] TC-3195: Finishing the first pass reads as about a third.
- [x] TC-3196: The labels still name every pass.
- [x] TC-3197: The run never goes backward.
- [x] TC-3198: The bar reaches 100% at the end
- [x] TC-3199: A skipped (duplicate) source does not rewind.
- [x] TC-3200: Shared tracks still have their own bar.

### Amended 2026-09-16 — every phase fills its pitcher [B-360]
- [x] TC-3347: The analyze fills before the tracks phase.
- [x] TC-3348: Sources fill before commons.
- [x] TC-3349: Commons fill before shared tracks.
- [x] TC-3350: A tracks-only import does NOT fill.
- [x] TC-3351: An import with no shared tracks still ends full.
- [x] TC-3352: The hold does not swallow the next phase's position.
- [x] TC-3201: A single-source import still behaves.
- [x] TC-3202: Elapsed and the "n of N (x% overall)" line still agree with the bar.

## 205. THE PROGRESS DETAIL LINE CANNOT WRAP [B-293]
- [x] TC-3203: The reported case.
- [x] TC-3204: The modal does not resize during a run.
- [x] TC-3205: The backup progress modal still clamps.
- [x] TC-3206: The backup modal's item-name line still clamps.
- [x] TC-3207: Short text is unaffected.
- [x] TC-3208: The single-source import progress too.

### Amended 2026-09-16 — the label, and the component [B-293]
- [x] TC-3390: The label truncates and the count survives.
- [x] TC-3391: A label with no name still truncates whole.
- [x] TC-3392: The backup modal is one line now.
- [x] TC-3393: The single-import modal truncates
- [x] TC-3394: The delete/export modal truncates
- [x] TC-3395: No modal changes height
- [x] TC-3396: Clicking a tag chip on a font card still filters

## 206. CLEARING "NEW" IN BULK [B-297]
- [x] TC-3209: The wide case.
- [x] TC-3210: "All" means all, not just what is on screen.
- [x] TC-3211: The narrow case.
- [x] TC-3212: It hides when it can do nothing.
- [x] TC-3213: The grid repaints once.
- [x] TC-3214: The toast is honest.
- [x] TC-3215: Selection survives the click.
- [x] TC-3216: It persists. Restart the app — the fonts are still not New.
- [x] TC-3217: The four original writers still work.

### Built 2026-09-18 — placement, the reverse direction, and the marker
- [x] TC-3529: It is not in the filter chip row.
- [x] TC-3530: Right-click a font that is New
- [x] TC-3531: Right-click a font that is NOT New
- [x] TC-3532: Never both. The menu shows exactly ONE of the pair, chosen by that font's current state.
- [x] TC-3533: No bulk reverse anywhere.
- [x] TC-3534: Losing prefs.json must not eat the New badges.
- [x] TC-3535: The marker is not a font.
- [x] TC-3536: A restored library re-runs the backfill.

## 207. AN ARCHIVE WITH NO SOUND FONT IN IT IS NOT "READY TO IMPORT" [B-296]
- [x] TC-3218: Bulk import of a folder holding an archive with no sound font: the review counts it out and says it will be skipped
- [x] TC-3219: The breakdown agrees with the headline.
- [x] TC-3220: The import matches the promise.
- [x] TC-3221: Nothing changes when there are no empties.
- [x] TC-3222: All-empty disables Import.
- [x] TC-3223: An unreadable source is not called empty.
- [x] TC-3224: A source holding only an older alternate version.
- [x] TC-3225: Analyze time does not noticeably grow.

## 208. TWO IDENTICAL FONTS IN ONE IMPORT CAN SEE EACH OTHER [B-314]
- [x] TC-3226: The reported case.
- [x] TC-3227: The count is honest.
- [x] TC-3228: The import matches the count.
- [x] TC-3229: Both can still be imported.
- [x] TC-3230: The wording never says "already in your library"
- [x] TC-3231: Three copies in one batch.
- [x] TC-3232: No leaked staged zips.
- [x] TC-3233: A library duplicate still behaves as before.
- [x] TC-3448: ONE COPY BY DEFAULT.
- [x] TC-3449: BOTH ROWS SAY IT.
- [x] TC-3450: Untick the FIRST instead and nothing trades places.
- [x] TC-3451: QUICK IMPORT AGREES WITH REVIEW.
- [x] TC-3452: A source that is BOTH a library duplicate and a twin

## 209. THE FILTER BAR STATES THE LOGIC THE APP IMPLEMENTS [B-305]
- [x] TC-3234: The grouping reads correctly.
- [x] TC-3235: Creators say "or".
- [ ] TC-3236: ⏭ Cancelled, not to be run. It asserted tags and effects say "and", which was true of the predicates then.
- [x] TC-3237: A single chip shows no joiner.
- [x] TC-3238: An unused facet is absent.
- [x] TC-3239: Boolean facets AND onto the end.
- [x] TC-3240: The stale badge is gone.
- [x] TC-3241: Clear all clears the badges too.
- [x] TC-3242: The badges still appear when filtering from inside the dropdown.
- [x] TC-3243: The row wraps sensibly.

### Amended 2026-09-16 — the semantics half [B-382]
- [x] TC-3364: Tags are OR: two tags no single font carries give both sets, and the row says "or"
- [x] TC-3365: The dropdowns agree with the grid.
- [x] TC-3366: Present effects are OR.
- [x] TC-3367: Absent effects are AND-NOT.
- [x] TC-3368: A mixed effect filter renders two groups
- [x] TC-3369: Creators stay OR and must not be "fixed" for consistency.
- [x] TC-3370: The tag dropdown does not narrow its own option list.

### Amended 2026-09-16 — dropdown behaviour, closing a dated exception
- [x] TC-3371: All three stay open
- [x] TC-3372: Clicking outside still closes them.
- [x] TC-3373: Counts refresh on each pick
- [x] TC-3374: Rows do not move under the cursor.
- [x] TC-3375: Scroll position survives a pick
- [x] TC-3376: Count-0 rows are hidden, EXCEPT ones you set.
- [x] TC-3377: Reopening re-evaluates
- [x] TC-3378: Clicking a tag chip on a font CARD still works

## 210. MOUNT_SD_SETTING WITH NO MASS STORAGE [B-170]
- [x] TC-3379: The reverse offer fires.
- [x] TC-3380: No dialog. Commenting a line loses nothing and is one undo away, so a confirm here would be charging for a safe action.
- [x] TC-3381: One undo restores it.
- [x] TC-3382: It edits the buffer and does NOT save.
- [x] TC-3383: It fires on the TRANSITION only.
- [x] TC-3384: A commented-out define is left alone.
- [x] TC-3385: No define, no offer.
- [x] TC-3386: The ON direction is unchanged.
- [x] TC-3387: Pre-OS8 is unaffected.
- [x] TC-3388: TC-3252 still stands
- [x] TC-3244: The reported case.
- [x] TC-3245: It does not block.
- [x] TC-3246: It offers no switch.
- [x] TC-3247: Mass storage is silent.
- [x] TC-3248: A commented-out define is ignored.
- [x] TC-3249: ENABLE_ALL_EDIT_OPTIONS alone does not warn.
- [x] TC-3250: Both together still warn.
- [x] TC-3251: It does not fire on your real configs.
- [x] TC-3252: The existing card-safety guard is untouched.

## 211. THE SLOT CARD'S PRIMARY COLOUR [B-060]
- [x] TC-3253: The reported case, and it is exact.
- [x] TC-3254: DELETED 2026-09-15 — it could not have passed.
- [x] TC-3255: BASE still wins.
- [x] TC-3256: The meter styles.
- [x] TC-3257: A wrapper still delegates inward.
- [x] TC-3258: Changing the colour still works.
- [x] TC-3259: A helper-body colour is not offered as editable in the slot.
- [x] TC-3260: A bare `("r,g,b")` colorArg still resolves
- [x] TC-3261: A style with no colour anywhere.
- [x] TC-3262: REWRITTEN 2026-09-15 — the original was unrunnable in practice.
- [x] TC-3263a: The known limits, confirmed as EXPECTED rather than fixed

## 212. THE SLOT COLOUR READS AS A NAME [B-078, B-225]
- [x] TC-3263: The whole test, and it is one look.
- [x] TC-3264: A colour with no name still shows numbers, and that is correct.
- [x] TC-3265: The file is still not rewritten.

## 213. THE BUILD-STATUS CHIPS SAY WHICH BUILD [B-028]
- [x] TC-3271: The overnight repro — and the chip must degrade ON THE EDIT.
- [x] TC-3272: The Close-button mislabel.
- [x] TC-3273: A genuine restore still says restore.
- [x] TC-3274: Flashing again clears the stale state.
- [x] TC-3275: Hover carries the timestamp AND which board.
- [x] TC-3276: Editing back restores the match.
- [x] TC-3277: Opening another config clears it.
- [x] TC-3278: An unidentified build is not called stale.
- [x] TC-3279: No flash this session, no claim.
- [x] TC-3280: A failed flash does not stamp.

### 213b. THE SEVEN RESET STATES — added 2026-09-15
- [x] TC-3327: #1 The flashed board is unplugged.
- [x] TC-3328: #2 A different board, same session.
- [x] TC-3329: #2 again, across a restart — a different code path.
- [x] TC-3330: And the same board across a restart.
- [x] TC-3331: #6 The build TARGET changed.
- [x] TC-3332: #7 A failed flash is STICKY.
- [x] TC-3333: A failed flash with no usable reason.
- [x] TC-3334: #5 Opening another config.
- [x] TC-3335: A config edited since its last compile shows NO flash record.
- [x] TC-3336: A config that was never flashed.
- [x] TC-3337: A record with nothing connected.
- [x] TC-3338: A DFU flash records the board it actually flashed.
- [x] TC-3339: DFU mode does NOT change the flash chip.
- [x] TC-3340: UNPRODUCIBLE ON THIS HARDWARE — do not tick, mark N/A.

### 213c. THE STATUS BAR'S COPY RULES — added 2026-09-15
- [x] TC-3341: No chip has a tooltip that repeats its label.
- [x] TC-3342: But a TRUNCATED label still reveals itself.
- [x] TC-3343: No label carries a timestamp, a serial or a target.
- [x] TC-3344: The compile chip's error hover carries the reason.
- [x] TC-3345: No em dash and no contraction in any status or flash-failure string.
- [x] TC-3346: The Detected SN field says nothing when no config is open.

## 214. ONE CONFLICT REVIEW PER EXPORT [B-357]
- [x] TC-3281: The reported case.
- [x] TC-3282: Each section keeps its own sentence.
- [x] TC-3283: Choices are applied to the right kind.
- [x] TC-3284: A font and a track with the same name.
- [x] TC-3285: One Cancel abandons everything.
- [x] TC-3286: Set all still works across sections.
- [x] TC-3287: Folders-only is unchanged.
- [x] TC-3288: Tracks-only is unchanged and still works.
- [x] TC-3289: The Replace caution still behaves.
- [x] TC-3290: The card-export flow still asks its own way.
- [x] TC-3453: THE CAUTION MATCHES THE ROWS IT SITS OVER.
- [x] TC-3454: Neither caution repeats what sits directly above it,
- [x] TC-3455: Title states the situation, body states the decision, and they do not say the same thing.
- [x] TC-3456: THE SCAN IS GONE BEFORE THE REVIEW APPEARS.
- [x] TC-3457: A confirm summoned from inside the review still appears above it.
- [x] TC-3458: THE STANDALONE TRACKS EXPORT SHOWS ITS COMPARE PHASE.
- [x] TC-3459: And it is honest when the count is not yet known.

## 215. THE BOARD AND USB FIELDS COMPARE AGAINST THE BUILD, NOT THE SAVED FILE [B-385]
- [x] TC-3291: The reported case.
- [x] TC-3292: Saving does not clear it.
- [x] TC-3293: Board behaves identically.
- [x] TC-3294: OS Version too.
- [x] TC-3295: All three at once.
- [x] TC-3296: Compiling clears them all.
- [x] TC-3297: Nothing is backfilled.
- [x] TC-3298: The cannot-tell state, on a pre-1.8-compile config.
- [x] TC-3299: Recompiling resolves it.
- [x] TC-3300: A matching build is silent.
- [x] TC-3301: No board still wins.
- [x] TC-3302: Board detection is untouched.

### Fixtures for the pre-1.8 backfill (written 2026-09-14)
- [x] TC-3303: A backfills and behaves like a compiled config.
- [x] TC-3304: A stays red through a Save.
- [x] TC-3305: A clears on Compile.
- [x] TC-3306: B does not backfill.
- [x] TC-3307: Saving B does not invent a build record.
- [x] TC-3308: B becomes A after one compile.
- [x] TC-3309: Neither fixture's leading comment block breaks anything.

## 216. THE ALREADY-HAVE-IT DIALOG'S PRIMARY BUTTON IS A DESTINATION [B-390]
- [x] TC-3353: Several matches show the set.
- [x] TC-3354: The chip can be cleared.
- [x] TC-3355: The dropdown counts agree with the grid.
- [x] TC-3356: The counts reconcile.
- [x] TC-3357: A renamed source is named as an alias.
- [x] TC-3358: It does not claim the sources duplicate each other.
- [x] TC-3359: One match still opens the font.
- [x] TC-3360: Clear all clears it too
- [x] TC-3361: A second "Show in library" replaces the first.
- [x] TC-3362: A stale filter cannot hide part of the answer.
- [x] TC-3363: "Import anyway under a new name" is unchanged

## 217. A BACKUP ACTS ON WHAT IT REFUSES, AND RECORDS A HASH OF WHAT IT CARRIED [B-394]
- [x] TC-3397: The export acts, it does not just decline.
- [x] TC-3398: Removal happens BEFORE the dialog, and cannot be declined.
- [x] TC-3399: The completion folds into that one dialog.
- [x] TC-3400: Re-import says nothing differs.
- [x] TC-3401: Quarantine keeps every byte.
- [x] TC-3402: Attachments are exempt.

### The second name is not a failure (the hardlink case)
- [x] TC-3403: No false failure on a hardlinked file.
- [x] TC-3404: Both names actually go.
- [x] TC-3405: One finding, not two.
- [x] TC-3406: A genuine failure still reports.
- [x] TC-3407: The audio beside it survives
- [x] TC-3408: Three kinds, counted separately, worded separately.
- [x] TC-3409: A disguised program is named as disguised.

## 218. A SUCCESSFUL EXPORT NEVER ENDS IN SILENCE [B-395]
- [x] TC-3410: A clean export shows its completion dialog.
- [x] TC-3411: The elapsed time is real.
- [x] TC-3412: A large export still reports.
- [x] TC-3413: And the refusal dialog still appears when there IS something to report

## 219. AN IMPORT MODAL CLOSES BY ITS OWN BUTTON, AND BY NOTHING ELSE [B-396]
- [x] TC-3414: A click beside the modal does nothing during analyze.
- [x] TC-3415: And on the review screen
- [x] TC-3416: And during the import, on the final summary, and on the first scan.
- [x] TC-3417: Escape does nothing either
- [x] TC-3418: Cancel still works in every phase
- [x] TC-3419: Done still closes the summary.
- [x] TC-3420: A click INSIDE the dialog still works normally
- [x] TC-3421: The single-source import still behaves identically.
- [x] TC-3422: An import after a long analyze actually imports.

## 220. AN ARCHIVE WITH NO FONT IN IT SAYS SO ON THE SCREEN YOU ACT ON [B-296]
- [x] TC-3423: The pre-import summary counts them separately.
- [x] TC-3424: The review screen says it too.
- [x] TC-3425: The row is present, unchecked, and CANNOT be checked.
- [x] TC-3426: It names what was found
- [x] TC-3427: The no-font note beats the duplicate note.
- [x] TC-3428: QUICK IMPORT SKIPS IT TOO.
- [x] TC-3429: A source we could not READ is not accused.
- [x] TC-3430: A folder of nothing but empty archives
- [x] TC-3431: The import summary carries no "No fonts found in source" failure

## 221. THE "ALREADY IN YOUR LIBRARY" COUNT CANNOT VANISH [B-397]
- [x] TC-3432: All three outcomes appear at once.
- [x] TC-3433: SD card import shows it too.
- [x] TC-3434: THE FLOOR HOLDS WHEN THE OWNERSHIP PASS RETURNS NOTHING.
- [x] TC-3435: It does not double-count.
- [x] TC-3436: Nothing owned means no row.
- [x] TC-3437: The two screens agree.
- [x] TC-3438: A cancelled analyze never reports FEWER than the dedup found.

## 222. A BACKUP CARRIES WHAT KNOWS WHICH FONTS YOU ALREADY OWN [B-399]
- [x] TC-3439: Export carries them.
- [x] TC-3440: Replace-restore brings them back.
- [x] TC-3441: Restoring into a HEALTHY library leaves it healthy.
- [x] TC-3442: Merge carries them per font.
- [x] TC-3443: Merge carries them for voicepacks too.
- [x] TC-3444: A PARTIAL merge brings only what it took.
- [x] TC-3445: Keep-both lands correctly.
- [x] TC-3446: An older backup still restores and merges.
- [x] TC-3447: Nothing rebuilds.

## 223. A QUESTION NEVER WRITES TO THE CARD, AND AN EXPORT WRITES ONCE [B-402]
- [x] TC-3460: An abandoned scan leaves NOTHING.
- [x] TC-3461: A completed export records EVERYTHING it looked at, not just what it wrote.
- [x] TC-3462: A SKIPPED item records the DESTINATION's hash.
- [x] TC-3463: A REPLACED item records the LIBRARY's hash
- [x] TC-3464: A subset export preserves every other entry byte-identical.
- [x] TC-3465: A no-op export does not touch the file.
- [x] TC-3466: All three buckets, not just tracks.
- [x] TC-3467: Skipping EVERY conflict is not "already up to date".
- [x] TC-3468: Kept items are reported as kept, on BOTH summary paths.

## 224. THE EXPORT SUMMARY NAMES THE DESTINATION [B-403]
- [x] TC-3469: A card root is named, not spelled.
- [x] TC-3470: Both surfaces agree about the same card.
- [x] TC-3471: A folder keeps its path.
- [x] TC-3472: A fixed drive is never called removable.
- [x] TC-3473: The link still opens the real folder.
- [x] TC-3474: A slow or absent card cannot hang the summary.

## 225. A RESTORE THAT REFUSES A FILE SAYS SO [B-401]
- [x] TC-3475: A REPLACE restore reports a refused file.
- [x] TC-3476: A MERGE restore reports it too.
- [x] TC-3477: ONE dialog, not two.
- [x] TC-3478: Nothing is impounded.
- [x] TC-3479: A clean restore is unchanged.

## 226. EVERY +ADD DOOR SAYS WHAT IT IS DOING [B-400]
- [x] TC-3480: Tracks + Add shows a bar at all.
- [x] TC-3481: Font + Add is byte-accurate, not an indeterminate sweep.
- [x] TC-3482: Common + Add likewise.
- [x] TC-3483: The bar appears even for ONE small file.
- [x] TC-3484: Right-click a font → Export spans two phases in ONE modal.
- [x] TC-3485: Export of a hand-picked file selection is STILL silent, by design.
- [x] TC-3486: A duplicate add SAYS SO.
- [x] TC-3487: A clean add stays silent.
- [x] TC-3488: One dialog, not three.
- [x] TC-3489: Bulk import still counts tracks correctly.

## 227. NEVER STORE THE SAME BYTES TWICE, WHICHEVER DOOR [B-406]
- [x] TC-3490: A track added to a font links to the track.
- [x] TC-3491: And to a common folder.
- [x] TC-3492: The reverse direction.
- [x] TC-3493: Novel track audio is NOT pooled.
- [x] TC-3494: Deleting a track frees its space.
- [x] TC-3495: But a file something else still names SURVIVES.
- [x] TC-3496: A repeat add is refused, not renamed.
- [x] TC-3497: Nothing regressed for fonts.

## 228. A DIALOG NEVER GROWS PAST THE WINDOW [B-404]
- [x] TC-3498: Select every track and press Delete.
- [x] TC-3499: And the list is capped.
- [x] TC-3500: Short dialogs are unchanged.

## 229. DELETE DELETES THINGS, BACKSPACE DELETES CHARACTERS [B-405]
- [x] TC-3501: Shared Tracks.
- [x] TC-3502: A font's Files list.
- [x] TC-3503: A common folder's file list.
- [x] TC-3504: It never fires while typing.
- [x] TC-3505: A stacked dialog eats the key.
- [x] TC-3506: Backspace deletes NOTHING, anywhere.
- [x] TC-3507: The two that already worked still work.

## 230. NO DUPLICATES, WHICHEVER DOOR [B-407]
- [x] TC-3508: Back up, delete a font, import a font sharing its sounds, merge the backup: the restored sounds share the same stored copies
- [x] TC-3509: The same for a shared track.
- [x] TC-3510: An archive's internal duplication collapses.
- [x] TC-3511: Commons need no separate case.
- [x] TC-3512: The content is still CORRECT, not merely shared.
- [x] TC-3513: Attachments and hash manifests are NOT deduped, deliberately.

## 231. KEEPING YOUR FONTS MUST NOT CANCEL THE TRACK MERGE [B-409]
- [x] TC-3514: The repro. Delete one shared track.
- [x] TC-3515: And "Nothing to merge" is still correct when it IS true.
- [x] TC-3516: Keeping fonts still keeps fonts.

## 232. EXPORTING A FILE SELECTION REPORTS ITSELF [B-408]
- [x] TC-3517: Several files show a real bar.
- [x] TC-3518: One file behaves exactly as before.
- [x] TC-3519: One folder behaves as before too.
- [x] TC-3520: Cancelling at the picker does nothing.
- [x] TC-3521: An export from a SOURCE shows an indeterminate bar, not a false one.
- [x] TC-3522: Mixed selections still land correctly.
- [x] TC-3523: A refused file still reports.

## 233. BULK IMPORT: THE WINDOW STAYS ALIVE AND CANCEL MEANS CANCEL [B-398]
- [x] TC-3524: Start a bulk import over a large folder and CLICK the window repeatedly while it runs — outside the modal, on the title bar, anywhere.
- [x] TC-3525: Cancel a bulk import partway.
- [x] TC-3526: Cancel during the RUN phase (fonts actually being committed, after Review).
- [x] TC-3527: Cancel a run, then immediately start another.
- [x] TC-3528: Backup cancel, SD health cancel and core install cancel all still behave as before.

## 234. A STYLE THAT IS NOT A DECLARATION CANNOT BE SAVED [B-381]
- [x] TC-3537: The case itself.
- [x] TC-3538: Break it further and it stays refused.
- [x] TC-3539: Put the `using Name =` back and the banner clears
- [x] TC-3540: A real bracket error still behaves as before.
- [x] TC-3541: Add Style is UNCHANGED and must stay that way.
- [x] TC-3542: The library grid is unaffected.

## 235. BULK IMPORT EXPLAINS ITSELF BEFORE IT TAKES YOUR EVENING [B-292, B-294]
- [x] TC-3543: The link opens a screen, not a folder dialog.
- [x] TC-3544: It says what the folder should hold, and why.
- [x] TC-3545: Three steps, in the review screen's own vocabulary.
- [x] TC-3546: It warns that this is long, and states NO figure.
- [x] TC-3547: It promises nothing it cannot keep.
- [x] TC-3548: The savings thesis, verbatim.

### [B-294] Walk away from a long import
- [x] TC-3549: The checkbox is on the explain screen
- [x] TC-3550: And on the analyze screen
- [x] TC-3551: Tick it and it works.
- [x] TC-3552: Ticked up front, it arrives ticked.
- [x] TC-3553: It disappears once the import itself runs.
- [x] TC-3554: It must NOT auto-continue when there is nothing to import.
- [x] TC-3555: It is one run only.

### The SD card pointer
- [x] TC-3556: The card view points at bulk import when originals exist.
- [x] TC-3557: The link works and lands on the explain screen
- [x] TC-3558: The savings thesis is NOT repeated here.

### Cancel during ANALYZE actually cancels  [B-398 door 6]
- [x] TC-3559: Cancel during analyze, then immediately start another import.
- [x] TC-3560: The probe log names no further `importSource:` phases after the cancel
- [ ] TC-3561: ⏭ Known behaviour, recorded, not a test. The modal still closes immediately on an analyze cancel

## 236. A FONT AND THE PACKAGE IT CAME OUT OF ARE ONE FONT [B-415]
- [x] TC-3562: The bare font loses to the package it came from.
- [x] TC-3563: Quick import skips it too.
- [x] TC-3564: A partial overlap is NOT a duplicate.
- [x] TC-3565: Three copies leave ONE.
- [x] TC-3566: And nothing names a row that is not importing.

### What the rows say
- [x] TC-3567: The winner says why it won.
- [x] TC-3568: Exact twins make no completeness claim.
- [x] TC-3569: It never says "already in your library".
- [x] TC-3570: Unticked, never disabled
- [x] TC-3571: Our vocabulary stays out of the UI.

### The counts
- [x] TC-3572: The headline counts only what will actually import.
- [x] TC-3573: The breakdown line is count-neutral.
- [x] TC-3574: It is not folded into the library total.

### The cost
- [x] TC-3575: It adds no I/O and no stall.

## 237. A BOARD THAT ANSWERS IS NOT SILENT [B-417]

### The version it cannot read
- [x] TC-3576: A board whose version line is unreadable is reported as having ANSWERED.
- [x] TC-3577: The note offers no retry.
- [x] TC-3578: It quotes the actual string back
- [x] TC-3579: The OS Version field does NOT go red.
- [x] TC-3580: A genuinely silent board still reports a timeout.

### The build date
- [x] TC-3581: The build date appears on a modern board, which it never has.
- [x] TC-3582: A 6.9 board still reports its date.
- [x] TC-3583: The date is not truncated.
- [x] TC-3584: The unreadable-version board ALSO reports its build date.

### The words
- [x] TC-3585: The message states what is true and stops.

### What the board agrees about
- [x] TC-3586: A board that MATCHES the selected tree now says so.
- [x] TC-3587: The remedy list stays mismatch-only.
- [x] TC-3588: Same version, different folder.

## 238. AN EXPORT THAT CANNOT FIT DOES NOT START, AND A SLOW ONE SAYS SO [B-203, B-238]

### Setting up a target that cannot fit

### The refuse
- [x] TC-3589: An export that cannot fit does not start.
- [x] TC-3590: It states THREE numbers, and the third is the point.
- [x] TC-3590b: NO SECOND PERSON.
- [x] TC-3590c: It does NOT prescribe a fix.
- [x] TC-3590a: NO QUANTITY WRAPS.
- [x] TC-3591: There is no proceed-anyway.
- [x] TC-3591a: THE DIALOG HAS EXACTLY ONE BUTTON.
- [x] TC-3591b: THE SCREEN IS CLEAN AFTERWARDS.
- [x] TC-3591c: Same for cancelling the slow-write warning.
- [x] TC-3592a: ALL OR NOTHING - it does not write the ones that fit.
- [x] TC-3592: It refuses on a FIXED disk too, not only removable media.
- [x] TC-3593: An export that fits is unaffected.
- [x] TC-3594: IT NEVER FAILS CLOSED.
- [x] TC-3595: The margin is cluster-rounded, not padded.

### Writing through a Proffieboard  [B-238]
- [x] TC-3596: Exporting to a card mounted through a Proffieboard warns first.
- [x] TC-3596a: THEIR VOCABULARY, not a consumer paraphrase.
- [x] TC-3596b: The body does not restate the title.
- [x] TC-3597: Proceed is available and works.
- [x] TC-3598: No numbers in the sentence
- [x] TC-3599: It does NOT fire for a card in a reader or a built-in SDHC slot.
- [x] TC-3600: IT FIRES BEFORE ANY QUESTION IS ASKED.
- [x] TC-3600a: No silent pause after the folder picker.

### When the warning stays quiet  [B-238]
- [x] TC-3600b: One font to a board-mounted card shows NO warning.
- [x] TC-3600c: A multi-font export DOES warn.
- [x] TC-3600d: TWO AXES, FILES FIRST.
- [x] TC-3600e: Checked against a real library: no single font warns, two mid-size fonts trip the size limit

### How much room is left
- [x] TC-3601: The summary reports free space on removable destinations.
- [x] TC-3602: The number RECONCILES.
- [x] TC-3603: It is measured AFTER the export, not before.
- [x] TC-3604: No line on a fixed disk.
- [x] TC-3605: No line when we cannot tell.
- [x] TC-3606: No bar graph.

### Off Windows
- [x] TC-3607: On a Mac build, the refuse still works and the storage line is absent.

## 239. A SERIAL COMMAND CANNOT KILL THE APP [B-418]
- [x] TC-3608: Sending `sd 1` from the Serial Monitor does not crash the app.
- [x] TC-3609: Repeated and consecutive commands are safe.
- [x] TC-3610: Closing the Serial Monitor mid-command is safe.
- [x] TC-3611: Unplugging the board mid-command is safe.
- [x] TC-3612: The version probe path is safe too, and it is the more exposed one.
- [x] TC-3613: The monitor still reports genuine port errors.

## 240. A CANCELLED EXPORT STOPS IN A SECOND, AND SAYS WHAT IT DID [B-005 item 4]
- [x] TC-3614: Cancel during a font export to a board card stops in about a second.
- [x] TC-3615: Nothing truncated is left behind.
- [x] TC-3616: Cancel during the drain, not just between chunks.
- [x] TC-3617: Cancel a ZIP export mid-entry.
- [x] TC-3618: Cancel a SOURCE export (reconstruction) mid-file.
- [x] TC-3619: Cancel a pooled/bundle source export.
- [x] TC-3620: Cancel Extract to folder from a source.

## 241. A CANCEL IS NEVER REPORTED AS A SUCCESS [B-005 item 4]
- [x] TC-3621: Cancelling the font card's Export font folder does not claim success.
- [x] TC-3622: Cancelling Common Folders Export (zip) says something.
- [x] TC-3623: Cancelling a tracks export does NOT write a sync manifest.
- [x] TC-3624: Every door's stopped-notice says how many files landed.
- [x] TC-3625: A cancel never appears as a red failure.

## 242. THE HEADING SAYS WHAT THE APP IS DOING [B-005 item 4]
- [x] TC-3626: The heading changes to Exporting <name> when the export starts.
- [x] TC-3627: The bar and elapsed clock are not reset when the heading changes.

## 243. REPLACING A FONT NEVER LEAVES YOU WITH NEITHER [B-005 item 4]
- [x] TC-3628: Cancel a replace-mode export; the original comes back intact.
- [x] TC-3629: The notice leads with the restore.
- [x] TC-3630: A successful replace leaves no extra folders.
- [x] TC-3631: A failure mid-copy (not a cancel) also restores.
- [x] TC-3632: The restored original is not deleted by the failure cleanup.
- [x] TC-3633: A leftover ORIGINAL. folder is named to the user, not silently left.
- [x] TC-3634: A stale ORIGINAL. from an interrupted run does not jam the next attempt.

## 244. SAFE EJECT — AND THE FAILURE CASE IS THE POINT [B-005 item 4]
- [x] TC-3635: The eject offer appears after an export to removable media.
- [x] TC-3636: Ejecting a board card reports success and the card is gone.
- [x] TC-3637: Ejecting a card in a USB reader works.
- [x] TC-3638: Ejecting the laptop's built-in slot works.
- [x] TC-3639: A busy volume reports honestly.
- [x] TC-3640: A one-sample reappearance is not reported as failure.
- [x] TC-3641: Declining the offer leaves the card mounted and says nothing further.
- [x] TC-3642: The message says the card will not come back until reconnected.

## 245. THE DESTINATION IS CHECKED THE SAME WAY AT EVERY DOOR [B-203, B-238, B-005 item 4]
- [x] TC-3643: The threshold is one definition.
- [x] TC-3644: A backup that will not fit is refused before writing.
- [x] TC-3645: A small export to a card is not refused and raises no overlay.
- [x] TC-3646: An unmeasurable destination is never refused.
- [x] TC-3647: OS Versions Export to folder — still no checks of any kind.

## 246. THE PARTIAL IS ACTUALLY GONE, NOT JUST ASKED TO GO [B-005 item 4]
- [x] TC-3648: Cancel a font export to a BOARD CARD and confirm the folder is gone.
- [x] TC-3649: Repeat it several times in a row.
- [x] TC-3650: If the removal genuinely cannot happen, the app says so.
- [x] TC-3651: Cancel is still fast with the handle wait in place.
- [x] TC-3652: Cancel to a normal folder on an internal disk still cleans up.

## 247. ONE PREFLIGHT, EVERY DOOR [B-203, B-238, B-005 item 4]
- [x] TC-3653: The not-enough-room refusal is identical at every door.
- [x] TC-3654: The board-card warning is identical at every door.
- [x] TC-3655: The primary Export now warns about a board card.
- [x] TC-3656: A many-small-files export trips the warning even under 60 MB.
- [x] TC-3657: A small export raises no overlay and no dialog anywhere.

## 248. A SLOW CLEANUP IS OFFERED, NOT IMPOSED [B-005 item 4]
- [x] TC-3658: Cancel a large export to a board card; you are asked, not made to wait.
- [x] TC-3659: Choosing "Leave them" leaves a folder named DELETE.<name> on the card
- [x] TC-3660: Choosing "Remove now" clears it and says so if it could not.
- [x] TC-3661: A SMALL cancel on a board card is cleaned silently, with no prompt.
- [x] TC-3662: A cancel to an internal disk or a card reader is always cleaned silently.
- [x] TC-3663: An unknown destination behaves like the ordinary case.

## 249. EJECT WHEN THIS FINISHES [B-005 item 4]
- [x] TC-3664: The checkbox appears during an export to removable media
- [x] TC-3665: Ticking it ejects at the end with no second prompt.
- [x] TC-3666: Leaving it unticked produces the end-of-export offer instead.
- [x] TC-3667: A ticked box does not carry into the next export.
- [x] TC-3668: Cancelling an export does not eject.

## 250. THE DOORS THAT HAD NOTHING [B-005 item 4, B-203, B-238]
- [x] TC-3669: Exporting an OS version to a full card is refused before writing.
- [x] TC-3670: Exporting an OS version to a board card warns first.
- [x] TC-3671: An OS version export can be cancelled, and the app stays responsive.
- [x] TC-3672: A cancelled OS version export leaves no partial folder.
- [x] TC-3673: Extract to folder can be cancelled.
- [x] TC-3674: Copy/paste between library locations still works normally.

## 251. THE LAST WRITE WITH NO CHECKPOINTS [B-005 item 4]
- [x] TC-3675: Export a single large file and cancel partway.
- [x] TC-3676: The app stays responsive during a single large file export to a board card.
- [x] TC-3677: An uncancelled single-file export still lands byte-for-byte.

## 252. THE DIALOG THAT ASKED NOTHING [B-005 item 4]
- [x] TC-3678: Every confirm names its own subject.
- [x] TC-3679: No export ever ejects without an explicit answer.
- [x] TC-3680: The two buttons on every two-choice dialog do different things.
- [x] TC-3681: A stopped export with nothing to report shows a toast, not a modal.
- [x] TC-3682: A stopped export WITH something to report still shows a modal

## 253. MESSAGES THAT MATCH WHAT THE SCREEN SHOWS [B-005 item 4]
- [x] TC-3683: Ejecting a board card explains the drive letter that stays behind.
- [x] TC-3684: Ejecting the laptop's built-in slot, where the letter vanishes, still reads correctly.
- [x] TC-3685: Ejecting a card that is already out says so
- [x] TC-3686: The compressing tail says "Finishing the archive…"
- [x] TC-3687: Every destination check shows the same "Checking the destination…" bar.

## 254. THE SIZE FLOOR THAT DISABLED THE CHECK [B-203, B-005 item 4]
- [x] TC-3688: A SMALL export to a nearly-full card is refused before writing.
- [x] TC-3689: A small export to a destination with room proceeds with no dialog.
- [x] TC-3690: The primary export refuses BEFORE the destination comparison.

## 255. THE SAME SITUATION GETS THE SAME TREATMENT [B-005 item 4]
- [x] TC-3691: A replace that FAILS (not cancels) restores the original.
- [x] TC-3692: Nothing is left under an `ORIGINAL.` name after any failure.
- [x] TC-3693: Cancelling a replace on a board card OFFERS to clear the leftover
- [x] TC-3694: Cancelling a replace on a fast destination clears it silently
- [x] TC-3695: Cancelling a voice-pack export behaves exactly like cancelling a font export.
- [x] TC-3696: The bulk export measures the destination ONCE.

## 256. THE ORDER OF OPERATIONS ON A FULL CARD [B-203]
- [x] TC-3697: The primary export refuses before comparing the destination.
- [x] TC-3698: A destination that fills between the early check and the real one still refuses.
- [x] TC-3699: An export that fits proceeds with exactly one destination measurement.

## 257. THE CARD REPORT'S LAYOUT UNDER A PROGRAM-FILE WARNING [B-423]
- [x] TC-3700: The "N folders selected" bar never overlaps the footer.
- [x] TC-3701: The file list stays scrollable rather than being squeezed away.
- [x] TC-3702: The report grows only when the banner is present.
- [x] TC-3703: The taller report still fits the window on a short screen.
- [x] TC-3704: No hidden warning inflates the report.

## 258. THE QUICK-IMPORT CHECKBOX SITS IN THE BUTTON ROW [B-423]
- [x] TC-3705: "Continue to quick import without review" is inline with Cancel import
- [x] TC-3706: It still appears during ANALYZE only.
- [x] TC-3707: Ticking it still takes the import straight through without the review.
- [x] TC-3708: The other phases of the bulk modal still look right.

## 259. THE DAMAGED-SOUNDS CHECK REPORTS WHAT IT IS DOING [B-422]
- [x] TC-3709: The label reports a climbing count.
- [x] TC-3710: A large folder is where it matters.
- [x] TC-3711: Cancel still abandons the check.
- [x] TC-3712: A second check does not inherit the first one's count.
- [x] TC-3713: The bar stays indeterminate and that is correct.
- [x] TC-3714: A damaged font is still refused.

## 260. RESTORING CUSTOMIZED FONTS REPORTS REAL WORK [B-429]
- [x] TC-3715: The bar does not fall to zero and sit.
- [x] TC-3716: Bytes and the live filename.
- [x] TC-3717: Position appears only when there is more than one.
- [x] TC-3718: One continuous bar across several fonts, not one per font.
- [x] TC-3719: A failed pick must not make the bar run backwards.
- [x] TC-3720: Only the checked ones are restored, and only they are counted.
- [x] TC-3721: Teardown. Run an import with a customized restore, let it finish, then run another.
- [x] TC-3722: A failed restore does not strand the readout.
- [ ] TC-3723: ⏭ Known behaviour, recorded, not a test. KNOWN, NOT A FAILURE HERE

## 261. THE PRIMARY EXPORT ON THE SHARED RUNNER [B-420]
- [x] TC-3724: One surface, not several.
- [x] TC-3725: The slow-write warning fires ONCE, and before the scan.
- [x] TC-3726: The early refusal still happens before the scan.
- [x] TC-3727: The refusal carries three numbers.

### Replace no longer destroys what it is replacing
- [x] TC-3728: A failed disposal is a leftover, never a loss.
- [x] TC-3729: And the leftover is reported.
- [x] TC-3730: A cancelled replace puts the original back.
- [x] TC-3731: A failed replace also restores.

### Cancel
- [x] TC-3732: Cancel during the copy actually stops it.
- [x] TC-3733: And it reports STOPPED, not complete.
- [x] TC-3734: No eject offer on a cancel.
- [x] TC-3735: Cancel during the SCAN keeps its surface until it has stopped.
- [x] TC-3736: The scan's Cancel does not outlive the scan.

### Two exports, one destination
- [x] TC-3737: A second export to the same destination is refused.
- [x] TC-3738: Different destinations still overlap.
- [x] TC-3739: The claim is always released.

### What the summary says
- [x] TC-3740: The destination count excludes the operating system's folders.
- [x] TC-3741: And the shared folders are still excluded.
- [x] TC-3742: The free-space line appears for a SUBFOLDER destination.
- [x] TC-3743: The elapsed time is plausible.
- [x] TC-3744: The counts reconcile.

### The label
- [x] TC-3745: The toolbar button reads "SD Export" with its count.

## 262. THE FIT CHECK AND THE SLOW-WRITE WARNING ON EVERY DOOR [B-203, B-238]
- [x] TC-3746: Every export door refuses when it cannot fit.
- [x] TC-3747: It never fails closed.
- [x] TC-3748: Cluster rounding is applied.
- [x] TC-3749: The slow-write warning fires on every door aimed at a board card
- [x] TC-3750: And stays silent below the line.
- [x] TC-3751: Silent off a board card.
- [x] TC-3752: The lookup is not paid below the threshold.

## 263. CANCEL ON EVERY EXPORT, AND WHAT A CANCEL LEAVES [B-005 item 4]
- [x] TC-3753: Cancel stops a multi-font export.
- [x] TC-3754: And it reports STOPPED, not complete.
- [x] TC-3755: Every door offers a cancel while it writes.
- [x] TC-3756: A cancelled fresh export removes its partial.
- [x] TC-3757: A cancelled REPLACE restores the original.
- [x] TC-3758: On a board card, a large cleanup is OFFERED rather than performed.
- [x] TC-3759: A cancel we could not confirm says so.
- [x] TC-3760: Cancel during the ANALYSIS stops the analysis.
- [x] TC-3761: And it stops in every phase of the scan, not just the fonts.

## 264. SAFE EJECT WHEN THE DESTINATION IS REMOVABLE [B-184]
- [x] TC-3762: The offer appears on a removable destination and nowhere else.
- [x] TC-3763: The offer lives ON the ending, not in a dialog after it.
- [x] TC-3764: And never twice.
- [x] TC-3765: No eject after a cancel.
- [x] TC-3766: The wording after a successful eject is the current one.
- [x] TC-3767: Checking the box does not block the summary.

## 265. THE SD-CARD VERB IS "SD EXPORT" [B-242]
- [x] TC-3768: The toolbar button reads `↗ SD Export (N)`.
- [x] TC-3769: The right-click doors still say "Export…".
- [x] TC-3770: The tooltip describes the card job.
- [x] TC-3771: Nothing else in the app calls this screen "Export" bare.

## 266. ONE UNPACK ON IMPORT, AND NO RE-ZIP [B-427]
- [x] TC-3772: Import a zip carrying our sidecar and the font arrives complete.
- [x] TC-3773: A zip with NO sidecar imports normally.
- [x] TC-3774: A FOLDER import peeks too.
- [x] TC-3775: A malformed sidecar is ignored, not fatal.
- [x] TC-3776: Import is measurably faster on a large archive, and nothing is left in temp.
- [x] TC-3777: Re-importing the same archive still recognises it.

## 267. ONE SOURCE IMPLEMENTATION [B-428]
- [x] TC-3778: Import still works end to end
- [x] TC-3779: Export still works from every door.
- [x] TC-3780: Dedup still runs on a folder source.
- [x] TC-3781: A source with an unknown format fails loudly.

## 268. A RESTORED CUSTOMIZED FONT KEEPS ITS OWN NAME [B-430]
- [x] TC-3782: Export a customized font, delete it, re-import.
- [x] TC-3783: And it still suffixes when the name really is taken.
- [x] TC-3784: The first copy is `_2`, never `_1`.
- [x] TC-3785: Duplicating a font is unaffected.

## 269. THE MANIFEST IS BORROWED ONCE, AND RECORDS WHAT IT LEARNED HOWEVER THE EXPORT ENDS [B-173]

### The borrow
- [x] TC-3786: One parse per operation, not one per item.
- [x] TC-3787: A card with no manifest reads honestly, not as a failure.
- [x] TC-3788: Two cards in one session do not serve each other.

### Self-healing
- [x] TC-3789: An already-up-to-date export still leaves a manifest.
- [x] TC-3790: And the run after it is fast.
- [x] TC-3791: The already-up-to-date summary says how long it took
- [x] TC-3792: Tracks are recorded at all.

### Proportional cost — only what actually changed
- [x] TC-3793: An edit made outside the app re-reads exactly one file.
- [x] TC-3794: And the entry heals itself.
- [x] TC-3795: A file deleted on the card is caught without hashing anything.
- [x] TC-3796: A manifest copied from a DIFFERENT card is rejected file by file.

### Stopping keeps what it cost you
- [x] TC-3797: Cancel mid-SCAN keeps what it already hashed.
- [x] TC-3798: And an item interrupted mid-compare records NOTHING.
- [x] TC-3799: Cancel mid-EXPORT records what landed.
- [x] TC-3800: Nothing partial is ever recorded.

## 270. A FOLDER THAT HOLDS WHAT YOUR LIBRARY DOES NOT [B-173]
- [x] TC-3801: A file added to a font folder on the card makes it differ.
- [x] TC-3802: And a file added inside a SUBFOLDER counts too.
- [x] TC-3803: Replace removes it.
- [x] TC-3804: A library file missing from the card still differs.
- [x] TC-3805: A common folder is unaffected by our own marker.

### Skip records what you keep
- [x] TC-3806: Skip records the folder, extras included.
- [x] TC-3807: And that is what makes a later library import free.
- [x] TC-3808: Skipping every differing folder still records.
- [x] TC-3809: A second skip of the same folder reads nothing.
- [x] TC-3810: And the phase does not run at all.

### The scan stops reading once it has its answer
- [x] TC-3811: A differing folder is NOT hashed during the scan.
- [x] TC-3812: The reading happens on Skip instead

### Stopping a track import
- [x] TC-3813: Adding tracks can be cancelled.
- [x] TC-3814: Tracks already copied are kept and complete.
- [x] TC-3815: The list behind the dialog is already correct when it opens.

### Endings
- [x] TC-3816: An export that writes nothing still offers Eject.
- [x] TC-3817: A folder on an internal disk gets no Eject offer
- [x] TC-3818: The summary says how long it took
- [x] TC-3819: It says why it beat the warning, and only when it did.
- [x] TC-3820: The count line says "skipped"
- [x] TC-3821: No flash between the conflict review and the summary.

### Stale records are swept, and only when that is safe
- [x] TC-3822: Removing an extra clears its record.
- [x] TC-3823: A folder the user is KEEPING extras in does not lose them.
- [x] TC-3824: One file absent plus one stray does NOT sweep.
- [x] TC-3825: A cancelled pass never sweeps.
- [x] TC-3826: All three surfaces.

### Known limits, recorded rather than implied
- [x] TC-3827: A file replaced with its timestamp preserved is NOT noticed.
- [x] TC-3828: Cancel on the conflict review closes it.
- [x] TC-3829: Cancel during "Recording what you kept" stops it.

## 271. THE PROGRESS MODAL MUST NOT CHANGE SIZE WHILE IT IS UP [B-432]
- [x] TC-3830: The box does not resize when the scan's Cancel is retired.
- [x] TC-3831: Same, on the recording phase.
- [x] TC-3832: The Cancel is genuinely gone, not merely invisible.
- [x] TC-3833: A destination that is NOT removable.
- [x] TC-3834: The reservation is released when the modal closes.
- [x] TC-3835: A cancel offered again inside the same run still works.
- [x] TC-3836: A door that never writes a per-item line still has NO blank row.

## 272. THE EXPORT BAR MEASURES THE WORK, AND THE SAVING COUNTS THE WHOLE JOB [B-005 item 7b]

### The bar
- [x] TC-3837: The bar starts at zero.
- [x] TC-3838: The total never changes during the run.
- [x] TC-3839: A font that writes NOTHING still moves the bar.
- [x] TC-3840: 100% is reached before the summary, not during it.
- [x] TC-3841: The byte counter reads the WORK, not the font.
- [x] TC-3842: The per-item label still names real files.

### What it says it saved
- [x] TC-3843: The saving counts fonts that were never opened.
- [x] TC-3844: The voice pack and the tracks count too.
- [x] TC-3845: A font you CHOSE to keep is NOT counted.
- [x] TC-3846: A card already fully in sync still reports its saving.
- [x] TC-3847: The figure is predictable, so check it against the prediction.

### The repair itself
- [x] TC-3848: A partly damaged font is repaired, not rewritten.
- [x] TC-3849: A font missing entirely is still written in full.
- [x] TC-3850: Nothing parked survives.
- [x] TC-3851: The summary's words match what happened.

### Two things the screen cannot show
- [x] TC-3852: The plan is computed once, not twice.
- [x] TC-3853: The compare's hashes are reused by the plan.

## 273. THE PROGRESS-BAR AUDIT: WHAT IT FIXED, AND THE DOOR IT FOUND [B-389, B-434]
- [x] TC-3854: Optimize ends FULL, not empty.
- [x] TC-3855: A source with no optimize work does not flash a fill.
- [x] TC-3856: The two dead doors stay dead.
- [x] TC-3857: No progress channel is emitted with nobody listening.

## 274. A TOAST DOES NOT EXPIRE WHILE SOMEONE IS READING IT [B-236]
- [x] TC-3858: Hover holds it open.
- [x] TC-3859: Leaving RESTARTS the clock, it does not resume.
- [x] TC-3860: An action toast holds too, and its button still works.
- [x] TC-3861: Repeats do not stack behaviour.
- [x] TC-3862: Untouched toasts are unchanged.
- [x] TC-3863: A toast already fading is not resurrected.

## 275. THE COMMON COMPARE READS ITS RECORDED HASHES INSTEAD OF RE-HASHING [B-433]
- [x] TC-3864: A common that matches still reports identical.
- [x] TC-3865: A common that differs is still caught.
- [x] TC-3866: A card-side change is still caught.
- [x] TC-3867: The fast path is actually taken, and this cannot be seen on screen.
- [x] TC-3868: KNOWN LIMIT, recorded rather than discovered later.

## 276. A DISPOSAL THAT DID NOT HAPPEN STOPS REPORTING SUCCESS [B-436]
- [x] TC-3869: Ordinary exports are unchanged.
- [x] TC-3870: A leftover is now named when one survives.
- [x] TC-3871: A leftover is left alone by later exports.
- [x] TC-3872: The retry budget did not grow.

## 277. A DAMAGED CARD IS REFUSED BEFORE THE EXPORT STARTS [B-441]
- [x] TC-3873: The damaged card is refused before anything is written.
- [x] TC-3874: A healthy card still exports normally.
- [x] TC-3875: A local folder and a fixed drive are unaffected.
- [x] TC-3876: One dialog, not two.
- [x] TC-3877: No screen flash before the refusal.
- [x] TC-3878: The card browser and the export agree about the same card.
- [x] TC-3879: The browser's card verdict reads correctly and blames the card, not the machine.
- [x] TC-3880: Nothing in the app recommends reformatting a card.
- [x] TC-3881: A write that fails anyway is reported as one thing, not one line per font.
- [x] TC-3882: A destination that cannot be measured must NOT be refused.
- [x] TC-3883: KNOWN LIMIT, recorded rather than discovered later: the check does not run on macOS or Linux.
- [x] TC-3884: The card browser did not get slower.

## 278. THE EXTRACTED FLASH HINT CAN REACH THE VALUE IT WAS READING [B-254]
- [x] TC-3885: A normal serial flash completes.
- [x] TC-3886: The same flash over DFU.
- [x] TC-3887: The SD-guard notice still appears when flashing without card protection.
- [x] TC-3888: The pending lead message still appears after a guard-triggered recompile.
- [x] TC-3889: The hint line stays EMPTY on an ordinary flash.
- [x] TC-3890: KNOWN LIMIT, recorded rather than rediscovered: nothing in the suite can catch this class.

## 282. A DIALOG'S ✕ LANDS ON THE DIALOG, AND A CHOOSER SAYS HOW TO LEAVE [B-449]
- [x] TC-3920: The ✕ sits on the dialog, not the screen.
- [x] TC-3921: The four that already worked are UNCHANGED.
- [x] TC-3922: New Config — the ✕ answers "is this a way out".
- [x] TC-3923: Create Style Library — the same three.
- [x] TC-3924: Import Common Folder has a ✕ and no footer Cancel.
- [x] TC-3925: Import Sound Font — ✕ present, Cancel only where it means something.
- [x] TC-3926: Add Style's ✕ does not sit on "Paste & Parse".
- [x] TC-3927: KNOWN LIMIT, recorded rather than rediscovered.
- [x] TC-3928: The fifteenth dialog.

## 283. ONE DIVIDER CLASS, AND A DIVIDER THAT MEANS SOMETHING [B-448]
- [x] TC-3929: The Config Manager toolbar still reads right.
- [x] TC-3930: The Sound Fonts toolbar separator.
- [x] TC-3931: The two toggled-by-id dividers still toggle.
- [x] TC-3932: No divider is visible with nothing to divide — Config Manager, no config open.
- [x] TC-3933: The styles-control divider appears WITH its group.
- [x] TC-3934: Walk the four toolbar states.
- [x] TC-3935: ⏭ NOT CONFIRMED, check if the state is reachable. The divider before ✅ Reached 2026-11-21 on the Linux pass (QA16, empty library with shared tracks present): the toolbar shows only + Import Sound Font and the…
- [x] TC-3936: `test/divider-convention.test.js` holds the line.

## 284. A SETTING NOBODY COULD EXPLAIN IS GONE, AND THE KNOB IS NOT [B-450]
- [x] TC-3937: The row is gone from Settings.
- [x] TC-3938: The feature still runs.
- [x] TC-3939: The tag does not block.
- [x] TC-3940: The knob survives with no UI.
- [x] TC-3941: "Include the config with SD Export" hides with its parent.
- [x] TC-3942: Both remaining rows carry their help as a tooltip.

## 285. A DIALOG'S EXITS ANSWER TWO QUESTIONS, NOT ONE [B-453]
- [x] TC-3943: Library picker — staged picks survive a stray click.
- [x] TC-3944: Text prompt — gated on what was typed, not on the field being non-empty.
- [x] TC-3945: Pop-link — ticked boxes survive.
- [x] TC-3946: Backup merge plan — the most expensive one.
- [x] TC-3947: Import Sound Font — the same overlay, two answers.
- [x] TC-3948: The link sub-view is gated on the field, not on being open.
- [x] TC-3949: Link a Prop has four exits and they all do the same thing.
- [x] TC-3950: The ones that must still dismiss freely.
- [x] TC-3951: `modal-sf-paste-rename` dismisses on the backdrop and SHOULD.

## 286. THE BASE-COLOUR SLOT BELONGS TO BASE_COLOR_ARG OR TO NOBODY [B-460]
- [x] TC-3952: courkrusleonorder.h, preset JUMPBIKE, slot B4: the collapsed tile and the expanded panel show the same detected base colour
- [x] TC-3953: The arg did not vanish, it moved.
- [x] TC-3954: A low-numbered arg is just as wrong as a high one.
- [x] TC-3955: The other partials.
- [x] TC-3956: A fully argified style is UNCHANGED.
- [x] TC-3957: A style with a literal and no args at all is unchanged.
- [x] TC-3958: A style with no colour at all stays blank in both views.
- [x] TC-3959: Match B1 survives a base-less B1.
- [x] TC-3960: Custom expressions are untouched.
- [x] TC-3961: The ladder was not reordered, and nothing re-ranked.

## 287. PASTE & PARSE CAN READ A BLOCK THIS APP WROTE [B-458]
- [x] TC-3962: The round trip, which is the whole entry.
- [x] TC-3963: Notes holds the notes and NOTHING else.
- [x] TC-3964: Disk round trip — the half a screenshot cannot show.
- [x] TC-3965: An INLINE comment is not a header.
- [x] TC-3966: A LEADING header still supplies the name.
- [x] TC-3967: The foreign format is untouched.
- [x] TC-3968: Paste Code in the detail editor still ignores clipboard metadata.

## 288. A COMMENT CANNOT TRUNCATE A PASTED STYLE, AND THE GUARD STILL BITES [B-459]
- [x] TC-3969: A stray `>` in a block comment.
- [x] TC-3970: Commented-out code, which is the shape that actually dominates.
- [x] TC-3971: A GENUINELY BROKEN STYLE MUST STILL BE REPORTED.
- [x] TC-3972: The real-world worst case.
- [x] TC-3973: A Greyscale style.
- [x] TC-3974: Nothing is lost in the middle.
- [x] TC-3975: The `using` path still works, since it was the workaround.
- [x] TC-3976: The library survives the change.

## 289. Flash targets the port that was showing when you clicked — [B-472]
- [x] TC-3977: One board on COM6 with no port chosen, a second plugged in just before Flash: the flash runs on COM6 and the dropdown does not flip
- [x] TC-3978: Confirm which board actually got it.
- [x] TC-3979: Auto-select is unchanged BEFORE the click, and that is wanted.
- [x] TC-3980: A manual pick still wins, as it always did.
- [x] TC-3981: MUST NOT REGRESS — no board at commit time.
- [x] TC-3982: Compile locks too, not just Flash.

## 290. The port dropdown holds still during a flash — [B-471]
- [x] TC-3983: No movement mid-flash.
- [x] TC-3984: THE REGRESSION THIS FIX COULD CAUSE — test it every time.
- [x] TC-3985: "Scanning…" must not get stuck.
- [x] TC-3986: Manual DFU mode is untouched.

## 291. A config records which JMT Add-ons release was compiled in — [B-473]
- [x] TC-3987: The basic stamp.
- [x] TC-3988: It follows the TREE, not the dropdown's name.
- [x] TC-3989: The whole point — it moves only on a compile.
- [x] TC-3990: A cache restore stamps it too.
- [x] TC-3991: No add-ons in the build means no line at all.
- [x] TC-3992: A plain (non-+JMT) tree writes nothing.
- [x] TC-3993: It covers the headers with no `jmt_` in the name.
- [x] TC-3994: A commented-out include does not count.
- [x] TC-3995: IT CLEARS, and this is the one a truthiness bug would break.
- [x] TC-3996: It survives a round trip.
- [x] TC-3997: Old configs stay quiet.

## 292. A restored build reports its own compile duration — [B-474]
- [x] TC-3998: Restore cached build A, flash; restore B, flash; back to A: the compiled time and duration always match the build restored
- [x] TC-3999: Fresh compiles are unaffected.
- [x] TC-4000: Units — a 1000x error would still look plausible.
- [x] TC-4001: An entry with no stored duration CLEARS the field.
- [x] TC-4002: The "Last compile" label agrees.

## 293. A creator's own Download button is captured, and the window never steals the page — [B-480]
- [x] TC-4003: Import from the BVM fonts page: a Download in the in-app browser is captured, the browser stays on the page and the import opens
- [x] TC-4004: A target=_blank download link still works.
- [x] TC-4005: Closing the browser with no download still cancels cleanly

## 294. The link import says only what is true yet, and the window is announced before it appears — [B-481]
- [x] TC-4006: A creator who needs no account is never asked about one.
- [x] TC-4007: The window is announced BEFORE it appears, and it is not a prompt.
- [x] TC-4008: Once the window is up the copy leads with the click.
- [x] TC-4009: A download that starts during the announce pause means NO window at all.
- [x] TC-4010: The progress bar sweeps; it never sits at 0%.
- [x] TC-4011: A creator who sends no Content-Length keeps sweeping

## 295. A CFX or Xeno build is never offered as a Proffie font — [B-485]
- [x] TC-4012: Free shape. Import font-absorbed.zip: Sound fonts found (1), the candidate is `Absorbed/Absorbed`, it carries the Proffie variant badge, and there is no duplicate-name error.
- [x] TC-4013: Paid shape — the one that offered the wrong board.
- [x] TC-4014: The four-board and five-board archives behave the same.
- [x] TC-4015: REGRESSION — the conventional shape must still group.
- [x] TC-4016: REGRESSION — a name that CONTAINS a board token is not a conversion.

## 296. A creator is recognised from the archive, and from the library once you have named them — [B-484]
- [x] TC-4017: Curated row auto-fills.
- [x] TC-4018: Both readme spellings, and this is the one a tidy-up breaks.
- [x] TC-4019: The free archives never state authorship in prose.
- [x] TC-4020: Library learning, using a creator NOT in the curated table.
- [x] TC-4021: Two known creators in one readme suggests NEITHER.
- [x] TC-4022: A short or placeholder creator name is never suggested.
- [x] TC-4023: A creator in the curated table is unaffected by learning.

## 297. The download browser is sized from the app, not from a hardcoded guess — [B-483]
- [x] TC-4024: At the app's MINIMUM size the window fits inside it.
- [x] TC-4025: At a normal size it is clearly inset and centred.
- [x] TC-4026: On a large display it stays a box rather than sprawling.
- [x] TC-4027: The app stays usable while the window is up, and a download still hides it.

## 298. A version import can be cancelled, and the window answers while it copies — [B-488]
- [x] TC-4028: The window stays responsive for the whole copy.
- [x] TC-4029: Cancel is clickable during the copy and the state appears AT the click.
- [x] TC-4030: No partial version survives a cancel.
- [x] TC-4031: A cancel is not an error.
- [x] TC-4032: The file count moves.
- [x] TC-4033: Cancel twice does nothing extra.
- [x] TC-4034: An uninterrupted import still completes normally.
- [x] TC-4035: Duplicate behaves identically, same button.
- [x] TC-4036: Download Version from GitHub still imports.
- [x] TC-4037: The Cancel button is clean on reopen.

## 299. A common folder import ends once, always states its space, and a reused source reports the saving — [B-424]
- [x] TC-4038: A brand-new voicepack states what it occupies.
- [x] TC-4039: A voicepack whose source is already in the library brags, and the arithmetic reconciles.
- [x] TC-4040: The noun matches what was picked.
- [x] TC-4041: One ending, and it is a summary.
- [x] TC-4042: The ending does not change with size.
- [x] TC-4043: Eject rides the summary, inline.
- [x] TC-4044: Cancel mid-import leaves nothing.
- [x] TC-4045: An uninterrupted import still completes.

## 300. The eject checkbox is read back by every door that offers it — [B-424]
- [x] TC-4046: Ticking the box ejects, with no further click.
- [x] TC-4047: The checkbox presses the BUTTON — it never runs its own eject.
- [x] TC-4048: An unticked box ejects nothing.
- [x] TC-4049: One run's tick never carries into the next.

## 301. A link import can be cancelled at any moment, and nothing survives it — [B-424]
- [x] TC-4050: Cancel at the browser window, before clicking Download.
- [x] TC-4051: Cancel the instant the download starts.
- [x] TC-4052: Cancel mid-download.
- [x] TC-4053: Cancel when the download is nearly finished.
- [x] TC-4054: Cancel after the download finishes, while it is committing.
- [x] TC-4055: The cancelling state appears at the click.
- [x] TC-4056: A cancel is not an error.
- [x] TC-4057: And it does not fall back to the browser.
- [x] TC-4058: An uninterrupted link import still completes.
- [x] TC-4059: Run every case above twice — once on a link that opens the browser window, once on one that downloads headlessly.

## 302. SD browser — Open a config, by both routes — [B-424]
- [x] TC-4060: Open a config
- [x] TC-4061: The dialog's body says WHY ejecting is safe rather than only offering it: the config opens as a copy, the file on the card is never edited in place, and the card has already been read.
- [x] TC-4062: The second route.
- [x] TC-4063: The preview modal carries its own Eject bottom-left beside Open in editor and Close, so someone who only wanted to look can leave without going through the open flow.
- [x] TC-4064: Eject and open ejects the card AND opens the config.

## 303. A receipt added during an import never offers to eject the card the font is coming from — [B-424]
- [x] TC-4065: Same card. Start an import from a card, reach the review, and use + Add (proof of purchase) to pick a receipt from that same card.
- [x] TC-4066: Same case, at the ending: the receipt's toast says Proof of purchase added and carries no Eject action.
- [x] TC-4067: Two different cards.
- [x] TC-4068: Receipt from an internal disk during a card import: no eject offer, no toast action, and the import is unaffected.
- [x] TC-4069: + Add proof of purchase from the SOURCE DETAIL panel
- [x] TC-4070: The slow-source warning still fires BEFORE the progress modal opens, not during.

## 304. Nothing invites a delete, or points at a path, on removable media — [B-424]
- [x] TC-4071: Import a font FROM A CARD
- [x] TC-4072: The savings sentence above it is unaffected — the source size, what JMT Studio saved, and what the font added on disk all still appear.
- [x] TC-4073: Import the same way from an internal disk.
- [x] TC-4074: Clicking that path on the internal-disk case opens the file manager with the original selected.
- [x] TC-4075: A LINK import (no local original) shows neither the delete sentence nor a path, as before.

## 305. A path link retires when its volume is ejected — [B-424]
- [x] TC-4076: On any summary that shows both a path link and an Eject (a tracks add, an export close-out), press Eject and let it report Safe to remove. The path is still readable but is no longer a link and no longer underlined…
- [x] TC-4077: Hovering the retired path explains it: "Removed, so this is no longer on this computer."
- [x] TC-4078: A path on a DIFFERENT volume on the same dialog stays clickable — only paths on the volume that was ejected retire.
- [x] TC-4079: The eject reported as busy or returned leaves every link clickable, because nothing left.
- [x] TC-4080: The same holds whether the eject was pressed manually or fired automatically from the Eject after completion checkbox.

## 306. One source, one dedup question — [B-424, correcting B-363]
- [x] TC-4081: Re-import a source you already hold
- [x] TC-4082: Open existing on that first dialog opens the matched source and ends the import.
- [x] TC-4083: [B-363]'s own case still fires.
- [x] TC-4084: A source where only SOME fonts are owned still reaches the review, with the owned rows unchecked and the rest importable.
- [x] TC-4085: A fuller source of a font you own — identical sounds plus tracks you lack — reaches the review CHECKED.
- [x] TC-4086: The review's own inline note still appears where it should: "This font is already in your library, so it is skipped by default."

## 307. Adding files reads the source once, and the window stays alive — [B-424]
- [x] TC-4087: Font detail → + Add → Browse…
- [x] TC-4088: The bar's total matches the slow-source warning's figure for the same pick, and the bar never exceeds its own total.
- [x] TC-4089: The bar lands exactly on 100%, including when the pick contains a file that cannot be read, a non-wav, or a refused program file.
- [x] TC-4090: Shared tracks → + Add → Browse…
- [x] TC-4091: Cancel mid-add
- [x] TC-4092: All-duplicate add.
- [x] TC-4093: A clean add that adds something stays SILENT apart from the refreshed list and, on a card, the eject toast.
- [x] TC-4094: Shared tracks → + Add → Add from library
- [x] TC-4095: Files added this way are still deduplicated against the library — adding a wav the library already holds anywhere does not write the bytes a second time.

## 308. The library states its own size, and a file manager agrees with it — [B-318, B-499]
- [x] TC-4096: The claim. Note the footer's first figure, then open Properties on `%APPDATA%\jmt-studio\soundFonts`.
- [x] TC-4097: The three figures reconcile with each other: of files minus on disk equals saved, and the tooltip's percentage is the saving against the first figure.
- [x] TC-4098: It updates after an import.
- [x] TC-4099: The close-out's "JMT Studio saved you X" and the footer's saved delta will NOT match, and that is correct: the dialog anchors on the zip's compressed size on purpose.
- [x] TC-4100: It updates after a delete as well.
- [x] TC-4101: Nothing freezes.
- [x] TC-4102: Switch to Sound Fonts repeatedly in quick succession.
- [x] TC-4103: The footer is persistent and on ONE row.
- [x] TC-4104: With a config open that references a missing font, all three footer rows read correctly: Not in your library above, then the swatch legend centred on the bar with the figures at the right of that same row.
- [x] TC-4105: The readout hovers.
- [x] TC-4106: Edit the open config so the legend swatches change.
- [x] TC-4107: Narrow the window below roughly 1100px.
- [x] TC-4108: A brand new library.
- [x] TC-4109: Import the first font into that new library.
- [x] TC-4110: Restart the app
- [x] TC-4111: The readout is correct in light mode, and saved is JMT Blue in both themes.
- [x] TC-4112: Hardlink sanity, if you have two fonts sharing audio: on disk is meaningfully smaller than of files.

## 309. Attaching a receipt streams, reports and cancels — [B-475]
- [x] TC-4113: Attach a large file.
- [x] TC-4114: The progress total equals the file's own size, not twice it.
- [x] TC-4115: Cancel mid-attach.
- [x] TC-4116: A normal small receipt (a few hundred KB) still attaches with no visible ceremony.
- [x] TC-4117: The attached file opens correctly afterwards and its label is preserved.
- [x] TC-4118: Attach the same file twice.
- [x] TC-4119: Attach from a board-mounted card rather than local disk.
- [x] TC-4120: Attach to several sources at once where the door offers it.

## 310. A successful flash stops printing a red error that means the opposite — [B-467]
- [x] TC-4121: Flash a board successfully and read the tail of the log.
- [x] TC-4122: The line has not disappeared.
- [x] TC-4123: Flash twice in a row without restarting the app.
- [x] TC-4124: A cannot-open that arrives BEFORE any completed download is still red and still treated as an error

## 311. A backup that cannot read a file stops and says which one — [B-478]
- [x] TC-4126: Export a library containing a file the app cannot read.
- [x] TC-4127: BACKSTOP ONLY
- [x] TC-4128: BACKSTOP ONLY.
- [x] TC-4129: A library with no unreadable files still exports normally.

## 312. Cancelling or failing an export lets go of the file — [B-478, B-479]
- [x] TC-4130: Cancel an export mid-file, then eject the destination.
- [x] TC-4131: With the stall probe armed (`userData/.stall-probe`), a cancel writes `sfBackup:cancel:result:destroyed` to `stall-probe.log`.
- [x] TC-4132: Cancel is still responsive.

## 313. Reading a backup never holds the card — [B-479]
- [x] TC-4133: Import a backup from a card mounted in a saber.
- [x] TC-4134: The dialog says the backup is not bad and sends the user to a card reader.
- [x] TC-4135: Importing the same file through a card reader succeeds
- [x] TC-4136: Replace import, cancelled, then eject
- [x] TC-4137: Merge import — eject after the compare screen AND after the apply.
- [x] TC-4138: Import a source from a zip on a card
- [x] TC-4139: View a .docx stored on a card
- [x] TC-4140: A truncated .docx on a card fails to open and the card still ejects.

## 314. The eject offer on a backup export — [B-478]
- [x] TC-4141: The checkbox appears on the confirm dialog during "Surveying library and benchmarking destination…", not only once the countdown starts.
- [x] TC-4142: It appears on the first export to a given destination, not just the second.
- [x] TC-4143: Ticking it stops the countdown
- [x] TC-4144: Ticked on the confirm screen, it is still ticked on the progress screen.
- [x] TC-4145: Ticked, the export finishes and the card ejects by itself.
- [x] TC-4146: Pressing Cancel greys the checkbox
- [x] TC-4147: After a cancelled run, the next export shows the checkbox enabled again.
- [x] TC-4148: The offer does not appear for a non-removable destination.

## 315. The not-enough-room numbers reconcile — [B-478]
- [x] TC-4149: Export to a destination too small.
- [x] TC-4150: On the backup door the dialog says "This backup needs…", not "This export…".
- [x] TC-4151: On a font or source export the same dialog still says "This export…".

## 316. One unreadable file takes its whole item out, and the backup still finishes — [B-478]
- [x] TC-4152: Export with an unreadable file inside a source.
- [x] TC-4153: Repeat with the unreadable file inside an attachment (a proof of purchase).
- [x] TC-4154: The finished zip contains neither the dropped font nor its source, and everything else is present.

## 317. A dropped font and its source report as ONE loss, counted by failed reads — [B-478]
- [x] TC-4155: The gate and the completion each show one row for the font and its source — "Your whole The_Watcher sound font and its source cannot be backed up" / "…were left out" — with both path links under it.
- [x] TC-4156: Two fonts sharing a source that was not dropped still report as two rows.
- [x] TC-4157: The red headline counts files that could not be read, not the files those items contained.
- [x] TC-4158: The row says "N files could not be read, invalidating the copy." It must not say an item is missing part of itself or predict how a restore would look — data has no self.
- [x] TC-4159: The red line sits a clear blank line below "Took …", not flush against it.

## 318. The confirm screen, the bar and the completion all state the archive — [B-478]
- [x] TC-4160: After agreeing to the skip, the confirm screen counts exclude the dropped items.
- [x] TC-4161: The progress bar counts toward that same total and reaches it.
- [x] TC-4162: The completion screen states the same three numbers as the confirm screen.
- [x] TC-4163: An export with nothing skipped still reports the full library, unchanged.
- [x] TC-4164: The destination fit check still uses the un-adjusted size.

## 319. A restored library remembers that NEW has already been reckoned — [B-297]
- [x] TC-4165: Mark a font New, export, then replace-restore from that backup and restart.
- [x] TC-4166: `library/.seen-backfill-done` is inside the zip and back on disk after the restore.
- [x] TC-4167: The marker never appears as a font: the font count on the import inspect screen, the merge compare list and the restore's per-item progress all ignore it.
- [x] TC-4168: A backup taken from a library that has never run the backfill carries no marker, and restoring it leaves the backfill still to do.

## 320. The em dashes left the UI, and the bracket error reads as one sentence — [B-443]
- [x] TC-4169: Style Library → open a style → delete one `>` → Save.
- [x] TC-4170: Same check in the Add Style editor — a separate call site with its own copy of the message.
- [x] TC-4171: Click the red squiggle, or press F8.
- [x] TC-4172: A style with balanced brackets still saves with no banner and no marker.
- [x] TC-4173: Version lists
- [x] TC-4174: OS Versions → Proffieboard Plugin dropdown
- [x] TC-4175: SD card browser
- [x] TC-4176: Preset panel, hover a blade badge (B1/B2/B3) — `Main Blade · go to line / drag to reorder`.
- [x] TC-4177: Import review → vendor suggestion
- [x] TC-4178: KEPT ON PURPOSE, do not "fix" these two.

## 321. A preset can be moved to another bank — [B-506]
- [x] TC-4179: Two banks: right-click a preset.
- [x] TC-4180: Click it.
- [x] TC-4181: The config still compiles.
- [x] TC-4182: Multi-select several presets and move them.
- [x] TC-4183: Three or more banks
- [x] TC-4184: Hover the submenu open, then click a different item in the main menu.
- [x] TC-4185: One bank only
- [x] TC-4186: Disabled presets are not offered.
- [x] TC-4187: Undo (Ctrl+Z) puts it back

## 322. A define nothing in the selected OS and prop reads — [B-445]
- [x] TC-4188: The dialog is titled "Before You Compile", not "This Config Cannot Compile".
- [x] TC-4189: The message names both the OS version and the prop it was judged against.
- [x] TC-4190: The message does not promise the build will succeed.
- [x] TC-4191: Each row reads `#define NAME`, with `#define` dim and static.
- [x] TC-4192: Hover a name — the tooltip gives the name and its line ("JMT_NO_CHORD (line 7)").
- [x] TC-4193: Hover the pencil
- [x] TC-4194: Disable comments the line with a plain `//`, preserving indentation, and the row disappears on the re-run.
- [x] TC-4195: Delete removes the whole line, leaving no blank where it was.
- [x] TC-4196: The pencil opens an inline field on the name only.
- [x] TC-4197: The check mark commits and re-runs every check.
- [x] TC-4198: A close typo offers a suggestion under the name
- [x] TC-4199: The suggestion is never pre-filled into the editor.
- [x] TC-4200: An antonym is never suggested.
- [x] TC-4201: "Not used" is literally true and "not found" would be wrong.
- [x] TC-4202: The dialog is wide enough that no define name is ellipsised.
- [x] TC-4203: Compile anyway proceeds
- [x] TC-4204: Resolving the LAST finding closes the dialog and continues to the compile.
- [x] TC-4205: Cancel stops the compile

### The gate overlay this shipped with
- [x] TC-4206: Pressing Compile shows "Preparing to compile..." immediately
- [x] TC-4207: Its Cancel abandons the build
- [x] TC-4208: No flash between surfaces.
- [x] TC-4209: The card does not appear when there is nothing to wait for

## 323. The font card right-click menu acts on the selection — [B-425]

### The selection rule
- [x] TC-4210: Select three cards, then right-click one of them.
- [x] TC-4211: Select three cards, then right-click a fourth, unselected card.
- [x] TC-4212: With exactly one card selected, every item reads without a count, as before.

### What is offered, and what is not
- [x] TC-4213: `Replace in config preset…` is absent whenever more than one card is selected.
- [x] TC-4214: `Clear selection (n)`
- [x] TC-4215: Counts say what will CHANGE.
- [x] TC-4216: `Duplicate (n)` on a selection produces the same result as the toolbar's Duplicate button for the same selection.
- [x] TC-4217: `× Delete (n)` deletes the whole selection

### Add to config
- [x] TC-4218: Open a config with presets.
- [x] TC-4219: One Ctrl+Z removes all three.
- [x] TC-4220: The config still compiles after a batch add.

### Export source
- [x] TC-4221: It counts SOURCES, not cards.
- [x] TC-4222: The questions are the same ones the source detail's own Export button asks, and they cover the whole selection: a zip/folder choice, and checkboxes counting every proof of purchase and every customized font across…
- [x] TC-4223: The summary reports the whole export, not its first source.
- [x] TC-4224: Exporting from the source detail's own Export button is unchanged.

### Export font folder
- [x] TC-4225: Select five fonts, `↗ Export font folder (5)…`, pick a destination.
- [x] TC-4226: The space check is over the SUM.
- [x] TC-4227: One conflict question, not one per font.
- [x] TC-4228: Fonts already at the destination and identical are skipped silently, and the summary says so: "2 already matched your library." A selection where nothing needs writing reads Nothing exported, not "Export complete".
- [x] TC-4229: The progress bar advances across the whole selection rather than restarting at each font.
- [x] TC-4230: Cancel part-way leaves the fonts already written in place and does not report success.

### The destination line
- [x] TC-4231: Export to a removable drive root and read the path line in the summary.
- [x] TC-4232: Clicking that line still opens the real folder.
- [x] TC-4233: Export to an ordinary folder on a fixed drive.

## 324. A deleted font takes its hash manifests with it — [B-310]

### The ordinary delete
- [x] TC-4234: Delete a font whose source backs only it.
- [x] TC-4235: All four counts drop by one.
- [x] TC-4236: Delete a font off a shared source (any one CAL colour).
- [x] TC-4237: Tick export the source first and confirm.

### 🚨 The case that was permanent
- [x] TC-4238: A source folder removed outside the app.
- [x] TC-4239: A removal that fails partway.
- [x] TC-4240: The control for TC-4239, and it must be run with it.

### The sweep
- [x] TC-4241: A plain call removes nothing.
- [x] TC-4242: `{ remove: true }` reclaims the listed manifests and leaves every live one alone.
- [x] TC-4243: A library folder with no `meta.json`
- [x] TC-4244: A missing store is a skip, not an all-clear.
- [x] TC-4245: Check its answer against a count you made yourself
- [x] TC-4246: The destination named in the delete summary is a link that opens the real folder, and the size shown matches the archive actually written.

### 🚨 The third bucket — common folders
- [x] TC-4247: Delete a common folder.
- [x] TC-4248: Remove a common's folder outside the app, leaving its manifest, then delete that common in the app.
- [x] TC-4249: The sweep reports and removes orphans in the commons bucket, and the bucket counts reconcile: common folders on disk equals manifests under `.filehashes\commons\`.
- [x] TC-4250: The control for the shared rule.

## 325. A common folder is handled like a font, and packs show their picture — [B-493]

### The source modal for a common folder
- [x] TC-4251: Right-click TRON_Kevin_Flynn in the sidebar → Edit source….
- [x] TC-4252: In that modal, then open a font source (Grim).
- [x] TC-4253: The common row has + Duplicate from source below the list, and right-click on the row offers Edit, Duplicate, Delete, plus Duplicate from source when it is Customized.
- [x] TC-4254: Add a file to HAL_9000, then delete that same file.
- [x] TC-4255: Hover Customized on a common row.

### Opening a modal
- [x] TC-4256: Open Fallen_Order_CAL_Bundle's source (from CAL_RED → Edit source…).
- [x] TC-4257: Open a small source (TRON_Kevin_Flynn).
- [x] TC-4258: Cancel on the busy card leaves the previous modal up and opens nothing.

### Pictures
- [x] TC-4259: Edit source on TRON_Kevin_Flynn shows Kevin Flynn top-right in the top box, level with the Acquired row; rows beside it narrow and Notes below it keeps the full width.
- [x] TC-4260: Grim's font modal and source modal show the BVM logo the same way.
- [x] TC-4261: Hover K.I.T.T.
- [x] TC-4262: Play `battlevl.wav` from TRON_Kevin_Flynn: the player shows Kevin Flynn on the left at its full height.
- [x] TC-4263: Click the picture in the player.
- [x] TC-4264: Copy an image, select HAL_9000's files and press Ctrl+V: `hal-9000.png` is added and selected; paste again and it is `hal-9000_2.png`, never `hal-9001.png`.
- [x] TC-4265: Double-click a `.png` or `.jpg` in any Files panel: it opens in the viewer instead of "Cannot open this here".

### Several common folders at once
- [x] TC-4266: Select three common folders, right-click one: Paste and Paste image act on all three; Rename and Duplicate are absent; Export common folder… is greyed out; Export source (n)… counts distinct sources; × Delete (3).
- [x] TC-4267: Delete (3) shows one confirm listing the three, says which sources leave with them, and offers Export source(s) first when one would.

### Voicepacks
- [x] TC-4268: Download Voicepack → More → Additional Voicepacks shows the chooser with Open in my browser (outlined, left) and Open in JMT Studio (blue, right).
- [x] TC-4269: The Darkwolf link opens straight in the browser, with no chooser.
- [x] TC-4270: Ronin_Sabers' Luke Skywalker pack imports with a blank creator, not Brian Conner.
- [x] TC-4274: [B-492] Import a voicepack zip that is already in the library (Common Folders → + Import → Pick zip file… on `ProffieOS_V2_Voicepack_Skoll.zip` from Downloads).

## 326. A source's files open inside its lone folder — [B-504]
- [x] TC-4271: Edit source on The_Prodigal_Butcher: Files opens on its contents (_Extras, Asteria, CFX-GHv3, Proffie, Verso, Xeno3, _ReadMe.rtf) with a single `The_Prodigal_Butcher` crumb and no level above it.
- [x] TC-4272: Edit source on font-forgotten: Files opens inside `Forgotten`, and the label reads `font-forgotten › Forgotten`, with font-forgotten clickable to go up.
- [x] TC-4273: The library picker (Add from library on The_Prodigal_Butcher's font) opens the same way: one crumb, not the name twice.

## 327. A voicepack bundle imports one common folder per pack — [B-509]
- [x] TC-4275: Common Folders → + Import → Pick zip file… on `ProffieOS_Voicepack.zip`.
- [x] TC-4276: Import `TEST_Multi_Pack_Bundle.zip`.
- [x] TC-4277: The Importing common folder card appears the moment the name is confirmed, with no silent gap, and stays one phase until the summary.
- [x] TC-4278: The summary lists three common folders, one per pack, named `ProffieOS_V2_Voicepack_ChineseA`, `…_English_B`, `…_English_C` (with `_2` if already present), and Edit source on any of them shows Common folders from…

## 328. Deleting a common folder's source deletes its common folders — [B-510]
- [x] TC-4279: Edit source on the TEST_Multi_Pack_Bundle source → Delete source….
- [x] TC-4280: Delete one common folder whose source nothing else uses: its source goes in the same action, with no refresh or restart needed for it to disappear.

## 329. A copy of the library keeps its shared files shared — [B-503]
- [x] TC-4281: `node test/link-copy.test.js` passes, including its control: an ordinary copy keeps every file's content and fails the sharing check.
- [x] TC-4282: Copy the dev library with `copyTreePreservingLinks` into an empty folder on the same drive: it reports `linksPreserved: true`, the copy takes the same space on disk as the original (2.217 GB on 2026-10-20, against…

## 330. An import keeps what a font's export carried — [B-513]
- [x] TC-4283: Bulk-import an exported zip whose font has a creator, demo link and tags.
- [x] TC-4284: Same zip through + Import Sound Font: the font keeps its tags and description too.
- [x] TC-4285: Export a source where only your CUSTOMIZED copy was kept (the vendor original never imported), delete it, bulk-import the zip: only the customized font comes back, still Customized, and the source stays.
- [x] TC-4286: Export a source holding a font and your customized copy of it, delete, bulk-import: the original is NOT flagged Close match to its own customized copy.
- [x] TC-4287: A font renamed before export comes back under that name from a bulk import; a name typed in the guided review still wins over it.
- [x] TC-4288: `node test/bulk-import-keeps-curation.test.js` and `node test/bulk-import-own-source-not-duplicate.test.js` pass.

## 331. A backup is a real restore, and it stores each file once — [B-498]
- [x] TC-4289: Backup ▾ → Export Backup
- [x] TC-4290: Snapshot the library (`node local/backup-roundtrip.js --snapshot --work <dir>`), delete every font, source and common folder in the app, Import Backup → Replace from that zip, then `--compare`: no file missing or…
- [x] TC-4291: The Replace summary opens OVER the progress window (no frame of the bare library between them) and its last line goes from "Measuring the library…" to the library's real figures, the same ones the footer settles on.
- [x] TC-4292: Replace over a full library: the window stays responsive throughout (no "Not Responding" in the title bar); the stall log shows no long block in `sfBackup:surveyMerge`.
- [x] TC-4293: After any restore the footer never shows the size from export time: it reads "Measuring library…" or the fresh figure.
- [x] TC-4294: `node test/survey-merge-yields.test.js`, `node test/backup-drops-size-stamp.test.js`, `node test/backup-stores-once.test.js` and `node test/pool-survives-backup.test.js` pass.

## 332. Every import message states sizes in the footer's terms — [B-514]
- [x] TC-4295: Bulk-import two or three zips into a library: the summary reads "Your source files total X in your library (Y compressed), stored in only Z on disk.
- [x] TC-4296: The same sentence ends a single + Import Sound Font, a common folder import, and Add from folder… ("Your folder totals X in your library…").
- [x] TC-4297: Import from a plain folder: no "(… compressed)" in the sentence.
- [x] TC-4298: A tiny import below the brag gate: "…total X in your library, stored in Y on disk." with no "only", no "saved you", no explanation sentence.
- [x] TC-4299: A bulk run that brings in a common folder and a tracks folder beside fonts counts them in the sentence; a customized font riding an export counts its edits on disk.
- [x] TC-4300: Restore summaries (Replace and Merge) end with "Measuring the library…", replaced by "Your library now totals X of files, Y on disk." with the footer's figures.
- [x] TC-4301: `node test/import-sizes-match-footer.test.js` passes: the import's total and on-disk figures equal the footer's to the byte on a fresh library.

## 333. Fonts in one bulk run share what they have in common — [B-515]
- [x] TC-4302: Bulk-import `Dagen.zip` and `Cere.zip` together into a library holding neither: the 138 contents they share are stored once (2026-10-21: 1.24 GiB linked) and the summary's saving shows it.
- [x] TC-4303: Each source keeps its own sounds as its own; nothing from one source replaces a file that differs in the other.
- [x] TC-4304: `node test/bulk-batch-cross-links.test.js` passes (analyze → commit, two fonts sharing tracks).

## 334. Shift and Ctrl selection on the font grid — [B-477]
- [x] TC-4305: Shift+click and Ctrl+click on cards paint no blue text-selection highlight anywhere — not on cards, the toolbar or the filter row.
- [x] TC-4306: Ctrl+click BLUE_MAIN, then Shift+click a card further down: every card between is selected.
- [x] TC-4307: Clear the selection, then Shift+click a card: only that card is selected (no range from a card picked before the clear); a second Shift+click ranges from it.
- [x] TC-4308: Right-click a card to select it, then Shift+click another: the range runs from the right-clicked card.
- [x] TC-4309: Shift+click ADDS a range to an existing selection (several segments, one Shift+click each).

## 335. General polish, 2026-10-21 — [B-516]
- [x] TC-4310: Select every font and press Delete (N): the dialog appears at once (measured 7-13 ms).
- [x] TC-4311: Delete every font, source and common folder: the count beside the search reads blank and the Needs review / New buttons are gone over the empty library.
- [x] TC-4312: Right-click a card near the bottom of the window with a selection: the menu opens upward and is fully visible.
- [x] TC-4313: With nothing selected the top bar shows Clear New (N); select any font and it is replaced by the selection's own Clear New (N) — never both.
- [x] TC-4314: Right-click a card: Tags… (one) or Tags (N)… (selection) opens the Tags window, 600px wide, its hint on two lines.
- [x] TC-4315: In the Tags window type `free` for a selection: every selected font becomes free (green chip), no "free" tag is stored, and a plain "free" tag already on a selected font is removed.
- [x] TC-4316: Set a source's creator to a known one (KSith) from the source window, and on another from the font window: its website fills in.
- [x] TC-4317: One active filter shows Clear all in both the Sound Fonts and Style Library filter bars.
- [x] TC-4318: The toolbar button reads + Create Shared Tracks; its tooltip says it is a folder.
- [x] TC-4319: `node test/known-creator-website.test.js` and `node test/mark-seen-bulk.test.js` pass.

## 336. Images: a source has its own, a font's is the font's — [B-511]
- [x] TC-4320: Open a bundle source with no image set: it shows the creator's top-level image when the download has one, otherwise one borrowed from a font that has its own.
- [x] TC-4321: On that bundle, + Add an image (picker opens in Pictures): it becomes the source's image, the button reads Replace, the chip names the file.
- [x] TC-4322: Open the image from the chip: the viewer offers Remove image; remove it and the source falls back to the creator's or a borrowed one.
- [x] TC-4323: Paste with an image on the clipboard sets it; with none, the word flashes red and fades back, with no toast or dialog.
- [x] TC-4324: A font with no image of its own shows its source's OWN or creator image, never a sibling font's; its row's chip is empty and the button reads + Add (tooltip: the source's image stays for its other fonts).
- [x] TC-4325: Add an image in a FONT window: it is written into the font's folder (named like a paste), the font is NOT marked Customized, and its source's image is untouched.
- [x] TC-4326: ONE FOR ONE: a source with a single font or common folder shows that item's own image over the creator's, and its source window's Image row writes into that item's folder.
- [x] TC-4327: Proof of purchase counts and lists are unchanged by a source image; it never appears as a receipt.
- [x] TC-4328: Export source…
- [x] TC-4329: Hover a preset's FONT NAME in Config Manager: the image card appears after a moment (a borrowed one too); hovering the rest of the row, the Font Folder field or a dropdown entry shows nothing.
- [x] TC-4330: Delete a source with an image of its own: the image file leaves the attachments store with it.

## 337. Voicepacks from a link, and finding things in the in-app browser — [B-494]
- [x] TC-4331: Download Voicepack → More → pick The Crucible's list → In app: the thread opens in the in-app browser; click a pack's download link and the zip is caught and imported as a common folder (a multi-pack zip gives one…
- [x] TC-4332: Download Voicepack → V2 → every language and variant, English F and G included, installs straight from the dialog ("Installed as …"); none opens a browser.
- [x] TC-4333: In the in-app browser press Ctrl+F: a find bar docks top-right.
- [x] TC-4334: A word not on the page: "No matches" and the box turns red.
- [x] TC-4335: Move and resize the browser window: the bar stays in its top-right corner.
- [x] TC-4336: On The Crucible's Additional Voicepacks thread the bar shows Whole thread; type `darth` and press it: the forum's search lists posts from that thread only (74, 127, 134, 145 on 2026-10-21) and clicking one goes to…
- [x] TC-4337: On a page that is not a Discourse thread (a creator's shop, Dropbox) there is no Whole thread button.

## 338. Identical files held apart are re-linked on their own — [B-501]
- [x] TC-4338: `node test/relink-library.test.js` passes: two copies of the same tracks become one stored copy, every file reads byte for byte as before, a stop changes nothing, an interrupted run's leftover is removed, and a file…
- [x] TC-4339: Copy a font's source folder files by hand so the library holds a second copy (or restore a library onto another drive and back): after the next import or restart the footer's on-disk figure falls by the duplicate's…
- [x] TC-4340: Start an import, export or backup while a sweep could run: the sweep does not start, or stops between files; the operation is unaffected.
- [x] TC-4341: On an unchanged library the sweep does not run again (no second 17 s pass after a refresh that changed nothing).

## 339. The creator's website on the font page — [B-486]
- [x] TC-4342: Open a font whose creator has a website (Inquisitor_2, Juansith): the header shows Website before Demo and Link, and Website opens the creator's site, the same one the source page shows.
- [x] TC-4343: Open a font whose creator has no website (Techno, Unknown): no Website button and no gap where it would be.
- [x] TC-4344: Add or clear the creator website on the source page, then open one of its fonts: the font page follows.

## 340. Fonts renamed in one save: case, reuse and swap — [B-517]
- [x] TC-4345: `node test/entry-rename-case.test.js` and `node test/entry-rename-batch.test.js` pass.
- [x] TC-4346: Rename a font to a different capitalisation of its own name (CAL_CYAN to Cal_Cyan), from the font page and from the source window: it saves, and the card and folder carry the new case.
- [x] TC-4347: In the source window, swap two fonts' names (Cal_Blue and Cal_Cyan) in one Save: both rename, each keeps its own files, no error.
- [x] TC-4348: In one Save, rename A to B and B to a new name: both go through.
- [x] TC-4349: In one Save, give two fonts the same name, or a name another font outside the save holds: the save says why and renames nothing; descriptions edited in the same save still save.

## 341. Edit source… from the card menu — [B-518]
- [x] TC-4350: Right-click one font: Edit source… sits above Export source… and opens that font's source window directly; closing it returns to the grid, not a font page.
- [x] TC-4351: Select several fonts from one source (the nine CAL fonts) and right-click one: Edit source… shows.

## 342. Sticky Match B1: a matched color follows B1 — [B-519]
- [x] TC-4352: `node test/color-match-sticky.test.js` passes.
- [x] TC-4353: On B2, click Match B1: the button becomes "Matches B1".
- [x] TC-4354: Change B1's style to one with a different color: the matched B2 color follows it.
- [x] TC-4355: Pick another color on B2, then change B1: B2 stays.
- [x] TC-4356: A B2 color left at its default that equals B1's shows "Matches B1" and moves when B1 changes (the new color is written in).
- [x] TC-4357: A blade that Follows B1 (whole style) still follows; the color match does not double-write it.

## 343. Copy a blade's style to other presets and blades — [B-222]
- [x] TC-4358: `node test/copy-style-wrapper.test.js` passes.
- [x] TC-4359: Right-click a blade tile: Copy to all presets (N), one Copy to <bank> presets (N) per bank when there are several (the bank being edited first), Copy to preset ▸, Copy to blade ▸.
- [x] TC-4360: Copy to preset ▸ lists banks (current first), then that bank's presets; with one bank it lists presets directly.
- [x] TC-4361: Copy to blade ▸ names blades "Blade 1 (B1)", or by their name and badge ("Main Blade (MB)") once named.
- [x] TC-4362: Copy a B2 wrapper (PixelSwitchWrapper<…BlueBaseColor>) to all presets: each preset's B2 wraps its OWN B1.
- [x] TC-4363: A B2 color matched to B1 at the source arrives matched in each target: it takes that preset's B1 color (black where B1 is empty) and follows when B1 changes.
- [x] TC-4364: Copy a B1 onto presets whose B1 has a real color with B2 matched to it: B1 keeps that preset's color and B2 stays matched.
- [x] TC-4365: Copying over styles in more than one preset asks first; one undo reverts the copy and everything it carried; the toast counts presets copied to and those that already had it.
- [x] TC-4366: Nothing is written into the config to record a copy (one-shot): editing a copied blade later changes only that preset.

## 344. Shared folder on or off across presets — [B-278]
- [x] TC-4367: Config using one shared name: right-click the common checkbox shows "Use common in all presets (N)" and "Remove common from all presets (N)", N = every preset, hidden when nothing would change.
- [x] TC-4368: Config using several (common, commonSith): "Use <name> in" per name, the selected preset's own name first, then "Remove shared folder from"; each opens This preset, All presets (N), then each bank (current first).
- [x] TC-4369: Each action is one undo; the toast says how many changed and how many already had it.

## 345. Compile during the cache check, and its tooltip — [B-470]
- [x] TC-4370: Switch between a compiled and an uncompiled config: Compile never blinks (no disable while the cache check runs).
- [x] TC-4371: Click Compile while the check is in flight (console: cacheCheckPending = true): no build starts, and the button shows the red ring and border fading in and out over 3 s (the Paste image cue).
- [x] TC-4372: Live Compile tooltip: "Compile and flash this config to the Proffieboard on COMn." with a board on a port; the DFU wording in bootloader mode; "Compile this config into firmware for your board.
- [x] TC-4373: Hold the pointer on Compile through a cache check: the tooltip text changes in place to the answer without leaving the button.

## 346. Font and source windows commit as you go; Style Library has one commit — [B-496] [B-135]
- [x] TC-4374: Entry detail has no Save; the bottom button reads Close.
- [x] TC-4375: Closing entry detail with a field still open asks; with none open it closes silently.
- [x] TC-4376: Rename a font onto a name another font has: the refusal says why and the old name comes back.
- [x] TC-4377: Clicking the name, creator, acquired date, description or last style opens it for editing, the same as its pencil; the value shows a light hover.
- [x] TC-4378: Source detail: no Save, fields, tags and notes commit as they change; a tag added on the source reaches every font from it, and is not added again by a later change.
- [x] TC-4379: Source "Fonts from this source": open two rows, swap their names, Apply (2): both rename.
- [x] TC-4380: Style Library keeps Save; name, source and URL have no check mark and close on Enter or leaving the field.

## 347. A source's Download: where its copy is downloaded again — [B-487]
- [x] TC-4381: `node test/download-link-pick.test.js` passes.
- [x] TC-4382: The import step shows Download under Website and Link, with paste and clear.
- [x] TC-4383: The source window shows a Download button beside Website and Link when set, opening it; the link editor has Website, Link and Download rows.
- [x] TC-4384: Kyberphonic-style link (a document holding a Dropbox link): Download is the Dropbox share link, not the pasted document.
- [x] TC-4385: A free BVM font through the in-app browser, even with the premium tab last chosen: Download and Link are both https://www.bvm-sabers.co.uk/fonts.
- [x] TC-4386: Installing a catalog voicepack records its catalog link as Download; a custom voicepack through the browser records its share link.
- [x] TC-4387: Export a source with a Download link and no receipt: the zip-archive box reads "Include download link with zip archive"; cleared, the export carries no Download.
- [x] TC-4389: Select a DISABLED preset in the Config Manager: its detail shows "Styles (N blades)" with a tile per style (it showed none before 8cd0f7e).

## 348. Right-click in the in-app browser: Link, Demo and proof of purchase — [B-521]
- [x] TC-4390: `node test/youtube-moment-link.test.js` passes.
- [x] TC-4391: In the import browser, right-click a link: Copy link URL, Save as Link, Save as Demo, and (below a line) Save page as proof of purchase (PDF).
- [x] TC-4392: No proof-of-purchase item on a forum thread, discord.com, or a cloud drive (Google Drive or Docs, Dropbox, OneDrive, Mega, Box).
- [x] TC-4393: Each save adds a row to the strip at the bottom (name, value; hovering the name explains it) and a toast in its bottom-right corner.
- [x] TC-4394: Saves in the import browser reach the review: Link into Link, Demo onto the first font, the PDF attached as proof of purchase before the review lists it.
- [x] TC-4395: Close the import browser after saving a PDF and before any download: the PDF's temp folder is gone from %TEMP% (no jmt-linkimport- left by it).
- [x] TC-4396: A link import that starts on a known creator's site, with nothing in the font naming one: the review says "Suggested: <creator>, from the site you started on." with Apply suggestion; nothing fills until it is applied.
- [x] TC-4397: Import review: "Open in app browser" beside Website shows only while Website holds an address (typed, pasted, applied from a suggestion, filled from the creator), and hides when cleared.
- [x] TC-4398: Open in app browser from the review: Save as Link fills Link at once; Save as Demo lists the CHECKED fonts by their current names (none checked: no Demo item; one: no submenu), with "All checked fonts" first when two…
- [x] TC-4399: YouTube: scrub a video (on youtube.com, and embedded on a creator page) to 2:31 and right-click: "Save as Demo at 2:31" beside Save as Demo, with the same font submenu; it saves youtube.com/watch?v=<id>&t=151s, which…
- [x] TC-4400: Font window and source window: right-click the Website chip, or the Link chip (opens the Link): "Open in app browser" (a left click still opens the normal browser).
- [x] TC-4401: Link wording: placeholder and label hover read "this font", "this font bundle" or "this voicepack" (import review, font window, source window).
- [x] TC-4388: (from section 347) Buy a BVM premium font in the in-app browser and save its success page as proof of purchase before clicking Download: Download is the checkout-success page with its session id, the PDF holds the…

## 349. Free content is the creator's public offer, confirmed by the user — [B-146]
- [x] TC-4402: Tick Free content in the import review: "Mark as free content" asks to confirm the creator offers it free of charge, publicly, to anyone.
- [x] TC-4403: The same confirmation on typing "free" as a tag in the font window, the source window and the bulk tag editor (asked as it is typed, not at Apply).
- [x] TC-4404: For a source with several fonts, the confirmation ends "This marks all N fonts from <source> as free." (the bulk editor counts every font in the sources the selection touches, "from N sources" when several).
- [x] TC-4405: A known free-only creator (JMT Sabers' own fonts) still pre-fills Free content with no confirmation.

## 350. Hovers, private Download, and two fixes found in testing, 2026-10-22
- [x] TC-4406: Every label in the import review's source section has a hover saying what the field is; Website and Link on the source window too.
- [x] TC-4407: Open a field or the link row on a font and change nothing, then go to the source, close the window, or click the backdrop: no "Unsaved Changes" prompt.
- [x] TC-4408: A bundle whose fonts all carry "creator missing": fill the creator on one font and mark it reviewed; every other font from that source loses the flag too (this never ran before).
- [x] TC-4409: Source window, right-click a font row, Add from folder: the new font starts with the original's tags, Demo, description, notes and last used style (creator, date, free, Link and proof come from the shared source).
- [x] TC-4410: Source window, open a font row for editing and change nothing: Apply shows but is greyed out, and closing asks nothing.
- [x] TC-4411: Source window, right-click a font row, Delete: the confirm opens OVER the source window, which stays visible behind it.
- [x] TC-4412: `node test/saved-link-session-params.test.js` passes.
- [x] TC-4413: Counts of two read "both": the free confirmation, the Link hover, "Clear the New badge on both fonts", deleting a blade from both presets ("Both Presets"), removing a proof of purchase shared by two sources ("or from…
- [x] TC-4414: Sound Fonts toolbar: with nothing selected, Select all and Select in-use show; select any card and both hide (Clear selection and the selection actions take the row); clear it and they return.
- [x] TC-4415: Open a config, go to Sound Fonts: In use and Select in-use show the right count at once, no flash.

## 351. An interrupted flash says what it is waiting for, and offers Flash Now only when it can — [B-289]
- [x] TC-4416: `node test/flash-error.test.js` passes (it runs the functions from toolchain.js itself).
- [x] TC-4417: Pull the cable mid-flash so the port does NOT come back (around 57% on a V3): the window says what happened, that the board is fine, and "Waiting for the board.
- [x] TC-4418: Pull late so the port DOES come back (around 86%): the window starts on the waiting line, and when the board is back on its port it changes to "The board is connected again." with ⚡ Flash Now, without being touched.
- [x] TC-4419: From the waiting state, put the board in bootloader mode (BOOT + RESET): within about two seconds "The board is in bootloader mode." and ⚡ Flash Now, which flashes through Bootloader Mode.
- [x] TC-4420: After Flash Now succeeds, the window reads ✓ Flash Complete and stays that way when the board reappears on its port (the old failure is never redrawn over it).
- [x] TC-4421: Click Flash while the port is listed but the board is not answering yet (right after an interrupted flash): the log says "<port> is listed, but the board is not answering on it yet.
- [x] TC-4422: [B-522] Flash in Bootloader Mode (DFU) and pull the cable mid-flash; plug it back so the board restarts on its port.

## 352. Copy and export the serial log — 2026-10-22
- [x] TC-4423: Serial Monitor with no history: no copy or export.
- [x] TC-4424: ⧉ copy puts every received line on the clipboard (lines hidden by a filter included) and says how many.
- [x] TC-4425: ⤓ export writes `YYYY-MM-DD_HHMMSS_<config>_serial.txt` to Downloads, with a header (saved time, config and path, description, board, OS version, prop, USB, port, board serial, what the board reports, JMT Studio…
- [x] TC-4426: Build Output has the same ⧉ copy and ⤓ export beside ✕ clear once it has text (compile and flash runs alike, everything in the panel), saving `…_<config>_build.txt` under a "JMT Studio build output" header.

## 353. The Style Library toolbar matches Sound Fonts: sort and In use — [B-286]
- [x] TC-4427: The toolbar reads search · count · sort · divider · Tags · Effects · In use · + Add Style.
- [x] TC-4428: Sort → Name: A–Z; pick Name again: Z–A; File order returns the file's order.
- [x] TC-4429: With a config open that uses some styles, In use shows with a count matching the blue in-use cards; clicking it shows only those, and Not in use appears beside it.
- [x] TC-4430: An In use / Not in use filter shows as a chip under "Filtering by:", its ✕ removes it, and Clear all clears it with the rest.
- [x] TC-4431: Style Library Tags and Effects dropdowns stay open on a pick, as on Sound Fonts.
- [x] TC-4432: Style Library "Filtering by:" groups chips like Sound Fonts: SEARCH, TAG, EFFECT, WITHOUT, each labelled, "or" between picks in a group, "and" between groups, In use after them.
- [x] TC-4433: Font window Files header and the tracks window: "+ Add" is the same height as Reorganize, + Folder and Export beside it.

## 354. A font's files show how they stand against its source — [B-313]
- [x] TC-4434: A font straight from its source: no coloured names in Files.
- [x] TC-4435: Rename a file in the font: it shows in blue under the new name, hover "Customized: renamed from <old>", and the old name is not listed.
- [x] TC-4436: Delete a file in the font (through the app): it stays listed in grey, hover "Removed ...
- [x] TC-4437: Delete a file from the font's folder OUTSIDE the app, then open the font: it is listed in red, hover "Missing: this font had it, and it is no longer on disk ..."; it stays red on reopening (never turns grey); Add…
- [x] TC-4438: Folders follow the files: a new folder is blue ("a folder the source does not have"); a renamed folder is blue ("renamed from <old>") and the old name is not listed; a folder with any change inside is blue, its hover…
- [x] TC-4439: In each folder of the Files list, grey (removed) folders and files come after everything else, folders before files within them; Shift-click range selection skips them.
- [x] TC-4440: A font with removed files shows "Customized · hide removed (N)" at the bottom left.
- [x] TC-4441: In a font's Files list, Ctrl-click a folder: it highlights and stays where you are (no navigation).
- [x] TC-4442: With two folders and a file selected, right-click one of the folders: Copy (3), Export (3), New folder, Delete (3); no Rename.
- [x] TC-4443: Delete a selection of 1 folder and 2 files (menu or Delete key): the confirm reads "Delete 1 folder and 2 files" and says folders go with everything inside them; afterwards all three are gone, the folder with its…
- [x] TC-4444: Copy a selection holding a folder and a file, paste into another font: the folder arrives whole, with its contents.
- [x] TC-4445: Drag a selected folder (alone, or with files) onto another folder row: it moves inside, whole.

## 355. A short preset's missing blades can be placed, filled and moved — [B-355]
- [x] TC-4446: Open a preset with 2 of 4 styles: the header reads "Styles (2/4 blades)" in red and the two missing blades show as red Missing tiles with their blade badge.
- [x] TC-4447: In B355_Test_A, Yoda: drag the B3 Missing badge up onto B2.
- [x] TC-4448: Drag a Missing badge below a filled style in the same preset: the style moves up and the placeholder takes its place, in that preset only.
- [x] TC-4449: Click a Missing tile in the middle of a preset: the new style lands in THAT slot, not after the last style.
- [x] TC-4450: x on a filled style resets it to Black; x on that Black makes the slot Missing again.
- [x] TC-4451: In B355_Test_A, drag a filled blade on a complete preset (Windu) to another position: every preset moves it, the short ones through their gaps (Yoda keeps each colour on its blade), names renumber once, and the toast…
- [x] TC-4452: In B355_Test_B, drag the B3 Missing badge in any preset up to B2: every preset becomes MB, Missing, CC, Missing and the names renumber once (a blade empty everywhere moves for all).
- [x] TC-4453: In B355_Test_B, fill B3 in the first preset only, then drag a B3 Missing badge in the second preset: only that preset changes and no names move.
- [x] TC-4454: With a follower set (e.g. B2 follows B1), move a blade into position and set it to follow: every preset receives the followed style, and the existing styles stay on their own blades.
- [x] TC-4455: Undo after any of the drags above restores the file in one step.

## 356. Copying onto B1 keeps the preset's color; a default color can be matched — [B-519]
- [x] TC-4456: `node test/color-copy-keeps-preset.test.js` passes.
- [x] TC-4457: Set B2's color in a few presets whose B1 is still empty (Black), then copy B1 from another preset to all presets: each B1 arrives in its own preset's B2 color, not the source's.
- [x] TC-4458: Copy a style onto B1 of a preset whose B1 already shows a color (set or default): the copy keeps that color.
- [x] TC-4459: B1 Kestis set to white, B2 pixel switch left at its default white: B2's color row shows "Matches B1".
- [x] TC-4460: With B1's editor open, change its color, then click straight onto B2: B2 opens with the new color and "Matches B1", never "Match B1".
- [x] TC-4461: Works the same on a plain pixel switch style and on a wrapper around B1.

## 357. The compile check counts a Missing placeholder as missing — [B-525]
- [x] TC-4462: `node test/blade-count-preflight.test.js` passes.
- [x] TC-4463: In B355_Test_A, place a Missing placeholder inside Vader (drag its gap up, or x twice on a blade) so all four slots are written, and compile: the dialog still names vader.
- [x] TC-4464: Yoda with one placeholder and two styles is counted as 2: with mixed counts the dialog reads "fewer than 4 blade styles"; Vader alone reads "1 preset has 3 of 4 blade styles".
- [x] TC-4465: A config with every slot filled (Black counts as filled) compiles with no dialog.

## 358. Close X's are the quietest thing in their dialog — [B-526]
- [x] TC-4466: Open Import Sound Font: the X at the top right is a faint grey, clearly dimmer than the title and body text, and brightens with a hover background when pointed at.
- [x] TC-4467: The same on a sample of other dialogs: font detail, source detail, New config, Link a Prop, Download Voicepack, Reorganize, the audio player.
- [x] TC-4468: The preset side panel's ‹ (PRESETS STYLES header, right of Auto) and the OS Versions file viewer's X are the same faint grey and brighten on hover.
- [x] TC-4469: Every X still works: click closes its dialog the way it did before.

## 359. Importing a Style Library from a file saves it — [B-527]
- [x] TC-4470: Style Library > Create > Import from file, pick a my_styles.h: after the import Save and Discard are disabled and no unsaved marker shows.
- [x] TC-4471: Import a file with two styles of the same name: the conflict is shown and the library stays unsaved (Save lit, disabled until the conflict is resolved), with no "Cannot save" error.
- [x] TC-4472: Create > Blank is unchanged: a new empty library, nothing unsaved.

## 360. The audio player opens full size with sound coming in — [B-528]
- [x] TC-4473: Click a long wav (a hum or a track): the player opens at its final size at once, play greyed, time 0:00 / –:––, and the waveform area shows a wave of blue bars travelling left to right.
- [x] TC-4474: When the file is ready the bars fade out as the real waveform fades in over the same spot.
- [x] TC-4475: The waveform area cannot be clicked and play cannot be pressed until the file is ready.
- [x] TC-4476: A font with an image: the player opens with the image already in place, at full width.
- [x] TC-4477: Click another file of the same font while the player is open: the image stays put, the player does not narrow and widen.
- [x] TC-4478: Click a file from a font with no image after one with an image: the player is the narrow size, no empty space where the image was.
- [x] TC-4479: A wav that is not audio (a renamed program, or a corrupt file) still shows its message in place of the player, with no bars left behind.
- [x] TC-4480: With Windows "Show animations" turned off, the bars stand still instead of travelling.

## 361. A card is read by its fonts; SNV4 cards are named — [B-461]
- [x] TC-4481: An SNV4 card with 27 Proffie-format fonts: the list and the report say it appears to be SNV4 and that 27 fonts can be added; Import fonts to library imports them
- [x] TC-4482: Fixture A: the same SNV4 wording with 5 fonts.
- [x] TC-4483: Fixture B (real Xeno shape, one font with a stray boot.wav): "This looks like a Xeno ..., not Proffie." and 0 sound fonts.
- [x] TC-4484: Fixture C (older Xeno, no fontconfig.ini): still Xeno, 0 sound fonts, bulk finds 0.
- [x] TC-4485: Fixture D: "This is a Xeno ...
- [x] TC-4486: Fixture E (blaster fonts, no hum anywhere): Proffie, 2 sound fonts.
- [x] TC-4487: Fixture F: VoicePrompts (voice prompts only) is not counted or offered; 1 sound font.
- [x] TC-4488: Fixture G (numbered banks + common, nothing else): Proffie, 3 sound fonts, no "another board" sentence, not reported as mixed.
- [x] TC-4489: Fixture H (named fonts in effect folders, no common): Proffie, 2 sound fonts (was "unrecognized layout").
- [x] TC-4490: Fixture I (leftovers, no SNV4 marks): Proffie, 2 sound fonts, detail names "config.ini, set/" as another board's settings files and does NOT name global.ini.
- [x] TC-4491: A card of named Proffie fonts reads exactly as before
- [x] TC-4492: A real Xeno backup reads as Xeno with 0 Proffie fonts

## 362. A wrapper whose inner fills from B1 takes B1's color too — [B-519]
- [x] TC-4493: On B2 with no wrapper, pick PixelSwitchWrapper in the Style Library: the inner fills with B1's style AND the wrapper's BASE_COLOR_ARG shows B1's color with "Matches B1", no click needed.

## 363. A shared build is released, not deleted, when one of its configs passes five — [B-209]
- [x] TC-4494: `node test/cache-eviction-releases-claims.test.js` passes.
- [x] TC-4495: Compile A, Save As B, then compile five different versions of B.
- [x] TC-4496: The same with the roles swapped (five versions of A, then B unchanged).
- [x] TC-4497: A sixth version of a config with no shared build still drops its oldest build, as before.

## 364. Add to config picks a bank; the new preset takes that bank's shared folder — [B-529]
- [x] TC-4498: Right-click a font card and hover "+ Add to config": the bank submenu opens with no click, also when the menu opens with the pointer already on that item.
- [x] TC-4499: The new sith preset's font reads "<font>;commonSith".
- [x] TC-4500: Several cards selected: all go to the picked bank, each with that bank's shared folder.
- [x] TC-4501: A one-bank config: "+ Add to config" is a plain item and a click adds, as before.
- [x] TC-4502: `node test/voicepack-preflight.test.js` passes.

## 365. The card menu's submenu closes with the menu — [B-533]
- [x] TC-4503: Open "Replace in config preset" (or the Add to config bank list), then press Escape or click outside: both the menu and the submenu close.
- [x] TC-4504: Click a bank header ("SITH") inside the submenu: nothing closes.

## 366. Duplicate from source does not offer to eject a zip — [B-535]
- [x] TC-4505: Duplicate fonts from source on a stored source: no "Imported 1 font from <name>.zip" toast.

## 367. Opening a font or source window — [B-537]
- [x] TC-4506: Open a font from a bundle (Tales): no half-second stall, no "Opening…" card.
- [x] TC-4507: Open a bundle source: the Files browser lists every file and empty folder as before, quickly.
- [x] TC-4508: Click to open: the working cursor shows at once.
- [x] TC-4509: Double-click a font card or a source name: one window opens.
- [x] TC-4510: Import a new source: its Included files (readmes) show in the font and source windows.

## 368. Every image added to a font or common folder is stored as PNG — [B-530]
- [x] TC-4511: Image row + Add with a JPG and a WebP: each lands as PNG under its own name, and the "Name added images" setting decides whether it becomes <font>.png ([B-571]: was always renamed).
- [x] TC-4512: Files + Add a JPG to the top of a font: arrives as PNG; asks Never rename / Keep original name / Rename / Always rename; the Image row updates without reopening.
- [x] TC-4513: The same into a subfolder: left as it is, no question.
- [x] TC-4514: Paste (Ctrl+V or Paste here) an image copied from a source into a font: PNG + the question.
- [x] TC-4515: Move an image from a subfolder to the top: converted, asked; the question's ✕ leaves the name as it is (a move cannot be taken back) and the setting stays Ask.
- [x] TC-4516: The question's ✕ removes everything that paste or add put in the folder.
- [x] TC-4517: Image row Paste after an in-app Copy of an image file: pasted under its own name, and the question asks ([B-571]: was always <font>.png).
- [x] TC-4518: A font's and a common folder's file list always end with a blank strip to right-click.

## 369. What an item shows is what its export carries; copies share — [B-534]
- [x] TC-4519: A copy of a font (Duplicate or Duplicate from source) with no image of its own shows the original's image, ahead of the source's; a different character in a bundle does not.
- [x] TC-4520: Export font folder on such a copy: the image is in the exported folder.
- [x] TC-4521: SD export it twice to the same card: the second treats it as up to date (no "differs"), and the image is not moved to an ORIGINAL folder.
- [x] TC-4522: A common folder copy exports its sibling's image.
- [x] TC-4523: Export source on a source showing a font's image: .jmt-curation/picture carries it.
- [x] TC-4524: A font with its own image exports exactly as before.

## 370. A source export carries every font's image and every copy — [B-536]
- [x] TC-4525: Export a bundle with no customized fonts: .jmt-curation/pictures holds each font's image; the sidecar lists further copies (Barriss_Inquisitor_2) under copies.
- [x] TC-4526: Delete the source and import the zip: every font comes back with its own image, and each copy comes back with its own name and details.
- [x] TC-4527: After that import, Duplicate from source does not recreate the copy a second time.
- [x] TC-4528: `node test/source-picture.test.js` passes.

## 371. SD Export puts the config on the card as my_config.h — [B-229]
- [x] TC-4529: Settings "Include the config with SD Export" on Ask: every SD Export with a config open asks "Put your config on the card?" Never include / Skip / Include / Always include, with a ✕ that cancels the export.
- [x] TC-4530: With the setting on, SD Export a config named az_duum_test.h: the card holds my_config.h (not az_duum_test.h), and the readme line reads "my_config.h the config this card was prepared for (az_duum_test.h)".
- [x] TC-4531: A my_config.h put on the card by hand (not by an export): it is overwritten, and the summary says it replaced a different my_config.h that was already on the card.
- [x] TC-4532: Only the app's own files are removed: a config an earlier export wrote under another name goes when it is unchanged; edit it on the card first and it stays, listed in the readme "from an earlier export, changed since".
- [x] TC-4533: Export again with the setting off: the card keeps the config it had, and the readme lists it "from an earlier export".
- [x] TC-4534: A config with an absolute include (C:/Users/.../my_styles.h): the card copy reads #include "my_styles.h"; commented-out includes too; relative includes unchanged.
- [x] TC-4535: The card's my_styles.h header reads "Styles used by my_config.h (<source>) · JMT Studio", the config's @jmt:description, and @jmt:created = the export date.
- [x] TC-4536: A config that uses no library styles: my_styles.h holds the one-line placeholder, under the same header.
- [x] TC-4537: The config goes only when every library font it uses is on the card once the fonts are written (this export or an earlier one); otherwise the summary says which fonts were missing.
- [x] TC-4538: A card already up to date ("Already up to date"): the config line is in the summary and my_config.h is written all the same.
- [x] TC-4539: Config not compiled: asked up front, Include it / Leave config out / Cancel.
- [x] TC-4540: The readme has TO BUILD THIS CONFIG (JMT Studio first: open, Append to the Style Library or Create Style Library, compile; then without JMT Studio: ProffieOS/config + CONFIG_FILE) and the credit "Copyright 2026" (or…
- [x] TC-4541: Slow-write warning on a card with a manifest that is already up to date (1800+ files): no warning.
- [x] TC-4542: `node test/sd-export-config-package.test.js`, `node test/sd-export-slow-warning-manifest.test.js` and `node test/used-styles-subset.test.js` pass.

## 372. The Style Library is included by name and staged beside the config — [B-542]
- [x] TC-4543: Link Style Library on a config: the line written is #include "my_styles.h", not the library's full path on this computer.
- [x] TC-4544: Compile: the build log shows "Styles staged to:" the selected version's config folder, and my_styles.h sits there beside the staged config.
- [x] TC-4545: With no Style Library, compile: a stale my_styles.h in that config folder is removed.
- [x] TC-4546: A config still carrying the old full-path link: compile shows the "Style Library link updated" notice after the save questions.
- [x] TC-4547: Both the old full-path form and #include "my_styles.h" count as linked; another file named my_styles.h at a different path is still reported as a conflict.
- [x] TC-4548: `node test/styles-include-by-name.test.js` passes.

## 373. After a board card is ejected, the app restarts the board — [B-545]
- [x] TC-4549: Card shared with `sd 1` from the app's Serial Monitor, eject from the summary row: status reads "Ejected.
- [x] TC-4550: Same from the eject toast: "Ejected.
- [x] TC-4551: A board card is never told "Safe to remove".
- [x] TC-4552: Another program holding the board's port: "Ejected.
- [x] TC-4553: Board not found, never comes back, or the reset was sent and it did not restart: "Ejected.
- [x] TC-4554: (changed 2026-10-27) Card NOT shared with `sd 1` from the app's Serial Monitor (shared from another program, or a board card in a reader): the eject keeps the 1 s stay-gone watch and sends no reset; status reads…
- [x] TC-4555: `node test/board-restart-after-eject.test.js` passes.

## 374. Use as track puts the track where the preset finds it on the card — [B-152]
- [x] TC-4556: Font file list, right-click a .wav, "Use as track for..." lists the config's presets by bank.
- [x] TC-4557: Picking a preset in ANOTHER font asks "Where should the track go?" with Add to font / Add to Tracks (X cancels).
- [x] TC-4558: The same file already in the destination is reused; a different file with that name lands beside it (track2.wav).
- [x] TC-4559: Preset's font not in the library: only Add to Tracks is offered, and the message says why.
- [x] TC-4560: The Tracks folder's rows have "Use as track for..." and set tracks/<name>, nothing moved.
- [x] TC-4561: A font with only a singular track/ folder: the track goes there, then "Rename to tracks/" / "Leave it" is offered; the rename rewrites every preset's track path into it in one undo.
- [x] TC-4562: `node test/use-as-track.test.js` passes.

## 375. The named-colour list sorts by colour or A-Z, and typing jumps — [B-539]
- [x] TC-4563: The colour picker's named-colour list opens in colour order with a Colour | A-Z switch on top.
- [x] TC-4564: With the list open, type "or": the first name starting "or" is marked and scrolled to.

## 376. Style Library card to config; blade names and follows are the saber's — [B-541]
- [x] TC-4565: Right-click a Style Library card with no config open: no config items.
- [x] TC-4566: "+ Add to config": a new preset at the end of the bank (a bank list on hover with several banks), the style on B1, the other blades as most of that bank's presets have them.
- [x] TC-4567: "Replace in config preset..." lists presets by bank, then the blades by name; picking one puts the style on that blade.
- [x] TC-4568: Any new preset (+ button, Sound Fonts card) fills blades 2+ with the bank's pattern, not StylePtr<Black>().
- [x] TC-4569: Two banks, names on only the first: the second bank's tiles show the same names.
- [x] TC-4570: Drag a blade to a new position: every preset in every bank moves, and the names move with it in both banks.
- [x] TC-4571: Delete an over-count blade position ("All N"): it goes from every bank's presets, and the names close up in both.
- [x] TC-4572: Turn follow on in one bank: the follower takes its leading blade's style in every bank's presets, and both banks carry the follow line.
- [x] TC-4573: Follower blades that are empty (StylePtr<Black>()) or red Missing placeholders: turning follow on fills them with no dialog.
- [x] TC-4574: Clearing a follow clears it in every bank; a bank whose only line it was is left with no blank line under its opening.
- [x] TC-4575: `node test/blade-names-saber-wide.test.js`, `node test/new-preset-pattern.test.js` and `node test/style-card-replace-blade.test.js` pass.

## 377. Presets moved to another bank keep the blank line between presets — [B-547]
- [x] TC-4576: Select two presets, Move to another bank: they land at its end with a blank line before and between them, whatever spacing the bank already has.
- [x] TC-4577: Move into an empty bank: no blank line under the bank's opening line, a blank between.
- [x] TC-4578: `node test/move-to-bank-spacing.test.js` passes.

## 378. A blade colour that matches B1 is shown muted — [B-549]
- [x] TC-4579: In a preset where B2 and B3 share B1's colour, their colour lines on the closed cards are muted and brighten on hover; B1's is full strength.
- [x] TC-4580: Change B2's colour by hand: its colour line and, on the open card, its swatch and arg name go to full strength, and the row shows Match B1.
- [x] TC-4581: A followed tile is not muted twice: its colour line reads the same as the rest of the tile.

## 379. Duplicate on the preset menu — [B-551]
- [x] TC-4582: Right-click a preset → ⧉ Duplicate (above Delete): the copy lands directly after it named `<name>_2`, same font, track and styles, a blank line either side, and is selected.
- [x] TC-4583: Duplicate the same original again: `<name>_3`, placed after the original.
- [x] TC-4584: Select two presets → Duplicate (2): each copy after its own original, a toast with the count.
- [x] TC-4585: Duplicate the last preset in a bank written with no trailing comma: the config still compiles.
- [x] TC-4586: `node test/preset-duplicate.test.js` passes.

## 380. The x in a link box clears the box; the check commits — [B-553]
- [x] TC-4587: Font page, open the links row, click x on Demo: the box empties and stays open with focus; nothing is saved yet.
- [x] TC-4588: Same on Edit source for Website, Link and Download.
- [x] TC-4589: Click x, then Escape: the row closes and the old link is still there.
- [x] TC-4639: Copy a web link.
- [x] TC-4640: Paste into a link box and press Save without the check: the pasted link is saved.

## 381. Closing a font stops the sound it was playing — [B-556]
- [x] TC-4590: Open a font, click hum (or any long sound), close the font: the sound stops at once.
- [x] TC-4591: Click a sound and close the font before it starts: nothing plays afterwards.

## 382. Paste an image, a Demo or a Link from a card's menu — [B-558]
- [x] TC-4592: Copy an image, right-click a card -> Paste image: the card's font gets it (Replace image with paste when it has its own).
- [x] TC-4593: Copy a web link, hover Update links: the submenu opens on hover.
- [x] TC-4594: With a Demo already set the item reads Replace Demo with paste.
- [x] TC-4595: Several cards selected: none of these items appear.
- [x] TC-4596: + Add to config with several banks opens its bank list on hover; with one bank it adds on click.
- [x] TC-4637: Each of Paste image, Paste as Demo and Paste as Link shows a toast naming the font (Added / Replaced), and Paste as Link on a bundle names "the N fonts from <font>'s source".

## 393. SD Export starts once, however many times it is pressed — [B-437]
- [x] TC-4638: Select fonts and DOUBLE-click (then triple-click) SD Export: one folder picker opens.

## 383. No creator defaults to free — [B-552]
- [x] TC-4597: Import a BVM Sabers font whose name does not say free: Free content is unticked.
- [x] TC-4598: Import a source whose name contains the word free: Free content is ticked.
- [x] TC-4599: `node test/vendor-bvm-readme.test.js` passes (no row in the vendor table defaults to free).

## 384. Every ProffieOS 8.10 effect is known — [B-557]
- [x] TC-4600: After the first launch on an existing library, the log says how many entries were recomputed; the next launch recomputes none.
- [x] TC-4601: Effects filter: slsh is not italic; ccbegin, ccend and quote appear with counts; no italics remain on a library with only real effects.
- [x] TC-4602: Show missing on a font still lists only saber-font effects (no blaster or armor effects).
- [x] TC-4603: `node test/effects-full-vocabulary.test.js` passes.

## 385. Image on hover over a font's name in the library and its source — [B-511]
- [x] TC-4604: Hover a library card's font name: its image shows beside the card; on the right-hand column it shows to the left.
- [x] TC-4605: In a source window, hover a name under Fonts from this source: the image shows beside the name, above the window.

## 386. The app browser's title names the font — [B-521]
- [x] TC-4606: Right-click Website or Link on a font -> Open in app browser: the title reads "<font> · <page title>" and keeps the font's name as you move between pages.
- [x] TC-4607: From Edit source the title starts with the source's name; from the import review it shows the page title alone.

## 387. Selecting text off the side of a field does not close the window — [B-559]
- [x] TC-4608: In a font window, select a field's text and release the mouse on the dimmed backdrop: the window stays open, the selection made.
- [x] TC-4609: Click the backdrop itself: it closes (or prompts, when something is unsaved) as before.
- [x] TC-4610: `node test/backdrop-drag-release.test.js` passes.

## 388. The image viewer sizes to the image — [B-511]
- [x] TC-4611: Open a wide image: the window hugs it, no bands.

## 389. The restart after an eject goes out on a fresh connection — [B-545]
- [x] TC-4614: `node test/board-restart-after-eject.test.js` passes.

## 390. Right-click a picture for its actions, and a removed picture can be added back — [B-511]
- [x] TC-4615: Right-click a font's picture in its window: View image, Replace image (or Add its own image), Paste image, Remove image.
- [x] TC-4616: On a source showing its own original picture, Remove image is greyed; hovering it reads "This image is part of the original source, which is kept as it is.
- [x] TC-4617: On a one-font source showing its font's picture, Remove works and removes it from the font; the source's file-name chip offers no Remove for that picture.
- [x] TC-4618: Remove a font's picture that came with its original source (a font that is not Customized): Files shows it greyed, the hide removed (1) toggle appears, right-click adds back the original.

## 391. Two error messages say what failed and what to do — [B-163]
- [x] TC-4619: Config Manager, Compare File, pick a file that cannot be read (deleted after picking, or locked): the error is titled "Could not read that file" and names the file, "may have been moved, renamed or deleted."
- [x] TC-4620: No import button anywhere says "Importer unavailable"; the guard (only reachable when the Sound Fonts code failed to start) reads "Could not start the import" / "Restart JMT Studio and try again."

## 392. A renamed font's presets follow it; old names find it again — [B-561]
- [x] TC-4621: Rename the copy in its font window and close the window: "Update the config too?" asks Never update / Keep old name / Update / Always update, with a ✕ that leaves the config.
- [x] TC-4622: Rename it again, close, press Keep old name: the preset keeps the old name.
- [x] TC-4623: Rename once more, close, press Always update.
- [x] TC-4624: Settings, Remembered choices (collapsed, ▶ Show) holds three rows: Include the config with SD Export, Name added images after their font, Update the open config when a font it uses is renamed.
- [x] TC-4625: Expand Remembered choices, close Settings, open it again: the section is collapsed.
- [x] TC-4626: One visit, several renames: rename a font three or four times with Save, then close the window.
- [x] TC-4627: Same, but end on the name the window opened with: nothing is asked, and the font's former names are as they were before the visit.
- [x] TC-4628: Renaming back and forth between two names leaves exactly one former name (the current name is never listed).
- [x] TC-4629: Open a config whose presets name several old names of library fonts: one review window lists a row per name ("In your library: <font> · N presets"), each set to Update.
- [x] TC-4630: In the review, Not now changes nothing, and the same review appears the next time that config opens.
- [x] TC-4631: Not this font on a row, Apply: that old name is removed from that font (its other former names stay), and no config asks about that name again.
- [x] TC-4632: A name two or more fonts once had: the row picks the font from a dropdown, Update uses the picked font, and its third choice reads None of these (removes the name from every listed font).
- [x] TC-4633: Hover each choice: Update names the presets and the new font; Ignore says it asks again next time; Not this font says the font is not that name and no config asks again.
- [x] TC-4634: A name the library has now is always that font: open a config naming a current font that is also another font's former name, and nothing is asked.
- [x] TC-4635: Duplicate a renamed font: the copy has no former names, so a config naming an old name still points only at the original.
- [x] TC-4636: Rename a font a preset uses, update the preset, then play the preset from Config Manager: it plays (the preset play caches are cleared on any library change).

## 394. Copy a link to the selected text in the in-app browser — [B-562]
- [x] TC-4641: In the in-app browser, select a word or a few words and right-click: Copy link to highlight sits under Copy page URL.
- [x] TC-4642: With text selected, Save as Link to highlight sits under Save as Link and saves the highlight address; opening the font's Link goes to the words.

## 395. Save an image or a paused YouTube frame as a font image from the in-app browser — [B-563]
- [x] TC-4643: From a font window (right-click its Link or Website, Open in app browser), right-click an image on the page: Save as font image.
- [x] TC-4644: Open a YouTube video (the watch page, and a page with an embedded player), pause it, right-click BESIDE the player: Save video frame as font image.
- [x] TC-4645: From a source window with several fonts, each item opens a list with all fonts first; all fonts each get the image.
- [x] TC-4646: Import review (open the browser from the review's Website): save a font image for a row.
- [x] TC-4647: Font window Image row reads + Add (or Replace), Find, Paste.
- [x] TC-4648: In the app browser from a font window, save a Link, a Demo, a font image and a proof of purchase.
- [x] TC-4649: Same from import review (Link field, a row's Demo and image, proof) and from Import from link's browser (the pick and its PDF are dropped).
- [x] TC-4650: From a bundle's font or source window, the browser offers Save as source image (and Save video frame as source image on a paused YouTube video); a one-font source does not.
- [x] TC-4651: Click a font's image in its window: the viewer opens straight on the full image, with no empty frame first.

## 396. Tags and Creators have Without, as Effects does — [B-564]
- [x] TC-4652: Creators, right-click Greyscale Fonts: its row shows a red x, the chip row reads WITHOUT Greyscale Fonts, and no Greyscale Fonts font shows (search "rey" now finds Rey-Flex and none of them).
- [x] TC-4653: Pick two creators and leave one out of a tag together: the strip shows creator, without, tag, without groups joined by "and"; the button badges count both kinds; Clear all clears every one.
- [x] TC-4658: Style Library, Tags: right-click a tag row: red x, a WITHOUT chip, and no style with that tag shows.

## 397. Picking a suggested tag keeps the box in the theme's colours — [B-565]
- [x] TC-4654: Select a font, Tags, start typing an existing tag and pick it from the suggestions: the box stays dark (light in Light mode), not white.
- [x] TC-4659: In each tag box (font, source, bulk Tags, guided import, Style Library), type part of an existing tag and pick it from the suggestions with the mouse, or arrow down and Enter once: it is added at once.

## 398. The app browser stays with Studio — [B-566]
- [x] TC-4655: Open the app browser (a font's Link, or Find on its Image row).
- [x] TC-4656: With the app browser open, click a card or a button in Studio behind it: nothing happens there, and the browser comes forward.

## 399. A file opened from Add files from the library shows on top — [B-567]
- [x] TC-4657: Font window, Add from library, double-click a text file, an image and a PDF: each opens on top of the picker (audio already did).

## 400. A style switched off by a missing include or define is named before compile — [B-180]
- [x] TC-4660: The JMT wrapper prop, a preset using ChargingButtonStyle, no charge_full_prop.h include (B180_Test_E.h): Compile stops before building with "...
- [x] TC-4661: The same with the include present and the wrapper prop (B180_Test_C.h): nothing, and it builds.
- [x] TC-4668: The plain Fett263 prop with ChargingButtonStyle (B180_Test_A.h), with or without the include: "...

## 401. Remembered choices get a Never; an image keeps its name until asked — [B-571]
- [x] TC-4662: Font rename, image rename and SD Export's config question each read Never ...
- [x] TC-4663: The ✕ on each: SD Export stops the export; an added or pasted image comes back out; a font rename and a moved image are left as they are, and their setting stays Ask.
- [x] TC-4664: SD Export on Ask: Include puts the config on the card this time only; the next export asks again.
- [x] TC-4665: Image row Add (font and source window) and the app browser's Save image: the file keeps its own name and the question asks; with the setting on Always it is renamed unasked; on Never it keeps its name.
- [x] TC-4666: Replace a font's image that is named <font>.png with a file named razor.png, setting on Ask, press Keep original name: razor.png is the image and <font>.png is gone.
- [x] TC-4667: Delete the font's image in Files, and Ctrl+V an image into Files: the picture, the Image row and Included Files all update without closing the window.

## 402. A config changed and changed back is clean again — [B-572]
- [x] TC-4669: Open a config, type a character and delete it: the unsaved mark clears and Save greys out.
- [x] TC-4670: Rename a font the open config uses (Update), then rename it back (Update): clean again.

## 403. Add files from the library: Browse opens a list that fits, with groups that collapse — [B-573]
- [x] TC-4671: Browse opens a list under the box, the box's width, never under Selected; it stops at the bottom of the window and scrolls.
- [x] TC-4672: Shared Tracks is a single entry with no heading (BUG-037); Sources, Fonts and Common folders each have a heading with a count; only the group holding the current choice is open.

## 404. A font's own style file goes into the Style Library, and a style has a Creator — [B-569]
- [x] TC-4673: Add Style and a style's detail panel have a Creator above Source, suggesting the Sound Fonts creators (JMT Sabers included) and the library's.
- [x] TC-4674: The Creators filter sits between Tags and Effects.
- [x] TC-4675: Open a font's bladestyle.txt (BVM, a Fett263 export) from Included files: Copy style and Add to Style Library show.
- [x] TC-4676: Add to Style Library: the font window steps aside and Add Style opens with name = the font (AstralProjection), Creator = the font's creator, Source = the Fett263 line, Link = the creator's site, Tags = the font's…
- [x] TC-4677: Greyscale: open proffie_blade_style.txt from the SOURCE's Included files.
- [x] TC-4678: A file with two or three styles shows "Style 1 of 2"; the second is named with a 2 (Razor2).
- [x] TC-4679: After Add, the question: "Make X the Last used style for <font>...
- [x] TC-4680: Settings > Remembered choices has "Use a style added from a font as its Last used style": Ask / Always / Never, and it reflects a Never or Always chosen in the dialog.
- [x] TC-4681: Reopen a file whose style is already in the library: Add to Style Library is greyed, and its hover says "Already in your Style Library as X" (and "...

## 405. Style Library Visual view saves as you go; Save, Discard and Delete are Code view's — [B-574]
- [x] TC-4682: Visual view shows no Save, Discard or Delete.
- [x] TC-4683: Add Style, deleting a style, a helper edit, dragging a style and Ctrl+Z / Ctrl+Y on it, and Append each survive a restart with no other click.
- [x] TC-4684: Code view shows Save, Discard and Delete; typing, Condense and Expand wait for Save.
- [x] TC-4685: Append a file that repeats a style name: "Not saved yet ...

## 406. Test Style opens any style in the online style editor — [B-575]
- [x] TC-4686: Test Style in a style's detail window (between Paste Code and undo) opens the browser on the style editor drawing it, unsaved edits included.
- [x] TC-4687: A card's right-click has "Test in style editor", with a config open and with none.
- [x] TC-4688: In the preset sidecar, an open blade has Test Style right of Write Custom Expression (and on the custom row, testing the typed text); a blade's right-click has "Test in style editor".
- [x] TC-4689: StylePtr<PlasmaChamberWrapper<ControlMainUnstableRageBaseColor>>("65535,0,0") from az_duum.h opens whole (a ~30,700-character link) in red, the preset's colour, not the default.
- [x] TC-4690: CrystalChamberAccelWrapper<...> draws, not Black: BootNormTime's (32768 100) / DURATION_MS reaches the editor as 327.
- [x] TC-4691: Test style in a font's style file viewer opens the creator's style as written.
- [x] TC-4692: BootNormTime or BootAccelSpin on its own: "Cannot test this style ...

## 407. Replace from folder: a font's files swap for a folder's, the font stays — [B-585]
- [x] TC-4693: A font row in a source window has "Replace from folder..." right under "Add from folder...".
- [x] TC-4694: After a replace the font keeps its name, tags, notes, image, demo and link, its place under the source, and the presets that use it.
- [x] TC-4695: A Customized font asks first ("has changes of your own ...
- [x] TC-4696: Replace with a folder that is not a font, or holds several: the same refusals Add from folder gives, nothing changed.
- [x] TC-4697: Add from folder still adds a second version with its name open for editing (it now shares the folder checks with Replace), and its damage dialog still says "Add without it".

## 408. Preset right-click: Show in library — [B-586]
- [x] TC-4698: Right-click one preset whose font is in the library: "↗ Show in library" (after Move, before Duplicate).
- [x] TC-4699: No "Show in library" for a font not in the library (the red one), or with more than one preset selected.

## 409. Segments: a layer saved once and used by name — [B-177]
- [x] TC-4700: In a style's code select one whole layer, right-click, Create Segment from Selection.
- [x] TC-4701: Select several whole layers in a row: the same item shows, the saved segment reads Layers<...>, and the style uses the name in their place.
- [x] TC-4702: A selection stopping partway through a layer, skipping one, or including the base doesn't offer the item.
- [x] TC-4703: Paste two layers separated by commas into a new segment and Save: Code view shows one Layers<...>, the panel shows both, and a fixed colour in it is offered as a parameter.
- [x] TC-4704: Right-click a segment: Show styles (n), Replace identical (n), Expand, Duplicate, Delete.
- [x] TC-4705: Replace identical: a toast, no dialog, and the count matches the styles changed.
- [x] TC-4706: A config using a style with a multi-layer segment compiles, plain, with a colour and on its default.

## 410. Adding a segment: it runs, then reports — [B-582]
- [x] TC-4707: Select all, Segments, Add: no question first.
- [x] TC-4708: Exceptions show only when there are any: Built into another layer, More than one, Different position, Can be replaced.
- [x] TC-4709: Hovering a row name says what it means.
- [x] TC-4710: Tag adds its tag to those styles, reads Remove tag, and takes it back off only those it added.
- [x] TC-4711: Replace N swaps each version where it stands, as its own undo step.
- [x] TC-4712: A style with two power saves is left alone under More than one, not named.
- [x] TC-4713: An exact copy nested inside another layer becomes the name, and the blade doesn't change.
- [x] TC-4714: A segment holding power save, battery and volume: those three side by side are Identical replacement, whatever the Layers<> around them.
- [x] TC-4715: Wrappers and charging styles take a segment like any other style.
- [x] TC-4716: Right-click a selection of cards: the same run.
- [x] TC-4717: Effects filter counts match the styles (a style has more than 10 effects and is still found).

## 411. Multi-select, and blocks that stay whole — [B-582]
- [x] TC-4718: Ctrl-click, Shift-click a range and the corner box select; the toolbar counts match.
- [x] TC-4719: Any "and N more" opens the rest in place at the same height, reads Show fewer, and closes again.
- [x] TC-4720: In the Style Blocks panel, delete the using line or the closing ;: a red line under the code, Save disabled.
- [x] TC-4721: Rename in the panel with the pencil: Enter or clicking away keeps the name, Esc cancels, and the name and the using line match throughout.
- [x] TC-4722: Rename a block many styles use: the dialog fits on screen, its buttons reachable, and Update everywhere changes every style.
- [x] TC-4723: Clicking a style's name, creator or source, or a block's name, edits it as its pencil does.

## 412. Delete Library — [B-597]
- [x] TC-4724: Code view shows Delete Library.

## 413. Deleting or editing the last helper or segment — [B-577]
- [x] TC-4725: Delete the last segment above Charging Styles, edit the one now last, Save, compile: no "#endif without #if".

## 414. Style Blocks sidebar — [B-578]
- [x] TC-4726: Opening, switching and closing Helpers and Segments moves no widths.
- [x] TC-4727: Common Folders keeps its open folder after leaving Sound Fonts.

## 415. Autocomplete and Find in OS — [B-584] [B-589]
- [x] TC-4728: After #define in a config, the list offers the names the selected OS reads, with their file.
- [x] TC-4729: Right-click a name in the config: Find in <version> opens the file viewer over Config Manager with every file holding it listed.
- [x] TC-4730: Link Prop is greyed on the config's own prop, in the viewer and the tree menu, with a hover saying why.

## 416. A compile always matches the tree — [B-591] [B-466]
- [x] TC-4731: On an installed release: import a prop, link it, compile.
- [x] TC-4732: Change a file in a version in Explorer: the next Compile really rebuilds, not "restored from cache".
- [x] TC-4733: Hover the lit Flash button: it names the port.

## 417. Adding between presets — [B-606]
- [x] TC-4734: Hovering between two preset numbers shows the + at the left and nothing moves.

## 418. The Style Library is ready on its first visit — [B-595]
- [x] TC-4735: Start the app, wait a few seconds, click Style Library: the cards are there, no empty editor.
- [x] TC-4736: With no library the tab stays hidden and nothing errors.

## 419. A common folder marks its changed files — [B-587]
- [x] TC-4737: In a customized common folder the Files list shows added and changed files in blue, a folder shows what is inside it, and a hover says what changed, as on a font.
- [x] TC-4738: Delete a file from a common: it stays as a grey row at the end of the tree.

## 420. Style cards show a style's colours — [B-603]
- [x] TC-4739: A style card shows up to seven colours at its foot, short name above each dot: Base, Alt, Blast, Clash, Lockup, Stab, Off, with what the style lacks left out.
- [x] TC-4740: A style with no colour arguments shows one dot, Detected.
- [x] TC-4741: Dots start as plain colour and fill in with the swatch look at idle.
- [x] TC-4742: Effects no longer list on a card, unless filtering by one.
- [x] TC-4743: Open a style: Effects sit above Colors, and Colors shows every colour argument, read-only.

## 421. Filter the Style Library by colour — [B-608]
- [x] TC-4744: Color lists families in wheel order, each with a dot and a count, and only families that have styles.
- [x] TC-4745: Picks inside Color widen and picks across dropdowns narrow, as on Tags and Effects.
- [x] TC-4746: Leave out every family: no styles match.
- [x] TC-4747: A style with colour arguments but no Base shows a Detected dot first, then its other colours, and filters under that colour, not under an argument's.
- [x] TC-4748: In Presets, the Named color picker's Colour order is unchanged: the wheel, with whites and grays last.

## 422. Click a style's colours — [B-609]
- [x] TC-4749: On a card, click a colour: the list narrows to that exact colour in that slot, the card stays shut, the colour is marked, and a chip names the slot and colour.
- [x] TC-4750: Colours in one slot widen and colours across slots narrow: Base one of two, and Clash a third.
- [x] TC-4751: Click a Detected colour: the chip says Base, and styles with that colour as Base show up beside it.
- [x] TC-4752: Right-click a colour: every style with it in that slot drops out, with a without chip that clears.
- [x] TC-4753: In a style's window, click a colour: the code editor's search takes the argument name, or the detected colour as written, and shows the first match, with regex and whole word off.

## 423. One detected colour — [B-611]
- [x] TC-4754: A style with no Base whose first written colour follows an argument default: the card and a preset slot show the same colour, the one written into the style, not the argument's.
- [x] TC-4755: In a preset slot, edit a detected colour written in the expression: the edit lands on that colour.
- [x] TC-4756: Add a segment that takes the base colour to a style with no Base: it takes the style's detected colour, not the segment's default.
- [x] TC-4757: After that add, the card and window still say Detected with the same colour, and Color files the style as before.
- [x] TC-4758: A style whose only colour lives in a helper: the segment keeps its default.

## 424. A selection stays in sight — [B-600]
- [x] TC-4759: Select some, then filter so they would not match: they stay showing, and the chip row ends "or Selected (n)", n being how many are there only because they are selected.
- [x] TC-4760: The same with a search that excludes them, and with a search that matches nothing: the selection shows.
- [x] TC-4761: The chip's X takes them out of the results.
- [x] TC-4762: Selected N beside In use shows while anything is selected.
- [x] TC-4763: After the chip's X, the button brings them back.
- [x] TC-4764: Deselect a card held in by the selection: it leaves the results.
- [x] TC-4765: Sound Fonts: the name list from a duplicate check still narrows strictly, selected or not.

## 425. JMT add-on sounds in a common folder — [B-167]
- [x] TC-4766: With the JMT add-ons on at least one OS version, a common folder's + Add lists JMT add-on sounds.
- [x] TC-4767: Add them: the files land in the folder's root and a toast says how many.
- [x] TC-4768: With a different file under one of the names: the row says added numbered, a note says how to use the JMT version, the existing file is untouched, and the JMT version lands numbered.
- [x] TC-4769: With no OS version holding the add-ons, + Add has only From library and Browse.
- [x] TC-4770: Offline, + Add's JMT add-on sounds says nothing was changed, and the folder is unchanged.
- [x] TC-4771: SD export of a JMT config using CHARGE_DETECT_PIN, with a common folder lacking chargebegin.wav: it offers to add it after the folder is chosen.
- [x] TC-4772: SD export of a config with no JMT add-on, or that needs no missing sound: no offer.
- [x] TC-4773: Installing or updating the add-ons on an OS version writes no sounds folder or wav into ProffieOS.

## 426. Pre-flight cards and Error Intelligence — [B-384] [B-030] [B-266] [B-268]
- [x] TC-4774: 59_ALL_at_once: the headline counts the cards, the list scrolls, Cancel Compile and Compile anyway stay on screen, and a card leaves the list when its fix is used.
- [x] TC-4775: 01 to 05: each missing comma names where it is and Add the comma fixes it.
- [x] TC-4776: 06, 09, 10: a preset list missing its semicolon, closing early, or never closing each gets a card.
- [x] TC-4777: 07: curly quotes on an include: the board still reads, the card names the line, Use straight quotes fixes it.
- [x] TC-4778: 08: a config that includes itself: the card names the line and Remove the line fixes it.
- [x] TC-4779: 11, 12: a short or over-long preset: the card lists Preset to update with its number, and name if it has one.
- [x] TC-4780: 13, 14, 15: blade count against NUM_BLADES and a preset list that does not exist each get a card with the line in the title.
- [x] TC-4781: 16, 19: a name one letter off offers a button that changes it; two letters off suggests with no button; nothing close gives the plain card (18).
- [x] TC-4782: 17: a style inside an #ifdef nothing defines: the card and the compile message agree and name the #ifdef line.
- [x] TC-4783: 20: options for a prop with no prop included are one card naming the prop, with Disable and Delete.
- [x] TC-4784: 22: a preset with no shared folder on a config needing a voicepack: the card explains why and adds the folder.
- [x] TC-4785: Compile a config with a fault no card catches, for example 53: the failure dialog shows the translated message and the Build Output panel shows it under the raw output.
- [x] TC-4786: An error the matrix does not know still shows the compiler's own text.
- [x] TC-4787: An error inside an OS file shows no Line N for the config.
- [x] TC-4788: 28: a font name with no quotes says it needs quotes, naming it.

## 427. Studio Data updates — [B-266]
- [x] TC-4789: About shows Studio Data with the version and a muted updated date.
- [x] TC-4790: Auto update On: Check Now is hidden.
- [x] TC-4791: Auto update Off: Studio does not check at start and Check Now shows.
- [x] TC-4792: Start with no internet and Auto update On: nothing appears anywhere except the About row, where On is red, Check Now shows, and the tooltip says the last check did not go through.
- [x] TC-4793: With no internet, a failed compile still shows its translated message.
- [x] TC-4794: After an update, restart with no internet: the version in About and the wording in a compile are still the newer ones.

## 428. A 32 KB card through a Proffieboard — [B-594]
- [ ] TC-4795: ⏭ Cancelled, not to be run. .
- [ ] TC-4796: ⏭ Cancelled, not to be run. .
- [ ] TC-4797: ⏭ Cancelled, not to be run. .
- [ ] TC-4798: ⏭ Cancelled, not to be run. .
- [x] TC-4799: 8, 16 and 64 KB cards through a Proffieboard export normally.

## 429. A card's Link in the app browser — [B-615]
- [x] TC-4800: Right-click Link on a card: the menu says Open in app browser and the font does not open.
- [x] TC-4801: From there, save a Link and a Demo.

## 430. A known creator's website — [B-616]
- [x] TC-4802: In a source window, clear the website and creator, save, type a known creator, save.

## 431. A logo's link home — [B-617]
- [x] TC-4803: On a store's product page, right-click its logo and Save as Link: the product page is saved, not the home page.
- [x] TC-4804: Right-click a link to another product and Save as Link: that product is saved.

## 432. Tags on cards narrow — [B-618]
- [x] TC-4805: Pick two tags in the dropdown: fonts with either.
- [x] TC-4806: Right-click a tag on a card: fonts without it, red, and no card menu.
- [x] TC-4807: Click a filtering tag on a card and it comes off.

## 433. Bulk review Link and app browser — [B-619]
- [x] TC-4808: Bulk review with a catalogue match: Link sits above Demo, filled.
- [x] TC-4809: A Website or a Link holding an address shows Open in app browser; empty, it does not.
- [x] TC-4810: Open a creator's Website: Save as Link and Save as Demo list that creator's checked fonts with All checked fonts first.
- [x] TC-4811: Open a row's Link: Save as Link and Save as Demo need no font pick and name no font.
- [x] TC-4812: Import: each font's card has the Link and Demo from its row.

## 434. Font catalogue — [B-251]
- [x] TC-4813: Import a font the catalogue knows into an empty library: creator, Link, Demo, tags and Free come in, and the font keeps its folder name.
- [x] TC-4814: Bulk review of a known font: Details shows the catalogue name as Source name, its tags, and Free content ticked when free.
- [x] TC-4815: In bulk review, clear a row's Link, Demo or Tags and import: they stay cleared.
- [x] TC-4816: Single-font review of a known font: catalogue name on the font, Free pre-filled, tags on the font after import.
- [x] TC-4817: Publish a newer catalogue with a change the app does not ship.
- [x] TC-4818: Two fonts from different creators with the same catalogue name and different folder names: both keep their folder names, no _2.
- [x] TC-4819: A folder with Proffie effect folders and a stray fontconfig.ini imports as one font.
- [x] TC-4820: A numbered folder with a Blade_Style text file keeps its name.
- [x] TC-4821: A known font sharing most of its sounds with another imports with no Needs review.
- [x] TC-4822: A row already in the library shows its creator in review, not Unknown.

## 435. Search and source rows
- [x] TC-4823: Sound Fonts and Style Library: style-1, style_1, style 1 and style1 all find the same fonts.
- [x] TC-4824: A search cannot match across two fields: a font name plus its creator's name finds nothing.
- [x] TC-4825: Source window, font rows: pencil one row, click another: it opens for editing with no prompt, and Apply saves both.
- [x] TC-4826: Source window, an unsaved edit to the source's name or date, then click a font row: Cancel, Discard, Save still asks.

## 436. Shortcuts and Asteria cards — [B-624]
- [x] TC-4827: A card with only .lnk files says "carries N shortcuts", with the shortcut sentence in the warning.
- [x] TC-4828: Shortcuts stay blocked: a marked file, left out of imports, quick import unavailable, with the shortcut wording on the hover and the row note.
- [x] TC-4829: An Asteria card (SETTING.txt, COLORMATRIX.txt or LEDCFG.txt, Bank folders): "This looks like an Asteria card, not Proffie", 0 sound fonts, no import button, files still browsable.
- [x] TC-4830: A flagged file on a card with no fonts on offer: the warning has no "import anyway" line.

## 437. Single-font review and card selection — [B-625]
- [x] TC-4831: Single-font review of a folder and of a zip: each font row has font and hum chips that play in place, and a second click stops.
- [x] TC-4832: Single-font review of a folder off a card: Acquisition Date reads today.
- [x] TC-4833: Card browser: select folders, go into one and back: the selection, highlights and bar stay.
- [x] TC-4834: A normal click still opens a folder.

## 438. Style folding — [B-627]
- [x] TC-4835: A style's editor, Add Style, and an expanded block: the bar shows 1, 2, 3, 4, Open.
- [x] TC-4836: 1 shows only the using line.
- [x] TC-4837: The side panel has no bar, no fold arrows and no pinned lines.
- [x] TC-4838: Scrolling a long style pins the lines it is nested in at the top, and a saved style is unchanged by folding.

## 439. Block paste and panel width — [B-628]
- [x] TC-4839: An open block in the side panel shows a clipboard icon before Save.
- [x] TC-4840: Paste with style code on the clipboard: the code is replaced, the block's name stays, and Save lights.
- [x] TC-4841: The clipboard has a template line above its using: the block takes that template.
- [x] TC-4842: The clipboard has no style code: a short message says nothing was pasted and the code is unchanged.
- [x] TC-4843: Paste Code on a style's own editor still works, and still keeps the style's name.
- [x] TC-4844: The Style Blocks panel opens at 420 and the Sound Fonts Common panel at 320.

## 440. Add Styles to Library — [B-367]
- [x] TC-4845: A linked config with written-out styles shows the button under the presets.
- [x] TC-4846: The modal has one row per distinct style, in all banks, with where it is used.
- [x] TC-4847: Default names: the preset's, then the font's when the name is empty or has no letter, such as "0".
- [x] TC-4848: A style covering more than half the config's presets takes the file's name without its version.
- [x] TC-4849: Styles differing only in color defaults become one row showing their color count.
- [x] TC-4850: Effect colors reach their position with ~ between, as Code_Fulcrum's chamber does.
- [x] TC-4851: Code already in the library, exact or by color only, is greyed and checked and says so.
- [x] TC-4852: The buttons count only new styles: Add 4 Styles.
- [x] TC-4853: A name that is invalid, a ProffieOS name, in the library with other code, or used twice blocks Add and says why.
- [x] TC-4854: Left as written: StyleNormalPtr argument lists, bare colors, placeholders, and code using a name the config defines.
- [x] TC-4855: Different code, a color written outside an argument, and one argument with two defaults stay separate rows.
- [x] TC-4856: A credit above any use of a style comes through: source, link, version as a tag, the rest as notes.
- [x] TC-4857: After Add the config is unsaved, Ctrl+Z restores it in one step, and the library keeps its entries until undone there.
- [x] TC-4858: The config compiles after Add, and collapsed styles use less flash.

## 441. Flash wait limit — [B-629]
- [x] TC-4859: Compile with no board and plug one in within two minutes: it flashes as before.
- [x] TC-4860: Wait two minutes: the window reads "Compiled, not flashed.
- [x] TC-4861: Plug a board in after that: Flash lights and nothing flashes until it is clicked.
- [x] TC-4862: A board leaving just before a flash starts the same two-minute wait.

## 442. File order Oldest and Newest — [B-630]
- [x] TC-4863: Style Library sort: File order flips between Oldest and Newest on a second click, shown on the button.
- [x] TC-4864: Newest shows the last added first.

## 443. Config Undo and Redo state — [B-631]
- [x] TC-4865: A freshly opened config shows Undo and Redo grey, titled Nothing to undo and Nothing to redo.
- [x] TC-4866: An edit lights Undo.

## 444. Font card name row — [B-620]
- [x] TC-4867: NEW, Demo, Link and In Use on a card's name row are one height and stay on one row, with Link at the far right.

## 445. A cloud drive folder keeps its own name — [B-633]
- [x] TC-4868: Import from a OneDrive folder link, clicking Download in the app browser: the source is named after the folder, not OneDrive_ and a date.
- [x] TC-4869: A Google Drive folder the same way: named after the folder, not drive-download.
- [x] TC-4870: A single file from Dropbox or a drive keeps its own file name.
- [x] TC-4871: A new JMT Sabers source fills the website with jmtfoundry.com.

## 446. The catalogue comes with every build — [B-634]
- [x] TC-4872: Build on Windows, Mac and Linux: each log shows "font catalogue version N", and the installed app identifies a known font offline on first launch.
- [x] TC-4873: With no copy of fontCatalogueData.json in the folder, the build fetches it.

## 447. Cancel on the skip or replace question — [B-637]
- [x] TC-4874: Right-click Export font folder to a card that already holds some of the fonts.

## 448. A card pulled during the compare — [B-638]
- [x] TC-4875: Export font folder to a card holding the fonts, and pull the card while it reads "Checking the destination".
- [x] TC-4876: SD Export the same way: pulling the card mid-compare stops the export with nothing written.

## 449. Planning a folder export does not freeze — [B-639]
- [x] TC-4877: Export font folder with the whole library selected to an empty card or folder.
- [x] TC-4878: A font with a picture beside it in its download still shows that picture after export.

## 450. The wait before a folder export — [B-640]
- [x] TC-4879: Export font folder with many fonts to a card that holds them.
- [x] TC-4880: Cancel during that wait closes the window with nothing written.

## 451. A card's names stay with the fonts you already have — [B-641]
- [x] TC-4881: Open the card's config: fonts you have under other names show missing.
- [x] TC-4882: Update on all, Apply: the presets use the library's names, as one Ctrl+Z.
- [x] TC-4883: Cancel a bulk import after analysis: the matched fonts still get the card's names (Cancel keeps what you have).
- [x] TC-4884: Single import of a font you have under another name: Cancel, or Open existing / Show in library from "already in your library", records the name; the config review offers it on the next open.
- [x] TC-4885: Import the same card twice: no font gets a name a second time, and no name ever has two owners from imports (no dropdown appears where there was none).
- [x] TC-4886: A font's alias list holds up to 50 names, newest first; renaming still adds the old name.

## 452. The same font, two ways in — [B-643]
- [x] TC-4887: A card copy trimmed to fit (fewer sounds, all from your font) reads "Already in your library" and is unticked.
- [x] TC-4888: A version that adds sounds (most of your font is in it) reads "A version of <font>"; nearly identical reads "Nearly identical to <font>".
- [x] TC-4889: A stock-sound font (Yoda, ObiWan4, Dooku on a stock card) shows no note against Depa_Bilaba or any font it only shares stock sounds with, is ticked, and quick import does not flag it Needs review.
- [x] TC-4890: A row's note names what it has that your font lacks and where those are: "...
- [x] TC-4891: The tick follows whether anything is new to the library: nothing new = green, unticked; anything new = amber, ticked.
- [x] TC-4892: desktop.ini, Thumbs.db and macOS ._ files never count: a card with a desktop.ini in every folder reads the same as without.
- [x] TC-4893: Two Unknown-creator groups never appear: a font whose creator is recorded as Unknown groups with undetected ones.

## 453. Importing the same font comes in beside it — [B-643]
- [x] TC-4894: Tick a same-font row on a card import and rename it: it comes in as a version on the matched font's source (Fonts from this source lists both), with its tags, demo, free/purchased, creator and link; no new source.
- [x] TC-4895: The card's folder name becomes an alias of the new version, and is taken off the original.
- [x] TC-4896: An identical card copy, ticked anyway, also comes in beside (not as its own source, not Needs review).
- [x] TC-4897: A version made from a card folder is not Customized unless its files differ (no desktop.ini comes in).
- [x] TC-4898: Single import of a folder that is one font you have: the dialog's button reads "Add as a version of <font>"; it opens that source, adds the version (any unopenable archive in the folder is reported), and offers the…
- [x] TC-4899: Re-import as a new source of a zip: the review opens with the matched font ticked.

## 454. Tracks keep every name a config uses — [B-643]
- [x] TC-4900: A card using two names for one recording (moon_hati.wav = spectre_5.wav): one file in Shared Tracks, the other name an alias; the config review offers "moon_hati.wav · In your library: spectre_5.wav".
- [x] TC-4901: Rename a track in the card review before import: your name is the real name and both card names are aliases.
- [x] TC-4902: Rename a shared track later: the old name is an alias, and an open config using it is offered the new name.
- [x] TC-4903: Back up and restore: track aliases come back.

## 455. Common folders: same pack, versions and aliases — [B-643]
- [x] TC-4904: Download a voice pack you already have (a fresh zip of the same pack): "already in your library" names your common; nothing new is created on Cancel.
- [x] TC-4905: Its button reads "Add as a version of <common>": the version is on your common's source, no second source.
- [x] TC-4906: A card's common matching yours by content (any name, desktop.ini or not) shows "Already in your library (as <name>)" under its name, unticked.
- [x] TC-4907: Rename a common folder: a config whose font list names the old one ("Nomad;common") is offered the new name in the same review.

## 456. Linux: cards, export checks and eject — [B-644]
- [x] TC-4908: A card in a reader shows in Read my Proffie SD card with its label, size and free space; an empty reader slot shows nothing; the system disk is never offered as a card.
- [x] TC-4909: Import from the card: fonts come in as on Windows, demos and links included.
- [x] TC-4910: SD Export to a card through the board: the destination is recognised as the board's card (eject message "Ejected.
- [x] TC-4911: Eject from the export's summary: the card disappears from the Files sidebar, its /run/media folder is gone, and the message has no "still listed" line.
- [x] TC-4912: Eject while a terminal sits inside the card's folder: "Something is still using <label>, so it could not be unmounted", and the card stays mounted.
- [x] TC-4913: Export to a folder in your home: no card checks, no eject offered.

## 457. A first install finds the board — [B-645]
- [x] TC-4914: Install, let the toolchain install the plugin, plug in a board: the port is selected by itself, "Proffieboard on <port>", Detected shows the serial.
- [x] TC-4915: Linux, board in bootloader mode without udev rules: the command offered points into the app's plugin folder (arduino-data/<version>/packages/proffieboard), and pasting it works.

## 458. The board restarts after an eject — [B-646]
- [x] TC-4916: Monitor open: "> reset" appears in the monitor, the board restarts, the monitor reconnects by itself showing the board's welcome, and the summary reads "Board restarted and ready to use."
- [x] TC-4917: Monitor closed (close, not collapsed) before exporting: the same, with the monitor opened by Studio.
- [x] TC-4918: Monitor collapsed (paused): the same.
- [x] TC-4919: Ten runs in a row on each system: no run leaves the board un-restarted or the monitor disconnected.
- [x] TC-4920: A different port selected in the port box than the board's: the restart still happens (the old route), and the monitor is not touched.

## 459. A fresh install is not told its plugin is broken — [B-648]
- [x] TC-4921: On a machine with no Arduino Proffieboard plugin, the first toolchain install's log reads "Downloading the Proffieboard Plugin into the JMT Studio folder.
- [x] TC-4922: With an old plugin installed (one without the pclk option, e.g. 3.6 in the Arduino IDE's folder): "The Proffieboard Plugin installed on this system cannot build for this board.

## 460. A sound that will not play says so in plain words — [B-650]
- [x] TC-4923: Double-click a damaged `.wav` (e.g. a garbage-named entry on a damaged card, or a text file renamed to `.wav`) → the preview reads "This file could not be played.

## 461. A renamed style: its fonts, the open config and later configs follow — [B-651]
- [x] TC-4924: Rename a style a font has as its Last used style (from the style's detail).
- [x] TC-4925: With a config open whose presets use it: "N presets in <config> use <old>.
- [x] TC-4926: The setting reads "Update the open config when a font or style it uses is renamed" and governs both.
- [x] TC-4927: Close the config without saving, reopen it: "Use the styles' new names?" "N presets in <config> use <old>, which your Style Library now calls <new>.
- [x] TC-4928: my_styles.h (Code view) holds `// formerly: <old>` on the renamed style; renaming it back removes that name from the list.
- [x] TC-4929: The same from the helper editor (a helper or segment renamed): fonts, open config and the formerly line follow; a later edit of the same helper keeps the formerly line.
- [x] TC-4930: Two styles renamed, then a config using both opened: one prompt names both
- [x] TC-4931: A config whose font and style were both renamed: the font review comes first, then the style question, never both at once; each update lands
- [x] TC-4932: A name two styles once had is not offered; a name the library has now is never offered.

## 462. Style Library tiles are wide enough for their names — [B-652]
- [x] TC-4933: Style Library tiles are never narrower than 320px; at a full-width window, four columns, and long names (ControlMain...) show most of their name.

## 463. The eject never tells people to type reset — [B-653]
- [x] TC-4934: An eject through the board whose restart does not happen reads "Ejected.

## 464. A config's renamed styles: one review, a choice per line, and a second chance at compile — [B-656]
- [x] TC-4935: Reopen a config after renaming fonts AND styles: ONE review, "Fonts and styles in this config have other names in your library", a Sound fonts section and a Styles section, each with its own sentence.
- [x] TC-4936: A style line offers Update / Not now only (no Ignore, no "Not this style").
- [x] TC-4937: Set all to Update / Ignore sits inside the Sound fonts section above its rows (at the top when there are no styles) and never touches a style line.
- [x] TC-4938: A name two styles once had: the line starts UNDECIDED (dropdown on "Choose a style", Update greyed, Not now unselected).
- [x] TC-4939: A style the library has NOW under the old name, or one the config defines itself (using X = ...), is never offered.
- [x] TC-4940: Not now on the styles, then Compile: one card "N styles in N presets are not in your Style Library." naming each old -> new, "The compile will fail until they are updated.", one button "Update to the new names" that…
- [x] TC-4941: A name two styles once had, at compile: its own card "There is no style called X.
- [x] TC-4942: The rename-time question (renaming a style with the config open) still offers Never update / Keep old name / Update / Always update, and Update works.

## 465. WebUSB on Windows: the flash checks the board's setting and offers the fix — [B-660]
- [x] TC-4943: (Windows) Flash Serial + Mass Storage, then Serial + WebUSB.
- [x] TC-4944: Click Fix WebUSB: the status says a Windows permission window will come up, the button reads "Fixing" with animated dots and stays readable, Close is hidden.
- [x] TC-4945: Click No at the Windows prompt: Close comes back, the button is Fix WebUSB again, and the status says WebUSB was not fixed and browser tools will not connect until it is.
- [x] TC-4946: Close at the offer simply closes; nothing changes on the board or in Windows.
- [x] TC-4947: No offer when it is not needed: a build without WebUSB ends normally with no check; WebUSB after WebUSB (with or without Mass Storage) and WebUSB after Serial-only end "✓ Flash Complete" as before.
- [x] TC-4948: Bootloader Mode flash of a WebUSB build onto a board whose setting is broken: once the board is back, the same check and offer appear.
- [x] TC-4949: macOS and Linux: a WebUSB flash ends exactly as before; no check, no offer.

## 466. A bootloader flash uses the build's own folder — [B-661]
- [x] TC-4950: Restart the app with a config whose build is restored from cache ("Compile restored from cache"), enter Bootloader Mode, Flash: it flashes.
- [x] TC-4951: After a fresh compile of config A, open config B whose build is a cache hit and flash it from Bootloader Mode: the board runs B (check `version`'s installed: stamp), never A's leftover build.

## 467. USB type: Advanced…, the Mass Storage + WebUSB warnings, and Eject on a card that needs repair — [B-660]
- [x] TC-4952: The USB dropdown shows Serial, Serial + Mass Storage, Serial + WebUSB, Serial + Mass Storage + WebUSB, then "▸ Advanced…" in JMT blue.
- [x] TC-4953: ▸ Advanced… opens "Advanced USB types": a bold "Only pick one if you know you need it;", one line per type (No USB names BOOT + RESET and Bootloader Mode), a dropdown, Use this type / Cancel.
- [x] TC-4954: Pick an advanced type: it shows in the dropdown.
- [ ] TC-4955: ⏭ Cancelled, not to be run. .
- [ ] TC-4956: ⏭ Cancelled, not to be run. .
- [ ] TC-4957: ⏭ Cancelled, not to be run. .
- [ ] TC-4958: ⏭ Cancelled, not to be run. .
- [ ] TC-4959: ⏭ Cancelled, not to be run. .
- [ ] TC-4960: ⏭ Cancelled, not to be run. .
- [x] TC-4961: Export to a card flagged as needing repair: "There is a problem with <card>" now has the Eject row beside OK.

## 468. SD Export is for a card: the button, the SD Export dialog, and the card list — [B-664]
- [x] TC-4962: With fonts selected and no card in any reader or board, ↗ SD Export is disabled; hover says "No SD card found".
- [x] TC-4963: Insert a card in a reader with Studio on Sound Fonts: SD Export enables within a moment, no click needed; hover names the card ("PROFFIE (E:)", or "Removable Disk (F:)" with no label).
- [x] TC-4964: The button follows cards on Mac (/Volumes) and Linux (/media or /run/media) the same way.
- [x] TC-4965: Click SD Export: "Preparing SD Export…" appears at once and hands over to the SD Export dialog; the button stays greyed until the export ends.
- [x] TC-4966: The dialog: a paragraph saying what is copied (font folders, common folder, tracks, config) and the total, updating as boxes change; then short options; then "To" with the card.
- [x] TC-4967: A config that uses the common folder: Common folder is ticked and locked, the paragraph says "Your config uses the common folder, so it's included." A config that does not: Common folder is a free choice (with a…
- [x] TC-4968: Tracks: locked on with "Your config uses the tracks folder, so it's included." when the config references tracks/; otherwise a free box.
- [x] TC-4969: Untick Tracks and Config, export (or cancel), open SD Export again: they open unticked (last state).
- [x] TC-4970: No config open: Config is greyed with "none open".
- [x] TC-4971: Two cards: the card dropdown starts on "Choose a card" and Export stays disabled until one is picked.
- [x] TC-4972: A card needing repair (or, with the 32 KB block on, a 32 KB card in a board): greyed in the dropdown with a short reason, full wording on hover and under the dropdown.
- [x] TC-4973: Eject a card while the dialog is about to open: the dialog re-checks as it opens and no longer offers the ejected card.
- [x] TC-4974: Gone: the toolbar tracks toggle beside SD Export, "Always include with exports" in the tracks window, Settings' "Include the config with SD Export" row, and the "Update the tracks folder at this destination?" question.

## 469. The blue outline in Common Folders follows the open config — [B-665]
- [x] TC-4975: Open a config whose common slot is assigned a pack that is NOT the starred one: that pack is outlined in blue, the starred one is not.
- [x] TC-4976: Close the config: the outline moves to the starred pack.
- [x] TC-4977: Change the slot's pack in Config Manager: the outline in Sound Fonts moves to the new pack.
- [x] TC-4978: A config using two slots with different packs outlines both.

## 470. Compiles build without debug info (-g0) — [B-666]
- [x] TC-4979: Compile a large config on plugin 4.6 with a small edit (not a cache restore): it finishes in well under the config's earlier recorded compile time (primary_saber.h: 9 s on the Mac, 57 s on the laptop on battery,…
- [x] TC-4980: After that compile, build-output/compile_commands.json shows -g0 on the C and C++ compile lines.
- [x] TC-4981: Flash that build: the board boots, plays, and `version` over serial shows the new "installed:" time.
- [x] TC-4982: Compile the same config on plugin 3.6: it builds and flashes as before (no slower).

## 471. An old Style Library link from another computer or build gets the update — [B-667]
- [x] TC-4983: On the Mac, open a config whose include is the laptop's link (C:/Users/<name>/AppData/Roaming/jmt-studio-dev/my_styles.h) and compile: after any save questions, "Style Library link updated" appears; Update and…
- [x] TC-4984: The same with a link from the released build (…/jmt-studio/my_styles.h) opened in the dev build, and the reverse.
- [x] TC-4985: Before compiling, that config shows the Style Library as linked (no "Link Style Library" offer, no conflict prompt).
- [x] TC-4986: A config including some other my_styles.h by full path (e.g. G:\My Drive\...\ProffieOS Versions\my_styles.h) gets no notice and is left unchanged.

## 472. Proffieboard Plugin 4.6.0 JMT: board-card writes past 4 GiB come through intact — [B-668, B-614, B-659]
- [x] TC-4987: OS Versions: 4.6.0 JMT is listed right above 4.6.0 once it exists on this computer; picking it and compiling builds against the JMT plugin (Build Output names it).
- [x] TC-4988: A 32 KB-cluster card in a board flashed with Serial + Mass Storage + WebUSB on 4.6.0 JMT: SD Export of 20+ fonts (about 1 GB) through the board, then the card in a reader: every file matches the export record and…
- [x] TC-4989: Five rounds through the board of: sd 1, replace common with a different pack, eject, reset.
- [x] TC-4990: Serial Monitor on that build: 300 commands sent back to back are all answered (no wedge); repeat twice more.
- [x] TC-4991: The same build on stock 4.6.0 (no JMT) still gets the existing corruption warning when Mass Storage is chosen.

## 473. The 32 KB and Mass Storage + WebUSB warnings are gone — [B-668]
- [x] TC-4992: Pick Serial + Mass Storage + WebUSB in the USB dropdown: it is selected at once, no warning dialog.
- [x] TC-4993: Export a font to a 32 KB card in a board (Windows): no "Not safe to write" refusal; the export runs (slow-card warning only if over 100 MB).
- [x] TC-4994: SD Export's card list does not grey out a 32 KB board card.
- [x] TC-4995: Export to a board on Mass Storage + WebUSB: no "Writing through this board is risky" dialog, before or during the comparison.
- [x] TC-4996: The slow board-card warning still appears for a board-card export over 100 MB.

## 474. Plugin folders live under %LOCALAPPDATA%\JMT and move there on their own — [B-670]
- [x] TC-4997: (Windows) With plugin trees in %APPDATA%\jmt-studio\arduino-data, start Studio: they move to %LOCALAPPDATA%\JMT (4.6.0, 4.6.0-jmt, 3.6.0...) and compiles on each version still work.
- [x] TC-4998: A large config on 4.6.0 JMT compiles (no "bits/gthr-default.h: No such file or directory").
- [x] TC-4999: Settings' build-space footprint counts both the new and the old location.

## 475. The JMT plugin shares a compiler only when it matches the official release — [B-671]
- [x] TC-5000: First use of 4.6.0 JMT with Arduino IDE's 4.6 installed: Build Output says it is checking the compiler against the official release, then builds; no second 1.4 GB compiler is downloaded.
- [x] TC-5001: (Mac) The same on Home: the compiler matches even with Finder's .DS_Store files in its folders.
- [x] TC-5002: Change one byte in a file of the shared compiler: the JMT plugin is not made and Build Output says the compiler is not exactly the official release, so it was left alone.
- [x] TC-5003: node scripts/verify-installed-compilers.js reports MATCH for every installed compiler on Windows and Mac.

## 476. A build is kept and reused only if it used the plugin asked for — [B-672]
- [x] TC-5004: Switch to 4.6.0 JMT and compile: the build's map file links the library from the 4.6.0-jmt folder, and it is cached.
- [x] TC-5005: Compile 4.6.0, then 4.6.0 JMT, then 4.6.0 again: each reuses only its own cached build (Build Output says which).
- [x] TC-5006: A cached JMT build whose map shows the stock library is not reused; the next compile builds fresh.

## 477. The board restarts after an eject, even when it is busy taking the card back — [B-654]
- [x] TC-5007: sd 1 in Studio's Serial Monitor, export through the board, eject: the monitor shows one "> reset" and the board boots (font scan, boot sound); the eject line says the board restarted.
- [x] TC-5008: Repeat after a large export: still one reset, board restarts.

## 478. A card or reader that stops answering does not freeze Studio — [B-669]
- [x] TC-5009: (Hard to reproduce; run when a hanging reader turns up) SD Export to a card whose reader stops answering: within a few seconds "<card> is not responding" with "Check that the card is seated firmly in the reader, or…
- [x] TC-5010: The SD Export card list greys a card that is not responding, with "is not responding" on hover.

## 479. Board-card exports: warned up front, Cancel stops at once, the picker opens fast — [B-674]
- [x] TC-5011: SD Export to a board card of fonts the card's record does not hold, over 100 MB: "This could take a while" appears BEFORE "Comparing with your library", reading "This export is up to N files (X MB)".
- [x] TC-5012: The same with every selected font already on the card from an earlier SD Export: no warning before comparing (the record covers them).
- [x] TC-5013: Right-click Export font folder on a multi-selection over 100 MB to a board card: the same up-front "up to" warning; tracks export to a board card warns up front unless the card's record holds the tracks folder.
- [x] TC-5014: Cancel during "Comparing with your library" (SD Export and right-click): it stops within a second and the label says "Stopping…", not "finishing the current file".
- [x] TC-5015: A board-card export between 60 and 100 MB gives no slow warning; at 100 MB or more it does.
- [x] TC-5016: Last export went to a board card, board still plugged in: clicking Export shows "Opening the folder picker…" at once, and the picker opens at This PC (not inside the card), quickly.
- [x] TC-5017: Last export folder no longer exists (card removed): the picker opens in Downloads without a long wait.

## 480. Cancel stops a selection export, and the summary counts only what landed — [B-657]
- [x] TC-5018: Tick two or more fonts, SD Export to a board card, Cancel during the first font's copy: no further font starts, the ending says the export was stopped (not "Export complete"), and the card holds only fonts that finished.
- [x] TC-5019: The stopped font is not left half-written on the card, and the summary's file count matches what is on the card.

## 481. Style Library Append adds only what is new — [B-675]
- [x] TC-5020: Export the Style Library, then Append that same file: "Nothing added: all N styles are already in your library", and the library is unchanged (no second "Style Library · JMT Studio" header anywhere in it).
- [x] TC-5021: Append a file holding some styles already in the library and some new ones: only the new ones come in, with their headers; the toast says "Added X styles, skipped Y already in your library".
- [x] TC-5022: Append a file with a style of the same name but different code: it comes in and is flagged as a conflict.
- [x] TC-5023: A library that already carries a stray second header loses it on the next save.

## 482. Shift+click on Style Library cards selects without highlighting text — [B-676]
- [x] TC-5024: Style Library: click a card, then Shift+click another several rows away: the range selects and no text is highlighted on any card or the toolbar.
- [x] TC-5025: Ctrl+click (Cmd+click on Mac) toggles one card with no text highlight; plain text selection inside an open style's code still works.

## 483. Pre-build review fixes — [B-677]
- [x] TC-5026: Apple Silicon Mac, ProffieOS 7.x on plugin 3.6.0: Install JMT Patch makes 3.6.0 JMT (no "no record of the official compiler" refusal).
- [x] TC-5027: A JMT upgrade that fails at startup (e.g. a modified compiler in Arduino15) shows one error toast in plain words naming the version and Install JMT Patch; the next launch does NOT retry, lock Compile or show it again.
- [x] TC-5028: Pick a Mass Storage USB type on a config without MOUNT_SD_SETTING, answer "Remove Mass Storage": no JMT plugin offer follows.
- [x] TC-5029: SD Export of a large job to a reader card right after picking it (the volume label lookup and the health check overlap): the export runs; no "is not responding" refusal on a working card.
- [x] TC-5030: With 4.6.0 and 4.6.0 JMT both installed, the build-space total and what a reset says it frees agree with the drive's free space change (the shared compiler counted once, not twice).

## 484. Board Forensics: recording a board and its original firmware — [B-543]
- [x] TC-5031: Remembered choice on Ask, a board with no record on serial, press Flash: the build window asks "This board has not been recorded yet" (Never record / Not now / Record this board / Always record new boards).
- [x] TC-5032: X or Esc on that question closes the window and nothing is flashed.
- [x] TC-5033: Show Board Records: Original firmware (ProffieOS version + built date, config file, prop, KB used, read protection), Hardware (blades with LED counts, N buttons, 1 display), Presets (N), Recordings one line each…
- [x] TC-5034: Flash original firmware (right-click Flash or the records window): confirm names the version and recorded date and "not the config you have open (<name>)"; the whole flash is written, the log shows Download lines,…
- [x] TC-5035: Flash the same config twice: two "Flashed <config>" rows; the store holds one firmware file (board-forensics\store), each flash has its own board-forensics\<SN>\flashes\<id>\ folder linked to it.
- [x] TC-5036: Select an earlier "Flashed" row, Flash this firmware: "Read back: ...
- [x] TC-5037: Right-click Flash on a recorded board running a build in its records: no "Run board forensics again"; running a build not in its records: it is there.
- [x] TC-5038: No config open, a board with a serial on the port: the toolbar shows Run Board Forensics (no record; it records only, nothing flashed) or Show Board Records (recorded; tooltip names right-click, which opens the same…
- [x] TC-5039: board-forensics\<SN>\events.jsonl gains a line for each: detected, seen (version + build date), disconnected (bootloader), bootloader, forensics, flash (failed ones too, with the log tail), restore,…

## 485. Board Forensics in bootloader mode — [B-543]
- [x] TC-5040: A board with no record already in bootloader mode, Flash: the question adds "This board is in bootloader mode, where its presets and blade setup cannot be read.
- [x] TC-5041: A blank board (never flashed): "The flash is empty: this board has never been flashed."; the records show "Never flashed: the flash was empty when it was recorded" as its original.
- [x] TC-5042: After a bootloader-mode flash the title stays "Waiting for the board to restart" with no Close until the board is back ("✓ Flash Complete") or the wait ends; the flash is in the board's records.
- [x] TC-5043: A recorded board flashed in bootloader mode: Build Output says "Board <SN> already has records in JMT Studio.
- [x] TC-5044: Two boards in bootloader mode at once: no question; the flash is filed under the board that comes back.
- [x] TC-5045: A recording whose questions got no answer shows "Read in bootloader mode.

## 486. Unrecorded firmware on a recorded board — [B-543]
- [x] TC-5046: Write a build not in a recorded board's history from outside Studio (or another computer), Flash on Ask: "This board has firmware that hasn't been recorded" with its build date; Record this board saves it beside the…
- [x] TC-5047: Same in bootloader mode: "Checking the board's firmware against its records" while the flash is read once, then the same question.

## 487. Which recording is on the board now — [B-686]
- [x] TC-5048: Records mark every recording or flash with the build the board reports as "on the board now"; the Flash tooltip says "The board is already running this build." and Flash this firmware / Flash original firmware say…
- [x] TC-5049: After any flash, forensics run or restore, and after pressing refresh, the board is asked its version again (a new "seen" line in its event log) and the marks follow.

## 488. Install count — [B-687]
- [x] TC-5050: First launch of an installed 1.8.0 on a computer: the counters release's first-run-1.8.0.json download count rises by one about 15 s after launch; later launches do not; userData\install-count.json lists 1.8.0.
- [x] TC-5051: Offline first launch: no count, no message, nothing waits; the next online launch counts it.

## 489. Board Busy, and the DFU driver screen — [B-688]
- [x] TC-5052: Another program holding a board in bootloader mode (WinUSB bound), Flash: "Board Busy", "The board is in bootloader mode, but another program is using it.
- [x] TC-5053: A board whose bootloader really has no WinUSB: "Fix DFU Driver" with the new text ("...

## 490. Smaller 1.8 fixes from the forensics work — [BUG-021, BUG-024]
- [x] TC-5054: Several boards connected, none the open config's: the port box shows "—" with "N Proffieboards, select port"; picking one reads it.
- [x] TC-5055: SD Export to a board card over Mass Storage: "Checking the destination" moves within each font (bytes), not only between fonts.

## 491. Header, filter rows and footers at narrow widths — [B-699, NOTE-019, NOTE-020, NOTE-021]
- [x] TC-5056: Narrow the window on each tab: the gear stays at the top-right corner of the tab line at every width; the action row moves to the line below as a whole, right-aligned, and no button ever wraps on its own.
- [x] TC-5057: Keep narrowing: labels shorten one at a time, left to right, and an earlier one never comes back while the row is tight (Config Manager: Changes, Compare, Favs., Save As then Save lose the arrow; selection: Clear…
- [x] TC-5058: With a count taken off a label, hover the button: the count is at the end of its tooltip.
- [x] TC-5059: Filter rows on Sound Fonts and Style Library wrap by group (search + count, view + sort, facet dropdowns, quick filters); the divider before the facets shows while the groups share a line and is gone when the facets…
- [x] TC-5060: Style Library with styles selected: no divider is left at the end of the row after Undo / Redo.
- [x] TC-5061: Sound Fonts footer: Backup sits left, the size right; at a narrow width the size stacks under the key and nothing overlaps.
- [x] TC-5062: OS Versions: the plugin note sits beside the dropdown while it fits in about six lines, otherwise under "Building with…"; Config Manager build row: the Port dropdown narrows so USB stays on the line.

## 492. Export and flash fixes from the QA06-QA09 pass — [BUG-033, BUG-035, BUG-036, BUG-039]
- [x] TC-5063: SD Export to a board's card, then export again and click to choose the folder: the picker opens on Downloads, with no "You can't open this location".
- [x] TC-5064: Start an SD Export and press Cancel while it reads "Checking the destination": the window says "Export stopped" and "Nothing was copied.", and nothing is written to the destination.
- [x] TC-5065: Pull the card while an SD Export is copying: one message, "The card can no longer be reached", saying which fonts may be missing or only partly written; no raw system error, and no second error window behind it.
- [x] TC-5066: Compile, then flash the same config with nothing changed (the flash uses the build cache): the flash shows no Compile Time.

## 494. Fixes from the Mac Launch Pass (QA09-QA11) — [M20, M21, M24, M28, M31, M13]
- [x] TC-5068: In a config, type a change and press Ctrl+S (Cmd+S on macOS): the config saves and its unsaved mark clears.
- [x] TC-5069: Style Library code view: Ctrl+S saves the library and Ctrl+F finds in the library code.
- [x] TC-5070: Bulk import from a card whose scan found a program file: the analyze offers no "Continue to quick import without review", and the review shows no Quick import button or its description line.
- [x] TC-5071: Backup: the start screen's size counts a Shared Tracks file that is also a font's track once, and matches the finished backup and the Sound Fonts footer.
- [x] TC-5072: (macOS): Open an app browser (import from link): Studio behind it is blocked from the page but the browser stays bright and takes every click and key; clicking Studio brings the browser forward.
- [x] TC-5073: (macOS): Pull the card during an SD Export copy: "The card can no longer be reached", including when macOS still shows the card's /Volumes folder for a moment while it unmounts.
- [x] TC-5074: Show Board Records (or any board read), then flash straight away: the flash waits for the board to come back and finishes; it never sits waiting with nothing watching, and a port refresh during the wait hands the…
- [x] TC-5075: A flash that had to wait for its board shows one Flash Time that counts steadily from that flash's start; no figure jumps ahead from an earlier flash's clock.

## 495. Bulk import review: a more complete copy says it becomes a version — [NOTE-024]
- [x] TC-5076: Bulk import a card holding a font your library already has with more files (a curated or larger copy): its row is ticked and reads "Already in your library; your copy is more complete.

## 493. Flash erase hint wording, parked (macOS, Linux)
- [x] TC-5067: Flash a board on any platform: no hint line appears under the flash box (the platform hint is built and parked off)

## 496. Fixes from the Linux Launch Pass (QA12-QA17) — [L20, L21, L22, L27, L31, L36]
- [x] TC-5077: With the Serial Monitor open, SD Export to the board's own card with eject ticked: the board restarts and the summary says "Board restarted and ready to use." even when it leaves and returns between two port listings…
- [x] TC-5078: SD Export where the destination check takes a while: "Preparing to export" shows what it compares, the font and file, the elapsed time and Cancel from its first frame, at the same size as the windows before and after it.
- [x] TC-5079: Pull the card during an SD Export copy on Windows, macOS and Linux: "The card can no longer be reached", naming what may be missing, on all three, including when the system still lists the card for a moment.
- [x] TC-5080: An app browser window always closes from its own X, also on a page that has stopped answering.
- [x] TC-5081: Delete every font and common folder: the Sound Fonts footer shows the size of what is left, not a figure taken partway through the delete.
- [x] TC-5082: Restore a backup into an empty library: it goes straight to the restore, with no merge or replace choice.
- [x] TC-5083: The backup countdown sentence names no number; the only count on screen is the one on Start export.
- [x] TC-5084: A proof-of-purchase save that does not finish says "This page didn't finish rendering.
- [x] TC-5085: Right-click on an app browser page that has stopped answering: the menu still opens.
- [x] TC-5086: (Linux): Open an app browser from a font: it takes every mouse click and key, saves a Link and a Demo by right-click, closes from its X, and a click on Studio behind it brings the browser forward.
- [x] TC-5087: Shift-click and Ctrl-click across common folders, their files, shared tracks, a font's and a source's files, the card reader's folders and the presets sidebar: rows are selected and no page text turns blue, on any…
- [x] TC-5088: Delete a common folder: the Sound Fonts footer is measured again straight away, with no restart.
- [x] TC-5089: Bulk import from a card holding a common folder Studio exported: it comes in under its pack's name, read from its marker; without a marker the folder name stands.

---

## Bug Log

| ID | Found in | Severity | Description | Status |
|----|----------|----------|-------------|--------|
| BUG-001 | TC-1551, TC-1555 | P4 | Flash window: Compile Time floated to the centre. | ✅ Fixed |
| BUG-002 | TC-1551 | P4 | Flash window: the hint lead-in and Last compile were not aligned with the log box. | ✅ Fixed |
| BUG-003 | TC-1528, TC-1529 | P3 | The compile gate applied the SD fix but still asked to save before compiling. | ✅ Fixed |
| BUG-004 | TC-1535 | P4 | The pre-OS8 compile gate showed the full alarm on a repeat instead of a reminder. | ✅ Fixed |
| BUG-005 | TC-1552 | P4 | With no last compile, the live Compile Time sat on the left. | ✅ Fixed |
| BUG-006 | Windows pass L2 | P4 | First run: "Writing arduino-cli config..." is the last line of Build Output after the plugin is made, so it reads as still busy. | 1.8.1: B-721 |
| BUG-007 | Windows pass L2 | P4 | First run: Build Output shows the raw arduino-cli commands and their tool-configuration lines. | 1.8.1: B-721 |
| BUG-008 | Windows pass L2 | P4 | A saved Build Output with no board chosen writes "Board: Select board…" in its header. | 1.8.1: B-721 |
| BUG-009 | Windows pass L23 | P4 | The import summary and the library footer gave different sizes right after an import. | ✅ Fixed, commit c35c378 (one formatter and one count for every size) |
| BUG-010 | Windows pass L23 | P3 | A common folder from a card came in named "common" although Studio's marker inside it names the pack. | ✅ Fixed, commits 5cf25ad and 3e003fb |
| BUG-011 | Windows pass L19 | P3 | With fonts selected, SD Export stayed greyed when a card was mounted until the tab was left and reopened. | 1.8.1: B-722 |
| BUG-012 | Windows pass L19 | P1 | Antivirus quarantined a bundled program mid-export. | ✅ Fixed (B-681: every program file Studio ships is signed; retested on a fresh account) |
| BUG-013 | Dev testing | P4 | Last compile in the compile window stays at the time the file was opened after compiling again in the same session (not new in 1.8). | 1.8.1: B-723 |
| NOTE-014 | Dev testing | info | WebUSB check suspected of being inaccurate; tested across three USB types and correct. | No change |
| NOTE-015 | Dev testing | info | A board's serial port refused to open on the first flash of the day, outside Studio too. | No change; not seen again |
| BUG-016 | Dev testing | P4 | After Compile then Abort, the status bar reads as an error. | 1.8.1: B-689 |
| BUG-017 | Dev testing | P3 | The SD Export window on a refused card still shows the export form. | 1.8.1: B-690 |
| BUG-018 | Dev testing | P3 | The first flash of a never-seen board reports it was not detected after restart. | 1.8.1: B-691 |
| BUG-019 | Dev testing | P3 | A flash from bootloader mode did not record which board it flashed. | ✅ Fixed, commit 380f251 |
| NOTE-016 | Dev testing | check | Downloading a ProffieOS version while the first-run plugin setup is still running. | No change; finishes clean on fresh installs |
| BUG-020 | Windows retest | P3 | With two cards mounted, SD Export's card list does not say which card is in the board. | 1.8.1: B-724 |
| BUG-021 | Windows retest | P2 | Checking the destination on a board's card showed a bar that never moved. | ✅ Fixed, commit ad51b87 |
| BUG-022 | Dev testing | P2 | Library backup refused for room it did not need. | ✅ Fixed, commit 8390687 |
| NOTE-017 | Dev testing | P4 | Backup wording still mentioned a destination benchmark that was removed. | ✅ Fixed, commit 8390687 |
| BUG-023 | Dev testing | P2 | Library backup showed no progress for its first minutes. | ✅ Fixed, commit 8390687 |
| BUG-024 | Dev testing | P3 | With several boards and none preferred, the port box showed a port that was not selected. | ✅ Fixed, commit ad51b87 |
| BUG-025 | Windows pass L8 | P3 | Copy to all presets: a colour matching B1 by default did not re-match each preset's B1. | ✅ Fixed, commit 18b574c |
| BUG-026 | Windows pass L7 | P3 | Add to config added after the template's empty placeholder preset instead of filling it. | ✅ Fixed, commit 18b574c |
| NOTE-018 | Windows pass L12, L13 | P4 | A config needing a common folder the library does not have shows a chip but no preflight check. | 1.8.1 |
| NOTE-019 | Windows pass | P4 | Sound Fonts footer: the legend overlapped the library size at a narrow width. | ✅ Fixed, commit 18b574c |
| BUG-027 | Windows pass | P3 | A bulk import filed beside the originals reported 0 fonts and no space line. | ✅ Fixed, commit 18b574c |
| BUG-028 | Windows pass L45 | P2 | Save page as proof of purchase never finished on a page and said nothing. | ✅ Fixed, commit 18b574c (stops with a message); see BUG-046 |
| BUG-029 | Windows pass L34 | P3 | Import from a link: no sign of anything between clicking Download and the download starting. | ✅ Fixed, commit 18b574c |
| BUG-030 | Windows pass | P3 | A folder nearly identical to a font already in the library came in as a new font without offering Add as a version. | ✅ Fixed, commit 18b574c |
| BUG-031 | Windows pass | P3 | Three different totals for one library: footer, backup summary and restore progress. | ✅ Fixed, commit c35c378 |
| NOTE-020 | Windows pass | P4 | Sound Fonts toolbar buttons and the settings gear moved between rows as the width changed. | ✅ Fixed, commit 18b574c |
| NOTE-021 | Windows pass | P3 | Filter rows clipped at a narrow width on Sound Fonts and Style Library. | ✅ Fixed, commit 18b574c |
| BUG-032 | Windows pass L27 | P3 | SD Export's check window grew and shrank while it checked the destination. | ✅ Fixed, commit 5cf25ad |
| BUG-033 | Windows pass L27 | P3 | After an export to a board's card, the folder picker said "You can't open this location". | ✅ Fixed, commit 5cf25ad |
| BUG-034 | Windows pass | P4 | The "opening the folder picker" cover stayed behind the open picker. | ✅ Fixed, commit 5cf25ad |
| BUG-035 | Windows pass | P3 | Cancel while the export checked the destination gave no word on what happened. | ✅ Fixed, commit 5cf25ad |
| BUG-036 | Windows pass L30 | P2 | A card pulled mid-export showed a raw system error, with a second error window behind it. | ✅ Fixed, commit 5cf25ad |
| BUG-037 | Windows pass | P3 | Add files from the library: Shared Tracks ticks collapsed into one, under a redundant heading. | ✅ Fixed, commit 5cf25ad |
| NOTE-022 | Dev testing | check | The first Check Now with unreadable shipped error data failed once without a logged cause; the retry mended it. | No change; a log line now records the cause |
| BUG-039 | Mac pass M13 | P3 | A flash from the build cache showed the last compile's time as its own. | ✅ Fixed, commit 4ff46ad |
| NOTE-023 | Linux pass | P4 | The macOS and Linux flash hint's wording about dfu-util's Erase bar read as a warning. | ✅ Wording fixed, commit 7352181 (the hint stays off) |
| NOTE-024 | Windows pass | P4 | Bulk import review: a more complete copy of a library font said only that it was more complete. | ✅ Fixed, commit 0e9c37f |
| M13 | TC-5075 (Mac pass) | P3 | A flash showed a Compile Time left by an earlier compile. | ✅ Fixed, commit 4ff46ad (BUG-039) |
| M20 | TC-5073 (Mac pass) | P3 | A card pulled mid-export on a Mac (ENXIO) was not named as lost while macOS still showed its folder. | ✅ Fixed, commits 4ff46ad and c71aa4f |
| M21 | TC-5070 (Mac pass) | P3 | A card import that found a program file still offered quick import. | ✅ Fixed, commit 4ff46ad |
| M24 | TC-5072 (Mac pass) | P2 | On macOS the app browser went dim and took no clicks or keys while Studio was disabled behind it. | ✅ Fixed, commit 4ff46ad (Studio's page blocks itself instead) |
| M28 | TC-5071 (Mac pass) | P4 | The backup start screen counted a shared track that is also a font's track twice. | ✅ Fixed, commit 4ff46ad |
| M31 | TC-5068, TC-5069 (Mac pass) | P3 | Editor shortcuts (save, find) acted in the wrong editor. | ✅ Fixed, commit 4ff46ad |
| BUG-040 | L20, TC-5077 (Linux pass) | P3 | After an export with eject to the board's card, a fast Linux reboot was reported as not restarted and the monitor reconnected on top of it. | ✅ Fixed, commit 7560ff9; retest passed on QA14 |
| BUG-041 | L21, TC-5078 (Linux pass) | P4 | "Preparing to export" sat with an empty bar and no detail, shorter than the windows either side. | ✅ Fixed, commit 7560ff9; retest passed on QA14 |
| BUG-042 | L22, TC-5079 (Linux pass) | P3 | A card pulled mid-export on Linux showed a raw I/O error instead of the lost-card message. | ✅ Fixed, commit 7560ff9; card pull passed on Windows (QA13), macOS and Linux (QA14) |
| BUG-043 | L27, TC-5080 (Linux pass) | P2 | The app browser's close did nothing on a page that had stopped answering. | ✅ Fixed, commit 7560ff9 |
| BUG-044 | L31, TC-5081 (Linux pass) | P4 | After deleting everything the footer kept a size taken partway through the delete. | ✅ Fixed, commit 7560ff9 |
| BUG-045 | L31, TC-5082 (Linux pass) | P3 | A backup into an empty library offered merge or replace and compared first. | ✅ Fixed, commit 7560ff9; retest passed on QA16 |
| NOTE-025 | L31, TC-5083 (Linux pass) | P4 | The countdown sentence named a number the button had already passed. | ✅ Fixed, commit 7560ff9 |
| BUG-046 | L27, TC-5084, TC-5085 (Linux and Windows) | P2 | A proof-of-purchase save that runs past its limit keeps running, and later saves wait behind it until Studio restarts; the right-click menu waited on the stuck page. | ✅ Mitigated, commit decfb5f: the message says to restart and stays; the menu never waits. Root fix for 1.8.1: B-718 |
| BUG-047 | L36, TC-5086 (Linux pass, QA15) | P2 | On Linux the app browser took keys but no mouse input, and its X did nothing, while Studio's window was disabled behind it. | ✅ Fixed, commit 80aee5c; L36 passed on QA16 and QA17 |
| BUG-048 | TC-5087 (Linux pass, QA16) | P4 | A Shift-click in the common folder list (and other lists) painted a text selection across the page; on Windows it flashed. | ✅ Fixed, commit 7e5632d |
| BUG-049 | TC-5088 (Linux pass, QA16) | P3 | After deleting a common folder the footer kept its size until a restart. | ✅ Fixed, commit 7e5632d |
| BUG-050 | (Mac, QA17) | P4 | The first Shift-click on a common folder opens it instead of starting a selection. | 1.8.1: B-720 |
| NOTE-026 | L6 (Linux pass) | P3 | The AppImage does not start on Ubuntu 26.04 (libfuse2, then the sandbox helper), as in 1.7.2. | 1.8.1: B-711 |
| NOTE-027 | Linux pass | P4 | Smaller finds filed for 1.8.1: a comma in a font list gets ;common added (B-712); a half-typed quote empties the presets sidebar (B-713); the style editor round trip loses its credit (B-714); video-heavy pages are slow in the app browser (B-715); a card's FAT times read seven hours off on Linux force a full re-read (B-717); the Linux window icon is too large to set (B-719). | 1.8.1 |

**Severity:** P1 Blocker · P2 Major · P3 Minor · P4 Cosmetic

---

## Sign-off

- [x] All P1 bugs resolved ✅ *(BUG-012, fixed under B-681; retested on a fresh standard account)*
- [x] All P2 bugs resolved ✅ *(all fixed; BUG-046 mitigated in 1.8.0 with its root fix filed as B-718)*
- [x] P3/P4 bugs reviewed and triaged ✅ *(each is fixed or filed for 1.8.1)*
- [x] Both dark and light modes verified ✅ *(L32 on Linux: light and dark follow the system; System matches)*
- [x] Tested on Windows ✅ *(Windows launch pass, QA01 to QA11; QA17 installed and checked)*
- [x] Tested on macOS ✅ *(Mac launch pass, QA09 to QA11; QA17 signed, notarized, stapled, installed and checked)*
- [x] Tested on Linux ✅ *(Linux launch pass L1 to L36 on the .deb, QA12 to QA17; L6 AppImage skipped, B-711)*
- [x] **Windows code signing applied** ✅ *(every QA build and its bundled program files signed; signature Valid)*
- [x] **Linux `.deb` metadata complete** ✅ *(installs from the App Center with name, icon and publisher; AppStream release 1.8.0)*
- [x] Ready to ship ✅ *(2026-11-21)*
