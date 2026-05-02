# JMT Studio v1.6.3 — Full QA Test Plan

**Version:** 1.6.3  
**Tester:** Ryan Taylor 
**Date:** 4.26.26 
**Platform / OS:** Windows 11 pro 
**Build type:** Dev / Production

Mark each test: ✅ Pass · ❌ Fail · ⏭ Skip (note reason)  
Log failures in the **Bug Log** at the bottom with TC reference.

---

## 1. APP LAUNCH & GENERAL STATE

- [x] TC-001: App launches without errors or console exceptions ✅
- [x] TC-002: Last-used tab is restored on relaunch ✅ *(by design: always opens Config Manager; last open config file is restored — tab switching not persisted)*
- [x] TC-003: Last-opened config file is restored on relaunch ✅
- [x] TC-004: DEV BUILD banner shown in dev mode, absent in production ✅
- [x] TC-005: Window title shows app name on launch with no file open ✅
- [x] TC-006: Window title updates to filename when file is opened ✅
- [x] TC-007: Window title shows ● indicator when file has unsaved changes ✅
- [x] TC-008: Closing with unsaved changes → "Unsaved Changes" modal appears ✅
- [x] TC-009: Unsaved Changes modal — Cancel → stays open, file intact ✅
- [x] TC-010: Unsaved Changes modal — Discard → closes without saving ✅
- [x] TC-011: Unsaved Changes modal — Save → saves then closes ✅

---

## 2. THEME / APPEARANCE

- [x] TC-012: Dark mode renders correctly (all panels, modals, text readable) ✅ *(cosmetic issues logged: BUG-007, BUG-009)*
- [x] TC-013: Light mode renders correctly (all panels, modals, text readable) ✅ *(cosmetic issue logged: BUG-005)*
- [x] TC-014: System theme follows OS preference ✅
- [x] TC-015: Monaco editor theme matches app theme (dark/light) ✅
- [x] TC-016: Theme persists after app restart ✅
- [x] TC-017: OS Versions folder icon is gray/neutral in dark mode ✅
- [x] TC-018: OS Versions folder icon is gray/neutral in light mode ✅
- [x] TC-019: Switching theme mid-session doesn't break any panel layouts ✅

---

## 3. FILE OPERATIONS

