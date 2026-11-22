/**
 * The preflight registry itself.  [B-224]
 *
 * This tests the MECHANISM, not any particular check: that every check runs, that
 * one throwing cannot take the compile down, that "I cannot tell" is honoured as
 * silence, and that findings come back ordered with their severity attached.
 *
 * The individual checks have their own suites.
 *
 * Run: node test/preflight-registry.test.js
 */
const path = require('path');
const preflight = require(path.join(__dirname, '..', 'renderer', 'preflight.js'));

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log('PASS ', name);
  else { failures++; console.log('FAIL ', name, extra === undefined ? '' : `\n      ${extra}`); }
}

const CONFIG = `
#define NUM_BLADES 2
Preset presets[] = {
  { "font", "track.wav", StylePtr<A>(), StylePtr<B>(), "One" },
};
BladeConfig blades[] = {{ 0, WS281XBladePtr<100, bladePin>(), CONFIGARRAY(presets) }};
`;

(async () => {
  // ── the contract is enforced at registration, not at run time ────────────
  {
    preflight._resetForTests();
    let threw = null;
    try { preflight.register({ id: 'x' }); } catch (e) { threw = e; }
    ok('a check with no run() is refused', !!threw, String(threw));

    threw = null;
    try { preflight.register({ id: 'x', run: () => null }); } catch (e) { threw = e; }
    ok('a check with no severity is refused', !!threw, String(threw));

    threw = null;
    try { preflight.register({ id: 'x', severity: 'nope', run: () => null }); } catch (e) { threw = e; }
    ok('an invented severity is refused', !!threw, String(threw));

    threw = null;
    preflight.register({ id: 'dup', severity: 'warn', run: () => null });
    try { preflight.register({ id: 'dup', severity: 'warn', run: () => null }); } catch (e) { threw = e; }
    ok('a duplicate id is refused', !!threw, String(threw));
  }

  // ── every check runs, even after one blocks ──────────────────────────────
  {
    preflight._resetForTests();
    const ran = [];
    preflight.register({ id: 'a', severity: 'block', title: 'A',
      run: () => { ran.push('a'); return { findings: [{ title: 'blocked' }] }; } });
    preflight.register({ id: 'b', severity: 'warn', title: 'B',
      run: () => { ran.push('b'); return { findings: [{ title: 'warned' }] }; } });

    const res = await preflight.run(preflight.buildContext({ text: CONFIG }));
    ok('a blocking check does not short-circuit the rest', ran.join(',') === 'a,b', ran.join(','));
    ok('both findings come back', res.findings.length === 2);
    ok('blocking is reported', res.blocking === true);
    ok('each finding carries its check id and severity',
       res.findings[0].checkId === 'a' && res.findings[0].severity === 'block');
  }

  // ── blocks sort ahead of warnings ────────────────────────────────────────
  {
    preflight._resetForTests();
    preflight.register({ id: 'w', severity: 'warn',  run: () => ({ findings: [{ title: 'w' }] }) });
    preflight.register({ id: 'b', severity: 'block', run: () => ({ findings: [{ title: 'b' }] }) });
    const res = await preflight.run(preflight.buildContext({ text: CONFIG }));
    ok('blocks are listed before warnings regardless of registration order',
       res.findings.map(f => f.checkId).join(',') === 'b,w',
       res.findings.map(f => f.checkId).join(','));
  }

  // ── "I cannot tell" is silence, and is not a finding ─────────────────────
  {
    preflight._resetForTests();
    preflight.register({ id: 'shrug', severity: 'block',
      run: () => ({ unsure: 'the parse disagreed with itself' }) });
    const res = await preflight.run(preflight.buildContext({ text: CONFIG }));
    ok('unsure produces no finding', res.findings.length === 0);
    ok('unsure does not block', res.blocking === false);
    ok('unsure is recorded with its reason so it is debuggable',
       res.unsure.length === 1 && /disagreed/.test(res.unsure[0].reason));
  }

  // ── a check that throws cannot take the compile with it ──────────────────
  {
    preflight._resetForTests();
    preflight.register({ id: 'boom', severity: 'block',
      run: () => { throw new Error('bad regex or whatever'); } });
    preflight.register({ id: 'fine', severity: 'warn',
      run: () => ({ findings: [{ title: 'still ran' }] }) });
    const res = await preflight.run(preflight.buildContext({ text: CONFIG }));
    ok('a throwing check does not block the user', res.blocking === false);
    ok('the checks after it still run', res.findings.length === 1);
    ok('the failure is recorded rather than swallowed',
       res.errors.length === 1 && res.errors[0].id === 'boom', JSON.stringify(res.errors));
  }

  // ── async checks are supported, because walking prop headers needs it ────
  {
    preflight._resetForTests();
    preflight.register({ id: 'slow', severity: 'warn',
      run: async (ctx) => {
        const f = await ctx.readVersionFile('v', 'ProffieOS/props/saber.h');
        return f && f.ok ? { findings: [{ title: f.content }] } : null;
      } });
    const res = await preflight.run(preflight.buildContext({
      text: CONFIG,
      versionName: 'v',
      readVersionFile: async () => ({ ok: true, content: 'from a fake tree' }),
    }));
    ok('an async check is awaited and its injected reader is used',
       res.findings.length === 1 && res.findings[0].title === 'from a fake tree');
  }

  // ── the context is built once and carries what checks need ───────────────
  {
    const ctx = preflight.buildContext({ text: CONFIG });
    ok('the context parses the config once', !!ctx.parsed && ctx.bladeCount === 2);
    ok('defines are available to checks', ctx.defines.has('NUM_BLADES'));
    ok('the context carries NO sd card or library handle — config only, by construction',
       !('sdCard' in ctx) && !('library' in ctx));
    ok('an absent reader is a no-op rather than a crash',
       typeof ctx.readVersionFile === 'function');
  }

  // ── comment stripping keeps a banner from swallowing real code ───────────
  {
    const out = preflight.stripComments([
      '//*********************************************',
      '#define KEEP_ME',
      '//*********************************************',
      '#define ALSO_KEEP',
    ].join('\n'));
    ok('a //***** banner does not blank the lines between it',
       /KEEP_ME/.test(out) && /ALSO_KEEP/.test(out), JSON.stringify(out));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall preflight registry tests passed');
  process.exit(failures ? 1 : 0);
})();
