/**
 * The blade style count check.  [B-365], rehoused onto the registry [B-224]
 *
 * It used to live in the inline <script> of index.html and this suite extracted it
 * from the HTML. Since 2026-09-12 it is a registered check in preflight-checks.js,
 * so it is just required — which is the point of the registry: a check is data,
 * reads a context, returns findings, and never touches the DOM.
 *
 * ⚠️ WHAT THIS SUITE CANNOT SEE. The dialog is assembled in index.html and is not
 * exercised here — button labels, row layout and the fix affordance are dev-test
 * territory. Do not read a green run as "the gate works"; read it as "the check
 * decides correctly". Those are different claims, and conflating them is how three
 * changes passed every test on 2026-09-03 while none of them reached the screen.
 *
 * What matters most, in order:
 *   1. It does not fire on a valid config. A gate that blocks a compile that would
 *      have worked is worse than the bug it was written for.
 *   2. It does not count presets the compiler never sees, or presets the parser
 *      could not read.
 *   3. It names PRESETS, not lines.
 *   4. Over-count is deliberately out of scope — it already has a red header and a
 *      repair tool. That is [B-223].
 *
 * Run: node test/blade-count-preflight.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const preflight = require(path.join(ROOT, 'renderer', 'preflight.js'));
require(path.join(ROOT, 'renderer', 'preflight-checks.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// One finding per run here by construction — this check returns at most one.
async function check(config) {
  const res = await preflight.run(preflight.buildContext({ text: config }));
  const f = res.findings.find(x => x.checkId === 'blade-style-count') || null;
  return {
    blocked: !!f,
    finding: f,
    // The text a reader would see, with the item list folded in the way the dialog
    // folds it, so assertions read like the sentence on screen.
    body: f ? `${f.title} ${(f.items || []).join(', ')}. ${f.detail}` : '',
    unsure: res.unsure.some(u => u.id === 'blade-style-count'),
  };
}

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
    const r = await check(mk(4, [
      { n: 4, name: 'Graflex' }, { n: 3, name: 'Graflex3' }, { n: 3, name: 'Luke' },
      { n: 3, name: 'GL9' }, { n: 3, name: 'Graflex8' },
    ]));
    ok('four short presets block the compile', r.blocked && r.finding.severity === 'block');
    ok('the count is stated as "3 of 4"', /4 presets have 3 of 4 blade styles/.test(r.body), r.body);
    ok('every short preset is named',
       r.finding.items.join(',') === 'Graflex3,Luke,GL9,Graflex8', r.finding.items.join(','));
    ok('the COMPLETE preset is not named', !r.finding.items.includes('Graflex'));
    ok('no line number is offered', !/line \d|:\d+/i.test(r.body), r.body);
    ok('it offers no fix, because filling a slot is a decision not a repair',
       r.finding.fix === null);
  }

  // ── 2. silence on anything that compiles ──────────────────────────────
  {
    ok('a correct config is silent', !(await check(mk(4, [{ n: 4, name: 'A' }, { n: 4, name: 'B' }]))).blocked);
  }
  {
    ok('over-count stays silent (out of scope, see B-223)',
       !(await check(mk(2, [{ n: 4, name: 'TooMany' }]))).blocked);
  }
  {
    const r = await check(`Preset testbank[] = {
  { "font", "track.wav", StylePtr<A>(), "One" },
};`);
    ok('no knowable blade count means no claim', !r.blocked);
  }
  {
    ok('an empty config never blocks', !(await check('')).blocked);
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
    ok('commented-out short presets are not counted', !r.blocked, r.body);
  }

  // ── 4. wording ────────────────────────────────────────────────────────
  {
    const r = await check(mk(2, [{ n: 2, name: 'Fine' }, { n: 1, name: 'Lonely' }]));
    ok('one short preset reads as singular',
       /1 preset has 1 of 2 blade styles/.test(r.body) && /that preset/.test(r.body), r.body);
  }
  {
    const r = await check(mk(4, [{ n: 3, name: 'Three' }, { n: 2, name: 'Two' }]));
    ok('mixed shortfalls fall back to "fewer than"', /fewer than 4 blade styles/.test(r.body), r.body);
  }
  {
    const r = await check(mk(3, [{ n: 2, name: '' }]));
    ok('an unnamed preset is pointed at by position', r.finding.items.includes('Preset 1'));
  }
  {
    const r = await check(mk(4, [{ n: 3, name: 'Short' }]));
    ok('short by one says "slot"', /empty slot in the Styles row/.test(r.body), r.body);
  }
  {
    const r = await check(mk(3, Array.from({ length: 34 }, (_, i) => ({ n: 1, name: 'P' + (i + 1) }))));
    ok('short by two says "slots"', /empty slots in the Styles row/.test(r.body), r.body);
    ok('all 34 are named in the finding, and folding is the dialog\'s job not the check\'s',
       r.finding.items.length === 34, String(r.finding.items.length));
  }
  {
    const r = await check(mk(4, [{ n: 3, name: 'ByOne' }, { n: 2, name: 'ByTwo' }]));
    ok('mixed shortfalls say "slots"', /empty slots in the Styles row/.test(r.body), r.body);
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

  // ── 5. the parser is not corroboration of itself ──────────────────────
  {
    // 3438_2.h from the wild corpus: one real StylePtr, parsed as zero styles, no
    // parseError. Blocking it would stop a config whose presets are valid.
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
    ok('a preset whose styles the parser missed is NOT blocked', !r.blocked, r.body);
  }
  {
    // ⚠️ A KNOWN GAP, ASSERTED SO IT IS VISIBLE RATHER THAN FORGOTTEN. [B-372]
    // presetParser counts a COMMENTED-OUT style as a real slot, so this reads as
    // 2 of 2 and the check never sees a shortfall. The same miscount makes the
    // preset panel show it as complete, which is the worse half. The fix belongs
    // in the parser, not here.
    // ⭐ WHEN [B-372] IS FIXED THIS ASSERTION FLIPS AND THIS TEST WILL FAIL. That
    // is the point: change it to expect a block, and delete this note.
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
       !r.blocked, r.body);
  }
  {
    const r = await check(`
#define NUM_BLADES 2
Preset presets[] = {
    { "TeensySF", "boot.wav" }
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(presets) }};
`);
    ok('a preset named after its own track falls back to position',
       r.blocked && r.finding.items.includes('Preset 1') && !r.finding.items.includes('boot.wav'),
       JSON.stringify(r.finding && r.finding.items));
  }

  // ── 6. the corpus, which is the only check that cannot be rigged ───────
  //
  // "What did it do across the corpus" is B-224's stated bar for any new check,
  // and it is the one measurement my own fixtures cannot flatter: these are other
  // people's configs, written without knowing this check exists.
  const readDir = d => {
    try {
      return fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.h'))
        .map(f => path.join(ROOT, d, f));
    } catch { return []; }   // corpora are gitignored; absent on a fresh machine
  };

  {
    const files = ['local/ConfigExamples', 'local/b226-test-configs', 'local/test-configs'].flatMap(readDir);
    if (!files.length) console.log('SKIP  no example configs on this machine');
    else {
      const blocked = [];
      for (const f of files) {
        if ((await check(fs.readFileSync(f, 'utf8'))).blocked) blocked.push(path.basename(f));
      }
      ok(`none of the ${files.length} known-good configs are blocked`, blocked.length === 0, blocked.join(', '));
    }
  }

  {
    // The wild corpus is scraped from real configs and MANY ARE GENUINELY BROKEN,
    // so blocking is correct for most of it. What is asserted is the three that
    // are not: measured 2026-09-12, each has styles the parser does not see, and
    // each compiles. They are why the second reading exists.
    const files = ['local/nightly/error-exp/wild/configs',
                   'local/nightly/error-exp/wild/configs2'].flatMap(readDir);
    if (!files.length) console.log('SKIP  wild corpus not on this machine');
    else {
      const MUST_STAY_SILENT = ['3438_2.h', '557_17.h', '7230_1.h'];
      const wrongly = [];
      let blocked = 0;
      for (const f of files) {
        if ((await check(fs.readFileSync(f, 'utf8'))).blocked) {
          blocked++;
          if (MUST_STAY_SILENT.includes(path.basename(f))) wrongly.push(path.basename(f));
        }
      }
      ok(`the ${MUST_STAY_SILENT.length} known false positives stay silent across ${files.length} wild configs`,
         wrongly.length === 0, `wrongly blocked: ${wrongly.join(', ')}`);
      console.log(`      (${blocked} wild configs blocked — most of that corpus is genuinely broken)`);
    }
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall blade-count check tests passed');
  process.exit(failures ? 1 : 0);
})();
