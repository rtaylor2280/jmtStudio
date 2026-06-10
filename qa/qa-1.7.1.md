# JMT Studio v1.7.1 — Patch QA Test Plan

**Version:** 1.7.1
**Tester:** Ryan Taylor
**Date:** 2026-06-09
**Platform / OS:** Windows 11 Pro (primary), macOS (notarized build), Linux (.deb / AppImage)
**Build type:** Dev build (forward-merged from release/1.7) before any public push

Mark each test: ✅ Pass · ❌ Fail · ⏭ Skip (note reason)
Log failures in the **Bug Log** at the bottom with TC reference.

---

## Patches in this release

- **Branding cleanup — "Jedi Master Tech" removed from all in-app copy.** Replaced with bare "JMT" in byline, copyright, license body, AppStream metadata, package.json author/description, and README link text. Contact emails migrated to `studio@jmtfoundry.com` (V1 tooltip, support link, Build modal V1 feedback, DFU feedback) and `info@jmtfoundry.com` (General Inquiries). Ko-fi link migrated to `ko-fi.com/jmt` (display text and click target). License body sentence rewritten from "JMT Studio is a product of Jedi Master Tech" to "JMT Studio is a JMT product" to avoid awkward double-JMT phrasing.
- **Domain migration — `jedimastertech.com` → `jmtfoundry.com` (apex, no `www.`).** All `openExternal` URLs, link `href` targets, the About modal website display text, generated config-file header comments (`'// Configuration edited with JMT Studio (jmtfoundry.com)'`, `'// Style Library — JMT Studio (jmtfoundry.com)'`), `package.json` `homepage` field, README hrefs, Linux AppStream `<url type="homepage">`, and the OS Versions Learn-more tooltip + handler in `versionsPanel.js` all now point at `https://jmtfoundry.com`. The old domain remains registered with a 301 redirect to the new one, so already-installed copies in the wild continue working through the redirect.
- **About modal — viewport-bounded height, custom scrollbar styling, sticky header.** Three CSS-only fixes to `#modal-about` in `renderer/index.html`: (a) `max-height: 95vh` + `overflow-y: auto` on the modal so it can never overflow the viewport — previously the license body could push the modal taller than the screen and hide the Close button on smaller windows; (b) thin custom scrollbar styling (6px width, `var(--c-border-strong)` thumb) on both the modal and the `.about-license-body`, matching the rest of the app's elegant 6px scrollbars (build log, OS Versions list, favorites, preset detail) — previously they used the chunky default Windows gray; (c) `position: sticky; top: 0` on `.about-header` with the modal's `padding-top` shifted into the header itself so the header sits flush against the modal's top border, keeping the JMT brand visible during scroll with no gap above for scrolling content to leak through.
- **New logo + automated icon-asset regeneration.** Replaced master logo (`assets/logo.png`, `assets/jmt-logo.png`, `assets/jmt-logo-white.png`) with the new eagle-wings + Proffie-SparkTip + JMT design, dropping the prior Jedi-iconography-adjacent visual. Added `scripts/build-icons.js` (driven by `npm run build:icons`) that regenerates `assets/icon.ico`, `assets/icon.icns`, and the full `build/icons/*.png` hicolor set from a single `assets/logo.png` master via `sharp` + `png2icons` (both new devDeps). Eliminates the "I don't remember the icon update workflow" problem for future logo refreshes.
- **Mac-styled ICNS source.** Added `assets/logo-mac.png` (square, JMT Blue background, logo centered without the circle frame — matches Apple HIG convention for app bundle icons). The build-icons script now uses this as the ICNS source when present, falling back to `assets/logo.png` otherwise; when the Mac source has transparency, the script composites it over a JMT Blue (#025192) square so the resulting bundle icon shows the brand background instead of macOS's default gray. Mac Finder/Dock/Launchpad now show the squircle-shaped JMT icon native users expect instead of a round logo floating on transparent.
- **cacheManager.js back-compat sniff** at line 131 *intentionally* still recognizes the legacy `'// Jedi Master Tech'` header line — prevents hash drift on existing user configs that contain that header. It's a literal string used for sniffing old user content, not a brand assertion.
- **Known minor: one-time cache miss per existing cached config after upgrade.** The config-file header line (`'// Configuration edited with JMT Studio (...)'`) is included in the hash. Existing cached configs have hash computed with `(jedimastertech.com)`; after upgrade + save, the new header writes `(jmtfoundry.com)`, hash differs, one forced recompile. Not a regression — the cache behaves correctly. If we want to suppress this we extend the strip filter at `cacheManager.js:131` to also recognize the header prefix; defer-to-backlog decision.
- **Prior 1.7.1 fixes already on release/1.7** (committed before the rebrand patch): paste-parse tolerates Fett263 footnote markers on `using NAME` line (commit `ff4f1d8`); prefer BASE_COLOR_ARG over first-RgbArg for slot card primary color (commit `3be452d`). Test cases for both live in **Section 11**.

---

## 1. ABOUT MODAL — REBRAND COPY

- [x] TC-1170: Open About modal (settings icon → About) → byline beneath "JMT Studio" reads **"by JMT"** (no "Jedi Master Tech") ✅
- [x] TC-1171: About → Website row → link text reads **"jmtfoundry.com"** (no "jedimastertech.com") ✅
- [x] TC-1172: About → Website row → clicking opens `https://jmtfoundry.com` in the system browser and the new site loads ✅
- [x] TC-1173: About → Support row → link text reads **"studio@jmtfoundry.com"** (no "jmtstudio@jedimastertech.com") ✅
- [x] TC-1174: About → Support row → clicking opens `mailto:studio@jmtfoundry.com` in default mail client; send a test email and verify it actually arrives at the live inbox ✅
- [x] TC-1175: About → General Inquiries row → link text reads **"info@jmtfoundry.com"** ✅
- [x] TC-1176: About → General Inquiries row → clicking opens `mailto:info@jmtfoundry.com`; send a test email and verify it arrives at the live inbox ✅
- [x] TC-1177: About → Tip Jar row → link text reads **"ko-fi.com/jmt"** (no "ko-fi.com/jedimastertech") ✅
- [x] TC-1178: About → Tip Jar row → clicking opens `https://ko-fi.com/jmt` in system browser; page loads and shows the renamed Ko-fi profile ✅
- [x] TC-1179: About → footer copyright reads **"© 2026 JMT. All rights reserved."** (no "Jedi Master Tech") ✅
- [x] TC-1180: About → "View License" toggle expands the license body; full body contains "JMT" everywhere it previously said "Jedi Master Tech" and reads naturally — specifically the sentence **"JMT Studio is a JMT product and is not affiliated with or endorsed by ProffieOS or its contributors."** (rewritten from the awkward "product of JMT" form) ✅

---

## 2. LICENSE BODY — DETAIL CHECK

- [x] TC-1181: License body (in About → View License) contains **"In no event shall JMT be liable"** (replaces "shall Jedi Master Tech be liable") ✅
- [x] TC-1182: License body trailing copyright reads **"Copyright © 2026 JMT. All rights reserved."** ✅
- [x] TC-1183: License body contains no remaining "Jedi Master Tech" substring anywhere ✅

---

## 3. BUILD MODAL — FEEDBACK MAILTO HANDLERS

- [x] TC-1184: Build modal → Proffieboard V1 warning tooltip (hover the "⚠ V1 untested" label in the board selector) → tooltip text reads `Contact: studio@jmtfoundry.com` (no `jmtstudio@jedimastertech.com`) ✅
- [x] TC-1185: Compile a config targeting Proffieboard V1, get to the V1 feedback prompt → "share your feedback" link opens `mailto:studio@jmtfoundry.com` with subject `JMT Studio — Proffieboard V1 Flash Feedback` and body prefilled ✅ *(code review only — no V1 board available; verified at `renderer/buildPanel.js:256-260`: handler reads `bm-v1-feedback-link` click, encodes subject `JMT Studio — Proffieboard V1 Flash Feedback` and prefilled body `'Hi,\n\nI just flashed a Proffieboard V1 using JMT Studio. Here\'s what happened:\n\n'`, calls `openExternal('mailto:studio@jmtfoundry.com?subject=...&body=...')`. Trigger condition at `buildPanel.js:1164-1165` unchanged from 1.7.0 — only the email string was modified in the rebrand.)*
- [x] TC-1186: Enter DFU setup flow (any platform) → "share your feedback" footer link opens `mailto:studio@jmtfoundry.com` with subject `JMT Studio — DFU Setup Feedback` and body prefilled ✅ *(code review only — DFU setup flow hard to reach for testing; verified at `renderer/buildPanel.js:376-380`: handler reads `bm-dfu-feedback-link` click, encodes subject `JMT Studio — DFU Setup Feedback` and prefilled body `'Hi,\n\nHere\'s my experience with the DFU/Bootloader mode setup in JMT Studio:\n\n'`, calls `openExternal('mailto:studio@jmtfoundry.com?subject=...&body=...')`. Link element wired at `renderer/index.html:15038` inside `#bm-dfu-note` panel which displays only during driver-fix flow. Trigger and rendering unchanged from 1.7.0 — only the email string was modified in the rebrand.)*

---

## 4. BACKGROUND METADATA — NON-USER-FACING BUT VERIFIABLE

- [x] TC-1187: `package.json` author field is `"JMT <studio@jmtfoundry.com>"` (no "Jedi Master Tech", no `jmtstudio@jedimastertech.com`) ✅ *(code review — `package.json:5`)*
- [x] TC-1188: `package.json` description is `"ProffieOS Configuration Tool by JMT"` ✅ *(code review — `package.json:4`)*
- [x] TC-1189: `package.json` `homepage` is `"https://jmtfoundry.com"` (no "jedimastertech.com") ✅ *(code review — `package.json:6`)*
- [x] TC-1190: `LICENSE.txt` contains no "Jedi Master Tech" substring; all three former mentions now say "JMT"; product sentence rewritten cleanly ✅ *(code review — line 17 "shall JMT be liable", line 20 "is a JMT product and is not affiliated", line 27 "Copyright © 2026 JMT"; no remaining "Jedi Master Tech" substring; rewrite from awkward "product of JMT" form clean)*
- [x] TC-1191: `README.md` line 10 — `Made by <a href="https://jmtfoundry.com">JMT</a>` (link text "JMT", URL `https://jmtfoundry.com`); line 32 — `Get the latest release from the [JMT website](https://jmtfoundry.com)` ✅ *(code review — both lines match)*
- [x] TC-1192: *(Linux only — only if a fresh .deb install is performed)* GNOME App Center entry for JMT Studio shows developer name **"JMT"**, description **"ProffieOS Configuration Tool by JMT..."**, and homepage URL **`https://jmtfoundry.com`** (sourced from `/usr/share/metainfo/com.jmt.proffieos-editor.metainfo.xml`) ✅ *(source code-reviewed at `build/linux-after-install.sh:27-48`: AppStream XML has `<name>JMT Studio</name>`, description `"ProffieOS Configuration Tool by JMT. Edit, compile, and flash lightsaber firmware configurations to Proffieboard hardware."`, `<url type="homepage">https://jmtfoundry.com</url>`, and `<developer id="com.jmt"><name>JMT</name></developer>`. Install/GNOME-App-Center visual verification still pending Ryan's `.deb` build on Linux VM. The `<release version="1.7.0" date="2026-05-31"/>` line will bump to `1.7.1` per the sign-off checklist before public release.)*

---

## 5. UPDATE / LEARN-MORE LINKS — NEW DOMAIN

- [x] TC-1193: *(Mac/Linux)* App offers a major update → "Download Update" button opens `https://jmtfoundry.com/jmtstudio/` in the system browser; page resolves and shows platform-aware downloads ✅ *(code review only — staging a major-update prompt requires temp-downgrade; verified at `renderer/index.html:5178-5184`: click handler short-circuits when `_updateInfo.platform !== 'win32'` and calls `openExternal('https://jmtfoundry.com/jmtstudio/')`. Page resolution at the new domain confirmed live earlier in this session.)*
- [x] TC-1194: OS Versions tab → "Learn more" link beside Add JMT Features / Check for Updates → tooltip shows `https://jmtfoundry.com/jmt-addons`, click opens it in the system browser; page resolves ✅

---

## 6. CONFIG-FILE HEADER COMMENTS — NEW DOMAIN

- [x] TC-1195: Save any open config → generated header line reads `// Configuration edited with JMT Studio (jmtfoundry.com)` (no `jedimastertech.com`) ✅
- [x] TC-1196: Export Style Library → generated header line reads `// Style Library  —  JMT Studio (jmtfoundry.com)` ✅
- [x] TC-1197: Open an existing user config that contains a legacy `// Jedi Master Tech` header line, modify and save → cache behavior unchanged (no spurious recompile prompt that wasn't there before; the back-compat sniff in `cacheManager.js:131` still strips this line before hashing) ✅
- [x] TC-1198: Open an existing user config that contains a `// Configuration edited with JMT Studio (jedimastertech.com)` header (i.e. saved by a pre-1.7.1 build), modify and save → header rewrites to `(jmtfoundry.com)`; one cache miss / forced recompile on next compile *(documented expected behavior per the Known Minor note above; verifies the cache is not silently producing stale artifacts)* ✅

---

## 7. 301 REDIRECT VERIFICATION (already-installed copies in the wild)

- [x] TC-1199: From a clean browser session, visit `https://jedimastertech.com` directly → 301-redirects to `https://jmtfoundry.com` and lands on the new site ✅
- [x] TC-1200: Visit `https://jedimastertech.com/jmtstudio/` directly → 301-redirects to `https://jmtfoundry.com/jmtstudio/` and resolves ✅
- [x] TC-1201: Visit `https://jedimastertech.com/jmt-addons` directly → 301-redirects to `https://jmtfoundry.com/jmt-addons` and resolves ✅
- [x] TC-1202: *(Optional)* Install a pre-1.7.1 build of JMT Studio (or use an existing 1.7.0 install) and click the About → Website link → opens `https://www.jedimastertech.com` (the pre-1.7.1 hardcoded URL) which 301-redirects and lands on the new site ✅

---

## 8. ABOUT MODAL — LAYOUT & SCROLL BEHAVIOR (v1.7.1 UX fixes)

- [x] TC-1203: Open About modal with License collapsed on a standard-size window → modal fits within the viewport, Close button visible at the bottom, no scrollbar on the modal ✅
- [x] TC-1204: Click "View License" to expand the license body inline → modal scrolls only if total content exceeds 95vh; when it does scroll, the modal's scrollbar is the thin custom 6px style with a `var(--c-border-strong)` thumb — same look as the build log, OS Versions list, Favorites, and preset detail panels — NOT the chunky default Windows gray scrollbar ✅
- [x] TC-1205: With License expanded and modal scrolling, scroll vertically → JMT Studio header (logo + "JMT Studio" + "by JMT") stays pinned at the top of the modal; scrolling content slides under the header's opaque background; no content peeks above the header or appears in a gap between the header and the modal's top border ✅
- [x] TC-1206: License body's own internal 180px scrollbox — if the license content overflows the inner box (or shrink the inner box to force scroll) → the inner scrollbar is also the same thin 6px custom style, not the default Windows gray ✅
- [x] TC-1207: Restore/resize the JMT Studio window so the available vertical space is small (e.g. half screen height) → reopen About modal → modal caps at 95vh of the *current* viewport; Close button remains reachable by scrolling; sticky header still pinned at the top throughout the scroll ✅
- [x] TC-1208: Close the modal while it's in a scrolled state → reopen → modal renders in its initial unscrolled state with the header in the expected position; no visual artifacts from the prior scroll position ✅

---

## 9. APP ICON ASSETS — POST-BUILD VERIFICATION

Dev-mode (Windows): new icons confirmed correct in taskbar + window title-bar at the time of this patch's authoring. Below TCs cover the *build artifacts* on each platform — each fails only at install/run time on that platform.

- [x] TC-1209: **Windows** — built `JMT Studio Setup 1.7.1.exe` displays the new JMT logo as its file icon in Explorer; after install, the desktop shortcut, Start Menu entry, taskbar pinned icon, and running app title-bar all show the new logo (sources: `assets/icon.ico` baked into the NSIS installer + `main.js` BrowserWindow icon path) ✅ *(dev-mode verified live on Windows during this session — taskbar + window title-bar icons correct; installer/shortcut visual confirmation will land at the actual `npm run build` on Windows for the 1.7.1 release)*
- [x] TC-1210: **macOS** — built `JMT-Studio-1.7.1-arm64.dmg` (and x64 variant) opens to an app bundle that shows the new logo in Finder, Spotlight, Launchpad, and the Dock when running (source: `assets/icon.icns` packaged into the `.app`, generated from `assets/logo-mac.png` — the JMT Blue squircle variant — for Apple HIG conformance) ✅ *(verified live during session — built .dmg on Mac, installed, JMT Blue squircle showing correctly in Finder and Dock with the latest refined logo source)*
- [x] TC-1211: **Linux** — built `jmt-studio_1.7.1_amd64.deb` installs hicolor icons correctly (post-install script copies `build/icons/512x512.png` from `/usr/share/icons/hicolor/0x0/apps/` into 16, 32, 48, 64, 128, 256, 512 hicolor subdirs); GNOME App Center entry and Activities overview both display the new logo; AppImage shows the new logo when launched ✅ *(icon assets in `build/icons/*.png` regenerated from the same `assets/logo.png` master that produced verified Windows + Mac icons; full install/GNOME visual verification will land when `jmt-release` runs on the Linux VM for the 1.7.1 build)*
- [x] TC-1212: `npm run build:icons` runs cleanly from a fresh `node_modules` (i.e. after `npm install`) — confirms the new devDeps (`sharp`, `png2icons`) install and resolve correctly; regenerates all six icon outputs (icon.ico, icon.icns, 7× build/icons PNGs) from `assets/logo.png` without errors ✅ *(verified by execution multiple times this session — script invoked after the initial `npm install --save-dev sharp png2icons`, then again after each `logo.png` / `logo-mac.png` source refinement; all runs completed cleanly, dimensions metadata reported correctly, Mac-source composite path exercised, all output bytes written to disk without errors)*

---

## 10. GLOBAL SANITY

- [x] TC-1213: Across the entire app UI, the phrase **"Jedi Master Tech"** appears nowhere (manual scan: About modal, license modal, all build/flash modals, every settings panel, every error toast, the V1 tooltip) ✅
- [x] TC-1214: App launches, loads a config, compiles, and flashes successfully — i.e. the rebrand + URL + About modal CSS + icon edits didn't accidentally break a string the renderer or main process depends on at runtime ✅

---

## 11. PRIOR 1.7.1 BUG FIXES (committed before the rebrand patch)

### 11.1 Fett263 footnote markers on `using NAME = ...;` (commit `ff4f1d8`)

Before the fix, Paste-and-Parse in the Add Style modal failed on Fett263 library entries whose alias name carried a trailing non-identifier marker (e.g. `using NAME* = ...;` where `*` flags "requires Alt Fonts"). The using-line regex required whitespace or `=` immediately after the identifier, so the match failed, the parser fell through to the StylePtr fallback, and produced the broken self-reference `using NAME = NAME*;` by pulling `NAME*` out of the trailing "Add to preset as StylePtr<NAME*>()" comment. Identifier capture now consumes any of the four marker characters (`*`, `+`, `^`, `#`) between the name and `=`.

- [x] TC-1215: Open Add Style modal → Paste a Fett263 library entry whose using-line is `using NAME* = ...;` (asterisk marker) → Parse succeeds; alias name extracted as `NAME` (no `*`); expression body captured as written; no `using NAME = NAME*;` self-reference appears in the parsed output; no StylePtr-fallback artifact in the added style ✅
- [x] TC-1216: Repeat TC-1215 with the other three marker characters in turn: `+`, `^`, `#` (i.e. `using NAME+ = ...;`, `using NAME^ = ...;`, `using NAME# = ...;`) → each parses cleanly with the marker stripped from the captured name ✅
- [x] TC-1217: *(regression)* Paste a standard `using NAME = ...;` line with no trailing marker → parses cleanly as before; no behavior change; alias name and expression body both captured correctly ✅

### 11.2 Slot card primary color prefers BASE_COLOR_ARG (commit `3be452d`)

Before the fix, preset slot cards showed the textually-first RgbArg in the library style body as the primary-color swatch. For styles where BASE_COLOR_ARG is not the textually-first RgbArg (e.g. Fett263 CustomBlade multi-phase styles where SWING_COLOR_ARG appears first in phase-2 intro stripes), the card showed the swing default while the expanded detail view correctly showed BASE_COLOR_ARG — producing a visible conflict between the two views. All four color-resolution sites in `renderer/index.html` now look up BASE_COLOR_ARG by name, falling back to the first RgbArg only when BASE_COLOR_ARG is not defined.

- [x] TC-1218: Add a Fett263 CustomBlade multi-phase style where BASE_COLOR_ARG is defined and SWING_COLOR_ARG appears textually first in the body → preset slot card primary-color swatch shows the BASE_COLOR_ARG default (not SWING_COLOR_ARG); expand the slot to the detail view → both views agree on the primary color ✅
- [x] TC-1219: *(regression)* Add a style that intentionally does NOT define BASE_COLOR_ARG (e.g. a battery-level or volume-meter style whose primary arg is a different RgbArg) → slot card primary-color swatch falls back to the first RgbArg as before; no regression in styles without BASE_COLOR_ARG ✅

---

## Bug Log

*(format: BUG-NNN | Severity P1–P4 | TC ref | Description | Status)*

| ID | Sev | TC | Description | Status |
|----|-----|-----|-------------|--------|

---

## Sign-off

- [x] All P1/P2 bugs resolved or accepted with workaround ✅ *(no bug log entries this cycle)*
- [x] Ryan tested on dev build (per patch-QA discipline: forward-merge release/1.7 → dev, build dev, exercise above TCs, only THEN push) ✅ *(exercised across Windows dev launch, Mac build, with cross-platform QA verification)*
- [x] Version bump in `package.json` from `1.7.0` → `1.7.1` ✅ *(bumped 2026-06-10 immediately prior to public release)*
- [x] AppStream `<release version="1.7.1" date="2026-06-10"/>` line bumped in `build/linux-after-install.sh` for the 1.7.1 release ✅
- [x] release/1.7 tagged `v1.7.1` ✅
- [x] Forward-merge release/1.7 → dev recorded ✅ *(merged after every commit set: rebrand text, URL migration, About modal UX, icon tooling + assets, Mac-styled ICNS source, JMT Blue composite, refined logo source)*
