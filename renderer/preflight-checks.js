/**
 * THE PREFLIGHT CHECKS THEMSELVES  [B-224]
 *
 * One file, one list. Adding a check is adding an entry here — no edit to the
 * compile path, no new dialog, no new button. If a change to this file is not a
 * new `register({...})` block, ask why not.
 *
 * Read preflight.js first for the contract. The three things that catch people:
 *   1. `{ unsure: reason }` is a real answer and costs nothing. Use it whenever the
 *      evidence is thin — a wrong check is worse than an absent one.
 *   2. The ROW is the finding. One finding may name 58 presets; it is still one row
 *      with one fix.
 *   3. Config only. ctx does not carry the SD card, deliberately.
 */
(function (root) {
  'use strict';

  const preflight = (typeof module !== 'undefined' && module.exports)
    ? require('./preflight.js')
    : root.preflight;

  // ── Blade style counts ───────────────────────────────────────────────────
  //
  // A preset is POSITIONAL: { font, track, style1..styleN, "Name" }. Leave a style
  // out and the NAME slides into the last style slot, so gcc reports
  //     cannot convert 'const char*' to 'StyleFactory*' in initialization
  // pointing at the name — the only token actually of the wrong type — inside a
  // 600-character template expansion. It cannot point at the missing style,
  // because nothing is there to underline. The compiler's answer is correct and
  // unusable, which is the whole reason this is worth catching here.
  // (Reported 2026-09-10 as "the error was pointing me to like 114... totally
  // wrong.")
  //
  // Rehoused from the bespoke gate in index.html, 2026-09-12. Behaviour is
  // unchanged and its QA cases (section 188) still describe it exactly.
  //
  // SCOPE IS UNDER-COUNT. Over-count also fails to compile, but it already carries
  // a red "n/m BLADES" header and a repair tool, so nobody falls into the same
  // unreadable error blind. Widening it lives with [B-223], which is this same
  // rule filed first and covers both directions.
  //
  // NO FIX OFFERED, and that is not an omission. Filling the slot means choosing a
  // style, which is a decision, not a repair — and choosing it ONCE and applying it
  // across presets is [B-366]. The finding points at the empty slot in the Styles
  // row, where the app already knows how to do this.

  const _stripForCount = s => String(s || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

  // A SECOND, CRUDER READING OF THE SAME TEXT. Deliberately not a parser — it only
  // has to disagree. Style*Ptr<…> covers StylePtr, StyleNormalPtr, StyleFirePtr and
  // the rest; &name covers a reference to a style declared elsewhere.
  const _styleTokens = raw => {
    const c = _stripForCount(raw);
    return (c.match(/\bStyle\w*Ptr\s*</g) || []).length + (c.match(/&\w+/g) || []).length;
  };

  preflight.register({
    id: 'blade-style-count',
    severity: 'block',
    title: 'Blade style counts',
    run(ctx) {
      const expected = ctx.bladeCount;
      if (!(expected > 0)) return null;          // no NUM_BLADES to compare against
      if (!ctx.parsed) return { unsure: 'the config could not be parsed' };

      const short = [];
      for (const arr of (ctx.parsed.arrays || [])) {
        for (const p of (arr.presets || [])) {
          // A preset the parser could not read has an empty style list by
          // construction, so counting it would report "0 of 4" about a fault that
          // is something else entirely.
          if (p.parseError) continue;

          // Commented-out presets never reach the parser at all, which is what we
          // want: a disabled preset is not compiled, so it cannot fail to compile.
          // (The over-count repair DOES walk disabled blocks, for the opposite
          // reason — those come back.)
          const actual = (p.styles || []).length;
          if (actual >= expected) continue;

          // ⚠️ THE PARSER IS NOT CORROBORATION OF ITSELF, and that cost three false
          // positives before it was measured. Across 173 real configs the rule
          // would have blocked 14, and 3 of those compile fine: presetParser
          // under-counts styles on certain configs and reports no parseError while
          // doing it. More tokens than parsed slots means we cannot account for the
          // difference, and that is silence. Over-counting costs a missed case,
          // which is cheap; the other direction blocks a working build.
          if (_styleTokens(p.raw) > actual) continue;

          // A preset with no styles parsed has no trustworthy name either: with
          // nothing between the strings the parser takes the LAST one, which is the
          // track. Naming a preset after its own wav describes a different fault.
          const nameRaw = (p.displayName || '').trim();
          const name = (!nameRaw || nameRaw === (p.track || '').trim())
            ? `Preset ${p.index}`
            : nameRaw;
          short.push({ name, actual, array: arr.name });
        }
      }
      if (!short.length) return null;

      const one    = short.length === 1;
      const counts = [...new Set(short.map(s => s.actual))];
      // "have 3 of 4 blade styles" when they agree, which is the common case (a
      // config grows a blade and every preset is one short). Mixed counts get the
      // weaker sentence rather than a per-preset breakdown nobody needs.
      const countPhrase = counts.length === 1
        ? `${counts[0]} of ${expected} blade style${expected === 1 ? '' : 's'}`
        : `fewer than ${expected} blade styles`;

      // A preset short by more than one has more than one empty slot, and usually
      // is when a config gains a blade: 34 presets at "1 of 3" are each missing TWO.
      const slotWord = short.every(s => expected - s.actual === 1) ? 'slot' : 'slots';

      // Named only when there is more than one bank, since most configs have one
      // and the name is noise there.
      const banks = [...new Set(short.map(s => s.array).filter(Boolean))];
      const bankNote = (ctx.parsed.arrays || []).length > 1 && banks.length
        ? `${banks.length === 1 ? 'All in' : 'Across'} ${banks.join(', ')}.`
        : '';

      return {
        findings: [{
          title: `Your config has ${expected} blade${expected === 1 ? '' : 's'}, and `
               + `${one ? '1 preset has' : `${short.length} presets have`} ${countPhrase}.`,
          detail: `${bankNote ? bankNote + ' ' : ''}Every preset needs one style per blade, so this `
                + `cannot compile. Open ${one ? 'that preset' : 'each preset'} in Presets and fill `
                + `the empty ${slotWord} in the Styles row.`,
          items: short.map(s => s.name),
          fix: null,
        }],
      };
    },
  });

  // ── Voicepack declared ───────────────────────────────────────────────────
  //
  // ProffieOS 8 added a voicepack VERSION REQUIREMENT that the user never opts
  // into. Traced against 7.15 and 8.10 source on 2026-07-30:
  //
  //   * The PROP registers it, not the OS core and not the config. Every call site
  //     lives in props/: prop_base.h (when MENU_SPEC_TEMPLATE IS defined),
  //     saber_fett263_buttons.h and saber_BC_buttons.h (when it is NOT), and
  //     blaster_BC_buttons.h (unconditionally). Both branches of that #ifndef lead
  //     to require_version, so on fett263 and BC there is no configuration that
  //     avoids it. 7.15 has none of this machinery, so moving a config from 7.15 to
  //     8.10 gains the requirement with nothing in the config having changed.
  //   * CheckVersion() re-runs on EVERY font directory change and searches ONLY
  //     that preset's font path. The failure is PER PRESET: one whose path reaches
  //     a voicepack is quiet, one that does not announces "voice pack not found"
  //     every time you switch to it. The message means "this preset cannot see a
  //     voicepack", not "this saber has none".
  //
  // ⭐ THIS IS THE REGISTRY'S DESIGN TEST. If the mechanism could not carry this
  // check — its per-preset list, its repair, and its courtesy line about the card —
  // the mechanism would be wrong and building three more checks on it would be
  // building them on sand. Rehoused 2026-09-12, behaviour unchanged.
  //
  // SEVERITY IS `warn`, AND THAT IS NOT A DEMOTION. The config compiles and flashes;
  // what breaks is the saber talking at you afterwards. That makes it the EXPENSIVE
  // class by the registry's own reasoning — found after flashing, with the saber
  // closed up, with nothing in the world to mention it.

  const VPK_INIT_RE = /(?:sound_library_v2|sound_library_)\s*\.\s*init\s*\(\s*\)|SoundLibrary\s*::\s*init\s*\(\s*\)/;

  // Keep only the lines a preprocessor would keep, evaluating ONLY the symbols we
  // can read from the config. Any other condition keeps BOTH branches live, so an
  // init behind an unknown #if still counts. Conservative on purpose: a missed
  // requirement is a saber that talks at you, a spurious one is a dismissible row.
  function vpkLiveText(src, defines) {
    const KNOWN = new Set(['MENU_SPEC_TEMPLATE', 'MOUNT_SD_SETTING']);
    const stack = [];
    const live = () => stack.every(f => f.live);
    const out = [];
    for (const raw of preflight.stripComments(src).split('\n')) {
      const m = raw.match(/^\s*#\s*(ifdef|ifndef|if|else|elif|endif)\b\s*([A-Za-z_]\w*)?/);
      if (m) {
        const kw = m[1], sym = m[2];
        if (kw === 'ifdef' || kw === 'ifndef' || kw === 'if') {
          let known = false, val = true;
          if ((kw === 'ifdef' || kw === 'ifndef') && sym && KNOWN.has(sym)) {
            known = true;
            val = (kw === 'ifdef') ? defines.has(sym) : !defines.has(sym);
          }
          stack.push({ live: val, known });
        } else if (kw === 'else') {
          const f = stack[stack.length - 1];
          if (f) f.live = f.known ? !f.live : true;
        } else if (kw === 'elif') {
          const f = stack[stack.length - 1];
          if (f) { f.live = true; f.known = false; }
        } else if (kw === 'endif') {
          stack.pop();
        }
        continue;
      }
      if (live()) out.push(raw);
    }
    return out.join('\n');
  }

  // The prop headers named inside #ifdef CONFIG_PROP.
  function vpkPropIncludes(text) {
    const src = preflight.stripComments(text);
    const out = [];
    const blocks = /#\s*ifdef\s+CONFIG_PROP([\s\S]*?)#\s*endif/g;
    let b;
    while ((b = blocks.exec(src))) {
      for (const i of b[1].matchAll(/#\s*include\s+"([^"]+)"/g)) out.push(i[1]);
    }
    return out;
  }

  // Does the prop this config selects register a voicepack requirement?
  // Returns { requires, v2, via } or null when we cannot tell.
  //
  // Follows the include chain rather than matching prop NAMES, because a user can
  // derive their own prop: the JMT wrapper extends SaberFett263Buttons and chains
  // Setup(), so a name list would miss his own config. Known limit, accepted: a
  // derived prop that overrides Setup() WITHOUT chaining escapes this, and text
  // alone cannot tell.
  async function vpkPropRequirement(ctx) {
    if (!ctx.versionName) return null;          // nothing chosen — cannot tell
    let queue = vpkPropIncludes(ctx.text).map(p => p.split('/').pop()).filter(Boolean);
    // A config with no prop include still HAS a prop: ProffieOS.ino falls back to
    // props/saber.h (ino:681). Returning null here made a default-prop config with
    // MENU_SPEC_TEMPLATE invisible — on hardware PropBase's constructor registers a
    // V2 requirement (prop_base.h:76) whatever the prop is, while every surface of
    // ours stayed silent. ([B-003], 2026-09-06.)
    if (!queue.length) queue = ['saber.h'];
    const seen = new Set();
    while (queue.length && seen.size < 16) {
      const file = queue.shift();
      if (!file || seen.has(file)) continue;
      seen.add(file);
      let res = null;
      try { res = await ctx.readVersionFile(ctx.versionName, `ProffieOS/props/${file}`); } catch {}
      if (!res || !res.ok || !res.content) continue;
      const liveSrc = vpkLiveText(res.content, ctx.defines);
      const hit = liveSrc.match(VPK_INIT_RE);
      if (hit) {
        // WHICH spelling is live IS the version, straight from the source, and only
        // the V2 requirement can ever FAIL: require_version(1) is satisfied by any
        // pack, including one with no ini at all, since a missing ini reads as
        // version 1. So this is binary, not a number to compare.
        const isV1 = /sound_library_\s*\.\s*init/.test(hit[0]);
        // WHERE the registration lives is the attribution: a hit in the prop's own
        // file means the prop demands it; a hit in prop_base.h means the USER's
        // MENU_SPEC_TEMPLATE brought it in, and blaming "your prop" there is wrong —
        // sa22c asks for nothing. (2026-09-06.)
        return { requires: true, v2: !isV1, via: file === 'prop_base.h' ? 'menuspec' : 'prop' };
      }
      // Only chase further headers inside props/ — every init call site lives there,
      // and it keeps the walk bounded.
      for (const i of liveSrc.matchAll(/#\s*include\s+"([^"]+)"/g)) {
        const inc = i[1];
        if (!inc.includes('/') || /(^|\/)props\//.test(inc)) queue.push(inc.split('/').pop());
      }
    }
    return { requires: false, v2: false };
  }

  // Presets that declare no shared folder at all. Name-agnostic and count-agnostic,
  // so it holds for "MC", for a nested "balvenos/common", and for a per-preset
  // dark/light split.
  function vpkScanPresets(parsed) {
    const missing = [], sharedNames = new Set();
    for (const arr of (parsed?.arrays || [])) {
      for (const p of (arr.presets || [])) {
        const font = String(p?.font ?? '').trim();
        // No font at all is a different (bigger) problem than a missing shared
        // folder, and "add ;common" would not be a repair for it. This also covers
        // a freshly added preset seeded as ";common" — it has the folder, it just
        // has no font yet.
        if (!preflight.fontDir(font)) continue;
        const shared = preflight.sharedDirs(font);
        shared.forEach(n => sharedNames.add(n));
        if (!shared.length) {
          missing.push({
            index: p.index,
            font: preflight.fontDir(font) || font,
            label: p.displayName || '',
            range: p.fontRange,
          });
        }
      }
    }
    return { missing, sharedNames: [...sharedNames] };
  }

  preflight.register({
    id: 'voicepack-declared',
    severity: 'warn',
    title: 'Voicepack folder not listed',
    async run(ctx) {
      if (!ctx.parsed) return null;
      // Cheap synchronous scan first; only touch the filesystem if something is
      // actually missing.
      const { missing, sharedNames } = vpkScanPresets(ctx.parsed);
      if (!missing.length) return null;

      const req = await vpkPropRequirement(ctx);
      // ⚠️ null means we could not read the prop tree — no version selected, or the
      // files were unreadable. That is exactly the case the registry added a third
      // answer for: we have found presets with no shared folder but we do not know
      // whether anything requires one, and guessing in either direction is wrong.
      if (req === null) return { unsure: 'the selected OS version could not be read' };
      if (req.requires !== true) return null;

      // Repair uses a name the config already uses when that is unambiguous, so a
      // card organised around "MC" does not get a stray ";common" bolted on.
      const repairName = sharedNames.length === 1 ? sharedNames[0] : 'common';
      const one = missing.length === 1;

      // The card line is a COURTESY, not a check — we cannot see the card from here,
      // and an unverifiable warning is noise. Worded from the names the config
      // already uses so it stays correct for an "MC" card.
      const cardLine = sharedNames.length
        ? `Your other presets use ${sharedNames.join(' and ')}. `
          + `${sharedNames.length > 1 ? 'Those folders' : 'That folder'} must exist at the root of your SD card.`
        : `A ${repairName} folder must exist at the root of your SD card.`;

      return {
        findings: [{
          title: `${req.via === 'menuspec'
            ? "Your config's OS8 menu system (MENU_SPEC_TEMPLATE) requires a voicepack"
            : 'Your prop requires a voicepack on ProffieOS 8'}, and `
            + `${one ? 'this preset does' : `${missing.length} presets do`} not list a shared folder.`,
          detail: `Unless ${one ? 'that font contains' : 'those fonts contain'} their own copy of the `
            + `voicepack, the saber will announce "voice pack not found" every time you switch to `
            + `${one ? 'it' : 'them'}. ${cardLine}`,
          items: missing.map(p => p.label ? `${p.font} (${p.label})` : p.font),
          fix: {
            label: one ? `Add ;${repairName} to 1 preset` : `Add ;${repairName} to ${missing.length} presets`,
            // Returns edits; the caller batches every accepted fix into ONE atomic
            // write. Ranges are 1-based lines / 0-based columns from the parser and
            // cover the quotes, which is why the replacement re-adds them.
            plan() {
              return missing.filter(p => p.range).map(p => ({
                startLine: p.range.startLine, startCol: p.range.startCol,
                endLine:   p.range.endLine,   endCol:   p.range.endCol,
                text: `"${p.font};${repairName}"`,
              }));
            },
          },
        }],
      };
    },
  });

  // ── Prop defines with no prop at all ─────────────────────────────────────
  //
  // [B-089]. The fault is Afrojedi's 2026-06-15 Crucible config: a full set of
  // FETT263_QUICK_SELECT_ON_BOOT / FETT263_TWIST_ON / FETT263_EDIT_MODE_MENU in
  // CONFIG_TOP and no prop include at all. ProffieOS fell back to the default
  // saber prop, every one of those defines became dead code, and the board booted
  // with NO WAY TO NAVIGATE THE SABER.
  //
  // ⭐ IT COMPILES CLEANLY. There is no compiler diagnostic to translate, no error
  // to look up, and nothing anywhere in the world that mentions it — the saber
  // simply does not behave as configured, and it is found after flashing with the
  // hilt closed up. That is the expensive class, which is exactly why `warn` here
  // does not mean "minor".
  //
  // ⚠️ THE RULE IS PORTED, NOT RE-DERIVED. It was built and measured in the
  // research harness (local/nightly/error-exp/lint_precompile.js, R12) at 0 false
  // positives over 164 configs, with one genuine fault found in the wild. The
  // entry sat open for weeks on "where does a config lint LIVE" — this registry is
  // that answer, and this is its first `warn` consumer.
  //
  // ⚠️⚠️ ITS FIRST DRAFT MATCHED ON PROP HEADER FILENAMES AND SCORED 6 FALSE
  // POSITIVES ON RYAN'S OWN 8 KNOWN-GOOD CONFIGS, all of which include
  // `../props/jmt_fett_prop.h` — a JMT prop outside the stock props/ directory.
  // The lesson is NOT "add that filename": any allowlist of prop filenames is a
  // wolf-crier by construction, because anyone may rename a prop or write their
  // own and the rule would then call a working config broken. Filenames are not
  // evidence about behaviour. So this asks the ONE question it can answer with
  // certainty — is there a prop include at all? — and abstains everywhere else.
  //
  // NO FIX IS OFFERED, deliberately. A repair would have to choose WHICH prop the
  // user meant, and the header named below is the likely one rather than the known
  // one. Writing a guess into someone's config is the one outcome worse than
  // telling them what is wrong.

  // Derived by scanning the real props/ directory (ProffieOS 8.x, 2026-08-22), not
  // written from memory. Two results a remembered list would have got wrong:
  // FETT263_ has TWO valid homes because JMT's own wrapper defines that surface
  // too, and there is NO SHTOK_ prefix at all — saber_shtok_buttons.h carries only
  // DISABLE_* defines, so guessing would have added a rule that can never fire.
  // Generic prefixes shared across props (DISABLE_, ENABLE_, BUTTON_, BLADE_,
  // SAVE_, MENU_, MOUNT_, GESTURE_, DYNAMIC_) are deliberately absent: they say
  // nothing about WHICH prop is wanted.
  const PROP_DEFINE_OWNERS = [
    { prefix: 'FETT263',    headers: ['saber_fett263_buttons.h', 'jmt_fett263_wrapper.h'] },
    { prefix: 'SA22C',      headers: ['saber_sa22c_buttons.h'] },
    { prefix: 'BC',         headers: ['saber_BC_buttons.h', 'blaster_BC_buttons.h'] },
    { prefix: 'CAIWYN',     headers: ['saber_caiwyn_buttons.h'] },
    { prefix: 'SABERSENSE', headers: ['saber_sabersense_buttons.h'] },
  ];

  preflight.register({
    id: 'prop-defines-without-prop',
    severity: 'warn',
    title: 'Prop defines with no prop',
    run(ctx) {
      const clean = ctx.cleanText;
      if (!clean) return null;

      const present = [];
      for (const { prefix, headers } of PROP_DEFINE_OWNERS) {
        const re = new RegExp('^\\s*#\\s*define\\s+(' + prefix + '_[A-Z0-9_]+)', 'gm');
        const hits = [];
        let m;
        while ((m = re.exec(clean)) !== null) hits.push(m[1]);
        if (hits.length) present.push({ prefix, headers, hits });
      }
      if (!present.length) return null;

      // ABSTAIN ON A FRAGMENT. Seven of thirteen wild "findings" turned out to be
      // forum pastes of a CONFIG_TOP block alone — no presets, no prop section,
      // not a config anyone could flash. The rule was right about the text in
      // front of it and wrong about what the text WAS. Costs nothing in the app,
      // where a saved config always has presets.
      if (!preflight.sectionBody(clean, 'CONFIG_PRESETS')) {
        return { unsure: 'this looks like a config fragment, not a whole config' };
      }

      // Read from CONFIG_PROP specifically. A prop include sitting in the wrong
      // section is a DIFFERENT fault, and reporting it here would name the wrong
      // root cause — worse than giving no answer.
      const propBody = preflight.sectionBody(clean, 'CONFIG_PROP');
      const propIncludes = propBody ? (propBody.match(/#\s*include\s*[<"][^">]+[">]/g) || []) : [];
      if (propIncludes.length) {
        // Something is handling the prop and its name alone cannot tell us what.
        // A custom or renamed prop is legitimate and common.
        return { unsure: 'a prop is included and we cannot judge it by its filename' };
      }

      // Aggregated to ONE finding per prefix. Afrojedi's config would otherwise
      // produce two dozen identical rows, and attention is the scarce thing.
      return {
        findings: present.map(({ prefix, headers, hits }) => ({
          title: `Your config sets ${hits.length} ${prefix}_ option${hits.length === 1 ? '' : 's'}, `
               + `but no prop is included.`,
          detail: `Without a prop, ProffieOS uses its default and every one of these does nothing — `
                + `the saber will boot, and none of the controls you set up will work. Add the prop `
                + `to the CONFIG_PROP section; for these options that is usually ${headers[0]}.`,
          items: hits.slice(0, 3),
          fix: null,
        })),
      };
    },
  });

  // Exposed for index.html, whose Sound Fonts view asks the same question when
  // deciding what a NEWLY added preset should carry. One walk, one answer — the
  // alternative is a second implementation that drifts.
  const api = { vpkLiveText, vpkPropIncludes, vpkPropRequirement, vpkScanPresets, VPK_INIT_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.preflightChecks = api;

}(typeof globalThis !== 'undefined' ? globalThis : this));
