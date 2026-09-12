/**
 * Blade style count preflight — unit tests for the compile gate. [B-365]
 *
 * Same approach as voicepack-preflight.test.js: the gate lives in the inline
 * <script> of renderer/index.html, so this extracts the real source text and
 * evaluates it rather than copying it. A copy would prove nothing, and an edit
 * to the implementation has to be visible here.
 *
 * What matters most, in order:
 *   1. It does not fire on a valid config. A gate that blocks a compile that
 *      would have worked is worse than the bug it was written for.
 *   2. It does not count presets the compiler never sees (commented out), or
 *      presets the parser could not read (their style list is empty by
 *      construction, so counting them reports "0 of 4" about a different fault).
 *   3. It names PRESETS, not lines. The line gcc reports is the preset's name,
 *      which is the only token of the wrong type once a missing style lets the
 *      name slide into the last style slot — correct, and unusable.
 *   4. Over-count is deliberately out of scope: it already has a red header and
 *      a repair tool, so it must stay silent here.
 *
 * Run: node test/blade-count-preflight.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const presetParser = require(path.join(ROOT, 'renderer', 'presetParser.js'));

function extract(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`could not extract ${startMarker.slice(0, 40)}…`);
  return html.slice(a, b);
}

// _vpkEsc is a one-line arrow the gate reuses for escaping; take its whole line.
const escLine = html.split('\n').find(l => l.includes('const _vpkEsc ='));
if (!escLine) throw new Error('could not find _vpkEsc');

const src = escLine + '\n'
          + extract('window.checkBladeStyleCounts = async function () {', '// ── Window title');

let lastDialog = null;
let answer = 'confirm';
const ctx = {
  presetParser,
  console,
  window: {},
  editor: null,
  promptConfirm: async (opts) => { lastDialog = opts; return answer; },
};
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'index.html:blade-count-preflight' });

const gate = ctx.window.checkBladeStyleCounts;
if (typeof gate !== 'function') throw new Error('checkBladeStyleCounts did not attach to window');

// ── tiny harness ────────────────────────────────────────────────────────
let failures = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('PASS ', name); }
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// Tags become a space so adjacent words never fuse, then whitespace before
// punctuation is closed up — otherwise "<strong>P8</strong>, and" reads as
// "P8 , and" and every assertion has to know where the markup was.
const strip = s => String(s == null ? '' : s)
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.;:])/g, '$1')
  .trim();

async function check(config, reply = 'confirm') {
  ctx.editor = { getValue: () => config };
  answer = reply;
  lastDialog = null;
  const proceed = await gate();
  return { proceed, dialog: lastDialog, body: strip(lastDialog && lastDialog.messageHtml) };
}

// Build a config with `presets` = [{ n: styleCount, name }].
const mk = (numBlades, presets, bank = 'testbank') => `
#define NUM_BLADES ${numBlades}
Preset ${bank}[] = {
${presets.map(p => `  { "font", "track.wav", ${
  Array.from({ length: p.n }, (_, i) => `StylePtr<S${i}>()`).join(', ')
}, "${p.name}" },`).join('\n')}
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(${bank}) }};
`;

(async () => {
  // ── 1. the case it was written for ────────────────────────────────────
  {
    // NUM_BLADES 4, first preset complete, the rest one style short. This is the
    // shape of the config that produced five unreadable gcc errors on 09-10.
    const r = await check(mk(4, [
      { n: 4, name: 'Graflex' }, { n: 3, name: 'Graflex3' }, { n: 3, name: 'Luke' },
      { n: 3, name: 'GL9' }, { n: 3, name: 'Graflex8' },
    ]));
    ok('four short presets block the compile', r.proceed === false);
    ok('the count is stated as "3 of 4"', /4 presets have 3 of 4 blade styles/.test(r.body), r.body);
    ok('every short preset is named', /Graflex3, Luke, GL9, Graflex8/.test(r.body), r.body);
    ok('the COMPLETE preset is not named',
       !/\bGraflex,/.test(r.body) && !/\bGraflex\b(?!\d)/.test(r.body.replace(/Graflex3|Graflex8/g, '')), r.body);
    ok('no line number is offered', !/line \d|:\d+/i.test(r.body), r.body);
  }

  // ── 2. silence on anything that compiles ──────────────────────────────
  {
    const r = await check(mk(4, [{ n: 4, name: 'A' }, { n: 4, name: 'B' }]));
    ok('a correct config is silent and proceeds', r.proceed === true && !r.dialog);
  }
  {
    // Over-count also fails to compile, but it already shows a red "4/2 BLADES"
    // header and offers a repair. Out of scope here, on purpose.
    const r = await check(mk(2, [{ n: 4, name: 'TooMany' }]));
    ok('over-count stays silent (out of scope)', r.proceed === true && !r.dialog);
  }
  {
    const r = await check(`Preset testbank[] = {
  { "font", "track.wav", StylePtr<A>(), "One" },
};`);
    ok('no knowable blade count means no claim', r.proceed === true && !r.dialog);
  }
  {
    ctx.editor = { getValue: () => '' };
    ok('an empty editor never blocks', (await gate()) === true);
  }

  // ── 3. presets the compiler never sees ────────────────────────────────
  {
    const r = await check(`
#define NUM_BLADES 4
Preset testbank[] = {
  { "font", "track.wav", StylePtr<A>(), StylePtr<B>(), StylePtr<C>(), StylePtr<D>(), "Good" },
/*
  { "font", "track.wav", StylePtr<A>(), "DisabledBlock" },
*/
  //{ "font", "track.wav", StylePtr<A>(), "DisabledLine" },
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(testbank) }};
`);
    ok('commented-out short presets are not counted', r.proceed === true && !r.dialog,
       r.body);
  }

  // ── 4. wording ────────────────────────────────────────────────────────
  {
    const r = await check(mk(2, [{ n: 2, name: 'Fine' }, { n: 1, name: 'Lonely' }]));
    ok('one short preset reads as singular in the title',
       /^A Preset Is Missing/.test(r.dialog.title), r.dialog.title);
    ok('one short preset reads as singular in the body',
       /1 preset has 1 of 2 blade styles/.test(r.body) && /that preset/.test(r.body), r.body);
  }
  {
    // Different shortfalls cannot share one "N of M" phrase, and a per-preset
    // breakdown is more than anyone needs to go and fix them.
    const r = await check(mk(4, [{ n: 3, name: 'Three' }, { n: 2, name: 'Two' }]));
    ok('mixed shortfalls fall back to "fewer than"',
       /fewer than 4 blade styles/.test(r.body), r.body);
  }
  {
    const r = await check(mk(3, [{ n: 2, name: '' }]));
    ok('an unnamed preset is pointed at by position', /Preset 1/.test(r.body), r.body);
  }
  {
    const r = await check(mk(4, Array.from({ length: 12 }, (_, i) => ({ n: 3, name: 'P' + (i + 1) }))));
    ok('a long list truncates and says how many are left',
       /P8, and 4 more/.test(r.body), r.body);
  }
  {
    const r = await check(`
