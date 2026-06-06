# Compile Error UX

**Target release:** v1.8.x or later (corpus-dependent, not date-gated)
**Status:** Open spec, Phase 0 (corpus building) not yet started
**Owner:** Ryan
**Last updated:** 2026-06-06

## The why

Makers (not developers) hit compile errors. The current state surfaces the error message at a reasonable size after `extractCompileError` (paths stripped, 180-char per-line cap, top-3 errors only), but the message itself is GCC jargon written for C++ developers. A user reading `error: no matching function for call to 'StylePtr<template<class INNER> using PixelSwitchWrapper = ...'>` does not get from there to "set the inner class param on the wrapper" without help. The error surfaces; it does not resolve.

The problem is **comprehension and resolution**, not navigation. Click-to-jump is a smaller piece; comprehension is the lever.

## Strategy

Plain-language translation of GCC jargon is the right lever. Good translation needs a corpus of real-world errors to pattern-match against. We do not yet have that corpus. Therefore the work is phased, with corpus building first.

- **Phase 0** — Build the error corpus. Research, not user-facing.
- **Phase 1** — Build a pattern map from the corpus (regex / token matching → plain-language hint).
- **Phase 2** — Ship pattern-map translation in the compile error modal as the headline UX change.
- **Phase 3 (deferred)** — Click-to-jump and help link as supporting features.

## Phase 0: Corpus building

Two parallel research methods.

### Method 1: Deliberate error generation

Create test configs that intentionally trigger known and likely error classes, run them through the actual compile pipeline, and capture the verbatim GCC output. Each entry records:

- The trigger (what we changed in the config to produce the error)
- The verbatim GCC output, untruncated
- The plain-language translation we would want to show
- Severity / likelihood a maker hits this in real use

Starter categories to seed from existing knowledge:

- Template alias misuse (`StylePtr<PixelSwitchWrapper>()` without inner — the BUG-020 case)
- Missing include (preset references `PixelRelay` without including the jmt-proffie-addons header)
- Wrong board version in include (`proffieboard_v3_config.h` with V2-only syntax in the file)
- Undeclared blade type (`BLADE_xxx` undefined)
- Mismatched preset argument count (too many or too few)
- Style argument typos (`Ag255,0,0>` instead of `Rgb<255,0,0>`)
- Named color typo (`Rde` instead of `Red`)
- Helper function referenced before declared
- Charging style referenced without the JMT charge-full-prop header installed
- Bracket and parenthesis mismatches that produce template-instantiation cascades

This is a job Cody can do systematically in a focused session: generate intentional bad configs, run compiles, capture output, organize.

### Method 2: Crucible search

Mine the ProffieOS community (Crucible Discord) for real user error reports. Look in:

- Help / troubleshooting channels
- Pinned messages with common errors
- Search history for `error:`, `compile failed`, common GCC tokens

For each real-world error found:

- Verbatim user-quoted error
- Context (what they were trying to do)
- How it was resolved (if visible in the thread)
- Frequency observation (multiple similar reports = common pattern)

Aggregate into the same corpus document used for Method 1. Real-world signal is more valuable than synthesized because it reflects actual user mistakes and surfaces patterns we would not predict.

### Corpus storage

Open question: where does the corpus live? Two candidates.

- **`local/compile-error-corpus.md`** — gitignored, work product. Fine while research is private. No collaboration cost because it is single-author.
- **`docs/research/compile-error-corpus.md`** — in repo, transparent. Future contributors can see the dataset that drove the pattern map. Collaboration cost low because the file is append-only and the conventions are simple.

Cody's lean: in-repo (`docs/research/`). The corpus is the load-bearing artifact behind the pattern map; keeping it visible makes the pattern map's reasoning auditable, which matters when a maker reports "the hint was wrong for my case." The file does not need to be user-facing pretty.

### Corpus completion threshold

Target: 20+ unique error patterns covering ~80% of common cases before Phase 1 begins. Below 20 the pattern map is guesswork; above 20 patterns start repeating and we have signal that the corpus has reasonable coverage. Hard threshold can be adjusted after the first 10 patterns when we see how varied real errors actually are.

## Phase 1: Pattern map

Once the corpus is meaningful, build a structured pattern map. Each entry:

- Match condition (regex or token-presence test)
- Plain-language hint (one or two sentences)
- Optional: suggested fix (one specific actionable step)
- Optional: link target for Phase 3 help-link integration

Implementation surface: a new `compileErrorPatterns.js` module (cleaner than bloating `toolchain.js`). Patterns matched in priority order (most-specific first to avoid generic patterns shadowing specific ones).

Pattern matching runs on the **raw GCC output**, not the truncated display version. Truncation could hide tokens the pattern needs. This implies splitting the current `extractCompileError`: extract structured errors first, then run pattern matching on raw, then truncate for display.

## Phase 2: Modal UX

Compile error modal gains a translation area above the raw output:

- Plain-language hint at top, JMT blue accent for visual lead
- Optional "Suggested fix" line below the hint when the pattern provides one
- "Show technical details" toggle below, expanded by default for now (no regression in info access for power users); revisit after a release based on whether makers find the raw output noise rather than reassurance

The raw output stays. Developers benefit from it and we do not want to remove it just because we added the hint layer.

## Phase 3+: Supporting features (deferred)

- **Click-to-jump** from `basename.h:LINE` in the error to Monaco's cursor at that line, with the modal closing. Compatible with everything else; small in scope. Lower priority than comprehension.
- **Help link** to a JMT-hosted page of common compile errors with examples and walkthroughs. Cheapest comprehension win; probably bundles with Phase 2.

## Out of scope

- Real-time error highlighting during edit (different feature; continuous-compile feedback loop)
- Auto-fix buttons that apply the suggested fix. Too risky for v1; a wrong auto-fix is worse than no auto-fix.
- Localization of plain-language hints. English-first; revisit if user base requests it.

## Open questions

1. **Corpus storage** — `local/` or `docs/research/`? Cody leans in-repo.
2. **Crucible search method** — manual review (Ryan + Cody reading threads in a session) or scripted (build a small Discord scrape tool)? Manual scales to hundreds of threads; scripted scales further but is its own engineering project. Manual seems right for v1.
3. **Phase 0 ship window** — does Phase 0 finish entirely before any v1.X ships, or do we use the v1.8 cycle to start the corpus while shipping smaller polish work alongside, with Phase 2 landing in v1.9 or later?
4. **Pattern map maintenance** — when a new ProffieOS version introduces a new error pattern, who notices and updates? Probably a recurring "review compile-error logs from QA cycles" task that becomes part of release prep.

## Notes for forward planning

This work is corpus-dependent, not date-dependent. Phase 0 has an unknown duration depending on how rich the deliberate-error session and Crucible search turn out to be. The polish list in v1.8 should not block on this; this spec is the explicit decision to defer the comprehension play until the corpus exists rather than guess at patterns up front.
