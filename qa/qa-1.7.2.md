# JMT Studio v1.7.2 — Emergency Patch QA Test Plan

**Version:** 1.7.2
**Tester:** Ryan Taylor
**Date:** 2026-08-04 / 2026-08-05
**Platform / OS:** Windows 11 Pro, macOS 26.5.1 (arm64), Ubuntu 26.04 LTS — all three verified in both the healthy and broken states
**Build type:** Signed release build, installed over 1.7.1 on a deliberately broken machine

Mark each test: ✅ Pass · ❌ Fail · ⏭ Skip (note reason)
Log failures in the **Bug Log** at the bottom with TC reference.

---

## Why this release exists

Reported by a user in a Crucible DM: **every** compile failed instantly with

    Error during build: Invalid FQBN: getting build properties for board
    proffieboard:stm32l4:ProffieboardV3-L452RE: invalid option 'pclk'

Reproduced here by installing Proffieboard core 3.6 alongside, which is what a
ProffieConfig or Arduino IDE user is likely to have.

**Root cause.** `arduino-cli compile` resolves the platform from the SHARED
Arduino15 tree regardless of the `--config-file` we pass. Measured 2026-08-04:
the same flag that makes `board details` report "platform not installed" still
lets `compile` find a core there. So JMT Studio was building against whatever
Proffieboard core another program had installed, and a core predating the `pclk`
FQBN option rejected the whole FQBN before compiling a single file. Nothing was
ever built, the message gave the user nothing to act on, and the `.core-installed`
sentinel then recorded the wrong core as the right one on every launch, so it
never recovered on its own.

**Second defect found during the same session, also in 1.7.1:** when the app DOES
decide to install, it installs into the shared tree and REPLACES whatever core is
there. Observed live: `Replacing platform proffieboard:stm32l4@3.6 ... Uninstalling
proffieboard:stm32l4@3.6`. A ProffieConfig user would have had their core silently
upgraded out from under them. Only the stale sentinel was preventing this from
firing for the reporting user.

## Patches in this release

- **Capability probe instead of a version match.** Ask whether the core arduino-cli
  resolves on its own advertises the `pclk` option. Tests the thing that actually
  breaks, survives future core releases, and cannot be fooled by a directory name.
- **Conditional isolation.** When the system core CAN build, nothing changes: no
  install, no download, no isolation, identical behaviour to 1.7.1. When it CANNOT,
  every arduino-cli invocation is pinned to the app's own directory via
  `ARDUINO_DIRECTORIES_DATA`, which is the only thing that redirects platform
  discovery for `compile`. Other Arduino tooling is neither read nor modified.
- **Sentinel verified against reality.** `.core-installed` is treated as a speed-up,
  never as evidence; the files must actually be present.
- **Installed-core check reads `boards.txt`, not the directory name.** The same core
  installs as `4.6` or `4.6.0` depending on whether the request said `@4.6` or
  `@4.6.0`, and both are legitimate — a hardcoded name would reinstall every launch.
- **In-session self-heal.** A compile that fails on an unusable core re-probes and
  retries once, so a core swapped while the app is open recovers without a restart.
  Guarded to that one signature so a genuine config error is never compiled twice.
- **Adds `test/core-detect.test.js`** — 23 checks over real `board details` output
  captured from both cores, covering the capability probe, the retry classifier, the
  abort guard and the board-list directory decision.

---

## 1. BROKEN-MACHINE PATH (system core too old)

Test state: Arduino15 holds **3.6 only**; app's own core directory empty;
`.core-installed` holds a stale `4.6.0` written by 1.7.1. This is the reporting
user's exact situation.