#define NUM_BLADES 3
Preset bankA[] = {
  { "font", "track.wav", StylePtr<A>(), StylePtr<B>(), "Ashort" },
};
Preset bankB[] = {
  { "font", "track.wav", StylePtr<A>(), StylePtr<B>(), StylePtr<C>(), "Bfine" },
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(bankA) }};
`);
    ok('with two banks, the offending bank is named', /bankA/.test(r.body), r.body);
    ok('the clean bank is not named', !/bankB/.test(r.body), r.body);
  }

  // ── 5. slot vs slots ──────────────────────────────────────────────────
  {
    // Short by one: one empty slot to fill.
    const r = await check(mk(4, [{ n: 3, name: 'Short' }]));
    ok('short by one says "slot"', /empty slot in the Styles row/.test(r.body), r.body);
  }
  {
    // The real 2026-09-12 case: 34 presets at 1 of 3, each missing TWO slots.
    // "the empty slot" there describes a screen the user is not looking at.
    const r = await check(mk(3, Array.from({ length: 34 }, (_, i) => ({ n: 1, name: 'P' + (i + 1) }))));
    ok('short by two says "slots"', /empty slots in the Styles row/.test(r.body), r.body);
  }
  {
    // Mixed: one preset short by one, another by two. Any preset short by more
    // than one makes it plural.
    const r = await check(mk(4, [{ n: 3, name: 'ByOne' }, { n: 2, name: 'ByTwo' }]));
    ok('mixed shortfalls say "slots"', /empty slots in the Styles row/.test(r.body), r.body);
  }

  // ── 6. the buttons ────────────────────────────────────────────────────
  {
    // The gate can only be as right as the parser. "Compile anyway" exists for
    // the case where we are wrong, not because a short preset might build.
    const r = await check(mk(4, [{ n: 3, name: 'Short' }]), 'middle');
    ok('Compile anyway proceeds', r.proceed === true);
  }
  {
    const r = await check(mk(4, [{ n: 3, name: 'Short' }]), 'confirm');
    ok('the other button blocks', r.proceed === false);
    // ⚠️ "OK" sat here until 2026-09-12 and was ambiguous against "Compile
    // anyway" - it reads as "OK, go ahead", which is the one direction this
    // dialog cannot afford. Both buttons must name their action.
    ok('neither button is an unlabelled acknowledgement',
       !/^(OK|Okay|Close|Done)$/i.test(r.dialog.confirmText)
       && !/^(OK|Okay|Close|Done)$/i.test(r.dialog.middleText),
       `confirm="${r.dialog.confirmText}" middle="${r.dialog.middleText}"`);
    ok('the blocking button names the compile',
       /compile/i.test(r.dialog.confirmText), r.dialog.confirmText);
  }

  // ── 7. the parser is not corroboration of itself ──────────────────────
  {
    // 3438_2.h from the wild corpus: one real StylePtr, parsed as zero styles,
    // no parseError. Blocking it would stop a config that compiles.
    const r = await check(`
