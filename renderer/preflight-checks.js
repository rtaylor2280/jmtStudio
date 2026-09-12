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

}(typeof globalThis !== 'undefined' ? globalThis : this));