- [x] TC-1876: Confirm the broken state first — compile on **1.7.1** fails with `invalid option 'pclk'` in 0:00 ✅
- [x] TC-1877: Install 1.7.2 → startup log shows *"The Proffieboard core on this system cannot build for this board (no 'pclk' option). Using JMT Studio's own copy instead; your other Arduino tools are left untouched."* ✅
- [x] TC-1878: Stale `.core-installed` = `4.6.0` does NOT short-circuit the install — the app installs anyway because the directory is empty ✅
- [x] TC-1879: Install log shows `Installing platform proffieboard:stm32l4@4.6...` with **no** `Replacing platform` and **no** `Uninstalling` lines ✅
- [x] TC-1880: After install, app's own dir holds the core; verified `packages/proffieboard/hardware/stm32l4/4.6` with 40 `pclk` mentions in `boards.txt` ✅
- [x] TC-1881: **Arduino15 still holds 3.6, untouched.** The other tool's core survives ✅
- [x] TC-1882: Compile succeeds ✅
- [x] TC-1883: `build-output/build.options.json` `hardwareFolders` points at `AppData\Roaming\jmt-studio\arduino-data\...\4.6`, NOT Arduino15 ✅
- [x] TC-1884: Directory is named `4.6` while the sentinel says `4.6.0` — app does not treat this as a missing core and does not reinstall on the next launch ✅

## 2. HEALTHY-MACHINE PATH (system core is fine)

The large majority. Must be a no-op: no download, no isolation, no change.

- [x] TC-1885: With a working 4.6.x in the system tree, startup logs *"Core proffieboard:stm32l4 on this system can build for this board."* and performs NO install ✅ Verified on Linux and macOS.
- [x] TC-1886: No new core appears in the app's own `arduino-data` directory ✅ Checked on the filesystem after launch on both Linux and macOS — directory still empty.
- [x] TC-1887: Compile resolves from the system tree exactly as in 1.7.1 ✅ `build.options.json` `hardwareFolders` pointed at the SYSTEM tree on both. Compile time not separately benchmarked against 1.7.1; the healthy path adds one `board details` probe (sub-second) and nothing else.
- [x] TC-1888: Upgrading on a healthy machine triggers no download and no first-run delay ✅ Linux upgraded 1.7.1 → 1.7.2 via `.deb`, macOS via the notarized build. Neither downloaded a core. **Note both machines carried a STALE `.core-installed` claiming `4.6.0` over an empty directory — the exact state that is unrecoverable on 1.7.1 — and it was correctly ignored rather than trusted.**

## 3. SELF-HEALING

