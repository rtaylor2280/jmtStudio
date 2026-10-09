// The JMT Add-ons release a build compiled in, recorded on the config.  [B-473]
//
// ⚠️ TWO HALVES, AND THE SECOND ONE IS THE WEAK HALF ON PURPOSE. The decision
// (`_addonsVersionFromMeta`) is RUN here against real inputs. The five-step seam
// from the build result to the config file crosses main -> preload -> buildPanel
// -> index.html and cannot be required() in a test, so it is reconciled over
// source text. That is a weaker instrument and it is the one that matters most:
// a field renamed at any single hop makes the whole feature a silent no-op with
// nothing going red, which is exactly how `r.hash` vs `r.fileHash` shipped a
// function that returned an empty array forever.
//
// ⭐ THE CONTROL IS BUILT IN. The charge_state.h case below is the one a naive
// /jmt_/ regex misses, and this file ASSERTS that the fixture would defeat such a
// regex - so the case cannot quietly stop being the hard case.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let failures = 0;
function ok(label, cond, extra) {
  if (cond) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}`);
  if (extra) console.log(`       ${extra}`);
}

const proffie = require('../proffieos');
const decide  = proffie._addonsVersionFromMeta;

const META = {
  jmtVersion: '1.1.1',
  jmtInstalledFiles: [
    'props/jmt_fett263_wrapper.h',
    'functions/charge_state.h',
    'functions/charge_full_prop.h',
    'styles/jmt_styles.h',
  ],
};

console.log('the decision, run against real inputs');

ok('the wrapper include stamps the version',
   decide(META, '#include "../props/jmt_fett263_wrapper.h"\n') === '1.1.1');

ok('a leading-whitespace include still counts',
   decide(META, '\t  #include "../props/jmt_fett263_wrapper.h"\n') === '1.1.1');

// ⚠️ A commented include is not in the binary. Stamping it would be the field
// claiming add-ons were compiled in when the preprocessor never saw them.
ok('a commented-out include does NOT stamp',
   decide(META, '//#include "../props/jmt_fett263_wrapper.h"\n') === null,
   'a //#include is not in the build');
ok('a commented-out include with a space does NOT stamp',
   decide(META, '  // #include "../props/jmt_fett263_wrapper.h"\n') === null);

// ⭐⭐ THE CASE A NAME-PATTERN WOULD MISS, which is why the installed-file list is
// the source of truth rather than a regex over "jmt".
const CHARGE_ONLY = '#include "../functions/charge_state.h"\n';
ok('a JMT header with no jmt_ prefix still stamps',
   decide(META, CHARGE_ONLY) === '1.1.1',
   'charge_state.h is a JMT add-on file and carries no jmt_ in its name');
ok('CONTROL: that fixture really would defeat a /jmt_/ name test',
   !/jmt_/.test(CHARGE_ONLY),
   'if this ever fails the hard case stopped being hard and the test above proves nothing');

ok('a tree with add-ons but a config using none stamps nothing',
   decide(META, '#include "../props/saber_fett263_buttons.h"\n') === null);

ok('a tree with no add-ons installed stamps nothing',
   decide({ jmtVersion: null, jmtInstalledFiles: [] }, '#include "../props/jmt_fett263_wrapper.h"\n') === null);

// A version recorded with no file list cannot prove anything was included, so it
// has to stay quiet rather than assume the wrapper.
ok('a jmtVersion with no recorded file list stamps nothing',
   decide({ jmtVersion: '1.1.1' }, '#include "../props/jmt_fett263_wrapper.h"\n') === null);

ok('missing meta and empty config are both tolerated',
   decide(null, null) === null && decide(undefined, '') === null);

ok('a path recorded with backslashes still matches',
   decide({ jmtVersion: '2.0.0', jmtInstalledFiles: ['props\\jmt_fett263_wrapper.h'] },
          '#include "../props/jmt_fett263_wrapper.h"\n') === '2.0.0');

// ── The seam ─────────────────────────────────────────────────────────
console.log('the seam from build result to config file');

const root       = path.join(__dirname, '..');
const toolchain  = fs.readFileSync(path.join(root, 'toolchain.js'), 'utf8');
const mainJs     = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload    = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const buildPanel = fs.readFileSync(path.join(root, 'renderer', 'buildPanel.js'), 'utf8');
const html       = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

ok('1. the compile result carries addonsVersion',
   /addonsVersion:\s*proffie\.getCompiledAddonsVersion\(/.test(toolchain),
   'toolchain.js must report it from the tree it actually staged');

ok('2. the cache path can ask main for the same answer',
   mainJs.includes("ipcMain.handle('proffieOS:addonsVersionFor'") &&
   /getCompiledAddonsVersion\(/.test(mainJs),
   'one derivation, two callers - a second copy is where they stop agreeing');

ok('3. preload bridges it',
   /getAddonsVersionFor:/.test(preload) &&
   preload.includes("'proffieOS:addonsVersionFor'"),
   'an IPC handler with no bridge is a handler with no caller');

ok('4. onBuildDone destructures addonsVersion',
   /function onBuildDone\(\{[^}]*\baddonsVersion\b/.test(buildPanel),
   'a rename here makes the field undefined forever and nothing goes red');

ok('5. the fresh-compile path passes it through',
   /setCompiledTimestamp\(undefined, durationSec, coreVersion, osVersion, compiledFqbn, compiledUsb, addonsVersion\)/.test(buildPanel),
   'positional argument - the order is load-bearing');

// ⚠️ THE CACHE PATH IS THE ONE THAT WAS NEARLY MISSED. A cache hit stamps every
// other build record, so leaving this one out would let a restore update the OS,
// board and USB fields while the add-ons field kept an older claim.
ok('6. the cache-restore path passes it too',
   /getAddonsVersionFor\(content,\s*null\)/.test(buildPanel) &&
   /result\.metadata\.fqbn,\s*result\.metadata\.usb,\s*_addons\)/.test(buildPanel),
   'a restore is still a build and still has to describe itself');

ok('7. the setter takes it as its seventh parameter',
   /window\.setCompiledTimestamp = async \(isoString, durationSec, coreVersion, osVersion, compiledFqbn, compiledUsb, addonsVersion\)/.test(html));

// ⚠️ UNCONDITIONAL, unlike its three neighbours. null means "no add-ons in this
// build", so a truthiness guard would leave a stale version standing after the
// include is removed and the config recompiled.
ok('8. the setter assigns unconditionally so null CLEARS',
   /metaCompiledAddons = addonsVersion \|\| null;/.test(html) &&
   !/if \(addonsVersion\)\s+metaCompiledAddons/.test(html),
   'null is an answer here, not a missing value');

ok('9. it is serialized as @jmt:compiled_addons',
   /lines\.push\(`\/\/ @jmt:compiled_addons \$\{metaCompiledAddons\}`\)/.test(html));

ok('10. it is parsed back out',
   /compiledAddons:\s+m\(\/\^\\\/\\\/ @jmt:compiled_addons/.test(html),
   'written and never read is the same as not written');

ok('11. the parsed value is destructured and assigned',
   /compiledUsb, compiledAddons,/.test(html) &&
   /metaCompiledAddons\s*=\s*compiledAddons\s*\|\| null;/.test(html),
   'the extractor can return a field nobody reads');

ok('12. it is cleared with the other build records',
   /metaCompiledUsb = metaCompiledAddons = metaFlashed/.test(html),
   'a stale stamp surviving a config switch is worse than no stamp');

// ⚠️ THE ABSENCE THAT IS DELIBERATE. compiled_usb / compiled_os / compiled_board
// are backfilled at load from saved settings for pre-1.8 configs. Nothing saved
// corresponds to an add-ons release, and the version installed TODAY is not
// evidence about an old build - it is the drift this field exists to show.
const backfill = html.slice(html.indexOf('PRE-1.8 CONFIGS CARRY A COMPILE TIMESTAMP'),
                            html.indexOf('baselineBoard   = board'));
ok('CONTROL: the backfill block was located',
   backfill.length > 200 && backfill.includes('metaCompiledOs   = resolvedVersion'),
   'if this slice is empty every assertion over it passes vacuously');
ok('13. compiled_addons is NOT backfilled',
   !/metaCompiledAddons\s*=/.test(backfill),
   'inferring it from the tree would manufacture the very agreement the field exists to question');

console.log(failures
  ? `\ncompiled-addons-stamp: ${failures} FAILED`
  : '\ncompiled-addons-stamp: all checks passed');
process.exit(failures ? 1 : 0);