- [x] TC-020: Open button launches file picker dialog ✅
- [x] TC-021: Selecting a valid .h config file loads it into the editor ✅ *(opening .txt is allowed by design; compile will fail naturally on junk — see BUG-010)*
- [x] TC-022: Canceling the file picker → no change to current state ✅
- [x] TC-023: Save button is hidden when no file is open ✅ *(by design: disabled/dimmed, not hidden — test case wording should be updated)*
- [x] TC-024: Save button appears once a file is open ✅ *(enabled, not newly appearing)*
- [x] TC-025: Save with no changes → file written, no error ✅
- [x] TC-026: Save with changes → file updated on disk ✅
- [x] TC-027: Save As → opens dialog, saves to new path, title updates ✅
- [x] TC-028: Save As → cancel → original file and path unchanged ✅
- [x] TC-029: Download button → saves a copy to user-chosen location ⏭ *(N/A — config files live on the user's own filesystem, no download concept applies. ProffieOS version download covered in Section 23; Style Library export covered in Section 15 — both verified working)*
- [x] TC-030: Close button → closes file, editor clears, Save button hides ✅
- [x] TC-031: Close with unsaved changes → Unsaved Changes modal appears ✅
- [x] TC-032: Undo button reverses last edit (equivalent to Ctrl+Z) ✅
- [x] TC-033: Redo button re-applies undone edit (equivalent to Ctrl+Y) ✅
- [x] TC-034: Undo/redo disabled appropriately at history boundaries ✅
- [x] TC-035: Recent files list populates after opening files ✅
- [x] TC-036: Clicking a recent file in the dropdown opens it ✅
- [x] TC-037: Removing a recent file (X button) removes it from the list ✅
- [x] TC-038: Recent files list respects the configured max count (Settings) ✅
- [x] TC-039: Opening a file that no longer exists → friendly error shown ✅ *(exceeds spec for recent files — missing files are auto-removed from recents. However favorites fail silently — see BUG-013)*
- [x] TC-040: Opening a non-config file → handled gracefully (no crash) ✅ *(file picker limited to .h and .txt so truly invalid files can't be selected)*

---

## 4. CONFIG METADATA FIELDS

- [x] TC-041: Filename field shows current file name ✅
- [x] TC-042: Filename field click shows recent files dropdown ✅
- [x] TC-043: Description field is editable and updates the config banner ✅
- [x] TC-044: Board dropdown shows all three board options (V3, V2, original) ✅
- [x] TC-045: Board selection persists with file (or session) ✅
- [x] TC-046: OS Version dropdown lists all installed ProffieOS versions ✅ *(see BUG-011 for truncation issue)*
- [x] TC-047: OS Version dropdown shows +JMT versions correctly ✅
- [x] TC-048: Selecting a different OS version updates the active compile target ✅ *(see BUG-012 for rename sync issue)*
- [x] TC-049: Config banner shows filename and description when file is open ✅
- [x] TC-050: Config banner shows Created and Updated timestamps if present ✅

---

## 5. FAVORITES SYSTEM

- [x] TC-051: Star button (★) next to filename favorites the current file ✅
- [x] TC-052: Star fills blue when file is favorited ✅
- [x] TC-053: Star unfills when clicked again (removes from favorites) ✅
- [x] TC-054: Favorites dropdown shows all favorited files ✅ *(no cap on favorites count — list is unbounded; dropdown would scroll at large counts. Not tested at scale; low real-world risk)*
- [x] TC-055: Current file marked with "current" label in favorites dropdown ✅
- [x] TC-056: Clicking a favorite in dropdown opens that file ✅ *(see BUG-013 for missing file case)*
- [x] TC-057: Remove button (X) on favorite removes it from the list ✅ *(works, but hit target is too small — see BUG-016)*
- [x] TC-058: Favorites persist after app restart ✅
- [x] TC-059: Favorites can be reordered by drag-and-drop ✅
- [x] TC-060: Favorites appear as cards on the empty state (no file open) ✅ *(see BUG-015 for layout issue)*
- [x] TC-061: Clicking a favorites card on the empty state opens the file ✅

---

## 6. MONACO EDITOR

- [x] TC-062: Editor loads file content correctly ✅
- [x] TC-063: C++ syntax highlighting applied ✅
- [x] TC-064: Line numbers visible ✅
- [x] TC-065: Cursor position shown in status bar (Ln X, Col Y) ✅
- [x] TC-066: Typing in editor marks file as dirty (● in title) ✅
- [x] TC-067: Selection size shown in status bar when text is selected ✅
- [x] TC-068: Minimap visible on right side of editor ✅
- [x] TC-069: Minimap jump-to-top button works ✅
- [x] TC-070: Minimap jump-to-bottom button works ✅ *(see BUG-017 — button position doesn't follow content height on short files)*
- [x] TC-071: Ctrl+Z undoes last edit in editor ✅
- [x] TC-072: Ctrl+Y redoes last undone edit in editor ✅
- [x] TC-073: Ctrl+F opens find panel within editor ✅
- [x] TC-074: Editor is scrollable for long files ✅
- [x] TC-075: Word wrap behavior is correct (long lines) ✅
- [x] TC-076: Editor retains cursor position when switching to/from other tabs ✅

---

## 7. COMPARE MODE

- [x] TC-077: Compare button opens "Compare With" file picker modal ✅
- [x] TC-078: Compare modal shows Recent Files and Favorites sections ✅
- [x] TC-079: Browse button in compare modal lets user pick any file ✅
- [x] TC-080: Cancel in compare modal → no changes ✅
- [x] TC-081: Selecting a file to compare → split diff view appears ✅
- [x] TC-082: Diff editor shows original (red label) and current (green label) ✅
- [x] TC-083: Differences are highlighted in the diff editor ✅
- [x] TC-084: Config banner shows both files in split layout when comparing ✅
- [x] TC-085: Clear (X) button in compare banner exits diff view ✅
- [x] TC-086: Exiting diff view restores normal Monaco editor ✅
- [x] TC-087: Compare mode indicator shown in status bar (▨ diff view) ✅
- [x] TC-083a: Hovering the → gutter arrow on a modified line shows "Click to revert change" widget ✅
- [x] TC-083b: Clicking "Click to revert change" on a modified line overwrites current with baseline value ✅
- [x] TC-083c: Reverted change is reflected in the current editor and dirty flag remains set ✅

---

## 8. PRESET SIDECAR

- [x] TC-088: Preset sidecar shows "PRESETS" label when collapsed ✅
- [x] TC-089: Clicking toggle expands the sidecar ✅
- [x] TC-090: Clicking toggle again collapses the sidecar ✅
- [x] TC-091: Sidecar lists all presets from the open config file ✅ *(see BUG-002 for row alignment issue with long names)*
- [x] TC-092: Each preset shows: number, name, font name ✅
- [x] TC-093: Clicking a preset selects it and shows detail pane below ✅
- [x] TC-094: Detail pane shows preset number, name, navigation arrows ✅ *(no navigation arrows — detail pane shows — and × only; test case description was inaccurate)*
- [x] TC-095: < and > navigation buttons move between presets ⏭ *(N/A — feature does not exist; test case was speculative. Navigation is done by clicking presets in the list.)*
- [x] TC-096: Delete button on a preset removes it from list and config ✅
- [x] TC-097: Add button (+) in sidecar header adds a new blank preset ✅
- [x] TC-098: Presets can be reordered by drag-and-drop ✅
- [x] TC-099: Right-click on preset shows context menu ✅
- [x] TC-100: Context menu has expected options (rename, duplicate, delete, etc.) ✅
- [x] TC-101: Preset detail shows slot tiles for each blade/style slot ✅
- [x] TC-102: Each slot tile shows: number badge, style expression, color swatch, RGB values ✅
- [x] TC-103: Color swatch reflects the slot's color (or fallback color) ✅
- [x] TC-104: Slot type badge shown (Helper / Reference / Inline / Error) ✅ *(see BUG-014 for tooltip wording on unlinked library styles)*
- [x] TC-105: Clicking a slot tile opens slot edit mode ✅
- [x] TC-106: Slot edit saves correctly to config ✅
- [x] TC-107: Delete button on a slot removes it ✅ *(required slots cannot be fully deleted — slot goes to black/empty style rather than being removed, which may be correct behavior. A previous error could not be reproduced — monitor in future runs)*
- [x] TC-108: Insert zone between slots allows adding a new slot ✅ *(insert zone is easy to accidentally trigger — not a bug but worth monitoring; future UX changes in this area should be careful not to make it more sensitive)*
- [x] TC-109: Library picker for adding styles from the style library works ✅
- [x] TC-110: Slot color picker opens and applies color changes ✅ *(see BUG-003 for interaction trap issue)*
- [x] TC-111: Editing preset name updates the config and sidecar list ✅
- [x] TC-112: Sidecar collapses correctly and editor expands to fill space ✅ *(see BUG-002 — sidecar width is user-resizable fix pending; going wider is acceptable behavior)*
- [x] TC-113: Monaco focus is correct after sidecar collapse/re-expand (can type immediately) — Won't Fix (BUG-023). Re-clicking editor after toggling sidecar is natural; auto-focus not warranted. ✅

---

## 9. BUILD SYSTEM — COMPILE

- [x] TC-114: Compile button disabled when no file is open ✅
- [x] TC-115: Compile button enabled when file is open and OS version selected ✅
- [x] TC-116: Clicking Compile opens the build modal ✅
- [x] TC-117: Build modal shows progress bar (Knight Rider animation during build) ✅
- [x] TC-118: Build modal shows elapsed time ✅
- [x] TC-119: Build log updates in real time during compile ✅
- [x] TC-120: Error lines appear in red in the build log ✅
- [x] TC-121: Progress lines appear in cyan in the build log ✅
- [x] TC-122: Successful build → progress bar turns blue, success message shown ✅
- [x] TC-123: Failed build → progress bar turns red, error message shown ✅
- [x] TC-124: Abort button cancels an in-progress build ✅
- [x] TC-125: Retry button re-runs the compile after failure ⏭ *(N/A — no Retry button on compile failure by design; user fixes the config and clicks Compile again. Retry only exists in flash/DFU flows.)*
- [x] TC-126: Close button dismisses modal after success ✅
- [x] TC-126a: Compile succeeds with no board connected → modal prompts user to connect; connecting board is detected and flash proceeds correctly ✅
- [x] TC-126b: DFU mode — compile succeeds with no board in bootloader → modal prompts user to enter DFU; board enters bootloader, detected, flash completes ✅
- [x] TC-126c: DFU mode — compile succeeds, board in bootloader but driver issue present → driver fix flow triggers and resolves before flash proceeds ✅
- [x] TC-127: Build log panel toggle (▼ Build Output) shows/hides the log panel ✅
- [x] TC-128: Build log clear button (✕ clear) clears the log ✅
- [x] TC-128a: Switching to a different config clears the build output panel ✅
- [x] TC-128b: Opening a new config clears the build output panel ✅
- [x] TC-128c: Closing a config clears the build output panel and collapses it if open ✅
- [x] TC-129: Compile status indicator in status bar updates (green/red/gray) ✅
- [x] TC-130: Cache check runs before compile and uses cached binary if valid ✅
- [x] TC-131: Building with no installed OS version → friendly error shown, Compile button disabled ✅

---

## 10. BUILD SYSTEM — FLASH

- [x] TC-131a: Flash progress log shows complete Download lines (no mid-line splits) ✅ *(retested as TC-463)*

- [x] TC-132: Flash button only available after successful compile ✅
- [x] TC-133: Flash button requires a port to be selected ✅
- [x] TC-134: Flash with valid port → flashes to board ✅
- [x] TC-135: Flash status indicator updates after flash (green/red) ✅
- [x] TC-136: Flash button in build modal (post-compile) works ⏭ *(N/A — no separate build modal; in DFU mode, if a prior compile exists, the modal offers Flash Now and that works correctly)*
- [x] TC-137: DFU Setup button shown when DFU driver not installed ✅
- [x] TC-138: Zadig button opens Zadig tool (Windows only) ✅ *(expanded — full DFU driver flow verified: "DFU device ready" shown when driver OK; Proffieboard Setup Tool and Zadig links open correct sites; Download DFU Tool works; Install button appears after download; Cancel works at both stages; UAC decline detected and shows "Installation cancelled" correctly. After successful install, detects Proffieboard in DFU and completes flash.)*
- [x] TC-138a: After DFU flash completes, app exits DFU mode and selects the newly-appeared serial port — correct even when multiple Proffieboards are connected ✅
- [x] TC-139: DFU Manual button shows manual DFU instructions ✅

---

## 11. PORT DETECTION

- [x] TC-140: Port dropdown lists available serial ports ✅
- [x] TC-141: Refresh button updates port list ✅
- [x] TC-141a: No board connected → app continues polling in background; when board is plugged in it is detected and auto-selected without manual refresh ✅
- [x] TC-142: Detected board name shown next to port (when recognized) ✅ *(TC wording outdated — board name is not shown; serial number (SN) is displayed instead, since V2/V3 cannot be determined from USB data. Correct behavior.)*
- [x] TC-143: Recommended port auto-selected when available ✅ *(covered by TC-141a)*
- [x] TC-144: Connecting a new board updates the port list (or via refresh) ⏭ *(by design — auto-detects on first connection only; if a board was previously detected, connecting a new one requires manual refresh. Expected behavior, not a bug.)*
- [x] TC-145: DFU mode indicator shown when board is in bootloader ✅
- [x] TC-146: "No port required" shown in DFU mode ✅
- [x] TC-147: Exit DFU button exits DFU mode ✅
- [x] TC-148: USB mode selector shows all expected options ✅
- [x] TC-149: USB mode selection persists across compile sessions ✅ *(TC wording is misleading — USB mode is not global; it persists per-config via metadata. Behavior is correct and by design.)*

---

## 12. SETTINGS PANEL

- [x] TC-150: Settings gear icon (⚙) opens settings modal ✅
- [x] TC-151: Settings modal shows Appearance, Cache, Recent Files, About sections ✅
- [x] TC-152: Light theme button applies light mode immediately ✅
- [x] TC-153: Dark theme button applies dark mode immediately ✅
- [x] TC-154: System theme button follows OS preference ✅
- [x] TC-155: Active theme button is visually highlighted ✅
- [x] TC-156: Cache size displayed next to Clear Compile Cache ✅
- [x] TC-157: Clicking Clear Cache → confirmation panel expands ✅ *(see BUG-024 — button should be disabled/hidden when cache is already empty)*
- [x] TC-158: Confirmation shows warning about build time impact ✅
- [x] TC-159: Cancel in cache confirmation → cache NOT cleared ✅
- [x] TC-160: Confirm clear → cache deleted, size updates to 0 ✅
- [x] TC-161: Recent files slider adjusts max list length (5–20) ✅
- [x] TC-162: Changing recent files count → list respects new limit immediately ✅ *(see BUG-005 — slider track nearly invisible in light mode)*
- [x] TC-163: About section shows correct app version (1.6.3) ✅
- [x] TC-164: About section shows JMT branding and contact info ✅
- [x] TC-165: Website link opens in external browser ✅
- [x] TC-166: Support email link opens mail client ✅
- [x] TC-167: "View License" button expands license text ✅
- [x] TC-168: Close button dismisses settings modal ✅

---

## 13. STATUS BAR

- [x] TC-169: Status bar visible at bottom of app ✅
- [x] TC-170: Line and column numbers update as cursor moves in editor ✅
- [x] TC-171: Selection size shown when text is selected ✅
- [x] TC-172: Language indicator shows "C++" ✅
- [x] TC-173: Board name shown in status bar ✅
- [x] TC-174: OS version shown in status bar ✅
- [x] TC-175: Compile timestamp shown after last compile ✅
- [x] TC-176: Flash timestamp shown after last flash ✅
- [x] TC-177: ● (dirty) indicator appears when file has unsaved changes ✅
- [x] TC-178: ● indicator clears after save ✅
- [x] TC-179: ▨ diff view indicator shown when compare mode active ✅
- [x] TC-180: Full file path shown in status bar (truncated with ellipsis if long) ✅

---

## 14. STYLE LIBRARY — Setup & Linking

- [x] TC-181: Style Library tab visible in tab bar ✅
- [x] TC-182: With no library: "Create Style Library" and "Link Style Library" buttons shown ✅
- [x] TC-183: "Create Style Library" → modal offers Blank or Import options ✅
- [x] TC-184: Create Blank → creates empty my_styles.h, loads into tab ✅ *(see BUG-020 — duplicate header written on first save after blank creation)*
- [x] TC-185: Import File → opens file picker, imports selected file ✅
- [x] TC-186: "Link Style Library" → adds #include to open config ✅
- [x] TC-187: Conflict modal appears if config already includes a different library ✅
- [x] TC-188: Conflict modal — Cancel → nothing changes ✅
- [x] TC-189: Conflict modal — Remove It → deletes conflicting include, links new library ✅
- [x] TC-190: Conflict modal — Comment Out & Link → comments old include, adds new one ✅

---

## 15. STYLE LIBRARY — Toolbar

- [x] TC-191: Save button disabled until a change is made ✅
- [x] TC-192: Save button saves changes to my_styles.h ✅ *(see BUG-020 — duplicate header on save after blank creation)*
- [x] TC-193: Discard button reloads file from disk, discarding in-memory changes ✅
- [x] TC-194: Delete button removes the style library from the app (with confirmation) ✅
- [x] TC-195: Append button merges another .h file into the library ✅
- [x] TC-196: Export button saves a copy of the library to a user-chosen location ✅
- [x] TC-197: Condense button converts library to single-line format ✅
- [x] TC-198: Expand button converts library to multi-line indented format ✅
- [x] TC-199: Code view button switches to Monaco editor view ✅ *(see BUG-018 — Undo/Redo buttons missing from code view toolbar)*
- [x] TC-200: Visual view button switches to the style card grid view ✅
- [x] TC-201: Link button (in tab) links library to currently open config ✅

---

## 16. STYLE LIBRARY — Code View

- [x] TC-202: Monaco editor loads my_styles.h content ✅
- [x] TC-203: C++ syntax highlighting applied ✅
- [x] TC-204: Edits in code view mark library as dirty (Save enables) ✅
- [x] TC-205: Minimap and jump buttons work in code view ✅
- [x] TC-206: Saving in code view persists changes that appear in visual view ✅ *(once style name is a valid using function — see BUG-019 for spaces issue; see BUG-020 for duplicate header on save)*

---

## 17. STYLE LIBRARY — Visual View: Style Cards

- [x] TC-207: Style cards grid loads all styles from library ✅ *(future idea: surface unrecognized/unparseable code somewhere — possibly a Monaco panel at bottom of visual view; deferred)*
- [x] TC-208: Each card shows: name, OS version badge, source, tags, effects ✅
- [x] TC-209: Search bar filters cards by name/tag/content ✅
- [x] TC-210: Search result count shown next to search bar ✅
- [x] TC-211: Clearing search restores full grid ✅
- [x] TC-212: Add Style button (+) opens Add Style modal ✅
- [x] TC-213: In-use styles (referenced in a preset) show blue highlight with dot ✅
- [x] TC-214: Styles with syntax errors show red background ✅
- [x] TC-215: Duplicate-name styles show yellow/gold background ✅
- [x] TC-216: Conflict banner shown when duplicate names exist ✅
- [x] TC-217: Legend bar visible and color-coded correctly ✅ *(see BUG-026 — legend bar hard to read; font size and padding too tight)*
- [x] TC-218: Cards can be reordered by drag-and-drop ✅ *(see BUG-027 — drag-and-drop reorder is not undoable via Ctrl+Z)*
- [x] TC-219: Clicking a card opens Style Detail modal ✅
- [x] TC-220: Delete button (X) on card removes style (after confirmation or directly) ✅
- [x] TC-221: Hover on card shows delete button and drag handle ✅ *(delete button shows correctly on hover; drag handle not visible but not a concern)*

---

## 18. STYLE LIBRARY — Add Style Modal

- [x] TC-222: "Add Style" modal opens from + button ✅
- [x] TC-223: Paste & Parse button extracts style from clipboard ✅ *(see BUG-004 — no feedback when clipboard contains no valid style)*
- [x] TC-224: Name field required — Add button disabled if empty ✅ *(see BUG-019 — spaces allowed in name, produces invalid using alias)*
- [x] TC-225: Source, Link, Tags, Notes fields are optional ✅
- [x] TC-226: Tags entered as comma-separated, displayed as chips ✅
- [x] TC-227: Code section shows Monaco editor for the style function ✅ *(see BUG-018 — Undo/Redo toolbar buttons missing; Ctrl+Z/Y work but no buttons for non-keyboard users)*
- [x] TC-228: Cancel → modal closes, nothing added ✅
- [x] TC-229: Add to Library (with name) → style added to grid, Save enables ✅ *(see BUG-019 — spaces in name produce invalid alias; fix: auto-replace spaces with underscores on keypress and on paste/parse)*
- [x] TC-230: Duplicate name → error or conflict handling shown ✅

---

## 19. STYLE LIBRARY — Style Detail Modal

- [x] TC-231: Clicking a style card opens Style Detail modal ✅
- [x] TC-232: Modal shows style name (editable with pencil button) ✅
- [x] TC-233: Source field editable with pencil button ✅
- [x] TC-234: URL field editable; clicking URL opens in external browser ✅ *(see BUG-029 — link hit target too wide, extends beyond visible text)*
- [x] TC-235: Effects chips displayed correctly ✅ *(see BUG-028 — effect parser misses Blast, Clash, Drag, Melt, PowerSave, Volume)*
- [x] TC-236: Tags chips displayed; can add new tags via input ✅
- [x] TC-237: Notes section collapses/expands with arrow ✅
- [x] TC-238: Code editor shows full style function (read-only initially) ✅ *(read-only behavior may not match test case description exactly — works as expected in practice; test case wording should be revisited)*
- [x] TC-239: Error banner shown if style has syntax issues ✅
- [x] TC-240: Copy Function button copies full block to clipboard ✅
- [x] TC-241: Copy Style button copies StylePtr line to clipboard ✅
- [x] TC-242: Discard button closes without saving changes ✅
- [x] TC-243: Save button saves changes and marks library as dirty ✅

---

## 20. STYLE LIBRARY — Helpers Panel

- [x] TC-244: Helpers panel visible on left side of visual view ✅ *(correctly collapsed when no helpers present)*
- [x] TC-245: List shows all helper functions defined in library ✅
- [x] TC-246: Each helper shows: name, type badge, notes preview ✅
- [x] TC-247: Clicking a helper selects and highlights it ✅ *(see BUG-008 — highlight animation fires during scroll, may be missed)*
- [x] TC-248: Selected helper shows editor panel with name and code ✅
- [x] TC-249: Helper name editable inline with pencil ✅
- [x] TC-250: Editing name that is referenced elsewhere → rename modal appears ✅
- [x] TC-251: Rename modal — Cancel → name unchanged ✅
- [x] TC-252: Rename modal — Save anyway → renames without updating references ✅
- [x] TC-253: Rename modal — Update everywhere → renames and updates all references ✅
- [x] TC-254: Notes section for helper collapses/expands ✅
- [x] TC-255: Code editor for helper allows editing implementation ✅
- [x] TC-256: Save button in helper editor saves changes, marks library dirty ✅
- [x] TC-257: Add (+) button in helpers header adds a new blank helper ✅
- [x] TC-258: Delete (X) on helper removes it from library ✅
- [x] TC-259: Duplicate helper names show conflict badges ✅
- [x] TC-260: Helpers panel divider is draggable to resize ✅
- [x] TC-261: Helpers panel collapse button collapses the panel ✅

---

## 21. OS VERSIONS — Installed List

- [x] TC-262: Versions appear in reverse alphabetical order ✅
- [x] TC-263: Each card shows name, size, modified date ✅
- [x] TC-264: Card shows "ProffieOS X.XX" when version is known ✅
- [x] TC-265: Card shows notes preview (first line of notes) ✅
- [x] TC-266: Card with no notes shows no preview ✅
- [x] TC-267: Card with unknown ProffieOS version shows no version line ✅
- [x] TC-268: Clicking a card selects it (highlighted) and loads detail pane ✅
- [x] TC-269: Switching between cards updates detail pane correctly ✅
- [x] TC-270: Empty list → "No versions installed." message shown ✅

---

## 22. OS VERSIONS — Import Version

- [x] TC-271: "Import Version" button opens modal ✅ *(see BUG-012 — import does not update Config Manager dropdown)*
- [x] TC-272: Browse selects a ProffieOS folder, path populates ✅
- [x] TC-273: ProffieOS version "8.10" → valid, no error ✅
- [x] TC-274: ProffieOS version "7.14" → valid ✅
- [x] TC-275: ProffieOS version "8.1" → red border + error, Import disabled ✅ *(see BUG-032 — error fires on keypress; should wait until field loses focus)*
- [x] TC-276: ProffieOS version "8.100" → red border + error, Import disabled ✅
- [x] TC-277: ProffieOS version "8.1000000001" → red border + error, Import disabled ✅
- [x] TC-278: ProffieOS version "123.10" → red border + error (max 2 digits before dot) ✅
- [x] TC-279: Clearing invalid text → border and error clear ✅
- [x] TC-280: No folder + valid name + valid ver → Import disabled ✅
- [x] TC-281: Valid folder + no name → Import disabled ✅
- [x] TC-282: Valid folder + valid ver + no name → Import disabled ✅
- [x] TC-283: All valid → Import enabled ✅
- [x] TC-284: Cancel → modal closes, nothing added ✅
- [x] TC-285: Reopening modal → all fields reset, no stale error state ✅
- [x] TC-286: Import succeeds → version appears in list, selected in detail ✅
- [x] TC-287: "↓ Download from GitHub instead" link opens Download modal ✅
- [x] TC-288: Non-ProffieOS folder → error, no version created ✅ *(see BUG-033 — invalid folder path remains in the field after error; should be cleared)*
- [x] TC-289: Duplicate mode hides folder/version fields, pre-fills "(copy)" name ✅
- [x] TC-290: Duplicate succeeds → copy appears with same ProffieOS version ✅

---

## 23. OS VERSIONS — Download Version

- [x] TC-291: "Download Version" button opens modal ✅
- [x] TC-292: Release list loads (v6+ only) ✅
- [x] TC-293: Selecting a release populates ProffieOS version and name ✅
- [x] TC-294: Name field is editable ✅
- [x] TC-295: Empty name → Download disabled ✅
- [x] TC-296: Cancel → nothing downloaded ✅
- [x] TC-297: Download → progress bar animates ✅
- [x] TC-298: Download completes → version appears in list with correct ProffieOS version ✅
- [x] TC-299: No internet → "No internet connection." within 15 seconds ✅
- [x] TC-300: No internet mid-download → error shown, no broken version left in list ✅

---

## 24. OS VERSIONS — Detail Pane

- [x] TC-301: Header shows version name, size, modified date ✅
- [x] TC-302: ProffieOS version shown in color when known, dim when unknown ✅
- [x] TC-303: Rename → inline input replaces title, text selected ✅ *(see BUG-012 — rename does not update Config Manager dropdown)*
- [x] TC-304: Rename — Enter / ✓ → renames, list and detail update ✅
- [x] TC-305: Rename — Escape / ✕ → cancels, original name shown ✅
- [x] TC-306: Rename same name → no-op ✅
- [x] TC-307: Rename to existing name → inline error ✅
- [x] TC-308: Duplicate → opens import modal in duplicate mode ✅
- [x] TC-309: Export → folder picker, copies version, opens in file manager ✅
- [x] TC-310: Export cancel → no action ✅
- [x] TC-311: Export to location that already has same-named folder → error ✅
- [x] TC-312: Delete → inline confirmation in JMT panel ✅
- [x] TC-313: Delete — Cancel → version still in list ✅
- [x] TC-314: Delete — Confirm → removed from list, detail pane clears ✅
- [x] TC-315: Deleting only version → empty state shown ✅

---

## 25. OS VERSIONS — Notes

- [x] TC-316: Notes textarea empty when no notes saved ✅
- [x] TC-317: Typing → "Unsaved changes" appears, Save Notes enables ✅
- [x] TC-318: Save Notes → "Saved" shown briefly, button disables ✅
- [x] TC-319: Notes preview on card updates after saving ✅
- [x] TC-320: Clearing all text and saving → card preview removed ✅
- [x] TC-321: Switching versions → textarea shows that version's notes (no bleed-over) ✅

---

## 26. OS VERSIONS — File Browser

- [x] TC-322: FILE BROWSER label visible ✅
- [x] TC-323: Small 📂 icon sits directly after "FILE BROWSER" text (not far right) ✅
- [x] TC-324: Icon is gray/neutral in dark mode ✅
- [x] TC-325: Icon is gray/neutral in light mode ✅
- [x] TC-326: Icon opacity increases on hover ✅
- [x] TC-327: Clicking icon opens system file manager in ProffieOS/ subfolder ✅
- [x] TC-328: .jmt_meta.json NOT visible when folder opens ✅
- [x] TC-329: File tree shows ProffieOS/ as root ✅
- [x] TC-330: Folders expand on click, collapse on second click ✅
- [x] TC-331: Empty folder shows "(empty)" ✅
- [x] TC-332: File click opens Monaco viewer modal ✅
- [x] TC-333: Viewer shows correct content and syntax highlighting ✅
- [x] TC-334: Viewer close button works ✅
- [x] TC-335: Search by filename → results with path ✅
- [x] TC-336: Search by content → results with match count and preview ✅
- [x] TC-337: Clicking search result → viewer opens at first match ✅
- [x] TC-338: Clear search (✕) → full tree returns ✅
- [x] TC-339: No search results → "No matches found" shown ✅

---

## 27. JMT ADD-ONS — First Time Add

- [x] TC-340: No JMT installed → button says "⚙ Add JMT Features" ✅
- [x] TC-341: Click → "Fetching manifest…" shown ✅
- [x] TC-342: Compatible ProffieOS → green ✓ compatible message ✅
- [x] TC-343: ProffieOS too old → red ⛔ blocked, no Add button ✅
- [x] TC-344: ProffieOS newer than tested → yellow ⚠ warning, Add still available ✅
- [x] TC-345: ProffieOS version unknown → ⚠ warning, Add still available ✅
- [x] TC-346: Confirmation shows file list and disclaimer about not modifying existing files ✅
- [x] TC-347: Cancel → nothing installed ✅
- [x] TC-348: Add → progress shown (X/Y — filename) ✅
- [x] TC-349: Success → "+JMT" appended to version name ✅
- [x] TC-350: "+JMT" NOT double-appended if name already contains it ✅
- [x] TC-351: "Includes JMT Add-ons vX.X.X" label appears immediately in action bar ✅
- [x] TC-352: Button changes to "⚙ Check for Updates" immediately ✅
- [x] TC-353: OS Version dropdown in Config Manager updates to show renamed version ✅
- [x] TC-354: No internet on manifest fetch → "No internet connection." within 15 sec ✅
- [x] TC-355: No internet on file download → "No internet connection." within 15 sec ✅

---

## 28. JMT ADD-ONS — Check for Updates / Integrity

- [x] TC-356: JMT installed → button says "⚙ Check for Updates" ✅
- [x] TC-357: "Includes JMT Add-ons vX.X.X" shows correct installed version ✅ *(see BUG-006 — contradictory messaging when ProffieOS version unknown)*
- [x] TC-358: Up to date + files intact → "JMT Add-ons vX.X.X is up to date" ✅
- [x] TC-359: Up to date + file modified → integrity warning, Reinstall offered ✅
- [x] TC-360: Up to date + file missing → integrity warning, Reinstall offered ✅
- [x] TC-361: Reinstall succeeds → success message, version label stays correct ✅
- [x] TC-362: Update available → shows vOLD → vNEW, file list, Update button ✅
- [x] TC-363: Major version update → yellow warning shown ✅ *(see BUG-040 — major update should offer copy-before-update option for easy revert)*
- [x] TC-364: Cancel update → nothing changes ✅
- [x] TC-365: Update succeeds → version label updates immediately ✅
- [x] TC-366: No internet on check → "No internet connection." within 15 seconds ✅

---

## 29. NO INTERNET — All Network Paths

- [x] TC-367: Download Version opened offline → error within 15 seconds, not a raw Node error ✅
- [x] TC-368: Add JMT Features offline → error within 15 sec, button re-enables ✅
- [x] TC-369: Check for Updates offline → error within 15 sec, button re-enables ✅
- [x] TC-370: Error message text says "No internet connection." (not "ENOTFOUND" or similar) ✅
- [x] TC-371: After network error, all buttons return to usable state (no stuck spinners) ✅

---

## 30. KEYBOARD SHORTCUTS

- [x] TC-372: Ctrl+Z — undo in config editor ✅
- [x] TC-373: Ctrl+Y — redo in config editor ✅
- [x] TC-374: Ctrl+F — find in file viewer (OS Versions Monaco modal) ✅
- [x] TC-375: Ctrl+S — save current config file (if dirty) ✅
- [x] TC-376: Keyboard shortcuts don't fire when focus is in a text input/modal that should capture them ✅

---

## Bug Log

| ID | TC | Severity | Description | Status |
|----|----|----------|-------------|--------|
| BUG-001 | TC-011 | P1 | Ctrl+R (and likely F5/Ctrl+Shift+R) reloads the renderer, bypassing the unsaved changes guard and causing data loss. **Fix:** intercept `before-input-event` in main.js and call `event.preventDefault()` for Ctrl+R, Ctrl+Shift+R, F5. | Fixed ✅ |
| BUG-002 | TC-091 | P4 | Preset sidecar rows misalign when preset name is too long — long names push the font name column left, breaking alignment with other rows. **Fix:** `.preset-row-name` changed from `flex: 0 1 auto` to `flex: 1 1 0` so it fills all available space; `.preset-row-font` loses `margin-left:auto` and gains `flex-shrink:0; max-width:90px` so the font column is always at a consistent position regardless of name length. Sidecar resizer was already implemented. | Fixed ✅ |
| BUG-003 | TC-110 | P3 | Color picker does not trap interaction — while open, clicks outside the picker that land on app buttons/controls activate those controls instead of dismissing the picker. Behavior is unpredictable and the dismiss gesture (click to the side) is not obvious to all users. **Fix:** (1) add a transparent full-screen overlay behind the picker that captures all outside clicks and dismisses it; (2) add a near-invisible ✕ in the top-right corner of the picker as a discoverable close affordance. | Fixed ✅ |
| BUG-004 | TC-223 | P3 | Paste & Parse in Add Style modal accepts garbage input silently — if no valid style is detected after parsing, no warning or feedback is shown. User is left with empty/unchanged fields and no indication of why. **Fix:** after parsing, check if a style function was extracted; if not, show a warning message (e.g. "No style found in clipboard — make sure you copied a valid StylePtr or style function.") in the existing `add-style-msg` element. | Fixed ✅ |
| BUG-005 | TC-161 | P4 | Recent Files slider track is nearly invisible in light mode — appears as a floating dot with no visible rail, making it unclear it's a slider. Dark mode is fine. **Fix:** added `html.light-mode .settings-slider { background: #c0c0c0; }` so the track is clearly visible in light mode. | Fixed ✅ |
| BUG-006 | TC-357 | P4 | When ProffieOS version is unknown, showing "JMT Add-ons vX.X.X is up to date" alongside the unknown-version warning creates contradictory messaging. **Decision:** unknown version only occurs when a user manually backdoors a version (bypasses normal import flow) — accepted as user-created edge case, no fix planned. Downgraded to P4 / Won't Fix. | Won't Fix |
| BUG-007 | TC-356 | P4 | "Check for Updates" (and "Add JMT Features") button in OS Versions action bar is hard to read in dark mode — uses a JMT-blue outline/ghost style that looks good in light mode but lacks contrast in dark mode. **Fix:** `.vp-jmt-btn` now uses `color: #4ab4f0; border-color: #2a7ec8` in dark mode (readable light blue), and restores the original `var(--jmt-blue)` values via light-mode overrides. | Fixed ✅ |
| BUG-008 | TC-247 | P3 | When clicking a helper-referenced style, scroll and orange highlight animation fire in parallel — the highlight is missed or diminished because it plays during the scroll motion. **Fix:** chain sequentially: scroll to the target element first, then apply the highlight class after scroll completes (use `scrollIntoView()` + a short `setTimeout` or a `scrollend` event listener before adding the highlight). | Fixed ✅ |
| BUG-009 | TC-244 | P4 | Helpers panel background is too dark in dark mode — inherits `--c-bg` (#111) from parent, darker than surrounding panels. **Fix:** added `background: var(--c-bg-raised)` (#181818) directly to `#styles-helpers-panel`, bringing it in line with adjacent panel backgrounds. | Fixed ✅ |
| BUG-010 | TC-021 | P2 | If a user opens a .txt config file and then saves or triggers compile, the file is saved silently as .txt. A .txt file will not compile correctly and the extension mismatch may confuse users. **Fix:** on save, .txt is saved first (non-destructive), then saved as .h; active file switches to .h; meta bar shows inline conversion notice; .txt removed from recents. | Fixed ✅ |
| BUG-011 | TC-046 | P4 | OS Version dropdown in Config Manager clips long version names abruptly in both open and closed states. **Fix:** added `max-width: 160px; overflow: hidden; text-overflow: ellipsis` to `#input-version` CSS; `title` attribute set to the selected value on populate and on every change event so hovering shows the full name. | Fixed ✅ |
| BUG-012 | TC-048, TC-271, TC-291, TC-303 | P2 | OS Version dropdown in Config Manager does not stay in sync when versions change in the OS Versions panel — affects rename (TC-303), import (TC-271), download (TC-291), and any name change (TC-048); dropdown shows stale data until app restart. **Fix:** `window.refreshVersionDropdown()` called after rename, delete, and JMT apply in versionsPanel.js; import and download paths already handled. | Fixed ✅ |
| BUG-013 | TC-039 | P2 | Missing favorited files fail silently — clicking a favorite whose file no longer exists does nothing (no message, no offer to remove). Backend already returns `exists: false` in `favorites:get` — the data is there, just not used. **Fix:** missing cards rendered with dashed red border, dimmed, tooltip, click-to-open disabled, remove button active. Two follow-on issues logged: BUG-041 (stale card if file deleted while page is open), BUG-042 (missing card position inconsistency). | Fixed ✅ |
| BUG-014 | TC-104 | P4 | Slot tooltip wording was too alarmist for users who define styles externally. **Fix:** updated tooltip to: "...looks like a library style but my_styles.h is not linked in this config. If defined externally it may still compile correctly, otherwise it will be undefined at compile time." Also removed em dash from previous wording. | Fixed ✅ |
| BUG-015 | TC-060 | P3 | Favorites empty-state card grid is fixed 3 columns, left-clustered, with excessive blank space above — looks unbalanced and wastes the available area. **Fix:** calculate optimal column count in JS based on card count and container width: `cols = clamp(ceil(sqrt(N)), 1, floor(containerWidth / minCardWidth))`. Apply as `grid-template-columns: repeat(cols, minmax(0, maxCardWidth))` with the grid centered. Trigger scrollbar only beyond ~5 rows. Incomplete last rows should center their cards. Result: 2 cards → 1×2, 4 → 2×2, 6 → 2×3 or 3×2, 9 → 3×3 — balanced, fills space, looks intentional. | Fixed ✅ |
| BUG-016 | TC-057 | P4 | Favorites remove (×) button hit target is too small — difficult to click reliably. **Fix:** `.fav-remove` padding increased from `2px 4px` to `3px 8px`, meaningfully widening the click target without changing the visual size of the icon. | Fixed ✅ |
| BUG-017 | TC-070 | P4 | Minimap jump-to-bottom button stays pinned at the physical bottom of the minimap container regardless of content length — on short files it sits below the actual content end, looking disconnected. Functional but cosmetically odd. **Decision:** accepted as known condition. Button is functional on all configs of practical length; short configs rarely need it. Won't Fix. | Won't Fix |
| BUG-018 | TC-199 | P3 | Style Library code view toolbar and style detail editor are missing Undo and Redo buttons — Ctrl+Z/Y work but there are no toolbar buttons for non-keyboard users, unlike Config Manager. Compare File also absent from code view toolbar. **Fix:** add Undo, Redo (and consider Compare) to the Style Library code view toolbar and to the style detail Monaco editor toolbar, wired to their respective Monaco instances. | Fixed ✅ |
| BUG-021 | TC-083 | P3 | Diff editor requires deleting a line before the copy-from-other-side arrow appears — you cannot overwrite an existing line directly from the comparison side. Unintuitive since the action is undoable. This is Monaco's default diff behavior. **Fix:** Enable `glyphMargin: true` on the diff editor — this surfaces Monaco's built-in per-change revert widget (hover the → gutter arrow to get "Click to revert change"). No custom code required. Target audience (config coders) will find the gutter control intuitive. | Fixed ✅ |
| BUG-019 | TC-224 | P2 | Style name field allows spaces — spaces in a C++ `using` alias are invalid and result in a malformed `using` declaration that is not detected as a valid style function and does not appear in visual view. **Fix:** intercept the spacebar keydown event and insert an underscore instead (silent, graceful); also sanitize on paste and during Paste & Parse if a name is extracted. No scenario where spaces end up in a saved name. | Fixed ✅ |
| BUG-020 | TC-192 | P2 | Duplicate header added on save — when a blank style library is created and then saved after manual edits, a second header block is inserted. Deleting one header causes it to re-appear on next save; deleting both results in only one (correct) header being written. Root cause: save routine uses a different header format/detection pattern than the one written on creation, so it always thinks the header is missing. **Fix:** audit the header detection regex in the save path to match both the old and new header format, and ensure the canonical header is only written once. | Fixed ✅ |
| BUG-035 | TC-143 | P1 | Three related port/board detection failures: (1) **Auto-selection stomps manual choice** — Fixed: `_userChosePort`/`_userChosenPortPath` flag added; multi-board branch now restores user's port on rescan; flag cleared only when chosen port disappears. (2) **Detected field always shows V3** — Fixed: removed hardcoded V3 sort preference; now returns `variants[0]` as-is. (3) **Board/Detected mismatch** — Resolved by design: V2/V3 cannot be determined from USB data; Detected field now shows SN or generic "Proffieboard" only — version-specific mismatch cannot occur. | Fixed |
| BUG-034 | TC-249 | P3 | Helper name field remains in inline edit mode after saving — the pencil/input stays active instead of reverting to display mode. User has to click away or press Escape to dismiss it manually. **Fix:** after a successful name save, programmatically exit edit mode (hide the input, show the display label with the updated name, restore the pencil icon). | Fixed ✅ |
| BUG-033 | TC-288 | P3 | After selecting an invalid (non-ProffieOS) folder in the Import Version modal, the invalid path remains displayed in the Folder field alongside the error message. **Fix:** clear the folder path field and reset it to its placeholder when validation fails on Browse selection, so the user sees a clean empty field and the error, rather than an invalid path they can't use. | Fixed ✅ |
| BUG-032 | TC-275 | P3 | ProffieOS version field in the Import Version modal validates on every keystroke — typing "8" immediately shows a red error border, even though the user hasn't finished typing yet. Error should only trigger on blur (when the field loses focus), not while the user is actively typing. **Fix:** move the validation call from the `input` event handler to the `blur` event handler; clear the error on `focus` so the field resets cleanly while the user is editing. | Fixed ✅ |
| BUG-031 | TC-317 | P3 | OS Version notes have several unsaved-changes guard gaps: (1) No Ctrl+Enter shortcut to save — requires mouse click on Save Notes; (2) Switching to a different installed version with unsaved notes gives no warning or save offer — changes are silently discarded; (3) Leaving the OS Versions tab with unsaved notes gives no warning; (4) Closing the app with unsaved notes gives no warning. **Fix:** (1) Ctrl+Enter keydown handler on `notesEl` calls `saveBtn.click()`; (2) card click checks `_vpNotesDirty` and confirms before `_vpSelectVersion`; (3) `switchTab` checks `window.vpHasUnsavedNotes?.()` when leaving versions tab; (4) app close handler checks same. `_vpNotesDirty` flag tracked at module level, exposed as `window.vpHasUnsavedNotes`. | Fixed ✅ |
| BUG-030 | TC-239 | P3 | Style detail modal shows no explicit error banner when a style has syntax issues — only a small red dot in the Monaco gutter, which is easy to miss and gives no actionable information. **Fix:** error banner (`detail-error-banner`) and `_updateDetailErrorMarkers()` already implemented; banner fires on open via `_setDetailDirty(false)` and on every edit. Already working. | Fixed ✅ |
| BUG-029 | TC-234 | P3 | Website/URL link hit target in the style card detail view is too wide — the clickable area spans the full container width rather than just the link text, making it easy to trigger accidentally when clicking elsewhere on the same line. **Fix:** ensure the anchor element is `display:inline` (or `width:fit-content`) so the hit target is bounded by the visible text only, not the row width. | Fixed ✅ |
| BUG-028 | TC-208 | P3 | Effect detection in Style Library cards misses effects that appear as the final argument of generic wrapper templates. Correctly detects named wrappers (`InOutTrL`, `ResponsiveLightningBlockL`, `AudioFlicker`, `BatteryLevel`) but misses: **Blast** (`TransitionEffectL<..., EFFECT_BLAST>`), **Clash** (`TransitionEffectL<..., EFFECT_CLASH>`), **Drag** (`LockupTrL<..., LOCKUP_DRAG>`), **Melt** (`LockupTrL<..., LOCKUP_MELT>`), **PowerSave** (`EffectSequence<EFFECT_POWERSAVE, ...>`), **Volume** (`TransitionEffectL<..., EFFECT_VOLUME_LEVEL>`). **Fix:** Added `EFFECT_BLAST`, `EFFECT_CLASH`, `LOCKUP_DRAG`, `LOCKUP_MELT`, `EFFECT_POWERSAVE`, `EFFECT_VOLUME_LEVEL` patterns to `effect-keywords.js`. | Fixed ✅ |
| BUG-027 | TC-218 | P3 | Drag-and-drop card reorder in Style Library visual view is not undoable — Ctrl+Z after a drag does nothing. User must manually drag back if they made a mistake. **Fix:** push a reversible action onto the library's undo stack when a drag completes (snapshot order before and after); wire Ctrl+Z to pop and restore the previous order. | Fixed ✅ |
| BUG-026 | TC-217 | P4 | Style Library legend bar is hard to read — font size and padding too tight. **Fix:** `.legend-item` font-size increased from 0.69rem to 0.73rem, gap 5px to 6px; `.styles-legend` outer gap increased from 12px to 16px and vertical padding increased from `0 0 2px` to `2px 0 4px`. | Fixed ✅ |
| BUG-025 | TC-204 | P3 | Style Library code view is missing the bottom status bar present in Config Manager — no dirty indicator (●), no line/column readout, no language/selection info. The Save button in the top toolbar does enable on edit, but the status bar context is absent entirely. **Fix:** Added `#styles-status-bar` div (class `status-bar`) below `#styles-code-wrap`. Shows Ln/Col wired to `_stylesEditorInstance.onDidChangeCursorPosition`; `● unsaved` wired to `_setStylesDirty`. Shown/hidden by `_switchStylesView`. Config status bar scoped with `config-status-bar` class so tab switching doesn't hide the styles bar. | Fixed ✅ |
| BUG-024 | TC-157 | P4 | "Clear Compile Cache" button is clickable even when cache is already empty (0 B). **Fix:** when the settings modal opens, `btn-clear-cache` is disabled if `cacheBytes === 0`; after a successful clear it stays disabled (cache is now 0). Button re-enables next time the modal opens if cache has grown. | Fixed ✅ |
| BUG-023 | TC-113 | P3 | Monaco loses character-input focus after sidecar collapse/re-expand — arrows and backspace work (Monaco has partial focus) but letter/number keys don't register until user clicks the editor again. **Fix:** call `editor.focus()` after `editor.layout()` in the sidecar toggle handler. | Won't Fix — user is deliberately interacting with a UI control; re-clicking the editor to resume typing is expected and natural. Not worth the risk of auto-focus side effects. |
| BUG-022 | TC-110 | P4 | Color picker is wider than standard when a style update warning message is present. **Fix:** added `max-width: 220px` to `.preset-color-popup` — the popup is now bounded to its intended width and the disclaimer text wraps within it. | Fixed ✅ |

| BUG-040 | TC-363, TC-392 | P3 | Two issues: (1) manifest cache stuck — GitHub CDN cached raw file beyond our 1-min in-app TTL, so fresh fetches still returned stale manifest. Fixed: cache-busting timestamp param + no-cache headers on every manifest request. (2) No backup option on major update. Fixed: "Copy & Update" button (primary) shown alongside "Update" for major version updates; silently duplicates the version as "name (backup)" then applies update to original. Apply logic extracted to shared `_vpDoApply()`. | Fixed ✅ |
| BUG-039 | TC-138 | P3 | After UAC prompt declined (user clicks No), install handler resets button to "Download DFU Tool" — but the file was already downloaded and is still on disk, so the correct state is "Install DFU Tool". **Fix:** In `main.js` `dfu:installSetup`, only delete the exe and null `_dfuSetupExePath` on success; on failure the file is retained. In `buildPanel.js`, on failure keep `dataset.phase = 'install'` and set button to "▶ Install DFU Tool" so the user can retry without re-downloading. | Fixed ✅ |
| BUG-038 | TC-131 | P2 | Compile button is enabled when no OS version is installed — clicking it correctly shows a friendly error and does nothing, but the button should be disabled entirely in this state. **Fix:** in `updateCompileButton()`, add a guard that disables the button when no OS version is selected (no `selectedVersion` or equivalent). | Fixed ✅ |
| BUG-037 | TC-128 | P3 | Closing a config file does not clear the build output panel or collapse it if open — build output from the previous file lingers. Switching to a different config or opening a new one correctly clears it, so the clear is wired to open/switch events but not to the close action. **Fix:** call the build output clear (and collapse if open) in the close file handler, consistent with the open/switch behavior. | Fixed ✅ |
| BUG-036 | TC-131a | P4 | dfu-util flash output splits at arbitrary byte positions — all output lines (not just Download) fragmented mid-word at pipe chunk boundaries. Root cause: dfu-util on Windows writes to stdout; the stdout handler called `onLog` on every chunk without buffering. **Fix:** `runDfuFlash` in `toolchain.js` now applies a terminal emulator (`makeTermEmu`) to both stdout and stderr. `\r` flushes the current assembled line and resets to column 0; `\n` flushes and advances. Result: each Download progress step emits one clean complete line in real time; all other output lines are assembled across chunk boundaries before display. | Fixed ✅ |

| BUG-041 | TC-385 | P3 | Missing favorite cards don't appear while already on the favorites page — if a file is deleted from disk while the favorites grid is open, the card still shows as present until the user leaves and re-enters the page. Constant polling would be overkill. **Fix:** when a favorite card is clicked and `readFile` returns null (file gone), `openFavorite()` calls `refreshEmptyStateFavs()` — card flips to missing state in place. | Fixed ✅ |
| BUG-042 | TC-388 | P4 | Missing favorite card shuffles to the end of the grid after multiple drag reorders rather than starting there. Root cause: the reorder handler always writes missing items to the end of the stored order, so they migrate there after the first reorder. Display order and storage order are inconsistent until first reorder. **Fix:** `refreshEmptyStateFavs()` now renders `[...present, ...missing]` so missing cards always appear at the end from the start. | Fixed ✅ |
| BUG-043 | — | P2 | Toolchain not re-initialized when a version is installed while already selected in config metadata. Sequence: config has version X in metadata → version X is not yet installed → user installs X in OS Versions tab → `refreshVersionDropdown()` runs but dropdown value doesn't change → no `change` event fires → `initToolchain()` never called → compile button enables but toolchain paths are unset → compile fails or errors silently. **Fix:** `_refreshVersionDropdown()` now calls `selectVersion` + `initToolchain()` after repopulating whenever a real version is selected, regardless of whether the value changed. | Fixed ✅ |

**Severity:** P1 Blocker · P2 Major · P3 Minor · P4 Cosmetic

---

## 31. P2 BUG FIX VERIFICATION  *(post-fix mini plan — 2026-04-29)*

---

**BUG-010** · P2 · TC-021
If a user opens a .txt config file and then saves, the file is saved as .txt first, then re-saved as .h — the active file switches to the .h going forward. A right-justified notice appears in the meta bar header row confirming the conversion. The original .txt is preserved on disk, removed from recents, and replaced by the .h in recents.

- [x] TC-377: Open a `.txt` config file, make any edit, save → `.txt` written first, `.h` created alongside it, active file path switches to `.h`, conversion notice appears right-justified in the meta bar header row ✅
- [x] TC-378: With `.h` now active, make a small edit and save again → notice clears, file saves normally as `.h`, no second conversion ✅
- [x] TC-379: Open a `.h` file and save → no notice, no extra file created, normal save behavior unchanged *(regression)* ✅
- [x] TC-380: After TC-377, check disk → both `.txt` and `.h` exist; `.txt` absent from recents, `.h` present ✅

---

**BUG-012** · P2 · TC-048, TC-271, TC-291, TC-303
OS Version dropdown in Config Manager does not stay in sync when versions change in the OS Versions panel — affects rename, import, download, and delete. Dropdown shows stale data until app restart.

- [x] TC-381: Rename a version in OS Versions tab → Config Manager dropdown updates immediately with the new name, no restart required ✅
- [x] TC-382: Rename the version that is currently selected in Config Manager → dropdown stays on that version, now showing the new name ✅
- [x] TC-383: Delete a version in OS Versions tab → Config Manager dropdown removes it; if it was selected, falls back to next available ✅
- [x] TC-384: Apply JMT Add-ons for the first time (triggers auto-rename to `+JMT`) → Config Manager dropdown reflects the new name ✅

---

**BUG-013** · P2 · TC-039
Missing favorited files fail silently — clicking a favorite whose file no longer exists does nothing. Backend already returns `exists: false` — the data is there, just not used. Missing favorites should appear dimmed/red with a tooltip, click-to-open disabled, remove button still active.

- [x] TC-385: Add a file to favorites, delete the file from disk, trigger a refresh (open favorites or relaunch) → missing card appears in the grid with dashed red border, dimmed, tooltip shows "File not found: /full/path" ✅ *(caveat: if already on favorites page when file is deleted, cards don't update until page is re-entered — see BUG-041)*
- [x] TC-386: Click the body of a missing favorite card → nothing happens, no error ✅
- [x] TC-387: Click × on a missing favorite card → card removed cleanly ✅
- [x] TC-388: Drag-reorder two present favorites while a missing card is also in the grid → reorder works correctly, missing card is not draggable ✅ *(quirk: missing card shuffles to end after multiple reorders rather than starting there — see BUG-042)*

---

**BUG-020** · P2 · TC-192
Duplicate header added on save — when a blank style library is created and then saved, a second header block is inserted. Root cause: the creation path wrote a different header format than what the save path expected, so the save always treated the header as missing and prepended a new one.

- [x] TC-389: Create a blank Style Library, save immediately without adding any styles → inspect the file; exactly one JMT header block, no duplicate ✅
- [x] TC-390: Create a blank library, add one style, save → exactly one header block above the style ✅
- [x] TC-391: Open a Style Library created with the old header format (`// JMT Studio — Style Library` / `// Created:` lines), save it → old header replaced cleanly with new format, no duplicate ✅

---

**BUG-040** · P3 · TC-363
After applying a JMT Add-ons update, checking for updates again within 60 seconds returned a stale "major update available" result from the in-memory manifest cache. Cache was not invalidated after a successful apply, so the update state persisted until TTL expired.

- [x] TC-392a: Change GitHub manifest to a major version, check for updates → shows major update with both "Copy & Update" (primary) and "Update" buttons ✅
- [x] TC-392b: Click "Copy & Update" → backup version created in sidebar (name + " (backup)"), update applied to original, success shown ✅
- [x] TC-392c: Change GitHub manifest back to original version, check for updates again → eventually shows up to date ✅ *(expected delay: up to 60s in-app TTL + GitHub propagation time; acceptable for real-world usage — no user would flip the manifest and immediately recheck)*
- [x] TC-392d: Minor/patch update scenario → only "Update" button shown, no "Copy & Update" ✅

---

**Regression — doSave() restructure**
`doSave()` was refactored to support the .txt branch. The non-.txt path should be unchanged.

- [x] TC-393: Open a `.h` config, make an edit, save → dirty indicator (●) clears, changed-field indicators reset, no conversion notice ✅ *(regression: doSave restructure)*

---

**Regression — favorites drag reorder**
`refreshEmptyStateFavs()` loop was restructured from iterating `present` to iterating `items`. Drop handler still uses `present` for index lookups — verify reorder still works when no missing favorites exist.

- [x] TC-394: Drag-reorder two favorites (no missing favorites in the grid) → correct new order persists after drop ✅ *(regression: refreshEmptyStateFavs loop change)*

---

## 32. P3 Bug Fix Verification

**BUG-004** · P3 · TC-223
Paste & Parse in Add Style modal accepted garbage input silently — no feedback if no valid style was found. Fixed: `_runPasteAndParse` now checks `parsed.expr` after parse and shows a red warning in `add-style-msg` if empty.

Post-test update: behavior evolved during QA. Original fix blocked paste on failure (no content in editor). Updated to "allow but inform" pattern: bad content now loads into the editor so the user can fix it manually, error message explains what's wrong, Clear button added to reset the form. Confirm button remains blocked until code is valid. TC-395 description updated to reflect new behavior.

- [x] TC-395: Paste non-style text (e.g. plain sentence) into clipboard, click Paste & Parse → raw content loads into editor, red warning appears ("No style found — edit to fix or Clear to start over"); Confirm button disabled ✅
- [x] TC-396: Paste valid style → parses correctly, no warning shown; fields populate as before ✅

---

**BUG-008** · P3 · TC-247
Scroll and orange highlight animation fired in parallel — highlight was missed during scroll motion. Fixed: highlight is deferred 400ms via `setTimeout` so scroll completes first.

Post-test update: smooth scroll caused a stutter (forced reflow mid-animation). Switched to `behavior: 'instant'` and removed the 400ms delay — scroll jumps immediately, highlight fires right after. Cleaner result, no stutter.

- [x] TC-397: In Visual view with a helper, click a style name in the "Used by" list → card jumps into view instantly, orange highlight plays immediately after ✅

---

**BUG-018** · P3 · TC-199, TC-237
Style Library code view toolbar and style detail editor were missing Undo/Redo buttons. Fixed: ↺/↻ buttons added to Style Library toolbar (icon-only, left of Save, code view only) and to style detail modal button row; wired to respective Monaco instances.

- [x] TC-398: Switch to code view → ↺ and ↻ buttons appear left of Save; switch to visual view → buttons hidden ✅
- [x] TC-399: In code view, make an edit, click ↺ → edit undone; click ↻ → edit restored ✅
- [x] TC-400: In style detail modal, make a code edit, click ↺ → edit undone; click ↻ → edit restored ✅

---

**BUG-027** · P3 · TC-218
Drag-and-drop card reorder was not undoable. Fixed: content snapshot pushed to undo stack on each drop; Ctrl+Z pops and restores; Ctrl+Y redoes; new drag clears redo stack.

Post-test update: helper editor panel was not closed before reorder, leaving it showing stale content and breaking undo/redo sync. Fixed: `_closeHelperEditor()` called at the top of the drop handler and both Ctrl+Z/Y branches. Also fixed: pencil rename mode did not exit on focus loss — blur handler added to name input to cancel rename and revert to original name when focus leaves.

- [x] TC-401: Drag a card to a new position → Ctrl+Z restores original order ✅
- [x] TC-402: Drag twice → Ctrl+Z twice steps back through both moves ✅
- [x] TC-403: Ctrl+Z after drag, then Ctrl+Y → order returns to post-drag state ✅
- [x] TC-404: Drag again after Ctrl+Z → redo stack clears; Ctrl+Y does nothing ✅

---

**BUG-029** · P3 · TC-234
URL link hit target in style card detail was too wide (full row width). Fixed: CSS changed from `flex:1` to `flex:none; max-width:100%` so click target is bounded by visible text.

Post-test update: original fix targeted the wrong element (detail pane `detail-url-display`). Actual issue was `style-card-source-link` in the card thumbnails — a full-width block `<div>` with `title` and `opacity:0.8` hover on the outer container. Fixed by splitting into outer `<div>` for layout and inner `<button>` for the interactive text only. Also updated detail pane to a `<button>` element for consistency.

- [x] TC-405: Open a style card detail with a URL; click empty space beside the link text → no navigation; click the link text itself → opens in browser ✅

---

**BUG-030** · P3 · TC-239
Error banner already implemented (`detail-error-banner` + `_updateDetailErrorMarkers`). Verified as already working — fires on open and on every edit.

- [x] TC-406: Open a style with a known bracket error → red error banner appears with context snippet and heuristic hint (e.g. `✕ Unmatched < near "…TransitionEffect<BlasterL…" — closing > missing for TransitionEffect? — fix before saving`); Monaco gutter marker also present ✅
  > _Update:_ Banner previously showed only basic "on line N" message with no context. Enhanced `_updateDetailErrorMarkers` to match Add Style modal quality — same context snippet (~44 chars around error offset) and heuristic hints.

---

**BUG-032** · P3 · TC-275
Import Version modal validated ProffieOS version field on every keystroke. Fixed: validation moved to `blur` event; `focus` clears any existing error.

- [x] TC-407: In Import Version modal, type "8" in version field → no red border while typing; click/tab away → red border and error message appear ✅
- [x] TC-408: Click back into the field → red border clears; finish typing valid version (e.g. 8.10) and tab away → no error ✅

---

**BUG-033** · P3 · TC-288
Invalid folder path remained displayed after failed validation in Import Version modal. Fixed: path field is cleared to placeholder when `validateVersionSource` returns an error.

- [x] TC-409: Browse to a non-ProffieOS folder → folder path field clears to placeholder, error message shown below ✅

---

**BUG-034** · P3 · TC-249
Helper name field stayed in edit mode after clicking Save. Fixed: `_exitHelperPencilMode()` called in both edit-helper save paths.

- [x] TC-410: Open a helper, click pencil to rename, type new name, click Save without clicking the checkmark → name commits and input reverts to display mode with pencil icon ✅
  > _Root cause:_ `blur` fires before `click` (mousedown triggers blur). Blur handler reverted `nameInput.value` to the original name before the save handler could read the renamed value. Fix: added `btn-helper-save` to the blur guard alongside `btn-helper-pencil-confirm`.

---

**BUG-037** · P3 · TC-128
Already resolved per Ryan — closing a config clears build output panel.

- [x] TC-411: Close a config file after a compile → build output panel clears and collapses if open ✅

---

**Regression — Paste & Parse style name with `+`**
Parser regexes used `\w+` which stops at `+`. Styles with `+` in the name (e.g. `CandyCaneInertiaSwingWhite+1Color`) would fail the `using` match and fall through to the StylePtr fallback, which grabbed the name from a trailing footer comment as the expression. Fixed: both the `using` regex and block comment name extractor now allow `+` in names.

- [x] TC-412: Paste a full Fett263 style block with `+1Color` (or similar) in the name → name and expression parse correctly; code view shows full `Layers<...>` expression ✅

---

## 33. Remaining P3 Bug Fix Verification

**BUG-003** · P3 · TC-110
Color picker did not trap interaction — clicks outside the picker on buttons/controls activated those controls before dismissing the picker. Fixed: transparent full-screen overlay (z-index 9998) placed behind the popup intercepts all outside clicks and closes the picker without letting them reach underlying controls. Close (✕) button added to top-right corner as a visible dismiss affordance. `document` click listener removed in favor of the overlay.

- [x] TC-413: Open a color picker; click a button outside the picker (e.g. Save, Compile) → picker closes and the button does NOT fire ✅
- [x] TC-414: Open a color picker; click the ✕ button → picker closes cleanly ✅
- [x] TC-415: Open a color picker; click anywhere on the empty background → picker closes ✅
- [x] TC-416: Open a color picker; interact normally (pick a color, change RGB values) → picker functions correctly; close via ✕ → picker closes ✅

---

**BUG-015** · P3 · TC-060
Favorites empty-state grid was fixed 3-column, left-clustered, wasting space. Fixed: removed hardcoded width cap; flexbox with `justify-content: center` fills available width dynamically. Column count calculated in JS: `max(ceil(sqrt(N)), ceil(N/3))` capped by window width — targets 3 rows, expands columns to fill before adding a 4th row, only scrolls beyond max width. Cards always centered including orphan last rows.


- [x] TC-417: 1–6 favorites → compact grid, no wasted horizontal space, cards centered ✅
- [x] TC-418: 9–12 favorites → 3×3 or 4×3, fills width proportionally, no left-clustering ✅
- [x] TC-419: Many favorites (20+) → expands to max columns before adding rows; scrollbar appears only when rows exceed container height ✅
- [x] TC-420: Orphan last row (e.g. 10 cards = 4+4+2) → last row centered ✅

---

**BUG-021** · P3 · TC-083
Diff editor had no way to accept the baseline value for a modified line. Fixed: `glyphMargin: true` added to diff editor options — surfaces Monaco's built-in per-change revert widget. Hover the → gutter arrow on any changed line to get "Click to revert change". No custom code.

- [x] TC-421: Open Show Changes with a modified line; hover the → gutter arrow → "Click to revert change" widget appears ✅
- [x] TC-422: Click "Click to revert change" → current side updates to match baseline value; dirty flag remains set ✅
- [x] TC-423: Revert works on a pure deletion (line exists in baseline but not in current) ✅

---

**BUG-025** · P3 · TC-204
Style Library code view was missing the bottom status bar. Fixed: added `#styles-status-bar` below `#styles-code-wrap`, wired to `_stylesEditorInstance` cursor position and `_setStylesDirty`. Config status bar scoped to `.config-status-bar` class so tab switching no longer interferes.

- [x] TC-424: Switch to Style Library code view → status bar visible at bottom showing Ln/Col ✅
- [x] TC-425: Make an edit in code view → status bar shows "● unsaved" ✅
- [x] TC-426: Switch to visual view → status bar hides; switch back to code view → status bar reappears ✅
- [x] TC-427: *(secondary)* Switch from Config Manager to Style Library tab → Config Manager status bar hides; return to Config Manager → status bar reappears ✅

---

**BUG-028** · P3 · TC-208
Effect detection missed Blast, Clash, Drag, Melt, PowerSave, Volume when expressed as `EFFECT_*` or `LOCKUP_*` constants inside generic wrapper templates. Fixed: added `EFFECT_BLAST`, `EFFECT_CLASH`, `LOCKUP_DRAG`, `LOCKUP_MELT`, `EFFECT_POWERSAVE`, `EFFECT_VOLUME_LEVEL` to `effect-keywords.js`.

- [x] TC-428: Style using `TransitionEffectL<..., EFFECT_BLAST>` shows "Blast" effect chip on card ✅
- [x] TC-429: Style using `TransitionEffectL<..., EFFECT_CLASH>` shows "Clash" effect chip on card ✅
- [x] TC-430: Style using `LockupTrL<..., LOCKUP_DRAG>` shows "Drag" effect chip on card ✅
- [x] TC-431: Style using `LockupTrL<..., LOCKUP_MELT>` shows "Melt" effect chip on card ✅
- [x] TC-432: Style using `EffectSequence<EFFECT_POWERSAVE, ...>` shows "PowerSave" effect chip on card ✅
- [x] TC-433: Style using `TransitionEffectL<..., EFFECT_VOLUME_LEVEL>` shows "Volume" effect chip on card ✅
- [x] TC-433a: Style using `SaberBase::LOCKUP_LIGHTNING_BLOCK` shows "Lightning Block" chip ✅ *(gap found during testing — `LOCKUP_LIGHTNING_BLOCK` pattern added alongside existing `LockupType::LIGHTNING_BLOCK`)*

---

**BUG-031** · P3 · TC-317
OS Version notes had no Ctrl+Enter shortcut, no guard on version switch, no guard on tab switch, no guard on app close. Fixed: Ctrl+Enter keydown on textarea; `_vpNotesDirty` flag tracked at module level; card click, `switchTab`, and app close all check it before proceeding.

- [x] TC-434: Type notes in OS Versions, press Ctrl+Enter → notes save (same as clicking Save Notes) ✅
- [x] TC-435: Type notes, click a different version card → confirm dialog appears; Cancel keeps current version and notes intact ✅
- [x] TC-436: Type notes, click a different version card → confirm OK → notes discarded, version switches ✅
- [x] TC-437: Type notes, switch to Config Manager tab → confirm dialog appears; Cancel stays on Versions tab ✅
- [x] TC-438: Close app with unsaved OS version notes → confirm dialog appears; Cancel aborts close ✅
- [x] TC-439: *(secondary)* Switch Config Manager → Style Library (no Versions involved) → no dialog, works normally ✅
- [x] TC-440: *(secondary)* Switch away from Versions tab with NO unsaved notes → switches cleanly, no dialog ✅
- [x] TC-441: *(secondary)* Close app with no unsaved notes anywhere → closes cleanly, no spurious dialogs ✅

---

**BUG-039** · P3 · TC-138 · Fixed ✅
Closing out this bug required more rework than the original report suggested. Full list of adjustments made:

- **Exe retained on UAC cancel**: installer exe is no longer deleted on a failed/cancelled install. Button resets to "▶ Install DFU Tool" so user can retry without re-downloading. Exe deleted only on successful install or modal close.
- **Cleanup on modal close**: `cleanupDfuSetup` IPC added; bm-close handler calls it so temp file is never leaked if the user walks away.
- **Separate "Install Anyway" button**: amber-styled `bm-install-anyway` button added for hash mismatch bypass — avoids the risk of `bm-dfu-setup` getting stuck in a yellow state. Routes through the same install phase internally.
- **SHA256 verification**: downloaded exe is verified against the known hash from pod.hubbe.net before install is offered. On match: "✓ SHA256 verified." shown. On mismatch: both hashes displayed, clickable link to official setup page, Install Anyway bypass available.
- **OS-specific driver fix screen**: Windows shows full download/install flow; Linux shows udev rules commands (`sudo cp` + `udevadm`) with Try Again; Mac shows simple reconnect message (no setup needed per official docs).
- **driverStillLoading message split by justInstalled**: "replug" instruction only shown after an actual install attempt. Non-justInstalled case explains driver may be missing/outdated/installed by another tool.
- **"Try Again" gated correctly**: only shown after a driver install attempt (justInstalled=true) on Windows, and always on Linux. Hidden when no action has been taken that would make a retry useful.
- **DFU compile regression fixed**: `exitDfuMode()` was being called at the start of `doCompile`, causing `isDfuMode` to be false by the time compile finished — post-compile handler took the wrong branch and showed "Connect your Proffieboard" instead of proceeding to DFU flash. Removed that call; DFU mode is now preserved through compile.
- **Modal no longer auto-closes after DFU flash**: `watchForSerialAfterDfu` previously hid the modal automatically when the board reappeared. Modal now stays open; user dismisses manually, consistent with normal flash behavior.

- [x] TC-442: Download DFU Tool → Install DFU Tool → decline UAC → button shows "▶ Install DFU Tool"; log says "Installation was cancelled" ✅
- [x] TC-443: After UAC decline, click "▶ Install DFU Tool" again → UAC prompt reappears (no re-download needed) ✅
- [x] TC-444: *(secondary)* Download DFU Tool → Install DFU Tool → accept UAC → install succeeds → app proceeds to DFU flash normally ✅
- [x] TC-445: SHA256 verified message shown on successful download ✅
- [x] TC-446: Forced hash mismatch → both hashes shown, clickable link, Install Anyway available ✅
- [x] TC-447: DFU compile → compile completes → app correctly proceeds to DFU flash (not "Connect your Proffieboard") ✅
- [x] TC-448: DFU flash completes → modal stays open, board returns on serial port, DFU mode exits automatically ✅

---

**BUG-043** · P2 · (discovered during BUG-031 retesting)
Two-part fix: (1) Toolchain not re-initialized when a version is installed while it was already selected — `_refreshVersionDropdown` now calls `selectVersion` + `initToolchain` after repopulating whenever a real version is selected. (2) Toolchain status not reset when a version is deleted and no versions remain — `switchTab` now checks toolchain state when activating Config Manager; if no real version is selected, calls `resetToolchainStatus()` which shows "No ProffieOS versions found. Please import or download a version first." and hides port/compile/flash rows.

- [x] TC-448a: Open a config with a saved OS version that is not yet installed → install that version in OS Versions tab → return to Config Manager → Compile button works (toolchain initialized, no "version not found" error) ✅
- [x] TC-448b: *(secondary)* Install a version while a different version is already selected → selected version unchanged, toolchain still points to the previously selected version ✅
- [x] TC-448c: Delete the only installed OS version → switch to Config Manager → shows "No ProffieOS versions found. Please import or download a version first." error state, port/compile/flash rows hidden, Compile button disabled ✅

---

## 34. P4 Bug Fix Verification

**BUG-002** · P4 · TC-091
Preset sidecar row alignment fixed: name now fills available space, font column always at a consistent position.

- [x] TC-449: Open a config with presets of varying name lengths → font column appears at the same horizontal position on all rows, regardless of name length ✅
- [x] TC-450: Very long preset name → name truncates with ellipsis, font column still at consistent position ✅

---

**BUG-005** · P4 · TC-161
Settings slider track now visible in light mode.

- [x] TC-451: Switch to light mode → open Settings → Recent Files slider shows a clear visible track (gray rail), not a floating dot ✅

---

**BUG-007** · P4 · TC-356
JMT button readable in dark mode; unchanged in light mode.

- [x] TC-452: Dark mode → OS Versions → select a version → "Add JMT Features" or "Check for Updates" button text is clearly readable (light blue, not dark) ✅
- [x] TC-453: Light mode → same button → unchanged appearance (JMT blue, same as before) ✅

---

**BUG-009** · P4 · TC-244
Helpers panel background brightened in dark mode.

- [x] TC-454: Dark mode → Style Library → Visual view → Helpers panel background is noticeably lighter than the deep-black main background ✅

---

**BUG-011** · P4 · TC-046
OS Version dropdown truncates long names with ellipsis and shows full name on hover.

- [x] TC-455: Version with a long name selected → closed dropdown shows truncated text with ellipsis, no overflow ✅
- [x] TC-456: Hover over closed dropdown with long name → tooltip shows full version name ✅

---

**BUG-014** · P4 · TC-104
Slot tooltip wording softened.

- [x] TC-457: Open a config with an unlinked library style slot → hover the red slot tile → tooltip says "If defined externally it may still compile correctly" (not alarmist "it will be undefined") ✅

---

**BUG-016** · P4 · TC-057
Favorites remove button larger hit target.

- [x] TC-458: Open favorites dropdown → hover a recent file → × button is easier to click (larger target area, no need to be pixel-precise) ✅

---

**BUG-022** · P4 · TC-110
Color picker does not widen with disclaimer message.

- [x] TC-459: Open a slot color picker on a complex style (disclaimer present) → picker width is same as on a simple style; disclaimer text wraps within the picker bounds ✅

---

**BUG-024** · P4 · TC-157
Clear Cache button disabled when cache is empty.

- [x] TC-460: Open Settings with empty cache (or after clearing) → "Clear" button is disabled/grayed ✅
- [x] TC-461: After compiling (cache now has data), open Settings → "Clear" button is enabled ✅

---

**BUG-026** · P4 · TC-217
Legend bar more readable.

- [x] TC-462: Style Library visual view with mixed card types → legend bar at bottom shows larger text with adequate spacing between items ✅

---

**BUG-036** · P4 · TC-131a
DFU flash log shows clean Download line.

- [x] TC-463: DFU flash a board → build log shows one clean `Download [=========================] 100%       198896 bytes` line (not many mid-progress fragments) ✅

---

## Sign-off

- [x] All P1 bugs resolved ✅ (1 bug: BUG-001 Fixed)
- [x] All P2 bugs resolved ✅ (4 bugs: BUG-010, BUG-012, BUG-019, BUG-038 all Fixed)
- [x] P3/P4 bugs reviewed and triaged ✅ (BUG-017 P4 deferred — cosmetic minimap button position, functional; BUG-006 P4 Won't Fix; BUG-023 P3 Won't Fix; all others Fixed)
- [x] Both dark and light modes verified ✅
- [x] Tested on Windows ✅
- [x] Ready to ship ✅
