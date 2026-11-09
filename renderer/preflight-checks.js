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
  // BOTH DIRECTIONS, as of 2026-09-13 — this closes [B-223], which filed the same
  // rule first and always covered both. It shipped under-count only, on the
  // argument that over-count already carries a red "n/m BLADES" header and a
  // repair tool. THAT ARGUMENT DOES NOT SURVIVE BEING SAID OUT LOUD: the
  // sidecar paints MISSING slots red too, so it would have killed the under-count
  // check equally. A badge does not stop a compile — and a compile here has run as
  // long as 19 minutes for a failure that was knowable before it started.
  //
  // Over-count is the same hard failure, not a lesser one. `Preset` in
  // common/preset.h holds exactly NUM_BLADES style members plus the name, so an
  // extra style is one initializer more than the struct has room for.
  // AND IT IS NOT A TYPO CASE — it is what a config BECOMES. Lower NUM_BLADES
  // without touching the presets and every preset is over (the B226 fixtures are
  // built from exactly that), and [B-219]'s follower-delete cascade deliberately
  // leaves an OVERRIDDEN preset holding its slot rather than destroying the user's
  // own text. The app manufactures this state itself.
  //
  // NO FIX OFFERED, and that is not an omission. Filling the slot means choosing a
  // style, which is a decision, not a repair — and choosing it ONCE and applying it
  // across presets is [B-366]. The finding points at the empty slot in the Styles
  // row, where the app already knows how to do this.

  // A preset as a title names it. One with no name already reads "Preset 3".
  const _presetName = (name, word = 'Preset') => (/^preset\s/i.test(name) ? name : `${word} ${name}`);

  // A preset in a list: its position, as the Presets panel shows it, then its name if it has one.
  const _presetEntry = ({ index, name }) => (/^preset\s/i.test(name) ? `${index}` : `${index}. "${name}"`);

  // The list line for a card naming presets, from the names the check already holds.
  const _presetList = (ctx, names) => {
    const all = ((ctx.parsed && ctx.parsed.arrays) || []).flatMap(a => a.presets || []);
    return {
      labels: names.map((name) => {
        const p = all.find(x => (x.displayName || '').trim() === name || `Preset ${x.index}` === name);
        return p ? _presetEntry({ index: p.index, name }) : `"${name}"`;
      }),
      labelLead: names.length === 1 ? 'Preset to update' : 'Presets to update',
    };
  };

  const _stripForCount = s => String(s || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

  // The crude second opinion against the parser. It reads the same text a DIFFERENT way,
  // which is the whole value - so it borrows the parser's vocabulary rather than keeping
  // its own copy of what a style wrapper is called. [B-379]
  const _styleTokens = raw => {
    const c = _stripForCount(raw);
    return (c.match(_parser().stylePtrOpenRe()) || []).length + (c.match(/&\w+/g) || []).length;
  };

  // Written Missing placeholders in a preset's text. A slot, not a style. [B-525]
  const _placeholderTokens = raw =>
    (_stripForCount(raw).match(/\bStylePtr\s*<\s*MISSING_STYLE\s*>\s*\(\s*\)/g) || []).length;

  preflight.register({
    id: 'blade-style-count',
    severity: 'block',
    title: 'Blade style counts',
    run(ctx) {
      const expected = ctx.bladeCount;
      if (!(expected > 0)) return null;          // no NUM_BLADES to compare against
      if (!ctx.parsed) return { unsure: 'the config could not be parsed' };

      const short = [];
      const over  = [];
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
          // Slots decide over-count; real styles decide short, since a Missing placeholder
          // holds a slot and does not compile. [B-525]
          const slots  = (p.styles || []).length;
          const actual = (p.styles || []).filter(s => !_parser().isPlaceholderSlot(s)).length;
          if (actual === expected && slots === expected) continue;

          // THE PARSER IS NOT CORROBORATION OF ITSELF, and that cost three false
          // positives before it was measured. Across 173 real configs the rule
          // would have blocked 14, and 3 of those compile fine: presetParser
          // under-counts styles on certain configs and reports no parseError while
          // doing it. More tokens than parsed slots means we cannot account for the
          // difference, and that is silence. Over-counting costs a missed case,
          // which is cheap; the other direction blocks a working build.
          const tokens = _styleTokens(p.raw);
          const isOver = slots > expected;
          if (!isOver && tokens - _placeholderTokens(p.raw) > actual) continue;

          // THE SAME INSTRUMENT AIMED THE OTHER WAY, AND IT ABSTAINS ON THE
          // OPPOSITE DISAGREEMENT. An under-counting parser cannot INVENT a slot,
          // so it can never manufacture an over-count: 3 parsed against 2 expected
          // is still too many even if the truth is 5. What WOULD be a false
          // positive is the parser claiming more slots than the text can show, so
          // that is the direction to go quiet on.
          if (isOver && tokens < slots) continue;

          // A preset with no styles parsed has no trustworthy name either: with
          // nothing between the strings the parser takes the LAST one, which is the
          // track. Naming a preset after its own wav describes a different fault.
          const nameRaw = (p.displayName || '').trim();
          const name = (!nameRaw || nameRaw === (p.track || '').trim())
            ? `Preset ${p.index}`
            : nameRaw;
          (isOver ? over : short).push({ name, index: p.index, actual: isOver ? slots : actual, array: arr.name });
        }
      }
      if (!short.length && !over.length) return null;

      const blades = `${expected} blade${expected === 1 ? '' : 's'}`;

      // Named only when there is more than one bank, since most configs have one
      // and the name is noise there.
      const bankNote = (list) => {
        const banks = [...new Set(list.map(s => s.array).filter(Boolean))];
        return (ctx.parsed.arrays || []).length > 1 && banks.length
          ? (banks.length === 1 ? `In the ${banks[0]} bank. ` : `Across the ${banks.join(', ')} banks. `)
          : '';
      };

      const findings = [];

      if (short.length) {
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

        findings.push({
          // "but", NOT "and". [B-375] the catch 2026-09-16, and it is a rule not a typo:
          // "and" joins two compatible facts, and this sentence exists precisely because the two
          // halves CANNOT both be right. The conjunction was doing the opposite of the message's
          // job. Any finding whose title states the expectation AND the violation in one sentence
          // is an adversative and wants "but".
          title: `Your config has ${blades}, but `
               + `${one ? '1 preset has' : `${short.length} presets have`} ${countPhrase}.`,
          detail: `${bankNote(short)}Every preset needs one style per blade. Open `
                + `${one ? 'it' : 'each one'} in Presets and fill the empty ${slotWord} in the Styles row.`,
          items: short.map(s => s.name),
          labels: short.map(_presetEntry),
          labelLead: one ? 'Preset to update' : 'Presets to update',
          fix: null,
          kind: 'under',
        });
      }

      // ── THE OTHER DIRECTION [B-223] ──────────────────────────────────────
      // Too many styles is the same build failure, not a lesser one: `Preset` in
      // common/preset.h carries exactly NUM_BLADES style members plus the name, so
      // an extra style is one initializer more than the struct has room for.
      // AND THE APP MAKES THIS CASE ITSELF. [B-219]'s follower-delete cascade
      // deliberately leaves an OVERRIDDEN preset holding its slot, because that
      // text is the user's own work and must not vanish silently. Those leftovers
      // arrive here.
      // NO FIX, for the same reason the short side has none: WHICH style to drop
      // is a decision only the author can make.
      if (over.length) {
        const one    = over.length === 1;
        const counts = [...new Set(over.map(s => s.actual))];
        const countPhrase = counts.length === 1
          ? `${counts[0]} blade styles`
          : `more than ${expected} blade styles`;
        const extraWord = over.every(s => s.actual - expected === 1) ? 'style' : 'styles';

        findings.push({
          // "but", NOT "and". [B-375] the catch 2026-09-16, and it is a rule not a typo:
          // "and" joins two compatible facts, and this sentence exists precisely because the two
          // halves CANNOT both be right. The conjunction was doing the opposite of the message's
          // job. Any finding whose title states the expectation AND the violation in one sentence
          // is an adversative and wants "but".
          title: `Your config has ${blades}, but `
               + `${one ? '1 preset has' : `${over.length} presets have`} ${countPhrase}.`,
          detail: `${bankNote(over)}Every preset needs one style per blade and no more. Open `
                + `${one ? 'it' : 'each one'} in Presets and remove the extra ${extraWord} from the Styles row.`,
          items: over.map(s => s.name),
          labels: over.map(_presetEntry),
          labelLead: one ? 'Preset to update' : 'Presets to update',
          fix: null,
          kind: 'over',
        });
      }

      return { findings };
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
  // THIS IS THE REGISTRY'S DESIGN TEST. If the mechanism could not carry this
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
  // Setup(), so a name list would miss the JMT config too. Known limit, accepted: a
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
      // null means we could not read the prop tree — no version selected, or the
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
          // "but", same rule as the blade-count titles. [B-375] The requirement and its violation
          // in one sentence is an adversative.
          title: `${one ? 'This preset needs' : `${missing.length} presets need`} a voicepack, but `
            + `${one ? 'it does' : 'they do'} not list a shared folder.`,
          detail: `${req.via === 'menuspec'
              ? 'Your config turns on the ProffieOS 8 on-saber menus (MENU_SPEC_TEMPLATE), and those menus speak through a voicepack.'
              : 'Your prop needs a voicepack on ProffieOS 8.'} `
            + `Without a shared folder, the saber will say "voice pack not found" every time you switch `
            + `to ${one ? 'this preset' : 'these presets'}, unless ${one ? 'its font has' : 'their fonts have'} `
            + `a copy of the voicepack. ${cardLine}`,
          items: missing.map(p => p.label ? `${p.font} (${p.label})` : p.font),
          labels: missing.map(p => _presetEntry({ index: p.index, name: p.label || `Preset ${p.index}` })),
          labelLead: one ? 'Preset to update' : 'Presets to update',
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
  // IT COMPILES CLEANLY. There is no compiler diagnostic to translate, no error
  // to look up, and nothing anywhere in the world that mentions it — the saber
  // simply does not behave as configured, and it is found after flashing with the
  // hilt closed up. That is the expensive class, which is exactly why `warn` here
  // does not mean "minor".
  //
  // THE RULE IS PORTED, NOT RE-DERIVED. It was built and measured in the
  // research harness (local/nightly/error-exp/lint_precompile.js, R12) at 0 false
  // positives over 164 configs, with one genuine fault found in the wild. The
  // entry sat open for weeks on "where does a config lint LIVE" — this registry is
  // that answer, and this is its first `warn` consumer.
  //
  // ITS FIRST DRAFT MATCHED ON PROP HEADER FILENAMES AND SCORED 6 FALSE
  // POSITIVES ACROSS THE 8 KNOWN-GOOD CONFIGS, all of which include
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

  // The defines in this config that belong to a known prop family, one entry per family.
  function _propOwnedDefines(clean) {
    const present = [];
    for (const { prefix, headers } of PROP_DEFINE_OWNERS) {
      const re = new RegExp('^\\s*#\\s*define\\s+(' + prefix + '_[A-Z0-9_]+)', 'gm');
      const hits = [];
      let m;
      while ((m = re.exec(clean)) !== null) hits.push(m[1]);
      if (hits.length) present.push({ prefix, headers, hits });
    }
    return present;
  }

  // True when the config has no prop include, so prop-defines-without-prop owns these defines.
  function _noPropIncluded(clean) {
    const propBody = preflight.sectionBody(clean, 'CONFIG_PROP');
    return !(propBody && /#\s*include\s*[<"][^">]+[">]/.test(propBody));
  }

  preflight.register({
    id: 'prop-defines-without-prop',
    severity: 'warn',
    title: 'Prop defines with no prop',
    async run(ctx) {
      const clean = ctx.cleanText;
      if (!clean) return null;

      const present = await _propGroups(ctx);
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
      const hits = present.flatMap(g => g.hits);
      const rows = [];
      for (const name of hits) rows.push(await _defineRow(ctx, name));
      const one = hits.length === 1;
      const { prop, prefix } = present[0];
      const props = present.map(g => g.prop);
      const lastOr = `${props.slice(0, -1).join(', ')} or ${props[props.length - 1]}`;
      return { findings: [{
        title: present.length > 1
          ? `Your config sets options for ${props.length} different props, but no prop is included.`
          : prefix
            ? `Your config sets ${hits.length} ${prefix}_ option${one ? '' : 's'}, but no prop is included.`
            : `Your config sets ${one ? 'an option' : `${hits.length} options`} for ${prop}, but no prop is included.`,
        detail: `Without a prop, ProffieOS uses its default and ignores ${one ? 'it' : 'these'}. The config `
              + `will compile, but the saber may not behave as you expect. `
              + (present.length > 1
                ? `To use them, add the prop you want to the CONFIG_PROP section: ${lastOr}. Options for `
                + `any other prop stay ignored.`
                : `To use ${one ? 'it' : 'them'}, add ${prop} to the CONFIG_PROP section.`),
        items: hits.slice(0, 3),
        labels: [],
        rows,
        fix: null,
      }] };
    },
  });


  // Defines nothing in the selected version reads with this config's prop.
  async function _orphanDefines(ctx) {
    const clean = ctx.cleanText;
    const orphans = [];
    for (const name of ctx.defines) {
      if (_BUILD_LEVEL_DEFINES.has(name)) continue;
      // A FUNCTION-LIKE MACRO IS THE USER'S OWN CODE, NOT AN OPTION. `#define FIRE1PTR(NUM,
      // DELAY)` is a helper someone wrote to build their own styles; no prop was ever going to
      // read it, so "nothing reads this, here is Delete" is both wrong and alarming. Measured on
      // a real config 2026-10-16, where it accused FIRE1PTR and FIRE1_DELAY alongside two
      // genuine orphans. The distinguisher is the open bracket immediately after the name,
      // which is what makes a define a macro rather than a value.
      if (new RegExp('^[ \\t]*#[ \\t]*define[ \\t]+' + name + '\\(', 'm').test(clean)) continue;
      if (await _treeHasName(ctx, name)) continue;
      // A define the config uses ITSELF is correct and read by nobody in the OS tree - a
      // value referenced from the blade array, or a flag the user tests in their own styles.
      const uses = (clean.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
      const defs = (clean.match(new RegExp('^[ \\t]*#[ \\t]*define[ \\t]+' + name + '\\b', 'gm')) || []).length;
      if (uses > defs) continue;
      orphans.push(name);
    }
    return orphans;
  }

  // The props in the selected version that read a name. prop_base.h is every prop's base class,
  // so it says nothing about which one is wanted.
  async function _propsReading(ctx, name) {
    const index = await _treeIndex(ctx);
    let files = [];
    if (index) {
      const e = index.names[name];
      files = e ? e.f.map(i => index.files[i]) : [];
    } else {
      const hits = await ctx.searchVersionFiles(ctx.versionName, name);
      files = hits && hits.ok && Array.isArray(hits.results)
        ? hits.results.filter(r => r && r.type !== 'dir').map(r => r.path) : [];
    }
    return files.map(f => (String(f).replace(/\\/g, '/').match(/(^|\/)props\/([^/]+\.h)$/i) || [])[2])
      .filter(f => f && !/^prop_base\.h$/i.test(f));
  }

  // The defines that belong to a prop this config does not have, one entry per prop. The selected
  // version says which prop reads each. With no version to ask, the known families stand in.
  async function _propGroups(ctx) {
    const clean = ctx.cleanText;
    if (!ctx.versionName || !(await _searchIsTrustworthy(ctx))) {
      return _propOwnedDefines(clean).map(({ prefix, headers, hits }) => ({ prop: headers[0], prefix, hits }));
    }
    const readers = new Map();   // define -> props
    for (const name of await _orphanDefines(ctx)) {
      const props = await _propsReading(ctx, name);
      if (props.length) readers.set(name, new Set(props));
    }
    // A prop covers what it includes, so the fewest props that cover every define is the advice.
    // Most defines first; on a tie the prop that pulls in the least.
    const reach = new Map();
    for (const props of readers.values()) {
      for (const f of props) if (!reach.has(f)) reach.set(f, await _propReach(ctx, f));
    }
    const left = new Set(readers.keys());
    const groups = [];
    while (left.size) {
      const covers = (f) => [...left].filter(n => [...readers.get(n)].some(r => reach.get(f).has(r)));
      const best = [...reach.keys()].sort((x, y) =>
        covers(y).length - covers(x).length || reach.get(x).size - reach.get(y).size || x.localeCompare(y))[0];
      const hits = covers(best);
      if (!hits.length) break;
      hits.forEach(n => left.delete(n));
      groups.push({ prop: best, hits });
    }
    return groups;
  }

  // A prop file and every prop file it includes.
  async function _propReach(ctx, file) {
    const seen = new Set();
    const queue = [file];
    while (queue.length) {
      const f = queue.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      let res = null;
      try { res = await ctx.readVersionFile(ctx.versionName, `ProffieOS/props/${f}`); } catch { res = null; }
      if (!res || !res.ok || !res.content) continue;
      for (const m of preflight.stripComments(res.content).matchAll(/#\s*include\s*"(?:[^"]*\/)?([^"/]+\.h)"/g)) queue.push(m[1]);
    }
    return seen;
  }

  // One define as a row: its name, where it is, and Disable and Delete.
  async function _defineRow(ctx, name) {
    const suggestion = _suggestFor(name, await _familyNames(ctx, name.split('_')[0]));
    const where = _defineLines(ctx.text, name);
    // Renaming the define wherever it is defined. Shared by the two ways a new name can
    // arrive: typed into the row's own editor, or taken from the suggestion below it.
    const renameTo = (c, value) => {
      const edits = [];
      for (const w of _defineLines(c.text, name)) {
        const col = w.text.indexOf(name);
        if (col < 0) continue;
        edits.push({ startLine: w.line, startCol: col,
                     endLine: w.line, endCol: col + name.length, text: value });
      }
      return edits;
    };

    return {
      label: name,
      // Static, so the row reads as the line it came from and the keyword stays out of the
      // field the user is editing.
      prefix: '#define',
      note: where.length
        ? (where.length === 1 ? `line ${where[0].line}`
                              : `lines ${where.map(w => w.line).join(', ')}`)
        : '',
      // TWO SEPARATE OFFERS, because they are different acts. The editor is the user
      // supplying a name we do not have; the suggestion is us proposing one, and it only
      // appears when there IS a near match. Pre-filling the editor with the suggestion would
      // merge them and make taking our guess the path of least resistance - the same call the
      // sound-font import makes in its own note.
      rename: {
        placeholder: 'define name',
        hint: 'Correct a misspelled name and re-check',
        plan: renameTo,
      },
      suggest: suggestion ? { name: suggestion, plan: renameTo } : null,
      fixes: [
        {
          label: 'Disable',
          hint: 'Comment out the line but leave it in your config',
          // A PLAIN `//`, not the preset list's `@jmt-disabled` marker. That marker exists
          // because the preset list has to find those entries again and render them as
          // disabled; a commented-out define is just a commented-out line, and the user
          // reads it in the editor rather than through a UI that has to parse it back.
          // Indentation is preserved so the line stays where it sits in its block.
          plan(c) {
            const edits = [];
            for (const w of _defineLines(c.text, name)) {
              const indent = (w.text.match(/^[ \t]*/) || [''])[0];
              edits.push({ startLine: w.line, startCol: 0,
                           endLine: w.line, endCol: w.text.length,
                           text: `${indent}//${w.text.slice(indent.length)}` });
            }
            return edits;
          },
        },
        {
          label: 'Delete',
          hint: 'Remove the line from your config',
          plan(c) {
            const edits = [];
            const total = String(c.text || '').split('\n').length;
            for (const w of _defineLines(c.text, name)) {
              // The whole line including its break, so deleting does not leave a blank where
              // the define was. The last line of the file has no break to take.
              if (w.line < total) {
                edits.push({ startLine: w.line, startCol: 0, endLine: w.line + 1, endCol: 0, text: '' });
              } else {
                edits.push({ startLine: w.line, startCol: 0, endLine: w.line, endCol: w.text.length, text: '' });
              }
            }
            return edits;
          },
        },
      ],
    };
  }

  // ── A define that nothing in the selected OS version reads ───────────────
  //
  // [B-445, re-scoped 2026-10-15.] The entry's original design was a TABLE: enumerate every
  // define each prop reads, decide which are prop-specific, and keep it current across releases.
  // Measured at 179 defines across 15 prop files, of which 13 from prop_base.h LOOK prop-specific
  // and survive any prop switch - a table built from that count warns on defines that are always
  // correct, which is the wolf-cry every check here exists to avoid.
  //
  // THE RE-SCOPE DELETES THE TABLE. Ask the selected OS version what it actually reads, and flag
  // what nothing reads. Correct for every version without anyone maintaining a list, covers the
  // JMT wrapper's own defines for free because it is just another header in that tree, and it
  // catches the case `prop-defines-without-prop` structurally cannot: that check abstains the
  // instant any prop include is present, which is every prop SWITCH.
  //
  // THE WHOLE TREE, NOT props/. A value define like VOLUME is read as a plain identifier in C++
  // and never through #ifdef, and MOTION_TIMEOUT is read by prop_base.h rather than any prop.
  // Scanning props alone would flag a pile of perfectly correct core defines.
  //
  // MEASURED BEFORE ANY OF IT WAS BUILT, over 100 real configs against seven installed versions:
  // 60 flagged nothing at all, the median was 0 and the worst was 7. The rule does not cry wolf.
  // That run also turned up FETT263_BM_DISABLE_SAVE sitting in 35 configs that no installed
  // ProffieOS reads, and JMT_DISABLE_COLOR_SAVE in 7.
  //
  // THREE REMEDIES, NOT ONE, BECAUSE THE RIGHT ANSWER IS NOT OURS TO PICK. A name nothing reads
  // may be a typo, a leftover from a prop switch, or something to park while the user decides.
  // Disable uses the same @jmt-disabled marker the preset list uses, so the vocabulary is one
  // vocabulary and the line stays visible and reversible.
  //
  // A SUGGESTION IS NOT ALLOWED TO BE AN ANTONYM, and that is a measurement rather than caution.
  // FETT263_SWING_OFF is edit distance 2 from FETT263_SWING_ON - the opposite meaning - so raw
  // nearest-match would offer the most confidently wrong advice available. The real mistake there
  // is subtler and worth preserving: FETT263_TWIST_OFF exists, so the user generalised a pattern
  // that has no SWING member.
  const _DEFINE_OPPOSITES = [['ON', 'OFF'], ['ENABLE', 'DISABLE'], ['SHOW', 'HIDE'],
                             ['TRUE', 'FALSE'], ['MIN', 'MAX'], ['UP', 'DOWN']];

  // Defines the BUILD consumes rather than the source. ENABLE_WEBUSB is selected in the USB
  // dropdown and reaches the compiler as a flag, so no file in the tree mentions it and a
  // whole-tree read would call a correct config wrong.
  const _BUILD_LEVEL_DEFINES = new Set([
    'ENABLE_WEBUSB', 'ENABLE_SERIAL', 'ENABLE_MASS_STORAGE', 'USB_CLASS',
  ]);

  // Every ProffieOS that has ever existed reads these. If the derivation comes back without them
  // it did not read the tree, and a partial read is how this check turns into a liar - the same
  // sentinel discipline the style-factory check uses, for the same reason.
  const _TREE_SENTINELS = ['NUM_BLADES', 'CONFIG_PRESETS', 'ENABLE_MOTION'];

  function _tokensIn(text) {
    const out = new Set();
    const m = String(text || '').match(/\b[A-Z][A-Z0-9_]{2,}\b/g);
    if (m) for (const t of m) out.add(t);
    return out;
  }

  function _levenshtein(a, b) {
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // True when two names differ only by an opposing word. Compared on the UNDERSCORE SEGMENTS
  // rather than the raw strings, so SWING_ON vs SWING_OFF is caught while a name that merely
  // contains "ON" inside a longer word is not.
  function _areOpposites(a, b) {
    const pa = a.split('_'), pb = b.split('_');
    if (pa.length !== pb.length) return false;
    let differing = null;
    for (let i = 0; i < pa.length; i++) {
      if (pa[i] === pb[i]) continue;
      if (differing !== null) return false;
      differing = [pa[i], pb[i]];
    }
    if (!differing) return false;
    return _DEFINE_OPPOSITES.some(([x, y]) =>
      (differing[0] === x && differing[1] === y) || (differing[0] === y && differing[1] === x));
  }

  function _suggestFor(name, known) {
    let best = null;
    for (const k of known) {
      if (k === name) continue;
      // Only ever suggest within the same family. A FETT263_ name is never repaired to a JMT_ one,
      // and without this the nearest neighbour is frequently from a prop the user is not using.
      const famA = name.split('_')[0], famB = k.split('_')[0];
      if (famA !== famB) continue;
      const d = _levenshtein(name, k);
      if (!best || d < best.d) best = { name: k, d };
    }
    if (!best) return null;
    // A third of the name may differ, capped at 4. Beyond that it is a different define rather
    // than a misspelling of this one, and FETT263_BM_DISABLE_SAVE's nearest neighbour at
    // distance 10 is exactly the case this refuses.
    const budget = Math.min(4, Math.max(2, Math.floor(name.length / 3)));
    if (best.d > budget) return null;
    if (_areOpposites(name, best.name)) return null;
    return best.name;
  }

  // The line a define sits on, in document coordinates, from the ORIGINAL text. Found by
  // scanning rather than carried, because ctx.defines is a set of names with no positions.
  function _defineLines(text, name) {
    const lines = String(text || '').split('\n');
    const re = new RegExp('^[ \\t]*#[ \\t]*define[ \\t]+' + name + '\\b');
    const out = [];
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) out.push({ line: i + 1, text: lines[i] });
    return out;
  }


  // Reading the whole tree would be ~350 file reads on every compile. Asking the search index
  // for ONE name is cheap and answers exactly the right question, so the lookup is per candidate
  // and memoised per version for the life of the session - a second compile of the same config
  // costs nothing.
  // Keyed by version NAME and held for the session. A version's tree does not change under a
  // running app, and the key is the name rather than the contents - so a version replaced in
  // place behind the app would answer from the cache until restart. Accepted: the cost is a
  // stale verdict on a tree nobody swapped, against ~350 file reads on every compile.
  const _nameCache = new Map();   // "version::NAME" -> bool   (:: not a control char: a NUL in source breaks grep and diffs)
  // A hit only counts as EVIDENCE if the file would actually be compiled.
  //
  // TWO EXCLUSIONS, BOTH MEASURED ON A REAL TREE RATHER THAN REASONED ABOUT.
  //
  // config/ IS OURS, NOT THE OS. The app stages the user's own config there as my_config.h at
  // build time, so every define they wrote appears in the tree BECAUSE THEY WROTE IT. Counting
  // it makes the check self-referential: it can barely fire on any config that has been compiled
  // once, and the only reason a misspelling was caught at all was that the staged copy still
  // held the previous spelling. A false negative hiding behind a true positive.
  //
  // props/ IS SCOPED TO THE PROP IN USE. Every prop header sits in that folder whether or not
  // the config includes it, so a define belonging to a prop you switched AWAY from still looks
  // read - which is exactly the case this check exists for. Hits in props/ count only for the
  // prop the config includes and the prop headers that one includes itself: the JMT wrapper
  // pulls in saber_fett263_buttons.h, so selecting the wrapper legitimately reads both, while
  // selecting Fett alone reads only one.
  //
  // Everything else - core, blades, common, styles, sound - always counts.
  function _hitCounts(relPath, allowedProps) {
    const p = String(relPath || '').replace(/\\/g, '/');
    if (/(^|\/)config\//i.test(p)) return false;
    const m = p.match(/(^|\/)props\/([^/]+)$/i);
    if (!m) return true;
    // prop_base.h IS NOT A PROP. Every prop is a PropBase subclass, so its defines survive any
    // switch and are read whatever the config includes. The original table-based design counted
    // its 13 defines as prop-specific because each is read by exactly one file, and warning on
    // them is the false positive that design died on. Allowed unconditionally rather than left
    // to the include walk, which would only find it when a prop spells the include out.
    if (/^prop_base\.h$/i.test(m[2])) return true;
    return allowedProps.has(m[2].toLowerCase());
  }

  // The props that are actually COMPILED: the one the config includes, and the prop headers it
  // includes in turn. Reuses the walk the voicepack check already does rather than running a
  // second one - two mechanisms for "which props are in play" would have to be kept in agreement
  // forever, and this one already handles three things a fresh walk gets wrong.
  //
  //   · NO PROP INCLUDE STILL MEANS A PROP. ProffieOS.ino falls back to props/saber.h, so an
  //     empty CONFIG_PROP is saber.h rather than nothing. Treating it as nothing would orphan
  //     every prop define in a default-prop config.
  //   · LIVE TEXT ONLY. An include inside an #ifdef the user has not defined is not compiled,
  //     and vpkLiveText evaluates those against ctx.defines instead of reading raw text.
  //   · BOUNDED, so a cycle or a deep chain cannot turn one question into a tree read.
  const _allowedPropsCache = new Map();
  async function _allowedProps(ctx) {
    const roots = vpkPropIncludes(ctx.text).map(p => p.split('/').pop()).filter(Boolean);
    const key = ctx.versionName + '::' + (roots.join(',') || 'default');
    if (_allowedPropsCache.has(key)) return _allowedPropsCache.get(key);

    let queue = roots.slice();
    if (!queue.length) queue = ['saber.h'];
    const seen = new Set();
    while (queue.length && seen.size < 16) {
      const file = queue.shift();
      if (!file || seen.has(file)) continue;
      seen.add(file);
      let res = null;
      try { res = await ctx.readVersionFile(ctx.versionName, 'ProffieOS/props/' + file); } catch {}
      if (!res || !res.ok || !res.content) continue;
      for (const i of vpkLiveText(res.content, ctx.defines).matchAll(/#\s*include\s+"([^"]+)"/g)) {
        const inc = i[1];
        if (!inc.includes('/') || /(^|\/)props\//.test(inc)) queue.push(inc.split('/').pop());
      }
    }
    const allowed = new Set([...seen].map(f => f.toLowerCase()));
    _allowedPropsCache.set(key, allowed);
    return allowed;
  }

  async function _treeHasName(ctx, name) {
    const allowed = await _allowedProps(ctx);
    // THE NAME INDEX FIRST [B-584]. Autocomplete offers from the same index, so the two answer
    // "does this OS read it" identically: autocomplete can never offer a name this check then
    // flags. Whole-word and case-sensitive, where the search below is a substring match.
    const index = await _treeIndex(ctx);
    if (index) {
      const e = index.names[name];
      return !!(e && e.f.some(i => _hitCounts(index.files[i], allowed)));
    }
    // The allowed set is part of the answer, so it is part of the key. Switching props must not
    // read back a verdict computed under the previous one.
    const key = ctx.versionName + '::' + [...allowed].sort().join(',') + '::' + name;
    if (_nameCache.has(key)) return _nameCache.get(key);
    let found = false;
    try {
      const hits = await ctx.searchVersionFiles(ctx.versionName, name);
      if (hits && hits.ok && Array.isArray(hits.results)) {
        found = hits.results.some(r => r && r.type !== 'dir' && _hitCounts(r.path, allowed));
      }
    } catch { found = false; }
    _nameCache.set(key, found);
    return found;
  }

  // The selected version's name index, or null when the context has none (tests, callers that
  // do not wire it) or it could not be built - then the search above answers instead.
  async function _treeIndex(ctx) {
    if (!ctx.versionName || typeof ctx.versionNameIndex !== 'function') return null;
    let index = null;
    try { index = await ctx.versionNameIndex(ctx.versionName); } catch { index = null; }
    return index && index.names && Array.isArray(index.files) ? index : null;
  }

  // What the selected OS and prop read, for the editor's #define autocomplete [B-584]. Same index
  // and same _hitCounts scoping as the check, so the list and the check cannot disagree.
  // [{ name, cond, files }] where cond = tested in a preprocessor condition; null = cannot tell.
  async function treeNames(ctx) {
    const index = await _treeIndex(ctx);
    if (!index) return null;
    const allowed = await _allowedProps(ctx);
    const out = [];
    for (const name of Object.keys(index.names)) {
      const e = index.names[name];
      const files = e.f.map(i => index.files[i]).filter(p => _hitCounts(p, allowed));
      if (files.length) out.push({ name, cond: !!e.c, files });
    }
    return out;
  }

  // THE SEARCH HAS TO PROVE ITSELF BEFORE ITS SILENCE MEANS ANYTHING. A search that is broken,
  // unavailable, or pointed at an unpacked version returns nothing for everything, and this check
  // would then report every define in the config as dead - the most destructive false positive it
  // could produce, with Delete sitting next to it. Same sentinel discipline the style-factory
  // check uses: no sentinel, no verdict.
  async function _searchIsTrustworthy(ctx) {
    for (const s of _TREE_SENTINELS) {
      if (await _treeHasName(ctx, s)) return true;
    }
    return false;
  }

  // Real names sharing an orphan's family, for the suggestion. Only ever reached when there IS an
  // orphan, which the corpus says is rare, so the cost rides on the uncommon path.
  const _familyCache = new Map();
  async function _familyNames(ctx, prefix) {
    const key = ctx.versionName + '::' + prefix + '::' + ctx.cleanText.length;
    if (_familyCache.has(key)) return _familyCache.get(key);
    const names = new Set();
    try {
      const hits = await ctx.searchVersionFiles(ctx.versionName, prefix + '_');
      if (hits && hits.ok && Array.isArray(hits.results)) {
        const allowed = await _allowedProps(ctx);
        for (const r of hits.results.slice(0, 40)) {
          if (r.type !== 'file' || !/\.(h|hpp|ino|cpp|cc|c)$/i.test(r.path || '')) continue;
          // Same scoping as the lookup: suggesting a name from a prop the config does not
          // include would answer "nothing reads this" with "use this other thing nothing reads".
          if (!_hitCounts(r.path, allowed)) continue;
          const f = await ctx.readVersionFile(ctx.versionName, r.path);
          if (!f || !f.ok || !f.content) continue;
          const m = f.content.match(new RegExp('\\b' + prefix + '_[A-Z0-9_]+\\b', 'g'));
          if (m) for (const n of m) names.add(n);
        }
      }
    } catch { /* an empty family simply yields no suggestion */ }
    _familyCache.set(key, names);
    return names;
  }

  preflight.register({
    id: 'define-nothing-reads',
    severity: 'warn',
    title: 'Defines nothing reads',
    async run(ctx) {
      if (!ctx.versionName) return null;
      const clean = ctx.cleanText;
      if (!clean) return null;
      // Same abstention the prop check makes: a CONFIG_TOP block pasted on a forum is not a
      // config, and judging one is how a rule is right about the text and wrong about what it is.
      if (!preflight.sectionBody(clean, 'CONFIG_PRESETS')) {
        return { unsure: 'this looks like a config fragment, not a whole config' };
      }

      if (!(await _searchIsTrustworthy(ctx))) {
        return { unsure: 'could not read the selected ProffieOS version' };
      }

      // The prop the judgement was made against. ProffieOS.ino falls back to props/saber.h when a
      // config includes none, so there is always one to name - and naming it is the point: the
      // answer is only true for this version WITH this prop.
      const _propFile = (vpkPropIncludes(ctx.text).map(p => p.split('/').pop())
        .filter(f => f && !/^my_config\.h$/i.test(f))[0])
        || 'saber.h';

      const ownedByPropCard = new Set(_noPropIncluded(clean)
        ? (await _propGroups(ctx)).flatMap(g => g.hits) : []);
      const orphans = (await _orphanDefines(ctx)).filter(name => !ownedByPropCard.has(name));
      if (!orphans.length) return null;

      // ONE MESSAGE, A LIST UNDERNEATH - the shape the export-conflict dialog uses. The
      // explanation is identical for every orphan, so it is said once above the list and each
      // row carries only what differs: the name, where it is, and its own remedies.
      //
      // Splitting this into one finding per define said the same sentence five times and buried
      // the single fact they share.
      const rows = [];
      for (const name of orphans) rows.push(await _defineRow(ctx, name));

      const n = rows.length;
      return {
        findings: [{
          kind: 'orphan-defines',
          // STATE THE FACT AND NAME WHAT IT WAS JUDGED AGAINST. No claim about how they got
          // here: the user may have one OS version, no prop of their own, and may never have
          // changed anything - a config copied from a forum arrives exactly like this.
          title: `${n} define${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} not used by `
               + `${ctx.versionName} with ${_propFile}.`,
          // STATE THE MECHANISM, NOT THE CONSEQUENCE. What the check knows is that the name
          // appears nowhere in the source that will compile. What that MEANS splits three ways
          // and it cannot tell which: a misspelling leaves the define the user meant missing, so
          // a feature they are counting on is off; a version or prop skew makes it inactive here
          // and correct elsewhere; a leftover is harmless. One reading per remedy, which is why
          // the row offers the choices and the sentence picks none.
          //
          // AND IT MUST NOT PROMISE THE BUILD SUCCEEDS. A define that reaches nothing cannot
          // break a build by itself, but a MISSPELLED one is a prerequisite that is now absent,
          // and prerequisites are enforced with #error: jmt_fett263_wrapper.h:91 stops the build
          // when JMT_SWING_ON_BLOCK has no blade detect method. Misspell BLADE_DETECT_PIN there
          // and the compile fails. The promise was reachable and false.
          detail: `${n === 1 ? 'This will be ignored. If it is a misspelling' : 'These will be ignored. If one is a misspelling'}, `
                + `the define you meant is missing, which can change how the saber behaves or stop `
                + `the build where something else requires it.`,
          rows,
        }],
      };

    },
  });

  // ── A style factory name that does not exist ─────────────────────────────
  //
  // [B-324]. A misspelled wrapper — `StyleRainBowPtr` with a capital B — is a hard
  // compile error that costs a full build to discover. AND PROFFIEOS'S OWN
  // DOCUMENTATION CONTAINS THAT EXACT TYPO: config/common_presets.h line 16 reads
  // `//   StyleRainBowPtr<out millis, in millis>()`. Anyone copying that comment
  // out of the OS source gets a config that cannot compile, from the most
  // trustworthy place they could have got it.
  //
  // THE LIST IS DERIVED, NEVER REMEMBERED, and that is the whole design. [B-321]
  // deliberately deleted a hardcoded list of style NAMES because preserving the
  // user's text with a stale list rewrites valid code. Validating with a stale list
  // is worse: it calls working code broken, which is the false positive that
  // teaches people to ignore every check we have.
  // MEASURED 2026-09-12, AND IT CORRECTED THE ENTRY ON FIRST RUN: the eight
  // factories are stable across 7.x and 8.x, but ProffieOS 6.9 has SEVEN — no
  // ChargingStylePtr. A hardcoded eight would have told a 6.9 user their config was
  // fine when it genuinely will not build.
  //
  // SCOPE IS THE OUTERMOST FACTORY ONLY. `StylePtr<InOutHelper<Red>>()` is
  // checked as `StylePtr`; InOutHelper and everything under it is NOT, because
  // there is no authoritative dictionary for style classes and inventing one is
  // exactly what [B-321] removed. A check without a dictionary is [B-012]'s
  // problem, deliberately solved a different way.
  //
  // AND THE USER'S OWN SIDE COUNTS. A config or the Style Library can define its
  // own StyleAllocator factory; warning on someone's own helper is the same false
  // positive wearing a different hat. Both sources, one union.

  // A function DEFINITION at column zero. The variable declarations in the same
  // headers (`  StyleAllocator style_allocator;`, `    StyleAllocator allocator =
  // nullptr;`) are indented and have no `(`, so they never match — verified
  // against the real trees rather than assumed.
  const STYLE_FACTORY_RE = /^StyleAllocator\s+([A-Za-z_]\w*)\s*\(/gm;

  function factoriesIn(text) {
    const out = new Set();
    if (!text) return out;
    STYLE_FACTORY_RE.lastIndex = 0;
    let m;
    while ((m = STYLE_FACTORY_RE.exec(text)) !== null) out.add(m[1]);
    return out;
  }

  // DERIVED EVERY COMPILE, NOT CACHED, AND THAT IS DELIBERATE.
  //
  // A per-session cache was written first and removed the same hour. It bought
  // 117 ms — measured against the real 8.10 tree, 398 files walked — on an action
  // whose next step takes minutes. Against that it introduced a staleness window
  // where adding a factory to an OS tree with the app open would have the check
  // flagging a brand-new, perfectly valid name until a restart. That is precisely
  // the false positive this check exists to avoid, reintroduced by the
  // optimisation. Editing an OS tree is not hypothetical here; the JMT wrapper
  // lives in one.
  //
  // Guarding a stale read would have been the wrong answer to a problem that can
  // simply not exist.
  async function osFactories(ctx) {
    if (!ctx.versionName) return null;

    let found = null;
    try {
      const hits = await ctx.searchVersionFiles(ctx.versionName, 'StyleAllocator');
      if (hits && hits.ok && Array.isArray(hits.results)) {
        const names = new Set();
        for (const r of hits.results) {
          // NOT JUST .h. Measured against the real 8.10 tree: 11 files mention
          // StyleAllocator and only 5 are headers — the rest are ProffieOS.ino and
          // four tests.cpp. None of them DEFINES a factory today, so a .h-only
          // filter would have worked and the assumption would have been invisible.
          // It fails in the expensive direction though: an OS that ever defines one
          // elsewhere would have us calling a valid name unknown. Six extra reads,
          // once per version, buys the assumption away.
          if (r.type !== 'file' || !/\.(h|hpp|ino|cpp|cc|c)$/i.test(r.path || '')) continue;
          const f = await ctx.readVersionFile(ctx.versionName, r.path);
          if (f && f.ok && f.content) for (const n of factoriesIn(f.content)) names.add(n);
        }
        // THE DERIVATION HAS TO PROVE ITSELF, because a PARTIAL read is the way
        // this check turns into a liar. An empty result is obviously a failed read.
        // A result missing most of the tree is not obvious at all, and would have us
        // calling perfectly good names unknown.
        //
        // StylePtr IS THE SENTINEL, and it is a fact rather than a threshold.
        // Every ProffieOS that has ever existed defines StylePtr — it is the one
        // every config uses. Verified across all seven installed trees, 6.9 through
        // 8.10. So a derivation that does not contain it did not read the tree,
        // whatever else it found, and a count-based floor would have been an
        // arbitrary number pretending to be a rule.
        //
        // This is what makes the check maintainable without a list to keep current:
        // if a future OS declares factories some other way, we do not silently start
        // flagging valid names — we go quiet and say we cannot tell.
        if (names.size && names.has('StylePtr')) found = names;
      }
    } catch { found = null; }

    return found;
  }

  // presetParser is a global in the app and a module under node.
  function _parser() {
    if (root.presetParser) return root.presetParser;
    return require('./presetParser.js');
  }

  // A preset's raw text starts at some point in the document; the parser gives us
  // its START LINE but offsets within it are entry-relative. Find the entry's own
  // offset by searching from the start of its line, then convert.
  // Returns null rather than a guess when the entry cannot be located — a fix
  // that writes to the wrong place is worse than no fix at all.
  function _lineColOf(fullText, preset, offsetInRaw) {
    const lines = String(fullText).split('\n');
    if (!(preset.startLine >= 1) || preset.startLine > lines.length) return null;
    let base = 0;
    for (let i = 0; i < preset.startLine - 1; i++) base += lines[i].length + 1;
    const at = fullText.indexOf(preset.raw, base);
    if (at < 0) return null;
    const abs = at + offsetInRaw;
    let line = 1, col = 0, seen = 0;
    for (let i = 0; i < lines.length; i++) {
      if (seen + lines[i].length >= abs) { line = i + 1; col = abs - seen; break; }
      seen += lines[i].length + 1;
    }
    return { line, col };
  }

  // Levenshtein, capped. Only used to SUGGEST, never to decide.
  function _distance(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 3) return 99;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  preflight.register({
    id: 'unknown-style-factory',
    severity: 'block',
    title: 'Unknown style factory',
    async run(ctx) {
      if (!ctx.parsed) return null;

      // What the config actually uses: the leading identifier of each style slot.
      // Read from the slot boundaries the parser already found, so there is one
      // definition of "where a style expression is" rather than two.
      const used = new Map();               // name -> [preset labels]
      for (const arr of (ctx.parsed.arrays || [])) {
        for (const p of (arr.presets || [])) {
          if (p.parseError || !p.raw) continue;
          let slots = [];
          try { slots = root.presetParser ? root.presetParser.extractStyleSlots(p.raw) : []; }
          catch { slots = []; }
          if (!slots.length && typeof require === 'function') {
            try { slots = require('./presetParser.js').extractStyleSlots(p.raw); } catch { slots = []; }
          }
          for (const s of slots) {
            const txt = p.raw.slice(s.startOffset, s.endOffset).trim();
            // `&style_name` is a reference to a style declared elsewhere, not a
            // factory call. Different thing, no dictionary, not ours.
            const name = (txt.match(/^([A-Za-z_]\w*)\s*[<(]/) || [])[1];
            if (!name) continue;
            const label = (p.displayName || '').trim() || `Preset ${p.index}`;
            if (!used.has(name)) used.set(name, []);
            if (!used.get(name).includes(label)) used.get(name).push(label);
          }
        }
      }
      if (!used.size) return null;

      const fromOs = await osFactories(ctx);
      if (!fromOs) {
        // No version selected, or its tree could not be read. We have no dictionary,
        // so every name here is unjudgeable — exactly what the third answer is for.
        return { unsure: 'the selected ProffieOS version could not be read' };
      }

      // THE OS IS THE ONLY SOURCE, AND A CONFIG CANNOT ADD TO IT.
      //
      // An earlier build also read factories out of the config and the Style
      // Library, on the entry's reasoning that a user "can define its own
      // StyleAllocator factory" and warning on their own helper would be a false
      // positive. That is wrong, and the correction is a ProffieOS fact rather
      // than a preference (2026-09-12): **a config cannot carry a function
      // definition at all.** ProffieOS.ino `#include`s the config SEVEN times
      // under different CONFIG_* guards — and CONFIG_PROP twice — so a
      // `StyleAllocator Foo() {…}` anywhere in it is a redefinition error. The
      // Style Library cannot either: it holds `using X = …` type aliases, which
      // are types and can never be a factory. Measured: 0 of 173 real configs
      // define one, and a 3,176-line real Style Library has 141 aliases and none.
      //
      // AND THE OLD BEHAVIOUR WAS NOT MERELY DEAD, IT WAS A SUPPRESSION PATH.
      // Reading a name out of a config that has one would accept a factory
      // defined by text that itself cannot build — so we would go SILENT on a
      // broken config, which is the opposite of protecting anyone. Defensive code
      // for an impossible input defends nothing and hides something.
      const valid = fromOs;

      const findings = [];
      for (const [name, presets] of used) {
        if (valid.has(name)) continue;
        let best = null, bestD = 99;
        for (const v of valid) {
          const d = _distance(name, v);
          if (d < bestD) { bestD = d; best = v; }
        }
        // A suggestion is only offered when it is close enough to be a typo rather
        // than a different word. Two edits on a name this long is still a typo;
        // three is a guess.
        const suggestion = (best && bestD <= 2) ? best : null;
        const one = presets.length === 1;

        // A FIX IS OFFERED ONLY ON A SINGLE-CHARACTER MISS, and that narrowness is
        // the whole justification. This is the one check with an AUTHORITATIVE
        // dictionary — the names came out of the OS the user selected — so a rename
        // to a name one edit away is about as safe as the voicepack's `;common`.
        // Two edits away is still worth SUGGESTING in words and not worth doing to
        // someone's config on their behalf; that is a guess wearing a button.
        // (A first build offered no fix at all, on the grounds that a rename is a
        // decision. The better read: it is only a decision while we are unsure,
        // and at distance 1 against an authoritative list we are not.)
        const fixable = suggestion && bestD === 1;

        findings.push({
          title: `There is no style called ${name}.`,
          detail: (suggestion ? `Did you mean ${suggestion}? ` : '')
                + `${one ? 'This preset uses' : `${presets.length} presets use`} it, and the build `
                + `will stop on it.`
                + (suggestion === null
                    ? ` Your ProffieOS version provides: ${[...fromOs].sort().join(', ')}.`
                    : ''),
          items: presets,
          ..._presetList(ctx, presets),
          fix: fixable ? {
            label: `Change to ${suggestion}`,
            // Rewrites the NAME only, never the template arguments or the call, and
            // only where it appears as a style factory. Computed against the
            // document as it is now, and applied as one atomic edit — the caller
            // re-derives everything afterwards, so nothing here can go stale.
            plan(c) {
              const edits = [];
              for (const arr of (c.parsed?.arrays || [])) {
                for (const p of (arr.presets || [])) {
                  if (p.parseError || !p.raw || !p.startLine) continue;
                  let slots = [];
                  try { slots = _parser().extractStyleSlots(p.raw); } catch { slots = []; }
                  for (const s of slots) {
                    const txt = p.raw.slice(s.startOffset, s.endOffset);
                    const lead = txt.match(/^(\s*)([A-Za-z_]\w*)/);
                    if (!lead || lead[2] !== name) continue;
                    // Offsets are relative to the preset entry, whose own start we
                    // know in document coordinates; converting once here keeps the
                    // parser's boundaries as the single source of truth.
                    const abs = _lineColOf(c.text, p, s.startOffset + lead[1].length);
                    if (!abs) continue;
                    edits.push({
                      startLine: abs.line, startCol: abs.col,
                      endLine:   abs.line, endCol:   abs.col + name.length,
                      text: suggestion,
                    });
                  }
                }
              }
              return edits;
            },
          } : null,
        });
      }
      return findings.length ? { findings } : null;
    },
  });

  // ── A style the Style Library renamed ────────────────────────────────────
  //
  // [B-656]. A preset still naming a style by a name the Style Library has since renamed: the
  // library writes `// formerly: Old` on the renamed style, and Old no longer exists, so the
  // compile stops with "not declared in this scope" at the preset. The config-open review offers
  // the new name, and a user may decline it (his rule, 2026-11-09: "we wouldn't force a user to
  // make a decision here"); this is the second chance, "without closing and reopening".
  //
  // ALIASES ONLY (his call, 2026-11-09). A name is flagged only when the library itself records it
  // as a former name AND no style, in the library or the config, carries it now. An unknown name
  // that is not a former one could be defined somewhere this check cannot see, so it is left alone.
  // A former name two styles once had is named without a fix button: picking one would be a guess.

  // `// formerly: A, B` lines in the gap above each `using NAME =`, read the way the Style Library
  // writes them. Returns { current: Set, owners: Map(former -> [current names]) }.
  function _libraryFormerNames(libText) {
    const current = new Set();
    const owners = new Map();
    let pending = [];
    for (const line of String(libText || '').split('\n')) {
      const f = line.match(/^\s*\/\/\s*formerly:\s*(.*)$/);
      if (f) { pending = f[1].split(',').map(s => s.trim()).filter(Boolean); continue; }
      const u = line.match(/^\s*using\s+([A-Za-z_]\w*)\s*=/);
      if (u) {
        current.add(u[1]);
        for (const old of pending) {
          if (!owners.has(old)) owners.set(old, []);
          if (!owners.get(old).includes(u[1])) owners.get(old).push(u[1]);
        }
        pending = [];
      }
    }
    return { current, owners };
  }

  preflight.register({
    id: 'renamed-library-style',
    severity: 'block',
    title: 'A style was renamed in your Style Library',
    async run(ctx) {
      if (!ctx.parsed || typeof ctx.readStylesLibrary !== 'function') return null;
      let lib = null;
      try { lib = await ctx.readStylesLibrary(); } catch { lib = null; }
      if (!lib) return null;
      const { current, owners } = _libraryFormerNames(lib);
      if (!owners.size) return null;
      // A style the config defines itself is that style, whatever the library once called it.
      for (const m of String(ctx.cleanText || '').matchAll(/^\s*using\s+([A-Za-z_]\w*)\s*=/gm)) current.add(m[1]);

      const used = new Map();   // former name -> [preset labels]
      for (const arr of (ctx.parsed.arrays || [])) {
        for (const p of (arr.presets || [])) {
          if (p.parseError || !p.raw) continue;
          let slots = [];
          try { slots = _parser().extractStyleSlots(p.raw); } catch { slots = []; }
          for (const s of slots) {
            const txt = p.raw.slice(s.startOffset, s.endOffset);
            for (const m of txt.matchAll(/[A-Za-z_]\w*/g)) {
              if (!owners.has(m[0]) || current.has(m[0])) continue;
              const label = (p.displayName || '').trim() || `Preset ${p.index}`;
              if (!used.has(m[0])) used.set(m[0], []);
              if (!used.get(m[0]).includes(label)) used.get(m[0]).push(label);
            }
          }
        }
      }
      if (!used.size) return null;

      const findings = [];
      for (const [old, presets] of used) {
        const now = owners.get(old);
        const one = presets.length === 1;
        const single = now.length === 1 ? now[0] : null;
        findings.push({
          title: single
            ? `There is no style called ${old}. Your Style Library renamed it to ${single}.`
            : `There is no style called ${old}. Your Style Library renamed it, and ${now.length} styles once had that name: ${now.join(', ')}.`,
          detail: `${one ? 'This preset uses' : `${presets.length} presets use`} the old name, and the build will stop on it.`
            + (single ? '' : ' Change it to the one you meant.'),
          items: presets,
          ..._presetList(ctx, presets),
          fix: single ? {
            label: `Change to ${single}`,
            // Every whole-word use of the old name inside a preset's style slots, wrappers
            // included (PixelSwitchWrapper<Old> as well as StylePtr<Old>). Computed against the
            // document as it is now and applied as one edit, like the factory fix above.
            plan(c) {
              const edits = [];
              for (const arr of (c.parsed?.arrays || [])) {
                for (const p of (arr.presets || [])) {
                  if (p.parseError || !p.raw || !p.startLine) continue;
                  let slots = [];
                  try { slots = _parser().extractStyleSlots(p.raw); } catch { slots = []; }
                  for (const s of slots) {
                    const txt = p.raw.slice(s.startOffset, s.endOffset);
                    for (const m of txt.matchAll(new RegExp(`\\b${old}\\b`, 'g'))) {
                      const abs = _lineColOf(c.text, p, s.startOffset + m.index);
                      if (!abs) continue;
                      edits.push({ startLine: abs.line, startCol: abs.col, endLine: abs.line, endCol: abs.col + old.length, text: single });
                    }
                  }
                }
              }
              return edits;
            },
          } : null,
        });
      }
      return { findings };
    },
  });

  // ── Delimiters that do not balance ───────────────────────────────────────
  //
  // [B-030] lint 3. A missing comma or an unclosed brace in a preset, which the
  // compiler reports somewhere else entirely. The case that produced this:
  // LiamSaber.h, 2026-07-24 — gcc said `expected '}' before 'StylePtr'` and the
  // real fault was a missing `,` on the PREVIOUS line. A 1,249-view Crucible
  // thread has NoSloppy diagnosing the same family by eye: "Your first preset is
  // missing a closing brace }".
  //
  // THE FIRST COMPILER ERROR IS THE HONEST ONE. Everything after it is the
  // parser guessing once it has lost its place, which is why those threads are
  // full of people reading the LAST error and chasing the wrong thing. A check
  // that runs before the compiler avoids the whole class.
  //
  // THIS WAS BUILT ONCE AND LOST. `scratchpad/balance-check.js`, written
  // 2026-07-24 into a session temp directory and swept; FOUR documents went on
  // citing it as a completed asset. The spec survived in crucible/error-corpus.md
  // and is what this is rebuilt from. It lives in the repo now.
  //
  // SCOPE IS THE PRESET ARRAY, NOT THE FILE. A config is C++ and can legally
  // contain all sorts of bracket shapes we do not model — but a `Preset x[] = {…}`
  // body is ours, the parser already finds it, and an imbalance inside it is a
  // certain compile failure. Checking the whole file would mean answering for
  // every construct anyone ever writes.

  // Strip strings and comments so a brace inside "text" or a `//` note cannot
  // affect the count. Config-specific: no regex literals to worry about.
  function _balanceStrip(src) {
    let out = '', i = 0; const n = src.length;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
        i += 2; continue;
      }
      if (c === '"' || c === "'") {
        const q = c; i++;
        while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
        i++;
        out += '""';            // keep a token so structure survives
        continue;
      }
      out += src[i++];
    }
    return out;
  }

  const _lineOf = (text, at) => String(text).slice(0, at).split('\n').length;

  // Where an #ifdef is: its line in the config, or the Style Library when the config has none.
  function _ifdefWhere(ctx, guard) {
    const i = ctx.cleanText.split('\n').findIndex(l => new RegExp(`^\\s*#\\s*ifdef\\s+${guard}\\b`).test(l));
    return i < 0 ? ' in your Style Library' : ` on line ${i + 1}`;
  }

  // Where a preset's raw text sits in the document. Two presets can be identical, so the line
  // the parser recorded picks the right one.
  function _rawOffset(text, p) {
    let at = -1, first = -1;
    while ((at = String(text).indexOf(p.raw, at + 1)) >= 0) {
      if (first < 0) first = at;
      if (_lineOf(text, at) === p.startLine) return at;
    }
    return first;
  }

  // Where something is, as it reads in a title.
  function _onLines(lines) {
    if (lines.length === 1) return `line ${lines[0]}`;
    if (lines.length > 6) return `${lines.length} lines, starting at line ${lines[0]}`;
    return `lines ${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]}`;
  }

  // A zero-width edit at an absolute offset.
  function _insertAt(text, abs, insert) {
    const before = String(text).slice(0, abs);
    const line = before.split('\n').length;
    const col = abs - (before.lastIndexOf('\n') + 1);
    return { startLine: line, startCol: col, endLine: line, endCol: col, text: insert };
  }

  // Comments dropped; a string, a word, a preprocessor line or a single character each make
  // one token carrying its offsets.
  function _codeTokens(src) {
    const toks = [];
    let i = 0, lineStart = true;
    const n = src.length;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '\n') { lineStart = true; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; continue;
      }
      const start = i;
      if (c === '#' && lineStart) {
        while (i < n && src[i] !== '\n') i++;
        toks.push({ kind: 'pp', text: src.slice(start, i), start, end: i });
      } else if (c === '"') {
        i++;
        while (i < n && src[i] !== '"' && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
        i++;
        toks.push({ kind: 'str', text: src.slice(start, i), start, end: i });
      } else if (/[A-Za-z_0-9]/.test(c)) {
        while (i < n && /[A-Za-z_0-9.]/.test(src[i])) i++;
        toks.push({ kind: 'word', text: src.slice(start, i), start, end: i });
      } else {
        i++;
        toks.push({ kind: 'ch', text: c, start, end: i });
      }
      lineStart = false;
    }
    return toks;
  }

  // The first place a preset's parts run together: { at, after }, or null. A preset is
  // font, track, styles, name, so a string or a closed style at the top level has to be
  // followed by a comma or the end of the preset.
  //
  // "a" "b" is legal C++ and joins into one string, so two strings together only count when
  // they sit in the font and the next part is not the track. A preprocessor line can hide
  // part of a preset, so a preset with one in it says nothing.
  function _presetCommaGap(raw) {
    let toks = _codeTokens(String(raw || ''));
    if (toks.some(t => t.kind === 'pp')) return null;
    if (toks[0]?.text === '{') toks = toks.slice(1, -1);

    const label = (field) => (field === 0 ? 'its font' : field === 1 ? 'its track' : `style ${field - 1}`);
    let depth = 0, angle = 0, field = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i], next = toks[i + 1];
      if (t.kind === 'ch' && '({['.includes(t.text)) depth++;
      if (t.kind === 'ch' && ')}]'.includes(t.text)) depth--;
      if (depth !== 0) continue;
      if (t.kind === 'ch' && t.text === '<') angle++;
      if (t.kind === 'ch' && t.text === '>') angle--;
      if (t.kind === 'ch' && t.text === ',') { if (angle === 0) field++; continue; }
      if (!next || (next.kind === 'ch' && (next.text === ',' || next.text === '}'))) continue;
      if (t.kind !== 'str' && !(t.kind === 'ch' && t.text === ')')) continue;
      if (t.kind === 'str' && next.kind === 'str') {
        if (field !== 0) continue;
        const comma = toks.findIndex((x, j) => j > i && x.kind === 'ch' && x.text === ',');
        if (comma < 0 || toks[comma + 1]?.kind === 'str') continue;
        return { at: t.end, after: label(field) };
      }
      if (next.kind === 'str' || next.kind === 'word' || next.text === '&') {
        return { at: t.end, after: label(field) };
      }
    }
    return null;
  }

  // Two presets with nothing between them, and a list that does not end in };
  function _arrayCommaGaps(text) {
    const toks = _codeTokens(String(text || ''));
    const gaps = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].text !== 'Preset' || toks[i + 1]?.kind !== 'word' || toks[i + 2]?.text !== '[') continue;
      const open = toks.findIndex((t, j) => j > i && t.text === '{');
      if (open < 0) break;
      let depth = 0, index = 0;
      for (let j = open; j < toks.length; j++) {
        const t = toks[j];
        if (t.kind === 'pp') { if (depth === 1) break; continue; }
        if (t.kind !== 'ch') continue;
        if (t.text === '{') depth++;
        if (t.text === '}') {
          depth--;
          if (depth === 0) {
            const after = toks[j + 1];
            if (after && !(after.kind === 'ch' && after.text === ';')) {
              gaps.push({ array: toks[i + 1].text, end: after.kind === 'ch' ? 'early' : 'semicolon', at: t.end });
            }
            break;
          }
          if (depth === 1) {
            if (toks[j + 1]?.kind === 'ch' && toks[j + 1].text === '{') {
              gaps.push({ array: toks[i + 1].text, index, at: t.end });
            }
            index++;
          }
        }
      }
    }
    return gaps;
  }

  // One row per BladeConfig entry: { line, blades }. blades is null when the row cannot be
  // counted. Commas inside <> and () belong to a blade, so only those at the row's own level
  // divide it.
  function _bladeConfigRows(text) {
    const toks = _codeTokens(String(text || ''));
    const rows = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].text !== 'BladeConfig' || toks[i + 1]?.kind !== 'word' || toks[i + 2]?.text !== '[') continue;
      const open = toks.findIndex((t, j) => j > i && t.text === '{');
      if (open < 0) break;
      let depth = 0;
      for (let j = open; j < toks.length; j++) {
        const t = toks[j];
        if (t.kind !== 'ch') continue;
        if (t.text === '{') {
          depth++;
          if (depth === 2) {
            const row = _readBladeRow(toks, j);
            rows.push({ line: _lineOf(text, t.start), blades: row.blades });
            j = row.end;
            depth--;
          }
        } else if (t.text === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
    }
    return rows;
  }

  function _readBladeRow(toks, open) {
    const args = [[]];
    let brace = 0, paren = 0, angle = 0, j = open + 1, bad = false;
    for (; j < toks.length; j++) {
      const t = toks[j];
      if (t.kind === 'pp') bad = true;
      if (t.kind === 'ch') {
        if (t.text === '}' && brace === 0) break;
        if (t.text === '{') brace++;
        if (t.text === '}') brace--;
        if (t.text === '(') paren++;
        if (t.text === ')') paren--;
        if (t.text === '<') angle++;
        if (t.text === '>') angle--;
        if (t.text === ',' && !brace && !paren && !angle) { args.push([]); continue; }
      }
      args[args.length - 1].push(t);
    }
    const end = args.findIndex(a => a[0]?.text === 'CONFIGARRAY');
    if (bad || end < 1) return { blades: null, end: j };
    const blades = args.slice(1, end);
    return { blades: blades.every(a => a.some(t => t.text === '(')) ? blades.length : null, end: j };
  }

  // Offsets of curly quotes outside comments and strings. A string ends at its closing quote
  // or the end of the line, so one stray quote cannot hide the rest of the file.
  function _curlyQuotes(src) {
    const hits = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; continue;
      }
      if (c === '"') {
        i++;
        while (i < n && src[i] !== '"' && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
        i++; continue;
      }
      if ('\u201C\u201D\u201E\u201F\u2018\u2019'.includes(c)) hits.push(i);
      i++;
    }
    return hits;
  }

  preflight.register({
    id: 'preset-delimiters',
    severity: 'block',
    title: 'Preset delimiters do not balance',
    run(ctx) {
      if (!ctx.parsed) return null;
      const findings = [];

      // ── (a) AN ARRAY WHOSE BRACES NEVER CLOSE ─────────────────────────────
      // NoSloppy's "your first preset is missing a closing brace", invisible to a
      // per-preset check because there ARE no presets — the parser cannot read the
      // array at all.
      //
      // A FIRST BUILD INFERRED THIS FROM A COUNT MISMATCH — more `Preset x[] = {`
      // in the text than parsed arrays — and that was an inference wearing the
      // clothes of an observation. It fired on 11 wild configs, and the first one
      // examined (7230_1.h) turned out to be a forum paste: a bare
      // `Preset presets[] = {` at line 1 followed by a real config at line 65. Two
      // declarations, one parsed, mismatch, wrong story. A mismatch has several
      // causes and "missing closing brace" is only one of them.
      //
      // So walk the braces and SEE whether the group closes. That is observable,
      // names the line, and cannot be confused with a declaration the parser
      // skipped for some other reason.
      {
        const clean = _balanceStrip(ctx.text);
        const re = /\bPreset\s+[\w-]*\s*\[\s*\]\s*=\s*\{/g;
        let m;
        const unclosed = [];
        while ((m = re.exec(clean)) !== null) {
          let depth = 0, closed = false;
          for (let i = m.index + m[0].length - 1; i < clean.length; i++) {
            const ch = clean[i];
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { closed = true; break; } }
          }
          if (closed) continue;
          unclosed.push(clean.slice(0, m.index).split('\n').length);
        }
        if (unclosed.length) {
          const one = unclosed.length === 1;
          findings.push({
            title: one ? `The preset list starting on line ${unclosed[0]} never closes.`
                       : `The preset lists starting on ${_onLines(unclosed)} never close.`,
            detail: 'The compiler keeps reading everything below as part of the list and reports '
                  + 'the error somewhere further down, often nowhere near the missing brace. '
                  + 'Check that every preset ends with }, and that the list itself ends with };',
            items: [],
            fix: null,
          });
        }
        // With an array unreadable there is nothing trustworthy to say about the
        // presets inside it, so stop rather than pile guesses on top.
        if (findings.length) return { findings };
      }

      if (!(ctx.parsed.arrays || []).length) return null;
      // One card per kind of fault, however many presets have it, so the explanation shows once.
      const commas = [], unbalanced = [];
      for (const arr of ctx.parsed.arrays) {
        // The parser hands back the array body it already located. If it could not
        // read the array at all there is nothing to count, and guessing at the
        // boundaries ourselves would be a second definition of where a preset
        // array lives.
        const presets = arr.presets || [];
        if (!presets.length) continue;

        for (const p of presets) {
          if (!p.raw) continue;

          // ── (b) A MISSING COMMA BETWEEN THE PARTS OF A PRESET ────────────────
          // The parser reads font, track and styles happily without the separators, so
          // this is read off the text. gcc reports it on a later line, often in a later
          // preset. The fix is a zero-width insertion directly after the part, the one
          // place a comma can legally go.
          const gap = _presetCommaGap(p.raw);
          if (gap) {
            const name = (p.displayName || '').trim() || `Preset ${p.index}`;
            commas.push({ name, index: p.index, after: gap.after, at: _rawOffset(ctx.text, p) + gap.at });
            continue;            // one per preset; the first is the honest one
          }

          const body = _balanceStrip(p.raw);
          const pairs = [['{', '}'], ['(', ')'], ['[', ']'], ['<', '>']];
          for (const [open, close] of pairs) {
            // ANGLE BRACKETS ARE NOT RELIABLE and are counted only for a REPORT,
            // never alone: `Int<-1>` and comparisons put stray `<` and `>` in valid
            // code. Braces, parens and square brackets are structural in a preset
            // and can be trusted.
            if (open === '<') continue;
            let depth = 0, bad = false;
            for (const ch of body) {
              if (ch === open) depth++;
              else if (ch === close) { depth--; if (depth < 0) { bad = true; break; } }
            }
            if (bad || depth !== 0) {
              const name = (p.displayName || '').trim() || `Preset ${p.index}`;
              unbalanced.push({ name, open, close, missing: depth > 0 ? `no closing ${close}` : `an extra ${close}` });
              break;                 // one finding per preset; the first is the honest one
            }
          }
        }
      }
      const noSemicolon = [], closedEarly = [];
      for (const miss of _arrayCommaGaps(ctx.text)) {
        if (miss.end) { (miss.end === 'semicolon' ? noSemicolon : closedEarly).push(miss.at); continue; }
        const arr = ctx.parsed.arrays.find(a => a.name === miss.array) || ctx.parsed.arrays[0];
        const p = arr && (arr.presets || [])[miss.index];
        if (!p) continue;
        const name = (p.displayName || '').trim() || `Preset ${p.index}`;
        commas.push({ name, index: p.index, after: 'it', at: miss.at });
      }

      if (commas.length) {
        const one = commas.length === 1;
        findings.push({
          title: one ? `${_presetName(commas[0].name)} is missing a comma after ${commas[0].after}.`
                     : `${commas.length} commas are missing from the presets.`,
          detail: 'Every part of a preset is separated by a comma, and so is every preset in the '
                + 'list. Without one the compiler reads the next line as part of this one and '
                + 'reports the error somewhere further down, often in a different preset entirely.',
          items: one ? [] : commas.map(g => `${g.name} (after ${g.after})`),
          labels: one ? null : commas.map(g => `${_presetEntry(g)} after ${g.after}`),
          labelLead: 'Presets to update',
          // Every comma goes in at once: one edit, one undo, all against this same text.
          fix: {
            label: one ? 'Add the comma' : 'Add the commas',
            plan: (c) => (c.text === ctx.text ? commas.map(g => _insertAt(c.text, g.at, ',')) : []),
          },
        });
      }
      if (noSemicolon.length) {
        const lines = noSemicolon.map(at => _lineOf(ctx.text, at));
        const one = lines.length === 1;
        findings.push({
          title: one ? `The preset list ending on line ${lines[0]} is missing its semicolon.`
                     : `The preset lists ending on ${_onLines(lines)} are missing their semicolons.`,
          detail: 'A preset list ends with };',
          items: [],
          fix: {
            label: one ? 'Add the semicolon' : 'Add the semicolons',
            plan: (c) => (c.text === ctx.text ? noSemicolon.map(at => _insertAt(c.text, at, ';')) : []),
          },
        });
      }
      if (closedEarly.length) {
        const lines = closedEarly.map(at => _lineOf(ctx.text, at));
        const one = lines.length === 1;
        findings.push({
          title: one ? `The preset list closes early on line ${lines[0]}.`
                     : `Preset lists close early on ${_onLines(lines)}.`,
          detail: 'There is an extra } on or before that line, so the presets after it are '
                + 'outside the list. Cancel and check the braces up to that line before compiling.',
          items: [],
          fix: null,
        });
      }
      if (unbalanced.length) {
        const one = unbalanced.length === 1;
        findings.push({
          title: one ? `${_presetName(unbalanced[0].name)} has unbalanced ${unbalanced[0].open}${unbalanced[0].close}.`
                     : `${unbalanced.length} presets have unbalanced brackets.`,
          detail: (one ? `There is ${unbalanced[0].missing} inside this preset. ` : '')
                + 'The compiler will report this somewhere further down the file, often in a '
                + 'different preset, because it keeps reading past the real mistake.',
          items: one ? [] : unbalanced.map(u => `${u.name} (${u.missing})`),
          fix: null,
        });
      }
      return findings.length ? { findings } : null;
    },
  });

  // ── Blade configs: how many blades, and which preset list ────────────────
  //
  // BladeConfig is positional too: an id, NUM_BLADES blades, then the preset list. One blade
  // too many lands in the preset slot, so gcc reports "cannot convert 'BladeBase*' to 'Preset*'"
  // on the extra blade and says nothing about the count.
  //
  // A macro standing in for blades can expand to any number of them, and a preprocessor line
  // can hide part of a row, so either one makes the row unreadable and the check says nothing.
  preflight.register({
    id: 'bladeconfig-blade-count',
    severity: 'block',
    title: 'A blade config has the wrong number of blades',
    run(ctx) {
      const defs = [...ctx.cleanText.matchAll(/^[ \t]*#[ \t]*define[ \t]+NUM_BLADES[ \t]+(\d+)[ \t]*$/gm)]
        .map(m => Number(m[1]));
      if (!defs.length) return null;
      if (new Set(defs).size > 1) return { unsure: 'NUM_BLADES is defined more than once' };
      const expected = defs[0];

      const groups = new Map();
      for (const row of _bladeConfigRows(ctx.text)) {
        if (row.blades === null || row.blades === expected) continue;
        if (!groups.has(row.blades)) groups.set(row.blades, []);
        groups.get(row.blades).push(row.line);
      }
      if (!groups.size) return null;

      return { findings: [...groups].map(([count, lines]) => {
        const over = count > expected;
        return {
          kind: over ? 'over' : 'under',
          title: `${lines.length === 1 ? 'A blade config' : `${lines.length} blade configs`} on `
               + `${_onLines(lines)} ${lines.length === 1 ? 'lists' : 'list'} `
               + `${count} ${count === 1 ? 'blade' : 'blades'}, but NUM_BLADES is ${expected}.`,
          detail: over
            ? 'Raise NUM_BLADES, or remove the extra blade. The compiler reports this as a '
            + "conversion error on the extra blade and doesn't mention the count."
            : 'Lower NUM_BLADES, or add the missing blade.',
          items: [],
          fix: null,
        };
      }) };
    },
  });

  // The name inside CONFIGARRAY(...) has to be a preset list. If it appears anywhere else in
  // the config, a macro or an include may be supplying it, so the check says nothing.
  preflight.register({
    id: 'bladeconfig-preset-list',
    severity: 'block',
    title: 'A blade config points at a preset list that does not exist',
    run(ctx) {
      const toks = _codeTokens(ctx.text);
      if (toks.some(t => t.kind === 'pp' && /^#\s*include\s*"/.test(t.text)
                      && !/_config\.h"|props\/|blades\/|styles\//.test(t.text))) return null;
      const refs = new Map();
      const uses = new Map();
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.kind !== 'word') continue;
        uses.set(t.text, (uses.get(t.text) || 0) + 1);
        if (t.text === 'CONFIGARRAY' && toks[i + 1]?.text === '(' && toks[i + 2]?.kind === 'word'
            && toks[i + 3]?.text === ')') {
          const name = toks[i + 2].text;
          if (!refs.has(name)) refs.set(name, []);
          refs.get(name).push(_lineOf(ctx.text, t.start));
        }
      }
      const findings = [];
      for (const [name, lines] of refs) {
        if (uses.get(name) !== lines.length) continue;
        findings.push({
          title: `${lines.length === 1 ? 'A blade config' : 'Blade configs'} on ${_onLines(lines)} `
               + `${lines.length === 1 ? 'uses' : 'use'} the preset list ${name}, but this config `
               + `has no list with that name.`,
          detail: 'Rename the list it points at, or add one with that name.',
          items: [],
          fix: null,
        });
      }
      return findings.length ? { findings } : null;
    },
  });

  // ── Curly quotes ─────────────────────────────────────────────────────────
  //
  // A word processor swaps straight quotes for curly ones. Inside a string they are ordinary
  // characters and compile fine, so a preset name with a curly apostrophe must never fire. Only
  // a curly quote standing where the compiler needs a real one is a fault.
  preflight.register({
    id: 'curly-quotes',
    severity: 'block',
    title: 'Curly quotes where straight quotes are required',
    run(ctx) {
      const hits = _curlyQuotes(ctx.text);
      if (!hits.length) return null;
      const lines = [...new Set(hits.map(h => _lineOf(ctx.text, h)))];
      return { findings: [{
        title: `This config has curly quotes on ${_onLines(lines)} where it needs straight ones.`,
        detail: 'They usually come from a word processor. They look like quotes, but the compiler rejects them.',
        items: [],
        fix: {
          label: 'Use straight quotes',
          plan: (c) => _curlyQuotes(c.text).map(h => {
            const e = _insertAt(c.text, h, '"');
            return { ...e, endCol: e.endCol + 1 };
          }),
        },
      }] };
    },
  });

  // ── A config that includes itself ────────────────────────────────────────
  //
  // Every build stages the open config as my_config.h, so that name is this file too.
  preflight.register({
    id: 'self-include',
    severity: 'block',
    title: 'The config includes itself',
    run(ctx) {
      const own = String(ctx.configName || '').split(/[\\/]/).pop().toLowerCase();
      const lines = [];
      ctx.cleanText.split('\n').forEach((text, i) => {
        const m = text.match(/^\s*#\s*include\s*"([^"]+)"/);
        if (!m) return;
        const base = m[1].split(/[\\/]/).pop().toLowerCase();
        if (base === 'my_config.h' || base === own) lines.push(i + 1);
      });
      if (!lines.length) return null;
      return { findings: [{
        title: `This config includes itself on ${_onLines(lines)}.`,
        detail: 'The compiler follows the include around in a circle until it gives up, and '
              + 'reports that the includes are nested too deeply.',
        items: [],
        fix: {
          label: lines.length === 1 ? 'Remove the line' : 'Remove the lines',
          plan: () => lines.map(n => ({ startLine: n, startCol: 0, endLine: n + 1, endCol: 0, text: '' })),
        },
      }] };
    },
  });

  // ── A prop the selected OS version does not have ─────────────────────────
  //
  // [B-185]. A config's `#include "../props/<file>.h"` names a prop that is not in
  // the ProffieOS version this config builds with — usually because the user
  // switched version, or was handed a config written against a different tree.
  // Today the only feedback is arduino-cli's raw "No such file or directory",
  // pointing at a path the user never typed.
  //
  // THE ERROR-TRANSLATION THESIS IN MINIATURE: an ordinary mistake answered with
  // a preprocessor path. We already know exactly what is wrong and can say it in a
  // sentence before the compile is spent.
  //
  // THE SHAPE GATE IS WHAT MAKES THIS SAFE, and the entry is explicit about it:
  // a prop can legitimately live somewhere other than props/, and a user may have
  // hand-edited an include we do not model. So this only speaks when the include
  // matches OUR props/ shape — `props/x.h`, optionally one directory up — and the
  // file is absent from that exact folder. Anything else is silence.
  //
  // NO PROP AT ALL IS NOT AN ERROR. ProffieOS falls back to saber.h, and that
  // rule was settled for Link Prop and must stay true. The consequence of having no
  // prop while setting prop options is a different check entirely (B-089).
  //
  // SEVERITY IS `block`, WHICH IS A DELIBERATE DEPARTURE FROM THE ENTRY'S LEAN.
  // It says "warn-and-continue is probably right, or refuse only when the path
  // matches our own props/ shape and the file is absent" — and the second clause is
  // exactly the condition built here, so the refusal is the narrow one it allows.
  // With the shape gate in front, an absent file is a CERTAIN compile failure, and
  // a warning in front of a guaranteed failure is just a slower failure. One word
  // to change if that trade ever reads differently.
  //
  // The wording is lifted from the Link Prop refusal rather than invented, so the
  // app says the same thing about the same fact in both places.

  // A prop this app models: a .h sitting directly in a tree's props/ folder,
  // optionally reached with one leading directory (`../props/x.h`). Mirrors
  // window._LINKABLE_PROP_RE, kept here because a check may not touch the DOM.
  const PROPS_PATH_RE = /^(?:[^/]+\/)?props\/([^/]+\.h)$/i;

  preflight.register({
    id: 'prop-missing-from-version',
    severity: 'block',
    title: 'Prop not in this ProffieOS version',
    async run(ctx) {
      if (!ctx.versionName) return { unsure: 'no ProffieOS version is selected' };

      const includes = vpkPropIncludes(ctx.text)
        .map(p => String(p).replace(/\\/g, '/'))
        .filter(p => PROPS_PATH_RE.test(p));
      if (!includes.length) return null;   // no prop, or one we do not model

      const findings = [];
      for (const inc of includes) {
        const fileName = inc.match(PROPS_PATH_RE)[1];
        // Look in the SAME folder the include names, inside the selected version.
        // Deriving it from the include keeps this correct without hardcoding the
        // tree root, exactly as the Link Prop check does.
        const dir = inc.includes('/') ? inc.slice(0, inc.lastIndexOf('/')) : 'props';
        const subPath = dir.startsWith('ProffieOS/') ? dir : `ProffieOS/${dir.replace(/^\.\.\//, '')}`;

        let res = null;
        try { res = await ctx.listVersionDir(ctx.versionName, subPath); } catch { res = null; }
        // A FAILED LISTING IS NOT AN ABSENT FILE. If the folder cannot be read we
        // know nothing about what is in it, and saying "your prop is missing"
        // because our own lookup broke is the worst answer available.
        if (!res || !res.ok || !Array.isArray(res.entries)) {
          return { unsure: `the props folder of ${ctx.versionName} could not be read` };
        }
        const present = res.entries.some(e => e.type === 'file' && e.name === fileName);
        if (present) continue;

        // The same rule as an unknown style: two edits earns a suggestion, one earns a button.
        let near = null, nearD = 99;
        for (const e of res.entries) {
          if (e.type !== 'file' || !/\.h$/i.test(e.name)) continue;
          const d = _distance(fileName, e.name);
          if (d < nearD) { nearD = d; near = e.name; }
        }
        const suggestion = near && nearD <= 2 ? near : null;

        findings.push({
          title: suggestion ? 'Probably a typo in the prop name.' : `${fileName} is not in ${ctx.versionName}.`,
          detail: suggestion
            ? `${ctx.versionName} does not have ${fileName}. It does have ${suggestion}. If that's the one `
            + `you meant, ${nearD === 1 ? 'use the button' : `change the include to ${suggestion}`}. If not, `
            + `choose Import prop in the Prop dropdown, switch to a version that has it, or link a different prop.`
            : `This config builds with ${ctx.versionName}, and its props folder does not have that file, so `
            + `the build will stop on it. Choose Import prop in the Prop dropdown to add it to this version, `
            + `switch to a version that has it, or link a different prop.`,
          items: [inc],
          fix: suggestion && nearD === 1 ? {
            label: `Change to ${suggestion}`,
            plan(c) {
              const lines = String(c.text).split('\n');
              const i = lines.findIndex(l => /^\s*#\s*include\b/.test(l) && l.includes(fileName));
              if (i < 0) return [];
              const col = lines[i].indexOf(fileName);
              return [{ startLine: i + 1, startCol: col, endLine: i + 1, endCol: col + fileName.length, text: suggestion }];
            },
          } : null,
        });
      }
      return findings.length ? { findings } : null;
    },
  });

  // ── A shared folder name that is the odd one out ─────────────────────────
  //
  // [B-012]. One preset saying `;comn` beside fifty saying `;common`. It COMPILES
  // AND FLASHES FINE — the failure is on the saber, as "font directory not found",
  // because the scanner raises FDNF on any path ELEMENT that does not exist
  // regardless of whether anything was needed from it. That error is the single
  // most-searched pain on the Crucible, 51 threads.
  //
  // THIS CLOSES A LIVE REGRESSION, not a gap. [B-326] shipped 2026-09-06 and
  // made a shared folder recognised by POSITION rather than by being spelled
  // "common" — correct, and the whole point of it. But before that, an unrecognised
  // name made the preset paint red as a missing font: the wrong reason, and a real
  // signal. B-326 removed it and this was never built, so between 09-06 and now a
  // misspelled shared folder has been completely silent. B-012 said "ship them
  // together" in writing. They did not.
  //
  // FREQUENCY, NOT SPELLING — and then CLOSENESS, which the entry did not have.
  // The entry's rule was lopsidedness alone: one preset using a name, many using
  // another. Measured 2026-09-12 against 173 configs, that over-fires on the only
  // real case available: 7957_9.h runs `common` x11 plus `BalVenos/common` x1 and
  // `Nano Guantletcommons` x1, and BOTH of those are legitimate — a nested path and
  // what reads as a real folder for a particular hilt. So an outlier must ALSO be a
  // near-miss of an established name before we say anything.
  //
  // THE DISTANCE IS AGAINST THE CONFIG'S OWN NAMES, NEVER A WORD LIST, and that
  // distinction is the entry's and is load-bearing. A dictionary of
  // misspellings-of-"common" cannot see `MC` typed as `M C` — and an MC config is
  // exactly what the user runs. Comparing against whatever the config uses 3+ times keeps
  // that property: `M C` is one edit from `MC`, whatever the words are.
  //
  // MULTIPLE SHARED FOLDERS ARE LEGITIMATE AND ABOUT TO GET COMMONER. commonSith
  // and commonJedi used evenly is a real design, and B-326 is what made arbitrary
  // names usable at all — so the corpus predates the feature that will produce more
  // of them. The check must never read "more than one name exists" as a fault: it
  // needs a LONE outlier against an ESTABLISHED convention.
  //
  // Measured with all of that in: 0 fires across 173 real configs, while still
  // catching `comn` beside fifty `common` and `M C` beside five `MC`.

  const SHARED_ESTABLISHED_MIN = 3;   // below this there is no convention to be odd against
  const SHARED_MAX_EDITS       = 2;

  preflight.register({
    id: 'shared-folder-odd-one-out',
    severity: 'warn',
    title: 'Shared folder name looks like a typo',
    run(ctx) {
      if (!ctx.parsed) return null;

      const counts = new Map();          // name -> times used
      const firstPreset = new Map();     // name -> a preset to point at
      for (const arr of (ctx.parsed.arrays || [])) {
        for (const p of (arr.presets || [])) {
          if (p.parseError) continue;
          const font = String(p.font || '').trim();
          // No font at all is a different problem, and a freshly seeded ";common"
          // has the folder and simply no font yet.
          if (!preflight.fontDir(font)) continue;
          for (const s of preflight.sharedDirs(font)) {
            counts.set(s, (counts.get(s) || 0) + 1);
            if (!firstPreset.has(s)) {
              firstPreset.set(s, (p.displayName || '').trim() || `Preset ${p.index}`);
            }
          }
        }
      }
      if (counts.size < 2) return null;  // nothing to be the odd one out of

      const established = [...counts].filter(([, c]) => c >= SHARED_ESTABLISHED_MIN).map(([n]) => n);
      if (!established.length) return null;

      // A NUMBERED VARIANT IS DELIBERATE, HOWEVER FEW PRESETS USE IT (the catch,
      // 2026-09-12, after watching `common2` used several times stay silent:
      // "given it wouldn't work as a one off... shouldn't the number be another
      // exception to frequency?"). That is right, and the reasoning is mechanical
      // rather than statistical: NOBODY FAT-FINGERS A DIGIT ONTO THE END OF A WORD.
      // `common2` beside `common` is somebody making a second shared folder, and a
      // lone one is the ORDINARY case of that — you add the folder, then move one
      // preset onto it first. Frequency cannot see the difference; the trailing
      // digit can.
      // Deliberately TRAILING digits only. A suppression rule that is too broad
      // hides real typos, and `M C` vs `MC` must still fire.
      const _numberedVariant = (a, b) => {
        const strip = x => x.replace(/\d+$/, '');
        return strip(a) !== a || strip(b) !== b
          ? strip(a).toLowerCase() === strip(b).toLowerCase()
          : false;
      };

      const findings = [];
      for (const [name, used] of counts) {
        if (used !== 1) continue;        // a LONE outlier, never merely the smaller of two
        let best = null, bestD = 99;
        for (const e of established) {
          if (_numberedVariant(name, e)) { best = null; bestD = 99; break; }
          const d = _distance(name.toLowerCase(), e.toLowerCase());
          if (d > 0 && d < bestD) { bestD = d; best = e; }
        }
        if (!best || bestD > SHARED_MAX_EDITS) continue;

        const preset = firstPreset.get(name);
        findings.push({
          title: `One preset uses ${name} where the rest of your config uses ${best}.`,
          detail: `This looks like a typo. It will compile and flash, and then the saber will say `
                + `"font directory not found" on that preset, because ProffieOS looks for every `
                + `folder a preset names.`,
          items: [preset],
          ..._presetList(ctx, [preset]),
          // The correct spelling is the user's OWN convention, used at least three
          // times in this same config — stronger evidence than any external list,
          // which is why a rename is offered here at two edits where [B-324] stops
          // at one.
          fix: {
            label: `Change ${name} to ${best}`,
            plan(c) {
              const edits = [];
              for (const arr of (c.parsed?.arrays || [])) {
                for (const p of (arr.presets || [])) {
                  if (p.parseError || !p.fontRange) continue;
                  const font = String(p.font || '').trim();
                  const parts = preflight.fontPathParts(font);
                  if (!parts.includes(name)) continue;
                  const rebuilt = parts.map(x => (x === name ? best : x)).join(';');
                  edits.push({
                    startLine: p.fontRange.startLine, startCol: p.fontRange.startCol,
                    endLine:   p.fontRange.endLine,   endCol:   p.fontRange.endCol,
                    text: `"${rebuilt}"`,
                  });
                }
              }
              return edits;
            },
          },
        });
      }
      return findings.length ? { findings } : null;
    },
  });

  // ── WHY THERE IS NO MOUNT_SD_SETTING CHECK HERE ──────────────────────────
  //
  // There was one, briefly: MOUNT_SD_SETTING with a USB type that has no mass storage.
  // ProffieOS.ino undefines the setting when USB_CLASS_MSC is absent, so the define is
  // written, accepted, compiled away, and the only evidence is that the `sd` serial
  // command does not exist. Removed 2026-09-14, and the reason is a rule about this
  // file rather than a judgement about that case.
  //
  // PREFLIGHT IS FOR WHAT BREAKS A COMPILE OR THE SABER. NEVER FOR CONVENIENCE.
  // Every other check here catches something that fails to build or misbehaves on the
  // board. That one caught a define doing nothing — real, and wasted code, but it can
  // never cause an error in either place. It was the only convenience-only entry in
  // the registry, and one gate that stops a build to report a harmless condition is
  // what teaches people to click past the gates that matter.
  //
  // IT ALSO SHIPPED WITH BAD ADVICE, WHICH IS WHAT SURFACED THE RULE. The message
  // ended "Change the USB type to one that includes Mass Storage if you want it" and
  // the check never read ctx.versionName. Below OS8 MOUNT_SD_SETTING is inert whatever
  // the USB type (see _preOs8Why in index.html), so on a pre-OS8 config that advice
  // gives you no `sd` command AND mass storage with no working protection — the exact
  // state the four-touchpoint guard at buildPanel.js:545 exists to prevent. Measured on
  // 88 real configs: it fired on 10, and 8 of those 10 were pre-OS8.
  //
  // WHERE THE IDEA GOES INSTEAD. Turning mass storage ON already offers to add or
  // uncomment the define (offerMountSdSettingOnSelect, index.html:7601). The symmetric
  // move is to offer the reverse when mass storage is turned OFF, at the dropdown,
  // where the user is actually making that choice. Not built.
  //
  // KEEP THIS MEASUREMENT — it is why any future version must not read the blanket
  // flag. Across the 156-config wild corpus: direct MOUNT_SD_SETTING 0,
  // ENABLE_ALL_EDIT_OPTIONS 61 (39%). ENABLE_ALL means "turn on every edit-mode
  // option", not "I want SD mount", so keying off it would fire on two configs in five.

  // ── A style the presets use is switched off by an #ifdef ─────────────── [B-180]
  //
  // A style defined only inside `#ifdef X ... #endif` (in the config, or in the my_styles.h the build
  // puts beside it) does not exist unless X is defined. X is either an add-on's include guard
  // (FUNCTIONS_CHARGE_FULL_PROP_H exists only when functions/charge_full_prop.h is included) or a
  // define the user writes (CHARGE_DETECT_PIN). Without it the style is skipped and the compile stops
  // with "not declared in this scope" at the preset, which names neither the gate nor the include.
  //
  // X counts as defined when the config defines it, or any file the config includes (followed through
  // their own includes in the selected ProffieOS) defines it. The file that defines an include guard
  // is found by searching that tree, so no add-on list is kept here. Only `#ifdef` gates are judged; a
  // style under #if, #ifndef or #else is left alone.

  // name -> [guards] for styles defined ONLY inside #ifdef blocks; a name also defined outside one is not gated.
  function _gatedStyles(sources) {
    const gated = new Map();
    const free = new Set();
    for (const src of sources) {
      const stack = [];   // a guard name, or null for a block we do not judge
      for (const line of String(src || '').split('\n')) {
        let m;
        if ((m = line.match(/^\s*#\s*ifdef\s+([A-Za-z_]\w*)/))) { stack.push(m[1]); continue; }
        if (/^\s*#\s*(if|ifndef)\b/.test(line)) { stack.push(null); continue; }
        if (/^\s*#\s*(else|elif)\b/.test(line)) { if (stack.length) stack[stack.length - 1] = null; continue; }
        if (/^\s*#\s*endif\b/.test(line)) { stack.pop(); continue; }
        for (const u of line.matchAll(/\busing\s+([A-Za-z_]\w*)\s*=/g)) {
          const name = u[1];
          const guards = stack.filter(g => g && !/^CONFIG_[A-Z_]+$/.test(g));
          if (!stack.length || (stack.every(g => g !== null) && !guards.length)) { free.add(name); continue; }
          if (stack.some(g => g === null)) { free.add(name); continue; }
          if (!gated.has(name)) gated.set(name, guards);
        }
      }
    }
    for (const n of free) gated.delete(n);
    return gated;
  }
  // Every #define the config's includes bring in, followed through their own includes in the selected
  // ProffieOS, and the files reached (paths from the version root, "ProffieOS/props/x.h"). Paths resolve
  // from the folder of the file that includes them; the config sits in config/.
  // null when the version cannot be read at all.
  async function _includedDefines(ctx) {
    const r = await _followIncludes(ctx, ctx.cleanText, 'ProffieOS/config');
    return r.readAny || !r.tried ? r : null;
  }
  // Reads `text`'s quoted includes and theirs, from `dir`. { defs, files: Map path -> comment-free text,
  // readAny, tried }. A my_styles.h or absolute include is not followed.
  async function _followIncludes(ctx, text, dir) {
    const defs = new Set();
    const files = new Map();
    const seen = new Set();
    const norm = (p) => {
      const out = [];
      for (const part of p.split('/')) {
        if (part === '..') out.pop();
        else if (part && part !== '.') out.push(part);
      }
      return out.join('/');
    };
    const queue = [];
    const addIncludes = (text, dir) => {
      for (const m of String(text).matchAll(/^[ \t]*#[ \t]*include[ \t]*"([^"]+)"/gm)) {
        const inc = m[1].replace(/\\/g, '/');
        if (/my_styles\.h$/i.test(inc) || /^[A-Za-z]:\//.test(inc) || inc.startsWith('/')) continue;
        queue.push(norm(dir + '/' + inc));
      }
    };
    addIncludes(text, dir);
    let readAny = false;
    while (queue.length && seen.size < 60) {
      const rel = queue.shift();
      if (seen.has(rel)) continue;
      seen.add(rel);
      let f = null;
      try { f = await ctx.readVersionFile(ctx.versionName, rel); } catch { f = null; }
      if (!f || !f.ok || typeof f.content !== 'string') continue;
      readAny = true;
      const clean = preflight.stripComments(f.content);
      files.set(rel, clean);
      for (const d of preflight.configDefines(clean)) defs.add(d);
      addIncludes(clean, rel.slice(0, rel.lastIndexOf('/')));
    }
    return { defs, files, readAny, tried: seen.size };
  }
  // A gate file can lean on a variable it only declares (`extern bool g_charge_full;`) and that one
  // prop defines. With another prop the include compiles and the link fails ("undefined reference").
  // Returns { name, prop } for the first such variable no file the config reaches defines, where the
  // file that does define it is a prop; null otherwise.
  async function _propOnlyNeed(ctx, gateFile, reached) {
    const gateRel = 'ProffieOS/' + gateFile.replace(/^\.\.\//, '');
    let gate = null;
    try { gate = await ctx.readVersionFile(ctx.versionName, gateRel); } catch { gate = null; }
    if (!gate || !gate.ok || typeof gate.content !== 'string') return null;
    const gateClean = preflight.stripComments(gate.content);
    const own = await _followIncludes(ctx, gateClean, gateRel.slice(0, gateRel.lastIndexOf('/')));
    const externs = new Set();
    for (const t of [gateClean, ...own.files.values()]) {
      for (const m of t.matchAll(/^[ \t]*extern[ \t]+(?!"C")[^;(]*?\b([A-Za-z_]\w*)[ \t]*(?:\[[^\]]*\])?[ \t]*;/gm)) externs.add(m[1]);
    }
    // A definition: a type, then the name, then `=`, `;`, `[` or `{`. Not an extern, not an assignment.
    const defines = (t, name) => new RegExp('^[ \\t]*(?!extern\\b|return\\b)[A-Za-z_][\\w:<>,*& \\t]*[ \\t*&]' + name + '[ \\t]*(=[^=]|;|\\[|\\{)', 'm').test(t);
    for (const name of externs) {
      if ([...reached.values()].some(t => defines(t, name))) continue;
      let hits = null;
      try { hits = await ctx.searchVersionFiles(ctx.versionName, name); } catch { hits = null; }
      if (!hits || !hits.ok || !Array.isArray(hits.results)) continue;
      for (const r of hits.results.slice(0, 20)) {
        if (r.type !== 'file' || !/^ProffieOS\/props\/[^/]+\.h$/i.test(r.path || '')) continue;
        let f = null;
        try { f = await ctx.readVersionFile(ctx.versionName, r.path); } catch { f = null; }
        if (f && f.ok && defines(preflight.stripComments(f.content || ''), name)) {
          return { name, prop: String(r.path).replace(/^ProffieOS\//, '') };
        }
      }
    }
    return null;
  }
  // The file in the selected ProffieOS that #defines `guard`, as a path from the config folder
  // ("../functions/charge_full_prop.h"), or null when nothing there defines it.
  async function _guardFile(ctx, guard) {
    let hits = null;
    try { hits = await ctx.searchVersionFiles(ctx.versionName, guard); } catch { hits = null; }
    if (!hits || !hits.ok || !Array.isArray(hits.results)) return null;
    for (const r of hits.results.slice(0, 20)) {
      if (r.type !== 'file' || !/\.h$/i.test(r.path || '')) continue;
      let f = null;
      try { f = await ctx.readVersionFile(ctx.versionName, r.path); } catch { f = null; }
      if (f && f.ok && new RegExp('^[ \\t]*#[ \\t]*define[ \\t]+' + guard + '\\b', 'm').test(f.content || '')) {
        return '../' + String(r.path).replace(/^ProffieOS\//, '');
      }
    }
    return null;
  }
  // Where an include for a gate goes: right before the config's my_styles.h include, or else first
  // inside CONFIG_PRESETS. 1-based line, or 0 when neither is there.
  function _gateIncludeLine(text) {
    const lines = String(text).split('\n');
    const styles = lines.findIndex(l => /^[ \t]*#[ \t]*include[ \t]*["<][^">]*my_styles\.h[">]/.test(l));
    if (styles >= 0) return styles + 1;
    const presets = lines.findIndex(l => /^[ \t]*#[ \t]*ifdef[ \t]+CONFIG_PRESETS\b/.test(l));
    return presets >= 0 ? presets + 2 : 0;
  }

  preflight.register({
    id: 'gated-style-off',
    severity: 'block',
    title: 'A style is switched off by a missing include or define',
    async run(ctx) {
      if (!ctx.parsed) return null;
      const sources = [ctx.cleanText];
      if (/^[ \t]*#[ \t]*include[ \t]*["<][^">]*my_styles\.h[">]/m.test(ctx.cleanText)) {
        let lib = null;
        try { lib = await ctx.readStylesLibrary(); } catch { lib = null; }
        if (lib) sources.push(preflight.stripComments(lib));
      }
      const gated = _gatedStyles(sources);
      if (!gated.size) return null;

      // The gated names the presets actually use, and where.
      const used = new Map();   // name -> [preset labels]
      for (const arr of (ctx.parsed.arrays || [])) {
        for (const p of (arr.presets || [])) {
          if (p.parseError || !p.raw) continue;
          let slots = [];
          try { slots = _parser().extractStyleSlots(p.raw); } catch { slots = []; }
          for (const s of slots) {
            const txt = p.raw.slice(s.startOffset, s.endOffset);
            for (const m of txt.matchAll(/[A-Za-z_]\w*/g)) {
              if (!gated.has(m[0])) continue;
              const label = (p.displayName || '').trim() || `Preset ${p.index}`;
              if (!used.has(m[0])) used.set(m[0], []);
              if (!used.get(m[0]).includes(label)) used.get(m[0]).push(label);
            }
          }
        }
      }
      if (!used.size) return null;

      const defined = new Set(ctx.defines);
      const fromIncludes = await _includedDefines(ctx);
      if (fromIncludes === null) return { unsure: 'the selected ProffieOS version could not be read' };
      for (const d of fromIncludes.defs) defined.add(d);

      // One finding per gate, naming every style it switches off and every preset using them. A gate
      // that is on is kept too: its file can still need a prop this config does not use.
      const byGuard = new Map();   // guard -> { names: [], presets: [], on }
      for (const [name, labels] of used) {
        for (const g of gated.get(name)) {
          if (!byGuard.has(g)) byGuard.set(g, { names: [], presets: [], on: defined.has(g) });
          const b = byGuard.get(g);
          if (!b.names.includes(name)) b.names.push(name);
          for (const l of labels) if (!b.presets.includes(l)) b.presets.push(l);
        }
      }
      if (!byGuard.size) return null;

      const findings = [];
      for (const [guard, b] of byGuard) {
        const names = b.names.join(', ');
        const many = b.names.length > 1;
        const file = await _guardFile(ctx, guard);
        const need = file ? await _propOnlyNeed(ctx, file, fromIncludes.files) : null;
        if (b.on && !need) continue;
        if (need) {
          // The include alone cannot make it build, so no button: the prop is the user's choice.
          const short = file.replace(/^\.\.\//, '');
          findings.push({
            title: `${names} ${many ? 'need' : 'needs'} the ${need.prop.replace(/^props\//, '')} prop, and this config's prop does not support ${many ? 'them' : 'it'}.`,
            detail: `${many ? 'These styles are' : 'This style is'} built on ${short}, which uses ${need.name}. Only `
              + `${need.prop} defines it, so with this prop the compile stops at the link step with "undefined `
              + `reference to ${need.name}". Choose that prop to use ${many ? 'them' : 'it'}, or use a different style.`,
            items: b.presets,
            ..._presetList(ctx, b.presets),
          });
        } else if (file) {
          const at = _gateIncludeLine(ctx.text);
          findings.push({
            title: `${names} ${many ? 'need' : 'needs'} ${file.replace(/^\.\.\//, '')}, but this config does not include it.`,
            detail: `${many ? 'These styles are' : 'This style is'} only defined when ${file.replace(/^\.\.\//, '')} is included `
              + `(#ifdef ${guard}). Without it the compile stops with "not declared in this scope" at the preset.`,
            items: b.presets,
            ..._presetList(ctx, b.presets),
            fix: at ? {
              label: `Add #include "${file}"`,
              plan() {
                return [{ startLine: at, startCol: 0, endLine: at, endCol: 0, text: `#include "${file}"\n` }];
              },
            } : null,
          });
        } else {
          findings.push({
            title: `${names} ${many ? 'are' : 'is'} switched off.`,
            detail: `${many ? 'They sit' : 'It sits'} inside #ifdef ${guard}${_ifdefWhere(ctx, guard)}, and this config never defines `
              + `${guard}, so the compiler skips ${many ? 'them' : 'it'}. Add #define ${guard} to CONFIG_TOP, or `
              + `use a different style.`,
            items: b.presets,
            ..._presetList(ctx, b.presets),
          });
        }
      }
      return findings.length ? { findings } : null;
    },
  });

  // Exposed for index.html, whose Sound Fonts view asks the same question when
  // deciding what a NEWLY added preset should carry. One walk, one answer — the
  // alternative is a second implementation that drifts.
  const api = { vpkLiveText, vpkPropIncludes, vpkPropRequirement, vpkScanPresets, VPK_INIT_RE, treeNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.preflightChecks = api;

}(typeof globalThis !== 'undefined' ? globalThis : this));