#define NUM_BLADES 1
Preset presets[] = {
  { "apocalypse;common", "tracks/cantina.wav",
    StylePtr<Layers<
  //an alternate, commented out
  HumpFlicker<Red,Rgb<125,0,0>,40>>>()},
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(presets) }};
`);
    ok('a preset whose styles the parser missed is NOT blocked',
       r.proceed === true && !r.dialog, r.body);
  }
  {
    // ⚠️ A KNOWN GAP, ASSERTED SO IT IS VISIBLE RATHER THAN FORGOTTEN. [B-372]
    // presetParser counts a COMMENTED-OUT style as a real slot (both // and /* */),
    // so this preset reads as 2 of 2 and the gate never sees a shortfall. The same
    // miscount makes the preset panel show it as complete, which is the worse half.
    // This is a parser fault, not a gate fault, and the gate must not paper over it
    // by second-guessing a count it was given.
    // ⭐ WHEN [B-372] IS FIXED THIS ASSERTION FLIPS AND THIS TEST WILL FAIL. That is
    // the point: change it to expect a block, and delete this note.
    const r = await check(`
#define NUM_BLADES 2
Preset presets[] = {
  { "font", "track.wav",
    StylePtr<Red>(),
    //StylePtr<Blue>(),
    "Real" },
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(presets) }};
`);
    ok('KNOWN GAP [B-372]: a commented-out style is counted as a slot, so this is silent',
       r.proceed === true && !r.dialog, r.body);
  }
  {
    // 6680_5.h shape: { font, track } with nothing else. The parser takes the
    // last string as the name, so the name IS the track - naming a preset after
    // its own wav describes a different fault.
    const r = await check(`
#define NUM_BLADES 2
Preset presets[] = {
    { "TeensySF", "boot.wav" }
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(presets) }};
`);
    ok('a preset named after its own track falls back to position',
       r.proceed === false && /Preset 1/.test(r.body) && !/boot\.wav/.test(r.body), r.body);
  }

  // ── 8. the corpus, which is the only check that cannot be rigged ───────
  //
  // "What did it do across the corpus" is B-224's stated bar for any new check,
  // and it is the one measurement here that my own fixtures cannot flatter: these
  // are other people's configs, written without knowing this gate exists.
  const readDir = d => {
    try {
      return fs.readdirSync(path.join(ROOT, d))
        .filter(f => f.endsWith('.h'))
        .map(f => path.join(ROOT, d, f));
    } catch { return []; }   // corpora are gitignored; absent on a fresh machine
  };

  {
    // Configs known to be VALID. Zero of these may be blocked, ever.
    const files = ['local/ConfigExamples', 'local/b226-test-configs', 'local/test-configs']
      .flatMap(readDir);
    if (!files.length) console.log('SKIP  no example configs on this machine');
    else {
      const blocked = [];
      for (const f of files) {
        if ((await check(fs.readFileSync(f, 'utf8'))).proceed === false) blocked.push(path.basename(f));
      }
      ok(`none of the ${files.length} known-good configs are blocked`,
         blocked.length === 0, blocked.join(', '));
    }
  }

  {
    // The wild corpus is scraped from real configs and MANY ARE GENUINELY BROKEN,
    // so blocking is the correct outcome for most of it. What is asserted is the
    // three that are not: measured 2026-09-12, each has styles the parser does not
    // see, and each compiles. They are the reason the corroboration guard exists.
    const files = ['local/nightly/error-exp/wild/configs',
                   'local/nightly/error-exp/wild/configs2'].flatMap(readDir);
    if (!files.length) console.log('SKIP  wild corpus not on this machine');
    else {
      const MUST_STAY_SILENT = ['3438_2.h', '557_17.h', '7230_1.h'];
      const wrongly = [];
      let blocked = 0;
      for (const f of files) {
        const proceed = (await check(fs.readFileSync(f, 'utf8'))).proceed;
        if (proceed === false) {
          blocked++;
          if (MUST_STAY_SILENT.includes(path.basename(f))) wrongly.push(path.basename(f));
        }
      }
      ok(`the ${MUST_STAY_SILENT.length} known false positives stay silent across ${files.length} wild configs`,
         wrongly.length === 0, `wrongly blocked: ${wrongly.join(', ')}`);
      console.log(`      (${blocked} wild configs blocked — most of that corpus is genuinely broken)`);
    }
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall blade-count preflight tests passed');
  process.exit(failures ? 1 : 0);
})();