- [ ] TC-1889: Swap the system core **while the app is open** → in-session self-heal ⏭ **NOT TESTED.** Every break was performed with the app closed. The retry path is unit-covered but has never run against a live app.
- [x] TC-1890: The retry fires at most once; a genuine config error is NOT compiled twice ✅ Covered by `test/core-detect.test.js` (config error, flash overflow, OOM and clean-build outputs all correctly refuse the retry). Not exercised against a live app.
- [x] TC-1891: Restore a good system core, restart → app returns to using it ✅ macOS. After restoring the real 4.6 to the system tree (with the app's own 4.6 still present), relaunch logged `Core proffieboard:stm32l4 on this system can build for this board.` — it went back to the system core with no stale isolation and did not cling to its own copy.

## 4. CROSS-PLATFORM

The mechanism is platform-agnostic (an arduino-cli env var, a CLI probe, and a
`boards.txt` read; no OS-specific paths). **All verified.**

- [x] TC-1892: macOS — broken-core path installs into the app's own directory, `~/Library/Arduino15` untouched, compile succeeds ✅ macOS 26.5.1 arm64. System core forced to 3.6, app's own copy cleared. Isolation message fired; 4.6 installed into `~/Library/Application Support/jmt-studio/arduino-data/`; **`~/Library/Arduino15/.../stm32l4/` still read 3.6 afterwards** and the parked real core was untouched — both verified on the filesystem, not from the log. `build.options.json` `hardwareFolders` pointed at the app's own directory. Compile 26 s, board detected, flash 53 s.
  **⚠️ Same correction as TC-1894:** the system core was forced to **3.6**, not removed, so `board list` had a platform to read either way. "Board detected" here does not demonstrate the `portDetector.js` fix.
- [x] TC-1893: macOS — healthy machine is a no-op ✅ macOS 26.5.1 arm64, 1.7.2 installed from the notarized build (`spctl` verdict `accepted`, `source=Notarized Developer ID`). Baseline was the interesting one: system core 4.6 present, app's own directory **empty**, and a **stale `.core-installed` reading `4.6.0`** — the exact combination that is unrecoverable on 1.7.1. Log read `Core proffieboard:stm32l4 on this system can build for this board.`; verified on the filesystem afterwards that the app's directory was still empty (no install, no download) and that `build.options.json` `hardwareFolders` pointed at `~/Library/Arduino15/.../4.6`, the system core. Compile succeeded, board detected, flash succeeded.
- [x] TC-1894: Linux — broken-core path installs into the app's own directory, `~/.arduino15` untouched, compile succeeds ✅ Ubuntu VM, system core downgraded to 3.6, app's own copy cleared, stale sentinel left in place. Log read `The Proffieboard core on this system cannot build for this board (no 'pclk' option). Using JMT Studio's own copy instead...`; installed 4.6 into `~/.config/jmt-studio/arduino-data/`; **no `Replacing platform` and no `Uninstalling`**; `~/.arduino15/.../stm32l4/` still 3.6 afterwards; compile succeeded (2:03); **board detected under isolation** (`Proffieboard on /dev/ttyACM0`, SN 206F32914630); flash succeeded (1:02).
  **⚠️ CORRECTION 2026-08-06.** This was originally recorded as "first exercise anywhere of the P1 fix." **It is not, and the claim is withdrawn.** The board-detection fix is `portDetector.js:60-61`, which sets `ARDUINO_DIRECTORIES_DATA` to the app's own directory when `coreCanBuildAt(dataPath)` is true, so that `board list` follows the core on Mac/Linux the way `--config-file` already did on Windows. The bug it fixes only appears when the system directory has **no Proffieboard platform at all** — `matching_boards` then comes back empty and a physically connected board reports "No Proffieboard detected." In this test the system tree held core **3.6**, which still defines the Proffieboard V3 and would have populated `matching_boards` on its own. `pclk` is a missing FQBN *option* in 3.6, not a missing board. So detection here would have passed with or without the fix. See TC-1901 for the test that would actually exercise it.
- [x] TC-1895: Linux — healthy machine is a no-op ✅ Ubuntu VM, `.deb` install of 1.7.2. Log read `Core proffieboard:stm32l4 on this system can build for this board.`; no install, no download; `dfu-suffix` patched in the SYSTEM core at `~/.arduino15/.../4.6/tools/linux` as expected for this path; board detected (`Proffieboard on /dev/ttyACM0`, SN 207C359F4747); compile succeeded; flash succeeded.
- [x] TC-1896: Linux — `dfu-suffix` 64-bit patch still applied when the isolated core is used ✅ Log confirmed the patch applied to the isolated core at `~/.config/jmt-studio/arduino-data/.../4.6/tools/linux`, and the subsequent flash succeeded, which is what actually exercises it. **Observation, deferred to 1.8:** it also patched the SYSTEM core at `~/.arduino15/.../3.6/tools/linux`. Walking both locations predates this release and does no damage (a 32-bit binary that cannot exec is replaced with a working 64-bit one), but it is an unrequested write into another tool's install and it contradicts our own "your other Arduino tools are left untouched" message. Logged in followups with the five-line fix.

**Note on the first Linux compile attempt:** failed with `fatal error: /home/obi-wan/.config/jmt-studio/my_styles.h: No such file or directory` — a stale absolute include in the test config pointing at a different user's home. Unrelated to this release, and it confirmed the toolchain resolved correctly, since the build reached the preprocessor. A core that cannot build fails at FQBN parsing in 0:00, long before that.

## 5. REGRESSION / GLOBAL SANITY

- [x] TC-1897: `test/core-detect.test.js` passes (18 checks) ✅
- [x] TC-1898: Flash to a board still works after an isolated-core compile ✅ Linux 1:02, macOS 53 s, both against the isolated core.
- [ ] TC-1899: Compile cache still hits on an unchanged config after the core switch ⏭ **NOT TESTED.** Note the cache key uses the `CORE_VERSION` constant, not the resolved core, so switching between a system 4.6 and an isolated 4.6 does not change the key. That is arguably correct — isolation guarantees the required version — but it was not exercised.
- [ ] TC-1900: In-app update 1.7.1 → 1.7.2 ⏭ **NOT TESTED.** Cannot be until the GitHub release is set to Latest, since the updater reads `/releases/latest` which skips pre-releases and drafts. Test after publishing. **UNBLOCKED 2026-08-06** — the release is public and the website serves 1.7.2, so this is now testable.
- [ ] TC-1901: Board detection with **no Proffieboard platform in the system tree** ⏭ **NOT TESTED.** Added 2026-08-06 after the TC-1892/TC-1894 correction above. This is the only shape that exercises the `portDetector.js` fix. Setup: remove the Proffieboard platform from the system directory entirely (`~/.arduino15/packages/proffieboard` on Linux, `~/Library/Arduino15/...` on macOS) rather than downgrading it, leave the app's own 4.6 in place, connect a board. Expected: still detected as a Proffieboard. On 1.7.1 the same setup reports "No Proffieboard detected." Mac and Linux only — Windows already passed `--config-file` before this release.

---

## Bug Log

| # | TC | Severity | Description | Status |
|---|----|----------|-------------|--------|
| 1 | — | P1 | 1.7.1 replaces the user's Proffieboard core in the shared tree when it decides to install (`Replacing platform ... 3.6`, `Uninstalling`). Observed live 2026-08-04. | Fixed by this release's isolation |
| 2 | — | P1 | 1.7.1 writes `CORE_VERSION` into `.core-installed` after accepting ANY core version, making one wrong core permanent across launches. | Fixed |
| 3 | TC-1901 | P2 | On Mac/Linux, `board list` read the system Arduino directory while the compiler used the app's isolated core. With no Proffieboard platform in the system tree, `matching_boards` came back empty and a connected board reported "No Proffieboard detected." Fixed at `portDetector.js:60-61` by pointing `ARDUINO_DIRECTORIES_DATA` at the app's directory when it holds a core that can build. | Fixed, **not yet verified** — see TC-1901 |

---

## Sign-off

**Status 2026-08-06: SEALED.** The release shipped 2026-08-05 and is public; the website serves
1.7.2. Two of the four open TCs were sealed as NOT TESTED with their reasons recorded above —
TC-1889 (in-session self-heal) and TC-1899 (cache hit across a core switch) — neither being worth
chasing on a shipped emergency patch. The other two were **carried forward into `qa-1.8.0.md`
under their original IDs**, per the regression carry-forward convention: TC-1900 (in-app update,
unblocked once the release went public) and TC-1901 (board detection with no system platform,
which verifies a P2 fix that shipped unverified).

This file is a sealed historical record from here. Do not edit it; corrections belong in the
active QA file.

- [x] P1/P2 resolved *(in code; bug 3 in the log is fixed but unverified, see TC-1901)*
- [x] Tested on a signed release build (Windows)
- [x] Version bumped to 1.7.2
- [x] AppStream date bumped (1.7.2 / 2026-08-04)
- [x] Tag `v1.7.2` created (at `839277a`, moved after the code review)
- [x] Forward-merge to `dev` recorded (`9ed4278`, kept 1.8.0)
- [x] macOS build verified (both `.dmg`s, apps notarized + stapled, `spctl` accepted)
- [x] Linux build verified (`.deb` installed and tested; **AppImage does NOT launch on Ubuntu 24.04+ — pre-existing since at least 1.6.5, logged in followups**)
