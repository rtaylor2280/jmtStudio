/**
 * A define nothing in the selected OS version and prop reads  [B-445, re-scoped 2026-10-15]
 *
 * THE RE-SCOPE IS THE POINT. The entry's design was a table: enumerate which defines belong to
 * which prop, and keep it current across ProffieOS releases. Measured at 179 defines across 15
 * prop files, 13 of which come from prop_base.h and are read whatever prop you use — a table
 * built from that count warns on defines that are always correct. The replacement asks the
 * selected OS version what it actually reads, scoped to the prop actually compiled, and flags
 * what nothing reads. No list to maintain, right for every version, covers the JMT wrapper for
 * free, and it sees the case `prop-defines-without-prop` structurally cannot: that one abstains
 * the moment any prop include is present.
 *
 * MEASURED BEFORE IT WAS BUILT, over 100 real configs against seven installed versions: 60
 * flagged nothing, median 0, worst 7. The rule does not cry wolf, which is the only thing that
 * could have disqualified it.
 *
 * EVERY FALSE POSITIVE BELOW WAS FOUND BY RUNNING IT, NOT BY REASONING:
 *   · ENABLE_WEBUSB is consumed by the BUILD, not the source. No file mentions it.
 *   · FETT263_SWING_OFF is edit distance 2 from FETT263_SWING_ON — the OPPOSITE meaning. Raw
 *     nearest-match would offer the most confidently wrong advice available.
 *   · config/my_config.h is OUR staged copy of the user's config, so every define they wrote is
 *     in the tree because they wrote it. Counting it made the check self-referential.
 *   · FIRE1PTR(NUM, DELAY) is a function-like macro the user wrote. No prop reads it, and the
 *     row offered to delete their own code.
 *   · prop_base.h is inherited by every prop, so its defines are never prop-specific.
 *
 * A FAKE TREE, which is what the shared context exists to allow. Every OS-reading seam is a
 * function on ctx, so this runs with no ProffieOS install.
 *
 * Run: node test/define-nothing-reads.test.js
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const preflight = require(path.join(ROOT, 'renderer', 'preflight.js'));
require(path.join(ROOT, 'renderer', 'preflight-checks.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

// A REALISTIC CONFIG, including a CONFIG_PROP section. Without one there is no selected prop, so
// nothing under props/ counts and every prop define is trivially orphaned — which would let this
// suite pass while the scoping did nothing.
const CONFIG = (defines, prop) => `
#ifdef CONFIG_TOP
#include "proffieboard_v3_config.h"
#define NUM_BLADES 1
#define NUM_BUTTONS 2
${defines.map(d => `#define ${d}`).join('\n')}
#endif

#ifdef CONFIG_PROP
#include "../props/${prop || 'jmt_fett263_wrapper.h'}"
#endif

#ifdef CONFIG_PRESETS
Preset presets[] = {
  { "font;common", "tracks/a.wav", StylePtr<Black>(), "One" },
};
BladeConfig blades[] = { { 0, WS281XBladePtr<1, bladePin>(), CONFIGARRAY(presets) }, };
#endif
`;

// WHERE a name lives is the whole question, so the fake tree maps name -> file rather than
// holding a flat set. Anything absent is absent.
const TREE = {
  NUM_BLADES:                'ProffieOS/common/config_array.h',
  NUM_BUTTONS:               'ProffieOS/common/config_array.h',
  CONFIG_PRESETS:            'ProffieOS/ProffieOS.ino',
  ENABLE_MOTION:             'ProffieOS/common/sensors.h',
  MOTION_TIMEOUT:            'ProffieOS/props/prop_base.h',
  FETT263_SWING_ON:          'ProffieOS/props/saber_fett263_buttons.h',
  FETT263_TWIST_OFF:         'ProffieOS/props/saber_fett263_buttons.h',
  FETT263_THRUST_ON:         'ProffieOS/props/saber_fett263_buttons.h',
  FETT263_SAVE_CHOREOGRAPHY: 'ProffieOS/props/saber_fett263_buttons.h',
  JMT_BLADE_DETECT:          'ProffieOS/props/jmt_fett263_wrapper.h',
  JMT_CHARGE_LOCKOUT:        'ProffieOS/props/jmt_fett263_wrapper.h',
  SA22C_NO_LOCKUP_HOLD:      'ProffieOS/props/saber_sa22c_buttons.h',
};

// The app stages the user's own config here at build time.
const STAGED_CONFIG = 'ProffieOS/config/my_config.h';

function makeCtx(text, opts) {
  const o = opts || {};
  return preflight.buildContext({
    text,
    versionName: o.versionName === undefined ? 'ProffieOS 8.10 +JMT' : o.versionName,
    searchVersionFiles: async (_v, q) => {
      if (o.searchBroken) return { ok: true, results: [] };
      if (/_$/.test(q)) {
        const fam = q.slice(0, -1);
        const paths = [...new Set(Object.entries(TREE)
          .filter(([n]) => n.startsWith(fam + '_')).map(([, p]) => p))];
        return { ok: true, results: paths.map(p => ({ type: 'file', path: p })) };
      }
      const results = [];
      if (TREE[q]) results.push({ type: 'file', path: TREE[q] });
      // EVERY define the config declares is also found in the staged copy. Modelling this is the
      // only way the suite can see the self-reference.
      if (new RegExp('^[ \\t]*#[ \\t]*define[ \\t]+' + q + '\\b', 'm').test(text)) {
        results.push({ type: 'file', path: STAGED_CONFIG });
      }
      return { ok: true, results };
    },
    readVersionFile: async (_v, relPath) => {
      if (/jmt_fett263_wrapper\.h$/i.test(relPath)) {
        return { ok: true, content: '#include "saber_fett263_buttons.h"\n'
          + Object.keys(TREE).filter(n => TREE[n].endsWith('jmt_fett263_wrapper.h')).join('\n') };
      }
      const leaf = String(relPath).split('/').pop();
      const names = Object.keys(TREE).filter(n => TREE[n].endsWith(leaf));
      return { ok: true, content: names.join('\n') };
    },
  });
}

const only    = (res) => res.findings.filter(f => f.checkId === 'define-nothing-reads');
const theOne  = (res) => only(res)[0] || null;
const rowsOf  = (res) => (theOne(res) || {}).rows || [];
const names   = (res) => rowsOf(res).map(r => r.label);
const rowFor  = (res, n) => rowsOf(res).find(r => r.label === n) || null;
const fixNamed = (row, label) => ((row && row.fixes) || []).find(f => f.label === label) || null;

(async () => {

// ── a clean config says nothing ────────────────────────────────────────────
{
  const res = await preflight.run(makeCtx(CONFIG(['FETT263_SWING_ON', 'JMT_BLADE_DETECT'])));
  ok('a config whose defines are all read is silent', only(res).length === 0,
     JSON.stringify(names(res)));
}

// ── ONE message, a list underneath ─────────────────────────────────────────
{
  const res = await preflight.run(makeCtx(CONFIG(['FETT263_BM_DISABLE_SAVE', 'JMT_NOT_A_THING'])));
  ok('ONE finding, not one per define', only(res).length === 1,
     JSON.stringify(only(res).map(f => f.title)));
  ok('with a row for each', rowsOf(res).length === 2, JSON.stringify(names(res)));
  const t = theOne(res).title;
  ok('the message names the version AND the prop it was judged against',
     t.includes('ProffieOS 8.10 +JMT') && t.includes('jmt_fett263_wrapper.h'), t);
  ok('and counts them', /^2 defines are not used/.test(t), t);
  ok('it claims nothing about how they got there',
     !/switch|changed|left behind/i.test(t + ' ' + theOne(res).detail),
     t + ' | ' + theOne(res).detail);
  ok('each row points at its line', rowsOf(res).every(r => /line \d+/.test(r.note)),
     JSON.stringify(rowsOf(res).map(r => r.note)));
}

// ── two remedies per row, in the app's own vocabulary ──────────────────────
{
  const res = await preflight.run(makeCtx(CONFIG(['JMT_NOT_A_THING'])));
  const row = rowFor(res, 'JMT_NOT_A_THING');
  const labels = ((row || {}).fixes || []).map(x => x.label);
  ok('TWO REMEDIES on the row', labels.length === 2, JSON.stringify(labels));
  ok('and the first says Disable, the word the preset list already uses',
     labels.includes('Disable'), JSON.stringify(labels));
  ok('Delete is offered', labels.includes('Delete'), JSON.stringify(labels));
  ok('NO Replace BUTTON — renaming is the row editor, not a remedy',
     !fixNamed(row, 'Replace'), JSON.stringify(labels));
  ok('the row is renameable', typeof (row.rename || {}).plan === 'function',
     JSON.stringify(Object.keys(row)));
  ok('and renaming rewrites the define wherever it is defined',
     row.rename.plan({ text: CONFIG(['JMT_NOT_A_THING']) }, 'JMT_REAL').length === 1,
     JSON.stringify(row.rename.plan({ text: CONFIG(['JMT_NOT_A_THING']) }, 'JMT_REAL')));
}

// ── the suggestion, and the antonym guard ──────────────────────────────────
{
  const res = await preflight.run(makeCtx(CONFIG(['FETT263_SAVE_CHOREOGRAPHYY'])));
  const row = rowFor(res, 'FETT263_SAVE_CHOREOGRAPHYY');
  ok('a one-character typo is suggested back',
     (row.suggest || {}).name === 'FETT263_SAVE_CHOREOGRAPHY', JSON.stringify(row.suggest));
  ok('and the suggestion is SEPARATE from the editor, never pre-filled into it',
     row.rename && !('initial' in row.rename), JSON.stringify(row.rename));
  ok('taking the suggestion renames to it',
     row.suggest.plan({ text: CONFIG(['FETT263_SAVE_CHOREOGRAPHYY']) },
                      row.suggest.name)[0].text === 'FETT263_SAVE_CHOREOGRAPHY',
     JSON.stringify(row.suggest.plan({ text: CONFIG(['FETT263_SAVE_CHOREOGRAPHYY']) },
                                     row.suggest.name)));
  ok('the note stays the LOCATION only, so the two offers do not merge in one sentence',
     /^line \d+$/.test(row.note), row.note);
}
{
  // THE ONE THAT MUST NOT REGRESS. FETT263_SWING_OFF is distance 2 from FETT263_SWING_ON and
  // means the opposite; suggesting it would be the most confidently wrong advice available.
  const res = await preflight.run(makeCtx(CONFIG(['FETT263_SWING_OFF'])));
  const row = rowFor(res, 'FETT263_SWING_OFF');
  ok('AN ANTONYM IS NEVER SUGGESTED, however close it is',
     row && !row.suggest, JSON.stringify(row && row.suggest));
  ok('the row still reports it, and is still renameable by hand',
     row && typeof (row.rename || {}).plan === 'function', JSON.stringify(row && row.note));
}
{
  const res = await preflight.run(makeCtx(CONFIG(['FETT263_BM_DISABLE_SAVE'])));
  const row = rowFor(res, 'FETT263_BM_DISABLE_SAVE');
  ok('a far-off name is not offered as a correction',
     row && !row.suggest, JSON.stringify(row && row.suggest));
}

// ── the false-positive classes, every one found by running it ──────────────
{
  const res = await preflight.run(makeCtx(CONFIG(['ENABLE_WEBUSB'])));
  ok('a BUILD-level define is not accused — no source file mentions it',
     only(res).length === 0, JSON.stringify(names(res)));
}
{
  const text = CONFIG(['MY_OWN_PIN 7']).replace(
    'BladeConfig blades[] = { { 0,', 'BladeConfig blades[] = { { MY_OWN_PIN,');
  const res = await preflight.run(makeCtx(text));
  ok('a define the config uses itself is left alone', only(res).length === 0,
     JSON.stringify(names(res)));
}
{
  // A FUNCTION-LIKE MACRO IS THE USER'S OWN CODE. Found on the first real run, 2026-10-16:
  // the check accused `#define FIRE1PTR(NUM, DELAY)` and offered to delete it.
  const text = CONFIG(['FIRE1_DELAY 800']).replace(
    '#endif\n\n#ifdef CONFIG_PROP',
    '#define FIRE1PTR(NUM, DELAY) StylePtr<Red>()\n#endif\n\n#ifdef CONFIG_PROP');
  const res = await preflight.run(makeCtx(text));
  ok('a function-like macro is never accused',
     !names(res).includes('FIRE1PTR'), JSON.stringify(names(res)));
  ok('but a plain value define beside it still is',
     names(res).includes('FIRE1_DELAY'), JSON.stringify(names(res)));
}
{
  // THE STAGED CONFIG IS NOT EVIDENCE. Every define the user writes lands in
  // config/my_config.h at build time, so counting it means the check can barely fire on
  // anything compiled once.
  const res = await preflight.run(makeCtx(CONFIG(['TOTALLY_INVENTED_THING'])));
  ok('a define found ONLY in our staged config copy is still reported',
     names(res).includes('TOTALLY_INVENTED_THING'), JSON.stringify(names(res)));
}

// ── scoping: which props are actually compiled ─────────────────────────────
{
  const res = await preflight.run(
    makeCtx(CONFIG(['JMT_BLADE_DETECT', 'FETT263_SWING_ON'], 'saber_fett263_buttons.h')));
  ok('switching away from the wrapper orphans ITS defines',
     names(res).includes('JMT_BLADE_DETECT'), JSON.stringify(names(res)));
  ok("and the selected prop's own defines stay silent",
     !names(res).includes('FETT263_SWING_ON'), JSON.stringify(names(res)));
}
{
  const res = await preflight.run(
    makeCtx(CONFIG(['JMT_BLADE_DETECT', 'FETT263_SWING_ON'], 'jmt_fett263_wrapper.h')));
  ok("with the wrapper selected, BOTH its own and Fett's defines are read",
     only(res).length === 0, JSON.stringify(names(res)));
}
{
  const res = await preflight.run(makeCtx(CONFIG(['SA22C_NO_LOCKUP_HOLD'])));
  ok('a define owned by an unselected prop is orphaned',
     names(res).includes('SA22C_NO_LOCKUP_HOLD'), JSON.stringify(names(res)));
}
{
  // prop_base.h is inherited by every prop, so its defines survive any switch. The original
  // table-based design counted these as prop-specific, which is the false positive it died on.
  const res = await preflight.run(
    makeCtx(CONFIG(['MOTION_TIMEOUT 60000'], 'saber_fett263_buttons.h')));
  ok('a prop_base define is never accused', only(res).length === 0, JSON.stringify(names(res)));
}
{
  // NO PROP INCLUDE STILL MEANS A PROP: ProffieOS.ino falls back to props/saber.h.
  const text = CONFIG(['SABER_OWN_THING'], 'saber.h')
    .replace(/#ifdef CONFIG_PROP[\s\S]*?#endif\n/, '');
  TREE.SABER_OWN_THING = 'ProffieOS/props/saber.h';
  const res = await preflight.run(makeCtx(text));
  ok('a config with NO prop include is judged against saber.h, not against nothing',
     !names(res).includes('SABER_OWN_THING'), JSON.stringify(names(res)));
  delete TREE.SABER_OWN_THING;
}

// ── abstentions: the check must know when it cannot know ───────────────────
{
  // ITS OWN VERSION NAME, DELIBERATELY. The lookup cache is keyed by version and lives for the
  // session, so reusing a warmed name would answer this from the cache and the sentinel would
  // pass on evidence gathered through a working search.
  const res = await preflight.run(makeCtx(CONFIG(['JMT_NOT_A_THING']),
    { searchBroken: true, versionName: 'ProffieOS 9.99 (unreadable)' }));
  ok('A BROKEN SEARCH ABSTAINS INSTEAD OF CONDEMNING EVERYTHING',
     only(res).length === 0,
     'without the sentinel every define in the config reads as dead, with Delete beside it');
}
{
  const res = await preflight.run(makeCtx(CONFIG(['JMT_NOT_A_THING']), { versionName: '' }));
  ok('no selected version, no verdict', only(res).length === 0);
}
{
  const res = await preflight.run(makeCtx('#ifdef CONFIG_TOP\n#define JMT_NOT_A_THING\n#endif\n'));
  ok('a CONFIG_TOP fragment is not judged', only(res).length === 0);
}

console.log(failures === 0 ? '\nOK' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

})().catch(e => { console.error(e); process.exit(1); });
